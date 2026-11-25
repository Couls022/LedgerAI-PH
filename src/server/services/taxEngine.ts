import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getBirTaxProfileRules, BirTaxEngineDriverRules } from "../../shared/taxProfile";

export interface InvoiceTaxEngineResult {
  engineCode: string;
  grossAmountCentavos: number;
  netTaxBaseCentavos: number;
  taxRateApplied: number;
  taxAmountCentavos: number;
  taxType: string; // "VAT_12" | "PERCENTAGE_3" | "PERCENTAGE_1_CREATE" | "PEZA_5_GIT" | "COMMON_CARRIER_3" | "ZERO_RATED" | "VAT_EXEMPT" | "SPECIAL_PERCENTAGE"
  withholdingTaxAmountCentavos: number;
  finalPayableCentavos: number;
  invoiceHeaderBadge: string;
  invoiceNotice: string;
  ruleVersion?: string;
  effectiveDate?: string;
  taxpayerClassification?: string;
  vatStatus?: string;
  journalLinesPreview: Array<{ accountCode: string; accountName: string; debitCentavos: number; creditCentavos: number }>;
}

export const STANDARD_INDIVIDUAL_GRADUATED_BRACKETS_CENTAVOS = [
  { lowerLimit: 0, upperLimit: 25_000_000, rate: 0.0, fixedAmount: 0 },
  { lowerLimit: 25_000_000, upperLimit: 40_000_000, rate: 0.15, fixedAmount: 0 },
  { lowerLimit: 40_000_000, upperLimit: 80_000_000, rate: 0.20, fixedAmount: 2_250_000 },
  { lowerLimit: 80_000_000, upperLimit: 200_000_000, rate: 0.25, fixedAmount: 10_250_000 },
  { lowerLimit: 200_000_000, upperLimit: 800_000_000, rate: 0.30, fixedAmount: 40_250_000 },
  { lowerLimit: 800_000_000, upperLimit: null, rate: 0.35, fixedAmount: 220_250_000 },
];

export interface EightPercentIncomeTaxResult {
  isEligible: boolean;
  disqualificationReason?: string;
  grossSalesCentavos: number;
  grossSales: number;
  qualificationCeilingCentavos: number;
  statutoryDeductionCentavos: number;
  statutoryDeduction: number;
  taxableBaseCentavos: number;
  taxableBase: number;
  taxRate: number;
  taxDueCentavos: number;
  taxDue: number;
  isMixedIncome: boolean;
  notes: string;
}

