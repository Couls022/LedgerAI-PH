# Phase 1 Verification Audit Report

(PASS) 1. Every company has its own isolated SQLite database: `CompanyManager` physically isolates companies into separate `database.sqlite` files inside `data/companies/<id>/` (or custom mounted path).
(PARTIAL) 2. Every company has: database.sqlite, company manifest, user/security records, accounting records, audit logs, document vault, backup folder, configuration, license binding data where applicable: The schema properly tracks user, accounting, audit, and config data per DB. `CompanyManager` provisions the physical `documents/` and `backups/` folders alongside `database.sqlite` and `manifest.json`. However, no explicit license binding tables exist in the current schema.
(PASS) 3. There must be no hard-coded single-company/single-database production path: `dbPath` is dynamically constructed based on the active company's `location` defined in `CompanyManager.ts`. No global SQLite paths exist.
(PASS) 4. Selected company ID and database path must correctly propagate to: repositories, accounting services, reporting service, audit services, compliance services, document services, Ledger AI context, backup services, authentication services: The Express middleware explicitly uses `CompanyManager.getCompanyDb(companyId)` and wraps the `next()` call in `dbContext.run(companyDb, ...)`. All services import `db` from a proxy that forwards to `dbContext.getStore()`. Context propagation is perfect and robust.
(PASS) 5. Database connection concurrency is safe (Company A requests cannot cross-contaminate Company B): Node.js `AsyncLocalStorage` strictly bounds the connection pool to the lifetime of the request. Simultaneous API calls for Company A and Company B securely resolve to their respective DB files without race conditions.
(PASS) 6. Missing external drive or inaccessible mount points gracefully fail (Read-only / Error state, not silently writing to C:\): `CompanyManager.getCompanyDb()` runs `fs.access(manifest.location)` each time it fetches from the cache. It correctly throws `COMPANY_LOCATION_MISSING` if the drive is disconnected, preventing silent fallback creation on the OS drive.
(PASS) 7. Database migrations run automatically upon connection or update, and use transactions (or fail safely): `CompanyManager` automatically invokes `migrate(db, { migrationsFolder })` during DB initialization. The Drizzle migrator handles transactions for SQLite safely.
(PARTIAL) 8. SQLite corruption detection prevents silent failure: The database catches missing files or failed migrations (`DATABASE_CORRUPT_OR_MIGRATION_FAILED`), but it does not execute explicit `PRAGMA integrity_check` on mount to strictly detect silent bit-rot.
(FAIL) 9. Document storage writes locally to the Company's Document Vault path, never a global blob store: `src/server/routes/documents.ts` writes metadata referencing `/storage/docs/${docId}-${fileName}`, ignoring the dedicated `documents/` folder provisioned by `CompanyManager`.
(FAIL) 10. Backup outputs strictly map to the Company's Backup folder: `src/server/routes/restore.ts` generates a dynamic JSON payload in memory and streams it out as an attachment via API. It never writes the backup artefact to the provisioned `backups/` folder.
(FAIL) 11. There are absolutely no instances of "CompanyId" being passed as an explicit WHERE clause argument in business logic routes: Despite physical database isolation, almost all business logic routes (`users.ts`, `accounting.ts`, `reports.ts`, `documents.ts`, etc.) contain redundant `eq(schema.tableName.companyId, companyId)` filters. This is legacy code from the single-database architecture and violates strict physical isolation requirements.
(FAIL) 12. All file uploads and generated reports must save strictly to the selected company's unique folder path: As mentioned in 9 and 10, files and exports do not utilize the company's isolated folder path. Furthermore, the reporting system does not currently generate or save physical report files at all (only JSON).
(PASS) 13. All data returned must exclusively belong to the logged-in company context. (Proven by tests, no leak): Even with the redundant `WHERE` clauses, the physical database isolation (Proxy + AsyncLocalStorage + SQLite files) structurally prevents Company A from reading Company B's data.
(PASS) 14. The system never opens a global database connection: `src/server/db/index.ts` is purely a dynamic Proxy. It guarantees that `db.insert` or `db.select` will throw "Database accessed outside of request context" if invoked globally.
(PARTIAL) 15. Production code does not contain hard-coded mock IDs, fake tokens, or test passwords (e.g. "password123"): `src/server/db/seed.ts` contains `bcrypt.hash("password123", 10)`. While this is a seed file, it remains in the codebase and can represent a risk if executed in production.

## Concrete Findings

### Critical
- **Redundant `CompanyId` WHERE Clauses (Requirement 11)**: The entire codebase still uses `where(eq(tableName.companyId, companyId))`. This implies the schema and queries were not fully updated to trust the physically isolated DB. The `companyId` columns in most tables should be dropped, and all queries simplified.

### Security
- **Hardcoded Seed Password (Requirement 15)**: `src/server/db/seed.ts` contains a hardcoded `"password123"` which should be replaced or explicitly gated for local-dev only.

### Isolation
- **Global Document Storage (Requirement 9 & 12)**: `documents.ts` references a global `/storage/docs/` virtual path and fails to use the company's isolated `location/documents` folder.
- **Backup Payload Routing (Requirement 10 & 12)**: `restore.ts` generates backups purely in memory and sends them over HTTP, bypassing the company's local `location/backups` directory entirely.

### Data Integrity
- **Missing `PRAGMA integrity_check` (Requirement 8)**: No explicit startup integrity check is performed on the SQLite file when mounted.

### Minor
- **License Binding Metadata (Requirement 2)**: No explicit tracking of per-company license bindings currently exists in the schema.

## VERDICT
Is Phase 1 complete? NO.

The database context propagation (AsyncLocalStorage) and multitenancy architecture are excellent, robust, and mathematically sound. However, the legacy `CompanyId` WHERE clauses, the failure to utilize the provisioned Document and Backup isolation folders, and the global `/storage/docs/` pathing require remediation before Phase 1 can be considered production-complete. Phase 2 (Authentication) should not begin until these structural legacy artifacts are cleansed.
