# Termix Docker Image with Auto-SSL Configuration
FROM node:18-slim

# Install OpenSSL for SSL certificate generation
RUN apt-get update && apt-get install -y \
    openssl \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application source
COPY . .

# Build the application
RUN npm run build:backend

# Create directories for SSL certificates and data
RUN mkdir -p /app/ssl /app/data

# Set proper permissions
RUN chown -R node:node /app

# Switch to non-root user
USER node

# Expose ports
EXPOSE 8080 8443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f -k https://localhost:8443/health 2>/dev/null || \
      curl -f http://localhost:8080/health 2>/dev/null || \
      exit 1

# Default command - SSL is auto-configured during startup
CMD ["npm", "start"]