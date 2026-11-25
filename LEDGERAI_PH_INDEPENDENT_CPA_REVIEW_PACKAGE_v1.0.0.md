# LEDGERAI PH — `1.0.0-rc.1` INDEPENDENT CPA REVIEW PACKAGE & WORKPAPERS

**Document Authority**: Canonical Independent Certified Public Accountant (CPA) Review Workpapers & Evidence Package  
**Release Target**: LedgerAI PH Enterprise Accounting, Payroll & Statutory Compliance Platform `1.0.0-rc.1`  
**Pilot Company ID**: `LGR-PH-2026-PILOT-CLEAN-01` (`Luzon Commercial & Industrial Trading Corp.`, TIN `009-884-215-000`, Classification: `PILOT`)  
**Accounting Period Under Review**: `January 2026` (`2026-01-01` to `2026-01-31`, Period ID `per-pilot-2026-01`)  
**Handoff Baseline Date**: November 14, 2026  
**Independent CPA Review Status (`Gate 8`)**: **`EXTERNAL_VALIDATION_PENDING`** *(Software-generated results below are marked `INTERNAL SOFTWARE BASELINE` and verified by automated tests against persisted SQLite/`.lai` records. No independent CPA identity, PRC license number, or conclusion is fabricated; formal physical review and sign-off by a licensed Philippine CPA remain required).*  

---

## 1. PILOT DATASET IDENTITY & SOURCE EVIDENCE SUMMARY

- **Company ID**: `LGR-PH-2026-PILOT-CLEAN-01`
- **Legal Name**: `Luzon Commercial & Industrial Trading Corp.`
- **TIN / Tax Profile**: `009-884-215-000` (`VAT_REGISTERED`, `CORPORATION`, `ACCRUAL` Basis)
- **Persisted Container**: `/root/Documents/LedgerAI Companies/LGR-PH-2026-PILOT-CLEAN-01/database.lai` (`LAISENC2`, `version: 2`, `aadVersion: 3`, `keyMode: OS_KEYCHAIN_STANDALONE`)
- **Total Persisted `POSTED` Journals**: **`8` journals (`30` journal lines)** (`8 + 3 + 3 + 3 + 3 + 5 + 2 + 3 = 30`)
- **Opening Trial Balance (`2026-01-01`)**: **`₱3,900,000.00`** (`390,000,000` centavos)
- **Closing Trial Balance (`2026-01-31`)**: Gross **`₱4,990,855.00`** (`499,085,500` centavos); Net **`₱4,602,923.40`** (`460,292,340` centavos)
- **Subledger-to-GL Reconciliation Variance (`INTERNAL SOFTWARE BASELINE`)**: **`0` centavos (`₱0.00`) across all 5 subledgers** (AR, AP, Inventory, Fixed Assets, Bank Reconciliation)

---

## 2. SOFTWARE-GENERATED FINANCIAL STATEMENTS & SCHEDULES (`INTERNAL SOFTWARE BASELINE`)

### 2A. Complete Closing Trial Balance Schedule (`2026-01-31` — All `21` Active GL Accounts)

