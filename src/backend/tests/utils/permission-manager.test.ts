import { describe, it, expect, vi, beforeEach } from "vitest";

// permission-manager imports the side-effectful DB barrel and the logger at the
// top level. Stub both so importing the module does not spin up the real
// database / encryption stack. We then drive hasPermission via a spied
// getUserPermissions so we test the wildcard-matching logic in isolation.
vi.mock("../../database/db/index.js", () => ({ db: {} }));
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const accessState = vi.hoisted(() => ({
  ownerId: "owner" as string,
  grant: null as {
    id: number;
    permissionLevel: string;
    expiresAt: string | null;
  } | null,
  touched: [] as number[],
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    isHostOwnedByUser: async (_hostId: number, userId: string) =>
      userId === accessState.ownerId,
    findHostOwnerId: async () => accessState.ownerId,
  }),
  createCurrentRbacAccessRepository: () => ({
    findActiveHostAccess: async () => accessState.grant,
    touchHostAccess: async (id: number) => {
      accessState.touched.push(id);
    },
    deleteExpiredHostAccess: async () => 0,
  }),
  createCurrentRoleRepository: () => ({
    listUserRoleIds: async () => [],
    listUserRolePermissions: async () => [],
    userHasAnyRoleName: async () => false,
  }),
  createCurrentUserRepository: () => ({
    findById: async () => null,
  }),
}));

const { PermissionManager } = await import("../../utils/permission-manager.js");

type PermissionManagerInstance = ReturnType<
  typeof PermissionManager.getInstance
>;

describe("PermissionManager.hasPermission wildcard matching", () => {
  let manager: PermissionManagerInstance;

  function withPermissions(permissions: string[]) {
    vi.spyOn(manager, "getUserPermissions").mockResolvedValue(permissions);
  }

  beforeEach(() => {
    manager = PermissionManager.getInstance();
    vi.restoreAllMocks();
  });

  it("grants everything for the global wildcard '*'", async () => {
    withPermissions(["*"]);
    expect(await manager.hasPermission("u1", "hosts.read")).toBe(true);
    expect(await manager.hasPermission("u1", "anything.at.all")).toBe(true);
  });

  it("grants an exact permission match", async () => {
    withPermissions(["hosts.read", "hosts.write"]);
    expect(await manager.hasPermission("u1", "hosts.read")).toBe(true);
  });

  it("grants via a prefix wildcard", async () => {
    withPermissions(["hosts.*"]);
    expect(await manager.hasPermission("u1", "hosts.read")).toBe(true);
    expect(await manager.hasPermission("u1", "hosts.write")).toBe(true);
  });

  it("grants via a deep prefix wildcard", async () => {
    withPermissions(["admin.users.*"]);
    expect(await manager.hasPermission("u1", "admin.users.delete")).toBe(true);
  });

  it("denies when no exact or wildcard permission matches", async () => {
    withPermissions(["hosts.read"]);
    expect(await manager.hasPermission("u1", "hosts.write")).toBe(false);
    expect(await manager.hasPermission("u1", "credentials.read")).toBe(false);
  });

  it("denies when the user has no permissions", async () => {
    withPermissions([]);
    expect(await manager.hasPermission("u1", "hosts.read")).toBe(false);
  });

  it("does not let a narrower wildcard grant a sibling branch", async () => {
    withPermissions(["hosts.read.*"]);
    expect(await manager.hasPermission("u1", "hosts.write")).toBe(false);
  });
});

describe("PermissionManager.canAccessHost level hierarchy", () => {
  const manager = PermissionManager.getInstance();
  const actions = ["connect", "view", "edit", "manage"] as const;
  const levels = ["connect", "view", "edit", "manage"] as const;
  const rank = { connect: 1, view: 2, edit: 3, manage: 4 } as const;

  beforeEach(() => {
    vi.restoreAllMocks();
    accessState.ownerId = "owner";
    accessState.grant = null;
    accessState.touched = [];
  });

  it("grants the owner every action including delete", async () => {
    for (const action of [...actions, "delete"] as const) {
      const info = await manager.canAccessHost("owner", 42, action);
      expect(info).toMatchObject({ hasAccess: true, isOwner: true });
    }
  });

  it("denies everything without a grant", async () => {
    const info = await manager.canAccessHost("stranger", 42, "connect");
    expect(info).toMatchObject({ hasAccess: false, isShared: false });
  });

  it("enforces the connect < view < edit < manage hierarchy", async () => {
    for (const level of levels) {
      accessState.grant = { id: 5, permissionLevel: level, expiresAt: null };
      for (const action of actions) {
        const info = await manager.canAccessHost("recipient", 42, action);
        expect(info.hasAccess).toBe(rank[level] >= rank[action]);
        expect(info.permissionLevel).toBe(level);
        expect(info.isShared).toBe(true);
      }
    }
  });

  it("never grants delete to a shared recipient", async () => {
    accessState.grant = { id: 5, permissionLevel: "manage", expiresAt: null };
    const info = await manager.canAccessHost("recipient", 42, "delete");
    expect(info.hasAccess).toBe(false);
  });

  it("normalizes the legacy 'view' string mapping and unknown levels to connect", async () => {
    accessState.grant = { id: 5, permissionLevel: "bogus", expiresAt: null };
    const connect = await manager.canAccessHost("recipient", 42, "connect");
    expect(connect.hasAccess).toBe(true);
    expect(connect.permissionLevel).toBe("connect");

    const view = await manager.canAccessHost("recipient", 42, "view");
    expect(view.hasAccess).toBe(false);
  });

  it("only touches the grant timestamp on connect", async () => {
    accessState.grant = { id: 5, permissionLevel: "manage", expiresAt: null };
    await manager.canAccessHost("recipient", 42, "manage");
    expect(accessState.touched).toEqual([]);
    await manager.canAccessHost("recipient", 42, "connect");
    expect(accessState.touched).toEqual([5]);
  });
});
