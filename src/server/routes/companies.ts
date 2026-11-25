import { Router } from "express";
import { db } from "../db";
import { 
  companies, companyUsers, users, roles, auditLogs, accountingPeriods, 
  accounts, companyTaxProfiles, journalEntries, journalLines, companyLicenses, companyUserRoles,
  sessions, userPermissionOverrides
} from "../db/schema";
import { eq, and, or, inArray, sql } from "drizzle-orm";
import { requireAuth, requireMinRole, normalizeRole, LedgerRole, parseToken, hashToken } from "../auth";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import path from "path";
import os from "os";
import fs from "fs/promises";
import fsSync from "fs";
import { AuditService } from "../services/auditService";
import { CompanyManager, COMPANIES_ROOT, CompanyClassification, inferCompanyClassification, isProtectedCompanyClassification, isSyntheticCompanyClassification, RESERVED_PROTECTED_COMPANY_IDS } from "../services/companyManager";
import { CompanyLifecycleService, sanitizeCompanyManifestForPublic, sanitizeCompanyForClient } from "../services/companyLifecycleService";
import { CompanyLauncherGenerator } from "../services/companyLauncherGenerator";
import { DatabaseEncryptionService, EncryptionKeyMode } from "../services/databaseEncryptionService";
import { FinancialIntegrityService } from "../services/financialIntegrityService";
import { MigrationManager } from "../services/migrationManager";
import { paths } from "../services/paths";
import { RbacService } from "../services/rbacService";
import { dbContext } from "../db/context";
import { getBirTaxProfileRules } from "../../shared/taxProfile";
import { updateUserSchema, updateMemberStatusSchema } from "../schemas/userSchemas";
import { inferAccountDetailAndBirCategory } from "../../shared/coaAccountUtils";
import { validateDirectoryOnServer } from "../services/directoryValidationService";
import {
  assessCompanyIdentityDuplicate,
  copyDirectoryRecursive,
  stageUploadedPortablePackage,
} from "../services/portableCompanyService";
import { Request, Response } from "express";
import { ServerTelemetryService } from "../services/serverTelemetryService";
import { isAuthorizedServerConsoleRequest } from "../utils/serverConsoleAccess";
import { resolveCompanyIdFromParam } from "../../shared/vanityDomainUtils";

const router = Router();

