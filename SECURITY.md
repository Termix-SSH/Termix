# Security Guide for Termix

## Database Encryption

Termix implements AES-256-GCM encryption for sensitive data stored in the database. This protects SSH credentials, passwords, and authentication tokens from unauthorized access.

### Encrypted Fields

The following database fields are automatically encrypted:

**Users Table:**
- `password_hash` - User password hashes
- `client_secret` - OIDC client secrets
- `totp_secret` - 2FA authentication seeds
- `totp_backup_codes` - 2FA backup codes

**SSH Data Table:**
- `password` - SSH connection passwords
- `key` - SSH private keys
- `keyPassword` - SSH private key passphrases

**SSH Credentials Table:**
- `password` - Stored SSH passwords
- `privateKey` - SSH private keys
- `keyPassword` - SSH private key passphrases

### Configuration

#### Required Environment Variables

```bash
# Encryption master key (REQUIRED)
DB_ENCRYPTION_KEY=your-very-strong-encryption-key-32-chars-minimum
```

**⚠️ CRITICAL:** The encryption key must be:
- At least 16 characters long (32+ recommended)
- Cryptographically random
- Unique per installation
- Safely backed up

#### Optional Settings

```bash
# Enable/disable encryption (default: true)
ENCRYPTION_ENABLED=true

# Reject unencrypted data (default: false)
FORCE_ENCRYPTION=false

# Auto-encrypt legacy data (default: true)
MIGRATE_ON_ACCESS=true
```

### Initial Setup

#### 1. Generate Encryption Key

```bash
# Generate a secure random key (Linux/macOS)
openssl rand -hex 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### 2. Set Environment Variable

```bash
# Add to your .env file
echo "DB_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
```

#### 3. Validate Configuration

```bash
# Test encryption setup
npm run test:encryption
```

### Migration from Unencrypted Database

If you have an existing Termix installation with unencrypted data:

#### 1. Backup Your Database

```bash
# Create backup before migration
cp ./db/data/db.sqlite ./db/data/db-backup-$(date +%Y%m%d-%H%M%S).sqlite
```

#### 2. Run Migration

```bash
# Set encryption key
export DB_ENCRYPTION_KEY="your-secure-key-here"

# Test migration (dry run)
npm run migrate:encryption -- --dry-run

# Run actual migration
npm run migrate:encryption
```

#### 3. Verify Migration

```bash
# Check encryption status
curl http://localhost:8081/encryption/status

# Test application functionality
npm run test:encryption production
```

### Security Best Practices

#### Key Management

1. **Generate unique keys** for each installation
2. **Store keys securely** (use environment variables, not config files)
3. **Backup keys safely** (encrypted backups in secure locations)
4. **Rotate keys periodically** (implement key rotation schedule)

#### Deployment Security

```bash
# Production Docker example
docker run -d \
  -e DB_ENCRYPTION_KEY="$(cat /secure/location/encryption.key)" \
  -e ENCRYPTION_ENABLED=true \
  -e FORCE_ENCRYPTION=true \
  -v termix-data:/app/data \
  ghcr.io/lukegus/termix:latest
```

#### File System Protection

```bash
# Secure database directory permissions
chmod 700 ./db/data/
chmod 600 ./db/data/db.sqlite

# Use encrypted storage if possible
# Consider full disk encryption for production
```

### Monitoring and Alerting

#### Health Checks

The encryption system provides health check endpoints:

```bash
# Check encryption status
GET /encryption/status

# Response format:
{
  "encryption": {
    "enabled": true,
    "configValid": true,
    "forceEncryption": false,
    "migrateOnAccess": true
  },
  "migration": {
    "isEncryptionEnabled": true,
    "migrationCompleted": true,
    "migrationDate": "2024-01-15T10:30:00Z"
  }
}
```

#### Log Monitoring

Monitor logs for encryption-related events:

```bash
# Encryption initialization
"Database encryption initialized successfully"

# Migration events
"Migration completed for table: users"

# Security warnings
"DB_ENCRYPTION_KEY not set, using default (INSECURE)"
```

### Troubleshooting

#### Common Issues

**1. "Decryption failed" errors**
- Verify `DB_ENCRYPTION_KEY` is correct
- Check if database was corrupted
- Restore from backup if necessary

**2. Performance issues**
- Encryption adds ~1ms per operation
- Consider disabling `MIGRATE_ON_ACCESS` after migration
- Monitor CPU usage during large migrations

**3. Key rotation**
```bash
# Generate new key
NEW_KEY=$(openssl rand -hex 32)

# Update configuration
# Note: Requires re-encryption of all data
```

### Compliance Notes

This encryption implementation helps meet requirements for:

- **GDPR** - Personal data protection
- **SOC 2** - Data security controls
- **PCI DSS** - Sensitive data protection
- **HIPAA** - Healthcare data encryption (if applicable)

### Security Limitations

**What this protects against:**
- Database file theft
- Disk access by unauthorized users
- Data breaches from file system access

**What this does NOT protect against:**
- Application-level vulnerabilities
- Memory dumps while application is running
- Attacks against the running application
- Social engineering attacks

### Emergency Procedures

#### Lost Encryption Key

⚠️ **Data is unrecoverable without the encryption key**

1. Check all backup locations
2. Restore from unencrypted backup if available
3. Contact system administrators

#### Suspected Key Compromise

1. **Immediately** generate new encryption key
2. Take application offline
3. Re-encrypt all sensitive data with new key
4. Investigate compromise source
5. Update security procedures

### Support

For security-related questions:
- Open issue: [GitHub Issues](https://github.com/LukeGus/Termix/issues)
- Discord: [Termix Community](https://discord.gg/jVQGdvHDrf)

**Do not share encryption keys or sensitive debugging information in public channels.**