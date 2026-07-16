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
  type UserEncryptionMigrationRecord,
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

  static async reencryptUserDataAfterPasswordReset(
    userId: string,
    newUserDataKey: Buffer,
    db: LegacyDatabaseInstance,
  ): Promise<{
    success: boolean;
    reencryptedTables: string[];
    reencryptedFieldsCount: number;
    errors: string[];
  }> {
    const result = {
      success: false,
      reencryptedTables: [] as string[],
      reencryptedFieldsCount: 0,
      errors: [] as string[],
    };

    try {
      const store = new RawSqliteUserEncryptionMigrationStore(db);
      type PasswordResetTable = Parameters<
        UserEncryptionMigrationStore["updatePasswordResetFields"]
      >[0];
      const tablesToReencrypt: Array<{
        table: PasswordResetTable;
        fields: string[];
      }> = [
        {
          table: "ssh_data",
          fields: [
            "password",
            "key",
            "key_password",
            "sudo_password",
            "autostart_password",
            "autostart_key",
            "autostart_key_password",
          ],
        },
        {
          table: "ssh_credentials",
          fields: [
            "password",
            "key",
            "private_key",
            "public_key",
            "key_password",
          ],
        },
        {
          table: "users",
          fields: [
            "client_secret",
            "totp_secret",
            "totp_backup_codes",
            "oidc_identifier",
          ],
        },
      ];

      for (const { table, fields } of tablesToReencrypt) {
        try {
          const records =
            table === "ssh_data"
              ? store.listHostRecords(userId)
              : table === "ssh_credentials"
                ? store.listCredentialRecords(userId)
                : [store.getUserRecord(userId)].filter(
                    (record): record is UserEncryptionMigrationRecord =>
                      Boolean(record),
                  );

          for (const record of records) {
            const recordId = record.id.toString();
            const updatedRecord: UserEncryptionMigrationRecord = { ...record };
            let needsUpdate = false;

            for (const fieldName of fields) {
              const fieldValue = record[fieldName];

              if (
                fieldValue &&
                typeof fieldValue === "string" &&
                fieldValue.trim() !== ""
              ) {
                try {
                  const reencryptedValue = FieldCrypto.encryptField(
                    fieldValue,
                    newUserDataKey,
                    recordId,
                    fieldName,
                  );

                  updatedRecord[fieldName] = reencryptedValue;
                  needsUpdate = true;
                  result.reencryptedFieldsCount++;
                } catch (error) {
                  const errorMsg = `Failed to re-encrypt ${fieldName} for ${table} record ${recordId}: ${error instanceof Error ? error.message : "Unknown error"}`;
                  result.errors.push(errorMsg);
                  databaseLogger.warn(
                    "Field re-encryption failed during password reset",
                    {
                      operation: "password_reset_reencrypt_failed",
                      userId,
                      table,
                      recordId,
                      fieldName,
                      error:
                        error instanceof Error
                          ? error.message
                          : "Unknown error",
                    },
                  );
                }
              }
            }

            if (needsUpdate) {
              const updateFields = fields.filter(
                (field) => updatedRecord[field] !== record[field],
              );
              if (updateFields.length > 0) {
                store.updatePasswordResetFields(
                  table,
                  record.id,
                  updateFields,
                  updatedRecord,
                );

                if (!result.reencryptedTables.includes(table)) {
                  result.reencryptedTables.push(table);
                }
              }
            }
          }
        } catch (tableError) {
          const errorMsg = `Failed to re-encrypt table ${table}: ${tableError instanceof Error ? tableError.message : "Unknown error"}`;
          result.errors.push(errorMsg);
          databaseLogger.error(
            "Table re-encryption failed during password reset",
            tableError,
            {
              operation: "password_reset_table_reencrypt_failed",
              userId,
              table,
              error:
                tableError instanceof Error
                  ? tableError.message
                  : "Unknown error",
            },
          );
        }
      }

      result.success = result.errors.length === 0;

      return result;
    } catch (error) {
      databaseLogger.error(
        "User data re-encryption failed after password reset",
        error,
        {
          operation: "password_reset_reencrypt_failed",
          userId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );

      result.errors.push(
        `Critical error during re-encryption: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return result;
    }
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
