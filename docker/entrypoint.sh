#!/bin/sh
set -e

export PORT=${PORT:-8080}
export ENABLE_SSL=${ENABLE_SSL:-false}
export SSL_PORT=${SSL_PORT:-8443}
export SSL_CERT_PATH=${SSL_CERT_PATH:-/app/data/ssl/termix.crt}
export SSL_KEY_PATH=${SSL_KEY_PATH:-/app/data/ssl/termix.key}

echo "Configuring web UI to run on port: $PORT"

if [ "$ENABLE_SSL" = "true" ]; then
    echo "SSL enabled - using HTTPS configuration with redirect"
    NGINX_CONF_SOURCE="/app/nginx/nginx-https.conf.template"
else
    echo "SSL disabled - using HTTP-only configuration (default)"
    NGINX_CONF_SOURCE="/app/nginx/nginx.conf.template"
fi

envsubst '${PORT} ${SSL_PORT} ${SSL_CERT_PATH} ${SSL_KEY_PATH}' < $NGINX_CONF_SOURCE > /app/nginx/nginx.conf

mkdir -p /app/data /app/uploads /app/data/.opk
chmod 755 /app/data /app/uploads /app/data/.opk 2>/dev/null || true

if [ -w /app/data ]; then
    echo "Data directory is writable"
else
    echo "WARNING: Data directory is not writable. OPKSSH may fail."
    ls -ld /app/data
fi

if [ -w /app/data/.opk ]; then
    echo "OPKSSH directory is writable"
else
    echo "WARNING: OPKSSH directory is not writable. OPKSSH authentication will fail."
    ls -ld /app/data/.opk
fi

if [ ! -d "/app/opkssh" ]; then
    echo "WARNING: OPKSSH binary directory not found at /app/opkssh"
fi

if [ "$ENABLE_SSL" = "true" ]; then
    echo "Checking SSL certificate configuration..."
    mkdir -p /app/data/ssl
    chmod 755 /app/data/ssl 2>/dev/null || true

    DOMAIN=${SSL_DOMAIN:-localhost}
    
    if [ -f "/app/data/ssl/termix.crt" ] && [ -f "/app/data/ssl/termix.key" ]; then
        echo "SSL certificates found, checking validity..."
        
        if openssl x509 -in /app/data/ssl/termix.crt -checkend 2592000 -noout >/dev/null 2>&1; then
            echo "SSL certificates are valid and will be reused for domain: $DOMAIN"
        else
            echo "SSL certificate is expired or expiring soon, regenerating..."
            rm -f /app/data/ssl/termix.crt /app/data/ssl/termix.key
        fi
    else
        echo "SSL certificates not found, will generate new ones..."
    fi
    
    if [ ! -f "/app/data/ssl/termix.crt" ] || [ ! -f "/app/data/ssl/termix.key" ]; then
        echo "Generating SSL certificates for domain: $DOMAIN"

        cat > /app/data/ssl/openssl.conf << EOF
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
IP.3 = 0.0.0.0
EOF

        openssl genrsa -out /app/data/ssl/termix.key 2048

        openssl req -new -x509 -key /app/data/ssl/termix.key -out /app/data/ssl/termix.crt -days 365 -config /app/data/ssl/openssl.conf -extensions v3_req

        chmod 600 /app/data/ssl/termix.key
        chmod 644 /app/data/ssl/termix.crt

        rm -f /app/data/ssl/openssl.conf
        
        echo "SSL certificates generated successfully for domain: $DOMAIN"
    fi
fi

echo "Starting nginx..."
nginx -c /app/nginx/nginx.conf

echo "Starting backend services..."
cd /app
export NODE_ENV=production

if [ -f "package.json" ]; then
    VERSION=$(grep '"version"' package.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')
    if [ -n "$VERSION" ]; then
        export VERSION
    else
        echo "Warning: Could not extract version from package.json"
    fi
else
    echo "Warning: package.json not found"
fi

node dist/backend/backend/starter.js

echo "All services started"

tail -f /dev/null