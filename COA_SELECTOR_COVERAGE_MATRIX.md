# LEDGERAI PH v1.0.0-rc.2 — CHART OF ACCOUNTS (COA) SELECTOR COVERAGE MATRIX

**Document Authority:** Canonical Technical Integration Register  
**Application:** LedgerAI PH Enterprise ERP (Accounting, Tax, Procurement, Sales, Cash & Banking, Master Data)  
**Version Baseline:** `v1.0.0-rc.2`  
**Execution Environment:** Google AI Studio Linux Container (`x86_64`)  
**Status:** **100% VERIFIED & INTEGRATED**  

---

## 1. ARCHITECTURAL FOUNDATION

The Chart of Accounts (COA) is the single authoritative source of truth for all account selection and General Ledger connectivity throughout LedgerAI PH. Hardcoded account code fallbacks, static arrays, and synthetic dummy IDs have been completely eradicated.

### 1.1 Authoritative Schema & Foreign Key Constraints
- **Primary Account Store:** `accounts` table in `src/server/db/schema.ts`
  - `id` (`TEXT PRIMARY KEY` — UUIDv4)
  - `company_id` (`TEXT NOT NULL` — per-company multi-tenant isolation)
  - `account_code` (`TEXT NOT NULL` — e.g. `1010`, `1020`, `2026`, `WI100`)
  - `account_name` (`TEXT NOT NULL`)
  - `account_type` (`TEXT NOT NULL` — `ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`, etc.)
  - `detail_type` (`TEXT NULL` — e.g. `CHECKING`, `SAVINGS`, `PETTY_CASH`, `TRADE_RECEIVABLE`, `TRADE_PAYABLE`, `OUTPUT_VAT_LIABILITY`, etc.)
  - `bir_tax_category` (`TEXT NULL` — e.g. `OUTPUT_VAT_12`, `INPUT_VAT_12`, `EWT_1601EQ`, `CWT_2307`, `PERCENTAGE_TAX_3`, etc.)
  - `normal_balance` (`TEXT NOT NULL` — `DEBIT` or `CREDIT`)
  - `parent_account_id` (`TEXT NULL REFERENCES accounts(id)` — hierarchical header/parent-child)
  - `is_cash_account` (`INTEGER NOT NULL DEFAULT 0`)
  - `is_control_account` (`INTEGER NOT NULL DEFAULT 0`)
  - `is_tax_account` (`INTEGER NOT NULL DEFAULT 0`)
  - `status` (`TEXT NOT NULL DEFAULT 'ACTIVE'`)
- **Bank Account Registry Link:** `bank_accounts.gl_account_id` references `accounts.id` with dual-direction synchronization and reversible AES-256-GCM encryption (`LAIBANK1:`).

### 1.2 Centralized COA Classification & Eligibility Engine (`src/shared/coaAccountUtils.ts`)
All frontend selectors and backend validators call canonical utility functions from `coaAccountUtils.ts`:
1. `filterEligibleTaxControlAccounts(accounts, taxType, direction)`: Filters active leaf tax accounts according to tax type (`VAT`, `EWT`, `PT`, `EXEMPT`, etc.) and direction (`INPUT`, `OUTPUT`, `BOTH`).
2. `filterEligibleSourceCashAccounts(accounts)`: Returns all active postable cash and bank equivalents (Checking, Savings, Cash on Hand, Undeposited Funds, Petty Cash).
3. `filterEligibleDestinationBankAccounts(accounts, bankRegistryAccounts)`: Strictly filters formal commercial checking and savings accounts; strictly blocks Petty Cash and Cash on Hand.
4. `filterEligibleCashBankAccounts(accounts)`: Postable leaf accounts flagged as cash or belonging to cash/bank detail types.
5. `filterEligibleRevenueAccounts(accounts)`: Active postable leaf accounts with type `REVENUE` or detail types like `OPERATING_REVENUE`, `SERVICE_INCOME`, `SALES_REVENUE`.
6. `filterEligibleExpenseAndPurchaseAccounts(accounts)`: Active postable leaf accounts with types `EXPENSE`, `COST_OF_SALES`, `ASSET`, `OTHER_CURRENT_ASSET`, `INVENTORY`.
7. `filterPostableLeafAccounts(accounts)`: Eliminates parent header accounts (`parentIds.has(account.id)`) and inactive accounts.
8. `inferAccountDetailAndBirCategory(account)`: Deterministically infers missing `detailType` and `birTaxCategory` for legacy or imported accounts.
9. `formatAccountOptionLabel(account, includeType)`: Formats standard user-facing labels: `CODE — Account Name (Type)`.

