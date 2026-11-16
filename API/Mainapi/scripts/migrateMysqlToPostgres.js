#!/usr/bin/env node
/**
 * Transfert reprenable MySQL → PostgreSQL (Task 11, Step 2).
 *
 *   MYSQL_MIGRATION_URL='mysql://user:pass@host:3306/cinehd' \
 *   DATABASE_MIGRATION_URL='postgres://…' \
 *     node scripts/migrateMysqlToPostgres.js [--tables=a,b] [--batch-size=500]
 *
 * Propriétés garanties :
 *
 * - **Ordonné** : chaque table est lue par lots successifs, triés par clé
 *   primaire, et la reprise repart de la dernière clé inscrite au checkpoint.
 * - **Idempotent** : l'écriture est un `ON CONFLICT (pk) DO UPDATE`, donc
 *   rejouer un lot ne duplique rien.
 * - **Reprenable** : le checkpoint (`pg_migration_checkpoint`, dans la cible)
 *   enregistre la clé et le nombre de lignes après chaque lot validé. Un arrêt,
 *   volontaire ou non, laisse la source intacte et la cible dans un état
 *   partiel connu.
 * - **Auditable** : l'empreinte canonique de chaque table est recalculée des
 *   deux côtés par `verifyMysqlPostgresData.js`.
 *
 * Options de répétition, jamais utilisées en production :
 *   --stop-after-batches=N   arrête proprement après N lots (sortie 0)
 *   --inject-failure=after-batch  simule une panne après le premier lot (sortie 1)
 *   --reset                  efface les checkpoints (ne supprime aucune ligne)
 */

require('dotenv').config();

const {
  canonicalRow,
  categoryOf,
  checksumRows,
  connectMysql,
  connectPostgres,
  mysqlColumns,
  primaryKey,
  toPgValue,
  typeMap,
  resetSequences,
  assertSequencesAhead,
} = require('./lib/pgTransfer');

const BATCH_SIZE = 500;

function parseArgs(argv) {
  const options = { tables: [], batchSize: BATCH_SIZE, stopAfterBatches: null, injectFailure: null, reset: false, json: false };
  for (const arg of argv) {
    const [flag, rawValue] = arg.split('=');
    if (flag === '--tables') options.tables = String(rawValue || '').split(',').map((name) => name.trim()).filter(Boolean);
    else if (flag === '--batch-size') options.batchSize = Math.max(1, Number.parseInt(rawValue, 10) || BATCH_SIZE);
    else if (flag === '--stop-after-batches') options.stopAfterBatches = Math.max(0, Number.parseInt(rawValue, 10) || 0);
    else if (flag === '--inject-failure') options.injectFailure = rawValue || 'after-batch';
    else if (flag === '--reset') options.reset = true;
    else if (flag === '--json') options.json = true;
    else throw new Error(`Option inconnue : ${arg}`);
  }
  return options;
}

function requireUrls(env) {
  if (!env.MYSQL_MIGRATION_URL) throw new Error('MYSQL_MIGRATION_URL manquant : source non configurée');
  if (!env.DATABASE_MIGRATION_URL) throw new Error('DATABASE_MIGRATION_URL manquant : cible non configurée');
}

