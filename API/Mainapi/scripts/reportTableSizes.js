#!/usr/bin/env node
/**
 * Rapport de volume par table — lecture seule (décision D1).
 *
 * La décision D1 exige des compteurs de lignes et une taille estimée par table
 * avant de planifier la bascule Neon. Ce script les produit **sans jamais
 * copier de données** : il ne lit que `information_schema` et, en mode exact,
 * un `COUNT(*)` par table. Aucune colonne métier n'est sélectionnée, aucun
 * fichier n'est écrit, aucune écriture n'est faite en base.
 *
 *   cd API/Mainapi
 *   node scripts/reportTableSizes.js                    # estimation, markdown
 *   node scripts/reportTableSizes.js --exact            # COUNT(*) par table
 *   node scripts/reportTableSizes.js --format json      # pour un rapport staging
 *
 * Prérequis : DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (lus depuis
 * l'environnement ou `.env`, comme le service). Le script refuse de démarrer
 * sans base configurée et sort en erreur si la connexion échoue : un rapport
 * vide n'est jamais présenté comme un succès.
 */

require('dotenv').config();

const { createPool } = require('mysql2/promise');
const { schema } = require('../db/schema');

const IDENTIFIER = /^[A-Za-z0-9_]+$/;

function parseArgs(argv) {
  const options = { exact: false, format: 'markdown' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--exact') options.exact = true;
    else if (arg === '--format') options.format = String(argv[++index] || '').toLowerCase();
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Option inconnue : ${arg}`);
  }
  if (!['markdown', 'json'].includes(options.format)) {
    throw new Error(`--format doit valoir markdown ou json (reçu : ${options.format || 'rien'})`);
  }
  return options;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
}

function groupOf(tableName) {
  return schema.find((table) => table.name === tableName)?.group || '—';
}

async function collect(pool, exact) {
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_ROWS AS estimatedRows,
            DATA_LENGTH AS dataBytes, INDEX_LENGTH AS indexBytes
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`,
  );

  const tables = [];
  for (const row of rows) {
    // Le nom vient du catalogue de la base, mais il est réinjecté dans une
    // requête : il reste validé, et jamais concaténé sans contrôle.
    if (!IDENTIFIER.test(row.name)) throw new Error(`Nom de table inattendu : ${row.name}`);
    let rowsCount = Number(row.estimatedRows) || 0;
    if (exact) {
      const [counted] = await pool.query(`SELECT COUNT(*) AS total FROM \`${row.name}\``);
      rowsCount = Number(counted[0]?.total) || 0;
    }
    tables.push({
      name: row.name,
      group: groupOf(row.name),
      rows: rowsCount,
      source: exact ? 'count' : 'estimate',
      dataBytes: Number(row.dataBytes) || 0,
      indexBytes: Number(row.indexBytes) || 0,
    });
  }
  return tables;
}

function renderMarkdown(tables, exact) {
  const totalRows = tables.reduce((sum, table) => sum + table.rows, 0);
  const totalBytes = tables.reduce((sum, table) => sum + table.dataBytes + table.indexBytes, 0);
  const lines = [
    `# Volume par table (${exact ? 'COUNT(*) exact' : 'estimation information_schema'})`,
    '',
    '| Table | Groupe | Lignes | Données | Index |',
    '| --- | --- | ---: | ---: | ---: |',
    ...tables.map((table) => `| \`${table.name}\` | ${table.group} | ${table.rows} | ${formatBytes(table.dataBytes)} | ${formatBytes(table.indexBytes)} |`),
    '',
    `**Total : ${tables.length} tables, ${totalRows} lignes, ${formatBytes(totalBytes)}.**`,
  ];
  if (!exact) lines.push('', '_Estimations : `TABLE_ROWS` est approximatif sur InnoDB. Relancer avec `--exact` pour un chiffre de référence._');
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage : node scripts/reportTableSizes.js [--exact] [--format markdown|json]');
    return;
  }

  const missing = ['DB_HOST', 'DB_USER', 'DB_NAME'].filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Base non configurée : ${missing.join(', ')} manquant(s). Renseigner l'environnement du service.`);
  }

  const pool = createPool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 1,
    waitForConnections: true,
  });

  try {
    const tables = await collect(pool, options.exact);
    if (options.format === 'json') {
      console.log(JSON.stringify({ database: process.env.DB_NAME, exact: options.exact, tables }, null, 2));
    } else {
      console.log(renderMarkdown(tables, options.exact));
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Erreur : ${error.message}`);
  process.exitCode = 1;
});
