/**
 * Primitives partagées entre le transfert MySQL → PostgreSQL et sa vérification.
 *
 * Le point délicat n'est pas de copier des lignes, c'est de calculer la même
 * empreinte des deux côtés. MySQL et PostgreSQL ne rendent pas les mêmes types
 * JavaScript : dates en chaîne ou en `Date`, entiers 64 bits en `number` ou en
 * chaîne, JSON en texte ou en objet, `NUMERIC` en chaîne. Sans normalisation
 * commune, une empreinte diffère pour des données identiques — ou pire, se
 * ressemble pour des données différentes.
 *
 * Règles appliquées ici :
 *
 * - connexion MySQL en `dateStrings` et fuseau `Z` : aucune date convertie en
 *   heure locale par le pilote ;
 * - `BIGINT` rendu en chaîne des deux côtés (au-delà de 2^53, un `number`
 *   JavaScript perd des chiffres) ;
 * - horodatages normalisés en ISO UTC, JSON trié par clé, binaires en base64.
 */

const { createHash } = require('node:crypto');
const mysql = require('mysql2/promise');
const { Client } = require('pg');

const PG_INT8 = 20;
const PG_TIMESTAMP_WITHOUT_TZ = 1114;
const PG_TIMESTAMP_WITH_TZ = 1184;

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function normalizeTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  // PostgreSQL rend `+00`, MySQL ne rend aucun fuseau. Sans fuseau, la valeur
  // est UTC (session MySQL forcée en `+00:00`) : on ajoute `Z` nous-mêmes, sinon
  // V8 l'interpréterait en heure locale et décalerait l'instant.
  const zone = /([+-]\d{2})$/.exec(text);
  const withMinutes = zone ? `${text.slice(0, zone.index)}${zone[1]}:00` : text;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(withMinutes);
  const candidate = `${withMinutes.replace(' ', 'T')}${hasZone ? '' : 'Z'}`;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

/** Catégorie commune aux deux moteurs pour un type de colonne. */
function categoryOf(dataType) {
  const type = String(dataType || '').toLowerCase().trim();
  if (type.includes('timestamp') || type === 'datetime') return 'timestamp';
  if (type === 'json' || type === 'jsonb') return 'json';
  if (type.includes('blob') || type.includes('binary')) return 'binary';
  if (/^(tinyint|smallint|mediumint|int|integer|bigint|int2|int4|int8|decimal|numeric|float|double|real)/.test(type)) {
    return 'number';
  }
  return 'text';
}

function canonicalValue(category, value) {
  if (value === null || value === undefined) return null;
  if (category === 'timestamp') return normalizeTimestamp(value);
  if (category === 'json') {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (category === 'binary') return { $base64: Buffer.from(value).toString('base64') };
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Ligne normalisée, prête pour l'empreinte ou l'insertion. */
function canonicalRow(row, columnTypes = {}) {
  const result = {};
  for (const key of Object.keys(row).sort()) {
    const category = categoryOf(columnTypes[key]);
    result[key] = canonicalValue(category, row[key]);
  }
  return result;
}

/** Empreinte d'un ensemble de lignes déjà ordonnées par clé primaire. */
function checksumRows(rows) {
  const hash = createHash('sha256');
  for (const row of rows) hash.update(`${stableStringify(row)}\n`);
  return hash.digest('hex');
}

/** Valeur prête à être envoyée à PostgreSQL en paramètre. */
function toPgValue(category, value) {
  if (value === null || value === undefined) return null;
  if (category === 'timestamp') return normalizeTimestamp(value);
  if (category === 'json') return typeof value === 'string' ? value : JSON.stringify(value);
  if (category === 'binary') return Buffer.from(value);
  if (value instanceof Date) return value.toISOString();
  return value;
}

async function connectMysql(url) {
  const connection = await mysql.createConnection({
    uri: url,
    dateStrings: true,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  // Les TIMESTAMP MySQL sont convertis dans le fuseau de session : on force UTC
  // pour que la même valeur donne la même empreinte des deux côtés.
  await connection.query("SET time_zone = '+00:00'");
  return connection;
}

async function connectPostgres(url) {
  const client = new Client({ connectionString: url });
  client.setTypeParser?.(PG_INT8, 'text');
  const { types } = require('pg');
  types.setTypeParser(PG_INT8, (value) => value);
  types.setTypeParser(PG_TIMESTAMP_WITHOUT_TZ, (value) => value);
  types.setTypeParser(PG_TIMESTAMP_WITH_TZ, (value) => value);
  await client.connect();
  return client;
}

async function mysqlColumns(connection, table) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType,
            COLUMN_KEY AS columnKey, ORDINAL_POSITION AS position
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table],
  );
  return rows.map((row) => ({
    name: row.name,
    dataType: String(row.dataType).toLowerCase(),
    unsigned: /unsigned/i.test(String(row.columnType || '')),
    primary: row.columnKey === 'PRI',
    position: Number(row.position),
  }));
}

async function postgresColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name AS name, data_type AS "dataType", ordinal_position AS position
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((row) => ({
    name: row.name,
    dataType: String(row.dataType).toLowerCase(),
    position: Number(row.position),
  }));
}

function typeMap(columns) {
  return Object.fromEntries(columns.map((column) => [column.name, column.dataType]));
}

function primaryKey(columns) {
  const keys = columns.filter((column) => column.primary).sort((a, b) => a.position - b.position).map((column) => column.name);
  if (!keys.length) throw new Error('Table sans clé primaire : transfert non ordonnable');
  return keys;
}

module.exports = {
  categoryOf,
  canonicalRow,
  canonicalValue,
  checksumRows,
  connectMysql,
  connectPostgres,
  mysqlColumns,
  normalizeTimestamp,
  postgresColumns,
  primaryKey,
  stableStringify,
  toPgValue,
  typeMap,
};
