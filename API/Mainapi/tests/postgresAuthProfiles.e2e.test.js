/**
 * Authentification, isolation des profils et restriction d'âge, via les vraies
 * routes et un PostgreSQL réel.
 *
 *   docker run -d --name cinehd-auth-dst -e POSTGRES_PASSWORD=pw -p 55438:5432 postgres:16-alpine
 *   docker run -d --name cinehd-auth-redis -p 55439:6379 redis:7-alpine
 *   JWT_SECRET=test-only \
 *   DATABASE_URL='postgres://postgres:pw@127.0.0.1:55438/cinehd_auth' \
 *   DATABASE_MIGRATION_URL='postgres://postgres:pw@127.0.0.1:55438/cinehd_auth' \
 *   REDIS_HOST=127.0.0.1 REDIS_PORT=55439 \
 *     node --test tests/postgresAuthProfiles.e2e.test.js
 *
 * Ce que le test regarde est ce que l'utilisateur voit : statut HTTP, jeton,
 * profil renvoyé, refus d'un profil qui ne lui appartient pas. Pas la forme des
 * requêtes.
 *
 * Les comptes de test s'appuient sur les fichiers de données du service
 * (`data/users`), comme en production : une session valide exige un compte de
 * secours lisible, pas seulement une ligne SQL.
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

const USERS_DIR = path.join(__dirname, '..', 'data', 'users');
const USER_A = 'auth-user-a';
const USER_B = 'auth-user-b';
const CODE_A = 'CINE-11111-22222-33333';

let server;
let pool;
let createdFiles = [];

async function writeUserFile(userId, data) {
  await fs.mkdir(USERS_DIR, { recursive: true });
  const file = path.join(USERS_DIR, `bip39-${userId}.json`);
  await fs.writeFile(file, JSON.stringify(data));
  createdFiles.push(file);
}

function tokenFor(userId, sessionId) {
  const { issueJwt } = require('../middleware/auth');
  return issueJwt('bip39', userId, sessionId);
}

// `fetch` laisse des sockets keep-alive qui empêchent le processus de test de
// se terminer : une requête par socket, sans pool, et la sortie est déterministe.
function call(method, route, { token, body } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (payload) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = Buffer.byteLength(payload);
  }

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

  execFileSync(process.execPath, [path.join(__dirname, '..', 'db', 'migratePostgres.js')], {
    env: { ...process.env, DATABASE_MIGRATION_URL: PG_URL },
    stdio: 'pipe',
  });

  const { Client } = require('pg');
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  const { hashAccountCode, normalizeAccountCode } = require('../utils/accountCredentials');

  await client.query('DELETE FROM user_sessions');
  await client.query('DELETE FROM account_credentials');
  await client.query('DELETE FROM account_links');
  await client.query(
    `INSERT INTO account_credentials (user_id, code_hash, username, active)
     VALUES ($1, $2, 'compte-a', 1)`,
    [USER_A, hashAccountCode(normalizeAccountCode(CODE_A))],
  );
  // Une liaison lue plus bas par `GET /api/auth/links` : elle prouve que
  // `account_links` est interrogée dans PostgreSQL, pas dans MySQL.
  await client.query(
    `INSERT INTO account_links (provider, provider_user_id, target_user_type, target_user_id)
     VALUES ('google', 'google-1', 'bip39', $1)`,
    [USER_A],
  );
  await client.end();

  await writeUserFile(USER_A, {
    bip39_auth: 'true',
    profiles: [{ id: 'profile-a1', name: 'Alice', avatar: '/avatars/a.png', ageRestriction: 7, isDefault: true }],
  });
  await writeUserFile(USER_B, {
    bip39_auth: 'true',
    profiles: [{ id: 'profile-b1', name: 'Bruno', avatar: '/avatars/b.png', ageRestriction: 0, isDefault: true }],
  });

  // Redis est requis par le limiteur de débit des routes d'authentification,
  // qui échoue fermé : sans lui, la connexion ne peut pas être testée. Ce Redis
  // est jetable, et le compteur (10 tentatives / 15 min) survivrait d'une
  // exécution à l'autre : on le vide pour que le test soit rejouable.
  const { redis } = require('../config/redis');
  await redis.ping();
  await redis.flushdb();

  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/authRoutes'));
  app.use('/api/sessions', require('../routes/sessions'));
  app.use('/api/profiles', require('../routes/profiles'));

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });

  const dialect = require('../db/dialect');
  pool = dialect.getPool();
});

after(async () => {
  // `fetch` garde des sockets keep-alive : sans fermeture explicite, `close`
  // n'appelle jamais son callback et le processus de test ne rend pas la main.
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.close(resolve);
    server.closeAllConnections?.();
  });
  for (const file of createdFiles) await fs.unlink(file).catch(() => {});
  await require('../postgresPool').closePostgresPool().catch(() => {});
  require('../config/redis').redis.disconnect();
});

test('la connexion par code crée une session réelle et renvoie un jeton', { skip }, async () => {
  const response = await call('POST', '/api/auth/account/login', { body: { code: CODE_A } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.ok(response.body.token, 'un jeton est renvoyé');
  assert.equal(String(response.body.userId), USER_A);

  // La session doit exister dans PostgreSQL, pas seulement dans la réponse.
  const [rows] = await pool.execute('SELECT id, user_id FROM user_sessions WHERE user_id = ?', [USER_A]);
  assert.equal(rows.length, 1, 'une session est créée en base');
});

test('un code invalide est refusé sans révéler que le compte existe', { skip }, async () => {
  const wrong = await call('POST', '/api/auth/account/login', { body: { code: 'CINE-99999-88888-77777' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.success, false);
  assert.equal(wrong.body.token, undefined);
  assert.match(wrong.body.error, /invalide/i);
});

test('la session renvoyée par la connexion ouvre les routes protégées', { skip }, async () => {
  const login = await call('POST', '/api/auth/account/login', { body: { code: CODE_A } });
  assert.equal(login.status, 200);

  const sessions = await call('GET', '/api/sessions', { token: login.body.token });
  assert.equal(sessions.status, 200, JSON.stringify(sessions.body));
  assert.ok(sessions.body.data.count >= 1);
  assert.match(sessions.body.data.items[0].createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('un jeton sans session en base ne donne accès à rien', { skip }, async () => {
  const orphan = tokenFor(USER_A, 'session-qui-nexiste-pas');
  const response = await call('GET', '/api/profiles', { token: orphan });
  assert.equal(response.status, 401, 'la validation exige la ligne de session');
});

test('chaque utilisateur ne voit que ses propres profils', { skip }, async () => {
  const [rowA] = await pool.execute('SELECT id FROM user_sessions WHERE user_id = ? LIMIT 1', [USER_A]);
  const [rowB] = await pool.execute('SELECT id FROM user_sessions WHERE user_id = ? LIMIT 1', [USER_B]);

  if (!rowB.length) {
    // La session de B est créée directement : ce test vérifie l'isolation, pas
    // la connexion, déjà couverte plus haut.
    await pool.execute(
      'INSERT INTO user_sessions (id, user_id, user_type, device, user_agent) VALUES (?, ?, ?, ?, ?)',
      ['session-b', USER_B, 'bip39', '{}', 'test'],
    );
  }

  const tokenA = rowA.length ? tokenFor(USER_A, rowA[0].id) : null;
  const tokenB = rowB.length ? tokenFor(USER_B, rowB[0].id) : tokenFor(USER_B, 'session-b');

  const profilesA = await call('GET', '/api/profiles', { token: tokenA });
  const profilesB = await call('GET', '/api/profiles', { token: tokenB });

  assert.equal(profilesA.status, 200);
  assert.equal(profilesB.status, 200);
  assert.deepEqual(profilesA.body.profiles.map((p) => p.id), ['profile-a1']);
  assert.deepEqual(profilesB.body.profiles.map((p) => p.id), ['profile-b1']);

  // B ne peut pas supprimer le profil de A, même en connaissant son identifiant.
  const attack = await call('DELETE', '/api/profiles/profile-a1', { token: tokenB });
  assert.equal(attack.status, 404, 'un profil étranger est introuvable, pas supprimé');

  const stillThere = await call('GET', '/api/profiles', { token: tokenA });
  assert.deepEqual(stillThere.body.profiles.map((p) => p.id), ['profile-a1'], 'le profil de A est intact');
});

test('la restriction d’âge est validée à la création et à la mise à jour', { skip }, async () => {
  const [row] = await pool.execute('SELECT id FROM user_sessions WHERE user_id = ? LIMIT 1', [USER_A]);
  const token = tokenFor(USER_A, row[0].id);

  const created = await call('POST', '/api/profiles', {
    token,
    body: { name: 'Enfant', avatar: '/avatars/e.png', ageRestriction: 12 },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.profile.ageRestriction, 12);

  // Valeur hors barème : ramenée à 0, jamais stockée telle quelle.
  const invalid = await call('POST', '/api/profiles', {
    token,
    body: { name: 'Bizarre', avatar: '/avatars/f.png', ageRestriction: 99 },
  });
  assert.equal(invalid.status, 200);
  assert.equal(invalid.body.profile.ageRestriction, 0);

  const updated = await call('PUT', `/api/profiles/${created.body.profile.id}`, {
    token,
    body: { ageRestriction: 18 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.profile.ageRestriction, 18);

  const listed = await call('GET', '/api/profiles', { token });
  const stored = listed.body.profiles.find((p) => p.id === created.body.profile.id);
  assert.equal(stored.ageRestriction, 18, 'la restriction survit à la relecture');
});

test('les liaisons de compte sont lues dans PostgreSQL', { skip }, async () => {
  const [row] = await pool.execute('SELECT id FROM user_sessions WHERE user_id = ? LIMIT 1', [USER_A]);
  const token = tokenFor(USER_A, row[0].id);

  const response = await call('GET', '/api/auth/links', { token });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.links.google.linked, true, 'la liaison semée en base est visible');
  assert.equal(response.body.links.google.providerUserId, 'google-1');
  assert.equal(response.body.links.discord.linked, false);
});

test('une route protégée sans jeton répond 401, jamais 200', { skip }, async () => {
  for (const route of ['/api/profiles', '/api/sessions']) {
    const response = await call('GET', route);
    assert.equal(response.status, 401, `${route} doit exiger un jeton`);
  }
});
