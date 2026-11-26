# LedgerAI PH — Trial Balance and Financial Report Validation

**Audited Files:** `src/server/routes/reports.ts`, `src/server/services/reportEngine.ts`, `src/server/services/ledgerIntegrityService.ts`, `src/server/routes/tax.ts`, `src/server/routes/birCompliance.ts`

---

## 1. 6-Column Trial Balance (`GET /api/reports/trial-balance`)

- Computes three aligned accounting horizons per account directly from SQLite `journal_lines` joined with `POSTED` `journal_entries` (excluding unposted drafts):
  - **Opening / Brought Forward:** `broughtForwardDebit`, `broughtForwardCredit`, `openingJournalDebit`, `openingJournalCredit`, `openingDebit`, `openingCredit`, `openingNetBalance`
  - **Period Movement:** `periodDebit`, `periodCredit`, `periodNetMovement`
  - **Closing Balance:** `closingDebit`, `closingCredit`, `closingNetBalance`
- **Multi-Mode Support:** Supports `period`, `cumulative`, `ytd`, and `period_only` scopes plus strict calendar date range and `fiscalYear` / `periodId` consistency validation (`400 INVALID_DATE_FORMAT` / `PERIOD_DATE_MISMATCH`).

## 2. Subledger-to-GL Reconciliation & Report Validation Results

1. **Trial Balance Parity Under Stress (`erp-full-workflow-regression-and-stress.test.ts` Test #6):** After posting 400 synthetic documents (`1,600+` transitions), `SUM(closingDebit) === SUM(closingCredit)` with `0` variance.
2. **REQ-ACCT-INT-003 Suite (`tests/accounting/req-acct-int-003-trial-balance.test.ts`):** All **4/4 tests passed**, confirming brought-forward opening balances, period movement rollups, and GL drill-down line parity.
3. **Deskguard Live Bank vs GL Cash Check (`tests/accounting/cash-banking-and-reconciliation-e2e.test.ts`):** Test #4 verified live posted GL balance on `dg-acc-1010` matches `bank_reconciliations` book balance 1:1 (reflecting the live `₱19,725,650.00` balance including November transactions).
4. **Pagination Consistency (`GET /api/accounting/cash-transactions`):** Verified `raw=true` returns all active records (tested up to `129` synthetic rows without 20-row truncation) and default paginated `totalCount` equals DB row count 1:1.
