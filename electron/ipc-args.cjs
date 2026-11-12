// The argument check for every IPC channel that takes arguments. Each one
// returns the list of arguments its handler gets.

const { validators: v } = require("./ipc-guard.cjs");

const UPDATE_MODES = new Set(["automatic", "prompt", "never"]);

const IPC_ARGS = {
  "embedded-view-open": (options) => [v.viewOpen(options)],
  "embedded-view-bounds": (id, bounds) => [v.viewId(id), v.bounds(bounds)],
  "embedded-view-visible": (id, visible) => [v.viewId(id), visible === true],
  "embedded-view-close": (id) => [v.viewId(id)],
  "allow-invalid-certificate-for-origin": (origin) => [
    v.string(origin, { min: 1, max: 2048, name: "origin" }),
  ],
  "set-title-bar-overlay": (colors) => [v.titleBarColors(colors)],
  // The handler answers a bad URL or port itself, so only types are checked.
  "external-browser-login": (authUrl, callbackPort) => [
    v.string(authUrl, { min: 1, max: 8192, name: "authUrl" }),
    Number.isInteger(callbackPort) ? callbackPort : -1,
  ],
  "save-desktop-settings": (settings) => [v.plainObject(settings, "settings")],
  "set-tray-notice-text": (text) => [v.trayNotice(text)],
  "desktop-update-set-mode": (mode) => {
    if (!UPDATE_MODES.has(mode)) throw new Error("Unknown update mode");
    return [mode];
  },
  "get-setting": (key) => [v.settingKey(key)],
  "set-setting": (key, value) => [v.settingKey(key), v.settingValue(value)],
  "clipboard-write-text": (text) => [v.clipboardText(text)],
  "show-save-dialog": (options) => [v.dialogOptions(options)],
  "show-open-dialog": (options) => [v.dialogOptions(options)],
  "create-temp-file": (data) => [v.tempFile(data)],
  "create-temp-folder": (data) => [v.tempFolder(data)],
  "start-drag-to-desktop": (data) => [{ tempId: v.tempId(data?.tempId) }],
  "start-drag-files": (ids) => [v.tempIds(ids)],
  "cleanup-temp-file": (id) => [v.tempId(id)],
};

module.exports = { IPC_ARGS };
