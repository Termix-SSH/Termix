/**
 * Frontend half of the automations plugin.
 *
 * AutomationsPanel is a left-sidebar railView panel (opened from the rail,
 * not a Tab), the same shape as FleetsPanel/HostsPanel/AiPanel. None of those
 * go through registerRailItem/registerTabComponent either -- per
 * src/ui/shell/pluginLoader.ts's own comment, a rail-view panel like this is
 * rendered directly by AppShell.tsx rather than registered at runtime, the
 * same way ai's AiPanel is. AutomationsPanel is reached today through a
 * direct relative import in AppShell.tsx
 * (../../plugins/automations/frontend/AutomationsPanel) and in
 * src/ui/shell/tabUtils.tsx (for its promotable/dockable tab surface), not
 * through register() below.
 *
 * register()/unregister() still follow the same shape every other plugin's
 * frontend entry does, so this is ready the moment a real frontend plugin
 * loader exists -- see plugins/ssh-terminal/frontend/index.mjs and
 * src/ui/tests/sidebar/plugin-extension-seam.test.tsx, which says outright
 * "there is no plugin loader yet".
 */

export const id = "automations";
export const railViewId = "automations";

export async function register({ registerRailItem, icons }) {
  registerRailItem?.({
    id: railViewId,
    icon: icons.Workflow,
    labelKey: "nav.automations",
    separatorAfter: true,
  });
}

export async function unregister({ unregisterRailItem }) {
  unregisterRailItem?.(railViewId);
}