// Standard Philippine BIR-compliant Chart of Accounts Template
export const DEFAULT_PHILIPPINE_COA = [
  { accountCode: "1010", accountName: "Cash in Bank", accountType: "ASSET", detailType: "CHECKING", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT", isCashAccount: true },
  { accountCode: "1020", accountName: "Petty Cash Fund", accountType: "ASSET", detailType: "PETTY_CASH", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT", isCashAccount: true },
  { accountCode: "1030", accountName: "Accounts Receivable", accountType: "RECEIVABLE", detailType: "TRADE_RECEIVABLE", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT", isControlAccount: true },
  { accountCode: "1040", accountName: "Allowance for Doubtful Accounts", accountType: "ASSET", detailType: "ALLOWANCE_DOUBTFUL", birTaxCategory: "NOT_APPLICABLE", normalBalance: "CREDIT" },
  { accountCode: "1050", accountName: "Input VAT", accountType: "OTHER_CURRENT_ASSET", detailType: "INPUT_VAT", birTaxCategory: "INPUT_VAT_12", normalBalance: "DEBIT", isTaxAccount: true },
  { accountCode: "1060", accountName: "Creditable Withholding Tax (2307)", accountType: "OTHER_CURRENT_ASSET", detailType: "CWT_2307_ASSET", birTaxCategory: "CWT_2307", normalBalance: "DEBIT", isTaxAccount: true },
  { accountCode: "1070", accountName: "Prepaid Expenses", accountType: "OTHER_CURRENT_ASSET", detailType: "PREPAID_EXPENSES", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT" },
  { accountCode: "1080", accountName: "Merchandise Inventory", accountType: "INVENTORY", detailType: "MERCHANDISE_INVENTORY", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT" },
  { accountCode: "1085", accountName: "Employee Withholding Tax Receivable", accountType: "RECEIVABLE", detailType: "ADVANCES_EMPLOYEES", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT" },
  { accountCode: "1510", accountName: "Office Equipment", accountType: "FIXED_ASSET", detailType: "OFFICE_EQUIPMENT", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT" },
  { accountCode: "1520", accountName: "Accumulated Depreciation - Equipment", accountType: "FIXED_ASSET", detailType: "ACCUMULATED_DEPRECIATION", birTaxCategory: "NOT_APPLICABLE", normalBalance: "CREDIT" },
  { accountCode: "2010", accountName: "Accounts Payable", accountType: "PAYABLE", detailType: "TRADE_PAYABLE", birTaxCategory: "NOT_APPLICABLE", normalBalance: "CREDIT", isControlAccount: true },
  { accountCode: "2020", accountName: "Output VAT", accountType: "OTHER_CURRENT_LIABILITY", detailType: "OUTPUT_VAT_LIABILITY", birTaxCategory: "OUTPUT_VAT_12", normalBalance: "CREDIT", isTaxAccount: true },
  { accountCode: "2030", accountName: "Expanded Withholding Tax Payable", accountType: "PAYABLE", detailType: "EWT_PAYABLE", birTaxCategory: "EWT_1601EQ", normalBalance: "CREDIT", isTaxAccount: true },
  { accountCode: "2035", accountName: "Withholding Tax Payable - Compensation", accountType: "PAYABLE", detailType: "WITHHOLDING_TAX_COMPENSATION", birTaxCategory: "WT_COMPENSATION_1601C", normalBalance: "CREDIT", isTaxAccount: true },
  { accountCode: "2036", accountName: "Employee Tax Refund Payable", accountType: "PAYABLE", detailType: "ACCRUED_SALARIES", birTaxCategory: "NOT_APPLICABLE", normalBalance: "CREDIT" },
  { accountCode: "2040", accountName: "SSS/PhilHealth/Pag-IBIG Payable", accountType: "PAYABLE", detailType: "STATUTORY_PAYABLES_SSS", birTaxCategory: "NOT_APPLICABLE", normalBalance: "CREDIT" },
  { accountCode: "2120", accountName: "Percentage Tax Payable (Form 2551Q)", accountType: "PAYABLE", detailType: "PERCENTAGE_TAX_LIABILITY", birTaxCategory: "PERCENTAGE_TAX_3", normalBalance: "CREDIT", isTaxAccount: true },
  { accountCode: "2140", accountName: "Special Gross Income Tax Payable (5% GIT)", accountType: "PAYABLE", detailType: "INCOME_TAX_PAYABLE_LIAB", birTaxCategory: "INCOME_TAX_1702", normalBalance: "CREDIT", isTaxAccount: true },
  { accountCode: "2510", accountName: "Long-Term Loans Payable", accountType: "LONG_TERM_LIABILITY", detailType: "BANK_LOAN_LONG", birTaxCategory: "NOT_APPLICABLE", normalBalance: "CREDIT" },
  { accountCode: "3010", accountName: "Owner's Equity / Capital", accountType: "EQUITY", detailType: "PAID_IN_CAPITAL", birTaxCategory: "NOT_APPLICABLE", normalBalance: "CREDIT" },
  { accountCode: "3020", accountName: "Retained Earnings", accountType: "EQUITY", detailType: "RETAINED_EARNINGS", birTaxCategory: "NOT_APPLICABLE", normalBalance: "CREDIT", isRetainedEarnings: true },
  { accountCode: "4010", accountName: "Service Revenue / Sales", accountType: "REVENUE", detailType: "SERVICE_INCOME", birTaxCategory: "OUTPUT_VAT_12", normalBalance: "CREDIT" },
  { accountCode: "4020", accountName: "Sales Discounts & Allowances", accountType: "REVENUE", detailType: "EXEMPT_SALES", birTaxCategory: "NON_TAXABLE_EXEMPT", normalBalance: "DEBIT" },
  { accountCode: "5010", accountName: "Cost of Goods Sold / Services", accountType: "COST_OF_SALES", detailType: "COGS_FINISHED_GOODS", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT" },
  { accountCode: "6010", accountName: "Salaries and Wages", accountType: "EXPENSE", detailType: "SALARIES_EXPENSE", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT" },
  { accountCode: "6020", accountName: "Rent Expense", accountType: "EXPENSE", detailType: "RENT_EXPENSE", birTaxCategory: "EWT_1601EQ", normalBalance: "DEBIT" },
  { accountCode: "6030", accountName: "Utilities Expense", accountType: "EXPENSE", detailType: "UTILITIES_EXPENSE", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT" },
  { accountCode: "6040", accountName: "Office Supplies Expense", accountType: "EXPENSE", detailType: "SUPPLIES_EXPENSE", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT" },
  { accountCode: "6050", accountName: "Professional Fees", accountType: "EXPENSE", detailType: "PROFESSIONAL_FEES", birTaxCategory: "EWT_1601EQ", normalBalance: "DEBIT" },
  { accountCode: "6060", accountName: "Depreciation Expense", accountType: "EXPENSE", detailType: "DEPRECIATION_EXPENSE", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT" },
  { accountCode: "6070", accountName: "Taxes and Licenses", accountType: "EXPENSE", detailType: "TAXES_LICENSES", birTaxCategory: "LOCAL_TAX_LBT", normalBalance: "DEBIT" },
  { accountCode: "6075", accountName: "Employer-Absorbed Tax Adjustment Expense", accountType: "EXPENSE", detailType: "TAXES_LICENSES", birTaxCategory: "NON_TAXABLE_EXEMPT", normalBalance: "DEBIT" },
  { accountCode: "7010", accountName: "Interest Income", accountType: "OTHER_INCOME", detailType: "INTEREST_INCOME", birTaxCategory: "NOT_APPLICABLE", normalBalance: "CREDIT" },
  { accountCode: "7020", accountName: "Bank Service Charges", accountType: "OTHER_EXPENSE", detailType: "INTEREST_BANK_FEES", birTaxCategory: "NOT_APPLICABLE", normalBalance: "DEBIT" }
];

async function verifySyntheticAdminAccess(
  req: any,
  res: any,
  targetEntityId: string = 'ALL_SYNTHETIC'
): Promise<{ authorized: boolean; userId?: string; companyId?: string }> {
  let token = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) {
    res.status(401).json({
      error: "AUTH_REQUIRED",
      message: "Authentication required to access or include synthetic test and benchmark companies."
    });
    return { authorized: false };
  }

  const parsed = parseToken(token);
  if (!parsed) {
    res.status(401).json({
      error: "AUTH_REQUIRED",
      message: "Invalid or expired session token."
    });
    return { authorized: false };
  }

  const hashedSessionId = hashToken(parsed.sessionId);
  let companyDb = dbContext.getStore();
  if (!companyDb) {
    try {
      companyDb = await CompanyManager.getCompanyDb(parsed.companyId);
    } catch {
      res.status(401).json({
        error: "AUTH_REQUIRED",
        message: "Company context not found."
      });
      return { authorized: false };
    }
  }

  return await dbContext.run(companyDb, async () => {
    const session = await db.select().from(sessions).where(eq(sessions.id, hashedSessionId)).get();
    if (!session || new Date(session.expiresAt) < new Date()) {
      res.status(401).json({
        error: "AUTH_REQUIRED",
        message: "Invalid or expired session."
      });
      return { authorized: false };
    }

    const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
    if (!user || user.status !== "ACTIVE") {
      res.status(401).json({
        error: "AUTH_REQUIRED",
        message: "User account inactive or not found."
      });
      return { authorized: false };
    }

    // Check role authorization strictly from the database / RbacService
    // Caller-supplied roles in query parameters or custom headers (including X-Allow-Synthetic-Company) are strictly IGNORED as credentials
    let isAuthorized = false;
    const membership = await db
      .select()
      .from(companyUsers)
      .where(
        and(
          eq(companyUsers.userId, user.id),
          eq(companyUsers.companyId, parsed.companyId)
        )
      )
      .get();

    if (membership && membership.status === 'ACTIVE') {
      const resolved = await RbacService.resolveEffectiveAccess(membership.id);
      if (
        resolved.primaryRole === 'Company Owner' ||
        resolved.primaryRole === 'Company Administrator' ||
        resolved.roles.includes('Company Owner') ||
        resolved.roles.includes('Company Administrator') ||
        resolved.effectivePermissions.includes('settings:manage') ||
        resolved.effectivePermissions.includes('*')
      ) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      const allUserMemberships = await db
        .select()
        .from(companyUsers)
        .where(and(eq(companyUsers.userId, user.id), eq(companyUsers.status, 'ACTIVE')))
        .all();

      for (const m of allUserMemberships) {
        const resolved = await RbacService.resolveEffectiveAccess(m.id);
        if (
          resolved.primaryRole === 'Company Owner' ||
          resolved.primaryRole === 'Company Administrator' ||
          resolved.roles.includes('Company Owner') ||
          resolved.roles.includes('Company Administrator')
        ) {
          isAuthorized = true;
          break;
        }
      }
    }

    if (!isAuthorized) {
      res.status(403).json({
        error: "PERMISSION_DENIED",
        message: "Only Company Owners and Company Administrators are authorized to view or access synthetic test companies."
      });
      return { authorized: false };
    }

    try {
      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        companyId: parsed.companyId,
        userId: user.id,
        action: 'SYNTHETIC_COMPANIES_ACCESSED',
        entityType: 'COMPANY',
        entityId: targetEntityId,
        result: 'SUCCESS',
        reason: 'Authorized administrator requested access to synthetic test and benchmark companies',
        module: 'COMPANY_MANAGEMENT',
        severity: 'INFO',
        source: 'COMPANY_ROUTER',
        timestamp: new Date()
      });
    } catch (_) {}

    return { authorized: true, userId: user.id, companyId: parsed.companyId };
  });
}

async function verifyCompanyTenantAndRole(
  req: Request,
  res: Response,
  targetCompanyId: string,
  allowedRoles: LedgerRole[]
): Promise<boolean> {
  if (!req.user || !req.activeCompany) {
    res.status(401).json({ error: "AUTH_REQUIRED", message: "Authentication required." });
    return false;
  }

  const requesterRoles = req.activeCompany.roles || [req.activeCompany.role];
  if (req.activeCompany.id === targetCompanyId) {
    if (allowedRoles.some((r) => requesterRoles.includes(r))) {
      return true;
    }
    res.status(403).json({
      error: "PERMISSION_DENIED",
      message: `Insufficient role privileges. Required: ${allowedRoles.join(' or ')}.`,
    });
    return false;
  }

  // Cross-company check: only allowed if caller has an ACTIVE membership with an allowed Owner/Admin role in targetCompanyId
  if (!requesterRoles.includes('Company Owner') && !requesterRoles.includes('Company Administrator')) {
    res.status(403).json({
      error: "TENANT_SCOPE_VIOLATION",
      message: `Access denied to company workspace '${targetCompanyId}'.`,
    });
    return false;
  }

  let hasTargetAccess = false;
  try {
    const targetDb = await CompanyManager.getCompanyDb(targetCompanyId);
    hasTargetAccess = await dbContext.run(targetDb, async () => {
      const membership = await db
        .select()
        .from(companyUsers)
        .where(
          and(
            eq(companyUsers.userId, req.user!.id),
            eq(companyUsers.companyId, targetCompanyId),
            eq(companyUsers.status, 'ACTIVE')
          )
        )
        .get();
      if (!membership) return false;
      const resolved = await RbacService.resolveEffectiveAccess(membership.id);
      const targetRoles = resolved.roles.length > 0 ? resolved.roles : [resolved.primaryRole];
      return allowedRoles.some((r) => targetRoles.includes(r));
    });
  } catch {
    hasTargetAccess = false;
  }

  if (!hasTargetAccess) {
    res.status(403).json({
      error: "TENANT_SCOPE_VIOLATION",
      message: `Access denied: You do not hold ${allowedRoles.join('/')} authority in company '${targetCompanyId}'.`,
    });
    return false;
  }

  return true;
}

function assertAllowedWorkspacePath(rawInputPath: string): string {
  const input = String(rawInputPath || '').trim();
  if (!input || input.includes('\0')) {
    throw new Error('PATH_TRAVERSAL_BLOCKED: A valid workspace path is required.');
  }

  const resolved = path.resolve(input);
  const norm = resolved.replace(/\\/g, '/').toLowerCase();

  // Unconditionally block sensitive OS/system/secret paths
  const blockedPrefixes = [
    '/etc',
    '/bin',
    '/sbin',
    '/usr',
    '/lib',
    '/lib64',
    '/proc',
    '/sys',
    '/dev',
    '/boot',
    '/var/log',
    '/var/run',
    'c:/windows',
    'c:/program files',
    'c:/program files (x86)',
  ];
  for (const prefix of blockedPrefixes) {
    if (norm === prefix || norm.startsWith(`${prefix}/`)) {
      throw new Error(`PATH_TRAVERSAL_BLOCKED: Access to restricted system path '${resolved}' is prohibited.`);
    }
  }

  const blockedSegments = ['/.ssh', '/.gnupg', '/.aws', '/.keystore_vault', '/.audit_hmac.json'];
  for (const seg of blockedSegments) {
    if (norm.includes(seg)) {
      throw new Error(`PATH_TRAVERSAL_BLOCKED: Access to restricted security path '${resolved}' is prohibited.`);
    }
  }

  const isInside = (baseDir: string | null | undefined): boolean => {
    if (!baseDir) return false;
    const baseResolved = path.resolve(baseDir);
    const rel = path.relative(baseResolved, resolved);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };

  const allowedRoots: string[] = [
    paths.getCompaniesRootDir(),
    paths.getDataDir(),
    path.join(os.homedir(), 'Documents'),
    path.join(process.cwd(), 'data'),
  ];
  if (process.env.LEDGERAI_ISOLATED_TEST_ROOT) {
    allowedRoots.push(process.env.LEDGERAI_ISOLATED_TEST_ROOT);
  }
  if (process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST)) {
    allowedRoots.push(os.tmpdir());
  }
  if (process.platform === 'win32') {
    for (const p of paths.getAvailableActiveDrives()) {
      if (p?.path) allowedRoots.push(p.path);
    }
  }

  const permitted = allowedRoots.some((root) => isInside(root));
  if (!permitted) {
    throw new Error(
      `PATH_TRAVERSAL_BLOCKED: Workspace path '${resolved}' is outside approved LedgerAI storage locations.`
    );
  }

  return resolved;
}

function isLocalLoopbackRequest(req: Request): boolean {
  return isAuthorizedServerConsoleRequest(req);
}

// Public: Authoritative runtime mode & capabilities for PC Server Console vs. Browser Client
router.get("/runtime-mode", (req, res) => {
  const isServerConsole = isLocalLoopbackRequest(req);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    mode: isServerConsole ? "PC_SERVER_CONSOLE" : "BROWSER_CLIENT",
    isServerConsole,
    isBrowserClient: !isServerConsole,
    canCreateCompany: isServerConsole,
    canOpenLocalFolder: isServerConsole,
    canRestoreCompany: isServerConsole,
    serverHostname: ServerTelemetryService.getConfiguredLanHostname(),
    deploymentMode: ServerTelemetryService.getDeploymentMode(),
  });
});

// Authenticated: List ONLY companies the signed-in user is authorized to access (Centralized Multi-Company Workspace)
router.get("/authorized", requireAuth, async (req, res) => {
  try {
    const userEmail = (req.user!.email || '').trim().toLowerCase();
    const activeCompanyId = req.activeCompany!.id;
    const allCompanies = await CompanyManager.listCompanies({ includeSynthetic: false });
    const authorizedCompanies: Array<Record<string, any>> = [];

    for (const manifest of allCompanies) {
      if (manifest.status === 'ARCHIVED' || manifest.registrationStatus === 'ARCHIVED') continue;
      try {
        const compDb = await CompanyManager.getCompanyDb(manifest.id);
        const match = await dbContext.run(compDb, async () => {
          const usr = await db.select().from(users).where(sql`LOWER(${users.email}) = ${userEmail}`).get();
          if (!usr || usr.status !== 'ACTIVE') return null;

          const membership = await db
            .select()
            .from(companyUsers)
            .where(and(eq(companyUsers.userId, usr.id), eq(companyUsers.companyId, manifest.id)))
            .get();

          const memStatus = membership ? ((membership as any).membershipStatus || membership.status || 'ACTIVE') : 'NONE';
          if (!membership || membership.status !== 'ACTIVE' || memStatus !== 'ACTIVE') return null;

          const resolved = await RbacService.resolveEffectiveAccess(membership.id);
          if (!resolved.effectiveAccountActive) return null;

          const compRow = await db.select().from(companies).where(eq(companies.id, manifest.id)).get();
          return {
            id: manifest.id,
            legalName: compRow?.legalName || manifest.legalName,
            tradeName: compRow?.tradeName || compRow?.legalName || manifest.legalName,
            tin: compRow?.tin || null,
            vatStatus: compRow?.vatStatus || 'VAT',
            taxpayerClassification: compRow?.taxpayerClassification || 'CORPORATION',
            rdoCode: compRow?.rdoCode || null,
            status: manifest.status || 'ACTIVE',
            classification: manifest.classification || 'PRODUCTION',
            role: resolved.primaryRole,
            roles: resolved.assignedRoles,
            lastOpenedAt: manifest.lastOpenedAt || manifest.createdAt,
            createdAt: manifest.createdAt,
            isActive: manifest.id === activeCompanyId,
            requiresReauth: Boolean(usr.requirePasswordChange || (usr.lockedUntil && new Date(usr.lockedUntil) > new Date())),
            availabilityStatus: 'AVAILABLE',
            storageScope: 'SERVER_MANAGED',
          };
        });

        if (match) {
          authorizedCompanies.push(match);
        }
      } catch {
        // Skip inaccessible/corrupted DB safely without exposing server paths
      }
    }

    authorizedCompanies.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return String(b.lastOpenedAt || '').localeCompare(String(a.lastOpenedAt || ''));
    });

    res.json({
      activeCompanyId,
      userEmail: req.user!.email,
      companies: authorizedCompanies,
    });
  } catch (err: any) {
    res.status(500).json({ error: "AUTHORIZED_COMPANIES_ERROR", message: err?.message || "Failed to load authorized company workspaces." });
  }
});

// Public: List all local profiles - Should be public for login screen
// List local profiles: Public endpoint for workspace selector, strictly excluding synthetic datasets by default
// Supports includeTestCompanies=true, includeSynthetic=true, or X-Allow-Synthetic-Company: true ONLY for authenticated Company Owner / Administrator
router.get("/", async (req, res) => {
  try {
    const headerAllowSynthetic =
      String(req.headers['x-allow-synthetic-company'] || '').toLowerCase() === 'true';
    const includeTestRequested =
      req.query.includeTestCompanies === 'true' ||
      req.query.includeSynthetic === 'true' ||
      headerAllowSynthetic;

    let includeSynthetic = false;

    if (includeTestRequested) {
      const authCheck = await verifySyntheticAdminAccess(req, res, 'ALL_SYNTHETIC');
      if (!authCheck.authorized) {
        return;
      }
      includeSynthetic = true;
    }

    const excludeNonProduction =
      req.query.excludeNonProduction === 'true' ||
      req.query.productionOnly === 'true' ||
      process.env.NODE_ENV === 'production';

    const rawClassification = req.query.classification
      ? String(req.query.classification)
          .split(',')
          .map((s) => s.trim().toUpperCase() as CompanyClassification)
      : undefined;

    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const sortBy = (['legalName', 'createdAt', 'id'].includes(String(req.query.sortBy))
      ? req.query.sortBy
      : 'legalName') as 'legalName' | 'createdAt' | 'id';
    const sortOrder = String(req.query.sortOrder).toLowerCase() === 'desc' ? 'desc' : 'asc';
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const result = await CompanyManager.listCompaniesWithCount({
      excludeNonProduction,
      classification: rawClassification,
      includeSynthetic,
      search,
      sortBy,
      sortOrder,
      limit,
      offset,
    });

    res.setHeader('X-Total-Count', String(result.totalCount));
    res.setHeader('X-Filtered-Count', String(result.filteredCount));

    const includePhysicalPaths = isLocalLoopbackRequest(req);
    const availableOnly = req.query.availableOnly === 'true';

    // When availableOnly is requested (used by client-side landing page), the AUTHORITATIVE source of truth
    // is strictly the server's currently saved / mapped company workspaces (shortcuts).
    // If shortcuts are empty ("No Saved Companies Yet"), this MUST return [].
    // If shortcuts has 1 company (e.g. Deskguard Solutions), this MUST return only that 1 company.
    if (availableOnly) {
      const activeShortcuts = await CompanyLifecycleService.listShortcuts({
        includeSynthetic: true, // Allow stress preview and portable company workspaces currently mapped on server
        verifyLive: true,
      });

      const validShortcuts = activeShortcuts.filter(
        (s) => s.availabilityStatus === 'AVAILABLE' && s.validationStatus !== 'INVALID'
      );

      const items = await Promise.all(
        validShortcuts.map(async (s) => {
          let manifest = await CompanyManager.getCompanyManifest(s.companyId).catch(() => null);
          if (!manifest && s.companyDirectory) {
            try {
              const manifestPath = path.join(s.companyDirectory, 'manifest.json');
              if (fsSync.existsSync(manifestPath)) {
                manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
              }
            } catch {}
          }
          return {
            id: s.companyId,
            legalName: manifest?.legalName || s.displayName || s.companyId,
            tradeName: manifest?.tradeName || manifest?.legalName || s.displayName || s.companyId,
            tin: manifest?.tin || '',
            rdoCode: manifest?.rdoCode || '',
            vatStatus: manifest?.vatStatus || 'VAT',
            taxpayerClassification: manifest?.taxpayerClassification || 'CORPORATION',
            status: manifest?.status || 'ACTIVE',
            classification: s.classification || manifest?.classification || 'PRODUCTION',
            isDemo: Boolean(s.isDemo || manifest?.isDemo),
            isVisualStressPreview: Boolean(s.isVisualStressPreview || manifest?.isVisualStressPreview),
            createdAt: manifest?.createdAt || s.lastOpenedAt,
            lastOpenedAt: s.lastOpenedAt,
            availabilityStatus: s.availabilityStatus,
            validationStatus: s.validationStatus,
            storageScope: (s as any).storageScope || 'LOCAL_DESKTOP',
            ...(includePhysicalPaths ? { dbPath: s.databasePath, location: s.companyDirectory } : {}),
          };
        })
      );

      let resultItems = items;
      if (search) {
        const query = search.toLowerCase();
        resultItems = resultItems.filter(
          (c) =>
            c.legalName.toLowerCase().includes(query) ||
            c.tradeName.toLowerCase().includes(query) ||
            (c.tin && c.tin.toLowerCase().includes(query)) ||
            c.id.toLowerCase().includes(query)
        );
      }

      const sanitizedItems = resultItems.map((item) =>
        sanitizeCompanyForClient(item, { includePhysicalPaths })
      );

      res.setHeader('X-Total-Count', String(sanitizedItems.length));
      res.setHeader('X-Filtered-Count', String(sanitizedItems.length));

      if (req.query.format === 'paginated') {
        res.json({
          items: sanitizedItems,
          totalCount: sanitizedItems.length,
          filteredCount: sanitizedItems.length,
          page: 1,
          pageSize: sanitizedItems.length,
          totalPages: 1,
        });
      } else {
        res.json(sanitizedItems);
      }
      return;
    }

    const sanitizedItems = result.items.map((item) =>
      sanitizeCompanyForClient(item, { includePhysicalPaths })
    );

    if (req.query.format === 'paginated') {
      res.json({
        ...result,
        totalCount: result.totalCount,
        filteredCount: result.filteredCount,
        items: sanitizedItems,
      });
    } else {
      res.json(sanitizedItems);
    }
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err?.message || "Failed to list companies" });
  }
});

// Public: Get device active storage environment and drive presets (localhost/desktop or authenticated admin only)
router.get("/storage-environment", async (req, res) => {
  try {
    if (!isLocalLoopbackRequest(req)) {
      res.status(403).json({
        error: "SERVER_FILESYSTEM_PROTECTED",
        message: "Server filesystem environment inspection is restricted to the central server host.",
      });
      return;
    }

    const companiesRoot = paths.getCompaniesRootDir().replace(/\\/g, '/');
    const dataDir = paths.getDataDir().replace(/\\/g, '/');
    const configDir = paths.getConfigDir().replace(/\\/g, '/');
    const homeDir = os.homedir().replace(/\\/g, '/');
    const platform = os.platform();
    const presets = paths.getAvailableActiveDrives();

    res.json({
      companiesRoot,
      dataDir,
      configDir,
      homeDir,
      platform,
      presets
    });
  } catch (err: any) {
    res.status(500).json({ error: "STORAGE_ENV_ERROR", message: err?.message || "Failed to get storage environment" });
  }
});

// Persistent Shortcut History: list recent company workspaces with live disk health checks
router.get("/shortcuts", async (req, res) => {
  try {
    const headerAllowSynthetic =
      String(req.headers['x-allow-synthetic-company'] || '').toLowerCase() === 'true';
    const includeTestRequested =
      req.query.includeTestCompanies === 'true' ||
      req.query.includeSynthetic === 'true' ||
      headerAllowSynthetic;

    let includeSynthetic = false;
    if (includeTestRequested) {
      const authCheck = await verifySyntheticAdminAccess(req, res, 'ALL_SYNTHETIC_SHORTCUTS');
      if (!authCheck.authorized) {
        return;
      }
      includeSynthetic = true;
    }

    const verifyLive = req.query.verifyLive !== 'false';
    const rawShortcuts = await CompanyLifecycleService.listShortcuts({
      includeSynthetic,
      verifyLive,
    });
    const includePhysicalPaths = isLocalLoopbackRequest(req);
    const shortcuts = rawShortcuts.map((s) => sanitizeCompanyForClient(s, { includePhysicalPaths }));
    res.json({ shortcuts, isRemoteClient: !includePhysicalPaths });
  } catch (err: any) {
    res.status(500).json({ error: "SHORTCUT_LIST_ERROR", message: err?.message || "Failed to load company shortcuts" });
  }
});

// Reopen a company from shortcut history with live integrity/version/identity validation and clean session isolation
router.post("/shortcuts/:id/reopen", async (req, res) => {
  try {
    const { id } = req.params;
    const allowSyntheticRequested =
      req.query.includeSynthetic === 'true' ||
      req.body?.includeSynthetic === true ||
      String(req.headers['x-allow-synthetic-company'] || '').toLowerCase() === 'true';

    let allowSynthetic = false;
    if (allowSyntheticRequested) {
      const authCheck = await verifySyntheticAdminAccess(req, res, id);
      if (!authCheck.authorized) return;
      allowSynthetic = true;
    }

    // Revoke any stale active session belonging to a DIFFERENT company before switching
    try {
      const token = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
      if (token) {
        const parsed = parseToken(token);
        if (parsed && parsed.companyId && parsed.companyId !== id) {
          try {
            const oldDb = await CompanyManager.getCompanyDb(parsed.companyId);
            await dbContext.run(oldDb, async () => {
              await db.delete(sessions).where(eq(sessions.id, hashToken(parsed.sessionId)));
            });
          } catch {}
          res.clearCookie('token');
        }
      }
    } catch {}

    const result = await CompanyLifecycleService.reopenCompanyShortcut(id, { allowSynthetic });
    res.json({
      success: true,
      company: result.company,
      shortcut: result.shortcut,
      message: `Company '${result.company.legalName}' verified and ready for sign-in.`,
    });
  } catch (err: any) {
    const msg = String(err?.message || "Failed to reopen company shortcut");
    const code = msg.includes(':') ? msg.split(':')[0].trim() : 'REOPEN_FAILED';
    const status =
      code === 'SHORTCUT_NOT_FOUND' || code === 'DATABASE_NOT_FOUND'
        ? 404
        : code === 'SYNTHETIC_COMPANY_ISOLATED'
        ? 403
        : 400;
    res.status(status).json({ error: code, message: msg });
  }
});

// Re-evaluate live availability & validation status for a specific shortcut
router.post("/shortcuts/:id/validate", async (req, res) => {
  try {
    const { id } = req.params;
    const shortcuts = await CompanyLifecycleService.listShortcuts({ includeSynthetic: true, verifyLive: false });
    const target = shortcuts.find((s) => s.companyId === id);
    if (!target) {
      res.status(404).json({ error: "SHORTCUT_NOT_FOUND", message: `No shortcut entry found for '${id}'.` });
      return;
    }
    const cls = inferCompanyClassification(target.companyId, target.displayName, target.isDemo, target.classification);
    if (isSyntheticCompanyClassification(cls) && !target.isVisualStressPreview) {
      const authCheck = await verifySyntheticAdminAccess(req, res, id);
      if (!authCheck.authorized) return;
    }

    const updated = await CompanyLifecycleService.evaluateShortcutHealth(target);
    await CompanyLifecycleService.recordShortcut({
      ...updated,
    });
    res.json({
      valid: updated.availabilityStatus === 'AVAILABLE' && updated.validationStatus === 'VALID',
      shortcut: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: "SHORTCUT_VALIDATE_ERROR", message: err?.message || "Failed to validate shortcut" });
  }
});

// Relink a missing/moved company shortcut to a new .lai/.sqlite path or folder (enforces strict identity match)
router.post("/shortcuts/:id/locate", async (req, res) => {
  try {
    const { id } = req.params;
    const { path: targetPath, folderPath, filePath } = req.body || {};
    const resolvedInput = targetPath || filePath || folderPath;
    if (!resolvedInput || typeof resolvedInput !== 'string') {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "A database file or folder path is required." });
      return;
    }

    const result = await CompanyLifecycleService.locateCompanyShortcut(id, resolvedInput);
    res.json({
      success: true,
      company: result.company,
      shortcut: result.shortcut,
      message: `Database relocated and verified for '${result.company.legalName}'.`,
    });
  } catch (err: any) {
    const msg = String(err?.message || "Failed to locate company database");
    const code = msg.includes(':') ? msg.split(':')[0].trim() : 'LOCATE_FAILED';
    const status = code === 'DATABASE_NOT_FOUND' ? 404 : 400;
    res.status(status).json({ error: code, message: msg });
  }
});

// Non-destructive Clear ALL Data Register / Launcher Shortcuts ONLY (never deletes any .lai, SQLite, document, backup, or key files)
router.delete("/shortcuts", async (req, res) => {
  try {
    const confirmed =
      req.body?.confirmClearShortcutsOnly === true ||
      req.query.confirmClearShortcutsOnly === 'true';
    if (!confirmed) {
      res.status(400).json({
        error: "CONFIRMATION_REQUIRED",
        message: "confirmClearShortcutsOnly=true is required to clear all data register shortcuts.",
      });
      return;
    }

    const result = await CompanyLifecycleService.clearAllShortcutsOnly({
      authorizedByUserId: (req as any).user?.id || 'LAUNCHER_USER',
      confirmClearShortcutsOnly: true,
      reason: String(req.body?.reason || 'User cleared all data register shortcuts only (databases preserved on disk)'),
    });

    res.clearCookie('token');
    res.json({
      success: true,
      status: "ALL_SHORTCUTS_CLEARED",
      filesPreserved: true,
      databaseDeleted: false,
      ...result,
      message: `Cleared ${result.clearedCount} data register shortcut(s). All company databases, backups, and documents remain intact on disk.`,
    });
  } catch (err: any) {
    res.status(500).json({
      error: "CLEAR_SHORTCUTS_FAILED",
      message: err?.message || "Failed to clear data register shortcuts",
    });
  }
});

