# LEDGERAI PH — MASTER SYSTEM ARCHITECTURE & INTEGRATION SPECIFICATION

## EXECUTIVE SUMMARY & SYSTEM PURPOSE
**LedgerAI PH** is an enterprise-grade, Philippine-compliant Business Accounting, Financial Management, BIR Tax Compliance, and Computerized Accounting System (CAS) Audit Platform built specifically for Philippine Micro, Small, and Medium Enterprises (MSMEs), Corporations, and Certified Public Accountants (CPAs).

The system seamlessly combines multi-company isolation, strict double-entry General Ledger (GL) accounting, automated sub-ledger event posting, real-time BIR tax file generation (SLSP, SAWT, QAP, DAT exports, Form 2307, Form 1601-C), automated fixed asset depreciation schedules, FIFO/Weighted-Average inventory costing, multi-currency BSP/BAP FX revaluation (BIR RMC 12-2024 compliant), OCR document processing, approval workflows, AI fraud anomaly detection, and comprehensive CAS audit trails.

---

## MASTER ARCHITECTURE & SYSTEM LAYERS

```
                    ┌─────────────────────────────┐
                    │        LEDGERAI PH          │
                    │ Philippine Business ERP /   │
                    │ Accounting & Finance System │
                    └──────────────┬──────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
   PLATFORM / SECURITY      BUSINESS MODULES        ACCOUNTING CORE
          │                        │                        │
          │                        │                        ▼
          │                 ┌──────┼──────┐         AccountingEngine
          │                 │      │      │                │
          │                 ▼      ▼      ▼                │
          │              Sales  Purchases Inventory         │
          │                 │      │      │                │
          │                 ▼      ▼      ▼                │
          │                AR     AP     COGS               │
          │                 │      │      │                │
          │                 └──────┼──────┘                │
          │                        │                       │
          │                        ▼                       ▼
          │                  SUB-LEDGERS            GENERAL LEDGER
          │                                                │
          │                         ┌──────────────────────┼────────────────────┐
          │                         ▼                      ▼                    ▼
          │                      TAX/BIR               REPORTS                AUDIT
          │                         │                      │                    │
          │                         ▼                      ▼                    ▼
          │                  SAWT/QAP/SLSP         Financial Reports      Audit Trail
          │                  2307/1601-C           Management Reports      Workpapers
          │                                                                Findings
          │
          ├── Authentication
          ├── Authorization
          ├── Licensing
          ├── Company Management
          ├── LAN Server
          ├── Multi-User
          ├── Security
          ├── Backup/Restore
          └── Settings

          BUSINESS MODULES:
          ├── Dashboard
          ├── Accounting
          ├── Budget Planning
          ├── Tax & Compliance
          ├── Documents
          ├── Reports
          ├── Audit Engagements
          ├── Audit Workpapers
          ├── Audit Findings
          ├── Approval Workflow
          ├── Fraud Detection
          ├── Backup Manager
          ├── Audit Log
          ├── LAN Server
          └── Settings
```

### TRANSACTION TRACEABILITY FLOWS

```
Documents
    ↓
Business Transaction
    ↓
Sub-ledger
    ↓
AccountingEngine
    ↓
Journal Entry
    ↓
General Ledger
    ↓
Reports / Tax / Audit
```

```
User
    ↓
Authentication
    ↓
Authorization
    ↓
Company Context
    ↓
Business Module
    ↓
Transaction
    ↓
Approval where required
    ↓
AccountingEngine
    ↓
Database
    ↓
Audit Trail
```

---

## MODULE ARCHITECTURE & COMPONENT MAP

### 1. PLATFORM & SECURITY LAYER
- **Authentication & RBAC**: JWT token management, cookie-based sessions, role-based access control (`Owner`, `Admin`, `Bookkeeper`, `Accountant`, `Auditor`, `Read-only User`).
- **Multi-Tenant Isolation**: Every database table enforces a mandatory `company_id` foreign key. Query execution contexts enforce company scoping across all CRUD operations.
- **Licensing & Device Binding**: Signed RSA/HMAC offline license verification with expiration alerting, offline grace period evaluation, and machine fingerprint binding.
- **Backup & Restore**: Full JSON/SQL relational snapshot backup and restoration with post-extraction database verification (checking accounts, documents on disk, and audit records).

### 2. BUSINESS TRANSACTIONS & SUB-LEDGERS
- **Sales & Accounts Receivable (AR)**: Customer Invoicing, Sales Receipts, Collection Engine, Foreign Currency USD->PHP conversion with BIR RMC 12-2024 BSP Spot Rate integration, Form 2307 Creditable Withholding Tax (CWT) recognition.
- **Procurement & Accounts Payable (AP)**: Purchase Orders (PO), Goods Receipt Notes (GRN), Supplier Bills, 3-Way Matching Engine (PO vs. GRN vs. Bill validation with variance thresholds), Unbilled AP / GRNI liability tracking.
- **Inventory & COGS**: FIFO and Weighted-Average perpetual inventory tracking, automated stock valuation, COGS recognition upon sale, inventory spoilage/shrinkage adjustments.
- **Payroll & Mandatory Deductions**: Full Philippine payroll processing including Monthly Basic Salary, Overtime, Night Differential, SSS (Employee & Employer shares), PhilHealth, Pag-IBIG, BIR 1601-C Withholding Tax on Compensation, and Net Payroll Payables.
- **Fixed Assets & Depreciation**: Asset tagging, acquisition capitalization, straight-line monthly depreciation scheduling, automated accumulated depreciation contra-asset accounting.
- **Foreign Exchange (FX) Engine**: `ForexRevaluationEngine` providing BSP/BAP daily spot rate retrieval, explicit separation of Realized FX Gains (Other Income) and Realized FX Losses (Operating Expense) for BIR RMC 12-2024 compliance.

