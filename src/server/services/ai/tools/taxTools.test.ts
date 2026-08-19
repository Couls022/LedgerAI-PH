import { describe, test, expect, beforeAll } from 'vitest';
import { getVatPayable, getPercentageTax, getTaxFilingRequirements, calculate8PercentIncomeTax } from './taxTools';
import { db } from '../../../db';
import * as schema from '../../../db/schema';
import { runInTestDb } from '../../../../../tests/setup';

describe('AI Tax Tools with Philippine Tax Engine', () => {
  let testCompanyId: string;
  let testSolePropId: string;
  let testMixedIncomeSolePropId: string;

  beforeAll(async () => {
    await runInTestDb(async () => {
      testCompanyId = crypto.randomUUID();
      testSolePropId = crypto.randomUUID();
      testMixedIncomeSolePropId = crypto.randomUUID();
      
      // 1. Corporate VAT Company
      await db.insert(schema.companies).values({
        id: testCompanyId,
        legalName: 'Acme Philippines Holdings Inc.',
        tradeName: 'Acme PH',
        tin: '123-456-789-000',
        taxpayerClassification: 'CORPORATION',
        vatStatus: 'VAT',
        status: 'ACTIVE'
      });

      await db.insert(schema.companyTaxProfiles).values({
        id: crypto.randomUUID(),
        companyId: testCompanyId,
        taxpayerClassification: 'CORPORATION',
        vatStatus: 'VAT',
        taxRegime: 'VAT'
      });

      // 2. Purely Self-Employed 8% Sole Proprietorship
      await db.insert(schema.companies).values({
        id: testSolePropId,
        legalName: 'Maria Santos Consulting Services',
        tradeName: 'MS Consulting',
        tin: '987-654-321-000',
        taxpayerClassification: 'INDIVIDUAL_8PERCENT',
        vatStatus: 'NON_VAT',
        status: 'ACTIVE'
      });

      await db.insert(schema.companyTaxProfiles).values({
        id: crypto.randomUUID(),
        companyId: testSolePropId,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT',
        vatStatus: 'NON_VAT',
        taxRegime: '8_PERCENT_FLAT',
        registrationInformation: JSON.stringify({ isMixedIncomeEarner: false })
      });

      // 3. Mixed-Income Earner Sole Proprietorship
      await db.insert(schema.companies).values({
        id: testMixedIncomeSolePropId,
        legalName: 'Juan Dela Cruz Tech & Design',
        tradeName: 'JDC Tech',
        tin: '555-666-777-000',
        taxpayerClassification: 'INDIVIDUAL_8PERCENT',
        vatStatus: 'NON_VAT',
        status: 'ACTIVE'
      });

      await db.insert(schema.companyTaxProfiles).values({
        id: crypto.randomUUID(),
        companyId: testMixedIncomeSolePropId,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT',
        vatStatus: 'NON_VAT',
        taxRegime: '8_PERCENT_FLAT',
        registrationInformation: JSON.stringify({ isMixedIncomeEarner: true })
      });
    });
  });

  test('getTaxFilingRequirements retrieves authoritative BIR schedule and rules', async () => {
    await runInTestDb(async () => {
      const requirements = await getTaxFilingRequirements({ companyId: testCompanyId });
      expect(requirements.companyId).toBe(testCompanyId);
      expect(requirements.taxpayerClassification).toBe('CORPORATION');
      expect(requirements.vatStatus).toBe('VAT');
      expect(requirements.vatOrPercentageTax.form).toContain('2550Q');
      expect(requirements.vatOrPercentageTax.isVatRegistered).toBe(true);
      expect(requirements.incomeTax.form).toContain('1702');
      expect(requirements.withholdingTaxes.expandedWithholdingTaxForm).toContain('1601-EQ');
    });
  });

  test('getVatPayable computes accurate VAT using Philippine Tax Engine', async () => {
    await runInTestDb(async () => {
      const vatResult = await getVatPayable({ companyId: testCompanyId });
      expect(vatResult.companyId).toBe(testCompanyId);
      expect(vatResult.isVatRegistered).toBe(true);
      expect(vatResult.grossSales).toBe(0);
      expect(vatResult.outputVat).toBe(0);
      expect(vatResult.netVatPayable).toBe(0);
      expect(vatResult.authoritativeSource).toContain('PhilippineTaxEngine');
    });
  });

  test('getPercentageTax recognizes VAT status exemption correctly', async () => {
    await runInTestDb(async () => {
      const ptResult = await getPercentageTax({ companyId: testCompanyId });
      expect(ptResult.companyId).toBe(testCompanyId);
      expect(ptResult.isPercentageTaxRegistered).toBe(false);
      expect(ptResult.isExempt).toBe(true);
      expect(ptResult.percentageTaxPayable).toBe(0);
    });
  });

  test('calculate8PercentIncomeTax applies P250,000 deduction for purely self-employed individuals', async () => {
    await runInTestDb(async () => {
      // Gross sales = ₱1,000,000 (100,000,000 centavos)
      // Purely self-employed deduction = ₱250,000 (25,000,000 centavos)
      // Taxable business base = ₱750,000 (75,000,000 centavos)
      // Tax due @ 8% = ₱60,000 (6,000,000 centavos)
      const res = await calculate8PercentIncomeTax({
        companyId: testSolePropId,
        grossSalesCentavos: 100_000_000,
        isMixedIncomeEarner: false
      });

      expect(res.isEligible).toBe(true);
      expect(res.isMixedIncomeEarner).toBe(false);
      expect(res.businessIncome.grossSalesCentavos).toBe(100_000_000);
      expect(res.businessIncome.statutoryDeductionCentavos).toBe(25_000_000);
      expect(res.businessIncome.taxableBaseCentavos).toBe(75_000_000);
      expect(res.businessIncome.taxDueCentavos).toBe(6_000_000);
      expect(res.businessIncome.taxDue).toBe(60000);
      expect(res.totalIncomeTaxDueCentavos).toBe(6_000_000);
      expect(res.applicableForm).toContain('1701A');
    });
  });

  test('calculate8PercentIncomeTax applies 8% to business income from 1st peso for mixed-income earners with 250k exemption only on compensation', async () => {
    await runInTestDb(async () => {
      // Business Gross Sales: ₱1,000,000 (100,000,000 centavos)
      // Mixed-income earner deduction against business: ₱0
      // Business Tax Due @ 8% = ₱80,000 (8,000,000 centavos)
      // Compensation Income: ₱400,000 (40,000,000 centavos)
      // Compensation Tax: 1st 250k is 0%, excess 150k @ 15% = ₱22,500 (2,250,000 centavos)
      // Total Tax Due = ₱80,000 + ₱22,500 = ₱102,500 (10,250,000 centavos)
      const res = await calculate8PercentIncomeTax({
        companyId: testMixedIncomeSolePropId,
        grossSalesCentavos: 100_000_000,
        grossCompensationIncomeCentavos: 40_000_000,
        isMixedIncomeEarner: true
      });

      expect(res.isEligible).toBe(true);
      expect(res.isMixedIncomeEarner).toBe(true);
      expect(res.businessIncome.grossSalesCentavos).toBe(100_000_000);
      expect(res.businessIncome.statutoryDeductionCentavos).toBe(0);
      expect(res.businessIncome.taxableBaseCentavos).toBe(100_000_000);
      expect(res.businessIncome.taxDueCentavos).toBe(8_000_000);
      expect(res.businessIncome.taxDue).toBe(80000);

      expect(res.compensationIncome).toBeDefined();
      expect(res.compensationIncome?.grossCompensationCentavos).toBe(40_000_000);
      expect(res.compensationIncome?.statutoryExemptionCentavos).toBe(25_000_000);
      expect(res.compensationIncome?.taxDueCentavos).toBe(2_250_000);
      expect(res.compensationIncome?.taxDue).toBe(22500);

      expect(res.totalIncomeTaxDueCentavos).toBe(10_250_000);
      expect(res.totalIncomeTaxDue).toBe(102500);
      expect(res.applicableForm).toContain('1701');
    });
  });

  test('getTaxFilingRequirements adapts return form and details for mixed-income status', async () => {
    await runInTestDb(async () => {
      const filingReqs = await getTaxFilingRequirements({
        companyId: testMixedIncomeSolePropId,
        isMixedIncomeEarner: true
      });

      expect(filingReqs.isMixedIncomeEarner).toBe(true);
      expect(filingReqs.incomeTax.form).toContain('1701');
      expect(filingReqs.incomeTax.eightPercentDetails?.statutoryDeductionCentavos).toBe(0);
      expect(filingReqs.incomeTax.eightPercentDetails?.rulesSummary).toContain('Mixed-Income Earner');
    });
  });
});
