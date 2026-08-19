import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requirePermission } from "../auth";
import { eq, sql, and, gte, lte } from "drizzle-orm";

const router = Router();

// Helper for metadata
const getReportMetadata = (req: any) => {
  return {
    generatedBy: req.user?.displayName || req.user?.email || "System User",
    generatedAt: new Date().toISOString(),
    companyId: req.activeCompany?.id,
    companyName: req.activeCompany?.legalName || "Active Company",
    filters: req.query
  };
};

// 1. Trial Balance
router.get('/trial-balance', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { startDate, endDate, branchId, departmentId, projectId } = req.query;

  const balances = await db.select({
    accountId: schema.accounts.id,
    accountCode: schema.accounts.accountCode,
    accountName: schema.accounts.accountName,
    accountType: schema.accounts.accountType,
    normalBalance: schema.accounts.normalBalance,
    debitTotal: sql<number>`sum(${schema.journalLines.debit})`,
    creditTotal: sql<number>`sum(${schema.journalLines.credit})`
  })
  .from(schema.journalLines)
  .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
  .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
  .where(
    and(
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.status, "POSTED"),
      startDate ? gte(schema.journalEntries.entryDate, startDate as string) : undefined,
      endDate ? lte(schema.journalEntries.entryDate, endDate as string) : undefined,
      departmentId ? eq(schema.journalLines.departmentId, departmentId as string) : undefined,
      projectId ? eq(schema.journalLines.projectId, projectId as string) : undefined
    )
  )
  .groupBy(schema.accounts.id);

  res.json(balances);
});

// 2. General Ledger
router.get('/general-ledger', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { accountId, startDate, endDate, departmentId, projectId } = req.query;

  const results = await db.select({
    accountId: schema.accounts.id,
    accountCode: schema.accounts.accountCode,
    accountName: schema.accounts.accountName,
    journalId: schema.journalEntries.id,
    journalNumber: schema.journalEntries.journalNumber,
    entryDate: schema.journalEntries.entryDate,
    description: schema.journalEntries.description,
    status: schema.journalEntries.status,
    debit: schema.journalLines.debit,
    credit: schema.journalLines.credit,
    lineDescription: schema.journalLines.description
  })
  .from(schema.journalLines)
  .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
  .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
  .where(
    and(
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.status, "POSTED"),
      accountId ? eq(schema.accounts.id, accountId as string) : undefined,
      startDate ? gte(schema.journalEntries.entryDate, startDate as string) : undefined,
      endDate ? lte(schema.journalEntries.entryDate, endDate as string) : undefined,
      departmentId ? eq(schema.journalLines.departmentId, departmentId as string) : undefined,
      projectId ? eq(schema.journalLines.projectId, projectId as string) : undefined
    )
  );

  res.json(results);
});

// 3. General Journal
router.get('/general-journal', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { startDate, endDate } = req.query;

  const results = await db.select({
    id: schema.journalEntries.id,
    journalNumber: schema.journalEntries.journalNumber,
    entryDate: schema.journalEntries.entryDate,
    description: schema.journalEntries.description,
    status: schema.journalEntries.status,
    lineId: schema.journalLines.id,
    accountId: schema.accounts.id,
    accountCode: schema.accounts.accountCode,
    accountName: schema.accounts.accountName,
    debit: schema.journalLines.debit,
    credit: schema.journalLines.credit,
    lineDescription: schema.journalLines.description
  })
  .from(schema.journalEntries)
  .innerJoin(schema.journalLines, eq(schema.journalEntries.id, schema.journalLines.journalEntryId))
  .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
  .where(
    and(
      eq(schema.journalEntries.companyId, companyId),
      startDate ? gte(schema.journalEntries.entryDate, startDate as string) : undefined,
      endDate ? lte(schema.journalEntries.entryDate, endDate as string) : undefined
    )
  );

  res.json(results);
});

