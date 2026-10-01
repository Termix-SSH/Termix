/**
 * ctx.plugins: which plugins are installed and whether each runs, under
 * plugins:read. Ids and versions only, nothing operational.
 */

import type { PluginPlugins } from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { assertCapability } from "./permissions.js";

export function createPluginPlugins(manifest: PluginManifest): PluginPlugins {
  return {
    list: async () => {
      await assertCapability(
        manifest.id,
        "plugins:read",
        manifest.capabilities,
      );
      const { getPluginRuntime } = await import("./index.js");
      return getPluginRuntime()
        .loader.list()
        .map((plugin) => ({
          id: plugin.id,
          version: plugin.manifest.version,
          source: plugin.source,
          state: plugin.state,
        }));
    },
  };
}
