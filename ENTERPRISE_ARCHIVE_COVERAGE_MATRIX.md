# LEDGERAI PH v1.0.0-rc.2 — ENTERPRISE ARCHIVE COVERAGE MATRIX

This document is the authoritative inventory and verification register for LedgerAI PH's enterprise-wide **6-State Record Lifecycle, Dedicated Module Archive Inboxes, Central System Archive Vault, Module-Aware Restoration Engine, and Independent 30-Day Backend Retention Scheduler**.

## Architectural Standard
> **Mandatory Rule**: No Archive Action Without a Working Dedicated Archive Inbox. Every archive-enabled 360° Journey, module, register, or business entity provides:
> 1. A **Dedicated Module Archive Inbox** (`ModuleArchiveInbox.tsx`) directly inside its module/register workspace,
> 2. Visibility in the **Central System Archive Vault & 30-Day Retention Center** (`/audit/archive-vault`, `ArchiveVaultWorkspace.tsx`),
> 3. A **Module-Aware Restoration Handler** (`ArchiveRetentionService.restoreArchivedRecord`) validating accounting/master-data rules and restoring exact pre-archive state, and
> 4. Protection by the **Independent Backend 30-Day Retention Scheduler** (`ArchiveRetentionScheduler`) enforcing 15-table referential dependency checks and BIR 10-year statutory retention (RR 17-2013 / RR 5-2014).

---

## 1. Complete 29-Entity Enterprise Archive Coverage Matrix

