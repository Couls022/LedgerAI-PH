# LEDGERAI PH — WINDOWS RELEASE EXECUTION & DEPLOYMENT PACKAGE

**Document Authority**: Canonical Windows Desktop Release Package  
**Application**: LedgerAI PH Enterprise Accounting, Payroll & Statutory Compliance Platform  
**Target Platform**: Windows 10 / Windows 11 (x64)  
**Release Baseline**: `v1.0.0-rc.1` (Build Stack: React 19 + Vite 6.4 + Express 5 + Drizzle ORM + SQLite `better-sqlite3` + Electron 43.4)  
**Status**: **`PENDING LOCAL WINDOWS / WINDOWS CI EXECUTION`**

---

## 1. Required Environment & Prerequisites

To successfully build and package LedgerAI PH as a standalone Windows desktop `.exe` installer (`LedgerAI-PH-Setup-1.0.0-rc.1.exe`), the build machine (local Windows workstation or Windows CI runner such as GitHub Actions `windows-latest`) must have:
1. **Operating System**: Windows 10 or Windows 11 (x64).
2. **Node.js**: Node.js v22 LTS (exact or compatible with native module compilation).
3. **Build Tools**: Microsoft Visual C++ Build Tools (MSVC v143 or newer) and Windows 10/11 SDK.
4. **Git**: Git for Windows (optional, for repo checkout).

---

## 2. Exact Build & Packaging Commands

Execute the following sequence in Windows PowerShell or Command Prompt:

```powershell
# 1. Install project dependencies
npm install

# 2. Rebuild native better-sqlite3 module for Electron ABI
npx @electron/rebuild -f -w better-sqlite3

# 3. Compile frontend and backend bundles (Vite + esbuild + migrations copy)
npm run build

# 4. Generate standalone Windows NSIS installer
npx electron-builder --win nsis --x64 --config electron-builder.json
```

**Expected Output Directory**: `dist-installer/` containing:
- `LedgerAI-PH-Setup-1.0.0-rc.1.exe` (Standalone Windows installer)
- `win-unpacked/` (Unpacked executable directory for portable/debugging test)

---

## 3. Packaging Configuration & Directory Structure

- **Electron Config**: `electron-builder.json`
- **Main Entry**: `dist/main.cjs`
- **Preload Script**: `dist/preload.cjs`
- **Server Bundle**: `dist/server.cjs`
- **Database Migrations**: `dist/migrations/`

### Windows Runtime Data Persistence & Directory Structure:
- **Application Binaries**: `%LOCALAPPDATA%\Programs\ledgerai-ph\`
- **User Data & System Logs**: `%APPDATA%\LedgerAI-PH\` (`logs/app.log`)
- **Default Company Storage**: `%USERPROFILE%\Documents\LedgerAI Companies\<companyId>\`
  - `.db_active.sqlite` (Active WAL SQLite database)
  - `database.lai` (Encrypted `.lai` database snapshot)
  - `documents/` (Attached receipts, invoices, and OCR files)
  - `backups/` (Encrypted database backups)
  - `quarantine/` (Isolated recovery quarantine directories)

---

## 4. Installation & Upgrade Procedure

1. **Clean Installation**:
   - Run `LedgerAI-PH-Setup-1.0.0-rc.1.exe`.
   - Choose installation scope (All users or Current user).
   - Complete setup wizard (shortcuts created on Desktop and Start Menu).
2. **Application Startup**:
   - Launch LedgerAI PH from desktop shortcut or Start Menu.
   - Electron initializes local Express server on port 3000, verifies health via `/api/health`, creates a system tray icon, and opens the main application window (`http://localhost:3000`).
