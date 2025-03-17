#!/bin/bash
set -e

# Create required directories and set permissions
mkdir -p /data/db /var/log/mongodb /var/run/mongodb
chown -R mongodb:mongodb /data/db /var/log/mongodb /var/run/mongodb
chown -R node:node /app

# Start MongoDB
echo "Starting MongoDB..."
mongod --dbpath /data/db --logpath /var/log/mongodb/mongodb.log --bind_ip 0.0.0.0 &
MONGO_PID=$!

# Wait for MongoDB to be ready
echo "Waiting for MongoDB to start..."
until mongo --eval "print(\"waited for connection\")" > /dev/null 2>&1; do
    sleep 0.5
    if ! kill -0 $MONGO_PID 2>/dev/null; then
        echo "MongoDB failed to start. Checking logs:"
        cat /var/log/mongodb/mongodb.log
        exit 1
    fi
done
echo "MongoDB started successfully"

# Start nginx
echo "Starting nginx..."
nginx

# Start backend services
echo "Starting backend services..."
cd /app
export NODE_ENV=production
export MONGO_URL=mongodb://localhost:27017/termix

# Start SSH service
su -s /bin/bash node -c "node src/backend/ssh.cjs" &

# Start database service
su -s /bin/bash node -c "node src/backend/database.cjs" &

echo "All services started"

# Keep container running and show logs
tail -f /var/log/mongodb/mongodb.log