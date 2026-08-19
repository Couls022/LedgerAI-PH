import { db } from './index';
import * as schema from './schema';
import { eq, and, sql } from 'drizzle-orm';
import crypto from 'crypto';

export class DomainError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

// Accounting Period
export async function getAccountingPeriod(periodId: string) {
  const period = await db.select().from(schema.accountingPeriods).where(eq(schema.accountingPeriods.id, periodId)).get();
  return period;
}

export async function validateTransactionDateAndPeriod(
  companyId: string,
  transactionDate: string,
  options?: { isClosingAdjustment?: boolean; userRole?: string }
) {
  const formattedDate = transactionDate ? transactionDate.slice(0, 10) : new Date().toISOString().slice(0, 10);

  // 1. Check Company Lock Date
  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if (company && company.lockDate) {
    if (formattedDate <= company.lockDate) {
      console.warn(`[AccountingEngine:ValidationLayer] Failed transaction date check: Locked date ${company.lockDate}.`);
      throw new DomainError(`Transaction date (${formattedDate}) is on or before company lock date (${company.lockDate}). Postings to locked dates are prohibited.`, 'PERIOD_CLOSED_ERROR');
    }
  }

  // 2. Find Accounting Period for the transaction date
  const allCompanyPeriods = await db.select().from(schema.accountingPeriods).where(eq(schema.accountingPeriods.companyId, companyId));
  if (allCompanyPeriods.length > 0) {
    const periods = allCompanyPeriods.filter(p => p.startDate <= formattedDate && p.endDate >= formattedDate);
    if (!periods || periods.length === 0) {
      console.warn(`[AccountingEngine:ValidationLayer] Failed period check: No open period found for date ${formattedDate}.`);
      throw new DomainError(`No open accounting period found for transaction date ${formattedDate}.`, 'PERIOD_CLOSED_ERROR');
    }

    const period = periods[0];

    if (period.status === 'HARD_CLOSED' || period.status === 'LOCKED' || period.status === 'CLOSED') {
      console.warn(`[AccountingEngine:ValidationLayer] Failed period check: Period ${period.name} is ${period.status}.`);
      throw new DomainError(`Accounting period '${period.name}' (${period.startDate} to ${period.endDate}) is ${period.status}. Postings into closed periods are strictly prohibited.`, 'PERIOD_CLOSED_ERROR');
    }

    if (period.status === 'SOFT_CLOSED') {
      const isAuthorized = options?.isClosingAdjustment || options?.userRole === 'Company Owner' || options?.userRole === 'Company Administrator' || options?.userRole === 'System';
      if (!isAuthorized) {
        console.warn(`[AccountingEngine:ValidationLayer] Failed period check: Period ${period.name} is SOFT_CLOSED and user lacks authorization.`);
        throw new DomainError(`Accounting period '${period.name}' is SOFT_CLOSED. Standard postings are prohibited without Company Administrator authorization or closing adjustment status.`, 'PERIOD_CLOSED_ERROR');
      }
    }

    return period;
  }

  return null;
}

export async function validateJournalEntryBalance(tx: any, entryId: string) {
  const lines = await tx.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, entryId));
  const totalDebit = lines.reduce((sum: number, line: any) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum: number, line: any) => sum + line.credit, 0);
  if (totalDebit !== totalCredit) {
    const entry = await tx.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, entryId)).get();
    if (entry) {
      const discrepancy = Math.abs(totalDebit - totalCredit);
      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId: entry.companyId,
        userId: entry.createdBy || 'SYSTEM',
        action: 'SECURITY_ALERT',
        entityType: 'journal_entries',
        entityId: entryId,
        details: JSON.stringify({
          alert: 'UNBALANCED_JOURNAL_POSTING_ATTEMPT',
          totalDebit,
          totalCredit,
          discrepancy,
          message: `Attempted to post an unbalanced journal entry (ID: ${entryId}). Discrepancy amount: ₱${(discrepancy / 100).toFixed(2)}`
        })
      });
    }
    throw new DomainError(`Cannot post unbalanced journal entry. Total Debits (₱${(totalDebit / 100).toFixed(2)}) do not equal Total Credits (₱${(totalCredit / 100).toFixed(2)}).`);
  }
}

