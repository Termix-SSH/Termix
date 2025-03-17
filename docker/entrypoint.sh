#!/bin/bash
set -e

# Create MongoDB pid directory if it doesn't exist
mkdir -p /var/run/mongodb
chown mongodb:mongodb /var/run/mongodb

# Start MongoDB
echo "Starting MongoDB..."
mongod --fork --dbpath $MONGODB_DATA_DIR --logpath $MONGODB_LOG_DIR/mongodb.log --pidfilepath /var/run/mongodb/mongod.pid

# Wait for MongoDB to be ready (using mongo instead of mongosh for MongoDB 4.4)
echo "Waiting for MongoDB to start..."
until mongo --eval "print(\"waited for connection\")" > /dev/null 2>&1; do
    sleep 0.5
    # Check if MongoDB is still running
    if ! pgrep -x "mongod" > /dev/null; then
        echo "MongoDB failed to start. Checking logs:"
        cat $MONGODB_LOG_DIR/mongodb.log
        exit 1
    fi
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