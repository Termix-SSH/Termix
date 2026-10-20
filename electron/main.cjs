const {
  app,
  BrowserWindow,
  WebContentsView,
  shell,
  ipcMain,
  dialog,
  Menu,
  session,
  safeStorage,
  Tray,
  clipboard,
  nativeImage,
} = require("electron");
const path = require("path");
const { getUnpackedAppRoot } = require("./backend-paths.cjs");
const { classifyBackendFailure } = require("./backend-failure.cjs");
const fs = require("fs");
const http = require("http");
const net = require("net");
const tls = require("tls");
const zlib = require("zlib");
const crypto = require("crypto");
const { URL, pathToFileURL } = require("url");
const { fork } = require("child_process");
const linkedServer = require("./linked-server.cjs");
const desktopSettings = require("./desktop-settings.cjs");
const autoUpdates = require("./auto-updater.cjs");
const { isCloseActiveTabInput } = require("./keyboard-shortcuts.cjs");
const { quitApp } = require("./app-quit.cjs");
const { selectLinuxPasswordStore } = require("./linux-password-store.cjs");
// Saved by the file manager after the user picks an editor in a file dialog.
const EXTERNAL_EDITOR_SETTING = "fileManager.externalEditorPath";

// The height of the title bar the app draws itself. The renderer uses the
// same number, so the bar and the window controls always line up.
const TITLE_BAR_HEIGHT = 40;
const { isExternalLoginUrl, isCallbackPort } = require("./external-login.cjs");

// The main process's Node.js networking (the global `fetch`) only
// trusts Node's bundled Mozilla CA list by default, not the OS/system trust
// store. Chromium (the renderer, i.e. the web app and the login iframe) uses
// the OS trust store instead, so a certificate that's valid in-browser --
// e.g. one issued by a reverse proxy's internal/corporate CA, or a system
// CA installed via Keychain/certmgr -- can still fail main-process requests
// with UNABLE_TO_VERIFY_LEAF_SIGNATURE. Merge the system store in so remote
// sync and the connection health check see the same trust as the browser.
try {
  if (typeof tls.setDefaultCACertificates === "function") {
    tls.setDefaultCACertificates([
      ...tls.getCACertificates("default"),
      ...tls.getCACertificates("system"),
    ]);
  }
} catch (error) {
  console.error("Failed to merge system CA certificates:", error);
}

// Portable mode: if a `.portable` marker exists next to the executable,
// store all data in a `data` folder beside the exe instead of %APPDATA%.
(function setupPortableDataDir() {
  const exeDir = path.dirname(process.execPath);
  const markerPath = path.join(exeDir, ".portable");
  const envOverride = process.env.TERMIX_DATA_DIR;

  let portableDataDir = null;
  if (envOverride) {
    portableDataDir = envOverride;
  } else if (app.isPackaged && fs.existsSync(markerPath)) {
    portableDataDir = path.join(exeDir, "data");
  }

  if (portableDataDir) {
    try {
      if (!fs.existsSync(portableDataDir)) {
        fs.mkdirSync(portableDataDir, { recursive: true });
      }
      app.setPath("userData", portableDataDir);
    } catch {
      // Fall back to default userData if we can't create the directory.
    }
  }
})();

const logFile = path.join(app.getPath("userData"), "termix-main.log");
const electronAuthCookiesPath = path.join(
  app.getPath("userData"),
  "electron-auth-cookies.json",
);
const electronAuthCookies = new Map();

function logToFile(...args) {
  const timestamp = new Date().toISOString();
  const msg = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
    .join(" ");
  const line = `[${timestamp}] ${msg}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    // ignore
  }
  console.log(...args);
}

function getCookieOrigin(url) {
  try {
    const parsedUrl = new URL(url);
    const protocol =
      parsedUrl.protocol === "ws:"
        ? "http:"
        : parsedUrl.protocol === "wss:"
          ? "https:"
          : parsedUrl.protocol;
    return `${protocol}//${parsedUrl.host}`;
  } catch {
    return null;
  }
}

function parseCookieTarget(url) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === "ws:") {
      parsedUrl.protocol = "http:";
    } else if (parsedUrl.protocol === "wss:") {
      parsedUrl.protocol = "https:";
    }
    return parsedUrl;
  } catch {
    return null;
  }
}

function getElectronAuthCookieKey(name, origin) {
  return origin ? `${origin}|${name}` : null;
}

function getSafeStorageAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encodeElectronAuthCookieValue(value) {
  return {
    encrypted: true,
    value: safeStorage.encryptString(value).toString("base64"),
  };
}

function decodeElectronAuthCookieValue(record) {
  if (!record.encrypted || !getSafeStorageAvailable()) {
    return null;
  }

  try {
    return safeStorage.decryptString(Buffer.from(record.value, "base64"));
  } catch (error) {
    logToFile(
      "Failed to decrypt persisted Electron auth cookie:",
      error.message,
    );
    return null;
  }
}

function isElectronAuthCookieExpired(cookie) {
  return Number.isFinite(cookie.expiresAt) && cookie.expiresAt <= Date.now();
}

function saveElectronAuthCookiesToDisk() {
  try {
    if (!getSafeStorageAvailable()) {
      if (fs.existsSync(electronAuthCookiesPath)) {
        fs.rmSync(electronAuthCookiesPath, { force: true });
      }
      return;
    }

    const records = [];

    for (const [key, cookie] of electronAuthCookies.entries()) {
      if (isElectronAuthCookieExpired(cookie)) {
        electronAuthCookies.delete(key);
        continue;
      }

      records.push({
        key,
        name: cookie.name,
        origin: cookie.origin,
        path: cookie.path,
        expiresAt: cookie.expiresAt,
        ...encodeElectronAuthCookieValue(cookie.value),
      });
    }

    fs.writeFileSync(
      electronAuthCookiesPath,
      JSON.stringify({ version: 1, records }, null, 2),
    );
  } catch (error) {
    logToFile("Failed to persist Electron auth cookies:", error.message);
  }
}

function loadElectronAuthCookiesFromDisk() {
  electronAuthCookies.clear();

  try {
    if (!getSafeStorageAvailable()) {
      if (fs.existsSync(electronAuthCookiesPath)) {
        fs.rmSync(electronAuthCookiesPath, { force: true });
      }
      return;
    }

    if (!fs.existsSync(electronAuthCookiesPath)) {
      return;
    }

    const data = JSON.parse(fs.readFileSync(electronAuthCookiesPath, "utf8"));
    const records = Array.isArray(data.records) ? data.records : [];

    for (const record of records) {
      if (
        !record ||
        typeof record.key !== "string" ||
        typeof record.name !== "string" ||
        typeof record.origin !== "string"
      ) {
        continue;
      }

      const value = decodeElectronAuthCookieValue(record);
      if (!value) {
        continue;
      }

      const cookie = {
        name: record.name,
        value,
        origin: record.origin,
        path: typeof record.path === "string" ? record.path : "/",
        expiresAt: Number.isFinite(record.expiresAt) ? record.expiresAt : null,
      };

      if (!isElectronAuthCookieExpired(cookie)) {
        electronAuthCookies.set(record.key, cookie);
      }
    }

    saveElectronAuthCookiesToDisk();
  } catch (error) {
    logToFile("Failed to load persisted Electron auth cookies:", error.message);
  }
}

