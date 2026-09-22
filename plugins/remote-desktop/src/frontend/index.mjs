/**
 * Frontend half of the remote-desktop plugin.
 *
 * rdp/vnc/telnet are built-in tabs owned by this plugin (see
 * BUILT_IN_TABS_BY_PLUGIN in src/ui/shell/pluginLoader.ts), the same
 * category ssh-terminal's "terminal" tab is in: they render through
 * tabUtils.tsx's hardcoded switch rather than through registerTabComponent,
 * because GuacamoleApp needs hostId/tabId/protocol/quickConnectHost/ref --
 * more props than the generic { tab } plugin surface can carry. There is
 * nothing to register or unregister here; isTabTypeAvailable("rdp"/"vnc"/
 * "telnet") is what actually gates them off when this plugin is disabled.
 *
 * This file exists only so the plugin has a frontend entry point matching
 * every other plugin's shape, ready for the day a real frontend loader
 * calls register()/unregister() directly instead of pluginLoader.ts's
 * hand-duplicated stopgap wiring.
 */

export const id = "remote-desktop";
export const tabIds = ["rdp", "vnc", "telnet"];

export async function register() {
  // No-op: see module comment.
}

export async function unregister() {
  // No-op: see module comment.
}
