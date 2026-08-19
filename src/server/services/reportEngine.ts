import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { getAccountsReceivableSummary, getAccountsPayableSummary, AccountsReceivableSummaryResult, AccountsPayableSummaryResult } from "./ai/tools/arApTools";

export class ReportEngine {
  static async getSalesSummary(companyId: string, startDate?: string, endDate?: string) {
    const conditions = [
      eq(schema.salesInvoices.companyId, companyId),
      eq(schema.salesInvoices.status, 'POSTED')
    ];
    if (startDate) conditions.push(gte(schema.salesInvoices.invoiceDate, startDate));
    if (endDate) conditions.push(lte(schema.salesInvoices.invoiceDate, endDate));
    
    const invoices = await db.select().from(schema.salesInvoices).where(and(...conditions));
    const totalSales = invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
    return { totalSales, invoiceCount: invoices.length, invoices };
  }

  static async getExpenseSummary(companyId: string, startDate?: string, endDate?: string) {
    const conditions = [
      eq(schema.purchaseBills.companyId, companyId),
      eq(schema.purchaseBills.status, 'POSTED')
    ];
    if (startDate) conditions.push(gte(schema.purchaseBills.billDate, startDate));
    if (endDate) conditions.push(lte(schema.purchaseBills.billDate, endDate));
    
    const bills = await db.select().from(schema.purchaseBills).where(and(...conditions));
    const totalExpenses = bills.reduce((sum, bill) => sum + (bill.totalAmount || 0), 0);
    return { totalExpenses, billCount: bills.length, bills };
  }

  static async getFinancialSummary(companyId: string, startDate?: string, endDate?: string) {
    const sales = await this.getSalesSummary(companyId, startDate, endDate);
    const expenses = await this.getExpenseSummary(companyId, startDate, endDate);
    
    return {
      periodStart: startDate || "Beginning of Time",
      periodEnd: endDate || "Present",
      totalSales: sales.totalSales,
      totalExpenses: expenses.totalExpenses,
      netIncome: sales.totalSales - expenses.totalExpenses,
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
