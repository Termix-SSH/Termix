import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where unpacked plugins live. Resolved per call rather than captured at module
 * scope: tests set DATA_DIR in beforeEach, and a module-scope constant would
 * freeze whatever the first import saw.
 */
export function getPluginsDir(): string {
  return path.join(process.env.DATA_DIR || "./db/data", "plugins");
}

/**
 * Where first-party plugins that ship with Termix live.
 *
 * Separate from getPluginsDir() because that one is user data: a bundled
 * plugin is part of the install and must not be deletable or shadowable by
 * whatever happens to be in the data directory.
 *
 * Resolved from this module's location rather than cwd, same reasoning as the
 * worker bootstrap: the build emits to dist/backend/backend/plugins/, and the
 * bundled plugins sit beside dist/backend.
 */
export function getBundledPluginsDir(): string {
  const override = process.env.TERMIX_BUNDLED_PLUGINS_DIR;
  if (override) return override;

  const here = path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    // Built server: dist/backend/backend/plugins -> dist/plugins
    path.resolve(here, "../../../plugins"),
    // Running from source under vitest/tsx: src/backend/plugins -> plugins
    path.resolve(here, "../../../plugins"),
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

export function getPluginBackendEntry(pluginDir: string): string {
  return path.join(pluginDir, "backend", "index.mjs");
}

export function getPluginManifestPath(pluginDir: string): string {
  return path.join(pluginDir, "manifest.json");
}
