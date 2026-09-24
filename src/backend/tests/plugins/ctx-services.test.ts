/**
 * ctx.services with named providers: a plugin may only register the names
 * its manifest lists, a consumer reaches one provider by name, and each is
 * disposed with the plugin that provided it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/audit-logger.js", () => ({ logAudit: async () => {} }));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import {
  clearServiceRegistry,
  getRegistration,
} from "../../plugins/service-registry.js";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

function contextFor(pluginId: string, names?: string[]) {
  const manifest = {
    id: pluginId,
    name: pluginId,
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities: [],
    provides: [
      {
        service: "sample.live",
        version: "1.0.0",
        permission: `${pluginId}.use`,
        ...(names ? { names } : {}),
      },
    ],
  } as PluginManifest;
  const handle = createPluginHandle(pluginId, { activate: () => {} });
  return { ctx: createPluginContext(manifest, handle), handle };
}

afterEach(() => clearServiceRegistry());

describe("ctx.services named providers", () => {
  it("registers a declared name and lists it", () => {
    const { ctx } = contextFor("terminal-like", ["ssh"]);
    ctx.services.provide("sample.live", { get: () => 1 }, { name: "ssh" });

    expect(getRegistration("sample.live", "ssh")?.pluginId).toBe(
      "terminal-like",
    );
    expect(ctx.services.providers("sample.live")).toEqual(["ssh"]);
  });

  it("refuses a name the manifest does not list", () => {
    const { ctx } = contextFor("terminal-like", ["ssh"]);
    expect(() =>
      ctx.services.provide("sample.live", {}, { name: "rdp" }),
    ).toThrow(/provides\[\]\.names does not list it/);
    expect(() => ctx.services.provide("sample.live", {})).toThrow(
      /does not list it/,
    );
  });

  it("refuses a name when the manifest declares an unnamed service", () => {
    const { ctx } = contextFor("plain");
    expect(() =>
      ctx.services.provide("sample.live", {}, { name: "ssh" }),
    ).toThrow(/does not list it/);
  });

  it("reaches one provider by name through a handle", () => {
    const { ctx } = contextFor("terminal-like", ["ssh"]);
    ctx.services.provide("sample.live", { get: () => 1 }, { name: "ssh" });

    const named = ctx.services.get<{ get: () => Promise<number> }>(
      "sample.live",
      { provider: "ssh" },
    );
    const other = ctx.services.get("sample.live", { provider: "rdp" });
    expect("get" in named).toBe(true);
    expect("get" in other).toBe(false);
  });
});
