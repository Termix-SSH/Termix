import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsStore = new Map<string, string>();
let userRows: Array<{ id: string }> = [];

vi.mock("../../../database/repositories/factory.js", () => ({
  getCurrentSettingValue: (key: string) => settingsStore.get(key) ?? null,
  createCurrentSettingsRepository: () => ({
    upsert: async (key: string, value: string) => {
      settingsStore.set(key, value);
    },
    set: async (key: string, value: string) => {
      settingsStore.set(key, value);
    },
    delete: async (key: string) => {
      settingsStore.delete(key);
    },
  }),
  createCurrentUserRepository: () => ({
    listAll: async () => userRows,
  }),
}));

const masterKey = crypto.randomBytes(32);

vi.mock("../../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getEncryptionKey: async () => masterKey,
    }),
  },
}));

import { UserKeyManager } from "../../../utils/user-keys.js";
import {
  adoptRecoveredDEK,
  legacySettingsKeys,
  migratePasswordUserAtLogin,
  runBootDekMigration,
} from "../../../utils/crypto-migration/dek-migration.js";

const manager = UserKeyManager.getInstance();

// Fixture helpers replicating the deleted legacy wrap formats exactly.
function legacyEncryptDEK(dek: Buffer, kek: Buffer): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  return JSON.stringify({
    data: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    algorithm: "aes-256-gcm",
    createdAt: new Date().toISOString(),
  });
}

function oidcSystemKey(userId: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      masterKey,
      Buffer.from(userId, "utf8"),
      Buffer.from("termix:oidc-user-kek", "utf8"),
      32,
    ),
  );
}

function webauthnSystemKey(userId: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      masterKey,
      Buffer.from(userId, "utf8"),
      Buffer.from("termix:webauthn-user-kek", "utf8"),
      32,
    ),
  );
}

function legacyDefaultOidcKey(userId: string): Buffer {
  return crypto.pbkdf2Sync(
    "termix-oidc-system-secret-default",
    Buffer.from(userId, "utf8"),
    100000,
    32,
    "sha256",
  );
}

function passwordKek(password: string, saltHex: string): Buffer {
  return crypto.pbkdf2Sync(
    password,
    Buffer.from(saltHex, "hex"),
    100000,
    32,
    "sha256",
  );
}

function seedPasswordUser(userId: string, password: string): Buffer {
  const dek = crypto.randomBytes(32);
  const saltHex = crypto.randomBytes(32).toString("hex");
  const keys = legacySettingsKeys(userId);
  settingsStore.set(
    keys.kekSalt,
    JSON.stringify({
      salt: saltHex,
      iterations: 100000,
      algorithm: "pbkdf2-sha256",
      createdAt: new Date().toISOString(),
    }),
  );
  settingsStore.set(
    keys.passwordWrap,
    legacyEncryptDEK(dek, passwordKek(password, saltHex)),
  );
  return dek;
}

beforeEach(async () => {
  settingsStore.clear();
  userRows = [];
  await manager.initialize(masterKey);
  manager.clearCache();
});

