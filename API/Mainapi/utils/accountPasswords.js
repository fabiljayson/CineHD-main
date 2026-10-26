/**
 * Mots de passe des comptes admin / staff.
 *
 * bcrypt n'est pas une dépendance du projet : on utilise `crypto.scrypt`
 * (bibliothèque standard de Node), qui est un KDF résistant (RFC 7914) et
 * suffisant pour des mots de passe de gestionnaire.
 *
 * Le sel et les paramètres sont encodés dans la chaîne stockée pour rester
 * rétro-compatibles si l'on remonte le coût plus tard :
 *
 *   scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
 *
 * Seul `account_credentials.password_hash` est renseigné ; `code_hash` reste
 * le canal de connexion des abonnés.
 */

const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32 });
const MAX_LENGTH = 128; // doit coller avec la colonne VARCHAR(128)

function formatHash(params, salt, derived) {
  return [
    'scrypt',
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Hash un mot de passe en clair. Retourne la chaîne complète à stocker.
 * @param {string} password
 * @returns {Promise<string>}
 */
async function hashAccountPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Mot de passe vide');
  }
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  const encoded = formatHash(SCRYPT_PARAMS, salt, derived);
  if (encoded.length > MAX_LENGTH) {
    throw new Error('Hash de mot de passe trop long pour la colonne');
  }
  return encoded;
}

/**
 * Vérifie un mot de passe contre un hash stocké.
 * Compare en temps constant ; renvoie false sur tout format invalide.
 * @param {string} password
 * @param {string|null|undefined} stored
 * @returns {Promise<boolean>}
 */
async function verifyAccountPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Garde-fou : refuse un hash corrompu / malveillant qui demanderait une mémoire démesurée.
  const memoryNeeded = 128 * N * r;
  if (memoryNeeded > 512 * 1024 * 1024) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived;
  try {
    derived = await scryptAsync(password, salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashAccountPassword, verifyAccountPassword };
