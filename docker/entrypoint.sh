#!/bin/sh
set -e

export PORT=${PORT:-8080}
export ENABLE_SSL=${ENABLE_SSL:-false}
export SSL_PORT=${SSL_PORT:-8443}
export SSL_CERT_PATH=${SSL_CERT_PATH:-/app/ssl/termix.crt}
export SSL_KEY_PATH=${SSL_KEY_PATH:-/app/ssl/termix.key}

echo "Configuring web UI to run on port: $PORT"

# Choose nginx configuration based on SSL setting
# Default: HTTP-only for easy setup
# Set ENABLE_SSL=true to use HTTPS with automatic redirect
if [ "$ENABLE_SSL" = "true" ]; then
    echo "SSL enabled - using HTTPS configuration with redirect"
    NGINX_CONF_SOURCE="/etc/nginx/nginx-https.conf"
else
    echo "SSL disabled - using HTTP-only configuration (default)"
    NGINX_CONF_SOURCE="/etc/nginx/nginx.conf"
fi

envsubst '${PORT} ${SSL_PORT} ${SSL_CERT_PATH} ${SSL_KEY_PATH}' < $NGINX_CONF_SOURCE > /etc/nginx/nginx.conf.tmp
mv /etc/nginx/nginx.conf.tmp /etc/nginx/nginx.conf

mkdir -p /app/data
chown -R node:node /app/data
chmod 755 /app/data

echo "Starting nginx..."
nginx

echo "Starting backend services..."
cd /app
export NODE_ENV=production

if command -v su-exec > /dev/null 2>&1; then
  su-exec node node dist/backend/backend/starter.js
else
  su -s /bin/sh node -c "node dist/backend/backend/starter.js"
fi

echo "All services started"

tail -f /dev/null