import { db } from "../../../db";
import * as schema from "../../../db/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { TaxEngine, PhilippineTaxEngine } from "../../taxEngine";
import { getBirTaxProfileRules } from "../../../../shared/taxProfile";

export interface GetVatPayableParams {
  companyId: string;
  startDate?: string;
  endDate?: string;
}

export interface VatPayableResult {
  companyId: string;
  companyName?: string;
  isVatRegistered: boolean;
  taxpayerClassification: string;
  taxpayerClassificationLabel: string;
  vatStatus: string;
  vatStatusLabel: string;
  period: {
    startDate?: string;
    endDate?: string;
    label: string;
  };
  grossSalesCentavos: number;
  grossSales: number;
  taxableSalesBaseCentavos: number;
  taxableSalesBase: number;
  outputVatCentavos: number;
  outputVat: number;
  grossPurchasesCentavos: number;
  grossPurchases: number;
  taxablePurchasesBaseCentavos: number;
  taxablePurchasesBase: number;
  creditableInputVatCentavos: number;
  creditableInputVat: number;
  netVatPayableCentavos: number;
  netVatPayable: number;
  applicableForm: string;
  isSlspRequired: boolean;
  engineCode: string;
  legalFramework: string;
  invoiceCount: number;
  billCount: number;
  status: 'TAX_PAYABLE' | 'EXCESS_INPUT_VAT' | 'ZERO_TAX';
  authoritativeSource: string;
}

export interface GetPercentageTaxParams {
  companyId: string;
  startDate?: string;
  endDate?: string;
}

export interface PercentageTaxResult {
  companyId: string;
  companyName?: string;
  isPercentageTaxRegistered: boolean;
  taxpayerClassification: string;
  taxpayerClassificationLabel: string;
  vatStatus: string;
  vatStatusLabel: string;
  period: {
    startDate?: string;
    endDate?: string;
    label: string;
  };
  grossSalesCentavos: number;
  grossSales: number;
  taxRate: number;
  taxRatePercentage: string;
  taxType: string;
  percentageTaxPayableCentavos: number;
  percentageTaxPayable: number;
  applicableForm: string;
  legalBasis: string;
  engineCode: string;
  invoiceCount: number;
  isExempt: boolean;
  exemptionNotes?: string;
  authoritativeSource: string;
}

export interface GetTaxFilingRequirementsParams {
  companyId: string;
  isMixedIncomeEarner?: boolean;
}

export interface TaxFilingRequirementsResult {
  companyId: string;
  companyName?: string;
  tin?: string;
  taxpayerClassification: string;
  taxpayerClassificationLabel: string;
  vatStatus: string;
  vatStatusLabel: string;
  isMixedIncomeEarner?: boolean;
  engineCode: string;
  engineName: string;
  legalFramework: string;
  incomeTax: {
    form: string;
    rateDescription: string;
    formulaType: string;
    annualFilingDeadline: string;
    quarterlyFilingDeadlines: string[];
    applicableTaxBasis: string;
    isMixedIncomeEarner?: boolean;
    eightPercentDetails?: {
      isEligible: boolean;
      statutoryDeductionCentavos: number;
      statutoryDeduction: number;
      businessTaxRate: number;
      businessTaxRatePercentage: string;
      compensationTreatment: string;
      rulesSummary: string;
    };
  };
  vatOrPercentageTax: {
    form: string;
    regime: 'VAT' | 'PERCENTAGE_TAX' | 'EXEMPT';
    isVatRegistered: boolean;
    isPercentageTaxRegistered: boolean;
    defaultRate: number;
    filingDeadline: string;
    isSlspRequired: boolean;
  };
  withholdingTaxes: {
    expandedWithholdingTaxForm: string;
    withholdingCertificateForm: string;
    finalWithholdingTaxForm: string;
    monthlyRemittanceDeadline: string;
    quarterlyRemittanceDeadline: string;
    cwtAssetAccountCode: string;
    ewtPayableAccountCode: string;
  };
  invoiceAndReceiptCompliance: {
    headerBadge: string;
    mandatoryNotice: string;
    governingRegulations: string;
    inputVatHandling: string;
  };
  applicableAuditChecks: Array<{
    checkId: string;
    ruleDescription: string;
    status: string;
  }>;
  authoritativeSource: string;
}

