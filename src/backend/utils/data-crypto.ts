import { FieldCrypto } from "./field-crypto.js";
import { LazyFieldEncryption } from "./lazy-field-encryption.js";
import { UserCrypto } from "./user-crypto.js";
import { databaseLogger } from "./logger.js";

/**
 * DataCrypto - Simplified database encryption
 *
 * Linus principles:
 * - Remove all "backward compatibility" garbage
 * - Remove all special case handling
 * - Data is either properly encrypted or operation fails
 * - No legacy data concept
 */
class DataCrypto {
  private static userCrypto: UserCrypto;

  static initialize() {
    this.userCrypto = UserCrypto.getInstance();
    databaseLogger.info("DataCrypto initialized - no legacy compatibility", {
      operation: "data_crypto_init",
    });
  }

  /**
   * Encrypt record - simple and direct
   */
  static encryptRecord(tableName: string, record: any, userId: string, userDataKey: Buffer): any {
    const encryptedRecord = { ...record };
    const recordId = record.id || 'temp-' + Date.now();

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldCrypto.shouldEncryptField(tableName, fieldName) && value) {
        encryptedRecord[fieldName] = FieldCrypto.encryptField(
          value as string,
          userDataKey,
          recordId,
          fieldName
        );
      }
    }

    return encryptedRecord;
  }

  /**
   * Decrypt record with lazy encryption support
   * Handles both encrypted and plaintext fields (from migration)
   */
  static decryptRecord(tableName: string, record: any, userId: string, userDataKey: Buffer): any {
    if (!record) return record;

    const decryptedRecord = { ...record };
    const recordId = record.id;

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldCrypto.shouldEncryptField(tableName, fieldName) && value) {
        // Use lazy encryption to handle both plaintext and encrypted data
        decryptedRecord[fieldName] = LazyFieldEncryption.safeGetFieldValue(
          value as string,
          userDataKey,
          recordId,
          fieldName
        );
      }
    }

    return decryptedRecord;
  }

  /**
   * Batch decrypt
   */
  static decryptRecords(tableName: string, records: any[], userId: string, userDataKey: Buffer): any[] {
    if (!Array.isArray(records)) return records;
    return records.map((record) => this.decryptRecord(tableName, record, userId, userDataKey));
  }

  /**
   * Migrate user's plaintext sensitive fields to encrypted format
   * Called during user login to gradually encrypt legacy data
   */
  static async migrateUserSensitiveFields(
    userId: string,
    userDataKey: Buffer,
    db: any
  ): Promise<{
    migrated: boolean;
    migratedTables: string[];
    migratedFieldsCount: number;
  }> {
    let migrated = false;
    const migratedTables: string[] = [];
    let migratedFieldsCount = 0;

    try {
      databaseLogger.info("Starting user sensitive fields migration", {
        operation: "user_sensitive_migration_start",
        userId,
      });

      // Check if migration is needed
      const { needsMigration, plaintextFields } = await LazyFieldEncryption.checkUserNeedsMigration(
        userId,
        userDataKey,
        db
      );

      if (!needsMigration) {
        databaseLogger.info("No migration needed for user", {
          operation: "user_sensitive_migration_not_needed",
          userId,
        });
        return { migrated: false, migratedTables: [], migratedFieldsCount: 0 };
      }

      databaseLogger.info("User requires sensitive field migration", {
        operation: "user_sensitive_migration_required",
        userId,
        plaintextFieldsCount: plaintextFields.length,
      });

      // Process ssh_data table
      const sshDataRecords = db.prepare("SELECT * FROM ssh_data WHERE user_id = ?").all(userId);
      for (const record of sshDataRecords) {
        const sensitiveFields = LazyFieldEncryption.getSensitiveFieldsForTable('ssh_data');
        const { updatedRecord, migratedFields, needsUpdate } = LazyFieldEncryption.migrateRecordSensitiveFields(
          record,
          sensitiveFields,
          userDataKey,
          record.id.toString()
        );

        if (needsUpdate) {
          // Update the record in database
          const updateQuery = `
            UPDATE ssh_data
            SET password = ?, key = ?, key_password = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `;
          db.prepare(updateQuery).run(
            updatedRecord.password || null,
            updatedRecord.key || null,
            updatedRecord.key_password || null,
            record.id
          );

          migratedFieldsCount += migratedFields.length;
          if (!migratedTables.includes('ssh_data')) {
            migratedTables.push('ssh_data');
          }
          migrated = true;
        }
      }

      // Process ssh_credentials table
      const sshCredentialsRecords = db.prepare("SELECT * FROM ssh_credentials WHERE user_id = ?").all(userId);
      for (const record of sshCredentialsRecords) {
        const sensitiveFields = LazyFieldEncryption.getSensitiveFieldsForTable('ssh_credentials');
        const { updatedRecord, migratedFields, needsUpdate } = LazyFieldEncryption.migrateRecordSensitiveFields(
          record,
          sensitiveFields,
          userDataKey,
          record.id.toString()
        );

        if (needsUpdate) {
          // Update the record in database
          const updateQuery = `
            UPDATE ssh_credentials
            SET password = ?, key = ?, key_password = ?, private_key = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `;
          db.prepare(updateQuery).run(
            updatedRecord.password || null,
            updatedRecord.key || null,
            updatedRecord.key_password || null,
            updatedRecord.private_key || null,
            record.id
          );

          migratedFieldsCount += migratedFields.length;
          if (!migratedTables.includes('ssh_credentials')) {
            migratedTables.push('ssh_credentials');
          }
          migrated = true;
        }
      }

      // Process users table
      const userRecord = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (userRecord) {
        const sensitiveFields = LazyFieldEncryption.getSensitiveFieldsForTable('users');
        const { updatedRecord, migratedFields, needsUpdate } = LazyFieldEncryption.migrateRecordSensitiveFields(
          userRecord,
          sensitiveFields,
          userDataKey,
          userId
        );

        if (needsUpdate) {
          // Update the record in database
          const updateQuery = `
            UPDATE users
            SET totp_secret = ?, totp_backup_codes = ?
            WHERE id = ?
          `;
          db.prepare(updateQuery).run(
            updatedRecord.totp_secret || null,
            updatedRecord.totp_backup_codes || null,
            userId
          );

          migratedFieldsCount += migratedFields.length;
          if (!migratedTables.includes('users')) {
            migratedTables.push('users');
          }
          migrated = true;
        }
      }

      if (migrated) {
        databaseLogger.success("User sensitive fields migration completed", {
          operation: "user_sensitive_migration_success",
          userId,
          migratedTables,
          migratedFieldsCount,
        });
      }

      return { migrated, migratedTables, migratedFieldsCount };

    } catch (error) {
      databaseLogger.error("User sensitive fields migration failed", error, {
        operation: "user_sensitive_migration_failed",
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Don't throw error to avoid breaking user login
      return { migrated: false, migratedTables: [], migratedFieldsCount: 0 };
    }
  }

  /**
   * Get user data key
   */
  static getUserDataKey(userId: string): Buffer | null {
    return this.userCrypto.getUserDataKey(userId);
  }

  /**
   * Verify user access permissions - simple and direct
   */
  static validateUserAccess(userId: string): Buffer {
    const userDataKey = this.getUserDataKey(userId);
    if (!userDataKey) {
      throw new Error(`User ${userId} data not unlocked`);
    }
    return userDataKey;
  }

  /**
   * Convenience method: automatically get user key and encrypt
   */
  static encryptRecordForUser(tableName: string, record: any, userId: string): any {
    const userDataKey = this.validateUserAccess(userId);
    return this.encryptRecord(tableName, record, userId, userDataKey);
  }

  /**
   * Convenience method: automatically get user key and decrypt
   */
  static decryptRecordForUser(tableName: string, record: any, userId: string): any {
    const userDataKey = this.validateUserAccess(userId);
    return this.decryptRecord(tableName, record, userId, userDataKey);
  }

  /**
   * Convenience method: batch decrypt
   */
  static decryptRecordsForUser(tableName: string, records: any[], userId: string): any[] {
    const userDataKey = this.validateUserAccess(userId);
    return this.decryptRecords(tableName, records, userId, userDataKey);
  }

  /**
   * Check if user can access data
   */
  static canUserAccessData(userId: string): boolean {
    return this.userCrypto.isUserUnlocked(userId);
  }

  /**
   * Test encryption functionality
   */
  static testUserEncryption(userId: string): boolean {
    try {
      const userDataKey = this.getUserDataKey(userId);
      if (!userDataKey) return false;

      const testData = "test-" + Date.now();
      const encrypted = FieldCrypto.encryptField(testData, userDataKey, "test-record", "test-field");
      const decrypted = FieldCrypto.decryptField(encrypted, userDataKey, "test-record", "test-field");

      return decrypted === testData;
    } catch (error) {
      return false;
    }
  }
}

export { DataCrypto };