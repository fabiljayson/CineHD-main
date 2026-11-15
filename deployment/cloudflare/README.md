# Worker CineHD — routage, Containers et bindings

Le Worker est le seul point d'entrée Cloudflare. Il ne sert aucune route métier :
il résout le service visé (hôte ou préfixe de chemin) puis délègue au Container
ou à une origine Docker externe.

| Fichier | Rôle |
| --- | --- |
| `src/routing.mjs` | Toute la décision de routage. JavaScript pur, testé sur Node. |
| `src/index.ts` | Point d'entrée Workers : appelle `dispatch`. |
| `src/containers.ts` | Cycle de vie Container : démarrage, sonde `/health`, refus 503 si non prêt. |
| `wrangler.toml` | Bindings : trois Containers, DO, R2, KV, variables de routage. |

## Variables

| Variable | Exemple | Rôle |
| --- | --- | --- |
| `MAIN_API_HOST` | `api.staging.example` | Hôte dédié à la Main API |
| `WATCHPARTY_HOST` | `watch.staging.example` | Hôte dédié à WatchParty |
| `PROXY_HOST` | `proxy.staging.example` | Hôte dédié au proxy |
| `FALLBACK_HOST` | `staging.example` | Hôte servant les préfixes de chemin |
| `PATH_ROUTES` | `/api=mainapi,/watchparty=watchparty,/proxy=proxy` | Préfixe → service, le plus long gagne |
| `MAIN_API_TARGET` | `container:MAIN_API` ou `origin:https://docker.internal:8080` | Cible effective |
| `WATCHPARTY_TARGET` | idem | Cible effective |
| `PROXY_TARGET` | idem | Cible effective |

Changer une cible suffit à basculer un service vers une origine Docker externe :
c'est le repli prévu par la décision D4, sans redéploiement de la logique.

## Bindings

- `MAIN_API`, `WATCHPARTY`, `PROXY` : namespaces Durable Object des Containers.
- `OAUTH_ICONS` (R2) : icônes OAuth, référencées par `oauth_clients` (rétention R1).
- `SOURCE_CACHE` (KV) : cache des sources scrapées, jetable.
- Rotation `v1` : `new_sqlite_classes` pour les trois classes.

## Vérifications

```bash
node --test tests/cloudflareRouting.test.mjs
npx wrangler deploy --dry-run --config deployment/cloudflare/wrangler.toml
```

Sondes de staging (nécessitent un déploiement réel) :

```bash
DEPLOYMENT_BASE_URL=https://api.staging.example node tests/deploymentSmoke.mjs
DEPLOYMENT_BASE_URL=https://watch.staging.example node tests/watchpartyCloudflareSmoke.mjs
PROXY_BASE_URL=https://proxy.staging.example \
PROXY_TEST_ORIGIN=https://media.staging.example/controlled.mp4 \
  python tests/proxyCloudflareSmoke.py
```

## Décision de placement (Task 6)

Chaque service est jugé séparément. Un échec de transport, de durabilité d'état,
d'égression ou de ressources fait basculer **ce seul service** vers une origine
Docker externe ; l'authentification, la validation de destination et la
durabilité ne sont jamais assouplies pour passer la porte.

| Service | Résultat | Preuve | Décision |
| --- | --- | --- | --- |
| Main API | à mesurer | `tests/deploymentSmoke.mjs` | en attente |
| WatchParty | à mesurer | `tests/watchpartyCloudflareSmoke.mjs` | en attente |
| Proxy | à mesurer | `tests/proxyCloudflareSmoke.py` | en attente |
