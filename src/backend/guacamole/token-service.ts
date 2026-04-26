import crypto from "crypto";
import { guacLogger } from "../utils/logger.js";

export interface GuacamoleConnectionSettings {
  type: "rdp" | "vnc" | "telnet";
  settings: {
    hostname: string;
    port?: number;
    username?: string;
    password?: string;
    domain?: string;
    width?: number;
    height?: number;
    dpi?: number;
    security?: string;
    "ignore-cert"?: boolean;
    "enable-wallpaper"?: boolean;
    "enable-drive"?: boolean;
    "drive-path"?: string;
    "create-drive-path"?: boolean;
    "swap-red-blue"?: boolean;
    cursor?: string;
    "terminal-type"?: string;
    [key: string]: unknown;
  };
}

export interface GuacamoleToken {
  connection: GuacamoleConnectionSettings;
}

const CIPHER = "aes-256-cbc";
const KEY_LENGTH = 32;

export class GuacamoleTokenService {
  private static instance: GuacamoleTokenService;
  private encryptionKey: Buffer;

  private constructor() {
    this.encryptionKey = this.initializeKey();
  }

  static getInstance(): GuacamoleTokenService {
    if (!GuacamoleTokenService.instance) {
      GuacamoleTokenService.instance = new GuacamoleTokenService();
    }
    return GuacamoleTokenService.instance;
  }

  private initializeKey(): Buffer {
    const existingKey = process.env.GUACAMOLE_ENCRYPTION_KEY;
    if (existingKey) {
      if (existingKey.length === 64 && /^[0-9a-fA-F]+$/.test(existingKey)) {
        return Buffer.from(existingKey, "hex");
      }
      if (existingKey.length === KEY_LENGTH) {
        return Buffer.from(existingKey, "utf8");
      }
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
      return crypto
        .createHash("sha256")
        .update(jwtSecret + "_guacamole")
        .digest();
    }

    guacLogger.warn(
      "No persistent encryption key found, generating random key",
      {
        operation: "guac_key_generation",
      },
    );
    return crypto.randomBytes(KEY_LENGTH);
  }

  getEncryptionKey(): Buffer {
    return this.encryptionKey;
  }

  encryptToken(tokenObject: GuacamoleToken): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(CIPHER, this.encryptionKey, iv);

    let encrypted = cipher.update(
      JSON.stringify(tokenObject),
      "utf8",
      "base64",
    );
    encrypted += cipher.final("base64");

    const data = {
      iv: iv.toString("base64"),
      value: encrypted,
    };

    return Buffer.from(JSON.stringify(data)).toString("base64");
  }

  decryptToken(token: string): GuacamoleToken | null {
    try {
      const data = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
      const iv = Buffer.from(data.iv, "base64");
      const decipher = crypto.createDecipheriv(CIPHER, this.encryptionKey, iv);

      let decrypted = decipher.update(data.value, "base64", "utf8");
      decrypted += decipher.final("utf8");

      return JSON.parse(decrypted) as GuacamoleToken;
    } catch (error) {
      guacLogger.error("Failed to decrypt guacamole token", error, {
        operation: "guac_token_decrypt_error",
      });
      return null;
    }
  }

  createRdpToken(
    hostname: string,
    username: string,
    password: string,
    options: Partial<GuacamoleConnectionSettings["settings"]> = {},
  ): string {
    const token: GuacamoleToken = {
      connection: {
        type: "rdp",
        settings: {
          hostname,
          username,
          password,
          port: 3389,
          security: "nla",
          "ignore-cert": true,
          ...options,
        },
      },
    };
    return this.encryptToken(token);
  }

  createVncToken(
    hostname: string,
    username?: string,
    password?: string,
    options: Partial<GuacamoleConnectionSettings["settings"]> = {},
  ): string {
    const token: GuacamoleToken = {
      connection: {
        type: "vnc",
        settings: {
          hostname,
          ...(username ? { username } : {}),
          password,
          port: 5900,
          ...options,
        },
      },
    };
    return this.encryptToken(token);
  }

  createTelnetToken(
    hostname: string,
    username?: string,
    password?: string,
    options: Partial<GuacamoleConnectionSettings["settings"]> = {},
  ): string {
    const token: GuacamoleToken = {
      connection: {
        type: "telnet",
        settings: {
          hostname,
          username,
          password,
          port: 23,
          ...options,
        },
      },
    };
    return this.encryptToken(token);
  }
}
