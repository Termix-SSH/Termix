#!/bin/bash
set -e

# Create required directories and set permissions
mkdir -p /data/db /var/log/mongodb /var/run/mongodb
chown -R mongodb:mongodb /data/db /var/log/mongodb /var/run/mongodb
chmod 755 /data/db /var/log/mongodb /var/run/mongodb

# Check if we need to migrate from MongoDB 5.0
if [ -f "/data/db/diagnostic.data/metrics.2" ] || [ -f "/data/db/WiredTiger.wt" ]; then
    echo "Existing MongoDB data detected, checking version..."
    
    # Start MongoDB temporarily with --repair to handle version mismatch
    gosu mongodb mongod --dbpath $MONGODB_DATA_DIR --logpath $MONGODB_LOG_DIR/mongodb.log --repair
    
    # Start MongoDB with specific options for migration
    echo "Starting MongoDB for migration..."
    gosu mongodb mongod --dbpath $MONGODB_DATA_DIR --logpath $MONGODB_LOG_DIR/mongodb.log --bind_ip 0.0.0.0 &
    MONGO_PID=$!
    
    # Wait for MongoDB to be ready
    echo "Waiting for MongoDB to start for migration..."
    until gosu mongodb mongo --eval "print(\"waited for connection\")" > /dev/null 2>&1; do
        sleep 1
        if ! kill -0 $MONGO_PID 2>/dev/null; then
            echo "MongoDB failed to start for migration. Checking logs:"
            cat $MONGODB_LOG_DIR/mongodb.log
            exit 1
        fi
    done
    
    echo "Setting featureCompatibilityVersion to 4.4..."
    # Try to set featureCompatibilityVersion
    if gosu mongodb mongo --eval 'db.adminCommand({setFeatureCompatibilityVersion: "4.4"})' > /dev/null 2>&1; then
        echo "Successfully set featureCompatibilityVersion to 4.4"
    else
        echo "Failed to set featureCompatibilityVersion. Attempting repair..."
        gosu mongodb mongod --dbpath $MONGODB_DATA_DIR --repair
    fi
    
    # Stop MongoDB after migration
    kill $MONGO_PID
    while kill -0 $MONGO_PID 2>/dev/null; do
        sleep 1
    done
fi

# Start MongoDB normally
echo "Starting MongoDB..."
gosu mongodb mongod --dbpath $MONGODB_DATA_DIR --logpath $MONGODB_LOG_DIR/mongodb.log --bind_ip 0.0.0.0 &
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
echo "MongoDB started successfully"

# Start nginx
echo "Starting nginx..."
nginx

# Start backend services
echo "Starting backend services..."
cd /app
export NODE_ENV=production

# Start SSH service
su -s /bin/bash node -c "node src/backend/ssh.cjs" &

# Start database service
su -s /bin/bash node -c "node src/backend/database.cjs" &

echo "All services started"

# Keep container running and show logs
tail -f $MONGODB_LOG_DIR/mongodb.log