| Code | Account Name | Type / Normal | Gross Debit | Gross Credit | Net Debit | Net Credit |
|:---:|:---|:---:|---:|---:|---:|---:|
| `1010` | Cash in Bank - BDO Current Account | Asset (`DR`) | `₱2,612,150.00` | `₱163,931.60` | `₱2,448,218.40` | `₱0.00` |
| `1030` | Accounts Receivable - Trade | Receivable (`DR`) | `₱574,000.00` | `₱112,000.00` | `₱462,000.00` | `₱0.00` |
| `1050` | Input VAT (`12%`) | Current Asset (`DR`) | `₱60,000.00` | `₱0.00` | `₱60,000.00` | `₱0.00` |
| `1070` | Creditable Withholding Tax (`BIR Form 2307`) | Current Asset (`DR`) | `₱2,000.00` | `₱0.00` | `₱2,000.00` | `₱0.00` |
| `1080` | Merchandise Inventory | Inventory (`DR`) | `₱450,000.00` | `₱0.00` | `₱450,000.00` | `₱0.00` |
| `1510` | Office & Warehouse Equipment | Fixed Asset (`DR`) | `₱600,000.00` | `₱0.00` | `₱600,000.00` | `₱0.00` |
| `1520` | Accumulated Depreciation - Equipment | Contra-Asset (`CR`) | `₱0.00` | `₱110,000.00` | `₱0.00` | `₱110,000.00` |
| `2010` | Accounts Payable - Trade | Payable (`CR`) | `₱112,000.00` | `₱860,000.00` | `₱0.00` | `₱748,000.00` |
| `2020` | Output VAT (`12%`) | Current Liab (`CR`) | `₱0.00` | `₱24,000.00` | `₱0.00` | `₱24,000.00` |
| `2030` | Expanded Withholding Tax Payable (`0619-E`/`1601-EQ`) | Payable (`CR`) | `₱0.00` | `₱2,000.00` | `₱0.00` | `₱2,000.00` |
| `2035` | Withholding Tax Payable - Compensation (`1601-C`) | Payable (`CR`) | `₱0.00` | `₱7,493.40` | `₱0.00` | `₱7,493.40` |
| `2040` | SSS, PhilHealth & Pag-IBIG Contributions Payable | Payable (`CR`) | `₱0.00` | `₱8,930.00` | `₱0.00` | `₱8,930.00` |
| `3010` | Subscribed & Paid-Up Share Capital | Equity (`CR`) | `₱0.00` | `₱3,000,000.00` | `₱0.00` | `₱3,000,000.00` |
| `3020` | Retained Earnings | Equity (`CR`) | `₱0.00` | `₱500,000.00` | `₱0.00` | `₱500,000.00` |
| `4010` | Sales Revenue - VATable | Revenue (`CR`) | `₱0.00` | `₱200,000.00` | `₱0.00` | `₱200,000.00` |
| `4020` | Bank Interest Income | Revenue (`CR`) | `₱0.00` | `₱2,500.00` | `₱0.00` | `₱2,500.00` |
| `5010` | Cost of Goods Sold / Purchases | Cost of Sales (`DR`) | `₱500,000.00` | `₱0.00` | `₱500,000.00` | `₱0.00` |
| `6010` | Salaries & Wages Expense | Expense (`DR`) | `₱65,000.00` | `₱0.00` | `₱65,000.00` | `₱0.00` |
| `6020` | Employer Statutory Contributions Expense | Expense (`DR`) | `₱5,355.00` | `₱0.00` | `₱5,355.00` | `₱0.00` |
| `6030` | Depreciation Expense - Equipment | Expense (`DR`) | `₱10,000.00` | `₱0.00` | `₱10,000.00` | `₱0.00` |
| `6040` | Bank Service Charges | Expense (`DR`) | `₱350.00` | `₱0.00` | `₱350.00` | `₱0.00` |
| **TOTAL** | **All `21` Active GL Accounts (`0` centavo variance)** | **Balanced** | **`₱4,990,855.00`** | **`₱4,990,855.00`** | **`₱4,602,923.40`** | **`₱4,602,923.40`** |

### 2B. Software-Generated Income Statement & Balance Sheet (`January 2026`)

- **Statement of Comprehensive Income (`2026-01-01` to `2026-01-31`)**:
  - Sales Revenue - VATable (`4010`): `₱200,000.00` (`20,000,000` centavos)
  - Bank Interest Income (`4020`): `₱2,500.00` (`250,000` centavos)
  - **Total Revenue**: **`₱202,500.00`** (`20,250,000` centavos)
  - Less: Cost of Goods Sold / Purchases (`5010`): **`₱500,000.00`** (`50,000,000` centavos)
  - Less: Operating Expenses (`6010` `₱65,000.00` + `6020` `₱5,355.00` + `6030` `₱10,000.00` + `6040` `₱350.00`): **`₱80,705.00`** (`8,070,500` centavos)
  - **Net Income / (Loss) (`January 2026`)**: **`-₱378,205.00`** (`-37,820,500` centavos)
