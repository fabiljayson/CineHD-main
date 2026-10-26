/**
 * Demandes de création de compte par paiement mobile money.
 *
 * Parcours : l'acheteur choisit une offre, règle elle-même sur un numéro
 * MTN MoMo / Orange Money, saisit la référence de sa transaction et un pseudo,
 * puis un admin valide. La validation génère le code de connexion (voir
 * utils/accountCredentials.js) qui sert de mot de passe sur /login.
 *
 * Mount point: app.use('/api', require('./routes/accountRequests'))
 *   GET  /api/account-requests/plans          offres + numéros de collecte
 *   POST /api/account-requests                dépôt d'une demande
 *   POST /api/account-requests/status         état d'une demande (jamais le code)
 *   GET  /api/admin/account-requests          liste admin
 *   POST /api/admin/account-requests/:id/approve          validation + code
 *   POST /api/admin/account-requests/:id/reject           refus motivé
 *   POST /api/admin/account-requests/:id/regenerate-code  nouveau code
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { getPool } = require('../mysqlPool');
const { isAdmin } = require('../middleware/auth');
const { createRedisRateLimitStore } = require('../utils/redisRateLimitStore');
const { getTrustedClientIp } = require('../utils/clientIp');
const { verifyTurnstileFromRequest } = require('../utils/turnstile');
const { createAuthBodyParsers } = require('../middleware/bodyParsing');
const { jsonParseErrorHandler } = require('../middleware/security');
const { isProfileNameValid } = require('../utils/syncPolicy');
const {
  getPlanById,
  getPaymentMethodById,
  getConfiguredPaymentMethods,
  serializePlansPayload,
  validatePlanSelection,
} = require('../utils/accountPlans');
const {
  normalizeAccountCode,
  hashAccountCode,
  generateAccountCode,
} = require('../utils/accountCredentials');
const { approveAccountRequest } = require('../utils/accountApproval');

const router = express.Router();
const authBodyParsers = createAuthBodyParsers();

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{3,127}$/;
const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 32;

const setNoStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  return next();
};

const clientKey = (req) => getTrustedClientIp(req) || ipKeyGenerator(req.ip);

const createRequestRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 6,
  store: createRedisRateLimitStore({ prefix: 'rate-limit:account-requests:create:' }),
  passOnStoreError: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Trop de demandes envoyées. Réessayez dans une heure.' },
  keyGenerator: clientKey,
  validate: { xForwardedForHeader: false, ip: false },
});

const statusRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  store: createRedisRateLimitStore({ prefix: 'rate-limit:account-requests:status:' }),
  passOnStoreError: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Trop de vérifications. Réessayez dans 15 minutes.' },
  keyGenerator: clientKey,
  validate: { xForwardedForHeader: false, ip: false },
});

/** 6XXXXXXXX → 2376XXXXXXXX, chiffres seuls, 9 à 15 caractères. */
function normalizeMsisdn(raw) {
  let digits = String(raw || '').replace(/\D+/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('237')) return digits;
  if (digits.length === 10 && digits.startsWith('0')) return `237${digits.slice(1)}`;
  return digits;
}

