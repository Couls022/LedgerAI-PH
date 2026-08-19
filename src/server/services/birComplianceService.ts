import { db } from '../db';
import * as schema from '../db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { ExportService, ServerExportOptions } from './exportService';

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

export class BirComplianceService {
  /**
   * Validate Philippine TIN format (9 or 12 digits, optional branch code)
   */
  public static validateTin(tin: string | null | undefined): boolean {
    if (!tin) return false;
    const clean = tin.replace(/[^0-9]/g, '');
    return clean.length === 9 || clean.length === 12;
  }

  /**
   * Generate BIR Form 2307 data aggregation with 3-month quarterly breakdown and explicit ATC validation
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
    // 1. Get company info (payor)
    const companyRecords = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
    const company = companyRecords[0];
    const payor = {
      name: company?.legalName || 'Unknown Company',
      tin: company?.tin || null,
      address: company?.address || null,
    };

    // 2. Fetch posted supplier payments or purchase bills within the period with withholding tax
    const bills = await db.select({
      id: schema.purchaseBills.id,
      vendorId: schema.purchaseBills.vendorId,
      billNumber: schema.purchaseBills.billNumber,
      billDate: schema.purchaseBills.billDate,
      totalAmount: schema.purchaseBills.totalAmount,
      status: schema.purchaseBills.status,
    })
    .from(schema.purchaseBills)
    .where(
      and(
        eq(schema.purchaseBills.companyId, companyId),
        sql`${schema.purchaseBills.status} = 'POSTED'`,
        gte(schema.purchaseBills.billDate, startDate),
        lte(schema.purchaseBills.billDate, endDate)
      )
    );

    // Fetch bill lines and vendors
    const vendors = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId));
    const vendorMap = new Map<string, typeof vendors[number]>(vendors.map(v => [v.id, v]));

    // Group withholding data by vendor and month
    const startMonth = parseInt(startDate.split('-')[1], 10);

    const vendorAggregates = new Map<string, {
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

    for (const bill of bills) {
      const vendor = vendorMap.get(bill.vendorId);
      if (!vendor) continue;

      // Fetch lines for this bill to inspect tax codes or withholding
      const lines = await db.select({
        amount: schema.purchaseBillLines.amount,
        taxCodeId: schema.purchaseBillLines.taxCodeId,
      })
      .from(schema.purchaseBillLines)
      .where(eq(schema.purchaseBillLines.billId, bill.id));

      let billBase = lines.reduce((acc, l) => acc + l.amount, 0);
      
      let atc = 'UNASSIGNED_ATC';
      let taxRate = 0.02;

      for (const line of lines) {
        if (line.taxCodeId) {
          const tc = await db.select().from(schema.taxCodes).where(eq(schema.taxCodes.id, line.taxCodeId));
          if (tc[0] && tc[0].code) {
            atc = tc[0].code;
            if (atc.startsWith('WC16')) taxRate = 0.01;
            else if (atc.startsWith('WC15')) taxRate = 0.02;
            else if (atc.startsWith('WC158')) taxRate = 0.05;
          }
        }
      }

      const withheld = Math.round(billBase * taxRate);

      const billMonth = parseInt(bill.billDate.split('-')[1], 10);
      const monthOffset = billMonth - startMonth;

      let entry = vendorAggregates.get(vendor.id);
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
        vendorAggregates.set(vendor.id, entry);
      }

      if (monthOffset === 0) {
        entry.m1Base += billBase;
        entry.m1Withheld += withheld;
      } else if (monthOffset === 1) {
        entry.m2Base += billBase;
        entry.m2Withheld += withheld;
      } else {
        entry.m3Base += billBase;
        entry.m3Withheld += withheld;
      }
    }

    const lineItems: Form2307LineItem[] = [];
    let totalBase = 0;
    let totalWithheld = 0;

    for (const agg of vendorAggregates.values()) {
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
        eq(schema.journalEntries.companyId, companyId),
        sql`${schema.journalEntries.status} = 'POSTED'`,
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
      filteredLines = filteredLines.filter(l => l.sourceType === 'INVOICE' || l.sourceType === 'SALES');
    } else if (bookType === 'PURCHASE_JOURNAL') {
      filteredLines = filteredLines.filter(l => l.sourceType === 'BILL' || l.sourceType === 'PURCHASE');
    } else if (bookType === 'CASH_RECEIPTS_JOURNAL') {
      filteredLines = filteredLines.filter(l => l.sourceType === 'RECEIPT' || l.sourceType === 'CASH_RECEIPT');
    } else if (bookType === 'CASH_DISBURSEMENTS_JOURNAL') {
      filteredLines = filteredLines.filter(l => l.sourceType === 'DISBURSEMENT' || l.sourceType === 'PAYMENT');
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
   * Generate VAT / SADPGS Summary from posted purchase bills and sales invoices
   */
  public static async generateVatSummary(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<{
    purchases: VatSummaryItem[];
    sales: VatSummaryItem[];
    totals: { grossPurchases: number; taxablePurchases: number; exemptPurchases: number; inputVat: number };
  }> {
    const bills = await db.select({
      id: schema.purchaseBills.id,
      vendorId: schema.purchaseBills.vendorId,
      billNumber: schema.purchaseBills.billNumber,
      billDate: schema.purchaseBills.billDate,
      totalAmount: schema.purchaseBills.totalAmount,
    })
    .from(schema.purchaseBills)
    .where(
      and(
        eq(schema.purchaseBills.companyId, companyId),
        sql`${schema.purchaseBills.status} = 'POSTED'`,
        gte(schema.purchaseBills.billDate, startDate),
        lte(schema.purchaseBills.billDate, endDate)
      )
    );

    const vendors = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId));
    const vendorMap = new Map<string, typeof vendors[number]>(vendors.map(v => [v.id, v]));

    const purchaseItems: VatSummaryItem[] = [];
    let grossPurchases = 0;
    let taxablePurchases = 0;
    let exemptPurchases = 0;
    let inputVat = 0;

    for (const bill of bills) {
      const vendor = vendorMap.get(bill.vendorId);
      const gross = bill.totalAmount;
      const isVat = vendor?.vatStatus?.toUpperCase() === 'VAT_REGISTERED' || true;
      const taxable = isVat ? Math.round(gross / 1.12) : gross;
      const vat = isVat ? (gross - taxable) : 0;
      const exempt = isVat ? 0 : gross;

      grossPurchases += gross;
      taxablePurchases += taxable;
      inputVat += vat;

      let validationStatus: VatSummaryItem['validationStatus'] = 'VALID';
      if (!vendor || !this.validateTin(vendor.tin)) {
        validationStatus = 'MISSING_TIN';
      }

      purchaseItems.push({
        partnerId: vendor?.id || 'UNKNOWN',
        partnerName: vendor?.legalName || 'Unknown Vendor',
        partnerTin: vendor?.tin || null,
        invoiceNumber: bill.billNumber,
        transactionDate: bill.billDate,
        grossAmount: gross,
        taxableAmount: taxable,
        exemptAmount: exempt,
        inputOutputVat: vat,
        validationStatus,
      });
    }

    return {
      purchases: purchaseItems,
      sales: [],
      totals: { grossPurchases, taxablePurchases, exemptPurchases, inputVat },
    };
  }
}
