# Stage 1: Install dependencies
# Base images are pinned by digest, Dependabot refreshes them.
# The builders only produce JS, so they run on the build machine's own arch
# once instead of under QEMU per target. Rolldown hangs under arm64 emulation.
FROM --platform=$BUILDPLATFORM node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY .npmrc ./
COPY vendor ./vendor

COPY scripts/patch-ssh2-agent.cjs ./scripts/

RUN npm ci --ignore-scripts && \
    node scripts/patch-ssh2-agent.cjs && \
    npm cache clean --force

# Stage 2: Build frontend
FROM deps AS frontend-builder
WORKDIR /app

COPY . .

RUN find public/fonts -name "*.ttf" ! -name "*Regular.ttf" ! -name "*Bold.ttf" ! -name "*Italic.ttf" -delete

RUN npm cache clean --force && \
    TERMIX_RUNTIME_BASE_PATH=true NODE_OPTIONS="--max-old-space-size=3072" npm run build

# Stage 3: Build backend
FROM deps AS backend-builder
WORKDIR /app

COPY . .

RUN npm run build:backend:core

# CycloneDX SBOM of the runtime dependencies, shipped in the image.
RUN npm run sbom

# Stage 3b: Stage the bundled plugins for one profile (minimal, standard or
# full, see docker/bundled-plugins.json). Only this stage and the final one
# differ between profiles, so the other stages are built once.
FROM deps AS plugins
WORKDIR /app
ARG PLUGIN_PROFILE=standard
COPY scripts/build-plugins.cjs ./scripts/build-plugins.cjs
COPY scripts/lib/bundled-plugins.cjs ./scripts/lib/bundled-plugins.cjs
COPY docker/bundled-plugins.json ./docker/bundled-plugins.json
# Bundled plugin downloads show in the plugin store, so keep them between builds.
RUN --mount=type=cache,target=/app/node_modules/.cache/termix-bundled-plugins \
    node scripts/build-plugins.cjs --profile "$PLUGIN_PROFILE"

# Stage 4: Download OPKSSH binary for the target platform so the image works offline
FROM node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS opkssh-downloader
ARG TARGETARCH
ARG OPKSSH_VERSION=v0.19.2
ARG OPKSSH_SHA256_AMD64=e799b780d5477e8d986a2e6784773ebb2451d860dd842d23e271baf88aee2da3
ARG OPKSSH_SHA256_ARM64=4f31e47addec3b0beebef7d5d99d11e2d459b9a8e5298077879b2df34d13aedf
WORKDIR /opkssh

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

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
FROM node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS production-deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# The plugin SDK is a workspace package core imports at runtime, so npm ci
# has to see it to link it and install its dependencies.
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY .npmrc ./
COPY vendor ./vendor

COPY scripts/patch-ssh2-agent.cjs ./scripts/

# ssh2's native crypto crashes Node 24 when a cipher is freed, so ssh2 uses
# OpenSSL instead (chacha20-poly1305 is then left out).
RUN npm ci --omit=dev --ignore-scripts && \
    node scripts/patch-ssh2-agent.cjs && \
    rm -rf node_modules/better-sqlite3/prebuilds && \
    npm run build-release --prefix node_modules/better-sqlite3 && \
    test -f node_modules/better-sqlite3/build/Release/better_sqlite3.node && \
    npm rebuild bcryptjs && \
    rm -rf node_modules/ssh2/lib/protocol/crypto/build && \
    npm cache clean --force

# Stage 6: Final optimized image
# The runtime never calls npm, so the copy the base image ships is removed.
FROM node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /app

# The release the opkssh-downloader stage baked in, so the plugin trusts that
# binary when the build picks a version other than its pinned one.
ARG OPKSSH_VERSION=v0.19.2
ARG OPKSSH_SHA256_AMD64=e799b780d5477e8d986a2e6784773ebb2451d860dd842d23e271baf88aee2da3
ARG OPKSSH_SHA256_ARM64=4f31e47addec3b0beebef7d5d99d11e2d459b9a8e5298077879b2df34d13aedf

ENV DATA_DIR=/app/data \
    OPKSSH_BUNDLED_DIR=/app/opkssh-bundled \
    OPKSSH_VERSION=$OPKSSH_VERSION \
    OPKSSH_SHA256_AMD64=$OPKSSH_SHA256_AMD64 \
    OPKSSH_SHA256_ARM64=$OPKSSH_SHA256_ARM64 \
    PORT=8080 \
    NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends nginx gettext-base openssl ca-certificates gosu wget iputils-ping && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /app/data /app/uploads /app/nginx /tmp/nginx && \
    chown -R node:node /app /tmp/nginx && \
    chmod 755 /app/data /app/uploads /app/nginx /tmp/nginx && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY docker/nginx.conf /app/nginx/nginx.conf.template
COPY docker/nginx-https.conf /app/nginx/nginx-https.conf.template

COPY --chown=node:node --from=frontend-builder /app/dist /app/html

COPY --chown=node:node --from=production-deps /app/node_modules /app/node_modules
COPY --chown=node:node --from=backend-builder /app/dist/backend ./dist/backend
# Plugins of the chosen profile pinned in docker/bundled-plugins.json, resolved
# as dist/plugins by getBundledPluginsDir().
COPY --chown=node:node --from=plugins /app/dist/plugins ./dist/plugins
# Target of node_modules/@termix-ssh/plugin-sdk, which core and the plugins import.
COPY --chown=node:node --from=backend-builder /app/packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY --chown=node:node --from=backend-builder /app/packages/plugin-sdk/dist ./packages/plugin-sdk/dist
# Pre-baked OPKSSH binary. The opkssh plugin uses it when its checksum
# matches, so an offline install never downloads one.
COPY --chown=node:node --from=opkssh-downloader /opkssh /app/opkssh-bundled
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=backend-builder /app/sbom.cdx.json ./sbom.cdx.json
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
