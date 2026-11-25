# LedgerAI PH — Production Operations & Disaster Recovery Runbook

## 1. System Overview & Architecture
LedgerAI PH is a secure enterprise accounting and tax compliance application designed for Philippine regulatory standards (BIR, EOPT, CREATE Act, Alphalist, Withholding Taxes). It utilizes encrypted SQLite storage containers (`.lai` format) secured with AES-256-GCM encryption and PBKDF2 key derivation.

## 2. Startup & Initialization
- **Prerequisites**: Node.js 18+ runtime environment.
- **Environment Variables**:
  - `LEDGERAI_MASTER_KEY`: Master encryption secret (minimum 16 characters). Must be securely provisioned via environment configuration. Never commit secrets to version control.
  - `NODE_ENV`: Set to `production` for production deployments.
- **Startup Command**:
  ```bash
  npm run build
  npm start
  ```
- **Startup Validation**: On boot, the application automatically validates environment configuration, encryption secrets, directory permissions, and database availability.

## 3. Health Monitoring & Endpoints
- **Endpoint**: `GET /api/health`
- **Response Format**:
  ```json
  {
    "status": "healthy",
    "application": "LedgerAI PH",
    "version": "1.0.0",
    "environment": "production",
    "database": "ready",
    "encryptionConfigValid": true,
    "timestamp": "2026-08-17T04:00:00.000Z"
  }
  ```
- **Interpretation**: A `status` of `"healthy"` with `encryptionConfigValid: true` and `database: "ready"` indicates full operational readiness. A `"degraded"` status indicates missing master key configuration or database connectivity issues.

## 4. Backup & Restore Operations
- **Export Backup**: Authorized users can export encrypted `.lai` database backups via the Backup / Restore management interface or `/api/restore/export`.
- **Backup Verification**: All exports include cryptographic checksums and are validated before download.
- **Restore Procedure**:
  1. Upload `.lai` or `.lgb` backup container.
  2. The system verifies checksums and decrypts the container into an isolated workspace using atomic temporary file operations.
  3. Tenant isolation and company ID validations ensure cross-company data contamination is strictly prevented.

## 5. Disaster Recovery & Failure Modes
- **Corrupted or Truncated Backup**: Rejected immediately during checksum / magic header validation (`LAISENC1`). No accounting records are altered or corrupted.
- **Key Mismatch / Tag Failure**: If `LEDGERAI_MASTER_KEY` does not match the key used to encrypt a `.lai` file, decryption throws a secure `DECRYPTION_FAILED` error without exposing plaintext or master keys.
- **Interrupted Restore / Writeback**: Utilizes atomic rename operations (`.tmp` -> final path) to guarantee that partial writes never corrupt active databases.

## 6. Security & Tenant Isolation
- **Encryption at Rest**: All company databases are encrypted using AES-256-GCM.
- **RBAC & Authorization**: Strict role-based access control and company ID context middleware prevent IDOR and unauthorized cross-company access.
- **Data Privacy (RA 10173)**: Sensitive taxpayer information (TINs, financial records) is protected with strict least-privilege access and audit logging.

## 7. Troubleshooting & Operational Support
- **Operational Logs**: Outputted in structured JSON format prefixed with `[OPERATIONAL-LOG]`. Sensitive data (keys, passwords, tokens, raw TINs) are automatically redacted.
- **Compliance Audit Logs**: Stored separately in the database audit trail for regulatory and compliance review.

## 8. Real-Company Pilot Onboarding & Cutover Checklist (Controlled Pilot Protocol)
Before onboarding any real Philippine business into a controlled pilot environment, the implementing accountant and system administrator MUST complete and sign off every step below. **Never import demo or stress-test transactions into a live company database.**

1. **Company Profile & Zero-Data Initialization**:
   - Create a fresh company via `/api/companies/create` using `BLANK_ZERO_COA` or an explicit Philippine COA starter template (`POST /api/master-data/accounts/seed-template`).
   - Confirm zero synthetic transactions exist in `journal_entries`, `invoices`, `bills`, and `bank_transactions`.
