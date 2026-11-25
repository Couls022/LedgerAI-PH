import { 
  Home, ShoppingCart, Truck, Boxes, Landmark, BookOpen, Building2, 
  Users, FileText, PieChart, FolderOpen, BarChart3, CheckSquare, 
  ShieldCheck, Database, Activity
} from 'lucide-react';

import { ROLE_TEMPLATES_CATALOG } from './rbacCatalog';

export type LedgerRole =
  | 'Company Owner'
  | 'Company Administrator'
  | 'Accountant'
  | 'Bookkeeper'
  | 'Auditor'
  | 'Reviewer'
  | 'Approver'
  | 'Tax & AP Specialist'
  | 'Read-only User';

export interface SubmoduleDefinition {
  id: string;
  parentId: string; // The primary module ID under which this appears in the navigation
  label: string;
  route: string;
  componentId?: string; // Authoritative React component identifier for 1-to-1 destination verification
  requiredPermission?: string;
  allowedRoles?: LedgerRole[];
  minPlan?: 'PRO' | 'ENTERPRISE';
  description?: string;
  badge?: string;
}

export interface PrimaryModuleDefinition {
  id: string;
  label: string;
  iconName: string;
  baseRoute: string;
  description: string;
  requiredPermission?: string;
  allowedRoles?: LedgerRole[];
  minPlan?: 'PRO' | 'ENTERPRISE';
  badge?: string;
  submodules: SubmoduleDefinition[];
}

