# WINDOWS DESKTOP PACKAGING COMPLIANCE CHECKLIST
This checklist audits progress toward packaging LedgerAI PH into an installable desktop product.

---

## 1. CODEBASE AND RUNTIME READY STATUS

### [✔] Core Server Compilation (VERIFIED)
* **Status**: Complete & Verified.
* **Evidence**: Running `npm run build` compiles `server.ts` to `dist/server.cjs` successfully using `esbuild`.

### [✔] Client Asset Integration (VERIFIED)
* **Status**: Complete & Verified.
* **Evidence**: `vite build` bundles all HTML/CSS/JS files into `/dist` ready to be served statically by the Express backend.

### [✔] Centralized Path Abstractions (VERIFIED)
* **Status**: Complete & Verified.
* **Evidence**: `src/server/services/paths.ts` successfully maps writeable data folders inside the OS-specific `%APPDATA%` Roaming directory when `DESKTOP_MODE=true` is activated.

### [✔] Express Server Standalone Startup (VERIFIED)
* **Status**: Complete & Verified.
* **Evidence**: `server.ts` exports `startLedgerAIServer()` allowing direct programmatic startup, and handles port conflict fallback cleanly.

### [✔] Graceful Database Shutdown (VERIFIED)
* **Status**: Complete & Verified.
* **Evidence**: `shutdownLedgerAIServer()` is exported, clearing active connection pools in `CompanyManager.closeAllConnections()` before terminating the process.

### [✔] API Health Check JSON Contract (VERIFIED)
* **Status**: Complete & Verified.
* **Evidence**: Endpoint `/api/health` returns descriptive, non-sensitive JSON payload (`status`, `application`, `version`, `database`).

### [✔] Client-Side Code Protection (VERIFIED)
* **Status**: Complete & Verified.
* **Evidence**: Server-side secrets (`GEMINI_API_KEY`) are kept out of Vite client environments.

---

## 2. DESKTOP WRAPPER PACKAGING (REQUIRES REAL WINDOWS WORKSTATION)

### [ ] Electron Shell Compilation
* **Status**: PREPARATION COMPLETE.
* **Requirements**: Must execute `npm run build-windows` on a Windows dev machine.
* **Verification Block**: Host OS cannot execute Windows native binaries or rebuild node native dependencies (`better-sqlite3`, `libsql`) inside this browser environment.

### [ ] Native Database Rebuild (`electron-rebuild`)
* **Status**: PREPARATION COMPLETE.
* **Requirements**: Must run `electron-rebuild` to link libsql native database drivers to the Electron node header files.
* **Verification Block**: Requires local C++ compilers (Build Tools for Visual Studio) to run.

### [ ] Single Instance Application Lock
* **Status**: PREPARATION COMPLETE.
* **Requirements**: Managed via `app.requestSingleInstanceLock()` in `packaging/windows/package-config/main.js`.
* **Verification Block**: Requires testing on a physical machine to confirm multiple rapid desktop launches are intercepted.

### [ ] Standalone Executable Packaging (`electron-builder`)
* **Status**: PREPARATION COMPLETE.
* **Requirements**: Compiles files and bundles resource assets into a single package.
* **Verification Block**: Requires Windows operating system to package and sign.

---

## 3. INSTALLATION & SYSTEM COMPLIANCE (REQUIRES REAL WINDOWS WORKSTATION)

### [ ] Inno Setup Installer Generation
* **Status**: PREPARATION COMPLETE.
* **Requirements**: Compiling `/packaging/windows/installer-config/installer-specification.iss` via Inno Setup Compiler (ISCC).
* **Verification Block**: Requires Windows host and Inno Setup installed.

### [ ] Destination Folder Write-Protection Bypass
* **Status**: PREPARATION COMPLETE.
* **Requirements**: Verifies that executable runs in read-only `C:/Program Files/` while databases read/write from writeable `%APPDATA%/LedgerAI/` folders.
* **Verification Block**: Requires a physical Windows machine with restricted user accounts.

### [ ] Clean Installation Test
* **Status**: PREPARATION COMPLETE.
* **Requirements**: Launching the compiled installer on a fresh Windows sandbox.
* **Verification Block**: Cannot execute EXE files in this preview container.

### [ ] Uninstall Integrity and Data Preservation
* **Status**: PREPARATION COMPLETE.
* **Requirements**: Confirms that uninstalling LedgerAI PH deletes executable binaries but preserves database registry and files.
* **Verification Block**: Requires running Windows uninstallation utilities.

### [ ] Upgrade/Version Schema Migrations
* **Status**: PREPARATION COMPLETE.
* **Requirements**: Runs newer software versions over existing databases, triggering `drizzle-orm` migrations successfully without data loss.
* **Verification Block**: Requires testing consecutive installer versions.
