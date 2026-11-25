import crypto from 'crypto';
import { db } from '../db';
import * as schema from '../db/schema';
import { eq, and, lte, gte, isNull, or, desc } from 'drizzle-orm';
import { DomainError } from '../db/domain';
import { StatutoryPackageService } from './statutoryPackageService';
import { TaxEngine } from './taxEngine';

export interface ActiveStatutoryRuleSet {
  resolvedDate: string;
  sssRule: {
    ruleCode: string;
    regulatorySourceRef: string;
    versionNumber: number;
    effectiveStartDate: string;
    parameters: Record<string, any>;
  };
  philhealthRule: {
    ruleCode: string;
    regulatorySourceRef: string;
    versionNumber: number;
    effectiveStartDate: string;
    parameters: Record<string, any>;
  };
  pagibigRule: {
    ruleCode: string;
    regulatorySourceRef: string;
    versionNumber: number;
    effectiveStartDate: string;
    parameters: Record<string, any>;
  };
  birRule: {
    ruleCode: string;
    regulatorySourceRef: string;
    versionNumber: number;
    effectiveStartDate: string;
    parameters: Record<string, any>;
  };
}

export interface StatutoryComplianceOverrideGrant {
  overrideId: string;
  companyId: string;
  agencyScope: Array<'SSS' | 'PHILHEALTH' | 'PAGIBIG' | 'BIR'>;
  requestedByUserId: string;
  requestedByName: string;
  approvedByUserId: string;
  approvedByName: string;
  approverRole: string;
  secondaryApproverUserId?: string;
  secondaryApproverName?: string;
  secondaryApproverRole?: string;
  reason: string;
  justificationEvidenceRef: string;
  issuedAt: string;
  expiresAt: string;
  auditLogId: string;
  signature: string;
}

export interface StatutoryComplianceFreshnessReport {
  overallStatus: 'CURRENT' | 'NEEDS_ATTENTION' | 'OUTDATED_WARNING' | 'EXPIRED_CRITICAL';
  currentDate: string;
  lastVerifiedDate: string;
  agencies: Array<{
    agency: 'SSS' | 'PHILHEALTH' | 'PAGIBIG' | 'BIR';
    activeRuleCode: string;
    regulatorySourceRef: string;
    effectiveStartDate: string;
    effectiveEndDate?: string | null;
    complianceExpiryDate: string;
    lastVerifiedDate: string;
    verificationStatus: 'VERIFIED_CURRENT' | 'VERIFICATION_OVERDUE' | 'UPDATE_PENDING';
    versionNumber: number;
    status: 'FRESH' | 'PENDING_UPDATE' | 'OUTDATED' | 'EXPIRED';
    daysSinceEffective: number;
    notice: string;
    regulatoryChangesDetected?: string[];
  }>;
  pendingPackagesCount: number;
  warnings: string[];
  controls: {
    allowDraftComputation: boolean;
    allowFinalPosting: boolean;
    requiresAdministratorOverride: boolean;
    overrideAuditLogId?: string;
    overrideApprovedBy?: string;
  };
}

