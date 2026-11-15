# syntax=docker/dockerfile:1
#
# Image de la Main API (CommonJS, `node server.js`).
#
# Deux étapes : la première compile et installe les dépendances, la seconde ne
# contient que le runtime. Les dépendances sont installées depuis le lockfile
# avec `npm ci`, donc une image correspond toujours à un commit du dépôt.
#
# Le système de fichiers d'un Container est éphémère : `cache/` et
# `public/oauth-icons/` sont écrivables au runtime mais ne doivent pas être
# considérés comme durables (cf. docs/superpowers/specs/2026-11-14-cinehd-deployment-inventory.md).

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
# better-sqlite3, cycletls, impit et tiny-secp256k1 chargent ou compilent des
# binaires natifs : les outils de build doivent exister pendant `npm ci`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=25565 \
    UV_THREADPOOL_SIZE=8
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node . .

# Répertoires écrits au runtime : ils appartiennent à l'utilisateur non-root.
RUN mkdir -p cache darkino-backups public/oauth-icons \
 && chown -R node:node cache darkino-backups public
USER node

EXPOSE 25565

# Sonde de liveness locale pour `docker run`. L'orchestrateur Cloudflare utilise
# le Worker (Task 5) ; `/ready` reste le signal de disponibilité.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:Number(process.env.PORT)||25565,path:'/health',timeout:4000},(res)=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
