# LedgerAI PH - Report Engine Architecture

## 1. Overview
The Report Engine generates real-time financial and tax reports dynamically by querying the deterministic Accounting and Tax engines. It does not rely on cached or "snapshot" tables unless explicitly designed for locked, closed periods.

## 2. Core Financial Statements
- **Trial Balance**: Aggregates all account balances for a given period.
- **General Ledger**: Details all transactions for specific accounts.
- **Statement of Financial Position (Balance Sheet)**: Assets, Liabilities, and Equity as of a specific date.
- **Statement of Comprehensive Income (Income Statement)**: Revenue and Expenses over a period.
- **Cash Flow Statement**: Derived from cash-related transactions.

## 3. BIR Tax Reports
- **VAT Summary**: Aggregates Input and Output VAT for 2550M/2550Q filing preparation.
- **Withholding Tax Summary**: Aggregates EWT/CWT for 1601-EQ/1604-E preparation.
- **Books of Accounts**: Formatted specifically for BIR audit requirements (General Journal, Cash Receipts Book, etc.).

## 4. Export Capabilities
All reports can be exported to:
- CSV (for spreadsheet analysis)
- PDF (for official documentation, generated locally without external services)
- Excel (XLSX)

## 5. Security
Report generation enforces `company_id` isolation and requires explicit `reports.view` or `reports.export` permissions.
