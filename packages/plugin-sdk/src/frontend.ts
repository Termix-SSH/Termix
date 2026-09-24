/**
 * The frontend contract: what a plugin's frontend entry receives, and the
 * hooks its components use.
 *
 * A plugin frontend is `src/frontend/index.tsx` exporting `activate(app)` and
 * optionally `deactivate()`. Everything it contributes goes through `app`, and
 * everything registered there is removed when the plugin is disabled, without
 * a page reload.
 *
 * This module has no runtime dependencies. The hooks delegate to a host that
 * core installs at startup (`__setPluginHost`), because React, i18next and the
 * shell's state all live in core and must be one instance across the shell
 * and every plugin bundle.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode, Ref } from "react";
import type { PluginManifest } from "./manifest.js";

export type Disposer = () => void;

/** A Lucide icon or anything with the same props. */
export type IconComponent = ComponentType<{
  className?: string;
  size?: number | string;
  strokeWidth?: number | string;
}>;

/**
 * A host as the shell holds it. Only the identifying fields are typed; the
 * rest of the record is passed through as the shell has it, so a plugin
 * that needs a feature column reads it by name.
 */
export interface PluginHostRecord {
  id: string;
  name: string;
  ip: string;
  port: number;
  username?: string;
  folder?: string;
  tags?: string[];
  [key: string]: unknown;
}

/** An open tab as the shell holds it. `data` is the plugin's own payload. */
export interface PluginTabRecord {
  id: string;
  type: string;
  label: string;
  host?: PluginHostRecord;
  data?: Record<string, unknown>;
  /** Stable across restores, for a session tab to reattach by. */
  instanceId?: string;
  /** A backend session a session tab should reattach to. */
  restoredSessionId?: string | null;
  /** A live shared session this tab joins instead of connecting its own. */
  joinSharedSessionId?: string | null;
  joinShareId?: string | null;
  [key: string]: unknown;
}

export interface OpenTabOptions {
  label?: string;
  /** Open a second tab even when one for this host and type exists. */
  forceNewTab?: boolean;
  /** Plugin payload, stored on the tab and restored with it. */
  data?: Record<string, unknown>;
}

/** A saved arrangement of tabs, used by workspaces. Opaque to plugins. */
export interface ShellLayout {
  version: number;
  [key: string]: unknown;
}

/** What a plugin may ask of the shell. */
export interface ShellApi {
  openTab: (
    host: PluginHostRecord | null,
    type: string,
    options?: OpenTabOptions,
  ) => void;
  openSingletonTab: (type: string, options?: OpenTabOptions) => void;
  closeTab: (tabId: string) => void;
  renameTab: (tabId: string, label: string) => void;
  /** Saves a quick-connect tab's host as a real host. Absent in some shells. */
  saveQuickConnect?: (
    tab: PluginTabRecord,
    host: PluginHostRecord,
  ) => Promise<void>;
  /** Opens a rail view in the left sidebar. */
  openRailView: (id: string) => void;
  /** Closes a rail view wherever it is shown. */
  closeRailView: (id: string) => void;
}

export interface TabsApi extends Pick<
  ShellApi,
  "openTab" | "openSingletonTab" | "closeTab"
