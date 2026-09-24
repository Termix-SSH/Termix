import type { TerminalConfig } from "./index.js";
import type { HostAuthOverrides } from "./auth-protocols.js";

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
  authType:
    | "password"
    | "key"
    | "credential"
    | "none"
    | "opkssh"
    | "stepca"
    | "tailscale"
    | "vault"
    | "agent";
  useWarpgate?: boolean;
  shareSshAuth?: boolean;
  credentialId?: string;
  vaultProfileId?: string;
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
  sortOrder?: number | null;

  enableTerminal: boolean;
  enableCommandHistory: boolean;
  enableSessionLogging?: boolean;
  /** Stable identity across a desktop/server sync pair. */
  syncId?: string | null;
  terminalConfig?: Partial<TerminalConfig>;

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

  enableTunnel: boolean;
  serverTunnels: {
    mode: "local" | "remote" | "dynamic";
    localAddress?: string;
    remoteAddress?: string;
    bindHost?: string;
    targetHost?: string;
    sourcePort: number;
    endpointHost: string;
    endpointPort: number;
    maxRetries: number;
    retryInterval: number;
    autoStart: boolean;
  }[];

  enableFileManager: boolean;
  scpLegacy?: boolean;
  defaultPath?: string;

  enableWebUi?: boolean;
  enableProxmox: boolean;
  enableTmuxMonitor: boolean;
  enableTerminalToolbar: boolean;
  proxmoxConfig?: {
    source?: {
      source: "proxmox";
      sourceHostId: number;
      node: string;
      vmid: number;
      type: "qemu" | "lxc";
      lastSeenAt?: string;
      lastStatus?: string;
      missingSince?: string | null;
    };
    defaultCredentialId: number | null;
    defaultAuthType?: string;
    windowsPatterns: string;
    dockerPatterns: string;
    preferredPrefixes: string;
    autoSyncEnabled?: boolean;
    syncIntervalMinutes?: number;
    markMissingGuests?: boolean;
    lastSyncAt?: string;
    lastSyncStatus?: "success" | "error";
    lastSyncError?: string | null;
    lastSyncResult?: {
      created: number;
      updated: number;
      markedMissing: number;
      skipped: number;
      errors: string[];
    };
  } | null;
  enableProxmoxStats: boolean;
  proxmoxStatsConfig?: {
    nodeName?: string | null;
    pollInterval?: number;
    enabledCards?: string[];
  } | null;

  statusCheckEnabled?: boolean;
  /** Seconds between status checks; null follows the global setting. */
  statusCheckInterval?: number | null;
  quickActions: { name: string; snippetId: string }[];

  enableSsh: boolean;

  sshPort: number;

  rdpAuthType?: "direct" | "credential" | "none";
  rdpCredentialId?: string;
  rdpUser?: string;
  rdpPassword?: string;
  hasRdpPassword?: boolean;
  domain?: string;

  vncAuthType?: "direct" | "credential";
  vncCredentialId?: string;
  vncPassword?: string;
  hasVncPassword?: boolean;
  vncUser?: string;

  telnetAuthType?: "direct" | "credential";
  telnetCredentialId?: string;
  telnetUser?: string;
  telnetPassword?: string;
  hasTelnetPassword?: boolean;

  /** Host-scope plugin settings, keyed by plugin id. Secrets are redacted. */
  pluginSettings?: Record<string, Record<string, unknown>>;
  forceKeyboardInteractive?: boolean;

  isShared?: boolean;
  authOverrides?: HostAuthOverrides<string>;
  permissionLevel?: SharePermissionLevel;
  sharedExpiresAt?: string;
  ownerUsername?: string;
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

// HashiCorp Vault SSH signer profile — shareable connection settings only
// (no secrets). Users authenticate to Vault via OIDC at connect time.
export type VaultProfile = {
  id: string;
  name: string;
  description?: string;
  folder?: string;
  tags?: string[];
  vaultAddr: string;
  vaultNamespace?: string;
  oidcMount?: string;
  oidcRole?: string;
  sshMount?: string;
  sshRole: string;
  validPrincipals?: string;
  keyType?: string;
  shared: boolean;
  owned: boolean;
};

export type HostFolder = {
  name: string;
  children: (Host | HostFolder)[];
  path?: string;
  color?: string;
  icon?: string;
  credentialId?: number | null;
  sortOrder?: number | null;
};

