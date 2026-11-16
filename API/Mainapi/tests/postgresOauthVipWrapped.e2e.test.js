/**
 * OAuth, VIP et Wrapped servis par PostgreSQL.
 *
 *   docker run -d --name cinehd-ovw-pg -e POSTGRES_PASSWORD=pw -p 55438:5432 postgres:16-alpine
 *   JWT_SECRET=test-only \
 *   DATABASE_MIGRATION_URL='postgres://postgres:pw@127.0.0.1:55438/cinehd_ovw' \
 *     node --test tests/postgresOauthVipWrapped.e2e.test.js
 *
 * Ce que ce test couvre : les deux upserts OAuth (client enregistré, demande
 * d'autorisation) que MySQL écrit en `ON DUPLICATE KEY`, et l'identité générée
 * d'une facture VIP, qui n'existe sur PostgreSQL que par `RETURNING`.
 *
 * Aucun MySQL joignable : `DB_PORT` pointe un port fermé.
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
const { execFileSync } = require('node:child_process');

const PG_URL = process.env.DATABASE_MIGRATION_URL;
const skip = PG_URL ? false : 'DATABASE_MIGRATION_URL requis (PostgreSQL jetable)';

const CLIENT_ID = `client-${Date.now().toString(36)}`;

let pool;

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

  pool = require('../db/dialect').getPool();
});

after(async () => {
  await require('../postgresPool').closePostgresPool().catch(() => {});
});

test('les deux upserts OAuth mettent à jour au lieu de dupliquer', { skip }, async () => {
  const { upsertOauthClient } = require('../db/oauthSql');
  const { upsertAuthorizationRequest } = require('../db/oauthSql');

  await pool.execute(
    upsertOauthClient(),
    [CLIENT_ID, 'Client E2E', null, null, '[]', '[]', 1, 1, null, 1000, 1000],
  );
  await pool.execute(
    upsertOauthClient(),
    [CLIENT_ID, 'Client E2E', null, null, '[]', '[]', 1, 1, null, 1000, 2000],
  );

  const clients = await pool.execute('SELECT updated_at FROM oauth_clients WHERE client_id = ?', [CLIENT_ID]);
  assert.equal(clients[0].length, 1, 'un seul client malgré deux enregistrements');
  assert.equal(Number(clients[0][0].updated_at), 2000);

  const request = {
    clientId: CLIENT_ID,
    redirectUri: 'https://exemple.test/cb',
    responseType: 'code',
    scopes: ['openid'],
    state: 'state-1',
    codeChallenge: 'challenge',
    codeChallengeMethod: 'S256',
  };
  await pool.execute(upsertAuthorizationRequest(), [
    'hash-e2e-1', request.clientId, request.redirectUri, request.responseType,
    'openid', request.state, request.codeChallenge, request.codeChallengeMethod,
    new Date(Date.now() + 60000),
  ]);
  await pool.execute(upsertAuthorizationRequest(), [
    'hash-e2e-1', request.clientId, request.redirectUri, request.responseType,
    'openid', request.state, request.codeChallenge, request.codeChallengeMethod,
    new Date(Date.now() + 120000),
  ]);

  const requests = await pool.execute(
    'SELECT COUNT(*) AS total FROM oauth_authorization_requests WHERE request_hash = ?',
    ['hash-e2e-1'],
  );
  // COUNT revient en nombre : sans le parseur int8, la comparaison porterait
  // sur la chaîne "1".
  assert.equal(requests[0][0].total, 1);
});

test('une facture VIP relue par son identifiant généré', { skip }, async () => {
  const { insertReturningId } = require('../db/pgCompat');
  const { randomUUID } = require('node:crypto');
  const publicId = `pub-${randomUUID().slice(0, 8)}`;

  const id = await insertReturningId(
    pool,
    `INSERT INTO vip_invoices
       (public_id, payment_method, status, pack_eur, amount_eur, amount_usd,
        vip_years, recipient_mode, expires_at)
     VALUES (?, 'btc', 'awaiting_payment', 10, 10, 11, 1, 'self', NOW() + INTERVAL '1 hour')`,
    [publicId],
  );

  assert.equal(typeof id, 'number');
  assert.ok(id > 0, 'RETURNING rend un identifiant');

  const rows = await pool.execute('SELECT public_id FROM vip_invoices WHERE id = ?', [id]);
  assert.equal(rows[0].length, 1);
  assert.equal(rows[0][0].public_id, publicId);
});
