import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
 * that number there, a different machine, with its own address, credentials
 * and host key. `sync_id` is the same string on both sides.
 */
describe("resolveHostBySyncId", () => {
  let resolveHostBySyncId: typeof import("../../hosts/host-resolver.js").resolveHostBySyncId;

  // A cold import of the resolver can take longer than one test's timeout
  // when the whole suite runs.
  beforeAll(async () => {
    ({ resolveHostBySyncId } = await import("../../hosts/host-resolver.js"));
  }, 30_000);

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
    const host = await resolveHostBySyncId("sync-abc", "user-1");

    expect(findHostIdBySyncId).toHaveBeenCalledWith("sync-abc");
    expect(findHostById).toHaveBeenCalledWith(41, "user-1");
    expect(host?.ip).toBe("10.0.0.7");
  });

  it("returns null for a sync id this server does not have", async () => {
    // Falling back to the numeric id here is what picked the wrong machine.
    findHostIdBySyncId.mockResolvedValue(null);

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

    await expect(resolveHostBySyncId("sync-abc", "intruder")).resolves.toBe(
      null,
    );
    expect(findHostById).not.toHaveBeenCalled();
  });
});

describe("shared host with no login for the recipient", () => {
  let resolveHostBySyncId: typeof import("../../hosts/host-resolver.js").resolveHostBySyncId;
  let resolveRecipientSharedHostAuthentication: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    ({ resolveHostBySyncId } = await import("../../hosts/host-resolver.js"));
    ({ resolveRecipientSharedHostAuthentication } =
      (await import("../../utils/shared-host-auth-resolver.js")) as unknown as {
        resolveRecipientSharedHostAuthentication: ReturnType<typeof vi.fn>;
      });
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    canAccessHost.mockResolvedValue({ hasAccess: true, isShared: true });
    findHostOwnerId.mockResolvedValue("owner");
    findHostIdBySyncId.mockResolvedValue(41);
    findHostById.mockResolvedValue({
      id: 41,
      ip: "10.0.0.7",
      userId: "owner",
      authType: "password",
      password: "owner-secret",
    });
    resolveRecipientSharedHostAuthentication.mockResolvedValue({
      source: "required",
    });
  });

  it("returns null by default", async () => {
    await expect(resolveHostBySyncId("sync-abc", "user-1")).resolves.toBe(null);
  });

  it("returns the host without a login when asked", async () => {
    const host = (await resolveHostBySyncId("sync-abc", "user-1", {
      allowMissingLogin: true,
    })) as unknown as Record<string, unknown>;

    expect(host.ip).toBe("10.0.0.7");
    expect(host.loginRequired).toBe(true);
    expect(host.authType).toBe("none");
    expect(host.password).toBeNull();
  });

  it("still refuses a host the caller may not reach", async () => {
    canAccessHost.mockResolvedValue({ hasAccess: false });
    await expect(
      resolveHostBySyncId("sync-abc", "intruder", { allowMissingLogin: true }),
    ).resolves.toBe(null);
  });
});
