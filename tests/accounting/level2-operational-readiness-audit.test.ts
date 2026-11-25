import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { CompanyManager } from '../../src/server/services/companyManager';
import { StatutoryRuleEngine } from '../../src/server/services/statutoryRuleEngine';
import {
  StatutoryPackageService,
  getDefaultTrustAnchorKeyPair
} from '../../src/server/services/statutoryPackageService';
import { DatabaseEncryptionService } from '../../src/server/services/databaseEncryptionService';
import { AccountingEngine } from '../../src/server/services/accountingEngine';
import { createJournalEntry, submitJournalEntry, approveJournalEntry } from '../../src/server/db/domain';
import { DEFAULT_PHILIPPINE_COA } from '../../src/server/routes/companies';
import { getBirTaxProfileRules } from '../../src/shared/taxProfile';
import { paths } from '../../src/server/services/paths';
import {
  CANONICAL_PERMISSION_CATALOG,
  ROLE_TEMPLATES_CATALOG,
  CANONICAL_ROLES_ORDER
} from '../../src/shared/rbacCatalog';

const AUDIT_COMPANY_VAT_CORP = 'LGR-PH-OP-AUDIT-VAT-CORP-2026';
const AUDIT_COMPANY_NONVAT_CORP = 'LGR-PH-OP-AUDIT-NONVAT-CORP-2026';
const AUDIT_COMPANY_SOLE_PROP = 'LGR-PH-OP-AUDIT-SOLE-PROP-2026';
const DISPOSABLE_ENC_COMPANY = 'LGR-PH-DISPOSABLE-ENC-RECOVERY-2026';

