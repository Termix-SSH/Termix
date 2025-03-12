#!/bin/sh
# Start MongoDB in the background before the delay
mongod --fork --logpath /var/log/mongodb.log --bind_ip 0.0.0.0

# Delay for 5 seconds to ensure MongoDB has started
sleep 5

# Start NGINX in the background
nginx -g "daemon off;" &

# Start Node.js backend
node src/backend/ssh.cjs &
node src/backend/database.cjs &

# Wait for processes to keep the container running
wait