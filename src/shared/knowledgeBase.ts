/**
 * LEDGERAI PH — VERIFIED ENTERPRISE KNOWLEDGE BASE (v1.0.0-rc.2)
 * Official operational knowledge base backing Ledger Agent AI Assistant & System Navigation.
 * Covers 100% of all 16 Canonical ERP Modules, all 36 Submodules, Financial Reports,
 * Cross-Module Workflows, RBAC / Company Owner Authority, BIR Tax Rules, and Clean Start Governance.
 */

export type KnowledgeCategory =
  | 'MODULE_SUBMODULE'
  | 'WORKFLOW'
  | 'REPORT_ANALYTICS'
  | 'SECURITY_RBAC'
  | 'BIR_COMPLIANCE';

export interface KnowledgeRecord {
  moduleId: string;
  moduleName: string;
  submoduleId: string;
  submoduleName: string;
  category?: KnowledgeCategory;
  purpose: string;
  navigationPath: string;
  requiredPermissions: string[];
  userInstructions: string[];
  prerequisites: string[];
  expectedBehavior: string;
  accountingImpact: string;
  dependencies: string[];
  keywords?: string[];
  commonErrorsAndResolutions: Array<{ error: string; resolution: string }>;
  verificationStatus: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'EXTERNAL_VALIDATION_REQUIRED';
  sourceVersion: string;
}

