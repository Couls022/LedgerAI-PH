import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { TaxEngine } from "./taxEngine";
import { getAccountsReceivableSummary, getAccountsPayableSummary } from "./ai/tools/arApTools";
import {
  buildEffectivePostedJournalPredicate,
  isOperationalPnlJournalSql,
  isRevenueAccountType,
  isExpenseAccountType,
} from "../routes/reports";

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
    totalRevenue: number;
    costOfSales: number;
    grossProfit: number;
    grossMarginPercentage: number;
    netProfit: number;
    netProfitMarginPercentage: number;
    operatingExpenses: number;
  };
  cashFlow: {
    cashBalance: number;
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
    vatStatus: string;
    primaryForm: string;
    estimatedVatPayable: number;
    estimatedPercentageTax: number;
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
   * Generates comprehensive business intelligence, financial trends, concentration, and anomaly detection
   * strictly aligned to the authoritative General Ledger & Subledger source of truth.
   */
  static async getFinancialAnalytics(companyId: string, monthsHistory: number = 12): Promise<FinancialAnalyticsReport> {
    const now = new Date();
    const asOfDate = format(now, 'yyyy-MM-dd');
    const windowStartDate = format(startOfMonth(subMonths(now, Math.max(1, monthsHistory) - 1)), 'yyyy-MM');
    const currentYyyyMm = format(now, 'yyyy-MM');

    // 1. Authoritative GL P&L by Month (Matches Dashboard & Income Statement 100%)
    const glPnlRows = await db.select({
      yyyyMm: sql<string>`substr(${schema.journalEntries.entryDate}, 1, 7)`,
      accountType: schema.accounts.accountType,
      debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`,
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(
        buildEffectivePostedJournalPredicate(companyId),
        isOperationalPnlJournalSql(),
        sql`substr(${schema.journalEntries.entryDate}, 1, 7) >= ${windowStartDate}`,
        sql`substr(${schema.journalEntries.entryDate}, 1, 7) <= ${currentYyyyMm}`
      ))
      .groupBy(sql`substr(${schema.journalEntries.entryDate}, 1, 7)`, schema.accounts.accountType);

    const glByMonth = new Map<string, { revenue: number; cogs: number; opex: number }>();
    let totalGlRevenue = 0;
    let totalGlCogs = 0;
    let totalGlOpex = 0;

    for (const row of glPnlRows) {
      const ym = String(row.yyyyMm || '');
      const bucket = glByMonth.get(ym) || { revenue: 0, cogs: 0, opex: 0 };
      const deb = Number(row.debitTotal || 0);
      const cred = Number(row.creditTotal || 0);
      const accType = String(row.accountType || '').toUpperCase();

      if (isRevenueAccountType(accType) || accType === 'INCOME') {
        const rev = cred - deb;
        bucket.revenue += rev;
        totalGlRevenue += rev;
      } else if (accType === 'COST_OF_SALES' || accType === 'COGS' || accType === 'COST_OF_GOODS_SOLD') {
        const cogs = deb - cred;
        bucket.cogs += cogs;
        totalGlCogs += cogs;
      } else if (isExpenseAccountType(accType)) {
        const opex = deb - cred;
        bucket.opex += opex;
        totalGlOpex += opex;
      }
      glByMonth.set(ym, bucket);
    }

    // 2. Month-by-month trends from posted GL
    const monthlyTrends: MonthlyTrendData[] = [];
    for (let i = monthsHistory - 1; i >= 0; i--) {
      const targetMonthDate = subMonths(now, i);
      const monthKey = format(targetMonthDate, 'yyyy-MM');
      const monthLabel = format(targetMonthDate, 'MMM yyyy');
      const bucket = glByMonth.get(monthKey) || { revenue: 0, cogs: 0, opex: 0 };

      const rev = bucket.revenue;
      const exp = bucket.cogs + bucket.opex;
      const grossProfit = rev - bucket.cogs;
      const net = rev - exp;
      const grossMarginPct = rev > 0 ? Number(((grossProfit / rev) * 100).toFixed(1)) : 0;
      const netMarginPct = rev > 0 ? Number(((net / rev) * 100).toFixed(1)) : 0;

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

    const activeMonthsCount = Math.max(1, monthlyTrends.filter(m => m.revenue !== 0 || m.expenses !== 0).length);
    const totalHistoricalRev = monthlyTrends.reduce((s, m) => s + m.revenue, 0);
    const totalHistoricalExp = monthlyTrends.reduce((s, m) => s + m.expenses, 0);
    const averageMonthlyRevenue = Math.round(totalHistoricalRev / activeMonthsCount);
    const averageMonthlyExpenses = Math.round(totalHistoricalExp / activeMonthsCount);

    // 3. Authoritative Margin Analysis (Matches Dashboard & Income Statement 100%)
    const totalExpensesAll = totalGlCogs + totalGlOpex;
    const grossProfitAll = totalGlRevenue - totalGlCogs;
    const netProfitAll = totalGlRevenue - totalExpensesAll;
    const grossMarginPercentage = totalGlRevenue > 0 ? Number(((grossProfitAll / totalGlRevenue) * 100).toFixed(1)) : 0;
    const netProfitMarginPercentage = totalGlRevenue > 0 ? Number(((netProfitAll / totalGlRevenue) * 100).toFixed(1)) : 0;

    // 4. Authoritative Cash Position & Operating Cash Flow from Posted GL Cash Accounts
    const glCashFlowRow = await db.select({
      inflow: sql<number>`COALESCE(sum(case when ${schema.journalEntries.sourceType} != 'OPENING_BALANCE' then ${schema.journalLines.debit} else 0 end), 0)`,
      outflow: sql<number>`COALESCE(sum(case when ${schema.journalEntries.sourceType} != 'OPENING_BALANCE' then ${schema.journalLines.credit} else 0 end), 0)`,
      balance: sql<number>`COALESCE(sum(case when ${schema.accounts.normalBalance} = 'DEBIT' then ${schema.journalLines.debit} - ${schema.journalLines.credit} else ${schema.journalLines.credit} - ${schema.journalLines.debit} end), 0)`,
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(
        buildEffectivePostedJournalPredicate(companyId),
        sql`(${schema.accounts.isCashAccount} = 1 OR (${schema.accounts.accountType} IN ('ASSET', 'OTHER_CURRENT_ASSET') AND (${schema.accounts.accountName} LIKE '%Cash%' OR ${schema.accounts.accountName} LIKE '%Bank%')))`
      ))
      .get();

    const glCashCentavos = Number(glCashFlowRow?.balance || 0);
    const operatingCashInflow = Number(glCashFlowRow?.inflow || 0);
    const operatingCashOutflow = Number(glCashFlowRow?.outflow || 0);
    const netCashFlow = operatingCashInflow - operatingCashOutflow;
    const estimatedMonthlyBurnRate = Math.max(0, averageMonthlyExpenses - averageMonthlyRevenue);
    const estimatedCashRunwayMonths = estimatedMonthlyBurnRate > 0 && glCashCentavos > 0
      ? Number((glCashCentavos / estimatedMonthlyBurnRate).toFixed(1))
      : 0;

    // 5. Subledger Customer & Vendor Concentration Analysis (Posted invoices & bills only)
    const postedInvoices = await db.select().from(schema.salesInvoices)
      .where(and(
        eq(schema.salesInvoices.companyId, companyId),
        sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`
      ));

    const postedBills = await db.select().from(schema.purchaseBills)
      .where(and(
        eq(schema.purchaseBills.companyId, companyId),
        sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`
      ));

    const customers = await db.select().from(schema.customers).where(eq(schema.customers.companyId, companyId));
    const vendors = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId));
    const custMap = new Map<string, string>(customers.map(c => [c.id, c.legalName || c.code || 'Customer']));
    const vendMap = new Map<string, string>(vendors.map(v => [v.id, v.legalName || v.code || 'Vendor']));

    const totalInvoiceSales = postedInvoices.reduce((s, i) => s + (i.totalAmount || 0), 0);
    const totalBillSpend = postedBills.reduce((s, b) => s + (b.totalAmount || 0), 0);

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
        percentageOfTotal: totalInvoiceSales > 0 ? Number(((amt / totalInvoiceSales) * 100).toFixed(2)) : 0,
      });
    }
    customerList.sort((a, b) => b.totalAmount - a.totalAmount);

    const customerTop3Share = Number(customerList.slice(0, 3).reduce((s, c) => s + c.percentageOfTotal, 0).toFixed(2));
    const customerTop5Share = Number(customerList.slice(0, 5).reduce((s, c) => s + c.percentageOfTotal, 0).toFixed(2));
    const isCustomerConcentrationHighRisk = customerTop3Share >= 60;

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
        percentageOfTotal: totalBillSpend > 0 ? Number(((amt / totalBillSpend) * 100).toFixed(2)) : 0,
      });
    }
    vendorList.sort((a, b) => b.totalAmount - a.totalAmount);

    const vendorTop3Share = Number(vendorList.slice(0, 3).reduce((s, v) => s + v.percentageOfTotal, 0).toFixed(2));
    const vendorTop5Share = Number(vendorList.slice(0, 5).reduce((s, v) => s + v.percentageOfTotal, 0).toFixed(2));
    const isVendorConcentrationHighRisk = vendorTop3Share >= 60;

    // 6. AR & AP Aging
    const arSummary = await getAccountsReceivableSummary({ companyId, asOfDate });
    const apSummary = await getAccountsPayableSummary({ companyId, asOfDate });

    // 7. Tax Exposure Calculations (Authoritative GL VAT 2020/1050 + Non-VAT 2551Q 3% + CREATE Act CIT)
    const companyRow = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    await TaxEngine.getEngineRulesForCompany(companyId);
    const vatStatus = String(companyRow?.vatStatus || 'VAT').toUpperCase();
    const isVatRegistered = vatStatus === 'VAT' || vatStatus === 'VAT_REGISTERED';
    const isNonVatPercentage = vatStatus === 'NON_VAT';

    const glOutVatRow = await db.select({
      total: sql<number>`COALESCE(sum(${schema.journalLines.credit} - ${schema.journalLines.debit}), 0)`
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(
        buildEffectivePostedJournalPredicate(companyId),
        sql`(${schema.accounts.accountCode} IN ('2020', '2200') OR ${schema.accounts.detailType} = 'OUTPUT_VAT_LIABILITY' OR LOWER(${schema.accounts.accountName}) LIKE '%output vat%')`
      ))
      .get();

    const glInVatRow = await db.select({
      total: sql<number>`COALESCE(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(
        buildEffectivePostedJournalPredicate(companyId),
        sql`(${schema.accounts.accountCode} IN ('1050', '1500') OR ${schema.accounts.detailType} = 'INPUT_VAT' OR LOWER(${schema.accounts.accountName}) LIKE '%input vat%')`
      ))
      .get();

    const glOutVat = Math.max(0, Number(glOutVatRow?.total || 0));
    const glInVat = Math.max(0, Number(glInVatRow?.total || 0));
    const derivedOutVat = totalInvoiceSales - Math.round(totalInvoiceSales / 1.12);
    const derivedInVat = totalBillSpend - Math.round(totalBillSpend / 1.12);

    const estimatedVatPayable = isVatRegistered
      ? Math.max(0, (glOutVat > 0 ? glOutVat : derivedOutVat) - (glInVat > 0 ? glInVat : derivedInVat))
      : 0;

    const estimatedPercentageTax = isNonVatPercentage
      ? Math.round(totalInvoiceSales * 0.03)
      : 0;

    const cwtRow = await db.select({
      total: sql<number>`COALESCE(sum(${schema.customerPayments.withholdingTaxAmount}), 0)`
    })
      .from(schema.customerPayments)
      .where(and(eq(schema.customerPayments.companyId, companyId), eq(schema.customerPayments.status, 'POSTED')))
      .get();
    const unutilizedWithholdingTax2307 = Math.max(0, Number(cwtRow?.total || 0));

    const estimatedTaxableIncome = Math.max(0, netProfitAll);
    const isCorporate = String(companyRow?.taxpayerClassification || 'CORPORATION').toUpperCase() === 'CORPORATION';
    const glAssetsRow = await db.select({
      assets: sql<number>`COALESCE(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`,
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(
        buildEffectivePostedJournalPredicate(companyId),
        sql`${schema.accounts.accountType} IN ('ASSET', 'RECEIVABLE', 'INVENTORY', 'OTHER_CURRENT_ASSET', 'FIXED_ASSET')`
      ))
      .get();
    const totalAssetsCentavos = Number(glAssetsRow?.assets || 0);
    const isMsme = isCorporate && estimatedTaxableIncome <= 500_000_000 && totalAssetsCentavos <= 10_000_000_000;
    const incomeTaxRate = isMsme ? 0.20 : 0.25;
    const estimatedIncomeTax = Math.round(estimatedTaxableIncome * incomeTaxRate);

    // 8. Anomaly Detection
    const anomalies: FinancialAnalyticsReport['anomalies'] = [];

    if (expenseGrowthMoM > 25 && currentMonthData.expenses > 1000000) {
      anomalies.push({
        type: 'EXPENSE_SPIKE',
        severity: 'HIGH',
        description: `Expenses increased sharply by ${expenseGrowthMoM}% this month (₱${(currentMonthData.expenses / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} vs ₱${(prevMonthData.expenses / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}).`,
        metric: `+${expenseGrowthMoM}% Expense MoM`,
        details: { currentMonth: currentMonthData.expenses, prevMonth: prevMonthData.expenses },
      });
    }

    if (revenueGrowthMoM < -25 && prevMonthData.revenue > 1000000) {
      anomalies.push({
        type: 'REVENUE_DIP',
        severity: 'HIGH',
        description: `Revenue dropped by ${Math.abs(revenueGrowthMoM)}% compared to the previous month.`,
        metric: `${revenueGrowthMoM}% Revenue MoM`,
        details: { currentMonth: currentMonthData.revenue, prevMonth: prevMonthData.revenue },
      });
    }

    if (currentMonthData.netMarginPct < 15 && currentMonthData.revenue > 0) {
      anomalies.push({
        type: 'MARGIN_CONTRACTION',
        severity: 'MEDIUM',
        description: `Net operating margin contracted to ${currentMonthData.netMarginPct}%, indicating elevated cost ratios.`,
        metric: `${currentMonthData.netMarginPct}% Margin`,
      });
    }

    if (isCustomerConcentrationHighRisk && customerList.length > 0) {
      anomalies.push({
        type: 'HIGH_VALUE_TRANSACTION',
        severity: 'MEDIUM',
        description: `High customer concentration: Top 3 customers represent ${customerTop3Share}% of invoiced sales.`,
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
        totalRevenue: totalGlRevenue,
        costOfSales: totalGlCogs,
        grossProfit: grossProfitAll,
        grossMarginPercentage,
        netProfit: netProfitAll,
        netProfitMarginPercentage,
        operatingExpenses: totalExpensesAll,
      },
      cashFlow: {
        cashBalance: glCashCentavos,
        operatingCashInflow,
        operatingCashOutflow,
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
        vatStatus,
        primaryForm: isVatRegistered ? 'BIR Form 2550Q' : isNonVatPercentage ? 'BIR Form 2551Q' : 'Exempt',
        estimatedVatPayable,
        estimatedPercentageTax,
        estimatedIncomeTax,
        estimatedTaxRate: isMsme ? '20% (CREATE Act MSME Rate)' : '25% (Regular Corporate CIT)',
        unutilizedWithholdingTax2307,
      },
      anomalies,
      authoritativeSource: 'General Ledger & Subledger Financial Engine',
    };
  }
}
