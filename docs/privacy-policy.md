# Politique de confidentialité CineHD (ex-Movix) · CineHD Privacy Policy

> **Statut / Status** — Ce document est le miroir fidèle de la politique affichée aux utilisateurs dans l'application à l'adresse `/privacy`. En cas d'écart, la page `/privacy` alimentée par `src/i18n/locales/{fr,en}.json` fait foi.
> This document is a faithful mirror of the policy shown to users in the application at `/privacy`. If they ever diverge, the `/privacy` page backed by `src/i18n/locales/{fr,en}.json` is authoritative.

**Dernière mise à jour / Last updated : 29 mars 2026**

**Contact** : [movixstreaming@gmail.com](mailto:movixstreaming@gmail.com) — ou WhatsApp via le lien de support disponible sur la page `/privacy` de l'application.

---

## Sommaire / Summary

1. Données conservées sur votre appareil / Data stored on your device
2. Comptes, profils et synchronisation / Accounts, profiles and synchronization
3. Usage, historique, Wrapped et personnalisation / Usage, history, Wrapped and personalization
4. Communauté, contenus publics et WatchParty / Community, public content and WatchParty
5. Sécurité, anti-abus, VIP et support / Security, anti-abuse, VIP and support
6. Services tiers impliqués / Third-party services involved
7. Vos choix, conservation et contact / Your choices, retention and contact

---

# Partie 1 — Version française

Cette page décrit les données que CineHD traite réellement au 29 mars 2026, à partir du fonctionnement actuel du frontend, de l'API principale, de WatchParty, du bot, de l'extension, du userscript et des flux VIP.

Elle couvre à la fois ce qui reste sur votre appareil, ce qui peut être synchronisé côté serveur, ce qui transite par des services tiers et les contrôles déjà visibles dans l'interface.

**En résumé :**

- CineHD conserve une grande partie de votre état d'usage localement dans le navigateur.
- Une partie de cet état est synchronisée côté serveur pour les comptes connectés Discord, Google ou BIP39.
- WatchParty, les fonctions communautaires et les flux VIP ajoutent leurs propres journaux, messages et données techniques.
- Vous pouvez déjà couper la collecte future de Wrapped et gérer plusieurs éléments depuis les paramètres du compte.

### 1. Données conservées sur votre appareil

Une part importante de l'expérience CineHD fonctionne d'abord dans votre navigateur. Le site s'appuie largement sur le stockage local pour garder vos préférences, votre contexte de session et votre confort d'utilisation entre deux visites.

- Le navigateur peut conserver des réglages, l'ID du profil sélectionné, des informations de session locale, des états VIP, l'historique de lecture, les favoris, des listes personnalisées, la progression, des alertes d'épisodes et d'autres préférences d'interface.
- Le service worker du site met certains fichiers en cache pour accélérer le chargement, et le navigateur peut garder des caches techniques temporaires supplémentaires.
- L'extension navigateur et le userscript maintiennent aussi des données locales comme l'état d'activation, des statistiques de fonctionnement et des caches d'extraction.
- Les exports et imports de données proposés dans les paramètres restent sous votre contrôle sur votre appareil tant que vous ne choisissez pas de les synchroniser ou de les partager.

### 2. Comptes, profils et synchronisation

- Lorsque vous vous connectez via Discord, Google ou BIP39, CineHD traite le contexte de compte correspondant : identifiant fournisseur, pseudo, avatar, type de compte, sessions et profil actif.
- La gestion de session conserve notamment un identifiant de session, le user-agent, des dates d'accès et une empreinte d'appareil dérivée et chiffrée à partir du user-agent et de l'adresse IP.
- Les comptes connectés peuvent gérer plusieurs profils avec nom, avatar, restriction d'âge et profil par défaut ; certaines interactions communautaires sont rattachées à un profil précis.
- Pour les comptes Discord, Google et BIP39 connectés, une partie de l'état local est synchronisée côté serveur par deltas dans des données persistantes liées au compte et au profil.
- Les secrets de session comme session_id, guest_uuid, auth_token et access_token sont explicitement exclus de cette synchronisation automatique.

