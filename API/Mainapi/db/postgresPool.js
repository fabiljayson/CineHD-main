/**
 * Pool PostgreSQL pour la bascule vers Neon (branche feat/neon-postgres).
 *
 * Convention Neon :
 * - `DATABASE_URL` — URL agrégée (l'hôte contient `-pooler`) — utilisée par
 *   le runtime via `db/dialect.js` (`getPostgresPool`) ;
 * - `DATABASE_MIGRATION_URL` — URL directe — utilisée par `db/migratePostgres.js`
 *   et `scripts/migrateMysqlToPostgres.js` (le pooler n'agrège pas les sessions
 *   de migration).
 *
 * Contract attendu par `db/pgCompat` (adaptateur au contrat mysql2) :
 * `pool.query(sql, params) → Promise<{ rows, rowCount }>` — API standard de `pg`.
 *
 * Cold start Neon (règle 6 du plan de bascule) :
 * - `connectionTimeoutMillis` ≥ 10 s — le démarrage à froid du pooler peut
 *   prendre plusieurs secondes ;
 * - relance ONCE d'une requête en cas d'échec de connexion — le pool est
 *   déchiré puis la requête rejouée une seule fois. Les erreurs
 *   applicatives ne sont pas retentées.
 */

const { Pool } = require('pg');

let pool = null;

function isConnectionError(error) {
  if (!error) return false;
  if (typeof error.code === 'string' && error.code.startsWith('ECONN')) return true;
  if (typeof error.code === 'string' && error.code === 'ETIMEDOUT') return true;
  const message = String(error.message || '');
  return /terminated|terminating|timeout|connection closed|connection lost/i.test(message);
}

async function queryWithRetryOnce(text, values) {
  try {
    return await pool.query(text, values);
  } catch (error) {
    if (!isConnectionError(error)) throw error;
    try {
      await pool.waitReady();
    } catch {
      /* le nouveau client se connecte à la première requête */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    return pool.query(text, values); // retry once — aucune erreur applicative retentée
  }
}

function getPostgresPool() {
  if (pool) return pool;

  const url = process.env.DATABASE_URL;
  if (!url) return null; // dialect.js replie sur MySQL — pas de pool ici

  pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 10000,
    max: Number(process.env.DB_POOL_CONNECTION_LIMIT || 20),
    idleTimeoutMillis: 30000,
  });
  pool.query = queryWithRetryOnce;

  return pool;
}

module.exports = { getPostgresPool, isConnectionError };
