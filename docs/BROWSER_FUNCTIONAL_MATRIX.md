# LEDGERAI PH — BROWSER FUNCTIONAL MATRIX

Total Client Views Audited: 28 Pages & Modals across `src/client/pages/` and `src/client/components/`.

| VIEW / COMPONENT | USER ACTIONS AUDITED | REFRESH PERSISTENCE | ERROR / EMPTY STATES | STATUS |
| :--- | :--- | :--- | :--- | :--- |
| `Dashboard.tsx` | Metric cards, Budget widget, Cash Flow charts, D3 visualizers, Quick actions | Verified | Graceful empty widgets | **LOCKED — VERIFIED** |
| `Accounting.tsx` & `Journals.tsx` | New JV, Post JV, Reverse Entry, Filter by Period, Account Search | Verified | Balanced debit/credit validation | **LOCKED — VERIFIED** |
| `SalesInvoicing.tsx` & `ProcurementMatching.tsx` | Create Invoice, Add Lines, Tax Code selection, Print, PDF Export | Verified | Required field validation | **LOCKED — VERIFIED** |
| `BankReconciliation.tsx` | Import Statement, Auto-Match, Manual Adjustment, Reconciliation Lock | Verified | Discrepancy indicator | **LOCKED — VERIFIED** |
| `FixedAssetsRegister.tsx` | Add Asset, Generate Depreciation, Post Monthly Depreciation JV | Verified | Depreciation schedule validation | **LOCKED — VERIFIED** |
| `Tax.tsx` & `TaxForms.tsx` | View Tax Calendar, Compute 2550Q / 1702Q, Generate 2307 Certificate | Verified | Statutory deadline calculation | **LOCKED — VERIFIED** |
| `Form2307DigitalTool.tsx` | Select Payee, Select ATC (WI158/WC158/etc.), Compute EWT, Export PDF | Verified | ATC rate table binding | **LOCKED — VERIFIED** |
| `Documents.tsx` | Drag-and-drop upload, OCR extraction, Review line items, Post to AP | Verified | MIME & file size checks | **LOCKED — VERIFIED** |
| `Reports.tsx` | Balance Sheet, Income Statement, Trial Balance, Cash Flows, PDF/Excel Export | Verified | Zero-division & balance checks | **LOCKED — VERIFIED** |
| `Audit.tsx` & `AuditWorkpapers.tsx` | Create Engagement, Add Lead Sheet, Upload Workpaper, Log Finding | Verified | Versioning & immutable logs | **LOCKED — VERIFIED** |
| `BackupManager.tsx` | Create Full JSON/SQLite Backup, Verify Checksum, Trigger Point-in-time Restore | Verified | Transactional rollback | **LOCKED — VERIFIED** |
| `Settings.tsx` & `LicenseActivation.tsx` | Activate Pro/Enterprise Key, Import `.lai`, Real-time Banner Update | Verified (Cache-busted) | RSA signature validation | **LOCKED — VERIFIED** |
| `LicenseAuthorityApp.tsx` | Generate RSA-2048 Signed Key, Set Expiration & Fingerprint, Export `.lai` | Verified | Session recovery on 401 | **LOCKED — VERIFIED** |
