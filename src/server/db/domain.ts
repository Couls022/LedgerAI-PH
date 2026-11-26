import { db } from './index';
import * as schema from './schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import crypto from 'crypto';

export class DomainError extends Error {
  code?: string;
  statusCode?: number;
  details?: any;
  constructor(message: string, code?: string, statusCode?: number, details?: any) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.statusCode = statusCode || (code === 'CONCURRENT_MODIFICATION_CONFLICT' ? 409 : 400);
    this.details = details;
  }
}

export async function assertNoDuplicateSourceJournal(
  txRunner: any,
  companyId: string,
  sourceType?: string | null,
  sourceId?: string | null
) {
  if (!sourceType || !sourceId) return;
  const existing = await txRunner
    .select({
      id: schema.journalEntries.id,
      journalNumber: schema.journalEntries.journalNumber,
      status: schema.journalEntries.status,
    })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.sourceType, sourceType),
        eq(schema.journalEntries.sourceId, sourceId),
        inArray(schema.journalEntries.status, ['POSTED', 'REVERSED', 'APPROVED', 'SUBMITTED'])
      )
    )
    .get();

  if (existing) {
    if (existing.status === 'POSTED') {
      return existing;
    }
    throw new DomainError(
      `DUPLICATE_JOURNAL_POSTING: Transaction (${sourceType}:${sourceId}) already has an active journal entry (${existing.journalNumber}, status: ${existing.status}).`,
      'DUPLICATE_JOURNAL_POSTING',
      409,
      { existingJournalId: existing.id, existingJournalNumber: existing.journalNumber, sourceType, sourceId }
    );
  }
}

// Accounting Period
export async function getAccountingPeriod(periodId: string) {
  const period = await db.select().from(schema.accountingPeriods).where(eq(schema.accountingPeriods.id, periodId)).get();
  return period;
}

export function normalizePeriodActorRole(userRole?: string): string | undefined {
  if (!userRole) return undefined;
  const upper = String(userRole).trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (upper === 'COMPANY_OWNER' || upper === 'OWNER' || upper === 'SUPER_ADMIN') return 'Company Owner';
  if (upper === 'COMPANY_ADMINISTRATOR' || upper === 'COMPANY_ADMIN' || upper === 'ADMINISTRATOR' || upper === 'ADMIN') return 'Company Administrator';
  if (upper === 'SYSTEM') return 'System';
  return userRole;
}

