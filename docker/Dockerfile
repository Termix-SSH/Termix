# Stage 1: Build frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --force && \
    npm cache clean --force
COPY . .
RUN npm run build

# Stage 2: Build backend
FROM node:18-alpine AS backend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --force && \
    npm cache clean --force
COPY src/backend/ ./src/backend/

# Stage 3: Build native modules for Ubuntu
FROM ubuntu:focal AS native-builder
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_VERSION=18.x
WORKDIR /app
COPY package*.json ./
RUN rm -f /var/lib/apt/lists/lock /var/cache/apt/archives/lock /var/lib/dpkg/lock* && \
    apt-get clean && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        wget \
        ca-certificates \
        gnupg && \
    wget -qO- https://deb.nodesource.com/setup_${NODE_VERSION} | bash - && \
    apt-get update && \
    apt-get install -y nodejs && \
    npm ci --only=production bcrypt better-sqlite3 --force && \
    npm cache clean --force && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/* /tmp/*

# Final stage
FROM ubuntu:focal
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_VERSION=18.x \
    DATA_DIR=/app/data \
    PORT=8080 \
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Create node user
RUN groupadd -r node && useradd -r -g node -m node

# Install all dependencies in one layer
RUN rm -f /var/lib/apt/lists/lock /var/cache/apt/archives/lock /var/lib/dpkg/lock* && \
    apt-get clean && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        gnupg \
        nginx-light \
        wget \
        gettext-base && \
    # Add NodeJS repository
    wget -qO- https://deb.nodesource.com/setup_${NODE_VERSION} | bash - && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/* /tmp/* && \
    mkdir -p /app/data && \
    chown -R node:node /app/data

# Setup nginx and frontend
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
RUN chown -R www-data:www-data /usr/share/nginx/html

# Setup backend
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts --force && \
    npm cache clean --force && \
    rm -rf /tmp/*
COPY --from=native-builder /app/node_modules/bcrypt /app/node_modules/bcrypt
COPY --from=native-builder /app/node_modules/better-sqlite3 /app/node_modules/better-sqlite3
COPY --from=backend-builder /app/src/backend ./src/backend
RUN chown -R node:node /app

VOLUME ["/app/data"]
# Expose ports - web (dynamic port from ENV), ssh backend, db backend
EXPOSE ${PORT} 8081 8082

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]