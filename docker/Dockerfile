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

# Install nginx
RUN apk add --no-cache nginx

# Install MongoDB (from MongoDB's official repositories for Alpine)
RUN echo "https://repo.mongodb.org/apk/alpine/v5.0/main" > /etc/apk/repositories \
    && apk update \
    && apk add --no-cache mongodb-org

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

# MongoDB setup
ENV MONGO_DATA_DIR=/data/db
RUN mkdir -p $MONGO_DATA_DIR && \
    chown -R mongodb:mongodb $MONGO_DATA_DIR

# Expose necessary ports (nginx on 8080, Node.js backend on 8081, MongoDB on 27017)
EXPOSE 8080 8081 27017

# Use an entrypoint script to run services (nginx, MongoDB, and Node backend)
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]