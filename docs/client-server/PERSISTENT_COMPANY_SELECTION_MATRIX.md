# LedgerAI PH — Persistent Company Selection Coverage Matrix

**Document Status:** Authoritative Baseline (November 2026)  
**Primary Source Files:** `src/client/services/companyPreferenceService.ts`, `src/client/pages/Launcher.tsx`, `src/client/pages/Login.tsx`, `src/client/utils/apiClient.ts`

---

| Requirement | Storage & Behavioral Contract | Security & Isolation Guarantee | Verification Status |
| :--- | :--- | :--- | :--- |
| Per-browser-profile last selected company | Stored in browser `localStorage` under `ledgerai_client_company_pref_v1` (`{ companyId, companyName, lastOpenedAt }`) | Never global on server; Browser Profile A and Browser Profile B maintain completely independent preferences | IMPLEMENTED AND VERIFIED |
| Zero sensitive data in `localStorage` | `CompanyPreferenceService` stores ONLY `companyId`, `companyName`, `lastOpenedAt`, and user-scoped pinned/recent IDs; `purgeLegacyLocalStorageTokens()` removes any legacy auth tokens | Auth tokens live strictly in memory + `sessionStorage` + `httpOnly; SameSite=Lax` cookie | IMPLEMENTED AND VERIFIED |
| Startup auto-navigation after browser close/reopen | `Launcher.tsx` reads `CompanyPreferenceService.getLastSelectedCompany()`, validates against `GET /api/companies/:id`, and routes directly to `/login/:companyId` | Browser restart clears `sessionStorage`; user lands directly on their company's Login screen and MUST enter credentials | IMPLEMENTED AND VERIFIED |
| Logout preserves saved company preference | `AuthContext.logout()` revokes server session and clears memory/`sessionStorage` token without clearing `CompanyPreferenceService` | Next visit opens the user's preferred company login screen | IMPLEMENTED AND VERIFIED |
| Central server offline preservation | `resolveStartupCompanyVerification()` returns `SERVER_UNREACHABLE` on network errors or HTTP 502/503/504 without calling `clearLastSelectedCompany()` | Temporary PC 1 downtime NEVER wipes client workstations' saved company selection | IMPLEMENTED AND VERIFIED |
| Deleted / archived / revoked company cleanup | On authoritative HTTP `404`, `403`, `410`, or `archived: true`, `Launcher.tsx` clears stale preference and shows clear inline notice | Prevents infinite redirect loops while explaining why selector opened | IMPLEMENTED AND VERIFIED |
| User-specific pinned shortcuts & recent list | Keyed by normalized `userEmail` inside browser `localStorage` (`ledgerai_client_user_companies_v1`); removing entry affects preference only | Never modifies or deletes central server databases | IMPLEMENTED AND VERIFIED |