function clearPersistedElectronAuthCookies() {
  electronAuthCookies.clear();
  try {
    if (fs.existsSync(electronAuthCookiesPath)) {
      fs.rmSync(electronAuthCookiesPath, { force: true });
    }
  } catch (error) {
    logToFile(
      "Failed to clear persisted Electron auth cookies:",
      error.message,
    );
  }
}

function parseSetCookieHeader(header) {
  const [cookiePair, ...attributes] = String(header || "").split(";");
  const separatorIndex = cookiePair.indexOf("=");
  if (separatorIndex <= 0) return null;

  const parsed = {
    name: cookiePair.slice(0, separatorIndex).trim(),
    value: cookiePair.slice(separatorIndex + 1).trim(),
    path: "/",
    maxAge: null,
    expires: null,
  };

  for (const attribute of attributes) {
    const [rawName, ...rawValueParts] = attribute.trim().split("=");
    const attrName = rawName.toLowerCase();
    const attrValue = rawValueParts.join("=");

    if (attrName === "path" && attrValue) {
      parsed.path = attrValue;
    } else if (attrName === "max-age" && attrValue) {
      const maxAge = Number(attrValue);
      parsed.maxAge = Number.isFinite(maxAge) ? maxAge : null;
    } else if (attrName === "expires" && attrValue) {
      const expires = Date.parse(attrValue);
      parsed.expires = Number.isFinite(expires) ? expires : null;
    }
  }

  return parsed;
}

function rememberElectronAuthCookieFromHeader(url, header) {
  const origin = getCookieOrigin(url);
  if (!origin) return;

  const cookie = parseSetCookieHeader(header);
  if (!cookie || cookie.name !== "jwt") return;

  const key = getElectronAuthCookieKey(cookie.name, origin);
  if (!key) return;

  const expired =
    cookie.maxAge === 0 ||
    (cookie.expires !== null && cookie.expires <= Date.now());

  if (expired || !cookie.value) {
    electronAuthCookies.delete(key);
    saveElectronAuthCookiesToDisk();
    return;
  }

  const expiresAt =
    cookie.maxAge !== null ? Date.now() + cookie.maxAge * 1000 : cookie.expires;

  electronAuthCookies.set(key, {
    name: cookie.name,
    value: cookie.value,
    origin,
    path: cookie.path,
    expiresAt,
  });
  saveElectronAuthCookiesToDisk();
}

function getRememberedElectronAuthCookie(name, targetUrl) {
  const target = parseCookieTarget(targetUrl);
  if (!target) return null;

  const exactKey = getElectronAuthCookieKey(name, target.origin);
  const exactCookie = exactKey ? electronAuthCookies.get(exactKey) : null;
  if (exactCookie && !isElectronAuthCookieExpired(exactCookie)) {
    return exactCookie;
  }

  if (target.protocol !== "https:") {
    return null;
  }

  const httpOrigin = `http://${target.host}`;
  const httpKey = getElectronAuthCookieKey(name, httpOrigin);
  const httpCookie = httpKey ? electronAuthCookies.get(httpKey) : null;
  return httpCookie && !isElectronAuthCookieExpired(httpCookie)
    ? httpCookie
    : null;
}

function getHeaderName(headers, name) {
  const lowerName = name.toLowerCase();
  return Object.keys(headers || {}).find(
    (key) => key.toLowerCase() === lowerName,
  );
}

function setCookieHeaderValue(requestHeaders, name, value) {
  const headerName = getHeaderName(requestHeaders, "Cookie") || "Cookie";
  const existing = requestHeaders[headerName];
  const existingValue = Array.isArray(existing)
    ? existing.join("; ")
    : existing;
  const nextCookie = `${name}=${value}`;
  const otherCookies = String(existingValue || "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie && !cookie.startsWith(`${name}=`));

  requestHeaders[headerName] =
    otherCookies.length > 0
      ? `${otherCookies.join("; ")}; ${nextCookie}`
      : nextCookie;
}

function parseSemver(version) {
  const match = String(version || "").match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

function compareSemver(a, b) {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) return null;

  for (let i = 0; i < 3; i += 1) {
    if (parsedA[i] > parsedB[i]) return 1;
    if (parsedA[i] < parsedB[i]) return -1;
  }

  return 0;
}

const INSECURE_MODE_VALUES = new Set(["true", "1", "yes"]);

function isInsecureModeEnabled() {
  return INSECURE_MODE_VALUES.has(
    String(process.env.ENABLE_INSECURE_MODE || "")
      .trim()
      .toLowerCase(),
  );
}

function isPrivateNetworkHost(hostname) {
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    return true;
  }

  const ipv4Match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  if (hostname.startsWith("fc") || hostname.startsWith("fd")) {
    return true;
  }

  return false;
}

function isInvalidCertificateAllowedForUrl(url) {
  if (isInsecureModeEnabled()) return true;

  try {
    const { hostname } = new URL(url);
    if (isPrivateNetworkHost(hostname)) return true;
  } catch {
    // fall through
  }

  // Otherwise only the server this desktop is linked to, when its link
  // allows a self-signed certificate.
  const linked = linkedServer.getLinkedServer();
  if (!linked?.allowInvalidCertificate) return false;
  return linkedServer.isLinkedOrigin(url);
}

function getTlsVerificationOptions(url) {
  return {
    rejectUnauthorized: !isInvalidCertificateAllowedForUrl(url),
    ...linkedServer.clientCertOptionsFor(url),
  };
}

if (process.platform === "linux") {
  app.commandLine.appendSwitch("--ozone-platform-hint=auto");

  app.commandLine.appendSwitch("--enable-features=VaapiVideoDecoder");

  // Fix click-coordinate misalignment with fractional display scaling on KDE/Wayland.
  // Chromium's hit-testing uses unscaled coords while the compositor scales visually,
  // so forcing scale factor 1 keeps them in sync. See: https://github.com/brave/brave-browser/issues/50028
  app.commandLine.appendSwitch("--force-device-scale-factor", "1");

  const passwordStore = selectLinuxPasswordStore(app.commandLine, process.env);
  if (passwordStore) {
    logToFile(
      `[safeStorage] Selected the ${passwordStore} password store for this desktop.`,
    );
  }
}

if (process.platform === "win32" || process.env.ELECTRON_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
}

