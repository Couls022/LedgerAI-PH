# LEDGERAI PH — PAYROLL STATUTORY COMPONENT BRIDGE & RECONCILIATION (`v1.0.0-rc.1-remediated`)

**Document Authority**: Canonical Forensic Reconciliation of `CPA-04` Persisted Payroll Records vs. Historical Narrative Reports  
**Target Pilot Company**: `LGR-PH-2026-PILOT-CLEAN-01` (`Luzon Commercial & Industrial Trading Corp.`, TIN `009-884-215-000`)  
**Target Scenario**: `CPA-04` (`January 2026 Monthly Payroll & Statutory Contributions`, Run ID `pr-pilot-2026-01`, Journal ID `je-pilot-cpa04-payroll-01`)  
**Audit Date**: November 7, 2026  
**Verification Evidence Classification**: `RUNTIME_VERIFIED` & `AUTOMATED_TEST_VERIFIED`

---

## 1. Executive Summary of the Payroll Statutory Bridge

Section 3 of the Final Pre-Production Gate challenged the apparent difference between two sets of payroll statutory numbers reported in earlier summaries:

- **Earlier Pilot Report**:
  - Employer SSS/EC/PHIC/HDMF Expense: **`₱5,355.00`** (`535,500` centavos)
  - Combined Statutory Payable: **`₱8,930.00`** (`893,000` centavos)
  - Withholding Tax on Compensation: **`₱7,493.40`** (`749,340` centavos)
  - Net Pay Disbursed: **`₱53,931.60`** (`5,393,160` centavos)
- **Subsequent Narrative Table**:
  - SSS Payable: `₱6,050.00`
  - PhilHealth Payable: `₱2,480.00`
  - Pag-IBIG Payable: `₱400.00`
  - Withholding Tax on Compensation: `₱7,493.40`

### Forensic Finding (`RUNTIME_VERIFIED` Against Persisted SQLite Rows)

Direct inspection of the persisted SQLite records in `/root/Documents/LedgerAI Companies/LGR-PH-2026-PILOT-CLEAN-01/database.lai` (`payroll_runs` row `pr-pilot-2026-01`, `payroll_items` row `pi-pilot-2026-01`, and `journal_lines` for `je-pilot-cpa04-payroll-01`) proves the following:

1. **The Persisted Database Figures Exactly Match the Earlier Pilot Report (`₱5,355.00` ER Expense, `₱8,930.00` Combined Statutory Payable, `₱7,493.40` WTax, `₱53,931.60` Net Pay)**:
   - In the persisted database, there is **1 employee** (`emp-pilot-01`, `Juan Dela Cruz`, TIN `214-889-331-000`, Monthly Basic Salary `₱65,000.00` = `6,500,000` centavos).
   - His persisted combined statutory liabilities in `payroll_runs` (`pr-pilot-2026-01`) are:
     - **`total_sss`**: **`528,000` centavos (`₱5,280.00`)** = Employee SSS `₱1,750.00` (`175,000`) + Employer Regular/WISP SSS `₱3,500.00` (`350,000`) + Employer EC `₱30.00` (`3,000`).
     - **`total_philhealth`**: **`325,000` centavos (`₱3,250.00`)** = Employee PhilHealth `₱1,625.00` (`162,500`) + Employer PhilHealth `₱1,625.00` (`162,500`).
     - **`total_pagibig`**: **`40,000` centavos (`₱400.00`)** = Employee Pag-IBIG `₱200.00` (`20,000`) + Employer Pag-IBIG `₱200.00` (`20,000`).
     - **Sum of Combined Statutory Liabilities (`GL Account 2040`)**:
       $$₱5,280.00 + ₱3,250.00 + ₱400.00 = \mathbf{₱8,930.00}\text{ (`893,000` centavos)}$$
2. **Why the Narrative Table Showed `₱6,050.00` SSS / `₱2,480.00` PhilHealth (`±₱770.00` Documentation Split Error)**:
   - In the persisted Chart of Accounts for `LGR-PH-2026-PILOT-CLEAN-01`, combined SSS, PhilHealth, and Pag-IBIG liabilities are posted to a single consolidated liability control account: **Account `2040` (`SSS, PhilHealth & Pag-IBIG Contributions Payable`)** with a credit of **`893,000` centavos (`₱8,930.00`)**.
   - When the previous narrative markdown table broke `2040` (`₱8,930.00`) into three hypothetical sub-lines (`2031 SSS ₱6,050.00`, `2032 PhilHealth ₱2,480.00`, `2033 Pag-IBIG ₱400.00`), it introduced a **`±₱770.00` narrative transcription error** between SSS (`₱6,050.00` written vs. `₱5,280.00` persisted, `+₱770.00`) and PhilHealth (`₱2,480.00` written vs. `₱3,250.00` persisted, `-₱770.00`), which netted to `₱0.00` in the combined `₱8,930.00` total.
   - **No posted payroll journal or subledger row was altered**: the persisted database has always held the exact statutory amounts (`total_sss = ₱5,280.00`, `total_philhealth = ₱3,250.00`, `total_pagibig = ₱400.00`, `GL 2040 = ₱8,930.00`).