// Non-destructive Remove Shortcut: removes shortcut & registry reference ONLY (never deletes .lai/SQLite/documents/backups)
router.delete("/shortcuts/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // If caller presents an authenticated session token for a DIFFERENT company, block cross-tenant tampering on protected companies (unless explicitly removing a launcher shortcut with confirmProtectedUnregister)
    const token = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
    if (token && req.body?.confirmProtectedUnregister !== true) {
      const parsed = parseToken(token);
      if (parsed && parsed.companyId && parsed.companyId !== id) {
        const targetManifest = await CompanyManager.getCompanyManifest(id).catch(() => null);
        const cls = inferCompanyClassification(
          id,
          targetManifest?.legalName,
          targetManifest?.isDemo,
          targetManifest?.classification
        );
        if (RESERVED_PROTECTED_COMPANY_IDS.has(id) || isProtectedCompanyClassification(cls)) {
          res.status(403).json({
            error: "TENANT_SCOPE_VIOLATION",
            message: `Cross-tenant shortcut removal rejected for protected company '${id}'.`,
          });
          return;
        }
      }
    }

    const result = await CompanyLifecycleService.removeShortcutOnly(id, {
      authorizedByUserId: (req as any).user?.id || 'LAUNCHER_USER',
      confirmProtectedUnregister: req.body?.confirmProtectedUnregister === true,
      reason: String(req.body?.reason || 'Non-destructive shortcut removal from launcher/open screen'),
    });

    try {
      if (token) {
        const parsed = parseToken(token);
        if (parsed && parsed.companyId === id) {
          res.clearCookie('token');
        }
      }
    } catch {}

    res.json({
      success: true,
      status: "SHORTCUT_REMOVED",
      filesPreserved: true,
      ...result,
      message: `Shortcut for '${id}' removed. Physical database files and backups remain preserved on disk.`,
    });
  } catch (err: any) {
    const msg = String(err?.message || "Failed to remove company shortcut");
    const status =
      msg.includes("PROTECTED_PILOT_COMPANY") || msg.includes("PROTECTED_COMPANY_CLASSIFICATION")
        ? 403
        : 400;
    res.status(status).json({
      error: msg.includes("PROTECTED_PILOT_COMPANY")
        ? "PROTECTED_PILOT_COMPANY"
        : msg.includes("PROTECTED_COMPANY_CLASSIFICATION")
        ? "PROTECTED_COMPANY_CLASSIFICATION"
        : "SHORTCUT_REMOVE_FAILED",
      message: msg,
    });
  }
});

router.post("/registry/cleanup-stale", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  try {
    const { dryRun, reason, verifiedOrphanedFixtureProvenance } = req.body || {};
    const result = await CompanyManager.cleanupStaleRegistryEntries({
      authorizedByUserId: req.user!.id,
      authorizedByRole: req.activeCompany?.role || 'Company Owner',
      reason: String(reason || 'Targeted stale registry cleanup via authenticated governance endpoint'),
      dryRun: Boolean(dryRun),
      verifiedOrphanedFixtureProvenance: Array.isArray(verifiedOrphanedFixtureProvenance)
        ? verifiedOrphanedFixtureProvenance
        : undefined,
    });

    await AuditService.log({
      req,
      companyId: req.activeCompany!.id,
      action: "STALE_REGISTRY_CLEANUP",
      entityType: "COMPANY_REGISTRY",
      entityId: "REGISTRY_JSON",
      module: "COMPANY_MANAGEMENT",
      reason: String(reason || 'Targeted stale registry cleanup'),
      afterData: {
        removedCount: result.removedCount,
        removedIds: result.removedEntries.map((r) => r.companyId),
        excludedCount: result.excludedProtectedEntries.length,
        preservedValidEntriesCount: result.preservedValidEntriesCount,
      },
    });

    res.json({
      success: true,
      ...result,
      message: result.dryRun
        ? `Dry-run completed: ${result.removedEntries.length} stale registry entry(s) identified.`
        : `Targeted stale registry cleanup completed: ${result.removedCount} stale entry(s) removed; ${result.preservedValidEntriesCount} valid company database(s) preserved.`,
    });
  } catch (err: any) {
    res.status(400).json({
      error: "STALE_CLEANUP_FAILED",
      message: err?.message || "Failed to execute targeted stale registry cleanup",
    });
  }
});

router.post("/registry/reconcile-fixture", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  try {
    const { companyId, targetClassification, provenanceSource, reason } = req.body || {};
    if (!companyId || !targetClassification || !provenanceSource || !reason) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "companyId, targetClassification, provenanceSource, and reason are required.",
      });
      return;
    }

    const result = await CompanyManager.reconcileSyntheticTestFixtureClassification(String(companyId), {
      targetClassification,
      provenanceSource: String(provenanceSource),
      authorizedByUserId: req.user!.id,
      authorizedByRole: req.activeCompany?.role || 'Company Owner',
      reason: String(reason),
    });

    await AuditService.log({
      req,
      companyId: req.activeCompany!.id,
      action: result.reconciled
        ? "SYNTHETIC_FIXTURE_CLASSIFICATION_RECONCILED"
        : "SYNTHETIC_FIXTURE_RECONCILIATION_PRESERVED",
      entityType: "COMPANY",
      entityId: String(companyId),
      module: "COMPANY_MANAGEMENT",
      reason: String(reason),
      beforeData: result.before,
      afterData: result.after,
      metadata: { evidenceCounts: result.evidenceCounts, provenanceSource },
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    const msg = String(err?.message || "Failed to reconcile test fixture classification");
    const status = msg.includes("PROTECTED_") ? 403 : msg.includes("NOT_FOUND") ? 404 : 400;
    res.status(status).json({
      error: msg.includes("PROTECTED_COMPANY_CLASSIFICATION")
        ? "PROTECTED_COMPANY_CLASSIFICATION"
        : "RECONCILIATION_REJECTED",
      message: msg,
    });
  }
});

router.delete("/clear-all", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  try {
    if (req.body?.confirmClearAll !== true && req.query.confirmClearAll !== 'true') {
      res.status(400).json({
        error: "CONFIRMATION_REQUIRED",
        message: "confirmClearAll=true is required to clear the company registry."
      });
      return;
    }
    await CompanyManager.clearRegistry({
      confirmClearAll: true,
      authorizedByUserId: req.user!.id,
      authorizedByRole: req.activeCompany?.role || 'Company Owner',
      reason: String(req.body?.reason || 'Requested bulk registry clear'),
    });
    res.json({ success: true, message: "Synthetic company profiles have been cleared from the registry." });
  } catch (err: any) {
    const msg = String(err?.message || "Failed to clear companies registry");
    if (msg.includes("PROTECTED_COMPANY_CLASSIFICATION")) {
      res.status(403).json({
        error: "PROTECTED_COMPANY_CLASSIFICATION",
        message: msg,
      });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: msg });
  }
});

router.post("/purge-synthetic", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  try {
    const { companyId, confirmPurge, reason, allowWithPostedTransactions } = req.body || {};
    if (!companyId) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "companyId is required." });
      return;
    }
    const result = await CompanyManager.purgeSyntheticCompany(String(companyId), {
      authorizedByUserId: req.user!.id,
      authorizedByRole: req.activeCompany?.role || 'Company Owner',
      confirmPurge: Boolean(confirmPurge),
      reason: String(reason || 'Purged synthetic company'),
      allowWithPostedTransactions: Boolean(allowWithPostedTransactions),
    });

    await AuditService.log({
      req,
      companyId: req.activeCompany!.id,
      action: "PURGE_SYNTHETIC_COMPANY",
      entityType: "COMPANY",
      entityId: String(companyId),
      module: "COMPANY_MANAGEMENT",
      reason: String(reason || 'Authorized purge of synthetic company'),
      afterData: result,
    });

    res.json({
      success: true,
      ...result,
      message: `Synthetic company '${companyId}' (${result.classification}) purged from registry.`
    });
  } catch (err: any) {
    const msg = String(err?.message || 'Failed to purge synthetic company');
    const status =
      msg.includes('PROTECTED_') || msg.includes('PERMISSION_DENIED')
        ? 403
        : msg.includes('COMPANY_NOT_FOUND')
        ? 404
        : 400;
    res.status(status).json({
      error: msg.includes('PROTECTED_COMPANY_CLASSIFICATION')
        ? "PROTECTED_COMPANY_CLASSIFICATION"
        : msg.includes('PROTECTED_FINANCIAL_RECORDS')
        ? "PROTECTED_FINANCIAL_RECORDS"
        : "PURGE_REJECTED",
      message: msg,
    });
  }
});

router.post("/factory-reset", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  try {
    const { confirmFactoryReset, reason, scope } = req.body || {};
    const requestedScope: 'SYNTHETIC_ONLY' | 'CURRENT_COMPANY' =
      scope === 'CURRENT_COMPANY' ? 'CURRENT_COMPANY' : 'SYNTHETIC_ONLY';

    const resetResult = await CompanyManager.factoryResetAllCompanies({
      confirmFactoryReset: Boolean(confirmFactoryReset),
      authorizedByUserId: req.user!.id,
      scope: requestedScope,
      targetCompanyId: req.activeCompany!.id,
      reason: String(reason || `Tenant-safe reset (${requestedScope})`),
    });

    if (requestedScope === 'CURRENT_COMPANY') {
      res.clearCookie('token');
    }
    res.json({
      success: true,
      ...resetResult,
      message:
        requestedScope === 'CURRENT_COMPANY'
          ? `Workspace '${req.activeCompany!.id}' has been reset cleanly. Other company profiles remain untouched.`
          : `Purged ${resetResult.purgedCount} synthetic/stress-test company workspace(s). Protected production and pilot profiles remain preserved.`,
    });
  } catch (err: any) {
    const msg = String(err?.message || 'Failed to perform reset');
    const status = msg.includes('PROTECTED_COMPANY_CLASSIFICATION') ? 403 : 400;
    res.status(status).json({
      error: msg.includes('PROTECTED_COMPANY_CLASSIFICATION') ? "PROTECTED_COMPANY_CLASSIFICATION" : "FACTORY_RESET_REJECTED",
      message: msg,
    });
  }
});

router.delete("/:id", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = await verifyCompanyTenantAndRole(req, res, id, ['Company Owner']);
    if (!allowed) return;
    const confirmProtectedUnregister =
      req.query.confirmProtectedUnregister === 'true' || req.body?.confirmProtectedUnregister === true;
    await CompanyManager.deleteCompany(id, {
      confirmProtectedUnregister,
      authorizedByUserId: req.user!.id,
      reason: String(req.body?.reason || 'Single company unregistered via API'),
    });
    res.json({ success: true, message: "Company profile removed from list access." });
  } catch (err: any) {
    const msg = String(err?.message || "Failed to delete company");
    if (msg.includes("PROTECTED_COMPANY_CLASSIFICATION") || msg.includes("PROTECTED_PILOT_COMPANY")) {
      res.status(403).json({
        error: msg.includes("PROTECTED_PILOT_COMPANY") ? "PROTECTED_PILOT_COMPANY" : "PROTECTED_COMPANY_CLASSIFICATION",
        message: msg,
      });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: msg });
  }
});

router.post("/:id/unregister", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  try {
    const { id } = req.params;
    const targetManifest = await CompanyManager.getCompanyManifest(id).catch(() => null);
    const targetCls = inferCompanyClassification(
      id,
      targetManifest?.legalName,
      targetManifest?.isDemo,
      targetManifest?.classification
    );
    // Allow Company Owner to unregister synthetic preview from workspace switcher, or unregister their own tenant
    if (!isSyntheticCompanyClassification(targetCls)) {
      const allowed = await verifyCompanyTenantAndRole(req, res, id, ['Company Owner']);
      if (!allowed) return;
    }

    const confirmProtectedUnregister = req.body?.confirmProtectedUnregister === true;
    await CompanyLifecycleService.removeShortcutOnly(id, {
      confirmProtectedUnregister,
      authorizedByUserId: req.user!.id,
      reason: String(req.body?.reason || 'Company unregistered via authenticated governance action'),
    });

    try {
      const token = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
      if (token) {
        const parsed = parseToken(token);
        if (parsed && parsed.companyId === id) {
          res.clearCookie('token');
        }
      }
    } catch {}

    res.json({
      success: true,
      status: "UNREGISTERED",
      filesPreserved: true,
      message: `Company profile ${id} unregistered from local registry. All database files remain intact on disk.`,
    });
  } catch (err: any) {
    const msg = String(err?.message || "Failed to unregister company");
    if (msg.includes("PROTECTED_COMPANY_CLASSIFICATION") || msg.includes("PROTECTED_PILOT_COMPANY")) {
      res.status(403).json({
        error: msg.includes("PROTECTED_PILOT_COMPANY") ? "PROTECTED_PILOT_COMPANY" : "PROTECTED_COMPANY_CLASSIFICATION",
        message: msg,
      });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: msg });
  }
});

async function isAuthenticatedServerAdmin(req: any): Promise<boolean> {
  try {
    let token = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
    if (!token && req.headers.cookie) {
      const match = req.headers.cookie.match(/token=([^;]+)/);
      if (match) token = match[1];
    }
    if (!token) return false;
    const parsed = parseToken(token);
    if (!parsed) return false;

    const hashedSessionId = hashToken(parsed.sessionId);
    const companyDb = dbContext.getStore() || (await CompanyManager.getCompanyDb(parsed.companyId).catch(() => null));
    if (!companyDb) return false;

    return await dbContext.run(companyDb, async () => {
      const session = await db.select().from(sessions).where(eq(sessions.id, hashedSessionId)).get();
      if (!session || new Date(session.expiresAt) < new Date()) return false;
      const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
      if (!user || user.status !== "ACTIVE") return false;
      const membership = await db
        .select()
        .from(companyUsers)
        .where(and(eq(companyUsers.userId, user.id), eq(companyUsers.companyId, parsed.companyId)))
        .get();
      if (!membership) return false;
      const roleRow = membership.roleId
        ? await db.select().from(roles).where(eq(roles.id, membership.roleId)).get()
        : null;
      const normalized = normalizeRole(roleRow?.name || roleRow?.code || "");
      return normalized === "Company Owner" || normalized === "Company Administrator";
    });
  } catch {
    return false;
  }
}

const handleOpenCompanyTarget = async (req: any, res: any) => {
  try {
    const isLoopback = isLocalLoopbackRequest(req);
    if (!isLoopback) {
      // Centralized Server Mode: remote browser clients cannot probe arbitrary server paths
      // unless authenticated as a Server Administrator (Company Owner / Company Administrator).
      const isServerAdmin = await isAuthenticatedServerAdmin(req);
      if (!isServerAdmin) {
        res.status(403).json({
          error: "REMOTE_FILESYSTEM_ACCESS_DENIED",
          message:
            "Remote browser clients cannot open server filesystem paths directly. Select an authorized registered company or use Portable Package Import / Backup Restore.",
        });
        return;
      }
    }

    const targetPath = req.body?.folderPath || req.body?.filePath || req.body?.path;
    const expectedCompanyId = req.body?.expectedCompanyId;
    const conflictResolution =
      req.body?.conflictResolution === 'SWITCH_REGISTRY_TO_SELECTED'
        ? 'SWITCH_REGISTRY_TO_SELECTED'
        : 'FAIL_ON_CONFLICT';
    const requireAttachments = Boolean(req.body?.requireAttachments);

    if (!targetPath || typeof targetPath !== 'string' || !targetPath.trim()) {
      res.status(400).json({ error: "BAD_REQUEST", message: "Missing folderPath or database filePath" });
      return;
    }
    const safePath = assertAllowedWorkspacePath(targetPath);
    const manifest = await CompanyManager.browseAndRegisterCompanyFolder(safePath, {
      expectedCompanyId: typeof expectedCompanyId === 'string' && expectedCompanyId.trim() ? expectedCompanyId.trim() : undefined,
      operation: 'OPENED',
      conflictResolution,
      requireAttachments,
    });

    // Ensure portable company folder contains its standalone Windows launcher executable
    if (manifest?.location && manifest?.id) {
      await CompanyLauncherGenerator.generateLauncher({
        companyDirectory: manifest.location,
        companyId: manifest.id,
        legalName: manifest.legalName || manifest.id,
      }).catch((e) => console.warn('Company launcher generation warning:', e));
    }

    res.json({
      success: true,
      company: sanitizeCompanyForClient(manifest, { includePhysicalPaths: isLoopback }),
      registrationAction: manifest.registrationAction || 'REGISTERED_NEW',
      attachmentAudit: manifest.attachmentAudit,
      relocatedDocumentsUpdated: manifest.relocatedDocumentsUpdated || 0,
      message:
        manifest.registrationAction === 'REUSED_EXISTING'
          ? `Company profile '${manifest.legalName}' verified — reusing existing registry entry.`
          : manifest.registrationAction === 'RELOCATED'
            ? `Relocated company profile '${manifest.legalName}' verified and registry updated.`
            : manifest.registrationAction === 'SWITCHED_REGISTRY'
              ? `Company profile '${manifest.legalName}' switched to selected portable folder.`
              : `Company profile '${manifest.legalName}' verified and registered successfully.`,
    });
  } catch (err: any) {
    const msg = String(err?.message || "Failed to open company database");
    const code = err?.code || (msg.includes(':') ? msg.split(':')[0].trim() : 'INVALID_COMPANY_FOLDER');
    if (code === 'DUPLICATE_COMPANY_IDENTITY_CONFLICT') {
      const isLoopback = isLocalLoopbackRequest(req);
      const conflict = err?.conflict
        ? {
            companyId: err.conflict.companyId,
            existingLegalName: err.conflict.existingLegalName,
            existingLocation: isLoopback ? err.conflict.existingLocation : '[Server Managed Location]',
            selectedLocation: isLoopback ? err.conflict.selectedLocation : '[Selected Location]',
            status: err.conflict.status,
          }
        : undefined;
      res.status(409).json({
        error: 'DUPLICATE_COMPANY_IDENTITY_CONFLICT',
        message: msg,
        conflict,
      });
      return;
    }
    const status = code === 'DATABASE_NOT_FOUND' ? 404 : 400;
    console.error("Open existing company error:", msg);
    res.status(status).json({ error: code, message: msg });
  }
};

router.post("/open-folder", handleOpenCompanyTarget);
router.post("/open-database", handleOpenCompanyTarget);

