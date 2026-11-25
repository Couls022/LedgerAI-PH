import { db } from "../db";
import { 
  roles, 
  permissions, 
  rolePermissions, 
  companyUsers, 
  companyUserRoles, 
  userPermissionOverrides, 
  userModuleAssignments,
  userModuleAssignmentHistory,
  roleTemplateVersions,
  sodRestrictions,
  roleCompatibilityRules,
  users,
  departments,
  projects,
  costCenters
} from "../db/schema";
import { eq, and, inArray, desc, or } from "drizzle-orm";
import crypto from "crypto";
import { LedgerRole, normalizeRole } from "../auth";
import { AuditService } from "./auditService";
import { 
  CANONICAL_PERMISSION_CATALOG, 
  ROLE_TEMPLATES_CATALOG, 
  CANONICAL_ROLES_ORDER,
  CanonicalRoleName,
  CanonicalDataScope,
  PermissionOrigin,
  RoleCompatibilityRule,
  normalizeDataScope
} from "../../shared/rbacCatalog";
import { CANONICAL_ERP_MODULES } from "../../shared/moduleRegistry";

export interface PermissionOverride {
  id: string;
  permissionCode: string;
  effect: 'ALLOW' | 'DENY';
  reason?: string | null;
}

export interface MemberRoleAssignmentDetail {
  id: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  roleTemplateVersion: number;
  isPrimary: boolean;
  assignmentStatus: string;
  assignedBy?: string | null;
  assignedAt?: Date | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  assignmentReason?: string | null;
}

export interface ResolvedModuleAccess {
  moduleId: string;
  moduleLabel: string;
  visible: boolean;
  status: 'VISIBLE' | 'PARTIAL' | 'RESTRICTED';
  origin: PermissionOrigin;
  reason: string;
  allowedSubmoduleIds: string[];
  allSubmoduleIds: string[];
  allowedActions: string[];
  deniedActions: string[];
  dataScope: CanonicalDataScope;
  departmentScopeId?: string | null;
  projectScopeId?: string | null;
  costCenterScopeId?: string | null;
  approvalLimitCentavos: number;
  templateVersion: number;
}

export interface ResolvedEffectiveAccess {
  companyUserId: string;
  userId: string;
  companyId: string;
  displayName: string;
  email: string;
  accountStatus: 'ACTIVE' | 'DISABLED' | 'LOCKED';
  membershipStatus: 'ACTIVE' | 'DISABLED' | 'INACTIVE' | 'REMOVED';
  effectiveAccountActive: boolean;
  primaryRole: LedgerRole;
  roles: LedgerRole[];
  assignedRoles: string[];
  additionalRoles: string[];
  allRoleAssignments: MemberRoleAssignmentDetail[];
  roleTemplateVersion: number;
  activeRoleTemplateVersions: Record<string, number>;
  inheritedPermissionsByRole: Record<string, string[]>;
  combinedRolePermissions: string[];
  defaultDataScope: CanonicalDataScope;
  defaultApprovalLimitCentavos: number;
  canApproveFinancialTransactions: boolean;
  canPostToGeneralLedger: boolean;
  isReadOnly: boolean;
  effectiveModuleIds: string[];
  effectiveSubmodulesMap: Record<string, string[]>;
  effectivePermissions: string[];
  effectiveDataScopes: Record<string, CanonicalDataScope>;
  effectiveApprovalLimits: Record<string, number>;
  inheritedPermissions: string[];
  userSpecificGrants: string[];
  userSpecificDenials: string[];
  hardDeniedPermissions: string[];
  sodRestrictions: string[];
  incompatibleRoleWarnings: string[];
  moduleResolutions: ResolvedModuleAccess[];
}

export interface ResolvedDataScopePredicate {
  moduleId: string;
  userId: string;
  membershipId: string;
  dataScope: CanonicalDataScope;
  departmentScopeId: string | null;
  departmentMatches: string[];
  projectScopeId: string | null;
  projectMatches: string[];
  costCenterScopeId: string | null;
  costCenterMatches: string[];
  approvalLimitCentavos: number;
  isCompanyWide: boolean;
  matchesRecord: (record: {
    createdBy?: string | null;
    submittedBy?: string | null;
    assignedTo?: string | null;
    departmentId?: string | null;
    department?: string | null;
    projectId?: string | null;
    project?: string | null;
    costCenterId?: string | null;
    costCenter?: string | null;
  }) => boolean;
  assertRecordAccess: (
    record: {
      createdBy?: string | null;
      submittedBy?: string | null;
      assignedTo?: string | null;
      departmentId?: string | null;
      department?: string | null;
      projectId?: string | null;
      project?: string | null;
      costCenterId?: string | null;
      costCenter?: string | null;
    },
    entityLabel?: string
  ) => void;
}

// Legacy + Canonical Permission Codes Union
const LEGACY_COMPAT_PERMISSIONS: string[] = [
  'company:read', 'company:write', 'company:delete',
  'users:read', 'users:write', 'users:delete', 'users:manage',
  'roles:read', 'roles:write', 'roles:manage',
  'accounts:read', 'accounts:write', 'accounts:delete', 'coa:manage',
  'journals:read', 'journals:create', 'journals:edit', 'journals:submit',
  'journals:review', 'journals:approve', 'journals:post', 'journals:reverse', 'journals:void',
  'accounting:view', 'accounting:create', 'accounting:edit', 'accounting:submit',
  'accounting:review', 'accounting:approve', 'accounting:post', 'accounting:reverse', 'accounting:delete',
  'periods:read', 'periods:close', 'periods:reopen', 'periods:lock',
  'documents:read', 'documents:upload', 'documents:verify', 'documents:delete',
  'documents:view', 'documents:create', 'documents:edit',
  'vendors:read', 'vendors:write', 'vendors:delete',
  'vendors:view', 'vendors:create', 'vendors:edit', 'vendors:delete',
  'customers:read', 'customers:write', 'customers:delete',
  'customers:view', 'customers:create', 'customers:edit', 'customers:delete',
  'sales:read', 'sales:create', 'sales:edit', 'sales:approve', 'sales:post', 'sales:void',
  'sales:view', 'sales:submit', 'sales:review', 'sales:cancel', 'sales:delete',
  'purchases:read', 'purchases:create', 'purchases:edit', 'purchases:approve', 'purchases:post', 'purchases:void',
  'purchases:view', 'purchases:submit', 'purchases:review', 'purchases:cancel', 'purchases:delete',
  'operations:view', 'operations:create', 'operations:edit', 'operations:delete',
  'inventory:read', 'inventory:write', 'inventory:adjust', 'inventory:view', 'inventory:create', 'inventory:edit',
  'fixed_assets:read', 'fixed_assets:write', 'fixed_assets:depreciate', 'fixed_assets:dispose', 'fixedassets:view', 'fixed_assets:manage',
  'payroll:read', 'payroll:write', 'payroll:approve', 'payroll:post', 'payroll:view', 'payroll:manage',
  'bank_rec:read', 'bank_rec:write', 'bank_rec:approve', 'bank_rec:view', 'bank_rec:create', 'bank_rec:edit', 'cash:view',
  'tax:read', 'tax:write', 'tax:Calculate', 'tax:file', 'tax:export_dat',
  'tax:view', 'tax:create', 'tax:edit', 'tax:approve', 'tax:export',
  'reports:read', 'reports:export', 'reports:view',
  'audit:read', 'audit:export', 'audit:verify', 'audit:view', 'audit:manage',
  'backup:view', 'backup:read', 'backup:create', 'backup:restore', 'backup:verify', 'backup:download', 'backup:manage',
  'backups:view', 'backups:read', 'backups:create', 'backups:restore', 'backups:verify', 'backups:download', 'backups:manage',
  'storage:view', 'storage:read', 'storage:cleanup', 'storage:manage',
  'settings:read', 'settings:write', 'settings:view', 'settings:manage',
  'lan:view', 'lan:lock', 'lan:sessions:terminate',
  'masterdata:view', 'masterdata:manage',
  'budget:read', 'budget:write', 'budget:approve', 'budget:view', 'budget:create', 'budget:edit',
  'approvals:view', 'approvals:review', 'approvals:approve',
  'activity:view',
  'ai:config', 'ai:keys:manage', 'ai:provider:test', 'ai:inquiry', 'ai:inquiry:sensitive',
  'audit:integrity:scan', 'audit:integrity:view', 'audit:integrity:export', 'audit:integrity:remediate'
];

export const ALL_PERMISSIONS: string[] = Array.from(new Set([
  ...CANONICAL_PERMISSION_CATALOG.map(p => p.code),
  ...LEGACY_COMPAT_PERMISSIONS
]));

const DATA_SCOPE_RESTRICTIVENESS: Record<CanonicalDataScope, number> = {
  EXPLICIT_RECORDS: 1,
  OWN_RECORDS: 2,
  ASSIGNED_RECORDS: 3,
  COST_CENTER: 4,
  PROJECT: 5,
  DEPARTMENT: 6,
  COMPANY_WIDE: 7
};

/**
 * Synchronize legacy colon aliases from canonical permissions.
 */
function expandLegacyAliases(perms: Iterable<string>): Set<string> {
  const set = new Set<string>(perms);
  if (set.has('accounting:view')) { set.add('accounts:read'); set.add('journals:read'); set.add('periods:read'); set.add('operations:view'); }
  if (set.has('accounting:create')) { set.add('journals:create'); set.add('accounts:write'); }
  if (set.has('accounting:edit')) { set.add('journals:edit'); set.add('accounts:write'); set.add('coa:manage'); }
  if (set.has('accounting:submit')) { set.add('journals:submit'); }
  if (set.has('accounting:review')) { set.add('journals:review'); }
  if (set.has('accounting:approve')) { set.add('journals:approve'); }
  if (set.has('accounting:post')) { set.add('journals:post'); }
  if (set.has('accounting:reverse')) { set.add('journals:reverse'); }

  if (set.has('sales:view')) { set.add('sales:read'); }
  if (set.has('sales:post')) { set.add('sales:post'); }
  if (set.has('purchases:view')) { set.add('purchases:read'); }
  if (set.has('purchases:create') || set.has('purchases:edit')) { set.add('procurement:manage'); }
  if (set.has('purchases:post')) { set.add('purchases:post'); }

  if (set.has('inventory:view')) { set.add('inventory:read'); set.add('operations:view'); }
  if (set.has('inventory:create') || set.has('inventory:edit')) { set.add('inventory:write'); set.add('inventory:adjust'); set.add('inventory:manage'); set.add('operations:create'); set.add('operations:edit'); }

  if (set.has('cash:view') || set.has('bank_rec:view')) { set.add('bank_rec:read'); set.add('cash:view'); set.add('operations:view'); }
  if (set.has('bank_rec:create') || set.has('bank_rec:edit')) { set.add('bank_rec:write'); set.add('cash:manage'); set.add('operations:create'); set.add('operations:edit'); }

  if (set.has('fixedassets:view')) { set.add('fixed_assets:read'); set.add('fixed_assets:view'); set.add('operations:view'); }
  if (set.has('fixed_assets:manage')) { set.add('fixedassets:manage'); set.add('fixed_assets:write'); set.add('fixed_assets:depreciate'); set.add('fixed_assets:dispose'); set.add('operations:create'); set.add('operations:edit'); }

  if (set.has('payroll:view')) { set.add('payroll:read'); set.add('operations:view'); }
  if (set.has('payroll:manage') || set.has('payroll:process')) { set.add('payroll:manage'); set.add('payroll:process'); set.add('payroll:write'); set.add('payroll:approve'); set.add('payroll:post'); set.add('operations:create'); set.add('operations:edit'); }

  if (set.has('tax:view')) { set.add('tax:read'); }
  if (set.has('tax:create') || set.has('tax:edit') || set.has('tax:manage')) { set.add('tax:write'); set.add('tax:manage'); set.add('tax:Calculate'); set.add('tax:file'); }
  if (set.has('tax:export')) { set.add('tax:export_dat'); }

  if (set.has('budget:view')) { set.add('budget:read'); set.add('operations:view'); }
  if (set.has('budget:create') || set.has('budget:edit')) { set.add('budget:write'); set.add('operations:create'); set.add('operations:edit'); }

  if (set.has('documents:view')) { set.add('documents:read'); }
  if (set.has('documents:create') || set.has('documents:edit')) { set.add('documents:upload'); }

  if (set.has('reports:view')) { set.add('reports:read'); }
  if (set.has('audit:view')) { set.add('audit:read'); }
  if (set.has('audit:manage')) { set.add('audit:verify'); }

  if (set.has('customers:view')) { set.add('customers:read'); }
  if (set.has('customers:create') || set.has('customers:edit')) { set.add('customers:write'); }
  if (set.has('vendors:view')) { set.add('vendors:read'); }
  if (set.has('vendors:create') || set.has('vendors:edit')) { set.add('vendors:write'); }

  if (set.has('users:view')) { set.add('users:read'); set.add('roles:read'); }
  if (set.has('users:manage')) { set.add('users:write'); set.add('users:delete'); }
  if (set.has('roles:manage')) { set.add('roles:write'); }
  if (set.has('masterdata:view')) { set.add('company:read'); set.add('lan:view'); }
  if (set.has('masterdata:manage')) { set.add('company:write'); set.add('lan:view'); set.add('lan:sessions:terminate'); set.add('lan:lock'); }
  if (set.has('settings:view')) { set.add('settings:read'); set.add('company:read'); set.add('lan:view'); }
  if (set.has('settings:manage') || set.has('settings:write')) { set.add('settings:view'); set.add('settings:read'); set.add('lan:view'); set.add('lan:sessions:terminate'); set.add('lan:lock'); set.add('ai:config'); set.add('ai:provider:test'); }
  if (set.has('dashboard:view') || set.has('accounting:view') || set.has('sales:view') || set.has('purchases:view') || set.has('reports:view') || set.has('audit:view')) {
    set.add('ai:inquiry');
  }
  if (set.has('payroll:view') || set.has('payroll:read') || set.has('payroll:manage')) {
    set.add('ai:inquiry:sensitive');
  }
  if (set.has('audit:view') || set.has('audit:read')) {
    set.add('audit:integrity:view');
  }
  if (set.has('audit:export')) {
    set.add('audit:integrity:export');
  }
  if (set.has('audit:manage')) {
    set.add('audit:integrity:scan');
    set.add('audit:integrity:remediate');
  }
  if (set.has('backup:manage') || set.has('backups:manage')) {
    set.add('backup:manage');
    set.add('backups:manage');
    set.add('backup:view');
    set.add('backups:view');
    set.add('backup:read');
    set.add('backups:read');
    set.add('backup:create');
    set.add('backups:create');
    set.add('backup:restore');
    set.add('backups:restore');
    set.add('backup:verify');
    set.add('backups:verify');
    set.add('backup:download');
    set.add('backups:download');
    set.add('storage:view');
    set.add('storage:read');
    set.add('storage:cleanup');
    set.add('storage:manage');
  }
  if (set.has('storage:manage')) {
    set.add('storage:manage');
    set.add('storage:view');
    set.add('storage:read');
    set.add('storage:cleanup');
  }
  if (set.has('backup:view') || set.has('backups:view') || set.has('backup:read') || set.has('backups:read')) {
    set.add('backup:view');
    set.add('backups:view');
    set.add('backup:read');
    set.add('backups:read');
  }
  if (set.has('backup:create') || set.has('backups:create')) {
    set.add('backup:create');
    set.add('backups:create');
  }
  if (set.has('backup:restore') || set.has('backups:restore')) {
    set.add('backup:restore');
    set.add('backups:restore');
  }
  if (set.has('backup:verify') || set.has('backups:verify')) {
    set.add('backup:verify');
    set.add('backups:verify');
  }
  if (set.has('backup:download') || set.has('backups:download')) {
    set.add('backup:download');
    set.add('backups:download');
  }
  if (set.has('storage:view') || set.has('storage:read')) {
    set.add('storage:view');
    set.add('storage:read');
  }
  if (set.has('storage:cleanup')) {
    set.add('storage:cleanup');
  }
  return set;
}

/**
 * Authoritative legacy colon aliases mapped to canonical module actions.
 */
function getLegacyAliasesForModuleAction(moduleId: string, action: string): string[] {
  const result: string[] = [];
  if (moduleId === 'dashboard') {
    if (action === 'view') result.push('dashboard:view');
    if (action === 'export') result.push('dashboard:export');
  } else if (moduleId === 'sales') {
    if (action === 'view') result.push('sales:view', 'sales:read', 'invoices:view', 'invoices:read', 'customers:view', 'customers:read');
    if (action === 'create') result.push('sales:create', 'invoices:create', 'customers:create');
    if (action === 'edit') result.push('sales:edit', 'invoices:edit', 'customers:edit');
    if (action === 'submit') result.push('sales:submit', 'invoices:submit');
    if (action === 'review') result.push('sales:review', 'invoices:review');
    if (action === 'approve') result.push('sales:approve', 'invoices:approve');
    if (action === 'post') result.push('sales:post', 'invoices:post');
    if (action === 'cancel') result.push('sales:cancel', 'invoices:cancel');
    if (action === 'delete') result.push('sales:delete', 'invoices:delete');
  } else if (moduleId === 'procurement') {
    if (action === 'view') result.push('purchases:view', 'purchasing:view', 'purchases:read', 'procurement:read', 'bills:view', 'vendors:view');
    if (action === 'create') result.push('purchases:create', 'purchasing:create', 'procurement:manage', 'bills:create', 'vendors:create');
    if (action === 'edit') result.push('purchases:edit', 'purchasing:edit', 'procurement:manage', 'bills:edit', 'vendors:edit');
    if (action === 'submit') result.push('purchases:submit', 'bills:submit');
    if (action === 'review') result.push('purchases:review', 'bills:review');
    if (action === 'approve') result.push('purchases:approve', 'bills:approve');
    if (action === 'post') result.push('purchases:post', 'bills:post');
    if (action === 'cancel') result.push('purchases:cancel', 'bills:cancel');
    if (action === 'delete') result.push('purchases:delete', 'bills:delete');
  } else if (moduleId === 'inventory') {
    if (action === 'view') result.push('inventory:view', 'inventory:read', 'operations:view');
    if (action === 'create') result.push('inventory:create', 'inventory:write', 'inventory:adjust', 'operations:create');
    if (action === 'edit') result.push('inventory:edit', 'inventory:write', 'inventory:adjust', 'inventory:manage', 'operations:edit');
  } else if (moduleId === 'cash-banking') {
    if (action === 'view') result.push('cash:view', 'bank_rec:view', 'bank_rec:read', 'bank:view', 'operations:view');
    if (action === 'create') result.push('bank_rec:create', 'cash:create', 'operations:create');
    if (action === 'edit') result.push('bank_rec:edit', 'cash:manage', 'bank_rec:write', 'operations:edit');
    if (action === 'approve') result.push('cash:approve', 'bank_rec:approve');
  } else if (moduleId === 'accounting') {
    if (action === 'view') result.push('accounting:view', 'accounts:read', 'journals:read', 'periods:read', 'operations:view');
    if (action === 'create') result.push('accounting:create', 'journals:create', 'accounts:write');
    if (action === 'edit') result.push('accounting:edit', 'journals:edit', 'accounts:write', 'coa:manage');
    if (action === 'submit') result.push('accounting:submit', 'journals:submit');
    if (action === 'review') result.push('accounting:review', 'journals:review');
    if (action === 'approve') result.push('accounting:approve', 'journals:approve');
    if (action === 'post') result.push('accounting:post', 'journals:post');
    if (action === 'reverse') result.push('accounting:reverse', 'journals:reverse');
    if (action === 'delete') result.push('accounting:delete');
    if (action === 'manage') result.push('accounting:manage');
    if (action === 'export') result.push('accounting:export', 'reports:export', 'reports:view');
    if (action === 'restore') result.push('accounting:restore');
  } else if (moduleId === 'fixed-assets') {
    if (action === 'view') result.push('fixedassets:view', 'fixed_assets:view', 'fixed_assets:read', 'operations:view');
    if (action === 'manage') result.push('fixedassets:manage', 'fixed_assets:manage', 'fixed_assets:write', 'fixed_assets:depreciate', 'fixed_assets:dispose', 'operations:create', 'operations:edit');
  } else if (moduleId === 'payroll') {
    if (action === 'view') result.push('payroll:view', 'payroll:read', 'operations:view');
    if (action === 'manage') result.push('payroll:manage', 'payroll:process', 'payroll:write', 'payroll:approve', 'payroll:post', 'operations:create', 'operations:edit');
  } else if (moduleId === 'tax') {
    if (action === 'view') result.push('tax:view', 'tax:read');
    if (action === 'create') result.push('tax:create', 'tax:write');
    if (action === 'edit') result.push('tax:edit', 'tax:write', 'tax:manage', 'tax:Calculate');
    if (action === 'approve') result.push('tax:approve', 'tax:file');
    if (action === 'export') result.push('tax:export', 'tax:export_dat');
  } else if (moduleId === 'budget') {
    if (action === 'view') result.push('budget:view', 'budget:read', 'operations:view');
    if (action === 'create') result.push('budget:create', 'budget:write', 'operations:create');
    if (action === 'approve') result.push('budget:approve');
  } else if (moduleId === 'documents') {
    if (action === 'view') result.push('documents:view', 'documents:read');
    if (action === 'create') result.push('documents:create');
    if (action === 'edit') result.push('documents:edit');
    if (action === 'review') result.push('documents:review', 'documents:verify');
    if (action === 'delete') result.push('documents:delete');
  } else if (moduleId === 'reports') {
    if (action === 'view') result.push('reports:view');
    if (action === 'export') result.push('reports:export');
  } else if (moduleId === 'approvals') {
    if (action === 'view') result.push('approvals:view');
    if (action === 'review') result.push('approvals:review');
    if (action === 'approve') result.push('approvals:approve');
  } else if (moduleId === 'activity-center') {
    if (action === 'view') result.push('activity:view');
  } else if (moduleId === 'audit') {
    if (action === 'view') result.push('audit:view');
    if (action === 'export') result.push('audit:export');
  } else if (moduleId === 'master-data') {
    if (action === 'view') {
      result.push(
        'masterdata:view', 'masterdata:read',
        'users:view', 'users:read',
        'roles:view', 'roles:read',
        'settings:view', 'settings:read'
      );
    }
    if (action === 'create') result.push('masterdata:create', 'users:create');
    if (action === 'edit') result.push('masterdata:edit', 'users:edit', 'settings:edit');
    if (action === 'manage') {
      result.push(
        'masterdata:manage', 'roles:manage', 'settings:manage'
      );
    }
  }
  result.push(`${moduleId}:${action}`);
  return Array.from(new Set(result));
}

