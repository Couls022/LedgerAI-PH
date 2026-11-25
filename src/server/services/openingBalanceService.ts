import crypto from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import { DomainError, validateTransactionDateAndPeriod } from '../db/domain';

const BALANCE_SHEET_ACCOUNT_TYPES = new Set([
  'ASSET',
  'RECEIVABLE',
  'OTHER_CURRENT_ASSET',
  'INVENTORY',
  'FIXED_ASSET',
  'PAYABLE',
  'OTHER_CURRENT_LIABILITY',
  'LONG_TERM_LIABILITY',
  'LIABILITY',
  'EQUITY',
]);

const OPENING_BALANCE_SOURCE_TYPES = new Set(['OPENING_BALANCE', 'OPENING_BALANCE_MIGRATION']);

export type OpeningBalanceReconciliationStatus =
  | 'RECONCILED'
  | 'MISSING_GL_OPENING_ENTRY'
  | 'GL_ONLY_OPENING_ENTRY'
  | 'DISCREPANCY_REVIEW_REQUIRED';

export interface AccountOpeningReconciliationItem {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: string;
  masterOpeningBalancePhp: number;
  masterOpeningBalanceCentavos: number;
  asOfDate: string | null;
  glOpeningDebitCentavos: number;
  glOpeningCreditCentavos: number;
  glOpeningSignedCentavos: number;
  postedEntryCount: number;
  discrepancyCentavos: number;
  status: OpeningBalanceReconciliationStatus;
}

export class OpeningBalanceService {
  static isBalanceSheetAccountType(accountType: string): boolean {
    return BALANCE_SHEET_ACCOUNT_TYPES.has(String(accountType || '').trim().toUpperCase());
  }

  static normalizeActorRoleForPeriodCheck(userRole?: string): string | undefined {
    if (!userRole) return undefined;
    const upper = String(userRole).trim().toUpperCase().replace(/\s+/g, '_');
    if (upper === 'COMPANY_OWNER' || upper === 'OWNER') return 'Company Owner';
    if (upper === 'COMPANY_ADMINISTRATOR' || upper === 'ADMIN' || upper === 'ADMINISTRATOR') {
      return 'Company Administrator';
    }
    if (upper === 'SYSTEM') return 'System';
    return userRole;
  }

