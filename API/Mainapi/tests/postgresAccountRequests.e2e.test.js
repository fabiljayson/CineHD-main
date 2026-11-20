/**
 * Demande de compte (parcours mobile money) servie par PostgreSQL.
 *
 *   docker run -d --name cinehd-acc-pg -e POSTGRES_PASSWORD=pw -p 55438:5432 postgres:16-alpine
 *   docker run -d --name cinehd-acc-redis -p 55439:6379 redis:7-alpine
 *   JWT_SECRET=test-only \
 *   DATABASE_MIGRATION_URL='postgres://postgres:pw@127.0.0.1:55438/cinehd_acc' \
 *   REDIS_HOST=127.0.0.1 REDIS_PORT=55439 \
 *     node --test tests/postgresAccountRequests.e2e.test.js
 *
 * Ce que le test prouve, et qui ne se voit pas sur MySQL :
 *   - l'identifiant rendu à la création vient de `RETURNING id` (sans lui, la
 *     route relirait une demande inexistante) ;
 *   - un rejeu de la même référence est refusé en 409, donc le SQLSTATE 23505
 *     est bien reconnu comme un doublon et pas comme une erreur serveur.
 *
 * Aucune connexion MySQL n'est possible ici : `DB_HOST`/`DB_PORT` pointent un
 * port fermé, si bien qu'un accès résiduel échouerait au lieu de passer
 * inaperçu.
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

const REFERENCE = `TX-E2E-${Date.now().toString(36).toUpperCase()}`;
const MSISDN = '237600000001';
const USERNAME = `pg_demande_${Date.now().toString(36)}`;

let server;
let pool;

function call(method, route, body) {
  const payload = body ? JSON.stringify(body) : null;
  const headers = {};
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

  // Une base fraîche redémarre une fois initialisée : on ne retente que cette
  // course, une erreur de schéma doit remonter telle quelle.
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

  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/accountRequests'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });

  pool = require('../db/dialect').getPool();
});

after(async () => {
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.close(resolve);
    server.closeAllConnections?.();
  });
  await require('../postgresPool').closePostgresPool().catch(() => {});
  require('../config/redis').redis.disconnect();
});

test('une demande de compte est enregistrée et relue par son identifiant', { skip }, async () => {
  const plans = await call('GET', '/api/account-requests/plans');
  assert.equal(plans.status, 200);
  assert.equal(plans.body.success, true);

  const method = plans.body.methods?.[0]?.id;
  const plan = plans.body.plans?.[0];
  assert.ok(method, 'au moins un moyen de paiement est configuré');
  assert.ok(plan, 'au moins une offre est publiée');

  const response = await call('POST', '/api/account-requests', {
    planId: plan.id,
    amountFcfa: plan.floorFcfa,
    paymentMethod: method,
    payerMsisdn: MSISDN,
    reference: REFERENCE,
    username: USERNAME,
    acceptedTerms: true,
  });

  assert.equal(response.status, 201, JSON.stringify(response.body));
  // L'identifiant vient de `RETURNING id` : sans lui, la relecture porterait sur
  // une ligne inexistante et la réponse serait vide.
  assert.equal(typeof response.body.request.id, 'number');
  assert.ok(response.body.request.id > 0);
  assert.equal(response.body.request.reference, REFERENCE);
  assert.equal(response.body.request.status, 'pending');

  const stored = await pool.execute('SELECT id, reference FROM account_requests WHERE reference = ?', [REFERENCE]);
  assert.equal(stored[0].length, 1);
  assert.equal(Number(stored[0][0].id), response.body.request.id);
});

test('rejouer la même référence répond 409, pas 500', { skip }, async () => {
  const plans = await call('GET', '/api/account-requests/plans');
  const method = plans.body.methods?.[0]?.id;
  const plan = plans.body.plans?.[0];

  const replay = await call('POST', '/api/account-requests', {
    planId: plan.id,
    amountFcfa: plan.floorFcfa,
    paymentMethod: method,
    payerMsisdn: MSISDN,
    reference: REFERENCE,
    username: USERNAME,
    acceptedTerms: true,
  });

  // 409 = le SQLSTATE 23505 a été reconnu comme un doublon. Sur MySQL c'est
  // ER_DUP_ENTRY qui jouait ce rôle ; un test qui ne vérifie que le code HTTP
  // d'un premier envoi ne verrait jamais la différence.
  assert.equal(replay.status, 409, JSON.stringify(replay.body));
  assert.equal(replay.body.code, 'DUPLICATE_REFERENCE');

  const rows = await pool.execute('SELECT COUNT(*) AS total FROM account_requests WHERE reference = ?', [REFERENCE]);
  assert.equal(Number(rows[0][0].total), 1, 'le rejeu ne crée pas de seconde demande');
});

test('le suivi par référence et numéro retrouve la demande', { skip }, async () => {
  const status = await call('POST', '/api/account-requests/status', {
    reference: REFERENCE,
    payerMsisdn: MSISDN,
  });

  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.success, true);
  assert.equal(status.body.status, 'pending');
  // Le suivi ne rend que l'état : ni le code de connexion, ni le pseudo.
  assert.deepEqual(Object.keys(status.body).sort(), ['status', 'success']);
});