export const CANONICAL_ERP_MODULES: PrimaryModuleDefinition[] = [
  {
    id: 'dashboard',
    label: '1. Dashboard',
    iconName: 'Home',
    baseRoute: '/',
    description: 'Executive & financial overview, key performance metrics, and real-time fiscal telemetry.',
    requiredPermission: 'dashboard:view',
    submodules: [
      { id: 'dash-overview', parentId: 'dashboard', label: 'Executive & Financial Dashboard', route: '/', componentId: 'Dashboard', requiredPermission: 'dashboard:view' }
    ]
  },
  {
    id: 'sales',
    label: '2. Sales & Receivables',
    iconName: 'ShoppingCart',
    baseRoute: '/accounting/sales-invoicing',
    description: 'Customer billing, Accounts Receivable, Output VAT, Official Receipts, and collections.',
    requiredPermission: 'sales:view',
    submodules: [
      { id: 'sales-invoices', parentId: 'sales', label: 'Sales Invoices & Billing', route: '/accounting/sales-invoicing', componentId: 'SalesInvoicing', requiredPermission: 'sales:view' }
    ]
  },
  {
    id: 'procurement',
    label: '3. Procurement & Payables',
    iconName: 'Truck',
    baseRoute: '/accounting/procurement',
    description: 'Purchase orders, 3-way match, Purchase Bills, and Accounts Payable.',
    requiredPermission: 'purchases:view',
    submodules: [
      { id: 'proc-matching', parentId: 'procurement', label: 'Procurement & 3-Way Match', route: '/accounting/procurement', componentId: 'Procurement', requiredPermission: 'purchases:view' },
      { id: 'proc-bills', parentId: 'procurement', label: 'Purchase Bills & Accounts Payable', route: '/accounting/purchase-bills', componentId: 'PurchaseBills', requiredPermission: 'purchases:view' }
    ]
  },
  {
    id: 'inventory',
    label: '4. Inventory & Warehouse',
    iconName: 'Boxes',
    baseRoute: '/accounting/inventory',
    description: 'Item catalog, stock movements, FIFO/Weighted Avg valuation, and physical stock counts.',
    requiredPermission: 'inventory:view',
    submodules: [
      { id: 'inv-movements', parentId: 'inventory', label: 'Inventory & Stock Valuation', route: '/accounting/inventory', componentId: 'Inventory', requiredPermission: 'inventory:view' }
    ]
  },
  {
    id: 'cash-banking',
    label: '5. Cash & Banking',
    iconName: 'Landmark',
    baseRoute: '/accounting/cash-transactions',
    description: 'Petty cash custody, check register, deposits, and bank reconciliations.',
    requiredPermission: 'cash:view',
    submodules: [
      { id: 'cash-mgmt', parentId: 'cash-banking', label: 'Cash & Check Management', route: '/accounting/cash-transactions', componentId: 'CashTransactions', requiredPermission: 'cash:view' },
      { id: 'bank-recon', parentId: 'cash-banking', label: 'Bank Reconciliation Workspace', route: '/accounting/bank-reconciliation', componentId: 'BankReconciliation', requiredPermission: 'bank_rec:view' }
    ]
  },
  {
    id: 'accounting',
    label: '6. Accounting & General Ledger',
    iconName: 'BookOpen',
    baseRoute: '/accounting/journals',
    description: 'Chart of Accounts, General Journal entries, Trial Balance, and fiscal closing.',
    requiredPermission: 'accounting:view',
    submodules: [
      { id: 'acct-coa', parentId: 'accounting', label: 'Chart of Accounts', route: '/accounting/accounts', componentId: 'ChartOfAccounts', requiredPermission: 'accounting:view' },
      { id: 'acct-journals', parentId: 'accounting', label: 'General Journal & Ledger', route: '/accounting/journals', componentId: 'JournalEntries', requiredPermission: 'accounting:view' },
      { id: 'acct-tb', parentId: 'accounting', label: 'Trial Balance Ledger', route: '/reports/trial-balance', componentId: 'TrialBalanceView', requiredPermission: 'accounting:view' },
      { id: 'acct-periods', parentId: 'accounting', label: 'Accounting Periods & Lock', route: '/accounting/periods', componentId: 'AccountingPeriods', requiredPermission: 'accounting:view' },
      { id: 'acct-forex', parentId: 'accounting', label: 'Foreign Exchange Revaluation', route: '/accounting/forex', componentId: 'ForexRevaluation', requiredPermission: 'accounting:view', minPlan: 'ENTERPRISE', badge: 'ENT' }
    ]
  },
  {
    id: 'fixed-assets',
    label: '7. Fixed Assets',
    iconName: 'Building2',
    baseRoute: '/accounting/fixed-assets',
    description: 'Capitalization, depreciation schedules, asset transfers, and disposals.',
    requiredPermission: 'fixedassets:view',
    minPlan: 'PRO',
    submodules: [
      { id: 'fa-register', parentId: 'fixed-assets', label: 'Fixed Asset & Depreciation Register', route: '/accounting/fixed-assets', componentId: 'FixedAssets', requiredPermission: 'fixedassets:view', minPlan: 'PRO' }
    ]
  },
  {
    id: 'payroll',
    label: '8. Payroll & Human Resources',
    iconName: 'Users',
    baseRoute: '/accounting/payroll',
    description: 'Employee profiles, salary calculation, 1601-C withholding, and statutory benefits.',
    requiredPermission: 'payroll:view',
    minPlan: 'PRO',
    submodules: [
      { id: 'pay-records', parentId: 'payroll', label: 'Payroll & Statutory Compensation', route: '/accounting/payroll', componentId: 'Payroll', requiredPermission: 'payroll:view', minPlan: 'PRO' }
    ]
  },
  {
    id: 'tax',
    label: '9. Tax & BIR Compliance',
    iconName: 'FileText',
    baseRoute: '/tax/bir-compliance',
    description: 'Philippine Tax Engine, 12% VAT, Withholding, 2307, 2550Q, 1701/1702, QAP/MAP, SAWT/SLSP.',
    requiredPermission: 'tax:view',
    minPlan: 'PRO',
    submodules: [
      { id: 'tax-engine', parentId: 'tax', label: 'BIR Statutory Returns & eFiling', route: '/tax/bir-compliance', componentId: 'BirCompliance', requiredPermission: 'tax:view', minPlan: 'PRO' },
      { id: 'tax-schedules', parentId: 'tax', label: 'VAT & Withholding Schedules', route: '/tax/vat-schedules', componentId: 'TaxSchedules', requiredPermission: 'tax:view', minPlan: 'PRO' },
      { id: 'tax-data-entry', parentId: 'tax', label: 'Alphalist & SAWT/SLSP Data Entry', route: '/tax/ledger-data-entry', componentId: 'LedgerDataEntry', requiredPermission: 'tax:view', minPlan: 'PRO' },
      { id: 'tax-returns', parentId: 'tax', label: 'BIR Form & GL Account Mapping', route: '/tax/forms', componentId: 'TaxForms', requiredPermission: 'tax:view', minPlan: 'PRO' },
      { id: 'tax-2307', parentId: 'tax', label: 'BIR Form 2307 (CWT Certificates)', route: '/tax/2307', componentId: 'Form2307Module', requiredPermission: 'tax:view', minPlan: 'PRO' }
    ]
  },
  {
    id: 'budget',
    label: '10. Budget & Financial Planning',
    iconName: 'PieChart',
    baseRoute: '/budget',
    description: 'Departmental budgets, cost centers, project allocation, and variance analysis.',
    requiredPermission: 'budget:view',
    minPlan: 'ENTERPRISE',
    badge: 'ENT',
    submodules: [
      { id: 'bud-mgmt', parentId: 'budget', label: 'Budget & Variance Planning', route: '/budget', componentId: 'BudgetPlanning', requiredPermission: 'budget:view', minPlan: 'ENTERPRISE', badge: 'ENT' }
    ]
  },
  {
    id: 'documents',
    label: '11. Documents & OCR',
    iconName: 'FolderOpen',
    baseRoute: '/documents',
    description: 'Document vault, Tesseract OCR scanning, versioning, and transaction linking.',
    requiredPermission: 'documents:view',
    minPlan: 'PRO',
    submodules: [
      { id: 'doc-inbox', parentId: 'documents', label: 'Document Vault & OCR Inbox', route: '/documents', componentId: 'Documents', requiredPermission: 'documents:view', minPlan: 'PRO' }
    ]
  },
  {
    id: 'reports',
    label: '12. Reports & Analytics',
    iconName: 'BarChart3',
    baseRoute: '/reports',
    description: 'Financial statements, GL registers, Income Statement, Balance Sheet, AR/AP aging, and Cash Flow.',
    requiredPermission: 'reports:view',
    minPlan: 'PRO',
    submodules: [
      { id: 'rep-statements', parentId: 'reports', label: 'Financial Statements & Reports Hub', route: '/reports', componentId: 'ReportsHub', requiredPermission: 'reports:view', minPlan: 'PRO' }
    ]
  },
  {
    id: 'approvals',
    label: '13. Approvals & Workflow',
    iconName: 'CheckSquare',
    baseRoute: '/activity-center?workspace=approvals',
    description: 'Approval inbox, multi-level workflows, delegation, SLA tracking, and policy rules.',
    requiredPermission: 'approvals:view',
    minPlan: 'ENTERPRISE',
    badge: 'ENT',
    submodules: [
      { id: 'appr-inbox', parentId: 'approvals', label: 'Approval Inbox & Workflows', route: '/activity-center?workspace=approvals', componentId: 'ApprovalWorkspace', requiredPermission: 'approvals:view', minPlan: 'ENTERPRISE', badge: 'ENT' }
    ]
  },
  {
    id: 'activity-center',
    label: '14. Activity Center',
    iconName: 'Activity',
    baseRoute: '/activity-center?workspace=stream',
    description: 'Centralized activity journey stream, user accountability, change diffs, and governance.',
    requiredPermission: 'activity:view',
    minPlan: 'ENTERPRISE',
    badge: 'ENT',
    submodules: [
      { id: 'act-stream', parentId: 'activity-center', label: 'Enterprise Activity Stream', route: '/activity-center?workspace=stream', componentId: 'ActivityStreamWorkspace', requiredPermission: 'activity:view', minPlan: 'ENTERPRISE', badge: 'ENT' }
    ]
  },
  {
    id: 'audit',
    label: '15. Audit & Governance',
    iconName: 'ShieldCheck',
    baseRoute: '/audit/logs',
    description: 'Immutable audit logs, PSA engagements, working papers, forensic investigations, and cryptographic integrity.',
    requiredPermission: 'audit:view',
    submodules: [
      { id: 'aud-trail', parentId: 'audit', label: 'Immutable Audit Trail Logs', route: '/audit/logs', componentId: 'AuditLog', requiredPermission: 'audit:view', minPlan: 'PRO' },
      { id: 'aud-engagements', parentId: 'audit', label: 'Audit Engagements & Planning', route: '/audit/engagements', componentId: 'AuditEngagements', requiredPermission: 'audit:view', minPlan: 'ENTERPRISE', badge: 'ENT' },
      { id: 'aud-workpapers', parentId: 'audit', label: 'PSA Working Papers & Lead Sheets', route: '/audit/workpapers', componentId: 'AuditWorkpapers', requiredPermission: 'audit:view', minPlan: 'ENTERPRISE', badge: 'ENT' },
      { id: 'aud-forensic', parentId: 'audit', label: 'Forensic & Fraud Anomaly Detection', route: '/audit/fraud', componentId: 'FraudDetection', requiredPermission: 'audit:view', minPlan: 'ENTERPRISE', badge: 'ENT' },
      { id: 'aud-integrity', parentId: 'audit', label: 'Cryptographic Ledger Integrity', route: '/audit/integrity', componentId: 'AuditIntegrity', requiredPermission: 'audit:view', minPlan: 'ENTERPRISE', badge: 'ENT' },
      { id: 'aud-archive-vault', parentId: 'audit', label: 'System Archive Vault & Retention Inbox', route: '/audit/archive-vault', componentId: 'ArchiveVaultWorkspace', requiredPermission: 'audit:view', minPlan: 'ENTERPRISE', badge: 'ENT' }
    ]
  },
  {
    id: 'master-data',
    label: '16. Master Data & Administration',
    iconName: 'Database',
    baseRoute: '/master-data/customers',
    description: 'Enterprise master registries, organizational dimensions, BIR tax classifications, RBAC security matrix, database vault, LAN cluster, and system settings.',
    requiredPermission: 'masterdata:view',
    submodules: [
      { id: 'md-customers', parentId: 'master-data', label: 'Customer Master Registry', route: '/master-data/customers', componentId: 'CustomersList', requiredPermission: 'masterdata:view', minPlan: 'PRO' },
      { id: 'md-vendors', parentId: 'master-data', label: 'Vendor & Supplier Registry', route: '/master-data/vendors', componentId: 'VendorsList', requiredPermission: 'masterdata:view', minPlan: 'PRO' },
      { id: 'md-cost-centers', parentId: 'master-data', label: 'Organizational Dimensions & Cost Centers', route: '/master-data/cost-centers', componentId: 'CostCentersList', requiredPermission: 'masterdata:view', minPlan: 'ENTERPRISE', badge: 'ENT' },
      { id: 'md-tax-codes', parentId: 'master-data', label: 'Statutory Tax Codes & ATC Rates', route: '/master-data/tax-codes', componentId: 'TaxCodesList', requiredPermission: 'masterdata:view', minPlan: 'PRO' },
      { id: 'md-roles', parentId: 'master-data', label: 'Enterprise RBAC & Access Matrix', route: '/master-data/rbac', componentId: 'RbacMatrixWorkspace', requiredPermission: 'roles:manage', minPlan: 'ENTERPRISE', badge: 'ENT' },
      { id: 'md-backup-vault', parentId: 'master-data', label: 'Database Vault & Disaster Recovery', route: '/master-data/backup-vault', componentId: 'BackupManager', requiredPermission: 'backups:view', minPlan: 'ENTERPRISE', badge: 'ENT' },
      { id: 'md-lan-network', parentId: 'master-data', label: 'Multi-Workstation LAN & Concurrency', route: '/master-data/lan-network', componentId: 'LanServerDashboard', requiredPermission: 'lan:view', minPlan: 'PRO' },
      { id: 'md-settings', parentId: 'master-data', label: 'Enterprise Profile & System Settings', route: '/settings', componentId: 'Settings', requiredPermission: 'settings:view', minPlan: 'PRO' }
    ]
  }
];

