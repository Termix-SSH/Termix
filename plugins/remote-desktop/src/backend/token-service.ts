import crypto from "crypto";

interface TokenLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface GuacamoleConnectionSettings {
  type?: "rdp" | "vnc" | "telnet";
  join?: string;
  readOnly?: boolean;
  guacdHost?: string;
  guacdPort?: number;
  settings: {
    hostname?: string;
    port?: number;
    username?: string;
    password?: string;
    domain?: string;
    width?: number;
    height?: number;
    dpi?: number;
    security?: string;
    "ignore-cert"?: boolean;
    "disable-auth"?: boolean;
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

export interface TermixGuacMeta {
  termixConnectId: string;
  hostId: number;
  hostName: string;
  ownerUserId: string;
  protocol: "rdp" | "vnc" | "telnet";
  tabInstanceId: string | null;
}

export interface GuacamoleToken {
  connection: GuacamoleConnectionSettings;
  recording?: GuacamoleRecordingMetadata;
  termixMeta?: TermixGuacMeta;
  /** When the token stops opening displays, in ms since the epoch. */
  exp?: number;
}

export interface GuacamoleRecordingMetadata {
  hostId: number;
  userId: string;
  protocol: "rdp" | "vnc" | "telnet";
  path: string;
  /** Directory guacd was told to write into; differs from the backend's view
   * when guacd runs in its own container. */
  guacdPath?: string;
  startedAt: string;
}

const CIPHER = "aes-256-cbc";
const KEY_LENGTH = 32;

/**
 * How long a token opens a display for. Short, because a token for a saved
 * host carries its password and ends up in the display URL.
 */
export const TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Settings the server decides, never the caller: where guacd is, and every
 * path guacd writes or reads on its own filesystem.
 */
export function isServerOwnedSetting(key: string): boolean {
  return (
    key.startsWith("guacd") ||
    key.endsWith("-path") ||
    key.startsWith("create-") ||
    key.startsWith("recording-") ||
    key.startsWith("typescript-")
  );
}

const silentLogger: TokenLogger = { warn: () => {}, error: () => {} };

/**
 * Encrypts the connection tokens guacamole-lite decrypts. Built in activate;
 * the key is derived from the environment, so a restart keeps it.
 */
export class GuacamoleTokenService {
  private encryptionKey: Buffer;
  private macKey: Buffer;

  constructor(
    private readonly log: TokenLogger = silentLogger,
    private readonly now: () => number = Date.now,
  ) {
    this.encryptionKey = this.initializeKey();
    this.macKey = crypto
      .createHmac("sha256", this.encryptionKey)
      .update("termix-guacamole-token-mac")
      .digest();
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

    this.log.warn("No persistent encryption key found, generating random key", {
      operation: "guac_key_generation",
    });
    return crypto.randomBytes(KEY_LENGTH);
  }

  getEncryptionKey(): Buffer {
    return this.encryptionKey;
  }

  /**
   * guacamole-lite only knows AES-CBC, which does not notice tampering, so
   * the ciphertext also carries an HMAC that verifyToken checks before
   * guacamole-lite ever sees the token.
   */
  encryptToken(tokenObject: GuacamoleToken): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(CIPHER, this.encryptionKey, iv);

    let encrypted = cipher.update(
      JSON.stringify({ ...tokenObject, exp: this.now() + TOKEN_TTL_MS }),
      "utf8",
      "base64",
    );
    encrypted += cipher.final("base64");

    const data = {
      iv: iv.toString("base64"),
      value: encrypted,
      mac: this.mac(iv.toString("base64"), encrypted),
    };

    return Buffer.from(JSON.stringify(data)).toString("base64");
  }

  private mac(iv: string, value: string): string {
    return crypto
      .createHmac("sha256", this.macKey)
      .update(`${iv}.${value}`)
      .digest("base64");
  }

  /**
   * The token if it is one this server minted, untouched and not expired,
   * else null. The gate in front of guacamole-lite.
   */
  verifyToken(token: string): GuacamoleToken | null {
    let data: { iv?: unknown; value?: unknown; mac?: unknown };
    try {
      data = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    } catch {
      return null;
    }
    if (
      typeof data?.iv !== "string" ||
      typeof data.value !== "string" ||
      typeof data.mac !== "string"
    ) {
      return null;
    }
    const expected = Buffer.from(this.mac(data.iv, data.value), "base64");
    const given = Buffer.from(data.mac, "base64");
    if (
      expected.length !== given.length ||
      !crypto.timingSafeEqual(expected, given)
    ) {
      return null;
    }
    const decoded = this.decryptToken(token);
    if (!decoded || typeof decoded.exp !== "number") return null;
    return decoded.exp > this.now() ? decoded : null;
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
      this.log.error("Failed to decrypt guacamole token", {
        operation: "guac_token_decrypt_error",
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  createRdpToken(
    hostname: string,
    username: string,
    password: string,
    options: Partial<GuacamoleConnectionSettings["settings"]> & {
      guacdHost?: string;
      guacdPort?: number;
    } = {},
    recording?: GuacamoleRecordingMetadata,
    termixMeta?: TermixGuacMeta,
  ): string {
    const { guacdHost, guacdPort, ...settingsOptions } = options;
    const token: GuacamoleToken = {
      connection: {
        type: "rdp",
        ...(guacdHost ? { guacdHost } : {}),
        ...(guacdPort ? { guacdPort } : {}),
        settings: {
          hostname,
          ...(username ? { username } : {}),
          ...(password ? { password } : {}),
          port: 3389,
          "ignore-cert": true,
          ...(!username && !password ? { "disable-auth": true } : {}),
          ...settingsOptions,
        },
      },
      recording,
      termixMeta,
    };
    return this.encryptToken(token);
  }

  createVncToken(
    hostname: string,
    username?: string,
    password?: string,
    options: Partial<GuacamoleConnectionSettings["settings"]> & {
      guacdHost?: string;
      guacdPort?: number;
    } = {},
    recording?: GuacamoleRecordingMetadata,
    termixMeta?: TermixGuacMeta,
  ): string {
    const { guacdHost, guacdPort, ...settingsOptions } = options;
    const token: GuacamoleToken = {
      connection: {
        type: "vnc",
        ...(guacdHost ? { guacdHost } : {}),
        ...(guacdPort ? { guacdPort } : {}),
        settings: {
          hostname,
          ...(username ? { username } : {}),
          password,
          port: 5900,
          ...settingsOptions,
        },
      },
      recording,
      termixMeta,
    };
    return this.encryptToken(token);
  }

  createTelnetToken(
    hostname: string,
    username?: string,
    password?: string,
    options: Partial<GuacamoleConnectionSettings["settings"]> & {
      guacdHost?: string;
      guacdPort?: number;
    } = {},
    recording?: GuacamoleRecordingMetadata,
    termixMeta?: TermixGuacMeta,
  ): string {
    const { guacdHost, guacdPort, ...settingsOptions } = options;
    const token: GuacamoleToken = {
      connection: {
        type: "telnet",
        ...(guacdHost ? { guacdHost } : {}),
        ...(guacdPort ? { guacdPort } : {}),
        settings: {
          hostname,
          username,
          password,
          port: 23,
          ...settingsOptions,
        },
      },
      recording,
      termixMeta,
    };
    return this.encryptToken(token);
  }

  // join tokens never carry recording params - only the primary connection's
  // token should write recording-path/recording-name to guacd.
  createJoinToken(guacamoleConnectionId: string, readOnly: boolean): string {
    const token: GuacamoleToken = {
      connection: {
        join: guacamoleConnectionId,
        readOnly,
        settings: {},
      },
    };
    return this.encryptToken(token);
  }
}
