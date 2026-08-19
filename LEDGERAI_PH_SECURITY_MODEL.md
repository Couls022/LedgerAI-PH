# LedgerAI PH Security Model

## 1. Authentication Flow
We utilize HTTP-only secure cookies carrying a JWT payload. The payload securely identifies the `userId` and optionally the `activeCompanyId`. This prevents client-side tampering while enabling seamless tracking of the active session context.
Passwords are mathematically hashed using `bcrypt` (work factor 10) before storage. Failed authentication attempts are explicitly audited to track potential brute-force behavior.

## 2. Session Flow & Active Company Context
A user can belong to multiple companies (e.g. an external bookkeeper). 
A global mutable variable is NEVER used for active company context to prevent leakage under concurrent access. Instead, the `activeCompanyId` is serialized securely into the user's specific JWT session, making the active company strictly request-scoped and immutable by the client without a valid API sign-off.
When calling `/api/auth/session/company`, the server ensures the membership exists and is `ACTIVE` before re-issuing a new contextualized JWT.

## 3. RBAC & Permissions
Roles (e.g. `ACCOUNTANT`, `VIEWER`) are assigned uniquely per `company_users` membership.
Permissions (e.g. `accounting.view`, `accounting.post`) are mapped to roles via the `role_permissions` join table.
This allows a single user to be an `ACCOUNTANT` with write access in Company A, but a `VIEWER` with read-only access in Company B.

## 4. Tenant Isolation & Resource Ownership
Every query hitting the database MUST include an `eq(resource.companyId, activeCompanyId)` filter constraint.
Complex insertions, like Journal Entries, explicitly re-verify the `companyId` of all associated references (e.g., verifying that the `accountId` actually belongs to the active company).
Attempting to process a journal line for Company B while logged into Company A results in a `DomainError` and an immediate rejection, neutralizing IDOR attacks.

## 5. Privilege Escalation Protection
No API endpoint trusts an incoming role ID or permission string from the browser. All permission assignments are derived securely from the backend database join of the user's active membership. Only specialized management endpoints (guarded by `companies.manage`) allow altering these assignments.

## 6. Audit Events
Critical security boundaries generate immutable database records in the `audit_logs` table:
- `LOGIN` and `LOGIN_FAILED`
- `LOGOUT`
- `COMPANY_SWITCH`
- `ACCESS_DENIED`
These events record the `userId`, target `entityId`, and relevant context for immediate non-repudiation and traceability.

## 7. Frontend vs. Backend Responsibilities
The Frontend is purely responsible for UX: conditionally hiding buttons or tabs that the user cannot interact with based on their provided context from `/api/auth/me`.
The Backend exclusively owns enforcement. Bypassing frontend UI controls and calling the backend directly will still result in a standard `403 Forbidden` response.