- **Statement of Financial Position (`As of 2026-01-31`)**:
  - **Current Assets**: Cash (`1010`) `₱2,448,218.40` + AR (`1030`) `₱462,000.00` + Input VAT (`1050`) `₱60,000.00` + CWT 2307 (`1070`) `₱2,000.00` + Inventory (`1080`) `₱450,000.00` = **`₱3,422,218.40`**
  - **Non-Current Assets**: Equipment (`1510`) `₱600,000.00` less Accum. Depr (`1520`) `₱110,000.00` = **`₱490,000.00`**
  - **Total Assets**: **`₱3,912,218.40`** (`391,221,840` centavos)
  - **Current Liabilities**: AP (`2010`) `₱748,000.00` + Output VAT (`2020`) `₱24,000.00` + EWT (`2030`) `₱2,000.00` + WTC (`2035`) `₱7,493.40` + Statutory (`2040`) `₱8,930.00` = **`₱790,423.40`** (`79,042,340` centavos)
  - **Equity**: Share Capital (`3010`) `₱3,000,000.00` + Retained Earnings (`3020`) `₱500,000.00` + Current Period Net Loss `-₱378,205.00` = **`₱3,121,795.00`** (`312,179,500` centavos)
  - **Total Liabilities & Equity**: `₱790,423.40 + ₱3,121,795.00 =` **`₱3,912,218.40`** (Accounting Equation Variance = **`₱0.00`**).

### 2C. AR, AP & Subledger Reconciliation Schedules (`2026-01-31`)

- **Accounts Receivable Subledger (`GL 1030 = ₱462,000.00`, Variance `₱0.00`)**:
  - `inv-pilot-opening-ar-01` (`SI-2025-0999`, `Visayas Retail Distribution Corp.`): Total `₱350,000.00` | Balance Due **`₱350,000.00`** (`POSTED`, carried from prior year)
  - `inv-pilot-clean-01` (`SI-2026-0001`, `Philippine Apex Logistics Corp.`): Total `₱224,000.00` | Paid `₱112,000.00` (`PAY-2026-0001` / `OR-2026-0001`: `₱110,000.00` cash + `₱2,000.00` Form `2307` CWT) | Balance Due **`₱112,000.00`** (`PARTIAL`)
- **Accounts Payable Subledger (`GL 2010 = ₱748,000.00`, Variance `₱0.00`)**:
  - `bill-pilot-opening-ap-01` (`PB-2025-0888`, `Cavite Packaging & Containers Inc.`): Total `₱300,000.00` | Balance Due **`₱300,000.00`** (`POSTED`, carried from prior year)
  - `bill-pilot-clean-01` (`PB-2026-0001`, `Metro Manila Industrial Supply Inc.`): Total `₱560,000.00` | Settled `₱112,000.00` (`SP-2026-0001`: `₱110,000.00` cash + `₱2,000.00` `WC158` EWT) | Balance Due **`₱448,000.00`** (`PARTIAL`)
- **Inventory (`GL 1080 = ₱450,000.00`)**: `SKU-IND-VALVE-01` (`900` PCS @ `₱500.00` FIFO = `₱450,000.00`, variance `₱0.00`).
- **Fixed Assets (`GL 1510 - 1520 = ₱490,000.00`)**: `FA-EQP-2025-001` Cost `₱600,000.00` less Accum. Depr `₱110,000.00` = `₱490,000.00` NBV (matches `ds-pilot-2026-01`, variance `₱0.00`).

### 2D. BIR Tax Calculation Workpaper Summary (`January 2026` — `INTERNAL SOFTWARE BASELINE`)

