/**
 * Confirmation manuelle des paiements VIP (Orange Money / MTN MoMo, sans API).
 *
 * Modes de défaillance couverts (aucun E2E n'existe pour ce parcours, qui
 * dépend d'une session connectée, d'un admin et d'une base MySQL) :
 *  - un visiteur non connecté dépose une preuve de paiement ;
 *  - une même référence de transaction est rejouée (ici ou dans les demandes
 *    de création de compte) pour obtenir deux clés avec un seul paiement ;
 *  - un utilisateur empile des demandes en attente (spam de la file admin) ;
 *  - un non-admin valide ou refuse une demande ;
 *  - la validation ne crée pas de clé `access_keys` utilisable, avec la durée
 *    de l'offre, ou ne la rattache pas au compte (l'utilisateur devrait la
 *    saisir lui-même) ;
 *  - une prolongation raccourcit un VIP encore actif ;
 *  - une demande est validée deux fois (deux clés) ou validée après refus ;
 *  - un utilisateur voit la clé ou la demande d'un autre.
 *
 * La route réelle tourne dans un contexte isolé, ses requêtes SQL sur SQLite
 * en mémoire ; MySQL, Redis et le module de sync fichier sont remplacés.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');

const DAY_MS = 24 * 60 * 60 * 1000;
const ROUTE_FILE = path.resolve(__dirname, '../vipPaymentRequests.js');

function toSqlite(sql) {
  return sql
    .replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP')
    .replace(/\s+FOR UPDATE\b/g, '');
}

function createDb(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE access_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_value TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      used INTEGER NOT NULL DEFAULT 0,
      duree_validite TEXT,
      expires_at INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE account_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      UNIQUE (payment_method, reference)
    );
    CREATE TABLE vip_payment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      user_type TEXT NOT NULL,
      username TEXT,
      plan_id TEXT NOT NULL,
      plan_days INTEGER NOT NULL,
      amount_fcfa INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      payer_msisdn TEXT NOT NULL,
      reference TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      admin_note TEXT,
      access_key_value TEXT,
      key_expires_at INTEGER,
      account_linked INTEGER NOT NULL DEFAULT 0,
      reviewed_at TEXT,
      reviewed_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (payment_method, reference)
    );
  `);
  return db;
}

function createPool(db) {
  function run(sql, params = []) {
    const statement = db.prepare(toSqlite(sql));
    try {
      if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
        return [statement.all(...params)];
      }
      const info = statement.run(...params);
      return [{ insertId: Number(info.lastInsertRowid), affectedRows: Number(info.changes) }];
    } catch (error) {
      if (/UNIQUE constraint failed/.test(String(error.message))) {
        throw Object.assign(new Error(error.message), { code: 'ER_DUP_ENTRY' });
      }
      throw error;
    }
  }
  const conn = {
    async execute(sql, params) { return run(sql, params); },
    async query(sql, params) { return run(sql, params); },
    async beginTransaction() { db.exec('BEGIN'); },
    async commit() { db.exec('COMMIT'); },
    async rollback() { try { db.exec('ROLLBACK'); } catch { /* aucune transaction */ } },
    release() {},
  };
  return {
    async execute(sql, params) { return run(sql, params); },
    async query(sql, params) { return run(sql, params); },
    async getConnection() { return conn; },
  };
}

/** Module sync fichier : fiches utilisateur + données de profil en mémoire. */
function createSyncStore() {
  const users = new Map();
  const profiles = new Map();
  return {
    users,
    profiles,
    async readUserData(userType, userId) {
      return structuredClone(users.get(`${userType}:${userId}`) || {});
    },
    async writeUserData(userType, userId, data) {
      users.set(`${userType}:${userId}`, structuredClone(data));
      return true;
    },
    async readProfileData(userType, userId, profileId) {
      return structuredClone(profiles.get(`${userType}:${userId}:${profileId}`) || {});
    },
    async writeProfileData(userType, userId, profileId, data) {
      profiles.set(`${userType}:${userId}:${profileId}`, structuredClone(data));
      return true;
    },
    async withProfileSyncLock(_userType, _userId, _profileId, task) {
      return task();
    },
  };
}

