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
RUN npm ci --force && \
    npm cache clean --force
COPY src/backend/ ./src/backend/

# Stage 3: Build bcrypt for Ubuntu
FROM ubuntu:focal AS bcrypt-builder
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
    npm ci --only=production bcrypt --force && \
    npm cache clean --force && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/* /tmp/*

# Final stage
FROM ubuntu:focal
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_VERSION=18.x \
    MONGO_VERSION=4.4.24 \
    MONGO_URL=mongodb://localhost:27017/termix \
    MONGODB_DATA_DIR=/data/db \
    MONGODB_LOG_DIR=/var/log/mongodb \
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Create users and set up directories first
RUN groupadd -r mongodb && useradd -r -g mongodb mongodb && \
    groupadd -r node && useradd -r -g node -m node && \
    mkdir -p /data/db /var/log/mongodb /var/run/mongodb /tmp/mongodb && \
    chown -R mongodb:mongodb /data/db /var/log/mongodb /var/run/mongodb /tmp/mongodb && \
    chmod 755 /data/db /var/log/mongodb /var/run/mongodb /tmp/mongodb

# Install all dependencies in one layer
RUN rm -f /var/lib/apt/lists/lock /var/cache/apt/archives/lock /var/lib/dpkg/lock* && \
    apt-get clean && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        gnupg \
        gosu \
        nginx-light \
        wget \
        curl && \
    wget -qO - https://www.mongodb.org/static/pgp/server-4.4.asc | apt-key add - && \
    echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/4.4 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-4.4.list && \
    wget -qO- https://deb.nodesource.com/setup_${NODE_VERSION} | bash - && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        nodejs \
        mongodb-org-server=${MONGO_VERSION} \
        mongodb-org-shell=${MONGO_VERSION} && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/* /tmp/*

# Setup nginx and frontend
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
RUN chown -R www-data:www-data /usr/share/nginx/html && \
    mkdir -p /var/log/nginx && \
    chown -R www-data:www-data /var/log/nginx && \
    chmod 755 /var/log/nginx

# Setup backend
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --force && \
    npm cache clean --force && \
    rm -rf /tmp/*
COPY --from=bcrypt-builder /app/node_modules/bcrypt /app/node_modules/bcrypt
COPY --from=backend-builder /app/src/backend ./src/backend
RUN chown -R node:node /app && \
    chmod -R 755 /app

VOLUME ["/data/db", "/var/log/mongodb"]
EXPOSE 8080 8081 8082 27017

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]