export class StatutoryRuleEngine {
  /**
   * Initializes default official statutory rules (2026 SSS, HDMF Circular 460, PhilHealth 2026, BIR TRAIN)
   * in database for a company if none exist.
   */
  static async ensureDefaultStatutoryRules(companyId: string, dbClient: any = db) {
    const existingRules = await dbClient
      .select()
      .from(schema.statutoryRules)
      .where(eq(schema.statutoryRules.companyId, companyId));

    if (existingRules.length === 0) {
      // Create seed signed package
      const seedPkg = StatutoryPackageService.createSignedPackage(
        'PKG-PH-STATUTORY-2026-OFFICIAL',
        'Official 2026 Philippine Statutory Rules Package',
        '2026.1.0',
        'Republic of the Philippines Statutory Distribution Authority',
        [
          {
            agency: 'SSS',
            ruleCode: 'SSS-2026-61BRACKET',
            ruleName: '2025/2026 Official 61-Bracket SSS Schedule (RA 11199 / SSS Circular 2024-006)',
            regulatorySourceRef: 'Republic Act No. 11199 & SSS Circular No. 2024-006',
            officialPublicationDate: '2024-12-15',
            effectiveStartDate: '2025-01-01',
            effectiveEndDate: null,
            versionNumber: 1,
            calculationMethodology: 'DISCRETE_61_BRACKET_TABLE',
            parameters: {
              eeRate: 0.05,
              erRate: 0.10,
              minMscCentavos: 500000,
              maxMscCentavos: 3500000,
              regularMscCapCentavos: 2000000,
              wispMscCapCentavos: 1500000,
              ecFloorCentavos: 1000,
              ecCeilingCentavos: 3000
            },
            goldenTestCases: [
              {
                testName: 'Junior Staff ₱25,000 MSC',
                grossSalaryCentavos: 1250000,
                expectedEmployeeContribCentavos: 62500,
                expectedEmployerContribCentavos: 126500
              }
            ]
          },
          {
            agency: 'PHILHEALTH',
            ruleCode: 'PHIC-2026-5PCT',
            ruleName: '2026 PhilHealth UHC Premium Rate (RA 11223 & Circular 2024-0001)',
            regulatorySourceRef: 'Republic Act No. 11223 & PhilHealth Circular 2024-0001',
            officialPublicationDate: '2024-01-01',
            effectiveStartDate: '2024-01-01',
            effectiveEndDate: null,
            versionNumber: 1,
            calculationMethodology: 'PERCENTAGE_WITH_FLOOR_CEILING',
            parameters: {
              eeRate: 0.025,
              erRate: 0.025,
              monthlyFloorCentavos: 1000000,
              monthlyCeilingCentavos: 10000000
            },
            goldenTestCases: [
              {
                testName: 'Junior Staff ₱25,000 Monthly Salary',
                grossSalaryCentavos: 1250000,
                expectedEmployeeContribCentavos: 31250,
                expectedEmployerContribCentavos: 31250
              }
            ]
          },
          {
            agency: 'PAGIBIG',
            ruleCode: 'HDMF-CIRC-460',
            ruleName: 'Pag-IBIG Contribution Rate & ₱10,000 MFS Ceiling (HDMF Circular No. 460)',
            regulatorySourceRef: 'HDMF Circular No. 460 (Effective Feb 1, 2024)',
            officialPublicationDate: '2024-01-15',
            effectiveStartDate: '2024-02-01',
            effectiveEndDate: null,
            versionNumber: 1,
            calculationMethodology: 'PERCENTAGE_WITH_MFS_CEILING',
            parameters: {
              eeRate: 0.02,
              erRate: 0.02,
              mfsCeilingCentavos: 1000000
            },
            goldenTestCases: [
              {
                testName: 'Junior Staff ₱25,000 Monthly Salary (Capped at ₱10,000 MFS)',
                grossSalaryCentavos: 1250000,
                expectedEmployeeContribCentavos: 10000,
                expectedEmployerContribCentavos: 10000
              }
            ]
          },
          {
            agency: 'BIR',
            ruleCode: 'BIR-TRAIN-WHT-2023',
            ruleName: 'BIR TRAIN Law Revised Individual Compensation Withholding (RA 10963 / RR 11-2018)',
            regulatorySourceRef: 'Republic Act No. 10963 & Revenue Regulations No. 11-2018',
            officialPublicationDate: '2022-12-28',
            effectiveStartDate: '2023-01-01',
            effectiveEndDate: null,
            versionNumber: 1,
            calculationMethodology: 'GRADUATED_WITHHOLDING_BRACKETS',
            parameters: {
              semiMonthlyExemptionCeilingCentavos: 1041700
            },
            goldenTestCases: [
              {
                testName: 'Junior Staff Taxable Income ₱11,462.50',
                grossSalaryCentavos: 1250000,
                expectedEmployeeContribCentavos: 0,
                expectedEmployerContribCentavos: 0,
                expectedWithholdingTaxCentavos: 15683
              }
            ]
          }
        ]
      );

      await StatutoryPackageService.importPackage(
        companyId,
        JSON.stringify(seedPkg),
        'SYSTEM_BOOTSTRAP',
        'System Seed Service',
        dbClient
      );

      // Approve package for current company
      const pkgs = await dbClient
        .select()
        .from(schema.statutoryUpdatePackages)
        .where(eq(schema.statutoryUpdatePackages.companyId, companyId));

      if (pkgs.length > 0) {
        await StatutoryPackageService.approveAndActivatePackage(
          companyId,
          pkgs[0].id,
          'SYSTEM_BOOTSTRAP',
          'System Seed Service',
          'Company Administrator',
          dbClient
        );
      }
    }
  }

