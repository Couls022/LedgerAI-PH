# BIR CAS / CBA Registration Readiness Package — LedgerAI PH (`1.0.0-rc.1`)

**Regulatory References**: **BIR RMC No. 5-2021** (System Registration & Acknowledgment Certificate for CAS/CBA), **BIR RMC No. 65-2025** (Computerized Books of Accounts Clarification), **NIRC Sec. 235**, and **RR No. 5-2014** (10-Year Preservation of Books of Accounts and Records).  
**External Registration Status (`Gate 9`)**: **`EXTERNAL_SUBMISSION_PENDING`** *(Software capability is technically prepared; no BIR Acknowledgment Certificate has been issued. Software release does NOT confer taxpayer registration).*

---

## 1. System Description and Architecture

### 1.1 Application Overview
LedgerAI PH (`1.0.0-rc.1`) is an offline-first Computerized Accounting System (CAS) / Computerized Books of Accounts (CBA) platform built for Philippine businesses using **Topology A (Centralized LAN API Server)** architecture to enforce single-process SQLite WAL ownership (`PRAGMA journal_mode=WAL`), integer-centavo financial precision, and strict multi-company workspace isolation.

### 1.2 Cryptographic Security & Tamper-Resistance (`LAISENC2` / `LAISDOC1` / HMAC-SHA256)
- **Database Confidentiality (`LAISENC2`)**: Every company SQLite database is sealed at rest in an AES-256-GCM `.lai` container (`version: 2`, `aadVersion: 3`) with machine-bound `.keystore_vault` Key Encryption Keys (KEKs) and cross-machine emergency recovery envelopes.
- **Document Container Security (`LAISDOC1`)**: Supporting invoices, receipts, and BIR `2307` source attachments are stored in partitioned SHA-256 directories encrypted via per-document HKDF-SHA256 AES-256-GCM containers.
- **Forensic Audit Sealing**: `audit_logs` enforces append-only database triggers (`BEFORE UPDATE` / `BEFORE DELETE` rejection) paired with a versioned SHA-256 / HMAC-SHA256 hash chain whose secret is stored outside the SQLite database inside `.keystore_vault`.

---

## 2. Applicable Taxpayer-Specific Requirements (RMC No. 5-2021 & RMC No. 65-2025)

Because BIR registration attaches to the **individual taxpayer-user and RDO jurisdiction** (not globally to a software vendor), each adopting business must configure and register its exact tax classification prior to live statutory use:

| Taxpayer Classification | Required LedgerAI PH Configuration | Mandatory Books & Statutory Outputs |
|:---|:---|:---|
| **VAT-Registered Corporation / Sole Proprietor** | `vatStatus = VAT_REGISTERED`, `12%` Output/Input VAT, `12/112` extraction | General Journal, General Ledger, Sales Journal, Purchase Journal, Cash Receipts & Disbursements Journals, Subsidiary Ledgers, **Inventory Book** (if merchandising/manufacturing), BIR Forms `2550Q`, `1601-C`, `1601-EQ`/`0619-E`, `2307`, `2316`, `1701`/`1702`, `SLSP` & `SAWT`/`Alphalist` data exports. |
| **Non-VAT (Sec. 116 Percentage Tax)** | `vatStatus = NON_VAT`, Percentage Tax (`1%`/`3%`) profile | All applicable CBA books & Subsidiary Ledgers above (excluding VAT journals), BIR Percentage Tax return (`2551Q`), withholding & annual ITR schedules. |
| **Non-VAT (`8%` Optional Flat Income Tax — Individual)** | `8%` IT eligibility & election flag (`₱250,000` exemption where qualified) | Cash Receipts / Disbursements & General Ledgers, annual reconciliation against threshold, BIR Forms `1701Q`/`1701A` workpapers. |
| **Employers & Withholding Agents** | Active statutory tables (`RA 11199` SSS, `PHIC 5%`, `HDMF Circ. 460`, `TRAIN 2023+`) | Payroll Register, Employee/Payee Alphalists, BIR Forms `1601-C`, `1601-EQ`, `2307`, `2316`. |

---

