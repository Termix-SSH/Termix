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
FROM mongo:4.4-focal

# Install Node.js and nginx
RUN apt-get update && \
    # Install curl and gnupg for Node.js repository
    apt-get install -y --no-install-recommends \
        curl \
        gnupg && \
    # Add Node.js repository and install Node.js and nginx
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        nodejs \
        nginx && \
    # Cleanup
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* \
    rm -rf /var/cache/apt/*

# Configure nginx and copy frontend
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Setup backend with pre-built bcrypt
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts
COPY --from=bcrypt-builder /app/node_modules/bcrypt /app/node_modules/bcrypt
COPY --from=backend-builder /app/src/backend ./src/backend

# Create necessary directories and set permissions
RUN mkdir -p /data/db /var/log/{nginx,mongodb} /var/lib/nginx \
    && chown -R mongodb:mongodb /data/db /var/log/mongodb \
    && chown -R www-data:www-data /var/log/nginx /var/lib/nginx \
    && rm -rf /root/.npm /tmp/*

# Set environment variables
ENV MONGO_URL=mongodb://localhost:27017/termix \
    MONGODB_DATA_DIR=/data/db \
    MONGODB_LOG_DIR=/var/log/mongodb \
    NODE_ENV=production

# Create volume for MongoDB data
VOLUME ["/data/db"]

# Expose ports
EXPOSE 8080 8081 8082 27017

# Copy and set entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]