# LEDGERAI PH — PRODUCTION EXPORT MANIFEST

**Application**: LedgerAI PH  
**Version**: `1.0.0-rc.1`  
**Date**: August 2026  
**Export File Target**: `ledgerai-ph-v1.0.0-rc.1-source.tar.gz`

---

## 1. Production Source Package Inclusions

The production source package is structured for clean distribution and includes:

```
ledgerai-ph/
├── electron/                  # Desktop Electron host (main process & preload)
├── packaging/windows/         # Windows setup, icons, and PowerShell build scripts
├── src/
│   ├── client/                # React 19 Frontend SPA (Pages, Components, Contexts)
│   ├── server/                # Express 5 Backend (APIs, Drizzle ORM, Tax & Accounting Engines)
│   │   ├── db/schema.ts       # 97 Relational Database Tables
│   │   ├── licensing/crypto.ts # RSA-2048 Public Key Verification
│   │   └── services/          # Accounting, Tax, OCR, Backup, and AI services
│   └── shared/                # Shared TypeScript types and constants
├── tools/key-generator/       # Standalone Offline License Authority App
├── docs/                      # Technical Documentation, Matrices & Reports
├── .env.example               # Sanitized Environment Configuration Template
├── package.json               # Package Manifest & Script Configurations
├── package-lock.json          # Deterministic Dependency Lockfile
├── tsconfig.json              # TypeScript Strict Compiler Settings
└── vite.config.ts             # Vite Build & Asset Pipeline
```

---

## 2. Excluded Non-Production Artifacts

The following files and folders are strictly excluded from the production release export:

- Real customer, vendor, or financial company databases (`*.db`, `*.sqlite`, `*.sqlite3`).
- Private RSA license signing keys (`tools/key-generator/keys.json` or `.env` with `LICENSE_PRIVATE_KEY`).
- Secret API keys (e.g. `GEMINI_API_KEY`, `JWT_SECRET`).
- `node_modules/` and package caches (must be installed via `npm ci`).
- Generated test outputs, logs, and coverage reports.
- Temporary files and browser local storage dumps.

---

## 3. Standard Production Build and Start Instructions

### Web / Multi-User LAN Server:
```bash
# 1. Install dependencies
npm ci

# 2. Compile full-stack bundle
npm run build

# 3. Start server
npm start
# Runs: node dist/server.cjs (Binds to http://0.0.0.0:3000)
```

### Windows Desktop Packaging (Native Windows Host):
```powershell
# In PowerShell (Run as Administrator):
Set-ExecutionPolicy Bypass -Scope Process
./packaging/windows/build-windows.ps1
```
*Outputs: `dist/installer/LedgerAI-PH-Setup-1.0.0.exe`*
