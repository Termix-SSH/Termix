import crypto from "crypto";
import { databaseLogger } from "./logger.js";

interface ProtectedKeyData {
  data: string;
  iv: string;
  tag: string;
  version: string;
  salt: string;
}

class MasterKeyProtection {
  private static readonly VERSION = "v2";
  private static readonly KEK_ITERATIONS = 100000;

  private static deriveKEK(userPassword: string, salt: Buffer): Buffer {
    if (!userPassword) {
      throw new Error("User password is required for KEK derivation");
    }

    const kek = crypto.pbkdf2Sync(
      userPassword,
      salt,
      this.KEK_ITERATIONS,
      32,
      "sha256",
    );

    return kek;
  }

  static encryptMasterKey(masterKey: string, userPassword: string): string {
    if (!masterKey) {
      throw new Error("Master key cannot be empty");
    }
    if (!userPassword) {
      throw new Error("User password is required for encryption");
    }

    try {
      const salt = crypto.randomBytes(32);
      const kek = this.deriveKEK(userPassword, salt);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv) as any;

      let encrypted = cipher.update(masterKey, "hex", "hex");
      encrypted += cipher.final("hex");
      const tag = cipher.getAuthTag();

      const protectedData: ProtectedKeyData = {
        data: encrypted,
        iv: iv.toString("hex"),
        tag: tag.toString("hex"),
        version: this.VERSION,
        salt: salt.toString("hex"),
      };

      const result = JSON.stringify(protectedData);

      databaseLogger.info("Master key encrypted with password-derived KEK", {
        operation: "master_key_encryption",
        version: this.VERSION,
        saltLength: salt.length,
        iterations: this.KEK_ITERATIONS,
      });

      return result;
    } catch (error) {
      databaseLogger.error("Failed to encrypt master key", error, {
        operation: "master_key_encryption_failed",
      });
      throw new Error("Master key encryption failed");
    }
  }

  static decryptMasterKey(encryptedKey: string, userPassword: string): string {
    if (!encryptedKey) {
      throw new Error("Encrypted key cannot be empty");
    }
    if (!userPassword) {
      throw new Error("User password is required for decryption");
    }

    try {
      const protectedData: ProtectedKeyData = JSON.parse(encryptedKey);

      // Support both v1 (hardware fingerprint) and v2 (password-based) for migration
      if (protectedData.version === "v1") {
        throw new Error(
          "Legacy hardware-based encryption detected. Please regenerate encryption keys for improved security.",
        );
      }

      if (protectedData.version !== this.VERSION) {
        throw new Error(
          `Unsupported protection version: ${protectedData.version}`,
        );
      }

      const salt = Buffer.from(protectedData.salt, "hex");
      const kek = this.deriveKEK(userPassword, salt);
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        kek,
        Buffer.from(protectedData.iv, "hex"),
      ) as any;
      decipher.setAuthTag(Buffer.from(protectedData.tag, "hex"));

      let decrypted = decipher.update(protectedData.data, "hex", "hex");
      decrypted += decipher.final("hex");

      databaseLogger.info("Master key decrypted successfully", {
        operation: "master_key_decryption",
        version: protectedData.version,
        saltLength: salt.length,
      });

      return decrypted;
    } catch (error) {
      databaseLogger.error("Failed to decrypt master key", error, {
        operation: "master_key_decryption_failed",
      });
      throw new Error(
        `Master key decryption failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  static isProtectedKey(data: string): boolean {
    try {
      const parsed = JSON.parse(data);

      // Support both v1 (fingerprint) and v2 (salt) formats
      const hasV1Format = !!(
        parsed.data &&
        parsed.iv &&
        parsed.tag &&
        parsed.version &&
        parsed.fingerprint
      );

      const hasV2Format = !!(
        parsed.data &&
        parsed.iv &&
        parsed.tag &&
        parsed.version &&
        parsed.salt
      );

      return hasV1Format || hasV2Format;
    } catch {
      return false;
    }
  }

  static validateProtection(userPassword: string): boolean {
    try {
      const testKey = crypto.randomBytes(32).toString("hex");
      const encrypted = this.encryptMasterKey(testKey, userPassword);
      const decrypted = this.decryptMasterKey(encrypted, userPassword);

      const isValid = decrypted === testKey;

      databaseLogger.info("Master key protection validation completed", {
        operation: "protection_validation",
        result: isValid ? "passed" : "failed",
        version: this.VERSION,
      });

      return isValid;
    } catch (error) {
      databaseLogger.error("Master key protection validation failed", error, {
        operation: "protection_validation_failed",
      });
      return false;
    }
  }

  static getProtectionInfo(encryptedKey: string): {
    version: string;
    isPasswordBased: boolean;
    saltLength?: number;
    iterations?: number;
  } | null {
    try {
      if (!this.isProtectedKey(encryptedKey)) {
        return null;
      }

      const protectedData: ProtectedKeyData = JSON.parse(encryptedKey);

      const info = {
        version: protectedData.version,
        isPasswordBased: protectedData.version === "v2",
      };

      // Add additional info for v2 format
      if (protectedData.version === "v2" && protectedData.salt) {
        return {
          ...info,
          saltLength: Buffer.from(protectedData.salt, "hex").length,
          iterations: this.KEK_ITERATIONS,
        };
      }

      return info;
    } catch {
      return null;
    }
  }
}

export { MasterKeyProtection };
export type { ProtectedKeyData };
