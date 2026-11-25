# LedgerAI PH — System-Wide Native Folder Picker Coverage Matrix & Architectural Standard

**Classification:** System-Wide Architectural Standard  
**Status:** Implemented & Automated Tests Verified (Browser/Node Environment)  
**Native Windows Desktop Runtime Acceptance:** **NOT TESTED / BLOCKED** inside Google AI Studio browser environment (deferred to local Windows 10/11 workstation or Windows CI runner).

---

## 1. Centralized Architecture

```text
React Module UI ("Choose Folder" / "Browse Folder")
  │
  ▼
NativeFolderPickerService (src/client/services/nativeFolderPickerService.ts)
  ├── Single-flight concurrency lock (prevents duplicate OS dialogs)
  ├── Deterministic path syntax validation (src/shared/folderPickerTypes.ts)
  ├── Electron Desktop Runtime: window.electronAPI.selectDirectory(options)
  │     │
  │     ▼
  │   Preload Bridge (electron/preload.ts — contextIsolation: true, nodeIntegration: false)
  │     │  ipcRenderer.invoke('dialog:selectDirectory', options)
  │     ▼
  │   Electron Main Process (electron/main.ts -> electron/nativeFolderPickerIpc.ts)
  │     ├── Single-flight lock & destroyed-window safety
  │     ├── Input sanitization & nearest-existing defaultPath resolution
  │     ├── dialog.showOpenDialog({ properties: ['openDirectory'], title, defaultPath, buttonLabel })
  │     └── Non-mutating OS stat/access/statfs & DB-marker inspection
  │     │
  │     ▼
  │   Backend Validation (POST /api/companies/validate-folder -> directoryValidationService.ts)
  │     ├── Non-mutating (NEVER calls fs.mkdir or writes temp files during validation)
  │     ├── Approved storage boundary & OS/security path protection
  │     ├── Cross-tenant company workspace collision detection
  │     └── Existing company DB overwrite protection
  │
  └── Non-Electron Browser Runtime (e.g. Web Preview / AI Studio):
        ├── NEVER opens a custom in-app folder browser modal
        └── Returns structured UNSUPPORTED_RUNTIME status; preserves existing path
            and displays concise inline guidance while keeping validated path input editable.
```

### Removed Obsolete Custom Component
- `src/client/components/DirectoryExplorerModal.tsx` — **DELETED** (verified zero remaining references across `src/`, `electron/`, and `tests/`).

---

## 2. Folder Picker Coverage Matrix (Modules A – H)

