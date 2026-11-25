/**
 * LEDGERAI PH — SINGLE AUTHORITATIVE ROLE PERMISSIONS CATALOG
 *
 * This module is the SINGLE SOURCE OF TRUTH for:
 * 1. The 8 canonical enterprise roles and their default templates.
 * 2. All 16 primary ERP modules and canonical submodules default assignments per role.
 * 3. Resource & action-level permission definitions (view, create, edit, submit, review,
 *    approve, reject, return, post, reverse, cancel, archive, restore, export, delete, manage).
 * 4. Data scopes (COMPANY_WIDE, DEPARTMENT, PROJECT, COST_CENTER, OWN_RECORDS, ASSIGNED_RECORDS, EXPLICIT_RECORDS).
 * 5. PHP-denominated approval limits (stored in centavos; -1 = UNLIMITED, 0 = NO APPROVAL AUTHORITY).
 * 6. Segregation of Duties (SoD) and hard role security restrictions.
 */

export type CanonicalRoleName =
  | 'Company Owner'
  | 'Company Administrator'
  | 'Accountant'
  | 'Bookkeeper'
  | 'Approver'
  | 'Reviewer'
  | 'Auditor'
  | 'Tax & AP Specialist'
  | 'Read-only User';

export type CanonicalAction =
  | 'view'
  | 'create'
  | 'edit'
  | 'submit'
  | 'review'
  | 'approve'
  | 'reject'
  | 'return'
  | 'post'
  | 'reverse'
  | 'cancel'
  | 'archive'
  | 'restore'
  | 'verify'
  | 'cleanup'
  | 'export'
  | 'delete'
  | 'manage';

export type CanonicalDataScope =
  | 'COMPANY_WIDE'
  | 'DEPARTMENT'
  | 'PROJECT'
  | 'COST_CENTER'
  | 'OWN_RECORDS'
  | 'ASSIGNED_RECORDS'
  | 'EXPLICIT_RECORDS';

export type PermissionOrigin =
  | 'INHERITED_FROM_ROLE'
  | 'COMBINED_ROLES'
  | 'USER_SPECIFIC_GRANT'
  | 'USER_SPECIFIC_DENY'
  | 'SYSTEM_RESTRICTION'
  | 'SOD_RESTRICTION'
  | 'ACCOUNT_DISABLED';

export interface PermissionCatalogEntry {
  code: string;
  name: string;
  description: string;
  primaryModuleId: string;
  submoduleId: string;
  resource: string;
  action: CanonicalAction;
  allowedScopes: CanonicalDataScope[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  defaultRoles: CanonicalRoleName[];
  hardRestrictedRoles: CanonicalRoleName[]; // Roles that CANNOT be granted this permission even via user override
  sodRuleCode?: string;
}

export interface RoleModuleDefault {
  moduleId: string;
  submoduleIds: string[];
  allowedActions: CanonicalAction[];
  deniedActions: CanonicalAction[];
  defaultDataScope: CanonicalDataScope;
  defaultApprovalLimitCentavos: number; // -1 = Unlimited, 0 = None, >0 = PHP limit in centavos
  notes: string;
}

export interface RoleTemplateDefinition {
  roleCode: string;
  roleName: CanonicalRoleName | string;
  purpose: string;
  defaultVersion: number;
  defaultDataScope: CanonicalDataScope;
  defaultApprovalLimitCentavos: number; // -1 = Unlimited, 0 = None, >0 = PHP limit in centavos
  canApproveFinancialTransactions: boolean;
  canPostToGeneralLedger: boolean;
  isReadOnlyRole: boolean;
  defaultPrimaryModules: string[];
  defaultSubmodules: Record<string, string[]>;
  moduleDefaults: Record<string, RoleModuleDefault>;
  defaultPermissionCodes: string[];
  hardDeniedPermissionCodes: string[];
  hardRestrictedModuleIds: string[]; // Modules that cannot be granted to this role without changing role
  sodRestrictions: string[];
  financialAuthoritySummary: string;
  isCustom?: boolean;
  clonedFrom?: string | null;
  status?: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED';
}

export interface RoleCompatibilityRule {
  id: string;
  roleA: string;
  roleB: string;
  compatibilityType: 'ALLOWED' | 'RESTRICTED' | 'PROHIBITED';
  reason: string;
  conditionsJson?: string | null;
}

export const CANONICAL_ROLES_ORDER: CanonicalRoleName[] = [
  'Company Owner',
  'Company Administrator',
  'Accountant',
  'Bookkeeper',
  'Approver',
  'Reviewer',
  'Auditor',
  'Tax & AP Specialist',
  'Read-only User'
];

export const DATA_SCOPE_LABELS: Record<CanonicalDataScope, string> = {
  COMPANY_WIDE: 'Company-Wide (All Records)',
  DEPARTMENT: 'Department-Scoped',
  PROJECT: 'Project-Scoped',
  COST_CENTER: 'Cost Center-Scoped',
  OWN_RECORDS: 'Own Created / Prepared Records Only',
  ASSIGNED_RECORDS: 'Assigned Workflow / Review Queue Only',
  EXPLICIT_RECORDS: 'Explicitly Shared Records Only'
};

/**
 * Normalize legacy data scope strings ('COMPANY', 'OWN', etc.) into CanonicalDataScope
 */
export function normalizeDataScope(scope?: string | null): CanonicalDataScope {
  const s = (scope || '').trim().toUpperCase();
  if (s === 'COMPANY' || s === 'COMPANY_WIDE' || s === 'ALL') return 'COMPANY_WIDE';
  if (s === 'DEPARTMENT' || s === 'DEPT') return 'DEPARTMENT';
  if (s === 'PROJECT') return 'PROJECT';
  if (s === 'COST_CENTER') return 'COST_CENTER';
  if (s === 'OWN' || s === 'OWN_RECORDS') return 'OWN_RECORDS';
  if (s === 'ASSIGNED' || s === 'ASSIGNED_RECORDS') return 'ASSIGNED_RECORDS';
  if (s === 'EXPLICIT' || s === 'EXPLICIT_RECORDS') return 'EXPLICIT_RECORDS';
  return 'COMPANY_WIDE';
}

/**
 * Canonical Permission Registry across all 16 Primary ERP Modules
 */
export const CANONICAL_PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  // 1. DASHBOARD
  {
    code: 'dashboard:view',
    name: 'View Executive & Financial Dashboard',
    description: 'View KPI cards, financial ratios, and role-scoped dashboard metrics.',
    primaryModuleId: 'dashboard',
    submoduleId: 'dash-overview',
    resource: 'DASHBOARD',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS', 'ASSIGNED_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Company Administrator', 'Accountant', 'Bookkeeper', 'Approver', 'Reviewer', 'Auditor', 'Read-only User'],
    hardRestrictedRoles: []
  },
  {
    code: 'dashboard:export',
    name: 'Export Dashboard Summary',
    description: 'Export executive overview charts and KPI snapshots.',
    primaryModuleId: 'dashboard',
    submoduleId: 'dash-overview',
    resource: 'DASHBOARD',
    action: 'export',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Company Administrator', 'Accountant', 'Auditor'],
    hardRestrictedRoles: ['Read-only User']
  },