export interface Calculate8PercentIncomeTaxParams {
  companyId: string;
  grossSalesCentavos?: number;
  grossSales?: number;
  grossBusinessSalesCentavos?: number;
  grossBusinessSales?: number;
  grossCompensationIncomeCentavos?: number;
  grossCompensationIncome?: number;
  isMixedIncomeEarner?: boolean;
  startDate?: string;
  endDate?: string;
}

export interface EightPercentIncomeTaxToolResult {
  companyId: string;
  companyName?: string;
  taxpayerClassification: string;
  taxpayerClassificationLabel: string;
  vatStatus: string;
  vatStatusLabel: string;
  isMixedIncomeEarner: boolean;
  isEligible: boolean;
  disqualificationReason?: string;
  period: {
    startDate?: string;
    endDate?: string;
    label: string;
  };
  businessIncome: {
    grossSalesCentavos: number;
    grossSales: number;
    statutoryDeductionCentavos: number; // 0 for mixed-income earner; 25,000,000 for pure self-employed
    statutoryDeduction: number;
    taxableBaseCentavos: number;
    taxableBase: number;
    taxRate: number;
    taxRatePercentage: string;
    taxDueCentavos: number;
    taxDue: number;
    notes: string;
  };
  compensationIncome?: {
    grossCompensationCentavos: number;
    grossCompensation: number;
    statutoryExemptionCentavos: number; // 25,000,000 (P250k under graduated table)
    statutoryExemption: number;
    taxableCompensationBaseCentavos: number;
    taxableCompensationBase: number;
    taxDueCentavos: number;
    taxDue: number;
    bracketDescription: string;
    notes: string;
  };
  totalIncomeTaxDueCentavos: number;
  totalIncomeTaxDue: number;
  applicableForm: string;
  percentageTaxTreatment: string;
  legalFramework: string;
  authoritativeSource: string;
}

export type CalculateIncomeTaxParams = Calculate8PercentIncomeTaxParams;
export type IncomeTaxCalculationResult = EightPercentIncomeTaxToolResult;

/**
 * Calculates VAT Payable using the authoritative Philippine Tax Engine rules.
 */
