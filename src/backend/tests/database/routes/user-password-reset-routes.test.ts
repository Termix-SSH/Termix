import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthManager } from "../../../utils/auth-manager.js";

const calls = vi.hoisted(() => ({
  userUpdates: [] as Array<[string, Record<string, unknown>]>,
  deletedFor: [] as string[],
  rotatedFor: [] as string[],
  legacyWrapsDeletedFor: [] as string[],
}));

function deletingRepo(label: string) {
  return () => ({
    deleteByUserId: async (userId: string) => {
      calls.deletedFor.push(`${label}:${userId}`);
      return 0;
    },
  });
}

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentUserRepository: () => ({
    update: async (userId: string, update: Record<string, unknown>) => {
      calls.userUpdates.push([userId, update]);
      return { id: userId };
    },
  }),
  createCurrentSettingsRepository: () => ({}),
  createCurrentSshCredentialUsageRepository: deletingRepo("usage"),
  createCurrentFileManagerBookmarkRepository: deletingRepo("bookmarks"),
  createCurrentRecentActivityRepository: deletingRepo("activity"),
  createCurrentDismissedAlertRepository: deletingRepo("alerts"),
  createCurrentSnippetRepository: deletingRepo("snippets"),
  createCurrentHostRepository: deletingRepo("hosts"),
  createCurrentCredentialRepository: deletingRepo("credentials"),
}));

vi.mock("../../../utils/user-keys.js", () => ({
  UserKeyManager: {
    getInstance: () => ({
      rotateUserDEK: async (userId: string) => {
        calls.rotatedFor.push(userId);
        return Buffer.alloc(32);
      },
    }),
  },
}));

vi.mock("../../../utils/crypto-migration/dek-migration.js", () => ({
  deleteLegacyWraps: async (userId: string) => {
    calls.legacyWrapsDeletedFor.push(userId);
  },
}));

import { resetUserPassword } from "../../../database/routes/user-password-reset-routes.js";

function fakeAuthManager(unlocked: boolean): AuthManager {
  return {
    isUserUnlocked: () => unlocked,
    logoutUser: vi.fn(async () => {}),
  } as unknown as AuthManager;
}

beforeEach(() => {
  calls.userUpdates = [];
  calls.deletedFor = [];
  calls.rotatedFor = [];
  calls.legacyWrapsDeletedFor = [];
});

describe("resetUserPassword", () => {
  it("preserves data for users with a server-wrapped key", async () => {
    const outcome = await resetUserPassword(fakeAuthManager(true), {
      userId: "user-1",
      username: "alice",
      newPassword: "new-password",
      confirmDataWipe: false,
    });

    expect(outcome).toEqual({ status: "reset", dataWiped: false });
    expect(calls.userUpdates).toHaveLength(1);
    expect(calls.userUpdates[0][1]).toHaveProperty("passwordHash");
    expect(calls.deletedFor).toEqual([]);
    expect(calls.rotatedFor).toEqual([]);
  });

  it("requires explicit consent before wiping an unmigrated user", async () => {
    const outcome = await resetUserPassword(fakeAuthManager(false), {
      userId: "user-1",
      username: "alice",
      newPassword: "new-password",
      confirmDataWipe: false,
    });

    expect(outcome).toEqual({ status: "wipe_confirmation_required" });
    expect(calls.userUpdates).toEqual([]);
    expect(calls.deletedFor).toEqual([]);
  });

  it("wipes data and rotates the key when consent is given", async () => {
    const outcome = await resetUserPassword(fakeAuthManager(false), {
      userId: "user-1",
      username: "alice",
      newPassword: "new-password",
      confirmDataWipe: true,
    });

    expect(outcome).toEqual({ status: "reset", dataWiped: true });
    expect(calls.deletedFor).toEqual([
      "usage:user-1",
      "bookmarks:user-1",
      "activity:user-1",
      "alerts:user-1",
      "snippets:user-1",
      "hosts:user-1",
      "credentials:user-1",
    ]);
    expect(calls.rotatedFor).toEqual(["user-1"]);
    expect(calls.legacyWrapsDeletedFor).toEqual(["user-1"]);
    expect(
      calls.userUpdates.some(([, update]) => update.totpEnabled === false),
    ).toBe(true);
  });
});