export async function createJournalEntry(
  companyId: string, 
  data: {
    journalNumber: string;
    entryDate: string;
    description: string;
    accountingPeriodId?: string;
    createdBy: string;
    isClosingAdjustment?: boolean;
    userRole?: string;
  },
  lines: { accountId: string, debit: number, credit: number, description?: string, departmentId?: string, projectId?: string, costCenterId?: string }[]
) {
  // 1. Period & Lock Date check
  const validatedPeriod = await validateTransactionDateAndPeriod(companyId, data.entryDate, {
    isClosingAdjustment: data.isClosingAdjustment,
    userRole: data.userRole
  });

  let periodIdToUse = validatedPeriod ? validatedPeriod.id : null;

  if (data.accountingPeriodId) {
    const period = await getAccountingPeriod(data.accountingPeriodId);
    if (!period) throw new DomainError('Accounting period not found');
    if (period.companyId !== companyId) throw new DomainError('Accounting period does not belong to the company');
    if (period.status === 'HARD_CLOSED' || period.status === 'CLOSED' || period.status === 'LOCKED') {
      throw new DomainError('Cannot post to a closed period');
    }
    periodIdToUse = period.id;
  }

  // 2. Validate Lines (Unbalanced entries)
  if (!lines || lines.length < 2) {
    throw new DomainError('Journal entry must have at least two valid lines');
  }
  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of lines) {
    if (line.debit < 0 || line.credit < 0) {
      throw new DomainError('Negative monetary values are rejected');
    }
    if (line.debit > 0 && line.credit > 0) {
      throw new DomainError('Line cannot have both debit and credit greater than zero');
    }
    if (line.debit === 0 && line.credit === 0) {
      throw new DomainError('Line must have either debit or credit greater than zero');
    }
    totalDebit += line.debit;
    totalCredit += line.credit;
    
    // Check account exists and belongs to company
    const account = await db.select().from(schema.accounts).where(eq(schema.accounts.id, line.accountId)).get();
    if (!account) throw new DomainError('Account not found');
    if (account.companyId !== companyId) throw new DomainError('Account does not belong to the company');
    if (account.status !== 'ACTIVE') throw new DomainError(`Account ${account.accountCode} - ${account.accountName} is INACTIVE and cannot be used for new transactions.`);
    
    // Check dimensions
    if (line.departmentId) {
      const dept = await db.select().from(schema.departments).where(eq(schema.departments.id, line.departmentId)).get();
      if (!dept || dept.companyId !== companyId || dept.status !== 'ACTIVE') throw new DomainError('Invalid or inactive department');
    }
    if (line.projectId) {
      const proj = await db.select().from(schema.projects).where(eq(schema.projects.id, line.projectId)).get();
      if (!proj || proj.companyId !== companyId || proj.status !== 'ACTIVE') throw new DomainError('Invalid or inactive project');
    }
    if (line.costCenterId) {
      const cc = await db.select().from(schema.costCenters).where(eq(schema.costCenters.id, line.costCenterId)).get();
      if (!cc || cc.companyId !== companyId || cc.status !== 'ACTIVE') throw new DomainError('Invalid or inactive cost center');
    }
  }

  if (totalDebit !== totalCredit) {
    throw new DomainError('Journal entry is unbalanced');
  }

  // 3. Insert transaction
  const entryId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.journalEntries).values({
      id: entryId,
      companyId,
      journalNumber: data.journalNumber,
      entryDate: data.entryDate,
      accountingPeriodId: periodIdToUse,
      description: data.description,
      status: 'DRAFT',
      createdBy: data.createdBy,
    });

    let lineNumber = 1;
    for (const line of lines) {
      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: line.accountId,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        departmentId: line.departmentId || null,
        projectId: line.projectId || null,
        costCenterId: line.costCenterId || null,
        lineNumber: lineNumber++,
      });
    }

    // Generate audit log
    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId: data.createdBy,
      action: 'CREATE_JOURNAL_ENTRY',
      entityType: 'journal_entries',
      entityId: entryId,
      afterData: JSON.stringify({ data, lines }),
    });
  });

  return entryId;
}

