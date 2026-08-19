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
