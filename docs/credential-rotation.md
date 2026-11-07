# Rotation des identifiants exposés

Contexte : audit sécurité, **Lot B**. Ce dépôt est **public** (`github.com/fabiljayson/CineHD-main`) : deux identifiants ont été committés dans le passé et restent lisibles dans l'historique git. La purge d'historique a été écartée (décision validée) — la parade est donc de **tourner** (régénérer) ou **abandonner** ces identifiants, puis de ne plus jamais les recopier dans le dépôt.

Désindexer un fichier (`git rm --cached`) ou l'ajouter au `.gitignore` ne le retire **pas** de l'historique : quiconque clone le dépôt peut le ressortir avec `git show <commit>:<chemin>`.

## État

| Identifiant | Exposé dans l'historique | Remediation code | Rotation credential | Statut |
| --- | --- | --- | --- | --- |
| Clé API TMDB | hardcodée dans `PreMid/core/constants.ts` jusqu'au `12450c8` | ✅ lecture d'environnement | ⬜ **à faire** | En attente |
| Device Widevine `.wvd` | `API/proxiesembed/drmproxy/gift_from_karoolus.wvd`, ajouté dans `2912133`, désindexé dans `0ac1f0a` | ✅ désindexé + `*.wvd` gitignoré | ⬜ **abandonner** | En attente |

## 1. Clé API TMDB — à régénérer

La clé était écrite en dur dans l'extension PreMid. Elle a été remplacée par une variable d'environnement (`12450c8`), mais **l'ancienne valeur reste dans l'historique** : elle doit être considérée comme publique.

### Où la nouvelle clé doit être posée

| Emplacement | Variable | Usage |
| --- | --- | --- |
| `API/Mainapi/.env` | `TMDB_API_KEY` | backend (recherche, métadonnées, images) |
| `.env` racine | `VITE_TMDB_API_KEY` | build du frontend |
| Build Docker | build-arg `VITE_TMDB_API_KEY` (voir [deployment-docker.md](deployment-docker.md)) | image de production |
| Build PreMid | `TMDB_API_KEY` (lu au build dans `PreMid/core/constants.ts`) | enrichissement media de l'extension |

### Procédure

1. Se connecter sur <https://www.themoviedb.org/settings/api>.
2. Cliquer **Regenerate** : une nouvelle clé est créée, l'ancienne cesse immédiatement de fonctionner (TMDB ne fait pas de révocation séparée — Regenerate *est* la rotation).
3. Mettre à jour la nouvelle valeur dans les quatre emplacements ci-dessus (fichiers `.env` locaux — jamais committés — et build args des environnements de déploiement).
4. Rebuild concernés : frontend (`npm run build` / Docker), PreMid si une clé y est injectée.
5. Vérifier :
   - nouvelle clé : une recherche TMDB depuis l'app renvoie des résultats ;
   - ancienne clé : un appel test avec l'ancienne valeur doit renvoyer **401 Invalid API Key**.

## 2. Device Widevine `.wvd` — à abandonner

Le fichier `API/proxiesembed/drmproxy/gift_from_karoolus.wvd` est l'identité d'un device CDM (Widevine). Il a été committé dans `2912133`, retiré du suivi git dans `0ac1f0a` et `*.wvd` est désormais ignoré (`.gitignore`). **Il est toujours sur disque** — c'est voulu : `API/proxiesembed/app_files/config.json` le référence via `CDM_WVD_FILE_PATH`.

### Décision

Pas de purge d'historique (choix validé) → le device est **considéré comme compromis** : son identité est lisible par quiconque clone le dépôt public. On l'**abandonne** (on ne lui fait plus confiance), on ne le « répare » pas.

### Procédure d'abandon

1. Traiter le device comme brûlé : ne plus s'appuyer dessus pour un usage sensible ou de production.
2. Si le DRM a besoin d'un device fonctionnel :
   - en provisionner un **neuf** auprès du fournisseur d'origine ;
   - le nommer de façon non devinable (pas de nom réutilisé depuis l'historique) — `*.wvd` étant gitignoré, il reste hors git ;
   - mettre à jour `CDM_WVD_FILE_PATH` dans `API/proxiesembed/app_files/config.json` si le nom change.
3. Si le fournisseur propose de révoquer/bannir un device id, l'invoquer pour l'ancien. Sinon : l'abandon effectif = ne plus jamais l'utiliser.
4. Vérifier qu'aucun `.wvd` n'est suivi par git : `git ls-files "*.wvd"` doit rester **vide**.

## Checklist finale

- [ ] Clé TMDB régénérée sur themoviedb.org
- [ ] `TMDB_API_KEY` backend mis à jour
- [ ] `VITE_TMDB_API_KEY` (`.env` + build Docker) mis à jour
- [ ] PreMid rebâti avec la nouvelle clé
- [ ] Ancienne clé vérifiée morte (401)
- [ ] Device `.wvd` abandonné (et device neuf provisionné si nécessaire)
- [ ] `git ls-files "*.wvd"` vide

## Rappels

- Aucun secret dans le dépôt : `.env` hors git, `*.wvd` gitignoré — voir aussi les règles du dépôt (jamais de `.env` committé).
- Si un identifiant est de nouveau exposé : répéter la rotation, ne pas essayer de « nettoyer » l'historique.
- Cette page décrit des **actions opérationnelles** : elle est mise à jour (statut + date) au fil des rotations.