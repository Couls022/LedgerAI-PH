# LedgerAI PH — Portable Database Relocation Guide

**Scope:** Moving a Portable Company Folder Across Folders, Drives, USB Media, or Workstations (PC 1 -> USB -> PC 2)  
**Authoritative Implementation:**
- `src/server/services/portableCompanyService.ts` (`assessCompanyIdentityDuplicate`, `remapRelocatedDocumentPathsSync`, `writePortableMetadataSync`)
- `src/server/services/companyManager.ts` (`browseAndRegisterCompanyFolder`)
- `src/server/services/companyLifecycleService.ts` (`locateCompanyShortcut`)

---

## 1. Supported Relocation Scenarios

A LedgerAI PH portable company folder (`<CompanyFolder>/`) can be copied or moved cleanly across:
- Another folder on the same workstation (e.g., `C:\Users\...\Documents\LedgerAI Companies\Acme` -> `D:\Accounting\Acme`)
- An external USB drive or removable storage
- A completely new Windows or Linux workstation (PC 1 -> USB -> PC 2)

**Zero backup archive is required** to reopen a moved portable folder.

---

## 2. How Relocation Works Automatically

1. **Relative Metadata Only**: `portable_meta.json` never hardcodes drive letters or user-profile paths; it stores `relativeDbPath: "database.lai"`, `relativeDocumentsDir: "documents"`, and `relativeBackupsDir: "backups"`.
2. **Relocation Detection (`assessCompanyIdentityDuplicate`)**:
   - When opening the folder at its new location via **Open Existing Company -> Browse Company Folder** (or via **Locate Folder** on a shortcut marked `Needs Location`), LedgerAI PH reads the authoritative `companyId` from the database.
   - If `companyId` is already in `registry.json` and the previous path **no longer exists on disk**, the engine classifies the operation as `RELOCATED_ORIGINAL_MISSING`.
3. **Automatic Document Path Remapping (`remapRelocatedDocumentPathsSync`)**:
   - Any legacy `documents.file_path` records referencing stale absolute paths from the previous drive/workstation are automatically remapped to the verified file inside `<newCompanyDirectory>/documents` (checking partitioned `originals/xx/yy`, basename, and `<docId><ext>`).
4. **Registry & Metadata Synchronization**:
   - Updates `registry.json` (`location`, `dbPath`, `documentLocation`, `backupLocation`) atomically.
   - Updates `portable_meta.json` with `lastRelocatedAt`.
   - Returns `registrationAction: 'RELOCATED'` and `relocatedDocumentsUpdated`.

---

## 3. When Both Old & New Copies Exist (Safety Protection)

If you **copy** (rather than move) a portable folder so BOTH the original registered folder and the new copy exist on disk simultaneously:
- LedgerAI PH detects `DUPLICATE_IDENTITY_CONFLICT` and returns **HTTP 409**.
- It will **never** silently overwrite or merge the two copies.
- The user must explicitly choose **Keep Existing Registered Folder** or **Switch Registry to Selected Folder**.