export function isAdminPeriodOverrideRole(userRole?: string): boolean {
  if (!userRole) return false;
  const upper = String(userRole).trim().toUpperCase().replace(/[\s-]+/g, '_');
  return [
    'COMPANY_OWNER',
    'OWNER',
    'SUPER_ADMIN',
    'COMPANY_ADMINISTRATOR',
    'COMPANY_ADMIN',
    'ADMINISTRATOR',
    'ADMIN',
    'SYSTEM',
  ].includes(upper);
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
      throw new DomainError(`Transaction date (${formattedDate}) is on or before company lock date (${company.lockDate}). Postings to locked dates are prohibited.`, 'PERIOD_CLOSED_ERROR', 403);
    }
  }

  // 2. Find Accounting Period for the transaction date — FAIL-CLOSED ENFORCEMENT
  const allCompanyPeriods = await db.select().from(schema.accountingPeriods).where(eq(schema.accountingPeriods.companyId, companyId));
  const periods = allCompanyPeriods.filter(p => p.startDate <= formattedDate && p.endDate >= formattedDate);

  if (!periods || periods.length === 0) {
    console.warn(`[AccountingEngine:ValidationLayer] Fail-closed period check: No open accounting period found for date ${formattedDate}.`);
    throw new DomainError(`No open accounting period found for transaction date ${formattedDate}. Postings require an initialized, open accounting period.`, 'PERIOD_CLOSED_ERROR', 403);
  }

  const period = periods[0];

  if (period.status === 'HARD_CLOSED' || period.status === 'LOCKED' || period.status === 'CLOSED') {
    console.warn(`[AccountingEngine:ValidationLayer] Fail-closed period check: Period ${period.name} is ${period.status}.`);
    throw new DomainError(`Accounting period '${period.name}' (${period.startDate} to ${period.endDate}) is ${period.status}. Postings into closed periods are strictly prohibited.`, 'PERIOD_LOCKED', 403);
  }

  if (period.status === 'SOFT_CLOSED') {
    const isAuthorized = Boolean(options?.isClosingAdjustment || isAdminPeriodOverrideRole(options?.userRole));
    if (!isAuthorized) {
      console.warn(`[AccountingEngine:ValidationLayer] Fail-closed period check: Period ${period.name} is SOFT_CLOSED and user lacks authorization.`);
      throw new DomainError(`Accounting period '${period.name}' is SOFT_CLOSED. Standard postings are prohibited without Company Administrator authorization or closing adjustment status.`, 'PERIOD_CLOSED_ERROR', 403);
    }
  }

  return period;
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
    sourceType?: string;
    sourceId?: string;
    createdBy: string;
    isClosingAdjustment?: boolean;
    userRole?: string;
    allowIncomeExpenseOpening?: boolean;
  },
  lines: { accountId: string, debit: number, credit: number, description?: string, departmentId?: string, projectId?: string, costCenterId?: string }[]
) {
  // 1. Period & Lock Date check
  const formattedEntryDate = data.entryDate ? data.entryDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const validatedPeriod = await validateTransactionDateAndPeriod(companyId, formattedEntryDate, {
    isClosingAdjustment: data.isClosingAdjustment,
    userRole: data.userRole
  });

  let periodIdToUse = validatedPeriod ? validatedPeriod.id : null;

  if (data.accountingPeriodId) {
    const period = await getAccountingPeriod(data.accountingPeriodId);
    if (!period) throw new DomainError('Accounting period not found', 'PERIOD_NOT_FOUND', 404);
    if (period.companyId !== companyId) throw new DomainError('Accounting period does not belong to the company', 'TENANT_SCOPE_VIOLATION', 403);
    if (period.status === 'HARD_CLOSED' || period.status === 'CLOSED' || period.status === 'LOCKED') {
      throw new DomainError('Cannot post to a closed period', 'PERIOD_LOCKED', 403);
    }
    if (period.status === 'SOFT_CLOSED') {
      const isAuthorized = Boolean(data.isClosingAdjustment || isAdminPeriodOverrideRole(data.userRole));
      if (!isAuthorized) {
        throw new DomainError(`Accounting period '${period.name}' is SOFT_CLOSED. Standard postings are prohibited without Company Administrator authorization or closing adjustment status.`, 'PERIOD_CLOSED_ERROR', 403);
      }
    }
    if (formattedEntryDate < period.startDate || formattedEntryDate > period.endDate) {
      throw new DomainError(
        `Transaction date (${formattedEntryDate}) does not fall within the specified accounting period '${period.name}' (${period.startDate} to ${period.endDate}).`,
        'PERIOD_DATE_MISMATCH',
        400
      );
    }
    periodIdToUse = period.id;
  }

  // 2. Validate Lines (Unbalanced entries)
  if (!lines || lines.length < 2) {
    throw new DomainError('Journal entry must have at least two valid lines');
  }
  let totalDebit = 0;
  let totalCredit = 0;
  const normalizedSourceType = data.sourceType ? String(data.sourceType).trim().toUpperCase() : null;
  const isOpeningBalanceEntry =
    normalizedSourceType === 'OPENING_BALANCE' || normalizedSourceType === 'OPENING_BALANCE_MIGRATION';

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
    if (!account) throw new DomainError('Account not found', 'NOT_FOUND', 404);
    if (account.companyId !== companyId) throw new DomainError('Account does not belong to the company', 'TENANT_SCOPE_VIOLATION', 403);
    if (account.status !== 'ACTIVE') throw new DomainError(`Account ${account.accountCode} - ${account.accountName} is INACTIVE and cannot be used for new transactions.`, 'INACTIVE_ACCOUNT', 400);

    const childCountRes = await db.select({ count: sql<number>`count(*)` }).from(schema.accounts).where(eq(schema.accounts.parentAccountId, account.id)).get();
    if (childCountRes && Number(childCountRes.count) > 0) {
      throw new DomainError(`Parent header account '${account.accountCode} - ${account.accountName}' cannot be directly posted to. Post to its sub-accounts instead.`, 'PARENT_HEADER_ACCOUNT_POSTING_PROHIBITED', 400);
    }

    if (
      isOpeningBalanceEntry &&
      !data.allowIncomeExpenseOpening &&
      ['REVENUE', 'OTHER_INCOME', 'COST_OF_SALES', 'EXPENSE', 'OTHER_EXPENSE'].includes(account.accountType)
    ) {
      throw new DomainError(
        `Opening balance journals cannot post directly to current-period income/expense account '${account.accountCode} - ${account.accountName}' (${account.accountType}). Post prior-period cumulative earnings to Retained Earnings instead.`,
        'OPENING_BALANCE_INVALID_ACCOUNT_TYPE',
        400
      );
    }
    
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
      entryDate: formattedEntryDate,
      accountingPeriodId: periodIdToUse,
      description: data.description,
      sourceType: data.sourceType || null,
      sourceId: data.sourceId || null,
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

export async function updateJournalEntry(
  companyId: string,
  entryId: string,
  data: {
    entryDate?: string;
    description?: string;
    updatedBy: string;
    userRole?: string;
    expectedVersion?: number;
  },
  lines?: { accountId: string; debit: number; credit: number; description?: string; departmentId?: string; projectId?: string; costCenterId?: string }[]
) {
  return await db.transaction(async (tx) => {
    const entry = await tx.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId))).get();
    if (!entry) throw new DomainError('Journal entry not found', 'NOT_FOUND', 404);
    if (entry.status !== 'DRAFT' && entry.status !== 'RETURNED') {
      throw new DomainError(`Journal entry in status '${entry.status}' is locked and cannot be edited.`, 'IMMUTABLE_RECORD_ERROR', 403);
    }

    if (data.expectedVersion !== undefined && data.expectedVersion !== null) {
      const expVer = Number(data.expectedVersion);
      const curVer = Number(entry.version || 1);
      if (expVer !== curVer) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Record '${entryId}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload the latest record before re-applying changes.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
          {
            recordId: entryId,
            currentVersion: curVer,
            clientVersion: expVer,
            updatedAt: entry.updatedAt,
            updatedBy: entry.createdBy
          }
        );
      }
    }

    const targetDate = (data.entryDate || entry.entryDate).slice(0, 10);
    const resolvedPeriod = await validateTransactionDateAndPeriod(companyId, targetDate, { userRole: data.userRole });

    const oldLines = await tx.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, entryId)).all();

    if (lines) {
      if (lines.length < 2) throw new DomainError('Journal entry must have at least two valid lines');
      let totalDebit = 0;
      let totalCredit = 0;
      for (const line of lines) {
        if (!Number.isInteger(line.debit) || !Number.isInteger(line.credit)) {
          throw new DomainError('Monetary line values must be exact integer centavos.', 'VALIDATION_ERROR', 400);
        }
        if (line.debit < 0 || line.credit < 0) throw new DomainError('Negative monetary values are rejected');
        if (line.debit > 0 && line.credit > 0) throw new DomainError('Line cannot have both debit and credit greater than zero');
        if (line.debit === 0 && line.credit === 0) throw new DomainError('Line must have either debit or credit greater than zero');
        totalDebit += line.debit;
        totalCredit += line.credit;
      }
      if (totalDebit !== totalCredit) throw new DomainError('Journal entry is unbalanced');
    }

    const newVersion = (entry.version || 1) + 1;
    const res = await tx.update(schema.journalEntries).set({
      entryDate: targetDate,
      accountingPeriodId: resolvedPeriod.id,
      description: data.description !== undefined ? data.description : entry.description,
      version: newVersion,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.journalEntries.id, entryId),
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.version, entry.version || 1)
    )).run();

    if (res.changes === 0) {
      throw new DomainError(
        `CONCURRENT_MODIFICATION_CONFLICT: Record '${entryId}' was updated concurrently by another transaction.`,
        'CONCURRENT_MODIFICATION_CONFLICT',
        409,
        {
          recordId: entryId,
          currentVersion: (entry.version || 1) + 1,
          clientVersion: data.expectedVersion
        }
      );
    }

    if (lines) {
      await tx.delete(schema.journalLines).where(eq(schema.journalLines.journalEntryId, entryId));
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
    }

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId: data.updatedBy,
      action: 'UPDATE_JOURNAL_ENTRY',
      entityType: 'journal_entries',
      entityId: entryId,
      beforeData: JSON.stringify({ entry, lines: oldLines }),
      afterData: JSON.stringify({ entryDate: targetDate, description: data.description ?? entry.description, lines: lines || oldLines, version: newVersion }),
    });

    return { ...entry, version: newVersion, entryDate: targetDate, accountingPeriodId: resolvedPeriod.id, description: data.description ?? entry.description };
  });
}

export async function submitJournalEntry(companyId: string, entryId: string, userId: string, expectedVersion?: number) {
  return await db.transaction(async (tx) => {
    const entry = await tx.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId))).get();
    if (!entry) throw new DomainError('Journal entry not found', 'NOT_FOUND', 404);

    if (expectedVersion !== undefined && expectedVersion !== null) {
      const expVer = Number(expectedVersion);
      const curVer = Number(entry.version || 1);
      if (expVer !== curVer) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Record '${entryId}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload before submitting.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
          { recordId: entryId, currentVersion: curVer, clientVersion: expVer }
        );
      }
    }

    if (!['DRAFT', 'RETURNED', 'REJECTED', 'CORRECTION'].includes(String(entry.status || 'DRAFT').toUpperCase())) {
      throw new DomainError('Only DRAFT, RETURNED, or REJECTED entries can be submitted');
    }

    const nextVer = (entry.version || 1) + 1;
    const res = await tx.update(schema.journalEntries).set({
      status: 'SUBMITTED',
      submittedBy: userId,
      submittedAt: new Date(),
      version: nextVer,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.journalEntries.id, entryId),
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.version, entry.version || 1)
    )).run();

    if (res.changes === 0) {
      throw new DomainError(
        `CONCURRENT_MODIFICATION_CONFLICT: Record '${entryId}' was updated concurrently by another transaction.`,
        'CONCURRENT_MODIFICATION_CONFLICT',
        409,
        { recordId: entryId, currentVersion: nextVer, clientVersion: expectedVersion }
      );
    }

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

