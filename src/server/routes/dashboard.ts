import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requireMinRole, requirePermission } from "../auth";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import {
  buildEffectivePostedJournalPredicate,
  isOperationalPnlJournalSql,
  isRevenueAccountType,
  isExpenseAccountType,
  EXPENSE_ACCOUNT_TYPES,
} from "./reports";
import {
  resolveVatOrPercentageFilingRule,
  computeTrialBalanceIntegrityStatus,
  FinancialMetricContract,
} from "../services/financialSourceOfTruth";

const router = Router();

export const RECOGNIZED_REVENUE_EXPENSE_STATUSES = [
  'POSTED',
  'PARTIAL',
  'PARTIALLY_PAID',
  'PAID'
] as const;

export const OPEN_AR_AP_STATUSES = [
  'POSTED',
  'PARTIAL',
  'PARTIALLY_PAID'
] as const;

export const PENDING_INVOICE_STATUSES = [
  'SUBMITTED',
  'APPROVED',
  'POSTED',
  'PARTIAL',
  'PARTIALLY_PAID'
] as const;

export function deriveVatFromGrossInclusive(grossCentavos: number): number {
  if (!grossCentavos || grossCentavos <= 0) return 0;
  const netExclusive = Math.round(grossCentavos / 1.12);
  return grossCentavos - netExclusive;
}

export function calculateDashboardVatEstimate(params: {
  grossRevenueCentavos?: number;
  grossExpenseCentavos?: number;
  salesGrossCentavos?: number;
  purchasesGrossCentavos?: number;
  storedOutputVatCentavos?: number | null;
  storedInputVatCentavos?: number | null;
  storedPercentageTaxCentavos?: number | null;
  storedEwtCentavos?: number | null;
  isVatRegistered?: boolean;
  vatStatus?: string | null;
}) {
  const normalizedVatStatus = String(params.vatStatus || (params.isVatRegistered === false ? 'NON_VAT' : 'VAT')).toUpperCase();
  const isVat = params.isVatRegistered !== false && (normalizedVatStatus === 'VAT' || normalizedVatStatus === 'VAT_REGISTERED');
  const isNonVatPercentage = normalizedVatStatus === 'NON_VAT';
  const grossRevenue = Math.max(0, Math.round(params.grossRevenueCentavos ?? params.salesGrossCentavos ?? 0));
  const grossExpense = Math.max(0, Math.round(params.grossExpenseCentavos ?? params.purchasesGrossCentavos ?? 0));

  const hasStoredOutputVat = params.storedOutputVatCentavos != null && params.storedOutputVatCentavos > 0;
  const hasStoredInputVat = params.storedInputVatCentavos != null && params.storedInputVatCentavos > 0;
  const hasStoredPercentageTax = params.storedPercentageTaxCentavos != null && params.storedPercentageTaxCentavos > 0;

  const outputVat = !isVat
    ? 0
    : hasStoredOutputVat
      ? Math.round(params.storedOutputVatCentavos!)
      : deriveVatFromGrossInclusive(grossRevenue);

  const inputVat = !isVat
    ? 0
    : hasStoredInputVat
      ? Math.round(params.storedInputVatCentavos!)
      : deriveVatFromGrossInclusive(grossExpense);

  // NIRC Sec. 116 / RA 11976 (EOPT): 3% Quarterly Percentage Tax (BIR Form 2551Q) for Non-VAT taxpayers
  const percentageTaxRate = isNonVatPercentage ? 3 : 0;
  const percentageTaxPayable = isNonVatPercentage
    ? (hasStoredPercentageTax ? Math.round(params.storedPercentageTaxCentavos!) : Math.round(grossRevenue * 0.03))
    : 0;

  const ewtWithheld = params.storedEwtCentavos != null
    ? Math.max(0, Math.round(params.storedEwtCentavos))
    : 0;

  const netVatPayable = isVat ? Math.max(0, outputVat - inputVat) : 0;
  const grossTaxBeforeCredits = isVat ? netVatPayable : percentageTaxPayable;
  const estimatedTaxLiability = Math.max(0, grossTaxBeforeCredits - ewtWithheld);
  const methodology = isNonVatPercentage
    ? (hasStoredPercentageTax ? 'PERCENTAGE_TAX_2551Q_STORED' : 'PERCENTAGE_TAX_2551Q_3PCT')
    : (hasStoredOutputVat || hasStoredInputVat)
      ? 'STORED_TAX_CALCULATIONS'
      : 'VAT_INCLUSIVE_12_112';

  return {
    outputVat,
    inputVat,
    grossReceiptsCentavos: grossRevenue,
    percentageTaxRate,
    percentageTaxPayable,
    ewtWithheld,
    netVatPayable,
    estimatedTaxLiability,
    methodology,
  };
}