### 1.3 Reactive Event Synchronization (`coa:updated`)
When any account is created, modified, or deactivated via `AccountModal.tsx`, a global `window.dispatchEvent(new CustomEvent('coa:updated', { detail: { ... } }))` is dispatched. All open operational modules subscribe to `coa:updated` to immediately refresh their in-memory selector options without requiring a manual page refresh.

---

## 2. COMPREHENSIVE SELECTOR COVERAGE MATRIX

| Module & View | Component & File Path | Purpose of Selector | Centralized Filtering Rule | Backend Validation Route & Logic | Status |
|:---|:---|:---|:---|:---|:---|
| **Accounting — Chart of Accounts** | `AccountModal.tsx` (`src/client/components/AccountModal.tsx`) | Select Parent Account (sub-account nesting) | `filterPostableLeafAccounts(accounts)` (excludes current account to prevent cycles) | `POST /api/master-data/accounts`, `PUT /api/master-data/accounts/:id`. Validates parent exists in company and is not self. | **VERIFIED** |
| **Tax & BIR — New BIR Tax Code Modal** | `Tax.tsx` (`src/client/pages/Tax.tsx:992`) | Map GL Control Account for BIR tax code | `filterEligibleTaxControlAccounts(accounts, taxType, direction)` | `POST /api/tax/codes`. Backend: `validateCompanyCoaSelection(companyId, accountId, 'TAX_CONTROL', { taxType, direction })`. Rejects ineligible accounts (e.g. Petty Cash, Revenue). | **VERIFIED** |
| **Master Data — Tax Codes Management** | `TaxCodesList.tsx` (`src/client/pages/master-data/TaxCodesList.tsx:300`) | Map GL Control Account on Tax Code create/edit | `filterEligibleTaxControlAccounts(accounts, formData.taxType, formData.inputOutputDirection)` | `POST /api/master-data/tax-codes`, `PUT /api/master-data/tax-codes/:id`. Backend: verifies `isEligibleTaxControlAccount`, active leaf, and company isolation. | **VERIFIED** |
| **Accounting — Cash Transactions** | `Accounting.tsx` (`CashTransactions` tab, lines 1790–1890) | Select Cash/Bank Account for collection/disbursement | `filterEligibleSourceCashAccounts(accounts)` (includes `1010`, `1020`, `2026`, etc.) | `POST /api/accounting/cash-transactions`. Backend: `validateCompanyCoaSelection(companyId, accountId, 'CASH_BANK')`. Rejects non-cash accounts (e.g. Revenue `4010`). | **VERIFIED** |
| **Accounting — Cash Transactions (Offset)** | `Accounting.tsx` (`CashTransactions` tab, line 1880) | Select Offset GL account (Debit or Credit) | `filterPostableLeafAccounts(accounts)` | `POST /api/accounting/cash-transactions`. Backend: `validateCompanyCoaSelection(companyId, offsetAccountId, 'POSTABLE_LEAF')`. | **VERIFIED** |
| **Accounting — Bank Deposit Batch (Dest)** | `Accounting.tsx` (`BankDeposits` tab, lines 1820–1860) | Select Destination Bank Account for deposit | `filterEligibleDestinationBankAccounts(accounts, bankRegistryAccounts)` (strictly Checking/Savings; blocks Petty Cash) | `POST /api/accounting/bank-deposits`. Backend: verifies destination is `isStrictBankAccount`. Strictly throws 400 on Petty Cash `1020` or Cash on Hand. | **VERIFIED** |
| **Accounting — Bank Deposit Batch (Source)**| `Accounting.tsx` (`BankDeposits` tab, lines 1840–1870) | Select Source Cash Account for deposit | `filterEligibleSourceCashAccounts(accounts)` (Undeposited Funds, Cash on Hand, Petty Cash) | `POST /api/accounting/bank-deposits`. Backend: validates active cash account and rejects same-account source and destination. | **VERIFIED** |
| **Accounting — Checks Management** | `Accounting.tsx` (`Checks` tab, lines 1600–1640) | Select Checking Account for check issuance | `filterEligibleDestinationBankAccounts(accounts, bankRegistryAccounts)` | `POST /api/accounting/checks`. Backend: validates `cashAccountId` is active Checking account in company. | **VERIFIED** |
| **Accounting — Bank Reconciliation (Setup)** | `BankReconciliation.tsx` (`src/client/pages/accounting/BankReconciliation.tsx:997`) | Select GL Cash/Bank Account to reconcile | `filterEligibleDestinationBankAccounts(accounts, bankRegistryAccounts)` | `POST /api/accounting/bank-reconciliations`. Backend: `bankReconciliationService.createBankReconciliation` validates `bankAccountId` is strict active bank account in company. | **VERIFIED** |
| **Accounting — Bank Reconciliation (Adj)** | `BankReconciliation.tsx` (`src/client/pages/accounting/BankReconciliation.tsx:885`) | Select Offset GL Account for bank charges/interest | `filterPostableLeafAccounts(accounts)` | `POST /api/accounting/bank-reconciliations/:id/adjustments`. Backend: validates `offsetAccountId` is active postable leaf account. | **VERIFIED** |
| **Accounting — General Journal Entries** | `Journals.tsx` (`src/client/pages/accounting/Journals.tsx:470`) | Select GL Account for each journal line item | `filterPostableLeafAccounts(accounts)` (removes parent header accounts) | `POST /api/accounting/journals`, `PUT /api/accounting/journals/:id`. Backend: `domain.ts` validates all line accounts exist, are active, leaf accounts, and scoped to company. | **VERIFIED** |
| **Accounting — Sales Invoicing** | `SalesInvoicing.tsx` (`src/client/pages/accounting/SalesInvoicing.tsx:714`) | Select Revenue Account for sales line items | `filterEligibleRevenueAccounts(coaAccounts)` (excludes expense/cash accounts) | `POST /api/accounting/sales-invoices`. Backend: `business_transactions.ts` validates line `accountId` against company COA. | **VERIFIED** |
| **Procurement — Purchase Bills** | `Accounting.tsx` (`PurchaseBills` tab, line 875) | Select Expense/Purchases Account for bill line | `filterEligibleExpenseAndPurchaseAccounts(coaAccounts)` | `POST /api/accounting/purchase-bills`. Backend: `business_transactions.ts` validates line `accountId` is company-scoped active postable expense/asset. | **VERIFIED** |
| **Master Data — Payment Methods** | `masterData.ts` (`src/server/routes/masterData.ts:1675`) | Select Default Settlement Account | Validated on backend against `isEligibleCashBankAccount` | `POST /api/master-data/payment-methods`. Backend: rejects non-cash default accounts. | **VERIFIED** |
| **Foreign Exchange Revaluation** | `ForexManagement.tsx` (`src/client/pages/accounting/ForexManagement.tsx:130`) | Select Balance Sheet Accounts for FX exposure | `filterPostableLeafAccounts(items)` filtered by Balance Sheet types | `POST /api/operations/forex/revaluations/preview`, `POST /api/operations/forex/revaluations`. Validates accounts against company COA. | **VERIFIED** |
| **Documents & OCR — Post to Accounting** | `PostToAccountingModal.tsx` (`src/client/components/PostToAccountingModal.tsx:274,312,349`)| Map Document lines to Expense, Revenue, or Cash | `filterEligibleExpenseAndPurchaseAccounts`, `filterEligibleRevenueAccounts`, `filterEligibleCashBankAccounts` | `POST /api/documents/:id/post-accounting`. Backend validates target transaction type and account IDs against active company COA. | **VERIFIED** |
| **Reports & Analytics — Trial Balance / GL**| `TrialBalanceWorkspace.tsx` (`src/client/components/reports/TrialBalanceWorkspace.tsx`)| Filter and drill-down into specific General Ledger accounts | Centralized list from `/api/accounting/accounts` | `GET /api/reports/trial-balance`, `GET /api/accounting/general-ledger`. Dynamic queries scoped by `accountId` and `companyId`. | **VERIFIED** |
| **360° Entity Journey** | `Specialized360Renderers.tsx` (`src/client/components/entity360/Specialized360Renderers.tsx`)| View GL Account 360° lifecycle and line navigations | Authoritative `accounts` table join with `journal_lines` | `GET /api/journey/360/ACCOUNT/:id`. Reconciles actual debits, credits, and subledger origins. | **VERIFIED** |