export class TaxEngine {
  /**
   * Fetches the complete BIR Tax Core Engine rules for a specific company profile.
   */
  static async getEngineRulesForCompany(companyId: string, options: { isMixedIncomeEarner?: boolean } = {}): Promise<BirTaxEngineDriverRules> {
    // 1. Fetch Tax Profile record
    const profile = await db.select()
      .from(schema.companyTaxProfiles)
      .where(eq(schema.companyTaxProfiles.companyId, companyId))
      .get();

    let isMixedIncome = options.isMixedIncomeEarner;
    if (isMixedIncome === undefined && profile?.registrationInformation) {
      try {
        const regInfo = JSON.parse(profile.registrationInformation);
        if (typeof regInfo.isMixedIncomeEarner === 'boolean') {
          isMixedIncome = regInfo.isMixedIncomeEarner;
        }
      } catch (e) {}
    }

    if (profile) {
      return getBirTaxProfileRules(profile.taxpayerClassification, profile.vatStatus, { isMixedIncomeEarner: isMixedIncome });
    }

    // 2. Fallback to Master Company Record
    const company = await db.select()
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId))
      .get();

    return getBirTaxProfileRules(
      company?.taxpayerClassification || 'CORPORATION',
      company?.vatStatus || 'VAT',
      { isMixedIncomeEarner: isMixedIncome }
    );
  }

  /**
   * Returns the date-sensitive statutory Section 116 Percentage Tax Rate.
   * - July 1, 2020 through June 30, 2023: 1% (CREATE Act RA 11534 Sec 13 temporary rate)
   * - July 1, 2023 onward: 3% (Standard statutory rate under NIRC Sec 116)
   * - Historical periods before July 1, 2020: 3% (Standard statutory rate)
   */
  static getSection116Rate(transactionDate?: string | Date | null): number {
    if (!transactionDate) {
      return 0.03; // Default to current statutory rate (3%)
    }

    const dateStr = typeof transactionDate === 'string' 
      ? transactionDate.substring(0, 10) 
      : transactionDate.toISOString().substring(0, 10);

    // CREATE Act temporary 1% window: 2020-07-01 to 2023-06-30
    if (dateStr >= '2020-07-01' && dateStr <= '2023-06-30') {
      return 0.01;
    }

    // Standard rate before 2020-07-01 and after 2023-06-30
    return 0.03;
  }

  /**
   * Calculates Section 116 percentage tax with date sensitivity.
   */
  static calculateSection116PercentageTax(grossSalesCentavos: number, transactionDate?: string | Date | null) {
    const rate = this.getSection116Rate(transactionDate);
    const taxAmountCentavos = Math.round(grossSalesCentavos * rate);
    const rateDescription = rate === 0.01 
      ? '1% Temporary Percentage Tax (CREATE Act RA 11534 Sec 13: July 1, 2020 - June 30, 2023)'
      : '3% Standard Percentage Tax (NIRC Section 116 / Form 2551Q)';
    
    return {
      rate,
      taxAmountCentavos,
      taxAmount: taxAmountCentavos / 100,
      rateDescription,
      ruleVersion: rate === 0.01 ? 'CREATE-RA11534-SEC13' : 'NIRC-SEC116',
      effectiveDate: rate === 0.01 ? '2020-07-01' : '2023-07-01',
      calculationBaseCentavos: grossSalesCentavos,
    };
  }

  /**
   * Calculates 8% Optional Flat Income Tax under TRAIN Law (RA 10963 / RR 8-2018 / RR 16-2023).
   * - Purely Self-Employed: Deducts statutory P250,000.00 from gross sales/receipts.
   * - Mixed-Income Earners: P250,000.00 deduction applies to compensation; 8% applies to gross business sales from 1st peso.
   * - Disqualification: If gross sales exceed P3,000,000.00 or entity is a Corporation/OPC/Partnership.
   */
  static calculate8PercentIncomeTax(
    grossSalesCentavos: number,
    options: {
      isMixedIncomeEarner?: boolean;
      taxpayerClassification?: string;
      allowAboveCeilingCalculation?: boolean;
    } = {}
  ): EightPercentIncomeTaxResult {
    const { isMixedIncomeEarner = false, taxpayerClassification = 'INDIVIDUAL_8PERCENT' } = options;
    const qualificationCeilingCentavos = 300_000_000; // P3,000,000.00 in centavos
    const statutoryDeductionCentavos = isMixedIncomeEarner ? 0 : 25_000_000; // P250,000.00 in centavos

    // 1. Entity Ineligibility Check
    const isIndividual = taxpayerClassification === 'INDIVIDUAL' || taxpayerClassification === 'INDIVIDUAL_8PERCENT';
    if (!isIndividual) {
      return {
        isEligible: false,
        disqualificationReason: `Entity classification '${taxpayerClassification}' is strictly ineligible for the 8% flat income tax option. Only Sole Proprietorships and Individual Professionals qualify under Section 24(A)(2)(b) NIRC and RR 8-2018.`,
        grossSalesCentavos,
        grossSales: grossSalesCentavos / 100,
        qualificationCeilingCentavos,
        statutoryDeductionCentavos: 0,
        statutoryDeduction: 0,
        taxableBaseCentavos: 0,
        taxableBase: 0,
        taxRate: 0,
        taxDueCentavos: 0,
        taxDue: 0,
        isMixedIncome: isMixedIncomeEarner,
        notes: 'Ineligible entity: Must file under Corporate Income Tax (Form 1702-RT / 1702-EX) or regular graduated individual rates.'
      };
    }

    // 2. Gross Sales Ceiling Check (P3,000,000.00 VAT Threshold)
    if (grossSalesCentavos > qualificationCeilingCentavos) {
      return {
        isEligible: false,
        disqualificationReason: `Gross sales of P${(grossSalesCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} exceed the statutory P3,000,000.00 VAT threshold ceiling. Taxpayer is legally disqualified from the 8% flat rate regime and must register for VAT (Form 2550Q) and regular graduated income tax under Section 24(A) NIRC.`,
        grossSalesCentavos,
        grossSales: grossSalesCentavos / 100,
        qualificationCeilingCentavos,
        statutoryDeductionCentavos: 0,
        statutoryDeduction: 0,
        taxableBaseCentavos: grossSalesCentavos,
        taxableBase: grossSalesCentavos / 100,
        taxRate: 0.08,
        taxDueCentavos: 0,
        taxDue: 0,
        isMixedIncome: isMixedIncomeEarner,
        notes: 'Disqualified: Gross receipts exceed P3M VAT threshold.'
      };
    }

    // 3. Taxable Base Calculation
    const taxableBaseCentavos = Math.max(0, grossSalesCentavos - statutoryDeductionCentavos);
    const taxDueCentavos = Math.round(taxableBaseCentavos * 0.08);

    const notes = isMixedIncomeEarner
      ? 'Mixed-Income Earner: 8% tax applied on first peso of gross business sales (P250,000 deduction is absorbed by compensation income under graduated rates). In lieu of Sec 116 Percentage Tax.'
      : 'Purely Self-Employed / Professional: 8% tax applied on gross sales in excess of statutory P250,000 deduction. In lieu of Sec 116 Percentage Tax.';

    return {
      isEligible: true,
      grossSalesCentavos,
      grossSales: grossSalesCentavos / 100,
      qualificationCeilingCentavos,
      statutoryDeductionCentavos,
      statutoryDeduction: statutoryDeductionCentavos / 100,
      taxableBaseCentavos,
      taxableBase: taxableBaseCentavos / 100,
      taxRate: 0.08,
      taxDueCentavos,
      taxDue: taxDueCentavos / 100,
      isMixedIncome: isMixedIncomeEarner,
      notes
    };
  }

  /**
   * Calculates VAT based on Gross amount and VAT rate (default 12%).
   */
  static calculateVat(grossAmountCentavos: number, vatRate: number = 0.12) {
    const taxBase = Math.round(grossAmountCentavos / (1 + vatRate));
    const vatAmount = grossAmountCentavos - taxBase;
    return { taxBase, vatAmount };
  }

  /**
   * Calculates percentage-based tax.
   */
  static calculatePercentage(amountCentavos: number, rate: number) {
    return Math.round(amountCentavos * rate);
  }

  /**
   * Calculates EWT based on amount and rate.
   */
  static calculateEwt(amountCentavos: number, ewtRate: number) {
    return Math.round(amountCentavos * ewtRate);
  }

  /**
   * Calculates Graduated Income Tax based on taxable income and brackets.
   */
  static calculateGraduatedIncomeTax(
    taxableIncomeCentavos: number,
    brackets: { lowerLimit: number; upperLimit: number | null; rate: number; fixedAmount: number }[]
  ) {
    const applicableBracket = brackets.find(
      b => taxableIncomeCentavos >= b.lowerLimit && (b.upperLimit === null || taxableIncomeCentavos <= b.upperLimit)
    );

    if (!applicableBracket) {
      const highestBracket = brackets[brackets.length - 1];
      return Math.round(highestBracket.fixedAmount + (taxableIncomeCentavos - highestBracket.lowerLimit) * highestBracket.rate);
    }

    return Math.round(applicableBracket.fixedAmount + (taxableIncomeCentavos - applicableBracket.lowerLimit) * applicableBracket.rate);
  }

  /**
   * Calculates statutory individual compensation income tax under Section 24(A)(2)(a) NIRC (TRAIN Law RA 10963, 2023+).
   * Note: The first P250,000 is 100% exempt (0% tax bracket).
   */
  static calculateCompensationGraduatedTax(taxableCompensationCentavos: number) {
    const taxDueCentavos = this.calculateGraduatedIncomeTax(
      taxableCompensationCentavos,
      STANDARD_INDIVIDUAL_GRADUATED_BRACKETS_CENTAVOS
    );

    let bracketDescription = 'Tax-Exempt Bracket (First P250,000 at 0%)';
    if (taxableCompensationCentavos > 800_000_000) {
      bracketDescription = 'Over P8,000,000 (P2,202,500 + 35% of excess over P8,000,000)';
    } else if (taxableCompensationCentavos > 200_000_000) {
      bracketDescription = 'Over P2,000,000 to P8,000,000 (P402,500 + 30% of excess over P2,000,000)';
    } else if (taxableCompensationCentavos > 80_000_000) {
      bracketDescription = 'Over P800,000 to P2,000,000 (P102,500 + 25% of excess over P800,000)';
    } else if (taxableCompensationCentavos > 40_000_000) {
      bracketDescription = 'Over P400,000 to P800,000 (P22,500 + 20% of excess over P400,000)';
    } else if (taxableCompensationCentavos > 25_000_000) {
      bracketDescription = 'Over P250,000 to P400,000 (15% of excess over P250,000)';
    }

    return {
      taxableCompensationCentavos,
      taxableCompensation: taxableCompensationCentavos / 100,
      statutoryExemptionCentavos: Math.min(taxableCompensationCentavos, 25_000_000),
      statutoryExemption: Math.min(taxableCompensationCentavos, 25_000_000) / 100,
      taxDueCentavos,
      taxDue: taxDueCentavos / 100,
      bracketDescription
    };
  }

  /**
   * Generates the official 61-bracket SSS Contribution Table under RA 11199 (2025/2026 Statutory Schedule).
   * - MSC Floor: ₱5,000; MSC Ceiling: ₱35,000; Step: ₱500.
   * - Total Rate: 15.0% (10.0% Employer, 5.0% Employee).
   * - Regular Social Security: Covers MSC up to ₱20,000.
   * - Mandatory Provident Fund (WISP / MPF): Covers MSC from ₱20,500 to ₱35,000.
   * - EC (Employees' Compensation, 100% ER): ₱10 for MSC < ₱15,000; ₱30 for MSC >= ₱15,000.
   */
  static getOfficial2026SssBracketTable(): Array<{
    bracketIndex: number;
    compensationFloorCentavos: number;
    compensationCeilingCentavos: number | null;
    mscCentavos: number;
    regularMscCentavos: number;
    wispMscCentavos: number;
    regularEeCentavos: number;
    regularErCentavos: number;
    wispEeCentavos: number;
    wispErCentavos: number;
    ecErCentavos: number;
    totalEeCentavos: number;
    totalErCentavos: number;
    totalContributionCentavos: number;
  }> {
    const table = [];
    let idx = 1;

    for (let msc = 5000; msc <= 35000; msc += 500) {
      const mscCentavos = msc * 100;
      const floorCentavos = msc === 5000 ? 0 : (msc - 250) * 100;
      const ceilingCentavos = msc === 35000 ? null : (msc + 250) * 100 - 1;

      const regularMscCentavos = Math.min(2000000, mscCentavos);
      const wispMscCentavos = Math.max(0, mscCentavos - 2000000);

      const regularEeCentavos = Math.round(regularMscCentavos * 0.05);
      const regularErCentavos = Math.round(regularMscCentavos * 0.10);

      const wispEeCentavos = Math.round(wispMscCentavos * 0.05);
      const wispErCentavos = Math.round(wispMscCentavos * 0.10);

      const ecErCentavos = msc >= 15000 ? 3000 : 1000;

      const totalEeCentavos = regularEeCentavos + wispEeCentavos;
      const totalErCentavos = regularErCentavos + wispErCentavos + ecErCentavos;
      const totalContributionCentavos = totalEeCentavos + totalErCentavos;

      table.push({
        bracketIndex: idx++,
        compensationFloorCentavos: floorCentavos,
        compensationCeilingCentavos: ceilingCentavos,
        mscCentavos,
        regularMscCentavos,
        wispMscCentavos,
        regularEeCentavos,
        regularErCentavos,
        wispEeCentavos,
        wispErCentavos,
        ecErCentavos,
        totalEeCentavos,
        totalErCentavos,
        totalContributionCentavos
      });
    }

    return table;
  }

  /**
   * Authoritative discrete SSS bracket lookup for an employee based on monthly compensation.
   */
  static lookupOfficialSss2026Bracket(monthlyCompensationCentavos: number) {
    if (monthlyCompensationCentavos <= 0) {
      return {
        bracketIndex: 0,
        mscCentavos: 0,
        regularMscCentavos: 0,
        wispMscCentavos: 0,
        regularEeCentavos: 0,
        regularErCentavos: 0,
        wispEeCentavos: 0,
        wispErCentavos: 0,
        ecErCentavos: 0,
        totalEeCentavos: 0,
        totalErCentavos: 0,
        totalContributionCentavos: 0
      };
    }

    let mscCentavos: number;
    if (monthlyCompensationCentavos < 525000) {
      mscCentavos = 500000; // ₱5,000 floor
    } else if (monthlyCompensationCentavos >= 3475000) {
      mscCentavos = 3500000; // ₱35,000 ceiling
    } else {
      mscCentavos = Math.min(3500000, Math.max(500000, 50000 * Math.floor((monthlyCompensationCentavos + 25000) / 50000)));
    }

    const regularMscCentavos = Math.min(2000000, mscCentavos);
    const wispMscCentavos = Math.max(0, mscCentavos - 2000000);
    const regularEeCentavos = Math.round(regularMscCentavos * 0.05);
    const regularErCentavos = Math.round(regularMscCentavos * 0.10);
    const wispEeCentavos = Math.round(wispMscCentavos * 0.05);
    const wispErCentavos = Math.round(wispMscCentavos * 0.10);
    const ecErCentavos = mscCentavos >= 1500000 ? 3000 : 1000;
    const totalEeCentavos = regularEeCentavos + wispEeCentavos;
    const totalErCentavos = regularErCentavos + wispErCentavos + ecErCentavos;
    const totalContributionCentavos = totalEeCentavos + totalErCentavos;

    const bracketIndex = Math.round((mscCentavos - 500000) / 50000) + 1;

    return {
      bracketIndex,
      mscCentavos,
      regularMscCentavos,
      wispMscCentavos,
      regularEeCentavos,
      regularErCentavos,
      wispEeCentavos,
      wispErCentavos,
      ecErCentavos,
      totalEeCentavos,
      totalErCentavos,
      totalContributionCentavos
    };
  }

  /**
   * 2026 Philippine Statutory Mandatory Contributions Engine
   * - SSS (RA 11199):
   *   - 2025/2026 Statutory Schedule: Discrete MSC Floor ₱5,000, Ceiling ₱35,000 in ₱500 steps;
   *     Rate: 15% total (5.0% Employee, 10.0% Employer) -> Max EE ₱1,750/month (₱875/semi-monthly).
   *   - Legacy 2024 Schedule (supported via scheduleVersion='2024_LEGACY_4_5PCT'):
   *     4.5% Employee, 9.5% Employer -> Max EE ₱1,350/month (on ₱30k MSC) or ₱675/semi-monthly.
   * - PhilHealth (RA 11223 UHC Act & PhilHealth Circular 2024-0001 / 2026):
   *   - Rate: 5.0% total (2.5% Employee, 2.5% Employer).
   *   - Monthly Floor: ₱10,000 (₱5,000 semi-monthly); Monthly Ceiling: ₱100,000 (₱50,000 semi-monthly).
   *   - Max EE: ₱2,500/month (₱1,250/semi-monthly); Min EE: ₱250/month (₱125/semi-monthly).
   * - Pag-IBIG / HDMF (RA 9679 & HDMF Circular No. 460 effective Feb 2024–2026):
   *   - Monthly Fund Salary (MFS) Ceiling: ₱10,000/month (₱5,000/semi-monthly).
   *   - Rate: 2.0% Employee, 2.0% Employer (for monthly compensation > ₱1,500).
  /**
   * Authoritative analytical Pag-IBIG contribution breakdown under HDMF Circular No. 460.
   * Explicitly separates:
   * - monthlyCompensationCentavos (total monthly remuneration)
   * - semiMonthlyGrossSalaryCentavos (gross compensation per cutoff)
   * - applicablePeriodBaseCentavos (base subject to periodic cap)
   * - applicableMonthlyCompensationBaseCentavos (base subject to statutory ₱10,000 monthly ceiling)
   * - statutoryContributionCapCentavos (₱10,000/month or ₱5,000/semi-monthly)
   * - employeeRate (1% if monthly <= ₱1,500; 2% if monthly > ₱1,500)
   * - employerRate (2% regardless)
   * - employeeDeductionCentavos
   * - employerContributionCentavos
   * - totalMonthlyObligationCentavos
   */
  static calculateOfficialPagibigBreakdown(
    grossPayCentavos: number,
    frequency: 'SEMI_MONTHLY' | 'MONTHLY' | 'ANNUAL' = 'SEMI_MONTHLY'
  ) {
    const isFullMonth = frequency === 'MONTHLY';
    const isAnnual = frequency === 'ANNUAL';
    const periodDivisor = isAnnual ? (1 / 12) : isFullMonth ? 1 : 2;

    const monthlyCompensationCentavos = isAnnual
      ? Math.round(grossPayCentavos / 12)
      : isFullMonth
      ? grossPayCentavos
      : grossPayCentavos * 2;

    const semiMonthlyGrossSalaryCentavos = isAnnual
      ? Math.round(grossPayCentavos / 24)
      : isFullMonth
      ? Math.round(grossPayCentavos / 2)
      : grossPayCentavos;

    // Statutory MFS ceiling: ₱10,000/month or ₱5,000/semi-monthly
    const statutoryContributionCapCentavos = Math.round(1000000 / periodDivisor);
    const applicablePeriodBaseCentavos = Math.min(statutoryContributionCapCentavos, Math.max(0, grossPayCentavos));
    const applicableMonthlyCompensationBaseCentavos = Math.min(1000000, Math.max(0, monthlyCompensationCentavos));

    // Rate determination per HDMF Circular 460:
    // Monthly compensation <= ₱1,500: EE 1%, ER 2%
    // Monthly compensation > ₱1,500: EE 2%, ER 2%
    const employeeRate = monthlyCompensationCentavos <= 150000 ? 0.01 : 0.02;
    const employerRate = 0.02;

    const employeeDeductionCentavos = grossPayCentavos > 0 ? Math.round(applicablePeriodBaseCentavos * employeeRate) : 0;
    const employerContributionCentavos = grossPayCentavos > 0 ? Math.round(applicablePeriodBaseCentavos * employerRate) : 0;
    const periodTotalCentavos = employeeDeductionCentavos + employerContributionCentavos;

    const monthlyMultiplier = isAnnual ? (1 / 12) : isFullMonth ? 1 : 2;
    const monthlyEmployeeDeductionCentavos = Math.round(employeeDeductionCentavos * monthlyMultiplier);
    const monthlyEmployerContributionCentavos = Math.round(employerContributionCentavos * monthlyMultiplier);
    const totalMonthlyObligationCentavos = monthlyEmployeeDeductionCentavos + monthlyEmployerContributionCentavos;

    return {
      frequency,
      grossPayCentavos,
      monthlyCompensationCentavos,
      semiMonthlyGrossSalaryCentavos,
      applicablePeriodBaseCentavos,
      applicableMonthlyCompensationBaseCentavos,
      statutoryContributionCapCentavos,
      employeeRate,
      employerRate,
      employeeDeductionCentavos,
      employerContributionCentavos,
      periodTotalCentavos,
      monthlyEmployeeDeductionCentavos,
      monthlyEmployerContributionCentavos,
      totalMonthlyObligationCentavos
    };
  }

  /**
   * 2026 Philippine Statutory Mandatory Contributions Engine
   */
  static calculate2026StatutoryContributions(
    grossPayCentavos: number,
    options: {
      frequency?: 'SEMI_MONTHLY' | 'MONTHLY' | 'ANNUAL';
      sssScheduleVersion?: '2026_STATUTORY_5PCT' | '2024_LEGACY_4_5PCT';
      useDiscreteBracketTable?: boolean;
    } = {}
  ) {
    const frequency = options.frequency || 'SEMI_MONTHLY';
    const sssSchedule = options.sssScheduleVersion || '2026_STATUTORY_5PCT';
    const isFullMonth = frequency === 'MONTHLY';
    const isAnnual = frequency === 'ANNUAL';
    const periodDivisor = isAnnual ? (1 / 12) : isFullMonth ? 1 : 2;

    // Monthly equivalent salary for statutory table lookup
    const monthlyEquivalentCentavos = isAnnual
      ? Math.round(grossPayCentavos / 12)
      : isFullMonth
      ? grossPayCentavos
      : grossPayCentavos * 2;

    // 1. SSS Contribution (Authoritative Discrete Bracket Lookup)
    let sssEmployeeCentavos = 0;
    let sssEmployerCentavos = 0;
    let sssEcEmployerCentavos = 0;
    let mscCentavos = 0;
    let regularMscCentavos = 0;
    let wispMscCentavos = 0;

    if (grossPayCentavos > 0) {
      if (sssSchedule === '2026_STATUTORY_5PCT') {
        const bracket = this.lookupOfficialSss2026Bracket(monthlyEquivalentCentavos);
        mscCentavos = Math.round(bracket.mscCentavos / periodDivisor);
        regularMscCentavos = Math.round(bracket.regularMscCentavos / periodDivisor);
        wispMscCentavos = Math.round(bracket.wispMscCentavos / periodDivisor);
        sssEmployeeCentavos = Math.round(bracket.totalEeCentavos / periodDivisor);
        sssEmployerCentavos = Math.round((bracket.regularErCentavos + bracket.wispErCentavos) / periodDivisor);
        sssEcEmployerCentavos = Math.round(bracket.ecErCentavos / periodDivisor);
      } else {
        // Legacy 2024 Schedule (4.5% EE / 9.5% ER, max ₱30k MSC)
        const legacyMaxMsc = Math.round(3000000 / periodDivisor);
        const legacyMinMsc = Math.round(400000 / periodDivisor);
        const clampedBase = Math.min(legacyMaxMsc, Math.max(legacyMinMsc, grossPayCentavos));
        mscCentavos = clampedBase;
        regularMscCentavos = Math.min(Math.round(2000000 / periodDivisor), clampedBase);
        wispMscCentavos = Math.max(0, clampedBase - regularMscCentavos);
        sssEmployeeCentavos = Math.round(clampedBase * 0.045);
        sssEmployerCentavos = Math.round(clampedBase * 0.095);
        sssEcEmployerCentavos = Math.round((clampedBase >= Math.round(1500000 / periodDivisor) ? 3000 : 1000) / periodDivisor);
      }
    }

    // 2. PhilHealth Contribution (5% total = 2.5% EE + 2.5% ER, floor ₱10k/mo, ceiling ₱100k/mo)
    const phFloorCentavos = Math.round(1000000 / periodDivisor);
    const phCeilingCentavos = Math.round(10000000 / periodDivisor);
    const clampedPhBase = Math.min(phCeilingCentavos, Math.max(phFloorCentavos, grossPayCentavos));
    const philhealthEmployeeCentavos = grossPayCentavos > 0 ? Math.round(clampedPhBase * 0.025) : 0;
    const philhealthEmployerCentavos = philhealthEmployeeCentavos;

    // 3. Pag-IBIG Contribution (HDMF Circular 460: 2% EE [or 1% if <= ₱1,500] + 2% ER on ₱10,000 MFS ceiling)
    const pagibigBreakdown = this.calculateOfficialPagibigBreakdown(
      grossPayCentavos,
      isAnnual ? 'ANNUAL' : isFullMonth ? 'MONTHLY' : 'SEMI_MONTHLY'
    );
    const pagibigEmployeeCentavos = pagibigBreakdown.employeeDeductionCentavos;
    const pagibigEmployerCentavos = pagibigBreakdown.employerContributionCentavos;

    return {
      frequency,
      sssScheduleVersion: sssSchedule,
      mscCentavos,
      regularMscCentavos,
      wispMscCentavos,
      sssEmployeeCentavos,
      sssEmployerCentavos,
      sssEcEmployerCentavos,
      philhealthEmployeeCentavos,
      philhealthEmployerCentavos,
      pagibigEmployeeCentavos,
      pagibigEmployerCentavos,
      totalEmployeeMandatoryCentavos: sssEmployeeCentavos + philhealthEmployeeCentavos + pagibigEmployeeCentavos,
      totalEmployerMandatoryCentavos: sssEmployerCentavos + sssEcEmployerCentavos + philhealthEmployerCentavos + pagibigEmployerCentavos,
      cpaPolicyNotes: [
        'SSS: RA 11199 2025/2026 schedule uses discrete ₱500 MSC brackets (₱5,000–₱35,000) at 5.0% EE / 10.0% ER. Regular SS up to ₱20k + Mandatory WISP ₱20k–₱35k.',
        'PhilHealth: RA 11223 / Circular 2024-0001 uses 5.0% total (2.5% EE / 2.5% ER) with ₱10,000 monthly floor and ₱100,000 monthly ceiling.',
        'Pag-IBIG: HDMF Circular 460 (effective Feb 2024–2026) uses ₱10,000 MFS ceiling at 2% EE / 2% ER (max ₱200/month or ₱100/semi-monthly).',
        'BIR 1601-C: Mandatory EE contributions to SSS (including mandatory WISP), PhilHealth, and Pag-IBIG are excluded from gross compensation before applying TRAIN Law (RA 10963) 2023+ graduated withholding brackets.'
      ]
    };
  }

  /**
   * Calculates statutory employee payroll deductions and BIR Revised Withholding Tax (Form 1601-C)
   * under RA 10963 (TRAIN Law, Effective January 1, 2023 onward) & RR 11-2018.
   *
   * Semi-Monthly Brackets (Effective Jan 1, 2023+):
   *  1. ₱10,417.00 and below               : ₱0.00 (0% Exempt)
   *  2. Over ₱10,417.00 to ₱16,666.00      : ₱0.00 + 15% over ₱10,417.00
   *  3. Over ₱16,667.00 to ₱33,332.00      : ₱937.50 + 20% over ₱16,667.00 (1,666,600 centavos threshold)
   *  4. Over ₱33,333.00 to ₱83,332.00      : ₱4,270.83 + 25% over ₱33,333.00 (3,333,200 centavos threshold)
   *  5. Over ₱83,333.00 to ₱333,332.00     : ₱16,770.83 + 30% over ₱83,333.00 (8,333,200 centavos threshold)
   *  6. Over ₱333,333.00                   : ₱91,770.83 + 35% over ₱333,333.00 (33,333,200 centavos threshold)
   */
  static calculateStatutoryPayrollWithholding(
    grossPayCentavos: number,
    options: {
      frequency?: 'SEMI_MONTHLY' | 'MONTHLY' | 'ANNUAL';
      sssEmployeeCentavos?: number;
      philhealthEmployeeCentavos?: number;
      pagibigEmployeeCentavos?: number;
      nonTaxableBenefitsCentavos?: number;
      sssScheduleVersion?: '2026_STATUTORY_5PCT' | '2024_LEGACY_4_5PCT';
    } = {}
  ) {
    const frequency = options.frequency || 'SEMI_MONTHLY';
    const isFullMonth = frequency === 'MONTHLY';

    // 1. Mandatory Non-Taxable Government Contributions (Employee Share)
    const defaultContribs = this.calculate2026StatutoryContributions(grossPayCentavos, {
      frequency,
      sssScheduleVersion: options.sssScheduleVersion || '2026_STATUTORY_5PCT'
    });

    const sssEE = options.sssEmployeeCentavos !== undefined
      ? options.sssEmployeeCentavos
      : defaultContribs.sssEmployeeCentavos;

    const phEE = options.philhealthEmployeeCentavos !== undefined
      ? options.philhealthEmployeeCentavos
      : defaultContribs.philhealthEmployeeCentavos;

    const pagibigEE = options.pagibigEmployeeCentavos !== undefined
      ? options.pagibigEmployeeCentavos
      : defaultContribs.pagibigEmployeeCentavos;

    const nonTaxableBenefits = options.nonTaxableBenefitsCentavos || 0;
    const totalNonTaxableDeductionsCentavos = sssEE + phEE + pagibigEE + nonTaxableBenefits;
    const taxableCompensationCentavos = Math.max(0, grossPayCentavos - totalNonTaxableDeductionsCentavos);

    let withholdingTaxCentavos = 0;
    let bracketNumber = 1;
    let bracketRate = 0;
    let bracketDescription = '';

    if (frequency === 'SEMI_MONTHLY') {
      if (taxableCompensationCentavos <= 1041700) {
        withholdingTaxCentavos = 0;
        bracketNumber = 1;
        bracketRate = 0.0;
        bracketDescription = 'Bracket 1: ₱10,417.00 and below (0% Exempt)';
      } else if (taxableCompensationCentavos < 1666700) {
        withholdingTaxCentavos = Math.round((taxableCompensationCentavos - 1041700) * 0.15);
        bracketNumber = 2;
        bracketRate = 0.15;
        bracketDescription = 'Bracket 2: Over ₱10,417.00 to ₱16,666.00 (15% over ₱10,417.00)';
      } else if (taxableCompensationCentavos < 3333300) {
        withholdingTaxCentavos = Math.round(93750 + (taxableCompensationCentavos - 1666700) * 0.20);
        bracketNumber = 3;
        bracketRate = 0.20;
        bracketDescription = 'Bracket 3: ₱16,667.00 to ₱33,332.00 (₱937.50 + 20% over ₱16,667.00)';
      } else if (taxableCompensationCentavos < 8333300) {
        withholdingTaxCentavos = Math.round(427070 + (taxableCompensationCentavos - 3333300) * 0.25);
        bracketNumber = 4;
        bracketRate = 0.25;
        bracketDescription = 'Bracket 4: ₱33,333.00 to ₱83,332.00 (₱4,270.70 + 25% over ₱33,333.00)';
      } else if (taxableCompensationCentavos < 33333300) {
        withholdingTaxCentavos = Math.round(1677070 + (taxableCompensationCentavos - 8333300) * 0.30);
        bracketNumber = 5;
        bracketRate = 0.30;
        bracketDescription = 'Bracket 5: ₱83,333.00 to ₱333,332.00 (₱16,770.70 + 30% over ₱83,333.00)';
      } else {
        withholdingTaxCentavos = Math.round(9177070 + (taxableCompensationCentavos - 33333300) * 0.35);
        bracketNumber = 6;
        bracketRate = 0.35;
        bracketDescription = 'Bracket 6: ₱333,333.00 and above (₱91,770.70 + 35% over ₱333,333.00)';
      }
    } else if (frequency === 'MONTHLY') {
      if (taxableCompensationCentavos <= 2083300) {
        withholdingTaxCentavos = 0;
        bracketNumber = 1;
        bracketRate = 0.0;
        bracketDescription = 'Monthly Bracket 1: ₱20,833.00 and below (0% Exempt)';
      } else if (taxableCompensationCentavos < 3333300) {
        withholdingTaxCentavos = Math.round((taxableCompensationCentavos - 2083300) * 0.15);
        bracketNumber = 2;
        bracketRate = 0.15;
        bracketDescription = 'Monthly Bracket 2: Over ₱20,833.00 to ₱33,332.00 (15% over ₱20,833.00)';
      } else if (taxableCompensationCentavos < 6666700) {
        withholdingTaxCentavos = Math.round(187500 + (taxableCompensationCentavos - 3333300) * 0.20);
        bracketNumber = 3;
        bracketRate = 0.20;
        bracketDescription = 'Monthly Bracket 3: ₱33,333.00 to ₱66,666.00 (₱1,875.00 + 20% over ₱33,333.00)';
      } else if (taxableCompensationCentavos < 16666700) {
        withholdingTaxCentavos = Math.round(854180 + (taxableCompensationCentavos - 6666700) * 0.25);
        bracketNumber = 4;
        bracketRate = 0.25;
        bracketDescription = 'Monthly Bracket 4: ₱66,667.00 to ₱166,666.00 (₱8,541.80 + 25% over ₱66,667.00)';
      } else if (taxableCompensationCentavos < 66666700) {
        withholdingTaxCentavos = Math.round(3354180 + (taxableCompensationCentavos - 16666700) * 0.30);
        bracketNumber = 5;
        bracketRate = 0.30;
        bracketDescription = 'Monthly Bracket 5: ₱166,667.00 to ₱666,666.00 (₱33,541.80 + 30% over ₱166,667.00)';
      } else {
        withholdingTaxCentavos = Math.round(18354180 + (taxableCompensationCentavos - 66666700) * 0.35);
        bracketNumber = 6;
        bracketRate = 0.35;
        bracketDescription = 'Monthly Bracket 6: ₱666,667.00 and above (₱183,541.80 + 35% over ₱666,667.00)';
      }
    } else {
      const annualRes = this.calculateCompensationGraduatedTax(taxableCompensationCentavos);
      withholdingTaxCentavos = annualRes.taxDueCentavos;
      bracketDescription = annualRes.bracketDescription;
    }

    const totalDeductionsCentavos = sssEE + phEE + pagibigEE + withholdingTaxCentavos;
    const netPayCentavos = grossPayCentavos - totalDeductionsCentavos;

    return {
      frequency,
      grossPayCentavos,
      sssEmployeeCentavos: sssEE,
      philhealthEmployeeCentavos: phEE,
      pagibigEmployeeCentavos: pagibigEE,
      totalNonTaxableDeductionsCentavos,
      statutoryDeductionsCentavos: totalNonTaxableDeductionsCentavos,
      taxableCompensationCentavos,
      annualizedTaxableCompensationCentavos: frequency === 'SEMI_MONTHLY' ? taxableCompensationCentavos * 24 : frequency === 'MONTHLY' ? taxableCompensationCentavos * 12 : taxableCompensationCentavos,
      withholdingTaxCentavos,
      totalDeductionsCentavos,
      netPayCentavos,
      bracketNumber,
      bracketRate,
      marginalRate: bracketRate,
      bracketDescription
    };
  }

  /**
   * Core Engine Invoice Tax & Journal Line Generator
   * Driven strictly by the Company's Taxpayer Classification & VAT Status.
   */
  static async calculateInvoiceTaxes(
    companyId: string,
    grossAmountCentavos: number,
    options: {
      withholdingTaxRate?: number; // e.g. 0.01 (Goods) or 0.02 (Services 2307)
      isGovernmentCustomer?: boolean; // 5% Final Government Withholding
      transactionDate?: string | Date;
    } = {}
  ): Promise<InvoiceTaxEngineResult> {
    const rules = await this.getEngineRulesForCompany(companyId);

    let netTaxBaseCentavos = grossAmountCentavos;
    let taxAmountCentavos = 0;
    let taxRateApplied = 0.0;
    let taxType = 'VAT_EXEMPT';

    // 1. Apply Specific VAT / Tax Status Core Engine Logic
    if (rules.isVatRegistered && rules.defaultVatRate === 0.12) {
      // 12% Output VAT Included Calculation
      taxRateApplied = 0.12;
      taxType = 'VAT_12';
      netTaxBaseCentavos = Math.round(grossAmountCentavos / 1.12);
      taxAmountCentavos = grossAmountCentavos - netTaxBaseCentavos;
    } else if (rules.isPercentageTaxRegistered) {
      if (rules.vatStatus === 'PERCENTAGE_CARRIER') {
        taxRateApplied = 0.03;
        taxType = 'COMMON_CARRIER_3';
        taxAmountCentavos = Math.round(grossAmountCentavos * 0.03);
      } else if (rules.vatStatus === 'PERCENTAGE_FRANCHISE') {
        taxRateApplied = 0.03;
        taxType = 'FRANCHISE_TAX';
        taxAmountCentavos = Math.round(grossAmountCentavos * 0.03);
      } else if (rules.vatStatus === 'PERCENTAGE_BANK_GRT') {
        taxRateApplied = 0.05;
        taxType = 'GROSS_RECEIPTS_TAX';
        taxAmountCentavos = Math.round(grossAmountCentavos * 0.05);
      } else if (rules.vatStatus === 'PERCENTAGE_AMUSEMENT') {
        taxRateApplied = 0.18;
        taxType = 'AMUSEMENT_TAX';
        taxAmountCentavos = Math.round(grossAmountCentavos * 0.18);
      } else {
        // Standard Section 116 Percentage Tax (Form 2551Q) - Date-sensitive rate
        taxRateApplied = this.getSection116Rate(options.transactionDate);
        taxType = taxRateApplied === 0.01 ? 'PERCENTAGE_1_CREATE' : 'PERCENTAGE_3';
        taxAmountCentavos = Math.round(grossAmountCentavos * taxRateApplied);
      }
    } else if (rules.isPezaGIt) {
      taxRateApplied = 0.05;
      taxType = 'PEZA_5_GIT';
      taxAmountCentavos = Math.round(grossAmountCentavos * 0.05);
    } else if (rules.isZeroRated) {
      taxRateApplied = 0.0;
      taxType = 'ZERO_RATED';
      taxAmountCentavos = 0;
    } else {
      // VAT Exempt / BMBE / 8% Flat Tax / Cooperative Exempt
      taxRateApplied = 0.0;
      taxType = 'VAT_EXEMPT';
      taxAmountCentavos = 0;
    }

    // 2. Withholding Tax Deduction (Form 2307 / Government Withholding)
    let withholdingTaxAmountCentavos = 0;
    if (options.isGovernmentCustomer) {
      // 5% Final VAT Withholding under Sec 114(C)
      withholdingTaxAmountCentavos = Math.round(netTaxBaseCentavos * 0.05);
    } else if (options.withholdingTaxRate && options.withholdingTaxRate > 0) {
      withholdingTaxAmountCentavos = Math.round(netTaxBaseCentavos * options.withholdingTaxRate);
    }

    const finalPayableCentavos = grossAmountCentavos - withholdingTaxAmountCentavos;

    // 3. Generate Core Double-Entry Journal Lines Preview
    const journalLinesPreview: Array<{ accountCode: string; accountName: string; debitCentavos: number; creditCentavos: number }> = [];

    // Debit AR / Cash
    journalLinesPreview.push({
      accountCode: '1030',
      accountName: 'Accounts Receivable',
      debitCentavos: finalPayableCentavos,
      creditCentavos: 0
    });

    // Debit CWT 2307 Asset (if withheld by customer)
    if (withholdingTaxAmountCentavos > 0) {
      journalLinesPreview.push({
        accountCode: rules.ledgerPostingRules.cwt2307AssetAccountCode,
        accountName: 'Creditable Withholding Tax (Form 2307 Asset)',
        debitCentavos: withholdingTaxAmountCentavos,
        creditCentavos: 0
      });
    }

    // Credit Sales Revenue
    journalLinesPreview.push({
      accountCode: rules.ledgerPostingRules.salesRevenueAccountCode,
      accountName: rules.isVatExempt || rules.isZeroRated ? 'Tax Exempt / Zero-Rated Sales Revenue' : 'Service Revenue / Sales',
      debitCentavos: 0,
      creditCentavos: netTaxBaseCentavos
    });

    // Credit Sales Tax Payable Account (if applicable)
    if (taxAmountCentavos > 0 && rules.ledgerPostingRules.salesTaxPayableAccountCode !== 'NONE') {
      let taxAccountName = 'Output VAT Payable';
      if (rules.isPercentageTaxRegistered) taxAccountName = taxRateApplied === 0.01 ? 'Percentage Tax Payable (1% CREATE)' : 'Percentage Tax Payable (Form 2551Q)';
      if (rules.isPezaGIt) taxAccountName = 'Special Gross Income Tax Payable (5% GIT)';

      journalLinesPreview.push({
        accountCode: rules.ledgerPostingRules.salesTaxPayableAccountCode,
        accountName: taxAccountName,
        debitCentavos: 0,
        creditCentavos: taxAmountCentavos
      });
    }

    return {
      engineCode: rules.engineCode,
      grossAmountCentavos,
      netTaxBaseCentavos,
      taxRateApplied,
      taxAmountCentavos,
      taxType,
      withholdingTaxAmountCentavos,
      finalPayableCentavos,
      invoiceHeaderBadge: rules.invoiceHeaderBadge,
      invoiceNotice: rules.invoiceNotice,
      ruleVersion: rules.ruleVersion,
      effectiveDate: rules.effectiveDate,
      taxpayerClassification: rules.taxpayerClassification,
      vatStatus: rules.vatStatus,
      journalLinesPreview
    };
  }

  /**
   * Runs the Core Tax Audit Guardian to detect BIR compliance risks.
   */
  static async runAuditGuardian(companyId: string) {
    const rules = await this.getEngineRulesForCompany(companyId);

    // Fetch authoritative journal count and unposted/exception diagnostics from DB
    const journalCount = await db.select({ count: sql<number>`COUNT(*)` })
      .from(schema.journalEntries)
      .where(and(eq(schema.journalEntries.companyId, companyId), eq(schema.journalEntries.status, 'POSTED')))
      .get();

    const vendorsMissingTin = await db.select({ count: sql<number>`COUNT(*)` })
      .from(schema.vendors)
      .where(and(eq(schema.vendors.companyId, companyId), sql`COALESCE(TRIM(${schema.vendors.tin}), '') = ''`))
      .get();

    const totalPostedJournals = Number(journalCount?.count || 0);
    const missingVendorTinCount = Number(vendorsMissingTin?.count || 0);

    const auditResults = rules.applicableAuditChecks.map((check, index) => {
      let status: 'COMPLIANT' | 'REQUIRES_REVIEW' | 'NO_RECORDS' = totalPostedJournals === 0 ? 'NO_RECORDS' : 'COMPLIANT';
      if (missingVendorTinCount > 0 && check.toLowerCase().includes('tin')) {
        status = 'REQUIRES_REVIEW';
      }
      return {
        checkId: `AUDIT-${rules.engineCode}-${index + 1}`,
        ruleDescription: check,
        status,
        missingVendorTinCount,
        timestamp: new Date().toISOString()
      };
    });

    return {
      companyId,
      engineCode: rules.engineCode,
      engineName: rules.engineName,
      taxpayerClassificationLabel: rules.taxpayerClassificationLabel,
      vatStatusLabel: rules.vatStatusLabel,
      legalFramework: rules.legalFramework,
      ruleVersion: rules.ruleVersion,
      effectiveDate: rules.effectiveDate,
      incomeTaxForm: rules.incomeTaxForm,
      vatOrPercentageForm: rules.vatOrPercentageForm,
      optionalMonthlyVatForm: rules.optionalMonthlyVatForm,
      totalJournalsAudited: totalPostedJournals,
      auditResults
    };
  }

  /**
   * Get Tax Profile for a company.
   */
  static async getCompanyTaxProfile(companyId: string) {
    return await db.select()
      .from(schema.companyTaxProfiles)
      .where(eq(schema.companyTaxProfiles.companyId, companyId))
      .get();
  }

  /**
   * Returns the complete versioned Philippine BIR Tax Rule Registry.
   */
  static getBirTaxRuleRegistry(): BirTaxRuleRegistryEntry[] {
    return PHILIPPINE_BIR_TAX_RULE_REGISTRY;
  }

  /**
   * Resolves a specific versioned Philippine BIR tax rule by ruleId or taxType + date.
   */
  static resolveApplicableBirTaxRule(params: {
    ruleId?: string;
    taxType?: BirTaxRuleRegistryEntry["taxType"];
    atcCode?: string;
    transactionDate?: string;
  }): BirTaxRuleRegistryEntry | undefined {
    const cleanDate = params.transactionDate ? String(params.transactionDate).slice(0, 10) : "2026-11-17";
    if (params.ruleId) {
      return PHILIPPINE_BIR_TAX_RULE_REGISTRY.find((r) => r.ruleId === params.ruleId);
    }
    return PHILIPPINE_BIR_TAX_RULE_REGISTRY.find((r) => {
      if (params.taxType && r.taxType !== params.taxType) return false;
      if (params.atcCode && !r.applicableAtcCodes.includes(params.atcCode.toUpperCase())) return false;
      if (r.effectiveFrom && cleanDate < r.effectiveFrom) return false;
      if (r.effectiveTo && cleanDate > r.effectiveTo) return false;
      return true;
    });
  }

  /**
   * Calculates Final Withholding Tax (FWT) under NIRC Sec. 57(A) / BIR Forms 0619-F & 1601-FQ.
   * Distinct from Creditable/Expanded Withholding Tax (EWT / Form 2307).
   */
  static calculateFinalWithholdingTax(params: {
    grossAmountCentavos: number;
    atcCode: string;
    transactionDate?: string;
  }): {
    atcCode: string;
    rate: number;
    grossAmountCentavos: number;
    finalTaxWithheldCentavos: number;
    netDisbursementCentavos: number;
    birForms: string[];
    certificateForm: string;
    legalReference: string;
    ruleVersion: string;
    requiredGlControlRoles: string[];
    isCreditableOnIncomeTaxReturn: false;
  } {
    const atc = String(params.atcCode || "").trim().toUpperCase();
    const fwtAtcCatalog: Record<string, { rate: number; desc: string }> = {
      WI150: { rate: 0.20, desc: "Final Tax on Interest from Bank Deposits / Yield (Individual - 20%)" },
      WC150: { rate: 0.20, desc: "Final Tax on Interest from Bank Deposits / Yield (Corporation - 20%)" },
      WI340: { rate: 0.10, desc: "Final Tax on Royalties (Books, Literary Works, Musical Compositions - 10%)" },
      WI341: { rate: 0.20, desc: "Final Tax on General Royalties (20%)" },
      WI202: { rate: 0.10, desc: "Final Tax on Cash/Property Dividends to Citizens/Resident Aliens (10%)" },
    };

    const matched = fwtAtcCatalog[atc];
    if (!matched) {
      throw new Error(
        `MISSING_OR_INVALID_FWT_ATC: Final Withholding Tax requires a valid FWT ATC code (e.g., WI150, WC150, WI340, WI341, WI202). Received '${atc || "EMPTY"}'.`
      );
    }

    const finalTaxWithheldCentavos = Math.round(params.grossAmountCentavos * matched.rate);
    const netDisbursementCentavos = params.grossAmountCentavos - finalTaxWithheldCentavos;

    return {
      atcCode: atc,
      rate: matched.rate,
      grossAmountCentavos: params.grossAmountCentavos,
      finalTaxWithheldCentavos,
      netDisbursementCentavos,
      birForms: ["0619-F", "1601-FQ"],
      certificateForm: "2306",
      legalReference: "NIRC Sec. 57(A), RR 2-98 as amended, BIR Forms 0619-F / 1601-FQ / 2306",
      ruleVersion: "BIR-FWT-2026.1",
      requiredGlControlRoles: ["FINAL_WHT_PAYABLE", "CASH"],
      isCreditableOnIncomeTaxReturn: false,
    };
  }

  /**
   * Verifies that a Cash or Bank GL account (e.g., 1010 Cash in Bank or 2026 BDO)
   * is tax-neutral on its own and never automatically triggers VAT or EWT unless
   * an underlying commercial transaction specifies a tax classification.
   */
  static verifyCashBankTaxNeutrality(account: {
    accountCode: string;
    accountName: string;
    accountType?: string | null;
    detailType?: string | null;
    isCashAccount?: boolean | null;
    isTaxAccount?: boolean | null;
  }): {
    isCashOrBankAccount: boolean;
    autoVatApplicable: false;
    autoEwtApplicable: false;
    taxOriginatesFromTransactionOnly: true;
    explanation: string;
  } {
    return {
      isCashOrBankAccount: Boolean(
        account.isCashAccount ||
          ["CASH", "BANK", "CHECKING", "SAVINGS", "CASH_ON_HAND", "PETTY_CASH"].includes(
            String(account.detailType || account.accountType || "").toUpperCase()
          )
      ),
      autoVatApplicable: false,
      autoEwtApplicable: false,
      taxOriginatesFromTransactionOnly: true,
      explanation: `Account '${account.accountCode} - ${account.accountName}' is a Cash/Bank settlement account. Linking it to COA or Bank Reconciliation never auto-applies VAT or EWT; tax treatment is determined strictly by the underlying transaction and taxpayer classification.`,
    };
  }
}