| BIR Form / Statutory Return | Coverage | Software-Computed Tax / Credit | Linked GL Account & Balance | Period Completeness & Filing Control |
|:---|:---:|---:|:---|:---|
| **BIR Form `2550Q`** (Quarterly VAT) | `2026-01` (Interim) | Output VAT `₱24,000.00` - Input VAT `₱60,000.00` = **Net VAT Credit `₱36,000.00`** | `2020` (`₱24,000.00`) vs `1050` (`₱60,000.00`) | `INTERIM_PARTIAL_QUARTER`: system blocks Jan-only data from being marked a complete `Q1` filing. |
| **BIR Form `1601-C`** (Monthly WTC) | `2026-01` | Compensation Tax Withheld: **`₱7,493.40`** | `2035` (`₱7,493.40`) | Reconciles to `pr-pilot-2026-01` (`₱61,425.00` taxable base under TRAIN 2023+ Bracket 3). |
| **BIR Form `0619-E` / `1601-EQ`** (EWT) | `2026-01` | Expanded Withholding (`WC158`, `2%` of `₱100,000.00`): **`₱2,000.00`** | `2030` (`₱2,000.00`) | Reconciles to supplier payment `sp-pilot-cpa02-01`. |
| **BIR Form `2307`** (CWT Claimed) | `2026-01` | Customer Withheld CWT (`2%` of `₱100,000.00`): **`₱2,000.00`** | `1070` (`₱2,000.00`) | Reconciles to customer payment `pay-pilot-cpa03-01` (`OR-2026-0001`). |
| **BIR Form `2316`** (Annual Cert) | `2026` YTD | `1` employee (`Juan Dela Cruz`): Gross `₱65,000.00`, Non-Taxable EE `₱3,575.00`, WTax `₱7,493.40` | Matches `6010`, `2035`, `2040` | Semi-monthly aggregation & reversed-run exclusion verified in `pilot-cpa01-to-cpa06-revalidation.test.ts` Test #5. |

### 2E. Period-Close & Journal Reversal Controls Evidence

- **12-Section Period-Close Workspace (`PeriodCloseWorkspaceService`)**: Verified Soft/Hard Close readiness checks, unposted transaction blockers, immutable `period_close_certifications` SHA-256 hashes, closed-period posting locks, and controlled period reopen audit logging in `tests/integration/period-close-workspace.test.ts` (`4/4` PASS).
- **1-to-1 Reversal Lifecycle**: Verified `POSTED` entries cannot be edited or deleted directly (`audit_logs` + DB immutability triggers), cross-period reversal date validation (`PERIOD_DATE_MISMATCH`), duplicate-reversal prevention (`ALREADY_REVERSED`), and `0` centavo post-reversal TB drift in `tests/accounting/period-scoped-reporting-and-reversal-lifecycle.test.ts` & `accounting-edge-case-hardening.test.ts`.

---

## 3. CPA WORKPAPERS — SCENARIO-BY-SCENARIO PERSISTED EVIDENCE (`CPA-01` THROUGH `CPA-06`)

### Workpaper 1: `CPA-01` — Opening Balances & Opening Subledgers (`2026-01-01`)
- **Persisted Journal Entry**: `je-pilot-clean-opening-01` (`OB-2026-0001`, Posting Date: `2026-01-01`, Status: `POSTED`)
- **Persisted Journal Lines (`8` lines)**:
  - **Dr `1010`** Cash in Bank - BDO Current Account: **`₱2,500,000.00`** (`250,000,000` centavos)
  - **Dr `1030`** Accounts Receivable - Trade: **`₱350,000.00`** (`35,000,000` centavos)
  - **Dr `1080`** Merchandise Inventory (`900` units @ `₱500.00` FIFO): **`₱450,000.00`** (`45,000,000` centavos)
  - **Dr `1510`** Office & Warehouse Equipment: **`₱600,000.00`** (`60,000,000` centavos)
  - **Cr `1520`** Accumulated Depreciation - Equipment: **`₱100,000.00`** (`10,000,000` centavos)
  - **Cr `2010`** Accounts Payable - Trade: **`₱300,000.00`** (`30,000,000` centavos)
  - **Cr `3010`** Subscribed & Paid-Up Share Capital: **`₱3,000,000.00`** (`300,000,000` centavos)
  - **Cr `3020`** Retained Earnings: **`₱500,000.00`** (`50,000,000` centavos)
