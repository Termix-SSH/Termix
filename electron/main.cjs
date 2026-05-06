const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  Menu,
  session,
  safeStorage,
  Tray,
  clipboard,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");
const http = require("http");
const net = require("net");
const { URL } = require("url");
const { fork } = require("child_process");
const WebSocket = require("ws");

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

function getTlsVerificationOptions() {
  return {
    rejectUnauthorized: !isInsecureModeEnabled(),
  };
}

function getWebSocketOptions(url, options = {}) {
  return {
    ...options,
    ...(String(url).startsWith("wss:") ? getTlsVerificationOptions() : {}),
  };
}

function httpFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";
    const client = isHttps ? https : http;

    const requestOptions = {
      method: options.method || "GET",
      headers: options.headers || {},
      timeout: options.timeout || 10000,
      ...(isHttps ? getTlsVerificationOptions() : {}),
    };

    const req = client.request(url, requestOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(data),
          json: () => Promise.resolve(JSON.parse(data)),
        });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

if (process.platform === "linux") {
  app.commandLine.appendSwitch("--ozone-platform-hint=auto");

  app.commandLine.appendSwitch("--enable-features=VaapiVideoDecoder");
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
let backendProcess = null;
let tray = null;
let isQuitting = false;

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const appRoot = isDev ? process.cwd() : path.join(__dirname, "..");
const electronCacheBuildPath = path.join(
  app.getPath("userData"),
  "client-cache-build.json",
);
const termixSessionPartition = "persist:termix";

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

function getBackendEntryPath() {
  if (isDev) {
    return path.join(appRoot, "dist", "backend", "backend", "starter.js");
  }
  return path.join(appRoot, "dist", "backend", "backend", "starter.js");
}

function getBackendDataDir() {
  const userDataPath = app.getPath("userData");
  const dataDir = path.join(userDataPath, "server-data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function startBackendServer() {
  return new Promise((resolve) => {
    const entryPath = getBackendEntryPath();

    logToFile("isDev:", isDev, "appRoot:", appRoot);
    logToFile("app.isPackaged:", app.isPackaged);
    logToFile("process.env.NODE_ENV:", process.env.NODE_ENV);

    if (!fs.existsSync(entryPath)) {
      logToFile("Backend entry not found:", entryPath);
      resolve(false);
      return;
    }

    const dataDir = getBackendDataDir();
    logToFile("Starting embedded backend server...");
    logToFile("Backend entry:", entryPath);
    logToFile("Data directory:", dataDir);
    logToFile("Backend cwd:", appRoot);

    logToFile("Checking paths...");
    logToFile("  entryPath exists:", fs.existsSync(entryPath));
    logToFile("  dataDir exists:", fs.existsSync(dataDir));
    logToFile("  appRoot exists:", fs.existsSync(appRoot));

    const distPath = path.join(appRoot, "dist");
    if (fs.existsSync(distPath)) {
      logToFile("  dist directory contents:", fs.readdirSync(distPath));
      const backendPath = path.join(distPath, "backend");
      if (fs.existsSync(backendPath)) {
        logToFile("  dist/backend contents:", fs.readdirSync(backendPath));
      }
    }

    backendProcess = fork(entryPath, [], {
      cwd: appRoot,
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        NODE_ENV: "production",
        ELECTRON_EMBEDDED: "true",
        PORT: "30001",
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    logToFile("Backend process spawned, pid:", backendProcess.pid);

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

    backendProcess.stderr.on("data", (data) => {
      logToFile("[backend:stderr]", data.toString().trim());
    });

    backendProcess.on("exit", (code, signal) => {
      logToFile(`Backend process exited with code ${code}, signal ${signal}`);
      backendProcess = null;
      if (!resolved) {
        resolved = true;
        clearTimeout(readyTimeout);
        resolve(false);
      }
    });

    backendProcess.on("error", (err) => {
      logToFile("Failed to start backend process:", err.message);
      backendProcess = null;
      if (!resolved) {
        resolved = true;
        clearTimeout(readyTimeout);
        resolve(false);
      }
    });
  });
}

function stopBackendServer() {
  if (!backendProcess) return;

  console.log("Stopping embedded backend server...");

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
  });
}

const gotTheLock = app.requestSingleInstanceLock();
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

    let trayIcon;
    if (process.platform === "darwin") {
      const iconPath = path.join(appRoot, "public", "icons", "16x16.png");
      trayIcon = nativeImage.createFromPath(iconPath);
      trayIcon.setTemplateImage(true);
    } else if (process.platform === "win32") {
      trayIcon = path.join(appRoot, "public", "icon.ico");
    } else {
      trayIcon = path.join(appRoot, "public", "icons", "32x32.png");
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
          app.quit();
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

    console.log("System tray created successfully");
  } catch (err) {
    console.error("Failed to create system tray:", err);
  }
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

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Termix",
    icon: path.join(appRoot, "public", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, "preload.js"),
      partition: termixSessionPartition,
      allowRunningInsecureContent: true,
      webviewTag: true,
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

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    (details, callback) => {
      details.requestHeaders["X-Electron-App"] = "true";

      details.requestHeaders["User-Agent"] = customUserAgent;

      const rememberedJwt = getRememberedElectronAuthCookie("jwt", details.url);
      if (rememberedJwt) {
        setCookieHeaderValue(
          details.requestHeaders,
          rememberedJwt.name,
          rememberedJwt.value,
        );
      }

      callback({ requestHeaders: details.requestHeaders });
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

  mainWindow.on("close", (event) => {
    if (!isQuitting && tray && !tray.isDestroyed()) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

const GITHUB_API_BASE = "https://api.github.com";
const REPO_OWNER = "Termix-SSH";
const REPO_NAME = "Termix";

const githubCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000;

async function fetchGitHubAPI(endpoint, cacheKey) {
  const cached = githubCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return {
      data: cached.data,
      cached: true,
      cache_age: Date.now() - cached.timestamp,
    };
  }

  try {
    const response = await httpFetch(`${GITHUB_API_BASE}${endpoint}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "TermixElectronUpdateChecker/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      timeout: 10000,
    });

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();

    githubCache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return {
      data: data,
      cached: false,
    };
  } catch (error) {
    console.error("Failed to fetch from GitHub API:", error);
    throw error;
  }
}

ipcMain.handle("check-electron-update", async () => {
  try {
    const localVersion = app.getVersion();

    const releaseData = await fetchGitHubAPI(
      `/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      "latest_release_electron",
    );

    const rawTag = releaseData.data.tag_name || releaseData.data.name || "";
    const remoteVersionMatch = rawTag.match(/(\d+\.\d+(\.\d+)?)/);
    const remoteVersion = remoteVersionMatch ? remoteVersionMatch[1] : null;

    if (!remoteVersion) {
      return {
        success: false,
        error: "Remote version not found",
        localVersion,
      };
    }

    const versionComparison = compareSemver(localVersion, remoteVersion);
    const status =
      versionComparison === null || versionComparison === 0
        ? "up_to_date"
        : versionComparison > 0
          ? "beta"
          : "requires_update";

    const result = {
      success: true,
      status,
      localVersion: localVersion,
      remoteVersion: remoteVersion,
      latest_release: {
        tag_name: releaseData.data.tag_name,
        name: releaseData.data.name,
        published_at: releaseData.data.published_at,
        html_url: releaseData.data.html_url,
        body: releaseData.data.body,
      },
      cached: releaseData.cached,
      cache_age: releaseData.cache_age,
    };

    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message,
      localVersion: app.getVersion(),
    };
  }
});

ipcMain.handle("get-platform", () => {
  return process.platform;
});

ipcMain.handle("get-embedded-server-status", () => {
  return {
    running: backendProcess !== null && !backendProcess.killed,
    embedded: !isDev,
    dataDir: isDev ? null : getBackendDataDir(),
  };
});

ipcMain.handle("get-server-config", () => {
  try {
    const userDataPath = app.getPath("userData");
    const configPath = path.join(userDataPath, "server-config.json");

    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, "utf8");
      return JSON.parse(configData);
    }
    return null;
  } catch (error) {
    console.error("Error reading server config:", error);
    return null;
  }
});

