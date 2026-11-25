# LedgerAI Philippines Authorization Matrix (`v1.0.0-rc.2`)

## 1. Core Principles & Tenant Isolation
LedgerAI PH enforces a centralized Role-Based Access Control (RBAC) model bounded by strict per-company `.lai` / SQLite database isolation (`CompanyManager.getCompanyDb(companyId)`):
1. Every authenticated session token (`x-session-id` / `Authorization: Bearer`) binds an active `companyId`, `membershipId`, `userId`, and `role`.
2. Every request executes exclusively against the authenticated company's isolated database, enforcing `company_id` ownership across all entity queries and denying cross-tenant access (`403 Forbidden`) with immutable HMAC-sealed `audit_logs`.
3. Suspended/disabled accounts (`status !== 'ACTIVE'`), quarantine/lockout (`RECOVERY_READ_ONLY`), and Maker-Checker Segregation of Duties (`submit !== approve !== post`) remain strictly enforced for **all** users, including `Company Owner`.

---

## 2. Canonical Enterprise Roles (9 Active Role Templates)
Defined authoritatively in `src/shared/rbacCatalog.ts`:

| Role Name | Role Code | Default Scope | Default Approval Limit | Can Approve | Can Post GL | Read-Only | Primary Function |
|---|---|---|---|---|---|---|---|
| **Company Owner** | `COMPANY_OWNER` | `COMPANY_WIDE` | `-1` (Unlimited) | Yes | Yes | No | **Unrestricted company-level access** across all **16 modules / 36 submodules** (`['*', ...ALL_PERMISSIONS]`), immune to employee permission checkboxes, role template caps, or `DENY` overrides. |
| **Company Administrator** | `COMPANY_ADMIN` | `COMPANY_WIDE` | `-1` (Unlimited) | Yes | Yes | No | Full operational, security, RBAC matrix, backup vault, LAN cluster, and system configuration authority; subject to assigned module/permission overrides. |
| **Accountant** | `ACCOUNTANT` | `COMPANY_WIDE` | `₱5,000,000.00` | Yes | Yes | No | Full GL, COA, journals, AR/AP, bank recon, inventory, fixed assets, payroll, budgets, BIR tax schedules, and closing workflows. |
| **Bookkeeper** | `BOOKKEEPER` | `OWN_RECORDS` / `COMPANY_WIDE` | `₱0.00` | No | No | No | Prepares draft Sales Invoices, Purchase Bills, Cash Receipts/Disbursements, and journals; cannot approve or post to GL. |
| **Approver** | `APPROVER` | `COMPANY_WIDE` | `₱2,000,000.00` | Yes | No | No | Reviews/approves/rejects submitted operational and financial transactions within Maker-Checker SoD and spending limits. |
| **Reviewer** | `REVIEWER` | `ASSIGNED_RECORDS` | `₱0.00` | No | No | No | Performs completeness, 3-way match, and tax coding review prior to Approver sign-off. |
| **Auditor** | `AUDITOR` | `COMPANY_WIDE` | `₱0.00` | No | No | Yes | Read-only forensic & statutory audit access across GL, subledgers, Trial Balance, Reports, Activity Center, and Audit Integrity Logs (`403` on financial mutations). |
| **Tax & AP Specialist** | `TAX_AP_SPECIALIST` | `COMPANY_WIDE` | `₱0.00` | No | No | No | Focused Procure-to-Pay (`purchases:*`), Vendor Registry (`vendors:*`), EWT/2307 & BIR Compliance (`tax:*`, VAT/SLSP/SAWT/2550Q/2551Q/1601-EQ) preparation; restricted from Payroll & unrelated admin modules. |
| **Read-only User** | `READ_ONLY` | `COMPANY_WIDE` | `₱0.00` | No | No | Yes | Stakeholder read-only visibility on Dashboard, Financial Reports, and permitted subledgers. |

---

## 3. Company Owner Full-Authority Policy (`DEF-OWNER-RBAC-001`)
1. **Unconditional Module & Permission Resolution**:
   - In `RbacService.resolveEffectiveAccess`, `getAuthorizedERPModules`, `isRouteAuthorizedForUser`, `requirePermission`, `isApproverRole`, and `isPostingRole`, an active `Company Owner` unconditionally resolves **16 / 16 primary modules**, **36 / 36 submodules**, `COMPANY_WIDE` data scope, `-1` unlimited approval limit, and `['*', ...ALL_PERMISSIONS]`.
   - Any stale `user_module_assignments` restrictions or `user_permission_overrides` `DENY` records for a `Company Owner` are ignored during resolution and scrubbed during multi-role synchronization (`syncMultiRoleModulesForUser`).
   - API endpoints (`PUT /api/rbac/members/:membershipId/module-assignments`, `/data-scope`, `/approval-limit`, `PUT /api/users/:membershipId/permissions`) reject attempts to strip or restrict an active `Company Owner` with HTTP `400 OWNER_UNRESTRICTED_POLICY`.
   - In `RbacMatrixWorkspace.tsx`, when targeting a `Company Owner`, matrix checkboxes, scopes, and approval limits display locked in full-access state with the policy banner *"Unrestricted Company Owner Authority — Immune to Employee Permission Checkboxes"*.
