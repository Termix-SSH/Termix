import type { PluginManifest } from "./manifest.js";

/** TERMIX_SAFE_MODE=1 starts only the plugins that draw the app. */
export function safeModeOn(): boolean {
  const value = process.env.TERMIX_SAFE_MODE?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function isLookPlugin(manifest: PluginManifest): boolean {
  return (
    (manifest.contributes?.layouts?.length ?? 0) > 0 ||
    (manifest.contributes?.themes?.length ?? 0) > 0
  );
}

/** Layout and theme plugins, plus the plugins they need to start. */
export function safeModePluginIds(
  plugins: { id: string; manifest: PluginManifest }[],
): Set<string> {
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const allowed = new Set<string>();
  const add = (id: string) => {
    const plugin = byId.get(id);
    if (!plugin || allowed.has(id)) return;
    allowed.add(id);
    for (const dependency of Object.keys(plugin.manifest.dependencies ?? {})) {
      add(dependency);
    }
  };
  for (const plugin of plugins) {
    if (isLookPlugin(plugin.manifest)) add(plugin.id);
  }
  return allowed;
}

/** Whether a plugin may run now. Always true outside safe mode. */
export function mayRunInSafeMode(
  pluginId: string,
  plugins: { id: string; manifest: PluginManifest }[],
): boolean {
  return !safeModeOn() || safeModePluginIds(plugins).has(pluginId);
}