// Non-mutating portable company folder discovery (Localhost / Server Administrator only)
router.post("/discover-portable", async (req, res) => {
  try {
    const isLoopback = isLocalLoopbackRequest(req);
    if (!isLoopback) {
      const isServerAdmin = await isAuthenticatedServerAdmin(req);
      if (!isServerAdmin) {
        res.status(403).json({
          error: "REMOTE_FILESYSTEM_ACCESS_DENIED",
          message: "Server directory discovery requires Server Administrator privileges.",
        });
        return;
      }
    }

    const baseDirRaw = req.body?.directoryPath || req.body?.folderPath || paths.getCompaniesRootDir();
    const safeBaseDir = assertAllowedWorkspacePath(String(baseDirRaw));
    const registeredCompanies = await CompanyManager.listCompanies({ includeSynthetic: true });

    const candidateDirs: string[] = [];
    const baseEntries = await fs.readdir(safeBaseDir, { withFileTypes: true });
    const hasRootDb = baseEntries.some(
      (e) => e.isFile() && ['database.lai', 'company.lai', 'database.sqlite'].includes(e.name.toLowerCase())
    );
    if (hasRootDb) {
      candidateDirs.push(safeBaseDir);
    }
    for (const entry of baseEntries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'quarantine' && entry.name !== 'temp') {
        candidateDirs.push(path.join(safeBaseDir, entry.name));
      }
    }

    const discovered: any[] = [];
    for (const dir of candidateDirs.slice(0, 50)) {
      const inspection = await CompanyLifecycleService.inspectDatabaseTarget(dir);
      if (!inspection.valid && inspection.errorCode === 'DATABASE_NOT_FOUND') {
        continue;
      }
      const dup =
        inspection.valid && inspection.companyId
          ? assessCompanyIdentityDuplicate({
              companyId: inspection.companyId,
              selectedDirectory: inspection.companyDirectory,
              registeredCompanies,
            })
          : null;
      discovered.push({
        folderName: path.basename(dir),
        directoryPath: isLoopback ? dir.replace(/\\/g, '/') : undefined,
        valid: inspection.valid,
        errorCode: inspection.errorCode || null,
        message: inspection.message,
        companyId: inspection.companyId || null,
        legalName: inspection.legalName || null,
        schemaVersion: inspection.versionMetadata.schemaVersion,
        containerFormat: inspection.versionMetadata.containerFormat,
        attachmentAudit: inspection.attachmentAudit || null,
        registryStatus: dup ? dup.status : 'INVALID',
      });
    }

    res.json({
      success: true,
      scannedCount: candidateDirs.length,
      discovered,
    });
  } catch (err: any) {
    res.status(400).json({
      error: "DISCOVERY_FAILED",
      message: err?.message || "Unable to scan folder for portable company databases.",
    });
  }
});

// Centralized Server Mode: secure portable company package upload & validation
// Remote browser clients upload portable folder files; server stages, validates, checks duplicates,
// installs under central server storage, and registers without exposing host filesystem paths.
router.post("/import-portable", async (req, res) => {
  let stagingDir: string | null = null;
  let installedDestDir: string | null = null;
  try {
    const isLoopback = isLocalLoopbackRequest(req);
    const { files, conflictResolution, requireAttachments } = req.body || {};

    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({
        error: "BAD_REQUEST",
        message: "Portable package import requires an array of folder files (including database.lai).",
      });
      return;
    }

    const staged = await stageUploadedPortablePackage(files);
    stagingDir = staged.stagingDir;

    const inspection = await CompanyLifecycleService.inspectDatabaseTarget(stagingDir, {
      requireAttachments: Boolean(requireAttachments),
    });

    if (!inspection.valid || !inspection.companyId) {
      res.status(400).json({
        error: inspection.errorCode || 'INVALID_PORTABLE_PACKAGE',
        message: inspection.message,
        attachmentAudit: inspection.attachmentAudit,
      });
      return;
    }

    const companyId = inspection.companyId;
    const companiesRoot = path.resolve(paths.getCompaniesRootDir());
    const targetCompanyDir = path.resolve(companiesRoot, companyId.replace(/[^a-zA-Z0-9._-]/g, '_'));
    const rel = path.relative(companiesRoot, targetCompanyDir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.status(400).json({ error: "PATH_TRAVERSAL_BLOCKED", message: "Invalid company identifier for server storage." });
      return;
    }

    const registeredCompanies = await CompanyManager.listCompanies({ includeSynthetic: true });
    const existingEntry = registeredCompanies.find((c) => c.id === companyId);

    if (existingEntry && conflictResolution !== 'SWITCH_REGISTRY_TO_SELECTED') {
      res.status(409).json({
        error: 'DUPLICATE_COMPANY_IDENTITY_CONFLICT',
        message: `Company '${existingEntry.legalName}' (${companyId}) is already registered on this server. Select it from Saved Workspaces or explicitly confirm replacing its server package.`,
        conflict: {
          companyId,
          existingLegalName: existingEntry.legalName,
          existingLocation: isLoopback ? existingEntry.location : '[Server Managed Storage]',
          selectedLocation: '[Uploaded Portable Package]',
          status: 'DUPLICATE_IDENTITY_CONFLICT',
        },
      });
      return;
    }

    // Close existing DB handle if replacing on explicit confirmation
    await CompanyManager.closeCompanyDb(companyId).catch(() => {});

    // Install validated staged package into isolated server-managed directory
    if (existingEntry && conflictResolution === 'SWITCH_REGISTRY_TO_SELECTED') {
      const targetDirToUse = existingEntry.location || targetCompanyDir;
      await fs.rm(targetDirToUse, { recursive: true, force: true }).catch(() => {});
      await copyDirectoryRecursive(stagingDir, targetDirToUse);
      installedDestDir = targetDirToUse;
    } else {
      if (fsSync.existsSync(targetCompanyDir)) {
        const suffix = crypto.randomBytes(3).toString('hex');
        installedDestDir = `${targetCompanyDir}_${suffix}`;
      } else {
        installedDestDir = targetCompanyDir;
      }
      await copyDirectoryRecursive(stagingDir, installedDestDir);
    }

    const manifest = await CompanyManager.browseAndRegisterCompanyFolder(installedDestDir, {
      operation: 'OPENED',
      conflictResolution: 'SWITCH_REGISTRY_TO_SELECTED',
      requireAttachments: Boolean(requireAttachments),
    });

    res.json({
      success: true,
      company: sanitizeCompanyForClient(manifest, { includePhysicalPaths: isLoopback }),
      registrationAction: existingEntry ? 'SWITCHED_REGISTRY' : 'REGISTERED_NEW',
      attachmentAudit: manifest.attachmentAudit,
      importedFileCount: staged.fileCount,
      message: `Portable company '${manifest.legalName}' validated and imported under central server management.`,
    });
  } catch (err: any) {
    const msg = String(err?.message || "Failed to import portable company package.");
    const code = msg.includes(':') ? msg.split(':')[0].trim() : 'PORTABLE_IMPORT_FAILED';
    res.status(code === 'DUPLICATE_COMPANY_IDENTITY_CONFLICT' ? 409 : 400).json({
      error: code,
      message: msg,
    });
  } finally {
    if (stagingDir) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

// Inspect a clean starter or downloaded database package strictly by content (never trusting filename)
router.post("/inspect-starter", async (req, res) => {
  try {
    const targetPath = req.body?.path || req.body?.filePath || req.body?.folderPath;
    if (!targetPath || typeof targetPath !== 'string' || !targetPath.trim()) {
      res.status(400).json({ error: "BAD_REQUEST", message: "Missing filePath or path for starter inspection" });
      return;
    }
    const safePath = assertAllowedWorkspacePath(targetPath);
    const inspection = await CompanyLifecycleService.inspectCleanStarterDatabase(safePath);
    if (!inspection.valid || !inspection.isCleanZeroData) {
      res.status(400).json({
        error: inspection.errorCode || 'STARTER_VALIDATION_FAILED',
        message: inspection.message,
        inspection,
      });
      return;
    }
    res.json({
      success: true,
      ...inspection,
    });
  } catch (err: any) {
    const msg = String(err?.message || "Failed to inspect starter package");
    const code = msg.includes(':') ? msg.split(':')[0].trim() : 'STARTER_INSPECTION_FAILED';
    res.status(400).json({ error: code, message: msg });
  }
});

// Authenticated: Get current company details
router.get("/current/details", requireAuth, requireMinRole('Read-only User'), async (req, res) => {
  const company = await db
    .select()
    .from(companies)
    .where(eq(companies.id, req.activeCompany!.id))
    .get();

  if (!company) {
    res.status(404).json({ error: "NOT_FOUND", message: "Company profile not found" });
    return;
  }

  res.json({
    ...company,
    currentUserRole: req.activeCompany!.role
  });
});

// Authenticated: Get list of members and their assigned roles for current active company
router.get("/current/members", requireAuth, requireMinRole('Read-only User'), async (req, res) => {
  const companyId = req.activeCompany!.id;

  const members = await db
    .select({
      membershipId: companyUsers.id,
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      status: users.status,
      createdAt: companyUsers.createdAt
    })
    .from(companyUsers)
    .innerJoin(users, eq(companyUsers.userId, users.id))
    .where(eq(companyUsers.companyId, companyId));

  const formattedMembers = [];
  for (const m of members) {
    const { roleRecords, normalizedRoles, primaryRole } = await RbacService.getMemberRoles(m.membershipId);
    const effectivePermissions = await RbacService.evaluateEffectivePermissions(m.membershipId);
    const overrides = await RbacService.getExplicitOverrides(m.membershipId);

    formattedMembers.push({
      membershipId: m.membershipId,
      userId: m.userId,
      displayName: m.displayName,
      email: m.email,
      status: m.status,
      role: primaryRole,
      roleName: primaryRole,
      roles: normalizedRoles,
      roleRecords,
      effectivePermissions,
      overrides,
      createdAt: m.createdAt
    });
  }

  res.json(formattedMembers);
});

// Add a role to a member (Multi-Role assignment)
router.post("/current/members/:id/roles", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!role) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Role is required" });
    return;
  }

  const companyId = req.activeCompany!.id;
  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  if (role === 'Company Owner' && !requesterRoles.includes('Company Owner')) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Only Company Owners can assign the Company Owner role." });
    return;
  }

  try {
    const result = await RbacService.assignRoleToMember(req, membership.id, role);
    res.json(result);
  } catch (err: any) {
    if (err.message && err.message.includes("DUPLICATE_ROLE")) {
      res.status(400).json({ error: "DUPLICATE_ROLE", message: err.message });
      return;
    }
    res.status(400).json({ error: "SOD_RESTRICTION_ERROR", message: err.message });
  }
});

// Remove a role from a member
router.delete("/current/members/:id/roles/:roleName", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { id, roleName } = req.params;
  const companyId = req.activeCompany!.id;

  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  try {
    const result = await RbacService.removeRoleFromMember(req, membership.id, decodeURIComponent(roleName));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: "RBAC_ERROR", message: err.message });
  }
});

// Admin Only: Legacy/Bulk Update member roles
router.put("/current/members/:userId/role", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { userId } = req.params;
  const { targetRole, roles: inputRoles } = req.body as { targetRole?: LedgerRole; roles?: LedgerRole[] };

  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, userId))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "User is not a member of this company" });
    return;
  }

  const rolesToAssign: LedgerRole[] = Array.isArray(inputRoles) && inputRoles.length > 0 
    ? inputRoles 
    : (targetRole ? [targetRole] : ['Read-only User']);

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  if (rolesToAssign.includes('Company Owner') && !requesterRoles.includes('Company Owner')) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Only Company Owners can assign the Company Owner role." });
    return;
  }

  try {
    const result = await RbacService.setMemberRoles(req, membership.id, rolesToAssign);
    res.json({ message: "Roles updated successfully", roles: result.assignedRoles || result.normalizedRoles, primaryRole: result.primaryRole });
  } catch (err: any) {
    res.status(400).json({ error: "RBAC_ERROR", message: err.message });
  }
});

// Admin/Owner: Edit member details (Name, Email, Role, Password, Status, Delete)
router.put("/current/members/:id", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  const parseResult = updateUserSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errIssues = (parseResult.error as any).issues || (parseResult.error as any).errors || [];
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: Array.isArray(errIssues) ? errIssues.map((e: any) => e.message).join(", ") : "Validation failed",
      details: errIssues
    });
    return;
  }

  const { displayName, email, role, roles: inputRoles, password, status, disableAccount, deleteAccount, requirePasswordChange } = parseResult.data;

  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  const targetUser = await db.select().from(users).where(eq(users.id, membership.userId)).get();
  if (!targetUser) {
    res.status(404).json({ error: "NOT_FOUND", message: "User record not found" });
    return;
  }

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  const isRequesterOwner = requesterRoles.includes('Company Owner');
  const { primaryRole } = await RbacService.getMemberRoles(membership.id);

  if (primaryRole === 'Company Owner' && !isRequesterOwner) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Only Company Owners can modify other Company Owners." });
    return;
  }

  // Handle DELETE ACCOUNT FLAG
  if (deleteAccount === true) {
    if (membership.userId === req.user!.id) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot remove your own active account from the company." });
      return;
    }
    if (primaryRole === 'Company Owner') {
      const allMembers = await db.select().from(companyUsers).where(eq(companyUsers.companyId, companyId));
      let ownerCount = 0;
      for (const m of allMembers) {
        const { primaryRole: r } = await RbacService.getMemberRoles(m.id);
        if (r === 'Company Owner') ownerCount++;
      }
      if (ownerCount <= 1) {
        res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot remove the sole Company Owner. Assign another owner first." });
        return;
      }
    }

    await db.delete(sessions).where(eq(sessions.userId, membership.userId));
    await db
      .update(companyUserRoles)
      .set({ assignmentStatus: 'REVOKED' })
      .where(eq(companyUserRoles.companyUserId, membership.id));
    await db
      .update(companyUsers)
      .set({
        status: 'REMOVED',
        membershipStatus: 'REMOVED',
        removedAt: new Date(),
        removedBy: req.user!.id,
        removalReason: 'Account removed by company administrator',
        updatedAt: new Date(),
      })
      .where(eq(companyUsers.id, membership.id));

    await AuditService.log({
      req,
      companyId,
      action: "USER_DELETED",
      entityType: "USER",
      entityId: membership.userId,
      module: "AUTH",
      metadata: { targetUserId: membership.userId, displayName: targetUser.displayName, email: targetUser.email, removedRole: primaryRole }
    });

    res.json({ message: "Member account successfully removed from the company." });
    return;
  }

  try {
    const userUpdates: Partial<typeof users.$inferInsert> = {};
    const membershipUpdates: Partial<typeof companyUsers.$inferInsert> = {};

    if (displayName && displayName.trim()) userUpdates.displayName = displayName.trim();
    if (email && email.trim()) userUpdates.email = email.trim().toLowerCase();

    let targetStatus = status;
    if (disableAccount === true) {
      targetStatus = 'DISABLED';
    }

    if (targetStatus && ['ACTIVE', 'DISABLED'].includes(targetStatus)) {
      if (membership.userId === req.user!.id && targetStatus === 'DISABLED') {
        res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot disable your own active account." });
        return;
      }
      userUpdates.status = targetStatus;
      membershipUpdates.status = targetStatus;

      if (targetStatus === 'DISABLED') {
        await db.delete(sessions).where(eq(sessions.userId, membership.userId));
      }
    }

    if (password && password.trim()) {
      userUpdates.passwordHash = await bcrypt.hash(password.trim(), 10);
      userUpdates.requirePasswordChange = requirePasswordChange ?? true;
      userUpdates.failedLoginAttempts = 0;
      userUpdates.lockedUntil = null;
    }

    if (Object.keys(userUpdates).length > 0) {
      await db.update(users).set(userUpdates).where(eq(users.id, membership.userId));
    }
    if (Object.keys(membershipUpdates).length > 0) {
      await db.update(companyUsers).set(membershipUpdates).where(eq(companyUsers.id, membership.id));
    }

    const targetRoles: LedgerRole[] = Array.isArray(inputRoles) && inputRoles.length > 0 
      ? (inputRoles as LedgerRole[])
      : (role ? [role as LedgerRole] : []);

    if (targetRoles.length > 0) {
      if (targetRoles.includes('Company Owner') && !isRequesterOwner) {
        res.status(403).json({ error: "PERMISSION_DENIED", message: "Only Company Owners can assign the Company Owner role." });
        return;
      }
      await RbacService.setMemberRoles(req, membership.id, targetRoles);
    }

    let auditAction = "USER_UPDATED";
    if (targetStatus === 'DISABLED' && targetUser.status !== 'DISABLED') {
      auditAction = "USER_DISABLED";
    } else if (targetStatus === 'ACTIVE' && targetUser.status === 'DISABLED') {
      auditAction = "USER_ACTIVATED";
    }

    await AuditService.log({
      req,
      companyId,
      action: auditAction,
      entityType: "USER",
      entityId: membership.userId,
      module: "AUTH",
      beforeData: { displayName: targetUser.displayName, email: targetUser.email, status: targetUser.status, role: primaryRole },
      afterData: { displayName: userUpdates.displayName || targetUser.displayName, email: userUpdates.email || targetUser.email, status: targetStatus || targetUser.status, role: targetRoles[0] || primaryRole },
      metadata: { displayName: userUpdates.displayName || targetUser.displayName, email: userUpdates.email || targetUser.email, role: targetRoles[0] || primaryRole, status: targetStatus || targetUser.status }
    });

    const updatedRoles = await RbacService.getMemberRoles(membership.id);
    const updatedUser = await db.select().from(users).where(eq(users.id, membership.userId)).get();

    res.json({
      message: "Member updated successfully",
      member: {
        membershipId: membership.id,
        userId: membership.userId,
        displayName: updatedUser?.displayName,
        email: updatedUser?.email,
        status: updatedUser?.status,
        role: updatedRoles.primaryRole,
        roles: updatedRoles.normalizedRoles
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: "UPDATE_ERROR", message: err.message || "Failed to update member" });
  }
});

