import { db } from '../db';
import * as schema from '../db/schema';
import { eq, and, gte, lte, sql, inArray } from 'drizzle-orm';
import { ExportService, ServerExportOptions } from './exportService';
import { buildEffectivePostedJournalPredicate } from '../routes/reports';

export interface Form2307LineItem {
  payeeId: string;
  payeeName: string;
  payeeTin: string | null;
  payeeAddress: string | null;
  atc: string; // Alphanumeric Tax Code (must be explicit, e.g. WC160 or UNASSIGNED_ATC)
  taxRate: number;
  month1Base: number;
  month1Withheld: number;
  month2Base: number;
  month2Withheld: number;
  month3Base: number;
  month3Withheld: number;
  totalTaxBase: number;
  totalWithheld: number;
  validationStatus: 'VALID' | 'MISSING_TIN' | 'UNASSIGNED_ATC';
}

export interface BookEntry {
  date: string;
  referenceNo: string;
  description: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  runningBalance?: number;
  sourceType?: string;
}

export interface VatSummaryItem {
  partnerId: string;
  partnerName: string;
  partnerTin: string | null;
  invoiceNumber: string;
  transactionDate: string;
  grossAmount: number;
  taxableAmount: number;
  exemptAmount: number;
  inputOutputVat: number;
  validationStatus: 'VALID' | 'MISSING_TIN' | 'UNCLASSIFIED_VAT';
}

/**
 * Official BIR RR 11-2018 / NIRC Expanded Withholding Tax (EWT) ATC Rates
 * - WC158 / WI158: Top Withholding Agents - Local/Resident Suppliers of Goods (1%)
 * - WC160 / WI160: Top Withholding Agents - Local/Resident Suppliers of Services (2%)
 * - WC100 / WI100: Rentals (5%)
 * - WC120 / WI120: Prime Contractors / Subcontractors (2%)
 * - WC010 / WC011: Professional Fees - Corporate (15% > P720k, 10% <= P720k)
 * - WI010 / WI011: Professional Fees - Individual (10% > P3M, 5% <= P3M)
 */
export const BIR_RR_11_2018_ATC_RATES: Record<string, number> = {
  WC100: 0.05, WI100: 0.05,
  WC120: 0.02, WI120: 0.02,
  WC010: 0.15, WC011: 0.10, WI010: 0.10, WI011: 0.05,
  WC156: 0.01, WI156: 0.01,
  WC157: 0.02, WI157: 0.02,
  WC158: 0.01, WI158: 0.01,
  WC160: 0.02, WI160: 0.02,
  WC162: 0.02, WI161: 0.05,
  WC140: 0.10, WI140: 0.10,
};

/**
 * Resolve BIR ATC withholding tax rate from database definitions or official BIR RR 11-2018 schedule.
 */
export function resolveBirAtcRate(
  atcCode: string | null | undefined,
  dbRateMap?: Map<string, number>,
  fallbackCodeRate?: number | null
): number {
  const normalized = String(atcCode || '').trim().toUpperCase();
  if (!normalized || normalized === 'UNASSIGNED_ATC') return 0;
  if (dbRateMap && dbRateMap.has(normalized)) {
    const dbRate = Number(dbRateMap.get(normalized) || 0);
    if (dbRate > 0) return dbRate > 1 ? dbRate / 100 : dbRate;
  }
  if (BIR_RR_11_2018_ATC_RATES[normalized] !== undefined) {
    return BIR_RR_11_2018_ATC_RATES[normalized];
  }
  if (typeof fallbackCodeRate === 'number' && Number.isFinite(fallbackCodeRate) && fallbackCodeRate > 0) {
    return fallbackCodeRate > 1 ? fallbackCodeRate / 100 : fallbackCodeRate;
  }
  return 0;
}

/**
 * Determine whether a taxpayer entity is VAT-registered under NIRC Sec. 105-110 / Sec. 116.
 */
