/**
 * @termix-ssh/plugin-sdk/ui: the shell's components, for plugins.
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
// For layouts: where tabs show, and the confirm a tab close asks with.
export { TabStage } from "@/shell/stage/TabStage";
export { ShellConfirmCapture } from "@/shell/controller/ShellControllerProvider";

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
// @termix-ssh/plugin-sdk/frontend instead.
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

// The panel kit every tab and sidebar panel is built from.
export {
  BackButton,
  Facts,
  GroupHeading,
  PANEL,
  PanelSearch,
  PanelShell,
  Segmented,
  ViewToggle,
  type PanelDensity,
  type PanelViewMode,
} from "@/components/panel-layout";
// A link to docs. Inside a plugin, page="setup" opens that page of its docs.
export { DocsLink, type DocsLinkProps } from "@/components/docs-link";
export {
  AddButton,
  FormFooter,
  ListBadge,
  ListRow,
  ListRowAction,
  ListRowFolder,
  PanelList,
  type ListRowTone,
} from "@/components/list-kit";
export {
  DataView,
  type DataColumn,
  type GridColumns,
} from "@/components/data-view";
export { TabStrip, type TabStripItem } from "@/components/tab-strip";
export { CardMasonry } from "@/components/card-masonry";
export { Meter, UsagePair } from "@/components/meter";
export { usageBarColor, usageColor } from "@/lib/usage-color";
export {
  Field,
  FieldPair,
  NumberField,
  Repeater,
  SecretField,
  SelectField,
  SwitchRow,
  TagInput,
  TextAreaField,
  TextField,
} from "@/components/form-fields";

// Views and questions drawn over the panel, tab or pane that asked, instead
// of modals over the whole app.
export {
  InlineView,
  PanePrompt,
  SurfaceScope,
  useConfirm,
  useSurfaceKind,
  type ConfirmOptions,
  type EditingWidth,
  type SurfaceKind,
} from "@/components/surface/surface-scope";
export {
  PROMPT_BUTTON,
  PROMPT_DESTRUCTIVE_BUTTON,
  PROMPT_PRIMARY_BUTTON,
} from "@/components/surface/prompt-styles";

// One connection lifecycle: connecting, failed with retry and a log, dropped,
// or unavailable.
export {
  ConnectionGate,
  useConnectionGate,
  type ConnectionGateController,
  type ConnectionGateProps,
} from "@/components/connection/ConnectionGate";
export { type ConnectionUnavailable } from "@/components/connection/ConnectionScreen";

// For shell-level plugins such as a layout: the API client, shared types and
// the shell's own state. These reach into core, so they may change with a core
// release. An ordinary plugin should not need them.
export { APP_VERSION } from "@/lib/app-version";
// The palette's own input has to share the Command it sits in, so cmdk is
// the shell's copy.
export { Command as CommandPrimitive } from "cmdk";
export {
  type AuthOverrideProtocol,
  SSH_AUTH_PROTOCOL,
} from "@/types/auth-protocols";
export {
  CREDENTIAL_ROW_FIELD_KEYS,
  type CredentialDensity,
  type CredentialRowFields,
  type CredentialSidebarFilterState,
  type CredentialSidebarPreferences,
  type CredentialSortKey,
  type CredentialTrayTrigger,
  defaultCredentialRowFields,
  defaultCredentialSidebarPreferences,
  sanitizeCredentialSidebarPreferences,
} from "@/types/credential-sidebar-preferences";
export {
  CORE_HOST_DEFAULTS,
  CORE_NAMESPACE,
  type DefaultOverrides,
  defaultValuesEqual,
  findCoreHostDefault,
  type HostDefaultsLevel,
  type ResolvedHostDefault,
  splitDefaultKey,
} from "@/types/host-defaults";
export {
  defaultHostRowFields,
  defaultHostSidebarPreferences,
  type HostClickBehavior,
  type HostDensity,
  type HostGroupKey,
  type HostRowFields,
  type HostSidebarFilterState,
  type HostSidebarPreferences,
  type HostTrayTrigger,
  sanitizeHostSidebarPreferences,
  type SortKey,
} from "@/types/host-sidebar-preferences";
export type {
  HostData,
  HostLock,
  HostProtocolAuthInput,
  ProxyNode,
  SSHHost,
  SSHHostData,
} from "@/types";
export {
  PRESETS,
  UI_AREA_KEYS,
  type UiAreaKey,
  type UiPreset,
} from "@/types/ui-preferences";
export type {
  AdminSection,
  Credential,
  DashboardCardId,
  FontSizeId,
  Host,
  HostFolder,
  SharePermissionLevel,
  Tab,
  TabType,
  ThemeId,
  ToolsTab,
  UiFontId,
} from "@/types/ui-types";
export {
  type AuditLog,
  type AuditLogFilters,
  getAuditLogActions,
  getAuditLogs,
} from "@/api/audit-log-api";
export {
  getUserSecondFactors,
  resetUserSecondFactors,
  type UserSecondFactorSummary,
} from "@/api/auth-methods-api";
export { getCredentials } from "@/api/credentials-api";
export {
  getFolderDefaultsId,
  getHostDefaultsLevel,
  type HostDefaultsChange,
  type HostDefaultsTarget,
  previewHostDefaultsLevel,
  resetHostToDefaults,
  resolveHostDefaults,
  saveHostDefaultsLevel,
  waitForDefaultsJob,
} from "@/api/host-defaults-api";
export { getHostTags, saveHostTags } from "@/api/host-tags-api";
export {
  getSessionTimeoutMinutes,
  getUserPreferences,
  parseCustomKeybindings,
  saveUserPreferences,
} from "@/api/open-tabs-api";
export {
  getDeveloperMode,
  getPluginAdminSettings,
  getPluginHostSettings,
  getPlugins,
  getPluginUserSettings,
  type PluginSettingsErrors,
  type PluginSettingsField,
  PluginSettingsValidationError,
  type PluginSummary,
  setAllPluginChannels,
  setDeveloperMode,
  setPluginOptions,
  updatePluginAdminSettings,
  updatePluginHostSettings,
  updatePluginUserSettings,
} from "@/api/plugins-api";
export {
  getNotificationPrivateEndpoints,
  setNotificationPrivateEndpoints,
} from "@/api/private-endpoints-api";
export {
  type CredentialPermissionLevel,
  type FolderAccessRule,
  getCredentialAccess,
  getFolderAccess,
  getRoles,
  revokeCredentialAccess,
  revokeFolderAccess,
  shareCredential,
  type ShareTarget,
} from "@/api/rbac-api";
export { type BrandingSettings, getBranding } from "@/api/settings-api";
export {
  getChannelReleases,
  getUpdateChannel,
  type ReleaseInfo,
  setUpdateChannel,
  type UpdateChannelState,
} from "@/api/system-status-api";
export {
  getTlsStatus,
  type TlsStatus,
  uploadTlsCertificate,
} from "@/api/tls-api";
export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/command";
export { usePluginDocsUrl } from "@/components/docs-link";
export {
  DEFAULT_FOLDER_COLOR,
  DEFAULT_FOLDER_ICON,
  FolderIconEl,
  HexColorPicker,
  IconPicker,
} from "@/components/folder-style";
export { useTheme } from "@/components/theme-provider";
export { VersionBadge } from "@/components/version-badge";
export { useBranding } from "@/contexts/BrandingContext";
export {
  useAreaPreferences,
  useUiPreference,
  useUiPreferencesContext,
} from "@/contexts/UiPreferencesContext";
export {
  getRegisteredDashboardCard,
  useRegisteredDashboardCards,
} from "@/dashboard/dashboard-cards-registry";
export { useActionSlot } from "@/hooks/use-action-slot";
export { useInstalledPlugins } from "@/hooks/use-installed-plugins";
export { usePageVisibleInterval } from "@/hooks/use-page-visible-interval";
export { usePermissions } from "@/hooks/use-permissions";
export {
  getStatusClasses,
  useStatusColorScheme,
} from "@/hooks/use-status-color-scheme";
export { useSshAuthProviders } from "@/hooks/useSshAuthProviders";
export { changeAppLanguage, normalizeLanguageCode } from "@/i18n/i18n";
export { LANGUAGES } from "@/i18n/languages";
export {
  getLiveHostStatus,
  useHostStatus,
  useServerStatus,
  useServerStatusMeta,
} from "@/lib/ServerStatusContext";
export { activityTarget } from "@/lib/activity-types";
export { applyPresetSideEffects } from "@/lib/apply-ui-preset";
export { getDatabaseTransferUrl } from "@/lib/database-transfer-url";
export {
  canConfigureUpdates,
  type DesktopUpdateMode,
  desktopUpdates,
  type DesktopUpdateState,
  useDesktopUpdate,
} from "@/lib/desktop-updates";
export { type DocsPage, docsUrl } from "@/lib/docs";
export { getErrorMessage } from "@/lib/error-message";
export {
  getDefaultConnectionTab,
  resolveHostTabType,
} from "@/lib/host-connection-tabs";
export {
  DefaultsOnly,
  HostDefaultsContext,
  type HostDefaultsContextValue,
  HostOnly,
} from "@/lib/host-defaults-context";
export {
  invalidateHostsAndStatusCaches,
  invalidateServerStatusCache,
} from "@/lib/hosts-request-cache";
export { reportBetaFeedbackUrl, reportCoreIssueUrl } from "@/lib/issue-url";
export { notifySyncChanged, useDesktopLinked } from "@/lib/linked-server";
export {
  clearLocalAdaptivePreferences,
  getPreferredHostAction,
  recordHostActionPreference,
} from "@/lib/local-adaptive-preferences";
export { pluginKey, pluginName } from "@/lib/plugin-i18n";
export { PluginIcon } from "@/lib/plugin-icon";
export { rem } from "@/lib/rem";
export { getConnectedRemoteApi } from "@/lib/remote-server-api";
export { roleLabel } from "@/lib/role-label";
export type { StatusValue } from "@/lib/server-status-store";
export { parseServerTime } from "@/lib/server-time";
export { tabJumpHotkeyKeys } from "@/lib/tab-jump-hotkey";
export {
  ACCENT_PRESET_COLORS,
  applyAccentColor,
  applyFontSize,
  applyUiFont,
  DASHBOARD_CARDS,
  FONT_SIZES,
  UI_FONTS,
} from "@/lib/theme";
export { registerLayout } from "@/look/layout-registry";
export { useChooseTheme } from "@/look/use-look-theme";
export {
  type AccessRecord,
  type ActiveSessionInfo,
  adminCreateUser,
  adminCreateUserCredential,
  adminCreateUserHost,
  adminDeleteUserCredential,
  adminDeleteUserHost,
  adminExportUserData,
  adminGetHostPassword,
  adminGetUserCredentials,
  adminGetUserHosts,
  adminResetUserPassword,
  adminUpdateUserCredential,
  adminUpdateUserHost,
  type ApiKey,
  assignRoleToUser,
  bulkUpdateSSHHosts,
  changePassword,
  createApiKey,
  createCredential,
  type CreatedApiKey,
  createRole,
  createSSHHost,
  deleteAccount,
  deleteAllHostsInFolder,
  deleteApiKey,
  deleteCredential,
  deleteOpenTab,
  deleteRole,
  deleteSSHHost,
  deleteUser,
  duplicateCredential,
  getActiveSessions,
  getApiKeys,
  getCredentialDetails,
  getCredentialSidebarPreferences,
  getExternalAutoProvision,
  getHostAccess,
  getHostAuthOverride,
  getHostPassword,
  getHostPolicy,
  type HostPolicy,
  getHostSidebarPreferences,
  getHttpsSettings,
  type HttpsSettings,
  getLogLevel,
  getPasswordLoginAllowed,
  getPasswordResetAllowed,
  getPermissionsCatalog,
  getRegistrationAllowed,
  getSecondFactorAfterExternalLogin,
  getSessions,
  getSessionTimeout,
  getSSHFolders,
  getSSHHosts,
  getStatusCheckSettings,
  getUserInfo,
  getUserList,
  getUserRoles,
  type LinkedAccountInfo,
  linkExternalToPasswordAccount,
  logoutUser,
  makeUserAdmin,
  type OpenTabRecord,
  type PermissionCatalogEntry,
  releaseUrlFrom,
  removeAdminStatus,
  removeRoleFromUser,
  renameCredentialFolder,
  renameFolder,
  reorderCredentials,
  reorderFolders,
  reorderSSHHosts,
  resetRecentActivity,
  revokeAllUserSessions,
  revokeHostAccess,
  revokeSession,
  type Role,
  saveCredentialSidebarPreferences,
  saveHostSidebarPreferences,
  setHostAuthOverride,
  shareFolder,
  shareHost,
  type SSHHostWithStatus,
  unlinkExternalFromPasswordAccount,
  updateCredential,
  updateExternalAutoProvision,
  updateFolderMetadata,
  updateHostAccess,
  updateHttpsSettings,
  updateLogLevel,
  updatePasswordLoginAllowed,
  updatePasswordResetAllowed,
  updateRegistrationAllowed,
  updateRole,
  updateSecondFactorAfterExternalLogin,
  updateSessionTimeout,
  updateSSHHost,
  updateStatusCheckSettings,
  type UserPreferences,
  type UserRole,
} from "@/main-axios";
export {
  MANAGE_REQUEST_EVENT,
  type ManageMode,
  type ManageRequest,
  requestFromLegacyEvent,
  requestManage,
  takePendingManageRequest,
} from "@/manage/manage-requests";
export { useSshAuthEditors } from "@/plugin-host/auth-registry";
export { usePluginStore } from "@/plugin-host/plugin-store";
export { shell } from "@/plugin-host/shell-bridge";
export { OPEN_PLUGINS_EVENT } from "@/plugins/open-plugins";
export { isPrerelease } from "@/plugins/plugin-model";
export { usePluginHostSections } from "@/settings/HostPluginSections";
export { SettingsFieldRow } from "@/settings/SettingsFields";
export { LookSettings } from "@/look/LookSettings";
export { useThemeOptions } from "@/settings/appearance/appearance-controls";
export {
  hasVisibleFields,
  isFieldShown,
} from "@/settings/settings-fields-util";
export { NativeView, type NativeViewProps } from "./NativeView";
export { useShellController } from "@/shell/controller/ShellControllerProvider";
export {
  type KeybindingActionDef,
  useKeybindingActions,
  useKeybindingDefaults,
} from "@/shell/keybinding-registry";
export {
  filterPaletteItems,
  loadPaletteGroup,
  paletteEntriesFor,
  type PaletteItemDef,
  usePaletteEntries,
  usePaletteGroups,
} from "@/shell/palette-registry";
export { getPanel, usePanels } from "@/shell/panel-registry";
export { SplitLayoutMenu } from "@/shell/split/SplitLayoutMenu";
export {
  beginSplitDrag,
  endSplitDrag,
  isSplitDragging,
  moveSplitDrag,
} from "@/shell/split/split-drag";
export {
  canJoinSplit,
  isSplitTab,
  type SplitSummary,
  type TabSplitAction,
} from "@/shell/split/split-tabs";
export {
  openInSplit,
  type SplitOpenTarget,
  useSplitTargets,
} from "@/shell/split/split-targets";
export { MAX_PANES } from "@/shell/split/split-tree";
export { registerTabCloseGuard } from "@/shell/tab-close-guards";
export { useTabHandlesVersion } from "@/shell/tab-handles";
export {
  getTabType,
  isPersistentTabType,
  isSessionTabType,
  type TabShellCallbacks,
} from "@/shell/tab-registry";
export {
  markTabSurfaceUsed,
  preloadTabSurface,
  tabIcon,
} from "@/shell/tabUtils";
export { AuthEnrollmentSections } from "@/sidebar/AuthEnrollmentSections";
export { mapCredentials, sshHostToHost } from "@/sidebar/HostManagerData";
export {
  getHostEditorSection,
  makeHostSshSubTabs,
  makeHostTabs,
  useHostEditorSections,
} from "@/sidebar/HostManagerTabs";
export {
  actionOrder,
  defaultConnectAction,
  type HostActionDef,
  hostActionsFor,
  hostBadgesFor,
  hostEditorToolbarItemsFor,
  hostMenuItemsFor,
  hostStatusIndicatorsFor,
  listHostActions,
  runHostAction,
  useHostActions,
  useHostBadges,
  useHostContextMenuItems,
  useHostEditorToolbarItems,
  useHostStatusIndicators,
} from "@/sidebar/host-contributions";
export { useEditorDefaultKeys } from "@/sidebar/host-defaults/catalog";
export {
  enabledHostProtocols,
  type HostProtocolDef,
  hostProtocolFlags,
  type HostProtocols,
  listHostProtocols,
  protocolEnabled,
  protocolPort,
  useHostProtocols,
  withProtocolSettings,
} from "@/sidebar/host-protocols";
export { quickConnectTargets } from "@/sidebar/quick-connect-host";
export {
  groupRailItems,
  isCoreRailView,
  moveRailItem,
  promotableIds,
  type RailGroup,
  type RailItemDef,
  railItemLabel,
  rightDockableIds,
  useRailItems,
} from "@/sidebar/rail-items";
