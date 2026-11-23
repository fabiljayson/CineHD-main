/**
 * Le seed des comptes admin doit rendre la connexion par mot de passe
 * fonctionnelle quand CineHD tourne sur PostgreSQL.
 *
 * Reproduce (PostgreSQL jetable + Redis jetable, MySQL mort) :
 *   timeout --kill-after=10s 220s env \
 *     DATABASE_MIGRATION_URL='postgres://postgres@127.0.0.1:55438/cinehd_ovw' \
 *     REDIS_HOST=127.0.0.1 REDIS_PORT=55439 PAYMENT_MTN_MOMO_NUMBER=237600000000 \
 *     node --test --test-concurrency=1 --test-timeout=20000 \
 *     tests/postgresPortabilityAdmin.e2e.test.js
 *
 * Ce test ne regarde ni le texte du seed ni la forme de ses requêtes. Il
 * vérifie UN comportement observable : après `seedAdminAccounts.js`, la route
 * réelle de login par mot de passe accepte le compte créé, et les vraies lignes
 * `account_credentials` / `admins` existent dans PostgreSQL.
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { after, before, test } = require('node:test');

const BASE_TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cinehd-admin-seed-e2e-'));
const USERS_DATA_DIR = path.join(BASE_TEST_DIR, 'users');
const GUESTS_DATA_DIR = path.join(BASE_TEST_DIR, 'guests');
fs.mkdirSync(USERS_DATA_DIR, { recursive: true });
fs.mkdirSync(GUESTS_DATA_DIR, { recursive: true });

process.env.NODE_ENV = 'test';
process.env.DB_DRIVER = 'postgres';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '6390';
process.env.JWT_SECRET = 'test-only-secret';
process.env.PAYMENT_PROVIDER = 'mtn';
process.env.PAYMENT_MTN_MOMO_NUMBER = '237600000000';
process.env.USER_DATA_DIR = BASE_TEST_DIR;
if (!process.env.DATABASE_MIGRATION_URL) {
  throw new Error('DATABASE_MIGRATION_URL must point to a disposable PostgreSQL database');
}
const POSTGRES_URL = process.env.DATABASE_MIGRATION_URL;
const parsedPgUrl = new URL(POSTGRES_URL);
process.env.DATABASE_URL = POSTGRES_URL;

const FRED_USERNAME = 'fred-seed-e2e';
const FAB_USERNAME = 'fab-seed-e2e';
const FRED_PASSWORD = 'Fred-Seed-E2E-2026!';
const FAB_PASSWORD = 'Fab-Seed-E2E-2026!';
const SEED_USERNAMES = [FRED_USERNAME, FAB_USERNAME];

let api;
let app;
let appReady;
let server;
let baseUrl;
let pool;
let redisClient;
let dialect;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unlisten = () => {};
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function pgValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  return String(value);
}

before(async () => {
  dialect = require('../db/dialect');
  assert.equal(dialect.isPostgres(), true, 'expected PostgreSQL dialect');
  pool = dialect.getPool();

  const migrate = () => execFileSync(
    process.execPath,
    [path.join(__dirname, '..', 'db', 'migratePostgres.js')],
    { env: { ...process.env, DATABASE_MIGRATION_URL: POSTGRES_URL }, stdio: 'pipe', timeout: 30000 },
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

  const redisModule = require('../config/redis');
  redisClient = redisModule.redis;
  await redisClient.ping();
  await redisClient.flushdb();

  const listenPort = await getFreePort();
  const originalListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function patchedListen(...args) {
    if (args[0] === 0 || args[0] === 3000) {
      return originalListen.call(this, listenPort, '127.0.0.1', ...args.slice(1));
    }
    return originalListen.call(this, ...args);
  };
  try {
    ({ app, appReady } = await import(pathToFileURL(path.join(__dirname, '../app.js')).href));
  } finally {
    http.Server.prototype.listen = originalListen;
  }
  appReady.catch(() => {});
  await appReady;
  api = app;
  server = await new Promise((resolve, reject) => {
    const instance = api.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (pool) {
    try {
      await pool.query(
        `DELETE FROM user_sessions WHERE user_id IN (SELECT user_id FROM account_credentials WHERE username = ANY($1::text[]))`,
        [SEED_USERNAMES],
      );
      await pool.query(`DELETE FROM account_credentials WHERE username = ANY($1::text[])`, [SEED_USERNAMES]);
      await pool.query(`DELETE FROM admins WHERE user_id NOT IN (SELECT user_id FROM account_credentials)`);
    } catch (error) {
      console.error('PostgreSQL cleanup error:', error.message);
    }
  }
  await new Promise((resolve) => {
    if (!server) return resolve();
    server.close(resolve);
    server.closeAllConnections?.();
  });
  if (redisClient) {
    try {
      redisClient.disconnect();
    } catch (error) {
      console.error('Redis cleanup error:', error.message);
    }
  }
  await require('../postgresPool').closePostgresPool().catch(() => {});
  try {
    fs.rmSync(BASE_TEST_DIR, { recursive: true, force: true });
  } catch (error) {
    console.error('Temp dir cleanup error:', error.message);
  }
});

function postJson(urlPath, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: new URL(baseUrl).port,
        path: urlPath,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
        agent: false,
      },
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
          resolve({ status: response.statusCode, body: parsed, text });
        });
      },
    );
    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

async function readSeededCredentials() {
  const [rows] = await pool.query(
    `SELECT user_id, username, password_hash, active, code_hash FROM account_credentials WHERE username = ANY($1::text[]) ORDER BY username`,
    [SEED_USERNAMES],
  );
  return rows;
}

async function readSeededAdmins() {
  const [rows] = await pool.query(
    `SELECT user_id, auth_type, role FROM admins WHERE user_id IN (SELECT user_id FROM account_credentials WHERE username = ANY($1::text[])) ORDER BY user_id`,
    [SEED_USERNAMES],
  );
  return rows;
}

test('seeded admin can password-login against PostgreSQL', { timeout: 60000 }, async () => {
  await pool.query(`DELETE FROM user_sessions WHERE user_id IN (SELECT user_id FROM account_credentials WHERE username = ANY($1::text[]))`, [SEED_USERNAMES]);
  await pool.query(`DELETE FROM account_credentials WHERE username = ANY($1::text[])`, [SEED_USERNAMES]);
  await pool.query(`DELETE FROM admins WHERE user_id NOT IN (SELECT user_id FROM account_credentials)`);
  await redisClient.flushdb();

  let seedResult = { status: 0, stdout: '', stderr: '' };
  try {
    seedResult.stdout = execFileSync(process.execPath, [path.join(__dirname, '../scripts/seedAdminAccounts.js')], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        ADMIN_ACCOUNT: 'both',
        ADMIN_FRED_USERNAME: FRED_USERNAME,
        ADMIN_FABL_USERNAME: FAB_USERNAME,
        ADMIN_FRED_PASSWORD: FRED_PASSWORD,
        ADMIN_FABL_PASSWORD: FAB_PASSWORD,
        ADMIN_AUTH_TYPE: 'bip-39',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
    });
  } catch (error) {
    if (error?.code === 'ETIMEDOUT' || error?.status === null || error?.status === undefined) {
      throw error;
    }
    seedResult = {
      status: error.status,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || ''),
    };
  }
  assert.equal(seedResult.status, 0, `seed failed: ${seedResult.stdout}${seedResult.stderr}`);

  const credentials = await readSeededCredentials();
  assert.equal(credentials.length, 2);
  const byUsername = Object.fromEntries(credentials.map((row) => [row.username, row]));
  for (const username of SEED_USERNAMES) {
    assert.ok(byUsername[username], `missing account_credentials row for ${username}`);
    assert.ok(String(byUsername[username].password_hash ?? '').length > 0, `missing stored password hash for ${username}`);
    assert.equal(pgValue(byUsername[username].active), 1);
  }

  const admins = await readSeededAdmins();
  assert.equal(admins.length, 2);
  assert.deepEqual(new Set(admins.map((row) => pgValue(row.auth_type))), new Set(['bip-39']));
  assert.deepEqual(new Set(admins.map((row) => pgValue(row.role))), new Set(['admin']));

  const response = await postJson('/api/auth/account/password-login', {
    username: FRED_USERNAME,
    password: FRED_PASSWORD,
  });
  assert.equal(response.status, 200, `login failed with status ${response.status}: ${response.text}`);
  const body = response.body;
  assert.ok(body.token, 'login response is missing a token');
  assert.equal(body.userId, byUsername[FRED_USERNAME].user_id);
});
