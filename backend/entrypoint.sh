#!/bin/sh

# Start the backend server
node /backend/server.js &

# Start nginx in the foreground
nginx -g 'daemon off;'