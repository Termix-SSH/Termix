/**
 * ctx.notify and ctx.fetch: each is gated on its capability and audited,
 * notify only ever reaches the acting user's own channels, and fetch goes
 * through the SSRF guard with only the hosts the caller listed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const grants = new Map<string, string[]>();
const auditEntries: Array<Record<string, unknown>> = [];

const state = vi.hoisted(() => ({
  channels: new Map<
    string,
    Array<{
      id: number;
      name: string;
      type: string;
      config: string;
      enabled: number;
    }>
  >(),
  delivered: [] as Array<{ channelId: number; title: string }>,
  failChannel: null as number | null,
  fetchCalls: [] as Array<{ url: string; allowlist: readonly string[] }>,
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
  createCurrentNotificationChannelRepository: () => ({
    listNotificationChannels: async (userId: string) =>
      state.channels.get(userId) ?? [],
  }),
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  },
}));

vi.mock("../../utils/notification-sender.js", () => ({
  deliverNotification: async (
    channel: { id: number },
    notification: { title: string },
  ) => {
    if (channel.id === state.failChannel) throw new Error("HTTP 500");
    state.delivered.push({ channelId: channel.id, title: notification.title });
  },
}));

vi.mock("../../utils/safe-outbound-fetch.js", () => ({
  safeOutboundFetch: async (
    url: string,
    init: RequestInit,
    allowlist: readonly string[],
  ) => {
    state.lastSignal = init.signal ?? null;
    state.fetchCalls.push({ url, allowlist });
    return new Response("ok", { status: 200 });
  },
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import { runAsActor } from "../../plugins/actor.js";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

function contextFor(capabilities: string[]) {
  grants.set("demo", capabilities);
  const manifest = {
    id: "demo",
    name: "demo",
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities,
  } as PluginManifest;
  const handle = createPluginHandle("demo", { activate: () => {} });
  return createPluginContext(manifest, handle);
}

beforeEach(() => {
  grants.clear();
  auditEntries.length = 0;
  invalidatePluginPermissionCache();
  state.channels.clear();
  state.delivered.length = 0;
  state.failChannel = null;
  state.fetchCalls.length = 0;
  state.channels.set("alice", [
    { id: 1, name: "ops", type: "webhook", config: "{}", enabled: 1 },
    { id: 2, name: "muted", type: "ntfy", config: "{}", enabled: 0 },
    { id: 3, name: "pager", type: "discord", config: "{}", enabled: 1 },
  ]);
  state.channels.set("bob", [
    { id: 9, name: "bob's", type: "webhook", config: "{}", enabled: 1 },
  ]);
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

  it("refuses a call with no acting user", async () => {
    const ctx = contextFor(["notify:send"]);
    await expect(
      ctx.notify.send([1], { title: "t", body: "b" }),
    ).rejects.toThrow(/acting user/);
  });

  it("lists the actor's channels without their config", async () => {
    const ctx = contextFor(["notify:send"]);
    const channels = await runAsActor("alice", "request", () =>
      ctx.notify.channels(),
    );
    expect(channels).toEqual([
      { id: 1, name: "ops", type: "webhook", enabled: true },
      { id: 2, name: "muted", type: "ntfy", enabled: false },
      { id: 3, name: "pager", type: "discord", enabled: true },
    ]);
  });

  it("sends only to the actor's enabled channels and reports failures", async () => {
    const ctx = contextFor(["notify:send"]);
    state.failChannel = 3;

    const result = await runAsActor("alice", "request", () =>
      ctx.notify.send([1, 2, 3, 9], { title: "Disk", body: "full" }),
    );

    expect(state.delivered).toEqual([{ channelId: 1, title: "Disk" }]);
    expect(result).toEqual({
      delivered: 1,
      failures: [{ channelId: 3, name: "pager", error: "HTTP 500" }],
    });
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_notify_send",
      success: true,
    });
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
