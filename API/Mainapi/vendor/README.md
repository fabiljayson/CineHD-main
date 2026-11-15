# `streamed-pk-hls-stream-resolver` vendu

`streamed-pk-hls-stream-resolver.tgz` est une dépendance **vendue** (archivée
dans le dépôt), déclarée dans `API/Mainapi/package.json` par
`"file:./vendor/streamed-pk-hls-stream-resolver.tgz"`.

## Pourquoi

Le paquet n'est publié sur aucun registre. Il était installé depuis un tarball
GitHub épinglé au commit `7d918be84d47a924373a9304d7c8856a9daba4c6` du dépôt
`sharoon7171/streamed-pk-hls-stream-resolver`, qui a depuis disparu : `codeload`
répond `404` et le dépôt `Repository not found`. Toute installation propre —
image Docker, CI, nouveau clone — échouait, alors qu'un poste déjà installé
continuait de fonctionner. Le seul miroir accessible appartient à un tiers et
peut disparaître de la même façon.

## Provenance exacte

- Contenu recopié depuis le paquet **déjà installé** par l'ancien tarball, donc
  exactement le code que le service exécutait avant le vendoring.
- 29 fichiers sous `package/` (`src/`, `public/`, `package.json`, `README.md`).
- `integrity` du tarball d'origine (ancien `package-lock.json`) :
  `sha512-0hH43E77GSV3f720Qujg1ZWnSb0lpsKrIVJ2FVq17bUdWzBOUVJtXf9B0zk5FetnJnWBr585FSsi2XbvfDfn0A==`
- Empreinte du contenu extrait (SHA-256 des SHA-256 triés de chaque fichier) :
  `b5d26371d8579707f3d52f7b0e6ec03d2a4104d247ee4cb65e9f407f0a758e9a`

`package-lock.json` enregistre l'`integrity` de **ce** tarball : un fichier
modifié sans mise à jour du lockfile fait échouer `npm ci`.

Le paquet amont ne déclare **aucune licence** et ne livre aucun fichier
`LICENSE`. Le vendre ne change pas cette situation : sa redistribution doit être
validée par le propriétaire du projet.

## Pourquoi un tarball et pas un dossier

Un dossier déclaré en `file:` est installé comme un **lien symbolique** par
npm 11, alors que npm 10 (l'image `node:22`) exige que les dépendances de la
cible figurent dans le lockfile et échoue avec `EUSAGE … Missing: happy-dom`.
Les deux versions npm acceptent en revanche un tarball `file:`, installé comme
un paquet normal, avec `resolved`, `integrity` et dépendances dans le lockfile.

## Ce qui est réellement utilisé

- `API/Mainapi/utils/streamedNative.js` charge un seul fichier :
  `src/sources/goat/lock-worker.js` (worker WASM de déchiffrement GOAT).
- `scripts/streamed-vlc.mjs` lit `src/resolve/parse.js`, `src/resolve/run.js`
  et `src/relay/segment.js` depuis `node_modules` après installation.

Le reste (`src/http/`, `src/server.js`, `public/`) est le serveur web autonome
du projet amont, inutilisé ici.

## Inspecter et mettre à jour

```bash
# lire le contenu sans l'installer
tar -tzf API/Mainapi/vendor/streamed-pk-hls-stream-resolver.tgz | head

# extraire pour relire le code
tar -xzf API/Mainapi/vendor/streamed-pk-hls-stream-resolver.tgz -C /tmp

# empreinte du contenu extrait
(cd /tmp/package && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)
```

Pour changer de version : remplacer le tarball (racine `package/`), mettre à
jour la provenance et l'empreinte ci-dessus, puis exécuter
`npm install --package-lock-only` dans `API/Mainapi`, reconstruire l'image et
rejouer `node --test tests/containerHealth.test.js`.
