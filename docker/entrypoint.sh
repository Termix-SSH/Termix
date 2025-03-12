#!/bin/bash

# Start NGINX
echo "Starting NGINX..."
nginx -g "daemon off;" &

# Start Node.js backend
echo "Starting Node.js backend..."
node /app/src/backend/ssh.cjs &
node /app/src/backend/database.cjs &

# Keep the container running
wait