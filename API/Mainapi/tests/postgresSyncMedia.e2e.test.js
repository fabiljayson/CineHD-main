/**
 * Synchronisation et lecture des liens media, via les vraies routes et un
 * PostgreSQL réel.
 *
 *   docker run -d --name cinehd-sync-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=cinehd_sync -p 55440:5432 postgres:16-alpine
 *   JWT_SECRET=test-only \
 *   DATABASE_MIGRATION_URL='postgres://postgres:pw@127.0.0.1:55440/cinehd_sync' \
 *     node --test tests/postgresSyncMedia.e2e.test.js
 *
 * Ce qui est vérifié :
 *
 * - **Conflits de synchronisation.** Deux écritures simultanées sur le même
 *   profil passent par le verrou consultatif PostgreSQL : sans lui, chacune lit
 *   le même instantané et la seconde écrase la première. Les clés des deux
 *   requêtes doivent survivre.
 * - **Lecture d'une ligne media.** `GET /links/:type/:id` lit `films` ou
 *   `series` dans le moteur sélectionné et renvoie les liens JSON, sans exposer
 *   l'identité de l'uploader (`added_by`).
 *
 * Les données de synchronisation vivent encore sur disque (`routes/sync.js`) :
 * PostgreSQL n'intervient que pour la session et le verrou. Le test nettoie les
 * fichiers qu'il crée.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret';
process.env.DB_DRIVER = 'postgres';
process.env.NODE_ENV = 'test';
if (process.env.DATABASE_MIGRATION_URL) process.env.DATABASE_URL = process.env.DATABASE_MIGRATION_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const express = require('express');

const PG_URL = process.env.DATABASE_MIGRATION_URL;
const skip = PG_URL ? false : 'DATABASE_MIGRATION_URL requis (PostgreSQL jetable)';

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const SYNC_USER = 'sync-e2e-user';
const SYNC_PROFILE = 'sync-e2e-profile';
const FILM_ID = 900001;
const SERIES_ID = 900002;

let server;
let pool;
let seedClient;
let token;

function call(method, route, { body, headers = {} } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  const requestHeaders = { ...headers };
  if (payload) {
    requestHeaders['content-type'] = 'application/json';
    requestHeaders['content-length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname: '127.0.0.1', port: server.address().port, path: route, method, headers: requestHeaders, agent: false },
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

function syncRequest(ops, profileId = SYNC_PROFILE) {
  return call('POST', '/api/sync', {
    headers: { authorization: `Bearer ${token}` },
    body: { userType: 'bip39', profileId, ops },
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
      const transient = /Connection terminated|ECONNREFUSED|the database system is starting up/i.test(detail);
      if (!transient || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  const { Client } = require('pg');
  seedClient = new Client({ connectionString: PG_URL });
  await seedClient.connect();
  await seedClient.query('DELETE FROM user_sessions WHERE user_id = $1', [SYNC_USER]);
  await seedClient.query('DELETE FROM films WHERE id = $1', [FILM_ID]);
  await seedClient.query('DELETE FROM series WHERE series_id = $1', [SERIES_ID]);

  const sessionId = 'session-sync-e2e';
  await seedClient.query(
    'INSERT INTO user_sessions (id, user_id, user_type, device, user_agent) VALUES ($1, $2, $3, $4, $5)',
    [sessionId, SYNC_USER, 'bip39', '{}', 'test'],
  );

  // Une ligne media par type : la route publique doit les lire dans PostgreSQL.
  await seedClient.query('INSERT INTO films (id, links) VALUES ($1, $2)', [
    FILM_ID,
    JSON.stringify([{ url: 'https://example.test/film.m3u8', added_by: 'uploader-1' }]),
  ]);
  await seedClient.query(
    `INSERT INTO series (series_id, season_number, episode_number, links) VALUES
       ($1, 1, 1, $2), ($1, 1, 2, $3)`,
    [
      SERIES_ID,
      JSON.stringify([{ url: 'https://example.test/s1e1.m3u8', added_by: 'uploader-1' }]),
      JSON.stringify([{ url: 'https://example.test/s1e2.m3u8', added_by: 'uploader-1' }]),
    ],
  );

  await fs.mkdir(USERS_DIR, { recursive: true });
  await fs.writeFile(
    path.join(USERS_DIR, `bip39-${SYNC_USER}.json`),
    JSON.stringify({
      bip39_auth: 'true',
      profiles: [{ id: SYNC_PROFILE, name: 'Sync', avatar: '/avatars/a.png', isDefault: true }],
    }),
  );

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', require('../routes/sync'));
  app.use('/api/admin', require('../routes/admin'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });

  const { issueJwt } = require('../middleware/auth');
  token = issueJwt('bip39', SYNC_USER, sessionId);
  pool = require('../db/dialect').getPool();
});

after(async () => {
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.close(resolve);
    server.closeAllConnections?.();
  });

  if (seedClient) {
    await seedClient.query('DELETE FROM user_sessions WHERE user_id = $1', [SYNC_USER]).catch(() => {});
    await seedClient.query('DELETE FROM films WHERE id = $1', [FILM_ID]).catch(() => {});
    await seedClient.query('DELETE FROM series WHERE series_id = $1', [SERIES_ID]).catch(() => {});
    await seedClient.end().catch(() => {});
  }

  await fs.rm(path.join(USERS_DIR, `bip39-${SYNC_USER}.json`), { force: true }).catch(() => {});
  await fs.rm(path.join(USERS_DIR, 'profiles', 'bip39', SYNC_USER), { recursive: true, force: true }).catch(() => {});
  await require('../postgresPool').closePostgresPool().catch(() => {});
  require('../config/redis').redis.disconnect();
});

test('une écriture de synchronisation est relue par la route de lecture', { skip }, async () => {
  // Les clés sont validées par `utils/syncPolicy` (liste blanche de préfixes) :
  // `progress_…` et `settings_…` font partie des clés réellement synchronisées.
  const write = await syncRequest([{ op: 'set', key: 'progress_900001', value: '{"position":42}' }]);
  assert.equal(write.status, 200, JSON.stringify(write.body));
  assert.equal(write.body.success, true);

  const read = await call('GET', `/api/sync/bip39/${SYNC_USER}/${SYNC_PROFILE}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.data.progress_900001, '{"position":42}');
});

test('des écritures concurrentes sur le même profil ne s’écrasent pas', { skip }, async () => {
  const keys = ['settings_concurrent_a', 'settings_concurrent_b', 'settings_concurrent_c', 'settings_concurrent_d'];

  // Sans le verrou consultatif, chaque requête lit le même instantané et la
  // dernière écriture efface les clés des autres.
  const responses = await Promise.all(
    keys.map((key) => syncRequest([{ op: 'set', key, value: `value-${key}` }])),
  );
  for (const response of responses) {
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }

  const read = await call('GET', `/api/sync/bip39/${SYNC_USER}/${SYNC_PROFILE}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(read.status, 200);
  for (const key of keys) {
    assert.equal(read.body.data[key], `value-${key}`, `${key} doit survivre à la concurrence`);
  }
});

test('un profil qui n’appartient pas à l’utilisateur est refusé', { skip }, async () => {
  const response = await syncRequest([{ op: 'set', key: 'progress_other', value: 'y' }], 'profil-d-un-autre');
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'PROFILE_NOT_FOUND');
});

test('la synchronisation exige un jeton', { skip }, async () => {
  const response = await call('POST', '/api/sync', {
    body: { userType: 'bip39', profileId: SYNC_PROFILE, ops: [{ op: 'set', key: 'progress_unauth', value: 'b' }] },
  });
  assert.equal(response.status, 401);
});

test('la lecture des liens d’un film vient de PostgreSQL et masque l’uploader', { skip }, async () => {
  const response = await call('GET', `/api/admin/links/movie/${FILM_ID}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.links.length, 1);
  assert.equal(response.body.data.links[0].url, 'https://example.test/film.m3u8');
  assert.equal(response.body.data.links[0].added_by, undefined, 'added_by ne doit pas sortir');
});

test('la lecture des liens d’une série renvoie les épisodes demandés', { skip }, async () => {
  const all = await call('GET', `/api/admin/links/tv/${SERIES_ID}`);
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.data.length, 2);

  const one = await call('GET', `/api/admin/links/tv/${SERIES_ID}?season=1&episode=2`);
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.data.length, 1);
  assert.equal(one.body.data[0].links[0].url, 'https://example.test/s1e2.m3u8');
});

test('une ligne media absente répond 404, pas une erreur', { skip }, async () => {
  const movie = await call('GET', '/api/admin/links/movie/999999999');
  assert.equal(movie.status, 404);
  assert.equal(movie.body.success, false);

  const series = await call('GET', '/api/admin/links/tv/999999999');
  assert.equal(series.status, 404);
});
