import path from "node:path";

/**
 * Where unpacked plugins live. Resolved per call rather than captured at module
 * scope: tests set DATA_DIR in beforeEach, and a module-scope constant would
 * freeze whatever the first import saw.
 */
export function getPluginsDir(): string {
  return path.join(process.env.DATA_DIR || "./db/data", "plugins");
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
