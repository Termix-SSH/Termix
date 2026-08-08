import { beforeEach, describe, expect, it, vi } from "vitest";

const findHostIdBySyncId = vi.fn();
const canAccessHost = vi.fn();
const findHostOwnerId = vi.fn();
const findHostById = vi.fn();

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findHostIdBySyncId,
    findHostOwnerId,
    findHostById,
  }),
  createCurrentVaultProfileRepository: () => ({}),
  createCurrentUserRepository: () => ({ findById: vi.fn() }),
}));

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: { getInstance: () => ({ canAccessHost }) },
}));

vi.mock("../../utils/audit-logger.js", () => ({ logAudit: vi.fn() }));
vi.mock("../../utils/shared-host-auth-resolver.js", () => ({
  resolveRecipientSharedHostAuthentication: vi.fn(),
}));

/**
 * A numeric host id belongs to whichever database produced it. Resolving the
 * desktop app's id against a sync server's table lands on whatever host owns
 * that number there — a different machine, with its own address, credentials
 * and host key. `sync_id` is the same string on both sides.
 */
describe("resolveHostBySyncId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canAccessHost.mockResolvedValue({ hasAccess: true });
    findHostOwnerId.mockResolvedValue("user-1");
  });

  it("resolves the row carrying that sync id, whatever its local id is", async () => {
    // The client's row is id 3 locally; here the same host is id 41.
    findHostIdBySyncId.mockResolvedValue(41);
    findHostById.mockResolvedValue({
      id: 41,
      ip: "10.0.0.7",
      userId: "user-1",
    });

    const { resolveHostBySyncId } =
      await import("../../hosts/host-resolver.js");
    const host = await resolveHostBySyncId("sync-abc", "user-1");

    expect(findHostIdBySyncId).toHaveBeenCalledWith("sync-abc");
    expect(findHostById).toHaveBeenCalledWith(41, "user-1");
    expect(host?.ip).toBe("10.0.0.7");
  });

  it("returns null for a sync id this server does not have", async () => {
    // Falling back to the numeric id here is what picked the wrong machine.
    findHostIdBySyncId.mockResolvedValue(null);

    const { resolveHostBySyncId } =
      await import("../../hosts/host-resolver.js");

    await expect(resolveHostBySyncId("sync-unknown", "user-1")).resolves.toBe(
      null,
    );
    expect(findHostById).not.toHaveBeenCalled();
  });

  it("still refuses a host the caller may not reach", async () => {
    // The lookup is unscoped so shared hosts resolve; permission is decided by
    // the id-based path, which must not be bypassed.
    findHostIdBySyncId.mockResolvedValue(41);
    canAccessHost.mockResolvedValue({ hasAccess: false });

    const { resolveHostBySyncId } =
      await import("../../hosts/host-resolver.js");

    await expect(resolveHostBySyncId("sync-abc", "intruder")).resolves.toBe(
      null,
    );
    expect(findHostById).not.toHaveBeenCalled();
  });
});
