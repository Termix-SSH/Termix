#!/bin/bash

# Termix SSL Certificate Auto-Setup Script
# Linus principle: Simple, automatic, works everywhere

set -e

# Configuration
SSL_DIR="$(dirname "$0")/../ssl"
CERT_FILE="$SSL_DIR/termix.crt"
KEY_FILE="$SSL_DIR/termix.key"
DAYS_VALID=365

# Default domain - can be overridden by environment variable
DOMAIN=${SSL_DOMAIN:-"localhost"}
ALT_NAMES=${SSL_ALT_NAMES:-"DNS:localhost,DNS:127.0.0.1,DNS:*.localhost,IP:127.0.0.1"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[SSL Setup]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SSL Setup]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[SSL Setup]${NC} $1"
}

log_error() {
    echo -e "${RED}[SSL Setup]${NC} $1"
}

# Check if certificate exists and is still valid
check_existing_cert() {
    if [[ -f "$CERT_FILE" && -f "$KEY_FILE" ]]; then
        # Check if certificate is still valid for at least 30 days
        if openssl x509 -in "$CERT_FILE" -checkend 2592000 -noout 2>/dev/null; then
            log_success "✅ Valid SSL certificate already exists"
            log_info "Certificate: $CERT_FILE"
            log_info "Private Key: $KEY_FILE"

            # Show certificate info
            local expiry=$(openssl x509 -in "$CERT_FILE" -noout -enddate 2>/dev/null | cut -d= -f2)
            log_info "Expires: $expiry"
            return 0
        else
            log_warn "⚠️  Existing certificate is expired or expiring soon"
        fi
    fi
    return 1
}

# Generate self-signed certificate
generate_certificate() {
    log_info "🔐 Generating new SSL certificate for domain: $DOMAIN"

    # Create SSL directory if it doesn't exist
    mkdir -p "$SSL_DIR"

    # Create OpenSSL config for SAN (Subject Alternative Names)
    local config_file="$SSL_DIR/openssl.conf"
    cat > "$config_file" << EOF
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
DNS.1 = localhost
DNS.2 = 127.0.0.1
DNS.3 = *.localhost
IP.1 = 127.0.0.1
EOF

    # Add custom alt names if provided
    if [[ -n "$SSL_ALT_NAMES" ]]; then
        local counter=2
        IFS=',' read -ra NAMES <<< "$SSL_ALT_NAMES"
        for name in "${NAMES[@]}"; do
            name=$(echo "$name" | xargs) # trim whitespace
            if [[ "$name" == DNS:* ]]; then
                echo "DNS.$((counter++)) = ${name#DNS:}" >> "$config_file"
            elif [[ "$name" == IP:* ]]; then
                echo "IP.$((counter++)) = ${name#IP:}" >> "$config_file"
            fi
        done
    fi

    # Generate private key
    log_info "📝 Generating private key..."
    openssl genrsa -out "$KEY_FILE" 2048

    # Generate certificate
    log_info "📄 Generating certificate..."
    openssl req -new -x509 -key "$KEY_FILE" -out "$CERT_FILE" -days $DAYS_VALID -config "$config_file" -extensions v3_req

    # Set proper permissions
    chmod 600 "$KEY_FILE"
    chmod 644 "$CERT_FILE"

    # Clean up temp config
    rm -f "$config_file"

    log_success "✅ SSL certificate generated successfully"
    log_info "Certificate: $CERT_FILE"
    log_info "Private Key: $KEY_FILE"
    log_info "Valid for: $DAYS_VALID days"
}

# Show certificate information
show_certificate_info() {
    if [[ -f "$CERT_FILE" ]]; then
        echo ""
        log_info "📋 Certificate Information:"
        openssl x509 -in "$CERT_FILE" -noout -subject -issuer -dates

        echo ""
        log_info "🌐 Subject Alternative Names:"
        openssl x509 -in "$CERT_FILE" -noout -text | grep -A1 "Subject Alternative Name" | tail -1 | sed 's/^[[:space:]]*//'
    fi
}

# Main execution
main() {
    echo ""
    echo "=============================================="
    echo "🔒 Termix SSL Certificate Auto-Setup"
    echo "=============================================="
    echo ""

    log_info "Target domain: $DOMAIN"
    log_info "SSL directory: $SSL_DIR"

    # Check if OpenSSL is available
    if ! command -v openssl &> /dev/null; then
        log_error "❌ OpenSSL is not installed. Please install OpenSSL first."
        exit 1
    fi

    # Check existing certificate
    if check_existing_cert; then
        show_certificate_info
        echo ""
        log_info "🚀 SSL setup complete - ready for HTTPS/WSS!"
        echo ""
        echo "To use the certificate:"
        echo "  - Nginx SSL cert: $CERT_FILE"
        echo "  - Nginx SSL key:  $KEY_FILE"
        echo ""
        return 0
    fi

    # Generate new certificate
    generate_certificate
    show_certificate_info

    echo ""
    log_success "🚀 SSL setup complete - ready for HTTPS/WSS!"
    echo ""
    echo "Next steps:"
    echo "  1. Update your Nginx configuration to use these certificates"
    echo "  2. Restart Nginx to enable HTTPS/WSS"
    echo "  3. Access your application via https://localhost"
    echo ""

    # Security note for self-signed certificates
    log_warn "⚠️  Note: Self-signed certificates will show browser warnings"
    log_info "💡 For production, consider using Let's Encrypt or a commercial CA"
}

# Run main function
main "$@"