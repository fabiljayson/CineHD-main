/**
 * Prévol de la dépendance Streamed.
 *
 * `API/Mainapi/utils/streamedNative.js` résout
 * `streamed-pk-hls-stream-resolver/src/sources/goat/lock-worker.js` de façon
 * inconditionnelle. Quand le paquet n'est pas installé, le test échouait avec un
 * `MODULE_NOT_FOUND` au milieu de la résolution, sans indiquer quoi installer.
 *
 * Ce module donne l'échec à l'entrée du test, avec le chemin attendu et la
 * commande d'installation. Le paquet est vendu dans `API/Mainapi/vendor/` : il
 * n'y a rien à télécharger, seulement `npm ci` dans `API/Mainapi`.
 */

const { existsSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVICE_ROOT = path.join(REPO_ROOT, 'API', 'Mainapi');
const PACKAGE = 'streamed-pk-hls-stream-resolver';
const REQUIRED_FILE = 'src/sources/goat/lock-worker.js';

function buildMessage(detail) {
  return [
    `[streamed] Dépendance "${PACKAGE}" introuvable.`,
    `Attendu : API/Mainapi/node_modules/${PACKAGE}/${REQUIRED_FILE}`,
    'Le paquet est vendu (API/Mainapi/vendor/streamed-pk-hls-stream-resolver.tgz),',
    'il suffit d\'installer les dépendances du service :',
    '  cd API/Mainapi && npm ci',
    `Résolution : ${detail}`,
  ].join('\n');
}

/**
 * Vérifie que le resolver est installé et que le fichier chargé par la Main API
 * existe. Retourne son chemin. Lève une erreur explicite sinon.
 */
function requireStreamedResolver() {
  // Résolution depuis le service, pas depuis la racine du dépôt : c'est le
  // chemin que `streamedNative.js` suit réellement (node_modules du service).
  const serviceRequire = createRequire(path.join(SERVICE_ROOT, 'package.json'));

  let entry;
  try {
    entry = serviceRequire.resolve(`${PACKAGE}/${REQUIRED_FILE}`);
  } catch (error) {
    throw new Error(buildMessage(String(error.message || error).split('\n')[0]));
  }

  if (!existsSync(entry)) {
    throw new Error(buildMessage(`chemin résolu absent du disque : ${entry}`));
  }

  return entry;
}

module.exports = { requireStreamedResolver };
