#!/bin/bash
set -e

# Create required directories
mkdir -p /var/run/mongodb /data/db /var/log/{mongodb,supervisor,nginx} /var/lib/nginx
chown -R mongodb:mongodb /var/run/mongodb /data/db /var/log/mongodb
chown -R www-data:www-data /var/log/nginx /var/lib/nginx
chown -R node:node /app

# Start all services using supervisor
exec /usr/bin/supervisord -n -c /etc/supervisor/conf.d/supervisord.conf