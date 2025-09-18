const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPlatform: () => ipcRenderer.invoke("get-platform"),

  getServerConfig: () => ipcRenderer.invoke("get-server-config"),
  saveServerConfig: (config) =>
    ipcRenderer.invoke("save-server-config", config),
  testServerConnection: (serverUrl) =>
    ipcRenderer.invoke("test-server-connection", serverUrl),

  showSaveDialog: (options) => ipcRenderer.invoke("show-save-dialog", options),
  showOpenDialog: (options) => ipcRenderer.invoke("show-open-dialog", options),

  onUpdateAvailable: (callback) => ipcRenderer.on("update-available", callback),
  onUpdateDownloaded: (callback) =>
    ipcRenderer.on("update-downloaded", callback),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  isElectron: true,
  isDev: process.env.NODE_ENV === "development",

  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // ================== 拖拽API ==================

  // 创建临时文件用于拖拽
  createTempFile: (fileData) =>
    ipcRenderer.invoke("create-temp-file", fileData),

  // 创建临时文件夹用于拖拽
  createTempFolder: (folderData) =>
    ipcRenderer.invoke("create-temp-folder", folderData),

  // 开始拖拽到桌面
  startDragToDesktop: (dragData) =>
    ipcRenderer.invoke("start-drag-to-desktop", dragData),

  // 清理临时文件
  cleanupTempFile: (tempId) => ipcRenderer.invoke("cleanup-temp-file", tempId),
});

window.IS_ELECTRON = true;

console.log("electronAPI exposed to window");
