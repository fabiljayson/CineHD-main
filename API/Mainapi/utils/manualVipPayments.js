/**
 * VIP par paiement mobile money confirmé à la main (sans API opérateur).
 *
 * Un utilisateur connecté envoie l'argent sur le numéro de collecte affiché
 * (variables d'environnement, voir utils/accountPlans.js), puis déclare sa
 * transaction. Un admin vérifie sur son relevé Orange Money / MTN MoMo et
 * valide : une clé `access_keys` est alors générée avec la durée de l'offre
 * et rattachée aux profils du compte (clé `access_code` des données de
 * profil synchronisées), si bien que l'utilisateur n'a rien à saisir.
 *
 * Fonctions pures + rattachement au module de sync, partagées par
 * routes/vipPaymentRequests.js.
 */

const crypto = require('crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'CINEVIP';

/** Clé lisible, sans caractères ambigus : CINEVIP-XXXX-XXXX-XXXX. */
function generateVipKeyValue() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let body = '';
  for (let index = 0; index < bytes.length; index += 1) {
    body += alphabet[bytes[index] % alphabet.length];
  }
  return `${KEY_PREFIX}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

/**
 * Expiration (ms epoch) d'une nouvelle clé : la durée de l'offre s'ajoute à
 * la fin du VIP encore actif du compte, pour ne jamais raccourcir un
 * abonnement déjà payé.
 */
function computeKeyExpiry({ planDays, currentExpiryMs = null, now = Date.now() }) {
  const base = Number.isFinite(currentExpiryMs) && currentExpiryMs > now ? currentExpiryMs : now;
  return base + planDays * DAY_MS;
}

function toIsoOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(
    typeof value === 'string' && !/^\d+$/.test(value) ? value.replace(' ', 'T') : Number(value)
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * @param {object} row ligne vip_payment_requests
 * @param {{ includeKey?: boolean }} options la clé n'est servie qu'à son
 *   propriétaire et aux admins.
 */
function serializeVipPaymentRequest(row, { includeKey = false } = {}) {
  if (!row) return null;
  return {
    id: Number(row.id),
    userId: String(row.user_id),
    userType: row.user_type,
    username: row.username || null,
    planId: row.plan_id,
    planDays: Number(row.plan_days),
    amountFcfa: Number(row.amount_fcfa),
    paymentMethod: row.payment_method,
    payerMsisdn: row.payer_msisdn,
    reference: row.reference,
    status: row.status,
    adminNote: row.admin_note || null,
    accessKey: includeKey && row.status === 'approved' ? (row.access_key_value || null) : null,
    keyExpiresAt: row.key_expires_at === null || row.key_expires_at === undefined
      ? null
      : toIsoOrNull(Number(row.key_expires_at)),
    accountLinked: Number(row.account_linked) === 1,
    reviewedAt: toIsoOrNull(row.reviewed_at),
    reviewedBy: row.reviewed_by || null,
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}

/**
 * Écrit la clé dans les données synchronisées du compte : chaque profil
 * reçoit `access_code`, `access_code_expires` et `is_vip`, les mêmes clés
 * que pose la saisie manuelle d'un code côté frontend. Le serveur ne fait
 * confiance qu'à `access_code` (vérifié contre `access_keys`), jamais à
 * `is_vip`.
 *
 * @param {object} syncModule routes/sync (readUserData, writeUserData,
 *   readProfileData, writeProfileData, withProfileSyncLock)
 * @returns {Promise<boolean>} true si au moins un emplacement a été écrit
 */
async function linkAccessKeyToAccount(syncModule, { userType, userId, keyValue, expiresAtMs }) {
  const values = {
    access_code: String(keyValue),
    access_code_expires: new Date(Number(expiresAtMs)).toISOString(),
    is_vip: 'true',
  };

  const userData = await syncModule.readUserData(userType, userId) || {};
  const profiles = Array.isArray(userData.profiles)
    ? userData.profiles.filter((profile) => profile && typeof profile.id === 'string' && profile.id)
    : [];

  if (profiles.length === 0) {
    // Compte sans profil : repli sur les données utilisateur (lues en second
    // par la vérification VIP OAuth).
    Object.assign(userData, values);
    return Boolean(await syncModule.writeUserData(userType, userId, userData));
  }

  let linked = false;
  for (const profile of profiles) {
    const written = await syncModule.withProfileSyncLock(userType, userId, profile.id, async () => {
      const data = await syncModule.readProfileData(userType, userId, profile.id) || {};
      Object.assign(data, values);
      return syncModule.writeProfileData(userType, userId, profile.id, data);
    });
    linked = linked || Boolean(written);
  }
  return linked;
}

module.exports = {
  DAY_MS,
  computeKeyExpiry,
  generateVipKeyValue,
  linkAccessKeyToAccount,
  serializeVipPaymentRequest,
};
