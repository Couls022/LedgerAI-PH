# LedgerAI PH — Client-Server Architecture Audit

**Document Status:** Authoritative Baseline (November 2026)  
**Scope:** Centralized Multi-Company On-Premises Client-Server Architecture  
**Execution Environment Note:** Automated server/API/frontend tests are executed in Linux Node.js + headless Chromium inside AI Studio. Native Windows Service registration, mDNS/Windows Firewall execution, native Windows Explorer dialog runtime, and NSIS/EXE installer builds are explicitly classified as `BLOCKED BY EXECUTION ENVIRONMENT` until executed on a native Windows host/CI.

---

## 1. Architecture Summary

LedgerAI PH operates under a single-central-server, browser-based LAN client architecture while remaining 100% backward-compatible with Single-PC Standalone installations:

- **Central Server (PC 1):** Runs one authoritative Node.js + Express + Drizzle + SQLite/SQLCipher server process (`server.ts`, `src/server/app.ts`) protected by an atomic single-instance process lock (`src/server/services/serverInstanceLock.ts`).
- **Browser-Based LAN Clients (PC 2 .. PC N):** Access the central server via Chrome/Edge/Firefox at `http://ledgerai.local` (or `http://ledgerai-server.local` / direct LAN IP fallback). Client machines require zero local database installation and receive zero physical server filesystem paths.
- **Standalone / Single-PC Mode:** Preserved intact (`LEDGERAI_DEPLOYMENT_MODE=SINGLE_PC`, loopback `127.0.0.1`). Local Create Company, Open Existing Profile, Native Folder Picker, and Backup Restore flows continue working without regression.

## 2. Core Implementation Inventory

| Component | Source File(s) | Status |
| :--- | :--- | :--- |
| Central HTTP/WS Server & Graceful Shutdown | `server.ts`, `src/server/app.ts`, `src/server/ws.ts` | IMPLEMENTED AND VERIFIED |
| Single-Instance Server Lock (Topology C Guard) | `src/server/services/serverInstanceLock.ts` | IMPLEMENTED AND VERIFIED |
| Multi-Company DB Pool & Write Serialization | `src/server/services/companyManager.ts`, `src/server/middleware/companyContext.ts` | IMPLEMENTED AND VERIFIED |
| Server Telemetry & Health Dashboard API | `src/server/services/serverTelemetryService.ts`, `src/server/routes/licensingAndLan.ts` | IMPLEMENTED AND VERIFIED |
| Path Privacy Sanitization for Browser Clients | `src/server/services/companyLifecycleService.ts`, `src/server/routes/companies.ts` | IMPLEMENTED AND VERIFIED |
| Per-Browser-Profile Company Preferences | `src/client/services/companyPreferenceService.ts` | IMPLEMENTED AND VERIFIED |
| Session-Scoped Token Storage (Zero `localStorage` Tokens) | `src/client/utils/apiClient.ts`, `src/client/context/AuthContext.tsx` | IMPLEMENTED AND VERIFIED |
| Global Central Server Outage Resilience Banner | `src/client/components/ServerConnectionBanner.tsx`, `src/ClientApp.tsx` | IMPLEMENTED AND VERIFIED |
| Server Management Dashboard UI | `src/client/components/lan/LanServerDashboard.tsx` | IMPLEMENTED AND VERIFIED |
| Windows Background Service & Firewall Scripts | `packaging/windows/service-config/install-ledgerai-service.ps1` | IMPLEMENTED BUT NOT RUNTIME VERIFIED (Windows Host Required) |

## 3. Non-Negotiable Constraints Verification

1. **Standalone Mode Preserved:** Localhost requests (`127.0.0.1` / `::1`) retain full local folder picker, local storage environment diagnostics, and local workspace lifecycle controls.
2. **Zero SQLite File Sharing Over LAN:** All database reads/writes execute strictly through authenticated REST APIs on the central server. SMB/UNC network database paths are explicitly rejected.
3. **No Global Selected Company:** Selected company preference is strictly scoped to each client browser profile (`CompanyPreferenceService`) and each authenticated user session (`sessions` table + `httpOnly` cookie / `sessionStorage` bearer token).