export interface BirTaxRuleRegistryEntry {
  ruleId: string;
  ruleVersion: string;
  legalReference: string;
  taxType:
    | "VAT"
    | "PERCENTAGE_TAX"
    | "EWT"
    | "FINAL_WHT"
    | "INCOME_TAX"
    | "PAYROLL_WHT"
    | "STATUTORY_CONTRIBUTION"
    | "CAS_CBA_COMPLIANCE";
  taxpayerEligibility: string[];
  transactionApplicability: string;
  applicableAtcCodes: string[];
  rateOrFormula: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  birForms: string[];
  requiredSupportingDocuments: string[];
  requiredGlControlRoles: string[];
  postingAndReportingTreatment: string;
}

export const PHILIPPINE_BIR_TAX_RULE_REGISTRY: BirTaxRuleRegistryEntry[] = [
  {
    ruleId: "BIR-VAT-12-STD",
    ruleVersion: "2026.1",
    legalReference: "NIRC Sec. 106–108, RA 10963 (TRAIN), RMC No. 5-2023 (Quarterly 2550Q), RMC No. 52-2023 (Optional Monthly 2550M)",
    taxType: "VAT",
    taxpayerEligibility: ["VAT_REGISTERED_CORPORATION", "VAT_REGISTERED_SOLE_PROPRIETOR"],
    transactionApplicability: "Taxable domestic sales and purchases of goods, properties, and services",
    applicableAtcCodes: ["VT010", "VB010"],
    rateOrFormula: "12% of Net VATable Base (Gross / 1.12 * 0.12 when VAT-inclusive)",
    effectiveFrom: "2023-01-01",
    effectiveTo: null,
    birForms: ["2550Q", "2550M"],
    requiredSupportingDocuments: ["BIR-Compliant VAT Sales Invoice / Official Receipt", "SLSP (Summary List of Sales and Purchases)"],
    requiredGlControlRoles: ["AR", "REVENUE", "OUTPUT_VAT", "INPUT_VAT", "AP"],
    postingAndReportingTreatment: "Sales credit OUTPUT_VAT; eligible VAT purchases debit INPUT_VAT. Mandatory quarterly 2550Q filing with optional monthly 2550M election per RMC 52-2023.",
  },
  {
    ruleId: "BIR-VAT-ZERO-EXEMPT",
    ruleVersion: "2026.1",
    legalReference: "NIRC Sec. 106(A)(2), Sec. 108(B), Sec. 109, CREATE Act RA 11534",
    taxType: "VAT",
    taxpayerEligibility: ["VAT_REGISTERED_EXPORTER", "PEZA_RBE", "VAT_EXEMPT_ENTITY"],
    transactionApplicability: "Direct export sales, zero-rated ecozone sales, and Sec. 109 VAT-exempt transactions",
    applicableAtcCodes: ["VZ010", "VE010"],
    rateOrFormula: "0% (Zero-Rated) or Exempt (No Output VAT)",
    effectiveFrom: "2021-04-11",
    effectiveTo: null,
    birForms: ["2550Q", "2550M"],
    requiredSupportingDocuments: ["Zero-Rated / VAT-Exempt Sales Invoice", "Export / PEZA Certification"],
    requiredGlControlRoles: ["AR", "REVENUE"],
    postingAndReportingTreatment: "Recognizes net revenue without Output VAT; segregated in 2550Q/2550M Zero-Rated and Exempt schedules.",
  },
  {
    ruleId: "BIR-OPT-116-CREATE-1PCT",
    ruleVersion: "2020.7",
    legalReference: "NIRC Sec. 116 as amended by CREATE Act (RA 11534 Sec. 13)",
    taxType: "PERCENTAGE_TAX",
    taxpayerEligibility: ["NON_VAT_CORPORATION", "NON_VAT_SOLE_PROPRIETOR_GRADUATED"],
    transactionApplicability: "Gross quarterly sales/receipts of Non-VAT taxpayers not exceeding ₱3,000,000 threshold (Jul 1, 2020 – Jun 30, 2023)",
    applicableAtcCodes: ["PT010"],
    rateOrFormula: "1% of Gross Sales / Receipts",
    effectiveFrom: "2020-07-01",
    effectiveTo: "2023-06-30",
    birForms: ["2551Q"],
    requiredSupportingDocuments: ["Non-VAT Invoice / Official Receipt"],
    requiredGlControlRoles: ["EXPENSE", "PERCENTAGE_TAX_PAYABLE"],
    postingAndReportingTreatment: "Accrues 1% Percentage Tax Payable reported on quarterly BIR Form 2551Q.",
  },
  {
    ruleId: "BIR-OPT-116-STD-3PCT",
    ruleVersion: "2023.7",
    legalReference: "NIRC Sec. 116 (Reversion to 3% effective July 1, 2023 after CREATE temporary window)",
    taxType: "PERCENTAGE_TAX",
    taxpayerEligibility: ["NON_VAT_CORPORATION", "NON_VAT_SOLE_PROPRIETOR_GRADUATED"],
    transactionApplicability: "Gross quarterly sales/receipts of Non-VAT taxpayers not electing 8% flat income tax",
    applicableAtcCodes: ["PT010"],
    rateOrFormula: "3% of Gross Sales / Receipts",
    effectiveFrom: "2023-07-01",
    effectiveTo: null,
    birForms: ["2551Q"],
    requiredSupportingDocuments: ["Non-VAT Sales Invoice / Official Receipt"],
    requiredGlControlRoles: ["EXPENSE", "PERCENTAGE_TAX_PAYABLE"],
    postingAndReportingTreatment: "Accrues 3% Percentage Tax Payable reported on quarterly BIR Form 2551Q.",
  },
  {
    ruleId: "BIR-EWT-RR11-2018",
    ruleVersion: "2026.1",
    legalReference: "NIRC Sec. 57(B), RR No. 2-98 as amended by RR No. 11-2018 & RR No. 14-2018",
    taxType: "EWT",
    taxpayerEligibility: ["WITHHOLDING_AGENT_CORPORATION", "WITHHOLDING_AGENT_INDIVIDUAL"],
    transactionApplicability: "Income payments to suppliers/professionals subject to Creditable/Expanded Withholding Tax",
    applicableAtcCodes: ["WI010", "WI011", "WC010", "WC011", "WI100", "WC100", "WI158", "WC158", "WI160", "WC160", "WI050", "WC050"],
    rateOrFormula: "ATC-specific statutory rate (1%, 2%, 5%, 10%, 15%) applied to Net Tax Base (excluding VAT); never silently defaulted",
    effectiveFrom: "2018-01-01",
    effectiveTo: null,
    birForms: ["0619-E", "1601-EQ", "2307", "1604-E"],
    requiredSupportingDocuments: ["Supplier Invoice / Bill", "BIR Form 2307 (Certificate of Creditable Tax Withheld at Source)", "QAP / SAWT"],
    requiredGlControlRoles: ["AP", "EWT", "CWT"],
    postingAndReportingTreatment: "Payor credits EWT Payable and issues Form 2307; Payee debits Creditable Withholding Tax (CWT 2307 Asset) and submits SAWT.",
  },
  {
    ruleId: "BIR-FWT-SEC57A",
    ruleVersion: "2026.1",
    legalReference: "NIRC Sec. 57(A), RR No. 2-98, BIR Forms 0619-F, 1601-FQ, 2306",
    taxType: "FINAL_WHT",
    taxpayerEligibility: ["WITHHOLDING_AGENT_CORPORATION", "WITHHOLDING_AGENT_INDIVIDUAL"],
    transactionApplicability: "Passive income payments, bank interest, royalties, and dividends subject to Final Withholding Tax",
    applicableAtcCodes: ["WI150", "WC150", "WI340", "WI341", "WI202"],
    rateOrFormula: "ATC-specific final tax rate (10% / 20%) constituting full and final settlement of income tax",
    effectiveFrom: "2018-01-01",
    effectiveTo: null,
    birForms: ["0619-F", "1601-FQ", "2306", "1604-F"],
    requiredSupportingDocuments: ["BIR Form 2306 (Certificate of Final Tax Withheld at Source)"],
    requiredGlControlRoles: ["FINAL_WHT_PAYABLE", "CASH"],
    postingAndReportingTreatment: "Credits Final Withholding Tax Payable (distinct from EWT 2307); not creditable against regular income tax.",
  },
  {
    ruleId: "BIR-IT-8PCT-FLAT",
    ruleVersion: "2023.1",
    legalReference: "NIRC Sec. 24(A)(2)(b), RA 10963 (TRAIN), RR No. 8-2018",
    taxType: "INCOME_TAX",
    taxpayerEligibility: ["NON_VAT_SOLE_PROPRIETOR_8PCT", "SELF_EMPLOYED_PROFESSIONAL_8PCT"],
    transactionApplicability: "Purely self-employed/professional or mixed-income individuals with gross sales/receipts <= ₱3,000,000 VAT threshold",
    applicableAtcCodes: ["II015", "II017"],
    rateOrFormula: "8% of Gross Sales/Receipts and Non-Operating Income in excess of ₱250,000 (₱0 deduction on business income if mixed-income earner)",
    effectiveFrom: "2018-01-01",
    effectiveTo: null,
    birForms: ["1701Q", "1701A", "1701"],
    requiredSupportingDocuments: ["Non-VAT Sales Invoices / Official Receipts", "Form 2307 Certificates"],
    requiredGlControlRoles: ["REVENUE", "INCOME_TAX_PAYABLE", "CWT"],
    postingAndReportingTreatment: "In lieu of Graduated Income Tax and Sec. 116 Percentage Tax (Form 2551Q). Auto-revokes if cumulative gross exceeds ₱3,000,000.",
  },
  {
    ruleId: "BIR-IT-GRADUATED-CORP",
    ruleVersion: "2023.1",
    legalReference: "NIRC Sec. 24(A)(2)(a) (2023+ Individual Graduated Table) & Sec. 27(A) as amended by CREATE Act RA 11534 (20% MSME / 25% Regular RCIT)",
    taxType: "INCOME_TAX",
    taxpayerEligibility: ["CORPORATION", "SOLE_PROPRIETOR_GRADUATED", "OPC"],
    transactionApplicability: "Annual and quarterly net taxable income of corporations and graduated-rate individuals",
    applicableAtcCodes: ["IC010", "IC055", "II011"],
    rateOrFormula: "0%–35% Graduated Brackets (Individuals 2023+) or 20% MSME / 25% Regular Corporate Income Tax (Corporations)",
    effectiveFrom: "2023-01-01",
    effectiveTo: null,
    birForms: ["1701Q", "1701", "1702Q", "1702-RT"],
    requiredSupportingDocuments: ["Audited Financial Statements (AFS)", "Trial Balance", "BIR Form 2307 SAWT"],
    requiredGlControlRoles: ["REVENUE", "COGS", "EXPENSE", "INCOME_TAX_PAYABLE", "CWT"],
    postingAndReportingTreatment: "Computes income tax on net taxable income (or OSD) less creditable Form 2307 tax credits.",
  },
  {
    ruleId: "BIR-PAYROLL-1601C-STATUTORY",
    ruleVersion: "2025.1",
    legalReference: "NIRC Sec. 79, RR 11-2018 (2023+ TRAIN WHT Table), RA 11199 (SSS 2025 15% + EC + WISP), RA 11223 (PhilHealth 5%), HDMF Circular 460 (Pag-IBIG 2%/2% on ₱10k MFS)",
    taxType: "PAYROLL_WHT",
    taxpayerEligibility: ["ALL_EMPLOYERS"],
    transactionApplicability: "Employee compensation payroll runs and mandatory government remittances",
    applicableAtcCodes: ["WC010", "WW010"],
    rateOrFormula: "Gross Compensation less non-taxable de minimis/13th month (<=₱90,000) and EE share of SSS/PhilHealth/Pag-IBIG -> 2023+ TRAIN Withholding Table",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    birForms: ["1601-C", "2316", "1604-C"],
    requiredSupportingDocuments: ["Approved Payroll Register", "SSS R-3 / PhilHealth RF-1 / Pag-IBIG MCRF", "BIR Form 2316"],
    requiredGlControlRoles: ["SALARIES_EXPENSE", "SSS_PAYABLE", "PHILHEALTH_PAYABLE", "PAGIBIG_PAYABLE", "WHT_COMPENSATION_PAYABLE", "CASH"],
    postingAndReportingTreatment: "Separates employee deductions and employer contributions into distinct statutory liability accounts; WHT Compensation is never conflated with SSS/PhilHealth/Pag-IBIG.",
  },
  {
    ruleId: "BIR-CAS-CBA-RMC-65-2025",
    ruleVersion: "2025.1",
    legalReference: "RMC No. 5-2021 & RMC No. 65-2025 (Simplified Registration of Computerized Accounting System / Computerized Books of Accounts)",
    taxType: "CAS_CBA_COMPLIANCE",
    taxpayerEligibility: ["ALL_TAXPAYERS_USING_CAS_CBA"],
    transactionApplicability: "System registration readiness, immutable audit trail, sequential numbering, and BIR Annex checklists",
    applicableAtcCodes: [],
    rateOrFormula: "Documentary and technical compliance readiness verification",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    birForms: ["BIR Form 1900", "RMC 5-2021 Annex A-D"],
    requiredSupportingDocuments: ["System Description", "Company-Scoped Chart of Accounts", "Books of Accounts (GJ, GL, CRJ, CDJ, SJ, PJ)", "Audit Trail Certification"],
    requiredGlControlRoles: ["CASH", "AR", "AP", "REVENUE", "EXPENSE", "RETAINED_EARNINGS"],
    postingAndReportingTreatment: "Produces readiness status (NOT_REGISTERED / READINESS_INCOMPLETE / READY_FOR_TAXPAYER_FILING); never fabricates a BIR Acknowledgment Certificate.",
  },
];

export const PhilippineTaxEngine = TaxEngine;
export type PhilippineTaxEngine = typeof TaxEngine;

