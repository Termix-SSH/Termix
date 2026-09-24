/**
 * @termix/plugin-sdk/ui: the shell's components, for plugins.
 *
 * Everything exported here is public API. A plugin builds its UI from these
 * so it looks like the rest of the app and picks up theme changes, and it
 * receives the shell's own instances through the import map, never a copy.
 *
 * The list is deliberate. It covers what the bundled plugins use today: the
 * shadcn primitives, the composites for metrics, connection screens and
 * settings rows, and the contexts a connection surface needs. Adding to it is
 * a contract change; update ARCHITECTURE.md with it. Removing from it breaks
 * plugins.
 */

// Primitives
export * from "@/components/alert";
export * from "@/components/alert-dialog";
export * from "@/components/badge";
export * from "@/components/button";
export * from "@/components/card";
export * from "@/components/checkbox";
export * from "@/components/dialog";
export * from "@/components/dropdown-menu";
export * from "@/components/input";
export * from "@/components/label";
export * from "@/components/password-input";
export * from "@/components/popover";
export * from "@/components/scroll-area";
export * from "@/components/select";
export * from "@/components/select2";
export * from "@/components/separator";
export * from "@/components/skeleton";
export * from "@/components/switch";
export * from "@/components/textarea";
export * from "@/components/tooltip";

// Composites
export * from "@/components/section-card";
export * from "@/components/metric-card";
export * from "@/components/charts";
export { LineChart, type LineChartSeries } from "@/components/charts/LineChart";
export {
  CardGridCanvas,
  ColumnCountStepper,
} from "@/components/card-grid/CardGridCanvas";
export type * from "@/components/card-grid/types";
export { ConnectionScreen } from "@/components/connection/ConnectionScreen";
export * from "@/components/connection/connection-status";
export { SnippetVariablesDialog } from "@/components/SnippetVariablesDialog";
export {
  FullScreenAppWrapper,
  type FullScreenAppPhase,
} from "@/features/FullScreenAppWrapper";

// Connection surfaces
export {
  ConnectionLogProvider,
  useConnectionLog,
  useOptionalConnectionLog,
} from "@/ssh/connection-log/ConnectionLogContext";
export { TOTPDialog, type MFAPromptMode } from "@/ssh/dialogs/TOTPDialog";
export { SSHAuthDialog } from "@/ssh/dialogs/SSHAuthDialog";
export { WarpgateDialog } from "@/ssh/dialogs/WarpgateDialog";

// Design tokens: the colour swatches folders, workspaces and tags pick from.
export { FOLDER_COLORS } from "@/lib/theme";

// Shell context
export { useTabs, useTabsSafe } from "@/shell/TabContext";

// Slots: a plugin can offer places for other plugins to fill.
export { ActionSlot, ComponentSlot } from "@/shell/ActionSlot";

// Components other plugins offer by id (app.registerComponent), rendered with
// a fallback while their plugin is off.
export { PluginComponent } from "@/plugin-host/component-registry";

// More primitives and hooks.
export { cn } from "@/lib/utils";
export {
  runAdaptivePolling,
  getPollingEnvironmentMultiplier,
} from "@/lib/adaptive-polling";
export * from "@/components/sheet";
export { useConfirmation } from "@/hooks/use-confirmation";
export { useAdaptivePolling } from "@/hooks/use-adaptive-polling";
// Per-area display density and chart options the user picked in Appearance.
export {
  useAreaPreferences,
  useUiPreferencesContext,
} from "@/contexts/UiPreferencesContext";
// Homepage widget pieces, for plugins that register a widget.
export { WidgetTitle } from "@/features/homepage/widgets/WidgetTitle";
export { runVisibleInterval } from "@/features/homepage/use-visible-interval";
export { useIsMobile } from "@/hooks/use-mobile";
export { PassphraseDialog } from "@/ssh/dialogs/PassphraseDialog";
export { OPKSSHDialog } from "@/ssh/dialogs/OPKSSHDialog";
export { HostKeyVerificationDialog } from "@/ssh/dialogs/HostKeyVerificationDialog";

// Terminal look: themes, fonts and clipboard, shared by every terminal-like
// surface (the SSH and local terminals, the docker console, serial).
export * from "@/lib/terminal-themes";
export { resolveTermixThemeColors } from "@/lib/terminal-look/terminal-theme";
export { ensureTerminalFontsLoaded } from "@/lib/terminal-look/terminal-global-styles";
export * from "@/lib/terminal-look/terminal-font-zoom";
export { copyToClipboard, readFromClipboard } from "@/lib/clipboard";
export { RobustClipboardProvider } from "@/lib/clipboard-provider";
export { useTheme as useAppTheme } from "@/components/theme-provider";

// Keyboard handling the shell shares with a terminal, so app shortcuts keep
// working while a terminal has focus.
export { findMatchingKeybinding } from "@/lib/keybinding-match";
export { globalShortcutHandler } from "@/lib/global-shortcut-handler";
export { isMacPlatform, isTabJumpHotkey } from "@/lib/tab-jump-hotkey";
export type * from "@/types/keybindings";

// Connection helpers: which backend a host's session dials, and the pieces
// the desktop app needs to reach it.
export { isElectron } from "@/lib/electron";
export {
  resolveConnectionOrigin,
  type ConnectionOrigin,
} from "@/lib/connection-origin";
export { pluginWsUrl } from "@/lib/plugin-transport";
export {
  buildOriginWsUrl,
  type WebSocketConnectionTarget,
} from "@/lib/connection-origin";
export { getBasePath } from "@/lib/base-path";
export type { ConnectionStage } from "@/types/connection-log";
export {
  hydrateLocalSharedHostAuth,
  resolveRemoteHostId,
} from "@/lib/remote-server-api";
export { useConnectionDefaults } from "@/contexts/ConnectionDefaultsContext";

// Core APIs a terminal-like surface calls: recent activity, the host's stored
// password for sudo autofill, the open tab record, the user's keybindings and
// host terminal options.
export { getCookie } from "@/main-axios";
export { logActivity } from "@/api/dashboard-api";
export { getHostPassword } from "@/api/credentials-api";
export {
  patchOpenTab,
  getUserPreferences,
  parseCustomKeybindings,
} from "@/api/open-tabs-api";
export { setHostAutoTmux } from "@/api/host-terminal-config-api";