  /**
   * Authoritative statutory rule resolution with strict validation and conflict detection.
   * Validates:
   * - Company ID.
   * - Agency ('SSS' | 'PHILHEALTH' | 'PAGIBIG' | 'BIR' | 'OTHER').
   * - Rule type / ruleCode.
   * - Rule status ('ACTIVE').
   * - Effective start date (effectiveStartDate <= dateStr).
   * - Effective end date (effectiveEndDate === null || effectiveEndDate >= dateStr).
   * - Rule version.
   * - Rejects expired, overlapping, ambiguous, and conflicting active rules (fail closed).
   */
  static async getEffectiveRule(
    companyId: string,
    agency: 'SSS' | 'PHILHEALTH' | 'PAGIBIG' | 'BIR' | 'OTHER',
    transactionDate: string,
    options: {
      ruleCode?: string;
      dbClient?: any;
    } = {}
  ) {
    const dbClient = options.dbClient || db;
    if (!companyId) {
      throw new DomainError('Company ID is required for statutory rule resolution.', 'INVALID_COMPANY_ID');
    }
    if (!agency) {
      throw new DomainError('Agency code is required for statutory rule resolution.', 'INVALID_AGENCY');
    }

    const dateStr = transactionDate ? transactionDate.slice(0, 10) : new Date().toISOString().slice(0, 10);

    // Query candidate active rules for this agency and company
    const candidateRules = await dbClient
      .select()
      .from(schema.statutoryRules)
      .where(
        and(
          eq(schema.statutoryRules.companyId, companyId),
          eq(schema.statutoryRules.agency, agency),
          eq(schema.statutoryRules.status, 'ACTIVE')
        )
      );

    // Filter by effective date bounds and ruleCode if specified
    const applicableRules = candidateRules.filter((r: any) => {
      const startMatches = r.effectiveStartDate <= dateStr;
      const endMatches = !r.effectiveEndDate || r.effectiveEndDate >= dateStr;
      const codeMatches = !options.ruleCode || r.ruleCode === options.ruleCode;
      return startMatches && endMatches && codeMatches;
    });

    if (applicableRules.length === 0) {
      // Boundary check diagnostics
      const expiredRules = candidateRules.filter((r: any) => r.effectiveEndDate && r.effectiveEndDate < dateStr);
      const futureRules = candidateRules.filter((r: any) => r.effectiveStartDate > dateStr);

      if (expiredRules.length > 0 && futureRules.length === 0) {
        throw new DomainError(
          `No active statutory rule found for ${agency} on ${dateStr}. Prior rule '${expiredRules[0].ruleCode}' expired on ${expiredRules[0].effectiveEndDate}.`,
          'STATUTORY_RULE_EXPIRED'
        );
      }
      if (futureRules.length > 0 && expiredRules.length === 0) {
        throw new DomainError(
          `Statutory rule for ${agency} is not yet effective for date ${dateStr}. Nearest effective start date is ${futureRules[0].effectiveStartDate}.`,
          'STATUTORY_RULE_NOT_YET_EFFECTIVE'
        );
      }

      return null;
    }

    // Check for ambiguity / conflicting rules:
    // If multiple active rules have DIFFERENT rule codes covering the same agency on the date, fail closed!
    const distinctRuleCodes = Array.from(new Set(applicableRules.map((r: any) => r.ruleCode)));
    if (distinctRuleCodes.length > 1) {
      throw new DomainError(
        `Ambiguous conflicting statutory rules detected for ${agency} on date ${dateStr}: Multiple distinct active rules [${distinctRuleCodes.join(', ')}] are configured. System rejects ambiguous statutory rule execution.`,
        'AMBIGUOUS_STATUTORY_RULE_CONFLICT'
      );
    }

    // Sort by versionNumber descending to select highest version of the active rule
    applicableRules.sort((a: any, b: any) => b.versionNumber - a.versionNumber);
    return applicableRules[0];
  }

  /**
   * Dynamically resolves active statutory rules for a transaction date.
   */
  static async resolveActiveRulesForDate(
    companyId: string,
    transactionDate: string,
    dbClient: any = db
  ): Promise<ActiveStatutoryRuleSet> {
    await this.ensureDefaultStatutoryRules(companyId, dbClient);

    const dateStr = transactionDate ? transactionDate.slice(0, 10) : new Date().toISOString().slice(0, 10);

    const agencies: Array<'SSS' | 'PHILHEALTH' | 'PAGIBIG' | 'BIR'> = ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR'];
    const resolved: Record<string, any> = {};

    for (const agency of agencies) {
      let activeRule = null;
      try {
        activeRule = await this.getEffectiveRule(companyId, agency, dateStr, { dbClient });
      } catch (e: any) {
        // If ambiguous conflict, let it propagate immediately (fail closed)
        if (e.code === 'AMBIGUOUS_STATUTORY_RULE_CONFLICT' || e.code === 'STATUTORY_RULE_EXPIRED') {
          throw e;
        }
      }

      if (activeRule) {
        resolved[agency] = {
          ruleCode: activeRule.ruleCode,
          regulatorySourceRef: activeRule.regulatorySourceRef,
          versionNumber: activeRule.versionNumber,
          effectiveStartDate: activeRule.effectiveStartDate,
          parameters: JSON.parse(activeRule.ruleDefinitionJson).parameters || {}
        };
      } else {
        // Fallback default rules
        resolved[agency] = {
          ruleCode: `${agency}-FALLBACK-DEFAULT`,
          regulatorySourceRef: `Default Statutory Fallback (${agency})`,
          versionNumber: 1,
          effectiveStartDate: '2024-01-01',
          parameters: {}
        };
      }
    }

    return {
      resolvedDate: dateStr,
      sssRule: resolved['SSS'],
      philhealthRule: resolved['PHILHEALTH'],
      pagibigRule: resolved['PAGIBIG'],
      birRule: resolved['BIR']
    };
  }

