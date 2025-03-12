#!/bin/sh

# Start MongoDB in the background
echo "Starting MongoDB..."
mongod --fork --logpath /var/log/mongodb.log --bind_ip 0.0.0.0 --dbpath /data/db

# Wait for MongoDB to fully start (you can adjust the sleep if needed)
sleep 5

# Start NGINX in the background
echo "Starting Nginx..."
nginx -g "daemon off;" &

# Start Node.js backend (adjust as needed for your backend setup)
echo "Starting Node.js backend..."
node /app/src/backend/ssh.cjs &
node /app/src/backend/database.cjs &

# Keep the container running
wait