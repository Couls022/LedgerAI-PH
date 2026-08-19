import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, sql, gte, lte, desc } from "drizzle-orm";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { TaxEngine } from "./taxEngine";
import { getAccountsReceivableSummary, getAccountsPayableSummary } from "./ai/tools/arApTools";

export interface MonthlyTrendData {
  month: string; // e.g. "2026-03"
  label: string; // e.g. "Mar 2026"
  revenue: number;
  expenses: number;
  netIncome: number;
  grossMarginPct: number;
  netMarginPct: number;
}

export interface ConcentrationMetric {
  entityId: string;
  name: string;
  code?: string;
  totalAmount: number;
  percentageOfTotal: number;
}

export interface FinancialAnalyticsReport {
  companyId: string;
  asOfDate: string;
  currency: string;
  trends: {
    monthly: MonthlyTrendData[];
    revenueGrowthMoM: number; // percentage
    expenseGrowthMoM: number; // percentage
    profitGrowthMoM: number; // percentage
    averageMonthlyRevenue: number;
    averageMonthlyExpenses: number;
  };
  margins: {
    grossProfit: number;
    grossMarginPercentage: number;
    netProfit: number;
    netProfitMarginPercentage: number;
    operatingExpenses: number;
  };
  cashFlow: {
    operatingCashInflow: number;
    operatingCashOutflow: number;
    netOperatingCashFlow: number;
    estimatedMonthlyBurnRate: number;
    estimatedCashRunwayMonths: number;
  };
  aging: {
    accountsReceivableTotal: number;
    arOverduePercentage: number;
    accountsPayableTotal: number;
    apOverduePercentage: number;
  };
  concentration: {
    customerTop3Share: number; // percentage
    customerTop5Share: number; // percentage
    isCustomerConcentrationHighRisk: boolean;
    topCustomers: ConcentrationMetric[];
    vendorTop3Share: number; // percentage
    vendorTop5Share: number; // percentage
    isVendorConcentrationHighRisk: boolean;
    topVendors: ConcentrationMetric[];
  };
  taxExposure: {
    estimatedVatPayable: number;
    estimatedIncomeTax: number;
    estimatedTaxRate: string;
    unutilizedWithholdingTax2307: number;
  };
  anomalies: Array<{
    type: 'EXPENSE_SPIKE' | 'REVENUE_DIP' | 'HIGH_VALUE_TRANSACTION' | 'ROUND_NUMBER_SURGE' | 'MARGIN_CONTRACTION';
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    description: string;
    metric: string;
    details?: Record<string, any>;
  }>;
  authoritativeSource: string;
}

