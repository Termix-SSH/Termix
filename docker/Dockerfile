# Stage 1: Install dependencies
FROM node:26-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# Every workspace package needs its package.json present before npm ci, or
# npm ci silently skips linking it and its dependencies never get installed
# (a glob COPY like plugins/*/package.json flattens into one file, so each
# plugin needs its own line).
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY plugins/acme-ssl/package.json ./plugins/acme-ssl/package.json
COPY plugins/ai/package.json ./plugins/ai/package.json
COPY plugins/alerts/package.json ./plugins/alerts/package.json
COPY plugins/automations/package.json ./plugins/automations/package.json
COPY plugins/docker/package.json ./plugins/docker/package.json
COPY plugins/file-manager/package.json ./plugins/file-manager/package.json
COPY plugins/fleets/package.json ./plugins/fleets/package.json
COPY plugins/homepage/package.json ./plugins/homepage/package.json
COPY plugins/host-metrics/package.json ./plugins/host-metrics/package.json
COPY plugins/ldap/package.json ./plugins/ldap/package.json
COPY plugins/network-topology/package.json ./plugins/network-topology/package.json
COPY plugins/opkssh/package.json ./plugins/opkssh/package.json
COPY plugins/proxmox/package.json ./plugins/proxmox/package.json
COPY plugins/remote-desktop/package.json ./plugins/remote-desktop/package.json
COPY plugins/secret-sources/package.json ./plugins/secret-sources/package.json
COPY plugins/serial/package.json ./plugins/serial/package.json
COPY plugins/session-recording/package.json ./plugins/session-recording/package.json
COPY plugins/session-sharing/package.json ./plugins/session-sharing/package.json
COPY plugins/snippets/package.json ./plugins/snippets/package.json
COPY plugins/ssh-terminal/package.json ./plugins/ssh-terminal/package.json
COPY plugins/sso/package.json ./plugins/sso/package.json
COPY plugins/step-ca/package.json ./plugins/step-ca/package.json
COPY plugins/tailscale/package.json ./plugins/tailscale/package.json
COPY plugins/termix-identity/package.json ./plugins/termix-identity/package.json
COPY plugins/tmux-monitor/package.json ./plugins/tmux-monitor/package.json
COPY plugins/totp/package.json ./plugins/totp/package.json
COPY plugins/tunnels/package.json ./plugins/tunnels/package.json
COPY plugins/vault/package.json ./plugins/vault/package.json
COPY plugins/wake-on-lan/package.json ./plugins/wake-on-lan/package.json
COPY plugins/warpgate/package.json ./plugins/warpgate/package.json
COPY plugins/web-endpoint/package.json ./plugins/web-endpoint/package.json
COPY plugins/webauthn/package.json ./plugins/webauthn/package.json
COPY plugins/workspaces/package.json ./plugins/workspaces/package.json
COPY .npmrc ./
COPY vendor ./vendor

COPY scripts/patch-guacamole-lite.cjs scripts/patch-ssh2-agent.cjs ./scripts/

RUN npm ci --ignore-scripts && \
    node scripts/patch-guacamole-lite.cjs && \
    node scripts/patch-ssh2-agent.cjs && \
    npm cache clean --force

# Stage 2: Build frontend
FROM deps AS frontend-builder
WORKDIR /app

COPY . .

RUN find public/fonts -name "*.ttf" ! -name "*Regular.ttf" ! -name "*Bold.ttf" ! -name "*Italic.ttf" -delete

RUN npm cache clean --force && \
    NODE_OPTIONS="--max-old-space-size=3072" npm run build

# Stage 3: Build backend
FROM deps AS backend-builder
WORKDIR /app

COPY . .

RUN rm -rf node_modules/better-sqlite3/prebuilds && \
    npm run build-release --prefix node_modules/better-sqlite3 && \
    test -f node_modules/better-sqlite3/build/Release/better_sqlite3.node

RUN npm run build:backend

# Stage 4: Download OPKSSH binary for the target platform so the image works offline
FROM node:26-slim AS opkssh-downloader
ARG TARGETARCH
ARG OPKSSH_VERSION=v0.16.0
ARG OPKSSH_SHA256_AMD64=c018c3e7baf98612b923e742dd87be38650bf61e3b755fb2bc90de177568b1bf
ARG OPKSSH_SHA256_ARM64=9dd10c2b6ce99cde18e52c054877ca014134b291fd82afe71741c68db4f83d44
WORKDIR /opkssh

RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*

