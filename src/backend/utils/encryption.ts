import crypto from "crypto";

interface EncryptedData {
  data: string;
  iv: string;
  tag: string;
  salt: string;  // ALWAYS required - no more optional bullshit
}

class FieldEncryption {
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly KEY_LENGTH = 32;
  private static readonly IV_LENGTH = 16;
  private static readonly SALT_LENGTH = 32;

  private static readonly ENCRYPTED_FIELDS = {
    users: ["password_hash", "client_secret", "totp_secret", "totp_backup_codes", "oidc_identifier"],
    ssh_data: ["password", "key", "keyPassword"],
    ssh_credentials: ["password", "privateKey", "keyPassword", "key", "publicKey"],
  };

  static isEncrypted(value: string | null): boolean {
    if (!value) return false;
    try {
      const parsed = JSON.parse(value);
      return !!(parsed.data && parsed.iv && parsed.tag && parsed.salt);
    } catch {
      return false;
    }
  }

  // Each field gets unique random salt - NO MORE SHARED KEYS
  static encryptField(plaintext: string, masterKey: Buffer, recordId: string, fieldName: string): string {
    if (!plaintext) return "";
    if (this.isEncrypted(plaintext)) return plaintext; // Already encrypted

    // Generate unique salt for this specific field
    const salt = crypto.randomBytes(this.SALT_LENGTH);
    const context = `${recordId}:${fieldName}`;

    // Derive field-specific key using HKDF
    const fieldKey = Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, context, this.KEY_LENGTH));

    // Encrypt with AES-256-GCM
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, fieldKey, iv) as any;

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();

    const encryptedData: EncryptedData = {
      data: encrypted,
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      salt: salt.toString("hex"),
    };

    return JSON.stringify(encryptedData);
  }

  static decryptField(encryptedValue: string, masterKey: Buffer, recordId: string, fieldName: string): string {
    if (!encryptedValue) return "";
    if (!this.isEncrypted(encryptedValue)) return encryptedValue; // Plain text

    try {
      const encrypted: EncryptedData = JSON.parse(encryptedValue);

      // Reconstruct the same key derivation
      const salt = Buffer.from(encrypted.salt, "hex");
      const context = `${recordId}:${fieldName}`;
      const fieldKey = Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, context, this.KEY_LENGTH));

      // Decrypt
      const decipher = crypto.createDecipheriv(this.ALGORITHM, fieldKey, Buffer.from(encrypted.iv, "hex")) as any;
      decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));

      let decrypted = decipher.update(encrypted.data, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed for ${recordId}:${fieldName}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  static shouldEncryptField(tableName: string, fieldName: string): boolean {
    const tableFields = this.ENCRYPTED_FIELDS[tableName as keyof typeof this.ENCRYPTED_FIELDS];
    return tableFields ? tableFields.includes(fieldName) : false;
  }
}

export { FieldEncryption };
export type { EncryptedData };
