# Stage 1: Install dependencies and build frontend
FROM node:24-alpine AS deps
WORKDIR /app

RUN apk add --no-cache python3 make g++ 

COPY package*.json ./

ENV npm_config_target_platform=linux
ENV npm_config_target_arch=x64
ENV npm_config_target_libc=glibc
ENV NODE_OPTIONS="--max-old-space-size=4096"

RUN npm ci --force --ignore-scripts && \
    npm cache clean --force

# Stage 2: Build frontend
FROM deps AS frontend-builder
WORKDIR /app

COPY . .

ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NODE_ENV=production

RUN npm run build
RUN npm run build:types

# Stage 3: Build backend TypeScript
FROM deps AS backend-builder
WORKDIR /app

COPY . .

ENV npm_config_target_platform=linux
ENV npm_config_target_arch=x64
ENV npm_config_target_libc=glibc
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NODE_ENV=production

RUN npm rebuild better-sqlite3 --force

RUN npm run build:backend

# Stage 4: Production dependencies only
FROM node:24-alpine AS production-deps
WORKDIR /app

RUN apk add --no-cache python3 make g++ 

COPY package*.json ./

ENV npm_config_target_platform=linux
ENV npm_config_target_arch=x64
ENV npm_config_target_libc=glibc
ENV NODE_OPTIONS="--max-old-space-size=4096"

RUN npm ci --only=production --ignore-scripts --force && \
    npm rebuild better-sqlite3 bcryptjs --force && \
    npm cache clean --force

# Stage 5: Final optimized image
FROM node:24-alpine
WORKDIR /app

ENV DATA_DIR=/app/data \
    PORT=8080 \
    NODE_ENV=production

RUN apk add --no-cache nginx gettext su-exec openssl && \
    mkdir -p /app/data && \
    chown -R node:node /app/data

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx-https.conf /etc/nginx/nginx-https.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
COPY --from=frontend-builder /app/src/locales /usr/share/nginx/html/locales
COPY --from=frontend-builder /app/public/fonts /usr/share/nginx/html/fonts
RUN chown -R nginx:nginx /usr/share/nginx/html

COPY --from=production-deps /app/node_modules /app/node_modules
COPY --from=backend-builder /app/dist/backend ./dist/backend

COPY package.json ./
RUN chown -R node:node /app

VOLUME ["/app/data"]

EXPOSE ${PORT} 30001 30002 30003 30004 30005

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