3. **Upgrade Policy**:
   - Running a newer installer updates binary files in `%LOCALAPPDATA%\Programs\ledgerai-ph\` without touching `%USERPROFILE%\Documents\LedgerAI Companies\` or `%APPDATA%\LedgerAI-PH\`. Company data, encryption keys, and SQLite databases are strictly preserved.
4. **Uninstallation Policy**:
   - Uninstalling via Windows Settings removes application binaries.
   - **Data Retention Rule**: Accounting databases (`database.lai`, `database.sqlite`), documents, and backups under `Documents\LedgerAI Companies` are **never** deleted automatically during uninstallation to protect financial records against accidental data loss.

---

## 5. Windows Acceptance Test Matrix

| Test ID | Test Scenario | Procedure | Expected Result | Pass/Fail Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **W-01** | Fresh Installation | Run `LedgerAI-PH-Setup-1.0.0-rc.1.exe` on clean Windows 10/11 | Installer completes wizard, creates desktop shortcut, unpacks binaries | App binaries present in `%LOCALAPPDATA%\Programs\ledgerai-ph` |
| **W-02** | First Startup | Launch LedgerAI PH from desktop | Server starts on port 3000, system tray icon appears, window loads UI | Tray icon active, UI loaded without connection error |
| **W-03** | Local DB Initialization | Open app and inspect SQLite database creation | SQLite database initialized with WAL mode and complete schema | `database.lai` and `.db_active.sqlite` created |
| **W-04** | Company Creation & Encryption | Create new pilot company profile with encryption enabled | Company registered, database encrypted with AES-256-GCM | `.lai` snapshot generated with SHA-256 checksum |
| **W-05** | Transaction Creation & Posting | Post balanced Journal Entry (Debit == Credit) | Entry recorded, trial balance updated atomically | Journal entry posted successfully |
| **W-06** | Financial Report Generation | Generate Trial Balance, Balance Sheet, Income Statement | Accurate financial statements computed via Drizzle query engine | Reports match accounting period totals |
| **W-07** | Offline OCR Operation | Upload receipt/invoice image without internet | Offline Tesseract WASM extracts line items | OCR extraction completes with draft status |
| **W-08** | Offline Operation | Disconnect network cable / disable Wi-Fi | All local ERP modules operate without external dependency | Zero network calls; 100% offline functionality |
| **W-09** | Application Restart & Persistence | Restart LedgerAI PH app | Previous company session and journal entries restored | Data intact after app restart |
| **W-10** | Backup & Restore | Generate encrypted backup archive and restore | Backup successfully exported and verified | Restore passes `PRAGMA integrity_check` |
| **W-11** | Application Upgrade | Install newer version over existing installation | Binaries updated; user data and companies intact | Company database unchanged and accessible |
| **W-12** | Database Migration | Run upgrade containing schema migration | Migrations applied atomically via Drizzle migrator | Schema updated without data loss |
| **W-13** | Uninstallation Data Retention | Uninstall LedgerAI PH via Windows Settings | Application binaries removed; company documents & databases preserved | `Documents\LedgerAI Companies` directory remains untouched |
| **W-14** | Abnormal Termination Recovery | Simulate power loss / kill background process during write | WAL recovery checkpoints database on next startup without corruption | Database integrity verified (`ok`) on restart |
| **W-15** | Reinstallation Data Linking | Reinstall app on machine with existing company data | App detects existing company registry and loads books | Previous company books immediately accessible |

---

## 6. Backup & Restore Procedure

- **Backup Generation**:
  - Navigate to **Settings > Backup & Recovery**.
  - Click **Export Encrypted Backup**. The system creates an encrypted `.lai` archive containing the SQLite database and metadata.
- **Restore Procedure**:
  - Navigate to **Settings > Backup & Recovery**.
  - Select backup archive file and provide encryption password / recovery key.
  - The system validates SHA-256 checksum, verifies `PRAGMA integrity_check`, and restores working state.

---

## 7. Known Risks & Limitations

1. **SQLite WAL Network Share Prohibition**: SQLite WAL mode requires POSIX shared-memory advisory locking on `-shm` files. Hosting company databases over network shares (SMB, NFS) is strictly unsupported and blocked.
2. **Single-Writer Constraint (Topology A)**: Designed for Centralized LAN API Server or single desktop workstation usage. Concurrent direct file access by multiple independent processes is prohibited.

---

## 8. Final Release Blockers

- **`REQ-WIN-001`**: Native Windows `.exe` installer compilation (`electron-builder`) requires execution on a native Windows x64 host or Windows CI runner.
