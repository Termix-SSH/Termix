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
  }
}
