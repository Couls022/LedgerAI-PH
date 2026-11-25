import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, or, inArray, sql, desc } from "drizzle-orm";
import {
  buildEffectivePostedJournalPredicate,
  isAssetAccountType,
  isLiabilityAccountType,
  isEquityAccountType,
  isRevenueAccountType,
  isExpenseAccountType,
} from "../routes/reports";

export type FinancialDataStatus =
  | "OK"
  | "NO_RECORDS"
  | "MISSING_SUPPORTING_DOCUMENT"
  | "NOT_POSTED"
  | "PENDING_RECONCILIATION"
  | "UNMAPPED_ACCOUNT"
  | "MISSING_TAX_CLASSIFICATION"
  | "INCOMPLETE_CALCULATION"
  | "IMBALANCED"
  | "STALE_DATA";

export interface FinancialMetricContract<T = number> {
  amount: T;
  unit: "CENTAVOS" | "COUNT" | "PERCENT" | "RATIO" | "TEXT";
  source: string;
  sourceTables: string[];
  formula: string;
  period: string;
  status: FinancialDataStatus;
  missingExplanation: string | null;
  variance: number | null;
  varianceLabel: string | null;
  drillDownPath: string;
  lastUpdated: string;
}

export interface TrialBalanceIntegrityResult {
  status: "NO_RECORDS" | "OK" | "IMBALANCED";
  balanced: boolean;
  totalDebitsCentavos: number;
  totalCreditsCentavos: number;
  varianceCentavos: number;
  postedJournalLineCount: number;
  label: string;
  explanation: string;
}

export function computeTrialBalanceIntegrityStatus(params: {
  totalDebitsCentavos: number;
  totalCreditsCentavos: number;
  postedJournalLineCount: number;
}): TrialBalanceIntegrityResult {
  const deb = Math.round(Number(params.totalDebitsCentavos || 0));
  const cred = Math.round(Number(params.totalCreditsCentavos || 0));
  const count = Math.max(0, Math.trunc(Number(params.postedJournalLineCount || 0)));
  const variance = deb - cred;

  if (count === 0 && deb === 0 && cred === 0) {
    return {
      status: "NO_RECORDS",
      balanced: true,
      totalDebitsCentavos: 0,
      totalCreditsCentavos: 0,
      varianceCentavos: 0,
      postedJournalLineCount: 0,
      label: "No Posted Entries",
      explanation: "No posted journal entries exist for the selected scope yet.",
    };
  }

  if (variance === 0) {
    return {
      status: "OK",
      balanced: true,
      totalDebitsCentavos: deb,
      totalCreditsCentavos: cred,
      varianceCentavos: 0,
      postedJournalLineCount: count,
      label: "Balanced (Debits = Credits)",
      explanation: `Verified ${count} posted journal lines: Total Debits equal Total Credits.`,
    };
  }

  return {
    status: "IMBALANCED",
    balanced: false,
    totalDebitsCentavos: deb,
    totalCreditsCentavos: cred,
    varianceCentavos: variance,
    postedJournalLineCount: count,
    label: "Imbalance Detected",
    explanation: `Trial Balance out of balance by ₱${(Math.abs(variance) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Inspect journal integrity immediately.`,
  };
}

export interface WorkingCapitalSolvencyResult {
  workingCapitalCentavos: number;
  currentAssetsCentavos: number;
  currentLiabilitiesCentavos: number;
  currentRatio: number | null;
  debtToEquityRatio: number | null;
  status: FinancialDataStatus;
  explanation: string | null;
}

