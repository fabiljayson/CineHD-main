/**
 * Emplacements des données utilisateurs (`data/users`, `data/guests`).
 *
 * Un seul point de résolution, pour que `USER_DATA_DIR` s'applique partout de
 * la même façon. Les tests E2E s'en servent pour écrire leurs comptes de
 * secours dans un dossier temporaire : sans cela, une exécution interrompue
 * laisse des fichiers non suivis dans le dépôt.
 *
 * La valeur est lue à l'import, comme les autres réglages d'environnement du
 * service : un test doit donc la poser avant de requérir les routes.
 */

const path = require('path');

function resolveUserDataDir() {
  const configured = (process.env.USER_DATA_DIR || '').trim();
  if (!configured) return path.join(__dirname, '..', 'data');
  return path.resolve(configured);
}

const USER_DATA_DIR = resolveUserDataDir();
const GUESTS_DIR = path.join(USER_DATA_DIR, 'guests');
const USERS_DIR = path.join(USER_DATA_DIR, 'users');

module.exports = { USER_DATA_DIR, GUESTS_DIR, USERS_DIR };