// Admin/Owner: Update member status (Active / Disabled toggle)
router.put("/current/members/:id/status", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  const parseResult = updateMemberStatusSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errIssues = (parseResult.error as any).issues || (parseResult.error as any).errors || [];
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: Array.isArray(errIssues) ? errIssues.map((e: any) => e.message).join(", ") : "Validation failed",
      details: errIssues
    });
    return;
  }

  const { status, reason } = parseResult.data;

  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  const targetUser = await db.select().from(users).where(eq(users.id, membership.userId)).get();
  if (!targetUser) {
    res.status(404).json({ error: "NOT_FOUND", message: "User record not found" });
    return;
  }

  if (membership.userId === req.user!.id && status === 'DISABLED') {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot disable your own active account." });
    return;
  }

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  const { primaryRole } = await RbacService.getMemberRoles(membership.id);
  if (primaryRole === 'Company Owner' && !requesterRoles.includes('Company Owner')) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Company Administrators cannot disable Company Owners." });
    return;
  }

  await db.update(users).set({ status }).where(eq(users.id, membership.userId));
  await db.update(companyUsers).set({ status }).where(eq(companyUsers.id, membership.id));

  if (status === 'DISABLED') {
    await db.delete(sessions).where(eq(sessions.userId, membership.userId));
  }

  const actionType = status === 'DISABLED' ? 'USER_DISABLED' : 'USER_ACTIVATED';

  await AuditService.log({
    req,
    companyId,
    action: actionType,
    entityType: "USER",
    entityId: membership.userId,
    module: "AUTH",
    beforeData: { status: targetUser.status },
    afterData: { status },
    metadata: { status, reason: reason || `Account ${status === 'ACTIVE' ? 'activated' : 'disabled'} by admin`, displayName: targetUser.displayName, email: targetUser.email }
  });

  res.json({ message: `Member status successfully updated to ${status}` });
});

// Admin/Owner: Delete / Remove member from company
router.delete("/current/members/:id", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  const targetUser = await db.select().from(users).where(eq(users.id, membership.userId)).get();

  if (membership.userId === req.user!.id) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot remove your own active account from the company." });
    return;
  }

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  const isRequesterOwner = requesterRoles.includes('Company Owner');
  const { primaryRole } = await RbacService.getMemberRoles(membership.id);

  if (primaryRole === 'Company Owner' && !isRequesterOwner) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Company Administrators cannot remove Company Owners." });
    return;
  }

  // Count active owners
  if (primaryRole === 'Company Owner') {
    const allMembers = await db.select().from(companyUsers).where(eq(companyUsers.companyId, companyId));
    let ownerCount = 0;
    for (const m of allMembers) {
      const { primaryRole: r } = await RbacService.getMemberRoles(m.id);
      if (r === 'Company Owner') ownerCount++;
    }
    if (ownerCount <= 1) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot remove the sole Company Owner. Assign another owner first." });
      return;
    }
  }

  // Clean up sessions, roles and overrides for this company user
  await db.delete(sessions).where(eq(sessions.userId, membership.userId));
  await db.delete(companyUserRoles).where(eq(companyUserRoles.companyUserId, membership.id));
  await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.companyUserId, membership.id));
  await db.delete(companyUsers).where(eq(companyUsers.id, membership.id));

  await AuditService.log({
    req,
    companyId,
    action: "USER_DELETED",
    entityType: "USER",
    entityId: membership.userId,
    module: "AUTH",
    beforeData: { displayName: targetUser?.displayName, email: targetUser?.email, role: primaryRole },
    metadata: { targetUserId: membership.userId, displayName: targetUser?.displayName, email: targetUser?.email, removedRole: primaryRole }
  });

  res.json({ message: "Member account successfully removed from the company." });
});

// Set explicit permission override (ALLOW or DENY)
router.post("/current/members/:id/permission-overrides", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { id } = req.params;
  const { permissionCode, effect, reason } = req.body;

  if (!permissionCode || !['ALLOW', 'DENY'].includes(effect)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "permissionCode and effect ('ALLOW' | 'DENY') are required." });
    return;
  }

  const companyId = req.activeCompany!.id;
  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found" });
    return;
  }

  const result = await RbacService.setExplicitOverride(req, membership.id, permissionCode, effect, reason);
  res.json(result);
});

// Delete explicit permission override
router.delete("/current/members/:id/permission-overrides/:permissionCode", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { id, permissionCode } = req.params;
  const companyId = req.activeCompany!.id;

  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found" });
    return;
  }

  const result = await RbacService.removeExplicitOverride(req, membership.id, decodeURIComponent(permissionCode));
  res.json(result);
});

// Admin Only: Update company settings
router.put("/current/settings", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { 
    legalName, tradeName, tin, address, branchCode, contactPerson, contactEmail, contactPhone,
    industry, fiscalYear, fiscalYearStartMonth, currency, accountingMethod, taxpayerClassification,
    taxpayerType, vatStatus, rdoCode, birRegistrationNo, birDateRegistered, documentLocationPath, backupLocationPath
  } = req.body;

  try {
    const beforeCompany = await db.select().from(companies).where(eq(companies.id, companyId)).get();

    // Note: companyId (id) is explicitly immutable and read-only!
    await db
      .update(companies)
      .set({
        ...(legalName && { legalName }),
        ...(tradeName && { tradeName }),
        ...(tin && { tin }),
        ...(address && { address }),
        ...(branchCode && { branchCode }),
        ...(contactPerson && { contactPerson }),
        ...(contactEmail && { contactEmail }),
        ...(contactPhone && { contactPhone }),
        ...(industry && { industry }),
        ...(fiscalYear && { fiscalYear: Number(fiscalYear) }),
        ...(fiscalYearStartMonth && { fiscalYearStartMonth: Number(fiscalYearStartMonth) }),
        ...(currency && { currency }),
        ...(accountingMethod && { accountingMethod }),
        ...(taxpayerClassification && { taxpayerClassification }),
        ...(taxpayerType && { taxpayerType }),
        ...(vatStatus && { vatStatus }),
        ...(rdoCode && { rdoCode }),
        ...(birRegistrationNo && { birRegistrationNo }),
        ...(birDateRegistered && { birDateRegistered }),
        ...(documentLocationPath && { documentLocationPath }),
        ...(backupLocationPath && { backupLocationPath }),
        updatedAt: new Date()
      })
      .where(eq(companies.id, companyId));

    // Also update company tax profile if present
    const existingTaxProfile = await db.select().from(companyTaxProfiles).where(eq(companyTaxProfiles.companyId, companyId)).get();
    if (existingTaxProfile) {
      let regInfo: Record<string, any> = {};
      try {
        if (existingTaxProfile.registrationInformation) {
          regInfo = JSON.parse(existingTaxProfile.registrationInformation);
        }
      } catch {}
      if (legalName) regInfo.registeredName = legalName;
      if (tradeName) regInfo.tradeName = tradeName;
      if (accountingMethod) regInfo.taxMethod = accountingMethod;

      await db.update(companyTaxProfiles)
        .set({
          ...(tin && { tin }),
          ...(rdoCode && { rdo: rdoCode }),
          ...(taxpayerClassification && { taxpayerClassification }),
          ...(vatStatus && { vatStatus }),
          registrationInformation: JSON.stringify(regInfo),
          updatedAt: new Date()
        })
        .where(eq(companyTaxProfiles.id, existingTaxProfile.id));
    }

    if (documentLocationPath || backupLocationPath || legalName) {
      const updates: any = {};
      if (documentLocationPath) {
        await CompanyManager.validateStorageIsolation(companyId, documentLocationPath);
        updates.documentLocationPath = documentLocationPath;
      }
      if (backupLocationPath) updates.backupLocation = backupLocationPath;
      if (legalName) updates.legalName = legalName;
      if (Object.keys(updates).length > 0) {
        await CompanyManager.updateCompanyManifest(companyId, updates);
      }
    }

    const changedFields: string[] = [];
    const afterData: Record<string, any> = {
      legalName: legalName || beforeCompany?.legalName,
      tradeName: tradeName || beforeCompany?.tradeName,
      tin: tin || beforeCompany?.tin,
      address: address || beforeCompany?.address,
      branchCode: branchCode || beforeCompany?.branchCode,
      contactPerson: contactPerson || beforeCompany?.contactPerson,
      contactEmail: contactEmail || beforeCompany?.contactEmail,
      contactPhone: contactPhone || beforeCompany?.contactPhone,
      industry: industry || beforeCompany?.industry,
      taxpayerClassification: taxpayerClassification || beforeCompany?.taxpayerClassification,
      vatStatus: vatStatus || beforeCompany?.vatStatus,
      rdoCode: rdoCode || beforeCompany?.rdoCode,
      birRegistrationNo: birRegistrationNo || beforeCompany?.birRegistrationNo,
      documentLocationPath: documentLocationPath || beforeCompany?.documentLocationPath,
      backupLocationPath: backupLocationPath || beforeCompany?.backupLocationPath,
    };

    if (beforeCompany) {
      for (const [k, v] of Object.entries(afterData)) {
        if (v !== undefined && (beforeCompany as any)[k] !== v) {
          changedFields.push(k);
        }
      }
    }

    await AuditService.log({
      req,
      companyId,
      action: "COMPANY_UPDATED",
      entityType: "COMPANY",
      entityId: companyId,
      entityName: legalName || beforeCompany?.legalName || (req.activeCompany as any)?.legalName || companyId,
      module: "COMPANY",
      beforeData: beforeCompany,
      afterData,
      changedFields,
      metadata: { legalName, tradeName, tin, changedFields }
    });

    res.json({ message: "Company settings updated successfully", companyId });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message || "Failed to update company settings" });
  }
});

// Public: Get a single profile info for login screen (strictly blocks synthetic companies unless administrator opt-in is verified)
router.get("/:id", async (req, res) => {
  const defaultCompanies = await CompanyManager.listCompanies();
  const resolvedId = resolveCompanyIdFromParam(req.params.id, defaultCompanies);
  let company = defaultCompanies.find(c => c.id === resolvedId || c.id === req.params.id);

  if (!company) {
    const allCompanies = await CompanyManager.listCompanies({ includeSynthetic: true });
    const resolvedSyntheticId = resolveCompanyIdFromParam(req.params.id, allCompanies);
    const syntheticMatch = allCompanies.find(c => c.id === resolvedSyntheticId || c.id === req.params.id);
    if (!syntheticMatch) {
      res.status(404).json({ error: "NOT_FOUND", message: "Company profile not found" });
      return;
    }

    const optInRequested =
      req.query.includeTestCompanies === 'true' ||
      req.query.includeSynthetic === 'true' ||
      String(req.headers['x-allow-synthetic-company'] || '').toLowerCase() === 'true';

    if (!optInRequested) {
      res.status(403).json({
        error: "SYNTHETIC_COMPANY_ISOLATED",
        message: `Company '${req.params.id}' is classified as '${syntheticMatch.classification}' and is isolated from normal operational access.`
      });
      return;
    }

    const authCheck = await verifySyntheticAdminAccess(req, res, req.params.id);
    if (!authCheck.authorized) {
      return;
    }
    company = syntheticMatch;
  }

  res.json({
    id: company.id,
    legalName: company.legalName,
    tradeName: company.legalName,
    classification: company.classification,
    isDemo: company.isDemo
  });
});

const recoveryRateLimiter = new Map<string, { attempts: number; lockedUntil: number }>();

// First-time Setup Recovery: Provision Administrator if no active admin exists in the company database
router.post("/:id/setup-first-admin", async (req, res) => {
  const { id } = req.params;
  const { email, password, displayName, recoveryKey } = req.body;

  // 1. Rate Limiting Check
  const now = Date.now();
  const rateInfo = recoveryRateLimiter.get(id) || { attempts: 0, lockedUntil: 0 };
  if (rateInfo.lockedUntil > now) {
    const waitSecs = Math.ceil((rateInfo.lockedUntil - now) / 1000);
    res.status(429).json({
      error: "TOO_MANY_ATTEMPTS",
      message: `Too many recovery setup attempts for this company profile. Please wait ${waitSecs} seconds before trying again.`
    });
    return;
  }

  if (!email || !password || typeof password !== 'string' || password.trim().length < 6) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "A valid email and explicit password (minimum 6 characters) are required for administrator setup." });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // 2. Database Integrity Verification
    const consistencyCheck = await CompanyManager.verifySnapshotConsistency(id);
    if (!consistencyCheck.valid && !consistencyCheck.details.includes('not found')) {
      res.status(503).json({
        error: "DATABASE_INTEGRITY_FAILURE",
        message: `Company database snapshot failed integrity verification: ${consistencyCheck.details}`
      });
      return;
    }

    // 3. Manifest Recovery Challenge Check
    const manifest = await CompanyManager.getCompanyManifest(id);
    if (manifest?.recoveryUsedAt) {
      res.status(400).json({
        error: "RECOVERY_ALREADY_USED",
        message: "First-administrator recovery setup has already been completed for this company profile."
      });
      return;
    }

    if (manifest?.recoveryKey && manifest.recoveryKey !== recoveryKey) {
      rateInfo.attempts += 1;
      if (rateInfo.attempts >= 5) {
        rateInfo.lockedUntil = now + 15 * 60 * 1000; // 15 min lock
      }
      recoveryRateLimiter.set(id, rateInfo);
      res.status(403).json({
        error: "INVALID_RECOVERY_KEY",
        message: "The provided recovery authorization key is invalid."
      });
      return;
    }

    const companyDb = await CompanyManager.getCompanyDb(id, { allowInitializeNew: true });
    
    await dbContext.run(companyDb, async () => {
      // 4. Verify existing active users AND active admin roles in company database
      const activeUsers = await db.select().from(users).where(eq(users.status, "ACTIVE")).all();
      const adminRoleRecords = await db.select().from(roles).where(
        or(eq(roles.name, "Company Owner"), eq(roles.name, "Company Administrator"), eq(roles.code, "COMPANY_OWNER"))!
      ).all();
      const adminRoleIds = adminRoleRecords.map(r => r.id);

      let hasActiveAdmin = false;
      if (adminRoleIds.length > 0) {
        const activeAdminUsers = await db.select()
          .from(companyUsers)
          .where(and(
            eq(companyUsers.status, "ACTIVE"),
            inArray(companyUsers.roleId, adminRoleIds)
          ))
          .all();
        if (activeAdminUsers.length > 0) hasActiveAdmin = true;
      }

      if (activeUsers.length > 0 && hasActiveAdmin) {
        res.status(400).json({ 
          error: "SETUP_NOT_ALLOWED", 
          message: "This company profile already has active administrator accounts. Standard authentication is required." 
        });
        return;
      }

      const passwordHash = await bcrypt.hash(password.trim(), 10);
      const newUserId = crypto.randomUUID();

      await db.insert(users).values({
        id: newUserId,
        email: normalizedEmail,
        passwordHash,
        displayName: displayName?.trim() || "Company Administrator",
        status: "ACTIVE"
      });

      let ownerRole = await db.select().from(roles).where(eq(roles.name, "Company Owner")).get();
      if (!ownerRole) {
        ownerRole = await db.select().from(roles).where(eq(roles.code, "COMPANY_OWNER")).get();
      }
      if (!ownerRole) {
        const newRoleId = 'role-company-owner';
        await db.insert(roles).values({
          id: newRoleId,
          code: 'COMPANY_OWNER',
          name: 'Company Owner',
          description: 'Full access to all modules and system settings',
          isSystem: true
        });
        ownerRole = await db.select().from(roles).where(eq(roles.id, newRoleId)).get();
      }

      const roleId = ownerRole ? ownerRole.id : null;
      const membershipId = crypto.randomUUID();

      await db.insert(companyUsers).values({
        id: membershipId,
        userId: newUserId,
        companyId: id,
        roleId,
        status: "ACTIVE"
      });

      if (roleId) {
        await db.insert(companyUserRoles).values({
          id: crypto.randomUUID(),
          companyUserId: membershipId,
          roleId,
          assignedBy: newUserId
        }).onConflictDoNothing();
      }

      await CompanyManager.updateCompanyManifest(id, { recoveryUsedAt: new Date().toISOString() }).catch(() => {});
      await CompanyManager.syncCompanyDatabaseSnapshot(id);

      await AuditService.log({
        req,
        companyId: id,
        userId: newUserId,
        userEmail: normalizedEmail,
        userDisplayName: displayName?.trim() || "Company Administrator",
        action: "FIRST_ADMIN_RECOVERY_COMPLETED",
        entityType: "AUTHENTICATION",
        entityId: newUserId,
        module: "AUTH",
        severity: "CRITICAL",
        metadata: { recoveryType: "SECURE_ADMIN_PROVISION" }
      });

      res.json({
        success: true,
        message: "First administrator account created successfully. You can now log in.",
        user: { id: newUserId, email: normalizedEmail }
      });
    });
  } catch (err: any) {
    res.status(500).json({ error: "SETUP_ERROR", message: err.message || "Failed to set up administrator account" });
  }
});

// Validate folder path accessibility, writability, disk space, and tenant isolation (STRICTLY NON-MUTATING)
router.post("/validate-folder", async (req, res) => {
  const { folderPath, purpose, requireWrite, allowNonExistent, minFreeBytes, companyId } = req.body || {};
  if (!folderPath || typeof folderPath !== 'string') {
    res.status(400).json({ valid: false, errorCode: 'EMPTY_PATH', message: "Folder path is required" });
    return;
  }
  try {
    // Resolve authenticated company context if a valid session cookie/token is present
    let activeCompanyId: string | null = null;
    try {
      const token = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
      const parsed = token ? parseToken(token) : null;
      if (parsed?.companyId) {
        activeCompanyId = parsed.companyId;
      }
    } catch {
      activeCompanyId = null;
    }

    // Cross-tenant isolation check: prevent selecting another company's active workspace directory
    let registeredCompanyDirectories: Array<{ companyId: string; directory: string }> = [];
    try {
      const companiesList = await CompanyManager.listCompanies({ includeSynthetic: true });
      registeredCompanyDirectories = companiesList
        .filter((c) => Boolean(c?.id && c?.location))
        .map((c) => ({ companyId: c.id, directory: c.location }));
    } catch {
      registeredCompanyDirectories = [];
    }

    const effectiveCompanyId = activeCompanyId || (typeof companyId === 'string' && activeCompanyId === companyId ? companyId : null);
    const result = await validateDirectoryOnServer(folderPath, {
      purpose: typeof purpose === 'string' ? (purpose as any) : 'GENERAL',
      requireWrite: requireWrite !== false,
      allowNonExistent: Boolean(allowNonExistent),
      minFreeBytes: typeof minFreeBytes === 'number' && Number.isFinite(minFreeBytes) ? minFreeBytes : undefined,
      activeCompanyId: effectiveCompanyId,
      registeredCompanyDirectories,
    });

    if (!result.valid) {
      const isSecurityBlock =
        result.errorCode === 'PATH_TRAVERSAL_BLOCKED' ||
        result.errorCode === 'OUTSIDE_APPROVED_ROOT' ||
        result.errorCode === 'RESERVED_OS_DIRECTORY' ||
        result.errorCode === 'RESTRICTED_SECURITY_PATH' ||
        result.errorCode === 'TENANT_DIRECTORY_COLLISION';
      res.status(400).json({
        ...result,
        path: result.normalizedPath,
        error: isSecurityBlock ? 'PATH_TRAVERSAL_BLOCKED' : (result.errorCode || 'INVALID_FOLDER'),
      });
      return;
    }

    res.json({
      ...result,
      path: result.normalizedPath,
    });
  } catch (err: any) {
    console.error("validate-folder error:", err);
    res.status(400).json({
      valid: false,
      error: err?.message?.includes('PATH_TRAVERSAL_BLOCKED') ? 'PATH_TRAVERSAL_BLOCKED' : 'INVALID_FOLDER',
      errorCode: 'VALIDATION_ERROR',
      message: `Folder validation failed: ${err?.message || 'Unexpected error'}`,
    });
  }
});

