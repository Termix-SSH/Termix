#!/bin/bash
set -e

# Create MongoDB pid directory if it doesn't exist
mkdir -p /var/run/mongodb /data/db /var/log/mongodb
chown -R mongodb:mongodb /var/run/mongodb /data/db /var/log/mongodb

# Start MongoDB (first without --fork to see errors)
echo "Starting MongoDB..."
gosu mongodb mongod --dbpath $MONGODB_DATA_DIR --logpath $MONGODB_LOG_DIR/mongodb.log &
MONGO_PID=$!

# Wait for MongoDB to be ready
echo "Waiting for MongoDB to start..."
until gosu mongodb mongo --eval "print(\"waited for connection\")" > /dev/null 2>&1; do
    sleep 0.5
    if ! kill -0 $MONGO_PID 2>/dev/null; then
        echo "MongoDB failed to start. Checking logs:"
        cat $MONGODB_LOG_DIR/mongodb.log
        exit 1
    fi
done
echo "MongoDB has started"

# Start nginx
echo "Starting nginx..."
nginx

# Change to app directory and ensure permissions
cd /app
chown -R node:node /app

# Start the SSH service
echo "Starting SSH service..."
gosu node node src/backend/ssh.cjs &

# Start the database service
echo "Starting database service..."
gosu node node src/backend/database.cjs &

# Keep the container running and show MongoDB logs
echo "All services started. Tailing MongoDB logs..."
tail -f $MONGODB_LOG_DIR/mongodb.log