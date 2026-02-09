# Stage 1: Install dependencies
FROM node:22-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN rm -rf node_modules package-lock.json && \
    npm install --ignore-scripts --force && \
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

RUN npm rebuild better-sqlite3 --force

RUN npm run build:backend

# Stage 4: Production dependencies only
FROM node:22-slim AS production-deps
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --only=production --ignore-scripts --force && \
    npm rebuild better-sqlite3 bcryptjs --force && \
    npm cache clean --force

# Stage 5: Final optimized image
FROM node:22-slim
WORKDIR /app

ENV DATA_DIR=/app/data \
    PORT=8080 \
    NODE_ENV=production

RUN apt-get update && apt-get install -y nginx gettext-base openssl ca-certificates gosu && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /app/data /app/uploads /app/data/.opk /app/nginx /app/nginx/logs /app/nginx/cache /app/nginx/client_body && \
    chown -R node:node /app && \
    chmod 755 /app/data /app/uploads /app/data/.opk /app/nginx && \
    touch /app/nginx/nginx.conf && \
    chown node:node /app/nginx/nginx.conf

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

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:30001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