// Resolve a folder selected via browser-native OS folder picker (showDirectoryPicker / webkitdirectory).
// Strictly non-mutating: never creates folders on disk and never leaks host OS root paths to remote clients.
router.post("/resolve-picked-folder", async (req, res) => {
  try {
    const {
      folderName: rawFolderName,
      defaultPath,
      purpose,
      requireWrite,
      sampleFileNames,
      companyId,
    } = req.body || {};

    const { sanitizePickedFolderName, buildMappedDestinationPath, validateDirectoryPathSyntax } = await import(
      "../../shared/folderPickerTypes"
    );

    const safeName = sanitizePickedFolderName(typeof rawFolderName === "string" ? rawFolderName : "");
    if (!safeName) {
      res.status(400).json({
        resolved: false,
        valid: false,
        errorCode: "INVALID_FOLDER_NAME",
        message: "Selected folder name is empty or contains invalid characters.",
      });
      return;
    }

    const effectivePurpose = typeof purpose === "string" ? purpose : "GENERAL";
    const isLoopback = isLocalLoopbackRequest(req);

    // Remote browser / hosted preview: never probe or leak host OS paths; map cleanly under safe virtual/logical base.
    if (!isLoopback) {
      const safeDefault =
        typeof defaultPath === "string" && validateDirectoryPathSyntax(defaultPath).valid ? defaultPath : "/data/companies";
      const virtualMappedPath = buildMappedDestinationPath(safeName, safeDefault, "/data/companies");
      const syntax = validateDirectoryPathSyntax(virtualMappedPath);
      res.json({
        resolved: syntax.valid,
        resolutionMode: "SERVER_MANAGED_VIRTUAL",
        folderName: safeName,
        path: syntax.normalizedPath,
        validation: {
          ...syntax,
          readable: true,
          writable: true,
        },
        message: `Selected "${safeName}" via native OS folder picker (mapped to server-managed destination).`,
      });
      return;
    }

    // Localhost / Desktop Server Console: search strictly within approved user/workspace roots to find exact existing match.
    const companiesRootResolved = path.resolve(paths.getCompaniesRootDir());
    const homeDir = os.homedir();
    const candidateRoots: string[] = [];

    const pushRoot = (candidate?: string | null) => {
      if (!candidate || typeof candidate !== "string") return;
      const trimmed = candidate.trim();
      if (!trimmed) return;
      const resolved = path.resolve(trimmed);
      if (!candidateRoots.includes(resolved)) {
        candidateRoots.push(resolved);
      }
    };

    if (typeof defaultPath === "string" && validateDirectoryPathSyntax(defaultPath).valid) {
      const normDefault = path.resolve(defaultPath);
      pushRoot(path.dirname(normDefault));
      pushRoot(normDefault);
    }
    pushRoot(companiesRootResolved);
    pushRoot(path.join(homeDir, "Documents"));
    pushRoot(path.join(homeDir, "Desktop"));
    pushRoot(path.join(homeDir, "Downloads"));
    pushRoot(homeDir);

    const normalizedSamples = Array.isArray(sampleFileNames)
      ? sampleFileNames
          .filter((n: unknown): n is string => typeof n === "string" && n.trim().length > 0)
          .map((n: string) => path.basename(n).toLowerCase())
          .slice(0, 25)
      : [];

    // Resolve authenticated company context for tenant isolation checks
    let activeCompanyId: string | null = null;
    try {
      const token = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
      const parsed = token ? parseToken(token) : null;
      if (parsed?.companyId) activeCompanyId = parsed.companyId;
    } catch {
      activeCompanyId = null;
    }

    let registeredCompanyDirectories: Array<{ companyId: string; directory: string }> = [];
    try {
      const companiesList = await CompanyManager.listCompanies({ includeSynthetic: true });
      registeredCompanyDirectories = companiesList
        .filter((c) => Boolean(c?.id && c?.location))
        .map((c) => ({ companyId: c.id, directory: c.location }));
    } catch {
      registeredCompanyDirectories = [];
    }

    const effectiveCompanyId =
      activeCompanyId || (typeof companyId === "string" && activeCompanyId === companyId ? companyId : null);

    // Find matching existing directories in approved roots
    const matches: Array<{ fullPath: string; score: number }> = [];
    const checkedPaths = new Set<string>();

    const checkCandidateDir = async (candidatePath: string) => {
      const resolved = path.resolve(candidatePath);
      if (checkedPaths.has(resolved)) return;
      checkedPaths.add(resolved);
      try {
        const st = await fs.stat(resolved);
        if (!st.isDirectory()) return;
        let score = 1;
        if (normalizedSamples.length > 0) {
          try {
            const entries = new Set((await fs.readdir(resolved)).map((e) => e.toLowerCase()));
            for (const s of normalizedSamples) {
              if (entries.has(s)) score += 10;
            }
          } catch {
            // Unreadable entries; keep base score
          }
        }
        matches.push({ fullPath: resolved, score });
      } catch {
        // Ignore non-existent or inaccessible paths
      }
    };

    if (typeof defaultPath === "string" && validateDirectoryPathSyntax(defaultPath).valid) {
      const normDefault = path.resolve(defaultPath);
      const baseName = path.basename(normDefault).toLowerCase();
      if (
        baseName === safeName.toLowerCase() ||
        baseName.replace(/[_\s-]+/g, '') === safeName.replace(/[_\s-]+/g, '').toLowerCase()
      ) {
        await checkCandidateDir(normDefault);
      }
    }

    // 1. Direct and common word-separator variations (spaces, underscores, hyphens)
    const nameVariations = Array.from(new Set([
      safeName,
      safeName.replace(/\s+/g, '_'),
      safeName.replace(/_+/g, ' '),
      safeName.replace(/\s+/g, '-'),
      safeName.replace(/-+/g, ' '),
      safeName.replace(/[_\s-]+/g, '_'),
    ]));

    for (const root of candidateRoots) {
      for (const variant of nameVariations) {
        await checkCandidateDir(path.join(root, variant));
      }
    }

    // 2. Deep fuzzy inspection of subdirectories under companies root & approved candidate roots
    const normalizedTarget = safeName.replace(/[_\s-]+/g, '').toLowerCase();
    for (const root of candidateRoots.slice(0, 3)) { // Focus on companies root, Documents, Desktop
      try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const entryNormalized = entry.name.replace(/[_\s-]+/g, '').toLowerCase();
          const candidatePath = path.join(root, entry.name);

          // Direct normalized name match
          if (entryNormalized === normalizedTarget || entryNormalized.includes(normalizedTarget) || normalizedTarget.includes(entryNormalized)) {
            await checkCandidateDir(candidatePath);
          }

          // Inspect manifest.json inside directory if available
          try {
            const manifestPath = path.join(candidatePath, 'manifest.json');
            if (fsSync.existsSync(manifestPath)) {
              const manifestContent = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
              const legalNorm = String(manifestContent?.legalName || '').replace(/[_\s-]+/g, '').toLowerCase();
              const idNorm = String(manifestContent?.id || '').replace(/[_\s-]+/g, '').toLowerCase();
              const tradeNorm = String(manifestContent?.tradeName || '').replace(/[_\s-]+/g, '').toLowerCase();

              if (
                legalNorm.includes(normalizedTarget) ||
                normalizedTarget.includes(legalNorm) ||
                idNorm.includes(normalizedTarget) ||
                normalizedTarget.includes(idNorm) ||
                tradeNorm.includes(normalizedTarget)
              ) {
                // High confidence match based on internal company manifest identity
                const stat = await fs.stat(candidatePath);
                if (stat.isDirectory()) {
                  matches.push({ fullPath: path.resolve(candidatePath), score: 100 });
                }
              }
            }
          } catch {
            // Ignore unparseable manifest
          }
        }
      } catch {
        // Root unreadable; proceed to next
      }
    }

    matches.sort((a, b) => b.score - a.score);

    for (const match of matches) {
      const validation = await validateDirectoryOnServer(match.fullPath, {
        purpose: effectivePurpose as any,
        requireWrite: requireWrite !== false,
        allowNonExistent: false,
        activeCompanyId: effectiveCompanyId,
        registeredCompanyDirectories,
      });
      if (validation.valid) {
        res.json({
          resolved: true,
          resolutionMode: "EXACT_LOCAL_MATCH",
          folderName: safeName,
          path: validation.normalizedPath,
          validation,
          message: `Selected "${safeName}" via native OS folder picker — verified on disk.`,
        });
        return;
      }
    }

    // No exact match under scanned local roots: map cleanly under approved workspace root for destination workflows
    let mappedPath = buildMappedDestinationPath(
      safeName,
      typeof defaultPath === "string" ? defaultPath : undefined,
      companiesRootResolved
    );
    const allowNonExistent = effectivePurpose !== "OPEN_COMPANY";
    let mappedValidation = await validateDirectoryOnServer(mappedPath, {
      purpose: effectivePurpose as any,
      requireWrite: requireWrite !== false,
      allowNonExistent,
      activeCompanyId: effectiveCompanyId,
      registeredCompanyDirectories,
    });

    // If defaultPath held a logical/virtual placeholder (e.g., /data/companies/...) outside local approved roots,
    // cleanly re-map directly under the server's approved companiesRootResolved.
    if (
      !mappedValidation.valid &&
      allowNonExistent &&
      (mappedValidation.errorCode === "OUTSIDE_APPROVED_ROOT" || mappedValidation.errorCode === "DIRECTORY_NOT_FOUND")
    ) {
      const rootFallbackPath = buildMappedDestinationPath(safeName, undefined, companiesRootResolved);
      if (rootFallbackPath !== mappedPath) {
        const rootFallbackValidation = await validateDirectoryOnServer(rootFallbackPath, {
          purpose: effectivePurpose as any,
          requireWrite: requireWrite !== false,
          allowNonExistent: true,
          activeCompanyId: effectiveCompanyId,
          registeredCompanyDirectories,
        });
        if (rootFallbackValidation.valid) {
          mappedPath = rootFallbackPath;
          mappedValidation = rootFallbackValidation;
        }
      }
    }

    if (mappedValidation.valid) {
      res.json({
        resolved: true,
        resolutionMode: "MAPPED_UNDER_BASE_ROOT",
        folderName: safeName,
        path: mappedValidation.normalizedPath,
        validation: mappedValidation,
        message: `Selected "${safeName}" via native OS folder picker — mapped under workspace storage root.`,
      });
      return;
    }

    res.json({
      resolved: false,
      resolutionMode: "BROWSER_HANDLE_ONLY",
      folderName: safeName,
      path: mappedPath,
      validation: mappedValidation,
      message:
        effectivePurpose === "OPEN_COMPANY"
          ? `Folder "${safeName}" was selected in the browser OS picker, but browser security hides the parent drive prefix. Paste the full path above or open via LedgerAI PH Desktop.`
          : mappedValidation.message || `Folder "${safeName}" selected via browser OS picker.`,
    });
  } catch (err: any) {
    console.error("resolve-picked-folder error:", err);
    res.status(400).json({
      resolved: false,
      valid: false,
      errorCode: "VALIDATION_ERROR",
      message: `Unable to resolve selected folder: ${err?.message || "Unexpected error"}`,
    });
  }
});