- **Persisted Opening Subledger Backing (`DEF-ADV-005`)**:
  - Opening AR Invoice: `inv-pilot-opening-ar-01` (`SI-2025-0999`, Customer: `Visayas Retail Distribution Corp.`, TIN `007-112-334-000`, Balance Due: `₱350,000.00`)
  - Opening AP Bill: `bill-pilot-opening-ap-01` (`PB-2025-0888`, Vendor: `Cavite Packaging & Containers Inc.`, TIN `004-998-112-000`, Balance Due: `₱300,000.00`)
  - Opening Inventory Item: `item-pilot-opening-01` (`SKU-IND-VALVE-01`, `900` PCS @ `₱500.00` = `₱450,000.00`)
- **Software Baseline Variance**: **`₱0.00` (`0` centavos)** (`Total Debits ₱3,900,000.00 == Total Credits ₱3,900,000.00`).
- **Independent CPA Review Status**: **`EXTERNAL_VALIDATION_PENDING`**

---

### Workpaper 2: `CPA-02` — VATable Trade Purchase (`12%` Input VAT) & Partial Supplier Settlement (`2%` EWT `WC158`)
- **Transaction 2A — Supplier Purchase Bill (`2026-01-10`)**:
  - **Source Document**: `bill-pilot-clean-01` (`PB-2026-0001`, Vendor: `Metro Manila Industrial Supply Inc.`, TIN `005-332-119-000`, Gross: `₱560,000.00`)
  - **Journal Entry**: `je-pilot-cpa02-bill-01` (`PJ-PB-2026-0001`, Status: `POSTED`)
    - **Dr `5010`** Cost of Goods Sold / Purchases: **`₱500,000.00`** (`50,000,000` centavos)
    - **Dr `1050`** Input VAT (`12%`): **`₱60,000.00`** (`6,000,000` centavos)
    - **Cr `2010`** Accounts Payable - Trade: **`₱560,000.00`** (`56,000,000` centavos)
- **Transaction 2B — Partial Supplier Payment with `2%` Expanded Withholding Tax (`2026-01-12`)**:
  - **Source Document**: `sp-pilot-cpa02-01` (`SP-2026-0001`, Application: `spa-pilot-01`, Settling `₱112,000.00` of `PB-2026-0001`)
  - **Journal Entry**: `je-pilot-cpa02-pay-01` (`CDJ-SP-2026-0001`, Status: `POSTED`)
    - **Dr `2010`** Accounts Payable - Trade: **`₱112,000.00`** (`11,200,000` centavos)
    - **Cr `2030`** Expanded Withholding Tax Payable (`WC158`, `2%` on `₱100,000.00` net base): **`₱2,000.00`** (`200,000` centavos)
    - **Cr `1010`** Cash in Bank - BDO Current Account: **`₱110,000.00`** (`11,000,000` centavos)
- **Resulting AP Balance (`2010`)**: `₱300,000.00 (Opening) + ₱560,000.00 (Bill) - ₱112,000.00 (Settlement) =` **`₱748,000.00`** (`74,800,000` centavos; matches AP Subledger `₱300,000.00 + ₱448,000.00 = ₱748,000.00`, variance = `₱0.00`).
- **Independent CPA Review Status**: **`EXTERNAL_VALIDATION_PENDING`**

---

### Workpaper 3: `CPA-03` — VATable Customer Sales Invoice (`12%` Output VAT) & Collection with BIR Form `2307` (`2%` CWT)
- **Transaction 3A — Customer Sales Invoice (`2026-01-15`)**:
  - **Source Document**: `inv-pilot-clean-01` (`SI-2026-0001`, Customer: `Philippine Apex Logistics Corp.`, TIN `008-551-223-000`, Gross: `₱224,000.00`)
  - **Journal Entry**: `je-pilot-cpa03-inv-01` (`SJ-SI-2026-0001`, Status: `POSTED`)
    - **Dr `1030`** Accounts Receivable - Trade: **`₱224,000.00`** (`22,400,000` centavos)
    - **Cr `4010`** Sales Revenue - VATable: **`₱200,000.00`** (`20,000,000` centavos)
    - **Cr `2020`** Output VAT (`12%`): **`₱24,000.00`** (`2,400,000` centavos)
