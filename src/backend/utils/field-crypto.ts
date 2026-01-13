import crypto from "crypto";

interface EncryptedData {
  data: string;
  iv: string;
  tag: string;
  salt: string;
  recordId: string;
}

class FieldCrypto {
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly KEY_LENGTH = 32;
  private static readonly IV_LENGTH = 16;
  private static readonly SALT_LENGTH = 32;

  private static readonly ENCRYPTED_FIELDS = {
    users: new Set([
      "password_hash",
      "passwordHash",
      "client_secret",
      "clientSecret",
      "totp_secret",
      "totpSecret",
      "totp_backup_codes",
      "totpBackupCodes",
      "oidc_identifier",
      "oidcIdentifier",
    ]),
    ssh_data: new Set([
      "password",
      "key",
      "key_password",
      "keyPassword",
      "autostartPassword",
      "autostartKey",
      "autostartKeyPassword",
    ]),
    ssh_credentials: new Set([
      "password",
      "private_key",
      "privateKey",
      "key_password",
      "keyPassword",
      "key",
      "public_key",
      "publicKey",
    ]),
  };

  static encryptField(
    plaintext: string,
    masterKey: Buffer,
    recordId: string,
    fieldName: string,
  ): string {
    if (!plaintext) return "";

    const salt = crypto.randomBytes(this.SALT_LENGTH);
    const context = `${recordId}:${fieldName}`;
    const fieldKey = Buffer.from(
      crypto.hkdfSync("sha256", masterKey, salt, context, this.KEY_LENGTH),
    );

    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(
      this.ALGORITHM,
      fieldKey,
      iv,
    ) as crypto.CipherGCM;

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();

    const encryptedData: EncryptedData = {
      data: encrypted,
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      salt: salt.toString("hex"),
      recordId: recordId,
    };

    return JSON.stringify(encryptedData);
  }

  static decryptField(
    encryptedValue: string,
    masterKey: Buffer,
    recordId: string,
    fieldName: string,
  ): string {
    if (!encryptedValue) return "";

    const encrypted: EncryptedData = JSON.parse(encryptedValue);
    const salt = Buffer.from(encrypted.salt, "hex");

    if (!encrypted.recordId) {
      throw new Error(
        `Encrypted field missing recordId context - data corruption or legacy format not supported`,
      );
    }
    const context = `${encrypted.recordId}:${fieldName}`;
    const fieldKey = Buffer.from(
      crypto.hkdfSync("sha256", masterKey, salt, context, this.KEY_LENGTH),
    );

    const decipher = crypto.createDecipheriv(
      this.ALGORITHM,
      fieldKey,
      Buffer.from(encrypted.iv, "hex"),
    ) as crypto.DecipherGCM;
    decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));

    let decrypted = decipher.update(encrypted.data, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  static shouldEncryptField(tableName: string, fieldName: string): boolean {
    const fields =
      this.ENCRYPTED_FIELDS[tableName as keyof typeof this.ENCRYPTED_FIELDS];
    return fields ? fields.has(fieldName) : false;
  }
}

export { FieldCrypto, type EncryptedData };
