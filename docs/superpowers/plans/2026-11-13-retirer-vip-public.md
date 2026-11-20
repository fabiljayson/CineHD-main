# Retrait du VIP public — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirer l’offre VIP de l’expérience publique, rendre ses avantages fonctionnels accessibles à tous et préserver les opérations historiques explicitement conservées.

**Architecture:** Fermer les nouvelles actions VIP aux frontières API, annuler les factures-cadeaux non finalisées, et préserver le suivi des factures personnelles déjà ouvertes, les callbacks et l’administration. Supprimer ensuite les écrans, promotions et contrôles d’accès VIP du frontend, sans retirer les protections indépendantes du statut. Mettre à jour les textes juridiques uniquement après présentation et approbation de leur formulation exacte.

**Tech Stack:** React 18, TypeScript, Vite, i18next FR/EN, Express 4 en CommonJS, MySQL, Node.js `node:test`, Playwright.

**Spec:** [docs/superpowers/specs/2026-11-13-retirer-vip-et-differer-telechargement-video.md](../specs/2026-11-13-retirer-vip-et-differer-telechargement-video.md)

## Global Constraints

- Tous les avantages fonctionnels actuellement réservés au VIP deviennent accessibles à tous ; les exigences d’authentification, limites anti-abus, restrictions d’âge et prérequis techniques sans rapport restent en place.
- Les nouvelles créations d’achat/demande et toutes les réclamations de cadeaux VIP sont refusées côté API.
- Toutes les factures-cadeaux non finalisées (`awaiting_payment`, `partial_payment`, `confirming` ou `expired`) sont annulées, leurs enregistrements et événements restent consultables, et les paiements tardifs ne doivent pas les livrer.
- L’annulation est interne à CineHD : aucune API de révocation fournisseur n’est présente. Un ancien lien hébergé ou une adresse déjà affichée peut encore accepter un paiement externe ; les moyens de paiement ne sont plus renvoyés par CineHD, les paiements tardifs ne sont pas livrés et nécessitent un suivi manuel admin.
- Les factures personnelles déjà ouvertes restent consultables et traitables normalement ; leurs callbacks et les outils d’administration restent actifs.
- Ne supprimer ni tables, clés, historiques ni données existantes ; ne pas retirer les écrans et opérations internes d’administration.
- Garder les marqueurs historiques en stockage si nécessaire, mais ils ne doivent plus autoriser un avantage ni afficher un statut VIP dans l’expérience publique.
- Retirer les popups publicitaires de lecture pour tous ; ne pas modifier les publicités sans lien avec cette décision.
- « Viper » désigne un fournisseur vidéo et ne doit pas être supprimé ou renommé.
- Ne pas inventer d’identité légale complète, d’adresse postale, de numéro d’immatriculation ou d’informations d’hébergeur. « TeamWork » est le nom commercial et `jasonfranckkenmognw@gmail.com` le contact existant ; les autres champs restent à confirmer.
- Présenter les formulations juridiques exactes et attendre leur approbation avant de modifier les traductions.
- Préserver les changements déjà présents, notamment dans `src/App.tsx` et `src/routing/registry.tsx`, ainsi que les autres changements non liés.
- Ne jamais inclure les changements préexistants dans un commit ; utiliser une mise en staging par hunks pour ces fichiers et pour les fichiers partagés avec l’autre plan.
- Travailler sur `main`, sans nouveau worktree ou branche.

## Review Focus

- **Ancienne clé ou `is_vip` encore présent dans le stockage local :** ne débloque aucune fonction et n’accorde aucun badge public. Vérifier les mêmes parcours avec et sans cette donnée dans l’E2E frontend.
- **Utilisateur sans VIP sur une fonction auparavant réservée :** l’accès devient gratuit, mais les protections d’authentification, d’âge, de configuration et d’abus restent effectives. Vérifier les routes API concernées dans leurs tests ciblés.
- **Facture personnelle déjà ouverte :** consultation, vérification, paiement/callback et historique continuent de fonctionner. Vérifier les routes publiques et callbacks dans le test API.
- **Facture-cadeau non finalisée, y compris partiellement payée ou en confirmation :** elle devient annulée, reste dans l’historique administratif et ne peut pas être payée ou réclamée. Vérifier l’idempotence, chaque statut et le callback tardif dans le test API.
- **Données VIP archivées ou parcours d’administration :** aucune donnée n’est supprimée et les utilisateurs non-admin ne gagnent aucun accès admin. Vérifier les opérations conservées dans le test API existant et le test de retrait.

