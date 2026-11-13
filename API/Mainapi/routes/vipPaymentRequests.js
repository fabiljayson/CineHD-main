/**
 * Historique et administration des anciens paiements VIP manuels.
 * La création de nouvelles demandes est désactivée ; les demandes existantes
 * restent consultables et les admins peuvent terminer leur traitement.
 *
 * Mount point: app.use('/api', require('./routes/vipPaymentRequests'))
 *   POST /api/vip-payments                       désactivé (410)
 *   GET  /api/vip-payments/mine                  demandes du compte connecté (+ clé si validée)
 *   GET  /api/admin/vip-payments                 liste admin (filtre status, recherche)
 *   POST /api/admin/vip-payments/:id/confirm     validation : clé générée + rattachée
 *   POST /api/admin/vip-payments/:id/reject      refus motivé
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { getPool } = require('../mysqlPool');
const { getAuthIfValid, isAdmin } = require('../middleware/auth');
const { createRedisRateLimitStore } = require('../utils/redisRateLimitStore');
const { getTrustedClientIp } = require('../utils/clientIp');
const { createAuthBodyParsers } = require('../middleware/bodyParsing');
const { jsonParseErrorHandler } = require('../middleware/security');
const { invalidateVipCache } = require('../checkVip');
const { getPlanById } = require('../utils/accountPlans');
const {
  computeKeyExpiry,
  generateVipKeyValue,
  linkAccessKeyToAccount,
  serializeVipPaymentRequest,
} = require('../utils/manualVipPayments');

const router = express.Router();
const authBodyParsers = createAuthBodyParsers();

const ALLOWED_USER_TYPES = new Set(['oauth', 'bip39']);
const STATUSES = new Set(['pending', 'approved', 'rejected']);
const MAX_NOTE_LENGTH = 500;
const MAX_KEY_ATTEMPTS = 5;

const setNoStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  return next();
};

const clientIpKey = (req) => getTrustedClientIp(req) || ipKeyGenerator(req.ip);

// Clé par compte ET par IP : un compte ne peut pas contourner la limite en
// changeant d'IP, ni une IP en changeant de compte.
const readRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  store: createRedisRateLimitStore({ prefix: 'rate-limit:vip-payments:read:' }),
  passOnStoreError: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Trop de vérifications. Réessayez dans quelques minutes.', code: 'RATE_LIMITED' },
  keyGenerator: clientIpKey,
  validate: { xForwardedForHeader: false, ip: false },
});

async function requireAccount(req, res, next) {
  try {
    const auth = await getAuthIfValid(req);
    if (!auth || !ALLOWED_USER_TYPES.has(auth.userType) || !auth.userId) {
      return res.status(401).json({ success: false, error: 'Connectez-vous pour continuer.', code: 'AUTH_REQUIRED' });
    }
    req.vipPaymentAuth = { userType: auth.userType, userId: String(auth.userId) };
    return next();
  } catch (error) {
    return next(error);
  }
}

function adminIdOf(req) {
  return String(req.admin?.adminId || req.admin?.userId || '');
}

function getSyncModule() {
  // Chargé à la demande : le module de sync installe ses propres ressources.
  return require('./sync');
}

// === Actions publiques désactivées ===

router.post('/vip-payments', setNoStore, (_req, res) => res.status(410).json({
  success: false,
  code: 'VIP_DISABLED',
}));

// === Suivi par l'utilisateur ===

router.get('/vip-payments/mine', setNoStore, requireAccount, readRateLimit, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const { userType, userId } = req.vipPaymentAuth;
    const [rows] = await pool.execute(
      `SELECT * FROM vip_payment_requests
        WHERE user_type = ? AND user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 20`,
      [userType, userId]
    );

    return res.json({
      success: true,
      requests: rows.map((row) => serializeVipPaymentRequest(row, { includeKey: true })),
    });
  } catch (error) {
    console.error('VIP payment requests (mine) error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de récupérer vos demandes.' });
  }
});

// === Administration ===

router.get('/admin/vip-payments', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const status = STATUSES.has(req.query?.status) ? req.query.status : null;
    const search = String(req.query?.search || '').trim().slice(0, 128);
    const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query?.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const clauses = [];
    const params = [];
    if (status) {
      clauses.push('status = ?');
      params.push(status);
    }
    if (search) {
      clauses.push('(reference LIKE ? OR payer_msisdn LIKE ? OR username LIKE ? OR user_id LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

    const [countRows] = await pool.execute(`SELECT COUNT(*) AS total FROM vip_payment_requests${where}`, params);
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await pool.execute(
      `SELECT * FROM vip_payment_requests${where} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return res.json({
      success: true,
      requests: rows.map((row) => serializeVipPaymentRequest(row, { includeKey: true })),
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
    });
  } catch (error) {
    console.error('VIP payment requests list error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de lister les demandes.' });
  }
});

/** Fin du VIP encore actif obtenu par ce parcours (ms epoch), sinon null. */
async function findCurrentExpiryMs(conn, userType, userId) {
  const [rows] = await conn.execute(
    `SELECT k.expires_at AS expires_at
       FROM vip_payment_requests r
       JOIN access_keys k ON k.key_value = r.access_key_value
      WHERE r.user_type = ? AND r.user_id = ? AND r.status = 'approved' AND k.active = 1
      ORDER BY k.expires_at DESC
      LIMIT 1`,
    [userType, userId]
  );
  const value = rows[0] ? Number(rows[0].expires_at) : NaN;
  return Number.isFinite(value) ? value : null;
}

