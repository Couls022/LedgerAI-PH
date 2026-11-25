# LedgerAI PH — Centralized Server Mode: Portable Import & Backup Restore

**Scope:** Multi-Workstation LAN / Browser Client-Server Architecture  
**Authoritative Implementation:**
- `src/server/routes/companies.ts` (`POST /api/companies/open-folder`, `POST /api/companies/discover-portable`, `POST /api/companies/import-portable`)
- `src/server/routes/restore.ts` (`POST /api/restore/validate`, `POST /api/restore`)
- `src/server/services/portableCompanyService.ts` (`sanitizePortableImportRelativePath`, `stageUploadedPortablePackage`)
- `src/client/pages/OpenProfile.tsx` & `src/client/pages/RestoreProfile.tsx`

---

## 1. Security Boundary: Standalone vs. Centralized Server Mode

| Capability | Standalone Desktop / Localhost Console | Remote LAN Browser Client |
| --- | --- | --- |
| Select authorized registered company | Allowed | Allowed |
| Open local portable company folder via direct path (`POST /api/companies/open-folder`) | Allowed | **Blocked (`403 REMOTE_FILESYSTEM_ACCESS_DENIED`)** unless authenticated Server Admin |
| Scan server directories (`POST /api/companies/discover-portable`) | Allowed | **Blocked (`403 REMOTE_FILESYSTEM_ACCESS_DENIED`)** unless authenticated Server Admin |
| Upload portable company package to server (`POST /api/companies/import-portable`) | Allowed | Allowed (validated in isolated staging; server paths redacted) |
| Upload `.lai`/`.lgb` backup archive for server-side restore (`POST /api/restore`) | Allowed | Allowed (requires Backup Owner/Admin authentication) |
| Expose raw server filesystem paths in API responses | Loopback only | Redacted (`[Server Managed Storage]`) |

---

## 2. Secure Portable Package Upload Pipeline (`POST /api/companies/import-portable`)

When a remote browser user clicks **Import Portable Folder** on `#/profile/open`:
1. `NativeFolderPickerService.selectDirectory({ purpose: 'IMPORT_SOURCE' })` opens the client device's native OS folder picker (`window.showDirectoryPicker()` or `<input type="file" webkitdirectory>`).
2. The browser reads the selected portable folder's files locally and POSTs them to `POST /api/companies/import-portable`.
3. **Server Staging Security (`stageUploadedPortablePackage`)**:
   - Every relative path is validated by `sanitizePortableImportRelativePath()`:
     - Blocks path traversal (`..`), absolute paths, drive prefixes, and null bytes.
     - Enforces allowlisted root filenames (`database.lai`, `company.lai`, `database.sqlite`, `portable_meta.json`, `manifest.json`) and safe document subpaths (`documents/...`, `backups/...`).
     - Blocks executable/script extensions (`.exe`, `.bat`, `.cmd`, `.ps1`, `.sh`, `.dll`, `.vbs`, `.js`, `.msi`).
     - Enforces package size limit (150 MB) and file count limit.
4. **Validation & Duplicate Guard**:
   - Inspects staged folder via `CompanyLifecycleService.inspectDatabaseTarget(stagingDir)`.
   - Checks `CompanyManager` registry for `companyId` collision — returns **HTTP 409** (`DUPLICATE_COMPANY_IDENTITY_CONFLICT`) with redacted server paths unless explicitly confirmed (`conflictResolution: 'SWITCH_REGISTRY_TO_SELECTED'`).
5. **Server-Managed Installation**:
   - Installs validated files into an isolated directory under `paths.getCompaniesRootDir()`, registers in `registry.json`, and deletes the temporary staging directory in `finally`.

---

## 3. Per-Workstation Company Selection Isolation

Per `CompanyPreferenceService` (`src/client/services/companyPreferenceService.ts`), the last-selected company is stored strictly in each client browser profile's local storage — never globally on the central server — so multiple staff workstations can work in different companies concurrently without interfering with each other.
