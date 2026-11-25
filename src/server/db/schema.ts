import { sqliteTable, text, integer, real, unique } from 'drizzle-orm/sqlite-core';

// 1. COMPANIES
export const companies = sqliteTable('companies', {
  id: text('id').primaryKey(),
  legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'),
  tin: text('tin'),
  address: text('address'),
  branchCode: text('branch_code').default('00000'),
  contactPerson: text('contact_person'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  industry: text('industry'),
  fiscalYear: integer('fiscal_year').default(2026),
  fiscalYearStartMonth: integer('fiscal_year_start_month').default(1).notNull(), // 1 for January
  currency: text('currency').default('PHP').notNull(),
  timezone: text('timezone').default('Asia/Manila').notNull(),
  accountingMethod: text('accounting_method').default('ACCRUAL'), // ACCRUAL, CASH
  taxpayerClassification: text('taxpayer_classification'), // CORPORATION, INDIVIDUAL, PARTNERSHIP, COOPERATIVE, SINGLE_PROPRIETORSHIP
  taxpayerType: text('taxpayer_type'),
  vatStatus: text('vat_status'), // VAT, NON_VAT, EXEMPT
  rdoCode: text('rdo_code'),
  birRegistrationNo: text('bir_registration_no'),
  birDateRegistered: text('bir_date_registered'),
  documentLocationPath: text('document_location_path'),
  backupLocationPath: text('backup_location_path'),
  lockDate: text('lock_date'), // YYYY-MM-DD - Transactions on or before lockDate are strictly blocked
  status: text('status').default('ACTIVE').notNull(),
  classification: text('classification').default('DEVELOPMENT').notNull(), // DEVELOPMENT, TEST, STRESS_TEST, BENCHMARK, DISPOSABLE, PILOT, PRODUCTION
  isDemo: integer('is_demo', { mode: 'boolean' }).default(false),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 1.5 COMPANY LICENSES
export const companyLicenses = sqliteTable('company_licenses', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  licenseKey: text('license_key').notNull(),
  planType: text('plan_type').default('TRIAL').notNull(),
  status: text('status').default('ACTIVE').notNull(),
  trialStartDate: text('trial_start_date').notNull(),
  expirationDate: text('expiration_date').notNull(),
  deviceBindingHash: text('device_binding_hash'),
  signedFileContent: text('signed_file_content').notNull(),
  isLifetime: integer('is_lifetime', { mode: 'boolean' }).default(false).notNull(),
  seatCount: integer('seat_count').default(3),
  previousLicenseId: text('previous_license_id'),
  replacementReason: text('replacement_reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 2. USERS
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  theme: text('theme').default('light'),
  status: text('status').default('ACTIVE').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).default(false),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  failedLoginAttempts: integer('failed_login_attempts').default(0).notNull(),
  lockedUntil: integer('locked_until', { mode: 'timestamp' }),
  requirePasswordChange: integer('require_password_change', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 3. ROLES & PERMISSIONS
export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: integer('is_system', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const permissions = sqliteTable('permissions', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  description: text('description'),
  module: text('module'),
});

export const rolePermissions = sqliteTable('role_permissions', {
  id: text('id').primaryKey(),
  roleId: text('role_id').notNull().references(() => roles.id),
  permissionId: text('permission_id').notNull().references(() => permissions.id),
}, (table) => {
  return {
    unq: unique().on(table.roleId, table.permissionId),
  }
});

// 3.5 ROLE TEMPLATE VERSIONS (AUTHORITATIVE VERSIONED CATALOG)
export const roleTemplateVersions = sqliteTable('role_template_versions', {
  id: text('id').primaryKey(),
  roleCode: text('role_code').notNull(),
  roleName: text('role_name').notNull(),
  versionNumber: integer('version_number').notNull().default(1),
  isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
  isCustom: integer('is_custom', { mode: 'boolean' }).default(false).notNull(),
  clonedFrom: text('cloned_from'),
  status: text('status').default('PUBLISHED').notNull(), // 'PUBLISHED', 'DRAFT', 'ARCHIVED'
  purpose: text('purpose'),
  modulesJson: text('modules_json').notNull(), // JSON array of primary module IDs
  submodulesJson: text('submodules_json').notNull(), // JSON Record<string, string[]>
  permissionsJson: text('permissions_json').notNull(), // JSON string[]
  hardDeniedJson: text('hard_denied_json'), // JSON string[]
  dataScope: text('data_scope').default('COMPANY_WIDE').notNull(),
  approvalLimitCentavos: integer('approval_limit_centavos').default(0).notNull(),
  restrictionsJson: text('restrictions_json'), // JSON string[]
  changeReason: text('change_reason'),
  changedBy: text('changed_by'),
  changedByName: text('changed_by_name'),
  approvedBy: text('approved_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.roleName, table.versionNumber),
  }
});

// 3.6 ROLE COMPATIBILITY RULES (SEGREGATION OF DUTIES & MULTI-ROLE GOVERNANCE)
export const roleCompatibilityRules = sqliteTable('role_compatibility_rules', {
  id: text('id').primaryKey(),
  roleA: text('role_a').notNull(),
  roleB: text('role_b').notNull(),
  compatibilityType: text('compatibility_type').notNull(), // 'ALLOWED' | 'RESTRICTED' | 'PROHIBITED'
  reason: text('reason').notNull(),
  conditionsJson: text('conditions_json'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.roleA, table.roleB),
  }
});

// 4. COMPANY USERS (RBAC)
export const companyUsers = sqliteTable('company_users', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  userId: text('user_id').notNull().references(() => users.id),
  roleId: text('role_id').references(() => roles.id),
  legacyRole: text('legacy_role'), // In case we want simple roles before full RBAC
  roleTemplateVersion: integer('role_template_version').default(1),
  defaultDataScope: text('default_data_scope'),
  approvalLimitCentavos: integer('approval_limit_centavos'),
  status: text('status').default('ACTIVE').notNull(),
  membershipStatus: text('membership_status').default('ACTIVE').notNull(), // 'ACTIVE', 'SUSPENDED', 'REMOVED'
  removedAt: integer('removed_at', { mode: 'timestamp' }),
  removedBy: text('removed_by'),
  removalReason: text('removal_reason'),
  isDemo: integer('is_demo', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyId, table.userId),
  }
});

// 4.1 MULTI-ROLE ASSIGNMENTS
export const companyUserRoles = sqliteTable('company_user_roles', {
  id: text('id').primaryKey(),
  companyUserId: text('company_user_id').notNull().references(() => companyUsers.id),
  roleId: text('role_id').notNull().references(() => roles.id),
  roleCode: text('role_code'),
  roleTemplateVersion: integer('role_template_version').default(1),
  isPrimary: integer('is_primary', { mode: 'boolean' }).default(false).notNull(),
  assignmentStatus: text('assignment_status').default('ACTIVE').notNull(), // 'ACTIVE', 'REVOKED', 'EXPIRED'
  assignedBy: text('assigned_by'),
  assignedAt: integer('assigned_at', { mode: 'timestamp' }).notNull().defaultNow(),
  effectiveFrom: text('effective_from'),
  effectiveTo: text('effective_to'),
  assignmentReason: text('assignment_reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyUserId, table.roleId),
  }
});

// 4.2 EXPLICIT PERMISSION OVERRIDES (EXPLICIT ALLOW/DENY)
export const userPermissionOverrides = sqliteTable('user_permission_overrides', {
  id: text('id').primaryKey(),
  companyUserId: text('company_user_id').notNull().references(() => companyUsers.id),
  permissionCode: text('permission_code').notNull(),
  effect: text('effect').notNull(), // 'ALLOW' or 'DENY'
  reason: text('reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyUserId, table.permissionCode),
  }
});

// 4.2.1 EXPLICIT USER MODULE ASSIGNMENTS (PHASE 4)
export const userModuleAssignments = sqliteTable('user_module_assignments', {
  id: text('id').primaryKey(),
  companyUserId: text('company_user_id').notNull().references(() => companyUsers.id),
  moduleId: text('module_id').notNull(), // Primary module ID (e.g. 'sales', 'procurement', 'tax')
  submoduleIds: text('submodule_ids'), // JSON stringified array of allowed submodule IDs
  actions: text('actions'), // JSON array of allowed action codes
  dataScope: text('data_scope').default('COMPANY_WIDE'), // COMPANY_WIDE, DEPARTMENT, PROJECT, COST_CENTER, OWN_RECORDS, ASSIGNED_RECORDS, EXPLICIT_RECORDS
  departmentScopeId: text('department_scope_id'),
  projectScopeId: text('project_scope_id'),
  costCenterScopeId: text('cost_center_scope_id'),
  approvalLimitCentavos: integer('approval_limit_centavos').default(0),
  origin: text('origin').default('INHERITED_FROM_ROLE'), // INHERITED_FROM_ROLE, USER_SPECIFIC_GRANT, USER_SPECIFIC_DENY
  effect: text('effect').default('ALLOW'), // ALLOW, DENY
  templateVersion: integer('template_version').default(1),
  effectiveFrom: text('effective_from'),
  effectiveTo: text('effective_to'),
  reason: text('reason'),
  assignedBy: text('assigned_by'),
  assignedByName: text('assigned_by_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyUserId, table.moduleId),
  }
});

export const userModuleAssignmentHistory = sqliteTable('user_module_assignment_history', {
  id: text('id').primaryKey(),
  companyUserId: text('company_user_id').notNull().references(() => companyUsers.id),
  moduleId: text('module_id').notNull(),
  actionType: text('action_type').notNull(), // ASSIGN, UNASSIGN, UPDATE, ROLE_RESET, TEMPLATE_SYNC
  previousAssignment: text('previous_assignment'), // JSON
  newAssignment: text('new_assignment'), // JSON
  reason: text('reason'),
  changedBy: text('changed_by').notNull(),
  changedByName: text('changed_by_name'),
  changedAt: integer('changed_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 4.3 SEGREGATION OF DUTIES (SOD) RESTRICTIONS
export const sodRestrictions = sqliteTable('sod_restrictions', {
  id: text('id').primaryKey(),
  ruleCode: text('rule_code').notNull().unique(),
  ruleName: text('rule_name').notNull(),
  description: text('description'),
  incompatibleRole1: text('incompatible_role_1').notNull(),
  incompatibleRole2: text('incompatible_role_2').notNull(),
  restrictedPermissions: text('restricted_permissions'), // JSON stringified array of permission codes
  status: text('status').default('ACTIVE').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 5. PHILIPPINE TAX PROFILE
export const companyTaxProfiles = sqliteTable('company_tax_profiles', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  taxpayerClassification: text('taxpayer_classification'),
  vatStatus: text('vat_status'),
  taxTypes: text('tax_types'), // JSON array of tax types
  tin: text('tin'),
  rdo: text('rdo'),
  accountingPeriod: text('accounting_period'), // CALENDAR, FISCAL
  filingFrequency: text('filing_frequency'),
  registrationInformation: text('registration_information'), // JSON
  status: text('status').default('ACTIVE').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 6 & 7. VERSIONED TAX RULE ARCHITECTURE (DEFINITIONS & VERSIONS)
export const taxRuleDefinitions = sqliteTable('tax_rule_definitions', {
  id: text('id').primaryKey(),
  ruleCode: text('rule_code').notNull().unique(),
  ruleName: text('rule_name').notNull(),
  taxType: text('tax_type').notNull(),
  description: text('description'),
  taxpayerScope: text('taxpayer_scope'), // JSON
  status: text('status').default('ACTIVE').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const taxRuleVersions = sqliteTable('tax_rule_versions', {
  id: text('id').primaryKey(),
  ruleDefinitionId: text('rule_definition_id').notNull().references(() => taxRuleDefinitions.id),
  version: integer('version').notNull(),
  effectiveFrom: text('effective_from').notNull(), // ISO Date YYYY-MM-DD
  effectiveTo: text('effective_to'), // ISO Date YYYY-MM-DD
  calculationMethod: text('calculation_method').notNull(),
  rateValue: real('rate_value'),
  ruleConfiguration: text('rule_configuration'), // JSON
  taxpayerScope: text('taxpayer_scope'), // JSON
  sourceReference: text('source_reference'),
  sourceTitle: text('source_title'),
  sourceType: text('source_type'),
  sourceDate: text('source_date'), // ISO Date
  notes: text('notes'),
  status: text('status').default('ACTIVE').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.ruleDefinitionId, table.version),
  }
});

// 8. CHART OF ACCOUNTS
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  accountCode: text('account_code').notNull(),
  accountName: text('account_name').notNull(),
  accountType: text('account_type').notNull(), // ASSET, RECEIVABLE, OTHER_CURRENT_ASSET, INVENTORY, FIXED_ASSET, PAYABLE, OTHER_CURRENT_LIABILITY, LONG_TERM_LIABILITY, EQUITY, REVENUE, COST_OF_SALES, EXPENSE, OTHER_EXPENSE
  detailType: text('detail_type'), // e.g. CHECKING, SAVINGS, INPUT_VAT, EWT_PAYABLE, etc.
  parentAccountId: text('parent_account_id'), // Self reference
  normalBalance: text('normal_balance').notNull(), // DEBIT, CREDIT
  description: text('description'),
  isSubAccount: integer('is_sub_account', { mode: 'boolean' }).default(false).notNull(),
  birTaxCategory: text('bir_tax_category'), // e.g. OUTPUT_VAT_12, INPUT_VAT_12, EWT_1601EQ, etc.
  openingBalance: real('opening_balance').default(0),
  asOfDate: text('as_of_date'), // YYYY-MM-DD
  currency: text('currency').default('PHP').notNull(),
  isControlAccount: integer('is_control_account', { mode: 'boolean' }).default(false).notNull(),
  isCashAccount: integer('is_cash_account', { mode: 'boolean' }).default(false).notNull(),
  isTaxAccount: integer('is_tax_account', { mode: 'boolean' }).default(false).notNull(),
  isRetainedEarnings: integer('is_retained_earnings', { mode: 'boolean' }).default(false).notNull(),
  status: text('status').default('ACTIVE').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).default(false),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyId, table.accountCode),
  }
});

// 9. ACCOUNTING PERIODS
export const accountingPeriods = sqliteTable('accounting_periods', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  startDate: text('start_date').notNull(), // YYYY-MM-DD
  endDate: text('end_date').notNull(), // YYYY-MM-DD
  fiscalYear: integer('fiscal_year').notNull(),
  status: text('status').default('OPEN').notNull(), // OPEN, SOFT_CLOSED, HARD_CLOSED, LOCKED
  softClosedAt: integer('soft_closed_at', { mode: 'timestamp' }),
  softClosedBy: text('soft_closed_by').references(() => users.id),
  hardClosedAt: integer('hard_closed_at', { mode: 'timestamp' }),
  hardClosedBy: text('hard_closed_by').references(() => users.id),
  reopenedAt: integer('reopened_at', { mode: 'timestamp' }),
  reopenedBy: text('reopened_by').references(() => users.id),
  reopenReason: text('reopen_reason'),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
  closedBy: text('closed_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 9.1 PERIOD STATUS HISTORY
export const periodStatusHistory = sqliteTable('period_status_history', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  accountingPeriodId: text('accounting_period_id').notNull().references(() => accountingPeriods.id),
  action: text('action').notNull(), // CREATE, SOFT_CLOSE, HARD_CLOSE, REOPEN, LOCK_DATE_UPDATE, YEAR_END_CLOSE
  previousStatus: text('previous_status'),
  newStatus: text('new_status').notNull(),
  reason: text('reason'),
  changedBy: text('changed_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 10. JOURNAL ENTRIES
export const journalEntries = sqliteTable('journal_entries', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  journalNumber: text('journal_number').notNull(),
  entryDate: text('entry_date').notNull(), // YYYY-MM-DD
  accountingPeriodId: text('accounting_period_id').references(() => accountingPeriods.id),
  description: text('description'),
  sourceType: text('source_type'),
  sourceId: text('source_id'),
  status: text('status').default('DRAFT').notNull(), // DRAFT, SUBMITTED, APPROVED, POSTED, REVERSED, VOIDED
  createdBy: text('created_by').notNull().references(() => users.id),
  submittedBy: text('submitted_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  postedBy: text('posted_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  postedAt: integer('posted_at', { mode: 'timestamp' }),
  reversedAt: integer('reversed_at', { mode: 'timestamp' }),
  rejectionReason: text('rejection_reason'),
  originalJournalId: text('original_journal_id'),
  version: integer('version').default(1).notNull(),
});

// 11. JOURNAL LINES
export const journalLines = sqliteTable('journal_lines', {
  id: text('id').primaryKey(),
  journalEntryId: text('journal_entry_id').notNull().references(() => journalEntries.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  description: text('description'),
  debit: integer('debit').notNull().default(0),  // Storing as centavos/integers
  credit: integer('credit').notNull().default(0), // Storing as centavos/integers
  lineNumber: integer('line_number').notNull(),
  departmentId: text('department_id').references(() => departments.id),
  projectId: text('project_id').references(() => projects.id),
  costCenterId: text('cost_center_id').references(() => costCenters.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 12. AUDIT LOGS
export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  companyId: text('company_id').references(() => companies.id), // Nullable for system-wide actions
  userId: text('user_id').references(() => users.id),
  userEmail: text('user_email'),
  userDisplayName: text('user_display_name'),
  role: text('role'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  entityName: text('entity_name'),
  recordReference: text('record_reference'),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().defaultNow(),
  beforeData: text('before_data'), // JSON
  afterData: text('after_data'), // JSON
  changedFields: text('changed_fields'), // JSON or text
  reason: text('reason'),
  result: text('result').default('SUCCESS').notNull(), // SUCCESS, FAILED, WARNING
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  source: text('source').default('WEB_UI').notNull(), // WEB_UI, LOCAL_SERVER, IMPORT, API, AI_ASSISTANT, RESTORE, SYSTEM, SCHEDULED_JOB
  module: text('module'),
  severity: text('severity').default('INFO').notNull(), // INFO, WARN, ERROR, CRITICAL
  metadata: text('metadata'), // JSON
});

// 13. DOCUMENTS (Source Evidence)
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  entityType: text('entity_type').notNull(), // JOURNAL_ENTRY, EXPENSE, SALES_INVOICE, PURCHASE_BILL, GENERAL, etc.
  entityId: text('entity_id').notNull(),
  documentType: text('document_type').default('GENERAL_ATTACHMENT').notNull(), // RECEIPT, SALES_INVOICE, PURCHASE_INVOICE, OFFICIAL_RECEIPT, BILLING_STATEMENT, BANK_DOCUMENT, BIR_DOCUMENT, TAX_FORM, CONTRACT, GENERAL_ATTACHMENT
  fileName: text('file_name').notNull(),
  originalFileName: text('original_file_name'),
  fileType: text('file_type').notNull(), // Mime type e.g. application/pdf, image/jpeg, image/png
  fileSize: integer('file_size').default(0).notNull(), // in bytes
  fileHash: text('file_hash'), // SHA-256 checksum for deduplication and tamper prevention
  filePath: text('file_path').notNull(), // Company document storage path
  source: text('source').default('WEB_UI').notNull(), // WEB_UI, CAMERA_SCAN, MOBILE_SCAN, API, IMPORT, AI_ASSISTANT
  linkedTransactionType: text('linked_transaction_type'), // PURCHASE_BILL, SALES_INVOICE, JOURNAL_ENTRY, CASH_TRANSACTION, EXPENSE, TAX_FILING, BANK_DEPOSIT
  linkedTransactionId: text('linked_transaction_id'),
  linkedVendorId: text('linked_vendor_id').references(() => vendors.id),
  linkedCustomerId: text('linked_customer_id').references(() => customers.id),
  uploadedBy: text('uploaded_by').notNull().references(() => users.id),
  status: text('status').default('ACTIVE').notNull(), // ACTIVE, ARCHIVED, DELETED
  encryptionStatus: text('encryption_status').default('ENCRYPTED_AES256_GCM'), // ENCRYPTED_AES256_GCM, PLAINTEXT_LEGACY, QUARANTINED
  storageTier: text('storage_tier').default('ORIGINALS'), // ORIGINALS, THUMBNAILS, PREVIEWS, PROCESSED, QUARANTINE
  quarantineReason: text('quarantine_reason'),
  ocrStatus: text('ocr_status').default('PENDING'), // PENDING, PROCESSING, COMPLETED, FAILED, APPROVED, REJECTED
  verificationStatus: text('verification_status').default('UNVERIFIED').notNull(), // UNVERIFIED, VERIFIED, REJECTED, POSTED_TO_ACCOUNTING
  confidenceScore: real('confidence_score'),
  ocrResult: text('ocr_result'), // JSON stringified structured extraction
  extractedMerchant: text('extracted_merchant'),
  extractedCustomer: text('extracted_customer'),
  extractedTin: text('extracted_tin'),
  extractedAddress: text('extracted_address'),
  extractedInvoiceNumber: text('extracted_invoice_number'),
  extractedDate: text('extracted_date'),
  extractedTotalAmount: integer('extracted_total_amount'), // centavos
  extractedVatAmount: integer('extracted_vat_amount'), // centavos
  extractedVatableSales: integer('extracted_vatable_sales'), // centavos
  extractedVatExemptSales: integer('extracted_vat_exempt_sales'), // centavos
  extractedZeroRatedSales: integer('extracted_zero_rated_sales'), // centavos
  extractedWithholdingTax: integer('extracted_withholding_tax'), // centavos
  extractedPaymentMethod: text('extracted_payment_method'),
  extractedCategory: text('extracted_category'),
  extractionEngine: text('extraction_engine'), // TESSERACT_WASM, AI_GEMINI, HEURISTIC_FALLBACK
  pageCount: integer('page_count').default(1),
  validationErrors: text('validation_errors'), // JSON array of string errors
  validationWarnings: text('validation_warnings'), // JSON array of string warnings
  notes: text('notes'),
  verifiedBy: text('verified_by').references(() => users.id),
  verifiedAt: integer('verified_at', { mode: 'timestamp' }),
  isDemo: integer('is_demo', { mode: 'boolean' }).default(false),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 14. VENDORS (Suppliers)
export const vendors = sqliteTable('vendors', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'),
  tin: text('tin'),
  address: text('address'),
  contactPerson: text('contact_person'),
  contactDetails: text('contact_details'),
  paymentTerms: text('payment_terms'),
  taxClassification: text('tax_classification'),
  vatStatus: text('vat_status'),
  withholdingApplicability: text('withholding_applicability'),
  defaultPayableAccountId: text('default_payable_account_id').references(() => accounts.id),
  defaultExpenseAccountId: text('default_expense_account_id').references(() => accounts.id),
  notes: text('notes'),
  status: text('status').default('ACTIVE').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).default(false),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyId, table.code),
  }
});

// 15. CUSTOMERS
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'),
  tin: text('tin'),
  address: text('address'),
  billingAddress: text('billing_address'),
  shippingAddress: text('shipping_address'),
  contactPerson: text('contact_person'),
  contactDetails: text('contact_details'),
  paymentTerms: text('payment_terms'),
  creditLimit: integer('credit_limit'),
  taxClassification: text('tax_classification'),
  vatStatus: text('vat_status'),
  withholdingApplicability: text('withholding_applicability'),
  defaultReceivableAccountId: text('default_receivable_account_id').references(() => accounts.id),
  defaultRevenueAccountId: text('default_revenue_account_id').references(() => accounts.id),
  notes: text('notes'),
  status: text('status').default('ACTIVE').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).default(false),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyId, table.code),
  }
});

// 16. TAX CODES
export const taxCodes = sqliteTable('tax_codes', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  taxType: text('tax_type').notNull(),
  description: text('description'),
  applicability: text('applicability'), // JSON
  inputOutputDirection: text('input_output_direction'), // INPUT, OUTPUT
  accountId: text('account_id').references(() => accounts.id),
  ruleDefinitionId: text('rule_definition_id').references(() => taxRuleDefinitions.id),
  status: text('status').default('ACTIVE').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyId, table.code),
  }
});