export class AnalyticsEngine {
  /**
   * Generates comprehensive business intelligence, financial trends, concentration, and anomaly detection.
   */
  static async getFinancialAnalytics(companyId: string, monthsHistory: number = 6): Promise<FinancialAnalyticsReport> {
    const now = new Date();
    const asOfDate = format(now, 'yyyy-MM-dd');

    // 1. Fetch all posted invoices, bills, journals, and payments
    const postedInvoices = await db.select().from(schema.salesInvoices)
      .where(and(eq(schema.salesInvoices.companyId, companyId), eq(schema.salesInvoices.status, 'POSTED')));

    const postedBills = await db.select().from(schema.purchaseBills)
      .where(and(eq(schema.purchaseBills.companyId, companyId), eq(schema.purchaseBills.status, 'POSTED')));

    const customers = await db.select().from(schema.customers).where(eq(schema.customers.companyId, companyId));
    const vendors = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId));
    const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));

    // Customer / Vendor ID Map
    const custMap = new Map<string, string>(customers.map(c => [c.id, c.legalName || c.code || 'Customer']));
    const vendMap = new Map<string, string>(vendors.map(v => [v.id, v.legalName || v.code || 'Vendor']));

    // 2. Month-by-month trends for the past N months
    const monthlyTrends: MonthlyTrendData[] = [];
    for (let i = monthsHistory - 1; i >= 0; i--) {
      const targetMonthDate = subMonths(now, i);
      const start = format(startOfMonth(targetMonthDate), 'yyyy-MM-dd');
      const end = format(endOfMonth(targetMonthDate), 'yyyy-MM-dd');
      const monthKey = format(targetMonthDate, 'yyyy-MM');
      const monthLabel = format(targetMonthDate, 'MMM yyyy');

      const monthInvoices = postedInvoices.filter(inv => inv.invoiceDate >= start && inv.invoiceDate <= end);
      const monthBills = postedBills.filter(b => b.billDate >= start && b.billDate <= end);

      const rev = monthInvoices.reduce((s, inv) => s + (inv.totalAmount || 0), 0);
      const exp = monthBills.reduce((s, b) => s + (b.totalAmount || 0), 0);
      const net = rev - exp;
      const grossMarginPct = rev > 0 ? Number(((net / rev) * 100).toFixed(2)) : 0;
      const netMarginPct = rev > 0 ? Number(((net / rev) * 100).toFixed(2)) : 0;

      monthlyTrends.push({
        month: monthKey,
        label: monthLabel,
        revenue: rev,
        expenses: exp,
        netIncome: net,
        grossMarginPct,
        netMarginPct,
      });
    }

    // Growth rates comparison (Current month vs Previous month)
    const fallbackMonth: MonthlyTrendData = {
      month: '',
      label: '',
      revenue: 0,
      expenses: 0,
      netIncome: 0,
      grossMarginPct: 0,
      netMarginPct: 0,
    };
    const currentMonthData: MonthlyTrendData = monthlyTrends[monthlyTrends.length - 1] || fallbackMonth;
    const prevMonthData: MonthlyTrendData = monthlyTrends[monthlyTrends.length - 2] || fallbackMonth;

    const revenueGrowthMoM = prevMonthData.revenue > 0
      ? Number((((currentMonthData.revenue - prevMonthData.revenue) / prevMonthData.revenue) * 100).toFixed(2))
      : 0;

    const expenseGrowthMoM = prevMonthData.expenses > 0
      ? Number((((currentMonthData.expenses - prevMonthData.expenses) / prevMonthData.expenses) * 100).toFixed(2))
      : 0;

    const profitGrowthMoM = prevMonthData.netIncome !== 0
      ? Number((((currentMonthData.netIncome - prevMonthData.netIncome) / Math.abs(prevMonthData.netIncome)) * 100).toFixed(2))
      : 0;

    const totalHistoricalRev = monthlyTrends.reduce((s, m) => s + m.revenue, 0);
    const totalHistoricalExp = monthlyTrends.reduce((s, m) => s + m.expenses, 0);
    const averageMonthlyRevenue = Number((totalHistoricalRev / (monthlyTrends.length || 1)).toFixed(2));
    const averageMonthlyExpenses = Number((totalHistoricalExp / (monthlyTrends.length || 1)).toFixed(2));

    // 3. Margin Analysis
    const totalSalesAll = postedInvoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const totalExpensesAll = postedBills.reduce((s, b) => s + (b.totalAmount || 0), 0);
    const grossProfitAll = totalSalesAll - totalExpensesAll;
    const grossMarginPercentage = totalSalesAll > 0 ? Number(((grossProfitAll / totalSalesAll) * 100).toFixed(2)) : 0;
    const netProfitMarginPercentage = grossMarginPercentage;

    // 4. Cash Flow & Runway
    const cashAccounts = accounts.filter(a => a.isCashAccount || a.accountCode.startsWith('10') || a.accountCode.startsWith('11'));
    // Estimate liquid cash from posted invoices paid vs bills paid
    const totalCollected = postedInvoices.reduce((s, i) => s + (i.totalAmount - (i.balanceDue || 0)), 0);
    const totalDisbursed = postedBills.reduce((s, b) => s + (b.totalAmount - (b.balanceDue || 0)), 0);
    const netCashFlow = totalCollected - totalDisbursed;
    const estimatedMonthlyBurnRate = Math.max(0, averageMonthlyExpenses - averageMonthlyRevenue);
    const estimatedCashRunwayMonths = estimatedMonthlyBurnRate > 0 && totalCollected > totalDisbursed
      ? Number(((totalCollected - totalDisbursed) / estimatedMonthlyBurnRate).toFixed(1))
      : 99.0;

    // 5. Customer Concentration Analysis
    const custSalesMap = new Map<string, number>();
    for (const inv of postedInvoices) {
      const cId = inv.customerId || 'UNKNOWN';
      custSalesMap.set(cId, (custSalesMap.get(cId) || 0) + (inv.totalAmount || 0));
    }

    const customerList: ConcentrationMetric[] = [];
    for (const [cId, amt] of custSalesMap.entries()) {
      customerList.push({
        entityId: cId,
        name: custMap.get(cId) || 'Unknown Customer',
        totalAmount: amt,
        percentageOfTotal: totalSalesAll > 0 ? Number(((amt / totalSalesAll) * 100).toFixed(2)) : 0,
      });
    }
    customerList.sort((a, b) => b.totalAmount - a.totalAmount);

    const customerTop3Share = Number(customerList.slice(0, 3).reduce((s, c) => s + c.percentageOfTotal, 0).toFixed(2));
    const customerTop5Share = Number(customerList.slice(0, 5).reduce((s, c) => s + c.percentageOfTotal, 0).toFixed(2));
    const isCustomerConcentrationHighRisk = customerTop3Share >= 60;

    // 6. Vendor Concentration Analysis
    const vendSpendMap = new Map<string, number>();
    for (const b of postedBills) {
      const vId = b.vendorId || 'UNKNOWN';
      vendSpendMap.set(vId, (vendSpendMap.get(vId) || 0) + (b.totalAmount || 0));
    }

    const vendorList: ConcentrationMetric[] = [];
    for (const [vId, amt] of vendSpendMap.entries()) {
      vendorList.push({
        entityId: vId,
        name: vendMap.get(vId) || 'Unknown Vendor',
        totalAmount: amt,
        percentageOfTotal: totalExpensesAll > 0 ? Number(((amt / totalExpensesAll) * 100).toFixed(2)) : 0,
      });
    }
    vendorList.sort((a, b) => b.totalAmount - a.totalAmount);

    const vendorTop3Share = Number(vendorList.slice(0, 3).reduce((s, v) => s + v.percentageOfTotal, 0).toFixed(2));
    const vendorTop5Share = Number(vendorList.slice(0, 5).reduce((s, v) => s + v.percentageOfTotal, 0).toFixed(2));
    const isVendorConcentrationHighRisk = vendorTop3Share >= 60;

    // 7. AR & AP Aging
    const arSummary = await getAccountsReceivableSummary({ companyId, asOfDate });
    const apSummary = await getAccountsPayableSummary({ companyId, asOfDate });

    // 8. Tax Exposure Calculations
    const taxRules = await TaxEngine.getEngineRulesForCompany(companyId);
    const estimatedVatPayable = taxRules.vatStatusLabel.includes('VAT')
      ? Math.max(0, (totalSalesAll * 0.12) - (totalExpensesAll * 0.12))
      : 0;

    const estimatedTaxableIncome = Math.max(0, totalSalesAll - totalExpensesAll);
    const isMsme = estimatedTaxableIncome <= 5000000;
    const incomeTaxRate = isMsme ? 0.20 : 0.25;
    const estimatedIncomeTax = Number((estimatedTaxableIncome * incomeTaxRate).toFixed(2));

    // 9. Anomaly Detection
    const anomalies: FinancialAnalyticsReport['anomalies'] = [];

    // Expense spike anomaly
    if (expenseGrowthMoM > 25 && currentMonthData.expenses > 10000) {
      anomalies.push({
        type: 'EXPENSE_SPIKE',
        severity: 'HIGH',
        description: `Expenses increased sharply by ${expenseGrowthMoM}% this month (₱${currentMonthData.expenses.toLocaleString('en-PH', { minimumFractionDigits: 2 })} vs ₱${prevMonthData.expenses.toLocaleString('en-PH', { minimumFractionDigits: 2 })}).`,
        metric: `+${expenseGrowthMoM}% Expense MoM`,
        details: { currentMonth: currentMonthData.expenses, prevMonth: prevMonthData.expenses },
      });
    }

    // Revenue dip anomaly
    if (revenueGrowthMoM < -25 && prevMonthData.revenue > 10000) {
      anomalies.push({
        type: 'REVENUE_DIP',
        severity: 'HIGH',
        description: `Revenue dropped by ${Math.abs(revenueGrowthMoM)}% compared to the previous month.`,
        metric: `${revenueGrowthMoM}% Revenue MoM`,
        details: { currentMonth: currentMonthData.revenue, prevMonth: prevMonthData.revenue },
      });
    }

    // Margin contraction anomaly
    if (currentMonthData.grossMarginPct < 15 && currentMonthData.revenue > 0) {
      anomalies.push({
        type: 'MARGIN_CONTRACTION',
        severity: 'MEDIUM',
        description: `Gross profit margin has contracted to ${currentMonthData.grossMarginPct}%, indicating high cost of goods/services or pricing pressures.`,
        metric: `${currentMonthData.grossMarginPct}% Margin`,
      });
    }

    // Customer risk anomaly
    if (isCustomerConcentrationHighRisk) {
      anomalies.push({
        type: 'HIGH_VALUE_TRANSACTION',
        severity: 'MEDIUM',
        description: `High customer concentration risk: Top 3 customers account for ${customerTop3Share}% of total company revenues.`,
        metric: `${customerTop3Share}% Top 3 Share`,
      });
    }

    return {
      companyId,
      asOfDate,
      currency: 'PHP (₱)',
      trends: {
        monthly: monthlyTrends,
        revenueGrowthMoM,
        expenseGrowthMoM,
        profitGrowthMoM,
        averageMonthlyRevenue,
        averageMonthlyExpenses,
      },
      margins: {
        grossProfit: grossProfitAll,
        grossMarginPercentage,
        netProfit: grossProfitAll,
        netProfitMarginPercentage,
        operatingExpenses: totalExpensesAll,
      },
      cashFlow: {
        operatingCashInflow: totalCollected,
        operatingCashOutflow: totalDisbursed,
        netOperatingCashFlow: netCashFlow,
        estimatedMonthlyBurnRate,
        estimatedCashRunwayMonths,
      },
      aging: {
        accountsReceivableTotal: arSummary.totalAccountsReceivable,
        arOverduePercentage: arSummary.overduePercentage,
        accountsPayableTotal: apSummary.totalAccountsPayable,
        apOverduePercentage: apSummary.overduePercentage,
      },
      concentration: {
        customerTop3Share,
        customerTop5Share,
        isCustomerConcentrationHighRisk,
        topCustomers: customerList.slice(0, 5),
        vendorTop3Share,
        vendorTop5Share,
        isVendorConcentrationHighRisk,
        topVendors: vendorList.slice(0, 5),
      },
      taxExposure: {
        estimatedVatPayable,
        estimatedIncomeTax,
        estimatedTaxRate: isMsme ? '20% (CREATE Act MSME Rate)' : '25% (Regular Corporate CIT)',
        unutilizedWithholdingTax2307: 0,
      },
      anomalies,
      authoritativeSource: 'LedgerAI Financial Analytics & BI Engine',
    };
  }
}
