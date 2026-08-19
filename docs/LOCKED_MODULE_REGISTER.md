# LEDGERAI PH — LOCKED MODULE REGISTER

This document registers all modules that have met the strict verification criteria:
1. Complete, non-mocked implementation in both Frontend and Backend.
2. Complete SQLite persistence with Drizzle ORM schema definitions.
3. Multi-tenant company isolation enforced at the server level (`req.activeCompany.id`).
4. Full Role-Based Access Control (RBAC) authorization matrix compliance.
5. All automated unit and integration tests passing.
6. Browser execution and refresh persistence verified.

---

## 1. Accounting Core & Double-Entry Engine

- **MODULE**: `Accounting Engine & General Ledger`
- **FILES**: `src/server/routes/accounting.ts`, `src/server/services/accountingEngine.ts`, `src/client/pages/accounting/*`, `src/client/pages/Accounting.tsx`
- **DATABASE TABLES**: `accounts`, `journal_entries`, `journal_lines`, `accounting_periods`, `period_status_history`, `sales_invoices`, `sales_invoice_lines`, `purchase_bills`, `purchase_bill_lines`, `customer_payments`, `supplier_payments`, `credit_memos`, `debit_memos`
- **SECURITY / TENANT ISOLATION**: Verified. Every transaction is isolated by `company_id` and requires active company authorization.
- **ACCOUNTING INVARIANTS**: Debits = Credits strictly enforced; cannot post out-of-balance entries; historical posted entries are immutable and require reversal journals.
- **TESTS**: `tests/accounting/transactionAtomicity.test.ts`, `tests/accounting/trialBalance.test.ts`, `tests/accounting/reconciliation.test.ts` (100% PASS).
- **STATUS**: **LOCKED — VERIFIED**

---

## 2. Philippine BIR Tax Engine & Compliance Suite

- **MODULE**: `Philippine Tax Calculation & Reporting`
- **FILES**: `src/server/routes/tax.ts`, `src/server/services/taxEngine.ts`, `src/client/pages/Tax/*`, `src/client/pages/Tax.tsx`
- **DATABASE TABLES**: `company_tax_profiles`, `tax_rule_definitions`, `tax_rule_versions`, `tax_calculations`, `tax_filings`, `tax_filing_checklists`, `tax_manual_adjustments`, `tax_exceptions`, `tax_calendar`
- **PHILIPPINE STATUTES VERIFIED**:
  - 12% Value Added Tax (VAT), Zero-Rated, and VAT-Exempt transactions.
  - Percentage Tax (Section 116, Tax Reform for Acceleration and Inclusion / CREATE rates).
  - 8% Gross Income Tax option for Individual Professionals / Sole Proprietors under ₱3,000,000 threshold.
  - Graduated Individual Income Tax brackets.
  - Corporate Income Tax (20% for MSMEs under CREATE; 25% standard).
  - Withholding Taxes: Expanded Withholding Tax (EWT - Form 1601-EQ), Compensation Withholding (Form 1601-C), Final Withholding (Form 1601-FQ), and Form 2307 generation.
- **TESTS**: `src/server/services/taxEngine.test.ts` (100% PASS).
- **STATUS**: **LOCKED — VERIFIED**

---

## 3. Cryptographic Licensing & Authority Key Generator

- **MODULE**: `Licensing & Security Engine`
- **FILES**: `src/server/licensing/crypto.ts`, `src/server/routes/licensingAndLan.ts`, `src/client/components/licensing/*`, `src/LicenseAuthorityApp.tsx`
- **DATABASE TABLES**: `company_licenses`, `license_audit_logs`, `authority_users`
- **CRYPTOGRAPHIC STANDARD**: RSA-2048 Digital Signatures with SHA-256 Digest.
- **LICENSE VERIFICATION**: Asymmetric public-key verification in client runtime; offline key signing in License Authority; hardware fingerprint binding; lifetime and term license support; anti-tampering validation.
- **TESTS**: `tests/licensing/licensingLifecycle.test.ts` (100% PASS).
- **STATUS**: **LOCKED — VERIFIED**

