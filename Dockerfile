# Scan this upstream image as well as the build tools and final runtime.
FROM cgr.dev/chainguard/wolfi-base:latest@sha256:be019c1c74fe69204a42c4e10bc4d886a49bf5403ffa74374ef7baa408fc9a26 AS os-base

# Wolfi uses glibc and signed packages; keep the same Node LTS patch as .nvmrc.
FROM os-base AS node-runtime
RUN apk upgrade --no-cache \
    && apk add --no-cache nodejs-24=24.22.3-r2 \
    && node --version \
    && addgroup -g 1000 node \
    && adduser -D -u 1000 -G node node

FROM node-runtime AS node-base
# Authenticate the npm bootstrap archive before extraction; no unpinned bootstrap npm.
ADD --checksum=sha256:d1a92f40e6c407b84c3a00c3cf978a10b24fd42f153c527e2016cef7bb34a483 https://registry.npmjs.org/npm/-/npm-11.20.0.tgz /tmp/npm.tgz
RUN mkdir -p /usr/local/bin /usr/local/lib/node_modules/npm \
    && tar -xzf /tmp/npm.tgz -C /usr/local/lib/node_modules/npm --strip-components=1 \
    && ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && npm install --prefix /tmp/npm-security --omit=dev --no-save --ignore-scripts --package-lock=false brace-expansion@5.0.11 undici@6.29.1 \
    && rm -rf /usr/local/lib/node_modules/npm/node_modules/brace-expansion /usr/local/lib/node_modules/npm/node_modules/undici \
    && cp -a /tmp/npm-security/node_modules/brace-expansion /tmp/npm-security/node_modules/undici /usr/local/lib/node_modules/npm/node_modules/ \
    && npm cache clean --force \
    && rm -rf /tmp/npm.tgz /tmp/npm-security

FROM node-base AS frontend-build
WORKDIR /app
COPY frontend/package*.json frontend/
RUN npm ci --prefix frontend
COPY packages/ packages/
COPY frontend/ frontend/
RUN npm run build --prefix frontend

FROM node-base AS backend-deps
WORKDIR /app
COPY backend/package*.json backend/
RUN npm ci --omit=dev --prefix backend && npm cache clean --force

# Optional Linux verification target; never included in the production image.
FROM backend-deps AS backend-test
COPY backend/ backend/
COPY packages/ packages/
COPY tools/create-household.mjs tools/create-household.mjs
COPY deploy/Caddyfile deploy/Caddyfile
COPY compose.yaml compose.yaml
USER node
RUN npm test --prefix backend

FROM node-runtime AS runtime
ENV NODE_ENV=production SMART_HOME_API_HOST=0.0.0.0 SMART_HOME_API_PORT=3101 SMART_HOME_DATA_DIR=/data
WORKDIR /app
# npm never enters this stage. Retain Node's shared libraries and CA trust store.
RUN mkdir /data && chown node:node /data && chmod 700 /data \
    && apk del --no-network wolfi-base apk-tools
COPY --from=backend-deps /app/backend/node_modules/ backend/node_modules/
COPY backend/ backend/
COPY packages/ packages/
COPY --from=frontend-build /app/frontend/dist/ frontend/dist/
USER node
EXPOSE 3101
CMD ["node", "backend/server.mjs"]
