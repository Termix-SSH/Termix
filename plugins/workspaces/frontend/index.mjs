/**
 * Frontend half of the workspaces plugin.
 *
 * WorkspacesPanel is a left-sidebar railView panel (opened from the rail,
 * not a Tab), the same shape as FleetsPanel/HostsPanel/CredentialsPanel.
 * None of those go through registerRailItem/registerTabComponent either --
 * per src/ui/shell/pluginLoader.ts's own comment, a rail-view panel like
 * this is rendered directly by AppShell.tsx rather than registered at
 * runtime. WorkspacesPanel is reached today through a direct relative
 * import in AppShell.tsx (../../plugins/workspaces/frontend/WorkspacesPanel),
 * not through register() below.
 *
 * register()/unregister() still follow the same shape every other plugin's
 * frontend entry does, so this is ready the moment a real frontend plugin
 * loader exists -- see plugins/ssh-terminal/frontend/index.mjs and
 * src/ui/tests/sidebar/plugin-extension-seam.test.tsx, which says outright
 * "there is no plugin loader yet".
 */

export const id = "workspaces";
export const railViewId = "workspaces";

export async function register({ registerRailItem, icons }) {
  registerRailItem?.({
    id: railViewId,
    icon: icons.LayoutTemplate,
    labelKey: "nav.workspaces",
    separatorAfter: true,
  });
}

export async function unregister({ unregisterRailItem }) {
  unregisterRailItem?.(railViewId);
}
