# BIR CAS / CBA Registration Readiness Package — LedgerAI PH (`1.0.0-rc.2`)

**Regulatory References**: **BIR RMC No. 5-2021** (System Registration & Acknowledgment Certificate for CAS/CBA), **BIR RMC No. 65-2025** (Computerized Books of Accounts Clarification), **RA 11976** (Ease of Paying Taxes Act — EOPT), **RMC No. 5-2023** & **RMC No. 52-2023** (`2550Q` Quarterly VAT & Optional `2550M`), **NIRC Sec. 235**, and **RR No. 5-2014** (10-Year Preservation of Books of Accounts and Records).  
**External Registration Status (`Gate 9`)**: **`EXTERNAL_SUBMISSION_PENDING`** *(Software capability is technically prepared; no BIR Acknowledgment Certificate has been issued. Software release does NOT confer taxpayer registration).*

---

## 1. System Description and Architecture

### 1.1 Application Overview
LedgerAI PH (`1.0.0-rc.2`) is an offline-first Computerized Accounting System (CAS) / Computerized Books of Accounts (CBA) platform built for Philippine businesses using **Topology A (Centralized LAN API Server)** architecture to enforce single-process SQLite WAL ownership (`PRAGMA journal_mode=WAL`), integer-centavo financial precision, zero-data clean start initialization, and strict multi-company workspace isolation.

### 1.2 Cryptographic Security & Tamper-Resistance (`LAISENC2` / `LAISDOC1` / `LAIBANK1` / HMAC-SHA256)
- **Database Confidentiality (`LAISENC2`)**: Every company SQLite database is sealed at rest in an AES-256-GCM `.lai` container (`version: 2`, `aadVersion: 3`) with machine-bound `.keystore_vault` Key Encryption Keys (KEKs) and cross-machine emergency recovery envelopes.
- **Document Container Security (`LAISDOC1`) & Bank Registry Encryption (`LAIBANK1`)**: Supporting invoices, receipts, and BIR `2307` source attachments are stored in partitioned SHA-256 directories encrypted via per-document HKDF-SHA256 AES-256-GCM containers; sensitive bank account numbers are encrypted reversibly (`LAIBANK1`) with masked display values (`accountNumberMasked`).
- **Forensic Audit Sealing**: `audit_logs` enforces append-only database triggers (`BEFORE UPDATE` / `BEFORE DELETE` rejection) paired with a chained SHA-256 / HMAC-SHA256 hash chain whose secret resides outside the SQLite database inside `.keystore_vault`.

---

## 2. Applicable Taxpayer-Specific Requirements (RMC No. 5-2021, RMC No. 65-2025 & RA 11976)

Because BIR registration attaches to the **individual taxpayer-user and RDO jurisdiction** (not globally to a software vendor), each adopting business must configure and register its exact tax classification prior to live statutory use:

| Taxpayer Classification | Required LedgerAI PH Configuration | Mandatory Books & Statutory Outputs |
|:---|:---|:---|
| **VAT-Registered Corporation / Sole Proprietor** | `vatStatus = VAT_REGISTERED`, `vatFilingFrequency = QUARTERLY` (default `RMC 5-2023` `2550Q`, optional monthly `2550M` election per `RMC 52-2023`), line-level `VAT12`/`VAT0`/`VATEX` codes | General Journal, General Ledger, Sales Journal, Purchase Journal, Cash Receipts & Disbursements Journals, Subsidiary Ledgers, **Inventory Book** (if applicable), BIR Forms `2550Q` (optional `2550M`), `1601-C`, `0619-E`/`1601-EQ`, `0619-F`/`1601-FQ`, `2307`, `2316`, `1701`/`1702`, `SLSP` & `SAWT`/`QAP`/`Alphalist` exports. |
| **Non-VAT (Sec. 116 Percentage Tax)** | `vatStatus = NON_VAT`, Percentage Tax (`3%` standard / `1%` July 1, 2020–June 30, 2023 CREATE Act rate via versioned `PHILIPPINE_BIR_TAX_RULE_REGISTRY`) | All applicable CBA books & Subsidiary Ledgers above (excluding VAT journals), BIR Percentage Tax return (`2551Q`), withholding & annual ITR schedules (`1701`/`1702`), zero fabricated Output/Input VAT. |
| **Non-VAT (`8%` Optional Flat Income Tax — Individual)** | `8_PERCENT_FLAT` eligibility (`<= ₱3,000,000` gross threshold, `₱250,000` statutory exemption applied on annual computation) | Cash Receipts / Disbursements & General Ledgers, threshold monitoring, BIR Forms `1701Q`/`1701A` workpapers. |
| **Employers & Withholding Agents** | Active statutory tables (`RA 11199` SSS, `PHIC 5%`, `HDMF Circ. 460`, `TRAIN 2023+`, `RR 11-2018` EWT ATCs, `Sec. 57(A)` FWT) | Payroll Register, Employee/Payee Alphalists, BIR Forms `1601-C`, `0619-E`/`1601-EQ`, `0619-F`/`1601-FQ`, `2307`, `2306`, `2316`. |

