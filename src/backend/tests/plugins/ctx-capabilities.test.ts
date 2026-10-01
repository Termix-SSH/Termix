/**
 * ctx.capabilities: a generic check for privileged code no ctx method wraps,
 * used first by the serial plugin to gate opening a physical device. Every
 * `require` call is audited, allowed or refused, the same as a guarded ctx
 * method.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const grants = new Map<string, string[]>();
const auditEntries: Array<Record<string, unknown>> = [];

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      (grants.get(pluginId) ?? []).map((capability) => ({
        pluginId,
        capability,
      })),
  }),
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  },
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

function manifestFor(pluginId: string, capabilities: string[]): PluginManifest {
  return {
    id: pluginId,
    name: pluginId,
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities,
  } as PluginManifest;
}

function contextFor(pluginId: string, capabilities: string[]) {
  const manifest = manifestFor(pluginId, capabilities);
  const handle = createPluginHandle(pluginId, { activate: () => {} });
  return { ctx: createPluginContext(manifest, handle), handle };
}

beforeEach(() => {
  grants.clear();
  auditEntries.length = 0;
  invalidatePluginPermissionCache();
});

describe("ctx.capabilities", () => {
  it("has() is false when the manifest never declared the capability", async () => {
    grants.set("demo", ["device:serial"]);
    const { ctx } = contextFor("demo", []);

    await expect(ctx.capabilities.has("device:serial")).resolves.toBe(false);
  });

  it("has() is false when declared but not granted", async () => {
    grants.set("demo", []);
    const { ctx } = contextFor("demo", ["device:serial"]);

    await expect(ctx.capabilities.has("device:serial")).resolves.toBe(false);
  });

  it("has() is true when declared and granted", async () => {
    grants.set("demo", ["device:serial"]);
    const { ctx } = contextFor("demo", ["device:serial"]);

    await expect(ctx.capabilities.has("device:serial")).resolves.toBe(true);
  });

  it("require() throws and audits a refusal without the capability", async () => {
    grants.set("demo", []);
    const { ctx } = contextFor("demo", []);

    await expect(ctx.capabilities.require("device:serial")).rejects.toThrow(
      /device:serial/,
    );
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_capability_require",
      success: false,
    });
  });

  it("require() resolves and audits success when granted", async () => {
    grants.set("demo", ["device:serial"]);
    const { ctx } = contextFor("demo", ["device:serial"]);

    await expect(
      ctx.capabilities.require("device:serial"),
    ).resolves.toBeUndefined();
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_capability_require",
      success: true,
    });
  });
});
