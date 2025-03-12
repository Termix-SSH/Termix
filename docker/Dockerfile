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

# Stage 3: Final production image
FROM node:18-alpine

# Install nginx and required dependencies for MongoDB
RUN apk add --no-cache nginx \
    && apk add --no-cache \
    curl \
    bash \
    ca-certificates \
    && curl -fsSL https://repo.mongodb.org/apk/alpine/v5.0/main/x86_64/mongodb-org-5.0.7-alpine3.13.tar.gz -o mongodb.tar.gz \
    && tar -xvzf mongodb.tar.gz -C /usr/local \
    && rm mongodb.tar.gz \
    && ln -s /usr/local/mongodb-org-5.0.7/bin/* /usr/local/bin/ \
    && mkdir -p /data/db \
    && mkdir -p /var/log/mongodb \
    && chown -R mongodb:mongodb /data/db /var/log/mongodb

# Configure nginx
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Copy backend
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/src/backend ./src/backend

# Create necessary directories for nginx and MongoDB
RUN mkdir -p /var/log/nginx && \
    mkdir -p /var/lib/nginx && \
    chown -R nginx:nginx /var/log/nginx /var/lib/nginx

# Expose necessary ports
EXPOSE 8080 8081 27017

# Use an entrypoint script to run services (nginx, MongoDB, Node backend)
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]