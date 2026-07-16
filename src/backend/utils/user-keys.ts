import crypto from "crypto";
import { SystemCrypto } from "./system-crypto.js";
import {
  createCurrentSettingsRepository,
  getCurrentSettingValue,
} from "../database/repositories/factory.js";
import { authLogger } from "./logger.js";

const DEK_LENGTH = 32;
const WRAP_VERSION = 3;
const WRAP_ALGORITHM = "aes-256-gcm";
const WRAP_INFO_PREFIX = "termix:dek-wrap:v3:";
const CACHE_TTL_MS = 15 * 60 * 1000;

export type UserKeyUnavailableReason = "pending_migration" | "missing";

export class UserKeyUnavailableError extends Error {
  constructor(
    readonly userId: string,
    readonly reason: UserKeyUnavailableReason,
  ) {
    super(
      reason === "pending_migration"
        ? `User ${userId} data stays locked until their next login migrates their encryption key`
        : `User ${userId} has no data encryption key`,
    );
    this.name = "UserKeyUnavailableError";
  }
}

interface WrappedDek {
  v: number;
  alg: string;
  iv: string;
  ct: string;
  tag: string;
  createdAt: string;
}

interface CacheEntry {
  dek: Buffer;
  expiresAt: number;
}

export function userDekSettingsKey(userId: string): string {
  return `user_dek_v3_${userId}`;
}

const LEGACY_WRAP_KEY_PREFIXES = [
  "user_encrypted_dek_",
  "user_kek_salt_",
] as const;

export class UserKeyManager {
  private static instance: UserKeyManager | null = null;

  private masterKey: Buffer | null = null;
  private cache = new Map<string, CacheEntry>();

  static getInstance(): UserKeyManager {
    if (!UserKeyManager.instance) {
      UserKeyManager.instance = new UserKeyManager();
    }
    return UserKeyManager.instance;
  }

  async initialize(masterKey?: Buffer): Promise<void> {
    this.masterKey =
      masterKey ?? (await SystemCrypto.getInstance().getEncryptionKey());
    this.cache.clear();
  }

  getUserDEK(userId: string): Buffer {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.dek;
    }

    const raw = getCurrentSettingValue(userDekSettingsKey(userId));
    if (!raw) {
      throw new UserKeyUnavailableError(
        userId,
        this.hasLegacyWrap(userId) ? "pending_migration" : "missing",
      );
    }

    const dek = this.unwrap(userId, raw);
    this.cacheDek(userId, dek);
    return dek;
  }

  tryGetUserDEK(userId: string): Buffer | null {
    try {
      return this.getUserDEK(userId);
    } catch (error) {
      if (error instanceof UserKeyUnavailableError) {
        return null;
      }
      throw error;
    }
  }

  hasUserDEK(userId: string): boolean {
    if (this.cache.has(userId)) return true;
    return getCurrentSettingValue(userDekSettingsKey(userId)) !== null;
  }

  async createUserDEK(userId: string): Promise<Buffer> {
    if (this.hasUserDEK(userId)) {
      throw new Error(`User ${userId} already has a data encryption key`);
    }

    const dek = crypto.randomBytes(DEK_LENGTH);
    await this.persistDEK(userId, dek);
    return dek;
  }

  async persistDEK(userId: string, dek: Buffer): Promise<void> {
    if (dek.length !== DEK_LENGTH) {
      throw new Error(`DEK must be ${DEK_LENGTH} bytes`);
    }

    const wrapped = this.wrap(userId, dek);
    await createCurrentSettingsRepository().upsert(
      userDekSettingsKey(userId),
      JSON.stringify(wrapped),
    );
    this.cacheDek(userId, dek);
  }

  async rotateUserDEK(userId: string): Promise<Buffer> {
    const dek = crypto.randomBytes(DEK_LENGTH);
    await this.persistDEK(userId, dek);
    authLogger.warn(`Replaced data encryption key for user ${userId}`, {
      operation: "user_dek_rotated",
      userId,
    });
    return dek;
  }

  async deleteUserDEK(userId: string): Promise<void> {
    await createCurrentSettingsRepository().delete(userDekSettingsKey(userId));
    this.invalidate(userId);
  }

  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  clearCache(): void {
    this.cache.clear();
  }

  private hasLegacyWrap(userId: string): boolean {
    return LEGACY_WRAP_KEY_PREFIXES.some(
      (prefix) => getCurrentSettingValue(`${prefix}${userId}`) !== null,
    );
  }

  private cacheDek(userId: string, dek: Buffer): void {
    this.cache.set(userId, { dek, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  private deriveWrapKey(userId: string): Buffer {
    if (!this.masterKey) {
      throw new Error("UserKeyManager is not initialized");
    }

    return Buffer.from(
      crypto.hkdfSync(
        "sha256",
        this.masterKey,
        Buffer.alloc(0),
        `${WRAP_INFO_PREFIX}${userId}`,
        DEK_LENGTH,
      ),
    );
  }

  private wrap(userId: string, dek: Buffer): WrappedDek {
    const wrapKey = this.deriveWrapKey(userId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(WRAP_ALGORITHM, wrapKey, iv);
    cipher.setAAD(Buffer.from(userId, "utf8"));
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);

    return {
      v: WRAP_VERSION,
      alg: WRAP_ALGORITHM,
      iv: iv.toString("base64"),
      ct: ct.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      createdAt: new Date().toISOString(),
    };
  }

  private unwrap(userId: string, raw: string): Buffer {
    let wrapped: WrappedDek;
    try {
      wrapped = JSON.parse(raw) as WrappedDek;
    } catch {
      throw new Error(`Stored key wrap for user ${userId} is not valid JSON`);
    }

    if (wrapped.v !== WRAP_VERSION || wrapped.alg !== WRAP_ALGORITHM) {
      throw new Error(
        `Unsupported key wrap (v=${wrapped.v}, alg=${wrapped.alg}) for user ${userId}`,
      );
    }

    const wrapKey = this.deriveWrapKey(userId);
    const decipher = crypto.createDecipheriv(
      WRAP_ALGORITHM,
      wrapKey,
      Buffer.from(wrapped.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(userId, "utf8"));
    decipher.setAuthTag(Buffer.from(wrapped.tag, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(wrapped.ct, "base64")),
      decipher.final(),
    ]);
  }
}
