import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { createNativeDialogController } from './nativeFolderPickerIpc';
import type { SelectDirectoryOptions, SelectFileOptions } from '../src/shared/folderPickerTypes';

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

// Global Process Error Handlers to prevent quiet crashing
process.on('uncaughtException', (err) => {
  log(`[UNCAUGHT_EXCEPTION] ${err?.stack || err?.message || err}`);
});

process.on('unhandledRejection', (reason: any) => {
  log(`[UNHANDLED_REJECTION] ${reason?.stack || reason?.message || reason}`);
});

app.on('second-instance', () => {
  log(`Second instance detected. Re-opening browser URL: http://localhost:${runningPort}/#/client`);
  shell.openExternal(`http://localhost:${runningPort}/#/client`);
});

// Helper: Ping server health quickly on 127.0.0.1 and localhost
function pingHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tryPing = (host: string, cb: (ok: boolean) => void) => {
      const req = http.get(`http://${host}:${port}/api/health`, { timeout: 2000 }, (res) => {
        if (res.statusCode === 200) {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              cb(data.application === 'LedgerAI PH');
            } catch {
              cb(false);
            }
          });
        } else {
          cb(false);
        }
      });
      req.on('error', () => cb(false));
      req.on('timeout', () => {
        req.destroy();
        cb(false);
      });
      req.end();
    };

    tryPing('127.0.0.1', (ok) => {
      if (ok) return resolve(true);
      tryPing('localhost', resolve);
    });
  });
}

// Helper: Check server health repeatedly until ready or timeout
function checkServerReady(port: number, timeoutMs: number = 20000): Promise<boolean> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        resolve(false);
        return;
      }

      const isReady = await pingHealth(port);
      if (isReady) {
        clearInterval(interval);
        resolve(true);
      }
    }, 250);
  });
}

function createTray(port: number) {
  const iconCandidates = [
    path.join(__dirname, 'favicon.ico'),
    path.join(__dirname, 'app-icon.ico'),
    path.join(app.getAppPath(), 'dist', 'favicon.ico'),
    path.join(app.getAppPath(), 'dist', 'app-icon.ico'),
    path.join(app.getAppPath(), 'packaging', 'windows', 'assets', 'app-icon.ico'),
    path.join(app.getAppPath(), 'public', 'favicon.ico')
  ];
  const finalIconPath = iconCandidates.find(p => fs.existsSync(p));

  try {
    if (finalIconPath) {
      tray = new Tray(finalIconPath);
      const contextMenu = Menu.buildFromTemplate([
        { label: 'LedgerAI PH — Active', enabled: false },
        { label: `Local Server Port: ${port}`, enabled: false },
        { type: 'separator' },
        { label: 'Open App in Browser', click: () => { shell.openExternal(`http://localhost:${port}/#/client`); } },
        { type: 'separator' },
        { label: 'Shutdown & Exit', click: () => { app.quit(); } }
      ]);
      
      tray.setToolTip('LedgerAI PH Database Server');
      tray.setContextMenu(contextMenu);
      
      tray.on('double-click', () => {
        shell.openExternal(`http://localhost:${port}/#/client`);
      });
      log(`Tray icon created successfully using ${finalIconPath}`);
    } else {
      log('Notice: No tray icon asset found on disk; running background mode without tray icon.');
    }
  } catch (err: any) {
    log(`Failed to create tray icon (non-fatal): ${err.message}`);
  }
}

