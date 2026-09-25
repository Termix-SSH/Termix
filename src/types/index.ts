import type { Request } from "express";
import type { RefObject } from "react";
import type { HostAuthOverrides } from "./auth-protocols.js";

export type {
  AuthOverrideProtocol,
  HostAuthOverrideState,
  HostAuthOverrides,
} from "./auth-protocols.js";
/**
 * Core's own SSH auth types, plus whatever a plugin registers through
 * ctx.auth (the owning plugin decides the name).
 */
export type SSHAuthType =
  "password" | "key" | "credential" | "none" | "agent" | (string & {});

export type WebEndpointAccess = "direct" | "tunnel";
export type WebEndpointRender = "external" | "embedded";

/** One web UI a host serves, declared in the host's settings. */
export interface WebEndpoint {
  /**
   * Stable identifier. Must NOT be derived from the port: it keys both the
   * tunnel name and the tab identity, so editing a port has to leave a live
   * tunnel findable under the same name.
   */
  id: string;
  label: string;
  scheme: "http" | "https";
  port: number;
  /** Defaults to "/". Normalized at the storage boundary, never here. */
  path?: string;
  access: WebEndpointAccess;
  render: WebEndpointRender;
  /**
   * Direct endpoints only. Allows an invalid TLS certificate for this
   * endpoint's exact origin. A no-op for tunnel access, whose host component
   * is loopback and therefore already exempt.
   */
  ignoreCert?: boolean;
  /**
   * Tunnel endpoints only. Where the backend binds the forward, exactly as
   * the server tunnels feature exposes it. Defaults to 127.0.0.1, reachable
   * only from the machine running the backend. A web deployment runs the
   * backend on a server, so reaching the forward from a browser needs an
   * address that machine answers on -- which also exposes the target's web UI
   * to anyone who can reach the port, with no login in front of it.
   */
  bindHost?: string;
  /**
   * Tunnel endpoints only. Which port the forward listens on, as the server
   * tunnels feature's Source Port does. Left unset the kernel picks a free
   * one, which is fine when backend and browser share a machine -- but a
   * container can only publish ports it knows in advance.
   */
  localPort?: number;
}

export interface JumpHost {
  hostId: number;
}

export interface QuickAction {
  name: string;
  snippetId: number;
}

export type Host = {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  folder: string;
  tags: string[];
  pin: boolean;
  authType: SSHAuthType;
  shareSshAuth?: boolean;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  sudoPassword?: string;
  forceKeyboardInteractive?: boolean;

  autostartPassword?: string;
  autostartKey?: string;
  autostartKeyPassword?: string;

  credentialId?: number;
  overrideCredentialUsername?: boolean;
  userId?: string;
  jumpHosts?: JumpHost[];
  quickActions?: QuickAction[];
  statusCheckEnabled?: boolean;
  /** Seconds between status checks; null follows the global setting. */
  statusCheckInterval?: number | null;
  terminalConfig?: Partial<TerminalConfig>;
  notes?: string;

  useSocks5?: boolean;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  socks5Password?: string;
  socks5ProxyChain?: ProxyNode[];

  portKnockSequence?: Array<{
    port: number;
    protocol?: "tcp" | "udp";
    delay?: number;
  }>;

  /** "ssh", or the id of the plugin protocol a host without SSH uses. */
  connectionType?: string;
  domain?: string;

  enableSsh?: boolean;
  sshPort?: number;
  rdpCredentialId?: number | null;
  rdpUser?: string;
  rdpPassword?: string;
  rdpDomain?: string;
  vncCredentialId?: number | null;
  vncPassword?: string;
  vncUser?: string;
  telnetUser?: string;
  telnetPassword?: string;
  telnetCredentialId?: number | null;
  rdpAuthType?: "direct" | "credential" | "none" | null;
  vncAuthType?: "direct" | "credential" | null;
  telnetAuthType?: "direct" | "credential" | null;
  /**
   * Stable identity across a desktop/server sync pair. `id` is an
   * autoincrement local to whichever database produced the row, so it cannot
   * name the same host on both sides; this can. Absent on hosts that have
   * never been part of a sync.
   */
  syncId?: string | null;
  createdAt: string;
  updatedAt: string;

  sortOrder?: number | null;
  connectionOrigin?: "local" | "remote" | null;

  /** Assigned when a host is opened in a tab; distinguishes duplicate tabs. */
  instanceId?: string;

  hasKey?: boolean;
  hasKeyPassword?: boolean;
  // Set by formatHostOutput() alongside hasKey/hasKeyPassword so the UI can
  // tell a stored secret from an empty one without receiving it.
  hasPassword?: boolean;
  hasSudoPassword?: boolean;
  hasRdpPassword?: boolean;
  hasVncPassword?: boolean;
  hasTelnetPassword?: boolean;

  isShared?: boolean;
  authOverrides?: HostAuthOverrides;
  permissionLevel?: "connect" | "view" | "edit" | "manage";
  sharedExpiresAt?: string;
  ownerUsername?: string;

  /** Enabled plugins' host-scope settings, keyed by plugin id. Secrets redacted. */
  pluginSettings?: Record<string, Record<string, unknown>>;
};

