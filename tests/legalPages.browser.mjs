// Pages légales (Lot C, C1) : rendu réel des trois documents légaux en FR et EN.
//
// Ce qui se joue ici : les textes vivent dans i18n ; une clé renommée ou
// oubliée ne casse pas le build, elle s'affiche en clair dans la page
// (`termsOfServicePage.sections.…`). Le test monte les vraies pages (SEO,
// Helmet, pied de page compris), dans les deux langues, et vérifie les titres,
// le nombre de sections, les ajouts du Lot C et l'absence de clés brutes.
//
// Run: node tests/legalPages.browser.mjs
// Requires: `npm run build` (le CSS des captures vient de dist/assets),
//   les dépendances npm et Playwright avec Chromium installés.
// Optional: CHROMIUM_EXECUTABLE_PATH, CHROMIUM_ARGS (JSON array),
//   LEGAL_SHOTS_DIR (dossier des captures PNG, défaut /tmp/opencode/cinehd-c1-shots).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const runtimeRequire = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'package.json')) : require;
const { chromium } = runtimeRequire('playwright');

const shotsDir = process.env.LEGAL_SHOTS_DIR || '/tmp/opencode/cinehd-c1-shots';
const work = await mkdtemp(path.join(tmpdir(), 'cinehd-legal-'));
await mkdir(shotsDir, { recursive: true });

const entrySource = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { LightModeProvider } from '@/context/LightModeContext';
import i18n, { changeLanguage } from '@/i18n';
import LegalNotice from '@/pages/LegalNotice';
import TermsOfService from '@/pages/TermsOfService';
import Privacy from '@/pages/Privacy';
import Footer from '@/components/Footer';

const PAGES = { legal: LegalNotice, terms: TermsOfService, privacy: Privacy };
let setExternal = null;

function Harness() {
  const [name, setName] = useState('legal');
  setExternal = setName;
  const Page = PAGES[name];
  return (
    <HelmetProvider>
      <LightModeProvider>
        <MemoryRouter>
          <div id="legal-root">
            <Page />
            <Footer />
          </div>
        </MemoryRouter>
      </LightModeProvider>
    </HelmetProvider>
  );
}

