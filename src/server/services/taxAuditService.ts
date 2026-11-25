import { db } from '../db';
import * as schema from '../db/schema';
import { eq, and, gte, lte, sql, like, or } from 'drizzle-orm';
import { TaxEngine } from './taxEngine';
import { BirComplianceService } from './birComplianceService';
import { AlphalistService } from './alphalistService';
import { getBirTaxProfileRules, BirTaxEngineDriverRules } from '../../shared/taxProfile';

export interface TaxException {
  code:
    | 'MISSING_TIN'
    | 'INVALID_TIN_FORMAT'
    | 'MISSING_ATC'
    | 'INVALID_ATC_CODE'
    | 'INCORRECT_TAX_CLASSIFICATION'
    | 'MISSING_WITHHOLDING_CERTIFICATE_2307'
    | 'DUPLICATE_TAX_ENTRY'
    | 'PERIOD_MISMATCH'
    | 'UNRECONCILED_TAX_BALANCE'
    | 'MISSING_SUPPORTING_DOCUMENT';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  entityType: 'SALES_INVOICE' | 'PURCHASE_BILL' | 'CUSTOMER' | 'VENDOR' | 'TAX_FILING' | 'JOURNAL_ENTRY';
  entityId: string;
  referenceNo: string;
  description: string;
  taxableAmountCentavos?: number;
  taxAmountCentavos?: number;
  suggestedCorrection: string;
}

export interface GlTaxReconciliationResult {
  companyId: string;
  period: string; // YYYY-MM or YYYY-Qx
  outputVat: {
    subledgerTaxBaseCentavos: number;
    subledgerOutputVatCentavos: number;
    glCreditBalanceCentavos: number;
    varianceCentavos: number;
    isBalanced: boolean;
  };
  inputVat: {
    subledgerTaxBaseCentavos: number;
    subledgerInputVatCentavos: number;
    glDebitBalanceCentavos: number;
    varianceCentavos: number;
    isBalanced: boolean;
  };
  ewtWithholding: {
    subledgerBaseCentavos: number;
    subledgerEwtCentavos: number;
    glCreditBalanceCentavos: number;
    varianceCentavos: number;
    isBalanced: boolean;
  };
  cwtCertificates: {
    subledgerBaseCentavos: number;
    subledgerCwtCentavos: number;
    glDebitBalanceCentavos: number;
    varianceCentavos: number;
    isBalanced: boolean;
  };
  overallBalanced: boolean;
}

export interface BirFormApplicability {
  formCode: string;
  formName: string;
  isApplicable: boolean;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'PER_TRANSACTION';
  statutoryDeadline: string;
  reason: string;
  underlyingRules: string;
}