export interface JumpHostData {
  hostId: number;
}

export interface QuickActionData {
  name: string;
  snippetId: number;
}

export interface ProxyNode {
  host: string;
  port: number;
  /**
   * The host editor writes "socks4"/"socks5"/"http", while proxy-helper.ts
   * tests for "http" and casts everything else to 4|5 before handing it to the
   * socks client. The two spellings have never agreed; typed as the union of
   * what is actually stored rather than pretending one side is right.
   */
  type: 4 | 5 | "http" | "socks4" | "socks5";
  username?: string;
  password?: string;
}

export interface HostData {
  name?: string;
  ip: string;
  port: number;
  username: string;
  folder?: string;
  /** Sub-host nesting: mutually exclusive with folder. */
  parentHostId?: number | string | null;
  tags?: string[];
  pin?: boolean;
  authType: SSHAuthType;
  shareSshAuth?: boolean;
  password?: string;
  key?: File | string | null;
  keyPassword?: string;
  keyType?: string;
  sudoPassword?: string;
  credentialId?: number | null;
  connectionOrigin?: "local" | "remote" | null;
  overrideCredentialUsername?: boolean;
  forceKeyboardInteractive?: boolean;
  jumpHosts?: JumpHostData[];
  quickActions?: QuickActionData[];
  statusCheckEnabled?: boolean;
  /** Seconds between status checks; null follows the global setting. */
  statusCheckInterval?: number | null;
  terminalConfig?: Partial<TerminalConfig>;
  notes?: string;

  useSocks5?: boolean;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  socks5Password?: string;
  socks5ProxyChain?: ProxyNode[];

  portKnockSequence?: Array<{
    port: number;
    protocol?: "tcp" | "udp";
    delay?: number;
  }>;

  /** "ssh", or the id of the plugin protocol a host without SSH uses. */
  connectionType?: string;
  domain?: string;

  enableSsh?: boolean;
  sshPort?: number;
  rdpCredentialId?: number | null;
  rdpUser?: string;
  rdpPassword?: string;
  rdpDomain?: string;
  vncCredentialId?: number | null;
  vncPassword?: string;
  vncUser?: string;
  telnetUser?: string;
  telnetPassword?: string;
  telnetCredentialId?: number | null;
  rdpAuthType?: "direct" | "credential" | "none" | null;
  vncAuthType?: "direct" | "credential" | null;
  telnetAuthType?: "direct" | "credential" | null;
}

export type SSHHost = Host;
export type SSHHostData = HostData;

