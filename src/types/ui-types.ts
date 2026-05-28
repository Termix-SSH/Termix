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
  authType: "password" | "key" | "credential" | "none" | "opkssh";
  credentialId?: string;
  overrideCredentialUsername?: boolean;
  password?: string;
  hasKey?: boolean;
  hasKeyPassword?: boolean;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  notes?: string;
  macAddress?: string;
  pin?: boolean;

  enableTerminal: boolean;
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
  defaultPath?: string;

  enableDocker: boolean;

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

  rdpUser?: string;
  rdpPassword?: string;
  domain?: string;
  security?: string;
  ignoreCert?: boolean;

  vncPassword?: string;
  vncUser?: string;

  telnetUser?: string;
  telnetPassword?: string;

  guacamoleConfig?: Record<string, any>;
  forceKeyboardInteractive?: boolean;
};

export type Credential = {
  id: string;
  name: string;
  username: string;
  type: "password" | "key";
  value?: string;
  publicKey?: string;
  passphrase?: string;
  description?: string;
  folder?: string;
  tags?: string[];
};

export type HostFolder = {
  name: string;
  children: (Host | HostFolder)[];
};

export type TabType =
  | "dashboard"
  | "terminal"
  | "rdp"
  | "vnc"
  | "telnet"
  | "stats"
  | "files"
  | "host-manager"
  | "user-profile"
  | "admin-settings"
  | "docker"
  | "tunnel"
  | "network_graph";

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
  host?: Host;
  openedAt: number;
  restoredSessionId?: string | null;
  terminalRef?: import("react").RefObject<{
    sendInput?: (data: string) => void;
    reconnect?: () => void;
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
  | "network_graph";

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
  | "oidc"
  | "users"
  | "sessions"
  | "roles"
  | "database"
  | "api-keys";
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
