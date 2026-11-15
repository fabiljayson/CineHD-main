# Streamed.pk vers VLC

Sous Windows, double-cliquer sur `streamed-vlc.cmd` pour ouvrir le match
Tottenham Hotspur vs Everton fourni lors de l'essai. Node.js 22+, curl
et VLC doivent être installés. Le script trouve VLC dans son dossier Windows
habituel ; `--vlc` ou `VLC_PATH` permettent de préciser un autre emplacement.

```powershell
# Depuis la racine de Movix : extrait une URL fraîche, démarre le relais et ouvre VLC
node scripts/streamed-vlc.mjs

# Un autre lien watch ou embed
node scripts/streamed-vlc.mjs "https://streamed.pk/watch/tottenham-hotspur-vs-everton-2494033/golf/1"

# Vérifie playlist + premier segment, puis quitte sans ouvrir VLC
node scripts/streamed-vlc.mjs --check

# Affiche une adresse locale à ouvrir manuellement dans un lecteur
node scripts/streamed-vlc.mjs --no-vlc
```

Le script n'installe plus rien et ne clone plus de dépôt : il utilise le
resolver que la Main API a déjà installé depuis son `package-lock.json`, dans
`API/Mainapi/node_modules/streamed-pk-hls-stream-resolver`. La version exécutée
est donc exactement celle du service, épinglée par le lockfile (commit fixe et
`integrity` vérifiée par npm). Le dépôt amont d'origine ayant été supprimé, plus
rien ne dépend de sa disponibilité.

Il faut donc avoir installé les dépendances de la Main API au préalable :

```powershell
cd API/Mainapi; npm ci
```

`--resolver DOSSIER` permet de pointer vers un autre exemplaire du resolver
(clone local, avec son `node_modules`). Le script n'écrit jamais dans le dépôt.

Le script suit aussi la redirection golf observée le 12 septembre 2026 :
embed.st → rockystream.st → iframe `data-source` en base64 → embed.st/ingest.
Le resolver d'origine échoue sur cette chaîne avec `golf stream fid not found`.
L'ancienne extraction golf reste disponible si cette redirection est absente.

VLC reçoit un flux HTTP local. Le relais ajoute Referer, Origin et User-Agent
avec curl pour les playlists **et** les segments, et retire les enveloppes PNG
reconnues par le resolver. Les variantes et attributs `URI` (audio, clés, etc.)
sont également réécrits. Il n'y a pas de transcodage.

Le relais écoute uniquement sur `127.0.0.1`, sur un port libre, avec des chemins
aléatoires. Il ne relaie que les ressources découvertes dans la playlist ; aucun
paramètre d'URL ne permet au client de choisir une autre cible.

**Garder le terminal ouvert.** Fermer VLC arrête le relais. Ctrl+C coupe le
relais sans fermer les autres lecteurs. Les journaux VLC sont enregistrés dans
`%LOCALAPPDATA%\Movix\streamed-vlc\vlc-*.log`.

L'URL est réextraite à chaque lancement. Si le jeton expire pendant la lecture,
relancer le script. Un match terminé ou supprimé de l'API peut être indisponible.
Un changement de protocole amont peut demander une mise à jour du resolver.

Vérifications locales sans réseau externe ni lancement de VLC :

```powershell
node --test tests/streamed-vlc.test.mjs
```
