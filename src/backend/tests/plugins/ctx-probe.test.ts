/**
 * ctx.network.tcpProbe, ctx.ssh.probe and ctx.hosts.probeTargets: gated by
 * capability, and only ever offered hosts the actor may connect to.
 */

import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const grants = new Map<string, string[]>();
const state = vi.hoisted(() => ({
  owned: [] as Array<Record<string, unknown>>,
  shared: [] as Array<Record<string, unknown>>,
  sharedIds: [] as number[],
  allowed: new Set<number>(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      (grants.get(pluginId) ?? []).map((capability) => ({
        pluginId,
        capability,
      })),
  }),
  createCurrentHostResolutionRepository: () => ({
    listStatusTargets: async (filter: {
      userId?: string;
      hostIds?: number[];
    }) => {
      const rows = filter.userId ? state.owned : state.shared;
      return rows.filter(
        (row) => !filter.hostIds || filter.hostIds.includes(row.id as number),
      );
    },
  }),
  createCurrentRoleRepository: () => ({ listUserRoleIds: async () => [] }),
  createCurrentRbacAccessRepository: () => ({
    listVisibleHostAccessEntries: async () =>
      state.sharedIds.map((hostId) => ({ hostId })),
  }),
}));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      filterAccessibleHostIds: async (_user: string, ids: number[]) =>
        new Set(ids.filter((id) => state.allowed.has(id))),
      canAccessHost: async (_user: string, id: number) => ({
        hasAccess: state.allowed.has(id),
      }),
    }),
  },
}));
vi.mock("../../utils/audit-logger.js", () => ({ logAudit: async () => {} }));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import { runAsActor } from "../../plugins/actor.js";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";

function contextFor(capabilities: string[]) {
  const manifest = {
    id: "demo",
    name: "demo",
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=26.10.3", api: "1" },
    capabilities,
  } as PluginManifest;
  return createPluginContext(
    manifest,
    createPluginHandle("demo", { activate: () => {} }),
  );
}

const row = (id: number, userId: string) => ({
  id,
  userId,
  ip: "127.0.0.1",
  port: 22,
  connectionType: "ssh",
  jumpHosts: null,
  statusCheckEnabled: true,
  statusCheckInterval: null,
});

let server: net.Server;
let port = 0;

beforeEach(async () => {
  grants.clear();
  invalidatePluginPermissionCache();
  state.owned = [row(1, "alice")];
  state.shared = [row(2, "bob"), row(3, "bob")];
  state.sharedIds = [2, 3];
  state.allowed = new Set([2]);
  server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(() => {
  server.close();
});

describe("ctx.network.tcpProbe", () => {
  it("refuses without network:probe", async () => {
    grants.set("demo", []);
    await expect(
      contextFor([]).network.tcpProbe("127.0.0.1", port),
    ).rejects.toThrow(/network:probe/);
  });

  it("reports an open port and a closed one", async () => {
    grants.set("demo", ["network:probe"]);
    const ctx = contextFor(["network:probe"]);
    expect(await ctx.network.tcpProbe("127.0.0.1", port)).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(
      await ctx.network.tcpProbe("127.0.0.1", port, { timeoutMs: 500 }),
    ).toBe(false);
  });

  it("rejects a bad port", async () => {
    grants.set("demo", ["network:probe"]);
    await expect(
      contextFor(["network:probe"]).network.tcpProbe("127.0.0.1", 0),
    ).rejects.toThrow(/port/);
  });
});

describe("ctx.hosts.probeTargets", () => {
  it("refuses without hosts:read", async () => {
    grants.set("demo", []);
    await expect(contextFor([]).hosts.probeTargets()).rejects.toThrow(
      /hosts:read/,
    );
  });

  it("needs an acting user", async () => {
    grants.set("demo", ["hosts:read"]);
    await expect(
      contextFor(["hosts:read"]).hosts.probeTargets(),
    ).rejects.toThrow(/acting user/);
  });

  it("returns own hosts and only shared hosts the actor may connect to", async () => {
    grants.set("demo", ["hosts:read"]);
    const ctx = contextFor(["hosts:read"]);
    const targets = await runAsActor("alice", "request", () =>
      ctx.hosts.probeTargets(),
    );
    expect(targets.map((target) => target.id)).toEqual([1, 2]);
    expect(targets[1].ownerUserId).toBe("bob");
  });
});

describe("ctx.ssh.probe", () => {
  it("refuses without ssh:connect", async () => {
    grants.set("demo", []);
    await expect(contextFor([]).ssh.probe(1)).rejects.toThrow(/ssh:connect/);
  });

  it("answers false for a host the actor cannot connect to", async () => {
    grants.set("demo", ["ssh:connect"]);
    const ctx = contextFor(["ssh:connect"]);
    expect(await runAsActor("alice", "request", () => ctx.ssh.probe(3))).toBe(
      false,
    );
  });

  it("probes a reachable host directly", async () => {
    grants.set("demo", ["ssh:connect"]);
    const ctx = contextFor(["ssh:connect"]);
    expect(
      await runAsActor("alice", "request", () => ctx.ssh.probe(2, { port })),
    ).toBe(true);
  });
});
