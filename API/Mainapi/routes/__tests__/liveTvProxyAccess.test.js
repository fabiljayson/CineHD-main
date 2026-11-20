const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const STREAM_ROUTE = '/stream/:type/:channelId';
const PLAYLIST_ROUTE = '/fctv/playlist';
const VAVOO_ID = 'vavoo_test_channel';
const DIRECT_URL = 'http://198.51.100.20:8008/sunshine/test/hls/index.m3u8';
const rawStream = () => ({
  title: 'Vavoo',
  url: DIRECT_URL,
  _directPlay: true,
  behaviorHints: { notWebReady: false },
});

// Routes, contrôle VIP et signatures réels ; SQL, cache disque et amonts simulés.
// Aucun service, secret local ou appel réseau n'est utilisé.
function fixture({ signing = true, seedVavoo = true } = {}) {
  const cache = new Map();
  const sqlKeys = [];
  let playlistReads = 0;
  let resolutions = 0;
  const base = path.resolve(__dirname, '../..');
  const env = {
    MEDIA_SIGNING_SECRET: signing ? 'livetv-test-signing-secret' : '',
    PROXIESEMBED_PUBLIC_URL: 'https://proxy.example',
    PROXY_SERVER_URL: 'https://proxy.example/proxy',
    IPTV_STREAM_PROXY: 'https://proxy.example/proxy',
    XTREAM_URL: 'https://iptv.example',
    XTREAM_USER: 'fixture-user',
    XTREAM_PASS: 'fixture-password',
  };
  const quietConsole = { log() {}, warn() {}, error() {} };
  const inertInterval = () => ({ unref() {} });

  function load(relative, dependencies = {}, extra = {}) {
    const filename = path.join(base, relative);
    const localRequire = createRequire(filename);
    const module = { exports: {} };
    const context = vm.createContext({
      module, exports: module.exports, __dirname: path.dirname(filename),
      Buffer, URL, URLSearchParams, Date, setTimeout, clearTimeout,
      setInterval: inertInterval, console: quietConsole, process: { env },
      require: request => request in dependencies ? dependencies[request] : localRequire(request),
      ...extra,
    });
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    return { exports: module.exports, context };
  }

  const vip = load('checkVip.js', {
    './mysqlPool': { getPool: () => ({ async execute(sql, parameters) {
      assert.match(sql, /WHERE key_value = \?/);
      sqlKeys.push(parameters[0]);
      const rows = {
        valid: { active: 1, expires_at: null },
        inactive: { active: 0, expires_at: null },
        expired: { active: 1, expires_at: '2000-01-01' },
      };
      return [rows[parameters[0]] ? [rows[parameters[0]]] : []];
    } }) },
  }).exports;
  const mediaSigning = load('utils/mediaSigning.js').exports;
  const cachePath = key => path.join(base, 'cache/tvdirect', `${crypto.createHash('md5').update(key).digest('hex')}.json`);
  const seed = (key, value) => cache.set(cachePath(key), JSON.stringify(value));
  if (seedVavoo) seed(`vavoo_stream_${VAVOO_ID}_v1`, { streams: [rawStream()] });
  const missing = () => Object.assign(new Error('Cache absent'), { code: 'ENOENT' });
  const axios = {
    async get(url, options = {}) {
      if (url === 'https://iptv.example/player_api.php') {
        return {
          data: options.params.action === 'get_live_categories'
            ? [{ category_id: 'sports', category_name: 'Sports', parent_id: 0 }]
            : [{ stream_id: 12, name: 'Channel', category_id: 'sports' }],
        };
      }
      if (url === 'https://cdn.example/playlist.m3u8') {
        playlistReads++;
        return { status: 200, data: '#EXTM3U\n#EXTINF:6,\nsegment.ts\n' };
      }
      // Le préchauffage NorthLive ne doit pas sortir du test.
      if (url.includes('northlive')) return { data: { data: [] } };
      throw new Error(`Appel réseau inattendu : ${url}`);
    },
  };
  const { exports: router, context } = load('liveTvRoutes.js', {
    './checkVip': vip,
    './utils/mediaSigning': mediaSigning,
    './utils/proxyManager': {},
    './utils/workerSlots': { isNorthliveRefreshOwner: () => false },
    './utils/northliveCatalog': {
      createNorthliveCatalog: () => ({ isOwner: false, getChannels: async () => [] }),
      publishNorthliveCatalog: async () => { throw new Error('Publication Northlive inattendue'); },
      scrapeNorthlivePages: async () => { throw new Error('Scraping Northlive inattendu'); },
    },
    './utils/vavooMetadata': {
      createVavooMetadataService: () => ({ getIndexForGroup: async () => new Map() }),
      findVavooMetadata: () => null,
      isHttpsArtworkUrl: () => false,
    },
    axios,
    fs: { promises: {
      async access() {},
      async stat(filename) {
        if (!cache.has(filename)) throw missing();
        return { mtime: new Date() };
      },
      async readFile(filename) {
        if (!cache.has(filename)) throw missing();
        return cache.get(filename);
      },
      async writeFile(filename, value) { cache.set(filename, value); },
      async rename(from, to) { cache.set(to, cache.get(from)); cache.delete(from); },
      async unlink(filename) { cache.delete(filename); },
    } },
  }, {
    resolveVavooFixture: async () => { resolutions++; return DIRECT_URL; },
    fctvStreamsFixture: [
      { title: 'Match', _fctvNative: { matchId: 42, streamId: 'one', siteType: 3, sportType: 1 } },
      { title: 'HLS', url: DIRECT_URL, needsProxy: true, referer: 'https://player.example/' },
    ],
  });
  // Seuls les résolveurs amont sont substitués ; les branches de route restent réelles.
  vm.runInContext(`
    resolveVavooStream = resolveVavooFixture;
    resolveFctvMatchStream = async () => fctvStreamsFixture;
    getFctvPlayerBaseUrl = async () => 'https://player.example';
    getFctvApiBase = async () => 'https://sports.example';
    resolveFctvUpstreamPlaylist = async () => ({
      playlistUrl: 'https://cdn.example/playlist.m3u8',
      origin: 'https://cdn.example', token: 'fixture-token',
    });
  `, context);

  async function request(routePath = STREAM_ROUTE, { key, channelId = VAVOO_ID, query = {}, params = {} } = {}) {
    const req = {
      params: { type: 'tv', channelId, streamId: '12', ...params }, query,
      headers: key === undefined ? {} : { 'x-access-key': key },
      protocol: 'https', get: name => name === 'host' ? 'api.example' : undefined,
    };
    const res = {
      statusCode: 200, headers: {},
      status(value) { this.statusCode = value; return this; },
      set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
      setHeader(name, value) { return this.set(name, value); },
      vary(name) { this.headers.vary = name; return this; },
      json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; },
      send(value) { this.body = value; return this; },
    };
    const route = router.stack.find(layer => layer.route?.path === routePath);
    assert.ok(route, `Route présente : ${routePath}`);
    const handlers = [
      ...router.stack.filter(layer => !layer.route).map(layer => layer.handle),
      ...route.route.stack.map(layer => layer.handle),
    ];
    for (const handler of handlers) {
      let next = false;
      await handler(req, res, () => { next = true; });
      if (!next) break;
    }
    return res;
  }
  return { request, seed, cache, sqlKeys, mediaSigning, resolutions: () => resolutions, playlistReads: () => playlistReads };
}

