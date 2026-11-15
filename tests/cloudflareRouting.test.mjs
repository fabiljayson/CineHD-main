import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConfig, resolveRoute, dispatch } from '../deployment/cloudflare/src/routing.mjs';

const ENV = {
  MAIN_API_HOST: 'api.cinehd.test',
  WATCHPARTY_HOST: 'watch.cinehd.test',
  PROXY_HOST: 'proxy.cinehd.test',
  MAIN_API_TARGET: 'container:MAIN_API',
  WATCHPARTY_TARGET: 'container:WATCHPARTY',
  PROXY_TARGET: 'origin:https://proxy-docker.internal:8080',
};

function config(overrides = {}) {
  return parseConfig({ ...ENV, ...overrides });
}

function url(host, path = '/') {
  return new URL(`https://${host}${path}`);
}

test('chaque hôte configuré ne résout que son service', () => {
  const cfg = config();
  assert.equal(resolveRoute(url('api.cinehd.test', '/api/sync'), cfg).service, 'mainapi');
  assert.equal(resolveRoute(url('watch.cinehd.test', '/socket.io/'), cfg).service, 'watchparty');
  assert.equal(resolveRoute(url('proxy.cinehd.test', '/embed/abc'), cfg).service, 'proxy');
});

test('hôte normalisé : casse, point final et port ignorés', () => {
  const cfg = config();
  assert.equal(resolveRoute(url('API.CineHD.Test.', '/x'), cfg).service, 'mainapi');
  assert.equal(resolveRoute(new URL('https://api.cinehd.test:8443/x'), cfg).service, 'mainapi');
});

test('un hôte inconnu est refusé et ne retombe sur aucun service', () => {
  const cfg = config();
  const route = resolveRoute(url('evil.example.com', '/api/sync'), cfg);
  assert.equal(route.service, undefined);
  assert.equal(route.error.status, 404);
});

test('les routes internes sont refusées même sur un hôte valide', () => {
  const cfg = config();
  for (const path of ['/internal/metrics', '/__debug', '/internal']) {
    const route = resolveRoute(url('api.cinehd.test', path), cfg);
    assert.equal(route.error?.status, 404, `${path} doit être refusé`);
  }
});

test('le routage par préfixe choisit le service et retire le préfixe', () => {
  const cfg = config({ FALLBACK_HOST: 'cinehd.test' });
  const route = resolveRoute(url('cinehd.test', '/watchparty/socket.io/?EIO=4'), cfg);
  assert.equal(route.service, 'watchparty');
  assert.equal(route.upstreamPath, '/socket.io/?EIO=4');
});

test('le préfixe le plus long gagne', () => {
  const cfg = config({
    FALLBACK_HOST: 'cinehd.test',
    PATH_ROUTES: '/api=mainapi,/api/v2=proxy',
  });
  assert.equal(resolveRoute(url('cinehd.test', '/api/v2/asset'), cfg).service, 'proxy');
  assert.equal(resolveRoute(url('cinehd.test', '/api/sync'), cfg).service, 'mainapi');
});

test('la cible peut être un conteneur ou une origine externe', () => {
  const cfg = config({ PROXY_TARGET: 'origin:https://proxy-docker.internal:9090' });
  assert.deepEqual(cfg.targets.mainapi, { kind: 'container', binding: 'MAIN_API' });
  assert.deepEqual(cfg.targets.proxy, { kind: 'origin', origin: 'https://proxy-docker.internal:9090' });
});

test('la requête transmise conserve méthode, corps, en-têtes et chaîne de requête', async () => {
  const cfg = config();
  const seen = [];
  const env = {
    MAIN_API: {
      fetch: async (request) => {
        seen.push(request);
        return new Response('ok', { status: 201, headers: { 'content-type': 'text/plain' } });
      },
    },
  };

  const request = new Request(`${url('api.cinehd.test', '/api/sync?profile=7&x=1')}`, {
    method: 'POST',
    body: JSON.stringify({ hello: 'monde' }),
    headers: { 'content-type': 'application/json', 'x-trace': 'abc' },
  });

  const response = await dispatch(request, env, cfg);
  assert.equal(response.status, 201);
  assert.equal(await response.text(), 'ok');

  const forwarded = seen[0];
  assert.equal(forwarded.method, 'POST');
  assert.equal(await forwarded.text(), '{"hello":"monde"}');
  assert.equal(forwarded.headers.get('x-trace'), 'abc');
  assert.equal(new URL(forwarded.url).search, '?profile=7&x=1');
  assert.equal(new URL(forwarded.url).pathname, '/api/sync');
});

test('la mise à niveau WebSocket est transmise intacte', async () => {
  const cfg = config();
  let upgrade = null;
  const env = {
    WATCHPARTY: {
      fetch: async (request) => {
        upgrade = request.headers.get('upgrade');
        // 101 n'est pas un statut Response valide côté client : on vérifie
        // l'en-tête transmis, pas une fausse poignée de main.
        return new Response('upgraded', { status: 200 });
      },
    },
  };

  const request = new Request(url('watch.cinehd.test', '/socket.io/?EIO=4&transport=websocket'), {
    headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'k' },
  });

  const response = await dispatch(request, env, cfg);
  assert.equal(response.status, 200);
  assert.equal(upgrade, 'websocket');
});

test('une origine externe reçoit le chemin complet et sa requête complète', async () => {
  const cfg = config();
  const calls = [];
  const fakeFetch = async (request) => {
    calls.push(request);
    return new Response('proxy');
  };

  const response = await dispatch(new Request(url('proxy.cinehd.test', '/embed/abc?q=1')), {}, cfg, { fetch: fakeFetch });
  assert.equal(await response.text(), 'proxy');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://proxy-docker.internal:8080/embed/abc?q=1');
});

test('un service sans cible répond 502 sans appeler quoi que ce soit', async () => {
  const cfg = parseConfig({ MAIN_API_HOST: 'api.cinehd.test' });
  const response = await dispatch(new Request(url('api.cinehd.test', '/api/sync')), {}, cfg, {
    fetch: async () => {
      throw new Error('ne doit pas être appelé');
    },
  });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'service_unconfigured');
});

test("l'échec d'un conteneur devient 502 nommé, pas une exception non gérée", async () => {
  const cfg = config();
  const env = {
    MAIN_API: {
      fetch: async () => {
        throw new Error('container gone');
      },
    },
  };
  const response = await dispatch(new Request(url('api.cinehd.test', '/api/sync')), env, cfg);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).service, 'mainapi');
});

test('une route inconnue ne touche jamais l’amont', async () => {
  let called = false;
  const response = await dispatch(
    new Request(url('api.cinehd.test', '/internal/secret')),
    { MAIN_API: { fetch: async () => { called = true; return new Response('x'); } } },
    config(),
  );
  assert.equal(response.status, 404);
  assert.equal(called, false);
});
