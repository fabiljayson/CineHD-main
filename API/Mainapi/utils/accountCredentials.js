/**
 * Codes de compte CineHD (paiement mobile money → validation admin → code).
 *
 * Le code remplace le mot de passe : il est généré côté serveur à la
 * validation d'une demande, transmis à l'admin par l'interface, puis tapé par
 * l'acheteur sur /login. On ne stocke que son empreinte (sha256 hex) dans
 * `account_credentials.code_hash` — jamais le code en clair.
 *
 * Le code a une forte entropie (31^15 ≈ 8e21 combinaisons) : une empreinte
 * non salée reste sûre ici, avec l'avantage d'être indexée (recherche directe
 * par code au lieu d'un scan de toutes les empreintes).
 */

const crypto = require('crypto');

// Alphabet sans ambiguïté : ni 0/O, ni 1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_GROUP_LENGTH = 5;
const CODE_GROUP_COUNT = 3;
const CODE_PREFIX = 'CINE';

/** Normalise une saisie humaine : casse haute, tirets/espaces ignorés. */
function normalizeAccountCode(raw) {
  return String(raw || '').normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Emppreinte hexa de 64 caractères d'un code normalisé. */
function hashAccountCode(normalizedCode) {
  return crypto.createHash('sha256').update(String(normalizedCode), 'utf8').digest('hex');
}

function randomCodeGroup(length = CODE_GROUP_LENGTH) {
  const max = CODE_ALPHABET.length;
  let out = '';
  // randomInt est fourni par Node : pas de biais de modulo observable.
  while (out.length < length) {
    out += CODE_ALPHABET[crypto.randomInt(0, max)];
  }
  return out;
}

/** Génère un code lisible : CINE-XXXXX-XXXXX-XXXXX */
function generateAccountCode() {
  const groups = Array.from({ length: CODE_GROUP_COUNT }, () => randomCodeGroup());
  return `${CODE_PREFIX}-${groups.join('-')}`;
}

/** Identifiant de compte bip39-like : 16 hex caractères (même format que BIP39). */
function generateAccountUserId() {
  return crypto.randomBytes(8).toString('hex');
}

module.exports = {
  normalizeAccountCode,
  hashAccountCode,
  generateAccountCode,
  generateAccountUserId,
};
