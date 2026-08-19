/**
 * LedgerAI PH — Desktop Wrapper Main Shell Process (Electron-based)
 * Resolves local resources, manages background services, and restricts app instances.
 */
const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const http = require("http");

// Configure desktop runtime environment variables
process.env.DESKTOP_MODE = "true";
process.env.NODE_ENV = "production";

let mainWindow = null;
let backendPort = null;

// Enforce Single-Instance Application Locks
const instanceLock = app.requestSingleInstanceLock();

if (!instanceLock) {
  // Another instance is already running; terminate this instance silently.
  app.quit();
  process.exit(0);
} else {
  // Listen for duplicate launches; restore and focus the primary container
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "LedgerAI PH",
        message: "An active instance of LedgerAI PH is already running on this machine.",
        buttons: ["OK"]
      });
    }
  });
}

/**
 * Boots the Express Server internally using our packaged server bundle.
 */
async function startAppBackend() {
  try {
    // Import the compiled CommonJS server bundle dynamically
    const serverModulePath = path.join(__dirname, "dist", "server.cjs");
    const { startLedgerAIServer } = require(serverModulePath);
    
    // Launch server dynamically, falling back to a free port if 3000 is occupied
    const { port } = await startLedgerAIServer(0); // 0 lets OS assign any free port
    backendPort = port;
    console.log(`[Desktop Shell] Internal Express Backend started on port ${backendPort}`);
    return `http://localhost:${backendPort}`;
  } catch (err) {
    console.error("[Desktop Shell] Failed to launch internal server module:", err);
    dialog.showErrorBox(
      "Backend Startup Failure",
      `The LedgerAI PH local database server failed to initialize.\n\nError details:\n${err.message}`
    );
    app.quit();
    process.exit(1);
  }
}

/**
 * Creates the primary UI window container
 */
async function createMainWindow(serverUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "LedgerAI PH — Enterprise Accounting & Audit Suite",
    icon: path.join(__dirname, "assets", "app-icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Ensure menu bars are hidden on clean production views unless toggled
  mainWindow.removeMenu();

  // Load local loopback Express application
  mainWindow.loadURL(serverUrl);

  // Monitor Window crashes or terminations
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("render-process-gone", (event, details) => {
    console.error(`[Desktop Shell] Render process crash detected: ${details.reason}`);
    dialog.showMessageBox({
      type: "warning",
      title: "Performance Warning",
      message: "The user interface encountered an unexpected crash. Reloading workspace...",
      buttons: ["Reload App", "Exit"]
    }).then((res) => {
      if (res.response === 0) {
        mainWindow.loadURL(`http://localhost:${backendPort}`);
      } else {
        app.quit();
      }
    });
  });
}

// Electron lifecycle management
app.on("ready", async () => {
  const localServerUrl = await startAppBackend();
  createMainWindow(localServerUrl);
});

app.on("window-all-closed", () => {
  // On Windows/Linux systems, closing all windows terminates the application
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Trigger safe backend shutdowns on exit signals
app.on("will-quit", async (event) => {
  event.preventDefault();
  try {
    const serverModulePath = path.join(__dirname, "dist", "server.cjs");
    const { shutdownLedgerAIServer } = require(serverModulePath);
    await shutdownLedgerAIServer();
  } catch (err) {
    console.error("Error during graceful shutdown cleanup:", err);
  } finally {
    process.exit(0);
  }
});