export async function approveJournalEntry(companyId: string, entryId: string, userId: string, userRole?: string, expectedVersion?: number) {
  return await db.transaction(async (tx) => {
    const entry = await tx.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId))).get();
    if (!entry) throw new DomainError('Journal entry not found', 'NOT_FOUND', 404);

    if (expectedVersion !== undefined && expectedVersion !== null) {
      const expVer = Number(expectedVersion);
      const curVer = Number(entry.version || 1);
      if (expVer !== curVer) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Record '${entryId}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload before approving.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
          { recordId: entryId, currentVersion: curVer, clientVersion: expVer }
        );
      }
    }

    if (!['SUBMITTED', 'REVIEWED', 'UNDER_REVIEW'].includes(String(entry.status || '').toUpperCase())) {
      throw new DomainError('Only SUBMITTED, REVIEWED, or UNDER_REVIEW entries can be approved');
    }

    // Segregation of Duties: Creator/Submitter cannot approve own entry UNLESS authorized as Company Owner/Admin or genuine single-user environment
    if (entry.createdBy === userId || entry.submittedBy === userId) {
      const isOwnerOrAdmin = isAdminPeriodOverrideRole(userRole);
      let companyUserCount = 0;
      let legacyUserCount = 0;
      try {
        const uList = await tx.select({ id: schema.companyUsers.id }).from(schema.companyUsers).where(and(eq(schema.companyUsers.companyId, companyId), eq(schema.companyUsers.status, 'ACTIVE')));
        companyUserCount = uList.length;
      } catch {}
      try {
        const legacyList = await tx.select({ id: schema.users.id }).from(schema.users);
        legacyUserCount = legacyList.length;
      } catch {}

      const effectiveActiveUserCount = Math.max(companyUserCount, legacyUserCount);
      if (!isOwnerOrAdmin && effectiveActiveUserCount !== 1) {
        throw new DomainError('[SOD_JOURNAL_SELF_APPROVAL] BRAC Violation: Segregation of Duties. Preparer/Submitter cannot approve their own entry.', 'SOD_JOURNAL_SELF_APPROVAL');
      }
    }

    const nextVer = (entry.version || 1) + 1;
    const res = await tx.update(schema.journalEntries).set({
      status: 'APPROVED',
      approvedBy: userId,
      approvedAt: new Date(),
      version: nextVer,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.journalEntries.id, entryId),
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.version, entry.version || 1)
    )).run();

    if (res.changes === 0) {
      throw new DomainError(
        `CONCURRENT_MODIFICATION_CONFLICT: Record '${entryId}' was updated concurrently by another transaction.`,
        'CONCURRENT_MODIFICATION_CONFLICT',
        409,
        { recordId: entryId, currentVersion: nextVer, clientVersion: expectedVersion }
      );
    }

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: 'APPROVE_JOURNAL_ENTRY',
      entityType: 'journal_entries',
      entityId: entryId,
    });

    try {
      const openWfs = await tx.select().from(schema.approvalWorkflows).where(
        and(
          eq(schema.approvalWorkflows.companyId, companyId),
          eq(schema.approvalWorkflows.entityType, 'JOURNAL_ENTRY'),
          eq(schema.approvalWorkflows.entityId, entryId),
          inArray(schema.approvalWorkflows.status, ['IN_PROGRESS', 'PENDING'])
        )
      );
      const wfNow = new Date();
      for (const wf of openWfs) {
        await tx.update(schema.approvalWorkflows).set({
          status: 'APPROVED',
          completedAt: wfNow,
          updatedAt: wfNow,
          version: Number(wf.version || 1) + 1,
        }).where(eq(schema.approvalWorkflows.id, wf.id));
        await tx.update(schema.approvalSteps).set({
          status: 'APPROVED',
          decision: 'APPROVE',
          actualApproverId: userId,
          respondedAt: wfNow,
          slaStatus: 'COMPLETED_ON_TIME',
        }).where(and(eq(schema.approvalSteps.workflowId, wf.id), inArray(schema.approvalSteps.status, ['PENDING', 'WAITING'])));
      }
    } catch {}
  });
}

export async function rejectJournalEntry(companyId: string, entryId: string, userId: string, reason?: string, expectedVersion?: number) {
  return await db.transaction(async (tx) => {
    const entry = await tx.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId))).get();
    if (!entry) throw new DomainError('Journal entry not found', 'NOT_FOUND', 404);

    if (expectedVersion !== undefined && expectedVersion !== null) {
      const expVer = Number(expectedVersion);
      const curVer = Number(entry.version || 1);
      if (expVer !== curVer) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Record '${entryId}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload before rejecting.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
          { recordId: entryId, currentVersion: curVer, clientVersion: expVer }
        );
      }
    }

    if (!['SUBMITTED', 'REVIEWED', 'UNDER_REVIEW'].includes(String(entry.status || '').toUpperCase())) {
      throw new DomainError('Only SUBMITTED, REVIEWED, or UNDER_REVIEW entries can be rejected');
    }

    const nextVer = (entry.version || 1) + 1;
    const res = await tx.update(schema.journalEntries).set({
      status: 'DRAFT',
      rejectionReason: reason || 'Rejected by approver',
      version: nextVer,
      updatedAt: new Date()
    }).where(and(
      eq(schema.journalEntries.id, entryId),
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.version, entry.version || 1)
    )).run();

    if (res.changes === 0) {
      throw new DomainError(
        `CONCURRENT_MODIFICATION_CONFLICT: Record '${entryId}' was updated concurrently by another transaction.`,
        'CONCURRENT_MODIFICATION_CONFLICT',
        409,
        { recordId: entryId, currentVersion: nextVer, clientVersion: expectedVersion }
      );
    }

    await tx.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId,
      userId,
      action: 'REJECT_JOURNAL_ENTRY',
      entityType: 'journal_entries',
      entityId: entryId,
      reason: reason || 'Rejected by approver',
    });

    try {
      const openWfs = await tx.select().from(schema.approvalWorkflows).where(
        and(
          eq(schema.approvalWorkflows.companyId, companyId),
          eq(schema.approvalWorkflows.entityType, 'JOURNAL_ENTRY'),
          eq(schema.approvalWorkflows.entityId, entryId),
          inArray(schema.approvalWorkflows.status, ['IN_PROGRESS', 'PENDING'])
        )
      );
      const wfNow = new Date();
      for (const wf of openWfs) {
        await tx.update(schema.approvalWorkflows).set({
          status: 'REJECTED',
          completedAt: wfNow,
          updatedAt: wfNow,
          version: Number(wf.version || 1) + 1,
        }).where(eq(schema.approvalWorkflows.id, wf.id));
        await tx.update(schema.approvalSteps).set({
          status: 'REJECTED',
          decision: 'REJECT',
          actualApproverId: userId,
          rejectionReason: reason || 'Rejected by approver',
          respondedAt: wfNow,
        }).where(and(eq(schema.approvalSteps.workflowId, wf.id), inArray(schema.approvalSteps.status, ['PENDING', 'WAITING'])));
      }
    } catch {}
  });
}

