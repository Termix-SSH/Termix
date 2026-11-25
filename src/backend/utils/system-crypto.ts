import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { databaseLogger } from "./logger.js";

/** Owner-only access for the secrets file. Not meaningful on Windows. */
export async function restrictToOwner(filePath: string): Promise<void> {
  if (process.platform === "win32") return;
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // best effort, new files are already written with 0600
  }
}

/** A rotation asked for a secret that is set outside .env. */
export class ExternalSecretError extends Error {
  constructor(readonly secretName: string) {
    super(
      `${secretName} is set through the environment or a file. Rotate it there.`,
    );
    this.name = "ExternalSecretError";
  }
}

/** Where a loaded secret came from. */
export type SecretSource = "env" | "file" | "dotenv" | "generated";

class SystemCrypto {
  private static instance: SystemCrypto;
  private jwtSecret: string | null = null;
  private databaseKey: Buffer | null = null;
  private encryptionKey: Buffer | null = null;
  private internalAuthToken: string | null = null;
  private secretSources = new Map<string, SecretSource>();

  private constructor() {}

  private async readExternalSecret(
    name: string,
    minimumLength: number,
  ): Promise<{ value: string; source: "env" | "file" } | null> {
    const direct = process.env[name]?.trim();
    if (direct && direct.length >= minimumLength) {
      return { value: direct, source: "env" };
    }

    const secretFile = process.env[`${name}_FILE`]?.trim();
    if (!secretFile) return null;
    const value = (await fs.readFile(secretFile, "utf8")).trim();
    if (value.length < minimumLength) {
      throw new Error(`${name}_FILE contains a secret that is too short`);
    }
    return { value, source: "file" };
  }

  private requireExternalSecret(name: string): never {
    throw new Error(
      `${name} must be supplied through ${name} or ${name}_FILE when TERMIX_REQUIRE_EXTERNAL_SECRETS=true`,
    );
  }

  private parseExternalHexKey(name: string, value: string): Buffer {
    if (!/^[0-9a-f]{64}$/i.test(value)) {
      throw new Error(`${name} must contain exactly 64 hexadecimal characters`);
    }
    return Buffer.from(value, "hex");
  }

  static getInstance(): SystemCrypto {
    if (!this.instance) {
      this.instance = new SystemCrypto();
    }
    return this.instance;
  }

  async initializeJWTSecret(): Promise<void> {
    try {
      const envSecret = await this.readExternalSecret("JWT_SECRET", 64);
      if (envSecret) {
        this.jwtSecret = envSecret.value;
        this.secretSources.set("JWT_SECRET", envSecret.source);
        return;
      }

      const dataDir = process.env.DATA_DIR || "./db/data";
      const envPath = path.join(dataDir, ".env");
      try {
        const envContent = await fs.readFile(envPath, "utf8");
        await restrictToOwner(envPath);
        const jwtMatch = envContent.match(/^JWT_SECRET=(.+)$/m);
        if (jwtMatch && jwtMatch[1] && jwtMatch[1].length >= 64) {
          this.jwtSecret = jwtMatch[1];
          this.secretSources.set("JWT_SECRET", "dotenv");
          databaseLogger.success("JWT secret loaded from .env file", {
            operation: "jwt_init_from_file_success",
            secretLength: jwtMatch[1].length,
          });
          return;
        } else {
          databaseLogger.warn(
            "JWT_SECRET in .env file is invalid or too short",
            {
              operation: "jwt_init_invalid_secret",
              hasMatch: !!jwtMatch,
              secretLength: jwtMatch?.[1]?.length || 0,
            },
          );
        }
      } catch {
        // expected - env file may not exist
      }

      if (process.env.TERMIX_REQUIRE_EXTERNAL_SECRETS === "true") {
        this.requireExternalSecret("JWT_SECRET");
      }
      await this.generateAndGuideUser();
    } catch (error) {
      databaseLogger.error("Failed to initialize JWT secret", error, {
        operation: "jwt_init_failed",
      });
      throw new Error("JWT secret initialization failed", { cause: error });
    }
  }

  async getJWTSecret(): Promise<string> {
    if (!this.jwtSecret) {
      await this.initializeJWTSecret();
    }
    return this.jwtSecret!;
  }