RUN case "$TARGETARCH" in \
      amd64) OPKSSH_ARCH=amd64; OPKSSH_SHA256="$OPKSSH_SHA256_AMD64" ;; \
      arm64) OPKSSH_ARCH=arm64; OPKSSH_SHA256="$OPKSSH_SHA256_ARM64" ;; \
      *) echo "Unsupported architecture: $TARGETARCH" && exit 1 ;; \
    esac && \
    curl -fSL -o "opkssh-linux-${OPKSSH_ARCH}" \
      "https://github.com/openpubkey/opkssh/releases/download/${OPKSSH_VERSION}/opkssh-linux-${OPKSSH_ARCH}" && \
    echo "$OPKSSH_SHA256  opkssh-linux-${OPKSSH_ARCH}" | sha256sum -c - && \
    chmod 755 "opkssh-linux-${OPKSSH_ARCH}" && \
    echo -n "$OPKSSH_VERSION" > version.txt

# Stage 5: Production dependencies only
FROM node:26-slim AS production-deps
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# The plugin SDK is a workspace package core imports at runtime, so npm ci
# has to see it to link it and install its dependencies.
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY .npmrc ./
COPY vendor ./vendor

COPY scripts/patch-guacamole-lite.cjs scripts/patch-ssh2-agent.cjs ./scripts/

RUN npm ci --omit=dev --ignore-scripts && \
    node scripts/patch-guacamole-lite.cjs && \
    node scripts/patch-ssh2-agent.cjs && \
    rm -rf node_modules/better-sqlite3/prebuilds && \
    npm run build-release --prefix node_modules/better-sqlite3 && \
    test -f node_modules/better-sqlite3/build/Release/better_sqlite3.node && \
    npm rebuild bcryptjs ssh2 && \
    npm cache clean --force

# Stage 6: Final optimized image
FROM node:26-slim
WORKDIR /app

# The release the opkssh-downloader stage baked in, so the plugin trusts that
# binary when the build picks a version other than its pinned one.
ARG OPKSSH_VERSION=v0.16.0
ARG OPKSSH_SHA256_AMD64=c018c3e7baf98612b923e742dd87be38650bf61e3b755fb2bc90de177568b1bf
ARG OPKSSH_SHA256_ARM64=9dd10c2b6ce99cde18e52c054877ca014134b291fd82afe71741c68db4f83d44

ENV DATA_DIR=/app/data \
    OPKSSH_BUNDLED_DIR=/app/opkssh-bundled \
    OPKSSH_VERSION=$OPKSSH_VERSION \
    OPKSSH_SHA256_AMD64=$OPKSSH_SHA256_AMD64 \
    OPKSSH_SHA256_ARM64=$OPKSSH_SHA256_ARM64 \
    PORT=8080 \
    NODE_ENV=production \
    POSTHOG_API_KEY=phc_xM8UznirsFxUkGE68gH4jzeqevf4kh76wGw7Ci7hH2dd

RUN apt-get update && apt-get install -y nginx gettext-base openssl ca-certificates gosu wget && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /app/data /app/uploads /app/nginx /tmp/nginx && \
    chown -R node:node /app /tmp/nginx && \
    chmod 755 /app/data /app/uploads /app/nginx /tmp/nginx

COPY docker/nginx.conf /app/nginx/nginx.conf.template
COPY docker/nginx-https.conf /app/nginx/nginx-https.conf.template

COPY --chown=node:node --from=frontend-builder /app/dist /app/html

COPY --chown=node:node --from=production-deps /app/node_modules /app/node_modules
COPY --chown=node:node --from=backend-builder /app/dist/backend ./dist/backend
# Bundled first-party plugins, resolved as dist/plugins by
# getBundledPluginsDir().
COPY --chown=node:node --from=backend-builder /app/dist/plugins ./dist/plugins
# Target of node_modules/@termix/plugin-sdk, which core and the plugins import.
COPY --chown=node:node --from=backend-builder /app/packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY --chown=node:node --from=backend-builder /app/packages/plugin-sdk/dist ./packages/plugin-sdk/dist
# Pre-baked OPKSSH binary. The opkssh plugin uses it when its checksum
# matches, so an offline install never downloads one.
COPY --chown=node:node --from=opkssh-downloader /opkssh /app/opkssh-bundled
COPY --chown=node:node package.json ./
# Schema for Postgres and MySQL. Unused by the default SQLite deployment, which
# builds its tables at startup instead.
COPY --chown=node:node drizzle ./drizzle

VOLUME ["/app/data"]

EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:30001/health || exit 1

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
