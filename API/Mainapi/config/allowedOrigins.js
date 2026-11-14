/**
 * Source unique des origines autorisées.
 *
 * `middleware/cors.js` et `middleware/security.js` entretenaient chacun leur
 * copie de cette liste. Deux listes qui doivent rester identiques finissent
 * toujours par diverger : une origine ajoutée d'un seul côté passe le
 * middleware de domaine mais échoue au CORS (ou l'inverse), et la panne est
 * silencieuse. Les helpers ci-dessous centralisent la règle, chaque middleware
 * n'ayant plus qu'à choisir celle qui lui convient.
 *
 * Nuance de comportement conservée telle quelle :
 *  - `isAllowedUrl` ne regarde que le nom d'hôte, exactement comme l'ancien
 *    test de `cors.js` (où l'entrée `localhost:3000` ne pouvait jamais
 *    correspondre, `URL.hostname` étant sans port) ;
 *  - `isAllowedLocalDevUrl` est la règle à part de `security.js`, qui exigeait
 *    explicitement `localhost` **avec** le port 3000.
 */

const ALLOWED_DOMAINS = [
  'movix.blog',
  'movix.rodeo',
  'movix.club',
  'movix.site',
  'movix11.pages.dev',
  'nakios.site',
  'cinezo.site',
  'cinezo.online',
  'filmib.cc',
  'movix.llc',
  'movix.cash',
  'movix.tax',
  'movix.cloud',
  'movix.golf',
  'movix.chat',
  'movix.date',
  'movix.show',
  'movix.fun',
  'movix.men',
];

/** Port du serveur de développement Vite ; voir AGENTS.md. */
const LOCAL_DEV_HOSTNAME = 'localhost';
const LOCAL_DEV_PORT = '3000';

function isAllowedHostname(hostname) {
  if (!hostname) return false;
  const host = String(hostname).toLowerCase();
  return ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Origine, Referer ou URL : seul le nom d'hôte compte (règle du CORS). */
function isAllowedUrl(value) {
  const url = parseUrl(value);
  return Boolean(url) && isAllowedHostname(url.hostname);
}

/** Développement local, port exact compris (règle du middleware de domaine). */
function isAllowedLocalDevUrl(value) {
  const url = parseUrl(value);
  if (!url) return false;
  return url.hostname === LOCAL_DEV_HOSTNAME && url.port === LOCAL_DEV_PORT;
}

/** Toute origine acceptée par le middleware de domaine, hors OAuth. */
function isAllowedBrowserUrl(value) {
  return isAllowedUrl(value) || isAllowedLocalDevUrl(value);
}

module.exports = {
  ALLOWED_DOMAINS,
  LOCAL_DEV_HOSTNAME,
  LOCAL_DEV_PORT,
  isAllowedHostname,
  isAllowedUrl,
  isAllowedLocalDevUrl,
  isAllowedBrowserUrl,
};
