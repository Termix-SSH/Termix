# Stage 1: Build frontend
FROM --platform=$BUILDPLATFORM node:18 AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Build backend
FROM --platform=$BUILDPLATFORM node:18 AS backend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY src/backend/ ./src/backend/

# Stage 3: Final production image
FROM mongo:4.4
# Install Node.js
RUN apt-get update && apt-get install -y \
    curl \
    nginx \
    python3 \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Configure nginx
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Setup backend
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=backend-builder /app/src/backend ./src/backend

# Create directories for MongoDB and nginx
RUN mkdir -p /data/db && \
    mkdir -p /var/log/nginx && \
    mkdir -p /var/lib/nginx && \
    mkdir -p /var/log/mongodb && \
    chown -R mongodb:mongodb /data/db /var/log/mongodb && \
    chown -R www-data:www-data /var/log/nginx /var/lib/nginx

# Set environment variables
ENV MONGO_URL=mongodb://localhost:27017/termix \
    MONGODB_DATA_DIR=/data/db \
    MONGODB_LOG_DIR=/var/log/mongodb

# Create volume for MongoDB data
VOLUME ["/data/db"]

# Expose ports
EXPOSE 8080 8081 8082 27017

# Use a entrypoint script to run all services
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]