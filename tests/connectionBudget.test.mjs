import assert from 'node:assert/strict';
import test from 'node:test';
import connectionBudget from '../API/Mainapi/utils/connectionBudget.js';

const { resolveConnectionBudget, describeConnectionBudget } = connectionBudget;

test('le budget reprend les valeurs par défaut du service', () => {
  const budget = resolveConnectionBudget({});
  assert.equal(budget.workers, 12);
  assert.equal(budget.poolSize, 20);
  assert.equal(budget.total, 240);
  assert.equal(budget.budget, null);
  assert.equal(budget.exceeded, false);
});

test('un plafond explicite est comparé au total, sans jamais réduire les valeurs', () => {
  assert.equal(
    resolveConnectionBudget({ NUM_WORKERS: '4', DB_POOL_CONNECTION_LIMIT: '10', DB_CONNECTION_BUDGET: '40' }).exceeded,
    false,
  );
  assert.equal(
    resolveConnectionBudget({ NUM_WORKERS: '4', DB_POOL_CONNECTION_LIMIT: '10', DB_CONNECTION_BUDGET: '39' }).exceeded,
    true,
  );

  // Le dépassement est signalé, pas corrigé : réduire la capacité à la place du
  // propriétaire masquerait une configuration fausse.
  const over = resolveConnectionBudget({ NUM_WORKERS: '12', DB_CONNECTION_BUDGET: '40' });
  assert.equal(over.total, 240);
  assert.equal(over.poolSize, 20);
  assert.equal(over.exceeded, true);
});

test('les valeurs invalides retombent sur les défauts du service', () => {
  assert.deepEqual(
    resolveConnectionBudget({ NUM_WORKERS: '0', DB_POOL_CONNECTION_LIMIT: 'abc', DB_CONNECTION_BUDGET: '-5' }),
    { workers: 12, poolSize: 20, total: 240, budget: null, exceeded: false },
  );
});

test('la ligne de journal montre le calcul sans configuration sensible', () => {
  const line = describeConnectionBudget({ NUM_WORKERS: '4', DB_POOL_CONNECTION_LIMIT: '10', DB_CONNECTION_BUDGET: '30' });
  assert.match(line, /4 workers × 10 connexions = 40/);
  assert.match(line, /DÉPASSE/);
  assert.doesNotMatch(line, /DB_HOST|DB_PASSWORD|password|@/i);
});
