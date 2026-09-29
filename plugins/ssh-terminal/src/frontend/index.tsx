import { lazy, Suspense, type ComponentType } from "react";
import {
  Braces,
  Hammer,
  History,
  Laptop,
  SquareTerminal,
  Terminal,
} from "lucide-react";
import type {
  PanelProps,
  PluginHostRecord,
  StandaloneViewProps,
  TabProps,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import { isElectron } from "@termix/plugin-sdk/ui";
import { loadTerminal } from "./terminal/TerminalTabContent";
import TerminalApp from "./terminal/TerminalApp";
import {
  TERMINAL_OVERLAY_SLOT,
  TERMINAL_SIDE_PANEL_SLOT,
  TERMINAL_TOOLBAR_SLOT,
  TERMINAL_TOOLBAR_STATUS_SLOT,
} from "./terminal/terminal-slots";
import { TerminalTabWithRegistry } from "./TerminalTabWithRegistry";
import { listSessions, sendToActive, sendToSession } from "./session-registry";
import { TerminalView } from "./TerminalView";
import { HistoryPanel } from "./history/HistoryPanel";
import { TouchInputSettings } from "./settings/TouchInputSettings";
import { ImageStorageTest } from "./settings/ImageStorageTest";
import { HostTerminalSection } from "./settings/HostTerminalSection";
import { resetTouchInputSettingsCache } from "./terminal/touch-input-settings-store";
import { hostSetting } from "./terminal-api";
import { SshToolsPanel } from "./ssh-tools/SshToolsPanel";
import { MacrosPanel } from "./macros/MacrosPanel";
import {
  TERMINAL_KEYBINDING_DEFAULTS,
  validateSendControlCode,
  validateSendText,
} from "./lib/keybinding-dispatch";
import {
  PasteNote,
  SendControlCodeEditor,
  SendTextEditor,
} from "./lib/keybinding-editors";
import { TerminalDefaultsSettings } from "./settings/TerminalDefaultsSettings";
import {
  NewHostFontSetting,
  NewHostThemeSetting,
} from "./settings/NewHostLookSettings";
import { TerminalPreview } from "./look/TerminalPreview";
import { installTerminalGlobalStyles } from "./look/terminal-global-styles";
import {
  listTerminalThemes,
  resolveTerminalLook,
  type ResolveLookRequest,
} from "./look/look-actions";
import {
  invalidateTerminalClientSettings,
  loadTerminalClientSettings,
  resetTerminalClientSettings,
} from "./terminal-settings";
import { moveLocalTerminalPreferences } from "./settings/local-preferences-migration";

const LocalTerminal = lazy(() =>
  import("./local-terminal/LocalTerminal").then((m) => ({
    default: m.LocalTerminal,
  })),
);

interface TerminalOpenOptions {
  path?: string;
  joinSharedSessionId?: string;
  joinShareId?: string;
  label?: string;
}

/** `?view=terminal` full-screen links. */
function TerminalStandalone({ hostId, params }: StandaloneViewProps) {
  return (
    <TerminalApp
      hostId={hostId}
      tmuxSession={params.get("tmuxSession") ?? undefined}
    />
  );
}

/** The desktop app's own shell, one tab per open. */
function LocalTerminalTab({ tab, isVisible }: TabProps) {
  return (
    <Suspense fallback={null}>
      <LocalTerminal
        instanceId={(tab.instanceId as string | undefined) ?? tab.id}
        isVisible={isVisible}
      />
    </Suspense>
  );
}

/**
 * The SSH terminal: its tab, the desktop app's local terminal, the command
 * history panel and the places other plugins can plug into a session.
 */
export function activate(app: TermixApp): void {
  app.onDispose(installTerminalGlobalStyles());
  app.registerTab(
    "terminal",
    TerminalTabWithRegistry as unknown as ComponentType<TabProps>,
    {
      icon: Terminal,
      titleKey: "nav.terminal",
      persistent: true,
      session: true,
      commandTarget: true,
      ownBackground: true,
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
    when: (host) =>
      !!host.enableSsh && hostSetting(host, "enableTerminal", true),
  });

  app.registerHostEditorSection({
    id: "terminal",
    group: "ssh",
    titleKey: "hosts.tabTerminal",
    icon: SquareTerminal,
    order: 10,
    component: HostTerminalSection,
  });

  if (isElectron()) {
    app.registerTab("local-terminal", LocalTerminalTab, {
      icon: Laptop,
      titleKey: "nav.localTerminal",
      hostless: true,
      session: true,
      ownBackground: true,
      multiInstance: true,
      inLayouts: false,
    });
    app.registerRailItem({
      id: "local-terminal",
      icon: Laptop,
      titleKey: "nav.localTerminal",
      kind: "tab",
      electronOnly: true,
      hideable: true,
      separatorAfter: true,
    });
    app.registerPaletteEntry({
      id: "local-terminal",
      titleKey: "palette.localTerminal",
      icon: Laptop,
      keywords: ["local", "shell", "terminal"],
      scope: "global",
      run: (shell) => shell.openSingletonTab("local-terminal"),
    });
  }

  app.registerPanel(
    "history",
    HistoryPanel as unknown as ComponentType<PanelProps>,
  );
  app.registerRailItem({
    id: "history",
    icon: History,
    titleKey: "nav.history",
    hideable: true,
    promotable: true,
    rightDockable: true,
    separatorAfter: true,
  });

  app.registerPanel(
    "ssh-tools",
    SshToolsPanel as unknown as ComponentType<PanelProps>,
  );
  app.registerRailItem({
    id: "ssh-tools",
    icon: Hammer,
    titleKey: "nav.sshTools",
    after: "quick-connect",
    hideable: true,
    mobilePrimary: true,
    promotable: true,
    rightDockable: true,
    separatorAfter: true,
  });

  app.registerPanel(
    "macros",
    MacrosPanel as unknown as ComponentType<PanelProps>,
  );
  app.registerRailItem({
    id: "macros",
    icon: Braces,
    titleKey: "nav.macros",
    after: "ssh-tools",
    hideable: true,
    promotable: true,
    rightDockable: true,
    separatorAfter: true,
  });

  // The keys a user can bind to the terminal's own actions, and its
  // built-in keys they can rebind. The terminal runs these itself.
  app.registerKeybindingAction({ id: "copy", titleKey: "keybindings.copy" });
  app.registerKeybindingAction({
    id: "paste",
    titleKey: "keybindings.paste",
    editor: PasteNote,
  });
  app.registerKeybindingAction({
    id: "sendControlCode",
    titleKey: "keybindings.sendControlCode",
    editor: SendControlCodeEditor,
    validate: validateSendControlCode,
  });
  app.registerKeybindingAction({
    id: "sendText",
    titleKey: "keybindings.sendText",
    editor: SendTextEditor,
    validate: validateSendText,
  });
  for (const binding of TERMINAL_KEYBINDING_DEFAULTS) {
    app.registerKeybindingDefault(binding);
  }

  // Places other plugins can fill: toolbar buttons and readouts, a side
  // panel and overlays that follow the session's connection flow.
  app.declareActionSlot({ id: TERMINAL_TOOLBAR_SLOT, accepts: ["button"] });
  app.declareActionSlot({
    id: TERMINAL_TOOLBAR_STATUS_SLOT,
    accepts: ["component"],
  });
  app.declareActionSlot({
    id: TERMINAL_SIDE_PANEL_SLOT,
    accepts: ["component"],
  });
  app.declareActionSlot({ id: TERMINAL_OVERLAY_SLOT, accepts: ["component"] });

  // A terminal other code can embed (collab rooms, the homepage widget, the
  // tmux monitor, the file manager's window) without importing this plugin.
  app.registerComponent(
    "terminal.view",
    TerminalView as unknown as ComponentType<Record<string, unknown>>,
  );

  // Lets another plugin (snippets) push text into a live terminal session
  // without reaching into the shell's tab state itself.
  app.registerAction("terminal.listSessions", () => listSessions());
  app.registerAction("terminal.sendToActive", ((
    text: string,
    opts?: { run?: boolean },
  ) => sendToActive(text, opts)) as never);
  app.registerAction("terminal.sendToSession", ((
    sessionId: string,
    text: string,
    opts?: { run?: boolean },
  ) => sendToSession(sessionId, text, opts)) as never);
  // Opens a new terminal tab on a host: at a path (the file manager), or
  // joining someone else's shared session (the connections panel).
  app.registerAction("terminal.open", ((
    host: Parameters<TermixApp["tabs"]["openTab"]>[0],
    options: TerminalOpenOptions = {},
  ) =>
    app.tabs.openTab(host, "terminal", {
      forceNewTab: true,
      label: options.label,
      data: {
        ...(options.path ? { initialPath: options.path } : {}),
        ...(options.joinSharedSessionId
          ? {
              joinSharedSessionId: options.joinSharedSessionId,
              joinShareId: options.joinShareId ?? null,
            }
          : {}),
      },
    })) as never);

  // The terminal look for other terminal-like surfaces (docker, serial,
  // proxmox), which must not import this plugin. Each answers undefined
  // while this plugin is off, and the caller falls back to plain colors.
  app.registerComponent(
    "terminal.preview",
    TerminalPreview as unknown as ComponentType<Record<string, unknown>>,
  );
  app.registerAction("terminal.resolveTheme", (async (
    request: ResolveLookRequest & { hostId?: number | string } = {},
  ) => {
    const settings = await loadTerminalClientSettings(app.api).catch(
      () => null,
    );
    let host: PluginHostRecord | null | undefined = request.host;
    if (!host && request.hostId !== undefined) {
      host =
        app.getHost(request.hostId) ??
        (await app.listHosts().catch(() => [])).find(
          (entry) => String(entry.id) === String(request.hostId),
        );
    }
    return resolveTerminalLook({ ...request, host }, settings?.user);
  }) as never);
  app.registerAction("terminal.themes", () => listTerminalThemes());

  app.registerSettingsComponent("touchInput", TouchInputSettings);
  app.registerSettingsComponent("imageStorageTest", ImageStorageTest);
  app.registerSettingsComponent("terminalDefaults", TerminalDefaultsSettings);
  app.registerSettingsComponent("newHostTheme", NewHostThemeSetting);
  app.registerSettingsComponent("newHostFontFamily", NewHostFontSetting);

  app.onSettingsChanged(() => invalidateTerminalClientSettings());
  if (!app.guest) void moveLocalTerminalPreferences(app);

  app.onDispose(resetTouchInputSettingsCache);
  app.onDispose(resetTerminalClientSettings);
}
