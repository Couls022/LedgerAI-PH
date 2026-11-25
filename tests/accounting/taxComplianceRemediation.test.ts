import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { runInTestDb } from '../setup';
import { getBirTaxProfileRules } from '../../src/shared/taxProfile';
import { TaxAuditService } from '../../src/server/services/taxAuditService';
import { BirComplianceService } from '../../src/server/services/birComplianceService';
import { AlphalistService } from '../../src/server/services/alphalistService';

describe('LEDGERAI PH — Step 5 Tax & BIR Compliance Remediation', () => {
  const vatCompanyId = crypto.randomUUID();
  const nonVatCompanyId = crypto.randomUUID();
  const userId = crypto.randomUUID();

  beforeAll(async () => {
    await runInTestDb(async () => {
      await db.insert(schema.users).values({
        id: userId,
        email: `tax-remed-${crypto.randomUUID().slice(0, 8)}@test.ph`,
        displayName: 'Tax Remediation CPA',
        passwordHash: 'hash',
        role: 'Accountant',
        isActive: true,
      });

      await db.insert(schema.companies).values([
        {
          id: vatCompanyId,
          legalName: 'VAT Compliant Corp',
          tin: '111-222-333-000',
          address: 'Makati City',
          taxpayerClassification: 'CORPORATION',
          vatStatus: 'VAT',
          status: 'ACTIVE',
        },
        {
          id: nonVatCompanyId,
          legalName: 'Non-VAT Enterprise',
          tin: '444-555-666-000',
          address: 'Cebu City',
          taxpayerClassification: 'INDIVIDUAL',
          vatStatus: 'NON_VAT',
          status: 'ACTIVE',
        },
      ]);

      // Seed accounts for VAT company reconciliation variance test
      const arAccountId = crypto.randomUUID();
      const salesAccountId = crypto.randomUUID();
      const outputVatAccountId = crypto.randomUUID();
      const ewtPayableAccountId = crypto.randomUUID();
      const expenseAccountId = crypto.randomUUID();
      const apAccountId = crypto.randomUUID();

      await db.insert(schema.accounts).values([
        { id: arAccountId, companyId: vatCompanyId, accountCode: '1020', accountName: 'Accounts Receivable', accountType: 'ASSET', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: salesAccountId, companyId: vatCompanyId, accountCode: '4010', accountName: 'Sales Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: outputVatAccountId, companyId: vatCompanyId, accountCode: '2020', accountName: 'Output VAT Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ewtPayableAccountId, companyId: vatCompanyId, accountCode: '2030', accountName: 'Expanded Withholding Tax Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: expenseAccountId, companyId: vatCompanyId, accountCode: '5010', accountName: 'Professional Fees', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: apAccountId, companyId: vatCompanyId, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
      ]);

      const vatCustId = crypto.randomUUID();
      const unclassifiedCustId = crypto.randomUUID();
      await db.insert(schema.customers).values([
        { id: vatCustId, companyId: vatCompanyId, code: 'C-VAT', legalName: 'VAT Buyer Inc', tin: '222-333-444-000', vatStatus: 'VAT_REGISTERED' },
        { id: unclassifiedCustId, companyId: vatCompanyId, code: 'C-UNCL', legalName: 'Unclassified Buyer', tin: '333-444-555-000', vatStatus: null },
      ]);

      const vendorWithAtcId = crypto.randomUUID();
      const vendorNoAtcId = crypto.randomUUID();
      await db.insert(schema.vendors).values([
        { id: vendorWithAtcId, companyId: vatCompanyId, code: 'V-ATC', legalName: 'Legal Counsel Corp', tin: '777-888-999-000', address: 'BGC', vatStatus: 'VAT_REGISTERED' },
        { id: vendorNoAtcId, companyId: vatCompanyId, code: 'V-NOATC', legalName: 'Unassigned ATC Vendor', tin: '888-999-000-000', address: 'Pasig', vatStatus: '' },
      ]);

      // Sales invoice without matching GL Output VAT credit -> should trigger variance in reconcileGlWithTaxLedger
      const jeSalesId = crypto.randomUUID();
      await db.insert(schema.journalEntries).values({
        id: jeSalesId,
        companyId: vatCompanyId,
        journalNumber: 'JV-VAR-001',
        entryDate: '2026-03-10',
        description: 'Posted invoice missing GL output VAT line',
        sourceType: 'SALES_INVOICE',
        status: 'POSTED',
        createdBy: userId,
      });
      await db.insert(schema.journalLines).values([
        { id: crypto.randomUUID(), journalEntryId: jeSalesId, accountId: arAccountId, description: 'AR', debit: 112000, credit: 0, lineNumber: 1 },
        { id: crypto.randomUUID(), journalEntryId: jeSalesId, accountId: salesAccountId, description: 'Sales', debit: 0, credit: 112000, lineNumber: 2 },
      ]);

      await db.insert(schema.salesInvoices).values([
        {
          id: crypto.randomUUID(),
          companyId: vatCompanyId,
          customerId: vatCustId,
          invoiceNumber: 'SI-2026-001',
          invoiceDate: '2026-03-10',
          totalAmount: 112000,
          balanceDue: 112000,
          status: 'POSTED',
          journalEntryId: jeSalesId,
        },
        {
          id: crypto.randomUUID(),
          companyId: vatCompanyId,
          customerId: unclassifiedCustId,
          invoiceNumber: 'SI-2026-002',
          invoiceDate: '2026-03-12',
          totalAmount: 50000,
          balanceDue: 50000,
          status: 'POSTED',
        },
      ]);

      // Purchase bill without ATC -> must NOT default to 2% EWT
      const billNoAtcId = crypto.randomUUID();
      await db.insert(schema.purchaseBills).values({
        id: billNoAtcId,
        companyId: vatCompanyId,
        vendorId: vendorNoAtcId,
        billNumber: 'PB-NOATC-001',
        billDate: '2026-03-15',
        totalAmount: 100000,
        balanceDue: 100000,
        status: 'POSTED',
      });
      await db.insert(schema.purchaseBillLines).values({
        id: crypto.randomUUID(),
        billId: billNoAtcId,
        accountId: expenseAccountId,
        description: 'Service without ATC',
        quantity: 1,
        unitPrice: 100000,
        amount: 100000,
        taxCodeId: null,
      });

      // Non-VAT company invoice & bill -> reconcileGlWithTaxLedger must NOT extract / 1.12 VAT
      const nonVatCustId = crypto.randomUUID();
      const nonVatVendId = crypto.randomUUID();
      await db.insert(schema.customers).values({
        id: nonVatCustId,
        companyId: nonVatCompanyId,
        code: 'NV-C1',
        legalName: 'Retail Walk-in',
        tin: '123-123-123-0000',
        vatStatus: 'NON_VAT',
      });
      await db.insert(schema.vendors).values({
        id: nonVatVendId,
        companyId: nonVatCompanyId,
        code: 'NV-V1',
        legalName: 'Non-VAT Supplier',
        tin: '321-321-321-0000',
        vatStatus: 'NON_VAT',
      });
      await db.insert(schema.salesInvoices).values({
        id: crypto.randomUUID(),
        companyId: nonVatCompanyId,
        customerId: nonVatCustId,
        invoiceNumber: 'NV-SI-001',
        invoiceDate: '2026-03-05',
        totalAmount: 112000,
        balanceDue: 0,
        status: 'POSTED',
      });
      await db.insert(schema.purchaseBills).values({
        id: crypto.randomUUID(),
        companyId: nonVatCompanyId,
        vendorId: nonVatVendId,
        billNumber: 'NV-PB-001',
        billDate: '2026-03-06',
        totalAmount: 56000,
        balanceDue: 0,
        status: 'POSTED',
      });
    });
  });

  afterAll(async () => {
    await runInTestDb(async () => {
      await db.run(sql`PRAGMA foreign_keys = OFF;`);
      for (const cid of [vatCompanyId, nonVatCompanyId]) {
        await db.delete(schema.purchaseBillLines).where(sql`${schema.purchaseBillLines.billId} IN (SELECT id FROM purchase_bills WHERE company_id = ${cid})`);
        await db.delete(schema.purchaseBills).where(eq(schema.purchaseBills.companyId, cid));
        await db.delete(schema.salesInvoices).where(eq(schema.salesInvoices.companyId, cid));
        await db.delete(schema.journalLines).where(sql`${schema.journalLines.journalEntryId} IN (SELECT id FROM journal_entries WHERE company_id = ${cid})`);
        await db.delete(schema.journalEntries).where(eq(schema.journalEntries.companyId, cid));
        await db.delete(schema.accounts).where(eq(schema.accounts.companyId, cid));
        await db.delete(schema.vendors).where(eq(schema.vendors.companyId, cid));
        await db.delete(schema.customers).where(eq(schema.customers.companyId, cid));
        await db.delete(schema.companies).where(eq(schema.companies.id, cid));
      }
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.run(sql`PRAGMA foreign_keys = ON;`);
    });
  });

  it('supports both mandatory 2550Q (RMC 5-2023) and optional monthly 2550M (RMC 52-2023) for VAT-registered taxpayers', () => {
    const vatRules = getBirTaxProfileRules('CORPORATION', 'VAT');
    expect(vatRules.isVatRegistered).toBe(true);
    expect(vatRules.optionalMonthlyVatForm).toContain('2550M');
    expect(vatRules.ruleVersion).toBe('PH-BIR-2026.1');
    expect(vatRules.effectiveDate).toBe('2024-01-22');

    const vatForms = TaxAuditService.getFormApplicability('CORPORATION', 'VAT');
    const f2550q = vatForms.find(f => f.formCode === '2550Q');
    const f2550m = vatForms.find(f => f.formCode === '2550M');
    expect(f2550q?.isApplicable).toBe(true);
    expect(f2550m?.isApplicable).toBe(true);
    expect(f2550m?.underlyingRules).toContain('52-2023');

    const nonVatRules = getBirTaxProfileRules('INDIVIDUAL', 'NON_VAT');
    expect(nonVatRules.optionalMonthlyVatForm).toBeNull();
    const nonVatForms = TaxAuditService.getFormApplicability('INDIVIDUAL', 'NON_VAT');
    expect(nonVatForms.find(f => f.formCode === '2550Q')?.isApplicable).toBe(false);
    expect(nonVatForms.find(f => f.formCode === '2550M')?.isApplicable).toBe(false);
    expect(nonVatForms.find(f => f.formCode === '2551Q')?.isApplicable).toBe(true);
  });

  it('enforces 8% flat rate eligibility and mixed-income P250k deduction rules', () => {
    const pure8Pct = getBirTaxProfileRules('INDIVIDUAL_8PERCENT', 'INDIVIDUAL_8PERCENT_VAT', { isMixedIncomeEarner: false });
    expect(pure8Pct.qualifiesFor8Percent).toBe(true);
    expect(pure8Pct.statutoryDeduction8PercentCentavos).toBe(25000000);

    const mixed8Pct = getBirTaxProfileRules('INDIVIDUAL_8PERCENT', 'INDIVIDUAL_8PERCENT_VAT', { isMixedIncomeEarner: true });
    expect(mixed8Pct.qualifiesFor8Percent).toBe(true);
    expect(mixed8Pct.statutoryDeduction8PercentCentavos).toBe(0);

    const corp8PctAttempt = getBirTaxProfileRules('CORPORATION', 'INDIVIDUAL_8PERCENT_VAT');
    expect(corp8PctAttempt.qualifiesFor8Percent).toBe(false);
  });

  it('does not apply a silent 2% default EWT rate or synthetic WC15 prefix when ATC is unassigned', async () => {
    await runInTestDb(async () => {
      const form2307 = await BirComplianceService.generateForm2307Data(vatCompanyId, '2026-01-01', '2026-03-31');
      const unassigned = form2307.lineItems.find(l => l.payeeName === 'Unassigned ATC Vendor');
      expect(unassigned).toBeDefined();
      expect(unassigned!.atc).toBe('UNASSIGNED_ATC');
      expect(unassigned!.taxRate).toBe(0);
      expect(unassigned!.totalWithheld).toBe(0);
      expect(unassigned!.validationStatus).toBe('UNASSIGNED_ATC');

      const map = await AlphalistService.generateMAP(vatCompanyId, '2026-03');
      const mapItem = map.items.find(i => i.payeeName === 'Unassigned ATC Vendor');
      expect(mapItem).toBeDefined();
      expect(mapItem!.atc).toBe('UNASSIGNED_ATC');
      expect(mapItem!.taxRate).toBe(0);
      expect(mapItem!.taxWithheld).toBe(0);
      expect(mapItem!.validationStatus).toBe('UNASSIGNED_ATC');
    });
  });

  it('formats MAP and SAWT reports into BIR .DAT records accurately', () => {
    const sampleReport = {
      companyId: vatCompanyId,
      reportType: 'MAP' as const,
      period: '2026-03',
      payor: { name: 'VAT Compliant Corp', tin: '111-222-333-0001', address: 'Makati City' },
      items: [
        {
          payeeId: 'v1',
          payeeName: 'Legal Counsel Corp',
          payeeTin: '777-888-999-0002',
          payeeAddress: 'BGC',
          atc: 'WC010',
          taxRate: 0.15,
          taxBase: 10000,
          taxWithheld: 1500,
          period: '2026-03',
          validationStatus: 'VALID' as const,
        },
      ],
      summary: { totalPayees: 1, totalTaxBase: 10000, totalTaxWithheld: 1500 },
    };

    const mapDat = AlphalistService.formatMAPToBIRDat(sampleReport);
    expect(mapDat).toContain('HMAP,H1601EQ,111222333,0001,"VAT Compliant Corp",03/2026');
    expect(mapDat).toContain('DMAP,D1601EQ,1,777888999,0002,"Legal Counsel Corp",WC010,10000.00,15.00,1500.00,VALID');
    expect(mapDat).toContain('CMAP,C1601EQ,111222333,0001,1,10000.00,1500.00');

    const sawtDat = AlphalistService.formatSAWTToBIRDat({ ...sampleReport, reportType: 'SAWT', period: '2026-Q1' });
    expect(sawtDat).toContain('HSAWT,H1702Q,111222333,0001,"VAT Compliant Corp",2026-Q1');
    expect(sawtDat).toContain('DSAWT,D1702Q,1,777888999,0002,"Legal Counsel Corp",WC010,10000.00,15.00,1500.00,VALID');
    expect(sawtDat).toContain('CSAWT,C1702Q,111222333,0001,1,10000.00,1500.00');
  });

  it('flags unclassified partner VAT instead of assuming 12% VAT and detects real GL-to-tax variances', async () => {
    await runInTestDb(async () => {
      const vatSummary = await BirComplianceService.generateVatSummary(vatCompanyId, '2026-03-01', '2026-03-31');
      const unclassifiedSale = vatSummary.sales.find(s => s.partnerName === 'Unclassified Buyer');
      expect(unclassifiedSale).toBeDefined();
      expect(unclassifiedSale!.validationStatus).toBe('UNCLASSIFIED_VAT');
      expect(unclassifiedSale!.inputOutputVat).toBe(0);
      expect(unclassifiedSale!.taxableAmount).toBe(0);

      const unclassifiedPurchase = vatSummary.purchases.find(p => p.partnerName === 'Unassigned ATC Vendor');
      expect(unclassifiedPurchase).toBeDefined();
      expect(unclassifiedPurchase!.validationStatus).toBe('UNCLASSIFIED_VAT');
      expect(unclassifiedPurchase!.inputOutputVat).toBe(0);

      // VAT company has posted invoices without GL Output VAT credit line -> must NOT report isBalanced: true
      const vatRecon = await TaxAuditService.reconcileGlWithTaxLedger(vatCompanyId, '2026-03-01', '2026-03-31');
      expect(vatRecon.outputVat.subledgerOutputVatCentavos).toBeGreaterThan(0);
      expect(vatRecon.outputVat.glCreditBalanceCentavos).toBe(0);
      expect(vatRecon.outputVat.varianceCentavos).toBe(vatRecon.outputVat.subledgerOutputVatCentavos);
      expect(vatRecon.outputVat.isBalanced).toBe(false);
      expect(vatRecon.overallBalanced).toBe(false);

      // Non-VAT company must NOT fabricate 12% VAT via / 1.12
      const nonVatRecon = await TaxAuditService.reconcileGlWithTaxLedger(nonVatCompanyId, '2026-03-01', '2026-03-31');
      expect(nonVatRecon.outputVat.subledgerOutputVatCentavos).toBe(0);
      expect(nonVatRecon.inputVat.subledgerInputVatCentavos).toBe(0);
      expect(nonVatRecon.overallBalanced).toBe(true);
    });
  });
});
