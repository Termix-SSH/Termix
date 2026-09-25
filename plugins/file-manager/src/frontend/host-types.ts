/** A host as the shell hands it to the file manager. */
export interface SSHHost {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  folder: string;
  tags: string[];
  pin: boolean;
  authType: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  sudoPassword?: string;
  forceKeyboardInteractive?: boolean;
  credentialId?: number;
  overrideCredentialUsername?: boolean;
  userId?: string;
  jumpHosts?: Array<{ hostId: number }>;
  terminalConfig?: Record<string, unknown>;
  notes?: string;
  useSocks5?: boolean;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  socks5Password?: string;
  socks5ProxyChain?: unknown[];
  connectionType?: string;
  enableSsh?: boolean;
  syncId?: string | null;
  createdAt: string;
  updatedAt: string;
  connectionOrigin?: "local" | "remote" | null;
  instanceId?: string;
  isShared?: boolean;
  permissionLevel?: "connect" | "view" | "edit" | "manage";
  /** Enabled plugins' host-scope settings, keyed by plugin id. */
  pluginSettings?: Record<string, Record<string, unknown>>;
}

export interface FileItem {
  name: string;
  path: string;
  isPinned?: boolean;
  type: "file" | "directory" | "link";
  sshSessionId?: string;
  size?: number;
  modified?: string;
  modifiedTimestamp?: number;
  permissions?: string;
  owner?: string;
  group?: string;
  linkTarget?: string;
  executable?: boolean;
}
