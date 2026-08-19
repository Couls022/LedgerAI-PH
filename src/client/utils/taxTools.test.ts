import { describe, test, expect } from 'vitest';
import {
  validate8PercentEligibility,
  calculate8PercentIncomeTax,
  calculateCompensationGraduatedTax,
  calculateConsolidatedIndividualTax,
  STATUTORY_EXEMPTION_PESOS,
  STATUTORY_8PERCENT_CEILING_PESOS
} from './taxTools';

describe('Client Tax Tools (8% Preferential Tax & Mixed-Income Protocol)', () => {
  describe('validate8PercentEligibility', () => {
    test('allows individual sole proprietors and professionals under ₱3M ceiling', () => {
      const res = validate8PercentEligibility('INDIVIDUAL_8PERCENT', 1_500_000);
      expect(res.isEligible).toBe(true);
      expect(res.isIndividual).toBe(true);
      expect(res.exceedsVatThreshold).toBe(false);
    });

    test('rejects corporate entity classifications', () => {
      const resCorp = validate8PercentEligibility('CORPORATION', 500_000);
      expect(resCorp.isEligible).toBe(false);
      expect(resCorp.reason).toContain('disqualified');

      const resOpc = validate8PercentEligibility('ONE_PERSON_CORPORATION', 500_000);
      expect(resOpc.isEligible).toBe(false);

      const resGpp = validate8PercentEligibility('GENERAL_PROFESSIONAL_PARTNERSHIP', 500_000);
      expect(resGpp.isEligible).toBe(false);
    });

    test('rejects individual taxpayers exceeding the ₱3,000,000 ceiling', () => {
      const res = validate8PercentEligibility('INDIVIDUAL_8PERCENT', 3_500_000);
      expect(res.isEligible).toBe(false);
      expect(res.exceedsVatThreshold).toBe(true);
      expect(res.reason).toContain('VAT threshold ceiling');
    });
  });

  describe('calculate8PercentIncomeTax', () => {
    test('applies ₱250,000 statutory deduction for purely self-employed individual', () => {
      // Gross sales = ₱1,000,000
      // Deduction = ₱250,000
      // Taxable Base = ₱750,000
      // Tax Due @ 8% = ₱60,000
      const res = calculate8PercentIncomeTax({
        grossSales: 1_000_000,
        isMixedIncomeEarner: false,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT'
      });

      expect(res.isEligible).toBe(true);
      expect(res.isMixedIncome).toBe(false);
      expect(res.statutoryDeduction).toBe(STATUTORY_EXEMPTION_PESOS);
      expect(res.taxableBase).toBe(750_000);
      expect(res.taxDue).toBe(60_000);
      expect(res.applicableForm).toContain('1701A');
    });

    test('applies 8% on gross business sales from 1st peso for mixed-income earner', () => {
      // Gross sales = ₱1,000,000
      // Deduction against business = ₱0
      // Taxable Base = ₱1,000,000
      // Tax Due @ 8% = ₱80,000
      const res = calculate8PercentIncomeTax({
        grossSales: 1_000_000,
        isMixedIncomeEarner: true,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT'
      });

      expect(res.isEligible).toBe(true);
      expect(res.isMixedIncome).toBe(true);
      expect(res.statutoryDeduction).toBe(0);
      expect(res.taxableBase).toBe(1_000_000);
      expect(res.taxDue).toBe(80_000);
      expect(res.applicableForm).toContain('1701');
    });
  });

  describe('calculateCompensationGraduatedTax', () => {
    test('calculates graduated tax with ₱250,000 initial exempt bracket', () => {
      // Gross Compensation = ₱400,000
      // 1st ₱250,000 = 0
      // Excess ₱150,000 @ 15% = ₱22,500
      const res = calculateCompensationGraduatedTax(400_000);
      expect(res.grossCompensation).toBe(400_000);
      expect(res.statutoryExemption).toBe(250_000);
      expect(res.taxDue).toBe(22_500);
      expect(res.bracketDescription).toContain('15%');
    });
  });

  describe('calculateConsolidatedIndividualTax', () => {
    test('consolidates mixed income: business 8% (₱0 deduction) + compensation graduated', () => {
      // Business Sales = ₱1,000,000 -> 8% of ₱1M = ₱80,000
      // Compensation = ₱400,000 -> Graduated tax = ₱22,500
      // Total Tax Due = ₱102,500
      const res = calculateConsolidatedIndividualTax({
        grossSales: 1_000_000,
        grossCompensationIncome: 400_000,
        isMixedIncomeEarner: true,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT'
      });

      expect(res.isEligible).toBe(true);
      expect(res.isMixedIncomeEarner).toBe(true);
      expect(res.businessIncome.taxDue).toBe(80_000);
      expect(res.compensationIncome?.taxDue).toBe(22_500);
      expect(res.totalIncomeTaxDue).toBe(102_500);
      expect(res.applicableForm).toContain('1701');
    });
  });
});