- **Transaction 3B — Partial Customer Collection with BIR Form `2307` (`2026-01-20`)**:
  - **Source Document**: `pay-pilot-cpa03-01` (`PAY-2026-0001` / `OR-2026-0001`, Application: `cpa-app-pilot-01`, Settling `₱112,000.00` of `SI-2026-0001`)
  - **Journal Entry**: `je-pilot-cpa03-pay-01` (`CRJ-OR-2026-0001`, Status: `POSTED`)
    - **Dr `1010`** Cash in Bank - BDO Current Account: **`₱110,000.00`** (`11,000,000` centavos)
    - **Dr `1070`** Creditable Withholding Tax (`BIR Form 2307`, `2%` of `₱100,000.00` net): **`₱2,000.00`** (`200,000` centavos)
    - **Cr `1030`** Accounts Receivable - Trade: **`₱112,000.00`** (`11,200,000` centavos)
- **Resulting AR Balance (`1030`)**: `₱350,000.00 (Opening) + ₱224,000.00 (Invoice) - ₱112,000.00 (Collection) =` **`₱462,000.00`** (`46,200,000` centavos; matches AR Subledger `₱350,000.00 + ₱112,000.00 = ₱462,000.00`, variance = `₱0.00`).
- **Independent CPA Review Status**: **`EXTERNAL_VALIDATION_PENDING`**

---

### Workpaper 4: `CPA-04` — Monthly Payroll & Statutory Contributions (`2026-01-31`)
- **Source Document**: Payroll Run `pr-pilot-2026-01` (`2026-01-MONTHLY`), Payroll Item `pi-pilot-2026-01`, Employee `emp-pilot-01` (`Juan Dela Cruz`, TIN `214-889-331-000`, Monthly Basic Salary `₱65,000.00`).
- **Statutory Component Breakdown** (See full bridge in `/LEDGERAI_PH_PAYROLL_STATUTORY_RECONCILIATION_BRIDGE_v1.0.0.md`):
  - **SSS (`RA 11199`, `₱35,000` MSC ceiling)**: Employee `₱1,750.00` + Employer Regular/WISP `₱3,500.00` + Employer EC `₱30.00` = **`₱5,280.00`** (`528,000` centavos)
  - **PhilHealth (`5.0%` on `₱65,000.00`)**: Employee `₱1,625.00` + Employer `₱1,625.00` = **`₱3,250.00`** (`325,000` centavos)
  - **Pag-IBIG (`HDMF Circular 460`, `2%` EE / `2%` ER on `₱10,000` MFS cap)**: Employee `₱200.00` + Employer `₱200.00` = **`₱400.00`** (`40,000` centavos)
  - **Total Employee Mandatory Contributions**: `₱1,750.00 + ₱1,625.00 + ₱200.00 =` **`₱3,575.00`** (`357,500` centavos)
  - **Total Employer Contribution Expense (`6020`)**: `₱3,530.00 + ₱1,625.00 + ₱200.00 =` **`₱5,355.00`** (`535,500` centavos)
  - **Combined Statutory Payable (`2040`)**: `₱5,280.00 + ₱3,250.00 + ₱400.00 =` **`₱8,930.00`** (`893,000` centavos)
  - **Withholding Tax on Compensation (`2035`, `TRAIN 2023+` Monthly Bracket 3 on `₱61,425.00` taxable)**: **`₱7,493.40`** (`749,340` centavos)
  - **Net Pay Disbursed (`1010`)**: `₱65,000.00 - ₱3,575.00 - ₱7,493.40 =` **`₱53,931.60`** (`5,393,160` centavos)
- **Journal Entry**: `je-pilot-cpa04-payroll-01` (`PRJ-2026-0001`, Status: `POSTED`, Total Dr = Total Cr = `₱70,355.00`, variance = `₱0.00`).
- **Independent CPA Review Status**: **`EXTERNAL_VALIDATION_PENDING`**

---

