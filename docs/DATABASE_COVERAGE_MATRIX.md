# LEDGERAI PH — DATABASE COVERAGE FORENSICS

Total Database Tables: 97 SQLite tables defined in `src/server/db/schema.ts`.

### Table Group Inventory & Tenant Scoping:

1. **Company & Security Tables (12 tables)**:
   - `companies`, `company_licenses`, `users`, `roles`, `permissions`, `role_permissions`, `company_users`, `company_user_roles`, `user_permission_overrides`, `sod_restrictions`, `sessions`, `authority_users`.
   - *Tenant Scoping*: All tenant-level user assignments reference `company_id`. System roles are global reference catalogs.

2. **Accounting Core & General Ledger (18 tables)**:
   - `accounts`, `accounting_periods`, `period_status_history`, `journal_entries`, `journal_lines`, `sales_invoices`, `sales_invoice_lines`, `purchase_bills`, `purchase_bill_lines`, `supplier_payments`, `supplier_payment_applications`, `customer_payments`, `customer_payment_applications`, `credit_memos`, `credit_memo_lines`, `debit_memos`, `debit_memo_lines`, `budgets`.
   - *Tenant Scoping*: Strict `company_id` foreign key. Debits == Credits balance invariant enforced.

3. **Philippine Tax Compliance (9 tables)**:
   - `company_tax_profiles`, `tax_rule_definitions`, `tax_rule_versions`, `tax_codes`, `tax_calculations`, `tax_filings`, `tax_filing_checklists`, `tax_manual_adjustments`, `tax_calendar`.
   - *Tenant Scoping*: Strict `company_id` partition. Date-aware statutory tax versioning.

4. **Master Data & Operational Subsystems (26 tables)**:
   - `vendors`, `customers`, `banks`, `departments`, `projects`, `cost_centers`, `locations`, `payment_methods`, `currency_exchange_rates`, `inventory_items`, `inventory_transactions`, `stock_adjustments`, `employees`, `payroll_runs`, `payroll_items`, `fixed_assets`, `depreciation_schedules`, `purchase_orders`, `goods_receipt_notes`, `cash_transactions`, `checks`, `bank_deposits`, `cash_counts`.
   - *Tenant Scoping*: 100% `company_id` bound.

5. **Audit, Document Vault & Platform Integrity (32 tables)**:
   - `audit_logs`, `audit_engagements`, `audit_planning_docs`, `audit_workpapers`, `audit_findings`, `audit_adjustments`, `internal_controls_log`, `fraud_flags`, `documents`, `company_documents`, `system_backups`, `license_audit_logs`, `record_locks`, `lan_server_sessions`, `approval_workflow_requests`.
   - *Tenant Scoping*: 100% `company_id` bound.

---

### Integrity & Deletion Rules
- **Orphan Records**: Cascade delete or restrict constraints configured on child detail lines.
- **Audit Immutability**: `audit_logs`, `period_status_history`, and `journal_entries` do not allow destructive hard deletes in production.
