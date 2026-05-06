const { contextBridge, ipcRenderer } = require("electron");

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
  startC2STunnel: (tunnel, index) =>
    ipcRenderer.invoke("start-c2s-tunnel", tunnel, index),
  testC2STunnel: (tunnel, index) =>
    ipcRenderer.invoke("test-c2s-tunnel", tunnel, index),
  stopC2STunnel: (tunnelName) =>
    ipcRenderer.invoke("stop-c2s-tunnel", tunnelName),
  getC2STunnelStatuses: () => ipcRenderer.invoke("get-c2s-tunnel-statuses"),
  onC2STunnelStatuses: (callback) => {
    const listener = (_event, statuses) => callback(statuses);
    ipcRenderer.on("c2s-tunnel-statuses", listener);
    return () => ipcRenderer.removeListener("c2s-tunnel-statuses", listener);
  },
  startC2SAutoStartTunnels: () =>
    ipcRenderer.invoke("start-c2s-autostart-tunnels"),

  clearSessionCookies: () => ipcRenderer.invoke("clear-session-cookies"),
  getSessionCookie: (name, targetUrl) =>
    ipcRenderer.invoke("get-session-cookie", name, targetUrl),
  waitForSessionCookie: (name, targetUrl, previousValue, timeoutMs) =>
    ipcRenderer.invoke(
      "wait-session-cookie",
      name,
      targetUrl,
      previousValue,
      timeoutMs,
    ),

  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

contextBridge.exposeInMainWorld("electronClipboard", {
  writeText: (text) => ipcRenderer.invoke("clipboard-write-text", text),
  readText: () => ipcRenderer.invoke("clipboard-read-text"),
});

window.IS_ELECTRON = true;
