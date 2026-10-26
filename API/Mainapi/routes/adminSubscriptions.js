/**
 * Console d'abonnements (réservée aux admins).
 *
 * Gère le cycle de vie commercial de CineHD : comptes abonnés et leur minuteur,
 * offres de renouvellement proposées par l'équipe, et confirmation des
 * transactions mobile money par génération d'un reçu.
 *
 * Mount point: app.use('/api', require('./routes/adminSubscriptions'))
 *   GET    /api/account/bargains                       offres actives (public)
 *   GET    /api/admin/subscriptions/users              liste des comptes + minuteur
 *   PATCH  /api/admin/subscriptions/users/:id          fixer / prolonger / réinitialiser le minuteur, activer, désactiver
 *   GET    /api/admin/subscriptions/receipts           historique des reçus
 *   POST   /api/admin/subscriptions/transactions/:id/receipt  valider + générer le reçu
 *   GET    /api/admin/subscriptions/bargains           toutes les offres
 *   POST   /api/admin/subscriptions/bargains           créer une offre
 *   PATCH  /api/admin/subscriptions/bargains/:id       modifier une offre
 *   DELETE /api/admin/subscriptions/bargains/:id       retirer une offre
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const { getPool } = require('../mysqlPool');
const { isAdmin } = require('../middleware/auth');
const { createRedisRateLimitStore } = require('../utils/redisRateLimitStore');
const { getTrustedClientIp } = require('../utils/clientIp');
const { createAuthBodyParsers } = require('../middleware/bodyParsing');
const { jsonParseErrorHandler } = require('../middleware/security');
const { getPlanById } = require('../utils/accountPlans');
const { approveAccountRequest } = require('../utils/accountApproval');
const {
  addDays,
  createSubscriptionReceipt,
  parseSqlDateTime,
  serializeAccountUser,
  serializeBargain,
  serializeReceipt,
  toSqlDateTime,
} = require('../utils/accountSubscriptions');

const router = express.Router();
const authBodyParsers = createAuthBodyParsers();

const setNoStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  return next();
};

const clientKey = (req) => getTrustedClientIp(req) || ipKeyGenerator(req.ip);

const bargainsPublicRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  store: createRedisRateLimitStore({ prefix: 'rate-limit:subscriptions:bargains:' }),
  passOnStoreError: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Trop de requêtes. Réessayez dans quelques minutes.' },
  keyGenerator: clientKey,
  validate: { xForwardedForHeader: false, ip: false },
});

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const MAX_BARGAIN_DAYS = 3650;

function adminIdOf(req) {
  return String(req.admin?.adminId || req.admin?.userId || '');
}

function parsePagination(query) {
  const rawPage = Number.parseInt(query?.page, 10);
  const rawLimit = Number.parseInt(query?.limit, 10);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  return { page, limit, offset: (page - 1) * limit };
}

function serializeRequest(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    reference: row.reference,
    planId: row.plan_id,
    amountFcfa: Number(row.amount_fcfa),
    paymentMethod: row.payment_method,
    payerMsisdn: row.payer_msisdn,
    username: row.username,
    status: row.status,
    credentialId: row.credential_id == null ? null : Number(row.credential_id),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

// === Offres publiques ===

/**
 * Offres de renouvellement actuellement publiées. Affichées côté client
 * (page de connexion / création de compte) pour pousser un renouvellement.
 */
router.get('/account/bargains', setNoStore, bargainsPublicRateLimit, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const [rows] = await pool.execute(
      `SELECT * FROM subscription_bargains
        WHERE active = 1
          AND (starts_at IS NULL OR starts_at <= NOW())
          AND (ends_at IS NULL OR ends_at >= NOW())
        ORDER BY price_fcfa ASC`,
    );

    return res.json({ success: true, bargains: rows.map(serializeBargain) });
  } catch (error) {
    console.error('Public bargains error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de lister les offres.' });
  }
});

// === Comptes abonnés ===

