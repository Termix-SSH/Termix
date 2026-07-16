import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  grants: [] as Array<Record<string, unknown>>,
  roleMembers: new Map<number, string[]>(),
  executedSql: [] as string[],
  snapshots: [] as Array<[number, number, string, string]>,
  usersWithKeys: new Set<string>(),
  saves: [] as string[],
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.settings.get(key) ?? null,
    set: async (key: string, value: string) => {
      state.settings.set(key, value);
    },
  }),
  getCurrentRepositorySqlite: () => ({
    prepare: (sql: string) => ({
      all: (..._params: unknown[]) => {
        if (sql.includes("FROM host_access")) return state.grants;
        if (sql.includes("FROM user_roles")) {
          const roleId = _params[0] as number;
          return (state.roleMembers.get(roleId) ?? []).map((id) => ({
            user_id: id,
          }));
        }
        return [];
      },
    }),
    exec: (sql: string) => {
      state.executedSql.push(sql);
    },
  }),
}));

vi.mock("../../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({
      snapshotForUser: async (
        hostAccessId: number,
        hostId: number,
        targetUserId: string,
        ownerId: string,
      ) => {
        if (targetUserId === "broken") throw new Error("boom");
        state.snapshots.push([hostAccessId, hostId, targetUserId, ownerId]);
      },
    }),
  },
}));

vi.mock("../../../utils/data-crypto.js", () => ({
  DataCrypto: {
    canUserAccessData: (userId: string) => state.usersWithKeys.has(userId),
  },
}));

vi.mock("../../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    forceSave: async (reason: string) => {
      state.saves.push(reason);
    },
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { runSharedHostSecretsMigration } from "../../../utils/crypto-migration/shared-host-secrets-migration.js";

beforeEach(() => {
  state.settings.clear();
  state.grants = [];
  state.roleMembers.clear();
  state.executedSql = [];
  state.snapshots = [];
  state.usersWithKeys = new Set(["owner", "alice", "bob"]);
  state.saves = [];
});

describe("runSharedHostSecretsMigration", () => {
  it("re-snapshots direct and role grants, drops the legacy table and sets the flag", async () => {
    state.grants = [
      {
        hostAccessId: 1,
        hostId: 42,
        userId: "alice",
        roleId: null,
        ownerId: "owner",
      },
      {
        hostAccessId: 2,
        hostId: 42,
        userId: null,
        roleId: 9,
        ownerId: "owner",
      },
    ];
    state.roleMembers.set(9, ["bob", "owner"]);

    const result = await runSharedHostSecretsMigration();

    expect(result).toEqual({ snapshotted: 2, skipped: 0 });
    expect(state.snapshots).toEqual([
      [1, 42, "alice", "owner"],
      [2, 42, "bob", "owner"],
    ]);
    expect(
      state.executedSql.some((sql) =>
        sql.includes("DROP TABLE IF EXISTS shared_credentials"),
      ),
    ).toBe(true);
    expect(state.settings.get("shared_host_secrets_migrated_v1")).toBe("done");
    expect(state.saves).toContain("shared_host_secrets_migration");
  });

  it("skips grants with missing DEKs and failed snapshots without crashing", async () => {
    state.usersWithKeys = new Set(["owner", "alice", "broken"]);
    state.grants = [
      {
        hostAccessId: 1,
        hostId: 42,
        userId: "alice",
        roleId: null,
        ownerId: "owner",
      },
      {
        hostAccessId: 2,
        hostId: 42,
        userId: "no-key",
        roleId: null,
        ownerId: "owner",
      },
      {
        hostAccessId: 3,
        hostId: 42,
        userId: "broken",
        roleId: null,
        ownerId: "owner",
      },
    ];

    const result = await runSharedHostSecretsMigration();

    expect(result).toEqual({ snapshotted: 1, skipped: 2 });
    expect(state.settings.get("shared_host_secrets_migrated_v1")).toBe("done");
  });

  it("does nothing when the migration flag is already set", async () => {
    state.settings.set("shared_host_secrets_migrated_v1", "done");
    state.grants = [
      {
        hostAccessId: 1,
        hostId: 42,
        userId: "alice",
        roleId: null,
        ownerId: "owner",
      },
    ];

    const result = await runSharedHostSecretsMigration();

    expect(result).toBeNull();
    expect(state.snapshots).toEqual([]);
    expect(state.executedSql).toEqual([]);
  });
});
