# Stage 1: Install dependencies
FROM node:24-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY .npmrc ./
COPY vendor ./vendor

RUN npm ci --ignore-scripts && \
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

RUN npm rebuild better-sqlite3

RUN npm run build:backend

# Stage 4: Production dependencies only
FROM node:24-slim AS production-deps
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY .npmrc ./
COPY vendor ./vendor

RUN npm ci --omit=dev --ignore-scripts && \
    npm rebuild better-sqlite3 bcryptjs && \
    npm cache clean --force

# Stage 5: Final optimized image
FROM node:24-slim
WORKDIR /app

ENV DATA_DIR=/app/data \
    PORT=8080 \
    NODE_ENV=production

RUN apt-get update && apt-get install -y nginx gettext-base openssl ca-certificates gosu wget && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /app/data /app/uploads /app/data/.opk /app/nginx /tmp/nginx && \
    chown -R node:node /app /tmp/nginx && \
    chmod 755 /app/data /app/uploads /app/data/.opk /app/nginx /tmp/nginx

COPY docker/nginx.conf /app/nginx/nginx.conf.template
COPY docker/nginx-https.conf /app/nginx/nginx-https.conf.template

COPY --chown=node:node --from=frontend-builder /app/dist /app/html
COPY --chown=node:node --from=frontend-builder /app/src/locales /app/html/locales
COPY --chown=node:node --from=frontend-builder /app/public/fonts /app/html/fonts

COPY --chown=node:node --from=production-deps /app/node_modules /app/node_modules
COPY --chown=node:node --from=backend-builder /app/dist/backend ./dist/backend
COPY --chown=node:node package.json ./

VOLUME ["/app/data"]

EXPOSE ${PORT} 30001 30002 30003 30004 30005 30006

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:30001/health || exit 1

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