export async function postJournalEntry(companyId: string, entryId: string, userId: string, userRole?: string, expectedVersion?: number) {
  const lines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, entryId));
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);

  return await db.transaction(async (tx) => {
    const entry = await tx.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId))).get();
    if (!entry) throw new DomainError('Journal entry not found', 'NOT_FOUND', 404);

    if (expectedVersion !== undefined && expectedVersion !== null) {
      const expVer = Number(expectedVersion);
      const curVer = Number(entry.version || 1);
      if (expVer !== curVer) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Record '${entryId}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload before posting.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
          { recordId: entryId, currentVersion: curVer, clientVersion: expVer }
        );
      }
    }

    if (entry.status !== 'APPROVED') throw new DomainError('Only APPROVED entries can be posted');

    // Validate period & lock date
    const formattedEntryDate = entry.entryDate ? entry.entryDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const validatedPeriod = await validateTransactionDateAndPeriod(companyId, formattedEntryDate, { userRole });

    if (entry.accountingPeriodId) {
      const explicitPeriod = await getAccountingPeriod(entry.accountingPeriodId);
      if (!explicitPeriod || explicitPeriod.companyId !== companyId) {
        throw new DomainError('Journal entry references an invalid or cross-company accounting period.', 'INVALID_ACCOUNTING_PERIOD', 400);
      }
      if (explicitPeriod.status === 'HARD_CLOSED' || explicitPeriod.status === 'CLOSED' || explicitPeriod.status === 'LOCKED') {
        throw new DomainError(`Accounting period '${explicitPeriod.name}' is ${explicitPeriod.status}. Postings into closed periods are strictly prohibited.`, 'PERIOD_LOCKED', 403);
      }
      if (explicitPeriod.status === 'SOFT_CLOSED' && !isAdminPeriodOverrideRole(userRole)) {
        throw new DomainError(`Accounting period '${explicitPeriod.name}' is SOFT_CLOSED. Posting requires Company Administrator authorization.`, 'PERIOD_CLOSED_ERROR', 403);
      }
      if (formattedEntryDate < explicitPeriod.startDate || formattedEntryDate > explicitPeriod.endDate) {
        throw new DomainError(
          `Journal entry date (${formattedEntryDate}) does not match its assigned accounting period '${explicitPeriod.name}' (${explicitPeriod.startDate} to ${explicitPeriod.endDate}).`,
          'PERIOD_DATE_MISMATCH',
          400
        );
      }
    }

    if (totalDebit !== totalCredit) {
      const discrepancy = Math.abs(totalDebit - totalCredit);
      await tx.insert(schema.auditLogs).values({
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

    const nextVer = (entry.version || 1) + 1;
    const res = await tx.update(schema.journalEntries).set({
      status: 'POSTED',
      accountingPeriodId: entry.accountingPeriodId || validatedPeriod.id,
      postedBy: userId,
      postedAt: new Date(),
      version: nextVer,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.journalEntries.id, entryId),
      eq(schema.journalEntries.companyId, companyId),
      eq(schema.journalEntries.version, entry.version || 1)
    )).run();

    if (res.changes === 0) {
      throw new DomainError(
        `CONCURRENT_MODIFICATION_CONFLICT: Record '${entryId}' was updated concurrently by another transaction.`,
        'CONCURRENT_MODIFICATION_CONFLICT',
        409,
        { recordId: entryId, currentVersion: nextVer, clientVersion: expectedVersion }
      );
    }

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

export async function reverseJournalEntry(companyId: string, entryId: string, userId: string, reverseDate: string, newPeriodId: string, userRole?: string, expectedVersion?: number) {
  // 1. Validate caller role authorization if userRole is provided
  if (userRole) {
    const upperRole = String(userRole).trim().toUpperCase();
    const unauthorizedReverseRoles = ['BOOKKEEPER', 'VIEWER', 'READ_ONLY', 'READ-ONLY', 'AUDITOR', 'EXTERNAL AUDITOR', 'PREPARER', 'STAFF', 'GUEST'];
    if (unauthorizedReverseRoles.includes(upperRole)) {
      throw new DomainError(
        `Role '${userRole}' is not authorized to reverse posted journal entries.`,
        'PERMISSION_DENIED',
        403
      );
    }
  }

  // 2. Verify target journal entry exists and belongs to companyId first
  const preCheckEntry = await db
    .select()
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId)))
    .get();
  if (!preCheckEntry) {
    throw new DomainError('Journal entry not found', 'NOT_FOUND', 404);
  }

  // 3. Validate reversal date & period
  const formattedReverseDate = reverseDate ? reverseDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const validatedRevPeriod = await validateTransactionDateAndPeriod(companyId, formattedReverseDate, { userRole });

  let effectiveRevPeriodId = validatedRevPeriod.id;
  if (newPeriodId && String(newPeriodId).trim()) {
    const revPeriod = await getAccountingPeriod(newPeriodId);
    if (!revPeriod) {
      throw new DomainError('Specified reversal accounting period not found.', 'PERIOD_NOT_FOUND', 404);
    }
    if (revPeriod.companyId !== companyId) {
      throw new DomainError('Reversal accounting period does not belong to the company.', 'TENANT_SCOPE_VIOLATION', 403);
    }
    if (revPeriod.status === 'HARD_CLOSED' || revPeriod.status === 'CLOSED' || revPeriod.status === 'LOCKED') {
      throw new DomainError(`Reversal accounting period '${revPeriod.name}' is ${revPeriod.status}.`, 'PERIOD_LOCKED', 403);
    }
    if (revPeriod.status === 'SOFT_CLOSED' && !isAdminPeriodOverrideRole(userRole)) {
      throw new DomainError(`Reversal accounting period '${revPeriod.name}' is SOFT_CLOSED. Reversing requires Company Administrator authorization.`, 'PERIOD_CLOSED_ERROR', 403);
    }
    if (formattedReverseDate < revPeriod.startDate || formattedReverseDate > revPeriod.endDate) {
      throw new DomainError(
        `Reversal date (${formattedReverseDate}) does not fall within the specified accounting period '${revPeriod.name}' (${revPeriod.startDate} to ${revPeriod.endDate}).`,
        'PERIOD_DATE_MISMATCH',
        400
      );
    }
    effectiveRevPeriodId = revPeriod.id;
  }

  const reverseEntryId = crypto.randomUUID();

  try {
    await db.transaction(async (tx) => {
      const entry = await tx.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId))).get();
      if (!entry) throw new DomainError('Journal entry not found', 'NOT_FOUND', 404);

      if (expectedVersion !== undefined && expectedVersion !== null) {
        const expVer = Number(expectedVersion);
        const curVer = Number(entry.version || 1);
        if (expVer !== curVer) {
          throw new DomainError(
            `CONCURRENT_MODIFICATION_CONFLICT: Record '${entryId}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload before reversing.`,
            'CONCURRENT_MODIFICATION_CONFLICT',
            409,
            { recordId: entryId, currentVersion: curVer, clientVersion: expVer }
          );
        }
      }

      if (entry.status === 'REVERSED') {
        throw new DomainError(
          `Only POSTED entries can be reversed: Journal entry '${entry.journalNumber}' has already been reversed.`,
          'ALREADY_REVERSED',
          409
        );
      }

      if (entry.status !== 'POSTED') {
        throw new DomainError('Only POSTED entries can be reversed', 'INVALID_STATUS_TRANSITION', 400);
      }

      // Prevent reversing a reversal journal entry itself
      if (
        entry.originalJournalId ||
        String(entry.journalNumber || '').endsWith('-REV') ||
        String(entry.journalNumber || '').startsWith('REV-') ||
        ['REVERSAL', 'JOURNAL_REVERSAL'].includes(String(entry.sourceType || '').toUpperCase())
      ) {
        throw new DomainError(
          'Cannot reverse a reversal journal entry directly; post a new adjusting entry instead.',
          'CANNOT_REVERSE_REVERSAL',
          400
        );
      }

      // Prevent duplicate reversal of an original journal entry (enforce at most 1 reversal child per original journal)
      const existingChildReversals = await tx
        .select()
        .from(schema.journalEntries)
        .where(
          and(
            eq(schema.journalEntries.companyId, companyId),
            eq(schema.journalEntries.originalJournalId, entryId)
          )
        );
      if (
        existingChildReversals.some(
          (r) =>
            r.status === 'POSTED' ||
            r.status === 'REVERSED' ||
            String(r.journalNumber || '').endsWith('-REV') ||
            ['REVERSAL', 'JOURNAL_REVERSAL'].includes(String(r.sourceType || '').toUpperCase())
        )
      ) {
        throw new DomainError(
          `Only POSTED entries can be reversed: Journal entry '${entry.journalNumber}' has already been reversed.`,
          'ALREADY_REVERSED',
          409
        );
      }

      const lines = await tx.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, entryId));
      if (!lines || lines.length < 2) {
        throw new DomainError(
          `Cannot reverse journal entry '${entry.journalNumber}' because it has fewer than two lines.`,
          'UNBALANCED_REVERSAL_ERROR',
          400
        );
      }
      const origDebitSum = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const origCreditSum = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      if (origDebitSum <= 0 || origDebitSum !== origCreditSum) {
        throw new DomainError(
          `Cannot reverse unbalanced journal entry '${entry.journalNumber}' (Debit=${origDebitSum}, Credit=${origCreditSum}).`,
          'UNBALANCED_REVERSAL_ERROR',
          400
        );
      }

      const nextVer = (entry.version || 1) + 1;
      const reversedAtTimestamp = new Date();
      // 1. Mark original as reversed (preserving full original record & lines for immutable audit lineage)
      const res = await tx.update(schema.journalEntries).set({
        status: 'REVERSED',
        reversedAt: reversedAtTimestamp,
        version: nextVer,
        updatedAt: reversedAtTimestamp,
      }).where(and(
        eq(schema.journalEntries.id, entryId),
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.version, entry.version || 1)
      )).run();

      if (res.changes === 0) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Record '${entryId}' was updated concurrently by another transaction.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
          { recordId: entryId, currentVersion: nextVer, clientVersion: expectedVersion }
        );
      }

      // 2. Create reversal entry linked to originalJournalId
      await tx.insert(schema.journalEntries).values({
        id: reverseEntryId,
        companyId,
        journalNumber: `${entry.journalNumber}-REV`,
        entryDate: formattedReverseDate,
        accountingPeriodId: effectiveRevPeriodId,
        description: `Reversal of ${entry.journalNumber}`,
        sourceType: 'REVERSAL',
        sourceId: entry.id,
        status: 'POSTED',
        createdBy: userId,
        submittedBy: userId,
        approvedBy: userId,
        postedBy: userId,
        submittedAt: reversedAtTimestamp,
        approvedAt: reversedAtTimestamp,
        postedAt: reversedAtTimestamp,
        originalJournalId: entry.id,
        departmentId: entry.departmentId || null,
        projectId: entry.projectId || null,
        costCenterId: entry.costCenterId || null,
        version: 1,
      });

      // 3. Swap debit and credit while preserving dimensions
      for (const line of lines) {
        await tx.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId: reverseEntryId,
          accountId: line.accountId,
          description: line.description,
          debit: line.credit, // SWAP
          credit: line.debit, // SWAP
          departmentId: line.departmentId || null,
          projectId: line.projectId || null,
          costCenterId: line.costCenterId || null,
          lineNumber: line.lineNumber,
        });
      }

      // Verify swapped reversal entry balance
      await validateJournalEntryBalance(tx, reverseEntryId);

      // 4. Write audit log on original entry
      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        userId,
        action: 'REVERSE_JOURNAL_ENTRY',
        entityType: 'journal_entries',
        entityId: entryId,
        beforeData: JSON.stringify({
          id: entry.id,
          journalNumber: entry.journalNumber,
          entryDate: entry.entryDate,
          accountingPeriodId: entry.accountingPeriodId,
          status: entry.status,
          version: entry.version || 1,
        }),
        afterData: JSON.stringify({
          id: entry.id,
          journalNumber: entry.journalNumber,
          status: 'REVERSED',
          version: nextVer,
          reverseEntryId,
          reverseJournalNumber: `${entry.journalNumber}-REV`,
          reverseDate: formattedReverseDate,
          reverseAccountingPeriodId: effectiveRevPeriodId,
        }),
        metadata: JSON.stringify({
          reverseEntryId,
          originalJournalId: entry.id,
          reverseDate: formattedReverseDate,
          accountingPeriodId: effectiveRevPeriodId,
        })
      });

      // 5. Write audit log on newly generated reversal entry for complete 360° audit history
      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        userId,
        action: 'POST_REVERSAL_JOURNAL_ENTRY',
        entityType: 'journal_entries',
        entityId: reverseEntryId,
        afterData: JSON.stringify({
          id: reverseEntryId,
          journalNumber: `${entry.journalNumber}-REV`,
          entryDate: formattedReverseDate,
          accountingPeriodId: effectiveRevPeriodId,
          status: 'POSTED',
          sourceType: 'REVERSAL',
          originalJournalId: entry.id,
          totalDebit: origCreditSum,
          totalCredit: origDebitSum,
        }),
        metadata: JSON.stringify({
          originalJournalId: entry.id,
          originalJournalNumber: entry.journalNumber,
          reverseDate: formattedReverseDate,
          accountingPeriodId: effectiveRevPeriodId,
        })
      });
    });
  } catch (err: any) {
    const isUniqueConstraint = String(err?.message || '').includes('unq_reversal_child_per_original') ||
      String(err?.message || '').includes('UNIQUE constraint failed: journal_entries.company_id, journal_entries.original_journal_id');
    if (err?.code === 'ALREADY_REVERSED' || err?.code === 'CONCURRENT_MODIFICATION_CONFLICT' || isUniqueConstraint) {
      try {
        const orig = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.id, entryId), eq(schema.journalEntries.companyId, companyId))).get();
        const existingReversals = await db.select().from(schema.journalEntries).where(and(eq(schema.journalEntries.companyId, companyId), eq(schema.journalEntries.originalJournalId, entryId)));
        await db.insert(schema.auditLogs).values({
          id: crypto.randomUUID(),
          companyId,
          userId,
          action: 'DUPLICATE_REVERSAL_ATTEMPT_BLOCKED',
          entityType: 'journal_entries',
          entityId: entryId,
          afterData: JSON.stringify({
            originalJournalId: entryId,
            originalJournalNumber: orig?.journalNumber || null,
            conflictingReversalIds: existingReversals.map((r) => r.id),
            conflictingReversalNumbers: existingReversals.map((r) => r.journalNumber),
            attemptedReversalId: reverseEntryId,
          }),
          metadata: JSON.stringify({
            originalJournalId: entryId,
            originalJournalNumber: orig?.journalNumber || null,
            conflictingReversalIds: existingReversals.map((r) => r.id),
            conflictingReversalNumbers: existingReversals.map((r) => r.journalNumber),
            reason: err?.code || 'UNIQUE_CONSTRAINT_VIOLATION',
          }),
        });
      } catch (_) {}
    }
    if (isUniqueConstraint && !(err instanceof DomainError)) {
      throw new DomainError(
        `Only POSTED entries can be reversed: Journal entry '${entryId}' has already been reversed.`,
        'ALREADY_REVERSED',
        409
      );
    }
    throw err;
  }

  return reverseEntryId;
}


