/**
 * Les tests navigateur ne peuvent pas couvrir le cycle de vie transactionnel
 * MySQL, les callbacks fournisseur ni les routes désactivées sans démarrer le
 * cluster et contacter des services de paiement. Ces cas isolent ces frontières.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');

const ROUTE_FILE = path.resolve(__dirname, '../vipDonations.js');
const realRequire = createRequire(ROUTE_FILE);
const vipDonations = require('../../utils/vipDonations');

function createRouteFixture() {
  const calls = { createInvoice: 0, fetchGift: 0, unsealGift: 0 };
  const rateLimit = () => (_req, _res, next) => next();
  rateLimit.ipKeyGenerator = (ip) => ip;

  const stubs = {
    'express-rate-limit': rateLimit,
    '../mysqlPool': { getPool: () => ({}) },
    '../middleware/auth': {
      isAdmin: (_req, _res, next) => next(),
      getAuthIfValid: async () => null,
    },
    '../utils/redisRateLimitStore': { createRedisRateLimitStore: () => undefined },
    '../utils/turnstile': { verifyTurnstileFromRequest: async () => ({ valid: true }) },
    '../utils/vipDonations': {
      createVipInvoice: async () => { calls.createInvoice += 1; return {}; },
      handleCryptoGateWebhook: async () => {},
      handlePaygateCallback: async () => {},
      fetchInvoiceByPublicId: async () => null,
      fetchInvoiceByGiftToken: async () => { calls.fetchGift += 1; return null; },
      getVipInvoiceDetails: async () => null,
      listUserVipInvoices: async () => [],
      listVipInvoices: async () => ({ items: [] }),
      refreshInvoiceStatus: async () => null,
      forceValidateInvoice: async () => null,
      cancelInvoice: async () => null,
      serializePublicInvoice: (invoice) => invoice,
      serializeAdminInvoice: (invoice) => invoice,
      serializeGift: (invoice) => invoice,
      unsealGift: async () => { calls.unsealGift += 1; return {}; },
      ensureVipDonationsTables: async () => {},
      cancelUnfinishedGiftInvoices: async () => 0,
      getClientIp: () => '127.0.0.1',
    },
  };

  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(ROUTE_FILE, 'utf8'), {
    module,
    exports: module.exports,
    __dirname: path.dirname(ROUTE_FILE),
    process,
    Buffer,
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      if (name in stubs) return stubs[name];
      assert.equal(name, 'express', `Dépendance non isolée : ${name}`);
      return realRequire(name);
    },
  }, { filename: ROUTE_FILE });

  async function request(method, routePath, params = {}) {
    const route = module.exports.router.stack
      .find((layer) => layer.route?.path === routePath && layer.route.methods[method])?.route;
    assert.ok(route, `Route absente : ${method} ${routePath}`);
    const req = { method: method.toUpperCase(), params, query: {}, body: {}, headers: {}, ip: '127.0.0.1' };
    const res = {
      statusCode: 200,
      headers: {},
      set(name, value) { this.headers[name] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      type() { return this; },
      send(body) { this.body = body; return this; },
    };

    for (const layer of route.stack) {
      let proceeded = false;
      await layer.handle(req, res, () => { proceeded = true; });
      if (!proceeded) break;
    }
    return res;
  }

  return { calls, request };
}

function toSqlite(sql) {
  return sql
    .replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP')
    .replace(/\s+FOR UPDATE\b/g, '');
}

function createInvoicePool(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE vip_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      payment_method TEXT NOT NULL,
      status TEXT NOT NULL,
      recipient_mode TEXT NOT NULL,
      payment_address TEXT,
      address_type TEXT,
      qr_payload TEXT,
      coin TEXT,
      pack_eur REAL,
      amount_eur REAL,
      amount_usd REAL,
      amount_crypto_expected REAL,
      amount_crypto_received REAL,
      vip_years REAL,
      expires_at TEXT,
      paid_at TEXT,
      delivered_at TEXT,
      created_at TEXT,
      gift_token TEXT,
      gift_sealed INTEGER DEFAULT 1,
      vip_key_value TEXT,
      cryptogate_payment_id TEXT,
      cryptogate_last_event TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE vip_invoice_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor_type TEXT,
      actor_id TEXT,
      message TEXT,
      payload_json TEXT,
      created_at TEXT
    );
  `);

  function run(sql, params = []) {
    const statement = db.prepare(toSqlite(sql));
    if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
      return [statement.all(...params)];
    }
    const info = statement.run(...params);
    return [{ insertId: Number(info.lastInsertRowid), affectedRows: Number(info.changes) }];
  }

  const connection = {
    async execute(sql, params) { return run(sql, params); },
    async beginTransaction() { db.exec('BEGIN'); },
    async commit() { db.exec('COMMIT'); },
    async rollback() { try { db.exec('ROLLBACK'); } catch { /* aucune transaction */ } },
    release() {},
  };
  return {
    db,
    async execute(sql, params) { return run(sql, params); },
    async getConnection() { return connection; },
  };
}

function seedInvoice(db, {
  publicId,
  paymentMethod = 'btc',
  status = 'awaiting_payment',
  recipientMode = 'gift',
  paymentId = null,
} = {}) {
  const result = db.prepare(`
    INSERT INTO vip_invoices
      (public_id, payment_method, status, recipient_mode, payment_address, qr_payload,
       pack_eur, amount_eur, amount_usd, amount_crypto_expected, amount_crypto_received,
       vip_years, created_at, cryptogate_payment_id)
    VALUES (?, ?, ?, ?, 'wallet-secret', 'qr-secret', 5, 5, 5, 0, 0, 1, CURRENT_TIMESTAMP, ?)
  `).run(publicId, paymentMethod, status, recipientMode, paymentId);
  return Number(result.lastInsertRowid);
}

