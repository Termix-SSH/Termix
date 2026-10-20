import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listChanges: vi.fn(),
  findHostIdBySyncId: vi.fn(),
  canAccessHost: vi.fn(),
  findById: vi.fn(),
  getLink: vi.fn(),
  generateJWTToken: vi.fn(),
  revokeSession: vi.fn(),
}));

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware: () => vi.fn(),
      generateJWTToken: mocks.generateJWTToken,
      revokeSession: mocks.revokeSession,
    }),
  },
}));
vi.mock("../../utils/logger.js", () => ({
  syncLogger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../utils/app-version.js", () => ({
  getLocalVersion: () => "26.10.3",
}));
vi.mock("../../notify/core-notify.js", () => ({ sendCoreAlert: vi.fn() }));
vi.mock("../../plugins/index.js", () => ({ getPluginRuntime: vi.fn() }));
vi.mock("../../plugins/sync-registry.js", () => ({
  getEntity: vi.fn(),
  listEntities: () => [{ type: "hosts", owner: "core", order: 10 }],
  onEntitiesChanged: vi.fn(),
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostRepository: () => ({ findById: mocks.findById }),
  createCurrentHostResolutionRepository: () => ({
    findHostIdBySyncId: mocks.findHostIdBySyncId,
  }),
  createCurrentPluginPermissionGrantRepository: vi.fn(),
  createCurrentPluginRepository: vi.fn(),
  createCurrentRepositoryContext: vi.fn(),
  createCurrentSessionRepository: vi.fn(),
  createCurrentSettingsRepository: vi.fn(),
  createCurrentUserRepository: vi.fn(),
}));
vi.mock("../../database/routes/branding-settings.js", () => ({
  resolveBrandingSettings: async () => ({ appName: "Termix" }),
}));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({ canAccessHost: mocks.canAccessHost }),
  },
}));
vi.mock("../../sync/entities.js", () => ({
  registerCoreSyncEntities: vi.fn(),
}));
vi.mock("../../sync/store.js", () => ({}));
vi.mock("../../sync/wire.js", () => ({}));
vi.mock("../../sync/records.js", () => ({
  listChanges: mocks.listChanges,
  recordKey: (type: string, id: string) => `${type}\u0000${id}`,
}));
vi.mock("../../sync/server/write-listeners.js", () => ({
  onLocalWrite: vi.fn(),
}));
vi.mock("../../sync/accounts.js", () => ({
  createAccount: vi.fn(),
  getActiveUserId: vi.fn(),
  listAccounts: vi.fn(),
  removeAccount: vi.fn(),
  setActiveUserId: vi.fn(),
}));
vi.mock("../../sync/server/feed.js", () => ({
  withUserLock: (_userId: string, fn: () => unknown) => fn(),
  reconcileUser: async () => ({ wire: new Map() }),
  addListener: vi.fn(),
}));
vi.mock("../../sync/server/push.js", () => ({}));
vi.mock("../../sync/client/link-store.js", () => ({
  getLink: mocks.getLink,
  listLinks: vi.fn(),
  createLink: vi.fn(),
  updateLink: vi.fn(),
  deleteLink: vi.fn(),
}));
vi.mock("../../sync/client/http.js", () => ({
  normalizeServerUrl: vi.fn(),
  RemoteError: class RemoteError extends Error {},
  remoteFetch: vi.fn(),
  remoteJson: vi.fn(),
}));
vi.mock("../../sync/client/electron-proxy.js", () => ({
  applyElectronProxyConfig: vi.fn(),
}));
vi.mock("../../sync/client/plugins.js", () => ({
  lastRemotePlugins: () => [],
  mirrorPlugins: vi.fn(),
}));

const { createSyncHost } = await import("../../sync/host.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listChanges.mockResolvedValue([]);
});

describe("host.feed.changes", () => {
  it("answers an empty page with the entity types past the newest change", async () => {
    const cursor = Number.MAX_SAFE_INTEGER;
    const page = await createSyncHost().feed.changes("user-1", cursor, 1000);
    expect(page).toEqual({
      records: [],
      hasMore: false,
      nextCursor: cursor,
      entityTypes: [
        { type: "hosts", owner: "core", order: 10, readOnly: false },
      ],
    });
  });

  it("asks for one more row than the limit to know if more remain", async () => {
    await createSyncHost().feed.changes("user-1", 0, 1000);
    expect(mocks.listChanges).toHaveBeenCalledWith(
      "user-1",
      0,
      1001,
      undefined,
    );
  });

  it("leaves out records of types this server does not run", async () => {
    mocks.listChanges.mockResolvedValue([
      { seq: 5, entityType: "gone", syncId: "a", revision: 1, deleted: false },
    ]);
    const page = await createSyncHost().feed.changes("user-1", 0, 10);
    expect(page.records).toEqual([]);
    expect(page.nextCursor).toBe(5);
  });
});

describe("host.hosts.findForSync", () => {
  beforeEach(() => {
    mocks.findHostIdBySyncId.mockResolvedValue(41);
    mocks.canAccessHost.mockImplementation(async (_user, _host, action) => ({
      hasAccess: action === "connect",
    }));
    mocks.findById.mockResolvedValue({ name: "Shared host", ip: "10.0.0.1" });
  });

  it("resolves the server ID for a connect only recipient", async () => {
    const found = await createSyncHost().hosts.findForSync(
      "recipient",
      "host-sync-id",
    );
    expect(mocks.canAccessHost).toHaveBeenCalledWith(
      "recipient",
      41,
      "connect",
    );
    expect(found).toEqual({ id: 41, name: "Shared host" });
  });

  it("does not disclose a host the caller cannot connect to", async () => {
    mocks.canAccessHost.mockResolvedValue({ hasAccess: false });
    expect(await createSyncHost().hosts.findForSync("u", "s")).toBeNull();
  });

  it("returns null for a missing sync ID", async () => {
    mocks.findHostIdBySyncId.mockResolvedValue(null);
    expect(await createSyncHost().hosts.findForSync("u", "s")).toBeNull();
    expect(mocks.canAccessHost).not.toHaveBeenCalled();
  });
});

describe("host.sessions", () => {
  it("issues a long desktop session that shows in the sessions list", async () => {
    mocks.generateJWTToken.mockResolvedValue("token");
    const token = await createSyncHost().sessions.issueDesktop("u1", {
      days: 365,
      deviceInfo: "Laptop (sync)",
    });
    expect(token).toBe("token");
    expect(mocks.generateJWTToken).toHaveBeenCalledWith("u1", {
      expiresIn: "365d",
      deviceType: "desktop",
      deviceInfo: "Laptop (sync)",
    });
  });

  it("answers 404 outside the desktop app", () => {
    const previous = process.env.ELECTRON_EMBEDDED;
    delete process.env.ELECTRON_EMBEDDED;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    (
      createSyncHost().sessions.desktopOnly() as (
        req: unknown,
        res: unknown,
        next: () => void,
      ) => void
    )({}, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
    if (previous !== undefined) process.env.ELECTRON_EMBEDDED = previous;
  });
});

describe("host.links", () => {
  it("reads the linked server registry", async () => {
    mocks.getLink.mockResolvedValue({ id: 1, serverUrl: "https://a.example" });
    expect(await createSyncHost().links.get()).toEqual({
      id: 1,
      serverUrl: "https://a.example",
    });
  });
});