---

## 2. Complete Statutory Component Bridge (`CPA-04` — January 2026 Monthly Payroll)

### 2.1 Applicable Statutory Rule Versions (Effective January 2026)

| Agency / Tax Type | Statutory Reference & Version | Compensation Base (`emp-pilot-01`) | Applicable Ceiling / Bracket | Rate / Formula Applied |
|:---|:---|:---:|:---|:---|
| **SSS (Regular SS + WISP)** | RA 11199 (2025/2026 Schedule, `15%` Total: `5%` EE / `10%` ER) | `₱65,000.00` (`6,500,000` c) | Max MSC Ceiling: **`₱35,000.00`** (`₱20,000` Regular + `₱15,000` WISP) | EE: `5% × ₱35,000 = ₱1,750.00`<br>ER: `10% × ₱35,000 = ₱3,500.00` |
| **SSS Employees' Compensation (EC)** | RA 11199 EC Schedule | `₱65,000.00` (`6,500,000` c) | MSC `≥ ₱15,000.00` | EE: `₱0.00`<br>ER: **`₱30.00`** (`3,000` centavos) |
| **PhilHealth (PHIC)** | PhilHealth Circular 2024-0001 / 2026 (`5.0%` Total: `2.5%` EE / `2.5%` ER) | `₱65,000.00` (`6,500,000` c) | Floor `₱10,000.00` / Ceiling `₱100,000.00` (`₱65,000` is within ceiling) | EE: `2.5% × ₱65,000 = ₱1,625.00`<br>ER: `2.5% × ₱65,000 = ₱1,625.00` |
| **Pag-IBIG (HDMF)** | HDMF Circular No. 460 (`2%` EE / `2%` ER on `₱10,000` MFS Cap) | `₱65,000.00` (`6,500,000` c) | Max Fund Salary (MFS) Cap: **`₱10,000.00`** | EE: `2.0% × ₱10,000 = ₱200.00`<br>ER: `2.0% × ₱10,000 = ₱200.00` |
| **BIR Withholding Tax on Compensation (`1601-C`)** | RA 10963 (TRAIN Law 2023+ Effective Monthly Table, Bracket 3) | Taxable Base: **`₱61,425.00`** (`₱65,000.00 - ₱3,575.00` EE mandatory) | Monthly Bracket 3: `₱33,333.00` to `₱66,666.00` (`₱1,875.00` fixed + `20%` excess over `₱33,333.00`) | `₱1,875.00 + 20% × (₱61,425.00 - ₱33,333.00) = ₱1,875.00 + ₱5,618.40 =` **`₱7,493.40`** |

---

### 2.2 Component-by-Component Bridge Table (Persisted SQLite vs. GL vs. Historical Reports)