---

## 3. VERIFIED DEFECT CLOSURES

1. **DEF-SEL-001 (Tax Code GL Control Account Dropdown Empty)**:
   - *Previous state*: Dropdown contained only `-- Select GL Account --` because no accounts were loaded or filtered.
   - *Remediation*: Connected to `/api/master-data/accounts?raw=true`, applied `filterEligibleTaxControlAccounts(accounts, taxType, direction)`, bound selected `accountId`, added empty-state guidance with link to Chart of Accounts, and subscribed to `coa:updated`.
2. **DEF-SEL-002 (Cash Transaction Dropdown Hardcoded/Incomplete)**:
   - *Previous state*: Hardcoded fallback options (`1010`, `1020`), custom bank accounts like `2026 — BDO Business Checking Account` missing.
   - *Remediation*: Centralized on `filterEligibleSourceCashAccounts(accounts)` + `/api/banking/accounts`, displays real account codes and names, and persists `accountId` foreign keys.
3. **DEF-SEL-003 (Bank Deposit Destination Allowing Petty Cash)**:
   - *Previous state*: Destination bank dropdown showed Petty Cash Fund (`1020`), permitting invalid bank deposits into cash drawers.
   - *Remediation*: Implemented `filterEligibleDestinationBankAccounts` (strictly Checking/Savings accounts). Backend explicitly rejects Petty Cash (`PETTY_CASH`) and identical source/destination accounts.
4. **DEF-SEL-004 (Master Data Tax Codes Disconnected from COA)**:
   - *Previous state*: `TaxCodesList.tsx` had no GL account dropdown and only managed raw text codes.
   - *Remediation*: Added dynamic GL Control Account Mapping selector with tax type/direction filtering, added `GL Control Account` column in table view, and enforced backend validation on `POST`/`PUT`.
5. **DEF-SEL-005 (Cross-Tenant Account Injection)**:
   - *Previous state*: Account IDs from other companies were not systematically blocked if passed directly via API.
   - *Remediation*: Backend route middleware and `business_transactions.ts` strictly enforce `eq(schema.accounts.companyId, companyId)` and `POSTABLE_LEAF` status on all operations.

---

## 4. REGRESSION VERIFICATION EVIDENCE

- **Automated Vitest Suite:** `tests/accounting/coa-centralized-selector-integration.test.ts` (All 5/5 test groups passed).
- **Core Accounting Suite:** `tests/accounting/` (27 files, 183 tests passed).
- **Live Chromium Browser Verification:** Captured visual evidence of populated selectors, custom account `2026` selection, and reactive `coa:updated` synchronization.
