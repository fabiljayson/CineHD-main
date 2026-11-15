/**
 * Cookie de session HttpOnly.
 *
 * Le JWT vivait dans `localStorage` : n'importe quel script exécuté sur la page
 * (dépendance compromise, XSS, extension) pouvait le lire et le rejouer pendant
 * 30 jours. Le cookie HttpOnly retire cette possibilité : le navigateur l'envoie
 * seul, et aucun JavaScript ne peut le lire.
 *
 * Le jeton reste accepté dans l'en-tête `Authorization` : l'extension, le
 * userscript et l'app mobile ne sont pas des navigateurs et n'ont pas de cookie
 * jar. Ce module est le point unique qui décide d'où vient la session.
 *
 * Deux précautions accompagnent un cookie d'authentification :
 *  - `SameSite` n'est pas décoratif : `lax` bloque l'envoi sur une requête
 *    POST venue d'un autre site, ce qui neutralise l'essentiel du CSRF ;
 *  - `SameSite=None` (nécessaire si l'API est sur un autre domaine que le
 *    front) impose `Secure` et rouvre la porte au CSRF ; `validateAuthRequest`
 *    vérifie alors l'origine des requêtes mutantes (voir `isTrustedOriginRequest`).
 *
 * Rien ici ne devine : chaque réglage vient de l'environnement, avec un défaut
 * sûr pour la production.
 */

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'cd_session';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * '30d', '12h', '45m', '30s' ou un nombre de millisecondes.
 * Une valeur illisible retombe sur le défaut plutôt que de produire un cookie
 * de session (sans Max-Age), qui disparaîtrait à la fermeture du navigateur.
 */
function parseDurationMs(value, fallbackMs) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return fallbackMs;

  const match = /^\s*(\d+)\s*(ms|s|m|h|d)?\s*$/i.exec(value);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  const ms = amount * factor;
  return Number.isFinite(ms) && ms > 0 ? ms : fallbackMs;
}

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function resolveSameSite() {
  const raw = (process.env.SESSION_COOKIE_SAMESITE || 'lax').toLowerCase();
  return ['lax', 'strict', 'none'].includes(raw) ? raw : 'lax';
}

function resolveSecure(sameSite) {
  // `SameSite=None` sans `Secure` est rejeté par les navigateurs : le cookie ne
  // serait jamais stocké. On force donc Secure dans ce cas précis.
  if (sameSite === 'none') return true;
  const configured = process.env.SESSION_COOKIE_SECURE;
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function sessionCookieOptions() {
  const sameSite = resolveSameSite();
  return {
    httpOnly: true,
    secure: resolveSecure(sameSite),
    sameSite,
    path: '/',
    maxAge: parseDurationMs(process.env.SESSION_JWT_EXPIRES_IN, DEFAULT_MAX_AGE_MS),
    ...(process.env.SESSION_COOKIE_DOMAIN ? { domain: process.env.SESSION_COOKIE_DOMAIN } : {}),
  };
}

function setSessionCookie(res, token) {
  if (!res || typeof res.cookie !== 'function' || !token) return;
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

function clearSessionCookie(res) {
  if (!res || typeof res.clearCookie !== 'function') return;
  const { maxAge, ...options } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, options);
}

/** Parse l'en-tête `Cookie` sans dépendance (cookie-parser n'est pas installé). */
function parseCookieHeader(header) {
  const cookies = Object.create(null);
  if (typeof header !== 'string' || !header) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function readSessionCookie(req) {
  const cookies = parseCookieHeader(req?.headers?.cookie);
  return cookies[SESSION_COOKIE_NAME] || null;
}

/**
 * Un JWT a trois segments. Cette forme sert à distinguer un vrai jeton d'une
 * valeur quelconque envoyée dans `Authorization` — un client resté sur
 * l'ancien stockage envoie `Bearer cookie` par exemple. Une valeur qui n'a pas
 * la forme d'un JWT est ignorée plutôt que de masquer une session cookie
 * valide.
 */
function isJwtShaped(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

/** 'header' | 'cookie' | null — la provenance décide de la vérification CSRF. */
function getTokenSource(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization;
  if (typeof header === 'string') {
    const [scheme, value] = header.split(' ');
    if (scheme && scheme.toLowerCase() === 'bearer' && isJwtShaped(value)) return 'header';
  }
  return readSessionCookie(req) ? 'cookie' : null;
}

function extractSessionToken(req) {
  const source = getTokenSource(req);
  if (source === 'header') {
    return req.headers.authorization?.split(' ')[1] || req.headers.Authorization?.split(' ')[1] || null;
  }
  if (source === 'cookie') {
    return readSessionCookie(req);
  }
  return null;
}

function isTrustedOriginRequest(req) {
  const origin = req?.headers?.origin;
  const referer = req?.headers?.referer;
  const candidate = origin || referer;
  if (!candidate) return false;

  // Import paresseux : évite un cycle de dépendances au chargement du module.
  const { isAllowedBrowserUrl } = require('../config/allowedOrigins');
  if (isAllowedBrowserUrl(candidate)) return true;

  // Développement local, quel que soit le port choisi par Vite.
  if (process.env.NODE_ENV !== 'production') {
    try {
      const { hostname } = new URL(candidate);
      return hostname === 'localhost' || hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Une requête mutante authentifiée par cookie doit venir d'une origine connue.
 * `SameSite` couvre déjà la majorité des cas ; ce contrôle couvre le reste
 * (configuration `SameSite=None`, navigateurs anciens) et vaut aussi pour une
 * requête émise depuis un onglet tiers.
 */
function isMutationAllowedForCookieSession(req) {
  const method = String(req?.method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return true;
  return isTrustedOriginRequest(req);
}

module.exports = {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  setSessionCookie,
  clearSessionCookie,
  parseCookieHeader,
  readSessionCookie,
  extractSessionToken,
  getTokenSource,
  isJwtShaped,
  isTrustedOriginRequest,
  isMutationAllowedForCookieSession,
  parseDurationMs,
};
