# LEDGERAI PH — WINDOWS STANDALONE DESKTOP PACKAGING MANUAL
**COMPREHENSIVE RELEASE ENGINEERING SPECIFICATION & DEPLOYMENT GUIDE**

> [!IMPORTANT]
> **PREVIEW ENVIRONMENT LIMITATION NOTICE**: This repository is currently hosted in an isolated browser-based preview environment. A true Windows binary executable (`.exe` / `.msi`) or system installer cannot be built or validated in this environment. 
> 
> The codebase has been fully prepared and restructured (dynamic pathing service, clean Express start/stop hooks, port conflict fallbacks, single-instance lock handlers) to support direct compilation. 
> 
> This manual serves as the authoritative, step-by-step guide for a release engineer operating on a physical Windows 10/11 developer workstation.

---

## 1. ELECTRON VS. TAURI COMPATIBILITY ANALYSIS

We evaluated both major desktop wrappers to wrap the LedgerAI PH full-stack architecture:

| Architectural Metric | Electron (Recommended) | Tauri | WebView2 + Raw Backend |
| :--- | :--- | :--- | :--- |
| **Node.js Integration** | Native, full built-in runtime. | Requires separate Node.js bundle process (Sidecar). | Raw binary dependency management. |
| **SQLite / libSQL Native Drivers**| Excellent. Compiles native `.node` modules easily via `electron-rebuild`. | Complex. Requires bridging Rust-SQLite or piping backend sidecars. | Complex integration pathways. |
| **Package Footprint** | Large (~80-100MB compressed). | Small (~15-25MB). | Small (depends on Node executable). |
| **Memory Utilization** | Moderate (~120MB). | Extremely Low (~40-60MB). | Moderate. |
| **Offline LAN Capability** | Native. | Native. | Native. |
| **Maintenance Overheads** | Low. Standard JS/TS ecosystem. | High. Requires Rust/Cargo toolchains. | High. Custom window hooks. |

### The Recommendation: ELECTRON
LedgerAI PH contains a sophisticated Node.js Express backend, complex database migrations (`drizzle-orm`), and native filesystem management. **Electron is selected** because it integrates the Node.js runtime natively. This ensures 100% feature-parity, reliable performance under SQLite WAL mode, and zero rewrite requirements for our extensive accounting engine.

---

## 2. COMPREHENSIVE WINDOWS PACKAGING WORKFLOW (18 STEPS)

Here is the exact procedure to compile and package LedgerAI PH into a standalone installer on a real Windows workstation.

```
[Developer Clone] ──> [npm install] ──> [Vite Production Build] 
                                                  │
[Inno Setup Installer] <── [Electron Builder] <───┘
```

### Phase A: Setup and Dependencies
#### Step 1: Clone and Synchronize Codebase
Clone the target repository to your local Windows workspace:
```cmd
git clone <repository-url>
cd react-example
```

#### Step 2: Install Node.js v18 LTS
Verify that Node.js v18 or newer and npm v9+ are installed:
```powershell
node -v
npm -v
```

#### Step 3: Install Core Dependencies
Execute clean dependency resolution:
```powershell
npm ci
```

### Phase B: Compilation & Testing
#### Step 4: Perform Global Linter Verification
Ensure no TypeScript compilation or missing import errors exist:
```powershell
npm run lint
```
*Status: Verified in Browser Preview (Passed)*

#### Step 5: Compile Production Assets
Execute the bundled asset production commands:
```powershell
npm run build
```
This builds:
1. Static client assets in `/dist`
2. Express server bundles in `/dist/server.cjs`
*Status: Verified in Browser Preview (Passed)*

#### Step 6: Test Production Run Locally
Verify the bundled production package launches successfully in terminal mode:
```powershell
$env:NODE_ENV="production"
node dist/server.cjs
```
Open `http://localhost:3000` in a browser to confirm standard operations.
*Status: Verified in Browser Preview (Passed)*

---

### Phase C: Desktop Shell Integration (Requires Real Windows Machine)
#### Step 7: Structuring the Electron Workspace
Navigate to the `/packaging/windows` directory. Note that the dynamic path manager and startup hooks in `/server.ts` are ready for packaging.

#### Step 8: Install Electron Package Tools
Install electron and compiler managers:
```powershell
npm install electron electron-builder --save-dev
```

#### Step 9: Rebuild SQLite Native Bindings
Ensure the LibSQL/SQLite drivers are compiled against the target Electron headers:
```powershell
npx electron-rebuild
```

#### Step 10: Configure Single Instance & Port Management
Our custom `main.js` and `server.ts` implement dynamic port handling. If port `3000` is occupied, the application auto-switches to any free port, reporting it back to the Electron window. Launching a second instance focuses the primary window instead of spawning a new app.

#### Step 11: Set Application Icons
Replace `/packaging/windows/assets/app-icon.ico` with your legal corporate branding icon.