export async function createTaxRuleVersion(
  ruleDefinitionId: string,
  data: {
    effectiveFrom: string;
    effectiveTo: string | null;
    calculationMethod: string;
    rateValue: number;
  }
) {
  // Check overlaps
  const existingVersions = await db.select().from(schema.taxRuleVersions).where(eq(schema.taxRuleVersions.ruleDefinitionId, ruleDefinitionId));
  
  for (const version of existingVersions) {
    // Simple overlap check (assuming dates are YYYY-MM-DD and comparable as strings)
    const vStart = version.effectiveFrom;
    const vEnd = version.effectiveTo || '9999-12-31';
    
    const newStart = data.effectiveFrom;
    const newEnd = data.effectiveTo || '9999-12-31';

    if (newStart <= vEnd && newEnd >= vStart) {
      throw new DomainError('Tax rule version overlaps with an existing version');
    }
  }

  const newVersionNumber = existingVersions.length + 1;
  const versionId = crypto.randomUUID();
  await db.insert(schema.taxRuleVersions).values({
    id: versionId,
    ruleDefinitionId,
    version: newVersionNumber,
    ...data
  });
  
  return versionId;
}

export async function submitJournalEntry(companyId: string, entryId: string, userId: string) {
  const entry = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId))).get();
  if (!entry) throw new DomainError('Journal entry not found');
  if (entry.status !== 'DRAFT') throw new DomainError('Only DRAFT entries can be submitted');

  await db.transaction(async (tx) => {
    await tx.update(schema.journalEntries).set({
      status: 'SUBMITTED',
      submittedBy: userId,
      submittedAt: new Date()
    }).where(eq(schema.journalEntries.id, entryId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: 'SUBMIT_JOURNAL_ENTRY',
      entityType: 'journal_entries',
      entityId: entryId,
    });
  });
}

export async function approveJournalEntry(companyId: string, entryId: string, userId: string) {
  const entry = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId))).get();
  if (!entry) throw new DomainError('Journal entry not found');
  if (entry.status !== 'SUBMITTED') throw new DomainError('Only SUBMITTED entries can be approved');
  if (entry.createdBy === userId || entry.submittedBy === userId) {
    throw new DomainError('BRAC Violation: Segregation of Duties. Preparer cannot approve their own entry.');
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.journalEntries).set({
      status: 'APPROVED',
      approvedBy: userId,
      approvedAt: new Date()
    }).where(eq(schema.journalEntries.id, entryId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: 'APPROVE_JOURNAL_ENTRY',
      entityType: 'journal_entries',
      entityId: entryId,
    });
  });
}

export async function rejectJournalEntry(companyId: string, entryId: string, userId: string, reason?: string) {
  const entry = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId))).get();
  if (!entry) throw new DomainError('Journal entry not found');
  if (entry.status !== 'SUBMITTED') throw new DomainError('Only SUBMITTED entries can be rejected');

  await db.transaction(async (tx) => {
    await tx.update(schema.journalEntries).set({
      status: 'DRAFT',
      rejectionReason: reason || 'Rejected by approver',
      updatedAt: new Date()
    }).where(eq(schema.journalEntries.id, entryId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: 'REJECT_JOURNAL_ENTRY',
      entityType: 'journal_entries',
      entityId: entryId,
      reason: reason || 'Rejected by approver',
    });
  });
}

