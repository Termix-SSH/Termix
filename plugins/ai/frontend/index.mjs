/**
 * Frontend half of the ai plugin.
 *
 * AiPanel and the rest of src/ui/features/ai/ stay in core rather than
 * moving here: TerminalAiPanel.tsx and TerminalProposalCard.tsx in
 * src/ui/features/terminal/ (also core) import AiMessage, AiToolCall,
 * useAiStream and ProposalCard directly, for the terminal's own docked AI
 * panel. That is a real external dependency, the same reason session-manager
 * stays in core for ssh-terminal rather than being copied into that plugin.
 *
 * The "ai" surface itself is not registered through registerTabComponent:
 * it is a rail-view/right-dock panel baked into AppShell.tsx and
 * tabUtils.tsx (railView === "ai", case "ai"), the same way the terminal's
 * tab is baked into Terminal.tsx rather than going through the generic tab
 * registry. What gates it is isTabTypeAvailable("ai") in
 * src/ui/shell/pluginLoader.ts's BUILT_IN_TABS_BY_PLUGIN map, which is
 * consulted directly by AppShell.tsx, CommandPalette.tsx and HostItem.tsx --
 * the same live mechanism ssh-terminal's "terminal" entry already uses.
 *
 * register()/unregister() exist for parity with the other first-party
 * plugins' frontend halves. Nothing invokes them yet: there is no frontend
 * plugin loader (see src/ui/tests/sidebar/plugin-extension-seam.test.tsx),
 * and the "ai" surface does not need registerRailItem/registerTabComponent
 * in the first place, since it is gated through BUILT_IN_TABS_BY_PLUGIN
 * instead.
 */

export const id = "ai";
export const tabId = "ai";

export async function register() {
  // Nothing to register: "ai" is a built-in rail-view/tab gated through
  // isTabTypeAvailable, not a runtime-registered surface. See the header.
}

export async function unregister() {
  // Nothing to unregister; see register().
}
