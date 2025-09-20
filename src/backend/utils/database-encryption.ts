import { FieldEncryption } from "./encryption.js";
import { EncryptionKeyManager } from "./encryption-key-manager.js";
import { databaseLogger } from "./logger.js";

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

    // Generate random master key for encryption
    const masterPassword = await keyManager.initializeKey();

    this.context = {
      masterPassword,
      encryptionEnabled: config.encryptionEnabled ?? true,
      forceEncryption: config.forceEncryption ?? false,
      migrateOnAccess: config.migrateOnAccess ?? false,
    };

    databaseLogger.info("Database encryption initialized with random keys", {
      operation: "encryption_init",
      enabled: this.context.encryptionEnabled,
      forceEncryption: this.context.forceEncryption,
    });
  }

  static getContext(): EncryptionContext {
    if (!this.context) {
      throw new Error(
        "DatabaseEncryption not initialized. Call initialize() first.",
      );
    }
    return this.context;
  }

  static encryptRecord(tableName: string, record: any): any {
    const context = this.getContext();
    if (!context.encryptionEnabled) return record;

    const encryptedRecord = { ...record };
    const masterKey = Buffer.from(context.masterPassword, 'hex');
    const recordId = record.id || 'temp-' + Date.now(); // Use record ID or temp ID

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldEncryption.shouldEncryptField(tableName, fieldName) && value) {
        try {
          encryptedRecord[fieldName] = FieldEncryption.encryptField(
            value as string,
            masterKey,
            recordId,
            fieldName
          );
        } catch (error) {
          throw new Error(`Failed to encrypt ${tableName}.${fieldName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    return encryptedRecord;
  }

  static decryptRecord(tableName: string, record: any): any {
    const context = this.getContext();
    if (!record) return record;

    const decryptedRecord = { ...record };
    const masterKey = Buffer.from(context.masterPassword, 'hex');
    const recordId = record.id;

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldEncryption.shouldEncryptField(tableName, fieldName) && value) {
        try {
          if (FieldEncryption.isEncrypted(value as string)) {
            decryptedRecord[fieldName] = FieldEncryption.decryptField(
              value as string,
              masterKey,
              recordId,
              fieldName
            );
          } else {
            // Plain text - keep as is or fail based on policy
            if (context.forceEncryption) {
              throw new Error(`Unencrypted field detected: ${tableName}.${fieldName}`);
            }
            decryptedRecord[fieldName] = value;
          }
        } catch (error) {
          if (context.forceEncryption) {
            throw error;
          } else {
            decryptedRecord[fieldName] = value; // Fallback to plain text
          }
        }
      }
    }

    return decryptedRecord;
  }

  static decryptRecords(tableName: string, records: any[]): any[] {
    if (!Array.isArray(records)) return records;
    return records.map((record) => this.decryptRecord(tableName, record));
  }

  // Migration logic removed - no more complex backward compatibility

  static validateConfiguration(): boolean {
    try {
      const context = this.getContext();
      const testData = "test-encryption-data";
      const masterKey = Buffer.from(context.masterPassword, 'hex');
      const testRecordId = "test-record";
      const testField = "test-field";

      const encrypted = FieldEncryption.encryptField(testData, masterKey, testRecordId, testField);
      const decrypted = FieldEncryption.decryptField(encrypted, masterKey, testRecordId, testField);

      return decrypted === testData;
    } catch {
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
        configValid: this.validateConfiguration(),
      };
    } catch {
      return {
        enabled: false,
        forceEncryption: false,
        migrateOnAccess: false,
        configValid: false,
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
      initialized: this.context !== null,
    };
  }

  static async reinitializeWithNewKey(): Promise<void> {
    const keyManager = EncryptionKeyManager.getInstance();
    const newKey = await keyManager.regenerateKey();

    this.context = null;
    await this.initialize();
  }
}

export { DatabaseEncryption };
export type { EncryptionContext };
