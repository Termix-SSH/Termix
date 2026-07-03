export type Host = {
  id: string;
  name: string;
  username: string;
  ip: string;
  port: number;
  folder: string;
  online: boolean;
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
    | "tailscale"
    | "vault"
    | "agent";
  useWarpgate?: boolean;
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
  macAddress?: string;
  wolBroadcastAddress?: string;
  pin?: boolean;

  enableTerminal: boolean;
  enableCommandHistory: boolean;
  terminalConfig?: {
    cursorBlink: boolean;
    cursorStyle: "block" | "underline" | "bar";
    fontSize: number;
    fontFamily: string;
    letterSpacing: number;
    lineHeight: number;
    theme: string;
    scrollback: number;
    bellStyle: "none" | "sound" | "visual" | "both";
    rightClickSelectsWord: boolean;
    fastScrollModifier: "alt" | "ctrl" | "shift";
    fastScrollSensitivity: number;
    minimumContrastRatio: number;
    backspaceMode: "normal" | "control-h";
    agentForwarding: boolean;
    autoMosh: boolean;
    moshCommand: string;
    autoTmux: boolean;
    sudoPasswordAutoFill: boolean;
    sudoPassword?: string;
    keepaliveInterval?: number;
    keepaliveCountMax?: number;
    environmentVariables: { key: string; value: string }[];
    startupSnippetId?: number | null;
    linkClickBehavior?: "confirm" | "direct";
    agentSocketPath?: string;
  };

  useSocks5?: boolean;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  socks5Password?: string;
  socks5ProxyChain?: {
    host: string;
    port: number;
    type: 4 | 5 | "http" | string;
    username?: string;
    password?: string;
  }[];
  jumpHosts?: { hostId: string }[];
  portKnockSequence?: {
    port: number;
    protocol: "tcp" | "udp";
    delay: number;
  }[];

  enableTunnel: boolean;
  serverTunnels: {
    mode: "local" | "remote" | "dynamic";
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

  enableDocker: boolean;
  dockerConfig?: {
    runtime?: "docker" | "podman";
  } | null;
  enableProxmox: boolean;
  enableTmuxMonitor: boolean;
  proxmoxConfig?: {
    defaultCredentialId: number | null;
    defaultAuthType?: string;
    windowsPatterns: string;
    dockerPatterns: string;
    preferredPrefixes: string;
  } | null;

  statsConfig?: {
    statusCheckEnabled: boolean;
    statusCheckInterval: number;
    useGlobalStatusInterval: boolean;
    metricsEnabled: boolean;
    metricsInterval: number;
    useGlobalMetricsInterval: boolean;
    enabledWidgets: string[];
  };
  quickActions: { name: string; snippetId: string }[];

  enableSsh: boolean;
  enableRdp: boolean;
  enableVnc: boolean;
  enableTelnet: boolean;

  sshPort: number;
  rdpPort: number;
  vncPort: number;
  telnetPort: number;

  rdpCredentialId?: string;
  rdpUser?: string;
  rdpPassword?: string;
  domain?: string;
  security?: string;
  ignoreCert?: boolean;

  vncCredentialId?: string;
  vncPassword?: string;
  vncUser?: string;

  telnetUser?: string;
  telnetPassword?: string;

  guacamoleConfig?: Record<string, unknown>;
  forceKeyboardInteractive?: boolean;
};

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
};

export type TabType =
  | "dashboard"
  | "terminal"
  | "rdp"
  | "vnc"
  | "telnet"
  | "host-metrics"
  | "files"
  | "host-manager"
  | "user-profile"
  | "admin-settings"
  | "docker"
  | "tunnel"
  | "network_graph"
  | "tmux_monitor" // --- tmux-monitor ---
  | "serial"
  | "homepage";

export type SerialConfig = {
  path: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 2;
  parity: "none" | "even" | "odd";
};

export type TunnelStatusValue =
  | "CONNECTED"
  | "CONNECTING"
  | "DISCONNECTING"
  | "DISCONNECTED"
  | "ERROR"
  | "WAITING";
export type TunnelMode = "local" | "remote" | "dynamic";

export type Tunnel = {
  id: string;
  hostId: string;
  sourcePort: number;
  endpointHost: string;
  endpointPort: number;
  status: TunnelStatusValue;
  mode: TunnelMode;
  reason?: string;
  retryCount?: number;
  maxRetries?: number;
};

export type Tab = {
  id: string;
  instanceId: string;
  type: TabType;
  label: string;
  customLabel?: string;
  host?: Host;
  openedAt: number;
  restoredSessionId?: string | null;
  initialFilePath?: string;
  serialConfig?: SerialConfig;
  terminalRef?: import("react").RefObject<{
    disconnect?: () => void;
    isConnected?: () => boolean;
    sendInput?: (data: string) => void;
    reconnect?: () => void;
    fit?: () => void;
    notifyResize?: () => void;
    getApplicationCursorKeysMode?: () => boolean;
  } | null>;
};

export type DockerContainerStatus =
  | "running"
  | "exited"
  | "paused"
  | "created"
  | "restarting";

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: DockerContainerStatus;
  cpu: number;
  memory: string;
  ports: string[];
  created: string;
};

export type DashboardCardId =
  | "stats_bar"
  | "counters_bar"
  | "quick_actions"
  | "host_status"
  | "recent_activity"
  | "network_graph"
  | "service_links"
  | "homepage_preview";

export type DashboardCardConfig = {
  id: DashboardCardId;
  label: string;
  description: string;
  defaultEnabled: boolean;
};

export type CardColSpan = "full" | "wide" | "half" | "narrow";
export type CardRowSize = "short" | "medium" | "tall" | "flex";

export type CardLayoutConfig = {
  id: DashboardCardId;
  colSpan: CardColSpan;
  rowSize: CardRowSize;
  order: number;
};

export type LayoutPresetId = "default" | "compact" | "focus" | "wide";

export type LayoutPreset = {
  id: LayoutPresetId;
  label: string;
  description: string;
  cards: CardLayoutConfig[];
};

export type UserProfileSection =
  | "account"
  | "appearance"
  | "security"
  | "api-keys";
export type AdminSection =
  | "general"
  | "sso"
  | "users"
  | "sessions"
  | "roles"
  | "host-defaults"
  | "database"
  | "api-keys"
  | "audit-log"
  | "ssl";
export type AccentColorId = string;
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

export type ToolsTab = "ssh-tools" | "snippets" | "history" | "split-screen";
export type SplitMode =
  | "none"
  | "2-way"
  | "3-way"
  | "3-way-horizontal"
  | "4-way"
  | "5-way"
  | "6-way";

export type Snippet = {
  id: number;
  name: string;
  description?: string;
  content: string;
  folder: string | null;
  order: number;
  hostIds?: number[];
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

export type HistoryEntry = {
  id: number;
  command: string;
  host: string;
  time: string;
};