export async function softClosePeriod(companyId: string, periodId: string, userId: string, reason?: string, expectedVersion?: number) {
  const period = await db.select().from(schema.accountingPeriods).where(
    and(eq(schema.accountingPeriods.id, periodId), eq(schema.accountingPeriods.companyId, companyId))
  ).get();

  if (!period) throw new DomainError("Accounting period not found", "NOT_FOUND", 404);

  if (expectedVersion !== undefined && expectedVersion !== null) {
    const expVer = Number(expectedVersion);
    const curVer = Number(period.version || 1);
    if (expVer !== curVer) {
      throw new DomainError(
        `CONCURRENT_MODIFICATION_CONFLICT: Accounting period '${period.name}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload before soft-closing.`,
        "CONCURRENT_MODIFICATION_CONFLICT",
        409,
        { recordId: periodId, currentVersion: curVer, clientVersion: expVer }
      );
    }
  }

  if (period.status === "HARD_CLOSED" || period.status === "LOCKED") {
    throw new DomainError(`Cannot soft-close a ${period.status} period.`);
  }

  const prevStatus = period.status;
  const now = new Date();
  const nextVer = Number(period.version || 1) + 1;

  await db.transaction(async (tx) => {
    const res = await tx.update(schema.accountingPeriods).set({
      status: "SOFT_CLOSED",
      softClosedAt: now,
      softClosedBy: userId,
      version: nextVer,
      updatedAt: now,
    }).where(and(
      eq(schema.accountingPeriods.id, periodId),
      eq(schema.accountingPeriods.companyId, companyId),
      eq(schema.accountingPeriods.version, period.version || 1)
    )).run();

    if (res.changes === 0) {
      throw new DomainError(
        `CONCURRENT_MODIFICATION_CONFLICT: Accounting period '${periodId}' was updated concurrently by another transaction.`,
        "CONCURRENT_MODIFICATION_CONFLICT",
        409,
        { recordId: periodId, currentVersion: nextVer, clientVersion: expectedVersion }
      );
    }

    await tx.insert(schema.periodStatusHistory).values({
      id: crypto.randomUUID(),
      companyId,
      accountingPeriodId: periodId,
      action: "SOFT_CLOSE",
      previousStatus: prevStatus,
      newStatus: "SOFT_CLOSED",
      reason: reason || "Soft closed",
      changedBy: userId,
      createdAt: now,
    });
  });
}