// 4. Balance Sheet
router.get('/balance-sheet', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { startDate, endDate } = req.query;

  const accountsData = await db.select({
    id: schema.accounts.id,
    accountCode: schema.accounts.accountCode,
    accountName: schema.accounts.accountName,
    accountType: schema.accounts.accountType,
    normalBalance: schema.accounts.normalBalance,
    debitTotal: sql<number>`sum(${schema.journalLines.debit})`,
    creditTotal: sql<number>`sum(${schema.journalLines.credit})`
  })
  .from(schema.journalLines)
  .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
  .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
  .where(
    and(
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.status, "POSTED"),
      startDate ? gte(schema.journalEntries.entryDate, startDate as string) : undefined,
      endDate ? lte(schema.journalEntries.entryDate, endDate as string) : undefined
    )
  )
  .groupBy(schema.accounts.id);

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;
  let totalRevenue = 0;
  let totalExpense = 0;

  const assets: any[] = [];
  const liabilities: any[] = [];
  const equity: any[] = [];

  accountsData.forEach(acc => {
    let bal = 0;
    if (acc.accountType === 'ASSET' || acc.accountType === 'EXPENSE' || acc.accountType === 'COST_OF_SALES' || acc.accountType === 'OTHER_EXPENSE') {
      bal = (acc.debitTotal || 0) - (acc.creditTotal || 0);
    } else {
      bal = (acc.creditTotal || 0) - (acc.debitTotal || 0);
    }

    if (acc.accountType === 'ASSET') {
      totalAssets += bal;
      assets.push({ ...acc, balance: bal });
    } else if (acc.accountType === 'LIABILITY') {
      totalLiabilities += bal;
      liabilities.push({ ...acc, balance: bal });
    } else if (acc.accountType === 'EQUITY') {
      totalEquity += bal;
      equity.push({ ...acc, balance: bal });
    } else if (acc.accountType === 'REVENUE' || acc.accountType === 'OTHER_INCOME') {
      totalRevenue += bal;
    } else if (acc.accountType === 'EXPENSE' || acc.accountType === 'COST_OF_SALES' || acc.accountType === 'OTHER_EXPENSE') {
      totalExpense += bal;
    }
  });

  const netIncome = totalRevenue - totalExpense;
  totalEquity += netIncome;

  res.json({
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    netIncome,
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) <= 1
  });
});

// 5. Income Statement
router.get('/income-statement', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { startDate, endDate } = req.query;

  const accountsData = await db.select({
    id: schema.accounts.id,
    accountCode: schema.accounts.accountCode,
    accountName: schema.accounts.accountName,
    accountType: schema.accounts.accountType,
    debitTotal: sql<number>`sum(${schema.journalLines.debit})`,
    creditTotal: sql<number>`sum(${schema.journalLines.credit})`
  })
  .from(schema.journalLines)
  .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
  .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
  .where(
    and(
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.status, "POSTED"),
      startDate ? gte(schema.journalEntries.entryDate, startDate as string) : undefined,
      endDate ? lte(schema.journalEntries.entryDate, endDate as string) : undefined
    )
  )
  .groupBy(schema.accounts.id);

  const revenues: any[] = [];
  const expenses: any[] = [];
  let totalRevenue = 0;
  let totalExpense = 0;

  accountsData.forEach(acc => {
    let bal = 0;
    if (acc.accountType === 'REVENUE' || acc.accountType === 'OTHER_INCOME') {
      bal = (acc.creditTotal || 0) - (acc.debitTotal || 0);
      totalRevenue += bal;
      revenues.push({ ...acc, balance: bal });
    } else if (acc.accountType === 'EXPENSE' || acc.accountType === 'COST_OF_SALES' || acc.accountType === 'OTHER_EXPENSE') {
      bal = (acc.debitTotal || 0) - (acc.creditTotal || 0);
      totalExpense += bal;
      expenses.push({ ...acc, balance: bal });
    }
  });

  const netIncome = totalRevenue - totalExpense;

  res.json({
    revenues,
    expenses,
    totalRevenue,
    totalExpense,
    netIncome
  });
});