export const DEFAULT_ROLE_MODULE_ASSIGNMENTS: Record<LedgerRole, string[]> = {
  'Company Owner': ROLE_TEMPLATES_CATALOG['Company Owner'].defaultPrimaryModules,
  'Company Administrator': ROLE_TEMPLATES_CATALOG['Company Administrator'].defaultPrimaryModules,
  'Accountant': ROLE_TEMPLATES_CATALOG['Accountant'].defaultPrimaryModules,
  'Bookkeeper': ROLE_TEMPLATES_CATALOG['Bookkeeper'].defaultPrimaryModules,
  'Reviewer': ROLE_TEMPLATES_CATALOG['Reviewer'].defaultPrimaryModules,
  'Approver': ROLE_TEMPLATES_CATALOG['Approver'].defaultPrimaryModules,
  'Auditor': ROLE_TEMPLATES_CATALOG['Auditor'].defaultPrimaryModules,
  'Tax & AP Specialist': ROLE_TEMPLATES_CATALOG['Tax & AP Specialist'].defaultPrimaryModules,
  'Read-only User': ROLE_TEMPLATES_CATALOG['Read-only User'].defaultPrimaryModules
};

export interface RegistryValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalModules: number;
  totalSubmodules: number;
  duplicateSubmoduleIds: string[];
  duplicateCanonicalRoutes: { route: string; owners: string[] }[];
}

