/**
 * Trusted client IP resolution.
 *
 * The rate limiters and audit trails must key on the REAL client IP, but the
 * `CF-Connecting-IP` and `X-Forwarded-For` headers are client-controlled as
 * soon as the origin is reachable directly (not only through Cloudflare).
 * Keying on those headers unconditionally lets any attacker rotate its "IP"
 * and bypass every per-IP limiter (login brute force included).
 *
 * Policy:
 *  - If TRUST_PROXY_HOPS is set (> 0), the deployment runs behind a known
 *    reverse proxy (Coolify/Traefik/nginx): Express `trust proxy` is set to
 *    that hop count and `req.ip` is authoritative.
 *  - Otherwise headers are only honoured when the TCP peer (the machine that
 *    actually opened the connection to the origin) belongs to Cloudflare's
 *    published IP ranges. A direct-to-origin connection always returns the
 *    socket address, whatever headers the client sends.
 *
 * Cloudflare ranges: https://www.cloudflare.com/ips/ (stable for years;
 * refresh them if Cloudflare announces new blocks).
 */

const CF_IPV4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

const CF_IPV6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/** Strip IPv4-mapped prefix and zone id: "::ffff:127.0.0.1" -> "127.0.0.1". */
function normalizeIp(value) {
  if (typeof value !== 'string') return null;
  let ip = value.trim();
  if (!ip) return null;
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.toLowerCase().startsWith('::ffff:')) ip = ip.slice(7);
  return ip || null;
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let int = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    int = int * 256 + n;
  }
  return int;
}

/** Expand an IPv6 string into its 16 bytes (null when malformed). */
function ipv6ToBytes(ip) {
  // Strip optional embedded IPv4 tail ("::ffff:7f00:1" handled upstream, but
  // "2001:db8::192.0.2.1" style still needs conversion).
  let head = ip;
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    head = `${ip.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const [left, right] = head.split('::');
  const leftGroups = left ? left.split(':') : [];
  const rightGroups = right !== undefined ? (right ? right.split(':') : []) : null;
  if (rightGroups === null && leftGroups.length !== 8) return null;
  if (leftGroups.length + rightGroups.length > 7) return null;
  const fill = rightGroups === null ? [] : new Array(8 - leftGroups.length - rightGroups.length).fill('0');
  const groups = [...leftGroups, ...fill, ...(rightGroups || [])];
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(groups[i])) return null;
    const g = parseInt(groups[i], 16);
    bytes[i * 2] = (g >> 8) & 0xff;
    bytes[i * 2 + 1] = g & 0xff;
  }
  return bytes;
}

function parseCidr(cidr) {
  const [base, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  if (base.includes(':')) {
    const bytes = ipv6ToBytes(base);
    return bytes ? { v6: true, bytes, prefix } : null;
  }
  const int = ipv4ToInt(base);
  return int === null ? null : { v6: false, int, prefix };
}

const CF_V4_RANGES = CF_IPV4.map(parseCidr).filter(Boolean);
const CF_V6_RANGES = CF_IPV6.map(parseCidr).filter(Boolean);

function matchRange(ip, ranges) {
  for (const range of ranges) {
    if (range.v6) {
      const bytes = ipv6ToBytes(ip);
      if (!bytes) continue;
      const fullBytes = range.prefix >> 3;
      const remBits = range.prefix & 7;
      let ok = true;
      for (let i = 0; i < fullBytes; i++) {
        if (bytes[i] !== range.bytes[i]) { ok = false; break; }
      }
      if (!ok) continue;
      if (remBits) {
        const mask = (0xff << (8 - remBits)) & 0xff;
        if ((bytes[fullBytes] & mask) !== (range.bytes[fullBytes] & mask)) continue;
      }
      return true;
    } else {
      const int = ipv4ToInt(ip);
      if (int === null) continue;
      const mask = range.prefix === 0 ? 0 : (0xffffffff << (32 - range.prefix)) >>> 0;
      if (((int & mask) >>> 0) === ((range.int & mask) >>> 0)) return true;
    }
  }
  return false;
}

function isCloudflarePeer(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  if (normalized.includes(':')) {
    return matchRange(normalized, CF_V6_RANGES);
  }
  return matchRange(normalized, CF_V4_RANGES);
}

/**
 * Express `trust proxy` predicate. Consulted on every request so operators can
 * switch modes via env without a code change:
 *   TRUST_PROXY_HOPS=n  -> trust n proxy hops (Coolify/Traefik/nginx setups)
 *   unset               -> trust only Cloudflare peers.
 */
function trustProxy(addr, hop) {
  const hops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (hops > 0) {
    return hop <= hops;
  }
  // Express passes symbolic addresses ("loopback", "uniquelocal"…) for the
  // first hop; never treat them as trusted proxies by default.
  if (typeof addr !== 'string') return false;
  return isCloudflarePeer(addr);
}

function firstValidIp(rawHeader) {
  if (typeof rawHeader !== 'string' || !rawHeader) return null;
  for (const candidate of rawHeader.split(',')) {
    const ip = normalizeIp(candidate);
    if (!ip) continue;
    if (ip.includes(':')) {
      if (ipv6ToBytes(ip)) return ip;
    } else if (ipv4ToInt(ip) !== null) {
      return ip;
    }
  }
  return null;
}

/**
 * Client IP to key rate limiters / audit logs on.
 * Spoof-proof: headers are only believed when the TCP peer is Cloudflare (or
 * TRUST_PROXY_HOPS mode is configured and Express resolved `req.ip`).
 */
function getTrustedClientIp(req) {
  if (!req || typeof req !== 'object') return null;

  if (Number(process.env.TRUST_PROXY_HOPS || 0) > 0) {
    return normalizeIp(req.ip) || normalizeIp(req.socket && req.socket.remoteAddress);
  }

  const peer = normalizeIp(req.socket && req.socket.remoteAddress);
  if (!isCloudflarePeer(peer)) {
    return peer;
  }

  return (
    firstValidIp(req.headers && req.headers['cf-connecting-ip']) ||
    firstValidIp(req.headers && req.headers['x-forwarded-for']) ||
    peer
  );
}

module.exports = {
  getTrustedClientIp,
  trustProxy,
  isCloudflarePeer,
};
