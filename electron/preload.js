const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loaded');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // App info
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    getPlatform: () => ipcRenderer.invoke('get-platform'),
    
    // Server configuration
    getServerConfig: () => ipcRenderer.invoke('get-server-config'),
    saveServerConfig: (config) => ipcRenderer.invoke('save-server-config', config),
    testServerConnection: (serverUrl) => ipcRenderer.invoke('test-server-connection', serverUrl),
    
    // File dialogs
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    
    // Update events
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
    
    // Utility
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
    isElectron: true,
    isDev: process.env.NODE_ENV === 'development',
    
    // Generic invoke method
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    
    // OIDC handlers
    oidcSuccess: (data) => ipcRenderer.invoke('oidc-success', data),
    oidcError: (data) => ipcRenderer.invoke('oidc-error', data)
});

// Also set the legacy IS_ELECTRON flag for backward compatibility
window.IS_ELECTRON = true;

console.log('electronAPI exposed to window');
