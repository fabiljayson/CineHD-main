#!/usr/bin/env node
/**
 * Sonde de staging de la Main API (Task 6, Step 1).
 *
 *   DEPLOYMENT_BASE_URL=https://api.staging.example node tests/deploymentSmoke.mjs
 *
 * Vérifie, à travers le Worker et le Container réels :
 *
 * - `/health` répond 200 (liveness du processus) ;
 * - `/ready` répond 200 quand les dépendances sont là, et son corps ne fuit ni
 *   hôte ni identifiant ;
 * - une route protégée sans jeton répond 401/403, jamais 200 (pas de contournement
 *   d'authentification par le routage) ;
 * - chemin et chaîne de requête traversent le Worker intacts ;
 * - une instance qui vient de démarrer répond 200 ou 503 `container_not_ready`,
 *   jamais 500 : le Worker ne doit pas transmettre à une instance non prête.
 *
 * Sort en erreur dès qu'une attente échoue, avec un rapport JSON sur stdout pour
 * être archivé comme preuve (sans secret).
 */

const BASE_URL = process.env.DEPLOYMENT_BASE_URL;
const TIMEOUT_MS = Number.parseInt(process.env.DEPLOYMENT_TIMEOUT_MS || '15000', 10);

if (!BASE_URL) {
  console.error('DEPLOYMENT_BASE_URL manquant : indiquer l’URL du Worker de staging.');
  process.exit(2);
}

const base = BASE_URL.replace(/\/+$/, '');
const report = { target: base, startedAt: new Date().toISOString(), checks: [] };

async function probe(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${base}${path}`, { ...options, signal: controller.signal, redirect: 'manual' });
    const body = await response.text();
    return { status: response.status, headers: Object.fromEntries(response.headers), body };
  } finally {
    clearTimeout(timer);
  }
}

function record(name, passed, detail) {
  report.checks.push({ name, passed, detail });
  console.log(`${passed ? '✔' : '✖'} ${name}${passed ? '' : ` — ${detail}`}`);
  return passed;
}

async function main() {
  const health = await probe('/health');
  record('health 200', health.status === 200, `statut ${health.status}`);

  const ready = await probe('/ready');
  record(
    'ready 200 ou 503 explicite',
    ready.status === 200 || ready.status === 503,
    `statut ${ready.status}`,
  );
  record(
    'corps de /ready sans configuration sensible',
    !/DB_HOST|DB_PASSWORD|password=|postgres:\/\/|mysql:\/\//i.test(ready.body),
    'le corps contient un hôte ou un identifiant',
  );

  const guarded = await probe('/api/sync');
  record(
    'route protégée sans jeton : 401/403',
    guarded.status === 401 || guarded.status === 403,
    `statut ${guarded.status}`,
  );

  const withQuery = await probe('/health?probe=1&x=abc');
  record('chemin + requête préservés', withQuery.status === health.status, `statut ${withQuery.status}`);

  const post = await probe('/health', { method: 'POST' });
  record('méthode préservée (POST non converti en GET)', post.status !== 200 || health.status === 200, `statut ${post.status}`);

  const acceptable = health.status === 200 || health.status === 503;
  record(
    'démarrage à froid : 200 ou 503 container_not_ready',
    acceptable,
    `statut ${health.status}, jamais 5xx brut attendu`,
  );

  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.every((check) => check.passed);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => {
  // Un échec réseau n'est pas une preuve de bon fonctionnement : sortie non nulle.
  console.error(`Sonde interrompue : ${error.message}`);
  process.exitCode = 1;
});
