import { beforeEach, describe, expect, it, vi } from "vitest";

interface Grant {
  id: number;
  userId: string;
  grantedBy: string;
  permissionLevel: string;
}

const state = vi.hoisted(() => ({
  hostGrants: [] as Grant[],
  credentialGrants: [] as Grant[],
}));

const canManage = (grants: Grant[], userId: string) =>
  userId === "owner" ||
  grants.some((g) => g.userId === userId && g.permissionLevel === "manage");

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware: () => vi.fn(),
      createDataAccessMiddleware: () => vi.fn(),
    }),
  },
}));

vi.mock("../../../utils/permission-manager.js", () => ({
  SHARE_PERMISSION_LEVELS: ["connect", "view", "edit", "manage"],
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async (userId: string) => ({
        hasAccess: canManage(state.hostGrants, userId),
        isOwner: userId === "owner",
      }),
      requirePermission: () => vi.fn(),
      requireAdmin: () => vi.fn(),
      invalidateUserPermissionCache: vi.fn(),
    }),
  },
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findHostOwnerId: async () => "owner",
  }),
  createCurrentRbacAccessRepository: () => ({
    listHostAccess: async () => [...state.hostGrants],
    revokeHostAccess: async (id: number) => {
      state.hostGrants = state.hostGrants.filter((g) => g.id !== id);
    },
    listHostIdsGrantedBy: async (userId: string) =>
      state.hostGrants.some((g) => g.grantedBy === userId) ? [1] : [],
  }),
  createCurrentCredentialRepository: () => ({
    findById: async () => ({ id: 5, userId: "owner" }),
  }),
  createCurrentRoleRepository: () => ({ listUserRoleIds: async () => [] }),
  createCurrentCredentialAccessRepository: () => ({
    listForCredential: async () => [...state.credentialGrants],
    findActiveGrant: async (_id: number, userId: string) =>
      state.credentialGrants.find((g) => g.userId === userId) ?? null,
    revoke: async (id: number) => {
      state.credentialGrants = state.credentialGrants.filter(
        (g) => g.id !== id,
      );
    },
    listCredentialIdsGrantedBy: async () => [],
  }),
}));

const { pruneHostGrants, pruneCredentialGrants } =
  await import("../../../database/routes/rbac.js");

const chain = (): Grant[] => [
  { id: 2, userId: "bob", grantedBy: "alice", permissionLevel: "manage" },
  { id: 3, userId: "carol", grantedBy: "bob", permissionLevel: "view" },
  { id: 4, userId: "dave", grantedBy: "owner", permissionLevel: "view" },
];

describe("share pruning", () => {
  beforeEach(() => {
    state.hostGrants = chain();
    state.credentialGrants = chain();
  });

  it("drops host shares passed on by someone who lost manage", async () => {
    expect(await pruneHostGrants(1)).toBe(2);
    expect(state.hostGrants.map((g) => g.userId)).toEqual(["dave"]);
  });

  it("keeps shares while the granter can still manage", async () => {
    state.hostGrants.push({
      id: 1,
      userId: "alice",
      grantedBy: "owner",
      permissionLevel: "manage",
    });
    expect(await pruneHostGrants(1)).toBe(0);
    expect(state.hostGrants).toHaveLength(4);
  });

  it("drops credential shares the same way", async () => {
    expect(await pruneCredentialGrants(5)).toBe(2);
    expect(state.credentialGrants.map((g) => g.userId)).toEqual(["dave"]);
  });
});
