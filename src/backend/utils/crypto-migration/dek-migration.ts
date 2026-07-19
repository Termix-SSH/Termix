import crypto from "crypto";
import { databaseLogger } from "../logger.js";
import { SystemCrypto } from "../system-crypto.js";
import { UserKeyManager } from "../user-keys.js";
import {
  createCurrentSettingsRepository,
  createCurrentUserRepository,
  getCurrentSettingValue,
} from "../../database/repositories/factory.js";

// Legacy (pre-v3) wrap formats, kept only to migrate existing installs.
// Password users: DEK wrapped by PBKDF2(password) using user_kek_salt_*.
// OIDC/WebAuthn users: DEK wrapped by a key derived from the system
// ENCRYPTION_KEY (or *_SYSTEM_SECRET env overrides), so the server can
// unwrap those eagerly at boot. Password wraps need the password (login)
// or the DEK recovered from a live session's JWT.

interface LegacyEncryptedDEK {
  data: string;
  iv: string;
  tag: string;
  algorithm: string;
  createdAt: string;
}

interface LegacyKekSalt {
  salt: string;
  iterations: number;
  algorithm: string;
  createdAt: string;
}

const KEY_LENGTH = 32;

export function legacySettingsKeys(userId: string): {
  passwordWrap: string;
  kekSalt: string;
  oidcWrap: string;
  webauthnWrap: string;
} {
  return {
    passwordWrap: `user_encrypted_dek_${userId}`,
    kekSalt: `user_kek_salt_${userId}`,
    oidcWrap: `user_encrypted_dek_oidc_${userId}`,
    webauthnWrap: `user_encrypted_dek_webauthn_${userId}`,
  };
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function decryptLegacyDEK(encrypted: LegacyEncryptedDEK, kek: Buffer): Buffer {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    kek,
    Buffer.from(encrypted.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.data, "hex")),
    decipher.final(),
  ]);
}

function deriveLegacyKEK(password: string, kekSalt: LegacyKekSalt): Buffer {
  return crypto.pbkdf2Sync(
    password,
    Buffer.from(kekSalt.salt, "hex"),
    kekSalt.iterations,
    KEY_LENGTH,
    "sha256",
  );
}

async function deriveOIDCSystemKey(userId: string): Promise<Buffer> {
  if (process.env.OIDC_SYSTEM_SECRET) {
    return crypto.pbkdf2Sync(
      process.env.OIDC_SYSTEM_SECRET,
      Buffer.from(userId, "utf8"),
      100000,
      KEY_LENGTH,
      "sha256",
    );
  }

  const systemSecret = await SystemCrypto.getInstance().getEncryptionKey();
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      systemSecret,
      Buffer.from(userId, "utf8"),
      Buffer.from("termix:oidc-user-kek", "utf8"),
      KEY_LENGTH,
    ),
  );
}

async function deriveWebAuthnSystemKey(userId: string): Promise<Buffer> {
  const configuredSecret =
    process.env.WEBAUTHN_SYSTEM_SECRET || process.env.OIDC_SYSTEM_SECRET;
  if (configuredSecret) {
    return crypto.pbkdf2Sync(
      configuredSecret,
      Buffer.from(`webauthn:${userId}`, "utf8"),
      100000,
      KEY_LENGTH,
      "sha256",
    );
  }

  const systemSecret = await SystemCrypto.getInstance().getEncryptionKey();
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      systemSecret,
      Buffer.from(userId, "utf8"),
      Buffer.from("termix:webauthn-user-kek", "utf8"),
      KEY_LENGTH,
    ),
  );
}

function deriveLegacyDefaultKey(
  userId: string,
  type: "oidc" | "webauthn",
): Buffer {
  const secret =
    type === "oidc"
      ? "termix-oidc-system-secret-default"
      : "termix-webauthn-system-secret-default";
  const salt = Buffer.from(
    type === "oidc" ? userId : `webauthn:${userId}`,
    "utf8",
  );
  return crypto.pbkdf2Sync(secret, salt, 100000, KEY_LENGTH, "sha256");
}

async function tryUnwrapSystemWrapped(
  userId: string,
  raw: string | null,
  type: "oidc" | "webauthn",
): Promise<Buffer | null> {
  const encrypted = parseJson<LegacyEncryptedDEK>(raw);
  if (!encrypted?.data || !encrypted.iv || !encrypted.tag) return null;

  const candidates = [
    type === "oidc"
      ? await deriveOIDCSystemKey(userId)
      : await deriveWebAuthnSystemKey(userId),
    deriveLegacyDefaultKey(userId, type),
  ];

  for (const key of candidates) {
    try {
      const dek = decryptLegacyDEK(encrypted, key);
      if (dek.length === KEY_LENGTH) return dek;
    } catch {
      // wrong key for this wrap; try the next candidate
    }
  }

  return null;
}

function hasAnyLegacyWrap(userId: string): boolean {
  const keys = legacySettingsKeys(userId);
  return (
    getCurrentSettingValue(keys.passwordWrap) !== null ||
    getCurrentSettingValue(keys.kekSalt) !== null ||
    getCurrentSettingValue(keys.oidcWrap) !== null ||
    getCurrentSettingValue(keys.webauthnWrap) !== null
  );
}

