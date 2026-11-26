# LedgerAI PH — Workflow State-Machine Matrix

All financial and governance document workflows follow deterministic server-side state transitions backed by optimistic concurrency checks (`version`), Segregation of Duties (SoD), Accounting Period locks, and synchronous `approval_workflows` synchronization.

## 1. Canonical Financial Document Lifecycle

| Entity | Initial Status | Allowed Submit / Resubmit From | Direct / Workflow Approval From | Rejection / Return Target | Posting Eligible Status | Post-Posting Target & GL Link | Reversal / Void Path |
|---|---|---|---|---|---|---|---|
| **Journal Entry** (`journal_entries`) | `DRAFT` | `DRAFT`, `RETURNED`, `REJECTED`, `CORRECTION` → `SUBMITTED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `APPROVED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `DRAFT` (or workflow `REJECTED`) | `APPROVED` (and balanced DR=CR + `OPEN` period) | `POSTED` (`postedAt`, `postedBy`, increments `version`) | `POSTED` → `REVERSED` via offsetting reversal JE (`originalJournalId`) |
| **Sales Invoice** (`sales_invoices`) | `DRAFT` | `DRAFT`, `RETURNED`, `REJECTED`, `CORRECTION` → `SUBMITTED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `APPROVED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `DRAFT` | `APPROVED` (validated integer centavo lines & COA) | `POSTED` + atomic `journalEntryId` (`JV-SI-*`), idempotent if already `POSTED` | Reverse via `reverseSalesInvoice` / offsetting JE & `VOID`/`REVERSED` status |
| **Customer Payment** (`customer_payments`) | `DRAFT` | `DRAFT`, `RETURNED`, `REJECTED`, `CORRECTION` → `SUBMITTED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `APPROVED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `DRAFT` (`POST /customer-payments/:id/reject`) | `APPROVED` (or validated `DRAFT` for legacy quick OR) | `POSTED` + atomic `journalEntryId` + updates applied SI `balanceDue` | Reverse payment & restore applied SI open balances |
| **Credit Memo** (`credit_memos`) | `DRAFT` | `DRAFT` → `APPROVED`/`POSTED` | Workflow decision | `DRAFT` | `DRAFT`/`APPROVED` | `POSTED` + `journalEntryId` (`JV-CM-*`) | Standard reversal JE |
| **Purchase Bill** (`purchase_bills`) | `DRAFT` | `DRAFT`, `RETURNED`, `REJECTED`, `CORRECTION` → `SUBMITTED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `APPROVED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `DRAFT` | `APPROVED` | `POSTED` + atomic `journalEntryId` (`JV-PB-*`), idempotent when `POSTED && journalEntryId` | Offsetting reversal JE & `REVERSED` status |
| **Supplier Payment** (`supplier_payments`) | `DRAFT` | `DRAFT`, `RETURNED`, `REJECTED`, `CORRECTION` → `SUBMITTED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `APPROVED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `DRAFT` | `APPROVED` | `POSTED` + `journalEntryId` + reduces PB `balanceDue` | Reversal JE + restores PB `balanceDue` |
| **Debit Memo** (`debit_memos`) | `DRAFT` | `DRAFT`, `RETURNED`, `REJECTED`, `CORRECTION` → `SUBMITTED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `APPROVED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `DRAFT` | `APPROVED` | `POSTED` + `journalEntryId` | Reversal JE |
| **Cash Transaction** (`cash_transactions`) | `DRAFT` | `DRAFT`, `RETURNED`, `REJECTED`, `CORRECTION` → `SUBMITTED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `APPROVED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `DRAFT` | `APPROVED` (leaf COA enforced) | `POSTED` + `journalEntryId` | Reversal JE |
| **Bank Deposit** (`bank_deposits`) | `DRAFT` | `DRAFT`, `RETURNED`, `REJECTED`, `CORRECTION` → `SUBMITTED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `APPROVED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `DRAFT` | `APPROVED` | `POSTED` + `journalEntryId` | Reversal JE |
| **Cash Count** (`cash_counts`) | `DRAFT` | `DRAFT`, `RETURNED`, `REJECTED`, `CORRECTION` → `SUBMITTED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `APPROVED` | `SUBMITTED`, `REVIEWED`, `UNDER_REVIEW` → `DRAFT` | `APPROVED` | `POSTED` (single atomic `db.transaction` + `assertNoDuplicateSourceJournal`) | Reversal JE |

## 2. Specialized Entity Lifecycles (Non-Fake-Post Enforcement)

| Entity | States | Critical Transition Invariant Enforced |
|---|---|---|
| **Bank Reconciliation (`bank_reconciliations`)** | `DRAFT` → `SUBMITTED` → `APPROVED` (Reopen → `REOPENED`/`DRAFT`) | Cannot reach `APPROVED` unless `recalculateBankReconciliationMetrics(companyId, id)` yields `unexplainedDifference === 0` AND uploaded statement evidence or matched statement lines exist (`journey.ts` & `accounting.ts`). |
| **Imported Bank Statement (`bank_statements`)** | `PENDING` / `IMPORTED` → `RECONCILED` | Automatically promoted to `RECONCILED` in `BankReconciliationService.approveMatch` once 100% of child `bank_transactions` have `matchedStatus IN ('MATCHED', 'RECONCILED')`. |
| **Audit Adjustment (`audit_adjustments`)** | `PENDING` → `APPROVED` (`adjustmentType`: `PROPOSED` → `POSTED` \| `PASSED`) | Verifies `auditEngagements.companyId === companyId`. Marks `'POSTED'` **only** when balanced GL lines (`validJeLines.length >= 2`, `DR === CR > 0`) atomically create and link a `POSTED` `journalEntryId`; otherwise marks `'PASSED'` (summary schedule only). |
| **Payroll Run / Fixed Asset / Depreciation / Stock Adjustment** | Entity-specific workflow | Generic `POST /api/journey/action/:entityType/:entityId` rejects attempts to set `status = 'POSTED'` unless a valid linked `journalEntryId` already exists in the entity record (`journey.ts`). |
