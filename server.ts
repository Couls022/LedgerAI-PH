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

let activeHttpServer: http.Server | null = null;

export async function startLedgerAIServer(preferredPort?: number): Promise<{ port: number; server: http.Server }> {
  const desiredPort = 3000;
  const host = process.env.HOST || "0.0.0.0";
  
  const app = createApp();
  const httpServer = http.createServer(app);
  activeHttpServer = httpServer;

  // Initialize WebSocket real-time server
  initWebSocketServer(httpServer);

  // Vite middleware for development (dynamically imported so vite is never required in production)
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
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
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
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
      console.log(`[LedgerAI Server] Running on http://${host}:${actualPort}`);
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
          console.log(`[LedgerAI Server] Running on http://${host}:${actualPort} (dynamic fallback)`);
          resolve({ port: actualPort, server: fallbackServer });
        });
      } else {
        console.error(`[LedgerAI Server] Error starting server on port ${desiredPort}:`, err);
        reject(err);
      }
    });
  });
}

export async function shutdownLedgerAIServer(): Promise<void> {
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

  AntiRollbackService.stopBackgroundHeartbeat();
  await CompanyManager.closeAllConnections();
  console.log("[LedgerAI Server] Cleanup completed.");
}

// Automatically boot server on direct execution
startLedgerAIServer().catch((err) => {
  console.error("[LedgerAI Server] Failed to auto-start server:", err);
  process.exit(1);
});

export { paths } from './src/server/services/paths';
