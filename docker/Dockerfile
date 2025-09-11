# Stage 1: Install dependencies and build frontend
FROM node:24-alpine AS deps
WORKDIR /app

RUN apk add --no-cache python3 make g++ 

COPY package*.json ./

RUN npm ci --force && \
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

RUN npm run dev:backend

# Stage 4: Production dependencies
FROM node:24-alpine AS production-deps
WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production --ignore-scripts --force && \
    npm cache clean --force

# Stage 5: Build native modules
FROM node:24-alpine AS native-builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ 

COPY package*.json ./

RUN npm ci --only=production bcryptjs better-sqlite3 --force && \
    npm cache clean --force

# Stage 6: Final image
FROM node:24-alpine
ENV DATA_DIR=/app/data \
    PORT=8080 \
    NODE_ENV=production

RUN apk add --no-cache nginx gettext su-exec && \
    mkdir -p /app/data && \
    chown -R node:node /app/data

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
COPY --from=frontend-builder /app/src/locales /usr/share/nginx/html/locales
RUN chown -R nginx:nginx /usr/share/nginx/html

WORKDIR /app

COPY --from=production-deps /app/node_modules /app/node_modules
COPY --from=native-builder /app/node_modules/bcryptjs /app/node_modules/bcryptjs
COPY --from=native-builder /app/node_modules/better-sqlite3 /app/node_modules/better-sqlite3
COPY --from=backend-builder /app/dist/backend ./dist/backend

COPY package.json ./
COPY .env ./.env
RUN chown -R node:node /app

VOLUME ["/app/data"]

EXPOSE ${PORT} 8081 8082 8083 8084 8085

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