export function computeWorkingCapitalAndSolvency(params: {
  currentAssetsCentavos: number;
  currentLiabilitiesCentavos: number;
  totalAssetsCentavos: number;
  totalLiabilitiesCentavos: number;
  totalEquityCentavos: number;
  hasPostedBalances: boolean;
}): WorkingCapitalSolvencyResult {
  if (!params.hasPostedBalances) {
    return {
      workingCapitalCentavos: 0,
      currentAssetsCentavos: 0,
      currentLiabilitiesCentavos: 0,
      currentRatio: null,
      debtToEquityRatio: null,
      status: "NO_RECORDS",
      explanation: "No posted balance sheet transactions recorded yet.",
    };
  }

  const workingCapitalCentavos = Math.round(params.currentAssetsCentavos - params.currentLiabilitiesCentavos);
  const currentRatio =
    params.currentLiabilitiesCentavos > 0
      ? Math.round((params.currentAssetsCentavos / params.currentLiabilitiesCentavos) * 100) / 100
      : null;
  const debtToEquityRatio =
    params.totalEquityCentavos !== 0
      ? Math.round((params.totalLiabilitiesCentavos / Math.abs(params.totalEquityCentavos)) * 1000) / 10
      : null;

  let explanation: string | null = null;
  if (params.currentLiabilitiesCentavos === 0 && params.currentAssetsCentavos > 0) {
    explanation = "No posted current liabilities recorded; current ratio is undefined (N/A).";
  } else if (params.currentAssetsCentavos === 0 && params.currentLiabilitiesCentavos === 0) {
    explanation = "No balances posted in Current Asset or Current Liability accounts.";
  }

  return {
    workingCapitalCentavos,
    currentAssetsCentavos: Math.round(params.currentAssetsCentavos),
    currentLiabilitiesCentavos: Math.round(params.currentLiabilitiesCentavos),
    currentRatio,
    debtToEquityRatio,
    status: "OK",
    explanation,
  };
}

export interface TaxFilingRuleInfo {
  vatStatus: string;
  vatFilingFrequency: "QUARTERLY" | "MONTHLY_OPTIONAL" | "NONE";
  primaryVatOrPercentageForm: string;
  dueDateNotice: string;
  ruleReference: string;
}

/**
 * Resolves Philippine VAT / Percentage Tax filing guidance strictly from official BIR issuances:
 * - RMC No. 5-2023: Mandatory quarterly VAT return via Form 2550Q (within 25 days after quarter end).
 * - RMC No. 52-2023: Optional monthly VAT filing via Form 2550M for taxpayers electing monthly filing.
 * - RA 11976 (EOPT) / NIRC Sec. 116: Quarterly Percentage Tax Form 2551Q for Non-VAT taxpayers.
 */
export function resolveVatOrPercentageFilingRule(params: {
  vatStatus?: string | null;
  vatFilingFrequency?: string | null;
  referenceDate?: Date;
}): TaxFilingRuleInfo {
  const now = params.referenceDate || new Date();
  const normalizedVat = String(params.vatStatus || "").trim().toUpperCase();
  const freqRaw = String(params.vatFilingFrequency || "").trim().toUpperCase();

  const year = now.getUTCFullYear();
  const monthIdx = now.getUTCMonth(); // 0..11
  const currentQuarter = Math.floor(monthIdx / 3) + 1;
  const quarterEndMonth = currentQuarter * 3; // 3,6,9,12
  const nextQuarterDueYear = quarterEndMonth === 12 ? year + 1 : year;
  const nextQuarterDueMonth = quarterEndMonth === 12 ? 1 : quarterEndMonth + 1;
  const quarterDueDate = `${nextQuarterDueYear}-${String(nextQuarterDueMonth).padStart(2, "0")}-25`;

  const nextMonthYear = monthIdx === 11 ? year + 1 : year;
  const nextMonth = monthIdx === 11 ? 1 : monthIdx + 2;
  const monthly2550MDueDate = `${nextMonthYear}-${String(nextMonth).padStart(2, "0")}-20`;

  if (normalizedVat === "NON_VAT") {
    return {
      vatStatus: "NON_VAT",
      vatFilingFrequency: "QUARTERLY",
      primaryVatOrPercentageForm: "2551Q",
      dueDateNotice: `BIR Form 2551Q (3% Percentage Tax) due by ${quarterDueDate}`,
      ruleReference: "NIRC Sec. 116 / RA 11976",
    };
  }

  if (normalizedVat === "EXEMPT" || normalizedVat === "BMBE" || normalizedVat === "PEZA_BOI") {
    return {
      vatStatus: normalizedVat,
      vatFilingFrequency: "NONE",
      primaryVatOrPercentageForm: "EXEMPT",
      dueDateNotice: `Exempt Classification (${normalizedVat}) — verify documentary BIR Certificate / Exemption`,
      ruleReference: "NIRC Sec. 109 / BMBE / PEZA",
    };
  }

  if (freqRaw === "MONTHLY" || freqRaw === "MONTHLY_OPTIONAL" || freqRaw === "2550M") {
    return {
      vatStatus: normalizedVat || "VAT",
      vatFilingFrequency: "MONTHLY_OPTIONAL",
      primaryVatOrPercentageForm: "2550M / 2550Q",
      dueDateNotice: `Optional Monthly Form 2550M due ${monthly2550MDueDate}; Quarterly Form 2550Q due ${quarterDueDate}`,
      ruleReference: "BIR RMC 5-2023 & RMC 52-2023",
    };
  }

  return {
    vatStatus: normalizedVat || "VAT",
    vatFilingFrequency: "QUARTERLY",
    primaryVatOrPercentageForm: "2550Q (Optional 2550M)",
    dueDateNotice: `BIR Form 2550Q due by ${quarterDueDate} (Optional 2550M election per RMC 52-2023)`,
    ruleReference: "BIR RMC 5-2023 & RMC 52-2023",
  };
}

