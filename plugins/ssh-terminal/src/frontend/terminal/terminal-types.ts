import type { HostSshOptions } from "@termix/plugin-sdk/frontend";

export interface TerminalHostConfig {
  id?: number;
  instanceId?: string;
  restoredSessionId?: string | null;
  /** Set when this tab joins someone else's live shared SSH session instead of connecting/attaching. */
  joinSharedSessionId?: string | null;
  joinShareId?: string | null;
  name?: string;
  ip: string;
  port: number;
  username: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  authType?: string;
  credentialId?: number;
  sshOptions?: HostSshOptions | null;
  [key: string]: unknown;
}

export interface TerminalHandle {
  disconnect: () => void;
  reconnect: () => void;
  reconnectIfDisconnected: () => boolean;
  isConnected: () => boolean;
  fit: () => void;
  focus: () => void;
  sendInput: (data: string) => void;
  subscribeOutput: (listener: (data: string) => void) => () => void;
  paste: (text: string) => void;
  notifyResize: () => void;
  refresh: () => void;
  getApplicationCursorKeysMode: () => boolean;
}