// 6. Statement of Cash Flows
router.get('/cash-flow', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const cashLines = await db.select({
    entryId: schema.journalEntries.id,
    entryDate: schema.journalEntries.entryDate,
    description: schema.journalEntries.description,
    debit: schema.journalLines.debit,
    credit: schema.journalLines.credit,
    accountName: schema.accounts.accountName
  })
  .from(schema.journalLines)
  .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
  .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
  .where(
    and(
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.status, "POSTED"),
      eq(schema.accounts.isCashAccount, true)
    )
  );

  let operatingCashFlow = 0;
  cashLines.forEach(l => {
    const net = (l.debit || 0) - (l.credit || 0);
    operatingCashFlow += net;
  });

  res.json({
    operatingCashFlow,
    investingCashFlow: 0,
    financingCashFlow: 0,
    netChangeInCash: operatingCashFlow,
    cashLines
  });
});

// 7. Statement of Changes in Equity
router.get('/changes-in-equity', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { startDate, endDate } = req.query;

  try {
    const accountsData = await db.select({
      id: schema.accounts.id,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      accountType: schema.accounts.accountType,
      debitTotal: sql<number>`sum(${schema.journalLines.debit})`,
      creditTotal: sql<number>`sum(${schema.journalLines.credit})`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, "POSTED"),
        startDate ? gte(schema.journalEntries.entryDate, startDate as string) : undefined,
        endDate ? lte(schema.journalEntries.entryDate, endDate as string) : undefined
      )
    )
    .groupBy(schema.accounts.id);

    let beginningCapital = 0;
    let capitalContributions = 0;
    let totalRevenue = 0;
    let totalExpense = 0;
    let dividendsWithdrawals = 0;

    accountsData.forEach(acc => {
      const netCredit = (acc.creditTotal || 0) - (acc.debitTotal || 0);      const netDebit = (acc.debitTotal || 0) - (acc.creditTotal || 0);

      if (acc.accountType === 'EQUITY') {
        const nameLower = acc.accountName.toLowerCase();
        if (nameLower.includes('dividend') || nameLower.includes('drawing') || nameLower.includes('withdrawal')) {
          dividendsWithdrawals += netDebit > 0 ? netDebit : Math.abs(netCredit);
        } else if (nameLower.includes('capital') || nameLower.includes('share') || nameLower.includes('contribution')) {
          capitalContributions += netCredit;
        } else {
          beginningCapital += netCredit;
        }
      } else if (acc.accountType === 'REVENUE' || acc.accountType === 'OTHER_INCOME') {
        totalRevenue += netCredit;
      } else if (acc.accountType === 'EXPENSE' || acc.accountType === 'COST_OF_SALES' || acc.accountType === 'OTHER_EXPENSE') {
        totalExpense += netDebit;
      }
    });

    const netIncome = totalRevenue - totalExpense;
    const endingEquity = beginningCapital + capitalContributions + netIncome - dividendsWithdrawals;

    res.json([
      { component: 'Beginning Owner / Share Capital', amount: beginningCapital },
      { component: 'Capital Contributions & Paid-in Surplus', amount: capitalContributions },
      { component: 'Net Income / (Loss) for the Period', amount: netIncome },
      { component: 'Less: Dividends Declared & Owner Withdrawals', amount: -dividendsWithdrawals },
      { component: 'Ending Total Equity', amount: endingEquity }
    ]);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to calculate Statement of Changes in Equity" });
  }
});

