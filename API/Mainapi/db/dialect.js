/**
 * Couche de dialecte SQL — MySQL aujourd'hui, PostgreSQL pour Neon.
 *
 * Le plan de bascule impose de garder l'API sur MySQL tant que tous les
 * consommateurs ne sont pas convertis. Cette couche permet donc de choisir le
 * moteur par `DB_DRIVER=postgres` sans réécrire les routes : le pool rendu
 * expose la même forme que `mysql2` (`execute`/`query` renvoyant `[rows]`,
 * `affectedRows`), et les rares requêtes non portables viennent de `coreSql.js`.
 *
 * Rien ici ne devine une configuration : sans `DB_DRIVER=postgres`, le
 * comportement est exactement celui d'avant. Avec `DB_DRIVER=postgres` mais
 * sans `DATABASE_URL` (coupure de la prod), le runtime replie sur MySQL :
 * « utiliser les deux » — prod quand elle est traversée, localdev quand elle
 * est coupée. Voir `isPostgres` et `db/coreSql#dialectOf`.
 */

const { isPostgresDialect, toPgPlaceholders, createPostgresCompat } = require('./pgCompat');

let cachedAdapter = null;
let cachedAdapterPool = null;

/**
 * Dialecte effectif du runtime : `DB_DRIVER=postgres` **et** `DATABASE_URL`
 * renseigné → PostgreSQL (Neon, base de prod). Sans `DATABASE_URL` (coupure
 * de la prod), le runtime replie sur MySQL : `mysqlPool.js` — la base MySQL
 * localdev via les `DB_*` de `.env`. « Utiliser les deux » : la prod quand
 * elle est traversée, le localdev quand elle est coupée.
 *
 * Le SQL effectif suit la même règle : `db/coreSql.js#dialectOf`.
 */
function isPostgres(env = process.env) {
  return isPostgresDialect(env) && Boolean(env.DATABASE_URL);
}

/** Pool du moteur sélectionné, avec l'API de `mysql2`. */
function getPool() {
  if (!isPostgres()) {
    const { getPool: getMysqlPool } = require('../mysqlPool');
    return getMysqlPool();
  }

  const { getPostgresPool } = require('../postgresPool');
  const pool = getPostgresPool();
  if (cachedAdapterPool !== pool) {
    cachedAdapter = createPostgresCompat(pool);
    cachedAdapterPool = pool;
  }
  return cachedAdapter;
}

/** Verrou consultatif du moteur sélectionné, même signature que MySQL. */
function withAdvisoryLock(lockName, task, options = {}) {
  if (isPostgres()) {
    const { getPostgresPool } = require('../postgresPool');
    const { withPgAdvisoryLock } = require('../utils/pgAdvisoryLock');
    return withPgAdvisoryLock(getPostgresPool(), lockName, task, options);
  }

  const { getPool: getMysqlPool, withMysqlAdvisoryLock } = require('../mysqlPool');
  const pool = getMysqlPool();
  if (!pool) throw new Error('MySQL pool not ready for advisory lock');
  return withMysqlAdvisoryLock(pool, lockName, task, options);
}

module.exports = { getPool, isPostgres, withAdvisoryLock, toPgPlaceholders };
