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

  // ================== Drag & Drop API ==================

  // Create temporary file for dragging
  createTempFile: (fileData) =>
    ipcRenderer.invoke("create-temp-file", fileData),

  // Create temporary folder for dragging
  createTempFolder: (folderData) =>
    ipcRenderer.invoke("create-temp-folder", folderData),

  // Start dragging to desktop
  startDragToDesktop: (dragData) =>
    ipcRenderer.invoke("start-drag-to-desktop", dragData),

  // Cleanup temporary files
  cleanupTempFile: (tempId) => ipcRenderer.invoke("cleanup-temp-file", tempId),
});

window.IS_ELECTRON = true;

console.log("electronAPI exposed to window");