export class TaxAuditService {
  /**
   * Returns authoritative BIR Form Applicability Matrix based on company tax classification & registration
   */
  public static getFormApplicability(
    taxpayerClassification: string = 'CORPORATION',
    vatStatus: string = 'VAT',
    options: { isMixedIncomeEarner?: boolean } = {}
  ): BirFormApplicability[] {
    const rules = getBirTaxProfileRules(taxpayerClassification, vatStatus, options);

    const isCorp = ['CORPORATION', 'OPC', 'PARTNERSHIP', 'GOCC', 'RFC', 'NRFC', 'JOINT_VENTURE'].includes(taxpayerClassification);
    const isIndiv = ['INDIVIDUAL', 'INDIVIDUAL_8PERCENT', 'ESTATE_TRUST'].includes(taxpayerClassification);
    const is8Percent = taxpayerClassification === 'INDIVIDUAL_8PERCENT' || vatStatus === 'INDIVIDUAL_8PERCENT_VAT';
    const isVat = rules.isVatRegistered;
    const isPercentage = rules.isPercentageTaxRegistered;

    return [
      {
        formCode: '2550Q',
        formName: 'Quarterly Value-Added Tax Return',
        isApplicable: isVat && !is8Percent && !rules.isVatExempt,
        frequency: 'QUARTERLY',
        statutoryDeadline: '25th day following the close of each taxable quarter',
        reason: isVat && !is8Percent ? 'Taxpayer is registered under Value-Added Tax regime (RMC 5-2023 / Sec 106 & 108 NIRC).' : 'Not applicable: Taxpayer is Non-VAT, 8% Flat Tax, or VAT-Exempt.',
        underlyingRules: 'NIRC Section 114, BIR RMC 5-2023 & TRAIN Law RA 10963'
      },
      {
        formCode: '2550M',
        formName: 'Monthly Value-Added Tax Declaration (Optional Monthly Election)',
        isApplicable: isVat && !is8Percent && !rules.isVatExempt,
        frequency: 'MONTHLY',
        statutoryDeadline: '20th day following the close of each taxable month (optional per RMC 52-2023)',
        reason: isVat && !is8Percent ? 'Optional monthly VAT filing remains available to VAT-registered taxpayers under BIR RMC 52-2023 alongside quarterly Form 2550Q.' : 'Not applicable: Taxpayer is Non-VAT, 8% Flat Tax, or VAT-Exempt.',
        underlyingRules: 'BIR RMC No. 52-2023 & RMC No. 5-2023'
      },
      {
        formCode: '2551Q',
        formName: 'Quarterly Percentage Tax Return',
        isApplicable: isPercentage && !is8Percent,
        frequency: 'QUARTERLY',
        statutoryDeadline: '25th day following the close of each taxable quarter',
        reason: isPercentage && !is8Percent ? 'Taxpayer is subject to Section 116 Percentage Tax.' : 'Not applicable: Taxpayer is VAT-registered, 8% Flat Rate, or Exempt.',
        underlyingRules: 'NIRC Section 116 (3% / CREATE Act 1% window) & TRAIN Law'
      },
      {
        formCode: '1701',
        formName: 'Annual Income Tax Return for Individuals (Graduated Rates / Mixed Income)',
        isApplicable: isIndiv && (!is8Percent || !!options.isMixedIncomeEarner),
        frequency: 'ANNUAL',
        statutoryDeadline: 'April 15 following the close of the calendar year',
        reason: isIndiv && (!is8Percent || options.isMixedIncomeEarner) ? 'Applicable for individual taxpayers on graduated income tax rates or mixed-income earners.' : 'Not applicable to corporate entities or purely self-employed 8% taxpayers.',
        underlyingRules: 'NIRC Section 24(A)(2)(a) & TRAIN Law RA 10963'
      },
      {
        formCode: '1701A',
        formName: 'Annual Income Tax Return for Individuals Earning Income Purely from Business/Profession (8% or OSD)',
        isApplicable: isIndiv && is8Percent && !options.isMixedIncomeEarner,
        frequency: 'ANNUAL',
        statutoryDeadline: 'April 15 following the close of the calendar year',
        reason: is8Percent && !options.isMixedIncomeEarner ? 'Applicable for purely self-employed individual professionals under the 8% flat tax option.' : 'Not applicable: Entity is a Corporation or Mixed-Income Earner.',
        underlyingRules: 'TRAIN Law Sec 24(A)(2)(b) & RR 8-2018'
      },
      {
        formCode: '1702-RT',
        formName: 'Annual Income Tax Return for Corporations Subject Only to Regular Income Tax Rate',
        isApplicable: isCorp && rules.incomeTaxFormulaType === 'CORPORATE_CREATE',
        frequency: 'ANNUAL',
        statutoryDeadline: '15th day of the 4th month following the close of the taxable year',
        reason: isCorp && rules.incomeTaxFormulaType === 'CORPORATE_CREATE' ? 'Applicable for regular domestic corporations under CREATE Act 25% or 20% MSME rate.' : 'Not applicable to individual taxpayers, cooperatives, or PEZA entities.',
        underlyingRules: 'CREATE Act RA 11534 & NIRC Sec 27'
      },
      {
        formCode: '1702-EX',
        formName: 'Annual Income Tax Return for Corporations Exempt Under the NIRC and Other Special Laws',
        isApplicable: ['COOPERATIVE', 'NON_PROFIT', 'GPP'].includes(taxpayerClassification) || rules.incomeTaxFormulaType === 'COOP_RA9520_EXEMPT' || rules.incomeTaxFormulaType === 'PASS_THROUGH_EXEMPT',
        frequency: 'ANNUAL',
        statutoryDeadline: '15th day of the 4th month following the close of the taxable year',
        reason: ['COOPERATIVE', 'NON_PROFIT', 'GPP'].includes(taxpayerClassification) ? 'Applicable for tax-exempt entities (CDA Cooperatives, GPPs, Sec 30 Non-Profits).' : 'Not applicable to commercial corporations.',
        underlyingRules: 'RA 9520 / NIRC Sec 26 & Sec 30'
      },
      {
        formCode: '0619-E',
        formName: 'Monthly Remittance Return of Creditable Income Taxes Withheld (Expanded)',
        isApplicable: true,
        frequency: 'MONTHLY',
        statutoryDeadline: '10th day of the following month (15th for eFPS)',
        reason: 'Mandatory monthly withholding tax remittance for Expanded Withholding Tax (EWT) for 1st and 2nd months of quarter.',
        underlyingRules: 'RR 2-98 & RR 11-2018'
      },
      {
        formCode: '1601-EQ',
        formName: 'Quarterly Remittance Return of Creditable Income Taxes Withheld (Expanded)',
        isApplicable: true,
        frequency: 'QUARTERLY',
        statutoryDeadline: 'Last day of the month following the close of the quarter',
        reason: 'Mandatory quarterly summary remittance return for Expanded Withholding Tax.',
        underlyingRules: 'RR 11-2018'
      },
      {
        formCode: '1601-C',
        formName: 'Monthly Remittance Return of Income Taxes Withheld on Compensation',
        isApplicable: true,
        frequency: 'MONTHLY',
        statutoryDeadline: '10th day of the following month (15th for eFPS)',
        reason: 'Required for employers withholding income tax on employee compensation.',
        underlyingRules: 'NIRC Sec 79 & RR 2-98'
      },
      {
        formCode: '1604-E',
        formName: 'Annual Information Return of Creditable Income Taxes Withheld (Expanded)/Optionally Final',
        isApplicable: true,
        frequency: 'ANNUAL',
        statutoryDeadline: 'March 1 following the close of the calendar year',
        reason: 'Mandatory annual information return detailing all payees subjected to withholding tax during the year.',
        underlyingRules: 'RR 2-98 & RR 11-2018'
      },
      {
        formCode: '2307',
        formName: 'Certificate of Creditable Tax Withheld at Source',
        isApplicable: true,
        frequency: 'PER_TRANSACTION',
        statutoryDeadline: '20th day following the close of the quarter or upon payment/request',
        reason: 'Mandatory statutory tax certificate issued to payees detailing creditable income tax withheld.',
        underlyingRules: 'NIRC Sec 58 & RR 2-98'
      },
      {
        formCode: 'SLSP',
        formName: 'Summary List of Sales, Purchases and Imports (SLS / SLP / SLI)',
        isApplicable: isVat && !is8Percent,
        frequency: 'QUARTERLY',
        statutoryDeadline: '25th day following the close of each taxable quarter',
        reason: isVat && !is8Percent ? 'Mandatory quarterly electronic attachment for VAT-registered taxpayers.' : 'Exempt: Non-VAT or 8% Flat Rate taxpayer.',
        underlyingRules: 'RR 1-2012 & EOPT Act'
      }
    ];
  }