export async function postJournalEntry(companyId: string, entryId: string, userId: string, userRole?: string) {
  const entry = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId))).get();
  if (!entry) throw new DomainError('Journal entry not found');
  if (entry.status !== 'APPROVED') throw new DomainError('Only APPROVED entries can be posted');

  // Validate period & lock date
  await validateTransactionDateAndPeriod(companyId, entry.entryDate, { userRole });

  // REAL-TIME LEDGER VALIDATION: Prevent posting if debits do not equal credits
  const lines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, entryId));
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
  if (totalDebit !== totalCredit) {
    const discrepancy = Math.abs(totalDebit - totalCredit);
    await db.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId: entry.companyId,
      userId: userId,
      action: 'SECURITY_ALERT',
      entityType: 'journal_entries',
      entityId: entryId,
      details: JSON.stringify({
        alert: 'UNBALANCED_JOURNAL_POSTING_ATTEMPT',
        totalDebit,
        totalCredit,
        discrepancy,
        message: `Attempted to post an unbalanced journal entry (ID: ${entryId}). Discrepancy amount: ₱${(discrepancy / 100).toFixed(2)}`
      })
    });
    throw new DomainError(`Cannot post unbalanced journal entry. Total Debits (₱${(totalDebit / 100).toFixed(2)}) do not equal Total Credits (₱${(totalCredit / 100).toFixed(2)}).`);
  }

  await db.transaction(async (tx) => {
    await tx.update(schema.journalEntries).set({
      status: 'POSTED',
      postedBy: userId,
      postedAt: new Date()
    }).where(eq(schema.journalEntries.id, entryId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: 'POST_JOURNAL_ENTRY',
      entityType: 'journal_entries',
      entityId: entryId,
    });
  });
}

export async function reverseJournalEntry(companyId: string, entryId: string, userId: string, reverseDate: string, newPeriodId: string, userRole?: string) {
  const entry = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId))).get();
  if (!entry) throw new DomainError('Journal entry not found');
  if (entry.status !== 'POSTED') throw new DomainError('Only POSTED entries can be reversed');

  // Validate reversal date & period
  await validateTransactionDateAndPeriod(companyId, reverseDate, { userRole });

  const lines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, entryId));

  const reverseEntryId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    // 1. Mark original as reversed
    await tx.update(schema.journalEntries).set({
      status: 'REVERSED',
      reversedAt: new Date()
    }).where(eq(schema.journalEntries.id, entryId));

    // 2. Create reversal entry
    await tx.insert(schema.journalEntries).values({
      id: reverseEntryId,
      companyId,
      journalNumber: `${entry.journalNumber}-REV`,
      entryDate: reverseDate,
      accountingPeriodId: newPeriodId,
      description: `Reversal of ${entry.journalNumber}`,
      status: 'POSTED',
      createdBy: userId,
      postedBy: userId,
      postedAt: new Date(),
      originalJournalId: entry.id
    });

    // 3. Swap debit and credit
    for (const line of lines) {
      await tx.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: reverseEntryId,
        accountId: line.accountId,
        description: line.description,
        debit: line.credit, // SWAP
        credit: line.debit, // SWAP
        lineNumber: line.lineNumber,
      });
    }

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: 'REVERSE_JOURNAL_ENTRY',
      entityType: 'journal_entries',
      entityId: entryId,
      metadata: JSON.stringify({ reverseEntryId })
    });
  });

  return reverseEntryId;
}


export async function softClosePeriod(companyId: string, periodId: string, userId: string, reason?: string) {
  const period = await db.select().from(schema.accountingPeriods).where(
    and(eq(schema.accountingPeriods.id, periodId), eq(schema.accountingPeriods.companyId, companyId))
  ).get();

  if (!period) throw new DomainError("Accounting period not found");
  if (period.status === "HARD_CLOSED" || period.status === "LOCKED") {
    throw new DomainError(`Cannot soft-close a ${period.status} period.`);
  }

  const prevStatus = period.status;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.update(schema.accountingPeriods).set({
      status: "SOFT_CLOSED",
      softClosedAt: now,
      softClosedBy: userId,
      updatedAt: now,
    }).where(eq(schema.accountingPeriods.id, periodId));

    await tx.insert(schema.periodStatusHistory).values({
      id: crypto.randomUUID(),
      companyId,
      accountingPeriodId: periodId,
      action: "SOFT_CLOSE",
      previousStatus: prevStatus,
      newStatus: "SOFT_CLOSED",
      reason: reason || "Soft closed",
      changedBy: userId,
    });
  });
}