export async function hardClosePeriod(companyId: string, periodId: string, userId: string, reason?: string, expectedVersion?: number) {
  const period = await db.select().from(schema.accountingPeriods).where(
    and(eq(schema.accountingPeriods.id, periodId), eq(schema.accountingPeriods.companyId, companyId))
  ).get();

  if (!period) throw new DomainError("Accounting period not found", "NOT_FOUND", 404);

  if (expectedVersion !== undefined && expectedVersion !== null) {
    const expVer = Number(expectedVersion);
    const curVer = Number(period.version || 1);
    if (expVer !== curVer) {
      throw new DomainError(
        `CONCURRENT_MODIFICATION_CONFLICT: Accounting period '${period.name}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload before hard-closing.`,
        "CONCURRENT_MODIFICATION_CONFLICT",
        409,
        { recordId: periodId, currentVersion: curVer, clientVersion: expVer }
      );
    }
  }

  const prevStatus = period.status;
  const now = new Date();
  const nextVer = Number(period.version || 1) + 1;

  await db.transaction(async (tx) => {
    const res = await tx.update(schema.accountingPeriods).set({
      status: "HARD_CLOSED",
      hardClosedAt: now,
      hardClosedBy: userId,
      version: nextVer,
      updatedAt: now,
    }).where(and(
      eq(schema.accountingPeriods.id, periodId),
      eq(schema.accountingPeriods.companyId, companyId),
      eq(schema.accountingPeriods.version, period.version || 1)
    )).run();

    if (res.changes === 0) {
      throw new DomainError(
        `CONCURRENT_MODIFICATION_CONFLICT: Accounting period '${periodId}' was updated concurrently by another transaction.`,
        "CONCURRENT_MODIFICATION_CONFLICT",
        409,
        { recordId: periodId, currentVersion: nextVer, clientVersion: expectedVersion }
      );
    }

    await tx.insert(schema.periodStatusHistory).values({
      id: crypto.randomUUID(),
      companyId,
      accountingPeriodId: periodId,
      action: "HARD_CLOSE",
      previousStatus: prevStatus,
      newStatus: "HARD_CLOSED",
      reason: reason || "Hard closed",
      changedBy: userId,
      createdAt: now,
    });
  });
}

