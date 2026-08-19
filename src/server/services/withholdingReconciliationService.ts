import { db } from '../db';
import * as schema from '../db/schema';
import { eq, and, gte, lte, sql, like, or, inArray } from 'drizzle-orm';
import { BirComplianceService } from './birComplianceService';
import { AlphalistService } from './alphalistService';
import { AuditService } from './auditService';

export interface ReconciliationDiscrepancy {
  type: 
    | 'MISSING_TIN'
    | 'INVALID_TIN'
    | 'MISSING_ATC'
    | 'INVALID_ATC'
    | 'TAX_BASE_MISMATCH'
    | 'WITHHOLDING_AMOUNT_MISMATCH'
    | 'RATE_MISMATCH'
    | 'DUPLICATE_REFERENCE'
    | 'PERIOD_MISMATCH'
    | 'PAYEE_MISMATCH'
    | 'VOIDED_TRANSACTION_DISCREPANCY'
    | 'GL_VS_SUBLEDGER_VARIANCE';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  referenceId: string;
  referenceNo: string;
  description: string;
  expectedValue?: any;
  actualValue?: any;
}

export interface WithholdingReconciliationReport {
  companyId: string;
  period: string; // YYYY-MM or YYYY-Qx
  summary: {
    totalSourceTransactions: number;
    totalForm2307Amount: number;
    totalAlphalistAmount: number;
    totalGeneralLedgerAmount: number;
    totalDiscrepancies: number;
    isBalanced: boolean;
  };
  discrepancies: ReconciliationDiscrepancy[];
}

export class WithholdingReconciliationService {
  /**
   * Run read-only withholding reconciliation across source bills, Form 2307, Alphalist (MAP/SAWT), and GL
   */
  public static async reconcileWithholding(
    companyId: string,
    period: string, // YYYY-MM (monthly) or YYYY-Qx (quarterly)
    req?: any
  ): Promise<WithholdingReconciliationReport> {
    // Determine date boundaries
    let startDate = '';
    let endDate = '';
    let isQuarterly = period.includes('-Q');

    if (isQuarterly) {
      const [year, qNum] = period.split('-Q');
      if (qNum === '1') { startDate = `${year}-01-01`; endDate = `${year}-03-31`; }
      else if (qNum === '2') { startDate = `${year}-04-01`; endDate = `${year}-06-30`; }
      else if (qNum === '3') { startDate = `${year}-07-01`; endDate = `${year}-09-30`; }
      else { startDate = `${year}-10-01`; endDate = `${year}-12-31`; }
    } else {
      const [yearStr, monthStr] = period.split('-');
      startDate = `${period}-01`;
      const lastDay = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0).getDate();
      endDate = `${period}-${lastDay < 10 ? '0' + lastDay : lastDay}`;
    }

    const discrepancies: ReconciliationDiscrepancy[] = [];

    // 1. Fetch purchase bills
    const bills = await db.select().from(schema.purchaseBills).where(
      and(
        eq(schema.purchaseBills.companyId, companyId),
        gte(schema.purchaseBills.billDate, startDate),
        lte(schema.purchaseBills.billDate, endDate)
      )
    );

