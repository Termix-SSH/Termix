#!/bin/bash

set -e

SSL_DIR="$(dirname "$0")/../ssl"
CERT_FILE="$SSL_DIR/termix.crt"
KEY_FILE="$SSL_DIR/termix.key"
DAYS_VALID=365

DOMAIN=${SSL_DOMAIN:-"localhost"}
ALT_NAMES=${SSL_ALT_NAMES:-"DNS:localhost,DNS:127.0.0.1,DNS:*.localhost,IP:127.0.0.1"}

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

check_existing_cert() {
    if [[ -f "$CERT_FILE" && -f "$KEY_FILE" ]]; then
        if openssl x509 -in "$CERT_FILE" -checkend 2592000 -noout 2>/dev/null; then
            log_success "Valid SSL certificate already exists"

            local expiry=$(openssl x509 -in "$CERT_FILE" -noout -enddate 2>/dev/null | cut -d= -f2)
            log_info "Expires: $expiry"
            return 0
        else
            log_warn "Existing certificate is expired or expiring soon"
        fi
    fi
    return 1
}

generate_certificate() {
    log_info "Generating new SSL certificate for domain: $DOMAIN"

    mkdir -p "$SSL_DIR"

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

    if [[ -n "$SSL_ALT_NAMES" ]]; then
        local counter=2
        IFS=',' read -ra NAMES <<< "$SSL_ALT_NAMES"
        for name in "${NAMES[@]}"; do
            name=$(echo "$name" | xargs)
            if [[ "$name" == DNS:* ]]; then
                echo "DNS.$((counter++)) = ${name#DNS:}" >> "$config_file"
            elif [[ "$name" == IP:* ]]; then
                echo "IP.$((counter++)) = ${name#IP:}" >> "$config_file"
            fi
        done
    fi

    log_info "Generating private key..."
    openssl genrsa -out "$KEY_FILE" 2048

    log_info "Generating certificate..."
    openssl req -new -x509 -key "$KEY_FILE" -out "$CERT_FILE" -days $DAYS_VALID -config "$config_file" -extensions v3_req

    chmod 600 "$KEY_FILE"
    chmod 644 "$CERT_FILE"

    rm -f "$config_file"

    log_success "SSL certificate generated successfully"
    log_info "Valid for: $DAYS_VALID days"
}

main() {
    if ! command -v openssl &> /dev/null; then
        log_error "OpenSSL is not installed. Please install OpenSSL first."
        exit 1
    fi

    generate_certificate
}

main "$@"