/**
 * LEDGERAI PH — AUTHORITATIVE ENTITY-SPECIFIC 360° EXPERIENCE REGISTRY
 * Requirement IDs:
 * - REQ-360-ARCH-001: Centralized Entity 360 Registry
 * - REQ-360-ARCH-002: 12 Specialized Presentation Categories
 * - REQ-360-ARCH-003: Purpose-Built Tabs, Lifecycle Bars & Domain Metrics per Entity
 */

export type Specialized360PresentationType =
  | 'FINANCIAL_TRANSACTION_360'
  | 'CUSTOMER_RELATIONSHIP_360'
  | 'VENDOR_RELATIONSHIP_360'
  | 'INVENTORY_OPERATIONS_360'
  | 'PAYROLL_360'
  | 'TAX_COMPLIANCE_360'
  | 'BANKING_RECONCILIATION_360'
  | 'FIXED_ASSET_360'
  | 'DOCUMENT_INTELLIGENCE_360'
  | 'APPROVAL_WORKFLOW_360'
  | 'AUDIT_ENGAGEMENT_360'
  | 'SYSTEM_OPERATIONS_360';

export type Specialized360RendererId =
  | 'FinancialTransaction360View'
  | 'CustomerRelationship360View'
  | 'VendorRelationship360View'
  | 'InventoryOperations360View'
  | 'Payroll360View'
  | 'TaxCompliance360View'
  | 'BankingReconciliation360View'
  | 'FixedAsset360View'
  | 'DocumentIntelligence360View'
  | 'ApprovalWorkflow360View'
  | 'AuditEngagement360View'
  | 'SystemOperations360View';

export type EntityHeaderBannerMode =
  | 'ACCOUNTING_WORKFLOW_STEPPER'
  | 'MASTER_RELATIONSHIP_BANNER'
  | 'INVENTORY_VALUATION_BANNER'
  | 'PAYROLL_COMPENSATION_BANNER'
  | 'STATUTORY_TAX_BANNER'
  | 'BANK_RECONCILIATION_BANNER'
  | 'ASSET_DEPRECIATION_BANNER'
  | 'DOCUMENT_VAULT_BANNER'
  | 'APPROVAL_ORCHESTRATION_BANNER'
  | 'AUDIT_ENGAGEMENT_BANNER'
  | 'SYSTEM_JOB_BANNER';

export type Entity360TabId =
  | 'overview'
  | 'details'
  | 'activity'
  | 'approvals'
  | 'changes'
  | 'related'
  | 'documents'
  | 'audit';

export interface Entity360TabConfig {
  id: Entity360TabId;
  label: string;
  badgeKey?: 'activity' | 'approvals' | 'changes' | 'related' | 'documents';
}

export interface Entity360SummaryMetricSpec {
  key: string;
  label: string;
  format: 'currency' | 'number' | 'percentage' | 'text' | 'date' | 'status';
  description: string;
}

export interface Entity360Definition {
  requirementId: string;
  entityType: string;
  aliases: string[];
  displayName: string;
  moduleId: string;
  moduleLabel: string;
  submoduleId: string;
  submoduleLabel: string;
  presentationType: Specialized360PresentationType;
  rendererComponent: Specialized360RendererId;
  headerConfig: {
    workspaceBadge: string;
    accentColor: 'indigo' | 'emerald' | 'amber' | 'sky' | 'violet' | 'rose' | 'slate' | 'teal';
    bannerMode: EntityHeaderBannerMode;
    primaryRefLabel: string;
    showsAccountingWorkflowStepper: boolean;
  };
  summaryMetrics: Entity360SummaryMetricSpec[];
  mainInformationSections: string[];
  applicableTabs: Entity360TabConfig[];
  applicableHistorySections: string[];
  relatedRecordRelationships: string[];
  availableActions: string[];
  backendDataRequirements: string[];
  permissionRequirements: {
    moduleId: string;
    viewPermissions: string[];
    sensitiveDataPermissions?: string[];
  };
  emptyAndErrorStates: {
    emptyPrimaryTitle: string;
    emptyPrimaryMessage: string;
    emptyRelatedMessage: string;
    errorFallbackMessage: string;
  };
}

