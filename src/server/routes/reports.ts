import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth, requirePermission } from "../auth";
import { eq, sql, and, gte, lte, desc } from "drizzle-orm";
import crypto from "crypto";
import { ExportService, ServerExportOptions } from "../services/exportService";
import { computeTrialBalanceIntegrityStatus, computeWorkingCapitalAndSolvency } from "../services/financialSourceOfTruth";

const router = Router();

export const ASSET_ACCOUNT_TYPES = [
  'ASSET',
  'RECEIVABLE',
  'INVENTORY',
  'OTHER_CURRENT_ASSET',
  'FIXED_ASSET'
] as const;

export const LIABILITY_ACCOUNT_TYPES = [
  'LIABILITY',
  'PAYABLE',
  'OTHER_CURRENT_LIABILITY',
  'LONG_TERM_LIABILITY'
] as const;

export const EQUITY_ACCOUNT_TYPES = ['EQUITY'] as const;
export const REVENUE_ACCOUNT_TYPES = ['REVENUE', 'OTHER_INCOME', 'INCOME'] as const;
export const EXPENSE_ACCOUNT_TYPES = ['EXPENSE', 'COST_OF_SALES', 'COGS', 'COST_OF_GOODS_SOLD', 'OTHER_EXPENSE'] as const;

export function isAssetAccountType(accountType: string): boolean {
  return (ASSET_ACCOUNT_TYPES as readonly string[]).includes(accountType);
}

export function isLiabilityAccountType(accountType: string): boolean {
  return (LIABILITY_ACCOUNT_TYPES as readonly string[]).includes(accountType);
}

export function isEquityAccountType(accountType: string): boolean {
  return (EQUITY_ACCOUNT_TYPES as readonly string[]).includes(accountType);
}

export function isRevenueAccountType(accountType: string): boolean {
  return (REVENUE_ACCOUNT_TYPES as readonly string[]).includes(accountType);
}

export function isExpenseAccountType(accountType: string): boolean {
  return (EXPENSE_ACCOUNT_TYPES as readonly string[]).includes(accountType);
}

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

export interface ResolvedReportPeriodScope {
  companyId: string;
  effectivePeriodId: string | null;
  periodName: string | null;
  periodStatus: string | null;
  fiscalYear: number | null;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
  ytdStartDate: string | null;
  mode: 'period' | 'cumulative' | 'ytd' | 'period_only';
  includeReversed: boolean;
  explicitPeriodRequested?: boolean;
}

export const OPENING_BALANCE_SOURCE_TYPES = ['OPENING_BALANCE', 'OPENING_BALANCE_MIGRATION'] as const;
export const NON_OPERATIONAL_PNL_SOURCE_TYPES = [
  'OPENING_BALANCE',
  'OPENING_BALANCE_MIGRATION',
  'YEAR_END_CLOSE',
] as const;

export function isOpeningBalanceSourceType(sourceType?: string | null): boolean {
  const norm = String(sourceType || '').trim().toUpperCase();
  return (OPENING_BALANCE_SOURCE_TYPES as readonly string[]).includes(norm);
}

export function classifyJournalEntryForPeriod(
  entry: { entryDate: string; sourceType?: string | null; createdAt?: string | Date | null },
  periodStartDate?: string | null
):
  | 'OPENING_BALANCE_JOURNAL'
  | 'PRIOR_PERIOD_TRANSACTION'
  | 'FIRST_DAY_OPERATIONAL_TRANSACTION'
  | 'BACKDATED_OPERATIONAL_TRANSACTION'
  | 'PERIOD_OPERATIONAL_TRANSACTION' {
  if (isOpeningBalanceSourceType(entry.sourceType)) {
    return 'OPENING_BALANCE_JOURNAL';
  }
  if (periodStartDate && entry.entryDate < periodStartDate) {
    return 'PRIOR_PERIOD_TRANSACTION';
  }
  const normSource = String(entry.sourceType || '').trim().toUpperCase();
  if (
    normSource === 'BACKDATED' ||
    normSource === 'PRIOR_PERIOD_ADJUSTMENT' ||
    normSource === 'BACKDATED_ADJUSTMENT'
  ) {
    return 'BACKDATED_OPERATIONAL_TRANSACTION';
  }
  if (periodStartDate && entry.entryDate === periodStartDate) {
    return 'FIRST_DAY_OPERATIONAL_TRANSACTION';
  }
  return 'PERIOD_OPERATIONAL_TRANSACTION';
}

export function isOpeningBalanceJournalSql() {
  return sql`UPPER(COALESCE(${schema.journalEntries.sourceType}, '')) IN ('OPENING_BALANCE', 'OPENING_BALANCE_MIGRATION')`;
}

export function isNotOpeningBalanceJournalSql() {
  return sql`UPPER(COALESCE(${schema.journalEntries.sourceType}, '')) NOT IN ('OPENING_BALANCE', 'OPENING_BALANCE_MIGRATION')`;
}

export function isOperationalPnlJournalSql() {
  return sql`UPPER(COALESCE(${schema.journalEntries.sourceType}, '')) NOT IN ('OPENING_BALANCE', 'OPENING_BALANCE_MIGRATION', 'YEAR_END_CLOSE')`;
}

export function isValidIsoCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export async function resolveReportPeriodScope(
  companyId: string,
  query: Record<string, any>
): Promise<ResolvedReportPeriodScope> {
  if (String(query.allowCorruptedLineage || '').toLowerCase() !== 'true') {
    await assertNoDuplicateReversalLineage(companyId);
  }
  const rawPeriodId = String(query.accountingPeriodId || query.periodId || '').trim();
  const rawStartDate = query.startDate ? String(query.startDate).trim().slice(0, 10) : null;
  const rawEndDate = query.endDate
    ? String(query.endDate).trim().slice(0, 10)
    : query.asOfDate
      ? String(query.asOfDate).trim().slice(0, 10)
      : null;

  if (rawStartDate && !isValidIsoCalendarDate(rawStartDate)) {
    const err: any = new Error(`Invalid startDate '${rawStartDate}'. Expected valid YYYY-MM-DD calendar date.`);
    err.code = 'INVALID_DATE_FORMAT';
    err.statusCode = 400;
    throw err;
  }
  if (rawEndDate && !isValidIsoCalendarDate(rawEndDate)) {
    const err: any = new Error(`Invalid endDate/asOfDate '${rawEndDate}'. Expected valid YYYY-MM-DD calendar date.`);
    err.code = 'INVALID_DATE_FORMAT';
    err.statusCode = 400;
    throw err;
  }

  const rawMode = String(query.mode || query.reportMode || '').trim().toLowerCase();
  const includeReversed =
    String(query.includeReversed || query.includeVoidedReversalPairs || '').toLowerCase() === 'true';

  let mode: 'period' | 'cumulative' | 'ytd' | 'period_only' = 'period';
  if (rawMode === 'cumulative') mode = 'cumulative';
  else if (rawMode === 'ytd') mode = 'ytd';
  else if (rawMode === 'period_only') mode = 'period_only';

  if (rawPeriodId) {
    const period = await db
      .select()
      .from(schema.accountingPeriods)
      .where(eq(schema.accountingPeriods.id, rawPeriodId))
      .get();

    if (!period || period.companyId !== companyId) {
      const err: any = new Error(
        `Specified accounting period '${rawPeriodId}' does not exist or does not belong to the active company.`
      );
      err.code = 'INVALID_ACCOUNTING_PERIOD';
      err.statusCode = 400;
      throw err;
    }

    if (rawStartDate && rawStartDate < period.startDate) {
      const err: any = new Error(
        `Requested startDate (${rawStartDate}) precedes the start date (${period.startDate}) of accounting period '${period.name}'.`
      );
      err.code = 'PERIOD_DATE_MISMATCH';
      err.statusCode = 400;
      throw err;
    }

    if (rawEndDate && rawEndDate > period.endDate) {
      const err: any = new Error(
        `Requested endDate (${rawEndDate}) exceeds the end date (${period.endDate}) of accounting period '${period.name}'.`
      );
      err.code = 'PERIOD_DATE_MISMATCH';
      err.statusCode = 400;
      throw err;
    }

    if (rawStartDate && rawEndDate && rawStartDate > rawEndDate) {
      const err: any = new Error(
        `Invalid date range: startDate (${rawStartDate}) cannot be after endDate (${rawEndDate}).`
      );
      err.code = 'INVALID_DATE_RANGE';
      err.statusCode = 400;
      throw err;
    }

    const effectiveStartDate = rawStartDate || period.startDate;
    const effectiveEndDate = rawEndDate || period.endDate;
    const fy = period.fiscalYear || Number(effectiveEndDate.slice(0, 4)) || 2026;

    return {
      companyId,
      effectivePeriodId: period.id,
      periodName: period.name,
      periodStatus: period.status,
      fiscalYear: fy,
      effectiveStartDate,
      effectiveEndDate,
      ytdStartDate: `${fy}-01-01`,
      mode,
      includeReversed,
      explicitPeriodRequested: true,
    };
  }

  if (rawStartDate && rawEndDate && rawStartDate > rawEndDate) {
    const err: any = new Error(`Invalid date range: startDate (${rawStartDate}) cannot be after endDate (${rawEndDate}).`);
    err.code = 'INVALID_DATE_RANGE';
    err.statusCode = 400;
    throw err;
  }

  let matchedPeriod: any = null;
  if (rawStartDate && rawEndDate) {
    const periods = await db
      .select()
      .from(schema.accountingPeriods)
      .where(eq(schema.accountingPeriods.companyId, companyId));
    matchedPeriod =
      periods.find((p) => p.startDate === rawStartDate && p.endDate === rawEndDate) || null;
  }

  const fy =
    matchedPeriod?.fiscalYear ||
    (rawEndDate ? Number(rawEndDate.slice(0, 4)) : rawStartDate ? Number(rawStartDate.slice(0, 4)) : null);

  return {
    companyId,
    effectivePeriodId: matchedPeriod?.id || null,
    periodName: matchedPeriod?.name || null,
    periodStatus: matchedPeriod?.status || null,
    fiscalYear: fy,
    effectiveStartDate: rawStartDate,
    effectiveEndDate: rawEndDate,
    ytdStartDate: fy ? `${fy}-01-01` : null,
    mode,
    includeReversed,
    explicitPeriodRequested: false,
  };
}

/**
 * Validates that no original journal entry in the company has multiple POSTED reversal children.
 * If raw SQL injection or corruption created duplicate POSTED reversals, this throws an explicit
 * error instead of silently deduplicating via LIMIT 1 and producing potentially misleading figures.
 */