### Workpaper 5: `CPA-05` — Fixed Asset Register & Straight-Line Depreciation (`2026-01-31`)
- **Source Document**: Fixed Asset `fa-pilot-equip-01` (`FA-EQP-2025-001`, `Office & Warehouse Heavy Shelving & Forklift System`, Cost `₱600,000.00`, Salvage `₱0.00`, Useful Life `60` months, Monthly Depreciation `₱10,000.00`), Schedule `ds-pilot-2026-01` (`2026-01`).
- **Journal Entry**: `je-pilot-cpa05-depr-01` (`GJ-DEPR-2026-01`, Status: `POSTED`)
  - **Dr `6030`** Depreciation Expense - Equipment: **`₱10,000.00`** (`1,000,000` centavos)
  - **Cr `1520`** Accumulated Depreciation - Equipment: **`₱10,000.00`** (`1,000,000` centavos)
- **Resulting Fixed Asset Net Book Value**: `₱600,000.00 (GL 1510 Cost) - ₱110,000.00 (GL 1520 Accum Depr) =` **`₱490,000.00`** (`49,000,000` centavos; matches `ds-pilot-2026-01.book_value`, variance = `₱0.00`).
- **Independent CPA Review Status**: **`EXTERNAL_VALIDATION_PENDING`**

---

### Workpaper 6: `CPA-06` — Bank Reconciliation & Adjusting Entry (`2026-01-31`)
- **Source Document**: Bank Reconciliation `recon-pilot-2026-01` (`2026-01-31`, `5` matched bank statement lines `bsl-pilot-01`..`05`).
  - Unadjusted Book Cash Balance (`1010`): `₱2,500,000.00 - ₱110,000.00 + ₱110,000.00 - ₱53,931.60 =` **`₱2,446,068.40`** (`244,606,840` centavos)
  - Bank Interest Income (`+₱2,500.00`) less Bank Service Charge (`-₱350.00`) = Net Cash Adjustment **`+₱2,150.00`** (`215,000` centavos)
  - Adjusted Book Balance = Adjusted Bank Statement Balance = **`₱2,448,218.40`** (`244,821,840` centavos), `unexplained_difference = 0`.
- **Journal Entry**: `je-pilot-cpa06-bank-01` (`GJ-BANK-2026-01`, Status: `POSTED`)
  - **Dr `1010`** Cash in Bank - BDO Current Account: **`₱2,150.00`** (`215,000` centavos)
  - **Dr `6040`** Bank Service Charges: **`₱350.00`** (`35,000` centavos)
  - **Cr `4020`** Bank Interest Income: **`₱2,500.00`** (`250,000` centavos)
- **Independent CPA Review Status**: **`EXTERNAL_VALIDATION_PENDING`**

---

## 4. STEP-BY-STEP INDEPENDENT CPA RECONCILIATION PROCEDURES (`Gate 8`)

