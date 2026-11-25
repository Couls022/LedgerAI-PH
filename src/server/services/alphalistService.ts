import { db } from '../db';
import * as schema from '../db/schema';
import { eq, and, gte, lte, sql, inArray } from 'drizzle-orm';
import { BirComplianceService } from './birComplianceService';
import { AuditService } from './auditService';
import { ExportService, ServerExportOptions } from './exportService';

export interface AlphalistItem {
  payeeId: string;
  payeeName: string;
  payeeTin: string | null;
  payeeAddress: string | null;
  atc: string;
  taxRate: number;
  taxBase: number;
  taxWithheld: number;
  period: string; // YYYY-MM or YYYY-Qx
  validationStatus: 'VALID' | 'MISSING_TIN' | 'UNASSIGNED_ATC' | 'INVALID_TIN';
}

export interface AlphalistReport {
  companyId: string;
  reportType: 'MAP' | 'SAWT';
  period: string;
  payor: { name: string; tin: string | null; address: string | null };
  items: AlphalistItem[];
  summary: {
    totalPayees: number;
    totalTaxBase: number;
    totalTaxWithheld: number;
  };
}

export class AlphalistService {
  /**
   * Ensure authoritative BIR ATCs are seeded in the database
   */
  public static async seedDefaultATCs(): Promise<void> {
    const defaultATCs = [
      { code: 'WI160', description: 'Professional services (Individual)', incomeType: 'Professional', taxRate: 0.10, taxpayerClassification: 'INDIVIDUAL', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 2-98 as amended' },
      { code: 'WI161', description: 'Professional services (Corporate/Non-Individual)', incomeType: 'Professional', taxRate: 0.05, taxpayerClassification: 'CORPORATE', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 2-98 as amended' },
      { code: 'WC158', description: 'Rental of real/personal property (Corporation)', incomeType: 'Rental', taxRate: 0.05, taxpayerClassification: 'CORPORATE', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 2-98 as amended' },
      { code: 'WI158', description: 'Rental of real/personal property (Individual)', incomeType: 'Rental', taxRate: 0.05, taxpayerClassification: 'INDIVIDUAL', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 2-98 as amended' },
      { code: 'WC160', description: 'Income payments to contractors/suppliers (Goods)', incomeType: 'Supplies/Goods', taxRate: 0.01, taxpayerClassification: 'ALL', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 2-98 as amended' },
      { code: 'WC162', description: 'Income payments to contractors/suppliers (Services)', incomeType: 'Services', taxRate: 0.02, taxpayerClassification: 'ALL', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 2-98 as amended' },
      { code: 'WC100', description: 'Rentals on Real Property (Corporations)', incomeType: 'Rental', taxRate: 0.05, taxpayerClassification: 'CORPORATE', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WI100', description: 'Rentals on Real Property (Individuals)', incomeType: 'Rental', taxRate: 0.05, taxpayerClassification: 'INDIVIDUAL', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WC120', description: 'Payments to Contractors / Subcontractors (Corp)', incomeType: 'Services', taxRate: 0.02, taxpayerClassification: 'CORPORATE', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WI120', description: 'Payments to Contractors / Subcontractors (Indiv)', incomeType: 'Services', taxRate: 0.02, taxpayerClassification: 'INDIVIDUAL', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WC010', description: 'Professional Fees (Corp > P720k)', incomeType: 'Professional', taxRate: 0.15, taxpayerClassification: 'CORPORATE', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WC011', description: 'Professional Fees (Corp <= P720k)', incomeType: 'Professional', taxRate: 0.10, taxpayerClassification: 'CORPORATE', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WI010', description: 'Professional Fees (Indiv > P3M / VAT)', incomeType: 'Professional', taxRate: 0.10, taxpayerClassification: 'INDIVIDUAL', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WI011', description: 'Professional Fees (Indiv <= P3M Non-VAT)', incomeType: 'Professional', taxRate: 0.05, taxpayerClassification: 'INDIVIDUAL', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WC156', description: 'Top Withholding Agent - Goods (Corp)', incomeType: 'Supplies/Goods', taxRate: 0.01, taxpayerClassification: 'CORPORATE', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WI156', description: 'Top Withholding Agent - Goods (Indiv)', incomeType: 'Supplies/Goods', taxRate: 0.01, taxpayerClassification: 'INDIVIDUAL', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WC157', description: 'Top Withholding Agent - Services (Corp)', incomeType: 'Services', taxRate: 0.02, taxpayerClassification: 'CORPORATE', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WI157', description: 'Top Withholding Agent - Services (Indiv)', incomeType: 'Services', taxRate: 0.02, taxpayerClassification: 'INDIVIDUAL', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WC140', description: 'Brokers / Real Estate Agents (Corp)', incomeType: 'Commission', taxRate: 0.10, taxpayerClassification: 'CORPORATE', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
      { code: 'WI140', description: 'Brokers / Real Estate Agents (Indiv)', incomeType: 'Commission', taxRate: 0.10, taxpayerClassification: 'INDIVIDUAL', formReference: '2307 / 1601EQ', sourceMetadata: 'BIR RR No. 11-2018' },
    ];

    for (const atc of defaultATCs) {
      try {
        const existing = await db.select().from(schema.atcDefinitions).where(eq(schema.atcDefinitions.code, atc.code));
        if (existing.length === 0) {
          await db.insert(schema.atcDefinitions).values({
            id: `atc_${atc.code.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            code: atc.code,
            description: atc.description,
            incomeType: atc.incomeType,
            taxRate: atc.taxRate,
            taxpayerClassification: atc.taxpayerClassification,
            formReference: atc.formReference,
            sourceMetadata: atc.sourceMetadata,
            status: 'ACTIVE',
          });
        }
      } catch (err) {
        // Ignore duplicate seeding conflicts
      }
    }
  }

  /**
   * Generate MAP (Monthly Alphalist of Payees)
   */
  public static async generateMAP(
    companyId: string,
    yearMonth: string // YYYY-MM
  ): Promise<AlphalistReport> {
    await this.seedDefaultATCs();

    const [yearStr, monthStr] = yearMonth.split('-');
    const startDate = `${yearMonth}-01`;
    const lastDay = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0).getDate();
    const endDate = `${yearMonth}-${lastDay < 10 ? '0' + lastDay : lastDay}`;

    // Get company details
    const companyRecords = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
    const company = companyRecords[0];
    const payor = {
      name: company?.legalName || 'Unknown Company',
      tin: company?.tin || null,
      address: company?.address || null,
    };

    // Fetch posted purchase bills in the month
    const bills = await db.select({
      id: schema.purchaseBills.id,
      vendorId: schema.purchaseBills.vendorId,
      billDate: schema.purchaseBills.billDate,
    })
    .from(schema.purchaseBills)
    .where(
      and(
        eq(schema.purchaseBills.companyId, companyId),
        sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
        gte(schema.purchaseBills.billDate, startDate),
        lte(schema.purchaseBills.billDate, endDate)
      )
    );

    const vendors = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId)) as (typeof schema.vendors.$inferSelect)[];
    const vendorMap = new Map(vendors.map(v => [v.id, v]));

    // Fetch ATC definitions
    const atcRecords = await db.select().from(schema.atcDefinitions) as (typeof schema.atcDefinitions.$inferSelect)[];
    const atcMap = new Map(atcRecords.map(a => [a.code, a]));

    const billIds = bills.map(b => b.id);
    const allLines = billIds.length > 0
      ? await db.select({
          billId: schema.purchaseBillLines.billId,
          amount: schema.purchaseBillLines.amount,
          taxCodeId: schema.purchaseBillLines.taxCodeId,
        })
        .from(schema.purchaseBillLines)
        .where(inArray(schema.purchaseBillLines.billId, billIds))
      : [];

    const taxCodeIds = Array.from(new Set(allLines.map(l => l.taxCodeId).filter(Boolean))) as string[];
    const taxCodes = taxCodeIds.length > 0
      ? await db.select().from(schema.taxCodes).where(inArray(schema.taxCodes.id, taxCodeIds)) as (typeof schema.taxCodes.$inferSelect)[]
      : [];
    const taxCodeMap = new Map(taxCodes.map(tc => [tc.id, tc]));

    const linesByBillId = new Map<string, typeof allLines>();
    for (const line of allLines) {
      const list = linesByBillId.get(line.billId) || [];
      list.push(line);
      linesByBillId.set(line.billId, list);
    }

    const aggregatedMap = new Map<string, {
      payeeId: string;
      payeeName: string;
      payeeTin: string | null;
      payeeAddress: string | null;
      atc: string;
      taxRate: number;
      taxBase: number;
      taxWithheld: number;
    }>();

    for (const bill of bills) {
      const vendor = vendorMap.get(bill.vendorId);
      if (!vendor) continue;

      const lines = linesByBillId.get(bill.id) || [];
      let billBase = lines.reduce((acc, l) => acc + l.amount, 0);
      billBase = Math.round(billBase * 100) / 100;

      let atcCode = 'UNASSIGNED_ATC';
      let taxRate = 0;

      for (const line of lines) {
        if (line.taxCodeId) {
          const tc = taxCodeMap.get(line.taxCodeId);
          if (tc && tc.code) {
            atcCode = tc.code.trim().toUpperCase();
            const atcDef = atcMap.get(atcCode);
            if (atcDef) {
              taxRate = Number(atcDef.taxRate || 0);
            } else if (typeof (tc as any).rate === 'number' && Number((tc as any).rate) >= 0) {
              const rawRate = Number((tc as any).rate);
              taxRate = rawRate > 1 ? rawRate / 100 : rawRate;
            }
          }
        }
      }

      const taxWithheld = Math.round(Math.round(billBase * 100) * taxRate) / 100;
      const compositeKey = `${vendor.id}_${atcCode}`;

      if (aggregatedMap.has(compositeKey)) {
        const entry = aggregatedMap.get(compositeKey)!;
        entry.taxBase = Math.round((entry.taxBase + billBase) * 100) / 100;
        entry.taxWithheld = Math.round((entry.taxWithheld + taxWithheld) * 100) / 100;
      } else {
        aggregatedMap.set(compositeKey, {
          payeeId: vendor.id,
          payeeName: vendor.legalName,
          payeeTin: vendor.tin || null,
          payeeAddress: vendor.address || null,
          atc: atcCode,
          taxRate,
          taxBase: billBase,
          taxWithheld,
        });
      }
    }

    const items: AlphalistItem[] = Array.from(aggregatedMap.values()).map(item => {
      let validationStatus: 'VALID' | 'MISSING_TIN' | 'UNASSIGNED_ATC' | 'INVALID_TIN' = 'VALID';
      if (!item.payeeTin) {
        validationStatus = 'MISSING_TIN';
      } else if (!BirComplianceService.validateTin(item.payeeTin)) {
        validationStatus = 'INVALID_TIN';
      } else if (item.atc === 'UNASSIGNED_ATC') {
        validationStatus = 'UNASSIGNED_ATC';
      }

      return {
        ...item,
        period: yearMonth,
        validationStatus,
      };
    });

    const totalPayees = items.length;
    const totalTaxBase = Math.round(items.reduce((acc, i) => acc + i.taxBase, 0) * 100) / 100;
    const totalTaxWithheld = Math.round(items.reduce((acc, i) => acc + i.taxWithheld, 0) * 100) / 100;

    return {
      companyId,
      reportType: 'MAP',
      period: yearMonth,
      payor,
      items,
      summary: {
        totalPayees,
        totalTaxBase,
        totalTaxWithheld,
      },
    };
  }

  /**
   * Generate SAWT (Summary Alphalist of Withholding Taxes) for a quarter (e.g. 2026-Q1)
   */
  public static async generateSAWT(
    companyId: string,
    quarterStr: string // YYYY-Q1, YYYY-Q2, YYYY-Q3, YYYY-Q4
  ): Promise<AlphalistReport> {
    const [year, qNum] = quarterStr.split('-Q');
    let startDate = '';
    let endDate = '';

    if (qNum === '1') {
      startDate = `${year}-01-01`;
      endDate = `${year}-03-31`;
    } else if (qNum === '2') {
      startDate = `${year}-04-01`;
      endDate = `${year}-06-30`;
    } else if (qNum === '3') {
      startDate = `${year}-07-01`;
      endDate = `${year}-09-30`;
    } else {
      startDate = `${year}-10-01`;
      endDate = `${year}-12-31`;
    }

    // Aggregate monthly MAPs or fetch directly across the 3 months
    const months: string[] = [];
    if (qNum === '1') months.push(`${year}-01`, `${year}-02`, `${year}-03`);
    else if (qNum === '2') months.push(`${year}-04`, `${year}-05`, `${year}-06`);
    else if (qNum === '3') months.push(`${year}-07`, `${year}-08`, `${year}-09`);
    else months.push(`${year}-10`, `${year}-11`, `${year}-12`);

    const combinedMap = new Map<string, AlphalistItem>();
    let payorInfo = { name: 'Unknown Company', tin: null as string | null, address: null as string | null };

    for (const m of months) {
      const monthlyReport = await this.generateMAP(companyId, m);
      payorInfo = monthlyReport.payor;
      for (const item of monthlyReport.items) {
        const key = `${item.payeeId}_${item.atc}`;
        if (combinedMap.has(key)) {
          const existing = combinedMap.get(key)!;
          existing.taxBase += item.taxBase;
          existing.taxWithheld += item.taxWithheld;
        } else {
          combinedMap.set(key, {
            ...item,
            period: quarterStr,
          });
        }
      }
    }

    const items = Array.from(combinedMap.values());
    const totalTaxBase = items.reduce((acc, i) => acc + i.taxBase, 0);
    const totalTaxWithheld = items.reduce((acc, i) => acc + i.taxWithheld, 0);

    return {
      companyId,
      reportType: 'SAWT',
      period: quarterStr,
      payor: payorInfo,
      items,
      summary: {
        totalPayees: items.length,
        totalTaxBase,
        totalTaxWithheld,
      },
    };
  }

  /**
   * Export Alphalist (MAP or SAWT) to JSON/CSV/PDF with Audit logging EXPORT_ALPHALIST
   */
  public static async exportAlphalistReport(
    companyId: string,
    reportType: 'MAP' | 'SAWT',
    period: string,
    format: 'json' | 'csv' | 'pdf',
    req?: any
  ): Promise<string | Buffer> {
    const report = reportType === 'MAP' ? await this.generateMAP(companyId, period) : await this.generateSAWT(companyId, period);

    const headers = ['Payee Name', 'Payee TIN', 'Address', 'ATC', 'Tax Rate', 'Tax Base', 'Tax Withheld', 'Status'];
    const rows = report.items.map(i => [
      i.payeeName,
      i.payeeTin || 'MISSING',
      i.payeeAddress || '',
      i.atc,
      `${(i.taxRate * 100).toFixed(1)}%`,
      i.taxBase,
      i.taxWithheld,
      i.validationStatus
    ]);

    const totals = ['Total', '', '', '', '', report.summary.totalTaxBase, report.summary.totalTaxWithheld, ''];

    const exportOptions: ServerExportOptions = {
      companyId,
      companyName: report.payor.name,
      reportTitle: `BIR Alphalist Report (${reportType}) - ${period}`,
      subtitle: `Payor TIN: ${report.payor.tin || 'N/A'}`,
      generatedBy: req?.user?.email || 'System Accountant',
      reportPeriod: period,
      headers,
      rows,
      totals,
      userRole: req?.activeCompany?.role || 'Company Administrator',
      requiredRole: 'Accountant',
      isSensitive: true,
      req,
    };

    // Audit log with specific EXPORT_ALPHALIST action
    try {
      await AuditService.log({
        req,
        companyId,
        userId: req?.user?.id,
        userEmail: req?.user?.email,
        userDisplayName: req?.user?.email || 'System Accountant',
        role: req?.activeCompany?.role,
        action: 'EXPORT_ALPHALIST',
        entityType: 'AlphalistReport',
        entityId: `${reportType}_${period}`,
        entityName: `${reportType} Report ${period}`,
        recordReference: `Type: ${reportType} | Period: ${period} | Payees: ${report.summary.totalPayees}`,
        result: 'SUCCESS',
        module: 'Compliance',
        severity: 'INFO',
        metadata: {
          reportType,
          period,
          totalPayees: report.summary.totalPayees,
          totalTaxBase: report.summary.totalTaxBase,
          totalTaxWithheld: report.summary.totalTaxWithheld,
          format: format.toUpperCase()
        }
      });
    } catch (err) {
      console.error('Failed to log EXPORT_ALPHALIST audit:', err);
    }

    if (format === 'json') {
      return ExportService.generateJSON(exportOptions);
    } else if (format === 'csv') {
      return ExportService.generateCSV(exportOptions);
    } else {
      return ExportService.generateJSON(exportOptions);
    }
  }

  private static normalizeBirTin(tin: string | null | undefined): { tin9: string; branch4: string } {
    const digits = String(tin || '').replace(/[^0-9]/g, '');
    const tin9 = digits.slice(0, 9).padEnd(9, '0');
    const branch4 = (digits.slice(9, 13) || '0000').padStart(4, '0').slice(0, 4);
    return { tin9, branch4 };
  }

  /**
   * Formats a MAP report into BIR Relief / Alphalist Data Entry DAT text format.
   */
  public static formatMAPToBIRDat(report: AlphalistReport): string {
    const payorTin = this.normalizeBirTin(report.payor?.tin);
    const periodParts = String(report.period || '').split('-');
    const year = periodParts[0] || String(new Date().getFullYear());
    const month = periodParts[1] || '01';
    const header = `HMAP,H1601EQ,${payorTin.tin9},${payorTin.branch4},"${(report.payor?.name || '').replace(/"/g, '')}",${month}/${year}`;
    const detailLines = report.items.map((item, idx) => {
      const payeeTin = this.normalizeBirTin(item.payeeTin);
      return [
        'DMAP',
        'D1601EQ',
        idx + 1,
        payeeTin.tin9,
        payeeTin.branch4,
        `"${(item.payeeName || '').replace(/"/g, '')}"`,
        item.atc,
        Number(item.taxBase || 0).toFixed(2),
        Number((item.taxRate || 0) * 100).toFixed(2),
        Number(item.taxWithheld || 0).toFixed(2),
        item.validationStatus,
      ].join(',');
    });
    const footer = [
      'CMAP',
      'C1601EQ',
      payorTin.tin9,
      payorTin.branch4,
      report.items.length,
      Number(report.summary?.totalTaxBase || 0).toFixed(2),
      Number(report.summary?.totalTaxWithheld || 0).toFixed(2),
    ].join(',');
    return [header, ...detailLines, footer].join('\r\n');
  }

  /**
   * Formats a SAWT report into BIR Alphalist Data Entry DAT text format.
   */
  public static formatSAWTToBIRDat(report: AlphalistReport): string {
    const payorTin = this.normalizeBirTin(report.payor?.tin);
    const header = `HSAWT,H1702Q,${payorTin.tin9},${payorTin.branch4},"${(report.payor?.name || '').replace(/"/g, '')}",${report.period}`;
    const detailLines = report.items.map((item, idx) => {
      const payeeTin = this.normalizeBirTin(item.payeeTin);
      return [
        'DSAWT',
        'D1702Q',
        idx + 1,
        payeeTin.tin9,
        payeeTin.branch4,
        `"${(item.payeeName || '').replace(/"/g, '')}"`,
        item.atc,
        Number(item.taxBase || 0).toFixed(2),
        Number((item.taxRate || 0) * 100).toFixed(2),
        Number(item.taxWithheld || 0).toFixed(2),
        item.validationStatus,
      ].join(',');
    });
    const footer = [
      'CSAWT',
      'C1702Q',
      payorTin.tin9,
      payorTin.branch4,
      report.items.length,
      Number(report.summary?.totalTaxBase || 0).toFixed(2),
      Number(report.summary?.totalTaxWithheld || 0).toFixed(2),
    ].join(',');
    return [header, ...detailLines, footer].join('\r\n');
  }
}
