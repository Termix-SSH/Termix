import crypto from 'crypto';

interface EncryptedData {
  data: string;
  iv: string;
  tag: string;
  salt?: string;
}

interface EncryptionConfig {
  algorithm: string;
  keyLength: number;
  ivLength: number;
  saltLength: number;
  iterations: number;
}

class FieldEncryption {
  private static readonly CONFIG: EncryptionConfig = {
    algorithm: 'aes-256-gcm',
    keyLength: 32,
    ivLength: 16,
    saltLength: 32,
    iterations: 100000,
  };

  private static readonly ENCRYPTED_FIELDS = {
    users: ['password_hash', 'client_secret', 'totp_secret', 'totp_backup_codes', 'oidc_identifier'],
    ssh_data: ['password', 'key', 'keyPassword'],
    ssh_credentials: ['password', 'privateKey', 'keyPassword', 'key', 'publicKey']
  };

  static isEncrypted(value: string | null): boolean {
    if (!value) return false;
    try {
      const parsed = JSON.parse(value);
      return !!(parsed.data && parsed.iv && parsed.tag);
    } catch {
      return false;
    }
  }

  static deriveKey(password: string, salt: Buffer, keyType: string): Buffer {
    const masterKey = crypto.pbkdf2Sync(
      password,
      salt,
      this.CONFIG.iterations,
      this.CONFIG.keyLength,
      'sha256'
    );

    return Buffer.from(crypto.hkdfSync(
      'sha256',
      masterKey,
      salt,
      keyType,
      this.CONFIG.keyLength
    ));
  }

  static encrypt(plaintext: string, key: Buffer): EncryptedData {
    if (!plaintext) return { data: '', iv: '', tag: '' };

    const iv = crypto.randomBytes(this.CONFIG.ivLength);
    const cipher = crypto.createCipheriv(this.CONFIG.algorithm, key, iv) as any;
    cipher.setAAD(Buffer.from('termix-field-encryption'));

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    return {
      data: encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex')
    };
  }

  static decrypt(encryptedData: EncryptedData, key: Buffer): string {
    if (!encryptedData.data) return '';

    try {
      const decipher = crypto.createDecipheriv(this.CONFIG.algorithm, key, Buffer.from(encryptedData.iv, 'hex')) as any;
      decipher.setAAD(Buffer.from('termix-field-encryption'));
      decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));

      let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static encryptField(value: string, fieldKey: Buffer): string {
    if (!value) return '';
    if (this.isEncrypted(value)) return value;

    const encrypted = this.encrypt(value, fieldKey);
    return JSON.stringify(encrypted);
  }

  static decryptField(value: string, fieldKey: Buffer): string {
    if (!value) return '';
    if (!this.isEncrypted(value)) return value;

    try {
      const encrypted: EncryptedData = JSON.parse(value);
      return this.decrypt(encrypted, fieldKey);
    } catch (error) {
      throw new Error(`Field decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static getFieldKey(masterPassword: string, fieldType: string): Buffer {
    const salt = crypto.createHash('sha256').update(`termix-${fieldType}`).digest();
    return this.deriveKey(masterPassword, salt, fieldType);
  }

  static shouldEncryptField(tableName: string, fieldName: string): boolean {
    const tableFields = this.ENCRYPTED_FIELDS[tableName as keyof typeof this.ENCRYPTED_FIELDS];
    return tableFields ? tableFields.includes(fieldName) : false;
  }

  static generateSalt(): string {
    return crypto.randomBytes(this.CONFIG.saltLength).toString('hex');
  }

  static validateEncryptionHealth(encryptedValue: string, key: Buffer): boolean {
    try {
      if (!this.isEncrypted(encryptedValue)) return false;
      const decrypted = this.decryptField(encryptedValue, key);
      return decrypted !== '';
    } catch {
      return false;
    }
  }
}

export { FieldEncryption };
export type { EncryptedData, EncryptionConfig };