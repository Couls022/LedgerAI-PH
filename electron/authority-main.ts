import { app, BrowserWindow, dialog, shell, Tray, Menu } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const AUTHORITY_PORT = 4000;

// Enforce Desktop Mode for paths
process.env.DESKTOP_MODE = "true";
process.env.NODE_ENV = "production";

// Configure Logging
const appDataPath = app.getPath('userData');
const logDir = path.join(appDataPath, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, 'authority-app.log');

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logFile, line);
  console.log(msg);
}

log('Starting LedgerAI PH Key Generator Browser-First Runtime...');

// Global Process Error Handlers to prevent quiet crashing
process.on('uncaughtException', (err) => {
  log(`[UNCAUGHT_EXCEPTION] ${err?.stack || err?.message || err}`);
});

process.on('unhandledRejection', (reason: any) => {
  log(`[UNHANDLED_REJECTION] ${reason?.stack || reason?.message || reason}`);
});

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  log('Another instance of Key Generator is already running. Focusing browser...');
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  log(`Second instance detected. Re-opening Key Generator URL: http://localhost:${AUTHORITY_PORT}/`);
  shell.openExternal(`http://localhost:${AUTHORITY_PORT}/`);
});

// Helper: Ping authority server health quickly on 127.0.0.1 and localhost
function pingHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tryPing = (host: string, cb: (ok: boolean) => void) => {
      const req = http.get(`http://${host}:${port}/api/health`, { timeout: 1500 }, (res) => {
        if (res.statusCode === 200) {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(body);
              cb(json.application === 'LedgerAI PH Authority');
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

// Helper: Check authority server health repeatedly
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
    path.join(__dirname, 'keygenerator-icon.ico'),
    path.join(app.getAppPath(), 'dist-authority', 'favicon.ico'),
    path.join(app.getAppPath(), 'dist-authority', 'keygenerator-icon.ico'),
    path.join(app.getAppPath(), 'packaging', 'windows', 'assets', 'keygenerator-icon.ico'),
    path.join(app.getAppPath(), 'public', 'favicon.ico')
  ];
  const finalIconPath = iconCandidates.find(p => fs.existsSync(p));

  try {
    if (finalIconPath) {
      tray = new Tray(finalIconPath);
      const contextMenu = Menu.buildFromTemplate([
        { label: 'LedgerAI PH Key Generator — Active', enabled: false },
        { label: `Port: ${port}`, enabled: false },
        { type: 'separator' },
        { label: 'Open Key Generator in Browser', click: () => { shell.openExternal(`http://localhost:${port}/`); } },
        { type: 'separator' },
        { label: 'Shutdown & Exit', click: () => { app.quit(); } }
      ]);
      
      tray.setToolTip('LedgerAI PH License Authority Server');
      tray.setContextMenu(contextMenu);
      
      tray.on('double-click', () => {
        shell.openExternal(`http://localhost:${port}/`);
      });
      log(`Key Generator tray icon created successfully using ${finalIconPath}`);
    } else {
      log('Notice: No key generator tray icon asset found on disk; running background mode without tray icon.');
    }
  } catch (err: any) {
    log(`Failed to create tray icon (non-fatal): ${err.message}`);
  }
}

async function startAuthorityAndWindow() {
  try {
    // 1. First check if Authority server is already running on port 4000
    log('Checking if Authority Server is already active on port 4000...');
    const existingActive = await pingHealth(AUTHORITY_PORT);
    if (existingActive) {
      log('Existing active Authority Server detected on port 4000! Connecting directly to browser...');
      createTray(AUTHORITY_PORT);
      createHiddenWindow();
      shell.openExternal(`http://localhost:${AUTHORITY_PORT}/`);
      return;
    }

    log('Loading compiled authority server module...');
    const serverPath = fs.existsSync(path.join(__dirname, 'authority-server.cjs'))
      ? path.join(__dirname, 'authority-server.cjs')
      : path.join(__dirname, '../dist-authority/authority-server.cjs');
    log(`Loading authority server from ${serverPath}`);
    const authorityModule = require(serverPath);
    
    log('Starting Authority Server...');
    if (authorityModule.startAuthorityServer) {
      await authorityModule.startAuthorityServer();
    }
    log(`Authority server running successfully on port ${AUTHORITY_PORT}.`);

    createTray(AUTHORITY_PORT);
    createHiddenWindow();

    log('Verifying authority server readiness...');
    const ready = await checkServerReady(AUTHORITY_PORT);
    if (ready) {
      log('Authority server verified ready! Automatically opening user\'s default system browser...');
      shell.openExternal(`http://localhost:${AUTHORITY_PORT}/`);
    } else {
      log('Notice: Authority health check poll did not return in 20s, opening browser anyway...');
      shell.openExternal(`http://localhost:${AUTHORITY_PORT}/`);
    }
  } catch (error: any) {
    log(`Failed to start authority server: ${error.message}`);
    const fallbackActive = await pingHealth(AUTHORITY_PORT);
    if (fallbackActive) {
      log('Fallback: Authority Server responded after contention. Opening browser...');
      createTray(AUTHORITY_PORT);
      createHiddenWindow();
      shell.openExternal(`http://localhost:${AUTHORITY_PORT}/`);
      return;
    }

    dialog.showErrorBox('Authority Startup Error', `Failed to start local Authority Key Generator server.\n\n${error.message}`);
    app.quit();
  }
}

function createHiddenWindow() {
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

app.whenReady().then(() => {
  startAuthorityAndWindow();
});

let isShuttingDown = false;
async function shutdownAuthority() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log('Shutting down background authority server...');
}

app.on('will-quit', async (e) => {
  e.preventDefault();
  await shutdownAuthority();
  process.exit(0);
});

app.on('window-all-closed', () => {
  // Overridden to keep background service running via tray
});
