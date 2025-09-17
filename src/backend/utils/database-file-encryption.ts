import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { HardwareFingerprint } from './hardware-fingerprint.js';
import { databaseLogger } from './logger.js';

interface EncryptedFileMetadata {
  iv: string;
  tag: string;
  version: string;
  fingerprint: string;
  salt: string;
  algorithm: string;
}

/**
 * Database file encryption - encrypts the entire SQLite database file at rest
 * This provides an additional security layer on top of field-level encryption
 */
class DatabaseFileEncryption {
  private static readonly VERSION = 'v1';
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly KEY_ITERATIONS = 100000;
  private static readonly ENCRYPTED_FILE_SUFFIX = '.encrypted';
  private static readonly METADATA_FILE_SUFFIX = '.meta';

  /**
   * Generate file encryption key from hardware fingerprint
   */
  private static generateFileEncryptionKey(salt: Buffer): Buffer {
    const hardwareFingerprint = HardwareFingerprint.generate();

    const key = crypto.pbkdf2Sync(
      hardwareFingerprint,
      salt,
      this.KEY_ITERATIONS,
      32, // 256 bits for AES-256
      'sha256'
    );

    databaseLogger.debug('Generated file encryption key from hardware fingerprint', {
      operation: 'file_key_generation',
      iterations: this.KEY_ITERATIONS,
      keyLength: key.length
    });

    return key;
  }

  /**
   * Encrypt database from buffer (for in-memory databases)
   */
  static encryptDatabaseFromBuffer(buffer: Buffer, targetPath: string): string {
    try {
      // Generate encryption components
      const salt = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const key = this.generateFileEncryptionKey(salt);

      // Encrypt the buffer
      const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv) as any;
      const encrypted = Buffer.concat([
        cipher.update(buffer),
        cipher.final()
      ]);
      const tag = cipher.getAuthTag();

      // Create metadata
      const metadata: EncryptedFileMetadata = {
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        version: this.VERSION,
        fingerprint: HardwareFingerprint.generate().substring(0, 16),
        salt: salt.toString('hex'),
        algorithm: this.ALGORITHM
      };

      // Write encrypted file and metadata
      const metadataPath = `${targetPath}${this.METADATA_FILE_SUFFIX}`;
      fs.writeFileSync(targetPath, encrypted);
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      databaseLogger.info('Database buffer encrypted successfully', {
        operation: 'database_buffer_encryption',
        targetPath,
        bufferSize: buffer.length,
        encryptedSize: encrypted.length,
        fingerprintPrefix: metadata.fingerprint
      });

      return targetPath;
    } catch (error) {
      databaseLogger.error('Failed to encrypt database buffer', error, {
        operation: 'database_buffer_encryption_failed',
        targetPath
      });
      throw new Error(`Database buffer encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Encrypt database file
   */
  static encryptDatabaseFile(sourcePath: string, targetPath?: string): string {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source database file does not exist: ${sourcePath}`);
    }

    const encryptedPath = targetPath || `${sourcePath}${this.ENCRYPTED_FILE_SUFFIX}`;
    const metadataPath = `${encryptedPath}${this.METADATA_FILE_SUFFIX}`;

    try {
      // Read source file
      const sourceData = fs.readFileSync(sourcePath);

      // Generate encryption components
      const salt = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const key = this.generateFileEncryptionKey(salt);

      // Encrypt the file
      const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv) as any;
      const encrypted = Buffer.concat([
        cipher.update(sourceData),
        cipher.final()
      ]);
      const tag = cipher.getAuthTag();

      // Create metadata
      const metadata: EncryptedFileMetadata = {
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        version: this.VERSION,
        fingerprint: HardwareFingerprint.generate().substring(0, 16),
        salt: salt.toString('hex'),
        algorithm: this.ALGORITHM
      };

      // Write encrypted file and metadata
      fs.writeFileSync(encryptedPath, encrypted);
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

      databaseLogger.info('Database file encrypted successfully', {
        operation: 'database_file_encryption',
        sourcePath,
        encryptedPath,
        fileSize: sourceData.length,
        encryptedSize: encrypted.length,
        fingerprintPrefix: metadata.fingerprint
      });

