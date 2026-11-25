# LedgerAI PH — Company Identity & Duplicate Detection Specification

**Authoritative Implementation:**
- `src/server/services/portableCompanyService.ts` (`assessCompanyIdentityDuplicate`, `inspectPortableMetadataFilesSync`)
- `src/server/services/companyManager.ts` (`browseAndRegisterCompanyFolder`)
- `src/server/routes/companies.ts` (`POST /api/companies/open-folder`, `POST /api/companies/import-portable`)
- `src/client/pages/OpenProfile.tsx` (Explicit Conflict Resolution Panel)

---

## 1. Identity Principle

LedgerAI PH **never** identifies a company by folder name or display name alone. Authoritative company identity is determined by:
1. Primary stable `companies.id` (`companyId`) inside the verified SQLite database.
2. Cross-checked against `portable_meta.json.companyId` (if present — mismatch triggers `INVALID_METADATA`).
3. Persistent `databaseUuid` recorded in `portable_meta.json`.

Two different companies placed in folders with identical basenames under different parent paths are recognized as distinct tenants (`NEW_COMPANY`), never collided.

---

## 2. Deterministic Duplicate Assessment State Machine

`assessCompanyIdentityDuplicate()` evaluates `(companyId, selectedDirectory, registeredCompanies)` into exactly four states:

| State | Condition | Backend Behavior | UI Behavior |
| --- | --- | --- | --- |
| `NEW_COMPANY` | `companyId` not in `registry.json` | Registers new entry (`REGISTERED_NEW`) | Displays confirmation & adds to Saved Workspaces |
| `ALREADY_REGISTERED_SAME_LOCATION` | `companyId` exists in `registry.json` at the exact same resolved directory | Reuses existing registry entry (`REUSED_EXISTING`) — zero duplicate entries | Displays "Reused existing registry entry" |
| `RELOCATED_ORIGINAL_MISSING` | `companyId` exists in `registry.json`, but original directory no longer exists on disk | Safely relocates registry pointer, remaps stale document paths (`RELOCATED`) | Displays relocation confirmation + remapped document count |
| `DUPLICATE_IDENTITY_CONFLICT` | `companyId` exists in `registry.json` AND **both** original and selected directories exist on disk | Rejects with **HTTP 409** (`DUPLICATE_COMPANY_IDENTITY_CONFLICT`) unless `conflictResolution === 'SWITCH_REGISTRY_TO_SELECTED'` | Shows explicit decision panel: **Keep Existing Registered Folder** vs **Switch Registry to Selected Folder** |

---

## 3. Restore Duplicate Identity Policy

During **Restore Company** (`RestoreService.restoreDatabase`):
- In `NEW` mode, if `payload.metadata.companyId` is already registered, restore blocks with `COMPANY_ALREADY_EXISTS`.
- Users may explicitly choose:
  - **Clone as New Independent Company** (`cloneAsNew: true`) — assigns a fresh unique Company ID and isolated directory alongside the existing company.
  - **Replace Active Company** (`mode: 'REPLACE'`) — allowed only when signed in as an authorized Owner/Admin inside the matching active company, protected by a pre-restore rollback snapshot.