## 3. Module Inventory, Computerized Books of Accounts & Retention Controls

### 3.1 Core Accounting & Compliance Module Inventory

| Module | Core Functionality | BIR Compliance & Internal Control Feature |
|:---|:---|:---|
| **General Ledger** | Double-entry journals, Trial Balance, BS, IS, CF, Equity | Immutable `POSTED` entries, reversal-only corrections, Soft/Hard period-close locks |
| **Accounts Receivable** | Sales invoices, Official Receipts, collections, AR aging | `12%` Output VAT calculation, BIR Form `2307` CWT tracking |
| **Accounts Payable** | Supplier bills, disbursements, AP aging | `12%` Input VAT claim tracking, EWT ATC calculation (`1601-EQ` / `2307`) |
| **Inventory & Costing** | Item master, stock movements, FIFO / Weighted Average | Inventory Book valuation & COGS reconciliation to `GL 1080` / `5010` |
| **Tax & Payroll Engine** | Statutory versioned rules (source, effective date, version) | `2550Q` quarterly completeness guards, `1601-C`, `1601-EQ`, `2316`, `Alphalist` |
| **Document Intelligence** | Offline Tesseract WASM + optional AI OCR | Mandatory human verification before GL posting; `LAISDOC1` binding |
| **Audit Journey & RBAC** | 14-stage 360° lineage, Maker-Checker SoD | Role/user attribution (`who`, `when`, before/after), tamper-evident HMAC chain |

### 3.2 System-Generated Books of Accounts & Financial Reports (`JSON / CSV / XLSX / PDF`)
- **Books of Accounts**: General Journal, General Ledger, Sales Journal, Purchase Journal, Cash Receipts Journal, Cash Disbursements Journal, Customer/Vendor Subsidiary Ledgers, and **Inventory Book** *(where applicable for inventory-bearing taxpayers)*.
- **Financial & Statutory Reports**: Trial Balance, Statement of Financial Position (Balance Sheet), Statement of Comprehensive Income (Income Statement), Cash Flow Statement, Changes in Equity, Summary List of Sales/Purchases (`VAT Summary`), Withholding Tax Summary (`2307` / `1601-EQ` / `1601-C`), and Payee/Employee Alphalists.

### 3.3 Data Retention & Immutability Controls
- **No Silent Deletion or Overwrite**: Posted accounting records and `audit_logs` rows are protected by SQLite triggers; corrections require formal reversal entries linked to the original transaction.
- **10-Year Retention Readiness**: Local `.lai` containers, encrypted `LAISDOC1` documents, and uninstallation safeguards preserve all taxpayer data directories (`Documents\LedgerAI Companies` and `%APPDATA%\LedgerAI_Data\.keystore_vault`) for the mandatory **10-year BIR retention window** (`RR No. 5-2014`, hard-copy/electronic rules subject to taxpayer archival storage).

---

## 4. Itemized Supporting Documentation Checklist (Taxpayer RDO Submission)

Each taxpayer-user submitting LedgerAI PH (`1.0.0-rc.1`) to their Revenue District Office (RDO) under **RMC No. 5-2021** / **RMC No. 65-2025** must assemble the following packet:

- [ ] **1. BIR Application Form (BIR Form `1900` / Applicable Electronic CAS Application)** signed by authorized corporate officer or proprietor.
- [ ] **2. Sworn Statement & Undertaking** specifying exact software version (`LedgerAI PH 1.0.0-rc.1`), server/workstation host details, and adherence to no-backdating/no-deletion controls.
- [ ] **3. System Description & Architecture Summary** (Topology A LAN server, SQLite WAL + `LAISENC2` encryption, RBAC, Maker-Checker Segregation of Duties, and offline capability).
- [ ] **4. Complete Module Inventory & Business Process Flow** covering Sales-to-Cash, Procure-to-Pay, Inventory/Costing, Payroll, Bank Reconciliation, Tax Generation, and Period Closing.
- [ ] **5. Database Schema / Table & Field Dictionary** (97-table relational SQLite schema summary + COA Account Hierarchy mapping).
- [ ] **6. Audit Trail & Tamper-Resistance Specification** (`audit_logs` immutability triggers, HMAC-SHA256 verification, 14-stage 360° Record Journey, 10-year retention controls).
- [ ] **7. Sample Computerized Books of Accounts (Electronic Exports from Taxpayer Workspace / Pilot Baseline)**:
  - Sample **General Journal** & **General Ledger**
  - Sample **Sales Journal** & **Purchase Journal**
  - Sample **Cash Receipts Journal** & **Cash Disbursements Journal**
  - Sample **Inventory Book** *(mandatory where taxpayer maintains merchandise, raw materials, or finished goods inventory)*