---

### Task 1: Fermer les nouvelles actions VIP et préserver les factures historiques

**Files:**
- Modify: `API/Mainapi/routes/vipDonations.js`
- Modify: `API/Mainapi/routes/vipPaymentRequests.js`
- Modify: `API/Mainapi/utils/vipDonations.js`
- Modify: `API/Mainapi/app.js`
- Modify: `API/Mainapi/routes/__tests__/vipPaymentRequests.test.js`
- Create: `API/Mainapi/routes/__tests__/vipDonationsRetirement.test.js`

**Interfaces:**
- Produces: `cancelUnfinishedGiftInvoices(pool)` dans `utils/vipDonations.js`, idempotente et appelée avant que le worker API accepte des requêtes.
- Les réponses de refus des actions publiques utilisent HTTP `410` et `{ success: false, code: 'VIP_DISABLED' }`.

- [ ] **Step 1: Écrire les tests API qui échouent**

  Dans `vipPaymentRequests.test.js`, vérifier que `POST /vip-payments` renvoie `410` sans créer de demande, que `GET /vip-payments/mine` conserve l’historique, et que les opérations d’administration existantes restent disponibles.

  Dans `vipDonationsRetirement.test.js`, vérifier que `POST /vip/invoices` et les deux routes de réclamation de cadeau renvoient `410`; que les factures personnelles restent consultables et vérifiables; que les factures-cadeaux dans chacun des quatre statuts non finalisés deviennent `cancelled` sans supprimer leur dossier; que leurs réponses publiques ne contiennent plus d’adresse, de QR code ni d’URL de paiement; qu’une seconde exécution ne crée pas de nouveaux événements; et qu’un callback tardif ne livre pas une facture annulée. Les factures payées/livrées et les factures personnelles ne sont pas modifiées.

- [ ] **Step 2: Vérifier l’échec des tests avant l’implémentation**

  Run: `node --test routes/__tests__/vipPaymentRequests.test.js routes/__tests__/vipDonationsRetirement.test.js` depuis `API/Mainapi/`.
  Expected: les nouvelles assertions échouent avec les routes publiques encore actives et sans annulation systématique des factures-cadeaux.

- [ ] **Step 3: Implémenter le retrait API**

  Refuser la création de factures et de demandes de paiement ainsi que la lecture/réclamation des cadeaux. Conserver la consultation des anciennes factures, la vérification et le traitement des factures personnelles ouvertes, les historiques et toutes les routes admin. Ajouter `cancelUnfinishedGiftInvoices(pool)` avec événement d’audit par facture et garde atomique sur les statuts ; l’appeler depuis le chemin de préparation déjà utilisé par `appReady` avant l’écoute HTTP. Pour les factures-cadeaux annulées, retirer les champs adresse, QR code, checkout et suivi des réponses publiques. Les paiements déjà reçus ou envoyés à un ancien lien restent dans l’historique et nécessitent un suivi manuel admin ; ne pas inventer un mécanisme de remboursement. Les liens fournisseurs/adresses déjà connus ne peuvent pas être révoqués par CineHD.

- [ ] **Step 4: Rejouer les tests ciblés**

  Run: `node --test routes/__tests__/vipPaymentRequests.test.js routes/__tests__/vipDonationsRetirement.test.js` depuis `API/Mainapi/`.
  Expected: PASS ; les actions publiques sont bloquées, les factures personnelles poursuivent leur traitement, les cadeaux non finalisés sont annulés une seule fois et l’administration conserve les dossiers.

- [ ] **Step 5: Commit**

  ```bash
  git add API/Mainapi/routes/vipDonations.js API/Mainapi/routes/vipPaymentRequests.js API/Mainapi/utils/vipDonations.js API/Mainapi/app.js API/Mainapi/routes/__tests__/vipPaymentRequests.test.js API/Mainapi/routes/__tests__/vipDonationsRetirement.test.js
  git commit -m "feat: retire les actions VIP publiques"
  ```

### Task 2: Rendre gratuits les accès et quotas précédemment réservés

