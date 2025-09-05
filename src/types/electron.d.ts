interface ElectronAPI {
    getBackendPort: () => Promise<number>;
    getAppVersion: () => Promise<string>;
    getPlatform: () => Promise<string>;
    restartBackend: () => Promise<{ success: boolean; port?: number; error?: string }>;
    showSaveDialog: (options: any) => Promise<any>;
    showOpenDialog: (options: any) => Promise<any>;
    onBackendStarted: (callback: (data: { port: number }) => void) => void;
    onBackendLog: (callback: (data: string) => void) => void;
    onBackendError: (callback: (data: string) => void) => void;
    onUpdateAvailable: (callback: () => void) => void;
    onUpdateDownloaded: (callback: () => void) => void;
    removeAllListeners: (channel: string) => void;
    isElectron: boolean;
    isDev: boolean;
}

interface Window {
    electronAPI?: ElectronAPI;
    IS_ELECTRON?: boolean;
}