ipcMain.handle("save-server-config", (event, config) => {
  try {
    const userDataPath = app.getPath("userData");
    const configPath = path.join(userDataPath, "server-config.json");

    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Error saving server config:", error);
    return { success: false, error: error.message };
  }
});

function getC2STunnelConfigPath() {
  return path.join(app.getPath("userData"), "c2s-tunnels.json");
}

ipcMain.handle("get-c2s-tunnel-config", () => {
  try {
    const configPath = getC2STunnelConfigPath();
    if (!fs.existsSync(configPath)) {
      return [];
    }
    const configData = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(configData);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Error reading C2S tunnel config:", error);
    return [];
  }
});

ipcMain.handle("save-c2s-tunnel-config", async (_event, config) => {
  try {
    if (!Array.isArray(config)) {
      return { success: false, error: "C2S tunnel config must be an array" };
    }
    const autoStartListeners = new Set();
    const autoStartRemoteListeners = new Set();
    for (const tunnel of config) {
      if (!tunnel?.autoStart) continue;
      const mode = tunnel.mode || tunnel.tunnelType || "local";
      if (mode === "remote") {
        const sourceHostId = Number(tunnel.sourceHostId);
        const sourcePort = Number(tunnel.sourcePort);
        if (
          !Number.isInteger(sourceHostId) ||
          sourceHostId < 1 ||
          !Number.isInteger(sourcePort) ||
          sourcePort < 1 ||
          sourcePort > 65535
        ) {
          return {
            success: false,
            error: "Invalid remote client tunnel endpoint or port",
          };
        }
        const listenerKey = `${sourceHostId}:${sourcePort}`;
        if (autoStartRemoteListeners.has(listenerKey)) {
          return {
            success: false,
            error: `Another auto-start client tunnel already uses remote ${listenerKey}`,
          };
        }
        autoStartRemoteListeners.add(listenerKey);
        continue;
      }

      const bindHost = tunnel.bindHost || "127.0.0.1";
      const sourcePort = Number(tunnel.sourcePort);
      const listenerKey = `${bindHost}:${sourcePort}`;
      if (autoStartListeners.has(listenerKey)) {
        return {
          success: false,
          error: `Another auto-start client tunnel already uses ${listenerKey}`,
        };
      }
      autoStartListeners.add(listenerKey);
    }
    for (const listenerKey of autoStartListeners) {
      const [bindHost, sourcePort] = listenerKey.split(":");
      const result = await checkLocalPortAvailable(
        bindHost,
        Number(sourcePort),
      );
      const ownedByClientTunnel = Array.from(c2sTunnelRuntimes.values()).some(
        (runtime) =>
          runtime.bindHost === bindHost &&
          runtime.sourcePort === Number(sourcePort),
      );
      if (!result.available && !ownedByClientTunnel) {
        return {
          success: false,
          error: `Cannot auto-start client tunnel on ${listenerKey}: ${result.error || "port is already in use"}`,
        };
      }
    }
    const userDataPath = app.getPath("userData");
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    fs.writeFileSync(getC2STunnelConfigPath(), JSON.stringify(config, null, 2));
    return { success: true };
  } catch (error) {
    console.error("Error saving C2S tunnel config:", error);
    return { success: false, error: error.message };
  }
});

function checkLocalPortAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => {
      resolve({ available: false, error: error.message });
    });
    server.once("listening", () => {
      server.close(() => resolve({ available: true }));
    });
    server.listen({ host, port });
  });
}

function checkTcpConnection(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ success: false, error: "Connection timed out" });
    }, 5000);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ success: true });
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ success: false, error: error.message });
    });
  });
}

const c2sTunnelRuntimes = new Map();
const C2S_WS_HIGH_WATERMARK = 1024 * 1024;
const C2S_WS_LOW_WATERMARK = 256 * 1024;
const C2S_STREAM_WRITE_LIMIT = 8 * 1024 * 1024;

function getServerConfigSync() {
  try {
    const configPath = path.join(app.getPath("userData"), "server-config.json");
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

function getC2SRelayUrl() {
  const config = getServerConfigSync();
  const serverUrl =
    config?.serverUrl || (!isDev ? "http://127.0.0.1:30003" : null);
  if (!serverUrl) {
    throw new Error("No Termix server configured");
  }

  const base = serverUrl.replace(/\/$/, "");
  const relayHttpUrl = base.endsWith(":30003")
    ? `${base}/ssh/tunnel/c2s/stream`
    : `${base}/ssh/tunnel/c2s/stream`;
  return relayHttpUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

async function getC2SRelayHeaders(relayUrl) {
  if (!mainWindow?.webContents?.session) return {};

  const cookieUrl = relayUrl
    .replace(/^ws:/, "http:")
    .replace(/^wss:/, "https:");
  const cookies = await mainWindow.webContents.session.cookies.get({
    url: cookieUrl,
    name: "jwt",
  });
  const jwt = cookies[0]?.value;
  if (!jwt) return {};

  return {
    Cookie: `jwt=${encodeURIComponent(jwt)}`,
  };
}

function getC2STunnelName(tunnel, index = 0) {
  if (tunnel.name) return tunnel.name;
  return [
    "c2s",
    index,
    tunnel.sourceHostId || 0,
    tunnel.mode || tunnel.tunnelType || "local",
    tunnel.bindHost || "127.0.0.1",
    tunnel.sourcePort,
    tunnel.endpointPort || 0,
  ].join("::");
}

function getC2STunnelStatus(tunnelName) {
  return (
    c2sTunnelRuntimes.get(tunnelName)?.status || {
      connected: false,
      status: "DISCONNECTED",
    }
  );
}

function getAllC2STunnelStatuses() {
  const statuses = {};
  for (const [tunnelName] of c2sTunnelRuntimes.entries()) {
    statuses[tunnelName] = getC2STunnelStatus(tunnelName);
  }
  return statuses;
}

function emitC2STunnelStatuses() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("c2s-tunnel-statuses", getAllC2STunnelStatuses());
}

function setC2STunnelStatus(tunnelName, status) {
  const runtime = c2sTunnelRuntimes.get(tunnelName);
  if (runtime) {
    runtime.status = status;
    emitC2STunnelStatuses();
  }
}

function setC2STunnelError(tunnelName, message) {
  logToFile(`[c2s] ${tunnelName} failed:`, message);
  setC2STunnelStatus(tunnelName, {
    connected: false,
    status: "ERROR",
    reason: message,
  });
}

function parseSocks5Target(buffer) {
  if (buffer.length < 7 || buffer[0] !== 0x05 || buffer[1] !== 0x01) {
    return null;
  }

  const addressType = buffer[3];
  let offset = 4;
  let host;

  if (addressType === 0x01) {
    if (buffer.length < offset + 4 + 2) return null;
    host = Array.from(buffer.subarray(offset, offset + 4)).join(".");
    offset += 4;
  } else if (addressType === 0x03) {
    const length = buffer[offset];
    offset += 1;
    if (buffer.length < offset + length + 2) return null;
    host = buffer.subarray(offset, offset + length).toString("utf8");
    offset += length;
  } else if (addressType === 0x04) {
    if (buffer.length < offset + 16 + 2) return null;
    const parts = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(buffer.readUInt16BE(offset + i).toString(16));
    }
    host = parts.join(":");
    offset += 16;
  } else {
    throw new Error("Unsupported SOCKS5 address type");
  }

  const port = buffer.readUInt16BE(offset);
  return { host, port, bytesRead: offset + 2 };
}

async function openC2SRelay(
  tunnel,
  targetHost,
  targetPort,
  socket,
  initialData,
) {
  const tunnelName = tunnel.name || getC2STunnelName(tunnel);
  const relayUrl = getC2SRelayUrl();
  const headers = await getC2SRelayHeaders(relayUrl);
  logToFile(`[c2s] opening relay for ${tunnelName}`, {
    relayUrl,
    targetHost,
    targetPort,
  });
  setC2STunnelStatus(tunnelName, {
    connected: false,
    status: "CONNECTING",
    reason: `Opening relay to ${targetHost}:${targetPort}`,
  });
  const ws = new WebSocket(
    relayUrl,
    getWebSocketOptions(relayUrl, { headers }),
  );
  const pendingChunks = [];
  let ready = false;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try {
      socket.destroy();
    } catch {
      // expected during shutdown
    }
    try {
      ws.close();
    } catch {
      // expected during shutdown
    }
  };

  const sendChunk = (chunk) => {
    if (ready && ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    } else {
      pendingChunks.push(chunk);
    }
  };

  socket.on("data", sendChunk);
  socket.on("close", cleanup);
  socket.on("error", (error) => {
    setC2STunnelError(tunnelName, error.message || "Local socket error");
    cleanup();
  });
  ws.on("close", cleanup);
  ws.on("error", (error) => {
    setC2STunnelError(tunnelName, error.message || "Relay connection failed");
    cleanup();
  });

  ws.on("open", () => {
    logToFile(`[c2s] relay connected for ${tunnelName}`);
    ws.send(
      JSON.stringify({
        type: "open",
        tunnelConfig: tunnel,
        targetHost,
        targetPort,
      }),
    );
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      socket.write(Buffer.isBuffer(data) ? data : Buffer.from(data));
      return;
    }

    try {
      const message = JSON.parse(data.toString());
      if (message.type === "ready") {
        ready = true;
        logToFile(`[c2s] relay ready for ${tunnelName}`);
        setC2STunnelStatus(tunnelName, {
          connected: true,
          status: "CONNECTED",
        });
        if (initialData?.length) {
          ws.send(initialData);
        }
        while (pendingChunks.length > 0) {
          ws.send(pendingChunks.shift());
        }
      } else if (message.type === "error") {
        logToFile("[c2s] relay error:", message.error);
        setC2STunnelError(
          tunnelName,
          message.error || "Relay rejected the client tunnel",
        );
        cleanup();
      }
    } catch (error) {
      logToFile("[c2s] invalid relay message:", error.message);
      setC2STunnelError(tunnelName, error.message || "Invalid relay response");
      cleanup();
    }
  });
}

