# LedgerAI PH — Restore Company Workflow

**Scope:** Backup Archive Validation, Extraction & Portable Folder Reconstruction  
**UI Entry Point:** `src/client/pages/RestoreProfile.tsx` (`#/profile/restore`)  
**API Endpoints:**
- `POST /api/restore/validate` (uploaded `.lai`/`.lgb` archive validation + backup owner auth)
- `POST /api/restore/validate-path` (local disk archive validation + backup owner auth)
- `POST /api/restore` (atomic restore execution)

---

## 1. Core Principle

**Restore Company** reconstructs a complete, first-class **portable company folder** from an actual backup archive file (`.lai` / `.lgb`). Once restored, the resulting folder contains `database.lai`, `portable_meta.json`, `manifest.json`, and `documents/`, so it can be immediately opened via **Open Existing Company** on the same or another machine.

---

## 2. Step-by-Step Recovery Lifecycle

1. **Native OS File Picker (Backup Archive)**:
   - Accepts `.lai` (`LAIPH1`) and legacy `.lgb` (`LGBPH1`) backup archives.
   - Immediately rejects active workspace databases (`LAISENC1` / `LAISENC2`) with `WORKSPACE_DB_NOT_BACKUP` and non-backup files with `INVALID_BACKUP_FORMAT`.
2. **Cryptographic & Ownership Verification**:
   - Verifies binary magic header, gzip decompression, SHA-256 canonical payload checksum (`CHECKSUM_MISMATCH`), and HMAC-SHA256 signature (`TAMPER_DETECTED`).
   - In Cold Disaster-Recovery mode (no active Owner/Admin session), requires Company Owner or Company Administrator credentials verified directly against the bcrypt hashes and active role bindings inside the archive (`verifyBackupRestoreCredentials`).
3. **Destination Folder & Dedicated Subfolder Selection**:
   - Uses `NativeFolderPickerService.selectDirectory({ purpose: 'RESTORE_DESTINATION', requireWrite: true })`.
   - Supports optional `dedicatedSubfolderName` (sanitized against path traversal/illegal characters) so users can pick a parent folder (e.g., `D:\LedgerAI Companies`) and restore cleanly into a dedicated subfolder.
4. **Pre-Flight Safety Guards (Before Mutating Disk)**:
   - **Disk Space Verification (`verifyDestinationDiskSpace`)**: Checks `fs.statfs()` against `max(estimatedDataBytes * 3, 2 MB)`. Returns HTTP `507` (`INSUFFICIENT_DESTINATION_STORAGE`) before creating any folder if space is insufficient.
   - **Overwrite Prevention**: Rejects non-empty destination directories in `NEW` mode (`TARGET_DIRECTORY_NOT_EMPTY`) — never silently overwrites existing files.
   - **Duplicate Identity Protection**: If `companyId` is already registered in `NEW` mode, rejects with `COMPANY_ALREADY_EXISTS` unless the user explicitly chooses **Clone as New Independent Company** (`cloneAsNew: true`) or authorized in-place **Replace Active Company** (`REPLACE` mode with pre-restore rollback snapshot).
5. **Atomic Extraction & Rollback**:
   - Executes inside a single SQLite transaction with rollback hooks covering `AFTER_DISK_BEFORE_TX`, `BEFORE_COMMIT`, and `POST_VERIFICATION`.
   - Any failure restores the pre-restore snapshot and leaves zero partial registry entries or corrupted databases on disk.
6. **Portable Folder Finalization**:
   - Encrypts the restored SQLite workspace into `database.lai`.
   - Stamps standardized, secret-free `portable_meta.json` (recording `restoredFromBackupChecksum`) and `manifest.json`.
   - Registers the restored company in `CompanyManager` (`registry.json`) and updates shortcut history.
   - Redirects to authenticated company login (`/login/:companyId`) for BIR CAS audit traceability.