  // 2. SALES & RECEIVABLES
  {
    code: 'sales:view',
    name: 'View Sales Invoices & AR Subledger',
    description: 'View sales invoices, credit memos, customer collections, official receipts, and AR aging.',
    primaryModuleId: 'sales',
    submoduleId: 'sales-invoices',
    resource: 'SALES_INVOICE',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS', 'ASSIGNED_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper', 'Approver', 'Reviewer', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'sales:create',
    name: 'Create Draft Sales Invoices & Collections',
    description: 'Prepare draft sales invoices, credit memos, and customer collection receipts.',
    primaryModuleId: 'sales',
    submoduleId: 'sales-invoices',
    resource: 'SALES_INVOICE',
    action: 'create',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'sales:edit',
    name: 'Edit Draft / Returned Sales Invoices',
    description: 'Modify unposted draft or returned sales invoices and collection records.',
    primaryModuleId: 'sales',
    submoduleId: 'sales-invoices',
    resource: 'SALES_INVOICE',
    action: 'edit',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'sales:submit',
    name: 'Submit Sales Transactions for Review/Approval',
    description: 'Submit prepared sales invoices or credit memos into the approval workflow.',
    primaryModuleId: 'sales',
    submoduleId: 'sales-invoices',
    resource: 'SALES_INVOICE',
    action: 'submit',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'sales:review',
    name: 'Review Submitted Sales Invoices',
    description: 'Perform completeness and tax coding review on submitted sales transactions.',
    primaryModuleId: 'sales',
    submoduleId: 'sales-invoices',
    resource: 'SALES_INVOICE',
    action: 'review',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'ASSIGNED_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Reviewer'],
    hardRestrictedRoles: ['Bookkeeper', 'Auditor', 'Read-only User']
  },
  {
    code: 'sales:approve',
    name: 'Approve Sales Invoices & Credit Memos',
    description: 'Authorize submitted sales invoices and credit memos within monetary limit and SoD rules.',
    primaryModuleId: 'sales',
    submoduleId: 'sales-invoices',
    resource: 'SALES_INVOICE',
    action: 'approve',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'ASSIGNED_RECORDS'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Approver'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Auditor', 'Read-only User', 'Company Administrator'],
    sodRuleCode: 'SOD_SALES_CREATOR_APPROVER'
  },
  {
    code: 'sales:post',
    name: 'Post Approved Sales Invoices to GL',
    description: 'Post approved sales invoices and official receipts to the General Ledger.',
    primaryModuleId: 'sales',
    submoduleId: 'sales-invoices',
    resource: 'SALES_INVOICE',
    action: 'post',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Accountant'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Approver', 'Auditor', 'Read-only User', 'Company Administrator']
  },
  {
    code: 'sales:cancel',
    name: 'Cancel / Void Unposted Sales Documents',
    description: 'Cancel draft or unposted sales documents with mandatory reason.',
    primaryModuleId: 'sales',
    submoduleId: 'sales-invoices',
    resource: 'SALES_INVOICE',
    action: 'cancel',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Accountant'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Auditor', 'Read-only User']
  },
  {
    code: 'sales:delete',
    name: 'Controlled Delete Draft Sales Records',
    description: 'Soft-delete eligible draft sales records with mandatory audit trail.',
    primaryModuleId: 'sales',
    submoduleId: 'sales-invoices',
    resource: 'SALES_INVOICE',
    action: 'delete',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Approver', 'Auditor', 'Read-only User', 'Company Administrator']
  },

  // 3. PROCUREMENT & PAYABLES
  {
    code: 'purchases:view',
    name: 'View Purchase Orders, Bills & AP Subledger',
    description: 'View 3-way match purchase orders, vendor bills, debit memos, and AP disbursements.',
    primaryModuleId: 'procurement',
    submoduleId: 'proc-bills',
    resource: 'PURCHASE_BILL',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS', 'ASSIGNED_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper', 'Approver', 'Reviewer', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'purchases:create',
    name: 'Create Draft Purchase Bills & POs',
    description: 'Prepare draft purchase orders, receiving notes, vendor bills, and payment vouchers.',
    primaryModuleId: 'procurement',
    submoduleId: 'proc-bills',
    resource: 'PURCHASE_BILL',
    action: 'create',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'purchases:edit',
    name: 'Edit Draft / Returned Purchase Bills',
    description: 'Update unposted draft or returned vendor bills and purchase orders.',
    primaryModuleId: 'procurement',
    submoduleId: 'proc-bills',
    resource: 'PURCHASE_BILL',
    action: 'edit',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'purchases:submit',
    name: 'Submit Purchase Bills for Approval',
    description: 'Submit vendor bills and disbursement vouchers into the approval workflow.',
    primaryModuleId: 'procurement',
    submoduleId: 'proc-bills',
    resource: 'PURCHASE_BILL',
    action: 'submit',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'purchases:review',
    name: 'Review Submitted Purchase Bills & 3-Way Match',
    description: 'Verify vendor bills against PO, GRN, and input VAT/EWT coding.',
    primaryModuleId: 'procurement',
    submoduleId: 'proc-matching',
    resource: 'PURCHASE_BILL',
    action: 'review',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'ASSIGNED_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Reviewer'],
    hardRestrictedRoles: ['Bookkeeper', 'Auditor', 'Read-only User']
  },
  {
    code: 'purchases:approve',
    name: 'Approve Purchase Orders, Bills & Disbursements',
    description: 'Approve submitted vendor bills and payment vouchers within PHP approval limit and SoD.',
    primaryModuleId: 'procurement',
    submoduleId: 'proc-bills',
    resource: 'PURCHASE_BILL',
    action: 'approve',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'ASSIGNED_RECORDS'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Approver'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Auditor', 'Read-only User', 'Company Administrator'],
    sodRuleCode: 'SOD_AP_CREATOR_APPROVER'
  },
  {
    code: 'purchases:post',
    name: 'Post Approved Purchase Bills & Disbursements to GL',
    description: 'Post approved vendor bills and AP disbursements to the General Ledger.',
    primaryModuleId: 'procurement',
    submoduleId: 'proc-bills',
    resource: 'PURCHASE_BILL',
    action: 'post',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Accountant'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Approver', 'Auditor', 'Read-only User', 'Company Administrator']
  },
  {
    code: 'purchases:cancel',
    name: 'Cancel Unposted Purchase Bills / POs',
    description: 'Cancel unposted purchase orders or bills with mandatory reason.',
    primaryModuleId: 'procurement',
    submoduleId: 'proc-bills',
    resource: 'PURCHASE_BILL',
    action: 'cancel',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Accountant'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Auditor', 'Read-only User']
  },
  {
    code: 'purchases:delete',
    name: 'Controlled Delete Draft Purchase Records',
    description: 'Soft-delete eligible draft purchase records with audit trail.',
    primaryModuleId: 'procurement',
    submoduleId: 'proc-bills',
    resource: 'PURCHASE_BILL',
    action: 'delete',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Approver', 'Auditor', 'Read-only User', 'Company Administrator']
  },

  // 4. INVENTORY & WAREHOUSE
  {
    code: 'inventory:view',
    name: 'View Inventory Catalog & Stock Valuation',
    description: 'View item catalog, FIFO/Weighted Average valuation, and stock movement ledger.',
    primaryModuleId: 'inventory',
    submoduleId: 'inv-movements',
    resource: 'INVENTORY',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'inventory:create',
    name: 'Create Inventory Items & Stock Receipts',
    description: 'Create inventory items and record draft stock movements.',
    primaryModuleId: 'inventory',
    submoduleId: 'inv-movements',
    resource: 'INVENTORY',
    action: 'create',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'inventory:edit',
    name: 'Adjust Inventory Quantities & Valuation',
    description: 'Modify item master details and draft stock count adjustments.',
    primaryModuleId: 'inventory',
    submoduleId: 'inv-movements',
    resource: 'INVENTORY',
    action: 'edit',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },

  // 5. CASH & BANKING
  {
    code: 'cash:view',
    name: 'View Cash & Check Management',
    description: 'View petty cash custody, check register, and cash transactions.',
    primaryModuleId: 'cash-banking',
    submoduleId: 'cash-mgmt',
    resource: 'CASH_BANKING',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper', 'Approver', 'Reviewer', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'bank_rec:view',
    name: 'View Bank Reconciliations',
    description: 'View bank accounts, statements, and bank reconciliation workspaces.',
    primaryModuleId: 'cash-banking',
    submoduleId: 'bank-recon',
    resource: 'CASH_BANKING',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper', 'Approver', 'Reviewer', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'bank_rec:create',
    name: 'Create Draft Cash Entries & Bank Reconciliations',
    description: 'Prepare petty cash vouchers, bank deposits, check entries, and draft bank reconciliations.',
    primaryModuleId: 'cash-banking',
    submoduleId: 'cash-mgmt',
    resource: 'CASH_BANKING',
    action: 'create',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'bank_rec:edit',
    name: 'Edit Draft Cash Entries & Reconciliations',
    description: 'Update unposted cash entries and in-progress bank reconciliations.',
    primaryModuleId: 'cash-banking',
    submoduleId: 'bank-recon',
    resource: 'CASH_BANKING',
    action: 'edit',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'bank_rec:approve',
    name: 'Approve Bank Reconciliations & Cash Transfers',
    description: 'Authorize completed bank reconciliation statements and inter-bank transfers.',
    primaryModuleId: 'cash-banking',
    submoduleId: 'bank-recon',
    resource: 'CASH_BANKING',
    action: 'approve',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Approver'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Auditor', 'Read-only User', 'Company Administrator'],
    sodRuleCode: 'SOD_BANK_REC_PREPARER_APPROVER'
  },

  // 6. ACCOUNTING & GENERAL LEDGER
  {
    code: 'accounting:view',
    name: 'View Chart of Accounts, General Journal & Trial Balance',
    description: 'Inspect Chart of Accounts, Journal Entries, General Ledger, Trial Balance, and Accounting Periods.',
    primaryModuleId: 'accounting',
    submoduleId: 'acct-journals',
    resource: 'JOURNAL_ENTRY',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS', 'ASSIGNED_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Accountant', 'Approver', 'Reviewer', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'accounting:create',
    name: 'Create Draft Journal Entries',
    description: 'Create balanced draft manual journal entries and adjusting entries.',
    primaryModuleId: 'accounting',
    submoduleId: 'acct-journals',
    resource: 'JOURNAL_ENTRY',
    action: 'create',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver', 'Bookkeeper']
  },
  {
    code: 'accounting:edit',
    name: 'Edit Draft / Returned Journal Entries & COA',
    description: 'Edit unposted draft or returned journal entries and update Chart of Accounts.',
    primaryModuleId: 'accounting',
    submoduleId: 'acct-journals',
    resource: 'JOURNAL_ENTRY',
    action: 'edit',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver', 'Bookkeeper']
  },
  {
    code: 'accounting:submit',
    name: 'Submit Journal Entries for Review/Approval',
    description: 'Submit balanced draft journal entries into the review and approval workflow.',
    primaryModuleId: 'accounting',
    submoduleId: 'acct-journals',
    resource: 'JOURNAL_ENTRY',
    action: 'submit',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Accountant'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver', 'Bookkeeper']
  },
  {
    code: 'accounting:review',
    name: 'Review Submitted Journal Entries',
    description: 'Examine submitted journal entries, add review notes, or return for correction.',
    primaryModuleId: 'accounting',
    submoduleId: 'acct-journals',
    resource: 'JOURNAL_ENTRY',
    action: 'review',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'ASSIGNED_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Reviewer'],
    hardRestrictedRoles: ['Bookkeeper', 'Auditor', 'Read-only User']
  },
  {
    code: 'accounting:approve',
    name: 'Approve Submitted Journal Entries',
    description: 'Approve submitted journal entries within PHP approval limit and SoD rules.',
    primaryModuleId: 'accounting',
    submoduleId: 'acct-journals',
    resource: 'JOURNAL_ENTRY',
    action: 'approve',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'ASSIGNED_RECORDS'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Approver'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Auditor', 'Read-only User', 'Company Administrator'],
    sodRuleCode: 'SOD_JOURNAL_CREATOR_APPROVER'
  },
  {
    code: 'accounting:post',
    name: 'Post Approved Journal Entries to General Ledger',
    description: 'Finalize and post eligible approved journal entries into the immutable General Ledger.',
    primaryModuleId: 'accounting',
    submoduleId: 'acct-journals',
    resource: 'JOURNAL_ENTRY',
    action: 'post',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner', 'Accountant'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Approver', 'Auditor', 'Read-only User', 'Company Administrator'],
    sodRuleCode: 'SOD_JOURNAL_CREATOR_POSTER'
  },
  {
    code: 'accounting:reverse',
    name: 'Prepare / Execute Reversing Journal Entries',
    description: 'Initiate formal accounting reversal for posted journal entries (preserving audit lineage).',
    primaryModuleId: 'accounting',
    submoduleId: 'acct-journals',
    resource: 'JOURNAL_ENTRY',
    action: 'reverse',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Accountant'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Auditor', 'Read-only User', 'Company Administrator']
  },
  {
    code: 'accounting:delete',
    name: 'Delete Unposted Draft Journal Entries',
    description: 'Controlled deletion of unposted draft journal entries (posted entries are immutable).',
    primaryModuleId: 'accounting',
    submoduleId: 'acct-journals',
    resource: 'JOURNAL_ENTRY',
    action: 'delete',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Approver', 'Auditor', 'Read-only User', 'Company Administrator', 'Accountant']
  },
  {
    code: 'periods:close',
    name: 'Soft-Close / Hard-Close Accounting Periods',
    description: 'Execute month-end soft close or year-end hard close on fiscal periods.',
    primaryModuleId: 'accounting',
    submoduleId: 'acct-periods',
    resource: 'ACCOUNTING_PERIOD',
    action: 'manage',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Approver', 'Auditor', 'Read-only User', 'Company Administrator']
  },
  {
    code: 'periods:reopen',
    name: 'Reopen Closed Accounting Periods',
    description: 'Reopen soft-closed accounting periods with mandatory executive justification.',
    primaryModuleId: 'accounting',
    submoduleId: 'acct-periods',
    resource: 'ACCOUNTING_PERIOD',
    action: 'restore',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner'],
    hardRestrictedRoles: ['Bookkeeper', 'Accountant', 'Reviewer', 'Approver', 'Auditor', 'Read-only User', 'Company Administrator']
  },

  // 7. FIXED ASSETS
  {
    code: 'fixedassets:view',
    name: 'View Fixed Asset & Depreciation Register',
    description: 'View capitalized fixed assets, accumulated depreciation, and net book values.',
    primaryModuleId: 'fixed-assets',
    submoduleId: 'fa-register',
    resource: 'FIXED_ASSET',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'fixed_assets:manage',
    name: 'Capitalize, Depreciate & Dispose Fixed Assets',
    description: 'Register fixed assets, run monthly depreciation schedules, and record disposals.',
    primaryModuleId: 'fixed-assets',
    submoduleId: 'fa-register',
    resource: 'FIXED_ASSET',
    action: 'manage',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver', 'Bookkeeper']
  },

  // 8. PAYROLL & HUMAN RESOURCES
  {
    code: 'payroll:view',
    name: 'View Payroll Register & Statutory Compensation',
    description: 'View employee compensation runs, SSS/PhilHealth/Pag-IBIG tables, and 1601-C withholding.',
    primaryModuleId: 'payroll',
    submoduleId: 'pay-records',
    resource: 'PAYROLL',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'payroll:manage',
    name: 'Process Payroll Runs & Employee Compensation',
    description: 'Create and compute payroll runs, statutory deductions, and payroll disbursements.',
    primaryModuleId: 'payroll',
    submoduleId: 'pay-records',
    resource: 'PAYROLL',
    action: 'manage',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver', 'Bookkeeper']
  },

  // 9. TAX & BIR COMPLIANCE
  {
    code: 'tax:view',
    name: 'View Tax Returns, Schedules & Ledger Data Entry',
    description: 'View BIR statutory forms (2550Q, 1601-EQ, 0619-E, 2307), VAT/EWT schedules, and Ledger Data Entry.',
    primaryModuleId: 'tax',
    submoduleId: 'tax-engine',
    resource: 'TAX_RETURN',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Accountant', 'Reviewer', 'Approver', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'tax:create',
    name: 'Prepare Tax Worksheets & Ledger Data Entry Drafts',
    description: 'Generate draft BIR tax returns, QAP/MAP/SAWT/SLSP schedules, and Ledger Data Entry drafts.',
    primaryModuleId: 'tax',
    submoduleId: 'tax-data-entry',
    resource: 'TAX_RETURN',
    action: 'create',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant'],
    hardRestrictedRoles: ['Bookkeeper', 'Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'tax:edit',
    name: 'Edit Draft Tax Schedules & BIR Account Mapping',
    description: 'Update unfinalized tax schedules, ATC mappings, and Ledger Data Entry drafts.',
    primaryModuleId: 'tax',
    submoduleId: 'tax-returns',
    resource: 'TAX_RETURN',
    action: 'edit',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Accountant'],
    hardRestrictedRoles: ['Bookkeeper', 'Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'tax:approve',
    name: 'Approve & Finalize Official BIR Tax Filings',
    description: 'Authorize and lock official BIR tax returns and statutory DAT exports.',
    primaryModuleId: 'tax',
    submoduleId: 'tax-engine',
    resource: 'TAX_RETURN',
    action: 'approve',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner', 'Approver'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Auditor', 'Read-only User', 'Company Administrator'],
    sodRuleCode: 'SOD_TAX_PREPARER_APPROVER'
  },
  {
    code: 'tax:export',
    name: 'Export BIR DAT / QAP / SAWT / SLSP Compliance Files',
    description: 'Export validated BIR compliance files and official tax forms.',
    primaryModuleId: 'tax',
    submoduleId: 'tax-data-entry',
    resource: 'TAX_RETURN',
    action: 'export',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Auditor'],
    hardRestrictedRoles: ['Bookkeeper', 'Read-only User']
  },

  // 10. BUDGET & FINANCIAL PLANNING
  {
    code: 'budget:view',
    name: 'View Budgets & Variance Analysis',
    description: 'View annual/monthly departmental budgets and actual-vs-budget variance reports.',
    primaryModuleId: 'budget',
    submoduleId: 'bud-mgmt',
    resource: 'BUDGET',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'PROJECT', 'COST_CENTER'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'budget:create',
    name: 'Create & Edit Budget Proposals',
    description: 'Prepare departmental or project budget proposals.',
    primaryModuleId: 'budget',
    submoduleId: 'bud-mgmt',
    resource: 'BUDGET',
    action: 'create',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Bookkeeper']
  },
  {
    code: 'budget:approve',
    name: 'Approve Official Budgets',
    description: 'Approve and lock departmental and corporate budgets.',
    primaryModuleId: 'budget',
    submoduleId: 'bud-mgmt',
    resource: 'BUDGET',
    action: 'approve',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Approver'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Auditor', 'Read-only User', 'Company Administrator']
  },

  // 11. DOCUMENTS & OCR
  {
    code: 'documents:view',
    name: 'View Source Documents & OCR Evidence',
    description: 'View uploaded source receipts, invoices, contracts, and OCR extraction metadata.',
    primaryModuleId: 'documents',
    submoduleId: 'doc-inbox',
    resource: 'DOCUMENT',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS', 'ASSIGNED_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper', 'Approver', 'Reviewer', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'documents:create',
    name: 'Upload Documents & Run OCR Extraction',
    description: 'Upload supporting source documents and run offline/AI OCR extraction.',
    primaryModuleId: 'documents',
    submoduleId: 'doc-inbox',
    resource: 'DOCUMENT',
    action: 'create',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'documents:edit',
    name: 'Edit Document Metadata & Linkages',
    description: 'Update OCR extracted fields and link documents to draft transactions.',
    primaryModuleId: 'documents',
    submoduleId: 'doc-inbox',
    resource: 'DOCUMENT',
    action: 'edit',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Bookkeeper'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'documents:verify',
    name: 'Verify & Lock Source Document Evidence',
    description: 'Mark OCR-extracted source documents as verified accounting evidence.',
    primaryModuleId: 'documents',
    submoduleId: 'doc-inbox',
    resource: 'DOCUMENT',
    action: 'review',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'ASSIGNED_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Reviewer', 'Approver'],
    hardRestrictedRoles: ['Bookkeeper', 'Auditor', 'Read-only User']
  },
  {
    code: 'documents:delete',
    name: 'Controlled Remove / Archive Unlinked Documents',
    description: 'Soft-delete or archive unlinked draft documents with mandatory audit trail.',
    primaryModuleId: 'documents',
    submoduleId: 'doc-inbox',
    resource: 'DOCUMENT',
    action: 'delete',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Approver', 'Auditor', 'Read-only User']
  },

  // 12. REPORTS & ANALYTICS
  {
    code: 'reports:view',
    name: 'View Financial Statements & Management Reports',
    description: 'View Balance Sheet, Income Statement, Cash Flow, Trial Balance, and Aging reports.',
    primaryModuleId: 'reports',
    submoduleId: 'rep-statements',
    resource: 'FINANCIAL_REPORT',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Accountant', 'Auditor', 'Read-only User'],
    hardRestrictedRoles: []
  },
  {
    code: 'reports:export',
    name: 'Export Financial Statements (PDF / CSV / Excel)',
    description: 'Export official financial statements and analytical schedules.',
    primaryModuleId: 'reports',
    submoduleId: 'rep-statements',
    resource: 'FINANCIAL_REPORT',
    action: 'export',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Accountant', 'Auditor'],
    hardRestrictedRoles: ['Bookkeeper', 'Read-only User']
  },

  // 13. APPROVALS & WORKFLOW
  {
    code: 'approvals:view',
    name: 'View Approval & Review Inbox',
    description: 'Access the Approval & Review Inbox to inspect assigned workflow items and history.',
    primaryModuleId: 'approvals',
    submoduleId: 'appr-inbox',
    resource: 'APPROVAL_WORKFLOW',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'ASSIGNED_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Approver', 'Reviewer'],
    hardRestrictedRoles: []
  },
  {
    code: 'approvals:review',
    name: 'Perform Pre-Approval Review & Return for Correction',
    description: 'Review submitted records, add review remarks, mark reviewed, or return for correction.',
    primaryModuleId: 'approvals',
    submoduleId: 'appr-inbox',
    resource: 'APPROVAL_WORKFLOW',
    action: 'review',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'ASSIGNED_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Reviewer', 'Accountant'],
    hardRestrictedRoles: ['Bookkeeper', 'Auditor', 'Read-only User']
  },
  {
    code: 'approvals:approve',
    name: 'Execute Final Approval / Rejection Decision',
    description: 'Approve, reject, or return submitted workflow transactions within PHP approval limits.',
    primaryModuleId: 'approvals',
    submoduleId: 'appr-inbox',
    resource: 'APPROVAL_WORKFLOW',
    action: 'approve',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'ASSIGNED_RECORDS'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Approver'],
    hardRestrictedRoles: ['Bookkeeper', 'Reviewer', 'Auditor', 'Read-only User', 'Company Administrator'],
    sodRuleCode: 'SOD_WORKFLOW_PREPARER_APPROVER'
  },

  // 14. ACTIVITY CENTER
  {
    code: 'activity:view',
    name: 'View Enterprise Activity Center & Notifications',
    description: 'Inspect global activity stream, record lifecycle journeys, and workflow notifications.',
    primaryModuleId: 'activity-center',
    submoduleId: 'act-stream',
    resource: 'ACTIVITY_STREAM',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Company Administrator', 'Auditor'],
    hardRestrictedRoles: []
  },

  // 15. AUDIT & GOVERNANCE
  {
    code: 'audit:view',
    name: 'Inspect Immutable Audit Trail & Forensic Logs',
    description: 'Inspect immutable audit logs, before/after field comparisons, PSA working papers, and hash chain.',
    primaryModuleId: 'audit',
    submoduleId: 'aud-trail',
    resource: 'AUDIT_LOG',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Auditor'],
    hardRestrictedRoles: ['Bookkeeper', 'Read-only User']
  },
  {
    code: 'audit:export',
    name: 'Export Audit Evidence & Compliance Logs',
    description: 'Export tamper-evident audit trail packages and forensic verification reports.',
    primaryModuleId: 'audit',
    submoduleId: 'aud-trail',
    resource: 'AUDIT_LOG',
    action: 'export',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Auditor'],
    hardRestrictedRoles: ['Bookkeeper', 'Read-only User']
  },

  // 16. MASTER DATA & ADMINISTRATION
  {
    code: 'masterdata:view',
    name: 'View Master Data & Administration Workspace',
    description: 'Access Master Data & Administration primary module and assigned registries.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-customers',
    resource: 'MASTER_DATA',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Read-only User']
  },
  {
    code: 'customers:view',
    name: 'View Customer Master Registry',
    description: 'View customer profiles, TINs, billing terms, and credit limits.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-customers',
    resource: 'CUSTOMER_MASTER',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Company Administrator', 'Accountant', 'Bookkeeper', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'customers:create',
    name: 'Create Customer Master Records',
    description: 'Add new customer records to the Customer Master Registry.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-customers',
    resource: 'CUSTOMER_MASTER',
    action: 'create',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'customers:edit',
    name: 'Edit Customer Master Records',
    description: 'Update customer master details, credit limits, and tax classifications.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-customers',
    resource: 'CUSTOMER_MASTER',
    action: 'edit',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'vendors:view',
    name: 'View Vendor & Supplier Registry',
    description: 'View vendor profiles, TINs, ATC defaults, and payment terms.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-vendors',
    resource: 'VENDOR_MASTER',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Company Administrator', 'Accountant', 'Bookkeeper', 'Auditor'],
    hardRestrictedRoles: []
  },
  {
    code: 'vendors:create',
    name: 'Create Vendor & Supplier Records',
    description: 'Add new suppliers to the Vendor Master Registry.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-vendors',
    resource: 'VENDOR_MASTER',
    action: 'create',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'vendors:edit',
    name: 'Edit Vendor & Supplier Records',
    description: 'Update supplier TINs, withholding tax applicability, and payable accounts.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-vendors',
    resource: 'VENDOR_MASTER',
    action: 'edit',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Auditor', 'Read-only User', 'Reviewer', 'Approver']
  },
  {
    code: 'users:view',
    name: 'View Company Users & Role Assignments',
    description: 'View company user members, statuses, and assigned roles.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-roles',
    resource: 'USER_ADMIN',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Company Administrator', 'Auditor'],
    hardRestrictedRoles: ['Bookkeeper', 'Read-only User']
  },
  {
    code: 'users:manage',
    name: 'Create, Update, Activate & Disable Company Users',
    description: 'Provision user accounts, update statuses, and assign non-Owner roles.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-roles',
    resource: 'USER_ADMIN',
    action: 'manage',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Bookkeeper', 'Accountant', 'Reviewer', 'Approver', 'Auditor', 'Read-only User']
  },
  {
    code: 'roles:manage',
    name: 'Manage RBAC Catalog, Role Templates & Overrides',
    description: 'Edit Role Permissions Catalog templates, publish versions, and manage user module overrides.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-roles',
    resource: 'RBAC_GOVERNANCE',
    action: 'manage',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Bookkeeper', 'Accountant', 'Reviewer', 'Approver', 'Auditor', 'Read-only User']
  },
  {
    code: 'settings:view',
    name: 'View Enterprise Profile & System Settings',
    description: 'View company profile, database vault status, and LAN configuration.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-settings',
    resource: 'SYSTEM_SETTINGS',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Bookkeeper', 'Read-only User']
  },
  {
    code: 'settings:manage',
    name: 'Manage Enterprise Profile & System Settings',
    description: 'Configure company profile, organizational dimensions, LAN sync, and system preferences.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-settings',
    resource: 'SYSTEM_SETTINGS',
    action: 'manage',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Bookkeeper', 'Accountant', 'Reviewer', 'Approver', 'Auditor', 'Read-only User']
  },
  {
    code: 'backup:manage',
    name: 'Manage Database Vault, Backups & Disaster Recovery',
    description: 'Full administrative control over encrypted .lai backups, snapshot verification, storage cleanup, and controlled restores.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-backup-vault',
    resource: 'DATABASE_VAULT',
    action: 'manage',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Bookkeeper', 'Accountant', 'Reviewer', 'Approver', 'Auditor', 'Read-only User']
  },
  {
    code: 'backups:view',
    name: 'View Backup Vault & Archives',
    description: 'View backup archive inventory and metadata without creating, restoring, or deleting backups.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-backup-vault',
    resource: 'DATABASE_VAULT',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Read-only User']
  },
  {
    code: 'backups:create',
    name: 'Create Encrypted Backup Archives',
    description: 'Create new encrypted atomic .lai backup snapshots for the active company.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-backup-vault',
    resource: 'DATABASE_VAULT',
    action: 'create',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Auditor', 'Read-only User']
  },
  {
    code: 'backups:verify',
    name: 'Verify Backup & Snapshot Integrity',
    description: 'Execute read-only cryptographic and SQLite PRAGMA integrity verification on encrypted .lai snapshots.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-backup-vault',
    resource: 'DATABASE_VAULT',
    action: 'verify',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Read-only User']
  },
  {
    code: 'backups:restore',
    name: 'Restore Encrypted Backup Archives',
    description: 'Execute controlled atomic database restoration from a verified backup archive.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-backup-vault',
    resource: 'DATABASE_VAULT',
    action: 'restore',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Auditor', 'Read-only User']
  },
  {
    code: 'backups:download',
    name: 'Download Backup Archives',
    description: 'Download authorized encrypted backup archives.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-backup-vault',
    resource: 'DATABASE_VAULT',
    action: 'export',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Read-only User']
  },
  {
    code: 'storage:view',
    name: 'View .lai Storage Monitor & File Inventory',
    description: 'Scan and inspect .lai storage files for the active company without deleting or purging files.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-backup-vault',
    resource: 'STORAGE_MONITOR',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Read-only User']
  },
  {
    code: 'storage:cleanup',
    name: 'Clean Up Unused .lai Storage Files',
    description: 'Delete or purge unused, orphaned, or temporary .lai storage files within the active company workspace.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-backup-vault',
    resource: 'STORAGE_MONITOR',
    action: 'delete',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Auditor', 'Read-only User']
  },
  {
    code: 'storage:manage',
    name: 'Manage .lai Storage & Cleanup Operations',
    description: 'Full control over .lai storage scanning and cleanup operations for the active company.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-backup-vault',
    resource: 'STORAGE_MONITOR',
    action: 'manage',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'HIGH',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Auditor', 'Read-only User']
  },
  {
    code: 'lan:view',
    name: 'View Multi-Workstation LAN Server & Active Sessions',
    description: 'View local LAN server network interfaces, hostname resolution, and connected workstation sessions without terminating sessions or locking records.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-lan-network',
    resource: 'LAN_CLUSTER',
    action: 'view',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'LOW',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Bookkeeper', 'Read-only User']
  },
  {
    code: 'lan:lock',
    name: 'Acquire Optimistic Concurrency Record Locks',
    description: 'Acquire and refresh exclusive editing locks on company records across multi-workstation LAN sessions.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-lan-network',
    resource: 'LAN_CLUSTER',
    action: 'edit',
    allowedScopes: ['COMPANY_WIDE', 'DEPARTMENT', 'OWN_RECORDS'],
    riskLevel: 'MEDIUM',
    defaultRoles: ['Company Owner', 'Company Administrator', 'Accountant', 'Bookkeeper'],
    hardRestrictedRoles: ['Auditor', 'Read-only User']
  },
  {
    code: 'lan:sessions:terminate',
    name: 'Terminate Connected LAN Workstation Sessions',
    description: 'Forcibly terminate active LAN workstation sessions within the active company.',
    primaryModuleId: 'master-data',
    submoduleId: 'md-lan-network',
    resource: 'LAN_CLUSTER',
    action: 'manage',
    allowedScopes: ['COMPANY_WIDE'],
    riskLevel: 'CRITICAL',
    defaultRoles: ['Company Owner', 'Company Administrator'],
    hardRestrictedRoles: ['Bookkeeper', 'Accountant', 'Reviewer', 'Approver', 'Auditor', 'Read-only User']
  }
];