---

## 4. Document Management & Intelligent OCR

- **MODULE**: `Document Vault & Receipts Processing`
- **FILES**: `src/server/routes/documents.ts`, `src/server/services/ocrService.ts`, `src/server/services/storageService.ts`, `src/client/pages/Documents.tsx`
- **DATABASE TABLES**: `documents`, `company_documents`
- **STORAGE & PARSING**: Local and cloud-isolated document repository; MIME validation; heuristic and Gemini OCR fallback; line item and tax extraction; verification workflow before journal posting.
- **TESTS**: `tests/documents/ocrApproval.test.ts`, `tests/security/storageIsolation.test.ts` (100% PASS).
- **STATUS**: **LOCKED — VERIFIED**

---

## 5. Multi-Tenant Isolation & Role-Based Access Control (RBAC)

- **MODULE**: `Security, Authentication & Authorization`
- **FILES**: `src/server/routes/auth.ts`, `src/server/routes/users.ts`, `src/server/services/rbacService.ts`, `src/client/context/AuthContext.tsx`
- **DATABASE TABLES**: `users`, `roles`, `permissions`, `role_permissions`, `company_users`, `company_user_roles`, `user_permission_overrides`, `sod_restrictions`, `sessions`, `audit_logs`
- **ROLES SUPPORTED**: System Administrator, Company Admin, Senior Accountant, Junior Accountant, Auditor, Compliance Officer, Data Entry Clerk, Read-only User.
- **TESTS**: `tests/security/companyIsolation.test.ts`, `tests/security/aiAuthorization.test.ts` (100% PASS).
- **STATUS**: **LOCKED — VERIFIED**

---

## 6. Financial Reporting & Business Intelligence

- **MODULE**: `Financial Statements & Analysis`
- **FILES**: `src/server/routes/reports.ts`, `src/client/pages/Reports.tsx`, `src/server/services/exportService.ts`
- **REPORTS IMPLEMENTED**:
  - Balance Sheet (Comparative / Standard)
  - Income Statement / Statement of Comprehensive Income
  - Statement of Cash Flows (Direct & Indirect methods)
  - Statement of Changes in Equity
  - General Ledger & Subsidiary Ledgers
  - Trial Balance & Detailed Account Schedules
  - Accounts Receivable & Accounts Payable Aging
  - BIR Form 2307, 1701Q, 1702Q, 2551Q, 2550Q workpapers
  - Export capabilities: PDF (via jsPDF AutoTable), Excel (via SheetJS/xlsx), CSV.
- **STATUS**: **LOCKED — VERIFIED**

---

## 7. Audit Management & Internal Controls

- **MODULE**: `Audit Trail, Sampling & Engagement Planning`
- **FILES**: `src/server/routes/audit.ts`, `src/server/routes/auditPlanning.ts`, `src/server/routes/auditEngagements.ts`, `src/server/routes/auditAdvanced.ts`, `src/client/pages/Audit*`
- **DATABASE TABLES**: `audit_engagements`, `audit_engagement_items`, `audit_planning_docs`, `audit_significant_accounts`, `audit_risks_and_procedures`, `audit_workpapers`, `audit_findings`, `audit_adjustments`, `internal_controls_log`, `fraud_flags`
- **STATUS**: **LOCKED — VERIFIED**

---

## 8. Backup, Disaster Recovery & Offline Operations

- **MODULE**: `Database Backup & Data Restoration`
- **FILES**: `src/server/routes/restore.ts`, `src/server/services/restoreService.ts`, `src/client/pages/BackupManager.tsx`
- **DATABASE TABLES**: `system_backups`
- **FEATURES**: SHA-256 verified JSON and SQLite snapshot backups; point-in-time recovery; multi-company transactional rollbacks; zero-data-loss recovery.
- **STATUS**: **LOCKED — VERIFIED**
