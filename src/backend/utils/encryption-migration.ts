#!/usr/bin/env node
import { DatabaseEncryption } from './database-encryption.js';
import { EncryptedDBOperations } from './encrypted-db-operations.js';
import { EncryptionKeyManager } from './encryption-key-manager.js';
import { databaseLogger } from './logger.js';
import { db } from '../database/db/index.js';
import { settings } from '../database/db/schema.js';
import { eq, sql } from 'drizzle-orm';

interface MigrationConfig {
  masterPassword?: string;
  forceEncryption?: boolean;
  backupEnabled?: boolean;
  dryRun?: boolean;
}

class EncryptionMigration {
  private config: MigrationConfig;

  constructor(config: MigrationConfig = {}) {
    this.config = {
      masterPassword: config.masterPassword,
      forceEncryption: config.forceEncryption ?? false,
      backupEnabled: config.backupEnabled ?? true,
      dryRun: config.dryRun ?? false
    };
  }

  async runMigration(): Promise<void> {
    databaseLogger.info('Starting database encryption migration', {
      operation: 'migration_start',
      dryRun: this.config.dryRun,
      forceEncryption: this.config.forceEncryption
    });

    try {
      await this.validatePrerequisites();

      if (this.config.backupEnabled && !this.config.dryRun) {
        await this.createBackup();
      }

      await this.initializeEncryption();
      await this.migrateTables();
      await this.updateSettings();
      await this.verifyMigration();

      databaseLogger.success('Database encryption migration completed successfully', {
        operation: 'migration_complete'
      });

    } catch (error) {
      databaseLogger.error('Migration failed', error, {
        operation: 'migration_failed'
      });
      throw error;
    }
  }

  private async validatePrerequisites(): Promise<void> {
    databaseLogger.info('Validating migration prerequisites', {
      operation: 'validation'
    });

    // Check if KEK-managed encryption key exists
    const keyManager = EncryptionKeyManager.getInstance();

    if (!this.config.masterPassword) {
      // Try to get current key from KEK manager
      try {
        const currentKey = keyManager.getCurrentKey();
        if (!currentKey) {
          // Initialize key if not available
          const initializedKey = await keyManager.initializeKey();
          this.config.masterPassword = initializedKey;
        } else {
          this.config.masterPassword = currentKey;
        }
      } catch (error) {
        throw new Error('Failed to retrieve encryption key from KEK manager. Please ensure encryption is properly initialized.');
      }
    }

    // Validate key strength
    if (this.config.masterPassword.length < 16) {
      throw new Error('Master password must be at least 16 characters long');
    }

    // Test database connection
    try {
      await db.select().from(settings).limit(1);
    } catch (error) {
      throw new Error('Database connection failed');
    }

    databaseLogger.success('Prerequisites validation passed', {
      operation: 'validation_complete',
      keySource: 'kek_manager'
    });
  }