export async function hardClosePeriod(companyId: string, periodId: string, userId: string, reason?: string) {
  const period = await db.select().from(schema.accountingPeriods).where(
    and(eq(schema.accountingPeriods.id, periodId), eq(schema.accountingPeriods.companyId, companyId))
  ).get();

  if (!period) throw new DomainError("Accounting period not found");

  const prevStatus = period.status;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.update(schema.accountingPeriods).set({
      status: "HARD_CLOSED",
      hardClosedAt: now,
      hardClosedBy: userId,
      updatedAt: now,
    }).where(eq(schema.accountingPeriods.id, periodId));

    await tx.insert(schema.periodStatusHistory).values({
      id: crypto.randomUUID(),
      companyId,
      accountingPeriodId: periodId,
      action: "HARD_CLOSE",
      previousStatus: prevStatus,
      newStatus: "HARD_CLOSED",
      reason: reason || "Hard closed",
      changedBy: userId,
    });
  });
}

export async function reopenPeriod(companyId: string, periodId: string, userId: string, reason: string) {
  const period = await db.select().from(schema.accountingPeriods).where(
    and(eq(schema.accountingPeriods.id, periodId), eq(schema.accountingPeriods.companyId, companyId))
  ).get();

  if (!period) throw new DomainError("Accounting period not found");
  if (period.status === "OPEN") {
    throw new DomainError("Accounting period is already open.");
  }
  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    throw new DomainError("A non-empty reason is mandatory to reopen an accounting period.");
  }

  const prevStatus = period.status;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.update(schema.accountingPeriods).set({
      status: "OPEN",
      reopenedAt: now,
      reopenedBy: userId,
      reopenReason: reason.trim(),
      updatedAt: now,
    }).where(eq(schema.accountingPeriods.id, periodId));

    await tx.insert(schema.periodStatusHistory).values({
      id: crypto.randomUUID(),
      companyId,
      accountingPeriodId: periodId,
      action: "REOPEN",
      previousStatus: prevStatus,
      newStatus: "OPEN",
      reason: reason.trim(),
      changedBy: userId,
    });
  });
}

