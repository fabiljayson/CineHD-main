#!/usr/bin/env node
/**
 * Réconciliation MySQL ↔ PostgreSQL (Task 11, Step 3).
 *
 *   MYSQL_MIGRATION_URL='mysql://…' DATABASE_MIGRATION_URL='postgres://…' \
 *     node scripts/verifyMysqlPostgresData.js [--tables=a,b] [--json]
 *
 * Pour chaque table : nombre de lignes des deux côtés, puis empreinte canonique
 * des lignes triées par clé primaire. Sort en erreur au premier écart.
 *
 * Ce que le script n'affiche jamais : contenu de ligne, identifiant, secret.
 * Nommer la table et le type d'écart suffit à diagnostiquer, et une sortie de
 * réconciliation peut être archivée ou collée dans un ticket. `--json` est
 * destiné à la preuve de staging, pas au débogage de données.
 */

require('dotenv').config();

const {
  canonicalRow,
  checksumRows,
  connectMysql,
  connectPostgres,
  mysqlColumns,
  postgresColumns,
  primaryKey,
  typeMap,
} = require('./lib/pgTransfer');

const PAGE_SIZE = 1000;

function parseArgs(argv) {
  const options = { tables: [], json: false, cutover: false };
  for (const arg of argv) {
    const [flag, value] = arg.split('=');
    if (flag === '--tables') options.tables = String(value || '').split(',').map((name) => name.trim()).filter(Boolean);
    else if (flag === '--json') options.json = true;
    // `--cutover` ajoute les gardes de bascule : données réconciliées, migrations
    // appliquées, transferts terminés. La bascule elle-même reste une action
    // d'opérateur, jamais un effet de bord de ce script.
    else if (flag === '--cutover') options.cutover = true;
    else throw new Error(`Option inconnue : ${arg}`);
  }
  return options;
}

function expectedMigrationVersions() {
  const fs = require('node:fs');
  const path = require('node:path');
  const directory = path.join(__dirname, '..', 'db', 'migrations');
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.replace(/\.sql$/, ''))
    .sort();
}

async function cutoverReadiness(target, tables) {
  const expected = expectedMigrationVersions();
  const applied = new Set((await target.query('SELECT version FROM schema_migrations')).rows.map((row) => row.version));
  const missingMigrations = expected.filter((version) => !applied.has(version));

  const ledger = await target.query("SELECT to_regclass('public.pg_migration_checkpoint') AS name");
  const completed = ledger.rows[0].name
    ? new Set(
        (await target.query('SELECT table_name FROM pg_migration_checkpoint WHERE completed')).rows.map(
          (row) => row.table_name,
        ),
      )
    : new Set();
  const incompleteTransfers = tables.filter((table) => !completed.has(table));

  return { missingMigrations, incompleteTransfers, ready: missingMigrations.length === 0 && incompleteTransfers.length === 0 };
}

function requireUrls(env) {
  if (!env.MYSQL_MIGRATION_URL) throw new Error('MYSQL_MIGRATION_URL manquant : source non configurée');
  if (!env.DATABASE_MIGRATION_URL) throw new Error('DATABASE_MIGRATION_URL manquant : cible non configurée');
}

async function countMysql(connection, table) {
  const [rows] = await connection.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
  return Number(rows[0].n);
}

async function countPostgres(client, table) {
  const { rows } = await client.query(`SELECT count(*)::bigint AS n FROM "${table}"`);
  return Number(rows[0].n);
}

async function checksumMysql(connection, table, columns) {
  const pkColumns = primaryKey(columns);
  const types = typeMap(columns);
  const order = pkColumns.map((name) => `\`${name}\``).join(', ');
  let lastKey = null;
  const collected = [];

  for (;;) {
    const where = lastKey
      ? `WHERE (${pkColumns.map((name) => `\`${name}\``).join(', ')}) > (${pkColumns.map(() => '?').join(', ')})`
      : '';
    const [page] = await connection.query(
      `SELECT * FROM \`${table}\` ${where} ORDER BY ${order} LIMIT ${PAGE_SIZE}`,
      lastKey || [],
    );
    if (page.length === 0) break;
    for (const row of page) collected.push(canonicalRow(row, types));
    lastKey = pkColumns.map((name) => page[page.length - 1][name]);
    if (page.length < PAGE_SIZE) break;
  }

  return checksumRows(collected);
}

