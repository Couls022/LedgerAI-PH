import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { CompanyManager } from '../../src/server/services/companyManager';
import {
  StatutoryPackageService,
  getDefaultTrustAnchorKeyPair,
  StatutoryRulePayload
} from '../../src/server/services/statutoryPackageService';
import { StatutoryRuleEngine } from '../../src/server/services/statutoryRuleEngine';
import { dbContext } from '../../src/server/db/context';
import { paths } from '../../src/server/services/paths';

describe('OFFLINE-FIRST PHILIPPINE STATUTORY RULES MANAGEMENT ENGINE', () => {
  const TEST_COMPANY_A = 'LGR-ST-STATUTORY-A-2026';
  const TEST_COMPANY_B = 'LGR-ST-STATUTORY-B-2026';
  const ADMIN_USER_ID = 'statutory-admin-001';
  let companyDbA: any;
  let companyDbB: any;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();

    // Clean up test directories
    for (const cid of [TEST_COMPANY_A, TEST_COMPANY_B]) {
      const cdir = path.join(paths.getCompaniesRootDir(), cid);
      if (fs.existsSync(cdir)) {
        try { fs.rmSync(cdir, { recursive: true, force: true }); } catch {}
      }
    }

    // Create fresh test companies
    await CompanyManager.createCompanyProfile(TEST_COMPANY_A, 'Statutory Pilot Enterprise A Corp.', undefined, undefined, false, { classification: 'STRESS_TEST' });
    await CompanyManager.createCompanyProfile(TEST_COMPANY_B, 'Statutory Pilot Enterprise B Corp.', undefined, undefined, false, { classification: 'STRESS_TEST' });

    companyDbA = await CompanyManager.getCompanyDb(TEST_COMPANY_A);
    companyDbB = await CompanyManager.getCompanyDb(TEST_COMPANY_B);

    // Bootstrap trust anchors in Company A
    await dbContext.run(companyDbA, async () => {
      await StatutoryPackageService.ensureDefaultTrustAnchors(companyDbA);
    });
  });

  it('1. Imports and verifies a valid cryptographically signed statutory update package', async () => {
    await dbContext.run(companyDbA, async () => {
      const pkg = StatutoryPackageService.createSignedPackage(
        'PKG-PH-STAT-2026-TEST1',
        '2026 Statutory Rules Package',
        '2026.1.0',
        'Republic of the Philippines Statutory Authority',
        [
          {
            agency: 'SSS',
            ruleCode: 'SSS-2026-TEST',
            ruleName: '2026 SSS Test Schedule',
            regulatorySourceRef: 'RA 11199 Test',
            officialPublicationDate: '2025-01-01',
            effectiveStartDate: '2025-01-01',
            versionNumber: 1,
            calculationMethodology: 'DISCRETE_61_BRACKET_TABLE',
            parameters: { eeRate: 0.05, erRate: 0.10, maxMscCentavos: 3500000 },
            goldenTestCases: [
              {
                testName: 'Junior Staff ₱25k',
                grossSalaryCentavos: 1250000,
                expectedEmployeeContribCentavos: 62500,
                expectedEmployerContribCentavos: 125000
              }
            ]
          }
        ]
      );

      const result = await StatutoryPackageService.importPackage(
        TEST_COMPANY_A,
        JSON.stringify(pkg),
        ADMIN_USER_ID,
        'Atty. Juan Dela Cruz, CPA',
        companyDbA
      );

      expect(result.packageRecord).toBeDefined();
      expect(result.packageRecord.status).toBe('VALIDATED');
      expect(result.validationResult.isValid).toBe(true);
      expect(result.validationResult.signatureVerified).toBe(true);
      expect(result.validationResult.sha256Match).toBe(true);
      expect(result.validationResult.goldenTestResults[0].passed).toBe(true);
    });
  });

  it('2. Rejects tampered statutory package payloads (SHA-256 Mismatch)', async () => {
    await dbContext.run(companyDbA, async () => {
      const validPkg = StatutoryPackageService.createSignedPackage(
        'PKG-PH-STAT-TAMPERED',
        'Tampered Package Test',
        '2026.1.0',
        'Statutory Authority',
        [
          {
            agency: 'SSS',
            ruleCode: 'SSS-TAMPERED',
            ruleName: 'SSS Tampered Test',
            regulatorySourceRef: 'RA 11199',
            officialPublicationDate: '2025-01-01',
            effectiveStartDate: '2025-01-01',
            versionNumber: 1,
            calculationMethodology: 'DISCRETE_61_BRACKET_TABLE',
            parameters: { eeRate: 0.05 },
            goldenTestCases: []
          }
        ]
      );

      // Tamper parameter after signing!
      validPkg.rules[0].parameters.eeRate = 0.99; // Altered parameter!

      await expect(
        StatutoryPackageService.importPackage(
          TEST_COMPANY_A,
          JSON.stringify(validPkg),
          ADMIN_USER_ID,
          'Atty. Juan Dela Cruz, CPA',
          companyDbA
        )
      ).rejects.toThrow(/Cryptographic Integrity Failure/);
    });
  });

  it('3. Rejects statutory packages signed by untrusted signers', async () => {
    await dbContext.run(companyDbA, async () => {
      // Create custom untrusted key pair
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });

      const untrustedPkg = StatutoryPackageService.createSignedPackage(
        'PKG-UNTRUSTED',
        'Untrusted Package Test',
        '1.0.0',
        'Fake Publisher',
        [
          {
            agency: 'PAGIBIG',
            ruleCode: 'HDMF-FAKE',
            ruleName: 'Fake Pag-IBIG',
            regulatorySourceRef: 'Fake Circular',
            officialPublicationDate: '2025-01-01',
            effectiveStartDate: '2025-01-01',
            versionNumber: 1,
            calculationMethodology: 'PERCENTAGE_WITH_MFS_CEILING',
            parameters: {},
            goldenTestCases: []
          }
        ],
        privateKey,
        'UNTRUSTED-KEY-FINGERPRINT-9999'
      );

      await expect(
        StatutoryPackageService.importPackage(
          TEST_COMPANY_A,
          JSON.stringify(untrustedPkg),
          ADMIN_USER_ID,
          'Atty. Juan Dela Cruz, CPA',
          companyDbA
        )
      ).rejects.toThrow(/Untrusted Signer Error/);
    });
  });

  it('4. Rejects duplicate statutory package version import', async () => {
    await dbContext.run(companyDbA, async () => {
      const dupPkg = StatutoryPackageService.createSignedPackage(
        'PKG-DUP-TEST',
        'Duplicate Package Test',
        '2026.1.0',
        'Statutory Authority',
        [
          {
            agency: 'PHILHEALTH',
            ruleCode: 'PHIC-DUP-TEST',
            ruleName: 'PHIC Duplicate Test',
            regulatorySourceRef: 'PhilHealth Circular',
            officialPublicationDate: '2025-01-01',
            effectiveStartDate: '2025-01-01',
            versionNumber: 1,
            calculationMethodology: 'PERCENTAGE_WITH_FLOOR_CEILING',
            parameters: {},
            goldenTestCases: []
          }
        ]
      );

      // Import first time
      await StatutoryPackageService.importPackage(
        TEST_COMPANY_A,
        JSON.stringify(dupPkg),
        ADMIN_USER_ID,
        'Atty. Juan Dela Cruz, CPA',
        companyDbA
      );

      // Import second time -> Expect Duplicate Error
      await expect(
        StatutoryPackageService.importPackage(
          TEST_COMPANY_A,
          JSON.stringify(dupPkg),
          ADMIN_USER_ID,
          'Atty. Juan Dela Cruz, CPA',
          companyDbA
        )
      ).rejects.toThrow(/Duplicate Statutory Package/);
    });
  });

  it('5. Approves and activates a validated package with RBAC authorization', async () => {
    await dbContext.run(companyDbA, async () => {
      const pkg = StatutoryPackageService.createSignedPackage(
        'PKG-ACTIVATE-TEST',
        'Activation Test Package',
        '2026.2.0',
        'Statutory Authority',
        [
          {
            agency: 'PAGIBIG',
            ruleCode: 'HDMF-CIRC-460',
            ruleName: 'Pag-IBIG ₱10k MFS Rule',
            regulatorySourceRef: 'HDMF Circular 460',
            officialPublicationDate: '2024-01-15',
            effectiveStartDate: '2024-02-01',
            versionNumber: 1,
            calculationMethodology: 'PERCENTAGE_WITH_MFS_CEILING',
            parameters: { mfsCeilingCentavos: 1000000, eeRate: 0.02 },
            goldenTestCases: []
          }
        ]
      );

      const imported = await StatutoryPackageService.importPackage(
        TEST_COMPANY_A,
        JSON.stringify(pkg),
        ADMIN_USER_ID,
        'Atty. Juan Dela Cruz, CPA',
        companyDbA
      );

      // Attempt approval with unauthorized role -> Should reject
      await expect(
        StatutoryPackageService.approveAndActivatePackage(
          TEST_COMPANY_A,
          imported.packageRecord.id,
          'unauthorized-user',
          'Junior Staff',
          'Bookkeeper', // Unauthorized role!
          companyDbA
        )
      ).rejects.toThrow(/RBAC Access Denied/);

      // Approve with authorized role
      const activated = await StatutoryPackageService.approveAndActivatePackage(
        TEST_COMPANY_A,
        imported.packageRecord.id,
        ADMIN_USER_ID,
        'Atty. Juan Dela Cruz, CPA',
        'Company Administrator', // Authorized role!
        companyDbA
      );

      expect(activated.packageRecord.status).toBe('ACTIVE');
      expect(activated.activatedRulesCount).toBe(1);
    });
  });

  it('6. Dynamically resolves active approved statutory rules for payroll date', async () => {
    await dbContext.run(companyDbA, async () => {
      const activeRules = await StatutoryRuleEngine.resolveActiveRulesForDate(TEST_COMPANY_A, '2026-10-15', companyDbA);

      expect(activeRules.sssRule).toBeDefined();
      expect(activeRules.philhealthRule).toBeDefined();
      expect(activeRules.pagibigRule).toBeDefined();
      expect(activeRules.birRule).toBeDefined();
    });
  });

  it('7. Evaluates compliance freshness report and detects pending packages', async () => {
    await dbContext.run(companyDbA, async () => {
      const freshness = await StatutoryRuleEngine.checkComplianceFreshness(TEST_COMPANY_A, '2026-10-15', companyDbA);

      expect(freshness).toBeDefined();
      expect(freshness.agencies).toHaveLength(4);
      expect(freshness.controls.allowDraftComputation).toBe(true);
      expect(freshness.controls.allowFinalPosting).toBe(true);
    });
  });

  it('8. Supports package rollback to prior active rule version', async () => {
    await dbContext.run(companyDbA, async () => {
      // 1. Import Version 1
      const pkgV1 = StatutoryPackageService.createSignedPackage(
        'PKG-ROLLBACK-V1',
        'Rollback Test V1',
        '1.0.0',
        'Statutory Authority',
        [
          {
            agency: 'BIR',
            ruleCode: 'BIR-ROLLBACK-TEST',
            ruleName: 'BIR Rule V1',
            regulatorySourceRef: 'RR 11-2018',
            officialPublicationDate: '2023-01-01',
            effectiveStartDate: '2023-01-01',
            versionNumber: 1,
            calculationMethodology: 'GRADUATED',
            parameters: { rate: 0.15 },
            goldenTestCases: []
          }
        ]
      );

      const impV1 = await StatutoryPackageService.importPackage(
        TEST_COMPANY_A,
        JSON.stringify(pkgV1),
        ADMIN_USER_ID,
        'Atty. Juan Dela Cruz, CPA',
        companyDbA
      );

      await StatutoryPackageService.approveAndActivatePackage(
        TEST_COMPANY_A,
        impV1.packageRecord.id,
        ADMIN_USER_ID,
        'Atty. Juan Dela Cruz, CPA',
        'Company Administrator',
        companyDbA
      );

      // 2. Import Version 2
      const pkgV2 = StatutoryPackageService.createSignedPackage(
        'PKG-ROLLBACK-V2',
        'Rollback Test V2',
        '2.0.0',
        'Statutory Authority',
        [
          {
            agency: 'BIR',
            ruleCode: 'BIR-ROLLBACK-TEST',
            ruleName: 'BIR Rule V2',
            regulatorySourceRef: 'RR 11-2018 Updated',
            officialPublicationDate: '2026-01-01',
            effectiveStartDate: '2026-01-01',
            versionNumber: 2,
            calculationMethodology: 'GRADUATED',
            parameters: { rate: 0.20 },
            goldenTestCases: []
          }
        ]
      );

      const impV2 = await StatutoryPackageService.importPackage(
        TEST_COMPANY_A,
        JSON.stringify(pkgV2),
        ADMIN_USER_ID,
        'Atty. Juan Dela Cruz, CPA',
        companyDbA
      );

      await StatutoryPackageService.approveAndActivatePackage(
        TEST_COMPANY_A,
        impV2.packageRecord.id,
        ADMIN_USER_ID,
        'Atty. Juan Dela Cruz, CPA',
        'Company Administrator',
        companyDbA
      );

      // 3. Perform Rollback of V2
      await StatutoryPackageService.rollbackPackage(
        TEST_COMPANY_A,
        impV2.packageRecord.id,
        ADMIN_USER_ID,
        'Atty. Juan Dela Cruz, CPA',
        'Company Administrator',
        'Rollback requested due to statutory dispute',
        companyDbA
      );

      // Verify V1 is re-activated as ACTIVE
      const activeRule = await companyDbA
        .select()
        .from(schema.statutoryRules)
        .where(
          and(
            eq(schema.statutoryRules.companyId, TEST_COMPANY_A),
            eq(schema.statutoryRules.ruleCode, 'BIR-ROLLBACK-TEST'),
            eq(schema.statutoryRules.status, 'ACTIVE')
          )
        )
        .get();

      expect(activeRule).toBeDefined();
      expect(activeRule.versionNumber).toBe(1); // Rolled back to V1!
    });
  });

  it('9. Enforces multi-company data isolation for statutory rules', async () => {
    await dbContext.run(companyDbA, async () => {
      await StatutoryRuleEngine.ensureDefaultStatutoryRules(TEST_COMPANY_A, companyDbA);
    });

    await dbContext.run(companyDbB, async () => {
      await StatutoryRuleEngine.ensureDefaultStatutoryRules(TEST_COMPANY_B, companyDbB);
    });

    await dbContext.run(companyDbA, async () => {
      const rulesA = await companyDbA
        .select()
        .from(schema.statutoryRules)
        .where(eq(schema.statutoryRules.companyId, TEST_COMPANY_A));

      expect(rulesA.every((r: any) => r.companyId === TEST_COMPANY_A)).toBe(true);
    });

    await dbContext.run(companyDbB, async () => {
      const rulesB = await companyDbB
        .select()
        .from(schema.statutoryRules)
        .where(eq(schema.statutoryRules.companyId, TEST_COMPANY_B));

      expect(rulesB.every((r: any) => r.companyId === TEST_COMPANY_B)).toBe(true);
    });
  });
});
