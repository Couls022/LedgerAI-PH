# LedgerAI PH — Portable Company Lifecycle Acceptance Matrix

**Verification Date:** November 20, 2026  
**Automated Test Suites Executed:**
- `src/server/services/portableCompanyLifecycle.test.ts` — **28 / 28 PASS**
- `src/shared/folderPicker.test.ts` — **15 / 15 PASS** (22 native/browser folder picker scenarios)
- `src/server/services/backupRestoreAuth.test.ts` — **8 / 8 PASS**
- **Combined Automated Suite Total:** **51 / 51 PASS (0 failures)**

---

## 1. Open Existing Company Acceptance Matrix (Tests 1–10)

| # | Scenario | Expected Behavior | Verification Source | Status |
| --- | --- | --- | --- | --- |
| 01 | Valid portable company folder | Inspects `portable_meta.json` + `database.lai` + `documents/`, registers, and opens SQLite DB | `portableCompanyLifecycle.test.ts` #01 | **PASS** |
| 02 | Invalid folder | Non-company directory rejected with `DATABASE_NOT_FOUND` | `portableCompanyLifecycle.test.ts` #02 | **PASS** |
| 03 | Missing database | Metadata/docs without `.lai`/`.sqlite` rejected with `DATABASE_NOT_FOUND` | `portableCompanyLifecycle.test.ts` #03 | **PASS** |
| 04 | Invalid / mismatched metadata | Malformed `portable_meta.json` (`INVALID_METADATA`) and `companyId` mismatch (`IDENTITY_MISMATCH`) blocked | `portableCompanyLifecycle.test.ts` #04 | **PASS** |
| 05 | Corrupted database | Truncated/garbled `database.lai` rejected safely (`CORRUPT_DATABASE`) without crash | `portableCompanyLifecycle.test.ts` #05 | **PASS** |
| 06 | Already registered company | Reuses existing registry entry (`REUSED_EXISTING`) with zero duplicate entries | `portableCompanyLifecycle.test.ts` #06 | **PASS** |
| 07 | Duplicate company identity | Two active folders with same `companyId` return **HTTP 409** (`DUPLICATE_COMPANY_IDENTITY_CONFLICT`); switches only on explicit `SWITCH_REGISTRY_TO_SELECTED` | `portableCompanyLifecycle.test.ts` #07 | **PASS** |
| 08 | Relocated company folder | PC1 -> USB -> PC2 relocation updates registry (`RELOCATED`), stamps `lastRelocatedAt`, remaps stale `documents.file_path` rows | `portableCompanyLifecycle.test.ts` #08 | **PASS** |
| 09 | Encrypted company database | `LAISENC1` verified; `stripPortableSecrets()` guarantees zero plaintext keys/hashes in `manifest.json` & `portable_meta.json` | `portableCompanyLifecycle.test.ts` #09 | **PASS** |
| 10 | Missing required attachments | `auditPortableAttachmentsSync` warns by default (`missingCount: 1`); strict mode (`requireAttachments: true`) rejects with `MISSING_REQUIRED_ATTACHMENTS` | `portableCompanyLifecycle.test.ts` #10 | **PASS** |

---

## 2. Restore Company Acceptance Matrix (Tests 11–20)

