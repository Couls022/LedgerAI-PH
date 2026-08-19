import { db } from "../../../db";
import * as schema from "../../../db/schema";
import { eq, and, sql } from "drizzle-orm";
import { format } from "date-fns";

export interface GetAccountsReceivableSummaryParams {
  companyId: string;
  asOfDate?: string;
  topCount?: number;
}

export interface CustomerAgingRecord {
  customerId: string;
  customerCode: string;
  customerName: string;
  totalBalance: number;
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  days91_plus: number;
  totalOverdue: number;
  openInvoiceCount: number;
  oldestDueDate?: string;
  maxDaysOverdue: number;
}

export interface AccountsReceivableSummaryResult {
  companyId: string;
  asOfDate: string;
  currency: string;
  totalAccountsReceivable: number;
  totalCurrent: number;
  totalOverdue: number;
  overduePercentage: number;
  invoiceStats: {
    totalOpenInvoices: number;
    currentInvoices: number;
    overdueInvoices: number;
    oldestDueDate?: string;
    maxDaysOverdue: number;
  };
  aging: {
    current: { amount: number; count: number; percentage: number };
    days1_30: { amount: number; count: number; percentage: number };
    days31_60: { amount: number; count: number; percentage: number };
    days61_90: { amount: number; count: number; percentage: number };
    days91_plus: { amount: number; count: number; percentage: number };
  };
  topOutstandingCustomers: CustomerAgingRecord[];
  topOverdueCustomers: CustomerAgingRecord[];
  customerAging: CustomerAgingRecord[];
  reconciliation: {
    subsidiaryLedgerTotal: number;
    glControlAccountBalance: number;
    reconciliationDifference: number;
    isReconciled: boolean;
  };
  authoritativeSource: string;
}

export interface GetAccountsPayableSummaryParams {
  companyId: string;
  asOfDate?: string;
  topCount?: number;
}

export interface VendorAgingRecord {
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  totalBalance: number;
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  days91_plus: number;
  totalOverdue: number;
  openBillCount: number;
  oldestDueDate?: string;
  maxDaysOverdue: number;
}

export interface AccountsPayableSummaryResult {
  companyId: string;
  asOfDate: string;
  currency: string;
  totalAccountsPayable: number;
  totalCurrent: number;
  totalOverdue: number;
  overduePercentage: number;
  billStats: {
    totalOpenBills: number;
    currentBills: number;
    overdueBills: number;
    oldestDueDate?: string;
    maxDaysOverdue: number;
  };
  aging: {
    current: { amount: number; count: number; percentage: number };
    days1_30: { amount: number; count: number; percentage: number };
    days31_60: { amount: number; count: number; percentage: number };
    days61_90: { amount: number; count: number; percentage: number };
    days91_plus: { amount: number; count: number; percentage: number };
  };
  topOutstandingVendors: VendorAgingRecord[];
  topOverdueVendors: VendorAgingRecord[];
  vendorAging: VendorAgingRecord[];
  reconciliation: {
    subsidiaryLedgerTotal: number;
    glControlAccountBalance: number;
    reconciliationDifference: number;
    isReconciled: boolean;
  };
  authoritativeSource: string;
}

/**
 * Calculates Accounts Receivable aging, overdue totals, and top outstanding customer balances.
 */
