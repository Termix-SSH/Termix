// Desktop-only settings kept next to the app's data, and the server address
// older versions saved, so linking can offer it again.

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

function dataPath(filename) {
  return path.join(app.getPath("userData"), filename);
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

const DEFAULTS = {
  defaultConnectionOrigin: "local",
  updateMode: "prompt",
  macTrayIcon: "monochrome",
  closeToTray: true,
  trayNoticeShown: false,
};

// The settings the app's page may change. The rest are set by the main
// process itself, so a page can never write anything else to this file.
const RENDERER_SETTINGS = {
  defaultConnectionOrigin: (value) => value === "local" || value === "remote",
  closeToTray: (value) => typeof value === "boolean",
};

function rendererSettings(settings) {
  const picked = {};
  if (!settings || typeof settings !== "object") return picked;
  for (const [key, valid] of Object.entries(RENDERER_SETTINGS)) {
    if (Object.hasOwn(settings, key) && valid(settings[key])) {
      picked[key] = settings[key];
    }
  }
  return picked;
}

function getDesktopSettings() {
  return { ...DEFAULTS, ...readJson(dataPath("desktop-settings.json"), {}) };
}

function saveDesktopSettings(settings) {
  writeJson(dataPath("desktop-settings.json"), {
    ...getDesktopSettings(),
    ...settings,
  });
  return { success: true };
}

// The server a 2.8 or older desktop was pointed at, if any.
function getPreviousServerUrl() {
  for (const file of ["remote-sync-config.json", "server-config.json"]) {
    const config = readJson(dataPath(file), null);
    if (config && typeof config.serverUrl === "string" && config.serverUrl) {
      return config.serverUrl;
    }
  }
  return null;
}

// The old sync engine's session and cursors are useless to the new one,
// and the session is a credential, so they go.
function removeOldSyncFiles() {
  for (const file of [
    "remote-sync-credential.json",
    "remote-sync-state.json",
  ]) {
    try {
      fs.rmSync(dataPath(file), { force: true });
    } catch {
      // Best effort.
    }
  }
}

module.exports = {
  rendererSettings,
  getDesktopSettings,
  saveDesktopSettings,
  getPreviousServerUrl,
  removeOldSyncFiles,
};
