const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
    // 获取后端端口
    getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
    
    // 获取应用版本
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // 获取平台信息
    getPlatform: () => ipcRenderer.invoke('get-platform'),
    
    // 重启后端
    restartBackend: () => ipcRenderer.invoke('restart-backend'),
    
    // 文件对话框
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    
    // 监听后端事件
    onBackendStarted: (callback) => {
        ipcRenderer.on('backend-started', (event, data) => callback(data));
    },
    
    onBackendLog: (callback) => {
        ipcRenderer.on('backend-log', (event, data) => callback(data));
    },
    
    onBackendError: (callback) => {
        ipcRenderer.on('backend-error', (event, data) => callback(data));
    },
    
    // 监听更新事件
    onUpdateAvailable: (callback) => {
        ipcRenderer.on('update-available', () => callback());
    },
    
    onUpdateDownloaded: (callback) => {
        ipcRenderer.on('update-downloaded', () => callback());
    },
    
    // 移除事件监听器
    removeAllListeners: (channel) => {
        ipcRenderer.removeAllListeners(channel);
    },
    
    // 环境检测
    isElectron: true,
    isDev: process.env.NODE_ENV === 'development',
});

// 添加一个标识，让渲染进程知道这是 Electron 环境
window.IS_ELECTRON = true;