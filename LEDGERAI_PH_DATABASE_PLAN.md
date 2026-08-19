# LedgerAI PH - Database Plan

## 1. Engine
*   **Database**: SQLite (via `better-sqlite3` or `libsql`)
*   **ORM**: Drizzle ORM
*   **Reasoning**: Perfect for zero-config, embedded, standalone deployments while maintaining strict relational integrity, transactions, and foreign keys.

## 2. Multi-Tenant Isolation Strategy
*   Every table belonging to a company MUST have a `company_id` column.
*   Database queries in the application layer will be wrapped in a repository pattern that automatically injects `WHERE company_id = ?` based on the authenticated session.
*   Foreign keys will composite `(id, company_id)` where necessary to prevent cross-company references.

## 3. Core Schema Domains

### System & Auth
*   `users`: id, email, password_hash, created_at, active
*   `companies`: id, name, tin, address, created_at, active
*   `company_users`: user_id, company_id, role (Admin, Accountant, Viewer)
*   `audit_logs`: id, user_id, company_id, action, entity_type, entity_id, before_state, after_state, timestamp

### Accounting Engine
*   `accounts` (COA): id, company_id, code, name, type (Asset, Liability, Equity, Revenue, Expense), parent_id
*   `accounting_periods`: id, company_id, start_date, end_date, status (Open, Closed)
*   `journal_entries`: id, company_id, reference, date, description, status (Draft, Posted, Reversed), created_by
*   `journal_lines`: id, journal_id, company_id, account_id, debit, credit, subsidiary_id

### Tax & Compliance
*   `tax_rules`: id, company_id, name, type (VAT, WHT, etc.), rate, active
*   `tax_records`: id, company_id, journal_id, tax_rule_id, base_amount, tax_amount
*   `compliance_findings`: id, company_id, entity_type, entity_id, severity, description, status

### Documents & Subsidiary
*   `contacts` (Customers/Vendors): id, company_id, name, type, tin
*   `documents`: id, company_id, file_path, original_name, uploaded_by, entity_type, entity_id
*   `invoices`: id, company_id, contact_id, invoice_number, date, due_date, total_amount, status

## 4. Integrity Constraints
*   Strict Foreign Keys (`PRAGMA foreign_keys = ON`).
*   Check constraints on `journal_lines` (e.g., `debit >= 0`, `credit >= 0`).
*   Application-level transaction blocks to ensure `SUM(debit) == SUM(credit)` before committing a journal entry.
