/**
 * Applies backend plugin state to the shell.
 *
 * Two kinds of contributed surface exist, and they are removed differently:
 *
 *   - A tab that only exists because a plugin registered it goes away with
 *     unregisterTabComponent / unregisterRailItem.
 *   - A tab that ships as a built-in code path but is OWNED by a plugin (the
 *     terminal) cannot, because it was never registered. Callers ask
 *     isTabTypeAvailable() before offering it instead.
 *
 * The terminal is in the second group because its tab takes around a dozen
 * props (host, split-pane state, file-manager and editor callbacks) that the
 * generic { tab } plugin surface has no way to supply. Rewiring that was a
 * bigger regression risk to a working terminal than gating the entry points.
 */

import { unregisterRailItem } from "@/sidebar/rail-items";
import { unregisterTabComponent } from "@/shell/tabUtils";
import { getPlugins, type PluginSummary } from "@/api/plugins-api";

/**
 * Built-in tab types owned by a plugin, keyed by plugin id. The terminal has
 * no rail item: it opens from a host, the command palette or quick connect.
 */
const BUILT_IN_TABS_BY_PLUGIN: Record<string, string[]> = {
  "ssh-terminal": ["terminal"],
};

let pluginEnabled = new Map<string, boolean>();
let disabledTabTypes = new Set<string>();

export function applyPluginState(plugins: PluginSummary[]): void {
  const nextEnabled = new Map<string, boolean>();
  const nextDisabledTabs = new Set<string>();

  for (const plugin of plugins) {
    nextEnabled.set(plugin.id, plugin.enabled);

    const builtInTabs = BUILT_IN_TABS_BY_PLUGIN[plugin.id];
    if (builtInTabs) {
      if (!plugin.enabled) {
        for (const tabId of builtInTabs) nextDisabledTabs.add(tabId);
      }
      continue;
    }

    // Plugin-registered surfaces: only removal happens here. Registration is
    // the plugin's own frontend entry being imported.
    if (!plugin.enabled) {
      for (const tab of plugin.contributes?.tabs ?? []) {
        unregisterRailItem(tab.id);
        unregisterTabComponent(tab.id);
      }
    }
  }

  pluginEnabled = nextEnabled;
  disabledTabTypes = nextDisabledTabs;
}

export async function refreshPluginState(): Promise<PluginSummary[]> {
  const plugins = await getPlugins();
  applyPluginState(plugins);
  return plugins;
}

/**
 * Whether a built-in tab type may still be opened. Call sites that offer a
 * connection action (host item, command palette, quick connect) check this so
 * a disabled plugin stops offering the tab it owns.
 */
export function isTabTypeAvailable(tabType: string): boolean {
  return !disabledTabTypes.has(tabType);
}

export function isPluginEnabled(pluginId: string): boolean {
  // Unknown means not yet loaded; assume enabled so the UI does not blank out
  // a working feature while the first request is in flight.
  return pluginEnabled.get(pluginId) ?? true;
}

/** Test seam. */
export function resetPluginState(): void {
  pluginEnabled = new Map();
  disabledTabTypes = new Set();
}