  async initializeDatabaseKey(): Promise<void> {
    try {
      const dataDir = process.env.DATA_DIR || "./db/data";
      const envPath = path.join(dataDir, ".env");

      const envKey = await this.readExternalSecret("DATABASE_KEY", 64);
      if (envKey) {
        this.databaseKey = this.parseExternalHexKey(
          "DATABASE_KEY",
          envKey.value,
        );
        this.secretSources.set("DATABASE_KEY", envKey.source);
        return;
      }

      try {
        const envContent = await fs.readFile(envPath, "utf8");
        const dbKeyMatch = envContent.match(/^DATABASE_KEY=(.+)$/m);
        if (dbKeyMatch && dbKeyMatch[1] && dbKeyMatch[1].length >= 64) {
          this.databaseKey = Buffer.from(dbKeyMatch[1], "hex");
          this.secretSources.set("DATABASE_KEY", "dotenv");
          return;
        } else {
          // expected - key not found or invalid length in env file
        }
      } catch {
        // expected - env file may not exist
      }

      if (process.env.TERMIX_REQUIRE_EXTERNAL_SECRETS === "true") {
        this.requireExternalSecret("DATABASE_KEY");
      }
      await this.generateAndGuideDatabaseKey();
    } catch (error) {
      databaseLogger.error("Failed to initialize database key", error, {
        operation: "db_key_init_failed",
        dataDir: process.env.DATA_DIR || "./db/data",
      });
      throw new Error("Database key initialization failed", { cause: error });
    }
  }

  async getDatabaseKey(): Promise<Buffer> {
    if (!this.databaseKey) {
      await this.initializeDatabaseKey();
    }
    return this.databaseKey!;
  }

  async initializeEncryptionKey(): Promise<void> {
    try {
      const dataDir = process.env.DATA_DIR || "./db/data";
      const envPath = path.join(dataDir, ".env");

      const envKey = await this.readExternalSecret("ENCRYPTION_KEY", 64);
      if (envKey) {
        this.encryptionKey = this.parseExternalHexKey(
          "ENCRYPTION_KEY",
          envKey.value,
        );
        this.secretSources.set("ENCRYPTION_KEY", envKey.source);
        return;
      }

      try {
        const envContent = await fs.readFile(envPath, "utf8");
        const keyMatch = envContent.match(/^ENCRYPTION_KEY=(.+)$/m);
        if (keyMatch && keyMatch[1] && keyMatch[1].length >= 64) {
          this.encryptionKey = Buffer.from(keyMatch[1], "hex");
          this.secretSources.set("ENCRYPTION_KEY", "dotenv");
          return;
        }
      } catch {
        // expected - env file may not exist
      }

      if (process.env.TERMIX_REQUIRE_EXTERNAL_SECRETS === "true") {
        this.requireExternalSecret("ENCRYPTION_KEY");
      }
      await this.generateAndGuideEncryptionKey();
    } catch (error) {
      databaseLogger.error("Failed to initialize encryption key", error, {
        operation: "encryption_key_init_failed",
        dataDir: process.env.DATA_DIR || "./db/data",
      });
      throw new Error("Encryption key initialization failed", { cause: error });
    }
  }

  async getEncryptionKey(): Promise<Buffer> {
    if (!this.encryptionKey) {
      await this.initializeEncryptionKey();
      const previous = await this.getPreviousKeys("ENCRYPTION_KEY");
      if (previous.some((key) => key.equals(this.encryptionKey!))) {
        this.encryptionKey = null;
        this.secretSources.delete("ENCRYPTION_KEY");
        throw new Error(
          "ENCRYPTION_KEY is one of the keys in ENCRYPTION_KEY_PREVIOUS. An environment variable may still hold the old key after a rotation: set it to the new key or remove it",
        );
      }
    }
    return this.encryptionKey!;
  }

  async initializeInternalAuthToken(): Promise<void> {
    try {
      const envToken = await this.readExternalSecret("INTERNAL_AUTH_TOKEN", 32);
      if (envToken) {
        this.internalAuthToken = envToken.value;
        this.secretSources.set("INTERNAL_AUTH_TOKEN", envToken.source);
        return;
      }

      const dataDir = process.env.DATA_DIR || "./db/data";
      const envPath = path.join(dataDir, ".env");

      try {
        const envContent = await fs.readFile(envPath, "utf8");
        const tokenMatch = envContent.match(/^INTERNAL_AUTH_TOKEN=(.+)$/m);
        if (tokenMatch && tokenMatch[1] && tokenMatch[1].length >= 32) {
          this.internalAuthToken = tokenMatch[1];
          this.secretSources.set("INTERNAL_AUTH_TOKEN", "dotenv");
          return;
        }
      } catch {
        // expected - env file may not exist
      }

      if (process.env.TERMIX_REQUIRE_EXTERNAL_SECRETS === "true") {
        this.requireExternalSecret("INTERNAL_AUTH_TOKEN");
      }
      await this.generateAndGuideInternalAuthToken();
    } catch (error) {
      databaseLogger.error("Failed to initialize internal auth token", error, {
        operation: "internal_auth_init_failed",
      });
      throw new Error("Internal auth token initialization failed", {
        cause: error,
      });
    }
  }

