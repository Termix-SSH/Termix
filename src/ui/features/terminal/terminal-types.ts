import type { TerminalConfig } from "@/types";

export interface TerminalHostConfig {
  id?: number;
  instanceId?: string;
  restoredSessionId?: string | null;
  /** Set when this tab joins someone else's live shared SSH session instead of connecting/attaching. */
  joinSharedSessionId?: string | null;
  joinShareId?: string | null;
  ip: string;
  port: number;
  username: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  authType?: string;
  credentialId?: number;
  terminalConfig?: TerminalConfig;
  [key: string]: unknown;
}

export interface TerminalHandle {
  disconnect: () => void;
  reconnect: () => void;
  isConnected: () => boolean;
  fit: () => void;
  focus: () => void;
  sendInput: (data: string) => void;
  paste: (text: string) => void;
  notifyResize: () => void;
  refresh: () => void;
  getApplicationCursorKeysMode: () => boolean;
  openShareModal: () => void;
  canShare: () => boolean;
}
