# Stage 1: Build frontend
FROM --platform=$BUILDPLATFORM node:18-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Build backend
FROM --platform=$BUILDPLATFORM node:18-alpine AS backend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY src/backend/ ./src/backend/

# Stage 3: Install MongoDB on Debian-based image
FROM debian:bullseye AS mongodb-builder

# Install dependencies and MongoDB
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    lsb-release \
    sudo && \
    wget -qO - https://www.mongodb.org/static/pgp/server-5.0.asc | apt-key add - && \
    echo "deb [ arch=amd64 ] https://repo.mongodb.org/apt/debian $(lsb_release -c | awk '{print $2}')/mongodb-org/5.0 main" > /etc/apt/sources.list.d/mongodb-org-5.0.list && \
    apt-get update && apt-get install -y mongodb-org && \
    rm -rf /var/lib/apt/lists/*

# Stage 4: Final production image
FROM node:18-alpine

# Install Nginx and required packages
RUN apk add --no-cache nginx bash

# Create mongodb user and group in the final image
RUN addgroup -g 1001 mongodb && adduser -D -u 1001 -G mongodb mongodb

# Install MongoDB binaries from mongodb-builder
COPY --from=mongodb-builder /usr/bin/mongod /usr/bin/mongod
COPY --from=mongodb-builder /usr/bin/mongo /usr/bin/mongo

# Configure nginx
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Copy backend code
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/src/backend ./src/backend

# Set permissions and prepare directories for MongoDB
ENV MONGO_DATA_DIR=/data/db
RUN mkdir -p $MONGO_DATA_DIR && \
    chown -R mongodb:mongodb $MONGO_DATA_DIR

# Expose necessary ports
EXPOSE 8080 8081 8082 27017

# Use an entrypoint script to start services (MongoDB, Nginx, and Node backend)
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Switch to a non-root user for security
USER mongodb

# Default command to start the services
CMD ["/entrypoint.sh"]