import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';

let mainWindow: BrowserWindow | null = null;
let serverInstance: any = null;
let tray: Tray | null = null;
let runningPort = 3000;

// Enforce Desktop Mode for paths
process.env.DESKTOP_MODE = "true";
process.env.NODE_ENV = "production";

// Configure Logging
const appDataPath = app.getPath('userData');
const logDir = path.join(appDataPath, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, 'app.log');

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  console.log(msg);
}

log('Starting LedgerAI PH Windows Production Foundation...');

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log('Another instance is already running. Handing over to existing instance.');
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  log(`Second instance detected. Re-opening browser URL: http://localhost:${runningPort}/`);
  shell.openExternal(`http://localhost:${runningPort}/`);
});

// Helper: Check server health
function checkServerReady(port: number, timeoutMs: number = 15000): Promise<boolean> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        resolve(false);
        return;
      }

      const req = http.get(`http://localhost:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.application === 'LedgerAI PH') {
                clearInterval(interval);
                resolve(true);
              }
            } catch (e) {
              // Parse error, retry
            }
          });
        }
      });

      req.on('error', () => {
        // Connection error, retry
      });

      req.end();
    }, 500); // Poll every 500ms
  });
}

function createTray(port: number) {
  let finalIconPath = path.join(__dirname, 'favicon.ico');
  if (!fs.existsSync(finalIconPath)) {
    finalIconPath = path.join(app.getAppPath(), 'dist', 'favicon.ico');
  }
  if (!fs.existsSync(finalIconPath)) {
    finalIconPath = path.join(app.getAppPath(), 'public', 'favicon.ico');
  }

  try {
    tray = new Tray(fs.existsSync(finalIconPath) ? finalIconPath : path.join(__dirname, 'favicon.ico'));
    const contextMenu = Menu.buildFromTemplate([
      { label: 'LedgerAI PH — Active', enabled: false },
      { label: `Local Server Port: ${port}`, enabled: false },
      { type: 'separator' },
      { label: 'Open App in Browser', click: () => { shell.openExternal(`http://localhost:${port}/`); } },
      { type: 'separator' },
      { label: 'Shutdown & Exit', click: () => { app.quit(); } }
    ]);
    
    tray.setToolTip('LedgerAI PH Database Server');
    tray.setContextMenu(contextMenu);
    
    tray.on('double-click', () => {
      shell.openExternal(`http://localhost:${port}/`);
    });
  } catch (err: any) {
    log(`Failed to create tray icon: ${err.message}`);
  }
}

async function startBackendAndWindow() {
  try {
    log('Loading compiled server module...');
    const serverModule = require(path.join(__dirname, 'server.cjs'));
    
    log('Starting LedgerAI Server...');
    const { port, server } = await serverModule.startLedgerAIServer(3000);
    serverInstance = server;
    runningPort = port;
    log(`Server listening on port ${port}.`);

    // Create system tray icon for background control
    createTray(port);

    // Register Native IPC Handlers
    registerIpcHandlers();

    // Verify Server Readiness
    log('Verifying local database and server readiness...');
    const ready = await checkServerReady(port);
    if (ready) {
      log('Server verified ready! Opening user interface...');
      createMainWindow(port);
    } else {
      throw new Error('Server health check timed out. Failed to verify database readiness.');
    }
  } catch (error: any) {
    log(`Failed to start backend: ${error.message}`);
    dialog.showErrorBox('Startup Error', `Failed to start the local LedgerAI server.\n\n${error.message}`);
    app.quit();
  }
}

function registerIpcHandlers() {
  ipcMain.handle('dialog:selectFolder', async (_event, options?: { title?: string; defaultPath?: string; buttonLabel?: string }) => {
    try {
      const parentWin = mainWindow || undefined;
      const result = await dialog.showOpenDialog(parentWin as any, {
        title: options?.title || 'Select Company Storage Location',
        defaultPath: options?.defaultPath,
        buttonLabel: options?.buttonLabel || 'Select Folder',
        properties: ['openDirectory', 'createDirectory', 'promptToCreate']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    } catch (err: any) {
      log(`Error in dialog:selectFolder: ${err.message}`);
      return null;
    }
  });

  ipcMain.handle('app:getPaths', async () => {
    const isWin = os.platform() === 'win32';
    const userDocs = isWin && process.env.USERPROFILE 
      ? path.join(process.env.USERPROFILE, 'Documents', 'LedgerAI Companies')
      : path.join(app.getPath('documents'), 'LedgerAI Companies');
    
    return {
      userData: app.getPath('userData'),
      documents: app.getPath('documents'),
      appPath: app.getAppPath(),
      defaultCompaniesRoot: userDocs
    };
  });
}

function createMainWindow(port: number) {
  const preloadPath = path.join(__dirname, 'preload.cjs');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'LedgerAI PH — Enterprise Accounting & Tax ERP',
    webPreferences: {
      preload: fs.existsSync(preloadPath) ? preloadPath : undefined,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  const appUrl = `http://localhost:${port}/`;
  log(`Loading app in BrowserWindow: ${appUrl}`);
  mainWindow.loadURL(appUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}


app.whenReady().then(() => {
  startBackendAndWindow();
});

let isShuttingDown = false;
async function shutdownBackend() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log('Cleaning up background database sessions & shutting down backend server...');
  if (serverInstance) {
    try {
      const serverModule = require(path.join(__dirname, 'server.cjs'));
      if (serverModule.shutdownLedgerAIServer) {
        await serverModule.shutdownLedgerAIServer();
      }
    } catch (e: any) {
      log(`Error during server shutdown: ${e.message}`);
    }
  }
}

app.on('will-quit', async (e) => {
  e.preventDefault();
  await shutdownBackend();
  process.exit(0);
});

app.on('window-all-closed', () => {
  // Overridden to prevent app from closing when hidden window closes
});