async function testC2SRelay(tunnel, targetHost, targetPort) {
  const relayUrl = getC2SRelayUrl();
  const headers = await getC2SRelayHeaders(relayUrl);
  const ws = new WebSocket(
    relayUrl,
    getWebSocketOptions(relayUrl, { headers }),
  );

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // expected during shutdown
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      settle({ success: false, error: "Tunnel test timed out" });
    }, 15000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "test",
          tunnelConfig: tunnel,
          targetHost,
          targetPort,
        }),
      );
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;

      try {
        const message = JSON.parse(data.toString());
        if (message.type === "ready") {
          clearTimeout(timer);
          settle({ success: true });
        } else if (message.type === "error") {
          clearTimeout(timer);
          settle({
            success: false,
            error: message.error || "Tunnel test failed",
          });
        }
      } catch (error) {
        clearTimeout(timer);
        settle({ success: false, error: error.message });
      }
    });
    ws.on("error", (error) => {
      clearTimeout(timer);
      settle({ success: false, error: error.message });
    });
    ws.on("close", () => {
      clearTimeout(timer);
      settle({ success: false, error: "Tunnel test connection closed" });
    });
  });
}

async function testC2STunnel(tunnel, index = 0) {
  const mode = tunnel.mode || tunnel.tunnelType || "local";
  const testTunnel = {
    ...tunnel,
    name: `${getC2STunnelName(tunnel, index)}::test`,
    mode,
  };
  const bindHost = tunnel.bindHost || "127.0.0.1";
  const sourcePort = Number(tunnel.sourcePort);
  const endpointPort = Number(tunnel.endpointPort);

  if (!tunnel.sourceHostId) {
    return { success: false, error: "Endpoint SSH host is required" };
  }

  if (mode === "remote") {
    const localTarget = await checkTcpConnection(bindHost, endpointPort);
    if (!localTarget.success) {
      return {
        success: false,
        error: `Local target ${bindHost}:${endpointPort} is not reachable: ${localTarget.error}`,
      };
    }

    return testC2SRelay(testTunnel, undefined, undefined);
  }

  if (!Number.isInteger(sourcePort) || sourcePort < 1 || sourcePort > 65535) {
    return { success: false, error: "Invalid local port" };
  }

  const runtime = c2sTunnelRuntimes.get(getC2STunnelName(tunnel, index));
  if (!runtime) {
    const availability = await checkLocalPortAvailable(bindHost, sourcePort);
    if (!availability.available) {
      return {
        success: false,
        error: `Local listener ${bindHost}:${sourcePort} is not available: ${availability.error}`,
      };
    }
  }

  if (mode === "dynamic") {
    return testC2SRelay(testTunnel, undefined, undefined);
  }

  if (!Number.isInteger(endpointPort) || endpointPort < 1) {
    return { success: false, error: "Invalid remote port" };
  }

  return testC2SRelay(
    testTunnel,
    tunnel.targetHost || "127.0.0.1",
    endpointPort,
  );
}

