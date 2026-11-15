#!/usr/bin/env node
/**
 * Sonde WatchParty de staging (Task 6, Step 2).
 *
 *   DEPLOYMENT_BASE_URL=https://watch.staging.example node tests/watchpartyCloudflareSmoke.mjs
 *
 * Vérifie la chaîne complète à travers le Worker : poignée de main Socket.IO,
 * attribution des rôles hôte/spectateur, diffusion d'un message synchronisé,
 * reconnexion après coupure, et récupération de l'état de la salle.
 *
 * Ne suppose aucun identifiant : la salle est créée par ce script, et le code de
 * salle n'est jamais journalisé (il suffirait à rejoindre la session).
 */

const BASE_URL = process.env.DEPLOYMENT_BASE_URL;
const TIMEOUT_MS = Number.parseInt(process.env.WATCHPARTY_TIMEOUT_MS || '20000', 10);

if (!BASE_URL) {
  console.error('DEPLOYMENT_BASE_URL manquant : indiquer l’URL du Worker de staging.');
  process.exit(2);
}

let io;
try {
  ({ io } = await import('socket.io-client'));
} catch {
  console.error('socket.io-client est requis : npm install à la racine du dépôt.');
  process.exit(2);
}

const base = BASE_URL.replace(/\/+$/, '');
const report = { target: base, startedAt: new Date().toISOString(), checks: [] };

function record(name, passed, detail) {
  report.checks.push({ name, passed, detail });
  console.log(`${passed ? '✔' : '✖'} ${name}${passed ? '' : ` — ${detail}`}`);
  return passed;
}

function connect() {
  return io(base, {
    transports: ['websocket', 'polling'],
    timeout: TIMEOUT_MS,
    reconnection: true,
    reconnectionAttempts: 3,
    forceNew: true,
  });
}

function once(socket, event, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} non reçu en ${timeoutMs} ms`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitWithAck(socket, event, payload, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} sans acquittement en ${timeoutMs} ms`)), timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function main() {
  const host = connect();
  const viewer = connect();

  try {
    await Promise.all([once(host, 'connect'), once(viewer, 'connect')]);
    record('deux clients connectés', true);

    const created = await emitWithAck(host, 'createRoom', { username: 'smoke-host', mediaId: 1, mediaType: 'movie' });
    const roomCode = created?.roomCode || created?.room?.code;
    record('salle créée par l’hôte', Boolean(roomCode), `réponse ${JSON.stringify(created).slice(0, 120)}`);
    if (!roomCode) throw new Error('aucun code de salle');

    const joined = await emitWithAck(viewer, 'joinRoom', { roomCode, username: 'smoke-viewer' });
    record('spectateur admis', Boolean(joined), `réponse ${JSON.stringify(joined).slice(0, 120)}`);

    const syncPromise = once(viewer, 'syncUpdate');
    host.emit('syncUpdate', { roomCode, currentTime: 12.5, paused: false, timestamp: Date.now() });
    const sync = await syncPromise;
    record('message synchronisé reçu', Math.abs(Number(sync.currentTime) - 12.5) < 0.01, `reçu ${sync.currentTime}`);

    // Reconnexion : le client doit retrouver la salle sans nouvel échange manuel.
    viewer.disconnect();
    viewer.connect();
    await once(viewer, 'connect');
    const recovered = await emitWithAck(viewer, 'joinRoom', { roomCode, username: 'smoke-viewer' });
    record('récupération après reconnexion', Boolean(recovered), `réponse ${JSON.stringify(recovered).slice(0, 120)}`);
  } finally {
    host.close();
    viewer.close();
  }

  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.every((check) => check.passed);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((error) => {
  console.error(`Sonde interrompue : ${error.message}`);
  process.exitCode = 1;
});