export async function performYearEndClose(
  companyId: string,
  fiscalYear: number,
  retainedEarningsAccountId: string,
  userId: string
) {
  // 1. Fetch periods for fiscal year
  const periods = await db.select().from(schema.accountingPeriods).where(
    and(
      eq(schema.accountingPeriods.companyId, companyId),
      eq(schema.accountingPeriods.fiscalYear, fiscalYear)
    )
  ).orderBy(schema.accountingPeriods.startDate);

  if (!periods || periods.length === 0) {
    throw new DomainError(`No accounting periods found for fiscal year ${fiscalYear}.`);
  }

  // Find retained earnings account
  const retainedEarningsAcc = await db.select().from(schema.accounts).where(
    and(
      eq(schema.accounts.id, retainedEarningsAccountId),
      eq(schema.accounts.companyId, companyId)
    )
  ).get();

  if (!retainedEarningsAcc) {
    throw new DomainError('Retained earnings account not found or does not belong to this company.');
  }
  if (retainedEarningsAcc.status !== 'ACTIVE') {
    throw new DomainError('Retained earnings account is not ACTIVE.');
  }

  // Get last date of fiscal year
  const lastPeriod = periods[periods.length - 1];
  const closingDate = lastPeriod.endDate;

  // Query all posted journal lines for revenue & expense accounts in this fiscal year
  const incomeExpenseTypes = ['REVENUE', 'OTHER_INCOME', 'COST_OF_SALES', 'EXPENSE', 'OTHER_EXPENSE'];
  
  const allAccounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
  const incomeExpenseAccountMap = new Map<string, typeof schema.accounts.$inferSelect>();
  for (const acc of allAccounts) {
    if (incomeExpenseTypes.includes(acc.accountType)) {
      incomeExpenseAccountMap.set(acc.id, acc);
    }
  }

  const periodIds = periods.map(p => p.id);
  const postedEntries = await db.select().from(schema.journalEntries).where(
    and(
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.status, 'POSTED')
    )
  );

  const fiscalYearEntryIds = new Set(
    postedEntries
      .filter(e => periodIds.includes(e.accountingPeriodId || '') || (e.entryDate >= periods[0].startDate && e.entryDate <= closingDate))
      .map(e => e.id)
  );

  const accountBalances = new Map<string, { debit: number; credit: number }>();
  if (fiscalYearEntryIds.size > 0) {
    const allLines = await db.select().from(schema.journalLines);
    for (const line of allLines) {
      if (fiscalYearEntryIds.has(line.journalEntryId) && incomeExpenseAccountMap.has(line.accountId)) {
        const current = accountBalances.get(line.accountId) || { debit: 0, credit: 0 };
        current.debit += line.debit;
        current.credit += line.credit;
        accountBalances.set(line.accountId, current);
      }
    }
  }

  // Generate closing lines
  const closingLines: { accountId: string; debit: number; credit: number; description: string }[] = [];
  let totalNetRevenueCredits = 0; // Credit balances (Revenues)
  let totalNetExpenseDebits = 0;  // Debit balances (Expenses)

  for (const [accId, balance] of accountBalances.entries()) {
    const acc = incomeExpenseAccountMap.get(accId)!;
    const net = balance.credit - balance.debit; // Positive = Credit balance, Negative = Debit balance
    if (net > 0) {
      // Revenue / Income account with Net Credit -> Debit it to zero
      closingLines.push({
        accountId: accId,
        debit: net,
        credit: 0,
        description: `Year-End Zeroing for ${acc.accountCode} - ${acc.accountName}`
      });
      totalNetRevenueCredits += net;
    } else if (net < 0) {
      // Expense / Cost account with Net Debit -> Credit it to zero
      const netDebit = Math.abs(net);
      closingLines.push({
        accountId: accId,
        debit: 0,
        credit: netDebit,
        description: `Year-End Zeroing for ${acc.accountCode} - ${acc.accountName}`
      });
      totalNetExpenseDebits += netDebit;
    }
  }

  const netIncome = totalNetRevenueCredits - totalNetExpenseDebits; // Positive = Net Profit, Negative = Net Loss

  if (netIncome > 0) {
    // Net Income -> Credit Retained Earnings
    closingLines.push({
      accountId: retainedEarningsAccountId,
      debit: 0,
      credit: netIncome,
      description: `Transfer Net Income FY${fiscalYear} to Retained Earnings`
    });
  } else if (netIncome < 0) {
    // Net Loss -> Debit Retained Earnings
    closingLines.push({
      accountId: retainedEarningsAccountId,
      debit: Math.abs(netIncome),
      credit: 0,
      description: `Transfer Net Loss FY${fiscalYear} to Retained Earnings`
    });
  }

  let journalEntryId: string | null = null;
  if (closingLines.length > 0) {
    // Post Closing Journal Entry
    journalEntryId = crypto.randomUUID();
    const journalNumber = `YE-${fiscalYear}`;

    await db.transaction(async (tx) => {
      await tx.insert(schema.journalEntries).values({
        id: journalEntryId!,
        companyId,
        journalNumber,
        entryDate: closingDate,
        accountingPeriodId: lastPeriod.id,
        description: `Year-End Closing Entry for Fiscal Year ${fiscalYear}`,
        sourceType: 'YEAR_END_CLOSE',
        status: 'POSTED',
        createdBy: userId,
        submittedBy: userId,
        approvedBy: userId,
        postedBy: userId,
        submittedAt: new Date(),
        approvedAt: new Date(),
        postedAt: new Date(),
      });

      let lineNum = 1;
      for (const cl of closingLines) {
        await tx.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId: journalEntryId!,
          accountId: cl.accountId,
          description: cl.description,
          debit: cl.debit,
          credit: cl.credit,
          lineNumber: lineNum++,
        });
      }
    });
  }

  // Hard close all periods for fiscalYear
  await db.transaction(async (tx) => {
    for (const period of periods) {
      const prevStatus = period.status;
      await tx.update(schema.accountingPeriods).set({
        status: 'HARD_CLOSED',
        hardClosedAt: new Date(),
        hardClosedBy: userId,
        updatedAt: new Date(),
      }).where(eq(schema.accountingPeriods.id, period.id));

      await tx.insert(schema.periodStatusHistory).values({
        id: crypto.randomUUID(),
        companyId,
        accountingPeriodId: period.id,
        action: 'YEAR_END_CLOSE',
        previousStatus: prevStatus,
        newStatus: 'HARD_CLOSED',
        reason: `Year-End Closing for Fiscal Year ${fiscalYear}`,
        changedBy: userId,
      });
    }

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: 'YEAR_END_CLOSE',
      entityType: 'accounting_periods',
      entityId: `FY${fiscalYear}`,
      metadata: JSON.stringify({ fiscalYear, netIncome, journalEntryId }),
    });
  });

  return { journalEntryId, fiscalYear, periodsClosed: periods.length, netIncome };
}

