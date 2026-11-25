# LedgerAI PH — Security & Tenant Isolation Audit

**Document Status:** Authoritative Baseline (November 2026)  
**Primary Source Files:** `src/server/routes/auth.ts`, `src/server/routes/companies.ts`, `src/server/services/companyLifecycleService.ts`, `src/client/utils/apiClient.ts`, `src/client/services/companyPreferenceService.ts`

---

## 1. Security Controls Verified

| Security Domain | Control Implemented | Verification Status |
| :--- | :--- | :--- |
| **Zero Auth Tokens in `localStorage`** | `apiClient.ts` stores bearer tokens exclusively in memory + `sessionStorage` and actively purges legacy `ledgerai_token` / `auth_token` / `token` keys from `localStorage`. `FinancialInsightChat.tsx` and `AuditIntegrity.tsx` migrated to `getAuthToken()`. | IMPLEMENTED AND VERIFIED |
| **Session Cookies** | `httpOnly: true`, `sameSite: 'lax'`, `secure: NODE_ENV === 'production' && req.secure`. | IMPLEMENTED AND VERIFIED |
| **Server Filesystem Path Privacy** | `sanitizeCompanyForClient({ includePhysicalPaths: false })` strips `dbPath`, `location`, `documentLocation`, `backupLocation`, `databasePath`, and `companyDirectory` for all remote browser/LAN requests. | IMPLEMENTED AND VERIFIED |
| **Remote Storage Endpoint Blocking** | `GET /api/companies/storage-environment` returns HTTP `403 SERVER_FILESYSTEM_PROTECTED` for non-loopback clients. | IMPLEMENTED AND VERIFIED |
| **Tenant Isolation Across Companies** | Every company has an isolated SQLite database bound per request via `AsyncLocalStorage` (`dbContext`). Switching companies revokes the prior session, issues a target-company session, increments `workspaceSessionEpoch`, and remounts the workspace tree. | IMPLEMENTED AND VERIFIED |
| **RBAC-Scoped Company Visibility** | `GET /api/companies/authorized` returns only companies where the authenticated user holds an active user record and active company membership. | IMPLEMENTED AND VERIFIED |
| **Audit Trail for Company Switching** | `POST /api/auth/switch-company` records `COMPANY_SWITCH_OUT` in the source company DB and `COMPANY_SWITCH_IN` in the target company DB with user ID, IP, and timestamps. | IMPLEMENTED AND VERIFIED |
| **Redacted Server Error Telemetry** | `ServerTelemetryService.recordError()` strips any `Bearer ...` token patterns before storing bounded (25-entry) server diagnostic logs. | IMPLEMENTED AND VERIFIED |
