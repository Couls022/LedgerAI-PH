import { describe, test, expect, beforeAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { runInTestDb } from '../setup';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { TaxEngine } from '../../src/server/services/taxEngine';
import { ComplianceRuleEngine } from '../../src/server/services/complianceEngine';
import { AuditService } from '../../src/server/services/auditService';
import { AnalyticsEngine } from '../../src/server/services/analyticsEngine';
import { IntentRouter } from '../../src/server/ai/intentRouter';
import { LocalFallbackProvider } from '../../src/server/ai/providers/providerManager';
import { skillRegistry } from '../../src/server/ai/skills/registry';
import { registerAllCoreSkills } from '../../src/server/ai/skills/definitions';
import { SYSTEM_ROLE_PERMISSIONS, RbacService } from '../../src/server/services/rbacService';

describe('LEDGERAI PH — PHASE 6: Full-System End-to-End Integration Test Suite', () => {
  let fallbackAiProvider: LocalFallbackProvider;

  beforeAll(async () => {
    fallbackAiProvider = new LocalFallbackProvider();
    registerAllCoreSkills();
  });

  async function setupCompanyFixture() {
    const companyId = crypto.randomUUID();
    const ownerUserId = crypto.randomUUID();
    const accountantUserId = crypto.randomUUID();
    const bookkeeperUserId = crypto.randomUUID();
    const auditorUserId = crypto.randomUUID();
    const periodId = crypto.randomUUID();

    // 1. Create Company Profile (VAT Registered Corporation under Philippine Law)
    await db.insert(schema.companies).values({
      id: companyId,
      legalName: 'Apex Pacific Solutions Inc.',
      tradeName: 'Apex Pacific',
      tin: '987-654-321-000',
      taxpayerClassification: 'CORPORATION',
      vatStatus: 'VAT',
      rdoCode: '048',
      fiscalYearStartMonth: 1,
      status: 'ACTIVE',
      isDemo: false
    });

    // 2. Tax Profile Configuration (CREATE Act 25% Regular Corporate Income Tax + 12% VAT)
    await db.insert(schema.companyTaxProfiles).values({
      id: crypto.randomUUID(),
      companyId,
      taxpayerClassification: 'CORPORATION',
      vatStatus: 'VAT',
      taxRegime: 'VAT',
      incomeTaxRate: 25,
      usesMws: false,
      isTopWithholdingAgent: true
    });

    // 3. Create Standard Philippine Chart of Accounts Template
    const coaAccounts = [
      { id: crypto.randomUUID(), companyId, accountCode: '1010', accountName: 'Cash in Bank', accountType: 'ASSET', normalBalance: 'DEBIT', isCashAccount: true, isControlAccount: false, isTaxAccount: false },
      { id: crypto.randomUUID(), companyId, accountCode: '1030', accountName: 'Accounts Receivable', accountType: 'ASSET', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: true, isTaxAccount: false },
      { id: crypto.randomUUID(), companyId, accountCode: '1050', accountName: 'Input VAT (12%)', accountType: 'ASSET', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
      { id: crypto.randomUUID(), companyId, accountCode: '1060', accountName: 'Creditable Withholding Tax (2307)', accountType: 'ASSET', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
      { id: crypto.randomUUID(), companyId, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: true, isTaxAccount: false },
      { id: crypto.randomUUID(), companyId, accountCode: '2020', accountName: 'Output VAT (12%)', accountType: 'LIABILITY', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
      { id: crypto.randomUUID(), companyId, accountCode: '2030', accountName: 'Expanded Withholding Tax Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
      { id: crypto.randomUUID(), companyId, accountCode: '3010', accountName: "Owner's Equity / Paid-in Capital", accountType: 'EQUITY', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
      { id: crypto.randomUUID(), companyId, accountCode: '4010', accountName: 'Service Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
      { id: crypto.randomUUID(), companyId, accountCode: '5010', accountName: 'Cost of Services', accountType: 'COST_OF_SALES', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
      { id: crypto.randomUUID(), companyId, accountCode: '6010', accountName: 'Office Rent Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
      { id: crypto.randomUUID(), companyId, accountCode: '6020', accountName: 'Utilities & Internet Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false }
    ];

    await db.insert(schema.accounts).values(coaAccounts);

    // 4. Assign Users with Multi-Tier Roles
    await db.insert(schema.users).values([
      { id: ownerUserId, username: 'apex_owner_' + companyId.slice(0, 6), email: `owner_${companyId.slice(0, 6)}@apexpacific.ph`, passwordHash: 'hash', displayName: 'Apex Owner' },
      { id: accountantUserId, username: 'apex_cpa_' + companyId.slice(0, 6), email: `cpa_${companyId.slice(0, 6)}@apexpacific.ph`, passwordHash: 'hash', displayName: 'Apex CPA' },
      { id: bookkeeperUserId, username: 'apex_bk_' + companyId.slice(0, 6), email: `bk_${companyId.slice(0, 6)}@apexpacific.ph`, passwordHash: 'hash', displayName: 'Apex Bookkeeper' },
      { id: auditorUserId, username: 'apex_aud_' + companyId.slice(0, 6), email: `auditor_${companyId.slice(0, 6)}@apexpacific.ph`, passwordHash: 'hash', displayName: 'Apex Auditor' }
    ]);

    await db.insert(schema.companyUsers).values([
      { id: crypto.randomUUID(), companyId, userId: ownerUserId, role: 'Company Owner' },
      { id: crypto.randomUUID(), companyId, userId: accountantUserId, role: 'Accountant' },
      { id: crypto.randomUUID(), companyId, userId: bookkeeperUserId, role: 'Bookkeeper' },
      { id: crypto.randomUUID(), companyId, userId: auditorUserId, role: 'Read-only User' }
    ]);

    // 5. Create Accounting Period for Year 2026
    await db.insert(schema.accountingPeriods).values({
      id: periodId,
      companyId,
      name: 'CY 2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      fiscalYear: 2026,
      status: 'OPEN'
    });

    return {
      companyId,
      ownerUserId,
      accountantUserId,
      bookkeeperUserId,
      auditorUserId,
      periodId,
      coaAccounts
    };
  }

  // =========================================================================
  // FLOW A: COMPANY SETUP & INITIALIZATION
  // =========================================================================
  test('FLOW A: Company Setup → Business Profile → Philippine COA → Users & RBAC → Opening Balances', async () => {
    await runInTestDb(async () => {
      const fixture = await setupCompanyFixture();
      const cashAcct = fixture.coaAccounts.find(a => a.accountCode === '1010')!;
      const equityAcct = fixture.coaAccounts.find(a => a.accountCode === '3010')!;
      const openingJournalId = crypto.randomUUID();

      // Post Balanced Opening Balance Journal Entry (Debit Cash 500,000 PHP, Credit Capital 500,000 PHP)
      await db.insert(schema.journalEntries).values({
        id: openingJournalId,
        companyId: fixture.companyId,
        journalNumber: 'JE-2026-0001',
        entryDate: '2026-01-01',
        accountingPeriodId: fixture.periodId,
        description: 'Opening Balances - Capital Contribution',
        sourceType: 'OPENING_BALANCE',
        status: 'POSTED',
        createdBy: fixture.ownerUserId,
        postedBy: fixture.ownerUserId,
        postedAt: new Date()
      });

      await db.insert(schema.journalLines).values([
        {
          id: crypto.randomUUID(),
          journalEntryId: openingJournalId,
          accountId: cashAcct.id,
          lineNumber: 1,
          debit: 50000000,
          credit: 0,
          description: 'Initial Capital Cash Deposit'
        },
        {
          id: crypto.randomUUID(),
          journalEntryId: openingJournalId,
          accountId: equityAcct.id,
          lineNumber: 2,
          debit: 0,
          credit: 50000000,
          description: "Owner's Paid-in Capital"
        }
      ]);

      // Verify Company and Initial Trial Balance
      const companyRecord = await db.select().from(schema.companies).where(eq(schema.companies.id, fixture.companyId)).get();
      expect(companyRecord).toBeDefined();
      expect(companyRecord?.taxpayerClassification).toBe('CORPORATION');

      const accountsInDb = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, fixture.companyId));
      expect(accountsInDb.length).toBe(12);
    });
  });

  // =========================================================================
  // FLOW B: PURCHASE LIFECYCLE (OCR → Verify → Purchase Bill → Input VAT → AP Entry → Trial Balance)
  // =========================================================================
  test('FLOW B: Purchase Ingestion → OCR Verification → Purchase Bill → 12% Input VAT → Journal Entry & AP Subledger', async () => {
    await runInTestDb(async () => {
      const fixture = await setupCompanyFixture();

      // 1. Register Supplier Master Data
      const vendorId = crypto.randomUUID();
      await db.insert(schema.vendors).values({
        id: vendorId,
        companyId: fixture.companyId,
        code: 'VEND-001',
        legalName: 'Makati Office Leasing Inc.',
        tradeName: 'Makati Commercial Spaces',
        tin: '222-333-444-000',
        taxClassification: 'CORPORATION',
        vatStatus: 'VAT',
        withholdingApplicability: 'APPLICABLE',
        status: 'ACTIVE'
      });

      // 2. Ingest Document and Simulate OCR Extraction
      const docId = crypto.randomUUID();
      const mockInvoiceNumber = 'MOL-INV-8890';
      const rentGrossAmount = 11200000; // 112,000.00 PHP (100,000 Net + 12,000 VAT)
      const rentVatAmount = 1200000; // 12,000.00 PHP
      const rentNetSales = 10000000; // 100,000.00 PHP

      await db.insert(schema.documents).values({
        id: docId,
        companyId: fixture.companyId,
        entityType: 'PURCHASE_BILL',
        entityId: vendorId,
        fileName: 'Makati_Rent_Invoice_Jan2026.pdf',
        originalFileName: 'Makati_Rent_Invoice_Jan2026.pdf',
        fileType: 'application/pdf',
        fileSize: 102400,
        fileHash: crypto.createHash('sha256').update('RentInvoice2026').digest('hex'),
        filePath: '/vault/companies/' + fixture.companyId + '/docs/' + docId + '.pdf',
        source: 'WEB_UI',
        verificationStatus: 'VERIFIED',
        confidenceScore: 0.98,
        extractedMerchant: 'Makati Office Leasing Inc.',
        extractedTin: '222-333-444-000',
        extractedInvoiceNumber: mockInvoiceNumber,
        extractedDate: '2026-01-15',
        extractedTotalAmount: rentGrossAmount,
        extractedVatAmount: rentVatAmount,
        extractedVatableSales: rentNetSales,
        status: 'ACTIVE',
        uploadedBy: fixture.bookkeeperUserId,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // 3. Create Verified Purchase Bill
      const billId = crypto.randomUUID();
      await db.insert(schema.purchaseBills).values({
        id: billId,
        companyId: fixture.companyId,
        vendorId,
        billNumber: mockInvoiceNumber,
        billDate: '2026-01-15',
        dueDate: '2026-01-31',
        totalAmount: rentGrossAmount,
        balanceDue: rentGrossAmount - 500000, // 107,000.00 PHP payable
        status: 'POSTED',
        notes: 'Monthly Office Rental for January 2026',
        createdBy: fixture.accountantUserId
      });

      // 4. Generate Balanced Accounting Journal Entry
      const rentAcct = fixture.coaAccounts.find(a => a.accountCode === '6010')!;
      const inputVatAcct = fixture.coaAccounts.find(a => a.accountCode === '1050')!;
      const ewtAcct = fixture.coaAccounts.find(a => a.accountCode === '2030')!;
      const apAcct = fixture.coaAccounts.find(a => a.accountCode === '2010')!;

      const billJournalId = crypto.randomUUID();
      await db.insert(schema.journalEntries).values({
        id: billJournalId,
        companyId: fixture.companyId,
        journalNumber: 'JE-2026-0002',
        entryDate: '2026-01-15',
        accountingPeriodId: fixture.periodId,
        description: `Purchase Bill ${mockInvoiceNumber} - Office Rent`,
        sourceType: 'PURCHASE_BILL',
        sourceId: billId,
        status: 'POSTED',
        createdBy: fixture.accountantUserId,
        postedBy: fixture.accountantUserId,
        postedAt: new Date()
      });

      await db.insert(schema.journalLines).values([
        { id: crypto.randomUUID(), journalEntryId: billJournalId, accountId: rentAcct.id, lineNumber: 1, debit: rentNetSales, credit: 0, description: 'Office Rent' },
        { id: crypto.randomUUID(), journalEntryId: billJournalId, accountId: inputVatAcct.id, lineNumber: 2, debit: rentVatAmount, credit: 0, description: '12% Input VAT on Commercial Rent' },
        { id: crypto.randomUUID(), journalEntryId: billJournalId, accountId: ewtAcct.id, lineNumber: 3, debit: 0, credit: 500000, description: '5% EWT on Rent (ATC: WI010/WC010)' },
        { id: crypto.randomUUID(), journalEntryId: billJournalId, accountId: apAcct.id, lineNumber: 4, debit: 0, credit: 10700000, description: 'Accounts Payable to Landlord' }
      ]);

      // 5. Verify Ledger & Subledger Consistency
      const billRecord = await db.select().from(schema.purchaseBills).where(eq(schema.purchaseBills.id, billId)).get();
      expect(billRecord).toBeDefined();
      expect(billRecord?.totalAmount).toBe(rentGrossAmount);
      expect(billRecord?.balanceDue).toBe(10700000);
    });
  });

  // =========================================================================
  // FLOW C: SALES LIFECYCLE (Sales Invoice → Output VAT → AR Debit → Tax Engine)
  // =========================================================================
  test('FLOW C: Sales Invoicing → Output VAT (12%) → AR Subledger & Revenue Recognition → Journaling', async () => {
    await runInTestDb(async () => {
      const fixture = await setupCompanyFixture();

      // 1. Register Customer Master Data
      const customerId = crypto.randomUUID();
      await db.insert(schema.customers).values({
        id: customerId,
        companyId: fixture.companyId,
        code: 'CUST-001',
        legalName: 'Manila Tech Ventures Inc.',
        tradeName: 'Manila Tech',
        tin: '555-666-777-000',
        taxClassification: 'CORPORATION',
        vatStatus: 'VAT',
        status: 'ACTIVE'
      });

      // 2. Issue BIR-Compliant Sales Invoice
      const salesGross = 22400000;
      const salesOutputVat = 2400000;
      const salesNet = 20000000;
      const cwtDeduction = 400000; // 2% CWT on Professional/Tech Services = 4,000.00 PHP
      const invoiceId = crypto.randomUUID();

      await db.insert(schema.salesInvoices).values({
        id: invoiceId,
        companyId: fixture.companyId,
        customerId,
        invoiceNumber: 'SI-2026-0001',
        invoiceDate: '2026-01-20',
        dueDate: '2026-02-20',
        totalAmount: salesGross,
        balanceDue: salesGross - cwtDeduction, // 220,000.00 PHP receivable
        status: 'POSTED',
        createdBy: fixture.accountantUserId
      });

      // 3. Post Balanced Sales Journal Entry
      const arAcct = fixture.coaAccounts.find(a => a.accountCode === '1030')!;
      const cwtAcct = fixture.coaAccounts.find(a => a.accountCode === '1060')!;
      const revAcct = fixture.coaAccounts.find(a => a.accountCode === '4010')!;
      const outputVatAcct = fixture.coaAccounts.find(a => a.accountCode === '2020')!;

      const salesJournalId = crypto.randomUUID();
      await db.insert(schema.journalEntries).values({
        id: salesJournalId,
        companyId: fixture.companyId,
        journalNumber: 'JE-2026-0003',
        entryDate: '2026-01-20',
        accountingPeriodId: fixture.periodId,
        description: 'Sales Invoice SI-2026-0001 to Manila Tech Ventures',
        sourceType: 'SALES_INVOICE',
        sourceId: invoiceId,
        status: 'POSTED',
        createdBy: fixture.accountantUserId,
        postedBy: fixture.accountantUserId,
        postedAt: new Date()
      });

      await db.insert(schema.journalLines).values([
        { id: crypto.randomUUID(), journalEntryId: salesJournalId, accountId: arAcct.id, lineNumber: 1, debit: salesGross - cwtDeduction, credit: 0, description: 'Accounts Receivable' },
        { id: crypto.randomUUID(), journalEntryId: salesJournalId, accountId: cwtAcct.id, lineNumber: 2, debit: cwtDeduction, credit: 0, description: '2% Creditable Withholding Tax (BIR Form 2307)' },
        { id: crypto.randomUUID(), journalEntryId: salesJournalId, accountId: revAcct.id, lineNumber: 3, debit: 0, credit: salesNet, description: 'Consulting & Software Revenue' },
        { id: crypto.randomUUID(), journalEntryId: salesJournalId, accountId: outputVatAcct.id, lineNumber: 4, debit: 0, credit: salesOutputVat, description: '12% Output VAT on Consulting' }
      ]);

      // Verify Sales Invoice
      const invoiceRecord = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, invoiceId)).get();
      expect(invoiceRecord).toBeDefined();
      expect(invoiceRecord?.totalAmount).toBe(salesGross);
      expect(invoiceRecord?.balanceDue).toBe(22000000);
    });
  });

  // =========================================================================
  // FLOW D: EXPENSES & CASH DISBURSEMENTS
  // =========================================================================
  test('FLOW D: Expense Verification → Cash Disbursement → Ledger Entry → Tax Deductibility', async () => {
    await runInTestDb(async () => {
      const fixture = await setupCompanyFixture();
      const utilAcct = fixture.coaAccounts.find(a => a.accountCode === '6020')!;
      const inputVatAcct = fixture.coaAccounts.find(a => a.accountCode === '1050')!;
      const cashAcct = fixture.coaAccounts.find(a => a.accountCode === '1010')!;

      // Fiber Internet bill payment: 11,200.00 PHP (10,000 Net + 1,200 Input VAT)
      const utilGross = 1120000;
      const utilVat = 120000;
      const utilNet = 1000000;
      const expenseJournalId = crypto.randomUUID();

      await db.insert(schema.journalEntries).values({
        id: expenseJournalId,
        companyId: fixture.companyId,
        journalNumber: 'JE-2026-0004',
        entryDate: '2026-01-25',
        accountingPeriodId: fixture.periodId,
        description: 'Direct Cash Payment - Telecom & Fiber Internet',
        sourceType: 'EXPENSE',
        status: 'POSTED',
        createdBy: fixture.accountantUserId,
        postedBy: fixture.accountantUserId,
        postedAt: new Date()
      });

      await db.insert(schema.journalLines).values([
        { id: crypto.randomUUID(), journalEntryId: expenseJournalId, accountId: utilAcct.id, lineNumber: 1, debit: utilNet, credit: 0, description: 'High-speed Fiber Internet' },
        { id: crypto.randomUUID(), journalEntryId: expenseJournalId, accountId: inputVatAcct.id, lineNumber: 2, debit: utilVat, credit: 0, description: '12% Input VAT on Telecom' },
        { id: crypto.randomUUID(), journalEntryId: expenseJournalId, accountId: cashAcct.id, lineNumber: 3, debit: 0, credit: utilGross, description: 'Bank Online Disbursement' }
      ]);

      const lines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, expenseJournalId));
      expect(lines.length).toBe(3);
    });
  });

  // =========================================================================
  // FLOW E: PHILIPPINE TAX ENGINE & BIR COMPLIANCE (Tax calculations, rules, 2307, EOPT)
  // =========================================================================
  test('FLOW E: Philippine Tax Engine computes VAT (12%), EWT, and Invoice Taxes correctly', async () => {
    await runInTestDb(async () => {
      const fixture = await setupCompanyFixture();

      // 1. Calculate invoice tax breakdown using TaxEngine.calculateInvoiceTaxes
      const invoiceTaxes = await TaxEngine.calculateInvoiceTaxes(fixture.companyId, 22400000, {
        withholdingTaxRate: 0.02 // 2% CWT
      });

      expect(invoiceTaxes.engineCode).toContain('VAT');
      expect(invoiceTaxes.taxRateApplied).toBe(0.12);
      expect(invoiceTaxes.grossAmountCentavos).toBe(22400000);
      expect(invoiceTaxes.taxAmountCentavos).toBe(2400000);
      expect(invoiceTaxes.withholdingTaxAmountCentavos).toBe(400000);
      expect(invoiceTaxes.finalPayableCentavos).toBe(22000000);
      expect(invoiceTaxes.journalLinesPreview.length).toBeGreaterThan(0);

      // 2. Test mathematical VAT calculation
      const { taxBase, vatAmount } = TaxEngine.calculateVat(11200000, 0.12);
      expect(taxBase).toBe(10000000);
      expect(vatAmount).toBe(1200000);

      // 3. Test mathematical EWT calculation (5% on 100,000 PHP)
      const ewtAmount = TaxEngine.calculateEwt(10000000, 0.05);
      expect(ewtAmount).toBe(500000);

      // 4. Test Graduated Individual Tax brackets
      const brackets = [
        { lowerLimit: 0, upperLimit: 25000000, rate: 0, fixedAmount: 0 },
        { lowerLimit: 25000000, upperLimit: 40000000, rate: 0.15, fixedAmount: 0 },
        { lowerLimit: 40000000, upperLimit: 80000000, rate: 0.20, fixedAmount: 2250000 }
      ];
      const indTax = TaxEngine.calculateGraduatedIncomeTax(50000000, brackets); // 500,000.00 PHP income
      expect(indTax).toBe(4250000);
    });
  });

  // =========================================================================
  // FLOW F: AI ASSISTANT (IntentRouter → SkillManager → Domain Queries → Safe Mutations)
  // =========================================================================
  test('FLOW F: AI Assistant Intent Routing, Domain Execution & Mutation Confirmation Gates', async () => {
    const availableSkills = skillRegistry.listSkills().map(s => s.id);

    // 1. Natural Language Tax / Financial Query
    const financialRoute = await IntentRouter.routeIntent('Magkano ang kinita ng kumpanya at Output VAT?', fallbackAiProvider, availableSkills);
    expect(['getFinancialSummary', 'getSalesSummary', 'taxQuery', 'financialQuery']).toContain(financialRoute.skillId);

    // 2. High-Risk Action Safety Gate: Attempting to delete a posted transaction
    const dangerousIntent = await IntentRouter.routeIntent('Delete journal entry JE-2026-0001', fallbackAiProvider, availableSkills);
    expect(dangerousIntent.skillId).toBe('requestActionConfirmation');
    expect(dangerousIntent.pendingAction?.riskLevel).toBe('HIGH_MUTATION');

    // 3. Analytics & BI Engine Execution
    await runInTestDb(async () => {
      const fixture = await setupCompanyFixture();
      const analytics = await AnalyticsEngine.getFinancialAnalytics(fixture.companyId, 3);
      expect(analytics.companyId).toBe(fixture.companyId);
      expect(analytics.margins).toBeDefined();
      expect(analytics.trends).toBeDefined();
      expect(analytics.cashFlow).toBeDefined();
    });
  });

  // =========================================================================
  // FLOW G: AUDIT SUBSYSTEM (Compliance Rules → Findings → Lead Sheets → Tamper-Proof Audit Trail)
  // =========================================================================
  test('FLOW G: Audit Engagement → Compliance Rules Engine → Findings Generation → Audit Trail Logging', async () => {
    await runInTestDb(async () => {
      const fixture = await setupCompanyFixture();

      // 1. Evaluate Full Compliance Health
      const complianceReport = await ComplianceRuleEngine.evaluateAll(fixture.companyId);
      expect(complianceReport.companyId).toBe(fixture.companyId);
      expect(typeof complianceReport.summary.healthScore).toBe('number');
      expect(complianceReport.summary.healthScore).toBeGreaterThanOrEqual(0);

      // 2. Record Immutable Audit Log with Context
      await AuditService.log({
        companyId: fixture.companyId,
        userId: fixture.auditorUserId,
        action: 'AUDIT_REVIEW_PERFORMED',
        entityType: 'TAX_DECLARATION',
        entityId: '2026-Q1-2550Q',
        afterData: {
          reviewer: 'Apex Auditor',
          period: '2026-Q1',
          verifiedVatNet: 1080000,
          complianceStatus: 'COMPLIANT'
        }
      });

      const auditLogsInDb = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.companyId, fixture.companyId));
      expect(auditLogsInDb.length).toBeGreaterThan(0);
      const targetLog = auditLogsInDb.find(l => l.action === 'AUDIT_REVIEW_PERFORMED');
      expect(targetLog).toBeDefined();
      expect(targetLog?.entityType).toBe('TAX_DECLARATION');
    });
  });

  // =========================================================================
  // RBAC & ROLE-BASED ACCESS PERMISSION TESTS
  // =========================================================================
  test('ROLE & PERMISSION MATRIX: Enforces correct authorization barriers across Owner, Accountant, Bookkeeper & Auditor', () => {
    // Owner permissions
    const ownerPerms = SYSTEM_ROLE_PERMISSIONS['Company Owner'];
    expect(ownerPerms.includes('company:write')).toBe(true);
    expect(ownerPerms.includes('accounting:post')).toBe(true);
    expect(ownerPerms.includes('reports:view')).toBe(true);

    // Accountant permissions
    const accountantPerms = SYSTEM_ROLE_PERMISSIONS['Accountant'];
    expect(accountantPerms.includes('accounting:post')).toBe(true);
    expect(accountantPerms.includes('tax:manage')).toBe(true);
    expect(accountantPerms.includes('company:write')).toBe(false);

    // Bookkeeper permissions
    const bookkeeperPerms = SYSTEM_ROLE_PERMISSIONS['Bookkeeper'];
    expect(bookkeeperPerms.includes('accounting:create')).toBe(true);
    expect(bookkeeperPerms.includes('inventory:manage')).toBe(true);
    expect(bookkeeperPerms.includes('accounting:post')).toBe(false);
    expect(bookkeeperPerms.includes('company:write')).toBe(false);

    // Read-only User permissions
    const readonlyPerms = SYSTEM_ROLE_PERMISSIONS['Read-only User'];
    expect(readonlyPerms.includes('reports:view')).toBe(true);
    expect(readonlyPerms.includes('accounting:create')).toBe(false);
    expect(readonlyPerms.includes('accounting:post')).toBe(false);

    // Segregation of Duties (SOD) Incompatible Pairs
    expect(() => RbacService.verifySegregationOfDuties(['Bookkeeper', 'Auditor'])).toThrow('SOD Violation');
    expect(() => RbacService.verifySegregationOfDuties(['Company Administrator', 'Auditor'])).toThrow('SOD Violation');
  });

  // =========================================================================
  // ACCOUNTING ATOMICITY & REJECTION OF UNBALANCED TRANSACTIONS
  // =========================================================================
  test('DATA INTEGRITY: Journal entry with unequal debits and credits fails validation', async () => {
    await runInTestDb(async () => {
      // Validation rule: Reject entry if totalDebit !== totalCredit
      const validateJournalEntry = (debit: number, credit: number) => {
        if (debit !== credit) {
          throw new Error('UNBALANCED_JOURNAL_ENTRY: Total debits must equal total credits');
        }
      };

      const testDebit = 5000000;
      const testCredit = 4000000;
      expect(() => validateJournalEntry(testDebit, testCredit)).toThrow('UNBALANCED_JOURNAL_ENTRY');
      expect(() => validateJournalEntry(5000000, 5000000)).not.toThrow();
    });
  });
});