test('les actions publiques de facturation et de cadeau sont arrêtées sans appeler leurs services', async () => {
  const f = createRouteFixture();

  const create = await f.request('post', '/vip/invoices');
  const giftRead = await f.request('get', '/vip/gifts/:giftToken', { giftToken: 'gift-token' });
  const giftUnseal = await f.request('post', '/vip/gifts/:giftToken/unseal', { giftToken: 'gift-token' });

  for (const response of [create, giftRead, giftUnseal]) {
    assert.equal(response.statusCode, 410);
    assert.equal(response.body.success, false);
    assert.equal(response.body.code, 'VIP_DISABLED');
  }
  assert.deepEqual(f.calls, { createInvoice: 0, fetchGift: 0, unsealGift: 0 });
});

test('seules les factures-cadeaux non finalisées sont annulées une fois et restent enregistrées', async (t) => {
  const pool = createInvoicePool(t);
  const giftIds = ['awaiting_payment', 'partial_payment', 'confirming', 'expired'].map((status, index) => (
    seedInvoice(pool.db, { publicId: `gift_${index}`, status })
  ));
  const paidGiftId = seedInvoice(pool.db, { publicId: 'gift_paid', status: 'paid' });
  const deliveredGiftId = seedInvoice(pool.db, { publicId: 'gift_delivered', status: 'delivered' });
  const personalId = seedInvoice(pool.db, {
    publicId: 'personal_open',
    status: 'awaiting_payment',
    recipientMode: 'self',
  });

  assert.equal(await vipDonations.cancelUnfinishedGiftInvoices(pool), 4);
  assert.deepEqual(
    pool.db.prepare('SELECT id, status FROM vip_invoices ORDER BY id').all()
      .map((row) => ({ id: row.id, status: row.status })),
    [
      ...giftIds.map((id) => ({ id, status: 'cancelled' })),
      { id: paidGiftId, status: 'paid' },
      { id: deliveredGiftId, status: 'delivered' },
      { id: personalId, status: 'awaiting_payment' },
    ]
  );
  assert.equal(pool.db.prepare('SELECT COUNT(*) AS n FROM vip_invoices').get().n, 7);
  assert.equal(pool.db.prepare("SELECT COUNT(*) AS n FROM vip_invoice_events WHERE event_type = 'invoice_cancelled'").get().n, 4);

  assert.equal(await vipDonations.cancelUnfinishedGiftInvoices(pool), 0);
  assert.equal(pool.db.prepare("SELECT COUNT(*) AS n FROM vip_invoice_events WHERE event_type = 'invoice_cancelled'").get().n, 4);
});

test('une facture-cadeau annulée ne révèle plus les moyens de paiement', () => {
  const invoice = {
    public_id: 'gift_public',
    payment_method: 'btc',
    status: 'cancelled',
    recipient_mode: 'gift',
    coin: 'btc',
    payment_address: 'wallet-secret',
    qr_payload: 'qr-secret',
    amount_crypto_expected: 0.0001,
    amount_crypto_received: 0,
    pack_eur: 5,
    amount_eur: 5,
    amount_usd: 5,
    vip_years: 1,
    created_at: '2026-01-01 00:00:00',
  };

  const serialized = vipDonations.serializePublicInvoice(invoice);
  assert.equal(serialized.paymentAddress, null);
  assert.equal(serialized.qrPayload, null);
  assert.equal(serialized.checkoutUrl, null);
  assert.equal(serialized.trackingAddress, null);
  assert.equal(serialized.giftUrl, null);
  assert.equal(vipDonations.serializeAdminInvoice(invoice).paymentAddress, 'wallet-secret');

  const paygateInvoice = {
    ...invoice,
    payment_method: 'paygate_hosted',
    payment_address: null,
    paygate_tracking_address: 'tracking-secret',
    paygate_checkout_url: 'https://checkout.example.test/invoice',
  };
  const publicPaygate = vipDonations.serializePublicInvoice(paygateInvoice);
  assert.equal(publicPaygate.trackingAddress, null);
  assert.equal(publicPaygate.checkoutUrl, null);
  assert.equal(vipDonations.serializeAdminInvoice(paygateInvoice).trackingAddress, 'tracking-secret');
});

test('un webhook reçu après annulation ne paie ni ne livre une facture-cadeau', async (t) => {
  const pool = createInvoicePool(t);
  const publicId = `inv_${'1'.repeat(24)}`;
  const invoiceId = seedInvoice(pool.db, {
    publicId,
    paymentMethod: 'cryptogate',
    paymentId: 'payment-late',
  });
  await vipDonations.cancelUnfinishedGiftInvoices(pool);

  const rawBody = Buffer.from(JSON.stringify({
    event: 'payment.paid',
    payment: {
      id: 'payment-late',
      orderId: publicId,
      amount: 5,
      currency: 'EUR',
      status: 'paid',
      provider: 'test',
    },
  }));
  const secret = 'local-test-secret';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const result = await vipDonations.handleCryptoGateWebhook(pool, {
    rawBody,
    signature,
    webhookId: 'late-delivery',
  }, { webhookSecret: secret });

  assert.equal(result.status, 'cancelled');
  const stored = pool.db.prepare('SELECT status, vip_key_value FROM vip_invoices WHERE id = ?').get(invoiceId);
  assert.equal(stored.status, 'cancelled');
  assert.equal(stored.vip_key_value, null);
  assert.equal(pool.db.prepare('SELECT COUNT(*) AS n FROM vip_invoice_events').get().n, 1);
});
