/**
 * Frontend half of the tailscale plugin.
 *
 * TailscaleDevicesPanel is a left-sidebar railView panel (opened from the
 * rail, not a Tab), the same shape as FleetsPanel/QuickConnectPanel. None of
 * those go through registerRailItem/registerTabComponent either -- per
 * src/ui/shell/pluginLoader.ts's own comment, a rail-view panel like this is
 * rendered directly by AppShell.tsx rather than registered at runtime.
 * TailscaleDevicesPanel is reached today through a direct relative import in
 * AppShell.tsx (../../plugins/tailscale/frontend/TailscaleDevicesPanel), not
 * through register() below.
 *
 * register()/unregister() still follow the same shape every other plugin's
 * frontend entry does, so this is ready the moment a real frontend plugin
 * loader exists -- see plugins/ssh-terminal/frontend/index.mjs and
 * src/ui/tests/sidebar/plugin-extension-seam.test.tsx, which says outright
 * "there is no plugin loader yet".
 *
 * TailscaleCheckDialog is not registered here at all: it is rendered
 * directly by src/ui/features/terminal/Terminal.tsx (owned by ssh-terminal),
 * driven by raw WS message types on the terminal socket. There is no
 * dialog-registration extension point for that today, so this plugin ships
 * the component as a plain module ssh-terminal imports by path.
 */

export const id = "tailscale";
export const railViewId = "tailscale";

export async function register({ registerRailItem, icons }) {
  registerRailItem?.({
    id: railViewId,
    icon: icons.Radar,
    labelKey: "nav.tailscale",
    separatorAfter: true,
  });
}

export async function unregister({ unregisterRailItem }) {
  unregisterRailItem?.(railViewId);
}
