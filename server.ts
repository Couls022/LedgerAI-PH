import path from "path";
import fs from "fs";
import http from "http";
import { fileURLToPath } from "url";

// Default NODE_ENV to production if running the compiled bundle or source is missing
if (!process.env.NODE_ENV) {
  const isCompiled = typeof __dirname !== 'undefined' && (__dirname.includes('dist') || __dirname.includes('asar'));
  const root = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  const srcExists = fs.existsSync(path.resolve(root, 'src/server/app.ts')) || fs.existsSync(path.resolve(root, '../src/server/app.ts'));
  if (isCompiled || !srcExists) {
    process.env.NODE_ENV = 'production';
  }
}

const _dirname = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

import express from "express";
import { createApp } from "./src/server/app";
import { initWebSocketServer } from "./src/server/ws";
import { CompanyManager } from "./src/server/services/companyManager";
import { AntiRollbackService } from "./src/server/services/antiRollbackService";
import { AutomatedBackupScheduler } from "./src/server/services/automatedBackupScheduler";
import { ArchiveRetentionScheduler } from "./src/server/services/archiveRetentionService";
import { ServerInstanceLock } from "./src/server/services/serverInstanceLock";
export { ServerInstanceLock };
import { ServerTelemetryService } from "./src/server/services/serverTelemetryService";
import { CompanyLauncherGenerator } from "./src/server/services/companyLauncherGenerator";

let activeHttpServer: http.Server | null = null;
let isShuttingDown = false;

export async function startLedgerAIServer(preferredPort?: number): Promise<{ port: number; server: http.Server }> {
  const desiredPort = preferredPort || Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "0.0.0.0";

  // Enforce single server instance per storage directory (prevents Topology C multi-process SQLite corruption)
  const skipInstanceLock =
    process.env.LEDGERAI_DISABLE_INSTANCE_LOCK === 'true' ||
    process.env.NODE_ENV === 'test' ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.NODE_TEST_CONTEXT);

  if (!skipInstanceLock) {
    await ServerInstanceLock.checkAndCleanStaleLock();
    const lockResult = ServerInstanceLock.acquire({
      port: desiredPort,
      deploymentMode: ServerTelemetryService.getDeploymentMode(),
    });
    if (!lockResult.acquired) {
      console.error(`[LedgerAI Server] SINGLE-INSTANCE LOCK BLOCKED: ${lockResult.reason}`);
      throw new Error(lockResult.reason || "Another LedgerAI PH server instance is already running.");
    }
  }
  
  const app = createApp();
  const httpServer = http.createServer(app);
  activeHttpServer = httpServer;

  // Initialize WebSocket real-time server
  initWebSocketServer(httpServer);

  // Vite middleware for development (dynamically imported so vite is never required in production)
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, server.cjs is built into dist/, or executed from project root
    let distPath = path.resolve(process.cwd(), "dist");
    
    // In packaged Electron apps (__dirname inside dist/server.cjs is .../app.asar/dist or .../dist)
    if (fs.existsSync(path.join(__dirname, "index.html"))) {
      distPath = __dirname;
    } else if (fs.existsSync(path.join(__dirname, "..", "dist", "index.html"))) {
      distPath = path.join(__dirname, "..", "dist");
    }

    console.log(`[LedgerAI Production Server] Serving static frontend from: ${distPath}`);

    // Dedicated handler for /sw.js to prevent caching of the unregister script
    app.get(["/sw.js", "/service-worker.js"], (_req, res) => {
      const swPath = path.join(distPath, "sw.js");
      if (fs.existsSync(swPath)) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Content-Type", "application/javascript");
        res.sendFile(swPath);
      } else {
        res.status(404).send("// Service worker uninstalled");
      }
    });

    // Serve static files with proper cache headers: no-cache for index.html, immutable cache for hashed assets
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            res.setHeader("Pragma", "no-cache");
            res.setHeader("Expires", "0");
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          }
        },
      })
    );

    // Helper to find latest asset fallback if client browser cached an older hash
    const findLatestAsset = (ext: string, prefix: string = 'index-'): string | null => {
      try {
        const assetsDir = path.join(distPath, 'assets');
        if (!fs.existsSync(assetsDir)) return null;
        const files = fs.readdirSync(assetsDir);
        const match = files.find(f => f.startsWith(prefix) && f.endsWith(ext)) || files.find(f => f.endsWith(ext));
        return match ? path.join(assetsDir, match) : null;
      } catch {
        return null;
      }
    };

    // Single-Page Application (SPA) fallback
    app.get("*all", (req, res) => {
      // If client browser requested an older hashed CSS/JS from cache, seamlessly serve active bundle
      if (req.path.startsWith("/assets/")) {
        if (req.path.endsWith(".css")) {
          const fallbackCss = findLatestAsset(".css");
          if (fallbackCss && fs.existsSync(fallbackCss)) {
            res.setHeader("Content-Type", "text/css; charset=UTF-8");
            res.setHeader("Cache-Control", "no-cache");
            try {
              const cssBuffer = fs.readFileSync(fallbackCss);
              return res.send(cssBuffer);
            } catch {
              return res.sendFile(fallbackCss);
            }
          }
        } else if (req.path.endsWith(".js")) {
          const fallbackJs = findLatestAsset(".js");
          if (fallbackJs && fs.existsSync(fallbackJs)) {
            res.setHeader("Content-Type", "application/javascript; charset=UTF-8");
            res.setHeader("Cache-Control", "no-cache");
            try {
              const jsBuffer = fs.readFileSync(fallbackJs);
              return res.send(jsBuffer);
            } catch {
              return res.sendFile(fallbackJs);
            }
          }
        }
        return res.status(404).type("text/plain").send(`Asset not found: ${req.path}`);
      }

      if (path.extname(req.path)) {
        return res.status(404).type("text/plain").send(`File not found: ${req.path}`);
      }

      const indexPath = path.join(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.sendFile(indexPath);
      } else {
        res.status(500).send(`LedgerAI PH Production Error: index.html not found at ${indexPath}`);
      }
    });
  }

  return new Promise((resolve, reject) => {
    httpServer.listen(desiredPort, host, () => {
      const addr = httpServer.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : desiredPort;
      ServerTelemetryService.setListeningInfo(actualPort, host);
      console.log(`[LedgerAI Server] Running on http://${host}:${actualPort} (mode: ${ServerTelemetryService.getDeploymentMode()})`);

      // Ensure portable company folders contain native Windows launcher executable (<CompanyName>.exe)
      CompanyLauncherGenerator.syncLaunchersForKnownCompanies().catch((err) => {
        console.warn("[LedgerAI Server] Background company launcher sync warning:", err);
      });

      resolve({ port: actualPort, server: httpServer });
    }).on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`[LedgerAI Server] Port ${desiredPort} is in use, attempting automatic fallback to dynamic available port...`);
        const fallbackServer = http.createServer(app);
        activeHttpServer = fallbackServer;
        initWebSocketServer(fallbackServer);
        fallbackServer.listen(0, host, () => {
          const addr = fallbackServer.address();
          const actualPort = typeof addr === "object" && addr ? addr.port : 0;
          ServerTelemetryService.setListeningInfo(actualPort, host);
          console.log(`[LedgerAI Server] Running on http://${host}:${actualPort} (dynamic fallback)`);

          CompanyLauncherGenerator.syncLaunchersForKnownCompanies().catch((err) => {
            console.warn("[LedgerAI Server] Background company launcher sync warning:", err);
          });

          resolve({ port: actualPort, server: fallbackServer });
        });
      } else {
        ServerInstanceLock.release();
        console.error(`[LedgerAI Server] Error starting server on port ${desiredPort}:`, err);
        reject(err);
      }
    });
  });
}