export async function assertNoDuplicateReversalLineage(companyId: string): Promise<void> {
  const duplicateReversals = await db
    .select({
      originalJournalId: schema.journalEntries.originalJournalId,
      reversalCount: sql<number>`count(*)`,
      reversalIds: sql<string>`group_concat(${schema.journalEntries.id})`,
      reversalNumbers: sql<string>`group_concat(${schema.journalEntries.journalNumber})`,
    })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        sql`${schema.journalEntries.originalJournalId} IS NOT NULL`,
        eq(schema.journalEntries.status, 'POSTED')
      )
    )
    .groupBy(schema.journalEntries.originalJournalId)
    .having(sql`count(*) > 1`);

  if (duplicateReversals && duplicateReversals.length > 0) {
    const firstDup = duplicateReversals[0];
    const origId = String(firstDup.originalJournalId || '');
    const count = Number(firstDup.reversalCount || 0);
    const conflictingReversalIds = String(firstDup.reversalIds || '').split(',').filter(Boolean);
    const conflictingReversalNumbers = String(firstDup.reversalNumbers || '').split(',').filter(Boolean);

    const origEntry = await db
      .select()
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.id, origId))
      .get();

    try {
      await db.insert(schema.auditLogs).values({
        id: `aud-rev-lineage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        companyId,
        userId: null,
        userDisplayName: 'SYSTEM_REPORT_GUARD',
        action: 'REVERSAL_LINEAGE_CORRUPTION_DETECTED',
        entityType: 'journal_entries',
        entityId: origId,
        source: 'SYSTEM',
        severity: 'CRITICAL',
        result: 'FAILED',
        afterData: JSON.stringify({
          originalJournalId: origId,
          originalJournalNumber: origEntry?.journalNumber || null,
          conflictingCount: count,
          conflictingReversalIds,
          conflictingReversalNumbers,
        }),
        metadata: JSON.stringify({
          originalJournalId: origId,
          originalJournalNumber: origEntry?.journalNumber || null,
          conflictingCount: count,
          conflictingReversalIds,
          conflictingReversalNumbers,
        }),
      });
    } catch (_) {}

    const err: any = new Error(
      `CRITICAL_REVERSAL_LINEAGE_CORRUPTION: Detected ${count} conflicting POSTED reversal children (${conflictingReversalNumbers.join(', ')}) for original journal '${origEntry?.journalNumber || origId}'. Financial report generation aborted to prevent misleading figures. Run Financial Integrity Audit.`
    );
    err.code = 'REVERSAL_LINEAGE_CORRUPTION';
    err.statusCode = 409;
    err.details = {
      originalJournalId: origId,
      originalJournalNumber: origEntry?.journalNumber || null,
      conflictingCount: count,
      conflictingReversalIds,
      conflictingReversalNumbers,
    };
    throw err;
  }
}

/**
 * Canonical effective-posting predicate with adversarial reversal & balance hardening:
 * 1. Requires the journal entry to belong to `companyId` and be balanced (`SUM(debit) == SUM(credit) > 0`).
 * 2. Includes normal `'POSTED'` journal entries.
 * 3. If a `'POSTED'` journal entry is a reversal (`original_journal_id IS NOT NULL` or `source_type IN ('REVERSAL', 'JOURNAL_REVERSAL')`
 *    or `journal_number LIKE '%-REV'` / `'REV-%'`):
 *    - Requires `original_journal_id IS NOT NULL` pointing to an existing `orig_je` in the SAME `company_id`.
 *    - Requires `orig_je.status IN ('POSTED', 'REVERSED')` (rejects reversals pointing to DRAFT, SUBMITTED, APPROVED, REJECTED, VOIDED).
 *    - Requires `orig_je` to NOT itself be a reversal entry (prevents reversal-of-reversal chains from distorting reports).
 *    - Requires the reversal entry's total debit/credit magnitude to match `orig_je`'s balanced total debit/credit.
 *    - Deduplicates multiple posted reversal children for the same `original_journal_id` by only admitting the canonical first
 *      posted reversal child (`ORDER BY created_at ASC, id ASC LIMIT 1`), preventing N-times over-reversal if raw SQL bypasses domain checks.
 * 4. Includes `'REVERSED'` original journal entries ONLY when they have an active, valid, balanced `'POSTED'` reversal child
 *    in the same company (so Original + Reversal pairs net to 0 in the same period and carry across periods accurately).
 *    If BOTH original and reversal are `'REVERSED'` (no active `'POSTED'` reversal child), both are excluded from effective posted figures.
 * 5. Strictly excludes `'DRAFT'`, `'SUBMITTED'`, `'UNDER_REVIEW'`, `'APPROVED'`, `'REJECTED'`, `'RETURNED'`, and `'VOIDED'`.
 */
export function buildEffectivePostedJournalPredicate(companyId: string, includeReversed = false) {
  const balancedEntryCheck = sql`EXISTS (
    SELECT 1 FROM journal_lines jl_bal
    WHERE jl_bal.journal_entry_id = ${schema.journalEntries.id}
    GROUP BY jl_bal.journal_entry_id
    HAVING COALESCE(SUM(jl_bal.debit), 0) > 0
       AND COALESCE(SUM(jl_bal.debit), 0) = COALESCE(SUM(jl_bal.credit), 0)
  )`;

  if (includeReversed) {
    return and(
      eq(schema.journalEntries.companyId, companyId),
      sql`${schema.journalEntries.status} IN ('POSTED', 'REVERSED')`,
      balancedEntryCheck
    );
  }

  return and(
    eq(schema.journalEntries.companyId, companyId),
    balancedEntryCheck,
    sql`(
      (
        ${schema.journalEntries.status} = 'POSTED'
        AND (
          (
            ${schema.journalEntries.originalJournalId} IS NULL
            AND UPPER(COALESCE(${schema.journalEntries.sourceType}, '')) NOT IN ('REVERSAL', 'JOURNAL_REVERSAL')
          )
          OR (
            ${schema.journalEntries.originalJournalId} IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM journal_entries orig_je
              WHERE orig_je.id = ${schema.journalEntries.originalJournalId}
                AND orig_je.company_id = ${schema.journalEntries.companyId}
                AND orig_je.status IN ('POSTED', 'REVERSED')
                AND orig_je.original_journal_id IS NULL
                AND UPPER(COALESCE(orig_je.source_type, '')) NOT IN ('REVERSAL', 'JOURNAL_REVERSAL')
                AND (
                  SELECT COALESCE(SUM(jl_o.debit), 0)
                  FROM journal_lines jl_o
                  WHERE jl_o.journal_entry_id = orig_je.id
                ) = (
                  SELECT COALESCE(SUM(jl_r.credit), 0)
                  FROM journal_lines jl_r
                  WHERE jl_r.journal_entry_id = ${schema.journalEntries.id}
                )
                AND (
                  SELECT COALESCE(SUM(jl_o2.credit), 0)
                  FROM journal_lines jl_o2
                  WHERE jl_o2.journal_entry_id = orig_je.id
                ) = (
                  SELECT COALESCE(SUM(jl_r2.debit), 0)
                  FROM journal_lines jl_r2
                  WHERE jl_r2.journal_entry_id = ${schema.journalEntries.id}
                )
            )
            AND ${schema.journalEntries.id} = (
              SELECT rev_first.id FROM journal_entries rev_first
              WHERE rev_first.company_id = ${schema.journalEntries.companyId}
                AND rev_first.original_journal_id = ${schema.journalEntries.originalJournalId}
                AND rev_first.status = 'POSTED'
                AND EXISTS (
                  SELECT 1 FROM journal_lines jl_rf
                  WHERE jl_rf.journal_entry_id = rev_first.id
                  GROUP BY jl_rf.journal_entry_id
                  HAVING COALESCE(SUM(jl_rf.debit), 0) > 0
                     AND COALESCE(SUM(jl_rf.debit), 0) = COALESCE(SUM(jl_rf.credit), 0)
                )
              ORDER BY rev_first.created_at ASC, rev_first.id ASC
              LIMIT 1
            )
          )
        )
      )
      OR (
        ${schema.journalEntries.status} = 'REVERSED'
        AND ${schema.journalEntries.originalJournalId} IS NULL
        AND UPPER(COALESCE(${schema.journalEntries.sourceType}, '')) NOT IN ('REVERSAL', 'JOURNAL_REVERSAL')
        AND EXISTS (
          SELECT 1 FROM journal_entries rev_je
          WHERE rev_je.company_id = ${schema.journalEntries.companyId}
            AND rev_je.original_journal_id = ${schema.journalEntries.id}
            AND rev_je.status = 'POSTED'
            AND EXISTS (
              SELECT 1 FROM journal_lines jl_rev
              WHERE jl_rev.journal_entry_id = rev_je.id
              GROUP BY jl_rev.journal_entry_id
              HAVING COALESCE(SUM(jl_rev.debit), 0) > 0
                 AND COALESCE(SUM(jl_rev.debit), 0) = COALESCE(SUM(jl_rev.credit), 0)
            )
            AND (
              SELECT COALESCE(SUM(jl_o3.debit), 0)
              FROM journal_lines jl_o3
              WHERE jl_o3.journal_entry_id = ${schema.journalEntries.id}
            ) = (
              SELECT COALESCE(SUM(jl_r3.credit), 0)
              FROM journal_lines jl_r3
              WHERE jl_r3.journal_entry_id = rev_je.id
            )
        )
      )
    )`
  );
}

/**
 * Builds the canonical period/date filter for journal_entries, preventing records
 * assigned to another accounting_period_id from silently leaking into a period-specific report.
 */
export function buildPeriodScopedJournalFilter(
  scope: ResolvedReportPeriodScope,
  options?: {
    asOfEndDateOnly?: boolean;
    priorToStartDateOnly?: boolean;
    excludeOpeningBalanceJournals?: boolean;
    onlyOpeningBalanceJournals?: boolean;
    operationalPnlOnly?: boolean;
  }
) {
  const basePredicate = buildEffectivePostedJournalPredicate(scope.companyId, scope.includeReversed);
  const sourceTypeFilter = options?.operationalPnlOnly
    ? isOperationalPnlJournalSql()
    : options?.excludeOpeningBalanceJournals
      ? isNotOpeningBalanceJournalSql()
      : options?.onlyOpeningBalanceJournals
        ? isOpeningBalanceJournalSql()
        : undefined;

  if (options?.priorToStartDateOnly) {
    if (!scope.effectiveStartDate) {
      return and(basePredicate, sql`1 = 0`);
    }
    return and(
      basePredicate,
      sourceTypeFilter,
      sql`${schema.journalEntries.entryDate} < ${scope.effectiveStartDate}`,
      scope.effectivePeriodId
        ? sql`(${schema.journalEntries.accountingPeriodId} IS NULL OR ${schema.journalEntries.accountingPeriodId} != ${scope.effectivePeriodId})`
        : undefined,
      sql`NOT EXISTS (
        SELECT 1 FROM accounting_periods ap_Check
        WHERE ap_Check.id = ${schema.journalEntries.accountingPeriodId}
          AND ap_Check.company_id = ${scope.companyId}
          AND ap_Check.start_date >= ${scope.effectiveStartDate}
      )`
    );
  }

  if (options?.asOfEndDateOnly || scope.mode === 'cumulative') {
    return and(
      basePredicate,
      sourceTypeFilter,
      scope.effectiveEndDate ? lte(schema.journalEntries.entryDate, scope.effectiveEndDate) : undefined,
      scope.effectiveEndDate
        ? sql`NOT EXISTS (
            SELECT 1 FROM accounting_periods ap_Check
            WHERE ap_Check.id = ${schema.journalEntries.accountingPeriodId}
              AND ap_Check.company_id = ${scope.companyId}
              AND ap_Check.start_date > ${scope.effectiveEndDate}
          )`
        : undefined
    );
  }

  if (scope.mode === 'ytd') {
    const startBound = scope.ytdStartDate || scope.effectiveStartDate;
    return and(
      basePredicate,
      sourceTypeFilter,
      startBound ? gte(schema.journalEntries.entryDate, startBound) : undefined,
      scope.effectiveEndDate ? lte(schema.journalEntries.entryDate, scope.effectiveEndDate) : undefined,
      scope.effectiveEndDate
        ? sql`NOT EXISTS (
            SELECT 1 FROM accounting_periods ap_Check
            WHERE ap_Check.id = ${schema.journalEntries.accountingPeriodId}
              AND ap_Check.company_id = ${scope.companyId}
              AND (
                ap_Check.start_date > ${scope.effectiveEndDate}
                ${startBound ? sql`OR ap_Check.end_date < ${startBound}` : sql``}
              )
          )`
        : undefined
    );
  }

  // Default: strict period-scoped filter ('period' or 'period_only')
  const enforceExactPeriodId = Boolean(
    scope.effectivePeriodId &&
    (scope.explicitPeriodRequested !== false || (!scope.effectiveStartDate && !scope.effectiveEndDate))
  );
  return and(
    basePredicate,
    sourceTypeFilter,
    enforceExactPeriodId && scope.effectivePeriodId
      ? (scope.effectiveStartDate && scope.effectiveEndDate
          ? sql`(
              ${schema.journalEntries.accountingPeriodId} = ${scope.effectivePeriodId}
              OR EXISTS (
                SELECT 1 FROM accounting_periods ap_inc
                WHERE ap_inc.id = ${schema.journalEntries.accountingPeriodId}
                  AND ap_inc.company_id = ${scope.companyId}
                  AND ap_inc.start_date >= ${scope.effectiveStartDate}
                  AND ap_inc.end_date <= ${scope.effectiveEndDate}
              )
            )`
          : eq(schema.journalEntries.accountingPeriodId, scope.effectivePeriodId))
      : undefined,
    scope.effectiveStartDate ? gte(schema.journalEntries.entryDate, scope.effectiveStartDate) : undefined,
    scope.effectiveEndDate ? lte(schema.journalEntries.entryDate, scope.effectiveEndDate) : undefined,
    !enforceExactPeriodId && (scope.effectiveStartDate || scope.effectiveEndDate)
      ? sql`NOT EXISTS (
          SELECT 1 FROM accounting_periods ap_Check
          WHERE ap_Check.id = ${schema.journalEntries.accountingPeriodId}
            AND ap_Check.company_id = ${scope.companyId}
            AND (
              ${scope.effectiveEndDate ? sql`ap_Check.start_date > ${scope.effectiveEndDate}` : sql`0`}
              OR
              ${scope.effectiveStartDate ? sql`ap_Check.end_date < ${scope.effectiveStartDate}` : sql`0`}
            )
        )`
      : undefined
  );
}

// Executive Summary Metrics Route
router.get('/summary', requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const scope = await resolveReportPeriodScope(companyId, req.query);

    // P&L uses operational period-scoped filter (excluding OPENING_BALANCE and YEAR_END_CLOSE);
    // Balance Sheet uses cumulative as-of effectiveEndDate
    const pnlData = await db.select({
      accountType: schema.accounts.accountType,
      debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(buildPeriodScopedJournalFilter(scope, { operationalPnlOnly: true }))
    .groupBy(schema.accounts.accountType);

    const bsData = await db.select({
      accountType: schema.accounts.accountType,
      debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(buildPeriodScopedJournalFilter(scope, { asOfEndDateOnly: scope.mode !== 'period_only' }))
    .groupBy(schema.accounts.accountType);

    let totalRevenue = 0;
    let totalExpense = 0;
    for (const row of pnlData) {
      const creditMinusDebit = Number(row.creditTotal || 0) - Number(row.debitTotal || 0);
      const debitMinusCredit = Number(row.debitTotal || 0) - Number(row.creditTotal || 0);
      if (isRevenueAccountType(row.accountType)) {
        totalRevenue += creditMinusDebit;
      } else if (isExpenseAccountType(row.accountType)) {
        totalExpense += debitMinusCredit;
      }
    }

    let totalAssets = 0;
    let currentAssets = 0;
    let totalLiabilities = 0;
    let currentLiabilities = 0;
    let totalEquity = 0;
    let cumulativeRevenue = 0;
    let cumulativeExpense = 0;
    let tbTotalDebits = 0;
    let tbTotalCredits = 0;

    for (const row of bsData) {
      const deb = Number(row.debitTotal || 0);
      const cred = Number(row.creditTotal || 0);
      tbTotalDebits += deb;
      tbTotalCredits += cred;
      const creditMinusDebit = cred - deb;
      const debitMinusCredit = deb - cred;
      if (isAssetAccountType(row.accountType)) {
        totalAssets += debitMinusCredit;
        if (row.accountType !== 'FIXED_ASSET') {
          currentAssets += debitMinusCredit;
        }
      } else if (isLiabilityAccountType(row.accountType)) {
        totalLiabilities += creditMinusDebit;
        if (row.accountType !== 'LONG_TERM_LIABILITY') {
          currentLiabilities += creditMinusDebit;
        }
      } else if (isEquityAccountType(row.accountType)) {
        totalEquity += creditMinusDebit;
      } else if (isRevenueAccountType(row.accountType)) {
        cumulativeRevenue += creditMinusDebit;
      } else if (isExpenseAccountType(row.accountType)) {
        cumulativeExpense += debitMinusCredit;
      }
    }

    const postedCountsRow = await db.select({
      lineCount: sql<number>`count(${schema.journalLines.id})`,
      entryCount: sql<number>`count(distinct ${schema.journalEntries.id})`,
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .where(buildPeriodScopedJournalFilter(scope, { asOfEndDateOnly: scope.mode !== 'period_only' }))
      .get();

    const unpostedCountRow = await db.select({
      count: sql<number>`count(*)`,
    })
      .from(schema.journalEntries)
      .where(and(
        eq(schema.journalEntries.companyId, companyId),
        sql`${schema.journalEntries.status} IN ('DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED', 'PENDING')`
      ))
      .get();

    const auditCountRow = await db.select({
      count: sql<number>`count(*)`,
    })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.companyId, companyId))
      .get();

    const netIncome = totalRevenue - totalExpense;
    const cumulativeNetIncome = cumulativeRevenue - cumulativeExpense;
    totalEquity += cumulativeNetIncome;
    const hasPnlRecords = totalRevenue !== 0 || totalExpense !== 0;
    const netProfitMargin = totalRevenue > 0 ? Math.round((netIncome / totalRevenue) * 1000) / 10 : null;

    const tbIntegrity = computeTrialBalanceIntegrityStatus({
      totalDebitsCentavos: tbTotalDebits,
      totalCreditsCentavos: tbTotalCredits,
      postedJournalLineCount: Number(postedCountsRow?.lineCount || 0),
    });

    const solvency = computeWorkingCapitalAndSolvency({
      currentAssetsCentavos: currentAssets,
      currentLiabilitiesCentavos: currentLiabilities,
      totalAssetsCentavos: totalAssets,
      totalLiabilitiesCentavos: totalLiabilities,
      totalEquityCentavos: totalEquity,
      hasPostedBalances: Number(postedCountsRow?.lineCount || 0) > 0,
    });

    const postedJournalCount = Number(postedCountsRow?.entryCount || 0);
    const unpostedJournalCount = Number(unpostedCountRow?.count || 0);
    const auditVerifiedCount = Number(auditCountRow?.count || 0);
    const generatedAt = new Date().toISOString();

    res.json({
      totalRevenue,
      totalExpense,
      netIncome,
      cumulativeNetIncome,
      netProfitMargin,
      hasPnlRecords,
      totalAssets,
      currentAssets: solvency.currentAssetsCentavos,
      totalLiabilities,
      currentLiabilities: solvency.currentLiabilitiesCentavos,
      totalEquity,
      workingCapital: solvency.workingCapitalCentavos,
      currentRatio: solvency.currentRatio,
      debtToEquityRatio: solvency.debtToEquityRatio,
      solvencyStatus: solvency.status,
      solvencyExplanation: solvency.explanation,
      tbTotalDebits,
      tbTotalCredits,
      tbImbalance: tbIntegrity.varianceCentavos,
      tbBalanced: tbIntegrity.balanced,
      tbIntegrityStatus: tbIntegrity.status,
      tbIntegrityLabel: tbIntegrity.label,
      tbIntegrityExplanation: tbIntegrity.explanation,
      postedJournalCount,
      postedJournalLineCount: tbIntegrity.postedJournalLineCount,
      unpostedJournalCount,
      auditVerifiedCount,
      accountingPeriodId: scope.effectivePeriodId,
      startDate: scope.effectiveStartDate,
      endDate: scope.effectiveEndDate,
      balanced: tbIntegrity.balanced && totalAssets === (totalLiabilities + totalEquity),
      dataStatus: tbIntegrity.status === 'NO_RECORDS' ? 'NO_RECORDS' : tbIntegrity.balanced ? 'OK' : 'IMBALANCED',
      generatedAt,
    });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    console.error('Error fetching report summary:', err);
    res.status(500).json({ error: 'FAILED_TO_LOAD_SUMMARY' });
  }
});

// 1. Trial Balance
router.get('/trial-balance', requireAuth, requirePermission('reports:view', 'accounting:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { departmentId, projectId } = req.query;
    const scope = await resolveReportPeriodScope(companyId, req.query);

    // 1. Operational period movements (excludes explicit OPENING_BALANCE journals so opening balances are never double-counted in periodDebit/periodCredit)
    const operationalPeriodRows = await db.select({
      accountId: schema.accounts.id,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      accountType: schema.accounts.accountType,
      normalBalance: schema.accounts.normalBalance,
      debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        buildPeriodScopedJournalFilter(scope, {
          excludeOpeningBalanceJournals: scope.mode !== 'cumulative',
        }),
        departmentId ? eq(schema.journalLines.departmentId, departmentId as string) : undefined,
        projectId ? eq(schema.journalLines.projectId, projectId as string) : undefined
      )
    )
    .groupBy(schema.accounts.id);

    // 2. Explicit Opening Balance journals posted within the current period (e.g., 2026-01-01 sourceType='OPENING_BALANCE')
    const inPeriodOpeningRows =
      scope.mode !== 'cumulative'
        ? await db.select({
            accountId: schema.accounts.id,
            accountCode: schema.accounts.accountCode,
            accountName: schema.accounts.accountName,
            accountType: schema.accounts.accountType,
            normalBalance: schema.accounts.normalBalance,
            debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
            creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
          })
          .from(schema.journalLines)
          .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
          .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
          .where(
            and(
              buildPeriodScopedJournalFilter(scope, { onlyOpeningBalanceJournals: true }),
              departmentId ? eq(schema.journalLines.departmentId, departmentId as string) : undefined,
              projectId ? eq(schema.journalLines.projectId, projectId as string) : undefined
            )
          )
          .groupBy(schema.accounts.id)
        : [];

    // 3. Prior-period Brought-Forward balances prior to effectiveStartDate (e.g., Jan closing carried to Feb opening)
    const broughtForwardRows =
      scope.effectiveStartDate && scope.mode !== 'cumulative' && scope.mode !== 'period_only'
        ? await db.select({
            accountId: schema.accounts.id,
            accountCode: schema.accounts.accountCode,
            accountName: schema.accounts.accountName,
            accountType: schema.accounts.accountType,
            normalBalance: schema.accounts.normalBalance,
            debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
            creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
          })
          .from(schema.journalLines)
          .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
          .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
          .where(
            and(
              buildPeriodScopedJournalFilter(scope, { priorToStartDateOnly: true }),
              departmentId ? eq(schema.journalLines.departmentId, departmentId as string) : undefined,
              projectId ? eq(schema.journalLines.projectId, projectId as string) : undefined
            )
          )
          .groupBy(schema.accounts.id)
        : [];

    type AccountMeta = {
      accountId: string;
      accountCode: string;
      accountName: string;
      accountType: string;
      normalBalance: string | null;
    };
    const accountMetaMap = new Map<string, AccountMeta>();
    const opMap = new Map<string, { debit: number; credit: number }>();
    const openJournalMap = new Map<string, { debit: number; credit: number }>();
    const bfMap = new Map<string, { debit: number; credit: number }>();

    for (const r of operationalPeriodRows) {
      accountMetaMap.set(r.accountId, {
        accountId: r.accountId,
        accountCode: r.accountCode,
        accountName: r.accountName,
        accountType: r.accountType,
        normalBalance: r.normalBalance,
      });
      opMap.set(r.accountId, {
        debit: Number(r.debitTotal || 0),
        credit: Number(r.creditTotal || 0),
      });
    }

    for (const r of inPeriodOpeningRows) {
      if (!accountMetaMap.has(r.accountId)) {
        accountMetaMap.set(r.accountId, {
          accountId: r.accountId,
          accountCode: r.accountCode,
          accountName: r.accountName,
          accountType: r.accountType,
          normalBalance: r.normalBalance,
        });
      }
      openJournalMap.set(r.accountId, {
        debit: Number(r.debitTotal || 0),
        credit: Number(r.creditTotal || 0),
      });
    }

    for (const r of broughtForwardRows) {
      if (!accountMetaMap.has(r.accountId)) {
        accountMetaMap.set(r.accountId, {
          accountId: r.accountId,
          accountCode: r.accountCode,
          accountName: r.accountName,
          accountType: r.accountType,
          normalBalance: r.normalBalance,
        });
      }
      bfMap.set(r.accountId, {
        debit: Number(r.debitTotal || 0),
        credit: Number(r.creditTotal || 0),
      });
    }

    const includeZeroBalances = String(req.query.includeZeroBalances || '').toLowerCase() === 'true';
    if (includeZeroBalances) {
      const allActiveAccounts = await db.select({
        accountId: schema.accounts.id,
        accountCode: schema.accounts.accountCode,
        accountName: schema.accounts.accountName,
        accountType: schema.accounts.accountType,
        normalBalance: schema.accounts.normalBalance,
      })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.companyId, companyId),
          eq(schema.accounts.status, 'ACTIVE')
        )
      );

      for (const acc of allActiveAccounts) {
        if (!accountMetaMap.has(acc.accountId)) {
          accountMetaMap.set(acc.accountId, acc);
        }
      }
    }

    const sortedAccounts = Array.from(accountMetaMap.values()).sort((a, b) =>
      a.accountCode.localeCompare(b.accountCode)
    );

    const enriched = sortedAccounts.map((meta) => {
      const op = opMap.get(meta.accountId) || { debit: 0, credit: 0 };
      const oj = openJournalMap.get(meta.accountId) || { debit: 0, credit: 0 };
      const bf = bfMap.get(meta.accountId) || { debit: 0, credit: 0 };

      const openingDebit = bf.debit + oj.debit;
      const openingCredit = bf.credit + oj.credit;
      const periodDebit = op.debit;
      const periodCredit = op.credit;

      // In-period total debit/credit (includes both opening journal posted in the period and operational period movement)
      const inPeriodTotalDebit = oj.debit + op.debit;
      const inPeriodTotalCredit = oj.credit + op.credit;

      const isDebitNormal =
        meta.normalBalance === 'DEBIT' ||
        isAssetAccountType(meta.accountType) ||
        isExpenseAccountType(meta.accountType);

      const broughtForwardNetBalance = isDebitNormal ? bf.debit - bf.credit : bf.credit - bf.debit;
      const openingJournalNetBalance = isDebitNormal ? oj.debit - oj.credit : oj.credit - oj.debit;
      const openingNetBalance = isDebitNormal
        ? openingDebit - openingCredit
        : openingCredit - openingDebit;
      const periodNetMovement = isDebitNormal
        ? periodDebit - periodCredit
        : periodCredit - periodDebit;
      const closingDebit = openingDebit + periodDebit;
      const closingCredit = openingCredit + periodCredit;
      const closingNetBalance = openingNetBalance + periodNetMovement;

      return {
        ...meta,
        debitTotal: inPeriodTotalDebit,
        creditTotal: inPeriodTotalCredit,
        broughtForwardDebit: bf.debit,
        broughtForwardCredit: bf.credit,
        broughtForwardNetBalance,
        openingJournalDebit: oj.debit,
        openingJournalCredit: oj.credit,
        openingJournalNetBalance,
        openingDebit,
        openingCredit,
        openingNetBalance,
        periodDebit,
        periodCredit,
        periodNetMovement,
        closingDebit,
        closingCredit,
        closingNetBalance,
        accountingPeriodId: scope.effectivePeriodId,
        startDate: scope.effectiveStartDate,
        endDate: scope.effectiveEndDate,
      };
    });

    res.json(enriched);
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: 'FAILED_TO_LOAD_TRIAL_BALANCE', message: err?.message });
  }
});

// 2. General Ledger
router.get('/general-ledger', requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const { accountId, departmentId, projectId } = req.query;
    const scope = await resolveReportPeriodScope(companyId, req.query);

    const reqLimit = req.query.limit !== undefined ? Math.max(1, Math.min(5000, Number(req.query.limit) || 100)) : null;
    const reqOffset = req.query.offset !== undefined ? Math.max(0, Number(req.query.offset) || 0) : 0;

    const whereClause = and(
      buildPeriodScopedJournalFilter(scope),
      accountId ? eq(schema.accounts.id, accountId as string) : undefined,
      departmentId ? eq(schema.journalLines.departmentId, departmentId as string) : undefined,
      projectId ? eq(schema.journalLines.projectId, projectId as string) : undefined
    );

    let totalMatchesCount: number | null = null;
    if (reqLimit !== null) {
      const [cntRow] = await db.select({ total: sql<number>`count(*)` })
        .from(schema.journalLines)
        .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
        .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
        .where(whereClause);
      totalMatchesCount = Number(cntRow?.total || 0);
    }

    const baseGlQuery = db.select({
      accountId: schema.accounts.id,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      accountType: schema.accounts.accountType,
      normalBalance: schema.accounts.normalBalance,
      journalId: schema.journalEntries.id,
      journalNumber: schema.journalEntries.journalNumber,
      entryDate: schema.journalEntries.entryDate,
      accountingPeriodId: schema.journalEntries.accountingPeriodId,
      description: schema.journalEntries.description,
      status: schema.journalEntries.status,
      sourceType: schema.journalEntries.sourceType,
      originalJournalId: schema.journalEntries.originalJournalId,
      createdAt: schema.journalEntries.createdAt,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
      lineNumber: schema.journalLines.lineNumber,
      lineDescription: schema.journalLines.description
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(whereClause)
    .orderBy(
      schema.accounts.accountCode,
      schema.journalEntries.entryDate,
      sql`CASE WHEN UPPER(COALESCE(${schema.journalEntries.sourceType}, '')) IN ('OPENING_BALANCE', 'OPENING_BALANCE_MIGRATION') THEN 0 ELSE 1 END`,
      schema.journalEntries.journalNumber,
      schema.journalLines.lineNumber
    );

    const results = reqLimit !== null
      ? await baseGlQuery.limit(reqLimit).offset(reqOffset)
      : await baseGlQuery;

    // Compute brought-forward opening balances per account prior to effectiveStartDate
    const broughtForwardByAccount = new Map<string, { debit: number; credit: number }>();
    if (scope.effectiveStartDate && scope.mode !== 'cumulative' && scope.mode !== 'period_only') {
      const priorRows = await db.select({
        accountId: schema.accounts.id,
        debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
        creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(
        and(
          buildPeriodScopedJournalFilter(scope, { priorToStartDateOnly: true }),
          accountId ? eq(schema.accounts.id, accountId as string) : undefined,
          departmentId ? eq(schema.journalLines.departmentId, departmentId as string) : undefined,
          projectId ? eq(schema.journalLines.projectId, projectId as string) : undefined
        )
      )
      .groupBy(schema.accounts.id);

      for (const p of priorRows) {
        broughtForwardByAccount.set(p.accountId, {
          debit: Number(p.debitTotal || 0),
          credit: Number(p.creditTotal || 0),
        });
      }
    }

    // Also compute in-period explicit OPENING_BALANCE journal totals per account so `openingBalance` reflects
    // broughtForward + openingJournal while `runningBalance` starts from broughtForward and steps through each row once.
    const openingJournalByAccount = new Map<string, { debit: number; credit: number }>();
    for (const r of results) {
      if (isOpeningBalanceSourceType(r.sourceType)) {
        const cur = openingJournalByAccount.get(r.accountId) || { debit: 0, credit: 0 };
        cur.debit += Number(r.debit || 0);
        cur.credit += Number(r.credit || 0);
        openingJournalByAccount.set(r.accountId, cur);
      }
    }

    const runningByAccount = new Map<string, number>();
    const enrichedResults = results.map((r) => {
      const isDebitNormal =
        r.normalBalance === 'DEBIT' ||
        isAssetAccountType(r.accountType) ||
        isExpenseAccountType(r.accountType);
      const bf = broughtForwardByAccount.get(r.accountId) || { debit: 0, credit: 0 };
      const oj = openingJournalByAccount.get(r.accountId) || { debit: 0, credit: 0 };
      const broughtForwardBalance = isDebitNormal ? bf.debit - bf.credit : bf.credit - bf.debit;
      const openingJournalBalance = isDebitNormal ? oj.debit - oj.credit : oj.credit - oj.debit;
      const openingBalance = broughtForwardBalance + openingJournalBalance;

      const prevRunning = runningByAccount.has(r.accountId)
        ? runningByAccount.get(r.accountId)!
        : broughtForwardBalance;
      const lineDelta = isDebitNormal
        ? Number(r.debit || 0) - Number(r.credit || 0)
        : Number(r.credit || 0) - Number(r.debit || 0);
      const nextRunning = prevRunning + lineDelta;
      runningByAccount.set(r.accountId, nextRunning);

      const entryClassification = classifyJournalEntryForPeriod(
        { entryDate: r.entryDate, sourceType: r.sourceType, createdAt: String(r.createdAt || '') },
        scope.effectiveStartDate
      );

      return {
        ...r,
        broughtForwardBalance,
        openingJournalBalance,
        openingBalance,
        runningBalance: nextRunning,
        entryClassification,
      };
    });

    if (reqLimit !== null) {
      const total = totalMatchesCount !== null ? totalMatchesCount : enrichedResults.length;
      return res.json({
        items: enrichedResults,
        totalCount: total,
        limit: reqLimit,
        offset: reqOffset,
        hasMore: reqOffset + reqLimit < total
      });
    }

    res.json(enrichedResults);
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: 'FAILED_TO_LOAD_GENERAL_LEDGER', message: err?.message });
  }
});

// 3. General Journal
router.get('/general-journal', requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const includeUnposted = String(req.query.includeUnposted || '').toLowerCase() === 'true';
    const reqLimit = req.query.limit !== undefined ? Math.max(1, Math.min(5000, Number(req.query.limit) || 100)) : null;
    const reqOffset = req.query.offset !== undefined ? Math.max(0, Number(req.query.offset) || 0) : 0;

    const whereCond = includeUnposted
      ? and(
          eq(schema.journalEntries.companyId, companyId),
          scope.explicitPeriodRequested !== false && scope.effectivePeriodId
            ? (scope.effectiveStartDate && scope.effectiveEndDate
                ? sql`(
                    ${schema.journalEntries.accountingPeriodId} = ${scope.effectivePeriodId}
                    OR EXISTS (
                      SELECT 1 FROM accounting_periods ap_inc
                      WHERE ap_inc.id = ${schema.journalEntries.accountingPeriodId}
                        AND ap_inc.company_id = ${scope.companyId}
                        AND ap_inc.start_date >= ${scope.effectiveStartDate}
                        AND ap_inc.end_date <= ${scope.effectiveEndDate}
                    )
                  )`
                : eq(schema.journalEntries.accountingPeriodId, scope.effectivePeriodId))
            : undefined,
          scope.effectiveStartDate ? gte(schema.journalEntries.entryDate, scope.effectiveStartDate) : undefined,
          scope.effectiveEndDate ? lte(schema.journalEntries.entryDate, scope.effectiveEndDate) : undefined,
          !(scope.explicitPeriodRequested !== false && scope.effectivePeriodId) && (scope.effectiveStartDate || scope.effectiveEndDate)
            ? sql`NOT EXISTS (
                SELECT 1 FROM accounting_periods ap_Check
                WHERE ap_Check.id = ${schema.journalEntries.accountingPeriodId}
                  AND ap_Check.company_id = ${scope.companyId}
                  AND (
                    ${scope.effectiveEndDate ? sql`ap_Check.start_date > ${scope.effectiveEndDate}` : sql`0`}
                    OR
                    ${scope.effectiveStartDate ? sql`ap_Check.end_date < ${scope.effectiveStartDate}` : sql`0`}
                  )
              )`
            : undefined
        )
      : buildPeriodScopedJournalFilter(scope);

    if (reqLimit !== null) {
      const [countRow] = await db.select({ total: sql<number>`count(*)` })
        .from(schema.journalEntries)
        .innerJoin(schema.journalLines, eq(schema.journalEntries.id, schema.journalLines.journalEntryId))
        .where(whereCond);
      const totalCount = Number(countRow?.total || 0);

      const pagedResults = await db.select({
        id: schema.journalEntries.id,
        journalNumber: schema.journalEntries.journalNumber,
        entryDate: schema.journalEntries.entryDate,
        accountingPeriodId: schema.journalEntries.accountingPeriodId,
        description: schema.journalEntries.description,
        status: schema.journalEntries.status,
        sourceType: schema.journalEntries.sourceType,
        originalJournalId: schema.journalEntries.originalJournalId,
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
      .where(whereCond)
      .orderBy(schema.journalEntries.entryDate, schema.journalEntries.journalNumber, schema.journalLines.lineNumber)
      .limit(reqLimit)
      .offset(reqOffset);

      return res.json({
        items: pagedResults,
        totalCount,
        limit: reqLimit,
        offset: reqOffset,
        hasMore: reqOffset + reqLimit < totalCount
      });
    }

    const results = await db.select({
      id: schema.journalEntries.id,
      journalNumber: schema.journalEntries.journalNumber,
      entryDate: schema.journalEntries.entryDate,
      accountingPeriodId: schema.journalEntries.accountingPeriodId,
      description: schema.journalEntries.description,
      status: schema.journalEntries.status,
      sourceType: schema.journalEntries.sourceType,
      originalJournalId: schema.journalEntries.originalJournalId,
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
    .where(whereCond)
    .orderBy(schema.journalEntries.entryDate, schema.journalEntries.journalNumber, schema.journalLines.lineNumber);

    res.json(results);
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: 'FAILED_TO_LOAD_GENERAL_JOURNAL', message: err?.message });
  }
});

// 4. Balance Sheet
router.get('/balance-sheet', requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const scope = await resolveReportPeriodScope(companyId, req.query);

    // Balance Sheet is cumulative as of effectiveEndDate (unless mode=period_only is explicitly requested)
    const bsFilter = buildPeriodScopedJournalFilter(scope, {
      asOfEndDateOnly: scope.mode !== 'period_only',
    });

    const accountsData = await db.select({
      id: schema.accounts.id,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      accountType: schema.accounts.accountType,
      normalBalance: schema.accounts.normalBalance,
      debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(bsFilter)
    .groupBy(schema.accounts.id)
    .orderBy(schema.accounts.accountCode);

    // Compute current-period operational Net Income vs brought-forward prior-period Retained Earnings
    let priorRetainedEarnings = 0;
    if (scope.effectiveStartDate && scope.mode !== 'period_only') {
      const priorPnlRows = await db.select({
        accountType: schema.accounts.accountType,
        debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
        creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(buildPeriodScopedJournalFilter(scope, { priorToStartDateOnly: true }))
      .groupBy(schema.accounts.accountType);

      let priorRev = 0;
      let priorExp = 0;
      for (const r of priorPnlRows) {
        const deb = Number(r.debitTotal || 0);
        const cred = Number(r.creditTotal || 0);
        if (isRevenueAccountType(r.accountType)) priorRev += cred - deb;
        else if (isExpenseAccountType(r.accountType)) priorExp += deb - cred;
      }
      priorRetainedEarnings = priorRev - priorExp;
    }

    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;
    let totalRevenue = 0;
    let totalExpense = 0;

    const assets: any[] = [];
    const liabilities: any[] = [];
    const equity: any[] = [];
    const seenAccountIds = new Set<string>();

    accountsData.forEach(acc => {
      if (seenAccountIds.has(acc.id)) return;
      seenAccountIds.add(acc.id);

      const debit = Number(acc.debitTotal || 0);
      const credit = Number(acc.creditTotal || 0);

      if (isAssetAccountType(acc.accountType)) {
        const bal = debit - credit;
        totalAssets += bal;
        assets.push({ ...acc, balance: bal });
      } else if (isLiabilityAccountType(acc.accountType)) {
        const bal = credit - debit;
        totalLiabilities += bal;
        liabilities.push({ ...acc, balance: bal });
      } else if (isEquityAccountType(acc.accountType)) {
        const bal = credit - debit;
        totalEquity += bal;
        equity.push({ ...acc, balance: bal });
      } else if (isRevenueAccountType(acc.accountType)) {
        totalRevenue += (credit - debit);
      } else if (isExpenseAccountType(acc.accountType)) {
        totalExpense += (debit - credit);
      }
    });

    const cumulativeNetIncome = totalRevenue - totalExpense;
    const retainedEarningsBroughtForward = priorRetainedEarnings;
    const retainedEarningsCurrentPeriod = cumulativeNetIncome - retainedEarningsBroughtForward;
    const preCloseEquity = totalEquity;
    totalEquity += cumulativeNetIncome;

    res.json({
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      preCloseEquity,
      totalEquity,
      netIncome: cumulativeNetIncome,
      retainedEarningsBroughtForward,
      retainedEarningsCurrentPeriod,
      accountingPeriodId: scope.effectivePeriodId,
      startDate: scope.effectiveStartDate,
      endDate: scope.effectiveEndDate,
      accountingEquationDiscrepancy: totalAssets - (totalLiabilities + totalEquity),
      balanced: totalAssets === (totalLiabilities + totalEquity),
      data: [...assets, ...liabilities, ...equity]
    });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: 'FAILED_TO_LOAD_BALANCE_SHEET', message: err?.message });
  }
});

// 5. Income Statement
router.get('/income-statement', requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const scope = await resolveReportPeriodScope(companyId, req.query);

    // Income Statement strictly excludes OPENING_BALANCE, OPENING_BALANCE_MIGRATION, and YEAR_END_CLOSE journals
    // so opening balances and year-end closing transfers are never misclassified as current-period revenue or expense.
    const accountsData = await db.select({
      id: schema.accounts.id,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      accountType: schema.accounts.accountType,
      debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(buildPeriodScopedJournalFilter(scope, { operationalPnlOnly: true }))
    .groupBy(schema.accounts.id)
    .orderBy(schema.accounts.accountCode);

    const revenues: any[] = [];
    const expenses: any[] = [];
    let totalRevenue = 0;
    let totalExpense = 0;

    accountsData.forEach(acc => {
      let bal = 0;
      if (isRevenueAccountType(acc.accountType)) {
        bal = Number(acc.creditTotal || 0) - Number(acc.debitTotal || 0);
        totalRevenue += bal;
        revenues.push({ ...acc, balance: bal });
      } else if (isExpenseAccountType(acc.accountType)) {
        bal = Number(acc.debitTotal || 0) - Number(acc.creditTotal || 0);
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
      netIncome,
      accountingPeriodId: scope.effectivePeriodId,
      startDate: scope.effectiveStartDate,
      endDate: scope.effectiveEndDate,
      mode: scope.mode,
      data: [...revenues, ...expenses]
    });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: 'FAILED_TO_LOAD_INCOME_STATEMENT', message: err?.message });
  }
});

// 6. Statement of Cash Flows
router.get('/cash-flow', requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const scope = await resolveReportPeriodScope(companyId, req.query);

    const cashWhere = and(
      buildPeriodScopedJournalFilter(scope),
      eq(schema.accounts.isCashAccount, true)
    );

    const [cashAgg] = await db.select({
      totalDebit: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      totalCredit: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`,
      totalLines: sql<number>`count(*)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(cashWhere);

    const operatingCashFlow = Number(cashAgg?.totalDebit || 0) - Number(cashAgg?.totalCredit || 0);
    const maxCashLines = req.query.limit !== undefined ? Math.max(1, Math.min(2000, Number(req.query.limit) || 500)) : 500;

    const cashLines = await db.select({
      entryId: schema.journalEntries.id,
      entryDate: schema.journalEntries.entryDate,
      accountingPeriodId: schema.journalEntries.accountingPeriodId,
      description: schema.journalEntries.description,
      sourceType: schema.journalEntries.sourceType,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
      accountName: schema.accounts.accountName
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(cashWhere)
    .limit(maxCashLines);

    res.json({
      operatingCashFlow,
      investingCashFlow: 0,
      financingCashFlow: 0,
      netChangeInCash: operatingCashFlow,
      totalCashLineCount: Number(cashAgg?.totalLines || 0),
      accountingPeriodId: scope.effectivePeriodId,
      startDate: scope.effectiveStartDate,
      endDate: scope.effectiveEndDate,
      cashLines
    });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: 'FAILED_TO_LOAD_CASH_FLOW', message: err?.message });
  }
});

// 7. Statement of Changes in Equity
router.get('/changes-in-equity', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;

  try {
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const accountsData = await db.select({
      id: schema.accounts.id,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      accountType: schema.accounts.accountType,
      debitTotal: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(buildPeriodScopedJournalFilter(scope, { asOfEndDateOnly: scope.mode !== 'period_only' }))
    .groupBy(schema.accounts.id);

    let beginningCapital = 0;
    let capitalContributions = 0;
    let totalRevenue = 0;
    let totalExpense = 0;
    let dividendsWithdrawals = 0;

    accountsData.forEach(acc => {
      const netCredit = Number(acc.creditTotal || 0) - Number(acc.debitTotal || 0);
      const netDebit = Number(acc.debitTotal || 0) - Number(acc.creditTotal || 0);

      if (acc.accountType === 'EQUITY') {
        const nameLower = acc.accountName.toLowerCase();
        if (nameLower.includes('dividend') || nameLower.includes('drawing') || nameLower.includes('withdrawal')) {
          dividendsWithdrawals += netDebit > 0 ? netDebit : Math.abs(netCredit);
        } else if (nameLower.includes('capital') || nameLower.includes('share') || nameLower.includes('contribution')) {
          capitalContributions += netCredit;
        } else {
          beginningCapital += netCredit;
        }
      } else if (isRevenueAccountType(acc.accountType)) {
        totalRevenue += netCredit;
      } else if (isExpenseAccountType(acc.accountType)) {
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
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: "Failed to calculate Statement of Changes in Equity" });
  }
});

// 8. Comparative Balance Sheet
router.get('/comparative-balance-sheet', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { currentEndDate, priorEndDate } = req.query;

  try {
    await assertNoDuplicateReversalLineage(companyId);
    const curEnd = String(currentEndDate || new Date().toISOString().slice(0, 10)).trim().slice(0, 10);
    const priEnd = String(priorEndDate || `${new Date().getFullYear() - 1}-12-31`).trim().slice(0, 10);

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
        buildEffectivePostedJournalPredicate(companyId),
        lte(schema.journalEntries.entryDate, curEnd),
        sql`NOT EXISTS (
          SELECT 1 FROM accounting_periods ap_Check
          WHERE ap_Check.id = ${schema.journalEntries.accountingPeriodId}
            AND ap_Check.company_id = ${companyId}
            AND ap_Check.start_date > ${curEnd}
        )`
      )
    )
    .groupBy(schema.accounts.id);

    const priorAccounts = await db.select({
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
        buildEffectivePostedJournalPredicate(companyId),
        lte(schema.journalEntries.entryDate, priEnd),
        sql`NOT EXISTS (
          SELECT 1 FROM accounting_periods ap_Check
          WHERE ap_Check.id = ${schema.journalEntries.accountingPeriodId}
            AND ap_Check.company_id = ${companyId}
            AND ap_Check.start_date > ${priEnd}
        )`
      )
    )
    .groupBy(schema.accounts.id);

    const priorMap = new Map<string, { id: string; accountCode: string; accountName: string; accountType: string; debitTotal: number; creditTotal: number }>(
      priorAccounts.map(p => [p.id, p])
    );
    const currentMap = new Map<string, { id: string; accountCode: string; accountName: string; accountType: string; debitTotal: number; creditTotal: number }>(
      currentAccounts.map(c => [c.id, c])
    );

    const allAccountIds = Array.from(new Set([...currentMap.keys(), ...priorMap.keys()]));

    let currentTotalAssets = 0;
    let currentTotalLiabilities = 0;
    let currentTotalEquity = 0;
    let currentNetIncome = 0;

    let priorTotalAssets = 0;
    let priorTotalLiabilities = 0;
    let priorTotalEquity = 0;
    let priorNetIncome = 0;

    const items: any[] = [];

    for (const accId of allAccountIds) {
      const cur = currentMap.get(accId);
      const pri = priorMap.get(accId);
      const meta = cur || pri!;

      const curDebit = Number(cur?.debitTotal || 0);
      const curCredit = Number(cur?.creditTotal || 0);
      const priDebit = Number(pri?.debitTotal || 0);
      const priCredit = Number(pri?.creditTotal || 0);

      if (isRevenueAccountType(meta.accountType)) {
        currentNetIncome += (curCredit - curDebit);
        priorNetIncome += (priCredit - priDebit);
        continue;
      }
      if (isExpenseAccountType(meta.accountType)) {
        currentNetIncome -= (curDebit - curCredit);
        priorNetIncome -= (priDebit - priCredit);
        continue;
      }

      if (!isAssetAccountType(meta.accountType) && !isLiabilityAccountType(meta.accountType) && !isEquityAccountType(meta.accountType)) {
        continue;
      }

      const isAsset = isAssetAccountType(meta.accountType);
      const curBal = isAsset ? (curDebit - curCredit) : (curCredit - curDebit);
      const priBal = isAsset ? (priDebit - priCredit) : (priCredit - priDebit);

      if (isAsset) {
        currentTotalAssets += curBal;
        priorTotalAssets += priBal;
      } else if (isLiabilityAccountType(meta.accountType)) {
        currentTotalLiabilities += curBal;
        priorTotalLiabilities += priBal;
      } else if (isEquityAccountType(meta.accountType)) {
        currentTotalEquity += curBal;
        priorTotalEquity += priBal;
      }

      const variance = curBal - priBal;
      const variancePct = priBal !== 0 ? ((variance / Math.abs(priBal)) * 100).toFixed(2) + '%' : 'N/A';

      items.push({
        accountCode: meta.accountCode,
        accountName: meta.accountName,
        accountType: meta.accountType,
        category: isAsset ? 'ASSET' : isLiabilityAccountType(meta.accountType) ? 'LIABILITY' : 'EQUITY',
        currentPeriodBalance: curBal,
        priorPeriodBalance: priBal,
        varianceAmount: variance,
        variancePercent: variancePct
      });
    }

    currentTotalEquity += currentNetIncome;
    priorTotalEquity += priorNetIncome;

    res.json({
      asOfCurrentDate: curEnd,
      asOfPriorDate: priEnd,
      comparison: items,
      currentTotals: {
        totalAssets: currentTotalAssets,
        totalLiabilities: currentTotalLiabilities,
        totalEquity: currentTotalEquity,
        netIncome: currentNetIncome,
        balanced: currentTotalAssets === (currentTotalLiabilities + currentTotalEquity)
      },
      priorTotals: {
        totalAssets: priorTotalAssets,
        totalLiabilities: priorTotalLiabilities,
        totalEquity: priorTotalEquity,
        netIncome: priorNetIncome,
        balanced: priorTotalAssets === (priorTotalLiabilities + priorTotalEquity)
      }
    });
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: "Failed to generate Comparative Balance Sheet" });
  }
});

// 9. Comparative Income Statement
router.get('/comparative-income-statement', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const currentYear = Number(req.query.currentYear) || new Date().getFullYear();
  const curStart = String(req.query.currentStartDate || `${currentYear}-01-01`).trim().slice(0, 10);
  const curEnd = String(req.query.currentEndDate || `${currentYear}-12-31`).trim().slice(0, 10);
  const priStart = String(req.query.priorStartDate || `${currentYear - 1}-01-01`).trim().slice(0, 10);
  const priEnd = String(req.query.priorEndDate || `${currentYear - 1}-12-31`).trim().slice(0, 10);

  try {
    if (curStart > curEnd || priStart > priEnd) {
      return res.status(400).json({
        error: 'INVALID_DATE_RANGE',
        message: 'startDate cannot exceed endDate for comparative income statement periods.',
      });
    }
    await assertNoDuplicateReversalLineage(companyId);

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
        buildEffectivePostedJournalPredicate(companyId),
        isOperationalPnlJournalSql(),
        gte(schema.journalEntries.entryDate, curStart),
        lte(schema.journalEntries.entryDate, curEnd),
        sql`NOT EXISTS (
          SELECT 1 FROM accounting_periods ap_Check
          WHERE ap_Check.id = ${schema.journalEntries.accountingPeriodId}
            AND ap_Check.company_id = ${companyId}
            AND (ap_Check.start_date > ${curEnd} OR ap_Check.end_date < ${curStart})
        )`
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
        buildEffectivePostedJournalPredicate(companyId),
        isOperationalPnlJournalSql(),
        gte(schema.journalEntries.entryDate, priStart),
        lte(schema.journalEntries.entryDate, priEnd),
        sql`NOT EXISTS (
          SELECT 1 FROM accounting_periods ap_Check
          WHERE ap_Check.id = ${schema.journalEntries.accountingPeriodId}
            AND ap_Check.company_id = ${companyId}
            AND (ap_Check.start_date > ${priEnd} OR ap_Check.end_date < ${priStart})
        )`
      )
    )
    .groupBy(schema.accounts.accountType);

    const curRev = currentLines.filter(l => isRevenueAccountType(l.accountType)).reduce((s, l) => s + ((l.creditTotal || 0) - (l.debitTotal || 0)), 0);
    const curExp = currentLines.filter(l => isExpenseAccountType(l.accountType)).reduce((s, l) => s + ((l.debitTotal || 0) - (l.creditTotal || 0)), 0);
    const curNet = curRev - curExp;

    const priRev = priorLines.filter(l => isRevenueAccountType(l.accountType)).reduce((s, l) => s + ((l.creditTotal || 0) - (l.debitTotal || 0)), 0);
    const priExp = priorLines.filter(l => isExpenseAccountType(l.accountType)).reduce((s, l) => s + ((l.debitTotal || 0) - (l.creditTotal || 0)), 0);
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
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: "Failed to generate Comparative Income Statement" });
  }
});

// 10. Account Schedule
router.get('/account-schedule', requireAuth, requirePermission('reports:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;

  try {
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const allCompanyAccounts = await db
      .select({
        accountId: schema.accounts.id,
        accountCode: schema.accounts.accountCode,
        accountName: schema.accounts.accountName,
        accountType: schema.accounts.accountType,
        normalBalance: schema.accounts.normalBalance,
      })
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId))
      .orderBy(schema.accounts.accountCode);

    // 1. Operational period movements (excluding explicit OPENING_BALANCE journals)
    const periodLines = await db
      .select({
        accountId: schema.journalLines.accountId,
        totalDebit: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
        totalCredit: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`,
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .where(
        buildPeriodScopedJournalFilter(scope, {
          excludeOpeningBalanceJournals: scope.mode !== 'cumulative',
        })
      )
      .groupBy(schema.journalLines.accountId);

    const periodMap = new Map<string, { debit: number; credit: number }>();
    for (const p of periodLines) {
      periodMap.set(p.accountId, {
        debit: Number(p.totalDebit || 0),
        credit: Number(p.totalCredit || 0),
      });
    }

    // 2. Explicit in-period OPENING_BALANCE journals (e.g. 2026-01-01 sourceType='OPENING_BALANCE')
    const inPeriodOpeningMap = new Map<string, { debit: number; credit: number }>();
    if (scope.mode !== 'cumulative') {
      const openLines = await db
        .select({
          accountId: schema.journalLines.accountId,
          totalDebit: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
          totalCredit: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`,
        })
        .from(schema.journalLines)
        .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
        .where(buildPeriodScopedJournalFilter(scope, { onlyOpeningBalanceJournals: true }))
        .groupBy(schema.journalLines.accountId);

      for (const ol of openLines) {
        inPeriodOpeningMap.set(ol.accountId, {
          debit: Number(ol.totalDebit || 0),
          credit: Number(ol.totalCredit || 0),
        });
      }
    }

    // 3. Prior-period Brought-Forward balances prior to effectiveStartDate
    const broughtForwardMap = new Map<string, { debit: number; credit: number }>();
    if (scope.effectiveStartDate && scope.mode !== 'cumulative' && scope.mode !== 'period_only') {
      const priorLines = await db
        .select({
          accountId: schema.journalLines.accountId,
          totalDebit: sql<number>`COALESCE(sum(${schema.journalLines.debit}), 0)`,
          totalCredit: sql<number>`COALESCE(sum(${schema.journalLines.credit}), 0)`,
        })
        .from(schema.journalLines)
        .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
        .where(buildPeriodScopedJournalFilter(scope, { priorToStartDateOnly: true }))
        .groupBy(schema.journalLines.accountId);

      for (const pr of priorLines) {
        broughtForwardMap.set(pr.accountId, {
          debit: Number(pr.totalDebit || 0),
          credit: Number(pr.totalCredit || 0),
        });
      }
    }

    const formattedSchedules = allCompanyAccounts.map((s) => {
      const isDebitNormal =
        s.normalBalance === 'DEBIT' ||
        isAssetAccountType(s.accountType) ||
        isExpenseAccountType(s.accountType);
      const p = periodMap.get(s.accountId) || { debit: 0, credit: 0 };
      const oj = inPeriodOpeningMap.get(s.accountId) || { debit: 0, credit: 0 };
      const bf = broughtForwardMap.get(s.accountId) || { debit: 0, credit: 0 };

      const broughtForwardBalance = isDebitNormal ? bf.debit - bf.credit : bf.credit - bf.debit;
      const openingJournalBalance = isDebitNormal ? oj.debit - oj.credit : oj.credit - oj.debit;
      const openingBalance = broughtForwardBalance + openingJournalBalance;
      const periodNet = isDebitNormal ? p.debit - p.credit : p.credit - p.debit;
      const closingBalance = openingBalance + periodNet;

      return {
        accountId: s.accountId,
        accountCode: s.accountCode,
        accountName: s.accountName,
        accountType: s.accountType,
        broughtForwardBalance,
        openingJournalBalance,
        openingBalance,
        totalDebit: p.debit,
        totalCredit: p.credit,
        netMovement: p.debit - p.credit,
        periodNetMovement: periodNet,
        closingBalance,
        accountingPeriodId: scope.effectivePeriodId,
        startDate: scope.effectiveStartDate,
        endDate: scope.effectiveEndDate,
      };
    });

    res.json(formattedSchedules);
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: "Failed to generate Account Schedule" });
  }
});

// 11. Transaction Detail
router.get('/transaction-detail', requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const entries = await db
      .select()
      .from(schema.journalEntries)
      .where(buildPeriodScopedJournalFilter(scope))
      .orderBy(schema.journalEntries.entryDate, schema.journalEntries.journalNumber)
      .limit(Math.min(2000, Number(req.query.limit) || 500));

    const enriched = entries.map((e) => ({
      ...e,
      entryClassification: classifyJournalEntryForPeriod(
        { entryDate: e.entryDate, sourceType: e.sourceType, createdAt: String(e.createdAt || '') },
        scope.effectiveStartDate
      ),
    }));

    res.json(enriched);
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: 'FAILED_TO_LOAD_TRANSACTION_DETAIL', message: err?.message });
  }
});

// 12. Cashbook
router.get('/cashbook', requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const cashLines = await db.select({
      entryDate: schema.journalEntries.entryDate,
      accountingPeriodId: schema.journalEntries.accountingPeriodId,
      journalNumber: schema.journalEntries.journalNumber,
      description: schema.journalEntries.description,
      sourceType: schema.journalEntries.sourceType,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
      accountName: schema.accounts.accountName
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        buildPeriodScopedJournalFilter(scope),
        eq(schema.accounts.isCashAccount, true)
      )
    )
    .orderBy(schema.journalEntries.entryDate, schema.journalEntries.journalNumber)
    .limit(Math.min(2000, Number(req.query.limit) || 500));

    res.json(cashLines);
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: 'FAILED_TO_LOAD_CASHBOOK', message: err?.message });
  }
});

// 13. AR Aging
router.get('/ar-aging', requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const reqLimit = req.query.limit !== undefined ? Math.max(1, Math.min(5000, Number(req.query.limit) || 100)) : null;
    const reqOffset = req.query.offset !== undefined ? Math.max(0, Number(req.query.offset) || 0) : 0;

    const whereCond = and(
      eq(schema.salesInvoices.companyId, companyId),
      sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND ${schema.salesInvoices.balanceDue} > 0`,
      sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
      scope.effectiveStartDate && scope.mode === 'period_only' ? gte(schema.salesInvoices.invoiceDate, scope.effectiveStartDate) : undefined,
      scope.effectiveEndDate ? lte(schema.salesInvoices.invoiceDate, scope.effectiveEndDate) : undefined
    );

    if (reqLimit !== null) {
      const [summary] = await db.select({
        totalCount: sql<number>`count(*)`,
        totalBalanceDue: sql<number>`COALESCE(sum(${schema.salesInvoices.balanceDue}), 0)`
      })
      .from(schema.salesInvoices)
      .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
      .where(whereCond);

      const items = await db.select({
        customerId: schema.customers.id,
        customerName: schema.customers.legalName,
        invoiceId: schema.salesInvoices.id,
        invoiceNumber: schema.salesInvoices.invoiceNumber,
        status: schema.salesInvoices.status,
        dueDate: schema.salesInvoices.dueDate,
        balanceDue: schema.salesInvoices.balanceDue
      })
      .from(schema.salesInvoices)
      .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
      .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
      .where(whereCond)
      .orderBy(schema.salesInvoices.dueDate, schema.salesInvoices.invoiceNumber)
      .limit(reqLimit)
      .offset(reqOffset);

      return res.json({
        items,
        totalCount: Number(summary?.totalCount || 0),
        totalBalanceDue: Number(summary?.totalBalanceDue || 0),
        limit: reqLimit,
        offset: reqOffset,
        hasMore: reqOffset + reqLimit < Number(summary?.totalCount || 0)
      });
    }

    const arAging = await db.select({
      customerId: schema.customers.id,
      customerName: schema.customers.legalName,
      invoiceId: schema.salesInvoices.id,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      status: schema.salesInvoices.status,
      dueDate: schema.salesInvoices.dueDate,
      balanceDue: schema.salesInvoices.balanceDue
    })
    .from(schema.salesInvoices)
    .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
    .leftJoin(schema.journalEntries, eq(schema.salesInvoices.journalEntryId, schema.journalEntries.id))
    .where(whereCond)
    .limit(Math.min(2000, Number(req.query.limit) || 500));

    res.json(arAging);
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: 'FAILED_TO_LOAD_AR_AGING', message: err?.message });
  }
});

