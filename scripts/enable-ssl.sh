#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"

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

log_header() {
    echo -e "${CYAN}$1${NC}"
}

generate_keys() {
    log_info "Generating security keys..."

    JWT_SECRET=$(openssl rand -hex 32)
    log_success "Generated JWT secret"

    DATABASE_KEY=$(openssl rand -hex 32)
    log_success "Generated database encryption key"

    echo "JWT_SECRET=$JWT_SECRET" >> "$ENV_FILE"
    echo "DATABASE_KEY=$DATABASE_KEY" >> "$ENV_FILE"

    log_success "Security keys added to .env file"
}

setup_env_file() {
    log_info "Setting up environment configuration..."

    if [[ -f "$ENV_FILE" ]]; then
        log_warn ".env file already exists, creating backup..."
        cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%s)"
    fi

    cat > "$ENV_FILE" << EOF
# Termix SSL Configuration - Auto-generated $(date)

# SSL/TLS Configuration
ENABLE_SSL=true
SSL_PORT=8443
SSL_DOMAIN=localhost
PORT=8080

# Node environment
NODE_ENV=production

# CORS configuration
ALLOWED_ORIGINS=*

EOF

    generate_keys

    log_success "Environment configuration created at $ENV_FILE"
}

setup_ssl_certificates() {
    log_info "Setting up SSL certificates..."

    if [[ -f "$SCRIPT_DIR/setup-ssl.sh" ]]; then
        bash "$SCRIPT_DIR/setup-ssl.sh"
    else
        log_error "SSL setup script not found at $SCRIPT_DIR/setup-ssl.sh"
        exit 1
    fi
}

main() {
    if ! command -v openssl &> /dev/null; then
        log_error "OpenSSL is not installed. Please install OpenSSL first."
        exit 1
    fi

    setup_env_file
    setup_ssl_certificates
}

# Run main function
main "$@"