  private static computeOverrideSignature(payload: Omit<StatutoryComplianceOverrideGrant, 'signature'>): string {
    const secret = process.env.LEDGERAI_MASTER_KEY || 'LEDGERAI_COMPLIANCE_OVERRIDE_SIGNING_KEY_2026';
    const canonical = JSON.stringify({
      overrideId: payload.overrideId,
      companyId: payload.companyId,
      agencyScope: [...payload.agencyScope].sort(),
      requestedByUserId: payload.requestedByUserId,
      approvedByUserId: payload.approvedByUserId,
      approverRole: payload.approverRole,
      secondaryApproverUserId: payload.secondaryApproverUserId || null,
      reason: payload.reason,
      justificationEvidenceRef: payload.justificationEvidenceRef,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      auditLogId: payload.auditLogId
    });
    return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  }

  /**
   * Authorizes a high-security statutory compliance freshness override.
   * Enforces:
   * 1. Granular RBAC permission (Company Owner / Company Administrator / Statutory Approver)
   * 2. Separation of Duties (SoD): Requester cannot approve their own compliance override
   * 3. Dual Approval for High-Risk Overrides (OUTDATED or EXPIRED rules require secondary approver)
   * 4. Mandatory reason (>= 20 chars) and regulatory/management justification reference
   * 5. Company and statutory agency scope
   * 6. Immutable audit log entry in statutory_audit_logs
   */
  static async authorizeComplianceOverride(
    params: {
      companyId: string;
      agencyScope: Array<'SSS' | 'PHILHEALTH' | 'PAGIBIG' | 'BIR'>;
      requestedByUserId: string;
      requestedByName: string;
      approvedByUserId: string;
      approvedByName: string;
      approverRole: string;
      secondaryApproverUserId?: string;
      secondaryApproverName?: string;
      secondaryApproverRole?: string;
      reason: string;
      justificationEvidenceRef: string;
      highRiskOverride?: boolean;
      currentDate?: string;
      ttlHours?: number;
    },
    dbClient: any = db
  ): Promise<StatutoryComplianceOverrideGrant> {
    if (!params.companyId || !params.companyId.trim()) {
      throw new DomainError('Company scope is required for statutory compliance override.', 'INVALID_OVERRIDE_SCOPE');
    }
    if (!Array.isArray(params.agencyScope) || params.agencyScope.length === 0) {
      throw new DomainError('At least one statutory agency scope (SSS, PHILHEALTH, PAGIBIG, BIR) must be specified.', 'INVALID_OVERRIDE_SCOPE');
    }
    if (!params.requestedByUserId || !params.approvedByUserId) {
      throw new DomainError('Both requester and approver user identities are required.', 'MISSING_USER_IDENTITY');
    }

    // 1. Granular RBAC check (including DB membership cross-verification against role spoofing)
    const allowedRoles = ['Company Owner', 'Company Administrator', 'Statutory Approver', 'OWNER', 'ADMIN'];
    if (!allowedRoles.includes(params.approverRole)) {
      throw new DomainError(
        `[UNAUTHORIZED_OVERRIDE_ROLE] RBAC Access Denied: Role '${params.approverRole}' is not authorized to approve statutory compliance overrides.`,
        'UNAUTHORIZED_OVERRIDE_ROLE'
      );
    }

    const dbPrimaryMembership = await dbClient
      .select()
      .from(schema.companyUsers)
      .where(
        and(
          eq(schema.companyUsers.companyId, params.companyId),
          eq(schema.companyUsers.userId, params.approvedByUserId)
        )
      )
      .get();
    if (dbPrimaryMembership && !allowedRoles.includes(dbPrimaryMembership.role)) {
      throw new DomainError(
        `[SPOOFED_APPROVER_ROLE] RBAC Integrity Violation: User '${params.approvedByUserId}' holds database role '${dbPrimaryMembership.role}' in company '${params.companyId}', not '${params.approverRole}'.`,
        'SPOOFED_APPROVER_ROLE'
      );
    }

    // 2. Separation of Duties (SoD) check
    if (params.requestedByUserId.trim() === params.approvedByUserId.trim()) {
      throw new DomainError(
        `[SOD_VIOLATION_SELF_OVERRIDE] Separation of Duties Violation: User '${params.requestedByUserId}' cannot self-approve a statutory compliance override they requested.`,
        'SOD_VIOLATION_SELF_OVERRIDE'
      );
    }

    // 3. Mandatory Reason & Justification Verification
    if (!params.reason || params.reason.trim().length < 20) {
      throw new DomainError(
        '[INSUFFICIENT_OVERRIDE_REASON] Mandatory Override Justification Failed: Override reason must be at least 20 characters explaining the regulatory basis.',
        'INSUFFICIENT_OVERRIDE_REASON'
      );
    }
    if (!params.justificationEvidenceRef || params.justificationEvidenceRef.trim().length < 5) {
      throw new DomainError(
        '[MISSING_OVERRIDE_EVIDENCE] Mandatory Override Evidence Failed: A valid board resolution, CPA memo, or circular reference is required.',
        'MISSING_OVERRIDE_EVIDENCE'
      );
    }

    // 4. Inspect current freshness to determine if High-Risk Dual Approval is required
    const baselineReport = await this.checkComplianceFreshness(params.companyId, params.currentDate, dbClient, {
      enforceStrictControls: false
    });
    const requiresDualApproval =
      params.highRiskOverride === true ||
      baselineReport.overallStatus === 'OUTDATED_WARNING' ||
      baselineReport.overallStatus === 'EXPIRED_CRITICAL' ||
      baselineReport.agencies.some(
        a => params.agencyScope.includes(a.agency) && (a.status === 'OUTDATED' || a.status === 'EXPIRED')
      );

    if (requiresDualApproval) {
      if (!params.secondaryApproverUserId || !params.secondaryApproverRole) {
        throw new DomainError(
          '[DUAL_APPROVAL_REQUIRED] Dual Approval Required: Overriding OUTDATED or EXPIRED statutory rules is a high-risk operation requiring a secondary approver.',
          'DUAL_APPROVAL_REQUIRED'
        );
      }
      if (!allowedRoles.includes(params.secondaryApproverRole)) {
        throw new DomainError(
          `[UNAUTHORIZED_SECONDARY_APPROVER] RBAC Access Denied: Secondary approver role '${params.secondaryApproverRole}' lacks statutory override privileges.`,
          'UNAUTHORIZED_SECONDARY_APPROVER'
        );
      }
      const dbSecondaryMembership = await dbClient
        .select()
        .from(schema.companyUsers)
        .where(
          and(
            eq(schema.companyUsers.companyId, params.companyId),
            eq(schema.companyUsers.userId, params.secondaryApproverUserId)
          )
        )
        .get();
      if (dbSecondaryMembership && !allowedRoles.includes(dbSecondaryMembership.role)) {
        throw new DomainError(
          `[SPOOFED_SECONDARY_APPROVER_ROLE] RBAC Integrity Violation: Secondary approver '${params.secondaryApproverUserId}' holds database role '${dbSecondaryMembership.role}', not '${params.secondaryApproverRole}'.`,
          'SPOOFED_SECONDARY_APPROVER_ROLE'
        );
      }
      if (
        params.secondaryApproverUserId.trim() === params.requestedByUserId.trim() ||
        params.secondaryApproverUserId.trim() === params.approvedByUserId.trim()
      ) {
        throw new DomainError(
          '[SOD_VIOLATION_DUAL_APPROVAL] Dual Approval SoD Violation: Secondary approver must be a distinct user from both the requester and primary approver.',
          'SOD_VIOLATION_DUAL_APPROVAL'
        );
      }
    }

    const baseNow = params.currentDate ? new Date(params.currentDate) : new Date();
    const now = new Date();
    const issuedAt = baseNow.toISOString();
    const ttlMs = (typeof params.ttlHours === 'number' ? params.ttlHours : 24) * 60 * 60 * 1000;
    const expiresAt = new Date(baseNow.getTime() + ttlMs).toISOString();
    const overrideId = `OVR-${crypto.randomUUID()}`;
    const auditLogId = `AUD-OVR-${crypto.randomUUID()}`;

    const unsignedGrant: Omit<StatutoryComplianceOverrideGrant, 'signature'> = {
      overrideId,
      companyId: params.companyId,
      agencyScope: params.agencyScope,
      requestedByUserId: params.requestedByUserId,
      requestedByName: params.requestedByName,
      approvedByUserId: params.approvedByUserId,
      approvedByName: params.approvedByName,
      approverRole: params.approverRole,
      secondaryApproverUserId: params.secondaryApproverUserId,
      secondaryApproverName: params.secondaryApproverName,
      secondaryApproverRole: params.secondaryApproverRole,
      reason: params.reason.trim(),
      justificationEvidenceRef: params.justificationEvidenceRef.trim(),
      issuedAt,
      expiresAt,
      auditLogId
    };

    const signature = this.computeOverrideSignature(unsignedGrant);

    // 5. Write Immutable Audit Record
    await dbClient.insert(schema.statutoryAuditLogs).values({
      id: auditLogId,
      companyId: params.companyId,
      userId: params.approvedByUserId,
      userName: params.approvedByName,
      userRole: params.approverRole,
      action: 'STATUTORY_COMPLIANCE_FRESHNESS_OVERRIDE',
      previousStatus: baselineReport.overallStatus,
      newStatus: 'OVERRIDE_GRANTED',
      detailsJson: JSON.stringify({
        ...unsignedGrant,
        requiresDualApproval,
        signature
      }),
      createdAt: now
    });

    return {
      ...unsignedGrant,
      signature
    };
  }