function handleC2SDynamicConnection(tunnel, socket) {
  const tunnelName = tunnel.name || getC2STunnelName(tunnel);
  let buffer = Buffer.alloc(0);
  let stage = "greeting";

  const fail = (code = 0x01, message = "SOCKS5 request failed") => {
    setC2STunnelError(tunnelName, message);
    if (!socket.destroyed) {
      socket.write(Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      socket.destroy();
    }
  };

  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    try {
      if (stage === "greeting") {
        if (buffer.length < 2) return;
        if (buffer[0] !== 0x05) {
          fail(0x01, "Invalid SOCKS5 greeting");
          return;
        }
        const methodsLength = buffer[1];
        if (buffer.length < 2 + methodsLength) return;
        socket.write(Buffer.from([0x05, 0x00]));
        buffer = buffer.subarray(2 + methodsLength);
        stage = "connect";
      }

      if (stage === "connect") {
        const target = parseSocks5Target(buffer);
        if (!target) return;

        stage = "piping";
        socket.off("data", onData);
        const remainder = buffer.subarray(target.bytesRead);
        socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        openC2SRelay(tunnel, target.host, target.port, socket, remainder).catch(
          (error) => {
            logToFile("[c2s] dynamic relay failed:", error.message);
            fail(0x05, error.message || "Dynamic relay failed");
          },
        );
      }
    } catch (error) {
      logToFile("[c2s] SOCKS5 parse failed:", error.message);
      fail(0x01, error.message || "SOCKS5 parse failed");
    }
  };

  socket.on("data", onData);
  socket.on("error", () => socket.destroy());
}

function handleC2SLocalConnection(tunnel, socket) {
  const tunnelName = tunnel.name || getC2STunnelName(tunnel);
  const targetHost = tunnel.targetHost || "127.0.0.1";
  const targetPort = Number(tunnel.endpointPort);
  openC2SRelay(tunnel, targetHost, targetPort, socket).catch((error) => {
    logToFile("[c2s] local relay failed:", error.message);
    setC2STunnelError(tunnelName, error.message || "Local relay failed");
    socket.destroy();
  });
}

function pauseSourceForC2SWebSocket(ws, source) {
  if (!source?.pause || !source?.resume) return;
  if (ws.bufferedAmount <= C2S_WS_HIGH_WATERMARK) return;

  source.pause();
  const resumeTimer = setInterval(() => {
    if (
      ws.readyState !== WebSocket.OPEN ||
      source.destroyed ||
      ws.bufferedAmount <= C2S_WS_LOW_WATERMARK
    ) {
      clearInterval(resumeTimer);
      if (ws.readyState === WebSocket.OPEN && !source.destroyed) {
        source.resume();
      }
    }
  }, 25);
}

function sendC2SRemoteMessage(ws, message, source) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message), (error) => {
      if (error && source?.destroy) {
        source.destroy(error);
      }
    });
    pauseSourceForC2SWebSocket(ws, source);
  }
}

function writeC2SRemoteChunk(target, chunk, ws, closeTarget) {
  if (!target || target.destroyed) return;

  if (target.writableLength > C2S_STREAM_WRITE_LIMIT) {
    closeTarget();
    return;
  }

  const canContinue = target.write(chunk);
  if (!canContinue && typeof ws.pause === "function") {
    ws.pause();
    target.once("drain", () => {
      if (ws.readyState === WebSocket.OPEN && typeof ws.resume === "function") {
        ws.resume();
      }
    });
  }
}

