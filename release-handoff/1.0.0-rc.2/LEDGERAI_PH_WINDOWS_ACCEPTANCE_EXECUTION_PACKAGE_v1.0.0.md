# LEDGERAI PH — WINDOWS NATIVE ACCEPTANCE EXECUTION PACKAGE (`1.0.0-rc.1`)

**Document Authority**: Canonical 20-Step Native Windows 10/11 x64 Deployment, DPAPI, NTFS DACL & LAN Acceptance Package  
**Requirement ID**: `REQ-WIN-001`  
**Current Gate Status**: **`BLOCKED / PENDING NATIVE WINDOWS EXECUTION`** *(Google AI Studio runs inside a Linux x64 container; building Windows `.exe` NSIS installers, invoking Windows `CryptProtectData` DPAPI, and testing NTFS `icacls` require execution on a physical Windows 10/11 x64 host or Windows CI runner).*  
**Target Release Baseline**: `1.0.0-rc.1` (`package.json` version `1.0.0-rc.1`)

---

## 1. Prerequisites & Supported Windows Environments (Test 1)

- **Supported Operating Systems**:
  - Windows 10 Pro / Enterprise x64 (Version `22H2`, Build `19045` or newer)
  - Windows 11 Pro / Enterprise x64 (Version `23H2` / `24H2`, Build `22631` or newer)
  - Windows Server 2022 Standard / Datacenter x64 (for centralized Topology A LAN host)
- **Build Host Toolchain**:
  - Node.js `v22.x LTS` (x64; verified baseline runtime `v22.23.2`)
  - Visual Studio 2022 Build Tools (`Desktop development with C++` workload + Windows 10/11 SDK for `better-sqlite3` `^13.0.3` native compilation)
  - Python `3.11+` (for `node-gyp`)
  - NSIS `3.09+` / `electron` `^43.4.0` / `electron-builder` `^26.15.3`
- **Dual-Package Security Build Architecture (`packaging/windows/build-installers.js`)**:
  - Client distribution installer: `electron-builder.client.json` -> `LedgerAI-PH-Client-Setup.exe` (includes **public** verification key only; excludes `internal/**` and private signing keys).
  - Internal Licensing Authority installer (air-gapped internal issuer workstation only): `electron-builder.keygenerator.json` -> `LedgerAI-PH-KeyGenerator-Setup.exe`.
  - Pre-package security scan checks `A–D` (`npm run build:installers`) must confirm `0` occurrences of private keys or `/api/authority` routes in `dist/`.

---

## 2. Complete 20-Test Windows Native Acceptance Execution Matrix

Every test step below must be executed sequentially on the designated Windows 10/11 x64 acceptance workstation(s). Do not mark any row `PASS` without attaching the required command output, log file, or screenshot evidence.

