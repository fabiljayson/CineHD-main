/**
 * Budget de connexions MySQL d'une instance de la Main API.
 *
 * Le pool est créé par worker (`DB_POOL_CONNECTION_LIMIT`, 20 par défaut) et le
 * master lance `NUM_WORKERS` workers (12 par défaut) : une seule instance peut
 * donc ouvrir 240 connexions. Avec plusieurs Containers, ce produit multiplie
 * et sature Neon (ou le `max_connections` de MySQL) sans qu'aucun log ne le
 * dise.
 *
 * Ce module rend le calcul explicite et le compare à un plafond optionnel,
 * `DB_CONNECTION_BUDGET`, fixé par le propriétaire (décision D3). Il ne modifie
 * aucune valeur : réduire silencieusement la capacité serait pire qu'avertir.
 */

const DEFAULT_WORKERS = 12;
const DEFAULT_POOL_SIZE = 20;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @returns {{workers:number, poolSize:number, total:number, budget:number|null, exceeded:boolean}}
 */
function resolveConnectionBudget(env = process.env) {
  const workers = positiveInt(env.NUM_WORKERS, DEFAULT_WORKERS);
  const poolSize = positiveInt(env.DB_POOL_CONNECTION_LIMIT, DEFAULT_POOL_SIZE);
  const parsedBudget = Number.parseInt(env.DB_CONNECTION_BUDGET, 10);
  const budget = Number.isInteger(parsedBudget) && parsedBudget > 0 ? parsedBudget : null;
  const total = workers * poolSize;
  return { workers, poolSize, total, budget, exceeded: budget !== null && total > budget };
}

/** Ligne de journal, sans identifiants ni hôte de base. */
function describeConnectionBudget(env = process.env) {
  const { workers, poolSize, total, budget, exceeded } = resolveConnectionBudget(env);
  const base = `${workers} workers × ${poolSize} connexions = ${total} connexions MySQL par instance`;
  if (budget === null) return `${base} (aucun plafond DB_CONNECTION_BUDGET défini)`;
  return exceeded
    ? `${base} — DÉPASSE le plafond DB_CONNECTION_BUDGET=${budget}`
    : `${base} (plafond DB_CONNECTION_BUDGET=${budget})`;
}

module.exports = {
  DEFAULT_WORKERS,
  DEFAULT_POOL_SIZE,
  resolveConnectionBudget,
  describeConnectionBudget,
};
