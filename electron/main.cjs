const {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  Menu,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { fork } = require("child_process");

if (process.platform === "linux") {
  app.commandLine.appendSwitch("--ozone-platform-hint=auto");

  app.commandLine.appendSwitch("--enable-features=VaapiVideoDecoder");
}

app.commandLine.appendSwitch("--ignore-certificate-errors");
app.commandLine.appendSwitch("--ignore-ssl-errors");
app.commandLine.appendSwitch("--ignore-certificate-errors-spki-list");
app.commandLine.appendSwitch("--enable-features=NetworkService");

let mainWindow = null;
let backendProcess = null;

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const appRoot = isDev ? process.cwd() : path.join(__dirname, "..");

function getBackendEntryPath() {
  if (isDev) {
    return path.join(appRoot, "dist", "backend", "backend", "starter.js");
  }
  // In production, backend is in app.asar.unpacked (fork can't read from asar)
  const asarUnpacked = appRoot.replace("app.asar", "app.asar.unpacked");
  return path.join(asarUnpacked, "dist", "backend", "backend", "starter.js");
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
  const entryPath = getBackendEntryPath();

  if (!fs.existsSync(entryPath)) {
    console.error("Backend entry not found:", entryPath);
    return false;
  }

  const dataDir = getBackendDataDir();
  console.log("Starting embedded backend server...");
  console.log("Backend entry:", entryPath);
  console.log("Data directory:", dataDir);

  const cwd = isDev
    ? appRoot
    : appRoot.replace("app.asar", "app.asar.unpacked");

  backendProcess = fork(entryPath, [], {
    cwd: cwd,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      NODE_ENV: "production",
      ELECTRON_EMBEDDED: "true",
    },
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });

  backendProcess.stdout.on("data", (data) => {
    console.log("[backend]", data.toString().trim());
  });

  backendProcess.stderr.on("data", (data) => {
    console.error("[backend]", data.toString().trim());
  });

  backendProcess.on("exit", (code, signal) => {
    console.log(
      `Backend process exited with code ${code}, signal ${signal}`,
    );
    backendProcess = null;
  });

  backendProcess.on("error", (err) => {
    console.error("Failed to start backend process:", err);
    backendProcess = null;
  });

  return true;
}

function stopBackendServer() {
  if (backendProcess) {
    console.log("Stopping embedded backend server...");
    backendProcess.kill("SIGTERM");

    // Force kill after 5 seconds if still alive
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
      partition: "persist:termix",
      allowRunningInsecureContent: true,
      webviewTag: true,
      offscreen: false,
    },
    show: true,
  });

  if (process.platform !== "darwin") {
    mainWindow.setMenuBarVisibility(false);
  }

  const customUserAgent = `Termix-Desktop/${appVersion} (${platform}; Electron/${electronVersion})`;
  mainWindow.webContents.setUserAgent(customUserAgent);

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    (details, callback) => {
      details.requestHeaders["X-Electron-App"] = "true";

      details.requestHeaders["User-Agent"] = customUserAgent;

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

        if (headers["set-cookie"]) {
          headers["set-cookie"] = headers["set-cookie"].map((cookie) => {
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
    let fetch;
    try {
      fetch = globalThis.fetch || require("node-fetch");
    } catch (e) {
      const https = require("https");
      const http = require("http");
      const { URL } = require("url");

      fetch = (url, options = {}) => {
        return new Promise((resolve, reject) => {
          const urlObj = new URL(url);
          const isHttps = urlObj.protocol === "https:";
          const client = isHttps ? https : http;

          const requestOptions = {
            method: options.method || "GET",
            headers: options.headers || {},
            timeout: options.timeout || 10000,
          };

          if (isHttps) {
            requestOptions.rejectUnauthorized = false;
            requestOptions.agent = new https.Agent({
              rejectUnauthorized: false,
              secureProtocol: "TLSv1_2_method",
              checkServerIdentity: () => undefined,
              ciphers: "ALL:!ADH:!LOW:!EXP:!MD5:@STRENGTH",
              honorCipherOrder: true,
            });
          }

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
      };
    }

    const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, {
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

    const isUpToDate = localVersion === remoteVersion;

    const result = {
      success: true,
      status: isUpToDate ? "up_to_date" : "requires_update",
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

ipcMain.handle("test-server-connection", async (event, serverUrl) => {
  try {
    const https = require("https");
    const http = require("http");
    const { URL } = require("url");

    const fetch = (url, options = {}) => {
      return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === "https:";
        const client = isHttps ? https : http;

        const requestOptions = {
          method: options.method || "GET",
          headers: options.headers || {},
          timeout: options.timeout || 10000,
        };

        if (isHttps) {
          requestOptions.rejectUnauthorized = false;
          requestOptions.agent = new https.Agent({
            rejectUnauthorized: false,
            secureProtocol: "TLSv1_2_method",
            checkServerIdentity: () => undefined,
            ciphers: "ALL:!ADH:!LOW:!EXP:!MD5:@STRENGTH",
            honorCipherOrder: true,
          });
        }

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
    };

    const normalizedServerUrl = serverUrl.replace(/\/$/, "");

    const healthUrl = `${normalizedServerUrl}/health`;

    try {
      const response = await fetch(healthUrl, {
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
      const response = await fetch(versionUrl, {
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

app.whenReady().then(() => {
  createMenu();

  // Start embedded backend server (skip in dev mode, backend runs separately)
  if (!isDev) {
    startBackendServer();
  }

  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("will-quit", () => {
  console.log("App will quit...");
  stopBackendServer();
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
