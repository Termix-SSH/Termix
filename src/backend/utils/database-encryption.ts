import { FieldEncryption } from './encryption.js';
import { EncryptionKeyManager } from './encryption-key-manager.js';
import { databaseLogger } from './logger.js';

interface EncryptionContext {
  masterPassword: string;
  encryptionEnabled: boolean;
  forceEncryption: boolean;
  migrateOnAccess: boolean;
}

class DatabaseEncryption {
  private static context: EncryptionContext | null = null;

  static async initialize(config: Partial<EncryptionContext> = {}) {
    const keyManager = EncryptionKeyManager.getInstance();
    const masterPassword = config.masterPassword || await keyManager.initializeKey();

    this.context = {
      masterPassword,
      encryptionEnabled: config.encryptionEnabled ?? true,
      forceEncryption: config.forceEncryption ?? false,
      migrateOnAccess: config.migrateOnAccess ?? true
    };

    databaseLogger.info('Database encryption initialized', {
      operation: 'encryption_init',
      enabled: this.context.encryptionEnabled,
      forceEncryption: this.context.forceEncryption,
      dynamicKey: !config.masterPassword
    });
  }

  static getContext(): EncryptionContext {
    if (!this.context) {
      throw new Error('DatabaseEncryption not initialized. Call initialize() first.');
    }
    return this.context;
  }

  static encryptRecord(tableName: string, record: any): any {
    const context = this.getContext();
    if (!context.encryptionEnabled) return record;

    const encryptedRecord = { ...record };
    let hasEncryption = false;

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldEncryption.shouldEncryptField(tableName, fieldName) && value) {
        try {
          const fieldKey = FieldEncryption.getFieldKey(context.masterPassword, `${tableName}.${fieldName}`);
          encryptedRecord[fieldName] = FieldEncryption.encryptField(value as string, fieldKey);
          hasEncryption = true;
        } catch (error) {
          databaseLogger.error(`Failed to encrypt field ${tableName}.${fieldName}`, error, {
            operation: 'field_encryption',
            table: tableName,
            field: fieldName
          });
          throw error;
        }
      }
    }

    if (hasEncryption) {
      databaseLogger.debug(`Encrypted sensitive fields for ${tableName}`, {
        operation: 'record_encryption',
        table: tableName
      });
    }

    return encryptedRecord;
  }

  static decryptRecord(tableName: string, record: any): any {
    const context = this.getContext();
    if (!record) return record;

    const decryptedRecord = { ...record };
    let hasDecryption = false;
    let needsMigration = false;

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldEncryption.shouldEncryptField(tableName, fieldName) && value) {
        try {
          const fieldKey = FieldEncryption.getFieldKey(context.masterPassword, `${tableName}.${fieldName}`);

          if (FieldEncryption.isEncrypted(value as string)) {
            decryptedRecord[fieldName] = FieldEncryption.decryptField(value as string, fieldKey);
            hasDecryption = true;
          } else if (context.encryptionEnabled && !context.forceEncryption) {
            decryptedRecord[fieldName] = value;
            needsMigration = context.migrateOnAccess;
          } else if (context.forceEncryption) {
            databaseLogger.warn(`Unencrypted field detected in force encryption mode`, {
              operation: 'decryption_warning',
              table: tableName,
              field: fieldName
            });
            decryptedRecord[fieldName] = value;
          }
        } catch (error) {
          databaseLogger.error(`Failed to decrypt field ${tableName}.${fieldName}`, error, {
            operation: 'field_decryption',
            table: tableName,
            field: fieldName
          });

          if (context.forceEncryption) {
            throw error;
          } else {
            decryptedRecord[fieldName] = value;
          }
        }
      }
    }

    if (hasDecryption) {
      databaseLogger.debug(`Decrypted sensitive fields for ${tableName}`, {
        operation: 'record_decryption',
        table: tableName
      });
    }

    if (needsMigration) {
      this.scheduleFieldMigration(tableName, record);
    }

    return decryptedRecord;
  }

  static decryptRecords(tableName: string, records: any[]): any[] {
    if (!Array.isArray(records)) return records;
    return records.map(record => this.decryptRecord(tableName, record));
  }

  private static scheduleFieldMigration(tableName: string, record: any) {
    setTimeout(async () => {
      try {
        await this.migrateRecord(tableName, record);
      } catch (error) {
        databaseLogger.error(`Failed to migrate record ${tableName}:${record.id}`, error, {
          operation: 'migration_failed',
          table: tableName,
          recordId: record.id
        });
      }
    }, 1000);
  }

  static async migrateRecord(tableName: string, record: any): Promise<any> {
    const context = this.getContext();
    if (!context.encryptionEnabled || !context.migrateOnAccess) return record;

    let needsUpdate = false;
    const updatedRecord = { ...record };

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldEncryption.shouldEncryptField(tableName, fieldName) &&
          value && !FieldEncryption.isEncrypted(value as string)) {
        try {
          const fieldKey = FieldEncryption.getFieldKey(context.masterPassword, `${tableName}.${fieldName}`);
          updatedRecord[fieldName] = FieldEncryption.encryptField(value as string, fieldKey);
          needsUpdate = true;
        } catch (error) {
          databaseLogger.error(`Failed to migrate field ${tableName}.${fieldName}`, error, {
            operation: 'field_migration',
            table: tableName,
            field: fieldName,
            recordId: record.id
          });
          throw error;
        }
      }
    }

    if (needsUpdate) {
      databaseLogger.info(`Migrated record to encrypted format`, {
        operation: 'record_migration',
        table: tableName,
        recordId: record.id
      });
    }

    return updatedRecord;
  }

  static validateConfiguration(): boolean {
    try {
      const context = this.getContext();
      const testData = 'test-encryption-data';
      const testKey = FieldEncryption.getFieldKey(context.masterPassword, 'test');

      const encrypted = FieldEncryption.encryptField(testData, testKey);
      const decrypted = FieldEncryption.decryptField(encrypted, testKey);

      return decrypted === testData;
    } catch (error) {
      databaseLogger.error('Encryption configuration validation failed', error, {
        operation: 'config_validation'
      });
      return false;
    }
  }

  static getEncryptionStatus() {
    try {
      const context = this.getContext();
      return {
        enabled: context.encryptionEnabled,
        forceEncryption: context.forceEncryption,
        migrateOnAccess: context.migrateOnAccess,
        configValid: this.validateConfiguration()
      };
    } catch {
      return {
        enabled: false,
        forceEncryption: false,
        migrateOnAccess: false,
        configValid: false
      };
    }
  }

  static async getDetailedStatus() {
    const keyManager = EncryptionKeyManager.getInstance();
    const keyStatus = await keyManager.getEncryptionStatus();
    const encryptionStatus = this.getEncryptionStatus();

    return {
      ...encryptionStatus,
      key: keyStatus,
      initialized: this.context !== null
    };
  }

  static async reinitializeWithNewKey(): Promise<void> {
    const keyManager = EncryptionKeyManager.getInstance();
    const newKey = await keyManager.regenerateKey();

    this.context = null;
    await this.initialize({ masterPassword: newKey });

    databaseLogger.warn('Database encryption reinitialized with new key', {
      operation: 'encryption_reinit',
      requiresMigration: true
    });
  }
}

export { DatabaseEncryption };
export type { EncryptionContext };