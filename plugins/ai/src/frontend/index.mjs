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
 * src/ui/shell/pluginLoader.ts's BUILT_IN_TABS_BY_PLUGIN map.
 *
 * What this file DOES contribute is the terminal toolbar's AI button, through
 * the action registry: ai.openWithContext, declared in manifest.json and
 * gated on ai.services.use. The button used to be hardwired into
 * TerminalToolbar.tsx behind a showAiAssistant prop.
 *
 * There is still no frontend plugin loader, so nothing imports this file yet
 * (see src/ui/tests/sidebar/plugin-extension-seam.test.tsx). Until one exists,
 * pluginLoader.ts performs the same registration itself when the ai plugin is
 * enabled. This file is the version that runs once a loader lands, and the two
 * must be kept in step.
 */

export const id = "ai";
export const tabId = "ai";
export const actionId = "ai.openWithContext";

/** Asks the focused terminal to open its AI panel seeded with `context`. */
export function openWithContext(context) {
  window.dispatchEvent(
    new CustomEvent("termix:ai:openWithContext", {
      detail: { context: typeof context === "string" ? context : "" },
    }),
  );
}

export async function register({
  registerAction,
  registerSlotContribution,
  icons,
}) {
  registerAction(actionId, openWithContext, {
    permission: "ai.services.use",
    pluginId: id,
  });

  registerSlotContribution("terminal.toolbar", {
    actionId,
    titleKey: "ai.assistant",
    icon: icons.Bot,
    kind: "button",
    pluginId: id,
  });
}

export async function unregister({
  unregisterAction,
  unregisterSlotContribution,
}) {
  unregisterSlotContribution("terminal.toolbar", actionId);
  unregisterAction(actionId);
}
