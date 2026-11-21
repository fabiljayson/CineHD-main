/**
 * OAuth, VIP et Wrapped servis par PostgreSQL.
 *
 *   docker run -d --name cinehd-ovw-pg -e POSTGRES_PASSWORD=pw -p 55438:5432 postgres:16-alpine
 *   JWT_SECRET=test-only \
 *   DATABASE_MIGRATION_URL='postgres://postgres:pw@127.0.0.1:55438/cinehd_ovw' \
 *     node --test tests/postgresOauthVipWrapped.e2e.test.js
 *
 * Ce que ce test prouve, et qui ne se voit pas sur MySQL :
 *   - les deux upserts OAuth mettent à jour au lieu de dupliquer ;
 *   - les tables OAuth/VIP sont laissées aux migrations, pas au DDL MySQL ;
 *   - consentement, code, token et grant VIP survivent à un vrai pool
 *     PostgreSQL (verrous FOR UPDATE et transactions compris) ;
 *   - les callbacks de paiement restent idempotents quand le SQLSTATE de
 *     doublon change (23505 au lieu de ER_DUP_ENTRY) ;
 *   - les transitions VIP et les écritures Wrapped fonctionnent sans le moindre
 *     MySQL joignable.
 *
 * Aucun MySQL joignable : `DB_PORT` pointe un port fermé.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret';
process.env.VIP_PAYBLIS_SECRET_KEY = process.env.VIP_PAYBLIS_SECRET_KEY || 'test-only-payblis-secret';
process.env.DB_DRIVER = 'postgres';
process.env.NODE_ENV = 'test';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '6390';
if (process.env.DATABASE_MIGRATION_URL) process.env.DATABASE_URL = process.env.DATABASE_MIGRATION_URL;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const express = require('express');
const jwt = require('jsonwebtoken');

const PG_URL = process.env.DATABASE_MIGRATION_URL;
const skip = PG_URL ? false : 'DATABASE_MIGRATION_URL requis (PostgreSQL jetable)';

const STAMP = Date.now().toString(36);
const CLIENT_ID = `client-${STAMP}`;
const USER_ID = `oauth-user-${STAMP}`;
const WRAPPED_USER_ID = `wrapped-user-${STAMP}`;
const PROFILE_ID = `profile-${STAMP}`;
const YEAR = new Date().getFullYear();
const TOKEN = jwt.sign({ sub: WRAPPED_USER_ID, userType: 'oauth' }, process.env.JWT_SECRET, { algorithm: 'HS256' });

let pool;
let server;

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function call(method, route, body, extraHeaders = {}) {
  const payload = body ? JSON.stringify(body) : null;
  const headers = { ...extraHeaders };
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

async function insertVipInvoice(overrides = {}) {
  const { insertReturningId } = require('../db/pgCompat');
  const { toSqlDateTime } = require('../utils/vipDonations');
  const values = {
    publicId: `inv_${randomHex(12)}`,
    paymentMethod: 'btc',
    status: 'awaiting_payment',
    coin: 'btc',
    callbackReference: null,
    callbackNonce: null,
    temporaryWallet: null,
    cryptoExpected: 0.01,
    ...overrides,
  };

  return insertReturningId(
    pool,
    `INSERT INTO vip_invoices
       (public_id, payment_method, status, coin, pack_eur, amount_eur, amount_usd,
        vip_years, recipient_mode, expires_at, amount_crypto_expected,
        amount_crypto_received, required_confirmations,
        paygate_callback_reference, paygate_callback_nonce, paygate_temporary_wallet_address)
     VALUES (?, ?, ?, ?, 10, 10, 10, 1, 'self', ?, ?, 0, 1, ?, ?, ?)`,
    [
      values.publicId,
      values.paymentMethod,
      values.status,
      values.coin,
      toSqlDateTime(new Date(Date.now() + 60 * 60 * 1000)),
      values.cryptoExpected,
      values.callbackReference,
      values.callbackNonce,
      values.temporaryWallet,
    ],
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
      if (!/Connection terminated|ECONNREFUSED|the database system is starting up/i.test(detail) || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  pool = require('../db/dialect').getPool();

  const { router: wrappedRouter, initWrappedRoutes } = require('../wrappedRoutes');
  initWrappedRoutes(pool, null);
  const { router: payblisRouter } = require('../routes/vipPayblis');
  const app = express();
  app.use(express.json());
  app.use('/api/wrapped', wrappedRouter);
  app.use(payblisRouter);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
});

after(async () => {
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.close(resolve);
    server.closeAllConnections?.();
  });
  // Le store de rate limit Payblis ouvre un client Redis : sans disconnect,
  // ses reconnexions empêcheraient le runner de terminer.
  require('../config/redis').redis.disconnect();
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
  const { randomUUID } = require('node:crypto');
  const publicId = `pub-${randomUUID().slice(0, 8)}`;

  const id = await insertVipInvoice({ publicId });

  assert.equal(typeof id, 'number');
  assert.ok(id > 0, 'RETURNING rend un identifiant');

  const rows = await pool.execute('SELECT public_id FROM vip_invoices WHERE id = ?', [id]);
  assert.equal(rows[0].length, 1);
  assert.equal(rows[0][0].public_id, publicId);
});

test('le bootstrap OAuth et VIP laisse le schéma aux migrations sur PostgreSQL', { skip }, async () => {
  const oauthClientsDb = require('../utils/oauthClientsDb');
  const oauthStorage = require('../utils/oauthStorage');
  const vipDonations = require('../utils/vipDonations');

  await assert.doesNotReject(() => oauthClientsDb.ensureTables());
  await assert.doesNotReject(() => oauthStorage.ensureOAuthStorage());
  await assert.doesNotReject(() => vipDonations.ensureVipDonationsTables(pool));
});

test('consentement, code et token OAuth persistent et restent à usage unique', { skip }, async () => {
  const storage = require('../utils/oauthStorage');
  const request = {
    clientId: CLIENT_ID,
    redirectUri: 'https://exemple.test/cb',
    responseType: 'code',
    scopes: ['openid', 'profile.read'],
    state: `state-${STAMP}`,
    codeChallenge: 'challenge-e2e',
    codeChallengeMethod: 'S256',
  };

  const registered = await storage.registerAuthorizationRequest(pool, request);
  assert.equal(registered.clientId, CLIENT_ID);
  assert.deepEqual(registered.scopes, request.scopes);

  let authorizationCode;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const claimed = await storage.claimAuthorizationRequest(connection, request, 'approved');
    assert.equal(claimed.state, request.state);
    authorizationCode = await storage.createAuthorizationCode(connection, {
      ...request,
      userId: USER_ID,
      userType: 'oauth',
      sessionId: null,
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const replayConnection = await pool.getConnection();
  try {
    await replayConnection.beginTransaction();
    await assert.rejects(
      () => storage.claimAuthorizationRequest(replayConnection, request, 'approved'),
      /déjà été utilisée/,
    );
    await replayConnection.rollback();
  } finally {
    replayConnection.release();
  }

  const exchange = await storage.exchangeAuthorizationCode(pool, {
    code: authorizationCode.code,
    clientId: CLIENT_ID,
    redirectUri: request.redirectUri,
  });
  assert.equal(exchange.userId, USER_ID);
  assert.deepEqual(exchange.scopes, request.scopes);

  const token = await storage.getAccessTokenRecord(pool, exchange.accessToken);
  assert.equal(token.clientId, CLIENT_ID);
  assert.equal(token.userId, USER_ID);

  await assert.rejects(
    () => storage.exchangeAuthorizationCode(pool, {
      code: authorizationCode.code,
      clientId: CLIENT_ID,
      redirectUri: request.redirectUri,
    }),
    /déjà utilisé/,
  );
});

test('stats OAuth et grant VIP utilisent des transactions PostgreSQL', { skip }, async () => {
  const oauthClientsDb = require('../utils/oauthClientsDb');

  await pool.execute('UPDATE oauth_clients SET vip_days_balance = 7 WHERE client_id = ?', [CLIENT_ID]);
  await oauthClientsDb.recordEvent(CLIENT_ID, 'authorize_granted', USER_ID, { scopes: ['openid'] });

  const stats = await oauthClientsDb.getStats(CLIENT_ID, Date.now() - 60 * 60 * 1000);
  assert.equal(stats.byType.find((row) => row.event_type === 'authorize_granted')?.n, 1);
  assert.equal(stats.byDay[0]?.day, new Date().toISOString().slice(0, 10));

  const grant = await oauthClientsDb.grantVip({
    clientId: CLIENT_ID,
    userType: 'oauth',
    userId: USER_ID,
    days: 3,
  });
  assert.equal(grant.daysGranted, 3);
  assert.equal(grant.remainingBalance, 4);

  const clients = await pool.execute('SELECT vip_days_balance FROM oauth_clients WHERE client_id = ?', [CLIENT_ID]);
  assert.equal(clients[0][0].vip_days_balance, 4);

  const keys = await pool.execute('SELECT id FROM access_keys WHERE key_value = ?', [grant.accessKey]);
  assert.equal(keys[0].length, 1, 'la clé VIP est créée dans la transaction');
  const grants = await pool.execute('SELECT id FROM oauth_vip_grants WHERE access_key_value = ?', [grant.accessKey]);
  assert.equal(grants[0].length, 1, 'le grant est audité dans la transaction');
});

test('callback PayGate idempotent sur PostgreSQL', { skip }, async () => {
  const { handlePaygateCallback } = require('../utils/vipDonations');
  const callback = {
    reference: randomHex(24),
    nonce: randomHex(24),
    coin: 'polygon_usdc',
    value_coin: '11',
    value_forwarded_coin: '10.5',
    txid_in: `0x${randomHex(32)}`,
    txid_out: `0x${randomHex(32)}`,
    address_in: `0x${randomHex(20)}`,
  };
  const invoiceId = await insertVipInvoice({
    paymentMethod: 'paygate_hosted',
    coin: null,
    callbackReference: callback.reference,
    callbackNonce: callback.nonce,
    temporaryWallet: callback.address_in,
  });
  const deps = {
    paygateClient: { convertPaymentToUsd: async () => 10 },
  };

  const paid = await handlePaygateCallback(pool, callback, deps);
  assert.equal(paid.status, 'delivered');
  assert.ok(paid.vip_key_value, 'la clé VIP est livrée après validation du paiement');

  const replay = await handlePaygateCallback(pool, callback, deps);
  assert.equal(replay.status, 'delivered');
  assert.equal(replay.vip_key_value, paid.vip_key_value, 'le rejeu ne change pas la clé livrée');

  const events = await pool.execute(
    `SELECT COUNT(*) AS n FROM vip_invoice_events
      WHERE invoice_id = ? AND event_type = 'invoice_paygate_callback'`,
    [invoiceId],
  );
  assert.equal(events[0][0].n, 1, 'le rejeu ne crée pas un second événement de paiement');
});

test('transitions VIP admin : validation idempotente et annulation irréversible', { skip }, async () => {
  const { forceValidateInvoice, cancelInvoice } = require('../utils/vipDonations');
  const admin = { userId: `admin-${STAMP}` };

  const invoiceId = await insertVipInvoice({ cryptoExpected: 0.01 });
  const delivered = await forceValidateInvoice(pool, invoiceId, admin);
  assert.equal(delivered.status, 'delivered');
  assert.ok(delivered.vip_key_value);

  const deliveredAgain = await forceValidateInvoice(pool, invoiceId, admin);
  assert.equal(deliveredAgain.vip_key_value, delivered.vip_key_value);

  const accessKeys = await pool.execute('SELECT id FROM access_keys WHERE key_value = ?', [delivered.vip_key_value]);
  assert.equal(accessKeys[0].length, 1, 'une seule clé pour une facture validée deux fois');

  const cancelledId = await insertVipInvoice({ cryptoExpected: 0.02 });
  const cancelled = await cancelInvoice(pool, cancelledId, admin);
  assert.equal(cancelled.status, 'cancelled');

  const cancelledAgain = await cancelInvoice(pool, cancelledId, admin);
  assert.equal(cancelledAgain.status, 'cancelled');
  await assert.rejects(
    () => forceValidateInvoice(pool, cancelledId, admin),
    /annulée/,
  );
});

test('une clé VIP délivrée sur PostgreSQL est reconnue par checkVip', { skip }, async () => {
  const { verifyAccessKey } = require('../checkVip');
  const { forceValidateInvoice } = require('../utils/vipDonations');

  const invoiceId = await insertVipInvoice();
  const delivered = await forceValidateInvoice(pool, invoiceId, { userId: `admin-${STAMP}` });
  const status = await verifyAccessKey(delivered.vip_key_value);

  assert.equal(status.vip, true, 'la clé livrée par la base PostgreSQL ouvre l’accès VIP');
  assert.ok(status.expiresAt);
});

test('IPN Payblis livré et idempotent via le pool de dialecte', { skip }, async () => {
  const publicId = `pb_${randomHex(10)}`;
  const invoiceId = await insertVipInvoice({ publicId, paymentMethod: 'payblis', coin: null });
  const body = {
    merchant_reference: `mvx_${publicId}`,
    amount: '10',
    transaction_id: `txn-${randomHex(8)}`,
    status: 'SUCCESS',
  };
  const signature = crypto
    .createHmac('sha256', process.env.VIP_PAYBLIS_SECRET_KEY)
    .update(JSON.stringify(body), 'utf8')
    .digest('hex');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await call(
      'POST',
      `/vip/payblis/ipn?publicId=${publicId}`,
      body,
      { 'x-payblis-signature': signature },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.success, true);
  }

  const events = await pool.execute(
    `SELECT COUNT(*) AS n FROM vip_invoice_events
      WHERE invoice_id = ? AND event_type = 'invoice_payblis_ipn'`,
    [invoiceId],
  );
  assert.equal(events[0][0].n, 1, 'le rejeu IPN ne crée qu’un événement de paiement');

  const invoices = await pool.execute('SELECT status FROM vip_invoices WHERE id = ?', [invoiceId]);
  assert.equal(invoices[0][0].status, 'delivered');
});

test('Wrapped agrège les visionnages et les pages sans SQL MySQL', { skip }, async () => {
  const auth = { authorization: `Bearer ${TOKEN}` };
  const viewing = {
    userId: WRAPPED_USER_ID,
    type: 'viewing',
    month: 1,
    year: YEAR,
    contentType: 'movie',
    contentId: `movie-${STAMP}`,
    contentTitle: 'Film E2E',
    hourOfDay: 14,
  };
  const page = {
    userId: WRAPPED_USER_ID,
    type: 'page',
    month: 1,
    year: YEAR,
    pageName: 'home',
    meta: { source: 'e2e' },
  };

  for (const duration of [30, 25]) {
    const response = await call('POST', '/api/wrapped/track', { ...viewing, duration }, auth);
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }
  for (const duration of [10, 15]) {
    const response = await call('POST', '/api/wrapped/track', { ...page, duration }, auth);
    assert.equal(response.status, 200, JSON.stringify(response.body));
  }

  const viewings = await pool.execute(
    'SELECT watch_duration, hour_of_day FROM wrapped_viewing_data WHERE user_id = ? AND content_id = ?',
    [WRAPPED_USER_ID, viewing.contentId],
  );
  assert.equal(viewings[0].length, 1, 'les deux tracks du même contenu fusionnent');
  assert.equal(viewings[0][0].watch_duration, 55);
  assert.equal(viewings[0][0].hour_of_day, 14);

  const pages = await pool.execute(
    'SELECT duration FROM wrapped_pages_data WHERE user_id = ? AND page_name = ?',
    [WRAPPED_USER_ID, page.pageName],
  );
  assert.equal(pages[0].length, 1, 'les deux tracks de la même page fusionnent');
  assert.equal(pages[0][0].duration, 25);
});

test('les compteurs communautaires Wrapped lisent le profil sur PostgreSQL', { skip }, async () => {
  const { fetchWrappedCommunity } = require('../utils/wrappedCommunity');
  const createdAt = Date.now();

  const [commentResult] = await pool.execute(
    `INSERT INTO comments
       (content_type, content_id, user_id, user_type, profile_id, username, content, created_at, deleted)
     VALUES (?, ?, ?, 'oauth', ?, 'E2E', 'Commentaire Wrapped', ?, 0)
     RETURNING id`,
    ['movie', '123', USER_ID, PROFILE_ID, createdAt],
  );
  const commentId = commentResult[0].id;

  await pool.execute(
    `INSERT INTO comment_replies
       (comment_id, user_id, user_type, profile_id, username, content, created_at, deleted)
     VALUES (?, ?, 'oauth', ?, 'E2E', 'Réponse Wrapped', ?, 0)`,
    [commentId, USER_ID, PROFILE_ID, createdAt],
  );

  const stats = await fetchWrappedCommunity(pool, {
    userId: USER_ID,
    userType: 'oauth',
    profileId: PROFILE_ID,
    year: YEAR,
  });

  assert.equal(stats.commentsPosted, 1);
  assert.equal(stats.repliesPosted, 1);
  assert.equal(stats.discussedTitles, 1);
  assert.equal(stats.topTitles[0].tmdbId, 123);
});

test('le chemin de génération Wrapped répond même avec peu de données', { skip }, async () => {
  const response = await call('GET', `/api/wrapped/generate/${YEAR}?fresh=1`, null, {
    authorization: `Bearer ${TOKEN}`,
    'x-profile-id': '',
  });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.success, true);
  assert.equal(response.body.wrapped, null, 'pas assez de données pour débloquer le récit');
  assert.equal(response.body.progress.isEligible, false);
  assert.equal(response.body.progress.current.sessions, 1);
});