if (isInsecureModeEnabled()) {
  logToFile(
    "[security] ENABLE_INSECURE_MODE is enabled; TLS certificate validation is disabled.",
  );
  app.commandLine.appendSwitch("--ignore-certificate-errors");
  app.commandLine.appendSwitch("--ignore-ssl-errors");
  app.commandLine.appendSwitch("--ignore-certificate-errors-spki-list");
}
app.commandLine.appendSwitch("--enable-features=NetworkService");

let mainWindow = null;
const { createIsolatedWindows } = require("./isolated-window.cjs");
const { createEmbeddedViews } = require("./embedded-view.cjs");
const isolatedWindows = createIsolatedWindows({
  BrowserWindow,
  session,
  getMainWindow: () => mainWindow,
});

const embeddedViews = createEmbeddedViews({
  WebContentsView,
  session,
  getMainWindow: () => mainWindow,
});

// Only the app's own page may place native views, never a frame inside it.
function fromMainFrame(event) {
  return !!mainWindow && event.senderFrame === mainWindow.webContents.mainFrame;
}

ipcMain.handle("embedded-view-open", (event, options) => {
  if (!fromMainFrame(event)) throw new Error("Not allowed");
  return embeddedViews.open(options);
});
ipcMain.handle("embedded-view-bounds", (event, id, bounds) => {
  if (fromMainFrame(event)) embeddedViews.setBounds(String(id), bounds);
});
ipcMain.handle("embedded-view-visible", (event, id, visible) => {
  if (fromMainFrame(event)) embeddedViews.setVisible(String(id), visible);
});
ipcMain.handle("embedded-view-close", (event, id) => {
  if (fromMainFrame(event)) embeddedViews.destroy(String(id));
});

// Requests from the embedded backend over the fork IPC channel (the other
// direction from the "shutdown" message main already sends it). A plugin's
// ctx.desktop.openIsolatedWindow is the one caller today.
const BACKEND_REQUEST_HANDLERS = {
  "open-isolated-window": (payload) => isolatedWindows.open(payload),
  // Plugins open OS clients themselves now (desktop:local), so none is wired here.
  "launch-external-client": (payload) => ({
    success: false,
    error: `No external client for ${payload?.protocol ?? "this protocol"}`,
  }),
  // Generic shell actions for a plugin's desktop:local file work.
  "shell-trash-item": async (payload) => {
    await shell.trashItem(String(payload?.path ?? ""));
    return { success: true };
  },
  "shell-show-item": (payload) => {
    shell.showItemInFolder(String(payload?.path ?? ""));
    return { success: true };
  },
  "shell-open-path": async (payload) => {
    const error = await shell.openPath(String(payload?.path ?? ""));
    return error ? { success: false, error } : { success: true };
  },
  "sync-proxy-config": (payload) => {
    linkedServer.setLinkedServer(payload);
    return { success: true };
  },
};

function isDevRunner() {
  return (
    process.env.TERMIX_DEV_RUNNER === "true" &&
    typeof process.send === "function"
  );
}

async function handleBackendRequest(msg) {
  if (!msg || msg.type !== "backend-request") return;
  const { id, channel, payload } = msg;
  const handler = BACKEND_REQUEST_HANDLERS[channel];
  // Under npm run dev:electron the runner owns the backend and relays these messages.
  const target =
    backendProcess && !backendProcess.killed
      ? backendProcess
      : isDevRunner()
        ? process
        : null;
  const reply = (response) => {
    if (!target) return;
    try {
      target.send({ type: "backend-response", id, ...response });
    } catch (error) {
      logToFile("Failed to reply to backend request:", error.message);
    }
  };
  if (!handler) {
    reply({ ok: false, error: `Unknown backend request channel: ${channel}` });
    return;
  }
  try {
    const result = await handler(payload);
    reply({ ok: true, result });
  } catch (error) {
    reply({ ok: false, error: error.message || String(error) });
  }
}

let backendProcess = null;
let backendStartFailed = false;
// Why the embedded backend died, once it has. Null while it is healthy
// or still starting. The renderer polls this to tell "still booting"
// (keep waiting) apart from "never coming back" (show the reason).
let backendFailure = null;
// Set while we are deliberately tearing the backend down on quit, so a
// SIGKILL we sent ourselves is not reported to the user as a crash.
let backendStopRequested = false;
// Tail of the embedded backend's stderr, kept only so a failed start can be
// classified after the fact.
const BACKEND_STDERR_TAIL_LIMIT = 8192;
let backendStderrTail = "";
let tray = null;
let isQuitting = false;
const tempFiles = new Map();
// Paths the user picked in an open dialog this session. Only these may be
// saved as the external editor, so the renderer cannot name an executable.
const dialogChosenPaths = new Set();

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const appRoot = isDev ? process.cwd() : path.join(__dirname, "..");
const windowsAppUserModelId = "com.karmaa.termix";
const electronCacheBuildPath = path.join(
  app.getPath("userData"),
  "client-cache-build.json",
);
const termixSessionPartition = "persist:termix";

function getTempRoot() {
  const tempRoot = path.join(app.getPath("temp"), "termix");
  fs.mkdirSync(tempRoot, { recursive: true });
  return tempRoot;
}

function sanitizeFileName(fileName) {
  const baseName = path.basename(String(fileName || "file"));
  return baseName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "file";
}

function decodeFileContent(content, encoding) {
  if (encoding === "base64") {
    return Buffer.from(String(content || ""), "base64");
  }
  return Buffer.from(String(content || ""), "utf8");
}

function createManagedTempFile(fileName, content, encoding = "utf8") {
  const tempId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tempDir = fs.mkdtempSync(path.join(getTempRoot(), `${tempId}-`));
  const filePath = path.join(tempDir, sanitizeFileName(fileName));
  fs.writeFileSync(filePath, decodeFileContent(content, encoding));
  tempFiles.set(tempId, { path: filePath, dir: tempDir });
  return { tempId, path: filePath };
}

function cleanupManagedTempFile(tempId) {
  const temp = tempFiles.get(tempId);
  if (!temp) return;
  try {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  } catch (error) {
    logToFile("Failed to clean up temporary file:", error.message);
  }
  tempFiles.delete(tempId);
}

// Origins the renderer has explicitly marked as allowed to present an invalid
// certificate, for web endpoints whose ignoreCert is set. Session scoped and
// never persisted.
//
// Deliberately NOT wired into isInvalidCertificateAllowedForUrl: that function
// also governs this process's own outbound TLS via getTlsVerificationOptions,
// and widening it would grant more privilege than the feature needs.
//
// Entries expire rather than living until the app restarts (days, on a
// desktop app). Main has no host-database access, so it cannot verify a
// renderer's claim that an origin really is a configured web endpoint -- an
// unbounded allowance would make that an indefinite window rather than a
// momentary one. The renderer re-registers before each load, which refreshes
// the expiry, so a live endpoint keeps working while a stale entry lapses.
const WEB_ENDPOINT_CERTIFICATE_ALLOWLIST_TTL_MS = 5 * 60 * 1000;
const webEndpointCertificateAllowlist = new Map();

