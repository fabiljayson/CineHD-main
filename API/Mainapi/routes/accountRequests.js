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
 *   POST /api/account-requests                dépôt d'une demande (collecte manuelle)
 *   POST /api/account-requests/status         état d'une demande (jamais le code)
 *   POST /api/account-requests/checkout       paiement en ligne CamPay (USSD push)
 *   POST /api/account-requests/checkout/status  suivi d'une collecte CamPay
 *   GET  /api/admin/account-requests          liste admin
 *   POST /api/admin/account-requests/:id/approve          validation + code
 *   POST /api/admin/account-requests/:id/reject           refus motivé
 *   POST /api/admin/account-requests/:id/regenerate-code  nouveau code
 */

const crypto = require('crypto');
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
const { createSubscriptionReceipt } = require('../utils/accountSubscriptions');
const {
  getTransactionStatus,
  initCollect,
  isCamPayConfigured,
} = require('../utils/camPay');

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

// Le suivi CamPay est un pollage (invite USSD confirmée en général en moins de
// deux minutes) : le plafond est donc plus haut que pour le suivi manuel.
const checkoutStatusRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 90,
  store: createRedisRateLimitStore({ prefix: 'rate-limit:account-requests:checkout-status:' }),
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

/**
 * Format attendu par CamPay (ER101) : chiffres seuls commençant par 237.
 * normalizeMsisdn ne préfixe pas les numbers 9 chiffres saisis sans zéro.
 */
function toCamPayMsisdn(raw) {
  const normalized = normalizeMsisdn(raw);
  if (normalized.startsWith('237')) return normalized;
  if (normalized.length === 9) return `237${normalized}`;
  return null;
}

