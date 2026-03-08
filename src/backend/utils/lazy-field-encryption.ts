import { FieldCrypto } from "./field-crypto.js";
import { databaseLogger } from "./logger.js";

interface DatabaseInstance {
  prepare: (sql: string) => {
    all: (param?: unknown) => unknown[];
    get: (param?: unknown) => unknown;
    run: (...params: unknown[]) => unknown;
  };
}

export class LazyFieldEncryption {
  private static readonly LEGACY_FIELD_NAME_MAP: Record<string, string> = {
    key_password: "keyPassword",
    private_key: "privateKey",
    public_key: "publicKey",
    password_hash: "passwordHash",
    client_secret: "clientSecret",
    totp_secret: "totpSecret",
    totp_backup_codes: "totpBackupCodes",
    oidc_identifier: "oidcIdentifier",

    keyPassword: "key_password",
    privateKey: "private_key",
    publicKey: "public_key",
    passwordHash: "password_hash",
    clientSecret: "client_secret",
    totpSecret: "totp_secret",
    totpBackupCodes: "totp_backup_codes",
    oidcIdentifier: "oidc_identifier",
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
    } catch {
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
          } catch {
            // expected - legacy decryption may fail, try other methods
          }
        }

        const sensitiveFields = [
          "totpSecret",
          "totpBackupCodes",
          "password",
          "key",
          "keyPassword",
          "privateKey",
          "publicKey",
          "clientSecret",
          "oidcIdentifier",
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
      } catch {
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
          } catch {
            // expected - re-encryption may fail, return original
          }
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
    record: Record<string, unknown>,
    sensitiveFields: string[],
    userKEK: Buffer,
    recordId: string,
  ): {
    updatedRecord: Record<string, unknown>;
    migratedFields: string[];
    needsUpdate: boolean;
  } {
    const updatedRecord = { ...record };
    const migratedFields: string[] = [];
    let needsUpdate = false;

    for (const fieldName of sensitiveFields) {
      const column = this.propertyToColumn(fieldName);
      const fieldValue = record[column] ?? record[fieldName];

      if (fieldValue) {
        try {
          const { encrypted, wasPlaintext, wasLegacyEncryption } =
            this.migrateFieldToEncrypted(
              fieldValue as string,
              userKEK,
              recordId,
              fieldName,
            );

          if (wasPlaintext || wasLegacyEncryption) {
            updatedRecord[column] = encrypted;
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

  private static readonly PROPERTY_TO_COLUMN: Record<string, string> = {
    keyPassword: "key_password",
    privateKey: "private_key",
    publicKey: "public_key",
    sudoPassword: "sudo_password",
    autostartPassword: "autostart_password",
    autostartKey: "autostart_key",
    autostartKeyPassword: "autostart_key_password",
    totpSecret: "totp_secret",
    totpBackupCodes: "totp_backup_codes",
    clientSecret: "client_secret",
    oidcIdentifier: "oidc_identifier",
  };

  static getSensitiveFieldsForTable(tableName: string): string[] {
    const sensitiveFieldsMap: Record<string, string[]> = {
      ssh_data: [
        "password",
        "key",
        "keyPassword",
        "sudoPassword",
        "autostartPassword",
        "autostartKey",
        "autostartKeyPassword",
      ],
      ssh_credentials: [
        "password",
        "key",
        "keyPassword",
        "privateKey",
        "publicKey",
      ],
      users: ["totpSecret", "totpBackupCodes"],
    };

    return sensitiveFieldsMap[tableName] || [];
  }

  static propertyToColumn(propertyName: string): string {
    return this.PROPERTY_TO_COLUMN[propertyName] || propertyName;
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
    } catch {
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
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  static async checkUserNeedsMigration(
    userId: string,
    userKEK: Buffer,
    db: DatabaseInstance,
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
        .all(userId) as Array<
        Record<string, unknown> & { id: string | number }
      >;
      for (const host of sshHosts) {
        const sensitiveFields = this.getSensitiveFieldsForTable("ssh_data");
        const hostPlaintextFields: string[] = [];

        for (const field of sensitiveFields) {
          const column = this.propertyToColumn(field);
          if (
            host[column] &&
            this.fieldNeedsMigration(
              host[column] as string,
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
        .all(userId) as Array<
        Record<string, unknown> & { id: string | number }
      >;
      for (const credential of sshCredentials) {
        const sensitiveFields =
          this.getSensitiveFieldsForTable("ssh_credentials");
        const credentialPlaintextFields: string[] = [];

        for (const field of sensitiveFields) {
          const column = this.propertyToColumn(field);
          if (
            credential[column] &&
            this.fieldNeedsMigration(
              credential[column] as string,
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
          const column = this.propertyToColumn(field);
          if (
            user[column] &&
            this.fieldNeedsMigration(user[column], userKEK, userId, field)
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