function isWebEndpointCertificateAllowed(url) {
  try {
    const parsed = new URL(url);
    // The allowance exists solely to suppress a TLS certificate error, so a
    // non-https origin in the map is meaningless at best.
    if (parsed.protocol !== "https:") return false;

    const expiresAt = webEndpointCertificateAllowlist.get(parsed.origin);
    if (expiresAt === undefined) return false;
    if (Date.now() >= expiresAt) {
      webEndpointCertificateAllowlist.delete(parsed.origin);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

ipcMain.handle("allow-invalid-certificate-for-origin", (_event, origin) => {
  try {
    // Store the PARSED origin, never the caller's string, so a path or a
    // wildcard cannot widen the allowance.
    const parsed = new URL(String(origin));
    if (parsed.protocol !== "https:") {
      return { success: false };
    }
    webEndpointCertificateAllowlist.set(
      parsed.origin,
      Date.now() + WEB_ENDPOINT_CERTIFICATE_ALLOWLIST_TTL_MS,
    );
    return { success: true };
  } catch {
    return { success: false };
  }
});

// Mutual TLS for the linked server: Chromium asks which certificate from the
// OS store to present. Other origins keep Chromium's default (none).
const chosenClientCerts = new Map();

app.on(
  "select-client-certificate",
  async (event, _webContents, url, list, callback) => {
    if (!linkedServer.isLinkedOrigin(url) || !list.length) return;
    event.preventDefault();
    const origin = new URL(url).origin;
    const remembered = list.find(
      (cert) => cert.fingerprint === chosenClientCerts.get(origin),
    );
    let chosen = remembered || (list.length === 1 ? list[0] : null);
    if (!chosen) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: "question",
        title: "Client certificate",
        message: "Choose the certificate for this server",
        detail: origin,
        buttons: [
          ...list.slice(0, 8).map((cert) => cert.subjectName),
          "Cancel",
        ],
        cancelId: Math.min(list.length, 8),
      });
      chosen = list[response] || null;
    }
    if (chosen) chosenClientCerts.set(origin, chosen.fingerprint);
    callback(chosen || undefined);
  },
);

app.on(
  "certificate-error",
  (event, _webContents, url, error, certificate, callback) => {
    if (
      isolatedWindows.handleCertificateError(event, _webContents, url, callback)
    )
      return;
    if (
      embeddedViews.handleCertificateError(event, _webContents, url, callback)
    )
      return;
    if (isWebEndpointCertificateAllowed(url)) {
      event.preventDefault();
      logToFile("Allowed invalid certificate for configured web endpoint", {
        url,
        error,
        issuer: certificate?.issuerName,
        subject: certificate?.subjectName,
      });
      callback(true);
      return;
    }

    if (isInvalidCertificateAllowedForUrl(url)) {
      event.preventDefault();
      logToFile("Allowed invalid certificate for configured server", {
        url,
        error,
        issuer: certificate?.issuerName,
        subject: certificate?.subjectName,
      });
      callback(true);
      return;
    }

    callback(false);
  },
);

// A reverse proxy in front of the linked server may ask for basic auth; the
// link's saved username and password answer it. Anything else gets the
// default behaviour.
app.on("login", (event, _webContents, details, authInfo, callback) => {
  const credentials = linkedServer.answerLogin(authInfo, details?.url);
  if (!credentials) return;
  event.preventDefault();
  callback(credentials.username, credentials.password || "");
});

function getElectronBuildTimestamp() {
  try {
    const buildInfo = require("./build-info.cjs");
    if (Number.isInteger(buildInfo.buildTimestamp)) {
      return buildInfo.buildTimestamp;
    }
  } catch {
    // Development runs may not have generated build metadata yet.
  }

  return 0;
}

