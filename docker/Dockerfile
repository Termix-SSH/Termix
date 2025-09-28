# Stage 1: Install dependencies and build frontend
FROM node:22-bullseye AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/* 

COPY package*.json ./

ENV npm_config_target_platform=linux
ENV npm_config_target_arch=x64
ENV npm_config_target_libc=glibc

RUN npm ci --force --ignore-scripts && \
    npm install @rollup/rollup-linux-x64-gnu @esbuild/linux-x64 --force && \
    npm cache clean --force

# Stage 2: Build frontend
FROM deps AS frontend-builder
WORKDIR /app

COPY . .

RUN npm install @rollup/rollup-linux-x64-gnu @esbuild/linux-x64 --force && \
    npm cache clean --force && \
    npm run build

# Stage 3: Build backend TypeScript
FROM deps AS backend-builder
WORKDIR /app

COPY . .

ENV npm_config_target_platform=linux
ENV npm_config_target_arch=x64
ENV npm_config_target_libc=glibc

RUN npm rebuild better-sqlite3 --force

RUN npm run build:backend

# Stage 4: Production dependencies only
FROM node:22-bullseye AS production-deps
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

ENV npm_config_target_platform=linux
ENV npm_config_target_arch=x64
ENV npm_config_target_libc=glibc

RUN npm ci --only=production --ignore-scripts --force && \
    npm rebuild better-sqlite3 bcryptjs --force && \
    npm cache clean --force

# Stage 5: Final optimized image
FROM node:22-bullseye
WORKDIR /app

ENV DATA_DIR=/app/data \
    PORT=8080 \
    NODE_ENV=production

RUN apt-get update && apt-get install -y nginx gettext-base openssl && \
    rm -rf /var/lib/apt/lists/* && \
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