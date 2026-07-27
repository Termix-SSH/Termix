const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  isElectron: true,
  isDev: process.env.NODE_ENV === "development",

  getSetting: (key) => ipcRenderer.invoke("get-setting", key),
  setSetting: (key, value) => ipcRenderer.invoke("set-setting", key, value),
  getAiSettings: () => ipcRenderer.invoke("get-ai-settings"),
  saveAiSettings: (settings) =>
    ipcRenderer.invoke("save-ai-settings", settings),
  testAiSettings: (settings) =>
    ipcRenderer.invoke("test-ai-settings", settings),
  clearAiSettings: () => ipcRenderer.invoke("clear-ai-settings"),
  generateTerminalCommand: (payload) =>
    ipcRenderer.invoke("generate-terminal-command", payload),
  startTerminalAgentSession: (payload) =>
    ipcRenderer.invoke("start-terminal-agent-session", payload),
  continueTerminalAgentSession: (payload) =>
    ipcRenderer.invoke("continue-terminal-agent-session", payload),
  cancelTerminalAgentSession: (sessionId) =>
    ipcRenderer.invoke("cancel-terminal-agent-session", sessionId),
  getC2STunnelConfig: () => ipcRenderer.invoke("get-c2s-tunnel-config"),
  saveC2STunnelConfig: (config) =>
    ipcRenderer.invoke("save-c2s-tunnel-config", config),
  checkLocalPortAvailable: (host, port) =>
    ipcRenderer.invoke("check-local-port-available", host, port),
  getC2STunnelPresetDefaultName: () =>
    ipcRenderer.invoke("get-c2s-tunnel-preset-default-name"),
  startC2STunnel: (tunnel, index, authToken) =>
    ipcRenderer.invoke("start-c2s-tunnel", tunnel, index, authToken),
  testC2STunnel: (tunnel, index, authToken) =>
    ipcRenderer.invoke("test-c2s-tunnel", tunnel, index, authToken),
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

  onRemoteSyncStatusChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("remote-sync-status-changed", listener);
    return () =>
      ipcRenderer.removeListener("remote-sync-status-changed", listener);
  },

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

  oidcSystemBrowserAuth: (authUrl, callbackPort) =>
    ipcRenderer.invoke("oidc-system-browser-auth", authUrl, callbackPort),

  openExternalEditor: (fileData) =>
    ipcRenderer.invoke("open-external-editor", fileData),
  closeExternalEditor: (editId) =>
    ipcRenderer.invoke("close-external-editor", editId),
  onExternalEditorSaved: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("external-editor-saved", listener);
    return () => ipcRenderer.removeListener("external-editor-saved", listener);
  },

  showSaveDialog: (options) => ipcRenderer.invoke("show-save-dialog", options),
  showOpenDialog: (options) => ipcRenderer.invoke("show-open-dialog", options),
  getLocalHomeDirectory: () => ipcRenderer.invoke("get-local-home-directory"),
  listLocalDirectory: (dirPath) =>
    ipcRenderer.invoke("list-local-directory", dirPath),
  statLocalPaths: (paths) => ipcRenderer.invoke("stat-local-paths", paths),
  collectLocalFiles: (paths) =>
    ipcRenderer.invoke("collect-local-files", paths),
  readLocalFile: (filePath) => ipcRenderer.invoke("read-local-file", filePath),
  createLocalFolder: (parentPath, folderName) =>
    ipcRenderer.invoke("create-local-folder", parentPath, folderName),
  renameLocalPath: (entryPath, newName) =>
    ipcRenderer.invoke("rename-local-path", entryPath, newName),
  trashLocalPath: (entryPath) =>
    ipcRenderer.invoke("trash-local-path", entryPath),
  chmodLocalPath: (entryPath, permissions) =>
    ipcRenderer.invoke("chmod-local-path", entryPath, permissions),
  writeLocalFile: (targetDir, fileName, data) =>
    ipcRenderer.invoke("write-local-file", targetDir, fileName, data),
  createTempFile: (fileData) =>
    ipcRenderer.invoke("create-temp-file", fileData),
  createTempFolder: (folderData) =>
    ipcRenderer.invoke("create-temp-folder", folderData),
  startDragToDesktop: (dragData) =>
    ipcRenderer.invoke("start-drag-to-desktop", dragData),
  cleanupTempFile: (tempId) => ipcRenderer.invoke("cleanup-temp-file", tempId),

  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
});

contextBridge.exposeInMainWorld("electronClipboard", {
  writeText: (text) => ipcRenderer.invoke("clipboard-write-text", text),
  readText: () => ipcRenderer.invoke("clipboard-read-text"),
});

window.IS_ELECTRON = true;
