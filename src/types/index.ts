import type {
  HostProtocolAuthSummary,
  HostProtocolAuthType,
  HostSshOptions,
} from "@termix-ssh/plugin-sdk/frontend";
import type { Request } from "express";
import type { RefObject } from "react";
import type { HostAuthOverrides } from "./auth-protocols.js";
import type { DefaultOverrides } from "./host-defaults.js";

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

export type { HostProtocolAuthSummary, HostProtocolAuthType };

/** One plugin protocol's login in a host write. */
export interface HostProtocolAuthInput {
  authType?: HostProtocolAuthType;
  credentialId?: number | null;
  username?: string | null;
  /** Left out to keep the saved password. */
  password?: string | null;
  /** Declared credential fields; one left out keeps its value. */
  fields?: Record<string, string | null>;
}

export interface JumpHost {
  hostId: number;
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

  credentialId?: number;
  overrideCredentialUsername?: boolean;
  userId?: string;
  jumpHosts?: JumpHost[];
  statusCheckEnabled?: boolean;
  /** Seconds between status checks; null follows the global setting. */
  statusCheckInterval?: number | null;
  terminalConfig?: HostTerminalConfig;
  sshOptions?: HostSshOptions;
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

  enableSsh?: boolean;
  sshPort?: number;
  /** Each plugin protocol's login, secrets left out. */
  protocolAuth?: Record<string, HostProtocolAuthSummary>;
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

  isShared?: boolean;
  authOverrides?: HostAuthOverrides;
  permissionLevel?: "connect" | "view" | "edit" | "manage";
  sharedExpiresAt?: string;
  ownerUsername?: string;
  /** A read-only copy of a host shared with the linked account. */
  sharedCopy?: boolean;
  /** Desktop only: kept on this device, never synced to the server. */
  localOnly?: boolean;

  /** Enabled plugins' host-scope settings, keyed by plugin id. Secrets redacted. */
  pluginSettings?: Record<string, Record<string, unknown>>;
  /** Host default keys this host sets itself, per namespace. */
  defaultOverrides?: DefaultOverrides | null;
};

export interface JumpHostData {
  hostId: number;
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
  /** Host default keys the host sets itself, per namespace. Every other key follows its defaults. */
  defaultOverrides?: DefaultOverrides | null;
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
  statusCheckEnabled?: boolean;
  /** Seconds between status checks; null follows the global setting. */
  statusCheckInterval?: number | null;
  terminalConfig?: HostTerminalConfig;
  sshOptions?: HostSshOptions;
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

  enableSsh?: boolean;
  sshPort?: number;
  /**
   * Plugin protocol logins to write, keyed by protocol id. A key left out
   * keeps its login, null removes it, and a field left out keeps its value.
   */
  protocolAuth?: Record<string, HostProtocolAuthInput | null>;
  /** Desktop only: kept on this device, never synced to the server. */
  localOnly?: boolean;
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
  /** Desktop only: the folder and its hosts stay on this device. */
  localOnly?: boolean;
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
// TERMINAL CONFIGURATION TYPES
// ============================================================================

/**
 * What 2.8 kept in ssh_data.terminal_config. Core reads none of it any more:
 * the terminal's look and behavior and the startup command are plugins' host
 * settings, and the connection options have their own column (sshOptions).
 */
export type HostTerminalConfig = Record<string, unknown>;

export type { HostSshOptions } from "@termix-ssh/plugin-sdk/frontend";

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
}

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