export async function voidJournalEntry(companyId: string, entryId: string, userId: string, reason: string) {
  const journal = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, entryId)).get();
  if (!journal) throw new DomainError('Journal entry not found');
  if (journal.companyId !== companyId) throw new DomainError('Journal entry does not belong to the company');
  if (journal.status === 'POSTED') throw new DomainError('Cannot void a posted journal. Please use reverse instead.');
  if (journal.status === 'VOIDED' || journal.status === 'REVERSED') throw new DomainError('Journal is already voided or reversed');

  await db.transaction(async (tx) => {
    await tx.update(schema.journalEntries).set({
      status: 'VOIDED',
      rejectionReason: reason,
      updatedAt: new Date()
    }).where(eq(schema.journalEntries.id, entryId));

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: 'VOID_JOURNAL',
      entityType: 'JOURNAL_ENTRY',
      entityId: entryId,
      details: JSON.stringify({ reason })
    });
  });
}

export async function copyJournalEntry(companyId: string, entryId: string, userId: string, newDate?: string) {
  const journal = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, entryId)).get();
  if (!journal) throw new DomainError('Journal entry not found');
  if (journal.companyId !== companyId) throw new DomainError('Journal entry does not belong to the company');

  const lines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, entryId)).all();
  if (!lines || lines.length === 0) throw new DomainError('No lines found for journal entry');

  const newEntryDate = newDate || new Date().toISOString().split('T')[0];
  
  return await createJournalEntry(
    companyId,
    {
      journalNumber: `COPY-${Date.now().toString().slice(-6)}`,
      entryDate: newEntryDate,
      description: `Copy of ${journal.journalNumber} - ${journal.description || ''}`.substring(0, 255),
      createdBy: userId,
    },
    lines.map(l => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      description: l.description || undefined,
      departmentId: l.departmentId || undefined,
      projectId: l.projectId || undefined,
      costCenterId: l.costCenterId || undefined
    }))
  );
}

export async function importJournalEntries(companyId: string, userId: string, entriesData: any[]) {
  const results = {
    successCount: 0,
    errorCount: 0,
    errors: [] as { row: number, message: string }[]
  };

  for (let i = 0; i < entriesData.length; i++) {
    const data = entriesData[i];
    try {
      if (!data.journalNumber) throw new DomainError('Missing journalNumber');
      if (!data.entryDate) throw new DomainError('Missing entryDate');
      if (!data.lines || !Array.isArray(data.lines) || data.lines.length === 0) throw new DomainError('Missing lines');
      
      // Duplicate detection based on journal number and company
      const existing = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.companyId, companyId), eq(schema.journalEntries.journalNumber, data.journalNumber))).get();
      if (existing) throw new DomainError(`Duplicate journal number: ${data.journalNumber}`);

      await createJournalEntry(companyId, {
        journalNumber: data.journalNumber,
        entryDate: data.entryDate,
        description: data.description || 'Imported Journal',
        createdBy: userId,
      }, data.lines);
      
      results.successCount++;
    } catch (err: any) {
      results.errorCount++;
      results.errors.push({ row: i + 1, message: err.message });
    }
  }
  
  return results;
}
