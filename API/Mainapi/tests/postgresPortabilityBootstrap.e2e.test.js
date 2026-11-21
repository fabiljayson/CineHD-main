/**
 * Portabilité PostgreSQL : bootstrap, routeurs injectés, clone-links, ban en masse.
 *
 * Reproduire (depuis API/Mainapi/) :
 *   timeout --kill-after=10s 150s env DATABASE_MIGRATION_URL='postgres://postgres@127.0.0.1:55438/cinehd_ovw' \
 *     node --test --test-timeout=20000 tests/postgresPortabilityBootstrap.e2e.test.js
 *
 * Prérequis : PostgreSQL 16 jetable déjà migré, MySQL mort sur 127.0.0.1:6390.
 * Données : identifiants préfixés `pwb-<stamp>`, créés puis effacés par le test ;
 * aucun secret, aucune donnée de production. Redis n'est pas requis.
 *
 * Ce que ce test prouve, et qui échoue avec MySQL injoignable :
 *   - `app.js` démarre sans exécuter le moindre DDL MySQL ;
 *   - les quatre routeurs injectés reçoivent le pool de dialecte ;
 *   - wishboard / link submissions / top10 parlent PostgreSQL (fenêtres 24-48-30 j,
 *     identifiants générés, `affectedRows`, comptage d'épisodes) ;
 *   - clone-links upsert sans `CREATE TABLE`/`SHOW TABLES`/`INSERT IGNORE` runtime ;
 *   - le bannissement en masse reste idempotent quand le SQLSTATE de doublon change.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret';
process.env.DB_DRIVER = 'postgres';
process.env.NODE_ENV = 'test';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '6390';
if (process.env.DATABASE_MIGRATION_URL) process.env.DATABASE_URL = process.env.DATABASE_MIGRATION_URL;
// Pas d'appel réseau Uqload/TMDB : les chemins d'erreur écrivent en base.
process.env.UQLOAD_API_KEY = '';
process.env.CLONE_LINKS_FAILED_RETRY_MS = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const express = require('express');

const PG_URL = process.env.DATABASE_MIGRATION_URL;
const skip = PG_URL ? false : 'DATABASE_MIGRATION_URL requis (PostgreSQL jetable)';

const STAMP = Date.now().toString(36);
const USER = `pwb-user-${STAMP}`;
const ADMIN = `pwb-admin-${STAMP}`;
const BAN_ROUTE_USER = `pwb-banroute-${STAMP}`;
const SESSION = `pwb-session-${STAMP}`;
const ADMIN_SESSION = `pwb-adminsession-${STAMP}`;
const PROFILE = `pwb-profile-${STAMP}`;
const TMDB_ID = 9100;
const SOURCE_CODE = `pwbclone${STAMP}`;
const WISHBOARD_TMDB_ID = 9101;
const CLONE_TMDB_ID = 9102;

const USER_DATA_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), 'cinehd-portability-e2e-'));
process.env.USER_DATA_DIR = USER_DATA_DIR;
const WISHBOARD_USER_FILE = path.join(__dirname, '..', 'data', 'users', `bip39-${USER}.json`);

let server;
let pool;
let token;
let adminToken;

function call(method, route, body, authToken = null) {
  const payload = body ? JSON.stringify(body) : null;
  const headers = {};
  if (payload) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(payload);
  }
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  headers['x-profile-id'] = PROFILE;

  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: '127.0.0.1', port: server.address().port, path: route, method, headers, agent: false },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('end', () => {
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = text;
          }
          resolve({ status: response.statusCode, body: parsed });
        });
      },
    );
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

before(async () => {
  if (!PG_URL) return;

  const migrate = () => execFileSync(
    process.execPath,
    [path.join(__dirname, '..', 'db', 'migratePostgres.js')],
    { env: { ...process.env, DATABASE_MIGRATION_URL: PG_URL }, stdio: 'pipe' },
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

  // Les recherches TMDB ne font pas partie du portage : on les neutralise avant
  // que app.js ne requière les routeurs (ils captent la fonction à l'import).
  const tmdbCache = require('../utils/tmdbCache');
  tmdbCache.fetchTmdbDetails = async () => null;

  // app.js démarre un subscriber Redis dédié : ce test ne s'en sert pas.
  require('../utils/oauthClientsDb').startClientsCacheSubscriber = () => {};

  // Profils disque : wishboard lit sous __dirname/data, link submissions sous
  // USER_DATA_DIR. Les deux sont nécessaires aux contrôles d'appartenance.
  await fs.mkdir(path.dirname(WISHBOARD_USER_FILE), { recursive: true });
  await fs.mkdir(path.join(USER_DATA_DIR, 'users'), { recursive: true });
  const profileData = JSON.stringify({ profiles: [{ id: PROFILE, name: 'Profil portabilité' }] });
  await fs.writeFile(WISHBOARD_USER_FILE, profileData);
  await fs.writeFile(path.join(USER_DATA_DIR, 'users', `bip39-${USER}.json`), profileData);

  const { app, appReady } = require('../app');
  appReady.catch(() => {}); // évite un unhandledRejection avant le await ci-dessous
  await appReady; // ÉCHEC EN ROUGE ICI : initPool() + DDL MySQL avec MySQL mort.

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  pool = require('../db/dialect').getPool();

  await pool.execute('DELETE FROM user_sessions WHERE id IN (?, ?)', [SESSION, ADMIN_SESSION]);
  await pool.execute(
    'INSERT INTO user_sessions (id, user_id, user_type, created_at) VALUES (?, ?, ?, NOW()), (?, ?, ?, NOW())',
    [SESSION, USER, 'bip39', ADMIN_SESSION, ADMIN, 'bip39'],
  );
  await pool.execute('DELETE FROM admins WHERE user_id = ?', [ADMIN]);
  await pool.execute(
    "INSERT INTO admins (user_id, auth_type, role) VALUES (?, 'bip-39', 'admin')",
    [ADMIN],
  );
  await pool.execute('DELETE FROM banned_users WHERE ban_value = ?', [BAN_ROUTE_USER]);
  await pool.execute('DELETE FROM wrapped_viewing_data WHERE content_id IN (?, ?)', [`tv-${STAMP}`, `movie-${STAMP}`]);
  await pool.execute('DELETE FROM clone_links WHERE source_file_code = ?', [SOURCE_CODE]);
  await pool.execute(
    'DELETE FROM wishboard_status_history WHERE request_id IN (SELECT id FROM wishboard_requests WHERE tmdb_id = ?)',
    [WISHBOARD_TMDB_ID],
  );
  await pool.execute('DELETE FROM wishboard_requests WHERE tmdb_id = ?', [WISHBOARD_TMDB_ID]);

  const year = new Date().getFullYear();
  await pool.execute(
    `INSERT INTO wrapped_viewing_data
       (user_id, profile_id, content_type, content_id, content_title, season_number, episode_number,
        watch_duration, created_at, hour_of_day, month, year)
     VALUES (?, ?, 'tv', ?, 'Serie portabilite', 1, 2, 600, NOW(), 12, ?, ?)`,
    [USER, PROFILE, `tv-${STAMP}`, new Date().getMonth() + 1, year],
  );

  const { issueJwt } = require('../middleware/auth');
  token = issueJwt('bip39', USER, SESSION);
  adminToken = issueJwt('bip39', ADMIN, ADMIN_SESSION);
});

after(async () => {
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.close(resolve);
    server.closeAllConnections?.();
  });
  await fs.rm(USER_DATA_DIR, { recursive: true, force: true }).catch(() => {});
  await fs.rm(WISHBOARD_USER_FILE, { force: true }).catch(() => {});
  // Le test insère une ligne tv/movie par exécution : sans nettoyage elles
  // s'accumulent et finissent par pousser la ligne courante hors du top 10.
  if (pool) {
    await pool.execute('DELETE FROM wrapped_viewing_data WHERE content_id IN (?, ?)', [`tv-${STAMP}`, `movie-${STAMP}`]);
  }
  require('../config/redis').redis.disconnect();
  await require('../postgresPool').closePostgresPool().catch(() => {});
});

test('app.js démarre avec MySQL mort : les migrations détiennent le schéma', { skip }, async () => {
  const dialect = require('../db/dialect');
  assert.equal(dialect.isPostgres(), true);

  const response = await call('GET', '/api/top10/stats?type=movies&period=day', null, null);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(typeof response.body.stats.totalSessions, 'number');
});

test('wishboard : création, id généré, fenêtres 48 h / 30 j et historique', { skip }, async () => {
  const created = await call('POST', '/api/wishboard', { tmdb_id: WISHBOARD_TMDB_ID, media_type: 'movie' }, token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(typeof created.body.id, 'number', 'RETURNING/insertId rend un identifiant numérique');
  assert.ok(created.body.id > 0);

  const listed = await call('GET', '/api/wishboard', null, null);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.ok(listed.body.stats.total >= 1);

  const updated = await call('PUT', `/api/wishboard/admin/${created.body.id}/status`, { status: 'added' }, adminToken);
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(typeof updated.body.historyId, 'number');
});

test('link submissions : limite 24 h, insertion et suppression idempotente', { skip }, async () => {
  const limits = await call('GET', '/api/link-submissions/limits', null, token);
  assert.equal(limits.status, 200, JSON.stringify(limits.body));
  assert.equal(limits.body.movies.count, 0);

  const created = await call('POST', '/api/link-submissions', {
    tmdb_id: TMDB_ID,
    media_type: 'movie',
    url: `https://exemple.test/film-${STAMP}`,
  }, token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(typeof created.body.id, 'number');

  const removed = await call('DELETE', `/api/link-submissions/${created.body.id}`, null, token);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  const again = await call('DELETE', `/api/link-submissions/${created.body.id}`, null, token);
  assert.equal(again.status, 404, 'affectedRows=v0 est lu comme "aucune ligne supprimée"');
});

test('top10 période courte : COUNT(DISTINCT ...) des épisodes reste portable', { skip }, async () => {
  const response = await call('GET', '/api/top10/tv?period=day', null, null);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const entry = response.body.top10.find((item) => item.contentId === `tv-${STAMP}`);
  assert.ok(entry, 'la série vue aujourd’hui apparaît dans la fenêtre journalière');
  assert.equal(entry.episodesWatched, 1, 'un seul couple saison/épisode distinct');
});

test('recommandations personnalisées : le routeur injecté interroge PostgreSQL', { skip }, async () => {
  const response = await call('GET', `/api/recommendations/personalized?profileId=${encodeURIComponent(PROFILE)}`, null, token);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.success, true);
  assert.ok(Array.isArray(response.body.becauseYouWatched));
});

test('clone-links : upsert idempotent sans DDL runtime ni MySQL', { skip }, async () => {
  const cloneLinks = require('../utils/cloneLinks');
  await assert.doesNotReject(() => cloneLinks.ensureCloneLinksStorage());

  const playerLinks = [{ decoded_url: `https://uqload.is/embed-${SOURCE_CODE}.html` }];
  const scope = { mediaType: 'movie', tmdbId: CLONE_TMDB_ID, playerLinks };
  await cloneLinks.syncCloneLinksForPlayerLinks(scope);

  const first = await pool.execute(
    'SELECT status, last_checked_at FROM clone_links WHERE source_file_code = ?',
    [SOURCE_CODE],
  );
  assert.equal(first[0].length, 1, 'une seule ligne après le premier passage');
  assert.equal(first[0][0].status, 'failed', 'sans clé Uqload, l’échec est persisté');

  await new Promise((resolve) => setTimeout(resolve, 25));
  await cloneLinks.syncCloneLinksForPlayerLinks(scope);

  const second = await pool.execute(
    'SELECT COUNT(*) AS n, MAX(last_checked_at) AS checked FROM clone_links WHERE source_file_code = ?',
    [SOURCE_CODE],
  );
  assert.equal(second[0][0].n, 1, 'le second passage ne crée pas de doublon');
  assert.ok(
    new Date(second[0][0].checked).getTime() > new Date(first[0][0].last_checked_at).getTime(),
    'le second passage met à jour la ligne existante',
  );
});

test('route admin delete-duplicates : INSERT IGNORE porté en ON CONFLICT DO NOTHING', { skip }, async () => {
  const comments = await pool.execute(
    `INSERT INTO comments (content_type, content_id, user_id, user_type, username, content, created_at, deleted)
     VALUES ('movie', ?, ?, 'bip39', 'Spammeur', 'doublon', ?, 0),
            ('movie', ?, ?, 'bip39', 'Spammeur', 'doublon', ?, 0)
     RETURNING id`,
    [`movie-${STAMP}`, BAN_ROUTE_USER, Date.now(), `movie-${STAMP}`, BAN_ROUTE_USER, Date.now()],
  );
  const ids = comments[0].map((row) => row.id);

  const first = await call('POST', '/api/comments/admin/delete-duplicates', {
    commentIds: ids, banAuthors: true, banReason: 'spam e2e',
  }, adminToken);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.bannedCount, 1);

  const again = await call('POST', '/api/comments/admin/delete-duplicates', {
    commentIds: ids, banAuthors: true, banReason: 'spam e2e',
  }, adminToken);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.bannedCount, 0, 'le ban existant est reconnu au rejeu');

  const bans = await pool.execute(
    'SELECT COUNT(*) AS n FROM banned_users WHERE ban_type = ? AND ban_value = ? AND user_type = ?',
    ['user', BAN_ROUTE_USER, 'bip39'],
  );
  assert.equal(bans[0][0].n, 1);
});
