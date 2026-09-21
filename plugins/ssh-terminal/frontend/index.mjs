/**
 * Frontend half of the ssh-terminal plugin.
 *
 * Registers the existing Terminal component through the extension seams that
 * already exist in the shell (registerRailItem / registerTabComponent). The
 * component itself is unchanged and still lives in src/ui/features/terminal -
 * this only controls whether the shell knows about it.
 *
 * register() is called when the plugin is enabled, unregister() when it is
 * disabled, so the tab and rail entry appear and disappear with the plugin.
 */

export const id = "ssh-terminal";
export const tabId = "terminal";

export async function register({
  registerRailItem,
  registerTabComponent,
  icons,
}) {
  registerTabComponent(tabId, () =>
    import("@/features/terminal/Terminal").then((m) => ({
      default: m.Terminal,
    })),
  );

  registerRailItem({
    id: tabId,
    icon: icons.SquareTerminal,
    labelKey: "nav.terminal",
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