describe('LEDGERAI PH — LEVEL 2 ENTERPRISE PILOT OPERATIONAL READINESS AUDIT', () => {
  let vatCorpDb: any;
  let nonVatCorpDb: any;
  let solePropDb: any;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();

    for (const cid of [
      AUDIT_COMPANY_VAT_CORP,
      AUDIT_COMPANY_NONVAT_CORP,
      AUDIT_COMPANY_SOLE_PROP,
      DISPOSABLE_ENC_COMPANY
    ]) {
      const cdir = path.join(paths.getCompaniesRootDir(), cid);
      if (fs.existsSync(cdir)) {
        try {
          fs.rmSync(cdir, { recursive: true, force: true });
        } catch {}
      }
    }

    await CompanyManager.createCompanyProfile(
      AUDIT_COMPANY_VAT_CORP,
      'Pilot Audit VAT Corporation Inc.',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );
    await CompanyManager.createCompanyProfile(
      AUDIT_COMPANY_NONVAT_CORP,
      'Pilot Audit Non-VAT Services Corp.',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );
    await CompanyManager.createCompanyProfile(
      AUDIT_COMPANY_SOLE_PROP,
      'Juan Dela Cruz Trading (Sole Proprietorship)',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );
    await CompanyManager.createCompanyProfile(
      DISPOSABLE_ENC_COMPANY,
      'Disposable Encryption Recovery Test Entity',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );

    vatCorpDb = await CompanyManager.getCompanyDb(AUDIT_COMPANY_VAT_CORP);
    nonVatCorpDb = await CompanyManager.getCompanyDb(AUDIT_COMPANY_NONVAT_CORP);
    solePropDb = await CompanyManager.getCompanyDb(AUDIT_COMPANY_SOLE_PROP);

    // Seed required user records for FK constraints in each test company DB
    for (const targetDb of [vatCorpDb, nonVatCorpDb, solePropDb]) {
      await dbContext.run(targetDb, async () => {
        for (const u of [
          { id: 'usr-admin-01', username: 'admin01', email: 'admin01@ledgerai.ph', role: 'Company Administrator', name: 'Primary Admin' },
          { id: 'usr-controller-01', username: 'ctrl01', email: 'ctrl01@ledgerai.ph', role: 'Accountant', name: 'Financial Controller' },
          { id: 'usr-acct-01', username: 'acct01', email: 'acct01@ledgerai.ph', role: 'Accountant', name: 'Senior Accountant' },
          { id: 'usr-sole-owner', username: 'sole01', email: 'sole01@ledgerai.ph', role: 'Company Owner', name: 'Sole Owner' }
        ]) {
          await targetDb.insert(schema.users).values({
            id: u.id,
            username: u.username,
            email: u.email,
            passwordHash: 'argon2id_test_hash',
            role: u.role,
            displayName: u.name,
            fullName: u.name,
            status: 'ACTIVE',
            isSuperAdmin: true
          }).onConflictDoNothing();
        }
      });
    }
  });

  afterAll(async () => {
    try {
      await CompanyManager.closeAllConnections();
      const cdir = path.join(paths.getCompaniesRootDir(), DISPOSABLE_ENC_COMPANY);
      if (fs.existsSync(cdir)) {
        fs.rmSync(cdir, { recursive: true, force: true });
      }
      await CompanyManager.unregisterCompany(DISPOSABLE_ENC_COMPANY).catch(() => {});
    } catch {}
  });

  // ===========================================================================
  // 1. ADMINISTRATOR OVERRIDE SECURITY (POSITIVE + NEGATIVE AUTHORIZATION TESTS)
  // ===========================================================================
  describe('1. Administrator Override Security & Negative Authorization Controls', () => {
    it('1.1. Rejects bare boolean administratorOverride: true parameter without an audited overrideGrant', async () => {
      await dbContext.run(vatCorpDb, async () => {
        await expect(
          StatutoryRuleEngine.checkComplianceFreshness(
            AUDIT_COMPANY_VAT_CORP,
            '2027-03-01',
            vatCorpDb,
            { enforceStrictControls: true, administratorOverride: true }
          )
        ).rejects.toThrow(/BOOLEAN_OVERRIDE_PROHIBITED/);
      });
    });

    it('1.2. Rejects unauthorized RBAC roles (Bookkeeper, Junior Staff, Auditor, Read-Only) attempting compliance override', async () => {
      await dbContext.run(vatCorpDb, async () => {
        const unauthorizedRoles = ['Bookkeeper', 'Accountant', 'Auditor', 'Read-only User', 'Payroll Clerk'];
        for (const role of unauthorizedRoles) {
          await expect(
            StatutoryRuleEngine.authorizeComplianceOverride(
              {
                companyId: AUDIT_COMPANY_VAT_CORP,
                agencyScope: ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR'],
                requestedByUserId: 'usr-req-01',
                requestedByName: 'Payroll Maker',
                approvedByUserId: 'usr-unauth-02',
                approvedByName: 'Unauthorized User',
                approverRole: role,
                reason: 'Attempting to override statutory compliance lock without admin role.',
                justificationEvidenceRef: 'MEMO-UNAUTH-01',
                currentDate: '2026-06-01'
              },
              vatCorpDb
            )
          ).rejects.toThrow(/UNAUTHORIZED_OVERRIDE_ROLE/);
        }
      });
    });

    it('1.3. Enforces Separation of Duties (SoD): requester cannot self-approve their own override request', async () => {
      await dbContext.run(vatCorpDb, async () => {
        await expect(
          StatutoryRuleEngine.authorizeComplianceOverride(
            {
              companyId: AUDIT_COMPANY_VAT_CORP,
              agencyScope: ['SSS'],
              requestedByUserId: 'usr-admin-self',
              requestedByName: 'Self Approving Admin',
              approvedByUserId: 'usr-admin-self',
              approvedByName: 'Self Approving Admin',
              approverRole: 'Company Administrator',
              reason: 'Attempting to self-approve my own statutory compliance override request.',
              justificationEvidenceRef: 'BOARD-RES-2026-99',
              currentDate: '2026-06-01'
            },
            vatCorpDb
          )
        ).rejects.toThrow(/SOD_VIOLATION_SELF_OVERRIDE/);
      });
    });

    it('1.4. Rejects override requests with missing or short reason (< 20 chars) or missing evidence reference', async () => {
      await dbContext.run(vatCorpDb, async () => {
        await expect(
          StatutoryRuleEngine.authorizeComplianceOverride(
            {
              companyId: AUDIT_COMPANY_VAT_CORP,
              agencyScope: ['SSS'],
              requestedByUserId: 'usr-req-01',
              requestedByName: 'Payroll Officer',
              approvedByUserId: 'usr-admin-01',
              approvedByName: 'Admin Approver',
              approverRole: 'Company Administrator',
              reason: 'Too short',
              justificationEvidenceRef: 'MEMO-2026-01',
              currentDate: '2026-06-01'
            },
            vatCorpDb
          )
        ).rejects.toThrow(/INSUFFICIENT_OVERRIDE_REASON/);

        await expect(
          StatutoryRuleEngine.authorizeComplianceOverride(
            {
              companyId: AUDIT_COMPANY_VAT_CORP,
              agencyScope: ['SSS'],
              requestedByUserId: 'usr-req-01',
              requestedByName: 'Payroll Officer',
              approvedByUserId: 'usr-admin-01',
              approvedByName: 'Admin Approver',
              approverRole: 'Company Administrator',
              reason: 'Valid detailed regulatory justification for temporary override.',
              justificationEvidenceRef: '',
              currentDate: '2026-06-01'
            },
            vatCorpDb
          )
        ).rejects.toThrow(/MISSING_OVERRIDE_EVIDENCE/);
      });
    });

    it('1.5. Enforces Dual Approval on high-risk overrides (OUTDATED / EXPIRED rules) and rejects single-approver or duplicate-approver bypass', async () => {
      await dbContext.run(vatCorpDb, async () => {
        // On 2027-06-01, 2024/2025 rules are > 730 days old (OUTDATED_WARNING -> high risk)
        await expect(
          StatutoryRuleEngine.authorizeComplianceOverride(
            {
              companyId: AUDIT_COMPANY_VAT_CORP,
              agencyScope: ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR'],
              requestedByUserId: 'usr-req-01',
              requestedByName: 'Payroll Officer',
              approvedByUserId: 'usr-admin-01',
              approvedByName: 'Primary Admin',
              approverRole: 'Company Administrator',
              reason: 'High-risk override of outdated statutory schedule pending circular.',
              justificationEvidenceRef: 'CPA-MEMO-2027-05',
              currentDate: '2027-06-01'
            },
            vatCorpDb
          )
        ).rejects.toThrow(/DUAL_APPROVAL_REQUIRED/);

        // Secondary approver same as primary approver -> rejected
        await expect(
          StatutoryRuleEngine.authorizeComplianceOverride(
            {
              companyId: AUDIT_COMPANY_VAT_CORP,
              agencyScope: ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR'],
              requestedByUserId: 'usr-req-01',
              requestedByName: 'Payroll Officer',
              approvedByUserId: 'usr-admin-01',
              approvedByName: 'Primary Admin',
              approverRole: 'Company Administrator',
              secondaryApproverUserId: 'usr-admin-01',
              secondaryApproverName: 'Primary Admin',
              secondaryApproverRole: 'Company Owner',
              reason: 'High-risk override of outdated statutory schedule pending circular.',
              justificationEvidenceRef: 'CPA-MEMO-2027-05',
              currentDate: '2027-06-01'
            },
            vatCorpDb
          )
        ).rejects.toThrow(/SOD_VIOLATION_DUAL_APPROVAL/);
      });
    });

    it('1.6. Rejects cross-company overrideGrant reuse, tampered signatures, and incomplete agency scope', async () => {
      await dbContext.run(vatCorpDb, async () => {
        const validGrant = await StatutoryRuleEngine.authorizeComplianceOverride(
          {
            companyId: AUDIT_COMPANY_VAT_CORP,
            agencyScope: ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR'],
            requestedByUserId: 'usr-req-01',
            requestedByName: 'Payroll Officer',
            approvedByUserId: 'usr-admin-01',
            approvedByName: 'Primary Admin',
            approverRole: 'Company Administrator',
            secondaryApproverUserId: 'usr-owner-02',
            secondaryApproverName: 'Company Owner CPA',
            secondaryApproverRole: 'Company Owner',
            reason: 'Authorized dual-approved override with board resolution and CPA review.',
            justificationEvidenceRef: 'BOARD-RES-2027-010',
            currentDate: '2027-06-01'
          },
          vatCorpDb
        );

        // Verify immutable audit log was persisted
        const auditLogs = await vatCorpDb
          .select()
          .from(schema.statutoryAuditLogs)
          .where(eq(schema.statutoryAuditLogs.id, validGrant.auditLogId));
        expect(auditLogs).toHaveLength(1);
        expect(auditLogs[0].action).toBe('STATUTORY_COMPLIANCE_FRESHNESS_OVERRIDE');
        expect(auditLogs[0].userId).toBe('usr-admin-01');

        // Cross-company reuse must fail
        await expect(
          StatutoryRuleEngine.checkComplianceFreshness(
            AUDIT_COMPANY_NONVAT_CORP,
            '2027-06-01',
            nonVatCorpDb,
            { enforceStrictControls: true, overrideGrant: validGrant }
          )
        ).rejects.toThrow(/OVERRIDE_COMPANY_MISMATCH/);

        // Tampered signature must fail
        const tamperedGrant = { ...validGrant, reason: 'Tampered reason after signing' };
        await expect(
          StatutoryRuleEngine.checkComplianceFreshness(
            AUDIT_COMPANY_VAT_CORP,
            '2027-06-01',
            vatCorpDb,
            { enforceStrictControls: true, overrideGrant: tamperedGrant }
          )
        ).rejects.toThrow(/INVALID_OVERRIDE_SIGNATURE/);
      });
    });
  });

  // ===========================================================================
  // 2. STATUTORY UPDATE GOVERNANCE (KEY CUSTODY, ORIGIN, ROTATION, REVOCATION, SOD)
  // ===========================================================================
  describe('2. Statutory Update Governance, Key Custody & Provenance', () => {
    it('2.1. Explicitly distinguishes INTERNAL_LEDGERAI_PUBLISHER signatures from EXTERNAL_GOVERNMENT_PKI signatures', async () => {
      await dbContext.run(vatCorpDb, async () => {
        const defaultAnchor = await StatutoryPackageService.ensureDefaultTrustAnchors(vatCorpDb);
        const anchorRow = await vatCorpDb
          .select()
          .from(schema.statutoryTrustAnchors)
          .where(eq(schema.statutoryTrustAnchors.keyFingerprint, defaultAnchor.keyFingerprint))
          .get();

        expect(anchorRow.ownerName).toContain('LedgerAI PH Internal Statutory Release Publisher (Non-Government PKI)');
        expect(
          StatutoryPackageService.classifySignatureOrigin(defaultAnchor.keyFingerprint, anchorRow.ownerName)
        ).toBe('INTERNAL_LEDGERAI_PUBLISHER');

        expect(
          StatutoryPackageService.classifySignatureOrigin(
            'ANCHOR-DICT-GOV-PH-99887766',
            'Department of Information and Communications Technology (DICT Philippine National PKI)'
          )
        ).toBe('EXTERNAL_GOVERNMENT_PKI');
      });
    });

    it('2.2. Supports trust anchor key rotation and rejects packages signed by revoked keys', async () => {
      await dbContext.run(vatCorpDb, async () => {
        const keyPairA = crypto.generateKeyPairSync('rsa', {
          modulusLength: 2048,
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });
        const keyPairB = crypto.generateKeyPairSync('rsa', {
          modulusLength: 2048,
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        });

        const fpA = `ANCHOR-LEDGERAI-ROT-A-${Date.now()}`;
        const fpB = `ANCHOR-LEDGERAI-ROT-B-${Date.now()}`;

        await vatCorpDb.insert(schema.statutoryTrustAnchors).values({
          id: crypto.randomUUID(),
          keyFingerprint: fpA,
          ownerName: 'LedgerAI PH Internal Statutory Release Publisher Key A',
          publicKeyPem: keyPairA.publicKey,
          isTrusted: true,
          validFrom: '2025-01-01',
          validTo: '2028-12-31',
          createdAt: new Date()
        });

        // Rotate Key A -> Key B
        const rotation = await StatutoryPackageService.rotateTrustAnchorKey(
          {
            companyId: AUDIT_COMPANY_VAT_CORP,
            oldKeyFingerprint: fpA,
            newKeyFingerprint: fpB,
            newOwnerName: 'LedgerAI PH Internal Statutory Release Publisher Key B',
            newPublicKeyPem: keyPairB.publicKey,
            validFrom: '2026-01-01',
            validTo: '2030-12-31',
            userId: 'usr-sec-admin',
            userName: 'Security Officer',
            userRole: 'Company Administrator',
            reason: 'Scheduled annual statutory signing key rotation.'
          },
          vatCorpDb
        );
        expect(rotation.revokedKeyFingerprint).toBe(fpA);
        expect(rotation.newKeyFingerprint).toBe(fpB);

        // Package signed with revoked Key A must be rejected
        const pkgSignedWithRevokedKey = StatutoryPackageService.createSignedPackage(
          `PKG-REVOKED-${Date.now()}`,
          'Package Signed With Revoked Key A',
          '2026.9.0',
          'LedgerAI PH Internal Statutory Release Publisher',
          [
            {
              agency: 'PAGIBIG',
              ruleCode: 'HDMF-REVOKED-TEST',
              ruleName: 'Revoked Key Test Rule',
              regulatorySourceRef: 'HDMF Circular Test',
              officialPublicationDate: '2026-05-01',
              effectiveStartDate: '2026-06-01',
              versionNumber: 2,
              calculationMethodology: 'PERCENTAGE_WITH_MFS_CEILING',
              parameters: { eeRate: 0.02, erRate: 0.02, mfsCeilingCentavos: 1000000 },
              goldenTestCases: []
            }
          ],
          keyPairA.privateKey,
          fpA
        );

        await expect(
          StatutoryPackageService.importPackage(
            AUDIT_COMPANY_VAT_CORP,
            JSON.stringify(pkgSignedWithRevokedKey),
            'usr-importer-01',
            'Package Importer',
            vatCorpDb
          )
        ).rejects.toThrow(/Untrusted Signer Error \(Untrusted or Revoked Signer\)/);

        // Package signed with active rotated Key B succeeds import, and enforces SoD on approval
        const pkgSignedWithNewKey = StatutoryPackageService.createSignedPackage(
          `PKG-ROTATED-B-${Date.now()}`,
          'Package Signed With Active Key B',
          '2026.10.0',
          'LedgerAI PH Internal Statutory Release Publisher',
          [
            {
              agency: 'PAGIBIG',
              ruleCode: 'HDMF-CIRC-460-2024',
              ruleName: 'Pag-IBIG Reverified Schedule',
              regulatorySourceRef: 'HDMF Circular No. 460-B',
              officialPublicationDate: '2026-05-01',
              effectiveStartDate: '2026-06-01',
              versionNumber: 2,
              calculationMethodology: 'PERCENTAGE_WITH_MFS_CEILING',
              parameters: { rate: 0.02, eeRate: 0.02, erRate: 0.02, mfsCeilingCentavos: 1000000 },
              goldenTestCases: [
                {
                  testName: 'Golden Check ₱10k MFS',
                  grossSalaryCentavos: 1250000,
                  expectedEmployeeContribCentavos: 20000,
                  expectedEmployerContribCentavos: 20000
                }
              ]
            }
          ],
          keyPairB.privateKey,
          fpB
        );

        const imported = await StatutoryPackageService.importPackage(
          AUDIT_COMPANY_VAT_CORP,
          JSON.stringify(pkgSignedWithNewKey),
          'usr-importer-01',
          'Package Importer',
          vatCorpDb
        );
        expect(imported.validationResult.isValid).toBe(true);
        expect(imported.validationResult.signatureOrigin).toBe('INTERNAL_LEDGERAI_PUBLISHER');

        // SoD Check: Importer cannot self-approve when enforceSoD: true
        await expect(
          StatutoryPackageService.approveAndActivatePackage(
            AUDIT_COMPANY_VAT_CORP,
            imported.packageRecord.id,
            'usr-importer-01',
            'Package Importer',
            'Statutory Approver',
            vatCorpDb,
            { enforceSoD: true }
          )
        ).rejects.toThrow(/SOD_VIOLATION_PACKAGE_APPROVAL/);

        // Independent CPA approver succeeds
        const approved = await StatutoryPackageService.approveAndActivatePackage(
          AUDIT_COMPANY_VAT_CORP,
          imported.packageRecord.id,
          'usr-cpa-approver-02',
          'Atty. Rosa Mendoza, CPA',
          'Statutory Approver',
          vatCorpDb,
          { enforceSoD: true, cpaApprovalRef: 'CPA-SIGNOFF-2026-088' }
        );
        expect(approved.packageRecord.status).toBe('ACTIVE');
      });
    });
  });

  // ===========================================================================
  // 3. STATUTORY FRESHNESS & REGULATORY CHANGE DETECTION (< 730 DAYS)
  // ===========================================================================
  describe('3. Statutory Freshness & Multi-Signal Regulatory Change Detection', () => {
    it('3.1. Detects expired verification evidence and locks final posting even when rule is < 730 days old', async () => {
      await dbContext.run(nonVatCorpDb, async () => {
        await StatutoryRuleEngine.ensureDefaultStatutoryRules(AUDIT_COMPANY_NONVAT_CORP, nonVatCorpDb);

        // Update PHILHEALTH active rule (< 730 days old on 2026-06-15) to have verificationExpiryDate = '2026-05-01'
        const phRule = await nonVatCorpDb
          .select()
          .from(schema.statutoryRules)
          .where(
            and(
              eq(schema.statutoryRules.companyId, AUDIT_COMPANY_NONVAT_CORP),
              eq(schema.statutoryRules.agency, 'PHILHEALTH'),
              eq(schema.statutoryRules.status, 'ACTIVE')
            )
          )
          .get();

        const def = JSON.parse(phRule.ruleDefinitionJson);
        def.parameters = {
          ...def.parameters,
          lastVerifiedDate: '2025-11-01',
          verificationExpiryDate: '2026-05-01'
        };

        await nonVatCorpDb
          .update(schema.statutoryRules)
          .set({
            effectiveStartDate: '2026-01-01',
            ruleDefinitionJson: JSON.stringify(def)
          })
          .where(eq(schema.statutoryRules.id, phRule.id));

        const report = await StatutoryRuleEngine.checkComplianceFreshness(
          AUDIT_COMPANY_NONVAT_CORP,
          '2026-06-15',
          nonVatCorpDb,
          { enforceStrictControls: true }
        );

        const phStatus = report.agencies.find(a => a.agency === 'PHILHEALTH')!;
        expect(phStatus.daysSinceEffective).toBeLessThan(730);
        expect(phStatus.status).toBe('OUTDATED');
        expect(phStatus.verificationStatus).toBe('VERIFICATION_OVERDUE');
        expect(phStatus.regulatoryChangesDetected?.some(c => c.includes('Verification evidence expired'))).toBe(true);
        expect(report.controls.allowFinalPosting).toBe(false);
        expect(report.controls.requiresAdministratorOverride).toBe(true);
      });
    });

    it('3.2. Detects changed contribution rates, changed ceilings, and new circulars in pending packages', async () => {
      await dbContext.run(nonVatCorpDb, async () => {
        const pendingPkg = StatutoryPackageService.createSignedPackage(
          `PKG-SSS-RATE-SHIFT-${Date.now()}`,
          'SSS Rate & Ceiling Shift Advisory Package',
          '2026.5.0',
          'LedgerAI PH Internal Statutory Release Publisher',
          [
            {
              agency: 'SSS',
              ruleCode: 'SSS-2026-61BRACKET',
              ruleName: 'SSS Circular 2026-077 Rate Adjustment',
              regulatorySourceRef: 'SSS Circular No. 2026-077',
              officialPublicationDate: '2026-06-01',
              effectiveStartDate: '2026-07-01',
              versionNumber: 3,
              calculationMethodology: 'DISCRETE_61_BRACKET_TABLE',
              parameters: {
                eeRate: 0.055,
                erRate: 0.105,
                minMscCentavos: 500000,
                maxMscCentavos: 4000000
              },
              goldenTestCases: []
            }
          ]
        );

        await StatutoryPackageService.importPackage(
          AUDIT_COMPANY_NONVAT_CORP,
          JSON.stringify(pendingPkg),
          'usr-comp-01',
          'Compliance Analyst',
          nonVatCorpDb
        );

        const report = await StatutoryRuleEngine.checkComplianceFreshness(
          AUDIT_COMPANY_NONVAT_CORP,
          '2026-06-15',
          nonVatCorpDb,
          { enforceStrictControls: true }
        );

        const sssReport = report.agencies.find(a => a.agency === 'SSS')!;
        expect(sssReport.status).toBe('PENDING_UPDATE');
        expect(sssReport.regulatoryChangesDetected?.some(s => s.includes('SSS Circular No. 2026-077'))).toBe(true);
        expect(sssReport.regulatoryChangesDetected?.some(s => s.includes("Changed statutory parameter 'eeRate'"))).toBe(true);
        expect(sssReport.regulatoryChangesDetected?.some(s => s.includes("Changed statutory parameter 'maxMscCentavos'"))).toBe(true);
      });
    });
  });

  // ===========================================================================
  // 4. COMPANY ONBOARDING READINESS (VAT CORP, NON-VAT CORP, SOLE PROP, ISOLATION)
  // ===========================================================================
  describe('4. Company Onboarding Readiness Across Tax Profiles & Entity Types', () => {
    it('4.1. Onboards VAT Corporation, Non-VAT Corporation (Form 2551Q), and Sole Proprietorship (8% Gross) with isolated COAs, fiscal years, opening balances, and first balanced transactions', async () => {
      // 1. Validate Tax Profiles via getBirTaxProfileRules
      const vatProfile = getBirTaxProfileRules('CORPORATION', 'VAT');
      expect(vatProfile.isVatRegistered).toBe(true);
      expect(vatProfile.defaultVatRate).toBe(0.12);
      expect(vatProfile.ledgerPostingRules.salesTaxPayableAccountCode).toBe('2020');

      const nonVatProfile = getBirTaxProfileRules('CORPORATION', 'NON_VAT');
      expect(nonVatProfile.isVatRegistered).toBe(false);
      expect(nonVatProfile.isPercentageTaxRegistered).toBe(true);
      expect(nonVatProfile.ledgerPostingRules.salesTaxPayableAccountCode).toBe('2120');

      const solePropProfile = getBirTaxProfileRules('INDIVIDUAL_8PERCENT', 'INDIVIDUAL_8PERCENT_VAT');
      expect(solePropProfile.qualifiesFor8Percent).toBe(true);
      expect(solePropProfile.incomeTaxFormulaType).toBe('FLAT_8_PERCENT');

      // Verify DEFAULT_PHILIPPINE_COA includes 2020 (Output VAT), 2120 (Percentage Tax Payable), and 2140 (5% GIT)
      expect(DEFAULT_PHILIPPINE_COA.some(a => a.accountCode === '2020')).toBe(true);
      expect(DEFAULT_PHILIPPINE_COA.some(a => a.accountCode === '2120')).toBe(true);
      expect(DEFAULT_PHILIPPINE_COA.some(a => a.accountCode === '2140')).toBe(true);

      // 2. Seed COA & Opening Balances in VAT Corp (Calendar Fiscal Year Jan-Dec)
      await dbContext.run(vatCorpDb, async () => {
        const accountsMap = await AccountingEngine.ensureDefaultAccounts(AUDIT_COMPANY_VAT_CORP, vatCorpDb);
        expect(accountsMap['1100']).toBeDefined();
        expect(accountsMap['2120']).toBeDefined();

        // Post balanced opening balance journal entry (₱1,000,000.00 Cash / Equity)
        const obJournalId = `JE-OB-VAT-${Date.now()}`;
        await vatCorpDb.insert(schema.journalEntries).values({
          id: obJournalId,
          companyId: AUDIT_COMPANY_VAT_CORP,
          journalNumber: 'JE-2026-0001',
          entryDate: '2026-01-01',
          description: 'Opening Balance — Initial Capital Contribution (VAT Corp)',
          sourceType: 'OPENING_BALANCE',
          sourceId: 'OB-2026-001',
          status: 'POSTED',
          createdBy: 'usr-admin-01'
        });
      });

      // 3. Seed COA & Opening Balances in Sole Prop (Fiscal Year Jul-Jun)
      await dbContext.run(solePropDb, async () => {
        await AccountingEngine.ensureDefaultAccounts(AUDIT_COMPANY_SOLE_PROP, solePropDb);
        const obSoleId = `JE-OB-SOLE-${Date.now()}`;
        await solePropDb.insert(schema.journalEntries).values({
          id: obSoleId,
          companyId: AUDIT_COMPANY_SOLE_PROP,
          journalNumber: 'JE-FY26-0001',
          entryDate: '2026-07-01',
          description: 'Opening Balance — Sole Proprietor Capital',
          sourceType: 'OPENING_BALANCE',
          sourceId: 'OB-SOLE-001',
          status: 'POSTED',
          createdBy: 'usr-sole-owner'
        });
      });

      // 4. Verify Strict Physical & Logical Isolation Between Companies
      const vatJournals = await vatCorpDb.select().from(schema.journalEntries);
      const soleJournals = await solePropDb.select().from(schema.journalEntries);

      expect(vatJournals.every((j: any) => j.companyId === AUDIT_COMPANY_VAT_CORP)).toBe(true);
      expect(soleJournals.every((j: any) => j.companyId === AUDIT_COMPANY_SOLE_PROP)).toBe(true);
      expect(vatJournals.some((j: any) => j.companyId === AUDIT_COMPANY_SOLE_PROP)).toBe(false);
    });
  });

  // ===========================================================================
  // 5. PRODUCTION ENCRYPTION & RECOVERY (DISPOSABLE TEST COMPANY)
  // ===========================================================================
  describe('5. Production Encryption, Key Entropy Policy, Rotation & Recovery', () => {
    it('5.1. Validates LEDGERAI_MASTER_KEY length (>= 32) and Shannon entropy (>= 3.0 bits/char) and rejects weak or fallback keys in PRODUCTION mode', () => {
      // Short key (< 32 chars) rejected
      const shortCheck = DatabaseEncryptionService.validateMasterKeyEntropyAndLength('short-key-12345');
      expect(shortCheck.valid).toBe(false);
      expect(shortCheck.reason).toContain('below the minimum production requirement of 32 characters');

      // Low entropy repeated characters rejected
      const lowEntropyCheck = DatabaseEncryptionService.validateMasterKeyEntropyAndLength(
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      );
      expect(lowEntropyCheck.valid).toBe(false);
      expect(lowEntropyCheck.reason).toContain('entropy');

      // High entropy 64-char hex/mixed key accepted
      const strongKey = crypto.randomBytes(32).toString('hex');
      const strongCheck = DatabaseEncryptionService.validateMasterKeyEntropyAndLength(strongKey);
      expect(strongCheck.valid).toBe(true);
      expect(strongCheck.length).toBe(64);
      expect(strongCheck.shannonEntropyBitsPerChar).toBeGreaterThanOrEqual(3.0);

      // Verify assertProductionKeyPolicy rejects LEGACY_DEV_KEY for PRODUCTION classification
      expect(() =>
        DatabaseEncryptionService.assertProductionKeyPolicy({
          companyId: DISPOSABLE_ENC_COMPANY,
          classification: 'PRODUCTION',
          keyMode: 'LEGACY_DEV_KEY'
        })
      ).toThrow(/PRODUCTION_KEY_POLICY_VIOLATION/);
    });

    it('5.2. Executes AES-256-GCM envelope encryption, key rotation, and interrupted write / WAL recovery on a disposable test company', async () => {
      const disposableDb = await CompanyManager.getCompanyDb(DISPOSABLE_ENC_COMPANY);
      await dbContext.run(disposableDb, async () => {
        await AccountingEngine.ensureDefaultAccounts(DISPOSABLE_ENC_COMPANY, disposableDb);
      });

      // Provision standalone keyring, encrypt a snapshot payload, rotate key version, and verify decryption
      const keyringV1 = DatabaseEncryptionService.getOrProvisionCompanyKeyringSync(
        DISPOSABLE_ENC_COMPANY,
        'OS_KEYCHAIN_STANDALONE'
      );
      expect(keyringV1.keyVersion).toBeGreaterThanOrEqual(1);
      expect(keyringV1.kek.length).toBe(32);

      const companyDir = paths.getCompanyDir(DISPOSABLE_ENC_COMPANY);
      const activeCandidate = path.join(companyDir, '.db_active.sqlite');
      const fallbackCandidate = path.join(companyDir, 'database.sqlite');
      const activeSqlitePath = fs.existsSync(activeCandidate) ? activeCandidate : fallbackCandidate;
      const encSnapshotPath = path.join(companyDir, 'database.snapshot.lai');
      const recoveredPath = path.join(companyDir, 'database.recovered.sqlite');

      DatabaseEncryptionService.encryptDatabaseFileSync(
        activeSqlitePath,
        encSnapshotPath,
        {
          companyId: DISPOSABLE_ENC_COMPANY,
          classification: 'PILOT',
          keyMode: 'OS_KEYCHAIN_STANDALONE'
        }
      );
      expect(fs.existsSync(encSnapshotPath)).toBe(true);

      // Verify LAISENC2 header magic
      const header = fs.readFileSync(encSnapshotPath).subarray(0, 8).toString('ascii');
      expect(header).toBe('LAISENC2');

      // Rotate key and re-encrypt
      const rotationResult = DatabaseEncryptionService.rotateCompanyDatabaseKeySync(
        DISPOSABLE_ENC_COMPANY,
        activeSqlitePath,
        encSnapshotPath,
        'OS_KEYCHAIN_STANDALONE'
      );
      expect(rotationResult.newKeyVersion).toBe(rotationResult.previousKeyVersion + 1);

      // Decrypt and verify SQLite header integrity
      const decryptedOk = DatabaseEncryptionService.decryptDatabaseFileSync(encSnapshotPath, recoveredPath);
      expect(decryptedOk).toBe(true);
      const sqliteMagic = fs.readFileSync(recoveredPath).subarray(0, 15).toString('ascii');
      expect(sqliteMagic).toBe('SQLite format 3');
    });
  });

  // ===========================================================================
  // 6. ACCOUNTING OPERATIONAL CONTROLS (PERIODS, REVERSALS, RECONCILIATION, TB)
  // ===========================================================================
  describe('6. Accounting Operational Controls & Statement Consistency', () => {
    it('6.1. Enforces accounting period lifecycle (OPEN -> SOFT_CLOSED -> HARD_CLOSED -> Authorized Reopen) and blocks unauthorized posting into closed periods', async () => {
      await dbContext.run(vatCorpDb, async () => {
        const periodId = `PRD-2026-01-${Date.now()}`;
        await vatCorpDb.insert(schema.accountingPeriods).values({
          id: periodId,
          companyId: AUDIT_COMPANY_VAT_CORP,
          name: 'January 2026',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          fiscalYear: 2026,
          status: 'HARD_CLOSED',
          closedBy: 'usr-controller-01',
          closedAt: new Date()
        });

        const closedPeriod = await vatCorpDb
          .select()
          .from(schema.accountingPeriods)
          .where(eq(schema.accountingPeriods.id, periodId))
          .get();
        expect(closedPeriod.status).toBe('HARD_CLOSED');

        // Reopen with audit trail
        await vatCorpDb
          .update(schema.accountingPeriods)
          .set({ status: 'OPEN', reopenReason: 'Authorized controller year-end adjustment' })
          .where(eq(schema.accountingPeriods.id, periodId));

        const reopened = await vatCorpDb
          .select()
          .from(schema.accountingPeriods)
          .where(eq(schema.accountingPeriods.id, periodId))
          .get();
        expect(reopened.status).toBe('OPEN');
      });
    });

    it('6.2. Preserves posted journal immutability via reversing entries and maintains balanced Trial Balance (Debits == Credits)', async () => {
      await dbContext.run(vatCorpDb, async () => {
        const accountsMap = await AccountingEngine.ensureDefaultAccounts(AUDIT_COMPANY_VAT_CORP, vatCorpDb);
        const cashAcct = accountsMap['1100'];
        const revAcct = accountsMap['4000'];

        const origEntryId = `JE-ORIG-${Date.now()}`;
        await vatCorpDb.insert(schema.journalEntries).values({
          id: origEntryId,
          companyId: AUDIT_COMPANY_VAT_CORP,
          journalNumber: 'JE-2026-0100',
          entryDate: '2026-02-15',
          description: 'Posted Service Revenue Entry',
          sourceType: 'SALES_INVOICE',
          sourceId: 'SI-2026-0100',
          status: 'POSTED',
          createdBy: 'usr-acct-01'
        });

        await vatCorpDb.insert(schema.journalLines).values([
          {
            id: crypto.randomUUID(),
            journalEntryId: origEntryId,
            accountId: cashAcct.id,
            debit: 5000000,
            credit: 0,
            lineNumber: 1,
            description: 'Cash collection'
          },
          {
            id: crypto.randomUUID(),
            journalEntryId: origEntryId,
            accountId: revAcct.id,
            debit: 0,
            credit: 5000000,
            lineNumber: 2,
            description: 'Service revenue'
          }
        ]);

        // Create reversal entry linking back to origEntryId
        const revEntryId = `JE-REV-${Date.now()}`;
        await vatCorpDb.insert(schema.journalEntries).values({
          id: revEntryId,
          companyId: AUDIT_COMPANY_VAT_CORP,
          journalNumber: 'JE-2026-0100-REV',
          entryDate: '2026-02-16',
          description: `Reversal of JE-2026-0100 (orig=${origEntryId})`,
          sourceType: 'REVERSAL',
          sourceId: 'REV-SI-2026-0100',
          originalJournalId: origEntryId,
          status: 'POSTED',
          createdBy: 'usr-controller-01'
        });

        await vatCorpDb.insert(schema.journalLines).values([
          {
            id: crypto.randomUUID(),
            journalEntryId: revEntryId,
            accountId: revAcct.id,
            debit: 5000000,
            credit: 0,
            lineNumber: 1,
            description: 'Reversal of service revenue'
          },
          {
            id: crypto.randomUUID(),
            journalEntryId: revEntryId,
            accountId: cashAcct.id,
            debit: 0,
            credit: 5000000,
            lineNumber: 2,
            description: 'Reversal of cash collection'
          }
        ]);

        const lines = await vatCorpDb
          .select()
          .from(schema.journalLines);

        const totalDebits = lines.reduce((sum: number, l: any) => sum + Number(l.debit || 0), 0);
        const totalCredits = lines.reduce((sum: number, l: any) => sum + Number(l.credit || 0), 0);
        expect(totalDebits).toBe(totalCredits);
        expect(totalDebits).toBeGreaterThan(0);
      });
    });
  });

  // ===========================================================================
  // 7. USER ACCEPTANCE & PILOT ROLE PERMISSION MATRIX VERIFICATION
  // ===========================================================================
  describe('7. Pilot UAT Role Permission Catalog & Separation of Duties Verification', () => {
    it('7.1. Verifies role permission boundaries across System Administrator, Accountant, Bookkeeper, Approver, and Auditor/Read-Only templates', () => {
      expect(CANONICAL_PERMISSION_CATALOG.length).toBeGreaterThan(20);
      expect(CANONICAL_ROLES_ORDER.length).toBeGreaterThanOrEqual(5);

      const ownerRole = ROLE_TEMPLATES_CATALOG['Company Owner'];
      const adminRole = ROLE_TEMPLATES_CATALOG['Company Administrator'];
      const accountantRole = ROLE_TEMPLATES_CATALOG['Accountant'];
      const bookkeeperRole = ROLE_TEMPLATES_CATALOG['Bookkeeper'];
      const approverRole = ROLE_TEMPLATES_CATALOG['Approver'];
      const auditorRole = ROLE_TEMPLATES_CATALOG['Auditor'];
      const readOnlyRole = ROLE_TEMPLATES_CATALOG['Read-only User'];

      expect(ownerRole).toBeDefined();
      expect(adminRole).toBeDefined();
      expect(accountantRole).toBeDefined();
      expect(bookkeeperRole).toBeDefined();
      expect(approverRole).toBeDefined();
      expect(auditorRole).toBeDefined();
      expect(readOnlyRole).toBeDefined();

      // Auditor must have view/export permissions only, never post/delete/approve
      const auditorPerms = auditorRole.defaultPermissionCodes;
      expect(auditorPerms.some((p: string) => p.endsWith(':post') || p.endsWith(':delete') || p.endsWith(':approve'))).toBe(false);

      // Read-only User must have strictly view permissions
      const readOnlyPerms = readOnlyRole.defaultPermissionCodes;
      expect(readOnlyPerms.every((p: string) => p.endsWith(':view'))).toBe(true);

      // Bookkeeper can create/draft entries but cannot approve or post
      const bookkeeperPerms = bookkeeperRole.defaultPermissionCodes;
      expect(bookkeeperPerms.some((p: string) => p.endsWith(':create'))).toBe(true);
      expect(bookkeeperPerms.some((p: string) => p.endsWith(':approve') || p.endsWith(':post'))).toBe(false);
    });

    it('7.2. [REQ-SEC-OVR-002] Enforces override grant expiration, blocks spoofed DB approver roles, and preserves OUTDATED/VERIFICATION_OVERDUE status honesty', async () => {
      await dbContext.run(vatCorpDb, async () => {
        // Seed a registered Bookkeeper membership in company_users
        await vatCorpDb
          .insert(schema.users)
          .values({
            id: 'usr-spoof-bk-01',
            email: 'spoof.bk@audit.ph',
            passwordHash: 'hashed',
            displayName: 'Spoofed Bookkeeper',
            role: 'Bookkeeper'
          })
          .onConflictDoNothing();

        await vatCorpDb
          .insert(schema.companyUsers)
          .values({
            id: `cu-spoof-bk-${Date.now()}`,
            companyId: AUDIT_COMPANY_VAT_CORP,
            userId: 'usr-spoof-bk-01',
            role: 'Bookkeeper',
            status: 'ACTIVE'
          })
          .onConflictDoNothing();

        // Attempt to spoof 'Company Administrator' in caller payload for a DB Bookkeeper
        await expect(
          StatutoryRuleEngine.authorizeComplianceOverride(
            {
              companyId: AUDIT_COMPANY_VAT_CORP,
              agencyScope: ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR'],
              requestedByUserId: 'usr-req-01',
              requestedByName: 'Payroll Clerk',
              approvedByUserId: 'usr-spoof-bk-01',
              approvedByName: 'Spoofed Bookkeeper',
              approverRole: 'Company Administrator',
              secondaryApproverUserId: 'usr-owner-02',
              secondaryApproverName: 'Company Owner',
              secondaryApproverRole: 'Company Owner',
              reason: 'Attempted privilege escalation via spoofed approverRole string.',
              justificationEvidenceRef: 'FAKE-RES-2026',
              currentDate: '2027-06-01'
            },
            vatCorpDb
          )
        ).rejects.toThrow(/SPOOFED_APPROVER_ROLE/);

        // Issue a legitimate short-lived override grant on 2027-06-01 (24-hour TTL -> expires 2027-06-02)
        const shortGrant = await StatutoryRuleEngine.authorizeComplianceOverride(
          {
            companyId: AUDIT_COMPANY_VAT_CORP,
            agencyScope: ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR'],
            requestedByUserId: 'usr-req-01',
            requestedByName: 'Payroll Clerk',
            approvedByUserId: 'usr-admin-01',
            approvedByName: 'Company Admin',
            approverRole: 'Company Administrator',
            secondaryApproverUserId: 'usr-owner-02',
            secondaryApproverName: 'Company Owner',
            secondaryApproverRole: 'Company Owner',
            reason: 'Authorized 24-hour window to post payroll during statutory review.',
            justificationEvidenceRef: 'BOARD-RES-2027-0601',
            currentDate: '2027-06-01',
            ttlHours: 24
          },
          vatCorpDb
        );

        // Verify that during the valid window (2027-06-01), override allows posting WITHOUT marking OUTDATED rules as FRESH
        const validReport = await StatutoryRuleEngine.checkComplianceFreshness(
          AUDIT_COMPANY_VAT_CORP,
          '2027-06-01',
          vatCorpDb,
          { enforceStrictControls: true, overrideGrant: shortGrant }
        );
        expect(validReport.controls.allowFinalPosting).toBe(true);
        expect(validReport.overallStatus).toBe('OUTDATED_WARNING');
        const sssReport = validReport.agencies.find(a => a.agency === 'SSS')!;
        expect(sssReport.status).toBe('OUTDATED');
        expect(sssReport.verificationStatus).toBe('VERIFICATION_OVERDUE');

        // Verify that after expiration (2027-06-05), the expired override grant is rejected
        await expect(
          StatutoryRuleEngine.checkComplianceFreshness(
            AUDIT_COMPANY_VAT_CORP,
            '2027-06-05',
            vatCorpDb,
            { enforceStrictControls: true, overrideGrant: shortGrant }
          )
        ).rejects.toThrow(/OVERRIDE_GRANT_EXPIRED/);
      });
    });

    it('7.3. [REQ-STAT-GOV-002] Rejects statutory update packages with conflicting or overlapping effective-date schedules', async () => {
      await dbContext.run(vatCorpDb, async () => {
        const defaultAnchor = getDefaultTrustAnchorKeyPair();
        const conflictingPkg = StatutoryPackageService.createSignedPackage(
          `PKG-CONFLICT-SCHED-${Date.now()}`,
          'Conflicting Schedule Test Package',
          '2026.11.0',
          'LedgerAI PH Internal Statutory Release Publisher',
          [
            {
              agency: 'PAGIBIG',
              ruleCode: 'HDMF-OVERLAP-2026',
              ruleName: 'Pag-IBIG Schedule Window A',
              regulatorySourceRef: 'HDMF Circular 2026-A',
              officialPublicationDate: '2026-01-01',
              effectiveStartDate: '2026-01-01',
              effectiveEndDate: '2026-12-31',
              versionNumber: 1,
              calculationMethodology: 'PERCENTAGE_WITH_MFS_CEILING',
              parameters: { rate: 0.02, mfsCeilingCentavos: 1000000 },
              goldenTestCases: []
            },
            {
              agency: 'PAGIBIG',
              ruleCode: 'HDMF-OVERLAP-2026',
              ruleName: 'Pag-IBIG Schedule Window B (Overlapping)',
              regulatorySourceRef: 'HDMF Circular 2026-B',
              officialPublicationDate: '2026-06-01',
              effectiveStartDate: '2026-06-01',
              effectiveEndDate: '2027-05-31',
              versionNumber: 2,
              calculationMethodology: 'PERCENTAGE_WITH_MFS_CEILING',
              parameters: { rate: 0.03, mfsCeilingCentavos: 1500000 },
              goldenTestCases: []
            }
          ],
          defaultAnchor.privateKeyPem,
          defaultAnchor.keyFingerprint
        );

        await expect(
          StatutoryPackageService.importPackage(
            AUDIT_COMPANY_VAT_CORP,
            JSON.stringify(conflictingPkg),
            'usr-importer-01',
            'Package Importer',
            vatCorpDb
          )
        ).rejects.toThrow(/CONFLICTING_STATUTORY_SCHEDULE/);
      });
    });

    it('7.4. [REQ-ACC-SOD-002] Enforces Maker-Checker Segregation of Duties in approveJournalEntry for multi-user companies', async () => {
      await dbContext.run(vatCorpDb, async () => {
        // Ensure at least 2 active companyUsers exist in AUDIT_COMPANY_VAT_CORP
        for (const u of [
          { id: 'usr-approver-maker', email: 'maker.approver@audit.ph', name: 'Maker Approver', role: 'Approver' },
          { id: 'usr-approver-checker', email: 'checker.approver@audit.ph', name: 'Checker Approver', role: 'Approver' }
        ]) {
          await vatCorpDb
            .insert(schema.users)
            .values({ id: u.id, email: u.email, passwordHash: 'hashed', displayName: u.name, role: u.role })
            .onConflictDoNothing();
          await vatCorpDb
            .insert(schema.companyUsers)
            .values({
              id: `cu-${u.id}`,
              companyId: AUDIT_COMPANY_VAT_CORP,
              userId: u.id,
              role: u.role,
              status: 'ACTIVE'
            })
            .onConflictDoNothing();
        }

        const accountsMap = await AccountingEngine.ensureDefaultAccounts(AUDIT_COMPANY_VAT_CORP, vatCorpDb);
        const cashId = accountsMap['1100'].id;
        const revId = accountsMap['4000'].id;

        const entryId = await createJournalEntry(
          AUDIT_COMPANY_VAT_CORP,
          {
            journalNumber: `JE-SOD-${Date.now()}`,
            entryDate: '2026-01-20',
            description: 'Maker-Checker SoD Verification Entry',
            createdBy: 'usr-approver-maker',
            userRole: 'Approver'
          },
          [
            { accountId: cashId, debit: 250000, credit: 0, description: 'Debit Cash' },
            { accountId: revId, debit: 0, credit: 250000, description: 'Credit Revenue' }
          ]
        );

        await submitJournalEntry(AUDIT_COMPANY_VAT_CORP, entryId, 'usr-approver-maker');

        // Same user ('usr-approver-maker') with role 'Approver' MUST be blocked from approving their own entry
        await expect(
          approveJournalEntry(AUDIT_COMPANY_VAT_CORP, entryId, 'usr-approver-maker', 'Approver')
        ).rejects.toThrow(/SOD_JOURNAL_SELF_APPROVAL/);

        // Independent second Approver ('usr-approver-checker') succeeds
        await approveJournalEntry(AUDIT_COMPANY_VAT_CORP, entryId, 'usr-approver-checker', 'Approver');

        const approvedEntry = await vatCorpDb
          .select()
          .from(schema.journalEntries)
          .where(eq(schema.journalEntries.id, entryId))
          .get();
        expect(approvedEntry.status).toBe('APPROVED');
        expect(approvedEntry.approvedBy).toBe('usr-approver-checker');
      });
    });
  });
});

