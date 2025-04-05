#!/bin/bash
set -e

# Create required directories and set permissions
mkdir -p /app/data
chown -R node:node /app/data
chmod 755 /app/data

echo "Starting nginx..."
nginx

# Start backend services
echo "Starting backend services..."
cd /app
export NODE_ENV=production

# Make sure data directory is available
if [ ! -d "/app/data" ]; then
    mkdir -p /app/data
    chown -R node:node /app/data
fi

# Start SSH service
su -s /bin/bash node -c "node src/backend/ssh.cjs" &

# Start database service
su -s /bin/bash node -c "node src/backend/database.cjs" &

echo "All services started"

# Keep container running
tail -f /var/log/nginx/access.log