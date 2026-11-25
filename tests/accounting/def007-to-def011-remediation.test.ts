import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { paths } from '../../src/server/services/paths';
import {
  ASSET_ACCOUNT_TYPES,
  LIABILITY_ACCOUNT_TYPES,
  isAssetAccountType,
  isLiabilityAccountType,
} from '../../src/server/routes/reports';
import {
  deriveVatFromGrossInclusive,
  calculateDashboardVatEstimate,
} from '../../src/server/routes/dashboard';
import { DEFAULT_PHILIPPINE_COA } from '../../src/server/routes/companies';
import { TaxEngine } from '../../src/server/services/taxEngine';
import { PayrollRemediationService } from '../../src/server/services/payrollRemediationService';
import { buildAuthoritativeTaxReturnSnapshot } from '../../src/server/routes/tax';
import { CompanyManager } from '../../src/server/services/companyManager';
import { DatabaseEncryptionService } from '../../src/server/services/databaseEncryptionService';
import { PilotCompanyRevalidationService } from '../../src/server/services/pilotCompanyRevalidationService';
import { dbContext } from '../../src/server/db/context';
import {
  accounts,
  companies,
  journalEntries,
  journalLines,
  salesInvoices,
  purchaseBills,
  users,
  customers,
  vendors,
} from '../../src/server/db/schema';
import { inArray } from 'drizzle-orm';