export async function reopenPeriod(companyId: string, periodId: string, userId: string, reason: string, expectedVersion?: number) {
  const period = await db.select().from(schema.accountingPeriods).where(
    and(eq(schema.accountingPeriods.id, periodId), eq(schema.accountingPeriods.companyId, companyId))
  ).get();

  if (!period) throw new DomainError("Accounting period not found", "NOT_FOUND", 404);

  if (expectedVersion !== undefined && expectedVersion !== null) {
    const expVer = Number(expectedVersion);
    const curVer = Number(period.version || 1);
    if (expVer !== curVer) {
      throw new DomainError(
        `CONCURRENT_MODIFICATION_CONFLICT: Accounting period '${period.name}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload before reopening.`,
        "CONCURRENT_MODIFICATION_CONFLICT",
        409,
        { recordId: periodId, currentVersion: curVer, clientVersion: expVer }
      );
    }
  }

  if (period.status === "OPEN") {
    throw new DomainError("Accounting period is already open.");
  }
  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    throw new DomainError("A non-empty reason is mandatory to reopen an accounting period.");
  }

  const prevStatus = period.status;
  const now = new Date();
  const nextVer = Number(period.version || 1) + 1;

  await db.transaction(async (tx) => {
    const res = await tx.update(schema.accountingPeriods).set({
      status: "OPEN",
      reopenedAt: now,
      reopenedBy: userId,
      reopenReason: reason.trim(),
      version: nextVer,
      updatedAt: now,
    }).where(and(
      eq(schema.accountingPeriods.id, periodId),
      eq(schema.accountingPeriods.companyId, companyId),
      eq(schema.accountingPeriods.version, period.version || 1)
    )).run();

    if (res.changes === 0) {
      throw new DomainError(
        `CONCURRENT_MODIFICATION_CONFLICT: Accounting period '${periodId}' was updated concurrently by another transaction.`,
        "CONCURRENT_MODIFICATION_CONFLICT",
        409,
        { recordId: periodId, currentVersion: nextVer, clientVersion: expectedVersion }
      );
    }

    await tx.insert(schema.periodStatusHistory).values({
      id: crypto.randomUUID(),
      companyId,
      accountingPeriodId: periodId,
      action: "REOPEN",
      previousStatus: prevStatus,
      newStatus: "OPEN",
      reason: reason.trim(),
      changedBy: userId,
      createdAt: now,
    });
  });
}