/**
 * PHASE 2 — COMPLETE ROLE DEFINITIONS FOR ALL 8 STANDARD ROLES
 * Single Authoritative Catalog of Default Role Templates.
 */
export const ROLE_TEMPLATES_CATALOG: Record<CanonicalRoleName, RoleTemplateDefinition> = {
  'Company Owner': {
    roleCode: 'COMPANY_OWNER',
    roleName: 'Company Owner',
    purpose: 'Full executive, governance, financial, compliance, and administrative ownership of the company tenant.',
    defaultVersion: 1,
    defaultDataScope: 'COMPANY_WIDE',
    defaultApprovalLimitCentavos: -1, // Unlimited
    canApproveFinancialTransactions: true,
    canPostToGeneralLedger: true,
    isReadOnlyRole: false,
    defaultPrimaryModules: [
      'dashboard', 'sales', 'procurement', 'inventory', 'cash-banking', 'accounting',
      'fixed-assets', 'payroll', 'tax', 'budget', 'documents', 'reports',
      'approvals', 'activity-center', 'audit', 'master-data'
    ],
    defaultSubmodules: {
      'dashboard': ['dash-overview'],
      'sales': ['sales-invoices'],
      'procurement': ['proc-matching', 'proc-bills'],
      'inventory': ['inv-movements'],
      'cash-banking': ['cash-mgmt', 'bank-recon'],
      'accounting': ['acct-coa', 'acct-journals', 'acct-tb', 'acct-periods', 'acct-forex'],
      'fixed-assets': ['fa-register'],
      'payroll': ['pay-records'],
      'tax': ['tax-engine', 'tax-schedules', 'tax-data-entry', 'tax-returns', 'tax-2307'],
      'budget': ['bud-mgmt'],
      'documents': ['doc-inbox'],
      'reports': ['rep-statements'],
      'approvals': ['appr-inbox'],
      'activity-center': ['act-stream'],
      'audit': ['aud-trail', 'aud-engagements', 'aud-workpapers', 'aud-forensic', 'aud-integrity'],
      'master-data': ['md-customers', 'md-vendors', 'md-cost-centers', 'md-tax-codes', 'md-roles', 'md-backup-vault', 'md-lan-network', 'md-settings']
    },
    moduleDefaults: {},
    defaultPermissionCodes: ['*', ...CANONICAL_PERMISSION_CATALOG.map(p => p.code)],
    hardDeniedPermissionCodes: [],
    hardRestrictedModuleIds: [],
    sodRestrictions: [
      'Cannot silently delete or alter immutable audit logs.',
      'Cannot directly overwrite posted journals without formal accounting reversal.',
      'All high-risk executive actions are permanently logged in the immutable audit trail.'
    ],
    financialAuthoritySummary: 'Unlimited PHP approval and posting authority subject to immutable accounting and audit integrity.'
  },

  'Company Administrator': {
    roleCode: 'COMPANY_ADMIN',
    roleName: 'Company Administrator',
    purpose: 'System administration, user/role/module management, company settings, and operational governance without unrestricted financial posting or approval authority.',
    defaultVersion: 1,
    defaultDataScope: 'COMPANY_WIDE',
    defaultApprovalLimitCentavos: 0, // No automatic transaction approval authority
    canApproveFinancialTransactions: false,
    canPostToGeneralLedger: false,
    isReadOnlyRole: false,
    defaultPrimaryModules: [
      'dashboard',
      'activity-center',
      'master-data'
    ],
    defaultSubmodules: {
      'dashboard': ['dash-overview'],
      'activity-center': ['act-stream'],
      'master-data': [
        'md-customers',
        'md-vendors',
        'md-cost-centers',
        'md-tax-codes',
        'md-roles',
        'md-backup-vault',
        'md-lan-network',
        'md-settings'
      ]
    },
    moduleDefaults: {},
    defaultPermissionCodes: [
      'dashboard:view',
      'dashboard:export',
      'activity:view',
      'masterdata:view',
      'customers:view',
      'customers:create',
      'customers:edit',
      'vendors:view',
      'vendors:create',
      'vendors:edit',
      'users:view',
      'users:manage',
      'roles:manage',
      'settings:view',
      'settings:manage',
      'backup:manage',
      'backups:view',
      'backups:create',
      'backups:verify',
      'backups:restore',
      'backups:download',
      'storage:view',
      'storage:cleanup',
      'storage:manage',
      'lan:view',
      'lan:lock',
      'lan:sessions:terminate'
    ],
    hardDeniedPermissionCodes: [
      'accounting:post',
      'accounting:approve',
      'sales:approve',
      'sales:post',
      'purchases:approve',
      'purchases:post',
      'tax:approve',
      'bank_rec:approve',
      'approvals:approve',
      'periods:close',
      'periods:reopen'
    ],
    hardRestrictedModuleIds: [],
    sodRestrictions: [
      'Cannot modify, disable, or delete Company Owner accounts.',
      'Cannot grant permissions higher than Company Administrator.',
      'No automatic unrestricted journal posting or financial transaction approval authority.',
      'Cannot alter or erase audit logs.'
    ],
    financialAuthoritySummary: 'PHP 0.00 — Administrative governance only. No automatic journal posting or financial transaction approval.'
  },

  'Accountant': {
    roleCode: 'ACCOUNTANT',
    roleName: 'Accountant',
    purpose: 'Core accounting, General Ledger, journal entries, reconciliations, Philippine tax preparation, and financial statements.',
    defaultVersion: 1,
    defaultDataScope: 'COMPANY_WIDE',
    defaultApprovalLimitCentavos: 0, // Preparation & GL accounting; final approval requires Approver/Owner
    canApproveFinancialTransactions: false,
    canPostToGeneralLedger: true,
    isReadOnlyRole: false,
    defaultPrimaryModules: [
      'dashboard',
      'accounting',
      'tax',
      'documents',
      'reports',
      'activity-center'
    ],
    defaultSubmodules: {
      'dashboard': ['dash-overview'],
      'accounting': [
        'acct-coa',
        'acct-journals',
        'acct-tb',
        'acct-periods',
        'acct-forex'
      ],
      'tax': [
        'tax-engine',
        'tax-schedules',
        'tax-data-entry',
        'tax-returns',
        'tax-2307'
      ],
      'reports': ['rep-statements'],
      'documents': ['doc-inbox'],
      'activity-center': ['act-stream']
    },
    moduleDefaults: {},
    defaultPermissionCodes: [
      'dashboard:view',
      'dashboard:export',
      'accounting:view',
      'accounting:create',
      'accounting:edit',
      'accounting:submit',
      'accounting:review',
      'accounting:post',
      'accounting:reverse',
      'tax:view',
      'tax:create',
      'tax:edit',
      'tax:export',
      'reports:view',
      'reports:export',
      'documents:view',
      'documents:create',
      'documents:edit',
      'documents:verify',
      'activity:view',
      'sales:view',
      'purchases:view',
      'cash:view',
      'bank_rec:view',
      'customers:view',
      'vendors:view',
      'lan:lock'
    ],
    hardDeniedPermissionCodes: [
      'users:manage',
      'roles:manage',
      'settings:manage',
      'backup:manage',
      'lan:sessions:terminate',
      'periods:reopen',
      'accounting:delete'
    ],
    hardRestrictedModuleIds: [],
    sodRestrictions: [
      'Cannot self-approve own journal entries or transactions where Segregation of Duties (SoD) is required.',
      'Cannot directly edit or delete posted journals (must use formal reversal).',
      'Cannot manage users, roles, or system security settings.',
      'Cannot reopen locked fiscal periods.'
    ],
    financialAuthoritySummary: 'Authorized for GL journal preparation, review, and eligible posting; cannot self-approve own prepared entries.'
  },

  'Bookkeeper': {
    roleCode: 'BOOKKEEPER',
    roleName: 'Bookkeeper',
    purpose: 'Day-to-day transaction encoding, draft preparation, billing, AP encoding, cash entry encoding, and supporting document upload.',
    defaultVersion: 1,
    defaultDataScope: 'OWN_RECORDS',
    defaultApprovalLimitCentavos: 0, // Zero approval authority
    canApproveFinancialTransactions: false,
    canPostToGeneralLedger: false,
    isReadOnlyRole: false,
    defaultPrimaryModules: [
      'dashboard',
      'sales',
      'procurement',
      'cash-banking',
      'documents'
    ],
    defaultSubmodules: {
      'dashboard': ['dash-overview'],
      'sales': ['sales-invoices'],
      'procurement': ['proc-matching', 'proc-bills'],
      'cash-banking': ['cash-mgmt', 'bank-recon'],
      'documents': ['doc-inbox']
    },
    moduleDefaults: {},
    defaultPermissionCodes: [
      'dashboard:view',
      'sales:view',
      'sales:create',
      'sales:edit',
      'sales:submit',
      'purchases:view',
      'purchases:create',
      'purchases:edit',
      'purchases:submit',
      'cash:view',
      'bank_rec:view',
      'bank_rec:create',
      'bank_rec:edit',
      'documents:view',
      'documents:create',
      'documents:edit',
      'customers:view',
      'vendors:view',
      'lan:lock'
    ],
    hardDeniedPermissionCodes: [
      'accounting:post',
      'accounting:approve',
      'accounting:reverse',
      'accounting:delete',
      'sales:approve',
      'sales:post',
      'sales:delete',
      'purchases:approve',
      'purchases:post',
      'purchases:delete',
      'bank_rec:approve',
      'tax:approve',
      'tax:edit',
      'approvals:approve',
      'approvals:review',
      'periods:close',
      'periods:reopen',
      'users:manage',
      'roles:manage',
      'settings:manage',
      'backup:manage',
      'lan:view',
      'lan:sessions:terminate',
      'audit:view',
      'audit:export'
    ],
    hardRestrictedModuleIds: ['audit'],
    sodRestrictions: [
      'Default module assignment is strictly 5 modules (Dashboard, Sales & Receivables, Procurement & Payables, Cash & Banking, Documents & OCR) — never 16/16.',
      'Can edit only DRAFT and RETURNED records; cannot edit SUBMITTED, APPROVED, or POSTED records.',
      'No approval authority, no GL posting authority, and no tax return finalization.',
      'No access to Audit & Governance or RBAC administration.'
    ],
    financialAuthoritySummary: 'PHP 0.00 — Draft preparation and submission only. No approval or GL posting authority.'
  },

  'Approver': {
    roleCode: 'APPROVER',
    roleName: 'Approver',
    purpose: 'Decision authority for submitted transactions and workflow items within configured PHP monetary limits and Segregation of Duties rules.',
    defaultVersion: 1,
    defaultDataScope: 'ASSIGNED_RECORDS',
    defaultApprovalLimitCentavos: 10000000, // Default PHP 100,000.00 approval limit (configurable per user/module)
    canApproveFinancialTransactions: true,
    canPostToGeneralLedger: false,
    isReadOnlyRole: false,
    defaultPrimaryModules: [
      'dashboard',
      'approvals',
      'documents'
    ],
    defaultSubmodules: {
      'dashboard': ['dash-overview'],
      'approvals': ['appr-inbox'],
      'documents': ['doc-inbox']
    },
    moduleDefaults: {},
    defaultPermissionCodes: [
      'dashboard:view',
      'approvals:view',
      'approvals:approve',
      'documents:view',
      'documents:verify',
      'sales:view',
      'sales:approve',
      'purchases:view',
      'purchases:approve',
      'accounting:view',
      'accounting:approve',
      'cash:view',
      'bank_rec:view',
      'bank_rec:approve',
      'tax:view',
      'tax:approve',
      'budget:approve'
    ],
    hardDeniedPermissionCodes: [
      'sales:create',
      'sales:edit',
      'sales:post',
      'sales:delete',
      'purchases:create',
      'purchases:edit',
      'purchases:post',
      'purchases:delete',
      'accounting:create',
      'accounting:edit',
      'accounting:post',
      'accounting:delete',
      'users:manage',
      'roles:manage',
      'settings:manage',
      'backup:manage',
      'lan:sessions:terminate',
      'periods:reopen'
    ],
    hardRestrictedModuleIds: [],
    sodRestrictions: [
      'Strict Segregation of Duties (SoD): Cannot approve a transaction created or submitted by the same user.',
      'Cannot approve transactions exceeding configured PHP monetary limit (default ₱100,000.00 unless overridden).',
      'Rejection and Return for Correction require mandatory remarks.',
      'Cannot create, edit, or post financial transactions.'
    ],
    financialAuthoritySummary: 'Default PHP 100,000.00 approval limit (configurable). Cannot approve own prepared transactions.'
  },

  'Reviewer': {
    roleCode: 'REVIEWER',
    roleName: 'Reviewer',
    purpose: 'Pre-approval verification, completeness checks, supporting document inspection, and return-for-correction workflow.',
    defaultVersion: 1,
    defaultDataScope: 'ASSIGNED_RECORDS',
    defaultApprovalLimitCentavos: 0, // Zero final approval authority
    canApproveFinancialTransactions: false,
    canPostToGeneralLedger: false,
    isReadOnlyRole: false,
    defaultPrimaryModules: [
      'dashboard',
      'approvals',
      'documents'
    ],
    defaultSubmodules: {
      'dashboard': ['dash-overview'],
      'approvals': ['appr-inbox'],
      'documents': ['doc-inbox']
    },
    moduleDefaults: {},
    defaultPermissionCodes: [
      'dashboard:view',
      'approvals:view',
      'approvals:review',
      'documents:view',
      'documents:verify',
      'sales:view',
      'sales:review',
      'purchases:view',
      'purchases:review',
      'accounting:view',
      'accounting:review',
      'tax:view'
    ],
    hardDeniedPermissionCodes: [
      'approvals:approve',
      'sales:create',
      'sales:edit',
      'sales:approve',
      'sales:post',
      'sales:delete',
      'purchases:create',
      'purchases:edit',
      'purchases:approve',
      'purchases:post',
      'purchases:delete',
      'accounting:create',
      'accounting:edit',
      'accounting:approve',
      'accounting:post',
      'accounting:delete',
      'tax:approve',
      'bank_rec:approve',
      'users:manage',
      'roles:manage',
      'settings:manage',
      'backup:manage',
      'lan:sessions:terminate'
    ],
    hardRestrictedModuleIds: [],
    sodRestrictions: [
      'Reviewer is strictly distinct from Approver: Reviewer can verify and return for correction, but CANNOT grant final approval.',
      'Cannot create, edit, post, cancel, or delete financial transactions.',
      'Cannot modify master data or system settings.'
    ],
    financialAuthoritySummary: 'PHP 0.00 — Pre-approval review and return-for-correction only. Cannot approve or post.'
  },

  'Auditor': {
    roleCode: 'AUDITOR',
    roleName: 'Auditor',
    purpose: 'Independent internal/external audit, compliance verification, financial traceability, and immutable audit trail inspection.',
    defaultVersion: 1,
    defaultDataScope: 'COMPANY_WIDE',
    defaultApprovalLimitCentavos: 0,
    canApproveFinancialTransactions: false,
    canPostToGeneralLedger: false,
    isReadOnlyRole: true,
    defaultPrimaryModules: [
      'dashboard',
      'reports',
      'activity-center',
      'audit',
      'documents'
    ],
    defaultSubmodules: {
      'dashboard': ['dash-overview'],
      'reports': ['rep-statements'],
      'activity-center': ['act-stream'],
      'audit': [
        'aud-trail',
        'aud-engagements',
        'aud-workpapers',
        'aud-forensic',
        'aud-integrity'
      ],
      'documents': ['doc-inbox']
    },
    moduleDefaults: {},
    defaultPermissionCodes: [
      'dashboard:view',
      'dashboard:export',
      'reports:view',
      'reports:export',
      'activity:view',
      'audit:view',
      'audit:export',
      'documents:view',
      'accounting:view',
      'sales:view',
      'purchases:view',
      'inventory:view',
      'cash:view',
      'bank_rec:view',
      'fixedassets:view',
      'payroll:view',
      'tax:view',
      'tax:export',
      'budget:view',
      'customers:view',
      'vendors:view',
      'users:view'
    ],
    hardDeniedPermissionCodes: CANONICAL_PERMISSION_CATALOG
      .filter(p => p.action !== 'view' && p.action !== 'export')
      .map(p => p.code),
    hardRestrictedModuleIds: [],
    sodRestrictions: [
      'Strictly Read-Only & Export-Only: Cannot create, edit, submit, review, approve, post, reverse, cancel, archive, restore, or delete any record.',
      'Cannot modify user accounts, roles, permissions, or system settings.',
      'Even if granted additional module visibility, all mutating actions remain hard-blocked by system restriction.'
    ],
    financialAuthoritySummary: 'PHP 0.00 — Strictly read-only inspection and audit evidence export.'
  },

  'Tax & AP Specialist': {
    roleCode: 'TAX_AP_SPECIALIST',
    roleName: 'Tax & AP Specialist',
    purpose: 'Specialized tax compliance, withholding calculation, vendor billing, Accounts Payable, and cash/banking entry.',
    defaultVersion: 1,
    defaultDataScope: 'COMPANY_WIDE',
    defaultApprovalLimitCentavos: 0,
    canApproveFinancialTransactions: false,
    canPostToGeneralLedger: false,
    isReadOnlyRole: false,
    defaultPrimaryModules: [
      'dashboard',
      'procurement',
      'cash-banking',
      'tax',
      'documents',
      'reports'
    ],
    defaultSubmodules: {
      'dashboard': ['dash-overview'],
      'procurement': ['proc-matching', 'proc-bills'],
      'cash-banking': ['cash-mgmt', 'bank-recon'],
      'tax': ['tax-engine', 'tax-schedules', 'tax-data-entry', 'tax-returns', 'tax-2307'],
      'documents': ['doc-inbox'],
      'reports': ['rep-statements']
    },
    moduleDefaults: {},
    defaultPermissionCodes: [
      'dashboard:view',
      'dashboard:export',
      'purchases:view',
      'purchases:create',
      'purchases:edit',
      'purchases:submit',
      'purchases:review',
      'cash:view',
      'cash:create',
      'cash:edit',
      'bank_rec:view',
      'bank_rec:create',
      'bank_rec:edit',
      'tax:view',
      'tax:create',
      'tax:edit',
      'tax:export',
      'documents:view',
      'documents:create',
      'documents:edit',
      'documents:verify',
      'reports:view',
      'reports:export',
      'vendors:view',
      'vendors:create',
      'vendors:edit',
      'customers:view'
    ],
    hardDeniedPermissionCodes: [
      'users:manage',
      'roles:manage',
      'settings:manage',
      'backup:manage',
      'lan:sessions:terminate',
      'accounting:post',
      'sales:approve',
      'purchases:approve'
    ],
    hardRestrictedModuleIds: ['audit'],
    sodRestrictions: [
      'Specialized operational role for tax and payables processing.',
      'Cannot grant final approval or post directly to General Ledger without appropriate review.',
      'Cannot modify system roles, users, or audit logs.'
    ],
    financialAuthoritySummary: 'PHP 0.00 — Tax, AP, and Cash entry processing. No final approval or GL posting.'
  },

  'Read-only User': {
    roleCode: 'READ_ONLY',
    roleName: 'Read-only User',
    purpose: 'Controlled viewing of explicitly assigned dashboards and reports without any create, edit, workflow, or administrative capability.',
    defaultVersion: 1,
    defaultDataScope: 'EXPLICIT_RECORDS',
    defaultApprovalLimitCentavos: 0,
    canApproveFinancialTransactions: false,
    canPostToGeneralLedger: false,
    isReadOnlyRole: true,
    defaultPrimaryModules: [
      'dashboard',
      'reports'
    ],
    defaultSubmodules: {
      'dashboard': ['dash-overview'],
      'reports': ['rep-statements']
    },
    moduleDefaults: {},
    defaultPermissionCodes: [
      'dashboard:view',
      'reports:view'
    ],
    hardDeniedPermissionCodes: CANONICAL_PERMISSION_CATALOG
      .filter(p => p.action !== 'view')
      .map(p => p.code),
    hardRestrictedModuleIds: ['audit', 'master-data', 'approvals'],
    sodRestrictions: [
      'Strictly View-Only: Zero create, edit, submit, review, approve, post, export, cancel, or delete capability.',
      'Cannot access Audit & Governance, Approvals Inbox, or Master Data & Administration.',
      'Even if additional modules are assigned for viewing, all write/workflow actions are permanently denied.'
    ],
    financialAuthoritySummary: 'PHP 0.00 — View-only access to assigned modules.'
  }
};

