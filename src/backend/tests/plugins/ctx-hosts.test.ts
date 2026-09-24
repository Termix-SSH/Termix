import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  granted: new Set<string>(),
  actor: undefined as string | undefined,
  access: {
    hasAccess: true,
    isOwner: true,
    isShared: false,
  } as Record<string, unknown>,
  ownedHosts: [] as Array<Record<string, unknown>>,
  sharedRows: [] as Array<Record<string, unknown>>,
  visibleGrants: [] as Array<{ hostId: number }>,
  ownerId: "user-1",
  hostById: null as Record<string, unknown> | null,
  upserts: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  updateResult: null as Record<string, unknown> | null,
  users: [] as Array<{ id: string; username: string }>,
  activities: [] as Array<Record<string, unknown>>,
  sessions: [] as number[],
  released: [] as number[],
  importRows: [] as Array<{ hostId: number; row: Record<string, unknown> }>,
  statusReports: [] as Array<Record<string, unknown>>,
  statusPorts: [] as string[],
  statusPortsRemoved: [] as string[],
  userPermissions: new Set<string>(),
  deleted: [] as Array<{ userId: string; hostId: number }>,
  roles: [] as Array<{
    id: number;
    name: string;
    displayName: string | null;
    isSystem: boolean;
  }>,
}));

vi.mock("../../plugins/permissions.js", async () => {
  const { PluginCapabilityError } = await import("@termix/plugin-sdk/backend");
  return {
    assertCapability: async (
      pluginId: string,
      capability: string,
      declared: readonly string[],
    ) => {
      if (!declared.includes(capability) || !h.granted.has(capability)) {
        throw new PluginCapabilityError(pluginId, capability);
      }
    },
  };
});
vi.mock("../../plugins/actor.js", () => ({ getActor: () => h.actor }));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async () => h.access,
      hasPermission: async (_userId: string, permission: string) =>
        h.userPermissions.has(permission),
    }),
  },
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findHostsByUserId: async () => h.ownedHosts,
    listHostRowsForAccessList: async () => h.sharedRows,
    findHostOwnerId: async () => h.ownerId,
    findHostById: async () => h.hostById,
  }),
  createCurrentRoleRepository: () => ({
    listUserRoleIds: async () => [],
    listRoles: async () => h.roles,
  }),
  createCurrentRbacAccessRepository: () => ({
    listVisibleHostAccessEntries: async () => h.visibleGrants,
    upsertHostAccess: async (input: Record<string, unknown>) => {
      h.upserts.push(input);
      return { id: h.upserts.length, created: true };
    },
  }),
  createCurrentUserRepository: () => ({
    listAll: async () => h.users,
  }),
  createCurrentHostRepository: () => ({
    createEncryptedForUser: async (
      userId: string,
      host: Record<string, unknown>,
    ) => {
      const created = { id: 99, ...host, userId };
      h.created.push(created);
      return created;
    },
    updateEncryptedForUser: async (
      userId: string,
      hostId: number,
      patch: Record<string, unknown>,
    ) => {
      h.updates.push({ userId, hostId, patch });
      if (!h.updateResult) return null;
      return { ...h.updateResult, ...patch, id: hostId, userId };
    },
    listDecryptedByUserId: async () => h.ownedHosts,
  }),
}));
vi.mock("../../services/recent-activity.js", () => ({
  recordRecentActivity: async (
    userId: string,
    entry: Record<string, unknown>,
  ) => {
    h.activities.push({ userId, ...entry });
    return { status: "logged", id: 1 };
  },
}));
vi.mock("../../hosts/host-session-status.js", () => ({
  hostSessionStatus: {
    register: (hostId: number) => {
      h.sessions.push(hostId);
      return () => h.released.push(hostId);
    },
  },
}));
vi.mock("../../hosts/status/host-status-service.js", () => ({
  hostStatusService: {
    get: (hostId: number) =>
      hostId === 4 ? { status: "reachable", lastChecked: "t" } : null,
    check: async (hostId: number) => ({
      status: "offline",
      lastChecked: String(hostId),
    }),
    reportLogin: (hostId: number, outcome: Record<string, unknown>) =>
      h.statusReports.push({ hostId, ...outcome }),
    registerPort: (connectionType: string) => {
      h.statusPorts.push(connectionType);
      return () => h.statusPortsRemoved.push(connectionType);
    },
  },
}));
vi.mock("../../database/routes/host-plugin-settings.js", () => ({
  applyPluginHostImportSettings: async (
    hostId: number,
    row: Record<string, unknown>,
  ) => {
    h.importRows.push({ hostId, row });
  },
}));
vi.mock("../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({
      snapshotForUser: async () => {},
      snapshotForRole: async () => {},
    }),
  },
}));

