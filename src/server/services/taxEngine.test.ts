import { describe, test, expect } from 'vitest';
import { TaxEngine } from './taxEngine';
import { getBirTaxProfileRules } from '../../shared/taxProfile';

describe('Philippine Tax Engine - Core Forensic Rules', () => {
  // Existing baseline tests
  test('calculateVat standard 12%', () => {
    const result = TaxEngine.calculateVat(11200); // 112.00 PHP
    expect(result.taxBase).toBe(10000); // 100.00 PHP
    expect(result.vatAmount).toBe(1200); // 12.00 PHP
  });

  test('calculateEwt', () => {
    const result = TaxEngine.calculateEwt(10000, 0.05); // 5% EWT on 100.00
    expect(result).toBe(500); // 5.00 PHP
  });

  test('calculateGraduatedIncomeTax', () => {
    const brackets = [
      { lowerLimit: 0, upperLimit: 25000000, rate: 0, fixedAmount: 0 },
      { lowerLimit: 25000001, upperLimit: 40000000, rate: 0.20, fixedAmount: 0 },
    ];
    // Income: 300,000 PHP (30,000,000 centavos)
    // 30,000,000 - 25,000,001 = 4,999,999 * 0.20 = 999,999.8 -> 1,000,000
    const result = TaxEngine.calculateGraduatedIncomeTax(30000000, brackets);
    expect(result).toBe(1000000);
  });

  // =========================================================================
  // PART 1 & 4: 8% OPTIONAL FLAT INCOME TAX SUITE (TRAIN LAW RR 8-2018)
  // =========================================================================
  describe('8% Optional Flat Income Tax Regime (TRAIN Law & RR 8-2018)', () => {
    test('Scenario 1: Purely self-employed below P250,000 statutory deduction floor', () => {
      // Gross Sales: P150,000 (15,000,000 centavos)
      const result = TaxEngine.calculate8PercentIncomeTax(15_000_000, {
        isMixedIncomeEarner: false,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT'
      });

      expect(result.isEligible).toBe(true);
      expect(result.grossSales).toBe(150000);
      expect(result.statutoryDeduction).toBe(250000);
      expect(result.taxableBase).toBe(0);
      expect(result.taxDue).toBe(0);
      expect(result.isMixedIncome).toBe(false);
      expect(result.notes).toContain('Purely Self-Employed');
    });

    test('Scenario 2: Purely self-employed above P250,000 statutory deduction floor', () => {
      // Gross Sales: P1,000,000 (100,000,000 centavos)
      // Taxable Base = 1,000,000 - 250,000 = 750,000
      // Tax Due = 750,000 * 8% = P60,000 (6,000,000 centavos)
      const result = TaxEngine.calculate8PercentIncomeTax(100_000_000, {
        isMixedIncomeEarner: false,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT'
      });

      expect(result.isEligible).toBe(true);
      expect(result.grossSales).toBe(1000000);
      expect(result.statutoryDeduction).toBe(250000);
      expect(result.taxableBase).toBe(750000);
      expect(result.taxDue).toBe(60000);
      expect(result.taxDueCentavos).toBe(6_000_000);
      expect(result.isMixedIncome).toBe(false);
    });

    test('Scenario 3: Mixed-income earner (No P250,000 deduction on business income)', () => {
      // Gross Sales: P1,000,000 (100,000,000 centavos)
      // Under RR 8-2018 Sec 3(B)(2), P250k deduction is applied to compensation income under graduated rates.
      // Taxable Base = 1,000,000
      // Tax Due = 1,000,000 * 8% = P80,000 (8,000,000 centavos)
      const result = TaxEngine.calculate8PercentIncomeTax(100_000_000, {
        isMixedIncomeEarner: true,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT'
      });

      expect(result.isEligible).toBe(true);
      expect(result.grossSales).toBe(1000000);
      expect(result.statutoryDeduction).toBe(0);
      expect(result.taxableBase).toBe(1000000);
      expect(result.taxDue).toBe(80000);
      expect(result.taxDueCentavos).toBe(8_000_000);
      expect(result.isMixedIncome).toBe(true);
      expect(result.notes).toContain('Mixed-Income Earner');
    });

    test('Scenario 4: Exactly at the P3,000,000 VAT threshold qualification ceiling (Purely Self-Employed)', () => {
      // Gross Sales: P3,000,000 (300,000,000 centavos)
      // Taxable Base = 3,000,000 - 250,000 = 2,750,000
      // Tax Due = 2,750,000 * 8% = P220,000 (22,000,000 centavos)
      const result = TaxEngine.calculate8PercentIncomeTax(300_000_000, {
        isMixedIncomeEarner: false,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT'
      });

      expect(result.isEligible).toBe(true);
      expect(result.grossSales).toBe(3000000);
      expect(result.statutoryDeduction).toBe(250000);
      expect(result.taxableBase).toBe(2750000);
      expect(result.taxDue).toBe(220000);
      expect(result.taxDueCentavos).toBe(22_000_000);
    });

    test('Scenario 5: Exactly at the P3,000,000 VAT threshold qualification ceiling (Mixed-Income Earner)', () => {
      // Gross Sales: P3,000,000 (300,000,000 centavos)
      // Taxable Base = 3,000,000
      // Tax Due = 3,000,000 * 8% = P240,000 (24,000,000 centavos)
      const result = TaxEngine.calculate8PercentIncomeTax(300_000_000, {
        isMixedIncomeEarner: true,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT'
      });

      expect(result.isEligible).toBe(true);
      expect(result.grossSales).toBe(3000000);
      expect(result.statutoryDeduction).toBe(0);
      expect(result.taxableBase).toBe(3000000);
      expect(result.taxDue).toBe(240000);
      expect(result.taxDueCentavos).toBe(24_000_000);
    });

    test('Scenario 6: Gross sales above P3,000,000 qualification ceiling (Disqualified)', () => {
      // Gross Sales: P3,000,001 (300,000,100 centavos)
      const result = TaxEngine.calculate8PercentIncomeTax(300_000_100, {
        isMixedIncomeEarner: false,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT'
      });

      expect(result.isEligible).toBe(false);
      expect(result.disqualificationReason).toContain('exceed the statutory P3,000,000.00 VAT threshold ceiling');
      expect(result.taxDue).toBe(0);
    });

    test('Scenario 7: Ineligible Corporation attempting to elect 8% Flat Tax (Disqualified)', () => {
      const resultCorp = TaxEngine.calculate8PercentIncomeTax(100_000_000, {
        taxpayerClassification: 'CORPORATION'
      });
      expect(resultCorp.isEligible).toBe(false);
      expect(resultCorp.disqualificationReason).toContain('strictly ineligible');

      const resultOpc = TaxEngine.calculate8PercentIncomeTax(100_000_000, {
        taxpayerClassification: 'OPC'
      });
      expect(resultOpc.isEligible).toBe(false);
      expect(resultOpc.disqualificationReason).toContain('strictly ineligible');
    });

    test('Scenario 8: 8% Election grants exemption from Section 116 Percentage Tax (Form 2551Q)', () => {
      const pureProfile = getBirTaxProfileRules('INDIVIDUAL_8PERCENT', 'INDIVIDUAL_8PERCENT_VAT', { isMixedIncomeEarner: false });
      expect(pureProfile.isPercentageTaxRegistered).toBe(false);
      expect(pureProfile.defaultVatRate).toBe(0.0);
      expect(pureProfile.ledgerPostingRules.salesTaxPayableAccountCode).toBe('NONE');
      expect(pureProfile.vatOrPercentageForm).toContain('EXEMPT from 3% Percentage Tax');
      expect(pureProfile.qualifiesFor8Percent).toBe(true);
      expect(pureProfile.statutoryDeduction8PercentCentavos).toBe(25_000_000);

      const mixedProfile = getBirTaxProfileRules('INDIVIDUAL_8PERCENT', 'INDIVIDUAL_8PERCENT_VAT', { isMixedIncomeEarner: true });
      expect(mixedProfile.isPercentageTaxRegistered).toBe(false);
      expect(mixedProfile.isMixedIncomeEarner).toBe(true);
      expect(mixedProfile.statutoryDeduction8PercentCentavos).toBe(0);
    });
  });

  // =========================================================================
  // PART 2: DATE-SENSITIVE SECTION 116 PERCENTAGE TAX SUITE (CREATE ACT RA 11534)
  // =========================================================================
  describe('Date-Sensitive Section 116 Percentage Tax (CREATE Act RA 11534)', () => {
    test('Prior to CREATE reduction: 2020-06-30 should apply 3% standard rate', () => {
      const rate = TaxEngine.getSection116Rate('2020-06-30');
      expect(rate).toBe(0.03);

      const calc = TaxEngine.calculateSection116PercentageTax(10_000_000, '2020-06-30');
      expect(calc.rate).toBe(0.03);
      expect(calc.taxAmount).toBe(3000); // 3% of P100,000 = P3,000
    });

    test('Start of CREATE temporary 1% window: 2020-07-01 should apply 1%', () => {
      const rate = TaxEngine.getSection116Rate('2020-07-01');
      expect(rate).toBe(0.01);

      const calc = TaxEngine.calculateSection116PercentageTax(10_000_000, '2020-07-01');
      expect(calc.rate).toBe(0.01);
      expect(calc.taxAmount).toBe(1000); // 1% of P100,000 = P1,000
      expect(calc.rateDescription).toContain('1% Temporary Percentage Tax (CREATE Act');
    });

    test('End of CREATE temporary 1% window: 2023-06-30 should apply 1%', () => {
      const rate = TaxEngine.getSection116Rate('2023-06-30');
      expect(rate).toBe(0.01);

      const calc = TaxEngine.calculateSection116PercentageTax(10_000_000, '2023-06-30');
      expect(calc.rate).toBe(0.01);
      expect(calc.taxAmount).toBe(1000);
    });

    test('Reversion to standard 3% rate: 2023-07-01 should apply 3%', () => {
      const rate = TaxEngine.getSection116Rate('2023-07-01');
      expect(rate).toBe(0.03);

      const calc = TaxEngine.calculateSection116PercentageTax(10_000_000, '2023-07-01');
      expect(calc.rate).toBe(0.03);
      expect(calc.taxAmount).toBe(3000);
      expect(calc.rateDescription).toContain('3% Standard Percentage Tax');
    });

    test('Current operational periods (e.g. 2026-08-16) should apply 3% standard statutory rate', () => {
      const rate = TaxEngine.getSection116Rate('2026-08-16');
      expect(rate).toBe(0.03);

      const calc = TaxEngine.calculateSection116PercentageTax(10_000_000, '2026-08-16');
      expect(calc.rate).toBe(0.03);
      expect(calc.taxAmount).toBe(3000);
    });
  });
});
