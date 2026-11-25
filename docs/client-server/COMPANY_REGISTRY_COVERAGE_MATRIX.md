# LedgerAI PH — Company Registry Coverage Matrix

**Document Status:** Authoritative Baseline (November 2026)  
**Primary Source Files:** `src/server/routes/companies.ts`, `src/server/services/companyLifecycleService.ts`, `src/server/services/companyManager.ts`

---

| Registry Requirement | API / Service Entrypoint | Enforcement Mechanism | Verification Status |
| :--- | :--- | :--- | :--- |
| Central server-managed company registry | `CompanyManager.listCompanies()` / `companies.json` | Single authoritative server registry stored under central config dir | IMPLEMENTED AND VERIFIED |
| Authenticated authorized-only company listing | `GET /api/companies/authorized` | Requires `requireAuth`; enumerates non-archived companies where `req.user.email` has active user + active `companyUsers` membership + RBAC access | IMPLEMENTED AND VERIFIED |
| Path privacy for remote browser/LAN clients | `sanitizeCompanyForClient({ includePhysicalPaths: false })` | Strips `dbPath`, `location`, `documentLocation`, `backupLocation`, `databasePath`, `companyDirectory`; injects `storageScope: 'SERVER_MANAGED'` | IMPLEMENTED AND VERIFIED |
| Standalone desktop compatibility on localhost | `isLocalLoopbackRequest(req)` in `src/server/routes/companies.ts` | Loopback (`127.0.0.1` / `::1`) retains local path visibility for desktop folder workflows | IMPLEMENTED AND VERIFIED |
| Block server filesystem inspection from remote LAN clients | `GET /api/companies/storage-environment` | Returns HTTP `403 SERVER_FILESYSTEM_PROTECTED` when called from non-loopback client IP | IMPLEMENTED AND VERIFIED |
| Company creation with isolated DB & initial owner | `POST /api/companies` | Creates isolated company DB, seeds PH COA + BIR tax classification, binds owner credentials | IMPLEMENTED AND VERIFIED |
| Protected company unregister vs DB deletion | `DELETE /api/companies/shortcuts/:id`, `DELETE /api/companies/shortcuts` | Removes shortcut list entries only without deleting physical `.lai` databases unless explicitly authorized via protected deletion flow | IMPLEMENTED AND VERIFIED |
| Archived / missing company exclusion | `CompanyManager.listCompanies()` & `GET /api/companies/:id` | Archived or missing companies are excluded from authorized workspace selection and return explicit error codes | IMPLEMENTED AND VERIFIED |