async function clearElectronClientCacheIfBuildChanged() {
  const buildTimestamp = getElectronBuildTimestamp();
  let cacheTimestamp = 0;

  try {
    if (fs.existsSync(electronCacheBuildPath)) {
      const data = JSON.parse(fs.readFileSync(electronCacheBuildPath, "utf8"));
      cacheTimestamp = Number.isInteger(data.buildTimestamp)
        ? data.buildTimestamp
        : 0;
    }
  } catch (error) {
    logToFile(
      "Failed to read Electron client cache build info:",
      error.message,
    );
  }

  if (cacheTimestamp === buildTimestamp) {
    return;
  }

  const clearStep = async (label, action) => {
    try {
      await action();
    } catch (error) {
      logToFile(`Failed to clear Electron ${label}:`, error.message);
    }
  };

  try {
    const defaultSession = session.defaultSession;
    await clearStep("HTTP cache", () => defaultSession.clearCache());
    await clearStep("code cache", () =>
      defaultSession.clearCodeCaches({ urls: [] }),
    );
    await clearStep("auth cache", () => defaultSession.clearAuthCache());
    await clearStep("storage data", () =>
      defaultSession.clearStorageData({
        storages: [
          "appcache",
          "cookies",
          "filesystem",
          "shadercache",
          "websql",
          "serviceworkers",
          "cachestorage",
        ],
      }),
    );

    fs.writeFileSync(
      electronCacheBuildPath,
      JSON.stringify(
        {
          buildTimestamp,
          appVersion: app.getVersion(),
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    logToFile("Electron client cache cleared for build change", {
      from: cacheTimestamp,
      to: buildTimestamp,
      appVersion: app.getVersion(),
    });
  } catch (error) {
    logToFile("Failed to clear Electron client cache:", error.message);
  }
}

function getCookieRemovalUrl(cookie) {
  const scheme = cookie.secure ? "https" : "http";
  const domain = cookie.domain?.startsWith(".")
    ? cookie.domain.slice(1)
    : cookie.domain || "localhost";
  return `${scheme}://${domain}${cookie.path || "/"}`;
}

async function clearElectronJwtCookiesAtStartup() {
  loadElectronAuthCookiesFromDisk();

  const targetSessions = new Set([
    session.defaultSession,
    session.fromPartition(termixSessionPartition),
  ]);

  for (const targetSession of targetSessions) {
    try {
      const cookies = await targetSession.cookies.get({ name: "jwt" });
      await Promise.all(
        cookies.map((cookie) =>
          targetSession.cookies.remove(
            getCookieRemovalUrl(cookie),
            cookie.name,
          ),
        ),
      );

      if (cookies.length > 0) {
        logToFile("Cleared Electron JWT cookies from cookie store", {
          count: cookies.length,
        });
      }
    } catch (error) {
      logToFile("Failed to clear Electron JWT cookies:", error.message);
    }
  }
}

function getBackendPaths() {
  if (isDev) {
    const backendDir = path.join(appRoot, "dist", "backend", "backend");
    return {
      entryPath: path.join(backendDir, "starter.js"),
      backendCwd: backendDir,
    };
  }
  // fork() does not go through Electron's asar redirector, use the unpacked path.
  // On macOS multi-arch builds (mergeASARs: false), electron-builder names the ASAR
  // app-arm64.asar / app-x64.asar instead of app.asar, so match all variants.
  const unpackedRoot = getUnpackedAppRoot(appRoot);
  const backendDir = path.join(unpackedRoot, "dist", "backend", "backend");
  return {
    entryPath: path.join(backendDir, "starter.js"),
    backendCwd: backendDir,
  };
}

function getBackendDataDir() {
  const userDataPath = app.getPath("userData");
  const dataDir = path.join(userDataPath, "server-data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function getBackendPidFilePath() {
  return path.join(app.getPath("userData"), "backend.pid");
}

// If the app was previously killed abnormally (crash, force-quit, Task
// Manager) rather than through the normal quit flow, will-quit never fires
// and stopBackendServer() never runs -- the forked backend child is a
// genuinely separate OS process on Windows/mac/Linux, so it keeps running
// and holding the port the backend binds (30001). Every subsequent
// launch's own backend then fails outright
// with EADDRINUSE and the app is stuck until something manually kills the
// orphan. Reap any such leftover process, identified by PID file, before
// spawning a new one.
function reapOrphanedBackendProcess() {
  const pidFilePath = getBackendPidFilePath();
  let recordedPid;
  try {
    recordedPid = parseInt(fs.readFileSync(pidFilePath, "utf8").trim(), 10);
  } catch {
    return;
  }
  if (!Number.isInteger(recordedPid) || recordedPid <= 0) return;

  try {
    // Signal 0 does not kill the process -- it only checks whether a
    // process with this PID exists and is signalable, throwing ESRCH if
    // not. This avoids killing an unrelated process that happens to have
    // reused the same PID since the last run.
    process.kill(recordedPid, 0);
  } catch {
    // No live process at that PID; nothing to reap.
    try {
      fs.unlinkSync(pidFilePath);
    } catch {
      // already absent
    }
    return;
  }

  logToFile(
    `Found orphaned backend process from a previous session (pid ${recordedPid}), terminating it before starting a new one`,
  );
  try {
    process.kill(recordedPid, "SIGKILL");
  } catch {
    // already gone
  }
  try {
    fs.unlinkSync(pidFilePath);
  } catch {
    // already absent
  }
}

const DEFAULT_BACKEND_PORT = 30001;
let backendPort = DEFAULT_BACKEND_PORT;

function canListenOn(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(null));
    probe.listen(port, "127.0.0.1", () => {
      const { port: bound } = probe.address();
      probe.close(() => resolve(bound));
    });
  });
}

// 30001 when it is free, otherwise any free port. Only the desktop app talks
// to this backend, so the number itself does not matter.
async function findBackendPort() {
  const preferred = await canListenOn(DEFAULT_BACKEND_PORT);
  if (preferred) return preferred;
  const fallback = await canListenOn(0);
  if (fallback) {
    logToFile(
      `Port ${DEFAULT_BACKEND_PORT} is in use, starting the backend on ${fallback}`,
    );
    return fallback;
  }
  return DEFAULT_BACKEND_PORT;
}

function startBackendServer() {
  reapOrphanedBackendProcess();
  backendFailure = null;
  backendStopRequested = false;
  backendStderrTail = "";
  return new Promise((resolve) => {
    const { entryPath, backendCwd } = getBackendPaths();

    logToFile("isDev:", isDev, "appRoot:", appRoot);
    logToFile("app.isPackaged:", app.isPackaged);
    logToFile("process.env.NODE_ENV:", process.env.NODE_ENV);

    if (!fs.existsSync(entryPath)) {
      logToFile("Backend entry not found:", entryPath);
      backendFailure = { reason: "crashed", port: null };
      resolve(false);
      return;
    }

    const dataDir = getBackendDataDir();
    logToFile("Starting embedded backend server...");
    logToFile("Backend entry:", entryPath);
    logToFile("Data directory:", dataDir);
    logToFile("Backend cwd:", backendCwd);

    logToFile("Checking paths...");
    logToFile("  entryPath exists:", fs.existsSync(entryPath));
    logToFile("  dataDir exists:", fs.existsSync(dataDir));
    logToFile("  backendCwd exists:", fs.existsSync(backendCwd));

    backendProcess = fork(entryPath, [], {
      cwd:
        fs.existsSync(backendCwd) && fs.statSync(backendCwd).isDirectory()
          ? backendCwd
          : dataDir,
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        NODE_ENV: "production",
        ELECTRON_EMBEDDED: "true",
        PORT: String(backendPort),
        EMBEDDED_BACKEND_PORT: String(backendPort),
        ELECTRON_USER_DATA: app.getPath("userData"),
        VERSION: app.getVersion(),
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    logToFile("Backend process spawned, pid:", backendProcess.pid);
    try {
      fs.writeFileSync(getBackendPidFilePath(), String(backendProcess.pid));
    } catch {
      // Non-fatal: only means a future crash won't self-heal via reap.
    }

    let resolved = false;
    const readyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        logToFile("Backend ready timeout (15s), proceeding anyway...");
        resolve(true);
      }
    }, 15000);

    backendProcess.stdout.on("data", (data) => {
      const msg = data.toString().trim();
      logToFile("[backend]", msg);
      if (!resolved && msg.includes("started successfully")) {
        resolved = true;
        clearTimeout(readyTimeout);
        logToFile("Backend ready signal received");
        resolve(true);
      }
    });

    // The reason for a failed start is only ever visible in what the child
    // wrote to stderr before dying, so keep a bounded tail of it. Bounded
    // because a backend that stays up for days can otherwise log without
    // limit into a buffer nothing ever drains.
    backendProcess.stderr.on("data", (data) => {
      const chunk = data.toString();
      backendStderrTail = (backendStderrTail + chunk).slice(
        -BACKEND_STDERR_TAIL_LIMIT,
      );
      logToFile("[backend:stderr]", chunk.trim());
    });

    backendProcess.on("message", (msg) => {
      if (!resolved && msg?.type === "backend-ready") {
        resolved = true;
        clearTimeout(readyTimeout);
        logToFile("Backend ready signal received via IPC");
        resolve(true);
      }
      void handleBackendRequest(msg);
    });

    backendProcess.on("exit", (code, signal) => {
      logToFile(`Backend process exited with code ${code}, signal ${signal}`);
      if (!resolved && code !== 0) {
        backendStartFailed = true;
      }
      // Classified whether or not the ready promise already settled: the
      // 15s ready timeout resolves optimistically, so a backend that dies
      // at second 20 still has to be reported rather than silently dropped.
      // backendStopRequested is the only evidence that an exit was asked
      // for, so it is the sole guard here -- past it, every exit means the
      // backend is gone and the renderer must stop waiting for it.
      if (!backendStopRequested) {
        backendFailure = classifyBackendFailure(backendStderrTail);
        logToFile("Backend failure classified as:", backendFailure.reason);
      }
      backendProcess = null;
      clearBackendPidFile();
      if (!resolved) {
        resolved = true;
        clearTimeout(readyTimeout);
        resolve(false);
      }
    });

    backendProcess.on("error", (err) => {
      logToFile("Failed to start backend process:", err.message);
      backendFailure = { reason: "crashed", port: null };
      backendProcess = null;
      if (!resolved) {
        resolved = true;
        clearTimeout(readyTimeout);
        resolve(false);
      }
    });
  });
}