export async function getVatPayable(params: GetVatPayableParams): Promise<VatPayableResult> {
  const { companyId, startDate, endDate } = params;
  if (!companyId) {
    throw new Error('companyId is required to calculate VAT payable');
  }

  // 1. Fetch Company Master & Tax Profile Rules
  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  const rules = await PhilippineTaxEngine.getEngineRulesForCompany(companyId);

  // 2. Fetch Posted Sales Invoices in Period
  const invoiceConditions = [
    eq(schema.salesInvoices.companyId, companyId),
    eq(schema.salesInvoices.status, 'POSTED')
  ];
  if (startDate) invoiceConditions.push(gte(schema.salesInvoices.invoiceDate, startDate));
  if (endDate) invoiceConditions.push(lte(schema.salesInvoices.invoiceDate, endDate));

  const postedInvoices = await db.select().from(schema.salesInvoices).where(and(...invoiceConditions));
  const grossSalesCentavos = postedInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

  // 3. Fetch Posted Purchase Bills in Period
  const billConditions = [
    eq(schema.purchaseBills.companyId, companyId),
    eq(schema.purchaseBills.status, 'POSTED')
  ];
  if (startDate) billConditions.push(gte(schema.purchaseBills.billDate, startDate));
  if (endDate) billConditions.push(lte(schema.purchaseBills.billDate, endDate));

  const postedBills = await db.select().from(schema.purchaseBills).where(and(...billConditions));
  const grossPurchasesCentavos = postedBills.reduce((sum, bill) => sum + (bill.totalAmount || 0), 0);

  // 4. Calculate Authoritative Output VAT and Input VAT using PhilippineTaxEngine
  let taxableSalesBaseCentavos = 0;
  let outputVatCentavos = 0;
  let taxablePurchasesBaseCentavos = 0;
  let creditableInputVatCentavos = 0;

  if (rules.isVatRegistered && rules.defaultVatRate > 0) {
    const salesVat = PhilippineTaxEngine.calculateVat(grossSalesCentavos, rules.defaultVatRate);
    taxableSalesBaseCentavos = salesVat.taxBase;
    outputVatCentavos = salesVat.vatAmount;

    // Check if input VAT is creditable under engine rules
    if (rules.ledgerPostingRules.purchasesInputVatHandling === 'CREDITABLE_INPUT_VAT') {
      const purchasesVat = PhilippineTaxEngine.calculateVat(grossPurchasesCentavos, rules.defaultVatRate);
      taxablePurchasesBaseCentavos = purchasesVat.taxBase;
      creditableInputVatCentavos = purchasesVat.vatAmount;
    } else {
      taxablePurchasesBaseCentavos = grossPurchasesCentavos;
      creditableInputVatCentavos = 0;
    }
  } else {
    taxableSalesBaseCentavos = grossSalesCentavos;
    outputVatCentavos = 0;
    taxablePurchasesBaseCentavos = grossPurchasesCentavos;
    creditableInputVatCentavos = 0;
  }

  const netVatPayableCentavos = outputVatCentavos - creditableInputVatCentavos;

  let status: 'TAX_PAYABLE' | 'EXCESS_INPUT_VAT' | 'ZERO_TAX' = 'ZERO_TAX';
  if (netVatPayableCentavos > 0) {
    status = 'TAX_PAYABLE';
  } else if (netVatPayableCentavos < 0) {
    status = 'EXCESS_INPUT_VAT';
  }

  const periodLabel = startDate && endDate 
    ? `${startDate} to ${endDate}` 
    : startDate 
      ? `From ${startDate}` 
      : endDate 
        ? `Up to ${endDate}` 
        : 'All Transactions (Cumulative)';

  return {
    companyId,
    companyName: company?.legalName || company?.tradeName || undefined,
    isVatRegistered: rules.isVatRegistered,
    taxpayerClassification: rules.taxpayerClassification,
    taxpayerClassificationLabel: rules.taxpayerClassificationLabel,
    vatStatus: rules.vatStatus,
    vatStatusLabel: rules.vatStatusLabel,
    period: {
      startDate,
      endDate,
      label: periodLabel
    },
    grossSalesCentavos,
    grossSales: grossSalesCentavos / 100,
    taxableSalesBaseCentavos,
    taxableSalesBase: taxableSalesBaseCentavos / 100,
    outputVatCentavos,
    outputVat: outputVatCentavos / 100,
    grossPurchasesCentavos,
    grossPurchases: grossPurchasesCentavos / 100,
    taxablePurchasesBaseCentavos,
    taxablePurchasesBase: taxablePurchasesBaseCentavos / 100,
    creditableInputVatCentavos,
    creditableInputVat: creditableInputVatCentavos / 100,
    netVatPayableCentavos,
    netVatPayable: netVatPayableCentavos / 100,
    applicableForm: rules.vatOrPercentageForm,
    isSlspRequired: rules.isSlspRequired,
    engineCode: rules.engineCode,
    legalFramework: rules.legalFramework,
    invoiceCount: postedInvoices.length,
    billCount: postedBills.length,
    status,
    authoritativeSource: 'PhilippineTaxEngine (CREATE Act & Ease of Paying Taxes Act RR 7-2024)'
  };
}

/**
 * Calculates Percentage Tax using the authoritative Philippine Tax Engine rules.
 */