// 14. AP Aging
router.get('/ap-aging', requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const scope = await resolveReportPeriodScope(companyId, req.query);
    const reqLimit = req.query.limit !== undefined ? Math.max(1, Math.min(5000, Number(req.query.limit) || 100)) : null;
    const reqOffset = req.query.offset !== undefined ? Math.max(0, Number(req.query.offset) || 0) : 0;

    const whereCond = and(
      eq(schema.purchaseBills.companyId, companyId),
      sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND ${schema.purchaseBills.balanceDue} > 0`,
      sql`(${schema.journalEntries.status} IS NULL OR ${schema.journalEntries.status} = 'POSTED')`,
      scope.effectiveStartDate && scope.mode === 'period_only' ? gte(schema.purchaseBills.billDate, scope.effectiveStartDate) : undefined,
      scope.effectiveEndDate ? lte(schema.purchaseBills.billDate, scope.effectiveEndDate) : undefined
    );

    if (reqLimit !== null) {
      const [summary] = await db.select({
        totalCount: sql<number>`count(*)`,
        totalBalanceDue: sql<number>`COALESCE(sum(${schema.purchaseBills.balanceDue}), 0)`
      })
      .from(schema.purchaseBills)
      .leftJoin(schema.journalEntries, eq(schema.purchaseBills.journalEntryId, schema.journalEntries.id))
      .where(whereCond);

      const items = await db.select({
        vendorId: schema.vendors.id,
        vendorName: schema.vendors.legalName,
        billId: schema.purchaseBills.id,
        billNumber: schema.purchaseBills.billNumber,
        status: schema.purchaseBills.status,
        dueDate: schema.purchaseBills.dueDate,
        balanceDue: schema.purchaseBills.balanceDue
      })
      .from(schema.purchaseBills)
      .innerJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
      .leftJoin(schema.journalEntries, eq(schema.purchaseBills.journalEntryId, schema.journalEntries.id))
      .where(whereCond)
      .orderBy(schema.purchaseBills.dueDate, schema.purchaseBills.billNumber)
      .limit(reqLimit)
      .offset(reqOffset);

      return res.json({
        items,
        totalCount: Number(summary?.totalCount || 0),
        totalBalanceDue: Number(summary?.totalBalanceDue || 0),
        limit: reqLimit,
        offset: reqOffset,
        hasMore: reqOffset + reqLimit < Number(summary?.totalCount || 0)
      });
    }

    const apAging = await db.select({
      vendorId: schema.vendors.id,
      vendorName: schema.vendors.legalName,
      billId: schema.purchaseBills.id,
      billNumber: schema.purchaseBills.billNumber,
      status: schema.purchaseBills.status,
      dueDate: schema.purchaseBills.dueDate,
      balanceDue: schema.purchaseBills.balanceDue
    })
    .from(schema.purchaseBills)
    .innerJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
    .leftJoin(schema.journalEntries, eq(schema.purchaseBills.journalEntryId, schema.journalEntries.id))
    .where(whereCond)
    .limit(Math.min(2000, Number(req.query.limit) || 500));

    res.json(apAging);
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.code || 'INVALID_PERIOD_FILTER', message: err.message });
    }
    res.status(500).json({ error: 'FAILED_TO_LOAD_AP_AGING', message: err?.message });
  }
});

// 14B. Inventory Valuation & Subledger-to-GL Reconciliation Report
router.get('/inventory-valuation', requireAuth, requirePermission('reports:view', 'inventory:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const asOfDate = (req.query.endDate as string) || (req.query.asOfDate as string) || undefined;

    const items = await db.select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.companyId, companyId))
      .orderBy(schema.inventoryItems.sku);

    const txWhere = asOfDate
      ? and(eq(schema.inventoryTransactions.companyId, companyId), lte(schema.inventoryTransactions.transactionDate, asOfDate))
      : eq(schema.inventoryTransactions.companyId, companyId);

    const movementAggs = await db.select({
      itemId: schema.inventoryTransactions.itemId,
      movementCount: sql<number>`count(*)`,
      netQuantity: sql<number>`COALESCE(sum(${schema.inventoryTransactions.quantity}), 0)`,
      netValueCentavos: sql<number>`COALESCE(sum(${schema.inventoryTransactions.totalValue}), 0)`
    })
    .from(schema.inventoryTransactions)
    .where(txWhere)
    .groupBy(schema.inventoryTransactions.itemId);

    const movMap = new Map<string, { movementCount: number; netQuantity: number; netValueCentavos: number }>();
    let totalMovementCount = 0;
    let totalMovementValueCentavos = 0;
    for (const m of movementAggs) {
      const mc = Number(m.movementCount || 0);
      const nq = Number(m.netQuantity || 0);
      const nv = Number(m.netValueCentavos || 0);
      movMap.set(m.itemId, { movementCount: mc, netQuantity: nq, netValueCentavos: nv });
      totalMovementCount += mc;
      totalMovementValueCentavos += nv;
    }

    let totalSubledgerValuationCentavos = 0;
    const valuationRows = items.map((item) => {
      const mov = movMap.get(item.id);
      const itemValCentavos = Math.round(Number(item.quantityOnHand || 0) * Number(item.unitCost || 0));
      totalSubledgerValuationCentavos += itemValCentavos;
      return {
        itemId: item.id,
        sku: item.sku,
        name: item.name,
        costingMethod: item.costingMethod,
        quantityOnHand: Number(item.quantityOnHand || 0),
        unitCostCentavos: Number(item.unitCost || 0),
        subledgerValuationCentavos: itemValCentavos,
        movementCount: mov?.movementCount || 0,
        movementNetQuantity: mov?.netQuantity || 0,
        movementNetValueCentavos: mov?.netValueCentavos || 0,
      };
    });

    res.json({
      companyId,
      asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
      itemCount: items.length,
      totalMovementCount,
      totalSubledgerValuationCentavos,
      totalMovementValueCentavos,
      reconciledMovementsToSubledger:
        totalMovementCount === 0 || Math.abs(totalSubledgerValuationCentavos - totalMovementValueCentavos) <= 1,
      items: valuationRows,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'FAILED_TO_LOAD_INVENTORY_VALUATION', message: err?.message });
  }
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
    .where(eq(schema.auditLogs.companyId, companyId))
    .limit(Math.min(2000, Number(req.query.limit) || 500));

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
    )
    .limit(Math.min(2000, Number(req.query.limit) || 500));
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
    )
    .limit(Math.min(2000, Number(req.query.limit) || 500));
  res.json(results);
});

// Persistent Report Certification & Sign-off History
router.get("/sign-off", requireAuth, requirePermission('reports:view', 'accounting:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const reportName = String(req.query.reportName || '').trim();
    const accountingPeriodId = String(req.query.accountingPeriodId || '').trim();
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();

    const conditions = [
      eq(schema.auditLogs.companyId, companyId),
      eq(schema.auditLogs.action, "SIGN_OFF_REPORT"),
    ];
    if (reportName) {
      conditions.push(eq(schema.auditLogs.entityId, reportName));
    }

    const rows = await db
      .select({
        id: schema.auditLogs.id,
        reportName: schema.auditLogs.entityId,
        notes: schema.auditLogs.reason,
        afterData: schema.auditLogs.afterData,
        createdAt: schema.auditLogs.timestamp,
        userId: schema.auditLogs.userId,
        signerName: schema.users.displayName,
        signerEmail: schema.users.email,
      })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.auditLogs.userId, schema.users.id))
      .where(and(...conditions))
      .orderBy(desc(schema.auditLogs.timestamp))
      .limit(50);

    const parsed = rows.map((r) => {
      let meta: Record<string, any> = {};
      try {
        meta = r.afterData ? JSON.parse(String(r.afterData)) : {};
      } catch {
        meta = {};
      }
      return {
        id: r.id,
        reportName: r.reportName,
        notes: r.notes || '',
        accountingPeriodId: meta.accountingPeriodId || null,
        periodLabel: meta.periodLabel || 'All Periods (Cumulative)',
        startDate: meta.startDate || null,
        endDate: meta.endDate || null,
        openingDebit: Number(meta.openingDebit || 0),
        openingCredit: Number(meta.openingCredit || 0),
        periodDebit: Number(meta.periodDebit || 0),
        periodCredit: Number(meta.periodCredit || 0),
        closingDebit: Number(meta.closingDebit || 0),
        closingCredit: Number(meta.closingCredit || 0),
        accountCount: Number(meta.accountCount || 0),
        signerName: meta.signerName || r.signerName || r.signerEmail || 'Authorized Approver',
        signerRole: meta.signerRole || 'Approver',
        signedAt: meta.signedAt || r.createdAt,
      };
    });

    const scopeKey = `${accountingPeriodId || 'CUMULATIVE'}|${startDate || ''}|${endDate || ''}`;
    const matching = parsed.filter((c) => {
      const cKey = `${c.accountingPeriodId || 'CUMULATIVE'}|${c.startDate || ''}|${c.endDate || ''}`;
      return cKey === scopeKey;
    });

    res.json({
      latestForScope: matching[0] || null,
      history: parsed,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'FAILED_TO_LOAD_SIGNOFF', message: err?.message || 'Failed to load sign-off records.' });
  }
});

// Sign-off endpoint (persistent, scope-aware, and balance-enforced)
router.post("/sign-off", requireAuth, requirePermission('accounting:approve'), async (req, res) => {
  try {
    const {
      reportName,
      notes,
      accountingPeriodId,
      periodLabel,
      startDate,
      endDate,
      openingDebit,
      openingCredit,
      periodDebit,
      periodCredit,
      closingDebit,
      closingCredit,
      accountCount,
      isBalanced,
    } = req.body || {};

    if (!reportName || !String(reportName).trim()) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'reportName is required.' });
    }

    if (isBalanced === false) {
      return res.status(400).json({
        error: 'OUT_OF_BALANCE_SIGNOFF_BLOCKED',
        message: 'Cannot sign off and seal an out-of-balance Trial Balance. Resolve the Debit/Credit variance first.',
      });
    }

    const userId = req.user!.id;
    const companyId = req.activeCompany!.id;
    const signerName = req.user!.displayName || req.user!.email || 'Authorized Approver';
    const signerRole = req.activeCompany?.roleName || req.activeCompany?.role || 'Approver';
    const signedAt = new Date().toISOString();
    const certId = crypto.randomUUID();

    const certPayload = {
      accountingPeriodId: accountingPeriodId || null,
      periodLabel: periodLabel || 'All Periods (Cumulative)',
      startDate: startDate || null,
      endDate: endDate || null,
      openingDebit: Number(openingDebit || 0),
      openingCredit: Number(openingCredit || 0),
      periodDebit: Number(periodDebit || 0),
      periodCredit: Number(periodCredit || 0),
      closingDebit: Number(closingDebit || 0),
      closingCredit: Number(closingCredit || 0),
      accountCount: Number(accountCount || 0),
      isBalanced: true,
      signerName,
      signerRole,
      signedAt,
    };

    await db.insert(schema.auditLogs).values({
      id: certId,
      companyId,
      userId,
      userEmail: req.user!.email,
      userDisplayName: signerName,
      role: signerRole,
      action: "SIGN_OFF_REPORT",
      entityType: "REPORT",
      entityId: String(reportName).trim(),
      entityName: String(reportName).trim(),
      recordReference: periodLabel || 'All Periods (Cumulative)',
      module: "Accounting & General Ledger / Trial Balance",
      reason: String(notes || '').trim() || 'Trial Balance reconciled and certified (DR === CR).',
      afterData: JSON.stringify(certPayload),
      result: "SUCCESS",
    });

    res.json({
      success: true,
      message: "Report successfully signed off and certified.",
      certification: {
        id: certId,
        reportName: String(reportName).trim(),
        notes: String(notes || '').trim() || 'Trial Balance reconciled and certified (DR === CR).',
        ...certPayload,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'SIGN_OFF_FAILED', message: err?.message || 'Failed to record sign-off.' });
  }
});

router.get(["/integrity-check", "/integrity"], requireAuth, requirePermission('audit:view', 'reports:view'), async (req, res) => {
  try {
    const companyId = (req.query.companyId as string) || req.activeCompany?.id;
    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Company ID is required" });
    }

    // Find unbalanced POSTED entries for this company
    const unbalanced = await db.select({
      id: schema.journalEntries.id,
      journalNumber: schema.journalEntries.journalNumber,
      totalDebit: sql`sum(${schema.journalLines.debit})`,
      totalCredit: sql`sum(${schema.journalLines.credit})`,
      discrepancy: sql`abs(sum(${schema.journalLines.debit}) - sum(${schema.journalLines.credit}))`
    })
    .from(schema.journalEntries)
    .leftJoin(schema.journalLines, eq(schema.journalEntries.id, schema.journalLines.journalEntryId))
    .where(and(eq(schema.journalEntries.companyId, companyId), eq(schema.journalEntries.status, 'POSTED')))
    .groupBy(schema.journalEntries.id)
    .having(sql`abs(sum(${schema.journalLines.debit}) - sum(${schema.journalLines.credit})) > 0.001`);

    const countQuery = await db.select({ count: sql`count(*)` })
      .from(schema.journalEntries)
      .where(and(eq(schema.journalEntries.companyId, companyId), eq(schema.journalEntries.status, 'POSTED')));
      
    const totalPosted = Number(countQuery[0]?.count || 0);

    // Find duplicate POSTED reversal children for the same original_journal_id
    const duplicateReversals = await db.select({
      originalJournalId: schema.journalEntries.originalJournalId,
      reversalCount: sql`count(*)`,
      reversalIds: sql`group_concat(${schema.journalEntries.id})`,
      reversalNumbers: sql`group_concat(${schema.journalEntries.journalNumber})`
    })
    .from(schema.journalEntries)
    .where(and(
      eq(schema.journalEntries.companyId, companyId),
      sql`${schema.journalEntries.originalJournalId} IS NOT NULL`,
      eq(schema.journalEntries.status, 'POSTED')
    ))
    .groupBy(schema.journalEntries.originalJournalId)
    .having(sql`count(*) > 1`);

    const totalViolations = unbalanced.length + duplicateReversals.length;

    return res.json({
      companyId,
      status: totalViolations > 0 ? 'FAIL' : 'PASS',
      totalPosted,
      violationsCount: totalViolations,
      violations: unbalanced,
      reversalLineageViolationsCount: duplicateReversals.length,
      duplicateReversals
    });
  } catch (error) {
    console.error("Error in integrity check:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to run integrity check" });
  }
});

// Unified Enterprise Export Endpoint (XLSX, CSV, PDF, DOCX, JSON, Audit Evidence ZIP)
router.post("/export", requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const companyRow = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const companyName = companyRow?.legalName || (req.activeCompany as any)?.legalName || "Active Company";
    const generatedBy = req.user?.displayName || req.user?.email || "Authorized User";
    const userRole = (req.activeCompany as any)?.role || "Accountant";

    const {
      format = 'xlsx',
      reportTitle = 'Financial Report',
      subtitle,
      reportPeriod,
      accountingBasis = 'ACCRUAL (PFRS / BIR CAS)',
      currency = 'PHP (₱)',
      appliedFilters,
      sourceTransactionReferences,
      headers = [],
      rows = [],
      totals,
      isSensitive = false,
      filename
    } = req.body;

    const exportOptions: ServerExportOptions = {
      companyId,
      companyName,
      reportTitle,
      subtitle,
      generatedBy,
      reportPeriod: reportPeriod || '2026 Current Period',
      accountingBasis,
      currency,
      appliedFilters,
      sourceTransactionReferences,
      headers: Array.isArray(headers) ? headers : [],
      rows: Array.isArray(rows) ? rows : [],
      totals: Array.isArray(totals) ? totals : undefined,
      isSensitive: Boolean(isSensitive),
      userRole,
      req
    };

    const meta = ExportService.buildAuditMetadata(exportOptions);
    const cleanBase = (filename || reportTitle).replace(/[^a-zA-Z0-9_-]/g, '_');
    const fmt = String(format).toLowerCase();

    res.setHeader('X-Audit-Snapshot-Ref', meta.dataSnapshotRef);
    res.setHeader('X-Audit-Integrity-Hash', meta.integrityHash);

    if (fmt === 'xlsx' || fmt === 'excel') {
      const buf = await ExportService.generateXLSX(exportOptions);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanBase}.xlsx"`);
      return res.send(buf);
    } else if (fmt === 'docx' || fmt === 'word') {
      const buf = await ExportService.generateDOCX(exportOptions);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanBase}_CPA_Memorandum.docx"`);
      return res.send(buf);
    } else if (fmt === 'pdf') {
      const buf = await ExportService.generatePDF(exportOptions);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanBase}.pdf"`);
      return res.send(buf);
    } else if (fmt === 'zip' || fmt === 'evidence-package') {
      const buf = await ExportService.generateAuditEvidencePackageZip(exportOptions);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanBase}_Audit_Evidence_Package.zip"`);
      return res.send(buf);
    } else if (fmt === 'json') {
      const jsonStr = await ExportService.generateJSON(exportOptions);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanBase}.json"`);
      return res.send(jsonStr);
    } else {
      const csvStr = await ExportService.generateCSV(exportOptions);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanBase}.csv"`);
      return res.send(csvStr);
    }
  } catch (err: any) {
    res.status(err.message?.includes('ACCESS_DENIED') ? 403 : 500).json({
      error: "EXPORT_FAILED",
      message: err.message
    });
  }
});

