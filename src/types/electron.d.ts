type BackendMode = "embedded" | "remote";
type EmbeddedBackendReason =
  | "missing_backend_build"
  | "startup_failed"
  | "unsupported_environment";

interface ElectronBackendConfig {
  backendMode: BackendMode;
  remoteServerUrl: string | null;
  lastUpdated: string;
}

interface EmbeddedServerStatus {
  running: boolean;
  embedded: boolean;
  available: boolean;
  backendMode: BackendMode | null;
  dataDir: string | null;
  entryPath: string | null;
  reason: EmbeddedBackendReason | null;
}

interface SaveBackendConfigResult {
  success: boolean;
  config?: ElectronBackendConfig;
  error?: string;
  reason?: EmbeddedBackendReason | null;
}

interface ElectronMenuContext {
  remoteAuthActive: boolean;
  canReloadRemoteAuth: boolean;
}

type ElectronMenuAction = "change-server" | "reload-remote-auth";

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

  getBackendConfig: () => Promise<ElectronBackendConfig | null>;
  saveBackendConfig: (
    config: ElectronBackendConfig,
  ) => Promise<SaveBackendConfigResult>;
  getServerConfig: () => Promise<ServerConfig>;
  saveServerConfig: (config: ServerConfig) => Promise<{ success: boolean }>;
  testServerConnection: (serverUrl: string) => Promise<ConnectionTestResult>;
  getEmbeddedServerStatus: () => Promise<EmbeddedServerStatus | null>;
  setMenuContext: (context: ElectronMenuContext) => Promise<void>;
  onMenuAction: (
    callback: (action: ElectronMenuAction) => void,
  ) => () => void;

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
      writeText(text: string): void;
      readText(): string;
    };
    configuredServerUrl?: string | null;
    backendMode?: BackendMode | null;
  }
}