| Test # | Test Name | Exact Command or Operator Action | Expected Result | Actual Result (To Be Filled by Windows QA) | Evidence to Capture | Acceptance Status |
|:---:|:---|:---|:---|:---|:---|:---:|
| **WIN-01** | **Prerequisites & OS Version Verification** | Open elevated PowerShell (`Run as Administrator`) and run:<br>`systeminfo \| findstr /B /C:"OS Name" /C:"OS Version" /C:"System Type"; node -v; npm -v; cl.exe` | Reports Windows 10/11 `x64-based PC`, Node `v22.x`, npm `10.x+`, and MSVC `cl.exe` x64 compiler available. | `[Pending Native Windows Execution]` | `win01_systeminfo_toolchain.txt` | **`BLOCKED / NOT TESTED`** |
| **WIN-02** | **Native Dependency Installation** | In the clean frozen `1.0.0-rc.1` workspace checkout on Windows x64, run:<br>`npm ci` (or `bun install --frozen-lockfile` matching `bun.lock`) | Completes with exit code `0`; installs all dependencies in `node_modules` without missing native bindings. | `[Pending Native Windows Execution]` | `win02_install_log.txt` | **`BLOCKED / NOT TESTED`** |
| **WIN-03** | **`better-sqlite3` Electron Native Rebuild** | Run:<br>`npx @electron/rebuild -f -w better-sqlite3` | Compiles `better_sqlite3.node` against the target Electron ABI (`electron 43.4.0` x64) with `Rebuild Complete`. | `[Pending Native Windows Execution]` | `win03_electron_rebuild_log.txt` & SHA-256 of `build/Release/better_sqlite3.node` | **`BLOCKED / NOT TESTED`** |
| **WIN-04** | **Production Bundle, Security Scan & NSIS Installer Build** | Run:<br>`npm run build && npm run authority:build && npm run build:installers`<br>(or run `packaging/windows/build-windows.ps1`) | Generates `release-installers\LedgerAI-PH-Client-Setup.exe` (`1.0.0-rc.1`) and `LedgerAI-PH-KeyGenerator-Setup.exe`; security scan confirms `dist/` contains `0` private keys (`BEGIN PRIVATE KEY`) and `0` `/api/authority` routes. | `[Pending Native Windows Execution]` | `win04_builder_log.txt` & `CertUtil -hashfile ... SHA256` | **`BLOCKED / NOT TESTED`** |
| **WIN-05** | **Fresh NSIS Installation** | Execute `release-installers\LedgerAI-PH-Client-Setup.exe` on a clean Windows 10/11 x64 user profile; select target install directory `C:\Program Files\LedgerAI PH`. | NSIS wizard completes without error, creates Start Menu & Desktop shortcuts, and installs read-only application binaries under `C:\Program Files\LedgerAI PH`. | `[Pending Native Windows Execution]` | Screenshot `win05_nsis_install_complete.png` & directory listing of `C:\Program Files\LedgerAI PH` | **`BLOCKED / NOT TESTED`** |
| **WIN-06** | **First Launch & Startup Self-Check** | Launch **LedgerAI PH** from the Desktop shortcut; inspect `%APPDATA%\LedgerAI\logs\main.log`. | Electron window renders the Company Profile Launcher; embedded Express server binds cleanly and `StartupValidator` logs `0` critical errors. | `[Pending Native Windows Execution]` | Screenshot `win06_first_launch_launcher.png` & `main.log` excerpt | **`BLOCKED / NOT TESTED`** |
| **WIN-07** | **Native SQLite Module Loading in Packaged App** | From the Launcher, click **Create New Company** (`WIN-PILOT-ACCEPT-01`, TIN `010-223-445-000`). | `better_sqlite3.node` loads from `app.asar.unpacked` without `NODE_MODULE_VERSION` mismatch; SQLite WAL mode (`PRAGMA journal_mode=WAL`) initializes. | `[Pending Native Windows Execution]` | `win07_sqlite_wal_status.json` | **`BLOCKED / NOT TESTED`** |
| **WIN-08** | **Database Initialization & Schema Migration** | Inspect the newly created company database via `/api/system/diagnostics` or SQLite inspection after company creation. | All Drizzle migrations (`dist/migrations`) apply atomically; all canonical COA accounts, BIR tax rules, and immutability triggers exist. | `[Pending Native Windows Execution]` | `win08_migration_verification.json` | **`BLOCKED / NOT TESTED`** |
| **WIN-09** | **Offline OCR Resource Loading (`eng.traineddata`)** | Disconnect network/Wi-Fi; navigate to **Documents & OCR** and upload a sample scanned supplier invoice PNG/PDF. | `OCRService.executeTesseractWasm` resolves `eng.traineddata` (`5,199,098` bytes) from `process.resourcesPath\resources\ocr\traineddata` with `0` outbound network calls. | `[Pending Native Windows Execution]` | Screenshot `win09_offline_ocr_extraction.png` | **`BLOCKED / NOT TESTED`** |
| **WIN-10** | **Windows DPAPI Master Key & KEK Wrapping** | Inspect `%APPDATA%\LedgerAI_Data\.keystore_vault\.master_key` and `%APPDATA%\LedgerAI_Data\.keystore_vault\WIN-PILOT-ACCEPT-01\.keyring.json`. | `.master_key` is wrapped via Windows DPAPI (`CryptProtectData` / `DPAPI1` header) bound to the Windows user/machine credential; `.keyring.json` contains wrapped KEK (`keyVersion: 1`) and `recoveryEnvelope`. | `[Pending Native Windows Execution]` | `win10_dpapi_header_check.txt` (non-secret header inspection) | **`BLOCKED / NOT TESTED`** |
| **WIN-11** | **`LAISENC2` (`aadVersion: 3`) Encrypted Container & Backup Creation** | Post a balanced journal entry (`₱100,000.00`), trigger **Settings → Backup & Restore → Create Encrypted Backup**, and close the application. | Generates `database.lai` and backup `.lai` file with magic header `LAISENC2`, `version: 2`, `aadVersion: 3`, and AAD-bound `recoveryEnvelope`. | `[Pending Native Windows Execution]` | `win11_laisenc2_header_meta.json` & backup file SHA-256 | **`BLOCKED / NOT TESTED`** |
| **WIN-12** | **Standard Recovery on Original Windows Machine** | Delete `.db_active.sqlite`, `.db_active.sqlite-wal`, and `.db_active.sqlite-shm` in the company folder; relaunch LedgerAI PH and open `WIN-PILOT-ACCEPT-01`. | Application transparently decrypts `database.lai` using the local DPAPI-protected `.keystore_vault` and restores the posted `₱100,000.00` journal entry (`0` variance). | `[Pending Native Windows Execution]` | Screenshot `win12_local_restart_recovery.png` | **`BLOCKED / NOT TESTED`** |
| **WIN-13** | **Cross-Machine Emergency Recovery Using 256-Bit Recovery Key** | Copy `database.lai` to a **second Windows PC** (where `.keystore_vault` does not exist for that company); run **Emergency Recovery** with the 64-hex-char Recovery Key issued at creation. | `DatabaseEncryptionService.recoverDatabaseWithRecoveryKeySync` verifies `LAISENC2-RECOVERY` AAD, unwraps the KEK, decrypts the SQLite DB, reprovisions local `.keystore_vault`, and logs `RECOVERY_KEY_USED`. | `[Pending Native Windows Execution]` | Screenshot `win13_cross_machine_recovery.png` & security audit log row | **`BLOCKED / NOT TESTED`** |
| **WIN-14** | **In-Place Upgrade Installation** | Build an incremented test installer (`1.0.0-rc.2` test build) and run `LedgerAI-PH-Client-Setup.exe` over the existing installation without uninstalling first. | NSIS cleanly stops running processes, updates binaries in `C:\Program Files\LedgerAI PH`, and relaunches without error. | `[Pending Native Windows Execution]` | `win14_upgrade_install_log.txt` | **`BLOCKED / NOT TESTED`** |
| **WIN-15** | **Post-Upgrade Data & Keyring Preservation** | After the `WIN-14` upgrade, open `WIN-PILOT-ACCEPT-01` and `LGR-PH-2026-PILOT-CLEAN-01` and run Trial Balance & Subledger Reconciliation. | `100%` of company profiles, `.keystore_vault` keys, `database.lai` containers, and posted journals remain intact with `0` centavos variance. | `[Pending Native Windows Execution]` | `win15_post_upgrade_trial_balance.pdf` | **`BLOCKED / NOT TESTED`** |
| **WIN-16** | **NTFS DACL Permission Verification (`icacls`)** | Run in PowerShell:<br>`icacls "$env:APPDATA\LedgerAI_Data\.keystore_vault"`<br>`icacls "$env:USERPROFILE\Documents\LedgerAI Companies"` | Verifies that `.keystore_vault` grants `Full Control (F)` only to `NT AUTHORITY\SYSTEM`, `BUILTIN\Administrators`, and the owning Windows user, with `BUILTIN\Users` / `Everyone` access removed. | `[Pending Native Windows Execution]` | `win16_icacls_output.txt` | **`BLOCKED / NOT TESTED`** |
| **WIN-17** | **Multi-Workstation LAN Operation (Topology A)** | Configure Host PC as `LAN_SERVER` (`0.0.0.0:3000`); connect 2 Client Workstations (`LAN_CLIENT`) over the office LAN and concurrently post Sales Invoices and Purchase Bills. | All client requests route through the Host Express API; `AsyncLocalStorage` isolates company contexts; optimistic locking (`version` column) prevents lost updates (`409 Conflict` on stale edits). | `[Pending Native Windows Execution]` | `win17_lan_multi_client_audit_log.json` | **`BLOCKED / NOT TESTED`** |
| **WIN-18** | **LAN Network Interruption & Reconnection Resilience** | While a `LAN_CLIENT` workstation has an active session, disconnect the Ethernet/Wi-Fi adapter for 30 seconds during a draft save, then reconnect. | Client UI surfaces a clear offline/reconnecting banner without crashing; no partial/corrupted journal is committed on the server; session resumes cleanly upon reconnect. | `[Pending Native Windows Execution]` | Video/Screenshot `win18_network_reconnect.png` | **`BLOCKED / NOT TESTED`** |
| **WIN-19** | **Server Restart, Crash Simulation & `.server_process.lock` Recovery** | During active operation on the Host PC, terminate the LedgerAI process via `taskkill /F /PID <pid>`, then relaunch LedgerAI PH. | On restart, `CompanyManager` detects the stale `.server_process.lock` (`PID` / `instanceId`), recovers SQLite WAL cleanly, and verifies `SUM(debit) == SUM(credit)` with zero duplicate or orphaned entries. | `[Pending Native Windows Execution]` | `win19_crash_recovery_verification.json` | **`BLOCKED / NOT TESTED`** |
| **WIN-20** | **Uninstallation & User Data Preservation** | Run `C:\Program Files\LedgerAI PH\Uninstall LedgerAI PH.exe` and complete uninstallation; inspect `%APPDATA%\LedgerAI_Data` and `Documents\LedgerAI Companies`. | Application binaries in `C:\Program Files\LedgerAI PH` are removed, while `%APPDATA%\LedgerAI_Data\.keystore_vault` and `Documents\LedgerAI Companies\*.lai` are **100% preserved** per BIR 10-year retention rules. | `[Pending Native Windows Execution]` | `win20_post_uninstall_dir_check.txt` | **`BLOCKED / NOT TESTED`** |

