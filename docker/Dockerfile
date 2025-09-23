# Stage 1: Install dependencies and build frontend
FROM node:24-alpine AS deps
WORKDIR /app

RUN apk add --no-cache python3 make g++ 

COPY package*.json ./

ENV npm_config_target_platform=linux
ENV npm_config_target_arch=x64
ENV npm_config_target_libc=glibc

RUN npm ci --force --ignore-scripts && \
    npm cache clean --force

# Stage 2: Build frontend
FROM deps AS frontend-builder
WORKDIR /app

COPY . .

RUN npm run build

# Stage 3: Build backend TypeScript
FROM deps AS backend-builder
WORKDIR /app

COPY . .

ENV npm_config_target_platform=linux
ENV npm_config_target_arch=x64
ENV npm_config_target_libc=glibc

RUN npm rebuild better-sqlite3 --force

RUN npm run build:backend

# Stage 4: Production dependencies
FROM node:24-alpine AS production-deps
WORKDIR /app

COPY package*.json ./

ENV npm_config_target_platform=linux
ENV npm_config_target_arch=x64
ENV npm_config_target_libc=glibc

RUN npm ci --omit=dev --ignore-scripts --force && \
    npm cache clean --force

# Stage 5: Build native modules
FROM node:24-alpine AS native-builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ 

COPY package*.json ./

ENV npm_config_target_platform=linux
ENV npm_config_target_arch=x64
ENV npm_config_target_libc=glibc

# Install native modules and compile them properly
RUN npm ci --omit=dev --force && \
    npm rebuild better-sqlite3 bcryptjs --force && \
    npm cache clean --force

# Stage 6: Final image
FROM node:24-alpine
ENV DATA_DIR=/app/data \
    PORT=8080 \
    NODE_ENV=production

RUN apk add --no-cache nginx gettext su-exec openssl && \
    mkdir -p /app/data /app/config /app/ssl && \
    chown -R node:node /app/data /app/config /app/ssl

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx-https.conf /etc/nginx/nginx-https.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
COPY --from=frontend-builder /app/src/locales /usr/share/nginx/html/locales
RUN chown -R nginx:nginx /usr/share/nginx/html

WORKDIR /app

COPY --from=native-builder /app/node_modules /app/node_modules
COPY --from=backend-builder /app/dist/backend ./dist/backend

COPY package.json ./
RUN chown -R node:node /app && \
    chmod 755 /app/config && \
    chmod 755 /app/ssl && \
    chmod 755 /app/data

VOLUME ["/app/data"]

EXPOSE ${PORT} 8081 8082 8083 8084 8085

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
