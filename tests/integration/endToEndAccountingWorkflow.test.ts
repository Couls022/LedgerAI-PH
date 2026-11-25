import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { runInTestDb } from '../setup';
import crypto from 'crypto';
import { eq, and, sql } from 'drizzle-orm';
import { TaxEngine } from '../../src/server/services/taxEngine';
import { ComplianceRuleEngine } from '../../src/server/services/complianceEngine';
import { AuditService } from '../../src/server/services/auditService';
import { ReportEngine } from '../../src/server/services/reportEngine';
import { createJournalEntry, submitJournalEntry, approveJournalEntry, postJournalEntry } from '../../src/server/db/domain';

describe('LEDGERAI PH — Complete End-to-End Accounting Workflow Integration Test', () => {
  const companyId = crypto.randomUUID();
  const ownerUserId = crypto.randomUUID();
  const cpaUserId = crypto.randomUUID();
  const bookkeeperUserId = crypto.randomUUID();
  const periodId = crypto.randomUUID();

  // Account IDs
  const accCash = crypto.randomUUID();
  const accAR = crypto.randomUUID();
  const accInputVat = crypto.randomUUID();
  const accCWT = crypto.randomUUID();
  const accAP = crypto.randomUUID();
  const accOutputVat = crypto.randomUUID();
  const accEWTPayable = crypto.randomUUID();
  const accCapital = crypto.randomUUID();
  const accRevenue = crypto.randomUUID();
  const accRentExpense = crypto.randomUUID();

  // Master Data IDs
  const vendorId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const purchaseBillId = crypto.randomUUID();
  const salesInvoiceId = crypto.randomUUID();

  beforeAll(async () => {
    await runInTestDb(async () => {
      // -----------------------------------------------------------------------
      // STAGE 1: COMPANY SETUP & STATUTORY TAX REGIME CONFIGURATION
      // -----------------------------------------------------------------------
      await db.insert(schema.companies).values({
        id: companyId,
        legalName: 'Kawayan Digital Systems Corp.',
        tradeName: 'Kawayan Digital',
        tin: '123-456-789-000',
        branchCode: '00000',
        address: 'Unit 1802, BGC High Street Center, Taguig City, Metro Manila',
        industry: 'Software & Technology Services',
        fiscalYear: 2026,
        fiscalYearStartMonth: 1,
        currency: 'PHP',
        timezone: 'Asia/Manila',
        accountingMethod: 'ACCRUAL',
        taxpayerClassification: 'CORPORATION',
        taxpayerType: 'DOMESTIC_CORPORATION',
        vatStatus: 'VAT',
        rdoCode: '044',
        birRegistrationNo: 'BIR-REG-2026-88741',
        birDateRegistered: '2026-01-01',
        documentLocationPath: 'kawayan_digital/docs',
        backupLocationPath: 'kawayan_digital/backups',
        status: 'ACTIVE',
        isDemo: false
      });

      // Philippine Corporate Tax Profile (CREATE Act 25% CIT, Top Withholding Agent)
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

      // Standard Philippine Chart of Accounts
      const accountsList = [
        { id: accCash, companyId, accountCode: '1010', accountName: 'Cash in Bank - PHP', accountType: 'ASSET', detailType: 'CHECKING', normalBalance: 'DEBIT', isCashAccount: true, isControlAccount: false, isTaxAccount: false },
        { id: accAR, companyId, accountCode: '1030', accountName: 'Trade Accounts Receivable', accountType: 'ASSET', detailType: 'ACCOUNTS_RECEIVABLE', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: true, isTaxAccount: false },
        { id: accInputVat, companyId, accountCode: '1050', accountName: 'Input VAT Asset (12%)', accountType: 'ASSET', detailType: 'INPUT_VAT', normalBalance: 'DEBIT', birTaxCategory: 'INPUT_VAT_12', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
        { id: accCWT, companyId, accountCode: '1060', accountName: 'Creditable Withholding Tax (BIR Form 2307)', accountType: 'ASSET', detailType: 'WITHHOLDING_TAX_RECEIVABLE', normalBalance: 'DEBIT', birTaxCategory: 'CWT_2307', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
        { id: accAP, companyId, accountCode: '2010', accountName: 'Trade Accounts Payable', accountType: 'LIABILITY', detailType: 'ACCOUNTS_PAYABLE', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: true, isTaxAccount: false },
        { id: accOutputVat, companyId, accountCode: '2020', accountName: 'Output VAT Payable (12%)', accountType: 'LIABILITY', detailType: 'OUTPUT_VAT', normalBalance: 'CREDIT', birTaxCategory: 'OUTPUT_VAT_12', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
        { id: accEWTPayable, companyId, accountCode: '2030', accountName: 'Expanded Withholding Tax Payable (1601-EQ)', accountType: 'LIABILITY', detailType: 'EWT_PAYABLE', normalBalance: 'CREDIT', birTaxCategory: 'EWT_1601EQ', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
        { id: accCapital, companyId, accountCode: '3010', accountName: 'Common Capital Stock', accountType: 'EQUITY', detailType: 'COMMON_STOCK', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
        { id: accRevenue, companyId, accountCode: '4010', accountName: 'Software Engineering Services Revenue', accountType: 'REVENUE', detailType: 'SERVICE_REVENUE', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
        { id: accRentExpense, companyId, accountCode: '6010', accountName: 'Office Lease & Rental Expense', accountType: 'EXPENSE', detailType: 'RENT_EXPENSE', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false }
      ];
      await db.insert(schema.accounts).values(accountsList);

      // System Users with Multi-Tier Roles
      await db.insert(schema.users).values([
        { id: ownerUserId, email: `owner_${companyId.slice(0, 6)}@kawayandigital.ph`, passwordHash: '$2b$10$hashedownerpassword123', displayName: 'Maria Santos (Owner)', role: 'Company Owner' },
        { id: cpaUserId, email: `cpa_${companyId.slice(0, 6)}@kawayandigital.ph`, passwordHash: '$2b$10$hashedcpapassword123', displayName: 'Juan Dela Cruz, CPA', role: 'Accountant' },
        { id: bookkeeperUserId, email: `bk_${companyId.slice(0, 6)}@kawayandigital.ph`, passwordHash: '$2b$10$hashedbkpassword123', displayName: 'Elena Rivera (Bookkeeper)', role: 'Bookkeeper' }
      ]);

      await db.insert(schema.companyUsers).values([
        { id: crypto.randomUUID(), companyId, userId: ownerUserId, role: 'Company Owner' },
        { id: crypto.randomUUID(), companyId, userId: cpaUserId, role: 'Accountant' },
        { id: crypto.randomUUID(), companyId, userId: bookkeeperUserId, role: 'Bookkeeper' }
      ]);

      // Accounting Period (CY 2026)
      await db.insert(schema.accountingPeriods).values({
        id: periodId,
        companyId,
        name: 'CY 2026 (Jan - Dec 2026)',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        fiscalYear: 2026,
        status: 'OPEN'
      });
    });
  });

  afterAll(async () => {});

  it('Stage 1: Validates Company Setup and Chart of Accounts integrity', async () => {
    await runInTestDb(async () => {
      const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
      expect(company).toBeDefined();
      expect(company?.legalName).toBe('Kawayan Digital Systems Corp.');
      expect(company?.tin).toBe('123-456-789-000');
      expect(company?.vatStatus).toBe('VAT');

      const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
      expect(accounts.length).toBe(10);
      
      const cashAcc = accounts.find(a => a.accountCode === '1010');
      expect(cashAcc?.normalBalance).toBe('DEBIT');
      expect(cashAcc?.isCashAccount).toBe(true);

      const rules = await TaxEngine.getEngineRulesForCompany(companyId);
      expect(rules).toBeDefined();
      expect(rules.isVatRegistered).toBe(true);
      expect(rules.defaultVatRate).toBe(0.12);
    });
  });

  it('Stage 2: Simulates Document Upload, SHA-256 Hashing, and OCR Extraction with Philippine Tax Fields', async () => {
    await runInTestDb(async () => {
      const invoicePayload = {
        merchant: 'Metro Space Realty Inc.',
        tin: '888-999-111-000',
        address: 'BGC Corporate Tower, Taguig City',
        invoiceNumber: 'SI-2026-8831',
        date: '2026-03-15',
        grossAmount: 11200000,    // PHP 112,000.00
        vatableSales: 10000000,   // PHP 100,000.00
        vatAmount: 1200000,       // PHP 12,000.00 (12% VAT)
        withholdingTax: 500000,   // PHP 5,000.00 (5% EWT on Commercial Rent under BIR RR 11-2018)
        paymentMethod: 'BANK_TRANSFER'
      };

      const fileContentBuffer = Buffer.from(JSON.stringify(invoicePayload));
      const fileHash = crypto.createHash('sha256').update(fileContentBuffer).digest('hex');

      await db.insert(schema.documents).values({
        id: docId,
        companyId,
        entityType: 'PURCHASE_BILL',
        entityId: purchaseBillId,
        documentType: 'SALES_INVOICE',
        fileName: 'metro_space_lease_inv_8831.pdf',
        originalFileName: 'MetroSpace_Lease_Mar2026.pdf',
        fileType: 'application/pdf',
        fileSize: fileContentBuffer.length,
        fileHash,
        filePath: `kawayan_digital/docs/${docId}.pdf`,
        source: 'WEB_UI',
        uploadedBy: bookkeeperUserId,
        ocrStatus: 'COMPLETED',
        verificationStatus: 'VERIFIED',
        confidenceScore: 0.98,
        ocrResult: JSON.stringify(invoicePayload),
        extractedMerchant: invoicePayload.merchant,
        extractedTin: invoicePayload.tin,
        extractedAddress: invoicePayload.address,
        extractedInvoiceNumber: invoicePayload.invoiceNumber,
        extractedDate: invoicePayload.date,
        extractedTotalAmount: invoicePayload.grossAmount,
        extractedVatableSales: invoicePayload.vatableSales,
        extractedVatAmount: invoicePayload.vatAmount,
        extractedWithholdingTax: invoicePayload.withholdingTax,
        extractedPaymentMethod: invoicePayload.paymentMethod,
        verifiedBy: cpaUserId,
        status: 'ACTIVE'
      });

      const doc = await db.select().from(schema.documents).where(eq(schema.documents.id, docId)).get();
      expect(doc).toBeDefined();
      expect(doc?.fileHash).toBe(fileHash);
      expect(doc?.ocrStatus).toBe('COMPLETED');
      expect(doc?.verificationStatus).toBe('VERIFIED');
      expect(doc?.extractedTotalAmount).toBe(11200000);
      expect(doc?.extractedVatAmount).toBe(1200000);
    });
  });

  it('Stage 3: Creates Vendor, links Purchase Bill, and posts Balanced Journal Entry with Input VAT & EWT', async () => {
    await runInTestDb(async () => {
      // 1. Register Supplier
      await db.insert(schema.vendors).values({
        id: vendorId,
        companyId,
        code: 'VEND-METRO-01',
        legalName: 'Metro Space Realty Inc.',
        tradeName: 'Metro Space Realty',
        tin: '888-999-111-000',
        address: 'BGC Corporate Tower, Taguig City',
        paymentTerms: 'Net 30 Days',
        taxClassification: 'CORPORATION',
        vatStatus: 'VAT',
        withholdingApplicability: 'EWT_5_PERCENT',
        defaultPayableAccountId: accAP,
        defaultExpenseAccountId: accRentExpense,
        status: 'ACTIVE'
      });

      // 2. Create Purchase Bill
      await db.insert(schema.purchaseBills).values({
        id: purchaseBillId,
        companyId,
        vendorId,
        billNumber: 'PB-2026-0045',
        billDate: '2026-03-15',
        dueDate: '2026-04-14',
        reference: 'SI-2026-8831',
        notes: 'March 2026 Head Office Commercial Lease',
        totalAmount: 11200000,   // PHP 112,000 gross
        balanceDue: 10700000,    // PHP 107,000 net of 5% EWT
        status: 'POSTED',
        createdBy: bookkeeperUserId,
        approvedBy: cpaUserId
      });

      // 3. Create & Post Balanced Journal Entry:
      // DR: 6010 Office Lease Expense        PHP 100,000.00 (10,000,000 cts)
      // DR: 1050 Input VAT Asset (12%)       PHP  12,000.00 ( 1,200,000 cts)
      // CR: 2010 Accounts Payable (Net)      PHP 107,000.00 (10,700,000 cts)
      // CR: 2030 EWT Payable (5% BIR 1601EQ) PHP   5,000.00 (   500,000 cts)
      // Total Debit = 11,200,000 cts | Total Credit = 11,200,000 cts
      const journalId = await createJournalEntry(
        companyId,
        {
          journalNumber: 'JE-PUR-2026-001',
          entryDate: '2026-03-15',
          accountingPeriodId: periodId,
          description: 'Office Lease - Metro Space Realty (SI-2026-8831)',
          createdBy: bookkeeperUserId,
          userRole: 'Bookkeeper'
        },
        [
          { accountId: accRentExpense, debit: 10000000, credit: 0, description: 'Commercial Rent Expense' },
          { accountId: accInputVat, debit: 1200000, credit: 0, description: '12% Input VAT Claimable' },
          { accountId: accAP, debit: 0, credit: 10700000, description: 'Net AP Payable to Metro Space Realty' },
          { accountId: accEWTPayable, debit: 0, credit: 500000, description: '5% EWT Payable under BIR RR 11-2018' }
        ]
      );

      await submitJournalEntry(companyId, journalId, bookkeeperUserId);
      await approveJournalEntry(companyId, journalId, cpaUserId);
      await postJournalEntry(companyId, journalId, cpaUserId);

      // Audit Service Logging
      await AuditService.log({
        companyId,
        userId: cpaUserId,
        userDisplayName: 'Juan Dela Cruz, CPA',
        role: 'Accountant',
        action: 'POST_PURCHASE_BILL',
        entityType: 'PURCHASE_BILL',
        entityId: purchaseBillId,
        entityName: 'Metro Space Realty Inc.',
        recordReference: 'PB-2026-0045',
        source: 'WEB_UI',
        result: 'SUCCESS',
        severity: 'INFO',
        metadata: { grossAmount: 112000, netVatBase: 100000, inputVat: 12000, ewt: 5000 }
      });

      const postedEntry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, journalId)).get();
      expect(postedEntry?.status).toBe('POSTED');

      const lines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, journalId));
      const totalDebits = lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredits = lines.reduce((sum, l) => sum + l.credit, 0);
      expect(totalDebits).toBe(11200000);
      expect(totalCredits).toBe(11200000);
      expect(totalDebits).toEqual(totalCredits);
    });
  });

  it('Stage 4: Creates Customer, posts Sales Invoice, and handles Cash Settlement with CWT & AP Payment', async () => {
    await runInTestDb(async () => {
      // 1. Register Client
      await db.insert(schema.customers).values({
        id: customerId,
        companyId,
        code: 'CUST-BAYANIHAN-01',
        legalName: 'Bayanihan FinTech Solutions Inc.',
        tradeName: 'Bayanihan FinTech',
        tin: '333-444-555-000',
        address: 'Ortigas Center, Pasig City',
        paymentTerms: 'Net 15 Days',
        taxClassification: 'CORPORATION',
        vatStatus: 'VAT',
        withholdingApplicability: 'CWT_2_PERCENT',
        defaultReceivableAccountId: accAR,
        defaultRevenueAccountId: accRevenue,
        status: 'ACTIVE'
      });

      // 2. Post Sales Invoice:
      // Gross Total: PHP 224,000.00 (22,400,000 cts)
      // Net Revenue: PHP 200,000.00 (20,000,000 cts)
      // 12% Output VAT: PHP 24,000.00 (2,400,000 cts)
      await db.insert(schema.salesInvoices).values({
        id: salesInvoiceId,
        companyId,
        customerId,
        invoiceNumber: 'SI-2026-0092',
        invoiceDate: '2026-03-20',
        dueDate: '2026-04-04',
        totalAmount: 22400000,
        balanceDue: 0, // Cleared after collection
        status: 'POSTED',
        createdBy: bookkeeperUserId,
        approvedBy: cpaUserId
      });

      const salesJournalId = await createJournalEntry(
        companyId,
        {
          journalNumber: 'JE-SALES-2026-001',
          entryDate: '2026-03-20',
          accountingPeriodId: periodId,
          description: 'Sales Invoice SI-2026-0092 - Bayanihan FinTech',
          createdBy: bookkeeperUserId,
          userRole: 'Bookkeeper'
        },
        [
          { accountId: accAR, debit: 22400000, credit: 0, description: 'AR Trade - Bayanihan FinTech' },
          { accountId: accRevenue, debit: 0, credit: 20000000, description: 'Software Engineering Services Revenue' },
          { accountId: accOutputVat, debit: 0, credit: 2400000, description: '12% Output VAT Payable' }
        ]
      );
      await submitJournalEntry(companyId, salesJournalId, bookkeeperUserId);
      await approveJournalEntry(companyId, salesJournalId, cpaUserId);
      await postJournalEntry(companyId, salesJournalId, cpaUserId);

      // 3. Customer Payment Settlement (Collection with 2% CWT BIR Form 2307):
      // DR: 1010 Cash in Bank               PHP 219,520 or net after 2% CWT on tax base (2% of 200k = 4,000) -> DR Cash: PHP 220,000.00 (22,000,000 cts)
      // DR: 1060 CWT 2307 Receivable        PHP   4,000.00 (   400,000 cts)
      // CR: 1030 Accounts Receivable        PHP 224,000.00 (22,400,000 cts)
      const collectionJournalId = await createJournalEntry(
        companyId,
        {
          journalNumber: 'JE-COL-2026-001',
          entryDate: '2026-03-25',
          accountingPeriodId: periodId,
          description: 'Official Receipt OR-2026-0051 - Collection from Bayanihan FinTech',
          createdBy: bookkeeperUserId,
          userRole: 'Bookkeeper'
        },
        [
          { accountId: accCash, debit: 22000000, credit: 0, description: 'Cash in Bank Collection' },
          { accountId: accCWT, debit: 400000, credit: 0, description: '2% Creditable Withholding Tax (2307 Certificate)' },
          { accountId: accAR, debit: 0, credit: 22400000, description: 'Clear Trade AR' }
        ]
      );
      await submitJournalEntry(companyId, collectionJournalId, bookkeeperUserId);
      await approveJournalEntry(companyId, collectionJournalId, cpaUserId);
      await postJournalEntry(companyId, collectionJournalId, cpaUserId);

      // 4. Supplier AP Settlement (Bank Transfer Disbursement):
      // DR: 2010 Accounts Payable           PHP 107,000.00 (10,700,000 cts)
      // CR: 1010 Cash in Bank               PHP 107,000.00 (10,700,000 cts)
      const paymentJournalId = await createJournalEntry(
        companyId,
        {
          journalNumber: 'JE-PAY-2026-001',
          entryDate: '2026-03-28',
          accountingPeriodId: periodId,
          description: 'Disbursement Voucher DV-2026-0032 - Settlement to Metro Space Realty',
          createdBy: bookkeeperUserId,
          userRole: 'Bookkeeper'
        },
        [
          { accountId: accAP, debit: 10700000, credit: 0, description: 'Settle Accounts Payable' },
          { accountId: accCash, debit: 0, credit: 10700000, description: 'Disbursement from Cash in Bank' }
        ]
      );
      await submitJournalEntry(companyId, paymentJournalId, bookkeeperUserId);
      await approveJournalEntry(companyId, paymentJournalId, cpaUserId);
      await postJournalEntry(companyId, paymentJournalId, cpaUserId);
    });
  });

  it('Stage 5: Executes Philippine Tax Engine computations and validates Output VAT vs Input VAT parity', async () => {
    await runInTestDb(async () => {
      // 1. Compute VAT on Gross Sales (PHP 224,000 -> Base PHP 200,000, VAT PHP 24,000)
      const salesVat = TaxEngine.calculateVat(22400000);
      expect(salesVat.taxBase).toBe(20000000);
      expect(salesVat.vatAmount).toBe(2400000);

      // 2. Compute VAT on Gross Purchases (PHP 112,000 -> Base PHP 100,000, VAT PHP 12,000)
      const purchaseVat = TaxEngine.calculateVat(11200000);
      expect(purchaseVat.taxBase).toBe(10000000);
      expect(purchaseVat.vatAmount).toBe(1200000);

      // 3. Net VAT Payable = Output VAT (24,000) - Input VAT (12,000) = PHP 12,000.00
      const netVatPayableCentavos = salesVat.vatAmount - purchaseVat.vatAmount;
      expect(netVatPayableCentavos).toBe(1200000);
    });
  });

  it('Stage 6: Runs Compliance Rule Engine audit and verifies statutory rules coverage', async () => {
    await runInTestDb(async () => {
      const auditReport = await ComplianceRuleEngine.evaluateAll(companyId);
      expect(auditReport).toBeDefined();
      expect(auditReport.companyId).toBe(companyId);
      expect(auditReport.summary).toBeDefined();
      expect(typeof auditReport.summary.healthScore).toBe('number');
      expect(auditReport.summary.healthScore).toBeGreaterThanOrEqual(0);
      expect(auditReport.statutoryChecklist.length).toBeGreaterThan(0);
    });
  });

  it('Stage 7: Verifies Triple-Pillar Consistency across Trial Balance, General Ledger, and Financial Reports', async () => {
    await runInTestDb(async () => {
      // 1. TRIAL BALANCE INVARIANT: Sum(Debits) == Sum(Credits)
      const balances = await db.select({
        accountId: schema.accounts.id,
        accountCode: schema.accounts.accountCode,
        accountName: schema.accounts.accountName,
        normalBalance: schema.accounts.normalBalance,
        debitTotal: sql<number>`COALESCE(SUM(${schema.journalLines.debit}), 0)`,
        creditTotal: sql<number>`COALESCE(SUM(${schema.journalLines.credit}), 0)`
      })
      .from(schema.accounts)
      .leftJoin(schema.journalLines, eq(schema.accounts.id, schema.journalLines.accountId))
      .leftJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .where(and(
        eq(schema.accounts.companyId, companyId),
        eq(schema.journalEntries.status, 'POSTED')
      ))
      .groupBy(schema.accounts.id, schema.accounts.accountCode, schema.accounts.accountName, schema.accounts.normalBalance);

      let grandTotalDebits = 0;
      let grandTotalCredits = 0;

      const accountBalances: Record<string, { debit: number; credit: number; net: number }> = {};

      for (const b of balances) {
        grandTotalDebits += b.debitTotal;
        grandTotalCredits += b.creditTotal;
        const net = b.normalBalance === 'DEBIT' 
          ? (b.debitTotal - b.creditTotal)
          : (b.creditTotal - b.debitTotal);
        accountBalances[b.accountCode] = { debit: b.debitTotal, credit: b.creditTotal, net };
      }

      // Exact mathematical equality: Total Debits == Total Credits
      expect(grandTotalDebits).toBeGreaterThan(0);
      expect(grandTotalCredits).toBeGreaterThan(0);
      expect(grandTotalDebits).toEqual(grandTotalCredits);
      expect(grandTotalDebits - grandTotalCredits).toBe(0);

      // 2. GENERAL LEDGER ACCOUNT BALANCES VERIFICATION:
      // 1010 Cash in Bank: DR 220,000 (Collection) - CR 107,000 (Payment) = Net Debit PHP 113,000.00 (11,300,000 cts)
      expect(accountBalances['1010'].net).toBe(11300000);

      // 1030 Accounts Receivable: DR 224,000 - CR 224,000 = Net 0
      expect(accountBalances['1030'].net).toBe(0);

      // 1050 Input VAT: DR 12,000 - CR 0 = Net Debit PHP 12,000.00 (1,200,000 cts)
      expect(accountBalances['1050'].net).toBe(1200000);

      // 1060 CWT 2307 Receivable: DR 4,000 - CR 0 = Net Debit PHP 4,000.00 (400,000 cts)
      expect(accountBalances['1060'].net).toBe(400000);

      // 2010 Accounts Payable: CR 107,000 - DR 107,000 = Net 0
      expect(accountBalances['2010'].net).toBe(0);

      // 2020 Output VAT Payable: CR 24,000 - DR 0 = Net Credit PHP 24,000.00 (2,400,000 cts)
      expect(accountBalances['2020'].net).toBe(2400000);

      // 2030 EWT Payable: CR 5,000 - DR 0 = Net Credit PHP 5,000.00 (500,000 cts)
      expect(accountBalances['2030'].net).toBe(500000);

      // 4010 Revenue: CR 200,000 - DR 0 = Net Credit PHP 200,000.00 (20,000,000 cts)
      expect(accountBalances['4010'].net).toBe(20000000);

      // 6010 Rent Expense: DR 100,000 - CR 0 = Net Debit PHP 100,000.00 (10,000,000 cts)
      expect(accountBalances['6010'].net).toBe(10000000);

      // 3. BALANCE SHEET & INCOME STATEMENT CONSISTENCY:
      // Net Income = Revenue (200k) - Rent Expense (100k) = PHP 100,000.00 (10,000,000 cts)
      const netIncome = accountBalances['4010'].net - accountBalances['6010'].net;
      expect(netIncome).toBe(10000000);

      // Total Assets = Cash (113k) + Input VAT (12k) + CWT (4k) = PHP 129,000.00 (12,900,000 cts)
      const totalAssets = accountBalances['1010'].net + accountBalances['1050'].net + accountBalances['1060'].net;
      expect(totalAssets).toBe(12900000);

      // Total Liabilities = Output VAT (24k) + EWT (5k) = PHP 29,000.00 (2,900,000 cts)
      const totalLiabilities = accountBalances['2020'].net + accountBalances['2030'].net;
      expect(totalLiabilities).toBe(2900000);

      // Balance Sheet Equation: Assets == Liabilities + Equity (Net Income)
      // 129,000.00 == 29,000.00 + 100,000.00
      expect(totalAssets).toBe(totalLiabilities + netIncome);

      // 4. FINANCIAL SUMMARY ENGINE VERIFICATION:
      const finSummary = await ReportEngine.getFinancialSummary(companyId);
      expect(finSummary.totalSales).toBe(22400000);
      expect(finSummary.totalExpenses).toBe(11200000);
      expect(finSummary.netIncome).toBe(11200000); // Gross margin on posted transactions
    });
  });
});
