#!/bin/bash

# Start MongoDB (it should already be running from the mongo:5 container)
echo "Starting MongoDB..."
# MongoDB will run in a separate container, no need to start it here.

# Start NGINX
echo "Starting NGINX..."
nginx -g "daemon off;" &

# Start Node.js backend
echo "Starting Node.js backend..."
node /app/src/backend/ssh.cjs &
node /app/src/backend/database.cjs &

# Keep the container running
wait