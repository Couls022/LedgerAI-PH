# LedgerAI PH — General Ledger Integrity Report

**Audited Modules:** `src/server/db/domain.ts`, `src/server/services/accountingEngine.ts`, `src/server/services/ledgerIntegrityService.ts`, `src/server/routes/reports.ts`, `src/server/services/recurringJournalService.ts`

---

## 1. Double-Entry & Structural Invariants Verified

- **Double-Entry Balance (`validateJournalEntryBalance`):** Every posting transaction verifies `SUM(debit) === SUM(credit) > 0` across `journal_lines` in integer centavos prior to SQLite commit. Unbalanced journals throw `DomainError` and roll back atomically.
- **Immutability After Posting:** `POSTED` and `REVERSED` journal entries cannot be deleted or edited in place. Corrections require an explicit offsetting reversal entry linked via `originalJournalId`, preserving full lineage in the General Ledger and Trial Balance.
- **No Unbacked `POSTED` Subledgers:** Operational entities (`sales_invoices`, `purchase_bills`, `customer_payments`, `supplier_payments`, `credit_memos`, `debit_memos`, `cash_transactions`, `bank_deposits`, `cash_counts`, `payroll_runs`, `audit_adjustments` marked `'POSTED'`) are strictly bound to a real `POSTED` `journalEntryId`.
- **Single-Source Duplicate Journal Guard:** `assertNoDuplicateSourceJournal(tx, companyId, sourceType, sourceId)` prevents retry storms or double-clicks from spawning duplicate GL entries for the same subledger document.

## 2. Reversal & Void Integrity

- `reverseJournalEntry` creates an inverse `POSTED` entry (`debit` <-> `credit`), sets `sourceType = 'REVERSAL'` / `originalJournalId`, updates original journal status to `'REVERSED'`, and logs `REVERSE_JOURNAL_ENTRY` inside `audit_logs`.
- Reporting queries filter `status = 'POSTED'` by default (or exclude reversed/reversal pairs when `includeReversed=false` mode is selected per endpoint policy), verified across `req-acct-int-003-trial-balance.test.ts` (4/4 passed) and `coa-gl-engine-and-banking-remediation.test.ts`.