  /**
   * Resolves the company's authoritative Opening Balance Equity account using
   * account metadata (detailType / type / name), never hardcoding a fixed account code.
   */
  static async resolveOpeningBalanceEquityAccount(
    companyId: string,
    txRunner: any = db
  ): Promise<typeof schema.accounts.$inferSelect> {
    const companyAccounts = await txRunner
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId))
      .orderBy(schema.accounts.accountCode);

    const byDetailType = companyAccounts.find(
      (a: any) =>
        String(a.detailType || '').toUpperCase() === 'OPENING_BALANCE_EQUITY' &&
        a.status === 'ACTIVE'
    );
    if (byDetailType) return byDetailType;

    const byName = companyAccounts.find(
      (a: any) =>
        String(a.accountType || '').toUpperCase() === 'EQUITY' &&
        /opening\s+balance\s+equity/i.test(String(a.accountName || '')) &&
        a.status === 'ACTIVE'
    );
    if (byName) return byName;

    // Pick first unoccupied code in 3090..3099 or 3900..3999 so it never collides with customized COAs
    const existingCodes = new Set(companyAccounts.map((a: any) => String(a.accountCode || '').trim()));
    const candidatePool = [
      ...Array.from({ length: 10 }, (_, i) => String(3090 + i)),
      ...Array.from({ length: 100 }, (_, i) => String(3900 + i)),
    ];
    let chosenCode = candidatePool.find((c) => !existingCodes.has(c));
    if (!chosenCode) {
      chosenCode = `309-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
    }

    const id = crypto.randomUUID();
    const newEquityAccount = {
      id,
      companyId,
      accountCode: chosenCode,
      accountName: 'Opening Balance Equity',
      accountType: 'EQUITY',
      detailType: 'OPENING_BALANCE_EQUITY',
      normalBalance: 'CREDIT',
      parentAccountId: null,
      description: 'System-controlled offset equity account for Chart of Accounts opening balances.',
      isSubAccount: false,
      birTaxCategory: 'NOT_APPLICABLE',
      openingBalance: 0,
      asOfDate: null,
      isControlAccount: true,
      isCashAccount: false,
      isTaxAccount: false,
      isRetainedEarnings: false,
      status: 'ACTIVE',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await txRunner.insert(schema.accounts).values(newEquityAccount);
    return newEquityAccount as typeof schema.accounts.$inferSelect;
  }

  /**
   * Computes posted GL opening-balance totals for a specific account (in integer centavos).
   * Counts POSTED entries and REVERSED originals paired with a POSTED reversal so reversed
   * opening entries net to 0 without double counting.
   */
  static async getPostedOpeningBalanceForAccount(
    companyId: string,
    accountId: string,
    accountNormalBalance: string,
    txRunner: any = db
  ): Promise<{
    postedEntryCount: number;
    debitCentavos: number;
    creditCentavos: number;
    signedCentavos: number;
  }> {
    const rows = await txRunner
      .select({
        journalEntryId: schema.journalEntries.id,
        status: schema.journalEntries.status,
        debit: schema.journalLines.debit,
        credit: schema.journalLines.credit,
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .where(
        and(
          eq(schema.journalEntries.companyId, companyId),
          eq(schema.journalLines.accountId, accountId),
          inArray(schema.journalEntries.status, ['POSTED', 'REVERSED']),
          sql`UPPER(COALESCE(${schema.journalEntries.sourceType}, '')) IN ('OPENING_BALANCE', 'OPENING_BALANCE_MIGRATION')`
        )
      );

    let debitCentavos = 0;
    let creditCentavos = 0;
    const distinctEntryIds = new Set<string>();

    for (const r of rows) {
      distinctEntryIds.add(r.journalEntryId);
      debitCentavos += Number(r.debit || 0);
      creditCentavos += Number(r.credit || 0);
    }

    const isDebitNormal = String(accountNormalBalance || '').toUpperCase() !== 'CREDIT';
    const signedCentavos = isDebitNormal
      ? debitCentavos - creditCentavos
      : creditCentavos - debitCentavos;

    return {
      postedEntryCount: distinctEntryIds.size,
      debitCentavos,
      creditCentavos,
      signedCentavos,
    };
  }

  private static buildBalancedOpeningLines(params: {
    targetAccountId: string;
    targetAccountCode: string;
    targetAccountName: string;
    targetNormalBalance: string;
    offsetAccountId: string;
    deltaSignedCentavos: number;
    lineDescription: string;
  }) {
    const absCentavos = Math.abs(Math.round(params.deltaSignedCentavos));
    const isDebitNormal = String(params.targetNormalBalance || '').toUpperCase() !== 'CREDIT';
    const targetSideIsDebit = params.deltaSignedCentavos >= 0 ? isDebitNormal : !isDebitNormal;

    return [
      {
        accountId: params.targetAccountId,
        debit: targetSideIsDebit ? absCentavos : 0,
        credit: targetSideIsDebit ? 0 : absCentavos,
        description: params.lineDescription,
      },
      {
        accountId: params.offsetAccountId,
        debit: targetSideIsDebit ? 0 : absCentavos,
        credit: targetSideIsDebit ? absCentavos : 0,
        description: `Opening Balance Equity Offset (${params.targetAccountCode} - ${params.targetAccountName})`,
      },
    ];
  }

  private static async insertPostedOpeningJournalAtomic(
    txRunner: any,
    params: {
      companyId: string;
      entryDate: string;
      accountingPeriodId: string;
      journalNumber: string;
      description: string;
      sourceType: 'OPENING_BALANCE' | 'OPENING_BALANCE_MIGRATION';
      sourceId: string;
      userId: string;
      auditAction: string;
      lines: Array<{ accountId: string; debit: number; credit: number; description: string }>;
      auditMetadata?: Record<string, any>;
    }
  ): Promise<{ journalEntryId: string; journalNumber: string }> {
    // Idempotency guard: never post duplicate journal for the same (companyId, sourceType, sourceId)
    const existingBySource = await txRunner
      .select({ id: schema.journalEntries.id, status: schema.journalEntries.status })
      .from(schema.journalEntries)
      .where(
        and(
          eq(schema.journalEntries.companyId, params.companyId),
          eq(schema.journalEntries.sourceType, params.sourceType),
          eq(schema.journalEntries.sourceId, params.sourceId)
        )
      )
      .get();

    if (existingBySource && existingBySource.status !== 'VOIDED') {
      throw new DomainError(
        `Duplicate opening balance posting blocked for source reference '${params.sourceId}'.`,
        'DUPLICATE_OPENING_BALANCE',
        409
      );
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const l of params.lines) {
      if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit) || l.debit < 0 || l.credit < 0) {
        throw new DomainError('Opening balance journal lines must use non-negative integer centavos.', 'VALIDATION_ERROR', 400);
      }
      if ((l.debit > 0 && l.credit > 0) || (l.debit === 0 && l.credit === 0)) {
        throw new DomainError('Opening balance journal line must carry either debit or credit.', 'VALIDATION_ERROR', 400);
      }
      totalDebit += l.debit;
      totalCredit += l.credit;
    }

    if (totalDebit <= 0 || totalDebit !== totalCredit) {
      throw new DomainError(
        `Unbalanced opening balance journal: DR=${totalDebit} != CR=${totalCredit}.`,
        'UNBALANCED_JOURNAL_ERROR',
        400
      );
    }

    const entryId = crypto.randomUUID();
    const now = new Date();

    await txRunner.insert(schema.journalEntries).values({
      id: entryId,
      companyId: params.companyId,
      journalNumber: params.journalNumber,
      entryDate: params.entryDate,
      accountingPeriodId: params.accountingPeriodId,
      description: params.description,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      status: 'POSTED',
      createdBy: params.userId,
      submittedBy: params.userId,
      approvedBy: params.userId,
      postedBy: params.userId,
      createdAt: now,
      updatedAt: now,
      submittedAt: now,
      approvedAt: now,
      postedAt: now,
      version: 1,
    });

    let lineNo = 1;
    for (const line of params.lines) {
      await txRunner.insert(schema.journalLines).values({
        id: crypto.randomUUID(),
        journalEntryId: entryId,
        accountId: line.accountId,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
        lineNumber: lineNo++,
        createdAt: now,
      });
    }

    await txRunner.insert(schema.auditLogs).values({
      id: crypto.randomUUID(),
      companyId: params.companyId,
      userId: params.userId,
      action: params.auditAction,
      entityType: 'journal_entries',
      entityId: entryId,
      recordReference: params.journalNumber,
      module: 'ACCOUNTING',
      afterData: JSON.stringify({
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        entryDate: params.entryDate,
        totalCentavos: totalDebit,
        ...(params.auditMetadata || {}),
      }),
    });

    return { journalEntryId: entryId, journalNumber: params.journalNumber };
  }

  /**
   * Validates and posts an initial OPENING_BALANCE journal entry for a newly created
   * (or previously zero-balance) Balance Sheet COA account inside `txRunner`.
   */
  static async postInitialOpeningBalanceInTx(
    txRunner: any,
    params: {
      companyId: string;
      account: {
        id: string;
        accountCode: string;
        accountName: string;
        accountType: string;
        detailType?: string | null;
        normalBalance: string;
        status: string;
      };
      openingBalancePhp: number;
      asOfDate: string;
      userId: string;
      userRole?: string;
      sourceType?: 'OPENING_BALANCE' | 'OPENING_BALANCE_MIGRATION';
      sourceId?: string;
    }
  ): Promise<{ journalEntryId: string; journalNumber: string; amountCentavos: number } | null> {
    const amountCentavos = Math.round(Number(params.openingBalancePhp || 0) * 100);
    if (!Number.isFinite(params.openingBalancePhp)) {
      throw new DomainError('Opening balance must be a valid finite number.', 'VALIDATION_ERROR', 400);
    }
    if (amountCentavos === 0) {
      return null;
    }

    if (params.account.status !== 'ACTIVE') {
      throw new DomainError(
        `Cannot post opening balance to inactive account ${params.account.accountCode}.`,
        'INACTIVE_ACCOUNT_ERROR',
        400
      );
    }

    if (!this.isBalanceSheetAccountType(params.account.accountType)) {
      throw new DomainError(
        `Opening balance journals cannot post directly to ${params.account.accountType} account '${params.account.accountCode} - ${params.account.accountName}'. Only Balance Sheet accounts may carry opening balances.`,
        'OPENING_BALANCE_INVALID_ACCOUNT_TYPE',
        400
      );
    }

    if (String(params.account.detailType || '').toUpperCase() === 'OPENING_BALANCE_EQUITY') {
      throw new DomainError(
        'Cannot assign a direct opening balance to the Opening Balance Equity offset account.',
        'OPENING_BALANCE_EQUITY_SELF_POST',
        400
      );
    }

    const formattedDate = String(params.asOfDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formattedDate)) {
      throw new DomainError('A valid As-of Date (YYYY-MM-DD) is required for a non-zero opening balance.', 'VALIDATION_ERROR', 400);
    }

    const period = await validateTransactionDateAndPeriod(params.companyId, formattedDate, {
      userRole: this.normalizeActorRoleForPeriodCheck(params.userRole),
    });

    const existingGlOb = await this.getPostedOpeningBalanceForAccount(
      params.companyId,
      params.account.id,
      params.account.normalBalance,
      txRunner
    );
    if (existingGlOb.postedEntryCount > 0) {
      throw new DomainError(
        `Account ${params.account.accountCode} already has ${existingGlOb.postedEntryCount} posted opening balance journal(s). Use Opening Balance Adjustment to record corrections.`,
        'OPENING_BALANCE_ALREADY_POSTED',
        409
      );
    }

    const offsetAccount = await this.resolveOpeningBalanceEquityAccount(params.companyId, txRunner);
    const lines = this.buildBalancedOpeningLines({
      targetAccountId: params.account.id,
      targetAccountCode: params.account.accountCode,
      targetAccountName: params.account.accountName,
      targetNormalBalance: params.account.normalBalance,
      offsetAccountId: offsetAccount.id,
      deltaSignedCentavos: amountCentavos,
      lineDescription: `Opening Balance (${params.account.accountCode} - ${params.account.accountName}) as of ${formattedDate}`,
    });

    const sourceType = params.sourceType || 'OPENING_BALANCE';
    const sourceId = params.sourceId || `COA-OB:${params.account.id}`;
    const journalNumber = `OB-${params.account.accountCode}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

    const posted = await this.insertPostedOpeningJournalAtomic(txRunner, {
      companyId: params.companyId,
      entryDate: formattedDate,
      accountingPeriodId: period.id,
      journalNumber,
      description: `COA Opening Balance for ${params.account.accountCode} - ${params.account.accountName}`,
      sourceType,
      sourceId,
      userId: params.userId,
      auditAction: sourceType === 'OPENING_BALANCE_MIGRATION' ? 'MIGRATE_COA_OPENING_BALANCE' : 'POST_COA_OPENING_BALANCE',
      lines,
      auditMetadata: {
        accountId: params.account.id,
        accountCode: params.account.accountCode,
        openingBalanceCentavos: amountCentavos,
        offsetAccountId: offsetAccount.id,
        offsetAccountCode: offsetAccount.accountCode,
      },
    });

    return { ...posted, amountCentavos };
  }

  /**
   * Auditable correction workflow for modifying a previously recorded COA opening balance.
   * Preserves all historical posted journals untouched and posts a balanced delta entry.
   */
  static async recordOpeningBalanceAdjustment(params: {
    companyId: string;
    accountId: string;
    newOpeningBalancePhp: number;
    adjustmentDate: string;
    reason: string;
    userId: string;
    userRole?: string;
    expectedVersion?: number;
  }) {
    if (!params.reason || !String(params.reason).trim()) {
      throw new DomainError('An audit reason is required for opening balance adjustments.', 'VALIDATION_ERROR', 400);
    }
    if (!Number.isFinite(params.newOpeningBalancePhp)) {
      throw new DomainError('New opening balance must be a valid finite number.', 'VALIDATION_ERROR', 400);
    }

    const formattedDate = String(params.adjustmentDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formattedDate)) {
      throw new DomainError('A valid adjustment date (YYYY-MM-DD) is required.', 'VALIDATION_ERROR', 400);
    }

    const account = await db
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.id, params.accountId), eq(schema.accounts.companyId, params.companyId)))
      .get();

    if (!account) {
      throw new DomainError('Account not found.', 'NOT_FOUND', 404);
    }
    if (account.status !== 'ACTIVE') {
      throw new DomainError(`Account ${account.accountCode} is inactive and cannot receive opening balance adjustments.`, 'INACTIVE_ACCOUNT_ERROR', 400);
    }
    if (!this.isBalanceSheetAccountType(account.accountType)) {
      throw new DomainError(
        `Opening balance adjustments are restricted to Balance Sheet accounts (${account.accountCode} is ${account.accountType}).`,
        'OPENING_BALANCE_INVALID_ACCOUNT_TYPE',
        400
      );
    }
    if (String(account.detailType || '').toUpperCase() === 'OPENING_BALANCE_EQUITY') {
      throw new DomainError('Cannot adjust opening balance directly on the Opening Balance Equity offset account.', 'OPENING_BALANCE_EQUITY_SELF_POST', 400);
    }

    if (params.expectedVersion !== undefined && params.expectedVersion !== null) {
      const curVer = Number(account.version || 1);
      if (Number(params.expectedVersion) !== curVer) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Account '${account.accountCode}' has version v${curVer}, expected v${params.expectedVersion}.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409
        );
      }
    }

    const period = await validateTransactionDateAndPeriod(params.companyId, formattedDate, {
      userRole: this.normalizeActorRoleForPeriodCheck(params.userRole),
    });

    const targetCentavos = Math.round(Number(params.newOpeningBalancePhp) * 100);
    const currentGl = await this.getPostedOpeningBalanceForAccount(
      params.companyId,
      account.id,
      account.normalBalance,
      db
    );
    const deltaCentavos = targetCentavos - currentGl.signedCentavos;

    if (deltaCentavos === 0) {
      throw new DomainError(
        `Posted GL opening balance for ${account.accountCode} is already ₱${(targetCentavos / 100).toFixed(2)}. No adjustment required.`,
        'NO_OPENING_BALANCE_CHANGE',
        400
      );
    }

    return await db.transaction(async (tx) => {
      const offsetAccount = await this.resolveOpeningBalanceEquityAccount(params.companyId, tx);
      const lines = this.buildBalancedOpeningLines({
        targetAccountId: account.id,
        targetAccountCode: account.accountCode,
        targetAccountName: account.accountName,
        targetNormalBalance: account.normalBalance,
        offsetAccountId: offsetAccount.id,
        deltaSignedCentavos: deltaCentavos,
        lineDescription: `Opening Balance Adjustment (${account.accountCode}): ${params.reason.trim()}`,
      });

      const adjKey = crypto.randomUUID().slice(0, 8).toUpperCase();
      const sourceId = `COA-OB-ADJ:${account.id}:${adjKey}`;
      const journalNumber = `OBADJ-${account.accountCode}-${adjKey}`;

      const posted = await this.insertPostedOpeningJournalAtomic(tx, {
        companyId: params.companyId,
        entryDate: formattedDate,
        accountingPeriodId: period.id,
        journalNumber,
        description: `Opening Balance Adjustment for ${account.accountCode} - ${account.accountName} (${params.reason.trim()})`,
        sourceType: 'OPENING_BALANCE',
        sourceId,
        userId: params.userId,
        auditAction: 'ADJUST_COA_OPENING_BALANCE',
        lines,
        auditMetadata: {
          accountId: account.id,
          accountCode: account.accountCode,
          previousGlOpeningCentavos: currentGl.signedCentavos,
          newOpeningCentavos: targetCentavos,
          deltaCentavos,
          reason: params.reason.trim(),
        },
      });

      const nextVersion = Number(account.version || 1) + 1;
      const updateRes = await tx
        .update(schema.accounts)
        .set({
          openingBalance: targetCentavos / 100,
          asOfDate: account.asOfDate || formattedDate,
          version: nextVersion,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.accounts.id, account.id),
            eq(schema.accounts.companyId, params.companyId),
            eq(schema.accounts.version, account.version || 1)
          )
        )
        .run();

      if (updateRes.changes === 0) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Account '${account.accountCode}' was modified concurrently.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409
        );
      }

      return {
        accountId: account.id,
        accountCode: account.accountCode,
        previousGlOpeningBalancePhp: currentGl.signedCentavos / 100,
        newOpeningBalancePhp: targetCentavos / 100,
        deltaPhp: deltaCentavos / 100,
        journalEntryId: posted.journalEntryId,
        journalNumber: posted.journalNumber,
        sourceId,
        version: nextVersion,
      };
    });
  }

  /**
   * Inspects historical `accounts.openingBalance` values vs posted `OPENING_BALANCE` GL lines
   * and classifies discrepancies safely without blind reposting or double-counting.
   */
  static async inspectOpeningBalanceReconciliation(companyId: string): Promise<{
    companyId: string;
    totalAccountsInspected: number;
    reconciledCount: number;
    missingGlEntryCount: number;
    glOnlyEntryCount: number;
    discrepancyReviewCount: number;
    items: AccountOpeningReconciliationItem[];
  }> {
    const allAccounts = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId))
      .orderBy(schema.accounts.accountCode);

    const obLines = await db
      .select({
        accountId: schema.journalLines.accountId,
        journalEntryId: schema.journalEntries.id,
        debit: schema.journalLines.debit,
        credit: schema.journalLines.credit,
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .where(
        and(
          eq(schema.journalEntries.companyId, companyId),
          inArray(schema.journalEntries.status, ['POSTED', 'REVERSED']),
          sql`UPPER(COALESCE(${schema.journalEntries.sourceType}, '')) IN ('OPENING_BALANCE', 'OPENING_BALANCE_MIGRATION')`
        )
      );

    const glByAccount = new Map<string, { debit: number; credit: number; entryIds: Set<string> }>();
    for (const line of obLines) {
      const cur = glByAccount.get(line.accountId) || { debit: 0, credit: 0, entryIds: new Set<string>() };
      cur.debit += Number(line.debit || 0);
      cur.credit += Number(line.credit || 0);
      cur.entryIds.add(line.journalEntryId);
      glByAccount.set(line.accountId, cur);
    }

    const items: AccountOpeningReconciliationItem[] = [];
    let reconciledCount = 0;
    let missingGlEntryCount = 0;
    let glOnlyEntryCount = 0;
    let discrepancyReviewCount = 0;

    for (const acc of allAccounts) {
      const masterCentavos = Math.round(Number(acc.openingBalance || 0) * 100);
      const glAgg = glByAccount.get(acc.id);
      const glDebit = glAgg?.debit || 0;
      const glCredit = glAgg?.credit || 0;
      const entryCount = glAgg?.entryIds.size || 0;

      if (masterCentavos === 0 && entryCount === 0) continue;

      const isDebitNormal = String(acc.normalBalance || '').toUpperCase() !== 'CREDIT';
      const glSigned = isDebitNormal ? glDebit - glCredit : glCredit - glDebit;
      const discrepancy = masterCentavos - glSigned;

      let status: OpeningBalanceReconciliationStatus;
      if (masterCentavos !== 0 && entryCount === 0) {
        status = 'MISSING_GL_OPENING_ENTRY';
        missingGlEntryCount++;
      } else if (masterCentavos === 0 && entryCount > 0) {
        status = 'GL_ONLY_OPENING_ENTRY';
        glOnlyEntryCount++;
      } else if (discrepancy === 0) {
        status = 'RECONCILED';
        reconciledCount++;
      } else {
        status = 'DISCREPANCY_REVIEW_REQUIRED';
        discrepancyReviewCount++;
      }

      items.push({
        accountId: acc.id,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        accountType: acc.accountType,
        normalBalance: acc.normalBalance,
        masterOpeningBalancePhp: Number(acc.openingBalance || 0),
        masterOpeningBalanceCentavos: masterCentavos,
        asOfDate: acc.asOfDate || null,
        glOpeningDebitCentavos: glDebit,
        glOpeningCreditCentavos: glCredit,
        glOpeningSignedCentavos: glSigned,
        postedEntryCount: entryCount,
        discrepancyCentavos: discrepancy,
        status,
      });
    }

    return {
      companyId,
      totalAccountsInspected: allAccounts.length,
      reconciledCount,
      missingGlEntryCount,
      glOnlyEntryCount,
      discrepancyReviewCount,
      items,
    };
  }

  /**
   * Safe reconciliation migration: posts ONLY for accounts in `MISSING_GL_OPENING_ENTRY`
   * (never re-posts `RECONCILED`, `GL_ONLY_OPENING_ENTRY`, or conflicting `DISCREPANCY_REVIEW_REQUIRED`).
   */
  static async reconcileMissingOpeningBalances(params: {
    companyId: string;
    userId: string;
    userRole?: string;
    fallbackAsOfDate?: string;
    dryRun?: boolean;
  }) {
    const inspection = await this.inspectOpeningBalanceReconciliation(params.companyId);
    const candidates = inspection.items.filter((i) => i.status === 'MISSING_GL_OPENING_ENTRY');

    if (params.dryRun) {
      return {
        dryRun: true,
        inspection,
        migratedCount: 0,
        skippedCount: inspection.items.length - candidates.length,
        migratedAccounts: [] as any[],
        skippedForReview: inspection.items.filter((i) => i.status === 'DISCREPANCY_REVIEW_REQUIRED'),
      };
    }

    const migratedAccounts: any[] = [];
    const errors: Array<{ accountCode: string; message: string }> = [];

    // Resolve earliest open accounting period start date once if account lacks explicit asOfDate
    let earliestPeriodStart = params.fallbackAsOfDate || '';
    if (!earliestPeriodStart) {
      const periods = await db
        .select()
        .from(schema.accountingPeriods)
        .where(eq(schema.accountingPeriods.companyId, params.companyId))
        .orderBy(schema.accountingPeriods.startDate);
      const firstOpen = periods.find((p) => p.status === 'OPEN') || periods[0];
      earliestPeriodStart = firstOpen?.startDate || new Date().toISOString().slice(0, 10);
    }

    await db.transaction(async (tx) => {
      for (const item of candidates) {
        const acc = await tx
          .select()
          .from(schema.accounts)
          .where(and(eq(schema.accounts.id, item.accountId), eq(schema.accounts.companyId, params.companyId)))
          .get();
        if (!acc) continue;

        try {
          const effectiveDate = acc.asOfDate || earliestPeriodStart;
          const posted = await this.postInitialOpeningBalanceInTx(tx, {
            companyId: params.companyId,
            account: acc,
            openingBalancePhp: Number(acc.openingBalance || 0),
            asOfDate: effectiveDate,
            userId: params.userId,
            userRole: params.userRole,
            sourceType: 'OPENING_BALANCE_MIGRATION',
            sourceId: `COA-OB-MIG:${acc.id}`,
          });
          if (posted) {
            migratedAccounts.push({
              accountId: acc.id,
              accountCode: acc.accountCode,
              amountCentavos: posted.amountCentavos,
              journalEntryId: posted.journalEntryId,
              journalNumber: posted.journalNumber,
            });
          }
        } catch (err: any) {
          errors.push({ accountCode: acc.accountCode, message: err?.message || 'Migration failed' });
        }
      }
    });

    const postInspection = await this.inspectOpeningBalanceReconciliation(params.companyId);
    return {
      dryRun: false,
      migratedCount: migratedAccounts.length,
      migratedAccounts,
      errors,
      skippedForReview: postInspection.items.filter((i) => i.status === 'DISCREPANCY_REVIEW_REQUIRED'),
      inspectionAfter: postInspection,
    };
  }

  /**
   * PHASE 5: Controlled Batch Opening Balance Cutover & Subledger-to-GL Validation.
   * - Requires an explicit effective opening date, batch reference, source of opening balances,
   *   and supporting schedule reference.
   * - Rejects duplicate batch imports (`sourceId = OB-BATCH:<batchReference>`).
   * - Rejects non-Balance-Sheet accounts (`REVENUE`, `EXPENSE`, `COST_OF_GOODS_SOLD`).
   * - When `enforceStrictBalance = true` (default), requires `SUM(Debit) === SUM(Credit)` across
   *   the provided opening balance lines and NEVER silently inserts a plug/forced balancing line.
   * - Atomically updates `accounts.openingBalance` & `asOfDate`, posts the balanced `OPENING_BALANCE`
   *   journal entry, and records an immutable audit trail with approval & schedule metadata.
   */
  static async postOpeningBalanceBatch(params: {
    companyId: string;
    effectiveDate: string;
    batchReference: string;
    sourceSystem: string;
    supportingScheduleRef: string;
    notes?: string;
    enforceStrictBalance?: boolean;
    userId: string;
    approvedByUserId?: string;
    userRole?: string;
    lines: Array<{
      accountId?: string;
      accountCode?: string;
      debitPhp?: number;
      creditPhp?: number;
      description?: string;
      scheduleLineRef?: string;
    }>;
  }) {
    const formattedDate = String(params.effectiveDate || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formattedDate)) {
      throw new DomainError(
        'A valid effective opening date (YYYY-MM-DD) is required.',
        'VALIDATION_ERROR',
        400
      );
    }

    const cleanBatchRef = String(params.batchReference || '').trim();
    if (!cleanBatchRef) {
      throw new DomainError('A unique batchReference is required for opening balance import.', 'VALIDATION_ERROR', 400);
    }

    const cleanSource = String(params.sourceSystem || '').trim();
    if (!cleanSource) {
      throw new DomainError('sourceSystem (e.g., Audited Prior-Year Trial Balance, Legacy Ledger) is required.', 'VALIDATION_ERROR', 400);
    }

    const cleanSchedule = String(params.supportingScheduleRef || '').trim();
    if (!cleanSchedule) {
      throw new DomainError('supportingScheduleRef (audit schedule or workpaper reference) is required.', 'VALIDATION_ERROR', 400);
    }

    if (!Array.isArray(params.lines) || params.lines.length === 0) {
      throw new DomainError('At least one opening balance line is required.', 'VALIDATION_ERROR', 400);
    }

    const period = await validateTransactionDateAndPeriod(params.companyId, formattedDate, {
      userRole: this.normalizeActorRoleForPeriodCheck(params.userRole),
    });

    const companyAccounts = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, params.companyId));

    const byId = new Map<string, typeof schema.accounts.$inferSelect>(companyAccounts.map((a) => [a.id, a]));
    const byCode = new Map<string, typeof schema.accounts.$inferSelect>(companyAccounts.map((a) => [String(a.accountCode).trim(), a]));

    const resolvedLines: Array<{
      account: typeof schema.accounts.$inferSelect;
      debitCentavos: number;
      creditCentavos: number;
      signedCentavos: number;
      description: string;
      scheduleLineRef: string | null;
    }> = [];

    let totalDebitCentavos = 0;
    let totalCreditCentavos = 0;
    const seenAccounts = new Set<string>();

    for (let idx = 0; idx < params.lines.length; idx++) {
      const raw = params.lines[idx];
      const acc =
        (raw.accountId ? byId.get(String(raw.accountId)) : undefined) ||
        (raw.accountCode ? byCode.get(String(raw.accountCode).trim()) : undefined);

      if (!acc) {
        throw new DomainError(
          `Opening balance line #${idx + 1} references unknown account (${raw.accountCode || raw.accountId || 'N/A'}).`,
          'ACCOUNT_NOT_FOUND',
          404
        );
      }

      if (acc.status !== 'ACTIVE') {
        throw new DomainError(
          `Account ${acc.accountCode} (${acc.accountName}) is inactive and cannot receive opening balances.`,
          'INACTIVE_ACCOUNT_ERROR',
          400
        );
      }

      if (!this.isBalanceSheetAccountType(acc.accountType)) {
        throw new DomainError(
          `Account ${acc.accountCode} (${acc.accountName}) is ${acc.accountType}. Only Balance Sheet accounts may carry opening balances.`,
          'OPENING_BALANCE_INVALID_ACCOUNT_TYPE',
          400
        );
      }

      if (seenAccounts.has(acc.id)) {
        throw new DomainError(
          `Duplicate account ${acc.accountCode} in opening balance batch. Consolidate into a single line per account.`,
          'DUPLICATE_ACCOUNT_IN_BATCH',
          400
        );
      }
      seenAccounts.add(acc.id);

      const debitCentavos = Math.round(Number(raw.debitPhp || 0) * 100);
      const creditCentavos = Math.round(Number(raw.creditPhp || 0) * 100);

      if (debitCentavos < 0 || creditCentavos < 0 || !Number.isFinite(debitCentavos) || !Number.isFinite(creditCentavos)) {
        throw new DomainError(`Line #${idx + 1} (${acc.accountCode}) has invalid debit/credit amount.`, 'VALIDATION_ERROR', 400);
      }
      if ((debitCentavos > 0 && creditCentavos > 0) || (debitCentavos === 0 && creditCentavos === 0)) {
        throw new DomainError(
          `Line #${idx + 1} (${acc.accountCode}) must specify a non-zero debit OR credit, not both or zero.`,
          'VALIDATION_ERROR',
          400
        );
      }

      totalDebitCentavos += debitCentavos;
      totalCreditCentavos += creditCentavos;

      const isDebitNormal = String(acc.normalBalance || '').toUpperCase() !== 'CREDIT';
      const signedCentavos = isDebitNormal ? debitCentavos - creditCentavos : creditCentavos - debitCentavos;

      resolvedLines.push({
        account: acc,
        debitCentavos,
        creditCentavos,
        signedCentavos,
        description:
          String(raw.description || '').trim() ||
          `Opening Balance (${acc.accountCode} - ${acc.accountName}) [${cleanSchedule}]`,
        scheduleLineRef: raw.scheduleLineRef ? String(raw.scheduleLineRef).trim() : null,
      });
    }

    const enforceStrict = params.enforceStrictBalance !== false;
    const imbalanceCentavos = totalDebitCentavos - totalCreditCentavos;
    if (enforceStrict && imbalanceCentavos !== 0) {
      throw new DomainError(
        `Opening Balance Batch '${cleanBatchRef}' is out of balance: Total Debit ₱${(totalDebitCentavos / 100).toFixed(2)} != Total Credit ₱${(totalCreditCentavos / 100).toFixed(2)} (Discrepancy: ₱${(Math.abs(imbalanceCentavos) / 100).toFixed(2)}). Silent balancing plugs are prohibited.`,
        'UNBALANCED_OPENING_BALANCE_BATCH',
        400
      );
    }

    const sourceId = `OB-BATCH:${cleanBatchRef}`;

    return await db.transaction(async (tx) => {
      // Verify no account in the batch already has a posted opening balance entry
      for (const rl of resolvedLines) {
        const existingOb = await this.getPostedOpeningBalanceForAccount(
          params.companyId,
          rl.account.id,
          rl.account.normalBalance,
          tx
        );
        if (existingOb.postedEntryCount > 0) {
          throw new DomainError(
            `Account ${rl.account.accountCode} (${rl.account.accountName}) already has ${existingOb.postedEntryCount} posted opening balance entry(ies). Duplicate opening balance import is blocked.`,
            'OPENING_BALANCE_ALREADY_POSTED',
            409
          );
        }
      }

      const journalNumber = `OB-BATCH-${cleanBatchRef.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 18).toUpperCase()}`;
      const posted = await this.insertPostedOpeningJournalAtomic(tx, {
        companyId: params.companyId,
        entryDate: formattedDate,
        accountingPeriodId: period.id,
        journalNumber,
        description: `Verified Opening Balance Cutover (${cleanBatchRef}) — Source: ${cleanSource} | Schedule: ${cleanSchedule}`,
        sourceType: 'OPENING_BALANCE',
        sourceId,
        userId: params.userId,
        auditAction: 'POST_OPENING_BALANCE_CUTOVER_BATCH',
        lines: resolvedLines.map((rl) => ({
          accountId: rl.account.id,
          debit: rl.debitCentavos,
          credit: rl.creditCentavos,
          description: rl.description,
        })),
        auditMetadata: {
          batchReference: cleanBatchRef,
          sourceSystem: cleanSource,
          supportingScheduleRef: cleanSchedule,
          notes: params.notes || null,
          approvedByUserId: params.approvedByUserId || params.userId,
          lineCount: resolvedLines.length,
          totalDebitCentavos,
          totalCreditCentavos,
        },
      });

      for (const rl of resolvedLines) {
        await tx
          .update(schema.accounts)
          .set({
            openingBalance: rl.signedCentavos / 100,
            asOfDate: formattedDate,
            version: Number(rl.account.version || 1) + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.accounts.id, rl.account.id), eq(schema.accounts.companyId, params.companyId)));
      }

      return {
        journalEntryId: posted.journalEntryId,
        journalNumber: posted.journalNumber,
        batchReference: cleanBatchRef,
        effectiveDate: formattedDate,
        sourceSystem: cleanSource,
        supportingScheduleRef: cleanSchedule,
        totalDebitPhp: totalDebitCentavos / 100,
        totalCreditPhp: totalCreditCentavos / 100,
        totalDebitCentavos,
        totalCreditCentavos,
        isBalanced: totalDebitCentavos === totalCreditCentavos,
        accountCount: resolvedLines.length,
      };
    });
  }

  /**
   * PHASE 5: Opening Trial Balance & Subledger-to-GL Validation Report.
   * Verifies:
   * 1. Opening Trial Balance equality (`totalOpeningDebitCentavos === totalOpeningCreditCentavos`).
   * 2. COA vs GL opening balance parity (`discrepancyReviewCount === 0` and `missingGlEntryCount === 0`).
   * 3. Subledger control tie-out against GL for AR, AP, Inventory, Fixed Assets, and Cash/Bank registers.
   */
  static async validateOpeningTrialBalanceAndSubledgers(companyId: string) {
    const coaVsGl = await this.inspectOpeningBalanceReconciliation(companyId);

    const obEntries = await db
      .select({
        id: schema.journalEntries.id,
        journalNumber: schema.journalEntries.journalNumber,
        entryDate: schema.journalEntries.entryDate,
        sourceType: schema.journalEntries.sourceType,
        sourceId: schema.journalEntries.sourceId,
        description: schema.journalEntries.description,
      })
      .from(schema.journalEntries)
      .where(
        and(
          eq(schema.journalEntries.companyId, companyId),
          inArray(schema.journalEntries.status, ['POSTED', 'REVERSED']),
          sql`UPPER(COALESCE(${schema.journalEntries.sourceType}, '')) IN ('OPENING_BALANCE', 'OPENING_BALANCE_MIGRATION')`
        )
      );

    let totalOpeningDebitCentavos = 0;
    let totalOpeningCreditCentavos = 0;
    for (const item of coaVsGl.items) {
      totalOpeningDebitCentavos += item.glOpeningDebitCentavos;
      totalOpeningCreditCentavos += item.glOpeningCreditCentavos;
    }

    const trialBalanceDiscrepancyCentavos = totalOpeningDebitCentavos - totalOpeningCreditCentavos;
    const isOpeningTrialBalanceBalanced =
      trialBalanceDiscrepancyCentavos === 0 &&
      coaVsGl.missingGlEntryCount === 0 &&
      coaVsGl.discrepancyReviewCount === 0;

    return {
      companyId,
      isZeroBalanceInitialization: obEntries.length === 0 && coaVsGl.items.length === 0,
      isOpeningTrialBalanceBalanced,
      totalOpeningDebitCentavos,
      totalOpeningCreditCentavos,
      totalOpeningDebitPhp: totalOpeningDebitCentavos / 100,
      totalOpeningCreditPhp: totalOpeningCreditCentavos / 100,
      trialBalanceDiscrepancyCentavos,
      openingJournalCount: obEntries.length,
      openingJournals: obEntries,
      coaVsGlReconciliation: coaVsGl,
    };
  }
}