2. **Non-Bypassable Enterprise Safeguards Preserved**:
   - Invalid/expired tokens and disabled/inactive memberships still fail authentication (`401` / `403`).
   - Cross-company tenant requests remain isolated and blocked (`403`).
   - Quarantine mode (`RECOVERY_READ_ONLY`) still blocks writes via `requireWriteAccess`.
   - Maker-Checker SoD (`submitUserId === approveUserId`) and Last-Owner deletion/demotion protection remain enforced.
   - All security, RBAC, and financial actions continue to record immutable HMAC-SHA256 `audit_logs`.

---

## 4. Canonical `module:action` Permission Catalog (Across 16 Modules & 36 Submodules)

| Primary Module | Submodule(s) | Canonical Permission Codes |
|---|---|---|
| **1. Dashboard** (`dashboard`) | `dash-overview` | `dashboard:view`, `dashboard:export` |
| **2. Sales & Receivables** (`sales`) | `sales-invoices` | `sales:view`, `sales:create`, `sales:edit`, `sales:submit`, `sales:review`, `sales:approve`, `sales:post`, `sales:cancel`, `sales:delete` |
| **3. Procurement & Payables** (`procurement`) | `proc-matching`, `proc-bills` | `purchases:view`, `purchases:create`, `purchases:edit`, `purchases:submit`, `purchases:review`, `purchases:approve`, `purchases:post`, `purchases:cancel`, `purchases:delete` |
| **4. Inventory & Warehouse** (`inventory`) | `inv-movements` | `inventory:view`, `inventory:create`, `inventory:edit` |
| **5. Cash & Banking** (`cash-banking`) | `cash-mgmt`, `bank-recon` | `cash:view`, `bank_rec:view`, `bank_rec:create`, `bank_rec:edit`, `bank_rec:approve` |
| **6. Accounting & GL** (`accounting`) | `acct-coa`, `acct-journals`, `acct-tb`, `acct-periods`, `acct-forex` | `accounting:view`, `accounting:create`, `accounting:edit`, `accounting:submit`, `accounting:review`, `accounting:approve`, `accounting:post`, `accounting:reverse`, `accounting:delete`, `periods:close`, `periods:reopen` |
| **7. Fixed Assets** (`fixed-assets`) | `fa-register` | `fixedassets:view`, `fixed_assets:manage` |
| **8. Payroll & HR** (`payroll`) | `pay-records` | `payroll:view`, `payroll:manage` |
| **9. Tax & BIR Compliance** (`tax`) | `tax-engine`, `tax-schedules`, `tax-data-entry`, `tax-returns` | `tax:view`, `tax:create`, `tax:edit`, `tax:approve`, `tax:export` |
| **10. Budget & Planning** (`budget`) | `bud-mgmt` | `budget:view`, `budget:create`, `budget:approve` |
| **11. Documents & OCR** (`documents`) | `doc-inbox` | `documents:view`, `documents:create`, `documents:edit`, `documents:verify`, `documents:delete` |
| **12. Reports & Analytics** (`reports`) | `rep-statements` | `reports:view`, `reports:export` |
| **13. Approvals & Workflow** (`approvals`) | `appr-inbox` | `approvals:view`, `approvals:review`, `approvals:approve` |
| **14. Activity Center** (`activity-center`) | `act-stream` | `activity:view` |
| **15. Audit & Governance** (`audit`) | `aud-trail`, `aud-engagements`, `aud-workpapers`, `aud-forensic`, `aud-integrity` | `audit:view`, `audit:export` |
| **16. Master Data & Admin** (`master-data`) | `md-customers`, `md-vendors`, `md-cost-centers`, `md-tax-codes`, `md-roles`, `md-backup-vault`, `md-lan-network`, `md-settings` | `masterdata:view`, `customers:view/create/edit`, `vendors:view/create/edit`, `users:view/manage`, `roles:manage`, `settings:view/manage`, `backup:manage`, `backups:view/create/verify/restore/download`, `storage:view/cleanup/manage`, `lan:view/lock`, `lan:sessions:terminate` |

---

## 5. Effective Access Resolution Precedence (Non-Owner Employees)
1. **Account & Quarantine Gate**: Inactive user memberships immediately resolve zero modules and empty permissions.
2. **Role Template Baseline & Multi-Role Union**: Combines all assigned role templates (`ROLE_TEMPLATES_CATALOG` / published company role template version).
3. **Explicit Module Assignments (`user_module_assignments`)**: When customized per user (`restrictedToAssigned = true`), restricts primary modules and submodules exclusively to assigned rows (`getAuthorizedERPModules`, sidebar navigation, route guards, and API middleware).
4. **Hard Role Restrictions (`hardRestrictedRoles`)**: Blocks incompatible privileges (e.g., Read-only Users cannot gain `*:post` or `*:approve`).
5. **User-Specific Overrides (`user_permission_overrides`)**: Evaluates `USER_SPECIFIC_GRANT` and `USER_SPECIFIC_DENY` (`USER_SPECIFIC_DENY` overrides baseline grants).
6. **Live Data Scope & Monetary Approval Limits**: Enforced dynamically at transaction approval endpoints (`APPROVAL_LIMIT_EXCEEDED`).