  async getInternalAuthToken(): Promise<string> {
    if (!this.internalAuthToken) {
      await this.initializeInternalAuthToken();
    }
    return this.internalAuthToken!;
  }

  private async generateAndGuideUser(): Promise<void> {
    const newSecret = crypto.randomBytes(32).toString("hex");
    const instanceId = crypto.randomBytes(8).toString("hex");

    await this.updateEnvFile("JWT_SECRET", newSecret);
    this.jwtSecret = newSecret;
    this.secretSources.set("JWT_SECRET", "generated");

    databaseLogger.success("JWT secret auto-generated and saved to .env", {
      operation: "jwt_auto_generated",
      instanceId,
      envVarName: "JWT_SECRET",
      note: "Ready for use - no restart required",
    });
  }

  private async generateAndGuideDatabaseKey(): Promise<void> {
    const newKey = crypto.randomBytes(32);
    const newKeyHex = newKey.toString("hex");
    const instanceId = crypto.randomBytes(8).toString("hex");

    await this.updateEnvFile("DATABASE_KEY", newKeyHex);
    this.databaseKey = newKey;
    this.secretSources.set("DATABASE_KEY", "generated");

    databaseLogger.success("Database key auto-generated and saved to .env", {
      operation: "db_key_auto_generated",
      instanceId,
      envVarName: "DATABASE_KEY",
      note: "Ready for use - no restart required",
    });
  }

  private async generateAndGuideEncryptionKey(): Promise<void> {
    const newKey = crypto.randomBytes(32);
    const newKeyHex = newKey.toString("hex");
    const instanceId = crypto.randomBytes(8).toString("hex");

    await this.updateEnvFile("ENCRYPTION_KEY", newKeyHex);
    this.encryptionKey = newKey;
    this.secretSources.set("ENCRYPTION_KEY", "generated");

    databaseLogger.success("Encryption key auto-generated and saved to .env", {
      operation: "encryption_key_auto_generated",
      instanceId,
      envVarName: "ENCRYPTION_KEY",
      note: "Used to wrap session data keys - no restart required",
    });
  }

  private async generateAndGuideInternalAuthToken(): Promise<void> {
    const newToken = crypto.randomBytes(32).toString("hex");
    const instanceId = crypto.randomBytes(8).toString("hex");

    await this.updateEnvFile("INTERNAL_AUTH_TOKEN", newToken);
    this.internalAuthToken = newToken;
    this.secretSources.set("INTERNAL_AUTH_TOKEN", "generated");

    databaseLogger.success(
      "Internal auth token auto-generated and saved to .env",
      {
        operation: "internal_auth_auto_generated",
        instanceId,
        envVarName: "INTERNAL_AUTH_TOKEN",
        note: "Ready for use - no restart required",
      },
    );
  }

  async validateJWTSecret(): Promise<boolean> {
    try {
      const secret = await this.getJWTSecret();
      if (!secret || secret.length < 32) {
        return false;
      }

      const jwt = await import("jsonwebtoken");
      const testPayload = { test: true, timestamp: Date.now() };
      const token = jwt.default.sign(testPayload, secret, { expiresIn: "1s" });
      const decoded = jwt.default.verify(token, secret);

      return !!decoded;
    } catch (error) {
      databaseLogger.error("JWT secret validation failed", error, {
        operation: "jwt_validation_failed",
      });
      return false;
    }
  }

  async getSystemKeyStatus() {
    const isValid = await this.validateJWTSecret();
    const hasSecret = this.jwtSecret !== null;
    const source = this.secretSources.get("JWT_SECRET");

    const hasEnvVar =
      source === "env" ||
      source === "file" ||
      !!(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 64);

    return {
      hasSecret,
      isValid,
      storage: {
        environment: hasEnvVar,
      },
      algorithm: "HS256",
      note: "Using simplified key management without encryption layers",
    };
  }

  /** Where a loaded secret came from, if it has been initialized. */
  getSecretSource(name: string): SecretSource | undefined {
    return this.secretSources.get(name);
  }

  /** Whether name comes from the environment or a _FILE secret, not .env. */
  async isExternalSecret(name: string): Promise<boolean> {
    if (process.env[`${name}_FILE`]?.trim()) return true;
    const direct = process.env[name]?.trim();
    if (direct) {
      // The starter loads .env into process.env, but never over a real variable.
      const line = (await this.readDotEnv()).match(
        new RegExp(`^${name}=(.+)$`, "m"),
      );
      return !line || line[1].trim() !== direct;
    }
    const source = this.secretSources.get(name);
    return source === "env" || source === "file";
  }

