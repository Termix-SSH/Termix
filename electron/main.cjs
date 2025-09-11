const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    console.log('Another instance is already running, quitting...');
    app.quit();
    process.exit(0);
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        console.log('Second instance detected, focusing existing window...');
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
        title: 'Termix',
        icon: isDev 
            ? path.join(__dirname, '..', 'public', 'icon.png')
            : path.join(process.resourcesPath, 'public', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: !isDev,
            preload: path.join(__dirname, 'preload.js')
        },
        show: false
    });

    if (process.platform !== 'darwin') {
        mainWindow.setMenuBarVisibility(false);
    }

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
        console.log('Loading frontend from:', indexPath);
        mainWindow.loadFile(indexPath);
    }

    mainWindow.once('ready-to-show', () => {
        console.log('Window ready to show');
        mainWindow.show();
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('Failed to load:', errorCode, errorDescription, validatedURL);
    });

    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Frontend loaded successfully');
    });

    mainWindow.on('close', (event) => {
        if (process.platform === 'darwin') {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('get-platform', () => {
    return process.platform;
});

// Server configuration handlers
ipcMain.handle('get-server-config', () => {
    try {
        const userDataPath = app.getPath('userData');
        const configPath = path.join(userDataPath, 'server-config.json');
        
        if (fs.existsSync(configPath)) {
            const configData = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(configData);
        }
        return null;
    } catch (error) {
        console.error('Error reading server config:', error);
        return null;
    }
});

ipcMain.handle('save-server-config', (event, config) => {
    try {
        const userDataPath = app.getPath('userData');
        const configPath = path.join(userDataPath, 'server-config.json');
        
        // Ensure userData directory exists
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
        }
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return { success: true };
    } catch (error) {
        console.error('Error saving server config:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('test-server-connection', async (event, serverUrl) => {
    try {
        const { default: fetch } = await import('node-fetch');
        
        // Try multiple endpoints to test the connection
        const testUrls = [
            `${serverUrl}/health`,
            `${serverUrl}/version`,
            `${serverUrl}/users/registration-allowed`
        ];
        
        for (const testUrl of testUrls) {
            try {
                const response = await fetch(testUrl, {
                    method: 'GET',
                    timeout: 5000
                });
                
                if (response.ok) {
                    // If we get a 200 response, it's likely a valid Termix server
                    return { success: true, status: response.status, testedUrl: testUrl };
                }
            } catch (urlError) {
                // Continue to next URL if this one fails
                continue;
            }
        }
        
        return { success: false, error: 'Server is not responding or not a valid Termix server' };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

app.whenReady().then(() => {
    createWindow();
    console.log('Termix started successfully');
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

app.on('before-quit', () => {
    console.log('App is quitting...');
});

app.on('will-quit', () => {
    console.log('App will quit...');
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
