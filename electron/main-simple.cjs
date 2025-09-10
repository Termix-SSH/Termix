const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// 全局变量
let mainWindow = null;
let backendProcess = null;

// 开发环境检测
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// 启动后端服务
function startBackendServer() {
    if (backendProcess) {
        console.log('Backend server already running');
        return;
    }

    // 在打包环境中，后端文件在 resources/app/dist/backend/backend/ 目录下
    const backendPath = isDev 
        ? path.join(__dirname, '../dist/backend/starter.js')
        : path.join(process.resourcesPath, 'app', 'dist', 'backend', 'backend', 'starter.js');
    
    console.log('Starting backend server from:', backendPath);
    console.log('Working directory:', process.cwd());

    // 设置环境变量
    const env = {
        ...process.env,
        NODE_ENV: 'production',
        DATA_PATH: app.getPath('userData'),
        DB_PATH: path.join(app.getPath('userData'), 'database.db'),
        VERSION: app.getVersion()
    };

    // 检查文件是否存在
    const fs = require('fs');
    if (!fs.existsSync(backendPath)) {
        console.error('Backend file not found at:', backendPath);
        return;
    }

    console.log('Backend file exists, starting process...');
    console.log('Environment variables:', env);

    backendProcess = spawn('node', [backendPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        cwd: isDev ? path.join(__dirname, '..') : process.resourcesPath,
        env: env
    });

    backendProcess.stdout.on('data', (data) => {
        console.log('Backend stdout:', data.toString());
    });

    backendProcess.stderr.on('data', (data) => {
        console.error('Backend stderr:', data.toString());
    });

    backendProcess.on('close', (code) => {
        console.log(`Backend process exited with code ${code}`);
        backendProcess = null;
    });

    backendProcess.on('error', (error) => {
        console.error('Failed to start backend process:', error);
        console.error('Error details:', error.message);
        console.error('Error code:', error.code);
        backendProcess = null;
    });

    // 等待一下看看进程是否启动成功
    setTimeout(() => {
        if (backendProcess && !backendProcess.killed) {
            console.log('Backend process appears to be running');
        } else {
            console.error('Backend process failed to start or died immediately');
        }
    }, 1000);
}

// 停止后端服务
function stopBackendServer() {
    if (backendProcess) {
        console.log('Stopping backend server...');
        backendProcess.kill();
        backendProcess = null;
    }
}

// 防止多开
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

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
            preload: path.join(__dirname, 'preload-simple.cjs'),
            webSecurity: !isDev
        },
        show: false,
    });

    // 创建应用菜单（包含开发者工具快捷键）
    const template = [
        {
            label: 'View',
            submenu: [
                {
                    label: 'Toggle Developer Tools',
                    accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I',
                    click: () => {
                        mainWindow.webContents.toggleDevTools();
                    }
                },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        mainWindow.webContents.reload();
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    // 加载应用
    if (isDev) {
        // 开发环境：连接到 Vite 开发服务器
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        // 生产环境：加载构建后的文件
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
        // 生产环境也启用开发者工具以便调试
        mainWindow.webContents.openDevTools();
    }

    // 窗口准备好后显示
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 处理窗口关闭事件
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 处理外部链接
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

// IPC 通信处理
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('get-platform', () => {
    return process.platform;
});

ipcMain.handle('get-backend-port', () => {
    return 8081; // 后端服务端口
});

ipcMain.handle('restart-backend', async () => {
    try {
        stopBackendServer();
        await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒
        startBackendServer();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 应用事件处理
app.whenReady().then(async () => {
    // 启动后端服务
    startBackendServer();
    
    // 等待后端服务启动
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    createWindow();
});

app.on('window-all-closed', () => {
    stopBackendServer();
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

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});