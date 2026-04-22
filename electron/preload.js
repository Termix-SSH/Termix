const { contextBridge, ipcRenderer } = require("electron");
const { clipboard } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  isElectron: true,
  isDev: process.env.NODE_ENV === "development",

  getSetting: (key) => ipcRenderer.invoke("get-setting", key),
  setSetting: (key, value) => ipcRenderer.invoke("set-setting", key, value),

  clearSessionCookies: () => ipcRenderer.invoke("clear-session-cookies"),
  setMenuContext: (context) => ipcRenderer.invoke("set-menu-context", context),
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("menu-action", listener);
    return () => ipcRenderer.removeListener("menu-action", listener);
  },

  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

contextBridge.exposeInMainWorld("electronClipboard", {
  writeText: (text) => clipboard.writeText(text),
  readText: () => clipboard.readText(),
});

window.IS_ELECTRON = true;