| # | Module | 360° Journey / Register | Entity Type | DB Table | Dedicated Module Archive Inbox UI | Restore Handler & Validation | Retention Protection Rule | Verification |
|---:|:---|:---|:---|:---|:---|:---|:---|:---|
| 1 | **6. Accounting & GL** | Chart of Accounts 360° | `ACCOUNT` | `accounts` | `Accounting.tsx` (`ModuleArchiveInbox` `['ACCOUNT']`) | Code-collision & parent check → `ACTIVE` | **BLOCKED** if referenced across 15 GL/subledger/master tables | **VERIFIED** |
| 2 | **6. Accounting & GL** | General Journal 360° | `JOURNAL_ENTRY` | `journal_entries` | `Journals.tsx` (`ModuleArchiveInbox` `['JOURNAL_ENTRY']`) | Pre-archive status restore | **EXEMPT** (BIR 10-yr) if `POSTED`/`APPROVED`/`REVERSED` | **VERIFIED** |
| 3 | **2. Sales & Receivables** | Sales Invoices 360° | `SALES_INVOICE` | `sales_invoices` | `SalesInvoicing.tsx` (`ModuleArchiveInbox` `['SALES_INVOICE','CUSTOMER_PAYMENT','CREDIT_MEMO']`) | Customer existence check + pre-archive status | **EXEMPT** (BIR 10-yr) if posted/approved/paid; atomic child purge for expired drafts | **VERIFIED** |
| 4 | **2. Sales & Receivables** | Collections & OR 360° | `CUSTOMER_PAYMENT` | `customer_payments` | `SalesInvoicing.tsx` (`ModuleArchiveInbox`) | Customer check + pre-archive status | **EXEMPT** (BIR 10-yr) if posted/approved | **VERIFIED** |
| 5 | **2. Sales & Receivables** | Credit Memos 360° | `CREDIT_MEMO` | `credit_memos` | `SalesInvoicing.tsx` (`ModuleArchiveInbox`) | Customer check + pre-archive status | **EXEMPT** (BIR 10-yr) if posted/approved | **VERIFIED** |
| 6 | **2. Sales & Receivables** | Customer Master 360° | `CUSTOMER` | `customers` | `CustomersList.tsx` (`ModuleArchiveInbox` `['CUSTOMER']`) | Restores to `ACTIVE` | **BLOCKED** if linked to invoices, receipts, or credit memos | **VERIFIED** |
| 7 | **3. Procurement & Payables** | Purchase Requisitions | `PURCHASE_REQUISITION` | `purchase_requisitions` | `ProcurementMatching.tsx` (`ModuleArchiveInbox` `['PURCHASE_REQUISITION','PURCHASE_ORDER','GOODS_RECEIPT_NOTE']`) | Pre-archive status restore | 30-day retention if unapproved draft; **EXEMPT** if approved | **VERIFIED** |
| 8 | **3. Procurement & Payables** | Purchase Orders 360° | `PURCHASE_ORDER` | `purchase_orders` | `ProcurementMatching.tsx` (`ModuleArchiveInbox`) | Vendor check + pre-archive status | **EXEMPT** if approved/received; atomic line purge for expired drafts | **VERIFIED** |
| 9 | **3. Procurement & Payables** | Goods Receipt Notes (GRN) | `GOODS_RECEIPT_NOTE` | `goods_receipt_notes` | `ProcurementMatching.tsx` (`ModuleArchiveInbox`) | Pre-archive status restore | **EXEMPT** if posted/approved | **VERIFIED** |
| 10 | **3. Procurement & Payables** | Purchase Bills 360° | `PURCHASE_BILL` | `purchase_bills` | `PurchaseBills.tsx` (`ModuleArchiveInbox` `['PURCHASE_BILL','SUPPLIER_PAYMENT','DEBIT_MEMO']`) | Vendor check + pre-archive status | **EXEMPT** (BIR 10-yr) if posted/approved/paid; atomic child purge for drafts | **VERIFIED** |
| 11 | **3. Procurement & Payables** | Supplier Payments / DV 360° | `SUPPLIER_PAYMENT` | `supplier_payments` | `PurchaseBills.tsx` (`ModuleArchiveInbox`) | Vendor check + pre-archive status | **EXEMPT** (BIR 10-yr) if posted/approved | **VERIFIED** |
| 12 | **3. Procurement & Payables** | Debit Memos 360° | `DEBIT_MEMO` | `debit_memos` | `PurchaseBills.tsx` (`ModuleArchiveInbox`) | Vendor check + pre-archive status | **EXEMPT** (BIR 10-yr) if posted/approved | **VERIFIED** |
| 13 | **3. Procurement & Payables** | Vendor Master 360° | `VENDOR` | `vendors` | `VendorsList.tsx` (`ModuleArchiveInbox` `['VENDOR']`) | Restores to `ACTIVE` | **BLOCKED** if linked to bills, payments, POs, or debit memos | **VERIFIED** |
| 14 | **4. Inventory & Warehouse** | Inventory Item 360° | `INVENTORY_ITEM` | `inventory_items` | `InventoryManagement.tsx` (`ModuleArchiveInbox` `['INVENTORY_ITEM','STOCK_ADJUSTMENT']`) | Restores to `ACTIVE` | **BLOCKED** if referenced by stock movements/adjustments | **VERIFIED** |
| 15 | **4. Inventory & Warehouse** | Stock Adjustments 360° | `STOCK_ADJUSTMENT` | `stock_adjustments` | `InventoryManagement.tsx` (`ModuleArchiveInbox`) | Pre-archive status restore | **EXEMPT** if posted to GL | **VERIFIED** |
| 16 | **5. Cash & Banking** | Cash Transactions 360° | `CASH_TRANSACTION` | `cash_transactions` | `Accounting.tsx` (`ModuleArchiveInbox` `['CASH_TRANSACTION','CHECK','BANK_DEPOSIT','CASH_COUNT']`) | Pre-archive status restore | **EXEMPT** (BIR 10-yr) if posted/approved | **VERIFIED** |
| 17 | **5. Cash & Banking** | Check Register 360° | `CHECK` | `checks` | `Accounting.tsx` (`ModuleArchiveInbox`) | Pre-archive status restore | **EXEMPT** if issued/cleared/posted | **VERIFIED** |
| 18 | **5. Cash & Banking** | Bank Deposits 360° | `BANK_DEPOSIT` | `bank_deposits` | `Accounting.tsx` (`ModuleArchiveInbox`) | Pre-archive status restore | **EXEMPT** if posted/approved | **VERIFIED** |
| 19 | **5. Cash & Banking** | Physical Cash Counts | `CASH_COUNT` | `cash_counts` | `Accounting.tsx` (`ModuleArchiveInbox`) | Pre-archive status restore | **EXEMPT** if approved/posted | **VERIFIED** |
| 20 | **5. Cash & Banking** | Bank Reconciliation 360° | `BANK_RECONCILIATION` | `bank_reconciliations` | `BankReconciliation.tsx` (`ModuleArchiveInbox` `['BANK_RECONCILIATION','BANK_ACCOUNT']`) | Pre-archive status restore | **EXEMPT** (BIR 10-yr) if approved/posted | **VERIFIED** |
| 21 | **5. Cash & Banking** | Bank Accounts Master | `BANK_ACCOUNT` | `bank_accounts` | `BankReconciliation.tsx` (`ModuleArchiveInbox` `['BANK_RECONCILIATION','BANK_ACCOUNT']`) | Linked GL account validation → `ACTIVE` | **BLOCKED** if linked to reconciliations or active GL transactions | **VERIFIED** |
| 22 | **7. Fixed Assets** | Fixed Asset Register 360° | `FIXED_ASSET` | `fixed_assets` | `FixedAssetsRegister.tsx` (`ModuleArchiveInbox` `['FIXED_ASSET']`) | Restores to `ACTIVE` | **BLOCKED** if depreciation schedules/postings exist | **VERIFIED** |
| 23 | **8. Payroll & HR** | Employee Master 360° | `EMPLOYEE` | `employees` | `PayrollCompensation.tsx` (`ModuleArchiveInbox` `['EMPLOYEE','PAYROLL_RUN']`) | Restores to `ACTIVE` | **BLOCKED** if payroll items exist | **VERIFIED** |
| 24 | **8. Payroll & HR** | Payroll Runs 360° | `PAYROLL_RUN` | `payroll_runs` | `PayrollCompensation.tsx` (`ModuleArchiveInbox`) | Pre-archive status restore | **EXEMPT** (BIR/DOLE statutory) if approved/posted | **VERIFIED** |
| 25 | **9. Tax & BIR Compliance** | BIR Tax Filings 360° | `TAX_FILING` | `tax_filings` | `Tax.tsx` (`ModuleArchiveInbox` `['TAX_FILING','TAX_CODE']`) | Pre-archive status restore | **EXEMPT** (BIR 10-yr) if filed/approved/posted | **VERIFIED** |
| 26 | **9. Tax & BIR Compliance** | BIR Tax Codes Master | `TAX_CODE` | `tax_codes` | `TaxCodesList.tsx` (`ModuleArchiveInbox` `['TAX_CODE']`) & `Tax.tsx` | Linked GL tax control account check → `ACTIVE` | **BLOCKED** if referenced by invoice/bill/cash lines | **VERIFIED** |
| 27 | **10. Budget & Planning** | Budget & Variance 360° | `BUDGET` | `budgets` | `BudgetPlanning.tsx` (`ModuleArchiveInbox` `['BUDGET']`) | Pre-archive status restore | **EXEMPT** if approved | **VERIFIED** |
| 28 | **11. Documents & OCR** | Document Vault 360° | `DOCUMENT` | `documents` | `Documents.tsx` (`ModuleArchiveInbox` `['DOCUMENT']`) | Pre-archive status restore | **EXEMPT** if linked to posted financial transaction | **VERIFIED** |
| 29 | **15. Audit & Governance** | Audit Engagements 360° | `AUDIT_ENGAGEMENT` | `audit_engagements` | `AuditEngagements.tsx` (`ModuleArchiveInbox` `['AUDIT_ENGAGEMENT']`) | Pre-archive status restore | **EXEMPT** if completed/signed-off (PSA working paper retention) | **VERIFIED** |