// 8. Comparative Balance Sheet
router.get('/comparative-balance-sheet', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { currentEndDate, priorEndDate } = req.query;

  try {
    const curEnd = (currentEndDate as string) || new Date().toISOString().slice(0, 10);
    const priEnd = (priorEndDate as string) || `${new Date().getFullYear() - 1}-12-31`;

    const currentAccounts = await db.select({
      id: schema.accounts.id,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      accountType: schema.accounts.accountType,
      debitTotal: sql<number>`sum(${schema.journalLines.debit})`,
      creditTotal: sql<number>`sum(${schema.journalLines.credit})`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, "POSTED"),
        lte(schema.journalEntries.entryDate, curEnd)
      )
    )
    .groupBy(schema.accounts.id);

    const priorAccounts = await db.select({
      id: schema.accounts.id,
      debitTotal: sql<number>`sum(${schema.journalLines.debit})`,
      creditTotal: sql<number>`sum(${schema.journalLines.credit})`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, "POSTED"),
        lte(schema.journalEntries.entryDate, priEnd)
      )
    )
    .groupBy(schema.accounts.id);

    const priorMap = new Map<string, { id: string; debitTotal: number; creditTotal: number }>(priorAccounts.map(p => [p.id, p]));

    const items = currentAccounts
      .filter(a => ['ASSET', 'LIABILITY', 'EQUITY'].includes(a.accountType))
      .map(a => {
        const isAsset = a.accountType === 'ASSET';
        const curBal = isAsset ? (a.debitTotal || 0) - (a.creditTotal || 0) : (a.creditTotal || 0) - (a.debitTotal || 0);
        
        const prior = priorMap.get(a.id);
        const priBal = prior 
          ? (isAsset ? (prior.debitTotal || 0) - (prior.creditTotal || 0) : (prior.creditTotal || 0) - (prior.debitTotal || 0))
          : 0;

        const variance = curBal - priBal;
        const variancePct = priBal !== 0 ? ((variance / Math.abs(priBal)) * 100).toFixed(2) + '%' : 'N/A';

        return {
          accountCode: a.accountCode,
          accountName: a.accountName,
          accountType: a.accountType,
          currentPeriodBalance: curBal,
          priorPeriodBalance: priBal,
          varianceAmount: variance,
          variancePercent: variancePct
        };
      });

    res.json({
      asOfCurrentDate: curEnd,
      asOfPriorDate: priEnd,
      comparison: items
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate Comparative Balance Sheet" });
  }
});

// 9. Comparative Income Statement
router.get('/comparative-income-statement', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const currentYear = new Date().getFullYear();
  const curStart = `${currentYear}-01-01`;
  const curEnd = `${currentYear}-12-31`;
  const priStart = `${currentYear - 1}-01-01`;
  const priEnd = `${currentYear - 1}-12-31`;

  try {
    const currentLines = await db.select({
      accountType: schema.accounts.accountType,
      debitTotal: sql<number>`sum(${schema.journalLines.debit})`,
      creditTotal: sql<number>`sum(${schema.journalLines.credit})`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, "POSTED"),
        gte(schema.journalEntries.entryDate, curStart),
        lte(schema.journalEntries.entryDate, curEnd)
      )
    )
    .groupBy(schema.accounts.accountType);

    const priorLines = await db.select({
      accountType: schema.accounts.accountType,
      debitTotal: sql<number>`sum(${schema.journalLines.debit})`,
      creditTotal: sql<number>`sum(${schema.journalLines.credit})`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, "POSTED"),
        gte(schema.journalEntries.entryDate, priStart),
        lte(schema.journalEntries.entryDate, priEnd)
      )
    )
    .groupBy(schema.accounts.accountType);

    const curRev = currentLines.filter(l => ['REVENUE', 'OTHER_INCOME'].includes(l.accountType)).reduce((s, l) => s + ((l.creditTotal || 0) - (l.debitTotal || 0)), 0);
    const curExp = currentLines.filter(l => ['EXPENSE', 'COST_OF_SALES', 'OTHER_EXPENSE'].includes(l.accountType)).reduce((s, l) => s + ((l.debitTotal || 0) - (l.creditTotal || 0)), 0);
    const curNet = curRev - curExp;

    const priRev = priorLines.filter(l => ['REVENUE', 'OTHER_INCOME'].includes(l.accountType)).reduce((s, l) => s + ((l.creditTotal || 0) - (l.debitTotal || 0)), 0);
    const priExp = priorLines.filter(l => ['EXPENSE', 'COST_OF_SALES', 'OTHER_EXPENSE'].includes(l.accountType)).reduce((s, l) => s + ((l.debitTotal || 0) - (l.creditTotal || 0)), 0);
    const priNet = priRev - priExp;

    res.json([
      {
        lineItem: 'Gross Revenue & Operating Income',
        currentPeriod: curRev,
        priorPeriod: priRev,
        varianceAmount: curRev - priRev,
        variancePercent: priRev !== 0 ? (((curRev - priRev) / Math.abs(priRev)) * 100).toFixed(2) + '%' : 'N/A'
      },
      {
        lineItem: 'Cost of Sales & Operating Expenses',
        currentPeriod: curExp,
        priorPeriod: priExp,
        varianceAmount: curExp - priExp,
        variancePercent: priExp !== 0 ? (((curExp - priExp) / Math.abs(priExp)) * 100).toFixed(2) + '%' : 'N/A'
      },
      {
        lineItem: 'Net Profit / (Loss) Before Income Tax',
        currentPeriod: curNet,
        priorPeriod: priNet,
        varianceAmount: curNet - priNet,
        variancePercent: priNet !== 0 ? (((curNet - priNet) / Math.abs(priNet)) * 100).toFixed(2) + '%' : 'N/A'
      }
    ]);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate Comparative Income Statement" });
  }
});