| Step | Reconciliation Procedure | Software-Generated Expected Result (`INTERNAL`) | Independent CPA Verification Conclusion |
|:---:|:---|:---|:---:|
| **PROC-01** | Independently recompute all `8` posted journals (`30` lines) from source documents (`SI-2026-0001`, `OR-2026-0001`, `PB-2026-0001`, `SP-2026-0001`, `pr-pilot-2026-01`, `ds-pilot-2026-01`, `recon-pilot-2026-01`). | Opening TB `₱3,900,000.00`; Closing Gross TB `₱4,990,855.00`; Net TB `₱4,602,923.40`; `0` centavos imbalance. | **`[EXTERNAL_VALIDATION_PENDING]`** |
| **PROC-02** | Cross-foot Balance Sheet (`₱3,912,218.40`) and Income Statement (`-₱378,205.00`) against GL Trial Balance and confirm closing equity roll-forward. | Assets = Liabilities (`₱790,423.40`) + Equity (`₱3,121,795.00`); zero plug/unexplained delta. | **`[EXTERNAL_VALIDATION_PENDING]`** |
| **PROC-03** | Tie AR (`₱462,000.00`), AP (`₱748,000.00`), Inventory (`₱450,000.00`), Fixed Assets NBV (`₱490,000.00`), and Cash (`₱2,448,218.40`) subledgers to GL control accounts. | `0` centavos subledger-to-GL variance across all 5 subledgers. | **`[EXTERNAL_VALIDATION_PENDING]`** |
| **PROC-04** | Recalculate `12%` Output/Input VAT (`2550Q`), `2%` EWT `WC158` (`1601-EQ`), `2%` CWT (`2307`), and `TRAIN 2023+` Compensation Tax (`1601-C` / `2316`) against current BIR issuances. | VAT Net Credit `₱36,000.00` (Jan interim guarded); `WC158` `₱2,000.00`; CWT `₱2,000.00`; WTC `₱7,493.40`. | **`[EXTERNAL_VALIDATION_PENDING]`** |
| **PROC-05** | Verify `RA 11199` SSS (`₱5,280.00`), `PhilHealth 5%` (`₱3,250.00`), and `HDMF Circular 460` Pag-IBIG (`₱400.00`) brackets, caps, and EE/ER splits. | Total EE `₱3,575.00`, ER `₱5,355.00`, Combined Statutory `₱8,930.00` (`GL 2040`). | **`[EXTERNAL_VALIDATION_PENDING]`** |
| **PROC-06** | Execute parallel comparison against live pilot client entity's legacy books for at least one full closing period (`PeriodCloseWorkspaceService` + reversal tests). | Zero unreconciled GL/tax/payroll differences across live pilot parallel run. | **`[EXTERNAL_VALIDATION_PENDING]`** |
| **PROC-07** | Inspect immutable `audit_logs`, HMAC-SHA256 verification state, and period-close certification SHA-256 hash. | Intact tamper-evident hash chain and zero direct edits/deletions of posted entries. | **`[EXTERNAL_VALIDATION_PENDING]`** |

---

## 5. CPA FINDINGS & EXCEPTION REGISTER TEMPLATE (`EXTERNAL_VALIDATION_PENDING`)

| Finding ID | Workpaper / Return Ref | Category (`Accounting` / `VAT` / `WHT` / `Payroll` / `Controls`) | Software Figure | Independent CPA Recomputed Figure | Variance (`₱`) | Severity (`Blocker`/`Major`/`Minor`) | Resolution & Sign-Off Status |
|:---|:---|:---|---:|---:|---:|:---:|:---:|
| `[Pending CPA Entry]` | — | — | — | — | — | — | **`OPEN / PENDING`** |

---

## 6. INDEPENDENT PHILIPPINE CPA SIGN-OFF BLOCK (`EXTERNAL_VALIDATION_PENDING`)

| Field | Independent CPA Reviewer Entry |
|:---|:---|
| **Licensed CPA Full Name** | `[EXTERNAL_VALIDATION_PENDING — To be completed by Independent Philippine CPA]` |
| **PRC CPA License No.** | `[EXTERNAL_VALIDATION_PENDING]` |
| **BOA Accreditation No. & Expiry** | `[EXTERNAL_VALIDATION_PENDING]` |
| **BIR Tax Practitioner Accreditation No. (if applicable)** | `[EXTERNAL_VALIDATION_PENDING]` |
| **PTR No. / Date / Place Issued** | `[EXTERNAL_VALIDATION_PENDING]` |
| **Date of Parallel-Run & Workpaper Review** | `[EXTERNAL_VALIDATION_PENDING]` |
| **CPA Reviewer Comments & Observations** | `[EXTERNAL_VALIDATION_PENDING]` |
| **Audit Exceptions / Variances Noted** | `[EXTERNAL_VALIDATION_PENDING — Software internal baseline variance is 0 centavos across CPA-01..CPA-06]` |
| **CPA Disposition (`APPROVED` / `APPROVED WITH CONDITIONS` / `REJECTED`)** | **`EXTERNAL_VALIDATION_PENDING`** |
| **Independent CPA Signature** | `[EXTERNAL_VALIDATION_PENDING — Wet-ink or BIR/PRC-compliant digital signature required]` |