// Populate per-module defaults for each role template automatically
for (const roleName of CANONICAL_ROLES_ORDER) {
  const tpl = ROLE_TEMPLATES_CATALOG[roleName];
  const modDefaults: Record<string, RoleModuleDefault> = {};
  for (const modId of tpl.defaultPrimaryModules) {
    const modPerms = CANONICAL_PERMISSION_CATALOG.filter(p => p.primaryModuleId === modId);
    const allowedActs = Array.from(new Set(
      modPerms
        .filter(p => tpl.defaultPermissionCodes.includes('*') || tpl.defaultPermissionCodes.includes(p.code))
        .map(p => p.action)
    ));
    const deniedActs = Array.from(new Set(
      modPerms
        .filter(p => !tpl.defaultPermissionCodes.includes('*') && !tpl.defaultPermissionCodes.includes(p.code))
        .map(p => p.action)
    ));
    modDefaults[modId] = {
      moduleId: modId,
      submoduleIds: tpl.defaultSubmodules[modId] || [],
      allowedActions: allowedActs,
      deniedActions: deniedActs,
      defaultDataScope: tpl.defaultDataScope,
      defaultApprovalLimitCentavos: tpl.canApproveFinancialTransactions ? tpl.defaultApprovalLimitCentavos : 0,
      notes: `${roleName} default template access for ${modId}`
    };
  }
  tpl.moduleDefaults = modDefaults;
}

/**
 * Helper to retrieve a role template by role name
 */
export function getRoleTemplate(roleName?: string | null): RoleTemplateDefinition {
  const r = (roleName || '').trim() as CanonicalRoleName;
  if (ROLE_TEMPLATES_CATALOG[r]) {
    return ROLE_TEMPLATES_CATALOG[r];
  }
  return ROLE_TEMPLATES_CATALOG['Read-only User'];
}
