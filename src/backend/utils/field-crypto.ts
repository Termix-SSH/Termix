import crypto from "crypto";

interface EncryptedData {
  data: string;
  iv: string;
  tag: string;
  salt: string;
}

/**
 * FieldCrypto - 简单直接的字段加密
 *
 * Linus原则：
 * - 没有特殊情况
 * - 没有兼容性检查
 * - 数据要么加密，要么失败
 * - 不存在"legacy data"概念
 */
class FieldCrypto {
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly KEY_LENGTH = 32;
  private static readonly IV_LENGTH = 16;
  private static readonly SALT_LENGTH = 32;

  // 需要加密的字段 - 简单的映射，没有复杂逻辑
  private static readonly ENCRYPTED_FIELDS = {
    users: new Set(["password_hash", "client_secret", "totp_secret", "totp_backup_codes", "oidc_identifier"]),
    ssh_data: new Set(["password", "key", "keyPassword"]),
    ssh_credentials: new Set(["password", "privateKey", "keyPassword", "key", "publicKey"]),
  };

  /**
   * 加密字段 - 没有特殊情况
   */
  static encryptField(plaintext: string, masterKey: Buffer, recordId: string, fieldName: string): string {
    if (!plaintext) return "";

    const salt = crypto.randomBytes(this.SALT_LENGTH);
    const context = `${recordId}:${fieldName}`;
    const fieldKey = Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, context, this.KEY_LENGTH));

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

  /**
   * 解密字段 - 要么成功，要么失败，没有第三种情况
   */
  static decryptField(encryptedValue: string, masterKey: Buffer, recordId: string, fieldName: string): string {
    if (!encryptedValue) return "";

    const encrypted: EncryptedData = JSON.parse(encryptedValue);
    const salt = Buffer.from(encrypted.salt, "hex");
    const context = `${recordId}:${fieldName}`;
    const fieldKey = Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, context, this.KEY_LENGTH));

    const decipher = crypto.createDecipheriv(this.ALGORITHM, fieldKey, Buffer.from(encrypted.iv, "hex")) as any;
    decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));

    let decrypted = decipher.update(encrypted.data, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * 检查字段是否需要加密 - 简单查表，没有复杂逻辑
   */
  static shouldEncryptField(tableName: string, fieldName: string): boolean {
    const fields = this.ENCRYPTED_FIELDS[tableName as keyof typeof this.ENCRYPTED_FIELDS];
    return fields ? fields.has(fieldName) : false;
  }
}

export { FieldCrypto, type EncryptedData };