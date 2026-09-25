/**
 * The actor cannot be spoofed. It is set by a request or by ctx.asUser, and
 * every other way of naming a user (a service handle, a shared secret read)
 * is audited the same way asUser is. RBAC inside ctx.hosts and ctx.ssh is
 * applied for that actor, so a user without access to a host cannot reach it
 * through a plugin.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auditEntries: Array<Record<string, unknown>> = [];
const h = vi.hoisted(() => ({
  reachable: new Set<number>([1]),
  resolvedFor: [] as Array<{ id: number; userId: string }>,
}));

vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async () =>
      ["hosts:read", "ssh:connect", "credentials:use"].map((capability) => ({
        capability,
      })),
  }),
  createCurrentHostResolutionRepository: () => ({
    findHostOwnerId: async () => "owner",
    findHostById: async (id: number) => ({
      id,
      userId: "owner",
      name: "box",
      ip: "10.0.0.1",
      port: 22,
      username: "root",
      tags: null,
      folder: null,
      authType: "password",
    }),
  }),
}));
vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      hasPermission: async () => true,
      canAccessHost: async (_userId: string, hostId: number) => ({
        hasAccess: h.reachable.has(hostId),
        isOwner: false,
        isShared: h.reachable.has(hostId),
      }),
    }),
  },
}));
vi.mock("../../../hosts/host-resolver.js", () => ({
  resolveHostById: async (id: number, userId: string) => {
    h.resolvedFor.push({ id, userId });
    return h.reachable.has(id) ? { id, userId: "owner", ip: "10.0.0.1" } : null;
  },
  resolveHostBySyncId: async () => null,
}));

const { createPluginContext, createPluginHandle } =
  await import("../../../plugins/ctx.js");
const { invalidatePluginPermissionCache } =
  await import("../../../plugins/permissions.js");
const { runAsActor, getActor } = await import("../../../plugins/actor.js");
const { clearServiceRegistry } =
  await import("../../../plugins/service-registry.js");

function contextFor(pluginId: string, extra: Record<string, unknown> = {}) {
  const handle = createPluginHandle(pluginId, { activate: () => {} });
  return createPluginContext(
    {
      id: pluginId,
      name: pluginId,
      version: "1.0.0",
      description: "",
      author: { name: "test" },
      license: "MIT",
      category: "Productivity",
      engine: { termix: ">=2.9.0", api: "1" },
      capabilities: ["hosts:read", "ssh:connect", "credentials:use"],
      ...extra,
    } as never,
    handle,
  );
}

const asUserLines = () =>
  auditEntries.filter((entry) => entry.action === "plugin_as_user");

beforeEach(() => {
  auditEntries.length = 0;
  h.resolvedFor = [];
  h.reachable = new Set([1]);
  invalidatePluginPermissionCache();
});
afterEach(() => clearServiceRegistry());

describe("naming a user is audited like ctx.asUser", () => {
  function provider() {
    const ctx = contextFor("provider", {
      provides: [
        { service: "sample.echo", version: "1.0.0", permission: "x.use" },
      ],
    });
    ctx.services.provide("sample.echo", {
      whoAmI: async () => getActor(),
    });
    return ctx;
  }

  it("ctx.asUser writes an as_user line", async () => {
    const ctx = contextFor("caller");
    await ctx.asUser("victim", async () => undefined);
    expect(asUserLines()).toHaveLength(1);
    expect(asUserLines()[0]).toMatchObject({ resourceId: "caller" });
  });

  it("services.get({ userId }) for someone else writes one too", async () => {
    provider();
    const caller = contextFor("caller");
    const handle = caller.services.get<{ whoAmI: () => Promise<string> }>(
      "sample.echo",
      { userId: "victim" },
    );
    await runAsActor("alice", "request", async () => {
      expect(await handle.whoAmI()).toBe("victim");
    });
    expect(asUserLines()).toHaveLength(1);
    expect(String(asUserLines()[0].details)).toMatch(/victim/);
  });

  it("a handle's asUser(userId) writes one too", async () => {
    provider();
    const caller = contextFor("caller");
    const handle = caller.services.get<{
      asUser: (userId: string) => { whoAmI: () => Promise<string> };
    }>("sample.echo");
    await runAsActor("alice", "request", async () => {
      expect(await handle.asUser("victim").whoAmI()).toBe("victim");
    });
    expect(asUserLines()).toHaveLength(1);
  });

  it("naming the actor itself is not a switch and writes nothing", async () => {
    provider();
    const caller = contextFor("caller");
    const handle = caller.services.get<{ whoAmI: () => Promise<string> }>(
      "sample.echo",
      { userId: "alice" },
    );
    await runAsActor("alice", "request", () => handle.whoAmI());
    expect(asUserLines()).toHaveLength(0);
  });

  it("the provider sees the user the permission was checked for", async () => {
    provider();
    const caller = contextFor("caller");
    const handle = caller.services.get<{ whoAmI: () => Promise<string> }>(
      "sample.echo",
    );
    await runAsActor("alice", "request", async () => {
      expect(await handle.whoAmI()).toBe("alice");
    });
  });
});

describe("a user cannot reach a host they have no access to", () => {
  it("ctx.hosts answers nothing for it", async () => {
    const ctx = contextFor("reader");
    await runAsActor("alice", "request", async () => {
      expect(await ctx.hosts.get(99)).toBeNull();
      expect(await ctx.hosts.status.get(99)).toBeNull();
      expect(await ctx.hosts.status.check(99)).toBeNull();
      const access = await ctx.hosts.checkAccess(99, "connect");
      expect(access.hasAccess).toBe(false);
    });
  });

  it("ctx.ssh resolves it as the actor and gets nothing", async () => {
    const ctx = contextFor("reader");
    await runAsActor("alice", "request", async () => {
      expect(await ctx.ssh.resolveHost(99)).toBeNull();
    });
    expect(h.resolvedFor).toEqual([{ id: 99, userId: "alice" }]);
  });

  it("ctx.ssh refuses everything without an actor, whatever the host says", async () => {
    const ctx = contextFor("reader");
    await expect(ctx.ssh.resolveHost(1)).rejects.toThrow(/acting user/);
    await expect(
      ctx.ssh.connect({
        id: 1,
        userId: "owner",
        ip: "10.0.0.1",
        port: 22,
        username: "root",
      }),
    ).rejects.toThrow(/acting user/);
    await expect(
      ctx.ssh.jumpChain([{ hostId: 1 }], {
        forHost: {
          id: 1,
          userId: "owner",
          ip: "10.0.0.1",
          port: 22,
          username: "root",
        },
      }),
    ).rejects.toThrow(/acting user/);
  });
});
