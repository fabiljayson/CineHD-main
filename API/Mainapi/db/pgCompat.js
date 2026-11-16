/**
 * Adaptateur PostgreSQL au contrat de `mysql2`.
 *
 * Les routes existantes attendent `const [rows] = await pool.execute(sql, params)`
 * et, pour une écriture, `result.affectedRows`. `pg` rend `{ rows, rowCount }` et
 * des paramètres `$n`. Cet adaptateur comble les deux écarts, sans promettre
 * une compatibilité qu'il n'a pas : il ne gère que les formes réellement
 * utilisées par les routes converties.
 */

const MYSQL_DIALECT = 'mysql';
const POSTGRES_DIALECT = 'postgres';

function isPostgresDialect(env = process.env) {
  return String(env.DB_DRIVER || MYSQL_DIALECT).toLowerCase() === POSTGRES_DIALECT;
}

/**
 * Remplace les `?` par `$1…$n` en ignorant les littéraux SQL.
 *
 * Un `?` dans une chaîne ('…?…') ou un identifiant cité ne doit pas devenir un
 * paramètre : sans ce parcours, une requête contenant une URL ou un `?` littéral
 * échouerait en production, et pas dans les tests.
 */
function toPgPlaceholders(sql) {
  let output = '';
  let index = 0;
  let quote = null;

  for (let position = 0; position < sql.length; position += 1) {
    const character = sql[position];

    if (quote) {
      output += character;
      if (character === quote) {
        if (sql[position + 1] === quote) {
          output += sql[position + 1];
          position += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      output += character;
      continue;
    }

    if (character === '?') {
      index += 1;
      output += `$${index}`;
      continue;
    }

    output += character;
  }

  return output;
}

// Erreurs de doublon : MySQL utilise un code texte, PostgreSQL un SQLSTATE.
const MYSQL_DUPLICATE_KEY = 'ER_DUP_ENTRY';
const MYSQL_DUPLICATE_KEY_ERRNO = 1062;
const POSTGRES_UNIQUE_VIOLATION = '23505';

function createRunner(queryable) {
  return async function run(sql, params = []) {
    const result = await queryable.query(toPgPlaceholders(sql), params);
    const command = result.command || '';
    // `INSERT … RETURNING` est un ordre d'écriture qui rend des lignes : sans
    // ce cas, l'identifiant généré serait perdu et la route relirait `null`.
    const returnsRows = command === 'SELECT' || command === 'SHOW' || /\breturning\b/i.test(sql);
    if (returnsRows) {
      return [result.rows, undefined];
    }
    // `insertId` n'est pas fourni : aucune route convertie ne l'utilise, et
    // inventer un identifiant serait pire que l'absence. Les routes qui en ont
    // besoin passent par `insertReturningId`.
    return [{ affectedRows: result.rowCount, rowCount: result.rowCount }, undefined];
  };
}

/**
 * Un doublon d'unicité, quel que soit le moteur.
 *
 * Les routes idempotentes (rejeu d'un webhook de paiement, demande revalidée
 * après un crash) en dépendent : ne tester que `ER_DUP_ENTRY` ferait passer un
 * rejeu pour une erreur serveur sur PostgreSQL, et l'idempotence disparaîtrait
 * silencieusement au changement de moteur.
 */
function isDuplicateKeyError(error) {
  if (!error) return false;
  return error.code === MYSQL_DUPLICATE_KEY
    || error.code === POSTGRES_UNIQUE_VIOLATION
    || Number(error.errno) === MYSQL_DUPLICATE_KEY_ERRNO;
}

/**
 * INSERT dont on veut l'identifiant généré, sur les deux moteurs.
 *
 * MySQL le rend dans `result.insertId` ; PostgreSQL exige `RETURNING`. Passer
 * par ici évite d'écrire un `RETURNING` que MySQL refuserait, et évite de lire
 * un `insertId` que l'adaptateur ne fournit pas.
 */
/**
 * Même chose, mais sous la forme `{ insertId }` que certains appelants lisent
 * directement. Explicite plutôt que magique : la valeur vient de `RETURNING`
 * sur PostgreSQL, de `insertId` sur MySQL.
 */
async function insertOne(executor, sql, params = [], options = {}) {
  const id = await insertReturningId(executor, sql, params, options);
  return { insertId: id };
}

async function insertReturningId(executor, sql, params = [], { idColumn = 'id' } = {}) {
  if (executor?.dialect === POSTGRES_DIALECT) {
    const [rows] = await executor.execute(`${sql}\nRETURNING ${idColumn}`, params);
    return rows[0]?.[idColumn];
  }
  const [result] = await executor.execute(sql, params);
  return result.insertId;
}

function createPostgresCompat(pool) {
  const run = createRunner(pool);

  return {
    dialect: POSTGRES_DIALECT,
    execute: run,
    query: run,
    /**
     * Même contrat que `pool.getConnection()` de mysql2 : les routes qui ont
     * besoin d'une transaction (DELETE puis INSERT atomiques) restent inchangées.
     */
    async getConnection() {
      const client = await pool.connect();
      const runOnClient = createRunner(client);
      return {
        dialect: POSTGRES_DIALECT,
        execute: runOnClient,
        query: runOnClient,
        beginTransaction: () => client.query('BEGIN'),
        commit: () => client.query('COMMIT'),
        rollback: () => client.query('ROLLBACK'),
        release: () => client.release(),
      };
    },
  };
}

module.exports = {
  isPostgresDialect,
  toPgPlaceholders,
  createPostgresCompat,
  insertReturningId,
  insertOne,
  isDuplicateKeyError,
};
