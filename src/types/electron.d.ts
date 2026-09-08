interface ServerConfig {
  serverUrl?: string;
  allowInvalidCertificate?: boolean;
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
  openNativeRdp: (options: {
    host: string;
    port?: number;
    username?: string;
    domain?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  getSetting?: (key: string) => Promise<string | null | undefined>;
  setSetting?: (key: string, value: string) => Promise<void>;

  getServerConfig: () => Promise<ServerConfig>;
  saveServerConfig: (config: ServerConfig) => Promise<{ success: boolean }>;
  testServerConnection: (
    serverUrl: string,
    allowInvalidCertificate?: boolean,
  ) => Promise<ConnectionTestResult>;
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
  onRemoteSyncStatusChanged?: (
    callback: (status: {
      connected: boolean;
      syncing: boolean;
      lastSyncedAt: string | null;
      lastError: string | null;
      needsReauth: boolean;
    }) => void,
  ) => () => void;
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

  openExternalEditor: (fileData: {
    fileName: string;
    content: string;
    encoding?: "utf8" | "base64";
    editorPath?: string | null;
  }) => Promise<{
    success: boolean;
    editId?: string;
    path?: string;
    error?: string;
  }>;

  closeExternalEditor: (editId: string) => Promise<{
    success: boolean;
    error?: string;
  }>;

  onExternalEditorSaved?: (
    callback: (payload: {
      editId: string;
      content: string;
      encoding: "utf8";
      path: string;
    }) => void,
  ) => () => void;

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

  startLocalTerminal(dimensions: {
    cols: number;
    rows: number;
    shell?: "default" | "wsl";
  }): Promise<{ sessionId: string; shell: string }>;
  readyLocalTerminal(sessionId: string): Promise<boolean>;
  writeLocalTerminal(sessionId: string, data: string): Promise<boolean>;
  resizeLocalTerminal(
    sessionId: string,
    cols: number,
    rows: number,
  ): Promise<boolean>;
  closeLocalTerminal(sessionId: string): Promise<boolean>;
  onLocalTerminalData(
    sessionId: string,
    callback: (data: string) => void,
  ): () => void;
  onLocalTerminalExit(
    sessionId: string,
    callback: (exitCode: number) => void,
  ): () => void;

  /** Local disk browsing for the dual-pane file manager (desktop only). */
  localFs?: {
    home: () => Promise<LocalFsResult<LocalFsHomeInfo>>;
    list: (dirPath: string) => Promise<LocalFsResult<LocalDirectoryListing>>;
    mkdir: (
      parentPath: string,
      name: string,
    ) => Promise<LocalFsResult<{ path: string }>>;
    createFile: (
      parentPath: string,
      name: string,
    ) => Promise<LocalFsResult<{ path: string }>>;
    rename: (
      oldPath: string,
      newName: string,
    ) => Promise<LocalFsResult<{ path: string }>>;
    trash: (paths: string[]) => Promise<LocalFsResult<LocalTrashResult>>;
    ensureDir: (dirPath: string) => Promise<LocalFsResult<{ path: string }>>;
    walk: (paths: string[]) => Promise<LocalFsResult<LocalWalkResult>>;
    reveal: (targetPath: string) => Promise<LocalFsResult<unknown>>;
    open: (targetPath: string) => Promise<LocalFsResult<unknown>>;
  };

  /** Streamed local<->remote transfers driven by the main process. */
  localTransfer?: {
    upload: (
      options: LocalUploadRequest,
    ) => Promise<LocalFsResult<{ bytes: number }>>;
    download: (
      options: LocalDownloadRequest,
    ) => Promise<LocalFsResult<{ path: string }>>;
    cancel: (
      transferId: string,
    ) => Promise<LocalFsResult<{ cancelled: boolean }>>;
    onProgress: (
      callback: (payload: LocalTransferProgress) => void,
    ) => () => void;
  };
}

export type LocalFsResult<T> =
  ({ success: true } & T) | { success: false; error: string; code?: string };

export interface LocalFsHomeInfo {
  home: string;
  separator: string;
  platform: string;
}

export interface LocalFileEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "link";
  size: number;
  modifiedTimestamp?: number;
  linkTarget?: string;
  hidden: boolean;
}

export interface LocalDirectoryListing {
  path: string;
  parent: string | null;
  entries: LocalFileEntry[];
}

export interface LocalTrashResult {
  trashed: number;
  failed: Array<{ path: string; error: string }>;
}

export interface LocalWalkFile {
  localPath: string;
  /** Path relative to the drop root; "/"-separated and includes the root's own name. */
  relativePath: string;
  size: number;
}

export interface LocalWalkResult {
  files: LocalWalkFile[];
  emptyDirs: string[];
  totalBytes: number;
}

export interface LocalUploadRequest {
  transferId: string;
  url: string;
  headers: Record<string, string>;
  fields: Record<string, string>;
  localPath: string;
  fileName: string;
}

export interface LocalDownloadRequest {
  transferId: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  destPath: string;
  expectedSize?: number;
}

export interface LocalTransferProgress {
  transferId: string;
  transferred: number;
  total?: number;
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
