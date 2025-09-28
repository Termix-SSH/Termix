import { FieldCrypto } from "./field-crypto.js";
import { databaseLogger } from "./logger.js";

export class LazyFieldEncryption {
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
  ): { encrypted: string; wasPlaintext: boolean } {
    if (!fieldValue) {
      return { encrypted: "", wasPlaintext: false };
    }

    if (this.isPlaintextField(fieldValue)) {
      try {
        const encrypted = FieldCrypto.encryptField(
          fieldValue,
          userKEK,
          recordId,
          fieldName,
        );

        return { encrypted, wasPlaintext: true };
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
      return { encrypted: fieldValue, wasPlaintext: false };
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

      if (fieldValue && this.isPlaintextField(fieldValue)) {
        try {
          const { encrypted } = this.migrateFieldToEncrypted(
            fieldValue,
            userKEK,
            recordId,
            fieldName,
          );

          updatedRecord[fieldName] = encrypted;
          migratedFields.push(fieldName);
          needsUpdate = true;
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
      ssh_credentials: ["password", "key", "key_password", "private_key"],
      users: ["totp_secret", "totp_backup_codes"],
    };

    return sensitiveFieldsMap[tableName] || [];
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
          if (host[field] && this.isPlaintextField(host[field])) {
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
          if (credential[field] && this.isPlaintextField(credential[field])) {
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
          if (user[field] && this.isPlaintextField(user[field])) {
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
