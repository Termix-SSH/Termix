# Database Migration Testing Guide

## Overview

This document outlines the testing procedures for the automatic database migration system that migrates unencrypted SQLite databases to encrypted format during Docker deployment updates.

## Migration System Features

✅ **Automatic Detection**: Detects unencrypted databases on startup
✅ **Safe Backup**: Creates timestamped backups before migration
✅ **Integrity Verification**: Validates migration completeness
✅ **Non-destructive**: Original files are renamed, not deleted
✅ **Cleanup**: Removes old backup files (keeps latest 3)
✅ **Admin API**: Migration status and history endpoints
✅ **Detailed Logging**: Comprehensive migration logs

## Test Scenarios

### Scenario 1: Fresh Installation (No Migration Needed)
**Setup**: Clean Docker container with no existing database files
**Expected**:
- New encrypted database created
- No migration messages in logs
- Status API shows "Fresh installation detected"

**Test Commands**:
```bash
# Clean start
docker run --rm termix:latest
# Check logs for "fresh installation"
# GET /database/migration/status should show needsMigration: false
```

### Scenario 2: Standard Migration (Unencrypted → Encrypted)
**Setup**: Existing unencrypted `db.sqlite` file with user data
**Expected**:
- Automatic migration on startup
- Backup file created (`.migration-backup-{timestamp}`)
- Original file renamed (`.migrated-{timestamp}`)
- Encrypted database created successfully
- All data preserved and accessible

**Test Commands**:
```bash
# 1. Create test data in unencrypted format
docker run -v /host/data:/app/data termix:old-version
# Add some SSH hosts and credentials via UI

# 2. Stop container and update to new version
docker stop container_id
docker run -v /host/data:/app/data termix:latest

# 3. Check migration logs
docker logs container_id | grep -i migration

# 4. Verify data integrity via API
curl -H "Authorization: Bearer $TOKEN" http://localhost:8081/database/migration/status
```

### Scenario 3: Already Encrypted (No Migration Needed)
**Setup**: Only encrypted database file exists
**Expected**:
- No migration performed
- Database loads normally
- Status API shows "Only encrypted database exists"

**Test Commands**:
```bash
# Start with existing encrypted database
docker run -v /host/encrypted-data:/app/data termix:latest
# Verify no migration messages in logs
```

### Scenario 4: Both Files Exist (Safety Mode)
**Setup**: Both encrypted and unencrypted databases present
**Expected**:
- Migration skipped for safety
- Warning logged about manual intervention
- Both files preserved
- Uses encrypted database

**Test Commands**:
```bash
# Manually create both files
touch /host/data/db.sqlite
touch /host/data/db.sqlite.encrypted
docker run -v /host/data:/app/data termix:latest
# Check for safety warning in logs
```

### Scenario 5: Migration Failure Recovery
**Setup**: Simulate migration failure (corrupted source file)
**Expected**:
- Migration fails safely
- Backup file preserved
- Original unencrypted file untouched
- Clear error message with recovery instructions

**Test Commands**:
```bash
# Create corrupted database file
echo "corrupted" > /host/data/db.sqlite
docker run -v /host/data:/app/data termix:latest
# Verify error handling and backup preservation
```

### Scenario 6: Large Database Migration
**Setup**: Large unencrypted database (>100MB with many records)
**Expected**:
- Migration completes successfully
- Performance is acceptable (under 30 seconds)
- Memory usage stays reasonable
- All data integrity checks pass

**Test Commands**:
```bash
# Create large dataset first
# Monitor migration duration and memory usage
docker stats container_id
```

## API Testing

### Migration Status Endpoint
```bash
# Admin access required
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     http://localhost:8081/database/migration/status

# Expected response:
{
  "migrationStatus": {
    "needsMigration": false,
    "hasUnencryptedDb": false,
    "hasEncryptedDb": true,
    "unencryptedDbSize": 0,
    "reason": "Only encrypted database exists. No migration needed."
  },
  "files": {
    "unencryptedDbSize": 0,
    "encryptedDbSize": 524288,
    "backupFiles": 2,
    "migratedFiles": 1
  },
  "recommendations": [
    "Database is properly encrypted",
    "No action required"
  ]
}
```

### Migration History Endpoint
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
     http://localhost:8081/database/migration/history