  private async createBackup(): Promise<void> {
    databaseLogger.info('Creating database backup before migration', {
      operation: 'backup_start'
    });

    try {
      const fs = await import('fs');
      const path = await import('path');
      const dataDir = process.env.DATA_DIR || './db/data';
      const dbPath = path.join(dataDir, 'db.sqlite');
      const backupPath = path.join(dataDir, `db-backup-${Date.now()}.sqlite`);

      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, backupPath);
        databaseLogger.success(`Database backup created: ${backupPath}`, {
          operation: 'backup_complete',
          backupPath
        });
      }
    } catch (error) {
      databaseLogger.error('Failed to create backup', error, {
        operation: 'backup_failed'
      });
      throw error;
    }
  }

  private async initializeEncryption(): Promise<void> {
    databaseLogger.info('Initializing encryption system', {
      operation: 'encryption_init'
    });

    DatabaseEncryption.initialize({
      masterPassword: this.config.masterPassword!,
      encryptionEnabled: true,
      forceEncryption: this.config.forceEncryption,
      migrateOnAccess: true
    });

    const isHealthy = await EncryptedDBOperations.healthCheck();
    if (!isHealthy) {
      throw new Error('Encryption system health check failed');
    }

    databaseLogger.success('Encryption system initialized successfully', {
      operation: 'encryption_init_complete'
    });
  }

  private async migrateTables(): Promise<void> {
    const tables: Array<'users' | 'ssh_data' | 'ssh_credentials'> = [
      'users',
      'ssh_data',
      'ssh_credentials'
    ];

    let totalMigrated = 0;

    for (const tableName of tables) {
      databaseLogger.info(`Starting migration for table: ${tableName}`, {
        operation: 'table_migration_start',
        table: tableName
      });

      try {
        if (this.config.dryRun) {
          databaseLogger.info(`[DRY RUN] Would migrate table: ${tableName}`, {
            operation: 'dry_run_table',
            table: tableName
          });
          continue;
        }

        const migratedCount = await EncryptedDBOperations.migrateExistingRecords(tableName);
        totalMigrated += migratedCount;

        databaseLogger.success(`Migration completed for table: ${tableName}`, {
          operation: 'table_migration_complete',
          table: tableName,
          migratedCount
        });

      } catch (error) {
        databaseLogger.error(`Migration failed for table: ${tableName}`, error, {
          operation: 'table_migration_failed',
          table: tableName
        });
        throw error;
      }
    }

    databaseLogger.success(`All tables migrated successfully`, {
      operation: 'all_tables_migrated',
      totalMigrated
    });
  }

  private async updateSettings(): Promise<void> {
    if (this.config.dryRun) {
      databaseLogger.info('[DRY RUN] Would update encryption settings', {
        operation: 'dry_run_settings'
      });
      return;
    }

    try {
      const encryptionSettings = [
        { key: 'encryption_enabled', value: 'true' },
        { key: 'encryption_migration_completed', value: new Date().toISOString() },
        { key: 'encryption_version', value: '1.0' }
      ];

      for (const setting of encryptionSettings) {
        const existing = await db.select().from(settings).where(eq(settings.key, setting.key));

        if (existing.length > 0) {
          await db.update(settings).set({ value: setting.value }).where(eq(settings.key, setting.key));
        } else {
          await db.insert(settings).values(setting);
        }
      }

      databaseLogger.success('Encryption settings updated', {
        operation: 'settings_updated'
      });

    } catch (error) {
      databaseLogger.error('Failed to update settings', error, {
        operation: 'settings_update_failed'
      });
      throw error;
    }
  }

  private async verifyMigration(): Promise<void> {
    databaseLogger.info('Verifying migration integrity', {
      operation: 'verification_start'
    });

    try {
      const status = DatabaseEncryption.getEncryptionStatus();

      if (!status.enabled || !status.configValid) {
        throw new Error('Encryption system verification failed');
      }

      const testResult = await this.performTestEncryption();
      if (!testResult) {
        throw new Error('Test encryption/decryption failed');
      }

      databaseLogger.success('Migration verification completed successfully', {
        operation: 'verification_complete',
        status
      });

    } catch (error) {
      databaseLogger.error('Migration verification failed', error, {
        operation: 'verification_failed'
      });
      throw error;
    }
  }

  private async performTestEncryption(): Promise<boolean> {
    try {
      const { FieldEncryption } = await import('./encryption.js');
      const testData = `test-data-${Date.now()}`;
      const testKey = FieldEncryption.getFieldKey(this.config.masterPassword!, 'test');

      const encrypted = FieldEncryption.encryptField(testData, testKey);
      const decrypted = FieldEncryption.decryptField(encrypted, testKey);

      return decrypted === testData;
    } catch {
      return false;
    }
  }

  static async checkMigrationStatus(): Promise<{
    isEncryptionEnabled: boolean;
    migrationCompleted: boolean;
    migrationRequired: boolean;
    migrationDate?: string;
  }> {
    try {
      const encryptionEnabled = await db.select().from(settings).where(eq(settings.key, 'encryption_enabled'));
      const migrationCompleted = await db.select().from(settings).where(eq(settings.key, 'encryption_migration_completed'));

      const isEncryptionEnabled = encryptionEnabled.length > 0 && encryptionEnabled[0].value === 'true';
      const isMigrationCompleted = migrationCompleted.length > 0;

      // Check if migration is actually required by looking for unencrypted sensitive data
      const migrationRequired = await this.checkIfMigrationRequired();

      return {
        isEncryptionEnabled,
        migrationCompleted: isMigrationCompleted,
        migrationRequired,
        migrationDate: isMigrationCompleted ? migrationCompleted[0].value : undefined
      };
    } catch (error) {
      databaseLogger.error('Failed to check migration status', error, {
        operation: 'status_check_failed'
      });
      throw error;
    }
  }

  static async checkIfMigrationRequired(): Promise<boolean> {
    try {
      // Import table schemas
      const { sshData, sshCredentials } = await import('../database/db/schema.js');

      // Check if there's any unencrypted sensitive data in ssh_data
      const sshDataCount = await db.select({ count: sql<number>`count(*)` }).from(sshData);
      if (sshDataCount[0].count > 0) {
        // Sample a few records to check if they contain unencrypted data
        const sampleData = await db.select().from(sshData).limit(5);
        for (const record of sampleData) {
          if (record.password && !this.looksEncrypted(record.password)) {
            return true; // Found unencrypted password
          }
          if (record.key && !this.looksEncrypted(record.key)) {
            return true; // Found unencrypted key
          }
        }
      }

      // Check if there's any unencrypted sensitive data in ssh_credentials
      const credentialsCount = await db.select({ count: sql<number>`count(*)` }).from(sshCredentials);
      if (credentialsCount[0].count > 0) {
        const sampleCredentials = await db.select().from(sshCredentials).limit(5);
        for (const record of sampleCredentials) {
          if (record.password && !this.looksEncrypted(record.password)) {
            return true; // Found unencrypted password
          }
          if (record.privateKey && !this.looksEncrypted(record.privateKey)) {
            return true; // Found unencrypted private key
          }
          if (record.keyPassword && !this.looksEncrypted(record.keyPassword)) {
            return true; // Found unencrypted key password
          }
        }
      }

      return false; // No unencrypted sensitive data found
    } catch (error) {
      databaseLogger.warn('Failed to check if migration required, assuming required', {
        operation: 'migration_check_failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return true; // If we can't check, assume migration is required for safety
    }
  }

  private static looksEncrypted(data: string): boolean {
    if (!data) return true; // Empty data doesn't need encryption

    try {
      // Check if it looks like our encrypted format: {"data":"...","iv":"...","tag":"..."}
      const parsed = JSON.parse(data);
      return !!(parsed.data && parsed.iv && parsed.tag);
    } catch {
      // If it's not JSON, check if it's a reasonable length for encrypted data
      // Encrypted data is typically much longer than plaintext
      return data.length > 100 && data.includes('='); // Base64-like characteristics
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config: MigrationConfig = {
    masterPassword: process.env.DB_ENCRYPTION_KEY,
    forceEncryption: process.env.FORCE_ENCRYPTION === 'true',
    backupEnabled: process.env.BACKUP_ENABLED !== 'false',
    dryRun: process.env.DRY_RUN === 'true'
  };

  const migration = new EncryptionMigration(config);

  migration.runMigration()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error.message);
      process.exit(1);
    });
}

export { EncryptionMigration };
export type { MigrationConfig };