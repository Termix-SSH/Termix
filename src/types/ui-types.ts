import type {
  HostProtocolAuthSummary,
  HostSshOptions,
  HostTerminalConfig,
  SSHAuthType,
} from "./index.js";
import type { HostAuthOverrides } from "./auth-protocols.js";
import type { DefaultOverrides } from "./host-defaults.js";
import type { QuickConnectLogin } from "@termix/plugin-sdk/frontend";

export type Host = {
  id: string;
  name: string;
  username: string;
  ip: string;
  port: number;
  folder: string;
  /** Sub-host nesting: the id of the host this one is organized under, if any. */
  parentHostId?: string | null;
  /**
   * Sub-hosts nested under this host, populated client-side by buildHostTree.
   * A host with children still renders and behaves as a normal, connectable
   * HostItem row -- this only adds an expand/collapse chevron for its nested
   * children, it never wraps the host in a synthetic folder node.
   */
  childHosts?: Host[];
  online: boolean;
  status?: "online" | "reachable" | "offline" | "unknown";
  cpu: number | null;
  ram: number | null;
  lastAccess: string;
  tags?: string[];
  authType: SSHAuthType;
  shareSshAuth?: boolean;
  credentialId?: string;
  overrideCredentialUsername?: boolean;
  password?: string;
  hasPassword?: boolean;
  sudoPassword?: string;
  hasSudoPassword?: boolean;
  hasKey?: boolean;
  hasKeyPassword?: boolean;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  notes?: string;
  pin?: boolean;
  /** Quick connect only: core can save this host as-is. */
  quickConnectSavable?: boolean;
  /** A Quick Connect host's plugin protocol login, never saved. */
  quickConnectLogin?: QuickConnectLogin;
  sortOrder?: number | null;

  /** Stable identity across a desktop/server sync pair. */
  syncId?: string | null;
  terminalConfig?: HostTerminalConfig;
  sshOptions?: HostSshOptions;

  useSocks5?: boolean;
  socks5Host?: string;
  socks5Port?: number;
  connectionOrigin?: "local" | "remote" | null;
  socks5Username?: string;
  socks5Password?: string;
  socks5ProxyChain?: {
    host: string;
    port: number;
    type: 4 | 5 | "http" | "socks4" | "socks5";
    username?: string;
    password?: string;
  }[];
  /** hostid is a legacy lowercase spelling still present in stored rows. */
  jumpHosts?: { hostId: string; hostid?: string }[];
  portKnockSequence?: {
    port: number;
    protocol: "tcp" | "udp";
    delay: number;
  }[];

  statusCheckEnabled?: boolean;
  /** Seconds between status checks; null follows the global setting. */
  statusCheckInterval?: number | null;

  enableSsh: boolean;

  sshPort: number;

  /** Each plugin protocol's login, secrets left out. */
  protocolAuth?: Record<string, HostProtocolAuthSummary>;

  /** Host-scope plugin settings, keyed by plugin id. Secrets are redacted. */
  pluginSettings?: Record<string, Record<string, unknown>>;
  /** Host default keys this host sets itself, per namespace. */
  defaultOverrides?: DefaultOverrides | null;
  forceKeyboardInteractive?: boolean;

  isShared?: boolean;
  authOverrides?: HostAuthOverrides<string>;
  permissionLevel?: SharePermissionLevel;
  sharedExpiresAt?: string;
  ownerUsername?: string;
  /**
   * A read-only copy of a host shared with the account this desktop is
   * linked to. It arrives through sync and is managed on the server.
   */
  sharedCopy?: boolean;
  /** Desktop only: kept on this device, never synced to the server. */
  localOnly?: boolean;
};

export type SharePermissionLevel = "connect" | "view" | "edit" | "manage";

export type Credential = {
  id: string;
  name: string;
  username: string;
  type: "password" | "key";
  value?: string;
  password?: string;
  publicKey?: string;
  passphrase?: string;
  description?: string;
  folder?: string;
  tags?: string[];
  pin?: boolean;
  sortOrder?: number | null;
  certPublicKey?: string;
  /** Set when someone else owns this credential and shared it with you. */
  isShared?: boolean;
  ownerUsername?: string | null;
  permissionLevel?: "use" | "manage";
};

export type HostFolder = {
  name: string;
  children: (Host | HostFolder)[];
  path?: string;
  color?: string;
  icon?: string;
  credentialId?: number | null;
  sortOrder?: number | null;
  localOnly?: boolean;
};

/** Core's own tab types. Plugins register theirs at runtime. */
type KnownTabType =
  | "dashboard"
  | "host-manager"
  | "user-profile"
  | "admin-settings"
  | "split-screen";

/**
 * TabType covers every built-in tab plus any plugin-contributed tab id.
 * `string & {}` (rather than plain `string`) keeps IDE autocomplete
 * suggesting the known members while still accepting an arbitrary id, since
 * a bare `string` would widen every literal and kill autocomplete entirely.
 * Plugin tab ids are resolved at render time via the tab-component registry
 * in tabUtils.tsx, not through this type.
 */
