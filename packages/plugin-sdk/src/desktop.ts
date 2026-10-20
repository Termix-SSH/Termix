/**
 * The desktop app's bridge (window.electronAPI), typed for plugins. It exists
 * only inside the Termix desktop app; check isElectron before calling it.
 */

export interface ServerConfig {
  serverUrl?: string;
  allowInvalidCertificate?: boolean;
  [key: string]: unknown;
}

export interface ConnectionTestResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface DialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: string[];
  [key: string]: unknown;
}

export interface DialogResult {
  canceled: boolean;
  filePath?: string;
  filePaths?: string[];
  [key: string]: unknown;
}

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  setZoomFactor?: (factor: number) => void;
  getPlatform: () => Promise<string>;
  /** Whether the app-drawn title bar shows in this window. */
  getTitleBarVisible?: () => Promise<boolean>;
  /** Calls back when the title bar shows or hides; returns an unsubscribe. */
  onTitleBarVisibleChange?: (
    callback: (visible: boolean) => void,
  ) => () => void;
  /** Keeps the window controls the system draws in the colors of the theme. */
  setTitleBarOverlay?: (colors: {
    color?: string;
    symbolColor?: string;
  }) => Promise<void>;
  getSetting?: (key: string) => Promise<string | null | undefined>;
  setSetting?: (key: string, value: string) => Promise<void>;

  getServerConfig: () => Promise<ServerConfig>;
  saveServerConfig: (config: ServerConfig) => Promise<{ success: boolean }>;
  testServerConnection: (
    serverUrl: string,
    allowInvalidCertificate?: boolean,
  ) => Promise<ConnectionTestResult>;
  onCloseActiveTab?: (callback: () => void) => () => void;
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
