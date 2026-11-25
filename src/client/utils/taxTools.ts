/**
 * =========================================================================================
 * CLIENT-SIDE PHILIPPINE TAX UTILITIES & 8% PREFERENTIAL TAX ENGINE
 * =========================================================================================
 * Authoritative client-side calculation utilities aligned with:
 * 1. TRAIN Law (RA 10963) & BIR Revenue Regulations (RR) No. 8-2018 & RR 16-2023:
 *    - 8% Optional Flat Income Tax Regime:
 *      * Qualification Ceiling: ₱3,000,000.00 Gross Annual Sales/Receipts.
 *      * Ineligible Entities: Corporations, One-Person Corporations (OPC), Partnerships,
 *        General Professional Partnerships (GPP), and any entity exceeding ₱3,000,000.
 *      * Purely Self-Employed / Freelance Professionals: Allowed statutory reduction of ₱250,000.00
 *        against gross sales/receipts (tax is 8% of excess over ₱250,000).
 *      * Mixed-Income Earners: Statutory ₱250,000.00 exemption is applied exclusively to
 *        compensation income under graduated tax brackets; 8% preferential rate applies to
 *        gross business sales from the 1st peso without the ₱250k deduction.
 *      * In Lieu Of: Graduated Income Tax under Sec 24(A) AND Section 116 (3%) Percentage Tax.
 * 2. Ease of Paying Taxes (EOPT) Act (RA 11976) & CREATE Act (RA 11534).
 * =========================================================================================
 */

export const STATUTORY_8PERCENT_CEILING_PESOS = 3_000_000;
export const STATUTORY_8PERCENT_CEILING_CENTAVOS = 300_000_000;
export const STATUTORY_EXEMPTION_PESOS = 250_000;
export const STATUTORY_EXEMPTION_CENTAVOS = 25_000_000;

export const INELIGIBLE_CLASSIFICATIONS = [
  'CORPORATION',
  'ONE_PERSON_CORPORATION',
  'GENERAL_PARTNERSHIP',
  'GENERAL_PROFESSIONAL_PARTNERSHIP',
  'GPP',
  'NON_PROFIT',
  'GOVERNMENT_AGENCY',
  'COOPERATIVE'
] as const;

export const GRADUATED_TAX_BRACKETS_2023 = [
  { lowerLimit: 0, upperLimit: 250_000, rate: 0.0, fixedAmount: 0, description: 'Not over ₱250,000 (0% - Tax Exempt)' },
  { lowerLimit: 250_000, upperLimit: 400_000, rate: 0.15, fixedAmount: 0, description: 'Over ₱250,000 to ₱400,000 (15% of excess over ₱250,000)' },
  { lowerLimit: 400_000, upperLimit: 800_000, rate: 0.20, fixedAmount: 22_500, description: 'Over ₱400,000 to ₱800,000 (₱22,500 + 20% of excess over ₱400,000)' },
  { lowerLimit: 800_000, upperLimit: 2_000_000, rate: 0.25, fixedAmount: 102_500, description: 'Over ₱800,000 to ₱2,000,000 (₱102,500 + 25% of excess over ₱800,000)' },
  { lowerLimit: 2_000_000, upperLimit: 8_000_000, rate: 0.30, fixedAmount: 402_500, description: 'Over ₱2,000,000 to ₱8,000,000 (₱402,500 + 30% of excess over ₱2,000,000)' },
  { lowerLimit: 8_000_000, upperLimit: null, rate: 0.35, fixedAmount: 2_202_500, description: 'Over ₱8,000,000 (₱2,202,500 + 35% of excess over ₱8,000,000)' },
];

export interface ValidationEligibilityResult {
  isEligible: boolean;
  reason?: string;
  taxpayerClassification: string;
  isIndividual: boolean;
  exceedsVatThreshold: boolean;
}

export interface EightPercentCalculationParams {
  grossSales?: number;
  grossSalesCentavos?: number;
  grossBusinessSales?: number;
  grossBusinessSalesCentavos?: number;
  grossCompensationIncome?: number;
  grossCompensationIncomeCentavos?: number;
  isMixedIncomeEarner?: boolean;
  taxpayerClassification?: string;
}

export interface Business8PercentResult {
  isEligible: boolean;
  disqualificationReason?: string;
  isMixedIncome: boolean;
  grossSales: number;
  grossSalesCentavos: number;
  statutoryDeduction: number;
  statutoryDeductionCentavos: number;
  taxableBase: number;
  taxableBaseCentavos: number;
  taxRate: number;
  taxRatePercentage: string;
  taxDue: number;
  taxDueCentavos: number;
  percentageTaxExempt: boolean;
  applicableForm: string;
  notes: string;
}

