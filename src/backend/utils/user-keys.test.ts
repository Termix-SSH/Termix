import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsStore = new Map<string, string>();

vi.mock("../database/repositories/factory.js", () => ({
  getCurrentSettingValue: (key: string) => settingsStore.get(key) ?? null,
  createCurrentSettingsRepository: () => ({
    upsert: async (key: string, value: string) => {
      settingsStore.set(key, value);
    },
    delete: async (key: string) => {
      settingsStore.delete(key);
    },
  }),
}));

import {
  UserKeyManager,
  UserKeyUnavailableError,
  userDekSettingsKey,
} from "./user-keys.js";

const masterKey = crypto.randomBytes(32);
const manager = UserKeyManager.getInstance();

function storedWrap(userId: string): Record<string, unknown> {
  return JSON.parse(settingsStore.get(userDekSettingsKey(userId))!);
}

function putWrap(userId: string, wrap: Record<string, unknown>): void {
  settingsStore.set(userDekSettingsKey(userId), JSON.stringify(wrap));
}

beforeEach(async () => {
  settingsStore.clear();
  await manager.initialize(masterKey);
});

describe("UserKeyManager", () => {
  it("creates and round-trips a DEK", async () => {
    const dek = await manager.createUserDEK("user-1");

    expect(dek).toHaveLength(32);
    expect(manager.hasUserDEK("user-1")).toBe(true);

    manager.clearCache();
    expect(manager.getUserDEK("user-1").equals(dek)).toBe(true);
  });

  it("refuses to create a second DEK for the same user", async () => {
    await manager.createUserDEK("user-1");
    await expect(manager.createUserDEK("user-1")).rejects.toThrow(
      /already has a data encryption key/,
    );
  });

  it("throws missing for a user with no wrap and no legacy rows", () => {
    expect(() => manager.getUserDEK("ghost")).toThrow(UserKeyUnavailableError);
    try {
      manager.getUserDEK("ghost");
    } catch (error) {
      expect((error as UserKeyUnavailableError).reason).toBe("missing");
    }
    expect(manager.tryGetUserDEK("ghost")).toBeNull();
  });

  it("throws pending_migration when only legacy wrap rows exist", () => {
    settingsStore.set("user_encrypted_dek_legacy-user", "{}");
    try {
      manager.getUserDEK("legacy-user");
      expect.unreachable();
    } catch (error) {
      expect((error as UserKeyUnavailableError).reason).toBe(
        "pending_migration",
      );
    }

    settingsStore.clear();
    settingsStore.set("user_kek_salt_legacy-user", "{}");
    try {
      manager.getUserDEK("legacy-user");
      expect.unreachable();
    } catch (error) {
      expect((error as UserKeyUnavailableError).reason).toBe(
        "pending_migration",
      );
    }
  });

  it("fails to unwrap with a different master key", async () => {
    const dek = await manager.createUserDEK("user-1");

    await manager.initialize(crypto.randomBytes(32));
    expect(() => manager.getUserDEK("user-1")).toThrow();

    await manager.initialize(masterKey);
    expect(manager.getUserDEK("user-1").equals(dek)).toBe(true);
  });

  it("rejects tampered iv, ciphertext and tag", async () => {
    await manager.createUserDEK("user-1");

    for (const field of ["iv", "ct", "tag"] as const) {
      const wrap = storedWrap("user-1");
      const bytes = Buffer.from(wrap[field] as string, "base64");
      bytes[0] ^= 0xff;
      putWrap("user-1", { ...wrap, [field]: bytes.toString("base64") });
      manager.clearCache();
      expect(() => manager.getUserDEK("user-1")).toThrow();
    }
  });

  it("rejects a wrap moved to another user (AAD/info binding)", async () => {
    await manager.createUserDEK("user-a");

    putWrap("user-b", storedWrap("user-a"));
    manager.clearCache();
    expect(() => manager.getUserDEK("user-b")).toThrow();
  });

  it("rejects unknown wrap versions and algorithms", async () => {
    await manager.createUserDEK("user-1");

    const wrap = storedWrap("user-1");
    putWrap("user-1", { ...wrap, v: 99 });
    manager.clearCache();
    expect(() => manager.getUserDEK("user-1")).toThrow(/Unsupported key wrap/);

    putWrap("user-1", { ...wrap, alg: "aes-128-gcm" });
    manager.clearCache();
    expect(() => manager.getUserDEK("user-1")).toThrow(/Unsupported key wrap/);
  });

  it("persistDEK overwrites and rotateUserDEK replaces the key", async () => {
    const original = await manager.createUserDEK("user-1");
    const rotated = await manager.rotateUserDEK("user-1");

    expect(rotated.equals(original)).toBe(false);
    manager.clearCache();
    expect(manager.getUserDEK("user-1").equals(rotated)).toBe(true);
  });

  it("deleteUserDEK removes the wrap and cached key", async () => {
    await manager.createUserDEK("user-1");
    await manager.deleteUserDEK("user-1");

    expect(manager.hasUserDEK("user-1")).toBe(false);
    expect(manager.tryGetUserDEK("user-1")).toBeNull();
  });

  it("serves cached DEKs without re-reading settings", async () => {
    const dek = await manager.createUserDEK("user-1");

    settingsStore.delete(userDekSettingsKey("user-1"));
    expect(manager.getUserDEK("user-1").equals(dek)).toBe(true);

    manager.clearCache();
    expect(() => manager.getUserDEK("user-1")).toThrow(UserKeyUnavailableError);
  });
});
