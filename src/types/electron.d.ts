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

export interface LocalFileEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "link" | "other";
  size: number;
  created?: string;
  modified: string;
  permissions?: string;
  owner?: string;
  group?: string;
}

export interface LocalDirectoryResult {
  success: boolean;
  path: string;
  parent?: string;
  entries: LocalFileEntry[];
  error?: string;
}

export interface LocalCollectedFile {
  path: string;
  name: string;
  relativePath: string;
  size: number;
  created?: string;
  modified: string;
}

export interface LocalFileReadResult {
  success: boolean;
  path?: string;
  name?: string;
  size?: number;
  data?: string;
  error?: string;
}

export type LocalPathMutationResult =
  | ({ success: true } & Partial<LocalFileEntry>)
  | { success: false; error?: string };

export interface ElectronAiSettings {
  enabled: boolean;
  provider: "openai-compatible";
  baseUrl: string;
  model: string;
  includeContext: boolean;
  hasApiKey: boolean;
  apiKey?: string;
  secureStorageAvailable: boolean;
}

export interface ElectronAiSettingsUpdate {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  includeContext?: boolean;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface ElectronAiCommandContext {
  hostName?: string;
  username?: string;
  currentCommand?: string;
  promptPath?: string;
  visibleOutput?: string;
}

export interface ElectronAiCommandResult {
  command: string;
  explanation: string;
  warnings: string[];
}

export type ElectronTerminalAgentMode = "safe" | "yolo";

export type ElectronTerminalAgentAction =
  | {
      type: "run_command";
      command: string;
      message?: string;
      warnings: string[];
      risky: boolean;
    }
  | {
      type: "ask_user" | "final_answer";
      message: string;
      warnings: string[];
      risky: false;
    };

export interface ElectronTerminalAgentPayload {
  sessionId?: string;
  prompt?: string;
  message?: string;
  observation?: string;
  mode?: ElectronTerminalAgentMode;
  context?: ElectronAiCommandContext;
}

export interface ElectronTerminalAgentResult {
  success: boolean;
  sessionId?: string;
  action?: ElectronTerminalAgentAction;
  error?: string;
}

export interface ElectronAiResult<T = unknown> {
  success: boolean;
  settings?: ElectronAiSettings;
  result?: T;
  error?: string;
}

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  getSetting?: (key: string) => Promise<string | null | undefined>;
  setSetting?: (key: string, value: string) => Promise<void>;
  getAiSettings?: () => Promise<ElectronAiResult>;
  saveAiSettings?: (
    settings: ElectronAiSettingsUpdate,
  ) => Promise<ElectronAiResult>;
  testAiSettings?: (
    settings?: ElectronAiSettingsUpdate,
  ) => Promise<ElectronAiResult>;
  clearAiSettings?: () => Promise<ElectronAiResult>;
  generateTerminalCommand?: (payload: {
    prompt: string;
    context?: ElectronAiCommandContext;
  }) => Promise<ElectronAiResult<ElectronAiCommandResult>>;
  startTerminalAgentSession?: (
    payload: ElectronTerminalAgentPayload,
  ) => Promise<ElectronTerminalAgentResult>;
  continueTerminalAgentSession?: (
    payload: ElectronTerminalAgentPayload,
  ) => Promise<ElectronTerminalAgentResult>;
  cancelTerminalAgentSession?: (
    sessionId: string,
  ) => Promise<{ success: boolean; error?: string }>;

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
    authToken?: string,
  ) => Promise<{
    success: boolean;
    tunnelName?: string;
    error?: string;
    code?: string;
  }>;
  testC2STunnel: (
    tunnel: unknown,
    index: number,
    authToken?: string,
  ) => Promise<{
    success: boolean;
    message?: string;
    error?: string;
    code?: string;
  }>;
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
  getLocalHomeDirectory?: () => Promise<string>;
  listLocalDirectory?: (path?: string) => Promise<LocalDirectoryResult>;
  statLocalPaths?: (
    paths: string[],
  ) => Promise<
    Array<
      | (LocalFileEntry & { success: true })
      | { success: false; path: string; error?: string }
    >
  >;
  collectLocalFiles?: (paths: string[]) => Promise<{
    success: boolean;
    files: LocalCollectedFile[];
    truncated?: boolean;
    error?: string;
  }>;
  readLocalFile?: (path: string) => Promise<LocalFileReadResult>;
  createLocalFolder?: (
    parentPath: string,
    folderName: string,
  ) => Promise<LocalPathMutationResult>;
  renameLocalPath?: (
    path: string,
    newName: string,
  ) => Promise<LocalPathMutationResult>;
  trashLocalPath?: (path: string) => Promise<LocalPathMutationResult>;
  chmodLocalPath?: (
    path: string,
    permissions: string,
  ) => Promise<LocalPathMutationResult>;
  writeLocalFile?: (
    targetDir: string,
    fileName: string,
    data: string,
  ) => Promise<LocalPathMutationResult>;

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
