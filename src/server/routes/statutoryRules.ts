import { Router } from 'express';
import { db } from '../db';
import * as schema from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { StatutoryPackageService } from '../services/statutoryPackageService';
import { StatutoryRuleEngine } from '../services/statutoryRuleEngine';
import { CompanyManager } from '../services/companyManager';
import { requireAuth, requirePermission } from '../auth';

export const statutoryRulesRouter = Router();

function resolveStatutoryCompanyId(req: any, res: any): string | null {
  const activeCompanyId = req.activeCompany?.id;
  const requestedCompanyId =
    (req.query?.companyId as string) ||
    req.body?.companyId ||
    (req.headers['x-company-id'] as string);

  if (activeCompanyId) {
    if (requestedCompanyId && String(requestedCompanyId) !== String(activeCompanyId)) {
      res.status(403).json({
        error: 'TENANT_SCOPE_VIOLATION',
        message: `Cross-company statutory rules access denied: session is bound to '${activeCompanyId}', not '${requestedCompanyId}'.`
      });
      return null;
    }
    return activeCompanyId;
  }

  return requestedCompanyId || 'LGR-PH-2026-PILOT-CLEAN-01';
}

/**
 * GET /api/statutory-rules
 * Get all statutory rules for company with active status.
 */
statutoryRulesRouter.get(
  '/statutory-rules',
  requireAuth,
  requirePermission('tax:view', 'payroll:view', 'accounting:view'),
  async (req, res) => {
    try {
      const companyId = resolveStatutoryCompanyId(req, res);
      if (!companyId) return;
      const companyDb = await CompanyManager.getCompanyDb(companyId);

      await StatutoryRuleEngine.ensureDefaultStatutoryRules(companyId, companyDb);

      const rules = await companyDb
        .select()
        .from(schema.statutoryRules)
        .where(eq(schema.statutoryRules.companyId, companyId))
        .orderBy(desc(schema.statutoryRules.versionNumber));

      res.json({ companyId, count: rules.length, rules });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /api/statutory-rules/freshness
 * Compliance Freshness Monitor status & alerts.
 * Protects against direct API query-parameter boolean override bypass.
 */
statutoryRulesRouter.get(
  '/statutory-rules/freshness',
  requireAuth,
  requirePermission('tax:view', 'payroll:view', 'accounting:view'),
  async (req, res) => {
    try {
      const companyId = resolveStatutoryCompanyId(req, res);
      if (!companyId) return;
      const currentDate = (req.query.currentDate as string) || new Date().toISOString().slice(0, 10);
      const enforceStrictControls = req.query.enforceStrictControls === 'true';
      const attemptedBooleanBypass = req.query.administratorOverride === 'true';
      const companyDb = await CompanyManager.getCompanyDb(companyId);

      const report = await StatutoryRuleEngine.checkComplianceFreshness(companyId, currentDate, companyDb, {
        enforceStrictControls,
        administratorOverride: attemptedBooleanBypass ? true : undefined
      });
      res.json(report);
    } catch (err: any) {
      res.status(err.code === 'BOOLEAN_OVERRIDE_PROHIBITED' ? 403 : 500).json({
        error: err.message,
        code: err.code || 'FRESHNESS_CHECK_FAILED'
      });
    }
  }
);

/**
 * POST /api/statutory-rules/freshness/override
 * Authorizes a statutory compliance freshness override with RBAC, SoD, Dual Approval,
 * mandatory justification, and immutable audit logging.
 */
statutoryRulesRouter.post(
  '/statutory-rules/freshness/override',
  requireAuth,
  requirePermission('tax:manage', 'payroll:manage', 'settings:manage', 'tax:approve', 'payroll:approve'),
  async (req, res) => {
    try {
      const companyId = resolveStatutoryCompanyId(req, res);
      if (!companyId) return;
      const companyDb = await CompanyManager.getCompanyDb(companyId);

      if (req.body.administratorOverride === true && !req.body.reason && !req.body.approvedByUserId) {
        return res.status(403).json({
          error: 'Security Control Violation: Direct API boolean administratorOverride bypass is prohibited.',
          code: 'BOOLEAN_OVERRIDE_PROHIBITED'
        });
      }

      const verifiedRole = req.activeCompany?.roleName || req.activeCompany?.role || '';

      const grant = await StatutoryRuleEngine.authorizeComplianceOverride(
        {
          companyId,
          agencyScope: req.body.agencyScope || ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR'],
          requestedByUserId: req.body.requestedByUserId || '',
          requestedByName: req.body.requestedByName || 'Requester',
          approvedByUserId: req.body.approvedByUserId || req.user?.id || '',
          approvedByName: req.body.approvedByName || req.user?.displayName || 'Approver',
          approverRole: req.body.approverRole || verifiedRole,
          secondaryApproverUserId: req.body.secondaryApproverUserId,
          secondaryApproverName: req.body.secondaryApproverName,
          secondaryApproverRole: req.body.secondaryApproverRole,
          reason: req.body.reason || '',
          justificationEvidenceRef: req.body.justificationEvidenceRef || '',
          highRiskOverride: req.body.highRiskOverride === true,
          currentDate: req.body.currentDate
        },
        companyDb
      );

      res.status(201).json({
        message: 'Statutory compliance freshness override authorized and recorded in immutable audit trail.',
        overrideGrant: grant
      });
    } catch (err: any) {
      res.status(403).json({ error: err.message, code: err.code || 'OVERRIDE_AUTHORIZATION_DENIED' });
    }
  }
);

/**
 * GET /api/statutory-rules/packages
 * List all imported statutory update packages.
 */
statutoryRulesRouter.get(
  '/statutory-rules/packages',
  requireAuth,
  requirePermission('tax:view', 'payroll:view', 'accounting:view'),
  async (req, res) => {
    try {
      const companyId = resolveStatutoryCompanyId(req, res);
      if (!companyId) return;
      const companyDb = await CompanyManager.getCompanyDb(companyId);

      const packages = await companyDb
        .select()
        .from(schema.statutoryUpdatePackages)
        .where(eq(schema.statutoryUpdatePackages.companyId, companyId))
        .orderBy(desc(schema.statutoryUpdatePackages.importedAt));

      res.json({ companyId, count: packages.length, packages });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * POST /api/statutory-rules/packages/import
 * Import signed statutory package JSON (offline USB / file upload).
 */
statutoryRulesRouter.post(
  '/statutory-rules/packages/import',
  requireAuth,
  requirePermission('tax:manage', 'payroll:manage', 'settings:manage'),
  async (req, res) => {
    try {
      const companyId = resolveStatutoryCompanyId(req, res);
      if (!companyId) return;
      const rawPackageJson = req.body.packageJson || req.body;
      const userId = req.user?.id || req.body.userId || 'admin-001';
      const userName = req.user?.displayName || req.body.userName || 'System Admin';

      const companyDb = await CompanyManager.getCompanyDb(companyId);

      const result = await StatutoryPackageService.importPackage(
        companyId,
        typeof rawPackageJson === 'string' ? rawPackageJson : JSON.stringify(rawPackageJson),
        userId,
        userName,
        companyDb
      );

      res.status(201).json({
        message: 'Statutory update package imported and cryptographically verified successfully.',
        package: result.packageRecord,
        validation: result.validationResult
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message, code: err.code || 'IMPORT_FAILED' });
    }
  }
);

/**
 * POST /api/statutory-rules/packages/:id/approve
 * Approve and activate statutory update package.
 */
statutoryRulesRouter.post(
  '/statutory-rules/packages/:id/approve',
  requireAuth,
  requirePermission('tax:manage', 'payroll:manage', 'settings:manage', 'tax:approve', 'payroll:approve'),
  async (req, res) => {
    try {
      const companyId = resolveStatutoryCompanyId(req, res);
      if (!companyId) return;
      const packageId = req.params.id;
      const userId = req.user?.id || req.body.userId || '';
      const userName = req.user?.displayName || req.body.userName || 'Approver';
      const userRole = req.activeCompany?.roleName || req.activeCompany?.role || '';

      const companyDb = await CompanyManager.getCompanyDb(companyId);

      const result = await StatutoryPackageService.approveAndActivatePackage(
        companyId,
        packageId,
        userId,
        userName,
        userRole,
        companyDb
      );

      res.json({
        message: 'Statutory update package approved and rules activated successfully.',
        package: result.packageRecord,
        activatedRulesCount: result.activatedRulesCount
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message, code: err.code || 'APPROVAL_FAILED' });
    }
  }
);

/**
 * POST /api/statutory-rules/packages/:id/rollback
 * Rollback active statutory update package.
 */
statutoryRulesRouter.post(
  '/statutory-rules/packages/:id/rollback',
  requireAuth,
  requirePermission('tax:manage', 'payroll:manage', 'settings:manage'),
  async (req, res) => {
    try {
      const companyId = resolveStatutoryCompanyId(req, res);
      if (!companyId) return;
      const packageId = req.params.id;
      const userId = req.user?.id || req.body.userId || '';
      const userName = req.user?.displayName || req.body.userName || 'Administrator';
      const userRole = req.activeCompany?.roleName || req.activeCompany?.role || '';
      const reason = req.body.reason || 'Rollback requested by statutory administrator.';

      const companyDb = await CompanyManager.getCompanyDb(companyId);

      await StatutoryPackageService.rollbackPackage(
        companyId,
        packageId,
        userId,
        userName,
        userRole,
        reason,
        companyDb
      );

      res.json({ message: 'Statutory update package successfully rolled back.' });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * GET /api/statutory-rules/audit-logs
 * Audit history for statutory rules.
 */
statutoryRulesRouter.get(
  '/statutory-rules/audit-logs',
  requireAuth,
  requirePermission('tax:view', 'payroll:view', 'audit:view'),
  async (req, res) => {
    try {
      const companyId = resolveStatutoryCompanyId(req, res);
      if (!companyId) return;
      const companyDb = await CompanyManager.getCompanyDb(companyId);

      const logs = await companyDb
        .select()
        .from(schema.statutoryAuditLogs)
        .where(eq(schema.statutoryAuditLogs.companyId, companyId))
        .orderBy(desc(schema.statutoryAuditLogs.createdAt));

      res.json({ companyId, count: logs.length, logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * POST /api/statutory-rules/sample-2027-package
 * Helper endpoint to generate and import a signed 2027 statutory update package (for demo/testing USB offline update flow).
 */
statutoryRulesRouter.post(
  '/statutory-rules/sample-2027-package',
  requireAuth,
  requirePermission('tax:manage', 'payroll:manage', 'settings:manage'),
  async (req, res) => {
    try {
      const companyId = resolveStatutoryCompanyId(req, res);
      if (!companyId) return;
      const userId = req.user?.id || req.body.userId || 'admin-001';
      const userName = req.user?.displayName || req.body.userName || 'Atty. Juan Dela Cruz, CPA';
      const companyDb = await CompanyManager.getCompanyDb(companyId);

      const sample2027Pkg = StatutoryPackageService.createSignedPackage(
        'PKG-PH-STATUTORY-2027-ANNUAL',
        'Official 2027 Philippine Statutory Updates Package',
        '2027.1.0',
        'Republic of the Philippines Statutory Distribution Authority',
        [
          {
            agency: 'SSS',
            ruleCode: 'SSS-2027-61BRACKET',
            ruleName: '2027 SSS Statutory Update (5.0% EE / 10.0% ER, ₱35,000 MSC)',
            regulatorySourceRef: 'RA 11199 & SSS Circular 2026-099',
            officialPublicationDate: '2026-12-01',
            effectiveStartDate: '2027-01-01',
            effectiveEndDate: null,
            versionNumber: 2,
            calculationMethodology: 'DISCRETE_61_BRACKET_TABLE',
            parameters: {
              eeRate: 0.05,
              erRate: 0.10,
              minMscCentavos: 500000,
              maxMscCentavos: 3500000
            },
            goldenTestCases: [
              {
                testName: 'Junior Staff ₱25k MSC 2027',
                grossSalaryCentavos: 1250000,
                expectedEmployeeContribCentavos: 62500,
                expectedEmployerContribCentavos: 126500
              }
            ]
          },
          {
            agency: 'PAGIBIG',
            ruleCode: 'HDMF-CIRC-500-2027',
            ruleName: '2027 Pag-IBIG Monthly Fund Salary Ceiling Update (₱12,000 MFS)',
            regulatorySourceRef: 'HDMF Circular No. 500 (Effective Jan 1, 2027)',
            officialPublicationDate: '2026-11-15',
            effectiveStartDate: '2027-01-01',
            effectiveEndDate: null,
            versionNumber: 2,
            calculationMethodology: 'PERCENTAGE_WITH_MFS_CEILING',
            parameters: {
              eeRate: 0.02,
              erRate: 0.02,
              mfsCeilingCentavos: 1200000 // ₱12,000 MFS
            },
            goldenTestCases: [
              {
                testName: 'Junior Staff ₱25k Salary (Capped at ₱12,000 MFS)',
                grossSalaryCentavos: 1250000,
                expectedEmployeeContribCentavos: 12000, // 2% of ₱6k semi = ₱120 semi-monthly
                expectedEmployerContribCentavos: 12000
              }
            ]
          }
        ]
      );

      const imported = await StatutoryPackageService.importPackage(
        companyId,
        JSON.stringify(sample2027Pkg),
        userId,
        userName,
        companyDb
      );

      res.status(201).json({
        message: 'Sample 2027 statutory update package generated, signed, and imported.',
        package: imported.packageRecord,
        validation: imported.validationResult,
        rawPackageJson: sample2027Pkg
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);