async function startC2SRemoteTunnel(tunnel, index = 0) {
  const tunnelName = getC2STunnelName(tunnel, index);
  const localHost = tunnel.bindHost || "127.0.0.1";
  const localPort = Number(tunnel.endpointPort);
  const remotePort = Number(tunnel.sourcePort);

  if (!tunnel.sourceHostId) {
    return { success: false, error: "Endpoint SSH host is required" };
  }
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
    return { success: false, error: "Invalid remote port" };
  }
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
    return { success: false, error: "Invalid local port" };
  }

  const localTarget = await checkTcpConnection(localHost, localPort);
  if (!localTarget.success) {
    return {
      success: false,
      error: `Local target ${localHost}:${localPort} is not reachable: ${localTarget.error}`,
    };
  }

  const existing = c2sTunnelRuntimes.get(tunnelName);
  if (existing) {
    return { success: true, tunnelName };
  }

  for (const runtime of c2sTunnelRuntimes.values()) {
    if (
      runtime.mode === "remote" &&
      runtime.sourceHostId === Number(tunnel.sourceHostId) &&
      runtime.sourcePort === remotePort
    ) {
      return {
        success: false,
        error: `Another client remote tunnel already uses ${remotePort} on this endpoint`,
      };
    }
  }

  const relayUrl = getC2SRelayUrl();
  const headers = await getC2SRelayHeaders(relayUrl);
  const ws = new WebSocket(
    relayUrl,
    getWebSocketOptions(relayUrl, { headers }),
  );
  const sockets = new Map();
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    for (const socket of sockets.values()) {
      socket.destroy();
    }
    sockets.clear();
    try {
      ws.close();
    } catch {
      // expected during shutdown
    }
  };

  c2sTunnelRuntimes.set(tunnelName, {
    ws,
    sockets,
    mode: "remote",
    sourceHostId: Number(tunnel.sourceHostId),
    sourcePort: remotePort,
    bindHost: localHost,
    status: { connected: false, status: "CONNECTING" },
    close: cleanup,
  });
  emitC2STunnelStatuses();

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    ws.on("open", () => {
      logToFile(`[c2s] opening remote tunnel ${tunnelName}`, {
        relayUrl,
        remotePort,
        localHost,
        localPort,
      });
      ws.send(
        JSON.stringify({
          type: "open",
          tunnelConfig: { ...tunnel, name: tunnelName, mode: "remote" },
        }),
      );
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;

      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (error) {
        setC2STunnelError(tunnelName, error.message || "Invalid relay message");
        cleanup();
        settle({ success: false, error: error.message });
        return;
      }

      if (message.type === "ready") {
        setC2STunnelStatus(tunnelName, {
          connected: true,
          status: "CONNECTED",
        });
        settle({ success: true, tunnelName });
        return;
      }

      if (message.type === "error") {
        const error = message.error || "Relay rejected the client tunnel";
        setC2STunnelError(tunnelName, error);
        cleanup();
        c2sTunnelRuntimes.delete(tunnelName);
        emitC2STunnelStatuses();
        settle({ success: false, error });
        return;
      }

      if (message.type === "connection" && message.streamId) {
        const socket = net.createConnection(
          { host: localHost, port: localPort },
          () => {
            logToFile(`[c2s] remote stream ${message.streamId} connected`, {
              tunnelName,
              localHost,
              localPort,
            });
          },
        );
        sockets.set(message.streamId, socket);
        socket.on("data", (chunk) => {
          sendC2SRemoteMessage(
            ws,
            {
              type: "data",
              streamId: message.streamId,
              data: chunk.toString("base64"),
            },
            socket,
          );
        });
        socket.on("close", () => {
          sockets.delete(message.streamId);
          sendC2SRemoteMessage(ws, {
            type: "close",
            streamId: message.streamId,
          });
        });
        socket.on("error", (error) => {
          logToFile(`[c2s] remote stream ${message.streamId} failed:`, {
            tunnelName,
            error: error.message,
          });
          sockets.delete(message.streamId);
          sendC2SRemoteMessage(ws, {
            type: "close",
            streamId: message.streamId,
            error: error.message,
          });
        });
        return;
      }

      if (message.type === "data" && message.streamId && message.data) {
        const socket = sockets.get(message.streamId);
        writeC2SRemoteChunk(
          socket,
          Buffer.from(message.data, "base64"),
          ws,
          () => {
            if (socket) {
              sockets.delete(message.streamId);
              socket.destroy();
            }
          },
        );
        return;
      }

      if (message.type === "close" && message.streamId) {
        const socket = sockets.get(message.streamId);
        if (socket) {
          sockets.delete(message.streamId);
          socket.destroy();
        }
      }
    });

    ws.on("close", () => {
      cleanup();
      c2sTunnelRuntimes.delete(tunnelName);
      emitC2STunnelStatuses();
      settle({ success: false, error: "Remote tunnel relay closed" });
    });

    ws.on("error", (error) => {
      setC2STunnelError(tunnelName, error.message || "Relay connection failed");
      cleanup();
      c2sTunnelRuntimes.delete(tunnelName);
      emitC2STunnelStatuses();
      settle({ success: false, error: error.message });
    });
  });
}

async function startC2STunnel(tunnel, index = 0) {
  const mode = tunnel.mode || tunnel.tunnelType || "local";
  const tunnelName = getC2STunnelName(tunnel, index);
  const bindHost = tunnel.bindHost || "127.0.0.1";
  const sourcePort = Number(tunnel.sourcePort);
  logToFile(`[c2s] starting tunnel ${tunnelName}`, {
    mode,
    bindHost,
    sourcePort,
    sourceHostId: tunnel.sourceHostId,
    endpointPort: tunnel.endpointPort,
  });

  if (mode === "remote") {
    return startC2SRemoteTunnel(tunnel, index);
  }
  if (!tunnel.sourceHostId) {
    return { success: false, error: "Endpoint SSH host is required" };
  }
  if (!Number.isInteger(sourcePort) || sourcePort < 1 || sourcePort > 65535) {
    return { success: false, error: "Invalid local port" };
  }

  const existing = c2sTunnelRuntimes.get(tunnelName);
  if (existing) {
    return { success: true, tunnelName };
  }

  for (const runtime of c2sTunnelRuntimes.values()) {
    if (
      runtime.mode !== "remote" &&
      runtime.bindHost === bindHost &&
      runtime.sourcePort === sourcePort
    ) {
      return {
        success: false,
        error: `Another client tunnel already uses ${bindHost}:${sourcePort}`,
      };
    }
  }

  const availability = await checkLocalPortAvailable(bindHost, sourcePort);
  if (!availability.available) {
    return {
      success: false,
      error: availability.error || "Port is already in use",
    };
  }

  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    if (mode === "dynamic") {
      handleC2SDynamicConnection({ ...tunnel, name: tunnelName, mode }, socket);
    } else {
      handleC2SLocalConnection({ ...tunnel, name: tunnelName, mode }, socket);
    }
  });

  c2sTunnelRuntimes.set(tunnelName, {
    server,
    sockets,
    bindHost,
    sourcePort,
    status: { connected: false, status: "CONNECTING" },
  });

  return new Promise((resolve) => {
    server.once("error", (error) => {
      c2sTunnelRuntimes.delete(tunnelName);
      logToFile(`[c2s] failed to listen for ${tunnelName}:`, error.message);
      emitC2STunnelStatuses();
      resolve({ success: false, error: error.message });
    });
    server.listen({ host: bindHost, port: sourcePort }, () => {
      logToFile(
        `[c2s] listening for ${tunnelName} on ${bindHost}:${sourcePort}`,
      );
      setC2STunnelStatus(tunnelName, {
        connected: true,
        status: "CONNECTED",
      });
      resolve({ success: true, tunnelName });
    });
  });
}