export interface SSHFolder {
  id: number;
  userId: string;
  name: string;
  color?: string;
  icon?: string;
  credentialId?: number | null;
  sortOrder?: number | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// CREDENTIAL TYPES
// ============================================================================

export interface Credential {
  id: number;
  name: string;
  description?: string;
  folder?: string;
  tags: string[];
  authType: "password" | "key";
  username?: string;
  password?: string;
  key?: string;
  publicKey?: string;
  /** CA-signed certificate file content (e.g. id_ed25519-cert.pub) */
  certPublicKey?: string;
  /** True when a cert is stored but certPublicKey content is redacted in list responses */
  hasCertPublicKey?: boolean;
  keyPassword?: string;
  keyType?: string;
  usageCount: number;
  lastUsed?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialBackend {
  id: number;
  userId: string;
  name: string;
  description: string | null;
  folder: string | null;
  tags: string;
  authType: "password" | "key";
  username: string | null;
  password: string | null;
  key: string;
  privateKey?: string;
  publicKey?: string;
  /** CA-signed certificate file content (e.g. id_ed25519-cert.pub) */
  certPublicKey?: string;
  keyPassword: string | null;
  keyType?: string;
  detectedKeyType: string;
  usageCount: number;
  lastUsed: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// TUNNEL TYPES
// ============================================================================

export type TunnelScope = "s2s" | "c2s";
export type TunnelMode = "local" | "remote" | "dynamic";

// ============================================================================
// FILE MANAGER TYPES
// ============================================================================

export interface Tab {
  id: string | number;
  title: string;
  fileName: string;
  content: string;
  isSSH?: boolean;
  sshSessionId?: string;
  filePath?: string;
  loading?: boolean;
  dirty?: boolean;
}

// ============================================================================
// TERMINAL CONFIGURATION TYPES
// ============================================================================

export interface TerminalConfig {
  localEcho?: "default" | "off" | "auto" | "on";
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
  macOptionIsMeta: boolean;
  fastScrollModifier: "alt" | "ctrl" | "shift";
  fastScrollSensitivity: number;
  minimumContrastRatio: number;

  backspaceMode: "normal" | "control-h";
  agentForwarding: boolean;
  environmentVariables: Array<{ key: string; value: string }>;
  startupSnippetId: number | null;
  autoMosh: boolean;
  moshCommand: string;
  sudoPasswordAutoFill: boolean;
  sudoPassword?: string | null;
  keepaliveInterval?: number;
  keepaliveCountMax?: number;
  autoTmux: boolean;
  syntaxHighlighting: boolean;
  syntaxHighlightingOptions?: {
    logLevels: boolean;
    paths: boolean;
    timestamps: boolean;
    ipAddresses: boolean;
    urls: boolean;
    numbers: boolean;
  };
  backgroundImage?: string;
  backgroundImageOpacity?: number;
  allowLegacyAlgorithms?: boolean;
  linkClickBehavior?: "confirm" | "direct";
  useSSHTitle?: boolean;
  agentSocketPath?: string;
  agentIdentity?: string;
  customThemeColors?: {
    background: string;
    foreground: string;
    cursor?: string;
    cursorAccent?: string;
    selectionBackground?: string;
    selectionForeground?: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
}

// ============================================================================
// TAB TYPES
// ============================================================================

export interface TabContextTab {
  id: number;
  instanceId?: string;
  /** A core tab type or one a plugin registered. */
  type: string;
  title: string;
  hostConfig?: SSHHost;
  terminalRef?: RefObject<TerminalRefHandle | null>;
  initialTab?: string;
  _updateTimestamp?: number;
  connectionConfig?: Record<string, unknown>;
}

export interface TerminalRefHandle {
  disconnect?: () => void;
  reconnect?: () => void;
  isConnected?: () => boolean;
  fit?: () => void;
  sendInput?: (data: string) => void;
  subscribeOutput?: (listener: (data: string) => void) => () => void;
  notifyResize?: () => void;
  refresh?: () => void;
  openFileManager?: () => void;
}

export type SplitLayout = "2h" | "2v" | "3l" | "3r" | "3t" | "4grid";

// ============================================================================
// EXPRESS REQUEST TYPES
// ============================================================================

export interface AuthenticatedRequest extends Request {
  userId: string;
  sessionId?: string;
  apiKeyId?: string;
  actingAdminUserId?: string;
  user?: {
    id: string;
    username: string;
    isAdmin: boolean;
  };
}

// ============================================================================
// GITHUB API TYPES
// ============================================================================

export interface GitHubAsset {
  id: number;
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  assets: GitHubAsset[];
  prerelease: boolean;
  draft: boolean;
}

export interface GitHubAPIResponse<T> {
  data: T;
  cached: boolean;
  cache_age?: number;
  timestamp?: number;
}

// ============================================================================
// CACHE TYPES
// ============================================================================

export interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

// ============================================================================
// DATABASE EXPORT/IMPORT TYPES
// ============================================================================

export interface ExportSummary {
  sshHostsImported: number;
  sshCredentialsImported: number;
  pluginItemsImported: number;
  credentialUsageImported: number;
  settingsImported: number;
  skippedItems: number;
  errors: string[];
}

// ============================================================================
// DOCKER TYPES
// ============================================================================
