/**
 * Saisie mobile money (MTN MoMo / Orange Money, Cameroun).
 *
 * Normalisation partagée par les demandes de création de compte
 * (`routes/accountRequests.js`) et les demandes de VIP par paiement manuel
 * (`routes/vipPaymentRequests.js`), pour qu'une même référence ou un même
 * numéro soit comparé de la même façon dans les deux parcours.
 */

/** Référence de transaction opérateur : alphanumérique, 4 à 128 caractères. */
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{3,127}$/;

/**
 * 06XXXXXXXX → 2376XXXXXXXX, 00237… → 237…, chiffres seuls. Un numéro saisi
 * sur 9 chiffres reste tel quel (comportement historique des demandes).
 */
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

function isValidMsisdn(msisdn) {
  return msisdn.length >= 9 && msisdn.length <= 15;
}

module.exports = {
  REFERENCE_PATTERN,
  isValidMsisdn,
  normalizeMsisdn,
  normalizeReference,
};