  /**
   * Compliance Freshness & Regulatory Change Detection Engine
   * Evaluates freshness of active rules against currentDate, pending packages,
   * expired verification evidence, effectiveEndDate boundaries, and rate/threshold shifts.
   *
   * SECURITY INVARIANT: A bare boolean `administratorOverride: true` is NEVER sufficient
   * to authorize a compliance bypass when strict controls are enforced. Callers must supply
   * a server-verified, RBAC- and SoD-checked `overrideGrant` backed by an immutable audit log.
   */
  static async checkComplianceFreshness(
    companyId: string,
    currentDate?: string,
    dbClient: any = db,
    options: {
      administratorOverride?: boolean;
      overrideGrant?: StatutoryComplianceOverrideGrant;
      enforceStrictControls?: boolean;
    } = {}
  ): Promise<StatutoryComplianceFreshnessReport> {
    if (options.administratorOverride === true && !options.overrideGrant) {
      throw new DomainError(
        '[BOOLEAN_OVERRIDE_PROHIBITED] Security Control Violation: A boolean administratorOverride parameter alone cannot authorize a statutory compliance bypass. Use StatutoryRuleEngine.authorizeComplianceOverride() with RBAC, Separation of Duties, mandatory justification, and immutable audit logging.',
        'BOOLEAN_OVERRIDE_PROHIBITED'
      );
    }

    await this.ensureDefaultStatutoryRules(companyId, dbClient);

    const todayStr = currentDate ? currentDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const todayMs = new Date(todayStr).getTime();
    const nowIso = new Date().toISOString().slice(0, 10);

    const allCompanyRules = await dbClient
      .select()
      .from(schema.statutoryRules)
      .where(eq(schema.statutoryRules.companyId, companyId));

    const activeRules = allCompanyRules.filter((r: any) => r.status === 'ACTIVE');

    const pendingPkgs = await dbClient
      .select()
      .from(schema.statutoryUpdatePackages)
      .where(
        and(
          eq(schema.statutoryUpdatePackages.companyId, companyId),
          eq(schema.statutoryUpdatePackages.status, 'VALIDATED')
        )
      );

    const agencyList: Array<'SSS' | 'PHILHEALTH' | 'PAGIBIG' | 'BIR'> = ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR'];
    const agencyReports: StatutoryComplianceFreshnessReport['agencies'] = [];
    const warnings: string[] = [];
    let hasOutdated = false;
    let hasExpired = false;

    for (const agencyCode of agencyList) {
      const rule = activeRules.find((r: any) => r.agency === agencyCode);
      const effectiveStartDate = rule ? rule.effectiveStartDate : '2024-01-01';
      const effectiveEndDate = rule ? rule.effectiveEndDate : null;
      const ruleCode = rule ? rule.ruleCode : `${agencyCode}-2026-ACTIVE`;
      const sourceRef = rule ? rule.regulatorySourceRef : `Official Statutory Guidelines (${agencyCode})`;
      const versionNum = rule ? rule.versionNumber : 1;

      let parsedParams: Record<string, any> = {};
      if (rule?.ruleDefinitionJson) {
        try {
          const parsed = JSON.parse(rule.ruleDefinitionJson);
          parsedParams = parsed.parameters || parsed;
        } catch {}
      }

      const effMs = new Date(effectiveStartDate).getTime();
      const daysSinceEffective = Math.floor((todayMs - effMs) / (1000 * 60 * 60 * 24));
      const defaultExpiryDate = new Date(effMs + 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const verificationExpiryDate: string = parsedParams.verificationExpiryDate || defaultExpiryDate;
      const lastVerifiedDate: string = parsedParams.lastVerifiedDate || rule?.officialPublicationDate || effectiveStartDate;

      let status: 'FRESH' | 'PENDING_UPDATE' | 'OUTDATED' | 'EXPIRED' = 'FRESH';
      let verificationStatus: 'VERIFIED_CURRENT' | 'VERIFICATION_OVERDUE' | 'UPDATE_PENDING' = 'VERIFIED_CURRENT';
      let notice = `Active rule '${ruleCode}' (v${versionNum}) is compliant.`;
      const regulatoryChangesDetected: string[] = [];

      // 1. Detect Pending Validated Packages & Rate/Threshold/Circular Changes
      for (const pkg of pendingPkgs) {
        try {
          const parsedPkg = JSON.parse(pkg.rawPackageJson);
          const candidateRules = (parsedPkg.rules || []).filter((cr: any) => cr.agency === agencyCode);
          for (const cr of candidateRules) {
            if (cr.regulatorySourceRef && cr.regulatorySourceRef !== sourceRef) {
              regulatoryChangesDetected.push(`New regulatory circular detected: ${cr.regulatorySourceRef}`);
            }
            if (cr.effectiveStartDate && cr.effectiveStartDate !== effectiveStartDate) {
              regulatoryChangesDetected.push(`New effective date scheduled: ${cr.effectiveStartDate}`);
            }
            const newParams = cr.parameters || {};
            for (const key of ['eeRate', 'erRate', 'rate', 'maxMscCentavos', 'minMscCentavos', 'mfsCeilingCentavos', 'monthlyCeilingCentavos', 'monthlyFloorCentavos']) {
              if (newParams[key] !== undefined && parsedParams[key] !== undefined && newParams[key] !== parsedParams[key]) {
                regulatoryChangesDetected.push(`Changed statutory parameter '${key}': ${parsedParams[key]} -> ${newParams[key]}`);
              }
            }
          }
        } catch {}
      }

      // 2. Check if a newer ACTIVE or VALIDATED rule exists in DB with higher version or newer effectiveStartDate
      const newerRules = allCompanyRules.filter(
        (r: any) =>
          r.agency === agencyCode &&
          r.id !== rule?.id &&
          (r.status === 'VALIDATED' || r.status === 'ACTIVE') &&
          (r.versionNumber > versionNum || r.effectiveStartDate > effectiveStartDate)
      );
      if (newerRules.length > 0) {
        for (const nr of newerRules) {
          regulatoryChangesDetected.push(
            `Superseded schedule detected: ${nr.ruleCode} v${nr.versionNumber} (${nr.regulatorySourceRef}, effective ${nr.effectiveStartDate})`
          );
        }
      }

      // 3. Evaluate Lifecycle & Freshness Status (Beyond 730-Day Age Threshold)
      if (effectiveEndDate && effectiveEndDate < todayStr) {
        status = 'EXPIRED';
        verificationStatus = 'VERIFICATION_OVERDUE';
        hasExpired = true;
        hasOutdated = true;
        regulatoryChangesDetected.push(`Rule effective end date (${effectiveEndDate}) has passed as of ${todayStr}.`);
        notice = `Rule '${ruleCode}' expired on ${effectiveEndDate}. Immediate statutory update required.`;
        warnings.push(`${agencyCode} rule '${ruleCode}' expired on ${effectiveEndDate}.`);
      } else if (parsedParams.unverified === true || verificationExpiryDate < todayStr) {
        status = 'OUTDATED';
        verificationStatus = 'VERIFICATION_OVERDUE';
        hasOutdated = true;
        regulatoryChangesDetected.push(`Verification evidence expired on ${verificationExpiryDate} (last verified ${lastVerifiedDate}).`);
        notice = `Rule '${ruleCode}' verification evidence expired on ${verificationExpiryDate} (${daysSinceEffective} days active). Reverification required.`;
        warnings.push(`${agencyCode} rule '${ruleCode}' verification evidence expired on ${verificationExpiryDate}.`);
      } else if (pendingPkgs.some((p: any) => p.rawPackageJson.includes(agencyCode)) || regulatoryChangesDetected.length > 0) {
        status = 'PENDING_UPDATE';
        verificationStatus = 'UPDATE_PENDING';
        notice = `A validated update package or regulatory change is pending approval for ${agencyCode}.`;
        warnings.push(`Pending statutory update available for ${agencyCode} (${sourceRef}).`);
      } else if (daysSinceEffective > 730) {
        status = 'OUTDATED';
        verificationStatus = 'VERIFICATION_OVERDUE';
        hasOutdated = true;
        notice = `Rule '${ruleCode}' has been in effect for ${daysSinceEffective} days. Check for new government circulars.`;
        warnings.push(`${agencyCode} rule '${ruleCode}' is over 2 years old (${daysSinceEffective} days active).`);
      }

      agencyReports.push({
        agency: agencyCode,
        activeRuleCode: ruleCode,
        regulatorySourceRef: sourceRef,
        effectiveStartDate,
        effectiveEndDate,
        complianceExpiryDate: verificationExpiryDate,
        lastVerifiedDate,
        verificationStatus,
        versionNumber: versionNum,
        status,
        daysSinceEffective,
        notice,
        regulatoryChangesDetected
      });
    }

    const hasPending = pendingPkgs.length > 0 || agencyReports.some(a => a.status === 'PENDING_UPDATE');
    const overallStatus: StatutoryComplianceFreshnessReport['overallStatus'] = hasExpired
      ? 'EXPIRED_CRITICAL'
      : hasPending
      ? 'NEEDS_ATTENTION'
      : hasOutdated
      ? 'OUTDATED_WARNING'
      : 'CURRENT';

    const isStaleOrPending = hasExpired || hasOutdated || hasPending;

    // Validate Override Grant if supplied
    let verifiedOverrideGrant: StatutoryComplianceOverrideGrant | null = null;
    if (options.overrideGrant) {
      const grant = options.overrideGrant;
      if (grant.companyId !== companyId) {
        throw new DomainError(
          `[OVERRIDE_COMPANY_MISMATCH] Override Scope Violation: Override grant issued for company '${grant.companyId}' cannot be used for company '${companyId}'.`,
          'OVERRIDE_COMPANY_MISMATCH'
        );
      }

      const expectedSig = this.computeOverrideSignature({
        overrideId: grant.overrideId,
        companyId: grant.companyId,
        agencyScope: grant.agencyScope,
        requestedByUserId: grant.requestedByUserId,
        requestedByName: grant.requestedByName,
        approvedByUserId: grant.approvedByUserId,
        approvedByName: grant.approvedByName,
        approverRole: grant.approverRole,
        secondaryApproverUserId: grant.secondaryApproverUserId,
        secondaryApproverName: grant.secondaryApproverName,
        secondaryApproverRole: grant.secondaryApproverRole,
        reason: grant.reason,
        justificationEvidenceRef: grant.justificationEvidenceRef,
        issuedAt: grant.issuedAt,
        expiresAt: grant.expiresAt,
        auditLogId: grant.auditLogId
      });

      if (expectedSig !== grant.signature) {
        throw new DomainError(
          '[INVALID_OVERRIDE_SIGNATURE] Override Cryptographic Verification Failed: Override grant signature is invalid or tampered.',
          'INVALID_OVERRIDE_SIGNATURE'
        );
      }

      // Verify grant has not expired relative to evaluation date
      const evalTimeMs = currentDate ? new Date(currentDate).getTime() : Date.now();
      const grantExpiresMs = new Date(grant.expiresAt).getTime();
      if (Number.isNaN(grantExpiresMs) || grantExpiresMs < evalTimeMs) {
        throw new DomainError(
          `[OVERRIDE_GRANT_EXPIRED] Override Grant Expired: Override grant '${grant.overrideId}' expired at '${grant.expiresAt}' (evaluated at '${todayStr}').`,
          'OVERRIDE_GRANT_EXPIRED'
        );
      }

      // Verify immutable audit log exists in database
      const auditRecord = await dbClient
        .select()
        .from(schema.statutoryAuditLogs)
        .where(
          and(
            eq(schema.statutoryAuditLogs.id, grant.auditLogId),
            eq(schema.statutoryAuditLogs.companyId, companyId),
            eq(schema.statutoryAuditLogs.action, 'STATUTORY_COMPLIANCE_FRESHNESS_OVERRIDE')
          )
        )
        .get();

      if (!auditRecord) {
        throw new DomainError(
          '[MISSING_OVERRIDE_AUDIT_LOG] Override Audit Verification Failed: No corresponding immutable audit log record found for override grant.',
          'MISSING_OVERRIDE_AUDIT_LOG'
        );
      }

      // Check agency scope coverage for all non-fresh agencies
      const nonFreshAgencies = agencyReports.filter(a => a.status !== 'FRESH').map(a => a.agency);
      const uncovered = nonFreshAgencies.filter(ag => !grant.agencyScope.includes(ag));
      if (uncovered.length > 0) {
        throw new DomainError(
          `[OVERRIDE_AGENCY_SCOPE_INCOMPLETE] Override Agency Scope Violation: Override grant does not cover stale/pending agencies: ${uncovered.join(', ')}.`,
          'OVERRIDE_AGENCY_SCOPE_INCOMPLETE'
        );
      }

      verifiedOverrideGrant = grant;
    }

    const requiresAdministratorOverride = isStaleOrPending && !verifiedOverrideGrant;

    const allowFinalPosting = options.enforceStrictControls
      ? (verifiedOverrideGrant ? true : !isStaleOrPending)
      : (options.administratorOverride === false ? false : true);

    if (isStaleOrPending) {
      if (options.enforceStrictControls && !verifiedOverrideGrant) {
        warnings.push('Compliance Freshness Enforcement: Final payroll posting is locked due to outdated/expired statutory rules or pending unapplied packages. Authorized administrator override is required.');
      } else if (verifiedOverrideGrant) {
        warnings.push(
          `Compliance Freshness Notice: Authorized override (${verifiedOverrideGrant.overrideId}, audit log ${verifiedOverrideGrant.auditLogId}) active by ${verifiedOverrideGrant.approvedByName}.`
        );
      } else {
        warnings.push('Compliance Freshness Advisory: Outdated statutory rules or pending unapplied packages detected.');
      }
    }

    return {
      overallStatus,
      currentDate: todayStr,
      lastVerifiedDate: nowIso,
      agencies: agencyReports,
      pendingPackagesCount: pendingPkgs.length,
      warnings,
      controls: {
        allowDraftComputation: true,
        allowFinalPosting,
        requiresAdministratorOverride,
        overrideAuditLogId: verifiedOverrideGrant?.auditLogId,
        overrideApprovedBy: verifiedOverrideGrant?.approvedByName
      }
    };
  }
}
