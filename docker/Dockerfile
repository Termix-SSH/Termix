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
FROM mongo:5
# Install Node.js
RUN apt-get update && apt-get install -y \
    curl \
    nginx \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Configure nginx
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-builder /app/dist /usr/share/nginx/html

# Copy backend
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/src/backend ./src/backend

# Create directories for nginx
RUN mkdir -p /var/log/nginx && \
    mkdir -p /var/lib/nginx && \
    chown -R www-data:www-data /var/log/nginx /var/lib/nginx

# Set environment variables
ENV MONGO_URL=mongodb://localhost:27017/termix

# Expose ports
EXPOSE 8080 8081 8082 27017

# Use a entrypoint script to run all services
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]