function clearBackendPidFile() {
  try {
    fs.unlinkSync(getBackendPidFilePath());
  } catch {
    // already absent
  }
}

function stopBackendServer() {
  if (!backendProcess) return;

  console.log("Stopping embedded backend server...");
  backendStopRequested = true;

  try {
    backendProcess.send({ type: "shutdown" });
  } catch {
    // IPC channel may already be closed
  }

  const forceKillTimeout = setTimeout(() => {
    if (backendProcess) {
      console.log("Force killing backend process...");
      backendProcess.kill("SIGKILL");
      backendProcess = null;
    }
  }, 5000);

  backendProcess.on("exit", () => {
    clearTimeout(forceKillTimeout);
    backendProcess = null;
    clearBackendPidFile();
  });
}

// App Sandbox denies the singleton socket bind, which reads as a held lock and
// quits the app on every launch. macOS reactivates bundled apps anyway.
const gotTheLock = process.mas || app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log("Another instance is already running, quitting...");
  app.quit();
  process.exit(0);
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.show();
    }
  });
}

function createTray() {
  try {
    const { nativeImage } = require("electron");

    // Native APIs (Tray, nativeImage) can't load files from inside app.asar,
    // use the unpacked path so the OS sees a real file.
    const publicRoot = isDev
      ? path.join(appRoot, "public")
      : path.join(
          appRoot.replace(
            /app(-[a-z0-9]+)?\.asar(?!\.unpacked)/,
            "app.asar.unpacked",
          ),
          "public",
        );

    let trayIcon;
    if (process.platform === "darwin") {
      const iconPath = path.join(publicRoot, "icons", "16x16.png");
      trayIcon = nativeImage.createFromPath(iconPath);
      trayIcon.setTemplateImage(true);
    } else if (process.platform === "win32") {
      trayIcon = path.join(publicRoot, "icon.ico");
    } else {
      trayIcon = loadLinuxTrayIcon(nativeImage, publicRoot);
      if (!trayIcon) {
        logToFile("Tray icon not found, skipping the system tray");
        return;
      }
      if (/gnome/i.test(process.env.XDG_CURRENT_DESKTOP || "")) {
        logToFile(
          "GNOME shows tray icons only with the AppIndicator extension installed",
        );
      }
    }

    tray = new Tray(trayIcon);
    tray.setToolTip("Termix");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show Window",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          quitApp(app, mainWindow);
        },
      },
    ]);

    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });

    logToFile("System tray created");
  } catch (err) {
    tray = null;
    logToFile("Failed to create system tray:", err?.message || String(err));
  }
}

function loadLinuxTrayIcon(nativeImage, publicRoot) {
  const roots = [
    publicRoot,
    path.join(process.resourcesPath || "", "app.asar.unpacked", "public"),
  ];
  for (const root of roots) {
    for (const size of ["32x32", "24x24", "48x48"]) {
      const image = nativeImage.createFromPath(
        path.join(root, "icons", `${size}.png`),
      );
      if (!image.isEmpty()) return image;
    }
  }
  return null;
}

