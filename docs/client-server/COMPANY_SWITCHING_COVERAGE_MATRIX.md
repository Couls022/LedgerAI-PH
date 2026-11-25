# LedgerAI PH — Company Switching Coverage Matrix

**Document Status:** Authoritative Baseline (November 2026)  
**Primary Source Files:** `src/server/routes/auth.ts` (`POST /api/auth/switch-company`), `src/client/context/AuthContext.tsx`, `src/client/pages/CompanySelector.tsx`, `src/client/components/Layout.tsx`, `src/client/pages/Login.tsx`

---

| Switching Scenario | Implementation Details | Expected Result | Verification Status |
| :--- | :--- | :--- | :--- |
| Header `Switch Company` without forced logout | `Layout.tsx` navigates directly to `#/select-company` while keeping current session active | User views all authorized companies and can return or switch seamlessly | IMPLEMENTED AND VERIFIED |
| Instant authenticated switch to another authorized company | `POST /api/auth/switch-company` verifies target registry entry, active user record, active membership, and RBAC; issues fresh target session + cookie; revokes old session without closing source DB | Fresh session token, fresh company RBAC permissions, `COMPANY_SWITCH_OUT` & `COMPANY_SWITCH_IN` audit logs | IMPLEMENTED AND VERIFIED |
| Unauthorized company switch attempt | `POST /api/auth/switch-company` checks active user & membership in target company DB | Rejected with HTTP `403 UNAUTHORIZED_COMPANY_ACCESS`; current session unaffected | IMPLEMENTED AND VERIFIED |
| Target user requires password change or locked | `POST /api/auth/switch-company` checks `mustChangePassword` & lock state | Returns `{ requiresReauth: true }`; UI routes to `/login/:targetCompanyId` | IMPLEMENTED AND VERIFIED |
| Zero stale state / cache leakage across switch | `AuthContext` increments `workspaceSessionEpoch`; `Layout.tsx` keys workspace container by `${activeCompany.id}-${workspaceSessionEpoch}-${currentFullPath}` and emits `ledgerai:company-switched` | Complete React subtree remount; zero cross-company cache leakage | IMPLEMENTED AND VERIFIED |
| Concurrent user isolation during switch | `auth.ts` no longer closes other company DB handles during login or switch (`{ force: false }`) | User A switching from Company A to B never disconnects User C working on Company A | IMPLEMENTED AND VERIFIED |
| Login screen company switching | `Login.tsx` provides prominent `Switch Company` button in top bar and workspace card | Allows choosing a different company prior to signing in | IMPLEMENTED AND VERIFIED |
| Unsaved changes guard before switching | `CompanySelector.tsx` checks `window.__ledgeraiUnsavedChanges` and renders inline confirmation panel (no `window.confirm`) | Prevents accidental loss of unsaved work | IMPLEMENTED AND VERIFIED |