**Files:**
- Modify: `API/Mainapi/routes/debrid.js`
- Modify: `API/Mainapi/routes/mediaExtract.js`
- Modify: `API/Mainapi/liveTvRoutes.js`
- Modify: `API/Mainapi/utils/streamedNativeRoutes.js`
- Modify: `API/Mainapi/routes/purstream.js`
- Modify: `API/Mainapi/routes/kisskh.js`
- Modify: `API/Mainapi/routes/animeSama.js`
- Modify: `API/Mainapi/routes/swiftflow.js`
- Modify: `API/Mainapi/linkSubmissionsRoutes.js`
- Modify: `API/Mainapi/commentsRoutes.js`
- Modify: `API/Mainapi/utils/embedExtraction.js`
- Modify: `API/Mainapi/utils/axiosHelpers.js`
- Modify: `API/Mainapi/wishboardRoutes.js`
- Modify: `API/Mainapi/routes/__tests__/liveTvProxyAccess.test.js`
- Modify: `API/Mainapi/routes/__tests__/streamedNativeRoutes.test.js`
- Create: `API/Mainapi/routes/__tests__/vipPerksFree.test.js`
- Create: `API/Mainapi/routes/__tests__/publicVipMarkers.test.js`

**Interfaces:**
- Consumes: `cancelUnfinishedGiftInvoices(pool)` and the public API policy from Task 1.
- Preserves: existing authentication, media signing/internal-key checks, rate limits, age restrictions and server configuration requirements.

- [ ] **Step 1: Écrire les tests ciblés qui échouent**

  Vérifier qu’une requête sans clé VIP peut utiliser les endpoints d’extraction et les sources autrefois réservés lorsqu’elle satisfait leurs autres prérequis ; qu’une mauvaise configuration interne reste refusée; que les routes IPTV précédemment VIP ne refusent plus uniquement à cause du statut; que les autres contrôles anti-abus restent actifs; que le quota Wishboard est identique pour un compte avec ou sans ancien statut VIP, à la valeur de l’ancien niveau VIP (3 demandes par 48 h); et que les nouvelles soumissions ne reçoivent plus de priorité VIP. Dans `publicVipMarkers.test.js`, vérifier que les nouveaux commentaires ne produisent plus de marqueur VIP dans les sorties publiques/notifications tandis que les marqueurs historiques restent consultables par l’administration.

- [ ] **Step 2: Vérifier l’échec des tests avant l’implémentation**

  Run: `node --test routes/__tests__/liveTvProxyAccess.test.js routes/__tests__/streamedNativeRoutes.test.js routes/__tests__/vipPerksFree.test.js routes/__tests__/publicVipMarkers.test.js` depuis `API/Mainapi/`.
  Expected: les nouvelles assertions d’accès sans VIP et de quota égal échouent ; les assertions de sécurité/configuration existantes passent.

- [ ] **Step 3: Retirer uniquement les restrictions fondées sur le VIP**

  Retirer `requireVip`/la branche de filtrage VIP des fonctions concernées, uniformiser à 3 le quota Wishboard et supprimer la priorité publique fondée sur le statut. Garder les contrôles d’authentification, limites de débit, signature des médias, clé interne, contrôles d’âge, allowlists et filtres de sécurité. Garder les données et distinctions VIP strictement nécessaires aux écrans admin/historiques.

- [ ] **Step 4: Rejouer les tests API ciblés**

  Run: `node --test routes/__tests__/liveTvProxyAccess.test.js routes/__tests__/streamedNativeRoutes.test.js routes/__tests__/vipPerksFree.test.js routes/__tests__/publicVipMarkers.test.js` depuis `API/Mainapi/`.
  Expected: PASS ; l’accès n’est plus conditionné par une clé VIP, tandis que les refus non liés au VIP restent vérifiés.

- [ ] **Step 5: Commit**

  ```bash
  git add API/Mainapi/routes/debrid.js API/Mainapi/routes/mediaExtract.js API/Mainapi/liveTvRoutes.js API/Mainapi/utils/streamedNativeRoutes.js API/Mainapi/routes/purstream.js API/Mainapi/routes/kisskh.js API/Mainapi/routes/animeSama.js API/Mainapi/routes/swiftflow.js API/Mainapi/linkSubmissionsRoutes.js API/Mainapi/commentsRoutes.js API/Mainapi/utils/embedExtraction.js API/Mainapi/utils/axiosHelpers.js API/Mainapi/wishboardRoutes.js API/Mainapi/routes/__tests__/liveTvProxyAccess.test.js API/Mainapi/routes/__tests__/streamedNativeRoutes.test.js API/Mainapi/routes/__tests__/vipPerksFree.test.js API/Mainapi/routes/__tests__/publicVipMarkers.test.js
  git commit -m "feat: ouvre les avantages VIP à tous"
  ```