export const ENTITY_360_REGISTRY: Record<string, Entity360Definition> = {
  // ============================================================================
  // A. FINANCIAL TRANSACTION 360
  // ============================================================================
  SALES_INVOICE: {
    requirementId: 'REQ-360-FIN-001',
    entityType: 'SALES_INVOICE',
    aliases: ['SALES_INVOICE', 'SALES_INVOICES', 'INVOICE'],
    displayName: 'Sales Invoice & AR Billing',
    moduleId: 'sales',
    moduleLabel: '2. Sales & Receivables',
    submoduleId: 'sales-invoices',
    submoduleLabel: 'Sales Invoices & Billing',
    presentationType: 'FINANCIAL_TRANSACTION_360',
    rendererComponent: 'FinancialTransaction360View',
    headerConfig: {
      workspaceBadge: 'FINANCIAL TRANSACTION 360° • AR BILLING',
      accentColor: 'indigo',
      bannerMode: 'ACCOUNTING_WORKFLOW_STEPPER',
      primaryRefLabel: 'Invoice No.',
      showsAccountingWorkflowStepper: true,
    },
    summaryMetrics: [
      { key: 'totalAmount', label: 'Gross Invoice Total', format: 'currency', description: 'Total billed amount in PHP' },
      { key: 'balanceDue', label: 'Outstanding AR Balance', format: 'currency', description: 'Uncollected receivable balance' },
      { key: 'outputVatAmount', label: '12% Output VAT', format: 'currency', description: 'Extracted or persisted Output VAT' },
      { key: 'settledAmount', label: 'Collected / Credited', format: 'currency', description: 'Total applied OR collections & credit memos' },
    ],
    mainInformationSections: [
      'Counterparty & Billing Terms',
      'VAT & Withholding Tax Breakdown',
      'Invoice Line Items & Revenue Accounts',
      'Payment Allocation & Settlement Status',
      'GL Journal Posting & Reversal Lineage',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Financial 360°' },
      { id: 'details', label: '2. Line Items & GL Impact' },
      { id: 'related', label: '3. Collections & Lineage', badgeKey: 'related' },
      { id: 'documents', label: '4. Source Documents', badgeKey: 'documents' },
      { id: 'approvals', label: '5. Approvals & SoD', badgeKey: 'approvals' },
      { id: 'activity', label: '6. Activity & Audit', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Workflow Approvals', 'Posting & Reversal History', 'Collection Application History'],
    relatedRecordRelationships: ['CUSTOMER_MASTER', 'OFFICIAL_RECEIPT_COLLECTION', 'CREDIT_MEMO_ADJUSTMENT', 'GL_JOURNAL_POSTING', 'TAX_LEDGER_ENTRY'],
    availableActions: ['EDIT', 'SUBMIT', 'REVIEW', 'APPROVE', 'REJECT', 'RETURN', 'POST', 'REVERSE', 'CANCEL', 'COPY'],
    backendDataRequirements: ['sales_invoices', 'sales_invoice_lines', 'customers', 'customer_payment_applications', 'credit_memo_applications', 'journal_entries', 'tax_calculations'],
    permissionRequirements: {
      moduleId: 'sales',
      viewPermissions: ['sales:view', 'sales:read', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Sales Invoice Not Found',
      emptyPrimaryMessage: 'The requested Sales Invoice does not exist in the active company.',
      emptyRelatedMessage: 'No Official Receipt collections or Credit Memos have been applied to this invoice yet.',
      errorFallbackMessage: 'Unable to load Sales Invoice 360° telemetry.',
    },
  },

  PURCHASE_BILL: {
    requirementId: 'REQ-360-FIN-002',
    entityType: 'PURCHASE_BILL',
    aliases: ['PURCHASE_BILL', 'PURCHASE_BILLS', 'BILL'],
    displayName: 'Supplier Purchase Bill (AP)',
    moduleId: 'procurement',
    moduleLabel: '3. Procurement & Payables',
    submoduleId: 'proc-bills',
    submoduleLabel: 'Purchase Bills & Accounts Payable',
    presentationType: 'FINANCIAL_TRANSACTION_360',
    rendererComponent: 'FinancialTransaction360View',
    headerConfig: {
      workspaceBadge: 'FINANCIAL TRANSACTION 360° • AP VOUCHER',
      accentColor: 'indigo',
      bannerMode: 'ACCOUNTING_WORKFLOW_STEPPER',
      primaryRefLabel: 'Bill No.',
      showsAccountingWorkflowStepper: true,
    },
    summaryMetrics: [
      { key: 'totalAmount', label: 'Gross Bill Amount', format: 'currency', description: 'Total supplier bill payable' },
      { key: 'balanceDue', label: 'Remaining AP Balance', format: 'currency', description: 'Unpaid supplier balance' },
      { key: 'inputVatAmount', label: '12% Input VAT', format: 'currency', description: 'Creditable Input VAT' },
      { key: 'ewtAmount', label: 'Expanded Withholding (2307)', format: 'currency', description: 'Withheld EWT on supplier disbursements' },
    ],
    mainInformationSections: [
      'Supplier Profile & AP Terms',
      'Input VAT & BIR Form 2307 EWT Breakdown',
      'Bill Line Items & Expense/Inventory Coding',
      'Disbursement Allocation & 3-Way Match',
      'GL Posting & Reversal Lineage',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Payable 360°' },
      { id: 'details', label: '2. Expense Lines & Tax' },
      { id: 'related', label: '3. Disbursements & PO Match', badgeKey: 'related' },
      { id: 'documents', label: '4. Supplier Invoices', badgeKey: 'documents' },
      { id: 'approvals', label: '5. Approvals & SoD', badgeKey: 'approvals' },
      { id: 'activity', label: '6. Activity & Audit', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Approval Steps', 'Disbursement Applications', 'Field Modifications'],
    relatedRecordRelationships: ['VENDOR_MASTER', 'SUPPLIER_DISBURSEMENT', 'DEBIT_MEMO_ADJUSTMENT', 'GL_JOURNAL_POSTING', 'TAX_LEDGER_ENTRY'],
    availableActions: ['EDIT', 'SUBMIT', 'REVIEW', 'APPROVE', 'REJECT', 'RETURN', 'POST', 'REVERSE', 'CANCEL', 'COPY'],
    backendDataRequirements: ['purchase_bills', 'purchase_bill_lines', 'vendors', 'supplier_payment_applications', 'debit_memo_applications', 'journal_entries'],
    permissionRequirements: {
      moduleId: 'procurement',
      viewPermissions: ['purchases:view', 'purchases:read', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Purchase Bill Not Found',
      emptyPrimaryMessage: 'The requested Purchase Bill does not exist in the active company.',
      emptyRelatedMessage: 'No supplier disbursements or debit memos have been applied to this bill yet.',
      errorFallbackMessage: 'Unable to load Purchase Bill 360° telemetry.',
    },
  },

  PURCHASE_ORDER: {
    requirementId: 'REQ-360-FIN-003',
    entityType: 'PURCHASE_ORDER',
    aliases: ['PURCHASE_ORDER', 'PURCHASE_ORDERS', 'PO'],
    displayName: 'Purchase Order (Procurement)',
    moduleId: 'procurement',
    moduleLabel: '3. Procurement & Payables',
    submoduleId: 'proc-matching',
    submoduleLabel: 'Procurement & 3-Way Match',
    presentationType: 'FINANCIAL_TRANSACTION_360',
    rendererComponent: 'FinancialTransaction360View',
    headerConfig: {
      workspaceBadge: 'PROCUREMENT 360° • PURCHASE ORDER & 3-WAY MATCH',
      accentColor: 'indigo',
      bannerMode: 'ACCOUNTING_WORKFLOW_STEPPER',
      primaryRefLabel: 'PO Number',
      showsAccountingWorkflowStepper: true,
    },
    summaryMetrics: [
      { key: 'totalAmount', label: 'Total PO Commitment', format: 'currency', description: 'Authorized purchase order value' },
      { key: 'orderedQty', label: 'Total Ordered Qty', format: 'number', description: 'Sum of ordered line quantities' },
      { key: 'receivedQty', label: 'Total Received Qty (GRN)', format: 'number', description: 'Fulfilled quantity across Goods Receipt Notes' },
      { key: 'fulfillmentPct', label: '3-Way Match Fulfillment', format: 'percentage', description: 'Percentage of PO lines received' },
    ],
    mainInformationSections: [
      'Supplier & Delivery Schedule',
      'PO Line Items & Receiving Progress',
      'Goods Receipt Notes (GRN) & 3-Way Match Status',
      'Approval Authorization & Budget Check',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. PO & 3-Way Match 360°' },
      { id: 'details', label: '2. Ordered vs Received Lines' },
      { id: 'related', label: '3. Linked GRNs & Bills', badgeKey: 'related' },
      { id: 'documents', label: '4. Quotations & Docs', badgeKey: 'documents' },
      { id: 'approvals', label: '5. PO Approvals', badgeKey: 'approvals' },
      { id: 'activity', label: '6. Activity Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['PO Approval Chain', 'Goods Receipt Events'],
    relatedRecordRelationships: ['VENDOR_MASTER', 'GOODS_RECEIPT_NOTE', 'PURCHASE_BILL'],
    availableActions: ['EDIT', 'SUBMIT', 'APPROVE', 'REJECT', 'CANCEL', 'COPY'],
    backendDataRequirements: ['purchase_orders', 'purchase_order_lines', 'goods_receipt_notes', 'vendors'],
    permissionRequirements: {
      moduleId: 'procurement',
      viewPermissions: ['purchases:view', 'purchases:read', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Purchase Order Not Found',
      emptyPrimaryMessage: 'The requested Purchase Order could not be found.',
      emptyRelatedMessage: 'No Goods Receipt Notes (GRNs) or Supplier Bills have been matched to this PO yet.',
      errorFallbackMessage: 'Unable to load Purchase Order 360° data.',
    },
  },

  GOODS_RECEIPT_NOTE: {
    requirementId: 'REQ-360-FIN-004',
    entityType: 'GOODS_RECEIPT_NOTE',
    aliases: ['GOODS_RECEIPT_NOTE', 'GOODS_RECEIPT_NOTES', 'GRN'],
    displayName: 'Goods Receipt Note (GRN)',
    moduleId: 'procurement',
    moduleLabel: '3. Procurement & Payables',
    submoduleId: 'proc-matching',
    submoduleLabel: 'Procurement & 3-Way Match',
    presentationType: 'FINANCIAL_TRANSACTION_360',
    rendererComponent: 'FinancialTransaction360View',
    headerConfig: {
      workspaceBadge: 'RECEIVING 360° • GOODS RECEIPT NOTE',
      accentColor: 'teal',
      bannerMode: 'INVENTORY_VALUATION_BANNER',
      primaryRefLabel: 'GRN No.',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'totalReceivedQty', label: 'Quantity Received', format: 'number', description: 'Total units received into warehouse' },
      { key: 'poReference', label: 'Source Purchase Order', format: 'text', description: 'Originating PO reference' },
      { key: 'deliveryNoteNo', label: 'Supplier Delivery Note', format: 'text', description: 'Vendor DR / Packing Slip number' },
    ],
    mainInformationSections: [
      'Receiving Details & Delivery Note',
      'Received Line Items vs PO Quantities',
      'Warehouse Stock Movement Impact',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Receiving 360°' },
      { id: 'details', label: '2. Received Line Items' },
      { id: 'related', label: '3. Source PO & Stock Ledger', badgeKey: 'related' },
      { id: 'documents', label: '4. Delivery Receipts', badgeKey: 'documents' },
      { id: 'activity', label: '5. Receiving Audit Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Receiving Verification Log'],
    relatedRecordRelationships: ['PURCHASE_ORDER', 'VENDOR_MASTER', 'INVENTORY_ITEM'],
    availableActions: ['EDIT', 'CANCEL'],
    backendDataRequirements: ['goods_receipt_notes', 'goods_receipt_lines', 'purchase_orders', 'purchase_order_lines'],
    permissionRequirements: {
      moduleId: 'procurement',
      viewPermissions: ['purchases:view', 'inventory:view', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Goods Receipt Note Not Found',
      emptyPrimaryMessage: 'The requested GRN does not exist in the active company.',
      emptyRelatedMessage: 'No linked PO or stock movement records found.',
      errorFallbackMessage: 'Unable to load Goods Receipt Note 360° view.',
    },
  },

  JOURNAL_ENTRY: {
    requirementId: 'REQ-360-FIN-005',
    entityType: 'JOURNAL_ENTRY',
    aliases: ['JOURNAL_ENTRY', 'JOURNAL_ENTRIES', 'JOURNAL'],
    displayName: 'General Ledger Journal Entry',
    moduleId: 'accounting',
    moduleLabel: '6. Accounting & General Ledger',
    submoduleId: 'acct-journals',
    submoduleLabel: 'General Journal & Ledger',
    presentationType: 'FINANCIAL_TRANSACTION_360',
    rendererComponent: 'FinancialTransaction360View',
    headerConfig: {
      workspaceBadge: 'GENERAL LEDGER 360° • DOUBLE-ENTRY JOURNAL',
      accentColor: 'indigo',
      bannerMode: 'ACCOUNTING_WORKFLOW_STEPPER',
      primaryRefLabel: 'Journal No.',
      showsAccountingWorkflowStepper: true,
    },
    summaryMetrics: [
      { key: 'totalDebit', label: 'Total Debits (PHP)', format: 'currency', description: 'Sum of debit journal lines' },
      { key: 'totalCredit', label: 'Total Credits (PHP)', format: 'currency', description: 'Sum of credit journal lines' },
      { key: 'balanceVariance', label: 'Double-Entry Variance', format: 'currency', description: 'Must equal ₱0.00 (Balanced)' },
      { key: 'lineCount', label: 'Journal Lines', format: 'number', description: 'Number of GL account postings' },
    ],
    mainInformationSections: [
      'Journal Header & Source Subledger Origin',
      'Balanced Double-Entry Debit/Credit Schedule',
      'Dimensional Cost Center / Department Tagging',
      'Reversal & Prior-Period Adjustment Lineage',
      'Tax Calculation Consequences',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Journal & GL 360°' },
      { id: 'details', label: '2. Debit / Credit Lines' },
      { id: 'related', label: '3. Subledger Origin & Reversals', badgeKey: 'related' },
      { id: 'documents', label: '4. Supporting Vouchers', badgeKey: 'documents' },
      { id: 'approvals', label: '5. Approvals & SoD', badgeKey: 'approvals' },
      { id: 'activity', label: '6. Cryptographic Audit', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Journal Approval & Posting', 'Reversal Chain', 'Field Diffs'],
    relatedRecordRelationships: ['SOURCE_SALES_INVOICE', 'SOURCE_PURCHASE_BILL', 'SOURCE_COLLECTION', 'SOURCE_DISBURSEMENT', 'REVERSAL_JOURNAL', 'ORIGINAL_TRANSACTION', 'TAX_LEDGER_ENTRY'],
    availableActions: ['EDIT', 'SUBMIT', 'REVIEW', 'APPROVE', 'REJECT', 'RETURN', 'POST', 'REVERSE', 'ADJUST', 'CANCEL', 'COPY'],
    backendDataRequirements: ['journal_entries', 'journal_lines', 'accounts', 'tax_calculations'],
    permissionRequirements: {
      moduleId: 'accounting',
      viewPermissions: ['accounting:view', 'journals:read', 'accounts:read'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Journal Entry Not Found',
      emptyPrimaryMessage: 'The requested General Journal Entry was not found in the active company.',
      emptyRelatedMessage: 'This is a direct manual General Journal entry with no external subledger origin.',
      errorFallbackMessage: 'Unable to load General Journal 360° view.',
    },
  },

  CUSTOMER_PAYMENT: {
    requirementId: 'REQ-360-FIN-006',
    entityType: 'CUSTOMER_PAYMENT',
    aliases: ['CUSTOMER_PAYMENT', 'CUSTOMER_PAYMENTS', 'OFFICIAL_RECEIPT'],
    displayName: 'Customer Collection & Official Receipt',
    moduleId: 'sales',
    moduleLabel: '2. Sales & Receivables',
    submoduleId: 'sales-invoices',
    submoduleLabel: 'Sales Invoices & Billing',
    presentationType: 'FINANCIAL_TRANSACTION_360',
    rendererComponent: 'FinancialTransaction360View',
    headerConfig: {
      workspaceBadge: 'TREASURY COLLECTION 360° • OFFICIAL RECEIPT (OR)',
      accentColor: 'emerald',
      bannerMode: 'ACCOUNTING_WORKFLOW_STEPPER',
      primaryRefLabel: 'OR / Payment No.',
      showsAccountingWorkflowStepper: true,
    },
    summaryMetrics: [
      { key: 'amount', label: 'Net Cash Received', format: 'currency', description: 'Actual cash/bank collection' },
      { key: 'withholdingTaxAmount', label: 'Creditable WHT (2307)', format: 'currency', description: 'Customer withheld tax certificate' },
      { key: 'appliedTotal', label: 'Applied to Invoices', format: 'currency', description: 'Amount allocated to open AR invoices' },
      { key: 'overpaymentAmount', label: 'Unapplied / Advance', format: 'currency', description: 'Excess collection held as customer credit' },
    ],
    mainInformationSections: [
      'Official Receipt Identity & Depository Account',
      'Customer & BIR Form 2307 Creditable Withholding',
      'Invoice Settlement Allocation Table',
      'GL Cash & AR Posting Lineage',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Collection & OR 360°' },
      { id: 'details', label: '2. Invoice Allocations' },
      { id: 'related', label: '3. Settled Invoices & GL', badgeKey: 'related' },
      { id: 'documents', label: '4. Deposit Slips & 2307', badgeKey: 'documents' },
      { id: 'approvals', label: '5. Approvals', badgeKey: 'approvals' },
      { id: 'activity', label: '6. Activity Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Collection Posting History', 'Invoice Allocation Log'],
    relatedRecordRelationships: ['CUSTOMER_MASTER', 'APPLIED_INVOICE', 'GL_JOURNAL_POSTING'],
    availableActions: ['EDIT', 'SUBMIT', 'APPROVE', 'POST', 'REVERSE', 'CANCEL', 'COPY'],
    backendDataRequirements: ['customer_payments', 'customer_payment_applications', 'sales_invoices', 'customers', 'journal_entries'],
    permissionRequirements: {
      moduleId: 'sales',
      viewPermissions: ['sales:view', 'cash:view', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Customer Collection Not Found',
      emptyPrimaryMessage: 'The requested Official Receipt / Collection record was not found.',
      emptyRelatedMessage: 'No sales invoices are currently linked to this collection.',
      errorFallbackMessage: 'Unable to load Customer Payment 360° view.',
    },
  },

  SUPPLIER_PAYMENT: {
    requirementId: 'REQ-360-FIN-007',
    entityType: 'SUPPLIER_PAYMENT',
    aliases: ['SUPPLIER_PAYMENT', 'SUPPLIER_PAYMENTS'],
    displayName: 'Supplier Disbursement & EWT Voucher',
    moduleId: 'procurement',
    moduleLabel: '3. Procurement & Payables',
    submoduleId: 'proc-bills',
    submoduleLabel: 'Purchase Bills & Accounts Payable',
    presentationType: 'FINANCIAL_TRANSACTION_360',
    rendererComponent: 'FinancialTransaction360View',
    headerConfig: {
      workspaceBadge: 'DISBURSEMENT 360° • CHECK VOUCHER & EWT',
      accentColor: 'indigo',
      bannerMode: 'ACCOUNTING_WORKFLOW_STEPPER',
      primaryRefLabel: 'Payment No.',
      showsAccountingWorkflowStepper: true,
    },
    summaryMetrics: [
      { key: 'amount', label: 'Net Cash Disbursed', format: 'currency', description: 'Net payment released to vendor' },
      { key: 'withholdingTaxAmount', label: 'EWT Withheld (BIR 2307)', format: 'currency', description: 'Expanded Withholding Tax remitted to BIR' },
      { key: 'appliedTotal', label: 'Settled AP Bills', format: 'currency', description: 'Total applied to supplier bills' },
      { key: 'overpaymentAmount', label: 'Supplier Advance', format: 'currency', description: 'Unapplied advance payment' },
    ],
    mainInformationSections: [
      'Check Voucher & Bank Account Details',
      'Vendor & BIR Form 2307 EWT Deduction',
      'Settled Purchase Bills Allocation',
      'GL Disbursement Posting Lineage',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Disbursement 360°' },
      { id: 'details', label: '2. Bill Allocations & EWT' },
      { id: 'related', label: '3. Settled Bills & GL', badgeKey: 'related' },
      { id: 'documents', label: '4. OR & 2307 Attachments', badgeKey: 'documents' },
      { id: 'approvals', label: '5. Approvals & SoD', badgeKey: 'approvals' },
      { id: 'activity', label: '6. Activity Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Disbursement Approval', 'Check/Transfer Release'],
    relatedRecordRelationships: ['VENDOR_MASTER', 'SETTLED_BILL', 'GL_JOURNAL_POSTING'],
    availableActions: ['EDIT', 'SUBMIT', 'APPROVE', 'POST', 'REVERSE', 'CANCEL', 'COPY'],
    backendDataRequirements: ['supplier_payments', 'supplier_payment_applications', 'purchase_bills', 'vendors', 'journal_entries'],
    permissionRequirements: {
      moduleId: 'procurement',
      viewPermissions: ['purchases:view', 'cash:view', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Supplier Disbursement Not Found',
      emptyPrimaryMessage: 'The requested Supplier Payment voucher was not found.',
      emptyRelatedMessage: 'No purchase bills are linked to this disbursement.',
      errorFallbackMessage: 'Unable to load Supplier Disbursement 360° view.',
    },
  },

  CREDIT_MEMO: {
    requirementId: 'REQ-360-FIN-008',
    entityType: 'CREDIT_MEMO',
    aliases: ['CREDIT_MEMO', 'CREDIT_MEMOS'],
    displayName: 'Customer Credit Memo & Sales Return',
    moduleId: 'sales',
    moduleLabel: '2. Sales & Receivables',
    submoduleId: 'sales-invoices',
    submoduleLabel: 'Sales Invoices & Billing',
    presentationType: 'FINANCIAL_TRANSACTION_360',
    rendererComponent: 'FinancialTransaction360View',
    headerConfig: {
      workspaceBadge: 'FINANCIAL ADJUSTMENT 360° • CREDIT MEMO',
      accentColor: 'amber',
      bannerMode: 'ACCOUNTING_WORKFLOW_STEPPER',
      primaryRefLabel: 'Credit Memo No.',
      showsAccountingWorkflowStepper: true,
    },
    summaryMetrics: [
      { key: 'totalAmount', label: 'Total Credit Amount', format: 'currency', description: 'Total sales return / credit value' },
      { key: 'balanceRemaining', label: 'Unapplied Credit Balance', format: 'currency', description: 'Remaining credit available' },
    ],
    mainInformationSections: ['Customer & Return Reason', 'Credit Memo Lines & Output VAT Adjustment', 'Applied Invoices & GL Reversal'],
    applicableTabs: [
      { id: 'overview', label: '1. Credit Memo 360°' },
      { id: 'details', label: '2. Return Lines' },
      { id: 'related', label: '3. Applied Invoices & GL', badgeKey: 'related' },
      { id: 'documents', label: '4. Return Evidence', badgeKey: 'documents' },
      { id: 'activity', label: '5. Activity & Audit', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Approval & Posting History'],
    relatedRecordRelationships: ['CUSTOMER_MASTER', 'SALES_INVOICE', 'GL_JOURNAL_POSTING'],
    availableActions: ['EDIT', 'SUBMIT', 'APPROVE', 'POST', 'REVERSE', 'CANCEL'],
    backendDataRequirements: ['credit_memos', 'credit_memo_lines', 'credit_memo_applications', 'customers'],
    permissionRequirements: {
      moduleId: 'sales',
      viewPermissions: ['sales:view', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Credit Memo Not Found',
      emptyPrimaryMessage: 'The requested Credit Memo record does not exist.',
      emptyRelatedMessage: 'This credit memo has not yet been applied to a Sales Invoice.',
      errorFallbackMessage: 'Unable to load Credit Memo 360° view.',
    },
  },

  DEBIT_MEMO: {
    requirementId: 'REQ-360-FIN-009',
    entityType: 'DEBIT_MEMO',
    aliases: ['DEBIT_MEMO', 'DEBIT_MEMOS'],
    displayName: 'Supplier Debit Memo & Purchase Return',
    moduleId: 'procurement',
    moduleLabel: '3. Procurement & Payables',
    submoduleId: 'proc-bills',
    submoduleLabel: 'Purchase Bills & Accounts Payable',
    presentationType: 'FINANCIAL_TRANSACTION_360',
    rendererComponent: 'FinancialTransaction360View',
    headerConfig: {
      workspaceBadge: 'FINANCIAL ADJUSTMENT 360° • DEBIT MEMO',
      accentColor: 'amber',
      bannerMode: 'ACCOUNTING_WORKFLOW_STEPPER',
      primaryRefLabel: 'Debit Memo No.',
      showsAccountingWorkflowStepper: true,
    },
    summaryMetrics: [
      { key: 'totalAmount', label: 'Total Debit Memo Amount', format: 'currency', description: 'Total supplier return / reduction' },
      { key: 'balanceRemaining', label: 'Unapplied Debit Balance', format: 'currency', description: 'Remaining unapplied debit memo' },
    ],
    mainInformationSections: ['Vendor & Return Reason', 'Debit Memo Lines & Input VAT Adjustment', 'Applied Bills & GL Posting'],
    applicableTabs: [
      { id: 'overview', label: '1. Debit Memo 360°' },
      { id: 'details', label: '2. Return Lines' },
      { id: 'related', label: '3. Applied Bills & GL', badgeKey: 'related' },
      { id: 'documents', label: '4. Return Docs', badgeKey: 'documents' },
      { id: 'activity', label: '5. Activity & Audit', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Approval & Posting History'],
    relatedRecordRelationships: ['VENDOR_MASTER', 'PURCHASE_BILL', 'GL_JOURNAL_POSTING'],
    availableActions: ['EDIT', 'SUBMIT', 'APPROVE', 'POST', 'REVERSE', 'CANCEL'],
    backendDataRequirements: ['debit_memos', 'debit_memo_lines', 'debit_memo_applications', 'vendors'],
    permissionRequirements: {
      moduleId: 'procurement',
      viewPermissions: ['purchases:view', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Debit Memo Not Found',
      emptyPrimaryMessage: 'The requested Debit Memo record does not exist.',
      emptyRelatedMessage: 'This debit memo has not yet been applied to a Purchase Bill.',
      errorFallbackMessage: 'Unable to load Debit Memo 360° view.',
    },
  },

  CASH_TRANSACTION: {
    requirementId: 'REQ-360-FIN-010',
    entityType: 'CASH_TRANSACTION',
    aliases: ['CASH_TRANSACTION', 'CASH_TRANSACTIONS'],
    displayName: 'Treasury & Petty Cash Transaction',
    moduleId: 'cash-banking',
    moduleLabel: '5. Cash & Banking',
    submoduleId: 'cash-mgmt',
    submoduleLabel: 'Cash & Check Management',
    presentationType: 'FINANCIAL_TRANSACTION_360',
    rendererComponent: 'FinancialTransaction360View',
    headerConfig: {
      workspaceBadge: 'TREASURY 360° • CASH & CHECK TRANSACTION',
      accentColor: 'emerald',
      bannerMode: 'ACCOUNTING_WORKFLOW_STEPPER',
      primaryRefLabel: 'Transaction No.',
      showsAccountingWorkflowStepper: true,
    },
    summaryMetrics: [
      { key: 'totalAmount', label: 'Transaction Amount', format: 'currency', description: 'Total cash receipt or disbursement' },
      { key: 'type', label: 'Treasury Classification', format: 'text', description: 'Receipt, Disbursement, Petty Cash, or Advance' },
    ],
    mainInformationSections: ['Cash Account & Reference', 'Distribution Lines', 'GL Journal Impact'],
    applicableTabs: [
      { id: 'overview', label: '1. Treasury 360°' },
      { id: 'details', label: '2. Distribution Lines' },
      { id: 'related', label: '3. Linked GL & Advances', badgeKey: 'related' },
      { id: 'documents', label: '4. Vouchers & Receipts', badgeKey: 'documents' },
      { id: 'approvals', label: '5. Approvals', badgeKey: 'approvals' },
      { id: 'activity', label: '6. Audit Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Treasury Approval & Posting'],
    relatedRecordRelationships: ['GL_JOURNAL_POSTING'],
    availableActions: ['EDIT', 'SUBMIT', 'APPROVE', 'POST', 'REVERSE', 'CANCEL'],
    backendDataRequirements: ['cash_transactions', 'cash_transaction_lines', 'journal_entries'],
    permissionRequirements: {
      moduleId: 'cash-banking',
      viewPermissions: ['cash:view', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Cash Transaction Not Found',
      emptyPrimaryMessage: 'The requested Cash Transaction record does not exist.',
      emptyRelatedMessage: 'No linked GL journal entry posted yet.',
      errorFallbackMessage: 'Unable to load Cash Transaction 360° view.',
    },
  },

  BANK_DEPOSIT: {
    requirementId: 'REQ-360-FIN-011',
    entityType: 'BANK_DEPOSIT',
    aliases: ['BANK_DEPOSIT', 'BANK_DEPOSITS'],
    displayName: 'Bank Deposit Slip',
    moduleId: 'cash-banking',
    moduleLabel: '5. Cash & Banking',
    submoduleId: 'cash-mgmt',
    submoduleLabel: 'Cash & Check Management',
    presentationType: 'FINANCIAL_TRANSACTION_360',
    rendererComponent: 'FinancialTransaction360View',
    headerConfig: {
      workspaceBadge: 'BANKING 360° • DEPOSITORY TRANSFER',
      accentColor: 'emerald',
      bannerMode: 'ACCOUNTING_WORKFLOW_STEPPER',
      primaryRefLabel: 'Deposit No.',
      showsAccountingWorkflowStepper: true,
    },
    summaryMetrics: [
      { key: 'totalAmount', label: 'Deposit Amount', format: 'currency', description: 'Total deposited into bank account' },
    ],
    mainInformationSections: ['Source Undeposited Funds & Target Bank Account', 'GL Posting & Bank Reconciliation Status'],
    applicableTabs: [
      { id: 'overview', label: '1. Deposit 360°' },
      { id: 'related', label: '2. GL Posting', badgeKey: 'related' },
      { id: 'documents', label: '3. Validated Deposit Slip', badgeKey: 'documents' },
      { id: 'activity', label: '4. Audit Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Deposit Verification & Posting'],
    relatedRecordRelationships: ['GL_JOURNAL_POSTING'],
    availableActions: ['EDIT', 'SUBMIT', 'APPROVE', 'POST', 'REVERSE', 'CANCEL'],
    backendDataRequirements: ['bank_deposits', 'accounts', 'journal_entries'],
    permissionRequirements: {
      moduleId: 'cash-banking',
      viewPermissions: ['cash:view', 'bank_rec:view', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Bank Deposit Not Found',
      emptyPrimaryMessage: 'The requested Bank Deposit record does not exist.',
      emptyRelatedMessage: 'No linked GL journal entry found.',
      errorFallbackMessage: 'Unable to load Bank Deposit 360° view.',
    },
  },

  // ============================================================================
  // B. CUSTOMER RELATIONSHIP 360
  // ============================================================================
  CUSTOMER: {
    requirementId: 'REQ-360-REL-001',
    entityType: 'CUSTOMER',
    aliases: ['CUSTOMER', 'CUSTOMERS'],
    displayName: 'Customer Relationship 360°',
    moduleId: 'master-data',
    moduleLabel: '16. Master Data & Administration',
    submoduleId: 'md-customers',
    submoduleLabel: 'Customer Master Registry',
    presentationType: 'CUSTOMER_RELATIONSHIP_360',
    rendererComponent: 'CustomerRelationship360View',
    headerConfig: {
      workspaceBadge: 'CUSTOMER RELATIONSHIP 360° • COMMERCIAL & AR PROFILE',
      accentColor: 'sky',
      bannerMode: 'MASTER_RELATIONSHIP_BANNER',
      primaryRefLabel: 'Customer Code',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'receivableBalance', label: 'Outstanding AR Balance', format: 'currency', description: 'Current unpaid receivable exposure' },
      { key: 'overdueBalance', label: 'Overdue AR Exposure', format: 'currency', description: 'Past-due invoice balance' },
      { key: 'creditLimit', label: 'Authorized Credit Limit', format: 'currency', description: 'Approved credit ceiling' },
      { key: 'totalBilled', label: 'Lifetime Billed Sales', format: 'currency', description: 'Cumulative invoiced revenue' },
    ],
    mainInformationSections: [
      'Customer Commercial Profile & BIR TIN / VAT Classification',
      'Credit Limit Utilization & AR Aging Breakdown',
      'Sales Invoices & Billing History',
      'Official Receipt Collections & Credit Memos',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Customer Relationship 360°' },
      { id: 'related', label: '2. Invoices, Collections & Memos', badgeKey: 'related' },
      { id: 'documents', label: '3. Contracts & BIR 2303/2307', badgeKey: 'documents' },
      { id: 'changes', label: '4. Master Profile Changes', badgeKey: 'changes' },
      { id: 'activity', label: '5. Governance Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Credit Limit & Terms Modifications', 'AR Billing & Collection Timeline'],
    relatedRecordRelationships: ['CUSTOMER_INVOICE', 'OFFICIAL_RECEIPT_COLLECTION', 'CREDIT_MEMO_ADJUSTMENT'],
    availableActions: ['EDIT', 'ARCHIVE', 'RESTORE'],
    backendDataRequirements: ['customers', 'sales_invoices', 'customer_payments', 'credit_memos'],
    permissionRequirements: {
      moduleId: 'sales',
      viewPermissions: ['sales:view', 'customers:view', 'masterdata:view', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Customer Master Record Not Found',
      emptyPrimaryMessage: 'The requested Customer profile was not found in the active company.',
      emptyRelatedMessage: 'No sales invoices, collections, or credit memos have been recorded for this customer yet.',
      errorFallbackMessage: 'Unable to load Customer Relationship 360° profile.',
    },
  },

  // ============================================================================
  // C. VENDOR / SUPPLIER RELATIONSHIP 360
  // ============================================================================
  VENDOR: {
    requirementId: 'REQ-360-REL-002',
    entityType: 'VENDOR',
    aliases: ['VENDOR', 'VENDORS', 'SUPPLIER', 'SUPPLIERS'],
    displayName: 'Vendor & Supplier Relationship 360°',
    moduleId: 'master-data',
    moduleLabel: '16. Master Data & Administration',
    submoduleId: 'md-vendors',
    submoduleLabel: 'Vendor & Supplier Registry',
    presentationType: 'VENDOR_RELATIONSHIP_360',
    rendererComponent: 'VendorRelationship360View',
    headerConfig: {
      workspaceBadge: 'SUPPLIER RELATIONSHIP 360° • PROCUREMENT & AP PROFILE',
      accentColor: 'violet',
      bannerMode: 'MASTER_RELATIONSHIP_BANNER',
      primaryRefLabel: 'Vendor Code',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'payableBalance', label: 'Outstanding AP Balance', format: 'currency', description: 'Unpaid supplier bills balance' },
      { key: 'totalBilled', label: 'Total Supplier Purchases', format: 'currency', description: 'Cumulative billed procurement' },
      { key: 'totalDisbursed', label: 'Total Disbursed Cash', format: 'currency', description: 'Cumulative payments released' },
      { key: 'totalWithheldEwt', label: 'Total EWT Withheld (2307)', format: 'currency', description: 'Cumulative Expanded Withholding Tax' },
    ],
    mainInformationSections: [
      'Supplier Registration, TIN & Withholding Tax (ATC) Profile',
      'Payable Exposure & Procurement Summary',
      'Purchase Orders & Purchase Bills History',
      'Disbursement Vouchers & BIR Form 2307 History',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Supplier Relationship 360°' },
      { id: 'related', label: '2. Bills, POs & Disbursements', badgeKey: 'related' },
      { id: 'documents', label: '3. Accreditation & 2307 Docs', badgeKey: 'documents' },
      { id: 'changes', label: '4. Master Profile Changes', badgeKey: 'changes' },
      { id: 'activity', label: '5. Governance Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Supplier Master Changes', 'Procurement & Disbursement History'],
    relatedRecordRelationships: ['VENDOR_BILL', 'SUPPLIER_DISBURSEMENT', 'PURCHASE_ORDER', 'DEBIT_MEMO_ADJUSTMENT'],
    availableActions: ['EDIT', 'ARCHIVE', 'RESTORE'],
    backendDataRequirements: ['vendors', 'purchase_bills', 'supplier_payments', 'purchase_orders', 'debit_memos'],
    permissionRequirements: {
      moduleId: 'procurement',
      viewPermissions: ['purchases:view', 'vendors:view', 'masterdata:view', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Supplier Master Record Not Found',
      emptyPrimaryMessage: 'The requested Vendor profile was not found in the active company.',
      emptyRelatedMessage: 'No purchase orders, bills, or disbursements have been recorded for this supplier yet.',
      errorFallbackMessage: 'Unable to load Supplier Relationship 360° profile.',
    },
  },

  // ============================================================================
  // D. INVENTORY & WAREHOUSE OPERATIONS 360
  // ============================================================================
  INVENTORY_ITEM: {
    requirementId: 'REQ-360-INV-001',
    entityType: 'INVENTORY_ITEM',
    aliases: ['INVENTORY_ITEM', 'INVENTORY_ITEMS', 'ITEM'],
    displayName: 'Inventory Item & Valuation 360°',
    moduleId: 'inventory',
    moduleLabel: '4. Inventory & Warehouse',
    submoduleId: 'inv-movements',
    submoduleLabel: 'Inventory & Stock Valuation',
    presentationType: 'INVENTORY_OPERATIONS_360',
    rendererComponent: 'InventoryOperations360View',
    headerConfig: {
      workspaceBadge: 'INVENTORY OPERATIONS 360° • STOCK & VALUATION LEDGER',
      accentColor: 'teal',
      bannerMode: 'INVENTORY_VALUATION_BANNER',
      primaryRefLabel: 'SKU Code',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'quantityOnHand', label: 'Quantity On Hand', format: 'number', description: 'Current physical warehouse stock' },
      { key: 'unitCost', label: 'Unit Valuation Cost', format: 'currency', description: 'FIFO / Weighted Average unit cost' },
      { key: 'totalValuation', label: 'Total Inventory Valuation', format: 'currency', description: 'Extended asset value (Qty × Unit Cost)' },
      { key: 'sellingPrice', label: 'Standard Selling Price', format: 'currency', description: 'Commercial unit selling price' },
    ],
    mainInformationSections: [
      'SKU Classification, Costing Method (FIFO/WAV) & Reorder Threshold',
      'On-Hand Valuation & GL Asset / COGS Account Mapping',
      'Chronological Stock Movement Ledger (Receipts, Sales, Adjustments)',
      'Related Purchase Orders & Stock Adjustments',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Stock & Valuation 360°' },
      { id: 'details', label: '2. Stock Movement Ledger' },
      { id: 'related', label: '3. POs & Adjustments', badgeKey: 'related' },
      { id: 'changes', label: '4. Cost & Price Changes', badgeKey: 'changes' },
      { id: 'activity', label: '5. Inventory Audit Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Stock Receipts & Issuances', 'Physical Count Adjustments'],
    relatedRecordRelationships: ['STOCK_ADJUSTMENT', 'PURCHASE_ORDER', 'GL_JOURNAL_POSTING'],
    availableActions: ['EDIT', 'ADJUST', 'ARCHIVE', 'RESTORE'],
    backendDataRequirements: ['inventory_items', 'inventory_transactions', 'stock_adjustments', 'purchase_order_lines'],
    permissionRequirements: {
      moduleId: 'inventory',
      viewPermissions: ['inventory:view', 'inventory:read', 'operations:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Inventory Item Not Found',
      emptyPrimaryMessage: 'The requested SKU does not exist in the active company.',
      emptyRelatedMessage: 'No stock movements, receipts, or adjustments recorded for this SKU yet.',
      errorFallbackMessage: 'Unable to load Inventory Operations 360° view.',
    },
  },

  STOCK_ADJUSTMENT: {
    requirementId: 'REQ-360-INV-002',
    entityType: 'STOCK_ADJUSTMENT',
    aliases: ['STOCK_ADJUSTMENT', 'STOCK_ADJUSTMENTS'],
    displayName: 'Warehouse Stock Adjustment 360°',
    moduleId: 'inventory',
    moduleLabel: '4. Inventory & Warehouse',
    submoduleId: 'inv-movements',
    submoduleLabel: 'Inventory & Stock Valuation',
    presentationType: 'INVENTORY_OPERATIONS_360',
    rendererComponent: 'InventoryOperations360View',
    headerConfig: {
      workspaceBadge: 'INVENTORY OPERATIONS 360° • STOCK COUNT ADJUSTMENT',
      accentColor: 'teal',
      bannerMode: 'INVENTORY_VALUATION_BANNER',
      primaryRefLabel: 'Adjustment No.',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'quantityChange', label: 'Quantity Adjusted', format: 'number', description: 'Net stock addition or shrinkage' },
      { key: 'adjustmentValue', label: 'Valuation Impact', format: 'currency', description: 'Financial COGS / shrinkage impact' },
    ],
    mainInformationSections: [
      'Affected SKU & Adjustment Reason (Count Variance / Shrinkage / Damage)',
      'Before & After Stock Quantity Impact',
      'GL Expense / Inventory Account Posting',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Stock Adjustment 360°' },
      { id: 'related', label: '2. Affected Item & GL', badgeKey: 'related' },
      { id: 'documents', label: '3. Count Sheets', badgeKey: 'documents' },
      { id: 'activity', label: '4. Audit Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Stock Adjustment Authorization'],
    relatedRecordRelationships: ['INVENTORY_ITEM', 'GL_JOURNAL_POSTING'],
    availableActions: ['REVERSE', 'CANCEL'],
    backendDataRequirements: ['stock_adjustments', 'inventory_items', 'inventory_transactions'],
    permissionRequirements: {
      moduleId: 'inventory',
      viewPermissions: ['inventory:view', 'inventory:read', 'operations:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Stock Adjustment Not Found',
      emptyPrimaryMessage: 'The requested Stock Adjustment record does not exist.',
      emptyRelatedMessage: 'No linked SKU or GL journal entry found.',
      errorFallbackMessage: 'Unable to load Stock Adjustment 360° view.',
    },
  },

  // ============================================================================
  // E. PAYROLL & COMPENSATION 360
  // ============================================================================
  PAYROLL_RUN: {
    requirementId: 'REQ-360-PAY-001',
    entityType: 'PAYROLL_RUN',
    aliases: ['PAYROLL_RUN', 'PAYROLL_RUNS', 'PAYROLL'],
    displayName: 'Payroll Run & Statutory Compensation 360°',
    moduleId: 'payroll',
    moduleLabel: '8. Payroll & Human Resources',
    submoduleId: 'pay-records',
    submoduleLabel: 'Payroll & Statutory Compensation',
    presentationType: 'PAYROLL_360',
    rendererComponent: 'Payroll360View',
    headerConfig: {
      workspaceBadge: 'PAYROLL & STATUTORY 360° • COMPENSATION REGISTER',
      accentColor: 'violet',
      bannerMode: 'PAYROLL_COMPENSATION_BANNER',
      primaryRefLabel: 'Payroll Period',
      showsAccountingWorkflowStepper: true,
    },
    summaryMetrics: [
      { key: 'totalGrossPay', label: 'Total Gross Compensation', format: 'currency', description: 'Basic + Overtime + Holiday + Night Diff' },
      { key: 'totalStatutoryDeductions', label: 'SSS / PHIC / HDMF / WHT', format: 'currency', description: 'Total employee statutory & tax deductions' },
      { key: 'totalNetPay', label: 'Total Net Take-Home Pay', format: 'currency', description: 'Net payroll disbursement' },
      { key: 'employeeCount', label: 'Processed Headcount', format: 'number', description: 'Employees included in payroll run' },
    ],
    mainInformationSections: [
      'Payroll Period, Cutoff Dates & Disbursement Status',
      'Philippine Statutory Contributions Breakdown (SSS, PhilHealth, Pag-IBIG, BIR 1601-C WHT)',
      'Employee Payroll Register (Role-Scoped Compensation Protection)',
      'Payroll GL Accrual & Remittance Lineage',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Payroll & Statutory 360°' },
      { id: 'details', label: '2. Employee Register' },
      { id: 'related', label: '3. GL Posting & Remittances', badgeKey: 'related' },
      { id: 'approvals', label: '4. Payroll Approvals', badgeKey: 'approvals' },
      { id: 'activity', label: '5. Audit Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Payroll Computation & Approval', 'GL Accrual Posting'],
    relatedRecordRelationships: ['PAYROLL_EMPLOYEE_COMPENSATION', 'GL_JOURNAL_POSTING'],
    availableActions: ['EDIT', 'SUBMIT', 'APPROVE', 'POST', 'REVERSE', 'CANCEL'],
    backendDataRequirements: ['payroll_runs', 'payroll_items', 'employees', 'journal_entries'],
    permissionRequirements: {
      moduleId: 'payroll',
      viewPermissions: ['payroll:view', 'payroll:read', 'operations:view'],
      sensitiveDataPermissions: ['payroll:manage', 'payroll:write', 'payroll:approve'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Payroll Run Not Found',
      emptyPrimaryMessage: 'The requested Payroll Run does not exist in the active company.',
      emptyRelatedMessage: 'No employee payroll items or GL postings linked to this payroll run.',
      errorFallbackMessage: 'Unable to load Payroll 360° workspace.',
    },
  },

  EMPLOYEE: {
    requirementId: 'REQ-360-PAY-002',
    entityType: 'EMPLOYEE',
    aliases: ['EMPLOYEE', 'EMPLOYEES'],
    displayName: 'Employee Compensation & Statutory Profile 360°',
    moduleId: 'payroll',
    moduleLabel: '8. Payroll & Human Resources',
    submoduleId: 'pay-records',
    submoduleLabel: 'Payroll & Statutory Compensation',
    presentationType: 'PAYROLL_360',
    rendererComponent: 'Payroll360View',
    headerConfig: {
      workspaceBadge: 'HR & COMPENSATION 360° • EMPLOYEE STATUTORY PROFILE',
      accentColor: 'violet',
      bannerMode: 'PAYROLL_COMPENSATION_BANNER',
      primaryRefLabel: 'Employee No.',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'monthlyBasicSalary', label: 'Monthly Basic Salary', format: 'currency', description: 'Contractual monthly base pay' },
      { key: 'ytdGrossPay', label: 'YTD Gross Earnings', format: 'currency', description: 'Cumulative gross compensation across runs' },
      { key: 'ytdWithholdingTax', label: 'YTD Withheld Tax (2316)', format: 'currency', description: 'Cumulative BIR compensation WHT' },
      { key: 'ytdNetPay', label: 'YTD Net Disbursed', format: 'currency', description: 'Cumulative net take-home pay' },
    ],
    mainInformationSections: [
      'Employee Identity, Department & Position',
      'Statutory Registration Numbers (TIN, SSS, PhilHealth, Pag-IBIG)',
      'Compensation Structure & Payslip History (BIR 2316 Alphalist Basis)',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Employee & Statutory 360°' },
      { id: 'details', label: '2. Payslip & Run History' },
      { id: 'changes', label: '3. Salary & Profile Changes', badgeKey: 'changes' },
      { id: 'activity', label: '4. HR Governance Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Compensation Adjustments', 'Payroll Inclusion History'],
    relatedRecordRelationships: ['PAYROLL_RUN'],
    availableActions: ['EDIT', 'ARCHIVE', 'RESTORE'],
    backendDataRequirements: ['employees', 'payroll_items', 'payroll_runs'],
    permissionRequirements: {
      moduleId: 'payroll',
      viewPermissions: ['payroll:view', 'payroll:read', 'operations:view'],
      sensitiveDataPermissions: ['payroll:manage', 'payroll:write', 'payroll:approve'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Employee Record Not Found',
      emptyPrimaryMessage: 'The requested Employee profile does not exist in the active company.',
      emptyRelatedMessage: 'No processed payroll runs found for this employee yet.',
      errorFallbackMessage: 'Unable to load Employee 360° profile.',
    },
  },

  // ============================================================================
  // F. TAX & STATUTORY COMPLIANCE 360
  // ============================================================================
  TAX_FILING: {
    requirementId: 'REQ-360-TAX-001',
    entityType: 'TAX_FILING',
    aliases: ['TAX_FILING', 'TAX_FILINGS', 'BIR_FILING', 'TAX_CALCULATION', 'LEDGER_DATA_ENTRY'],
    displayName: 'BIR Statutory Tax Return & Compliance 360°',
    moduleId: 'tax',
    moduleLabel: '9. Tax & BIR Compliance',
    submoduleId: 'tax-engine',
    submoduleLabel: 'BIR Statutory Returns & eFiling',
    presentationType: 'TAX_COMPLIANCE_360',
    rendererComponent: 'TaxCompliance360View',
    headerConfig: {
      workspaceBadge: 'PHILIPPINE TAX COMPLIANCE 360° • BIR STATUTORY RETURN',
      accentColor: 'amber',
      bannerMode: 'STATUTORY_TAX_BANNER',
      primaryRefLabel: 'Return Period',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'totalTaxBase', label: 'Taxable Base / Gross Sales', format: 'currency', description: 'Persisted statutory tax base' },
      { key: 'totalTaxDue', label: 'Gross Statutory Tax Due', format: 'currency', description: 'Output VAT / EWT / Income Tax due' },
      { key: 'netTaxPayable', label: 'Net Tax Payable / (Credit)', format: 'currency', description: 'Net payable after input credits & adjustments' },
    ],
    mainInformationSections: [
      'BIR Form Identity, Taxable Period & Statutory Deadline',
      'Tax Base, Output/Input VAT & Withholding Tax Schedule',
      'Preparation Checklist, Manual Adjustments & Exceptions',
      'Honest Filing & Electronic Submission Status (Never Fabricated)',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. BIR Return 360°' },
      { id: 'details', label: '2. Tax Schedules & Checklist' },
      { id: 'related', label: '3. Source Tax Entries', badgeKey: 'related' },
      { id: 'documents', label: '4. 2307 / Return Attachments', badgeKey: 'documents' },
      { id: 'approvals', label: '5. CPA Review & Sign-Off', badgeKey: 'approvals' },
      { id: 'activity', label: '6. Compliance Audit', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Tax Return Preparation & Filing History', 'Manual Tax Adjustments'],
    relatedRecordRelationships: ['TAX_LEDGER_ENTRY', 'GL_JOURNAL_POSTING'],
    availableActions: ['EDIT', 'SUBMIT', 'APPROVE', 'POST', 'CANCEL'],
    backendDataRequirements: ['tax_filings', 'tax_filing_checklists', 'tax_manual_adjustments', 'tax_exceptions', 'electronic_filing_submissions'],
    permissionRequirements: {
      moduleId: 'tax',
      viewPermissions: ['tax:view', 'tax:read', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'BIR Tax Filing Not Found',
      emptyPrimaryMessage: 'The requested Tax Return record does not exist in the active company.',
      emptyRelatedMessage: 'No manual adjustments or exception flags recorded for this tax period.',
      errorFallbackMessage: 'Unable to load BIR Tax Compliance 360° view.',
    },
  },

  // ============================================================================
  // G. BANKING & RECONCILIATION 360
  // ============================================================================
  BANK_RECONCILIATION: {
    requirementId: 'REQ-360-BNK-001',
    entityType: 'BANK_RECONCILIATION',
    aliases: ['BANK_RECONCILIATION', 'BANK_RECONCILIATIONS'],
    displayName: 'Bank Reconciliation Workspace 360°',
    moduleId: 'cash-banking',
    moduleLabel: '5. Cash & Banking',
    submoduleId: 'bank-recon',
    submoduleLabel: 'Bank Reconciliation Workspace',
    presentationType: 'BANKING_RECONCILIATION_360',
    rendererComponent: 'BankingReconciliation360View',
    headerConfig: {
      workspaceBadge: 'BANKING RECONCILIATION 360° • STATEMENT VS BOOK PROOF',
      accentColor: 'emerald',
      bannerMode: 'BANK_RECONCILIATION_BANNER',
      primaryRefLabel: 'Statement Date',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'statementEndingBalance', label: 'Bank Statement Ending', format: 'currency', description: 'Ending balance per official bank statement' },
      { key: 'bookEndingBalance', label: 'GL Book Ending Balance', format: 'currency', description: 'Ending balance per General Ledger cash account' },
      { key: 'adjustedBookBalance', label: 'Adjusted Book / Bank', format: 'currency', description: 'Reconciled target balance' },
      { key: 'unexplainedDifference', label: 'Unexplained Difference', format: 'currency', description: 'Must equal ₱0.00 for approval' },
    ],
    mainInformationSections: [
      'Bank Statement vs General Ledger Book Balance Bridge',
      'Deposits in Transit & Outstanding Checks Summary',
      'Matched vs Unmatched Bank Statement Lines',
      'Bank Charges, Interest Income & Adjusting Journal Entries',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Reconciliation Proof 360°' },
      { id: 'details', label: '2. Statement Lines & Matching' },
      { id: 'related', label: '3. Adjusting GL Entries', badgeKey: 'related' },
      { id: 'documents', label: '4. Bank Statements (PDF/CSV)', badgeKey: 'documents' },
      { id: 'approvals', label: '5. Sign-Off & Reopen Log', badgeKey: 'approvals' },
      { id: 'activity', label: '6. Audit Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Reconciliation Approval & Reopen History'],
    relatedRecordRelationships: ['ACCOUNT', 'GL_JOURNAL_POSTING'],
    availableActions: ['EDIT', 'SUBMIT', 'APPROVE', 'REJECT', 'RETURN'],
    backendDataRequirements: ['bank_reconciliations', 'bank_statement_lines', 'bank_reconciliation_adjustments', 'accounts'],
    permissionRequirements: {
      moduleId: 'cash-banking',
      viewPermissions: ['bank_rec:view', 'bank_rec:read', 'cash:view', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Bank Reconciliation Not Found',
      emptyPrimaryMessage: 'The requested Bank Reconciliation statement does not exist.',
      emptyRelatedMessage: 'No statement lines or reconciliation adjustments attached.',
      errorFallbackMessage: 'Unable to load Bank Reconciliation 360° view.',
    },
  },

  ACCOUNT: {
    requirementId: 'REQ-360-BNK-002',
    entityType: 'ACCOUNT',
    aliases: ['ACCOUNT', 'ACCOUNTS'],
    displayName: 'Chart of Accounts & GL Ledger 360°',
    moduleId: 'accounting',
    moduleLabel: '6. Accounting & General Ledger',
    submoduleId: 'acct-coa',
    submoduleLabel: 'Chart of Accounts',
    presentationType: 'BANKING_RECONCILIATION_360',
    rendererComponent: 'BankingReconciliation360View',
    headerConfig: {
      workspaceBadge: 'CHART OF ACCOUNTS 360° • GENERAL LEDGER ACCOUNT',
      accentColor: 'indigo',
      bannerMode: 'BANK_RECONCILIATION_BANNER',
      primaryRefLabel: 'Account Code',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'totalDebits', label: 'Posted GL Debits', format: 'currency', description: 'Cumulative posted debit lines' },
      { key: 'totalCredits', label: 'Posted GL Credits', format: 'currency', description: 'Cumulative posted credit lines' },
      { key: 'netRunningBalance', label: 'Net Account Balance', format: 'currency', description: 'Authoritative normal-balance position' },
    ],
    mainInformationSections: [
      'Account Classification, Normal Balance & BIR Tax Mapping',
      'Authoritative General Ledger Posting Register',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Account & Balance 360°' },
      { id: 'related', label: '2. GL Journal Postings', badgeKey: 'related' },
      { id: 'changes', label: '3. Account Configuration History', badgeKey: 'changes' },
      { id: 'activity', label: '4. Governance Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['COA Configuration Changes'],
    relatedRecordRelationships: ['GL_ACCOUNT_POSTING'],
    availableActions: ['EDIT', 'ARCHIVE', 'RESTORE'],
    backendDataRequirements: ['accounts', 'journal_lines', 'journal_entries'],
    permissionRequirements: {
      moduleId: 'accounting',
      viewPermissions: ['accounting:view', 'accounts:read'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Chart of Accounts Record Not Found',
      emptyPrimaryMessage: 'The requested GL Account does not exist in the active company.',
      emptyRelatedMessage: 'No journal entries have been posted to this account yet.',
      errorFallbackMessage: 'Unable to load GL Account 360° view.',
    },
  },

  // ============================================================================
  // H. FIXED ASSET 360
  // ============================================================================
  FIXED_ASSET: {
    requirementId: 'REQ-360-FA-001',
    entityType: 'FIXED_ASSET',
    aliases: ['FIXED_ASSET', 'FIXED_ASSETS', 'ASSET'],
    displayName: 'Fixed Asset & Depreciation Schedule 360°',
    moduleId: 'fixed-assets',
    moduleLabel: '7. Fixed Assets',
    submoduleId: 'fa-register',
    submoduleLabel: 'Fixed Asset & Depreciation Register',
    presentationType: 'FIXED_ASSET_360',
    rendererComponent: 'FixedAsset360View',
    headerConfig: {
      workspaceBadge: 'FIXED ASSET 360° • CAPITALIZATION & DEPRECIATION REGISTER',
      accentColor: 'sky',
      bannerMode: 'ASSET_DEPRECIATION_BANNER',
      primaryRefLabel: 'Asset Tag',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'acquisitionCost', label: 'Acquisition Cost', format: 'currency', description: 'Capitalized historical cost' },
      { key: 'salvageValue', label: 'Residual / Salvage Value', format: 'currency', description: 'Estimated end-of-life salvage value' },
      { key: 'accumulatedDepreciation', label: 'Accumulated Depreciation', format: 'currency', description: 'Total depreciation recognized to date' },
      { key: 'netBookValue', label: 'Carrying Net Book Value', format: 'currency', description: 'Acquisition Cost less Accumulated Depreciation' },
    ],
    mainInformationSections: [
      'Asset Profile, Category, Useful Life & Straight-Line Depreciation Formula',
      'Carrying Value & Accumulated Depreciation Gauge',
      'Monthly Depreciation Schedule & GL Journal Links',
      'Disposal / Retirement Status',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Asset & NBV 360°' },
      { id: 'details', label: '2. Depreciation Schedule' },
      { id: 'related', label: '3. Depreciation GL Entries', badgeKey: 'related' },
      { id: 'documents', label: '4. Acquisition Invoices & Deeds', badgeKey: 'documents' },
      { id: 'activity', label: '5. Asset Lifecycle Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Capitalization & Depreciation Runs', 'Asset Disposal Events'],
    relatedRecordRelationships: ['GL_JOURNAL_POSTING'],
    availableActions: ['EDIT', 'POST', 'REVERSE', 'ARCHIVE'],
    backendDataRequirements: ['fixed_assets', 'depreciation_schedules', 'accounts', 'journal_entries'],
    permissionRequirements: {
      moduleId: 'fixed-assets',
      viewPermissions: ['fixedassets:view', 'fixed_assets:read', 'fixed_assets:view', 'operations:view', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Fixed Asset Not Found',
      emptyPrimaryMessage: 'The requested Fixed Asset record does not exist in the active company.',
      emptyRelatedMessage: 'No monthly depreciation schedule rows have been posted yet.',
      errorFallbackMessage: 'Unable to load Fixed Asset 360° view.',
    },
  },

  // ============================================================================
  // I. DOCUMENT & OCR INTELLIGENCE 360
  // ============================================================================
  DOCUMENT: {
    requirementId: 'REQ-360-DOC-001',
    entityType: 'DOCUMENT',
    aliases: ['DOCUMENT', 'DOCUMENTS'],
    displayName: 'Document Vault & OCR Intelligence 360°',
    moduleId: 'documents',
    moduleLabel: '11. Documents & OCR',
    submoduleId: 'doc-inbox',
    submoduleLabel: 'Document Vault & OCR Inbox',
    presentationType: 'DOCUMENT_INTELLIGENCE_360',
    rendererComponent: 'DocumentIntelligence360View',
    headerConfig: {
      workspaceBadge: 'DOCUMENT INTELLIGENCE 360° • ENCRYPTED VAULT & OCR',
      accentColor: 'indigo',
      bannerMode: 'DOCUMENT_VAULT_BANNER',
      primaryRefLabel: 'Document File',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'fileSize', label: 'Encrypted Payload Size', format: 'number', description: 'Binary size stored in external vault' },
      { key: 'confidenceScore', label: 'OCR Confidence Score', format: 'percentage', description: 'Automated field extraction accuracy' },
      { key: 'extractedTotalAmount', label: 'OCR Extracted Total', format: 'currency', description: 'Parsed receipt/invoice total' },
      { key: 'extractedVatAmount', label: 'OCR Extracted VAT', format: 'currency', description: 'Parsed 12% VAT amount' },
    ],
    mainInformationSections: [
      'Live Document Preview & LAISDOC1 AES-256-GCM Cryptographic Envelope Status',
      'OCR Extracted Structured Fields (Merchant, TIN, Invoice No., Date, Total, VAT)',
      'Human Verification Status & Linked Accounting Transaction',
      'Document Version Lineage & OCR Execution History',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Preview & OCR Intelligence 360°' },
      { id: 'details', label: '2. Version & OCR History' },
      { id: 'related', label: '3. Linked Accounting Record', badgeKey: 'related' },
      { id: 'changes', label: '4. Field Corrections', badgeKey: 'changes' },
      { id: 'activity', label: '5. Vault Audit Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Document Version Replacements', 'OCR Extraction & Human Correction History'],
    relatedRecordRelationships: ['LINKED_TRANSACTION'],
    availableActions: ['EDIT', 'APPROVE', 'REJECT', 'DELETE', 'RESTORE'],
    backendDataRequirements: ['documents', 'document_versions', 'document_ocr_history'],
    permissionRequirements: {
      moduleId: 'documents',
      viewPermissions: ['documents:view', 'documents:read', 'audit:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Vault Document Not Found',
      emptyPrimaryMessage: 'The requested Document record does not exist in the active company vault.',
      emptyRelatedMessage: 'This document is currently in the inbox and has not yet been linked to an accounting transaction.',
      errorFallbackMessage: 'Unable to load Document & OCR Intelligence 360° view.',
    },
  },

  // ============================================================================
  // J. APPROVAL & WORKFLOW 360
  // ============================================================================
  APPROVAL_WORKFLOW: {
    requirementId: 'REQ-360-APR-001',
    entityType: 'APPROVAL_WORKFLOW',
    aliases: ['APPROVAL_WORKFLOW', 'APPROVAL_WORKFLOWS', 'BUDGET', 'BUDGETS'],
    displayName: 'Approval Orchestration & SoD Control 360°',
    moduleId: 'approvals',
    moduleLabel: '13. Approvals & Workflow',
    submoduleId: 'appr-inbox',
    submoduleLabel: 'Approval Inbox & Workflows',
    presentationType: 'APPROVAL_WORKFLOW_360',
    rendererComponent: 'ApprovalWorkflow360View',
    headerConfig: {
      workspaceBadge: 'APPROVAL GOVERNANCE 360° • MULTI-STEP WORKFLOW & SOD',
      accentColor: 'amber',
      bannerMode: 'APPROVAL_ORCHESTRATION_BANNER',
      primaryRefLabel: 'Workflow Ref',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'amountCentavos', label: 'Transaction Amount Under Review', format: 'currency', description: 'Monetary value subject to threshold policy' },
      { key: 'currentStepOrder', label: 'Current Step', format: 'number', description: 'Active approval gate' },
      { key: 'totalSteps', label: 'Total Required Gates', format: 'number', description: 'Total sequential/parallel steps' },
    ],
    mainInformationSections: [
      'Requested Action, Submitter Identity & Segregation of Duties (SoD) Check',
      'Sequential / Threshold Approval Step Pipeline & SLA Telemetry',
      'Delegation, Escalation & Decision Comments History',
      'Target Business Record Under Governance',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Approval Pipeline 360°' },
      { id: 'approvals', label: '2. Step Decisions & Delegations', badgeKey: 'approvals' },
      { id: 'related', label: '3. Governed Business Record', badgeKey: 'related' },
      { id: 'activity', label: '4. Governance Audit Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Step Decisions', 'Delegations & Escalations'],
    relatedRecordRelationships: ['GOVERNED_ENTITY'],
    availableActions: ['APPROVE', 'REJECT', 'RETURN', 'CANCEL'],
    backendDataRequirements: ['approval_workflows', 'approval_steps', 'approval_delegations', 'budgets'],
    permissionRequirements: {
      moduleId: 'approvals',
      viewPermissions: ['approvals:view', 'approvals:review', 'approvals:approve', 'budget:view', 'accounting:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Approval Workflow Not Found',
      emptyPrimaryMessage: 'The requested Approval Workflow or Budget control record was not found.',
      emptyRelatedMessage: 'No linked target transaction record found.',
      errorFallbackMessage: 'Unable to load Approval Workflow 360° view.',
    },
  },

  // ============================================================================
  // K. AUDIT & GOVERNANCE ENGAGEMENT 360
  // ============================================================================
  AUDIT_ENGAGEMENT: {
    requirementId: 'REQ-360-AUD-001',
    entityType: 'AUDIT_ENGAGEMENT',
    aliases: ['AUDIT_ENGAGEMENT', 'AUDIT_ENGAGEMENTS', 'AUDIT_WORKPAPER', 'AUDIT_WORKPAPERS', 'AUDIT_FINDING', 'AUDIT_FINDINGS'],
    displayName: 'CPA Audit Engagement, Workpapers & Findings 360°',
    moduleId: 'audit',
    moduleLabel: '15. Audit & Governance',
    submoduleId: 'aud-engagements',
    submoduleLabel: 'Audit Engagements & Planning',
    presentationType: 'AUDIT_ENGAGEMENT_360',
    rendererComponent: 'AuditEngagement360View',
    headerConfig: {
      workspaceBadge: 'PSA STATUTORY AUDIT 360° • ENGAGEMENT & WORKING PAPERS',
      accentColor: 'rose',
      bannerMode: 'AUDIT_ENGAGEMENT_BANNER',
      primaryRefLabel: 'Engagement / WP Ref',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'materiality', label: 'Overall Materiality', format: 'currency', description: 'PSA 320 overall planning materiality' },
      { key: 'performanceMateriality', label: 'Performance Materiality', format: 'currency', description: 'Fieldwork testing threshold' },
      { key: 'workpapersCount', label: 'PSA Working Papers', format: 'number', description: 'Prepared & reviewed lead sheets' },
      { key: 'findingsCount', label: 'Audit Findings & Adjustments', format: 'number', description: 'Identified control/financial findings' },
    ],
    mainInformationSections: [
      'Engagement Scope, Audit Period, Materiality Thresholds & Assigned CPA Team',
      'PSA Risk Assessment & Significant Accounts',
      'Working Papers (Lead Sheets, Sampling, Population & Conclusions)',
      'Audit Findings, Proposed Adjustments & Partner Sign-Off Status',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Audit Engagement 360°' },
      { id: 'details', label: '2. Working Papers & Findings' },
      { id: 'documents', label: '3. Audit Evidence Vault', badgeKey: 'documents' },
      { id: 'approvals', label: '4. Preparer / Reviewer / Partner Sign-Off', badgeKey: 'approvals' },
      { id: 'activity', label: '5. Immutable Audit Trail', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Working Paper Version History', 'Partner Review & Sign-Off Log'],
    relatedRecordRelationships: ['AUDIT_WORKPAPER', 'AUDIT_FINDING', 'GL_JOURNAL_POSTING'],
    availableActions: ['EDIT', 'SUBMIT', 'REVIEW', 'APPROVE', 'POST'],
    backendDataRequirements: ['audit_engagements', 'audit_workpapers', 'audit_findings', 'audit_adjustments', 'audit_risks_and_procedures'],
    permissionRequirements: {
      moduleId: 'audit',
      viewPermissions: ['audit:view', 'audit:read'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'Audit Engagement Record Not Found',
      emptyPrimaryMessage: 'The requested CPA Audit Engagement, Workpaper, or Finding was not found.',
      emptyRelatedMessage: 'No working papers or audit findings have been linked to this engagement yet.',
      errorFallbackMessage: 'Unable to load CPA Audit Engagement 360° view.',
    },
  },

  // ============================================================================
  // L. SYSTEM OPERATIONS 360
  // ============================================================================
  SYSTEM_OPERATION: {
    requirementId: 'REQ-360-SYS-001',
    entityType: 'SYSTEM_OPERATION',
    aliases: ['SYSTEM_OPERATION', 'BACKUP_JOB', 'RESTORE_JOB', 'SYNC_JOB', 'IMPORT_JOB', 'EXPORT_JOB', 'OCR_JOB', 'SYSTEM_BACKUP'],
    displayName: 'System Operations, Backup & Cryptographic Integrity 360°',
    moduleId: 'master-data',
    moduleLabel: '16. Master Data & Administration',
    submoduleId: 'md-backup-vault',
    submoduleLabel: 'Database Vault & Disaster Recovery',
    presentationType: 'SYSTEM_OPERATIONS_360',
    rendererComponent: 'SystemOperations360View',
    headerConfig: {
      workspaceBadge: 'SYSTEM OPERATIONS 360° • CRYPTOGRAPHIC VAULT & TELEMETRY',
      accentColor: 'slate',
      bannerMode: 'SYSTEM_JOB_BANNER',
      primaryRefLabel: 'Job / Snapshot ID',
      showsAccountingWorkflowStepper: false,
    },
    summaryMetrics: [
      { key: 'sizeBytes', label: 'Snapshot / Payload Size', format: 'number', description: 'Encrypted archive byte size' },
      { key: 'checksum', label: 'SHA-256 Checksum', format: 'text', description: 'Cryptographic integrity digest' },
    ],
    mainInformationSections: [
      'Operation Identity, Initiator & Execution Timestamps',
      'SHA-256 Cryptographic Checksum & AES-256-GCM Envelope Verification',
      'Tenant Isolation Boundary & Disaster Recovery Readiness',
    ],
    applicableTabs: [
      { id: 'overview', label: '1. Operation & Integrity 360°' },
      { id: 'details', label: '2. Manifest & Technical Specs' },
      { id: 'activity', label: '3. Execution Audit Log', badgeKey: 'activity' },
    ],
    applicableHistorySections: ['Job Execution & Verification Log'],
    relatedRecordRelationships: [],
    availableActions: [],
    backendDataRequirements: ['system_backups', 'audit_logs'],
    permissionRequirements: {
      moduleId: 'master-data',
      viewPermissions: ['backups:view', 'backup:view', 'settings:view', 'audit:view'],
    },
    emptyAndErrorStates: {
      emptyPrimaryTitle: 'System Operation Record Not Found',
      emptyPrimaryMessage: 'The requested Backup, Restore, Sync, or Export job was not found.',
      emptyRelatedMessage: 'No dependent job artifacts linked.',
      errorFallbackMessage: 'Unable to load System Operations 360° telemetry.',
    },
  },
};

// Map additional specific canonical entity types to their authoritative definitions
export const ENTITY_TYPE_TO_REGISTRY_KEY: Record<string, string> = {
  SALES_INVOICE: 'SALES_INVOICE',
  SALES_INVOICES: 'SALES_INVOICE',
  INVOICE: 'SALES_INVOICE',
  PURCHASE_BILL: 'PURCHASE_BILL',
  PURCHASE_BILLS: 'PURCHASE_BILL',
  BILL: 'PURCHASE_BILL',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  PURCHASE_ORDERS: 'PURCHASE_ORDER',
  PO: 'PURCHASE_ORDER',
  GOODS_RECEIPT_NOTE: 'GOODS_RECEIPT_NOTE',
  GOODS_RECEIPT_NOTES: 'GOODS_RECEIPT_NOTE',
  GOODS_RECEIPT: 'GOODS_RECEIPT_NOTE',
  GOODS_RECEIPTS: 'GOODS_RECEIPT_NOTE',
  GRN: 'GOODS_RECEIPT_NOTE',
  JOURNAL_ENTRY: 'JOURNAL_ENTRY',
  JOURNAL_ENTRIES: 'JOURNAL_ENTRY',
  JOURNAL: 'JOURNAL_ENTRY',
  CUSTOMER_PAYMENT: 'CUSTOMER_PAYMENT',
  CUSTOMER_PAYMENTS: 'CUSTOMER_PAYMENT',
  PAYMENT: 'CUSTOMER_PAYMENT',
  PAYMENTS: 'CUSTOMER_PAYMENT',
  OFFICIAL_RECEIPT: 'CUSTOMER_PAYMENT',
  SUPPLIER_PAYMENT: 'SUPPLIER_PAYMENT',
  SUPPLIER_PAYMENTS: 'SUPPLIER_PAYMENT',
  BILL_PAYMENT: 'SUPPLIER_PAYMENT',
  BILL_PAYMENTS: 'SUPPLIER_PAYMENT',
  CREDIT_MEMO: 'CREDIT_MEMO',
  CREDIT_MEMOS: 'CREDIT_MEMO',
  DEBIT_MEMO: 'DEBIT_MEMO',
  DEBIT_MEMOS: 'DEBIT_MEMO',
  CASH_TRANSACTION: 'CASH_TRANSACTION',
  CASH_TRANSACTIONS: 'CASH_TRANSACTION',
  BANK_DEPOSIT: 'BANK_DEPOSIT',
  BANK_DEPOSITS: 'BANK_DEPOSIT',
  CUSTOMER: 'CUSTOMER',
  CUSTOMERS: 'CUSTOMER',
  VENDOR: 'VENDOR',
  VENDORS: 'VENDOR',
  SUPPLIER: 'VENDOR',
  SUPPLIERS: 'VENDOR',
  INVENTORY_ITEM: 'INVENTORY_ITEM',
  INVENTORY_ITEMS: 'INVENTORY_ITEM',
  ITEM: 'INVENTORY_ITEM',
  STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
  STOCK_ADJUSTMENTS: 'STOCK_ADJUSTMENT',
  PAYROLL_RUN: 'PAYROLL_RUN',
  PAYROLL_RUNS: 'PAYROLL_RUN',
  PAYROLL: 'PAYROLL_RUN',
  EMPLOYEE: 'EMPLOYEE',
  EMPLOYEES: 'EMPLOYEE',
  TAX_FILING: 'TAX_FILING',
  TAX_FILINGS: 'TAX_FILING',
  TAX_RETURN: 'TAX_FILING',
  TAX_RETURNS: 'TAX_FILING',
  BIR_FILING: 'TAX_FILING',
  TAX_CALCULATION: 'TAX_FILING',
  LEDGER_DATA_ENTRY: 'TAX_FILING',
  BANK_RECONCILIATION: 'BANK_RECONCILIATION',
  BANK_RECONCILIATIONS: 'BANK_RECONCILIATION',
  ACCOUNT: 'ACCOUNT',
  ACCOUNTS: 'ACCOUNT',
  FIXED_ASSET: 'FIXED_ASSET',
  FIXED_ASSETS: 'FIXED_ASSET',
  ASSET: 'FIXED_ASSET',
  DOCUMENT: 'DOCUMENT',
  DOCUMENTS: 'DOCUMENT',
  APPROVAL_WORKFLOW: 'APPROVAL_WORKFLOW',
  APPROVAL_WORKFLOWS: 'APPROVAL_WORKFLOW',
  BUDGET: 'APPROVAL_WORKFLOW',
  BUDGETS: 'APPROVAL_WORKFLOW',
  AUDIT_ENGAGEMENT: 'AUDIT_ENGAGEMENT',
  AUDIT_ENGAGEMENTS: 'AUDIT_ENGAGEMENT',
  AUDIT_WORKPAPER: 'AUDIT_ENGAGEMENT',
  AUDIT_WORKPAPERS: 'AUDIT_ENGAGEMENT',
  AUDIT_FINDING: 'AUDIT_ENGAGEMENT',
  AUDIT_FINDINGS: 'AUDIT_ENGAGEMENT',
  SYSTEM_OPERATION: 'SYSTEM_OPERATION',
  BACKUP_JOB: 'SYSTEM_OPERATION',
  RESTORE_JOB: 'SYSTEM_OPERATION',
  SYNC_JOB: 'SYSTEM_OPERATION',
  IMPORT_JOB: 'SYSTEM_OPERATION',
  EXPORT_JOB: 'SYSTEM_OPERATION',
  OCR_JOB: 'SYSTEM_OPERATION',
  SYSTEM_BACKUP: 'SYSTEM_OPERATION',
};

/**
 * Resolves the authoritative Entity360Definition for any entityType string.
 * Never returns undefined — falls back to a safe definition while preserving entity identity.
 */
export function getEntity360Definition(rawEntityType: string): Entity360Definition {
  const upper = String(rawEntityType || '').trim().toUpperCase();
  const mappedKey = ENTITY_TYPE_TO_REGISTRY_KEY[upper] || upper;
  if (ENTITY_360_REGISTRY[mappedKey]) {
    const base = ENTITY_360_REGISTRY[mappedKey];
    if (upper === 'BUDGET' || upper === 'BUDGETS') {
      return {
        ...base,
        entityType: 'BUDGET',
        displayName: 'Budget & Variance Control 360°',
        moduleId: 'budget',
        moduleLabel: '10. Budget & Financial Planning',
        submoduleId: 'bud-mgmt',
        submoduleLabel: 'Budget & Variance Planning',
        headerConfig: {
          ...base.headerConfig,
          workspaceBadge: 'FP&A BUDGET GOVERNANCE 360° • SPENDING LIMIT & VARIANCE',
          primaryRefLabel: 'Budget Category',
        },
      };
    }
    if (upper === 'AUDIT_WORKPAPER' || upper === 'AUDIT_WORKPAPERS') {
      return {
        ...base,
        entityType: 'AUDIT_WORKPAPER',
        displayName: 'PSA Audit Working Paper 360°',
        submoduleId: 'aud-workpapers',
        submoduleLabel: 'PSA Working Papers & Lead Sheets',
        headerConfig: {
          ...base.headerConfig,
          workspaceBadge: 'PSA WORKING PAPER 360° • LEAD SHEET & EVIDENCE',
          primaryRefLabel: 'Workpaper Ref',
        },
      };
    }
    if (upper === 'AUDIT_FINDING' || upper === 'AUDIT_FINDINGS') {
      return {
        ...base,
        entityType: 'AUDIT_FINDING',
        displayName: 'CPA Audit Finding & Remediation 360°',
        headerConfig: {
          ...base.headerConfig,
          workspaceBadge: 'AUDIT FINDING 360° • RISK & MANAGEMENT RESPONSE',
          primaryRefLabel: 'Finding Title',
        },
      };
    }
    return base;
  }
  return ENTITY_360_REGISTRY.JOURNAL_ENTRY;
}

/**
 * Returns the complete Entity 360 Coverage Matrix across all 12 specialized categories.
 */
export function getEntity360CoverageMatrix() {
  return Object.values(ENTITY_360_REGISTRY).map((def) => ({
    requirementId: def.requirementId,
    entityType: def.entityType,
    displayName: def.displayName,
    moduleId: def.moduleId,
    moduleLabel: def.moduleLabel,
    submoduleId: def.submoduleId,
    submoduleLabel: def.submoduleLabel,
    presentationType: def.presentationType,
    rendererComponent: def.rendererComponent,
    bannerMode: def.headerConfig.bannerMode,
    showsAccountingWorkflowStepper: def.headerConfig.showsAccountingWorkflowStepper,
    applicableTabIds: def.applicableTabs.map((t) => t.id),
    summaryMetricKeys: def.summaryMetrics.map((m) => m.key),
    mainSectionsCount: def.mainInformationSections.length,
    availableActions: def.availableActions,
  }));
}