router.get("/overview", requireAuth, requirePermission('dashboard:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    // 1. Calculate Outstanding AR Balance (POSTED, PARTIAL, PARTIALLY_PAID with balance_due > 0, excluding REVERSED/VOIDED journals)
    const arQuery = await db.select({ total: sql<number>`COALESCE(sum(${schema.salesInvoices.balanceDue}), 0)` })
      .from(schema.salesInvoices)
      .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
      .where(
        and(
          eq(schema.salesInvoices.companyId, companyId),
          sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND ${schema.salesInvoices.balanceDue} > 0`,
          sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`
        )
      );
    const accountsReceivable = Number(arQuery[0]?.total || 0);

    // 2. Calculate Outstanding AP Balance (POSTED, PARTIAL, PARTIALLY_PAID with balance_due > 0, excluding REVERSED/VOIDED journals)
    const apQuery = await db.select({ total: sql<number>`COALESCE(sum(${schema.purchaseBills.balanceDue}), 0)` })
      .from(schema.purchaseBills)
      .leftJoin(schema.journalEntries, eq(schema.purchaseBills.journalEntryId, schema.journalEntries.id))
      .where(
        and(
          eq(schema.purchaseBills.companyId, companyId),
          sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND ${schema.purchaseBills.balanceDue} > 0`,
          sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`
        )
      );
    const accountsPayable = Number(apQuery[0]?.total || 0);

    // 3. Calculate Cash Balance solely from effective posted GL journal lines (never mixed with unposted subledger or corrupted reversal pairs)
    const cashQuery = await db.select({
      balance: sql<number>`COALESCE(sum(case when ${schema.accounts.normalBalance} = 'DEBIT' then ${schema.journalLines.debit} - ${schema.journalLines.credit} else ${schema.journalLines.credit} - ${schema.journalLines.debit} end), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        buildEffectivePostedJournalPredicate(companyId),
        sql`(${schema.accounts.isCashAccount} = 1 OR (${schema.accounts.accountType} IN ('ASSET', 'OTHER_CURRENT_ASSET') AND (${schema.accounts.accountName} LIKE '%Cash%' OR ${schema.accounts.accountName} LIKE '%Bank%')))`
      )
    );
    const cashBalance = Number(cashQuery[0]?.balance || 0);

    // 4. Monthly Revenue & Expense trends for past 12 months
    // Derived strictly from effective posted GL P&L journal lines (single source of truth matching Income Statement & Trial Balance)
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    const monthlyTrends = [];
    const windowStartD = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const windowStartYyyyMm = `${windowStartD.getFullYear()}-${String(windowStartD.getMonth() + 1).padStart(2, '0')}`;
    const currentYyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthEndStr = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    const glMonthlyRows = await db.select({
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
      sql`substr(${schema.journalEntries.entryDate}, 1, 7) >= ${windowStartYyyyMm}`,
      sql`substr(${schema.journalEntries.entryDate}, 1, 7) <= ${currentYyyyMm}`,
      sql`NOT EXISTS (
        SELECT 1 FROM accounting_periods ap_Check
        WHERE ap_Check.id = ${schema.journalEntries.accountingPeriodId}
          AND ap_Check.company_id = ${companyId}
          AND ap_Check.start_date > ${currentMonthEndStr}
      )`
    ))
    .groupBy(sql`substr(${schema.journalEntries.entryDate}, 1, 7)`, schema.accounts.accountType);

    const glByMonth = new Map<string, { revenue: number; expenses: number }>();
    for (const row of glMonthlyRows) {
      const ym = String(row.yyyyMm || '');
      const bucket = glByMonth.get(ym) || { revenue: 0, expenses: 0 };
      const deb = Number(row.debitTotal || 0);
      const cred = Number(row.creditTotal || 0);
      if (isRevenueAccountType(row.accountType) || row.accountType === 'INCOME') {
        bucket.revenue += (cred - deb);
      } else if (isExpenseAccountType(row.accountType)) {
        bucket.expenses += (deb - cred);
      }
      glByMonth.set(ym, bucket);
    }
    
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = `${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`;
      const shortMonth = monthNames[d.getMonth()];
      const yyyyMm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const glBucket = glByMonth.get(yyyyMm) || { revenue: 0, expenses: 0 };

      const revenue = glBucket.revenue;
      const expenses = glBucket.expenses;
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

    // 5. Expense Breakdown Categories (Single Source of Truth: Effective Posted GL Expense Accounts)
    const expenseBreakdownRows = await db.select({
      category: schema.accounts.accountName,
      amount: sql<number>`COALESCE(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(and(
      buildEffectivePostedJournalPredicate(companyId),
      isOperationalPnlJournalSql(),
      inArray(schema.accounts.accountType, [...EXPENSE_ACCOUNT_TYPES]),
      sql`substr(${schema.journalEntries.entryDate}, 1, 7) >= ${windowStartYyyyMm}`,
      sql`substr(${schema.journalEntries.entryDate}, 1, 7) <= ${currentYyyyMm}`,
      sql`NOT EXISTS (
        SELECT 1 FROM accounting_periods ap_Check
        WHERE ap_Check.id = ${schema.journalEntries.accountingPeriodId}
          AND ap_Check.company_id = ${companyId}
          AND ap_Check.start_date > ${currentMonthEndStr}
      )`
    ))
    .groupBy(schema.accounts.id, schema.accounts.accountName);

    const defaultColors = ["#6366f1", "#10b981", "#f59e0b", "#06b6d4", "#ec4899", "#8b5cf6"];
    const expenseBreakdown = expenseBreakdownRows
      .filter((eb) => Number(eb.amount || 0) > 0)
      .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
      .map((eb, idx) => ({
        category: eb.category || "Uncategorized Expense",
        amount: Number(eb.amount || 0),
        color: defaultColors[idx % defaultColors.length]
      }));

    // 6. Recent Activities
    const activities = await db.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.companyId, companyId))
      .orderBy(desc(schema.auditLogs.timestamp))
      .limit(10);

    // 7. Top 3 Pending Invoices (Excludes DRAFT, CANCELLED, VOID, REJECTED, and PAID)
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
      sql`${schema.salesInvoices.status} IN ('SUBMITTED', 'APPROVED', 'POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND ${schema.salesInvoices.balanceDue} > 0`
    ))
    .orderBy(desc(schema.salesInvoices.invoiceDate))
    .limit(3);
    const pendingInvoices = pendingInvoicesQuery;

    // 8. Active BIR Filing Period Tax Liability Estimate (Quarter-Aligned for 2550Q / 2551Q)
    const companyInfo = await db.select({
      vatStatus: schema.companies.vatStatus,
    })
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId))
      .limit(1);

    const taxProfileRow = await db.select({
      filingFrequency: schema.companyTaxProfiles.filingFrequency,
      vatStatus: schema.companyTaxProfiles.vatStatus,
    })
      .from(schema.companyTaxProfiles)
      .where(eq(schema.companyTaxProfiles.companyId, companyId))
      .limit(1)
      .catch(() => []);

    const vatStatus = String(companyInfo[0]?.vatStatus || taxProfileRow[0]?.vatStatus || 'VAT').toUpperCase();
    const vatFilingRule = resolveVatOrPercentageFilingRule({
      vatStatus,
      vatFilingFrequency: taxProfileRow[0]?.filingFrequency || null,
      referenceDate: now,
    });

    const currentYear = now.getFullYear();
    const currentQuarterNum = Math.floor(now.getMonth() / 3) + 1;
    const qStartMonth = (currentQuarterNum - 1) * 3 + 1;
    const qEndMonth = currentQuarterNum * 3;
    const quarterStartStr = `${currentYear}-${String(qStartMonth).padStart(2, '0')}-01`;
    const quarterEndDay = new Date(currentYear, qEndMonth, 0).getDate();
    const quarterEndStr = `${currentYear}-${String(qEndMonth).padStart(2, '0')}-${String(quarterEndDay).padStart(2, '0')}`;
    const ytdStartStr = `${currentYear}-01-01`;

    const queryTaxPeriodTotals = async (periodStart: string, periodEnd: string) => {
      const salesRow = await db.select({ total: sql<number>`COALESCE(sum(${schema.salesInvoices.totalAmount}), 0)` })
        .from(schema.salesInvoices)
        .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
        .where(and(
          eq(schema.salesInvoices.companyId, companyId),
          sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
          sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
          sql`substr(${schema.salesInvoices.invoiceDate}, 1, 10) >= ${periodStart}`,
          sql`substr(${schema.salesInvoices.invoiceDate}, 1, 10) <= ${periodEnd}`
        ));

      const billsRow = await db.select({ total: sql<number>`COALESCE(sum(${schema.purchaseBills.totalAmount}), 0)` })
        .from(schema.purchaseBills)
        .leftJoin(schema.journalEntries, eq(schema.purchaseBills.journalEntryId, schema.journalEntries.id))
        .where(and(
          eq(schema.purchaseBills.companyId, companyId),
          sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
          sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
          sql`substr(${schema.purchaseBills.billDate}, 1, 10) >= ${periodStart}`,
          sql`substr(${schema.purchaseBills.billDate}, 1, 10) <= ${periodEnd}`
        ));

      const outVatRow = await db.select({
        total: sql<number>`COALESCE(sum(${schema.taxCalculations.taxAmount}), 0)`
      })
        .from(schema.taxCalculations)
        .innerJoin(schema.salesInvoices, eq(schema.taxCalculations.journalEntryId, schema.salesInvoices.journalEntryId))
        .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
        .where(and(
          eq(schema.taxCalculations.companyId, companyId),
          sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
          sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
          sql`substr(${schema.salesInvoices.invoiceDate}, 1, 10) >= ${periodStart}`,
          sql`substr(${schema.salesInvoices.invoiceDate}, 1, 10) <= ${periodEnd}`
        ));

      const inVatRow = await db.select({
        total: sql<number>`COALESCE(sum(${schema.taxCalculations.taxAmount}), 0)`
      })
        .from(schema.taxCalculations)
        .innerJoin(schema.purchaseBills, eq(schema.taxCalculations.journalEntryId, schema.purchaseBills.journalEntryId))
        .leftJoin(schema.journalEntries, eq(schema.purchaseBills.journalEntryId, schema.journalEntries.id))
        .where(and(
          eq(schema.taxCalculations.companyId, companyId),
          sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
          sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
          sql`substr(${schema.purchaseBills.billDate}, 1, 10) >= ${periodStart}`,
          sql`substr(${schema.purchaseBills.billDate}, 1, 10) <= ${periodEnd}`
        ));

      // Authoritative GL Output VAT (2020) & Input VAT (1050) for the period
      const glOutputVatRow = await db.select({
        total: sql<number>`COALESCE(sum(${schema.journalLines.credit} - ${schema.journalLines.debit}), 0)`
      })
        .from(schema.journalLines)
        .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
        .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
        .where(and(
          buildEffectivePostedJournalPredicate(companyId),
          sql`substr(${schema.journalEntries.entryDate}, 1, 10) >= ${periodStart}`,
          sql`substr(${schema.journalEntries.entryDate}, 1, 10) <= ${periodEnd}`,
          sql`(${schema.accounts.accountCode} = '2020' OR ${schema.accounts.detailType} = 'OUTPUT_VAT_LIABILITY' OR LOWER(${schema.accounts.accountName}) LIKE '%output vat%')`
        ))
        .get();

      const glInputVatRow = await db.select({
        total: sql<number>`COALESCE(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`
      })
        .from(schema.journalLines)
        .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
        .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
        .where(and(
          buildEffectivePostedJournalPredicate(companyId),
          sql`substr(${schema.journalEntries.entryDate}, 1, 10) >= ${periodStart}`,
          sql`substr(${schema.journalEntries.entryDate}, 1, 10) <= ${periodEnd}`,
          sql`(${schema.accounts.accountCode} IN ('1050', '1060', '1120') OR ${schema.accounts.detailType} = 'INPUT_VAT' OR LOWER(${schema.accounts.accountName}) LIKE '%input vat%')`
        ))
        .get();

      const cwtRow = await db.select({
        total: sql<number>`COALESCE(sum(${schema.customerPayments.withholdingTaxAmount}), 0)`
      })
        .from(schema.customerPayments)
        .leftJoin(schema.journalEntries, eq(schema.customerPayments.journalEntryId, schema.journalEntries.id))
        .where(and(
          eq(schema.customerPayments.companyId, companyId),
          eq(schema.customerPayments.status, 'POSTED'),
          sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
          sql`substr(${schema.customerPayments.paymentDate}, 1, 10) >= ${periodStart}`,
          sql`substr(${schema.customerPayments.paymentDate}, 1, 10) <= ${periodEnd}`
        ));

      const glOutVat = Math.max(0, Number(glOutputVatRow?.total || 0));
      const glInVat = Math.max(0, Number(glInputVatRow?.total || 0));
      const calcOut = Math.max(0, Number(outVatRow[0]?.total || 0));
      const calcIn = Math.max(0, Number(inVatRow[0]?.total || 0));

      return {
        salesCentavos: Number(salesRow[0]?.total || 0),
        billsCentavos: Number(billsRow[0]?.total || 0),
        storedOutputVatCentavos: glOutVat > 0 ? glOutVat : calcOut,
        storedInputVatCentavos: glInVat > 0 ? glInVat : calcIn,
        storedPercentageTaxCentavos: calcOut,
        cwtCentavos: Number(cwtRow[0]?.total || 0),
      };
    };

    const quarterTotals = await queryTaxPeriodTotals(quarterStartStr, quarterEndStr);
    const hasQuarterActivity =
      quarterTotals.salesCentavos > 0 ||
      quarterTotals.billsCentavos > 0 ||
      quarterTotals.storedOutputVatCentavos > 0 ||
      quarterTotals.storedInputVatCentavos > 0;

    const effectiveTaxTotals = hasQuarterActivity
      ? quarterTotals
      : await queryTaxPeriodTotals(ytdStartStr, currentMonthEndStr);
    const taxPeriodLabel = hasQuarterActivity
      ? `Q${currentQuarterNum} ${currentYear}`
      : `FY ${currentYear} YTD`;

    const isVatRegistered = vatStatus === 'VAT' || vatStatus === 'VAT_REGISTERED';

    const vatEst = calculateDashboardVatEstimate({
      grossRevenueCentavos: effectiveTaxTotals.salesCentavos,
      grossExpenseCentavos: effectiveTaxTotals.billsCentavos,
      storedOutputVatCentavos: isVatRegistered ? effectiveTaxTotals.storedOutputVatCentavos : 0,
      storedInputVatCentavos: isVatRegistered ? effectiveTaxTotals.storedInputVatCentavos : 0,
      storedPercentageTaxCentavos: !isVatRegistered ? effectiveTaxTotals.storedPercentageTaxCentavos : 0,
      storedEwtCentavos: effectiveTaxTotals.cwtCentavos,
      isVatRegistered,
      vatStatus,
    });

    const taxEstimate = {
      currentMonth: taxPeriodLabel,
      periodLabel: taxPeriodLabel,
      vatStatus: vatFilingRule.vatStatus,
      vatFilingFrequency: vatFilingRule.vatFilingFrequency,
      primaryForm: vatFilingRule.primaryVatOrPercentageForm,
      ruleReference: vatFilingRule.ruleReference,
      grossReceiptsCentavos: vatEst.grossReceiptsCentavos,
      percentageTaxRate: vatEst.percentageTaxRate,
      percentageTaxPayable: vatEst.percentageTaxPayable,
      outputVat: vatEst.outputVat,
      inputVat: vatEst.inputVat,
      ewtWithheld: vatEst.ewtWithheld,
      netVatPayable: vatEst.netVatPayable,
      estimatedTaxLiability: vatEst.estimatedTaxLiability,
      calculationMethod: vatEst.methodology,
      dueDateNotice: vatFilingRule.dueDateNotice,
    };

    // 9. Authoritative GL-to-Subledger & Trial Balance Reconciliation Controls
    const arGlRow = await db.select({
      balance: sql<number>`COALESCE(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(
        buildEffectivePostedJournalPredicate(companyId),
        sql`((${schema.accounts.accountType} = 'RECEIVABLE' AND ${schema.accounts.isControlAccount} = 1) OR ${schema.accounts.detailType} IN ('TRADE_RECEIVABLE', 'ACCOUNTS_RECEIVABLE') OR ${schema.accounts.accountCode} IN ('1030', '1110', '1120', '1200') OR LOWER(${schema.accounts.accountName}) LIKE '%accounts receivable%')`
      ))
      .get();

    const apGlRow = await db.select({
      balance: sql<number>`COALESCE(sum(${schema.journalLines.credit} - ${schema.journalLines.debit}), 0)`
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(
        buildEffectivePostedJournalPredicate(companyId),
        sql`((${schema.accounts.accountType} = 'PAYABLE' AND ${schema.accounts.isControlAccount} = 1) OR ${schema.accounts.detailType} IN ('TRADE_PAYABLE', 'ACCOUNTS_PAYABLE') OR ${schema.accounts.accountCode} IN ('2010', '2000') OR LOWER(${schema.accounts.accountName}) LIKE '%accounts payable%')`
      ))
      .get();

    const tbTotalsRow = await db.select({
      totalDebits: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      totalCredits: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`,
      lineCount: sql<number>`count(${schema.journalLines.id})`,
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .where(buildEffectivePostedJournalPredicate(companyId))
      .get();

    const unpostedRow = await db.select({ count: sql<number>`count(*)` })
      .from(schema.journalEntries)
      .where(and(
        eq(schema.journalEntries.companyId, companyId),
        sql`${schema.journalEntries.status} IN ('DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED', 'PENDING')`
      ))
      .get();

    // Verify double-entry posting integrity: zero posted journals with imbalanced lines
    const imbalancedJournalsRow = await db.select({
      count: sql<number>`count(*)`,
    })
      .from(
        db.select({
          jeId: schema.journalEntries.id,
          diff: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0) - COALESCE(sum(${schema.journalLines.credit}), 0)`.as('diff'),
        })
          .from(schema.journalEntries)
          .leftJoin(schema.journalLines, eq(schema.journalEntries.id, schema.journalLines.journalEntryId))
          .where(buildEffectivePostedJournalPredicate(companyId))
          .groupBy(schema.journalEntries.id)
          .as('posted_je_check')
      )
      .where(sql`diff != 0`)
      .get();

    const arGlControlCentavos = Number(arGlRow?.balance || 0);
    const apGlControlCentavos = Number(apGlRow?.balance || 0);
    const arVarianceCentavos = accountsReceivable - arGlControlCentavos;
    const apVarianceCentavos = accountsPayable - apGlControlCentavos;
    const unpostedJournalsCount = Number(unpostedRow?.count || 0);
    const imbalancedPostedJournalsCount = Number(imbalancedJournalsRow?.count || 0);

    const tbStatus = computeTrialBalanceIntegrityStatus({
      totalDebitsCentavos: Number(tbTotalsRow?.totalDebits || 0),
      totalCreditsCentavos: Number(tbTotalsRow?.totalCredits || 0),
      postedJournalLineCount: Number(tbTotalsRow?.lineCount || 0),
    });
    const postingIntegrityOk = imbalancedPostedJournalsCount === 0 && tbStatus.postedJournalLineCount > 0;

    const formatPesoDiff = (centavos: number) =>
      `₱${(Math.abs(centavos) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    let complianceStatus = "Reconciled & Active";
    let complianceDetail = unpostedJournalsCount > 0
      ? `Books balanced and subledgers reconciled (${unpostedJournalsCount} draft entries awaiting review).`
      : "Trial Balance balanced and all subledgers reconciled.";
    if (!tbStatus.balanced || imbalancedPostedJournalsCount > 0) {
      complianceStatus = "Action Required";
      complianceDetail = tbStatus.explanation;
    } else if (arVarianceCentavos !== 0 || apVarianceCentavos !== 0) {
      complianceStatus = "Pending Reconciliation";
      const parts: string[] = [];
      if (arVarianceCentavos !== 0) parts.push(`Receivables variance of ${formatPesoDiff(arVarianceCentavos)}`);
      if (apVarianceCentavos !== 0) parts.push(`Payables variance of ${formatPesoDiff(apVarianceCentavos)}`);
      complianceDetail = `Subledger reconciliation review required (${parts.join(', ')}).`;
    } else if (tbStatus.status === "NO_RECORDS") {
      complianceStatus = unpostedJournalsCount > 0 ? "Pending Posting" : "No Records Yet";
      complianceDetail = unpostedJournalsCount > 0
        ? `${unpostedJournalsCount} draft journal(s) awaiting approval & posting.`
        : "Chart of accounts initialized and ready for transactions.";
    }

    const lastUpdated = new Date().toISOString();
    const hasAccounting = req.permissions?.includes('accounting:view') || false;
    const hasSales = req.permissions?.includes('sales:view') || false;
    const hasPurchases = req.permissions?.includes('purchases:view') || false;
    const hasTax = req.permissions?.includes('tax:view') || false;
    const hasAudit = req.permissions?.includes('audit:view') || false;

    const kpiMeta: Record<string, FinancialMetricContract> = {
      cashBalance: {
        amount: hasAccounting ? cashBalance : 0,
        unit: "CENTAVOS",
        source: "Cash & Bank Accounts",
        sourceTables: ["journal_entries", "journal_lines", "accounts"],
        formula: "Total verified balances across active Cash and Bank accounts",
        period: `As of ${currentMonthEndStr}`,
        status: tbStatus.status === "NO_RECORDS" ? "NO_RECORDS" : !tbStatus.balanced ? "IMBALANCED" : "OK",
        missingExplanation: tbStatus.status === "NO_RECORDS" ? "No posted cash or bank transactions yet." : null,
        variance: tbStatus.varianceCentavos,
        varianceLabel: tbStatus.balanced ? "Ledger Balanced" : `Variance ${formatPesoDiff(tbStatus.varianceCentavos)}`,
        drillDownPath: "/reports/cashbook",
        lastUpdated,
      },
      accountsReceivable: {
        amount: (hasSales || hasAccounting) ? accountsReceivable : 0,
        unit: "CENTAVOS",
        source: "Open Customer Invoices",
        sourceTables: ["sales_invoices", "journal_entries"],
        formula: "Total unpaid balances across posted customer invoices",
        period: `As of ${currentMonthEndStr}`,
        status: accountsReceivable === 0 && pendingInvoices.length === 0 ? "NO_RECORDS" : arVarianceCentavos !== 0 ? "PENDING_RECONCILIATION" : "OK",
        missingExplanation: accountsReceivable === 0 ? "No outstanding customer receivables." : arVarianceCentavos !== 0 ? `Receivables subledger review required (${formatPesoDiff(arVarianceCentavos)} variance).` : null,
        variance: arVarianceCentavos,
        varianceLabel: arVarianceCentavos === 0 ? "Reconciled" : `Variance ${formatPesoDiff(arVarianceCentavos)}`,
        drillDownPath: "/reports/ar-aging",
        lastUpdated,
      },
      accountsPayable: {
        amount: (hasPurchases || hasAccounting) ? accountsPayable : 0,
        unit: "CENTAVOS",
        source: "Open Supplier Bills",
        sourceTables: ["purchase_bills", "journal_entries"],
        formula: "Total unpaid balances across posted supplier bills",
        period: `As of ${currentMonthEndStr}`,
        status: accountsPayable === 0 ? "NO_RECORDS" : apVarianceCentavos !== 0 ? "PENDING_RECONCILIATION" : "OK",
        missingExplanation: accountsPayable === 0 ? "No outstanding supplier payables." : apVarianceCentavos !== 0 ? `Payables subledger review required (${formatPesoDiff(apVarianceCentavos)} variance).` : null,
        variance: apVarianceCentavos,
        varianceLabel: apVarianceCentavos === 0 ? "Reconciled" : `Variance ${formatPesoDiff(apVarianceCentavos)}`,
        drillDownPath: "/reports/ap-aging",
        lastUpdated,
      },
    };

    // Summary YTD stats
    const totalYtdRevenue = monthlyTrends.reduce((acc, curr) => acc + curr.revenue, 0);
    const totalYtdExpenses = monthlyTrends.reduce((acc, curr) => acc + curr.expenses, 0);
    const totalYtdNetProfit = totalYtdRevenue - totalYtdExpenses;
    const avgProfitMargin = totalYtdRevenue > 0 ? ((totalYtdNetProfit / totalYtdRevenue) * 100) : 0;

    res.json({
      cashBalance: hasAccounting ? cashBalance : 0,
      accountsReceivable: (hasSales || hasAccounting) ? accountsReceivable : 0,
      accountsPayable: (hasPurchases || hasAccounting) ? accountsPayable : 0,
      complianceStatus,
      complianceDetail,
      reconciliationSummary: {
        tbStatus: tbStatus.status,
        tbBalanced: tbStatus.balanced,
        tbVarianceCentavos: tbStatus.varianceCentavos,
        postedJournalLinesCount: tbStatus.postedJournalLineCount,
        unpostedJournalsCount,
        imbalancedPostedJournalsCount,
        postingIntegrityOk,
        arSubledgerCentavos: accountsReceivable,
        arGlControlCentavos,
        arVarianceCentavos,
        apSubledgerCentavos: accountsPayable,
        apGlControlCentavos,
        apVarianceCentavos,
      },
      kpiMeta,
      lastUpdated,
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