function normalizeReference(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function normalizeUsername(raw) {
  return String(raw || '').normalize('NFKD').replace(/\p{Cc}|\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
}

function validateUsername(username) {
  if (!isProfileNameValid(username)) return 'Pseudo invalide.';
  if (username.length < USERNAME_MIN_LENGTH) return `Le pseudo doit faire au moins ${USERNAME_MIN_LENGTH} caractères.`;
  if (username.length > USERNAME_MAX_LENGTH) return `Le pseudo ne peut pas dépasser ${USERNAME_MAX_LENGTH} caractères.`;
  return null;
}

function serializeRequest(row) {
  return {
    id: Number(row.id),
    reference: row.reference,
    planId: row.plan_id,
    amountFcfa: Number(row.amount_fcfa),
    paymentMethod: row.payment_method,
    payerMsisdn: row.payer_msisdn,
    username: row.username,
    status: row.status,
    adminNote: row.admin_note || null,
    credentialId: row.credential_id == null ? null : Number(row.credential_id),
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    reviewedBy: row.reviewed_by || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function serializeAdminRequest(row) {
  return serializeRequest(row);
}

// === Offres publiques ===

router.get('/account-requests/plans', setNoStore, (req, res) => {
  return res.json({ success: true, ...serializePlansPayload() });
});

// === Dépôt d'une demande ===

router.post('/account-requests', setNoStore, createRequestRateLimit, ...authBodyParsers, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const {
      planId,
      amountFcfa,
      paymentMethod,
      payerMsisdn,
      reference,
      username,
      turnstileToken,
    } = req.body || {};

    const turnstileResult = await verifyTurnstileFromRequest(req, turnstileToken);
    if (!turnstileResult.valid) {
      return res.status(turnstileResult.status).json({ success: false, error: turnstileResult.error });
    }

    const plan = getPlanById(String(planId || ''));
    const method = getPaymentMethodById(String(paymentMethod || ''));
    const selectionError = validatePlanSelection(plan, amountFcfa, method);
    if (selectionError) {
      return res.status(400).json({ success: false, error: selectionError, code: 'INVALID_SELECTION' });
    }

    const isConfigured = getConfiguredPaymentMethods().some((entry) => entry.id === method.id);
    if (!isConfigured) {
      return res.status(400).json({ success: false, error: 'Moyen de paiement indisponible.', code: 'METHOD_NOT_CONFIGURED' });
    }

    const msisdn = normalizeMsisdn(payerMsisdn);
    if (msisdn.length < 9 || msisdn.length > 15) {
      return res.status(400).json({ success: false, error: 'Numéro mobile money invalide.', code: 'INVALID_MSISDN' });
    }

    const cleanReference = normalizeReference(reference);
    if (!REFERENCE_PATTERN.test(cleanReference)) {
      return res.status(400).json({ success: false, error: 'Référence de transaction invalide.', code: 'INVALID_REFERENCE' });
    }

    const cleanUsername = normalizeUsername(username);
    const usernameError = validateUsername(cleanUsername);
    if (usernameError) {
      return res.status(400).json({ success: false, error: usernameError, code: 'INVALID_USERNAME' });
    }

    const [takenRows] = await pool.execute(
      'SELECT id FROM account_credentials WHERE username = ? AND active = 1 LIMIT 1',
      [cleanUsername]
    );
    if (takenRows.length > 0) {
      return res.status(409).json({ success: false, error: 'Ce pseudo est déjà utilisé.', code: 'USERNAME_TAKEN' });
    }

    let insertId;
    try {
      const [result] = await pool.execute(
        `INSERT INTO account_requests (reference, plan_id, amount_fcfa, payment_method, payer_msisdn, username, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [cleanReference, plan.id, amountFcfa, method.id, msisdn, cleanUsername]
      );
      insertId = result.insertId;
    } catch (error) {
      if (error && error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          error: 'Cette référence de transaction a déjà été utilisée.',
          code: 'DUPLICATE_REFERENCE',
        });
      }
      throw error;
    }

    const [rows] = await pool.execute('SELECT * FROM account_requests WHERE id = ?', [insertId]);
    return res.status(201).json({ success: true, request: serializeRequest(rows[0]) });
  } catch (error) {
    console.error('Account request creation error:', error);
    return res.status(500).json({ success: false, error: 'Impossible d\'enregistrer la demande.' });
  }
});

// === Suivi d'une demande (n'expose jamais le code) ===

router.post('/account-requests/status', setNoStore, statusRateLimit, ...authBodyParsers, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const { reference, payerMsisdn } = req.body || {};
    const cleanReference = normalizeReference(reference);
    const msisdn = normalizeMsisdn(payerMsisdn);
    if (!cleanReference || !msisdn) {
      return res.status(400).json({ success: false, error: 'Référence et numéro requis.' });
    }

    const [rows] = await pool.execute(
      'SELECT status FROM account_requests WHERE reference = ? AND payer_msisdn = ? ORDER BY id DESC LIMIT 1',
      [cleanReference, msisdn]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Aucune demande trouvée.' });
    }

    return res.json({ success: true, status: rows[0].status });
  } catch (error) {
    console.error('Account request status error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de vérifier la demande.' });
  }
});

// === Administration ===

router.get('/admin/account-requests', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const clauses = [];
    const params = [];
    if (status) {
      clauses.push('status = ?');
      params.push(status);
    }
    if (search) {
      clauses.push('(reference LIKE ? OR payer_msisdn LIKE ? OR username LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM account_requests${where}`,
      params
    );
    const total = Number(countRows[0].total);

    const [rows] = await pool.execute(
      `SELECT * FROM account_requests${where} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return res.json({
      success: true,
      requests: rows.map(serializeAdminRequest),
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
    });
  } catch (error) {
    console.error('Account requests list error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de lister les demandes.' });
  }
});

router.post('/admin/account-requests/:id/approve', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const result = await approveAccountRequest(pool, Number(req.params.id), req.admin);
    const [rows] = await pool.execute('SELECT * FROM account_requests WHERE id = ?', [Number(req.params.id)]);

    return res.json({
      success: true,
      request: serializeAdminRequest(rows[0]),
      // Code en clair : affiché une fois à l'admin, à transmettre sur WhatsApp.
      code: result.code,
      userId: result.userId,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    console.error('Account request approve error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de valider la demande.' });
  }
});

router.post('/admin/account-requests/:id/reject', setNoStore, isAdmin, ...authBodyParsers, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const requestId = Number(req.params.id);
    const note = String(req.body?.note || '').slice(0, 500).trim() || null;

    const [rows] = await pool.execute('SELECT * FROM account_requests WHERE id = ?', [requestId]);
    const request = rows[0];
    if (!request) {
      return res.status(404).json({ success: false, error: 'Demande introuvable.' });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({ success: false, error: 'Cette demande a déjà été traitée.' });
    }

    await pool.execute(
      `UPDATE account_requests SET status = 'rejected', admin_note = ?, reviewed_at = NOW(), reviewed_by = ?
       WHERE id = ? AND status = 'pending'`,
      [note, String(req.admin?.adminId || req.admin?.userId || ''), requestId]
    );

    const [updated] = await pool.execute('SELECT * FROM account_requests WHERE id = ?', [requestId]);
    return res.json({ success: true, request: serializeAdminRequest(updated[0]) });
  } catch (error) {
    console.error('Account request reject error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de refuser la demande.' });
  }
});

/** Régénère le code d'une demande déjà validée (le code n'étant jamais stocké en clair). */
router.post('/admin/account-requests/:id/regenerate-code', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const requestId = Number(req.params.id);
    const [rows] = await pool.execute('SELECT * FROM account_requests WHERE id = ?', [requestId]);
    const request = rows[0];
    if (!request || request.status !== 'approved' || !request.credential_id) {
      return res.status(409).json({ success: false, error: 'Seule une demande validée a un code à régénérer.' });
    }

    const code = generateAccountCode();
    const codeHash = hashAccountCode(normalizeAccountCode(code));
    const [result] = await pool.execute(
      'UPDATE account_credentials SET code_hash = ?, updated_at = NOW() WHERE id = ? AND active = 1',
      [codeHash, Number(request.credential_id)]
    );
    if (!result.affectedRows) {
      return res.status(409).json({ success: false, error: 'Identifiant de code introuvable.' });
    }

    return res.json({ success: true, request: serializeAdminRequest(request), code });
  } catch (error) {
    console.error('Account request regenerate error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de régénérer le code.' });
  }
});

router.use(jsonParseErrorHandler);

module.exports = router;