> {
  /** The current tabs and split layout, or null before the shell mounts. */
  getLayout: () => ShellLayout | null;
  /**
   * Replaces the open tabs with a saved layout. `name` labels a restored
   * split. Resolves with the tabs that could not be reopened, e.g. because
   * their host was deleted.
   */
  applyLayout: (
    layout: ShellLayout,
    options?: { name?: string },
  ) => Promise<{ skipped: string[] }>;
  /** Called whenever tabs open, close or move. */
  onChange: (listener: () => void) => Disposer;
  /** Called once the shell has restored its tabs after login. */
  onReady: (listener: () => void) => Disposer;
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

export interface RailItemContribution {
  /** Must be declared in manifest contributes.tabs or contributes.panels. */
  id: string;
  icon: IconComponent;
  titleKey: string;
  /** "panel" opens the left sidebar, "tab" opens a tab. Default "panel". */
  kind?: "panel" | "tab";
  /** Users may hide it from Appearance > Sidebar > Navigation. Default true. */
  hideable?: boolean;
  /** Can also open as a full-width tab. */
  promotable?: boolean;
  /** Can open in the right dock. */
  rightDockable?: boolean;
  /** Shown on the mobile bar's primary row. */
  mobilePrimary?: boolean;
  /** Desktop app only. */
  electronOnly?: boolean;
  separatorAfter?: boolean;
  /** Hidden without being unregistered, e.g. while a feature is switched off. */
  hidden?: boolean;
  /**
   * A permission the user needs to see the item at all, usually one of the
   * plugin's own short names. The rail, the mobile bar, the palette and the
   * Navigation toggles all leave it out otherwise.
   */
  permission?: string;
  /** Place it after this rail id rather than at the end. */
  after?: string;
  /** Lower sorts first among plugin items. */
  order?: number;
}

export interface PanelProps {
  /**
   * The command-target tab (see TabOptions.commandTarget) the user is working
   * in: the active one, else the one focused last. For panels that act on it.
   */
  targetTab?: PluginTabRecord;
  /** Whether the panel is the one currently shown. */
  active: boolean;
  shell: ShellApi;
  /** Tells the shell the panel is editing, which widens the sidebar. */
  setEditing: (editing: boolean) => void;
  /** Type of the focused tab, if any. */
  activeTabType?: string;
  /** Where the panel is rendered. */
  placement: "left" | "right" | "tab";
}

export interface PanelOptions {
  /** Keep the panel mounted after the user switches away. */
  keepMounted?: boolean;
}

/**
 * What a session tab hands the shell through `handleRef`, so split view, tab
 * close and reconnect-all can drive it without knowing what kind it is.
 */
export interface TabHandle {
  focus?: () => void;
  fit?: () => void;
  reconnect?: () => void;
  disconnect?: () => void;
  isConnected?: () => boolean;
  sendInput?: (data: string) => void;
  paste?: (text: string) => void;
  refresh?: () => void;
  notifyResize?: () => void;
  /** A tab that shows its own share dialog. */
  canShare?: () => boolean;
  openShareModal?: () => void;
  /** A tab whose session the shell's share dialog can share. */
  getShareTarget?: () => {
    hostId: number;
    sessionId: string;
    protocol: "ssh";
    tabInstanceId?: string;
  } | null;
  [key: string]: unknown;
}

export interface TabProps {
  tab: PluginTabRecord;
  host?: PluginHostRecord;
  /** The host in the shape the connection APIs take. */
  sshHost?: Record<string, unknown>;
  label: string;
  isVisible: boolean;
  isFocusedPane: boolean;
  /** Forward to a component exposing `refresh()` or `disconnect()`. */
  handleRef: Ref<unknown>;
  shell: ShellApi;
}

export interface StandaloneViewProps {
  hostId?: string;
  view: string;
  params: URLSearchParams;
}

export interface TabOptions {
  icon?: IconComponent;
  /** Label for singleton tabs and anywhere the type is named. */
  titleKey?: string;
  /** Needs a host; renders `noHostMessageKey` without one. */
  requiresHost?: boolean;
  noHostMessageKey?: string;
  /** Reopened after login. */
  persistent?: boolean;
  /** One tab of this type at a time, keyed by type. */
  singleton?: boolean;
  /** A live session: asks before closing and can be refreshed. */
  session?: boolean;
  /** Restorable without a host. */
  hostless?: boolean;
  /** Decides whether a saved tab for this host may be restored. */
  restore?: (host: PluginHostRecord) => boolean;
  /** Recent-activity types that open this tab. */
  activityTypes?: string[];
  /** Rendered for `?view=<type>` full-screen links. */
  standalone?: ComponentType<StandaloneViewProps>;
  /** Extra `?view=` names that also open `standalone`. */
  standaloneViews?: string[];
  /** Wrap in the readable-width frame used by panels opened as tabs. */
  panelFrame?: boolean;
  /** False keeps the tab out of saved layouts and workspaces. Default true. */
  inLayouts?: boolean;
  /**
   * Its session takes typed commands: the history, macros and SSH tools
   * panels act on the one focused last.
   */
  commandTarget?: boolean;
  /** Paints its own background, so the shell leaves its frame transparent. */
  ownBackground?: boolean;
  /** Every open is a new tab, labelled "<title> (2)" and so on. */
  multiInstance?: boolean;
  /** Warms the tab's code before it is opened. */
  preload?: () => Promise<unknown>;
}

export interface HostEditorSectionProps {
  // The editor form is a plain object; a section reads the fields it owns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  setField: (key: string, value: unknown) => void;
  /** Sets several fields at once, computed from the latest form. */
  updateForm: (
    patch: (form: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
  host?: PluginHostRecord;
  credentials?: unknown[];
  snippets?: unknown[];
  /** Which connection protocols are switched on for this host. */
  protocols: Record<string, boolean>;
}

export interface HostEditorSectionContribution {
  id: string;
  /** "top" sits in the main tab strip, "ssh" under the SSH group. */
  group: "top" | "ssh";
  titleKey: string;
  icon?: IconComponent;
  /**
   * Position among the group's tabs, core ones included. Top: General 0,
   * SSH 10. SSH group: General 0, Terminal 10, Tunnels 20, Files 60.
   */
  order?: number;
  /** Whether to offer the tab, from the host's enabled protocols. */
  visible?: (protocols: Record<string, boolean>) => boolean;
  component: ComponentType<HostEditorSectionProps>;
}

export interface HostActionContribution {
  id: string;
  titleKey: string;
  icon: IconComponent;
  /**
   * "connect" is a way to open a session (terminal, RDP) and is offered as a
   * host's default action by priority. "open" opens a tool for the host.
   */
  kind: "connect" | "open";
  /** Higher wins when choosing a host's default connect action. */
  priority?: number;
  /** Opened with shell.openTab when `run` is absent. */
  tabType?: string;
  when: (host: PluginHostRecord) => boolean;
  run?: (host: PluginHostRecord, shell: ShellApi) => void;
  /** Shows a quick button on the host row. Default true. */
  tray?: boolean;
  /** `?view=` name for "Copy link". */
  copyUrlView?: string;
  /** Where a host overview (the dashboard's host status list) sends a click. */
  overview?: boolean;
  /**
   * Position in the host row. Core: Files 20, Tunnel 40, Tmux 70. Connect
   * actions default to 100 and sit after a separator.
   */
  order?: number;
  /** A label worked out per host, e.g. a single endpoint's name. */
  label?: (host: PluginHostRecord) => string | undefined;
  /** Several targets: two or more become a picker, one runs directly. */
  items?: (host: PluginHostRecord) => {
    id: string;
    label: string;
    run: (host: PluginHostRecord, shell: ShellApi) => void;
  }[];
}

export interface HostBadgeContribution {
  id: string;
  when: (host: PluginHostRecord) => boolean;
  component: ComponentType<{ host: PluginHostRecord }>;
}

export interface HostContextMenuItemContribution {
  id: string;
  titleKey: string;
  icon?: IconComponent;
  when: (host: PluginHostRecord) => boolean;
  run: (host: PluginHostRecord, shell: ShellApi) => void;
}

export interface PaletteEntryContribution {
  id: string;
  titleKey: string;
  icon?: IconComponent;
  keywords?: string[];
  /** "global" entries stand alone, "host" entries appear under a host. */
  scope: "global" | "host";
  when?: (host?: PluginHostRecord) => boolean;
  run: (shell: ShellApi, host?: PluginHostRecord) => void;
}

export interface DashboardCardProps {
  isVisible: boolean;
  shell: ShellApi;
}

export interface DashboardCardContribution {
  /** Must be declared in manifest contributes.dashboardCards. */
  id: string;
  titleKey: string;
  defaultHeight?: number;
  component: ComponentType<DashboardCardProps>;
}

export interface HomepageWidgetContribution<C = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  category: "links" | "info" | "system" | "monitoring";
  icon: ReactNode;
  defaultConfig: C;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editFormComponent?: ComponentType<any>;
}

export interface SettingsComponentProps {
  pluginId: string;
  values: Record<string, unknown>;
  setValue: (key: string, value: unknown) => void;
  running: boolean;
}

export type ActionHandler = (...args: never[]) => unknown;

export interface ActionSlotDefinition {
  id: string;
  /** Contribution kinds the slot renders: "button", "component". */
  accepts: string[];
}

export interface SlotContribution {
  actionId: string;
  titleKey: string;
  /** Secondary text, for slots that show one (onboarding cards). */
  descriptionKey?: string;
  icon?: IconComponent;
  kind?: "button" | "component" | string;
  /** For kind "component". Receives the slot owner's props. */
  component?: ComponentType<Record<string, unknown>>;
  /** Extra condition on top of the action's permission. */
  when?: (context: Record<string, unknown>) => boolean;
  order?: number;
}

export interface SshAuthEditorProps {
  form: Record<string, unknown>;
  setField: (key: string, value: unknown) => void;
}

export interface SshAuthEditorContribution {
  /** The value stored in the host's authType. */
  authType: string;
  titleKey: string;
  hintKey?: string;
  component?: ComponentType<SshAuthEditorProps>;
}

/** What the login screen hands a login method's UI. */
export interface LoginMethodUIProps {
  methodId: string;
  /** Enabled instances from the server, e.g. one per SSO provider. */
  instances: Array<{ id: string; label: string }>;
  rememberMe: boolean;
  disabled: boolean;
  /** What the user typed in the username field, when there is one. */
  username?: string;
  /**
   * Form methods: posts the body to the method's verify endpoint, then the
   * login screen finishes the login or shows the second-factor step.
   */
  submit: (body: Record<string, unknown>, instanceId?: string) => Promise<void>;
  /** Redirect methods: sends the browser (or the system browser) away. */
  startRedirect: (instanceId?: string) => Promise<void>;
  /** Hands a login response from a request the UI made itself. */
  complete: (response: Record<string, unknown>) => Promise<void>;
}

/**
 * A button or form on the login screen. `id` matches the login method the
 * backend registered with ctx.auth.registerLoginMethod; the screen shows it
 * only while the server reports that method as enabled.
 */
export interface LoginMethodContribution {
  id: string;
  titleKey: string;
  icon?: IconComponent;
  component: ComponentType<LoginMethodUIProps>;
}

/** What the second-factor step hands a factor's UI. */
export interface SecondFactorUIProps {
  factorId: string;
  rememberMe: boolean;
  disabled: boolean;
  /** Sends the user's answer; the login screen finishes or shows the error. */
  verify: (body: Record<string, unknown>) => Promise<void>;
  /** Whatever the backend factor's challenge() returns. */
  challenge: () => Promise<unknown>;
  cancel: () => void;
}

export interface SecondFactorContribution {
  /** Matches the id the backend registered with ctx.auth.registerSecondFactor. */
  id: string;
  titleKey: string;
  /** The challenge shown after the first login step. */
  component: ComponentType<SecondFactorUIProps>;
  /** Enrolment, shown in Settings > Security. */
  enrollment?: ComponentType<Record<string, unknown>>;
}

/** The subset of axios a plugin uses, rooted at /plugin-api/<id>/. */
export interface PluginApiClient {
  get<T = unknown>(url: string, config?: unknown): Promise<{ data: T }>;
  delete<T = unknown>(url: string, config?: unknown): Promise<{ data: T }>;
  post<T = unknown>(
    url: string,
    body?: unknown,
    config?: unknown,
  ): Promise<{ data: T }>;
  put<T = unknown>(
    url: string,
    body?: unknown,
    config?: unknown,
  ): Promise<{ data: T }>;
  patch<T = unknown>(
    url: string,
    body?: unknown,
    config?: unknown,
  ): Promise<{ data: T }>;
}

export interface PluginWsTarget {
  url: string;
  protocols?: string[];
}

export interface TermixAppInfo {
  readonly pluginId: string;
  readonly manifest: PluginManifest;
}

/**
 * Registration surface for a plugin frontend. Every `register*` returns a
 * disposer, and anything not disposed by hand is disposed when the plugin is
 * disabled.
 */
export interface TermixApp extends TermixAppInfo {
  /**
   * True on anonymous guest pages (a shared-session link). Only plugins with
   * contributes.guest run there, and they should register just what a guest
   * sees: there is no user, so API calls needing a login will fail.
   */
  readonly guest: boolean;
  registerRailItem: (item: RailItemContribution) => Disposer;
  registerPanel: (
    id: string,
    component: ComponentType<PanelProps>,
    options?: PanelOptions,
  ) => Disposer;
  registerTab: (
    type: string,
    component: ComponentType<TabProps>,
    options?: TabOptions,
  ) => Disposer;
  registerHostEditorSection: (
    section: HostEditorSectionContribution,
  ) => Disposer;
  registerHostAction: (action: HostActionContribution) => Disposer;
  registerHostBadge: (badge: HostBadgeContribution) => Disposer;
  registerHostContextMenuItem: (
    item: HostContextMenuItemContribution,
  ) => Disposer;
  registerPaletteEntry: (entry: PaletteEntryContribution) => Disposer;
  registerDashboardCard: (card: DashboardCardContribution) => Disposer;
  registerHomepageWidget: (widget: HomepageWidgetContribution) => Disposer;
  registerSettingsComponent: (
    componentId: string,
    component: ComponentType<SettingsComponentProps>,
  ) => Disposer;
  registerAction: (
    id: string,
    handler: ActionHandler,
    options?: { permission?: string },
  ) => Disposer;
  declareActionSlot: (slot: ActionSlotDefinition) => Disposer;
  registerSlotContribution: (
    slotId: string,
    contribution: SlotContribution,
  ) => Disposer;
  invokeAction: (id: string, ...args: unknown[]) => Promise<unknown>;
  /**
   * Offers a component to other plugins and to core by id, rendered where
   * they choose with `PluginComponent` from @termix/plugin-sdk/ui or
   * `usePluginComponent`. The id should start with a name the plugin owns
   * ("terminal.view"). The props are the owner's contract; document them.
   */
  registerComponent: (
    id: string,
    component: ComponentType<Record<string, unknown>>,
  ) => Disposer;
  registerSshAuthEditor: (editor: SshAuthEditorContribution) => Disposer;
  registerLoginMethod: (method: LoginMethodContribution) => Disposer;
  registerSecondFactorUI: (factor: SecondFactorContribution) => Disposer;

  /**
   * Translates a key from the plugin's own locales, for code outside a
   * component (a toast from activate). Components use useTranslation().
   */
  t: TranslateFn;
  /**
   * Whether the current user holds a permission, for code outside a
   * component. A short name resolves to <id>.<name>, as usePermission does.
   * Resolves false before sign-in and when the lookup fails.
   */
  hasPermission: (permission: string) => Promise<boolean>;

  /** HTTP client for this plugin's /plugin-api/<id>/ routes. */
  api: PluginApiClient;
  /** WebSocket URL and auth subprotocols for /plugin-ws/<id>/<path>. */
  wsUrl: (
    path: string,
    options?: { origin?: unknown },
  ) => Promise<PluginWsTarget | null>;
  tabs: TabsApi;
  /** Registered cleanup, run when the plugin is disabled. */
  onDispose: (dispose: Disposer) => void;
}

export type FrontendActivate = (app: TermixApp) => void | Promise<void>;

export interface FrontendModule {
  activate: FrontendActivate;
  deactivate?: () => void | Promise<void>;
}

export function definePluginFrontend(plugin: FrontendModule): FrontendModule {
  return plugin;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export type TranslateFn = (
  key: string,
  options?: Record<string, unknown> | string,
) => string;

export interface CurrentUser {
  userId: string;
  username: string;
  isAdmin: boolean;
}

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

export type SettingsScope = "admin" | "user" | "host";

export interface SettingsState {
  values: Record<string, unknown>;
  loaded: boolean;
  save: (values: Record<string, unknown>) => Promise<void>;
}

/** An SSH auth type the server can connect with. */
export interface SshAuthTypeInfo {
  type: string;
  /** Core translation key, or the plugin editor's title. */
  labelKey: string;
  pluginId: string;
  /** Also offered as a stored credential type. */
  credentialType: boolean;
  /** Can connect unattended, for polling. */
  supportsBackground: boolean;
}

/**
 * What core implements behind the hooks. Internal: a plugin never calls this.
 */
export interface PluginHostBridge {
  usePluginId: () => string;
  useTranslation: (pluginId: string) => {
    t: TranslateFn;
    language: string;
  };
  usePermission: (pluginId: string, permission: string) => boolean;
  useSettings: (
    pluginId: string,
    scope: SettingsScope,
    hostId?: number | string,
  ) => SettingsState;
  useHost: (hostId: string | number | undefined) => PluginHostRecord | null;
  useHosts: () => { hosts: PluginHostRecord[]; loaded: boolean };
  useCurrentUser: () => CurrentUser | null;
  useTheme: () => { theme: "light" | "dark" };
  toast: ToastApi;
  getApi: (pluginId: string) => PluginApiClient;
  useTabs: () => TabsApi;
  invokeAction: (id: string, ...args: unknown[]) => Promise<unknown>;
  useSshAuthTypes: () => { types: SshAuthTypeInfo[]; loaded: boolean };
  useSlotContributions: (
    slotId: string,
    context?: Record<string, unknown>,
  ) => SlotContribution[];
  usePluginComponent: (
    id: string,
  ) => ComponentType<Record<string, unknown>> | undefined;
}

let host: PluginHostBridge | null = null;

/** Called once by core. Not part of the plugin API. */
export function __setPluginHost(bridge: PluginHostBridge | null): void {
  host = bridge;
}

/**
 * Set by the shared test setup, so a plugin component rendered on its own in a
 * unit test still has hooks. A global rather than an import, because the test
 * setup and the component can load different copies of this module.
 */
const TEST_HOST_KEY = "__termixTestPluginHost";

function requireHost(): PluginHostBridge {
  const fallback = (globalThis as Record<string, unknown>)[TEST_HOST_KEY] as
    PluginHostBridge | undefined;
  if (!host && fallback) return fallback;
  if (!host) {
    throw new Error(
      "@termix/plugin-sdk/frontend: no plugin host. Hooks only work inside Termix or renderWithApp().",
    );
  }
  return host;
}

/** The id of the plugin that registered the component being rendered. */
export function usePluginId(): string {
  return requireHost().usePluginId();
}

/**
 * Translation bound to this plugin's namespace. Keys the plugin does not
 * define fall back to core's shared strings (common.*, hosts.*).
 */
export function useTranslation(): { t: TranslateFn; language: string } {
  const bridge = requireHost();
  return bridge.useTranslation(bridge.usePluginId());
}

/**
 * Whether the current user holds a permission. A short name resolves to this
 * plugin's own namespace, a dotted id is taken as given. UI only: the backend
 * route checks again.
 */
export function usePermission(permission: string): boolean {
  const bridge = requireHost();
  return bridge.usePermission(bridge.usePluginId(), permission);
}

export function useSettings(
  scope: SettingsScope,
  hostId?: number | string,
): SettingsState {
  const bridge = requireHost();
  return bridge.useSettings(bridge.usePluginId(), scope, hostId);
}

export function useHost(
  hostId: string | number | undefined,
): PluginHostRecord | null {
  return requireHost().useHost(hostId);
}

export function useHosts(): { hosts: PluginHostRecord[]; loaded: boolean } {
  return requireHost().useHosts();
}

export function useCurrentUser(): CurrentUser | null {
  return requireHost().useCurrentUser();
}

export function useTheme(): { theme: "light" | "dark" } {
  return requireHost().useTheme();
}

export function useToast(): ToastApi {
  return requireHost().toast;
}

export function usePluginApi(): PluginApiClient {
  const bridge = requireHost();
  return bridge.getApi(bridge.usePluginId());
}

export function useTabs(): TabsApi {
  return requireHost().useTabs();
}

/**
 * The SSH auth types this server can connect with, core's and every enabled
 * plugin's, for pickers such as a default auth type.
 */
export function useSshAuthTypes(): {
  types: SshAuthTypeInfo[];
  loaded: boolean;
} {
  return requireHost().useSshAuthTypes();
}

/**
 * The visible contributions to a slot another plugin owns, with their
 * metadata (id, titleKey, component). For an owner that needs to build a
 * catalog from what was contributed rather than just render it in place, e.g.
 * host-metrics listing manager cards plugins added to "host-metrics.managers"
 * next to its own. Same permission and `when` filtering as ComponentSlot;
 * `context` is what each contribution's `when` sees.
 */
export function useSlotContributions(
  slotId: string,
  context?: Record<string, unknown>,
): SlotContribution[] {
  return requireHost().useSlotContributions(slotId, context);
}

/**
 * The component another plugin registered under `id` with
 * app.registerComponent, or undefined while that plugin is off.
 */
export function usePluginComponent(
  id: string,
): ComponentType<Record<string, unknown>> | undefined {
  return requireHost().usePluginComponent(id);
}

/**
 * Runs an action another plugin registered, from anywhere in a plugin's code.
 * Resolves undefined when nobody registered it, so an optional dependency
 * that is switched off reads as "nothing there".
 */
export function invokeAction(id: string, ...args: unknown[]): Promise<unknown> {
  return requireHost().invokeAction(id, ...args);
}

// ---------------------------------------------------------------------------
// Connection retry
// ---------------------------------------------------------------------------

export type ConnectionRetryStatus =
  "connecting" | "connected" | "error" | "disconnected";

export interface UseConnectionRetryOptions {
  connect: () => void | Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  enabled?: boolean;
  autoStart?: boolean;
}

export interface UseConnectionRetryResult {
  status: ConnectionRetryStatus;
  attempt: number;
  maxAttempts: number;
  nextRetryInMs: number | null;
  markConnected: () => void;
  markFailed: () => void;
  retryNow: () => void;
  reset: () => void;
}

const COUNTDOWN_TICK_MS = 250;
const RETRY_JITTER_RATIO = 0.1;

export function computeReconnectDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random = Math.random,
): number {
  const base = Math.min(
    baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)),
    maxDelayMs,
  );
  const jitter = base * RETRY_JITTER_RATIO * (random() * 2 - 1);
  return Math.max(baseDelayMs, Math.min(maxDelayMs, Math.round(base + jitter)));
}