export const CANONICAL_KNOWLEDGE_BASE: KnowledgeRecord[] = [
  // =========================================================================
  // 1. DASHBOARD (1 submodule)
  // =========================================================================
  {
    moduleId: 'dashboard',
    moduleName: '1. Dashboard',
    submoduleId: 'dash-overview',
    submoduleName: 'Executive & Financial Dashboard',
    category: 'MODULE_SUBMODULE',
    purpose: 'Real-time financial command center displaying Cash & Bank Position, Accounts Receivable & Payable aging, monthly Revenue vs Expenses, net income, pending approvals, and BIR statutory deadlines sourced directly from posted General Ledger and active subledgers.',
    navigationPath: '/',
    requiredPermissions: ['dashboard:view'],
    userInstructions: [
      'Open the active company workspace from the Launcher (/launcher).',
      'Inspect live KPI cards: Cash Position, Open AR, Open AP, Monthly Revenue vs Expenses, and Net Income.',
      'Review pending workflow approvals and upcoming BIR deadlines.',
      'Click "Refresh Metrics" or switch period filters to recompute live SQLite telemetry.'
    ],
    prerequisites: ['Active company session', 'Company Owner or assigned dashboard:view permission'],
    expectedBehavior: 'Displays zeroed/empty-state metrics on a clean-start database and updates immediately when invoices, bills, cash transactions, or journals post.',
    accountingImpact: 'Read-only aggregator of posted GL account balances and active AR/AP/Cash/Tax subledgers.',
    dependencies: ['Accounting & General Ledger', 'Sales & Receivables', 'Procurement & Payables', 'Cash & Banking'],
    keywords: ['dashboard', 'kpi', 'executive overview', 'home', 'financial summary', 'cash position'],
    commonErrorsAndResolutions: [
      { error: 'Company not found or session expired', resolution: 'Return to /launcher and re-authenticate into the company profile.' },
      { error: 'Zero totals shown on new company', resolution: 'Zero-Data Clean Start displays genuine ₱0.00 balances until business transactions are posted.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 2. SALES & RECEIVABLES (1 submodule)
  // =========================================================================
  {
    moduleId: 'sales',
    moduleName: '2. Sales & Receivables',
    submoduleId: 'sales-invoices',
    submoduleName: 'Sales Invoices & Billing',
    category: 'MODULE_SUBMODULE',
    purpose: 'Authoritative Philippine Accounts Receivable (AR) & Sales Invoicing engine under EOPT Act (RA 11976) and BIR RR 7-2024 (Sales Invoice as primary VAT/commercial document). Governs customer billing, 12% Output VAT / Zero-Rated / VAT-Exempt / Non-VAT recognition, Maker-Checker SoD approvals, GL Account 1030 posting, partial/full Official/Collection Receipt (OR/CR) settlements with BIR Form 2307 CWT, and 30-day Archive Inbox retention.',
    navigationPath: '/accounting/sales-invoicing',
    requiredPermissions: ['sales:view', 'sales:create', 'sales:edit', 'sales:submit', 'sales:approve', 'sales:post'],
    userInstructions: [
      'Navigate to 2. Sales & Receivables > Sales Invoices & Billing (/accounting/sales-invoicing).',
      'Top Action Toolbar: Use "Archive Inbox" to inspect/restore ARCHIVED or REMOVED sales records (30-day retention); "Create Customer" to register a customer with BIR TIN; "Export Matrix" to export CSV/PDF/Excel registers; "+ Create Sales Invoice" to encode a new DRAFT billing.',
      'Tabs: Switch between "Sales Invoices & AR Register" (active non-archived invoices) and "Customers Master Directory" (registered customers).',
      'KPI 1 — Total AR Outstanding (All Posted): Computed directly from SQLite as SUM(balance_due) WHERE status IN (\'POSTED\', \'PARTIAL\') AND balance_due > 0. Reconciles 1:1 with General Ledger Control Account 1030 (Accounts Receivable). Click "Explain Source" on the card to view the POSTED vs PARTIAL breakdown and GL Account 1030 proof.',
      'KPI 2 — Active Invoices: Computed as COUNT(*) WHERE status NOT IN (\'ARCHIVED\', \'REMOVED\', \'SOFT_DELETED\', \'CANCELLED\', \'REVERSED\'). Includes DRAFT, SUBMITTED, RETURNED, APPROVED, POSTED, PARTIAL, and PAID invoices.',
      'KPI 3 — Overdue Collections: Computed as SUM(balance_due) WHERE status IN (\'POSTED\', \'PARTIAL\') AND balance_due > 0 AND due_date < today_PHT (invoices past their statutory/credit due date).',
      '10 Status Filters & BIR Lifecycle Rules: ALL (all non-archived rows = Active + CANCELLED + REVERSED), DRAFT (unissued, ₱0 GL/VAT impact), SUBMITTED (locked for review), RETURNED (sent back with mandatory reason for correction), APPROVED (Maker-Checker SoD verified, ready for Post to GL), POSTED (issued BIR Sales Invoice posted to GL Account 1030 & Output VAT 2020), PARTIAL (partially collected via OR/CR or Credit Memo with 0 < balance_due < total_amount), PAID (fully settled, balance_due = 0), CANCELLED (voided pre-posting while preserving BIR serial sequence per RR 18-2012), REVERSED (post-GL reversal via offsetting Credit Memo / Reversal JE per BIR CAS rules, balance_due = 0).',
      'Row Actions & 360° Journey: Click "360° Journey" on any row to inspect line items, GL journal entry, BIR VAT/CWT breakdown, and audit trail, or execute "Record Collection (OR)" (50% Partial, Full Balance, +1% / +2% BIR Form 2307 CWT), "Reverse Entry", "Adjust / Correcting Entry", "Copy to Draft", or "Archive".'
    ],
    prerequisites: ['Registered Customer in /master-data/customers', 'Open accounting period', 'Configured Revenue (4xxx), AR (1030), Cash/Bank (1010/1020), CWT 2307 Asset (1150), and Output VAT (2020) COA accounts'],
    expectedBehavior: 'Every KPI card and status pill queries authoritative SQLite aggregates across the entire company database (never just the 20 paginated rows). Clicking any KPI card opens its live Financial Source of Truth reconciliation drawer.',
    accountingImpact: 'Invoice Post (POSTED): DR Accounts Receivable (1030) = total_amount, CR Revenue (4xxx) = net_sales, CR Output VAT Payable (2020) = 12% VAT (under EOPT Act RA 11976, Output VAT accrues upon invoice issuance). Collection (PARTIAL / PAID via RECORD_COLLECTION): DR Cash/Bank (1010/1020) = cash_collected, DR Creditable Withholding Tax / Form 2307 Asset (1150) = cwt_withheld, CR Accounts Receivable (1030) = cash + cwt. Reversal (REVERSED): Atomic offsetting GL reversal entry restoring AR & Output VAT to zero without deleting the historical BIR serial number.',
    dependencies: ['Customer Master Registry', 'Chart of Accounts', 'Accounting Periods', 'Tax & BIR Compliance', '360° Entity Journey', 'Module Archive Inbox'],
    keywords: [
      'sales invoice', 'billing', 'ar', 'accounts receivable', 'collection', 'official receipt', '2307', 'benta', 'customer',
      'total ar outstanding', 'active invoices', 'overdue collections', 'partial', 'partially paid', 'reversed', 'cancelled',
      'returned', 'draft', 'submitted', 'approved', 'posted', 'paid', 'archive inbox', 'eopt', 'rr 7-2024', 'sales invoicing'
    ],
    commonErrorsAndResolutions: [
      { error: 'Invoice validation failed: Header totalAmount does not reconcile with line-item totals', resolution: 'Ensure header totalAmount equals SUM(line.amount + line.taxAmount) before posting to General Ledger, or return the invoice to DRAFT/RETURNED and edit the total.' },
      { error: 'Period is hard-closed', resolution: 'Choose an OPEN accounting period or request authorized period reopening.' },
      { error: 'Self-approval forbidden (Maker-Checker SoD)', resolution: 'Have a Reviewer, Approver, or another authorized officer approve the submitted invoice.' },
      { error: 'Cannot reverse a sales invoice that has active collections applied', resolution: 'Reverse the linked Customer Payment (Official/Collection Receipt) first in 360° Journey before reversing the Sales Invoice.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 3. PROCUREMENT & PAYABLES (2 submodules)
  // =========================================================================
  {
    moduleId: 'procurement',
    moduleName: '3. Procurement & Payables',
    submoduleId: 'proc-matching',
    submoduleName: 'Procurement & 3-Way Match',
    category: 'MODULE_SUBMODULE',
    purpose: 'Execute Purchase Orders (PO), Goods Receipt Notes (GRN), and automated 3-way matching (PO contracted rates vs GRN inspected/received quantities vs Vendor Purchase Bill) under the statutory BIR ≤ 2.0% variance tolerance threshold before posting Accounts Payable.',
    navigationPath: '/accounting/procurement',
    requiredPermissions: ['purchases:view', 'purchases:create', 'purchases:edit', 'purchases:approve', 'procurement:manage'],
    userInstructions: [
      'Navigate to 3. Procurement & Payables > Procurement & 3-Way Match (/accounting/procurement).',
      'Currency Standard: All financial figures are denominated in Philippine Pesos (₱). No US dollar signs are used in Philippine accounting registers.',
      'Top Action Toolbar: Use "Archive Inbox" to view/restore archived procurement documents; "Export Matrix" to export PO records to CSV/Excel; "Run 3-Way Match Tool" to open the 3-Way verification dialog; "+ Issue Purchase Order" to create authorized supplier commitments.',
      'KPI 1 — Total Procurement Commitments: Authoritative sum of open authorized purchase orders (with cumulative authorized PO totals clearly displayed when all existing POs are billed).',
      'KPI 2 — Pending 3-Way Match: Count of POs with warehouse Goods Receipt Notes (GRN) received awaiting vendor invoice verification.',
      'KPI 3 — Matched & Auto-Billed: Count of POs that successfully satisfied the statutory BIR ≤ 2.0% price/quantity tolerance and have generated Accounts Payable liabilities.',
      'Row Actions: Click "360° View" on any PO row to inspect the full procurement lifecycle, or "3-Way Match" to inspect line-by-line variances between PO, GRN, and Supplier Invoice.',
      'Auto-Bill Execution: When 3-way match variance is within ≤ 2.0%, clicking "Verify Match & Auto-Bill" automatically inserts a POSTED Purchase Bill and sets the PO to CLOSED with cryptographic audit lineage.'
    ],
    prerequisites: ['Registered Vendor with valid BIR TIN in /master-data/vendors', 'Chart of Accounts inventory/expense mapping', 'Open accounting period'],
    expectedBehavior: 'Enforces strict Philippine internal control and COA guidelines preventing payment of uninspected goods or bills exceeding the 2.0% variance threshold without an authorized discrepancy voucher.',
    accountingImpact: 'GRN inspection recognizes physical custody. Matched Bill Post: DR Inventory (1130) or Operating Expense (5xxx/6xxx), DR 12% Creditable Input VAT (1160), CR Accounts Payable Control Account 2010.',
    dependencies: ['Vendor & Supplier Registry', 'Purchase Bills & Accounts Payable', 'Inventory & Warehouse', 'General Ledger'],
    keywords: [
      'procurement', 'purchase order', 'po', 'grn', 'goods receipt note', '3-way match', 'three way match',
      'tolerance', '2.0% variance', 'auto bill', 'commitments', 'matched and auto-billed', 'pesos', 'philippine accounting'
    ],
    commonErrorsAndResolutions: [
      { error: '3-Way Match variance exceeds 2.0% tolerance', resolution: 'Request a revised supplier invoice or process a debit memo / price variance approval voucher signed by the Finance Manager.' },
      { error: 'Missing PO Order Date', resolution: 'PO date is mapped from authoritative po_date in SQLite schema and formats in PHT (YYYY-MM-DD).' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'procurement',
    moduleName: '3. Procurement & Payables',
    submoduleId: 'proc-bills',
    submoduleName: 'Purchase Bills & Accounts Payable',
    category: 'MODULE_SUBMODULE',
    purpose: 'Authoritative Philippine Accounts Payable (AP) & Supplier Billing engine. Governs supplier invoices, 12% Creditable Input VAT, BIR Form 2307 Creditable Withholding Tax (EWT via ATC codes WB010/WB020/WB030/WI011), GL Control Account 2010 posting, partial and full settlements via Disbursement Voucher (DV) / Check Voucher (CV), and 30-day Archive Inbox retention.',
    navigationPath: '/accounting/purchase-bills',
    requiredPermissions: ['purchases:view', 'purchases:create', 'purchases:edit', 'purchases:submit', 'purchases:post', 'cash:manage'],
    userInstructions: [
      'Navigate to 3. Procurement & Payables > Purchase Bills & Accounts Payable (/accounting/purchase-bills).',
      'Currency Standard: All financial amounts and KPI cards are strictly denominated in Philippine Pesos (₱).',
      'Top Action Toolbar: "Archive Inbox" (30-day retention for soft-deleted/archived bills), "Create Vendor" (register supplier with 9-to-12 digit BIR TIN), "Export Matrix" (export filtered AP register), "+ New Bill" (create a new DRAFT supplier bill).',
      'KPI 1 — Total AP Outstanding (All Posted): Sourced directly from SQLite as SUM(balance_due) WHERE status IN (\'POSTED\', \'PARTIAL\') AND balance_due > 0. Reconciles 1:1 with General Ledger Control Account 2010 (Accounts Payable) with exactly ₱0.00 variance.',
      'KPI 2 — Active Bills: Total count of active non-archived supplier bills excluding CANCELLED and REVERSED.',
      'KPI 3 — Overdue Payables: Sourced directly from SQLite as SUM(balance_due) for posted bills past their credit/statutory due date.',
      '10 Status Filter Tabs: ALL, DRAFT (unissued, ₱0 GL impact), SUBMITTED, RETURNED, APPROVED, POSTED (posted to GL 2010), PARTIAL (partially paid, 0 < balance_due < total_amount), PAID (fully settled, balance_due = 0), CANCELLED (pre-posting void), REVERSED (post-GL reversal via Reversal JV).',
      'PARTIAL Status Workflow: When a bill is in PARTIAL status, clicking "Disbursement Voucher (DV)" (or "Settle Balance (DV)") opens the Disbursement Voucher modal. The remaining balance (e.g., ₱2,750.00) is prepopulated. Users can settle the full balance or enter a partial amount.',
      'Settlement & BIR Form 2307 EWT: The modal computes EWT on the net-of-VAT tax base (Gross / 1.12 * ATC Rate) per BIR RR 2-98 / TRAIN / EOPT Act. When the full remaining balance is disbursed, the bill status immediately transitions to PAID and balance_due becomes ₱0.00.',
      '360° Journey: Click "360° Journey" on any row to open the full drawer displaying Gross Transaction Total, 12% Input VAT, EWT Breakdown, Settled Amount, and Outstanding Balance Due, with direct action buttons including "Disbursement Voucher (DV)", "Reverse Entry", and "Copy to Draft".'
    ],
    prerequisites: ['Vendor registered with valid TIN in /master-data/vendors', 'Open accounting period', 'Configured Accounts Payable (2010), Input VAT (1160), EWT Payable (2030), and Cash/Bank (1010/1020) accounts'],
    expectedBehavior: 'All KPI metrics, status counts, and balances are queried directly from SQLite backend aggregates. No numbers are fabricated or converted silently to zero without explanation.',
    accountingImpact: 'Bill Post (POSTED): DR Expense/Asset (5xxx/1xxx), DR 12% Input VAT (1160), CR Accounts Payable (2010). Disbursement (PARTIAL / PAID via RECORD_DISBURSEMENT): DR Accounts Payable (2010) = gross_applied, CR Cash in Bank (1010/1020) = net_cash_paid, CR Expanded Withholding Tax Payable / Form 2307 (2030) = ewt_withheld.',
    dependencies: ['Vendor & Supplier Registry', 'Procurement & 3-Way Match', 'Tax & BIR Compliance', 'Cash & Banking', 'General Ledger', '360° Entity Journey'],
    keywords: [
      'purchase bill', 'ap', 'accounts payable', 'vendor bill', 'supplier payment', 'disbursement voucher', 'dv',
      'check voucher', 'cv', 'ewt', 'form 2307', 'wb010', 'wb020', 'input vat', 'partial', 'paid', 'posted',
      'overdue payables', 'total ap outstanding', 'bayarin', 'pesos', 'philippine accounting'
    ],
    commonErrorsAndResolutions: [
      { error: 'Missing Vendor TIN in BIR Form 2307 generation', resolution: 'Update the vendor TIN in Master Data > Vendor Directory before finalizing the disbursement voucher.' },
      { error: 'Disbursement amount exceeds remaining balance due', resolution: 'Enter a payment amount less than or equal to the remaining balance due.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 4. INVENTORY & WAREHOUSE (1 submodule)
  // =========================================================================
  {
    moduleId: 'inventory',
    moduleName: '4. Inventory & Warehouse',
    submoduleId: 'inv-movements',
    submoduleName: 'Inventory & Stock Valuation',
    category: 'MODULE_SUBMODULE',
    purpose: 'Manage SKUs, item categories, reorder thresholds, stock receipts/issues, FIFO & Weighted Average valuation, physical stock adjustments, and automated COGS posting.',
    navigationPath: '/accounting/inventory',
    requiredPermissions: ['inventory:view', 'inventory:create', 'inventory:edit'],
    userInstructions: [
      'Navigate to Inventory & Warehouse > Inventory & Stock Valuation (/accounting/inventory).',
      'Register SKUs with Inventory Asset account (1130), COGS account (5010), costing method (FIFO or Weighted Average), and reorder point.',
      'Record stock receipts, sales issues, or audited stock count adjustments.'
    ],
    prerequisites: ['Merchandise Inventory and COGS accounts in Chart of Accounts'],
    expectedBehavior: 'Recomputes unit cost and stock valuation deterministically and posts COGS journal entries matching inventory subledger movement.',
    accountingImpact: 'Stock In: DR Inventory (1130), CR AP/GRNI. Stock Out / Sale: DR COGS (5010), CR Inventory (1130).',
    dependencies: ['Sales & Receivables', 'Procurement & Payables', 'General Ledger'],
    keywords: ['inventory', 'stock', 'warehouse', 'sku', 'fifo', 'weighted average', 'cogs', 'reorder', 'paninda', 'imbentaryo'],
    commonErrorsAndResolutions: [
      { error: 'Insufficient stock quantity', resolution: 'Post incoming GRN/stock receipt before issuing inventory quantities.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 5. CASH & BANKING (2 submodules)
  // =========================================================================
  {
    moduleId: 'cash-banking',
    moduleName: '5. Cash & Banking',
    submoduleId: 'cash-mgmt',
    submoduleName: 'Cash & Check Management',
    category: 'MODULE_SUBMODULE',
    purpose: 'Manage petty cash receipts/disbursements, check register (issued, cleared, cancelled, stale checks), bank deposits, and fund transfers fully bound to COA-discovered Cash & Bank GL Asset accounts.',
    navigationPath: '/accounting/cash-transactions',
    requiredPermissions: ['cash:view', 'cash:create', 'cash:edit', 'cash:approve'],
    userInstructions: [
      'Navigate to Cash & Banking > Cash & Check Management (/accounting/cash-transactions).',
      'Select an active COA-connected Cash or Bank GL account (automatically discovered by Central Account Mapping Engine).',
      'Record Cash Receipts, Cash Disbursements, Checks Issued, or Bank Deposits.',
      'Post approved entries so cash register totals stay 100% reconciled with General Ledger Cash/Bank accounts.'
    ],
    prerequisites: ['At least one active Cash or Bank Asset account in Chart of Accounts (1010–1029 / Asset sub-type Cash/Bank)'],
    expectedBehavior: 'Discovers all active company Cash & Bank GL accounts dynamically without hardcoded empty dropdowns and posts balanced GL entries.',
    accountingImpact: 'Receipt/Deposit: DR Cash/Bank GL, CR Source/Offset Account. Check/Disbursement: DR Expense/AP, CR Cash/Bank GL.',
    dependencies: ['Chart of Accounts', 'Central Account Mapping Engine', 'Bank Reconciliation Workspace'],
    keywords: ['cash', 'check', 'cheque', 'petty cash', 'deposit', 'disbursement', 'receipt', 'treasury', 'pera'],
    commonErrorsAndResolutions: [
      { error: 'Cash Account selector shows no accounts', resolution: 'Verify Chart of Accounts has an ACTIVE ASSET account classified as Cash or Bank in /accounting/accounts.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'cash-banking',
    moduleName: '5. Cash & Banking',
    submoduleId: 'bank-recon',
    submoduleName: 'Bank Reconciliation Workspace',
    category: 'MODULE_SUBMODULE',
    purpose: 'Perform bank-to-book reconciliations against COA Bank GL accounts, import/enter bank statements, match deposits in transit and outstanding checks, record bank charges/interest adjustments, and lock certified periods.',
    navigationPath: '/accounting/bank-reconciliation',
    requiredPermissions: ['bank_rec:view', 'bank_rec:create', 'bank_rec:edit', 'bank_rec:approve'],
    userInstructions: [
      'Navigate to Cash & Banking > Bank Reconciliation Workspace (/accounting/bank-reconciliation).',
      'Select the Bank GL Account (automatically populated from COA Bank accounts) and statement cutoff date.',
      'Enter Bank Statement Ending Balance and match book deposits/checks against bank lines.',
      'Post any legitimate bank service charges or interest income, confirm Variance = ₱0.00, and finalize/lock.'
    ],
    prerequisites: ['Active Bank GL account in Chart of Accounts', 'Posted cash/check/deposit transactions'],
    expectedBehavior: 'Computes Adjusted Bank Balance vs Adjusted Book Balance and ensures zero variance before locking.',
    accountingImpact: 'Adjusting items post directly to Bank Charges Expense / Interest Income against Cash in Bank.',
    dependencies: ['Cash & Check Management', 'Chart of Accounts', 'Accounting Periods'],
    keywords: ['bank reconciliation', 'bank recon', 'bank statement', 'outstanding check', 'deposit in transit', 'bangko'],
    commonErrorsAndResolutions: [
      { error: 'Unreconciled difference non-zero', resolution: 'Identify unmatched bank fees, NSF checks, or deposits in transit and record/match them before locking.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 6. ACCOUNTING & GENERAL LEDGER (5 submodules)
  // =========================================================================
  {
    moduleId: 'accounting',
    moduleName: '6. Accounting & General Ledger',
    submoduleId: 'acct-coa',
    submoduleName: 'Chart of Accounts',
    category: 'MODULE_SUBMODULE',
    purpose: 'Master company-owned Philippine BIR-compliant Chart of Accounts defining Asset, Receivable, Payable, Liability, Equity, Revenue, Cost of Sales, and Expense accounts, human-readable detail types, BIR Tax Categories (VAT 2550Q, EWT 1601-EQ, CWT 2307, 1601-C, 1702), live posted GL balances in Philippine Peso (₱), and status governance (Active, Inactive, Archive Vault, Soft Deleted).',
    navigationPath: '/accounting/accounts',
    requiredPermissions: ['accounting:view', 'accounting:create', 'accounting:edit'],
    userInstructions: [
      'Navigate to Accounting & General Ledger > Chart of Accounts (/accounting/accounts).',
      'Use Type Filters (ALL, ASSET, RECEIVABLE, PAYABLE, LIABILITY, EQUITY, REVENUE, EXPENSE) and Status Filters (All Status, Active, Inactive, Soft Deleted) to inspect accounts and their live posted GL balances (₱).',
      'Click "+ Add Account" to create a BIR-mapped GL account (with optional Opening Balance for Balance Sheet accounts only) or click "Edit" / "360°" on any row.',
      'Use row lifecycle actions (Deactivate / Activate, Archive to 30-day Retention Vault, Restore, or Delete unused accounts) — accounts with posted journal history are protected from deletion per BIR CAS audit preservation rules.',
      'Click "Export Matrix" to download the BIR-ready Chart of Accounts register in Excel/CSV/PDF or open "Archive Inbox" to manage retained accounts.'
    ],
    prerequisites: ['Authorized accounting role or Company Owner'],
    expectedBehavior: 'Immediate discovery across Cash/Check registers, Bank Reconciliation, Invoicing, Purchase Bills, BIR Tax Mapping, Fixed Assets, and Payroll; posted accounts cannot be hard-deleted.',
    accountingImpact: 'Defines structural GL classification, BIR tax mapping, and normal balance rules for every posting and financial report.',
    dependencies: ['Central Account Mapping Engine', 'General Journal & Ledger', 'Trial Balance Ledger'],
    keywords: ['chart of accounts', 'coa', 'account code', 'gl account', 'normal balance', '1010', '1020', '1040', 'allowance for doubtful accounts', 'bir tax category', 'archive inbox'],
    commonErrorsAndResolutions: [
      { error: 'Duplicate account code rejected', resolution: 'Each COA code must be unique within the company database.' },
      { error: 'Cannot delete account with posted transactions', resolution: 'Per BIR CAS rules, accounts with posted GL entries cannot be deleted; set the account to INACTIVE or ARCHIVED instead.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.3'
  },
  {
    moduleId: 'accounting',
    moduleName: '6. Accounting & General Ledger',
    submoduleId: 'acct-journals',
    submoduleName: 'General Journal & Ledger',
    category: 'MODULE_SUBMODULE',
    purpose: 'Official Philippine BIR General Journal Book of Accounts for creating, editing, submitting, approving, returning, rejecting, posting, copying, and reversing balanced Journal Vouchers (Sum Debits === Sum Credits) with Department/Project/Cost Center dimensions, Maker-Checker-Approver-Poster Segregation of Duties (SoD), and Company Lock Date / Closed Period enforcement.',
    navigationPath: '/accounting/journals',
    requiredPermissions: ['accounting:view', 'accounting:create', 'accounting:edit', 'accounting:post'],
    userInstructions: [
      'Navigate to Accounting & General Ledger > General Journal & Ledger (/accounting/journals).',
      'Click "+ New Entry" to prepare a balanced Journal Voucher (JV) in Philippine Peso (₱), selecting postable leaf COA accounts and optional Department, Project, or Cost Center dimensions.',
      'Follow the BIR Maker-Checker workflow: Save Draft -> Submit -> Approve (or Return/Reject with mandatory reason) -> Post to General Ledger.',
      'Filter by lifecycle status pills (ALL, DRAFT, SUBMITTED, RETURNED, REJECTED, APPROVED, POSTED, REVERSED, CANCELLED, ARCHIVED, SOFT DELETED) with live counts, click "360° Journey" for complete audit trail & journal lines, or use "Export Matrix" to export the BIR General Journal register.',
      'To correct a POSTED journal entry, click "Reverse" with a reversal date and mandatory audit reason — posted entries are strictly immutable per BIR CAS regulations.'
    ],
    prerequisites: ['OPEN accounting period', 'Transaction date after Company Lock Date', 'Valid active leaf COA accounts'],
    expectedBehavior: 'Blocks unbalanced entries, parent header account postings, backdated lock-date entries, and hard-closed period postings; displays live PHP Debit/Credit totals and maintains immutable audit trails.',
    accountingImpact: 'Updates GL account balances, Trial Balance, Financial Statements, BIR Tax Worksheets, and Budget variance immediately upon POSTED.',
    dependencies: ['Chart of Accounts', 'Accounting Periods & Lock', 'Trial Balance Ledger', 'Approvals & Workflow'],
    keywords: ['journal entry', 'journal voucher', 'jv', 'general ledger', 'gl', 'debit', 'credit', 'reversal', 'adjusting entry', 'maker checker', 'bir book of accounts'],
    commonErrorsAndResolutions: [
      { error: 'Debit and Credit totals do not match', resolution: 'Verify total debits equal total credits to the exact centavo before saving.' },
      { error: 'Hard-closed period or lock date blocks posting', resolution: 'Post in an OPEN period after the Company Lock Date, or request an authorized administrator to reopen the period with an audit reason.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.3'
  },
  {
    moduleId: 'accounting',
    moduleName: '6. Accounting & General Ledger',
    submoduleId: 'acct-tb',
    submoduleName: 'Trial Balance Ledger',
    category: 'MODULE_SUBMODULE',
    purpose: 'Authoritative 6-column Philippine Trial Balance verification (Opening DR/CR, Period Movement DR/CR, Closing DR/CR, and Closing Net in ₱) with period/date/account-type filters, zero-balance toggle, direct General Ledger drilldown, Excel/PDF Export Matrix, and persistent Database-Backed Trial Balance Certification & Sign-off.',
    navigationPath: '/reports/trial-balance',
    requiredPermissions: ['accounting:view', 'reports:view'],
    userInstructions: [
      'Navigate to Accounting & General Ledger > Trial Balance Ledger (/reports/trial-balance).',
      'Select an Accounting Period or custom Start/End Date range, filter by Account Type or search by code/name, and toggle "Show Zero Balances" if needed.',
      'Verify the 4 KPI reconciliation cards (Opening Balance, Period Movement, Closing Balance, Accounts & Net Check) confirm ₱0.00 variance (Debits = Credits).',
      'Click "GL" on any account row to drill down into the underlying General Ledger transactions and source subledgers.',
      'When Debits = Credits are balanced, enter reviewer notes in "Trial Balance Certification & Sign-off" and click "Sign Off & Seal" to record a persistent, auditable certification stored in the database.'
    ],
    prerequisites: ['Posted journal entries in the company database', 'Approver/Accountant permission for Sign Off & Seal'],
    expectedBehavior: 'Guarantees Sum(Total Debits) === Sum(Total Credits) across all posted GL activity, blocks signing off an out-of-balance Trial Balance, and persists certification history across sessions.',
    accountingImpact: 'Read-only authoritative GL verification report with persistent audit certification log.',
    dependencies: ['General Journal & Ledger', 'Chart of Accounts', 'Accounting Periods & Lock'],
    keywords: ['trial balance', 'tb', 'debits equal credits', 'unbalanced', 'balanse', 'sign off', 'certification', '6-column trial balance'],
    commonErrorsAndResolutions: [
      { error: 'Expected recent transaction missing', resolution: 'Confirm the invoice, bill, or journal is POSTED (DRAFT/SUBMITTED items do not affect Trial Balance).' },
      { error: 'Sign Off & Seal blocked', resolution: 'Ensure Trial Balance variance is ₱0.00 and your role has accounting:approve permission.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.3'
  },
  {
    moduleId: 'accounting',
    moduleName: '6. Accounting & General Ledger',
    submoduleId: 'acct-periods',
    submoduleName: 'Accounting Periods & Lock',
    category: 'MODULE_SUBMODULE',
    purpose: 'Manage unique monthly/fiscal accounting periods (OPEN, SOFT_CLOSED, HARD_CLOSED), Company Lock Date protection, the 12-Section Evidence-Driven Period Close Audit Workspace, immutable SHA-256 Close Certifications, audited Reopen workflows, and Philippine Year-End Close (closing nominal Revenue & Expense accounts to Retained Earnings).',
    navigationPath: '/accounting/periods',
    requiredPermissions: ['accounting:view', 'accounting:edit', 'accounting:approve'],
    userInstructions: [
      'Navigate to Accounting & General Ledger > Accounting Periods & Lock (/accounting/periods).',
      'Set or clear the Company Lock Date to block any backdated transactions across Sales, Procurement, Cash, Payroll, and GL on or before that date.',
      'Click "+ New Period" to create non-overlapping fiscal periods, or open "Close Workspace" / "12-Check Audit" on any period to inspect live readiness across GL, AR, AP, Bank Recon, Inventory, Fixed Assets, Payroll, and BIR Tax filings.',
      'Transition periods from OPEN -> SOFT_CLOSED (review freeze) -> HARD_CLOSED (immutable lock + SHA-256 certification); use "Reopen" only with a mandatory audit justification.',
      'At fiscal year-end, click "Year-End Close" and select the company Retained Earnings (3100) equity account to generate the official closing journal transferring net income/loss from nominal Revenue & Expense accounts into Retained Earnings.'
    ],
    prerequisites: ['All period subledgers reconciled', 'Authorized Officer/Accountant permissions', 'Retained Earnings Equity account configured for Year-End Close'],
    expectedBehavior: 'Prevents overlapping/duplicate periods, blocks backdated postings into HARD_CLOSED periods or on/before Company Lock Date, and records full status history & SHA-256 certifications.',
    accountingImpact: 'Lock Date and Period Close govern posting eligibility across all 16 ERP modules; Year-End Close zeroes nominal Revenue/Expense accounts into Retained Earnings (3xxx).',
    dependencies: ['Bank Reconciliation Workspace', 'Trial Balance Ledger', 'General Journal & Ledger', 'Audit & Governance'],
    keywords: ['accounting period', 'period close', 'soft close', 'hard close', 'year end close', 'retained earnings', 'month end', '12-check audit', 'closing checklist', 'lock date', 'reopen period'],
    commonErrorsAndResolutions: [
      { error: 'Period Close blocked by open exceptions', resolution: 'Open "12-Check Audit" to resolve pending draft journals, unposted subledgers, or bank reconciliation variances before closing.' },
      { error: 'Overlapping period rejected', resolution: 'Ensure Start Date and End Date do not overlap any existing period for the company.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.3'
  },
  {
    moduleId: 'accounting',
    moduleName: '6. Accounting & General Ledger',
    submoduleId: 'acct-forex',
    submoduleName: 'Foreign Exchange Revaluation',
    category: 'MODULE_SUBMODULE',
    purpose: 'Manage official Bangko Sentral ng Pilipinas (BSP / BAP) daily spot exchange rates (USD, EUR, JPY, SGD, GBP vs PHP), calculate and post BIR RMC 12-2024 Realized FX Gain/Loss settlements, and run PAS 21 Period-End Unrealized FX Revaluations with optional next-period auto-reversal.',
    navigationPath: '/accounting/forex',
    requiredPermissions: ['accounting:view', 'accounting:create', 'accounting:post'],
    userInstructions: [
      'Navigate to Accounting & General Ledger > Foreign Exchange Revaluation (/accounting/forex).',
      'Click "+ Add Daily BSP Rate" to log official Bangko Sentral ng Pilipinas (BSP) daily reference rates (no fallback/fabricated rates are ever used).',
      'In "BSP Spot Rates & Calculator", compute Realized FX Gain/Loss between recorded rate and settlement rate per BIR RMC 12-2024 (taxable/deductible in BIR Form 1702Q/1702-RT) and optionally post the Realized FX Adjustment JE directly to GL.',
      'In "Period-End Unrealized FX Revaluation", select the Accounting Period, currency, closing BSP rate, and foreign-currency monetary accounts (e.g., FCDU/FX Bank, Foreign AR/AP), click "Preview Revaluation", and post the PAS 21 Unrealized FX JE with optional next-period auto-reversal.',
      'Inspect or reverse posted revaluation runs in "Revaluation Run History" — Unrealized FX Gain/Loss (4910/6910) is tracked separately and excluded from BIR ITR taxable income until realized.'
    ],
    prerequisites: ['Official BSP/BAP daily spot rate logged for cutoff date', 'Foreign-currency monetary GL account(s) configured', 'OPEN accounting period'],
    expectedBehavior: 'Strictly applies official BSP rates, separates BIR RMC 12-2024 Realized (ITR taxable/deductible) vs. PAS 21 Unrealized (ITR excluded) FX Gain/Loss, and prevents duplicate active revaluation runs for the same period & currency.',
    accountingImpact: 'Realized FX posts to 4900/6900 (taxable/deductible); Period-End Unrealized FX adjusts foreign monetary carrying balances against 4910/6910 with optional auto-reversal.',
    dependencies: ['General Journal & Ledger', 'Accounting Periods & Lock', 'Chart of Accounts'],
    keywords: ['forex', 'foreign exchange', 'currency', 'revaluation', 'bsp spot rate', 'usd', 'exchange rate', 'pas 21', 'bir rmc 12-2024', 'realized fx', 'unrealized fx'],
    commonErrorsAndResolutions: [
      { error: 'Missing closing BSP exchange rate', resolution: 'Record the official BSP/BAP spot rate via "+ Add Daily BSP Rate" for the target cutoff date before running preview or posting.' },
      { error: 'Duplicate revaluation run for period', resolution: 'Reverse the existing posted revaluation run in Revaluation Run History before posting a replacement run.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.3'
  },

  // =========================================================================
  // 7. FIXED ASSETS (1 submodule)
  // =========================================================================
  {
    moduleId: 'fixed-assets',
    moduleName: '7. Fixed Assets',
    submoduleId: 'fa-register',
    submoduleName: 'Fixed Asset & Depreciation Register',
    category: 'MODULE_SUBMODULE',
    purpose: 'Track Property, Plant, and Equipment (PPE) capitalization, asset tags, salvage value, useful life, straight-line depreciation schedules, transfers, disposals, and Net Book Value.',
    navigationPath: '/accounting/fixed-assets',
    requiredPermissions: ['fixedassets:view', 'fixedassets:create', 'fixedassets:edit'],
    userInstructions: [
      'Navigate to Fixed Assets > Fixed Asset & Depreciation Register (/accounting/fixed-assets).',
      'Click "Register Asset", specify Asset Tag, Asset COA Account (15xx), Accumulated Depreciation COA Account (16xx), Depreciation Expense COA (6xxx), acquisition cost, salvage value, and useful life.',
      'Generate schedule and post monthly depreciation runs to the General Ledger.'
    ],
    prerequisites: ['PPE, Accumulated Depreciation, and Depreciation Expense accounts in COA'],
    expectedBehavior: 'Computes (Cost - Salvage Value) / Useful Life Months cleanly in centavos without floating-point drift and prevents over-depreciating below salvage value.',
    accountingImpact: 'Monthly Run: DR Depreciation Expense, CR Accumulated Depreciation.',
    dependencies: ['Chart of Accounts', 'General Journal & Ledger', 'Accounting Periods'],
    keywords: ['fixed assets', 'ppe', 'depreciation', 'net book value', 'nbv', 'accumulated depreciation', 'asset tag'],
    commonErrorsAndResolutions: [
      { error: 'Useful life cannot be zero', resolution: 'Provide positive useful life months (> 0) for depreciable assets.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 8. PAYROLL & HUMAN RESOURCES (1 submodule)
  // =========================================================================
  {
    moduleId: 'payroll',
    moduleName: '8. Payroll & Human Resources',
    submoduleId: 'pay-records',
    submoduleName: 'Payroll & Statutory Compensation',
    category: 'MODULE_SUBMODULE',
    purpose: 'Manage confidential employee salary master records and execute Philippine payroll runs computing 2026 SSS (61-bracket 5% EE + WISP / 10% ER + EC), PhilHealth (5% UHC split 2.5%/2.5%), Pag-IBIG (2% up to cap), and TRAIN Law BIR 1601-C Withholding Tax on Compensation.',
    navigationPath: '/accounting/payroll',
    requiredPermissions: ['payroll:view', 'payroll:create', 'payroll:edit'],
    userInstructions: [
      'Navigate to Payroll & Human Resources > Payroll & Statutory Compensation (/accounting/payroll).',
      'Maintain employee profiles, TINs, SSS/PhilHealth/Pag-IBIG numbers, and basic pay rates.',
      'Create a Payroll Run for the semi-monthly or monthly cutoff, review statutory breakdowns, and submit for approval.',
      'Post approved payroll run to automatically record Salaries Expense, Statutory Contribution Payables, Withholding Tax Payable (1601-C), and Net Pay.'
    ],
    prerequisites: ['Employee master profiles', 'Restricted sensitive permission (payroll:view / ai:inquiry:sensitive for salary inspection)'],
    expectedBehavior: 'Enforces strict RBAC privacy masking for unauthorized users while generating exact centavo statutory deductions and balanced GL postings.',
    accountingImpact: 'DR Salaries & Employer Contributions, CR SSS/PhilHealth/Pag-IBIG Payables, CR WHT Compensation Payable (1601-C), CR Cash/Payroll Payable.',
    dependencies: ['General Ledger', 'Tax & BIR Compliance (1601-C)', 'Approvals & Workflow'],
    keywords: ['payroll', 'salary', 'sss', 'philhealth', 'pag-ibig', '1601-c', 'compensation', 'sweldo', 'sahod', 'employee'],
    commonErrorsAndResolutions: [
      { error: 'Payroll masked or hidden', resolution: 'Payroll compensation requires explicit payroll:view and ai:inquiry:sensitive permissions (Company Owner always has full access).' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 9. TAX & BIR COMPLIANCE (4 submodules)
  // =========================================================================
  {
    moduleId: 'tax',
    moduleName: '9. Tax & BIR Compliance',
    submoduleId: 'tax-engine',
    submoduleName: 'BIR Statutory Returns & eFiling',
    category: 'MODULE_SUBMODULE',
    purpose: 'Compute, prepare, review, file, and lock official Philippine BIR returns under EOPT Act (RA 11976), CREATE Act (RA 11534), and TRAIN Law (RA 10963): VAT (2550Q & optional 2550M), Percentage Tax (2551Q), EWT (0619-E / 1601-EQ / 2307), Compensation WHT (1601-C), Income Tax (1701/1701A/1702Q/1702-RT).',
    navigationPath: '/tax/bir-compliance',
    requiredPermissions: ['tax:view', 'tax:create', 'tax:file'],
    userInstructions: [
      'Navigate to Tax & BIR Compliance > BIR Statutory Returns & eFiling (/tax/bir-compliance).',
      'Verify company Taxpayer Classification and VAT Status (VAT, NON_VAT, 8_PERCENT_FLAT, EXEMPT, ZERO_RATED).',
      'Select the BIR form and taxable period, click "Compute Return from Ledger", review persisted tax calculations and GL reconciliation, then prepare/file.'
    ],
    prerequisites: ['Configured company Tax Profile in Settings', 'Posted sales/purchases/payroll for the taxable period'],
    expectedBehavior: 'Uses company VAT status & persisted tax_calculations/GL lines — never applies 12% VAT to NON_VAT, 8_PERCENT_FLAT, or EXEMPT companies.',
    accountingImpact: 'Tracks tax payable filings, audit checks, and filing status locks without mutating historical posted invoices.',
    dependencies: ['Sales & Receivables', 'Procurement & Payables', 'Payroll', 'Tax Schedules', 'General Ledger'],
    keywords: ['bir', 'tax', '2550q', '2550m', '2551q', '1601-eq', '1601eq', '1601-c', '1702', '1701', '2307', 'eopt', 'create act', 'buwis'],
    commonErrorsAndResolutions: [
      { error: 'Unposted transactions excluded from return', resolution: 'Approve and Post draft invoices/bills before computing statutory BIR returns.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'tax',
    moduleName: '9. Tax & BIR Compliance',
    submoduleId: 'tax-schedules',
    submoduleName: 'VAT & Withholding Schedules',
    category: 'MODULE_SUBMODULE',
    purpose: 'Inspect detailed transaction-level schedules for Output VAT, Creditable Input VAT, Excess Input VAT carry-over, Deferred Input VAT, EWT by ATC code, and Form 2307 vendor certificates.',
    navigationPath: '/tax/vat-schedules',
    requiredPermissions: ['tax:view', 'tax:manage'],
    userInstructions: [
      'Navigate to Tax & BIR Compliance > VAT & Withholding Schedules (/tax/vat-schedules).',
      'Filter by tax period and inspect transaction-by-transaction Output VAT, Input VAT, and EWT withholding breakdowns.',
      'Export supporting schedules or print BIR Form 2307 vendor certificates.'
    ],
    prerequisites: ['Posted invoices, bills, or tax calculation records'],
    expectedBehavior: 'Reconciles schedule totals 1:1 against GL Output VAT (2020), Input VAT (1160), and EWT Payable (2120) accounts.',
    accountingImpact: 'Read-only reconciliation schedule backed by persisted subledger and GL tax lines.',
    dependencies: ['BIR Statutory Returns & eFiling', 'General Ledger'],
    keywords: ['vat schedule', 'withholding schedule', '2307', 'ewt schedule', 'input vat', 'output vat'],
    commonErrorsAndResolutions: [
      { error: 'Schedule differs from GL account', resolution: 'Check if manual JV was posted directly to VAT/EWT GL accounts without a subledger tax code.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'tax',
    moduleName: '9. Tax & BIR Compliance',
    submoduleId: 'tax-data-entry',
    submoduleName: 'Alphalist & SAWT/SLSP Data Entry',
    category: 'MODULE_SUBMODULE',
    purpose: 'Manage BIR Relief / Alphalist datasets: Summary List of Sales and Purchases (SLSP), Summary Alphalist of Withholding Agents of Income Payments Subjected to CWT (SAWT), QAP, and MAP dat-ready schedules.',
    navigationPath: '/tax/ledger-data-entry',
    requiredPermissions: ['tax:view', 'tax:export_dat'],
    userInstructions: [
      'Navigate to Tax & BIR Compliance > Alphalist & SAWT/SLSP Data Entry (/tax/ledger-data-entry).',
      'Select SLSP (Sales/Purchases), SAWT (Form 2307 CWT), QAP, or MAP.',
      'Validate customer/vendor TINs and ATC codes, then export BIR Relief / Alphalist Data Entry compatible files.'
    ],
    prerequisites: ['Valid customer/vendor TINs and registered addresses', 'Posted taxable transactions'],
    expectedBehavior: 'Flags missing TINs or invalid ATC mappings prior to export.',
    accountingImpact: 'Read-only statutory export derived from posted tax and invoice/bill ledgers.',
    dependencies: ['Customer Master Registry', 'Vendor & Supplier Registry', 'Tax Codes'],
    keywords: ['alphalist', 'sawt', 'slsp', 'qap', 'map', 'relief', 'dat export'],
    commonErrorsAndResolutions: [
      { error: 'Export warning: missing 9/12-digit TIN', resolution: 'Complete counterparty TIN in Customer or Vendor Master Registry before e-Submission.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'tax',
    moduleName: '9. Tax & BIR Compliance',
    submoduleId: 'tax-returns',
    submoduleName: 'BIR Form & GL Account Mapping',
    category: 'MODULE_SUBMODULE',
    purpose: 'Configure and audit exact mappings between BIR form boxes/schedules (2550Q, 2551Q, 1601-EQ, 1601-C) and company Chart of Accounts GL codes so tax return lines trace directly to ledger balances.',
    navigationPath: '/tax/forms',
    requiredPermissions: ['tax:view', 'tax:manage'],
    userInstructions: [
      'Navigate to Tax & BIR Compliance > BIR Form & GL Account Mapping (/tax/forms).',
      'Inspect or map each BIR tax box to its authoritative COA account code.',
      'Validate zero unmapped statutory tax accounts before period filing.'
    ],
    prerequisites: ['Populated Chart of Accounts'],
    expectedBehavior: 'Guarantees transparent drill-down from BIR return line items back to Chart of Accounts and Journal Lines.',
    accountingImpact: 'Controls GL-to-BIR mapping governance.',
    dependencies: ['Chart of Accounts', 'Statutory Tax Codes & ATC Rates'],
    keywords: ['bir form mapping', 'tax mapping', 'gl tax mapping', 'tax forms', 'form box'],
    commonErrorsAndResolutions: [
      { error: 'Unmapped tax account', resolution: 'Map Output VAT, Input VAT, Percentage Tax, and EWT Payable COA accounts in BIR Form Mapping.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'tax',
    moduleName: '9. Tax & BIR Compliance',
    submoduleId: 'tax-2307',
    submoduleName: 'BIR Form 2307 (CWT Certificates)',
    category: 'MODULE_SUBMODULE',
    purpose: 'Automate the generation, issuance, SAWT-ready CSV export, and official printing of BIR Form No. 2307 (January 2018 ENCS — Certificate of Creditable Tax Withheld at Source) with all Payor, Payee, TIN digit boxes, Period Covered, Part III-A EWT / Part III-B Business Tax monthly income payments (net of 12% VAT per BIR RR 2-98), and signatory fields auto-populated from the current accounting ledger.',
    navigationPath: '/tax/2307',
    requiredPermissions: ['tax:view', 'tax:manage'],
    userInstructions: [
      'Navigate to Tax & BIR Compliance > BIR Form 2307 (CWT Certificates) (/tax/2307).',
      'Select the Taxable Year and BIR Quarter (Q1–Q4); active quarters with posted bills or supplier disbursement vouchers are highlighted automatically.',
      'Inspect auto-populated Payor and Payee TINs, monthly net-of-VAT income payment bases, ATC codes (WC156, WC157, WC100, WI010, etc.), and GL EWT Control reconciliation.',
      'Click "Ledger Source" to inspect exact posted Purchase Bills and Disbursement Vouchers backing any certificate, then click "Issue & Record 2307" (or Batch Issue) to log it to the Statutory Tax Register.',
      'Click "Print Form 2307" or "Batch Print" to print clean official BIR Form 2307 sheets without ERP navigation chrome.'
    ],
    prerequisites: ['Configured Company TIN & Address (Payor)', 'Vendor TIN & Address in Vendor Master (Payee)', 'Posted Purchase Bills and/or Supplier Disbursement Vouchers with EWT'],
    expectedBehavior: 'Computes EWT income payment base strictly net of 12% Input VAT under BIR RR 2-98, reconciles recorded Disbursement Voucher EWT against GL EWT Payable accounts (2030/2120), enforces the 20th-day post-quarter BIR issuance deadline, and records every issued certificate in tax_filings with an immutable audit log entry.',
    accountingImpact: 'Reads posted AP subledger and GL EWT balances without mutating historical journals; logs statutory issuance records in tax_filings and audit_logs.',
    dependencies: ['Purchase Bills & Accounts Payable', 'Supplier Disbursement Vouchers', 'Vendor & Supplier Registry', 'General Ledger', 'BIR Statutory Returns & eFiling'],
    keywords: ['2307', 'bir form 2307', 'cwt', 'creditable withholding tax', 'certificate of creditable tax withheld', 'ewt certificate', 'print 2307', 'atc', 'wc156', 'wc157', 'wc100', 'wi010', 'sawt'],
    commonErrorsAndResolutions: [
      { error: 'Payee TIN missing warning on Form 2307', resolution: 'Complete the vendor 9-to-14 digit TIN in Master Data > Vendor & Supplier Registry before official BIR issuance.' },
      { error: 'ATC Not Assigned warning', resolution: 'Assign an official BIR ATC code on the bill line, vendor withholding applicability, or select an ATC override in the Form 2307 toolbar.' },
      { error: 'Gross amount differs from bill total', resolution: 'Per BIR RR 2-98, BIR Form 2307 reports income payments strictly exclusive (net) of 12% Input VAT.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 10. BUDGET & FINANCIAL PLANNING (1 submodule)
  // =========================================================================
  {
    moduleId: 'budget',
    moduleName: '10. Budget & Financial Planning',
    submoduleId: 'bud-mgmt',
    submoduleName: 'Budget & Variance Planning',
    category: 'MODULE_SUBMODULE',
    purpose: 'Define monthly/annual operating budgets by expense category, department, or cost center and monitor real-time Budget vs Actual GL utilization & overrun alerts.',
    navigationPath: '/budget',
    requiredPermissions: ['budget:view', 'budget:create', 'budget:edit'],
    userInstructions: [
      'Navigate to Budget & Financial Planning > Budget & Variance Planning (/budget).',
      'Create budget lines by Period Month, Category, Department, or Cost Center.',
      'Compare Actual Posted GL Expenses against Budget Limits and monitor variance percentages.'
    ],
    prerequisites: ['Configured Cost Centers/Departments (optional)', 'budget:view permission'],
    expectedBehavior: 'Calculates variance in real time using posted General Ledger expense totals.',
    accountingImpact: 'Read-only planning and variance control; does not post GL entries.',
    dependencies: ['General Ledger', 'Organizational Dimensions & Cost Centers'],
    keywords: ['budget', 'variance', 'budget vs actual', 'overspend', 'planning'],
    commonErrorsAndResolutions: [
      { error: 'Budget alerts not matching draft bills', resolution: 'Actual spending tracks POSTED expenses; draft/unapproved bills appear only after posting.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 11. DOCUMENTS & OCR (1 submodule)
  // =========================================================================
  {
    moduleId: 'documents',
    moduleName: '11. Documents & OCR',
    submoduleId: 'doc-inbox',
    submoduleName: 'Document Vault & OCR Inbox',
    category: 'MODULE_SUBMODULE',
    purpose: 'Store supporting financial files in AES-256-GCM encrypted `LAISDOC1` containers with SHA-256 integrity seals, extract receipt/invoice metadata via offline Tesseract OCR, and link evidence to invoices, bills, cash items, and journals.',
    navigationPath: '/documents',
    requiredPermissions: ['documents:view', 'documents:create', 'documents:upload'],
    userInstructions: [
      'Navigate to Documents & OCR > Document Vault & OCR Inbox (/documents).',
      'Upload a receipt or invoice image/PDF; LedgerAI encrypts the binary into a LAISDOC1 vault file and hashes its SHA-256 digest.',
      'Run OCR extraction to capture Supplier Name, TIN, Date, Invoice No., and Total Amount.',
      'Attach/link the verified document to a Purchase Bill, Expense, Cash Transaction, or Journal Entry.'
    ],
    prerequisites: ['PDF/PNG/JPEG document upload'],
    expectedBehavior: 'Prevents silent tampering by verifying SHA-256 hashes during Ledger Integrity scans.',
    accountingImpact: 'Provides statutory substantiation (BIR RR & EOPT Act invoice/receipt retention) for GL transactions.',
    dependencies: ['Procurement & Payables', 'Cryptographic Ledger Integrity'],
    keywords: ['documents', 'ocr', 'receipt', 'vault', 'laisdoc1', 'attachment', 'upload', 'resibo'],
    commonErrorsAndResolutions: [
      { error: 'OCR failed to detect TIN or amount', resolution: 'Upload a higher-resolution scan or review/edit extracted metadata fields manually before linking.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 12. REPORTS & ANALYTICS (1 submodule)
  // =========================================================================
  {
    moduleId: 'reports',
    moduleName: '12. Reports & Analytics',
    submoduleId: 'rep-statements',
    submoduleName: 'Financial Statements & Reports Hub',
    category: 'MODULE_SUBMODULE',
    purpose: 'Generate authoritative Balance Sheet, Income Statement (Profit & Loss), Statement of Cash Flows, Trial Balance, General Ledger Detail, and AR/AP Aging schedules directly from posted GL & subledger records.',
    navigationPath: '/reports',
    requiredPermissions: ['reports:view'],
    userInstructions: [
      'Navigate to Reports & Analytics > Financial Statements & Reports Hub (/reports).',
      'Select report type (Income Statement, Balance Sheet, Cash Flow, Trial Balance, AR/AP Aging, General Ledger), date range, and dimension filters.',
      'Inspect line items and drill down to underlying posted journals, or export formatted statements.'
    ],
    prerequisites: ['Posted General Ledger entries'],
    expectedBehavior: 'Guarantees Assets === Liabilities + Equity on Balance Sheet and matches Income Statement net income cleanly.',
    accountingImpact: 'Read-only authoritative PFRS/GAAP financial reporting.',
    dependencies: ['Accounting & General Ledger', 'Sales & Receivables', 'Procurement & Payables', 'Cash & Banking'],
    keywords: ['reports', 'financial statements', 'balance sheet', 'income statement', 'profit and loss', 'p&l', 'cash flow', 'aging', 'analytics'],
    commonErrorsAndResolutions: [
      { error: 'Permission denied on /reports', resolution: 'Ensure reports:view or accounting:view is assigned (or log in as Company Owner).' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 13. APPROVALS & WORKFLOW (1 submodule)
  // =========================================================================
  {
    moduleId: 'approvals',
    moduleName: '13. Approvals & Workflow',
    submoduleId: 'appr-inbox',
    submoduleName: 'Approval Inbox & Workflow Orchestration',
    category: 'MODULE_SUBMODULE',
    purpose: 'Enterprise multi-level approval orchestration engine enforcing BIR Maker-Checker Segregation of Duties (SoD), configurable PHP amount thresholds, sequential & parallel quorum routing, standing/temporary delegations, SLA timer evaluation, and 360° transaction drill-down.',
    navigationPath: '/activity-center?workspace=approvals',
    requiredPermissions: ['approvals:view', 'approvals:approve', 'approvals:reject', 'approvals:review'],
    userInstructions: [
      'Navigate to 13. Approvals & Workflow > Approval Inbox & Workflows (/approvals or /activity-center?workspace=approvals).',
      'Use the 3 sub-views: (1) Actionable Approval Queue to review and decide workflows, (2) Approval Policy Matrix & Thresholds to configure PHP tier thresholds and required roles, and (3) Standing & Temporary Delegations to assign or revoke delegated approval authority.',
      'Filter the queue using the 9 status pills: My Pending Approvals, All Authorized Pending Approvals, Awaiting My Approval, Delegated Approvals, Overdue Approvals, Returned for Correction, Rejected Records, Approved Records, and Approval History.',
      'Filter by Transaction Type (Manual Journal Entries, Sales Invoices, Supplier Bills, Purchase Requisitions, Purchase Orders, Goods Receipt Notes, Supplier Payments, Credit Memos, Cash Transactions, Inventory Adjustments, Payroll Runs, BIR Tax Returns, Bank Reconciliations) or click "Evaluate SLA Timers" to run an automated overdue SLA and escalation sweep.',
      'On any workflow row, click "Supporting Docs (N)" to inspect attached BIR invoices/vouchers/2307 certificates, "Approval History" to expand the multi-level approval chain and delegate/reassign/escalate steps, "View Details" or "Entity Journey 360°" to inspect full accounting & tax lines, or click "Approve", "Return for Correction", or "Reject" with mandatory audit remarks.',
      'Once a workflow reaches APPROVED status, click "Post to GL" (or "Convert to PO" for Purchase Requisitions) directly from the queue or inside the 360° Journey modal to post balanced Debit/Credit entries and BIR tax calculations to the General Ledger.'
    ],
    prerequisites: ['Submitted transaction created by another user (strict Maker-Checker non-self-approval SoD policy)'],
    expectedBehavior: 'Blocks self-approval of transactions created or submitted by the same user (SOD_VIOLATION), enforces PHP approval tier thresholds (Tier 1 up to ₱100k, Tier 2 ₱100k–₱5M, Tier 3 > ₱5M), tracks SLA due dates, and logs every decision to the BIR CAS RR 9-2009 immutable audit trail.',
    accountingImpact: 'Approving a workflow transitions the underlying transaction (Sales Invoice, Purchase Bill, Journal Entry, Payroll Run, Cash Transaction, etc.) to APPROVED status, unlocking authoritative General Ledger posting (Dr/Cr GL + 12% Output/Input VAT, 3% Percentage Tax, or 1%/2%/5% EWT Form 2307).',
    dependencies: ['Enterprise RBAC & Access Matrix', '14. Activity Center', '15. Audit & Governance', '6. Accounting & General Ledger'],
    keywords: ['approval', 'approvals', 'workflow', 'maker checker', 'sod', 'pending approval', 'approve', 'reject', 'return for correction', 'delegated approvals', 'overdue approvals', 'evaluate sla timers', 'policy matrix', 'delegations', 'supporting docs'],
    commonErrorsAndResolutions: [
      { error: 'SOD_VIOLATION: Self-approval not allowed', resolution: 'Under BIR internal control and Maker-Checker SoD rules, the creator/submitter cannot approve their own voucher. Log in as an independent Approver, Finance Manager, or Company Owner.' },
      { error: 'Mandatory reason/remarks required for RETURN or REJECT', resolution: 'Provide clear correction instructions or rejection justification in the decision modal so the requester has a complete audit trail.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 14. ACTIVITY CENTER (1 submodule)
  // =========================================================================
  {
    moduleId: 'activity-center',
    moduleName: '14. Activity Center',
    submoduleId: 'act-stream',
    submoduleName: 'Global Activity Center & Forensic Traceability',
    category: 'MODULE_SUBMODULE',
    purpose: 'Centralized 360° record journey hub providing a real-time chronological activity stream across 15 lifecycle categories, field-level Before & After JSON diff inspection, 7-mode Forensic Audit Investigation, 27-Module Coverage Matrix, and Management Governance Analytics.',
    navigationPath: '/activity-center?workspace=stream',
    requiredPermissions: ['activity:view', 'audit:view'],
    userInstructions: [
      'Navigate to 14. Activity Center > Enterprise Activity Stream (/activity-center).',
      'Switch across the 5 top-level governance workspaces: (1) Activity Journey Stream, (2) Approval Inbox & Workflows, (3) Forensic Audit Investigation, (4) 27-Module Coverage Matrix, and (5) Management Governance Analytics.',
      'In Workspace 1 (Activity Journey Stream), click any of the 15 lifecycle category pills: Recent Activity, My Activities, Created Records, Edited Records, Pending Approvals, Approval History, Rejected Records, Returned for Correction, Cancelled Records, Archived Records, Deleted Records, Restored Records, Reversed Transactions, Failed Actions, and Security & Permission Events.',
      'Use the 7-dimension filter toolbar to filter by Record Ref/Action/Remarks, User Name/ID, Role (Owner, Admin, Approver, Accountant, Auditor), Module/Record Type, Lifecycle Status (DRAFT, SUBMITTED, APPROVED, POSTED, RETURNED, REJECTED, CANCELLED, ARCHIVED, SOFT_DELETED, REVERSED), and Start/End Date.',
      'Inspect the "Before & After / Remarks" column to view status transitions (e.g., SUBMITTED -> APPROVED, APPROVED -> POSTED), field-level value changes, and accountant/approver remarks.',
      'Click "Diff" to jump directly to the field comparison tab or click "360° Journey" on any row to open the full 360° Record Journey modal showing GL postings, BIR tax breakdown, approval steps, and supporting documents.'
    ],
    prerequisites: ['activity:view permission'],
    expectedBehavior: 'Displays tenant-isolated chronological activity with real entity references, before/after field diffs, and one-click 360° drill-down into the live SQLite record.',
    accountingImpact: 'Read-only operational & forensic traceability hub linking every activity event directly to its authoritative subledger and General Ledger voucher.',
    dependencies: ['13. Approvals & Workflow', '15. Audit & Governance — Immutable Audit Trail Logs'],
    keywords: ['activity center', 'activity stream', '360 journey', 'timeline', 'history', 'before and after', 'field diff', 'created records', 'edited records', 'returned for correction', 'rejected records', 'cancelled records', 'archived records', 'deleted records', 'restored records', 'forensic audit investigation', '27-module coverage matrix', 'management governance analytics'],
    commonErrorsAndResolutions: [
      { error: 'Filter returns no matching records', resolution: 'Reset the lifecycle category pill to "Recent Activity" and clear date or status filters to inspect the full company activity stream.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 15. AUDIT & GOVERNANCE (6 submodules)
  // =========================================================================
  {
    moduleId: 'audit',
    moduleName: '15. Audit & Governance',
    submoduleId: 'aud-trail',
    submoduleName: 'Immutable Audit Trail Logs',
    category: 'MODULE_SUBMODULE',
    purpose: 'Philippine BIR CAS (RR 9-2009 / RMC 5-2021) compliant, strictly append-only audit trail sealed with SHA-256 & HMAC hash chaining (`previousHash -> integritySeal`) capturing WHO, WHAT, WHEN (PHT), WHERE (IP/Source), and field-by-field Before/After mutations.',
    navigationPath: '/audit/logs',
    requiredPermissions: ['audit:view', 'audit:verify', 'audit:export', 'reports:export'],
    userInstructions: [
      'Navigate to 15. Audit & Governance > Immutable Audit Trail Logs (/audit/logs).',
      'Use the 5 Category Quick Tabs to filter by domain: All Activities, Files & Documents, Company Profile & Tax Settings, User & Role Modifications, and Journal & Accounting.',
      'Search by User Name, Email, Role, Record Reference, TIN, Action, or Reason, or filter by Entity/Module, Outcome (SUCCESS, FAILED, WARNING), Severity (INFO, WARN, ERROR, CRITICAL), and From/To Date (Philippine Standard Time - PHT) and click "Apply Filters".',
      'Click "Inspect" on any row to open the Forensic Deep Dive Modal displaying live SHA-256 cryptographic seal verification (TAMPER_FREE_VERIFIED), red-to-green field-by-field Before vs After comparisons, and click "Open 360° Entity Journey" to inspect the underlying accounting record.',
      'Click "Download Audit Trail (PDF)" to generate an official signed A4 landscape compliance PDF report, or click "BIR CAS CSV" to export the statutory BIR RR 9-2009 Computerized Accounting System audit trail CSV.'
    ],
    prerequisites: ['audit:view permission'],
    expectedBehavior: 'Every state-changing operation appends an immutable, cryptographically sealed log row. Direct POST/PUT/PATCH/DELETE mutations to /api/audit are permanently blocked with HTTP 403 AUDIT_LOG_IMMUTABLE per BIR RR 9-2009.',
    accountingImpact: 'Provides statutory BIR Computerized Accounting System (CAS) non-repudiation evidence and PSA 230 audit documentation across all modules.',
    dependencies: ['Cryptographic Ledger Integrity', '14. Activity Center'],
    keywords: ['audit log', 'audit trail', 'hmac', 'sha-256 seal', 'immutable log', 'bir cas csv', 'rr 9-2009', 'inspect', 'modified fields', 'diffs', 'download audit trail pdf'],
    commonErrorsAndResolutions: [
      { error: 'AUDIT_LOG_IMMUTABLE (HTTP 403)', resolution: 'Under BIR RR 9-2009 CAS rules, audit trail logs are strictly append-only and cannot be edited or deleted.' },
      { error: 'Audit log access denied', resolution: 'Requires audit:view permission (granted to Company Owner, Auditor, Administrator, and authorized roles).' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'audit',
    moduleName: '15. Audit & Governance',
    submoduleId: 'aud-engagements',
    submoduleName: 'Audit Engagements & Planning',
    category: 'MODULE_SUBMODULE',
    purpose: 'Manage external or internal Philippine Standards on Auditing (PSA 300/315/320) financial & BIR tax audit engagements, materiality thresholds (Overall, Performance, Trivial), significant accounts, PBC checklists, and risk assessments.',
    navigationPath: '/audit/engagements',
    requiredPermissions: ['audit:view', 'audit:manage'],
    userInstructions: [
      'Navigate to 15. Audit & Governance > Audit Engagements & Planning (/audit/engagements).',
      'Create or select an Audit Engagement (Statutory Financial Audit, BIR Tax Compliance Audit, or Internal Controls Review) specifying Overall Materiality, Performance Materiality, and Clearly Trivial Threshold in PHP.',
      'Drill into the engagement workspace tabs to manage PSA 300 Audit Planning Memo, Significant Accounts & Assertions, PBC Request Items, Working Papers, Findings & AJE, Internal Controls, and Fraud Flags.'
    ],
    prerequisites: ['audit:view permission'],
    expectedBehavior: 'Links materiality benchmarks directly to PSA workpapers, significant GL accounts, and forensic anomaly sampling.',
    accountingImpact: 'Read-only audit planning & governance; Proposed Audit Journal Entries (AJEs) flow through formal approval before impacting GL.',
    dependencies: ['PSA Working Papers & Lead Sheets'],
    keywords: ['audit engagement', 'materiality', 'psa', 'external audit', 'audit planning', 'pbc'],
    commonErrorsAndResolutions: [
      { error: 'Materiality percentage invalid', resolution: 'Specify positive materiality amount in PHP or valid percentage benchmark.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'audit',
    moduleName: '15. Audit & Governance',
    submoduleId: 'aud-workpapers',
    submoduleName: 'PSA Working Papers & Lead Sheets',
    category: 'MODULE_SUBMODULE',
    purpose: 'Maintain PSA 230/315/500 audit working papers, lead schedules (A-100 Cash, B-100 AR, C-100 BIR Tax & 2307), standard audit tick-marks (✓, ⊗, ‡, £, ⌂), evidence attachments, and Preparer/Reviewer/Partner sign-offs.',
    navigationPath: '/audit/workpapers',
    requiredPermissions: ['audit:view'],
    userInstructions: [
      'Navigate to 15. Audit & Governance > PSA Working Papers & Lead Sheets (/audit/workpapers).',
      'Select or create a working paper (e.g., A-100 Cash & Bank Lead Sheet, B-100 AR Subledger Tie-Out, C-100 BIR Form 2307 Vouching).',
      'Record audit objectives, substantive procedures, results, standard audit tick-marks, and execute Reviewer / Partner sign-off.'
    ],
    prerequisites: ['Active Audit Engagement', 'Posted Trial Balance accounts'],
    expectedBehavior: 'Binds working papers and lead schedules to live GL balances and tracks formal PSA 230 sign-off stages (PREPARED -> REVIEWED -> APPROVED/LOCKED).',
    accountingImpact: 'Read-only audit documentation.',
    dependencies: ['Audit Engagements & Planning', 'Trial Balance Ledger'],
    keywords: ['working papers', 'workpapers', 'lead sheets', 'tickmark', 'psa 230'],
    commonErrorsAndResolutions: [
      { error: 'Lead sheet stale after new posting', resolution: 'Refresh lead sheet snapshot to pull newly posted journal entries.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'audit',
    moduleName: '15. Audit & Governance',
    submoduleId: 'aud-forensic',
    submoduleName: 'Forensic & Fraud Anomaly Detection',
    category: 'MODULE_SUBMODULE',
    purpose: 'Execute automated PSA 240 forensic analytics including duplicate payment detection, round-number manual journal scans, high-value disbursement SoD checks, weekend/after-hours postings, and threshold splitting detection.',
    navigationPath: '/audit/fraud',
    requiredPermissions: ['audit:view'],
    userInstructions: [
      'Navigate to 15. Audit & Governance > Forensic & Fraud Anomaly Detection (/audit/fraud).',
      'Click "Run Fraud Heuristics Scan" to evaluate posted invoices, bills, payments, and manual journal entries against PSA 240 fraud risk rules.',
      'Filter flags by Severity (CRITICAL, HIGH, MEDIUM, LOW) or Status (OPEN, INVESTIGATING, RESOLVED, FALSE_POSITIVE) and record auditor resolution notes.'
    ],
    prerequisites: ['audit:view permission', 'Posted accounting transactions'],
    expectedBehavior: 'Identifies statistical and rule-based anomalies deterministically against the live SQLite ledger.',
    accountingImpact: 'Read-only forensic control monitoring.',
    dependencies: ['General Journal & Ledger', 'Procurement & Payables', 'Sales & Receivables'],
    keywords: ['fraud', 'forensic', 'anomaly', 'benford', 'duplicate invoice', 'threshold splitting', 'psa 240'],
    commonErrorsAndResolutions: [
      { error: 'Low sample size for Benford analysis', resolution: 'Benford statistics gain significance once ≥100 monetary transactions exist; deterministic duplicate and round-number rules run on any dataset size.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'audit',
    moduleName: '15. Audit & Governance',
    submoduleId: 'aud-integrity',
    submoduleName: 'Cryptographic Ledger Integrity',
    category: 'MODULE_SUBMODULE',
    purpose: 'Run 3-domain offline cryptographic & accounting integrity verification across Domain 1 (Accounting & Double-Entry Invariants: TB DR=CR, AR/AP Subledger===GL), Domain 2 (Relational & Referential Integrity), and Domain 3 (SHA-256/HMAC Audit Chain & Document Vault Seals).',
    navigationPath: '/audit/integrity',
    requiredPermissions: ['audit:view', 'audit:verify', 'audit:integrity:view', 'audit:integrity:scan'],
    userInstructions: [
      'Navigate to 15. Audit & Governance > Cryptographic Ledger Integrity (/audit/integrity).',
      'Click "Run 3-Domain Cryptographic Scan" to verify all double-entry balances, AR/AP subledger reconciliations, and SHA-256 audit log hash chains.',
      'Inspect the domain check cards and export the signed JSON or CSV Cryptographic Integrity Report for external auditors or BIR CAS inspection.'
    ],
    prerequisites: ['audit:view / audit:integrity:view permission'],
    expectedBehavior: 'Detects any offline SQLite tampering, broken audit hash chain, or subledger-to-GL discrepancy immediately and persists a SHA-256 signed scan report.',
    accountingImpact: 'System-wide financial & cryptographic integrity verification.',
    dependencies: ['Immutable Audit Trail Logs', 'Accounting Periods & Lock', 'Document Vault & OCR Inbox'],
    keywords: ['ledger integrity', 'cryptographic integrity', 'tamper', 'hash chain', 'sha-256', 'verify integrity'],
    commonErrorsAndResolutions: [
      { error: 'Integrity mismatch reported', resolution: 'Inspect the specific finding row, click 360° drill-down to review the record, or restore a verified backup snapshot from the Database Vault.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'audit',
    moduleName: '15. Audit & Governance',
    submoduleId: 'aud-archive-vault',
    submoduleName: 'System Archive Vault & Retention Inbox',
    category: 'MODULE_SUBMODULE',
    purpose: 'Centralized retention vault for archived and soft-deleted records across all ERP modules, enforcing the 30-day operational recovery window while protecting posted financial & tax records under BIR RR 17-2013 / RR 5-2014 (10-Year Statutory Retention).',
    navigationPath: '/audit/archive-vault',
    requiredPermissions: ['audit:view'],
    userInstructions: [
      'Navigate to 15. Audit & Governance > System Archive Vault & Retention Inbox (/audit/archive-vault).',
      'Filter archived records by Source Module or search by record code, name, or entity type.',
      'Click "Restore" to return an archived record back to its active pre-archive status, or inspect the "BIR Retained" lock badge protecting statutory records under the 10-year BIR retention rule.'
    ],
    prerequisites: ['audit:view permission'],
    expectedBehavior: 'Allows one-click restoration of archived master data and unposted drafts while permanently blocking destructive purge of posted GL/BIR tax records.',
    accountingImpact: 'Preserves historical referential integrity for posted General Ledger and BIR tax filings while keeping active operational views clean.',
    dependencies: ['Immutable Audit Trail Logs', 'Chart of Accounts', 'Sales & Receivables', 'Procurement & Payables'],
    keywords: ['archive vault', 'retention inbox', 'restore archived', 'purge', 'bir 10-year retention', 'rr 17-2013', 'soft deleted'],
    commonErrorsAndResolutions: [
      { error: 'Purge blocked by BIR Statutory Retention', resolution: 'Records with posted General Ledger or BIR tax impact must be retained for 10 years under NIRC Sec. 235 and BIR RR 17-2013 / RR 5-2014.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // 16. MASTER DATA & ADMINISTRATION (8 submodules)
  // =========================================================================
  {
    moduleId: 'master-data',
    moduleName: '16. Master Data & Administration',
    submoduleId: 'md-customers',
    submoduleName: 'Customer Master Registry',
    category: 'MODULE_SUBMODULE',
    purpose: 'Maintain customer legal names, trade names, BIR TINs, VAT status, credit limits, payment terms, and contact details for invoicing and BIR SLSP/SAWT reporting.',
    navigationPath: '/master-data/customers',
    requiredPermissions: ['masterdata:view', 'customers:create', 'customers:edit'],
    userInstructions: [
      'Navigate to Master Data & Administration > Customer Master Registry (/master-data/customers).',
      'Click "Add Customer" and enter Legal Name, TIN (for VAT/EWT reporting), Address, VAT Status, and Payment Terms.',
      'Save to make the customer selectable in Sales Invoices and AR Collections.'
    ],
    prerequisites: ['masterdata:view / customers:create permission'],
    expectedBehavior: 'Enforces company-scoped uniqueness and supplies statutory TIN/classification fields to invoicing and tax engines.',
    accountingImpact: 'Controls AR subledger counterparty attribution and 2307/SLSP outputs.',
    dependencies: ['Sales & Receivables', 'Tax & BIR Compliance'],
    keywords: ['customer', 'customers', 'client', 'customer master', 'credit limit'],
    commonErrorsAndResolutions: [
      { error: 'Cannot delete customer with posted invoices', resolution: 'Archive or deactivate customer instead of deleting historical financial references.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'master-data',
    moduleName: '16. Master Data & Administration',
    submoduleId: 'md-vendors',
    submoduleName: 'Vendor & Supplier Registry',
    category: 'MODULE_SUBMODULE',
    purpose: 'Maintain vendor/supplier legal profiles, BIR TINs, VAT registration, default EWT ATC applicability, and payment terms for Procurement, Purchase Bills, and Form 2307 generation.',
    navigationPath: '/master-data/vendors',
    requiredPermissions: ['masterdata:view', 'vendors:create', 'vendors:edit'],
    userInstructions: [
      'Navigate to Master Data & Administration > Vendor & Supplier Registry (/master-data/vendors).',
      'Click "Add Vendor" and provide Legal Name, BIR TIN, Registered Address, VAT Status, and default EWT applicability.',
      'Save to enable selection across Purchase Orders, Bills, Payments, and 2307 certificates.'
    ],
    prerequisites: ['masterdata:view / vendors:create permission'],
    expectedBehavior: 'Auto-populates default withholding & VAT attributes during bill entry and validates QAP/1601-EQ completeness.',
    accountingImpact: 'Controls AP subledger counterparty attribution and Form 2307 EWT certificates.',
    dependencies: ['Procurement & Payables', 'Tax & BIR Compliance'],
    keywords: ['vendor', 'supplier', 'vendor master', 'supplier tin'],
    commonErrorsAndResolutions: [
      { error: 'Missing TIN blocks Form 2307 export', resolution: 'Enter supplier 9- or 12-digit TIN and registered address in Vendor profile.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'master-data',
    moduleName: '16. Master Data & Administration',
    submoduleId: 'md-cost-centers',
    submoduleName: 'Organizational Dimensions & Cost Centers',
    category: 'MODULE_SUBMODULE',
    purpose: 'Configure Departments, Cost Centers, Projects, and Branch Locations for multi-dimensional GL tagging, budget allocation, and segmented profitability reports.',
    navigationPath: '/master-data/cost-centers',
    requiredPermissions: ['masterdata:view', 'masterdata:manage'],
    userInstructions: [
      'Navigate to Master Data & Administration > Organizational Dimensions & Cost Centers (/master-data/cost-centers).',
      'Create Department, Cost Center, Project, or Location codes.',
      'Tag journal lines, bills, and invoices with dimensions to analyze Budget vs Actual and departmental P&L.'
    ],
    prerequisites: ['masterdata:view / masterdata:manage permission'],
    expectedBehavior: 'Makes active dimensions selectable across journal lines, budgets, and analytics.',
    accountingImpact: 'Enables dimensional segment reporting and data-scope RBAC enforcement.',
    dependencies: ['Budget & Financial Planning', 'General Journal & Ledger', 'Reports & Analytics'],
    keywords: ['cost center', 'department', 'project', 'location', 'branch', 'dimensions'],
    commonErrorsAndResolutions: [
      { error: 'Duplicate cost center code', resolution: 'Use unique organizational codes per company.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'master-data',
    moduleName: '16. Master Data & Administration',
    submoduleId: 'md-tax-codes',
    submoduleName: 'Statutory Tax Codes & ATC Rates',
    category: 'MODULE_SUBMODULE',
    purpose: 'Manage BIR VAT (12% Standard, Zero-Rated, VAT-Exempt), Percentage Tax (Sec. 116), and Alphanumeric Tax Codes (ATC for EWT such as WC158 1%, WC160 2%, WC010 10%, WI010 5%, WC100 5%) mapped to Tax Liability/Asset COA accounts.',
    navigationPath: '/master-data/tax-codes',
    requiredPermissions: ['masterdata:view', 'tax:manage'],
    userInstructions: [
      'Navigate to Master Data & Administration > Statutory Tax Codes & ATC Rates (/master-data/tax-codes).',
      'Inspect seeded statutory BIR tax codes or add custom company tax rates.',
      'Confirm each tax code points to the valid Output VAT, Input VAT, or Withholding Tax COA account.'
    ],
    prerequisites: ['Chart of Accounts tax accounts configured'],
    expectedBehavior: 'Supplies accurate rates and GL tax account IDs to Sales Invoicing, Purchase Bills, and TaxEngine.',
    accountingImpact: 'Determines exact GL tax posting lines when invoices and bills are recorded.',
    dependencies: ['Chart of Accounts', 'Tax & BIR Compliance'],
    keywords: ['tax code', 'atc', 'wc158', 'wc160', 'wc010', 'vat12', 'vatex', 'vat0'],
    commonErrorsAndResolutions: [
      { error: 'Tax account missing on new tax code', resolution: 'Link every tax code to an active Liability or Asset tax account in COA.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'master-data',
    moduleName: '16. Master Data & Administration',
    submoduleId: 'md-roles',
    submoduleName: 'Enterprise RBAC & Access Matrix',
    category: 'MODULE_SUBMODULE',
    purpose: 'Administer company users, assign canonical or custom roles, configure granular module/submodule/action/data-scope/approval-limit controls for employees, inspect live effective access, and manage Company Ownership Transfer.',
    navigationPath: '/master-data/rbac',
    requiredPermissions: ['roles:manage', 'users:manage'],
    userInstructions: [
      'Navigate to Master Data & Administration > Enterprise RBAC & Access Matrix (/master-data/rbac).',
      'Select an employee/member to configure module visibility, submodules, actions, data scope, and PHP approval limit.',
      'Active Company Owner accounts are permanently unrestricted (16/16 modules, 36/36 submodules, COMPANY_WIDE, -1 unlimited limit) and immune to employee permission checkboxes.',
      'Use "Reset to Role Default" or "Transfer Ownership" (Owner only) with mandatory audit reason.'
    ],
    prerequisites: ['Company Owner or Company Administrator (`roles:manage`)'],
    expectedBehavior: 'Persists RBAC changes with before/after immutable audit trail, enforces non-Owner asymmetric protection, and prevents Auditor write escalations.',
    accountingImpact: 'Controls who can create, review, approve, post, export, or lock accounting records.',
    dependencies: ['Company Owner Full Authority Policy', 'Immutable Audit Trail Logs'],
    keywords: ['rbac', 'roles', 'permissions', 'access matrix', 'user management', 'company owner', 'transfer ownership', 'data scope'],
    commonErrorsAndResolutions: [
      { error: 'OWNER_UNRESTRICTED_POLICY error when editing Company Owner', resolution: 'Company Owner cannot be restricted by employee checkboxes; assign another role or transfer ownership first if needed.' },
      { error: 'PERMISSION_DENIED: Admin modifying Owner', resolution: 'Only an authorized Company Owner can transfer or modify Owner assignments.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'master-data',
    moduleName: '16. Master Data & Administration',
    submoduleId: 'md-backup-vault',
    submoduleName: 'Database Vault & Disaster Recovery',
    category: 'MODULE_SUBMODULE',
    purpose: 'Create AES-256-GCM encrypted `.laisbak` company backups, download clean zero-data starter templates or full company packages, verify SHA-256 integrity, and perform atomic database restores.',
    navigationPath: '/master-data/backup-vault',
    requiredPermissions: ['backups:view', 'backups:create', 'backups:restore'],
    userInstructions: [
      'Navigate to Master Data & Administration > Database Vault & Disaster Recovery (/master-data/backup-vault).',
      'Click "Create Encrypted Backup" to generate an AES-256-GCM encrypted `.laisbak` snapshot with manifest checksum.',
      'Verify backup integrity before restore or download for offsite archiving.',
      'To restore, select a verified snapshot (or upload `.laisbak`/`.db`) and confirm; LedgerAI validates schema & checksums before atomic cutover.'
    ],
    prerequisites: ['backups:view / backups:manage permission', 'Healthy company SQLite database'],
    expectedBehavior: 'Strictly isolates backups by companyId and generates clean zero-data starter packages free of any demo or foreign company rows.',
    accountingImpact: 'Protects historical ledgers, audit logs, and LAISDOC1 vault continuity.',
    dependencies: ['CompanyManager', 'BackupEncryptionService'],
    keywords: ['backup', 'restore', 'vault', 'laisbak', 'disaster recovery', 'clean starter', 'download database', 'export database'],
    commonErrorsAndResolutions: [
      { error: 'Backup decryption or checksum mismatch', resolution: 'Ensure the matching encryption passphrase/key and uncorrupted .laisbak file are used.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'master-data',
    moduleName: '16. Master Data & Administration',
    submoduleId: 'md-lan-network',
    submoduleName: 'Multi-Workstation LAN & Concurrency',
    category: 'MODULE_SUBMODULE',
    purpose: 'Configure SQLite WAL concurrency, view connected LAN workstations/sessions, monitor database locks, and verify optimistic concurrency versioning across simultaneous ERP users.',
    navigationPath: '/master-data/lan-network',
    requiredPermissions: ['lan:view', 'lan:manage'],
    userInstructions: [
      'Navigate to Master Data & Administration > Multi-Workstation LAN & Concurrency (/master-data/lan-network).',
      'Inspect LAN host URL, SQLite WAL journal mode, active sessions, and write lock diagnostics.',
      'Monitor concurrency health metrics when multiple workstations operate simultaneously.'
    ],
    prerequisites: ['lan:view permission'],
    expectedBehavior: 'Maintains safe multi-user WAL locking and detects optimistic version conflicts (`HTTP 409`).',
    accountingImpact: 'Prevents double-posting or lost-update races across concurrent accountants and cashiers.',
    dependencies: ['CompanyManager', 'SQLite WAL Engine'],
    keywords: ['lan', 'network', 'multi-user', 'concurrency', 'workstation', 'wal'],
    commonErrorsAndResolutions: [
      { error: 'HTTP 409 Concurrent Modification Conflict', resolution: 'Reload the record to fetch the latest server version before re-submitting changes.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'master-data',
    moduleName: '16. Master Data & Administration',
    submoduleId: 'md-settings',
    submoduleName: 'Enterprise Profile & System Settings',
    category: 'MODULE_SUBMODULE',
    purpose: 'Configure Legal Name, Trade Name, BIR TIN, RDO Code, Taxpayer Classification, VAT Status (`VAT`, `NON_VAT`, `8_PERCENT_FLAT`, `EXEMPT`, `ZERO_RATED`), Fiscal Year, COA Auto-Mapping defaults, and Multi-Provider AI Agent Keys.',
    navigationPath: '/settings',
    requiredPermissions: ['settings:view', 'settings:manage', 'ai:config', 'ai:keys:manage'],
    userInstructions: [
      'Navigate to Master Data & Administration > Enterprise Profile & System Settings (/settings).',
      'Update Company Profile, BIR TIN, RDO Code, Taxpayer Classification, and VAT Status.',
      'Under AI Settings, configure online Gemini/OpenAI/Grok keys with failover priority or force Local Offline Deterministic mode.',
      'Note: All AI API keys are AES-256-GCM encrypted at rest and never returned as plaintext.'
    ],
    prerequisites: ['Company Owner or settings:manage permission'],
    expectedBehavior: 'Immediately aligns TaxEngine and Ledger Agent calculations with updated company VAT/Taxpayer classification.',
    accountingImpact: 'Governs statutory VAT/Percentage/8% calculation rules company-wide.',
    dependencies: ['Philippine Tax & Statutory Engine', 'Enterprise AI Agent Service'],
    keywords: ['settings', 'company profile', 'vat status', 'taxpayer classification', 'rdo', 'tin', 'ai settings', 'api key', 'failover'],
    commonErrorsAndResolutions: [
      { error: 'Tax computations still using VAT on Non-VAT company', resolution: 'Verify VAT Status in Settings is saved as NON_VAT or 8_PERCENT_FLAT, not VAT.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },

  // =========================================================================
  // ADDITIONAL SYSTEM KNOWLEDGE: REPORTS, WORKFLOWS, RBAC/OWNER, TAX, CLEAN START
  // =========================================================================
  {
    moduleId: 'reports',
    moduleName: '12. Reports & Analytics',
    submoduleId: 'rep-data-sources',
    submoduleName: 'Dashboard & Financial Report Data Collection Architecture',
    category: 'REPORT_ANALYTICS',
    purpose: 'Explains the single source of truth tying Company COA -> Central Account Mapping Engine -> Operational Registers -> Subledgers -> General Ledger -> Trial Balance -> Balance Sheet, Income Statement, Cash Flow, AR/AP Aging, and Executive Dashboard KPIs.',
    navigationPath: '/reports',
    requiredPermissions: ['reports:view', 'dashboard:view'],
    userInstructions: [
      'All Dashboard KPIs and Financial Reports query ONLY the active isolated company SQLite database.',
      'Balance Sheet & Income Statement aggregate POSTED rows from journal_entries + journal_lines joined to accounts.',
      'AR & AP Aging read open balance_due on non-void/non-draft sales_invoices and purchase_bills using PHT (GMT+8) cutoff.',
      'Trial Balance enforces Sum(Debit) === Sum(Credit) across all posted GL entries.'
    ],
    prerequisites: ['Posted financial transactions in active company database'],
    expectedBehavior: 'Zero discrepancy between GL Trial Balance, Income Statement, Balance Sheet, Dashboard KPIs, and Subledger Aging.',
    accountingImpact: 'Authoritative single source of truth; DRAFT or VOID transactions are excluded from posted financial statements.',
    dependencies: ['Chart of Accounts', 'Central Account Mapping Engine', 'General Ledger'],
    keywords: ['data source', 'source of truth', 'how reports work', 'balance sheet formula', 'income statement source', 'cash flow source', 'dashboard data'],
    commonErrorsAndResolutions: [
      { error: 'Posted invoice visible in list but not Income Statement', resolution: 'Verify the invoice status transitioned from DRAFT/SUBMITTED to POSTED.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'master-data',
    moduleName: '16. Master Data & Administration',
    submoduleId: 'sec-owner-authority',
    submoduleName: 'Company Owner Full Company-Level Access & RBAC Governance',
    category: 'SECURITY_RBAC',
    purpose: 'Defines canonical RBAC architecture across all 9 system roles (Company Owner, Company Administrator, Accountant, Bookkeeper, Reviewer, Approver, Auditor, Tax & AP Specialist, Read-only User) and enforces Company Owner unrestricted company-level authority.',
    navigationPath: '/master-data/rbac',
    requiredPermissions: ['roles:manage'],
    userInstructions: [
      'Active Company Owner permanently has full access to all 16 ERP modules, all 36 submodules, wildcard (*) + all canonical permissions, COMPANY_WIDE data scope, and unlimited (-1) approval authority.',
      'Company Owner access is immune to employee permission checkboxes, user_module_assignments restrictions, and user_permission_overrides DENY rows.',
      'Company Owner authority NEVER bypasses: valid session auth, cross-company tenant isolation, RECOVERY_READ_ONLY database quarantine, immutable audit trail logging, or Maker-Checker Self-Approval Segregation of Duties (unless explicitly configured).'
    ],
    prerequisites: ['Active user account holding Company Owner role in the active company'],
    expectedBehavior: 'Owner immediately sees and accesses every workspace route, API, AI inquiry, approval queue, and export within their company.',
    accountingImpact: 'Balances complete operational sovereignty for the business owner with immutable auditability and tenant isolation.',
    dependencies: ['RbacService', 'AuthMiddleware', 'ModuleRegistry', 'AuditService'],
    keywords: ['company owner', 'owner access', 'full access', 'unrestricted', 'rbac policy', '9 roles', 'tax & ap specialist', 'tax and ap specialist', 'transfer ownership'],
    commonErrorsAndResolutions: [
      { error: 'Trying to restrict Company Owner via checkbox fails', resolution: 'By enterprise policy (OWNER_UNRESTRICTED_POLICY), Company Owners are always unrestricted; transfer ownership or change role for limited users.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'tax',
    moduleName: '9. Tax & BIR Compliance',
    submoduleId: 'tax-statutory-guide',
    submoduleName: 'Philippine Tax Laws (EOPT RA 11976, CREATE RA 11534, TRAIN RA 10963)',
    category: 'BIR_COMPLIANCE',
    purpose: 'Reference guide for Philippine statutory rules enforced by TaxEngine: 12% VAT vs Zero-Rated vs Exempt, 3% Sec. 116 Percentage Tax (with 1% CREATE historical window Jul 2020–Jun 2023), 8% Optional Flat Income Tax (₱250k pure self-employed deduction, ₱3M threshold), TRAIN Graduated Tax, 2026 SSS 61-Bracket / PhilHealth 5% / Pag-IBIG, and EOPT Invoice Mandate.',
    navigationPath: '/tax/bir-compliance',
    requiredPermissions: ['tax:view'],
    userInstructions: [
      'VAT Registered Companies file BIR Form 2550Q (Quarterly, due 25 days after quarter close) plus optional 2550M if elected.',
      'Non-VAT Companies (≤ ₱3,000,000 gross receipts not electing 8% flat rate) file BIR Form 2551Q (Quarterly Percentage Tax at 3% Sec. 116).',
      'Qualified Self-Employed Individuals opting for 8% Flat Income Tax pay 8% on gross receipts exceeding ₱250,000 (pure business) or full gross receipts (mixed-income), in lieu of graduated income tax and percentage tax.',
      'Withholding agents file BIR Form 1601-EQ (Quarterly EWT) with QAP/2307 and Form 1601-C (Compensation Withholding).'
    ],
    prerequisites: ['Company Tax Profile properly configured'],
    expectedBehavior: 'TaxEngine and Ledger Agent adapt automatically to the active company tax regime and query actual persisted tax records.',
    accountingImpact: 'Guarantees company-accurate VAT, Percentage Tax, EWT, and Income Tax figures.',
    dependencies: ['TaxEngine', 'EnterpriseAiAgentService', 'Statutory Tax Codes & ATC Rates'],
    keywords: ['philippine tax', 'eopt', 'create act', 'train law', '8% income tax', 'percentage tax', 'vat threshold', '3000000', 'section 116', 'filing deadline'],
    commonErrorsAndResolutions: [
      { error: 'VAT threshold exceeded on Non-VAT company', resolution: 'Monitor cumulative gross sales; crossing ₱3,000,000 triggers mandatory VAT registration.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'master-data',
    moduleName: '16. Master Data & Administration',
    submoduleId: 'sys-clean-start',
    submoduleName: 'Zero-Data Clean Start & Database Initialization Architecture',
    category: 'WORKFLOW',
    purpose: 'Explains how LedgerAI PH guarantees a clean, zero-data installation and clean starter package: zero pre-created company DBs, zero fake transactions or sample partners, genuine empty-state dashboards, and non-destructive onboarding.',
    navigationPath: '/launcher',
    requiredPermissions: ['dashboard:view'],
    userInstructions: [
      'On a fresh clean installation, the Launcher opens with zero companies and zero sample records.',
      'Click "Create Company Profile" (/profile/create) to initialize an empty, company-owned SQLite workspace containing only structural schema, BIR system ATC definitions, and the creator as Company Owner.',
      'Optionally download a Clean Starter Database package (.sqlite/.laisbak) free of any foreign company profile or business history.'
    ],
    prerequisites: ['Fresh installation or Create Profile flow'],
    expectedBehavior: 'Zero mock customers, vendors, employees, invoices, bills, cash balances, or journal entries exist before user entry.',
    accountingImpact: 'Prevents polluted opening balances or demo data from contaminating real BIR books.',
    dependencies: ['Launcher', 'CompanyManager', 'Database Vault'],
    keywords: ['clean start', 'zero data', 'empty database', 'fresh install', 'new company', 'sample data', 'starter database'],
    commonErrorsAndResolutions: [
      { error: 'Demo company seen unexpectedly', resolution: 'Only explicitly triggered stress-test scripts seed preview workspaces; production clean start creates zero companies.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'accounting',
    moduleName: '6. Accounting & General Ledger',
    submoduleId: 'sys-opening-balance-cutover',
    submoduleName: 'Opening Balance Cutover, Historical Migration & Trial Balance Validation',
    category: 'WORKFLOW',
    purpose: 'Explains how to record verified opening balances across Cash/Bank, AR, AP, Inventory, Fixed Assets, Accumulated Depreciation, Liabilities, and Equity with supporting schedules, strict Trial Balance equality (Debit = Credit), duplicate-import blocking, and zero silent balancing plugs.',
    navigationPath: '/accounting/coa',
    requiredPermissions: ['accounting:edit', 'coa:manage'],
    userInstructions: [
      'For a zero-balance fresh company start, keep all Chart of Accounts opening balances at ₱0.00.',
      'For an existing company migrating historical balances, prepare the audited prior-period Trial Balance and supporting subledger schedules (AR, AP, Inventory, Fixed Assets, Bank Statements).',
      'Record opening balances per Balance Sheet account in Chart of Accounts (/accounting/coa) or submit a multi-line Opening Balance Cutover Batch (POST /api/master-data/opening-balances/batch) specifying effectiveDate, batchReference, sourceSystem, and supportingScheduleRef.',
      'Verify via Opening Balance Validation (GET /api/master-data/opening-balances/validation) and Trial Balance (/reports/trial-balance) that Total Opening Debits equal Total Opening Credits with ₱0.00 discrepancy.'
    ],
    prerequisites: ['Active open accounting period covering the effective opening date', 'Audited prior-year Trial Balance or supporting schedule reference'],
    expectedBehavior: 'Rejects Income Statement accounts (Revenue/Expense), blocks duplicate opening balance batches (409), prohibits unbalanced cutover batches without silent plugs, and posts immutable OPENING_BALANCE journals.',
    accountingImpact: 'Establishes the verified beginning General Ledger and Balance Sheet baseline reconciled to subledgers.',
    dependencies: ['OpeningBalanceService', 'Chart of Accounts', 'General Journal & Ledger', 'Trial Balance'],
    keywords: ['opening balance', 'beginning balance', 'cutover', 'historical data', 'migration', 'opening trial balance', 'schedule reference'],
    commonErrorsAndResolutions: [
      { error: 'UNBALANCED_OPENING_BALANCE_BATCH (400)', resolution: 'Ensure total opening Debit lines equal total opening Credit lines across all Balance Sheet accounts; LedgerAI PH never inserts silent plug entries.' },
      { error: 'OPENING_BALANCE_ALREADY_POSTED (409)', resolution: 'Use Opening Balance Adjustment (POST /api/master-data/accounts/:id/opening-balance-adjustment) with an audit reason instead of re-importing.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  },
  {
    moduleId: 'audit',
    moduleName: '15. Audit & Governance',
    submoduleId: 'sys-360-entity-journey',
    submoduleName: '360° Entity Journey & Complete Financial Lifecycle Traceability',
    category: 'WORKFLOW',
    purpose: 'Provides complete end-to-end 360° financial, operational, approval, document, and GL traceability across all 16 registered entity types (CUSTOMER, VENDOR, EMPLOYEE, ACCOUNT, SALES_INVOICE, PURCHASE_BILL, PURCHASE_ORDER, PAYMENT, JOURNAL_ENTRY, INVENTORY_ITEM, FIXED_ASSET, PAYROLL_RUN, DOCUMENT, TAX_RETURN, BANK_RECONCILIATION, SYSTEM_OPERATION).',
    navigationPath: '/activity-center',
    requiredPermissions: ['dashboard:view'],
    userInstructions: [
      'Click any "360° Journey" button on a transaction, master record, dashboard drill-down, or audit row.',
      'Inspect the entity master profile, originating documents, approval workflow chain, posted General Ledger journal lines, tax breakdown, and subledger settlement status.',
      'Use lifecycle actions (COPY, ADJUST, REVERSE) where authorized; REVERSE atomically reverses GL, AR/AP, VAT/EWT, Inventory, and COGS effects.'
    ],
    prerequisites: ['Authenticated company session and module view permission'],
    expectedBehavior: 'Displays only real company-scoped database records and reconciles every 360° summary total to the General Ledger and subledgers.',
    accountingImpact: 'Guarantees complete auditability from financial statement line item down to source voucher and approval signature.',
    dependencies: ['Journey Route Engine', 'General Ledger', 'Approval Workflow Engine', 'Audit Trail'],
    keywords: ['360 journey', 'traceability', 'drill down', 'lifecycle', 'reverse transaction', 'copy', 'adjust', 'entity history'],
    commonErrorsAndResolutions: [
      { error: 'SOD_VIOLATION (403) during approval in 360° drawer', resolution: 'The user who created or submitted a workflow cannot approve their own submission; an independent Approver must decide.' }
    ],
    verificationStatus: 'VERIFIED',
    sourceVersion: '1.0.0-rc.2'
  }
];

const SYNONYM_MAP: Record<string, string[]> = {
  paano: ['how', 'create', 'guide'],
  saan: ['where', 'navigation'],
  gawa: ['create', 'invoice', 'bill', 'journal'],
  gawin: ['create', 'run', 'post'],
  resibo: ['receipt', 'ocr', 'documents', 'invoice'],
  benta: ['sales', 'invoice', 'ar', 'billing'],
  singilin: ['receivable', 'ar', 'overdue', 'collections', 'sales', 'invoice'],
  overdue: ['overdue collections', 'due date', 'receivable', 'sales', 'invoice'],
  partial: ['partially paid', 'record collection', 'sales', 'invoice', '2307'],
  archive: ['archive inbox', 'removed', 'soft-archive', 'sales', 'invoice'],
  eopt: ['ra 11976', 'rr 7-2024', 'sales invoice', 'bir', 'vat'],
  utang: ['receivable', 'payable', 'ar', 'ap'],
  gastos: ['bill', 'expense', 'procurement'],
  buwis: ['tax', 'bir', 'vat', '2550q', '2551q', '1601-eq', 'ewt'],
  sweldo: ['payroll', 'salary', 'compensation', '1601-c'],
  sahod: ['payroll', 'salary', 'compensation'],
  bangko: ['bank', 'reconciliation', 'cash'],
  pera: ['cash', 'check', 'deposit'],
  paninda: ['inventory', 'stock', 'sku'],
  owner: ['company owner', 'unrestricted', 'rbac', 'authority'],
  'may-ari': ['company owner', 'unrestricted', 'rbac'],
  permission: ['rbac', 'roles', 'access matrix', 'module'],
  permissions: ['rbac', 'roles', 'access matrix', 'module'],
  report: ['reports', 'balance sheet', 'income statement', 'trial balance'],
  reports: ['reports', 'financial statements', 'balance sheet', 'income statement'],
  clean: ['clean start', 'zero data', 'starter'],
};

export interface ActiveModuleSearchContext {
  activeModuleId?: string | null;
  activeSubmoduleId?: string | null;
  activePath?: string | null;
}

export function searchKnowledgeBase(
  query: string,
  activeContext?: ActiveModuleSearchContext
): KnowledgeRecord[] {
  const q = query.toLowerCase().trim();
  if (!q) {
    if (activeContext?.activeSubmoduleId) {
      const bySub = getKnowledgeRecordBySubmodule(activeContext.activeSubmoduleId);
      if (bySub) return [bySub];
    }
    if (activeContext?.activePath) {
      const byPath = findKnowledgeRecordByPath(activeContext.activePath);
      if (byPath) return [byPath];
    }
    return [];
  }

  const resolvedActiveRecord =
    (activeContext?.activeSubmoduleId
      ? getKnowledgeRecordBySubmodule(activeContext.activeSubmoduleId)
      : undefined) ||
    (activeContext?.activePath ? findKnowledgeRecordByPath(activeContext.activePath) : undefined) ||
    (activeContext?.activeModuleId
      ? getKnowledgeRecordByModule(activeContext.activeModuleId)
      : undefined);

  const cleaned = q
    .replace(/^(how do i|how to|where can i|where is|what is|explain|tell me about|paano|saan|ano ang|workflow for|guide to|manual for|help me|show me how to)\s+/i, '')
    .replace(/^(create|issue|record|make|add|new|open|view|manage|run|generate|use|configure|check|gumawa ng|mag-post ng)\s+(a|an|the|ng|ang)?\s*/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();

  // Direct submodule or module ID match
  const directIdMatch = CANONICAL_KNOWLEDGE_BASE.filter(
    rec =>
      rec.submoduleId.toLowerCase() === q ||
      rec.moduleId.toLowerCase() === q ||
      rec.submoduleName.toLowerCase().includes(cleaned || q)
  );
  if (directIdMatch.length > 0 && (cleaned || q).length >= 3) {
    if (resolvedActiveRecord) {
      directIdMatch.sort((a, b) => {
        const aBoost =
          a.submoduleId === resolvedActiveRecord.submoduleId
            ? 2
            : a.moduleId === resolvedActiveRecord.moduleId
            ? 1
            : 0;
        const bBoost =
          b.submoduleId === resolvedActiveRecord.submoduleId
            ? 2
            : b.moduleId === resolvedActiveRecord.moduleId
            ? 1
            : 0;
        return bBoost - aBoost;
      });
    }
    return directIdMatch;
  }

  // Tokenized weighted scoring across all fields + Taglish synonyms
  const rawTokens = `${q} ${cleaned}`
    .split(/[^a-z0-9\-&]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !['the', 'and', 'for', 'with', 'how', 'where', 'what', 'can', 'does', 'ang', 'mga', 'sa'].includes(t));

  const expandedTokens = new Set<string>(rawTokens);
  for (const t of rawTokens) {
    if (SYNONYM_MAP[t]) {
      for (const syn of SYNONYM_MAP[t]) expandedTokens.add(syn);
    }
  }

  const scored = CANONICAL_KNOWLEDGE_BASE.map(rec => {
    let score = 0;
    const modName = rec.moduleName.toLowerCase();
    const subName = rec.submoduleName.toLowerCase();
    const purpose = rec.purpose.toLowerCase();
    const navPath = rec.navigationPath.toLowerCase();
    const kws = (rec.keywords || []).map(k => k.toLowerCase());
    const steps = rec.userInstructions.join(' ').toLowerCase();
    const impact = rec.accountingImpact.toLowerCase();

    if (cleaned && subName.includes(cleaned)) score += 40;
    if (cleaned && modName.includes(cleaned)) score += 30;
    if (cleaned && kws.some(k => k === cleaned || k.includes(cleaned))) score += 35;

    for (const tok of expandedTokens) {
      if (subName.includes(tok)) score += 12;
      if (modName.includes(tok)) score += 8;
      if (kws.some(k => k.includes(tok))) score += 14;
      if (purpose.includes(tok)) score += 6;
      if (navPath.includes(tok)) score += 5;
      if (impact.includes(tok)) score += 4;
      if (steps.includes(tok)) score += 3;
    }

    // Prioritize domain-specific knowledge relevant to the active screen when the record has a match or query is contextual
    const isGenericModuleInquiry =
      /\b(workflow|steps|instructions|permissions|prerequisites|module|screen|page|purpose|accounting impact|behavior|errors|issues)\b/i.test(
        q
      );
    if (resolvedActiveRecord && (score > 0 || isGenericModuleInquiry)) {
      if (rec.submoduleId === resolvedActiveRecord.submoduleId) {
        score += isGenericModuleInquiry ? 82 : 36;
      } else if (rec.moduleId === resolvedActiveRecord.moduleId) {
        score += isGenericModuleInquiry ? 36 : 18;
      }
    }

    return { rec, score };
  })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0 && resolvedActiveRecord) {
    return [resolvedActiveRecord];
  }

  return scored.map(x => x.rec);
}

export function getKnowledgeRecordByModule(moduleId: string): KnowledgeRecord | undefined {
  return CANONICAL_KNOWLEDGE_BASE.find(rec => rec.moduleId === moduleId);
}

export function getKnowledgeRecordsByModule(moduleId: string): KnowledgeRecord[] {
  return CANONICAL_KNOWLEDGE_BASE.filter(rec => rec.moduleId === moduleId);
}

export function buildActiveModuleSystemPromptContext(
  record?: KnowledgeRecord | null,
  activePath?: string | null
): string {
  const resolved = record || findKnowledgeRecordByPath(activePath);
  if (!resolved) {
    return 'Active Screen Context: General Workspace (/launcher)';
  }
  const siblings = getKnowledgeRecordsByModule(resolved.moduleId).filter(
    r => r.submoduleId !== resolved.submoduleId
  );
  const siblingSummary =
    siblings.length > 0
      ? `\nRelated Sub-Modules in ${resolved.moduleName}: ${siblings
          .map(s => `${s.submoduleName} (${s.navigationPath})`)
          .join(', ')}`
      : '';

  return [
    `[ACTIVE_APPLICATION_MODULE_CONTEXT]`,
    `Active Route Path: ${activePath || resolved.navigationPath}`,
    `Primary ERP Module: ${resolved.moduleName} (moduleId: ${resolved.moduleId})`,
    `Active Sub-Module: ${resolved.submoduleName} (submoduleId: ${resolved.submoduleId}, path: ${resolved.navigationPath})`,
    `Module Purpose & BIR Scope: ${resolved.purpose}`,
    `General Ledger & Accounting Impact: ${resolved.accountingImpact}`,
    `Expected System Behavior: ${resolved.expectedBehavior}`,
    `Required RBAC Permissions: ${resolved.requiredPermissions.join(', ')}`,
    `Key Operational Steps:\n${resolved.userInstructions.map((s, idx) => `  ${idx + 1}. ${s}`).join('\n')}${siblingSummary}`,
    `[/ACTIVE_APPLICATION_MODULE_CONTEXT]`,
  ].join('\n');
}

export function findKnowledgeRecordByPath(activePath?: string | null): KnowledgeRecord | undefined {
  if (!activePath || typeof activePath !== 'string') return undefined;
  const raw = activePath.trim().replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const clean = pathPart.replace(/\/+$/, '') || '/';
  const lowerQuery = (queryPart || '').toLowerCase();

  if (lowerQuery.includes('workspace=approvals') || clean === '/approvals') {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'appr-inbox');
  }
  if (lowerQuery.includes('workspace=stream') || clean === '/activity-center') {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'act-stream');
  }

  // 1. Exact navigationPath match
  const exact = CANONICAL_KNOWLEDGE_BASE.find(
    rec => (rec.navigationPath.split('?')[0].replace(/\/+$/, '') || '/') === clean
  );
  if (exact) return exact;

  // 2. Prefix match (longest matching navigationPath wins, excluding root '/')
  const prefixMatches = CANONICAL_KNOWLEDGE_BASE.filter(rec => {
    const recPath = rec.navigationPath.split('?')[0].replace(/\/+$/, '');
    return recPath.length > 1 && (clean.startsWith(recPath + '/') || recPath.startsWith(clean + '/'));
  }).sort((a, b) => b.navigationPath.length - a.navigationPath.length);
  if (prefixMatches.length > 0) return prefixMatches[0];

  // 3. Heuristic segment match for route aliases
  const lowerClean = clean.toLowerCase();
  if (lowerClean.includes('approval')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'appr-inbox');
  }
  if (lowerClean.includes('activity-center') || lowerClean.includes('activity')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'act-stream');
  }
  if (lowerClean.includes('audit/engagements')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'aud-engagements');
  }
  if (lowerClean.includes('audit/workpapers')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'aud-workpapers');
  }
  if (lowerClean.includes('audit/fraud') || lowerClean.includes('forensic')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'aud-forensic');
  }
  if (lowerClean.includes('audit/integrity')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'aud-integrity');
  }
  if (lowerClean.includes('audit/archive-vault') || lowerClean.includes('archive')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'aud-archive-vault');
  }
  if (lowerClean.includes('audit')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'aud-trail');
  }
  if (lowerClean.includes('sales-invoic')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'sales-invoices');
  }
  if (lowerClean.includes('purchase-bill') || lowerClean.includes('payables')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'proc-bills');
  }
  if (lowerClean.includes('procurement') || lowerClean.includes('purchase-order')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'proc-matching');
  }
  if (lowerClean.includes('journal')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'acct-journals');
  }
  if (lowerClean.includes('account') && !lowerClean.includes('accounting/')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'acct-coa');
  }
  if (lowerClean.includes('trial-balance')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'acct-tb');
  }
  if (lowerClean.includes('period')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'acct-periods');
  }
  if (lowerClean.includes('forex')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'acct-forex');
  }
  if (lowerClean.includes('2307')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'tax-2307');
  }
  if (lowerClean.includes('tax') || lowerClean.includes('bir')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'tax-engine');
  }
  if (lowerClean.includes('bank-recon')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'bank-recon');
  }
  if (lowerClean.includes('cash')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'cash-mgmt');
  }
  if (lowerClean.includes('inventory')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'inv-movements');
  }
  if (lowerClean.includes('payroll')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'pay-records');
  }
  if (lowerClean.includes('fixed-asset')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'fa-register');
  }
  if (lowerClean.includes('customer')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'md-customers');
  }
  if (lowerClean.includes('vendor') || lowerClean.includes('supplier')) {
    return CANONICAL_KNOWLEDGE_BASE.find(r => r.submoduleId === 'md-vendors');
  }

  return CANONICAL_KNOWLEDGE_BASE.find(r => r.navigationPath === '/');
}

export function getKnowledgeRecordBySubmodule(submoduleId: string): KnowledgeRecord | undefined {
  return CANONICAL_KNOWLEDGE_BASE.find(rec => rec.submoduleId === submoduleId);
}