function assertSignedProxy(url, target, signing) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://proxy.example');
  assert.equal(parsed.searchParams.get('url') || parsed.pathname.slice('/proxy/'.length), target);
  assert.equal(parsed.searchParams.get('sig'), signing.computeSignature('/proxy', target, parsed.searchParams.get('exp')));
}

for (const key of [undefined, 'invalid', 'inactive', 'expired']) {
  test(`Vavoo en cache reste accessible et proxifié sans statut VIP (${key ?? 'absent'})`, async () => {
    const app = fixture();
    const res = await app.request(STREAM_ROUTE, { key });
    assert.equal(res.statusCode, 200);
    assertSignedProxy(res.body.streams[0].proxyUrl, DIRECT_URL, app.mediaSigning);
    assert.deepEqual(app.sqlKeys, []);
    assert.equal(app.resolutions(), 0);
  });
}

test('un flux Vavoo frais est proxifié et son cache ne contient aucune signature', async () => {
  const app = fixture({ seedVavoo: false });
  const res = await app.request();
  assertSignedProxy(res.body.streams[0].proxyUrl, DIRECT_URL, app.mediaSigning);
  assert.equal(app.resolutions(), 1);
  assert.ok([...app.cache.values()].every(value => !value.includes('proxyUrl')));
});

test('les signatures ne dépendent pas de la clé et ne contaminent pas le cache partagé', async () => {
  const app = fixture({ seedVavoo: false });
  const first = await app.request(STREAM_ROUTE, { key: 'valid' });
  assert.equal(first.statusCode, 200);
  assertSignedProxy(first.body.streams[0].proxyUrl, DIRECT_URL, app.mediaSigning);
  const second = await app.request();
  assertSignedProxy(second.body.streams[0].proxyUrl, DIRECT_URL, app.mediaSigning);
  assert.equal(app.resolutions(), 1);
  for (const res of [first, second]) {
    assert.equal(res.headers['cache-control'], 'private, no-store');
  }
});

test('une salve avec différentes clés partage la résolution sans dépendre du statut VIP', async () => {
  const app = fixture({ seedVavoo: false });
  const responses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
    app.request(STREAM_ROUTE, { key: index % 2 === 0 ? 'valid' : 'invalid' })));
  assert.equal(app.resolutions(), 1);
  responses.forEach(res => {
    assert.equal(res.statusCode, 200);
    assertSignedProxy(res.body.streams[0].proxyUrl, DIRECT_URL, app.mediaSigning);
  });
  assert.ok([...app.cache.values()].every(value => !value.includes('proxyUrl')));
});

