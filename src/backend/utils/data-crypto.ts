import { FieldCrypto } from "./field-crypto.js";
import { LazyFieldEncryption } from "./lazy-field-encryption.js";
import { UserCrypto } from "./user-crypto.js";
import { databaseLogger } from "./logger.js";

interface DatabaseInstance {
  prepare: (sql: string) => {
    all: (param?: unknown) => DatabaseRecord[];
    get: (param?: unknown) => DatabaseRecord;
    run: (...params: unknown[]) => unknown;
  };
}

interface DatabaseRecord {
  id: number | string;
  [key: string]: unknown;
}

class DataCrypto {
  private static userCrypto: UserCrypto;

  static initialize() {
    this.userCrypto = UserCrypto.getInstance();
  }

  static encryptRecord<T extends Record<string, unknown>>(
    tableName: string,
    record: T,
    userId: string,
    userDataKey: Buffer,
  ): T {
    const encryptedRecord: Record<string, unknown> = { ...record };
    const recordId = record.id || "temp-" + Date.now();

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldCrypto.shouldEncryptField(tableName, fieldName) && value) {
        encryptedRecord[fieldName] = FieldCrypto.encryptField(
          value as string,
          userDataKey,
          recordId as string,
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
    const recordId = record.id;

    for (const [fieldName, value] of Object.entries(record)) {
      if (FieldCrypto.shouldEncryptField(tableName, fieldName) && value) {
        decryptedRecord[fieldName] = LazyFieldEncryption.safeGetFieldValue(
          value as string,
          userDataKey,
          recordId as string,
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
    db: DatabaseInstance,
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
          db,
        );

      if (!needsMigration) {
        return { migrated: false, migratedTables: [], migratedFieldsCount: 0 };
      }

      const sshDataRecords = db
        .prepare("SELECT * FROM ssh_data WHERE user_id = ?")
        .all(userId) as DatabaseRecord[];
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
          const updateQuery = `
            UPDATE ssh_data
            SET password = ?, key = ?, key_password = ?, key_type = ?, autostart_password = ?, autostart_key = ?, autostart_key_password = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `;
          db.prepare(updateQuery).run(
            updatedRecord.password || null,
            updatedRecord.key || null,
            updatedRecord.key_password || updatedRecord.keyPassword || null,
            updatedRecord.keyType || null,
            updatedRecord.autostartPassword || null,
            updatedRecord.autostartKey || null,
            updatedRecord.autostartKeyPassword || null,
            record.id,
          );

          migratedFieldsCount += migratedFields.length;
          if (!migratedTables.includes("ssh_data")) {
            migratedTables.push("ssh_data");
          }
          migrated = true;
        }
      }

      const sshCredentialsRecords = db
        .prepare("SELECT * FROM ssh_credentials WHERE user_id = ?")
        .all(userId) as DatabaseRecord[];
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
          const updateQuery = `
            UPDATE ssh_credentials
            SET password = ?, key = ?, key_password = ?, private_key = ?, public_key = ?, key_type = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `;
          db.prepare(updateQuery).run(
            updatedRecord.password || null,
            updatedRecord.key || null,
            updatedRecord.key_password || updatedRecord.keyPassword || null,
            updatedRecord.private_key || updatedRecord.privateKey || null,
            updatedRecord.public_key || updatedRecord.publicKey || null,
            updatedRecord.keyType || null,
            record.id,
          );

          migratedFieldsCount += migratedFields.length;
          if (!migratedTables.includes("ssh_credentials")) {
            migratedTables.push("ssh_credentials");
          }
          migrated = true;
        }
      }

      const userRecord = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(userId) as DatabaseRecord | undefined;
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
          const updateQuery = `
            UPDATE users
            SET totp_secret = ?, totp_backup_codes = ?, client_secret = ?, oidc_identifier = ?
            WHERE id = ?
          `;
          db.prepare(updateQuery).run(
            updatedRecord.totp_secret || updatedRecord.totpSecret || null,
            updatedRecord.totp_backup_codes ||
              updatedRecord.totpBackupCodes ||
              null,
            updatedRecord.client_secret || updatedRecord.clientSecret || null,
            updatedRecord.oidc_identifier ||
              updatedRecord.oidcIdentifier ||
              null,
            userId,
          );

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

  static getUserDataKey(userId: string): Buffer | null {
    return this.userCrypto.getUserDataKey(userId);
  }

  static async reencryptUserDataAfterPasswordReset(
    userId: string,
    newUserDataKey: Buffer,
    db: DatabaseInstance,
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
      const tablesToReencrypt = [
        {
          table: "ssh_data",
          fields: [
            "password",
            "key",
            "key_password",
            "keyPassword",
            "keyType",
            "autostartPassword",
            "autostartKey",
            "autostartKeyPassword",
          ],
        },
        {
          table: "ssh_credentials",
          fields: [
            "password",
            "private_key",
            "privateKey",
            "key_password",
            "keyPassword",
            "key",
            "public_key",
            "publicKey",
            "keyType",
          ],
        },
        {
          table: "users",
          fields: [
            "client_secret",
            "clientSecret",
            "totp_secret",
            "totpSecret",
            "totp_backup_codes",
            "totpBackupCodes",
            "oidc_identifier",
            "oidcIdentifier",
          ],
        },
      ];

      for (const { table, fields } of tablesToReencrypt) {
        try {
          const records = db
            .prepare(`SELECT * FROM ${table} WHERE user_id = ?`)
            .all(userId) as DatabaseRecord[];

          for (const record of records) {
            const recordId = record.id.toString();
            const updatedRecord: DatabaseRecord = { ...record };
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
                const updateQuery = `UPDATE ${table} SET ${updateFields.map((f) => `${f} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
                const updateValues = updateFields.map(
                  (field) => updatedRecord[field],
                );
                updateValues.push(record.id);

                db.prepare(updateQuery).run(...updateValues);

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

      databaseLogger.info(
        "User data re-encryption completed after password reset",
        {
          operation: "password_reset_reencrypt_completed",
          userId,
          success: result.success,
          reencryptedTables: result.reencryptedTables,
          reencryptedFieldsCount: result.reencryptedFieldsCount,
          errorsCount: result.errors.length,
        },
      );

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
    const userDataKey = this.getUserDataKey(userId);
    if (!userDataKey) {
      throw new Error(`User ${userId} data not unlocked`);
    }
    return userDataKey;
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
    return this.userCrypto.isUserUnlocked(userId);
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
