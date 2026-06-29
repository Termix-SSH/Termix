import type { TerminalConfig } from "@/types";

export interface TerminalHostConfig {
  id?: number;
  instanceId?: string;
  restoredSessionId?: string | null;
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
  notifyResize: () => void;
  refresh: () => void;
  getApplicationCursorKeysMode: () => boolean;
}
