#!/bin/sh

# Start MongoDB with custom data directory
mongod --fork --dbpath $MONGODB_DATA_DIR --logpath $MONGODB_LOG_DIR/mongodb.log

# Start nginx
nginx

# Start the SSH service
node src/backend/ssh.cjs &

# Start the database service
node src/backend/database.cjs &

# Keep the container running
tail -f /dev/null