function buildSystemRolePermissions(role: LedgerRole): string[] {
  const tpl = ROLE_TEMPLATES_CATALOG[role] || ROLE_TEMPLATES_CATALOG['Read-only User'];
  if (role === 'Company Owner') {
    return Array.from(new Set(['*', ...ALL_PERMISSIONS]));
  }
  const set = expandLegacyAliases(tpl.defaultPermissionCodes);
  for (const denied of tpl.hardDeniedPermissionCodes) {
    set.delete(denied);
  }
  const result = Array.from(set);
  if (role === 'Bookkeeper') {
    console.log(`[RBAC Debug] Built Bookkeeper perms:`, result);
  }
  return result;
}

export const SYSTEM_ROLE_PERMISSIONS: Record<LedgerRole, string[]> = {
  'Company Owner': buildSystemRolePermissions('Company Owner'),
  'Company Administrator': buildSystemRolePermissions('Company Administrator'),
  'Accountant': buildSystemRolePermissions('Accountant'),
  'Bookkeeper': buildSystemRolePermissions('Bookkeeper'),
  'Approver': buildSystemRolePermissions('Approver'),
  'Reviewer': buildSystemRolePermissions('Reviewer'),
  'Auditor': buildSystemRolePermissions('Auditor'),
  'Tax & AP Specialist': buildSystemRolePermissions('Tax & AP Specialist'),
  'Read-only User': buildSystemRolePermissions('Read-only User')
};

// Incompatible Segregation of Duties (SoD) role combinations
export const INCOMPATIBLE_ROLE_PAIRS: Array<[LedgerRole, LedgerRole, string]> = [
  ['Bookkeeper', 'Approver', 'Segregation of Duties (SoD): A Bookkeeper who prepares transactions cannot simultaneously hold the Approver role.'],
  ['Bookkeeper', 'Auditor', 'Segregation of Duties (SoD): A Bookkeeper who records transactions cannot audit their own entries as an Auditor.'],
  ['Accountant', 'Auditor', 'Segregation of Duties (SoD): An Accountant who posts and reconciles ledgers cannot act as an independent Auditor.'],
  ['Approver', 'Auditor', 'Segregation of Duties (SoD): An Approver who authorizes financial transactions cannot act as an independent Auditor.'],
  ['Reviewer', 'Approver', 'Segregation of Duties (SoD): Pre-approval Reviewer and final Approver responsibilities must be separated.'],
  ['Tax & AP Specialist', 'Auditor', 'Segregation of Duties (SoD): A Tax & AP Specialist cannot act as an independent Auditor.'],
  ['Company Administrator', 'Auditor', 'Segregation of Duties (SoD): A System Administrator cannot simultaneously act as an independent Auditor to preserve objective oversight.']
];

export const DEFAULT_COMPATIBILITY_RULES: Array<{
  roleA: string;
  roleB: string;
  compatibilityType: 'ALLOWED' | 'RESTRICTED' | 'PROHIBITED';
  reason: string;
}> = [
  { roleA: 'Bookkeeper', roleB: 'Approver', compatibilityType: 'PROHIBITED', reason: 'Segregation of Duties (SoD): Transaction preparer (Bookkeeper) cannot hold financial transaction approval authority (Approver).' },
  { roleA: 'Auditor', roleB: 'Bookkeeper', compatibilityType: 'PROHIBITED', reason: 'Segregation of Duties (SoD): Independent Auditor cannot simultaneously hold Bookkeeper transaction recording authority.' },
  { roleA: 'Accountant', roleB: 'Auditor', compatibilityType: 'PROHIBITED', reason: 'Segregation of Duties (SoD): General Ledger Accountant cannot act as an independent Auditor.' },
  { roleA: 'Approver', roleB: 'Auditor', compatibilityType: 'PROHIBITED', reason: 'Segregation of Duties (SoD): Transaction Approver cannot act as an independent Auditor.' },
  { roleA: 'Reviewer', roleB: 'Approver', compatibilityType: 'PROHIBITED', reason: 'Segregation of Duties (SoD): Pre-approval Reviewer and final Approver responsibilities must be separated.' },
  { roleA: 'Tax & AP Specialist', roleB: 'Auditor', compatibilityType: 'PROHIBITED', reason: 'Segregation of Duties (SoD): Independent Auditor cannot simultaneously hold Tax & AP Specialist recording authority.' },
  { roleA: 'Accountant', roleB: 'Reviewer', compatibilityType: 'RESTRICTED', reason: 'Allowed for distinct transaction responsibilities; Segregation of Duties strictly prohibits self-review of own prepared journals.' },
  { roleA: 'Tax & AP Specialist', roleB: 'Accountant', compatibilityType: 'RESTRICTED', reason: 'Allowed for distinct accounting responsibilities; Segregation of Duties strictly prohibits self-review of tax and payables entries.' },
  { roleA: 'Tax & AP Specialist', roleB: 'Approver', compatibilityType: 'RESTRICTED', reason: 'Allowed with strict monetary limits; AP entry preparer cannot approve high-value invoices without secondary approval.' },
  { roleA: 'Company Administrator', roleB: 'Accountant', compatibilityType: 'RESTRICTED', reason: 'Allowed only via explicit authorized assignment; subject to Segregation of Duties and audit logging.' },
  { roleA: 'Bookkeeper', roleB: 'Accountant', compatibilityType: 'ALLOWED', reason: 'Compatible operational recording and accounting preparation roles.' },
  { roleA: 'Tax & AP Specialist', roleB: 'Bookkeeper', compatibilityType: 'ALLOWED', reason: 'Compatible operational recording and payables preparation roles.' },
  { roleA: 'Approver', roleB: 'Company Administrator', compatibilityType: 'ALLOWED', reason: 'Compatible administrative governance and workflow approval roles.' },
  { roleA: 'Reviewer', roleB: 'Company Administrator', compatibilityType: 'ALLOWED', reason: 'Compatible administrative governance and review roles.' }
];

export class RbacService {
  /**
   * Resolve role name preserving custom role names while normalizing the 8 standard roles.
   */
  static resolveCanonicalOrCustomRoleName(input?: string | null): string {
    if (!input || !input.trim()) return 'Read-only User';
    const trimmed = input.trim();
    const upper = trimmed.toUpperCase();

    // Direct match on canonical 8 roles
    for (const r of CANONICAL_ROLES_ORDER) {
      if (r.toLowerCase() === trimmed.toLowerCase()) return r;
      const tpl = ROLE_TEMPLATES_CATALOG[r];
      if (tpl && tpl.roleCode.toUpperCase() === upper) return r;
    }

    // Legacy code matches
    if (upper === 'OWNER' || upper === 'COMPANY_OWNER' || upper === 'SUPER_ADMIN') return 'Company Owner';
    if (upper === 'ADMIN' || upper === 'COMPANY_ADMIN' || upper === 'COMPANY_ADMINISTRATOR') return 'Company Administrator';
    if (upper === 'ACCOUNTANT' || upper === 'EDITOR') return 'Accountant';
    if (upper === 'BOOKKEEPER') return 'Bookkeeper';
    if (upper === 'AUDITOR') return 'Auditor';
    if (upper === 'REVIEWER') return 'Reviewer';
    if (upper === 'APPROVER') return 'Approver';
    if (upper === 'TAX_AP_SPECIALIST' || upper === 'TAX & AP SPECIALIST' || upper === 'TAX_SPECIALIST' || upper === 'AP_SPECIALIST') return 'Tax & AP Specialist';
    if (upper === 'READ_ONLY' || upper === 'READ_ONLY_USER' || upper === 'VIEWER') return 'Read-only User';

    // Otherwise preserve custom role name
    return trimmed;
  }

  /**
   * Ensure all 8 canonical role templates and default compatibility rules are seeded.
   */
  static async ensureRoleTemplatesSeeded() {
    try {
      const existing = await db.select().from(roleTemplateVersions);
      const existingRoles = new Set(existing.map((r: any) => r.roleName));

      for (const roleName of CANONICAL_ROLES_ORDER) {
        if (!existingRoles.has(roleName)) {
          const tpl = ROLE_TEMPLATES_CATALOG[roleName];
          await db.insert(roleTemplateVersions).values({
            id: crypto.randomUUID(),
            roleCode: tpl.roleCode,
            roleName: tpl.roleName,
            versionNumber: 1,
            isActive: true,
            isCustom: false,
            status: 'PUBLISHED',
            purpose: tpl.purpose,
            modulesJson: JSON.stringify(tpl.defaultPrimaryModules),
            submodulesJson: JSON.stringify(tpl.defaultSubmodules),
            permissionsJson: JSON.stringify(SYSTEM_ROLE_PERMISSIONS[roleName]),
            hardDeniedJson: JSON.stringify(tpl.hardDeniedPermissionCodes),
            dataScope: tpl.defaultDataScope,
            approvalLimitCentavos: tpl.defaultApprovalLimitCentavos,
            restrictionsJson: JSON.stringify(tpl.sodRestrictions),
            changeReason: 'Initial Enterprise Canonical Role Permissions Catalog v1',
            changedBy: 'SYSTEM',
            changedByName: 'System Governance Engine',
            approvedBy: 'SYSTEM'
          }).catch(() => {});
        }
      }

      // Seed compatibility rules
      const existingCompat = await db.select().from(roleCompatibilityRules).catch(() => []);
      if (existingCompat.length === 0) {
        for (const rule of DEFAULT_COMPATIBILITY_RULES) {
          await db.insert(roleCompatibilityRules).values({
            id: crypto.randomUUID(),
            roleA: rule.roleA,
            roleB: rule.roleB,
            compatibilityType: rule.compatibilityType,
            reason: rule.reason
          }).catch(() => {});
          // Also seed symmetric pair
          await db.insert(roleCompatibilityRules).values({
            id: crypto.randomUUID(),
            roleA: rule.roleB,
            roleB: rule.roleA,
            compatibilityType: rule.compatibilityType,
            reason: rule.reason
          }).catch(() => {});
        }
      }
    } catch (_) {
      // Safe fallback if table is still migrating
    }
  }

  /**
   * Get the currently active Role Template Version for a standard or custom role from SQLite (or fallback to catalog).
   */
  static async getActiveRoleTemplate(roleName: string) {
    await this.ensureRoleTemplatesSeeded();
    const resolvedName = this.resolveCanonicalOrCustomRoleName(roleName);
    const isStandard = (CANONICAL_ROLES_ORDER as string[]).includes(resolvedName);
    const catalogTpl = isStandard
      ? ROLE_TEMPLATES_CATALOG[resolvedName as CanonicalRoleName]
      : ROLE_TEMPLATES_CATALOG['Read-only User'];

    try {
      const activeRow = await db
        .select()
        .from(roleTemplateVersions)
        .where(and(eq(roleTemplateVersions.roleName, resolvedName), eq(roleTemplateVersions.isActive, true)))
        .orderBy(desc(roleTemplateVersions.versionNumber))
        .get();

      if (activeRow) {
        const modules: string[] = JSON.parse(activeRow.modulesJson || '[]');
        const submodules: Record<string, string[]> = JSON.parse(activeRow.submodulesJson || '{}');
        const rawPerms: string[] = JSON.parse(activeRow.permissionsJson || '[]');
        const mergedRawPerms = isStandard && activeRow.versionNumber === 1
          ? Array.from(new Set([...rawPerms, ...(catalogTpl.defaultPermissionCodes || [])]))
          : rawPerms;
        const perms = resolvedName === 'Company Owner'
          ? Array.from(new Set(['*', ...ALL_PERMISSIONS]))
          : Array.from(expandLegacyAliases(mergedRawPerms.filter(p => p !== '*')));
        const hardDenied: string[] = (isStandard && activeRow.versionNumber === 1)
          ? catalogTpl.hardDeniedPermissionCodes
          : (activeRow.hardDeniedJson ? JSON.parse(activeRow.hardDeniedJson) : catalogTpl.hardDeniedPermissionCodes);
        const restrictions: string[] = activeRow.restrictionsJson ? JSON.parse(activeRow.restrictionsJson) : catalogTpl.sodRestrictions;
        const limitCentavos = activeRow.approvalLimitCentavos ?? catalogTpl.defaultApprovalLimitCentavos;

        return {
          id: activeRow.id,
          roleCode: activeRow.roleCode,
          roleName: activeRow.roleName,
          versionNumber: activeRow.versionNumber,
          isActive: Boolean(activeRow.isActive),
          isCustom: Boolean(activeRow.isCustom),
          clonedFrom: activeRow.clonedFrom || null,
          status: (activeRow.status || 'PUBLISHED') as 'PUBLISHED' | 'DRAFT' | 'ARCHIVED',
          purpose: activeRow.purpose || catalogTpl.purpose,
          defaultPrimaryModules: modules,
          defaultSubmodules: submodules,
          defaultPermissionCodes: perms,
          hardDeniedPermissionCodes: hardDenied,
          hardRestrictedModuleIds: isStandard ? catalogTpl.hardRestrictedModuleIds : [],
          defaultDataScope: normalizeDataScope(activeRow.dataScope),
          defaultApprovalLimitCentavos: limitCentavos,
          canApproveFinancialTransactions: resolvedName === 'Company Owner' || limitCentavos > 0 || perms.some(p => p.endsWith(':approve')),
          canPostToGeneralLedger: resolvedName === 'Company Owner' || perms.includes('accounting:post') || perms.includes('journals:post'),
          isReadOnlyRole: isStandard ? catalogTpl.isReadOnlyRole : false,
          sodRestrictions: restrictions,
          financialAuthoritySummary: isStandard
            ? catalogTpl.financialAuthoritySummary
            : (limitCentavos > 0 ? `Custom Role Approval Limit: ₱${(limitCentavos / 100).toLocaleString()}` : 'Custom Operational Role'),
          changeReason: activeRow.changeReason,
          changedByName: activeRow.changedByName,
          createdAt: activeRow.createdAt
        };
      }
    } catch (_) {}

    const norm = normalizeRole(resolvedName);
    const stdTpl = ROLE_TEMPLATES_CATALOG[norm] || ROLE_TEMPLATES_CATALOG['Read-only User'];
    return {
      id: `catalog-${stdTpl.roleCode}`,
      roleCode: stdTpl.roleCode,
      roleName: norm,
      versionNumber: 1,
      isActive: true,
      isCustom: false,
      clonedFrom: null,
      status: 'PUBLISHED' as const,
      purpose: stdTpl.purpose,
      defaultPrimaryModules: stdTpl.defaultPrimaryModules,
      defaultSubmodules: stdTpl.defaultSubmodules,
      defaultPermissionCodes: SYSTEM_ROLE_PERMISSIONS[norm] || stdTpl.defaultPermissionCodes,
      hardDeniedPermissionCodes: stdTpl.hardDeniedPermissionCodes,
      hardRestrictedModuleIds: stdTpl.hardRestrictedModuleIds,
      defaultDataScope: stdTpl.defaultDataScope,
      defaultApprovalLimitCentavos: stdTpl.defaultApprovalLimitCentavos,
      canApproveFinancialTransactions: stdTpl.canApproveFinancialTransactions,
      canPostToGeneralLedger: stdTpl.canPostToGeneralLedger,
      isReadOnlyRole: stdTpl.isReadOnlyRole,
      sodRestrictions: stdTpl.sodRestrictions,
      financialAuthoritySummary: stdTpl.financialAuthoritySummary,
      changeReason: 'Default Catalog v1',
      changedByName: 'System',
      createdAt: new Date()
    };
  }

  /**
   * Get all active role templates (8 standard roles + active custom roles) and their version history.
   */
  static async getAllActiveRoleTemplates(includeArchivedCustom = false) {
    await this.ensureRoleTemplatesSeeded();
    const templates = [];
    for (const roleName of CANONICAL_ROLES_ORDER) {
      const tpl = await this.getActiveRoleTemplate(roleName);
      const history = await this.getRoleTemplateHistory(roleName);
      templates.push({
        ...tpl,
        history
      });
    }

    // Load custom role templates from role_template_versions
    try {
      const allRows = await db
        .select()
        .from(roleTemplateVersions)
        .orderBy(desc(roleTemplateVersions.versionNumber));

      const seenCustomNames = new Set<string>();
      for (const r of allRows) {
        if ((CANONICAL_ROLES_ORDER as string[]).includes(r.roleName)) continue;
        if (seenCustomNames.has(r.roleName)) continue;
        if (!includeArchivedCustom && r.status === 'ARCHIVED') continue;
        if (!r.isActive && r.status !== 'ARCHIVED') continue;

        seenCustomNames.add(r.roleName);
        const tpl = await this.getActiveRoleTemplate(r.roleName);
        const history = await this.getRoleTemplateHistory(r.roleName);
        templates.push({
          ...tpl,
          isCustom: true,
          clonedFrom: r.clonedFrom || null,
          status: r.status || 'PUBLISHED',
          history
        });
      }
    } catch (_) {}

    return templates;
  }

  /**
   * Get version history for a specific role template (standard or custom).
   */
  static async getRoleTemplateHistory(roleName: string) {
    const resolvedName = this.resolveCanonicalOrCustomRoleName(roleName);
    try {
      const rows = await db
        .select()
        .from(roleTemplateVersions)
        .where(eq(roleTemplateVersions.roleName, resolvedName))
        .orderBy(desc(roleTemplateVersions.versionNumber));

      return rows.map((r: any) => ({
        id: r.id,
        roleCode: r.roleCode,
        roleName: r.roleName,
        versionNumber: r.versionNumber,
        isActive: Boolean(r.isActive),
        isCustom: Boolean(r.isCustom),
        clonedFrom: r.clonedFrom || null,
        status: r.status || 'PUBLISHED',
        purpose: r.purpose,
        defaultPrimaryModules: JSON.parse(r.modulesJson || '[]'),
        defaultSubmodules: JSON.parse(r.submodulesJson || '{}'),
        defaultPermissionCodes: JSON.parse(r.permissionsJson || '[]'),
        hardDeniedPermissionCodes: r.hardDeniedJson ? JSON.parse(r.hardDeniedJson) : [],
        defaultDataScope: normalizeDataScope(r.dataScope),
        defaultApprovalLimitCentavos: r.approvalLimitCentavos,
        sodRestrictions: r.restrictionsJson ? JSON.parse(r.restrictionsJson) : [],
        changeReason: r.changeReason,
        changedBy: r.changedBy,
        changedByName: r.changedByName,
        approvedBy: r.approvedBy,
        createdAt: r.createdAt
      }));
    } catch (_) {
      return [];
    }
  }

