// Vérifie le retrait des parcours VIP publics avec les composants et routes réels.
// Run: node tests/vipRetirement.browser.mjs
// Requires: npm dependencies and Playwright with Chromium installed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtimeRequire = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json'))
  : require;
const { chromium } = runtimeRequire('playwright');
const outputDir = '/tmp/cinehd-vip-retirement';
const work = await mkdtemp(path.join(tmpdir(), 'cinehd-vip-retirement-'));
await mkdir(outputDir, { recursive: true });

const entrySource = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import i18next from 'i18next';
import {I18nextProvider} from 'react-i18next';
import {LightModeProvider} from '@/context/LightModeContext';
import Header from '@/components/Header';
import {ROUTES} from '@/routing/registry';
import fr from '@/i18n/locales/fr.json';
import en from '@/i18n/locales/en.json';
await i18next.init({lng:'fr',resources:{fr:{translation:fr},en:{translation:en}}});
window.__setLanguage = (lang) => i18next.changeLanguage(lang);
window.__routePaths = ROUTES.map(route => route.path);
createRoot(document.getElementById('root')).render(
  <I18nextProvider i18n={i18next}>
    <BrowserRouter><LightModeProvider><Header/></LightModeProvider></BrowserRouter>
  </I18nextProvider>
);
`;
await writeFile(path.join(work, 'entry.tsx'), entrySource);

const mocks = {
  PrefetchLink: "export {Link as PrefetchLink} from 'react-router-dom';",
  ProfileContext: 'export const useProfile=()=>({currentProfile:null});',
  ProfileSwitcher: 'export default ()=>null;',
  NotificationsPopup: 'export default ()=>null;',
  apiNotificationService: 'export const getUnreadNotificationsCount=async()=>0; export const getNotificationsDisabled=async()=>false;',
  authUtils: "export const isUserVip=()=>localStorage.getItem('is_vip')==='true'; export const getVipHeaders=()=>({});",
  vipUtils: 'export const checkVipStatus=async()=>false;',
  VipModalContext: 'export const useVipModal=()=>({openVipModal:()=>{},closeVipModal:()=>{}});',
  SearchContext: 'export const useSearch=()=>({autocompleteSuggestions:[],loadingAutocomplete:false,fetchAutocompleteSuggestions:()=>{},clearAutocompleteSuggestions:()=>{}});',
  useAgeRestrictedContent: 'export const useAgeRestrictedContent=items=>({items});',
  useWrappedTracker: 'export const useWrappedTracker=()=>{};',
  accountAuth: 'export const broadcastAuthChange=()=>{}; export const clearStoredAuthSession=()=>{};',
};
await build({
  entryPoints: [path.join(work, 'entry.tsx')],
  outfile: path.join(work, 'entry.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  loader: { '.svg': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.mp3': 'dataurl' },
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') },
  define: {
    'import.meta.env': JSON.stringify({ VITE_MAIN_API: 'https://api.test', DEV: false, PROD: true }),
  },
  plugins: [{
    name: 'vip-ui-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/(pages|components)\// }, args => ({
        path: args.path,
        namespace: 'page-stub',
      }));
      builder.onLoad({ filter: /.*/, namespace: 'page-stub' }, () => ({
        contents: 'export default function PageStub(){return null;}',
        loader: 'jsx',
      }));
      builder.onResolve({ filter: /.*/ }, args => {
        const name = args.path.split('/').pop();
        return Object.hasOwn(mocks, name) ? { path: name, namespace: 'fixture' } : undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({
        contents: mocks[args.path],
        loader: 'jsx',
        resolveDir: repo,
      }));
    },
  }],
  logLevel: 'silent',
});

await writeFile(path.join(work, 'base.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;');
execFileSync('node', [
  path.join(repo, 'node_modules/tailwindcss/lib/cli.js'),
  '-c', path.join(repo, 'tailwind.config.js'),
  '-i', path.join(work, 'base.css'),
  '-o', path.join(work, 'ui.css'),
  '--content', 'src/components/Header.tsx,src/components/ProfileMenu.tsx,src/components/ui/*.tsx',
], { cwd: repo, stdio: 'ignore' });
await writeFile(path.join(work, 'index.html'), `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"></head>
<body style="margin:0;background:#000;color:#fff"><div id="root"></div><script type="module" src="/entry.js"></script></body></html>`);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH
    || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: JSON.parse(process.env.CHROMIUM_ARGS || '[]'),
});
const report = {
  command: 'node tests/vipRetirement.browser.mjs (uses /usr/bin/chromium when available)',
  prerequisites: ['npm dependencies', 'Playwright', 'Chromium'],
  testData: ['French and English UI', 'authenticated and guest profile menus', 'legacy is_vip absent/present'],
  expected: 'Public VIP routes, activation/purchase CTAs and VIP badges are absent; historical invoice routes remain.',
  results: [],
  captures: [],
  traces: [],
};
const failures = [];
let context;

try {
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tracePath = path.join(outputDir, 'vip-retirement.zip');
  await context.tracing.start({ screenshots: true, snapshots: true });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'vip-retirement.test') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    const file = path.join(work, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    try {
      await route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html', body: await readFile(file) });
    } catch {
      await route.fulfill({ status: 404, body: 'not found' });
    }
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('http://vip-retirement.test/');
  await page.waitForFunction(() => Array.isArray(window.__routePaths));
  const toggleProfileMenu = () => page.locator('header img').first().evaluate(image => {
    const trigger = image.closest('.cursor-pointer');
    if (!trigger) throw new Error('Profile menu trigger is missing');
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  for (const language of ['fr', 'en']) {
    await page.evaluate(lang => window.__setLanguage(lang), language);
    const paths = await page.evaluate(() => window.__routePaths);
    const publicVipPaths = paths.filter(path => ['/vip', '/vip/don', '/vip/cadeau/:giftToken'].includes(path));
    const invoicesRetained = ['/vip/invoices', '/vip/invoice/:publicId'].every(path => paths.includes(path));
    report.results.push({ language, publicVipPaths, invoicesRetained, menuText: '' });
    if (publicVipPaths.length) failures.push(`${language}: public VIP routes still registered: ${publicVipPaths.join(', ')}`);
    if (!invoicesRetained) failures.push(`${language}: historical invoice routes are missing`);

    await page.evaluate(() => {
      localStorage.removeItem('auth');
      localStorage.removeItem('discord_auth');
      localStorage.removeItem('bip39_auth');
      localStorage.removeItem('is_vip');
    });
    await toggleProfileMenu();
    const guestMenuText = await page.locator('header').innerText();
    report.results.at(-1).menuText = guestMenuText;
    if (/VIP|vip|I have a code|J'ai un code/i.test(guestMenuText)) {
      failures.push(`${language}: guest menu still exposes a VIP or access-code action`);
    }
    const screenshot = path.join(outputDir, `guest-${language}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    report.captures.push(screenshot);
    await toggleProfileMenu();

    await page.evaluate(() => {
      localStorage.setItem('auth', '{}');
      localStorage.setItem('discord_auth', 'true');
      localStorage.setItem('is_vip', 'true');
    });
    await page.reload();
    await page.waitForFunction(() => Array.isArray(window.__routePaths));
    await toggleProfileMenu();
    const memberMenuText = await page.locator('header').innerText();
    if (/VIP/i.test(memberMenuText)) failures.push(`${language}: legacy VIP status still displays in the profile menu`);
    await toggleProfileMenu();
  }
  if (pageErrors.length) failures.push(`browser errors: ${pageErrors.join('; ')}`);
  await context.tracing.stop({ path: tracePath });
  report.traces.push(tracePath);
  await context.close();
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  const tracePath = path.join(outputDir, 'vip-retirement.zip');
  try {
    if (context) await context.tracing.stop({ path: tracePath });
    if (existsSync(tracePath)) report.traces.push(tracePath);
  } catch {
    // Keep the failure report even if Chromium cannot finalize a trace.
  }
  await browser.close();
  report.results.push({ outcome: failures.length ? 'fail' : 'pass', failures });
  await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await rm(work, { recursive: true, force: true });
}

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
} else {
  console.log(`VIP retirement browser checks passed; report: ${path.join(outputDir, 'report.json')}`);
}
