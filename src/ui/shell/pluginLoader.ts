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

import { Bot } from "lucide-react";
import { unregisterRailItem } from "@/sidebar/rail-items";
import { unregisterTabComponent } from "@/shell/tabUtils";
import { getPlugins, type PluginSummary } from "@/api/plugins-api";
import {
  declareActionSlot,
  registerAction,
  registerSlotContribution,
  unregisterAction,
  unregisterSlotContribution,
} from "@/shell/action-registry";

/**
 * Built-in tab types owned by a plugin, keyed by plugin id. The terminal has
 * no rail item: it opens from a host, the command palette or quick connect.
 *
 * ai is a rail-view/right-dock panel rather than a tab opened via
 * registerTabComponent (AiPanel is rendered directly by AppShell.tsx and
 * tabUtils.tsx, the same way TerminalTabContent is for the terminal), so it
 * belongs here for the same reason: a built-in surface gated by whether its
 * owning plugin is installed and enabled, not something registered at
 * runtime.
 */
const BUILT_IN_TABS_BY_PLUGIN: Record<string, string[]> = {
  "ssh-terminal": ["terminal"],
  "remote-desktop": ["rdp", "vnc", "telnet"],
  ai: ["ai"],
  fleets: ["fleet-inventory"],
  "network-topology": ["network_graph"],
  "web-endpoint": ["web-endpoint"],
};

let pluginEnabled = new Map<string, boolean>();
let disabledTabTypes = new Set<string>();

const TERMINAL_TOOLBAR_SLOT = "terminal.toolbar";
const AI_OPEN_WITH_CONTEXT = "ai.openWithContext";

/**
 * Applies the UI action contributions the first-party plugins declare.
 *
 * These live in plugins/*_/frontend/index.mjs, but nothing imports those yet:
 * there is no frontend plugin loader. Until there is, the registration is
 * mirrored here so the contributed UI is actually reachable in the running
 * app rather than only in tests. The two must be kept in step, and this block
 * goes away when a real loader lands.
 */
function applyFirstPartyActions(enabled: Map<string, boolean>): void {
  if (enabled.get("ssh-terminal") !== false) {
    declareActionSlot({ id: TERMINAL_TOOLBAR_SLOT, accepts: ["button"] });
  }

  if (enabled.get("ai") === false) {
    unregisterSlotContribution(TERMINAL_TOOLBAR_SLOT, AI_OPEN_WITH_CONTEXT);
    unregisterAction(AI_OPEN_WITH_CONTEXT);
    return;
  }

  registerAction(
    AI_OPEN_WITH_CONTEXT,
    (context: unknown) => {
      window.dispatchEvent(
        new CustomEvent("termix:ai:openWithContext", {
          detail: { context: typeof context === "string" ? context : "" },
        }),
      );
    },
    { permission: "ai.services.use", pluginId: "ai" },
  );

  registerSlotContribution(TERMINAL_TOOLBAR_SLOT, {
    actionId: AI_OPEN_WITH_CONTEXT,
    titleKey: "ai.assistant",
    icon: Bot,
    kind: "button",
    pluginId: "ai",
  });
}

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
  applyFirstPartyActions(nextEnabled);
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
  unregisterSlotContribution(TERMINAL_TOOLBAR_SLOT, AI_OPEN_WITH_CONTEXT);
  unregisterAction(AI_OPEN_WITH_CONTEXT);
}