function createHiddenWindow() {
  if (mainWindow) return;
  mainWindow = new BrowserWindow({
    show: false, // Keep hidden in background
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startBackendAndWindow() {
  try {
    // 1. First verify if an existing LedgerAI server instance is already running on port 3000
    log('Checking if a LedgerAI server is already active on port 3000...');
    const existingActive = await pingHealth(3000);
    if (existingActive) {
      log('Existing active LedgerAI server detected on port 3000! Connecting directly to browser...');
      runningPort = 3000;
      createTray(3000);
      createHiddenWindow();
      registerIpcHandlers();
      log(`Direct browser launch: opening default web browser to http://localhost:3000/#/client`);
      shell.openExternal(`http://localhost:3000/#/client`);
      return;
    }

    // 2. No existing active server on 3000: clean stale/recycled PID locks before starting
    log('Loading compiled server module...');
    const serverModule = require(path.join(__dirname, 'server.cjs'));

    if (serverModule.ServerInstanceLock?.checkAndCleanStaleLock) {
      const staleCheck = await serverModule.ServerInstanceLock.checkAndCleanStaleLock();
      if (staleCheck?.activeServer?.port) {
        const activePort = staleCheck.activeServer.port;
        log(`Detected active LedgerAI server via lock on port ${activePort}. Connecting directly to browser...`);
        runningPort = activePort;
        createTray(activePort);
        createHiddenWindow();
        registerIpcHandlers();
        shell.openExternal(`http://localhost:${activePort}/#/client`);
        return;
      }
    }
    
    log('Starting LedgerAI Server on port 3000...');
    const { port, server } = await serverModule.startLedgerAIServer(3000);
    serverInstance = server;
    runningPort = port;
    log(`Server listening on port ${port}.`);

    // Create system tray icon and background keepalive
    createTray(port);
    createHiddenWindow();

    // Register Native IPC Handlers
    registerIpcHandlers();

    // Verify Server Readiness
    log('Verifying local database and server readiness...');
    const ready = await checkServerReady(port);
    if (ready) {
      log(`Server verified ready! Direct browser launch: opening default web browser to http://localhost:${port}/#/client`);
      shell.openExternal(`http://localhost:${port}/#/client`);
    } else {
      // Non-fatal: launch browser anyway even if poll didn't complete inside window
      log(`Health check poll did not return in 20s, attempting browser launch on port ${port} anyway...`);
      shell.openExternal(`http://localhost:${port}/#/client`);
    }
  } catch (error: any) {
    log(`Notice during backend start: ${error?.message || error}`);

    // Detect if another LedgerAI server is already active or managing the database directory
    const errorMsg = String(error?.message || '');
    const isInstanceAlreadyRunning =
      errorMsg.includes('already managing storage directory') ||
      errorMsg.includes('another LedgerAI PH server instance') ||
      errorMsg.includes('SINGLE-INSTANCE LOCK BLOCKED') ||
      errorMsg.includes('EADDRINUSE');

    if (isInstanceAlreadyRunning) {
      // Extract target port from message (e.g. "on port 3000") or default to 3000
      let targetPort = 3000;
      const portMatch = errorMsg.match(/on port (\d+)/i);
      if (portMatch && portMatch[1]) {
        targetPort = parseInt(portMatch[1], 10);
      }

      log(`Another LedgerAI instance is active on port ${targetPort}. Checking readiness and launching browser directly...`);
      const ready = await checkServerReady(targetPort, 8000);
      log(`Existing server readiness check: ${ready ? 'ONLINE' : 'UNVERIFIED (proceeding with launch)'}`);

      runningPort = targetPort;
      createTray(targetPort);
      createHiddenWindow();
      registerIpcHandlers();
      log(`Smart Launch: Connecting client directly to existing server at http://localhost:${targetPort}/#/client`);
      shell.openExternal(`http://localhost:${targetPort}/#/client`);
      return;
    }

    // Secondary fallback: check if server on port 3000 is answering health before declaring failure
    log('Checking if port 3000 answers health as fallback before reporting error...');
    const fallbackActive = await checkServerReady(3000, 4000);
    if (fallbackActive) {
      log('Fallback: existing server responded on port 3000. Opening browser...');
      runningPort = 3000;
      createTray(3000);
      createHiddenWindow();
      registerIpcHandlers();
      shell.openExternal('http://localhost:3000/#/client');
      return;
    }

    dialog.showErrorBox('Startup Error', `Failed to start the local LedgerAI server.\n\n${error.message}`);
    app.quit();
  }
}

const nativeDialogController = createNativeDialogController({
  dialog,
  getMainWindow: () => mainWindow,
  platform: process.platform,
  log,
});

function registerIpcHandlers() {
  // Primary structured native OS directory picker (Renderer -> Preload -> IPC -> Main -> dialog.showOpenDialog)
  ipcMain.handle('dialog:selectDirectory', async (_event, options?: SelectDirectoryOptions) => {
    return nativeDialogController.selectDirectory(options);
  });

  // Narrowly scoped native OS file picker for encrypted .lai/.lgb/.sqlite archives & supported files
  ipcMain.handle('dialog:selectFile', async (_event, options?: SelectFileOptions) => {
    return nativeDialogController.selectFile(options);
  });

  // Backward-compatible legacy channel delegating to the same centralized controller
  ipcMain.handle('dialog:selectFolder', async (_event, options?: SelectDirectoryOptions) => {
    const res = await nativeDialogController.selectDirectory(options);
    return res.status === 'SELECTED' && res.path ? res.path : null;
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