# Expected response:
{
  "files": [
    {
      "name": "db.sqlite.migration-backup-2024-09-24T10-30-00-000Z",
      "size": 262144,
      "created": "2024-09-24T10:30:00.000Z",
      "modified": "2024-09-24T10:30:00.000Z",
      "type": "backup"
    }
  ],
  "summary": {
    "totalBackups": 1,
    "totalMigrated": 1,
    "oldestBackup": "2024-09-24T10:30:00.000Z",
    "newestBackup": "2024-09-24T10:30:00.000Z"
  }
}
```

## Log Analysis

### Successful Migration Logs
Look for these log entries:
```
[INFO] Migration status check completed - needsMigration: true
[INFO] Starting automatic database migration
[INFO] Creating migration backup
[SUCCESS] Migration backup created successfully
[INFO] Found tables to migrate - tableCount: 8
[SUCCESS] Migration integrity verification completed
[INFO] Creating encrypted database file
[SUCCESS] Database migration completed successfully
```

### Migration Skipped (Safety) Logs
```
[INFO] Migration status check completed - needsMigration: false
[INFO] Both encrypted and unencrypted databases exist. Skipping migration for safety
[WARN] Manual intervention may be required
```

### Migration Failure Logs
```
[ERROR] Database migration failed
[ERROR] Backup available at: /app/data/db.sqlite.migration-backup-{timestamp}
[ERROR] Manual intervention required to recover data
```

## Manual Recovery Procedures

### If Migration Fails:
1. **Locate backup file**: `db.sqlite.migration-backup-{timestamp}`
2. **Restore original**: `cp backup-file db.sqlite`
3. **Check logs**: Look for specific error details
4. **Fix issue**: Address the root cause (permissions, disk space, etc.)
5. **Retry**: Restart container to trigger migration again

### If Both Databases Exist:
1. **Check dates**: Determine which file is newer
2. **Backup both**: Make copies before proceeding
3. **Remove older**: Delete the outdated database file
4. **Restart**: Container will detect single database

### Emergency Data Recovery:
1. **Backup files are SQLite**: Can be opened with any SQLite client
2. **Manual export**: Use SQLite tools to export data
3. **Re-import**: Use Termix import functionality

## Performance Expectations

| Database Size | Expected Migration Time | Memory Usage |
|---------------|------------------------|--------------|
| < 10MB        | < 5 seconds           | < 50MB       |
| 10-50MB       | 5-15 seconds          | < 100MB      |
| 50-200MB      | 15-45 seconds         | < 200MB      |
| 200MB+        | 45+ seconds           | < 500MB      |

## Validation Checklist

After migration, verify:
- [ ] All SSH hosts are accessible
- [ ] SSH credentials work correctly
- [ ] File manager recent/pinned items preserved
- [ ] User settings maintained
- [ ] OIDC configuration intact
- [ ] Admin users still have admin privileges
- [ ] Backup file exists and is valid SQLite
- [ ] Original file renamed (not deleted)
- [ ] Encrypted file is properly encrypted
- [ ] Migration APIs respond correctly

## Monitoring Commands

```bash
# Watch migration in real-time
docker logs -f container_id | grep -i migration

# Check file sizes before/after
ls -la /host/data/db.sqlite*

# Verify encrypted file
file /host/data/db.sqlite.encrypted

# Monitor system resources during migration
docker stats container_id

# Test database connectivity after migration
curl -H "Authorization: Bearer $TOKEN" \
     http://localhost:8081/hosts/list
```

## Common Issues & Solutions

### Issue: "Permission denied" during backup creation
**Solution**: Check container file permissions and volume mounts

### Issue: "Insufficient disk space" during migration
**Solution**: Free up space, migration requires 2x database size temporarily

### Issue: "Database locked" error
**Solution**: Ensure no other processes are accessing the database file

### Issue: Migration hangs indefinitely
**Solution**: Check for very large BLOB data, increase timeout or migrate manually

### Issue: Encrypted file fails validation
**Solution**: Check DATABASE_KEY environment variable, ensure it's stable

## Security Considerations

- **Backup files contain unencrypted data**: Secure backup file access
- **Migration logs may contain sensitive info**: Review log retention policies
- **Temporary files during migration**: Ensure secure temp directory
- **Original files are preserved**: Plan for secure cleanup of old files
- **Admin API access**: Ensure proper authentication and authorization

## Integration with CI/CD

For automated testing in CI/CD pipelines:

```bash
#!/bin/bash
# Migration integration test
set -e

# Start with unencrypted test data
docker run -d --name test-migration \
  -v ./test-data:/app/data \
  termix:latest

# Wait for startup
sleep 30

# Check migration status
RESPONSE=$(curl -s -H "Authorization: Bearer $TEST_TOKEN" \
  http://localhost:8081/database/migration/status)

# Validate migration success
echo "$RESPONSE" | jq '.migrationStatus.needsMigration == false'

# Cleanup
docker stop test-migration
docker rm test-migration
```

This comprehensive testing approach ensures the migration system handles all edge cases safely and provides administrators with full visibility into the migration process.