router.get('/admin/subscriptions/users', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const search = String(req.query?.search || '').trim();
    const { page, limit, offset } = parsePagination(req.query);

    const filters = [];
    const params = [];
    if (search) {
      filters.push('(username LIKE ? OR user_id LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM account_credentials ${where}`,
      params,
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await pool.execute(
      `SELECT * FROM account_credentials ${where}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    return res.json({
      success: true,
      users: rows.map(serializeAccountUser),
      page,
      limit,
      total,
      hasMore: offset + rows.length < total,
    });
  } catch (error) {
    console.error('Subscription users list error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de lister les comptes.' });
  }
});

/**
 * Fixe le minuteur d'un compte.
 *   { expiresAt: '2027-01-01T00:00:00Z' | null }  fixe une date absolue (null = réinitialise)
 *   { addDays: 30 }                                prolonge à partir de la date courante ou de maintenant
 *   { active: false }                              désactive / réactive le compte
 */
router.patch('/admin/subscriptions/users/:id', setNoStore, isAdmin, ...authBodyParsers, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const credentialId = Number(req.params.id);
    if (!Number.isInteger(credentialId) || credentialId <= 0) {
      return res.status(400).json({ success: false, error: 'Identifiant de compte invalide.' });
    }

    const body = req.body || {};
    const hasExpiryInput = Object.prototype.hasOwnProperty.call(body, 'expiresAt');
    const hasAddDays = Object.prototype.hasOwnProperty.call(body, 'addDays');
    const hasActive = Object.prototype.hasOwnProperty.call(body, 'active');

    if (!hasExpiryInput && !hasAddDays && !hasActive) {
      return res.status(400).json({ success: false, error: 'Aucune mise à jour fournie.' });
    }

    const [rows] = await pool.execute(
      'SELECT id, subscription_expires_at FROM account_credentials WHERE id = ?',
      [credentialId],
    );
    const credential = rows[0];
    if (!credential) {
      return res.status(404).json({ success: false, error: 'Compte introuvable.' });
    }

    const updates = [];
    const params = [];

    if (hasExpiryInput) {
      if (body.expiresAt === null) {
        updates.push('subscription_expires_at = NULL');
      } else {
        const parsed = parseSqlDateTime(body.expiresAt);
        if (!parsed) {
          return res.status(400).json({ success: false, error: 'Date d’expiration invalide.' });
        }
        updates.push('subscription_expires_at = ?');
        params.push(toSqlDateTime(parsed));
      }
    } else if (hasAddDays) {
      const days = Number(body.addDays);
      if (!Number.isFinite(days) || !Number.isInteger(days) || days < 0 || days > MAX_BARGAIN_DAYS) {
        return res.status(400).json({ success: false, error: 'Nombre de jours invalide.' });
      }
      const current = parseSqlDateTime(credential.subscription_expires_at);
      const base = current && current.getTime() > Date.now() ? current : new Date();
      updates.push('subscription_expires_at = ?');
      params.push(toSqlDateTime(addDays(base, days)));
    }

    if (hasActive) {
      if (typeof body.active !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Valeur active invalide.' });
      }
      updates.push('active = ?');
      params.push(body.active ? 1 : 0);
    }

    params.push(credentialId);
    await pool.execute(
      `UPDATE account_credentials SET ${updates.join(', ')} WHERE id = ?`,
      params,
    );

    const [updated] = await pool.execute('SELECT * FROM account_credentials WHERE id = ?', [credentialId]);
    return res.json({ success: true, user: serializeAccountUser(updated[0]) });
  } catch (error) {
    console.error('Subscription user update error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de mettre à jour le compte.' });
  }
});

// === Reçus ===

router.get('/admin/subscriptions/receipts', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const search = String(req.query?.search || '').trim();
    const { page, limit, offset } = parsePagination(req.query);

    const filters = [];
    const params = [];
    if (search) {
      filters.push('(public_id LIKE ? OR username LIKE ? OR payment_reference LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM subscription_receipts ${where}`,
      params,
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await pool.execute(
      `SELECT * FROM subscription_receipts ${where}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    return res.json({
      success: true,
      receipts: rows.map(serializeReceipt),
      page,
      limit,
      total,
      hasMore: offset + rows.length < total,
    });
  } catch (error) {
    console.error('Subscription receipts list error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de lister les reçus.' });
  }
});

/**
 * Confirme une transaction mobile money et génère le reçu d'abonnement.
 * Si la demande est encore en attente, elle est validée au passage (le compte
 * est créé) puis le reçu prolonge son minuteur. Un seul reçu par transaction.
 */
router.post('/admin/subscriptions/transactions/:id/receipt', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ success: false, error: 'Identifiant de transaction invalide.' });
    }

    const [rows] = await pool.execute('SELECT * FROM account_requests WHERE id = ?', [requestId]);
    const request = rows[0];
    if (!request) {
      return res.status(404).json({ success: false, error: 'Transaction introuvable.' });
    }
    if (request.status === 'rejected') {
      return res.status(409).json({ success: false, error: 'Cette transaction a été refusée.' });
    }

    let code = null;
    let userId = null;
    let credentialId = request.credential_id;

    if (request.status === 'pending') {
      // Validation : crée le credential + le code affiché une fois à l'admin.
      const approved = await approveAccountRequest(pool, requestId, req.admin);
      code = approved.code;
      userId = approved.userId;
      const [approvedRows] = await pool.execute(
        'SELECT credential_id FROM account_requests WHERE id = ?',
        [requestId],
      );
      credentialId = approvedRows[0]?.credential_id ?? null;
    }

    if (!credentialId) {
      return res.status(409).json({ success: false, error: 'Aucun compte associé à cette transaction.' });
    }

    const conn = await pool.getConnection();
    let receipt = null;
    try {
      await conn.beginTransaction();
      receipt = await createSubscriptionReceipt(conn, {
        requestId,
        credentialId,
        issuedBy: adminIdOf(req),
        amountFcfa: Number(request.amount_fcfa) || 0,
        paymentMethod: request.payment_method,
        payerMsisdn: request.payer_msisdn,
        paymentReference: request.reference,
        planId: request.plan_id,
      });
      await conn.commit();
    } catch (error) {
      try { await conn.rollback(); } catch { /* rollback best effort */ }
      if (error?.code === 'ER_DUP_ENTRY') {
        const [existing] = await pool.execute(
          'SELECT * FROM subscription_receipts WHERE request_id = ? LIMIT 1',
          [requestId],
        );
        return res.status(409).json({
          success: false,
          error: 'Un reçu existe déjà pour cette transaction.',
          receipt: serializeReceipt(existing[0]),
        });
      }
      if (error.status) {
        return res.status(error.status).json({ success: false, error: error.message });
      }
      throw error;
    } finally {
      conn.release();
    }

    const [updated] = await pool.execute('SELECT * FROM account_requests WHERE id = ?', [requestId]);
    return res.json({
      success: true,
      receipt,
      // Code en clair : affiché une fois à l'admin, à transmettre sur WhatsApp.
      code,
      userId,
      request: serializeRequest(updated[0]),
    });
  } catch (error) {
    console.error('Subscription receipt generation error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de générer le reçu.' });
  }
});

// === Offres de renouvellement (gestion) ===

function validateBargainInput(body, { partial = false } = {}) {
  const errors = [];
  const values = {};

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'title')) {
    const title = String(body.title || '').trim();
    if (!title || title.length > 128) errors.push('Titre invalide.');
    else values.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    const description = body.description == null ? null : String(body.description).trim().slice(0, 500);
    values.description = description || null;
  } else if (!partial) {
    values.description = null;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'planId')) {
    const plan = getPlanById(String(body.planId || ''));
    if (!plan) errors.push('Offre inconnue.');
    else values.planId = plan.id;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, 'priceFcfa')) {
    const price = Number(body.priceFcfa);
    if (!Number.isInteger(price) || price <= 0 || price > 10_000_000) errors.push('Prix invalide.');
    else values.priceFcfa = price;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'active')) {
    if (typeof body.active !== 'boolean') errors.push('Valeur active invalide.');
    else values.active = body.active ? 1 : 0;
  } else if (!partial) {
    values.active = 1;
  }

  for (const key of ['startsAt', 'endsAt']) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      if (body[key] === null) {
        values[key] = null;
      } else {
        const parsed = parseSqlDateTime(body[key]);
        if (!parsed) errors.push(`Date ${key} invalide.`);
        else values[key] = toSqlDateTime(parsed);
      }
    } else if (!partial) {
      values[key] = null;
    }
  }

  return { errors, values };
}

router.get('/admin/subscriptions/bargains', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const includeInactive = String(req.query?.includeInactive || '') === '1';
    const [rows] = await pool.execute(
      `SELECT * FROM subscription_bargains ${includeInactive ? '' : 'WHERE active = 1'}
        ORDER BY created_at DESC`,
    );

    return res.json({ success: true, bargains: rows.map(serializeBargain) });
  } catch (error) {
    console.error('Admin bargains list error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de lister les offres.' });
  }
});

router.post('/admin/subscriptions/bargains', setNoStore, isAdmin, ...authBodyParsers, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const { errors, values } = validateBargainInput(req.body || {});
    if (errors.length) {
      return res.status(400).json({ success: false, error: errors.join(' ') });
    }

    const [result] = await pool.execute(
      `INSERT INTO subscription_bargains
         (title, description, plan_id, price_fcfa, active, starts_at, ends_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        values.title,
        values.description,
        values.planId,
        values.priceFcfa,
        values.active,
        values.startsAt,
        values.endsAt,
        adminIdOf(req),
      ],
    );

    const [rows] = await pool.execute('SELECT * FROM subscription_bargains WHERE id = ?', [result.insertId]);
    return res.status(201).json({ success: true, bargain: serializeBargain(rows[0]) });
  } catch (error) {
    console.error('Admin bargain create error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de créer l’offre.' });
  }
});

