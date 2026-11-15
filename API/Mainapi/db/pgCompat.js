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

function createPostgresCompat(pool) {
  async function run(sql, params = []) {
    const result = await pool.query(toPgPlaceholders(sql), params);
    const command = result.command || '';
    if (command === 'SELECT' || command === 'SHOW') {
      return [result.rows, undefined];
    }
    // `insertId` n'est pas fourni : aucune route convertie ne l'utilise, et
    // inventer un identifiant serait pire que l'absence.
    return [{ affectedRows: result.rowCount, rowCount: result.rowCount }, undefined];
  }

  return {
    execute: run,
    query: run,
  };
}

module.exports = { isPostgresDialect, toPgPlaceholders, createPostgresCompat };
