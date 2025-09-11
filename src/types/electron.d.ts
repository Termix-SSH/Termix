interface ElectronAPI {
    getAppVersion: () => Promise<string>;
    getPlatform: () => Promise<string>;
    getServerConfig: () => Promise<{ serverUrl: string; lastUpdated: string } | null>;
    saveServerConfig: (config: { serverUrl: string; lastUpdated: string }) => Promise<{ success: boolean; error?: string }>;
    testServerConnection: (serverUrl: string) => Promise<{ success: boolean; error?: string; status?: number }>;
    showSaveDialog: (options: any) => Promise<any>;
    showOpenDialog: (options: any) => Promise<any>;
    onUpdateAvailable: (callback: () => void) => void;
    onUpdateDownloaded: (callback: () => void) => void;
    removeAllListeners: (channel: string) => void;
    isElectron: boolean;
    isDev: boolean;
    invoke: (channel: string, ...args: any[]) => Promise<any>;
}

interface Window {
    electronAPI?: ElectronAPI;
    IS_ELECTRON?: boolean;
}