export async function getPercentageTax(params: GetPercentageTaxParams): Promise<PercentageTaxResult> {
  const { companyId, startDate, endDate } = params;
  if (!companyId) {
    throw new Error('companyId is required to calculate percentage tax');
  }

  // 1. Fetch Company Master & Tax Profile Rules
  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  const rules = await PhilippineTaxEngine.getEngineRulesForCompany(companyId);

  // 2. Fetch Posted Sales Invoices in Period
  const invoiceConditions = [
    eq(schema.salesInvoices.companyId, companyId),
    eq(schema.salesInvoices.status, 'POSTED')
  ];
  if (startDate) invoiceConditions.push(gte(schema.salesInvoices.invoiceDate, startDate));
  if (endDate) invoiceConditions.push(lte(schema.salesInvoices.invoiceDate, endDate));

  const postedInvoices = await db.select().from(schema.salesInvoices).where(and(...invoiceConditions));
  const grossSalesCentavos = postedInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

  // 3. Determine Applicable Rate and Tax Type
  let taxRate = 0.03;
  let taxType = 'PERCENTAGE_3';
  let isExempt = false;
  let exemptionNotes: string | undefined = undefined;

  if (rules.isPercentageTaxRegistered) {
    if (rules.vatStatus === 'PERCENTAGE_CARRIER') {
      taxRate = 0.03;
      taxType = 'COMMON_CARRIER_3';
    } else if (rules.vatStatus === 'PERCENTAGE_FRANCHISE') {
      taxRate = 0.03;
      taxType = 'FRANCHISE_TAX';
    } else if (rules.vatStatus === 'PERCENTAGE_BANK_GRT') {
      taxRate = 0.05;
      taxType = 'GROSS_RECEIPTS_TAX';
    } else if (rules.vatStatus === 'PERCENTAGE_AMUSEMENT') {
      taxRate = 0.18;
      taxType = 'AMUSEMENT_TAX';
    } else {
      taxRate = PhilippineTaxEngine.getSection116Rate(endDate || startDate);
      taxType = taxRate === 0.01 ? 'PERCENTAGE_1_CREATE' : 'PERCENTAGE_3';
    }
  } else if (rules.isBmbeExempt) {
    taxRate = 0.0;
    taxType = 'BMBE_EXEMPT';
    isExempt = true;
    exemptionNotes = 'Exempt from Section 116 Percentage Tax pursuant to Barangay Micro Business Enterprises (BMBE) Act (RA 9178).';
  } else if (rules.vatStatus === 'INDIVIDUAL_8PERCENT_VAT') {
    taxRate = 0.0;
    taxType = 'INDIVIDUAL_8PERCENT_EXEMPT';
    isExempt = true;
    exemptionNotes = 'Exempt from Section 116 Percentage Tax; subject to 8% Flat Income Tax Option (TRAIN Act RR 8-2018).';
  } else if (rules.isVatRegistered) {
    taxRate = 0.0;
    taxType = 'VAT_REGISTERED_EXEMPT_FROM_PT';
    isExempt = true;
    exemptionNotes = 'Company is registered under 12% Value-Added Tax (Form 2550Q) and is therefore not subject to Section 116 Percentage Tax.';
  } else {
    taxRate = 0.0;
    taxType = 'SPECIAL_EXEMPT';
    isExempt = true;
    exemptionNotes = rules.invoiceNotice || 'Exempt from Section 116 percentage tax.';
  }

  // 4. Calculate Authoritative Percentage Tax
  const percentageTaxPayableCentavos = isExempt ? 0 : PhilippineTaxEngine.calculatePercentage(grossSalesCentavos, taxRate);

  const periodLabel = startDate && endDate 
    ? `${startDate} to ${endDate}` 
    : startDate 
      ? `From ${startDate}` 
      : endDate 
        ? `Up to ${endDate}` 
        : 'All Transactions (Cumulative)';

  return {
    companyId,
    companyName: company?.legalName || company?.tradeName || undefined,
    isPercentageTaxRegistered: rules.isPercentageTaxRegistered,
    taxpayerClassification: rules.taxpayerClassification,
    taxpayerClassificationLabel: rules.taxpayerClassificationLabel,
    vatStatus: rules.vatStatus,
    vatStatusLabel: rules.vatStatusLabel,
    period: {
      startDate,
      endDate,
      label: periodLabel
    },
    grossSalesCentavos,
    grossSales: grossSalesCentavos / 100,
    taxRate,
    taxRatePercentage: `${(taxRate * 100).toFixed(2)}%`,
    taxType,
    percentageTaxPayableCentavos,
    percentageTaxPayable: percentageTaxPayableCentavos / 100,
    applicableForm: rules.vatOrPercentageForm,
    legalBasis: rules.legalFramework,
    engineCode: rules.engineCode,
    invoiceCount: postedInvoices.length,
    isExempt,
    exemptionNotes,
    authoritativeSource: 'PhilippineTaxEngine (Sec 116 NIRC / Form 2551Q Engine)'
  };
}