export function isCompanyVatRegistered(
  vatStatus: string | null | undefined,
  taxpayerClassification?: string | null | undefined
): boolean {
  const vs = String(vatStatus || '').trim().toUpperCase();
  const tc = String(taxpayerClassification || '').trim().toUpperCase();
  if (
    vs === 'NON_VAT' ||
    vs === 'NON-VAT' ||
    vs === 'VAT_EXEMPT' ||
    vs === 'PERCENTAGE_TAX' ||
    tc.includes('NON_VAT') ||
    tc.includes('PERCENTAGE') ||
    tc.includes('8_PERCENT') ||
    tc.includes('8%')
  ) {
    return false;
  }
  return vs === '' || vs === 'VAT' || vs === 'VAT_REGISTERED' || vs === 'VATABLE';
}

/**
 * Classify a single purchase or sales transaction for BIR VAT Relief / SLSP compliance.
 * - Non-VAT taxpayers (NIRC Sec. 116) CANNOT claim 12% Input VAT and DO NOT charge 12% Output VAT.
 * - VAT-registered taxpayers:
 *    * Purchases: Creditable Input VAT requires a VAT-registered supplier (or explicit active VAT tax_calculation).
 *    * Sales: VAT-registered sellers charge 12% Output VAT on VATable sales regardless of buyer's VAT status,
 *      unless explicitly classified as Zero-Rated or VAT-Exempt in tax_calculations.
 */
export function classifyVatTransaction(params: {
  side: 'PURCHASE' | 'SALE';
  grossAmount: number;
  companyIsVatRegistered: boolean;
  partnerVatStatus?: string | null;
  storedVatCalc?: { taxable: number; exempt: number; vat: number } | undefined;
}): { taxable: number; vat: number; exempt: number; unclassifiedVat: boolean } {
  const gross = Number(params.grossAmount || 0);
  if (!params.companyIsVatRegistered) {
    return { taxable: 0, vat: 0, exempt: gross, unclassifiedVat: false };
  }
  if (params.storedVatCalc) {
    return {
      taxable: params.storedVatCalc.taxable,
      vat: params.storedVatCalc.vat,
      exempt: params.storedVatCalc.exempt,
      unclassifiedVat: false,
    };
  }
  if (!params.partnerVatStatus || !String(params.partnerVatStatus).trim()) {
    return { taxable: 0, vat: 0, exempt: 0, unclassifiedVat: true };
  }
  const partnerVatUpper = String(params.partnerVatStatus).trim().toUpperCase();
  const isVatable = partnerVatUpper === 'VAT_REGISTERED' || partnerVatUpper === 'VAT' || partnerVatUpper === 'VATABLE';
  if (isVatable) {
    const taxable = Math.round(gross / 1.12);
    return { taxable, vat: gross - taxable, exempt: 0, unclassifiedVat: false };
  }
  if (params.side === 'SALE') {
    if (partnerVatUpper === 'EXEMPT' || partnerVatUpper === 'ZERO_RATED') {
      return { taxable: 0, vat: 0, exempt: gross, unclassifiedVat: false };
    }
    const taxable = Math.round(gross / 1.12);
    return { taxable, vat: gross - taxable, exempt: 0, unclassifiedVat: false };
  }
  return { taxable: 0, vat: 0, exempt: gross, unclassifiedVat: false };
}

export class BirComplianceService {
  /**
   * Validate Philippine BIR TIN format:
   * - 9 digits: Core TIN (NNN-NNN-NNN)
   * - 12 digits: Standard 3-digit branch code (NNN-NNN-NNN-000)
   * - 14 digits: BIR RR 7-2012 / EOPT 5-digit branch code (NNN-NNN-NNN-00000)
   */
  public static validateTin(tin: string | null | undefined): boolean {
    if (!tin) return false;
    const clean = tin.replace(/[^0-9]/g, '');
    if (!(clean.length === 9 || clean.length === 12 || clean.length === 14)) return false;
    // Reject all-zero placeholder TINs
    if (/^0+$/.test(clean)) return false;
    return true;
  }

