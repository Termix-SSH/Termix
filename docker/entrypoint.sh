#!/bin/bash

# Start MongoDB
mongod --fork --dbpath $MONGODB_DATA_DIR --logpath $MONGODB_LOG_DIR/mongodb.log

# Wait for MongoDB to be ready
echo "Waiting for MongoDB to start..."
until mongo --eval "print(\"waited for connection\")" > /dev/null 2>&1; do
    sleep 0.5
done
echo "MongoDB has started"

# Start nginx
nginx

# Start the SSH service
node src/backend/ssh.cjs &

# Start the database service
node src/backend/database.cjs &

# Keep the container running and show MongoDB logs
tail -f $MONGODB_LOG_DIR/mongodb.log