import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BACKEND_ENTRY,
  type PluginManifest,
} from "@termix/plugin-sdk/manifest";

/**
 * Where user-installed plugins live. Resolved per call rather than captured at
 * module scope: tests set DATA_DIR in beforeEach, and a module-scope constant
 * would freeze whatever the first import saw.
 */
export function getPluginsDir(): string {
  return path.join(process.env.DATA_DIR || "./db/data", "plugins");
}

/**
 * Where the plugins that ship with Termix live.
 *
 * Separate from getPluginsDir() because that one is user data: a bundled
 * plugin is part of the install and must not be deletable or shadowable by
 * whatever happens to be in the data directory.
 *
 * Resolved from this module's location rather than cwd, because the build
 * emits to dist/backend/backend/plugins/ and the bundled plugins sit beside
 * dist/backend.
 */
export function getBundledPluginsDir(): string {
  const override = process.env.TERMIX_BUNDLED_PLUGINS_DIR;
  if (override) return override;

  const here = path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    // Built server: dist/backend/backend/plugins -> dist/plugins
    // Source tree:  src/backend/plugins          -> plugins
    // Both are three levels up, which is why there is one entry, not two.
    path.resolve(here, "../../../plugins"),
    // Built server invoked from a nested layout: .../dist/backend/backend/plugins
    path.resolve(here, "../../../../plugins"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export function getPluginDir(pluginId: string): string {
  return path.join(getPluginsDir(), pluginId);
}

/**
 * The backend entry, from the manifest's own `backend` field.
 *
 * Bundled plugins still ship a hand-written backend/index.mjs, so that stays
 * the fallback until A2 gives every plugin a real build.
 */
export function getPluginBackendEntry(
  pluginDir: string,
  manifest?: Pick<PluginManifest, "backend">,
): string {
  const legacy = path.join(pluginDir, "backend", "index.mjs");
  if (!manifest?.backend || manifest.backend === DEFAULT_BACKEND_ENTRY) {
    if (fs.existsSync(legacy)) return legacy;
  }
  return path.join(pluginDir, manifest?.backend ?? DEFAULT_BACKEND_ENTRY);
}

export function getPluginManifestPath(pluginDir: string): string {
  return path.join(pluginDir, "manifest.json");
}