// 16.1 BANKS
export const banks = sqliteTable('banks', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  bankName: text('bank_name').notNull(),
  branch: text('branch'),
  accountNumber: text('account_number'),
  accountType: text('account_type'), // SAVINGS, CHECKING, TIME_DEPOSIT, ETC
  currency: text('currency').default('PHP').notNull(),
  glAccountId: text('gl_account_id').references(() => accounts.id),
  status: text('status').default('ACTIVE').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyId, table.code),
  }
});

// 16.2 DEPARTMENTS
export const departments = sqliteTable('departments', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  managerName: text('manager_name'),
  status: text('status').default('ACTIVE').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyId, table.code),
  }
});

// 16.3 PROJECTS
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  clientCustomerId: text('client_customer_id').references(() => customers.id),
  budgetAmount: integer('budget_amount'), // centavos
  startDate: text('start_date'),
  endDate: text('end_date'),
  status: text('status').default('ACTIVE').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyId, table.code),
  }
});

// 16.4 COST CENTERS
export const costCenters = sqliteTable('cost_centers', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  departmentId: text('department_id').references(() => departments.id),
  status: text('status').default('ACTIVE').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyId, table.code),
  }
});

// 16.5 LOCATIONS / BRANCHES
export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  address: text('address'),
  isMainBranch: integer('is_main_branch', { mode: 'boolean' }).default(false).notNull(),
  status: text('status').default('ACTIVE').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyId, table.code),
  }
});

