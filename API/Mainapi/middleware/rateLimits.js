/**
 * Limiteurs partagés pour les API de lecture publiques.
 *
 * Ces routes n'exigeaient aucune authentification et n'avaient aucun quota :
 * un seul client pouvait épuiser le quota TMDB, saturer les proxies amont ou
 * aspirer le catalogue. Les quotas ci-dessous sont volontairement larges (la
 * navigation normale, avec prefetch, reste très en dessous) ; ils visent le
 * scraping et l'amplification, pas l'utilisateur qui clique vite.
 *
 * Deux invariants repris des limiteurs existants :
 *  - `getTrustedClientIp` d'abord : `CF-Connecting-IP` / `X-Forwarded-For`
 *    sont contrôlés par le client dès que l'origine est joignable en direct.
 *  - `passOnStoreError: true` : une panne Redis ne doit pas couper la lecture
 *    publique. L'authentification, elle, reste fail-closed (voir authRoutes).
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { createRedisRateLimitStore } = require('../utils/redisRateLimitStore');
const { getTrustedClientIp } = require('../utils/clientIp');

function createReadLimiter({ prefix, windowMs, max, error }) {
  return rateLimit({
    windowMs,
    max,
    store: createRedisRateLimitStore({ prefix, windowMs }),
    passOnStoreError: true,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getTrustedClientIp(req) || ipKeyGenerator(req.ip),
    validate: { xForwardedForHeader: false, ip: false },
    message: { success: false, error },
  });
}

const MINUTE = 60 * 1000;

/** Recherche : chaque appel tape Darkino et le cache. */
const searchReadLimit = createReadLimiter({
  prefix: 'rate-limit:read:search:',
  windowMs: MINUTE,
  max: 60,
  error: 'Trop de recherches en peu de temps. Reessayez dans une minute.',
});

/** Métadonnées catalogue : TMDB et IMDB, mises en cache côté serveur. */
const catalogReadLimit = createReadLimiter({
  prefix: 'rate-limit:read:catalog:',
  windowMs: MINUTE,
  max: 120,
  error: 'Trop de requetes de catalogue en peu de temps. Reessayez dans une minute.',
});

/** France TV : scraping par épisode, plus coûteux qu'un simple cache hit. */
const franceTvReadLimit = createReadLimiter({
  prefix: 'rate-limit:read:francetv:',
  windowMs: MINUTE,
  max: 90,
  error: 'Trop de requetes France TV en peu de temps. Reessayez dans une minute.',
});

/** Débrid : génération d'un lien, appel externe facturé en temps. */
const debridReadLimit = createReadLimiter({
  prefix: 'rate-limit:read:debrid:',
  windowMs: MINUTE,
  max: 30,
  error: 'Trop de requetes de debrid en peu de temps. Reessayez dans une minute.',
});

/** Téléchargement : résolution de liens, une requête par épisode ou film. */
const downloadReadLimit = createReadLimiter({
  prefix: 'rate-limit:read:download:',
  windowMs: MINUTE,
  max: 30,
  error: 'Trop de requetes de telechargement en peu de temps. Reessayez dans une minute.',
});

module.exports = {
  createReadLimiter,
  searchReadLimit,
  catalogReadLimit,
  franceTvReadLimit,
  debridReadLimit,
  downloadReadLimit,
};
