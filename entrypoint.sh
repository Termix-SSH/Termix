#!/bin/sh

# Start the backend server in the background
node server.js &

# Start Nginx in the foreground
nginx -g "daemon off;"