| Component Description | Share Classification | Employee Share (EE Deducted from Gross) | Employer Share (ER Charged to Expense `6020`) | Combined Remittance Liability (Credited to GL) | Persisted SQLite Column (`payroll_items` / `payroll_runs`) | GL Account & Line (`je-pilot-cpa04-payroll-01`) |
|:---|:---:|---:|---:|---:|:---|:---|
| **Gross Basic Salary (`Juan Dela Cruz`)** | Gross Compensation | — | — | `₱65,000.00` (`6,500,000` c) | `gross_pay = 6500000` / `total_gross_pay = 6500000` | **Dr `6010`** Salaries & Wages Expense: **`₱65,000.00`** (`jl-pilot-cpa04-1`) |
| **SSS Regular + WISP Contribution** | EE + ER Split | `₱1,750.00` (`175,000` c) | `₱3,500.00` (`350,000` c) | `₱5,250.00` (`525,000` c) | `sss_employee = 175000` | Included in `6020` Dr & `2040` Cr |
| **SSS Employees' Compensation (EC)** | Employer Only (`100%` ER) | `₱0.00` (`0` c) | `₱30.00` (`3,000` c) | `₱30.00` (`3,000` c) | `sss_employer = 353000` (`350,000 + 3,000`) | Included in `6020` Dr & `2040` Cr |
| **Subtotal — Total SSS + EC Remittance** | **Combined SSS Liability** | **`₱1,750.00`** (`175,000` c) | **`₱3,530.00`** (`353,000` c) | **`₱5,280.00`** (`528,000` c) | `payroll_runs.total_sss = 528000` | Part of **Cr `2040`** (`₱5,280.00` of `₱8,930.00`) |
| **PhilHealth (PHIC) Contribution** | **Combined PHIC Liability** | **`₱1,625.00`** (`162,500` c) | **`₱1,625.00`** (`162,500` c) | **`₱3,250.00`** (`325,000` c) | `philhealth_employee = 162500`<br>`philhealth_employer = 162500`<br>`total_philhealth = 325000` | Part of **Cr `2040`** (`₱3,250.00` of `₱8,930.00`) |
| **Pag-IBIG (HDMF) Contribution** | **Combined HDMF Liability** | **`₱200.00`** (`20,000` c) | **`₱200.00`** (`20,000` c) | **`₱400.00`** (`40,000` c) | `pagibig_employee = 20000`<br>`pagibig_employer = 20000`<br>`total_pagibig = 40000` | Part of **Cr `2040`** (`₱400.00` of `₱8,930.00`) |
| **Total Mandatory Social Contributions (SSS + EC + PHIC + HDMF)** | **Combined Statutory Payable** | **`₱3,575.00`** (`357,500` c) | **`₱5,355.00`** (`535,500` c) | **`₱8,930.00`** (`893,000` c) | `357,500 (EE) + 535,500 (ER) = 893,000` | **Dr `6020`**: **`₱5,355.00`** (`jl-pilot-cpa04-2`)<br>**Cr `2040`**: **`₱8,930.00`** (`jl-pilot-cpa04-3`) |
| **BIR Compensation Withholding Tax (`1601-C`)** | Employee Tax Withheld | **`₱7,493.40`** (`749,340` c) | `₱0.00` (`0` c) | **`₱7,493.40`** (`749,340` c) | `withholding_tax = 749340`<br>`total_withholding_tax = 749340` | **Cr `2035`** WTax Payable - Compensation: **`₱7,493.40`** (`jl-pilot-cpa04-4`) |
| **Total Deductions From Employee Gross Pay** | Employee Deductions (`EE Statutory + WTax`) | **`₱11,068.40`** (`1,106,840` c) | — | — | `total_deductions = 1106840` (`357,500 + 749,340`) | Deducted from `6010` Gross Pay (`₱65,000.00 - ₱11,068.40`) |
| **Net Take-Home Pay Disbursed** | Net Payroll Paid | — | — | **`₱53,931.60`** (`5,393,160` c) | `net_pay = 5393160`<br>`total_net_pay = 5393160` | **Cr `1010`** Cash in Bank - BDO: **`₱53,931.60`** (`jl-pilot-cpa04-5`) |
| **Total Employer Payroll Cost (`Gross + ER Contributions`)** | Total Payroll Expense | — | **`₱70,355.00`** (`7,035,500` c) | **`₱70,355.00`** (`7,035,500` c) | `6,500,000 (Gross) + 535,500 (ER) = 7,035,500` | **Total Journal Debits (`6010 + 6020`) = Total Journal Credits (`2040 + 2035 + 1010`) = `₱70,355.00`** |

---

## 3. Double-Entry Proof of Zero Duplication or Omission

$$\begin{aligned}
\text{Total Debits (`je-pilot-cpa04-payroll-01`)} &= \text{Dr `6010` Gross Salaries (`₱65,000.00`)} + \text{Dr `6020` Employer Contributions (`₱5,355.00`)} \\
&= \mathbf{₱70,355.00}\text{ (`7,035,500` centavos)} \\[8pt]
\text{Total Credits (`je-pilot-cpa04-payroll-01`)} &= \text{Cr `2040` Combined SSS/EC/PHIC/HDMF (`₱8,930.00`)} + \text{Cr `2035` WTax 1601-C (`₱7,493.40`)} + \text{Cr `1010` Net Cash Paid (`₱53,931.60`)} \\
&= \mathbf{₱70,355.00}\text{ (`7,035,500` centavos)}
\end{aligned}$$

- **Variance**: **`0` centavos (`₱0.00`)**.
- **Automated Verification**: Asserted directly against the reopened SQLite database in `tests/accounting/pilot-cpa01-to-cpa06-revalidation.test.ts` (Test #1 & Test #2).
