/**
 * Sonde de disponibilité de la Main API.
 *
 * `/health` répond pour le processus, `/ready` répond pour ses dépendances.
 * Un orchestrateur (Cloudflare Containers, Docker, Kubernetes) a besoin des
 * deux : la première pour distinguer « démarre encore » de « mort », la seconde
 * pour ne pas router de trafic vers une instance qui ne peut pas servir.
 *
 * Le module décide seulement *si* l'instance est prête. Il ne compose aucun
 * message : les erreurs des pilotes contiennent des hôtes, des ports et parfois
 * des identifiants, et rien de tout cela ne doit sortir dans un corps de sonde.
 */

const READINESS_PROBE_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.READINESS_PROBE_TIMEOUT_MS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
})();

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} readiness timeout`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Le pool est résolu à l'appel : `mysqlPool` est initialisé par le bootstrap,
// et le charger ici en haut ferait un cycle avec app.js.
async function checkMysqlReadiness() {
  const { getPool } = require('../db/dialect');
  const pool = getPool();
  if (!pool) throw new Error('mysql pool unavailable');
  // Une requête triviale, pas `pool.getConnection()` : ce dernier garderait une
  // connexion du pool pour la sonde elle-même.
  await withTimeout(pool.query('SELECT 1'), READINESS_PROBE_TIMEOUT_MS, 'mysql');
}

async function checkRedisReadiness() {
  const { redis } = require('../config/redis');
  if (!redis) throw new Error('redis client unavailable');
  await withTimeout(redis.ping(), READINESS_PROBE_TIMEOUT_MS, 'redis');
}

/**
 * Résout quand MySQL et Redis répondent, rejette sinon. Le premier échec suffit :
 * une instance sans l'une ou l'autre de ces dépendances ne doit pas recevoir de
 * trafic.
 */
async function checkReadiness() {
  await Promise.all([checkMysqlReadiness(), checkRedisReadiness()]);
}

module.exports = { checkReadiness, READINESS_PROBE_TIMEOUT_MS };
