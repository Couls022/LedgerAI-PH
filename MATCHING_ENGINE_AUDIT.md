# LedgerAI PH — Matching Engine Audit (3-Way Procurement & Banking Matching)

**Audited Engines:**  
1. **Banking Statement Matching Engine:** `src/server/services/bankReconciliationService.ts`, `src/server/routes/bankReconciliation.ts`  
2. **Reconciliation Worksheet Matching:** `src/server/db/business_transactions.ts`, `src/server/routes/accounting.ts`, `src/client/pages/accounting/BankReconciliation.tsx`  
3. **Procurement 3-Way Match (PO → GRN → Purchase Bill):** `src/server/routes/operations.ts`, `src/client/pages/ProcurementMatching.tsx`

---

## 1. Banking Statement Auto-Match & Approval Audit

### Scoring & Flow-Parity Algorithm (`BankReconciliationService.runMatchingEngine`)
- Matches imported `bank_transactions` (`matchedStatus = 'UNMATCHED'`) exclusively against `POSTED` `journal_entries` referencing the linked bank/cash GL account (`bankAccount.glAccountId`).
- **Direction Parity Guard:** `CREDIT` bank deposits require net positive cash debit (`cashLineNet > 0`); `DEBIT` bank withdrawals require net negative cash line movement (`cashLineNet < 0`).
- **Confidence Weighting (Threshold ≥ 0.5):**
  - Exact amount match (`|journalAmountPesos - tx.amount| < 0.01`): `+0.5`
  - Reference match (`journalNumber`, `sourceId`, or `description`): `+0.3`
  - Date proximity (`<= 5 days`): `+0.1`
  - Description prefix similarity (`first 10 chars`): `+0.1`
- **Tie-Break Safety:** If multiple candidate journal entries tie at `highestConfidence` (`topTies.length !== 1`), the engine refuses to make an arbitrary selection and leaves the bank line for human review.

### Defect Fixed in Match Approval (`BankReconciliationService.approveMatch`)
- **Prior Behavior:** `approveMatch` marked the single `bank_transactions` row `MATCHED` and inserted `bank_reconciliation_approvals`, but never updated parent `bank_statements.status` even when every line in the imported statement had been matched.
- **Fix Applied:** After updating the transaction to `MATCHED`, `approveMatch` now counts remaining unmatched lines on `bankTx.statementId`; when `unmatchedCount === 0`, it atomically updates `bank_statements.status = 'RECONCILED'`. Verified in `erp-full-workflow-regression-and-stress.test.ts` Test #4.

## 2. Worksheet Auto-Match UX Fix (`BankReconciliation.tsx`)

- **Prior Behavior:** Clicking the **Match** button on a session row with `0/0` imported statement lines (or all lines already matched) called the bulk `auto-match` endpoint directly instead of opening the detail inspection/upload modal, confusing users on empty draft sessions.
- **Fix Applied:** Clicking **Match** now opens the worksheet detail drawer/modal directly when total lines are `0` or all lines are already matched (`Review & Finalize`), triggering `auto-match` only when unmatched lines remain to be scored.

## 3. Procurement 3-Way Matching & AP Connectivity

- Inspected `src/server/routes/operations.ts` and `src/client/pages/ProcurementMatching.tsx`: Purchase Orders (`purchase_orders`), Goods Receipts (`goods_receipts`), and Purchase Bills (`purchase_bills`) share normalized reference keys and quantity/amount tolerance validations. Tested across existing procurement test suite (`procurement-ap-bir-connectivity.test.ts`).
