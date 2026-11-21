/**
 * Wave 2 — cluster transactionnel abonnements servis par PostgreSQL.
 *
 * Reproduce (PostgreSQL jetable + stub RESP, MySQL mort) :
 *   timeout --kill-after=10s 220s env \
 *     DATABASE_MIGRATION_URL='postgres://postgres@127.0.0.1:55438/cinehd_ovw' \
 *     REDIS_HOST=127.0.0.1 REDIS_PORT=55439 PAYMENT_MTN_MOMO_NUMBER=237600000000 \
 *     node --test --test-concurrency=1 --test-timeout=20000 \
 *     tests/postgresPortabilitySubscriptions.e2e.test.js
 *
 * Ce que ce test prouve, et qui ne se voit pas sur MySQL :
 *   - `POST /admin/subscriptions/transactions/:id/receipt` valide la demande et
 *     crée credential + reçu via les deux transactions séquentielles, avec un
 *     `insertId` qui n'existe pas sur le contrat pgCompat ;
 *   - le rejeu du reçu est un 409 avec le reçu existant (SQLSTATE 23505), sans
 *     créer de second credential ni de second reçu ;
 *   - `POST /admin/account-requests/:id/approve` utilise le MÊME helper
 *     `approveAccountRequest` et rend un `credentialId` numérique ;
 *   - tout cela avec `DB_PORT=6390` : aucun MySQL n'est joignable.
 *
 * Aucun secret : JWT de test, base jetable, données synthétiques.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret';
const STAMP = Date.now().toString(36).toUpperCase();
process.env.USER_DATA_DIR = `${require('node:os').tmpdir()}/cinehd-wave2-${STAMP}-${process.pid}`;
process.env.DB_DRIVER = 'postgres';
process.env.NODE_ENV = 'test';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '6390';
process.env.PAYMENT_MTN_MOMO_NUMBER = process.env.PAYMENT_MTN_MOMO_NUMBER || '237600000000';
if (process.env.DATABASE_MIGRATION_URL) process.env.DATABASE_URL = process.env.DATABASE_MIGRATION_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const express = require('express');

const PG_URL = process.env.DATABASE_MIGRATION_URL;
const skip = PG_URL ? false : 'DATABASE_MIGRATION_URL requis (PostgreSQL jetable)';

const REFERENCE_PREFIX = `SUB-E2E-${STAMP}`;
const ADMIN_USER = `sub-admin-${STAMP}`;
const ADMIN_SESSION = `sub-admin-session-${STAMP}`;
const PAYER_MSISDN = '237600000001';

let server;
let pool;
let adminToken;

function call(method, route, body, token) {
  const payload = body ? JSON.stringify(body) : null;
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
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

async function insertPendingRequest(reference, planId, amountFcfa) {
  const { insertReturningId } = require('../db/pgCompat');
  return insertReturningId(
    pool,
    `INSERT INTO account_requests
       (reference, plan_id, amount_fcfa, payment_method, payer_msisdn, username, status)
     VALUES (?, ?, ?, 'mtn_momo', ?, ?, 'pending')`,
    [reference, planId, amountFcfa, PAYER_MSISDN, `sub_user_${reference}`],
  );
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
      if (!/Connection terminated|ECONNREFUSED|the database system is starting up/i.test(detail) || attempt >= 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const { redis } = require('../config/redis');
  await redis.ping();
  await redis.flushdb();

  pool = require('../db/dialect').getPool();

  // Le profil disque est hors périmètre (écrit hors transaction, best effort) :
  // on le neutralise pour que le test ne dépende pas du USER_DATA_DIR du runner.
  const sync = require('../routes/sync');
  sync.readUserData = async () => null;
  sync.writeUserData = async () => {};

  // `middleware/auth.js` exige une identité stockée pour valider le JWT. On
  // écrit un profil bip39 synthétique dans un USER_DATA_DIR jetable : aucune
  // écriture dans le dépôt, aucun secret réel.
  const { USERS_DIR } = require('../utils/userDataPaths');
  fs.mkdirSync(USERS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(USERS_DIR, `bip39-${ADMIN_USER}.json`),
    JSON.stringify({ bip39_auth: 'true', profiles: [] }),
  );

  await pool.execute('DELETE FROM user_sessions WHERE id = ?', [ADMIN_SESSION]);
  await pool.execute(
    'INSERT INTO user_sessions (id, user_id, user_type, created_at) VALUES (?, ?, ?, NOW())',
    [ADMIN_SESSION, ADMIN_USER, 'bip39'],
  );
  await pool.execute('DELETE FROM admins WHERE user_id = ?', [ADMIN_USER]);
  await pool.execute(
    "INSERT INTO admins (user_id, auth_type, role) VALUES (?, 'bip-39', 'admin')",
    [ADMIN_USER],
  );

  const { issueJwt } = require('../middleware/auth');
  adminToken = issueJwt('bip39', ADMIN_USER, ADMIN_SESSION);

  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/accountRequests'));
  app.use('/api', require('../routes/adminSubscriptions'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
});

after(async () => {
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.close(resolve);
    server.closeAllConnections?.();
  });
  if (pool) {
    const like = `${REFERENCE_PREFIX}%`;
    await pool.execute(
      'DELETE FROM subscription_receipts WHERE request_id IN (SELECT id FROM account_requests WHERE reference LIKE ?)',
      [like],
    );
    await pool.execute(
      'DELETE FROM account_credentials WHERE request_id IN (SELECT id FROM account_requests WHERE reference LIKE ?)',
      [like],
    );
    await pool.execute('DELETE FROM account_requests WHERE reference LIKE ?', [like]);
    await pool.execute('DELETE FROM admins WHERE user_id = ?', [ADMIN_USER]);
    await pool.execute('DELETE FROM user_sessions WHERE id = ?', [ADMIN_SESSION]);
  }
  require('../config/redis').redis.disconnect();
  await require('../postgresPool').closePostgresPool().catch(() => {});
  fs.rmSync(process.env.USER_DATA_DIR, { recursive: true, force: true });
});

test('validation admin subscriptions : credential + reçu créés une seule fois', { skip }, async () => {
  const reference = `${REFERENCE_PREFIX}-A`;
  const requestId = await insertPendingRequest(reference, 'month', 5000);

  const response = await call('POST', `/api/admin/subscriptions/transactions/${requestId}/receipt`, null, adminToken);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.success, true);
  assert.equal(typeof response.body.code, 'string', 'le code en clair est servi une fois');
  assert.ok(response.body.code.length > 0);
  assert.equal(typeof response.body.userId, 'string');
  assert.ok(response.body.receipt?.id > 0, 'l’identifiant du reçu vient de RETURNING sur PostgreSQL');
  assert.equal(typeof response.body.receipt.publicId, 'string');
  assert.equal(response.body.request.status, 'approved');

  const [credentials] = await pool.execute(
    'SELECT id, user_id, request_id, subscription_expires_at FROM account_credentials WHERE request_id = ?',
    [requestId],
  );
  assert.equal(credentials.length, 1, 'une seule transaction de validation');
  assert.equal(Number(credentials[0].id), Number(response.body.request.credentialId));
  assert.notEqual(credentials[0].subscription_expires_at, null, 'le minuteur est démarré');

  const [receipts] = await pool.execute(
    'SELECT id, public_id, request_id FROM subscription_receipts WHERE request_id = ?',
    [requestId],
  );
  assert.equal(receipts.length, 1);
  assert.equal(Number(receipts[0].id), Number(response.body.receipt.id));

  // Rejeu : la demande est déjà approved, seul le reçu est retenté ; le
  // SQLSTATE 23505 doit être lu comme un doublon, pas comme une erreur serveur.
  const replay = await call('POST', `/api/admin/subscriptions/transactions/${requestId}/receipt`, null, adminToken);
  assert.equal(replay.status, 409, JSON.stringify(replay.body));
  assert.equal(replay.body.receipt?.id, response.body.receipt.id, 'le reçu existant est renvoyé');
  assert.equal(replay.body.receipt?.publicId, response.body.receipt.publicId);

  const [credentialsAfter] = await pool.execute(
    'SELECT id FROM account_credentials WHERE request_id = ?',
    [requestId],
  );
  const [receiptsAfter] = await pool.execute(
    'SELECT id FROM subscription_receipts WHERE request_id = ?',
    [requestId],
  );
  assert.equal(credentialsAfter.length, 1, 'le rejeu ne crée pas de second credential');
  assert.equal(receiptsAfter.length, 1, 'le rejeu ne crée pas de second reçu');
});

test('approbation account-requests : helper partagé, credentialId numérique et idempotent', { skip }, async () => {
  const reference = `${REFERENCE_PREFIX}-B`;
  const requestId = await insertPendingRequest(reference, 'week', 3000);

  const response = await call('POST', `/api/admin/account-requests/${requestId}/approve`, null, adminToken);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.success, true);
  assert.equal(typeof response.body.code, 'string');
  assert.equal(response.body.request.status, 'approved');
  assert.equal(typeof response.body.request.credentialId, 'number', 'credential_id relu après INSERT');
  assert.ok(response.body.request.credentialId > 0);

  const [credentials] = await pool.execute(
    'SELECT id, user_id FROM account_credentials WHERE request_id = ?',
    [requestId],
  );
  assert.equal(credentials.length, 1);
  assert.equal(Number(credentials[0].id), response.body.request.credentialId);

  const replay = await call('POST', `/api/admin/account-requests/${requestId}/approve`, null, adminToken);
  assert.equal(replay.status, 409, JSON.stringify(replay.body));
  assert.equal(replay.body.error, 'Cette demande est déjà validée.');

  const [credentialsAfter] = await pool.execute(
    'SELECT id FROM account_credentials WHERE request_id = ?',
    [requestId],
  );
  assert.equal(credentialsAfter.length, 1, 'une demande ne produit qu’un seul compte');
});