- [ ] **8. Sample System-Generated Financial Statements & Tax Outputs**: Trial Balance, Balance Sheet, Income Statement, VAT Sales/Purchase Schedules, Sample `2307`, `1601-C`, `1601-EQ`, `2550Q`, `2316`, and Alphalist extracts.
- [ ] **9. Backup, Recovery & Disaster Continuity SOP** (documenting `.lai` container restore testing, `.keystore_vault` key protection, and emergency recovery drill).

---

## 5. Step-by-Step Taxpayer BIR Registration Procedure

1. **Step 1 — Pre-Submission Software Configuration**: Provision the taxpayer company workspace in LedgerAI PH (`1.0.0-rc.1`), confirm exact TIN, RDO code, Fiscal Year, VAT/Non-VAT tax regime, and verified statutory rule effective dates.
2. **Step 2 — Generate Sample Books & Audit Evidence**: Post representative sample/pilot transactions (or generate from `LGR-PH-2026-PILOT-CLEAN-01` walkthroughs) and export PDF/CSV/XLSX samples of all required Books of Accounts, Financial Statements, BIR schedule previews, and Audit Trail logs.
3. **Step 3 — Assemble & Sign Sworn RDO Application Packet**: Complete every item in Section 4 checklist above and verify taxpayer signatory authority (Secretary's Certificate / DTI / SEC registration).
4. **Step 4 — File with Concerned BIR RDO & Conduct System Walkthrough (If Requested)**: Submit the application to the taxpayer's RDO per **RMC No. 5-2021** and **RMC No. 65-2025**; demonstrate read-only immutability, audit trail chain verification, and books generation if inspected.
5. **Step 5 — Obtain BIR Acknowledgment Certificate (AC) Before Live Statutory Filing**: Record the official AC Number and issue date in Section 6 below. **Do not treat system-generated returns as BIR-registered outputs until the taxpayer's Acknowledgment Certificate is issued.**

---

## 6. BIR Acknowledgment Certificate (AC) Tracking Register (`EXTERNAL_SUBMISSION_PENDING`)

| Taxpayer Legal Name | TIN & Branch Code | RDO Code | Software Version | Tax Type / Books Scope | BIR AC / Permit Number | Issue Date | RDO Receiving / Approving Ref | Supporting Certificate Path | External Gate Status |
|:---|:---|:---:|:---:|:---|:---|:---:|:---|:---|:---:|
| `[Pending Taxpayer Filing]` | `___-___-___-___` | `___` | `1.0.0-rc.1` | `CAS / CBA` | `[EXTERNAL_SUBMISSION_PENDING]` | `—` | `[Pending]` | `[Pending]` | **`EXTERNAL_SUBMISSION_PENDING`** |

---

## 7. Explicit BIR Non-Registration Disclaimer

*LedgerAI PH provides the accounting engine, computerized books, tax calculation schedules, immutable audit trails, and technical documentation needed to support taxpayer registration under **BIR RMC No. 5-2021** and **RMC No. 65-2025**. **LedgerAI PH `1.0.0-rc.1` itself is NOT pre-registered or blanket-approved by the BIR for any taxpayer.** Every adopting taxpayer remains solely responsible for submitting its application, supporting sample books, and sworn statements to its cognizant Revenue District Office (RDO) and obtaining its own **Acknowledgment Certificate (AC)** prior to live commercial statutory reliance.*

---
**Prepared by:** LedgerAI PH Enterprise Readiness Team  
**Handoff Baseline Date:** 2026-11-14  
**Version:** `1.0.0-rc.1`