(async () => {
  await changeLanguage('fr');
  createRoot(document.getElementById('root')).render(<Harness />);
  window.__setPage = (name) => { setExternal(name); };
  window.__setLang = async (lang) => {
    await changeLanguage(lang);
    if (lang === 'en') {
      const deadline = Date.now() + 5000;
      while (!i18n.hasResourceBundle('en', 'translation')) {
        if (Date.now() > deadline) throw new Error('EN bundle not loaded');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  };
  window.__ready = true;
})();
`;
await writeFile(path.join(work, 'entry.tsx'), entrySource);

await build({
  entryPoints: [path.join(work, 'entry.tsx')],
  outdir: work,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  nodePaths: [path.join(repo, 'node_modules')],
  alias: { '@': path.join(repo, 'src') },
  define: {
    'import.meta.env': JSON.stringify({
      VITE_SITE_URL: 'https://legal.test',
      DEV: false,
      PROD: true,
      MODE: 'test',
      BASE_URL: '/',
    }),
  },
  plugins: [{
    name: 'legal-page-stubs',
    setup(builder) {
      // PrefetchLink tire LightModeContext + l'arbre complet des routes : le
      // pied de page et les cartes légales n'ont besoin que d'un lien.
      builder.onResolve({ filter: /PrefetchLink$/ }, () => ({ path: 'prefetchlink', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: "export { Link as PrefetchLink } from 'react-router-dom';",
        loader: 'js',
        resolveDir: repo,
      }));
    },
  }],
  logLevel: 'silent',
});

const distAssets = path.join(repo, 'dist', 'assets');
const distCss = (await readdir(distAssets).catch(() => []))
  .filter((name) => name.endsWith('.css'))
  .map((name) => `/dist/assets/${name}`);
const workCss = (await readdir(work)).filter((name) => name.endsWith('.css'));
const cssLinks = [...distCss, ...workCss.map((name) => `/${name}`)]
  .map((href) => `<link rel="stylesheet" href="${href}">`)
  .join('');
assert.ok(distCss.length > 0, 'dist/assets contient le CSS de l app (lancer `npm run build` avant le test)');

await writeFile(path.join(work, 'index.html'), `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${cssLinks}
</head>
<body style="margin:0">
<div id="root"></div>
<script type="module" src="/entry.js"></script>
</body>
</html>`);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  args: JSON.parse(process.env.CHROMIUM_ARGS || '[]'),
});

const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'legal.test') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    // Le CSS du build vit dans dist/ du repo, pas dans le dossier de travail.
    const file = url.pathname.startsWith('/dist/')
      ? path.join(repo, url.pathname.slice(1))
      : path.join(work, name);
    try {
      const body = await readFile(file);
      const ext = path.extname(name);
      const contentType = ext === '.js' ? 'text/javascript'
        : ext === '.css' ? 'text/css'
        : ext === '.html' ? 'text/html'
        : 'application/octet-stream';
      await route.fulfill({ contentType, body });
    } catch {
      await route.fulfill({ status: 404, body: 'not found' });
    }
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('http://legal.test/');
  await page.waitForFunction(() => window.__ready === true);

  const cssState = await page.evaluate(() => {
    let rules = 0;
    for (const sheet of document.styleSheets) {
      try { rules += sheet.cssRules.length; } catch { /* feuille illisible */ }
    }
    return { sheets: document.styleSheets.length, rules };
  });
  assert.ok(cssState.rules > 100, `CSS du build effectivement chargé (${cssState.sheets} feuilles, ${cssState.rules} règles)`);

  const KEY_LEAK = /\b(?:legalNoticePage|termsOfServicePage|privacyPolicyPage)\./;

  const cases = [
    {
      lang: 'fr', page: 'legal', h1: 'Mentions légales', sections: 4,
      include: ['[[identité juridique', 'Éditeur du site', 'Hébergement', 'jasonfranckkenmognw@gmail.com', 'Mentions légales'],
      exclude: ['Vercel Analytics'],
      footerLink: { href: '/mentions-legales', text: 'Mentions légales' },
    },
    {
      lang: 'fr', page: 'terms', h1: "Conditions d'utilisation", sections: 10,
      include: ['Propriété intellectuelle et contenus protégés', 'Loi applicable, litiges et résiliation', 'droit français', 'contourner une mesure technique de protection'],
      exclude: [],
      footerLink: { href: '/mentions-legales', text: 'Mentions légales' },
    },
    {
      lang: 'fr', page: 'privacy', h1: 'Politique de confidentialité', sections: 7,
      include: ['movix_pending_auth_action', 'Google Analytics 4 ou Plausible', 'responsable du traitement'],
      exclude: ['Vercel Analytics'],
      footerLink: { href: '/mentions-legales', text: 'Mentions légales' },
    },
    {
      lang: 'en', page: 'legal', h1: 'Legal notice', sections: 4,
      include: ['[[legal identity of the publisher', 'Site publisher', 'Hosting'],
      exclude: ['Vercel Analytics'],
      footerLink: { href: '/mentions-legales', text: 'Legal notice' },
    },
    {
      lang: 'en', page: 'terms', h1: 'Terms of service', sections: 10,
      include: ['Intellectual property and protected content', 'Applicable law, disputes and termination', 'French law'],
      exclude: [],
      footerLink: { href: '/mentions-legales', text: 'Legal notice' },
    },
    {
      lang: 'en', page: 'privacy', h1: 'Privacy policy', sections: 7,
      include: ['movix_pending_auth_action', 'Google Analytics 4 or Plausible'],
      exclude: ['Vercel Analytics'],
      footerLink: { href: '/mentions-legales', text: 'Legal notice' },
    },
  ];

  for (const testCase of cases) {
    await page.evaluate(async ({ lang, name }) => {
      await window.__setLang(lang);
      window.__setPage(name);
    }, { lang: testCase.lang, name: testCase.page });
    await page.waitForFunction((expected) => {
      const h1 = document.querySelector('h1');
      return h1 && h1.textContent.trim() === expected;
    }, testCase.h1, { timeout: 5000 });

    const state = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        h1: document.querySelector('h1')?.textContent.trim(),
        sections: [...document.querySelectorAll('h2')].map((node) => node.textContent.trim()),
        text,
        footerLink: (() => {
          const anchor = document.querySelector('a[href="/mentions-legales"]');
          return anchor ? anchor.textContent.trim() : null;
        })(),
      };
    });

    assert.equal(state.h1, testCase.h1, `${testCase.lang}/${testCase.page}: titre H1`);
    assert.equal(state.sections.length, testCase.sections, `${testCase.lang}/${testCase.page}: nombre de sections (${state.sections.join(' | ')})`);
    assert.ok(!KEY_LEAK.test(state.text), `${testCase.lang}/${testCase.page}: aucune clé i18n brute dans le rendu`);
    for (const needle of testCase.include) {
      assert.ok(state.text.includes(needle), `${testCase.lang}/${testCase.page}: contient « ${needle} »`);
    }
    for (const needle of testCase.exclude) {
      assert.ok(!state.text.includes(needle), `${testCase.lang}/${testCase.page}: ne contient pas « ${needle} »`);
    }
    assert.equal(state.footerLink, testCase.footerLink.text, `${testCase.lang}/${testCase.page}: lien pied de page vers les mentions légales`);

    // Les sections sont animées en whileInView : sans un passage de scroll,
    // elles restent à opacity 0 et la capture sort vide. On scroll en mode
    // instant (le CSS du build active le smooth scroll, qui ferait passer les
    // sauts les uns par-dessus les autres), puis on exige que les N cartes
    // soient réellement visibles avant la capture.
    await page.evaluate(async () => {
      const step = 500;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo({ top: y, behavior: 'instant' });
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.waitForFunction((expected) => {
      const cards = [...document.querySelectorAll('h2')]
        .map((h2) => h2.closest('section'))
        .filter(Boolean);
      return cards.length === expected
        && cards.every((card) => Number.parseFloat(getComputedStyle(card).opacity) > 0.9);
    }, testCase.sections, { timeout: 5000 });

    const shot = path.join(shotsDir, `cinehd-c1-${testCase.lang}-${testCase.page}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    results.push(`${testCase.lang}/${testCase.page}: H1 ok, ${testCase.sections} sections, ${testCase.include.length} contenus présents, captures ${path.basename(shot)}`);
  }

  assert.deepEqual(pageErrors, [], `aucune erreur JS non interceptée (${pageErrors.join(' | ')})`);
  await context.close();
  console.log(JSON.stringify({ passed: results.length, results, shotsDir, pageErrors }, null, 2));
} finally {
  await browser.close();
  await rm(work, { recursive: true, force: true });
}
