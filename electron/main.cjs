const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Global variables
let mainWindow = null;
let backendPort = null;

// Development environment detection
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

const BACKEND_CONFIG = {
    port: 18080
};

// Prevent multiple instances
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

// Simple backend management
async function startBackend() {
    try {
        console.log('Starting backend...');
        
        // Set up environment
        process.env.NODE_ENV = 'production';
        process.env.PORT = BACKEND_CONFIG.port.toString();
        process.env.DATA_PATH = app.getPath('userData');
        process.env.DB_PATH = path.join(app.getPath('userData'), 'database.db');
        process.env.VERSION = app.getVersion();

        // Get backend path
        const backendPath = isDev 
            ? path.join(__dirname, '..', 'dist', 'backend', 'starter.js')
            : path.join(process.resourcesPath, 'dist', 'backend', 'starter.js');

        console.log('Loading backend from:', backendPath);
        
        if (!fs.existsSync(backendPath)) {
            console.error('Backend file not found at:', backendPath);
            return null;
        }

        // Load and start the backend
        const { startServer } = await import(backendPath);
        backendPort = await startServer();
        console.log('Backend started successfully on port:', backendPort);
        return backendPort;

    } catch (error) {
        console.error('Failed to start backend:', error);
        return null;
    }
}

// Create main window
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
            webSecurity: !isDev
        },
        show: false
    });

    // Remove menu bar on Windows/Linux
    if (process.platform !== 'darwin') {
        mainWindow.setMenuBarVisibility(false);
    }

    // Load application
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        // Load from dist folder
        const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
        console.log('Loading frontend from:', indexPath);
        mainWindow.loadFile(indexPath);
    }

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        console.log('Window ready to show');
        mainWindow.show();
    });

    // Handle load errors
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('Failed to load:', errorCode, errorDescription, validatedURL);
    });

    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Frontend loaded successfully');
    });

    // Handle window close
    mainWindow.on('close', (event) => {
        if (process.platform === 'darwin') {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

// IPC handlers
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
        backendPort = await startBackend();
        return { success: true, port: backendPort };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// App event handlers
app.whenReady().then(async () => {
    // Create window immediately for fast startup
    createWindow();
    
    // Start backend in background (non-blocking)
    try {
        backendPort = await startBackend();
        if (backendPort) {
            console.log('Backend started successfully on port:', backendPort);
        }
    } catch (error) {
        console.error('Backend failed to start:', error);
    }
    
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

// Error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