---

## 3. Failure Reporting, Evidence Capture & Escalation Protocol

1. **Severity Classification**:
   - **`P0 — Release Blocker`**: Any failure in `WIN-03` through `WIN-13`, `WIN-15`, `WIN-16`, `WIN-19`, or `WIN-20`; any installer private-key/authority-route leak; any SQLite WAL corruption or financial variance (`> 0` centavos); or any DPAPI/recovery failure. **Immediate Stop-Ship.**
   - **`P1 — Major Defect`**: Multi-workstation LAN reconnection UI defect (`WIN-17`, `WIN-18`) or non-data-loss upgrade UX issue (`WIN-14`) with a documented workaround. Must be remediated or dispositioned prior to `1.0.0 GA`.
   - **`P2 — Minor / Cosmetic`**: Non-blocking layout or log formatting issue with zero functional, cryptographic, or financial impact.
2. **Mandatory Defect Evidence Packet**:
   - Exact Test ID (`WIN-01`..`WIN-20`), Windows OS Build (`winver`), CPU/RAM, and `.exe` SHA-256 checksum.
   - Redacted copies of `%APPDATA%\LedgerAI\logs\main.log`, console/PowerShell transcript, and screenshots showing the exact error banner or dialog.
   - **Never attach unredacted `.master_key`, `.keyring.json`, or emergency recovery keys** to defect tickets. Preserve any affected `.lai` workspace intact (`read-only` copy) for forensic reproduction.
