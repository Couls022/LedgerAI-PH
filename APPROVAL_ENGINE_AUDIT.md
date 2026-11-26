# LedgerAI PH — Approval Engine Audit

**Inspected Modules:** `src/server/routes/journey.ts`, `src/server/db/domain.ts`, `src/server/db/business_transactions.ts`, `src/client/pages/accounting/Journals.tsx`, `src/client/pages/Accounting.tsx`  

---

## 1. Architecture Overview

LedgerAI PH operates a **hybrid approval architecture** supporting both:
1. **Direct Entity Approvals** (`/api/accounting/<entity>/:id/approve`, `/reject`, `/submit`), used from module workspaces (`Journals.tsx`, `SalesInvoicing.tsx`, `PurchaseBills.tsx`, `Accounting.tsx`).
2. **Centralized Workflow Engine Approvals** (`/api/journey/approvals/initiate`, `/api/journey/approvals/:workflowId/decide`), backed by `approval_workflows` and `approval_steps` tables with sequential multi-level steps, parallel quorum rules, delegation/reassignment checks, and strict Segregation of Duties (SoD).

## 2. Findings & Gaps Identified

| ID | Component / Function | Audit Finding | Remediation Applied |
|---|---|---|---|
| **APP-01** | `domain.ts` (`approveJournalEntry`, `rejectJournalEntry`, `submitJournalEntry`) | Rejected `UNDER_REVIEW`/`REVIEWED` statuses when an approval workflow was active; blocked resubmission from `RETURNED`/`REJECTED`; did not update open `approval_workflows` rows on direct decision. | Expanded allowed transitions (`SUBMITTED`/`REVIEWED`/`UNDER_REVIEW` for decisions, `DRAFT`/`RETURNED`/`REJECTED`/`CORRECTION` for submit), added SoD check (`assertJournalApprovalSodAllowed`), and synchronized open `approval_workflows`/`approval_steps`. |
| **APP-02** | `business_transactions.ts` (All AR/AP/Cash/Deposit/Count helpers) | Same state-machine bottleneck as APP-01 across `SalesInvoice`, `CustomerPayment`, `PurchaseBill`, `SupplierPayment`, `DebitMemo`, `CashTransaction`, `BankDeposit`, and `CashCount`; `rejectCustomerPayment` did not exist. | Added shared `syncActiveWorkflowsOnDirectDecision(txRunner, companyId, entityType, entityId, decision, userId, reason)` helper across all entity approval/rejection functions; implemented `rejectCustomerPayment` and mounted `POST /customer-payments/:id/reject`. |
| **APP-03** | `journey.ts` (`POST /approvals/:workflowId/decide`) | Workflow decision engine did not always bump entity `version` or guard column-safe updates across differing schemas; allowed `BANK_RECONCILIATION` approval through generic workflow without running live metric recalculation. | Added column-safe entity `version` bump and mandatory `recalculateBankReconciliationMetrics` variance=0 + evidence validation for `BANK_RECONCILIATION`. |
| **APP-04** | `Journals.tsx` & `Accounting.tsx` | UI Approve/Reject action buttons checked strictly `status === 'SUBMITTED'` and Submit checked strictly `status === 'DRAFT'`, hiding valid controls on `UNDER_REVIEW`, `REVIEWED`, `RETURNED`, and `REJECTED` records. | Updated button visibility conditions to support `['SUBMITTED', 'REVIEWED', 'UNDER_REVIEW']` for Approve/Reject and `['DRAFT', 'RETURNED', 'REJECTED', 'CORRECTION']` for Submit/Resubmit. |
| **APP-05** | Concurrency & Process Crash Safety | Concurrent double-approval on a single record or cross-process worker approvals must fail deterministically (`409 CONCURRENT_MODIFICATION_CONFLICT`). | Verified optimistic `version` `WHERE` clause checks in `submit*`/`approve*`/`post*` plus SQLite `BEGIN IMMEDIATE` multi-process concurrency in `tests/integration/final-hardening-approval-concurrency.test.ts` (8/8 passed) and `erp-full-workflow-regression-and-stress.test.ts` (passed). |

## 3. Verification Proof

- `tests/integration/approval-inbox-and-workflows.test.ts`: **22/22 passed** (`task-20550`).
- `tests/integration/final-hardening-approval-concurrency.test.ts`: **8/8 passed** including cross-process SQLite `BEGIN IMMEDIATE` contention and `SIGKILL` WAL crash recovery (`task-20592`).
- `tests/integration/erp-full-workflow-regression-and-stress.test.ts`: Test #1 verified `UNDER_REVIEW` direct approval, `CUSTOMER_PAYMENT` reject -> resubmit -> approve -> post, and concurrent double-approval rejection (`task-20680`).