function createWindow() {
  const appVersion = app.getVersion();
  const electronVersion = process.versions.electron;
  const platform =
    process.platform === "win32"
      ? "Windows"
      : process.platform === "darwin"
        ? "macOS"
        : "Linux";

  const isMac = process.platform === "darwin";

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Termix",
    // The app draws its own title bar so it follows the active theme. macOS
    // keeps the traffic lights on top of it, Windows and Linux get the
    // native controls as an overlay whose colors the renderer keeps in sync.
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 16 } }
      : {
          titleBarOverlay: {
            color: "#0f0f14",
            symbolColor: "#e6e6ea",
            height: TITLE_BAR_HEIGHT,
          },
        }),
    icon: path.join(
      appRoot,
      "public",
      process.platform === "win32" ? "icon.ico" : "icon.png",
    ),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [`--termix-backend-port=${backendPort}`],
      partition: termixSessionPartition,
      allowRunningInsecureContent: false,
      webviewTag: false,
      offscreen: false,
    },
    show: true,
  });

  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      if (
        permission === "clipboard-read" ||
        permission === "clipboard-write" ||
        permission === "clipboard-sanitized-write"
      ) {
        callback(true);
        return;
      }
      callback(false);
    },
  );

  if (process.platform !== "darwin") {
    mainWindow.setMenuBarVisibility(false);
  }

  const customUserAgent = `Termix-Desktop/${appVersion} (${platform}; Electron/${electronVersion})`;
  mainWindow.webContents.setUserAgent(customUserAgent);

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (process.platform !== "win32" || !isCloseActiveTabInput(input)) return;

    event.preventDefault();
    mainWindow.webContents.send("close-active-tab");
  });

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    (details, callback) => {
      details.requestHeaders["X-Electron-App"] = "true";

      details.requestHeaders["User-Agent"] = customUserAgent;

      // YouTube refuses embeds without a Referer, which file:// never sends.
      if (
        details.url.startsWith("https://www.youtube-nocookie.com/embed/") &&
        !details.requestHeaders.Referer
      ) {
        details.requestHeaders.Referer = "https://termix.site/";
      }

      const rememberedJwt = getRememberedElectronAuthCookie("jwt", details.url);
      if (rememberedJwt) {
        setCookieHeaderValue(
          details.requestHeaders,
          rememberedJwt.name,
          rememberedJwt.value,
        );
      }

      callback({
        requestHeaders: linkedServer.applyLinkHeaders(
          details.url,
          details.requestHeaders,
        ),
      });
    },
  );

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(appRoot, "dist", "index.html");
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error("Failed to load file:", err);
    });
  }

  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      const headers = details.responseHeaders;

      if (headers) {
        delete headers["x-frame-options"];
        delete headers["X-Frame-Options"];

        if (headers["content-security-policy"]) {
          headers["content-security-policy"] = headers[
            "content-security-policy"
          ]
            .map((value) => value.replace(/frame-ancestors[^;]*/gi, ""))
            .filter((value) => value.trim().length > 0);

          if (headers["content-security-policy"].length === 0) {
            delete headers["content-security-policy"];
          }
        }
        if (headers["Content-Security-Policy"]) {
          headers["Content-Security-Policy"] = headers[
            "Content-Security-Policy"
          ]
            .map((value) => value.replace(/frame-ancestors[^;]*/gi, ""))
            .filter((value) => value.trim().length > 0);

          if (headers["Content-Security-Policy"].length === 0) {
            delete headers["Content-Security-Policy"];
          }
        }

        const setCookieHeaderName = getHeaderName(headers, "Set-Cookie");
        if (setCookieHeaderName) {
          const setCookieHeaders = Array.isArray(headers[setCookieHeaderName])
            ? headers[setCookieHeaderName]
            : [headers[setCookieHeaderName]];

          setCookieHeaders.forEach((cookie) => {
            rememberElectronAuthCookieFromHeader(details.url, cookie);
          });

          headers[setCookieHeaderName] = setCookieHeaders.map((cookie) => {
            let modified = cookie.replace(
              /;\s*SameSite=Strict/gi,
              "; SameSite=None",
            );
            modified = modified.replace(
              /;\s*SameSite=Lax/gi,
              "; SameSite=None",
            );
            if (!modified.includes("SameSite=")) {
              modified += "; SameSite=None";
            }
            if (
              !modified.includes("Secure") &&
              details.url.startsWith("https")
            ) {
              modified += "; Secure";
            }
            return modified;
          });
        }
      }

      callback({ responseHeaders: headers });
    },
  );

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 3000);

  mainWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      console.error(
        "Failed to load:",
        errorCode,
        errorDescription,
        validatedURL,
      );
    },
  );

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("Frontend loaded successfully");
  });

  mainWindow.webContents.on("will-prevent-unload", (event) => {
    // Explicit Quit must not be vetoed by the renderer's connection guard.
    // In this Electron event, preventDefault allows the unload to proceed.
    if (isQuitting) event.preventDefault();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting && tray && !tray.isDestroyed()) {
      event.preventDefault();
      // Stock GNOME has no tray to bring a hidden window back from.
      if (
        process.platform === "linux" &&
        /gnome/i.test(process.env.XDG_CURRENT_DESKTOP || "")
      ) {
        mainWindow.minimize();
      } else {
        mainWindow.hide();
      }
    }
  });

  mainWindow.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      embeddedViews.destroyAll();
    }
  });

  const sendTitleBarVisible = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(
      "title-bar-visible-changed",
      titleBarVisible(mainWindow),
    );
  };
  mainWindow.on("enter-full-screen", sendTitleBarVisible);
  mainWindow.on("leave-full-screen", sendTitleBarVisible);

  mainWindow.on("closed", () => {
    embeddedViews.destroyAll();
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(url);
      }
    } catch {
      // invalid URL, ignore
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowedUrl = isDev
      ? url.startsWith("http://localhost:5173/")
      : url === pathToFileURL(path.join(appRoot, "dist", "index.html")).href;
    if (!allowedUrl) event.preventDefault();
  });
}

ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

/** The window an IPC call came from, so the main window and the extra
 * windows (isolated views, sign-in) can each answer for themselves. */
function windowFor(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) return win;
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return null;
}

ipcMain.handle("get-platform", () => {
  return process.platform;
});

// Whether the app-drawn title bar shows in the window that asks. Only the
// main window hides the native bar, and in full screen macOS hides the
// traffic lights, so the bar goes away there too.
function titleBarVisible(win) {
  return !!win && win === mainWindow && !win.isFullScreen();
}

ipcMain.handle("get-title-bar-visible", (event) => {
  return titleBarVisible(windowFor(event));
});

// The renderer sends the colors of the active theme so the window controls
// the system draws (Windows and Linux) match the app.
ipcMain.handle("set-title-bar-overlay", (event, colors) => {
  const win = windowFor(event);
  if (!win || process.platform === "darwin") return;
  const options = {};
  if (typeof colors?.color === "string" && colors.color) {
    options.color = colors.color;
  }
  if (typeof colors?.symbolColor === "string" && colors.symbolColor) {
    options.symbolColor = colors.symbolColor;
  }
  if (Object.keys(options).length === 0) return;
  try {
    win.setTitleBarOverlay(options);
  } catch (error) {
    logToFile("setTitleBarOverlay failed:", error);
  }
});

ipcMain.handle("get-embedded-server-status", () => {
  return {
    running:
      backendProcess !== null && !backendProcess.killed && !backendStartFailed,
    // A backend that is merely slow to boot reports no failure, so the
    // renderer keeps waiting for it. Only a classified failure means the
    // process is gone for good and waiting is pointless.
    failure: backendFailure,
    dataDir: isDev ? null : getBackendDataDir(),
  };
});