async function ensureCheckpointTable(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS pg_migration_checkpoint (
       table_name TEXT PRIMARY KEY,
       last_key JSONB,
       rows_copied BIGINT NOT NULL DEFAULT 0,
       completed BOOLEAN NOT NULL DEFAULT false,
       checksum TEXT,
       updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
}

async function readCheckpoint(client, table) {
  const { rows } = await client.query(
    'SELECT last_key, rows_copied, completed FROM pg_migration_checkpoint WHERE table_name = $1',
    [table],
  );
  return rows[0] || null;
}

async function saveCheckpoint(client, table, { lastKey, rowsCopied, completed, checksum }) {
  await client.query(
    `INSERT INTO pg_migration_checkpoint (table_name, last_key, rows_copied, completed, checksum, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (table_name) DO UPDATE SET
       last_key = EXCLUDED.last_key,
       rows_copied = EXCLUDED.rows_copied,
       completed = EXCLUDED.completed,
       checksum = EXCLUDED.checksum,
       updated_at = now()`,
    [table, lastKey === null ? null : JSON.stringify(lastKey), rowsCopied, completed, checksum ?? null],
  );
}

function keyPredicate(pkColumns, key) {
  // Comparaison de lignes : PostgreSQL et MySQL supportent `(a, b) > (?, ?)`,
  // ce qui évite d'écrire une expression lexicographique par table.
  const placeholders = pkColumns.map(() => '?').join(', ');
  const columns = pkColumns.map((name) => `"${name}"`).join(', ');
  return { sql: `(${columns}) > (${placeholders})`, params: key };
}

function buildInsert(table, columns, pkColumns) {
  const names = columns.map((column) => column.name);
  const quoted = names.map((name) => `"${name}"`).join(', ');
  const updateColumns = names.filter((name) => !pkColumns.includes(name));
  const conflict =
    updateColumns.length === 0
      ? 'DO NOTHING'
      : `DO UPDATE SET ${updateColumns.map((name) => `"${name}" = EXCLUDED."${name}"`).join(', ')}`;
  return { quoted, conflict, count: names.length };
}

/**
 * MySQL accepte des identifiants jusqu'à 2^64-1, PostgreSQL s'arrête à 2^63-1.
 * Une valeur au-delà ne peut pas être stockée : on refuse la table en nommant
 * la colonne, plutôt que de laisser le pilote échouer sur un lot au milieu du
 * transfert, ou pire, de tronquer silencieusement.
 */
async function assertUnsignedRange(source, table, columns) {
  const BIGINT_MAX = '9223372036854775807';
  for (const column of columns.filter((item) => item.dataType === 'bigint' && item.unsigned)) {
    const [rows] = await source.query(
      `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${column.name}\` > ${BIGINT_MAX}`,
    );
    const count = Number(rows[0].n);
    if (count > 0) {
      throw new Error(
        `Table ${table}, colonne ${column.name} : ${count} valeur(s) dépassent la plage BIGINT signé ` +
          `(${BIGINT_MAX}). PostgreSQL ne peut pas les stocker ; corriger la source avant la bascule.`,
      );
    }
  }
}

async function transferTable({ source, target, table, options, state }) {
  const columns = await mysqlColumns(source, table);
  if (columns.length === 0) throw new Error(`Table absente de la source : ${table}`);
  const pkColumns = primaryKey(columns);
  const types = typeMap(columns);
  const insert = buildInsert(table, columns, pkColumns);

  await assertUnsignedRange(source, table, columns);

  let checkpoint = await readCheckpoint(target, table);
  if (checkpoint?.completed) {
    return { table, skipped: true, rows: Number(checkpoint.rows_copied) };
  }

  let lastKey = checkpoint?.last_key ?? null;
  let rowsCopied = Number(checkpoint?.rows_copied ?? 0);
  let batches = 0;

  for (;;) {
    if (options.stopAfterBatches !== null && state.batches >= options.stopAfterBatches) {
      return { table, stopped: true, rows: rowsCopied };
    }

    const where = lastKey ? keyPredicate(pkColumns, lastKey) : null;
    const order = pkColumns.map((name) => `\`${name}\``).join(', ');
    const sql = `SELECT * FROM \`${table}\`${where ? ` WHERE ${where.sql.replace(/"/g, '`')}` : ''} ORDER BY ${order} LIMIT ?`;
    const [rows] = await source.query(sql, [...(where ? where.params : []), options.batchSize]);
    if (rows.length === 0) break;

    const values = [];
    const tuples = rows.map((row) => {
      const tuple = columns.map((column) => {
        values.push(toPgValue(categoryOf(types[column.name]), row[column.name]));
        return `$${values.length}`;
      });
      return `(${tuple.join(', ')})`;
    });

    await target.query('BEGIN');
    try {
      // Les lignes recopiées gardent leurs horodatages d'origine : le trigger
      // `updated_at` ne doit pas réécrire ce que la source dit.
      await target.query("SET LOCAL app.skip_touch = 'on'");
      await target.query(
        `INSERT INTO "${table}" (${insert.quoted}) VALUES ${tuples.join(', ')} ON CONFLICT (${pkColumns
          .map((name) => `"${name}"`)
          .join(', ')}) ${insert.conflict}`,
        values,
      );
      const lastRow = rows[rows.length - 1];
      lastKey = pkColumns.map((name) => lastRow[name]);
      rowsCopied += rows.length;
      batches += 1;
      state.batches += 1;
      await saveCheckpoint(target, table, { lastKey, rowsCopied, completed: false });
      await target.query('COMMIT');
    } catch (error) {
      await target.query('ROLLBACK').catch(() => {});
      throw new Error(`Échec du lot ${batches + 1} de ${table} : ${error.message}`);
    }

    if (options.injectFailure === 'after-batch') {
      // Panne simulée juste après un lot validé : ce que la reprise doit savoir
      // absorber (checkpoint enregistré, source intacte).
      throw new Error(`Échec injecté après le lot de ${table}`);
    }

    if (rows.length < options.batchSize) break;
  }

  const checksum = await checksumTarget(target, table, columns);
  await saveCheckpoint(target, table, { lastKey, rowsCopied, completed: true, checksum });
  return { table, rows: rowsCopied, checksum, batches };
}

async function checksumTarget(target, table, columns) {
  const pageSize = 1000;
  const pkColumns = primaryKey(columns);
  const types = typeMap(columns);
  const order = pkColumns.map((name) => `"${name}"`).join(', ');
  let lastKey = null;
  const rows = [];

  for (;;) {
    const where = lastKey
      ? `WHERE (${pkColumns.map((name) => `"${name}"`).join(', ')}) > (${pkColumns
          .map((_name, index) => `$${index + 1}`)
          .join(', ')})`
      : '';
    const params = lastKey ? lastKey : [];
    const { rows: page } = await target.query(
      `SELECT * FROM "${table}" ${where} ORDER BY ${order} LIMIT ${pageSize}`,
      params,
    );
    if (page.length === 0) break;
    for (const row of page) rows.push(canonicalRow(row, types));
    const lastRow = page[page.length - 1];
    lastKey = pkColumns.map((name) => lastRow[name]);
    if (page.length < pageSize) break;
  }

  return checksumRows(rows);
}

async function listTables(source, requested) {
  if (requested.length) return requested;
  const [rows] = await source.query(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`,
  );
  return rows.map((row) => row.name);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  requireUrls(process.env);

  const source = await connectMysql(process.env.MYSQL_MIGRATION_URL);
  const target = await connectPostgres(process.env.DATABASE_MIGRATION_URL);
  const state = { batches: 0, injected: false };

  try {
    await ensureCheckpointTable(target);
    if (options.reset) {
      await target.query('DELETE FROM pg_migration_checkpoint');
    }

    const tables = await listTables(source, options.tables);
    const results = [];
    for (const table of tables) {
      results.push(await transferTable({ source, target, table, options, state }));
    }

    // Les identifiants copiés n'avancent pas les séquences : sans ce recalage,
    // la première insertion applicative échoue sur une clé déjà prise.
    const transferredTables = results.filter((item) => !item.stopped).map((item) => item.table);
    const sequences = await resetSequences(target, transferredTables);
    // Puis on vérifie : un recalage oublié doit faire échouer la bascule
    // maintenant, pas la première écriture réelle.
    const sequenceCheck = await assertSequencesAhead(target, transferredTables);

    const summary = {
      tables: results,
      copied: results.reduce((sum, item) => sum + (item.rows || 0), 0),
      stoppedEarly: results.some((item) => item.stopped),
      sequences,
      sequencesChecked: sequenceCheck.checked,
    };
    console.log(
      options.json
        ? JSON.stringify(summary)
        : `Transfert terminé : ${summary.copied} ligne(s) sur ${results.length} table(s), ${sequenceCheck.checked} séquence(s) vérifiée(s).`,
    );
  } finally {
    await source.end().catch(() => {});
    await target.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Erreur : ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, transferTable };
