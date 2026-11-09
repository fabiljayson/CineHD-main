import { createHash } from 'node:crypto';

const INLINE_SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

function normalizeScriptOrigins(origins) {
  const entries = Array.isArray(origins) ? origins : [origins];
  const normalized = new Set();

  for (const entry of entries) {
    if (typeof entry !== 'string') continue;
    for (const candidate of entry.split(/[\s,]+/)) {
      if (!candidate) continue;
      try {
        const url = new URL(candidate);
        if (url.protocol === 'https:' && url.hostname) normalized.add(url.origin);
      } catch {
        // Ignore malformed values; a bad optional origin must not weaken CSP.
      }
    }
  }

  return [...normalized];
}

function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const match of String(html || '').matchAll(INLINE_SCRIPT_RE)) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    const digest = createHash('sha256').update(match[2], 'utf8').digest('base64');
    hashes.add(`'sha256-${digest}'`);
  }
  return [...hashes];
}

export function buildContentSecurityPolicy(html, configuredScriptOrigins = []) {
  const scriptSources = [
    "'self'",
    "'wasm-unsafe-eval'",
    'https://challenges.cloudflare.com',
    'https://www.gstatic.com',
    'https://www.googletagmanager.com',
    ...inlineScriptHashes(html),
    ...normalizeScriptOrigins(configuredScriptOrigins),
  ];

  return [
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    `script-src ${[...new Set(scriptSources)].join(' ')}`,
  ].join('; ');
}
