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

# Stage 3: Final production image (based on node:18-alpine)
FROM node:18-alpine

# Install dependencies
RUN apk add --no-cache \
    nginx \
    bash \
    curl \
    ca-certificates \
    gnupg \
    libcurl \
    && update-ca-certificates

# Configure nginx
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Copy backend
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/src/backend ./src/backend

# Create separate directories for nginx logs and data
RUN mkdir -p /var/log/nginx /var/lib/nginx && \
    chown -R nginx:nginx /var/log/nginx /var/lib/nginx

# Expose necessary ports (8080 for nginx, 8081 for backend, 27017 for MongoDB)
EXPOSE 8080 8081 27017

# Use MongoDB image (version 5)
FROM mongo:5 AS mongodb

# Copy entrypoint script
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Start services (nginx, MongoDB, Node backend)
CMD ["/entrypoint.sh"]