export function computeOperationsRollupsPure(input: {
  inventoryItems: Array<{ quantityOnHand: number; unitCost: number; reorderPoint: number; costingMethod?: string | null }>;
  fixedAssets: Array<{ acquisitionCostCentavos: number; accumulatedDepreciationCentavos: number; status?: string | null }>;
  pendingMonthlyDepCentavos: number;
  postedMonthlyDepCentavos: number;
  unpaidSalesCentavos: number;
  outputVatCentavos: number;
  totalInvoicesCount: number;
  postedInvoicesCount: number;
  draftInvoicesCount: number;
  vatStatus: string;
  payrollEmployeesCount: number;
  latestPayrollRun: {
    payrollPeriod: string;
    totalGrossPay: number;
    totalWithholdingTax: number;
    totalSss: number;
    totalPhilhealth: number;
    totalPagibig: number;
    totalNetPay: number;
  } | null;
  postedPayrollRunsCount: number;
  purchaseOrders: Array<{ status?: string | null; totalAmount?: number | null }>;
  grnCount: number;
  bankAccountsCount: number;
  reconciliations: Array<{ status?: string | null; statementEndingBalance?: number | null; bookEndingBalance?: number | null }>;
  unmatchedBankLinesCount: number;
  inventoryGlBalanceCentavos: number;
  arGlBalanceCentavos: number;
}) {
  // 1. Sales & AR
  const percentageTaxCentavos =
    input.vatStatus === "NON_VAT" ? Math.round(input.unpaidSalesCentavos * 0.03) : 0;
  const arVarianceCentavos = input.unpaidSalesCentavos - input.arGlBalanceCentavos;

  // 2. Inventory (unitCost is ALREADY stored in integer centavos in schema.inventoryItems!)
  let stockValuationCentavos = 0;
  let totalQuantityOnHand = 0;
  let lowStockCount = 0;
  const costingMethods = new Set<string>();
  for (const item of input.inventoryItems) {
    const qty = Number(item.quantityOnHand || 0);
    const unitCost = Number(item.unitCost || 0);
    totalQuantityOnHand += qty;
    stockValuationCentavos += Math.round(qty * unitCost);
    if (qty <= Number(item.reorderPoint ?? 10)) {
      lowStockCount++;
    }
    if (item.costingMethod) costingMethods.add(String(item.costingMethod).toUpperCase());
  }
  const inventoryVarianceCentavos = stockValuationCentavos - input.inventoryGlBalanceCentavos;

  // 3. Payroll
  const latestRun = input.latestPayrollRun;

  // 4. Fixed Assets (all centavos)
  let totalAcquisitionCostCentavos = 0;
  let totalAccumulatedDepCentavos = 0;
  let activeAssetsCount = 0;
  for (const a of input.fixedAssets) {
    totalAcquisitionCostCentavos += Number(a.acquisitionCostCentavos || 0);
    totalAccumulatedDepCentavos += Number(a.accumulatedDepreciationCentavos || 0);
    if (a.status !== "DISPOSED" && a.status !== "RETIRED" && a.status !== "INACTIVE") {
      activeAssetsCount++;
    }
  }
  const netBookValueCentavos = Math.max(0, totalAcquisitionCostCentavos - totalAccumulatedDepCentavos);

  // 5. Procurement
  const openPos = input.purchaseOrders.filter((po) =>
    ["DRAFT", "SUBMITTED", "APPROVED", "OPEN", "PARTIALLY_RECEIVED"].includes(String(po.status || "").toUpperCase())
  );
  const openPoAmountCentavos = openPos.reduce((s, po) => s + Number(po.totalAmount || 0), 0);
  const receivedPosCount = input.purchaseOrders.filter((po) =>
    ["RECEIVED", "CLOSED", "COMPLETED", "MATCHED"].includes(String(po.status || "").toUpperCase())
  ).length;

  // 6. Bank Reconciliation
  const approvedRecons = input.reconciliations.filter(
    (r) => String(r.status || "").toUpperCase() === "APPROVED" || String(r.status || "").toUpperCase() === "RECONCILED"
  );
  const pendingRecons = input.reconciliations.filter(
    (r) => !["APPROVED", "RECONCILED"].includes(String(r.status || "").toUpperCase())
  );
  const reconciledBalanceCentavos = approvedRecons.reduce(
    (s, r) => s + Number(r.bookEndingBalance ?? r.statementEndingBalance ?? 0),
    0
  );

  return {
    sales: {
      totalInvoices: input.totalInvoicesCount,
      postedInvoices: input.postedInvoicesCount,
      draftInvoices: input.draftInvoicesCount,
      unpaidAmountCentavos: input.unpaidSalesCentavos,
      outputVatCentavos: input.outputVatCentavos,
      percentageTaxCentavos,
      arGlBalanceCentavos: input.arGlBalanceCentavos,
      arVarianceCentavos,
      vatStatus: input.vatStatus,
      status: (input.totalInvoicesCount === 0
        ? "NO_RECORDS"
        : input.draftInvoicesCount > 0 && input.postedInvoicesCount === 0
          ? "NOT_POSTED"
          : arVarianceCentavos !== 0
            ? "PENDING_RECONCILIATION"
            : "OK") as FinancialDataStatus,
      missingExplanation:
        input.totalInvoicesCount === 0
          ? "No sales invoices recorded for this company."
          : input.draftInvoicesCount > 0 && input.postedInvoicesCount === 0
            ? `${input.draftInvoicesCount} draft/unposted invoice(s) awaiting approval & posting.`
            : arVarianceCentavos !== 0
              ? `AR Subledger differs from GL AR control by ₱${(Math.abs(arVarianceCentavos) / 100).toFixed(2)}.`
              : null,
    },
    inventory: {
      totalItems: input.inventoryItems.length,
      totalQuantityOnHand,
      stockValuationCentavos,
      lowStockCount,
      costingMethods: Array.from(costingMethods),
      inventoryGlBalanceCentavos: input.inventoryGlBalanceCentavos,
      inventoryVarianceCentavos,
      status: (input.inventoryItems.length === 0
        ? "NO_RECORDS"
        : inventoryVarianceCentavos !== 0
          ? "PENDING_RECONCILIATION"
          : "OK") as FinancialDataStatus,
      missingExplanation:
        input.inventoryItems.length === 0
          ? "No inventory items registered."
          : inventoryVarianceCentavos !== 0
            ? `Subledger valuation differs from GL Inventory control by ₱${(Math.abs(inventoryVarianceCentavos) / 100).toFixed(2)}.`
            : null,
    },
    payroll: {
      activeEmployees: input.payrollEmployeesCount,
      postedRuns: input.postedPayrollRunsCount,
      latestPeriod: latestRun?.payrollPeriod || null,
      grossPayrollCentavos: latestRun?.totalGrossPay || 0,
      withholdingTaxCentavos: latestRun?.totalWithholdingTax || 0,
      sssTotalCentavos: latestRun?.totalSss || 0,
      philhealthTotalCentavos: latestRun?.totalPhilhealth || 0,
      pagibigTotalCentavos: latestRun?.totalPagibig || 0,
      netPayCentavos: latestRun?.totalNetPay || 0,
      status: (input.payrollEmployeesCount === 0
        ? "NO_RECORDS"
        : input.postedPayrollRunsCount === 0
          ? "NOT_POSTED"
          : "OK") as FinancialDataStatus,
      missingExplanation:
        input.payrollEmployeesCount === 0
          ? "No active employees enrolled."
          : input.postedPayrollRunsCount === 0
            ? `${input.payrollEmployeesCount} active employee(s) enrolled, but no payroll run has been posted yet.`
            : null,
    },
    fixedAssets: {
      totalAssets: input.fixedAssets.length,
      activeAssets: activeAssetsCount,
      acquisitionCostCentavos: totalAcquisitionCostCentavos,
      accumulatedDepreciationCentavos: totalAccumulatedDepCentavos,
      netBookValueCentavos,
      monthlyDepreciationCentavos: input.postedMonthlyDepCentavos + input.pendingMonthlyDepCentavos,
      postedMonthlyDepCentavos: input.postedMonthlyDepCentavos,
      pendingMonthlyDepCentavos: input.pendingMonthlyDepCentavos,
      status: (input.fixedAssets.length === 0
        ? "NO_RECORDS"
        : input.pendingMonthlyDepCentavos > 0
          ? "NOT_POSTED"
          : "OK") as FinancialDataStatus,
      missingExplanation:
        input.fixedAssets.length === 0
          ? "No fixed assets capitalized."
          : input.pendingMonthlyDepCentavos > 0
            ? "Pending depreciation schedules exist awaiting GL posting."
            : null,
    },
    procurement: {
      totalPOs: input.purchaseOrders.length,
      openPOs: openPos.length,
      openPoAmountCentavos,
      matchedCount: receivedPosCount,
      grnCount: input.grnCount,
      status: (input.purchaseOrders.length === 0 ? "NO_RECORDS" : "OK") as FinancialDataStatus,
      missingExplanation: input.purchaseOrders.length === 0 ? "No purchase orders recorded." : null,
    },
    banking: {
      bankAccounts: input.bankAccountsCount,
      reconciliationsCount: input.reconciliations.length,
      approvedReconciliations: approvedRecons.length,
      pendingReconciliations: pendingRecons.length,
      reconciledBalanceCentavos,
      unreconciledLines: input.unmatchedBankLinesCount,
      status: ((input.reconciliations.length === 0 && input.unmatchedBankLinesCount === 0 && (input as any).registeredBankAccountsCount === 0) ||
        (input.bankAccountsCount === 0 && input.reconciliations.length === 0)
        ? "NO_RECORDS"
        : input.unmatchedBankLinesCount > 0 || pendingRecons.length > 0
          ? "PENDING_RECONCILIATION"
          : input.reconciliations.length === 0
            ? "PENDING_RECONCILIATION"
            : "OK") as FinancialDataStatus,
      missingExplanation:
        (input.reconciliations.length === 0 && input.unmatchedBankLinesCount === 0 && (input as any).registeredBankAccountsCount === 0) ||
        (input.bankAccountsCount === 0 && input.reconciliations.length === 0)
          ? "No bank accounts or statements recorded."
          : input.reconciliations.length === 0
            ? `${input.bankAccountsCount} bank account(s) exist, but no bank reconciliation statement has been imported/approved.`
            : input.unmatchedBankLinesCount > 0 || pendingRecons.length > 0
              ? `${input.unmatchedBankLinesCount} unmatched statement line(s) / ${pendingRecons.length} pending reconciliation(s).`
              : null,
    },
  };
}

