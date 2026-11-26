# LedgerAI PH — Accounting Period Control Audit

**Audited Components:** `src/server/db/domain.ts` (`validateTransactionDateAndPeriod`), `src/server/services/periodCloseWorkspaceService.ts`, `src/server/services/recurringJournalService.ts`, `src/server/routes/accounting.ts`, `tests/accounting/req-acct-int-004-period-enforcement.test.ts`

---

## 1. Period Control Architecture & Rules

1. **Global BIR Lock Date (`companies.lockDate`):**
   - Any transaction dated on or before `company.lockDate` (`formattedDate <= company.lockDate`) is blocked across GL, AR, AP, Cash, Inventory, Payroll, Fixed Assets, Tax, and Recurring Journals with `DomainError` (`403`/`400`).
2. **Fiscal Period States (`OPEN`, `SOFT_CLOSED`, `CLOSED` / `HARD_CLOSED`):**
   - `OPEN`: Permits operational creation, submission, approval, and posting.
   - `SOFT_CLOSED`: Blocks routine operational postings; permits closing adjustments only by authorized administrative/controller roles when `isClosingAdjustment: true`.
   - `CLOSED` / `HARD_CLOSED`: Strictly fail-closed across all modules (`403`), enforced via `validateTransactionDateAndPeriod`.
3. **12-Check Period Close Workspace (`periodCloseWorkspaceService.ts`):**
   - Validates unposted drafts, unbalanced entries, unapproved bank reconciliations, pending subledger documents, and period integrity prior to `SOFT_CLOSE` or `HARD_CLOSE`.

## 2. Period-Bypass Defect Remediated (`recurringJournalService.ts`)

- **Defect:** `RecurringJournalService.processDueTemplates` previously queried arbitrary `OPEN` periods without verifying `company.lockDate` or matching `startDate <= entryDateStr <= endDate`, risking silent posting into a future open month or a globally locked date.
- **Fix Applied:** Added explicit check against `company.lockDate` (`isLockedByGlobalDate`) and exact date-window lookup (`p.status === 'OPEN' && p.startDate <= entryDateStr && p.endDate >= entryDateStr`), logging `INCOMPLETE_CALCULATION` skip audit events instead of falling back to an arbitrary period.
- **Verification:** `tests/accounting/req-acct-int-004-period-enforcement.test.ts` (**4/4 passed**) and `tests/integration/erp-full-workflow-regression-and-stress.test.ts` Test #2 (**PASSED**).
