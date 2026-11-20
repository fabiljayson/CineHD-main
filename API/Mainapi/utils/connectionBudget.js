/**
 * Budget de connexions MySQL d'une instance de la Main API.
 *
 * Le pool est créé par worker (`DB_POOL_CONNECTION_LIMIT`, 20 par défaut) et le
 * master lance `NUM_WORKERS` workers (12 par défaut) : une seule instance peut
 * donc ouvrir 240 connexions. Avec plusieurs Containers, ce produit multiplie
 * et sature Neon (ou le `max_connections` de MySQL) sans qu'aucun log ne le
 * dise.
 *
 * Deux opérations distinctes, volontairement séparées :
 *
 * - `resolveConnectionBudget` lit la configuration et calcule le produit brut.
 *   Il ne décide rien : c'est ce que l'on journalise et ce que l'on documente.
 * - `applyConnectionBudget` applique le plafond `DB_CONNECTION_BUDGET` (décision
 *   D3, fixée par le propriétaire) en réduisant la taille du pool, jamais le
 *   nombre de workers — un worker en moins, c'est une modification de
 *   topologie ; un pool plus petit, seulement moins de parallélisme par worker.
 *
 * Sans `DB_CONNECTION_BUDGET`, les deux fonctions rendent exactement les valeurs
 * du service : le comportement actuel ne change pas tant que le propriétaire
 * n'a pas fixé le plafond.
 */

const DEFAULT_WORKERS = 12;
const DEFAULT_POOL_SIZE = 20;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Configuration brute, sans plafond appliqué.
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

/**
 * Configuration après plafond. `poolSize` est la valeur à passer au pool.
 *
 * `impossible` signale un plafond inférieur au nombre de workers : même une
 * connexion par worker dépasse le budget, et aucun réglage ne peut le tenir.
 * C'est une erreur de configuration, pas une situation à masquer.
 *
 * @returns {{workers:number, poolSize:number, requestedPoolSize:number, total:number,
 *            budget:number|null, clamped:boolean, impossible:boolean}}
 */
function applyConnectionBudget(env = process.env) {
  const { workers, poolSize, budget } = resolveConnectionBudget(env);

  if (budget === null || workers * poolSize <= budget) {
    return {
      workers,
      poolSize,
      requestedPoolSize: poolSize,
      total: workers * poolSize,
      budget,
      clamped: false,
      impossible: false,
    };
  }

  const fitted = Math.floor(budget / workers);
  const effectivePoolSize = fitted >= 1 ? fitted : 1;

  return {
    workers,
    poolSize: effectivePoolSize,
    requestedPoolSize: poolSize,
    total: workers * effectivePoolSize,
    budget,
    clamped: true,
    impossible: fitted < 1,
  };
}

/** Taille de pool à utiliser, plafond appliqué. */
function resolvePoolLimit(env = process.env) {
  return applyConnectionBudget(env).poolSize;
}

/** Ligne de journal, sans identifiants ni hôte de base. */
function describeConnectionBudget(env = process.env) {
  const { workers, poolSize, requestedPoolSize, total, budget, clamped, impossible } = applyConnectionBudget(env);

  if (budget === null) {
    return `${workers} workers × ${poolSize} connexions = ${total} connexions MySQL par instance (aucun plafond DB_CONNECTION_BUDGET défini)`;
  }
  if (impossible) {
    return `${workers} workers × 1 connexion = ${total} connexions MySQL par instance — plafond DB_CONNECTION_BUDGET=${budget} trop bas pour ce nombre de workers`;
  }
  if (clamped) {
    return `${workers} workers × ${poolSize} connexions = ${total} connexions MySQL par instance — réduit depuis ${workers * requestedPoolSize} par DB_CONNECTION_BUDGET=${budget}`;
  }
  return `${workers} workers × ${poolSize} connexions = ${total} connexions MySQL par instance (plafond DB_CONNECTION_BUDGET=${budget})`;
}

module.exports = {
  DEFAULT_WORKERS,
  DEFAULT_POOL_SIZE,
  resolveConnectionBudget,
  applyConnectionBudget,
  resolvePoolLimit,
  describeConnectionBudget,
};
