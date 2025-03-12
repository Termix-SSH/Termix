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

# Install nginx and MongoDB
RUN apk add --no-cache nginx mongodb

# Configure nginx
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Copy backend
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/src/backend ./src/backend

# Create necessary directories
RUN mkdir -p /var/log/nginx && \
    mkdir -p /var/lib/nginx && \
    chown -R nginx:nginx /var/log/nginx /var/lib/nginx

# MongoDB setup
ENV MONGO_DATA_DIR=/data/db
RUN mkdir -p $MONGO_DATA_DIR && \
    chown -R mongodb:mongodb $MONGO_DATA_DIR

# Expose necessary ports
EXPOSE 8080 8081 8082 27017

# Use an entrypoint script to run services (nginx, MongoDB, and Node backend)
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]