3. **No Self-Waiver Rule**: No `FAIL` or `BLOCKED` row in `WIN-01`..`WIN-20` may be waived into `PASS` without a signed remediation verification re-run against the updated build.

---

## 4. Windows QA & Release Engineering Sign-Off Block (`PENDING NATIVE WINDOWS EXECUTION`)

| Field | Operator / Windows QA Entry |
|:---|:---|
| **Acceptance Gate Status (`REQ-WIN-001`)** | **`BLOCKED / PENDING NATIVE WINDOWS EXECUTION`** |
| **Build Host & Windows OS Build** | `[Pending Native Windows Execution]` |
| **Client Installer (`LedgerAI-PH-Client-Setup.exe`) SHA-256** | `[Pending Native Windows Execution]` |
| **KeyGenerator Installer (`LedgerAI-PH-KeyGenerator-Setup.exe`) SHA-256** | `[Pending Native Windows Execution]` |
| **Total Matrix Steps Passed (`? / 20`)** | `0 / 20 Executed (Linux Container Boundary)` |
| **Open `P0` / `P1` Defects** | `[Pending Native Windows Execution]` |
| **QA Lead Name, Date & Signature** | `[Pending Native Windows Execution]` |

---

## 5. Historical Manifest Advisory

The legacy root file `RELEASE_MANIFEST.json` (dated `2026-08-17`, listing version `1.0.0` and `PRODUCTION READY`) is a superseded historical artifact and **does not authorize Windows or commercial release**. Only this frozen `1.0.0-rc.1` package and Section 41 of `LEDGERAI_ENTERPRISE_MASTER_ROADMAP.md` govern the `REQ-WIN-001` acceptance handoff.

