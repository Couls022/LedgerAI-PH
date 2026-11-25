# LedgerAI PH — Portable Company Database Specification

**Format Version:** `2.0.0` (`PORTABLE_FORMAT_VERSION`)  
**Scope:** Standalone Desktop Mode, Electron Desktop Mode, and Centralized Server Mode  
**Authoritative Implementation:**
- `src/server/services/portableCompanyService.ts`
- `src/server/services/companyLifecycleService.ts`
- `src/server/services/companyManager.ts`
- `src/server/services/databaseEncryptionService.ts`

---

## 1. Portable Company Folder Structure

Every company created, migrated, opened, or restored in LedgerAI PH conforms to a self-contained, relocatable portable directory layout:

```text
<CompanyFolder>/
├── database.lai              # Encrypted SQLite container (LAISENC1 / LAISENC2)
├── portable_meta.json        # Standardized, secret-free portable metadata (v2.0.0)
├── manifest.json             # Sanitized company manifest (plaintext secrets stripped)
├── documents/                # Supporting documents, receipts, invoices, BIR 2307 files
│   └── originals/            # Partitioned encrypted/binary document originals
└── backups/                  # Optional company-scoped .lai backup archives
```

Legacy standalone folders containing only `database.lai`, `company.lai`, or `database.sqlite` (without `portable_meta.json` or `manifest.json`) remain fully discoverable and are automatically upgraded with a secret-free `portable_meta.json` upon verified registration.

---

## 2. Standardized `portable_meta.json` Schema

Written atomically via `writePortableMetadataSync()` (`src/server/services/portableCompanyService.ts`):

| Field | Type | Description |
| --- | --- | --- |
| `formatVersion` | `'2.0.0'` | Portable package schema version |
| `companyId` | `string` | Authoritative stable company identifier (matched against SQLite `companies.id`) |
| `legalName` | `string` | Company legal name from SQLite `companies.legal_name` |
| `databaseUuid` | `string` | Stable deterministic/persistent UUID for the database instance |
| `schemaVersion` | `string` | Applied Drizzle/SQLite migration version |
| `encryptionFormat` | `'LAISENC1' \| 'LAISENC2' \| 'SQLITE_PLAIN'` | Container encryption header format |
| `encryptionKeyRef` | `string \| null` | Non-secret key mode / key ID reference only |
| `relativeDbPath` | `string` | Relative path to database file (default: `'database.lai'`) |
| `relativeDocumentsDir` | `string` | Relative path to documents directory (`'documents'`) |
| `relativeBackupsDir` | `string` | Relative path to backups directory (`'backups'`) |
| `dbChecksumSha256` | `string \| null` | SHA-256 digest of the database container file |
| `attachmentCount` | `number` | Number of document records indexed at snapshot time |
| `createdAt` | `string` | ISO-8601 creation timestamp |
| `updatedAt` | `string` | ISO-8601 last metadata sync timestamp |
| `lastRelocatedAt` | `string \| null` | ISO-8601 timestamp when portable folder was last relocated |
| `restoredFromBackupChecksum` | `string \| null` | SHA-256 checksum of source backup archive if created by Restore |

---

## 3. Portability & Zero-Secret Guarantees

1. **Relative Internal References**: `portable_meta.json` stores only relative paths (`database.lai`, `documents`, `backups`), never drive letters (`C:\`, `D:\`) or user-profile paths.
2. **No Plaintext Secrets**: `stripPortableSecrets()` strips sensitive keys (`recoveryKey`, `dek`, `kek`, `masterKey`, `encryptionKey`, `rawKey`, `secret`, `password`, `passwordHash`, `privateKey`, `signingKey`, `hmacKey`, `auditHmacSecret`) before writing `manifest.json` or `portable_meta.json`.
3. **Atomic Write Safety**: Metadata files are written to `.tmp` files and atomically renamed into place so an interrupted write never corrupts `portable_meta.json`.
4. **Backup Archive Distinction**:
   - **Active Portable Database Container**: `LAISENC1` / `LAISENC2` binary header (`database.lai`). Used by **Open Existing Company**.
   - **Backup Archive Package**: `LAIPH1` / `LGBPH1` binary header (`.lai` / `.lgb`). Used exclusively by **Restore Company**.
   - Passing a backup archive to Open Existing fails with `BACKUP_FILE_NOT_WORKSPACE`; passing an active workspace `database.lai` to Restore fails with `WORKSPACE_DB_NOT_BACKUP`.
