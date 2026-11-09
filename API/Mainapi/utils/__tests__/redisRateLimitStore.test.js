const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loadStore(redis) {
  const filename = path.resolve(__dirname, '../redisRateLimitStore.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require: request => request === '../config/redis' ? { redis } : localRequire(request),
    Date,
  }, { filename });
  return module.exports.RedisRateLimitStore;
}

function unavailableRedis() {
  const error = new Error('Redis unavailable');
  return {
    multi() {
      return {
        get() { return this; },
        pttl() { return this; },
        incr() { return this; },
        exec: async () => { throw error; },
      };
    },
    error,
  };
}

test('Redis read failures are surfaced so authentication limits cannot reset silently', async () => {
  const redis = unavailableRedis();
  const Store = loadStore(redis);
  const store = new Store({ windowMs: 60_000, failClosed: true });
  await assert.rejects(store.get('client'), redis.error);
});

test('Redis increment failures are surfaced instead of allowing unlimited requests', async () => {
  const redis = unavailableRedis();
  const Store = loadStore(redis);
  const store = new Store({ windowMs: 60_000, failClosed: true });
  await assert.rejects(store.increment('client'), redis.error);
});

test('other rate limiters keep their existing fail-open fallback by default', async () => {
  const redis = unavailableRedis();
  const Store = loadStore(redis);
  const store = new Store({ windowMs: 60_000 });
  assert.equal(await store.get('client'), undefined);
  assert.equal((await store.increment('client')).totalHits, 1);
});
