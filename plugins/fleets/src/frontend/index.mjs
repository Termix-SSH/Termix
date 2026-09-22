/**
 * Frontend half of the fleets plugin.
 *
 * FleetsPanel is a left-sidebar railView panel (opened from the rail, not a
 * Tab), the same shape as HostsPanel/CredentialsPanel/AiPanel. None of those
 * go through registerRailItem/registerTabComponent either -- per
 * src/ui/shell/pluginLoader.ts's own comment, a rail-view panel like this is
 * rendered directly by AppShell.tsx rather than registered at runtime, the
 * same way ai's AiPanel is. FleetsPanel is reached today through a direct
 * relative import in AppShell.tsx (../../plugins/fleets/frontend/FleetsPanel),
 * not through register() below.
 *
 * register()/unregister() still follow the same shape every other plugin's
 * frontend entry does, so this is ready the moment a real frontend plugin
 * loader exists -- see plugins/ssh-terminal/frontend/index.mjs and
 * src/ui/tests/sidebar/plugin-extension-seam.test.tsx, which says outright
 * "there is no plugin loader yet".
 *
 * The fleet-inventory tab (opened from within FleetsPanel) is wired
 * separately in src/ui/shell/tabUtils.tsx, the same way docker/host-metrics
 * tabs are -- a plugin tab id that already exists in the built-in TabType
 * union goes through the ordinary tabSurfaceLoaders/switch wiring there, not
 * through registerTabComponent (which is for tab ids outside that union).
 */

export const id = "fleets";
export const railViewId = "fleets";

export async function register({ registerRailItem, icons }) {
  registerRailItem?.({
    id: railViewId,
    icon: icons.Boxes,
    labelKey: "nav.fleets",
    separatorAfter: true,
  });
}

export async function unregister({ unregisterRailItem }) {
  unregisterRailItem?.(railViewId);
}
