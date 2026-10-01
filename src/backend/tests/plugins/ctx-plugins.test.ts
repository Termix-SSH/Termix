import { describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

vi.mock("../../plugins/permissions.js", async () => {
  const { PluginCapabilityError } = await import("@termix/plugin-sdk/backend");
  return {
    assertCapability: async (
      pluginId: string,
      capability: string,
      declared: readonly string[],
    ) => {
      if (!declared.includes(capability)) {
        throw new PluginCapabilityError(pluginId, capability);
      }
    },
  };
});

vi.mock("../../plugins/index.js", () => ({
  getPluginRuntime: () => ({
    loader: {
      list: () => [
        {
          id: "alpha",
          source: "bundled",
          state: "active",
          manifest: { version: "1.2.0" },
          dir: "/secret/path",
          lastError: "boom",
        },
        {
          id: "beta",
          source: "user",
          state: "stopped",
          manifest: { version: "0.1.0" },
        },
      ],
    },
  }),
}));

const { createPluginPlugins } = await import("../../plugins/ctx-plugins.js");
const { PluginCapabilityError } = await import("@termix/plugin-sdk/backend");

const manifest = (capabilities: string[]) =>
  ({ id: "reader", capabilities }) as unknown as PluginManifest;

describe("ctx.plugins", () => {
  it("lists id, version, source and state only", async () => {
    const plugins = createPluginPlugins(manifest(["plugins:read"]));
    expect(await plugins.list()).toEqual([
      { id: "alpha", version: "1.2.0", source: "bundled", state: "active" },
      { id: "beta", version: "0.1.0", source: "user", state: "stopped" },
    ]);
  });

  it("refuses without plugins:read", async () => {
    const plugins = createPluginPlugins(manifest([]));
    await expect(plugins.list()).rejects.toBeInstanceOf(PluginCapabilityError);
  });
});