| # | Scenario | Expected Behavior | Verification Source | Status |
| --- | --- | --- | --- | --- |
| 11 | Valid `.lai` archive (`LAIPH1`) | Validates checksum/signature and restores into portable folder with `portable_meta.json` | `portableCompanyLifecycle.test.ts` #11 | **PASS** |
| 12 | Valid legacy `.lgb` archive (`LGBPH1`) | Backward-compatible deserialization, verification, and restoration | `portableCompanyLifecycle.test.ts` #12 | **PASS** |
| 13 | Corrupted archive | Flipped payload bytes rejected before extraction | `portableCompanyLifecycle.test.ts` #13 | **PASS** |
| 14 | Tampered signature / encryption | Invalid HMAC signature rejected with `TAMPER_DETECTED` | `portableCompanyLifecycle.test.ts` #14 | **PASS** |
| 15 | Wrong archive format | Plain JSON (`INVALID_BACKUP_FORMAT`) and active workspace `database.lai` (`WORKSPACE_DB_NOT_BACKUP`) rejected | `portableCompanyLifecycle.test.ts` #15 | **PASS** |
| 16 | Insufficient destination storage | Pre-flight `verifyDestinationDiskSpace` aborts with `INSUFFICIENT_DESTINATION_STORAGE` (HTTP `507`) before touching disk | `portableCompanyLifecycle.test.ts` #16 | **PASS** |
| 17 | Existing destination conflict | Non-empty destination directory rejected with `TARGET_DIRECTORY_NOT_EMPTY`; existing files untouched | `portableCompanyLifecycle.test.ts` #17 | **PASS** |
| 18 | Interrupted extraction rollback | `BEFORE_COMMIT` failure rolls back atomically; zero broken registry entries left | `portableCompanyLifecycle.test.ts` #18 | **PASS** |
| 19 | Duplicate company identity | `NEW` mode rejects existing `companyId` (`COMPANY_ALREADY_EXISTS`); explicit `cloneAsNew: true` creates isolated new ID | `portableCompanyLifecycle.test.ts` #19 | **PASS** |
| 20 | Restore -> Open Existing round-trip | Restored folder contains `portable_meta.json` + `database.lai` and reopens directly via Open Existing Company after unregister | `portableCompanyLifecycle.test.ts` #20 | **PASS** |

---

## 3. Integration & Architecture Acceptance Matrix (Tests 21–28)

| # | Scenario | Expected Behavior | Verification Source | Status |
| --- | --- | --- | --- | --- |
| 21 | Company Registry synchronization | Single authoritative `registry.json` synced across Open, Restore, Relocate, and Import | `portableCompanyLifecycle.test.ts` #21 | **PASS** |
| 22 | Recent history updates | `CompanyLifecycleService.listShortcuts()` reflects opened companies & health status | `portableCompanyLifecycle.test.ts` #22 | **PASS** |
| 23 | Shortcut management | Non-destructive removal deletes shortcut only; preserves `database.lai`, `portable_meta.json`, and `documents/` | `portableCompanyLifecycle.test.ts` #23 | **PASS** |
| 24 | Company switching & profile isolation | `CompanyPreferenceService` keeps selections isolated per browser profile / workstation | `portableCompanyLifecycle.test.ts` #24 | **PASS** |
| 25 | Central server portable import & traversal guard | `POST /api/companies/import-portable` validates, imports, returns HTTP `409` on duplicate, and blocks `..` / `.exe` / `.sh` | `portableCompanyLifecycle.test.ts` #25 | **PASS** |
| 26 | Tenant isolation | Separate tenants maintain distinct storage paths; identical folder basenames never collide | `portableCompanyLifecycle.test.ts` #26 | **PASS** |
| 27 | Backup & recovery regression | Full round-trip `restore -> exportBackup -> serializeLai -> deserializeLai -> validateBackupFile` passes | `portableCompanyLifecycle.test.ts` #27 | **PASS** |
| 28 | Standalone legacy compatibility | Legacy folder without `manifest.json` or `portable_meta.json` opens cleanly and upgrades with `portable_meta.json` | `portableCompanyLifecycle.test.ts` #28 | **PASS** |

---

## 4. Environment Verification Scope & Native Windows Gate

- **Verified in Linux Container Environment:**
  - Full backend services, SQLite/encryption lifecycle, HTTP API routes, 51/51 automated Node tests, TypeScript typecheck (`tsc --noEmit`), production Vite build (`npm run build`), and headless Chromium browser UI verification (`#/launcher`, `#/profile/open`, `#/profile/restore`).
- **Deferred to Physical Windows 10/11 Workstation / Windows CI Runner (Not Simulated):**
  - Native Windows Explorer folder dialog visual rendering inside packaged Electron (`dialog.showOpenDialog({ properties: ['openDirectory'] })`), physical USB drive letter swaps (`E:\` -> `F:\`), Windows NTFS ACL permission tests, and Windows Service installer execution.