  static verifySegregationOfDuties(roles: string[]): void {
    const norm = roles.map(r => this.resolveCanonicalOrCustomRoleName(r));
    for (let i = 0; i < norm.length; i++) {
      for (let j = i + 1; j < norm.length; j++) {
        const rA = norm[i] as LedgerRole;
        const rB = norm[j] as LedgerRole;
        for (const pair of INCOMPATIBLE_ROLE_PAIRS) {
          if ((pair[0] === rA && pair[1] === rB) || (pair[0] === rB && pair[1] === rA)) {
            throw new Error(`SOD Violation: ${pair[2]}`);
          }
        }
      }
    }
  }

  /**
   * Create or clone a Custom Role in the Role Permissions Catalog.
   * Enforces Standard Role Protection: custom roles cannot impersonate Company Owner or recreate unrestricted Owner privileges.
   */
  static async createOrCloneCustomRole(
    req: any,
    params: {
      roleName: string;
      roleCode?: string;
      purpose?: string;
      clonedFrom?: string;
      defaultPrimaryModules?: string[];
      defaultSubmodules?: Record<string, string[]>;
      defaultPermissionCodes?: string[];
      defaultDataScope?: CanonicalDataScope;
      defaultApprovalLimitCentavos?: number;
      sodRestrictions?: string[];
      changeReason: string;
    }
  ) {
    const rawName = (params.roleName || '').trim();
    if (!rawName || rawName.length < 3) {
      throw new Error("Custom role name must be at least 3 characters long.");
    }

    const upperName = rawName.toUpperCase();
    if (
      upperName.includes('COMPANY OWNER') ||
      upperName === 'OWNER' ||
      upperName === 'SUPER ADMIN' ||
      (CANONICAL_ROLES_ORDER as string[]).some(r => r.toLowerCase() === rawName.toLowerCase())
    ) {
      throw new Error(`Security Restriction: Cannot create a custom role using protected system role name '${rawName}' or impersonating Company Owner.`);
    }

    if (params.clonedFrom && params.clonedFrom.trim().toLowerCase() === 'company owner') {
      throw new Error("Security Restriction: Protected 'Company Owner' role cannot be cloned into a custom role.");
    }

    // Check if custom role name already exists
    const existing = await db
      .select()
      .from(roleTemplateVersions)
      .where(eq(roleTemplateVersions.roleName, rawName))
      .get();
    if (existing && existing.status !== 'ARCHIVED') {
      throw new Error(`A role named '${rawName}' already exists in the catalog.`);
    }

    let baseModules: string[] = ['dashboard'];
    let baseSubmodules: Record<string, string[]> = { 'dashboard': ['dash-overview'] };
    let basePerms: string[] = ['dashboard:view'];
    let baseHardDenied: string[] = ['users:manage', 'roles:manage', 'settings:manage', 'backup:manage'];
    let baseScope: CanonicalDataScope = 'COMPANY_WIDE';
    let baseLimit = 0;
    let baseRestrictions: string[] = [
      'Custom role cannot bypass Segregation of Duties (SoD) or impersonate Company Owner.',
      'Cannot alter or delete immutable audit logs.'
    ];

    if (params.clonedFrom) {
      const sourceTpl = await this.getActiveRoleTemplate(params.clonedFrom);
      baseModules = [...sourceTpl.defaultPrimaryModules];
      baseSubmodules = { ...sourceTpl.defaultSubmodules };
      basePerms = sourceTpl.defaultPermissionCodes.filter((p: string) => p !== '*');
      baseHardDenied = [...sourceTpl.hardDeniedPermissionCodes];
      baseScope = sourceTpl.defaultDataScope;
      baseLimit = sourceTpl.defaultApprovalLimitCentavos === -1 ? 0 : sourceTpl.defaultApprovalLimitCentavos;
      baseRestrictions = [...sourceTpl.sodRestrictions];
    }

    // Strip any wildcard or protected ownership escalation permissions from custom role
    const finalModules = (params.defaultPrimaryModules || baseModules).filter(m =>
      CANONICAL_ERP_MODULES.some(cm => cm.id === m)
    );
    const finalSubmodules = params.defaultSubmodules || baseSubmodules;
    // Custom roles cannot include md-roles (RBAC governance) to prevent privilege escalation
    if (finalSubmodules['master-data']) {
      finalSubmodules['master-data'] = finalSubmodules['master-data'].filter(s => s !== 'md-roles');
    }

    const finalPerms = Array.from(
      expandLegacyAliases(
        (params.defaultPermissionCodes || basePerms).filter(
          p => p !== '*' && p !== 'roles:manage' && p !== 'roles:write' && p !== 'users:manage' && p !== 'users:delete'
        )
      )
    );

    const finalLimit = params.defaultApprovalLimitCentavos !== undefined ? params.defaultApprovalLimitCentavos : baseLimit;
    if (finalLimit === -1) {
      throw new Error("Security Restriction: Custom roles cannot have Unlimited (-1) executive approval authority. Specify a bounded PHP limit.");
    }

    const roleCode = `CUSTOM_${rawName.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 32)}`;
    const actorId = req?.user?.id || 'SYSTEM';
    const actorName = req?.user?.displayName || req?.user?.email || 'Administrator';

    // Ensure role record in `roles` table
    let roleRec = await db.select().from(roles).where(eq(roles.name, rawName)).get();
    if (!roleRec) {
      const newRoleId = crypto.randomUUID();
      await db.insert(roles).values({
        id: newRoleId,
        code: roleCode,
        name: rawName,
        description: params.purpose || `Custom Role: ${rawName}`,
        isSystem: false
      });
      roleRec = await db.select().from(roles).where(eq(roles.id, newRoleId)).get();
    }

    const newVersionId = crypto.randomUUID();
    await db.insert(roleTemplateVersions).values({
      id: newVersionId,
      roleCode,
      roleName: rawName,
      versionNumber: 1,
      isActive: true,
      isCustom: true,
      clonedFrom: params.clonedFrom || null,
      status: 'PUBLISHED',
      purpose: params.purpose || (params.clonedFrom ? `Custom role cloned from ${params.clonedFrom}` : `Custom enterprise role: ${rawName}`),
      modulesJson: JSON.stringify(finalModules),
      submodulesJson: JSON.stringify(finalSubmodules),
      permissionsJson: JSON.stringify(finalPerms),
      hardDeniedJson: JSON.stringify(baseHardDenied),
      dataScope: normalizeDataScope(params.defaultDataScope || baseScope),
      approvalLimitCentavos: Math.max(0, finalLimit),
      restrictionsJson: JSON.stringify(params.sodRestrictions || baseRestrictions),
      changeReason: params.changeReason || `Created custom role ${rawName}`,
      changedBy: actorId,
      changedByName: actorName,
      approvedBy: actorName
    });

    await AuditService.log({
      req,
      companyId: req?.activeCompany?.id,
      action: params.clonedFrom ? "CUSTOM_ROLE_CLONED" : "CUSTOM_ROLE_CREATED",
      entityType: "ROLE_TEMPLATE",
      entityId: newVersionId,
      entityName: rawName,
      module: "RBAC",
      reason: params.changeReason || `Created custom role ${rawName}`,
      afterData: {
        roleName: rawName,
        roleCode,
        clonedFrom: params.clonedFrom || null,
        modules: finalModules,
        permissionsCount: finalPerms.length,
        dataScope: params.defaultDataScope || baseScope,
        approvalLimitCentavos: Math.max(0, finalLimit)
      }
    });

    return await this.getActiveRoleTemplate(rawName);
  }

  /**
   * Archive a custom role. Standard 8 roles are strictly protected from archiving.
   */
  static async archiveCustomRole(req: any, roleName: string, reason: string) {
    const resolvedName = this.resolveCanonicalOrCustomRoleName(roleName);
    if ((CANONICAL_ROLES_ORDER as string[]).includes(resolvedName)) {
      throw new Error(`Security Restriction: Standard system role '${resolvedName}' is protected and cannot be archived or deleted.`);
    }

    // Check if any active users hold this custom role
    const roleRec = await db.select().from(roles).where(eq(roles.name, resolvedName)).get();
    if (roleRec) {
      const activeAssignments = await db
        .select()
        .from(companyUserRoles)
        .where(and(eq(companyUserRoles.roleId, roleRec.id), eq(companyUserRoles.assignmentStatus, 'ACTIVE')));
      if (activeAssignments.length > 0) {
        throw new Error(`Cannot archive custom role '${resolvedName}' while ${activeAssignments.length} active member(s) are assigned to it.`);
      }
    }

    await db
      .update(roleTemplateVersions)
      .set({ isActive: false, status: 'ARCHIVED' })
      .where(eq(roleTemplateVersions.roleName, resolvedName));

    await AuditService.log({
      req,
      companyId: req?.activeCompany?.id,
      action: "CUSTOM_ROLE_ARCHIVED",
      entityType: "ROLE_TEMPLATE",
      entityId: resolvedName,
      entityName: resolvedName,
      module: "RBAC",
      reason: reason || `Archived custom role ${resolvedName}`
    });

    return { roleName: resolvedName, archivedRole: resolvedName, status: 'ARCHIVED' };
  }

  /**
   * Preview the impact of updating a Role Template before publishing.
   */
  static async previewRoleTemplateImpact(
    roleName: string,
    proposed: {
      defaultPrimaryModules?: string[];
      defaultSubmodules?: Record<string, string[]>;
      defaultPermissionCodes?: string[];
      defaultDataScope?: CanonicalDataScope;
      defaultApprovalLimitCentavos?: number;
    }
  ) {
    const resolvedName = this.resolveCanonicalOrCustomRoleName(roleName);
    const current = await this.getActiveRoleTemplate(resolvedName);

    const nextMods = proposed.defaultPrimaryModules ?? current.defaultPrimaryModules;
    const nextPerms = proposed.defaultPermissionCodes ?? current.defaultPermissionCodes;
    const nextScope = proposed.defaultDataScope ?? current.defaultDataScope;
    const nextLimit = proposed.defaultApprovalLimitCentavos ?? current.defaultApprovalLimitCentavos;

    const addedModules = nextMods.filter((m: string) => !current.defaultPrimaryModules.includes(m));
    const removedModules = current.defaultPrimaryModules.filter((m: string) => !nextMods.includes(m));
    const addedPermissions = nextPerms.filter((p: string) => !current.defaultPermissionCodes.includes(p));
    const removedPermissions = current.defaultPermissionCodes.filter((p: string) => !nextPerms.includes(p));

    // Find all company members assigned to this role (either as primary or additional role)
    const allMembers = await db
      .select({
        membershipId: companyUsers.id,
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        status: users.status,
        membershipStatus: companyUsers.membershipStatus
      })
      .from(companyUsers)
      .innerJoin(users, eq(companyUsers.userId, users.id));

    const affectedMembers: Array<{ membershipId: string; displayName: string; email: string; hasCustomOverrides: boolean }> = [];
    for (const m of allMembers) {
      if (m.membershipStatus === 'REMOVED') continue;
      const { normalizedRoles } = await this.getMemberRoles(m.membershipId);
      if ((normalizedRoles as string[]).includes(resolvedName)) {
        const customRows = await db
          .select()
          .from(userModuleAssignments)
          .where(and(
            eq(userModuleAssignments.companyUserId, m.membershipId),
            inArray(userModuleAssignments.origin, ['USER_SPECIFIC_GRANT', 'USER_SPECIFIC_DENY'])
          ));
        affectedMembers.push({
          membershipId: m.membershipId,
          displayName: m.displayName,
          email: m.email,
          hasCustomOverrides: customRows.length > 0
        });
      }
    }

    return {
      roleName: resolvedName,
      currentVersion: current.versionNumber,
      nextVersion: current.versionNumber + 1,
      affectedUsersCount: affectedMembers.length,
      affectedMembers,
      addedModules,
      removedModules,
      addedPermissions,
      removedPermissions,
      previousDataScope: current.defaultDataScope,
      nextDataScope: nextScope,
      previousApprovalLimitCentavos: current.defaultApprovalLimitCentavos,
      nextApprovalLimitCentavos: nextLimit
    };
  }

  /**
   * Publish a new version of a Role Template (standard or custom) in `role_template_versions` and synchronize inherited users.
   */
  static async publishRoleTemplateVersion(
    req: any,
    roleName: string,
    updates: {
      newRoleName?: string;
      purpose?: string;
      defaultPrimaryModules: string[];
      defaultSubmodules: Record<string, string[]>;
      defaultPermissionCodes: string[];
      defaultDataScope: CanonicalDataScope;
      defaultApprovalLimitCentavos: number;
      sodRestrictions?: string[];
      changeReason: string;
    }
  ) {
    const resolvedName = this.resolveCanonicalOrCustomRoleName(roleName);
    if (!updates.changeReason || !updates.changeReason.trim()) {
      throw new Error("A mandatory change reason/justification is required to publish a Role Template version.");
    }

    const isStandard = (CANONICAL_ROLES_ORDER as string[]).includes(resolvedName);
    const current = await this.getActiveRoleTemplate(resolvedName);
    const catalogTpl = isStandard
      ? ROLE_TEMPLATES_CATALOG[resolvedName as CanonicalRoleName]
      : null;

    const isOwnerTemplate = resolvedName === 'Company Owner';

    // Enforce hard role security restrictions on the template itself & lock Company Owner unrestricted baseline
    const sanitizedModules = isOwnerTemplate
      ? CANONICAL_ERP_MODULES.map(m => m.id)
      : catalogTpl
        ? updates.defaultPrimaryModules.filter(m => !catalogTpl.hardRestrictedModuleIds.includes(m))
        : updates.defaultPrimaryModules;
    const sanitizedSubmodules = isOwnerTemplate
      ? Object.fromEntries(CANONICAL_ERP_MODULES.map(m => [m.id, m.submodules.map(s => s.id)]))
      : (updates.defaultSubmodules || current.defaultSubmodules);
    const sanitizedPerms = isOwnerTemplate
      ? ['*', ...ALL_PERMISSIONS]
      : catalogTpl
        ? updates.defaultPermissionCodes.filter(p => !catalogTpl.hardDeniedPermissionCodes.includes(p))
        : updates.defaultPermissionCodes.filter(p => p !== '*' && p !== 'roles:manage' && p !== 'users:manage');
    const sanitizedScope = isOwnerTemplate ? 'COMPANY_WIDE' : normalizeDataScope(updates.defaultDataScope);
    const sanitizedApprovalLimit = isOwnerTemplate ? -1 : updates.defaultApprovalLimitCentavos;

    const targetRoleName = (!isStandard && updates.newRoleName && updates.newRoleName.trim())
      ? updates.newRoleName.trim()
      : resolvedName;

    const nextVersion = current.versionNumber + 1;
    const actorId = req?.user?.id || 'SYSTEM';
    const actorName = req?.user?.displayName || req?.user?.email || 'Administrator';

    // Deactivate previous active versions for this role
    await db
      .update(roleTemplateVersions)
      .set({ isActive: false })
      .where(eq(roleTemplateVersions.roleName, resolvedName));

    if (targetRoleName !== resolvedName) {
      await db
        .update(roles)
        .set({ name: targetRoleName })
        .where(eq(roles.name, resolvedName))
        .catch(() => {});
    }

    const newVersionId = crypto.randomUUID();
    await db.insert(roleTemplateVersions).values({
      id: newVersionId,
      roleCode: current.roleCode,
      roleName: targetRoleName,
      versionNumber: nextVersion,
      isActive: true,
      isCustom: !isStandard,
      clonedFrom: current.clonedFrom || null,
      status: 'PUBLISHED',
      purpose: updates.purpose || current.purpose,
      modulesJson: JSON.stringify(sanitizedModules),
      submodulesJson: JSON.stringify(sanitizedSubmodules),
      permissionsJson: JSON.stringify(sanitizedPerms),
      hardDeniedJson: JSON.stringify(isOwnerTemplate ? [] : current.hardDeniedPermissionCodes),
      dataScope: sanitizedScope,
      approvalLimitCentavos: sanitizedApprovalLimit,
      restrictionsJson: JSON.stringify(updates.sodRestrictions || current.sodRestrictions),
      changeReason: updates.changeReason.trim(),
      changedBy: actorId,
      changedByName: actorName,
      approvedBy: actorName
    });

    // Update role_template_version on active company_user_roles for this role
    const roleRec = await db.select().from(roles).where(eq(roles.name, targetRoleName)).get();
    if (roleRec) {
      await db
        .update(companyUserRoles)
        .set({ roleTemplateVersion: nextVersion })
        .where(and(eq(companyUserRoles.roleId, roleRec.id), eq(companyUserRoles.assignmentStatus, 'ACTIVE')))
        .catch(() => {});
    }

    // Update inherited module assignments for all members holding this role (preserving explicit USER_SPECIFIC_GRANT / USER_SPECIFIC_DENY)
    const allMembers = await db.select().from(companyUsers);
    let syncedMemberCount = 0;
    for (const m of allMembers) {
      if (m.membershipStatus === 'REMOVED') continue;
      const { normalizedRoles } = await this.getMemberRoles(m.id);
      if ((normalizedRoles as string[]).includes(targetRoleName) || (normalizedRoles as string[]).includes(resolvedName)) {
        await this.syncMultiRoleModulesForUser(
          m.id,
          actorId,
          actorName,
          `Role Template ${targetRoleName} updated to v${nextVersion}: ${updates.changeReason.trim()}`,
          true
        );
        syncedMemberCount++;
      }
    }

    await AuditService.log({
      req,
      companyId: req?.activeCompany?.id,
      action: "ROLE_TEMPLATE_PUBLISHED",
      entityType: "ROLE_TEMPLATE",
      entityId: newVersionId,
      entityName: `${targetRoleName} v${nextVersion}`,
      module: "RBAC",
      reason: updates.changeReason.trim(),
      beforeData: {
        versionNumber: current.versionNumber,
        modules: current.defaultPrimaryModules,
        permissionsCount: current.defaultPermissionCodes.length,
        dataScope: current.defaultDataScope,
        approvalLimitCentavos: current.defaultApprovalLimitCentavos
      },
      afterData: {
        versionNumber: nextVersion,
        modules: sanitizedModules,
        permissionsCount: sanitizedPerms.length,
        dataScope: updates.defaultDataScope,
        approvalLimitCentavos: updates.defaultApprovalLimitCentavos
      },
      metadata: {
        roleName: targetRoleName,
        versionNumber: nextVersion,
        syncedMemberCount,
        reason: updates.changeReason.trim()
      }
    });

    return await this.getActiveRoleTemplate(targetRoleName);
  }

  /**
   * Rollback / restore a Role Template to a previous version (by publishing a new version restoring that snapshot).
   */
  static async rollbackRoleTemplateVersion(
    req: any,
    roleName: string,
    targetVersionNumber: number,
    reason?: string
  ) {
    const resolvedName = this.resolveCanonicalOrCustomRoleName(roleName);
    const targetRow = await db
      .select()
      .from(roleTemplateVersions)
      .where(and(eq(roleTemplateVersions.roleName, resolvedName), eq(roleTemplateVersions.versionNumber, targetVersionNumber)))
      .get();

    if (!targetRow) {
      throw new Error(`Role template version v${targetVersionNumber} not found for role ${resolvedName}.`);
    }

    const rolledBack = await this.publishRoleTemplateVersion(req, resolvedName, {
      purpose: targetRow.purpose || undefined,
      defaultPrimaryModules: JSON.parse(targetRow.modulesJson || '[]'),
      defaultSubmodules: JSON.parse(targetRow.submodulesJson || '{}'),
      defaultPermissionCodes: JSON.parse(targetRow.permissionsJson || '[]'),
      defaultDataScope: normalizeDataScope(targetRow.dataScope),
      defaultApprovalLimitCentavos: targetRow.approvalLimitCentavos,
      sodRestrictions: targetRow.restrictionsJson ? JSON.parse(targetRow.restrictionsJson) : undefined,
      changeReason: reason?.trim() || `Rolled back ${resolvedName} template to v${targetVersionNumber} configuration`
    });

    await AuditService.log({
      req,
      companyId: req?.activeCompany?.id,
      action: "ROLE_TEMPLATE_ROLLED_BACK",
      entityType: "ROLE_TEMPLATE",
      entityId: rolledBack.id,
      entityName: `${resolvedName} -> v${targetVersionNumber}`,
      module: "RBAC",
      reason: reason?.trim() || `Rolled back ${resolvedName} template to v${targetVersionNumber}`
    });

    return rolledBack;
  }