async function checksumPostgres(client, table, columns, pkColumns) {
  const types = typeMap(columns);
  const order = pkColumns.map((name) => `"${name}"`).join(', ');
  let lastKey = null;
  const collected = [];

  for (;;) {
    const where = lastKey
      ? `WHERE (${pkColumns.map((name) => `"${name}"`).join(', ')}) > (${pkColumns.map((_n, i) => `$${i + 1}`).join(', ')})`
      : '';
    const { rows: page } = await client.query(
      `SELECT * FROM "${table}" ${where} ORDER BY ${order} LIMIT ${PAGE_SIZE}`,
      lastKey || [],
    );
    if (page.length === 0) break;
    for (const row of page) collected.push(canonicalRow(row, types));
    lastKey = pkColumns.map((name) => page[page.length - 1][name]);
    if (page.length < PAGE_SIZE) break;
  }

  return checksumRows(collected);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  requireUrls(process.env);

  const source = await connectMysql(process.env.MYSQL_MIGRATION_URL);
  const target = await connectPostgres(process.env.DATABASE_MIGRATION_URL);
  const results = [];
  let readiness = null;
  let verifiedTables = [];

  try {
    const requested = options.tables;
    const tables =
      requested.length > 0
        ? requested
        : (
            await source.query(
              `SELECT TABLE_NAME AS name FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_NAME`,
            )
          )[0].map((row) => row.name);

    verifiedTables = tables;
    for (const table of tables) {
      const sourceColumns = await mysqlColumns(source, table);
      const targetColumns = await postgresColumns(target, table);
      if (targetColumns.length === 0) {
        results.push({ table, status: 'missing_target' });
        continue;
      }

      // La clé primaire vient de la source, la cible doit la contenir aussi.
      const pkColumns = primaryKey(sourceColumns);
      const targetPk = new Set(
        (await target.query(
          `SELECT a.attname AS name FROM pg_index i
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = $1::regclass AND i.indisprimary`,
          [`"${table}"`],
        )).rows.map((row) => row.name),
      );
      const missingKey = pkColumns.filter((name) => !targetPk.has(name));
      if (missingKey.length) {
        results.push({ table, status: 'primary_key_mismatch' });
        continue;
      }

      const [sourceCount, targetCount] = await Promise.all([countMysql(source, table), countPostgres(target, table)]);
      if (sourceCount !== targetCount) {
        results.push({ table, status: 'row_count_mismatch', source: sourceCount, target: targetCount });
        continue;
      }

      const [sourceChecksum, targetChecksum] = await Promise.all([
        checksumMysql(source, table, sourceColumns),
        checksumPostgres(target, table, targetColumns, pkColumns),
      ]);
      results.push({
        table,
        status: sourceChecksum === targetChecksum ? 'ok' : 'checksum_mismatch',
        rows: sourceCount,
      });
    }

    if (options.cutover) readiness = await cutoverReadiness(target, verifiedTables);
  } finally {
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  }

  const failing = results.filter((item) => item.status !== 'ok');
  if (readiness) {
    if (readiness.missingMigrations.length) {
      console.error(`Migrations non appliquées : ${readiness.missingMigrations.join(', ')}`);
    }
    if (readiness.incompleteTransfers.length) {
      console.error(`Transferts inachevés : ${readiness.incompleteTransfers.join(', ')}`);
    }
  }
  if (options.json) {
    console.log(
      JSON.stringify(
        { verifiedAt: new Date().toISOString(), tables: results, ok: failing.length === 0, cutover: readiness },
        null,
        2,
      ),
    );
  } else {
    for (const item of results) {
      const detail =
        item.status === 'ok'
          ? `${item.rows} ligne(s)`
          : item.status === 'row_count_mismatch'
            ? `source ${item.source}, cible ${item.target}`
            : item.status;
      console.log(`${item.status === 'ok' ? '✔' : '✖'} ${item.table} — ${detail}`);
    }
  }

  if (failing.length) {
    // La table fautive est nommée, jamais son contenu.
    console.error(
      `Réconciliation refusée : ${failing.length} table(s) en écart (${failing.map((item) => item.table).join(', ')}).`,
    );
    process.exitCode = 1;
  }

  if (readiness && !readiness.ready) {
    console.error('Bascule refusée : migrations ou transferts incomplets.');
    process.exitCode = 1;
  } else if (readiness) {
    console.log('Bascule autorisée : données réconciliées, migrations et transferts complets.');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Erreur : ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { checksumMysql, checksumPostgres };