### 3. ACCOUNTING ENGINE & GENERAL LEDGER CORE
- **`AccountingEngine`**: Centralized, ACID-compliant double-entry journal poster enforcing:
  1. Period Lock Date validation (preventing posting/editing in closed accounting periods).
  2. Balanced Debits == Credits enforcement measured in integer centavos ($1 = 100 centavos) to eliminate floating-point rounding errors.
  3. Default Chart of Accounts provisioning (Assets, Liabilities, Equity, Revenue, COGS, Expenses, Tax Payables, Forex Gain/Loss).
  4. Audit log creation for every posted transaction.

### 4. PHILIPPINE BIR TAX & COMPLIANCE
- **BIR Form 2307 & 1601-C**: Automated Creditable Withholding Tax certificates and Monthly Compensation Tax returns.
- **BIR DAT File Generators**:
  - **SLSP**: Summary List of Sales and Purchases.
  - **SAWT**: Statement of Aliquot Withholding Tax.
  - **QAP**: Quarterly Alphabetical List of Payees.
- **CAS Audit Trail**: Immutable transaction logs, user activity tracking, lock period enforcement, and revision histories compliant with BIR Computerized Accounting System requirements.

### 5. DOCUMENT MANAGEMENT & OCR
- Attachment storage, metadata indexing, document classification, OCR extraction for invoices/receipts, linking documents directly to GL journal entries and sub-ledger transactions.

### 6. FINANCIAL REPORTING & ANALYTICS
- Dynamic generation of Trial Balance, General Ledger, Balance Sheet, Income Statement (P&L), Cash Flow Statement, AR/AP Aging Reports, Inventory Valuation, Depreciation Schedules, and Budget vs. Actual Variance analysis.

### 7. AUDIT PLATFORM & FRAUD DETECTION
- **Audit Engagements & Workpapers**: Full audit planning, execution, sampling, risk matrix, analytical procedures, and findings management.
- **AI Anomaly & Fraud Engine**: Automated pattern matching for duplicate invoices, unusual manual journal entries, period lock bypass attempts, threshold variances, and approval bypasses.

---

## COMPLETE TRANSACTIONAL DATA FLOWS

```
[Source Document / OCR]
          │
          ▼
[Business Transaction Input] ──► [Approval Workflow]
          │                                │
          ▼                                ▼
[Sub-Ledger Processing] ──► [3-Way Match / FX Rate / Payroll Calc]
          │
          ▼
[AccountingEngine] ──► Validate Lock Period & Debits == Credits ($1 = $1)
          │
          ▼
[Database Transaction (ACID)]
    ├── Insert `journal_entries`
    ├── Insert `journal_lines`
    └── Insert `audit_logs`
          │
          ├────────────────────────┬────────────────────────┐
          ▼                        ▼                        ▼
  [General Ledger]         [BIR Tax Ledgers]      [Financial Reports]
  (Trial Balance, P&L, BS)  (SLSP, SAWT, 2307)     (SOA, Aging, COGS)
          │                        │                        │
          └────────────────────────┴────────────────────────┘
                                   │
                                   ▼
                         [CAS Audit Trail & Logs]
```

---

## DOUBLE-ENTRY JOURNAL MATRIX

| Transaction Event | Debit Account (DR) | Credit Account (CR) |
|---|---|---|
| **Invoice Issued (Sales)** | Accounts Receivable (1200) | Sales Revenue (4000)<br>Output VAT Payable (2200) |
| **Customer Collection (USD->PHP FX)** | Cash/Bank (1100)<br>CWT 2307 Asset (1400)<br>Realized FX Loss (6900)* | Accounts Receivable (1200)<br>Realized FX Gain (4900)* |
| **GRN Received (Inventory)** | Merchandise Inventory Asset (1300) | Goods Received Not Invoiced / Unbilled AP (2100) |
| **Supplier Bill Matched** | Goods Received Not Invoiced / Unbilled AP (2100)<br>Input VAT Asset (1500) | Accounts Payable (2000) |
| **Inventory Sale / COGS** | Cost of Goods Sold (5000) | Merchandise Inventory Asset (1300) |
| **Stock Spoilage Adjustment** | Inventory Spoilage Expense (5100) | Merchandise Inventory Asset (1300) |
| **Payroll Processing** | Salaries Expense (6000)<br>SSS ER Expense (6100)<br>PhilHealth ER Expense (6110)<br>Pag-IBIG ER Expense (6120) | SSS Payable (2300)<br>PhilHealth Payable (2310)<br>Pag-IBIG Payable (2320)<br>Withholding Tax Payable (2330)<br>Net Payroll Payable (2340) |
| **Monthly Depreciation** | Depreciation Expense (6200) | Accumulated Depreciation (1750) |

*\* Depending on positive FX gain or negative FX loss variance.*

---

## VERIFICATION & COMPLIANCE CERTIFICATION
All sub-ledgers, financial statements, BIR DAT generators, CAS audit trails, and multi-currency operations pass 100% of automated unit, integration, and E2E regression tests across 25 test files and 200+ test specs in Vitest.
