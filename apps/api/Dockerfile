# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app

# dumb-init reaps zombies and forwards SIGTERM, so graceful shutdown works.
RUN apk add --no-cache dumb-init openssl && \
    addgroup -g 1001 -S nodejs && \
    adduser -S phantom -u 1001

ENV NODE_ENV=production

COPY --from=build --chown=phantom:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=phantom:nodejs /app/dist ./dist
COPY --from=build --chown=phantom:nodejs /app/prisma ./prisma
COPY --chown=phantom:nodejs package.json ./

# Never root. A container escape starting from uid 1001 is a far smaller problem.
USER phantom
EXPOSE 4000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
