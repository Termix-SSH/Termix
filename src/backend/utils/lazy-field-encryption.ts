import { FieldCrypto } from "./field-crypto.js";
import { databaseLogger } from "./logger.js";

export class LazyFieldEncryption {
  private static readonly LEGACY_FIELD_NAME_MAP: Record<string, string> = {
    key_password: "keyPassword",
    private_key: "privateKey",
    public_key: "publicKey",
    // Reverse mappings for Drizzle ORM (camelCase -> snake_case)
    keyPassword: "key_password",
    privateKey: "private_key",
    publicKey: "public_key",
  };

  static isPlaintextField(value: string): boolean {
    if (!value) return false;

    try {
      const parsed = JSON.parse(value);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.data &&
        parsed.iv &&
        parsed.tag &&
        parsed.salt &&
        parsed.recordId
      ) {
        return false;
      }
      return true;
    } catch (jsonError) {
      return true;
    }
  }

  static safeGetFieldValue(
    fieldValue: string,
    userKEK: Buffer,
    recordId: string,
    fieldName: string,
  ): string {
    if (!fieldValue) return "";

    if (this.isPlaintextField(fieldValue)) {
      return fieldValue;
    } else {
      try {
        const decrypted = FieldCrypto.decryptField(
          fieldValue,
          userKEK,
          recordId,
          fieldName,
        );
        return decrypted;
      } catch (error) {
        const legacyFieldName = this.LEGACY_FIELD_NAME_MAP[fieldName];
        if (legacyFieldName) {
          try {
            const decrypted = FieldCrypto.decryptField(
              fieldValue,
              userKEK,
              recordId,
              legacyFieldName,
            );
            return decrypted;
          } catch (legacyError) {}
        }

        const sensitiveFields = [
          "totp_secret",
          "totp_backup_codes",
          "password",
          "key",
          "key_password",
          "private_key",
          "public_key",
          "client_secret",
          "oidc_identifier",
        ];

        if (sensitiveFields.includes(fieldName)) {
          return "";
        }

        databaseLogger.error("Failed to decrypt field", error, {
          operation: "lazy_encryption_decrypt_failed",
          recordId,
          fieldName,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      }
    }
  }

  static migrateFieldToEncrypted(
    fieldValue: string,
    userKEK: Buffer,
    recordId: string,
    fieldName: string,
  ): {
    encrypted: string;
    wasPlaintext: boolean;
    wasLegacyEncryption: boolean;
  } {
    if (!fieldValue) {
      return { encrypted: "", wasPlaintext: false, wasLegacyEncryption: false };
    }

    if (this.isPlaintextField(fieldValue)) {
      try {
        const encrypted = FieldCrypto.encryptField(
          fieldValue,
          userKEK,
          recordId,
          fieldName,
        );

        return { encrypted, wasPlaintext: true, wasLegacyEncryption: false };
      } catch (error) {
        databaseLogger.error("Failed to encrypt plaintext field", error, {
          operation: "lazy_encryption_migrate_failed",
          recordId,
          fieldName,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      }
    } else {
      try {
        FieldCrypto.decryptField(fieldValue, userKEK, recordId, fieldName);
        return {
          encrypted: fieldValue,
          wasPlaintext: false,
          wasLegacyEncryption: false,
        };
      } catch (error) {
        const legacyFieldName = this.LEGACY_FIELD_NAME_MAP[fieldName];
        if (legacyFieldName) {
          try {
            const decrypted = FieldCrypto.decryptField(
              fieldValue,
              userKEK,
              recordId,
              legacyFieldName,
            );
            const reencrypted = FieldCrypto.encryptField(
              decrypted,
              userKEK,
              recordId,
              fieldName,
            );
            return {
              encrypted: reencrypted,
              wasPlaintext: false,
              wasLegacyEncryption: true,
            };
          } catch (legacyError) {}
        }
        return {
          encrypted: fieldValue,
          wasPlaintext: false,
          wasLegacyEncryption: false,
        };
      }
    }
  }

  static migrateRecordSensitiveFields(
    record: any,
    sensitiveFields: string[],
    userKEK: Buffer,
    recordId: string,
  ): {
    updatedRecord: any;
    migratedFields: string[];
    needsUpdate: boolean;
  } {
    const updatedRecord = { ...record };
    const migratedFields: string[] = [];
    let needsUpdate = false;

    for (const fieldName of sensitiveFields) {
      const fieldValue = record[fieldName];

      if (fieldValue) {
        try {
          const { encrypted, wasPlaintext, wasLegacyEncryption } =
            this.migrateFieldToEncrypted(
              fieldValue,
              userKEK,
              recordId,
              fieldName,
            );

          if (wasPlaintext || wasLegacyEncryption) {
            updatedRecord[fieldName] = encrypted;
            migratedFields.push(fieldName);
            needsUpdate = true;
          }
        } catch (error) {
          databaseLogger.error("Failed to migrate record field", error, {
            operation: "lazy_encryption_record_field_failed",
            recordId,
            fieldName,
          });
        }
      }
    }

    return { updatedRecord, migratedFields, needsUpdate };
  }

  static getSensitiveFieldsForTable(tableName: string): string[] {
    const sensitiveFieldsMap: Record<string, string[]> = {
      ssh_data: ["password", "key", "key_password"],
      ssh_credentials: [
        "password",
        "key",
        "key_password",
        "private_key",
        "public_key",
      ],
      users: ["totp_secret", "totp_backup_codes"],
    };

    return sensitiveFieldsMap[tableName] || [];
  }

  static fieldNeedsMigration(
    fieldValue: string,
    userKEK: Buffer,
    recordId: string,
    fieldName: string,
  ): boolean {
    if (!fieldValue) return false;

    if (this.isPlaintextField(fieldValue)) {
      return true;
    }

    try {
      FieldCrypto.decryptField(fieldValue, userKEK, recordId, fieldName);
      return false;
    } catch (error) {
      const legacyFieldName = this.LEGACY_FIELD_NAME_MAP[fieldName];
      if (legacyFieldName) {
        try {
          FieldCrypto.decryptField(
            fieldValue,
            userKEK,
            recordId,
            legacyFieldName,
          );
          return true;
        } catch (legacyError) {
          return false;
        }
      }
      return false;
    }
  }

  static async checkUserNeedsMigration(
    userId: string,
    userKEK: Buffer,
    db: any,
  ): Promise<{
    needsMigration: boolean;
    plaintextFields: Array<{
      table: string;
      recordId: string;
      fields: string[];
    }>;
  }> {
    const plaintextFields: Array<{
      table: string;
      recordId: string;
      fields: string[];
    }> = [];
    let needsMigration = false;

    try {
      const sshHosts = db
        .prepare("SELECT * FROM ssh_data WHERE user_id = ?")
        .all(userId);
      for (const host of sshHosts) {
        const sensitiveFields = this.getSensitiveFieldsForTable("ssh_data");
        const hostPlaintextFields: string[] = [];

        for (const field of sensitiveFields) {
          if (
            host[field] &&
            this.fieldNeedsMigration(
              host[field],
              userKEK,
              host.id.toString(),
              field,
            )
          ) {
            hostPlaintextFields.push(field);
            needsMigration = true;
          }
        }

        if (hostPlaintextFields.length > 0) {
          plaintextFields.push({
            table: "ssh_data",
            recordId: host.id.toString(),
            fields: hostPlaintextFields,
          });
        }
      }

      const sshCredentials = db
        .prepare("SELECT * FROM ssh_credentials WHERE user_id = ?")
        .all(userId);
      for (const credential of sshCredentials) {
        const sensitiveFields =
          this.getSensitiveFieldsForTable("ssh_credentials");
        const credentialPlaintextFields: string[] = [];

        for (const field of sensitiveFields) {
          if (
            credential[field] &&
            this.fieldNeedsMigration(
              credential[field],
              userKEK,
              credential.id.toString(),
              field,
            )
          ) {
            credentialPlaintextFields.push(field);
            needsMigration = true;
          }
        }

        if (credentialPlaintextFields.length > 0) {
          plaintextFields.push({
            table: "ssh_credentials",
            recordId: credential.id.toString(),
            fields: credentialPlaintextFields,
          });
        }
      }

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      if (user) {
        const sensitiveFields = this.getSensitiveFieldsForTable("users");
        const userPlaintextFields: string[] = [];

        for (const field of sensitiveFields) {
          if (
            user[field] &&
            this.fieldNeedsMigration(user[field], userKEK, userId, field)
          ) {
            userPlaintextFields.push(field);
            needsMigration = true;
          }
        }

        if (userPlaintextFields.length > 0) {
          plaintextFields.push({
            table: "users",
            recordId: userId,
            fields: userPlaintextFields,
          });
        }
      }

      return { needsMigration, plaintextFields };
    } catch (error) {
      databaseLogger.error("Failed to check user migration needs", error, {
        operation: "lazy_encryption_user_check_failed",
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return { needsMigration: false, plaintextFields: [] };
    }
  }
}
