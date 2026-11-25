# LedgerAI PH — Report Engine & Financial Analytics Architecture (`v1.0.0-rc.2`)

## 1. Authoritative Single Source of Financial Truth (`FinancialSourceOfTruthService`)
LedgerAI PH computes **zero fabricated fallbacks**. All Dashboard KPIs, Executive Rollups, Financial Statements, Subledger Aging Schedules, and BIR Tax Reports query the active company's isolated SQLite database (`PRAGMA journal_mode=WAL`) using exact integer-centavo arithmetic:
- **Posted-Only General Ledger Inclusion**: Reports aggregate `journal_lines` joined exclusively to `journal_entries` where `status = 'POSTED'` and excluding entries superseded by a formal reversal (`NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.original_journal_id = journal_entries.id AND r.status = 'POSTED')`). Draft, Submitted, Rejected, and Cancelled entries are excluded from official GL totals.
- **Zero-Data Clean Start**: Newly initialized company databases with `0` posted transactions report genuine `₱0.00` balances, `NO_RECORDS` Trial Balance state (never falsely hardcoded as `"Balanced"` without accounts/postings), and empty chart series.
- **Metric Provenance (`kpiMeta`)**: `/api/dashboard/overview` emits structured `FinancialMetricContract` metadata per KPI documenting source table, GL control-account code(s), and subledger-to-GL reconciliation status.

---

## 2. Core Financial Statements & Exact Data Sources

| Statement / Report | Primary Route / Endpoint | Authoritative Data Collection Source |
|---|---|---|
| **Trial Balance** | `/#/reports/trial-balance`, `/api/accounting/reports/trial-balance` | Posted `journal_lines` aggregated by `accounts` (`account_code`, `normal_balance`); dynamically flags `OK`, `NO_RECORDS`, or `IMBALANCED` if `SUM(debit) !== SUM(credit)`. |
| **General Ledger Detail & General Journal** | `/#/accounting/journals`, `/api/accounting/journals` | Authoritative `journal_entries` + `journal_lines` + linked source entity (`sales_invoice`, `purchase_bill`, `cash_transaction`, `payroll_run`, `depreciation`, `bank_reconciliation`). |
| **Statement of Financial Position (Balance Sheet)** | `/#/reports`, `/api/accounting/reports/balance-sheet` | Cumulative posted balances for Asset (`1000`), Liability (`2000`), and Equity (`3000`) COA classifications as of `asOfDate`, including current-period Net Income into Equity so `Assets === Liabilities + Equity`. |
| **Statement of Comprehensive Income (Income Statement / P&L)** | `/#/reports`, `/api/accounting/reports/income-statement` | Posted `journal_lines` over `[startDate, endDate]` across Revenue (`4000`), Cost of Goods Sold (`5000`), and Operating Expenses (`6000–8000`). |
| **Statement of Cash Flows** | `/#/reports`, `/api/accounting/reports/cash-flow` | Net cash movements across COA cash/bank accounts (`is_cash_account = 1` / `bank_accounts.gl_account_id`) classified by Operating, Investing (`fixed_assets`), and Financing activities. |
| **Statement of Changes in Equity** | `/#/reports` | Opening equity, capital contributions, dividends/drawings, and posted Net Income. |
| **Accounts Receivable (AR) & Payable (AP) Aging** | `/#/reports`, `/#/accounting/sales-invoicing`, `/#/accounting/purchase-bills` | Open `sales_invoices` / `purchase_bills` (`total_amount - COALESCE(amount_paid, 0) > 0`, excluding `CANCELLED`/`REVERSED`) bucketed (`Current`, `1–30`, `31–60`, `61–90`, `90+`) using Philippine Standard Time (**PHT GMT+8**) cutoffs and reconciled to COA AR (`1030`/`1110`) and AP (`2010`/`2110`) control accounts. |
| **Dashboard Cash & Operations Rollups** | `/#/`, `/api/dashboard/overview`, `/api/operations/summary` | Posted COA cash/bank balances (`is_cash_account = 1` + linked `bank_accounts`), active subledgers (`sales_invoices`, `purchase_bills`, `inventory_items`, `fixed_assets`, `payroll_runs`), and `Pending Approvals` workflow counts. |

---

## 3. Philippine BIR Tax & Statutory Reports
All BIR schedules derive strictly from stored company tax regime (`vat_status`, `vat_filing_frequency` in `system_settings`, `tax_codes`, `tax_calculations`, `supplier_payments`, and posted GL tax accounts):
- **VAT Summary (`BIR Form 2550Q` Default / Optional `2550M`)**: Queries `sales_invoices` (respecting `VAT12` vs `VAT0` vs `VATEX`), `purchase_bills`, and GL Output/Input VAT lines (`2020`/`2120`, `1150`/`1160`) exclusively for `VAT_REGISTERED` entities (returns `₱0.00` VAT for Non-VAT / 8% Flat companies).
- **Percentage Tax (`BIR Form 2551Q`)**: Queries Non-VAT gross receipts applying date-sensitive CREATE Act Sec. 116 rates (`1%` July 1, 2020–June 30, 2023; `3%` outside that window).
- **Expanded Withholding Tax (`0619-E` / `1601-EQ` / `2307` / `QAP`) & CWT (`SAWT`)**: Derived from stored ATC codes, `supplier_payments.withholding_tax_amount`, `tax_calculations`, and `2120`/`2130` GL tax accounts — zero blanket `2/112` approximations.
- **Compensation Tax & Payroll (`1601-C` / `2316` / SSS / PHIC / HDMF)**: Derived from approved/posted `payroll_runs` and `payroll_items`.
- **BIR Computerized Books of Accounts (`RMC No. 5-2021` / `RMC No. 65-2025`)**: General Journal, General Ledger, Sales Journal, Purchase Journal, Cash Receipts Book, Cash Disbursements Book, AR/AP Subsidiary Ledgers, and Inventory Book.

---

## 4. Local Offline Export Capabilities
Every financial report and BIR schedule exports cleanly offline with zero external cloud dependencies:
- **PDF** (local deterministic print/PDF rendering), **CSV**, and **XLSX** (Excel workbook), honoring RBAC `reports:export`, `tax:export`, or `audit:export` and blocking unauthorized client fallback when HTTP `401`/`403` is returned.

---

## 5. Security, Auditability & Data Governance
- Strict per-company SQLite isolation (`company_id`) and RBAC enforcement (`reports:view`, `reports:export`, `tax:view`, `accounting:view`).
- Every export and statement inspection supports 360° drill-down (`/api/audit-journey/:entityType/:entityId`) to underlying vouchers, `LAISDOC1` documents, and HMAC-sealed `audit_logs`.