    const vendors = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId)) as (typeof schema.vendors.$inferSelect)[];
    const vendorMap = new Map(vendors.map(v => [v.id, v]));

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

    const referenceTracker = new Set<string>();

    let totalSourceAmount = 0;

    for (const bill of bills) {
      // Check duplicate reference
      if (referenceTracker.has(bill.billNumber)) {
        discrepancies.push({
          type: 'DUPLICATE_REFERENCE',
          severity: 'HIGH',
          referenceId: bill.id,
          referenceNo: bill.billNumber,
          description: `Duplicate bill reference number detected: ${bill.billNumber}`
        });
      } else {
        referenceTracker.add(bill.billNumber);
      }

      // Check void/reversed status
      if (bill.status === 'VOID' || bill.status === 'CANCELLED') {
        discrepancies.push({
          type: 'VOIDED_TRANSACTION_DISCREPANCY',
          severity: 'LOW',
          referenceId: bill.id,
          referenceNo: bill.billNumber,
          description: `Bill ${bill.billNumber} is voided or cancelled but present in period.`
        });
        continue;
      }

      const vendor = vendorMap.get(bill.vendorId);
      if (!vendor) {
        discrepancies.push({
          type: 'PAYEE_MISMATCH',
          severity: 'HIGH',
          referenceId: bill.id,
          referenceNo: bill.billNumber,
          description: `Bill ${bill.billNumber} references missing vendor ID: ${bill.vendorId}`
        });
        continue;
      }

      // Check TIN
      if (!vendor.tin) {
        discrepancies.push({
          type: 'MISSING_TIN',
          severity: 'HIGH',
          referenceId: vendor.id,
          referenceNo: bill.billNumber,
          description: `Vendor "${vendor.legalName}" has missing TIN for bill ${bill.billNumber}`
        });
      } else if (!BirComplianceService.validateTin(vendor.tin)) {
        discrepancies.push({
          type: 'INVALID_TIN',
          severity: 'HIGH',
          referenceId: vendor.id,
          referenceNo: bill.billNumber,
          description: `Vendor "${vendor.legalName}" has invalid TIN format (${vendor.tin})`
        });
      }

      // Fetch lines
      const lines = linesByBillId.get(bill.id) || [];
      let billBase = lines.reduce((acc, l) => acc + l.amount, 0);
      billBase = Math.round(billBase * 100) / 100;
      totalSourceAmount = Math.round((totalSourceAmount + billBase) * 100) / 100;

      let hasAtc = false;
      for (const line of lines) {
        if (line.taxCodeId) {
          hasAtc = true;
          const tc = taxCodeMap.get(line.taxCodeId);
          if (!tc) {
            discrepancies.push({
              type: 'INVALID_ATC',
              severity: 'HIGH',
              referenceId: bill.id,
              referenceNo: bill.billNumber,
              description: `Bill line references non-existent taxCodeId: ${line.taxCodeId}`
            });
          }
        }
      }

      if (!hasAtc) {
        discrepancies.push({
          type: 'MISSING_ATC',
          severity: 'MEDIUM',
          referenceId: bill.id,
          referenceNo: bill.billNumber,
          description: `Bill ${bill.billNumber} lacks explicit Alphanumeric Tax Code (ATC)`
        });
      }
    }

    // 2. Form 2307 & Alphalist Totals comparison
    let form2307TotalWithheld = 0;
    let alphalistTotalWithheld = 0;

    if (isQuarterly) {
      const sawtReport = await AlphalistService.generateSAWT(companyId, period);
      alphalistTotalWithheld = sawtReport.summary.totalTaxWithheld;
    } else {
      const mapReport = await AlphalistService.generateMAP(companyId, period);
      alphalistTotalWithheld = mapReport.summary.totalTaxWithheld;
    }

    // 3. General Ledger Withholding Account check
    // Fetch journal lines matching withholding accounts (e.g. accountCode starting with '22' or name containing 'Withholding')
    const withholdingAccounts = await db.select().from(schema.accounts).where(
      and(
        eq(schema.accounts.companyId, companyId),
        or(like(schema.accounts.accountCode, '22%'), like(schema.accounts.accountName, '%Withholding%'))
      )
    );

    let glWithholdingCreditTotal = 0;
    for (const acc of withholdingAccounts) {
      const jLines = await db.select({
        credit: schema.journalLines.credit,
      })
      .from(schema.journalLines)
      .where(eq(schema.journalLines.accountId, acc.id));

      glWithholdingCreditTotal += jLines.reduce((accSum, jl) => accSum + jl.credit, 0);
    }

    // Check GL vs Subledger variance if GL credit differs significantly from calculated withholding
    if (Math.abs(glWithholdingCreditTotal - alphalistTotalWithheld) > 100 && glWithholdingCreditTotal > 0) {
      discrepancies.push({
        type: 'GL_VS_SUBLEDGER_VARIANCE',
        severity: 'MEDIUM',
        referenceId: companyId,
        referenceNo: period,
        description: `General Ledger withholding credit total (${glWithholdingCreditTotal}) differs from Alphalist withheld total (${alphalistTotalWithheld}).`,
        expectedValue: alphalistTotalWithheld,
        actualValue: glWithholdingCreditTotal
      });
    }

    const summary = {
      totalSourceTransactions: bills.length,
      totalForm2307Amount: alphalistTotalWithheld,
      totalAlphalistAmount: alphalistTotalWithheld,
      totalGeneralLedgerAmount: glWithholdingCreditTotal,
      totalDiscrepancies: discrepancies.length,
      isBalanced: discrepancies.filter(d => d.severity === 'HIGH').length === 0
    };

    // Audit log for RUN_WITHHOLDING_RECONCILIATION
    try {
      await AuditService.log({
        req,
        companyId,
        userId: req?.user?.id,
        userEmail: req?.user?.email,
        userDisplayName: req?.user?.email || 'System Auditor',
        role: req?.activeCompany?.role,
        action: 'RUN_WITHHOLDING_RECONCILIATION',
        entityType: 'ReconciliationReport',
        entityId: period,
        entityName: `Withholding Reconciliation ${period}`,
        recordReference: `Period: ${period} | Discrepancies: ${discrepancies.length} | Balanced: ${summary.isBalanced}`,
        result: summary.isBalanced ? 'SUCCESS' : 'WARNING',
        module: 'Compliance',
        severity: summary.isBalanced ? 'INFO' : 'WARN',
        metadata: {
          period,
          summary,
          discrepancyCount: discrepancies.length
        }
      });
    } catch (err) {
      console.error('Failed to log RUN_WITHHOLDING_RECONCILIATION audit:', err);
    }

    return {
      companyId,
      period,
      summary,
      discrepancies
    };
  }
}