router.patch('/admin/subscriptions/bargains/:id', setNoStore, isAdmin, ...authBodyParsers, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const bargainId = Number(req.params.id);
    if (!Number.isInteger(bargainId) || bargainId <= 0) {
      return res.status(400).json({ success: false, error: 'Identifiant d’offre invalide.' });
    }

    const [existing] = await pool.execute('SELECT id FROM subscription_bargains WHERE id = ?', [bargainId]);
    if (!existing[0]) {
      return res.status(404).json({ success: false, error: 'Offre introuvable.' });
    }

    const { errors, values } = validateBargainInput(req.body || {}, { partial: true });
    if (errors.length) {
      return res.status(400).json({ success: false, error: errors.join(' ') });
    }

    const columnByField = {
      title: 'title',
      description: 'description',
      planId: 'plan_id',
      priceFcfa: 'price_fcfa',
      active: 'active',
      startsAt: 'starts_at',
      endsAt: 'ends_at',
    };
    const updates = [];
    const params = [];
    for (const [field, column] of Object.entries(columnByField)) {
      if (Object.prototype.hasOwnProperty.call(values, field)) {
        updates.push(`${column} = ?`);
        params.push(values[field]);
      }
    }
    if (!updates.length) {
      return res.status(400).json({ success: false, error: 'Aucune mise à jour fournie.' });
    }

    params.push(bargainId);
    await pool.execute(`UPDATE subscription_bargains SET ${updates.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.execute('SELECT * FROM subscription_bargains WHERE id = ?', [bargainId]);
    return res.json({ success: true, bargain: serializeBargain(rows[0]) });
  } catch (error) {
    console.error('Admin bargain update error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de modifier l’offre.' });
  }
});

router.delete('/admin/subscriptions/bargains/:id', setNoStore, isAdmin, async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Service temporairement indisponible.' });
    }

    const bargainId = Number(req.params.id);
    if (!Number.isInteger(bargainId) || bargainId <= 0) {
      return res.status(400).json({ success: false, error: 'Identifiant d’offre invalide.' });
    }

    const [result] = await pool.execute('DELETE FROM subscription_bargains WHERE id = ?', [bargainId]);
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, error: 'Offre introuvable.' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Admin bargain delete error:', error);
    return res.status(500).json({ success: false, error: 'Impossible de supprimer l’offre.' });
  }
});

router.use(jsonParseErrorHandler);

module.exports = router;
