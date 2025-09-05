const { app, BrowserWindow, Menu, Tray, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// 动态导入可能有 ESM 问题的模块
let portfinder;
let Store;
let autoUpdater;

try {
    portfinder = require('portfinder');
    Store = require('electron-store');
    const updaterModule = require('electron-updater');
    autoUpdater = updaterModule.autoUpdater;
} catch (error) {
    console.error('Error loading modules:', error);
    // 提供后备方案
    portfinder = {
        getPortPromise: async () => 18080 + Math.floor(Math.random() * 100)
    };
    Store = class {
        constructor() { this.data = {}; }
        get(key, defaultValue) { return this.data[key] || defaultValue; }
        set(key, value) { this.data[key] = value; }
    };
}

// 初始化配置存储
const store = new Store();

// 全局变量
let mainWindow = null;
let backendProcess = null;
let tray = null;
let backendPort = null;
let isQuitting = false;

// 开发环境检测
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// 防止多开
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // 如果用户试图运行第二个实例，我们应该聚焦我们的窗口
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// 后端进程管理类
class BackendManager {
    constructor() {
        this.process = null;
        this.port = null;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.isStarting = false;
        this.healthCheckInterval = null;
    }

    async findAvailablePort() {
        portfinder.basePort = store.get('backend.port', 18080);
        try {
            const port = await portfinder.getPortPromise();
            this.port = port;
            return port;
        } catch (error) {
            console.error('Error finding available port:', error);
            throw error;
        }
    }

    async start() {
        if (this.isStarting || this.process) {
            console.log('Backend already starting or running');
            return;
        }

        this.isStarting = true;

        try {
            // 查找可用端口
            await this.findAvailablePort();
            console.log(`Starting backend on port ${this.port}`);

            // 确定后端可执行文件路径
            let backendPath;
            if (isDev) {
                // 开发环境：使用 node 运行构建后的 JS
                backendPath = path.join(__dirname, '..', 'dist', 'backend', 'starter.js');
            } else {
                // 生产环境：使用打包后的后端
                backendPath = path.join(process.resourcesPath, 'backend', 'starter.js');
            }

            // 确保后端文件存在
            if (!fs.existsSync(backendPath)) {
                throw new Error(`Backend file not found at ${backendPath}`);
            }

            // 设置环境变量
            const env = {
                ...process.env,
                PORT: this.port.toString(),
                NODE_ENV: isDev ? 'development' : 'production',
                DATA_PATH: app.getPath('userData'),
                DB_PATH: path.join(app.getPath('userData'), 'database.db'),
            };

            // 启动后端进程
            if (isDev) {
                this.process = spawn('node', [backendPath], {
                    env,
                    cwd: path.join(__dirname, '..'),
                    stdio: ['ignore', 'pipe', 'pipe']
                });
            } else {
                this.process = spawn('node', [backendPath], {
                    env,
                    cwd: process.resourcesPath,
                    stdio: ['ignore', 'pipe', 'pipe']
                });
            }

            // 监听后端输出
            this.process.stdout.on('data', (data) => {
                console.log(`Backend stdout: ${data}`);
                // 向渲染进程发送日志
                if (mainWindow) {
                    mainWindow.webContents.send('backend-log', data.toString());
                }
            });

            this.process.stderr.on('data', (data) => {
                console.error(`Backend stderr: ${data}`);
                if (mainWindow) {
                    mainWindow.webContents.send('backend-error', data.toString());
                }
            });

            // 监听后端进程退出
            this.process.on('exit', (code) => {
                console.log(`Backend process exited with code ${code}`);
                this.process = null;
                this.isStarting = false;

                // 如果不是正在退出且退出码不为0，尝试重启
                if (!isQuitting && code !== 0 && this.retryCount < this.maxRetries) {
                    this.retryCount++;
                    console.log(`Attempting to restart backend (retry ${this.retryCount}/${this.maxRetries})`);
                    setTimeout(() => this.start(), 2000);
                }
            });

            // 等待后端启动
            await this.waitForBackend();
            
            // 启动健康检查
            this.startHealthCheck();

            // 更新全局端口变量
            backendPort = this.port;

            // 通知渲染进程
            if (mainWindow) {
                mainWindow.webContents.send('backend-started', { port: this.port });
            }

            this.isStarting = false;
            this.retryCount = 0;

            return this.port;
        } catch (error) {
            console.error('Failed to start backend:', error);
            this.isStarting = false;
            throw error;
        }
    }

    async waitForBackend() {
        const maxWaitTime = 30000; // 30秒
        const checkInterval = 500; // 每500ms检查一次
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
            try {
                // 尝试连接后端健康检查端点
                const response = await fetch(`http://127.0.0.1:${this.port}/health`);
                if (response.ok) {
                    console.log('Backend is ready');
                    return;
                }
            } catch (error) {
                // 继续等待
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        throw new Error('Backend failed to start within timeout period');
    }

    startHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        this.healthCheckInterval = setInterval(async () => {
            if (!this.process) return;

            try {
                const response = await fetch(`http://127.0.0.1:${this.port}/health`);
                if (!response.ok) {
                    console.error('Backend health check failed');
                    // 可以在这里触发重启逻辑
                }
            } catch (error) {
                console.error('Backend health check error:', error);
            }
        }, 10000); // 每10秒检查一次
    }

    stop() {
        return new Promise((resolve) => {
            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
                this.healthCheckInterval = null;
            }

            if (!this.process) {
                resolve();
                return;
            }

            console.log('Stopping backend process...');

            // 设置超时强制杀死
            const killTimeout = setTimeout(() => {
                if (this.process) {
                    console.log('Force killing backend process');
                    this.process.kill('SIGKILL');
                }
            }, 5000);

            this.process.on('exit', () => {
                clearTimeout(killTimeout);
                this.process = null;
                console.log('Backend process stopped');
                resolve();
            });

            // 优雅关闭
            this.process.kill('SIGTERM');
        });
    }
}

