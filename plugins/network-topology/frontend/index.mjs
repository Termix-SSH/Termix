/**
 * Frontend half of the network-topology plugin.
 *
 * NetworkGraphCard renders in two modes: as a full tab (network_graph) and
 * embedded as a dashboard card. Both usages are wired today through the
 * existing tabUtils.tsx / DashboardTab.tsx switch statements the same way
 * fleet-inventory's tab is, not through register() below -- per
 * src/ui/shell/pluginLoader.ts's own comment, "there is no plugin loader
 * yet" for the frontend half.
 *
 * register()/unregister() still follow the same shape every other plugin's
 * frontend entry does, so this is ready the moment a real frontend plugin
 * loader exists.
 */

export const id = "network-topology";
export const tabId = "network_graph";

export async function register({ registerRailItem, registerTabComponent, icons }) {
  registerTabComponent?.(tabId, () =>
    import("./NetworkGraphCard.tsx").then((m) => ({
      default: m.NetworkGraphCard,
    })),
  );

  registerRailItem?.({
    id: tabId,
    icon: icons.Network,
    labelKey: "nav.networkGraph",
    kind: "tab",
  });
}

export async function unregister({ unregisterRailItem, unregisterTabComponent }) {
  unregisterRailItem?.(tabId);
  unregisterTabComponent?.(tabId);
}