// Explore system directory structure for folder & .lai/.sqlite file selection modal
router.post("/explore-directory", async (req, res) => {
  try {
    let { targetPath, includeFiles, extensions } = req.body || {};
    if (!targetPath || typeof targetPath !== 'string' || !targetPath.trim()) {
      targetPath = COMPANIES_ROOT;
    }
    let resolvedPath: string;
    try {
      resolvedPath = assertAllowedWorkspacePath(targetPath);
    } catch (pathErr: any) {
      res.status(400).json({ error: "PATH_TRAVERSAL_BLOCKED", message: pathErr?.message || "Invalid workspace directory path." });
      return;
    }

    // Only auto-create directory if it IS COMPANIES_ROOT itself; never blindly mkdir arbitrary folders
    const companiesRootResolved = path.resolve(COMPANIES_ROOT);
    try {
      await fs.access(resolvedPath);
    } catch {
      if (resolvedPath === companiesRootResolved) {
        try {
          await fs.mkdir(resolvedPath, { recursive: true });
        } catch (_) {}
      } else {
        res.status(404).json({ error: "DIRECTORY_NOT_FOUND", message: `Directory '${resolvedPath}' does not exist.` });
        return;
      }
    }

    const allowedExtensions = Array.isArray(extensions) && extensions.length > 0
      ? extensions.map((ext: string) => ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`)
      : ['.lai', '.lgb', '.sqlite', '.db'];

    let folders: Array<{ name: string; path: string; isDirectory: boolean }> = [];
    let files: Array<{
      name: string;
      path: string;
      sizeBytes: number;
      extension: string;
      containerHint: 'WORKSPACE_DB' | 'BACKUP_ARCHIVE' | 'SQLITE_DB' | 'FILE';
    }> = [];

    try {
      const items = await fs.readdir(resolvedPath, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('.')) {
          folders.push({
            name: item.name,
            path: path.join(resolvedPath, item.name).replace(/\\/g, '/'),
            isDirectory: true
          });
        } else if (includeFiles && item.isFile()) {
          const ext = path.extname(item.name).toLowerCase();
          if (allowedExtensions.includes(ext)) {
            const fullFilePath = path.join(resolvedPath, item.name);
            let sizeBytes = 0;
            let containerHint: 'WORKSPACE_DB' | 'BACKUP_ARCHIVE' | 'SQLITE_DB' | 'FILE' = 'FILE';
            try {
              const st = await fs.stat(fullFilePath);
              sizeBytes = st.size;
              if (sizeBytes >= 6) {
                const fh = await fs.open(fullFilePath, 'r');
                try {
                  const buf = Buffer.alloc(16);
                  await fh.read(buf, 0, Math.min(16, sizeBytes), 0);
                  const h6 = buf.subarray(0, 6).toString('ascii');
                  const h8 = buf.subarray(0, 8).toString('ascii');
                  const h16 = buf.subarray(0, 16).toString('ascii');
                  if (h6 === 'LAIPH1' || h6 === 'LGBPH1') {
                    containerHint = 'BACKUP_ARCHIVE';
                  } else if (h8 === 'LAISENC1' || h8 === 'LAISENC2') {
                    containerHint = 'WORKSPACE_DB';
                  } else if (h16 === 'SQLite format 3\0') {
                    containerHint = 'SQLITE_DB';
                  }
                } finally {
                  await fh.close();
                }
              }
            } catch {}

            files.push({
              name: item.name,
              path: fullFilePath.replace(/\\/g, '/'),
              sizeBytes,
              extension: ext,
              containerHint,
            });
          }
        }
      }
      folders.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));
    } catch (readdirErr: any) {
      console.warn("Directory readdir notice:", readdirErr?.message);
    }

    const parentPath = path.dirname(resolvedPath);
    const isRoot = parentPath === resolvedPath;

    res.json({
      currentPath: resolvedPath.replace(/\\/g, '/'),
      parentPath: isRoot ? null : parentPath.replace(/\\/g, '/'),
      folders,
      files,
      canWrite: true
    });
  } catch (err: any) {
    res.status(500).json({ error: "EXPLORE_ERROR", message: err.message || "Failed to explore directory" });
  }
});

// Create new subfolder inside specified parent path (PC Server Console only)
router.post("/create-folder", async (req, res) => {
  if (!isLocalLoopbackRequest(req)) {
    res.status(403).json({
      error: "SERVER_CONSOLE_ONLY",
      message: "Creating server storage folders is restricted to the PC Server console.",
    });
    return;
  }
  try {
    const { parentPath, folderName } = req.body;
    if (!parentPath || !folderName || !folderName.trim()) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Parent directory path and folder name are required." });
      return;
    }
    const safeParent = assertAllowedWorkspacePath(parentPath);
    const safeName = folderName.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '_');
    const resolvedPath = assertAllowedWorkspacePath(path.join(safeParent, safeName));

    await fs.mkdir(resolvedPath, { recursive: true });
    res.json({
      success: true,
      newPath: resolvedPath.replace(/\\/g, '/'),
      folderName: safeName
    });
  } catch (err: any) {
    const isBlocked = String(err?.message || '').includes('PATH_TRAVERSAL_BLOCKED');
    res.status(isBlocked ? 400 : 500).json({ error: isBlocked ? "PATH_TRAVERSAL_BLOCKED" : "CREATE_FOLDER_ERROR", message: err.message || "Failed to create directory" });
  }
});

// PC Server Console ONLY: Create a new company profile (Phase 4 Setup Wizard)
router.post("/create-profile", async (req, res) => {
  if (!isLocalLoopbackRequest(req)) {
    res.status(403).json({
      error: "SERVER_CONSOLE_ONLY",
      message: "Creating new company profiles is restricted strictly to the LedgerAI PH PC Server console. Browser clients can sign in to existing registered companies.",
    });
    return;
  }
  const rawBody = req.body || {};
  const company = rawBody.company || rawBody;
  const tax = rawBody.tax || rawBody;
  const accounting = rawBody.accounting || rawBody;
  const locations = rawBody.locations || rawBody;
  const rawAdminEmail = rawBody.admin?.email || rawBody.adminEmail || rawBody.email;
  const rawAdminPassword = rawBody.admin?.password || rawBody.adminPassword || rawBody.password;

  if (!rawAdminEmail || typeof rawAdminEmail !== 'string' || !rawAdminEmail.trim()) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "An explicit administrator email address is required during company provisioning."
    });
    return;
  }

  if (!rawAdminPassword || typeof rawAdminPassword !== 'string' || rawAdminPassword.trim().length < 6) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "An explicit administrator password (minimum 6 characters) is required during company provisioning."
    });
    return;
  }

  const normalizedAdminEmail = rawAdminEmail.trim().toLowerCase();
  const admin = {
    email: normalizedAdminEmail,
    password: rawAdminPassword.trim(),
    displayName: rawBody.admin?.displayName || rawBody.adminFullName || rawBody.displayName || "Company Admin"
  };
  const locationPath = rawBody.locationPath;
  let createdCompanyId: string | null = null;
  let targetDocFolder: string | undefined = undefined;
  try {
    const fiscalYearVal = Number(accounting?.fiscalYear) || 2026;
    const indCode = (company?.industry || "COR").replace(/[^A-Za-z]/g, "").substring(0, 3).toUpperCase() || "COR";
    const bCode = (company?.branchCode || "00").replace(/[^0-9]/g, "").padStart(2, '0').substring(0, 2);
    const randPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    const requestedCustomId =
      typeof company?.id === 'string' && company.id.trim().startsWith('LGR-')
        ? company.id.trim()
        : null;
    const companyId = requestedCustomId || `LGR-PH-${fiscalYearVal}-${indCode}-${bCode}-${randPart}`;
    createdCompanyId = companyId;
    const userId = crypto.randomUUID();

    const legalName = company?.legalName || company?.companyName || "New Company";
    const requestedClassification = inferCompanyClassification(
      companyId,
      legalName,
      false,
      company?.classification || rawBody.classification
    );
    const requestedEncryptionKeyMode: EncryptionKeyMode | undefined =
      rawBody.encryptionKeyMode || company?.encryptionKeyMode;

    // Phase 6: Validate Production Encryption Key Policy BEFORE staging folders
    try {
      DatabaseEncryptionService.assertProductionKeyPolicy({
        companyId,
        classification: requestedClassification,
        keyMode:
          requestedEncryptionKeyMode ||
          (requestedClassification === 'PRODUCTION' || requestedClassification === 'PILOT'
            ? 'OS_KEYCHAIN_STANDALONE'
            : 'LEGACY_DEV_KEY'),
      });
    } catch (policyErr: any) {
      res.status(403).json({
        error: "PRODUCTION_KEY_POLICY_VIOLATION",
        message: policyErr.message,
      });
      return;
    }
    const tradeName = company?.tradeName || company?.displayName || legalName;
    const tin = company?.tin || "";
    const address = company?.address || company?.registeredAddress || "";
    const branchCode = company?.branchCode || "00000";
    const contactPerson = company?.contactPerson || admin?.displayName || "";
    const contactEmail = company?.contactEmail || admin?.email || "";
    const contactPhone = company?.contactPhone || company?.phone || "";
    const industry = company?.industry || "General Business";

    const taxpayerClassification = tax?.taxpayerClassification || tax?.taxpayerType || tax?.businessType || "CORPORATION";
    const taxpayerType = tax?.taxpayerType || taxpayerClassification;
    const vatStatus = tax?.vatStatus || tax?.taxClassification || "VAT";
    const rdoCode = tax?.rdoCode || "039";
    const birRegistrationNo = tax?.birRegistrationNo || "";
    const birDateRegistered = tax?.birDateRegistered || "";

    const fiscalYear = Number(accounting?.fiscalYear) || 2026;
    const fiscalYearStartMonth = Number(accounting?.fiscalYearStartMonth) || 1;
    const currency = accounting?.currency || accounting?.baseCurrency || "PHP";
    const accountingMethod = accounting?.accountingMethod || "ACCRUAL";
    const skipCoaSeed = Boolean(
      rawBody.skipCoaSeed === true ||
      rawBody.seedDefaultCoa === false ||
      rawBody.starterOption === 'BLANK_ZERO_COA' ||
      rawBody.coaStarter === 'ZERO_COA' ||
      company?.skipCoaSeed === true ||
      company?.seedDefaultCoa === false
    );

    const docLocationPath = locations?.documentLocationPath || locationPath || path.join(COMPANIES_ROOT, companyId);
    targetDocFolder = docLocationPath;
    const backupLocationPath = locations?.backupLocationPath || path.join(COMPANIES_ROOT, companyId, 'backups');

    try {
      await CompanyManager.validateStorageIsolation(companyId, docLocationPath);
    } catch (err: any) {
      res.status(400).json({
        error: "INVALID_LOCATION",
        message: err.message
      });
      return;
    }

    // Prevent duplicate non-synthetic companies (legalName/TIN) or overwriting an existing non-empty company directory
    try {
      await CompanyManager.checkDuplicateCompanyConflict({
        legalName: isSyntheticCompanyClassification(requestedClassification) ? undefined : legalName,
        tin: isSyntheticCompanyClassification(requestedClassification) ? undefined : tin,
        targetDir: docLocationPath,
      });
    } catch (conflictErr: any) {
      const msg = String(conflictErr?.message || "Duplicate company conflict");
      const code = msg.includes(':') ? msg.split(':')[0].trim() : 'DUPLICATE_COMPANY_CONFLICT';
      res.status(409).json({
        error: code,
        message: msg,
      });
      return;
    }

    // Validate Company Profile Storage Folder
    try {
      const resolvedDocPath = path.resolve(docLocationPath);
      await fs.mkdir(resolvedDocPath, { recursive: true });
      const testFileDoc = path.join(resolvedDocPath, `test_write_${Date.now()}.tmp`);
      await fs.writeFile(testFileDoc, 'ok');
      await fs.unlink(testFileDoc);
    } catch (err: any) {
      res.status(400).json({
        error: "INVALID_LOCATION",
        message: `Company Profile Storage Folder is invalid or inaccessible: ${err.message}`
      });
      return;
    }

    // Validate Backup Folder
    try {
      const resolvedBackupPath = path.resolve(backupLocationPath);
      await fs.mkdir(resolvedBackupPath, { recursive: true });
      const testFileBackup = path.join(resolvedBackupPath, `test_write_${Date.now()}.tmp`);
      await fs.writeFile(testFileBackup, 'ok');
      await fs.unlink(testFileBackup);
    } catch (err: any) {
      res.status(400).json({
        error: "INVALID_LOCATION",
        message: `Company Backup Folder is invalid or inaccessible: ${err.message}`
      });
      return;
    }

    // 1. Create isolated profile storage structure on disk (staged with skipRegistry: true)
    let manifest;
    try {
      manifest = await CompanyManager.createCompanyProfile(
        companyId,
        legalName,
        docLocationPath,
        backupLocationPath,
        true,
        {
          fiscalYear,
          fiscalYearStartMonth,
          classification: requestedClassification,
          encryptionKeyMode: requestedEncryptionKeyMode,
        }
      );
    } catch (stageErr: any) {
      console.error("Failed to stage company directory structure:", stageErr);
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: `Failed to create company storage folder structure: ${stageErr.message}`
      });
      return;
    }

    try {
      const companyDb = await CompanyManager.getCompanyDb(companyId, { allowInitializeNew: true });

      await dbContext.run(companyDb, async () => {
        // 2. Insert master company record inside its isolated DB
        await db.insert(companies).values({
          id: companyId,
          legalName,
          tradeName,
          tin,
          address,
          branchCode,
          contactPerson,
          contactEmail,
          contactPhone,
          industry,
          fiscalYear,
          fiscalYearStartMonth,
          currency,
          accountingMethod,
          taxpayerClassification,
          taxpayerType,
          vatStatus,
          rdoCode,
          birRegistrationNo,
          birDateRegistered,
          documentLocationPath: docLocationPath,
          backupLocationPath: backupLocationPath,
          status: "ACTIVE",
          classification: requestedClassification,
          isDemo: false
        }).onConflictDoUpdate({
          target: companies.id,
          set: {
            legalName,
            tradeName,
            tin,
            address,
            branchCode,
            contactPerson,
            contactEmail,
            contactPhone,
            industry,
            fiscalYear,
            fiscalYearStartMonth,
            currency,
            accountingMethod,
            taxpayerClassification,
            taxpayerType,
            vatStatus,
            rdoCode,
            birRegistrationNo,
            birDateRegistered,
            documentLocationPath: docLocationPath,
            backupLocationPath: backupLocationPath,
            classification: requestedClassification,
            updatedAt: new Date()
          }
        });

        // 3. Insert tax registration profile
        await db.insert(companyTaxProfiles).values({
          id: crypto.randomUUID(),
          companyId,
          tin,
          rdo: rdoCode,
          taxpayerClassification,
          vatStatus,
          accountingPeriod: fiscalYearStartMonth === 1 ? 'CALENDAR' : 'FISCAL',
          registrationInformation: JSON.stringify({ birRegistrationNo, birDateRegistered })
        }).onConflictDoNothing();

        // 4. Create Admin / Owner User
        const passwordHash = await bcrypt.hash(admin.password, 10);
        let finalUserId = userId;
        const existingUser = await db.select().from(users).where(eq(users.email, admin.email)).get();
        if (existingUser) {
          finalUserId = existingUser.id;
          await db.update(users).set({
            passwordHash,
            displayName: admin.displayName || existingUser.displayName
          }).where(eq(users.id, finalUserId));
        } else {
          await db.insert(users).values({
            id: finalUserId,
            email: admin.email,
            passwordHash,
            displayName: admin.displayName || "Company Admin",
            status: "ACTIVE"
          });
        }

        // Ensure system roles exist in the isolated company DB
        let ownerRole = await db.select().from(roles).where(eq(roles.name, "Company Owner")).get();
        if (!ownerRole) {
          ownerRole = await db.select().from(roles).where(eq(roles.code, "COMPANY_OWNER")).get();
        }
        if (!ownerRole) {
          const newRoleId = 'role-company-owner';
          await db.insert(roles).values({
            id: newRoleId,
            code: 'COMPANY_OWNER',
            name: 'Company Owner',
            description: 'Full access to all modules and system settings',
            isSystem: true
          });
          ownerRole = await db.select().from(roles).where(eq(roles.id, newRoleId)).get();
        }

        const roleId = ownerRole ? ownerRole.id : null;

        // Link User to Company as Active Member
        const membershipId = crypto.randomUUID();
        await db.insert(companyUsers).values({
          id: membershipId,
          userId: finalUserId,
          companyId,
          roleId,
          status: "ACTIVE"
        });

        // Also assign in company_user_roles for Phase 3 Multi-Role RBAC engine
        if (roleId) {
          await db.insert(companyUserRoles).values({
            id: crypto.randomUUID(),
            companyUserId: membershipId,
            roleId,
            assignedBy: finalUserId
          }).onConflictDoNothing();
        }

        // 5. Seed BIR-Adaptive Chart of Accounts (COA) - skipped if Zero-COA company requested
        const accountMap = new Map<string, string>(); // code -> id

        if (!skipCoaSeed) {
          // Build dynamic adaptive COA list based on BIR VAT status and taxpayer classification Core Engine Rules
          const activeEngineRules = getBirTaxProfileRules(taxpayerClassification, vatStatus);
          const adaptiveCoa: any[] = [...DEFAULT_PHILIPPINE_COA];

          if (vatStatus === 'NON_VAT') {
            adaptiveCoa.push(
              { accountCode: "2120", accountName: "Percentage Tax Payable (Form 2551Q - 3%)", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true },
              { accountCode: "6080", accountName: "Percentage Tax Expense (3%)", accountType: "EXPENSE", normalBalance: "DEBIT" }
            );
          } else if (vatStatus === 'PEZA_BOI' || vatStatus === 'FREEPORT') {
            adaptiveCoa.push(
              { accountCode: "2130", accountName: "Special Gross Income Tax Payable (5% GIT)", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true },
              { accountCode: "4030", accountName: "Tax Exempt / Ecozone Sales Revenue", accountType: "REVENUE", normalBalance: "CREDIT" }
            );
          } else if (vatStatus === 'PERCENTAGE_CARRIER') {
            adaptiveCoa.push(
              { accountCode: "2140", accountName: "Common Carrier Tax Payable (3% CCT)", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true }
            );
          } else if (vatStatus === 'PERCENTAGE_BANK_GRT') {
            adaptiveCoa.push(
              { accountCode: "2150", accountName: "Gross Receipts Tax Payable (1%-7% GRT)", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true }
            );
          } else if (vatStatus === 'ZERO_RATED' || vatStatus === 'EXEMPT' || vatStatus === 'COOPERATIVE_EXEMPT') {
            adaptiveCoa.push(
              { accountCode: "4030", accountName: "VAT Exempt / Zero-Rated Sales Revenue", accountType: "REVENUE", normalBalance: "CREDIT" }
            );
          }

          if (taxpayerClassification === 'INDIVIDUAL' || taxpayerClassification === 'INDIVIDUAL_8PERCENT' || taxpayerClassification === 'OPC') {
            adaptiveCoa.push(
              { accountCode: "3020", accountName: "Proprietor Drawings / Personal Distributions", accountType: "EQUITY", normalBalance: "DEBIT" }
            );
          } else if (taxpayerClassification === 'PARTNERSHIP' || taxpayerClassification === 'GPP') {
            adaptiveCoa.push(
              { accountCode: "3030", accountName: "Partner Capital - Managing Partner", accountType: "EQUITY", normalBalance: "CREDIT" },
              { accountCode: "3040", accountName: "Partner Drawings / Profit Share Distributions", accountType: "EQUITY", normalBalance: "DEBIT" }
            );
          } else if (taxpayerClassification === 'COOPERATIVE') {
            adaptiveCoa.push(
              { accountCode: "3050", accountName: "Cooperative Reserve Fund (RA 9520 Statutory Reserve)", accountType: "EQUITY", normalBalance: "CREDIT" },
              { accountCode: "3060", accountName: "Patronage Refund & Interest on Share Capital Payable", accountType: "LIABILITY", normalBalance: "CREDIT" }
            );
          } else if (vatStatus === 'BMBE') {
            adaptiveCoa.push(
              { accountCode: "3070", accountName: "BMBE Micro Capital Reserve (RA 9178)", accountType: "EQUITY", normalBalance: "CREDIT" }
            );
          }

          for (const accountDef of adaptiveCoa) {
            const accId = crypto.randomUUID();
            const inferredMeta = inferAccountDetailAndBirCategory(accountDef as any);
            await db.insert(accounts).values({
              id: accId,
              companyId,
              accountCode: accountDef.accountCode,
              accountName: accountDef.accountName,
              accountType: accountDef.accountType,
              detailType: (accountDef as any).detailType || inferredMeta.detailType,
              birTaxCategory: (accountDef as any).birTaxCategory || inferredMeta.birTaxCategory,
              normalBalance: accountDef.normalBalance,
              isCashAccount: !!(accountDef as any).isCashAccount,
              isControlAccount: !!(accountDef as any).isControlAccount,
              isTaxAccount: !!(accountDef as any).isTaxAccount,
              isRetainedEarnings: !!(accountDef as any).isRetainedEarnings,
              isActive: true
            }).onConflictDoNothing();
            accountMap.set(accountDef.accountCode, accId);
          }
        }

        // 6. Generate 12 Monthly Accounting Periods
        const periodIds: { month: string; id: string }[] = [];
        for (let i = 0; i < 12; i++) {
          const mIdx = (fiscalYearStartMonth - 1 + i) % 12;
          const yrOffset = Math.floor((fiscalYearStartMonth - 1 + i) / 12);
          const curYr = fiscalYear + yrOffset;
          const monthStr = String(mIdx + 1).padStart(2, '0');
          const lastDayNum = new Date(curYr, mIdx + 1, 0).getDate();
          const periodName = `${curYr}-${monthStr}`;
          const startDate = `${curYr}-${monthStr}-01`;
          const endDate = `${curYr}-${monthStr}-${String(lastDayNum).padStart(2, '0')}`;
          const pId = crypto.randomUUID();

          await db.insert(accountingPeriods).values({
            id: pId,
            companyId,
            name: periodName,
            startDate,
            endDate,
            fiscalYear: curYr,
            status: "OPEN"
          }).onConflictDoNothing();

          periodIds.push({ month: periodName, id: pId });
        }

        // 7. Seed Beginning Balances if provided
        if (Array.isArray(accounting?.beginningBalances) && accounting.beginningBalances.length > 0) {
          const entryId = crypto.randomUUID();
          const entryDate = `${fiscalYear}-01-01`;
          const firstPeriodId = periodIds[0]?.id || null;

          const normalBalanceByCode = new Map<string, string>(
            DEFAULT_PHILIPPINE_COA.map((a) => [a.accountCode, a.normalBalance])
          );

          const linesToInsert: { id: string; journalEntryId: string; accountId: string; debit: number; credit: number; description: string; lineNumber: number }[] = [];
          let lineNo = 1;
          let openingDebitTotal = 0;
          let openingCreditTotal = 0;
          for (const b of accounting.beginningBalances) {
            let deb = Math.round((Number(b.debit) || 0) * 100);
            let cred = Math.round((Number(b.credit) || 0) * 100);
            if (deb === 0 && cred === 0 && Number(b.amount)) {
              const amtCentavos = Math.round(Math.abs(Number(b.amount)) * 100);
              const normal = normalBalanceByCode.get(String(b.accountCode || '')) || 'DEBIT';
              const isCredit = normal === 'CREDIT' ? Number(b.amount) > 0 : Number(b.amount) < 0;
              if (isCredit) cred = amtCentavos;
              else deb = amtCentavos;
            }
            if (deb === 0 && cred === 0) continue;

            const accId = accountMap.get(b.accountCode) || b.accountId;
            if (accId) {
              openingDebitTotal += deb;
              openingCreditTotal += cred;
              linesToInsert.push({
                id: crypto.randomUUID(),
                journalEntryId: entryId,
                accountId: accId,
                debit: deb,
                credit: cred,
                description: "Beginning Balance Opening Entry",
                lineNumber: lineNo++
              });
            }
          }

          // Only post balanced opening journal entries (Debits === Credits)
          if (linesToInsert.length > 0 && openingDebitTotal === openingCreditTotal) {
            await db.insert(journalEntries).values({
              id: entryId,
              companyId,
              accountingPeriodId: firstPeriodId,
              journalNumber: `JE-OPENING-${fiscalYear}`,
              entryDate,
              sourceType: "OPENING_BALANCE",
              description: "Initial Beginning Balances Setup",
              status: "POSTED",
              createdBy: finalUserId,
              postedBy: finalUserId,
              postedAt: new Date()
            });

            for (const line of linesToInsert) {
              await db.insert(journalLines).values(line);
            }
          }
        }

        // 8. Initialize License Readiness (15-Day Trial License + 15-Day Grace Period)
        const nowTime = new Date();
        const trialStartDate = nowTime.toISOString().slice(0, 10);
        const trialEndDate = new Date(nowTime.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        await db.insert(companyLicenses).values({
          id: crypto.randomUUID(),
          companyId,
          licenseKey: `LIC-TRIAL-${companyId.slice(0, 8).toUpperCase()}`,
          planType: "TRIAL",
          status: "ACTIVE",
          trialStartDate: trialStartDate,
          expirationDate: trialEndDate,
          signedFileContent: JSON.stringify({ companyId, plan: "TRIAL", active: true, trialStartDate, expirationDate: trialEndDate }),
          isLifetime: false
        });

        // 9. Audit Log Entry
        await AuditService.log({
          req,
          userId: finalUserId,
          userEmail: admin.email,
          userDisplayName: admin.displayName,
          companyId,
          action: "COMPANY_CREATED",
          entityType: "COMPANY",
          entityId: companyId,
          entityName: legalName,
          module: "COMPANY",
          afterData: { legalName, tradeName, tin, taxpayerClassification, vatStatus, rdoCode, documentLocationPath: docLocationPath, backupLocationPath },
          source: "WEB_UI"
        });
      });

      // Checkpoint WAL and encrypt complete seeded database snapshot to .lai
      await CompanyManager.syncCompanyDatabaseSnapshot(companyId);

      // Post-creation consistency & lifecycle integrity verification BEFORE committing registry/shortcut
      const consistencyCheck = await CompanyManager.verifySnapshotConsistency(companyId);
      if (!consistencyCheck.valid) {
        throw new Error(`POST_CREATE_CONSISTENCY_FAILED: ${consistencyCheck.details}`);
      }

      const createdInspection = await CompanyLifecycleService.inspectDatabaseTarget(manifest.dbPath, {
        expectedCompanyId: companyId,
      });
      if (!createdInspection.valid) {
        throw new Error(`POST_CREATE_INSPECTION_FAILED: ${createdInspection.message}`);
      }

      // Commit company to global registry file only after complete database setup & verification succeeds
      await CompanyManager.registerCompany(manifest);
      CompanyManager.removeTempManifest(companyId);

      const createdShortcut = await CompanyLifecycleService.recordShortcut({
        companyId: manifest.id,
        displayName: manifest.legalName,
        databasePath: manifest.dbPath,
        companyDirectory: manifest.location,
        databaseIdentity: manifest.id,
        lastOperation: 'CREATED',
        lastOpenedAt: manifest.createdAt || new Date().toISOString(),
        availabilityStatus: 'AVAILABLE',
        validationStatus: 'VALID',
        classification: manifest.classification,
        isDemo: manifest.isDemo,
        isVisualStressPreview: manifest.isVisualStressPreview,
        versionMetadata: createdInspection.versionMetadata,
        lastValidationError: null,
      });

      // Automatically compile and place standalone Windows launcher executable (<CompanyName>.exe) inside the folder
      if (manifest?.location && manifest?.id) {
        await CompanyLauncherGenerator.generateLauncher({
          companyDirectory: manifest.location,
          companyId: manifest.id,
          legalName: manifest.legalName || manifest.id,
        }).catch((e) => console.warn('Company launcher generation warning:', e));
      }

      res.json({
        message: "Company profile created successfully",
        companyId,
        company: sanitizeCompanyManifestForPublic(manifest),
        shortcut: createdShortcut,
      });
    } catch (dbError: any) {
      console.error("Atomic Company Creation Failed — triggering rollback:", dbError);
      await CompanyManager.rollbackCompanyCreation(companyId, docLocationPath);
      res.status(500).json({ error: "INTERNAL_ERROR", message: `Company profile creation failed and was safely rolled back: ${dbError.message}` });
    }
  } catch (err: any) {
    console.error("Create Profile Error:", err?.stack || err, err?.cause);
    if (createdCompanyId) {
      await CompanyManager.rollbackCompanyCreation(createdCompanyId, targetDocFolder).catch(() => {});
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: `${err?.message || "Failed"} | Cause: ${JSON.stringify(err?.cause || {})}` });
  }
});

// Get SQLite recovery and integrity diagnostics for a company
router.get("/:id/diagnostics", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  try {
    const companyId = req.params.id;
    const allowed = await verifyCompanyTenantAndRole(req, res, companyId, ['Company Owner', 'Company Administrator']);
    if (!allowed) return;
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    if (!manifest) {
      res.status(404).json({ error: "NOT_FOUND", message: "Company profile not found" });
      return;
    }
    const diag = CompanyManager.getRecoveryDiagnostics(companyId);
    res.json({
      companyId,
      legalName: manifest.legalName,
      status: manifest.status || "ACTIVE",
      diagnostics: diag
    });
  } catch (err: any) {
    res.status(500).json({ error: "DIAGNOSTICS_ERROR", message: err?.message || "Failed to inspect diagnostics" });
  }
});

// Trigger controlled database recovery or explicitly approved initialization
router.post("/:id/recover", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  try {
    const companyId = req.params.id;
    const allowed = await verifyCompanyTenantAndRole(req, res, companyId, ['Company Owner']);
    if (!allowed) return;
    const { approveInitialization } = req.body || {};
    await CompanyManager.closeCompanyDb(companyId);
    await CompanyManager.getCompanyDb(companyId, {
      allowInitializeNew: Boolean(approveInitialization)
    });
    await CompanyManager.syncCompanyDatabaseSnapshot(companyId);
    const diag = CompanyManager.getRecoveryDiagnostics(companyId);
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    res.json({
      success: true,
      companyId,
      status: manifest?.status || "ACTIVE",
      diagnostics: diag
    });
  } catch (err: any) {
    const diag = CompanyManager.getRecoveryDiagnostics(req.params.id);
    res.status(409).json({
      error: "RECOVERY_REQUIRES_INTERVENTION",
      message: err?.message || "Automatic recovery halted to protect data",
      diagnostics: diag
    });
  }
});

/**
 * GET /api/companies/:id/financial-integrity
 * Non-destructive financial database audit across PRAGMAs, equality, GL, AR, AP, tax, periods
 */
router.get("/:id/financial-integrity", requireAuth, async (req, res) => {
  try {
    const companyId = req.params.id;
    const allowed = await verifyCompanyTenantAndRole(req, res, companyId, ['Company Owner', 'Company Administrator', 'Auditor', 'Accountant']);
    if (!allowed) return;
    const report = await FinancialIntegrityService.auditCompanyFinancialIntegrity(companyId);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({
      error: "FINANCIAL_INTEGRITY_AUDIT_FAILED",
      message: err?.message || "Failed to audit company financial integrity"
    });
  }
});

/**
 * GET /api/companies/:id/financial-integrity/exception-report
 * Markdown exception audit report for management and CPA auditors
 */
router.get("/:id/financial-integrity/exception-report", requireAuth, async (req, res) => {
  try {
    const companyId = req.params.id;
    const allowed = await verifyCompanyTenantAndRole(req, res, companyId, ['Company Owner', 'Company Administrator', 'Auditor', 'Accountant']);
    if (!allowed) return;
    const report = await FinancialIntegrityService.auditCompanyFinancialIntegrity(companyId);
    const markdown = FinancialIntegrityService.formatExceptionReportMarkdown(report);
    res.type("text/markdown").send(markdown);
  } catch (err: any) {
    res.status(500).send(`# AUDIT EXCEPTION REPORT ERROR\n\nFailed to audit company: ${err?.message}`);
  }
});

/**
 * GET /api/companies/:id/migrations
 * Schema migration history and relational integrity check
 */
router.get("/:id/migrations", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  try {
    const companyId = req.params.id;
    const allowed = await verifyCompanyTenantAndRole(req, res, companyId, ['Company Owner', 'Company Administrator']);
    if (!allowed) return;
    const sqlite = await CompanyManager.getCompanySqlite(companyId);
    if (!sqlite) {
      res.status(404).json({ error: "COMPANY_DB_NOT_FOUND", message: "Company database not accessible" });
      return;
    }
    const history = MigrationManager.getMigrationHistory(sqlite);
    const schemaValidation = MigrationManager.validateSchemaIntegrity(sqlite);
    res.json({
      companyId,
      currentVersion: history.filter(h => h.status === 'SUCCESS').reduce((max, h) => Math.max(max, h.version), 0),
      totalAppliedMigrations: history.filter(h => h.status === 'SUCCESS').length,
      history,
      schemaValidation
    });
  } catch (err: any) {
    res.status(500).json({ error: "MIGRATION_INSPECTION_FAILED", message: err?.message });
  }
});

