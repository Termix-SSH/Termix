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
 * a contract change. Removing from it breaks plugins.
 */

// Primitives
export { Alert, AlertDescription, AlertTitle } from "@/components/alert";
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/alert-dialog";
export { Badge } from "@/components/badge";
export { Button, type ButtonProps } from "@/components/button";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/card";
export { Checkbox } from "@/components/checkbox";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/dialog";
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
export { Input } from "@/components/input";
export { Label } from "@/components/label";
export { PasswordInput } from "@/components/password-input";
export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/popover";
export { ScrollArea, ScrollBar } from "@/components/scroll-area";
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
export { Select2 } from "@/components/select2";
export { Separator } from "@/components/separator";
export { Skeleton } from "@/components/skeleton";
export { Slider } from "@/components/slider";
export { Switch } from "@/components/switch";
export { Textarea, type TextareaProps } from "@/components/textarea";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/tooltip";

// Composites
export { FakeSwitch, SectionCard, SettingRow } from "@/components/section-card";
export { MetricCard } from "@/components/metric-card";
export {
  BarSeries,
  MiniStat,
  RadialGauge,
  Sparkline,
  StatRow,
  type BarSeriesItem,
  type BarSeriesProps,
  type RadialGaugeProps,
  type SparklineProps,
} from "@/components/charts";
export { LineChart, type LineChartSeries } from "@/components/charts/LineChart";
export {
  CardGridCanvas,
  ColumnCountStepper,
} from "@/components/card-grid/CardGridCanvas";
export {
  type GridCardCatalogEntry,
  type GridColSpan,
  type GridLayout,
  type GridSlot,
} from "@/components/card-grid/types";
export { ConnectionScreen } from "@/components/connection/ConnectionScreen";
export { type ConnectionStatus } from "@/components/connection/connection-status";
export {
  FullScreenAppWrapper,
  type FullScreenAppPhase,
} from "@/components/FullScreenAppWrapper";

// Connection surfaces
export {
  ConnectionLogProvider,
  useConnectionLog,
  useOptionalConnectionLog,
} from "@/ssh/connection-log/ConnectionLogContext";
export { TOTPDialog, type MFAPromptMode } from "@/ssh/dialogs/TOTPDialog";
export { SSHAuthDialog } from "@/ssh/dialogs/SSHAuthDialog";
export { BrowserSignInDialog } from "@/ssh/dialogs/BrowserSignInDialog";

// Design tokens: the colour swatches folders, workspaces and tags pick from.
export { FOLDER_COLORS } from "@/lib/theme";

// Shell context
export { useTabs, useTabsSafe } from "@/shell/TabContext";

// Slots: a plugin can offer places for other plugins to fill.
export { ActionSlot, ComponentSlot } from "@/shell/ActionSlot";

// A plugin's manifest host settings, drawn inside its own host editor section.
export {
  HostFeatureFields,
  type HostFeatureFieldsProps,
} from "@/settings/HostPluginSections";

// Host defaults in a host editor section: where a field's value comes from,
// and whether the section is editing a level of defaults rather than a host.
export {
  HostDefaultBadge,
  DefaultsOnly as HostDefaultField,
  useIsDefaultsEditor,
} from "@/lib/host-defaults-context";

// Components other plugins offer by id (app.registerComponent), rendered with
// a fallback while their plugin is off.
export { PluginComponent } from "@/plugin-host/component-registry";
export { PluginViewPlaceholder } from "@/plugin-host/PluginViewPlaceholder";

// More primitives and hooks.
export { cn } from "@/lib/utils";
export {
  runAdaptivePolling,
  getPollingEnvironmentMultiplier,
} from "@/lib/adaptive-polling";
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/sheet";
// The frame and filter box every host manager card uses.
export {
  ManagerCardShell,
  ManagerSearch,
  type ManagerCardError,
} from "@/components/manager-card";
export { useConfirmation } from "@/hooks/use-confirmation";
export { useAdaptivePolling } from "@/hooks/use-adaptive-polling";
// Homepage widget pieces, for plugins that register a widget.
export { WidgetTitle } from "@/lib/widget-title";
export { runVisibleInterval } from "@/lib/visible-interval";
export { useIsMobile } from "@/hooks/use-mobile";
export { EmptyState } from "@/components/empty-state";
export { PassphraseDialog } from "@/ssh/dialogs/PassphraseDialog";
export { HostKeyVerificationDialog } from "@/ssh/dialogs/HostKeyVerificationDialog";

// Clipboard helpers and the app theme, shared by every terminal-like surface.
// The terminal look itself (themes, fonts, the preview) is the ssh-terminal
// plugin's, offered through its "terminal.*" actions and components.
export { copyToClipboard, readFromClipboard } from "@/lib/clipboard";
export { RobustClipboardProvider } from "@/lib/clipboard-provider";
export { useTheme as useAppTheme } from "@/components/theme-provider";

// Keyboard handling the shell shares with a terminal, so app shortcuts keep
// working while a terminal has focus.
export { findMatchingKeybinding } from "@/lib/keybinding-match";
export { globalShortcutHandler } from "@/lib/global-shortcut-handler";
export { isMacPlatform, isTabJumpHotkey } from "@/lib/tab-jump-hotkey";
export {
  type CustomKeybinding,
  type KeyCombo,
  type KeybindingAction,
  type KeybindingActionType,
} from "@/types/keybindings";

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
export { remoteServerUrl as linkedServerUrl } from "@/plugin-host/desktop";

// Dashboard reads. The calls a plugin makes on the user's behalf (recent
// activity, sudo autofill, open tabs, keybindings) are typed in
// @termix/plugin-sdk/frontend instead.
export {
  getRecentActivity,
  getUptime,
  type RecentActivityItem,
  type UptimeInfo,
} from "@/api/dashboard-api";
export {
  getVersionInfo,
  getDatabaseHealth,
  type VersionInfo,
} from "@/api/system-status-api";

// Keyboard hints, the connection log panel and a named console logger.
export { Kbd, KbdKey, KbdSeparator } from "@/components/kbd";
export { ConnectionLogPanel } from "@/components/connection/ConnectionLogPanel";
export type { LogEntry } from "@/types/connection-log";
export { createFrontendLogger, type LogContext } from "@/lib/frontend-logger";

// One budget for background work across the whole app (preloads, prefetches).
export {
  getAdaptiveResourceBudget,
  markAdaptiveResourceUsed,
  runAdaptiveBackgroundTask,
} from "@/lib/adaptive-resource-budget";

// The id this browser sends as X-Termix-Device-ID.
export { getDeviceId } from "@/lib/device-id";

// A host that is never saved, for connecting to an address straight away.
export { createQuickConnectHost } from "@/sidebar/quick-connect-host";