describe("runBootDekMigration", () => {
  it("migrates a pure-OIDC user whose primary slot is system-wrapped", async () => {
    const dek = crypto.randomBytes(32);
    const keys = legacySettingsKeys("oidc-user");
    settingsStore.set(
      keys.passwordWrap,
      legacyEncryptDEK(dek, oidcSystemKey("oidc-user")),
    );
    userRows = [{ id: "oidc-user" }];

    const summary = await runBootDekMigration();

    expect(summary.migrated).toBe(1);
    expect(manager.getUserDEK("oidc-user").equals(dek)).toBe(true);
  });

  it("migrates via the dedicated oidc wrap slot for dual-auth users", async () => {
    const dek = seedPasswordUser("dual-user", "hunter2");
    const keys = legacySettingsKeys("dual-user");
    settingsStore.set(
      keys.oidcWrap,
      legacyEncryptDEK(dek, oidcSystemKey("dual-user")),
    );
    userRows = [{ id: "dual-user" }];

    const summary = await runBootDekMigration();

    expect(summary.migrated).toBe(1);
    expect(manager.getUserDEK("dual-user").equals(dek)).toBe(true);
  });

  it("migrates webauthn-wrapped users", async () => {
    const dek = seedPasswordUser("wa-user", "hunter2");
    const keys = legacySettingsKeys("wa-user");
    settingsStore.set(
      keys.webauthnWrap,
      legacyEncryptDEK(dek, webauthnSystemKey("wa-user")),
    );
    userRows = [{ id: "wa-user" }];

    const summary = await runBootDekMigration();

    expect(summary.migrated).toBe(1);
    expect(manager.getUserDEK("wa-user").equals(dek)).toBe(true);
  });

  it("migrates wraps made with the legacy hardcoded default secret", async () => {
    const dek = crypto.randomBytes(32);
    const keys = legacySettingsKeys("legacy-user");
    settingsStore.set(
      keys.oidcWrap,
      legacyEncryptDEK(dek, legacyDefaultOidcKey("legacy-user")),
    );
    userRows = [{ id: "legacy-user" }];

    const summary = await runBootDekMigration();

    expect(summary.migrated).toBe(1);
    expect(manager.getUserDEK("legacy-user").equals(dek)).toBe(true);
  });

  it("leaves password-only users pending without touching their rows", async () => {
    seedPasswordUser("pw-user", "hunter2");
    userRows = [{ id: "pw-user" }];
    const keys = legacySettingsKeys("pw-user");
    const before = {
      salt: settingsStore.get(keys.kekSalt),
      wrap: settingsStore.get(keys.passwordWrap),
    };

    const summary = await runBootDekMigration({ cleanupLegacy: true });

    expect(summary.pendingPasswordLogin).toBe(1);
    expect(manager.hasUserDEK("pw-user")).toBe(false);
    expect(settingsStore.get(keys.kekSalt)).toBe(before.salt);
    expect(settingsStore.get(keys.passwordWrap)).toBe(before.wrap);
  });

  it("creates a fresh DEK for users with no key material at all", async () => {
    userRows = [{ id: "new-user" }];

    const summary = await runBootDekMigration();

    expect(summary.created).toBe(1);
    expect(manager.hasUserDEK("new-user")).toBe(true);
  });

  it("is idempotent across repeated runs", async () => {
    const dek = crypto.randomBytes(32);
    const keys = legacySettingsKeys("oidc-user");
    settingsStore.set(
      keys.passwordWrap,
      legacyEncryptDEK(dek, oidcSystemKey("oidc-user")),
    );
    userRows = [{ id: "oidc-user" }];

    await runBootDekMigration();
    const second = await runBootDekMigration();

    expect(second.alreadyMigrated).toBe(1);
    expect(second.migrated).toBe(0);
    manager.clearCache();
    expect(manager.getUserDEK("oidc-user").equals(dek)).toBe(true);
  });

  it("cleans leftover legacy rows when v3 already exists (crash resume)", async () => {
    const dek = crypto.randomBytes(32);
    await manager.persistDEK("resume-user", dek);
    const keys = legacySettingsKeys("resume-user");
    settingsStore.set(
      keys.oidcWrap,
      legacyEncryptDEK(dek, oidcSystemKey("resume-user")),
    );
    userRows = [{ id: "resume-user" }];

    const summary = await runBootDekMigration({ cleanupLegacy: true });

    expect(summary.alreadyMigrated).toBe(1);
    expect(settingsStore.has(keys.oidcWrap)).toBe(false);
    expect(manager.getUserDEK("resume-user").equals(dek)).toBe(true);
  });

  it("removes legacy wraps after migration when cleanup is enabled", async () => {
    const dek = seedPasswordUser("dual-user", "hunter2");
    const keys = legacySettingsKeys("dual-user");
    settingsStore.set(
      keys.oidcWrap,
      legacyEncryptDEK(dek, oidcSystemKey("dual-user")),
    );
    userRows = [{ id: "dual-user" }];

    await runBootDekMigration({ cleanupLegacy: true });

    expect(settingsStore.has(keys.oidcWrap)).toBe(false);
    expect(settingsStore.has(keys.passwordWrap)).toBe(false);
    expect(settingsStore.has(keys.kekSalt)).toBe(false);
    expect(manager.getUserDEK("dual-user").equals(dek)).toBe(true);
  });
});

describe("migratePasswordUserAtLogin", () => {
  it("migrates with the correct password and cleans legacy rows", async () => {
    const dek = seedPasswordUser("pw-user", "hunter2");
    const keys = legacySettingsKeys("pw-user");

    const migrated = await migratePasswordUserAtLogin("pw-user", "hunter2");

    expect(migrated).toBe(true);
    expect(manager.getUserDEK("pw-user").equals(dek)).toBe(true);
    expect(settingsStore.has(keys.passwordWrap)).toBe(false);
    expect(settingsStore.has(keys.kekSalt)).toBe(false);
  });

  it("fails with a wrong password and leaves rows intact", async () => {
    seedPasswordUser("pw-user", "hunter2");
    const keys = legacySettingsKeys("pw-user");

    const migrated = await migratePasswordUserAtLogin("pw-user", "wrong");

    expect(migrated).toBe(false);
    expect(manager.hasUserDEK("pw-user")).toBe(false);
    expect(settingsStore.has(keys.passwordWrap)).toBe(true);
    expect(settingsStore.has(keys.kekSalt)).toBe(true);
  });

  it("returns true and cleans up when the user is already migrated", async () => {
    const dek = seedPasswordUser("pw-user", "hunter2");
    await manager.persistDEK("pw-user", dek);

    const migrated = await migratePasswordUserAtLogin("pw-user", "ignored");

    expect(migrated).toBe(true);
    expect(settingsStore.has(legacySettingsKeys("pw-user").passwordWrap)).toBe(
      false,
    );
  });
});

describe("adoptRecoveredDEK", () => {
  it("persists a session-recovered DEK and cleans legacy rows", async () => {
    seedPasswordUser("pw-user", "hunter2");
    const dek = crypto.randomBytes(32);

    await adoptRecoveredDEK("pw-user", dek);

    expect(manager.getUserDEK("pw-user").equals(dek)).toBe(true);
    expect(settingsStore.has(legacySettingsKeys("pw-user").passwordWrap)).toBe(
      false,
    );
  });

  it("does not overwrite an existing v3 wrap", async () => {
    const existing = crypto.randomBytes(32);
    await manager.persistDEK("pw-user", existing);

    await adoptRecoveredDEK("pw-user", crypto.randomBytes(32));

    manager.clearCache();
    expect(manager.getUserDEK("pw-user").equals(existing)).toBe(true);
  });
});
