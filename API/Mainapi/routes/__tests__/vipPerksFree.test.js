const assert = require('node:assert/strict');
const fs = require('node:fs');
const jwt = require('jsonwebtoken');
const path = require('node:path');
const test = require('node:test');
const { createRequire } = require('node:module');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function loadModule(relativePath, dependencies, env = {}) {
  const filename = path.join(ROOT, relativePath);
  const localRequire = createRequire(filename);
  const loaded = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: loaded,
    exports: loaded.exports,
    __dirname: path.dirname(filename),
    process: { env },
    console: { log() {}, warn() {}, error() {} },
    Buffer,
    URL,
    require(name) {
      return Object.hasOwn(dependencies, name) ? dependencies[name] : localRequire(name);
    },
  }, { filename });
  return loaded.exports;
}

async function dispatch(router, routePath, method, { headers = {}, query = {}, body = {}, params = {} } = {}) {
  const route = router.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method])?.route;
  assert.ok(route, `Route absente : ${method} ${routePath}`);
  const req = {
    headers, query, body, params, ip: '198.51.100.10', protocol: 'https',
    get: name => name === 'host' ? 'api.example' : undefined,
  };
  const res = {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    json(value) { this.body = value; return this; },
  };
  for (const layer of route.stack) {
    let proceed = false;
    await layer.handle(req, res, () => { proceed = true; });
    if (!proceed) break;
  }
  return res;
}

function makeVipMiddleware(req, res, next) {
  if (req.headers['x-access-key'] !== 'valid') {
    return res.status(403).json({ error: 'VIP requis' });
  }
  return next();
}

test('BestDebrid genere un lien sans clé VIP et conserve la validation du lien', async () => {
  const calls = [];
  const axios = {
    get: async (url, options) => {
      calls.push({ url, options });
      return { data: { link: 'https://download.example/file' } };
    },
  };
  const express = require('express');
  const router = loadModule('routes/debrid.js', {
    express,
    axios,
    '../checkVip': { requireVip: makeVipMiddleware },
  }, { BESTDEBRID_API_KEY: 'backend-key' });

  const response = await dispatch(router, '/debrid/generate', 'post', {
    body: { link: 'https://files.example/source' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.link, 'https://download.example/file');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.params.auth, 'backend-key');

  const invalid = await dispatch(router, '/debrid/generate', 'post', { body: { link: 'file://local' } });
  assert.equal(invalid.statusCode, 400);
});

function makeMediaExtractFixture({ configured = true } = {}) {
  const axiosCalls = [];
  let rateLimitCalls = 0;
  const rateLimit = () => (_req, _res, next) => {
    rateLimitCalls++;
    next();
  };
  rateLimit.ipKeyGenerator = ip => ip;
  const config = {
    internalKeyConfigured: () => configured,
    signingConfigured: () => configured,
    internalHeaders: headers => ({ ...headers, 'x-internal-key': 'internal-test-key' }),
    decodeSignedToken: () => 'https://www.france.tv/programme/video/episode',
    isPublicHttpUrl: value => {
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol);
      } catch {
        return false;
      }
    },
  };
  const axios = {
    get: async (url, options) => {
      axiosCalls.push({ method: 'get', url, options });
      return { data: { status: 'success', providers: ['deepbrid'] } };
    },
    post: async (url, data, options) => {
      axiosCalls.push({ method: 'post', url, data, options });
      return { data: { status: 'success' } };
    },
  };
  const router = loadModule('routes/mediaExtract.js', {
    express: require('express'),
    axios,
    'express-rate-limit': rateLimit,
    '../utils/redisRateLimitStore': { createRedisRateLimitStore: () => ({}) },
    '../utils/clientIp': { getTrustedClientIp: () => null },
    '../checkVip': { requireVip: makeVipMiddleware },
    '../utils/mediaSigning': config,
  }, {
    PROXIESEMBED_INTERNAL_URL: 'http://proxy-internal:25569',
  });
  return { router, axiosCalls, rateLimitCalls: () => rateLimitCalls };
}

test('la passerelle Debrid fonctionne sans clé VIP, garde la clé interne et limite les appels', async () => {
  const fixture = makeMediaExtractFixture();
  const response = await dispatch(fixture.router, '/debrid/providers', 'get');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.providers, ['deepbrid']);
  assert.equal(fixture.axiosCalls[0].options.headers['x-internal-key'], 'internal-test-key');

  const invalid = await dispatch(fixture.router, '/debrid/unlock', 'post', {
    body: { link: 'file://local' },
  });
  assert.equal(invalid.statusCode, 400);
  assert.ok(fixture.rateLimitCalls() > 0);
});

test('une passerelle mal configurée reste fermée sans clé VIP', async () => {
  const fixture = makeMediaExtractFixture({ configured: false });
  const response = await dispatch(fixture.router, '/debrid/providers', 'get');
  assert.equal(response.statusCode, 503);
  assert.equal(fixture.axiosCalls.length, 0);
});

function makeWishboardFixture() {
  const secret = 'wishboard-free-test-secret';
  const profileFiles = {
    '/data/users/user.json': JSON.stringify({
      profiles: [{ id: 'free-profile' }, { id: 'vip-profile' }],
    }),
    '/profiles/free-profile.json': JSON.stringify({ access_code: 'free-key' }),
    '/profiles/vip-profile.json': JSON.stringify({ access_code: 'legacy-vip-key' }),
  };
  const pool = {
    async execute(sql) {
      if (sql.includes('FROM user_sessions')) return [[{ id: 'session' }]];
      if (sql.includes('COUNT(*) as count FROM wishboard_requests')) return [[{ count: 2 }]];
      throw new Error(`Requête inattendue dans le test Wishboard: ${sql}`);
    },
  };
  const dependencies = {
    express: require('express'),
    jsonwebtoken: jwt,
    fs: { promises: {
      readFile: async filename => {
        const normalized = filename.replace(/\\/g, '/');
        if (normalized.endsWith('/user.json')) return profileFiles['/data/users/user.json'];
        if (normalized.endsWith('/free-profile.json')) return profileFiles['/profiles/free-profile.json'];
        if (normalized.endsWith('/vip-profile.json')) return profileFiles['/profiles/vip-profile.json'];
        throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
      },
    } },
    path: require('node:path'),
    './checkVip': { verifyAccessKey: async key => ({ vip: key === 'legacy-vip-key' }) },
    './utils/tmdbCache': { searchTmdb: async () => ({ results: [] }) },
    './utils/turnstile': { verifyTurnstileFromRequest: async () => ({ valid: true }) },
    './utils/adminIdentity': { resolveAdminIdentity: async () => null },
  };
  const { createWishboardRouter } = loadModule('wishboardRoutes.js', dependencies, { JWT_SECRET: secret });
  const router = createWishboardRouter(pool, null);
  const token = jwt.sign({ sub: 'user', userType: 'oauth', sessionId: 'session' }, secret);

  return {
    router,
    getLimits: profileId => dispatch(router, '/limits', 'get', {
      headers: { authorization: `Bearer ${token}`, 'x-profile-id': profileId },
    }),
  };
}

test('le quota Wishboard de trois demandes par 48 h est identique avec ou sans ancien statut VIP', async () => {
  const fixture = makeWishboardFixture();
  const free = await fixture.getLimits('free-profile');
  const legacyVip = await fixture.getLimits('vip-profile');
  assert.equal(free.statusCode, 200);
  assert.equal(legacyVip.statusCode, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(free.body)), { count: 2, limit: 3, remaining: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(legacyVip.body)), JSON.parse(JSON.stringify(free.body)));
});
