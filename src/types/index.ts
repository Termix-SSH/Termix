import type { Client } from "ssh2";
import type { Request } from "express";

// ============================================================================
// SSH HOST TYPES
// ============================================================================

export interface JumpHost {
  hostId: number;
}

export interface QuickAction {
  name: string;
  snippetId: number;
}

export interface SSHHost {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  folder: string;
  tags: string[];
  pin: boolean;
  authType: "password" | "key" | "credential" | "none";
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  forceKeyboardInteractive?: boolean;

  autostartPassword?: string;
  autostartKey?: string;
  autostartKeyPassword?: string;

  credentialId?: number;
  overrideCredentialUsername?: boolean;
  userId?: string;
  enableTerminal: boolean;
  enableTunnel: boolean;
  enableFileManager: boolean;
  defaultPath: string;
  tunnelConnections: TunnelConnection[];
  jumpHosts?: JumpHost[];
  quickActions?: QuickAction[];
  statsConfig?: string;
  terminalConfig?: TerminalConfig;
  createdAt: string;
  updatedAt: string;

  // Shared access metadata
  isShared?: boolean;
  permissionLevel?: "view" | "manage";
  sharedExpiresAt?: string;
}

export interface JumpHostData {
  hostId: number;
}

export interface QuickActionData {
  name: string;
  snippetId: number;
}

export interface SSHHostData {
  name?: string;
  ip: string;
  port: number;
  username: string;
  folder?: string;
  tags?: string[];
  pin?: boolean;
  authType: "password" | "key" | "credential" | "none";
  password?: string;
  key?: File | null;
  keyPassword?: string;
  keyType?: string;
  credentialId?: number | null;
  overrideCredentialUsername?: boolean;
  enableTerminal?: boolean;
  enableTunnel?: boolean;
  enableFileManager?: boolean;
  defaultPath?: string;
  forceKeyboardInteractive?: boolean;
  tunnelConnections?: TunnelConnection[];
  jumpHosts?: JumpHostData[];
  quickActions?: QuickActionData[];
  statsConfig?: string | Record<string, unknown>;
  terminalConfig?: TerminalConfig;
}

export interface SSHFolder {
  id: number;
  userId: string;
  name: string;
  color?: string;
  icon?: string;
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
  username: string;
  password?: string;
  key?: string;
  publicKey?: string;
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
  username: string;
  password: string | null;
  key: string;
  private_key?: string;
  public_key?: string;
  key_password: string | null;
  keyType?: string;
  detectedKeyType: string;
  usageCount: number;
  lastUsed: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialData {
  name: string;
  description?: string;
  folder?: string;
  tags: string[];
  authType: "password" | "key";
  username: string;
  password?: string;
  key?: string;
  publicKey?: string;
  keyPassword?: string;
  keyType?: string;
}

// ============================================================================
// TUNNEL TYPES
// ============================================================================

export interface TunnelConnection {
  sourcePort: number;
  endpointPort: number;
  endpointHost: string;

  endpointPassword?: string;
  endpointKey?: string;
  endpointKeyPassword?: string;
  endpointAuthType?: string;
  endpointKeyType?: string;

  maxRetries: number;
  retryInterval: number;
  autoStart: boolean;
}

export interface TunnelConfig {
  name: string;
  hostName: string;
  sourceIP: string;
  sourceSSHPort: number;
  sourceUsername: string;
  sourcePassword?: string;
  sourceAuthMethod: string;
  sourceSSHKey?: string;
  sourceKeyPassword?: string;
  sourceKeyType?: string;
  sourceCredentialId?: number;
  sourceUserId?: string;
  endpointIP: string;
  endpointSSHPort: number;
  endpointUsername: string;
  endpointPassword?: string;
  endpointAuthMethod: string;
  endpointSSHKey?: string;
  endpointKeyPassword?: string;
  endpointKeyType?: string;
  endpointCredentialId?: number;
  endpointUserId?: string;
  sourcePort: number;
  endpointPort: number;
  maxRetries: number;
  retryInterval: number;
  autoStart: boolean;
  isPinned: boolean;
}

export interface TunnelStatus {
  connected: boolean;
  status: ConnectionState;
  retryCount?: number;
  maxRetries?: number;
  nextRetryIn?: number;
  reason?: string;
  errorType?: ErrorType;
  manualDisconnect?: boolean;
  retryExhausted?: boolean;
}

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

export interface FileManagerFile {
  name: string;
  path: string;
  type?: "file" | "directory";
  isSSH?: boolean;
  sshSessionId?: string;
}

export interface FileManagerShortcut {
  name: string;
  path: string;
}

export interface FileItem {
  name: string;
  path: string;
  isPinned?: boolean;
  type: "file" | "directory" | "link";
  sshSessionId?: string;
  size?: number;
  modified?: string;
  permissions?: string;
  owner?: string;
  group?: string;
  linkTarget?: string;
  executable?: boolean;
}

export interface ShortcutItem {
  name: string;
  path: string;
}

export interface SSHConnection {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  isPinned?: boolean;
}

// ============================================================================
// HOST INFO TYPES
// ============================================================================

export interface HostInfo {
  id: number;
  name?: string;
  ip: string;
  port: number;
  createdAt: string;
}

// ============================================================================
// ALERT TYPES
// ============================================================================

export interface TermixAlert {
  id: string;
  title: string;
  message: string;
  expiresAt: string;
  priority?: "low" | "medium" | "high" | "critical";
  type?: "info" | "warning" | "error" | "success";
  actionUrl?: string;
  actionText?: string;
}

// ============================================================================
// TERMINAL CONFIGURATION TYPES
// ============================================================================

export interface TerminalConfig {
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
  environmentVariables: Array<{ key: string; value: string }>;
  startupSnippetId: number | null;
  autoMosh: boolean;
  moshCommand: string;
  sudoPasswordAutoFill: boolean;
}

// ============================================================================
// TAB TYPES
// ============================================================================

export interface TabContextTab {
  id: number;
  type:
  | "home"
  | "terminal"
  | "ssh_manager"
  | "server"
  | "admin"
  | "file_manager"
  | "user_profile";
  title: string;
  hostConfig?: SSHHost;
  terminalRef?: any;
  initialTab?: string;
}

export type SplitLayout = "2h" | "2v" | "3l" | "3r" | "3t" | "4grid";

export interface SplitConfiguration {
  layout: SplitLayout;
  positions: Map<number, number>;
}

export interface SplitLayoutOption {
  id: SplitLayout;
  name: string;
  description: string;
  cellCount: number;
  icon: string; // lucide icon name
}

// ============================================================================
// CONNECTION STATES
// ============================================================================

export const CONNECTION_STATES = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  VERIFYING: "verifying",
  FAILED: "failed",
  UNSTABLE: "unstable",
  RETRYING: "retrying",
  WAITING: "waiting",
  DISCONNECTING: "disconnecting",
} as const;