/**
 * GET /api/companies/:id/snapshot-status
 * Inspects atomic snapshot synchronization, WAL checkpoint, and SHA-256 consistency
 */
router.get("/:id/snapshot-status", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  try {
    const companyId = req.params.id;
    const allowed = await verifyCompanyTenantAndRole(req, res, companyId, ['Company Owner', 'Company Administrator']);
    if (!allowed) return;
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    if (!manifest) {
      res.status(404).json({ error: "NOT_FOUND", message: "Company manifest not found" });
      return;
    }
    const consistency = await CompanyManager.verifySnapshotConsistency(companyId);
    res.json({
      companyId,
      manifestStatus: manifest.status || "ACTIVE",
      dbChecksum: manifest.dbChecksum || null,
      lastSnapshotSyncedAt: manifest.lastSnapshotSyncedAt || null,
      dbSnapshotSizeBytes: manifest.dbSnapshotSizeBytes || null,
      consistency
    });
  } catch (err: any) {
    res.status(500).json({ error: "SNAPSHOT_STATUS_FAILED", message: err?.message });
  }
});

/**
 * POST /api/companies/:id/snapshot-sync-now
 * Triggers immediate synchronous WAL checkpoint and atomic encrypted snapshot flush
 */
router.post("/:id/snapshot-sync-now", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  try {
    const companyId = req.params.id;
    const allowed = await verifyCompanyTenantAndRole(req, res, companyId, ['Company Owner', 'Company Administrator']);
    if (!allowed) return;
    const synced = await CompanyManager.checkpointAndSyncFinancialSnapshotNow(companyId);
    const consistency = await CompanyManager.verifySnapshotConsistency(companyId);
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    res.json({
      success: synced,
      companyId,
      syncedAt: manifest?.lastSnapshotSyncedAt || new Date().toISOString(),
      checksum: manifest?.dbChecksum || consistency.laiChecksum,
      consistency
    });
  } catch (err: any) {
    res.status(500).json({ error: "SNAPSHOT_SYNC_FAILED", message: err?.message });
  }
});

/**
 * POST /api/companies/quarantine-audit
 * DEF-009: Classifies all registered companies and quarantines synthetic/stress-test/benchmark datasets
 */
router.post("/quarantine-audit", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  try {
    const results = await CompanyManager.quarantineAndClassifyRegisteredCompanies();
    res.json({
      success: true,
      quarantinedCount: results.filter((r) => r.isQuarantinedFromProduction).length,
      companies: results,
    });
  } catch (err: any) {
    res.status(500).json({ error: "QUARANTINE_AUDIT_FAILED", message: err?.message });
  }
});

/**
 * POST /api/companies/:id/classification
 * DEF-009: Controlled company classification migration requiring Company Owner role and mandatory reason
 */
router.post("/:id/classification", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  try {
    const companyId = req.params.id;
    const { targetClassification, reason } = req.body || {};
    if (!targetClassification) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "targetClassification is required." });
      return;
    }

    // Enforce tenant scope or verified Company Owner membership in the target company
    if (req.activeCompany && req.activeCompany.id !== companyId) {
      let isTargetOwner = false;
      try {
        const targetDb = await CompanyManager.getCompanyDb(companyId);
        isTargetOwner = await dbContext.run(targetDb, async () => {
          const targetMembership = await db
            .select()
            .from(companyUsers)
            .where(and(eq(companyUsers.userId, req.user!.id), eq(companyUsers.companyId, companyId), eq(companyUsers.status, 'ACTIVE')))
            .get();
          if (!targetMembership) return false;
          const resolved = await RbacService.resolveEffectiveAccess(targetMembership.id);
          return resolved.primaryRole === 'Company Owner' || resolved.roles.includes('Company Owner');
        });
      } catch {
        isTargetOwner = false;
      }

      if (!isTargetOwner) {
        res.status(403).json({
          error: "TENANT_SCOPE_VIOLATION",
          message: `Cannot modify classification of company '${companyId}' without active Company Owner membership in that workspace.`
        });
        return;
      }
    }

    const result = await CompanyManager.changeCompanyClassification(
      companyId,
      String(targetClassification).toUpperCase() as CompanyClassification,
      {
        authorizedByUserId: req.user!.id,
        authorizedByRole: req.activeCompany?.role || 'Company Owner',
        reason: String(reason || ''),
      }
    );
    res.json({
      success: true,
      companyId,
      ...result,
    });
  } catch (err: any) {
    const status = err?.message?.includes('PROHIBITED') || err?.message?.includes('PERMISSION_DENIED') ? 403 : 400;
    res.status(status).json({
      error: "CLASSIFICATION_CHANGE_REJECTED",
      message: err?.message || "Failed to change company classification",
    });
  }
});

/**
 * POST /api/companies/:id/migrate-opening-balances
 * DEF-009: Rejects migrating opening balances from any STRESS_TEST or BENCHMARK source company
 */
router.post("/:id/migrate-opening-balances", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  try {
    const targetCompanyId = req.params.id;
    const { sourceCompanyId } = req.body || {};
    if (!sourceCompanyId) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "sourceCompanyId is required." });
      return;
    }
    await CompanyManager.assertProductionWorkflowAllowed(
      sourceCompanyId,
      "OPENING_BALANCE_MIGRATION",
      { allowPilot: true }
    );
    await CompanyManager.assertProductionWorkflowAllowed(
      targetCompanyId,
      "OPENING_BALANCE_MIGRATION",
      { allowPilot: true }
    );
    res.json({
      success: true,
      sourceCompanyId,
      targetCompanyId,
      message: "Source and target companies passed non-synthetic quarantine verification for opening balance migration.",
    });
  } catch (err: any) {
    res.status(403).json({
      error: "SYNTHETIC_MIGRATION_BLOCKED",
      message: err?.message || "Opening balance migration blocked by synthetic company quarantine.",
    });
  }
});

/**
 * GET /api/companies/:id/encryption/status
 * Phase 6: Inspects encryption container format (LAISENC1 vs LAISENC2), key mode, key version, and audit log
 */
router.get("/:id/encryption/status", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  try {
    const companyId = req.params.id;
    const allowed = await verifyCompanyTenantAndRole(req, res, companyId, ['Company Owner', 'Company Administrator']);
    if (!allowed) return;
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    if (!manifest) {
      res.status(404).json({ error: "NOT_FOUND", message: "Company manifest not found" });
      return;
    }
    const meta = DatabaseEncryptionService.inspectContainerMetadataSync(manifest.dbPath);
    const auditEvents = DatabaseEncryptionService.getKeyAccessAuditLog(companyId);
    res.json({
      companyId,
      classification: manifest.classification || inferCompanyClassification(companyId, manifest.legalName, manifest.isDemo),
      manifestKeyMode: manifest.encryptionKeyMode || meta.keyMode || 'LEGACY_DEV_KEY',
      containerMetadata: meta,
      recentKeyAuditEvents: auditEvents.slice(-20),
    });
  } catch (err: any) {
    res.status(500).json({ error: "ENCRYPTION_STATUS_FAILED", message: err?.message });
  }
});

/**
 * POST /api/companies/:id/encryption/rotate-key
 * Phase 6: Rotates a company's KEK and re-encrypts the .lai snapshot using LAISENC2 envelope encryption
 */
router.post("/:id/encryption/rotate-key", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  try {
    const companyId = req.params.id;
    const allowed = await verifyCompanyTenantAndRole(req, res, companyId, ['Company Owner']);
    if (!allowed) return;
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    if (!manifest) {
      res.status(404).json({ error: "NOT_FOUND", message: "Company manifest not found" });
      return;
    }
    const targetKeyMode: EncryptionKeyMode =
      req.body?.keyMode || manifest.encryptionKeyMode || 'OS_KEYCHAIN_STANDALONE';
    await CompanyManager.checkpointAndSyncFinancialSnapshotNow(companyId);
    const companyDir = manifest.location || path.dirname(manifest.dbPath);
    const activeSqlitePath = path.resolve(companyDir, '.db_active.sqlite');
    const rotation = DatabaseEncryptionService.rotateCompanyDatabaseKeySync(
      companyId,
      activeSqlitePath,
      manifest.dbPath,
      targetKeyMode
    );
    await CompanyManager.updateCompanyManifest(companyId, {
      encryptionKeyMode: rotation.keyMode,
      keyId: rotation.keyId,
    });
    res.json({
      success: true,
      ...rotation,
    });
  } catch (err: any) {
    res.status(400).json({ error: "KEY_ROTATION_FAILED", message: err?.message });
  }
});

export default router;


