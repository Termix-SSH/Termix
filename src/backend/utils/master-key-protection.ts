import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { databaseLogger } from './logger.js';

interface ProtectedKeyData {
  data: string;
  iv: string;
  tag: string;
  version: string;
  fingerprint: string;
}

class MasterKeyProtection {
  private static readonly VERSION = 'v1';
  private static readonly KEK_SALT = 'termix-kek-salt-v1';
  private static readonly KEK_ITERATIONS = 50000;

  private static generateDeviceFingerprint(): string {
    try {
      const features = [
        os.hostname(),
        os.platform(),
        os.arch(),
        process.cwd(),
        this.getFileSystemFingerprint(),
        this.getNetworkFingerprint()
      ];

      const fingerprint = crypto.createHash('sha256')
        .update(features.join('|'))
        .digest('hex');

      databaseLogger.debug('Generated device fingerprint', {
        operation: 'fingerprint_generation',
        fingerprintPrefix: fingerprint.substring(0, 8)
      });

      return fingerprint;
    } catch (error) {
      databaseLogger.error('Failed to generate device fingerprint', error, {
        operation: 'fingerprint_generation_failed'
      });
      throw new Error('Device fingerprint generation failed');
    }
  }

  private static getFileSystemFingerprint(): string {
    try {
      const stat = fs.statSync(process.cwd());
      return `${stat.ino}-${stat.dev}`;
    } catch {
      return 'fs-unknown';
    }
  }

  private static getNetworkFingerprint(): string {
    try {
      const networkInterfaces = os.networkInterfaces();
      const macAddresses = [];

      for (const interfaceName in networkInterfaces) {
        const interfaces = networkInterfaces[interfaceName];
        if (interfaces) {
          for (const iface of interfaces) {
            if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
              macAddresses.push(iface.mac);
            }
          }
        }
      }

      // 使用第一个有效的MAC地址，如果没有则使用fallback
      return macAddresses.length > 0 ? macAddresses.sort()[0] : 'no-mac-found';
    } catch {
      return 'network-unknown';
    }
  }


  private static deriveKEK(): Buffer {
    const fingerprint = this.generateDeviceFingerprint();
    const salt = Buffer.from(this.KEK_SALT);

    const kek = crypto.pbkdf2Sync(
      fingerprint,
      salt,
      this.KEK_ITERATIONS,
      32,
      'sha256'
    );

    databaseLogger.debug('Derived KEK from device fingerprint', {
      operation: 'kek_derivation',
      iterations: this.KEK_ITERATIONS
    });

    return kek;
  }

  static encryptMasterKey(masterKey: string): string {
    if (!masterKey) {
      throw new Error('Master key cannot be empty');
    }

    try {
      const kek = this.deriveKEK();
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv) as any;

      let encrypted = cipher.update(masterKey, 'hex', 'hex');
      encrypted += cipher.final('hex');
      const tag = cipher.getAuthTag();

      const protectedData: ProtectedKeyData = {
        data: encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        version: this.VERSION,
        fingerprint: this.generateDeviceFingerprint().substring(0, 16)
      };

      const result = JSON.stringify(protectedData);

      databaseLogger.info('Master key encrypted with device KEK', {
        operation: 'master_key_encryption',
        version: this.VERSION,
        fingerprintPrefix: protectedData.fingerprint
      });

      return result;
    } catch (error) {
      databaseLogger.error('Failed to encrypt master key', error, {
        operation: 'master_key_encryption_failed'
      });
      throw new Error('Master key encryption failed');
    }
  }

  static decryptMasterKey(encryptedKey: string): string {
    if (!encryptedKey) {
      throw new Error('Encrypted key cannot be empty');
    }

    try {
      const protectedData: ProtectedKeyData = JSON.parse(encryptedKey);

      if (protectedData.version !== this.VERSION) {
        throw new Error(`Unsupported protection version: ${protectedData.version}`);
      }

      const currentFingerprint = this.generateDeviceFingerprint().substring(0, 16);
      if (protectedData.fingerprint !== currentFingerprint) {
        databaseLogger.warn('Device fingerprint mismatch detected', {
          operation: 'master_key_decryption',
          expected: protectedData.fingerprint,
          current: currentFingerprint
        });
        throw new Error('Device fingerprint mismatch - key was encrypted on different machine');
      }

      const kek = this.deriveKEK();
      const decipher = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(protectedData.iv, 'hex')) as any;
      decipher.setAuthTag(Buffer.from(protectedData.tag, 'hex'));

      let decrypted = decipher.update(protectedData.data, 'hex', 'hex');
      decrypted += decipher.final('hex');

      databaseLogger.debug('Master key decrypted successfully', {
        operation: 'master_key_decryption',
        version: protectedData.version
      });

      return decrypted;
    } catch (error) {
      databaseLogger.error('Failed to decrypt master key', error, {
        operation: 'master_key_decryption_failed'
      });
      throw new Error(`Master key decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static isProtectedKey(data: string): boolean {
    try {
      const parsed = JSON.parse(data);
      return !!(parsed.data && parsed.iv && parsed.tag && parsed.version && parsed.fingerprint);
    } catch {
      return false;
    }
  }

  static validateProtection(): boolean {
    try {
      const testKey = crypto.randomBytes(32).toString('hex');
      const encrypted = this.encryptMasterKey(testKey);
      const decrypted = this.decryptMasterKey(encrypted);

      const isValid = decrypted === testKey;

      databaseLogger.info('Master key protection validation completed', {
        operation: 'protection_validation',
        result: isValid ? 'passed' : 'failed'
      });

      return isValid;
    } catch (error) {
      databaseLogger.error('Master key protection validation failed', error, {
        operation: 'protection_validation_failed'
      });
      return false;
    }
  }

  static getProtectionInfo(encryptedKey: string): {
    version: string;
    fingerprint: string;
    isCurrentDevice: boolean;
  } | null {
    try {
      if (!this.isProtectedKey(encryptedKey)) {
        return null;
      }

      const protectedData: ProtectedKeyData = JSON.parse(encryptedKey);
      const currentFingerprint = this.generateDeviceFingerprint().substring(0, 16);

      return {
        version: protectedData.version,
        fingerprint: protectedData.fingerprint,
        isCurrentDevice: protectedData.fingerprint === currentFingerprint
      };
    } catch {
      return null;
    }
  }
}

export { MasterKeyProtection };
export type { ProtectedKeyData };