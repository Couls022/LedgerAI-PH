import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from "http";
import path from "path";
import fs from "fs";
import authorityRoutes from "./routes";
import { initWebSocketServer } from "../../src/server/ws";
import { CompanyManager } from "../../src/server/services/companyManager";

// Mark process as Authority Server so it never acquires or conflicts with ERP database locks
process.env.LEDGERAI_AUTHORITY_SERVER = 'true';
process.env.LEDGERAI_DISABLE_INSTANCE_LOCK = 'true';

async function startAuthorityServer() {
  const app = express();
  const PORT = process.env.AUTHORITY_PORT ? parseInt(process.env.AUTHORITY_PORT) : 4000;

  app.use(cors({
    origin: true,
    credentials: true,
  }));
  app.use(express.json());
  app.use(cookieParser());

  // Initialize company manager
  await CompanyManager.init().catch(err => console.error("Authority server CompanyManager init error:", err));

  // Mount isolated authority routes (both /api/* and root /* for standalone heartbeat compatibility)
  app.use("/api", authorityRoutes);
  app.use("/", authorityRoutes);

  // Serve static authority UI in production/standalone mode
  let authorityDist = path.join(process.cwd(), 'dist-authority');
  if (fs.existsSync(path.join(__dirname, 'internal/authority-ui/authority.html')) || fs.existsSync(path.join(__dirname, 'index.html'))) {
    authorityDist = __dirname;
  } else if (fs.existsSync(path.join(__dirname, '..', 'dist-authority'))) {
    authorityDist = path.join(__dirname, '..', 'dist-authority');
  }

  console.log(`[Authority Server] Serving static authority UI from: ${authorityDist}`);
  if (fs.existsSync(authorityDist)) {
    app.use(
      express.static(authorityDist, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.use('/assets', express.static(path.join(authorityDist, 'assets')));

    app.get('*all', (req, res) => {
      // Prevent returning HTML for missing assets or files with extensions
      if (req.path.startsWith('/assets/') || path.extname(req.path)) {
        return res.status(404).type('text/plain').send(`Asset not found: ${req.path}`);
      }

      const htmlPath = path.join(authorityDist, 'internal/authority-ui/authority.html');
      const indexPath = path.join(authorityDist, 'index.html');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
      } else if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(500).send(`LedgerAI PH Authority Error: UI HTML not found at ${authorityDist}`);
      }
    });
  }

  const server = http.createServer(app);
  initWebSocketServer(server);

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`====================================================`);
    console.log(`LEDGERAI PH INTERNAL LICENSE AUTHORITY SERVER`);
    console.log(`Listening on http://127.0.0.1:${PORT}`);
    console.log(`CONFIDENTIAL: DO NOT DISTRIBUTE OR BUNDLE WITH CLIENT`);
    console.log(`====================================================`);
  });
}

if (require.main === module) {
  startAuthorityServer();
}

export { startAuthorityServer };