> Le code actuel désactive la synchronisation serveur pour les invités. Les utilisateurs VIP sont également ignorés par la route de sync automatique.

### 3. Usage, historique, Wrapped et personnalisation

- CineHD utilise vos préférences, votre progression de lecture, vos favoris, vos listes, vos alertes et vos paramètres pour personnaliser l'interface et retrouver votre état d'usage.
- Quand la collecte Wrapped est activée, le front peut envoyer des événements contenant notamment la durée de visionnage, la page visitée, les identifiants et titres de contenus, la saison, l'épisode, l'heure et le profil actif.
- Une option dans les paramètres permet de désactiver la collecte future de Wrapped, et une autre permet de limiter ou vider l'historique local de lecture continue.
- Les alertes d'épisodes sont stockées localement et vérifiées périodiquement dans le navigateur pour déclencher des notifications côté client.

### 4. Communauté, contenus publics et WatchParty

- Les commentaires, réponses, listes partagées, votes, Wishboard, soumissions de liens, signalements, notifications et éléments de modération peuvent être stockés côté serveur.
- Les commentaires et réponses enregistrent l'adresse IP ainsi que des identifiants de compte et de profil afin de faire fonctionner la publication, la modération et la sécurité.
- Certaines données communautaires sont publiques par nature, par exemple des listes partagées dans le catalogue public ou des contenus visibles par d'autres utilisateurs.
- WatchParty traite les codes de salle, pseudonymes, participants, messages, réactions, état de lecture, métadonnées média, paramètres de salle et votes de synchronisation.
- Les salles publiques WatchParty exposent publiquement certaines métadonnées comme le code, le titre, l'affiche, le type de média et le nombre de participants.
- Les salles WatchParty sont conservées en mémoire avec sauvegarde JSON temporaire, limitées à 100 messages par salle, et expirent automatiquement après 12 heures ou après 3 heures d'inactivité si elles sont vides.

### 5. Sécurité, anti-abus, VIP et support

- CineHD vérifie des tokens Cloudflare Turnstile pour certaines actions sensibles, avec transmission du token et de l'adresse IP distante pour l'anti-abus.
- Certains contenus textuels comme les commentaires, pseudos ou listes partagées peuvent être soumis à des outils de modération automatisée avant ou après publication, en plus d'un contrôle humain.
- La partie VIP traite des données de facture et de paiement comme l'identifiant public de facture, l'adresse crypto unique, le montant attendu, l'état, les confirmations, le hash de transaction, les cadeaux et les clés VIP.
- Des empreintes IP hachées sont utilisées dans les flux VIP pour la prévention de fraude autour de la création de facture ou de l'ouverture d'un cadeau.
- En cas d'erreur opérationnelle, certains éléments techniques de diagnostic peuvent être transmis aux outils internes de support, notamment via des webhooks Discord.
- Si vous utilisez les canaux de support WhatsApp ou le bot officiel, vos identifiants, messages, tickets, transcriptions ou références de paiement peuvent être traités dans ce cadre.

### 6. Services tiers impliqués

- Discord OAuth pour l'identité et certaines informations de serveurs ou membres nécessaires aux flux Discord du site.
- Google OAuth pour l'authentification basée sur l'email et le profil.
- TMDB pour les métadonnées, affiches, logos et autres éléments de catalogue.
- Cloudflare Turnstile pour la vérification anti-bot.
- Vercel Analytics pour des mesures de fréquentation et d'usage du site.
- OpenRouter pour certaines modérations automatisées de contenus textuels.
- Coinbase, CoinGecko et BlockCypher pour le pricing et la vérification des paiements VIP.
- Des hosters, CDNs, proxies et sources média externes qui reçoivent les métadonnées techniques normales d'une requête lorsqu'une lecture ou une extraction est lancée.

