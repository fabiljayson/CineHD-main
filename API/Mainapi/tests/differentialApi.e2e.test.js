/**
 * Harnais différentiel : le même appel sur les deux moteurs doit rendre le même
 * corps de réponse.
 *
 *   docker run -d --name cinehd-diff-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=cinehd -p 55434:3306 mysql:8.4
 *   docker run -d --name cinehd-diff-pg -e POSTGRES_PASSWORD=pw -p 55438:5432 postgres:16-alpine
 *   docker run -d --name cinehd-diff-redis -p 55439:6379 redis:7-alpine
 *   MYSQL_MIGRATION_URL='mysql://root:root@127.0.0.1:55434/cinehd' \
 *   DATABASE_MIGRATION_URL='postgres://postgres:pw@127.0.0.1:55438/cinehd_diff' \
 *   REDIS_HOST=127.0.0.1 REDIS_PORT=55439 \
 *     node --test tests/differentialApi.e2e.test.js
 *
 * Le test fait deux choses, et la seconde est la plus importante : il vérifie
 * que les réponses coïncident sur une base réellement transférée, puis il
 * altère une ligne côté PostgreSQL pour vérifier que le harnais *voit* la
 * divergence. Un comparateur qui ne signale jamais rien passerait le premier
 * point seul.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MYSQL_URL = process.env.MYSQL_MIGRATION_URL;
const PG_URL = process.env.DATABASE_MIGRATION_URL;
const skip = MYSQL_URL && PG_URL ? false : 'MYSQL_MIGRATION_URL et DATABASE_MIGRATION_URL requis';

const ROOT = path.join(__dirname, '..');
const REPORT = path.join(os.tmpdir(), `differential-${process.pid}.json`);

const FILM_ID = 4001;
const SERIES_ID = 4002;

// Même décomposition que le harnais : une seule vérité pour l'URL MySQL.
const { mysqlEnvFromUrl } = require('../scripts/differentialApi');

function runHarness() {
  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'differentialApi.js'), '--report', REPORT],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          DIFF_FILM_ID: String(FILM_ID),
          DIFF_SERIES_ID: String(SERIES_ID),
        },
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status ?? 1, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') };
  }
}

before(async () => {
  if (!MYSQL_URL || !PG_URL) return;

  const mysqlEnv = { ...process.env, ...mysqlEnvFromUrl(MYSQL_URL) };

  // Schéma MySQL complet, puis schéma PostgreSQL, puis transfert : le harnais
  // compare deux bases qui contiennent réellement les mêmes lignes.
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'applySchema.js')], { cwd: ROOT, env: mysqlEnv, stdio: 'pipe' });

  const migrate = () => execFileSync(
    process.execPath,
    [path.join(ROOT, 'db', 'migratePostgres.js')],
    { cwd: ROOT, env: { ...process.env, DATABASE_MIGRATION_URL: PG_URL }, stdio: 'pipe' },
  );
  for (let attempt = 0; ; attempt += 1) {
    try {
      migrate();
      break;
    } catch (error) {
      const detail = String(error.stderr || '');
      if (!/Connection terminated|ECONNREFUSED|the database system is starting up/i.test(detail) || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const mysql = require('mysql2/promise');
  // `mysqlEnvFromUrl` rend les noms de variables d'environnement (DB_*) ;
  // `createConnection` attend les clés de mysql2.
  const connection = await mysql.createConnection({
    host: mysqlEnv.DB_HOST,
    port: Number(mysqlEnv.DB_PORT),
    user: mysqlEnv.DB_USER,
    password: mysqlEnv.DB_PASSWORD,
    database: mysqlEnv.DB_NAME,
  });
  await connection.execute('DELETE FROM series WHERE series_id = ?', [SERIES_ID]);
  await connection.execute('DELETE FROM films WHERE id = ?', [FILM_ID]);
  await connection.execute(
    'INSERT INTO films (id, links) VALUES (?, ?)',
    [FILM_ID, JSON.stringify([{ url: 'https://exemple.test/a.m3u8', quality: '1080p', added_by: 'u1' }])],
  );
  await connection.execute(
    `INSERT INTO series (id, series_id, season_number, episode_number, links)
     VALUES (?, ?, 1, 1, ?)`,
    [SERIES_ID + 1, SERIES_ID, JSON.stringify([{ url: 'https://exemple.test/e1.m3u8', quality: '720p' }])],
  );
  await connection.end();

  execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'migrateMysqlToPostgres.js')],
    {
      cwd: ROOT,
      env: { ...process.env, MYSQL_MIGRATION_URL: MYSQL_URL, DATABASE_URL: PG_URL, DATABASE_MIGRATION_URL: PG_URL },
      stdio: 'pipe',
    },
  );
});

after(() => {
  fs.rmSync(REPORT, { force: true });
});

test('les mêmes requêtes rendent le même corps sur les deux moteurs', { skip }, () => {
  const run = runHarness();
  assert.equal(run.code, 0, `${run.stdout}\n${run.stderr || ''}`);

  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  assert.ok(report.compared >= 4, 'le rapport couvre les requêtes par défaut');
  assert.equal(report.divergent, 0, JSON.stringify(report.results.filter((result) => !result.identical), null, 2));
  assert.ok(report.results.every((result) => result.statuses.mysql === result.statuses.postgres));

  // Un 404/404 des deux côtés « coïncide » aussi : sans cette assertion, le
  // test passerait sur des bases vides et ne comparerait aucun contenu.
  const film = report.results.find((result) => result.path === `/api/admin/links/movie/${FILM_ID}`);
  const episode = report.results.find((result) => result.path.includes('season=1'));
  assert.deepEqual(film.statuses, { mysql: 200, postgres: 200 }, 'le film de test est servi par les deux moteurs');
  assert.deepEqual(episode.statuses, { mysql: 200, postgres: 200 }, 'l’épisode de test est servi par les deux moteurs');
});

test('une ligne altérée côté PostgreSQL est signalée par le harnais', { skip }, async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  await client.query(
    "UPDATE films SET links = '[{\"url\":\"https://autre.test/b.m3u8\",\"quality\":\"480p\"}]'::json WHERE id = $1",
    [FILM_ID],
  );

  const run = runHarness();
  assert.equal(run.code, 1, 'le harnais doit échouer en cas de divergence');

  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const film = report.results.find((result) => result.path === `/api/admin/links/movie/${FILM_ID}`);
  assert.ok(film, 'le rapport contient la requête sur le film');
  assert.equal(film.identical, false);
  assert.ok(
    film.differences.some((difference) => difference.path.includes('links')),
    `divergence localisée dans les liens : ${JSON.stringify(film.differences)}`,
  );

  // Restauration plutôt que suppression : le transfert incrémental ne recrée
  // pas une ligne absente de la cible, et laisser le trou ferait échouer la
  // réexécution du test au lieu de repartir d'un état propre.
  await client.query(
    'UPDATE films SET links = $1::json WHERE id = $2',
    [JSON.stringify([{ url: 'https://exemple.test/a.m3u8', quality: '1080p', added_by: 'u1' }]), FILM_ID],
  );
  await client.end();
});