export async function getAccountsReceivableSummary(
  params: GetAccountsReceivableSummaryParams
): Promise<AccountsReceivableSummaryResult> {
  const { companyId } = params;
  if (!companyId) {
    throw new Error('companyId is required to fetch Accounts Receivable summary');
  }

  const asOfDate = params.asOfDate || format(new Date(), 'yyyy-MM-dd');
  const topCount = params.topCount && params.topCount > 0 ? params.topCount : 5;
  const asOfTime = new Date(`${asOfDate}T00:00:00`).getTime();

  // 1. Fetch Customers
  const customerList = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.companyId, companyId));

  // 2. Fetch Open/Posted Sales Invoices (Drafts excluded)
  const openInvoices = await db
    .select({
      id: schema.salesInvoices.id,
      customerId: schema.salesInvoices.customerId,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      invoiceDate: schema.salesInvoices.invoiceDate,
      dueDate: schema.salesInvoices.dueDate,
      totalAmount: schema.salesInvoices.totalAmount,
      balanceDue: schema.salesInvoices.balanceDue,
    })
    .from(schema.salesInvoices)
    .where(
      and(
        eq(schema.salesInvoices.companyId, companyId),
        sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL')`,
        sql`${schema.salesInvoices.balanceDue} > 0`
      )
    );

  // Initialize Customer Aging map
  const agingMap: Record<string, CustomerAgingRecord> = {};
  for (const cust of customerList) {
    agingMap[cust.id] = {
      customerId: cust.id,
      customerCode: cust.code,
      customerName: cust.legalName || cust.tradeName || cust.code,
      totalBalance: 0,
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      days91_plus: 0,
      totalOverdue: 0,
      openInvoiceCount: 0,
      oldestDueDate: undefined,
      maxDaysOverdue: 0,
    };
  }

  let totalSubsidiary = 0;
  let totalCurrent = 0;
  let totalOverdue = 0;
  let countCurrent = 0;
  let countDays1_30 = 0;
  let countDays31_60 = 0;
  let countDays61_90 = 0;
  let countDays91_plus = 0;

  let currentTotal = 0;
  let days1_30Total = 0;
  let days31_60Total = 0;
  let days61_90Total = 0;
  let days91_plusTotal = 0;

  let globalOldestDueDate: string | undefined = undefined;
  let globalMaxDaysOverdue = 0;

  for (const inv of openInvoices) {
    const bal = inv.balanceDue || 0;
    if (bal <= 0) continue;

    totalSubsidiary += bal;

    const dueDateStr = inv.dueDate || inv.invoiceDate;
    const dueTime = new Date(`${dueDateStr}T00:00:00`).getTime();
    const diffDays = Math.floor((asOfTime - dueTime) / (1000 * 60 * 60 * 24));

    if (!agingMap[inv.customerId]) {
      agingMap[inv.customerId] = {
        customerId: inv.customerId,
        customerCode: 'UNKNOWN',
        customerName: 'Unknown Customer',
        totalBalance: 0,
        current: 0,
        days1_30: 0,
        days31_60: 0,
        days61_90: 0,
        days91_plus: 0,
        totalOverdue: 0,
        openInvoiceCount: 0,
        oldestDueDate: undefined,
        maxDaysOverdue: 0,
      };
    }

    const cEntry = agingMap[inv.customerId];
    cEntry.totalBalance += bal;
    cEntry.openInvoiceCount += 1;

    if (!cEntry.oldestDueDate || dueDateStr < cEntry.oldestDueDate) {
      cEntry.oldestDueDate = dueDateStr;
    }
    if (!globalOldestDueDate || dueDateStr < globalOldestDueDate) {
      globalOldestDueDate = dueDateStr;
    }

    if (diffDays <= 0) {
      // Current / Not overdue
      cEntry.current += bal;
      currentTotal += bal;
      totalCurrent += bal;
      countCurrent += 1;
    } else {
      // Overdue
      cEntry.totalOverdue += bal;
      totalOverdue += bal;
      if (diffDays > cEntry.maxDaysOverdue) {
        cEntry.maxDaysOverdue = diffDays;
      }
      if (diffDays > globalMaxDaysOverdue) {
        globalMaxDaysOverdue = diffDays;
      }

      if (diffDays <= 30) {
        cEntry.days1_30 += bal;
        days1_30Total += bal;
        countDays1_30 += 1;
      } else if (diffDays <= 60) {
        cEntry.days31_60 += bal;
        days31_60Total += bal;
        countDays31_60 += 1;
      } else if (diffDays <= 90) {
        cEntry.days61_90 += bal;
        days61_90Total += bal;
        countDays61_90 += 1;
      } else {
        cEntry.days91_plus += bal;
        days91_plusTotal += bal;
        countDays91_plus += 1;
      }
    }
  }

  // Active Customer Aging rows (with non-zero balance)
  const customerAgingRows = Object.values(agingMap).filter((c) => c.totalBalance > 0);

  // Top outstanding customers (by total balance)
  const topOutstandingCustomers = [...customerAgingRows]
    .sort((a, b) => b.totalBalance - a.totalBalance)
    .slice(0, topCount);

  // Top overdue customers (by overdue balance)
  const topOverdueCustomers = [...customerAgingRows]
    .filter((c) => c.totalOverdue > 0)
    .sort((a, b) => b.totalOverdue - a.totalOverdue)
    .slice(0, topCount);

  // Overdue Percentage
  const overduePercentage =
    totalSubsidiary > 0 ? Number(((totalOverdue / totalSubsidiary) * 100).toFixed(2)) : 0;

  // GL Control Account (1120 / 1200 Accounts Receivable)
  let glControlAccountBalance = 0;
  try {
    const arControlAccounts = await db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.companyId, companyId),
          sql`(account_code IN ('1120', '1200') OR (lower(account_name) LIKE '%receivable%' AND lower(account_name) NOT LIKE '%tax%' AND lower(account_name) NOT LIKE '%withholding%'))`
        )
      );

    if (arControlAccounts.length > 0) {
      const arAccountIds = arControlAccounts.map((a) => a.id);
      const journalLinesSum = await db
        .select({
          totalDebit: sql<number>`SUM(${schema.journalLines.debit})`,
          totalCredit: sql<number>`SUM(${schema.journalLines.credit})`,
        })
        .from(schema.journalLines)
        .innerJoin(
          schema.journalEntries,
          eq(schema.journalLines.journalEntryId, schema.journalEntries.id)
        )
        .where(
          and(
            eq(schema.journalEntries.companyId, companyId),
            eq(schema.journalEntries.status, 'POSTED'),
            sql`${schema.journalLines.accountId} IN (${sql.join(
              arAccountIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
        )
        .get();

      if (journalLinesSum) {
        glControlAccountBalance =
          (journalLinesSum.totalDebit || 0) - (journalLinesSum.totalCredit || 0);
      }
    }
  } catch (e) {
    // Non-fatal if accounts not queried
  }

  const reconciliationDifference = totalSubsidiary - glControlAccountBalance;

  return {
    companyId,
    asOfDate,
    currency: 'PHP',
    totalAccountsReceivable: totalSubsidiary,
    totalCurrent,
    totalOverdue,
    overduePercentage,
    invoiceStats: {
      totalOpenInvoices: openInvoices.length,
      currentInvoices: countCurrent,
      overdueInvoices: countDays1_30 + countDays31_60 + countDays61_90 + countDays91_plus,
      oldestDueDate: globalOldestDueDate,
      maxDaysOverdue: globalMaxDaysOverdue,
    },
    aging: {
      current: {
        amount: currentTotal,
        count: countCurrent,
        percentage: totalSubsidiary > 0 ? Number(((currentTotal / totalSubsidiary) * 100).toFixed(2)) : 0,
      },
      days1_30: {
        amount: days1_30Total,
        count: countDays1_30,
        percentage: totalSubsidiary > 0 ? Number(((days1_30Total / totalSubsidiary) * 100).toFixed(2)) : 0,
      },
      days31_60: {
        amount: days31_60Total,
        count: countDays31_60,
        percentage: totalSubsidiary > 0 ? Number(((days31_60Total / totalSubsidiary) * 100).toFixed(2)) : 0,
      },
      days61_90: {
        amount: days61_90Total,
        count: countDays61_90,
        percentage: totalSubsidiary > 0 ? Number(((days61_90Total / totalSubsidiary) * 100).toFixed(2)) : 0,
      },
      days91_plus: {
        amount: days91_plusTotal,
        count: countDays91_plus,
        percentage: totalSubsidiary > 0 ? Number(((days91_plusTotal / totalSubsidiary) * 100).toFixed(2)) : 0,
      },
    },
    topOutstandingCustomers,
    topOverdueCustomers,
    customerAging: customerAgingRows,
    reconciliation: {
      subsidiaryLedgerTotal: totalSubsidiary,
      glControlAccountBalance,
      reconciliationDifference,
      isReconciled: reconciliationDifference === 0,
    },
    authoritativeSource: 'LedgerAI Accounts Receivable Engine',
  };
}

/**
 * Calculates Accounts Payable aging, overdue totals, and top outstanding vendor balances.
 */
export async function getAccountsPayableSummary(
  params: GetAccountsPayableSummaryParams
): Promise<AccountsPayableSummaryResult> {
  const { companyId } = params;
  if (!companyId) {
    throw new Error('companyId is required to fetch Accounts Payable summary');
  }

  const asOfDate = params.asOfDate || format(new Date(), 'yyyy-MM-dd');
  const topCount = params.topCount && params.topCount > 0 ? params.topCount : 5;
  const asOfTime = new Date(`${asOfDate}T00:00:00`).getTime();

  // 1. Fetch Vendors
  const vendorList = await db
    .select()
    .from(schema.vendors)
    .where(eq(schema.vendors.companyId, companyId));

  // 2. Fetch Open/Posted Purchase Bills (Drafts excluded)
  const openBills = await db
    .select({
      id: schema.purchaseBills.id,
      vendorId: schema.purchaseBills.vendorId,
      billNumber: schema.purchaseBills.billNumber,
      billDate: schema.purchaseBills.billDate,
      dueDate: schema.purchaseBills.dueDate,
      totalAmount: schema.purchaseBills.totalAmount,
      balanceDue: schema.purchaseBills.balanceDue,
    })
    .from(schema.purchaseBills)
    .where(
      and(
        eq(schema.purchaseBills.companyId, companyId),
        sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL')`,
        sql`${schema.purchaseBills.balanceDue} > 0`
      )
    );

  // Initialize Vendor Aging map
  const agingMap: Record<string, VendorAgingRecord> = {};
  for (const vend of vendorList) {
    agingMap[vend.id] = {
      vendorId: vend.id,
      vendorCode: vend.code,
      vendorName: vend.legalName || vend.tradeName || vend.code,
      totalBalance: 0,
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      days91_plus: 0,
      totalOverdue: 0,
      openBillCount: 0,
      oldestDueDate: undefined,
      maxDaysOverdue: 0,
    };
  }

  let totalSubsidiary = 0;
  let totalCurrent = 0;
  let totalOverdue = 0;
  let countCurrent = 0;
  let countDays1_30 = 0;
  let countDays31_60 = 0;
  let countDays61_90 = 0;
  let countDays91_plus = 0;

  let currentTotal = 0;
  let days1_30Total = 0;
  let days31_60Total = 0;
  let days61_90Total = 0;
  let days91_plusTotal = 0;

  let globalOldestDueDate: string | undefined = undefined;
  let globalMaxDaysOverdue = 0;

  for (const bill of openBills) {
    const bal = bill.balanceDue || 0;
    if (bal <= 0) continue;

    totalSubsidiary += bal;

    const dueDateStr = bill.dueDate || bill.billDate;
    const dueTime = new Date(`${dueDateStr}T00:00:00`).getTime();
    const diffDays = Math.floor((asOfTime - dueTime) / (1000 * 60 * 60 * 24));

    if (!agingMap[bill.vendorId]) {
      agingMap[bill.vendorId] = {
        vendorId: bill.vendorId,
        vendorCode: 'UNKNOWN',
        vendorName: 'Unknown Vendor',
        totalBalance: 0,
        current: 0,
        days1_30: 0,
        days31_60: 0,
        days61_90: 0,
        days91_plus: 0,
        totalOverdue: 0,
        openBillCount: 0,
        oldestDueDate: undefined,
        maxDaysOverdue: 0,
      };
    }

    const vEntry = agingMap[bill.vendorId];
    vEntry.totalBalance += bal;
    vEntry.openBillCount += 1;

    if (!vEntry.oldestDueDate || dueDateStr < vEntry.oldestDueDate) {
      vEntry.oldestDueDate = dueDateStr;
    }
    if (!globalOldestDueDate || dueDateStr < globalOldestDueDate) {
      globalOldestDueDate = dueDateStr;
    }

    if (diffDays <= 0) {
      // Current / Not overdue
      vEntry.current += bal;
      currentTotal += bal;
      totalCurrent += bal;
      countCurrent += 1;
    } else {
      // Overdue
      vEntry.totalOverdue += bal;
      totalOverdue += bal;
      if (diffDays > vEntry.maxDaysOverdue) {
        vEntry.maxDaysOverdue = diffDays;
      }
      if (diffDays > globalMaxDaysOverdue) {
        globalMaxDaysOverdue = diffDays;
      }

      if (diffDays <= 30) {
        vEntry.days1_30 += bal;
        days1_30Total += bal;
        countDays1_30 += 1;
      } else if (diffDays <= 60) {
        vEntry.days31_60 += bal;
        days31_60Total += bal;
        countDays31_60 += 1;
      } else if (diffDays <= 90) {
        vEntry.days61_90 += bal;
        days61_90Total += bal;
        countDays61_90 += 1;
      } else {
        vEntry.days91_plus += bal;
        days91_plusTotal += bal;
        countDays91_plus += 1;
      }
    }
  }

  // Active Vendor Aging rows (with non-zero balance)
  const vendorAgingRows = Object.values(agingMap).filter((v) => v.totalBalance > 0);

  // Top outstanding vendors (by total balance)
  const topOutstandingVendors = [...vendorAgingRows]
    .sort((a, b) => b.totalBalance - a.totalBalance)
    .slice(0, topCount);

  // Top overdue vendors (by overdue balance)
  const topOverdueVendors = [...vendorAgingRows]
    .filter((v) => v.totalOverdue > 0)
    .sort((a, b) => b.totalOverdue - a.totalOverdue)
    .slice(0, topCount);

  // Overdue Percentage
  const overduePercentage =
    totalSubsidiary > 0 ? Number(((totalOverdue / totalSubsidiary) * 100).toFixed(2)) : 0;

  // GL Control Account (2000 / 2110 Accounts Payable)
  let glControlAccountBalance = 0;
  try {
    const apControlAccounts = await db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.companyId, companyId),
          sql`(account_code IN ('2000', '2110') OR (lower(account_name) LIKE '%payable%' AND lower(account_name) NOT LIKE '%tax%' AND lower(account_name) NOT LIKE '%withholding%'))`
        )
      );

    if (apControlAccounts.length > 0) {
      const apAccountIds = apControlAccounts.map((a) => a.id);
      const journalLinesSum = await db
        .select({
          totalDebit: sql<number>`SUM(${schema.journalLines.debit})`,
          totalCredit: sql<number>`SUM(${schema.journalLines.credit})`,
        })
        .from(schema.journalLines)
        .innerJoin(
          schema.journalEntries,
          eq(schema.journalLines.journalEntryId, schema.journalEntries.id)
        )
        .where(
          and(
            eq(schema.journalEntries.companyId, companyId),
            eq(schema.journalEntries.status, 'POSTED'),
            sql`${schema.journalLines.accountId} IN (${sql.join(
              apAccountIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
        )
        .get();

      if (journalLinesSum) {
        glControlAccountBalance =
          (journalLinesSum.totalCredit || 0) - (journalLinesSum.totalDebit || 0); // Credit - Debit for AP
      }
    }
  } catch (e) {
    // Non-fatal
  }

  const reconciliationDifference = totalSubsidiary - glControlAccountBalance;

  return {
    companyId,
    asOfDate,
    currency: 'PHP',
    totalAccountsPayable: totalSubsidiary,
    totalCurrent,
    totalOverdue,
    overduePercentage,
    billStats: {
      totalOpenBills: openBills.length,
      currentBills: countCurrent,
      overdueBills: countDays1_30 + countDays31_60 + countDays61_90 + countDays91_plus,
      oldestDueDate: globalOldestDueDate,
      maxDaysOverdue: globalMaxDaysOverdue,
    },
    aging: {
      current: {
        amount: currentTotal,
        count: countCurrent,
        percentage: totalSubsidiary > 0 ? Number(((currentTotal / totalSubsidiary) * 100).toFixed(2)) : 0,
      },
      days1_30: {
        amount: days1_30Total,
        count: countDays1_30,
        percentage: totalSubsidiary > 0 ? Number(((days1_30Total / totalSubsidiary) * 100).toFixed(2)) : 0,
      },
      days31_60: {
        amount: days31_60Total,
        count: countDays31_60,
        percentage: totalSubsidiary > 0 ? Number(((days31_60Total / totalSubsidiary) * 100).toFixed(2)) : 0,
      },
      days61_90: {
        amount: days61_90Total,
        count: countDays61_90,
        percentage: totalSubsidiary > 0 ? Number(((days61_90Total / totalSubsidiary) * 100).toFixed(2)) : 0,
      },
      days91_plus: {
        amount: days91_plusTotal,
        count: countDays91_plus,
        percentage: totalSubsidiary > 0 ? Number(((days91_plusTotal / totalSubsidiary) * 100).toFixed(2)) : 0,
      },
    },
    topOutstandingVendors,
    topOverdueVendors,
    vendorAging: vendorAgingRows,
    reconciliation: {
      subsidiaryLedgerTotal: totalSubsidiary,
      glControlAccountBalance,
      reconciliationDifference,
      isReconciled: reconciliationDifference === 0,
    },
    authoritativeSource: 'LedgerAI Accounts Payable Engine',
  };
}

export const arApTools = {
  getAccountsReceivableSummary,
  getAccountsPayableSummary,
};
