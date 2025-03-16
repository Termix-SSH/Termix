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
RUN apk add --no-cache nginx mongodb~=5

# Configure nginx
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Copy backend
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/src/backend ./src/backend

# Create persistent directories for MongoDB and nginx
RUN mkdir -p /usr/local/mongodb/data/db && \
    mkdir -p /var/log/nginx && \
    mkdir -p /var/lib/nginx && \
    mkdir -p /var/log/mongodb && \
    chown -R nginx:nginx /var/log/nginx /var/lib/nginx && \
    chown -R mongodb:mongodb /usr/local/mongodb/data/db /var/log/mongodb

# Set environment variables
ENV MONGO_URL=mongodb://localhost:27017/termix \
    MONGODB_DATA_DIR=/usr/local/mongodb/data/db \
    MONGODB_LOG_DIR=/var/log/mongodb

VOLUME ["/usr/local/mongodb/data/db"]

# Expose ports
EXPOSE 8080 8081 8082 27017

# Use a entrypoint script to run all services
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]