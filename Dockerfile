# Image de l'application. Construction en plusieurs étapes : l'image finale ne
# contient ni le code source, ni les dépendances de développement, ni le
# gestionnaire de paquets.
#

# ─── Dépendances ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` et non `npm install` : installe exactement le lockfile et échoue s'il
# a divergé, au lieu de le réécrire silencieusement dans l'image.
RUN npm ci

# ─── Construction ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Les variables AVANT `prisma generate` : prisma.config.ts exige
# DIRECT_DATABASE_URL dès son chargement, y compris pour une simple génération
# qui ne se connecte à rien. Les définir après faisait échouer la construction.
#
# `next build` évalue également src/config/env.ts, qui refuse de démarrer sans
# ses variables. Valeurs factices : la construction ne se connecte à aucune base,
# et aucune de ces valeurs ne survit à l'étape suivante.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    DIRECT_DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    SESSION_IDLE_TIMEOUT_MINUTES="15" \
    SESSION_COOKIE_SECURE="true" \
    AUDIT_RETENTION_MONTHS="36" \
    NEXT_TELEMETRY_DISABLED="1"

# Le client Prisma est généré depuis le schéma, jamais versionné.
RUN npx prisma generate

RUN npm run build

# ─── Exécution ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Utilisateur non privilégié : une exécution de code arbitraire dans le
# conteneur ne doit pas hériter de root.
RUN addgroup --system --gid 1001 cabinet \
 && adduser --system --uid 1001 --ingroup cabinet cabinet

COPY --from=builder --chown=cabinet:cabinet /app/public ./public
COPY --from=builder --chown=cabinet:cabinet /app/.next/standalone ./
COPY --from=builder --chown=cabinet:cabinet /app/.next/static ./.next/static

# Schéma et SQL de sécurité embarqués : les migrations se jouent depuis l'image
# déployée, avec exactement le schéma qu'elle contient. Les jouer depuis un poste
# de développeur, c'est risquer d'appliquer une version différente.
COPY --from=builder --chown=cabinet:cabinet /app/prisma ./prisma

USER cabinet
EXPOSE 3000

# Sonde applicative et non `curl` : l'image n'en contient pas, et en ajouter un
# pour une sonde élargirait la surface d'attaque.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/connexion',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
