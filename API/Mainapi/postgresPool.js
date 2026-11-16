/**
 * Pool PostgreSQL de la Main API (Neon) — décision D3 comprise.
 *
 * Le pool est créé paresseusement : un service encore branché sur MySQL ne doit
 * pas ouvrir de connexion PostgreSQL au chargement du module. Sa taille suit
 * `resolvePoolLimit()`, donc `DB_CONNECTION_BUDGET` s'applique ici comme au pool
 * MySQL : un seul budget pour l'instance, quel que soit le moteur.
 *
 * `DATABASE_URL` doit pointer le **pooler** Neon. L'endpoint direct est réservé
 * aux migrations (`DATABASE_MIGRATION_URL`), qui ont besoin d'une session stable
 * pour les verrous consultatifs.
 */

const { Pool, types } = require('pg');
const { resolvePoolLimit } = require('./utils/connectionBudget');
const { withPgAdvisoryLock } = require('./utils/pgAdvisoryLock');
const { schema } = require('./db/schema');

// Fidélité des types face à mysql2, qui est le moteur de référence.
//
// `pg` rend les colonnes `bigint` (COUNT, SUM) en chaîne ; mysql2 les rend en
// nombre. Sans ce parseur, une route convertie change la forme de son JSON de
// `5` à `"5"`, ce qui ne casse aucun test mais casse les clients.
//
// Volontairement laissés tels quels, parce que mysql2 les rend déjà ainsi :
//   - `numeric`/DECIMAL → chaîne des deux côtés (mysql2 ne convertit pas) ;
//   - `timestamp(tz)` → objet Date des deux côtés.
// Comme mysql2, la conversion en nombre perd la précision au-delà de 2^53.
types.setTypeParser(20, (value) => (value === null ? null : Number(value)));

const CONNECTION_TIMEOUT_MS = 10000;
const IDLE_TIMEOUT_MS = 30000;

let pool = null;

function requiresSsl(connectionString, env) {
  if (env.PGSSLMODE === 'disable') return false;
  if (env.PGSSLMODE === 'require') return true;
  return !/localhost|127\.0\.0\.1|::1/.test(connectionString);
}

function postgresPoolConfig(env = process.env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) return null;
  return {
    connectionString,
    max: resolvePoolLimit(env),
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    ssl: requiresSsl(connectionString, env) ? { rejectUnauthorized: true } : false,
  };
}

function getPostgresPool(env = process.env) {
  if (pool) return pool;
  const config = postgresPoolConfig(env);
  if (!config) throw new Error('DATABASE_URL manquant : aucun pool PostgreSQL configuré');
  pool = new Pool(config);
  // Un pool qui émet `error` sans écouteur tue le processus.
  pool.on('error', (error) => {
    console.error(`⚠️ Erreur inattendue du pool PostgreSQL : ${error.message}`);
  });
  return pool;
}

function hasPostgresConfig(env = process.env) {
  return Boolean(env.DATABASE_URL);
}

async function closePostgresPool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

/** Verrou consultatif applicatif sur le pool runtime. */
function withPostgresLock(lockName, task, options = {}) {
  return withPgAdvisoryLock(getPostgresPool(), lockName, task, options);
}

/**
 * Démarrage : vérifie que les migrations attendues sont appliquées.
 *
 * L'API ne crée plus de table à l'exécution. Si une table déclarée manque, le
 * message nomme la commande à lancer plutôt que de laisser une requête échouer
 * plus tard sur `relation does not exist`.
 */
async function assertPostgresSchemaReady(env = process.env) {
  const expected = schema.map((table) => table.name);
  const { rows } = await getPostgresPool(env).query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  const present = new Set(rows.map((row) => row.table_name));
  const missing = expected.filter((name) => !present.has(name));
  if (missing.length) {
    throw new Error(
      `Schéma PostgreSQL incomplet : ${missing.length} table(s) manquante(s) (${missing.slice(0, 5).join(', ')}` +
        `${missing.length > 5 ? ', …' : ''}). Appliquer les migrations : node db/migratePostgres.js`,
    );
  }
  return { tables: expected.length };
}

module.exports = {
  postgresPoolConfig,
  getPostgresPool,
  hasPostgresConfig,
  closePostgresPool,
  withPostgresLock,
  assertPostgresSchemaReady,
};