  /**
   * Synchronize INHERITED_FROM_ROLE / COMBINED_ROLES module rows across ALL active roles assigned to a member,
   * while strictly preserving explicit USER_SPECIFIC_GRANT and USER_SPECIFIC_DENY rows (or resetting all if resetOverrides = true).
   */
  static async syncMultiRoleModulesForUser(
    companyUserId: string,
    rolesOrActorId: string | string[] = 'SYSTEM',
    actorIdOrName: string = 'System Governance',
    actorNameOrReason: string = 'Synchronized from assigned Role Templates',
    reasonOrReset: string | boolean = false,
    maybeReset: boolean = false
  ) {
    let actorId = 'SYSTEM';
    let actorName = 'System Governance';
    let reason = 'Synchronized from assigned Role Templates';
    let resetOverrides = false;

    if (Array.isArray(rolesOrActorId)) {
      actorId = actorIdOrName || 'SYSTEM';
      actorName = actorNameOrReason || 'System Governance';
      reason = typeof reasonOrReset === 'string' ? reasonOrReset : 'Synchronized from assigned Role Templates';
      resetOverrides = typeof reasonOrReset === 'boolean' ? reasonOrReset : Boolean(maybeReset);
    } else {
      actorId = rolesOrActorId || 'SYSTEM';
      actorName = actorIdOrName || 'System Governance';
      reason = actorNameOrReason || 'Synchronized from assigned Role Templates';
      resetOverrides = Boolean(reasonOrReset);
    }

    const { normalizedRoles, primaryRole } = await this.getMemberRoles(companyUserId);
    const primaryTpl = await this.getActiveRoleTemplate(primaryRole);

    const roleTemplates = await Promise.all(
      normalizedRoles.map(r => this.getActiveRoleTemplate(r))
    );

    let validAssignedBy: string | null = null;
    if (actorId && actorId !== 'SYSTEM') {
      const actorRow = await db.select({ id: users.id }).from(users).where(eq(users.id, actorId)).get();
      if (actorRow) validAssignedBy = actorRow.id;
    }

    const existingRows = await db
      .select()
      .from(userModuleAssignments)
      .where(eq(userModuleAssignments.companyUserId, companyUserId));

    const isOwnerMember = (normalizedRoles as string[]).includes('Company Owner');

    const explicitModIds = new Set<string>();
    if (resetOverrides || isOwnerMember) {
      await db.delete(userModuleAssignments).where(eq(userModuleAssignments.companyUserId, companyUserId));
      await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.companyUserId, companyUserId));
    } else {
      for (const r of existingRows) {
        if (r.origin === 'USER_SPECIFIC_GRANT' || r.origin === 'USER_SPECIFIC_DENY') {
          explicitModIds.add(r.moduleId);
        } else {
          await db.delete(userModuleAssignments).where(eq(userModuleAssignments.id, r.id));
        }
      }
    }

    // Combine modules across all active assigned roles (Company Owner unconditionally receives all 16 canonical modules)
    const combinedModSet = new Set<string>();
    if (isOwnerMember) {
      for (const mod of CANONICAL_ERP_MODULES) combinedModSet.add(mod.id);
    } else {
      for (const tpl of roleTemplates) {
        for (const modId of tpl.defaultPrimaryModules) {
          combinedModSet.add(modId);
        }
      }
    }

    for (const modId of Array.from(combinedModSet)) {
      if (explicitModIds.has(modId)) continue;

      const modDef = CANONICAL_ERP_MODULES.find(m => m.id === modId);
      const allSubIds = modDef?.submodules.map(s => s.id) || [];

      const contributingRoles: string[] = [];
      const combinedSubSet = new Set<string>();
      const combinedActSet = new Set<string>();
      let mostRestrictiveScope: CanonicalDataScope | null = null;
      let effectiveApprovalLimit = 0;

      for (const tpl of roleTemplates) {
        if (tpl.defaultPrimaryModules.includes(modId)) {
          contributingRoles.push(tpl.roleName);
          const subs = tpl.defaultSubmodules[modId] || allSubIds;
          for (const s of subs) combinedSubSet.add(s);

          const modPerms = CANONICAL_PERMISSION_CATALOG
            .filter(p => p.primaryModuleId === modId && (tpl.defaultPermissionCodes.includes('*') || tpl.defaultPermissionCodes.includes(p.code)))
            .map(p => p.action);
          for (const a of modPerms) combinedActSet.add(a);

          // Most restrictive scope policy unless Company Owner / Administrator
          const roleScope = normalizeDataScope(tpl.defaultDataScope);
          if (!mostRestrictiveScope) {
            mostRestrictiveScope = roleScope;
          } else if (tpl.roleName === 'Company Owner') {
            mostRestrictiveScope = 'COMPANY_WIDE';
          } else if (DATA_SCOPE_RESTRICTIVENESS[roleScope] < DATA_SCOPE_RESTRICTIVENESS[mostRestrictiveScope]) {
            mostRestrictiveScope = roleScope;
          }

          // Approval limit: do NOT sum limits; pick the highest single authoritative approval policy limit
          if (tpl.canApproveFinancialTransactions) {
            if (tpl.defaultApprovalLimitCentavos === -1 || effectiveApprovalLimit === -1) {
              effectiveApprovalLimit = -1;
            } else if (tpl.defaultApprovalLimitCentavos > effectiveApprovalLimit) {
              effectiveApprovalLimit = tpl.defaultApprovalLimitCentavos;
            }
          }
        }
      }

      const origin: PermissionOrigin =
        contributingRoles.length > 1 || (contributingRoles.length === 1 && contributingRoles[0] !== primaryRole)
          ? 'COMBINED_ROLES'
          : 'INHERITED_FROM_ROLE';

      await db.insert(userModuleAssignments).values({
        id: crypto.randomUUID(),
        companyUserId,
        moduleId: modId,
        submoduleIds: JSON.stringify(Array.from(combinedSubSet)),
        actions: JSON.stringify(Array.from(combinedActSet)),
        dataScope: mostRestrictiveScope || primaryTpl.defaultDataScope,
        approvalLimitCentavos: effectiveApprovalLimit,
        origin,
        effect: 'ALLOW',
        templateVersion: primaryTpl.versionNumber,
        reason: contributingRoles.length > 1
          ? `Combined from roles: ${contributingRoles.join(' + ')}`
          : `Inherited from ${contributingRoles[0] || primaryRole} template`,
        assignedBy: validAssignedBy,
        assignedByName: actorName
      }).catch(() => {});
    }

    await db
      .update(companyUsers)
      .set({
        roleTemplateVersion: primaryTpl.versionNumber,
        defaultDataScope: primaryTpl.defaultDataScope,
        approvalLimitCentavos: primaryTpl.defaultApprovalLimitCentavos,
        updatedAt: new Date()
      })
      .where(eq(companyUsers.id, companyUserId))
      .catch(() => {});

    if (resetOverrides) {
      await db.insert(userModuleAssignmentHistory).values({
        id: crypto.randomUUID(),
        companyUserId,
        moduleId: 'ALL_MODULES',
        actionType: 'ROLE_RESET',
        previousAssignment: JSON.stringify(existingRows.map((r: any) => ({ moduleId: r.moduleId, origin: r.origin, effect: r.effect }))),
        newAssignment: JSON.stringify({
          roles: normalizedRoles,
          primaryRole,
          templateVersion: primaryTpl.versionNumber,
          defaultModules: Array.from(combinedModSet)
        }),
        reason,
        changedBy: validAssignedBy || 'SYSTEM',
        changedByName: actorName
      }).catch(() => {});
    }
  }

  /**
   * Apply a role's default module template cleanly to a user (used on user creation, role change, or Reset to Role Default).
   */
  static async applyRoleDefaultModulesToUser(
    companyUserId: string,
    _roleName: string,
    actorId: string = 'SYSTEM',
    actorName: string = 'System Governance',
    reason: string = 'Initialized from Role Permissions Catalog default template'
  ) {
    await this.syncMultiRoleModulesForUser(companyUserId, actorId, actorName, reason, true);
  }

  /**
   * Synchronize only INHERITED_FROM_ROLE rows when a Role Template is updated, preserving explicit USER_SPECIFIC_GRANT / USER_SPECIFIC_DENY rows.
   */
  static async syncInheritedModulesForUser(
    companyUserId: string,
    _roleName: string,
    actorId: string,
    actorName: string,
    reason: string
  ) {
    await this.syncMultiRoleModulesForUser(companyUserId, actorId, actorName, reason, false);
  }

  /**
   * Ensure a role exists in the `roles` table and its default permissions are seeded.
   */
  static async ensureRoleRecord(roleName: string): Promise<{ id: string; code: string; name: string }> {
    const resolvedName = this.resolveCanonicalOrCustomRoleName(roleName);
    const isStandard = (CANONICAL_ROLES_ORDER as string[]).includes(resolvedName);
    const code = isStandard
      ? ROLE_TEMPLATES_CATALOG[resolvedName as CanonicalRoleName].roleCode
      : `CUSTOM_${resolvedName.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 32)}`;

    let roleRec = await db.select().from(roles).where(eq(roles.name, resolvedName)).get();
    if (!roleRec) {
      roleRec = await db.select().from(roles).where(eq(roles.code, code)).get();
    }

    if (!roleRec) {
      const newRoleId = crypto.randomUUID();
      await db.insert(roles).values({
        id: newRoleId,
        code,
        name: resolvedName,
        description: isStandard ? `System Role: ${resolvedName}` : `Custom Role: ${resolvedName}`,
        isSystem: isStandard
      });
      roleRec = { id: newRoleId, code, name: resolvedName, description: `Role: ${resolvedName}`, isSystem: isStandard, createdAt: new Date() };
    }

    const activeTpl = await this.getActiveRoleTemplate(resolvedName);
    const permsToSeed = activeTpl.defaultPermissionCodes || [];
    for (const permCode of permsToSeed) {
      if (permCode === '*') continue;
      let permRec = await db.select().from(permissions).where(eq(permissions.code, permCode)).get();
      if (!permRec) {
        const newPermId = crypto.randomUUID();
        const modName = permCode.split(':')[0].toUpperCase();
        await db.insert(permissions).values({
          id: newPermId,
          code: permCode,
          description: `Permission to ${permCode.replace(':', ' ')}`,
          module: modName
        }).catch(() => {});
        permRec = await db.select().from(permissions).where(eq(permissions.code, permCode)).get();
      }

      if (permRec) {
        const existingRp = await db
          .select()
          .from(rolePermissions)
          .where(and(eq(rolePermissions.roleId, roleRec.id), eq(rolePermissions.permissionId, permRec.id)))
          .get();
        if (!existingRp) {
          await db.insert(rolePermissions).values({
            id: crypto.randomUUID(),
            roleId: roleRec.id,
            permissionId: permRec.id
          }).catch(() => {});
        }
      }
    }

    return roleRec;
  }

  /**
   * PHASE 2 — MULTI-ROLE COMPATIBILITY ENGINE
   * Get all configured role compatibility rules from SQLite.
   */
  static async getRoleCompatibilityRules(): Promise<RoleCompatibilityRule[]> {
    await this.ensureRoleTemplatesSeeded();
    try {
      const rows = await db.select().from(roleCompatibilityRules);
      if (rows.length > 0) {
        return rows.map((r: any) => ({
          id: r.id,
          roleA: r.roleA,
          roleB: r.roleB,
          compatibilityType: r.compatibilityType as 'ALLOWED' | 'RESTRICTED' | 'PROHIBITED',
          reason: r.reason,
          conditionsJson: r.conditionsJson
        }));
      }
    } catch (_) {}
    return DEFAULT_COMPATIBILITY_RULES.map((r, idx) => ({
      id: `default-compat-${idx}`,
      ...r
    }));
  }

  /**
   * Upsert a configurable role compatibility rule.
   */
  static async upsertRoleCompatibilityRule(
    req: any,
    roleAOrPayload: string | { roleA: string; roleB: string; compatibilityType: 'ALLOWED' | 'RESTRICTED' | 'PROHIBITED'; reason: string; conditions?: string },
    roleBArg?: string,
    compatibilityTypeArg?: 'ALLOWED' | 'RESTRICTED' | 'PROHIBITED',
    reasonArg?: string
  ) {
    const roleA = typeof roleAOrPayload === 'object' ? roleAOrPayload.roleA : roleAOrPayload;
    const roleB = typeof roleAOrPayload === 'object' ? roleAOrPayload.roleB : (roleBArg || '');
    const compatibilityType = typeof roleAOrPayload === 'object' ? roleAOrPayload.compatibilityType : (compatibilityTypeArg || 'ALLOWED');
    const reason = typeof roleAOrPayload === 'object' ? roleAOrPayload.reason : (reasonArg || 'Compatibility rule updated');

    const rA = this.resolveCanonicalOrCustomRoleName(roleA);
    const rB = this.resolveCanonicalOrCustomRoleName(roleB);
    if (rA === rB) {
      throw new Error("Cannot configure compatibility rule between a role and itself.");
    }

    // Never allow overriding core SoD prohibitions (Bookkeeper+Approver, Bookkeeper+Auditor, Accountant+Auditor) to ALLOWED
    const isHardProhibited = INCOMPATIBLE_ROLE_PAIRS.some(
      ([a, b]) => (a === rA && b === rB) || (a === rB && b === rA)
    );
    if (isHardProhibited && compatibilityType !== 'PROHIBITED') {
      throw new Error(`Security Restriction: Core Segregation of Duties prohibition between ${rA} and ${rB} cannot be weakened.`);
    }

    let upsertedId = '';
    const pairs: Array<[string, string]> = [[rA, rB], [rB, rA]];
    for (const [first, second] of pairs) {
      const existing = await db
        .select()
        .from(roleCompatibilityRules)
        .where(and(eq(roleCompatibilityRules.roleA, first), eq(roleCompatibilityRules.roleB, second)))
        .get();
      if (existing) {
        if (!upsertedId) upsertedId = existing.id;
        await db
          .update(roleCompatibilityRules)
          .set({ compatibilityType, reason })
          .where(eq(roleCompatibilityRules.id, existing.id));
      } else {
        const newId = crypto.randomUUID();
        if (!upsertedId) upsertedId = newId;
        await db.insert(roleCompatibilityRules).values({
          id: newId,
          roleA: first,
          roleB: second,
          compatibilityType,
          reason
        });
      }
    }

    await AuditService.log({
      req,
      companyId: req?.activeCompany?.id,
      action: "ROLE_COMPATIBILITY_RULE_UPDATED",
      entityType: "ROLE_COMPATIBILITY",
      entityId: `${rA}:${rB}`,
      module: "RBAC",
      reason,
      afterData: { roleA: rA, roleB: rB, compatibilityType, reason }
    });

    return {
      id: upsertedId,
      roleA: rA,
      roleB: rB,
      compatibilityType,
      reason
    };
  }

  /**
   * Validate role compatibility and Segregation of Duties (SoD) rules across a set of roles.
   */
  static async validateRoleCompatibility(targetRoles: string[]): Promise<{
    valid: boolean;
    compatibilityType: 'ALLOWED' | 'RESTRICTED' | 'PROHIBITED';
    conflicts: string[];
    warnings: string[];
    prohibitedConflicts: Array<{ reason: string }>;
    restrictedWarnings: Array<{ reason: string }>;
  }> {
    const conflicts: string[] = [];
    const warnings: string[] = [];
    const resolvedList = Array.from(new Set(targetRoles.map(r => this.resolveCanonicalOrCustomRoleName(r))));

    if (resolvedList.length <= 1) {
      return {
        valid: true,
        compatibilityType: 'ALLOWED',
        conflicts: [],
        warnings: [],
        prohibitedConflicts: [],
        restrictedWarnings: []
      };
    }

    const addConflict = (reasonText: string) => {
      const formatted = reasonText.startsWith('INCOMPATIBLE_ROLES:')
        ? reasonText
        : `INCOMPATIBLE_ROLES: ${reasonText}`;
      if (!conflicts.includes(formatted)) conflicts.push(formatted);
    };

    // 1. Check hardcoded INCOMPATIBLE_ROLE_PAIRS
    for (const [roleA, roleB, reason] of INCOMPATIBLE_ROLE_PAIRS) {
      if (resolvedList.includes(roleA) && resolvedList.includes(roleB)) {
        addConflict(reason);
      }
    }

    // 2. Check role_compatibility_rules table
    const compatRules = await this.getRoleCompatibilityRules();
    for (let i = 0; i < resolvedList.length; i++) {
      for (let j = i + 1; j < resolvedList.length; j++) {
        const r1 = resolvedList[i];
        const r2 = resolvedList[j];
        const match = compatRules.find(
          c => (c.roleA === r1 && c.roleB === r2) || (c.roleA === r2 && c.roleB === r1)
        );
        if (match) {
          if (match.compatibilityType === 'PROHIBITED') {
            addConflict(match.reason);
          } else if (match.compatibilityType === 'RESTRICTED') {
            const warnMsg = `${r1} + ${r2}: ${match.reason}`;
            if (!warnings.includes(warnMsg)) warnings.push(warnMsg);
          }
        }
      }
    }

    // 3. Check custom roles that might combine conflicting capabilities (e.g. Auditor + write role)
    const templates = await Promise.all(resolvedList.map(r => this.getActiveRoleTemplate(r)));
    const hasAuditor = resolvedList.includes('Auditor');
    if (hasAuditor) {
      for (const tpl of templates) {
        if (tpl.roleName === 'Auditor') continue;
        const hasWriteOrApprove = tpl.defaultPermissionCodes.some(
          (p: string) => p.endsWith(':create') || p.endsWith(':edit') || p.endsWith(':post') || p.endsWith(':approve')
        );
        if (hasWriteOrApprove) {
          addConflict(`Segregation of Duties (SoD): Independent Auditor cannot be combined with operational write/approval role '${tpl.roleName}'.`);
        }
      }
    }

    // 4. Check sod_restrictions table
    try {
      const dbRules = await db.select().from(sodRestrictions).where(eq(sodRestrictions.status, 'ACTIVE'));
      for (const rule of dbRules) {
        const r1 = this.resolveCanonicalOrCustomRoleName(rule.incompatibleRole1);
        const r2 = this.resolveCanonicalOrCustomRoleName(rule.incompatibleRole2);
        if (resolvedList.includes(r1) && resolvedList.includes(r2)) {
          addConflict(rule.description || `Segregation of Duties conflict between ${r1} and ${r2} (${rule.ruleName})`);
        }
      }
    } catch (_) {}

    const compatibilityType: 'ALLOWED' | 'RESTRICTED' | 'PROHIBITED' =
      conflicts.length > 0 ? 'PROHIBITED' : warnings.length > 0 ? 'RESTRICTED' : 'ALLOWED';

    return {
      valid: conflicts.length === 0,
      compatibilityType,
      conflicts,
      warnings,
      prohibitedConflicts: conflicts.map(c => ({ reason: c })),
      restrictedWarnings: warnings.map(w => ({ reason: w }))
    };
  }

  static async validateSoDForRoles(targetRoles: string[]): Promise<{ valid: boolean; conflicts: string[]; warnings?: string[] }> {
    const res = await this.validateRoleCompatibility(targetRoles);
    return { valid: res.valid, conflicts: res.conflicts, warnings: res.warnings };
  }

  /**
   * PHASE 4 — OWNER PROTECTION & ASYMMETRIC AUTHORITY VALIDATOR
   * Enforces:
   * - Company Administrator CANNOT remove, disable, suspend, revoke roles of, or modify a Company Owner.
   * - Last active Company Owner CANNOT be removed, disabled, or demoted.
   */
  static async countActiveCompanyOwners(companyId: string): Promise<number> {
    const allMembers = await db
      .select()
      .from(companyUsers)
      .where(eq(companyUsers.companyId, companyId));

    let ownerCount = 0;
    for (const m of allMembers) {
      if (m.status !== 'ACTIVE' || (m.membershipStatus && m.membershipStatus !== 'ACTIVE')) continue;
      const u = await db.select().from(users).where(eq(users.id, m.userId)).get();
      if (!u || u.status !== 'ACTIVE') continue;
      const { normalizedRoles, primaryRole } = await this.getMemberRoles(m.id);
      if (primaryRole === 'Company Owner' || (normalizedRoles as string[]).includes('Company Owner')) {
        ownerCount++;
      }
    }
    return ownerCount;
  }

  static async assertActorCanModifyMember(
    req: any,
    targetCompanyUserId: string,
    actionDescription: string,
    options?: { isRemovingOrDisabling?: boolean; isRevokingOwnerRole?: boolean }
  ): Promise<{ membership: any; targetUser: any; targetRoles: string[]; targetPrimaryRole: LedgerRole; isActorOwner: boolean }> {
    const membership = await db.select().from(companyUsers).where(eq(companyUsers.id, targetCompanyUserId)).get();
    if (!membership) {
      throw new Error("Target company member not found.");
    }
    const targetUser = await db.select().from(users).where(eq(users.id, membership.userId)).get();
    const { normalizedRoles, primaryRole } = await this.getMemberRoles(membership.id);
    const isTargetOwner = primaryRole === 'Company Owner' || (normalizedRoles as string[]).includes('Company Owner');

    const actorRoles: string[] = req?.activeCompany?.roles || (req?.activeCompany?.role ? [req.activeCompany.role] : []);
    const isActorOwner = actorRoles.includes('Company Owner') || req?.activeCompany?.role === 'Company Owner';

    const descUpper = (actionDescription || '').toUpperCase();
    const isRemovingOrDisabling =
      Boolean(options?.isRemovingOrDisabling) ||
      descUpper === 'REMOVE' ||
      descUpper === 'DISABLE' ||
      descUpper.includes('REMOVE') ||
      descUpper.includes('DISABLE');
    const isRevokingOwnerRole =
      Boolean(options?.isRevokingOwnerRole) ||
      descUpper.includes('REVOKE');

    // Rule 1-7: Company Administrator CANNOT modify, disable, remove, or revoke a Company Owner
    if (isTargetOwner && !isActorOwner) {
      await AuditService.log({
        req,
        companyId: membership.companyId,
        action: "UNAUTHORIZED_OWNER_MODIFICATION_ATTEMPT",
        entityType: "MEMBERSHIP",
        entityId: membership.id,
        entityName: targetUser?.displayName || targetUser?.email || membership.userId,
        module: "RBAC",
        result: "FAILED",
        reason: `Blocked attempt by non-Owner (${req?.activeCompany?.role || 'Administrator'}) to execute '${actionDescription}' on protected Company Owner.`
      });
      const err: any = new Error(
        `PERMISSION_DENIED: Owner Protection Policy Violation: Company Administrators cannot ${actionDescription} a Company Owner account.`
      );
      err.statusCode = 403;
      err.errorCode = "OWNER_PROTECTION_VIOLATION";
      throw err;
    }

    // Safeguard: Last active Company Owner cannot be removed, disabled, or stripped of Company Owner role
    if (isTargetOwner && (isRemovingOrDisabling || isRevokingOwnerRole)) {
      const activeOwnerCount = await this.countActiveCompanyOwners(membership.companyId);
      if (activeOwnerCount <= 1) {
        await AuditService.log({
          req,
          companyId: membership.companyId,
          action: "LAST_OWNER_PROTECTION_TRIGGERED",
          entityType: "MEMBERSHIP",
          entityId: membership.id,
          entityName: targetUser?.displayName || targetUser?.email || membership.userId,
          module: "RBAC",
          result: "FAILED",
          reason: `Blocked '${actionDescription}' on the sole active Company Owner.`
        });
        const err: any = new Error(
          "VALIDATION_ERROR: Last Owner Safeguard: Cannot remove, disable, or revoke ownership from the last active Company Owner. Transfer ownership to another active member first."
        );
        err.statusCode = 400;
        err.errorCode = "LAST_OWNER_PROTECTION";
        throw err;
      }
    }

    // Prevent self-removal or self-disable
    if (isRemovingOrDisabling && req?.user?.id && membership.userId === req.user.id) {
      const err: any = new Error("VALIDATION_ERROR: Cannot remove or disable your own active account.");
      err.statusCode = 400;
      throw err;
    }

    return {
      membership,
      targetUser,
      targetRoles: normalizedRoles as string[],
      targetPrimaryRole: primaryRole,
      isActorOwner
    };
  }

  /**
   * PHASE 1 — Normalized Multi-Role Retrieval
   * Get all roles assigned to a company member (active + historical assignments).
   */
  static async getMemberRoles(companyUserId: string): Promise<{
    roleRecords: Array<{ id: string; code: string; name: string }>;
    normalizedRoles: LedgerRole[];
    assignedRoles: string[];
    primaryRole: LedgerRole;
    additionalRoles: LedgerRole[];
    allRoleAssignments: MemberRoleAssignmentDetail[];
  }> {
    const membership = await db.select().from(companyUsers).where(eq(companyUsers.id, companyUserId)).get();
    if (!membership) {
      return {
        roleRecords: [],
        normalizedRoles: ['Read-only User'],
        assignedRoles: ['Read-only User'],
        primaryRole: 'Read-only User',
        additionalRoles: [],
        allRoleAssignments: []
      };
    }

    const rawAssignments = await db
      .select({
        assignmentId: companyUserRoles.id,
        roleId: roles.id,
        roleCode: roles.code,
        roleName: roles.name,
        roleTemplateVersion: companyUserRoles.roleTemplateVersion,
        isPrimary: companyUserRoles.isPrimary,
        assignmentStatus: companyUserRoles.assignmentStatus,
        assignedBy: companyUserRoles.assignedBy,
        assignedAt: companyUserRoles.assignedAt,
        effectiveFrom: companyUserRoles.effectiveFrom,
        effectiveTo: companyUserRoles.effectiveTo,
        assignmentReason: companyUserRoles.assignmentReason
      })
      .from(companyUserRoles)
      .innerJoin(roles, eq(companyUserRoles.roleId, roles.id))
      .where(eq(companyUserRoles.companyUserId, companyUserId));

    const now = new Date();
    const allRoleAssignments: MemberRoleAssignmentDetail[] = [];
    const activeRoleRecords: Array<{ id: string; code: string; name: string; isPrimary: boolean }> = [];

    for (const row of rawAssignments) {
      let currentStatus = row.assignmentStatus || 'ACTIVE';
      // Check expiration
      if (currentStatus === 'ACTIVE' && row.effectiveTo) {
        const expDate = new Date(row.effectiveTo);
        if (!isNaN(expDate.getTime()) && expDate < now) {
          currentStatus = 'EXPIRED';
          await db
            .update(companyUserRoles)
            .set({ assignmentStatus: 'EXPIRED', isPrimary: false })
            .where(eq(companyUserRoles.id, row.assignmentId))
            .catch(() => {});
        }
      }

      const resolvedRoleName = this.resolveCanonicalOrCustomRoleName(row.roleName || row.roleCode);
      allRoleAssignments.push({
        id: row.assignmentId,
        roleId: row.roleId,
        roleCode: row.roleCode,
        roleName: resolvedRoleName,
        roleTemplateVersion: row.roleTemplateVersion || 1,
        isPrimary: Boolean(row.isPrimary) && currentStatus === 'ACTIVE',
        assignmentStatus: currentStatus,
        assignedBy: row.assignedBy,
        assignedAt: row.assignedAt,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        assignmentReason: row.assignmentReason
      });

      if (currentStatus === 'ACTIVE') {
        activeRoleRecords.push({
          id: row.roleId,
          code: row.roleCode,
          name: resolvedRoleName,
          isPrimary: Boolean(row.isPrimary)
        });
      }
    }

    // Backfill from companyUsers.roleId if no active rows in company_user_roles yet (and member is not REMOVED)
    if (activeRoleRecords.length === 0 && membership.membershipStatus !== 'REMOVED' && membership.status !== 'REMOVED') {
      if (membership.roleId) {
        const primaryRec = await db.select().from(roles).where(eq(roles.id, membership.roleId)).get();
        if (primaryRec) {
          const rName = this.resolveCanonicalOrCustomRoleName(primaryRec.name || primaryRec.code);
          const newAssignId = crypto.randomUUID();
          await db.insert(companyUserRoles).values({
            id: newAssignId,
            companyUserId,
            roleId: primaryRec.id,
            roleCode: primaryRec.code,
            roleTemplateVersion: membership.roleTemplateVersion || 1,
            isPrimary: true,
            assignmentStatus: 'ACTIVE',
            assignedBy: 'SYSTEM',
            assignmentReason: 'Synchronized primary role from company membership'
          }).catch(() => {});
          activeRoleRecords.push({
            id: primaryRec.id,
            code: primaryRec.code,
            name: rName,
            isPrimary: true
          });
          allRoleAssignments.push({
            id: newAssignId,
            roleId: primaryRec.id,
            roleCode: primaryRec.code,
            roleName: rName,
            roleTemplateVersion: membership.roleTemplateVersion || 1,
            isPrimary: true,
            assignmentStatus: 'ACTIVE',
            assignedBy: 'SYSTEM',
            assignedAt: new Date(),
            assignmentReason: 'Synchronized primary role from company membership'
          });
        }
      }
    }

    if (activeRoleRecords.length === 0) {
      const fallback = this.resolveCanonicalOrCustomRoleName(membership.legacyRole || 'Read-only User') as LedgerRole;
      return {
        roleRecords: [],
        normalizedRoles: [fallback],
        assignedRoles: [fallback as string],
        primaryRole: fallback,
        additionalRoles: [],
        allRoleAssignments
      };
    }

    // Sort so primary role is always index 0
    activeRoleRecords.sort((a, b) => (a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1));
    if (!activeRoleRecords.some(r => r.isPrimary)) {
      activeRoleRecords[0].isPrimary = true;
    }

    const primaryRole = activeRoleRecords[0].name as LedgerRole;
    const normalizedRoles = Array.from(new Set(activeRoleRecords.map(r => r.name as LedgerRole)));
    const additionalRoles = normalizedRoles.filter(r => r !== primaryRole);

    return {
      roleRecords: activeRoleRecords.map(r => ({ id: r.id, code: r.code, name: r.name })),
      normalizedRoles,
      assignedRoles: normalizedRoles as string[],
      primaryRole,
      additionalRoles,
      allRoleAssignments
    };
  }

  /**
   * Add or update a single role assignment for a member in `company_user_roles`.
   */
  static async assignRoleToMember(
    req: any,
    companyUserId: string,
    roleName: string,
    options?: {
      isPrimary?: boolean;
      effectiveFrom?: string;
      effectiveTo?: string;
      reason?: string;
      preserveCustomModuleOverrides?: boolean;
    }
  ) {
    const resolvedTargetRole = this.resolveCanonicalOrCustomRoleName(roleName);
    const { membership, targetRoles, targetPrimaryRole, isActorOwner } = await this.assertActorCanModifyMember(
      req,
      companyUserId,
      `assign role ${resolvedTargetRole}`
    );

    if (resolvedTargetRole === 'Company Owner' && !isActorOwner) {
      const err: any = new Error("Owner Protection Policy Violation: Only an active Company Owner can assign the Company Owner role.");
      err.statusCode = 403;
      err.errorCode = "OWNER_PROTECTION_VIOLATION";
      throw err;
    }

    const nextRolesSet = new Set<string>([...targetRoles, resolvedTargetRole]);
    const compat = await this.validateRoleCompatibility(Array.from(nextRolesSet));
    if (!compat.valid) {
      throw new Error(compat.conflicts.join(" | "));
    }

    const roleRec = await this.ensureRoleRecord(resolvedTargetRole);
    const activeTpl = await this.getActiveRoleTemplate(resolvedTargetRole);
    const actorId = req?.user?.id || 'SYSTEM';
    const actorName = req?.user?.displayName || req?.user?.email || 'Administrator';
    const makePrimary = Boolean(options?.isPrimary) || targetRoles.length === 0;

    if (makePrimary) {
      // Check if demoting last owner
      if (targetPrimaryRole === 'Company Owner' && resolvedTargetRole !== 'Company Owner' && !nextRolesSet.has('Company Owner')) {
        await this.assertActorCanModifyMember(req, companyUserId, 'demote Company Owner', { isRevokingOwnerRole: true });
      }
      await db
        .update(companyUserRoles)
        .set({ isPrimary: false })
        .where(eq(companyUserRoles.companyUserId, companyUserId));
      await db
        .update(companyUsers)
        .set({ roleId: roleRec.id, legacyRole: roleRec.name, roleTemplateVersion: activeTpl.versionNumber, updatedAt: new Date() })
        .where(eq(companyUsers.id, companyUserId));
    }

    const existingRow = await db
      .select()
      .from(companyUserRoles)
      .where(and(eq(companyUserRoles.companyUserId, companyUserId), eq(companyUserRoles.roleId, roleRec.id)))
      .get();

    if (existingRow) {
      await db
        .update(companyUserRoles)
        .set({
          roleCode: roleRec.code,
          roleTemplateVersion: activeTpl.versionNumber,
          isPrimary: makePrimary ? true : existingRow.isPrimary,
          assignmentStatus: 'ACTIVE',
          assignedBy: actorId,
          assignedAt: new Date(),
          effectiveFrom: options?.effectiveFrom || existingRow.effectiveFrom || new Date().toISOString().slice(0, 10),
          effectiveTo: options?.effectiveTo ?? null,
          assignmentReason: options?.reason || `Assigned ${resolvedTargetRole} role`
        })
        .where(eq(companyUserRoles.id, existingRow.id));
    } else {
      await db.insert(companyUserRoles).values({
        id: crypto.randomUUID(),
        companyUserId,
        roleId: roleRec.id,
        roleCode: roleRec.code,
        roleTemplateVersion: activeTpl.versionNumber,
        isPrimary: makePrimary,
        assignmentStatus: 'ACTIVE',
        assignedBy: actorId,
        assignedAt: new Date(),
        effectiveFrom: options?.effectiveFrom || new Date().toISOString().slice(0, 10),
        effectiveTo: options?.effectiveTo || null,
        assignmentReason: options?.reason || `Assigned ${resolvedTargetRole} role`
      });
    }

    await this.syncMultiRoleModulesForUser(
      companyUserId,
      actorId,
      actorName,
      options?.reason || `Assigned role ${resolvedTargetRole}`,
      options?.preserveCustomModuleOverrides === false
    );

    const updated = await this.getMemberRoles(companyUserId);

    await AuditService.log({
      req,
      companyId: membership.companyId,
      action: updated.normalizedRoles.length > 1 ? "MULTIPLE_ROLES_ASSIGNED" : "ROLE_ASSIGNED",
      entityType: "MEMBERSHIP",
      entityId: companyUserId,
      module: "RBAC",
      reason: options?.reason || `Assigned role ${resolvedTargetRole}`,
      beforeData: { roles: targetRoles, primaryRole: targetPrimaryRole },
      afterData: { roles: updated.normalizedRoles, primaryRole: updated.primaryRole, addedRole: resolvedTargetRole },
      metadata: {
        targetUserId: membership.userId,
        roles: updated.normalizedRoles,
        primaryRole: updated.primaryRole,
        compatibilityType: compat.compatibilityType,
        warnings: compat.warnings
      }
    });

    return {
      ...updated,
      assignedRole: resolvedTargetRole,
      assignedRoles: updated.normalizedRoles as string[],
      compatibilityWarnings: compat.warnings
    };
  }

  /**
   * Remove/revoke a specific role from a member in `company_user_roles`.
   */
  static async removeRoleFromMember(
    req: any,
    companyUserId: string,
    roleNameOrId: string,
    reason?: string
  ) {
    const { membership, targetRoles, targetPrimaryRole } = await this.assertActorCanModifyMember(
      req,
      companyUserId,
      `revoke role ${roleNameOrId}`
    );

    const allRows = await db
      .select({
        id: companyUserRoles.id,
        roleId: companyUserRoles.roleId,
        isPrimary: companyUserRoles.isPrimary,
        assignmentStatus: companyUserRoles.assignmentStatus,
        roleName: roles.name,
        roleCode: roles.code
      })
      .from(companyUserRoles)
      .innerJoin(roles, eq(companyUserRoles.roleId, roles.id))
      .where(and(eq(companyUserRoles.companyUserId, companyUserId), eq(companyUserRoles.assignmentStatus, 'ACTIVE')));

    const targetRow = allRows.find(
      r =>
        r.roleId === roleNameOrId ||
        r.id === roleNameOrId ||
        this.resolveCanonicalOrCustomRoleName(r.roleName).toLowerCase() === this.resolveCanonicalOrCustomRoleName(roleNameOrId).toLowerCase() ||
        r.roleCode.toLowerCase() === roleNameOrId.toLowerCase()
    );

    if (!targetRow) {
      throw new Error(`Active role assignment '${roleNameOrId}' not found on this member.`);
    }

    if (allRows.length <= 1) {
      throw new Error("A company member must have at least one active primary role. Assign another role before revoking this role, or remove the member from the company.");
    }

    const resolvedRevokedName = this.resolveCanonicalOrCustomRoleName(targetRow.roleName);
    if (resolvedRevokedName === 'Company Owner') {
      await this.assertActorCanModifyMember(req, companyUserId, 'revoke Company Owner role', { isRevokingOwnerRole: true });
    }

    await db
      .update(companyUserRoles)
      .set({
        assignmentStatus: 'REVOKED',
        isPrimary: false,
        assignmentReason: reason || `Role ${resolvedRevokedName} revoked`
      })
      .where(eq(companyUserRoles.id, targetRow.id));

    // If the revoked role was primary, promote the next active role to primary
    const remainingActive = allRows.filter(r => r.id !== targetRow.id);
    if (targetRow.isPrimary && remainingActive.length > 0) {
      const nextPrimary = remainingActive[0];
      await db
        .update(companyUserRoles)
        .set({ isPrimary: true })
        .where(eq(companyUserRoles.id, nextPrimary.id));
      await db
        .update(companyUsers)
        .set({ roleId: nextPrimary.roleId, legacyRole: nextPrimary.roleName, updatedAt: new Date() })
        .where(eq(companyUsers.id, companyUserId));
    }

    const actorId = req?.user?.id || 'SYSTEM';
    const actorName = req?.user?.displayName || req?.user?.email || 'Administrator';
    await this.syncMultiRoleModulesForUser(
      companyUserId,
      actorId,
      actorName,
      reason || `Revoked role ${resolvedRevokedName} and recalculated effective permissions`,
      false
    );

    const updated = await this.getMemberRoles(companyUserId);

    await AuditService.log({
      req,
      companyId: membership.companyId,
      action: "ROLE_REVOKED",
      entityType: "MEMBERSHIP",
      entityId: companyUserId,
      module: "RBAC",
      reason: reason || `Revoked role ${resolvedRevokedName}`,
      beforeData: { roles: targetRoles, primaryRole: targetPrimaryRole },
      afterData: { roles: updated.normalizedRoles, primaryRole: updated.primaryRole, revokedRole: resolvedRevokedName }
    });

    return {
      ...updated,
      removedRole: resolvedRevokedName,
      assignedRoles: updated.normalizedRoles as string[]
    };
  }

  /**
   * Designate an existing active role on a member as their Primary Role.
   */
  static async setPrimaryRoleForMember(
    req: any,
    companyUserId: string,
    roleNameOrId: string,
    reason?: string
  ) {
    const { membership, targetRoles, targetPrimaryRole } = await this.assertActorCanModifyMember(
      req,
      companyUserId,
      `set primary role to ${roleNameOrId}`
    );

    const allRows = await db
      .select({
        id: companyUserRoles.id,
        roleId: companyUserRoles.roleId,
        roleName: roles.name,
        roleCode: roles.code
      })
      .from(companyUserRoles)
      .innerJoin(roles, eq(companyUserRoles.roleId, roles.id))
      .where(and(eq(companyUserRoles.companyUserId, companyUserId), eq(companyUserRoles.assignmentStatus, 'ACTIVE')));

    const targetRow = allRows.find(
      r =>
        r.roleId === roleNameOrId ||
        r.id === roleNameOrId ||
        this.resolveCanonicalOrCustomRoleName(r.roleName).toLowerCase() === this.resolveCanonicalOrCustomRoleName(roleNameOrId).toLowerCase()
    );

    if (!targetRow) {
      // If not yet assigned, assign it as primary
      return await this.assignRoleToMember(req, companyUserId, roleNameOrId, {
        isPrimary: true,
        reason: reason || `Set primary role to ${roleNameOrId}`
      });
    }

    await db
      .update(companyUserRoles)
      .set({ isPrimary: false })
      .where(eq(companyUserRoles.companyUserId, companyUserId));

    await db
      .update(companyUserRoles)
      .set({ isPrimary: true })
      .where(eq(companyUserRoles.id, targetRow.id));

    const resolvedPrimaryName = this.resolveCanonicalOrCustomRoleName(targetRow.roleName);
    const activeTpl = await this.getActiveRoleTemplate(resolvedPrimaryName);

    await db
      .update(companyUsers)
      .set({
        roleId: targetRow.roleId,
        legacyRole: resolvedPrimaryName,
        roleTemplateVersion: activeTpl.versionNumber,
        updatedAt: new Date()
      })
      .where(eq(companyUsers.id, companyUserId));

    const actorId = req?.user?.id || 'SYSTEM';
    const actorName = req?.user?.displayName || req?.user?.email || 'Administrator';
    await this.syncMultiRoleModulesForUser(
      companyUserId,
      actorId,
      actorName,
      reason || `Changed primary role to ${resolvedPrimaryName}`,
      false
    );

    const updated = await this.getMemberRoles(companyUserId);

    await AuditService.log({
      req,
      companyId: membership.companyId,
      action: "PRIMARY_ROLE_CHANGED",
      entityType: "MEMBERSHIP",
      entityId: companyUserId,
      module: "RBAC",
      reason: reason || `Changed primary role to ${resolvedPrimaryName}`,
      beforeData: { primaryRole: targetPrimaryRole, roles: targetRoles },
      afterData: { primaryRole: updated.primaryRole, roles: updated.normalizedRoles }
    });

    return updated;
  }

  /**
   * Assign a full array of roles to a company member (primary role = index 0, additional roles = index 1..N),
   * enforcing multi-role compatibility, Owner Protection, and syncing inherited module templates.
   */
  static async setMemberRoles(
    req: any,
    companyUserId: string,
    targetRoleNames: string[],
    optionsOrReason?: { preserveCustomModuleOverrides?: boolean; reason?: string; effectiveFrom?: string; effectiveTo?: string } | string
  ): Promise<{ normalizedRoles: LedgerRole[]; assignedRoles: string[]; primaryRole: LedgerRole; compatibilityWarnings?: string[] }> {
    if (!targetRoleNames || targetRoleNames.length === 0) {
      throw new Error("At least one role must be assigned to a member.");
    }

    const options = typeof optionsOrReason === 'string'
      ? { reason: optionsOrReason, preserveCustomModuleOverrides: false }
      : (optionsOrReason || {});

    const resolvedTargets = Array.from(new Set(targetRoleNames.map(r => this.resolveCanonicalOrCustomRoleName(r))));
    const prevRoles = await this.getMemberRoles(companyUserId);

    // Enforce Owner Protection if req is present
    if (req && req.user) {
      const { isActorOwner } = await this.assertActorCanModifyMember(
        req,
        companyUserId,
        `update roles to [${resolvedTargets.join(', ')}]`,
        {
          isRevokingOwnerRole:
            (prevRoles.primaryRole === 'Company Owner' || (prevRoles.normalizedRoles as string[]).includes('Company Owner')) &&
            !resolvedTargets.includes('Company Owner')
        }
      );
      if (resolvedTargets.includes('Company Owner') && !isActorOwner) {
        const err: any = new Error("PERMISSION_DENIED: Owner Protection Policy Violation: Only an active Company Owner can assign the Company Owner role.");
        err.statusCode = 403;
        err.errorCode = "OWNER_PROTECTION_VIOLATION";
        throw err;
      }
    }

    const compatCheck = await this.validateRoleCompatibility(resolvedTargets);
    if (!compatCheck.valid) {
      throw new Error(compatCheck.conflicts.join(" | "));
    }

    const ensuredRoles = [];
    for (const rName of resolvedTargets) {
      const rec = await this.ensureRoleRecord(rName);
      const tpl = await this.getActiveRoleTemplate(rName);
      ensuredRoles.push({ ...rec, versionNumber: tpl.versionNumber });
    }

    const primaryRoleRec = ensuredRoles[0];
    const primaryRoleNorm = resolvedTargets[0] as LedgerRole;

    const roleChanged =
      prevRoles.primaryRole !== primaryRoleNorm ||
      prevRoles.normalizedRoles.length !== resolvedTargets.length ||
      prevRoles.normalizedRoles.some(r => !resolvedTargets.includes(r));

    await db
      .update(companyUsers)
      .set({
        roleId: primaryRoleRec.id,
        legacyRole: primaryRoleRec.name,
        roleTemplateVersion: primaryRoleRec.versionNumber,
        updatedAt: new Date()
      })
      .where(eq(companyUsers.id, companyUserId));

    const actorId = req?.user?.id || 'SYSTEM';
    const actorName = req?.user?.displayName || req?.user?.email || 'Administrator';

    // Mark removed roles as REVOKED rather than losing history, and upsert active roles
    const existingRows = await db
      .select()
      .from(companyUserRoles)
      .where(eq(companyUserRoles.companyUserId, companyUserId));

    const targetRoleIdSet = new Set(ensuredRoles.map(r => r.id));
    for (const row of existingRows) {
      if (!targetRoleIdSet.has(row.roleId) && row.assignmentStatus === 'ACTIVE') {
        await db
          .update(companyUserRoles)
          .set({
            assignmentStatus: 'REVOKED',
            isPrimary: false,
            assignmentReason: options?.reason || 'Role replaced in role assignment update'
          })
          .where(eq(companyUserRoles.id, row.id));
      }
    }

    for (let i = 0; i < ensuredRoles.length; i++) {
      const rec = ensuredRoles[i];
      const isPrimary = i === 0;
      const existing = existingRows.find(r => r.roleId === rec.id);
      if (existing) {
        await db
          .update(companyUserRoles)
          .set({
            roleCode: rec.code,
            roleTemplateVersion: rec.versionNumber,
            isPrimary,
            assignmentStatus: 'ACTIVE',
            assignedBy: actorId,
            assignedAt: new Date(),
            effectiveFrom: options?.effectiveFrom || existing.effectiveFrom || new Date().toISOString().slice(0, 10),
            effectiveTo: options?.effectiveTo ?? null,
            assignmentReason: options?.reason || `Assigned ${rec.name}`
          })
          .where(eq(companyUserRoles.id, existing.id));
      } else {
        await db.insert(companyUserRoles).values({
          id: crypto.randomUUID(),
          companyUserId,
          roleId: rec.id,
          roleCode: rec.code,
          roleTemplateVersion: rec.versionNumber,
          isPrimary,
          assignmentStatus: 'ACTIVE',
          assignedBy: actorId,
          assignedAt: new Date(),
          effectiveFrom: options?.effectiveFrom || new Date().toISOString().slice(0, 10),
          effectiveTo: options?.effectiveTo || null,
          assignmentReason: options?.reason || `Assigned ${rec.name}`
        }).catch(() => {});
      }
    }

    const existingAssignments = await db
      .select()
      .from(userModuleAssignments)
      .where(eq(userModuleAssignments.companyUserId, companyUserId));

    if (roleChanged || existingAssignments.length === 0 || !options?.preserveCustomModuleOverrides) {
      await this.syncMultiRoleModulesForUser(
        companyUserId,
        actorId,
        actorName,
        options?.reason || `Applied [${resolvedTargets.join(' + ')}] templates from Role Permissions Catalog`,
        !options?.preserveCustomModuleOverrides
      );
    }

    if (req) {
      const membership = await db.select().from(companyUsers).where(eq(companyUsers.id, companyUserId)).get();
      await AuditService.log({
        req,
        companyId: membership?.companyId,
        action: resolvedTargets.length > 1 ? "MULTIPLE_ROLES_ASSIGNED" : "USER_ROLES_UPDATED",
        entityType: "MEMBERSHIP",
        entityId: companyUserId,
        module: "RBAC",
        reason: options?.reason || `Updated roles to ${resolvedTargets.join(', ')}`,
        beforeData: { previousRole: prevRoles.primaryRole, previousRoles: prevRoles.normalizedRoles },
        afterData: { roles: resolvedTargets, primaryRole: primaryRoleNorm },
        metadata: {
          targetUserId: membership?.userId,
          roles: resolvedTargets,
          primaryRole: primaryRoleNorm,
          warnings: compatCheck.warnings
        }
      });
    }

    return {
      normalizedRoles: resolvedTargets as LedgerRole[],
      assignedRoles: resolvedTargets as string[],
      primaryRole: primaryRoleNorm,
      compatibilityWarnings: compatCheck.warnings
    };
  }

  /**
   * PHASE 3 & PHASE 5 — CENTRALIZED MULTI-ROLE EFFECTIVE PERMISSION & MODULE RESOLVER
   *
   * Resolves effective permissions deterministically using:
   * 1. Account status
   * 2. Active company membership
   * 3. Active role assignments (`company_user_roles`)
   * 4. Active role template versions (`role_template_versions`)
   * 5. Role-specific permissions (`inheritedPermissionsByRole`)
   * 6. Combined compatible role grants (`combinedRolePermissions`)
   * 7. User-specific grants (`USER_SPECIFIC_GRANT`)
   * 8. User-specific denials (`USER_SPECIFIC_DENY`)
   * 9. Hard security restrictions
   * 10. Data scopes (most restrictive applicable scope unless explicitly authorized)
   * 11. Approval limits (authoritative policy limit, never summed across roles)
   * 12. Segregation of Duties (SoD)
   */
  static async resolveEffectiveAccess(companyUserId: string): Promise<ResolvedEffectiveAccess> {
    const membership = await db
      .select()
      .from(companyUsers)
      .where(eq(companyUsers.id, companyUserId))
      .get();

    if (!membership) {
      return {
        companyUserId,
        userId: '',
        companyId: '',
        displayName: 'Unknown User',
        email: '',
        accountStatus: 'DISABLED',
        membershipStatus: 'INACTIVE',
        effectiveAccountActive: false,
        primaryRole: 'Read-only User',
        roles: ['Read-only User'],
        assignedRoles: [],
        additionalRoles: [],
        allRoleAssignments: [],
        roleTemplateVersion: 1,
        activeRoleTemplateVersions: {},
        inheritedPermissionsByRole: {},
        combinedRolePermissions: [],
        defaultDataScope: 'EXPLICIT_RECORDS',
        defaultApprovalLimitCentavos: 0,
        canApproveFinancialTransactions: false,
        canPostToGeneralLedger: false,
        isReadOnly: true,
        effectiveModuleIds: [],
        effectiveSubmodulesMap: {},
        effectivePermissions: [],
        effectiveDataScopes: {},
        effectiveApprovalLimits: {},
        inheritedPermissions: [],
        userSpecificGrants: [],
        userSpecificDenials: [],
        hardDeniedPermissions: [],
        sodRestrictions: ['Membership record not found. All access denied.'],
        incompatibleRoleWarnings: [],
        moduleResolutions: CANONICAL_ERP_MODULES.map(m => ({
          moduleId: m.id,
          moduleLabel: m.label,
          visible: false,
          status: 'RESTRICTED',
          origin: 'ACCOUNT_DISABLED',
          reason: 'No active company membership',
          allowedSubmoduleIds: [],
          allSubmoduleIds: m.submodules.map(s => s.id),
          allowedActions: [],
          deniedActions: ['view', 'create', 'edit', 'submit', 'review', 'approve', 'post', 'delete'],
          dataScope: 'EXPLICIT_RECORDS',
          approvalLimitCentavos: 0,
          templateVersion: 1
        }))
      };
    }

    const userRec = await db.select().from(users).where(eq(users.id, membership.userId)).get();
    const { normalizedRoles, primaryRole, additionalRoles, allRoleAssignments } = await this.getMemberRoles(companyUserId);
    const assignedRolesList = normalizedRoles.map(r => String(r));

    // Resolve all active role templates for the user's assigned roles
    const roleTemplatesMap: Record<string, any> = {};
    const activeRoleTemplateVersions: Record<string, number> = {};
    const inheritedPermissionsByRole: Record<string, string[]> = {};
    const combinedRolePermSet = new Set<string>();
    const combinedSodRestrictions = new Set<string>();

    for (const rName of assignedRolesList) {
      const tpl = await this.getActiveRoleTemplate(rName);
      roleTemplatesMap[rName] = tpl;
      activeRoleTemplateVersions[rName] = tpl.versionNumber;
      const rawRolePerms = Array.from(new Set([
        ...(tpl.defaultPermissionCodes || []),
        ...(SYSTEM_ROLE_PERMISSIONS[rName as LedgerRole] || [])
      ]));
      const rolePerms = Array.from(expandLegacyAliases(rawRolePerms));
      inheritedPermissionsByRole[rName] = rolePerms;
      for (const p of rolePerms) combinedRolePermSet.add(p);
      for (const s of tpl.sodRestrictions || []) combinedSodRestrictions.add(s);
    }

    const activeTpl = roleTemplatesMap[primaryRole] || (await this.getActiveRoleTemplate(primaryRole));
    const compatResult = await this.validateRoleCompatibility(assignedRolesList);
    for (const w of compatResult.warnings) {
      combinedSodRestrictions.add(w);
    }

    // Hard denied permissions across multi-role:
    // A permission is hard-denied if ALL assigned roles hard-deny it (or if no assigned role is allowed to hold it),
    // PLUS any SoD conflict restrictions.
    const allRoleTemplates = Object.values(roleTemplatesMap);
    const isOwnerAssigned = assignedRolesList.includes('Company Owner');
    const isAdminAssigned = assignedRolesList.includes('Company Administrator');

    const effectiveHardDeniedSet = new Set<string>();
    if (!isOwnerAssigned) {
      for (const code of activeTpl.hardDeniedPermissionCodes || []) {
        const grantedByCompatibleRole = allRoleTemplates.some(
          tpl => tpl.defaultPermissionCodes.includes(code) && !tpl.hardDeniedPermissionCodes.includes(code)
        );
        if (!grantedByCompatibleRole) {
          effectiveHardDeniedSet.add(code);
        }
      }
      if (!isAdminAssigned) {
        effectiveHardDeniedSet.add('users:manage');
        effectiveHardDeniedSet.add('roles:manage');
      }
    }

    const isLocked = Boolean(userRec?.lockedUntil && new Date(userRec.lockedUntil) > new Date());
    const accountStatus: 'ACTIVE' | 'DISABLED' | 'LOCKED' =
      !userRec || userRec.status === 'DISABLED'
        ? 'DISABLED'
        : isLocked
          ? 'LOCKED'
          : 'ACTIVE';
    const membershipStatus: 'ACTIVE' | 'DISABLED' | 'INACTIVE' | 'REMOVED' =
      membership.membershipStatus === 'REMOVED' || membership.status === 'REMOVED'
        ? 'REMOVED'
        : membership.status === 'DISABLED' || membership.membershipStatus === 'SUSPENDED'
          ? 'DISABLED'
          : 'ACTIVE';

    const effectiveAccountActive = accountStatus === 'ACTIVE' && membershipStatus === 'ACTIVE' && compatResult.valid;

    let dbModuleRows = await db
      .select()
      .from(userModuleAssignments)
      .where(eq(userModuleAssignments.companyUserId, companyUserId));

    // Initialize default module assignments ONLY if user has no stored rows at all
    if (dbModuleRows.length === 0 && membershipStatus !== 'REMOVED') {
      await this.syncMultiRoleModulesForUser(companyUserId, 'SYSTEM', 'System Governance', `Initialized ${assignedRolesList.join(' + ')} from Role Permissions Catalog`, true);
      dbModuleRows = await db
        .select()
        .from(userModuleAssignments)
        .where(eq(userModuleAssignments.companyUserId, companyUserId));
    }

    // Step 1 & 2: If account or membership is DISABLED/LOCKED/REMOVED, DENY ALL runtime access immediately!
    if (!effectiveAccountActive) {
      const denyReason =
        membershipStatus === 'REMOVED'
          ? 'Member has been removed from this company — all access revoked'
          : !compatResult.valid
            ? `Incompatible role combination blocked by SoD: ${compatResult.conflicts.join('; ')}`
            : `Account is ${accountStatus === 'LOCKED' ? 'LOCKED' : 'DISABLED'} — all access denied`;

      return {
        companyUserId,
        userId: membership.userId,
        companyId: membership.companyId,
        displayName: userRec?.displayName || 'Disabled User',
        email: userRec?.email || '',
        accountStatus,
        membershipStatus,
        effectiveAccountActive: false,
        primaryRole,
        roles: normalizedRoles,
        assignedRoles: assignedRolesList,
        additionalRoles: additionalRoles.map(r => String(r)),
        allRoleAssignments,
        roleTemplateVersion: activeTpl.versionNumber,
        activeRoleTemplateVersions,
        inheritedPermissionsByRole,
        combinedRolePermissions: Array.from(combinedRolePermSet),
        defaultDataScope: activeTpl.defaultDataScope,
        defaultApprovalLimitCentavos: 0,
        canApproveFinancialTransactions: false,
        canPostToGeneralLedger: false,
        isReadOnly: true,
        effectiveModuleIds: [],
        effectiveSubmodulesMap: {},
        effectivePermissions: [],
        effectiveDataScopes: {},
        effectiveApprovalLimits: {},
        inheritedPermissions: Array.from(combinedRolePermSet),
        userSpecificGrants: [],
        userSpecificDenials: [],
        hardDeniedPermissions: ALL_PERMISSIONS,
        sodRestrictions: [
          denyReason
        ],
        incompatibleRoleWarnings: [...compatResult.conflicts, ...compatResult.warnings],
        moduleResolutions: CANONICAL_ERP_MODULES.map(m => ({
          moduleId: m.id,
          moduleLabel: m.label,
          visible: false,
          status: 'RESTRICTED',
          origin: 'ACCOUNT_DISABLED',
          reason: denyReason,
          allowedSubmoduleIds: [],
          allSubmoduleIds: m.submodules.map(s => s.id),
          allowedActions: [],
          deniedActions: ['view', 'create', 'edit', 'submit', 'review', 'approve', 'post', 'delete'],
          dataScope: activeTpl.defaultDataScope,
          approvalLimitCentavos: 0,
          templateVersion: activeTpl.versionNumber
        }))
      };
    }

    const rowByModId = new Map<string, any>();
    for (const r of dbModuleRows) {
      rowByModId.set(r.moduleId, r);
    }

    const moduleResolutions: ResolvedModuleAccess[] = [];
    const effectiveModuleIds: string[] = [];
    const effectiveSubmodulesMap: Record<string, string[]> = {};
    const effectiveDataScopes: Record<string, CanonicalDataScope> = {};
    const effectiveApprovalLimits: Record<string, number> = {};

    const combinedCanApprove = isOwnerAssigned || allRoleTemplates.some(t => t.canApproveFinancialTransactions);
    const combinedCanPost = isOwnerAssigned || allRoleTemplates.some(t => t.canPostToGeneralLedger);
    const combinedIsReadOnly = !isOwnerAssigned && allRoleTemplates.every(t => t.isReadOnlyRole);

    const hasAnyCustomModuleOverrides = !isOwnerAssigned && dbModuleRows.some(
      r => r.origin === 'USER_SPECIFIC_GRANT' || r.origin === 'USER_SPECIFIC_DENY' || r.effect === 'DENY'
    );

    for (const mod of CANONICAL_ERP_MODULES) {
      const allSubIds = mod.submodules.map(s => s.id);
      const rolesWithMod = allRoleTemplates.filter(t => t.defaultPrimaryModules.includes(mod.id));
      const isInPrimaryRole = activeTpl.defaultPrimaryModules.includes(mod.id);
      const isInAnyAssignedRole = rolesWithMod.length > 0;
      const isHardRestrictedForAllRoles =
        !isOwnerAssigned &&
        allRoleTemplates.every(t => (t.hardRestrictedModuleIds || []).includes(mod.id));
      const userRow = rowByModId.get(mod.id);

      // Section 13 Rule: Active Company Owner has permanent unrestricted company-level access,
      // immune to stale user_module_assignments rows, employee checkboxes, or template restrictions.
      if (isOwnerAssigned) {
        effectiveModuleIds.push(mod.id);
        effectiveSubmodulesMap[mod.id] = allSubIds;
        effectiveDataScopes[mod.id] = 'COMPANY_WIDE';
        effectiveApprovalLimits[mod.id] = -1;
        moduleResolutions.push({
          moduleId: mod.id,
          moduleLabel: mod.label,
          visible: true,
          status: 'VISIBLE',
          origin: 'INHERITED_FROM_ROLE',
          reason: `Unrestricted Company Owner Authority (template v${activeTpl.versionNumber})`,
          allowedSubmoduleIds: allSubIds,
          allSubmoduleIds: allSubIds,
          allowedActions: ['view', 'create', 'edit', 'submit', 'review', 'approve', 'post', 'reverse', 'cancel', 'restore', 'verify', 'cleanup', 'export', 'delete', 'manage'],
          deniedActions: [],
          dataScope: 'COMPANY_WIDE',
          approvalLimitCentavos: -1,
          templateVersion: activeTpl.versionNumber
        });
        continue;
      }

      if (isHardRestrictedForAllRoles) {
        effectiveDataScopes[mod.id] = activeTpl.defaultDataScope;
        effectiveApprovalLimits[mod.id] = 0;
        moduleResolutions.push({
          moduleId: mod.id,
          moduleLabel: mod.label,
          visible: false,
          status: 'RESTRICTED',
          origin: 'SYSTEM_RESTRICTION',
          reason: `Hard role restriction: ${assignedRolesList.join(' + ')} cannot access ${mod.label}`,
          allowedSubmoduleIds: [],
          allSubmoduleIds: allSubIds,
          allowedActions: [],
          deniedActions: ['view', 'create', 'edit', 'submit', 'review', 'approve', 'post', 'delete'],
          dataScope: activeTpl.defaultDataScope,
          approvalLimitCentavos: 0,
          templateVersion: activeTpl.versionNumber
        });
        continue;
      }

      // Check explicit user denial (Precedence 5)
      if (userRow && userRow.effect === 'DENY') {
        const dScope = normalizeDataScope(userRow.dataScope || activeTpl.defaultDataScope);
        effectiveDataScopes[mod.id] = dScope;
        effectiveApprovalLimits[mod.id] = 0;
        moduleResolutions.push({
          moduleId: mod.id,
          moduleLabel: mod.label,
          visible: false,
          status: 'RESTRICTED',
          origin: 'USER_SPECIFIC_DENY',
          reason: userRow.reason || `Explicitly revoked for this user (overrides ${assignedRolesList.join(' + ')} template)`,
          allowedSubmoduleIds: [],
          allSubmoduleIds: allSubIds,
          allowedActions: [],
          deniedActions: ['view', 'create', 'edit', 'submit', 'review', 'approve', 'post', 'delete'],
          dataScope: dScope,
          approvalLimitCentavos: 0,
          templateVersion: activeTpl.versionNumber
        });
        continue;
      }

      // Combine submodules from all assigned roles that include this module
      const roleDefaultSubs = new Set<string>();
      for (const rt of rolesWithMod) {
        for (const s of (rt.defaultSubmodules[mod.id] || allSubIds)) {
          roleDefaultSubs.add(s);
        }
      }

      const isGrantedByRow = userRow && (userRow.effect === 'ALLOW' || !userRow.effect);
      const isGrantedByAdditionalRole = !userRow && isInAnyAssignedRole;

      if (isGrantedByRow || isGrantedByAdditionalRole) {
        const isCustomGrant = userRow?.origin === 'USER_SPECIFIC_GRANT';
        let parsedSubIds: string[] = [];
        try {
          parsedSubIds = userRow?.submoduleIds ? JSON.parse(userRow.submoduleIds) : [];
        } catch {
          parsedSubIds = [];
        }
        // If user also has additional roles contributing submodules and row is NOT an explicit custom grant, union them
        if (userRow && userRow.origin !== 'USER_SPECIFIC_GRANT') {
          for (const s of Array.from(roleDefaultSubs)) {
            if (!parsedSubIds.includes(s)) parsedSubIds.push(s);
          }
        }

        const candidateSubs = isCustomGrant
          ? parsedSubIds
          : (parsedSubIds.length > 0 ? parsedSubIds : (roleDefaultSubs.size > 0 ? Array.from(roleDefaultSubs) : allSubIds));
        const validSubIds = candidateSubs.filter(sid => {
          if (sid === 'md-roles' && !isOwnerAssigned && !isAdminAssigned) {
            return false;
          }
          return allSubIds.includes(sid);
        });

        if (validSubIds.length > 0 || (isCustomGrant && userRow?.actions)) {
          let origin: PermissionOrigin = 'INHERITED_FROM_ROLE';
          if (isCustomGrant || !isInAnyAssignedRole) {
            origin = 'USER_SPECIFIC_GRANT';
          } else if (rolesWithMod.length > 1 || (!isInPrimaryRole && isInAnyAssignedRole) || userRow?.origin === 'COMBINED_ROLES') {
            origin = 'COMBINED_ROLES';
          }

          const modCatalogPerms = CANONICAL_PERMISSION_CATALOG.filter(p => p.primaryModuleId === mod.id);
          let parsedActions: string[] = [];
          try {
            parsedActions = userRow?.actions ? JSON.parse(userRow.actions) : [];
          } catch {
            parsedActions = [];
          }

          // Combine actions across roles ONLY if inherited/combined (never for custom grant!)
          if (!isCustomGrant) {
            if (parsedActions.length === 0 || origin === 'COMBINED_ROLES') {
              const roleActions = modCatalogPerms
                .filter(p => combinedRolePermSet.has(p.code) && !effectiveHardDeniedSet.has(p.code))
                .map(p => p.action);
              parsedActions = Array.from(new Set([...parsedActions, ...roleActions]));
              if (!parsedActions.includes('view')) parsedActions.unshift('view');
            }
          }

          const allowedActions = Array.from(new Set(parsedActions.filter(act => {
            if (combinedIsReadOnly && act !== 'view' && !(assignedRolesList.includes('Auditor') && act === 'export')) {
              return false;
            }
            const matchingPerms = modCatalogPerms.filter(p => p.action === act);
            if (
              matchingPerms.length > 0 &&
              matchingPerms.every(p =>
                effectiveHardDeniedSet.has(p.code) ||
                assignedRolesList.every(r => (p.hardRestrictedRoles as string[]).includes(r))
              )
            ) {
              return false;
            }
            return true;
          })));

          const allModActions = Array.from(new Set(modCatalogPerms.map(p => p.action)));
          const deniedActions = allModActions.filter(a => !allowedActions.includes(a));

          // Resolve effective data scope for this module
          let modScope: CanonicalDataScope = activeTpl.defaultDataScope;
          if (userRow && userRow.origin === 'USER_SPECIFIC_GRANT' && userRow.dataScope) {
            modScope = normalizeDataScope(userRow.dataScope);
          } else if (rolesWithMod.length > 0) {
            let restrictive: CanonicalDataScope = normalizeDataScope(rolesWithMod[0].defaultDataScope);
            for (const rt of rolesWithMod) {
              const s = normalizeDataScope(rt.defaultDataScope);
              if (DATA_SCOPE_RESTRICTIVENESS[s] < DATA_SCOPE_RESTRICTIVENESS[restrictive]) {
                restrictive = s;
              }
            }
            modScope = userRow?.dataScope ? normalizeDataScope(userRow.dataScope) : restrictive;
          } else if (userRow?.dataScope) {
            modScope = normalizeDataScope(userRow.dataScope);
          }

          // Resolve effective approval limit for this module (never sum limits across roles!)
          let modLimit = 0;
          if (userRow && userRow.origin === 'USER_SPECIFIC_GRANT' && typeof userRow.approvalLimitCentavos === 'number' && userRow.approvalLimitCentavos > 0) {
            modLimit = userRow.approvalLimitCentavos;
          } else if (combinedCanApprove) {
            for (const rt of rolesWithMod) {
              if (rt.canApproveFinancialTransactions) {
                if (rt.defaultApprovalLimitCentavos === -1) {
                  modLimit = -1;
                  break;
                } else if (rt.defaultApprovalLimitCentavos > modLimit) {
                  modLimit = rt.defaultApprovalLimitCentavos;
                }
              }
            }
            if (userRow && typeof userRow.approvalLimitCentavos === 'number' && userRow.approvalLimitCentavos > 0) {
              modLimit = userRow.approvalLimitCentavos;
            }
          }

          effectiveModuleIds.push(mod.id);
          effectiveSubmodulesMap[mod.id] = validSubIds;
          effectiveDataScopes[mod.id] = modScope;
          effectiveApprovalLimits[mod.id] = modLimit;

          const contributingNames = rolesWithMod.map(r => r.roleName);
          moduleResolutions.push({
            moduleId: mod.id,
            moduleLabel: mod.label,
            visible: true,
            status: validSubIds.length === allSubIds.length ? 'VISIBLE' : 'PARTIAL',
            origin,
            reason:
              origin === 'COMBINED_ROLES'
                ? `Combined from roles: ${contributingNames.join(' + ')}`
                : origin === 'INHERITED_FROM_ROLE'
                  ? `Inherited from ${contributingNames[0] || primaryRole} template v${activeTpl.versionNumber}`
                  : (userRow?.reason || `Explicitly granted to user`),
            allowedSubmoduleIds: validSubIds,
            allSubmoduleIds: allSubIds,
            allowedActions,
            deniedActions,
            dataScope: modScope,
            departmentScopeId: userRow?.departmentScopeId || null,
            projectScopeId: userRow?.projectScopeId || null,
            costCenterScopeId: userRow?.costCenterScopeId || null,
            approvalLimitCentavos: modLimit,
            templateVersion: activeTpl.versionNumber
          });
          continue;
        }
      }

      const fallbackMemberScope = membership.defaultDataScope
        ? normalizeDataScope(membership.defaultDataScope)
        : activeTpl.defaultDataScope;
      effectiveDataScopes[mod.id] = fallbackMemberScope;
      effectiveApprovalLimits[mod.id] = 0;
      moduleResolutions.push({
        moduleId: mod.id,
        moduleLabel: mod.label,
        visible: false,
        status: 'RESTRICTED',
        origin: isInAnyAssignedRole ? 'USER_SPECIFIC_DENY' : 'SYSTEM_RESTRICTION',
        reason: isInAnyAssignedRole
          ? 'Unassigned in user module matrix'
          : `Not included in [${assignedRolesList.join(' + ')}] templates`,
        allowedSubmoduleIds: [],
        allSubmoduleIds: allSubIds,
        allowedActions: [],
        deniedActions: ['view', 'create', 'edit', 'submit', 'review', 'approve', 'post', 'delete'],
        dataScope: fallbackMemberScope,
        approvalLimitCentavos: 0,
        templateVersion: activeTpl.versionNumber
      });
    }

    // Step 6: Resolve Action & Resource Permission Codes across all assigned roles
    const modulePermPrefixMap: Record<string, string[]> = {
      'dashboard': ['dashboard:'],
      'sales': ['sales:', 'invoices:'],
      'procurement': ['purchases:', 'purchasing:', 'procurement:', 'bills:'],
      'inventory': ['inventory:'],
      'cash-banking': ['cash:', 'bank_rec:'],
      'accounting': ['accounting:', 'journals:', 'accounts:', 'periods:'],
      'fixed-assets': ['fixedassets:', 'fixed_assets:'],
      'payroll': ['payroll:'],
      'tax': ['tax:'],
      'budget': ['budget:'],
      'documents': ['documents:'],
      'reports': ['reports:'],
      'approvals': ['approvals:'],
      'activity-center': ['activity:'],
      'audit': ['audit:'],
      'master-data': ['masterdata:', 'customers:', 'vendors:', 'users:', 'roles:', 'settings:', 'backup:', 'backups:', 'storage:', 'lan:']
    };

    const effectivePermSet = new Set<string>();

    if (isOwnerAssigned) {
      for (const p of ALL_PERMISSIONS) effectivePermSet.add(p);
      effectivePermSet.add('*');
    } else if (!hasAnyCustomModuleOverrides) {
      // Precedence 3: Pure assigned-role mode (no custom overrides exist for this user)
      // Inherit all permissions granted by assigned roles, minus hard denied permissions
      for (const p of Array.from(combinedRolePermSet)) {
        if (!effectiveHardDeniedSet.has(p)) {
          effectivePermSet.add(p);
        }
      }
    } else {
      // User has custom module overrides in the matrix:
      // 1. Non-module global permissions from role templates (e.g. company:read, profile:view)
      for (const p of Array.from(combinedRolePermSet)) {
        if (p === '*') continue;
        const isModuleMapped = CANONICAL_ERP_MODULES.some(m => {
          const prefixes = modulePermPrefixMap[m.id] || [];
          return prefixes.some(pref => p.startsWith(pref));
        }) || CANONICAL_PERMISSION_CATALOG.some(c => c.code === p);
        if (!isModuleMapped && !effectiveHardDeniedSet.has(p)) {
          effectivePermSet.add(p);
        }
      }

      // 2. Resolve module permissions based on module resolution provenance
      for (const res of moduleResolutions) {
        const modId = res.moduleId;
        const prefixes = modulePermPrefixMap[modId] || [];
        const modCatalogPerms = CANONICAL_PERMISSION_CATALOG.filter(p => p.primaryModuleId === modId);

        // Precedence 1: Explicit DENY / unchecked module
        if (!res.visible || res.origin === 'USER_SPECIFIC_DENY') {
          // Zero permissions for this module
          continue;
        }

        // Precedence 2: Explicit GRANT / checked custom permission
        if (res.origin === 'USER_SPECIFIC_GRANT') {
          for (const mp of modCatalogPerms) {
            const isHardRestricted =
              !isOwnerAssigned && (
                effectiveHardDeniedSet.has(mp.code) ||
                assignedRolesList.every(r => (mp.hardRestrictedRoles as string[]).includes(r))
              );
            if (isHardRestricted) continue;

            const actionAllowed = res.allowedActions.includes(mp.action);
            const submoduleAllowed = !mp.submoduleId || res.allowedSubmoduleIds.includes(mp.submoduleId);

            if (actionAllowed && submoduleAllowed) {
              effectivePermSet.add(mp.code);
            }
          }

          // Add legacy aliases strictly for allowed actions
          for (const act of res.allowedActions) {
            const aliases = getLegacyAliasesForModuleAction(modId, act);
            for (const al of aliases) {
              if (!effectiveHardDeniedSet.has(al)) {
                effectivePermSet.add(al);
              }
            }
          }
        } else {
          // Precedence 3: Compatible assigned-role permissions (no custom override exists for this module)
          for (const p of Array.from(combinedRolePermSet)) {
            if (p === '*') continue;
            const matchesPrefix = prefixes.some(pref => p.startsWith(pref));
            const matchesCatalog = modCatalogPerms.some(c => c.code === p);
            if (matchesPrefix || matchesCatalog) {
              if (!effectiveHardDeniedSet.has(p)) {
                effectivePermSet.add(p);
              }
            }
          }
        }
      }
    }

    // Apply explicit user_permission_overrides (Precedence 1 & 2 overrides)
    const overrides = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.companyUserId, companyUserId));

    const userSpecificGrants: string[] = [];
    const userSpecificDenials: string[] = [];

    const getRelatedPermissionVariants = (code: string): string[] => {
      const variants = new Set<string>([code]);
      if (code.startsWith('backups:')) variants.add(code.replace(/^backups:/, 'backup:'));
      if (code.startsWith('backup:')) variants.add(code.replace(/^backup:/, 'backups:'));
      if (code === 'audit:view' || code === 'audit:read') {
        variants.add('audit:view');
        variants.add('audit:read');
        variants.add('audit:integrity:view');
        variants.add('audit:integrity:scan');
      }
      if (code === 'audit:export') {
        variants.add('audit:integrity:export');
      }
      if (code === 'payroll:view' || code === 'payroll:read') {
        variants.add('payroll:view');
        variants.add('payroll:read');
        variants.add('ai:inquiry:sensitive');
      }
      if (code === 'settings:manage' || code === 'settings:write') {
        variants.add('ai:keys:manage');
      }
      if (code === 'settings:view' || code === 'settings:read') {
        variants.add('ai:config');
        variants.add('ai:provider:test');
      }
      return Array.from(variants);
    };

    for (const ov of overrides) {
      if (ov.effect === 'DENY') {
        if (isOwnerAssigned) {
          // Active Company Owner is immune to DENY permission overrides
          continue;
        }
        for (const v of getRelatedPermissionVariants(ov.permissionCode)) {
          effectivePermSet.delete(v);
        }
        effectivePermSet.delete('*');
        userSpecificDenials.push(ov.permissionCode);
      } else if (ov.effect === 'ALLOW') {
        const catEntry = CANONICAL_PERMISSION_CATALOG.find(p => p.code === ov.permissionCode);
        const isHardDenied =
          !isOwnerAssigned && (
            effectiveHardDeniedSet.has(ov.permissionCode) ||
            (catEntry && assignedRolesList.every(r => (catEntry.hardRestrictedRoles as string[]).includes(r)))
          );
        if (!isHardDenied) {
          effectivePermSet.add(ov.permissionCode);
          userSpecificGrants.push(ov.permissionCode);
        }
      }
    }

    for (const mr of moduleResolutions) {
      if (mr.origin === 'USER_SPECIFIC_GRANT' && !userSpecificGrants.includes(`module:${mr.moduleId}`)) {
        userSpecificGrants.push(`module:${mr.moduleId}`);
      } else if (mr.origin === 'USER_SPECIFIC_DENY' && !userSpecificDenials.includes(`module:${mr.moduleId}`)) {
        userSpecificDenials.push(`module:${mr.moduleId}`);
      }
    }

    // Enforce hard role restrictions (Precedence 3)
    if (!isOwnerAssigned) {
      for (const deniedCode of Array.from(effectiveHardDeniedSet)) {
        effectivePermSet.delete(deniedCode);
      }
      if (combinedIsReadOnly) {
        for (const code of Array.from(effectivePermSet)) {
          const isViewOrExport =
            code.endsWith(':view') ||
            code.endsWith(':read') ||
            code.endsWith(':verify') ||
            (assignedRolesList.includes('Auditor') && (code.endsWith(':export') || code.endsWith(':export_dat')));
          if (!isViewOrExport) {
            effectivePermSet.delete(code);
          }
        }
      }
    }

    const hasCustomDenialsOrOverrides = !isOwnerAssigned && (hasAnyCustomModuleOverrides || userSpecificDenials.length > 0);
    const expandedFinalPerms = isOwnerAssigned
      ? new Set<string>(['*', ...ALL_PERMISSIONS])
      : expandLegacyAliases(effectivePermSet);

    if (!isOwnerAssigned) {
      if (hasCustomDenialsOrOverrides) {
        expandedFinalPerms.delete('*');
      }
      for (const d of userSpecificDenials) {
        for (const v of getRelatedPermissionVariants(d)) {
          expandedFinalPerms.delete(v);
        }
      }
      if (!isOwnerAssigned) {
        for (const hd of Array.from(effectiveHardDeniedSet)) expandedFinalPerms.delete(hd);
      }

      // Enforce custom denials, unchecked submodules, and unchecked actions strictly against expanded aliases
      for (const res of moduleResolutions) {
        const prefixes = modulePermPrefixMap[res.moduleId] || [];
        const modCatalogPerms = CANONICAL_PERMISSION_CATALOG.filter(p => p.primaryModuleId === res.moduleId);

        const isExplicitUserModuleDeny =
          res.origin === 'USER_SPECIFIC_DENY' ||
          (hasAnyCustomModuleOverrides && !res.visible);

        if (isExplicitUserModuleDeny) {
          for (const p of Array.from(expandedFinalPerms)) {
            if (prefixes.some(pref => p.startsWith(pref)) || modCatalogPerms.some(c => c.code === p)) {
              if (!userSpecificGrants.includes(p)) {
                expandedFinalPerms.delete(p);
              }
            }
          }
        } else if (res.origin === 'USER_SPECIFIC_GRANT') {
          for (const deniedAct of res.deniedActions) {
            const deniedAliases = getLegacyAliasesForModuleAction(res.moduleId, deniedAct);
            for (const da of deniedAliases) {
              if (!userSpecificGrants.includes(da)) {
                expandedFinalPerms.delete(da);
              }
            }
            for (const mp of modCatalogPerms) {
              if (mp.action === deniedAct) {
                if (mp.submoduleId === 'md-backup-vault' && res.allowedSubmoduleIds.includes('md-backup-vault') && res.allowedActions.includes('manage')) {
                  continue;
                }
                for (const v of getRelatedPermissionVariants(mp.code)) {
                  if (!userSpecificGrants.includes(v)) {
                    expandedFinalPerms.delete(v);
                  }
                }
              }
            }
          }
          // Also remove permissions belonging to unchecked submodules (e.g., md-backup-vault unchecked in master-data)
          for (const mp of modCatalogPerms) {
            if (mp.submoduleId && !res.allowedSubmoduleIds.includes(mp.submoduleId)) {
              for (const v of getRelatedPermissionVariants(mp.code)) {
                if (!userSpecificGrants.includes(v)) {
                  expandedFinalPerms.delete(v);
                }
              }
            }
          }
          if (res.moduleId === 'master-data' && !res.allowedSubmoduleIds.includes('md-backup-vault')) {
            for (const p of Array.from(expandedFinalPerms)) {
              if ((p.startsWith('backup:') || p.startsWith('backups:') || p.startsWith('storage:')) && !userSpecificGrants.includes(p)) {
                expandedFinalPerms.delete(p);
              }
            }
          }
          if (res.moduleId === 'master-data' && !res.allowedSubmoduleIds.includes('md-lan-network')) {
            for (const p of Array.from(expandedFinalPerms)) {
              if (p.startsWith('lan:') && !userSpecificGrants.includes(p)) {
                expandedFinalPerms.delete(p);
              }
            }
          }
        }
      }
      // Re-apply explicit user-level DENY overrides last so Precedence 1 always wins
      for (const d of userSpecificDenials) {
        for (const v of getRelatedPermissionVariants(d)) {
          expandedFinalPerms.delete(v);
        }
      }
    }

    // Determine effective approval limit (Company Owner is permanently unlimited -1 and COMPANY_WIDE)
    let effectiveDefaultLimit = isOwnerAssigned ? -1 : activeTpl.defaultApprovalLimitCentavos;
    if (!isOwnerAssigned) {
      for (const rt of allRoleTemplates) {
        if (rt.canApproveFinancialTransactions) {
          if (rt.defaultApprovalLimitCentavos === -1 || effectiveDefaultLimit === -1) {
            effectiveDefaultLimit = -1;
          } else if (rt.defaultApprovalLimitCentavos > effectiveDefaultLimit) {
            effectiveDefaultLimit = rt.defaultApprovalLimitCentavos;
          }
        }
      }
      const explicitMemberLimit = (membership as any).approvalLimitCentavos;
      if (typeof explicitMemberLimit === 'number' && !Number.isNaN(explicitMemberLimit)) {
        effectiveDefaultLimit = explicitMemberLimit;
      } else {
        for (const mr of moduleResolutions) {
          if (mr.visible) {
            if (mr.approvalLimitCentavos === -1 || effectiveDefaultLimit === -1) {
              effectiveDefaultLimit = -1;
            } else if (mr.approvalLimitCentavos > effectiveDefaultLimit) {
              effectiveDefaultLimit = mr.approvalLimitCentavos;
            }
          }
        }
      }
    }

    return {
      companyUserId,
      userId: membership.userId,
      companyId: membership.companyId,
      displayName: userRec?.displayName || 'Company Member',
      email: userRec?.email || '',
      accountStatus,
      membershipStatus,
      effectiveAccountActive: true,
      primaryRole,
      roles: normalizedRoles,
      assignedRoles: assignedRolesList,
      additionalRoles: additionalRoles.map(r => String(r)),
      allRoleAssignments,
      roleTemplateVersion: activeTpl.versionNumber,
      activeRoleTemplateVersions,
      inheritedPermissionsByRole,
      combinedRolePermissions: Array.from(combinedRolePermSet),
      defaultDataScope: isOwnerAssigned ? 'COMPANY_WIDE' : activeTpl.defaultDataScope,
      defaultApprovalLimitCentavos: effectiveDefaultLimit,
      canApproveFinancialTransactions: combinedCanApprove,
      canPostToGeneralLedger: combinedCanPost,
      isReadOnly: combinedIsReadOnly,
      effectiveModuleIds,
      effectiveSubmodulesMap,
      effectivePermissions: Array.from(expandedFinalPerms),
      effectiveDataScopes,
      effectiveApprovalLimits,
      inheritedPermissions: Array.from(combinedRolePermSet),
      userSpecificGrants,
      userSpecificDenials,
      hardDeniedPermissions: isOwnerAssigned ? [] : Array.from(effectiveHardDeniedSet),
      sodRestrictions: isOwnerAssigned ? [] : Array.from(combinedSodRestrictions),
      incompatibleRoleWarnings: compatResult.warnings,
      moduleResolutions
    };
  }

  /**
   * Evaluate effective permissions for a company member (delegates directly to resolveEffectiveAccess).
   */
  static async evaluateEffectivePermissions(companyUserId: string): Promise<string[]> {
    const resolved = await this.resolveEffectiveAccess(companyUserId);
    return resolved.effectivePermissions;
  }

  /**
   * Check whether a resolved permission set or ResolvedEffectiveAccess grants at least one of the required permission codes.
   */
  static hasPermission(
    effectivePermissionsOrAccess: string[] | { effectivePermissions: string[] } | undefined | null,
    ...requiredCodes: string[]
  ): boolean {
    if (!effectivePermissionsOrAccess) return false;
    const perms = Array.isArray(effectivePermissionsOrAccess)
      ? effectivePermissionsOrAccess
      : (effectivePermissionsOrAccess.effectivePermissions || []);
    if (perms.includes('*')) return true;

    return requiredCodes.some(code => {
      const canonical = code.toLowerCase();
      const legacy = canonical.replace(':', '_').toUpperCase();
      return perms.some(p => {
        const pLower = p.toLowerCase();
        return pLower === canonical || pLower.toUpperCase() === legacy || pLower === '*';
      });
    });
  }

  /**
   * Resolve row-level data-scope predicate (COMPANY_WIDE, DEPARTMENT, PROJECT, COST_CENTER, OWN_RECORDS, ASSIGNED_RECORDS)
   * for a specific module and company member.
   */
  static async resolveModuleDataScope(
    membershipId: string | undefined | null,
    userId: string,
    moduleId: string
  ): Promise<ResolvedDataScopePredicate> {
    if (!membershipId || membershipId === 'owner-auto-assigned') {
      return {
        moduleId,
        userId,
        membershipId: membershipId || 'owner-auto-assigned',
        dataScope: 'COMPANY_WIDE',
        departmentScopeId: null,
        departmentMatches: [],
        projectScopeId: null,
        projectMatches: [],
        costCenterScopeId: null,
        costCenterMatches: [],
        approvalLimitCentavos: -1,
        isCompanyWide: true,
        matchesRecord: () => true,
        assertRecordAccess: () => {}
      };
    }

    const resolved = await this.resolveEffectiveAccess(membershipId);
    const isOwner = resolved.roles.includes('Company Owner') || resolved.effectivePermissions.includes('*');
    if (isOwner) {
      return {
        moduleId,
        userId,
        membershipId,
        dataScope: 'COMPANY_WIDE',
        departmentScopeId: null,
        departmentMatches: [],
        projectScopeId: null,
        projectMatches: [],
        costCenterScopeId: null,
        costCenterMatches: [],
        approvalLimitCentavos: -1,
        isCompanyWide: true,
        matchesRecord: () => true,
        assertRecordAccess: () => {}
      };
    }

    const modRes = resolved.moduleResolutions.find(m => m.moduleId === moduleId);
    const membershipRow = await db.select().from(companyUsers).where(eq(companyUsers.id, membershipId)).get();
    const memberDefaultScope = membershipRow?.defaultDataScope ? normalizeDataScope(membershipRow.defaultDataScope) : null;

    let dataScope: CanonicalDataScope = modRes?.dataScope || memberDefaultScope || resolved.defaultDataScope || 'COMPANY_WIDE';
    let departmentScopeId: string | null = modRes?.departmentScopeId || null;
    let projectScopeId: string | null = modRes?.projectScopeId || null;
    let costCenterScopeId: string | null = modRes?.costCenterScopeId || null;

    // Fallback to any active module assignment that specifies a concrete scope ID if this module inherited scope without an explicit row ID
    if (!departmentScopeId || !projectScopeId || !costCenterScopeId) {
      for (const mr of resolved.moduleResolutions) {
        if (!departmentScopeId && mr.departmentScopeId) departmentScopeId = mr.departmentScopeId;
        if (!projectScopeId && mr.projectScopeId) projectScopeId = mr.projectScopeId;
        if (!costCenterScopeId && mr.costCenterScopeId) costCenterScopeId = mr.costCenterScopeId;
        if (dataScope === 'COMPANY_WIDE' && mr.dataScope !== 'COMPANY_WIDE' && (moduleId === 'master-data' || mr.moduleId === moduleId)) {
          dataScope = mr.dataScope;
        }
      }
    }

    const departmentMatchesSet = new Set<string>();
    if (departmentScopeId) {
      departmentMatchesSet.add(departmentScopeId.trim().toUpperCase());
      try {
        const deptRow = await db
          .select()
          .from(departments)
          .where(
            or(
              eq(departments.id, departmentScopeId),
              eq(departments.code, departmentScopeId),
              eq(departments.name, departmentScopeId)
            )
          )
          .get();
        if (deptRow) {
          departmentMatchesSet.add(deptRow.id.trim().toUpperCase());
          departmentMatchesSet.add(deptRow.code.trim().toUpperCase());
          departmentMatchesSet.add(deptRow.name.trim().toUpperCase());
        }
      } catch (_) {}
    }

    const projectMatchesSet = new Set<string>();
    if (projectScopeId) {
      projectMatchesSet.add(projectScopeId.trim().toUpperCase());
      try {
        const projRow = await db
          .select()
          .from(projects)
          .where(
            or(
              eq(projects.id, projectScopeId),
              eq(projects.code, projectScopeId),
              eq(projects.name, projectScopeId)
            )
          )
          .get();
        if (projRow) {
          projectMatchesSet.add(projRow.id.trim().toUpperCase());
          projectMatchesSet.add(projRow.code.trim().toUpperCase());
          projectMatchesSet.add(projRow.name.trim().toUpperCase());
        }
      } catch (_) {}
    }

    const costCenterMatchesSet = new Set<string>();
    if (costCenterScopeId) {
      costCenterMatchesSet.add(costCenterScopeId.trim().toUpperCase());
      try {
        const ccRow = await db
          .select()
          .from(costCenters)
          .where(
            or(
              eq(costCenters.id, costCenterScopeId),
              eq(costCenters.code, costCenterScopeId),
              eq(costCenters.name, costCenterScopeId)
            )
          )
          .get();
        if (ccRow) {
          costCenterMatchesSet.add(ccRow.id.trim().toUpperCase());
          costCenterMatchesSet.add(ccRow.code.trim().toUpperCase());
          costCenterMatchesSet.add(ccRow.name.trim().toUpperCase());
        }
      } catch (_) {}
    }

    const departmentMatches = Array.from(departmentMatchesSet);
    const projectMatches = Array.from(projectMatchesSet);
    const costCenterMatches = Array.from(costCenterMatchesSet);
    const isCompanyWide = dataScope === 'COMPANY_WIDE';

    const matchesRecord = (record: {
      createdBy?: string | null;
      submittedBy?: string | null;
      assignedTo?: string | null;
      departmentId?: string | null;
      department?: string | null;
      projectId?: string | null;
      project?: string | null;
      costCenterId?: string | null;
      costCenter?: string | null;
    }): boolean => {
      if (dataScope === 'COMPANY_WIDE') return true;

      if (dataScope === 'OWN_RECORDS') {
        if (record.createdBy !== undefined || record.submittedBy !== undefined) {
          return (
            (record.createdBy !== undefined && record.createdBy !== null && record.createdBy === userId) ||
            (record.submittedBy !== undefined && record.submittedBy !== null && record.submittedBy === userId)
          );
        }
        return false;
      }

      if (dataScope === 'ASSIGNED_RECORDS') {
        if (record.assignedTo !== undefined || record.createdBy !== undefined || record.submittedBy !== undefined) {
          return (
            (record.assignedTo !== undefined && record.assignedTo !== null && record.assignedTo === userId) ||
            (record.createdBy !== undefined && record.createdBy !== null && record.createdBy === userId) ||
            (record.submittedBy !== undefined && record.submittedBy !== null && record.submittedBy === userId)
          );
        }
        return false;
      }

      if (dataScope === 'DEPARTMENT') {
        if (departmentMatches.length === 0) return false;
        const candDeptId = record.departmentId ? String(record.departmentId).trim().toUpperCase() : null;
        const candDept = record.department ? String(record.department).trim().toUpperCase() : null;
        if (candDeptId !== null || candDept !== null) {
          return (
            (candDeptId !== null && departmentMatches.includes(candDeptId)) ||
            (candDept !== null && departmentMatches.includes(candDept))
          );
        }
        if (record.createdBy !== undefined && record.createdBy !== null) {
          return record.createdBy === userId;
        }
        return false;
      }

      if (dataScope === 'PROJECT') {
        if (projectMatches.length === 0) return false;
        const candProjId = record.projectId ? String(record.projectId).trim().toUpperCase() : null;
        const candProj = record.project ? String(record.project).trim().toUpperCase() : null;
        if (candProjId !== null || candProj !== null) {
          return (
            (candProjId !== null && projectMatches.includes(candProjId)) ||
            (candProj !== null && projectMatches.includes(candProj))
          );
        }
        if (record.createdBy !== undefined && record.createdBy !== null) {
          return record.createdBy === userId;
        }
        return false;
      }

      if (dataScope === 'COST_CENTER') {
        if (costCenterMatches.length === 0) return false;
        const candCcId = record.costCenterId ? String(record.costCenterId).trim().toUpperCase() : null;
        const candCc = record.costCenter ? String(record.costCenter).trim().toUpperCase() : null;
        if (candCcId !== null || candCc !== null) {
          return (
            (candCcId !== null && costCenterMatches.includes(candCcId)) ||
            (candCc !== null && costCenterMatches.includes(candCc))
          );
        }
        if (record.createdBy !== undefined && record.createdBy !== null) {
          return record.createdBy === userId;
        }
        return false;
      }

      return false;
    };

    const assertRecordAccess = (
      record: {
        createdBy?: string | null;
        submittedBy?: string | null;
        assignedTo?: string | null;
        departmentId?: string | null;
        department?: string | null;
        projectId?: string | null;
        project?: string | null;
        costCenterId?: string | null;
        costCenter?: string | null;
      },
      entityLabel = 'record'
    ) => {
      if (!matchesRecord(record)) {
        const err: any = new Error(
          `Data Scope Restriction (${dataScope}): Your account is restricted to assigned ${dataScope} scope in module '${moduleId}' and cannot access or modify this ${entityLabel}.`
        );
        err.statusCode = 403;
        err.code = 'DATA_SCOPE_VIOLATION';
        err.error = 'PERMISSION_DENIED';
        throw err;
      }
    };

    return {
      moduleId,
      userId,
      membershipId,
      dataScope,
      departmentScopeId,
      departmentMatches,
      projectScopeId,
      projectMatches,
      costCenterScopeId,
      costCenterMatches,
      approvalLimitCentavos: modRes?.approvalLimitCentavos ?? resolved.defaultApprovalLimitCentavos,
      isCompanyWide,
      matchesRecord,
      assertRecordAccess
    };
  }

  /**
   * Get explicit overrides for a company member.
   */
  static async getExplicitOverrides(companyUserId: string): Promise<PermissionOverride[]> {
    const records = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.companyUserId, companyUserId));

    return records.map(r => ({
      id: r.id,
      permissionCode: r.permissionCode,
      effect: r.effect as 'ALLOW' | 'DENY',
      reason: r.reason
    }));
  }

  /**
   * Set or update explicit permission override for a member.
   */
  static async setExplicitOverride(
    req: any,
    companyUserId: string,
    permissionCode: string,
    effect: 'ALLOW' | 'DENY',
    reason?: string
  ) {
    await this.assertActorCanModifyMember(req, companyUserId, `set permission override ${permissionCode}=${effect}`);

    const { normalizedRoles } = await this.getMemberRoles(companyUserId);
    if (effect === 'DENY' && (normalizedRoles as string[]).includes('Company Owner')) {
      throw new Error('OWNER_UNRESTRICTED_POLICY: Active Company Owner authority cannot be restricted by DENY permission overrides.');
    }

    if (effect === 'ALLOW') {
      const templates = await Promise.all(normalizedRoles.map(r => this.getActiveRoleTemplate(r)));
      const catEntry = CANONICAL_PERMISSION_CATALOG.find(p => p.code === permissionCode);
      const isHardDeniedForAll =
        !(normalizedRoles as string[]).includes('Company Owner') && (
          templates.every(t => (t.hardDeniedPermissionCodes || []).includes(permissionCode)) ||
          (catEntry && normalizedRoles.every(r => (catEntry.hardRestrictedRoles as string[]).includes(r)))
        );
      if (isHardDeniedForAll) {
        throw new Error(`Security Restriction: Permission '${permissionCode}' is hard-restricted for [${normalizedRoles.join(' + ')}] and cannot be granted via user override.`);
      }
    }

    const existing = await db
      .select()
      .from(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.companyUserId, companyUserId),
          eq(userPermissionOverrides.permissionCode, permissionCode)
        )
      )
      .get();

    if (existing) {
      await db
        .update(userPermissionOverrides)
        .set({ effect, reason: reason || null })
        .where(eq(userPermissionOverrides.id, existing.id));
    } else {
      await db.insert(userPermissionOverrides).values({
        id: crypto.randomUUID(),
        companyUserId,
        permissionCode,
        effect,
        reason: reason || null
      });
    }

    const membership = await db.select().from(companyUsers).where(eq(companyUsers.id, companyUserId)).get();
    await AuditService.log({
      req,
      companyId: membership?.companyId,
      action: effect === 'ALLOW' ? "PERMISSION_GRANTED" : "PERMISSION_DENIED",
      entityType: "MEMBERSHIP",
      entityId: companyUserId,
      module: "RBAC",
      reason: reason || `Explicit ${effect} override on ${permissionCode}`,
      afterData: { permissionCode, effect, reason },
      metadata: { targetUserId: membership?.userId, permissionCode, effect }
    });

    return { message: `Explicit ${effect} override set for permission ${permissionCode}` };
  }

  /**
   * Remove explicit permission override.
   */
  static async removeExplicitOverride(req: any, companyUserId: string, permissionCode: string) {
    await this.assertActorCanModifyMember(req, companyUserId, `remove permission override ${permissionCode}`);

    await db
      .delete(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.companyUserId, companyUserId),
          eq(userPermissionOverrides.permissionCode, permissionCode)
        )
      );

    const membership = await db.select().from(companyUsers).where(eq(companyUsers.id, companyUserId)).get();
    await AuditService.log({
      req,
      companyId: membership?.companyId,
      action: "PERMISSION_OVERRIDE_REMOVED",
      entityType: "MEMBERSHIP",
      entityId: companyUserId,
      module: "RBAC",
      metadata: { targetUserId: membership?.userId, permissionCode }
    });

    return { message: `Explicit override removed for permission ${permissionCode}` };
  }
}
