# Build frontend
FROM ubuntu:20.04 AS frontend-build
WORKDIR /app
# Install Node.js
RUN apt-get update && apt-get install -y curl && \
    curl -sL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*
COPY frontend/package*.json ./frontend/
RUN npm --prefix frontend install
COPY frontend/ ./frontend/
RUN npm --prefix frontend run build

# Build backend
FROM ubuntu:20.04 AS backend-build
WORKDIR /backend
# Install Node.js
RUN apt-get update && apt-get install -y curl && \
    curl -sL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
RUN npm install
COPY backend/ .

# Production image
FROM ubuntu:20.04
# Install Node.js and Nginx
RUN apt-get update && apt-get install -y curl nginx && \
    curl -sL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*
# Copy frontend and backend
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
COPY --from=backend-build /backend /backend
# Copy entrypoint script
COPY backend/entrypoint.sh /backend/entrypoint.sh
RUN chmod +x /backend/entrypoint.sh
# Start backend and frontend servers using entrypoint script
CMD ["/backend/entrypoint.sh"]