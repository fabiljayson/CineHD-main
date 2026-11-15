/**
 * Cycle de vie du conteneur Main API.
 *
 * Ce test démarre le vrai `server.js` avec des dépendances volontairement
 * injoignables (MySQL et Redis sur un port fermé) et vérifie le comportement que
 * l'orchestrateur observe :
 *
 *   - `PORT` est bien le port d'écoute (et non le 25565 codé en dur) ;
 *   - `/health` répond 200 alors même que MySQL et Redis ne répondent pas, donc
 *     un bootstrap long ne fait pas tuer l'instance ;
 *   - `/ready` répond 503 dans cette même situation, pour que le Worker ne
 *     route pas de trafic vers cette instance ;
 *   - aucun corps de sonde ne révèle une dépendance, un hôte ou un identifiant ;
 *   - SIGTERM arrête proprement l'instance (code 0) au lieu de la tuer.
 *
 * Ce qui échappe volontairement à ce test : le cluster complet à 12 workers, un
 * bootstrap MySQL réussi, la reconnexion Redis. Ils demandent MySQL et Redis
 * réels : eux relèvent du scénario staging (Task 6).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const SERVICE_DIR = path.join(__dirname, '..');
const SHUTDOWN_TIMEOUT_MS = 20000;

// Port 1 sur la boucle locale : connexion refusée immédiatement, sans dépendre
// de l'état des conteneurs MySQL/Redis du poste de développement.
const UNREACHABLE_DEPENDENCIES = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '1',
  DB_USER: 'cinehd',
  DB_PASSWORD: 'cinehd',
  DB_NAME: 'cinehd',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '1',
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function httpGet(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: pathname, timeout: 4000 },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body }));
      },
    );
    request.on('timeout', () => request.destroy(new Error(`${pathname} timed out`)));
    request.on('error', reject);
  });
}

async function waitForResponse(port, pathname, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await httpGet(port, pathname);
    } catch (error) {
      lastError = error;
      await delay(200);
    }
  }
  throw lastError || new Error(`${pathname} never answered on port ${port}`);
}

test('container lifecycle: liveness without dependencies, 503 readiness, clean SIGTERM', { timeout: 60000 }, async (t) => {
  const port = await reservePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      ...UNREACHABLE_DEPENDENCIES,
      PORT: String(port),
      // Un seul worker : le test ne doit pas démarrer un cluster non borné.
      NUM_WORKERS: '1',
      WORKER_RECYCLE_INTERVAL_MS: '0',
      MEMORY_LOG_INTERVAL_MS: '600000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));

  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal, output: output.join('') }));
  });

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });

  // 1. `PORT` pilote l'écoute : la réponse arrive sur le port réservé.
  const health = await waitForResponse(port, '/health');
  assert.equal(health.status, 200, 'GET /health must answer 200 on the configured PORT');
  assert.deepEqual(JSON.parse(health.body), { status: 'ok' });

  // 2. La liveness ne dépend pas des dépendances, et ne les divulgue pas.
  assert.doesNotMatch(
    health.body,
    /mysql|redis|database|password|127\.0\.0\.1/i,
    'liveness body must not disclose dependencies or configuration',
  );

  // 3. La readiness échoue quand MySQL et Redis sont injoignables.
  const ready = await waitForResponse(port, '/ready');
  assert.equal(ready.status, 503, 'GET /ready must answer 503 while dependencies are unreachable');
  assert.deepEqual(JSON.parse(ready.body), { status: 'not-ready' });
  assert.doesNotMatch(
    ready.body,
    /mysql|redis|ECONNREFUSED|password|127\.0\.0\.1/i,
    'readiness body must not disclose the failing dependency or its error',
  );

  // 4. SIGTERM arrête le processus proprement, avant le délai d'arrêt forcé.
  assert.equal(child.exitCode, null, 'the instance must still be running before SIGTERM');
  child.kill('SIGTERM');

  const result = await Promise.race([
    exited,
    delay(SHUTDOWN_TIMEOUT_MS).then(() => ({ code: 'timeout', signal: null, output: output.join('') })),
  ]);

  assert.equal(
    result.code,
    0,
    `SIGTERM must exit cleanly, got code=${result.code} signal=${result.signal}\n${result.output.slice(-4000)}`,
  );
});
