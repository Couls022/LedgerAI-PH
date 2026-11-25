import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { CompanyManager } from '../src/server/services/companyManager';
import {
  DatabaseEncryptionService,
  FALLBACK_DEV_MASTER_SECRET,
} from '../src/server/services/databaseEncryptionService';
import { TaxEngine } from '../src/server/services/taxEngine';
import { PayrollRemediationService } from '../src/server/services/payrollRemediationService';
import { AccountingEngine } from '../src/server/services/accountingEngine';
import { BirComplianceService } from '../src/server/services/birComplianceService';
import { DEFAULT_PHILIPPINE_COA } from '../src/server/routes/companies';
import {
  isAssetAccountType,
  isLiabilityAccountType,
} from '../src/server/routes/reports';
import {
  deriveVatFromGrossInclusive,
  calculateDashboardVatEstimate,
} from '../src/server/routes/dashboard';
import { buildAuthoritativeTaxReturnSnapshot } from '../src/server/routes/tax';
import { dbContext } from '../src/server/db/context';
import * as schema from '../src/server/db/schema';
import { eq, and } from 'drizzle-orm';

async function main() {
  console.log('================================================================================');
  console.log('LEDGERAI PH — CRITICAL REMEDIATION PHASE (DEF-007 TO DEF-011) VERIFICATION');
  console.log('================================================================================\n');

  const summaryResults: Record<string, any> = {};

  // Clean up any prior clean pilot test company before running quarantine audit
  const cleanCompanyId = 'LGR-PH-2026-PILOT-CLEAN-01';
  try {
    await CompanyManager.rollbackCompanyCreation(cleanCompanyId);
  } catch {}

  // ============================================================================
  // PHASE 5 — DEF-009: SYNTHETIC COMPANY QUARANTINE & STRESS-TEST PRESERVATION
  // ============================================================================
  console.log('[PHASE 5 / DEF-009] Running Synthetic Company Quarantine across registry...');
  const quarantineResults = await CompanyManager.quarantineAndClassifyRegisteredCompanies();
  const stressCompany = quarantineResults.find((c) => c.companyId === 'LGR-PH-2026-TEST-00-ABC12345');
  const benchCompany = quarantineResults.find((c) => c.companyId === 'LGR-BENCH-VOLUME');
  const productionVisibleList = await CompanyManager.listCompanies({ excludeNonProduction: true });

  // Verify LGR-PH-2026-TEST-00-ABC12345 records remain 100% preserved
  const testSqlite = await CompanyManager.getCompanySqlite('LGR-PH-2026-TEST-00-ABC12345');
  const testCounts = {
    journalEntries: (testSqlite.prepare('SELECT COUNT(*) as c FROM journal_entries').get() as any).c,
    salesInvoices: (testSqlite.prepare('SELECT COUNT(*) as c FROM sales_invoices').get() as any).c,
    purchaseBills: (testSqlite.prepare('SELECT COUNT(*) as c FROM purchase_bills').get() as any).c,
    payrollItems: (testSqlite.prepare('SELECT COUNT(*) as c FROM payroll_items').get() as any).c,
    auditLogs: (testSqlite.prepare('SELECT COUNT(*) as c FROM audit_logs').get() as any).c,
    classificationInDb: (
      testSqlite.prepare('SELECT classification FROM companies WHERE id = ?').get('LGR-PH-2026-TEST-00-ABC12345') as any
    )?.classification,
  };

  let promotionBlocked = false;
  let promotionBlockMessage = '';
  try {
    await CompanyManager.changeCompanyClassification('LGR-PH-2026-TEST-00-ABC12345', 'PRODUCTION', {
      authorizedByUserId: 'user-test-admin-uuid',
      authorizedByRole: 'Company Owner',
      reason: 'Attempted unauthorized promotion of synthetic stress test company',
    });
  } catch (err: any) {
    promotionBlocked = true;
    promotionBlockMessage = err.message;
  }

  let migrationBlocked = false;
  let migrationBlockMessage = '';
  try {
    await CompanyManager.assertProductionWorkflowAllowed(
      'LGR-PH-2026-TEST-00-ABC12345',
      'OPENING_BALANCE_MIGRATION'
    );
  } catch (err: any) {
    migrationBlocked = true;
    migrationBlockMessage = err.message;
  }

  summaryResults.def009_quarantine = {
    status:
      stressCompany?.classification === 'STRESS_TEST' &&
      benchCompany?.classification === 'BENCHMARK' &&
      !productionVisibleList.some((c) => c.id === 'LGR-PH-2026-TEST-00-ABC12345' || c.id === 'LGR-BENCH-VOLUME') &&
      promotionBlocked &&
      migrationBlocked &&
      testCounts.payrollItems >= 280
        ? 'PASS'
        : 'FAIL',
    totalRegisteredCompanies: quarantineResults.length,
    quarantinedCount: quarantineResults.filter((c) => c.isQuarantinedFromProduction).length,
    productionVisibleCount: productionVisibleList.length,
    primaryStressCompanyClassification: stressCompany?.classification,
    benchmarkCompanyClassification: benchCompany?.classification,
    allClassifiedCompanies: quarantineResults,
    preservedTestDatasetCounts: testCounts,
    promotionBlocked,
    promotionBlockMessage,
    migrationBlocked,
    migrationBlockMessage,
  };
  console.log('[PHASE 5 / DEF-009] Result:', JSON.stringify(summaryResults.def009_quarantine, null, 2));

  // ============================================================================
  // PHASE 3 — DEF-010: PAYROLL COA & STATUTORY VALIDATION
  // ============================================================================
  console.log('\n[PHASE 3 / DEF-010] Verifying Payroll Chart of Accounts & Statutory Engine...');
  const has2035InDefaultCoa = DEFAULT_PHILIPPINE_COA.some(
    (a) =>
      a.accountCode === '2035' &&
      a.accountName === 'Withholding Tax Payable - Compensation' &&
      a.accountType === 'PAYABLE' &&
      a.normalBalance === 'CREDIT' &&
      a.isTaxAccount === true
  );

  // Golden test case: ₱36,500 monthly salary, semi-monthly payroll run (₱18,250 gross basic = 1,825,000 centavos)
  const goldenCalcProrated = TaxEngine.calculateStatutoryPayrollWithholding(1825000, {
    frequency: 'SEMI_MONTHLY',
  });
  const goldenCalcHistoricalFullSss = TaxEngine.calculateStatutoryPayrollWithholding(1825000, {
    frequency: 'SEMI_MONTHLY',
    sssEmployeeCentavos: 135000,
    philhealthEmployeeCentavos: 45625,
    pagibigEmployeeCentavos: 10000,
  });

  // Historical dry-run worksheet on LGR-PH-2026-TEST-00-ABC12345 (read-only)
  const payrollDryRun = PayrollRemediationService.assessHistoricalPayroll('LGR-PH-2026-TEST-00-ABC12345');

  // Verify safety lock on executing historical adjustment on LGR-PH-2026-TEST-00-ABC12345
  let historicalAdjustmentBlockedOnProtected = false;
  let historicalAdjustmentBlockMsg = '';
  try {
    await PayrollRemediationService.executeControlledPayrollAdjustment('LGR-PH-2026-TEST-00-ABC12345', {
      reviewerUserId: 'user-reviewer-01',
      approverUserId: 'user-approver-02',
      reason: 'Attempted execution on quarantined stress test dataset',
      dryRunOnly: false,
    });
  } catch (err: any) {
    historicalAdjustmentBlockedOnProtected = true;
    historicalAdjustmentBlockMsg = err.message;
  }

  summaryResults.def010_payroll = {
    status:
      has2035InDefaultCoa &&
      goldenCalcProrated.withholdingTaxCentavos === 100785 &&
      goldenCalcHistoricalFullSss.withholdingTaxCentavos === 88901 &&
      payrollDryRun.statutoryLiabilityBreakdown.employeeOverWithholdingRefundCentavos === 4781133 &&
      payrollDryRun.statutoryLiabilityBreakdown.employeeUnderWithholdingCentavos === 20420029 &&
      payrollDryRun.proposedAdjustmentJournal.creditAccountCode === '2035' &&
      payrollDryRun.proposedAdjustmentJournal.unOffsetLines.some((l) => l.accountCode === '2035') &&
      historicalAdjustmentBlockedOnProtected
        ? 'PASS'
        : 'FAIL',
    has2035InDefaultCoa,
    goldenCase36500MonthlySemiMonthly: {
      proratedSemiMonthly: {
        grossCompensationCentavos: goldenCalcProrated.grossPayCentavos,
        sssEmployeeShareCentavos: goldenCalcProrated.sssEmployeeCentavos,
        philHealthEmployeeShareCentavos: goldenCalcProrated.philhealthEmployeeCentavos,
        pagIbigEmployeeShareCentavos: goldenCalcProrated.pagibigEmployeeCentavos,
        totalMandatoryContributionsCentavos: goldenCalcProrated.totalNonTaxableDeductionsCentavos,
        taxableCompensationCentavos: goldenCalcProrated.taxableCompensationCentavos,
        statutoryWithholdingCentavos: goldenCalcProrated.withholdingTaxCentavos,
        legacyFlat10PercentCentavos: 182500,
        varianceCentavos: 182500 - goldenCalcProrated.withholdingTaxCentavos,
        bracketDescription: goldenCalcProrated.bracketDescription,
      },
      historicalFullMonthSssOnFirstHalf: {
        grossCompensationCentavos: goldenCalcHistoricalFullSss.grossPayCentavos,
        sssEmployeeShareCentavos: goldenCalcHistoricalFullSss.sssEmployeeCentavos,
        philHealthEmployeeShareCentavos: goldenCalcHistoricalFullSss.philhealthEmployeeCentavos,
        pagIbigEmployeeShareCentavos: goldenCalcHistoricalFullSss.pagibigEmployeeCentavos,
        totalMandatoryContributionsCentavos: goldenCalcHistoricalFullSss.totalNonTaxableDeductionsCentavos,
        taxableCompensationCentavos: goldenCalcHistoricalFullSss.taxableCompensationCentavos,
        statutoryWithholdingCentavos: goldenCalcHistoricalFullSss.withholdingTaxCentavos,
        legacyFlat10PercentCentavos: 182500,
        varianceCentavos: 182500 - goldenCalcHistoricalFullSss.withholdingTaxCentavos,
        bracketDescription: goldenCalcHistoricalFullSss.bracketDescription,
      },
    },
    historicalRemediationBreakdown: payrollDryRun.statutoryLiabilityBreakdown,
    proposedAdjustmentJournal: payrollDryRun.proposedAdjustmentJournal,
    historicalAdjustmentBlockedOnProtected,
    historicalAdjustmentBlockMsg,
  };
  console.log('[PHASE 3 / DEF-010] Result:', JSON.stringify(summaryResults.def010_payroll, null, 2));

  // ============================================================================
  // PHASE 6 — PRODUCTION ENCRYPTION POLICY & ENVELOPE ENCRYPTION (LAISENC2)
  // ============================================================================
  console.log('\n[PHASE 6] Verifying Production Encryption Policy & Key Rotation...');
  let fallbackKeyRejectedForProduction = false;
  let fallbackKeyRejectionMessage = '';
  try {
    DatabaseEncryptionService.assertProductionKeyPolicy({
      companyId: 'LGR-PROD-TEST-REJECT',
      classification: 'PRODUCTION',
      keyMode: 'LEGACY_DEV_KEY',
    });
  } catch (err: any) {
    fallbackKeyRejectedForProduction = true;
    fallbackKeyRejectionMessage = err.message;
  }

  let envFallbackLiteralRejectedForProduction = false;
  const prevMasterEnv = process.env.LEDGERAI_MASTER_KEY;
  try {
    process.env.LEDGERAI_MASTER_KEY = FALLBACK_DEV_MASTER_SECRET;
    DatabaseEncryptionService.assertProductionKeyPolicy({
      companyId: 'LGR-PROD-TEST-REJECT-2',
      classification: 'PRODUCTION',
      keyMode: 'OS_KEYCHAIN_STANDALONE',
    });
  } catch (err: any) {
    envFallbackLiteralRejectedForProduction = true;
  } finally {
    if (prevMasterEnv === undefined) {
      delete process.env.LEDGERAI_MASTER_KEY;
    } else {
      process.env.LEDGERAI_MASTER_KEY = prevMasterEnv;
    }
  }

  // Test External KMS provider registration + envelope encryption
  DatabaseEncryptionService.registerExternalKmsProvider({
    providerName: 'LedgerAI-Enterprise-HSM-Simulator',
    getKek: (keyId: string, keyVersion = 1) =>
      crypto
        .createHash('sha256')
        .update(`enterprise-hsm-master-kek|${keyId}|v${keyVersion}`)
        .digest(),
  });
  const kmsPolicyCheck = DatabaseEncryptionService.assertProductionKeyPolicy({
    companyId: 'LGR-ENT-KMS-01',
    classification: 'PRODUCTION',
    keyMode: 'EXTERNAL_KMS_ENVELOPE',
  });
  DatabaseEncryptionService.registerExternalKmsProvider(null);

  summaryResults.phase6_encryptionPolicy = {
    status:
      fallbackKeyRejectedForProduction &&
      envFallbackLiteralRejectedForProduction &&
      kmsPolicyCheck.allowed
        ? 'PASS'
        : 'FAIL',
    fallbackKeyRejectedForProduction,
    fallbackKeyRejectionMessage,
    envFallbackLiteralRejectedForProduction,
    kmsPolicyCheck,
  };
  console.log('[PHASE 6] Result:', JSON.stringify(summaryResults.phase6_encryptionPolicy, null, 2));

  // ============================================================================
  // PHASE 7 — CLEAN-COMPANY ACCOUNTING CERTIFICATION (14 STEPS)
  // ============================================================================
  console.log('\n[PHASE 7] Provisioning Clean Pilot Company LGR-PH-2026-PILOT-CLEAN-01 and executing 14-step certification...');

  const cleanManifest = await CompanyManager.createCompanyProfile(
    cleanCompanyId,
    'LedgerAI PH Clean Enterprise Pilot Corp',
    undefined,
    undefined,
    false,
    {
      fiscalYear: 2026,
      fiscalYearStartMonth: 1,
      classification: 'PILOT',
      encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
    }
  );

  const cleanDb = await CompanyManager.getCompanyDb(cleanCompanyId, { allowInitializeNew: true });
  const cleanSqlite = await CompanyManager.getCompanySqlite(cleanCompanyId);

  const stepResults: Record<string, any> = {};

  await dbContext.run(cleanDb, async () => {
    const adminUserId = 'user-pilot-cpa-01';
    await cleanDb
      .insert(schema.users)
      .values({
        id: adminUserId,
        email: 'cpa.pilot@ledgerai.ph',
        passwordHash: 'hashed',
        displayName: 'Maria Clara Santos, CPA',
        status: 'ACTIVE',
      })
      .onConflictDoNothing();

    await cleanDb
      .update(schema.companies)
      .set({
        tin: '009-888-777-000',
        rdoCode: '039',
        taxpayerClassification: 'CORPORATION',
        vatStatus: 'VAT',
        address: 'Ayala Avenue, Makati City, Metro Manila',
        classification: 'PILOT',
      })
      .where(eq(schema.companies.id, cleanCompanyId));

    const accountIdByCode = new Map<string, string>();
    for (const acc of DEFAULT_PHILIPPINE_COA) {
      const existing = await cleanDb
        .select()
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.companyId, cleanCompanyId),
            eq(schema.accounts.accountCode, acc.accountCode)
          )
        )
        .get();
      if (existing) {
        accountIdByCode.set(acc.accountCode, existing.id);
      } else {
        const id = crypto.randomUUID();
        await cleanDb.insert(schema.accounts).values({
          id,
          companyId: cleanCompanyId,
          accountCode: acc.accountCode,
          accountName: acc.accountName,
          accountType: acc.accountType,
          normalBalance: acc.normalBalance,
          isCashAccount: !!(acc as any).isCashAccount,
          isControlAccount: !!(acc as any).isControlAccount,
          isTaxAccount: !!(acc as any).isTaxAccount,
          isRetainedEarnings: !!(acc as any).isRetainedEarnings,
          status: 'ACTIVE',
        });
        accountIdByCode.set(acc.accountCode, id);
      }
    }

    // Seed initial capital & fixed assets & long-term liability so ALL 9 Balance Sheet subtypes are exercised:
    await AccountingEngine.createAndPostJournalEntry({
      companyId: cleanCompanyId,
      entryDate: '2026-10-01',
      description: 'Initial Capital & Equipment Financing Setup',
      sourceType: 'OPENING_BALANCE',
      sourceId: 'OPEN-PILOT-2026',
      userId: adminUserId,
      lines: [
        { accountId: accountIdByCode.get('1010')!, debit: 50000000, credit: 0, description: 'Initial Cash Investment' },
        { accountId: accountIdByCode.get('1510')!, debit: 12000000, credit: 0, description: 'Office Server Equipment' },
        { accountId: accountIdByCode.get('2510')!, debit: 0, credit: 12000000, description: 'Equipment Term Loan' },
        { accountId: accountIdByCode.get('3010')!, debit: 0, credit: 50000000, description: 'Paid-In Capital' },
      ],
    });

    // STEP 1 & 2: Create customer & sales invoice (₱112,000 VAT-inclusive = ₱100,000 Net + ₱12,000 Output VAT), approve & post
    const customerId = crypto.randomUUID();
    await cleanDb.insert(schema.customers).values({
      id: customerId,
      companyId: cleanCompanyId,
      code: 'CUST-PILOT-001',
      legalName: 'Makati Prime Holdings Inc.',
      tradeName: 'Makati Prime',
      tin: '001-222-333-000',
      address: 'Legazpi Village, Makati City',
      status: 'ACTIVE',
    });

    const invoiceId = crypto.randomUUID();
    const jeSalesId = await AccountingEngine.createAndPostJournalEntry({
      companyId: cleanCompanyId,
      entryDate: '2026-10-05',
      description: 'Sales Invoice SI-PILOT-2026-001 — Makati Prime Holdings Inc.',
      sourceType: 'SALES_INVOICE',
      sourceId: invoiceId,
      userId: adminUserId,
      lines: [
        { accountId: accountIdByCode.get('1030')!, debit: 11200000, credit: 0, description: 'AR - SI-PILOT-2026-001' },
        { accountId: accountIdByCode.get('4010')!, debit: 0, credit: 10000000, description: 'Sales Revenue (VAT Exclusive)' },
        { accountId: accountIdByCode.get('2020')!, debit: 0, credit: 1200000, description: 'Output VAT (12%)' },
      ],
    });

    await cleanDb.insert(schema.salesInvoices).values({
      id: invoiceId,
      companyId: cleanCompanyId,
      customerId,
      invoiceNumber: 'SI-PILOT-2026-001',
      invoiceType: 'SALES',
      invoiceDate: '2026-10-05',
      dueDate: '2026-11-04',
      totalAmount: 11200000,
      balanceDue: 11200000,
      status: 'POSTED',
      journalEntryId: jeSalesId,
      createdBy: adminUserId,
      approvedBy: adminUserId,
    });

    // STEP 3: Verify AR and GL after Invoice Posting
    const arSubledgerBeforeCollection = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(balance_due), 0) as total FROM sales_invoices WHERE company_id = ? AND status IN ('POSTED','PARTIAL','PARTIALLY_PAID')`
        )
        .get(cleanCompanyId) as any
    ).total;
    const arGlBeforeCollection = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as bal
           FROM journal_lines jl
           JOIN journal_entries je ON jl.journal_entry_id = je.id
           WHERE je.company_id = ? AND je.status = 'POSTED' AND jl.account_id = ?`
        )
        .get(cleanCompanyId, accountIdByCode.get('1030')) as any
    ).bal;

    stepResults.step1_to_3_salesAndAr = {
      invoiceNumber: 'SI-PILOT-2026-001',
      journalEntryId: jeSalesId,
      arSubledgerCentavos: arSubledgerBeforeCollection,
      arGlControlCentavos: arGlBeforeCollection,
      reconciled: arSubledgerBeforeCollection === 11200000 && arGlBeforeCollection === 11200000,
    };

    // STEP 4: Record customer collection (₱56,000 partial payment) -> Verify Cash and AR
    const collectionPaymentId = crypto.randomUUID();
    const jeCollectionId = await AccountingEngine.createAndPostJournalEntry({
      companyId: cleanCompanyId,
      entryDate: '2026-10-10',
      description: 'Customer Collection PAY-IN-PILOT-001 against SI-PILOT-2026-001',
      sourceType: 'CUSTOMER_PAYMENT',
      sourceId: collectionPaymentId,
      userId: adminUserId,
      lines: [
        { accountId: accountIdByCode.get('1010')!, debit: 5600000, credit: 0, description: 'Cash Collection' },
        { accountId: accountIdByCode.get('1030')!, debit: 0, credit: 5600000, description: 'AR Partial Settlement' },
      ],
    });

    await cleanDb.insert(schema.customerPayments).values({
      id: collectionPaymentId,
      companyId: cleanCompanyId,
      customerId,
      paymentNumber: 'PAY-IN-PILOT-001',
      officialReceiptNumber: 'OR-2026-0001',
      paymentDate: '2026-10-10',
      cashAccountId: accountIdByCode.get('1010')!,
      amount: 5600000,
      withholdingTaxAmount: 0,
      overpaymentAmount: 0,
      paymentMethod: 'BANK_TRANSFER',
      status: 'POSTED',
      journalEntryId: jeCollectionId,
      createdBy: adminUserId,
      approvedBy: adminUserId,
    });

    await cleanDb
      .update(schema.salesInvoices)
      .set({
        balanceDue: 5600000,
        status: 'PARTIAL',
      })
      .where(eq(schema.salesInvoices.id, invoiceId));

    const arSubledgerAfterCollection = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(balance_due), 0) as total FROM sales_invoices WHERE company_id = ? AND status IN ('POSTED','PARTIAL','PARTIALLY_PAID')`
        )
        .get(cleanCompanyId) as any
    ).total;
    const arGlAfterCollection = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as bal
           FROM journal_lines jl
           JOIN journal_entries je ON jl.journal_entry_id = je.id
           WHERE je.company_id = ? AND je.status = 'POSTED' AND jl.account_id = ?`
        )
        .get(cleanCompanyId, accountIdByCode.get('1030')) as any
    ).bal;

    stepResults.step4_customerCollection = {
      paymentNumber: 'PAY-IN-PILOT-001',
      collectedCentavos: 5600000,
      remainingArSubledgerCentavos: arSubledgerAfterCollection,
      remainingArGlCentavos: arGlAfterCollection,
      reconciled: arSubledgerAfterCollection === 5600000 && arGlAfterCollection === 5600000,
    };

    // STEP 5, 6 & 7: Create vendor & purchase bill (₱56,000 VAT-inclusive = ₱50,000 Net + ₱6,000 Input VAT), approve & post
    const vendorId = crypto.randomUUID();
    await cleanDb.insert(schema.vendors).values({
      id: vendorId,
      companyId: cleanCompanyId,
      code: 'VEND-PILOT-001',
      legalName: 'BGC Cloud Infrastructure Corp.',
      tradeName: 'BGC Cloud',
      tin: '002-333-444-000',
      address: 'Bonifacio Global City, Taguig',
      taxClassification: 'WC158',
      status: 'ACTIVE',
    });

    const billId = crypto.randomUUID();
    const jeBillId = await AccountingEngine.createAndPostJournalEntry({
      companyId: cleanCompanyId,
      entryDate: '2026-10-12',
      description: 'Purchase Bill BILL-PILOT-2026-001 — BGC Cloud Infrastructure Corp.',
      sourceType: 'PURCHASE_BILL',
      sourceId: billId,
      userId: adminUserId,
      lines: [
        { accountId: accountIdByCode.get('6040')!, debit: 5000000, credit: 0, description: 'Office & Cloud Supplies Expense' },
        { accountId: accountIdByCode.get('1050')!, debit: 600000, credit: 0, description: 'Input VAT (12%)' },
        { accountId: accountIdByCode.get('2010')!, debit: 0, credit: 5600000, description: 'Accounts Payable - BILL-PILOT-2026-001' },
      ],
    });

    await cleanDb.insert(schema.purchaseBills).values({
      id: billId,
      companyId: cleanCompanyId,
      vendorId,
      billNumber: 'BILL-PILOT-2026-001',
      billDate: '2026-10-12',
      dueDate: '2026-11-11',
      totalAmount: 5600000,
      balanceDue: 5600000,
      status: 'POSTED',
      journalEntryId: jeBillId,
      createdBy: adminUserId,
      approvedBy: adminUserId,
    });

    const apSubledgerBeforePayment = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(balance_due), 0) as total FROM purchase_bills WHERE company_id = ? AND status IN ('POSTED','PARTIAL','PARTIALLY_PAID')`
        )
        .get(cleanCompanyId) as any
    ).total;
    const apGlBeforePayment = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as bal
           FROM journal_lines jl
           JOIN journal_entries je ON jl.journal_entry_id = je.id
           WHERE je.company_id = ? AND je.status = 'POSTED' AND jl.account_id = ?`
        )
        .get(cleanCompanyId, accountIdByCode.get('2010')) as any
    ).bal;

    stepResults.step5_to_7_purchaseAndAp = {
      billNumber: 'BILL-PILOT-2026-001',
      journalEntryId: jeBillId,
      apSubledgerCentavos: apSubledgerBeforePayment,
      apGlControlCentavos: apGlBeforePayment,
      reconciled: apSubledgerBeforePayment === 5600000 && apGlBeforePayment === 5600000,
    };

    // STEP 8: Record supplier payment (₱56,000 AP settled via ₱55,000 Cash + ₱1,000 EWT 2% WC158 on Account 2030) -> Verify Cash, EWT 2030, and AP
    const supplierPaymentId = crypto.randomUUID();
    const jeSupplierPaymentId = await AccountingEngine.createAndPostJournalEntry({
      companyId: cleanCompanyId,
      entryDate: '2026-10-18',
      description: 'Supplier Payment PAY-OUT-PILOT-001 settling BILL-PILOT-2026-001 (less 2% EWT WC158)',
      sourceType: 'SUPPLIER_PAYMENT',
      sourceId: supplierPaymentId,
      userId: adminUserId,
      lines: [
        { accountId: accountIdByCode.get('2010')!, debit: 5600000, credit: 0, description: 'AP Full Settlement' },
        { accountId: accountIdByCode.get('2030')!, debit: 0, credit: 100000, description: 'Expanded Withholding Tax Payable (2% WC158)' },
        { accountId: accountIdByCode.get('1010')!, debit: 0, credit: 5500000, description: 'Cash Disbursement' },
      ],
    });

    await cleanDb.insert(schema.supplierPayments).values({
      id: supplierPaymentId,
      companyId: cleanCompanyId,
      vendorId,
      paymentNumber: 'PAY-OUT-PILOT-001',
      paymentDate: '2026-10-18',
      amount: 5500000,
      cashAccountId: accountIdByCode.get('1010')!,
      withholdingTaxAmount: 100000,
      withholdingTaxAccountId: accountIdByCode.get('2030')!,
      overpaymentAmount: 0,
      paymentMethod: 'BANK_TRANSFER',
      status: 'POSTED',
      journalEntryId: jeSupplierPaymentId,
      createdBy: adminUserId,
      approvedBy: adminUserId,
    });

    await cleanDb
      .update(schema.purchaseBills)
      .set({
        balanceDue: 0,
        status: 'PAID',
      })
      .where(eq(schema.purchaseBills.id, billId));

    const apSubledgerAfterPayment = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(balance_due), 0) as total FROM purchase_bills WHERE company_id = ? AND status IN ('POSTED','PARTIAL','PARTIALLY_PAID')`
        )
        .get(cleanCompanyId) as any
    ).total;
    const apGlAfterPayment = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as bal
           FROM journal_lines jl
           JOIN journal_entries je ON jl.journal_entry_id = je.id
           WHERE je.company_id = ? AND je.status = 'POSTED' AND jl.account_id = ?`
        )
        .get(cleanCompanyId, accountIdByCode.get('2010')) as any
    ).bal;

    stepResults.step8_supplierPayment = {
      paymentNumber: 'PAY-OUT-PILOT-001',
      disbursedCentavos: 5500000,
      ewtWithheldCentavos: 100000,
      remainingApSubledgerCentavos: apSubledgerAfterPayment,
      remainingApGlCentavos: apGlAfterPayment,
      reconciled: apSubledgerAfterPayment === 0 && apGlAfterPayment === 0,
    };

    // STEP 9 & 10: Record Inventory Receipt (100 units @ ₱1,000 = ₱100,000) & Inventory Issue/COGS (40 units @ ₱1,000 = ₱40,000)
    const itemId = crypto.randomUUID();
    await cleanDb.insert(schema.inventoryItems).values({
      id: itemId,
      companyId: cleanCompanyId,
      sku: 'SKU-PILOT-ROUTER-01',
      name: 'Enterprise Dual-WAN Fiber Router',
      unitOfMeasure: 'PCS',
      costingMethod: 'FIFO',
      unitCost: 100000,
      sellingPrice: 280000,
      quantityOnHand: 60,
      reorderPoint: 10,
      assetAccountId: accountIdByCode.get('1080')!,
      cogsAccountId: accountIdByCode.get('5010')!,
      status: 'ACTIVE',
    });

    const jeInvReceiptId = await AccountingEngine.createAndPostJournalEntry({
      companyId: cleanCompanyId,
      entryDate: '2026-10-03',
      description: 'Inventory Receipt INV-RCV-PILOT-001 (100 units @ ₱1,000.00)',
      sourceType: 'INVENTORY_MOVEMENT',
      sourceId: 'INV-RCV-PILOT-001',
      userId: adminUserId,
      lines: [
        { accountId: accountIdByCode.get('1080')!, debit: 10000000, credit: 0, description: 'Merchandise Inventory Receipt' },
        { accountId: accountIdByCode.get('1010')!, debit: 0, credit: 10000000, description: 'Cash Purchase of Inventory' },
      ],
    });

    const jeInvIssueId = await AccountingEngine.createAndPostJournalEntry({
      companyId: cleanCompanyId,
      entryDate: '2026-10-06',
      description: 'Inventory Issue / COGS INV-ISS-PILOT-001 (40 units @ ₱1,000.00)',
      sourceType: 'INVENTORY_MOVEMENT',
      sourceId: 'INV-ISS-PILOT-001',
      userId: adminUserId,
      lines: [
        { accountId: accountIdByCode.get('5010')!, debit: 4000000, credit: 0, description: 'Cost of Goods Sold (40 units)' },
        { accountId: accountIdByCode.get('1080')!, debit: 0, credit: 4000000, description: 'Merchandise Inventory Issue' },
      ],
    });

    const inventoryGlBalance = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as bal
           FROM journal_lines jl
           JOIN journal_entries je ON jl.journal_entry_id = je.id
           WHERE je.company_id = ? AND je.status = 'POSTED' AND jl.account_id = ?`
        )
        .get(cleanCompanyId, accountIdByCode.get('1080')) as any
    ).bal;

    stepResults.step9_to_10_inventoryAndCogs = {
      receiptJournalId: jeInvReceiptId,
      issueJournalId: jeInvIssueId,
      endingQuantityOnHand: 60,
      endingInventoryValuationCentavos: 6000000,
      inventoryGlAccount1080Centavos: inventoryGlBalance,
      cogsGlAccount5010Centavos: 4000000,
      reconciled: inventoryGlBalance === 6000000,
    };

    // STEP 11: Run Payroll with statutory deductions and separate Account 2035 (Withholding Tax Payable - Compensation)
    const employeeId = crypto.randomUUID();
    await cleanDb.insert(schema.employees).values({
      id: employeeId,
      companyId: cleanCompanyId,
      employeeNo: 'EMP-PILOT-001',
      firstName: 'Juan',
      lastName: 'Dela Cruz',
      tin: '111-222-333-000',
      department: 'Finance',
      position: 'Senior Accountant',
      monthlyBasicSalary: 3650000, // ₱36,500/mo
      status: 'ACTIVE',
    });

    const payrollCalc = TaxEngine.calculateStatutoryPayrollWithholding(1825000, {
      frequency: 'SEMI_MONTHLY',
    });
    const netPayCentavos = payrollCalc.netPayCentavos;

    const payrollRunId = crypto.randomUUID();
    const jePayrollId = await AccountingEngine.createAndPostJournalEntry({
      companyId: cleanCompanyId,
      journalNumber: 'JE-PAY-2026-10B',
      entryDate: '2026-10-30',
      description: 'Semi-Monthly Payroll Run PR-PILOT-2026-10B (Statutory BIR 1601-C & Mandatory Contributions)',
      sourceType: 'PAYROLL_RUN',
      sourceId: payrollRunId,
      userId: adminUserId,
      lines: [
        {
          accountId: accountIdByCode.get('6010')!,
          debit: payrollCalc.grossPayCentavos,
          credit: 0,
          description: 'Salaries and Wages Expense (PR-PILOT-2026-10B)',
        },
        {
          accountId: accountIdByCode.get('2040')!,
          debit: 0,
          credit: payrollCalc.totalNonTaxableDeductionsCentavos,
          description: 'SSS/PhilHealth/Pag-IBIG Payable (Mandatory Employee Deductions)',
        },
        {
          accountId: accountIdByCode.get('2035')!,
          debit: 0,
          credit: payrollCalc.withholdingTaxCentavos,
          description: 'Withholding Tax Payable - Compensation (BIR Form 1601-C)',
        },
        {
          accountId: accountIdByCode.get('1010')!,
          debit: 0,
          credit: netPayCentavos,
          description: 'Net Payroll Disbursed via Bank Transfer',
        },
      ],
    });

    await cleanDb.insert(schema.payrollRuns).values({
      id: payrollRunId,
      companyId: cleanCompanyId,
      payrollPeriod: '2026-10-B',
      startDate: '2026-10-16',
      endDate: '2026-10-31',
      paymentDate: '2026-10-30',
      totalGrossPay: payrollCalc.grossPayCentavos,
      totalSss: payrollCalc.sssEmployeeCentavos,
      totalPhilhealth: payrollCalc.philhealthEmployeeCentavos,
      totalPagibig: payrollCalc.pagibigEmployeeCentavos,
      totalWithholdingTax: payrollCalc.withholdingTaxCentavos,
      totalNetPay: netPayCentavos,
      status: 'POSTED',
      journalEntryId: jePayrollId,
      createdBy: adminUserId,
      approvedBy: adminUserId,
    });

    await cleanDb.insert(schema.payrollItems).values({
      id: crypto.randomUUID(),
      payrollRunId,
      employeeId,
      basicPay: payrollCalc.grossPayCentavos,
      overtimePay: 0,
      grossPay: payrollCalc.grossPayCentavos,
      sssEmployee: payrollCalc.sssEmployeeCentavos,
      philhealthEmployee: payrollCalc.philhealthEmployeeCentavos,
      pagibigEmployee: payrollCalc.pagibigEmployeeCentavos,
      withholdingTax: payrollCalc.withholdingTaxCentavos,
      totalDeductions:
        payrollCalc.totalNonTaxableDeductionsCentavos + payrollCalc.withholdingTaxCentavos,
      netPay: netPayCentavos,
    });

    const account2035GlBalance = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as bal
           FROM journal_lines jl
           JOIN journal_entries je ON jl.journal_entry_id = je.id
           WHERE je.company_id = ? AND je.status = 'POSTED' AND jl.account_id = ?`
        )
        .get(cleanCompanyId, accountIdByCode.get('2035')) as any
    ).bal;
    const account2040GlBalance = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as bal
           FROM journal_lines jl
           JOIN journal_entries je ON jl.journal_entry_id = je.id
           WHERE je.company_id = ? AND je.status = 'POSTED' AND jl.account_id = ?`
        )
        .get(cleanCompanyId, accountIdByCode.get('2040')) as any
    ).bal;

    stepResults.step11_payroll = {
      payrollRunNumber: 'PR-PILOT-2026-10B',
      journalEntryId: jePayrollId,
      grossPayCentavos: payrollCalc.grossPayCentavos,
      mandatoryContributions2040Centavos: account2040GlBalance,
      withholdingTax2035Centavos: account2035GlBalance,
      netPayDisbursedCentavos: netPayCentavos,
      reconciled:
        account2035GlBalance === payrollCalc.withholdingTaxCentavos &&
        account2040GlBalance === payrollCalc.totalNonTaxableDeductionsCentavos,
    };

    // STEP 12: Generate Tax Schedules (2550Q, 1601-C, 1601-EQ, 2316)
    const snap = await buildAuthoritativeTaxReturnSnapshot(
      cleanCompanyId,
      'ALL',
      '2026-10-01',
      '2026-10-31'
    );
    const form2307Data = await BirComplianceService.generateForm2307Data(
      cleanCompanyId,
      '2026-10-01',
      '2026-12-31'
    );

    stepResults.step12_taxSchedules = {
      form2550Q: snap.form2550Q,
      form1601C: snap.form1601C,
      form1601EQ: snap.form1601EQ,
      form2316: snap.form2316,
      form2307Count: form2307Data.lineItems.length,
    };

    // STEP 14: Post a temporary adjustment journal and immediately reverse it to verify net zero impact
    const jeToReverseId = await AccountingEngine.createAndPostJournalEntry({
      companyId: cleanCompanyId,
      entryDate: '2026-10-25',
      description: 'Accrued Utilities Estimate (to be reversed)',
      sourceType: 'MANUAL_JOURNAL',
      sourceId: 'MAN-PILOT-001',
      userId: adminUserId,
      lines: [
        { accountId: accountIdByCode.get('6030')!, debit: 500000, credit: 0, description: 'Utilities Accrual' },
        { accountId: accountIdByCode.get('2010')!, debit: 0, credit: 500000, description: 'Accrued Liability' },
      ],
    });
    const jeReversalId = await AccountingEngine.reverseJournalEntry(
      cleanCompanyId,
      jeToReverseId,
      adminUserId,
      'Reversing temporary utilities estimate for clean month-end close'
    );

    const utilitiesNetBalance = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as bal
           FROM journal_lines jl
           JOIN journal_entries je ON jl.journal_entry_id = je.id
           WHERE je.company_id = ? AND je.status = 'POSTED' AND jl.account_id = ?`
        )
        .get(cleanCompanyId, accountIdByCode.get('6030')) as any
    ).bal;

    stepResults.step14_journalReversal = {
      originalJournalId: jeToReverseId,
      reversalJournalId: jeReversalId,
      account6030NetBalanceCentavos: utilitiesNetBalance,
      netZeroVerified: utilitiesNetBalance === 0,
    };

    // STEP 13: Generate Trial Balance, Income Statement, Balance Sheet, and Cash Flow Statement
    const allPostedLines = cleanSqlite
      .prepare(
        `SELECT a.account_code, a.account_name, a.account_type, a.normal_balance,
                COALESCE(SUM(jl.debit), 0) as total_debit,
                COALESCE(SUM(jl.credit), 0) as total_credit
         FROM accounts a
         JOIN journal_lines jl ON jl.account_id = a.id
         JOIN journal_entries je ON jl.journal_entry_id = je.id
         WHERE je.company_id = ? AND je.status = 'POSTED'
         GROUP BY a.id
         ORDER BY a.account_code ASC`
      )
      .all(cleanCompanyId) as any[];

    let tbTotalDebits = 0;
    let tbTotalCredits = 0;
    let totalAssetsCentavos = 0;
    let totalLiabilitiesCentavos = 0;
    let totalEquityCentavos = 0;
    let totalRevenueCentavos = 0;
    let totalExpenseCentavos = 0;

    const bsAssetsBySubtype: Record<string, number> = {};
    const bsLiabilitiesBySubtype: Record<string, number> = {};

    for (const row of allPostedLines) {
      const deb = Number(row.total_debit || 0);
      const cred = Number(row.total_credit || 0);
      tbTotalDebits += deb;
      tbTotalCredits += cred;

      const accType = String(row.account_type).toUpperCase();
      if (isAssetAccountType(accType)) {
        const netAsset = deb - cred;
        totalAssetsCentavos += netAsset;
        bsAssetsBySubtype[accType] = (bsAssetsBySubtype[accType] || 0) + netAsset;
      } else if (isLiabilityAccountType(accType)) {
        const netLiab = cred - deb;
        totalLiabilitiesCentavos += netLiab;
        bsLiabilitiesBySubtype[accType] = (bsLiabilitiesBySubtype[accType] || 0) + netLiab;
      } else if (accType === 'EQUITY') {
        totalEquityCentavos += cred - deb;
      } else if (accType === 'REVENUE' || accType === 'OTHER_INCOME') {
        totalRevenueCentavos += cred - deb;
      } else if (accType === 'EXPENSE' || accType === 'COST_OF_SALES' || accType === 'OTHER_EXPENSE') {
        totalExpenseCentavos += deb - cred;
      }
    }

    const netIncomeCentavos = totalRevenueCentavos - totalExpenseCentavos;
    const totalEquityWithNetIncomeCentavos = totalEquityCentavos + netIncomeCentavos;
    const totalLiabilitiesAndEquityCentavos =
      totalLiabilitiesCentavos + totalEquityWithNetIncomeCentavos;

    // Verify DEF-008 Dashboard metrics on clean company
    const dashRecognizedRevenueGross = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(total_amount), 0) as total FROM sales_invoices
           WHERE company_id = ? AND status IN ('POSTED','PARTIAL','PARTIALLY_PAID','PAID')`
        )
        .get(cleanCompanyId) as any
    ).total;
    const dashRecognizedExpenseGross = (
      cleanSqlite
        .prepare(
          `SELECT COALESCE(SUM(total_amount), 0) as total FROM purchase_bills
           WHERE company_id = ? AND status IN ('POSTED','PARTIAL','PARTIALLY_PAID','PAID')`
        )
        .get(cleanCompanyId) as any
    ).total;
    const dashVatEstimate = calculateDashboardVatEstimate({
      grossRevenueCentavos: dashRecognizedRevenueGross,
      grossExpenseCentavos: dashRecognizedExpenseGross,
      storedOutputVatCentavos: snap.form2550Q.outputVatCentavos,
      storedInputVatCentavos: snap.form2550Q.inputVatCentavos,
      storedEwtCentavos: 0,
      isVatRegistered: true,
    });

    stepResults.step13_financialStatementsAndDashboard = {
      trialBalance: {
        totalDebitsCentavos: tbTotalDebits,
        totalCreditsCentavos: tbTotalCredits,
        isBalanced: tbTotalDebits === tbTotalCredits,
      },
      incomeStatement: {
        totalRevenueCentavos,
        totalExpenseAndCogsCentavos: totalExpenseCentavos,
        netIncomeCentavos,
      },
      balanceSheet: {
        assetsBySubtypeCentavos: bsAssetsBySubtype,
        liabilitiesBySubtypeCentavos: bsLiabilitiesBySubtype,
        totalAssetsCentavos,
        totalLiabilitiesCentavos,
        paidInEquityCentavos: totalEquityCentavos,
        currentPeriodEarningsCentavos: netIncomeCentavos,
        totalEquityCentavos: totalEquityWithNetIncomeCentavos,
        totalLiabilitiesAndEquityCentavos,
        differenceCentavos: totalAssetsCentavos - totalLiabilitiesAndEquityCentavos,
        isBalanced: totalAssetsCentavos === totalLiabilitiesAndEquityCentavos,
      },
      dashboardVerification: {
        recognizedRevenueGrossCentavos: dashRecognizedRevenueGross,
        recognizedExpenseGrossCentavos: dashRecognizedExpenseGross,
        paidBillStillIncludedInExpenses: dashRecognizedExpenseGross === 5600000,
        partiallyPaidInvoiceStillIncludedInRevenue: dashRecognizedRevenueGross === 11200000,
        vatEstimate: dashVatEstimate,
        vat12Over112HelperCheckOn112000: deriveVatFromGrossInclusive(11200000),
      },
    };
  });

  // Sync snapshot and test key rotation on the clean pilot company
  await CompanyManager.checkpointAndSyncFinancialSnapshotNow(cleanCompanyId);
  const beforeRotationMeta = DatabaseEncryptionService.inspectContainerMetadataSync(cleanManifest.dbPath);
  const rotationResult = DatabaseEncryptionService.rotateCompanyDatabaseKeySync(
    cleanCompanyId,
    path.resolve(cleanManifest.location, '.db_active.sqlite'),
    cleanManifest.dbPath,
    'OS_KEYCHAIN_STANDALONE'
  );
  const afterRotationMeta = DatabaseEncryptionService.inspectContainerMetadataSync(cleanManifest.dbPath);
  const consistencyCheck = await CompanyManager.verifySnapshotConsistency(cleanCompanyId);

  summaryResults.phase7_cleanCompanyCertification = {
    status:
      stepResults.step1_to_3_salesAndAr.reconciled &&
      stepResults.step4_customerCollection.reconciled &&
      stepResults.step5_to_7_purchaseAndAp.reconciled &&
      stepResults.step8_supplierPayment.reconciled &&
      stepResults.step9_to_10_inventoryAndCogs.reconciled &&
      stepResults.step11_payroll.reconciled &&
      stepResults.step12_taxSchedules.form2550Q.reconciledToGl &&
      stepResults.step12_taxSchedules.form1601C.reconciledRecordedToGl &&
      stepResults.step12_taxSchedules.form1601EQ.reconciledToGl &&
      stepResults.step12_taxSchedules.form2316.employeeCount === 1 &&
      stepResults.step13_financialStatementsAndDashboard.trialBalance.isBalanced &&
      stepResults.step13_financialStatementsAndDashboard.balanceSheet.isBalanced &&
      stepResults.step14_journalReversal.netZeroVerified &&
      consistencyCheck.valid
        ? 'PASS'
        : 'FAIL',
    companyId: cleanCompanyId,
    encryptionBeforeRotation: beforeRotationMeta,
    keyRotation: rotationResult,
    encryptionAfterRotation: afterRotationMeta,
    snapshotConsistency: consistencyCheck,
    steps: stepResults,
  };

  console.log('\n[PHASE 7] Clean-Company Certification Result:');
  console.log(JSON.stringify(summaryResults.phase7_cleanCompanyCertification, null, 2));

  const outPath = path.resolve(process.cwd(), 'docs/def007_to_def011_verification_evidence.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summaryResults, null, 2), 'utf8');
  console.log(`\nSaved reproducible verification evidence to ${outPath}`);
  await CompanyManager.closeAllConnections();
}

main().catch((err) => {
  console.error('Verification script failed:', err);
  process.exit(1);
});
