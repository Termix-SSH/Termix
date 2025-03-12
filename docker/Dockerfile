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

# Stage 3: Build MongoDB on Debian-based image
FROM debian:bullseye AS mongodb-builder
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    lsb-release \
    sudo \
    shadow && \
    wget -qO - https://www.mongodb.org/static/pgp/server-5.0.asc | apt-key add - && \
    echo "deb [ arch=amd64 ] https://repo.mongodb.org/apt/debian $(lsb_release -c | awk '{print $2}')/mongodb-org/5.0 main" > /etc/apt/sources.list.d/mongodb-org-5.0.list && \
    apt-get update && apt-get install -y mongodb-org && \
    rm -rf /var/lib/apt/lists/*

# Create mongodb user and group in the final image
RUN getent group mongodb || groupadd -r mongodb && \
    getent passwd mongodb || useradd -r -g mongodb mongodb

# Stage 4: Final production image
FROM node:18-alpine

# Install nginx
RUN apk add --no-cache nginx bash

# Create mongodb user and group in the final image
RUN getent group mongodb || groupadd -r mongodb && \
    getent passwd mongodb || useradd -r -g mongodb mongodb

# Install MongoDB from the mongodb-builder stage
COPY --from=mongodb-builder /usr/bin/mongod /usr/bin/mongod
COPY --from=mongodb-builder /usr/bin/mongo /usr/bin/mongo

# Configure nginx
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Copy backend
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/src/backend ./src/backend

# Create necessary directories for MongoDB and set proper permissions
ENV MONGO_DATA_DIR=/data/db
RUN mkdir -p $MONGO_DATA_DIR && \
    chown -R mongodb:mongodb $MONGO_DATA_DIR

# Expose necessary ports
EXPOSE 8080 8081 8082 27017

# Use an entrypoint script to run services (nginx, MongoDB, and Node backend)
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]