/**
 * Retrieves authoritative BIR Tax Filing Requirements and Schedules.
 */
export async function getTaxFilingRequirements(params: GetTaxFilingRequirementsParams): Promise<TaxFilingRequirementsResult> {
  const { companyId, isMixedIncomeEarner } = params;
  if (!companyId) {
    throw new Error('companyId is required to retrieve tax filing requirements');
  }

  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  const profile = await db.select().from(schema.companyTaxProfiles).where(eq(schema.companyTaxProfiles.companyId, companyId)).get();

  let isMixed = isMixedIncomeEarner;
  if (isMixed === undefined && profile?.registrationInformation) {
    try {
      const reg = JSON.parse(profile.registrationInformation);
      if (typeof reg.isMixedIncomeEarner === 'boolean') {
        isMixed = reg.isMixedIncomeEarner;
      }
    } catch (e) {}
  }

  const rules = await PhilippineTaxEngine.getEngineRulesForCompany(companyId, { isMixedIncomeEarner: isMixed });
  const auditReport = await PhilippineTaxEngine.runAuditGuardian(companyId);

  let regime: 'VAT' | 'PERCENTAGE_TAX' | 'EXEMPT' = 'VAT';
  if (rules.isVatRegistered) {
    regime = 'VAT';
  } else if (rules.isPercentageTaxRegistered) {
    regime = 'PERCENTAGE_TAX';
  } else {
    regime = 'EXEMPT';
  }

  const annualIncomeTaxDeadline = rules.taxpayerClassification === 'INDIVIDUAL' || rules.taxpayerClassification === 'INDIVIDUAL_8PERCENT'
    ? isMixed
      ? 'April 15 following the close of the calendar year (BIR Form 1701 for Mixed-Income Earners)'
      : 'April 15 following the close of the calendar year (BIR Form 1701A for Pure Business / Form 1701)'
    : '15th day of the 4th month following the close of the fiscal/calendar year (BIR Form 1702-RT / 1702-EX)';

  const quarterlyIncomeTaxDeadlines = [
    'Q1: May 15 following the close of Q1 (BIR Form 1701Q / 1702Q)',
    'Q2: August 15 following the close of Q2 (BIR Form 1701Q / 1702Q)',
    'Q3: November 15 following the close of Q3 (BIR Form 1701Q / 1702Q)'
  ];

  const vatOrPercentageDeadline = rules.isVatRegistered
    ? '25th day of the month following the close of the taxable quarter (BIR Form 2550Q)'
    : rules.isPercentageTaxRegistered
      ? '25th day of the month following the close of the taxable quarter (BIR Form 2551Q)'
      : 'Quarterly compliance exemption filing / Annual Information Return';

  // Specific 8% details for individual / sole proprietor
  let eightPercentDetails: TaxFilingRequirementsResult['incomeTax']['eightPercentDetails'] = undefined;
  if (rules.taxpayerClassification === 'INDIVIDUAL_8PERCENT' || rules.vatStatus === 'INDIVIDUAL_8PERCENT_VAT') {
    const isEligible = rules.qualifiesFor8Percent !== false;
    const statutoryDeductionCentavos = isMixed ? 0 : 25_000_000;
    eightPercentDetails = {
      isEligible,
      statutoryDeductionCentavos,
      statutoryDeduction: statutoryDeductionCentavos / 100,
      businessTaxRate: 0.08,
      businessTaxRatePercentage: '8%',
      compensationTreatment: isMixed
        ? 'Subject to graduated individual income tax rates under Section 24(A)(2)(a) NIRC. The statutory ₱250,000 exemption is applied exclusively to compensation income.'
        : 'N/A (Purely self-employed / professional with no compensation income reported)',
      rulesSummary: isMixed
        ? 'Mixed-Income Earner: 8% preferential tax rate applies only to gross business/professional income from the 1st peso (no ₱250,000 deduction on business income). The ₱250,000 exemption is applied exclusively to compensation income under graduated rates (BIR RR 8-2018 Sec. 3(B)(2)).'
        : 'Purely Self-Employed: 8% preferential tax rate applies to gross sales/receipts in excess of statutory ₱250,000 deduction. In lieu of graduated tax and 3% percentage tax.'
    };
  }

  return {
    companyId,
    companyName: company?.legalName || company?.tradeName || undefined,
    tin: company?.tin || undefined,
    taxpayerClassification: rules.taxpayerClassification,
    taxpayerClassificationLabel: rules.taxpayerClassificationLabel,
    vatStatus: rules.vatStatus,
    vatStatusLabel: rules.vatStatusLabel,
    isMixedIncomeEarner: isMixed,
    engineCode: rules.engineCode,
    engineName: rules.engineName,
    legalFramework: rules.legalFramework,
    incomeTax: {
      form: isMixed && (rules.taxpayerClassification === 'INDIVIDUAL_8PERCENT' || rules.vatStatus === 'INDIVIDUAL_8PERCENT_VAT')
        ? 'BIR Form 1701 (Mixed-Income Return: Graduated for Compensation + 8% Flat for Business)'
        : rules.incomeTaxForm,
      rateDescription: rules.incomeTaxRateDescription,
      formulaType: rules.incomeTaxFormulaType,
      annualFilingDeadline: annualIncomeTaxDeadline,
      quarterlyFilingDeadlines: quarterlyIncomeTaxDeadlines,
      applicableTaxBasis: rules.incomeTaxRateDescription,
      isMixedIncomeEarner: isMixed,
      eightPercentDetails
    },
    vatOrPercentageTax: {
      form: rules.vatOrPercentageForm,
      regime,
      isVatRegistered: rules.isVatRegistered,
      isPercentageTaxRegistered: rules.isPercentageTaxRegistered,
      defaultRate: rules.defaultVatRate,
      filingDeadline: vatOrPercentageDeadline,
      isSlspRequired: rules.isSlspRequired
    },
    withholdingTaxes: {
      expandedWithholdingTaxForm: rules.ewtForm,
      withholdingCertificateForm: rules.withholdingCertForm,
      finalWithholdingTaxForm: 'BIR Form 1601-FQ (Quarterly Remittance of Final Withholding Taxes) / Form 0619F',
      monthlyRemittanceDeadline: '10th day of the following month (15th for eFPS users) - Forms 0619E / 0619F',
      quarterlyRemittanceDeadline: 'Last day of the month following the close of the quarter - Forms 1601-EQ / 1601-FQ',
      cwtAssetAccountCode: rules.ledgerPostingRules.cwt2307AssetAccountCode,
      ewtPayableAccountCode: rules.ledgerPostingRules.ewtPayableAccountCode
    },
    invoiceAndReceiptCompliance: {
      headerBadge: rules.invoiceHeaderBadge,
      mandatoryNotice: rules.invoiceNotice,
      governingRegulations: 'Ease of Paying Taxes (EOPT) Act (RA 11976) & BIR RR 7-2024',
      inputVatHandling: rules.ledgerPostingRules.purchasesInputVatHandling
    },
    applicableAuditChecks: auditReport.auditResults.map(r => ({
      checkId: r.checkId,
      ruleDescription: r.ruleDescription,
      status: r.status
    })),
    authoritativeSource: 'PhilippineTaxEngine (NIRC, CREATE Act, EOPT Act RR 7-2024)'
  };
}

