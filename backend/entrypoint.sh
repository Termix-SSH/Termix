#!/bin/sh

# Start the backend server
node /backend/server.js &

# Start nginx in the foreground
exec nginx -g 'daemon off;'