  /**
   * Deep GL-to-Tax Subledger Reconciliation
   */
  public static async reconcileGlWithTaxLedger(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<GlTaxReconciliationResult> {
    const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const rules = getBirTaxProfileRules(company?.taxpayerClassification, company?.vatStatus);
    const isVatTaxpayer = rules.isVatRegistered && rules.defaultVatRate > 0;

    // 1. Posted Sales Invoices Output VAT (prefer stored taxCalculations; otherwise apply company VAT profile)
    const salesInvoices = await db.select({
      id: schema.salesInvoices.id,
      totalAmount: schema.salesInvoices.totalAmount,
      journalEntryId: schema.salesInvoices.journalEntryId,
    })
    .from(schema.salesInvoices)
    .where(
      and(
        eq(schema.salesInvoices.companyId, companyId),
        eq(schema.salesInvoices.status, 'POSTED'),
        gte(schema.salesInvoices.invoiceDate, startDate),
        lte(schema.salesInvoices.invoiceDate, endDate)
      )
    );

    const taxCalcRows = await db.select({
      journalEntryId: schema.taxCalculations.journalEntryId,
      taxBase: schema.taxCalculations.taxBase,
      taxAmount: schema.taxCalculations.taxAmount,
      taxRate: schema.taxCalculations.taxRate,
      taxType: schema.taxCodes.taxType,
      inputOutputDirection: schema.taxCodes.inputOutputDirection,
    })
    .from(schema.taxCalculations)
    .innerJoin(schema.journalEntries, eq(schema.taxCalculations.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.taxCodes, eq(schema.taxCalculations.taxCodeId, schema.taxCodes.id))
    .where(
      and(
        eq(schema.taxCalculations.companyId, companyId),
        eq(schema.taxCalculations.status, 'ACTIVE'),
        eq(schema.journalEntries.status, 'POSTED'),
        gte(schema.journalEntries.entryDate, startDate),
        lte(schema.journalEntries.entryDate, endDate)
      )
    );

    let subledgerSalesGrossCentavos = salesInvoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const salesOutputCalc = taxCalcRows.filter(t => String(t.taxType || '').toUpperCase().includes('VAT') && salesInvoices.some(i => i.journalEntryId === t.journalEntryId));
    let subledgerOutputVatCentavos = 0;
    let subledgerSalesBaseCentavos = subledgerSalesGrossCentavos;
    if (salesOutputCalc.length > 0) {
      subledgerOutputVatCentavos = salesOutputCalc.reduce((s, t) => s + Number(t.taxAmount || 0), 0);
      subledgerSalesBaseCentavos = subledgerSalesGrossCentavos - subledgerOutputVatCentavos;
    } else if (isVatTaxpayer) {
      subledgerOutputVatCentavos = Math.round(subledgerSalesGrossCentavos - (subledgerSalesGrossCentavos / 1.12));
      subledgerSalesBaseCentavos = subledgerSalesGrossCentavos - subledgerOutputVatCentavos;
    }

    // 2. Posted Purchase Bills Input VAT
    const purchaseBills = await db.select({
      id: schema.purchaseBills.id,
      totalAmount: schema.purchaseBills.totalAmount,
      journalEntryId: schema.purchaseBills.journalEntryId,
    })
    .from(schema.purchaseBills)
    .where(
      and(
        eq(schema.purchaseBills.companyId, companyId),
        eq(schema.purchaseBills.status, 'POSTED'),
        gte(schema.purchaseBills.billDate, startDate),
        lte(schema.purchaseBills.billDate, endDate)
      )
    );

    let subledgerPurchasesGrossCentavos = purchaseBills.reduce((s, b) => s + (b.totalAmount || 0), 0);
    const purchaseInputCalc = taxCalcRows.filter(t => String(t.taxType || '').toUpperCase().includes('VAT') && purchaseBills.some(b => b.journalEntryId === t.journalEntryId));
    let subledgerInputVatCentavos = 0;
    let subledgerPurchasesBaseCentavos = subledgerPurchasesGrossCentavos;
    if (purchaseInputCalc.length > 0) {
      subledgerInputVatCentavos = purchaseInputCalc.reduce((s, t) => s + Number(t.taxAmount || 0), 0);
      subledgerPurchasesBaseCentavos = subledgerPurchasesGrossCentavos - subledgerInputVatCentavos;
    } else if (isVatTaxpayer) {
      subledgerInputVatCentavos = Math.round(subledgerPurchasesGrossCentavos - (subledgerPurchasesGrossCentavos / 1.12));
      subledgerPurchasesBaseCentavos = subledgerPurchasesGrossCentavos - subledgerInputVatCentavos;
    }

    // 3. GL Account Balances (strictly POSTED journals)
    const journalLines = await db.select({
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, 'POSTED'),
        gte(schema.journalEntries.entryDate, startDate),
        lte(schema.journalEntries.entryDate, endDate)
      )
    );

    let glOutputVatCreditCentavos = 0;
    let glInputVatDebitCentavos = 0;
    let glEwtCreditCentavos = 0;
    let glCwtDebitCentavos = 0;

    for (const jl of journalLines) {
      const code = jl.accountCode || '';
      const name = (jl.accountName || '').toLowerCase();

      if (code === '2020' || name.includes('output vat')) {
        glOutputVatCreditCentavos += (jl.credit || 0) - (jl.debit || 0);
      } else if (code === '1050' || code === '1150' || code === '1500' || name.includes('input vat')) {
        glInputVatDebitCentavos += (jl.debit || 0) - (jl.credit || 0);
      } else if (code === '2030' || code === '2130' || name.includes('expanded withholding') || name.includes('ewt')) {
        glEwtCreditCentavos += (jl.credit || 0) - (jl.debit || 0);
      } else if (code === '1060' || name.includes('creditable withholding') || name.includes('cwt')) {
        glCwtDebitCentavos += (jl.debit || 0) - (jl.credit || 0);
      }
    }

    // 4. Real Subledger EWT (Supplier Payments) & CWT (Customer Payments)
    const supplierEwtRow = await db.select({
      total: sql<number>`COALESCE(SUM(${schema.supplierPayments.withholdingTaxAmount}), 0)`,
    })
    .from(schema.supplierPayments)
    .where(and(
      eq(schema.supplierPayments.companyId, companyId),
      sql`UPPER(COALESCE(${schema.supplierPayments.status}, '')) IN ('POSTED', 'CLEARED', 'PAID')`,
      gte(schema.supplierPayments.paymentDate, startDate),
      lte(schema.supplierPayments.paymentDate, endDate)
    ))
    .get();

    const customerCwtRow = await db.select({
      total: sql<number>`COALESCE(SUM(${schema.customerPayments.withholdingTaxAmount}), 0)`,
    })
    .from(schema.customerPayments)
    .where(and(
      eq(schema.customerPayments.companyId, companyId),
      sql`UPPER(COALESCE(${schema.customerPayments.status}, '')) IN ('POSTED', 'CLEARED', 'PAID')`,
      gte(schema.customerPayments.paymentDate, startDate),
      lte(schema.customerPayments.paymentDate, endDate)
    ))
    .get();

    const subledgerEwtCentavos = Number(supplierEwtRow?.total || 0);
    const subledgerCwtCentavos = Number(customerCwtRow?.total || 0);

    const outputVatVariance = Math.abs(glOutputVatCreditCentavos - subledgerOutputVatCentavos);
    const inputVatVariance = Math.abs(glInputVatDebitCentavos - subledgerInputVatCentavos);
    const ewtVariance = Math.abs(glEwtCreditCentavos - subledgerEwtCentavos);
    const cwtVariance = Math.abs(glCwtDebitCentavos - subledgerCwtCentavos);

    const period = `${startDate.substring(0, 7)}`;

    return {
      companyId,
      period,
      outputVat: {
        subledgerTaxBaseCentavos: subledgerSalesBaseCentavos,
        subledgerOutputVatCentavos,
        glCreditBalanceCentavos: glOutputVatCreditCentavos,
        varianceCentavos: outputVatVariance,
        isBalanced: outputVatVariance === 0
      },
      inputVat: {
        subledgerTaxBaseCentavos: subledgerPurchasesBaseCentavos,
        subledgerInputVatCentavos,
        glDebitBalanceCentavos: glInputVatDebitCentavos,
        varianceCentavos: inputVatVariance,
        isBalanced: inputVatVariance === 0
      },
      ewtWithholding: {
        subledgerBaseCentavos: subledgerPurchasesBaseCentavos,
        subledgerEwtCentavos,
        glCreditBalanceCentavos: glEwtCreditCentavos,
        varianceCentavos: ewtVariance,
        isBalanced: ewtVariance === 0
      },
      cwtCertificates: {
        subledgerBaseCentavos: subledgerSalesBaseCentavos,
        subledgerCwtCentavos,
        glDebitBalanceCentavos: glCwtDebitCentavos,
        varianceCentavos: cwtVariance,
        isBalanced: cwtVariance === 0
      },
      overallBalanced: outputVatVariance === 0 && inputVatVariance === 0 && ewtVariance === 0 && cwtVariance === 0
    };
  }

  /**
   * Scans active transactions for BIR tax compliance exceptions
   */
  public static async detectTaxExceptions(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<TaxException[]> {
    const exceptions: TaxException[] = [];

    // 1. Scan Vendors for missing or invalid TIN
    const vendors = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId));
    for (const v of vendors) {
      if (!v.tin) {
        exceptions.push({
          code: 'MISSING_TIN',
          severity: 'HIGH',
          entityType: 'VENDOR',
          entityId: v.id,
          referenceNo: v.code || v.legalName,
          description: `Supplier "${v.legalName}" has no TIN configured. BIR regulations require valid TINs on all Form 2307 and MAP attachments.`,
          suggestedCorrection: 'Update Vendor Master Data with valid 9 or 12-digit BIR Tax Identification Number.'
        });
      } else if (!BirComplianceService.validateTin(v.tin)) {
        exceptions.push({
          code: 'INVALID_TIN_FORMAT',
          severity: 'HIGH',
          entityType: 'VENDOR',
          entityId: v.id,
          referenceNo: v.code || v.legalName,
          description: `Supplier "${v.legalName}" has invalid TIN format (${v.tin}). Must be 9 or 12 numeric digits.`,
          suggestedCorrection: 'Correct TIN format to 9 digits (e.g. 123-456-789) or 12 digits with branch code.'
        });
      }
    }

    // 2. Scan Customers for missing or invalid TIN
    const customers = await db.select().from(schema.customers).where(eq(schema.customers.companyId, companyId));
    for (const c of customers) {
      if (c.tin && !BirComplianceService.validateTin(c.tin)) {
        exceptions.push({
          code: 'INVALID_TIN_FORMAT',
          severity: 'MEDIUM',
          entityType: 'CUSTOMER',
          entityId: c.id,
          referenceNo: c.code || c.legalName,
          description: `Customer "${c.legalName}" has invalid TIN format (${c.tin}).`,
          suggestedCorrection: 'Update Customer Master Data with valid 9 or 12-digit BIR TIN.'
        });
      }
    }

    // 3. Scan Purchase Bills for missing ATC
    const bills = await db.select().from(schema.purchaseBills).where(
      and(
        eq(schema.purchaseBills.companyId, companyId),
        gte(schema.purchaseBills.billDate, startDate),
        lte(schema.purchaseBills.billDate, endDate)
      )
    );

    for (const b of bills) {
      const lines = await db.select().from(schema.purchaseBillLines).where(eq(schema.purchaseBillLines.billId, b.id));
      let hasTaxCode = lines.some(l => !!l.taxCodeId);
      if (!hasTaxCode) {
        exceptions.push({
          code: 'MISSING_ATC',
          severity: 'MEDIUM',
          entityType: 'PURCHASE_BILL',
          entityId: b.id,
          referenceNo: b.billNumber,
          description: `Purchase Bill ${b.billNumber} has lines without assigned Alphanumeric Tax Code (ATC).`,
          taxableAmountCentavos: b.totalAmount,
          suggestedCorrection: 'Assign appropriate EWT ATC code (e.g. WC160 or WC150) to line items.'
        });
      }
    }

    return exceptions;
  }
}
