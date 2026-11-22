/**
 * MFA — TOTP (RFC 6238) via Node `crypto` (pas de dépendance).
 *
 * - generateTotpSecret() — secret pour un utilisateur (base32, stocké en
 *   account_credentials.mfa_secret)
 * - verifyTotp(secret, code, { window }) — vérifie un code (± window,
 *   défaut 1 — tolère le décalage horloge)
 * - generateBackupCodes(count) — codes de secours (non implémentés — voir note)
 * - normalizeTotpCode(code) — normalise un code saisi (espaces, séparateurs)
 */

const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  const output = [];
  for (let i = 0; i < buffer.length; i += 1) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output.push(BASE32_ALPHABET[(value >>> (bits - 5)) & 31]);
      bits -= 5;
    }
  }
  if (bits > 0) output.push(BASE32_ALPHABET[(value << (5 - bits)) & 31]);
  return output.join('');
}

function base32Decode(str) {
  const cleaned = String(str || '').toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of cleaned) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTotpSecret({ bytes = 20 } = {}) {
  return base32Encode(crypto.randomBytes(bytes));
}

function normalizeTotpCode(code) {
  return String(code || '').replace(/[^0-9]/g, '').slice(0, 6);
}

function verifyTotp(secret, code, { window = 1, timestamp = Date.now() } = {}) {
  if (typeof secret !== 'string' || !secret || typeof code !== 'string') return false;
  const key = base32Decode(secret);
  if (key.length === 0) return false;
  const normalized = normalizeTotpCode(code);
  if (normalized.length !== 6) return false;
  const counter = Math.floor(timestamp / 1000 / 30);
  for (let offset = -window; offset <= window; offset += 1) {
    const counterBytes = Buffer.alloc(8);
    counterBytes.writeBigUInt64BE(BigInt(counter + offset));
    const digest = crypto.createHmac('sha1', key).update(counterBytes).digest();
    const offsetBits = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offsetBits] << 24) | (digest[offsetBits + 1] << 16)
      | (digest[offsetBits + 2] << 8) | digest[offsetBits + 3]) >>> 0;
    const codeNum = binary % 1000000;
    const expected = String(codeNum).padStart(6, '0');
    if (crypto.timingSafeEqual(Buffer.from(normalized), Buffer.from(expected))) return true;
  }
  return false;
}

function generateBackupCodes(count = 8) {
  const codes = [];
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    let code;
    do {
      const raw = crypto.randomBytes(4).toString('hex').slice(0, 5);
      code = `${raw.slice(0, 2)}-${raw.slice(2)}`;
    } while (seen.has(code));
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

module.exports = {
  base32Encode, base32Decode,
  generateTotpSecret, verifyTotp, generateBackupCodes, normalizeTotpCode,
};