export async function shutdownLedgerAIServer(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("[LedgerAI Server] Shutting down server cleanly...");
  
  if (activeHttpServer) {
    await new Promise<void>((resolve) => {
      activeHttpServer!.close(() => {
        console.log("[LedgerAI Server] HTTP server closed.");
        resolve();
      });
    });
    activeHttpServer = null;
  }

  AutomatedBackupScheduler.stopScheduler();
  ArchiveRetentionScheduler.stopScheduler();
  AntiRollbackService.stopBackgroundHeartbeat();
  await CompanyManager.closeAllConnections();
  ServerInstanceLock.release();
  isShuttingDown = false;
  console.log("[LedgerAI Server] Cleanup completed.");
}

// Graceful OS termination handlers for Windows Service / systemd / container lifecycle
const handleGracefulSignal = (signal: string) => {
  console.log(`[LedgerAI Server] Received ${signal}. Initiating graceful shutdown...`);
  shutdownLedgerAIServer()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[LedgerAI Server] Error during graceful shutdown:", err);
      process.exit(1);
    });
};

if (!process.env.VITEST && !process.env.NODE_TEST_CONTEXT) {
  process.once("SIGTERM", () => handleGracefulSignal("SIGTERM"));
  process.once("SIGINT", () => handleGracefulSignal("SIGINT"));
}

// Automatically boot server on direct CLI execution, but NOT when imported as a desktop module
const isDirectCliExecution =
  process.env.DESKTOP_MODE !== 'true' &&
  !process.env.VITEST &&
  !process.env.NODE_TEST_CONTEXT &&
  (
    (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) ||
    Boolean(process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.cjs')))
  );

if (isDirectCliExecution) {
  startLedgerAIServer().catch((err) => {
    console.error("[LedgerAI Server] Failed to auto-start server:", err);
    process.exit(1);
  });
}

export { paths } from './src/server/services/paths';