export type ConnectionState =
  (typeof CONNECTION_STATES)[keyof typeof CONNECTION_STATES];

export type ErrorType =
  | "CONNECTION_FAILED"
  | "AUTHENTICATION_FAILED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "UNKNOWN";

// ============================================================================
// AUTHENTICATION TYPES
// ============================================================================

export type AuthType = "password" | "key" | "credential" | "none";

export type KeyType = "rsa" | "ecdsa" | "ed25519";

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
  status?: number;
}

// ============================================================================
// COMPONENT PROP TYPES
// ============================================================================

export interface CredentialsManagerProps {
  onEditCredential?: (credential: Credential) => void;
}

export interface CredentialEditorProps {
  editingCredential?: Credential | null;
  onFormSubmit?: () => void;
}

export interface CredentialViewerProps {
  credential: Credential;
  onClose: () => void;
  onEdit: () => void;
}

export interface CredentialSelectorProps {
  value?: number | null;
  onValueChange: (value: number | null) => void;
}

export interface HostManagerProps {
  onSelectView?: (view: string) => void;
  isTopbarOpen?: boolean;
  initialTab?: string;
  hostConfig?: SSHHost;
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number;
}

export interface SSHManagerHostEditorProps {
  editingHost?: SSHHost | null;
  onFormSubmit?: () => void;
}

export interface SSHManagerHostViewerProps {
  onEditHost?: (host: SSHHost) => void;
}

export interface HostProps {
  host: SSHHost;
  onHostConnect?: () => void;
}

export interface SSHTunnelProps {
  filterHostKey?: string;
}

export interface SSHTunnelViewerProps {
  hosts?: SSHHost[];
  tunnelStatuses?: Record<string, TunnelStatus>;
  tunnelActions?: Record<
    string,
    (
      action: "connect" | "disconnect" | "cancel",
      host: SSHHost,
      tunnelIndex: number,
    ) => Promise<void>
  >;
  onTunnelAction?: (
    action: "connect" | "disconnect" | "cancel",
    host: SSHHost,
    tunnelIndex: number,
  ) => Promise<void>;
}

export interface FileManagerProps {
  onSelectView?: (view: string) => void;
  embedded?: boolean;
  initialHost?: SSHHost | null;
}

export interface AlertCardProps {
  alert: TermixAlert;
  onDismiss: (alertId: string) => void;
}

export interface AlertManagerProps {
  alerts: TermixAlert[];
  onDismiss: (alertId: string) => void;
  loggedIn: boolean;
}

export interface SSHTunnelObjectProps {
  host: SSHHost;
  tunnelStatuses: Record<string, TunnelStatus>;
  tunnelActions: Record<string, boolean>;
  onTunnelAction: (
    action: "connect" | "disconnect" | "cancel",
    host: SSHHost,
    tunnelIndex: number,
  ) => Promise<void>;
  compact?: boolean;
  bare?: boolean;
}

export interface FolderStats {
  totalHosts: number;
  hostsByType: Array<{
    type: string;
    count: number;
  }>;
}

// ============================================================================
// SNIPPETS TYPES
// ============================================================================

export interface Snippet {
  id: number;
  userId: string;
  name: string;
  content: string;
  description?: string;
  folder?: string;
  order?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetData {
  name: string;
  content: string;
  description?: string;
  folder?: string;
  order?: number;
}

export interface SnippetFolder {
  id: number;
  userId: string;
  name: string;
  color?: string;
  icon?: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// BACKEND TYPES
// ============================================================================

export interface HostConfig {
  host: SSHHost;
  tunnels: TunnelConfig[];
}

export interface VerificationData {
  conn: Client;
  timeout: NodeJS.Timeout;
  startTime: number;
  attempts: number;
  maxAttempts: number;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type PartialExcept<T, K extends keyof T> = Partial<T> & Pick<T, K>;

// ============================================================================
// EXPRESS REQUEST TYPES
// ============================================================================

export interface AuthenticatedRequest extends Request {
  userId: string;
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
  fileManagerItemsImported: number;
  dismissedAlertsImported: number;
  credentialUsageImported: number;
  settingsImported: number;
  skippedItems: number;
  errors: string[];
}

export interface ImportResult {
  success: boolean;
  summary: ExportSummary;
}

export interface ExportRequestBody {
  password: string;
}

export interface ImportRequestBody {
  password: string;
}

export interface ExportPreviewBody {
  scope?: string;
  includeCredentials?: boolean;
}

export interface RestoreRequestBody {
  backupPath: string;
  targetPath?: string;
}