  /**
   * Generate BIR Form 2307 data aggregation with 3-month quarterly breakdown and explicit ATC validation.
   * Uses O(1) batched queries (zero N+1 loops, immune to SQLite 999-param limits) and combines:
   * 1) Posted Supplier Payments (Disbursement Vouchers) with EWT withheld (primary PH cash-basis EWT source), and
   * 2) Posted Purchase Bills with explicit EWT tax codes not yet covered by an EWT payment.
   */
  public static async generateForm2307Data(
    companyId: string,
    startDate: string, // YYYY-MM-DD representing quarter start
    endDate: string     // YYYY-MM-DD representing quarter end
  ): Promise<{
    payor: { name: string; tin: string | null; address: string | null };
    period: { startDate: string; endDate: string };
    lineItems: Form2307LineItem[];
    summary: { totalBase: number; totalWithheld: number };
  }> {
    const [
      companyRecords,
      vendors,
      atcDefs,
      companyTaxCodes,
      rawEwtPayments,
      rawBills,
    ] = await Promise.all([
      db.select().from(schema.companies).where(eq(schema.companies.id, companyId)),
      db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId)),
      db.select().from(schema.atcDefinitions),
      db.select().from(schema.taxCodes).where(eq(schema.taxCodes.companyId, companyId)),
      db.select({
        id: schema.supplierPayments.id,
        vendorId: schema.supplierPayments.vendorId,
        paymentDate: schema.supplierPayments.paymentDate,
        amount: schema.supplierPayments.amount,
        withholdingTaxAmount: schema.supplierPayments.withholdingTaxAmount,
        notes: schema.supplierPayments.notes,
        reference: schema.supplierPayments.reference,
        status: schema.supplierPayments.status,
        journalStatus: schema.journalEntries.status,
        journalDesc: schema.journalEntries.description,
      })
      .from(schema.supplierPayments)
      .leftJoin(schema.journalEntries, eq(schema.supplierPayments.journalEntryId, schema.journalEntries.id))
      .where(
        and(
          eq(schema.supplierPayments.companyId, companyId),
          sql`COALESCE(${schema.supplierPayments.withholdingTaxAmount}, 0) > 0`,
          sql`UPPER(COALESCE(${schema.supplierPayments.status}, '')) NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'REVERSED')`,
          gte(schema.supplierPayments.paymentDate, startDate),
          lte(schema.supplierPayments.paymentDate, endDate)
        )
      ),
      db.select({
        id: schema.purchaseBills.id,
        vendorId: schema.purchaseBills.vendorId,
        billNumber: schema.purchaseBills.billNumber,
        billDate: schema.purchaseBills.billDate,
        totalAmount: schema.purchaseBills.totalAmount,
        status: schema.purchaseBills.status,
        journalStatus: schema.journalEntries.status,
      })
      .from(schema.purchaseBills)
      .leftJoin(schema.journalEntries, eq(schema.purchaseBills.journalEntryId, schema.journalEntries.id))
      .where(
        and(
          eq(schema.purchaseBills.companyId, companyId),
          sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
          gte(schema.purchaseBills.billDate, startDate),
          lte(schema.purchaseBills.billDate, endDate)
        )
      ),
    ]);

    const company = companyRecords[0];
    const payor = {
      name: company?.legalName || 'Unknown Company',
      tin: company?.tin || null,
      address: company?.address || null,
    };

    const vendorMap = new Map<string, typeof vendors[number]>(vendors.map(v => [v.id, v]));
    const atcRateMap = new Map<string, number>(
      atcDefs.map(a => [String(a.code || '').toUpperCase(), Number(a.taxRate || 0)])
    );
    const taxCodeMap = new Map<string, typeof companyTaxCodes[number]>(
      companyTaxCodes.map(tc => [tc.id, tc])
    );

    const ewtPayments = rawEwtPayments.filter((p) => !p.journalStatus || p.journalStatus === 'POSTED');
    const bills = rawBills.filter((b) => !b.journalStatus || b.journalStatus === 'POSTED');
    const billsInQuarterIds = new Set(bills.map(b => b.id));

    // Batch-load all purchase bill lines for this company's bills in quarter (single query, no SQLite inArray limit)
    const allCompanyBillLines = bills.length > 0
      ? await db.select({
          billId: schema.purchaseBillLines.billId,
          amount: schema.purchaseBillLines.amount,
          taxCodeId: schema.purchaseBillLines.taxCodeId,
        })
        .from(schema.purchaseBillLines)
        .innerJoin(schema.purchaseBills, eq(schema.purchaseBillLines.billId, schema.purchaseBills.id))
        .where(
          and(
            eq(schema.purchaseBills.companyId, companyId),
            gte(schema.purchaseBills.billDate, startDate),
            lte(schema.purchaseBills.billDate, endDate)
          )
        )
      : [];

    const billLinesByBillId = new Map<string, Array<{ amount: number; taxCodeId: string | null }>>();
    for (const line of allCompanyBillLines) {
      if (!billsInQuarterIds.has(line.billId)) continue;
      const arr = billLinesByBillId.get(line.billId) || [];
      arr.push({ amount: line.amount, taxCodeId: line.taxCodeId });
      billLinesByBillId.set(line.billId, arr);
    }

    const startMonth = parseInt(startDate.split('-')[1], 10);

    const vendorAtcAggregates = new Map<string, {
      payeeId: string;
      payeeName: string;
      payeeTin: string | null;
      payeeAddress: string | null;
      atc: string;
      taxRate: number;
      m1Base: number; m1Withheld: number;
      m2Base: number; m2Withheld: number;
      m3Base: number; m3Withheld: number;
    }>();

    const addContribution = (
      vendor: typeof vendors[number],
      atc: string,
      taxRate: number,
      txDate: string,
      taxBase: number,
      withheld: number
    ) => {
      const key = `${vendor.id}::${atc}`;
      let entry = vendorAtcAggregates.get(key);
      if (!entry) {
        entry = {
          payeeId: vendor.id,
          payeeName: vendor.legalName,
          payeeTin: vendor.tin || null,
          payeeAddress: vendor.address || null,
          atc,
          taxRate,
          m1Base: 0, m1Withheld: 0,
          m2Base: 0, m2Withheld: 0,
          m3Base: 0, m3Withheld: 0,
        };
        vendorAtcAggregates.set(key, entry);
      }

      const txMonth = parseInt(String(txDate || startDate).split('-')[1], 10);
      const monthOffset = txMonth - startMonth;
      if (monthOffset <= 0) {
        entry.m1Base += taxBase;
        entry.m1Withheld += withheld;
      } else if (monthOffset === 1) {
        entry.m2Base += taxBase;
        entry.m2Withheld += withheld;
      } else {
        entry.m3Base += taxBase;
        entry.m3Withheld += withheld;
      }
    };

    // Load payment applications to link disbursement vouchers to purchase bills
    const rawApplications = ewtPayments.length > 0
      ? await db.select({
          paymentId: schema.supplierPaymentApplications.paymentId,
          billId: schema.supplierPaymentApplications.billId,
        })
        .from(schema.supplierPaymentApplications)
        .innerJoin(schema.supplierPayments, eq(schema.supplierPaymentApplications.paymentId, schema.supplierPayments.id))
        .where(
          and(
            eq(schema.supplierPayments.companyId, companyId),
            gte(schema.supplierPayments.paymentDate, startDate),
            lte(schema.supplierPayments.paymentDate, endDate)
          )
        )
      : [];

    const paymentBillIdMap = new Map<string, string>();
    for (const app of rawApplications) {
      paymentBillIdMap.set(app.paymentId, app.billId);
    }

    // Pass 1: Actual EWT withheld on posted Disbursement Vouchers (Supplier Payments)
    const billIdsWithEwtPayment = new Set<string>();
    for (const pmt of ewtPayments) {
      const vendor = vendorMap.get(pmt.vendorId);
      if (!vendor) continue;
      let linkedBillId = paymentBillIdMap.get(pmt.id);
      if (!linkedBillId) {
        const vendorBills = bills.filter(b => b.vendorId === pmt.vendorId);
        if (vendorBills.length === 1) {
          linkedBillId = vendorBills[0].id;
        }
      }
      if (linkedBillId) billIdsWithEwtPayment.add(linkedBillId);

      const combinedText = `${pmt.notes || ''} ${pmt.reference || ''} ${(pmt as any).journalDesc || ''}`;
      const atcMatch = /(?:ATC:?|ATC\s+Code:?)\s*([A-Z0-9]+)/i.exec(combinedText);
      let atc = atcMatch ? atcMatch[1].toUpperCase() : '';

      if (!atc && linkedBillId) {
        const lines = billLinesByBillId.get(linkedBillId) || [];
        for (const l of lines) {
          if (l.taxCodeId) {
            const tc = taxCodeMap.get(l.taxCodeId);
            if (tc && /^W[CI]\d{3}$/i.test(tc.code)) {
              atc = tc.code.trim().toUpperCase();
              break;
            }
          }
        }
      }
      if (!atc) {
        if (/rent/i.test(combinedText)) {
          atc = 'WC100'; // Official BIR 5% Rent on Real Property
        } else if (/service|consult/i.test(combinedText)) {
          atc = 'WC160'; // Official BIR 2% Contractor/Services
        } else {
          atc = 'WC158'; // Standard default for supplier withholding (Goods)
        }
      }

      const withheld = Number(pmt.withholdingTaxAmount || 0);
      const taxRate = resolveBirAtcRate(atc, atcRateMap);
      const grossPaid = Number(pmt.amount || 0) + withheld;
      const derivedBase = taxRate > 0 ? Math.round(withheld / taxRate) : grossPaid;

      addContribution(vendor, atc, taxRate, pmt.paymentDate, derivedBase, withheld);
    }

    // Pass 2: Posted Purchase Bills with explicit EWT tax codes not yet covered by an EWT payment
    for (const bill of bills) {
      if (billIdsWithEwtPayment.has(bill.id)) continue;
      const vendor = vendorMap.get(bill.vendorId);
      if (!vendor) continue;

      const lines = billLinesByBillId.get(bill.id) || [];
      let billBase = lines.reduce((acc, l) => acc + l.amount, 0);
      if (billBase <= 0) billBase = Number(bill.totalAmount || 0);

      let atc = 'UNASSIGNED_ATC';
      let taxRate = 0;

      for (const line of lines) {
        if (!line.taxCodeId) continue;
        const tc = taxCodeMap.get(line.taxCodeId);
        if (!tc || !tc.code) continue;
        const tcType = String(tc.taxType || '').toUpperCase();
        const codeUpper = tc.code.trim().toUpperCase();
        // Skip VAT-only codes when computing Form 2307 EWT unless explicitly EWT/WHT/WC/WI
        const isEwtCode = tcType.includes('WITHHOLDING') || tcType.includes('EWT') || tcType.includes('WHT') || /^W[CI]\d{3}$/.test(codeUpper);
        if (!isEwtCode) continue;

        atc = codeUpper;
        taxRate = resolveBirAtcRate(atc, atcRateMap, (tc as any).rate);
      }

      // For unassigned ATC bills:
      // If the vendor already has an EWT payment/contribution in the quarter, do not emit a redundant UNASSIGNED line.
      // If the vendor has no other contributions, include the unassigned bill so it is surfaced for audit review.
      if (atc === 'UNASSIGNED_ATC') {
        const vendorHasEwt = Array.from(vendorAtcAggregates.values()).some(a => a.payeeId === vendor.id);
        if (vendorHasEwt) continue;
      }

      const withheld = Math.round(billBase * taxRate);
      addContribution(vendor, atc, taxRate, bill.billDate, billBase, withheld);
    }

    const lineItems: Form2307LineItem[] = [];
    let totalBase = 0;
    let totalWithheld = 0;

    for (const agg of vendorAtcAggregates.values()) {
      const totBase = agg.m1Base + agg.m2Base + agg.m3Base;
      const totWithheld = agg.m1Withheld + agg.m2Withheld + agg.m3Withheld;
      totalBase += totBase;
      totalWithheld += totWithheld;

      let validationStatus: Form2307LineItem['validationStatus'] = 'VALID';
      if (!this.validateTin(agg.payeeTin)) {
        validationStatus = 'MISSING_TIN';
      } else if (agg.atc === 'UNASSIGNED_ATC') {
        validationStatus = 'UNASSIGNED_ATC';
      }

      lineItems.push({
        payeeId: agg.payeeId,
        payeeName: agg.payeeName,
        payeeTin: agg.payeeTin,
        payeeAddress: agg.payeeAddress,
        atc: agg.atc,
        taxRate: agg.taxRate,
        month1Base: agg.m1Base,
        month1Withheld: agg.m1Withheld,
        month2Base: agg.m2Base,
        month2Withheld: agg.m2Withheld,
        month3Base: agg.m3Base,
        month3Withheld: agg.m3Withheld,
        totalTaxBase: totBase,
        totalWithheld: totWithheld,
        validationStatus,
      });
    }

    return {
      payor,
      period: { startDate, endDate },
      lineItems,
      summary: { totalBase, totalWithheld },
    };
  }

  /**
   * Generate Computerized Books of Accounts from posted double-entry journal entries
   */
  public static async generateBookOfAccounts(
    companyId: string,
    bookType: 'GENERAL_JOURNAL' | 'GENERAL_LEDGER' | 'SALES_JOURNAL' | 'PURCHASE_JOURNAL' | 'CASH_RECEIPTS_JOURNAL' | 'CASH_DISBURSEMENTS_JOURNAL' | 'SUBSIDIARY_LEDGER',
    startDate: string,
    endDate: string,
    filterAccountId?: string,
    filterPartnerId?: string
  ): Promise<BookEntry[]> {
    const linesQuery = db.select({
      entryId: schema.journalLines.journalEntryId,
      journalNumber: schema.journalEntries.journalNumber,
      entryDate: schema.journalEntries.entryDate,
      entryDesc: schema.journalEntries.description,
      sourceType: schema.journalEntries.sourceType,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      lineDesc: schema.journalLines.description,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
      accountId: schema.journalLines.accountId,
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        buildEffectivePostedJournalPredicate(companyId),
        gte(schema.journalEntries.entryDate, startDate),
        lte(schema.journalEntries.entryDate, endDate)
      )
    );

    const lines = await linesQuery;

    let filteredLines = lines;
    if (filterAccountId) {
      filteredLines = lines.filter(l => l.accountId === filterAccountId);
    }

    if (bookType === 'SALES_JOURNAL') {
      filteredLines = filteredLines.filter(l =>
        ['INVOICE', 'SALES', 'SALES_INVOICE', 'CREDIT_MEMO'].includes(String(l.sourceType || '').toUpperCase())
      );
    } else if (bookType === 'PURCHASE_JOURNAL') {
      filteredLines = filteredLines.filter(l =>
        ['BILL', 'PURCHASE', 'PURCHASE_BILL', 'DEBIT_MEMO'].includes(String(l.sourceType || '').toUpperCase())
      );
    } else if (bookType === 'CASH_RECEIPTS_JOURNAL') {
      filteredLines = filteredLines.filter(l => {
        const st = String(l.sourceType || '').toUpperCase();
        return st === 'RECEIPT' || st === 'CASH_RECEIPT' || st === 'CUSTOMER_PAYMENT' || (st === 'CASH_TRANSACTION' && (l.debit || 0) > 0);
      });
    } else if (bookType === 'CASH_DISBURSEMENTS_JOURNAL') {
      filteredLines = filteredLines.filter(l => {
        const st = String(l.sourceType || '').toUpperCase();
        return st === 'DISBURSEMENT' || st === 'PAYMENT' || st === 'SUPPLIER_PAYMENT' || (st === 'CASH_TRANSACTION' && (l.credit || 0) > 0);
      });
    }

    let runningBalance = 0;
    const bookEntries: BookEntry[] = filteredLines.map(l => {
      const debit = l.debit || 0;
      const credit = l.credit || 0;
      runningBalance += (debit - credit);

      return {
        date: l.entryDate,
        referenceNo: l.journalNumber,
        description: l.lineDesc || l.entryDesc || '',
        accountCode: l.accountCode,
        accountName: l.accountName,
        debit,
        credit,
        runningBalance,
        sourceType: l.sourceType || 'GENERAL',
      };
    });

    return bookEntries;
  }

  /**
   * Generate VAT / SADPGS Summary from posted purchase bills and sales invoices.
   * Strictly enforces active company's BIR VAT vs Non-VAT registration status (NIRC Sec. 110 & Sec. 116)
   * and avoids SQLite 999-parameter limits when processing 1,000+ transactions.
   */
  public static async generateVatSummary(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<{
    purchases: VatSummaryItem[];
    sales: VatSummaryItem[];
    totals: {
      grossPurchases: number;
      taxablePurchases: number;
      exemptPurchases: number;
      inputVat: number;
      grossSales: number;
      taxableSales: number;
      exemptSales: number;
      outputVat: number;
    };
  }> {
    const [companyRow, rawBills, rawInvoices, vendors, customers, allActiveTaxCalcRows] = await Promise.all([
      db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get(),
      db.select({
        id: schema.purchaseBills.id,
        vendorId: schema.purchaseBills.vendorId,
        billNumber: schema.purchaseBills.billNumber,
        billDate: schema.purchaseBills.billDate,
        totalAmount: schema.purchaseBills.totalAmount,
        journalEntryId: schema.purchaseBills.journalEntryId,
        journalStatus: schema.journalEntries.status,
      })
      .from(schema.purchaseBills)
      .leftJoin(schema.journalEntries, eq(schema.purchaseBills.journalEntryId, schema.journalEntries.id))
      .where(
        and(
          eq(schema.purchaseBills.companyId, companyId),
          sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
          gte(schema.purchaseBills.billDate, startDate),
          lte(schema.purchaseBills.billDate, endDate)
        )
      ),
      db.select({
        id: schema.salesInvoices.id,
        customerId: schema.salesInvoices.customerId,
        invoiceNumber: schema.salesInvoices.invoiceNumber,
        invoiceDate: schema.salesInvoices.invoiceDate,
        totalAmount: schema.salesInvoices.totalAmount,
        journalEntryId: schema.salesInvoices.journalEntryId,
        journalStatus: schema.journalEntries.status,
      })
      .from(schema.salesInvoices)
      .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
      .where(
        and(
          eq(schema.salesInvoices.companyId, companyId),
          sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
          gte(schema.salesInvoices.invoiceDate, startDate),
          lte(schema.salesInvoices.invoiceDate, endDate)
        )
      ),
      db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId)),
      db.select().from(schema.customers).where(eq(schema.customers.companyId, companyId)),
      db.select({
        journalEntryId: schema.taxCalculations.journalEntryId,
        taxBase: schema.taxCalculations.taxBase,
        taxAmount: schema.taxCalculations.taxAmount,
        taxRate: schema.taxCalculations.taxRate,
        taxType: schema.taxCodes.taxType,
      })
      .from(schema.taxCalculations)
      .innerJoin(schema.taxCodes, eq(schema.taxCalculations.taxCodeId, schema.taxCodes.id))
      .where(and(
        eq(schema.taxCalculations.companyId, companyId),
        eq(schema.taxCalculations.status, 'ACTIVE')
      )),
    ]);

    const companyIsVat = isCompanyVatRegistered(companyRow?.vatStatus, companyRow?.taxpayerClassification);
    const bills = rawBills.filter((b) => !b.journalStatus || b.journalStatus === 'POSTED');
    const invoices = rawInvoices.filter((i) => !i.journalStatus || i.journalStatus === 'POSTED');

    const vendorMap = new Map<string, typeof vendors[number]>(vendors.map(v => [v.id, v]));
    const customerMap = new Map<string, typeof customers[number]>(customers.map(c => [c.id, c]));

    const jeIdSet = new Set<string>([
      ...bills.map(b => b.journalEntryId).filter(Boolean) as string[],
      ...invoices.map(i => i.journalEntryId).filter(Boolean) as string[],
    ]);

    const taxCalcByJe = new Map<string, { taxable: number; exempt: number; vat: number }>();
    for (const tc of allActiveTaxCalcRows) {
      if (!jeIdSet.has(tc.journalEntryId)) continue;
      if (!String(tc.taxType || '').toUpperCase().includes('VAT')) continue;
      const cur = taxCalcByJe.get(tc.journalEntryId) || { taxable: 0, exempt: 0, vat: 0 };
      const amt = Number(tc.taxAmount || 0);
      const base = Number(tc.taxBase || 0);
      if (amt > 0 || Number(tc.taxRate || 0) > 0) {
        cur.taxable += base;
        cur.vat += amt;
      } else {
        cur.exempt += base;
      }
      taxCalcByJe.set(tc.journalEntryId, cur);
    }

    const purchaseItems: VatSummaryItem[] = [];
    let grossPurchases = 0;
    let taxablePurchases = 0;
    let exemptPurchases = 0;
    let inputVat = 0;

    for (const bill of bills) {
      const vendor = vendorMap.get(bill.vendorId);
      const gross = bill.totalAmount;
      const stored = bill.journalEntryId ? taxCalcByJe.get(bill.journalEntryId) : undefined;

      const classified = classifyVatTransaction({
        side: 'PURCHASE',
        grossAmount: gross,
        companyIsVatRegistered: companyIsVat,
        partnerVatStatus: vendor?.vatStatus,
        storedVatCalc: stored,
      });

      grossPurchases += gross;
      taxablePurchases += classified.taxable;
      exemptPurchases += classified.exempt;
      inputVat += classified.vat;

      let validationStatus: VatSummaryItem['validationStatus'] = 'VALID';
      if (!vendor || !this.validateTin(vendor.tin)) {
        validationStatus = 'MISSING_TIN';
      } else if (classified.unclassifiedVat) {
        validationStatus = 'UNCLASSIFIED_VAT';
      }

      purchaseItems.push({
        partnerId: vendor?.id || 'UNKNOWN',
        partnerName: vendor?.legalName || 'Unknown Vendor',
        partnerTin: vendor?.tin || null,
        invoiceNumber: bill.billNumber,
        transactionDate: bill.billDate,
        grossAmount: gross,
        taxableAmount: classified.taxable,
        exemptAmount: classified.exempt,
        inputOutputVat: classified.vat,
        validationStatus,
      });
    }

    const salesItems: VatSummaryItem[] = [];
    let grossSales = 0;
    let taxableSales = 0;
    let exemptSales = 0;
    let outputVat = 0;

    for (const inv of invoices) {
      const customer = customerMap.get(inv.customerId);
      const gross = inv.totalAmount;
      const stored = inv.journalEntryId ? taxCalcByJe.get(inv.journalEntryId) : undefined;

      const classified = classifyVatTransaction({
        side: 'SALE',
        grossAmount: gross,
        companyIsVatRegistered: companyIsVat,
        partnerVatStatus: customer?.vatStatus,
        storedVatCalc: stored,
      });

      grossSales += gross;
      taxableSales += classified.taxable;
      exemptSales += classified.exempt;
      outputVat += classified.vat;

      let validationStatus: VatSummaryItem['validationStatus'] = 'VALID';
      if (!customer || !this.validateTin(customer.tin)) {
        validationStatus = 'MISSING_TIN';
      } else if (classified.unclassifiedVat) {
        validationStatus = 'UNCLASSIFIED_VAT';
      }

      salesItems.push({
        partnerId: customer?.id || 'UNKNOWN',
        partnerName: customer?.legalName || 'Unknown Customer',
        partnerTin: customer?.tin || null,
        invoiceNumber: inv.invoiceNumber,
        transactionDate: inv.invoiceDate,
        grossAmount: gross,
        taxableAmount: classified.taxable,
        exemptAmount: classified.exempt,
        inputOutputVat: classified.vat,
        validationStatus,
      });
    }

    return {
      purchases: purchaseItems,
      sales: salesItems,
      totals: {
        grossPurchases,
        taxablePurchases,
        exemptPurchases,
        inputVat,
        grossSales,
        taxableSales,
        exemptSales,
        outputVat,
      },
    };
  }
}
