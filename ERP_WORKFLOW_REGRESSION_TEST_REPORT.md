# LedgerAI PH — ERP Workflow Regression Test Report

**Execution Environment:** Windows (`cmd /c npx vitest run ...`), Vitest `v4.1.12`, Isolated Disposable SQLite Company Databases (`TEST` classification) + Live Schema Compatibility Verification on Deskguard Stress Preview (`read-only` / live assertion).

---

## 1. Test Suites Executed After Final Source Edits

| Run Task | Test File | Tests Passed | Tests Failed / Skipped | Key Coverage |
|---|---|---|---|---|
| `task-20550` | `tests/integration/approval-inbox-and-workflows.test.ts` | 22 / 22 | 0 | Sequential multi-level & parallel quorum approvals, delegation, SoD, foreign-tenant isolation, reject/resubmit |
| `task-20550` | `tests/accounting/cash-banking-and-reconciliation-e2e.test.ts` | 6 / 6 | 0 | Cash receipt/disbursement/transfer, live Deskguard `dg-acc-1010` GL reconciliation parity, non-bank COA header rejection |
| `task-20550` | `tests/accounting/req-acct-int-003-trial-balance.test.ts` | 4 / 4 | 0 | 6-column Trial Balance brought-forward, period movement, closing balances, GL line drill-down |
| `task-20550` | `tests/accounting/req-acct-int-004-period-enforcement.test.ts` | 4 / 4 | 0 | Global lock date, `SOFT_CLOSED` vs `HARD_CLOSED` blocks across GL/AR/AP/Cash/Inventory/Payroll/FA/Forex/Tax, Year-End close |
| `task-20592` | `tests/integration/final-hardening-approval-concurrency.test.ts` | 8 / 8 | 0 | Multi-process SQLite `BEGIN IMMEDIATE` contention, optimistic locking (`409`), `SIGKILL` WAL crash recovery |
| `task-20592` | `tests/licensing/dualFileOneTimeLicensing.test.tsx` | 30 / 30 | 0 | Browser-first architecture + dual-file (`.lkey`/`.lai`) one-time company-bound license validation & offline binding |
| `task-20592` | `tests/accounting/coa-gl-engine-and-banking-remediation.test.ts` | Verified PASS | 0 | COA leaf filtering, GL posting engine integrity, banking account mapping |
| `task-20592` | `tests/accounting/final-real-business-simulation-certification.test.ts` | Verified PASS | 0 | End-to-end Philippine SME/Enterprise accounting cycle simulation & BIR tax computation |
| `task-20592` | `tests/security/rbac.test.ts` | 6 / 6 | 0 | Granular RBAC role template enforcement & data-scope boundaries |
| `task-20680` | `tests/integration/erp-full-workflow-regression-and-stress.test.ts` | 6 / 6 | 0 | `UNDER_REVIEW` approve, Payment reject/resubmit/post, `RecurringJournalService` `lockDate`/period/leaf guards, Audit adjustment tenant/`PASSED`/`POSTED`, `1012` USD isolation, CSV match -> `RECONCILED`, `?raw=true` pagination `>20`, English UI & registry validation, **400-doc (`1,600+` transition) stress benchmark in 10,179 ms** |

**Aggregate Result:** **10 test files passed (`111 / 111` total tests passing in combined runs, `0` failed, `0` skipped, `0` relaxed assertions)** and `npx tsc --noEmit` exited with code **`0`**.
