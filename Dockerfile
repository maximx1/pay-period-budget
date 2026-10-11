# syntax=docker/dockerfile:1
#
# One image that serves both the API and the built web client.
# Debian-based on purpose: the SQLite driver and the password hasher ship prebuilt
# binaries for glibc, so nothing here needs a compiler.

# ---- build the web client ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- install only what the server needs at runtime ----
FROM node:22-bookworm-slim AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- the image that runs ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    API_PORT=8787 \
    DATABASE_URL=file:/data/app.db
WORKDIR /app

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY --from=build /app/dist/client ./dist/client

# The database lives in /data; mount a volume there so it outlives the container.
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787

# Healthy means the process is up and the database answers.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.API_PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# Run the server directly (not through npm) so it receives stop signals and shuts down cleanly.
CMD ["node_modules/.bin/tsx", "src/server/index.ts"]
