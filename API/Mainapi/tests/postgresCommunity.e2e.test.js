/**
 * Couche communauté servie par PostgreSQL : votes pour l'instant, les autres
 * domaines (commentaires, listes partagées) suivront le même modèle.
 *
 *   docker run -d --name cinehd-comm-pg -e POSTGRES_PASSWORD=pw -p 55438:5432 postgres:16-alpine
 *   JWT_SECRET=test-only \
 *   DATABASE_MIGRATION_URL='postgres://postgres:pw@127.0.0.1:55438/cinehd_comm' \
 *     node --test tests/postgresCommunity.e2e.test.js
 *
 * Ce qui n'est visible qu'ici : `COUNT(*)` revient en nombre et non en chaîne,
 * et un vote créé puis relu passe par `RETURNING` côté PostgreSQL. Aucun MySQL
 * n'est joignable (port fermé), donc un accès résiduel échouerait.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret';
process.env.DB_DRIVER = 'postgres';
process.env.NODE_ENV = 'test';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '6390';
if (process.env.DATABASE_MIGRATION_URL) process.env.DATABASE_URL = process.env.DATABASE_MIGRATION_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const express = require('express');

const PG_URL = process.env.DATABASE_MIGRATION_URL;
const skip = PG_URL ? false : 'DATABASE_MIGRATION_URL requis (PostgreSQL jetable)';

const USER = 'community-user';
const SESSION = 'community-session';
const CONTENT_ID = '4001';

let server;
let token;
let pool;

function call(method, route, body, auth = true) {
  const payload = body ? JSON.stringify(body) : null;
  const headers = {};
  if (payload) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(payload);
  }
  if (auth && token) headers.authorization = `Bearer ${token}`;

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

  const app = express();
  app.use(express.json());
  app.use('/api/likes', require('../likesRoutes'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });

  pool = require('../db/dialect').getPool();
  await pool.execute('DELETE FROM likes WHERE content_id = ?', [CONTENT_ID]);
  await pool.execute('DELETE FROM user_sessions WHERE id = ?', [SESSION]);
  await pool.execute(
    'INSERT INTO user_sessions (id, user_id, user_type, created_at) VALUES (?, ?, ?, NOW())',
    [SESSION, USER, 'bip39'],
  );

  const { issueJwt } = require('../middleware/auth');
  token = issueJwt('bip39', USER, SESSION);
});

after(async () => {
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.close(resolve);
    server.closeAllConnections?.();
  });
  await require('../postgresPool').closePostgresPool().catch(() => {});
});

test('un contenu sans vote renvoie des compteurs numériques', { skip }, async () => {
  const response = await call('GET', `/api/likes/movie/${CONTENT_ID}`, null, false);

  assert.equal(response.status, 200, JSON.stringify(response.body));
  // `COUNT(*)` est un bigint : sans parseur il arriverait en "0" et le client
  // comparerait une chaîne à un nombre.
  assert.equal(typeof response.body.likes, 'number');
  assert.equal(typeof response.body.dislikes, 'number');
  assert.equal(response.body.likes, 0);
  assert.equal(response.body.dislikes, 0);
  assert.equal(response.body.userVote, null);
});

test('un vote est créé, relu, puis retiré par un second vote identique', { skip }, async () => {
  const created = await call('POST', '/api/likes', {
    contentType: 'movie', contentId: CONTENT_ID, voteType: 'like',
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.likes, 1);

  const stored = await pool.execute('SELECT vote_type, user_id FROM likes WHERE content_id = ?', [CONTENT_ID]);
  assert.equal(stored[0].length, 1, 'le vote existe réellement en base');
  assert.equal(stored[0][0].vote_type, 'like');

  const mine = await call('GET', `/api/likes/movie/${CONTENT_ID}`);
  assert.equal(mine.body.likes, 1);
  assert.equal(mine.body.userVote, 'like');

  // Même vote = bascule : l'utilisateur retire son vote.
  const toggled = await call('POST', '/api/likes', {
    contentType: 'movie', contentId: CONTENT_ID, voteType: 'like',
  });
  assert.equal(toggled.status, 200, JSON.stringify(toggled.body));
  assert.equal(toggled.body.likes, 0);

  const empty = await pool.execute('SELECT COUNT(*) AS total FROM likes WHERE content_id = ?', [CONTENT_ID]);
  assert.equal(Number(empty[0][0].total), 0);
});

test('un vote contraire remplace le précédent au lieu de s’ajouter', { skip }, async () => {
  await call('POST', '/api/likes', { contentType: 'movie', contentId: CONTENT_ID, voteType: 'like' });
  const swapped = await call('POST', '/api/likes', { contentType: 'movie', contentId: CONTENT_ID, voteType: 'dislike' });

  assert.equal(swapped.status, 200, JSON.stringify(swapped.body));
  assert.equal(swapped.body.likes, 0);
  assert.equal(swapped.body.dislikes, 1);

  const rows = await pool.execute('SELECT COUNT(*) AS total FROM likes WHERE content_id = ?', [CONTENT_ID]);
  assert.equal(Number(rows[0][0].total), 1, 'un seul vote par utilisateur et par contenu');
});

test('un type de contenu inconnu est refusé, et voter exige un jeton', { skip }, async () => {
  const unknown = await call('POST', '/api/likes', { contentType: 'podcast', contentId: CONTENT_ID, voteType: 'like' });
  assert.equal(unknown.status, 400);

  const anonymous = await call('POST', '/api/likes', { contentType: 'movie', contentId: CONTENT_ID, voteType: 'like' }, false);
  assert.equal(anonymous.status, 401);
});
