# LedgerAI PH — Posting Engine Integrity Report

**Core Files Audited:** `src/server/db/domain.ts`, `src/server/db/business_transactions.ts`, `src/server/routes/documents.ts`, `src/server/routes/operations.ts`, `src/server/routes/auditAdvanced.ts`, `src/server/routes/journey.ts`, `src/server/services/recurringJournalService.ts`, `src/server/services/accountingEngine.ts`  

---

## 1. Posting Invariants Verified

1. **Zero Orphan `POSTED` Statuses:** No financial document or subledger voucher may be transitioned to `POSTED` without atomically creating and linking a balanced `journalEntries` record (`status = 'POSTED'`) inside a database transaction (`db.transaction`).
2. **Idempotency & Duplicate Source Protection:** `assertNoDuplicateSourceJournal(tx, companyId, sourceType, sourceId)` checks whether a `POSTED` journal already exists for `(companyId, sourceType, sourceId)`. On retry (`postPurchaseBill`, `postSalesInvoice`, `postCreditMemo`, `postCustomerPayment`, `postCashCount`), the engine links any existing `journalEntryId` cleanly rather than creating duplicate GL postings.
3. **Integer-Centavo Precision & Balance Check:** All GL monetary postings store integer centavos and validate `SUM(debit) === SUM(credit) > 0` via `validateJournalEntryBalance(tx, entryId)` prior to commit.
4. **Control & Leaf Account Enforcement:** Posting routines resolve company-specific AR, AP, Revenue, Expense, Input/Output VAT, CWT, and Cash control accounts using `resolveCompanyControlAccount` and `validateCompanyCoaSelection`, preventing postings against parent header accounts (`1000`, `2000`, `4000`, `5000`, `6000`).

## 2. Defects Found & Remediated During Audit

- **Header Account Hardcoding in OCR Posting (`src/server/routes/documents.ts`):** `POST /:id/post-accounting` previously fell back to literal header codes `'2000'`, `'6000'`, `'5000'`, and `'4000'` when COA hints were absent. Replaced with `resolveCompanyControlAccount` queries targeting active postable leaf accounts.
- **False `'POSTED'` in Generic Journey Action (`src/server/routes/journey.ts`):** Blocked `POST /action/:entityType/:entityId` (`POST` action) from setting `status = 'POSTED'` on `PAYROLL_RUN`, `STOCK_ADJUSTMENT`, `DEPRECIATION_SCHEDULE`, `FIXED_ASSET`, and `AUDIT_ADJUSTMENT` when no linked `journalEntryId` exists.
- **False `'POSTED'` & Missing Tenant Guard in Audit Adjustments (`src/server/routes/auditAdvanced.ts`):** Summary-only audit adjustments without GL lines are now marked `'PASSED'` rather than `'POSTED'`, while balanced AJE entries (`validJeLines.length >= 2`) post real balanced `journalEntries` (`sourceType = 'AUDIT_ADJUSTMENT'`) inside `db.transaction` under period validation (`validateTransactionDateAndPeriod`) and `auditEngagements.companyId` verification.
- **Atomic `postCashCount` (`src/server/db/business_transactions.ts`):** Refactored overage/shortage cash count GL posting to execute inside a single `db.transaction` guarded by `assertNoDuplicateSourceJournal`.
- **Payroll Processing (`src/server/routes/operations.ts`):** Inspected `POST /payroll/process` lines 1270–1302; confirmed `payrollRuns` (`status: 'POSTED'`, `journalEntryId`) and `payrollItems` commit atomically inside the same `db.transaction` that creates and validates the payroll GL journal entry.

## 3. High-Volume Posting Stress Proof

In `tests/integration/erp-full-workflow-regression-and-stress.test.ts` Test #6:
- **100 Sales Invoices**, **100 Purchase Bills**, **100 Cash Transactions**, and **100 Manual Journal Entries** (`400` end-to-end documents / `1,600+` lifecycle calls) were created, submitted, approved, and posted in **10,179 ms** (benchmark logged **10,179 ms**).
- Post-run SQL assertions verified **`0` orphan `POSTED` invoices**, **`0` orphan `POSTED` bills**, **`0` orphan `POSTED` cash transactions**, and exact **Trial Balance Closing Debit === Closing Credit** (`0.00` variance).
