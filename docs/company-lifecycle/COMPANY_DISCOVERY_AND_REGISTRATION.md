# LedgerAI PH — Company Discovery & Registration Architecture

**Authoritative Registry:** `CompanyManager` (`<CONFIG_DIR>/registry.json`)  
**Shortcut History:** `CompanyLifecycleService` (`<CONFIG_DIR>/shortcut_history.json`)  
**Zero Parallel Registries:** All company creation, Open Existing Company, Restore Company, Relocation, and Central Server Portable Import operations synchronize through the single `CompanyManager` registry.

---

## 1. Discovery Channels

| Operation | Mechanism | Allowed Environments |
| --- | --- | --- |
| **Single Folder Open** | `POST /api/companies/open-folder` -> `CompanyManager.browseAndRegisterCompanyFolder()` | Standalone Desktop, Electron, Localhost Server Admin |
| **Non-Mutating Directory Scan** | `POST /api/companies/discover-portable` -> scans root & immediate subdirectories via `CompanyLifecycleService.inspectDatabaseTarget()` | Localhost & Authenticated Server Admins (`Company Owner` / `System Admin`) |
| **Centralized Server Portable Upload** | `POST /api/companies/import-portable` -> `stageUploadedPortablePackage()` -> inspect -> install under managed storage | Remote Browser Clients & Localhost |
| **Backup Archive Recovery** | `POST /api/restore` -> `RestoreService.restoreDatabase()` -> registers restored portable folder | All supported modes (with Owner/Admin auth) |

---

## 2. Inspection & Validation Gate

Every discovered folder passes through `CompanyLifecycleService.inspectDatabaseTarget()` before registration:

1. **Metadata File Check (`inspectPortableMetadataFilesSync`)**:
   - Absent `portable_meta.json` / `manifest.json` -> allowed (legacy standalone compatibility).
   - Malformed JSON or structurally invalid metadata -> rejected with `INVALID_METADATA`.
2. **Database File Resolution**:
   - Checks `portable_meta.json.relativeDbPath` (if present), then `database.lai`, `company.lai`, `database.sqlite`.
   - Rejects `LAIPH1`/`LGBPH1` backup archives (`BACKUP_FILE_NOT_WORKSPACE`).
3. **Container & SQLite Integrity Verification**:
   - Validates `LAISENC1`/`LAISENC2` encryption header or SQLite magic header.
   - Opens temporary read-only decrypted copy, verifies `PRAGMA quick_check`, checks core LedgerAI PH tables, and reads authoritative `companies.id` and `companies.legal_name`.
4. **Metadata-to-Database Identity Cross-Check**:
   - If `portable_meta.json.companyId` differs from SQLite `companies.id`, fails with `INVALID_METADATA`.
5. **Attachment Audit (`auditPortableAttachmentsSync`)**:
   - Verifies referenced document files exist in `<companyDir>/documents`.

---

## 3. Atomic Registry & Shortcut Synchronization

- `CompanyManager` protects `registry.json` with an exclusive lock file and atomic temp-file rename (`writeFile` -> `rename`).
- `CompanyLifecycleService` records shortcut metadata (`lastOpenedAt`, `lastOperation`, `availabilityStatus`, `validationStatus`) in `shortcut_history.json`.
- **Non-Destructive Unregister / Shortcut Removal**: Removing a company from Saved Workspaces (`DELETE /api/companies/shortcuts/:id` or `CompanyManager.unregisterCompany()`) removes only the registry/shortcut pointer — `database.lai`, `portable_meta.json`, `documents/`, and `backups/` remain completely intact on disk and can be reopened at any time via **Open Existing Company**.
