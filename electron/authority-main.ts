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

// Helper: Check authority server health
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
              if (json.application === 'LedgerAI PH Authority') {
                clearInterval(interval);
                resolve(true);
              }
            } catch (e) {}
          });
        }
      });

      req.on('error', () => {});
      req.end();
    }, 500);
  });
}

function createTray(port: number) {
  let finalIconPath = path.join(__dirname, 'favicon.ico');
  if (!fs.existsSync(finalIconPath)) {
    finalIconPath = path.join(app.getAppPath(), 'dist-authority', 'favicon.ico');
  }
  if (!fs.existsSync(finalIconPath)) {
    finalIconPath = path.join(app.getAppPath(), 'public', 'favicon.ico');
  }

  try {
    tray = new Tray(fs.existsSync(finalIconPath) ? finalIconPath : path.join(__dirname, 'favicon.ico'));
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
  } catch (err: any) {
    log(`Failed to create tray icon: ${err.message}`);
  }
}

async function startAuthorityAndWindow() {
  try {
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

    log('Verifying authority server readiness...');
    const ready = await checkServerReady(AUTHORITY_PORT);
    if (ready) {
      log('Authority server verified ready! Automatically opening user\'s default system browser...');
      shell.openExternal(`http://localhost:${AUTHORITY_PORT}/`);
    } else {
      throw new Error('Authority server health check timed out.');
    }

    createHiddenWindow();
  } catch (error: any) {
    log(`Failed to start authority server: ${error.message}`);
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
