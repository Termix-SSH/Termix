import { describe, it, expect, vi, beforeEach } from "vitest";

// permission-manager imports the side-effectful DB barrel and the logger at the
// top level. Stub both so importing the module does not spin up the real
// database / encryption stack. We then drive hasPermission via a spied
// getUserPermissions so we test the wildcard-matching logic in isolation.
vi.mock("../database/db/index.js", () => ({ db: {} }));
vi.mock("./logger.js", () => ({
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const { PermissionManager } = await import("./permission-manager.js");

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