vi.mock("../../hosts/delete-host.js", () => ({
  deleteOwnedHost: async (userId: string, hostId: number) => {
    h.deleted.push({ userId, hostId });
    return hostId === 404 ? null : { id: hostId, name: "gone" };
  },
}));

const { createPluginHosts } = await import("../../plugins/ctx-hosts.js");
const { PluginCapabilityError } = await import("@termix/plugin-sdk/backend");

function manifest(capabilities: string[]) {
  return {
    id: "fixture",
    name: "Fixture",
    version: "1.0.0",
    capabilities,
  } as never;
}

beforeEach(() => {
  h.granted = new Set();
  h.actor = "user-1";
  h.access = { hasAccess: true, isOwner: true, isShared: false };
  h.ownedHosts = [];
  h.sharedRows = [];
  h.visibleGrants = [];
  h.ownerId = "user-1";
  h.hostById = null;
  h.upserts = [];
  h.created = [];
  h.updates = [];
  h.updateResult = null;
  h.users = [];
  h.roles = [];
  h.userPermissions = new Set();
  h.deleted = [];
});

describe("ctx.hosts", () => {
  it("refuses list/get/checkAccess without hosts:read", async () => {
    const audit = vi.fn(async () => {});
    const hosts = createPluginHosts({ manifest: manifest([]), audit });
    await expect(hosts.list()).rejects.toBeInstanceOf(PluginCapabilityError);
    await expect(hosts.get(1)).rejects.toBeInstanceOf(PluginCapabilityError);
    await expect(hosts.checkAccess(1, "view")).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
  });

  it("lists owned and shared hosts once granted hosts:read", async () => {
    h.granted = new Set(["hosts:read"]);
    h.ownedHosts = [
      {
        id: 1,
        userId: "user-1",
        name: "own",
        ip: "10.0.0.1",
        port: 22,
        username: "root",
        tags: "prod",
        folder: null,
        authType: "password",
      },
    ];
    h.sharedRows = [
      {
        id: 2,
        userId: "user-2",
        name: "shared",
        ip: "10.0.0.2",
        port: 22,
        username: "root",
        tags: null,
        folder: null,
        authType: "key",
      },
    ];
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:read"]),
      audit: vi.fn(async () => {}),
    });
    const list = await hosts.list();
    expect(list.map((h2) => h2.id)).toEqual([1, 2]);
  });

  it("checkAccess reports the granted level", async () => {
    h.granted = new Set(["hosts:read"]);
    h.access = {
      hasAccess: true,
      isOwner: false,
      isShared: true,
      permissionLevel: "edit",
      expiresAt: null,
    };
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:read"]),
      audit: vi.fn(async () => {}),
    });
    const access = await hosts.checkAccess(1, "edit");
    expect(access).toMatchObject({ hasAccess: true, permissionLevel: "edit" });
  });

  it("refuses share, listUsers, listRoles without hosts:write, auditing the refusal", async () => {
    const audit = vi.fn(async () => {});
    const hosts = createPluginHosts({ manifest: manifest([]), audit });
    await expect(
      hosts.share(1, [{ type: "user", id: "user-2" }], "view"),
    ).rejects.toBeInstanceOf(PluginCapabilityError);
    await expect(hosts.listUsers()).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
    await expect(hosts.listRoles()).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
    expect(audit).toHaveBeenCalledWith(
      "hosts_share",
      expect.any(String),
      expect.objectContaining({ success: false }),
    );
  });

  it("shares a host it manages and snapshots secrets per target", async () => {
    h.granted = new Set(["hosts:write"]);
    h.access = { hasAccess: true, isOwner: true, isShared: false };
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:write"]),
      audit: vi.fn(async () => {}),
    });
    const result = await hosts.share(
      5,
      [{ type: "user", id: "user-2" }],
      "view",
      24,
    );
    expect(result).toEqual({ hostId: 5, shared: true });
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0]).toMatchObject({
      hostId: 5,
      permissionLevel: "view",
      targetType: "user",
      targetUserId: "user-2",
    });
  });

  it("refuses to share a host the caller does not manage", async () => {
    h.granted = new Set(["hosts:write"]);
    h.access = { hasAccess: false, isOwner: false, isShared: false };
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:write"]),
      audit: vi.fn(async () => {}),
    });
    const result = await hosts.share(
      5,
      [{ type: "user", id: "user-2" }],
      "view",
    );
    expect(result).toEqual({ hostId: 5, shared: false, reason: "forbidden" });
  });

  it("lists non-system roles and users once granted hosts:write", async () => {
    h.granted = new Set(["hosts:write"]);
    h.users = [{ id: "user-1", username: "alice" }];
    h.roles = [
      { id: 1, name: "admin", displayName: "Admin", isSystem: true },
      { id: 2, name: "auditor", displayName: "Auditor", isSystem: false },
    ];
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:write"]),
      audit: vi.fn(async () => {}),
    });
    expect(await hosts.listUsers()).toEqual([
      { id: "user-1", username: "alice" },
    ]);
    expect(await hosts.listRoles()).toEqual([
      { id: 2, name: "auditor", displayName: "Auditor" },
    ]);
  });

  it("refuses create/update/listOwned without hosts:write", async () => {
    const audit = vi.fn(async () => {});
    const hosts = createPluginHosts({ manifest: manifest([]), audit });
    await expect(
      hosts.create({
        name: "n",
        ip: "10.0.0.1",
        port: 22,
        username: "root",
        authType: "password",
      }),
    ).rejects.toBeInstanceOf(PluginCapabilityError);
    await expect(hosts.update(1, { name: "x" })).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
    await expect(hosts.listOwned()).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
    expect(audit).toHaveBeenCalledWith(
      "hosts_create",
      expect.any(String),
      expect.objectContaining({ success: false }),
    );
  });

  it("creates a host once granted hosts:write", async () => {
    h.granted = new Set(["hosts:write"]);
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:write"]),
      audit: vi.fn(async () => {}),
    });
    const created = await hosts.create({
      name: "pve-guest",
      ip: "10.0.0.5",
      port: 22,
      username: "root",
      authType: "password",
      enableRdp: true,
    });
    expect(created).toMatchObject({
      id: 99,
      name: "pve-guest",
      userId: "user-1",
    });
    expect(h.created).toHaveLength(1);
    // Another plugin's fields go through its import normalizer.
    expect(h.importRows.at(-1)).toMatchObject({
      hostId: 99,
      row: { enableRdp: true },
    });
  });

  it("updates a host once granted hosts:write", async () => {
    h.granted = new Set(["hosts:write"]);
    h.updateResult = { id: 5, name: "old" };
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:write"]),
      audit: vi.fn(async () => {}),
    });
    const updated = await hosts.update(5, { name: "new" });
    expect(updated).toMatchObject({ id: 5, name: "new" });
    expect(h.updates).toEqual([
      { userId: "user-1", hostId: 5, patch: { name: "new" } },
    ]);
  });

  it("returns null updating a host that does not exist for this user", async () => {
    h.granted = new Set(["hosts:write"]);
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:write"]),
      audit: vi.fn(async () => {}),
    });
    expect(await hosts.update(404, { name: "x" })).toBeNull();
  });

  it("lists owned hosts decrypted once granted hosts:write", async () => {
    h.granted = new Set(["hosts:write"]);
    h.ownedHosts = [{ id: 1, userId: "user-1", name: "own" }];
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:write"]),
      audit: vi.fn(async () => {}),
    });
    expect(await hosts.listOwned()).toMatchObject([{ id: 1, name: "own" }]);
  });
});

