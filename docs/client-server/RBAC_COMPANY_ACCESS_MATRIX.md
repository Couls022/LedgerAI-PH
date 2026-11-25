# LedgerAI PH — RBAC & Company Access Matrix

**Document Status:** Authoritative Baseline (November 2026)  
**Primary Source Files:** `src/server/middleware/auth.ts`, `src/server/routes/auth.ts`, `src/server/routes/companies.ts`, `src/server/routes/licensingAndLan.ts`, `src/server/services/rbacService.ts`

---

## 1. Company Discovery & Access Enforcement

| Action / Endpoint | Required Authentication | Required RBAC / Membership Check | Unauthorized Behavior |
| :--- | :--- | :--- | :--- |
| `GET /api/companies/authorized` | `requireAuth` (valid session cookie or bearer token) | Evaluates every non-archived company DB for active user matching `req.user.email` + active `companyUsers` row + active role | Returns only authorized companies; unauthorized companies are completely invisible |
| `POST /api/auth/switch-company` | `requireAuth` | Verifies active user + active `companyUsers` membership + active role in target company DB | HTTP `403 UNAUTHORIZED_COMPANY_ACCESS` |
| `GET /api/lan/server-dashboard` | `requireAuth` | `requirePermission('lan:view')` | HTTP `403 FORBIDDEN` |
| `GET /api/lan/sessions` | `requireAuth` | `requirePermission('lan:view')` | HTTP `403 FORBIDDEN` |
| `DELETE /api/lan/sessions/:id` | `requireAuth` | `requirePermission('lan:sessions:terminate')` | HTTP `403 FORBIDDEN` |
| `GET /api/companies/storage-environment` | Localhost loopback only | `isLocalLoopbackRequest(req)` | HTTP `403 SERVER_FILESYSTEM_PROTECTED` for remote LAN clients |

## 2. Per-Company Role Isolation

- A single user email (e.g., `cpa@firm.ph`) can hold different roles in different companies (e.g., `Company Administrator` in Company A and `Auditor` in Company B).
- On every `POST /api/auth/switch-company`, `AuthContext` replaces `permissions`, `activeCompany`, `userRole`, and `authorizedModules` entirely from the target company's authoritative RBAC resolution (`RbacService.resolveUserAccess`).
- Permissions from Company A NEVER carry over into Company B.
- Both `COMPANY_SWITCH_OUT` (in source company DB) and `COMPANY_SWITCH_IN` (in target company DB) are recorded in immutable audit logs.