/**
 * Calculates 8% Preferential Flat Income Tax and Consolidated Income Tax for Individuals.
 * - Purely Self-Employed: Deducts statutory ₱250,000 from gross business sales/receipts.
 * - Mixed-Income Earners: 8% preferential rate applies ONLY to business income (from 1st peso); 
 *   the ₱250,000 statutory exemption is maintained exclusively for compensation income under graduated rates.
 */
export async function calculate8PercentIncomeTax(params: Calculate8PercentIncomeTaxParams): Promise<EightPercentIncomeTaxToolResult> {
  const { companyId, startDate, endDate } = params;
  if (!companyId) {
    throw new Error('companyId is required to calculate income tax');
  }

  // 1. Fetch Company Master & Tax Profile
  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  const profile = await db.select().from(schema.companyTaxProfiles).where(eq(schema.companyTaxProfiles.companyId, companyId)).get();

  // 2. Resolve Compensation Income
  let compensationCentavos = 0;
  if (params.grossCompensationIncomeCentavos !== undefined) {
    compensationCentavos = params.grossCompensationIncomeCentavos;
  } else if (params.grossCompensationIncome !== undefined) {
    compensationCentavos = Math.round(params.grossCompensationIncome * 100);
  }

  // 3. Determine Mixed-Income Earner status
  let isMixedIncome = params.isMixedIncomeEarner;
  if (isMixedIncome === undefined) {
    if (compensationCentavos > 0) {
      isMixedIncome = true;
    } else if (profile?.registrationInformation) {
      try {
        const reg = JSON.parse(profile.registrationInformation);
        if (typeof reg.isMixedIncomeEarner === 'boolean') {
          isMixedIncome = reg.isMixedIncomeEarner;
        }
      } catch (e) {}
    }
  }
  isMixedIncome = !!isMixedIncome;

  const rules = await PhilippineTaxEngine.getEngineRulesForCompany(companyId, { isMixedIncomeEarner: isMixedIncome });

  // 4. Determine Gross Business Sales
  let grossSalesCentavos = 0;
  if (params.grossSalesCentavos !== undefined) {
    grossSalesCentavos = params.grossSalesCentavos;
  } else if (params.grossBusinessSalesCentavos !== undefined) {
    grossSalesCentavos = params.grossBusinessSalesCentavos;
  } else if (params.grossSales !== undefined) {
    grossSalesCentavos = Math.round(params.grossSales * 100);
  } else if (params.grossBusinessSales !== undefined) {
    grossSalesCentavos = Math.round(params.grossBusinessSales * 100);
  } else {
    const invoiceConditions = [
      eq(schema.salesInvoices.companyId, companyId),
      eq(schema.salesInvoices.status, 'POSTED')
    ];
    if (startDate) invoiceConditions.push(gte(schema.salesInvoices.invoiceDate, startDate));
    if (endDate) invoiceConditions.push(lte(schema.salesInvoices.invoiceDate, endDate));

    const postedInvoices = await db.select().from(schema.salesInvoices).where(and(...invoiceConditions));
    grossSalesCentavos = postedInvoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
  }

  // 5. Calculate 8% Flat Tax on Business Income using authoritative engine
  const eightPercentCalc = PhilippineTaxEngine.calculate8PercentIncomeTax(grossSalesCentavos, {
    isMixedIncomeEarner: isMixedIncome,
    taxpayerClassification: rules.taxpayerClassification
  });

  // 6. Calculate Compensation Income Tax (Graduated Rates under Section 24(A)(2)(a))
  let compensationResult: EightPercentIncomeTaxToolResult['compensationIncome'] | undefined = undefined;
  let compensationTaxDueCentavos = 0;

  if (isMixedIncome || compensationCentavos > 0) {
    const compGraduated = PhilippineTaxEngine.calculateCompensationGraduatedTax(compensationCentavos);
    compensationTaxDueCentavos = compGraduated.taxDueCentavos;
    compensationResult = {
      grossCompensationCentavos: compensationCentavos,
      grossCompensation: compensationCentavos / 100,
      statutoryExemptionCentavos: compGraduated.statutoryExemptionCentavos,
      statutoryExemption: compGraduated.statutoryExemption,
      taxableCompensationBaseCentavos: compensationCentavos,
      taxableCompensationBase: compensationCentavos / 100,
      taxDueCentavos: compensationTaxDueCentavos,
      taxDue: compensationTaxDueCentavos / 100,
      bracketDescription: compGraduated.bracketDescription,
      notes: 'Compensation income is subject to graduated individual income tax rates under Section 24(A)(2)(a) NIRC. The statutory ₱250,000 exemption is applied exclusively to compensation income (0% initial tax bracket).'
    };
  }

  const totalIncomeTaxDueCentavos = eightPercentCalc.taxDueCentavos + compensationTaxDueCentavos;

  const periodLabel = startDate && endDate 
    ? `${startDate} to ${endDate}` 
    : startDate 
      ? `From ${startDate}` 
      : endDate 
        ? `Up to ${endDate}` 
        : 'All Transactions (Cumulative / Annual)';

  const applicableForm = isMixedIncome
    ? 'BIR Form 1701 (Annual Income Tax Return for Mixed Income Earners: Compensation under Graduated Rates + Business under 8% Flat Rate)'
    : 'BIR Form 1701A (Annual Income Tax Return for Purely Business/Professional Individuals under 8% Flat Rate)';

  return {
    companyId,
    companyName: company?.legalName || company?.tradeName || undefined,
    taxpayerClassification: rules.taxpayerClassification,
    taxpayerClassificationLabel: rules.taxpayerClassificationLabel,
    vatStatus: rules.vatStatus,
    vatStatusLabel: rules.vatStatusLabel,
    isMixedIncomeEarner: isMixedIncome,
    isEligible: eightPercentCalc.isEligible,
    disqualificationReason: eightPercentCalc.disqualificationReason,
    period: {
      startDate,
      endDate,
      label: periodLabel
    },
    businessIncome: {
      grossSalesCentavos: eightPercentCalc.grossSalesCentavos,
      grossSales: eightPercentCalc.grossSales,
      statutoryDeductionCentavos: eightPercentCalc.statutoryDeductionCentavos,
      statutoryDeduction: eightPercentCalc.statutoryDeduction,
      taxableBaseCentavos: eightPercentCalc.taxableBaseCentavos,
      taxableBase: eightPercentCalc.taxableBase,
      taxRate: eightPercentCalc.taxRate,
      taxRatePercentage: `${(eightPercentCalc.taxRate * 100).toFixed(0)}%`,
      taxDueCentavos: eightPercentCalc.taxDueCentavos,
      taxDue: eightPercentCalc.taxDue,
      notes: eightPercentCalc.notes
    },
    compensationIncome: compensationResult,
    totalIncomeTaxDueCentavos,
    totalIncomeTaxDue: totalIncomeTaxDueCentavos / 100,
    applicableForm,
    percentageTaxTreatment: 'Exempt from Section 116 (3%) Percentage Tax pursuant to TRAIN Law RA 10963 & BIR RR 8-2018',
    legalFramework: 'TRAIN Law (RA 10963) Sec 24(A)(2)(b) & BIR RR 8-2018 & RR 16-2023',
    authoritativeSource: 'PhilippineTaxEngine (Individual 8% Flat Income Tax & Mixed Income Protocol)'
  };
}

export const calculateIncomeTax = calculate8PercentIncomeTax;
export const getIncomeTaxPayable = calculate8PercentIncomeTax;

export const taxTools = {
  getVatPayable,
  getPercentageTax,
  getTaxFilingRequirements,
  calculate8PercentIncomeTax,
  calculateIncomeTax,
  getIncomeTaxPayable
};