---

## 3. Module Inventory, Computerized Books of Accounts & Retention Controls

### 3.1 Core Accounting & Compliance Module Inventory (16 Modules / 36 Submodules)

| Module Group | Core Functionality | BIR Compliance & Internal Control Feature |
|:---|:---|:---|
| **Accounting & General Ledger** | COA, Journals, Trial Balance, Periods, Forex | Immutable `POSTED` entries, reversal-only corrections, Soft/Hard period-close locks |
| **Sales & Receivables** | EOPT Sales Invoices, OR/CR collections, AR aging | Line-level `12%` Output VAT / `VAT0` / `VATEX`, BIR Form `2307` CWT tracking |
| **Procurement & Payables** | PO -> GRN -> 3-Way Match, Purchase Bills, AP aging | Line-level `12%` Input VAT claim tracking, explicit ATC EWT (`1601-EQ` / `2307`) with zero silent defaults |
| **Cash & Banking** | Cash Transactions, Checks, Deposits, Bank Recon | Tax-neutral COA cash/bank registry (`bank_accounts.gl_account_id`), zero auto-VAT/EWT inheritance |
| **Inventory & Fixed Assets** | FIFO / Weighted Avg Stock, Capitalization, Straight-Line Dep | Inventory Book & PPE valuation tied directly to GL control accounts (`1040`/`1080`, `1510`/`1511`, `5010`, `6020`) |
| **Payroll & Tax Compliance Engine** | Versioned PH Tax & Payroll tables (`PHILIPPINE_BIR_TAX_RULE_REGISTRY`) | `2550Q` (optional `2550M`), `2551Q`, `0619-E`, `1601-EQ`, `0619-F`, `1601-FQ`, `1601-C`, `2307`, `2316`, `QAP`, `SAWT`, `SLSP` |
| **Documents, OCR, Audit & RBAC** | `LAISDOC1` Vault, 14-stage 360° lineage, 9-Role Matrix | Role/user attribution (`Company Owner` full authority + Maker-Checker SoD), tamper-evident HMAC chain |

### 3.2 System-Generated Books of Accounts & Financial Reports (`JSON / CSV / XLSX / PDF`)
- **Books of Accounts**: General Journal, General Ledger, Sales Journal, Purchase Journal, Cash Receipts Journal, Cash Disbursements Journal, Customer/Vendor Subsidiary Ledgers, and **Inventory Book** *(where applicable for inventory-bearing taxpayers)*.
- **Financial & Statutory Reports**: Trial Balance, Statement of Financial Position (Balance Sheet), Statement of Comprehensive Income (Income Statement), Cash Flow Statement, Changes in Equity, `SLSP` / VAT Summary (`2550Q`/`2550M`), Withholding Tax Summary (`2307` / `0619-E` / `1601-EQ` / `1601-C` / `0619-F` / `1601-FQ`), and Payee/Employee Alphalists.

### 3.3 Data Retention & Immutability Controls
- **No Silent Deletion or Overwrite**: Posted accounting records and `audit_logs` rows are protected by SQLite triggers; corrections require formal reversal entries linked to the original transaction.
- **10-Year Retention Readiness**: Local `.lai` containers, encrypted `LAISDOC1` documents, and non-destructive shortcut controls preserve taxpayer company databases (`Documents\LedgerAI Companies` and `%APPDATA%\LedgerAI_Data\.keystore_vault`) for the mandatory **10-year BIR retention window** (`RR No. 5-2014`).

---

## 4. Itemized Supporting Documentation Checklist (Taxpayer RDO Submission)

Each taxpayer-user submitting LedgerAI PH (`1.0.0-rc.2`) to their Revenue District Office (RDO) under **RMC No. 5-2021** / **RMC No. 65-2025** must assemble the following packet:

