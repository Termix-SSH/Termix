import crypto from "crypto";
import fs from "fs";
import path from "path";
import { databaseLogger } from "./logger.js";
import { SystemCrypto } from "./system-crypto.js";

interface EncryptedFileMetadata {
  iv: string;
  tag: string;
  version: string;
  fingerprint: string;
  algorithm: string;
  keySource?: string;
  salt?: string;
  dataSize?: number;
}

class DatabaseFileEncryption {
  private static readonly VERSION = "v2";
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly ENCRYPTED_FILE_SUFFIX = ".encrypted";
  private static readonly METADATA_FILE_SUFFIX = ".meta";
  private static systemCrypto = SystemCrypto.getInstance();

  static async encryptDatabaseFromBuffer(
    buffer: Buffer,
    targetPath: string,
  ): Promise<string> {
    const tmpPath = `${targetPath}.tmp-${Date.now()}-${process.pid}`;
    const tmpMetadataPath = `${tmpPath}${this.METADATA_FILE_SUFFIX}`;
    const metadataPath = `${targetPath}${this.METADATA_FILE_SUFFIX}`;

    try {
      const key = await this.systemCrypto.getDatabaseKey();

      const iv = crypto.randomBytes(16);

      const cipher = crypto.createCipheriv(
        this.ALGORITHM,
        key,
        iv,
      ) as crypto.CipherGCM;
      const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
      const tag = cipher.getAuthTag();

      const keyFingerprint = crypto
        .createHash("sha256")
        .update(key)
        .digest("hex")
        .substring(0, 16);

      const metadata: EncryptedFileMetadata = {
        iv: iv.toString("hex"),
        tag: tag.toString("hex"),
        version: this.VERSION,
        fingerprint: "termix-v2-systemcrypto",
        algorithm: this.ALGORITHM,
        keySource: "SystemCrypto",
        dataSize: encrypted.length,
      };

      databaseLogger.debug("Starting atomic encryption write", {
        operation: "database_buffer_encryption_start",
        targetPath,
        tmpPath,
        originalSize: buffer.length,
        encryptedSize: encrypted.length,
        keyFingerprint,
        ivPrefix: metadata.iv.substring(0, 8),
        tagPrefix: metadata.tag.substring(0, 8),
      });

      fs.writeFileSync(tmpPath, encrypted);
      fs.writeFileSync(tmpMetadataPath, JSON.stringify(metadata, null, 2));

      databaseLogger.debug(
        "Temporary files written, performing atomic rename",
        {
          operation: "database_buffer_encryption_rename",
          tmpPath,
          targetPath,
        },
      );

      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      fs.renameSync(tmpPath, targetPath);

      if (fs.existsSync(metadataPath)) {
        fs.unlinkSync(metadataPath);
      }
      fs.renameSync(tmpMetadataPath, metadataPath);

      databaseLogger.debug("Database buffer encrypted with atomic write", {
        operation: "database_buffer_encryption_atomic",
        targetPath,
        encryptedSize: encrypted.length,
        keyFingerprint,
      });

      return targetPath;
    } catch (error) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
        if (fs.existsSync(tmpMetadataPath)) {
          fs.unlinkSync(tmpMetadataPath);
        }
      } catch (cleanupError) {
        databaseLogger.warn("Failed to cleanup temporary files", {
          operation: "temp_file_cleanup_failed",
          tmpPath,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : "Unknown error",
        });
      }