// Jetons de test : « Bearer <userType>:<userId> », « admin » = administrateur.
function authFromRequest(req) {
  const header = String(req.headers?.authorization || '');
  const match = /^Bearer (oauth|bip39):([A-Za-z0-9_-]+)$/.exec(header);
  return match ? { userType: match[1], userId: match[2], sessionId: 's' } : null;
}

function fixture(t, { methods = { PAYMENT_ORANGE_MONEY_NUMBER: '237600000000' } } = {}) {
  const previousEnv = {};
  for (const name of ['PAYMENT_ORANGE_MONEY_NUMBER', 'PAYMENT_MTN_MOMO_NUMBER']) {
    previousEnv[name] = process.env[name];
    if (methods[name]) process.env[name] = methods[name];
    else delete process.env[name];
  }
  t.after(() => {
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const db = createDb(t);
  const pool = createPool(db);
  const sync = createSyncStore();
  const invalidated = [];
  const realRequire = createRequire(ROUTE_FILE);

  const rateLimit = () => (_req, _res, next) => next();
  rateLimit.ipKeyGenerator = (ip) => ip;

  const stubs = {
    'express-rate-limit': rateLimit,
    '../mysqlPool': { getPool: () => pool },
    '../middleware/auth': {
      getAuthIfValid: async (req) => authFromRequest(req),
      async isAdmin(req, res, next) {
        const auth = authFromRequest(req);
        if (!auth) return res.status(401).json({ success: false, error: 'Non autorisé' });
        if (auth.userId !== 'admin') return res.status(403).json({ success: false, error: 'Accès refusé' });
        req.admin = { userId: auth.userId, userType: auth.userType, adminId: 1, role: 'admin' };
        return next();
      },
    },
    '../utils/redisRateLimitStore': { createRedisRateLimitStore: () => undefined },
    '../utils/clientIp': { getTrustedClientIp: () => '127.0.0.1' },
    '../middleware/bodyParsing': { createAuthBodyParsers: () => [] },
    '../middleware/security': { jsonParseErrorHandler: (err, _req, _res, next) => next(err) },
    '../checkVip': { invalidateVipCache: (key) => { invalidated.push(key); } },
    './sync': sync,
  };
  // Modules purs chargés tels quels (aucune connexion réseau ni base).
  const realModules = new Set(['crypto', 'express', '../utils/accountPlans', '../utils/mobileMoney', '../utils/manualVipPayments']);

  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(ROUTE_FILE, 'utf8'), {
    module,
    exports: module.exports,
    __dirname: path.dirname(ROUTE_FILE),
    process,
    Buffer,
    Date,
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      if (name in stubs) return stubs[name];
      assert.ok(realModules.has(name), `Dépendance non isolée : ${name}`);
      return realRequire(name);
    },
  }, { filename: ROUTE_FILE });

  async function request(method, routePath, { as = null, params = {}, query = {}, body = {} } = {}) {
    const route = module.exports.stack
      .find((layer) => layer.route?.path === routePath && layer.route.methods[method])?.route;
    assert.ok(route, `Route absente : ${method} ${routePath}`);
    const headers = as ? { authorization: `Bearer ${as}` } : {};
    const req = { method: method.toUpperCase(), params, query, body, headers, ip: '127.0.0.1' };
    const res = {
      statusCode: 200,
      headers: {},
      set(name, value) { this.headers[name] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    for (const layer of route.stack) {
      let proceed = false;
      await layer.handle(req, res, () => { proceed = true; });
      if (!proceed) break;
    }
    return res;
  }

  const validPayment = (overrides = {}) => ({
    planId: 'month',
    amountFcfa: 5000,
    paymentMethod: 'orange_money',
    payerMsisdn: '690 00 00 00',
    reference: `PP2611.1200.${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    ...overrides,
  });

  return {
    db,
    sync,
    invalidated,
    validPayment,
    submit: (as, body) => request('post', '/vip-payments', { as, body }),
    mine: (as) => request('get', '/vip-payments/mine', { as }),
    list: (as, query = {}) => request('get', '/admin/vip-payments', { as, query }),
    confirm: (as, id, body = {}) => request('post', '/admin/vip-payments/:id/confirm', { as, params: { id: String(id) }, body }),
    reject: (as, id, body = {}) => request('post', '/admin/vip-payments/:id/reject', { as, params: { id: String(id) }, body }),
  };
}

const USER = 'oauth:user1';
const OTHER = 'bip39:user2';
const ADMIN = 'oauth:admin';

test('un visiteur non connecté ne peut pas déposer de preuve de paiement', async (t) => {
  const f = fixture(t);
  const res = await f.submit(null, f.validPayment());
  assert.equal(res.statusCode, 401);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM vip_payment_requests').get().n, 0);
});

test('une preuve valide est enregistrée en attente pour le compte connecté', async (t) => {
  const f = fixture(t);
  const res = await f.submit(USER, f.validPayment({ reference: 'MP261112.0001.A12345' }));
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.request.status, 'pending');
  assert.equal(res.body.request.planId, 'month');
  assert.equal(res.body.request.accessKey, null);

  const row = f.db.prepare('SELECT * FROM vip_payment_requests').get();
  assert.equal(row.user_id, 'user1');
  assert.equal(row.user_type, 'oauth');
  assert.equal(row.payer_msisdn, '690000000');
  assert.equal(row.reference, 'MP261112.0001.A12345');
});

test('les données de paiement invalides sont refusées', async (t) => {
  const f = fixture(t);
  const cases = [
    { planId: 'forever' },
    { amountFcfa: 100 },
    { amountFcfa: 999999 },
    { paymentMethod: 'wave' }, // opérateur inconnu
    { payerMsisdn: '12' },
    { reference: '!!' },
  ];
  for (const override of cases) {
    const res = await f.submit(USER, f.validPayment(override));
    assert.equal(res.statusCode, 400, `attendu 400 pour ${JSON.stringify(override)}`);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM vip_payment_requests').get().n, 0);
});

test('une référence de transaction déjà utilisée est refusée, y compris par un autre compte', async (t) => {
  const f = fixture(t);
  const first = await f.submit(USER, f.validPayment({ reference: 'REF-DUPLICATE-1' }));
  assert.equal(first.statusCode, 201);
  await f.reject(ADMIN, first.body.request.id, { note: 'test' });

  const replay = await f.submit(OTHER, f.validPayment({ reference: 'REF-DUPLICATE-1' }));
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.body.code, 'DUPLICATE_REFERENCE');

  // Référence déjà consommée par une demande de création de compte.
  f.db.prepare('INSERT INTO account_requests (reference, payment_method) VALUES (?, ?)')
    .run('REF-ACCOUNT-1', 'orange_money');
  const crossReplay = await f.submit(OTHER, f.validPayment({ reference: 'REF-ACCOUNT-1' }));
  assert.equal(crossReplay.statusCode, 409);
  assert.equal(crossReplay.body.code, 'DUPLICATE_REFERENCE');
});

test('un compte ne peut pas empiler plusieurs demandes en attente', async (t) => {
  const f = fixture(t);
  assert.equal((await f.submit(USER, f.validPayment())).statusCode, 201);
  const second = await f.submit(USER, f.validPayment());
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.code, 'PENDING_EXISTS');
});

test('seul un admin peut lister, valider ou refuser', async (t) => {
  const f = fixture(t);
  const created = await f.submit(USER, f.validPayment());
  const id = created.body.request.id;

  assert.equal((await f.list(null)).statusCode, 401);
  assert.equal((await f.list(USER)).statusCode, 403);
  assert.equal((await f.confirm(USER, id)).statusCode, 403);
  assert.equal((await f.reject(OTHER, id)).statusCode, 403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM access_keys').get().n, 0);
  assert.equal(f.db.prepare('SELECT status FROM vip_payment_requests').get().status, 'pending');

  const listed = await f.list(ADMIN, { status: 'pending' });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.requests.length, 1);
  assert.equal(listed.body.requests[0].userId, 'user1');
});

test('la validation crée une clé VIP de la durée de l\'offre et la rattache au compte', async (t) => {
  const f = fixture(t);
  await f.sync.writeUserData('oauth', 'user1', { profiles: [{ id: 'p1', isDefault: true }, { id: 'p2' }] });
  const created = await f.submit(USER, f.validPayment({ planId: 'week', amountFcfa: 1500 }));
  const before = Date.now();
  const res = await f.confirm(ADMIN, created.body.request.id, { note: 'Paiement vu sur le relevé' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.request.status, 'approved');

  const key = f.db.prepare('SELECT * FROM access_keys').get();
  assert.ok(key, 'aucune clé créée');
  assert.equal(key.active, 1);
  assert.equal(res.body.accessKey, key.key_value);
  const expectedExpiry = before + 7 * DAY_MS;
  assert.ok(Math.abs(Number(key.expires_at) - expectedExpiry) < 60_000, 'durée de clé incorrecte');
  assert.ok(f.invalidated.includes(key.key_value), 'cache VIP non invalidé');

  // Rattachée à chaque profil : le compte est débloqué sans saisie.
  for (const profileId of ['p1', 'p2']) {
    const data = await f.sync.readProfileData('oauth', 'user1', profileId);
    assert.equal(data.access_code, key.key_value);
    assert.equal(data.is_vip, 'true');
    assert.equal(new Date(data.access_code_expires).getTime(), Number(key.expires_at));
  }
  assert.equal(res.body.request.accountLinked, true);

  // L'utilisateur voit le résultat et sa clé.
  const mine = await f.mine(USER);
  assert.equal(mine.statusCode, 200);
  assert.equal(mine.body.requests[0].status, 'approved');
  assert.equal(mine.body.requests[0].accessKey, key.key_value);
});

test('une prolongation démarre à la fin du VIP encore actif', async (t) => {
  const f = fixture(t);
  const first = await f.submit(USER, f.validPayment({ planId: 'month', amountFcfa: 5000 }));
  await f.confirm(ADMIN, first.body.request.id);
  const firstExpiry = Number(f.db.prepare('SELECT expires_at FROM access_keys').get().expires_at);

  const second = await f.submit(USER, f.validPayment({ planId: 'week', amountFcfa: 1500 }));
  const res = await f.confirm(ADMIN, second.body.request.id);
  assert.equal(res.statusCode, 200);
  const newKey = f.db.prepare('SELECT * FROM access_keys WHERE key_value = ?').get(res.body.accessKey);
  assert.ok(Math.abs(Number(newKey.expires_at) - (firstExpiry + 7 * DAY_MS)) < 60_000);
});

test('une demande ne peut être validée qu\'une fois, et jamais après un refus', async (t) => {
  const f = fixture(t);
  const a = await f.submit(USER, f.validPayment());
  assert.equal((await f.confirm(ADMIN, a.body.request.id)).statusCode, 200);
  assert.equal((await f.confirm(ADMIN, a.body.request.id)).statusCode, 409);
  assert.equal((await f.reject(ADMIN, a.body.request.id)).statusCode, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM access_keys').get().n, 1);

  const b = await f.submit(OTHER, f.validPayment());
  const rejected = await f.reject(ADMIN, b.body.request.id, { note: 'Référence introuvable chez Orange' });
  assert.equal(rejected.statusCode, 200);
  assert.equal((await f.confirm(ADMIN, b.body.request.id)).statusCode, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM access_keys').get().n, 1);

  assert.equal((await f.confirm(ADMIN, 9999)).statusCode, 404);
});

test('le refus est visible par l\'utilisateur avec le motif, sans clé', async (t) => {
  const f = fixture(t);
  const created = await f.submit(OTHER, f.validPayment());
  await f.reject(ADMIN, created.body.request.id, { note: 'Montant non reçu' });
  const mine = await f.mine(OTHER);
  assert.equal(mine.body.requests[0].status, 'rejected');
  assert.equal(mine.body.requests[0].adminNote, 'Montant non reçu');
  assert.equal(mine.body.requests[0].accessKey, null);

  // Après un refus, une nouvelle demande est possible.
  assert.equal((await f.submit(OTHER, f.validPayment())).statusCode, 201);
});

test('un utilisateur ne voit que ses propres demandes', async (t) => {
  const f = fixture(t);
  const created = await f.submit(USER, f.validPayment());
  await f.confirm(ADMIN, created.body.request.id);
  const other = await f.mine(OTHER);
  assert.equal(other.statusCode, 200);
  assert.deepEqual(other.body.requests, []);
  assert.equal((await f.mine(null)).statusCode, 401);
});
