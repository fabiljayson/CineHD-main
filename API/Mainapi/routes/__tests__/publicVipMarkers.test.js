const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const jwt = require('jsonwebtoken');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE user_sessions (id TEXT, user_id TEXT, user_type TEXT);
    CREATE TABLE admins (user_id TEXT, auth_type TEXT, role TEXT);
    CREATE TABLE banned_users (ban_type TEXT, ban_value TEXT, user_type TEXT, reason TEXT, expires_at INTEGER);
    CREATE TABLE comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, content_type TEXT, content_id TEXT,
      user_id TEXT, user_type TEXT, profile_id TEXT, username TEXT, avatar TEXT,
      content TEXT, is_spoiler INTEGER, is_vip INTEGER, is_admin INTEGER,
      created_at INTEGER, ip_address TEXT, deleted INTEGER DEFAULT 0,
      moderation_reason TEXT
    );
    CREATE TABLE comment_replies (
      id INTEGER, comment_id INTEGER, user_id TEXT, user_type TEXT,
      profile_id TEXT, content TEXT, deleted INTEGER DEFAULT 0,
      moderation_reason TEXT
    );
    CREATE TABLE comment_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT, target_id INTEGER,
      user_id TEXT, user_type TEXT, profile_id TEXT
    );
  `);
  db.prepare('INSERT INTO user_sessions VALUES (?, ?, ?)').run('session', 'author', 'oauth');
  db.prepare('INSERT INTO user_sessions VALUES (?, ?, ?)').run('admin-session', 'moderator', 'oauth');
  db.prepare('INSERT INTO admins VALUES (?, ?, ?)').run('moderator', 'oauth', 'admin');
  db.prepare(`
    INSERT INTO comments
      (content_type, content_id, user_id, user_type, profile_id, username, content, is_vip, is_admin, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('movie', '42', 'author', 'oauth', 'profile', 'Author', 'Historical VIP comment', 1, 0, Date.now());

  const cache = new Map([
    ['userData:oauth:author:profile', JSON.stringify({
      username: 'Author', avatar: null, isVip: true, isAdmin: false,
    })],
    ['userData:oauth:author:default', JSON.stringify({
      username: 'Author', avatar: null, isVip: true, isAdmin: true,
    })],
  ]);
  const execute = async (sql, params = []) => {
    if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) {
      const result = db.prepare(sql).run(...params);
      return [{ insertId: Number(result.lastInsertRowid), affectedRows: result.changes }];
    }
    const sqliteSql = sql.replaceAll('target_type = "comment"', "target_type = 'comment'");
    return [db.prepare(sqliteSql).all(...params)];
  };
  const pool = { execute };
  const webhookCalls = [];
  const rateLimit = () => (_req, _res, next) => next();
  rateLimit.ipKeyGenerator = ip => ip;
  const dependencies = {
    express,
    path,
    jsonwebtoken: jwt,
    fs: { promises: {
      readFile: async () => JSON.stringify({ profiles: [{ id: 'profile', name: 'Author' }] }),
    } },
    axios: {
      post: async (url, body) => {
        if (url === 'https://discord.com/api/webhooks/123/token') webhookCalls.push(body);
        return { data: { choices: [{ message: { content: '{"flagged":false,"reason":null,"details":"OK"}' } }] } };
      },
    },
    'web-push': {},
    'express-rate-limit': rateLimit,
    './mysqlPool': { getPool: () => pool },
    './checkVip': { verifyAccessKey: async () => ({ vip: true }) },
    './config/redis': { redis: {
      get: async key => cache.get(key) ?? null,
      set: async (key, value) => { cache.set(key, value); return 'OK'; },
      del: async () => 1,
    } },
    './utils/redisRateLimitStore': { createRedisRateLimitStore: () => ({}) },
    './utils/turnstile': { verifyTurnstileFromRequest: async () => ({ valid: true }) },
    './utils/clientIp': { getTrustedClientIp: () => '198.51.100.10' },
    './services/mediaSegments/communityStore': {},
  };
  const filename = path.resolve(__dirname, '../../commentsRoutes.js');
  const loaded = { exports: {} };
  const secret = 'public-vip-markers-test';
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: loaded,
    exports: loaded.exports,
    __dirname: path.dirname(filename),
    process: { env: {
      JWT_SECRET: secret,
      DISCORD_COMMENTS_WEBHOOK_URL: 'https://discord.com/api/webhooks/123/token',
      FRONTEND_BASE_URL: 'https://cinehd.example',
    } },
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Dépendance non isolée : ${name}`);
      return dependencies[name];
    },
  }, { filename });
  const token = jwt.sign({ sub: 'author', userType: 'oauth', sessionId: 'session' }, secret);
  const adminToken = jwt.sign({ sub: 'moderator', userType: 'oauth', sessionId: 'admin-session' }, secret);

  async function request(routePath, { method = 'get', params = {}, query = {}, body = {}, authenticated = true, asAdmin = false } = {}) {
    const route = loaded.exports.stack.find(layer => layer.route?.path === routePath && layer.route.methods[method])?.route;
    assert.ok(route, `Route absente : ${method} ${routePath}`);
    const req = {
      params, query, body,
      headers: authenticated ? { authorization: `Bearer ${asAdmin ? adminToken : token}` } : {},
      ip: '198.51.100.10',
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; },
    };
    for (const layer of route.stack) {
      let proceed = false;
      await layer.handle(req, res, () => { proceed = true; });
      if (!proceed) break;
    }
    return res;
  }

  return { db, request, webhookCalls };
}

test('les commentaires nouvellement créés restent sans marqueur VIP, y compris dans la notification', async t => {
  const f = fixture(t);
  const response = await f.request('/', {
    method: 'post',
    body: {
      contentType: 'movie', contentId: '42', content: 'Nouveau commentaire',
      profileId: 'profile', isSpoiler: false, turnstileToken: 'test',
    },
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(response.statusCode, 201, JSON.stringify(response.body));
  assert.equal(response.body.is_vip, 0);
  const stored = f.db.prepare('SELECT is_vip FROM comments WHERE id = ?').get(response.body.id);
  assert.equal(stored.is_vip, 0);
  const embed = f.webhookCalls[0].embeds[0];
  assert.doesNotMatch(embed.footer.text, /VIP/);
  assert.equal(embed.color, 0x3498db);
});

test('les marqueurs historiques restent visibles dans l’admin mais pas dans la réponse publique', async t => {
  const f = fixture(t);
  const publicResponse = await f.request('/:contentType/:contentId', {
    params: { contentType: 'movie', contentId: '42' },
    authenticated: false,
  });
  const adminResponse = await f.request('/admin/list', { asAdmin: true });

  assert.equal(publicResponse.statusCode, 200);
  assert.equal(publicResponse.body.comments[0].is_vip, 0);
  assert.equal(adminResponse.statusCode, 200);
  assert.equal(adminResponse.body.comments[0].is_vip, 1);
});
