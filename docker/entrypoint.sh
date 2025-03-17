#!/bin/bash
set -e

# Create required directories and set permissions
mkdir -p /data/db /var/log/mongodb /var/run/mongodb /tmp/mongodb
chown -R mongodb:mongodb /data/db /var/log/mongodb /var/run/mongodb /tmp/mongodb
chmod 755 /data/db /var/log/mongodb /var/run/mongodb /tmp/mongodb

# Start MongoDB with proper permissions
echo "Starting MongoDB..."
gosu mongodb mongod --dbpath $MONGODB_DATA_DIR \
    --logpath $MONGODB_LOG_DIR/mongodb.log \
    --pidfilepath /tmp/mongodb/mongodb.pid \
    --bind_ip_all \
    --port 27017 \
    --wiredTigerCacheSizeGB 1 &

# Wait for MongoDB to be ready
echo "Waiting for MongoDB to start..."
max_attempts=30
attempt=0
until gosu mongodb mongosh --eval "db.adminCommand('ping')" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ $attempt -gt $max_attempts ]; then
        echo "MongoDB failed to start. Checking logs:"
        cat $MONGODB_LOG_DIR/mongodb.log
        exit 1
    fi
    echo "Waiting for MongoDB... (attempt $attempt/$max_attempts)"
    sleep 2
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
echo "Starting SSH service..."
gosu node node src/backend/ssh.cjs &
SSH_PID=$!

# Start database service
echo "Starting database service..."
gosu node node src/backend/database.cjs &
DB_PID=$!

# Wait a moment to ensure services are starting
sleep 2

# Check if services are running
if ! kill -0 $SSH_PID 2>/dev/null; then
    echo "SSH service failed to start. Checking logs..."
    tail -n 50 /var/log/mongodb/mongodb.log
    exit 1
fi

if ! kill -0 $DB_PID 2>/dev/null; then
    echo "Database service failed to start. Checking logs..."
    tail -n 50 /var/log/mongodb/mongodb.log
    exit 1
fi

echo "All services started successfully"

# Keep container running and show logs
exec tail -f $MONGODB_LOG_DIR/mongodb.log