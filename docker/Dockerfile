# Stage 1: Build frontend
FROM --platform=$BUILDPLATFORM node:18-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# Stage 2: Build backend
FROM --platform=$BUILDPLATFORM node:18-alpine AS backend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src/backend/ ./src/backend/

# Stage 3: Build bcrypt for the target platform
FROM --platform=$TARGETPLATFORM node:18-alpine AS bcrypt-builder
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ \
    && npm ci --only=production bcrypt \
    && rm -rf /root/.npm

# Stage 4: Final production image
FROM ubuntu:20.04 as base

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_VERSION=18.x \
    MONGO_VERSION=4.4.24 \
    MONGO_URL=mongodb://localhost:27017/termix \
    MONGODB_DATA_DIR=/data/db \
    MONGODB_LOG_DIR=/var/log/mongodb \
    NODE_ENV=production

# Create users first
RUN groupadd -r mongodb && useradd -r -g mongodb mongodb \
    && groupadd -r node && useradd -r -g node -m node

# Install all dependencies in one layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        wget gnupg ca-certificates gosu \
        nginx supervisor && \
    # Add MongoDB repo
    wget -qO - https://www.mongodb.org/static/pgp/server-4.4.asc | apt-key add - && \
    echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/4.4 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-4.4.list && \
    # Add Node.js repo
    wget -qO- https://deb.nodesource.com/setup_${NODE_VERSION} | bash - && \
    # Install Node.js and MongoDB
    apt-get update && \
    apt-get install -y --no-install-recommends \
        nodejs \
        mongodb-org=${MONGO_VERSION} \
        mongodb-org-server=${MONGO_VERSION} \
        mongodb-org-shell=${MONGO_VERSION} \
        mongodb-org-mongos=${MONGO_VERSION} \
        mongodb-org-tools=${MONGO_VERSION} && \
    # Cleanup
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/* /root/.npm /tmp/* && \
    # Create necessary directories
    mkdir -p /data/db /var/log/{nginx,mongodb} /var/lib/nginx /var/run/mongodb && \
    chown -R mongodb:mongodb /data/db /var/log/mongodb /var/run/mongodb && \
    chown -R www-data:www-data /var/log/nginx /var/lib/nginx

# Configure nginx and copy frontend
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html
RUN chown -R www-data:www-data /usr/share/nginx/html

# Setup backend with pre-built bcrypt
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts
COPY --from=bcrypt-builder /app/node_modules/bcrypt /app/node_modules/bcrypt
COPY --from=backend-builder /app/src/backend ./src/backend
RUN chown -R node:node /app

# Create volume for MongoDB data
VOLUME ["/data/db"]

# Expose ports
EXPOSE 8080 8081 8082 27017

# Copy and set entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]