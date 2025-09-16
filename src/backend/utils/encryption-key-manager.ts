import crypto from 'crypto';
import { db } from '../database/db/index.js';
import { settings } from '../database/db/schema.js';
import { eq } from 'drizzle-orm';
import { databaseLogger } from './logger.js';
import { MasterKeyProtection } from './master-key-protection.js';

interface EncryptionKeyInfo {
  hasKey: boolean;
  keyId?: string;
  createdAt?: string;
  algorithm: string;
}

class EncryptionKeyManager {
  private static instance: EncryptionKeyManager;
  private currentKey: string | null = null;
  private keyInfo: EncryptionKeyInfo | null = null;

  private constructor() {}

  static getInstance(): EncryptionKeyManager {
    if (!this.instance) {
      this.instance = new EncryptionKeyManager();
    }
    return this.instance;
  }

  private encodeKey(key: string): string {
    return MasterKeyProtection.encryptMasterKey(key);
  }

  private decodeKey(encodedKey: string): string {
    if (MasterKeyProtection.isProtectedKey(encodedKey)) {
      return MasterKeyProtection.decryptMasterKey(encodedKey);
    }

    databaseLogger.warn('Found legacy base64-encoded key, migrating to KEK protection', {
      operation: 'key_migration_legacy'
    });
    const buffer = Buffer.from(encodedKey, 'base64');
    return buffer.toString('hex');
  }

  async initializeKey(): Promise<string> {
    databaseLogger.info('Initializing encryption key system...', {
      operation: 'key_init'
    });

    try {
      let existingKey = await this.getStoredKey();

      if (existingKey) {
        databaseLogger.success('Found existing encryption key', {
          operation: 'key_init',
          hasKey: true
        });
        this.currentKey = existingKey;
        return existingKey;
      }

      const environmentKey = process.env.DB_ENCRYPTION_KEY;
      if (environmentKey && environmentKey !== 'default-key-change-me') {
        if (!this.validateKeyStrength(environmentKey)) {
          databaseLogger.error('Environment encryption key is too weak', undefined, {
            operation: 'key_init',
            source: 'environment',
            keyLength: environmentKey.length
          });
          throw new Error('DB_ENCRYPTION_KEY is too weak. Must be at least 32 characters with good entropy.');
        }

        databaseLogger.info('Using encryption key from environment variable', {
          operation: 'key_init',
          source: 'environment'
        });

        await this.storeKey(environmentKey);
        this.currentKey = environmentKey;
        return environmentKey;
      }

      const newKey = await this.generateNewKey();
      databaseLogger.warn('Generated new encryption key - PLEASE BACKUP THIS KEY', {
        operation: 'key_init',
        generated: true,
        keyPreview: newKey.substring(0, 8) + '...'
      });

      return newKey;

    } catch (error) {
      databaseLogger.error('Failed to initialize encryption key', error, {
        operation: 'key_init_failed'
      });
      throw error;
    }
  }

  async generateNewKey(): Promise<string> {
    const newKey = crypto.randomBytes(32).toString('hex');
    const keyId = crypto.randomBytes(8).toString('hex');

    await this.storeKey(newKey, keyId);
    this.currentKey = newKey;

    databaseLogger.success('Generated new encryption key', {
      operation: 'key_generated',
      keyId,
      keyLength: newKey.length
    });

    return newKey;
  }

  private async storeKey(key: string, keyId?: string): Promise<void> {
    const now = new Date().toISOString();
    const id = keyId || crypto.randomBytes(8).toString('hex');

    const keyData = {
      key: this.encodeKey(key),
      keyId: id,
      createdAt: now,
      algorithm: 'aes-256-gcm'
    };

    const encodedData = JSON.stringify(keyData);

    try {
      const existing = await db.select().from(settings).where(eq(settings.key, 'db_encryption_key'));

      if (existing.length > 0) {
        await db.update(settings)
          .set({ value: encodedData })
          .where(eq(settings.key, 'db_encryption_key'));
      } else {
        await db.insert(settings).values({
          key: 'db_encryption_key',
          value: encodedData
        });
      }

      const existingCreated = await db.select().from(settings).where(eq(settings.key, 'encryption_key_created'));

      if (existingCreated.length > 0) {
        await db.update(settings)
          .set({ value: now })
          .where(eq(settings.key, 'encryption_key_created'));
      } else {
        await db.insert(settings).values({
          key: 'encryption_key_created',
          value: now
        });
      }

      this.keyInfo = {
        hasKey: true,
        keyId: id,
        createdAt: now,
        algorithm: 'aes-256-gcm'
      };

    } catch (error) {
      databaseLogger.error('Failed to store encryption key', error, {
        operation: 'key_store_failed'
      });
      throw error;
    }
  }