      databaseLogger.error("Failed to encrypt database buffer", error, {
        operation: "database_buffer_encryption_failed",
        targetPath,
      });
      throw new Error(
        `Database buffer encryption failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  static async encryptDatabaseFile(
    sourcePath: string,
    targetPath?: string,
  ): Promise<string> {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source database file does not exist: ${sourcePath}`);
    }

    const encryptedPath =
      targetPath || `${sourcePath}${this.ENCRYPTED_FILE_SUFFIX}`;
    const metadataPath = `${encryptedPath}${this.METADATA_FILE_SUFFIX}`;
    const tmpPath = `${encryptedPath}.tmp-${Date.now()}-${process.pid}`;
    const tmpMetadataPath = `${tmpPath}${this.METADATA_FILE_SUFFIX}`;

    try {
      const sourceData = fs.readFileSync(sourcePath);

      const key = await this.systemCrypto.getDatabaseKey();

      const iv = crypto.randomBytes(16);

      const cipher = crypto.createCipheriv(
        this.ALGORITHM,
        key,
        iv,
      ) as crypto.CipherGCM;
      const encrypted = Buffer.concat([
        cipher.update(sourceData),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();

      const keyFingerprint = crypto
        .createHash("sha256")
        .update(key)
        .digest("hex")
        .substring(0, 16);

      const metadata: EncryptedFileMetadata = {
        iv: iv.toString("hex"),
        tag: tag.toString("hex"),
        version: this.VERSION,
        fingerprint: "termix-v2-systemcrypto",
        algorithm: this.ALGORITHM,
        keySource: "SystemCrypto",
        dataSize: encrypted.length,
      };

      databaseLogger.debug("Starting atomic file encryption", {
        operation: "database_file_encryption_start",
        sourcePath,
        encryptedPath,
        tmpPath,
        originalSize: sourceData.length,
        encryptedSize: encrypted.length,
        keyFingerprint,
        ivPrefix: metadata.iv.substring(0, 8),
      });

      fs.writeFileSync(tmpPath, encrypted);
      fs.writeFileSync(tmpMetadataPath, JSON.stringify(metadata, null, 2));

      databaseLogger.debug(
        "Temporary files written, performing atomic rename",
        {
          operation: "database_file_encryption_rename",
          tmpPath,
          encryptedPath,
        },
      );

      if (fs.existsSync(encryptedPath)) {
        fs.unlinkSync(encryptedPath);
      }
      fs.renameSync(tmpPath, encryptedPath);

      if (fs.existsSync(metadataPath)) {
        fs.unlinkSync(metadataPath);
      }
      fs.renameSync(tmpMetadataPath, metadataPath);

      databaseLogger.info("Database file encrypted successfully", {
        operation: "database_file_encryption",
        sourcePath,
        encryptedPath,
        fileSize: sourceData.length,
        encryptedSize: encrypted.length,
        keyFingerprint,
        fingerprintPrefix: metadata.fingerprint,
      });

      return encryptedPath;
    } catch (error) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
        if (fs.existsSync(tmpMetadataPath)) {
          fs.unlinkSync(tmpMetadataPath);
        }
      } catch (cleanupError) {
        databaseLogger.warn("Failed to cleanup temporary files", {
          operation: "temp_file_cleanup_failed",
          tmpPath,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : "Unknown error",
        });
      }

      databaseLogger.error("Failed to encrypt database file", error, {
        operation: "database_file_encryption_failed",
        sourcePath,
        targetPath: encryptedPath,
      });
      throw new Error(
        `Database file encryption failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  static async decryptDatabaseToBuffer(encryptedPath: string): Promise<Buffer> {
    if (!fs.existsSync(encryptedPath)) {
      throw new Error(
        `Encrypted database file does not exist: ${encryptedPath}`,
      );
    }

    const metadataPath = `${encryptedPath}${this.METADATA_FILE_SUFFIX}`;
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Metadata file does not exist: ${metadataPath}`);
    }

    try {
      const dataFileStats = fs.statSync(encryptedPath);
      const metaFileStats = fs.statSync(metadataPath);

      databaseLogger.debug("Starting database decryption", {
        operation: "database_buffer_decryption_start",
        encryptedPath,
        metadataPath,
        dataFileSize: dataFileStats.size,
        dataFileMtime: dataFileStats.mtime.toISOString(),
        metaFileMtime: metaFileStats.mtime.toISOString(),
        dataDir: process.env.DATA_DIR || "./db/data",
      });

      const metadataContent = fs.readFileSync(metadataPath, "utf8");
      const metadata: EncryptedFileMetadata = JSON.parse(metadataContent);

      databaseLogger.debug("Metadata loaded", {
        operation: "database_metadata_loaded",
        version: metadata.version,
        algorithm: metadata.algorithm,
        keySource: metadata.keySource,
        fingerprint: metadata.fingerprint,
        hasDataSize: !!metadata.dataSize,
        expectedDataSize: metadata.dataSize,
        ivPrefix: metadata.iv?.substring(0, 8),
        tagPrefix: metadata.tag?.substring(0, 8),
      });

      const encryptedData = fs.readFileSync(encryptedPath);

      if (metadata.dataSize && encryptedData.length !== metadata.dataSize) {
        databaseLogger.error(
          "Encrypted file size mismatch - possible corrupted write or mismatched metadata",
          null,
          {
            operation: "database_file_size_mismatch",
            encryptedPath,
            actualSize: encryptedData.length,
            expectedSize: metadata.dataSize,
            difference: encryptedData.length - metadata.dataSize,
            dataFileMtime: dataFileStats.mtime.toISOString(),
            metaFileMtime: metaFileStats.mtime.toISOString(),
          },
        );
        throw new Error(
          `Encrypted file size mismatch: expected ${metadata.dataSize} bytes but got ${encryptedData.length} bytes. ` +
            `This indicates corrupted files or interrupted write operation.`,
        );
      }

      let key: Buffer;
      if (metadata.version === "v2") {
        key = await this.systemCrypto.getDatabaseKey();
      } else if (metadata.version === "v1") {
        databaseLogger.warn(
          "Decrypting legacy v1 encrypted database - consider upgrading",
          {
            operation: "decrypt_legacy_v1",
            path: encryptedPath,
          },
        );
        if (!metadata.salt) {
          throw new Error("v1 encrypted file missing required salt field");
        }
        const salt = Buffer.from(metadata.salt, "hex");
        const fixedSeed =
          process.env.DB_FILE_KEY || "termix-database-file-encryption-seed-v1";
        key = crypto.pbkdf2Sync(fixedSeed, salt, 100000, 32, "sha256");
      } else {
        throw new Error(`Unsupported encryption version: ${metadata.version}`);
      }

      const keyFingerprint = crypto
        .createHash("sha256")
        .update(key)
        .digest("hex")
        .substring(0, 16);

      databaseLogger.debug("Starting decryption with loaded key", {
        operation: "database_decryption_attempt",
        keyFingerprint,
        algorithm: metadata.algorithm,
        ivPrefix: metadata.iv.substring(0, 8),
        tagPrefix: metadata.tag.substring(0, 8),
        dataSize: encryptedData.length,
      });

      const decipher = crypto.createDecipheriv(
        metadata.algorithm,
        key,
        Buffer.from(metadata.iv, "hex"),
      ) as crypto.DecipherGCM;
      decipher.setAuthTag(Buffer.from(metadata.tag, "hex"));

      const decryptedBuffer = Buffer.concat([
        decipher.update(encryptedData),
        decipher.final(),
      ]);

      databaseLogger.debug("Database decryption successful", {
        operation: "database_buffer_decryption_success",
        encryptedPath,
        encryptedSize: encryptedData.length,
        decryptedSize: decryptedBuffer.length,
        keyFingerprint,
      });

      return decryptedBuffer;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const isAuthError =
        errorMessage.includes("Unsupported state") ||
        errorMessage.includes("authenticate data") ||
        errorMessage.includes("auth");

      if (isAuthError) {
        const dataDir = process.env.DATA_DIR || "./db/data";
        const envPath = path.join(dataDir, ".env");

        let envFileExists = false;
        let envFileReadable = false;
        try {
          envFileExists = fs.existsSync(envPath);
          if (envFileExists) {
            fs.accessSync(envPath, fs.constants.R_OK);
            envFileReadable = true;
          }
        } catch {}

        databaseLogger.error(
          "Database decryption authentication failed - possible causes: wrong DATABASE_KEY, corrupted files, or interrupted write",
          error,
          {
            operation: "database_buffer_decryption_auth_failed",
            encryptedPath,
            metadataPath,
            dataDir,
            envPath,
            envFileExists,
            envFileReadable,
            hasEnvKey: !!process.env.DATABASE_KEY,
            envKeyLength: process.env.DATABASE_KEY?.length || 0,
            suggestion:
              "Check if DATABASE_KEY in .env matches the key used for encryption",
          },
        );
        throw new Error(
          `Database decryption authentication failed. This usually means:\n` +
            `1. DATABASE_KEY has changed or is missing from ${dataDir}/.env\n` +
            `2. Encrypted file was corrupted during write (system crash/restart)\n` +
            `3. Metadata file does not match encrypted data\n` +
            `\nDebug info:\n` +
            `- DATA_DIR: ${dataDir}\n` +
            `- .env file exists: ${envFileExists}\n` +
            `- .env file readable: ${envFileReadable}\n` +
            `- DATABASE_KEY in environment: ${!!process.env.DATABASE_KEY}\n` +
            `Original error: ${errorMessage}`,
        );
      }

      databaseLogger.error("Failed to decrypt database to buffer", error, {
        operation: "database_buffer_decryption_failed",
        encryptedPath,
        errorMessage,
      });
      throw new Error(`Database buffer decryption failed: ${errorMessage}`);
    }
  }

  static async decryptDatabaseFile(
    encryptedPath: string,
    targetPath?: string,
  ): Promise<string> {
    if (!fs.existsSync(encryptedPath)) {
      throw new Error(
        `Encrypted database file does not exist: ${encryptedPath}`,
      );
    }

    const metadataPath = `${encryptedPath}${this.METADATA_FILE_SUFFIX}`;
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Metadata file does not exist: ${metadataPath}`);
    }

    const decryptedPath =
      targetPath || encryptedPath.replace(this.ENCRYPTED_FILE_SUFFIX, "");

    try {
      const metadataContent = fs.readFileSync(metadataPath, "utf8");
      const metadata: EncryptedFileMetadata = JSON.parse(metadataContent);

      const encryptedData = fs.readFileSync(encryptedPath);

      if (metadata.dataSize && encryptedData.length !== metadata.dataSize) {
        databaseLogger.error(
          "Encrypted file size mismatch - possible corrupted write or mismatched metadata",
          null,
          {
            operation: "database_file_size_mismatch",
            encryptedPath,
            actualSize: encryptedData.length,
            expectedSize: metadata.dataSize,
          },
        );
        throw new Error(
          `Encrypted file size mismatch: expected ${metadata.dataSize} bytes but got ${encryptedData.length} bytes. ` +
            `This indicates corrupted files or interrupted write operation.`,
        );
      }

      let key: Buffer;
      if (metadata.version === "v2") {
        key = await this.systemCrypto.getDatabaseKey();
      } else if (metadata.version === "v1") {
        databaseLogger.warn(
          "Decrypting legacy v1 encrypted database - consider upgrading",
          {
            operation: "decrypt_legacy_v1",
            path: encryptedPath,
          },
        );
        if (!metadata.salt) {
          throw new Error("v1 encrypted file missing required salt field");
        }
        const salt = Buffer.from(metadata.salt, "hex");
        const fixedSeed =
          process.env.DB_FILE_KEY || "termix-database-file-encryption-seed-v1";
        key = crypto.pbkdf2Sync(fixedSeed, salt, 100000, 32, "sha256");
      } else {
        throw new Error(`Unsupported encryption version: ${metadata.version}`);
      }

      const decipher = crypto.createDecipheriv(
        metadata.algorithm,
        key,
        Buffer.from(metadata.iv, "hex"),
      ) as crypto.DecipherGCM;
      decipher.setAuthTag(Buffer.from(metadata.tag, "hex"));

      const decrypted = Buffer.concat([
        decipher.update(encryptedData),
        decipher.final(),
      ]);

      fs.writeFileSync(decryptedPath, decrypted);

      databaseLogger.info("Database file decrypted successfully", {
        operation: "database_file_decryption",
        encryptedPath,
        decryptedPath,
        encryptedSize: encryptedData.length,
        decryptedSize: decrypted.length,
        fingerprintPrefix: metadata.fingerprint,
      });

      return decryptedPath;
    } catch (error) {
      databaseLogger.error("Failed to decrypt database file", error, {
        operation: "database_file_decryption_failed",
        encryptedPath,
        targetPath: decryptedPath,
      });
      throw new Error(
        `Database file decryption failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  static isEncryptedDatabaseFile(filePath: string): boolean {
    const metadataPath = `${filePath}${this.METADATA_FILE_SUFFIX}`;

    if (!fs.existsSync(filePath) || !fs.existsSync(metadataPath)) {
      return false;
    }

    try {
      const metadataContent = fs.readFileSync(metadataPath, "utf8");
      const metadata: EncryptedFileMetadata = JSON.parse(metadataContent);
      return (
        metadata.version === this.VERSION &&
        metadata.algorithm === this.ALGORITHM
      );
    } catch {
      return false;
    }
  }

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
      const metadataContent = fs.readFileSync(metadataPath, "utf8");
      const metadata: EncryptedFileMetadata = JSON.parse(metadataContent);

      const fileStats = fs.statSync(encryptedPath);

      return {
        version: metadata.version,
        algorithm: metadata.algorithm,
        fingerprint: metadata.fingerprint,
        isCurrentHardware: true,
        fileSize: fileStats.size,
      };
    } catch {
      return null;
    }
  }

  static getDiagnosticInfo(encryptedPath: string): {
    dataFile: {
      exists: boolean;
      size?: number;
      mtime?: string;
      readable?: boolean;
    };
    metadataFile: {
      exists: boolean;
      size?: number;
      mtime?: string;
      readable?: boolean;
      content?: EncryptedFileMetadata;
    };
    environment: {
      dataDir: string;
      envPath: string;
      envFileExists: boolean;
      envFileReadable: boolean;
      hasEnvKey: boolean;
      envKeyLength: number;
    };
    validation: {
      filesConsistent: boolean;
      sizeMismatch?: boolean;
      expectedSize?: number;
      actualSize?: number;
    };
  } {
    const metadataPath = `${encryptedPath}${this.METADATA_FILE_SUFFIX}`;
    const dataDir = process.env.DATA_DIR || "./db/data";
    const envPath = path.join(dataDir, ".env");

    const result: ReturnType<typeof this.getDiagnosticInfo> = {
      dataFile: { exists: false },
      metadataFile: { exists: false },
      environment: {
        dataDir,
        envPath,
        envFileExists: false,
        envFileReadable: false,
        hasEnvKey: !!process.env.DATABASE_KEY,
        envKeyLength: process.env.DATABASE_KEY?.length || 0,
      },
      validation: {
        filesConsistent: false,
      },
    };

    try {
      result.dataFile.exists = fs.existsSync(encryptedPath);
      if (result.dataFile.exists) {
        try {
          fs.accessSync(encryptedPath, fs.constants.R_OK);
          result.dataFile.readable = true;
          const stats = fs.statSync(encryptedPath);
          result.dataFile.size = stats.size;
          result.dataFile.mtime = stats.mtime.toISOString();
        } catch {
          result.dataFile.readable = false;
        }
      }

      result.metadataFile.exists = fs.existsSync(metadataPath);
      if (result.metadataFile.exists) {
        try {
          fs.accessSync(metadataPath, fs.constants.R_OK);
          result.metadataFile.readable = true;
          const stats = fs.statSync(metadataPath);
          result.metadataFile.size = stats.size;
          result.metadataFile.mtime = stats.mtime.toISOString();

          const content = fs.readFileSync(metadataPath, "utf8");
          result.metadataFile.content = JSON.parse(content);
        } catch {
          result.metadataFile.readable = false;
        }
      }

      result.environment.envFileExists = fs.existsSync(envPath);
      if (result.environment.envFileExists) {
        try {
          fs.accessSync(envPath, fs.constants.R_OK);
          result.environment.envFileReadable = true;
        } catch {}
      }

      if (
        result.dataFile.exists &&
        result.metadataFile.exists &&
        result.metadataFile.content
      ) {
        result.validation.filesConsistent = true;

        if (result.metadataFile.content.dataSize) {
          result.validation.expectedSize = result.metadataFile.content.dataSize;
          result.validation.actualSize = result.dataFile.size;
          result.validation.sizeMismatch =
            result.metadataFile.content.dataSize !== result.dataFile.size;
          if (result.validation.sizeMismatch) {
            result.validation.filesConsistent = false;
          }
        }
      }
    } catch (error) {
      databaseLogger.error("Failed to generate diagnostic info", error, {
        operation: "diagnostic_info_failed",
        encryptedPath,
      });
    }

    databaseLogger.info("Database encryption diagnostic info", {
      operation: "diagnostic_info_generated",
      ...result,
    });

    return result;
  }

  static async createEncryptedBackup(
    databasePath: string,
    backupDir: string,
  ): Promise<string> {
    if (!fs.existsSync(databasePath)) {
      throw new Error(`Database file does not exist: ${databasePath}`);
    }

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFileName = `database-backup-${timestamp}.sqlite.encrypted`;
    const backupPath = path.join(backupDir, backupFileName);

    try {
      const encryptedPath = await this.encryptDatabaseFile(
        databasePath,
        backupPath,
      );

      return encryptedPath;
    } catch (error) {
      databaseLogger.error("Failed to create encrypted backup", error, {
        operation: "database_backup_failed",
        sourcePath: databasePath,
        backupDir,
      });
      throw error;
    }
  }

  static async restoreFromEncryptedBackup(
    backupPath: string,
    targetPath: string,
  ): Promise<string> {
    if (!this.isEncryptedDatabaseFile(backupPath)) {
      throw new Error("Invalid encrypted backup file");
    }

    try {
      const restoredPath = await this.decryptDatabaseFile(
        backupPath,
        targetPath,
      );

      return restoredPath;
    } catch (error) {
      databaseLogger.error("Failed to restore from encrypted backup", error, {
        operation: "database_restore_failed",
        backupPath,
        targetPath,
      });
      throw error;
    }
  }

  static cleanupTempFiles(basePath: string): void {
    try {
      const tempFiles = [
        `${basePath}.tmp`,
        `${basePath}${this.ENCRYPTED_FILE_SUFFIX}`,
        `${basePath}${this.ENCRYPTED_FILE_SUFFIX}${this.METADATA_FILE_SUFFIX}`,
      ];

      for (const tempFile of tempFiles) {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    } catch (error) {
      databaseLogger.warn("Failed to clean up temporary files", {
        operation: "temp_cleanup_failed",
        basePath,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

export { DatabaseFileEncryption };
export type { EncryptedFileMetadata };
