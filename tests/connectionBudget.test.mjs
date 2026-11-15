import assert from 'node:assert/strict';
import test from 'node:test';
import connectionBudget from '../API/Mainapi/utils/connectionBudget.js';

const { resolveConnectionBudget, applyConnectionBudget, resolvePoolLimit, describeConnectionBudget } = connectionBudget;

test('sans plafond, le budget appliqué est celui du service', () => {
  const raw = resolveConnectionBudget({});
  const applied = applyConnectionBudget({});

  assert.equal(raw.total, 240);
  assert.equal(applied.poolSize, 20);
  assert.equal(applied.clamped, false);
  assert.equal(applied.impossible, false);
  assert.equal(resolvePoolLimit({}), 20);
});

test('le plafond réduit la taille du pool, jamais le nombre de workers', () => {
  const applied = applyConnectionBudget({ NUM_WORKERS: '4', DB_POOL_CONNECTION_LIMIT: '10', DB_CONNECTION_BUDGET: '30' });

  assert.equal(applied.workers, 4);
  assert.equal(applied.requestedPoolSize, 10);
  assert.equal(applied.poolSize, 7);
  assert.equal(applied.total, 28);
  assert.equal(applied.clamped, true);
  assert.ok(applied.total <= 30, 'le total appliqué respecte le plafond');
});

test('un plafond déjà respecté ne change rien', () => {
  const applied = applyConnectionBudget({ NUM_WORKERS: '4', DB_POOL_CONNECTION_LIMIT: '10', DB_CONNECTION_BUDGET: '40' });

  assert.equal(applied.clamped, false);
  assert.equal(applied.poolSize, 10);
  assert.equal(applied.total, 40);
});

test('un plafond inférieur au nombre de workers est signalé comme impossible', () => {
  const applied = applyConnectionBudget({ NUM_WORKERS: '4', DB_CONNECTION_BUDGET: '2' });

  assert.equal(applied.poolSize, 1);
  assert.equal(applied.total, 4);
  assert.equal(applied.impossible, true);
  assert.match(describeConnectionBudget({ NUM_WORKERS: '4', DB_CONNECTION_BUDGET: '2' }), /trop bas/);
});

test('les valeurs invalides retombent sur les défauts du service', () => {
  assert.deepEqual(
    resolveConnectionBudget({ NUM_WORKERS: '0', DB_POOL_CONNECTION_LIMIT: 'abc', DB_CONNECTION_BUDGET: '-5' }),
    { workers: 12, poolSize: 20, total: 240, budget: null, exceeded: false },
  );
});

test('la ligne de journal montre la réduction sans configuration sensible', () => {
  const line = describeConnectionBudget({ NUM_WORKERS: '4', DB_POOL_CONNECTION_LIMIT: '10', DB_CONNECTION_BUDGET: '30' });

  assert.match(line, /4 workers × 7 connexions = 28/);
  assert.match(line, /réduit depuis 40/);
  assert.doesNotMatch(line, /DB_HOST|DB_PASSWORD|password|@/i);
});