- [ ] **1. BIR Application Form (BIR Form `1900` / Applicable Electronic CAS Application)** signed by authorized corporate officer or proprietor.
- [ ] **2. Sworn Statement & Undertaking** specifying exact software version (`LedgerAI PH 1.0.0-rc.2`), server/workstation host details, and adherence to no-backdating/no-deletion controls.
- [ ] **3. System Description & Architecture Summary** (Topology A LAN server, SQLite WAL + `LAISENC2` encryption, RBAC, Maker-Checker Segregation of Duties, and offline capability).
- [ ] **4. Complete Module Inventory & Business Process Flow** covering all 16 Modules & 36 Submodules across Sales-to-Cash, Procure-to-Pay, Inventory/Costing, Payroll, Bank Reconciliation, Tax Generation, and Period Closing.
- [ ] **5. Database Schema / Table & Field Dictionary** (Relational SQLite schema summary + COA Account Hierarchy mapping including `bank_accounts.gl_account_id`).
- [ ] **6. Audit Trail & Tamper-Resistance Specification** (`audit_logs` immutability triggers, HMAC-SHA256 verification, 360° Record Journey, 10-year retention controls).
- [ ] **7. Sample Computerized Books of Accounts (Electronic Exports from Taxpayer Workspace)**: General Journal, General Ledger, Sales Journal, Purchase Journal, Cash Receipts Journal, Cash Disbursements Journal, and Inventory Book.
- [ ] **8. Sample System-Generated Financial Statements & Tax Outputs**: Trial Balance, Balance Sheet, Income Statement, VAT/Percentage Tax Schedules, Sample `2307`, `1601-C`, `0619-E`/`1601-EQ`, `2550Q`, `2316`, and Alphalist extracts.
- [ ] **9. Independent Philippine CPA Parallel-Run Sign-Off (`REQ-EXT-CPA-001`)** & **Backup / Disaster Recovery SOP** (`.laibak` restore verification).

---

## 5. Step-by-Step Taxpayer BIR Registration Procedure

1. **Step 1 — Pre-Submission Software Configuration**: Provision a clean-start taxpayer workspace in LedgerAI PH (`1.0.0-rc.2`), confirm exact TIN, RDO code, Fiscal Year, VAT/Non-VAT/`8%` tax regime, and verified statutory rule effective dates.
2. **Step 2 — Parallel-Run & Sample Books Generation**: Execute independent CPA parallel-run validation (`REQ-EXT-CPA-001`) and export PDF/CSV/XLSX samples of all required Books of Accounts, Financial Statements, BIR schedules, and Audit Trail logs.
3. **Step 3 — Assemble & Sign Sworn RDO Application Packet**: Complete every item in Section 4 checklist above and attach corporate/proprietor signatory authority (Secretary's Certificate / DTI / SEC registration).
4. **Step 4 — File with Concerned BIR RDO & Conduct System Walkthrough (`REQ-EXT-BIR-001`)**: Submit the application to the taxpayer's RDO per **RMC No. 5-2021** and **RMC No. 65-2025**; demonstrate read-only immutability, audit trail chain verification, and books generation if inspected.
5. **Step 5 — Obtain BIR Acknowledgment Certificate (AC) Before Live Statutory Filing**: Record the official AC Number and issue date in Section 6 below. **Do not treat system-generated returns as BIR-registered outputs until the taxpayer's Acknowledgment Certificate is issued.**

---

## 6. BIR Acknowledgment Certificate (AC) Tracking Register (`EXTERNAL_SUBMISSION_PENDING`)

| Taxpayer Legal Name | TIN & Branch Code | RDO Code | Software Version | Tax Type / Books Scope | BIR AC / Permit Number | Issue Date | RDO Receiving / Approving Ref | Supporting Certificate Path | External Gate Status |
|:---|:---|:---:|:---:|:---|:---|:---:|:---|:---|:---:|
| `[Pending Taxpayer Filing]` | `___-___-___-___` | `___` | `1.0.0-rc.2` | `CAS / CBA` | `[EXTERNAL_SUBMISSION_PENDING]` | `—` | `[Pending]` | `[Pending]` | **`EXTERNAL_SUBMISSION_PENDING`** |

---

## 7. Explicit BIR & eFiling Boundary Disclaimer

*LedgerAI PH `1.0.0-rc.2` provides the accounting engine, computerized books, tax calculation schedules (`2550Q`/optional `2550M`, `2551Q`, `0619-E`/`1601-EQ`, `0619-F`/`1601-FQ`, `1601-C`, `2307`, `2316`, `1701`/`1702`, `SAWT`/`SLSP`), immutable audit trails, and technical documentation needed to support taxpayer registration under **BIR RMC No. 5-2021** and **RMC No. 65-2025**. **LedgerAI PH itself is NOT pre-registered or blanket-approved by the BIR, nor does it execute live transmission into BIR eFPS/eBIRForms.** Every adopting taxpayer remains solely responsible for obtaining independent CPA parallel-run sign-off (`REQ-EXT-CPA-001`), submitting its application to its cognizant RDO, obtaining its own **BIR Acknowledgment Certificate (AC)** (`REQ-EXT-BIR-001`), and completing Windows x64 host validation (`REQ-WIN-001`) where deployed on Windows workstations.*

---
**Prepared by:** LedgerAI PH Enterprise Readiness Team  
**Baseline Date:** 2026-11-17  
**Version:** `1.0.0-rc.2`


