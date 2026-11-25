import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getAccountsReceivableSummary, getAccountsPayableSummary, AccountsReceivableSummaryResult, AccountsPayableSummaryResult } from "./ai/tools/arApTools";
import { buildEffectivePostedJournalPredicate, isOperationalPnlJournalSql, isRevenueAccountType, isExpenseAccountType, assertNoDuplicateReversalLineage } from "../routes/reports";

export class ReportEngine {
  static async getSalesSummary(companyId: string, startDate?: string, endDate?: string) {
    const conditions: any[] = [
      eq(schema.salesInvoices.companyId, companyId),
      sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
      sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`
    ];
    if (startDate) conditions.push(gte(schema.salesInvoices.invoiceDate, startDate));
    if (endDate) conditions.push(lte(schema.salesInvoices.invoiceDate, endDate));
    
    const rows = await db
      .select({ invoice: schema.salesInvoices })
      .from(schema.salesInvoices)
      .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
      .where(and(...conditions));
    const invoices = rows.map((r) => r.invoice);
    const totalSales = invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
    return { totalSales, invoiceCount: invoices.length, invoices };
  }

  static async getExpenseSummary(companyId: string, startDate?: string, endDate?: string) {
    const conditions: any[] = [
      eq(schema.purchaseBills.companyId, companyId),
      sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
      sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`
    ];
    if (startDate) conditions.push(gte(schema.purchaseBills.billDate, startDate));
    if (endDate) conditions.push(lte(schema.purchaseBills.billDate, endDate));
    
    const rows = await db
      .select({ bill: schema.purchaseBills })
      .from(schema.purchaseBills)
      .leftJoin(schema.journalEntries, eq(schema.purchaseBills.journalEntryId, schema.journalEntries.id))
      .where(and(...conditions));
    const bills = rows.map((r) => r.bill);
    const totalExpenses = bills.reduce((sum, bill) => sum + (bill.totalAmount || 0), 0);
    return { totalExpenses, billCount: bills.length, bills };
  }

  static async getGlPnlSummary(companyId: string, startDate?: string, endDate?: string) {
    if (startDate && endDate && startDate > endDate) {
      const err: any = new Error(`Invalid date range: startDate (${startDate}) cannot be after endDate (${endDate}).`);
      err.code = 'INVALID_DATE_RANGE';
      err.statusCode = 400;
      throw err;
    }
    await assertNoDuplicateReversalLineage(companyId);

    const conditions: any[] = [
      buildEffectivePostedJournalPredicate(companyId),
      isOperationalPnlJournalSql(),
    ];
    if (startDate) conditions.push(gte(schema.journalEntries.entryDate, startDate));
    if (endDate) conditions.push(lte(schema.journalEntries.entryDate, endDate));
    if (startDate || endDate) {
      conditions.push(sql`NOT EXISTS (
        SELECT 1 FROM accounting_periods ap_Check
        WHERE ap_Check.id = ${schema.journalEntries.accountingPeriodId}
          AND ap_Check.company_id = ${companyId}
          AND (
            ${endDate ? sql`ap_Check.start_date > ${endDate}` : sql`0`}
            OR
            ${startDate ? sql`ap_Check.end_date < ${startDate}` : sql`0`}
          )
      )`);
    }

    const rows = await db.select({
      accountType: schema.accounts.accountType,
      debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(and(...conditions))
    .groupBy(schema.accounts.accountType);

    let glTotalRevenue = 0;
    let glTotalExpenses = 0;
    for (const r of rows) {
      const deb = Number(r.debitTotal || 0);
      const cred = Number(r.creditTotal || 0);
      if (isRevenueAccountType(r.accountType) || r.accountType === 'INCOME') {
        glTotalRevenue += (cred - deb);
      } else if (isExpenseAccountType(r.accountType)) {
        glTotalExpenses += (deb - cred);
      }
    }

    return {
      glTotalRevenue,
      glTotalExpenses,
      glNetIncome: glTotalRevenue - glTotalExpenses,
    };
  }

  static async getFinancialSummary(companyId: string, startDate?: string, endDate?: string) {
    const [sales, expenses, glSummary] = await Promise.all([
      this.getSalesSummary(companyId, startDate, endDate),
      this.getExpenseSummary(companyId, startDate, endDate),
      this.getGlPnlSummary(companyId, startDate, endDate),
    ]);
    
    return {
      periodStart: startDate || "Beginning of Time",
      periodEnd: endDate || "Present",
      totalSales: sales.totalSales,
      totalExpenses: expenses.totalExpenses,
      netIncome: sales.totalSales - expenses.totalExpenses,
      glTotalRevenue: glSummary.glTotalRevenue,
      glTotalExpenses: glSummary.glTotalExpenses,
      glNetIncome: glSummary.glNetIncome,
      invoiceCount: sales.invoiceCount,
      billCount: expenses.billCount
    };
  }

  static async getAccountsReceivableSummary(companyId: string, asOfDate?: string, topCount?: number): Promise<AccountsReceivableSummaryResult> {
    return getAccountsReceivableSummary({ companyId, asOfDate, topCount });
  }

  static async getAccountsPayableSummary(companyId: string, asOfDate?: string, topCount?: number): Promise<AccountsPayableSummaryResult> {
    return getAccountsPayableSummary({ companyId, asOfDate, topCount });
  }
}