/** Référence marchande (external_reference CamPay) : unique par construction. */
function generateCheckoutReference() {
  return `CINE-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
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
    campayStatus: row.campay_status || null,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
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
  return res.json({ success: true, campay: isCamPayConfigured(), ...serializePlansPayload() });
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

// === Paiement en ligne (CamPay, collecte push USSD) ===

/**
 * Applique un paiement CamPay confirmé : crée le compte (validation
 * existante), génère le reçu et démarre le minuteur d'abonnement.
 *
 * @returns {Promise<{ settled: boolean, code: string|null, reason?: string }>}
 *   `code` n'est renvoyé qu'au moment du passage à approved (affiché une fois
 *   à l'acheteur) ; un rejeu du poll ne le sert jamais en différé.
 */
async function settleCamPayPayment(pool, request, camPayStatus) {
  // Montant confirmé par l'opérateur : en dessous du montant de la demande,
  // on refuse (tentative de fraude ou configuration erronée) et on laisse une
  // trace lisible pour l'admin.
  const confirmedAmount = camPayStatus.amountFcfa;
  if (confirmedAmount !== null && Number(confirmedAmount) < Number(request.amount_fcfa)) {
    await pool.execute(
      `UPDATE account_requests SET campay_status = 'FAILED', admin_note = ?, updated_at = NOW() WHERE id = ?`,
      [`CamPay : montant confirmé ${confirmedAmount} FCFA inférieur aux ${request.amount_fcfa} FCFA demandés.`, request.id]
    );
    return { settled: false, code: null, reason: 'amount_mismatch' };
  }

  await pool.execute(
    `UPDATE account_requests SET campay_status = 'SUCCESSFUL', campay_operator = COALESCE(campay_operator, ?), paid_at = NOW(), updated_at = NOW() WHERE id = ?`,
    [camPayStatus.operator, request.id]
  );

  // Validation = création du credential sous verrou de ligne (voir
  // utils/accountApproval.js) : deux polls simultanés ne créent pas deux comptes.
  let code = null;
  try {
    const approval = await approveAccountRequest(pool, request.id, { adminId: 'campay' });
    code = approval.code;
  } catch (error) {
    if (!error || error.status !== 409) throw error;
    // 409 = validation concurrente déjà faite (autre poll ou admin) ou demande
    // refusée entre-temps : seule la première situation a un compte à prolonger.
    const [checkRows] = await pool.execute('SELECT status FROM account_requests WHERE id = ?', [request.id]);
    if (!checkRows[0] || checkRows[0].status !== 'approved') {
      return { settled: false, code: null, reason: 'rejected' };
    }
  }

  // Reçu + minuteur : prolongation empilée gérée par createSubscriptionReceipt
  // (transaction + verrou du credential).
  const [credRows] = await pool.execute('SELECT credential_id FROM account_requests WHERE id = ?', [request.id]);
  const credentialId = credRows[0] && credRows[0].credential_id;
  if (credentialId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await createSubscriptionReceipt(conn, {
        requestId: request.id,
        credentialId: Number(credentialId),
        issuedBy: 'campay',
        planId: request.plan_id,
        amountFcfa: Number(request.amount_fcfa),
        paymentMethod: request.payment_method,
        payerMsisdn: request.payer_msisdn,
        paymentReference: request.campay_reference || '',
      });
      await conn.commit();
    } catch (error) {
      try { await conn.rollback(); } catch { /* rollback best effort */ }
      // ER_DUP_ENTRY = reçu déjà émis (rejeu après un crash entre la validation
      // et le reçu) : le minuteur est déjà bon, rien à refaire.
      if (!error || error.code !== 'ER_DUP_ENTRY') {
        console.error('CamPay receipt creation failed:', error);
      }
    } finally {
      conn.release();
    }
  }

  return { settled: true, code };
}

/**
 * Démarre une collecte CamPay : crée la demande (référence marchande
 * générée côté serveur) et déclenche l'invitation USSD sur le téléphone de
 * l'acheteur. Sans CamPay configuré, la collecte manuelle reste le parcours.
 */
router.post('/account-requests/checkout', setNoStore, createRequestRateLimit, ...authBodyParsers, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }
    if (!isCamPayConfigured()) {
      return res.status(409).json({ success: false, error: 'Paiement en ligne indisponible.', code: 'CAMPAY_NOT_CONFIGURED' });
    }

    const { planId, amountFcfa, paymentMethod, payerMsisdn, username, turnstileToken } = req.body || {};

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

    const msisdn = toCamPayMsisdn(payerMsisdn);
    if (!msisdn) {
      return res.status(400).json({ success: false, error: 'Numéro mobile money invalide.', code: 'INVALID_MSISDN' });
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

    const reference = generateCheckoutReference();
    let insertId;
    try {
      const [result] = await pool.execute(
        `INSERT INTO account_requests (reference, plan_id, amount_fcfa, payment_method, payer_msisdn, username, status, campay_status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 'PENDING')`,
        [reference, plan.id, amountFcfa, method.id, msisdn, cleanUsername]
      );
      insertId = result.insertId;
    } catch (error) {
      if (error && error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, error: 'Ce pseudo est déjà utilisé.', code: 'USERNAME_TAKEN' });
      }
      throw error;
    }

    let collect;
    try {
      collect = await initCollect({
        amountFcfa,
        msisdn,
        description: `CineHD abonnement ${plan.id}`,
        externalReference: reference,
      });
    } catch (error) {
      await pool.execute(
        `UPDATE account_requests SET campay_status = 'FAILED', admin_note = ?, updated_at = NOW() WHERE id = ?`,
        [String(error.message || 'Initiation CamPay échouée.').slice(0, 500), insertId]
      );
      return res.status(error.status || 502).json({ success: false, error: error.message, code: 'CAMPAY_INIT_FAILED' });
    }

    await pool.execute(
      'UPDATE account_requests SET campay_reference = ?, campay_operator = ?, updated_at = NOW() WHERE id = ?',
      [collect.reference, collect.operator, insertId]
    );

    const [rows] = await pool.execute('SELECT * FROM account_requests WHERE id = ?', [insertId]);
    return res.status(201).json({
      success: true,
      request: serializeRequest(rows[0]),
      camPay: { reference: collect.reference, ussdCode: collect.ussdCode, operator: collect.operator },
    });
  } catch (error) {
    console.error('Account checkout error:', error);
    return res.status(500).json({ success: false, error: "Impossible d'initialiser le paiement." });
  }
});

/**
 * Suit une collecte CamPay : interroge l'opérateur et règle la demande quand
 * le paiement est confirmé (validation + reçu automatiques). Le code de
 * connexion n'est servi qu'une fois, sur le passage à approved.
 */
router.post('/account-requests/checkout/status', setNoStore, checkoutStatusRateLimit, ...authBodyParsers, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const reference = String(req.body?.reference || '').trim();
    if (!reference) {
      return res.status(400).json({ success: false, error: 'Référence de paiement requise.' });
    }

    const [rows] = await pool.execute(
      'SELECT * FROM account_requests WHERE campay_reference = ? ORDER BY id DESC LIMIT 1',
      [reference]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Aucune demande trouvée.' });
    }
    const request = rows[0];

    // Réglée (approved/rejected) : le code n'est jamais servi en différé — il
    // vaut mot de passe, affiché une seule fois au moment du règlement.
    if (request.status !== 'pending') {
      return res.json({ success: true, status: request.status, operator: request.campay_operator || null });
    }
    if (request.campay_status === 'FAILED') {
      return res.json({ success: true, status: 'failed', operator: request.campay_operator || null });
    }

    let camPayStatus;
    try {
      camPayStatus = await getTransactionStatus(request.campay_reference);
    } catch (error) {
      // CamPay injoignable : la demande reste en attente, le client rejouera.
      console.error('CamPay status lookup failed:', error && error.message);
      return res.json({ success: true, status: 'pending', operator: request.campay_operator || null });
    }

    if (camPayStatus.status === 'SUCCESSFUL') {
      const settle = await settleCamPayPayment(pool, request, camPayStatus);
      const [freshRows] = await pool.execute('SELECT * FROM account_requests WHERE id = ?', [request.id]);
      const fresh = freshRows[0];
      return res.json({
        success: true,
        status: settle.settled ? 'approved' : (fresh && fresh.status === 'rejected' ? 'rejected' : 'failed'),
        code: settle.code || null,
        username: settle.code && fresh ? fresh.username : null,
        operator: (fresh && fresh.campay_operator) || camPayStatus.operator || null,
      });
    }

    if (camPayStatus.status === 'FAILED') {
      await pool.execute(
        `UPDATE account_requests SET campay_status = 'FAILED', updated_at = NOW() WHERE id = ?`,
        [request.id]
      );
      return res.json({ success: true, status: 'failed', operator: camPayStatus.operator || null });
    }

    // PENDING (ou statut inconnu) : on rejouera le poll côté client.
    return res.json({ success: true, status: 'pending', operator: request.campay_operator || camPayStatus.operator || null });
  } catch (error) {
    console.error('Account checkout status error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de vérifier le paiement.' });
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