async function stopC2STunnel(tunnelName) {
  const runtime = c2sTunnelRuntimes.get(tunnelName);
  if (!runtime) {
    return { success: true };
  }

  setC2STunnelStatus(tunnelName, {
    connected: false,
    status: "DISCONNECTING",
  });

  return new Promise((resolve) => {
    if (typeof runtime.close === "function") {
      runtime.close();
      c2sTunnelRuntimes.delete(tunnelName);
      emitC2STunnelStatuses();
      resolve({ success: true });
      return;
    }

    for (const socket of runtime.sockets || []) {
      socket.destroy();
    }
    runtime.server?.close(() => {
      c2sTunnelRuntimes.delete(tunnelName);
      emitC2STunnelStatuses();
      resolve({ success: true });
    });
  });
}

function stopAllC2STunnels() {
  for (const [tunnelName, runtime] of c2sTunnelRuntimes.entries()) {
    try {
      if (typeof runtime.close === "function") {
        runtime.close();
      } else {
        for (const socket of runtime.sockets || []) {
          socket.destroy();
        }
        runtime.server?.close();
      }
    } catch (error) {
      logToFile(`[c2s] failed to stop tunnel ${tunnelName}:`, error.message);
    }
    c2sTunnelRuntimes.delete(tunnelName);
  }
  emitC2STunnelStatuses();
}