export interface CompensationGraduatedResult {
  grossCompensation: number;
  grossCompensationCentavos: number;
  statutoryExemption: number;
  statutoryExemptionCentavos: number;
  taxableCompensationBase: number;
  taxableCompensationBaseCentavos: number;
  taxDue: number;
  taxDueCentavos: number;
  bracketDescription: string;
  notes: string;
}

export interface ConsolidatedIndividualTaxResult {
  isEligible: boolean;
  disqualificationReason?: string;
  taxpayerClassification: string;
  isMixedIncomeEarner: boolean;
  businessIncome: Business8PercentResult;
  compensationIncome?: CompensationGraduatedResult;
  totalIncomeTaxDue: number;
  totalIncomeTaxDueCentavos: number;
  applicableForm: string;
  percentageTaxTreatment: string;
  legalFramework: string;
}

/**
 * Validates whether an entity is legally eligible for the 8% Optional Flat Income Tax regime.
 * Strict Statutory Guards:
 * 1. Must be an Individual / Sole Proprietor / Professional (not a Corp, OPC, Partnership, or GPP).
 * 2. Gross Annual Sales / Receipts must not exceed the ₱3,000,000 VAT threshold ceiling.
 */
export function validate8PercentEligibility(
  taxpayerClassification: string = 'INDIVIDUAL_8PERCENT',
  grossSales: number = 0
): ValidationEligibilityResult {
  const normClassification = (taxpayerClassification || 'INDIVIDUAL').toUpperCase().trim();
  
  const isIndividual = normClassification === 'INDIVIDUAL' ||
    normClassification === 'INDIVIDUAL_8PERCENT' ||
    normClassification === 'SOLE_PROPRIETORSHIP' ||
    normClassification === 'PROFESSIONAL' ||
    normClassification === 'FREELANCER';

  const isIneligibleEntity = INELIGIBLE_CLASSIFICATIONS.some(
    c => normClassification === c || normClassification.startsWith(c)
  );

  const grossSalesCentavos = Math.round(grossSales * 100);
  const exceedsVatThreshold = grossSalesCentavos > STATUTORY_8PERCENT_CEILING_CENTAVOS;

  if (isIneligibleEntity || !isIndividual) {
    return {
      isEligible: false,
      reason: `Taxpayer classification '${taxpayerClassification}' is legally disqualified from the 8% flat income tax rate. Under Section 24(A)(2)(b) NIRC and BIR RR 8-2018, this preferential rate is strictly limited to Individual Sole Proprietors and Self-Employed Professionals. Corporations, OPCs, and Partnerships must file Form 1702 under Corporate Income Tax.`,
      taxpayerClassification: normClassification,
      isIndividual: false,
      exceedsVatThreshold
    };
  }

  if (exceedsVatThreshold) {
    return {
      isEligible: false,
      reason: `Gross annual sales/receipts of ₱${grossSales.toLocaleString('en-PH', { minimumFractionDigits: 2 })} exceed the statutory ₱3,000,000.00 VAT threshold ceiling. The taxpayer is legally required to register for VAT (BIR Form 2550Q) and pay income tax under the standard graduated rates (Section 24(A) NIRC / BIR Form 1701).`,
      taxpayerClassification: normClassification,
      isIndividual: true,
      exceedsVatThreshold: true
    };
  }

  return {
    isEligible: true,
    taxpayerClassification: normClassification,
    isIndividual: true,
    exceedsVatThreshold: false
  };
}

/**
 * Calculates statutory individual compensation income tax under Section 24(A)(2)(a) NIRC (TRAIN Law RA 10963, 2023+).
 * The first ₱250,000 is 100% exempt (0% tax bracket).
 */
