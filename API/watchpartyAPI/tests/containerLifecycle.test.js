/**
 * Cycle de vie du conteneur WatchParty.
 *
 * Démarre le vrai `watchparty.js` et vérifie ce qu'un orchestrateur observe :
 *
 *   - `PORT` pilote l'écoute et prime sur `WATCHPARTY_PORT` ;
 *   - `/health` répond dès que le processus sert du HTTP ;
 *   - `/ready` ne répond 200 qu'une fois les rooms restaurées et l'écoute ouverte ;
 *   - les rooms sont restaurées depuis `cache/watchparty-rooms.json` au démarrage
 *     puis re-sauvegardées au SIGTERM (le contrat de persistance retenu par
 *     l'inventaire : un instantané à l'arrêt propre, pas une durabilité continue) ;
 *   - SIGTERM sort en code 0.
 *
 * Ce qui échappe volontairement à ce test : la reconnexion Socket.IO, la
 * continuité des rooms pendant le remplacement d'une instance et la reprise
 * après un arrêt non propre. Ils exigent le scénario staging de la Task 6, et
 * l'instantané disque ne suffit pas à les couvrir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOMS_FILE = path.join(SERVICE_DIR, 'cache', 'watchparty-rooms.json');
const SHUTDOWN_TIMEOUT_MS = 20000;

const ROOM_FIXTURE = [{
  id: 'container-lifecycle-room',
  code: 'LIFEC01',
  media: { title: 'Fixture', poster: '', mediaType: 'movie' },
  participants: [],
  hostId: null,
  coHosts: [],
  maxParticipants: 10,
  isPublic: true,
  syncMode: 'classic',
  createdAt: Date.now(),
}];

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

// Vrai si une connexion TCP aboutit. Sert à prouver que `WATCHPARTY_PORT` n'a
// pas été écouté alors que `PORT` l'était.
function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const settle = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1500, () => settle(false));
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
  });
}

test('container lifecycle: PORT wins, rooms restored and re-snapshotted, clean SIGTERM', { timeout: 60000 }, async (t) => {
  let originalRooms;
  try {
    originalRooms = await fsp.readFile(ROOMS_FILE, 'utf8');
  } catch {
    originalRooms = undefined;
  }
  await fsp.mkdir(path.dirname(ROOMS_FILE), { recursive: true });
  await fsp.writeFile(ROOMS_FILE, JSON.stringify(ROOM_FIXTURE, null, 2), 'utf8');

  t.after(async () => {
    // Le service supprime le fichier au démarrage : on remet l'état du dépôt.
    if (originalRooms === undefined) await fsp.rm(ROOMS_FILE, { force: true });
    else await fsp.writeFile(ROOMS_FILE, originalRooms, 'utf8');
  });

  const port = await reservePort();
  const unusedPort = await reservePort();

  const child = spawn(process.execPath, ['watchparty.js'], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      WATCHPARTY_PORT: String(unusedPort),
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

  // 1. `PORT` est le port d'écoute, et il prime sur `WATCHPARTY_PORT`.
  const health = await waitForResponse(port, '/health');
  assert.equal(health.status, 200, 'GET /health must answer 200 on PORT');
  assert.deepEqual(JSON.parse(health.body), { status: 'ok' });
  assert.equal(
    await canConnect(unusedPort),
    false,
    'WATCHPARTY_PORT must not be listened to when PORT is set',
  );

  // 2. Readiness et restauration des rooms.
  const ready = await waitForResponse(port, '/ready');
  assert.equal(ready.status, 200, 'GET /ready must answer 200 once rooms are restored');
  assert.deepEqual(JSON.parse(ready.body), { status: 'ready' });

  const publicRooms = await httpGet(port, '/api/watchparty/public');
  assert.equal(publicRooms.status, 200);
  const listed = JSON.parse(publicRooms.body).rooms.map((room) => room.id);
  assert.deepEqual(listed, ['container-lifecycle-room'], 'the room snapshot must be restored at startup');

  // Le contrat de démarrage consomme l'instantané : le fichier disparaît.
  await assert.rejects(
    fsp.access(ROOMS_FILE),
    'the restored snapshot must be consumed, not re-read on every start',
  );

  // 3. SIGTERM : sortie propre et nouvel instantané des rooms.
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

  const snapshot = JSON.parse(await fsp.readFile(ROOMS_FILE, 'utf8'));
  assert.deepEqual(
    snapshot.map((room) => room.id),
    ['container-lifecycle-room'],
    'a graceful shutdown must persist the live rooms',
  );
});
