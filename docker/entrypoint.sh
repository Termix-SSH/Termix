#!/bin/sh

# Start NGINX in background
nginx -g "daemon off;" &

# Start Node.js backend
node src/backend/ssh.cjs
node src/backend/database.cjs

# Keep container running
wait