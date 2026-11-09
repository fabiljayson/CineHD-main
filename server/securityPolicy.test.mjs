import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildContentSecurityPolicy } from './securityPolicy.js';

// Browser E2E does not currently exercise headers from the Hono production
// server. Keep the two CSP failure modes with a small compiled-HTML fixture:
// missing inline hashes break boot scripts; unsafe or malformed origins weaken
// the script allowlist.
test('allows existing inline scripts by hash without enabling inline execution or eval', () => {
  const script = '\nwindow.cinehdBoot = true;\n';
  const digest = createHash('sha256').update(script, 'utf8').digest('base64');
  const policy = buildContentSecurityPolicy(`<script>${script}</script>`);

  assert.ok(policy.includes(`'sha256-${digest}'`));
  assert.ok(policy.includes("'self'"));
  assert.ok(policy.includes("'wasm-unsafe-eval'"));
  assert.ok(!policy.includes("'unsafe-inline'"));
  assert.ok(!policy.includes("'unsafe-eval'"));
});

test('accepts configured HTTPS script origins but strips paths and rejects other schemes', () => {
  const policy = buildContentSecurityPolicy('', [
    'https://ads.example.test/player.js?campaign=1',
    'http://insecure.example.test/script.js',
    'javascript:alert(1)',
    'not a URL',
  ]);

  assert.ok(policy.includes('https://ads.example.test'));
  assert.ok(!policy.includes('player.js'));
  assert.ok(!policy.includes('insecure.example.test'));
  assert.ok(!policy.includes('javascript:'));
});
