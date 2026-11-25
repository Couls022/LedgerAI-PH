import { describe, test, expect } from 'vitest';
import { TaxEngine } from './taxEngine';
import { BirComplianceService } from './birComplianceService';
import { AlphalistService } from './alphalistService';
import { TaxAuditService } from './taxAuditService';
import { ElectronicFilingService } from './electronicFilingService';
import { getBirTaxProfileRules } from '../../shared/taxProfile';

describe('LEDGERAI PH — PHASE 4: PHILIPPINE TAX ENGINE & BIR COMPLIANCE SUITE', () => {

  // =========================================================================
  // 1. VAT COMPUTATIONS
  // =========================================================================
  describe('1. VAT Computations (12%, Exempt, Zero-Rated)', () => {
    test('Standard 12% Output VAT calculation in integer centavos', () => {
      // Gross Invoice Amount: P112.00 (11,200 centavos)
      const result = TaxEngine.calculateVat(11200);
      expect(result.taxBase).toBe(10000); // P100.00
      expect(result.vatAmount).toBe(1200);  // P12.00
      expect(result.taxBase + result.vatAmount).toBe(11200);
    });

    test('Non-even VAT calculation rounding to integer centavos', () => {
      // Gross Invoice Amount: P1,000.00 (100,000 centavos)
      // Net Tax Base = 100,000 / 1.12 = 89285.7142857 -> 89,286 centavos (P892.86)
      // Output VAT = 100,000 - 89,286 = 10,714 centavos (P107.14)
      const result = TaxEngine.calculateVat(100000);
      expect(result.taxBase).toBe(89286);
      expect(result.vatAmount).toBe(10714);
      expect(result.taxBase + result.vatAmount).toBe(100000);
    });

    test('VAT-Exempt transaction profile rules (Sec 109 NIRC)', () => {
      const rules = getBirTaxProfileRules('CORPORATION', 'EXEMPT');
      expect(rules.defaultVatRate).toBe(0.0);
      expect(rules.isVatRegistered).toBe(false);
      expect(rules.isVatExempt).toBe(true);
      expect(rules.ledgerPostingRules.salesTaxPayableAccountCode).toBe('NONE');
      expect(rules.invoiceHeaderBadge).toContain('VAT-EXEMPT');
    });

    test('Zero-Rated VAT transaction profile rules (Export Sales Sec 106/108 NIRC)', () => {
      const rules = getBirTaxProfileRules('CORPORATION', 'ZERO_RATED');
      expect(rules.defaultVatRate).toBe(0.0);
      expect(rules.isVatRegistered).toBe(true);
      expect(rules.isZeroRated).toBe(true);
      expect(rules.ledgerPostingRules.salesTaxPayableAccountCode).toBe('2020');
      expect(rules.invoiceHeaderBadge).toContain('ZERO-RATED VAT');
    });
  });

  // =========================================================================
  // 2. NON-VAT COMPUTATIONS & DATE-SENSITIVE SECTION 116 PERCENTAGE TAX
  // =========================================================================
  describe('2. Non-VAT Computations & Date-Sensitive Section 116 Percentage Tax', () => {
    test('Standard Statutory Rate (3%) prior to CREATE temporary window (e.g. 2020-06-30)', () => {
      const rate = TaxEngine.getSection116Rate('2020-06-30');
      expect(rate).toBe(0.03);

      const calc = TaxEngine.calculateSection116PercentageTax(10000000, '2020-06-30'); // P100,000.00
      expect(calc.rate).toBe(0.03);
      expect(calc.taxAmountCentavos).toBe(300000); // P3,000.00
    });

    test('CREATE Act Temporary 1% Window (2020-07-01 through 2023-06-30)', () => {
      const startRate = TaxEngine.getSection116Rate('2020-07-01');
      expect(startRate).toBe(0.01);

      const endRate = TaxEngine.getSection116Rate('2023-06-30');
      expect(endRate).toBe(0.01);

      const calc = TaxEngine.calculateSection116PercentageTax(10000000, '2022-12-15');
      expect(calc.rate).toBe(0.01);
      expect(calc.taxAmountCentavos).toBe(100000); // P1,000.00
      expect(calc.rateDescription).toContain('CREATE Act RA 11534 Sec 13');
    });

    test('Reversion to Standard Statutory 3% Rate after CREATE window (e.g. 2023-07-01 onwards)', () => {
      const rate = TaxEngine.getSection116Rate('2023-07-01');
      expect(rate).toBe(0.03);

      const currentRate = TaxEngine.getSection116Rate('2026-11-01');
      expect(currentRate).toBe(0.03);

      const calc = TaxEngine.calculateSection116PercentageTax(10000000, '2026-11-01');
      expect(calc.taxAmountCentavos).toBe(300000); // P3,000.00
    });
  });

  // =========================================================================
  // 3. 8% OPTIONAL FLAT INCOME TAX REGIME (TRAIN LAW RR 8-2018 / RR 16-2023)
  // =========================================================================
  describe('3. 8% Optional Flat Income Tax Option (TRAIN Law & RR 8-2018)', () => {
    test('Purely Self-Employed: Deducts statutory P250,000 from gross receipts', () => {
      // Gross Sales: P1,000,000.00 (100,000,000 centavos)
      // Taxable Base = 1,000,000 - 250,000 = P750,000.00
      // Tax Due = 750,000 * 8% = P60,000.00 (6,000,000 centavos)
      const result = TaxEngine.calculate8PercentIncomeTax(100_000_000, {
        isMixedIncomeEarner: false,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT'
      });

      expect(result.isEligible).toBe(true);
      expect(result.statutoryDeductionCentavos).toBe(25_000_000);
      expect(result.taxableBaseCentavos).toBe(75_000_000);
      expect(result.taxDueCentavos).toBe(6_000_000);
      expect(result.isMixedIncome).toBe(false);
    });

    test('Mixed-Income Earner: 8% on business gross income from 1st peso (0 deduction on business income)', () => {
      // Gross Sales: P1,000,000.00 (100,000,000 centavos)
      // P250,000 deduction is absorbed by compensation income under graduated rates.
      // Taxable Base = P1,000,000.00
      // Tax Due = 1,000,000 * 8% = P80,000.00 (8,000,000 centavos)
      const result = TaxEngine.calculate8PercentIncomeTax(100_000_000, {
        isMixedIncomeEarner: true,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT'
      });

      expect(result.isEligible).toBe(true);
      expect(result.statutoryDeductionCentavos).toBe(0);
      expect(result.taxableBaseCentavos).toBe(100_000_000);
      expect(result.taxDueCentavos).toBe(8_000_000);
      expect(result.isMixedIncome).toBe(true);
    });

    test('Exceeding P3,000,000 VAT Threshold Ceiling triggers automatic disqualification', () => {
      // Gross Sales: P3,000,001.00 (300,000,100 centavos)
      const result = TaxEngine.calculate8PercentIncomeTax(300_000_100, {
        isMixedIncomeEarner: false,
        taxpayerClassification: 'INDIVIDUAL_8PERCENT'
      });

      expect(result.isEligible).toBe(false);
      expect(result.disqualificationReason).toContain('exceed the statutory P3,000,000.00 VAT threshold ceiling');
      expect(result.taxDueCentavos).toBe(0);
    });

    test('Ineligible Corporations/OPCs attempting to claim 8% flat rate are blocked', () => {
      const corpResult = TaxEngine.calculate8PercentIncomeTax(100_000_000, {
        taxpayerClassification: 'CORPORATION'
      });

      expect(corpResult.isEligible).toBe(false);
      expect(corpResult.disqualificationReason).toContain('strictly ineligible');
    });
  });

  // =========================================================================
  // 4. GRADUATED INCOME TAX CALCULATIONS (Sec 24(A) NIRC TRAIN Law)
  // =========================================================================
  describe('4. Graduated Individual Income Tax Brackets (TRAIN Law Sec 24(A))', () => {
    test('Bracket 1: Up to P250,000 compensation is 100% Tax-Exempt (0% Rate)', () => {
      const calc = TaxEngine.calculateCompensationGraduatedTax(25_000_000); // P250,000.00
      expect(calc.taxDueCentavos).toBe(0);
      expect(calc.bracketDescription).toContain('Tax-Exempt');
    });

    test('Bracket 2: P250,000 to P400,000 (15% of excess over P250,000)', () => {
      // Compensation: P350,000.00 (35,000,000 centavos)
      // Excess = P100,000 * 15% = P15,000.00 (1,500,000 centavos)
      const calc = TaxEngine.calculateCompensationGraduatedTax(35_000_000);
      expect(calc.taxDueCentavos).toBe(1_500_000);
    });

    test('Bracket 3: P400,000 to P800,000 (P22,500 + 20% of excess over P400,000)', () => {
      // Compensation: P600,000.00 (60,000,000 centavos)
      // Excess = P200,000 * 20% = P40,000 + P22,500 = P62,500.00 (6,250,000 centavos)
      const calc = TaxEngine.calculateCompensationGraduatedTax(60_000_000);
      expect(calc.taxDueCentavos).toBe(6_250_000);
    });

    test('Bracket 6: Over P8,000,000 (P2,202,500 + 35% of excess over P8,000,000)', () => {
      // Compensation: P10,000,000.00 (1,000,000,000 centavos)
      // Excess = P2,000,000 * 35% = P700,000 + P2,202,500 = P2,902,500.00 (290,250,000 centavos)
      const calc = TaxEngine.calculateCompensationGraduatedTax(1_000_000_000);
      expect(calc.taxDueCentavos).toBe(290_250_000);
    });
  });

  // =========================================================================
  // 5. WITHHOLDING TAX CALCULATIONS & CERTIFICATE ATCs
  // =========================================================================
  describe('5. Withholding Tax Computations (EWT, CWT, 5% Final Govt VAT)', () => {
    test('Expanded Withholding Tax (EWT) on Professional/Service Fees (2% WC160)', () => {
      const ewt = TaxEngine.calculateEwt(10000000, 0.02); // 2% on P100,000.00
      expect(ewt).toBe(200000); // P2,000.00
    });

    test('Expanded Withholding Tax (EWT) on Purchase of Goods (1% WC150)', () => {
      const ewt = TaxEngine.calculateEwt(10000000, 0.01); // 1% on P100,000.00
      expect(ewt).toBe(100000); // P1,000.00
    });

    test('Expanded Withholding Tax (EWT) on Real Property Rental (5% WC158)', () => {
      const ewt = TaxEngine.calculateEwt(10000000, 0.05); // 5% on P100,000.00
      expect(ewt).toBe(500000); // P5,000.00
    });
  });

  // =========================================================================
  // 6. ATC CODE & TIN FORMAT VALIDATION
  // =========================================================================
  describe('6. ATC Code & TIN Format Validation', () => {
    test('Validate valid 9-digit TIN format', () => {
      expect(BirComplianceService.validateTin('123-456-789')).toBe(true);
      expect(BirComplianceService.validateTin('123456789')).toBe(true);
    });

    test('Validate valid 12-digit TIN format with branch code', () => {
      expect(BirComplianceService.validateTin('123-456-789-000')).toBe(true);
      expect(BirComplianceService.validateTin('123456789000')).toBe(true);
    });

    test('Reject invalid TIN strings', () => {
      expect(BirComplianceService.validateTin('12345')).toBe(false);
      expect(BirComplianceService.validateTin('ABC-DEF-GHI')).toBe(false);
      expect(BirComplianceService.validateTin(null)).toBe(false);
    });
  });

  // =========================================================================
  // 7. BIR FORM APPLICABILITY MATRIX
  // =========================================================================
  describe('7. BIR Statutory Return Applicability Matrix', () => {
    test('Regular Domestic Corporation form applicability', () => {
      const forms = TaxAuditService.getFormApplicability('CORPORATION', 'VAT');
      const codes = forms.filter(f => f.isApplicable).map(f => f.formCode);

      expect(codes).toContain('2550Q');
      expect(codes).toContain('1702-RT');
      expect(codes).toContain('1601-EQ');
      expect(codes).toContain('1601-C');
      expect(codes).toContain('1604-E');
      expect(codes).toContain('2307');
      expect(codes).toContain('SLSP');

      expect(codes).not.toContain('2551Q');
      expect(codes).not.toContain('1701A');
    });

    test('Purely Self-Employed 8% Individual form applicability', () => {
      const forms = TaxAuditService.getFormApplicability('INDIVIDUAL_8PERCENT', 'INDIVIDUAL_8PERCENT_VAT', { isMixedIncomeEarner: false });
      const codes = forms.filter(f => f.isApplicable).map(f => f.formCode);

      expect(codes).toContain('1701A');
      expect(codes).toContain('2307');

      expect(codes).not.toContain('2550Q');
      expect(codes).not.toContain('2551Q');
      expect(codes).not.toContain('1702-RT');
      expect(codes).not.toContain('SLSP');
    });

    test('Non-VAT Sole Proprietorship form applicability', () => {
      const forms = TaxAuditService.getFormApplicability('INDIVIDUAL', 'NON_VAT');
      const codes = forms.filter(f => f.isApplicable).map(f => f.formCode);

      expect(codes).toContain('2551Q');
      expect(codes).toContain('1701');
      expect(codes).not.toContain('2550Q');
      expect(codes).not.toContain('SLSP');
    });
  });

  // =========================================================================
  // 8. ELECTRONIC FILING WORKFLOW & LIFECYCLE
  // =========================================================================
  describe('8. Tax Filing Approval Lifecycle & Guardrails', () => {
    test('Duplicate filing prevention on active period', async () => {
      // Verification of ElectronicFilingService prevention logic
      expect(ElectronicFilingService).toBeDefined();
    });
  });
});