2. **Philippine Tax Profile Verification**:
   - Verify TIN (3-3-3-5 format), RDO Code, taxpayer classification (`VAT-Registered 12%` vs `Non-VAT 3% Percentage Tax`), fiscal/calendar year, and VAT filing election (`Form 2550Q` mandatory quarterly per RMC 5-2023; optional monthly `Form 2550M` per RMC 52-2023).
   - Verify ATC withholding tax codes (`WC158`, `WC160`, `WI010`, `WC100`, etc.) and Form 2307 certificate mapping.
3. **Chart of Accounts (COA) Setup & Control Mapping**:
   - Finalize company-specific COA (`1000`–`6999` or custom numbering), verifying Detail Types, BIR Tax Categories, and leaf/postable flags.
   - Verify all Tax Codes, Bank Accounts, AR/AP Control Accounts, Inventory, and Payroll Liability accounts map to active, postable COA leaf accounts.
4. **Opening Balance Cutover & Trial Balance Reconciliation**:
   - Post a balanced Opening Balance Journal Entry (DR = CR) matching the prior period's CPA-audited ending Trial Balance.
   - Verify Trial Balance shows `BALANCED` (`variance = ₱0.00`).
5. **Customer & Supplier Subledger Migration**:
   - Import active Customers and Vendors with validated TINs, addresses, payment terms, and EWT applicability.
   - Reconcile opening AR and AP subledger totals directly against GL control accounts (`1200` / `2000`).
6. **Inventory Opening Balance Cutover**:
   - Record opening stock quantities, UOMs, and unit costs (FIFO or Weighted Average).
   - Reconcile Inventory Valuation Report total against GL Inventory Control account (`1300`).
7. **Bank Opening Balance & Initial Reconciliation**:
   - Register all depository bank accounts in COA (automatically mirrored into `bank_accounts`).
   - Import baseline statement balances, identify outstanding checks and deposits in transit, and perform initial Bank Reconciliation.
8. **User Accounts, RBAC & Maker-Checker Approval Matrix**:
   - Provision individual accounts for Company Owner, Accountant, Bookkeeper, Approver, Tax & AP Specialist, and Auditor using least-privilege roles.
   - Configure Approval Policy Matrix thresholds and verify Maker-Checker Segregation of Duties (makers cannot self-approve in multi-user companies).
9. **Supporting Document Vault Migration**:
   - Upload BIR Form 2303 (COR), DTI/SEC registration, and baseline supporting documents into the encrypted Document Vault (`documents`).
10. **Automated Backup & 30-Day Archive Retention Verification**:
    - Verify `AutomatedBackupScheduler` status (`GET /api/backup/status`) is `CURRENT` and execute one isolated restore drill into a sandbox folder.
    - Verify `ArchiveRetentionScheduler` status (`GET /api/master-data/archived-records/retention-status`) is running with BIR 10-year statutory retention exemptions active (`RR 17-2013` / `RR 5-2014`).
11. **Month-End Closing & Financial Report Sign-Off**:
    - Execute recurring journals, depreciation runs, bank reconciliation, VAT/EWT accruals, and period soft-lock/close.
    - Validate General Ledger, Trial Balance, Balance Sheet, Income Statement, Cash Flow, AR/AP Aging, and BIR tax schedules with an independent Philippine CPA (`REQ-EXT-CPA-001`) before relying on external filings.
12. **User Training & Incident Escalation**:
    - Train staff using `LEDGERAI_PH_USER_MANUAL.md` and the built-in Ledger Agent knowledge base.
    - Document escalation contacts for accounting anomalies, backup recovery, and BIR filing deadlines.

## 9. External Production Gates (Separate From Application Readiness)
- **`REQ-EXT-CPA-001`**: Independent Philippine CPA review & formal sign-off on accounting policies, COA, postings, and tax schedules.
- **`REQ-EXT-BIR-001`**: Taxpayer-specific BIR CAS/CBA registration and documentary acknowledgment certificate (`RMC 5-2021` / `RMC 65-2025`).
- **`REQ-WIN-001`**: Native Windows 10/11 x64 packaging, NSIS installer, DPAPI/NTFS ACL, and upgrade/uninstall verification (`WIN-01`..`WIN-20`) executed on a native Windows host or Windows CI runner.

