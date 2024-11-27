# Build frontend
FROM node:18-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN npm --prefix frontend install
COPY frontend/ ./frontend/
RUN npm --prefix frontend run build

# Build backend
FROM node:18-alpine AS backend-build
WORKDIR /backend
COPY backend/package*.json ./
RUN npm install
COPY backend/ .

FROM nginx:alpine

RUN apk add --no-cache nodejs npm
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
COPY --from=backend-build /backend /backend
COPY --from=backend-build /backend/entrypoint.sh /backend/entrypoint.sh

RUN chmod +x /backend/entrypoint.sh

ENTRYPOINT ["/backend/entrypoint.sh"]

EXPOSE 80
EXPOSE 3001