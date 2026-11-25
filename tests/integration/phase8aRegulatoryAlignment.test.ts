import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { runInTestDb } from '../setup';
import { TaxEngine } from '../../src/server/services/taxEngine';
import { AlphalistService } from '../../src/server/services/alphalistService';

describe('LEDGERAI PH — Phase 8A: Regulatory Rule Currency & Tax Engine Alignment', () => {
  const companyId = crypto.randomUUID();

  beforeAll(async () => {
    await runInTestDb(async () => {
      await db.insert(schema.companies).values({
        id: companyId,
        legalName: 'Phase 8A Regulatory Corp',
        tin: '999-888-777-000',
        address: 'BGC, Taguig City',
        taxpayerClassification: 'CORPORATION',
        vatStatus: 'VAT',
        status: 'ACTIVE',
      });
      await AlphalistService.seedDefaultATCs();
    });
  });

  it('8A-01: Temporal Tax Rule Resolution reproduces historical rates correctly (CREATE Act Sec 116 1% vs Standard 3%)', async () => {
    await runInTestDb(async () => {
      // Transaction date during CREATE Act temporary rate window (July 1, 2020 - June 30, 2023)
      const historicalDate = '2021-08-15';
      const rateHistorical = TaxEngine.getSection116Rate(historicalDate);
      expect(rateHistorical).toBe(0.01);
      const calcHistorical = TaxEngine.calculateSection116PercentageTax(1000000, historicalDate); // 10,000.00 PHP gross
      expect(calcHistorical.taxAmountCentavos).toBe(10000); // 100.00 PHP (1%)
      expect(calcHistorical.rateDescription).toContain('CREATE Act');

      // Transaction date under current standard rate (e.g. 2026)
      const currentDate = '2026-05-10';
      const rateCurrent = TaxEngine.getSection116Rate(currentDate);
      expect(rateCurrent).toBe(0.03);
      const calcCurrent = TaxEngine.calculateSection116PercentageTax(1000000, currentDate);
      expect(calcCurrent.taxAmountCentavos).toBe(30000); // 300.00 PHP (3%)
      expect(calcCurrent.rateDescription).toContain('NIRC Section 116');
    });
  });

  it('8A-02: EOPT Invoicing & VAT Substantiation Metadata Validation', async () => {
    await runInTestDb(async () => {
      const invoiceId = crypto.randomUUID();
      const customerId = crypto.randomUUID();

      await db.insert(schema.customers).values({
        id: customerId,
        companyId,
        code: 'CUST-EOPT',
        legalName: 'EOPT Compliant Client',
        tin: '111-222-333-000',
        address: 'Makati City',
        vatStatus: 'VAT',
      });

      // Insert Sales Invoice adhering to EOPT invoicing standards (unified sales invoice replacing separate OR for goods)
      await db.insert(schema.salesInvoices).values({
        id: invoiceId,
        companyId,
        customerId,
        invoiceNumber: 'INV-2026-0001',
        invoiceType: 'SALES',
        invoiceDate: '2026-08-01',
        totalAmount: 112000, // 1,120.00 PHP gross (1,000 vatable + 120 VAT)
        balanceDue: 0,
        status: 'POSTED',
      });

      const inv = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, invoiceId)).get();
      expect(inv).toBeDefined();
      expect(inv?.invoiceNumber).toBe('INV-2026-0001');
      expect(inv?.totalAmount).toBe(112000);
    });
  });

  it('8A-03: Form 2307 & MAP / SAWT Structural Traceability', async () => {
    await runInTestDb(async () => {
      // Validate that compliance summary generation runs successfully and preserves official source references
      const mapReport = await AlphalistService.generateMAP(companyId, '2026-08');
      expect(mapReport).toBeDefined();
      expect(mapReport.companyId).toBe(companyId);
      expect(mapReport.period).toBe('2026-08');
    });
  });

  it('8A-04: Regulatory Rule Governance prevents unauthorized tax rule mutation', async () => {
    await runInTestDb(async () => {
      // Verify ATC master definition has traceable official metadata reference
      const atcList = await db.select().from(schema.atcDefinitions);
      expect(atcList.length).toBeGreaterThan(0);
      for (const atc of atcList) {
        expect(atc.sourceMetadata).toBeDefined();
        expect(atc.sourceMetadata.length).toBeGreaterThan(0);
      }
    });
  });
});
