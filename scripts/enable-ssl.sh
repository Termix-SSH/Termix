#!/bin/bash

# Termix SSL Quick Setup Script
# Enables HTTPS/WSS with one command

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

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

print_banner() {
    echo ""
    echo "=============================================="
    log_header "🔒 Termix SSL Quick Setup"
    echo "=============================================="
    echo ""
    log_info "This script will:"
    echo "  ✅ Generate SSL certificates automatically"
    echo "  ✅ Create/update .env configuration"
    echo "  ✅ Enable HTTPS/WSS support"
    echo "  ✅ Generate security keys"
    echo ""
}

generate_keys() {
    log_info "🔑 Generating security keys..."

    # Generate JWT secret
    JWT_SECRET=$(openssl rand -hex 32)
    log_success "Generated JWT secret"

    # Generate database key
    DATABASE_KEY=$(openssl rand -hex 32)
    log_success "Generated database encryption key"

    echo "JWT_SECRET=$JWT_SECRET" >> "$ENV_FILE"
    echo "DATABASE_KEY=$DATABASE_KEY" >> "$ENV_FILE"

    log_success "Security keys added to .env file"
}

setup_env_file() {
    log_info "📝 Setting up environment configuration..."

    if [[ -f "$ENV_FILE" ]]; then
        log_warn "⚠️  .env file already exists, creating backup..."
        cp "$ENV_FILE" "$ENV_FILE.backup.$(date +%s)"
    fi

    # Create or update .env file
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

# Database encryption
DATABASE_ENCRYPTION=true

EOF

    # Add security keys
    generate_keys

    log_success "Environment configuration created at $ENV_FILE"
}

setup_ssl_certificates() {
    log_info "🔐 Setting up SSL certificates..."

    # Run SSL setup script
    if [[ -f "$SCRIPT_DIR/setup-ssl.sh" ]]; then
        bash "$SCRIPT_DIR/setup-ssl.sh"
    else
        log_error "❌ SSL setup script not found at $SCRIPT_DIR/setup-ssl.sh"
        exit 1
    fi
}

show_next_steps() {
    echo ""
    log_header "🚀 SSL Setup Complete!"
    echo ""
    log_success "Your Termix instance is now configured for HTTPS/WSS!"
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. 🐳 Using Docker:"
    echo "   docker-compose -f docker-compose.ssl.yml up"
    echo ""
    echo "2. 📦 Using npm:"
    echo "   npm start"
    echo ""
    echo "3. 🌐 Access your application:"
    echo "   • HTTPS: https://localhost:8443"
    echo "   • HTTP:  http://localhost:8080 (redirects to HTTPS)"
    echo ""
    echo "4. 📱 WebSocket connections will automatically use WSS"
    echo ""
    log_warn "⚠️  Browser Warning: Self-signed certificates will show security warnings"
    echo ""
    echo "For production deployment:"
    echo "• Replace self-signed certificates with CA-signed certificates"
    echo "• Update SSL_DOMAIN in .env to your actual domain"
    echo "• Set proper ALLOWED_ORIGINS for CORS"
    echo ""

    # Show generated keys
    if [[ -f "$ENV_FILE" ]]; then
        echo "Generated security keys (keep these secure!):"
        echo "• JWT_SECRET: $(grep JWT_SECRET "$ENV_FILE" | cut -d= -f2)"
        echo "• DATABASE_KEY: $(grep DATABASE_KEY "$ENV_FILE" | cut -d= -f2)"
        echo ""
    fi
}

# Main execution
main() {
    print_banner

    # Check prerequisites
    if ! command -v openssl &> /dev/null; then
        log_error "❌ OpenSSL is not installed. Please install OpenSSL first."
        exit 1
    fi

    # Setup environment
    setup_env_file

    # Setup SSL certificates
    setup_ssl_certificates

    # Show completion message
    show_next_steps
}

# Run main function
main "$@"