/**
 * ctx.notify and ctx.fetch: each is gated on its capability and audited.
 * notify resolves the audience in core and hands the hub plain user ids, and
 * fetch goes through the SSRF guard with only the hosts the caller listed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PluginNotification,
  PluginNotifyHub,
} from "@termix/plugin-sdk/backend";

const grants = new Map<string, string[]>();
const auditEntries: Array<Record<string, unknown>> = [];

const state = vi.hoisted(() => ({
  users: [
    { id: "alice", isAdmin: true },
    { id: "bob", isAdmin: false },
    { id: "carol", isAdmin: false },
  ],
  permissions: new Map<string, string[]>([
    ["bob", ["docker.view"]],
    ["carol", ["docker.view"]],
  ]),
  fetchCalls: [] as Array<{ url: string; allowlist: readonly string[] }>,
  lastTls: null as Record<string, unknown> | null,
  lastSignal: null as AbortSignal | null,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      (grants.get(pluginId) ?? []).map((capability) => ({
        pluginId,
        capability,
      })),
  }),
  createCurrentUserRepository: () => ({
    listAll: async () => state.users,
    findById: async (id: string) =>
      state.users.find((user) => user.id === id) ?? null,
  }),
}));

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      hasPermission: async (userId: string, permission: string) =>
        state.permissions.get(userId)?.includes(permission) ?? false,
    }),
  },
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  },
}));

vi.mock("../../utils/safe-outbound-fetch.js", () => ({
  safeOutboundFetch: async (
    url: string,
    init: RequestInit,
    allowlist: readonly string[],
    tls: Record<string, unknown> = {},
  ) => {
    state.lastTls = tls;
    state.lastSignal = init.signal ?? null;
    state.fetchCalls.push({ url, allowlist });
    return new Response("ok", { status: 200 });
  },
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import { runAsActor } from "../../plugins/actor.js";
import { clearNotifyHub } from "../../plugins/notify-hub.js";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

function contextFor(
  capabilities: string[],
  id = "demo",
  granted: string[] = capabilities,
) {
  grants.set(id, granted);
  const manifest = {
    id,
    name: id,
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities,
  } as PluginManifest;
  const handle = createPluginHandle(id, { activate: () => {} });
  return createPluginContext(manifest, handle);
}

function fakeHub() {
  const calls: Array<{
    source: string;
    recipients: string[];
    notification: PluginNotification;
  }> = [];
  const hub: PluginNotifyHub = {
    deliver: async (input) => {
      calls.push(input);
      return {
        recipients: input.recipients.length,
        delivered: 0,
        failures: [],
      };
    },
    channels: async (userId) => [
      { id: 1, name: `channel of ${userId}`, type: "webhook", enabled: true },
    ],
  };
  return { hub, calls };
}

beforeEach(() => {
  grants.clear();
  auditEntries.length = 0;
  invalidatePluginPermissionCache();
  clearNotifyHub();
  state.fetchCalls.length = 0;
});

describe("ctx.notify", () => {
  it("refuses without notify:send and audits the refusal", async () => {
    const ctx = contextFor([]);
    await expect(
      runAsActor("alice", "request", () => ctx.notify.channels()),
    ).rejects.toThrow(/notify:send/);
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_notify_channels",
      success: false,
    });
  });

  it("refuses a send with neither an acting user nor an audience", async () => {
    const ctx = contextFor(["notify:send"]);
    await expect(ctx.notify.send({ title: "t" })).rejects.toThrow(
      /acting user/,
    );
  });

  it("reaches nobody while no hub is running", async () => {
    const ctx = contextFor(["notify:send"]);
    const result = await runAsActor("alice", "request", () =>
      ctx.notify.send({ title: "Disk" }),
    );
    expect(result).toEqual({ recipients: 0, delivered: 0, failures: [] });
    expect(
      await runAsActor("alice", "request", () => ctx.notify.channels()),
    ).toEqual([]);
  });

  it("hands the hub the acting user and the sending plugin by default", async () => {
    const { hub, calls } = fakeHub();
    contextFor(["notify:hub"], "hub").notify.serve(hub);
    const ctx = contextFor(["notify:send"]);

    const result = await runAsActor("alice", "request", () =>
      ctx.notify.send({ title: "Disk", severity: "critical" }),
    );

    expect(result.recipients).toBe(1);
    expect(calls).toEqual([
      {
        source: "demo",
        recipients: ["alice"],
        notification: { title: "Disk", severity: "critical" },
      },
    ]);
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_notify_send",
      success: true,
    });
  });

  it("resolves a named user, admins and a permission in core", async () => {
    const { hub, calls } = fakeHub();
    contextFor(["notify:hub"], "hub").notify.serve(hub);
    const ctx = contextFor(["notify:send"]);

    await ctx.notify.send({ title: "a", audience: { userId: "bob" } });
    await ctx.notify.send({ title: "b", audience: "admins" });
    await ctx.notify.send({
      title: "c",
      audience: { permission: "docker.view" },
    });

    expect(calls.map((call) => call.recipients)).toEqual([
      ["bob"],
      ["alice"],
      ["bob", "carol"],
    ]);
  });

  it("does not call the hub for an audience that names nobody", async () => {
    const { hub, calls } = fakeHub();
    contextFor(["notify:hub"], "hub").notify.serve(hub);
    const ctx = contextFor(["notify:send"]);

    const result = await ctx.notify.send({
      title: "x",
      audience: { userId: "ghost" },
    });

    expect(result.recipients).toBe(0);
    expect(calls).toEqual([]);
  });

  it("asks the hub for the acting user's channels", async () => {
    const { hub } = fakeHub();
    contextFor(["notify:hub"], "hub").notify.serve(hub);
    const ctx = contextFor(["notify:send"]);
    expect(
      await runAsActor("bob", "request", () => ctx.notify.channels()),
    ).toEqual([
      { id: 1, name: "channel of bob", type: "webhook", enabled: true },
    ]);
  });

  it("only serves a hub the manifest declares notify:hub for", () => {
    const { hub } = fakeHub();
    expect(() =>
      contextFor(["notify:send"], "rogue").notify.serve(hub),
    ).toThrow(/notify:hub/);
  });

  it("refuses a second hub from another plugin", () => {
    contextFor(["notify:hub"], "hub").notify.serve(fakeHub().hub);
    expect(() =>
      contextFor(["notify:hub"], "other").notify.serve(fakeHub().hub),
    ).toThrow(/already/);
  });

  it("stops using a hub once it is revoked or its grant is gone", async () => {
    const first = fakeHub();
    const revoke = contextFor(["notify:hub"], "hub").notify.serve(first.hub);
    const ctx = contextFor(["notify:send"]);
    revoke();
    await ctx.notify.send({ title: "x", audience: "admins" });
    expect(first.calls).toEqual([]);

    const second = fakeHub();
    contextFor(["notify:hub"], "ungranted", []).notify.serve(second.hub);
    await ctx.notify.send({ title: "y", audience: "admins" });
    expect(second.calls).toEqual([]);
  });
});

describe("ctx.fetch", () => {
  it("refuses without network:outbound", async () => {
    const ctx = contextFor([]);
    await expect(ctx.fetch("https://example.com")).rejects.toThrow(
      /network:outbound/,
    );
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_fetch",
      success: false,
    });
  });

  it("goes through the SSRF guard with the listed private hosts only", async () => {
    const ctx = contextFor(["network:outbound"]);
    const response = await ctx.fetch("https://ntfy.lan/topic", {
      method: "POST",
      body: "hi",
      allowPrivateHosts: ["NTFY.LAN"],
    });
    expect(await response.text()).toBe("ok");
    expect(state.fetchCalls).toEqual([
      { url: "https://ntfy.lan/topic", allowlist: ["ntfy.lan"] },
    ]);
  });

  it("passes a pinned CA and the fingerprint bootstrap flag to the guard", async () => {
    const ctx = contextFor(["network:outbound"]);
    await ctx.fetch("https://ca.lan/root/abc", {
      tls: { rejectUnauthorized: false },
    });
    expect(state.lastTls).toEqual({ rejectUnauthorized: false });
    await ctx.fetch("https://ca.lan/provisioners", { tls: { ca: "PEM" } });
    expect(state.lastTls).toEqual({ ca: "PEM" });
    await ctx.fetch("https://example.com");
    expect(state.lastTls).toEqual({});
  });

  it("aborts the request, and a streamed body, when the caller's signal fires", async () => {
    const ctx = contextFor(["network:outbound"]);
    const controller = new AbortController();
    await ctx.fetch("https://example.com/stream", {
      signal: controller.signal,
    });
    expect(state.lastSignal?.aborted).toBe(false);
    controller.abort();
    expect(state.lastSignal?.aborted).toBe(true);
  });
});
