const { contextBridge, ipcRenderer } = require('electron');

// 暴露简化的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
    // 获取应用版本
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // 获取平台信息
    getPlatform: () => ipcRenderer.invoke('get-platform'),
    
    // 获取后端端口
    getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
    
    // 重启后端服务
    restartBackend: () => ipcRenderer.invoke('restart-backend'),
    
    // 环境检测
    isElectron: true,
    isDev: process.env.NODE_ENV === 'development',
});

// 添加一个标识，让渲染进程知道这是 Electron 环境
// 在上下文隔离环境中，使用 contextBridge 暴露
contextBridge.exposeInMainWorld('IS_ELECTRON', true);