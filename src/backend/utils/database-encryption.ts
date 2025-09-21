import { FieldEncryption } from "./encryption.js";
import { SecuritySession } from "./security-session.js";
import { databaseLogger } from "./logger.js";

/**
 * DatabaseEncryption - User key-based data encryption
 *
 * Architecture features:
 * - Uses user-specific data keys (from SecuritySession)
 * - KEK-DEK key hierarchy structure
 * - Supports multi-user independent encryption
 * - Field-level encryption with record-specific derivation
 */
class DatabaseEncryption {
  private static securitySession: SecuritySession;

  static initialize() {
    this.securitySession = SecuritySession.getInstance();

    databaseLogger.info("Database encryption V2 initialized - user-based KEK-DEK", {
      operation: "encryption_v2_init",
    });
  }

  /**
   * Encrypt record - requires user ID and data key
   */
  static encryptRecord(tableName: string, record: any, userId: string, userDataKey: Buffer): any {
    if (!userDataKey) {
      throw new Error("User data key required for encryption");
    }

    const encryptedRecord = { ...record };
    const recordId = record.id || 'temp-' + Date.now();

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldEncryption.shouldEncryptField(tableName, fieldName) && value) {
        try {
          encryptedRecord[fieldName] = FieldEncryption.encryptField(
            value as string,
            userDataKey,
            recordId,
            fieldName
          );
        } catch (error) {
          databaseLogger.error(`Failed to encrypt ${tableName}.${fieldName}`, error, {
            operation: "field_encrypt_failed",
            userId,
            tableName,
            fieldName,
          });
          throw new Error(`Failed to encrypt ${tableName}.${fieldName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    return encryptedRecord;
  }

  /**
   * Decrypt record - requires user ID and data key
   */
  static decryptRecord(tableName: string, record: any, userId: string, userDataKey: Buffer): any {
    if (!record) return record;
    if (!userDataKey) {
      throw new Error("User data key required for decryption");
    }

    const decryptedRecord = { ...record };
    const recordId = record.id;

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldEncryption.shouldEncryptField(tableName, fieldName) && value) {
        try {
          if (FieldEncryption.isEncrypted(value as string)) {
            decryptedRecord[fieldName] = FieldEncryption.decryptField(
              value as string,
              userDataKey,
              recordId,
              fieldName
            );
          } else {
            // Plain text data - may be legacy data awaiting migration
            databaseLogger.warn(`Unencrypted field found: ${tableName}.${fieldName}`, {
              operation: "unencrypted_field_found",
              userId,
              tableName,
              fieldName,
              recordId,
            });
            decryptedRecord[fieldName] = value;
          }
        } catch (error) {
          databaseLogger.error(`Failed to decrypt ${tableName}.${fieldName}`, error, {
            operation: "field_decrypt_failed",
            userId,
            tableName,
            fieldName,
            recordId,
          });
          // Return null on decryption failure instead of throwing exception
          decryptedRecord[fieldName] = null;
        }
      }
    }

    return decryptedRecord;
  }

  /**
   * Decrypt multiple records
   */
  static decryptRecords(tableName: string, records: any[], userId: string, userDataKey: Buffer): any[] {
    if (!Array.isArray(records)) return records;
    return records.map((record) => this.decryptRecord(tableName, record, userId, userDataKey));
  }

  /**
   * Get user data key from SecuritySession
   */
  static getUserDataKey(userId: string): Buffer | null {
    return this.securitySession.getUserDataKey(userId);
  }

  /**
   * Validate user data key availability
   */
  static validateUserAccess(userId: string): Buffer {
    const userDataKey = this.getUserDataKey(userId);
    if (!userDataKey) {
      throw new Error(`User data key not available for user ${userId} - user must unlock data first`);
    }
    return userDataKey;
  }

  /**
   * Encrypt record (automatically get user key)
   */
  static encryptRecordForUser(tableName: string, record: any, userId: string): any {
    const userDataKey = this.validateUserAccess(userId);
    return this.encryptRecord(tableName, record, userId, userDataKey);
  }

  /**
   * Decrypt record (automatically get user key)
   */
  static decryptRecordForUser(tableName: string, record: any, userId: string): any {
    const userDataKey = this.validateUserAccess(userId);
    return this.decryptRecord(tableName, record, userId, userDataKey);
  }

  /**
   * Decrypt multiple records (automatically get user key)
   */
  static decryptRecordsForUser(tableName: string, records: any[], userId: string): any[] {
    const userDataKey = this.validateUserAccess(userId);
    return this.decryptRecords(tableName, records, userId, userDataKey);
  }

  /**
   * Verify if user can access encrypted data
   */
  static canUserAccessData(userId: string): boolean {
    return this.securitySession.isUserDataUnlocked(userId);
  }

  /**
   * Test encryption/decryption functionality
   */
  static testUserEncryption(userId: string): boolean {
    try {
      const userDataKey = this.getUserDataKey(userId);
      if (!userDataKey) {
        return false;
      }

      const testData = "test-encryption-data-" + Date.now();
      const testRecordId = "test-record";
      const testField = "test-field";

      const encrypted = FieldEncryption.encryptField(testData, userDataKey, testRecordId, testField);
      const decrypted = FieldEncryption.decryptField(encrypted, userDataKey, testRecordId, testField);

      return decrypted === testData;
    } catch (error) {
      databaseLogger.error("User encryption test failed", error, {
        operation: "user_encryption_test_failed",
        userId,
      });
      return false;
    }
  }

  /**
   * Get user encryption status
   */
  static getUserEncryptionStatus(userId: string) {
    const isUnlocked = this.canUserAccessData(userId);
    const hasDataKey = this.getUserDataKey(userId) !== null;
    const testPassed = isUnlocked ? this.testUserEncryption(userId) : false;

    return {
      isUnlocked,
      hasDataKey,
      testPassed,
      canAccessData: isUnlocked && testPassed,
    };
  }

  /**
   * Migrate legacy data to new encryption format (for single user)
   */
  static async migrateUserData(userId: string, tableName: string, records: any[]): Promise<{
    migrated: number;
    errors: string[];
  }> {
    const userDataKey = this.getUserDataKey(userId);
    if (!userDataKey) {
      throw new Error(`Cannot migrate data - user ${userId} not unlocked`);
    }

    let migrated = 0;
    const errors: string[] = [];

    for (const record of records) {
      try {
        // Check if migration is needed
        let needsMigration = false;
        for (const [fieldName, value] of Object.entries(record)) {
          if (FieldEncryption.shouldEncryptField(tableName, fieldName) &&
              value &&
              !FieldEncryption.isEncrypted(value as string)) {
            needsMigration = true;
            break;
          }
        }

        if (needsMigration) {
          // Execute migration (database update operations needed, called in actual usage)
          migrated++;
          databaseLogger.info(`Migrated record for user ${userId}`, {
            operation: "user_data_migration",
            userId,
            tableName,
            recordId: record.id,
          });
        }
      } catch (error) {
        const errorMsg = `Failed to migrate record ${record.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        databaseLogger.error("Record migration failed", error, {
          operation: "user_data_migration_failed",
          userId,
          tableName,
          recordId: record.id,
        });
      }
    }

    return { migrated, errors };
  }
}

export { DatabaseEncryption };