// 创建后端管理器实例
const backendManager = new BackendManager();

// 创建主窗口
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'Termix',
        icon: path.join(__dirname, '..', 'public', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs'),
            webSecurity: !isDev
        },
        show: false, // 先不显示，等加载完成
    });

    // 移除默认菜单栏（Windows/Linux）
    if (process.platform !== 'darwin') {
        mainWindow.setMenuBarVisibility(false);
    }

    // 加载应用
    if (isDev) {
        // 开发环境：连接到 Vite 开发服务器
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        // 生产环境：加载构建后的文件
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }

    // 窗口准备好后显示
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 处理窗口关闭事件
    mainWindow.on('close', (event) => {
        if (!isQuitting && process.platform === 'darwin') {
            // macOS：隐藏窗口而不是退出
            event.preventDefault();
            mainWindow.hide();
        } else if (!isQuitting && store.get('minimizeToTray', true)) {
            // Windows/Linux：最小化到托盘
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 处理外部链接
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

// 创建系统托盘
function createTray() {
    if (process.platform === 'darwin') return; // macOS 不需要托盘

    const iconPath = path.join(__dirname, '..', 'public', 'icon.png');
    tray = new Tray(iconPath);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('Termix');
    tray.setContextMenu(contextMenu);

    // 双击托盘图标显示窗口
    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// IPC 通信处理
ipcMain.handle('get-backend-port', () => {
    return backendPort;
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('get-platform', () => {
    return process.platform;
});

ipcMain.handle('restart-backend', async () => {
    try {
        await backendManager.stop();
        await backendManager.start();
        return { success: true, port: backendManager.port };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('show-save-dialog', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result;
});

ipcMain.handle('show-open-dialog', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
});

// 自动更新
if (!isDev && autoUpdater) {
    try {
        autoUpdater.checkForUpdatesAndNotify();
        
        autoUpdater.on('update-available', () => {
            if (mainWindow) {
                mainWindow.webContents.send('update-available');
            }
        });

        autoUpdater.on('update-downloaded', () => {
            if (mainWindow) {
                mainWindow.webContents.send('update-downloaded');
            }
        });
    } catch (error) {
        console.log('Auto-updater not available:', error);
    }
}

// 应用事件处理
app.whenReady().then(async () => {
    try {
        // 启动后端
        await backendManager.start();
        
        // 创建窗口
        createWindow();
        
        // 创建托盘
        createTray();
    } catch (error) {
        console.error('Failed to initialize application:', error);
        dialog.showErrorBox('启动失败', `无法启动应用: ${error.message}`);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    } else if (mainWindow) {
        mainWindow.show();
    }
});

app.on('before-quit', async () => {
    isQuitting = true;
    await backendManager.stop();
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    dialog.showErrorBox('未捕获的异常', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});