/**
 * Exponential-backoff reconnect with jitter, for a plugin's own connect flow
 * (docker's console, host-metrics polling, remote desktop tokens, the file
 * manager). Promoted here once a fourth plugin needed its own copy of the
 * same hook.
 */
export function useConnectionRetry({
  connect,
  maxAttempts = 8,
  baseDelayMs = 2000,
  maxDelayMs = 8000,
  enabled = true,
  autoStart = true,
}: UseConnectionRetryOptions): UseConnectionRetryResult {
  const [status, setStatus] = useState<ConnectionRetryStatus>("connecting");
  const [attempt, setAttempt] = useState(0);
  const [nextRetryInMs, setNextRetryInMs] = useState<number | null>(null);

  const connectRef = useRef(connect);
  connectRef.current = connect;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const attemptRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const isMountedRef = useRef(true);
  const markFailedRef = useRef<() => void>(() => {});

  const clearTimers = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const runConnect = useCallback(() => {
    if (!isMountedRef.current) return;
    setStatus("connecting");
    try {
      void Promise.resolve(connectRef.current()).catch(() => {
        markFailedRef.current();
      });
    } catch {
      markFailedRef.current();
    }
  }, []);

  const scheduleRetry = useCallback(() => {
    if (attemptRef.current >= maxAttempts) {
      setStatus("disconnected");
      setNextRetryInMs(null);
      return;
    }

    attemptRef.current += 1;
    setAttempt(attemptRef.current);

    const delay = computeReconnectDelay(
      attemptRef.current,
      baseDelayMs,
      maxDelayMs,
    );

    let remaining = delay;
    setNextRetryInMs(remaining);
    countdownIntervalRef.current = setInterval(() => {
      remaining = Math.max(0, remaining - COUNTDOWN_TICK_MS);
      setNextRetryInMs(remaining);
    }, COUNTDOWN_TICK_MS);

    retryTimeoutRef.current = setTimeout(() => {
      clearTimers();
      if (!isMountedRef.current || !enabledRef.current) return;
      runConnect();
    }, delay);
  }, [baseDelayMs, maxDelayMs, maxAttempts, clearTimers, runConnect]);

  const markConnected = useCallback(() => {
    clearTimers();
    attemptRef.current = 0;
    setAttempt(0);
    setNextRetryInMs(null);
    if (isMountedRef.current) setStatus("connected");
  }, [clearTimers]);

  const markFailed = useCallback(() => {
    clearTimers();
    if (!isMountedRef.current) return;
    setStatus("error");
    if (enabledRef.current) {
      scheduleRetry();
    } else {
      setNextRetryInMs(null);
    }
  }, [clearTimers, scheduleRetry]);
  markFailedRef.current = markFailed;

  const retryNow = useCallback(() => {
    clearTimers();
    attemptRef.current = 0;
    setAttempt(0);
    setNextRetryInMs(null);
    runConnect();
  }, [clearTimers, runConnect]);

  const reset = useCallback(() => {
    clearTimers();
    attemptRef.current = 0;
    setAttempt(0);
    setNextRetryInMs(null);
    if (isMountedRef.current) setStatus("connecting");
  }, [clearTimers]);

  useEffect(() => {
    isMountedRef.current = true;
    if (autoStart) {
      runConnect();
    }
    return () => {
      isMountedRef.current = false;
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (enabled && status === "error" && !retryTimeoutRef.current) {
      scheduleRetry();
    }
    if (!enabled) {
      clearTimers();
      setNextRetryInMs(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    status,
    attempt,
    maxAttempts,
    nextRetryInMs,
    markConnected,
    markFailed,
    retryNow,
    reset,
  };
}

export type { PluginManifest } from "./manifest.js";
export type { ReactNode };
