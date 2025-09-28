export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;

  getServerConfig: () => Promise<any>;
  saveServerConfig: (config: any) => Promise<any>;
  testServerConnection: (serverUrl: string) => Promise<any>;

  showSaveDialog: (options: any) => Promise<any>;
  showOpenDialog: (options: any) => Promise<any>;

  onUpdateAvailable: (callback: Function) => void;
  onUpdateDownloaded: (callback: Function) => void;

  removeAllListeners: (channel: string) => void;
  isElectron: boolean;
  isDev: boolean;

  invoke: (channel: string, ...args: any[]) => Promise<any>;

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
