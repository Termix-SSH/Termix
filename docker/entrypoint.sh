#!/bin/sh
set -e

export PORT=${PORT:-8080}
echo "Configuring web UI to run on port: $PORT"

envsubst '${PORT}' < /etc/nginx/nginx.conf > /etc/nginx/nginx.conf.tmp
mv /etc/nginx/nginx.conf.tmp /etc/nginx/nginx.conf

mkdir -p /app/data
chown -R node:node /app/data
chmod 755 /app/data

echo "Starting nginx..."
nginx

# Start backend services
echo "Starting backend services..."
cd /app
export NODE_ENV=production

if command -v su-exec > /dev/null 2>&1; then
  su-exec node node src/backend/starter.cjs
else
  su -s /bin/sh node -c "node src/backend/starter.cjs"
fi

echo "All services started"

tail -f /dev/null