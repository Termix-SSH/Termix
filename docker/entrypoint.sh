#!/bin/sh
set -e

export PORT=${PORT:-8080}
export ENABLE_SSL=${ENABLE_SSL:-false}
export SSL_PORT=${SSL_PORT:-8443}
export SSL_CERT_PATH=${SSL_CERT_PATH:-/app/ssl/termix.crt}
export SSL_KEY_PATH=${SSL_KEY_PATH:-/app/ssl/termix.key}

echo "Configuring web UI to run on port: $PORT"

# Choose nginx configuration based on SSL setting
# Default: HTTP-only for easy setup
# Set ENABLE_SSL=true to use HTTPS with automatic redirect
if [ "$ENABLE_SSL" = "true" ]; then
    echo "SSL enabled - using HTTPS configuration with redirect"
    NGINX_CONF_SOURCE="/etc/nginx/nginx-https.conf"
else
    echo "SSL disabled - using HTTP-only configuration (default)"
    NGINX_CONF_SOURCE="/etc/nginx/nginx.conf"
fi

envsubst '${PORT} ${SSL_PORT} ${SSL_CERT_PATH} ${SSL_KEY_PATH}' < $NGINX_CONF_SOURCE > /etc/nginx/nginx.conf.tmp
mv /etc/nginx/nginx.conf.tmp /etc/nginx/nginx.conf

mkdir -p /app/data
chown -R node:node /app/data
chmod 755 /app/data

# If SSL is enabled, generate certificates first
if [ "$ENABLE_SSL" = "true" ]; then
    echo "Generating SSL certificates..."
    mkdir -p /app/ssl
    chown -R node:node /app/ssl
    chmod 755 /app/ssl
    
    # Generate SSL certificates using OpenSSL directly (faster and more reliable)
    DOMAIN=${SSL_DOMAIN:-localhost}
    echo "Generating certificate for domain: $DOMAIN"
    
    # Create OpenSSL config
    cat > /app/ssl/openssl.conf << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
C=US
ST=State
L=City
O=Termix
OU=IT Department
CN=$DOMAIN

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DOMAIN
DNS.2 = localhost
DNS.3 = 127.0.0.1
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

    # Generate private key
    openssl genrsa -out /app/ssl/termix.key 2048
    
    # Generate certificate
    openssl req -new -x509 -key /app/ssl/termix.key -out /app/ssl/termix.crt -days 365 -config /app/ssl/openssl.conf -extensions v3_req
    
    # Set proper permissions
    chmod 600 /app/ssl/termix.key
    chmod 644 /app/ssl/termix.crt
    chown node:node /app/ssl/termix.key /app/ssl/termix.crt
    
    # Clean up config
    rm -f /app/ssl/openssl.conf
    
    echo "SSL certificates generated successfully for domain: $DOMAIN"
fi

echo "Starting nginx..."
nginx

echo "Starting backend services..."
cd /app
export NODE_ENV=production

if command -v su-exec > /dev/null 2>&1; then
  su-exec node node dist/backend/backend/starter.js
else
  su -s /bin/sh node -c "node dist/backend/backend/starter.js"
fi

echo "All services started"

tail -f /dev/null