// 10. Account Schedule
router.get('/account-schedule', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { startDate, endDate } = req.query;

  try {
    const schedules = await db.select({
      accountId: schema.accounts.id,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      accountType: schema.accounts.accountType,
      normalBalance: schema.accounts.normalBalance,
      totalDebit: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      totalCredit: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
    })
    .from(schema.accounts)
    .leftJoin(schema.journalLines, eq(schema.accounts.id, schema.journalLines.accountId))
    .leftJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.accounts.companyId, companyId),
        sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
        startDate ? gte(schema.journalEntries.entryDate, startDate as string) : undefined,
        endDate ? lte(schema.journalEntries.entryDate, endDate as string) : undefined
      )
    )
    .groupBy(schema.accounts.id)
    .orderBy(schema.accounts.accountCode);

    const formattedSchedules = schedules.map(s => {
      const isDebitNormal = s.normalBalance === 'DEBIT' || ['ASSET', 'EXPENSE', 'COST_OF_SALES'].includes(s.accountType);
      const debit = Number(s.totalDebit || 0);
      const credit = Number(s.totalCredit || 0);
      const closingBalance = isDebitNormal ? debit - credit : credit - debit;

      return {
        accountId: s.accountId,
        accountCode: s.accountCode,
        accountName: s.accountName,
        accountType: s.accountType,
        totalDebit: debit,
        totalCredit: credit,
        netMovement: debit - credit,
        closingBalance
      };
    });

    res.json(formattedSchedules);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to generate Account Schedule" });
  }
});

// 11. Transaction Detail
router.get('/transaction-detail', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const entries = await db.select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.companyId, companyId), eq(schema.journalEntries.status, 'POSTED')));

  res.json(entries);
});

// 12. Cashbook
router.get('/cashbook', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const cashLines = await db.select({
    entryDate: schema.journalEntries.entryDate,
    journalNumber: schema.journalEntries.journalNumber,
    description: schema.journalEntries.description,
    debit: schema.journalLines.debit,
    credit: schema.journalLines.credit,
    accountName: schema.accounts.accountName
  })
  .from(schema.journalLines)
  .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
  .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
  .where(
    and(
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.status, "POSTED"),
      eq(schema.accounts.isCashAccount, true)
    )
  );

  res.json(cashLines);
});

// 13. AR Aging
router.get('/ar-aging', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const arAging = await db.select({
    customerId: schema.customers.id,
    customerName: schema.customers.legalName,
    invoiceId: schema.salesInvoices.id,
    invoiceNumber: schema.salesInvoices.invoiceNumber,
    dueDate: schema.salesInvoices.dueDate,
    balanceDue: schema.salesInvoices.balanceDue
  })
  .from(schema.salesInvoices)
  .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
  .where(and(eq(schema.salesInvoices.companyId, companyId), eq(schema.salesInvoices.status, "POSTED")));

  res.json(arAging);
});

