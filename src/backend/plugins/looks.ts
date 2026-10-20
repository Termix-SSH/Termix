/**
 * Layouts and themes on the server side: which look a fresh install shows,
 * and which installed looks could not load. Core names no plugin here; the
 * default look comes from the bundled index's defaultLook flag.
 */

import { defaultLookPluginIds } from "./bundled-index.js";
import type { LoadedPlugin, SkippedPlugin } from "./loader.js";

export interface DefaultLook {
  layout: string | null;
  theme: string | null;
}

interface LookLoader {
  get(pluginId: string): Pick<LoadedPlugin, "manifest"> | undefined;
  list(): Array<Pick<LoadedPlugin, "manifest">>;
  skipped(): SkippedPlugin[];
}

/**
 * The first default-look plugin's default layout (else its first one) and
 * that layout's theme. A default-look plugin with themes only fills in the
 * theme. Null where none is installed, and the browser uses its built-in.
 */
export function resolveDefaultLook(loader: LookLoader): DefaultLook {
  const look: DefaultLook = { layout: null, theme: null };
  for (const id of defaultLookPluginIds()) {
    const contributes = loader.get(id)?.manifest.contributes;
    const layouts = contributes?.layouts ?? [];
    const layout = layouts.find((entry) => entry.default) ?? layouts[0];
    if (layout && !look.layout) {
      look.layout = layout.id;
      look.theme ??= layout.defaultTheme ?? null;
    }
    if (!look.theme && contributes?.themes?.length) {
      look.theme = contributes.themes[0].id;
    }
  }
  return look;
}

/** Plugins with a layout or theme that were found but did not load. */
export function unavailableLooks(loader: LookLoader): SkippedPlugin[] {
  return loader
    .skipped()
    .filter((plugin) => plugin.layouts.length > 0 || plugin.themes.length > 0);
}

/**
 * Layout ids some installed plugin brings, whether it runs, is turned off or
 * failed to load. A choice outside this set was uninstalled, so the next
 * choice down applies instead of the repair view.
 */
export function installedLayoutIds(loader: LookLoader): Set<string> {
  const ids = new Set<string>();
  for (const plugin of loader.list()) {
    for (const layout of plugin.manifest.contributes?.layouts ?? []) {
      ids.add(layout.id);
    }
  }
  for (const plugin of loader.skipped()) {
    for (const id of plugin.layouts) ids.add(id);
  }
  return ids;
}

/** TERMIX_SAFE_LAYOUT=1 starts everyone in the layout repair view. */
export function safeLayoutForced(): boolean {
  const value = process.env.TERMIX_SAFE_LAYOUT?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export const LOOK_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
export const LAYOUT_SETTING = "ui.layout";
export const THEME_SETTING = "ui.theme";
