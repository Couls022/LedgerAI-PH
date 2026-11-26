# LedgerAI PH — Database Consistency Audit

**Architecture:** Per-Company Isolated SQLite Databases (`.db_active.sqlite` decrypted at runtime, encrypted into `company.lai` on workspace close) managed by `CompanyManager` (`src/server/services/companyManager.ts`) via Drizzle ORM (`src/server/db/schema.ts`).

---

## 1. Key Consistency Checks & Findings

1. **Schema Column Parity Fix (`bank_deposits`):**
   - Identified `.version` column write attempt on `schema.bankDeposits` inside `src/server/db/business_transactions.ts` (caught by `tsc --noEmit`), which did not define a `version` column in `schema.ts`. Removed the non-existent field reference and aligned concurrency updates cleanly; `npx tsc --noEmit` passes with `0` errors.
2. **Physical Tenant & Cross-Database Isolation:**
   - Verified via `tests/security/rbac.test.ts` and `tests/integration/erp-full-workflow-regression-and-stress.test.ts` Test #3: cross-company requests cannot read or approve foreign tenant `audit_adjustments` (`403`/`404` fail-closed) or overwrite sibling COA/GL records.
3. **Referential Link Parity (`POSTED` <-> `journal_entries`):**
   - Verified `0` orphan `POSTED` invoices, bills, cash transactions, or audit adjustments in stress benchmark (`erp-full-workflow-regression-and-stress.test.ts` Test #6).
   - Verified SQLite WAL crash recovery (`SIGKILL` worker test) and cross-process `BEGIN IMMEDIATE` serialization (`final-hardening-approval-concurrency.test.ts`, 8/8 passed).
4. **Live Workspace Safety Preservation:**
   - Company lifecycle guard `CompanyManager.assertDestructiveTestOperationAllowed` strictly forbids destructive reset operations on `DEVELOPMENT`, `PILOT`, and `PRODUCTION` workspaces, protecting live workspaces such as `deskguard_solutions_stress_preview` (`LGR-PH-2026-STRESS-DG-PREVIEW`).
