/**
 * Point d'entrée du Worker CineHD.
 *
 * Le Worker ne sert aucune route métier : il résout le service (hôte ou
 * préfixe de chemin), puis délègue au Container ou à l'origine Docker
 * configurée. Toute la logique de décision est dans `routing.mjs`, testée sur
 * Node ; ce fichier ne garde que le câblage Cloudflare.
 */

import { dispatch, parseConfig } from './routing.mjs';
// Containers désactivés (offre gratuite) : voir wrangler.toml. Pour les
// réactiver, réexporter MainApiContainer, ProxyContainer et WatchPartyContainer
// depuis './containers'.

let cachedConfig = null;

function config(env) {
  if (!cachedConfig) cachedConfig = parseConfig(env);
  return cachedConfig;
}

export default {
  async fetch(request, env) {
    return dispatch(request, env, config(env));
  },
};
