const { app, BrowserWindow, shell, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

let mainWindow = null;

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log("Another instance is already running, quitting...");
  app.quit();
  process.exit(0);
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    console.log("Second instance detected, focusing existing window...");
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.show();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Termix",
    icon: isDev
      ? path.join(__dirname, "..", "public", "icon.png")
      : path.join(process.resourcesPath, "public", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: !isDev,
      preload: path.join(__dirname, "preload.js"),
    },
    show: false,
  });

  if (process.platform !== "darwin") {
    mainWindow.setMenuBarVisibility(false);
  }

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    console.log("Loading frontend from:", indexPath);
    mainWindow.loadFile(indexPath);
  }

  mainWindow.once("ready-to-show", () => {
    console.log("Window ready to show");
    mainWindow.show();
  });

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
    if (process.platform === "darwin") {
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

ipcMain.handle("get-platform", () => {
  return process.platform;
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

ipcMain.handle("test-server-connection", async (event, serverUrl) => {
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

          const req = client.request(
            url,
            {
              method: options.method || "GET",
              headers: options.headers || {},
              timeout: options.timeout || 5000,
            },
            (res) => {
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
            },
          );

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

    const normalizedServerUrl = serverUrl.replace(/\/$/, "");

    const healthUrl = `${normalizedServerUrl}/health`;

    try {
      const response = await fetch(healthUrl, {
        method: "GET",
        timeout: 5000,
      });

      if (response.ok) {
        const data = await response.text();

        if (
          data.includes("<html") ||
          data.includes("<!DOCTYPE") ||
          data.includes("<head>") ||
          data.includes("<body>")
        ) {
          console.log(
            "Health endpoint returned HTML instead of JSON - not a Termix server",
          );
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
        timeout: 5000,
      });

      if (response.ok) {
        const data = await response.text();

        if (
          data.includes("<html") ||
          data.includes("<!DOCTYPE") ||
          data.includes("<head>") ||
          data.includes("<body>")
        ) {
          console.log(
            "Version endpoint returned HTML instead of JSON - not a Termix server",
          );
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

app.whenReady().then(() => {
  createWindow();
  console.log("Termix started successfully");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

// ================== 拖拽功能实现 ==================

// 临时文件管理
const tempFiles = new Map(); // 存储临时文件路径映射

// 创建临时文件
ipcMain.handle("create-temp-file", async (event, fileData) => {
  try {
    const { fileName, content, encoding = "base64" } = fileData;

    // 创建临时目录
    const tempDir = path.join(os.tmpdir(), "termix-drag-files");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 生成临时文件路径
    const tempId = Date.now() + "-" + Math.random().toString(36).substr(2, 9);
    const tempFilePath = path.join(tempDir, `${tempId}-${fileName}`);

    // 写入文件内容
    if (encoding === "base64") {
      const buffer = Buffer.from(content, "base64");
      fs.writeFileSync(tempFilePath, buffer);
    } else {
      fs.writeFileSync(tempFilePath, content, "utf8");
    }

    // 记录临时文件
    tempFiles.set(tempId, {
      path: tempFilePath,
      fileName: fileName,
      createdAt: Date.now(),
    });

    console.log(`Created temp file: ${tempFilePath}`);
    return { success: true, tempId, path: tempFilePath };
  } catch (error) {
    console.error("Error creating temp file:", error);
    return { success: false, error: error.message };
  }
});

// 开始拖拽到桌面
ipcMain.handle("start-drag-to-desktop", async (event, { tempId, fileName }) => {
  try {
    const tempFile = tempFiles.get(tempId);
    if (!tempFile) {
      throw new Error("Temporary file not found");
    }

    // 使用Electron的startDrag API
    const iconPath = path.join(__dirname, "..", "public", "icon.png");
    const iconExists = fs.existsSync(iconPath);

    mainWindow.webContents.startDrag({
      file: tempFile.path,
      icon: iconExists ? iconPath : undefined,
    });

    console.log(`Started drag for: ${tempFile.path}`);
    return { success: true };
  } catch (error) {
    console.error("Error starting drag:", error);
    return { success: false, error: error.message };
  }
});

// 清理临时文件
ipcMain.handle("cleanup-temp-file", async (event, tempId) => {
  try {
    const tempFile = tempFiles.get(tempId);
    if (tempFile && fs.existsSync(tempFile.path)) {
      fs.unlinkSync(tempFile.path);
      tempFiles.delete(tempId);
      console.log(`Cleaned up temp file: ${tempFile.path}`);
    }
    return { success: true };
  } catch (error) {
    console.error("Error cleaning up temp file:", error);
    return { success: false, error: error.message };
  }
});

// 批量清理过期临时文件（5分钟过期）
const cleanupExpiredTempFiles = () => {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5分钟

  for (const [tempId, tempFile] of tempFiles.entries()) {
    if (now - tempFile.createdAt > maxAge) {
      try {
        if (fs.existsSync(tempFile.path)) {
          fs.unlinkSync(tempFile.path);
        }
        tempFiles.delete(tempId);
        console.log(`Auto-cleaned expired temp file: ${tempFile.path}`);
      } catch (error) {
        console.error("Error auto-cleaning temp file:", error);
      }
    }
  }
};

// 每分钟清理一次过期临时文件
setInterval(cleanupExpiredTempFiles, 60 * 1000);

// 创建临时文件夹拖拽支持
ipcMain.handle("create-temp-folder", async (event, folderData) => {
  try {
    const { folderName, files } = folderData;

    // 创建临时目录
    const tempDir = path.join(os.tmpdir(), "termix-drag-folders");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempId = Date.now() + "-" + Math.random().toString(36).substr(2, 9);
    const tempFolderPath = path.join(tempDir, `${tempId}-${folderName}`);

    // 递归创建文件夹结构
    const createFolderStructure = (basePath, fileList) => {
      for (const file of fileList) {
        const fullPath = path.join(basePath, file.relativePath);
        const dirPath = path.dirname(fullPath);

        // 确保目录存在
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }

        // 写入文件
        if (file.encoding === "base64") {
          const buffer = Buffer.from(file.content, "base64");
          fs.writeFileSync(fullPath, buffer);
        } else {
          fs.writeFileSync(fullPath, file.content, "utf8");
        }
      }
    };

    fs.mkdirSync(tempFolderPath, { recursive: true });
    createFolderStructure(tempFolderPath, files);

    // 记录临时文件夹
    tempFiles.set(tempId, {
      path: tempFolderPath,
      fileName: folderName,
      createdAt: Date.now(),
      isFolder: true,
    });

    console.log(`Created temp folder: ${tempFolderPath}`);
    return { success: true, tempId, path: tempFolderPath };
  } catch (error) {
    console.error("Error creating temp folder:", error);
    return { success: false, error: error.message };
  }
});

app.on("before-quit", () => {
  console.log("App is quitting...");

  // 清理所有临时文件
  for (const [tempId, tempFile] of tempFiles.entries()) {
    try {
      if (fs.existsSync(tempFile.path)) {
        if (tempFile.isFolder) {
          fs.rmSync(tempFile.path, { recursive: true, force: true });
        } else {
          fs.unlinkSync(tempFile.path);
        }
      }
    } catch (error) {
      console.error("Error cleaning up temp file on quit:", error);
    }
  }
  tempFiles.clear();
});

app.on("will-quit", () => {
  console.log("App will quit...");
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