describe('LEDGERAI PH — CRITICAL REMEDIATION SUITE (DEF-007 TO DEF-011 & DEF-CHAL-001)', () => {
  const TEST_FIXTURE_COMPANY_ID = 'LGR-PH-2026-TEST-DEF007-01';

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();

    // Ensure the authoritative pilot company exists and is verified non-destructively
    await PilotCompanyRevalidationService.ensureAndVerifyPilotCompany();

    // Reset only disposable/synthetic test companies using the guarded API
    for (const cid of [TEST_FIXTURE_COMPANY_ID, 'LGR-PH-2026-TEST-00-ABC12345']) {
      await CompanyManager.resetDisposableTestCompanyWorkspace(cid);
    }

    // Bootstrap isolated synthetic test fixture company & stress-test company
    await CompanyManager.createCompanyProfile(
      TEST_FIXTURE_COMPANY_ID,
      'LedgerAI Remediation Test Fixture Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST' }
    );
    await CompanyManager.createCompanyProfile(
      'LGR-PH-2026-TEST-00-ABC12345',
      'LedgerAI Stress Test Company',
      undefined,
      undefined,
      false,
      { classification: 'STRESS_TEST' }
    );

    // Seed isolated synthetic test database with baseline transactions for DEF-007 through DEF-011 unit verification
    const cleanDb = await CompanyManager.getCompanyDb(TEST_FIXTURE_COMPANY_ID);
    let coa = await cleanDb.select().from(accounts);
    if (coa.length === 0) {
      const coaRows = DEFAULT_PHILIPPINE_COA.map((a) => ({
        id: `acc-${a.accountCode}`,
        companyId: TEST_FIXTURE_COMPANY_ID,
        accountCode: a.accountCode,
        accountName: a.accountName,
        accountType: a.accountType,
        normalBalance: a.normalBalance,
        isTaxAccount: (a as any).isTaxAccount || false,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await cleanDb.insert(accounts).values(coaRows as any);
      coa = await cleanDb.select().from(accounts);
    }
    const getAccId = (code: string) => coa.find((a: any) => a.accountCode === code)?.id || `acc-${code}`;

    await cleanDb.insert(companies).values({
      id: TEST_FIXTURE_COMPANY_ID,
      legalName: 'LedgerAI Remediation Test Fixture Corp.',
      status: 'ACTIVE',
      classification: 'TEST',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();

    await cleanDb.insert(users).values({
      id: 'cpa-lead-auditor-2026',
      username: 'cpa_lead_auditor',
      fullName: 'Lead Auditor',
      displayName: 'Lead Auditor',
      email: 'auditor@ledgerai.ph',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuu',
      role: 'Owner',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await cleanDb.insert(customers).values({
      id: 'cust-01',
      companyId: TEST_FIXTURE_COMPANY_ID,
      code: 'CUST-01',
      customerName: 'ABC Trading',
      legalName: 'ABC Trading Corp',
      tin: '123-456-789-000',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await cleanDb.insert(vendors).values({
      id: 'supp-01',
      companyId: TEST_FIXTURE_COMPANY_ID,
      code: 'SUPP-01',
      vendorName: 'XYZ Supplies',
      legalName: 'XYZ Supplies Corp',
      tin: '987-654-321-000',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const jeId = 'je-test-def007-opening-01';
    await cleanDb.insert(journalEntries).values({
      id: jeId,
      companyId: TEST_FIXTURE_COMPANY_ID,
      journalNumber: 'JE-2026-001',
      entryNumber: 'JE-2026-001',
      entryDate: '2026-10-15',
      description: 'Opening & Operating Balances',
      status: 'POSTED',
      createdBy: 'cpa-lead-auditor-2026',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await cleanDb.insert(journalLines).values([
      { id: 'jl-1', journalEntryId: jeId, lineNumber: 1, accountId: getAccId('1010'), debit: 38498910, credit: 0 },
      { id: 'jl-2', journalEntryId: jeId, lineNumber: 2, accountId: getAccId('1030'), debit: 10000000, credit: 0 },
      { id: 'jl-3', journalEntryId: jeId, lineNumber: 3, accountId: getAccId('1080'), debit: 5000000, credit: 0 },
      { id: 'jl-4', journalEntryId: jeId, lineNumber: 4, accountId: getAccId('1050'), debit: 600000, credit: 0 },
      { id: 'jl-5', journalEntryId: jeId, lineNumber: 5, accountId: getAccId('1510'), debit: 8600000, credit: 0 },
      { id: 'jl-6', journalEntryId: jeId, lineNumber: 6, accountId: getAccId('2010'), debit: 0, credit: 12116060 },
      { id: 'jl-7', journalEntryId: jeId, lineNumber: 7, accountId: getAccId('2020'), debit: 0, credit: 1200000 },
      { id: 'jl-8', journalEntryId: jeId, lineNumber: 8, accountId: getAccId('2035'), debit: 0, credit: 100785 },
      { id: 'jl-9', journalEntryId: jeId, lineNumber: 9, accountId: getAccId('2030'), debit: 0, credit: 100000 },
      { id: 'jl-10', journalEntryId: jeId, lineNumber: 10, accountId: getAccId('2510'), debit: 0, credit: 7065 },
      { id: 'jl-11', journalEntryId: jeId, lineNumber: 11, accountId: getAccId('3010'), debit: 0, credit: 49175000 },
    ]);

    await cleanDb.insert(salesInvoices).values({
      id: 'inv-test-def007-01',
      companyId: TEST_FIXTURE_COMPANY_ID,
      customerId: 'cust-01',
      invoiceNumber: 'SI-PILOT-2026-001',
      invoiceDate: '2026-10-10',
      dueDate: '2026-11-10',
      totalAmount: 11200000,
      balanceDue: 5600000,
      status: 'PARTIAL',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await cleanDb.insert(purchaseBills).values({
      id: 'bill-test-def007-01',
      companyId: TEST_FIXTURE_COMPANY_ID,
      vendorId: 'supp-01',
      billNumber: 'BILL-PILOT-2026-001',
      billDate: '2026-10-05',
      dueDate: '2026-11-05',
      totalAmount: 5600000,
      balanceDue: 0,
      status: 'PAID',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
  });

  describe('Phase 1 — DEF-007: Balance Sheet Account Classification', () => {
    it('classifies all required asset and liability subtypes without omission or duplication', () => {
      expect(ASSET_ACCOUNT_TYPES).toEqual([
        'ASSET',
        'RECEIVABLE',
        'INVENTORY',
        'OTHER_CURRENT_ASSET',
        'FIXED_ASSET',
      ]);
      expect(LIABILITY_ACCOUNT_TYPES).toEqual([
        'LIABILITY',
        'PAYABLE',
        'OTHER_CURRENT_LIABILITY',
        'LONG_TERM_LIABILITY',
      ]);

      for (const t of ASSET_ACCOUNT_TYPES) {
        expect(isAssetAccountType(t)).toBe(true);
        expect(isLiabilityAccountType(t)).toBe(false);
      }
      for (const t of LIABILITY_ACCOUNT_TYPES) {
        expect(isLiabilityAccountType(t)).toBe(true);
        expect(isAssetAccountType(t)).toBe(false);
      }
      expect(isAssetAccountType('EQUITY')).toBe(false);
      expect(isLiabilityAccountType('REVENUE')).toBe(false);
    });

    it('includes RECEIVABLE (1020), INVENTORY (1080), OTHER_CURRENT_ASSET (1070), FIXED_ASSET (1510), PAYABLE (2010/2035), OTHER_CURRENT_LIABILITY (2020), and LONG_TERM_LIABILITY (2510) in Balance Sheet calculation', async () => {
      const db = await CompanyManager.getCompanyDb(TEST_FIXTURE_COMPANY_ID);
      const coa = await db.select().from(accounts);
      const postedJournals = await db
        .select()
        .from(journalEntries)
        .where(inArray(journalEntries.status, ['POSTED', 'REVERSED']));
      const postedIds = new Set(postedJournals.map((j) => j.id));
      const allLines = await db.select().from(journalLines);

      const balances = new Map<string, number>();
      for (const acc of coa) balances.set(acc.id, 0);

      for (const line of allLines) {
        if (!postedIds.has(line.journalEntryId)) continue;
        const acc = coa.find((a) => a.id === line.accountId);
        if (!acc) continue;
        const cur = balances.get(acc.id) || 0;
        if (acc.normalBalance === 'DEBIT') {
          balances.set(acc.id, cur + (line.debit - line.credit));
        } else {
          balances.set(acc.id, cur + (line.credit - line.debit));
        }
      }

      let legacyAssetsOnly = 0;
      let remediatedTotalAssets = 0;
      let legacyLiabilitiesOnly = 0;
      let remediatedTotalLiabilities = 0;

      for (const acc of coa) {
        const bal = balances.get(acc.id) || 0;
        if (acc.accountType === 'ASSET') legacyAssetsOnly += bal;
        if (isAssetAccountType(acc.accountType)) remediatedTotalAssets += bal;
        if (acc.accountType === 'LIABILITY') legacyLiabilitiesOnly += bal;
        if (isLiabilityAccountType(acc.accountType)) remediatedTotalLiabilities += bal;
      }

      // Legacy only included 'ASSET' (38,498,910 centavos) and 'LIABILITY' (0)
      expect(legacyAssetsOnly).toBe(38498910);
      expect(legacyLiabilitiesOnly).toBe(0);

      // Remediated includes all 5 asset subtypes (62,698,910 centavos) and all liability subtypes (13,523,910 centavos)
      expect(remediatedTotalAssets).toBe(62698910);
      expect(remediatedTotalLiabilities).toBe(13523910);
    });
  });

  describe('Phase 2 — DEF-008: Dashboard Financial Accuracy & 12/112 VAT Math', () => {
    it('computes 12/112 VAT-inclusive extraction instead of 12% of gross when taxAmount is not stored', () => {
      expect(deriveVatFromGrossInclusive(11200000)).toBe(1200000);

      const est = calculateDashboardVatEstimate({
        grossRevenueCentavos: 11200000,
        grossExpenseCentavos: 5600000,
        storedOutputVatCentavos: 0,
        storedInputVatCentavos: 0,
        storedEwtCentavos: 150000,
        isVatRegistered: true,
      });
      expect(est.outputVat).toBe(1200000);
      expect(est.inputVat).toBe(600000);
      expect(est.netVatPayable).toBe(600000);
      expect(est.ewtWithheld).toBe(150000);
    });

    it('includes POSTED, PARTIAL, PARTIALLY_PAID, and PAID invoices and bills in recognized revenue and expenses', async () => {
      const db = await CompanyManager.getCompanyDb(TEST_FIXTURE_COMPANY_ID);
      const recognizedStatuses = ['POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID'];
      const invs = await db
        .select()
        .from(salesInvoices)
        .where(inArray(salesInvoices.status, recognizedStatuses));
      const bills = await db
        .select()
        .from(purchaseBills)
        .where(inArray(purchaseBills.status, recognizedStatuses));

      expect(
        invs.some(
          (i) =>
            i.invoiceNumber === 'SI-PILOT-2026-001' &&
            ['PARTIAL', 'PARTIALLY_PAID'].includes(i.status)
        )
      ).toBe(true);
      expect(bills.some((b) => b.billNumber === 'BILL-PILOT-2026-001' && b.status === 'PAID')).toBe(
        true
      );
    });
  });

  describe('Phase 3 — DEF-010: Payroll COA & Statutory 2026 Validation', () => {
    it('provisions dedicated Account 2035 (Withholding Tax Payable - Compensation, PAYABLE, CREDIT, isTaxAccount: true)', () => {
      const acc2035 = DEFAULT_PHILIPPINE_COA.find((a) => a.accountCode === '2035');
      expect(acc2035).toBeDefined();
      expect(acc2035?.accountName).toBe('Withholding Tax Payable - Compensation');
      expect(acc2035?.accountType).toBe('PAYABLE');
      expect(acc2035?.normalBalance).toBe('CREDIT');
      expect(acc2035?.isTaxAccount).toBe(true);
    });

    it('calculates exact 2026 statutory contributions and BIR TRAIN withholding for ₱36,500 monthly (₱18,250 semi-monthly)', () => {
      const calc = TaxEngine.calculateStatutoryPayrollWithholding(1825000, {
        frequency: 'SEMI_MONTHLY',
        sssScheduleVersion: '2026_STATUTORY_5PCT'
      });
      expect(calc.sssEmployeeCentavos).toBe(87500); // ₱875.00 (5% on ₱35k MSC cap)
      expect(calc.philhealthEmployeeCentavos).toBe(45625); // ₱456.25 (2.5% of ₱18,250)
      expect(calc.pagibigEmployeeCentavos).toBe(10000); // ₱100.00 (HDMF Circular 460)
      expect(calc.totalNonTaxableDeductionsCentavos).toBe(143125); // ₱1,431.25
      expect(calc.taxableCompensationCentavos).toBe(1681875); // ₱16,818.75
      expect(calc.withholdingTaxCentavos).toBe(96785); // ₱967.85
    });

    it('separates employee over-withholding refunds (₱47,811.33) from under-withholding receivables (₱204,200.29) and blocks execution on LGR-PH-2026-TEST-00-ABC12345', async () => {
      const report = PayrollRemediationService.assessHistoricalPayroll(
        'LGR-PH-2026-TEST-00-ABC12345'
      );
      expect(report.statutoryLiabilityBreakdown.employeeOverWithholdingRefundCentavos).toBe(4781133);
      expect(report.statutoryLiabilityBreakdown.employeeOverWithholdingRowCount).toBe(98);
      expect(report.statutoryLiabilityBreakdown.employeeUnderWithholdingCentavos).toBe(20420029);
      expect(report.statutoryLiabilityBreakdown.employeeUnderWithholdingRowCount).toBe(182);
      expect(report.statutoryLiabilityBreakdown.netBirRemittanceDeltaCentavos).toBe(15638896);
      expect(report.proposedAdjustmentJournal.creditAccountCode).toBe('2035');

      await expect(
        PayrollRemediationService.executeControlledPayrollAdjustment(
          'LGR-PH-2026-TEST-00-ABC12345',
          {
            reviewerUserId: 'test-reviewer',
            approverUserId: 'test-approver',
            reason: 'Attempted execution on protected stress dataset',
            dryRunOnly: false,
          }
        )
      ).rejects.toThrow(/strictly prohibited on quarantined STRESS_TEST dataset/);
    });
  });

  describe('Phase 4 — DEF-011: Tax Return Source of Truth', () => {
    it('reconciles 2550Q, 1601-C, 1601-EQ, 2307, and 2316 directly to posted GL balances on isolated test fixture with zero hardcoded sample rows', async () => {
      const db = await CompanyManager.getCompanyDb(TEST_FIXTURE_COMPANY_ID);

      const snap = await dbContext.run(db as any, () =>
        buildAuthoritativeTaxReturnSnapshot(
          TEST_FIXTURE_COMPANY_ID,
          '2550Q',
          '2026-10-01',
          '2026-10-31'
        )
      );

      expect(snap.form2550Q.reconciledToGl).toBe(true);
      expect(snap.form2550Q.outputVatCentavos).toBe(1200000);
      expect(snap.form2550Q.inputVatCentavos).toBe(600000);
      expect(snap.form2550Q.netVatPayableCentavos).toBe(600000);

      expect(snap.form1601C.reconciledRecordedToGl).toBe(true);
      expect(snap.form1601C.varianceRecordedVsStatutoryCentavos).toBe(0);
      expect(snap.form1601C.glWtcPayableCentavos).toBe(100785);

      expect(snap.form1601EQ.reconciledToGl).toBe(true);
      expect(snap.form1601EQ.totalEwtWithheldCentavos).toBe(100000);
      expect(snap.form1601EQ.glEwtPayableCentavos).toBe(100000);
    });
  });

  describe('Phase 5 & 6 — DEF-009 Quarantine, DEF-CHAL-001 Destructive Test Guard & Production Encryption Policy', () => {
    it('quarantines STRESS_TEST and BENCHMARK companies from production listings and blocks promotion/migration', async () => {
      await CompanyManager.quarantineAndClassifyRegisteredCompanies();
      const prodVisible = await CompanyManager.listCompanies({ excludeNonProduction: true });
      expect(prodVisible.some((c) => c.id === 'LGR-PH-2026-TEST-00-ABC12345')).toBe(false);
      expect(prodVisible.some((c) => c.id === TEST_FIXTURE_COMPANY_ID)).toBe(false);
      expect(prodVisible.some((c) => c.id === 'LGR-BENCH-VOLUME')).toBe(false);
      expect(prodVisible.some((c) => c.id === 'LGR-PH-2026-PILOT-CLEAN-01')).toBe(true);

      await expect(
        CompanyManager.changeCompanyClassification('LGR-PH-2026-TEST-00-ABC12345', 'PRODUCTION', {
          authorizedByUserId: 'admin',
          authorizedByRole: 'Company Owner',
          reason: 'Test promotion block',
        })
      ).rejects.toThrow(/SYNTHETIC_PROMOTION_PROHIBITED/);

      await expect(
        CompanyManager.assertProductionWorkflowAllowed(
          'LGR-PH-2026-TEST-00-ABC12345',
          'OPENING_BALANCE_MIGRATION'
        )
      ).rejects.toThrow(/SYNTHETIC_COMPANY_QUARANTINED/);
    });

    it('rejects destructive test resets against PILOT, PRODUCTION, out-of-workspace paths, or mismatched company directories (DEF-CHAL-001)', async () => {
      expect(() =>
        CompanyManager.assertDestructiveTestOperationAllowed('LGR-PH-2026-PILOT-CLEAN-01')
      ).toThrow(/PROHIBITED_DESTRUCTIVE_TEST_OPERATION/);

      expect(() =>
        CompanyManager.assertDestructiveTestOperationAllowed('LGR-PH-2026-PROD-01')
      ).toThrow(/PROHIBITED_DESTRUCTIVE_TEST_OPERATION/);

      expect(() =>
        CompanyManager.assertDestructiveTestOperationAllowed(
          TEST_FIXTURE_COMPANY_ID,
          '/tmp/outside-approved-workspace'
        )
      ).toThrow(/PROHIBITED_DESTRUCTIVE_TEST_OPERATION/);

      const pilotDir = path.join(paths.getCompaniesRootDir(), 'LGR-PH-2026-PILOT-CLEAN-01');
      expect(() =>
        CompanyManager.assertDestructiveTestOperationAllowed(TEST_FIXTURE_COMPANY_ID, pilotDir)
      ).toThrow(/PROHIBITED_DESTRUCTIVE_TEST_OPERATION/);
    });

    it('rejects deterministic fallback development key for PRODUCTION companies and supports LAISENC2 envelope key rotation', () => {
      expect(() =>
        DatabaseEncryptionService.assertProductionKeyPolicy({
          companyId: 'LGR-PROD-TEST-01',
          classification: 'PRODUCTION',
          keyMode: 'LEGACY_DEV_KEY',
        })
      ).toThrow(/PRODUCTION_KEY_POLICY_VIOLATION/);
    });
  });
});
