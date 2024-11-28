#!/bin/sh

# Inject environment variables into env.js
envsubst < /usr/share/nginx/html/env.template.js > /usr/share/nginx/html/env.js

# Start the backend server
node /backend/server.js &

# Start nginx in the foreground
exec nginx -g 'daemon off;'