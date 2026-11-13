# Lot C3 — Bannière de consentement aux cookies

Date : 2026-11-13 · Branche : `main` · Validation : navigateur réel (Chromium
headless piloté en CDP), pas seulement statique.

## Changement

- **`src/utils/cookieConsent.ts`** (nouveau) : lecture/écriture du choix unique
  `cookieConsent` = `accepted` | `declined` en `localStorage` (`null` = aucune
  décision). Réutilise `readLocalStorage` / `writeLocalStorage` (mode privé
  toléré).
- **`src/utils/analytics.ts`** : `initAnalytics()` refuse de charger un
  fournisseur tant que le consentement n'est pas `accepted`. Le refus et
  l'absence de réponse se valent : aucun script tiers (GA/Plausible) n'est
  injecté. L'opt-out local et le Do Not Track existants restent respectés par
  dessus.
- **`src/components/CookieConsentBanner.tsx`** (nouveau) : bannière non modale
  en bas d'écran (`role="region"` + `aria-label`), clés i18n déjà présentes
  (`cookieConsent.*`, FR/EN), lien « En savoir plus » → `/privacy`, boutons
  Refuser / Accepter. « Accepter » écrit le choix **puis** rappelle
  `initAnalytics()` (idempotente : `main.tsx` a déjà tenté au chargement).
- **`src/App.tsx`** : montage à côté de `<DnsBlockBanner />`, donc visible sur
  toutes les routes.

Choix unique par appareil : pas de fenêtre de re-consentement, pas de réglage
supplémentaire (décision validée pour ce lot).

## Prérepts et commandes de relance

```bash
# 1. Serveur de dev, avec un ID GA factice pour rendre le blocage observable
cd /path/to/projet
VITE_ANALYTICS_PROVIDER=ga VITE_GA_MEASUREMENT_ID=G-TEST123 npm run dev   # port 3000

# 2. Chromium headless + CDP (profil jetable)
chromium --headless --remote-debugging-port=9222 \
  --user-data-dir=/tmp/opencode/chrome-profile --no-first-run \
  --disable-gpu --window-size=1280,900 about:blank &

# 3. Pilote CDP sans dépendance (client WebSocket natif de Node) : /tmp/opencode/cdp.mjs
#    commandes : goto <url> | eval "<js>" | click "<selecteur>" | shot <png>
node /tmp/opencode/cdp.mjs goto "http://localhost:3000/"
node /tmp/opencode/cdp.mjs eval "localStorage.getItem('cookieConsent')"
node /tmp/opencode/cdp.mjs shot /tmp/opencode/c3-banner.png
```

## Scénarios exécutés (résultats observés)

| # | Étape | Attendu | Observé |
| --- | --- | --- | --- |
| 1 | Profil vierge, `/` | bannière visible, aucun script analytics | ✅ `regions: ["Cookies & Recommendations"]`, `gaScript: false`, `started: false`, `consent: null` |
| 2 | Clic **Decline** | choix mémorisé, bannière masquée, toujours aucun script | ✅ `consent: "declined"`, `regions: []`, `gaScript: false`, `started: false` |
| 3 | Rechargement après refus | pas de bannière, toujours aucun script | ✅ `banniereVisible: false`, `gaScript: false` |
| 4 | `localStorage.removeItem('cookieConsent')` + rechargement | bannière de retour | ✅ `["Cookies & Recommendations"]` |
| 5 | Clic **Accept** | script GA injecté avec l'ID de test | ✅ `consent: "accepted"`, `gaScript: true`, `src: ...gtag/js?id=G-TEST123`, `started: true`, `dataLayer: 5` |
| 6 | Navigation sur `/movies` (sans consentement) | bannière présente partout, aucun script | ✅ bannière visible, `gaAvantConsent: false` |
| 7 | Console client | aucune nouvelle erreur | ✅ 2 erreurs = 2 `TMDB 404` préexistantes (aucune autre) |
| 8 | Capture d'écran | bannière lisible en bas d'écran | ✅ `/tmp/opencode/c3-banner.png` (regénérable avec les commandes ci-dessus) |

## Contrôles statiques associés

| Contrôle | Commande | Résultat |
| --- | --- | --- |
| Types | `npx tsc --noEmit` | ✅ 0 erreur |
| Lint (fichiers neufs + `App.tsx`/`main.tsx`) | `npx eslint src/utils/cookieConsent.ts src/utils/analytics.ts src/components/CookieConsentBanner.tsx src/App.tsx src/main.tsx` | ✅ 0 problème sur les fichiers neufs, 0 sur les lignes ajoutées (`App.tsx` conserve ses erreurs préexistantes) |
| Tests racine | `npm test` | ✅ 374/374 |
| Build | `npm run build` | ✅ exit 0 |

## Observations hors périmètre

- Le popup « We've moved to WhatsApp » existant s'affiche au-dessus de la
  page (composant déjà présent, sans lien avec ce lot).
- `src/context/AdWarningContext.tsx` expose un contexte monté mais sans
  composant consommateur — la même maladie que les clés `cookieConsent` orphelines.
  Non traité ici (hors périmètre C3).
