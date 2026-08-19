# LedgerAI Philippines Authorization Matrix

## Core Principles
LedgerAI implements a robust Role-Based Access Control (RBAC) model bounded by strict cross-company isolation.
A user's session token contains their active `companyId`. Every API request must enforce that:
1. The user is a member of the active company.
2. The requested resource belongs to that active company.
3. The user holds the requisite permissions within that active company.

Any violation (e.g. attempting to query journals for Company B while authenticated to Company A) results in an immediate `403 Forbidden` and is recorded in `audit_logs`.

## Roles & Responsibilities

| Role | Description |
|---|---|
| **SuperAdmin** | Full system access. Can modify company settings, manage billing, create users, and execute destructive operations. |
| **Admin** | Manages day-to-day operations, including standard accounting, tax, and user management, but cannot delete the company or execute critical system changes. |
| **Accountant** | Full access to general ledger, journals, AP/AR, and reporting. Can prepare tax forms but not file them. |
| **Auditor** | Read-only access to all financial records, audit logs, and reports. Cannot create, update, or delete any records. |
| **Staff** | Limited access. Can upload documents and view non-financial dashboards. |

## Permission Mapping

| Permission Code | SuperAdmin | Admin | Accountant | Auditor | Staff |
|---|---|---|---|---|---|
| `company.settings.view` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `company.settings.edit` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `users.view` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `users.manage` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `accounting.view` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `accounting.post` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `accounting.delete` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `tax.view` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `tax.create` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `tax.file` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `documents.view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `documents.upload` | ✅ | ✅ | ✅ | ❌ | ✅ |
| `reports.view` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `audit.view` | ✅ | ✅ | ❌ | ✅ | ❌ |

## Cross-Company Isolation Enforcement
All queries to the database must include the active `companyId` in the `where` clause.
Example:
```typescript
const journals = await db
  .select()
  .from(journalEntries)
  .where(eq(journalEntries.companyId, req.activeCompany.id));
```
Attempting to fetch a record by ID without including the `companyId` check is a security vulnerability.