> Chaque service tiers applique ses propres règles. Cette page décrit la manière dont CineHD les appelle aujourd'hui, pas les politiques internes de ces fournisseurs.

### 7. Vos choix, conservation et contact

Les données CineHD peuvent vivre à plusieurs endroits selon la fonctionnalité : dans votre navigateur, dans des fichiers JSON liés à votre compte, dans des tables MySQL et dans des caches techniques temporaires. Le code ne définit pas une durée uniforme unique pour tous les cas.

- Vous pouvez déjà gérer certaines choses directement dans Paramètres : sessions actives, comptes liés, import ou export local, historique local et collecte future de Wrapped.
- Certaines suppressions sont locales uniquement et d'autres nécessitent une intervention support, car le dépôt n'expose pas une interface de purge universelle pour toutes les données backend.
- CineHD ne met pas en place, dans le code actuel, de mécanisme de vente de données personnelles à des tiers.
- Les changements importants de cette page seront reflétés par la date de mise à jour affichée ici.

**Exercer un contrôle ou poser une question**

Pour une question confidentialité, une demande d'accès ou une demande de suppression qui n'est pas couverte par les réglages disponibles, écrivez à [movixstreaming@gmail.com](mailto:movixstreaming@gmail.com) ou utilisez le canal WhatsApp présent sur la page `/privacy`. Pour les réglages immédiats déjà exposés dans l'application, la page Paramètres reste le point d'entrée principal.

> Cette politique reflète le comportement observable du code CineHD au 29 mars 2026. Si une future évolution ajoute, retire ou change un flux de données important, cette page devra être alignée à nouveau sur l'implémentation réelle.

---

# Partie 2 — English version

This page describes the data CineHD actually processes as of March 29, 2026, based on the current behavior of the frontend, the main API, WatchParty, the bot, the browser extension, the userscript and VIP flows.

It covers what stays on your device, what can be synchronized server-side, what passes through third-party services and which controls are already visible in the interface.

**In short:**

- CineHD keeps a large part of your usage state locally in the browser.
- Part of that state is synchronized server-side for connected Discord, Google or BIP39 accounts.
- WatchParty, community features and VIP flows add their own logs, messages and technical data.
- You can already disable future Wrapped collection and manage several items from the account settings.

### 1. Data stored on your device

A significant part of the CineHD experience runs directly in your browser. The site relies heavily on local storage to keep your preferences, session context and usage comfort between visits.

- The browser may store settings, the selected profile ID, local session information, VIP states, watch history, favorites, custom lists, progress, episode alerts and other interface preferences.
- The site's service worker caches some files to speed up loading, and the browser may keep additional temporary technical caches.
- The browser extension and the userscript also keep local data such as activation state, runtime statistics and extraction caches.
- The data exports and imports offered in settings remain under your control on your device until you choose to sync or share them.

### 2. Accounts, profiles and synchronization

- When you sign in through Discord, Google or BIP39, CineHD processes the matching account context: provider identifier, username, avatar, account type, sessions and active profile.
- Session management notably stores a session identifier, the user agent, access dates and a derived encrypted device fingerprint built from the user agent and IP address.
- Connected accounts can manage multiple profiles with name, avatar, age restriction and default profile; some community interactions are attached to a specific profile.
- For connected Discord, Google and BIP39 accounts, part of the local state is synchronized server-side through deltas into persistent data tied to the account and profile.
- Session secrets such as session_id, guest_uuid, auth_token and access_token are explicitly excluded from this automatic synchronization.

> The current code disables server sync for guests. VIP users are also ignored by the automatic sync route.

### 3. Usage, history, Wrapped and personalization

- CineHD uses your preferences, playback progress, favorites, lists, alerts and settings to personalize the interface and restore your usage state.
- When Wrapped collection is enabled, the frontend can send events including watch duration, visited page, content IDs and titles, season, episode, time and active profile.
- An option in settings allows you to disable future Wrapped collection, and another allows you to limit or clear the local continue-watching history.
- Episode alerts are stored locally and checked periodically in the browser to trigger client-side notifications.

