import type { ComponentType } from "react";
import { Terminal } from "lucide-react";
import type {
  StandaloneViewProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import {
  TerminalTabContent,
  loadTerminal,
} from "@/features/terminal/TerminalTabContent";
import TerminalApp from "@/features/terminal/TerminalApp";
import {
  TERMINAL_DOCK_SLOT,
  TERMINAL_OVERLAY_SLOT,
  TERMINAL_TOOLBAR_SLOT,
} from "@/features/terminal/terminal-slots";

/** `?view=terminal` full-screen links. */
function TerminalStandalone({ hostId, params }: StandaloneViewProps) {
  return (
    <TerminalApp
      hostId={hostId}
      tmuxSession={params.get("tmuxSession") ?? undefined}
    />
  );
}

/**
 * The SSH terminal. Its component still lives in core until the terminal's
 * own Phase B step; this plugin decides whether the shell offers it.
 */
export function activate(app: TermixApp): void {
  app.registerTab(
    "terminal",
    TerminalTabContent as unknown as ComponentType<TabProps>,
    {
      icon: Terminal,
      titleKey: "nav.terminal",
      persistent: true,
      session: true,
      restore: (host) => !!host.enableSsh,
      activityTypes: ["terminal"],
      standalone: TerminalStandalone,
      preload: loadTerminal,
    },
  );

  app.registerHostAction({
    id: "terminal",
    titleKey: "nav.terminal",
    icon: Terminal,
    kind: "connect",
    priority: 100,
    order: 10,
    tabType: "terminal",
    copyUrlView: "terminal",
    when: (host) => !!host.enableSsh && host.enableTerminal !== false,
  });

  // Places other plugins can fill: toolbar buttons, a docked side panel and
  // overlays that follow the session's connection flow.
  app.declareActionSlot({ id: TERMINAL_TOOLBAR_SLOT, accepts: ["button"] });
  app.declareActionSlot({ id: TERMINAL_DOCK_SLOT, accepts: ["component"] });
  app.declareActionSlot({ id: TERMINAL_OVERLAY_SLOT, accepts: ["component"] });
}