async function insertUniqueAccessKey(conn, { expiresAtMs, planDays }) {
  for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt += 1) {
    const keyValue = generateVipKeyValue();
    try {
      await conn.execute(
        `INSERT INTO access_keys (key_value, active, used, duree_validite, expires_at, created_at, updated_at)
         VALUES (?, 1, 1, ?, ?, NOW(), NOW())`,
        [keyValue, `${planDays}d`, expiresAtMs]
      );
      return keyValue;
    } catch (error) {
      if (!error || error.code !== 'ER_DUP_ENTRY') throw error;
    }
  }
  throw new Error('Impossible de générer une clé unique.');
}

router.post('/admin/vip-payments/:id/confirm', setNoStore, isAdmin, ...authBodyParsers, async (req, res) => {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
  }

  const requestId = Number(req.params.id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return res.status(400).json({ success: false, error: 'Identifiant de demande invalide.' });
  }
  const note = String(req.body?.note || '').slice(0, MAX_NOTE_LENGTH).trim() || null;

  let request = null;
  let keyValue = null;
  let expiresAtMs = null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Verrou de ligne : deux admins ne génèrent pas deux clés pour un paiement.
    const [rows] = await conn.execute('SELECT * FROM vip_payment_requests WHERE id = ? FOR UPDATE', [requestId]);
    request = rows[0];
    if (!request) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: 'Demande introuvable.' });
    }
    if (request.status !== 'pending') {
      await conn.rollback();
      return res.status(409).json({ success: false, error: 'Cette demande a déjà été traitée.', status: request.status });
    }

    const plan = getPlanById(request.plan_id);
    const planDays = plan ? plan.days : Number(request.plan_days);
    const currentExpiryMs = await findCurrentExpiryMs(conn, request.user_type, request.user_id);
    expiresAtMs = computeKeyExpiry({ planDays, currentExpiryMs });
    keyValue = await insertUniqueAccessKey(conn, { expiresAtMs, planDays });

    const [update] = await conn.execute(
      `UPDATE vip_payment_requests
          SET status = 'approved', access_key_value = ?, key_expires_at = ?, admin_note = ?,
              reviewed_at = NOW(), reviewed_by = ?, updated_at = NOW()
        WHERE id = ? AND status = 'pending'`,
      [keyValue, expiresAtMs, note, adminIdOf(req), requestId]
    );
    if (!update.affectedRows) {
      await conn.rollback();
      return res.status(409).json({ success: false, error: 'Cette demande a déjà été traitée.' });
    }
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch { /* rollback best effort */ }
    console.error('VIP payment confirm error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de valider la demande.' });
  } finally {
    conn.release();
  }

  invalidateVipCache(keyValue);

  // Hors transaction : les données de profil vivent dans le module de sync
  // (fichiers). En échec, la clé reste affichée à l'utilisateur et à l'admin.
  let linked = false;
  try {
    linked = await linkAccessKeyToAccount(getSyncModule(), {
      userType: request.user_type,
      userId: String(request.user_id),
      keyValue,
      expiresAtMs,
    });
    if (linked) {
      await pool.execute('UPDATE vip_payment_requests SET account_linked = 1 WHERE id = ?', [requestId]);
    }
  } catch (error) {
    console.error('VIP payment account link failed:', error?.message || error);
  }

  const [updated] = await pool.execute('SELECT * FROM vip_payment_requests WHERE id = ?', [requestId]);
  return res.json({
    success: true,
    request: serializeVipPaymentRequest(updated[0], { includeKey: true }),
    accessKey: keyValue,
    accountLinked: linked,
  });
});

router.post('/admin/vip-payments/:id/reject', setNoStore, isAdmin, ...authBodyParsers, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ success: false, error: 'Identifiant de demande invalide.' });
    }
    const note = String(req.body?.note || '').slice(0, MAX_NOTE_LENGTH).trim() || null;

    const [result] = await pool.execute(
      `UPDATE vip_payment_requests
          SET status = 'rejected', admin_note = ?, reviewed_at = NOW(), reviewed_by = ?, updated_at = NOW()
        WHERE id = ? AND status = 'pending'`,
      [note, adminIdOf(req), requestId]
    );

    const [rows] = await pool.execute('SELECT * FROM vip_payment_requests WHERE id = ?', [requestId]);
    if (!rows[0]) {
      return res.status(404).json({ success: false, error: 'Demande introuvable.' });
    }
    if (!result.affectedRows) {
      return res.status(409).json({ success: false, error: 'Cette demande a déjà été traitée.', status: rows[0].status });
    }

    return res.json({ success: true, request: serializeVipPaymentRequest(rows[0], { includeKey: true }) });
  } catch (error) {
    console.error('VIP payment reject error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de refuser la demande.' });
  }
});

router.use(jsonParseErrorHandler);

module.exports = router;
