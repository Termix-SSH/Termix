#!/bin/bash
set -e

# Start MongoDB
echo "Starting MongoDB..."
mongod --fork --dbpath $MONGODB_DATA_DIR --logpath $MONGODB_LOG_DIR/mongodb.log

# Wait for MongoDB to be ready
echo "Waiting for MongoDB to start..."
until mongosh --eval "print(\"waited for connection\")" > /dev/null 2>&1; do
    sleep 0.5
done
echo "MongoDB has started"

# Start nginx
echo "Starting nginx..."
nginx

# Change to app directory
cd /app

# Start the SSH service
echo "Starting SSH service..."
node src/backend/ssh.cjs &

# Start the database service
echo "Starting database service..."
node src/backend/database.cjs &

# Keep the container running and show MongoDB logs
echo "All services started. Tailing MongoDB logs..."
tail -f $MONGODB_LOG_DIR/mongodb.log