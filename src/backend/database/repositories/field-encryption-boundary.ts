import { FieldCrypto } from "../../utils/field-crypto.js";
import { LazyFieldEncryption } from "../../utils/lazy-field-encryption.js";

const FIELD_ENCRYPTION_POLICY = {
  users: {
    sensitive: new Set([
      "passwordHash",
      "clientSecret",
      "totpSecret",
      "totpBackupCodes",
      "oidcIdentifier",
    ]),
    plaintext: new Set(["id", "username", "isAdmin", "isOidc"]),
  },
  ssh_data: {
    sensitive: new Set([
      "password",
      "key",
      "keyPassword",
      "sudoPassword",
      "autostartPassword",
      "autostartKey",
      "autostartKeyPassword",
      "socks5Password",
      "rdpPassword",
      "vncPassword",
      "telnetPassword",
    ]),
    plaintext: new Set([
      "id",
      "userId",
      "connectionType",
      "name",
      "ip",
      "port",
      "username",
      "folder",
      "tags",
      "authType",
      "credentialId",
    ]),
  },
  ssh_credentials: {
    sensitive: new Set([
      "password",
      "key",
      "privateKey",
      "publicKey",
      "keyPassword",
    ]),
    plaintext: new Set([
      "id",
      "userId",
      "name",
      "description",
      "folder",
      "tags",
      "authType",
      "username",
      "keyType",
      "detectedKeyType",
      "usageCount",
      "lastUsed",
    ]),
  },
  opkssh_tokens: {
    sensitive: new Set(["sshCert", "privateKey"]),
    plaintext: new Set(["id", "userId", "hostId", "createdAt", "expiresAt"]),
  },
  termix_identity_ca: {
    sensitive: new Set(["privateKey"]),
    plaintext: new Set(["id", "publicKey", "createdAt", "updatedAt"]),
  },
  vault_tokens: {
    sensitive: new Set(["sshCert", "privateKey"]),
    plaintext: new Set(["id", "userId", "profileId", "expiresAt"]),
  },
} as const;

type PolicyTable = keyof typeof FIELD_ENCRYPTION_POLICY;
export type FieldClassification = "sensitive" | "plaintext" | "unknown";

export class FieldEncryptionBoundary {
  static classifyField(
    tableName: string,
    fieldName: string,
  ): FieldClassification {
    const policy = this.getPolicy(tableName);
    if (!policy) return "unknown";
    if (policy.sensitive.has(fieldName)) return "sensitive";
    if (policy.plaintext.has(fieldName)) return "plaintext";
    return "unknown";
  }

  static getSensitiveFields(tableName: string): string[] {
    const policy = this.getPolicy(tableName);
    return policy ? [...policy.sensitive].sort() : [];
  }

  static encryptRecord<T extends Record<string, unknown>>(
    tableName: string,
    record: T,
    userDataKey: Buffer,
    recordId = record.id,
  ): T {
    const id = this.requireRecordId(recordId);
    const encryptedRecord: Record<string, unknown> = { ...record };

    for (const fieldName of this.getSensitiveFields(tableName)) {
      const value = encryptedRecord[fieldName];
      if (typeof value === "string" && value) {
        encryptedRecord[fieldName] = FieldCrypto.encryptField(
          value,
          userDataKey,
          id,
          fieldName,
        );
      }
    }

    return encryptedRecord as T;
  }

  static decryptRecord<T extends Record<string, unknown>>(
    tableName: string,
    record: T,
    userDataKey: Buffer,
    recordId = record.id,
  ): T {
    const id = this.requireRecordId(recordId);
    const decryptedRecord: Record<string, unknown> = { ...record };

    for (const fieldName of this.getSensitiveFields(tableName)) {
      const value = decryptedRecord[fieldName];
      if (typeof value === "string" && value) {
        decryptedRecord[fieldName] = LazyFieldEncryption.safeGetFieldValue(
          value,
          userDataKey,
          id,
          fieldName,
        );
      }
    }

    return decryptedRecord as T;
  }

  private static getPolicy(tableName: string) {
    return FIELD_ENCRYPTION_POLICY[tableName as PolicyTable];
  }

  private static requireRecordId(recordId: unknown): string {
    if (recordId === null || recordId === undefined || recordId === "") {
      throw new Error("Field encryption requires a stable record id.");
    }
    return String(recordId);
  }
}