### Task 3: Retirer l’offre VIP de l’expérience publique

**Files:**
- Modify: `src/routing/registry.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/components/ProfileMenu.tsx`
- Modify: `src/pages/Profile.tsx`
- Modify: `src/components/AccessCodeForm.tsx`
- Modify: `src/context/VipModalContext.tsx`
- Modify: `src/components/VipModal.tsx`
- Modify: `src/context/AdFreePopupContext.tsx`
- Modify: `src/components/AdFreePlayerAds.tsx`
- Modify: `src/pages/FranceTV/FranceTVBrowse.tsx`
- Modify: `src/pages/FranceTV/FranceTVInfo.tsx`
- Modify: `src/pages/FranceTV/FranceTVPlayer.tsx`
- Modify: `src/pages/DebridPage.tsx`
- Modify: `src/pages/Watch/WatchMovie.tsx`
- Modify: `src/pages/Watch/WatchTv.tsx`
- Modify: `src/components/LiveTVPlayer.tsx`
- Modify: `src/components/HLSPlayer.tsx`
- Modify: `src/components/CommentsSection.tsx`
- Modify: `src/components/StreamingLinksManager.tsx`
- Modify: `src/pages/SharedListPage.tsx`
- Modify: `src/pages/SharedListsCatalogPage.tsx`
- Modify: `src/components/SwiftfluxGate.tsx`
- Modify: `src/context/AuthContext.tsx`
- Modify: `src/context/ProfileContext.tsx`
- Modify: `src/utils/session.ts`
- Modify: `src/pages/Greenlight/WishboardNewRequest.tsx`
- Modify: `src/pages/Greenlight/SubmitLinkPage.tsx`
- Modify: `src/pages/WatchPartyCreate.tsx`
- Modify: `src/pages/VipInvoicePage.tsx`
- Modify: `src/pages/VipInvoicesPage.tsx`
- Modify: `src/pages/WhatIsMovixPage.tsx`
- Modify: `src/pages/CostsPage.tsx`
- Modify: `src/pages/help/VipHelpPage.tsx`
- Modify: `src/pages/help/tutoRegistry.tsx`
- Modify: `src/utils/authUtils.ts`
- Modify: `src/utils/vipUtils.ts`
- Modify: `src/services/streamedService.ts`
- Modify: `src/services/debridService.ts`
- Modify: `src/services/kisskhService.ts`
- Modify: `src/services/swiftfluxService.ts`
- Modify: `src/utils/serverResolveRequest.ts`
- Modify: `src/i18n/locales/fr.json`
- Modify: `src/i18n/locales/en.json`
- Create: `tests/vipRetirement.browser.mjs`

**Interfaces:**
- Consumes: public routes and entitlement behavior from Tasks 1–2.
- Preserves: the two-language translation system, authentication/profile behavior for real accounts, admin screens/labels, and provider “Viper”.

- [ ] **Step 1: Écrire l’E2E navigateur qui échoue**

  Dans `tests/vipRetirement.browser.mjs`, utiliser le harnais Playwright isolé existant pour vérifier en FR et EN que `/vip` et `/vip/don` ne présentent plus l’offre, qu’aucun lien public d’achat/activation ou badge VIP n’apparaît, que les fonctions auparavant conditionnées par VIP sont proposées sans ancien statut local, et qu’aucune popup publicitaire de lecture n’apparaît pour aucun statut. Écrire sous `/tmp/cinehd-vip-retirement/` un rapport JSON contenant la commande, les prérequis, les données de test, les résultats attendus/observés et les chemins des captures/traces ; ne pas ouvrir de panneau navigateur ni lancer de serveur de développement.

- [ ] **Step 2: Vérifier l’échec avant l’implémentation**

  Run: `node tests/vipRetirement.browser.mjs`.
  Expected: l’E2E échoue sur au moins les routes/promotions encore présentes ou l’accès encore conditionné ; il enregistre les résultats et captures dans le dossier prévu.