| Domain | Module | Submodule | Source File | Existing Component (Before) | Existing Behavior (Before) | Required Native Picker Integration | Backend Validation | Security Validation | Automated Test Coverage | Implementation Status |
|---|---|---|---|---|---|---|---|---|---|---|
| **A. Company Management** | Company Setup | Create Company — Company Data Folder | `src/client/pages/CreateProfile.tsx` | Inline `electronAPI.selectFolder` + `DirectoryExplorerModal` | Opened custom modal on cancel or browser mode | `NativeFolderPickerService.selectDirectory({ purpose: 'COMPANY_DATA', title: 'Select Company Data Folder', requireWrite: true })` | `POST /api/companies/validate-folder` (non-mutating, DB conflict check) | Blocks root, OS dirs, traversal, existing DB overwrite | `folderPicker.test.ts` (#1, #2, #3, #4, #14, #17, #18) | **IMPLEMENTED** |
| **A. Company Management** | Company Setup | Create Company — Backup Folder | `src/client/pages/CreateProfile.tsx` | Inline `electronAPI.selectFolder` + `DirectoryExplorerModal` | Opened custom modal on cancel or browser mode | `NativeFolderPickerService.selectDirectory({ purpose: 'BACKUP', title: 'Select Backup Folder', requireWrite: true })` | `POST /api/companies/validate-folder` (non-mutating, write check) | Approved storage root & tenant isolation | `folderPicker.test.ts` (#3, #15, #18) | **IMPLEMENTED** |
| **A. Company Management** | Company Lifecycle | Open Company Workspace (`Browse Folder`) | `src/client/pages/OpenProfile.tsx` | `DirectoryExplorerModal` (`selectionMode="both"`) | Always opened custom modal; ignored Electron native picker | `NativeFolderPickerService.selectDirectory({ purpose: 'OPEN_COMPANY', title: 'Select Company Workspace Folder', requireWrite: false })` | `POST /api/companies/validate-folder` + `POST /api/companies/open-database` | Read-only validation, path traversal guard, container integrity check | `folderPicker.test.ts` (#5, #6, #17, #18) | **IMPLEMENTED** |
| **A. Company Management** | Company Lifecycle | Relocate Unavailable Company (`Locate Folder`) | `src/client/pages/OpenProfile.tsx` | `DirectoryExplorerModal` (`selectionMode="both"`) | Always opened custom modal | `NativeFolderPickerService.selectDirectory({ purpose: 'OPEN_COMPANY', requireWrite: false })` -> `/api/companies/shortcuts/:id/locate` | Identity match & shortcut validation | Preserves company isolation & manifest identity | `folderPicker.test.ts` (#17, #18) | **IMPLEMENTED** |
| **A. Company Management** | Company Recovery | Login Recovery Link (`Locate Folder`) | `src/client/pages/Login.tsx` | Navigation button to `/profile/open` | Redirects to Open Company Workspace | Inherits `OpenProfile` native picker workflow | Delegated to `OpenProfile` + `/api/companies/shortcuts/:id/locate` | Authenticated/verified workspace identity | Covered via `OpenProfile` | **VERIFIED (NO CUSTOM MODAL)** |
| **A/B. Database & Company Recovery** | Restore Company | Restore Destination Folder | `src/client/pages/RestoreProfile.tsx` | `DirectoryExplorerModal` (`selectionMode="folder"`) | Always opened custom modal | `NativeFolderPickerService.selectDirectory({ purpose: 'RESTORE_DESTINATION', title: 'Select Restore Destination Folder', requireWrite: true })` | `POST /api/companies/validate-folder` + `validateSafeDestinationPath` in `restore.ts` | Companies root containment, atomic rollback, backup owner RBAC | `folderPicker.test.ts` (#15, #17, #18) + `backupRestoreAuth.test.ts` | **IMPLEMENTED** |
| **B. Database Management** | Restore Company | Browse Disk Backups (`.lai` / `.lgb`) | `src/client/pages/RestoreProfile.tsx` | `DirectoryExplorerModal` (`selectionMode="file"`) | Always opened custom modal | Electron: `NativeFolderPickerService.selectFile({ filters: [{ extensions: ['lai','lgb'] }] })`; Browser: native `<input type="file" accept=".lai,.lgb">` | `/api/restore/validate` & `/api/restore/validate-path` | Allowlisted `.lai`/`.lgb` extensions only; cold backup Owner/Admin RBAC | `folderPicker.test.ts` (#12, #15, #18) | **IMPLEMENTED** |
| **B. Database Management** | Backup Vault | Active Backup Folder Configuration | `src/client/pages/BackupManager.tsx` | None (only displayed backups; no folder picker) | Required leaving module for Settings | Added `Backup Folder` panel with `Choose Folder` wired to `NativeFolderPickerService.selectDirectory({ purpose: 'BACKUP', companyId })` | `POST /api/companies/validate-folder` + `PUT /api/companies/current/settings` | Admin/Owner/`backups:manage` RBAC + tenant collision protection | `folderPicker.test.ts` (#14, #15, #18) | **IMPLEMENTED** |
| **B. Database Management** | Audit Backup View | Atomic Backup Snapshot & Restore | `src/client/components/audit/BackupRestoreView.tsx` | Server-managed company backup vault | Uses active company's configured `backupLocationPath` | Uses company `backupLocationPath` configured via centralized native picker | Server-side `CompanyStorageService` | RBAC (`backups:create`, `backups:restore`) | Covered via `BackupManager` & `Settings` | **VERIFIED (NO CUSTOM MODAL)** |
| **C. Document Management** | Company Settings | Document Storage Folder | `src/client/pages/Settings.tsx` | Inline `electronAPI.selectFolder` + `DirectoryExplorerModal` + emoji label | Fell back to custom modal on cancel/browser | `NativeFolderPickerService.selectDirectory({ purpose: 'DOCUMENT_STORAGE', title: 'Select Document Storage Folder', requireWrite: true, companyId })` | `POST /api/companies/validate-folder` + `PUT /api/companies/current/settings` | Admin RBAC (`isAdmin`), tenant isolation | `folderPicker.test.ts` (#14, #16, #18) | **IMPLEMENTED** |
| **C. Document Management** | Documents & OCR | Upload / Receipt OCR / Archive | `src/client/pages/Documents.tsx`, `ReceiptScannerModal.tsx`, `ArchiveVaultWorkspace.tsx` | Native HTML `<input type="file">` + company document vault | Uses native OS file input & server-managed isolated company storage | Preserved native OS file selection; centralized `OCR_INPUT` & `ARCHIVE_DESTINATION` purposes supported in `NativeFolderPickerService` | Server document hash/storage validation | Company-scoped encrypted storage | `folderPicker.test.ts` (#16) | **VERIFIED (NO CUSTOM MODAL)** |
| **D. Accounting & Finance** | Financial Reports & Exports | Export Matrix / Audit Binder / Bank Recon | `src/client/components/ExportButton.tsx`, `AuditPackageExporter.tsx`, `BankReconciliation.tsx` | Standard browser/OS Save/Download & native file input | Native OS download/upload dialogs; zero custom folder modals | Centralized `EXPORT_DESTINATION` & `IMPORT_SOURCE` purposes available in `NativeFolderPickerService` | Server RBAC export endpoints | Permission-gated exports (`reports:export`, `audit:export`) | `folderPicker.test.ts` (#16) | **VERIFIED (NO CUSTOM MODAL)** |
| **E. Philippine Tax & Compliance** | BIR Returns & Schedules | Form 2307 / DAT / Tax Schedules | `src/client/pages/Tax/*` | Native OS file download & company document storage | Native OS download/print; zero custom folder modals | Uses active company Document Storage Folder configured via `NativeFolderPickerService` | BIR compliance rule engine & GL reconciliation | RBAC (`tax:view`, `tax:file`) | N/A (no custom folder modal) | **VERIFIED (NO CUSTOM MODAL)** |
| **F. System Administration** | Company Settings | Backup Directory Path | `src/client/pages/Settings.tsx` | Inline `electronAPI.selectFolder` + `DirectoryExplorerModal` | Fell back to custom modal on cancel/browser | `NativeFolderPickerService.selectDirectory({ purpose: 'BACKUP', title: 'Select Backup Folder', requireWrite: true, companyId })` | `POST /api/companies/validate-folder` + `PUT /api/companies/current/settings` | Admin RBAC + tenant collision check | `folderPicker.test.ts` (#14, #15, #18) | **IMPLEMENTED** |
| **F. System Administration** | Licensing | License Key Import (`.lai`) | `src/client/components/licensing/LicenseActivation.tsx`, `LicenseImport.tsx` | Native HTML `<input type="file">` drag-and-drop | Native OS file dialog | Preserved native OS file selection | Cryptographic Ed25519 signature check | Hardware/company binding | Existing license tests | **VERIFIED (NO CUSTOM MODAL)** |
| **G. AI & Automation** | Ledger Agent & AI Settings | Knowledge Base / Diagnostics / AI Document Storage | `src/client/components/AiSettings.tsx`, `LedgerAgentWidget.tsx` | Company-scoped deterministic DB/KB engine | Zero custom folder modals | Centralized `AI_KNOWLEDGE_BASE` & `DIAGNOSTICS_EXPORT` purposes supported in `NativeFolderPickerService` | Server-side tenant-scoped queries | RBAC & zero-hallucination guard | `folderPicker.test.ts` (#16) | **VERIFIED (NO CUSTOM MODAL)** |
| **H. Remaining Modules** | Sales, Procurement, Inventory, Payroll, Fixed Assets, Budgets, Master Data | All remaining ERP screens | `src/client/pages/**` | Zero custom folder browsers found | Full repository grep confirmed zero other custom directory modals | All future directory selection must route exclusively through `NativeFolderPickerService.selectDirectory()` | `validateDirectoryOnServer()` | `contextIsolation: true`, `nodeIntegration: false` | `folderPicker.test.ts` (#18) | **VERIFIED (ZERO CUSTOM MODALS)** |

---

## 3. Security & Data Integrity Controls Enforced

1. **Electron Security Posture (`electron/main.ts` & `electron/preload.ts`)**
   - `contextIsolation: true` and `nodeIntegration: false` preserved.
   - `window.electronAPI` exposes ONLY narrowly scoped `selectDirectory`, `selectFile`, backward-compatible `selectFolder`, `getAppPaths`, and `platform`.
   - Zero raw Node `fs` or unrestricted `ipcRenderer` access exposed to the renderer.
   - File picker extension filter strictly allowlists LedgerAI-supported extensions (`lai`, `lgb`, `sqlite`, `db`, `csv`, `pdf`, `png`, `jpg`, `jpeg`, `json`, `xlsx`), stripping executable extensions (`exe`, `bat`, `ps1`, etc.).
2. **Non-Mutating Directory Validation (`directoryValidationService.ts` & `POST /api/companies/validate-folder`)**
   - Removed the previous silent `fs.mkdir()` and temp-file creation side effects from `/api/companies/validate-folder`.
   - Selecting or validating a path NEVER silently creates directories, NEVER overwrites existing company databases, and NEVER modifies or deletes existing data.
   - Enforces syntax checks (spaces, special characters, UNC/removable drives, long path warnings), OS/security path blocks (`/etc`, `C:\Windows`, `.ssh`, `.keystore_vault`, `..`), read/write permission checks, disk space checks (`fs.statfs`), existing company DB conflict checks, and cross-company tenant directory collision checks.
3. **Single-Flight Concurrency & Cancellation Safety**
   - Both `electron/nativeFolderPickerIpc.ts` and `src/client/services/nativeFolderPickerService.ts` enforce single-flight locks (`BUSY` / `DIALOG_ALREADY_OPEN`) so rapid clicks never spawn duplicate native OS dialogs.
   - Cancelling the native OS dialog returns `status: 'CANCELLED'` and preserves the previous configured path untouched.

---

## 4. Environment Verification Honesty Report

| Verification Gate | Environment | Result | Notes |
|---|---|---|---|
| TypeScript Type Check (`tsc --noEmit`) | AI Studio Linux Container | Verified | Covers `electron/main.ts`, `electron/preload.ts`, `electron/nativeFolderPickerIpc.ts`, server, shared, and client |
| Production Build (`npm run build`) | AI Studio Linux Container | Verified | Compiles Vite frontend, `dist/server.cjs`, `dist/main.cjs`, and `dist/preload.cjs` |
| Automated Regression Tests (`folderPicker.test.ts`) | AI Studio Linux Container | Verified (Mocked Electron Dialog) | Covers all 18 required scenarios with real temp filesystem checks + mocked `dialog.showOpenDialog` |
| Live Browser UI Verification | AI Studio Chromium | Verified | Confirms `Choose Folder` / `Browse Folder` never opens a custom folder browser modal and preserves existing paths |
| **Native Windows Explorer Dialog Runtime Acceptance** | **Windows 10/11 Desktop Electron** | **NOT TESTED / BLOCKED** | Cannot execute native Windows Electron GUI or NSIS packaging inside Google AI Studio Linux browser environment. Must be executed on a local Windows development workstation or Windows CI runner using `npm run electron:build`. |