export async function deleteLegacyWraps(userId: string): Promise<void> {
  const keys = legacySettingsKeys(userId);
  const settings = createCurrentSettingsRepository();
  await settings.delete(keys.passwordWrap);
  await settings.delete(keys.kekSalt);
  await settings.delete(keys.oidcWrap);
  await settings.delete(keys.webauthnWrap);
}

// Server-side unwrap for one user, in preference order. The primary
// user_encrypted_dek_* slot is only tried when no KEK salt exists: with a
// salt present it is password-wrapped and unrecoverable here.
async function unwrapServerSide(userId: string): Promise<Buffer | null> {
  const keys = legacySettingsKeys(userId);

  const fromOidc = await tryUnwrapSystemWrapped(
    userId,
    getCurrentSettingValue(keys.oidcWrap),
    "oidc",
  );
  if (fromOidc) return fromOidc;

  const fromWebauthn = await tryUnwrapSystemWrapped(
    userId,
    getCurrentSettingValue(keys.webauthnWrap),
    "webauthn",
  );
  if (fromWebauthn) return fromWebauthn;

  if (getCurrentSettingValue(keys.kekSalt) === null) {
    const fromPrimary = await tryUnwrapSystemWrapped(
      userId,
      getCurrentSettingValue(keys.passwordWrap),
      "oidc",
    );
    if (fromPrimary) return fromPrimary;
  }

  return null;
}

export interface BootDekMigrationSummary {
  totalUsers: number;
  alreadyMigrated: number;
  migrated: number;
  created: number;
  pendingPasswordLogin: number;
}

export interface BootDekMigrationOptions {
  cleanupLegacy?: boolean;
}

export async function runBootDekMigration(
  options: BootDekMigrationOptions = {},
): Promise<BootDekMigrationSummary> {
  const cleanupLegacy = options.cleanupLegacy ?? false;
  const userKeys = UserKeyManager.getInstance();
  const users = await createCurrentUserRepository().listAll();

  const summary: BootDekMigrationSummary = {
    totalUsers: users.length,
    alreadyMigrated: 0,
    migrated: 0,
    created: 0,
    pendingPasswordLogin: 0,
  };

  for (const user of users) {
    if (userKeys.hasUserDEK(user.id)) {
      summary.alreadyMigrated++;
      if (cleanupLegacy && hasAnyLegacyWrap(user.id)) {
        await deleteLegacyWraps(user.id);
      }
      continue;
    }

    const dek = await unwrapServerSide(user.id);
    if (dek) {
      await userKeys.persistDEK(user.id, dek);
      summary.migrated++;
      if (cleanupLegacy) {
        await deleteLegacyWraps(user.id);
      }
      continue;
    }

    if (hasAnyLegacyWrap(user.id)) {
      summary.pendingPasswordLogin++;
      continue;
    }

    await userKeys.createUserDEK(user.id);
    summary.created++;
  }

  databaseLogger.info("User key migration pass finished", {
    operation: "dek_migration_boot",
    ...summary,
  });

  return summary;
}

// Password login is the only remaining way to recover a password-wrapped DEK.
export async function migratePasswordUserAtLogin(
  userId: string,
  password: string,
): Promise<boolean> {
  const userKeys = UserKeyManager.getInstance();

  if (userKeys.hasUserDEK(userId)) {
    if (hasAnyLegacyWrap(userId)) {
      await deleteLegacyWraps(userId);
    }
    return true;
  }

  const keys = legacySettingsKeys(userId);
  const kekSalt = parseJson<LegacyKekSalt>(
    getCurrentSettingValue(keys.kekSalt),
  );
  const encrypted = parseJson<LegacyEncryptedDEK>(
    getCurrentSettingValue(keys.passwordWrap),
  );
  if (!kekSalt?.salt || !encrypted?.data) return false;

  let kek: Buffer | null = null;
  try {
    kek = deriveLegacyKEK(password, kekSalt);
    const dek = decryptLegacyDEK(encrypted, kek);
    if (dek.length !== KEY_LENGTH) return false;

    await userKeys.persistDEK(userId, dek);
    await deleteLegacyWraps(userId);

    databaseLogger.info("Migrated password-wrapped user key at login", {
      operation: "dek_migration_login",
      userId,
    });
    return true;
  } catch {
    return false;
  } finally {
    kek?.fill(0);
  }
}

// Adopt a DEK recovered from a live session (the legacy JWT dataKeyWrap).
export async function adoptRecoveredDEK(
  userId: string,
  dek: Buffer,
): Promise<void> {
  const userKeys = UserKeyManager.getInstance();
  if (userKeys.hasUserDEK(userId)) return;

  await userKeys.persistDEK(userId, dek);
  await deleteLegacyWraps(userId);

  databaseLogger.info("Migrated user key from active session", {
    operation: "dek_migration_session",
    userId,
  });
}
