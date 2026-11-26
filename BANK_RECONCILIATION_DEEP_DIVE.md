# LedgerAI PH — Bank Reconciliation Deep-Dive Report

**Primary Modules & Files:**  
- `src/server/db/business_transactions.ts` (`ensureReconciledBankSeedData`, `recalculateBankReconciliationMetrics`, `submitBankReconciliation`, `approveBankReconciliation`)  
- `src/server/routes/accounting.ts` (`GET /bank-reconciliations`, `POST /bank-reconciliations*`)  
- `src/server/routes/bankReconciliation.ts` & `src/server/services/bankReconciliationService.ts` (`/api/banking/*`)  
- `src/client/pages/accounting/BankReconciliation.tsx`  

---

## 1. Root-Cause Analysis of Reported Deskguard Bank Reconciliation Defects

Inspection of production behavior and Deskguard preview logs revealed three interacting bugs causing `dg-acc-1012` (Metrobank USD FCDU) to show `₱19,720,000.00` GL balance & stuck `SUBMITTED` state on `GET /api/accounting/bank-reconciliations`:

1. **Unscoped `ensureReconciledBankSeedData` Mutation on Read (`GET`):**
   - `ensureReconciledBankSeedData` ran on every `GET /api/accounting/bank-reconciliations` and matched historical seed dates without restricting strictly to canonical primary PHP checking account IDs (`dg-acc-1010` / `brec-dg-2026-01`..`12`). Consequently, secondary accounts such as `dg-acc-1012` or user-created November/December sessions had their GL book balances and statuses overwritten on refresh, even after user approval.
2. **Stale Precomputed Balances on Unapproved Draft/Submitted Sessions:**
   - Returning raw stored `bookEndingBalance` and `unexplainedDifference` caused newly posted transactions (e.g., `+₱5,650.00` net change bringing `1010` from `₱19,720,000.00` to `₱19,725,650.00`) not to reflect dynamically until a manual recalculate call.
3. **Unchecked Approval Bypass via Generic Journey Endpoint:**
   - Approving a `BANK_RECONCILIATION` via `/api/journey/approvals/:workflowId/decide` did not run live `recalculateBankReconciliationMetrics` variance=0 and statement evidence checks prior to transitioning status to `APPROVED`.

## 2. Remediations Implemented

- **Strict Seed Scoping:** Scoped `ensureReconciledBankSeedData` strictly to canonical `dg-acc-1010` monthly IDs `brec-dg-2026-01` through `brec-dg-2026-12`; never overwrites `dg-acc-1012`, user-created sessions, or `APPROVED`/`REOPENED` sessions.
- **Live Read-Time Recalculation:** `GET /api/accounting/bank-reconciliations` executes `recalculateBankReconciliationMetrics(companyId, r.id)` for active unapproved sessions so GL cash book balances, deposits-in-transit, outstanding checks, and variance reflect real-time posted GL lines per `bankAccountId`.
- **`version` Increment on Submit & Journey Approval Guard:** Added `recalculateBankReconciliationMetrics` and `version` bump to `submitBankReconciliation`; enforced variance=`0` and evidence checks inside `journey.ts` (`POST /approvals/:workflowId/decide` and `POST /action/BANK_RECONCILIATION/...`).
- **Parent Statement Sync:** Updated `BankReconciliationService.approveMatch` to set parent `bank_statements.status = 'RECONCILED'` once all imported lines are matched.

## 3. Verification Proof

- `tests/accounting/cash-banking-and-reconciliation-e2e.test.ts` (**6/6 passed**): Verifies Deskguard preview reconciliations track live GL Cash (`dg-acc-1010`) 1:1 while preserving multi-month balances and rejecting non-bank header accounts.
- `tests/integration/erp-full-workflow-regression-and-stress.test.ts` Test #4 (**PASSED**): Verifies secondary USD account `1012` retains isolated `0` `bookEndingBalance` without `1010` bleed, CSV statement import + auto-match + `approveMatch` promotes `bank_statements.status` to `'RECONCILED'`, and `cash-transactions?raw=true` returns all rows (`>20`) without truncation.
