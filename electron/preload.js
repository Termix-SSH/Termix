const { contextBridge, ipcRenderer } = require("electron");
const { clipboard } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  isElectron: true,
  isDev: process.env.NODE_ENV === "development",

  getSetting: (key) => ipcRenderer.invoke("get-setting", key),
  setSetting: (key, value) => ipcRenderer.invoke("set-setting", key, value),
  getC2STunnelConfig: () => ipcRenderer.invoke("get-c2s-tunnel-config"),
  saveC2STunnelConfig: (config) =>
    ipcRenderer.invoke("save-c2s-tunnel-config", config),
  checkLocalPortAvailable: (host, port) =>
    ipcRenderer.invoke("check-local-port-available", host, port),
  getC2STunnelPresetDefaultName: () =>
    ipcRenderer.invoke("get-c2s-tunnel-preset-default-name"),

  clearSessionCookies: () => ipcRenderer.invoke("clear-session-cookies"),

  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

contextBridge.exposeInMainWorld("electronClipboard", {
  writeText: (text) => clipboard.writeText(text),
  readText: () => clipboard.readText(),
});

window.IS_ELECTRON = true;
