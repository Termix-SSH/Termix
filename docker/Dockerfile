# Build frontend
FROM ubuntu:20.04 AS frontend-build
WORKDIR /app
# Install Node.js and npm
RUN apt-get update && apt-get install -y \
    curl \
    gnupg2 \
    lsb-release \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean
COPY frontend/package*.json ./frontend/
RUN npm --prefix frontend install
COPY frontend/ ./frontend/
RUN npm --prefix frontend run build

# Build backend
FROM ubuntu:20.04 AS backend-build
WORKDIR /backend
# Install Node.js and npm
RUN apt-get update && apt-get install -y \
    curl \
    gnupg2 \
    lsb-release \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean
COPY backend/package*.json ./
RUN npm install
COPY backend/ .

# Production image
FROM ubuntu:20.04
# Install Node.js and nginx
RUN apt-get update && apt-get install -y \
    curl \
    nginx \
    gnupg2 \
    lsb-release \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean

# Copy frontend static files to nginx folder
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
# Copy backend application
COPY --from=backend-build /backend /backend
# Copy entrypoint script
COPY --from=backend-build /backend/entrypoint.sh /backend/entrypoint.sh

# Make entrypoint.sh executable
RUN chmod +x /backend/entrypoint.sh

# Use entrypoint script to start backend and frontend servers
ENTRYPOINT ["/backend/entrypoint.sh"]