# Stage 1: Install dependencies
# Base images are pinned by digest, Dependabot refreshes them. With
# SOURCE_DATE_EPOCH set (the commit time), apt reads the Debian snapshot from
# that moment, so a rebuild of the same commit gets the same packages.
# The builders only produce JS, so they run on the build machine's own arch
# once instead of under QEMU per target. Rolldown hangs under arm64 emulation.
FROM --platform=$BUILDPLATFORM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS deps
WORKDIR /app

ARG SOURCE_DATE_EPOCH
RUN if [ -n "$SOURCE_DATE_EPOCH" ]; then cp /etc/apt/sources.list.d/debian.sources /tmp/debian.sources && snap=$(date -u -d "@$SOURCE_DATE_EPOCH" +%Y%m%dT%H%M%SZ) && sed -i -e "s|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/$snap|" -e "s|http://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/$snap|" /etc/apt/sources.list.d/debian.sources; fi && \
    apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Retries=5 update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* && \
    if [ -f /tmp/debian.sources ]; then mv /tmp/debian.sources /etc/apt/sources.list.d/debian.sources; fi

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
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS opkssh-downloader
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
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS production-deps
WORKDIR /app

ARG SOURCE_DATE_EPOCH
RUN if [ -n "$SOURCE_DATE_EPOCH" ]; then cp /etc/apt/sources.list.d/debian.sources /tmp/debian.sources && snap=$(date -u -d "@$SOURCE_DATE_EPOCH" +%Y%m%dT%H%M%SZ) && sed -i -e "s|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/$snap|" -e "s|http://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/$snap|" /etc/apt/sources.list.d/debian.sources; fi && \
    apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Retries=5 update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* && \
    if [ -f /tmp/debian.sources ]; then mv /tmp/debian.sources /etc/apt/sources.list.d/debian.sources; fi

COPY package*.json ./
# The plugin SDK is a workspace package core imports at runtime, so npm ci
# has to see it to link it and install its dependencies.
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY .npmrc ./
COPY vendor ./vendor

COPY scripts/patch-ssh2-agent.cjs ./scripts/

# ssh2's native crypto crashes Node 24 and later when a cipher is freed, so ssh2 uses
# OpenSSL instead (chacha20-poly1305 is then left out).
RUN npm ci --omit=dev --ignore-scripts && \
    node scripts/patch-ssh2-agent.cjs && \
    rm -rf node_modules/better-sqlite3/prebuilds && \
    npm run build-release --prefix node_modules/better-sqlite3 && \
    test -f node_modules/better-sqlite3/build/Release/better_sqlite3.node && \
    rm -rf node_modules/better-sqlite3/build/Release/obj.target node_modules/better-sqlite3/build/Release/.deps && \
    npm rebuild bcryptjs && \
    rm -rf node_modules/ssh2/lib/protocol/crypto/build && \
    npm cache clean --force

# Stage 6: Final optimized image
# The runtime never calls npm, so the copy the base image ships is removed.
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc
WORKDIR /app

# The release the opkssh-downloader stage baked in, so the plugin trusts that
# binary when the build picks a version other than its pinned one.
ARG OPKSSH_VERSION=v0.19.2
ARG OPKSSH_SHA256_AMD64=e799b780d5477e8d986a2e6784773ebb2451d860dd842d23e271baf88aee2da3
ARG OPKSSH_SHA256_ARM64=4f31e47addec3b0beebef7d5d99d11e2d459b9a8e5298077879b2df34d13aedf

# TERMIX_FRAME_DIR: the page plugin views run in, served by Node from the UI
# build nginx also serves, so it is not copied twice.
ENV DATA_DIR=/app/data \
    TERMIX_FRAME_DIR=/app/html/frame \
    OPKSSH_BUNDLED_DIR=/app/opkssh-bundled \
    OPKSSH_VERSION=$OPKSSH_VERSION \
    OPKSSH_SHA256_AMD64=$OPKSSH_SHA256_AMD64 \
    OPKSSH_SHA256_ARM64=$OPKSSH_SHA256_ARM64 \
    PORT=8080 \
    NODE_ENV=production

# nftables: plugin firewall rules when the admin adds NET_ADMIN.
ARG SOURCE_DATE_EPOCH
RUN if [ -n "$SOURCE_DATE_EPOCH" ]; then cp /etc/apt/sources.list.d/debian.sources /tmp/debian.sources && snap=$(date -u -d "@$SOURCE_DATE_EPOCH" +%Y%m%dT%H%M%SZ) && sed -i -e "s|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/$snap|" -e "s|http://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/$snap|" /etc/apt/sources.list.d/debian.sources; fi && \
    apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Retries=5 update && apt-get install -y --no-install-recommends nginx gettext-base openssl ca-certificates gosu iputils-ping nftables && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    if [ -f /tmp/debian.sources ]; then mv /tmp/debian.sources /etc/apt/sources.list.d/debian.sources; fi && \
    # Logs and caches that hold build times, left out so rebuilds match.
    rm -rf /var/log/apt /var/log/dpkg.log /var/log/alternatives.log /var/cache/ldconfig/aux-cache \
      /var/cache/debconf/*-old /var/lib/dpkg/*-old && \
    # Plain copy drops ping's file capability, so it uses unprivileged ICMP
    # sockets (net.ipv4.ping_group_range) and works with every capability
    # dropped and no-new-privileges set.
    cp /usr/bin/ping /usr/bin/ping.plain && chmod 755 /usr/bin/ping.plain && \
    mv /usr/bin/ping.plain /usr/bin/ping && \
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

# Node is already in the image, so no curl or wget is needed.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:30001/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/termix-recover.sh /usr/local/bin/termix-recover
RUN chmod +x /entrypoint.sh /usr/local/bin/termix-recover

CMD ["/entrypoint.sh"]
