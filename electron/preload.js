const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  checkElectronUpdate: () => ipcRenderer.invoke("check-electron-update"),

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

  // Settings/preferences storage
  getSetting: (key) => ipcRenderer.invoke("get-setting", key),
  setSetting: (key, value) => ipcRenderer.invoke("set-setting", key, value),

  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

window.IS_ELECTRON = true;
