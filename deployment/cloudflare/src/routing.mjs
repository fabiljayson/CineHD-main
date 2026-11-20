/**
 * Résolution de route du Worker CineHD — JavaScript pur, sans API Workers.
 *
 * Toute la décision « quel service sert cette requête » vit ici, hors de la
 * couche Container : elle se teste sur Node, sans compte Cloudflare ni workerd.
 * `src/index.ts` ne fait qu'appeler `dispatch`.
 *
 * Aucun domaine n'est deviné : les hôtes, les préfixes et les cibles viennent
 * de variables (Task 1 / Task 6). Une cible peut être un Container (`container:BINDING`)
 * ou une origine Docker externe (`origin:https://…`) si la porte de staging d'un
 * service échoue.
 */

const INTERNAL_PATH_PATTERN = /^\/(?:internal|__)/;
const SERVICE_PATTERN = /^[a-z][a-z0-9_-]*$/;
// Les noms de bindings Workers sont UPPER_SNAKE (`MAIN_API`), pas des services.
const BINDING_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

const SERVICE_ENV_NAMES = { mainapi: 'MAIN_API', watchparty: 'WATCHPARTY', proxy: 'PROXY' };

export const DEFAULT_PATH_ROUTES = '/api=mainapi,/watchparty=watchparty,/proxy=proxy';

function normalizeHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTarget(raw, service) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const separator = value.indexOf(':');
  if (separator === -1) throw new Error(`Cible invalide pour ${service}: ${value}`);
  const kind = value.slice(0, separator);
  const rest = value.slice(separator + 1);

  if (kind === 'container') {
    if (!BINDING_PATTERN.test(rest)) throw new Error(`Binding de conteneur invalide pour ${service}: ${rest}`);
    return { kind: 'container', binding: rest };
  }
  if (kind === 'origin') {
    let url;
    try {
      url = new URL(rest);
    } catch {
      throw new Error(`Origine invalide pour ${service}: ${rest}`);
    }
    if (!/^https?:$/.test(url.protocol)) throw new Error(`Origine non HTTP pour ${service}: ${rest}`);
    return { kind: 'origin', origin: url.origin };
  }
  throw new Error(`Type de cible inconnu pour ${service}: ${kind}`);
}

/**
 * @param {Record<string, string>} env variables du Worker (`[vars]` / secrets)
 */
export function parseConfig(env = {}) {
  const hosts = Object.create(null);
  const targets = Object.create(null);

  const hostVars = [
    ['mainapi', env.MAIN_API_HOST],
    ['watchparty', env.WATCHPARTY_HOST],
    ['proxy', env.PROXY_HOST],
  ];
  for (const [service, rawHost] of hostVars) {
    for (const host of splitList(rawHost)) hosts[normalizeHost(host)] = service;
    const target = parseTarget(env[`${SERVICE_ENV_NAMES[service]}_TARGET`], service);
    if (target) targets[service] = target;
  }

  const pathRoutes = splitList(env.PATH_ROUTES || DEFAULT_PATH_ROUTES)
    .map((entry) => {
      const separator = entry.indexOf('=');
      if (separator === -1) throw new Error(`Route de chemin invalide: ${entry}`);
      const prefix = entry.slice(0, separator).trim().replace(/\/+$/, '');
      const service = entry.slice(separator + 1).trim();
      if (!prefix.startsWith('/')) throw new Error(`Préfixe invalide: ${entry}`);
      if (!SERVICE_PATTERN.test(service)) throw new Error(`Service invalide dans: ${entry}`);
      return { prefix, service };
    })
    // Le préfixe le plus long gagne : /api/v2 ne doit pas être mangé par /api.
    .sort((a, b) => b.prefix.length - a.prefix.length);

  return {
    hosts,
    targets,
    pathRoutes,
    fallbackHost: normalizeHost(env.FALLBACK_HOST),
  };
}

function notFound(message) {
  return { error: { status: 404, message } };
}

/**
 * @param {URL} url
 * @param {ReturnType<typeof parseConfig>} config
 * @returns {{service: string, upstreamPath: string, matchedBy: string} | {error: {status: number, message: string}}}
 */
export function resolveRoute(url, config) {
  if (INTERNAL_PATH_PATTERN.test(url.pathname)) return notFound('not_found');

  const host = normalizeHost(url.hostname);
  const hostService = config.hosts[host];
  if (hostService) {
    return { service: hostService, upstreamPath: `${url.pathname}${url.search}`, matchedBy: 'host' };
  }

  if (config.fallbackHost && host === config.fallbackHost) {
    for (const route of config.pathRoutes) {
      if (url.pathname === route.prefix || url.pathname.startsWith(`${route.prefix}/`)) {
        const rest = url.pathname.slice(route.prefix.length) || '/';
        return { service: route.service, upstreamPath: `${rest}${url.search}`, matchedBy: 'path' };
      }
    }
  }

  return notFound('not_found');
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function buildUpstreamRequest(request, route, target) {
  const upstreamUrl =
    target.kind === 'origin'
      ? `${target.origin}${route.upstreamPath}`
      : `http://${route.service}.container.internal${route.upstreamPath}`;

  const init = {
    method: request.method,
    headers: new Headers(request.headers),
    redirect: 'manual',
  };

  // Un corps de requête ne peut être rejoué qu'une fois : on ne le transmet que
  // lorsqu'il existe réellement (GET/HEAD n'en ont pas).
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
    init.body = request.body;
    init.duplex = 'half';
  }

  return new Request(upstreamUrl, init);
}

/**
 * Achemine une requête vers le service résolu.
 *
 * @param {Request} request
 * @param {Record<string, any>} env bindings du Worker (namespace Container, secrets)
 * @param {ReturnType<typeof parseConfig>} [config]
 * @param {{fetch?: typeof fetch}} [deps] injection pour les tests
 */
export async function dispatch(request, env = {}, config = parseConfig(env), deps = {}) {
  const route = resolveRoute(new URL(request.url), config);
  if (route.error) return jsonResponse(route.error.status, { error: route.error.message });

  const target = config.targets[route.service];
  if (!target) return jsonResponse(502, { error: 'service_unconfigured' });

  const upstreamRequest = buildUpstreamRequest(request, route, target);

  if (target.kind === 'container') {
    const namespace = env[target.binding];
    if (!namespace || typeof namespace.fetch !== 'function') {
      return jsonResponse(503, { error: 'service_unavailable', service: route.service });
    }
    try {
      return await namespace.fetch(upstreamRequest);
    } catch {
      // Le Container peut avoir été remplacé entre la résolution et l'appel.
      // Le nom du service suffit au diagnostic ; l'erreur brute peut contenir
      // un hôte interne ou un identifiant de conteneur.
      return jsonResponse(502, { error: 'upstream_failed', service: route.service });
    }
  }

  const fetchImpl = deps.fetch || fetch;
  try {
    return await fetchImpl(upstreamRequest);
  } catch {
    return jsonResponse(502, { error: 'upstream_failed', service: route.service });
  }
}