async function startC2SAutoStartTunnels() {
  const configPath = getC2STunnelConfigPath();
  if (!fs.existsSync(configPath)) {
    return { success: true, started: 0, errors: [] };
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const tunnels = Array.isArray(config) ? config : [];
  const errors = [];
  let started = 0;

  for (let index = 0; index < tunnels.length; index += 1) {
    const tunnel = tunnels[index];
    if (!tunnel?.autoStart) continue;
    const result = await startC2STunnel(tunnel, index);
    if (result.success) {
      started += 1;
    } else {
      errors.push(result.error || "Failed to start client tunnel");
    }
  }

  return { success: errors.length === 0, started, errors };
}

ipcMain.handle("check-local-port-available", async (_event, host, port) => {
  const sourcePort = Number(port);
  if (
    !host ||
    !Number.isInteger(sourcePort) ||
    sourcePort < 1 ||
    sourcePort > 65535
  ) {
    return { available: false, error: "Invalid local bind address or port" };
  }
  return checkLocalPortAvailable(host, sourcePort);
});

ipcMain.handle("start-c2s-tunnel", async (_event, tunnel, index) => {
  try {
    return await startC2STunnel(tunnel, Number(index) || 0);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("test-c2s-tunnel", async (_event, tunnel, index) => {
  try {
    return await testC2STunnel(tunnel, Number(index) || 0);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("stop-c2s-tunnel", async (_event, tunnelName) => {
  try {
    return await stopC2STunnel(tunnelName);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-c2s-tunnel-statuses", () => {
  return getAllC2STunnelStatuses();
});

ipcMain.handle("start-c2s-autostart-tunnels", async () => {
  try {
    return await startC2SAutoStartTunnels();
  } catch (error) {
    return { success: false, started: 0, errors: [error.message] };
  }
});

ipcMain.handle("get-c2s-tunnel-preset-default-name", () => {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const platform =
    process.platform === "darwin"
      ? "macOS"
      : process.platform === "win32"
        ? "Windows"
        : "Linux";
  const release = os.release();
  const computerName = os.hostname();
  return `[${date}] ${computerName} (${platform} ${release})`;
});

ipcMain.handle("get-setting", (event, key) => {
  try {
    const userDataPath = app.getPath("userData");
    const settingsPath = path.join(userDataPath, "settings.json");

    if (!fs.existsSync(settingsPath)) {
      return null;
    }

    const settingsData = fs.readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(settingsData);
    return settings[key] !== undefined ? settings[key] : null;
  } catch (error) {
    console.error("Error reading setting:", error);
    return null;
  }
});

ipcMain.handle("set-setting", (event, key, value) => {
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

ipcMain.handle("get-session-cookie", async (_event, name, targetUrl) => {
  try {
    const ses = mainWindow?.webContents?.session;
    if (!ses) return null;
    const cookies = await ses.cookies.get({
      name,
      ...(targetUrl ? { url: targetUrl } : {}),
    });
    const cookie = cookies.find((candidate) =>
      cookieMatchesUrl(candidate, targetUrl),
    );
    return (
      cookie?.value ||
      getRememberedElectronAuthCookie(name, targetUrl)?.value ||
      null
    );
  } catch (error) {
    console.error("Failed to get session cookie:", error);
    return getRememberedElectronAuthCookie(name, targetUrl)?.value || null;
  }
});

function cookieMatchesUrl(cookie, targetUrl) {
  if (!targetUrl) return true;

  try {
    const targetHost = new URL(targetUrl).hostname;
    const cookieDomain = (cookie.domain || "").replace(/^\./, "");

    return (
      cookieDomain === targetHost ||
      targetHost.endsWith(`.${cookieDomain}`) ||
      (!cookieDomain && targetHost === "localhost")
    );
  } catch {
    return true;
  }
}

ipcMain.handle(
  "wait-session-cookie",
  async (_event, name, targetUrl, previousValue, timeoutMs = 5000) => {
    const ses = mainWindow?.webContents?.session;
    if (!ses) return { success: false, error: "No Electron session" };

    const existingCookies = await ses.cookies.get({
      name,
      ...(targetUrl ? { url: targetUrl } : {}),
    });
    const existingCookie = existingCookies.find((cookie) =>
      cookieMatchesUrl(cookie, targetUrl),
    );
    if (existingCookie?.value && existingCookie.value !== previousValue) {
      return { success: true, value: existingCookie.value };
    }

    const rememberedCookie = getRememberedElectronAuthCookie(name, targetUrl);
    if (rememberedCookie?.value && rememberedCookie.value !== previousValue) {
      return { success: true, value: rememberedCookie.value };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ses.cookies.off("changed", onCookieChanged);
        resolve({ success: false, error: "Timed out waiting for cookie" });
      }, timeoutMs);

      function onCookieChanged(_event, cookie, _cause, removed) {
        if (
          removed ||
          cookie.name !== name ||
          !cookie.value ||
          cookie.value === previousValue ||
          !cookieMatchesUrl(cookie, targetUrl)
        ) {
          return;
        }

        clearTimeout(timeout);
        ses.cookies.off("changed", onCookieChanged);
        resolve({ success: true, value: cookie.value });
      }

      ses.cookies.on("changed", onCookieChanged);
    });
  },
);

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

ipcMain.handle("test-server-connection", async (event, serverUrl) => {
  try {
    const normalizedServerUrl = serverUrl.replace(/\/$/, "");

    const healthUrl = `${normalizedServerUrl}/health`;

    try {
      const response = await httpFetch(healthUrl, {
        method: "GET",
        timeout: 10000,
      });

      if (response.ok) {
        const data = await response.text();

        if (
          data.includes("<html") ||
          data.includes("<!DOCTYPE") ||
          data.includes("<head>") ||
          data.includes("<body>")
        ) {
          return {
            success: false,
            error:
              "Server returned HTML instead of JSON. This does not appear to be a Termix server.",
          };
        }

        try {
          const healthData = JSON.parse(data);
          if (
            healthData &&
            (healthData.status === "ok" ||
              healthData.status === "healthy" ||
              healthData.healthy === true ||
              healthData.database === "connected")
          ) {
            return {
              success: true,
              status: response.status,
              testedUrl: healthUrl,
            };
          }
        } catch (parseError) {
          console.log("Health endpoint did not return valid JSON");
        }
      }
    } catch (urlError) {
      console.error("Health check failed:", urlError);
    }

    try {
      const versionUrl = `${normalizedServerUrl}/version`;
      const response = await httpFetch(versionUrl, {
        method: "GET",
        timeout: 10000,
      });

      if (response.ok) {
        const data = await response.text();

        if (
          data.includes("<html") ||
          data.includes("<!DOCTYPE") ||
          data.includes("<head>") ||
          data.includes("<body>")
        ) {
          return {
            success: false,
            error:
              "Server returned HTML instead of JSON. This does not appear to be a Termix server.",
          };
        }

        try {
          const versionData = JSON.parse(data);
          if (
            versionData &&
            (versionData.status === "up_to_date" ||
              versionData.status === "requires_update" ||
              (versionData.localVersion &&
                versionData.version &&
                versionData.latest_release))
          ) {
            return {
              success: true,
              status: response.status,
              testedUrl: versionUrl,
              warning:
                "Health endpoint not available, but server appears to be running",
            };
          }
        } catch (parseError) {
          console.log("Version endpoint did not return valid JSON");
        }
      }
    } catch (versionError) {
      console.error("Version check failed:", versionError);
    }

    return {
      success: false,
      error:
        "Server is not responding or does not appear to be a valid Termix server. Please ensure the server is running and accessible.",
    };
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
  createMenu();
  await clearElectronClientCacheIfBuildChanged();
  await clearElectronJwtCookiesAtStartup();

  if (!isDev) {
    const result = await startBackendServer();
    logToFile("startBackendServer result:", result);
  } else {
    logToFile(
      "Skipping embedded backend (isDev=true) - expecting separate dev:backend process",
    );
  }

  createTray();
  createWindow();
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
  }
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  console.log("App will quit...");
  stopAllC2STunnels();
  stopBackendServer();
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
