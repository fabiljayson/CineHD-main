/**
 * Requêtes dont le SQL diffère entre MySQL et PostgreSQL.
 *
 * Elles sont nommées ici plutôt que dupliquées dans les routes : une divergence
 * de comportement entre les deux moteurs doit être visible et testée, pas
 * dispersée dans des gabarits de chaînes.
 *
 * Les deux variantes gardent des `?` : l'adaptateur PostgreSQL les convertit en
 * `$n`.
 */

const POSTGRES = 'postgres';

/**
 * Dialecte effectif : PostgreSQL uniquement si `DB_DRIVER=postgres` **et**
 * `DATABASE_URL` renseigné ; sinon repli MySQL (localdev). Sans ce repli,
 * `findSessionByClientId` et `touchSessionIfStale` généreraient du SQL
 * PostgreSQL sur un pool MySQL.
 */
function dialectOf(env = process.env) {
  if (String(env.DB_DRIVER || 'mysql').toLowerCase() !== POSTGRES) return 'mysql';
  return env.DATABASE_URL ? POSTGRES : 'mysql';
}

/**
 * Retrouve la session d'un client à partir de `device.clientId`.
 *
 * MySQL sait tester la validité du JSON et extraire un champ (`JSON_VALID`,
 * `JSON_UNQUOTE`, `JSON_EXTRACT`). PostgreSQL 16 dispose de
 * `pg_input_is_valid` ; sans lui, un `device` non JSON ferait échouer la
 * requête au lieu de renvoyer NULL.
 */
function findSessionByClientId(sqlDialect = dialectOf()) {
  if (sqlDialect === POSTGRES) {
    return `SELECT id FROM user_sessions
             WHERE user_id = ? AND user_type = ?
               AND CASE WHEN device IS NOT NULL AND pg_input_is_valid(device, 'jsonb')
                        THEN device::jsonb ->> 'clientId' END = ?
             ORDER BY accessed_at DESC LIMIT 1`;
  }
  return "SELECT id FROM user_sessions WHERE user_id = ? AND user_type = ? AND CASE WHEN JSON_VALID(device) THEN JSON_UNQUOTE(JSON_EXTRACT(device, '$.clientId')) ELSE NULL END = ? ORDER BY accessed_at DESC LIMIT 1";
}

/**
 * Met à jour `accessed_at` seulement si la dernière trace est plus ancienne que
 * l'intervalle demandé : cette condition protège entre workers, en plus du
 * verrou Redis local.
 */
function touchSessionIfStale(sqlDialect = dialectOf()) {
  if (sqlDialect === POSTGRES) {
    return `UPDATE user_sessions SET accessed_at = NOW()
             WHERE id = ? AND user_id = ? AND user_type = ?
               AND (accessed_at IS NULL OR accessed_at <= NOW() - (? * INTERVAL '1 second'))`;
  }
  return `UPDATE user_sessions SET accessed_at = NOW()
         WHERE id = ? AND user_id = ? AND user_type = ?
         AND (accessed_at IS NULL OR accessed_at <= DATE_SUB(NOW(), INTERVAL ? SECOND))`;
}

module.exports = { dialectOf, findSessionByClientId, touchSessionIfStale };
