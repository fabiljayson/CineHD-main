/**
 * Verrou consultatif PostgreSQL — pendant Neon de `withMysqlAdvisoryLock`.
 *
 * La bascule remplace `GET_LOCK(name, timeout)` de MySQL par un verrou
 * consultatif PostgreSQL. Les deux ont le même but (un seul bootstrap de schéma
 * ou une seule migration à la fois) mais pas les mêmes pièges :
 *
 * - Un verrou consultatif PostgreSQL est lié à **la session**. Il doit donc
 *   rester sur une connexion épinglée pendant toute la tâche : `pool.query()`
 *   peut rendre une autre connexion et perdre le verrou sans erreur.
 * - `pg_advisory_lock` attend indéfiniment. On sonde `pg_try_advisory_lock`
 *   jusqu'à l'échéance pour reproduire la sémantique de `GET_LOCK(…, timeout)`
 *   sans poser un `lock_timeout` global sur la session.
 * - La clé est un entier 64 bits signé, pas un nom. Elle est dérivée du nom par
 *   SHA-256 : la même chaîne donne la même clé sur tous les processus et tous
 *   les déploiements, sans table de correspondance à maintenir.
 *
 * Aucune dépendance au pilote : le pool est injecté et doit exposer
 * `connect()` rendant un client `pg` (`query`, `release`). C'est la convention
 * du service, et cela permet d'utiliser Neon, un Postgres local ou un pool
 * proxifié sans changer ce module.
 */

const { createHash } = require('node:crypto');

const DEFAULT_LOCK_TIMEOUT_SECONDS = 180;
const DEFAULT_POLL_INTERVAL_MS = 200;

/**
 * Clé 64 bits stable, rendue en chaîne décimale.
 *
 * Une chaîne (et non un BigInt) parce que le pilote sérialise les paramètres
 * textuels sans ambiguïté : la requête caste explicitement en `bigint`.
 */
function advisoryLockKey(lockName) {
  if (typeof lockName !== 'string' || lockName.length === 0) {
    throw new Error('advisoryLockKey requires a non-empty lock name');
  }
  const digest = createHash('sha256').update(lockName).digest();
  return digest.readBigInt64BE(0).toString();
}

function sleep(ms) {
  // Pas de `unref()` : l'appelant attend cette promesse. Un timer non référencé
  // laisse Node sortir dès que la boucle est vide, et l'attente du verrou
  // s'arrête alors sans erreur ni résultat.
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exécute `task(client)` en tenant un verrou consultatif PostgreSQL.
 *
 * Le client épinglé est transmis à la tâche : elle doit l'utiliser pour toutes
 * ses requêtes, sinon elle travaille hors du verrou.
 *
 * @param {{connect: () => Promise<any>}} pool
 * @param {string} lockName
 * @param {(client: any) => Promise<any>} task
 * @param {{timeoutSeconds?: number, pollIntervalMs?: number}} [options]
 */
async function withPgAdvisoryLock(pool, lockName, task, options = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('PostgreSQL pool not ready for advisory lock');
  }
  if (typeof task !== 'function') {
    throw new Error('withPgAdvisoryLock requires a task function');
  }

  const timeoutSeconds = Math.max(
    1,
    parseInt(options.timeoutSeconds || DEFAULT_LOCK_TIMEOUT_SECONDS, 10) || DEFAULT_LOCK_TIMEOUT_SECONDS,
  );
  const pollIntervalMs = Math.max(
    10,
    parseInt(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS, 10) || DEFAULT_POLL_INTERVAL_MS,
  );
  const key = advisoryLockKey(lockName);
  const deadline = Date.now() + timeoutSeconds * 1000;

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    for (;;) {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [key]);
      if (rows && rows[0] && rows[0].acquired === true) {
        lockAcquired = true;
        break;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timeout while waiting for PostgreSQL lock "${lockName}"`);
      }
      await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
    }

    return await task(client);
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1::bigint) AS released', [key]);
      } catch {
        // Une session perdue libère le verrou côté serveur : ce n'est pas une
        // fuite, seulement un avertissement pour la trace.
        console.warn('⚠️ Failed to release PostgreSQL advisory lock');
      }
    }
    // `release()` rend la connexion au pool même si la tâche a échoué : sans
    // cela, une erreur de migration épuiserait le budget de connexions (D3).
    try {
      client.release();
    } catch {
      console.warn('⚠️ Failed to release PostgreSQL client');
    }
  }
}

module.exports = {
  DEFAULT_LOCK_TIMEOUT_SECONDS,
  DEFAULT_POLL_INTERVAL_MS,
  advisoryLockKey,
  withPgAdvisoryLock,
};