  /**
   * Keys a rotation replaced, newest first. Set as NAME_PREVIOUS (comma
   * separated hex), NAME_PREVIOUS_FILE or a NAME_PREVIOUS line in .env.
   */
  async getPreviousKeys(name: string): Promise<Buffer[]> {
    const values: string[] = [];
    const direct = process.env[`${name}_PREVIOUS`]?.trim();
    if (direct) values.push(direct);
    const file = process.env[`${name}_PREVIOUS_FILE`]?.trim();
    if (file) values.push((await fs.readFile(file, "utf8")).trim());
    if (!direct) {
      const fromEnvFile = (await this.readDotEnv()).match(
        new RegExp(`^${name}_PREVIOUS=(.+)$`, "m"),
      );
      if (fromEnvFile) values.push(fromEnvFile[1].trim());
    }
    const keys: Buffer[] = [];
    for (const part of values.join(",").split(",")) {
      const hex = part.trim();
      if (!hex) continue;
      keys.push(this.parseExternalHexKey(`${name}_PREVIOUS`, hex));
    }
    return keys;
  }

  private async readDotEnv(): Promise<string> {
    const dataDir = process.env.DATA_DIR || "./db/data";
    try {
      return await fs.readFile(path.join(dataDir, ".env"), "utf8");
    } catch {
      return "";
    }
  }

  /**
   * Replaces the JWT secret kept in .env. Every token signed with the old one
   * stops verifying. Refused when the secret comes from outside.
   */
  async rotateJWTSecret(): Promise<void> {
    if (await this.isExternalSecret("JWT_SECRET")) {
      throw new ExternalSecretError("JWT_SECRET");
    }
    const next = crypto.randomBytes(32).toString("hex");
    await this.updateEnvFile("JWT_SECRET", next);
    this.jwtSecret = next;
    this.secretSources.set("JWT_SECRET", "dotenv");
  }

  /**
   * Replaces the encryption key kept in .env and keeps the old one as
   * ENCRYPTION_KEY_PREVIOUS, so data sealed with it still opens until the
   * re-encryption pass has moved everything to the new key.
   */
  async rotateEncryptionKey(): Promise<Buffer> {
    if (await this.isExternalSecret("ENCRYPTION_KEY")) {
      throw new ExternalSecretError("ENCRYPTION_KEY");
    }
    const current = await this.getEncryptionKey();
    const previous = (await this.getPreviousKeys("ENCRYPTION_KEY")).map((key) =>
      key.toString("hex"),
    );
    const next = crypto.randomBytes(32);
    await this.updateEnvFile(
      "ENCRYPTION_KEY_PREVIOUS",
      [current.toString("hex"), ...previous].join(","),
    );
    await this.updateEnvFile("ENCRYPTION_KEY", next.toString("hex"));
    this.encryptionKey = next;
    this.secretSources.set("ENCRYPTION_KEY", "dotenv");
    return next;
  }

  /** Drops ENCRYPTION_KEY_PREVIOUS from .env once nothing needs it. */
  async forgetPreviousEncryptionKeys(): Promise<void> {
    const content = await this.readDotEnv();
    if (!/^ENCRYPTION_KEY_PREVIOUS=/m.test(content)) return;
    await this.updateEnvFile("ENCRYPTION_KEY_PREVIOUS", "");
  }

  /** Test seam. */
  resetForTests(): void {
    this.jwtSecret = null;
    this.databaseKey = null;
    this.encryptionKey = null;
    this.internalAuthToken = null;
    this.secretSources.clear();
  }

  private async updateEnvFile(key: string, value: string): Promise<void> {
    const dataDir = process.env.DATA_DIR || "./db/data";
    const envPath = path.join(dataDir, ".env");

    try {
      await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });

      let envContent = "";

      try {
        envContent = await fs.readFile(envPath, "utf8");
      } catch {
        envContent = "# Termix Auto-generated Configuration\n\n";
      }

      const keyRegex = new RegExp(`^${key}=.*$`, "m");

      if (keyRegex.test(envContent)) {
        envContent = envContent.replace(keyRegex, `${key}=${value}`);
      } else {
        if (!envContent.includes("# Security Keys")) {
          envContent += "\n# Security Keys (Auto-generated)\n";
        }
        envContent += `${key}=${value}\n`;
      }

      await fs.writeFile(envPath, envContent, { mode: 0o600 });
      await restrictToOwner(envPath);
    } catch (error) {
      databaseLogger.error(`Failed to update .env file with ${key}`, error, {
        operation: "env_file_update_failed",
        key,
      });
      throw error;
    }
  }
}

export { SystemCrypto };
