#!/bin/bash

# Start MongoDB
mongod --fork --logpath /var/log/mongodb.log

# Start nginx
nginx

# Start the SSH service
node src/backend/ssh.cjs &

# Start the database service
node src/backend/database.cjs &

# Keep the container running and show MongoDB logs
tail -f /var/log/mongodb.log