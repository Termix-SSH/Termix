import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_BACKEND_ENTRY,
  type PluginManifest,
} from "@termix-ssh/plugin-sdk/manifest";

/**
 * Where user-installed plugins live. Resolved per call rather than captured at
 * module scope: tests set DATA_DIR in beforeEach, and a module-scope constant
 * would freeze whatever the first import saw.
 */
export function getPluginsDir(): string {
  return path.join(process.env.DATA_DIR || "./db/data", "plugins");
}

/**
 * A plugin's own files (ctx.files.dataDir(), downloaded binaries). Kept out of
 * getPluginsDir(), where the loader would read every data folder as a user
 * plugin that clashes with the bundled one of the same name.
 */
export function getPluginDataDir(pluginId: string): string {
  return path.join(
    process.env.DATA_DIR || "./db/data",
    "plugin-data",
    pluginId,
  );
}

/**
 * Where user .tmxplug files are unpacked. A dot directory inside the user
 * plugins dir, which the loader's directory scan skips.
 */
export function getUnpackedPluginsDir(): string {
  return path.join(getPluginsDir(), ".unpacked");
}

/**
 * Where the plugins that ship with Termix live.
 *
 * Separate from getPluginsDir() because that one is user data: a bundled
 * plugin is part of the install and must not be deletable or shadowable by
 * whatever happens to be in the data directory.
 *
 * Resolved from this module's location rather than cwd. The build emits to
 * dist/backend/backend/plugins/ with the bundled plugins beside dist/backend,
 * and a run from source reads the same dist/plugins.
 */
export function getBundledPluginsDir(): string {
  const override = process.env.TERMIX_BUNDLED_PLUGINS_DIR;
  if (override) return override;

  const here = path.dirname(fileURLToPath(import.meta.url));
  // Built: dist/backend/backend/plugins -> dist/plugins
  // Source (vitest, tsx): src/backend/plugins -> dist/plugins
  const fromSource = path.basename(path.resolve(here, "../..")) === "src";
  return fromSource
    ? path.resolve(here, "../../../dist/plugins")
    : path.resolve(here, "../../../plugins");
}

/** The backend entry, from the manifest's own `backend` field. */
export function getPluginBackendEntry(
  pluginDir: string,
  manifest?: Pick<PluginManifest, "backend">,
): string {
  return path.join(pluginDir, manifest?.backend ?? DEFAULT_BACKEND_ENTRY);
}

export function getPluginManifestPath(pluginDir: string): string {
  return path.join(pluginDir, "manifest.json");
}