      return encryptedPath;
    } catch (error) {
      databaseLogger.error('Failed to encrypt database file', error, {
        operation: 'database_file_encryption_failed',
        sourcePath,
        targetPath: encryptedPath
      });
      throw new Error(`Database file encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypt database file to buffer (for in-memory usage)
   */
  static decryptDatabaseToBuffer(encryptedPath: string): Buffer {
    if (!fs.existsSync(encryptedPath)) {
      throw new Error(`Encrypted database file does not exist: ${encryptedPath}`);
    }

    const metadataPath = `${encryptedPath}${this.METADATA_FILE_SUFFIX}`;
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Metadata file does not exist: ${metadataPath}`);
    }

    try {
      // Read metadata
      const metadataContent = fs.readFileSync(metadataPath, 'utf8');
      const metadata: EncryptedFileMetadata = JSON.parse(metadataContent);

      // Validate metadata version
      if (metadata.version !== this.VERSION) {
        throw new Error(`Unsupported encryption version: ${metadata.version}`);
      }

      // Validate hardware fingerprint
      const currentFingerprint = HardwareFingerprint.generate().substring(0, 16);
      if (metadata.fingerprint !== currentFingerprint) {
        databaseLogger.warn('Hardware fingerprint mismatch for database buffer decryption', {
          operation: 'database_buffer_decryption',
          expected: metadata.fingerprint,
          current: currentFingerprint
        });
        throw new Error('Hardware fingerprint mismatch - database was encrypted on different hardware');
      }

      // Read encrypted data
      const encryptedData = fs.readFileSync(encryptedPath);

      // Generate decryption key
      const salt = Buffer.from(metadata.salt, 'hex');
      const key = this.generateFileEncryptionKey(salt);

      // Decrypt to buffer
      const decipher = crypto.createDecipheriv(
        metadata.algorithm,
        key,
        Buffer.from(metadata.iv, 'hex')
      ) as any;
      decipher.setAuthTag(Buffer.from(metadata.tag, 'hex'));

      const decryptedBuffer = Buffer.concat([
        decipher.update(encryptedData),
        decipher.final()
      ]);

      databaseLogger.info('Database decrypted to memory buffer', {
        operation: 'database_buffer_decryption',
        encryptedPath,
        encryptedSize: encryptedData.length,
        decryptedSize: decryptedBuffer.length,
        fingerprintPrefix: metadata.fingerprint
      });

      return decryptedBuffer;
    } catch (error) {
      databaseLogger.error('Failed to decrypt database to buffer', error, {
        operation: 'database_buffer_decryption_failed',
        encryptedPath
      });
      throw new Error(`Database buffer decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypt database file
   */
  static decryptDatabaseFile(encryptedPath: string, targetPath?: string): string {
    if (!fs.existsSync(encryptedPath)) {
      throw new Error(`Encrypted database file does not exist: ${encryptedPath}`);
    }

    const metadataPath = `${encryptedPath}${this.METADATA_FILE_SUFFIX}`;
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Metadata file does not exist: ${metadataPath}`);
    }

    const decryptedPath = targetPath || encryptedPath.replace(this.ENCRYPTED_FILE_SUFFIX, '');

    try {
      // Read metadata
      const metadataContent = fs.readFileSync(metadataPath, 'utf8');
      const metadata: EncryptedFileMetadata = JSON.parse(metadataContent);

      // Validate metadata version
      if (metadata.version !== this.VERSION) {
        throw new Error(`Unsupported encryption version: ${metadata.version}`);
      }

      // Validate hardware fingerprint
      const currentFingerprint = HardwareFingerprint.generate().substring(0, 16);
      if (metadata.fingerprint !== currentFingerprint) {
        databaseLogger.warn('Hardware fingerprint mismatch for database file', {
          operation: 'database_file_decryption',
          expected: metadata.fingerprint,
          current: currentFingerprint
        });
        throw new Error('Hardware fingerprint mismatch - database was encrypted on different hardware');
      }

      // Read encrypted data
      const encryptedData = fs.readFileSync(encryptedPath);

      // Generate decryption key
      const salt = Buffer.from(metadata.salt, 'hex');
      const key = this.generateFileEncryptionKey(salt);

      // Decrypt the file
      const decipher = crypto.createDecipheriv(
        metadata.algorithm,
        key,
        Buffer.from(metadata.iv, 'hex')
      ) as any;
      decipher.setAuthTag(Buffer.from(metadata.tag, 'hex'));

      const decrypted = Buffer.concat([
        decipher.update(encryptedData),
        decipher.final()
      ]);

      // Write decrypted file
      fs.writeFileSync(decryptedPath, decrypted);

      databaseLogger.info('Database file decrypted successfully', {
        operation: 'database_file_decryption',
        encryptedPath,
        decryptedPath,
        encryptedSize: encryptedData.length,
        decryptedSize: decrypted.length,
        fingerprintPrefix: metadata.fingerprint
      });

      return decryptedPath;
    } catch (error) {
      databaseLogger.error('Failed to decrypt database file', error, {
        operation: 'database_file_decryption_failed',
        encryptedPath,
        targetPath: decryptedPath
      });
      throw new Error(`Database file decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if a file is an encrypted database file
   */
  static isEncryptedDatabaseFile(filePath: string): boolean {
    const metadataPath = `${filePath}${this.METADATA_FILE_SUFFIX}`;

    if (!fs.existsSync(filePath) || !fs.existsSync(metadataPath)) {
      return false;
    }

    try {
      const metadataContent = fs.readFileSync(metadataPath, 'utf8');
      const metadata: EncryptedFileMetadata = JSON.parse(metadataContent);
      return metadata.version === this.VERSION && metadata.algorithm === this.ALGORITHM;
    } catch {
      return false;
    }
  }

  /**
   * Get information about an encrypted database file
   */
  static getEncryptedFileInfo(encryptedPath: string): {
    version: string;
    algorithm: string;
    fingerprint: string;
    isCurrentHardware: boolean;
    fileSize: number;
  } | null {
    if (!this.isEncryptedDatabaseFile(encryptedPath)) {
      return null;
    }

    try {
      const metadataPath = `${encryptedPath}${this.METADATA_FILE_SUFFIX}`;
      const metadataContent = fs.readFileSync(metadataPath, 'utf8');
      const metadata: EncryptedFileMetadata = JSON.parse(metadataContent);

      const fileStats = fs.statSync(encryptedPath);
      const currentFingerprint = HardwareFingerprint.generate().substring(0, 16);

      return {
        version: metadata.version,
        algorithm: metadata.algorithm,
        fingerprint: metadata.fingerprint,
        isCurrentHardware: metadata.fingerprint === currentFingerprint,
        fileSize: fileStats.size
      };
    } catch {
      return null;
    }
  }

  /**
   * Securely backup database by creating encrypted copy
   */
  static createEncryptedBackup(databasePath: string, backupDir: string): string {
    if (!fs.existsSync(databasePath)) {
      throw new Error(`Database file does not exist: ${databasePath}`);
    }

    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `database-backup-${timestamp}.sqlite.encrypted`;
    const backupPath = path.join(backupDir, backupFileName);

    try {
      const encryptedPath = this.encryptDatabaseFile(databasePath, backupPath);

      databaseLogger.info('Encrypted database backup created', {
        operation: 'database_backup',
        sourcePath: databasePath,
        backupPath: encryptedPath,
        timestamp
      });

      return encryptedPath;
    } catch (error) {
      databaseLogger.error('Failed to create encrypted backup', error, {
        operation: 'database_backup_failed',
        sourcePath: databasePath,
        backupDir
      });
      throw error;
    }
  }

  /**
   * Restore database from encrypted backup
   */
  static restoreFromEncryptedBackup(backupPath: string, targetPath: string): string {
    if (!this.isEncryptedDatabaseFile(backupPath)) {
      throw new Error('Invalid encrypted backup file');
    }

    try {
      const restoredPath = this.decryptDatabaseFile(backupPath, targetPath);

      databaseLogger.info('Database restored from encrypted backup', {
        operation: 'database_restore',
        backupPath,
        restoredPath
      });

      return restoredPath;
    } catch (error) {
      databaseLogger.error('Failed to restore from encrypted backup', error, {
        operation: 'database_restore_failed',
        backupPath,
        targetPath
      });
      throw error;
    }
  }

  /**
   * Validate hardware compatibility for encrypted file
   */
  static validateHardwareCompatibility(encryptedPath: string): boolean {
    try {
      const info = this.getEncryptedFileInfo(encryptedPath);
      return info?.isCurrentHardware ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Clean up temporary files
   */
  static cleanupTempFiles(basePath: string): void {
    try {
      const tempFiles = [
        `${basePath}.tmp`,
        `${basePath}${this.ENCRYPTED_FILE_SUFFIX}`,
        `${basePath}${this.ENCRYPTED_FILE_SUFFIX}${this.METADATA_FILE_SUFFIX}`
      ];

      for (const tempFile of tempFiles) {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          databaseLogger.debug('Cleaned up temporary file', {
            operation: 'temp_cleanup',
            file: tempFile
          });
        }
      }
    } catch (error) {
      databaseLogger.warn('Failed to clean up temporary files', {
        operation: 'temp_cleanup_failed',
        basePath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

export { DatabaseFileEncryption };
export type { EncryptedFileMetadata };