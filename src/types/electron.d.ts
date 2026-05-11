interface ServerConfig {
  serverUrl?: string;
  [key: string]: unknown;
}

interface ConnectionTestResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

interface DialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: string[];
  [key: string]: unknown;
}

interface DialogResult {
  canceled: boolean;
  filePath?: string;
  filePaths?: string[];
  [key: string]: unknown;
}

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;

  getServerConfig: () => Promise<ServerConfig>;
  saveServerConfig: (config: ServerConfig) => Promise<{ success: boolean }>;
  testServerConnection: (serverUrl: string) => Promise<ConnectionTestResult>;
  getC2STunnelConfig: () => Promise<unknown[]>;
  saveC2STunnelConfig: (
    config: unknown[],
  ) => Promise<{ success: boolean; error?: string }>;
  checkLocalPortAvailable: (
    host: string,
    port: number,
  ) => Promise<{ available: boolean; error?: string }>;
  getC2STunnelPresetDefaultName: () => Promise<string>;
  startC2STunnel: (
    tunnel: unknown,
    index: number,
  ) => Promise<{ success: boolean; tunnelName?: string; error?: string }>;
  testC2STunnel: (
    tunnel: unknown,
    index: number,
  ) => Promise<{ success: boolean; message?: string; error?: string }>;
  stopC2STunnel: (
    tunnelName: string,
  ) => Promise<{ success: boolean; error?: string }>;
  getC2STunnelStatuses: () => Promise<Record<string, unknown>>;
  onC2STunnelStatuses?: (
    callback: (statuses: Record<string, unknown>) => void,
  ) => () => void;
  startC2SAutoStartTunnels: () => Promise<{
    success: boolean;
    started: number;
    errors: string[];
  }>;
  clearSessionCookies: () => Promise<void>;
  getSessionCookie: (
    name: string,
    targetUrl?: string,
  ) => Promise<string | null>;
  waitForSessionCookie: (
    name: string,
    targetUrl?: string,
    previousValue?: string | null,
    timeoutMs?: number,
  ) => Promise<{ success: boolean; value?: string; error?: string }>;

  showSaveDialog: (options: DialogOptions) => Promise<DialogResult>;
  showOpenDialog: (options: DialogOptions) => Promise<DialogResult>;

  onUpdateAvailable: (callback: () => void) => void;
  onUpdateDownloaded: (callback: () => void) => void;

  removeAllListeners: (channel: string) => void;
  isElectron: boolean;
  isDev: boolean;

  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;

  createTempFile: (fileData: {
    fileName: string;
    content: string;
    encoding?: "base64" | "utf8";
  }) => Promise<{
    success: boolean;
    tempId?: string;
    path?: string;
    error?: string;
  }>;

  createTempFolder: (folderData: {
    folderName: string;
    files: Array<{
      relativePath: string;
      content: string;
      encoding?: "base64" | "utf8";
    }>;
  }) => Promise<{
    success: boolean;
    tempId?: string;
    path?: string;
    error?: string;
  }>;

  startDragToDesktop: (dragData: {
    tempId: string;
    fileName: string;
  }) => Promise<{
    success: boolean;
    error?: string;
  }>;

  cleanupTempFile: (tempId: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    IS_ELECTRON: boolean;
    electronClipboard?: {
      writeText(text: string): Promise<boolean>;
      readText(): Promise<string>;
    };
  }
}
