import { FieldCrypto } from "./field-crypto.js";
import { LazyFieldEncryption } from "./lazy-field-encryption.js";
import { UserKeyManager } from "./user-keys.js";
import { DatabaseSaveTrigger } from "./database-save-trigger.js";
import { databaseLogger } from "./logger.js";
import {
  createCurrentUserEncryptionMigrationStore,
  RawSqliteUserEncryptionMigrationStore,
  type LegacyDatabaseInstance,
  type UserEncryptionMigrationStore,
} from "./user-encryption-migration-store.js";

class DataCrypto {
  private static userKeys: UserKeyManager;

  static initialize() {
    this.userKeys = UserKeyManager.getInstance();
  }

  static encryptRecord<T extends Record<string, unknown>>(
    tableName: string,
    record: T,
    userId: string,
    userDataKey: Buffer,
  ): T {
    const encryptedRecord: Record<string, unknown> = { ...record };
    const recordId = String(record.id || "temp-" + Date.now());

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldCrypto.shouldEncryptField(tableName, fieldName) && value) {
        encryptedRecord[fieldName] = FieldCrypto.encryptField(
          value as string,
          userDataKey,
          recordId,
          fieldName,
        );
      }
    }

    return encryptedRecord as T;
  }

  static decryptRecord<T extends Record<string, unknown>>(
    tableName: string,
    record: T,
    userId: string,
    userDataKey: Buffer,
  ): T {
    if (!record) return record;

    const decryptedRecord: Record<string, unknown> = { ...record };
    const recordId = String(record.id);

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldCrypto.shouldEncryptField(tableName, fieldName) && value) {
        decryptedRecord[fieldName] = LazyFieldEncryption.safeGetFieldValue(
          value as string,
          userDataKey,
          recordId,
          fieldName,
        );
      }
    }

    return decryptedRecord as T;
  }

  static decryptRecords<T extends Record<string, unknown>>(
    tableName: string,
    records: T[],
    userId: string,
    userDataKey: Buffer,
  ): T[] {
    if (!Array.isArray(records)) return records;
    return records.map((record) =>
      this.decryptRecord(tableName, record, userId, userDataKey),
    );
  }

  static async migrateUserSensitiveFields(
    userId: string,
    userDataKey: Buffer,
    db: LegacyDatabaseInstance,
  ): Promise<{
    migrated: boolean;
    migratedTables: string[];
    migratedFieldsCount: number;
  }> {
    try {
      const store = new RawSqliteUserEncryptionMigrationStore(db);
      return await this.migrateUserSensitiveFieldsInStore(
        userId,
        userDataKey,
        store,
      );
    } catch (error) {
      databaseLogger.error("User sensitive fields migration failed", error, {
        operation: "user_sensitive_migration_failed",
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return { migrated: false, migratedTables: [], migratedFieldsCount: 0 };
    }
  }

  private static async migrateUserSensitiveFieldsInStore(
    userId: string,
    userDataKey: Buffer,
    store: UserEncryptionMigrationStore,
  ): Promise<{
    migrated: boolean;
    migratedTables: string[];
    migratedFieldsCount: number;
  }> {
    let migrated = false;
    const migratedTables: string[] = [];
    let migratedFieldsCount = 0;

    try {
      const { needsMigration } =
        await LazyFieldEncryption.checkUserNeedsMigration(
          userId,
          userDataKey,
          store,
        );

      if (!needsMigration) {
        return { migrated: false, migratedTables: [], migratedFieldsCount: 0 };
      }

      const sshDataRecords = store.listHostRecords(userId);
      for (const record of sshDataRecords) {
        const sensitiveFields =
          LazyFieldEncryption.getSensitiveFieldsForTable("ssh_data");
        const { updatedRecord, migratedFields, needsUpdate } =
          LazyFieldEncryption.migrateRecordSensitiveFields(
            record,
            sensitiveFields,
            userDataKey,
            record.id.toString(),
          );

        if (needsUpdate) {
          store.updateHostSensitiveFields(record.id, updatedRecord);

          migratedFieldsCount += migratedFields.length;
          if (!migratedTables.includes("ssh_data")) {
            migratedTables.push("ssh_data");
          }
          migrated = true;
        }
      }

      const sshCredentialsRecords = store.listCredentialRecords(userId);
      for (const record of sshCredentialsRecords) {
        const sensitiveFields =
          LazyFieldEncryption.getSensitiveFieldsForTable("ssh_credentials");
        const { updatedRecord, migratedFields, needsUpdate } =
          LazyFieldEncryption.migrateRecordSensitiveFields(
            record,
            sensitiveFields,
            userDataKey,
            record.id.toString(),
          );

        if (needsUpdate) {
          store.updateCredentialSensitiveFields(record.id, updatedRecord);

          migratedFieldsCount += migratedFields.length;
          if (!migratedTables.includes("ssh_credentials")) {
            migratedTables.push("ssh_credentials");
          }
          migrated = true;
        }
      }

      const userRecord = store.getUserRecord(userId);
      if (userRecord) {
        const sensitiveFields =
          LazyFieldEncryption.getSensitiveFieldsForTable("users");
        const { updatedRecord, migratedFields, needsUpdate } =
          LazyFieldEncryption.migrateRecordSensitiveFields(
            userRecord,
            sensitiveFields,
            userDataKey,
            userId,
          );

        if (needsUpdate) {
          store.updateUserSensitiveFields(userId, updatedRecord);

          migratedFieldsCount += migratedFields.length;
          if (!migratedTables.includes("users")) {
            migratedTables.push("users");
          }
          migrated = true;
        }
      }

      return { migrated, migratedTables, migratedFieldsCount };
    } catch (error) {
      databaseLogger.error("User sensitive fields migration failed", error, {
        operation: "user_sensitive_migration_failed",
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return { migrated: false, migratedTables: [], migratedFieldsCount: 0 };
    }
  }

  static async migrateCurrentUserSensitiveFields(
    userId: string,
    userDataKey: Buffer,
  ): Promise<{
    migrated: boolean;
    migratedTables: string[];
    migratedFieldsCount: number;
  }> {
    const result = await this.migrateUserSensitiveFieldsInStore(
      userId,
      userDataKey,
      await createCurrentUserEncryptionMigrationStore(),
    );

    if (result.migrated) {
      await DatabaseSaveTrigger.forceSave(
        "user_sensitive_migration_explicit_save",
      );
    }

    return result;
  }

  static getUserDataKey(userId: string): Buffer | null {
    return this.userKeys.tryGetUserDEK(userId);
  }

  static validateUserAccess(userId: string): Buffer {
    return this.userKeys.getUserDEK(userId);
  }

  static encryptRecordForUser<T extends Record<string, unknown>>(
    tableName: string,
    record: T,
    userId: string,
  ): T {
    const userDataKey = this.validateUserAccess(userId);
    return this.encryptRecord(tableName, record, userId, userDataKey);
  }

  static decryptRecordForUser<T extends Record<string, unknown>>(
    tableName: string,
    record: T,
    userId: string,
  ): T {
    const userDataKey = this.validateUserAccess(userId);
    return this.decryptRecord(tableName, record, userId, userDataKey);
  }

  static decryptRecordsForUser<T extends Record<string, unknown>>(
    tableName: string,
    records: T[],
    userId: string,
  ): T[] {
    const userDataKey = this.validateUserAccess(userId);
    return this.decryptRecords(tableName, records, userId, userDataKey);
  }

  static canUserAccessData(userId: string): boolean {
    return this.userKeys.tryGetUserDEK(userId) !== null;
  }

  static testUserEncryption(userId: string): boolean {
    try {
      const userDataKey = this.getUserDataKey(userId);
      if (!userDataKey) return false;

      const testData = "test-" + Date.now();
      const encrypted = FieldCrypto.encryptField(
        testData,
        userDataKey,
        "test-record",
        "test-field",
      );
      const decrypted = FieldCrypto.decryptField(
        encrypted,
        userDataKey,
        "test-record",
        "test-field",
      );

      return decrypted === testData;
    } catch {
      return false;
    }
  }
}

export { DataCrypto };