export async function performYearEndClose(
  companyId: string,
  fiscalYear: number,
  retainedEarningsAccountId: string,
  userId: string,
  options?: { userName?: string; userRole?: string }
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
  const journalNumber = `YE-${fiscalYear}`;

  // Ensure immutable period_close_certifications table & triggers exist prior to transaction
  try {
    db.run(sql.raw(`
      CREATE TABLE IF NOT EXISTS period_close_certifications (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        period_id TEXT NOT NULL,
        period_name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        fiscal_year INTEGER NOT NULL,
        close_type TEXT NOT NULL DEFAULT 'HARD_CLOSE',
        validation_snapshot_id TEXT,
        checklist_results_json TEXT NOT NULL,
        financial_overview_json TEXT NOT NULL,
        trial_balance_totals_json TEXT NOT NULL,
        unresolved_exceptions_json TEXT NOT NULL,
        warning_justification TEXT,
        closing_reason TEXT NOT NULL,
        reconciliation_refs_json TEXT NOT NULL,
        closed_by_user_id TEXT NOT NULL,
        closed_by_user_name TEXT NOT NULL,
        closed_by_user_role TEXT NOT NULL,
        approved_by_user_id TEXT,
        approved_by_user_name TEXT,
        approved_by_user_role TEXT,
        closed_at TEXT NOT NULL,
        closing_policy_version INTEGER NOT NULL DEFAULT 1,
        audit_event_id TEXT,
        sha256_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `));
    db.run(sql.raw(`
      CREATE TRIGGER IF NOT EXISTS trg_period_close_cert_no_update
      BEFORE UPDATE ON period_close_certifications
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CERTIFICATION_SNAPSHOT: Period close certification snapshots cannot be modified.');
      END;
    `));
    db.run(sql.raw(`
      CREATE TRIGGER IF NOT EXISTS trg_period_close_cert_no_delete
      BEFORE DELETE ON period_close_certifications
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CERTIFICATION_SNAPSHOT: Period close certification snapshots cannot be deleted.');
      END;
    `));
  } catch (_) {}

  // Check for existing active YEAR_END_CLOSE entry and prior closed status
  const existingYearEndJournal = await db
    .select()
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.sourceType, 'YEAR_END_CLOSE'),
        eq(schema.journalEntries.journalNumber, journalNumber),
        eq(schema.journalEntries.status, 'POSTED')
      )
    )
    .get();

  const existingCert = db.get(sql`
    SELECT id, sha256_hash FROM period_close_certifications
    WHERE company_id = ${companyId} AND period_id = ${lastPeriod.id} AND close_type = 'YEAR_END_CLOSE'
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `) as any;

  const allAlreadyHardClosed = periods.every(p => p.status === 'HARD_CLOSED' || p.status === 'LOCKED');

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
      sql`(
        ${schema.journalEntries.status} = 'POSTED'
        OR (
          ${schema.journalEntries.status} = 'REVERSED'
          AND EXISTS (
            SELECT 1 FROM journal_entries rev_je
            WHERE rev_je.company_id = ${schema.journalEntries.companyId}
              AND rev_je.original_journal_id = ${schema.journalEntries.id}
              AND rev_je.status = 'POSTED'
          )
        )
      )`,
      sql`UPPER(COALESCE(${schema.journalEntries.sourceType}, '')) NOT IN ('OPENING_BALANCE', 'OPENING_BALANCE_MIGRATION')`
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
  let totalNetRevenueCredits = 0;
  let totalNetExpenseDebits = 0;

  for (const [accId, balance] of accountBalances.entries()) {
    const acc = incomeExpenseAccountMap.get(accId)!;
    const net = balance.credit - balance.debit;
    if (net > 0) {
      closingLines.push({
        accountId: accId,
        debit: net,
        credit: 0,
        description: `Year-End Zeroing for ${acc.accountCode} - ${acc.accountName}`
      });
      totalNetRevenueCredits += net;
    } else if (net < 0) {
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

  const netIncome = totalNetRevenueCredits - totalNetExpenseDebits;

  if (netIncome > 0) {
    closingLines.push({
      accountId: retainedEarningsAccountId,
      debit: 0,
      credit: netIncome,
      description: `Transfer Net Income FY${fiscalYear} to Retained Earnings`
    });
  } else if (netIncome < 0) {
    closingLines.push({
      accountId: retainedEarningsAccountId,
      debit: Math.abs(netIncome),
      credit: 0,
      description: `Transfer Net Loss FY${fiscalYear} to Retained Earnings`
    });
  }

  // Duplicate year-end close idempotency guard: if FY is already hard-closed with no remaining open net income, return cleanly without mutating versions/history/certifications
  if (allAlreadyHardClosed && closingLines.length === 0) {
    return {
      journalEntryId: existingYearEndJournal?.id || null,
      fiscalYear,
      periodsClosed: 0,
      netIncome: 0,
      netIncomeTransferred: 0,
      alreadyClosed: true,
      certificationId: existingCert?.id || null,
      certificationSha256: existingCert?.sha256_hash || null,
    };
  }

  // Resolve actor metadata for immutable certification snapshot
  const actorUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  const actorName = options?.userName || actorUser?.displayName || actorUser?.email || userId;
  const actorRole = normalizePeriodActorRole(options?.userRole) || 'Company Administrator';

  // Ensure unique journalNumber if an earlier YEAR_END_CLOSE exists (e.g., reopened FY adjustment close)
  const effectiveJournalNumber = existingYearEndJournal
    ? `YE-${fiscalYear}-ADJ-${Date.now().toString().slice(-6)}`
    : journalNumber;

  let journalEntryId: string | null = null;
  const certId = `CERT-YE-${fiscalYear}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const closedAtIso = new Date().toISOString();
  const nowDate = new Date();
  const nowSec = Math.floor(nowDate.getTime() / 1000);
  const auditEventId = crypto.randomUUID();

  const totalClosingDebit = closingLines.reduce((s, l) => s + l.debit, 0);
  const totalClosingCredit = closingLines.reduce((s, l) => s + l.credit, 0);

  const trialBalanceTotals = {
    totalDebitCentavos: totalClosingDebit,
    totalCreditCentavos: totalClosingCredit,
    varianceCentavos: Math.abs(totalClosingDebit - totalClosingCredit),
    trialBalanceStatus: totalClosingDebit === totalClosingCredit ? 'BALANCED' : 'OUT_OF_BALANCE',
    fiscalYearRevenueCreditsCentavos: totalNetRevenueCredits,
    fiscalYearExpenseDebitsCentavos: totalNetExpenseDebits,
    netIncomeTransferredCentavos: netIncome,
  };

  const financialOverview = {
    fiscalYear,
    periodsClosedCount: periods.length,
    retainedEarningsAccountId,
    retainedEarningsAccountCode: retainedEarningsAcc.accountCode,
    retainedEarningsAccountName: retainedEarningsAcc.accountName,
    netIncomeTransferredCentavos: netIncome,
    closingJournalNumber: closingLines.length > 0 ? effectiveJournalNumber : null,
  };

  const canonicalPayload = JSON.stringify({
    certId,
    companyId,
    periodId: lastPeriod.id,
    fiscalYear,
    closeType: 'YEAR_END_CLOSE',
    periodsClosedIds: periods.map(p => p.id),
    trialBalanceTotals,
    financialOverview,
    closedByUserId: userId,
    closedByUserRole: actorRole,
    closedAtIso,
  });

  const sha256Hash = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

  // Execute closing JE + period locking (with version increment) + certification snapshot atomically in a SINGLE transaction
  await db.transaction(async (tx) => {
    if (closingLines.length > 0) {
      journalEntryId = crypto.randomUUID();
      await tx.insert(schema.journalEntries).values({
        id: journalEntryId,
        companyId,
        journalNumber: effectiveJournalNumber,
        entryDate: closingDate,
        accountingPeriodId: lastPeriod.id,
        description: `Year-End Closing Entry for Fiscal Year ${fiscalYear}`,
        sourceType: 'YEAR_END_CLOSE',
        sourceId: `FY-${fiscalYear}-${certId}`,
        status: 'POSTED',
        createdBy: userId,
        submittedBy: userId,
        approvedBy: userId,
        postedBy: userId,
        submittedAt: nowDate,
        approvedAt: nowDate,
        postedAt: nowDate,
      });

      let lineNum = 1;
      for (const cl of closingLines) {
        await tx.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId,
          accountId: cl.accountId,
          description: cl.description,
          debit: cl.debit,
          credit: cl.credit,
          lineNumber: lineNum++,
        });
      }
    }

    for (const period of periods) {
      const prevStatus = period.status;
      const curVer = Number(period.version || 1);
      const nextVer = curVer + 1;
      const updRes = await tx.update(schema.accountingPeriods).set({
        status: 'HARD_CLOSED',
        hardClosedAt: nowDate,
        hardClosedBy: userId,
        version: nextVer,
        updatedAt: nowDate,
      }).where(and(
        eq(schema.accountingPeriods.id, period.id),
        eq(schema.accountingPeriods.companyId, companyId),
        eq(schema.accountingPeriods.version, curVer)
      )).run();

      if (updRes.changes === 0) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Accounting period '${period.name}' was updated concurrently during Year-End Close.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
          { recordId: period.id, currentVersion: nextVer }
        );
      }

      await tx.insert(schema.periodStatusHistory).values({
        id: crypto.randomUUID(),
        companyId,
        accountingPeriodId: period.id,
        action: 'YEAR_END_CLOSE',
        previousStatus: prevStatus,
        newStatus: 'HARD_CLOSED',
        reason: `Year-End Closing for Fiscal Year ${fiscalYear}`,
        changedBy: userId,
        createdAt: nowDate,
      });
    }

    await tx.run(sql`
      INSERT INTO period_close_certifications (
        id, company_id, period_id, period_name, start_date, end_date, fiscal_year,
        close_type, validation_snapshot_id, checklist_results_json,
        financial_overview_json, trial_balance_totals_json, unresolved_exceptions_json,
        warning_justification, closing_reason, reconciliation_refs_json,
        closed_by_user_id, closed_by_user_name, closed_by_user_role,
        approved_by_user_id, approved_by_user_name, approved_by_user_role,
        closed_at, closing_policy_version, audit_event_id, sha256_hash, created_at
      ) VALUES (
        ${certId}, ${companyId}, ${lastPeriod.id}, ${lastPeriod.name},
        ${periods[0].startDate}, ${lastPeriod.endDate}, ${fiscalYear},
        'YEAR_END_CLOSE', ${null},
        ${JSON.stringify([])},
        ${JSON.stringify(financialOverview)},
        ${JSON.stringify(trialBalanceTotals)},
        ${JSON.stringify([])},
        ${null},
        ${`Year-End Closing for Fiscal Year ${fiscalYear}`},
        ${JSON.stringify({ closingJournalEntryId: journalEntryId, periodsClosedIds: periods.map(p => p.id) })},
        ${userId}, ${actorName}, ${actorRole},
        ${userId}, ${actorName}, ${actorRole},
        ${closedAtIso}, ${1}, ${auditEventId}, ${sha256Hash}, ${nowSec}
      )
    `);

    await tx.insert(schema.auditLogs).values({
      id: auditEventId,
      companyId,
      userId,
      action: 'YEAR_END_CLOSE',
      entityType: 'accounting_periods',
      entityId: `FY${fiscalYear}`,
      metadata: JSON.stringify({ fiscalYear, netIncome, journalEntryId, certificationId: certId, sha256Hash }),
    });
  });

  return {
    journalEntryId,
    fiscalYear,
    periodsClosed: periods.length,
    netIncome,
    netIncomeTransferred: netIncome,
    alreadyClosed: false,
    certificationId: certId,
    certificationSha256: sha256Hash,
  };
}

export async function voidJournalEntry(companyId: string, entryId: string, userId: string, reason: string, userRole?: string) {
  const journal = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, entryId)).get();
  if (!journal) throw new DomainError('Journal entry not found', 'NOT_FOUND', 404);
  if (journal.companyId !== companyId) throw new DomainError('Journal entry does not belong to the company', 'TENANT_SCOPE_VIOLATION', 403);
  if (journal.status === 'POSTED') throw new DomainError('Cannot void a posted journal. Please use reverse instead.');
  if (journal.status === 'VOIDED' || journal.status === 'REVERSED') throw new DomainError('Journal is already voided or reversed');

  // Enforce accounting period lock / company lock date before voiding
  await validateTransactionDateAndPeriod(companyId, journal.entryDate, { userRole });

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
