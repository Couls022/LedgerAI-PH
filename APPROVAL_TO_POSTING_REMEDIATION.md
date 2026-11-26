# LedgerAI PH — Approval-to-Posting Remediation Summary

## 1. End-to-End Flow Unification

Prior to remediation, users encountered silent disconnects between submitting/approving a document in either the module list view or the centralized Approval Inbox and subsequently posting it to the General Ledger:

1. Initiating an approval workflow placed the record into `UNDER_REVIEW` (or `REVIEWED` after partial levels), causing module-level **Approve / Reject** buttons and direct endpoints to return validation errors (`Only SUBMITTED ... can be approved`).
2. Approving via a direct endpoint updated only the transaction table, leaving `approval_workflows` / `approval_steps` dangling in `PENDING`/`IN_PROGRESS` inside the Approval Inbox.
3. Rejecting or returning a transaction placed it into `REJECTED` or `RETURNED`, which `submit*` functions refused to accept on resubmission.
4. Double-clicking or retrying `postPurchaseBill` or `postCashCount` risked non-atomic partial state or version skew.

## 2. Key Code Changes Implemented

| File | Symbol / Endpoint Updated | Remediation Behavior |
|---|---|---|
| `src/server/db/domain.ts` | `submitJournalEntry`, `approveJournalEntry`, `rejectJournalEntry` | Accept `DRAFT`/`RETURNED`/`REJECTED`/`CORRECTION` on submit; accept `SUBMITTED`/`REVIEWED`/`UNDER_REVIEW` on approve/reject; sync open `approval_workflows` & `approval_steps`. |
| `src/server/db/business_transactions.ts` | `syncActiveWorkflowsOnDirectDecision` (new), `submit*`, `approve*`, `reject*`, `postSalesInvoice`, `postPurchaseBill`, `postCashCount` | Unified resubmit & approval states across Sales Invoices, Customer Payments, Purchase Bills, Supplier Payments, Debit Memos, Cash Transactions, Bank Deposits, and Cash Counts; fixed `bankDeposits` update to omit non-existent `.version` column; added `rejectCustomerPayment`; made `postPurchaseBill` idempotent when `POSTED && journalEntryId`; wrapped `postCashCount` cleanly inside a single `db.transaction` with `assertNoDuplicateSourceJournal`. |
| `src/server/routes/accounting.ts` | `POST /customer-payments/:id/reject` | Exposed REST rejection route returning payment to `DRAFT` and closing open approval workflow steps. |
| `src/server/routes/journey.ts` | `POST /approvals/:workflowId/decide`, `POST /action/:entityType/:entityId` | Added `version` increment, live bank rec variance validation on `APPROVE`, routed `BANK_RECONCILIATION` through `approveBankReconciliation`, and blocked generic `POST` on non-GL-backed modules. |
| `src/server/routes/auditAdvanced.ts` | `POST /adjustments/:id/approve` | Enforced tenant check on `auditEngagements.companyId`, atomic balanced JE creation when GL lines are supplied, and `'PASSED'` fallback for non-GL schedules. |
| `src/client/pages/accounting/Journals.tsx`, `src/client/pages/Accounting.tsx` | Row workflow action controls | Rendered Approve/Reject on `SUBMITTED`/`REVIEWED`/`UNDER_REVIEW` and Submit/Resubmit on `DRAFT`/`RETURNED`/`REJECTED`. |

## 3. Regression Validation

All remediation paths were exercised and confirmed via `tests/integration/approval-inbox-and-workflows.test.ts` (22 tests) and `tests/integration/erp-full-workflow-regression-and-stress.test.ts` (Test #1 & Test #6 across 400 posted operational documents).
