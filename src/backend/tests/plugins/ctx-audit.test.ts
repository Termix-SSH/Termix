/**
 * ctx.audit.record: a plugin writes an audit line under its own action name,
 * and the user it names is always the runtime's actor, never one the plugin
 * picked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const auditEntries: Array<Record<string, unknown>> = [];

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async () => [],
  }),
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  },
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { runAsActor } from "../../plugins/actor.js";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

function contextFor(pluginId: string) {
  const manifest = {
    id: pluginId,
    name: "Audit Fixture",
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities: [],
  } as PluginManifest;
  const handle = createPluginHandle(pluginId, { activate: () => {} });
  return createPluginContext(manifest, handle);
}

beforeEach(() => {
  auditEntries.length = 0;
});

describe("ctx.audit.record", () => {
  it("writes the plugin's action for the acting user", async () => {
    const ctx = contextFor("audit-fixture");
    await runAsActor("user-3", "request", () =>
      ctx.audit.record({
        action: "ssh_connect",
        resourceType: "host",
        resourceId: "12",
        resourceName: "root@10.0.0.1:22",
        success: true,
      }),
    );
    expect(auditEntries).toEqual([
      expect.objectContaining({
        userId: "user-3",
        action: "ssh_connect",
        resourceType: "host",
        resourceId: "12",
        resourceName: "root@10.0.0.1:22",
        details: "via plugin audit-fixture",
        success: true,
      }),
    ]);
  });

  it("falls back to the plugin as the resource and system as the user", async () => {
    const ctx = contextFor("audit-fixture");
    await ctx.audit.record({ action: "cleanup", success: false });
    expect(auditEntries[0]).toMatchObject({
      userId: "system",
      resourceType: "plugin",
      resourceId: "audit-fixture",
      resourceName: "Audit Fixture",
      success: false,
    });
  });
});

describe("ctx.audit.record with a request", () => {
  it("records the request's IP address and user agent", async () => {
    const ctx = contextFor("audit-fixture");
    await ctx.audit.record({
      action: "collab_room_end",
      success: true,
      request: {
        ip: "203.0.113.4",
        headers: { "user-agent": "TestAgent/1.0" },
      },
    });
    expect(auditEntries[0]).toMatchObject({
      ipAddress: "203.0.113.4",
      userAgent: "TestAgent/1.0",
    });
  });

  it("falls back to the socket address on an upgrade request", async () => {
    const ctx = contextFor("audit-fixture");
    await ctx.audit.record({
      action: "collab_join",
      success: true,
      request: { headers: {}, socket: { remoteAddress: "198.51.100.9" } },
    });
    expect(auditEntries[0]).toMatchObject({ ipAddress: "198.51.100.9" });
  });
});
