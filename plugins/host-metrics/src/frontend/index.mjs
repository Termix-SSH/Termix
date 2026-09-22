/**
 * Frontend half of the host-metrics plugin.
 *
 * Registers the Host Metrics tab through the existing extension seams
 * (registerRailItem / registerTabComponent), the same way ssh-terminal's and
 * docker's frontend do.
 *
 * HostEditorStatsTab itself stays in src/ui/sidebar/HostEditorStatsTab.tsx
 * rather than moving into this plugin: it takes the same {form, setField}
 * pair every other host editor tab does, and those types (HostEditorForm,
 * the setField signature) are core types HostEditor.tsx owns -- the same
 * reason docker leaves HostDockerTab in core.
 *
 * register() is called when the plugin is enabled, unregister() when it is
 * disabled. As of this change neither is actually invoked anywhere yet, the
 * same as ssh-terminal's and docker's frontend entries -- there is no
 * frontend plugin loader yet. This file follows the same shape so it is
 * ready the moment that loader exists.
 */

export const id = "host-metrics";
export const tabId = "host-metrics";

export async function register({
  registerRailItem,
  registerTabComponent,
  icons,
}) {
  registerTabComponent(tabId, () =>
    import("./HostMetricsTab.tsx").then((m) => ({
      default: m.HostMetricsTab,
    })),
  );

  registerRailItem({
    id: tabId,
    icon: icons.Activity,
    labelKey: "nav.hostMetrics",
    kind: "tab",
  });
}

export async function unregister({
  unregisterRailItem,
  unregisterTabComponent,
}) {
  unregisterRailItem(tabId);
  unregisterTabComponent(tabId);
}