export type KnownTabType =
  | "dashboard"
  | "terminal"
  | "local-terminal"
  | "rdp"
  | "vnc"
  | "telnet"
  | "host-metrics"
  | "proxmox-stats"
  | "files"
  | "host-manager"
  | "user-profile"
  | "admin-settings"
  | "docker"
  | "tunnel"
  | "sftp"
  | "web-endpoint"
  | "network_graph"
  | "tmux_monitor" // --- tmux-monitor ---
  | "serial"
  | "homepage"
  | "fleet-inventory"
  // Rail panels that can also open full-width in the main area.
  | "termix-id"
  | "session-logs"
  | "snippets"
  | "macros"
  | "history"
  | "ssh-tools"
  | "automations"
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
  /** Set when this tab joins someone else's live shared session instead of connecting/attaching its own. */
  joinSharedSessionId?: string | null;
  joinShareId?: string | null;
  initialFilePath?: string;
  /** Directory to open a Files tab into, distinct from initialFilePath (a specific file to open in an editor window). */
  initialPath?: string;
  /** Payload owned by the tab's plugin, e.g. which fleet or endpoint it shows. */
  data?: Record<string, unknown>;
  /** Present only on a split-screen container tab. Pane ids reference live child tabs. */
  splitConfig?: SplitTabConfig;
  /** Hides this session from the top-level tab bar while it belongs to a split tab. */
  parentSplitTabId?: string;
  terminalRef?: import("react").RefObject<{
    disconnect?: () => void;
    isConnected?: () => boolean;
    sendInput?: (data: string) => void;
    subscribeOutput?: (listener: (data: string) => void) => () => void;
    paste?: (text: string) => void;
    reconnect?: () => void;
    fit?: () => void;
    notifyResize?: () => void;
    refresh?: () => void;
    getApplicationCursorKeysMode?: () => boolean;
    openFileManager?: () => void;
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
  | "sso"
  | "users"
  | "sessions"
  | "roles"
  | "host-defaults"
  | "image-storage"
  | "branding"
  | "database"
  | "api-keys"
  | "audit-log"
  | "ssl"
  | "plugins"
  | "touch-input";
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

export type ToolsTab =
  "ssh-tools" | "snippets" | "macros" | "history" | "split-screen";
export type SplitMode =
  | "none"
  | "2-way"
  | "2-way-horizontal"
  | "3-way"
  | "3-way-horizontal"
  | "4-way"
  | "5-way"
  | "6-way";

export type SplitTabConfig = {
  mode: Exclude<SplitMode, "none">;
  paneTabIds: (string | null)[];
  rowSizes: number[];
  rowColSizes: number[][];
};

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
  initialFilePath?: string;
  initialPath?: string;
  /** Read from payloads saved before tabs carried `data`. */
  fleetId?: number;
  /** The tab's plugin payload. */
  data?: Record<string, unknown>;
};

/** One dock's arrangement. `view` is a RailView, or null when the dock is closed. */
export type WorkspaceDockState = {
  view: string | null;
  open: boolean;
  width: number;
};

export type WorkspacePayload = {
  version: 1;
  tabs: WorkspaceTabSnapshot[];
  activeSlotId: string | null;
  splitMode: SplitMode;
  /** Indexed identically to AppShell's paneTabIds (length 6), holding slotId instead of a live Tab.id. */
  paneTabIds: (string | null)[];
  rowSizes: number[];
  rowColSizes: number[][];
  /** Sidebar arrangement, so a workspace restores the whole layout and not just tabs. */
  sidebar?: {
    left: WorkspaceDockState;
    right: WorkspaceDockState;
  };
};

export type Snippet = {
  id: number;
  name: string;
  description?: string;
  content: string;
  folder: string | null;
  order: number;
  hostIds?: number[];
  isNote?: boolean;
};

export const FOLDER_ICONS = [
  "folder",
  "server",
  "cloud",
  "database",
  "box",
  "network",
  "copy",
  "settings",
  "cpu",
  "globe",
] as const;
export type FolderIconId = (typeof FOLDER_ICONS)[number];

export type SnippetFolder = {
  id: number;
  name: string;
  color: string;
  icon: FolderIconId;
  open: boolean;
};