export function calculateCompensationGraduatedTax(
  grossCompensation: number = 0,
  grossCompensationCentavos?: number
): CompensationGraduatedResult {
  const compCentavos = grossCompensationCentavos !== undefined
    ? grossCompensationCentavos
    : Math.round(grossCompensation * 100);

  const compPesos = compCentavos / 100;

  // Bracket calculation
  let taxDueCentavos = 0;
  let bracketDescription = 'Tax-Exempt Bracket (First ₱250,000 at 0%)';

  if (compPesos > 8_000_000) {
    taxDueCentavos = Math.round((2_202_500 + (compPesos - 8_000_000) * 0.35) * 100);
    bracketDescription = 'Over ₱8,000,000 (₱2,202,500 + 35% of excess over ₱8,000,000)';
  } else if (compPesos > 2_000_000) {
    taxDueCentavos = Math.round((402_500 + (compPesos - 2_000_000) * 0.30) * 100);
    bracketDescription = 'Over ₱2,000,000 to ₱8,000,000 (₱402,500 + 30% of excess over ₱2,000,000)';
  } else if (compPesos > 800_000) {
    taxDueCentavos = Math.round((102_500 + (compPesos - 800_000) * 0.25) * 100);
    bracketDescription = 'Over ₱800,000 to ₱2,000,000 (₱102,500 + 25% of excess over ₱800,000)';
  } else if (compPesos > 400_000) {
    taxDueCentavos = Math.round((22_500 + (compPesos - 400_000) * 0.20) * 100);
    bracketDescription = 'Over ₱400,000 to ₱800,000 (₱22,500 + 20% of excess over ₱400,000)';
  } else if (compPesos > 250_000) {
    taxDueCentavos = Math.round(((compPesos - 250_000) * 0.15) * 100);
    bracketDescription = 'Over ₱250,000 to ₱400,000 (15% of excess over ₱250,000)';
  }

  const statutoryExemptionCentavos = Math.min(compCentavos, STATUTORY_EXEMPTION_CENTAVOS);

  return {
    grossCompensation: compPesos,
    grossCompensationCentavos: compCentavos,
    statutoryExemption: statutoryExemptionCentavos / 100,
    statutoryExemptionCentavos,
    taxableCompensationBase: compPesos,
    taxableCompensationBaseCentavos: compCentavos,
    taxDue: taxDueCentavos / 100,
    taxDueCentavos,
    bracketDescription,
    notes: 'Compensation income is subject to graduated individual income tax rates under Section 24(A)(2)(a) NIRC. The statutory ₱250,000 exemption is applied exclusively to compensation income.'
  };
}

/**
 * Calculates 8% Optional Flat Income Tax on Business/Professional Revenue.
 * 
 * Statutory Mechanics (TRAIN Law RA 10963 & BIR RR 8-2018 Sec. 3(B)):
 * - Purely Self-Employed: 8% preferential rate applies ONLY to gross sales exceeding ₱250,000 (₱250,000 deduction allowed).
 * - Mixed-Income Earners: 8% preferential rate applies to ALL gross business sales from the 1st peso (₱0 deduction on business sales;
 *   the ₱250,000 exemption is applied exclusively to compensation income).
 */
export function calculate8PercentIncomeTax(
  params: EightPercentCalculationParams
): Business8PercentResult {
  const {
    grossSales,
    grossSalesCentavos,
    grossBusinessSales,
    grossBusinessSalesCentavos,
    isMixedIncomeEarner = false,
    taxpayerClassification = 'INDIVIDUAL_8PERCENT'
  } = params;

  // Resolve business sales amount in centavos to prevent floating-point issues
  let salesCentavos = 0;
  if (grossSalesCentavos !== undefined) {
    salesCentavos = grossSalesCentavos;
  } else if (grossBusinessSalesCentavos !== undefined) {
    salesCentavos = grossBusinessSalesCentavos;
  } else if (grossSales !== undefined) {
    salesCentavos = Math.round(grossSales * 100);
  } else if (grossBusinessSales !== undefined) {
    salesCentavos = Math.round(grossBusinessSales * 100);
  }

  const salesPesos = salesCentavos / 100;

  // 1. Eligibility Check
  const eligibility = validate8PercentEligibility(taxpayerClassification, salesPesos);
  if (!eligibility.isEligible) {
    return {
      isEligible: false,
      disqualificationReason: eligibility.reason,
      isMixedIncome: isMixedIncomeEarner,
      grossSales: salesPesos,
      grossSalesCentavos: salesCentavos,
      statutoryDeduction: 0,
      statutoryDeductionCentavos: 0,
      taxableBase: 0,
      taxableBaseCentavos: 0,
      taxRate: 0,
      taxRatePercentage: '0%',
      taxDue: 0,
      taxDueCentavos: 0,
      percentageTaxExempt: false,
      applicableForm: eligibility.isIndividual ? 'BIR Form 1701 / 2550Q' : 'BIR Form 1702-RT',
      notes: eligibility.reason || 'Ineligible for 8% Optional Flat Income Tax.'
    };
  }

  // 2. Statutory Deduction Logic
  // Mixed-Income: ₱0 deduction on business income (₱250,000 is absorbed by compensation income)
  // Purely Self-Employed: ₱250,000 statutory deduction applied against gross business sales
  const deductionCentavos = isMixedIncomeEarner ? 0 : STATUTORY_EXEMPTION_CENTAVOS;
  const taxableBaseCentavos = Math.max(0, salesCentavos - deductionCentavos);
  const taxDueCentavos = Math.round(taxableBaseCentavos * 0.08);

  const notes = isMixedIncomeEarner
    ? 'Mixed-Income Earner: 8% preferential rate applies to ALL gross business sales from ₱0.01. The ₱250,000 statutory exemption is applied exclusively to compensation income under graduated rates (RR 8-2018 Sec. 3(B)(2)).'
    : 'Purely Self-Employed: 8% preferential rate applies ONLY to gross sales in excess of the ₱250,000 statutory deduction (RR 8-2018 Sec. 3(B)(1)).';

  const applicableForm = isMixedIncomeEarner
    ? 'BIR Form 1701 (Annual Mixed Income Return: Compensation + 8% Business)'
    : 'BIR Form 1701A (Annual Return for Individuals under 8% Flat Rate)';

  return {
    isEligible: true,
    isMixedIncome: isMixedIncomeEarner,
    grossSales: salesPesos,
    grossSalesCentavos: salesCentavos,
    statutoryDeduction: deductionCentavos / 100,
    statutoryDeductionCentavos: deductionCentavos,
    taxableBase: taxableBaseCentavos / 100,
    taxableBaseCentavos: taxableBaseCentavos,
    taxRate: 0.08,
    taxRatePercentage: '8%',
    taxDue: taxDueCentavos / 100,
    taxDueCentavos: taxDueCentavos,
    percentageTaxExempt: true,
    applicableForm,
    notes
  };
}

