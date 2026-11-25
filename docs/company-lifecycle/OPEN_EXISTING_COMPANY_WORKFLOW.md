# LedgerAI PH — Open Existing Company Workflow

**Scope:** Folder-Based Portable Company Discovery & Opening  
**UI Entry Point:** `src/client/pages/OpenProfile.tsx` (`#/profile/open`)  
**API Endpoints:**
- `POST /api/companies/open-folder` (canonical folder-based discovery & registration)
- `POST /api/companies/open-database` (alias for backward compatibility)
- `POST /api/companies/discover-portable` (non-mutating directory scan — Localhost / Server Admin only)
- `POST /api/companies/import-portable` (Centralized Server Mode secure package upload)

---

## 1. Core Principle

**Open Existing Company** opens an existing portable company folder **directly** — no `.lai` / `.lgb` backup archive is required. It is completely independent from **Restore from Backup**.

---

## 2. Step-by-Step Lifecycle

1. **Native OS Folder Picker**: Clicking **Browse Company Folder** invokes `NativeFolderPickerService.selectDirectory({ purpose: 'OPEN_COMPANY', requireWrite: false })`:
   - **Electron Desktop**: `dialog.showOpenDialog({ properties: ['openDirectory'] })` via secure IPC preload bridge.
   - **Top-Level Modern Browser**: `window.showDirectoryPicker()`.
   - **Universal / Iframe Browser**: `<input type="file" webkitdirectory>`.
   - **Never** opens a custom in-app folder explorer modal.
2. **Database & Metadata Discovery (`CompanyLifecycleService.inspectDatabaseTarget`)**:
   - Inspects `portable_meta.json` and `manifest.json` via `inspectPortableMetadataFilesSync()`. Corrupted or malformed JSON immediately fails with `INVALID_METADATA`.
   - Locates `database.lai`, `company.lai`, or `database.sqlite`. Rejects `.lai`/`.lgb` backup archives (`LAIPH1`/`LGBPH1`) with `BACKUP_FILE_NOT_WORKSPACE` and directs the user to Restore.
   - Verifies container header, decrypts/opens read-only SQLite probe, validates required core accounting tables (`companies`, `users`, `accounts`, `journal_entries`, etc.), and runs SQLite `PRAGMA quick_check`.
   - Cross-checks `portable_meta.json.companyId` against SQLite `companies.id` (`INVALID_METADATA` on mismatch).
3. **Attachment Integrity Audit (`auditPortableAttachmentsSync`)**:
   - Checks every row in the `documents` table against `<companyDir>/documents`.
   - Reports `referencedCount`, `presentCount`, `missingCount`, and `missingPaths`.
   - By default, opens with a clear warning banner if attachments are missing; strict mode (`requireAttachments: true`) blocks opening with `MISSING_REQUIRED_ATTACHMENTS`.
4. **Company Identity & Duplicate Evaluation (`assessCompanyIdentityDuplicate`)**:
   - `NEW_COMPANY`: Registers new entry in `registry.json` (`registrationAction: 'REGISTERED_NEW'`).
   - `ALREADY_REGISTERED_SAME_LOCATION`: Reuses existing registry entry without creating duplicates (`registrationAction: 'REUSED_EXISTING'`).
   - `RELOCATED_ORIGINAL_MISSING`: Safely updates registry path, remaps stale absolute `documents.file_path` rows via `remapRelocatedDocumentPathsSync()`, and records `lastRelocatedAt` (`registrationAction: 'RELOCATED'`).
   - `DUPLICATE_IDENTITY_CONFLICT`: Original registered folder still exists on disk alongside the selected copy. Returns **HTTP 409** (`DUPLICATE_COMPANY_IDENTITY_CONFLICT`) with explicit decision UI:
     - **Keep Existing Registered Folder** (cancels without mutation).
     - **Switch Registry to Selected Folder** (explicitly passes `conflictResolution: 'SWITCH_REGISTRY_TO_SELECTED'`).
5. **Migration & Registration**:
   - Applies pending schema migrations safely with rollback protection (`SCHEMA_INCOMPATIBLE` on failure).
   - Writes/refreshes secret-free `portable_meta.json` and `manifest.json`.
   - Syncs `CompanyManager` (`registry.json`) and `CompanyLifecycleService` (`shortcut_history.json`).
   - Company appears immediately in Saved Company Workspaces ready for authenticated login.