// QuickBooks Online / Desktop Compatible Export (.xlsx multi-sheet workbook)
router.get("/quickbooks/export", requireAuth, requirePermission('reports:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const companyRow = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
    const companyName = companyRow?.legalName || (req.activeCompany as any)?.legalName || "Active Company";

    const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
    const customers = await db.select().from(schema.customers).where(eq(schema.customers.companyId, companyId)).limit(2000);
    const vendors = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId)).limit(2000);
    const journalRows = await db.select({
      journalNo: schema.journalEntries.journalNumber,
      date: schema.journalEntries.entryDate,
      accountCode: schema.accounts.accountCode,
      accountName: schema.accounts.accountName,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
      description: schema.journalLines.description
    })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(eq(schema.journalEntries.companyId, companyId), eq(schema.journalEntries.status, 'POSTED')))
      .limit(5000);

    const buf = ExportService.generateQuickBooksWorkbook({
      companyName,
      accounts: accounts.map(a => ({ code: a.accountCode, name: a.accountName, type: a.accountType })),
      journals: journalRows.map(j => ({
        journalNo: j.journalNo,
        date: j.date,
        accountCode: j.accountCode,
        accountName: j.accountName,
        debit: Number(j.debit || 0),
        credit: Number(j.credit || 0),
        description: j.description || ''
      })),
      customers: customers.map(c => ({ name: c.legalName, tin: c.tin || '', email: c.email || '', phone: c.phone || '' })),
      vendors: vendors.map(v => ({ name: v.legalName, tin: v.tin || '', email: v.email || '', phone: v.phone || '' }))
    });

    const cleanName = companyName.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="QuickBooks_Export_${cleanName}.xlsx"`);
    return res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: "QUICKBOOKS_EXPORT_FAILED", message: err.message });
  }
});

// QuickBooks Online / Desktop Compatible Import Validation & Parser
router.post("/quickbooks/import", requireAuth, requirePermission('accounting:create'), async (req, res) => {
  try {
    const { base64File } = req.body;
    if (!base64File) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "base64File payload is required" });
    }
    const cleanBase64 = String(base64File).replace(/^data:.*?;base64,/, '');
    const buf = Buffer.from(cleanBase64, 'base64');
    const parsed = ExportService.parseQuickBooksImport(buf);

    res.json({
      success: true,
      sheetsDetected: parsed.sheets,
      counts: {
        accounts: parsed.accounts.length,
        journalLines: parsed.journals.length,
        customers: parsed.customers.length,
        vendors: parsed.vendors.length
      },
      preview: {
        accounts: parsed.accounts.slice(0, 10),
        journals: parsed.journals.slice(0, 10),
        customers: parsed.customers.slice(0, 10),
        vendors: parsed.vendors.slice(0, 10)
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: "QUICKBOOKS_IMPORT_PARSE_FAILED", message: err.message });
  }
});

export default router;
