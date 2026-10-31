/**
 * Abonnements, reçus et offres de renouvellement.
 *
 * Le minuteur d'abonnement vit dans `account_credentials.subscription_expires_at`
 * (aucun système de durée n'existait : les `days` des offres n'étaient jamais
 * appliqués). Un reçu est la trace qu'une transaction mobile money a bien été
 * confirmée par un admin ; il prolonge le minuteur du compte concerné.
 *
 * Les helpers de ce module supposent une transaction (objet `conn`) pour que
 * le reçu et le minuteur restent cohérents. `serialize*` sont utilisés par
 * `routes/adminSubscriptions.js` et `routes/accountRequests.js`.
 */

const crypto = require('crypto');
const { getPlanById } = require('./accountPlans');

function generateReceiptPublicId() {
  return `RCP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

/**
 * Écrit une date dans une colonne DATETIME.
 *
 * Convention du module : la colonne contient l'heure « murale » locale, celle
 * que `parseSqlDateTime` relit (il interprète une chaîne SQL sans fuseau comme
 * heure locale). Écrire en UTC (`toISOString`) puis relire en local décalait la
 * valeur du fuseau du serveur à chaque enregistrement — un minuteur ré-enregistré
 * reculait d'une heure par sauvegarde. Les deux sens doivent donc utiliser le
 * même référentiel : les composantes locales.
 */
function toSqlDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function parseSqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function toIsoOrNull(value) {
  const parsed = parseSqlDateTime(value);
  return parsed ? parsed.toISOString() : null;
}

/**
 * Crée un reçu d'abonnement et prolonge le minuteur du compte.
 *
 * La prolongation « empile » : si le compte court déjà jusqu'à une date future,
 * le nouveau palier démarre à cette date (pas maintenant), pour ne jamais
 * raccourcir un abonnement payé.
 *
 * @param {object} conn connexion MySQL déjà dans une transaction
 * @param {object} params
 * @returns {Promise<object>} reçu sérialisé
 */
async function createSubscriptionReceipt(conn, params) {
  const {
    requestId = null,
    credentialId,
    issuedBy,
    amountFcfa,
    paymentMethod,
    payerMsisdn,
    paymentReference,
  } = params;

  const plan = getPlanById(params.planId);
  if (!plan) {
    throw Object.assign(new Error('Offre inconnue.'), { status: 400 });
  }

  const [credRows] = await conn.execute(
    'SELECT id, user_id, username, subscription_expires_at FROM account_credentials WHERE id = ? FOR UPDATE',
    [credentialId]
  );
  const credential = credRows[0];
  if (!credential) {
    throw Object.assign(new Error('Compte introuvable.'), { status: 404 });
  }

  const now = new Date();
  const currentExpiry = parseSqlDateTime(credential.subscription_expires_at);
  const validFrom = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  const validUntil = addDays(validFrom, plan.days);

  const publicId = generateReceiptPublicId();
  const [result] = await conn.execute(
    `INSERT INTO subscription_receipts
       (public_id, request_id, user_id, username, plan_id, plan_days, amount_fcfa,
        payment_method, payer_msisdn, payment_reference, valid_from, valid_until, issued_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      publicId,
      requestId,
      String(credential.user_id),
      String(credential.username),
      plan.id,
      plan.days,
      Number(amountFcfa) || 0,
      paymentMethod,
      String(payerMsisdn || ''),
      String(paymentReference || ''),
      toSqlDateTime(validFrom),
      toSqlDateTime(validUntil),
      issuedBy,
    ]
  );

  await conn.execute(
    'UPDATE account_credentials SET subscription_expires_at = ? WHERE id = ?',
    [toSqlDateTime(validUntil), credential.id]
  );

  return {
    id: Number(result.insertId),
    publicId,
    requestId: requestId === null ? null : Number(requestId),
    userId: String(credential.user_id),
    username: String(credential.username),
    planId: plan.id,
    planDays: plan.days,
    amountFcfa: Number(amountFcfa) || 0,
    paymentMethod,
    payerMsisdn: String(payerMsisdn || ''),
    paymentReference: String(paymentReference || ''),
    validFrom: toIsoOrNull(validFrom),
    validUntil: toIsoOrNull(validUntil),
    issuedBy,
  };
}

function serializeReceipt(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    publicId: row.public_id,
    requestId: row.request_id === null || row.request_id === undefined ? null : Number(row.request_id),
    userId: String(row.user_id),
    username: row.username,
    planId: row.plan_id,
    planDays: Number(row.plan_days),
    amountFcfa: Number(row.amount_fcfa),
    paymentMethod: row.payment_method,
    payerMsisdn: row.payer_msisdn,
    paymentReference: row.payment_reference,
    validFrom: toIsoOrNull(row.valid_from),
    validUntil: toIsoOrNull(row.valid_until),
    issuedBy: row.issued_by,
    createdAt: toIsoOrNull(row.created_at),
  };
}

function serializeBargain(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description || null,
    planId: row.plan_id,
    priceFcfa: Number(row.price_fcfa),
    active: Number(row.active) === 1,
    startsAt: toIsoOrNull(row.starts_at),
    endsAt: toIsoOrNull(row.ends_at),
    createdBy: row.created_by,
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

function serializeAccountUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: String(row.user_id),
    username: row.username,
    active: Number(row.active) === 1,
    hasPassword: Boolean(row.password_hash),
    subscriptionExpiresAt: toIsoOrNull(row.subscription_expires_at),
    lastLoginAt: toIsoOrNull(row.last_login_at),
    createdAt: toIsoOrNull(row.created_at),
    requestId: row.request_id === null || row.request_id === undefined ? null : Number(row.request_id),
  };
}

module.exports = {
  addDays,
  createSubscriptionReceipt,
  generateReceiptPublicId,
  parseSqlDateTime,
  serializeAccountUser,
  serializeBargain,
  serializeReceipt,
  toIsoOrNull,
  toSqlDateTime,
};