### 4. Community, public content and WatchParty

- Comments, replies, shared lists, votes, Wishboard, link submissions, reports, notifications and moderation elements may be stored server-side.
- Comments and replies record the IP address along with account and profile identifiers so publishing, moderation and security can work.
- Some community data is public by nature, for example shared lists in the public catalog or content visible to other users.
- WatchParty processes room codes, nicknames, participants, messages, reactions, playback state, media metadata, room settings and sync votes.
- Public WatchParty rooms expose some metadata publicly such as the code, title, poster, media type and participant count.
- WatchParty rooms are kept in memory with temporary JSON persistence, limited to 100 messages per room, and automatically expire after 12 hours or after 3 hours of inactivity if empty.

### 5. Security, anti-abuse, VIP and support

- CineHD verifies Cloudflare Turnstile tokens for some sensitive actions, transmitting the token and remote IP address for anti-abuse purposes.
- Some text content such as comments, nicknames or shared lists may be sent through automated moderation tools before or after publication, in addition to human review.
- The VIP area processes invoice and payment data such as public invoice identifier, unique crypto address, expected amount, status, confirmations, transaction hash, gifts and VIP keys.
- Hashed IP fingerprints are used in VIP flows for fraud prevention around invoice creation or gift opening.
- In case of operational errors, some technical diagnostic elements may be sent to internal support tools, especially through Discord webhooks.
- If you use WhatsApp or the official bot for support, your identifiers, messages, tickets, transcripts or payment references may be processed in that context.

### 6. Third-party services involved

- Discord OAuth for identity and some server or member information needed by the site's Discord flows.
- Google OAuth for email- and profile-based authentication.
- TMDB for metadata, posters, logos and other catalog assets.
- Cloudflare Turnstile for anti-bot verification.
- Vercel Analytics for traffic and usage measurements on the site.
- OpenRouter for some automated moderation of text content.
- Coinbase, CoinGecko and BlockCypher for pricing and VIP payment verification.
- External hosts, CDNs, proxies and media sources that receive the normal technical metadata of a request when playback or extraction is started.

> Each third-party service applies its own rules. This page describes how CineHD calls them today, not those providers' internal policies.

### 7. Your choices, retention and contact

CineHD data may live in several places depending on the feature: in your browser, in JSON files tied to your account, in MySQL tables and in temporary technical caches. The code does not define one single uniform retention period for every case.

- You can already manage some items directly in Settings: active sessions, linked accounts, local import or export, local history and future Wrapped collection.
- Some deletions are local only and others require support intervention, because the repository does not expose a universal purge interface for all backend data.
- CineHD does not implement, in the current code, any mechanism to sell personal data to third parties.
- Important changes to this page will be reflected by the update date shown here.

**Exercise control or ask a question**

For a privacy question, an access request or a deletion request not covered by the available settings, write to [movixstreaming@gmail.com](mailto:movixstreaming@gmail.com) or use the WhatsApp channel shown on the `/privacy` page. For immediate settings already exposed in the app, the Settings page remains the main entry point.

> This policy reflects the observable behavior of the CineHD code as of March 29, 2026. If a future change adds, removes or changes a significant data flow, this document should be aligned again with the real implementation.

---

## Notes de maintenance / Maintenance notes

- Ce document ne remplace **pas** la page `/privacy` de l'application : il l'accompagne. Toute modification des chaînes `privacyPolicyPage` de `src/i18n/locales/{fr,en}.json` doit être répercutée ici.
- This document does **not** replace the `/privacy` page: it accompanies it. Any change to the `privacyPolicyPage` strings in `src/i18n/locales/{fr,en}.json` must be reflected here.
- Ce texte décrit les pratiques réelles du code sans certifier de conformité légale (RGPD, LCEN, etc.) ; une revue juridique dédiée reste nécessaire avant toute publication commerciale.
- This text describes the code's actual practices without certifying legal compliance (GDPR, LCEN, etc.); a dedicated legal review remains necessary before any commercial release.