- [ ] **Step 3: Retirer les parcours, badges et gates publics**

  Retirer les routes promotionnelles et de cadeaux ainsi que les entrées de navigation, formulaire d’activation, modale, tutoriel et textes de promotion. Garder `/vip/invoices` et `/vip/invoice/:publicId` uniquement pour consulter les factures historiques ; permettre le règlement d’une facture personnelle encore ouverte et afficher les factures-cadeaux annulées en lecture seule, sans moyens de paiement. Retirer les badges publics (y compris les anciens badges dans les commentaires), tout en gardant les données et libellés admin. Supprimer toute dépendance de l’accès aux fonctions gratuites sur `is_vip`/`access_code`; retirer les popups d’annonce de lecture pour tous. Préserver les changements préexistants dans `App.tsx` et `registry.tsx`, en particulier les protections robots/noindex.

- [ ] **Step 4: Vérifier les traductions et l’E2E**

  Run: `node tests/vipRetirement.browser.mjs`.
  Expected: PASS en français et anglais ; rapport, traces/captures et données de test sont produits sans secrets. Les libellés admin historiques restent présents et aucun nom de fournisseur « Viper » n’a été supprimé.

- [ ] **Step 5: Commit**

  Committer uniquement les changements de cette tâche. `src/App.tsx` et `src/routing/registry.tsx` ont déjà des modifications non liées ; utiliser un staging par hunks et exclure les changements préexistants.

### Task 4: Appliquer les textes juridiques après validation

**Files:**
- Modify: `src/i18n/locales/fr.json`
- Modify: `src/i18n/locales/en.json`
- Modify: `tests/legalPages.browser.mjs`

**Interfaces:**
- Consumes: existing French/English legal-page translation keys.
- Produces: legal notice, terms and privacy text matching the features and records actually retained.

- [ ] **Step 1: Présenter les textes exacts sans modifier les traductions**

  Montrer à l’utilisateur les formulations FR/EN proposées pour les mentions légales, les conditions d’utilisation et la confidentialité. Laisser les champs d’identité légale, d’adresse, de numéro et d’hébergeur explicitement à confirmer ; garder le nom commercial « TeamWork » et l’adresse courriel connue. Attendre son approbation avant toute édition de `fr.json` ou `en.json`.

- [ ] **Step 2: Mettre à jour d’abord l’E2E légal pour les formulations approuvées**

  Dans `tests/legalPages.browser.mjs`, vérifier les formulations validées dans les deux langues, le nombre de sections, l’absence de clés i18n brutes, l’absence des promotions VIP dans les conditions, et la mention exacte des factures VIP historiques conservées dans la politique de confidentialité.

- [ ] **Step 3: Vérifier l’échec des assertions de texte**

  Run: `npm run build && node tests/legalPages.browser.mjs`.
  Expected: les assertions de contenu échouent avant la modification des traductions ; les pages légales restent rendables.

- [ ] **Step 4: Appliquer uniquement les formulations approuvées**

  Modifier les clés légales FR/EN correspondantes, sans remplacer les champs non fournis par des valeurs inventées. Conserver dans la confidentialité la divulgation des factures et historiques VIP réellement gardés ; retirer les offres et règles VIP des conditions générales.

- [ ] **Step 5: Rejouer le test légal**

  Run: `npm run build && node tests/legalPages.browser.mjs`.
  Expected: les six rendus FR/EN passent ; captures et rapport sont générés par le test.

- [ ] **Step 6: Commit**

  Committer uniquement les formulations approuvées et les tests associés. Utiliser un staging par hunks pour les bundles de traduction, partagés avec le plan de report du téléchargement vidéo.

## Handoff

Les appels API de paiement et les fichiers d’interface partagent des données historiques, mais les tâches sont suffisamment délimitées pour une exécution native. Toute somme déjà reçue sur une facture-cadeau annulée reste enregistrée et requiert un suivi admin manuel ; aucun mécanisme de remboursement ou de révocation d’un lien fournisseur déjà émis n’existe dans le périmètre actuel. Les deux plans partagent `registry.tsx` et les bundles de traduction ; si les deux sont exécutés dans le même checkout, committer uniquement les hunks de chaque tâche. Ne lancer les commandes navigateur qu’après validation du plan et conformément aux restrictions du dépôt.
