#!/bin/bash
set -ex

# Create required directories
mkdir -p /var/run/{mongodb,supervisor} /data/db /var/log/{mongodb,supervisor,nginx} /var/lib/nginx
chown -R mongodb:mongodb /var/run/mongodb /data/db /var/log/mongodb
chown -R www-data:www-data /var/log/nginx /var/lib/nginx /usr/share/nginx/html
chown -R node:node /app

# Ensure MongoDB data directory has correct permissions
chmod 755 /data/db

# Check if mongod is available
which mongod || echo "mongod not found in PATH: $PATH"

# Start supervisor with proper environment
export NODE_ENV=production
export MONGO_URL=mongodb://localhost:27017/termix
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Start all services using supervisor
exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/supervisord.conf