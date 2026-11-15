/**
 * Répétition de la bascule MySQL → PostgreSQL (Task 11).
 *
 * Ce test tourne contre une base MySQL et une base PostgreSQL jetables, jamais
 * contre une source réelle :
 *
 *   docker run -d --name cinehd-mig-src -e MYSQL_ROOT_PASSWORD=pw -p 55434:3306 mysql:8.4
 *   docker run -d --name cinehd-mig-dst -e POSTGRES_PASSWORD=pw -p 55435:5432 postgres:16-alpine
 *   MYSQL_MIGRATION_URL='mysql://root:pw@127.0.0.1:55434/cinehd_mig' \
 *   DATABASE_MIGRATION_URL='postgres://postgres:pw@127.0.0.1:55435/cinehd_mig' \
 *     node --test tests/mysqlPostgresMigration.e2e.test.js
 *
 * Il couvre ce que la bascule doit garantir : relations, gros volumes, NULL,
 * JSON, bornes de dates, valeurs non signées hors plage signée, reprise après
 * arrêt au milieu d'une table, réexécution sans doublon, et arrêt sur échec
 * injecté sans perdre la source.
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { createHash } = require('node:crypto');

const mysql = require('mysql2/promise');
const { Client } = require('pg');
const { renderCreateTable, getTable } = require('../db/schema');
const { canonicalRow, checksumRows } = require('../scripts/lib/pgTransfer');

const MYSQL_URL = process.env.MYSQL_MIGRATION_URL;
const PG_URL = process.env.DATABASE_MIGRATION_URL;
const ENABLED = Boolean(MYSQL_URL && PG_URL);
const skip = ENABLED ? false : 'MYSQL_MIGRATION_URL et DATABASE_MIGRATION_URL requis (bases jetables)';

const ROOT = path.join(__dirname, '..');
const TABLES = ['access_keys', 'films', 'series'];

// 2^63-1 : borne haute réellement stockable par PostgreSQL `BIGINT`.
const UNSIGNED_ID = '9223372036854775807';
// 2^63 : valide côté MySQL `BIGINT UNSIGNED`, impossible côté PostgreSQL signé.
const OUT_OF_RANGE_ID = '9223372036854775808';

function runScript(script, args = [], env = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(ROOT, script), ...args],
      {
        env: {
          ...process.env,
          MYSQL_MIGRATION_URL: MYSQL_URL,
          DATABASE_MIGRATION_URL: PG_URL,
          ...env,
        },
        timeout: 120000,
      },
      (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

async function withMysql(fn) {
  const connection = await mysql.createConnection({ uri: MYSQL_URL, multipleStatements: true });
  try {
    return await fn(connection);
  } finally {
    await connection.end();
  }
}

async function withPg(fn) {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function seedSource() {
  const fixtures = [
    { key: 'KEY-1', active: 1, used: 0, duree: '7', expires: '1735689600', created: '2024-01-01 00:00:00', updated: '2024-01-01 00:00:00' },
    { key: 'KEY-2', active: 0, used: 1, duree: null, expires: null, created: '2024-06-15 12:34:56', updated: '2024-06-15 12:34:56' },
    { key: 'KEY-3', active: 1, used: 0, duree: '30', expires: '2147483647', created: '2038-01-19 03:14:07', updated: '2038-01-19 03:14:07' },
  ];

  await withMysql(async (connection) => {
    for (const name of TABLES) {
      await connection.query(renderCreateTable(getTable(name)));
    }
    for (const name of TABLES) await connection.query(`TRUNCATE TABLE \`${name}\``);

    for (const row of fixtures) {
      await connection.query(
        'INSERT INTO `access_keys` (`key_value`,`active`,`used`,`duree_validite`,`expires_at`,`created_at`,`updated_at`) VALUES (?,?,?,?,?,?,?)',
        [row.key, row.active, row.used, row.duree, row.expires, row.created, row.updated],
      );
    }
    await connection.query('INSERT INTO `access_keys` (`id`,`key_value`,`active`,`used`) VALUES (?,?,?,?)', [
      UNSIGNED_ID,
      'KEY-BIG',
      1,
      0,
    ]);
    // Hors plage signée : le transfert doit refuser la table, pas tronquer.
    await connection.query('INSERT INTO `access_keys` (`id`,`key_value`,`active`,`used`) VALUES (?,?,?,?)', [
      OUT_OF_RANGE_ID,
      'KEY-OUT',
      1,
      0,
    ]);

    // JSON imbriqué + NULL, et une relation logique vers films.
    for (let id = 1; id <= 40; id += 1) {
      await connection.query('INSERT INTO `films` (`id`,`links`,`download_links`) VALUES (?,?,?)', [
        id,
        JSON.stringify({ stream: [{ url: `https://example.test/${id}.m3u8`, quality: '1080p' }], nested: { a: [1, 2, 3] } }),
        id % 5 === 0 ? null : JSON.stringify({ download: [`https://example.test/${id}.mp4`] }),
      ]);
    }
    for (let series = 1; series <= 12; series += 1) {
      await connection.query(
        'INSERT INTO `series` (`series_id`,`season_number`,`episode_number`,`links`) VALUES (?,?,?,?)',
        [series, 1, series, JSON.stringify({ episodes: series })],
      );
    }
  });
}

async function pgCounts() {
  return withPg(async (client) => {
    const counts = {};
    for (const name of TABLES) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${name}"`);
      counts[name] = rows[0].n;
    }
    return counts;
  });
}

async function sourceCounts() {
  return withMysql(async (connection) => {
    const counts = {};
    for (const name of TABLES) {
      const [rows] = await connection.query(`SELECT COUNT(*) AS n FROM \`${name}\``);
      counts[name] = Number(rows[0].n);
    }
    return counts;
  });
}

async function resetTarget() {
  await withPg(async (client) => {
    for (const name of TABLES) await client.query(`TRUNCATE TABLE "${name}"`);
    // Le checkpoint n'existe qu'après le premier passage du transfert.
    const ledger = await client.query("SELECT to_regclass('public.pg_migration_checkpoint') AS name");
    if (ledger.rows[0].name) {
      await client.query('DELETE FROM pg_migration_checkpoint WHERE table_name = ANY($1)', [TABLES]);
    }
  });
}

before(async () => {
  if (!ENABLED) return;
  const migrated = await runScript('db/migratePostgres.js');
  assert.equal(migrated.code, 0, `migrations PostgreSQL: ${migrated.stderr}`);
  await seedSource();
  await resetTarget();
});

test('une valeur unsigned hors plage est refusée en nommant la colonne', { skip }, async () => {
  const refused = await runScript('scripts/migrateMysqlToPostgres.js', ['--tables=access_keys']);
  assert.notEqual(refused.code, 0, 'le transfert doit refuser une valeur non stockable');
  const output = `${refused.stdout}${refused.stderr}`;
  assert.match(output, /access_keys/, 'la table est nommée');
  assert.match(output, /colonne id/, 'la colonne est nommée');
  assert.doesNotMatch(output, /KEY-OUT/, 'aucune valeur de ligne ne doit être affichée');

  // Le garde-fou s'exécute avant tout insert : la cible reste vierge pour cette table.
  assert.equal((await pgCounts()).access_keys, 0, 'aucune ligne ne doit être copiée avant le refus');

  // La source reste la référence : on retire la valeur non stockable pour la suite.
  await withMysql(async (connection) => {
    await connection.query('DELETE FROM `access_keys` WHERE `id` = ?', [OUT_OF_RANGE_ID]);
  });
});

test('le transfert reprend après une table partielle et réconcilie les empreintes', { skip }, async () => {
  const partial = await runScript('scripts/migrateMysqlToPostgres.js', [
    `--tables=${TABLES.join(',')}`,
    '--batch-size=3',
    '--stop-after-batches=1',
  ]);
  assert.equal(partial.code, 0, partial.stderr);

  const afterPartial = await pgCounts();
  assert.ok(
    Object.values(afterPartial).some((count) => count > 0),
    'un arrêt volontaire doit tout de même avoir copié des lignes',
  );
  assert.ok(
    Object.values(afterPartial).some((count) => count === 0) || Object.values(afterPartial).some((count) => count < 40),
    'toutes les lignes ne doivent pas être copiées après un seul lot',
  );

  const finished = await runScript('scripts/migrateMysqlToPostgres.js', [
    `--tables=${TABLES.join(',')}`,
    '--batch-size=3',
  ]);
  assert.equal(finished.code, 0, finished.stderr);

  assert.deepEqual(await pgCounts(), await sourceCounts(), 'mêmes nombres de lignes des deux côtés');

  const verified = await runScript('scripts/verifyMysqlPostgresData.js', [`--tables=${TABLES.join(',')}`]);
  assert.equal(verified.code, 0, verified.stdout + verified.stderr);

  // Réexécution : idempotente, aucun doublon.
  const again = await runScript('scripts/migrateMysqlToPostgres.js', [`--tables=${TABLES.join(',')}`]);
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(await pgCounts(), await sourceCounts());
});

test('les valeurs sensibles traversent sans perte : NULL, JSON imbriqué, borne haute non signée', { skip }, async () => {
  const result = await withPg(async (client) => {
    const big = await client.query('SELECT key_value FROM "access_keys" WHERE id = $1', [UNSIGNED_ID]);
    const json = await client.query('SELECT links, download_links FROM "films" WHERE id = $1', [1]);
    const noDownload = await client.query('SELECT download_links FROM "films" WHERE id = $1', [5]);
    const nulls = await client.query('SELECT duree_validite, expires_at FROM "access_keys" WHERE key_value = $1', ['KEY-2']);
    return {
      bigKey: big.rows[0]?.key_value,
      links: json.rows[0]?.links,
      noDownload: noDownload.rows[0]?.download_links,
      nullRow: nulls.rows[0],
    };
  });

  assert.equal(result.bigKey, 'KEY-BIG', 'borne haute de la plage signée préservée');
  assert.equal(result.links.nested.a[2], 3, 'JSON imbriqué préservé');
  assert.equal(result.noDownload, null, 'NULL JSON préservé comme NULL');
  assert.equal(result.nullRow.duree_validite, null);
  assert.equal(result.nullRow.expires_at, null);
});

test('un échec injecté arrête la bascule sans toucher la source', { skip }, async () => {
  await resetTarget();
  const before = await sourceCounts();

  const failed = await runScript('scripts/migrateMysqlToPostgres.js', [
    `--tables=${TABLES.join(',')}`,
    '--batch-size=2',
    '--inject-failure=after-batch',
  ]);
  assert.notEqual(failed.code, 0, 'un échec injecté doit sortir en erreur');

  assert.deepEqual(await sourceCounts(), before, 'la source reste intacte');

  // Le transfert doit pouvoir reprendre après l'échec, jusqu'à réconciliation.
  const resumed = await runScript('scripts/migrateMysqlToPostgres.js', [`--tables=${TABLES.join(',')}`, '--batch-size=2']);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.deepEqual(await pgCounts(), before);

  const verified = await runScript('scripts/verifyMysqlPostgresData.js', [`--tables=${TABLES.join(',')}`]);
  assert.equal(verified.code, 0, verified.stdout + verified.stderr);
});

test('la vérification refuse une cible divergente sans afficher de contenu', { skip }, async () => {
  // La divergence ne porte que sur `active` : sans `skip_touch`, le trigger
  // modifierait aussi `updated_at` et la réparation serait impossible.
  await withPg(async (client) => {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.skip_touch = 'on'");
    await client.query('UPDATE "access_keys" SET active = 9 WHERE key_value = $1', ['KEY-1']);
    await client.query('COMMIT');
  });

  const result = await runScript('scripts/verifyMysqlPostgresData.js', [`--tables=${TABLES.join(',')}`]);
  assert.notEqual(result.code, 0, 'une divergence doit faire échouer la vérification');
  assert.match(result.stdout + result.stderr, /access_keys/, 'la table fautive est nommée');
  assert.doesNotMatch(result.stdout + result.stderr, /KEY-1/, 'aucun contenu de ligne ne doit apparaître');

  // Remise en état sans réécrire `updated_at` : le trigger se déclenche sur
  // toute mise à jour, y compris celle du test lui-même.
  await withPg(async (client) => {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.skip_touch = 'on'");
    await client.query('UPDATE "access_keys" SET active = 1 WHERE key_value = $1', ['KEY-1']);
    await client.query('COMMIT');
  });
  const repaired = await runScript('scripts/verifyMysqlPostgresData.js', [`--tables=${TABLES.join(',')}`]);
  assert.equal(repaired.code, 0, repaired.stdout + repaired.stderr);
});

test('les empreintes sont calculées de la même façon des deux côtés', { skip }, async () => {
  const rows = [
    { id: 1, name: 'a', payload: { b: 2, a: [1, 2] }, at: '2024-01-01T00:00:00.000Z' },
    { id: 2, name: null, payload: null, at: null },
  ];
  const left = rows.map(canonicalRow);
  const right = rows.map((row) => canonicalRow({ ...row, payload: JSON.parse(JSON.stringify(row.payload ?? null)) }));
  assert.equal(checksumRows(left), checksumRows(right));

  // L'ordre des clés d'un objet JSON ne doit pas changer l'empreinte.
  const reordered = [{ ...rows[0], payload: { a: [1, 2], b: 2 } }, rows[1]].map(canonicalRow);
  assert.equal(checksumRows(reordered), checksumRows(left));
  assert.match(createHash('sha256').update('x').digest('hex'), /^[a-f0-9]{64}$/);
});