---

## 2. Authoritative 6-State Record Lifecycle Rules

1. **`ACTIVE`**: Default operational state. Fully visible in active registers and eligible in downstream COA/transaction selectors.
2. **`INACTIVE`**: Remains visible in master lists (sorted to bottom in COA), excluded from new transaction selectors, restorable via **Reactivate**.
3. **`REMOVED` (`REMOVED_FROM_LIST`)**: Hidden from active operational lists without deleting DB rows or breaking historical links; inspectable via status filter (`Removed from List` in COA) and restorable via **Restore to List** (`PATCH /api/master-data/accounts/:id/status`).
4. **`SOFT_DELETED`**: Excluded from operational workflows and selectors, discoverable via status filter (`Soft Deleted`), restorable via **Restore**.
5. **`ARCHIVED`**: Moved out of operational lists into both the entity's **Dedicated Module Archive Inbox** and the **Central System Archive Vault** (`/audit/archive-vault`).
   - Strictly read-only queries (`GET /api/system/archived-records`, `GET /api/master-data/accounts/archived`) — **zero destructive side effects during GET**.
   - Retains original record ID, pre-archive status, archive timestamp, actor, reason, retention state (`ACTIVE_RETENTION`, `ELIGIBLE_FOR_PURGE`, `BLOCKED`, `EXEMPT`), and dependency summary.
6. **`PERMANENTLY_DELETED`**: Executed transactionally (deleting child lines before parent row) **only** after passing full referential dependency inspection and BIR 10-year statutory retention rules. Attempts against `BLOCKED` or `EXEMPT` records return HTTP `403 RETENTION_POLICY_BLOCKED` and write an immutable audit trail event.

---

## 3. Independent Backend 30-Day Retention Scheduler (`ArchiveRetentionScheduler`)

- **Service**: `src/server/services/archiveRetentionService.ts` (`ArchiveRetentionService` + `ArchiveRetentionScheduler`).
- **Lifecycle**: Starts automatically in `src/server/app.ts` on server boot (when `!isTestRunner`), executes every 6 hours across all non-synthetic, non-`RECOVERY_READ_ONLY` companies with strict per-company DB isolation (`CompanyManager.getCompanyDb` + `dbContext.run`), concurrency locking (`inFlightCompanies`), transient `SQLITE_BUSY` retry, and graceful shutdown via `ArchiveRetentionScheduler.stopScheduler()` in `server.ts`.
- **Governance Endpoints**:
  - `GET /api/system/archived-records` — Pure read-only cross-module & entity-scoped archive listing with search, module, entityType, archivedBy, and retentionState filters.
  - `GET /api/system/archived-records/retention-status` — Live scheduler status and supported entity registry telemetry.
  - `POST /api/system/archived-records/run-retention-sweep` (`settings:manage`) — Authorized on-demand retention sweep (supports `dryRun: true/false`).
  - `PATCH /api/system/archived-records/:entityType/:id/restore` — RBAC-enforced module-aware restore preserving original ID and pre-archive state.
  - `DELETE /api/system/archived-records/:entityType/:id/permanent` (`settings:manage`) — Guarded permanent deletion with full dependency & BIR 10-year retention enforcement.
- **Automated Verification**: `tests/accounting/enterprise-archive-lifecycle-and-retention-scheduler.test.ts` (4/4 test groups passing — 29-entity coverage, 6-state COA lifecycle & selector exclusion, non-mutating reads, 15-table dependency blocking, BIR 10-year exemption, idempotent 30-day retention sweep, cross-tenant isolation, and truthful backup status).
