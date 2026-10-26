/**
 * Client CamPay — agrégateur mobile money camerounais (MTN MoMo / Orange
 * Money, XAF) de TAKWID GROUP. C'est l'agrégateur qui rend le paywall
 * encaissable : sans lui, l'acheteur payait sur un numéro manuel et un
 * admin validait à la main.
 *
 * Doc API : https://documenter.getpostman.com/view/2391374/T1LV8PVA
 *
 * Mode retenu : la collecte « push ». `initCollect` déclenche une invitation
 * USSD sur le téléphone de l'acheteur (*126# MTN / #150*50# Orange) qui
 * confirme avec son code PIN ; aucun renvoi vers une page tierce. CamPay ne
 * documente aucun webhook : on suit l'état par `getTransactionStatus`
 * (PENDING -> SUCCESSFUL | FAILED).
 *
 * Authentification (au choix) :
 *   - CAMPAY_PERMANENT_TOKEN : jeton permanent des APP KEYS de l'application ;
 *   - CAMPAY_APP_USERNAME / CAMPAY_APP_PASSWORD : jeton temporaire obtenu par
 *     POST /token/, mis en cache et renouvelé (une seule régénération après un
 *     401, pour éviter les boucles sur une clé réellement invalide).
 *
 * Environnement : CAMPAY_ENV=dev => demo.campay.net (bac à sable), sinon
 * www.campay.net (production).
 *
 * Codes d'erreur CamPay rencontrés en collecte :
 *   ER101 numéro mal formé (doit commencer par 237),
 *   ER102 opérateur non supporté (hors MTN / Orange),
 *   ER201 montant décimal refusé,
 *   ER301 solde du compte marchand épuisé.
 */

const axios = require('axios');

const DEMO_BASE_URL = 'https://demo.campay.net/api';
const PROD_BASE_URL = 'https://www.campay.net/api';
const REQUEST_TIMEOUT_MS = 15000;
const TOKEN_LIFETIME_MS = 23 * 60 * 60 * 1000; // les jetons CamPay vivent 24 h

/** Messages serveur (affichés tels quels à l'acheteur). */
const ERROR_MESSAGES = Object.freeze({
  ER101: 'Numéro mobile money invalide (format 2376XXXXXXXX attendu).',
  ER102: 'Seuls les numéros MTN MoMo et Orange Money sont acceptés.',
  ER201: 'Montant invalide pour CamPay.',
  ER301: 'Paiement momentanément indisponible, réessayez plus tard.',
});

let cachedToken = null; // { value, expiresAt }

function isCamPayConfigured() {
  const hasPermanent = Boolean(String(process.env.CAMPAY_PERMANENT_TOKEN || '').trim());
  const hasCredentials =
    Boolean(String(process.env.CAMPAY_APP_USERNAME || '').trim()) &&
    Boolean(String(process.env.CAMPAY_APP_PASSWORD || '').trim());
  return hasPermanent || hasCredentials;
}

function usesTemporaryToken() {
  return !String(process.env.CAMPAY_PERMANENT_TOKEN || '').trim();
}

function getBaseUrl() {
  const env = String(process.env.CAMPAY_ENV || '').trim().toLowerCase();
  return env === 'dev' ? DEMO_BASE_URL : PROD_BASE_URL;
}

function createClient(token) {
  return axios.create({
    baseURL: getBaseUrl(),
    timeout: REQUEST_TIMEOUT_MS,
    headers: token ? { Authorization: `Token ${token}` } : { 'Content-Type': 'application/json' },
  });
}

async function requestNewToken() {
  const username = String(process.env.CAMPAY_APP_USERNAME || '').trim();
  const password = String(process.env.CAMPAY_APP_PASSWORD || '').trim();
  const response = await createClient(null).post('token/', { username, password });
  const token = response.data && response.data.token;
  if (!token) {
    throw Object.assign(new Error('CamPay : jeton absent de la réponse /token/.'), { status: 502 });
  }
  cachedToken = { value: token, expiresAt: Date.now() + TOKEN_LIFETIME_MS };
  return token;
}

async function getAccessToken() {
  if (!usesTemporaryToken()) {
    return String(process.env.CAMPAY_PERMANENT_TOKEN || '').trim();
  }
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  return requestNewToken();
}

/** Relève l'erreur CamPay (champ `detail` ou `error`) sans jamais la throw telle quelle. */
function normalizeCamPayError(error) {
  const data = error && error.response && error.response.data;
  const code = data && data.error;
  const detail = data && data.detail;
  const known = ERROR_MESSAGES[code];
  const message = known || detail || (error && error.message) || 'CamPay injoignable.';
  const status = known ? 400 : 502;
  return Object.assign(new Error(message), { status, camPayCode: code || null });
}

async function callCamPay(method, path, body, retried = false) {
  const token = await getAccessToken();
  try {
    const response = await createClient(token)[method](path, body);
    return response.data || {};
  } catch (error) {
    const httpStatus = error && error.response && error.response.status;
    if (httpStatus === 401 && usesTemporaryToken() && !retried) {
      cachedToken = null;
      return callCamPay(method, path, body, true);
    }
    throw normalizeCamPayError(error);
  }
}

/**
 * Déclenche l'invitation de paiement USSD sur le téléphone de l'acheteur.
 *
 * @param {{ amountFcfa: number, msisdn: string, description: string, externalReference: string }} input
 *   `msisdn` doit être au format 2376XXXXXXXX (normalisé en amont par la route).
 * @returns {Promise<{ reference: string, ussdCode: string|null, operator: string|null }>}
 *   `reference` est la référence CamPay à conserver pour le suivi d'état.
 */
async function initCollect({ amountFcfa, msisdn, description, externalReference }) {
  const data = await callCamPay('post', 'transaction/collect/', {
    amount: String(Math.round(Number(amountFcfa))), // ER201 : décimaux refusés
    currency: 'XAF',
    from: String(msisdn),
    description: String(description || 'CineHD abonnement').slice(0, 100),
    external_reference: String(externalReference || '').slice(0, 100),
  });

  return {
    reference: String(data.reference || ''),
    ussdCode: data.ussd_code ? String(data.ussd_code) : null,
    operator: data.operator ? String(data.operator).toLowerCase() : null,
  };
}

/**
 * État d'une collecte initiée.
 *
 * @param {string} reference référence CamPay renvoyée par initCollect
 * @returns {Promise<{ status: 'PENDING'|'SUCCESSFUL'|'FAILED'|string, operator: string|null, operatorReference: string|null, amountFcfa: number|null }>}
 */
async function getTransactionStatus(reference) {
  const data = await callCamPay('get', `transaction/reference/${encodeURIComponent(reference)}/`);
  const status = String(data.status || 'PENDING').toUpperCase();
  return {
    status,
    operator: data.operator ? String(data.operator).toLowerCase() : null,
    operatorReference: data.operator_reference ? String(data.operator_reference) : null,
    amountFcfa: data.amount === null || data.amount === undefined ? null : Number(data.amount),
  };
}

module.exports = {
  ERROR_MESSAGES,
  getTransactionStatus,
  initCollect,
  isCamPayConfigured,
};
