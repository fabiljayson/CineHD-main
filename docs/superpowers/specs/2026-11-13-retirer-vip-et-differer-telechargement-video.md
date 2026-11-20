# Retrait de VIP et report du téléchargement vidéo

## Intent

Retirer les offres et contrôles VIP de l'expérience publique de CineHD, et reporter le téléchargement de films et séries. L'utilisateur veut relire les changements proposés aux documents juridiques avant qu'ils soient appliqués aux traductions.

## Goals

- Enlever des parcours publics les pages VIP, liens, promotions, activation de clés, badges et restrictions d'accès VIP.
- Rendre accessibles à tous les utilisateurs les fonctions auparavant réservées au VIP, en gardant leurs autres protections indépendantes du statut (authentification, limites anti-abus, restrictions d'âge, etc.).
- Retirer les popups publicitaires de lecture pour tous les utilisateurs.
- Empêcher de nouvelles actions VIP côté utilisateur, sans supprimer les données existantes ni l'administration.
- Laisser les factures déjà ouvertes consultables et permettre leur règlement/confirmation jusqu'à leur traitement normal.
- Désactiver les liens de cadeaux VIP existants qui n'ont pas encore été réclamés.
- Au clic sur Télécharger pour un film ou une série, afficher un message localisé « Bientôt disponible » plutôt que lancer le téléchargement ou naviguer vers son flux.
- Ne pas modifier le téléchargement d'images, l'application mobile, les sous-titres ou les autres fonctions de téléchargement distinctes.
- Garder les documents FR/EN exacts par rapport aux traitements qui subsistent, sans fabriquer d'identité, d'adresse ou de numéro.
- Montrer le brouillon des extraits juridiques à l'utilisateur et attendre son accord avant de modifier les fichiers de traduction.

## Non-goals and constraints

- Ne pas supprimer les tables, clés, factures, historiques ou autres données VIP.
- Ne pas retirer les écrans et opérations VIP internes d'administration.
- Ne pas retirer les sources ou fournisseurs vidéo nommés « Viper » : ils ne désignent pas l'offre VIP.
- Ne pas arrêter les callbacks nécessaires au traitement des factures déjà ouvertes.
- Ne pas inventer le nom légal de l'entrepreneur individuel, son adresse, son numéro d'immatriculation, le directeur de publication, ni l'hébergeur et son adresse.
- « TeamWork » est le nom commercial fourni, pas l'identité légale. L'adresse de l'éditeur est laissée à confirmer. Le contact déjà présent dans le dépôt est `jasonfranckkenmognw@gmail.com`.
- Ce texte est un brouillon produit, pas une validation juridique.
- Le dépôt comporte déjà des modifications non liées, notamment dans `src/App.tsx` et `src/routing/registry.tsx`. Les préserver et les relire avant tout changement dans ces fichiers.

## Approaches

1. **Masquer uniquement l'interface VIP.** Cela laisserait utilisables les routes publiques d'achat, de cadeaux et de demandes de paiement directement par API ; ce n'est pas suffisant pour le retrait demandé.
2. **Retirer les parcours VIP publics, garder les données et le back-office.** Désactiver les nouvelles actions VIP côté utilisateur et les cadeaux non réclamés, tout en conservant les données historiques, les outils administratifs et le traitement des factures déjà ouvertes. C'est l'approche choisie : elle retire la fonctionnalité publique sans effacer des données ni interrompre des opérations engagées.
3. **Supprimer entièrement le backend et les données VIP.** Cela pourrait effacer des dossiers de paiement et compromettre les opérations en cours ; l'utilisateur a choisi de conserver l'historique et l'administration, donc cette approche est écartée.

## Behavior and scope

### VIP

- Retirer les routes et pages VIP publiques et tous leurs liens, promotions, flux de clés, dons, cadeaux non réclamés, fonctions de profil, badges, mentions et contrôles d'accès destinés aux utilisateurs.
- Rendre gratuits les avantages fonctionnels jusque-là réservés au statut VIP (notamment les accès Debrid/FranceTV/sources et les quotas/priorités applicables), sans contourner l'authentification, les restrictions d'âge, les limites anti-abus ou les prérequis techniques sans rapport avec le VIP.
- Supprimer les popups publicitaires de lecture pour tous ; aucun statut VIP ne sera nécessaire pour obtenir ce comportement.
- Retirer les badges et marqueurs qui ne sont que l'affichage d'un statut VIP, plutôt que de les distribuer à tous.
- Rendre inopérantes les nouvelles actions publiques d'achat/demande et de réclamation de cadeaux côté API. Conserver les accès administratifs et les lectures nécessaires au traitement des anciennes factures ouvertes ; ne pas effacer d'enregistrements.
- Conserver dans la politique de confidentialité une information exacte sur les dossiers VIP historiques et le traitement des factures déjà engagées, même si les promotions VIP disparaissent des conditions et de l'interface.
- Ne pas retirer les noms ou opérations VIP internes à l'administration.

### Téléchargement vidéo

- Les boutons Télécharger des pages de détails film et série affichent une notification « Bientôt disponible » / “Coming soon”.
- Aucun clic de ces boutons ne démarre un téléchargement ni ne mène au flux actuel de téléchargement.
- Une ancienne URL de téléchargement vidéo ne doit pas permettre de contourner le report.
- Les téléchargements d'images et les autres usages du mot « télécharger » ne sont pas dans le périmètre.

### Documents juridiques — brouillon à approuver

Ces formulations sont des propositions à revoir dans la conversation avant toute écriture dans `fr.json` et `en.json`. Les champs entre crochets restent explicitement à confirmer.

**Mentions légales — français**

> CineHD est exploité sous le nom commercial « TeamWork » par [nom légal complet de l'entrepreneur individuel — à confirmer], entrepreneur individuel, dont l'adresse professionnelle est [à confirmer]. Numéro d'immatriculation : [à confirmer]. Directeur de la publication : [à confirmer].
>
> Hébergeur : [nom légal et adresse postale de l'hébergeur réellement utilisé — à confirmer].

**Legal notice — English**

> CineHD is operated under the trade name “TeamWork” by [full legal name of the sole proprietor — to be confirmed], a sole proprietorship, with its business address at [to be confirmed]. Registration number: [to be confirmed]. Publication director: [to be confirmed].
>
> Hosting provider: [legal name and postal address of the actual provider — to be confirmed].

**Confidentialité — français**

> Le responsable du traitement est [nom légal complet de l'entrepreneur individuel — à confirmer], qui exploite CineHD sous le nom commercial « TeamWork ». Contact : jasonfranckkenmognw@gmail.com.
>
> Les dossiers techniques peuvent encore contenir des factures VIP déjà émises et les informations nécessaires au traitement des paiements associés. Les données historiques ne sont pas supprimées par le retrait de l'interface.

**Privacy — English**

> The data controller is [full legal name of the sole proprietor — to be confirmed], who operates CineHD under the trade name “TeamWork”. Contact: jasonfranckkenmognw@gmail.com.
>
> Technical records may still contain previously issued VIP invoices and the information needed to process their associated payments. Historical records are not deleted when the interface is withdrawn.

**Conditions d'utilisation / Terms of service**

> Retirer les offres, avantages, paiements et accès VIP des sections de présentation et des règles générales, sans supprimer les clauses applicables aux factures déjà engagées avant la désactivation. L'extrait exact sera montré pour validation avant sa mise en place.

## Decisions already made

- Le retrait VIP couvre toute l'expérience publique, pas seulement la page `/vip`; les avantages fonctionnels deviennent gratuits pour tous, et les popups publicitaires de lecture sont retirées pour tous.
- Les nouvelles actions VIP côté utilisateur sont désactivées ; les factures ouvertes restent traitables.
- Les cadeaux VIP non réclamés sont désactivés.
- L'administration et l'historique backend sont conservés.
- Seuls les téléchargements de vidéos de films et séries sont reportés avec une notification ; les téléchargements d'images restent.
- « TeamWork » est un nom commercial. L'adresse postale, l'identité légale complète et le numéro d'immatriculation ne sont pas fournis et resteront à confirmer ; les coordonnées de l'hébergeur doivent correspondre à l'environnement réellement utilisé.
- Le fournisseur vidéo « Viper » est distinct du statut VIP et reste disponible.

## Left to the builder

- Suivre les conventions existantes pour les notifications, le routage, la traduction FR/EN et la désactivation sécurisée des routes utilisateur.
- Vérifier les accès indirects et liens profonds VIP ainsi que l'absence de contournement du report de téléchargement, sans toucher aux outils de téléchargement d'images.
- Garder la divulgation de confidentialité alignée sur les factures et données historiques réellement conservées.
- Préserver toutes les modifications préexistantes sans rapport avec ce changement.
