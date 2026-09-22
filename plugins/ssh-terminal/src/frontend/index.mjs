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
export const toolbarSlotId = "terminal.toolbar";

export async function register({
  registerRailItem,
  registerTabComponent,
  declareActionSlot,
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

  // Offers other plugins a place in the terminal toolbar. The terminal does
  // not know or care who fills it.
  declareActionSlot({ id: toolbarSlotId, accepts: ["button"] });
}

export async function unregister({
  unregisterRailItem,
  unregisterTabComponent,
  undeclareActionSlot,
}) {
  unregisterRailItem(tabId);
  unregisterTabComponent(tabId);
  undeclareActionSlot(toolbarSlotId);
}
