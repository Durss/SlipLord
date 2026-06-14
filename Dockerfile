# syntax=docker/dockerfile:1

# Node 18+ is required by discord.js / express; 22 LTS is used here.
ARG NODE_VERSION=22-alpine

# ---------------------------------------------------------------------------
# 1. Compile the TypeScript sources (src_back -> server)
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src_back ./src_back
RUN npm run build

# ---------------------------------------------------------------------------
# 2. Install production-only dependencies
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# 3. Minimal runtime image
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node labels.json ./
# offline.png seeds the uploads volume on first run; per-guild data lives there too
COPY --chown=node:node uploads ./uploads
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/server ./server

# Config/labels/uploads are resolved relative to the working dir ("dev" env paths)
RUN printf 'dev' > env.conf && chown node:node env.conf && chown node:node /app

USER node

# Must match SERVER_PORT in configs.json
EXPOSE 3023

CMD ["node", "server/bootstrap.js"]