export type TabType = KnownTabType | (string & {});

export type Tab = {
  id: string;
  instanceId: string;
  type: TabType;
  label: string;
  customLabel?: string;
  host?: Host;
  openedAt: number;
  restoredSessionId?: string | null;
  /** Payload owned by the tab's plugin, e.g. which fleet or endpoint it shows. */
  data?: Record<string, unknown>;
  /** Present only on a split-screen container tab. Pane tab ids reference live child tabs. */
  split?: SplitState;
  /** Hides this session from the top-level tab bar while it belongs to a split tab. */
  parentSplitTabId?: string;
  terminalRef?: import("react").RefObject<{
    disconnect?: () => void;
    isConnected?: () => boolean;
    sendInput?: (data: string) => void;
    subscribeOutput?: (listener: (data: string) => void) => () => void;
    paste?: (text: string) => void;
    reconnect?: () => void;
    /** Start a manual reconnect only when disconnected and idle; return whether it started. */
    reconnectIfDisconnected?: () => boolean;
    fit?: () => void;
    notifyResize?: () => void;
    refresh?: () => void;
    getApplicationCursorKeysMode?: () => boolean;
    focus?: () => void;
  } | null>;
};

/** Core cards are named here; plugin cards add their own ids. */
export type DashboardCardId =
  | "stats_bar"
  | "counters_bar"
  | "quick_actions"
  | "host_status"
  | "recent_activity"
  | (string & {});

export type DashboardCardConfig = {
  id: DashboardCardId;
  label: string;
  description: string;
  defaultEnabled: boolean;
};

export type AdminSection =
  | "general"
  | "users"
  | "sessions"
  | "roles"
  | "host-defaults"
  | "branding"
  | "database"
  | "api-keys"
  | "audit-log"
  | "ssl";
export type ThemeId =
  | "dark"
  | "light"
  | "system"
  | "dracula"
  | "catppuccin"
  | "nord"
  | "solarized"
  | "tokyo-night"
  | "one-dark"
  | "gruvbox";
export type FontSizeId = "xs" | "sm" | "md" | "lg" | "xl";
export type UiFontId =
  | "jetbrains-mono"
  | "system-sans"
  | "fira-code"
  | "source-code-pro"
  | "caskaydia-cove";

/** A tools panel view: a rail panel a plugin registered. */
export type ToolsTab = string & {};

/** "row" lays children side by side, "column" stacks them. */
export type SplitDirection = "row" | "column";

export interface PaneNode {
  kind: "pane";
  id: string;
  tabId: string | null;
}

export interface SplitNode {
  kind: "split";
  id: string;
  direction: SplitDirection;
  children: LayoutNode[];
  /** Percent of the parent per child, summing to 100. */
  sizes: number[];
}

export type LayoutNode = PaneNode | SplitNode;

/** The layout of one split tab. */
export interface SplitState {
  root: LayoutNode;
  focusedPaneId: string;
  /** A pane shown alone, filling the split, until unzoomed. */
  zoomedPaneId?: string | null;
}

export type WorkspaceTabSnapshot = {
  /** Stable key within the saved tab list, not the live Tab.id (which is regenerated on every open). */
  slotId: string;
  type: TabType;
  /** Set for host-bound tab types, resolved by Host.syncId on apply. */
  hostSyncId?: string | null;
  /** Denormalized snapshot for display and graceful-skip messaging if the host is later deleted. */
  hostNameSnapshot?: string | null;
  label: string;
  customLabel?: string;
  /** Read from payloads saved before tabs carried `data`. */
  initialFilePath?: string;
  initialPath?: string;
  fleetId?: number;
  /** The tab's plugin payload. */
  data?: Record<string, unknown>;
};

/** One dock's arrangement. `view` is a RailView, or null when the dock is closed. */
type WorkspaceDockState = {
  view: string | null;
  open: boolean;
  width: number;
};

/** One split tab in a saved layout, its pane tab ids swapped for slotIds. */
export type WorkspaceSplitSnapshot = {
  slotId: string;
  label: string;
  root: LayoutNode;
  focusedPaneId: string;
};

export type WorkspacePayload = {
  version: 1 | 2;
  tabs: WorkspaceTabSnapshot[];
  /** A tab's slotId, or a split's. */
  activeSlotId: string | null;
  /** Every split tab. Version 2 and later. */
  splits?: WorkspaceSplitSnapshot[];
  /** Version 1: the one split, as a fixed mode. */
  splitMode?: string;
  /** Version 1: indexed by the mode's pane order, holding slotIds. */
  paneTabIds?: (string | null)[];
  rowSizes?: number[];
  rowColSizes?: number[][];
  /** Sidebar arrangement, so a workspace restores the whole layout and not just tabs. */
  sidebar?: {
    left: WorkspaceDockState;
    right: WorkspaceDockState;
  };
};
