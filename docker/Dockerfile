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

# Install dependencies
RUN apk add --no-cache \
    wget \
    bash \
    curl \
    ca-certificates \
    gnupg \
    bash \
    libcurl \
    && update-ca-certificates

# Configure nginx
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Copy backend
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/src/backend ./src/backend

# Use MongoDB image (version 5)
FROM mongo:5 AS mongodb

# Expose necessary ports
EXPOSE 8080 8081 27017

# Use an entrypoint script to run services (nginx, MongoDB, Node backend)
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]