// External login through the system browser (RFC 8252)
ipcMain.handle(
  "external-browser-login",
  async (_event, authUrl, callbackPort) => {
    if (!isExternalLoginUrl(authUrl)) {
      return { success: false, error: "Invalid authentication URL" };
    }
    if (!isCallbackPort(callbackPort)) {
      return { success: false, error: "Invalid callback port" };
    }
    const http = require("http");

    return new Promise((resolve) => {
      let timeout;
      let settled = false;
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${callbackPort}`);
        if (url.pathname === "/oidc-callback") {
          const success = url.searchParams.get("success");
          const error = url.searchParams.get("error");
          const token = url.searchParams.get("token");
          const secondFactor = url.searchParams.get("second_factor") === "1";

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            `<html><body><h2>${success === "true" || secondFactor ? "Authentication successful!" : "Authentication failed."}</h2><p>You can close this tab and return to Termix.</p><script>window.close()</script></body></html>`,
          );

          if (secondFactor) {
            finish({
              success: false,
              secondFactor: true,
              tempToken: url.searchParams.get("temp_token"),
              factors: url.searchParams.get("second_factors"),
            });
          } else if (success === "true") {
            finish({ success: true, token });
          } else {
            finish({
              success: false,
              error: error || "Authentication failed",
            });
          }
          return;
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      });

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        try {
          server.close();
        } catch {
          // Server may not have started yet.
        }
        resolve(result);
      };

      const fail = (error) => {
        finish({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      };

      server.once("error", fail);

      server.listen(callbackPort, "localhost", async () => {
        try {
          await shell.openExternal(authUrl);
        } catch (error) {
          fail(error);
        }
      });

      // Timeout after 5 minutes
      timeout = setTimeout(
        () => {
          fail(new Error("External login timed out"));
        },
        5 * 60 * 1000,
      );
    });
  },
);

// Desktop-only settings, such as whether hosts connect from this device or
// through the linked server by default.
ipcMain.handle("get-desktop-settings", () => {
  return desktopSettings.getDesktopSettings();
});

ipcMain.handle("save-desktop-settings", (_event, settings) => {
  return desktopSettings.saveDesktopSettings(settings);
});

let appUpdater = null;

function startAppUpdater() {
  const kind = autoUpdates.getInstallKind({
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    mas: !!process.mas,
    env: process.env,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    exists: (target) => fs.existsSync(target),
    readFile: (target) => fs.readFileSync(target, "utf8"),
  });
  logToFile("Updater install kind:", kind);
  appUpdater = autoUpdates.createUpdater({
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    kind,
    getMode: () => desktopSettings.getDesktopSettings().updateMode,
    saveMode: (mode) =>
      desktopSettings.saveDesktopSettings({ updateMode: mode }),
    fetchReleases: async () => {
      const { net } = require("electron");
      const response = await net.fetch(autoUpdates.RELEASES_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) {
        throw new Error(`GitHub releases returned ${response.status}`);
      }
      return response.json();
    },
    loadAutoUpdater: () => require("electron-updater").autoUpdater,
    send: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("desktop-update-state", state);
      }
    },
    log: logToFile,
    beforeInstall: () => {
      isQuitting = true;
    },
  });
  appUpdater.start();
}

ipcMain.handle(
  "desktop-update-get-state",
  () => appUpdater?.getState() ?? null,
);
ipcMain.handle("desktop-update-check", () => appUpdater?.check() ?? null);
ipcMain.handle("desktop-update-download", () => appUpdater?.download() ?? null);
ipcMain.handle("desktop-update-install", () => appUpdater?.install() ?? false);
ipcMain.handle(
  "desktop-update-set-mode",
  (_event, mode) => appUpdater?.setMode(mode) ?? null,
);

// The server an older version of the app was pointed at, offered again when
// linking so upgraded installs do not have to look it up.
ipcMain.handle("get-previous-server-url", () => {
  return { serverUrl: desktopSettings.getPreviousServerUrl() };
});

function readSetting(key) {
  const settingsPath = path.join(app.getPath("userData"), "settings.json");
  if (!fs.existsSync(settingsPath)) return null;
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  return settings[key] !== undefined ? settings[key] : null;
}

ipcMain.handle("get-setting", (event, key) => {
  try {
    return readSetting(key);
  } catch (error) {
    console.error("Error reading setting:", error);
    return null;
  }
});

ipcMain.handle("set-setting", (event, key, value) => {
  if (typeof key !== "string") {
    return { success: false, error: "Invalid setting key" };
  }
  if (
    key === EXTERNAL_EDITOR_SETTING &&
    value &&
    !dialogChosenPaths.has(value)
  ) {
    return { success: false, error: "Choose the editor in the file dialog" };
  }
  try {
    const userDataPath = app.getPath("userData");
    const settingsPath = path.join(userDataPath, "settings.json");

    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }

    let settings = {};
    if (fs.existsSync(settingsPath)) {
      const settingsData = fs.readFileSync(settingsPath, "utf8");
      settings = JSON.parse(settingsData);
    }

    settings[key] = value;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Error saving setting:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("clear-session-cookies", async () => {
  try {
    clearPersistedElectronAuthCookies();
    const ses = mainWindow?.webContents?.session;
    if (ses) {
      const cookies = await ses.cookies.get({});
      for (const cookie of cookies) {
        await ses.cookies.remove(getCookieRemovalUrl(cookie), cookie.name);
      }
    }
  } catch (error) {
    console.error("Failed to clear session cookies:", error);
  }
});

ipcMain.handle("clipboard-write-text", (_event, text) => {
  clipboard.writeText(typeof text === "string" ? text : String(text ?? ""));
  return true;
});

ipcMain.handle("clipboard-read-text", () => clipboard.readText());

ipcMain.handle("show-save-dialog", async (_event, options) => {
  return dialog.showSaveDialog(mainWindow, options || {});
});

ipcMain.handle("show-open-dialog", async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options || {});
  for (const filePath of result.filePaths) dialogChosenPaths.add(filePath);
  return result;
});

ipcMain.handle("create-temp-file", async (_event, fileData) => {
  try {
    const result = createManagedTempFile(
      fileData?.fileName,
      fileData?.content,
      fileData?.encoding,
    );
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("create-temp-folder", async (_event, folderData) => {
  try {
    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempDir = fs.mkdtempSync(path.join(getTempRoot(), `${tempId}-`));
    const folderPath = path.join(
      tempDir,
      sanitizeFileName(folderData?.folderName || "files"),
    );
    fs.mkdirSync(folderPath, { recursive: true });

    for (const file of folderData?.files || []) {
      const relativePath = String(file.relativePath || "")
        .split(/[\\/]+/)
        .map(sanitizeFileName)
        .filter(Boolean)
        .join(path.sep);
      if (!relativePath) continue;
      const targetPath = path.join(folderPath, relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(
        targetPath,
        decodeFileContent(file.content, file.encoding),
      );
    }

    tempFiles.set(tempId, { path: folderPath, dir: tempDir });
    return { success: true, tempId, path: folderPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("start-drag-to-desktop", (event, dragData) => {
  try {
    const temp = tempFiles.get(dragData?.tempId);
    if (!temp) return { success: false, error: "Temporary file not found" };

    event.sender.startDrag({
      file: temp.path,
      icon: nativeImage.createEmpty(),
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("cleanup-temp-file", (_event, tempId) => {
  try {
    cleanupManagedTempFile(tempId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

function createMenu() {
  if (process.platform === "darwin") {
    const template = [
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
          { type: "separator" },
          { role: "window" },
        ],
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }
}

app.whenReady().then(async () => {
  logToFile("=== App ready ===");
  logToFile(
    "isDev:",
    isDev,
    "platform:",
    process.platform,
    "arch:",
    process.arch,
  );
  if (process.platform === "win32") {
    app.setAppUserModelId(windowsAppUserModelId);
  }
  createMenu();
  await clearElectronClientCacheIfBuildChanged();
  await clearElectronJwtCookiesAtStartup();

  if (!isDev) {
    backendPort = await findBackendPort();
    const result = await startBackendServer();
    logToFile("startBackendServer result:", result);
  } else {
    logToFile(
      "Skipping embedded backend (isDev=true) - expecting the dev runner's backend",
    );
    if (isDevRunner()) {
      process.on("message", (msg) => void handleBackendRequest(msg));
    }
  }

  createTray();
  createWindow();
  startAppUpdater();
  desktopSettings.removeOldSyncFiles();
  logToFile("=== Startup complete ===");
});

app.on("window-all-closed", () => {
  if (!tray || tray.isDestroyed()) {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  console.log("App will quit...");
  for (const tempId of tempFiles.keys()) {
    cleanupManagedTempFile(tempId);
  }
  stopBackendServer();
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
