import crypto from "crypto";

interface EncryptedData {
  data: string;
  iv: string;
  tag: string;
  salt: string;
  recordId: string;
}

/** A sealed value that belongs to a different record. */
class FieldBindingError extends Error {
  constructor(fieldName: string) {
    super(`Encrypted ${fieldName} belongs to a different record`);
    this.name = "FieldBindingError";
  }
}

class FieldCrypto {
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly KEY_LENGTH = 32;
  private static readonly IV_LENGTH = 16;
  private static readonly SALT_LENGTH = 32;

  private static readonly ENCRYPTED_FIELDS = {
    users: new Set(["passwordHash"]),
    ssh_data: new Set([
      "password",
      "key",
      "keyPassword",
      "sudoPassword",
      "socks5Password",
    ]),
    ssh_credentials: new Set([
      "password",
      "privateKey",
      "keyPassword",
      "key",
      "publicKey",
    ]),
    // Channel configs hold ntfy tokens, webhook auth headers and Discord
    // webhook URLs, which are credentials like any other.
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

  /**
   * Whether a stored value is one of our envelopes rather than plaintext.
   * Some encrypted fields hold JSON themselves, so parsing is not enough; the
   * envelope's own keys have to be present.
   */
  static isEncrypted(value: string): boolean {
    if (!value || !value.startsWith("{")) return false;
    try {
      const parsed = JSON.parse(value) as Partial<EncryptedData>;
      return (
        typeof parsed?.data === "string" &&
        typeof parsed?.iv === "string" &&
        typeof parsed?.tag === "string" &&
        typeof parsed?.salt === "string"
      );
    } catch {
      return false;
    }
  }

  /** The record id a sealed value was bound to, or null for anything else. */
  static sealedRecordId(value: string): string | null {
    if (!this.isEncrypted(value)) return null;
    const parsed = JSON.parse(value) as Partial<EncryptedData>;
    return typeof parsed.recordId === "string" && parsed.recordId
      ? parsed.recordId
      : null;
  }

  /**
   * Opens a value sealed for `recordId`. A value sealed for another record is
   * refused, so a secret copied between rows does not open in its new place.
   */
  static decryptField(
    encryptedValue: string,
    masterKey: Buffer,
    recordId: string,
    fieldName: string,
  ): string {
    if (!encryptedValue) return "";
    const sealedFor = this.sealedRecordId(encryptedValue);
    if (sealedFor !== null && sealedFor !== String(recordId)) {
      throw new FieldBindingError(fieldName);
    }
    return this.decryptSealedField(encryptedValue, masterKey, fieldName);
  }

  /**
   * Opens a value under whatever record id it carries. Only for one-off
   * upgrade code that moves old values to their real record id.
   */
  static decryptSealedField(
    encryptedValue: string,
    masterKey: Buffer,
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
      { authTagLength: 16 },
    ) as crypto.DecipherGCM;
    decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));

    let decrypted = decipher.update(encrypted.data, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /** The encrypted fields of a table, as property names. */
  static fieldsFor(tableName: string): string[] {
    const fields =
      this.ENCRYPTED_FIELDS[tableName as keyof typeof this.ENCRYPTED_FIELDS];
    return fields ? [...fields] : [];
  }

  static shouldEncryptField(tableName: string, fieldName: string): boolean {
    const fields =
      this.ENCRYPTED_FIELDS[tableName as keyof typeof this.ENCRYPTED_FIELDS];
    return fields ? fields.has(fieldName) : false;
  }
}

export { FieldCrypto, FieldBindingError, type EncryptedData };