// 16.6 PAYMENT METHODS
export const paymentMethods = sqliteTable('payment_methods', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  type: text('type').default('CASH').notNull(), // CASH, CHECK, BANK_TRANSFER, E_WALLET, CREDIT_CARD
  defaultAccountId: text('default_account_id').references(() => accounts.id),
  status: text('status').default('ACTIVE').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
}, (table) => {
  return {
    unq: unique().on(table.companyId, table.code),
  }
});

// 17. TAX CALCULATIONS (Result persistence)
export const taxCalculations = sqliteTable('tax_calculations', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  journalEntryId: text('journal_entry_id').notNull().references(() => journalEntries.id),
  journalLineId: text('journal_line_id').references(() => journalLines.id),
  taxCodeId: text('tax_code_id').notNull().references(() => taxCodes.id),
  ruleVersionId: text('rule_version_id').notNull().references(() => taxRuleVersions.id),
  taxBase: integer('tax_base').notNull(), // centavos
  taxRate: real('tax_rate').notNull(), // e.g. 0.12 for 12%
  taxAmount: integer('tax_amount').notNull(), // centavos
  status: text('status').default('ACTIVE').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 17.1 TAX FILINGS & COMPLIANCE PERIODS
export const taxFilings = sqliteTable('tax_filings', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  taxType: text('tax_type').notNull(), // VAT, EWT, CWT, PERCENTAGE_TAX
  periodName: text('period_name').notNull(), // e.g. '2026-07' or '2026-Q2'
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  deadlineDate: text('deadline_date').notNull(),
  status: text('status').default('DRAFT').notNull(), // DRAFT, PREPARED, REVIEWED, FILED, LOCKED
  totalTaxBase: integer('total_tax_base').default(0).notNull(),
  totalTaxDue: integer('total_tax_due').default(0).notNull(),
  netTaxPayable: integer('net_tax_payable').default(0).notNull(),
  filedAt: integer('filed_at', { mode: 'timestamp' }),
  filedBy: text('filed_by').references(() => users.id),
  lockedAt: integer('locked_at', { mode: 'timestamp' }),
  lockedBy: text('locked_by').references(() => users.id),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 17.2 TAX FILING PREPARATION CHECKLIST
export const taxFilingChecklists = sqliteTable('tax_filing_checklists', {
  id: text('id').primaryKey(),
  taxFilingId: text('tax_filing_id').notNull().references(() => taxFilings.id),
  taskName: text('task_name').notNull(),
  description: text('description'),
  isCompleted: integer('is_completed', { mode: 'boolean' }).default(false).notNull(),
  completedBy: text('completed_by').references(() => users.id),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

// 17.3 TAX MANUAL ADJUSTMENTS
export const taxManualAdjustments = sqliteTable('tax_manual_adjustments', {
  id: text('id').primaryKey(),
  taxFilingId: text('tax_filing_id').notNull().references(() => taxFilings.id),
  companyId: text('company_id').notNull().references(() => companies.id),
  adjustmentType: text('adjustment_type').notNull(), // ADDITION, DEDUCTION, TAX_CREDIT_MEMO, PRIOR_PERIOD_ADJUSTMENT
  amount: integer('amount').notNull(), // centavos
  reason: text('reason').notNull(),
  approvedBy: text('approved_by').references(() => users.id),
  status: text('status').default('PENDING').notNull(), // PENDING, APPROVED, REJECTED
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 17.4 TAX EXCEPTIONS
export const taxExceptions = sqliteTable('tax_exceptions', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  taxFilingId: text('tax_filing_id').references(() => taxFilings.id),
  exceptionType: text('exception_type').notNull(), // POST_FILING_CHANGE, GL_MISMATCH, UNTRACED_TAX, LOCKED_PERIOD_MODIFICATION
  description: text('description').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  severity: text('severity').default('WARNING').notNull(), // INFO, WARNING, CRITICAL
  status: text('status').default('OPEN').notNull(), // OPEN, RESOLVED, DISMISSED
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 17.5 TAX CALENDAR
export const taxCalendar = sqliteTable('tax_calendar', {
  id: text('id').primaryKey(),
  companyId: text('company_id').references(() => companies.id), // Nullable for system-wide default tax calendar
  taxType: text('tax_type').notNull(), // VAT, EWT, CWT, PERCENTAGE_TAX, ITR
  formNumber: text('form_number').notNull(), // e.g. 'BIR Form 2550M', 'BIR Form 1601-EQ', 'BIR Form 1702'
  periodDescription: text('period_description').notNull(),
  deadlineDate: text('deadline_date').notNull(), // YYYY-MM-DD
  status: text('status').default('UPCOMING').notNull(), // UPCOMING, DUE_SOON, FILED, OVERDUE
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 18. SALES INVOICES
export const salesInvoices = sqliteTable('sales_invoices', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  customerId: text('customer_id').notNull().references(() => customers.id),
  invoiceNumber: text('invoice_number').notNull(),
  invoiceType: text('invoice_type').default('SALES').notNull(), // SALES, SERVICE
  invoiceDate: text('invoice_date').notNull(),
  dueDate: text('due_date'),
  reference: text('reference'),
  totalAmount: integer('total_amount').notNull(), // centavos
  balanceDue: integer('balance_due').notNull(), // centavos
  status: text('status').default('DRAFT').notNull(), // DRAFT, SUBMITTED, APPROVED, POSTED, PARTIAL, PAID, VOID
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  createdBy: text('created_by').references(() => users.id),
  submittedBy: text('submitted_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 19. PURCHASE BILLS
export const purchaseBills = sqliteTable('purchase_bills', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  vendorId: text('vendor_id').notNull().references(() => vendors.id),
  billNumber: text('bill_number').notNull(),
  billDate: text('bill_date').notNull(),
  dueDate: text('due_date'),
  reference: text('reference'),
  notes: text('notes'),
  attachmentUrl: text('attachment_url'),
  totalAmount: integer('total_amount').notNull(), // centavos
  balanceDue: integer('balance_due').notNull(), // centavos
  status: text('status').default('DRAFT').notNull(), // DRAFT, SUBMITTED, APPROVED, POSTED, PARTIAL, PAID, VOID
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  createdBy: text('created_by').references(() => users.id),
  submittedBy: text('submitted_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});
// 20. SALES INVOICE LINES
export const salesInvoiceLines = sqliteTable('sales_invoice_lines', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').notNull().references(() => salesInvoices.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  taxCodeId: text('tax_code_id').references(() => taxCodes.id),
  description: text('description'),
  quantity: real('quantity').notNull().default(1),
  unitPrice: integer('unit_price').notNull(), // centavos
  amount: integer('amount').notNull(), // centavos
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 21. PURCHASE BILL LINES
export const purchaseBillLines = sqliteTable('purchase_bill_lines', {
  id: text('id').primaryKey(),
  billId: text('bill_id').notNull().references(() => purchaseBills.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  taxCodeId: text('tax_code_id').references(() => taxCodes.id),
  description: text('description'),
  quantity: real('quantity').notNull().default(1),
  unitPrice: integer('unit_price').notNull(), // centavos
  amount: integer('amount').notNull(), // centavos
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 22. SUPPLIER PAYMENTS
export const supplierPayments = sqliteTable('supplier_payments', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  vendorId: text('vendor_id').notNull().references(() => vendors.id),
  paymentNumber: text('payment_number').notNull(),
  paymentDate: text('payment_date').notNull(),
  amount: integer('amount').notNull(), // centavos (net cash paid)
  cashAccountId: text('cash_account_id').notNull().references(() => accounts.id),
  withholdingTaxAmount: integer('withholding_tax_amount').default(0).notNull(), // EWT (BIR Form 2307)
  withholdingTaxAccountId: text('withholding_tax_account_id').references(() => accounts.id),
  overpaymentAmount: integer('overpayment_amount').default(0).notNull(), // unapplied excess as advance
  paymentMethod: text('payment_method').default('BANK_TRANSFER').notNull(), // CASH, CHECK, BANK_TRANSFER, ONLINE
  reference: text('reference'), // Check number, Voucher number, etc.
  notes: text('notes'),
  attachmentUrl: text('attachment_url'),
  status: text('status').default('DRAFT').notNull(), // DRAFT, SUBMITTED, APPROVED, POSTED, VOID
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  createdBy: text('created_by').references(() => users.id),
  submittedBy: text('submitted_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 23. SUPPLIER PAYMENT APPLICATIONS (linking payments to bills)
export const supplierPaymentApplications = sqliteTable('supplier_payment_applications', {
  id: text('id').primaryKey(),
  paymentId: text('payment_id').notNull().references(() => supplierPayments.id),
  billId: text('bill_id').notNull().references(() => purchaseBills.id),
  appliedAmount: integer('applied_amount').notNull(), // centavos
  withholdingAmount: integer('withholding_amount').default(0).notNull(), // centavos (EWT)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 23a. CUSTOMER PAYMENTS (Collections & Official Receipts)
export const customerPayments = sqliteTable('customer_payments', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  customerId: text('customer_id').notNull().references(() => customers.id),
  paymentNumber: text('payment_number').notNull(),
  officialReceiptNumber: text('official_receipt_number'), // BIR Official Receipt (OR) Number
  paymentDate: text('payment_date').notNull(),
  cashAccountId: text('cash_account_id').notNull().references(() => accounts.id),
  amount: integer('amount').notNull(), // centavos (net cash received)
  withholdingTaxAmount: integer('withholding_tax_amount').default(0).notNull(), // CWT (BIR Form 2307)
  withholdingTaxAccountId: text('withholding_tax_account_id').references(() => accounts.id),
  overpaymentAmount: integer('overpayment_amount').default(0).notNull(), // unapplied excess as advance
  paymentMethod: text('payment_method').default('BANK_TRANSFER').notNull(), // CASH, CHECK, BANK_TRANSFER, ONLINE
  reference: text('reference'), // Check No, Deposit Ref
  notes: text('notes'),
  status: text('status').default('DRAFT').notNull(), // DRAFT, SUBMITTED, APPROVED, POSTED, VOID
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  createdBy: text('created_by').references(() => users.id),
  submittedBy: text('submitted_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 23b. CUSTOMER PAYMENT APPLICATIONS (linking payments to sales invoices)
export const customerPaymentApplications = sqliteTable('customer_payment_applications', {
  id: text('id').primaryKey(),
  paymentId: text('payment_id').notNull().references(() => customerPayments.id),
  invoiceId: text('invoice_id').notNull().references(() => salesInvoices.id),
  appliedAmount: integer('applied_amount').notNull(), // centavos
  withholdingAmount: integer('withholding_amount').default(0).notNull(), // centavos
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 23c. CREDIT MEMOS
export const creditMemos = sqliteTable('credit_memos', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  customerId: text('customer_id').notNull().references(() => customers.id),
  creditMemoNumber: text('credit_memo_number').notNull(),
  memoDate: text('memo_date').notNull(),
  reason: text('reason'),
  totalAmount: integer('total_amount').notNull(), // centavos
  balanceRemaining: integer('balance_remaining').notNull(), // centavos
  status: text('status').default('DRAFT').notNull(), // DRAFT, SUBMITTED, APPROVED, POSTED, VOID
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  createdBy: text('created_by').references(() => users.id),
  submittedBy: text('submitted_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 23d. CREDIT MEMO LINES
export const creditMemoLines = sqliteTable('credit_memo_lines', {
  id: text('id').primaryKey(),
  creditMemoId: text('credit_memo_id').notNull().references(() => creditMemos.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  taxCodeId: text('tax_code_id').references(() => taxCodes.id),
  description: text('description'),
  quantity: real('quantity').default(1).notNull(),
  unitPrice: integer('unit_price').notNull(), // centavos
  amount: integer('amount').notNull(), // centavos
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 23e. CREDIT MEMO APPLICATIONS
export const creditMemoApplications = sqliteTable('credit_memo_applications', {
  id: text('id').primaryKey(),
  creditMemoId: text('credit_memo_id').notNull().references(() => creditMemos.id),
  invoiceId: text('invoice_id').notNull().references(() => salesInvoices.id),
  appliedAmount: integer('applied_amount').notNull(), // centavos
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 23f. DEBIT MEMOS (Supplier Adjustments & Returns)
export const debitMemos = sqliteTable('debit_memos', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  vendorId: text('vendor_id').notNull().references(() => vendors.id),
  debitMemoNumber: text('debit_memo_number').notNull(),
  memoDate: text('memo_date').notNull(),
  reason: text('reason'),
  totalAmount: integer('total_amount').notNull(), // centavos
  balanceRemaining: integer('balance_remaining').notNull(), // centavos
  attachmentUrl: text('attachment_url'),
  status: text('status').default('DRAFT').notNull(), // DRAFT, SUBMITTED, APPROVED, POSTED, VOID
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  createdBy: text('created_by').references(() => users.id),
  submittedBy: text('submitted_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const debitMemoLines = sqliteTable('debit_memo_lines', {
  id: text('id').primaryKey(),
  debitMemoId: text('debit_memo_id').notNull().references(() => debitMemos.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  taxCodeId: text('tax_code_id').references(() => taxCodes.id),
  description: text('description'),
  quantity: real('quantity').default(1).notNull(),
  unitPrice: integer('unit_price').notNull(), // centavos
  amount: integer('amount').notNull(), // centavos
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const debitMemoApplications = sqliteTable('debit_memo_applications', {
  id: text('id').primaryKey(),
  debitMemoId: text('debit_memo_id').notNull().references(() => debitMemos.id),
  billId: text('bill_id').notNull().references(() => purchaseBills.id),
  appliedAmount: integer('applied_amount').notNull(), // centavos
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 24. CASH TRANSACTIONS
export const cashTransactions = sqliteTable('cash_transactions', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  transactionNumber: text('transaction_number').notNull(),
  type: text('type').notNull(), // RECEIPT, DISBURSEMENT, TRANSFER, ADVANCE, LIQUIDATION, PETTY_CASH, BANK_FEE, INTEREST_INCOME
  transactionDate: text('transaction_date').notNull(),
  cashAccountId: text('cash_account_id').notNull().references(() => accounts.id),
  totalAmount: integer('total_amount').notNull(), // centavos
  reference: text('reference'), // Check No, OR No, etc.
  description: text('description'),
  attachmentUrl: text('attachment_url'),
  status: text('status').default('DRAFT').notNull(), // DRAFT, SUBMITTED, APPROVED, POSTED, VOID
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  createdBy: text('created_by').references(() => users.id),
  submittedBy: text('submitted_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 25. CASH TRANSACTION LINES
export const cashTransactionLines = sqliteTable('cash_transaction_lines', {
  id: text('id').primaryKey(),
  cashTransactionId: text('cash_transaction_id').notNull().references(() => cashTransactions.id),
  accountId: text('account_id').notNull().references(() => accounts.id),
  taxCodeId: text('tax_code_id').references(() => taxCodes.id),
  amount: integer('amount').notNull(), // centavos
  description: text('description'),
});

// 26. CASH ADVANCES
export const cashAdvances = sqliteTable('cash_advances', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeName: text('employee_name').notNull(),
  advanceDate: text('advance_date').notNull(),
  amount: integer('amount').notNull(), // centavos
  liquidatedAmount: integer('liquidated_amount').notNull().default(0),
  status: text('status').default('UNLIQUIDATED').notNull(), // UNLIQUIDATED, PARTIALLY_LIQUIDATED, LIQUIDATED
  disbursementTransactionId: text('disbursement_transaction_id').notNull().references(() => cashTransactions.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 26A. CHECKS (Check Register)
export const checks = sqliteTable('checks', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  checkNumber: text('check_number').notNull(),
  checkDate: text('check_date').notNull(),
  payeeName: text('payee_name').notNull(),
  cashAccountId: text('cash_account_id').notNull().references(() => accounts.id), // Bank Account
  amount: integer('amount').notNull(), // centavos
  voucherNumber: text('voucher_number'), // Reference voucher e.g. CD or SP number
  status: text('status').default('ISSUED').notNull(), // ISSUED, CLEARED, CANCELLED
  clearedDate: text('cleared_date'),
  cancellationReason: text('cancellation_reason'),
  cancellationJournalEntryId: text('cancellation_journal_entry_id').references(() => journalEntries.id),
  attachmentUrl: text('attachment_url'),
  notes: text('notes'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 26B. BANK DEPOSITS
export const bankDeposits = sqliteTable('bank_deposits', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  depositNumber: text('deposit_number').notNull(),
  depositDate: text('deposit_date').notNull(),
  toBankAccountId: text('to_bank_account_id').notNull().references(() => accounts.id),
  fromCashAccountId: text('from_cash_account_id').notNull().references(() => accounts.id),
  totalAmount: integer('total_amount').notNull(), // centavos
  reference: text('reference'),
  notes: text('notes'),
  attachmentUrl: text('attachment_url'),
  status: text('status').default('DRAFT').notNull(), // DRAFT, SUBMITTED, APPROVED, POSTED, VOID
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  createdBy: text('created_by').references(() => users.id),
  submittedBy: text('submitted_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 26C. CASH COUNTS
export const cashCounts = sqliteTable('cash_counts', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  countNumber: text('count_number').notNull(),
  countDate: text('count_date').notNull(),
  cashAccountId: text('cash_account_id').notNull().references(() => accounts.id),
  custodianName: text('custodian_name').notNull(),
  bookBalance: integer('book_balance').notNull(), // centavos
  countedBalance: integer('counted_balance').notNull(), // centavos
  varianceAmount: integer('variance_amount').notNull(), // centavos (countedBalance - bookBalance)
  varianceAccountId: text('variance_account_id').references(() => accounts.id), // Cash Over/Short account
  notes: text('notes'),
  attachmentUrl: text('attachment_url'),
  status: text('status').default('DRAFT').notNull(), // DRAFT, SUBMITTED, APPROVED, POSTED
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  createdBy: text('created_by').references(() => users.id),
  submittedBy: text('submitted_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 26D. CASH COUNT DENOMINATIONS
export const cashCountDenominations = sqliteTable('cash_count_denominations', {
  id: text('id').primaryKey(),
  cashCountId: text('cash_count_id').notNull().references(() => cashCounts.id),
  denominationLabel: text('denomination_label').notNull(), // e.g. "1000", "500", "200", "100", "50", "20", "10", "5", "1", "0.25"
  unitValue: integer('unit_value').notNull(), // centavos
  countQuantity: integer('count_quantity').notNull(),
  totalAmount: integer('total_amount').notNull(), // centavos
});

// 27. NOTIFICATIONS (Real-time & persisted alerts)
export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  userId: text('user_id').references(() => users.id), // Nullable if for all users in company
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: text('type').notNull(), // DOCUMENT_UPLOAD, AUDIT_LOG, JOURNAL_CREATED, TAX_RETURN, SYSTEM
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  metadata: text('metadata'), // JSON string
  isRead: integer('is_read', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 28. BUDGETS (Monthly spending limits per category)
export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  periodMonth: text('period_month').notNull(), // e.g. '2026-08'
  category: text('category').notNull(), // e.g. 'Utilities & Tech', 'Salaries & Benefits', 'Rent & Facilities', 'Marketing & Sales', 'Cost of Goods Sold', 'Taxes & Compliance', 'Office Supplies', 'Travel & Transport'
  monthlyLimit: integer('monthly_limit').notNull(), // centavos
  notes: text('notes'),
  status: text('status').notNull().default('DRAFT'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 29. COMPANY BRANDING & PRINT CUSTOMIZATION
export const companyBranding = sqliteTable('company_branding', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id).unique(),
  logoUrl: text('logo_url'),
  brandColor: text('brand_color').default('#1e1b4b'), // Primary brand accent color (e.g. indigo)
  secondaryColor: text('secondary_color').default('#4f46e5'),
  headerTitle: text('header_title').default('Official Billing Statement & BIR Tax Invoice'),
  footerNote: text('footer_note').default('Thank you for your business! Payment terms: Net 30 days. Please issue checks to company legal name.'),
  companyAddress: text('company_address'),
  contactPhone: text('contact_phone'),
  contactEmail: text('contact_email'),
  website: text('website'),
  tinNumber: text('tin_number'),
  showLogo: integer('show_logo', { mode: 'boolean' }).default(true),
  showWatermark: integer('show_watermark', { mode: 'boolean' }).default(true),
  customTerms: text('custom_terms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});


// 30. AI EXECUTION LOGS & USAGE TRACKING
export const aiExecutionLogs = sqliteTable('ai_execution_logs', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  userId: text('user_id').notNull().references(() => users.id),
  userRole: text('user_role'),
  skillId: text('skill_id').notNull(),
  skillVersion: text('skill_version').default('v1').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').default(0).notNull(),
  outputTokens: integer('output_tokens').default(0).notNull(),
  latencyMs: integer('latency_ms').default(0).notNull(),
  status: text('status').notNull(),
  riskLevel: text('risk_level').default('READ_ONLY').notNull(),
  inputSummary: text('input_summary'),
  outputSummary: text('output_summary'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 31. BANK RECONCILIATIONS
export const bankReconciliations = sqliteTable('bank_reconciliations', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  bankAccountId: text('bank_account_id').notNull().references(() => accounts.id),
  statementDate: text('statement_date').notNull(), // e.g. '2026-08-31'
  statementEndingBalance: integer('statement_ending_balance').notNull(), // centavos
  bookEndingBalance: integer('book_ending_balance').default(0).notNull(), // centavos
  clearedDepositsCount: integer('cleared_deposits_count').default(0).notNull(),
  clearedDepositsAmount: integer('cleared_deposits_amount').default(0).notNull(), // centavos
  clearedChecksCount: integer('cleared_checks_count').default(0).notNull(),
  clearedChecksAmount: integer('cleared_checks_amount').default(0).notNull(), // centavos
  outstandingChecksCount: integer('outstanding_checks_count').default(0).notNull(),
  outstandingChecksAmount: integer('outstanding_checks_amount').default(0).notNull(), // centavos
  depositsInTransitCount: integer('deposits_in_transit_count').default(0).notNull(),
  depositsInTransitAmount: integer('deposits_in_transit_amount').default(0).notNull(), // centavos
  bankChargesAmount: integer('bank_charges_amount').default(0).notNull(), // centavos
  interestIncomeAmount: integer('interest_income_amount').default(0).notNull(), // centavos
  otherAdjustmentsAmount: integer('other_adjustments_amount').default(0).notNull(), // centavos
  adjustedBookBalance: integer('adjusted_book_balance').default(0).notNull(), // centavos
  adjustedStatementBalance: integer('adjusted_statement_balance').default(0).notNull(), // centavos
  unexplainedDifference: integer('unexplained_difference').default(0).notNull(), // centavos (must be 0 to approve)
  status: text('status').default('DRAFT').notNull(), // DRAFT, SUBMITTED, APPROVED, REOPENED
  reopenReason: text('reopen_reason'),
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  notes: text('notes'),
  attachmentUrl: text('attachment_url'),
  createdBy: text('created_by').references(() => users.id),
  submittedBy: text('submitted_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  reopenedBy: text('reopened_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const bankStatementLines = sqliteTable('bank_statement_lines', {
  id: text('id').primaryKey(),
  bankReconciliationId: text('bank_reconciliation_id').notNull().references(() => bankReconciliations.id),
  companyId: text('company_id').notNull().references(() => companies.id),
  bankAccountId: text('bank_account_id').notNull().references(() => accounts.id),
  lineDate: text('line_date').notNull(),
  description: text('description').notNull(),
  reference: text('reference'),
  type: text('type').notNull(), // DEPOSIT, WITHDRAWAL, CHECK, FEE, INTEREST
  amount: integer('amount').notNull(), // centavos
  matchedStatus: text('matched_status').default('UNMATCHED').notNull(), // UNMATCHED, MATCHED, EXCLUDED, ADJUSTMENT
  matchedType: text('matched_type'), // CHECK, BANK_DEPOSIT, CASH_TRANSACTION, JOURNAL_LINE, BANK_FEE, INTEREST, ADJUSTMENT
  matchedEntityId: text('matched_entity_id'),
  matchedAmount: integer('matched_amount').default(0).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const bankReconciliationAdjustments = sqliteTable('bank_reconciliation_adjustments', {
  id: text('id').primaryKey(),
  bankReconciliationId: text('bank_reconciliation_id').notNull().references(() => bankReconciliations.id),
  companyId: text('company_id').notNull().references(() => companies.id),
  type: text('type').notNull(), // BANK_CHARGE, INTEREST_INCOME, UNIDENTIFIED_DEPOSIT, OTHER_ADJUSTMENT
  amount: integer('amount').notNull(), // centavos
  offsetAccountId: text('offset_account_id').notNull().references(() => accounts.id),
  description: text('description').notNull(),
  reference: text('reference'),
  adjustmentDate: text('adjustment_date').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// SESSIONS
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 21. AUDIT ENGAGEMENTS & MANAGEMENT (PHASE 14)
export const auditEngagements = sqliteTable('audit_engagements', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id), // Firm or managing entity
  clientCompanyId: text('client_company_id').notNull().references(() => companies.id), // Audited client company
  engagementName: text('engagement_name').notNull(),
  auditPeriod: text('audit_period').notNull(), // e.g. 'FY 2025' or 'Q2 2026'
  engagementType: text('engagement_type').notNull(), // STATUTORY_AUDIT, TAX_COMPLIANCE, INTERNAL_AUDIT, SPECIAL_REVIEW
  status: text('status').default('PLANNING').notNull(), // PLANNING, FIELDWORK, REVIEW, PARTNER_SIGN_OFF, COMPLETED, ARCHIVED
  materiality: integer('materiality').default(0).notNull(), // centavos
  performanceMateriality: integer('performance_materiality').default(0).notNull(), // centavos
  trivialThreshold: integer('trivial_threshold').default(0).notNull(), // centavos
  teamMembers: text('team_members'), // JSON array of user IDs
  preparerId: text('preparer_id').references(() => users.id),
  reviewerId: text('reviewer_id').references(() => users.id),
  partnerId: text('partner_id').references(() => users.id),
  fieldworkDeadline: text('fieldwork_deadline'),
  signOffDeadline: text('sign_off_deadline'),
  reportDeadline: text('report_deadline'),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const auditEngagementItems = sqliteTable('audit_engagement_items', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id').notNull().references(() => auditEngagements.id),
  itemCategory: text('item_category').notNull(), // PBC, WORKING_PAPER, ADJUSTMENT, CONTROL_DEFICIENCY
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').default('OPEN').notNull(), // OPEN, IN_PROGRESS, CLEARED, REVIEWED
  assignedTo: text('assigned_to').references(() => users.id),
  dueDate: text('due_date'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const auditEngagementLogs = sqliteTable('audit_engagement_logs', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id').notNull().references(() => auditEngagements.id),
  userId: text('user_id').references(() => users.id),
  action: text('action').notNull(),
  details: text('details').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 22. AUDIT PLANNING & RISK ASSESSMENT (PHASE 15)
export const auditPlanningDocs = sqliteTable('audit_planning_docs', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id').notNull().references(() => auditEngagements.id),
  entityUnderstanding: text('entity_understanding'), // Understanding of the entity & environment
  businessProcesses: text('business_processes'), // Business-process documentation
  auditStrategy: text('audit_strategy'), // Overall audit strategy
  auditPlan: text('audit_plan'), // Detailed audit plan
  samplingPlan: text('sampling_plan'), // Sampling plan methodology
  materialityNotes: text('materiality_notes'),
  preparerId: text('preparer_id').references(() => users.id),
  reviewerId: text('reviewer_id').references(() => users.id),
  partnerId: text('partner_id').references(() => users.id),
  preparerSignedAt: integer('preparer_signed_at', { mode: 'timestamp' }),
  reviewerSignedAt: integer('reviewer_signed_at', { mode: 'timestamp' }),
  partnerSignedAt: integer('partner_signed_at', { mode: 'timestamp' }),
  status: text('status').default('DRAFT').notNull(), // DRAFT, PREPARED, REVIEWED, APPROVED
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const auditSignificantAccounts = sqliteTable('audit_significant_accounts', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id').notNull().references(() => auditEngagements.id),
  accountName: text('account_name').notNull(),
  accountBalance: integer('account_balance').default(0).notNull(), // centavos
  isSignificant: integer('is_significant', { mode: 'boolean' }).default(true).notNull(),
  assertions: text('assertions').notNull(), // JSON array e.g. ['EXISTENCE', 'COMPLETENESS', 'VALUATION']
  inherentRisk: text('inherent_risk').default('MEDIUM').notNull(), // LOW, MEDIUM, HIGH
  controlRisk: text('control_risk').default('MEDIUM').notNull(), // LOW, MEDIUM, HIGH
  fraudRisk: integer('fraud_risk', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const auditRisksAndProcedures = sqliteTable('audit_risks_and_procedures', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id').notNull().references(() => auditEngagements.id),
  riskDescription: text('risk_description').notNull(),
  riskType: text('risk_type').notNull(), // INHERENT, CONTROL, FRAUD, SIGNIFICANT
  assertionLinked: text('assertion_linked').notNull(),
  auditProcedure: text('audit_procedure').notNull(), // Risk-to-procedure mapping
  assignedTo: text('assigned_to').references(() => users.id),
  status: text('status').default('OPEN').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const auditPlanningVersions = sqliteTable('audit_planning_versions', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id').notNull().references(() => auditEngagements.id),
  versionNumber: integer('version_number').notNull(),
  snapshotJson: text('snapshot_json').notNull(), // Full planning doc + accounts snapshot
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 23. AUDIT WORKPAPERS (PHASE 16)
export const auditWorkpapers = sqliteTable('audit_workpapers', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id').notNull().references(() => auditEngagements.id),
  wpRef: text('wp_ref').notNull(), // e.g. A-1, B-2
  title: text('title').notNull(),
  objective: text('objective'),
  procedure: text('procedure'),
  population: text('population'),
  sample: text('sample'),
  evidenceLinks: text('evidence_links'), // JSON array of document/evidence IDs or URLs
  result: text('result'),
  exception: text('exception'),
  conclusion: text('conclusion'),
  preparerId: text('preparer_id').references(() => users.id),
  preparedDate: text('prepared_date'),
  reviewerId: text('reviewer_id').references(() => users.id),
  reviewDate: text('review_date'),
  reviewNotes: text('review_notes'),
  status: text('status').default('DRAFT').notNull(), // DRAFT, PREPARED, REVIEWED, LOCKED
  versionNumber: integer('version_number').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const auditWorkpaperVersions = sqliteTable('audit_workpaper_versions', {
  id: text('id').primaryKey(),
  workpaperId: text('workpaper_id').notNull().references(() => auditWorkpapers.id),
  versionNumber: integer('version_number').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 24. AUDIT FINDINGS & ADJUSTMENTS (PHASE 17)
export const auditFindings = sqliteTable('audit_findings', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id').notNull().references(() => auditEngagements.id),
  title: text('title').notNull(),
  riskRating: text('risk_rating').default('MEDIUM').notNull(), // LOW, MEDIUM, HIGH, CRITICAL
  criteria: text('criteria'),
  condition: text('condition'),
  cause: text('cause'),
  effect: text('effect'),
  recommendation: text('recommendation'),
  managementResponse: text('management_response'),
  ownerId: text('owner_id').references(() => users.id),
  targetDate: text('target_date'),
  status: text('status').default('OPEN').notNull(), // OPEN, IN_PROGRESS, RESOLVED, CLOSED
  evidenceIds: text('evidence_ids'), // JSON array
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const auditAdjustments = sqliteTable('audit_adjustments', {
  id: text('id').primaryKey(),
  engagementId: text('engagement_id').notNull().references(() => auditEngagements.id),
  adjustmentType: text('adjustment_type').default('PROPOSED').notNull(), // PROPOSED, PASSED, POSTED
  classification: text('classification').default('FSD').notNull(), // FSD (Difference), FSI
  affectedAccountsJson: text('affected_accounts_json').notNull(), // JSON array of accounts & amounts in centavos
  financialEffect: text('financial_effect'),
  managementResponse: text('management_response'),
  approvalStatus: text('approval_status').default('PENDING').notNull(), // PENDING, APPROVED, REJECTED
  approvedBy: text('approved_by').references(() => users.id),
  journalEntryId: text('journal_entry_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 25. INTERNAL CONTROL ENFORCEMENT & OVERRIDES (PHASE 18)
export const internalControlsLog = sqliteTable('internal_controls_log', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  actionType: text('action_type').notNull(), // e.g. JOURNAL_ENTRY, PERIOD_REOPEN, HIGH_VALUE_DISBURSEMENT
  requestedBy: text('requested_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  thresholdAmount: integer('threshold_amount'),
  overrideReason: text('override_reason'),
  status: text('status').default('PENDING').notNull(), // PENDING, APPROVED, REJECTED
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 26. FRAUD DETECTION (PHASE 19)
export const fraudFlags = sqliteTable('fraud_flags', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  ruleName: text('rule_name').notNull(), // e.g. DUPLICATE_PAYMENT, ROUND_NUMBER, WEEKEND_ENTRY, MANUAL_JE
  severity: text('severity').default('MEDIUM').notNull(), // LOW, MEDIUM, HIGH, CRITICAL
  entityType: text('entity_type').notNull(), // TRANSACTION, JOURNAL_ENTRY, INVOICE, SUPPLIER
  entityId: text('entity_id').notNull(),
  detailsJson: text('details_json').notNull(),
  status: text('status').default('FLAGGED').notNull(), // FLAGGED, INVESTIGATING, FALSE_POSITIVE, RESOLVED
  assignedTo: text('assigned_to').references(() => users.id),
  resolutionNotes: text('resolution_notes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 27. DOCUMENT AND EVIDENCE VAULT (PHASE 20)
export const companyDocuments = sqliteTable('company_documents', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  fileName: text('file_name').notNull(),
  fileCategory: text('file_category').default('GENERAL').notNull(), // GENERAL, TAX, BANK_STMT, WORKPAPER, INVOICE
  fileTags: text('file_tags'), // comma separated or JSON
  fileHash: text('file_hash').notNull(), // SHA-256 integrity hash
  fileSize: integer('file_size').default(0).notNull(),
  mimeType: text('mime_type'),
  fileUrl: text('file_url').notNull(),
  extractedText: text('extracted_text'), // OCR text
  isDeleted: integer('is_deleted', { mode: 'boolean' }).default(false).notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  retentionUntil: text('retention_until'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 28. BACKUP AND RESTORE (PHASE 21)
export const systemBackups = sqliteTable('system_backups', {
  id: text('id').primaryKey(),
  companyId: text('company_id').references(() => companies.id),
  backupName: text('backup_name').notNull(),
  checksum: text('checksum').notNull(),
  sizeBytes: integer('size_bytes').default(0).notNull(),
  passwordProtected: integer('password_protected', { mode: 'boolean' }).default(false).notNull(),
  payloadJson: text('payload_json').notNull(), // Encrypted or full JSON snapshot
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 29. LICENSE AUDIT LOGS & MULTI-USER LOCAL SERVER (PHASE 23 & 24)
export const licenseAuditLogs = sqliteTable('license_audit_logs', {
  id: text('id').primaryKey(),
  companyId: text('company_id').references(() => companies.id),
  action: text('action').notNull(), // ACTIVATED, REVOKED, RENEWED, TRANSFERRED, EXPIRED
  details: text('details').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const recordLocks = sqliteTable('record_locks', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  tableName: text('table_name').notNull(), // e.g. JOURNAL_ENTRIES, ACCOUNTS
  recordId: text('record_id').notNull(),
  lockedByUserId: text('locked_by_user_id').notNull().references(() => users.id),
  lockedAt: integer('locked_at', { mode: 'timestamp' }).notNull().defaultNow(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

export const lanServerSessions = sqliteTable('lan_server_sessions', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  userId: text('user_id').notNull().references(() => users.id),
  clientIp: text('client_ip').default('127.0.0.1').notNull(),
  lastActiveAt: integer('last_active_at', { mode: 'timestamp' }).notNull().defaultNow(),
  isMaintenanceMode: integer('is_maintenance_mode', { mode: 'boolean' }).default(false).notNull(),
});

export const approvalWorkflowRequests = sqliteTable('approval_workflow_requests', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  actionType: text('action_type').notNull(), // e.g. JOURNAL_ENTRY_POSTING, DISBURSEMENT
  amountPHP: integer('amount_php').default(0).notNull(),
  makerUserId: text('maker_user_id').notNull().references(() => users.id),
  checkerUserId: text('checker_user_id').references(() => users.id),
  status: text('status').default('PENDING').notNull(), // PENDING, APPROVED, REJECTED
  details: text('details').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});





export const authorityUsers = sqliteTable('authority_users', { id: text('id').primaryKey(), username: text('username').notNull().unique(), passwordHash: text('password_hash').notNull() });

// 32. FOREIGN CURRENCY & BSP SPOT RATES
export const currencyExchangeRates = sqliteTable('currency_exchange_rates', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  rateDate: text('rate_date').notNull(), // YYYY-MM-DD
  currency: text('currency').default('USD').notNull(),
  bspSpotRate: real('bsp_spot_rate').notNull(), // e.g. 56.50 PHP per 1 USD
  source: text('source').default('BSP').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 32.1 PERIOD-END UNREALIZED FX REVALUATION RUNS (PAS 21 / BIR RMC 12-2024)
export const fxRevaluationRuns = sqliteTable('fx_revaluation_runs', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  accountingPeriodId: text('accounting_period_id').references(() => accountingPeriods.id),
  revaluationDate: text('revaluation_date').notNull(), // YYYY-MM-DD
  baseCurrency: text('base_currency').default('PHP').notNull(),
  targetCurrency: text('target_currency').notNull(), // e.g. USD, EUR, JPY
  closingSpotRate: real('closing_spot_rate').notNull(),
  rateDate: text('rate_date').notNull(),
  rateSource: text('rate_source').default('BSP').notNull(),
  status: text('status').default('PREVIEW').notNull(), // PREVIEW, POSTED, AUTO_REVERSED, REVERSED, VOIDED
  totalCarryingPhpCentavos: integer('total_carrying_php_centavos').default(0).notNull(),
  totalRevaluedPhpCentavos: integer('total_revalued_php_centavos').default(0).notNull(),
  totalGainCentavos: integer('total_gain_centavos').default(0).notNull(),
  totalLossCentavos: integer('total_loss_centavos').default(0).notNull(),
  netGainLossCentavos: integer('net_gain_loss_centavos').default(0).notNull(),
  unrealizedJournalId: text('unrealized_journal_id').references(() => journalEntries.id),
  reversalJournalId: text('reversal_journal_id').references(() => journalEntries.id),
  autoReverseDate: text('auto_reverse_date'),
  detailsJson: text('details_json').notNull(),
  notes: text('notes'),
  createdBy: text('created_by').references(() => users.id),
  postedBy: text('posted_by').references(() => users.id),
  postedAt: integer('posted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 33. INVENTORY & COST OF GOODS SOLD (COGS)
export const inventoryItems = sqliteTable('inventory_items', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  unitOfMeasure: text('unit_of_measure').default('PCS').notNull(),
  costingMethod: text('costing_method').default('FIFO').notNull(), // FIFO, WEIGHTED_AVG
  unitCost: integer('unit_cost').default(0).notNull(), // centavos
  sellingPrice: integer('selling_price').default(0).notNull(), // centavos
  quantityOnHand: real('quantity_on_hand').default(0).notNull(),
  reorderPoint: real('reorder_point').default(10).notNull(),
  assetAccountId: text('asset_account_id').references(() => accounts.id),
  cogsAccountId: text('cogs_account_id').references(() => accounts.id),
  status: text('status').default('ACTIVE').notNull(),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const inventoryTransactions = sqliteTable('inventory_transactions', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  itemId: text('item_id').notNull().references(() => inventoryItems.id),
  transactionDate: text('transaction_date').notNull(),
  type: text('type').notNull(), // RECEIPT, SALE, ADJUSTMENT, WASTE, RETURN
  quantity: real('quantity').notNull(),
  unitCost: integer('unit_cost').notNull(), // centavos
  totalValue: integer('total_value').notNull(), // centavos
  reference: text('reference'),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const stockAdjustments = sqliteTable('stock_adjustments', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  adjustmentNumber: text('adjustment_number').notNull(),
  adjustmentDate: text('adjustment_date').notNull(),
  itemId: text('item_id').notNull().references(() => inventoryItems.id),
  quantityChange: real('quantity_change').notNull(), // positive for addition, negative for reduction/spoilage
  reason: text('reason').notNull(), // WASTE, DAMAGE, FREEBIE, INVENTORY_COUNT_CORRECTION
  expenseAccountId: text('expense_account_id').references(() => accounts.id),
  status: text('status').default('POSTED').notNull(),
  createdBy: text('created_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 34. PAYROLL & MANDATORY CONTRIBUTIONS
export const employees = sqliteTable('employees', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  employeeNo: text('employee_no').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email'),
  tin: text('tin'),
  sssNo: text('sss_no'),
  philhealthNo: text('philhealth_no'),
  pagibigNo: text('pagibig_no'),
  position: text('position'),
  department: text('department'),
  monthlyBasicSalary: integer('monthly_basic_salary').notNull(), // centavos
  dailyRate: integer('daily_rate').default(0).notNull(), // centavos
  hourlyRate: integer('hourly_rate').default(0).notNull(), // centavos
  customSssEE: integer('custom_sss_ee').default(0), // centavos (0 = auto)
  customSssER: integer('custom_sss_er').default(0), // centavos (0 = auto)
  customPhilhealthEE: integer('custom_philhealth_ee').default(0), // centavos (0 = auto)
  customPhilhealthER: integer('custom_philhealth_er').default(0), // centavos (0 = auto)
  customPagibigEE: integer('custom_pagibig_ee').default(0), // centavos (0 = auto)
  customPagibigER: integer('custom_pagibig_er').default(0), // centavos (0 = auto)
  customWithholdingTax: integer('custom_withholding_tax').default(0), // centavos (0 = auto)
  status: text('status').default('ACTIVE').notNull(),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const payrollRuns = sqliteTable('payroll_runs', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  payrollPeriod: text('payroll_period').notNull(), // e.g. '2026-08-A' or '2026-08'
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  paymentDate: text('payment_date').notNull(),
  totalGrossPay: integer('total_gross_pay').default(0).notNull(), // centavos
  totalSss: integer('total_sss').default(0).notNull(),
  totalPhilhealth: integer('total_philhealth').default(0).notNull(),
  totalPagibig: integer('total_pagibig').default(0).notNull(),
  totalWithholdingTax: integer('total_withholding_tax').default(0).notNull(),
  totalNetPay: integer('total_net_pay').default(0).notNull(), // centavos
  status: text('status').default('DRAFT').notNull(), // DRAFT, APPROVED, POSTED
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  createdBy: text('created_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const payrollItems = sqliteTable('payroll_items', {
  id: text('id').primaryKey(),
  payrollRunId: text('payroll_run_id').notNull().references(() => payrollRuns.id),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  basicPay: integer('basic_pay').notNull(), // centavos
  overtimePay: integer('overtime_pay').default(0).notNull(),
  holidayPay: integer('holiday_pay').default(0).notNull(),
  nightDiffPay: integer('night_diff_pay').default(0).notNull(),
  grossPay: integer('gross_pay').notNull(),
  sssEmployee: integer('sss_employee').default(0).notNull(),
  sssEmployer: integer('sss_employer').default(0).notNull(),
  philhealthEmployee: integer('philhealth_employee').default(0).notNull(),
  philhealthEmployer: integer('philhealth_employer').default(0).notNull(),
  pagibigEmployee: integer('pagibig_employee').default(0).notNull(),
  pagibigEmployer: integer('pagibig_employer').default(0).notNull(),
  withholdingTax: integer('withholding_tax').default(0).notNull(),
  totalDeductions: integer('total_deductions').notNull(),
  netPay: integer('net_pay').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 35. FIXED ASSETS & DEPRECIATION
export const fixedAssets = sqliteTable('fixed_assets', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  assetTag: text('asset_tag').notNull(),
  assetName: text('asset_name').notNull(),
  category: text('category').notNull(), // EQUIPMENT, VEHICLE, FURNITURE, IT_HARDWARE, BUILDING
  acquisitionDate: text('acquisition_date').notNull(),
  acquisitionCost: integer('acquisition_cost').notNull(), // centavos
  salvageValue: integer('salvage_value').default(0).notNull(), // centavos
  usefulLifeMonths: integer('useful_life_months').notNull(), // e.g. 60 months (5 yrs)
  depreciationMethod: text('depreciation_method').default('STRAIGHT_LINE').notNull(),
  assetAccountId: text('asset_account_id').references(() => accounts.id),
  accumulatedDepAccountId: text('accumulated_dep_account_id').references(() => accounts.id),
  depreciationExpenseAccountId: text('depreciation_expense_account_id').references(() => accounts.id),
  status: text('status').default('ACTIVE').notNull(), // ACTIVE, DISPOSED
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const depreciationSchedules = sqliteTable('depreciation_schedules', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull().references(() => fixedAssets.id),
  companyId: text('company_id').notNull().references(() => companies.id),
  periodMonth: text('period_month').notNull(), // YYYY-MM
  depreciationAmount: integer('depreciation_amount').notNull(), // centavos
  accumulatedDepreciation: integer('accumulated_depreciation').notNull(), // centavos
  bookValue: integer('book_value').notNull(), // centavos
  status: text('status').default('PENDING').notNull(), // PENDING, POSTED
  journalEntryId: text('journal_entry_id').references(() => journalEntries.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 36. PURCHASE REQUISITIONS, PURCHASE ORDERS & 3-WAY MATCHING (GRN)
export const purchaseRequisitions = sqliteTable('purchase_requisitions', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  prNumber: text('pr_number').notNull(),
  requestDate: text('request_date').notNull(),
  neededByDate: text('needed_by_date'),
  departmentId: text('department_id'),
  branchCode: text('branch_code').default('HQ-MNL').notNull(),
  requestedBy: text('requested_by').references(() => users.id),
  requestedByName: text('requested_by_name'),
  preferredVendorId: text('preferred_vendor_id').references(() => vendors.id),
  preferredVendorName: text('preferred_vendor_name'),
  purpose: text('purpose').notNull(),
  itemsJson: text('items_json').default('[]').notNull(),
  totalAmount: integer('total_amount').notNull(), // centavos
  status: text('status').default('DRAFT').notNull(), // DRAFT, SUBMITTED, APPROVED, RETURNED, REJECTED, CONVERTED_TO_PO, CANCELLED
  approvalWorkflowId: text('approval_workflow_id'),
  approvedBy: text('approved_by').references(() => users.id),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  convertedPoId: text('converted_po_id'),
  convertedPoNumber: text('converted_po_number'),
  convertedBy: text('converted_by').references(() => users.id),
  convertedAt: integer('converted_at', { mode: 'timestamp' }),
  notes: text('notes'),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const purchaseOrders = sqliteTable('purchase_orders', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  vendorId: text('vendor_id').notNull().references(() => vendors.id),
  poNumber: text('po_number').notNull(),
  poDate: text('po_date').notNull(),
  expectedDeliveryDate: text('expected_delivery_date'),
  totalAmount: integer('total_amount').notNull(), // centavos
  status: text('status').default('DRAFT').notNull(), // DRAFT, APPROVED, PARTIALLY_RECEIVED, FULLY_RECEIVED, CLOSED, CANCELLED
  createdBy: text('created_by').references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const purchaseOrderLines = sqliteTable('purchase_order_lines', {
  id: text('id').primaryKey(),
  poId: text('po_id').notNull().references(() => purchaseOrders.id),
  itemId: text('item_id').references(() => inventoryItems.id),
  description: text('description').notNull(),
  quantityOrdered: real('quantity_ordered').notNull(),
  quantityReceived: real('quantity_received').default(0).notNull(),
  unitPrice: integer('unit_price').notNull(), // centavos
  amount: integer('amount').notNull(), // centavos
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const goodsReceiptNotes = sqliteTable('goods_receipt_notes', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  poId: text('po_id').notNull().references(() => purchaseOrders.id),
  grnNumber: text('grn_number').notNull(),
  receiptDate: text('receipt_date').notNull(),
  deliveryNoteNo: text('delivery_note_no'),
  status: text('status').default('RECEIVED').notNull(),
  receivedBy: text('received_by').references(() => users.id),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const goodsReceiptLines = sqliteTable('goods_receipt_lines', {
  id: text('id').primaryKey(),
  grnId: text('grn_id').notNull().references(() => goodsReceiptNotes.id),
  poLineId: text('po_line_id').notNull().references(() => purchaseOrderLines.id),
  quantityReceived: real('quantity_received').notNull(),
  notes: text('notes'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});


export const companyAiSettings = sqliteTable('company_ai_settings', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  primaryProvider: text('primary_provider').default('gemini').notNull(),
  fallbackProvider: text('fallback_provider').default('local').notNull(),
  primaryKeyId: text('primary_key_id'),
  secondaryKeyId: text('secondary_key_id'),
  geminiApiKey: text('gemini_api_key'),
  openaiApiKey: text('openai_api_key'),
  grokApiKey: text('grok_api_key'),
  customKeysJson: text('custom_keys_json'),
  providersConfigJson: text('providers_config_json'),
  executionModeOverride: text('execution_mode_override').default('AUTO'),
  dailyLimit: integer('daily_limit').default(100),
  monthlyLimit: integer('monthly_limit').default(1000),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
});

export const birPolicies = sqliteTable('bir_policies', {
  id: text('id').primaryKey(),
  issuanceNumber: text('issuance_number').notNull(),
  title: text('title').notNull(),
  issuanceType: text('issuance_type').notNull(),
  publicationDate: integer('publication_date', { mode: 'timestamp' }),
  effectiveDate: integer('effective_date', { mode: 'timestamp' }),
  sourceUrl: text('source_url'),
  status: text('status').default('PENDING_VALIDATION'),
  version: integer('version').default(1),
  affectedTaxArea: text('affected_tax_area'),
  contentSummary: text('content_summary'),
  importedDate: integer('imported_date', { mode: 'timestamp' }).notNull(),
  verifiedDate: integer('verified_date', { mode: 'timestamp' })
});

export const atcDefinitions = sqliteTable('atc_definitions', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  description: text('description').notNull(),
  incomeType: text('income_type').notNull(),
  taxRate: real('tax_rate').notNull(),
  taxpayerClassification: text('taxpayer_classification').default('ALL').notNull(),
  formReference: text('form_reference').default('2307 / 1601EQ').notNull(),
  status: text('status').default('ACTIVE').notNull(),
  sourceMetadata: text('source_metadata').default('BIR RR No. 2-98 as amended by RR No. 11-2018').notNull(),
  effectiveDate: text('effective_date'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const electronicFilingSubmissions = sqliteTable('electronic_filing_submissions', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  filingType: text('filing_type').notNull(),
  reportingPeriod: text('reporting_period').notNull(),
  status: text('status').notNull().default('DRAFT'),
  adapterProvider: text('adapter_provider').notNull().default('OfficialBirAdapter'),
  taxRuleVersion: text('tax_rule_version').default('1.0'),
  atcVersion: text('atc_version').default('1.0'),
  artifactChecksum: text('artifact_checksum'),
  artifactDataJson: text('artifact_data_json'),
  signatureDataJson: text('signature_data_json'),
  externalReference: text('external_reference'),
  receiptReference: text('receipt_reference'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  attemptCount: integer('attempt_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const bankAccounts = sqliteTable('bank_accounts', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  glAccountId: text('gl_account_id').references(() => accounts.id),
  accountName: text('account_name').notNull(),
  bankName: text('bank_name').notNull(),
  accountNumberEncrypted: text('account_number_encrypted').notNull(),
  currency: text('currency').default('PHP').notNull(),
  status: text('status').default('ACTIVE').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const bankStatements = sqliteTable('bank_statements', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  bankAccountId: text('bank_account_id').notNull().references(() => bankAccounts.id),
  statementDate: integer('statement_date', { mode: 'timestamp' }).notNull(),
  startDate: integer('start_date', { mode: 'timestamp' }),
  endDate: integer('end_date', { mode: 'timestamp' }),
  filename: text('filename'),
  status: text('status').default('IMPORTED').notNull(), // IMPORTED, RECONCILED
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const bankTransactions = sqliteTable('bank_transactions', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  bankStatementId: text('bank_statement_id').notNull().references(() => bankStatements.id),
  bankAccountId: text('bank_account_id').notNull().references(() => bankAccounts.id),
  transactionDate: integer('transaction_date', { mode: 'timestamp' }).notNull(),
  description: text('description').notNull(),
  reference: text('reference'),
  amount: real('amount').notNull(),
  type: text('type').notNull(), // CREDIT or DEBIT
  matchedStatus: text('matched_status').default('UNMATCHED').notNull(), // UNMATCHED, SUGGESTED, MATCHED, RECONCILED
  matchedJournalId: text('matched_journal_id'),
  matchedPaymentId: text('matched_payment_id'),
  matchConfidence: real('match_confidence'),
  matchReason: text('match_reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const bankReconciliationApprovals = sqliteTable('bank_reconciliation_approvals', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  bankTransactionId: text('bank_transaction_id').notNull().references(() => bankTransactions.id),
  matchedRecordType: text('matched_record_type').notNull(), // JOURNAL, PAYMENT, EXPENSE
  matchedRecordId: text('matched_record_id').notNull(),
  status: text('status').default('PENDING').notNull(), // PENDING, APPROVED, REJECTED
  approvedBy: text('approved_by'),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const recurringJournals = sqliteTable('recurring_journals', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  templateName: text('template_name').notNull(),
  frequency: text('frequency').notNull(), // MONTHLY, QUARTERLY, YEARLY, WEEKLY
  startDate: integer('start_date', { mode: 'timestamp' }).notNull(),
  endDate: integer('end_date', { mode: 'timestamp' }),
  nextRunDate: integer('next_run_date', { mode: 'timestamp' }).notNull(),
  lastRunDate: integer('last_run_date', { mode: 'timestamp' }),
  status: text('status').default('ACTIVE').notNull(), // ACTIVE, PAUSED, COMPLETED
  journalDataJson: text('journal_data_json').notNull(),
  requiresApproval: integer('requires_approval', { mode: 'boolean' }).default(true).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const cashFlowForecasts = sqliteTable('cash_flow_forecasts', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  forecastDate: integer('forecast_date', { mode: 'timestamp' }).notNull(),
  horizonDays: integer('horizon_days').notNull(), // 30, 60, 90
  scenario: text('scenario').default('BASE').notNull(), // BASE, BEST_CASE, WORST_CASE
  openingBalance: real('opening_balance').notNull(),
  projectedInflows: real('projected_inflows').notNull(),
  projectedOutflows: real('projected_outflows').notNull(),
  closingBalance: real('closing_balance').notNull(),
  detailsJson: text('details_json'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 37. ENTERPRISE APPROVAL ORCHESTRATION & ACCOUNTABILITY (POST-JOURNEY PHASE 2)
export const approvalWorkflows = sqliteTable('approval_workflows', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  recordReference: text('record_reference'),
  workflowType: text('workflow_type').default('SEQUENTIAL').notNull(), // SEQUENTIAL, PARALLEL, AMOUNT_THRESHOLD, DEPARTMENT_ROUTED, ROLE_ROUTED
  status: text('status').default('PENDING').notNull(), // PENDING, IN_PROGRESS, APPROVED, REJECTED, RETURNED, CANCELLED, ESCALATED, EXPIRED
  currentStepOrder: integer('current_step_order').default(1).notNull(),
  totalSteps: integer('total_steps').default(1).notNull(),
  amountCentavos: integer('amount_centavos').default(0).notNull(),
  departmentId: text('department_id'),
  submittedBy: text('submitted_by'),
  submittedByName: text('submitted_by_name'),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  cancelledBy: text('cancelled_by'),
  cancelledAt: integer('cancelled_at', { mode: 'timestamp' }),
  cancellationReason: text('cancellation_reason'),
  slaDueAt: integer('sla_due_at', { mode: 'timestamp' }),
  slaStatus: text('sla_status').default('ON_TRACK').notNull(), // ON_TRACK, AT_RISK, OVERDUE, ESCALATED, COMPLETED_ON_TIME, COMPLETED_OVERDUE
  escalationCount: integer('escalation_count').default(0).notNull(),
  resubmissionCount: integer('resubmission_count').default(0).notNull(),
  metadata: text('metadata'),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const approvalSteps = sqliteTable('approval_steps', {
  id: text('id').primaryKey(),
  workflowId: text('workflow_id').notNull().references(() => approvalWorkflows.id),
  companyId: text('company_id').notNull().references(() => companies.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  stepOrder: integer('step_order').default(1).notNull(),
  stepName: text('step_name').notNull(),
  approvalMode: text('approval_mode').default('SEQUENTIAL').notNull(), // SEQUENTIAL, PARALLEL
  requiredRole: text('required_role'),
  departmentId: text('department_id'),
  thresholdMinCentavos: integer('threshold_min_centavos').default(0),
  thresholdMaxCentavos: integer('threshold_max_centavos'),
  originalAssignedApproverId: text('original_assigned_approver_id'),
  originalAssignedApproverName: text('original_assigned_approver_name'),
  assignedApproverId: text('assigned_approver_id'),
  assignedApproverName: text('assigned_approver_name'),
  actualApproverId: text('actual_approver_id'),
  actualApproverName: text('actual_approver_name'),
  actualApproverRole: text('actual_approver_role'),
  status: text('status').default('PENDING').notNull(), // PENDING, WAITING, APPROVED, REJECTED, RETURNED, CANCELLED, EXPIRED
  decision: text('decision'),
  comments: text('comments'),
  rejectionReason: text('rejection_reason'),
  reassignmentReason: text('reassignment_reason'),
  reassignedBy: text('reassigned_by'),
  reassignedAt: integer('reassigned_at', { mode: 'timestamp' }),
  delegatedFromId: text('delegated_from_id'),
  delegatedFromName: text('delegated_from_name'),
  delegationReason: text('delegation_reason'),
  delegationHistory: text('delegation_history'),
  escalationLevel: integer('escalation_level').default(0).notNull(),
  escalatedToId: text('escalated_to_id'),
  escalatedToRole: text('escalated_to_role'),
  escalatedAt: integer('escalated_at', { mode: 'timestamp' }),
  escalationReason: text('escalation_reason'),
  escalationHistory: text('escalation_history'),
  assignedAt: integer('assigned_at', { mode: 'timestamp' }).notNull().defaultNow(),
  respondedAt: integer('responded_at', { mode: 'timestamp' }),
  durationSeconds: integer('duration_seconds'),
  slaDueAt: integer('sla_due_at', { mode: 'timestamp' }),
  slaStatus: text('sla_status').default('ON_TRACK').notNull(),
  version: integer('version').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const approvalIdempotencyKeys = sqliteTable('approval_idempotency_keys', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  workflowId: text('workflow_id').notNull().references(() => approvalWorkflows.id),
  action: text('action').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  actorId: text('actor_id').notNull(),
  requestHash: text('request_hash').notNull(),
  statusCode: integer('status_code').notNull(),
  responseJson: text('response_json').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const approvalDelegations = sqliteTable('approval_delegations', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  fromUserId: text('from_user_id').notNull(),
  fromUserName: text('from_user_name'),
  toUserId: text('to_user_id').notNull(),
  toUserName: text('to_user_name'),
  roleScope: text('role_scope').default('ALL'),
  moduleScope: text('module_scope').default('ALL'),
  maxAmountCentavos: integer('max_amount_centavos'),
  reason: text('reason').notNull(),
  isTemporary: integer('is_temporary', { mode: 'boolean' }).default(true).notNull(),
  validFrom: integer('valid_from', { mode: 'timestamp' }).notNull().defaultNow(),
  validUntil: integer('valid_until', { mode: 'timestamp' }),
  status: text('status').default('ACTIVE').notNull(),
  createdBy: text('created_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 38. DOCUMENT VERSION JOURNEY & OCR EXECUTION/CORRECTION HISTORY
export const documentVersions = sqliteTable('document_versions', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id),
  companyId: text('company_id').notNull().references(() => companies.id),
  versionNumber: integer('version_number').default(1).notNull(),
  fileName: text('file_name').notNull(),
  originalFileName: text('original_file_name'),
  fileType: text('file_type'),
  fileSize: integer('file_size'),
  filePath: text('file_path'),
  fileHash: text('file_hash').notNull(),
  changeType: text('change_type').default('INITIAL_UPLOAD').notNull(),
  changeReason: text('change_reason'),
  replacedVersionId: text('replaced_version_id'),
  restoredFromVersionId: text('restored_from_version_id'),
  linkedEntityType: text('linked_entity_type'),
  linkedEntityId: text('linked_entity_id'),
  linkedApprovalWorkflowId: text('linked_approval_workflow_id'),
  ocrStatus: text('ocr_status').default('PENDING'),
  ocrEngine: text('ocr_engine'),
  ocrExtractedData: text('ocr_extracted_data'),
  status: text('status').default('ACTIVE').notNull(),
  uploadedBy: text('uploaded_by'),
  uploadedByName: text('uploaded_by_name'),
  uploadedByRole: text('uploaded_by_role'),
  uploadedAt: integer('uploaded_at', { mode: 'timestamp' }).notNull().defaultNow(),
  removedBy: text('removed_by'),
  removedAt: integer('removed_at', { mode: 'timestamp' }),
  removalReason: text('removal_reason'),
});

export const documentOcrHistory = sqliteTable('document_ocr_history', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id),
  versionId: text('version_id'),
  companyId: text('company_id').notNull().references(() => companies.id),
  actionType: text('action_type').notNull(),
  engineUsed: text('engine_used').default('TESSERACT_WASM_OFFLINE').notNull(),
  confidenceScore: real('confidence_score'),
  beforeOcrData: text('before_ocr_data'),
  afterOcrData: text('after_ocr_data'),
  correctedFields: text('corrected_fields'),
  reason: text('reason'),
  performedBy: text('performed_by'),
  performedByName: text('performed_by_name'),
  performedByRole: text('performed_by_role'),
  performedAt: integer('performed_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 39. NOTIFICATION PREFERENCES & DEDUPLICATION
export const notificationPreferences = sqliteTable('notification_preferences', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  userId: text('user_id').notNull().references(() => users.id),
  notifyOnSubmit: integer('notify_on_submit', { mode: 'boolean' }).default(true).notNull(),
  notifyOnApprovalAssigned: integer('notify_on_approval_assigned', { mode: 'boolean' }).default(true).notNull(),
  notifyOnPendingReminder: integer('notify_on_pending_reminder', { mode: 'boolean' }).default(true).notNull(),
  notifyOnOverdue: integer('notify_on_overdue', { mode: 'boolean' }).default(true).notNull(),
  notifyOnApprovedRejected: integer('notify_on_approved_rejected', { mode: 'boolean' }).default(true).notNull(),
  notifyOnReturned: integer('notify_on_returned', { mode: 'boolean' }).default(true).notNull(),
  notifyOnCancelled: integer('notify_on_cancelled', { mode: 'boolean' }).default(true).notNull(),
  notifyOnReassigned: integer('notify_on_reassigned', { mode: 'boolean' }).default(true).notNull(),
  notifyOnEscalated: integer('notify_on_escalated', { mode: 'boolean' }).default(true).notNull(),
  notifyOnFailedSync: integer('notify_on_failed_sync', { mode: 'boolean' }).default(true).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 40. STATUTORY RULES MANAGEMENT & UPDATE DISTRIBUTION
export const statutoryTrustAnchors = sqliteTable('statutory_trust_anchors', {
  id: text('id').primaryKey(),
  keyFingerprint: text('key_fingerprint').notNull().unique(),
  ownerName: text('owner_name').notNull(),
  publicKeyPem: text('public_key_pem').notNull(),
  isTrusted: integer('is_trusted', { mode: 'boolean' }).default(true).notNull(),
  validFrom: text('valid_from').notNull(),
  validTo: text('valid_to').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const statutoryUpdatePackages = sqliteTable('statutory_update_packages', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  packageCode: text('package_code').notNull(),
  packageName: text('package_name').notNull(),
  packageVersion: text('package_version').notNull(),
  publisherIdentity: text('publisher_identity').notNull(),
  signerKeyFingerprint: text('signer_key_fingerprint').notNull(),
  payloadSha256: text('payload_sha256').notNull(),
  digitalSignature: text('digital_signature').notNull(),
  status: text('status').default('IMPORTED').notNull(), // IMPORTED, VALIDATED, PENDING_APPROVAL, APPROVED, ACTIVE, REJECTED, ROLLED_BACK
  rulesCount: integer('rules_count').default(0).notNull(),
  validationReportJson: text('validation_report_json'),
  rawPackageJson: text('raw_package_json').notNull(),
  importedBy: text('imported_by'),
  importedByName: text('imported_by_name'),
  importedAt: integer('imported_at', { mode: 'timestamp' }).notNull().defaultNow(),
  approvedBy: text('approved_by'),
  approvedByName: text('approved_by_name'),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
});

export const statutoryRules = sqliteTable('statutory_rules', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  packageId: text('package_id').references(() => statutoryUpdatePackages.id),
  agency: text('agency').notNull(), // SSS, PHILHEALTH, PAGIBIG, BIR, OTHER
  ruleCode: text('rule_code').notNull(),
  ruleName: text('rule_name').notNull(),
  regulatorySourceRef: text('regulatory_source_ref').notNull(),
  officialPublicationDate: text('official_publication_date').notNull(),
  effectiveStartDate: text('effective_start_date').notNull(),
  effectiveEndDate: text('effective_end_date'),
  versionNumber: integer('version_number').default(1).notNull(),
  calculationMethodology: text('calculation_methodology').notNull(),
  ruleDefinitionJson: text('rule_definition_json').notNull(),
  status: text('status').default('IMPORTED').notNull(), // IMPORTED, PENDING_VALIDATION, VALIDATED, PENDING_APPROVAL, APPROVED, SCHEDULED, ACTIVE, SUPERSEDED, REJECTED
  digitalSignature: text('digital_signature'),
  signerPublicKeyFingerprint: text('signer_public_key_fingerprint'),
  validationStatus: text('validation_status').default('UNTESTED').notNull(), // UNTESTED, PASSED, FAILED
  createdBy: text('created_by'),
  createdByName: text('created_by_name'),
  approvedBy: text('approved_by'),
  approvedByName: text('approved_by_name'),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  activatedAt: integer('activated_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

export const statutoryAuditLogs = sqliteTable('statutory_audit_logs', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  userId: text('user_id').notNull(),
  userName: text('user_name').notNull(),
  userRole: text('user_role'),
  action: text('action').notNull(), // IMPORT_PACKAGE, VALIDATE_PACKAGE, APPROVE_RULE, ACTIVATE_RULE, REJECT_RULE, ROLLBACK_RULE, OVERRIDE_WARNING
  ruleId: text('rule_id'),
  packageId: text('package_id'),
  agency: text('agency'),
  previousStatus: text('previous_status'),
  newStatus: text('new_status'),
  detailsJson: text('details_json'),
  ipAddress: text('ip_address'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});

// 41. CRYPTOGRAPHIC LEDGER INTEGRITY SCAN REPORTS & FINDINGS
export const integrityScanReports = sqliteTable('integrity_scan_reports', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id),
  databaseIdentity: text('database_identity').notNull(),
  status: text('status').notNull().default('COMPLETED'), // SCANNING, COMPLETED, COMPLETED_WITH_FINDINGS, FAILED
  executionMode: text('execution_mode').notNull().default('OFFLINE_LOCAL'),
  engineVersion: text('engine_version').notNull().default('LEDGERAI-CRYPTO-INTEGRITY-v2.5'),
  scanScope: text('scan_scope').notNull().default('FULL_COMPANY_LEDGER_3_DOMAIN'),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  durationMs: integer('duration_ms').default(0).notNull(),
  recordsInspectedJson: text('records_inspected_json').notNull(),
  domainResultsJson: text('domain_results_json').notNull(),
  passedChecks: integer('passed_checks').default(0).notNull(),
  failedChecks: integer('failed_checks').default(0).notNull(),
  warningCount: integer('warning_count').default(0).notNull(),
  criticalCount: integer('critical_count').default(0).notNull(),
  highCount: integer('high_count').default(0).notNull(),
  mediumCount: integer('medium_count').default(0).notNull(),
  lowCount: integer('low_count').default(0).notNull(),
  infoCount: integer('info_count').default(0).notNull(),
  findingsCount: integer('findings_count').default(0).notNull(),
  previousScanId: text('previous_scan_id'),
  previousReportHash: text('previous_report_hash'),
  reportHash: text('report_hash').notNull(),
  triggeredBy: text('triggered_by'),
  triggeredByName: text('triggered_by_name'),
  triggeredByRole: text('triggered_by_role'),
});

export const integrityScanFindings = sqliteTable('integrity_scan_findings', {
  id: text('id').primaryKey(),
  scanId: text('scan_id').notNull().references(() => integrityScanReports.id),
  companyId: text('company_id').notNull().references(() => companies.id),
  domain: text('domain').notNull(), // ACCOUNTING_INTEGRITY, RECORD_INTEGRITY, CRYPTOGRAPHIC_INTEGRITY
  checkCode: text('check_code').notNull(),
  checkName: text('check_name').notNull(),
  severity: text('severity').notNull(), // CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  recordReference: text('record_reference'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  discrepancyAmountCentavos: integer('discrepancy_amount_centavos').default(0).notNull(),
  remediationAction: text('remediation_action').notNull(),
  remediationModulePath: text('remediation_module_path'),
  evidenceJson: text('evidence_json'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
});


