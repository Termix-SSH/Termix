const { contextBridge, ipcRenderer, webFrame } = require("electron");

const ALLOWED_INVOKE_CHANNELS = new Set([
  "get-desktop-settings",
  "get-previous-server-url",
  "save-desktop-settings",
  "allow-invalid-certificate-for-origin",
]);

function invokeAllowed(channel, ...args) {
  if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
    return Promise.reject(new Error(`IPC channel is not allowed: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

// The embedded backend's port, picked by the main process at startup.
const backendPortArg = process.argv.find((arg) =>
  arg.startsWith("--termix-backend-port="),
);
const backendPort = backendPortArg
  ? Number(backendPortArg.split("=")[1])
  : undefined;

contextBridge.exposeInMainWorld("electronAPI", {
  backendPort,
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  // Kept so the interface size can reset a zoom an earlier build applied.
  setZoomFactor: (factor) => {
    const value = Number(factor);
    if (!Number.isFinite(value)) return;
    webFrame.setZoomFactor(Math.min(2, Math.max(0.5, value)));
  },
  getPlatform: () => ipcRenderer.invoke("get-platform"),

  // Whether the app-drawn title bar shows in this window, and when it changes
  // (full screen hides it).
  getTitleBarVisible: () => ipcRenderer.invoke("get-title-bar-visible"),
  onTitleBarVisibleChange: (callback) => {
    const listener = (_event, visible) => callback(visible);
    ipcRenderer.on("title-bar-visible-changed", listener);
    return () =>
      ipcRenderer.removeListener("title-bar-visible-changed", listener);
  },
  // Keeps the window controls the system draws in the colors of the theme.
  setTitleBarOverlay: (colors) =>
    ipcRenderer.invoke("set-title-bar-overlay", colors),
  getEmbeddedServerStatus: () =>
    ipcRenderer.invoke("get-embedded-server-status"),

  // App Store builds are updated by the store.
  updates: process.mas
    ? undefined
    : {
        getState: () => ipcRenderer.invoke("desktop-update-get-state"),
        check: () => ipcRenderer.invoke("desktop-update-check"),
        download: () => ipcRenderer.invoke("desktop-update-download"),
        install: () => ipcRenderer.invoke("desktop-update-install"),
        setMode: (mode) => ipcRenderer.invoke("desktop-update-set-mode", mode),
        onState: (callback) => {
          const listener = (_event, state) => callback(state);
          ipcRenderer.on("desktop-update-state", listener);
          return () =>
            ipcRenderer.removeListener("desktop-update-state", listener);
        },
      },

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  isElectron: true,
  isDev: process.env.NODE_ENV === "development",

  getSetting: (key) => ipcRenderer.invoke("get-setting", key),
  setSetting: (key, value) => ipcRenderer.invoke("set-setting", key, value),

  onCloseActiveTab: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("close-active-tab", listener);
    return () => ipcRenderer.removeListener("close-active-tab", listener);
  },

  clearSessionCookies: () => ipcRenderer.invoke("clear-session-cookies"),

  externalBrowserLogin: (authUrl, callbackPort) =>
    ipcRenderer.invoke("external-browser-login", authUrl, callbackPort),

  showSaveDialog: (options) => ipcRenderer.invoke("show-save-dialog", options),
  showOpenDialog: (options) => ipcRenderer.invoke("show-open-dialog", options),
  createTempFile: (fileData) =>
    ipcRenderer.invoke("create-temp-file", fileData),
  createTempFolder: (folderData) =>
    ipcRenderer.invoke("create-temp-folder", folderData),
  startDragToDesktop: (dragData) =>
    ipcRenderer.invoke("start-drag-to-desktop", dragData),
  cleanupTempFile: (tempId) => ipcRenderer.invoke("cleanup-temp-file", tempId),

  // Native web views placed over an element of the page (WebContentsView).
  embeddedView: {
    open: (options) => ipcRenderer.invoke("embedded-view-open", options),
    setBounds: (id, bounds) =>
      ipcRenderer.invoke("embedded-view-bounds", id, bounds),
    setVisible: (id, visible) =>
      ipcRenderer.invoke("embedded-view-visible", id, visible),
    close: (id) => ipcRenderer.invoke("embedded-view-close", id),
  },

  invoke: invokeAllowed,
});

contextBridge.exposeInMainWorld("electronClipboard", {
  writeText: (text) => ipcRenderer.invoke("clipboard-write-text", text),
  readText: () => ipcRenderer.invoke("clipboard-read-text"),
});

window.IS_ELECTRON = true;