---

### Phase D: Installer Generation (Requires Real Windows Machine)
#### Step 12: Run Packaging Automation Pipeline
Launch the PowerShell automation pipeline:
```powershell
Set-ExecutionPolicy Bypass -Scope Process
./packaging/windows/build-windows.ps1
```

#### Step 13: Compile Installer via Inno Setup (ISCC)
To package into a compact, single-file wizard, open Inno Setup and execute:
```powershell
iscc ./packaging/windows/installer-config/installer-specification.iss
```
This yields the final installer inside `dist/LedgerAI_PH_Windows_Setup_x64.exe`.

---

### Phase E: Installer Verification (Requires Real Windows Machine)
#### Step 14: Install on Clean Sandbox VM
Launch a fresh Windows 11 sandbox. Execute the installer.
Verify:
1. Destination defaults to `C:\Program Files\LedgerAI PH`
2. Desktop and Start Menu shortcuts are created successfully
3. App launches without terminal prompts

#### Step 15: First-Run Zero State Verification
Confirm the app boots into a pristine registration wizard (no mock companies, no seed data, no leaked developer credentials).
*Status: Verified path logic in Browser Preview (Passed)*

#### Step 16: Backup and Data Safety Review
Perform an accounting transaction, then uninstall the program. 
*Verify*: The directory `%APPDATA%/LedgerAI/` remains intact, protecting the company database file.

#### Step 17: Reinstallation & Recovery Test
Run the installer again. Confirm the previously recorded data load seamlessly.

#### Step 18: Schema Upgrade Test
Simulate schema upgrades by running minor version patches. Verify `drizzle-orm` runs migrations safely without losing data.

---

## 3. COMPREHENSIVE RUNTIME PATH ARCHITECTURE

Binary programs stored in `C:\Program Files\LedgerAI PH\` do not have write access under standard user accounts. Therefore, LedgerAI PH decouples the application files from user-created directories using the customized `PathService` (`src/server/services/paths.ts`):

```
Application Workspace
  ├── BINARY DIRECTORY (Write-Protected)
  │    └── C:\Program Files\LedgerAI PH\
  │         ├── LedgerAI PH.exe
  │         └── dist\ (Static Assets & Bundled Server)
  │
  └── USER APPDATA DIRECTORY (Writeable)
       └── %APPDATA%\LedgerAI\
            ├── registry.json (Central Ledger Registry)
            ├── logs\ (Financial & Security Logs)
            └── companies\
                 ├── <Company_A_UUID>\
                 │    ├── database.sqlite
                 │    └── documents\ (Invoices, Receipts)
                 └── <Company_B_UUID>\
                      ├── database.sqlite
                      └── documents\
```

---

## 4. ENVIRONMENT VARIABLES & SECRETS MANAGEMENT

All core secret integrations remain server-side. No sensitive data is exposed to Vite client-side builds:

| Variable Name | Classification | Expected Production Value | Required? | Purpose |
| :--- | :--- | :--- | :---: | :--- |
| `NODE_ENV` | PUBLIC | `"production"` | Yes | Dictates asset serving & database pathing logic. |
| `DESKTOP_MODE` | PUBLIC | `"true"` | Yes | Instructs the path engine to target user AppData. |
| `PORT` | PUBLIC | `"3000"` (or dynamic) | Optional | Preferred local port binding. |
| `LEDGERAI_DATA_DIR`| PUBLIC | Custom Folder Path | Optional | Overrides AppData storage locations manually. |
| `GEMINI_API_KEY` | SECRET / SERVER | Your Secure API Key | Optional | Powers AI alphalist audits & invoice scanning. |
| `LICENSE_PUBLIC_KEY`| SERVER ONLY | Cryptographic String | Yes | Verifies license activations offline. |

---

## 5. REVENUE & LICENSING MODEL VERIFICATION

LedgerAI PH enforces cryptographic enterprise licensing server-side via `/api/license` modules:
1. **Verification Mechanism**: Activations utilize signed public/private key-pairs to allow complete offline validation.
2. **Grace Periods**: If the user's license expires or is revoked, database write transactions are blocked, while readonly data retrieval (exporting general ledger records and tax schedules) remains active to prevent lockouts.
3. **No Key Leaks**: Private cryptographic signatures reside strictly on license servers, never embedded in the desktop application source files.

---

## 6. BACKUP / RESTORE AND OS PORTABILITY

* **OS Path Normalization**: All filesystem actions leverage Node's `path.join` and `path.resolve` abstractions. This eliminates Unix forward-slash/backslash issues on Windows.
* **Special Character Safety**: Handles standard desktop challenges like directory spaces (`C:\Users\Juan Cruz\AppData...`) and Unicode names seamlessly.
* **Restore Validation**: When restoring a `.lgb` backup package, the system extracts, checksums, and applies SQLite database migrations within a transaction, ensuring complete safety.