describe("ctx.hosts.delete", () => {
  it("refuses without hosts:write and audits it", async () => {
    const audit = vi.fn(async () => {});
    const hosts = createPluginHosts({ manifest: manifest([]), audit });
    await expect(hosts.delete(1)).rejects.toBeInstanceOf(PluginCapabilityError);
    expect(audit).toHaveBeenCalledWith(
      "hosts_delete",
      "host 1",
      expect.objectContaining({ success: false }),
    );
    expect(h.deleted).toEqual([]);
  });

  it("refuses an acting user without hosts.delete", async () => {
    h.granted = new Set(["hosts:write"]);
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:write"]),
      audit: vi.fn(async () => {}),
    });
    await expect(hosts.delete(1)).rejects.toThrow("may not delete hosts");
    expect(h.deleted).toEqual([]);
  });

  it("deletes the actor's own host through core's delete path", async () => {
    h.granted = new Set(["hosts:write"]);
    h.userPermissions = new Set(["hosts.delete"]);
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:write"]),
      audit: vi.fn(async () => {}),
    });
    expect(await hosts.delete(7)).toBe(true);
    expect(await hosts.delete(404)).toBe(false);
    expect(h.deleted).toEqual([
      { userId: "user-1", hostId: 7 },
      { userId: "user-1", hostId: 404 },
    ]);
  });
});

