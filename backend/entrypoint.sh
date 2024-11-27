#!/bin/sh

# Start the backend server in the background
node /backend/server.js &

# Start Nginx in the foreground
nginx -g "daemon off;"