  private async getStoredKey(): Promise<string | null> {
    try {
      const result = await db.select().from(settings).where(eq(settings.key, 'db_encryption_key'));

      if (result.length === 0) {
        return null;
      }

      const encodedData = result[0].value;
      let keyData;

      try {
        keyData = JSON.parse(encodedData);
      } catch {
        databaseLogger.warn('Found legacy base64-encoded key data, migrating', {
          operation: 'key_data_migration_legacy'
        });
        keyData = JSON.parse(Buffer.from(encodedData, 'base64').toString());
      }

      this.keyInfo = {
        hasKey: true,
        keyId: keyData.keyId,
        createdAt: keyData.createdAt,
        algorithm: keyData.algorithm
      };

      const decodedKey = this.decodeKey(keyData.key);

      if (!MasterKeyProtection.isProtectedKey(keyData.key)) {
        databaseLogger.info('Auto-migrating legacy key to KEK protection', {
          operation: 'key_auto_migration',
          keyId: keyData.keyId
        });
        await this.storeKey(decodedKey, keyData.keyId);
      }

      return decodedKey;

    } catch (error) {
      databaseLogger.error('Failed to retrieve stored encryption key', error, {
        operation: 'key_retrieve_failed'
      });
      return null;
    }
  }

  getCurrentKey(): string | null {
    return this.currentKey;
  }

  async getKeyInfo(): Promise<EncryptionKeyInfo> {
    if (!this.keyInfo) {
      const hasKey = await this.getStoredKey() !== null;
      return {
        hasKey,
        algorithm: 'aes-256-gcm'
      };
    }
    return this.keyInfo;
  }

  async regenerateKey(): Promise<string> {
    databaseLogger.info('Regenerating encryption key', {
      operation: 'key_regenerate'
    });

    const oldKeyInfo = await this.getKeyInfo();
    const newKey = await this.generateNewKey();

    databaseLogger.warn('Encryption key regenerated - ALL DATA MUST BE RE-ENCRYPTED', {
      operation: 'key_regenerated',
      oldKeyId: oldKeyInfo.keyId,
      newKeyId: this.keyInfo?.keyId
    });

    return newKey;
  }

  private validateKeyStrength(key: string): boolean {
    if (key.length < 32) return false;

    const hasLower = /[a-z]/.test(key);
    const hasUpper = /[A-Z]/.test(key);
    const hasDigit = /\d/.test(key);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(key);

    const entropyTest = new Set(key).size / key.length;

    const complexity = Number(hasLower) + Number(hasUpper) + Number(hasDigit) + Number(hasSpecial);
    return complexity >= 3 && entropyTest > 0.4;
  }

  async validateKey(key?: string): Promise<boolean> {
    const testKey = key || this.currentKey;
    if (!testKey) return false;

    try {
      const testData = 'validation-test-' + Date.now();
      const testBuffer = Buffer.from(testKey, 'hex');

      if (testBuffer.length !== 32) {
        return false;
      }

      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', testBuffer, iv) as any;
      cipher.update(testData, 'utf8');
      cipher.final();
      cipher.getAuthTag();

      return true;
    } catch {
      return false;
    }
  }

  isInitialized(): boolean {
    return this.currentKey !== null;
  }

  async getEncryptionStatus() {
    const keyInfo = await this.getKeyInfo();
    const isValid = await this.validateKey();
    const kekProtected = await this.isKEKProtected();

    return {
      hasKey: keyInfo.hasKey,
      keyValid: isValid,
      keyId: keyInfo.keyId,
      createdAt: keyInfo.createdAt,
      algorithm: keyInfo.algorithm,
      initialized: this.isInitialized(),
      kekProtected,
      kekValid: kekProtected ? MasterKeyProtection.validateProtection() : false
    };
  }

  private async isKEKProtected(): Promise<boolean> {
    try {
      const result = await db.select().from(settings).where(eq(settings.key, 'db_encryption_key'));
      if (result.length === 0) return false;

      const keyData = JSON.parse(result[0].value);
      return MasterKeyProtection.isProtectedKey(keyData.key);
    } catch {
      return false;
    }
  }
}

export { EncryptionKeyManager };
export type { EncryptionKeyInfo };