import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { databaseLogger } from "./logger.js";

class SystemCrypto {
  private static instance: SystemCrypto;
  private jwtSecret: string | null = null;
  private databaseKey: Buffer | null = null;
  private internalAuthToken: string | null = null;

  private constructor() {}

  static getInstance(): SystemCrypto {
    if (!this.instance) {
      this.instance = new SystemCrypto();
    }
    return this.instance;
  }

  async initializeJWTSecret(): Promise<void> {
    try {
      const envSecret = process.env.JWT_SECRET;
      if (envSecret && envSecret.length >= 64) {
        this.jwtSecret = envSecret;
        return;
      }

      const dataDir = process.env.DATA_DIR || "./db/data";
      const envPath = path.join(dataDir, ".env");

      try {
        const envContent = await fs.readFile(envPath, "utf8");
        const jwtMatch = envContent.match(/^JWT_SECRET=(.+)$/m);
        if (jwtMatch && jwtMatch[1] && jwtMatch[1].length >= 64) {
          this.jwtSecret = jwtMatch[1];
          process.env.JWT_SECRET = jwtMatch[1];
          return;
        }
      } catch {}

      await this.generateAndGuideUser();
    } catch (error) {
      databaseLogger.error("Failed to initialize JWT secret", error, {
        operation: "jwt_init_failed",
      });
      throw new Error("JWT secret initialization failed");
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
      const envKey = process.env.DATABASE_KEY;
      if (envKey && envKey.length >= 64) {
        this.databaseKey = Buffer.from(envKey, "hex");
        return;
      }

      const dataDir = process.env.DATA_DIR || "./db/data";
      const envPath = path.join(dataDir, ".env");

      try {
        const envContent = await fs.readFile(envPath, "utf8");
        const dbKeyMatch = envContent.match(/^DATABASE_KEY=(.+)$/m);
        if (dbKeyMatch && dbKeyMatch[1] && dbKeyMatch[1].length >= 64) {
          this.databaseKey = Buffer.from(dbKeyMatch[1], "hex");
          process.env.DATABASE_KEY = dbKeyMatch[1];
          return;
        }
      } catch {}

      await this.generateAndGuideDatabaseKey();
    } catch (error) {
      databaseLogger.error("Failed to initialize database key", error, {
        operation: "db_key_init_failed",
      });
      throw new Error("Database key initialization failed");
    }
  }

  async getDatabaseKey(): Promise<Buffer> {
    if (!this.databaseKey) {
      await this.initializeDatabaseKey();
    }
    return this.databaseKey!;
  }

  async initializeInternalAuthToken(): Promise<void> {
    try {
      const envToken = process.env.INTERNAL_AUTH_TOKEN;
      if (envToken && envToken.length >= 32) {
        this.internalAuthToken = envToken;
        return;
      }

      const dataDir = process.env.DATA_DIR || "./db/data";
      const envPath = path.join(dataDir, ".env");

      try {
        const envContent = await fs.readFile(envPath, "utf8");
        const tokenMatch = envContent.match(/^INTERNAL_AUTH_TOKEN=(.+)$/m);
        if (tokenMatch && tokenMatch[1] && tokenMatch[1].length >= 32) {
          this.internalAuthToken = tokenMatch[1];
          process.env.INTERNAL_AUTH_TOKEN = tokenMatch[1];
          return;
        }
      } catch {}

      await this.generateAndGuideInternalAuthToken();
    } catch (error) {
      databaseLogger.error("Failed to initialize internal auth token", error, {
        operation: "internal_auth_init_failed",
      });
      throw new Error("Internal auth token initialization failed");
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

    this.jwtSecret = newSecret;

    await this.updateEnvFile("JWT_SECRET", newSecret);

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

    this.databaseKey = newKey;

    await this.updateEnvFile("DATABASE_KEY", newKeyHex);

    databaseLogger.success("Database key auto-generated and saved to .env", {
      operation: "db_key_auto_generated",
      instanceId,
      envVarName: "DATABASE_KEY",
      note: "Ready for use - no restart required",
    });
  }

  private async generateAndGuideInternalAuthToken(): Promise<void> {
    const newToken = crypto.randomBytes(32).toString("hex");
    const instanceId = crypto.randomBytes(8).toString("hex");

    this.internalAuthToken = newToken;

    await this.updateEnvFile("INTERNAL_AUTH_TOKEN", newToken);

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

    const hasEnvVar = !!(
      process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 64
    );

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

  private async updateEnvFile(key: string, value: string): Promise<void> {
    const dataDir = process.env.DATA_DIR || "./db/data";
    const envPath = path.join(dataDir, ".env");

    try {
      await fs.mkdir(dataDir, { recursive: true });

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

      await fs.writeFile(envPath, envContent);

      process.env[key] = value;
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
