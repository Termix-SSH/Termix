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

      const metadata: EncryptedFileMetadata = {
        iv: iv.toString("hex"),
        tag: tag.toString("hex"),
        version: this.VERSION,
        fingerprint: "termix-v2-systemcrypto",
        algorithm: this.ALGORITHM,
        keySource: "SystemCrypto",
        dataSize: encrypted.length,
      };

      const metadataJson = JSON.stringify(metadata, null, 2);
      const metadataBuffer = Buffer.from(metadataJson, "utf8");
      const metadataLengthBuffer = Buffer.alloc(4);
      metadataLengthBuffer.writeUInt32BE(metadataBuffer.length, 0);

      const finalBuffer = Buffer.concat([
        metadataLengthBuffer,
        metadataBuffer,
        encrypted,
      ]);

      fs.writeFileSync(tmpPath, finalBuffer);
      fs.renameSync(tmpPath, targetPath);

      try {
        if (fs.existsSync(metadataPath)) {
          fs.unlinkSync(metadataPath);
        }
      } catch (cleanupError) {
        databaseLogger.warn("Failed to cleanup old metadata file", {
          operation: "old_meta_cleanup_failed",
          path: metadataPath,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : "Unknown error",
        });
      }

      return targetPath;
    } catch (error) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
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

      fs.writeFileSync(tmpPath, encrypted);
      fs.writeFileSync(tmpMetadataPath, JSON.stringify(metadata, null, 2));

      fs.renameSync(tmpPath, encryptedPath);
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

    let metadata: EncryptedFileMetadata;
    let encryptedData: Buffer;

    const fileBuffer = fs.readFileSync(encryptedPath);

    try {
      const metadataLength = fileBuffer.readUInt32BE(0);
      const metadataEnd = 4 + metadataLength;

      if (
        metadataLength <= 0 ||
        metadataEnd > fileBuffer.length ||
        metadataEnd <= 4
      ) {
        throw new Error("Invalid metadata length in single-file format");
      }

      const metadataJson = fileBuffer.slice(4, metadataEnd).toString("utf8");
      metadata = JSON.parse(metadataJson);
      encryptedData = fileBuffer.slice(metadataEnd);

      if (!metadata.iv || !metadata.tag || !metadata.version) {
        throw new Error("Invalid metadata structure in single-file format");
      }
    } catch (singleFileError) {
      const metadataPath = `${encryptedPath}${this.METADATA_FILE_SUFFIX}`;
      if (!fs.existsSync(metadataPath)) {
        throw new Error(
          `Could not read database: Not a valid single-file format and metadata file is missing: ${metadataPath}. Error: ${singleFileError.message}`,
        );
      }

      try {
        const metadataContent = fs.readFileSync(metadataPath, "utf8");
        metadata = JSON.parse(metadataContent);
        encryptedData = fileBuffer;
      } catch (twoFileError) {
        throw new Error(
          `Failed to read database using both single-file and two-file formats. Error: ${twoFileError.message}`,
        );
      }
    }

    try {
      if (
        metadata.dataSize !== undefined &&
        encryptedData.length !== metadata.dataSize
      ) {
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

      const decryptedBuffer = Buffer.concat([
        decipher.update(encryptedData),
        decipher.final(),
      ]);

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
        } catch (error) {}

        databaseLogger.error(
          "Database decryption authentication failed - possible causes: wrong DATABASE_KEY, corrupted files, or interrupted write",
          error,
          {
            operation: "database_buffer_decryption_auth_failed",
            encryptedPath,
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

      if (
        metadata.dataSize !== undefined &&
        encryptedData.length !== metadata.dataSize
      ) {
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
    if (!fs.existsSync(filePath)) {
      return false;
    }

    const metadataPath = `${filePath}${this.METADATA_FILE_SUFFIX}`;
    if (fs.existsSync(metadataPath)) {
      try {
        const metadataContent = fs.readFileSync(metadataPath, "utf8");
        const metadata: EncryptedFileMetadata = JSON.parse(metadataContent);
        if (
          metadata.version === this.VERSION &&
          metadata.algorithm === this.ALGORITHM
        ) {
          return true;
        }
      } catch {
        // .meta parse failed, fall through to single-file detection
      }
    }

    try {
      const fileBuffer = fs.readFileSync(filePath);
      if (fileBuffer.length < 4) return false;

      const metadataLength = fileBuffer.readUInt32BE(0);
      const metadataEnd = 4 + metadataLength;

      if (metadataLength <= 0 || metadataEnd > fileBuffer.length) {
        return false;
      }

      const metadataJson = fileBuffer.slice(4, metadataEnd).toString("utf8");
      const metadata: EncryptedFileMetadata = JSON.parse(metadataJson);

      return (
        metadata.version === this.VERSION &&
        metadata.algorithm === this.ALGORITHM &&
        !!metadata.iv &&
        !!metadata.tag
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
        } catch (error) {}
      }

      if (
        result.dataFile.exists &&
        result.metadataFile.exists &&
        result.metadataFile.content
      ) {
        result.validation.filesConsistent = true;

        if (result.metadataFile.content.dataSize !== undefined) {
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