// 14. AP Aging
router.get('/ap-aging', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const apAging = await db.select({
    vendorId: schema.vendors.id,
    vendorName: schema.vendors.legalName,
    billId: schema.purchaseBills.id,
    billNumber: schema.purchaseBills.billNumber,
    dueDate: schema.purchaseBills.dueDate,
    balanceDue: schema.purchaseBills.balanceDue
  })
  .from(schema.purchaseBills)
  .innerJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
  .where(and(eq(schema.purchaseBills.companyId, companyId), eq(schema.purchaseBills.status, "POSTED")));

  res.json(apAging);
});

// 15. Bank Reconciliation Report
router.get('/bank-reconciliation-report', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const recs = await db.select()
    .from(schema.bankReconciliations)
    .where(eq(schema.bankReconciliations.companyId, companyId));

  res.json(recs);
});

// 16. Department Report
router.get('/department-report', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const depts = await db.select()
    .from(schema.departments)
    .where(eq(schema.departments.companyId, companyId));

  res.json(depts);
});

// 17. Project Report
router.get("/project-report", requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const projs = await db.select()
    .from(schema.projects)
    .where(eq(schema.projects.companyId, companyId));

  res.json(projs);
});

// 18. Branch Report
router.get("/branch-report", requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const branches = await db.select()
    .from(schema.locations)
    .where(eq(schema.locations.companyId, companyId));

  res.json(branches);
});

// 19. Audit Trail Report
router.get("/audit-trail-report", requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const audits = await db.select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.companyId, companyId));

  res.json(audits);
});

// Unposted transactions
router.get("/unposted-transactions", requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const results = await db.select()
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        sql`${schema.journalEntries.status} != 'POSTED'`,
        sql`${schema.journalEntries.status} != 'VOIDED'`,
        sql`${schema.journalEntries.status} != 'REVERSED'`
      )
    );
  res.json(results);
});

// Posted transactions
router.get("/posted-transactions", requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const results = await db.select()
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, "POSTED")
      )
    );
  res.json(results);
});

// Sign-off endpoint
router.post("/sign-off", requireAuth, requirePermission('accounting:approve'), async (req, res) => {
  const { reportName, notes } = req.body;
  const userId = req.user!.id;
  const companyId = req.activeCompany!.id;

  await db.insert(schema.auditLogs).values({
    id: crypto.randomUUID(),
    companyId,
    userId,
    action: "SIGN_OFF_REPORT",
    entityType: "REPORT",
    entityId: reportName,
    reason: notes,
    result: "SUCCESS"
  });

  res.json({ success: true, message: "Report successfully signed off and certified." });
});

router.get("/integrity-check", requireAuth, requirePermission('audit:view'), async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Company ID is required" });
    }

    const { db, schema } = require('../db');
    const { sql, eq } = require('drizzle-orm');

    // Find unbalanced POSTED entries
    const unbalanced = await db.select({
      id: schema.journalEntries.id,
      journalNumber: schema.journalEntries.journalNumber,
      totalDebit: sql`sum(${schema.journalLines.debit})`,
      totalCredit: sql`sum(${schema.journalLines.credit})`,
      discrepancy: sql`abs(sum(${schema.journalLines.debit}) - sum(${schema.journalLines.credit}))`
    })
    .from(schema.journalEntries)
    .leftJoin(schema.journalLines, eq(schema.journalEntries.id, schema.journalLines.journalEntryId))
    .where(eq(schema.journalEntries.status, 'POSTED'))
    .groupBy(schema.journalEntries.id)
    .having(sql`abs(sum(${schema.journalLines.debit}) - sum(${schema.journalLines.credit})) > 0.001`);

    const countQuery = await db.select({ count: sql`count(*)` })
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.status, 'POSTED'));
      
    const totalPosted = Number(countQuery[0]?.count || 0);

    return res.json({
      totalPosted,
      violationsCount: unbalanced.length,
      violations: unbalanced
    });
  } catch (error) {
    console.error("Error in integrity check:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to run integrity check" });
  }
});

export default router;
