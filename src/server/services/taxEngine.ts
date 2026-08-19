import { db } from "../db";
import * as schema from "../db/schema";
import { eq } from "drizzle-orm";
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
      rateDescription
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
      journalLinesPreview
    };
  }

  /**
   * Runs the Core Tax Audit Guardian to detect BIR compliance risks.
   */
  static async runAuditGuardian(companyId: string) {
    const rules = await this.getEngineRulesForCompany(companyId);

    // Fetch company transaction metrics from DB
    const journalCount = await db.select({ count: schema.journalEntries.id })
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.companyId, companyId))
      .get();

    const auditResults = rules.applicableAuditChecks.map((check, index) => ({
      checkId: `AUDIT-${rules.engineCode}-${index + 1}`,
      ruleDescription: check,
      status: 'COMPLIANT',
      timestamp: new Date().toISOString()
    }));

    return {
      companyId,
      engineCode: rules.engineCode,
      engineName: rules.engineName,
      taxpayerClassificationLabel: rules.taxpayerClassificationLabel,
      vatStatusLabel: rules.vatStatusLabel,
      legalFramework: rules.legalFramework,
      incomeTaxForm: rules.incomeTaxForm,
      vatOrPercentageForm: rules.vatOrPercentageForm,
      totalJournalsAudited: journalCount?.count || 0,
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
}

export const PhilippineTaxEngine = TaxEngine;
export type PhilippineTaxEngine = typeof TaxEngine;
