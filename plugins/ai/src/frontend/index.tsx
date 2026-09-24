import type { ComponentType } from "react";
import { Bot, Sparkles } from "lucide-react";
import type {
  PanelProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import type {
  TerminalSidePanelProps,
  TerminalSlotApi,
} from "./terminal/terminal-slot-types";
import { AiPanel } from "./AiPanel";
import { TerminalAiPanel } from "./terminal/TerminalAiPanel";
import { AiAssistantStep } from "./AiAssistantStep";
import { ProvidersSetting } from "./settings/ProvidersSetting";
import { AI_STATUS_CHANGED_EVENT, getAiStatus } from "./ai-api";
import { setAiApp } from "./app-ref";

/** The rail id the assistant registers under. */
const AI_RAIL_ID = "ai";
const ASSISTANT_ACTION = "ai.openWithContext";
const SIDE_PANEL_ID = "ai.assistant";

function AssistantPanel({ activeTabType }: PanelProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <AiPanel activeTab={activeTabType ?? null} />
    </div>
  );
}

function AssistantTab() {
  return <AiPanel />;
}

/** The assistant beside a terminal, in its "terminal.sidePanel" slot. */
function TerminalSidePanel({
  host,
  hostId,
  hostLabel,
  panelProps,
  onClose,
  onRunInTerminal,
}: TerminalSidePanelProps) {
  if (!hostId) return null;
  return (
    <TerminalAiPanel
      hostLabel={hostLabel}
      hostId={hostId}
      activeTab={`terminal:${host?.name || host?.ip || ""}`}
      initialContext={
        typeof panelProps.context === "string" ? panelProps.context : ""
      }
      onClose={onClose}
      onRunInTerminal={onRunInTerminal}
    />
  );
}

export function activate(app: TermixApp): void {
  setAiApp(app);
  app.onDispose(() => setAiApp(null));

  let globallyEnabled = false;
  let userEnabled = false;
  const surface: (() => void)[] = [];

  const clearSurface = () => {
    while (surface.length > 0) surface.pop()!();
  };

  // What the assistant shows depends on the admin switch and the user's own
  // choice, so it is re-registered whenever either changes.
  const applyStatus = () => {
    clearSurface();

    surface.push(
      app.registerRailItem({
        id: AI_RAIL_ID,
        icon: Sparkles,
        titleKey: "nav.ai",
        promotable: true,
        rightDockable: true,
        after: "macros",
        order: 40,
        // Off for everyone: not even a Navigation toggle.
        hidden: !globallyEnabled,
      }),
    );

    if (!globallyEnabled) {
      app.tabs.closeTab(AI_RAIL_ID);
      return;
    }

    surface.push(
      app.registerTab(AI_RAIL_ID, AssistantTab as ComponentType<TabProps>, {
        icon: Sparkles,
        titleKey: "nav.ai",
        singleton: true,
        hostless: true,
        panelFrame: true,
      }),
    );

    // The per-host switch is this plugin's host setting.
    const offeredOnHost = (context: Record<string, unknown>) =>
      userEnabled &&
      (
        context.host as
          | { pluginSettings?: { ai?: { enableAiAssistant?: boolean } } }
          | undefined
      )?.pluginSettings?.ai?.enableAiAssistant === true;

    surface.push(
      app.registerSlotContribution("terminal.toolbar", {
        actionId: ASSISTANT_ACTION,
        titleKey: "ai.assistant",
        icon: Bot,
        kind: "button",
        when: offeredOnHost,
      }),
    );
    surface.push(
      app.registerSlotContribution("terminal.sidePanel", {
        actionId: SIDE_PANEL_ID,
        titleKey: "ai.assistant",
        icon: Bot,
        kind: "component",
        component: TerminalSidePanel as unknown as ComponentType<
          Record<string, unknown>
        >,
        when: offeredOnHost,
      }),
    );
    surface.push(
      app.registerSlotContribution("onboarding.steps", {
        actionId: "ai.onboarding",
        titleKey: "onboarding.aiTitle",
        kind: "component",
        component: AiAssistantStep as unknown as ComponentType<
          Record<string, unknown>
        >,
      }),
    );
  };

  const refresh = () => {
    getAiStatus()
      .then((status) => {
        globallyEnabled = status.globallyEnabled;
        userEnabled = status.globallyEnabled && status.enabled;
      })
      .catch(() => {
        globallyEnabled = false;
        userEnabled = false;
      })
      .finally(() => {
        if (!disposed) applyStatus();
      });
  };

  let disposed = false;
  app.onDispose(() => {
    disposed = true;
    clearSurface();
  });

  app.registerPanel(AI_RAIL_ID, AssistantPanel);

  // Opens the docked assistant on the terminal it was clicked from, seeded
  // with what is on screen.
  app.registerAction(
    ASSISTANT_ACTION,
    (terminal: TerminalSlotApi) =>
      terminal?.openSidePanel(SIDE_PANEL_ID, {
        context: terminal.getBufferText(),
      }),
    { permission: "services.use" },
  );

  app.registerSettingsComponent("providers", ProvidersSetting);

  applyStatus();
  refresh();
  // The admin switch and the user's own choice are settings, saved from
  // the settings screen, so re-read when plugin state or focus changes too.
  let lastFocusRefresh = Date.now();
  const onFocus = () => {
    if (Date.now() - lastFocusRefresh < 30_000) return;
    lastFocusRefresh = Date.now();
    refresh();
  };
  const events = [AI_STATUS_CHANGED_EVENT, "termix:plugins-changed"];
  for (const event of events) window.addEventListener(event, refresh);
  window.addEventListener("focus", onFocus);
  app.onDispose(() => {
    for (const event of events) window.removeEventListener(event, refresh);
    window.removeEventListener("focus", onFocus);
  });
}
