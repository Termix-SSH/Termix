#!/bin/bash
set -e

# Create required directories and set permissions
mkdir -p /data/db /var/log/mongodb /var/run/mongodb
chown -R mongodb:mongodb /data/db /var/log/mongodb /var/run/mongodb
chmod 755 /data/db /var/log/mongodb /var/run/mongodb

# Function to check MongoDB version
check_mongo_version() {
    echo "Checking MongoDB version..."
    if [ -f "/data/db/diagnostic.data/metrics.2" ] || [ -f "/data/db/WiredTiger.wt" ]; then
        echo "Existing MongoDB data detected, attempting migration..."
        
        # Clear any existing mongod lock file
        rm -f /tmp/mongodb-27017.sock
        rm -f /data/db/mongod.lock
        
        # First, start MongoDB 5.0 to set compatibility version
        echo "Starting MongoDB 5.0 to set compatibility version..."
        MONGODB_VERSION=5.0 gosu mongodb mongod --dbpath $MONGODB_DATA_DIR --port 27017 --bind_ip 127.0.0.1 &
        MONGO_PID=$!
        
        # Wait for MongoDB 5.0 to start
        echo "Waiting for MongoDB 5.0 to start..."
        MAX_TRIES=30
        COUNT=0
        while ! gosu mongodb mongo --quiet --eval "db.version()" > /dev/null 2>&1; do
            sleep 2
            COUNT=$((COUNT + 1))
            if [ $COUNT -ge $MAX_TRIES ]; then
                echo "Failed to start MongoDB 5.0 after $MAX_TRIES attempts"
                kill -9 $MONGO_PID 2>/dev/null || true
                return 1
            fi
        done
        
        # Set compatibility version to 4.4
        echo "Setting feature compatibility version to 4.4..."
        if ! gosu mongodb mongo --quiet --eval 'db.adminCommand({setFeatureCompatibilityVersion: "4.4"})'; then
            echo "Failed to set feature compatibility version"
            kill -9 $MONGO_PID 2>/dev/null || true
            return 1
        fi
        
        # Shutdown MongoDB 5.0 cleanly
        echo "Shutting down MongoDB 5.0..."
        gosu mongodb mongo --quiet --eval "db.adminCommand({shutdown: 1})" || kill $MONGO_PID
        
        # Wait for process to end
        while kill -0 $MONGO_PID 2>/dev/null; do
            sleep 1
        done
        
        # Run repair
        echo "Running repair..."
        gosu mongodb mongod --dbpath $MONGODB_DATA_DIR --repair
        
        return 0
    fi
    return 0
}

# Try migration up to 3 times
MAX_MIGRATION_ATTEMPTS=3
MIGRATION_ATTEMPT=1

while [ $MIGRATION_ATTEMPT -le $MAX_MIGRATION_ATTEMPTS ]; do
    echo "Migration attempt $MIGRATION_ATTEMPT of $MAX_MIGRATION_ATTEMPTS"
    if check_mongo_version; then
        break
    fi
    MIGRATION_ATTEMPT=$((MIGRATION_ATTEMPT + 1))
    if [ $MIGRATION_ATTEMPT -le $MAX_MIGRATION_ATTEMPTS ]; then
        echo "Migration failed, waiting before retry..."
        sleep 5
    fi
done

if [ $MIGRATION_ATTEMPT -gt $MAX_MIGRATION_ATTEMPTS ]; then
    echo "Migration failed after $MAX_MIGRATION_ATTEMPTS attempts"
    exit 1
fi

# Start MongoDB normally
echo "Starting MongoDB..."
gosu mongodb mongod --dbpath $MONGODB_DATA_DIR --logpath $MONGODB_LOG_DIR/mongodb.log --bind_ip 0.0.0.0 &
MONGO_PID=$!

# Wait for MongoDB to be ready
echo "Waiting for MongoDB to start..."
MAX_TRIES=30
COUNT=0
while ! gosu mongodb mongo --quiet --eval "db.version()" > /dev/null 2>&1; do
    sleep 2
    COUNT=$((COUNT + 1))
    if [ $COUNT -ge $MAX_TRIES ]; then
        echo "Failed to start MongoDB. Checking logs:"
        cat $MONGODB_LOG_DIR/mongodb.log
        exit 1
    fi
    echo "Waiting for MongoDB... (attempt $COUNT/$MAX_TRIES)"
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