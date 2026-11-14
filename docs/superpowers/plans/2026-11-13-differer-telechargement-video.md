# Report du téléchargement vidéo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les téléchargements de films et séries par une notification localisée « Bientôt disponible » / “Coming soon”, sans possibilité de lancer l’ancien flux par une URL directe.

**Architecture:** Les boutons de détail utilisent une notification Sonner et ne naviguent plus vers `/download`. La route vidéo historique est retirée du registre afin qu’un ancien lien ne puisse plus monter `DownloadPage` ni déclencher ses appels API. Le composant reste non monté pour une réactivation ultérieure ; aucun autre type de téléchargement n’est modifié.

**Tech Stack:** React 18, TypeScript, React Router, Sonner, i18next FR/EN, Vite, Playwright.

**Spec:** [docs/superpowers/specs/2026-11-13-retirer-vip-et-differer-telechargement-video.md](../specs/2026-11-13-retirer-vip-et-differer-telechargement-video.md)

## Global Constraints

- Au clic sur Télécharger d’un film ou d’une série, afficher la notification FR/EN, sans téléchargement ni navigation vers `/download`.
- Une ancienne URL `/download/movie/:id` ou `/download/tv/:id` ne doit pas monter l’ancien flux de téléchargement.
- Ne pas modifier le téléchargement d’images, l’application mobile, les sous-titres ou les autres fonctions de téléchargement distinctes.
- Préserver les changements préexistants de `src/routing/registry.tsx` et ne pas ouvrir de panneau navigateur ni lancer de serveur de développement.
- Ne jamais inclure les changements préexistants dans un commit ; utiliser une mise en staging par hunks pour `registry.tsx` et pour les fichiers partagés avec le plan de retrait VIP.
- Utiliser les versions et scripts déclarés dans le manifeste actuel ; ne pas ajouter de dépendance pour ce changement.

## Review Focus

- **Clic film en français ou en anglais :** affiche le message dans la langue active et ne change pas l’URL. Vérifié par l’E2E navigateur.
- **Clic série en français ou en anglais :** même comportement, sans dépendre de l’identifiant de la série. Vérifié par l’E2E navigateur.
- **Ancien lien de téléchargement de film ou de série :** n’exécute pas le composant ou les appels API de téléchargement. Vérifié par l’E2E navigateur.
- **Ancienne donnée locale VIP :** ne réactive pas le bouton ou le flux de téléchargement. Vérifié par l’E2E navigateur.
- **Téléchargements d’images et sous-titres :** restent inchangés. Vérifier par revue que le diff se limite aux boutons et à la route vidéo.

---

### Task 1: Remplacer les boutons et fermer les liens directs vidéo

**Files:**
- Modify: `src/pages/MovieDetails.tsx`
- Modify: `src/pages/TVDetails.tsx`
- Modify: `src/routing/registry.tsx`
- Modify: `src/i18n/locales/fr.json`
- Modify: `src/i18n/locales/en.json`
- Create: `tests/videoDownloadDeferred.browser.mjs`

**Interfaces:**
- Produces: clé i18n `download.comingSoon` dans les bundles FR et EN.
- Les boutons utilisent `toast.info(t('download.comingSoon'))` sans `navigate()` vers `/download`.
- Consumes: le harnais Playwright isolé de `tests/legalPages.browser.mjs`; aucun serveur de développement.

- [ ] **Step 1: Écrire l’E2E navigateur qui échoue**

  Dans `tests/videoDownloadDeferred.browser.mjs`, exercer les boutons Télécharger d’un film et d’une série en FR puis EN. Vérifier le texte exact de la notification, l’absence de changement d’URL et l’absence de requête à un endpoint de téléchargement. Naviguer aussi directement vers `/download/movie/123` et `/download/tv/456` et vérifier que `DownloadPage` ne se monte pas et qu’aucun endpoint de téléchargement n’est appelé. Répéter avec `localStorage.is_vip = "true"` pour interdire tout ancien contournement. Écrire sous `/tmp/cinehd-video-download-deferred/` un rapport JSON contenant la commande, les prérequis, les données de test, les résultats attendus/observés et les chemins des captures/traces.

- [ ] **Step 2: Vérifier l’échec avant l’implémentation**

  Run: `node tests/videoDownloadDeferred.browser.mjs`.
  Expected: le test échoue car les boutons naviguent encore et les URL directes montent le flux vidéo.

- [ ] **Step 3: Implémenter le comportement différé**

  Dans `MovieDetails.tsx` et `TVDetails.tsx`, remplacer uniquement l’action de navigation vidéo par `toast.info(t('download.comingSoon'))`. Ajouter les valeurs FR/EN de `download.comingSoon`. Supprimer uniquement l’entrée `/download/:type/:id` du registre ; conserver le fichier `DownloadPage.tsx` non monté afin de pouvoir réintroduire le flux plus tard. Préserver les changements existants de `registry.tsx`.

- [ ] **Step 4: Rejouer l’E2E et vérifier le build**

  Run: `node tests/videoDownloadDeferred.browser.mjs && npm run build`.
  Expected: les quatre parcours FR/EN passent, les anciennes URLs ne déclenchent aucun appel vidéo et le build Vite réussit ; le rapport et les captures/traces sont présents sous le dossier prévu. Confirmer par le diff que seuls les boutons et la route vidéo ont changé, sans toucher aux autres téléchargements.

- [ ] **Step 5: Commit**

  Committer uniquement les hunks de cette tâche ; `src/routing/registry.tsx` a déjà des modifications non liées, et les bundles de traduction peuvent contenir des changements du plan VIP.

## Handoff

Ce plan est autonome par rapport au retrait VIP. Il peut être exécuté séparément, sans supprimer le code source du flux historique ni toucher aux téléchargements d’images, à l’application mobile ou aux sous-titres.
