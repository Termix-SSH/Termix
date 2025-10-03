import { FieldCrypto } from "./field-crypto.js";
import { LazyFieldEncryption } from "./lazy-field-encryption.js";
import { UserCrypto } from "./user-crypto.js";
import { databaseLogger } from "./logger.js";

class DataCrypto {
  private static userCrypto: UserCrypto;

  static initialize() {
    this.userCrypto = UserCrypto.getInstance();
  }

  static encryptRecord(
    tableName: string,
    record: any,
    userId: string,
    userDataKey: Buffer,
  ): any {
    const encryptedRecord = { ...record };
    const recordId = record.id || "temp-" + Date.now();

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

    return encryptedRecord;
  }

  static decryptRecord(
    tableName: string,
    record: any,
    userId: string,
    userDataKey: Buffer,
  ): any {
    if (!record) return record;

    const decryptedRecord = { ...record };
    const recordId = record.id;

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

    return decryptedRecord;
  }

  static decryptRecords(
    tableName: string,
    records: any[],
    userId: string,
    userDataKey: Buffer,
  ): any[] {
    if (!Array.isArray(records)) return records;
    return records.map((record) =>
      this.decryptRecord(tableName, record, userId, userDataKey),
    );
  }

  static async migrateUserSensitiveFields(
    userId: string,
    userDataKey: Buffer,
    db: any,
  ): Promise<{
    migrated: boolean;
    migratedTables: string[];
    migratedFieldsCount: number;
  }> {
    let migrated = false;
    const migratedTables: string[] = [];
    let migratedFieldsCount = 0;

    try {
      const { needsMigration, plaintextFields } =
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
        .all(userId);
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
            SET password = ?, key = ?, key_password = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `;
          db.prepare(updateQuery).run(
            updatedRecord.password || null,
            updatedRecord.key || null,
            updatedRecord.key_password || null,
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
        .all(userId);
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
            SET password = ?, key = ?, key_password = ?, private_key = ?, public_key = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `;
          db.prepare(updateQuery).run(
            updatedRecord.password || null,
            updatedRecord.key || null,
            updatedRecord.key_password || null,
            updatedRecord.private_key || null,
            updatedRecord.public_key || null,
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
        .get(userId);
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
            SET totp_secret = ?, totp_backup_codes = ?
            WHERE id = ?
          `;
          db.prepare(updateQuery).run(
            updatedRecord.totp_secret || null,
            updatedRecord.totp_backup_codes || null,
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
    db: any,
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
        { table: "ssh_data", fields: ["password", "key", "key_password"] },
        {
          table: "ssh_credentials",
          fields: [
            "password",
            "private_key",
            "key_password",
            "key",
            "public_key",
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
          const records = db
            .prepare(`SELECT * FROM ${table} WHERE user_id = ?`)
            .all(userId);

          for (const record of records) {
            const recordId = record.id.toString();
            let needsUpdate = false;
            const updatedRecord = { ...record };

            for (const fieldName of fields) {
              const fieldValue = record[fieldName];

              if (fieldValue && fieldValue.trim() !== "") {
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

  static encryptRecordForUser(
    tableName: string,
    record: any,
    userId: string,
  ): any {
    const userDataKey = this.validateUserAccess(userId);
    return this.encryptRecord(tableName, record, userId, userDataKey);
  }

  static decryptRecordForUser(
    tableName: string,
    record: any,
    userId: string,
  ): any {
    const userDataKey = this.validateUserAccess(userId);
    return this.decryptRecord(tableName, record, userId, userDataKey);
  }

  static decryptRecordsForUser(
    tableName: string,
    records: any[],
    userId: string,
  ): any[] {
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
    } catch (error) {
      return false;
    }
  }
}

export { DataCrypto };