/**
 * Validates structural integrity: unique IDs, exact parent matching, zero duplicate routes.
 */
export function validateModuleRegistry(modules: PrimaryModuleDefinition[] = CANONICAL_ERP_MODULES): RegistryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenSubmoduleIds = new Set<string>();
  const duplicateSubmoduleIds: string[] = [];
  
  const routeCanonicalOwners = new Map<string, string[]>();

  modules.forEach(mod => {
    mod.submodules.forEach(sub => {
      // 1. Check duplicate submodule IDs
      if (seenSubmoduleIds.has(sub.id)) {
        duplicateSubmoduleIds.push(sub.id);
        errors.push(`Duplicate submodule ID detected: "${sub.id}" in module "${mod.id}"`);
      } else {
        seenSubmoduleIds.add(sub.id);
      }

      // 2. Check canonical parent association
      if (sub.parentId !== mod.id) {
        errors.push(`Submodule "${sub.id}" has parentId "${sub.parentId}" but is listed under module "${mod.id}"`);
      }

      // 3. Check exact route ownership
      const existing = routeCanonicalOwners.get(sub.route) || [];
      existing.push(mod.id);
      routeCanonicalOwners.set(sub.route, existing);
    });
  });

  const duplicateCanonicalRoutes: { route: string; owners: string[] }[] = [];
  for (const [route, owners] of routeCanonicalOwners.entries()) {
    const uniqueOwners = Array.from(new Set(owners));
    if (uniqueOwners.length > 1) {
      duplicateCanonicalRoutes.push({ route, owners: uniqueOwners });
      errors.push(`Route "${route}" is claimed by multiple modules: ${uniqueOwners.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    totalModules: modules.length,
    totalSubmodules: seenSubmoduleIds.size,
    duplicateSubmoduleIds,
    duplicateCanonicalRoutes
  };
}

export interface FunctionalDestinationAudit {
  valid: boolean;
  totalPrimaryModules: number;
  totalSubmodules: number;
  duplicateIds: string[];
  duplicateRoutes: string[];
  duplicateComponents: string[];
  duplicateLabelsInModule: { moduleId: string; label: string }[];
  crossModuleOverlaps: string[];
  inconsistentParents: string[];
  issues: string[];
}

/**
 * Deep functional destination audit ensuring zero duplicate destinations,
 * strict 1-to-1 component mapping, single authoritative business function ownership, and pristine routing.
 */
export function validateFunctionalDestinations(modules: PrimaryModuleDefinition[] = CANONICAL_ERP_MODULES): FunctionalDestinationAudit {
  const issues: string[] = [];
  const duplicateIds: string[] = [];
  const duplicateRoutes: string[] = [];
  const duplicateComponents: string[] = [];
  const duplicateLabelsInModule: { moduleId: string; label: string }[] = [];
  const crossModuleOverlaps: string[] = [];
  const inconsistentParents: string[] = [];

  const seenIds = new Set<string>();
  const seenRoutes = new Set<string>();
  const seenComponents = new Map<string, string>();

  if (modules.length !== 16) {
    issues.push(`Expected exactly 16 primary ERP modules, found ${modules.length}`);
  }

  modules.forEach(mod => {
    const seenModuleLabels = new Set<string>();

    mod.submodules.forEach(sub => {
      // 1. Unique submodule ID
      if (seenIds.has(sub.id)) {
        duplicateIds.push(sub.id);
        issues.push(`Duplicate submodule ID across system: "${sub.id}"`);
      }
      seenIds.add(sub.id);

      // 2. Strict parentId match
      if (sub.parentId !== mod.id) {
        inconsistentParents.push(`${sub.id} (parentId: ${sub.parentId}, actual: ${mod.id})`);
        issues.push(`Submodule "${sub.id}" has parentId "${sub.parentId}" which does not match module "${mod.id}"`);
      }

      // 3. Unique full route across whole ERP
      if (seenRoutes.has(sub.route)) {
        duplicateRoutes.push(sub.route);
        issues.push(`Duplicate full route across system: "${sub.route}" in module "${mod.id}"`);
      }
      seenRoutes.add(sub.route);

      // 4. Strict 1-to-1 Component Destination Check (no different-label submodules sharing a component)
      const compKey = sub.componentId || sub.route;
      if (seenComponents.has(compKey)) {
        duplicateComponents.push(compKey);
        issues.push(`Duplicate component destination "${compKey}" shared between "${seenComponents.get(compKey)}" and "${sub.label}"`);
      }
      seenComponents.set(compKey, sub.label);

      // 5. Unique label inside same module
      const normalizedLabel = sub.label.toLowerCase().trim();
      if (seenModuleLabels.has(normalizedLabel)) {
        duplicateLabelsInModule.push({ moduleId: mod.id, label: sub.label });
        issues.push(`Duplicate label within module "${mod.id}": "${sub.label}"`);
      }
      seenModuleLabels.add(normalizedLabel);
    });
  });

  return {
    valid: issues.length === 0,
    totalPrimaryModules: modules.length,
    totalSubmodules: seenIds.size,
    duplicateIds,
    duplicateRoutes,
    duplicateComponents,
    duplicateLabelsInModule,
    crossModuleOverlaps,
    inconsistentParents,
    issues
  };
}

/**
 * Returns the single authoritative canonical primary module for any given application route.
 */
export function getCanonicalModuleForRoute(pathname: string, search: string = ''): PrimaryModuleDefinition | undefined {
  const rawClean = pathname.split('?')[0];
  // Strip /(client|server)/<tenantDomain> prefix if present (e.g. /client/ledgeraiph.acme.com/accounting -> /accounting)
  const cleanPath = rawClean.replace(/^\/(?:client|server)\/[^\/]+/, '') || '/';
  const full = search ? (cleanPath + (search.startsWith('?') ? search : `?${search}`)) : cleanPath;

  // Differentiate Approvals & Workflow vs Activity Center based on workspace/tab query
  if (cleanPath === '/activity-center') {
    if (
      full.includes('workspace=approvals') || 
      full.includes('tab=inbox') || 
      full.includes('tab=pending') || 
      full.includes('tab=history') || 
      full.includes('tab=workflows') || 
      full.includes('tab=delegation') || 
      full.includes('tab=sla')
    ) {
      return CANONICAL_ERP_MODULES.find(m => m.id === 'approvals');
    }
    return CANONICAL_ERP_MODULES.find(m => m.id === 'activity-center');
  }

  if (cleanPath.startsWith('/approvals')) {
    return CANONICAL_ERP_MODULES.find(m => m.id === 'approvals');
  }

  // 1. Direct exact submodule match (full route including query parameters)
  for (const mod of CANONICAL_ERP_MODULES) {
    const exactMatch = mod.submodules.find(sub => sub.route === full);
    if (exactMatch) return mod;
  }

  // Trial Balance canonical single destination is Accounting & General Ledger
  if (cleanPath === '/reports/trial-balance') {
    return CANONICAL_ERP_MODULES.find(m => m.id === 'accounting');
  }

  // Inventory route belongs to Inventory & Warehouse
  if (cleanPath === '/accounting/inventory') {
    return CANONICAL_ERP_MODULES.find(m => m.id === 'inventory');
  }

  // Exact path mappings
  const EXACT_CANONICAL_MAP: Record<string, string> = {
    '/': 'dashboard',
    '/dashboard': 'dashboard',
    '/accounting/sales-invoicing': 'sales',
    '/accounting/procurement': 'procurement',
    '/accounting/purchase-bills': 'procurement',
    '/accounting/inventory': 'inventory',
    '/accounting/cash-transactions': 'cash-banking',
    '/accounting/bank-reconciliation': 'cash-banking',
    '/accounting/accounts': 'accounting',
    '/accounting/journals': 'accounting',
    '/accounting/periods': 'accounting',
    '/accounting/forex': 'accounting',
    '/accounting/fixed-assets': 'fixed-assets',
    '/accounting/payroll': 'payroll',
    '/tax': 'tax',
    '/tax/bir-compliance': 'tax',
    '/tax/compliance': 'tax',
    '/tax/vat-schedules': 'tax',
    '/tax/ledger-data-entry': 'tax',
    '/tax/data-entry': 'tax',
    '/tax/forms': 'tax',
    '/tax/2307': 'tax',
    '/budget': 'budget',
    '/documents': 'documents',
    '/reports': 'reports',
    '/reports/general-ledger': 'reports',
    '/reports/income-statement': 'reports',
    '/reports/balance-sheet': 'reports',
    '/reports/ar-aging': 'reports',
    '/reports/ap-aging': 'reports',
    '/reports/cash-flow': 'reports',
    '/reports/department-report': 'reports',
    '/audit': 'audit',
    '/audit/logs': 'audit',
    '/audit/engagements': 'audit',
    '/audit/workpapers': 'audit',
    '/audit/fraud': 'audit',
    '/audit/integrity': 'audit',
    '/audit/findings': 'audit',
    '/audit/sampling': 'audit',
    '/audit/leadsheets': 'audit',
    '/audit/package': 'audit',
    '/master-data': 'master-data',
    '/master-data/customers': 'master-data',
    '/master-data/vendors': 'master-data',
    '/master-data/departments': 'master-data',
    '/master-data/projects': 'master-data',
    '/master-data/cost-centers': 'master-data',
    '/master-data/tax-codes': 'master-data',
    '/master-data/users': 'master-data',
    '/master-data/rbac': 'master-data',
    '/master-data/backup-vault': 'master-data',
    '/master-data/lan-network': 'master-data',
    '/settings': 'master-data'
  };

  if (EXACT_CANONICAL_MAP[cleanPath]) {
    const modId = EXACT_CANONICAL_MAP[cleanPath];
    const found = CANONICAL_ERP_MODULES.find(m => m.id === modId);
    if (found) return found;
  }

  // 2. Direct submodule path match (ignoring query)
  for (const mod of CANONICAL_ERP_MODULES) {
    const match = mod.submodules.find(sub => sub.route.split('?')[0] === cleanPath);
    if (match) return mod;
  }

  // 3. Base route match
  const baseMatches = CANONICAL_ERP_MODULES
    .filter(mod => mod.baseRoute !== '/' && (cleanPath === mod.baseRoute || cleanPath.startsWith(mod.baseRoute + '/')))
    .sort((a, b) => b.baseRoute.length - a.baseRoute.length);

  if (baseMatches.length > 0) {
    return baseMatches[0];
  }

  // 4. Fallback for prefix matching
  if (cleanPath.startsWith('/tax')) return CANONICAL_ERP_MODULES.find(m => m.id === 'tax');
  if (cleanPath.startsWith('/documents')) return CANONICAL_ERP_MODULES.find(m => m.id === 'documents');
  if (cleanPath.startsWith('/reports')) return CANONICAL_ERP_MODULES.find(m => m.id === 'reports');
  if (cleanPath.startsWith('/audit')) return CANONICAL_ERP_MODULES.find(m => m.id === 'audit');
  if (cleanPath.startsWith('/master-data')) return CANONICAL_ERP_MODULES.find(m => m.id === 'master-data');
  if (cleanPath.startsWith('/settings')) return CANONICAL_ERP_MODULES.find(m => m.id === 'master-data');
  if (cleanPath.startsWith('/budget')) return CANONICAL_ERP_MODULES.find(m => m.id === 'budget');
  if (cleanPath.startsWith('/accounting')) return CANONICAL_ERP_MODULES.find(m => m.id === 'accounting');

  return CANONICAL_ERP_MODULES.find(m => m.id === 'dashboard');
}

export const DEFAULT_ROLE_PERMISSIONS: Record<LedgerRole, string[]> = {
  'Company Owner': ROLE_TEMPLATES_CATALOG['Company Owner'].defaultPermissionCodes,
  'Company Administrator': ROLE_TEMPLATES_CATALOG['Company Administrator'].defaultPermissionCodes,
  'Accountant': ROLE_TEMPLATES_CATALOG['Accountant'].defaultPermissionCodes,
  'Bookkeeper': ROLE_TEMPLATES_CATALOG['Bookkeeper'].defaultPermissionCodes,
  'Reviewer': ROLE_TEMPLATES_CATALOG['Reviewer'].defaultPermissionCodes,
  'Approver': ROLE_TEMPLATES_CATALOG['Approver'].defaultPermissionCodes,
  'Auditor': ROLE_TEMPLATES_CATALOG['Auditor'].defaultPermissionCodes,
  'Tax & AP Specialist': ROLE_TEMPLATES_CATALOG['Tax & AP Specialist'].defaultPermissionCodes,
  'Read-only User': ROLE_TEMPLATES_CATALOG['Read-only User'].defaultPermissionCodes
};

export function getAuthorizedERPModules(
  role: LedgerRole, 
  userPermissions: string[] = [], 
  assignedModuleIds?: string[] | null,
  assignedSubmoduleIds?: Record<string, string[]> | null
): PrimaryModuleDefinition[] {
  // 1. Company Owner has permanent unrestricted functional access across all canonical modules & submodules
  if (role === 'Company Owner') {
    return CANONICAL_ERP_MODULES;
  }

  // If assignedModuleIds is explicitly an empty array (e.g. DISABLED user or zero modules assigned), return []
  if (Array.isArray(assignedModuleIds) && assignedModuleIds.length === 0) {
    return [];
  }

  // Combine user permissions with role default permissions if userPermissions is empty
  const effectivePerms = userPermissions.length > 0 
    ? userPermissions 
    : (DEFAULT_ROLE_PERMISSIONS[role] || []);

  // 2. Base allowed modules by explicit assignments or role defaults from Role Permissions Catalog
  const allowedIds = Array.isArray(assignedModuleIds)
    ? assignedModuleIds
    : (DEFAULT_ROLE_MODULE_ASSIGNMENTS[role] || []);

  const roleTemplate = ROLE_TEMPLATES_CATALOG[role] || ROLE_TEMPLATES_CATALOG['Read-only User'];

  const hasPerm = (perm?: string) => {
    if (!perm) return true;
    if (effectivePerms.includes('*')) return true;
    const lower = perm.toLowerCase();
    const legacy = lower.replace(':', '_').toUpperCase();
    return effectivePerms.some(p => {
      if (p === '*') return true;
      const pLower = p.toLowerCase();
      return pLower === lower || pLower === legacy;
    });
  };

  const hasBackupSubPerm = () => (
    hasPerm('backups:view') ||
    hasPerm('backup:view') ||
    hasPerm('storage:view') ||
    hasPerm('backup:manage') ||
    hasPerm('backups:manage') ||
    hasPerm('storage:manage')
  );

  const checkSubmodulePerm = (sub: SubmoduleDefinition) => {
    if (!sub.requiredPermission) return true;
    if (sub.id === 'md-backup-vault') {
      return hasBackupSubPerm();
    }
    if (sub.id === 'md-roles' && !hasPerm('roles:manage')) {
      return false;
    }
    return hasPerm(sub.requiredPermission);
  };

  return CANONICAL_ERP_MODULES.filter(mod => {
    if (roleTemplate.hardRestrictedModuleIds.includes(mod.id)) return false;
    if (!allowedIds.includes(mod.id)) return false;
    // Enforce required module view permission if defined (or if any submodule permission in this module is granted)
    if (
      mod.requiredPermission &&
      !hasPerm(mod.requiredPermission) &&
      !mod.submodules.some(s => checkSubmodulePerm(s))
    ) {
      return false;
    }
    return true;
  }).map(mod => {
    const explicitSubs = assignedSubmoduleIds?.[mod.id];
    const filteredSubs = mod.submodules.filter(sub => {
      if (Array.isArray(explicitSubs)) {
        if (!explicitSubs.includes(sub.id)) return false;
        if (sub.id === 'md-roles' && !hasPerm('roles:manage')) return false;
        if (sub.id === 'md-backup-vault' && userPermissions.length > 0 && !hasBackupSubPerm()) return false;
        if (sub.id === 'md-lan-network' && userPermissions.length > 0 && !hasPerm('lan:view')) return false;
        return true;
      }
      if (!sub.requiredPermission) return true;
      if (sub.id === 'md-backup-vault') {
        return hasBackupSubPerm();
      }
      if (sub.id === 'md-lan-network') {
        return hasPerm('lan:view');
      }
      // When module is explicitly assigned, allow its non-admin submodules unless hard-denied
      if (Array.isArray(assignedModuleIds) && assignedModuleIds.includes(mod.id)) {
        if (sub.id === 'md-roles' && !hasPerm('roles:manage')) return false;
        return true;
      }
      return hasPerm(sub.requiredPermission);
    });
    return {
      ...mod,
      submodules: filteredSubs
    };
  }).filter(mod => mod.submodules.length > 0);
}

export function isRouteAuthorizedForUser(
  pathname: string, 
  role: LedgerRole, 
  userPermissions: string[] = [], 
  assignedModuleIds?: string[] | null,
  assignedSubmoduleIds?: Record<string, string[]> | null,
  search: string = ''
): boolean {
  if (pathname.startsWith('/launcher') || pathname.startsWith('/login') || pathname.startsWith('/profile')) {
    return true;
  }
  // Active Company Owner has permanent unrestricted route access across all canonical workspace paths
  if (role === 'Company Owner') return true;

  const authorizedModules = getAuthorizedERPModules(role, userPermissions, assignedModuleIds, assignedSubmoduleIds);

  let cleanPath = pathname.split('?')[0];
  if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
    cleanPath = cleanPath.slice(0, -1);
  }
  const inlineQuery = pathname.includes('?') ? pathname.split('?')[1] : '';
  const searchStr = search ? (search.startsWith('?') ? search.slice(1) : search) : inlineQuery;
  const fullRoute = searchStr ? `${cleanPath}?${searchStr}` : cleanPath;

  // 1. Dashboard route check
  if (cleanPath === '/' || cleanPath === '/dashboard') {
    return authorizedModules.some(m => m.id === 'dashboard');
  }

  // 2. Direct /approvals route check
  if (cleanPath === '/approvals' || cleanPath.startsWith('/approvals/')) {
    return authorizedModules.some(m => m.id === 'approvals');
  }

  // 3. Disambiguate /activity-center between Module 13 (approvals), Module 14 (activity-center), and Module 15 (audit)
  if (cleanPath === '/activity-center' || cleanPath.startsWith('/activity-center/')) {
    if (cleanPath !== '/activity-center') {
      return false;
    }
    const params = new URLSearchParams(searchStr);
    const hasWorkspaceParam = params.has('workspace');
    const hasTabParam = params.has('tab');
    const ws = (params.get('workspace') || '').trim().toLowerCase();
    const tab = (params.get('tab') || '').trim().toLowerCase();

    const validWorkspaces = ['stream', 'approvals', 'investigation', 'coverage', 'analytics'];
    const validApprovalTabs = ['inbox', 'pending', 'history', 'workflows', 'delegation', 'sla'];

    if (hasWorkspaceParam && (!ws || !validWorkspaces.includes(ws))) {
      return false;
    }
    if (hasTabParam && (!tab || !validApprovalTabs.includes(tab))) {
      return false;
    }

    if (ws === 'approvals' || (hasTabParam && validApprovalTabs.includes(tab))) {
      return authorizedModules.some(m => m.id === 'approvals');
    }
    if (ws === 'stream' || ws === 'coverage' || ws === 'analytics') {
      return authorizedModules.some(m => m.id === 'activity-center');
    }
    if (ws === 'investigation') {
      return authorizedModules.some(m => m.id === 'audit');
    }
    // Bare /activity-center with no workspace/tab query param: allowed if user has either activity-center or approvals
    return authorizedModules.some(m => m.id === 'activity-center' || m.id === 'approvals');
  }

  // 4. Shared /reports/trial-balance route: valid under either Module 6 (accounting -> acct-tb) or Module 12 (reports -> rep-statements)
  if (cleanPath === '/reports/trial-balance') {
    return authorizedModules.some(m =>
      (m.id === 'accounting' && m.submodules.some(s => s.id === 'acct-tb')) ||
      (m.id === 'reports' && m.submodules.some(s => s.id === 'rep-statements'))
    );
  }

  // 5. Exact full route match (including query parameters) in authorized submodules
  if (authorizedModules.some(m => m.submodules.some(s => s.route === fullRoute))) {
    return true;
  }

  // 6. Find all canonical modules that own a submodule with cleanPath
  const matchingCanonicalModules = CANONICAL_ERP_MODULES.filter(m =>
    m.submodules.some(s => s.route.split('?')[0] === cleanPath)
  );
  if (matchingCanonicalModules.length > 0) {
    return matchingCanonicalModules.some(canonicalMod => {
      const authMod = authorizedModules.find(m => m.id === canonicalMod.id);
      if (!authMod) return false;
      return authMod.submodules.some(s => s.route.split('?')[0] === cleanPath);
    });
  }

  return authorizedModules.some(mod => {
    if (mod.submodules.some(sub => sub.route.split('?')[0] === cleanPath)) {
      return true;
    }
    if (mod.baseRoute !== '/' && (cleanPath === mod.baseRoute || cleanPath.startsWith(mod.baseRoute + '/'))) {
      return true;
    }
    return false;
  });
}
