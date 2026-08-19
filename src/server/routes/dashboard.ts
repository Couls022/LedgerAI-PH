import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requireMinRole, requirePermission } from "../auth";
import { eq, and, sql, desc } from "drizzle-orm";

const router = Router();

router.get("/overview", requireAuth, requirePermission('dashboard:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    // 1. Calculate AR Balance
    const arQuery = await db.select({ total: sql<number>`sum(balance_due)` })
      .from(schema.salesInvoices)
      .where(and(eq(schema.salesInvoices.companyId, companyId), eq(schema.salesInvoices.status, "POSTED")));
    const accountsReceivable = arQuery[0]?.total || 0;

    // 2. Calculate AP Balance
    const apQuery = await db.select({ total: sql<number>`sum(balance_due)` })
      .from(schema.purchaseBills)
      .where(and(eq(schema.purchaseBills.companyId, companyId), eq(schema.purchaseBills.status, "POSTED")));
    const accountsPayable = apQuery[0]?.total || 0;

    // 3. Calculate Cash Balance
    const cashQuery = await db.select({
      balance: sql<number>`sum(case when ${schema.accounts.normalBalance} = 'DEBIT' then ${schema.journalLines.debit} - ${schema.journalLines.credit} else ${schema.journalLines.credit} - ${schema.journalLines.debit} end)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, "POSTED"),
        eq(schema.accounts.accountType, "ASSET"),
        sql`${schema.accounts.accountName} LIKE '%Cash%' OR ${schema.accounts.accountName} LIKE '%Bank%'`
      )
    );
    const cashBalance = cashQuery[0]?.balance || 0;

    // 4. Monthly Revenue & Expense trends for past 12 months
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    const monthlyTrends = [];
    
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = `${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`;
      const shortMonth = monthNames[d.getMonth()];
      
      const revBase = 0;
      const expBase = 0;

      // Check if there are real posted sales invoices / purchase bills for this month
      const yyyyMm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      
      const monthRevQuery = await db.select({ total: sql<number>`sum(total_amount)` })
        .from(schema.salesInvoices)
        .where(and(
            eq(schema.salesInvoices.companyId, companyId), 
            eq(schema.salesInvoices.status, "POSTED"),
            sql`strftime('%Y-%m', ${schema.salesInvoices.invoiceDate}) = ${yyyyMm}`
        ));
      
      const monthExpQuery = await db.select({ total: sql<number>`sum(total_amount)` })
        .from(schema.purchaseBills)
        .where(and(
            eq(schema.purchaseBills.companyId, companyId), 
            eq(schema.purchaseBills.status, "POSTED"),
            sql`strftime('%Y-%m', ${schema.purchaseBills.billDate}) = ${yyyyMm}`
        ));

      const actualRev = monthRevQuery[0]?.total || 0;
      const actualExp = monthExpQuery[0]?.total || 0;

      const revenue = revBase + actualRev;
      const expenses = expBase + actualExp;
      const netProfit = revenue - expenses;
      const margin = revenue > 0 ? ((netProfit / revenue) * 100) : 0;

      monthlyTrends.push({
        month: shortMonth,
        fullMonth: monthLabel,
        year: d.getFullYear(),
        revenue,
        expenses,
        netProfit,
        margin: Math.round(margin * 10) / 10
      });
    }

    // 5. Expense Breakdown Categories
    const expenseBreakdownQuery = await db.select({
      category: schema.cashTransactions.type,
      amount: sql<number>`sum(total_amount)`
    })
    .from(schema.cashTransactions)
    .where(and(
      eq(schema.cashTransactions.companyId, companyId),
      eq(schema.cashTransactions.status, "POSTED")
    ))
    .groupBy(schema.cashTransactions.type);
    
    const defaultColors = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6"];
    const expenseBreakdown = expenseBreakdownQuery.map((eb, idx) => ({
      category: eb.category || "Uncategorized",
      amount: eb.amount || 0,
      color: defaultColors[idx % defaultColors.length]
    }));

    // 6. Recent Activities
    const activities = await db.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.companyId, companyId))
      .orderBy(desc(schema.auditLogs.timestamp))
      .limit(10);

    // 7. Top 3 Pending Invoices
    const pendingInvoicesQuery = await db.select({
      id: schema.salesInvoices.id,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      customerName: schema.customers.legalName,
      totalAmount: schema.salesInvoices.totalAmount,
      balanceDue: schema.salesInvoices.balanceDue,
      dueDate: schema.salesInvoices.dueDate,
      status: schema.salesInvoices.status,
      invoiceDate: schema.salesInvoices.invoiceDate,
    })
    .from(schema.salesInvoices)
    .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
    .where(and(
      eq(schema.salesInvoices.companyId, companyId),
      sql`${schema.salesInvoices.status} != 'PAID' AND ${schema.salesInvoices.status} != 'VOID'`
    ))
    .orderBy(desc(schema.salesInvoices.invoiceDate))
    .limit(3);
    const pendingInvoices = pendingInvoicesQuery;

    // 8. Current Month Tax Liability Estimate
    const currentYyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    
    const currentMonthSales = await db.select({ total: sql<number>`sum(total_amount)` })
      .from(schema.salesInvoices)
      .where(and(
        eq(schema.salesInvoices.companyId, companyId),
        eq(schema.salesInvoices.status, "POSTED"),
        sql`strftime('%Y-%m', ${schema.salesInvoices.invoiceDate}) = ${currentYyyyMm}`
      ));
      
    const currentMonthBills = await db.select({ total: sql<number>`sum(total_amount)` })
      .from(schema.purchaseBills)
      .where(and(
        eq(schema.purchaseBills.companyId, companyId),
        eq(schema.purchaseBills.status, "POSTED"),
        sql`strftime('%Y-%m', ${schema.purchaseBills.billDate}) = ${currentYyyyMm}`
      ));

    const currentRevCentavos = currentMonthSales[0]?.total || 0;
    const currentExpCentavos = currentMonthBills[0]?.total || 0;
    
    const outputVat = Math.round(currentRevCentavos * 0.12);
    const inputVat = Math.round(currentExpCentavos * 0.12);
    const ewtWithheld = Math.round(currentRevCentavos * 0.02);
    const netVatPayable = Math.max(0, outputVat - inputVat);
    const estimatedTaxLiability = Math.max(0, netVatPayable - ewtWithheld);
    
    const nextMonth20th = new Date(now.getFullYear(), now.getMonth() + 1, 20).toISOString().slice(0, 10);
    
    const taxEstimate = {
      currentMonth: currentMonthName,
      outputVat,
      inputVat,
      ewtWithheld,
      netVatPayable,
      estimatedTaxLiability: estimatedTaxLiability,
      dueDateNotice: `BIR Form 2550M due by ${nextMonth20th}`
    };

    const complianceStatus = "On Track";

    // Summary YTD stats
    const totalYtdRevenue = monthlyTrends.reduce((acc, curr) => acc + curr.revenue, 0);
    const totalYtdExpenses = monthlyTrends.reduce((acc, curr) => acc + curr.expenses, 0);
    const totalYtdNetProfit = totalYtdRevenue - totalYtdExpenses;
    const avgProfitMargin = totalYtdRevenue > 0 ? ((totalYtdNetProfit / totalYtdRevenue) * 100) : 0;

    const hasAccounting = req.permissions?.includes('accounting:view') || false;
    const hasSales = req.permissions?.includes('sales:view') || false;
    const hasPurchases = req.permissions?.includes('purchases:view') || false;
    const hasTax = req.permissions?.includes('tax:view') || false;
    const hasAudit = req.permissions?.includes('audit:view') || false;

    res.json({
      cashBalance: hasAccounting ? cashBalance : 0,
      accountsReceivable: (hasSales || hasAccounting) ? accountsReceivable : 0,
      accountsPayable: (hasPurchases || hasAccounting) ? accountsPayable : 0,
      complianceStatus,
      summaryStats: hasAccounting ? {
        totalYtdRevenue,
        totalYtdExpenses,
        totalYtdNetProfit,
        avgProfitMargin: Math.round(avgProfitMargin * 10) / 10,
      } : {
        totalYtdRevenue: 0,
        totalYtdExpenses: 0,
        totalYtdNetProfit: 0,
        avgProfitMargin: 0,
      },
      monthlyTrends: hasAccounting ? monthlyTrends : [],
      expenseBreakdown: hasAccounting ? expenseBreakdown : [],
      activities: (hasAudit || hasAccounting) ? activities : [],
      pendingInvoices: hasSales ? pendingInvoices : [],
      taxEstimate: hasTax ? taxEstimate : null
    });

  } catch (error: any) {
    console.error("Dashboard error:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: error.message });
  }
});

export default router;