for (const signing of [true, false]) {
  test(`une ancienne proxyUrl en cache est remplacée sans dépendre du statut (signature ${signing})`, async () => {
    const app = fixture({ signing });
    app.seed(`vavoo_stream_${VAVOO_ID}_v1`, {
      streams: [{ ...rawStream(), proxyUrl: 'https://proxy.example/proxy?old=signature' }],
    });
    const res = await app.request();
    assert.equal(res.body.streams[0].url, DIRECT_URL);
    if (signing) {
      assertSignedProxy(res.body.streams[0].proxyUrl, DIRECT_URL, app.mediaSigning);
    } else {
      assert.equal('proxyUrl' in res.body.streams[0], false);
    }
  });
}

test('sans secret de signature, un flux en cache reste direct', async () => {
  const app = fixture({ signing: false });
  const res = await app.request(STREAM_ROUTE, { key: 'valid' });
  assert.deepEqual(res.body.streams, [rawStream()]);
});

test('IPTV reste utilisable sans VIP et ses URLs restent signées', async () => {
  const app = fixture();
  for (const route of [STREAM_ROUTE, '/iptv/stream-url/:streamId']) {
    const response = await app.request(route, { channelId: 'iptv_12' });
    assert.equal(response.statusCode, 200);
    assertSignedProxy(response.body.streams[0].url, 'https://iptv.example/live/fixture-user/fixture-password/12.m3u8', app.mediaSigning);
  }
});

test('les catégories et chaînes IPTV sont accessibles sans clé VIP', async () => {
  const app = fixture();
  const categories = await app.request('/iptv/categories');
  const streams = await app.request('/iptv/streams/:categoryId', {
    params: { categoryId: 'sports' },
  });
  assert.equal(categories.statusCode, 200);
  assert.equal(categories.body.categories[0].category_id, 'sports');
  assert.equal(streams.statusCode, 200);
  assert.equal(streams.body.streams[0].stream_id, 12);
});

test('les matchs et flux nécessitant un proxy sont accessibles sans VIP', async () => {
  const app = fixture();
  app.seed('fctv_match_stream_match_42_ua1_free', {
    streams: [{ title: 'Ancien cache', url: 'https://proxy.example/proxy?old=signature' }],
  });
  const res = await app.request(STREAM_ROUTE, { channelId: 'match_42' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body.streams[0].url, /\/api\/livetv\/fctv\/playlist\?/);
  assert.ok(res.body.streams.some(stream => stream.proxyUrl));
});

test('une playlist FCTV sans autorisation ne contacte pas l’amont', async () => {
  const app = fixture();
  for (const mode of [undefined, 'proxy', 'unknown']) {
    const res = await app.request(PLAYLIST_ROUTE, { query: { matchId: '42', streamId: 'one', mode } });
    assert.equal(res.statusCode, 403);
  }
  assert.equal(app.playlistReads(), 0);
});

test('le lien FCTV délivré au client se lit sans header et signe les segments', async () => {
  const app = fixture();
  const vip = await app.request(STREAM_ROUTE, { key: 'valid', channelId: 'match_42' });
  const url = new URL(vip.body.streams[0].url);
  const query = Object.fromEntries(url.searchParams);
  const res = await app.request(PLAYLIST_ROUTE, { query });
  assert.equal(res.statusCode, 200);
  const segment = res.body.split('\n').find(line => line.startsWith('https://'));
  assertSignedProxy(segment, 'https://cdn.example/token-fixture-token/segment.ts', app.mediaSigning);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  for (const field of ['matchId', 'streamId', 'siteType', 'sportType', 'token']) {
    const changed = await app.request(PLAYLIST_ROUTE, { query: { ...query, [field]: 'modified' } });
    assert.equal(changed.statusCode, 403, `${field} doit être lié à l’autorisation`);
  }
  const target = JSON.stringify(['42', 'one', '3', '1']);
  for (const token of [
    app.mediaSigning.encodeSignedToken('/api/livetv/fctv/playlist', target, -1),
    app.mediaSigning.encodeSignedToken('/another-route', target),
  ]) {
    const rejected = await app.request(PLAYLIST_ROUTE, { query: { ...query, token } });
    assert.equal(rejected.statusCode, 403);
  }
  assert.equal(app.playlistReads(), 1);
});

test('une playlist FCTV en mode raw reste directe pour l’extension', async () => {
  const app = fixture();
  const res = await app.request(PLAYLIST_ROUTE, { query: { matchId: '42', streamId: 'one', mode: 'raw' } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('https://cdn.example/token-fixture-token/segment.ts'));
  assert.ok(!res.body.includes('proxy.example'));
});

test('les paramètres FCTV structurés sont refusés avant leur conversion ou l’amont', async () => {
  const app = fixture();
  for (const mode of ['raw', 'proxy']) {
    for (const field of ['matchId', 'streamId', 'siteType', 'sportType']) {
      const res = await app.request(PLAYLIST_ROUTE, {
        query: { matchId: '42', streamId: 'one', mode, [field]: { toString: 'invalid' } },
      });
      assert.equal(res.statusCode, 400);
    }
  }
  assert.equal(app.playlistReads(), 0);
});