/**
 * Authoritative DB-backed Operations Summary across all 6 operational subledgers + GL variance checks.
 */
export async function getAuthoritativeOperationsSummary(companyId: string) {
  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  const vatStatus = String(company?.vatStatus || "VAT").toUpperCase();

  // 1. Sales Invoices & AR
  const invoices = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.companyId, companyId));
  const postedStatuses = new Set(["POSTED", "PARTIAL", "PARTIALLY_PAID", "PAID"]);
  const openStatuses = new Set(["POSTED", "PARTIAL", "PARTIALLY_PAID"]);
  const postedInvoices = invoices.filter((i) => postedStatuses.has(String(i.status || "").toUpperCase()));
  const draftInvoices = invoices.filter((i) => ["DRAFT", "SUBMITTED", "APPROVED"].includes(String(i.status || "").toUpperCase()));
  const arQueryRow = await db
    .select({ total: sql<number>`COALESCE(sum(${schema.salesInvoices.balanceDue}), 0)` })
    .from(schema.salesInvoices)
    .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.salesInvoices.companyId, companyId),
        sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND ${schema.salesInvoices.balanceDue} > 0`,
        sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`
      )
    )
    .get();
  const unpaidSalesCentavos = Number(arQueryRow?.total || 0);

  const outputVatRow = await db
    .select({ total: sql<number>`COALESCE(sum(${schema.taxCalculations.taxAmount}), 0)` })
    .from(schema.taxCalculations)
    .innerJoin(schema.salesInvoices, eq(schema.taxCalculations.journalEntryId, schema.salesInvoices.journalEntryId))
    .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
    .where(and(
      eq(schema.taxCalculations.companyId, companyId),
      sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'PAID')`,
      sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`
    ))
    .get();

  const arGlRow = await db
    .select({
      balance: sql<number>`COALESCE(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`,
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        buildEffectivePostedJournalPredicate(companyId),
        sql`((${schema.accounts.accountType} = 'RECEIVABLE' AND ${schema.accounts.isControlAccount} = 1) OR ${schema.accounts.detailType} IN ('TRADE_RECEIVABLE', 'ACCOUNTS_RECEIVABLE') OR ${schema.accounts.accountCode} IN ('1030', '1110', '1120', '1200') OR LOWER(${schema.accounts.accountName}) LIKE '%accounts receivable%')`
      )
    )
    .get();

  // 2. Inventory & Inventory GL
  const inventoryItems = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.companyId, companyId));
  const invGlRow = await db
    .select({
      balance: sql<number>`COALESCE(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`,
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        buildEffectivePostedJournalPredicate(companyId),
        sql`(${schema.accounts.accountType} = 'INVENTORY' OR ${schema.accounts.detailType} IN ('INVENTORY', 'MERCHANDISE_INVENTORY') OR ${schema.accounts.accountCode} IN ('1080', '1130', '1300', '1310') OR LOWER(${schema.accounts.accountName}) LIKE '%inventory%')`
      )
    )
    .get();

  // 3. Payroll
  const activeEmpsRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.employees)
    .where(and(eq(schema.employees.companyId, companyId), eq(schema.employees.status, "ACTIVE")))
    .get();
  const payrollRuns = await db
    .select()
    .from(schema.payrollRuns)
    .where(and(eq(schema.payrollRuns.companyId, companyId), eq(schema.payrollRuns.status, "POSTED")))
    .orderBy(desc(schema.payrollRuns.paymentDate));
  const latestRun = payrollRuns[0] || null;

  // 4. Fixed Assets & Posted Depreciation
  const assets = await db.select().from(schema.fixedAssets).where(eq(schema.fixedAssets.companyId, companyId));
  const postedDeps = await db
    .select({
      assetId: schema.depreciationSchedules.assetId,
      total: sql<number>`COALESCE(sum(${schema.depreciationSchedules.depreciationAmount}), 0)`,
    })
    .from(schema.depreciationSchedules)
    .where(and(eq(schema.depreciationSchedules.companyId, companyId), eq(schema.depreciationSchedules.status, "POSTED")))
    .groupBy(schema.depreciationSchedules.assetId);
  const postedDepByAsset = new Map(postedDeps.map((d) => [d.assetId, Number(d.total || 0)]));

  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentMonthSchedules = await db
    .select({
      status: schema.depreciationSchedules.status,
      total: sql<number>`COALESCE(sum(${schema.depreciationSchedules.depreciationAmount}), 0)`,
    })
    .from(schema.depreciationSchedules)
    .where(and(eq(schema.depreciationSchedules.companyId, companyId), eq(schema.depreciationSchedules.periodMonth, currentMonth)))
    .groupBy(schema.depreciationSchedules.status);
  let pendingMonthlyDepCentavos = 0;
  let postedMonthlyDepCentavos = 0;
  for (const row of currentMonthSchedules) {
    if (row.status === "POSTED") postedMonthlyDepCentavos += Number(row.total || 0);
    if (row.status === "PENDING") pendingMonthlyDepCentavos += Number(row.total || 0);
  }

  // 5. Procurement
  const pos = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.companyId, companyId));
  const grnCountRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.goodsReceiptNotes)
    .where(eq(schema.goodsReceiptNotes.companyId, companyId))
    .get();

  // 6. Banking
  const bankAccCountRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.bankAccounts)
    .where(eq(schema.bankAccounts.companyId, companyId))
    .get();
  const coaBankCountRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.accounts)
    .where(and(
      eq(schema.accounts.companyId, companyId),
      eq(schema.accounts.status, 'ACTIVE'),
      or(
        eq(schema.accounts.isCashAccount, true),
        eq(schema.accounts.accountType, 'BANK'),
        inArray(schema.accounts.detailType, ['CHECKING', 'SAVINGS', 'CASH_ON_HAND', 'PETTY_CASH', 'PAYROLL_BANK', 'DOLLAR_ACCOUNT'])
      )
    ))
    .get();
  const registeredBankAccountsCount = Number(bankAccCountRow?.count || 0);
  const effectiveBankAccountsCount = Math.max(registeredBankAccountsCount, Number(coaBankCountRow?.count || 0));
  const recons = await db.select().from(schema.bankReconciliations).where(eq(schema.bankReconciliations.companyId, companyId));
  const unmatchedBankRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.bankStatementLines)
    .where(and(eq(schema.bankStatementLines.companyId, companyId), eq(schema.bankStatementLines.matchedStatus, "UNMATCHED")))
    .get();

  const rollups = computeOperationsRollupsPure({
    inventoryItems: inventoryItems.map((i) => ({
      quantityOnHand: i.quantityOnHand,
      unitCost: i.unitCost,
      reorderPoint: i.reorderPoint,
      costingMethod: i.costingMethod,
    })),
    fixedAssets: assets.map((a) => ({
      acquisitionCostCentavos: a.acquisitionCost,
      accumulatedDepreciationCentavos: postedDepByAsset.get(a.id) || 0,
      status: a.status,
    })),
    pendingMonthlyDepCentavos,
    postedMonthlyDepCentavos,
    unpaidSalesCentavos,
    outputVatCentavos: Number(outputVatRow?.total || 0),
    totalInvoicesCount: invoices.length,
    postedInvoicesCount: postedInvoices.length,
    draftInvoicesCount: draftInvoices.length,
    vatStatus,
    payrollEmployeesCount: Number(activeEmpsRow?.count || 0),
    latestPayrollRun: latestRun
      ? {
          payrollPeriod: latestRun.payrollPeriod,
          totalGrossPay: latestRun.totalGrossPay,
          totalWithholdingTax: latestRun.totalWithholdingTax,
          totalSss: latestRun.totalSss,
          totalPhilhealth: latestRun.totalPhilhealth,
          totalPagibig: latestRun.totalPagibig,
          totalNetPay: latestRun.totalNetPay,
        }
      : null,
    postedPayrollRunsCount: payrollRuns.length,
    purchaseOrders: pos.map((p) => ({ status: p.status, totalAmount: p.totalAmount })),
    grnCount: Number(grnCountRow?.count || 0),
    bankAccountsCount: effectiveBankAccountsCount,
    registeredBankAccountsCount,
    reconciliations: recons.map((r) => ({
      status: r.status,
      statementEndingBalance: r.statementEndingBalance,
      bookEndingBalance: r.bookEndingBalance,
    })),
    unmatchedBankLinesCount: Number(unmatchedBankRow?.count || 0),
    inventoryGlBalanceCentavos: Number(invGlRow?.balance || 0),
    arGlBalanceCentavos: Number(arGlRow?.balance || 0),
  } as any);

  return {
    companyId,
    vatStatus,
    lastUpdated: new Date().toISOString(),
    ...rollups,
  };
}

export const FinancialSourceOfTruthService = {
  buildOperationsRollup: getAuthoritativeOperationsSummary,
  getAuthoritativeOperationsSummary,
  computeOperationsRollupsPure,
  computeTrialBalanceIntegrityStatus,
  computeWorkingCapitalAndSolvency,
  resolveVatOrPercentageFilingRule,
};

