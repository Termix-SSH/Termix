import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rules: [] as Array<Record<string, unknown>>,
  grants: [] as unknown[],
  snapshots: [] as unknown[],
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentFolderAccessRepository: () => ({
    listApplicable: async () => state.rules,
  }),
  createCurrentRbacAccessRepository: () => ({
    upsertHostAccess: async (input: unknown) => {
      state.grants.push(input);
      return { id: state.grants.length, created: true };
    },
  }),
}));
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({
      snapshotForUser: async (...args: unknown[]) => {
        state.snapshots.push(["user", ...args]);
      },
      snapshotForRole: async (...args: unknown[]) => {
        state.snapshots.push(["role", ...args]);
      },
    }),
  },
}));

const { applyFolderAccessRules } =
  await import("../../utils/folder-access-inheritance.js");
const { folderAncestors } =
  await import("../../database/repositories/folder-access-repository.js");

describe("folder access inheritance", () => {
  beforeEach(() => {
    state.rules = [];
    state.grants = [];
    state.snapshots = [];
  });

  it("lists a folder and every ancestor, so subfolders inherit", () => {
    expect(folderAncestors("Prod / EU / Web")).toEqual([
      "Prod",
      "Prod / EU",
      "Prod / EU / Web",
    ]);
  });

  it("fans standing rules out to a host and snapshots secrets for each target", async () => {
    state.rules = [
      { id: 1, userId: "alice", roleId: null, grantedBy: "owner", permissionLevel: "connect", expiresAt: null },
      { id: 2, userId: null, roleId: 7, grantedBy: "owner", permissionLevel: "view", expiresAt: "2030-01-01" },
    ];
    const applied = await applyFolderAccessRules(42, "owner", "Prod");
    expect(applied).toBe(2);
    expect(state.grants).toEqual([
      expect.objectContaining({ hostId: 42, targetType: "user", targetUserId: "alice", permissionLevel: "connect" }),
      expect.objectContaining({ hostId: 42, targetType: "role", targetRoleId: 7, permissionLevel: "view", expiresAt: "2030-01-01" }),
    ]);
    expect(state.snapshots).toEqual([
      ["user", 1, 42, "alice", "owner"],
      ["role", 2, 42, 7, "owner"],
    ]);
  });

  it("does nothing for hosts outside any folder", async () => {
    state.rules = [{ id: 1, userId: "alice", roleId: null, grantedBy: "o", permissionLevel: "connect", expiresAt: null }];
    expect(await applyFolderAccessRules(1, "owner", null)).toBe(0);
    expect(state.grants).toEqual([]);
  });
});