/**
 * Full Consolidated Individual Tax Calculation Engine for Mixed-Income and Pure Business Taxpayers.
 */
export function calculateConsolidatedIndividualTax(
  params: EightPercentCalculationParams
): ConsolidatedIndividualTaxResult {
  const {
    grossCompensationIncome = 0,
    grossCompensationIncomeCentavos,
    taxpayerClassification = 'INDIVIDUAL_8PERCENT'
  } = params;

  let compCentavos = 0;
  if (grossCompensationIncomeCentavos !== undefined) {
    compCentavos = grossCompensationIncomeCentavos;
  } else if (grossCompensationIncome !== undefined) {
    compCentavos = Math.round(grossCompensationIncome * 100);
  }

  const isMixedIncome = params.isMixedIncomeEarner !== undefined
    ? params.isMixedIncomeEarner
    : compCentavos > 0;

  // 1. Calculate Business Income Portion
  const businessResult = calculate8PercentIncomeTax({
    ...params,
    isMixedIncomeEarner: isMixedIncome,
    taxpayerClassification
  });

  // 2. Calculate Compensation Portion (if mixed income or compensation present)
  let compensationResult: CompensationGraduatedResult | undefined = undefined;
  let compTaxDueCentavos = 0;

  if (isMixedIncome || compCentavos > 0) {
    compensationResult = calculateCompensationGraduatedTax(
      compCentavos / 100,
      compCentavos
    );
    compTaxDueCentavos = compensationResult.taxDueCentavos;
  }

  const totalTaxDueCentavos = businessResult.taxDueCentavos + compTaxDueCentavos;

  const applicableForm = isMixedIncome
    ? 'BIR Form 1701 (Annual Income Tax Return for Mixed-Income Earners: Compensation under Graduated Rates + Business under 8% Flat Rate)'
    : 'BIR Form 1701A (Annual Income Tax Return for Purely Business/Professional Individuals under 8% Flat Rate)';

  return {
    isEligible: businessResult.isEligible,
    disqualificationReason: businessResult.disqualificationReason,
    taxpayerClassification,
    isMixedIncomeEarner: isMixedIncome,
    businessIncome: businessResult,
    compensationIncome: compensationResult,
    totalIncomeTaxDue: totalTaxDueCentavos / 100,
    totalIncomeTaxDueCentavos: totalTaxDueCentavos,
    applicableForm,
    percentageTaxTreatment: 'Exempt from Section 116 (3%) Percentage Tax pursuant to TRAIN Law RA 10963 & BIR RR 8-2018',
    legalFramework: 'TRAIN Law (RA 10963) Sec 24(A)(2)(b) & BIR RR 8-2018 & RR 16-2023'
  };
}

/**
 * Formats a numeric currency value in Philippine Peso format.
 */
export function formatPhp(amount: number = 0): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export const clientTaxTools = {
  validate8PercentEligibility,
  calculate8PercentIncomeTax,
  calculateCompensationGraduatedTax,
  calculateConsolidatedIndividualTax,
  formatPhp,
  STATUTORY_8PERCENT_CEILING_PESOS,
  STATUTORY_8PERCENT_CEILING_CENTAVOS,
  STATUTORY_EXEMPTION_PESOS,
  STATUTORY_EXEMPTION_CENTAVOS,
  GRADUATED_TAX_BRACKETS_2023,
  INELIGIBLE_CLASSIFICATIONS
};

export default clientTaxTools;
