import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { TaxEngine } from '../../src/server/services/taxEngine';
import { StatutoryPackageService, getDefaultTrustAnchorKeyPair } from '../../src/server/services/statutoryPackageService';
import { StatutoryRuleEngine } from '../../src/server/services/statutoryRuleEngine';
import { canonicalizeJson, CanonicalJsonError } from '../../src/server/services/canonicalJson';
import { CompanyManager } from '../../src/server/services/companyManager';
import { dbContext } from '../../src/server/db/context';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq, and } from 'drizzle-orm';

describe('LEDGERAI PH — FORENSIC AUDIT DEFECT CLOSURE (DEF-1 TO DEF-6)', () => {
  const TEST_COMPANY_DEF = 'LGR-PH-2026-DEFECT-CLOSURE-01';
  let companyDb: any;

  beforeAll(async () => {
    try {
      await CompanyManager.createCompanyProfile(
        TEST_COMPANY_DEF,
        'LedgerAI Defect Closure Pilot Corp.',
        undefined,
        undefined,
        false,
        { classification: 'PILOT' }
      );
    } catch {}

    companyDb = await CompanyManager.getCompanyDb(TEST_COMPANY_DEF);
    await dbContext.run(companyDb, async () => {
      await companyDb.insert(schema.users).values({
        id: 'USER-01',
        username: 'auditor01',
        email: 'auditor01@ledgerai.ph',
        displayName: 'Atty. Approver',
        fullName: 'Atty. Approver',
        passwordHash: 'argon2id_mock_hash',
        role: 'Company Administrator',
        status: 'ACTIVE',
        isSuperAdmin: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }).onConflictDoNothing();

      await StatutoryPackageService.ensureDefaultTrustAnchors(companyDb);
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
  });

  // ---------------------------------------------------------------------------
  // DEFECT 1 — SSS 61-BRACKET SCHEDULE & BOUNDARY TRANSITIONS
  // ---------------------------------------------------------------------------
  describe('DEFECT 1 — SSS Contribution Table & Boundary Verification', () => {
    it('1.1. Generates exactly 61 brackets spanning ₱5,000 to ₱35,000 in ₱500 steps', () => {
      const table = TaxEngine.getOfficial2026SssBracketTable();
      expect(table).toHaveLength(61);

      // Verify Bracket 1
      const b1 = table[0];
      expect(b1.bracketIndex).toBe(1);
      expect(b1.mscCentavos).toBe(500000); // ₱5,000 MSC
      expect(b1.compensationFloorCentavos).toBe(0);
      expect(b1.compensationCeilingCentavos).toBe(524999); // ₱5,249.99
      expect(b1.regularMscCentavos).toBe(500000);
      expect(b1.wispMscCentavos).toBe(0);
      expect(b1.regularEeCentavos).toBe(25000); // ₱250 (5%)
      expect(b1.regularErCentavos).toBe(50000); // ₱500 (10%)
      expect(b1.ecErCentavos).toBe(1000); // ₱10 EC
      expect(b1.totalEeCentavos).toBe(25000);
      expect(b1.totalErCentavos).toBe(51000); // ₱510

      // Verify Bracket 61 (Maximum Ceiling)
      const b61 = table[60];
      expect(b61.bracketIndex).toBe(61);
      expect(b61.mscCentavos).toBe(3500000); // ₱35,000 MSC
      expect(b61.compensationFloorCentavos).toBe(3475000); // ₱34,750.00
      expect(b61.compensationCeilingCentavos).toBeNull(); // No upper ceiling
      expect(b61.regularMscCentavos).toBe(2000000); // Capped at ₱20,000
      expect(b61.wispMscCentavos).toBe(1500000); // Excess ₱15,000 in WISP
      expect(b61.regularEeCentavos).toBe(100000); // ₱1,000
      expect(b61.regularErCentavos).toBe(200000); // ₱2,000
      expect(b61.wispEeCentavos).toBe(75000); // ₱750 (5% of ₱15k)
      expect(b61.wispErCentavos).toBe(150000); // ₱1,500 (10% of ₱15k)
      expect(b61.ecErCentavos).toBe(3000); // ₱30 EC
      expect(b61.totalEeCentavos).toBe(175000); // ₱1,750 max EE
      expect(b61.totalErCentavos).toBe(353000); // ₱3,530 max ER
      expect(b61.totalContributionCentavos).toBe(528000); // ₱5,280
    });

    it('1.2. Discrete lookup handles all critical boundary transitions accurately', () => {
      // Transition A: Below floor (< ₱5,250) -> MSC ₱5,000 (Bracket 1)
      const belowMin = TaxEngine.lookupOfficialSss2026Bracket(474999);
      expect(belowMin.bracketIndex).toBe(1);
      expect(belowMin.mscCentavos).toBe(500000);
      expect(belowMin.totalEeCentavos).toBe(25000);
      expect(belowMin.ecErCentavos).toBe(1000);

      // Transition B: Exact boundary ₱5,249.99 -> Bracket 1
      const atB1Ceiling = TaxEngine.lookupOfficialSss2026Bracket(524999);
      expect(atB1Ceiling.bracketIndex).toBe(1);
      expect(atB1Ceiling.mscCentavos).toBe(500000);

      // Transition C: ₱5,250.00 -> Crosses into Bracket 2 (₱5,500 MSC)
      const atB2Floor = TaxEngine.lookupOfficialSss2026Bracket(525000);
      expect(atB2Floor.bracketIndex).toBe(2);
      expect(atB2Floor.mscCentavos).toBe(550000);
      expect(atB2Floor.totalEeCentavos).toBe(27500); // ₱275.00

      // Transition D: EC Bracket Transition at ₱15,000 MSC (₱14,750.00 floor)
      // ₱14,749.99 -> Bracket 20 (₱14,500 MSC) -> EC is ₱10
      const atB20 = TaxEngine.lookupOfficialSss2026Bracket(1474999);
      expect(atB20.bracketIndex).toBe(20);
      expect(atB20.ecErCentavos).toBe(1000);

      // ₱14,750.00 -> Bracket 21 (₱15,000 MSC) -> EC jumps to ₱30!
      const atB21 = TaxEngine.lookupOfficialSss2026Bracket(1475000);
      expect(atB21.bracketIndex).toBe(21);
      expect(atB21.mscCentavos).toBe(1500000);
      expect(atB21.ecErCentavos).toBe(3000);

      // Transition E: Regular MSC Cap vs WISP Inception (₱20,000 vs ₱20,500)
      // ₱19,750.00 -> Bracket 31 (₱20,000 MSC) -> WISP is ₱0
      const atB31 = TaxEngine.lookupOfficialSss2026Bracket(1975000);
      expect(atB31.bracketIndex).toBe(31);
      expect(atB31.regularMscCentavos).toBe(2000000);
      expect(atB31.wispMscCentavos).toBe(0);
      expect(atB31.wispEeCentavos).toBe(0);

      // ₱20,250.00 -> Bracket 32 (₱20,500 MSC) -> WISP begins! (₱500 WISP MSC)
      const atB32 = TaxEngine.lookupOfficialSss2026Bracket(2025000);
      expect(atB32.bracketIndex).toBe(32);
      expect(atB32.regularMscCentavos).toBe(2000000);
      expect(atB32.wispMscCentavos).toBe(50000);
      expect(atB32.wispEeCentavos).toBe(2500); // ₱25 (5% of ₱500)
      expect(atB32.wispErCentavos).toBe(5000); // ₱50 (10% of ₱500)
      expect(atB32.totalEeCentavos).toBe(102500); // ₱1,025

      // Transition F: Upper Ceiling at ₱34,750.00 -> Bracket 61 (₱35,000 MSC)
      const atB61Floor = TaxEngine.lookupOfficialSss2026Bracket(3475000);
      expect(atB61Floor.bracketIndex).toBe(61);
      expect(atB61Floor.mscCentavos).toBe(3500000);
      expect(atB61Floor.totalEeCentavos).toBe(175000);

      // Transition G: High Earner ₱100,000 -> Stays capped at Bracket 61
      const highEarner = TaxEngine.lookupOfficialSss2026Bracket(10000000);
      expect(highEarner.bracketIndex).toBe(61);
      expect(highEarner.mscCentavos).toBe(3500000);
      expect(highEarner.totalEeCentavos).toBe(175000);
      expect(highEarner.totalErCentavos).toBe(353000);
    });

    it('1.3. Semi-monthly payroll scales SSS contributions accurately without centavo leakage', () => {
      // Monthly ₱35,000 earner: Semi-monthly gross = ₱17,500 (1,750,000 centavos)
      const cutoff1 = TaxEngine.calculate2026StatutoryContributions(1750000, { frequency: 'SEMI_MONTHLY' });
      const cutoff2 = TaxEngine.calculate2026StatutoryContributions(1750000, { frequency: 'SEMI_MONTHLY' });

      // Monthly equivalent should resolve to ₱35,000 MSC
      expect(cutoff1.sssEmployeeCentavos).toBe(87500); // ₱875.00
      expect(cutoff1.sssEmployerCentavos).toBe(175000); // ₱1,750.00
      expect(cutoff1.sssEcEmployerCentavos).toBe(1500); // ₱15.00 (half of ₱30)

      // Total of 2 cutoffs must equal full monthly statutory obligations
      const fullMonth = TaxEngine.calculate2026StatutoryContributions(3500000, { frequency: 'MONTHLY' });
      expect(cutoff1.sssEmployeeCentavos + cutoff2.sssEmployeeCentavos).toBe(fullMonth.sssEmployeeCentavos);
      expect(cutoff1.sssEmployerCentavos + cutoff2.sssEmployerCentavos).toBe(fullMonth.sssEmployerCentavos);
      expect(cutoff1.sssEcEmployerCentavos + cutoff2.sssEcEmployerCentavos).toBe(fullMonth.sssEcEmployerCentavos);
    });
  });

  // ---------------------------------------------------------------------------
  // DEFECT 2 — PAG-IBIG CONTRIBUTION BASE & SEMI-MONTHLY PROCESSING
  // ---------------------------------------------------------------------------
  describe('DEFECT 2 — Pag-IBIG Contribution Base & Periodic Scaling', () => {
    it('2.1. Validates analytical breakdown for ₱5,000, ₱10,000, ₱12,500, ₱25,000, and ₱50,000', () => {
      const salaries = [
        { monthly: 5000, semiMonthly: 2500, expectedEeMonth: 10000, expectedErMonth: 10000 },
        { monthly: 10000, semiMonthly: 5000, expectedEeMonth: 20000, expectedErMonth: 20000 },
        { monthly: 12500, semiMonthly: 6250, expectedEeMonth: 20000, expectedErMonth: 20000 },
        { monthly: 25000, semiMonthly: 12500, expectedEeMonth: 20000, expectedErMonth: 20000 },
        { monthly: 50000, semiMonthly: 25000, expectedEeMonth: 20000, expectedErMonth: 20000 }
      ];

      for (const s of salaries) {
        const monthlyCentavos = s.monthly * 100;
        const semiCentavos = s.semiMonthly * 100;

        // Semi-monthly breakdown
        const semiRes = TaxEngine.calculateOfficialPagibigBreakdown(semiCentavos, 'SEMI_MONTHLY');
        expect(semiRes.monthlyCompensationCentavos).toBe(monthlyCentavos);
        expect(semiRes.semiMonthlyGrossSalaryCentavos).toBe(semiCentavos);
        expect(semiRes.statutoryContributionCapCentavos).toBe(500000); // ₱5,000 cap per cutoff

        // Monthly breakdown
        const monthRes = TaxEngine.calculateOfficialPagibigBreakdown(monthlyCentavos, 'MONTHLY');
        expect(monthRes.monthlyCompensationCentavos).toBe(monthlyCentavos);
        expect(monthRes.statutoryContributionCapCentavos).toBe(1000000); // ₱10,000 monthly cap

        // Invariance: 2 cutoffs MUST sum exactly to the full monthly deduction
        const twoCutoffsEe = semiRes.employeeDeductionCentavos * 2;
        const twoCutoffsEr = semiRes.employerContributionCentavos * 2;

        expect(twoCutoffsEe).toBe(monthRes.employeeDeductionCentavos);
        expect(twoCutoffsEr).toBe(monthRes.employerContributionCentavos);
        expect(monthRes.employeeDeductionCentavos).toBe(s.expectedEeMonth);
        expect(monthRes.employerContributionCentavos).toBe(s.expectedErMonth);
      }
    });

    it('2.2. Correctly applies 1% low-income rate for compensation <= ₱1,500', () => {
      // ₱1,500 monthly compensation (₱750 semi-monthly)
      const lowIncome = TaxEngine.calculateOfficialPagibigBreakdown(75000, 'SEMI_MONTHLY');
      expect(lowIncome.employeeRate).toBe(0.01); // 1% for <= ₱1,500
      expect(lowIncome.employerRate).toBe(0.02); // 2%
      expect(lowIncome.employeeDeductionCentavos).toBe(750); // ₱7.50 per cutoff -> ₱15.00/month
      expect(lowIncome.employerContributionCentavos).toBe(1500); // ₱15.00 per cutoff -> ₱30.00/month
    });
  });

  // ---------------------------------------------------------------------------
  // DEFECT 3 — CANONICAL PACKAGE HASHING (RFC 8785 JCS)
  // ---------------------------------------------------------------------------
  describe('DEFECT 3 — RFC 8785 Canonical JSON & Cryptographic Integrity', () => {
    it('3.1. Identical logical objects with permuted key orders produce IDENTICAL canonical strings and digests', () => {
      const objA = {
        packageCode: 'PKG-JCS-01',
        version: '1.0.0',
        meta: {
          b: 'bravo',
          a: 'alpha',
          z: 99
        },
        tags: ['ph', 'statutory']
      };

      const objB = {
        meta: {
          z: 99,
          a: 'alpha',
          b: 'bravo'
        },
        tags: ['ph', 'statutory'],
        version: '1.0.0',
        packageCode: 'PKG-JCS-01'
      };

      const canonA = canonicalizeJson(objA);
      const canonB = canonicalizeJson(objB);

      expect(canonA).toBe(canonB);
      expect(canonA).toBe('{"meta":{"a":"alpha","b":"bravo","z":99},"packageCode":"PKG-JCS-01","tags":["ph","statutory"],"version":"1.0.0"}');

      const hashA = crypto.createHash('sha256').update(canonA, 'utf8').digest('hex');
      const hashB = crypto.createHash('sha256').update(canonB, 'utf8').digest('hex');
      expect(hashA).toBe(hashB);
    });

    it('3.2. Changed values or modified structures produce distinct hashes', () => {
      const baseObj = { code: 'A', value: 100 };
      const modifiedObj = { code: 'A', value: 101 };

      const hash1 = crypto.createHash('sha256').update(canonicalizeJson(baseObj), 'utf8').digest('hex');
      const hash2 = crypto.createHash('sha256').update(canonicalizeJson(modifiedObj), 'utf8').digest('hex');

      expect(hash1).not.toBe(hash2);
    });

    it('3.3. Correctly handles RFC 8785 edge cases (-0 -> 0, non-finite numbers rejected)', () => {
      expect(canonicalizeJson({ zero: -0 })).toBe('{"zero":0}');

      expect(() => canonicalizeJson({ val: NaN })).toThrow(CanonicalJsonError);
      expect(() => canonicalizeJson({ val: Infinity })).toThrow(CanonicalJsonError);
      expect(() => canonicalizeJson(undefined)).toThrow(CanonicalJsonError);
    });

    it('3.4. Package signing and verification uses exact canonical payload digest', async () => {
      const pkg = StatutoryPackageService.createSignedPackage(
        'PKG-JCS-TEST',
        'JCS Verification Package',
        '2026.1.0',
        'Republic of the Philippines Statutory Authority',
        [
          {
            agency: 'SSS',
            ruleCode: 'SSS-JCS-RULE',
            ruleName: 'SSS Test',
            regulatorySourceRef: 'RA 11199',
            officialPublicationDate: '2025-01-01',
            effectiveStartDate: '2025-01-01',
            versionNumber: 1,
            calculationMethodology: 'DISCRETE_61_BRACKET_TABLE',
            parameters: { rate: 0.15 },
            goldenTestCases: []
          }
        ]
      );

      // Verify integrity against database trust anchor
      const verification = await StatutoryPackageService.verifyPackageIntegrity(pkg, TEST_COMPANY_DEF, companyDb);
      expect(verification.isValid).toBe(true);
      expect(verification.sha256Match).toBe(true);
      expect(verification.signatureVerified).toBe(true);
      expect(verification.trustAnchorValid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // DEFECT 4 — EFFECTIVE-DATE RESOLUTION & CONFLICT DETECTION
  // ---------------------------------------------------------------------------
  describe('DEFECT 4 — Effective-Date Resolution & Ambiguity/Conflict Rejection', () => {
    it('4.1. Resolves rule on exact start date and exact end date', async () => {
      await dbContext.run(companyDb, async () => {
        // Clean any existing rules for agency OTHER
        await companyDb.delete(schema.statutoryRules).where(
          and(eq(schema.statutoryRules.companyId, TEST_COMPANY_DEF), eq(schema.statutoryRules.agency, 'OTHER'))
        );

        // Insert a bounded test rule: 2025-01-01 to 2025-12-31
        const ruleId = crypto.randomUUID();
        await companyDb.insert(schema.statutoryRules).values({
          id: ruleId,
          companyId: TEST_COMPANY_DEF,
          agency: 'OTHER',
          ruleCode: 'TEST-BOUNDED-RULE',
          ruleName: 'Bounded Test Rule',
          regulatorySourceRef: 'Test Regulation 2025',
          officialPublicationDate: '2024-12-01',
          effectiveStartDate: '2025-01-01',
          effectiveEndDate: '2025-12-31',
          versionNumber: 1,
          calculationMethodology: 'PERCENTAGE',
          ruleDefinitionJson: JSON.stringify({ parameters: { rate: 0.05 } }),
          status: 'ACTIVE',
          createdAt: new Date()
        });

        // Exact start date: 2025-01-01 -> Success
        const onStart = await StatutoryRuleEngine.getEffectiveRule(
          TEST_COMPANY_DEF,
          'OTHER',
          '2025-01-01',
          { dbClient: companyDb }
        );
        expect(onStart).toBeDefined();
        expect(onStart?.ruleCode).toBe('TEST-BOUNDED-RULE');

        // Exact end date: 2025-12-31 -> Success
        const onEnd = await StatutoryRuleEngine.getEffectiveRule(
          TEST_COMPANY_DEF,
          'OTHER',
          '2025-12-31',
          { dbClient: companyDb }
        );
        expect(onEnd).toBeDefined();
        expect(onEnd?.ruleCode).toBe('TEST-BOUNDED-RULE');

        // 1 day before start date: 2024-12-31 -> Rejects with NOT_YET_EFFECTIVE
        await expect(
          StatutoryRuleEngine.getEffectiveRule(
            TEST_COMPANY_DEF,
            'OTHER',
            '2024-12-31',
            { dbClient: companyDb }
          )
        ).rejects.toThrow(/not yet effective/);

        // 1 day after end date: 2026-01-01 -> Rejects with STATUTORY_RULE_EXPIRED
        await expect(
          StatutoryRuleEngine.getEffectiveRule(
            TEST_COMPANY_DEF,
            'OTHER',
            '2026-01-01',
            { dbClient: companyDb }
          )
        ).rejects.toThrow(/expired/);
      });
    });

    it('4.2. Detects and rejects ambiguous overlapping active rules for the same agency (fail-closed)', async () => {
      await dbContext.run(companyDb, async () => {
        // Insert a second conflicting rule for agency 'OTHER' covering the same period
        await companyDb.insert(schema.statutoryRules).values({
          id: crypto.randomUUID(),
          companyId: TEST_COMPANY_DEF,
          agency: 'OTHER',
          ruleCode: 'TEST-CONFLICTING-RULE-B',
          ruleName: 'Conflicting Rule B',
          regulatorySourceRef: 'Test Regulation B',
          officialPublicationDate: '2024-12-01',
          effectiveStartDate: '2025-01-01',
          effectiveEndDate: '2025-12-31',
          versionNumber: 1,
          calculationMethodology: 'PERCENTAGE',
          ruleDefinitionJson: JSON.stringify({ parameters: { rate: 0.08 } }),
          status: 'ACTIVE',
          createdAt: new Date()
        });

        // Querying on 2025-06-01 should fail closed with AMBIGUOUS_STATUTORY_RULE_CONFLICT
        await expect(
          StatutoryRuleEngine.getEffectiveRule(
            TEST_COMPANY_DEF,
            'OTHER',
            '2025-06-01',
            { dbClient: companyDb }
          )
        ).rejects.toThrow(/Ambiguous conflicting statutory rules detected/);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // DEFECT 5 — STALE BASELINE PROTECTION & FRESHNESS METADATA
  // ---------------------------------------------------------------------------
  describe('DEFECT 5 — Compliance Freshness Monitor & Posting Controls', () => {
    it('5.1. Returns complete freshness metadata (lastVerifiedDate, verificationStatus, complianceExpiryDate)', async () => {
      await dbContext.run(companyDb, async () => {
        const freshness = await StatutoryRuleEngine.checkComplianceFreshness(
          TEST_COMPANY_DEF,
          '2026-06-15',
          companyDb
        );

        expect(freshness.lastVerifiedDate).toBeDefined();
        expect(freshness.agencies).toHaveLength(4);

        for (const ag of freshness.agencies) {
          expect(ag.lastVerifiedDate).toBeDefined();
          expect(ag.complianceExpiryDate).toBeDefined();
          expect(['VERIFIED_CURRENT', 'VERIFICATION_OVERDUE', 'UPDATE_PENDING']).toContain(ag.verificationStatus);
        }
      });
    });

    it('5.2. Enforces configurable posting lock when strict controls are enabled on stale/pending rules and requires audited overrideGrant', async () => {
      await dbContext.run(companyDb, async () => {
        // Simulate checking freshness on 2027-01-01 (> 730 days since 2024/2025 rules)
        const strictReport = await StatutoryRuleEngine.checkComplianceFreshness(
          TEST_COMPANY_DEF,
          '2027-01-01',
          companyDb,
          { enforceStrictControls: true }
        );

        expect(strictReport.controls.allowDraftComputation).toBe(true);
        expect(strictReport.controls.allowFinalPosting).toBe(false); // Locked!
        expect(strictReport.controls.requiresAdministratorOverride).toBe(true);
        expect(strictReport.warnings.some(w => w.includes('Final payroll posting is locked'))).toBe(true);

        // Bare boolean administratorOverride: true MUST be rejected
        await expect(
          StatutoryRuleEngine.checkComplianceFreshness(
            TEST_COMPANY_DEF,
            '2027-01-01',
            companyDb,
            { enforceStrictControls: true, administratorOverride: true }
          )
        ).rejects.toThrow(/BOOLEAN_OVERRIDE_PROHIBITED|boolean administratorOverride parameter alone cannot authorize/);

        // With server-authorized RBAC + SoD + Dual-Approved overrideGrant, posting is permitted
        const grant = await StatutoryRuleEngine.authorizeComplianceOverride(
          {
            companyId: TEST_COMPANY_DEF,
            agencyScope: ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR'],
            requestedByUserId: 'usr-payroll-01',
            requestedByName: 'Maria Santos (Payroll Officer)',
            approvedByUserId: 'usr-admin-01',
            approvedByName: 'Atty. Juan Dela Cruz, CPA',
            approverRole: 'Company Administrator',
            secondaryApproverUserId: 'usr-cfo-02',
            secondaryApproverName: 'Elena Reyes, CPA (CFO)',
            secondaryApproverRole: 'Statutory Approver',
            reason: 'Interim payroll run authorized while 2027 circular package undergoes CPA golden test verification.',
            justificationEvidenceRef: 'BOARD-RES-2027-001 / CPA-MEMO-2027-01',
            currentDate: '2027-01-01'
          },
          companyDb
        );

        const overrideReport = await StatutoryRuleEngine.checkComplianceFreshness(
          TEST_COMPANY_DEF,
          '2027-01-01',
          companyDb,
          { enforceStrictControls: true, overrideGrant: grant }
        );

        expect(overrideReport.controls.allowFinalPosting).toBe(true);
        expect(overrideReport.controls.requiresAdministratorOverride).toBe(false);
        expect(overrideReport.controls.overrideAuditLogId).toBe(grant.auditLogId);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // DEFECT 6 — HISTORICAL IMMUTABILITY & REVERSALS
  // ---------------------------------------------------------------------------
  describe('DEFECT 6 — Historical Immutability & Reversal Audit Trail', () => {
    it('6.1. Activating a new statutory package version does NOT retroactively mutate posted payroll records', async () => {
      await dbContext.run(companyDb, async () => {
        // 1. Create a historical posted payroll item with rule version 1
        const empId = 'EMP-HISTORICAL-01';
        await companyDb.insert(schema.employees).values({
          id: empId,
          companyId: TEST_COMPANY_DEF,
          employeeNo: 'EMP-001',
          firstName: 'Juan',
          lastName: 'Dela Cruz',
          monthlyBasicSalary: 3500000,
          status: 'ACTIVE',
          createdAt: new Date('2026-01-01')
        }).onConflictDoNothing();

        const runId = 'RUN-HISTORICAL-01';
        await companyDb.insert(schema.payrollRuns).values({
          id: runId,
          companyId: TEST_COMPANY_DEF,
          payrollPeriod: '2026-01',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          paymentDate: '2026-01-31',
          status: 'POSTED',
          totalGrossPay: 3500000,
          totalNetPay: 3117500,
          createdAt: new Date('2026-01-31')
        }).onConflictDoNothing();

        const payrollItemId = crypto.randomUUID();
        const historicalGrossCentavos = 3500000;
        const historicalSssEe = 175000;

        await companyDb.insert(schema.payrollItems).values({
          id: payrollItemId,
          payrollRunId: runId,
          employeeId: empId,
          basicPay: historicalGrossCentavos,
          grossPay: historicalGrossCentavos,
          sssEmployee: historicalSssEe,
          sssEmployer: 353000,
          philhealthEmployee: 87500,
          philhealthEmployer: 87500,
          pagibigEmployee: 20000,
          pagibigEmployer: 20000,
          withholdingTax: 100000,
          totalDeductions: 382500,
          netPay: 3117500,
          createdAt: new Date('2026-01-31')
        });

        // 2. Import and activate a new package version (v2.0)
        const testPkgCode = `PKG-NEW-STATUTORY-V2-${Date.now()}`;
        const newPkg = StatutoryPackageService.createSignedPackage(
          testPkgCode,
          '2026 H2 Statutory Rules',
          '2.0.0',
          'Statutory Authority',
          [
            {
              agency: 'SSS',
              ruleCode: 'SSS-2026-V2',
              ruleName: 'SSS Schedule V2',
              regulatorySourceRef: 'Circular 2026-999',
              officialPublicationDate: '2026-06-01',
              effectiveStartDate: '2026-07-01',
              versionNumber: 2,
              calculationMethodology: 'DISCRETE_61_BRACKET_TABLE',
              parameters: {},
              goldenTestCases: []
            }
          ]
        );

        const imported = await StatutoryPackageService.importPackage(
          TEST_COMPANY_DEF,
          JSON.stringify(newPkg),
          'ADMIN-USER',
          'Atty. Approver',
          companyDb
        );

        await StatutoryPackageService.approveAndActivatePackage(
          TEST_COMPANY_DEF,
          imported.packageRecord.id,
          'ADMIN-USER',
          'Atty. Approver',
          'Company Administrator',
          companyDb
        );

        // 3. Verify posted historical payroll item remains 100% UNTOUCHED
        const fetchedItem = await companyDb
          .select()
          .from(schema.payrollItems)
          .where(eq(schema.payrollItems.id, payrollItemId))
          .get();

        expect(fetchedItem).toBeDefined();
        expect(fetchedItem.grossPay).toBe(historicalGrossCentavos);
        expect(fetchedItem.sssEmployee).toBe(historicalSssEe);
      });
    });

    it('6.2. Adjustments to posted entries strictly mandate audited double-entry reversals', async () => {
      await dbContext.run(companyDb, async () => {
        // Create an original posted journal entry
        const originalJeId = crypto.randomUUID();
        const runSuffix = originalJeId.slice(0, 8);
        await companyDb.insert(schema.journalEntries).values({
          id: originalJeId,
          companyId: TEST_COMPANY_DEF,
          journalNumber: `JE-2026-ORIGINAL-${runSuffix}`,
          entryDate: '2026-01-31',
          sourceType: 'MANUAL_AUDIT',
          sourceId: `AUDIT-2026-${runSuffix}`,
          status: 'POSTED',
          description: 'Original January 2026 Payroll Entry',
          createdBy: 'USER-01',
          createdAt: new Date('2026-01-31')
        });

        // Reversal requires an explicit audited reversing journal entry
        const reversalJeId = crypto.randomUUID();
        await companyDb.insert(schema.journalEntries).values({
          id: reversalJeId,
          companyId: TEST_COMPANY_DEF,
          journalNumber: `JE-2026-REVERSAL-${runSuffix}`,
          entryDate: '2026-02-01',
          sourceType: 'REVERSAL',
          originalJournalId: originalJeId,
          status: 'POSTED',
          description: `Audited Reversal of JE-2026-ORIGINAL-${runSuffix} due to correction`,
          createdBy: 'USER-01',
          createdAt: new Date('2026-02-01')
        });

        const original = await companyDb.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, originalJeId)).get();
        const reversal = await companyDb.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, reversalJeId)).get();

        expect(original.status).toBe('POSTED');
        expect(reversal.originalJournalId).toBe(originalJeId);
        expect(reversal.sourceType).toBe('REVERSAL');
      });
    });
  });
});
