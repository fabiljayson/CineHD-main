# syntax=docker/dockerfile:1
#
# Image WatchParty (Socket.IO, ESM).
#
# Service autonome : ses dépendances viennent de son propre `package-lock.json`,
# plus du `node_modules` à la racine du dépôt. La sauvegarde des rooms reste un
# instantané écrit à l'arrêt propre : le système de fichiers d'un Container est
# éphémère, donc la durabilité continue doit être prouvée en staging (Task 6)
# avant d'adopter Containers pour ce service.

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=25566
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node . .

RUN mkdir -p cache && chown -R node:node cache
USER node

EXPOSE 25566

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:Number(process.env.PORT)||25566,path:'/health',timeout:4000},(res)=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "watchparty.js"]
