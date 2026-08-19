# LedgerAI PH - Philippine Accounting Engine

## 1. Core Principles
The LedgerAI PH Accounting Engine is a strict, deterministic double-entry system. It serves as the absolute source of truth for all financial data in the system.

## 2. Double-Entry Enforcement
- **Fundamental Rule**: Total Debits MUST EXACTLY EQUAL Total Credits for every Journal Entry.
- **Validation**: Unbalanced entries are rejected at the database and service layer. They cannot be saved as "Posted".
- **Immutability**: Once a Journal Entry is posted, its lines CANNOT be edited or deleted. Corrections require explicit Reversals or Adjusting Entries.

## 3. Chart of Accounts (COA)
Configurable to align with Philippine accounting practices (e.g., specific classifications for Input/Output VAT, Expanded Withholding Tax Payable, Creditable Withholding Tax).
- **Structure**: Hierarchical (Parent/Child accounts).
- **Types**: Asset, Liability, Equity, Revenue, Cost of Sales, Expense, Other Income, Other Expense.

## 4. Ledgers
- **General Ledger**: The central repository of all posted transactions, aggregated by account.
- **Subsidiary Ledgers**: Detailed tracking for specific entities (Accounts Receivable by Customer, Accounts Payable by Vendor, Inventory, Fixed Assets). Subsidiary ledgers must always reconcile with their General Ledger control accounts.

## 5. Accounting Periods
- Transactions are locked to specific Accounting Periods and Fiscal Years.
- Closed periods cannot accept new journal entries unless explicitly reopened by an authorized Super Admin/Company Admin (and this action is audited).