describe("ctx.hosts session tracking and activity", () => {
  it("counts a live session through core and releases it", () => {
    h.sessions = [];
    h.released = [];
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:read"]),
      audit: vi.fn(async () => {}),
    });
    const release = hosts.trackSession(4);
    expect(h.sessions).toEqual([4]);
    release();
    expect(h.released).toEqual([4]);
  });

  it("refuses to track a session without hosts:read declared", () => {
    const hosts = createPluginHosts({
      manifest: manifest([]),
      audit: vi.fn(async () => {}),
    });
    expect(() => hosts.trackSession(4)).toThrow(PluginCapabilityError);
  });

  it("records activity for the acting user only", async () => {
    h.activities = [];
    h.granted = new Set(["hosts:read"]);
    h.actor = "user-7";
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:read"]),
      audit: vi.fn(async () => {}),
    });
    await hosts.recordActivity(4, "terminal", "web-01");
    expect(h.activities).toEqual([
      { userId: "user-7", type: "terminal", hostId: 4, hostName: "web-01" },
    ]);
  });
});

describe("ctx.hosts.status", () => {
  it("reads and checks core's status with hosts:read", async () => {
    h.granted = new Set(["hosts:read"]);
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:read"]),
      audit: vi.fn(async () => {}),
    });
    expect(hosts.status.get(4)).toEqual({
      status: "reachable",
      lastChecked: "t",
    });
    expect(hosts.status.get(5)).toBeNull();
    await expect(hosts.status.check(5)).resolves.toEqual({
      status: "offline",
      lastChecked: "5",
    });
  });

  it("refuses every status member without hosts:read", async () => {
    const hosts = createPluginHosts({
      manifest: manifest([]),
      audit: vi.fn(async () => {}),
    });
    expect(() => hosts.status.get(4)).toThrow(PluginCapabilityError);
    expect(() => hosts.status.reportLogin(4, { ok: true })).toThrow(
      PluginCapabilityError,
    );
    expect(() => hosts.status.registerPort("rdp", () => 3389)).toThrow(
      PluginCapabilityError,
    );
    await expect(hosts.status.check(4)).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
  });

  it("passes login reports on to core", () => {
    h.statusReports = [];
    h.granted = new Set(["hosts:read"]);
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:read"]),
      audit: vi.fn(async () => {}),
    });
    hosts.status.reportLogin(4, { ok: false, hostKeyChanged: true });
    expect(h.statusReports).toEqual([
      { hostId: 4, ok: false, hostKeyChanged: true },
    ]);
  });

  it("removes a registered port when the plugin is disposed", async () => {
    h.statusPorts = [];
    h.statusPortsRemoved = [];
    h.granted = new Set(["hosts:read"]);
    const { DisposableBag } = await import("../../plugins/disposables.js");
    const bag = new DisposableBag("fixture");
    const hosts = createPluginHosts({
      manifest: manifest(["hosts:read"]),
      bag,
      audit: vi.fn(async () => {}),
    });
    hosts.status.registerPort("rdp", () => 3389);
    expect(h.statusPorts).toEqual(["rdp"]);
    await bag.disposeAll();
    expect(h.statusPortsRemoved).toEqual(["rdp"]);
  });
});
