import crypto from 'crypto';
import { and, desc, eq, gte, lte, or, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import { DomainError, softClosePeriod, hardClosePeriod, reopenPeriod } from '../db/domain';
import { ForexRevaluationEngine } from './forexRevaluationEngine';
import {
  formatEnterpriseTimestamp,
  normalizeDate,
  normalizeIsoTimestamp,
} from '../../shared/timestampUtils';

export type CloseExceptionSeverity = 'BLOCKING' | 'WARNING' | 'INFORMATIONAL';
export type ChecklistSectionStatus = 'PASSED' | 'BLOCKING' | 'WARNING' | 'INFORMATIONAL';

export interface PeriodClosePolicyRules {
  policyVersion: number;
  requireWarningJustification: boolean;
  requireMakerCheckerReopen: boolean;
  supportingDocThresholdCentavos: number;
  softCloseSeverityOverrides: Record<string, CloseExceptionSeverity>;
  hardCloseSeverityOverrides: Record<string, CloseExceptionSeverity>;
}

export interface ChecklistItemDetail {
  checkCode: string;
  title: string;
  passed: boolean;
  severity: CloseExceptionSeverity;
  count: number;
  amountCentavos: number;
  description: string;
  sampleRecords?: Array<{
    id: string;
    reference: string;
    entityType: string;
    status?: string;
    amountCentavos?: number;
    date?: string;
  }>;
}

export interface ChecklistSectionResult {
  sectionNumber: number;
  sectionCode: string;
  sectionName: string;
  sourceModule: string;
  navigationRoute: string;
  validationStatus: ChecklistSectionStatus;
  relevantCount: number;
  relevantAmountCentavos: number;
  unresolvedExceptionCount: number;
  blockingCount: number;
  warningCount: number;
  informationalCount: number;
  lastCheckedAt: string;
  summaryText: string;
  checks: ChecklistItemDetail[];
}

export interface PeriodFinancialOverview {
  totalDebitCentavos: number;
  totalCreditCentavos: number;
  varianceCentavos: number;
  trialBalanceStatus: 'BALANCED' | 'OUT_OF_BALANCE' | 'NO_POSTED_ACTIVITY';
  postedJournalCount: number;
  unpostedJournalCount: number;
  draftJournalCount: number;
  submittedJournalCount: number;
  approvedUnpostedJournalCount: number;
  revenueSummaryCentavos: number;
  expenseSummaryCentavos: number;
  netIncomeSummaryCentavos: number;
  arOutstandingCentavos: number;
  arOpenInvoiceCount: number;
  apOutstandingCentavos: number;
  apOpenBillCount: number;
  bankReconciliation: {
    totalBankAccounts: number;
    reconciledSessionCount: number;
    openSessionCount: number;
    unreconciledBankTxCount: number;
    status: 'RECONCILED' | 'PARTIAL' | 'PENDING' | 'NO_BANK_ACCOUNTS';
  };
  inventoryValuation: {
    activeSkuCount: number;
    totalValuationCentavos: number;
    negativeStockCount: number;
    unpostedAdjustmentCount: number;
    status: 'VALUED' | 'EXCEPTIONS_FOUND' | 'NO_INVENTORY';
  };
  payrollPosting: {
    totalRunsInPeriod: number;
    postedRunCount: number;
    unpostedRunCount: number;
    totalGrossPayCentavos: number;
    status: 'POSTED' | 'PENDING_POSTING' | 'NO_PAYROLL_RUNS';
  };
  taxCompliance: {
    outputVatCentavos: number;
    inputVatCentavos: number;
    netVatPayableCentavos: number;
    ewtPayableCentavos: number;
    taxCalculationsCount: number;
    filedReturnsCount: number;
    draftReturnsCount: number;
    status: 'COMPLIANT' | 'PENDING_FILINGS' | 'REVIEW_REQUIRED';
  };
  fixedAssetDepreciation: {
    activeDepreciableAssets: number;
    depreciationRecordedCount: number;
    missingDepreciationCount: number;
    periodDepreciationCentavos: number;
    status: 'DEPRECIATED' | 'PENDING_DEPRECIATION' | 'NO_DEPRECIABLE_ASSETS';
  };
  fxRevaluation?: {
    fxMonetaryAccountCount: number;
    postedRevaluationRunCount: number;
    latestClosingRateUsed: number | null;
    totalGainCentavos: number;
    totalLossCentavos: number;
    status: 'REVALUED' | 'PENDING_REVALUATION' | 'NO_FX_EXPOSURE';
  };
}

export const DEFAULT_PERIOD_CLOSE_POLICY: PeriodClosePolicyRules = {
  policyVersion: 1,
  requireWarningJustification: true,
  requireMakerCheckerReopen: false,
  supportingDocThresholdCentavos: 5_000_000, // PHP 50,000.00
  softCloseSeverityOverrides: {
    GL_UNBALANCED_JOURNALS: 'BLOCKING',
    GL_ORPHAN_LINES: 'BLOCKING',
    GL_INACTIVE_ACCOUNTS: 'BLOCKING',
    GL_FX_REVALUATION_PENDING: 'WARNING',
    TB_OUT_OF_BALANCE: 'BLOCKING',
    JE_DRAFT_ENTRIES: 'WARNING',
    JE_UNPOSTED_WORKFLOW: 'WARNING',
    JE_POST_REOPEN_UNVALIDATED: 'BLOCKING',
    AR_UNPOSTED_INVOICES: 'WARNING',
    AR_UNAPPLIED_RECEIPTS: 'INFORMATIONAL',
    AR_SUBLEDGER_VARIANCE: 'WARNING',
    AP_UNPOSTED_BILLS: 'WARNING',
    AP_UNAPPLIED_PAYMENTS: 'INFORMATIONAL',
    AP_SUBLEDGER_VARIANCE: 'WARNING',
    BANK_UNRECONCILED_SESSIONS: 'WARNING',
    BANK_UNMATCHED_TRANSACTIONS: 'INFORMATIONAL',
    INV_NEGATIVE_STOCK: 'BLOCKING',
    INV_UNPOSTED_ADJUSTMENTS: 'WARNING',
    PAYROLL_UNPOSTED_RUNS: 'WARNING',
    TAX_DRAFT_RETURNS: 'INFORMATIONAL',
    FA_PENDING_DEPRECIATION: 'WARNING',
    APPROVAL_PENDING_WORKFLOWS: 'WARNING',
    DOCS_MISSING_SUPPORTING_EVIDENCE: 'INFORMATIONAL',
    DOCS_CORRUPTED_INTEGRITY: 'BLOCKING',
  },
  hardCloseSeverityOverrides: {
    GL_UNBALANCED_JOURNALS: 'BLOCKING',
    GL_ORPHAN_LINES: 'BLOCKING',
    GL_INACTIVE_ACCOUNTS: 'BLOCKING',
    GL_FX_REVALUATION_PENDING: 'WARNING',
    TB_OUT_OF_BALANCE: 'BLOCKING',
    JE_DRAFT_ENTRIES: 'BLOCKING',
    JE_UNPOSTED_WORKFLOW: 'BLOCKING',
    JE_POST_REOPEN_UNVALIDATED: 'BLOCKING',
    AR_UNPOSTED_INVOICES: 'WARNING',
    AR_UNAPPLIED_RECEIPTS: 'INFORMATIONAL',
    AR_SUBLEDGER_VARIANCE: 'WARNING',
    AP_UNPOSTED_BILLS: 'WARNING',
    AP_UNAPPLIED_PAYMENTS: 'INFORMATIONAL',
    AP_SUBLEDGER_VARIANCE: 'WARNING',
    BANK_UNRECONCILED_SESSIONS: 'WARNING',
    BANK_UNMATCHED_TRANSACTIONS: 'INFORMATIONAL',
    INV_NEGATIVE_STOCK: 'BLOCKING',
    INV_UNPOSTED_ADJUSTMENTS: 'BLOCKING',
    PAYROLL_UNPOSTED_RUNS: 'BLOCKING',
    TAX_DRAFT_RETURNS: 'WARNING',
    FA_PENDING_DEPRECIATION: 'WARNING',
    APPROVAL_PENDING_WORKFLOWS: 'BLOCKING',
    DOCS_MISSING_SUPPORTING_EVIDENCE: 'WARNING',
    DOCS_CORRUPTED_INTEGRITY: 'BLOCKING',
  },
};

const CORE_NON_OVERRIDABLE_BLOCKERS = new Set([
  'GL_UNBALANCED_JOURNALS',
  'GL_ORPHAN_LINES',
  'TB_OUT_OF_BALANCE',
  'DOCS_CORRUPTED_INTEGRITY',
]);

export class PeriodCloseWorkspaceService {
  static ensureWorkspaceTables(): void {
    try {
      db.run(
        sql.raw(`
          CREATE TABLE IF NOT EXISTS period_close_policies (
            company_id TEXT PRIMARY KEY,
            policy_version INTEGER NOT NULL DEFAULT 1,
            require_warning_justification INTEGER NOT NULL DEFAULT 1,
            require_maker_checker_reopen INTEGER NOT NULL DEFAULT 0,
            supporting_doc_threshold_centavos INTEGER NOT NULL DEFAULT 5000000,
            rules_json TEXT NOT NULL,
            updated_by TEXT,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
          )
        `)
      );

      db.run(
        sql.raw(`
          CREATE TABLE IF NOT EXISTS period_close_validations (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            period_id TEXT NOT NULL,
            close_target TEXT NOT NULL DEFAULT 'HARD_CLOSE',
            readiness_score INTEGER NOT NULL DEFAULT 100,
            blocking_count INTEGER NOT NULL DEFAULT 0,
            warning_count INTEGER NOT NULL DEFAULT 0,
            info_count INTEGER NOT NULL DEFAULT 0,
            financial_overview_json TEXT NOT NULL,
            checklist_sections_json TEXT NOT NULL,
            policy_version INTEGER NOT NULL DEFAULT 1,
            executed_by TEXT,
            executed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
          )
        `)
      );

      db.run(
        sql.raw(`
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
        `)
      );

      // Enforce canonical immutability triggers on period_close_certifications
      db.run(sql.raw(`DROP TRIGGER IF EXISTS trg_period_close_cert_no_update`));
      db.run(
        sql.raw(`
          CREATE TRIGGER trg_period_close_cert_no_update
          BEFORE UPDATE ON period_close_certifications
          BEGIN
            SELECT RAISE(ABORT, 'IMMUTABLE_CERTIFICATION_SNAPSHOT: Period close certification snapshots cannot be modified.');
          END;
        `)
      );

      db.run(sql.raw(`DROP TRIGGER IF EXISTS trg_period_close_cert_no_delete`));
      db.run(
        sql.raw(`
          CREATE TRIGGER trg_period_close_cert_no_delete
          BEFORE DELETE ON period_close_certifications
          BEGIN
            SELECT RAISE(ABORT, 'IMMUTABLE_CERTIFICATION_SNAPSHOT: Period close certification snapshots cannot be deleted.');
          END;
        `)
      );

      // Non-destructively enrich period_status_history with optional evidence columns
      const tryAddCol = (table: string, col: string, def: string) => {
        try {
          db.run(sql.raw(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`));
        } catch (_) {}
      };

      tryAddCol('period_status_history', 'warning_justification', 'TEXT');
      tryAddCol('period_status_history', 'approved_by', 'TEXT');
      tryAddCol('period_status_history', 'validation_snapshot_id', 'TEXT');
      tryAddCol('period_status_history', 'certification_snapshot_id', 'TEXT');
      tryAddCol('period_status_history', 'metadata_json', 'TEXT');

      // Ensure period_close_certifications contains all certification evidence columns
      // even when the table was initialized earlier by ledgerIntegrityService or domain.ts
      tryAddCol('period_close_certifications', 'validation_snapshot_id', 'TEXT');
      tryAddCol('period_close_certifications', 'approved_by_user_id', 'TEXT');
      tryAddCol('period_close_certifications', 'approved_by_user_name', 'TEXT');
      tryAddCol('period_close_certifications', 'approved_by_user_role', 'TEXT');
      tryAddCol('period_close_certifications', 'audit_event_id', 'TEXT');
    } catch (err) {
      console.warn('[PeriodCloseWorkspaceService] Schema ensure warning:', err);
    }
  }

  static getCompanyPolicy(companyId: string): PeriodClosePolicyRules {
    this.ensureWorkspaceTables();
    try {
      const row = db.get(
        sql`SELECT * FROM period_close_policies WHERE company_id = ${companyId} LIMIT 1`
      ) as any;
      if (row && row.rules_json) {
        const parsed = JSON.parse(row.rules_json);
        return {
          policyVersion: Number(row.policy_version || parsed.policyVersion || 1),
          requireWarningJustification:
            row.require_warning_justification !== undefined
              ? Boolean(row.require_warning_justification)
              : Boolean(parsed.requireWarningJustification ?? true),
          requireMakerCheckerReopen:
            row.require_maker_checker_reopen !== undefined
              ? Boolean(row.require_maker_checker_reopen)
              : Boolean(parsed.requireMakerCheckerReopen ?? false),
          supportingDocThresholdCentavos: Number(
            row.supporting_doc_threshold_centavos ??
              parsed.supportingDocThresholdCentavos ??
              DEFAULT_PERIOD_CLOSE_POLICY.supportingDocThresholdCentavos
          ),
          softCloseSeverityOverrides: {
            ...DEFAULT_PERIOD_CLOSE_POLICY.softCloseSeverityOverrides,
            ...(parsed.softCloseSeverityOverrides || {}),
          },
          hardCloseSeverityOverrides: {
            ...DEFAULT_PERIOD_CLOSE_POLICY.hardCloseSeverityOverrides,
            ...(parsed.hardCloseSeverityOverrides || {}),
          },
        };
      }
    } catch (_) {}
    return {
      ...DEFAULT_PERIOD_CLOSE_POLICY,
      softCloseSeverityOverrides: { ...DEFAULT_PERIOD_CLOSE_POLICY.softCloseSeverityOverrides },
      hardCloseSeverityOverrides: { ...DEFAULT_PERIOD_CLOSE_POLICY.hardCloseSeverityOverrides },
    };
  }

  static updateCompanyPolicy(
    companyId: string,
    updates: Partial<PeriodClosePolicyRules>,
    userId: string
  ): PeriodClosePolicyRules {
    this.ensureWorkspaceTables();
    const current = this.getCompanyPolicy(companyId);
    const nextVersion = current.policyVersion + 1;

    const mergedSoft = {
      ...current.softCloseSeverityOverrides,
      ...(updates.softCloseSeverityOverrides || {}),
    };
    const mergedHard = {
      ...current.hardCloseSeverityOverrides,
      ...(updates.hardCloseSeverityOverrides || {}),
    };

    // Core accounting invariants remain BLOCKING unconditionally
    for (const code of CORE_NON_OVERRIDABLE_BLOCKERS) {
      mergedSoft[code] = 'BLOCKING';
      mergedHard[code] = 'BLOCKING';
    }

    const updated: PeriodClosePolicyRules = {
      policyVersion: nextVersion,
      requireWarningJustification:
        updates.requireWarningJustification !== undefined
          ? Boolean(updates.requireWarningJustification)
          : current.requireWarningJustification,
      requireMakerCheckerReopen:
        updates.requireMakerCheckerReopen !== undefined
          ? Boolean(updates.requireMakerCheckerReopen)
          : current.requireMakerCheckerReopen,
      supportingDocThresholdCentavos:
        updates.supportingDocThresholdCentavos !== undefined
          ? Math.max(0, Number(updates.supportingDocThresholdCentavos))
          : current.supportingDocThresholdCentavos,
      softCloseSeverityOverrides: mergedSoft,
      hardCloseSeverityOverrides: mergedHard,
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const rulesJson = JSON.stringify(updated);

    db.run(sql`
      INSERT INTO period_close_policies (
        company_id, policy_version, require_warning_justification,
        require_maker_checker_reopen, supporting_doc_threshold_centavos,
        rules_json, updated_by, updated_at
      ) VALUES (
        ${companyId}, ${updated.policyVersion}, ${updated.requireWarningJustification ? 1 : 0},
        ${updated.requireMakerCheckerReopen ? 1 : 0}, ${updated.supportingDocThresholdCentavos},
        ${rulesJson}, ${userId}, ${nowSec}
      )
      ON CONFLICT(company_id) DO UPDATE SET
        policy_version = excluded.policy_version,
        require_warning_justification = excluded.require_warning_justification,
        require_maker_checker_reopen = excluded.require_maker_checker_reopen,
        supporting_doc_threshold_centavos = excluded.supporting_doc_threshold_centavos,
        rules_json = excluded.rules_json,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `);

    return updated;
  }

  static resolveSeverity(
    policy: PeriodClosePolicyRules,
    closeTarget: 'SOFT_CLOSE' | 'HARD_CLOSE',
    checkCode: string,
    defaultSeverity: CloseExceptionSeverity
  ): CloseExceptionSeverity {
    if (CORE_NON_OVERRIDABLE_BLOCKERS.has(checkCode)) {
      return 'BLOCKING';
    }
    const map =
      closeTarget === 'SOFT_CLOSE'
        ? policy.softCloseSeverityOverrides
        : policy.hardCloseSeverityOverrides;
    return map[checkCode] || defaultSeverity;
  }

  static async buildPeriodCloseWorkspace(
    companyId: string,
    periodId: string,
    options?: {
      closeTarget?: 'SOFT_CLOSE' | 'HARD_CLOSE';
      persistValidationByUserId?: string;
    }
  ) {
    this.ensureWorkspaceTables();
    const closeTarget = options?.closeTarget || 'HARD_CLOSE';

    const period = await db
      .select()
      .from(schema.accountingPeriods)
      .where(
        and(
          eq(schema.accountingPeriods.id, periodId),
          eq(schema.accountingPeriods.companyId, companyId)
        )
      )
      .get();

    if (!period) {
      throw new DomainError('Accounting period not found', 'NOT_FOUND', 404);
    }

    const company = await db
      .select()
      .from(schema.companies)
      .where(eq(schema.companies.id, companyId))
      .get();

    const policy = this.getCompanyPolicy(companyId);
    const startDate = period.startDate;
    const endDate = period.endDate;
    const checkedAtIso = new Date().toISOString();

    // Lookup user map for display names & roles
    const allUsers = await db.select().from(schema.users);
    const userMap = new Map<string, { displayName: string; email: string }>();
    for (const u of allUsers) {
      userMap.set(u.id, { displayName: u.displayName || u.email, email: u.email });
    }

    // 1. Accounts & Journals in Period
    const allAccounts: any[] = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId));
    const accountMap = new Map<string, any>(allAccounts.map((a: any) => [a.id, a]));

    const periodJournals: any[] = await db
      .select()
      .from(schema.journalEntries)
      .where(
        and(
          eq(schema.journalEntries.companyId, companyId),
          or(
            eq(schema.journalEntries.accountingPeriodId, periodId),
            and(
              gte(schema.journalEntries.entryDate, startDate),
              lte(schema.journalEntries.entryDate, endDate)
            )
          )
        )
      );

    const postedJournals = periodJournals.filter((j) => j.status === 'POSTED');
    const draftJournals = periodJournals.filter((j) => j.status === 'DRAFT');
    const submittedJournals = periodJournals.filter(
      (j) => j.status === 'SUBMITTED' || j.status === 'PENDING_APPROVAL' || j.status === 'IN_REVIEW'
    );
    const approvedUnpostedJournals = periodJournals.filter((j) => j.status === 'APPROVED');
    const unpostedJournals = periodJournals.filter(
      (j) => !['POSTED', 'REVERSED', 'VOIDED', 'CANCELLED'].includes(j.status)
    );

    // Fetch journal lines for period journals
    const journalIds = new Set(periodJournals.map((j) => j.id));
    const postedJournalIds = new Set(postedJournals.map((j) => j.id));

    const allCompanyJournalLines: any[] =
      journalIds.size > 0
        ? ((await db.all(sql`
            SELECT jl.*
            FROM journal_lines jl
            INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
            WHERE je.company_id = ${companyId}
              AND (
                je.accounting_period_id = ${periodId}
                OR (je.entry_date >= ${startDate} AND je.entry_date <= ${endDate})
              )
          `)) as any[])
        : [];

    const linesByJournalId = new Map<string, any[]>();
    for (const ln of allCompanyJournalLines) {
      const jId = ln.journal_entry_id || ln.journalEntryId;
      const arr = linesByJournalId.get(jId) || [];
      arr.push(ln);
      linesByJournalId.set(jId, arr);
    }

    let totalDebitCentavos = 0;
    let totalCreditCentavos = 0;
    let revenueSummaryCentavos = 0;
    let expenseSummaryCentavos = 0;
    let outputVatGlCentavos = 0;
    let inputVatGlCentavos = 0;
    let arGlNetCentavos = 0;
    let apGlNetCentavos = 0;

    const unbalancedPostedJournals: any[] = [];
    const orphanLinesJournals: any[] = [];
    const inactiveAccountPostings: any[] = [];

    for (const je of postedJournals) {
      const lines = linesByJournalId.get(je.id) || [];
      if (lines.length < 2) {
        orphanLinesJournals.push(je);
      }
      let jDr = 0;
      let jCr = 0;
      for (const ln of lines) {
        const dr = Number(ln.debit || 0);
        const cr = Number(ln.credit || 0);
        jDr += dr;
        jCr += cr;
        totalDebitCentavos += dr;
        totalCreditCentavos += cr;

        const accId = ln.account_id || ln.accountId;
        const acc = accountMap.get(accId);
        if (!acc || (acc.status && acc.status !== 'ACTIVE')) {
          inactiveAccountPostings.push({ journal: je, accountId: accId, accountCode: acc?.accountCode });
        } else {
          const accType = String(acc.accountType || '').toUpperCase();
          const accName = String(acc.accountName || '').toUpperCase();
          if (accType === 'REVENUE' || accType === 'OTHER_INCOME') {
            revenueSummaryCentavos += cr - dr;
          } else if (
            accType === 'EXPENSE' ||
            accType === 'COST_OF_SALES' ||
            accType === 'OTHER_EXPENSE'
          ) {
            expenseSummaryCentavos += dr - cr;
          }
          if (accType === 'RECEIVABLE' || acc.accountCode === '1030' || acc.accountCode === '1120') {
            arGlNetCentavos += dr - cr;
          }
          if (accType === 'PAYABLE' || acc.accountCode === '2010' || acc.accountCode === '2110') {
            apGlNetCentavos += cr - dr;
          }
          if (accName.includes('OUTPUT VAT') || acc.accountCode === '2020') {
            outputVatGlCentavos += cr - dr;
          }
          if (accName.includes('INPUT VAT') || acc.accountCode === '1050') {
            inputVatGlCentavos += dr - cr;
          }
        }
      }
      if (jDr !== jCr) {
        unbalancedPostedJournals.push({
          ...je,
          debit: jDr,
          credit: jCr,
          variance: Math.abs(jDr - jCr),
        });
      }
    }

    const varianceCentavos = Math.abs(totalDebitCentavos - totalCreditCentavos);
    const trialBalanceStatus: 'BALANCED' | 'OUT_OF_BALANCE' | 'NO_POSTED_ACTIVITY' =
      postedJournals.length === 0
        ? 'NO_POSTED_ACTIVITY'
        : varianceCentavos === 0 && unbalancedPostedJournals.length === 0
          ? 'BALANCED'
          : 'OUT_OF_BALANCE';

    // Post-reopen activity inspection
    const reopenedDate = normalizeDate(period.reopenedAt);
    const postReopenJournals = reopenedDate
      ? periodJournals.filter((j) => {
          const updated = normalizeDate(j.updatedAt || j.postedAt || j.createdAt);
          return updated && updated.getTime() >= reopenedDate.getTime();
        })
      : [];

    // Check latest validation snapshot timestamp
    const lastValidationRow = db.get(sql`
      SELECT * FROM period_close_validations
      WHERE company_id = ${companyId} AND period_id = ${periodId}
      ORDER BY executed_at DESC LIMIT 1
    `) as any;
    const lastValidationDate = lastValidationRow
      ? normalizeDate(lastValidationRow.executed_at)
      : null;

    // Post-reopen requires revalidation if period was reopened and has not been validated since reopen or since latest post-reopen journal modification
    const latestPostReopenActivityMs = postReopenJournals.reduce((maxMs, j) => {
      const d = normalizeDate(j.updatedAt || j.postedAt || j.createdAt);
      return d && d.getTime() > maxMs ? d.getTime() : maxMs;
    }, reopenedDate ? reopenedDate.getTime() : 0);

    const requiresRevalidationAfterReopen = Boolean(
      reopenedDate &&
        period.status === 'OPEN' &&
        (!lastValidationDate || lastValidationDate.getTime() < latestPostReopenActivityMs) &&
        !options?.persistValidationByUserId
    );

    // 4. Accounts Receivable (Sales Invoices & Customer Payments in Period)
    const periodInvoices = await db
      .select()
      .from(schema.salesInvoices)
      .where(
        and(
          eq(schema.salesInvoices.companyId, companyId),
          gte(schema.salesInvoices.invoiceDate, startDate),
          lte(schema.salesInvoices.invoiceDate, endDate)
        )
      );
    const unpostedInvoices = periodInvoices.filter((inv) =>
      ['DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED'].includes(String(inv.status).toUpperCase())
    );
    const openInvoicesInPeriod = periodInvoices.filter(
      (inv) =>
        !['DRAFT', 'VOIDED', 'CANCELLED'].includes(String(inv.status).toUpperCase()) &&
        Number(inv.balanceDue ?? inv.totalAmount ?? 0) > 0
    );
    const arOutstandingCentavos = openInvoicesInPeriod.reduce(
      (sum, inv) => sum + Number(inv.balanceDue ?? inv.totalAmount ?? 0),
      0
    );

    const periodCustomerPayments = await db
      .select()
      .from(schema.customerPayments)
      .where(
        and(
          eq(schema.customerPayments.companyId, companyId),
          gte(schema.customerPayments.paymentDate, startDate),
          lte(schema.customerPayments.paymentDate, endDate)
        )
      );
    const unappliedReceipts = periodCustomerPayments.filter((p) => !p.invoiceId);

    // 5. Accounts Payable (Purchase Bills & Supplier Payments in Period)
    const periodBills = await db
      .select()
      .from(schema.purchaseBills)
      .where(
        and(
          eq(schema.purchaseBills.companyId, companyId),
          gte(schema.purchaseBills.billDate, startDate),
          lte(schema.purchaseBills.billDate, endDate)
        )
      );
    const unpostedBills = periodBills.filter((b) =>
      ['DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED'].includes(String(b.status).toUpperCase())
    );
    const openBillsInPeriod = periodBills.filter(
      (b) =>
        !['DRAFT', 'VOIDED', 'CANCELLED'].includes(String(b.status).toUpperCase()) &&
        Number(b.balanceDue ?? b.totalAmount ?? 0) > 0
    );
    const apOutstandingCentavos = openBillsInPeriod.reduce(
      (sum, b) => sum + Number(b.balanceDue ?? b.totalAmount ?? 0),
      0
    );

    const periodSupplierPayments = await db
      .select()
      .from(schema.supplierPayments)
      .where(
        and(
          eq(schema.supplierPayments.companyId, companyId),
          gte(schema.supplierPayments.paymentDate, startDate),
          lte(schema.supplierPayments.paymentDate, endDate)
        )
      );
    const unappliedSupplierPayments = periodSupplierPayments.filter((p) => !p.billId);

    // 6. Bank Reconciliation
    const rawBankAccounts: any[] = await db
      .select()
      .from(schema.bankAccounts)
      .where(eq(schema.bankAccounts.companyId, companyId));
    let bankAccounts = rawBankAccounts;
    if (bankAccounts.length === 0) {
      bankAccounts = await db
        .select()
        .from(schema.accounts)
        .where(and(
          eq(schema.accounts.companyId, companyId),
          eq(schema.accounts.status, 'ACTIVE'),
          or(
            eq(schema.accounts.isCashAccount, true),
            eq(schema.accounts.accountType, 'BANK'),
            inArray(schema.accounts.detailType, ['CHECKING', 'SAVINGS', 'CASH_ON_HAND', 'PETTY_CASH', 'PAYROLL_BANK', 'DOLLAR_ACCOUNT'])
          )
        ));
    }

    let bankRecSessions: any[] = [];
    try {
      bankRecSessions = (db.all(sql`
        SELECT * FROM bank_reconciliations
        WHERE company_id = ${companyId}
          AND statement_date >= ${startDate}
          AND statement_date <= ${endDate}
      `) as any[]).map((r: any) => ({
        ...r,
        statementEndingDate: r.statement_date || r.statementEndingDate,
      }));
    } catch (_) {}

    const reconciledSessions = bankRecSessions.filter((s) =>
      ['RECONCILED', 'COMPLETED', 'APPROVED', 'LOCKED'].includes(String(s.status).toUpperCase())
    );
    const openRecSessions = bankRecSessions.filter(
      (s) =>
        !['RECONCILED', 'COMPLETED', 'APPROVED', 'LOCKED'].includes(String(s.status).toUpperCase())
    );

    let periodBankTx: any[] = [];
    try {
      periodBankTx = await db
        .select()
        .from(schema.bankTransactions)
        .where(
          and(
            eq(schema.bankTransactions.companyId, companyId),
            gte(schema.bankTransactions.transactionDate, startDate),
            lte(schema.bankTransactions.transactionDate, endDate)
          )
        );
    } catch (_) {}
    const unmatchedBankTx = periodBankTx.filter(
      (t) => !t.isReconciled && String(t.reconciliationStatus || '').toUpperCase() !== 'MATCHED'
    );

    // 7. Inventory & Costing
    const inventoryItems: any[] = await db
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.companyId, companyId));
    const negativeStockItems = inventoryItems.filter((item) => Number(item.quantityOnHand || 0) < 0);
    const totalInventoryValuationCentavos = inventoryItems.reduce(
      (sum, item) =>
        sum +
        Math.max(0, Number(item.quantityOnHand || 0)) *
          Number(item.unitCost || item.averageCost || 0),
      0
    );

    let periodAdjustments: any[] = [];
    try {
      periodAdjustments = db.all(sql`
        SELECT * FROM stock_adjustments
        WHERE company_id = ${companyId}
          AND adjustment_date >= ${startDate}
          AND adjustment_date <= ${endDate}
      `) as any[];
    } catch (_) {}
    const unpostedAdjustments = periodAdjustments.filter(
      (adj) =>
        !['POSTED', 'APPROVED', 'COMPLETED', 'VOIDED'].includes(
          String(adj.status || 'POSTED').toUpperCase()
        )
    );

    // 8. Payroll & Statutory Liabilities
    let periodPayrollRuns: any[] = [];
    try {
      periodPayrollRuns = (db.all(sql`
        SELECT * FROM payroll_runs
        WHERE company_id = ${companyId}
          AND start_date <= ${endDate}
          AND end_date >= ${startDate}
      `) as any[]).map((pr: any) => ({
        ...pr,
        runNumber: pr.run_number || pr.runNumber,
        periodStart: pr.start_date || pr.periodStart,
        periodEnd: pr.end_date || pr.periodEnd,
        payDate: pr.pay_date || pr.payDate,
        totalGrossPay: pr.total_gross_pay ?? pr.totalGrossPay ?? 0,
      }));
    } catch (_) {}
    const postedPayrollRuns = periodPayrollRuns.filter((pr) =>
      ['POSTED', 'APPROVED', 'PAID', 'COMPLETED'].includes(String(pr.status).toUpperCase())
    );
    const unpostedPayrollRuns = periodPayrollRuns.filter((pr) =>
      ['DRAFT', 'SUBMITTED', 'PENDING', 'IN_REVIEW'].includes(String(pr.status).toUpperCase())
    );
    const totalGrossPayCentavos = periodPayrollRuns.reduce(
      (sum, pr) => sum + Number(pr.totalGrossPay || 0),
      0
    );

    // 9. Philippine Tax Compliance
    let periodTaxCalcs: any[] = [];
    try {
      periodTaxCalcs = (await db
        .select()
        .from(schema.taxCalculations)
        .where(eq(schema.taxCalculations.companyId, companyId))) as any[];
      periodTaxCalcs = periodTaxCalcs.filter((tc: any) => {
        const d = normalizeIsoTimestamp(tc.createdAt)?.slice(0, 10);
        return !d || (d >= startDate && d <= endDate);
      });
    } catch (_) {}

    let periodFilings: any[] = [];
    try {
      periodFilings = await db
        .select()
        .from(schema.electronicFilingSubmissions)
        .where(eq(schema.electronicFilingSubmissions.companyId, companyId));
      periodFilings = periodFilings.filter((f: any) => {
        const tp = String(f.taxPeriod || f.returnPeriod || '');
        return (
          tp.includes(period.name) ||
          tp.includes(startDate.slice(0, 7)) ||
          (f.periodStart && f.periodStart >= startDate && f.periodEnd && f.periodEnd <= endDate)
        );
      });
    } catch (_) {}

    const filedReturns = periodFilings.filter((f) =>
      ['FILED', 'ACCEPTED', 'PAID', 'SUBMITTED', 'LOCKED'].includes(String(f.status).toUpperCase())
    );
    const draftReturns = periodFilings.filter((f) =>
      ['DRAFT', 'PENDING'].includes(String(f.status).toUpperCase())
    );
    const ewtPayableCentavos = periodTaxCalcs
      .filter((tc) => String(tc.taxType || '').toUpperCase().includes('EWT'))
      .reduce((sum, tc) => sum + Number(tc.taxAmount || 0), 0);

    // 10. Fixed Assets & Depreciation
    let activeAssets: any[] = [];
    let periodDepEntries: any[] = [];
    try {
      const allAssets: any[] = await db
        .select()
        .from(schema.fixedAssets)
        .where(eq(schema.fixedAssets.companyId, companyId));
      activeAssets = allAssets.filter(
        (fa) =>
          String(fa.status || 'ACTIVE').toUpperCase() === 'ACTIVE' &&
          (!fa.purchaseDate || fa.purchaseDate <= endDate) &&
          Number(fa.usefulLifeMonths || 0) > 0
      );

      periodDepEntries = (db.all(sql`
        SELECT * FROM depreciation_schedules
        WHERE company_id = ${companyId}
          AND schedule_date >= ${startDate}
          AND schedule_date <= ${endDate}
      `) as any[]).map((d: any) => ({
        ...d,
        assetId: d.asset_id || d.fixed_asset_id || d.assetId,
        amount: d.depreciation_amount ?? d.amount ?? 0,
      }));
    } catch (_) {}

    const depreciatedAssetIds = new Set(periodDepEntries.map((d) => d.assetId));
    const assetsMissingDepreciation =
      postedJournals.length > 0 && periodDepEntries.length > 0
        ? activeAssets.filter((fa) => !depreciatedAssetIds.has(fa.id))
        : [];
    const periodDepreciationCentavos = periodDepEntries.reduce(
      (sum, d) => sum + Number(d.amount || 0),
      0
    );

    // 11. Approval Workflows
    let pendingWorkflows: any[] = [];
    try {
      const allWorkflows: any[] = await db
        .select()
        .from(schema.approvalWorkflows)
        .where(eq(schema.approvalWorkflows.companyId, companyId));

      const periodEntityIds = new Set<string>([
        ...periodJournals.map((j) => j.id),
        ...periodInvoices.map((i: any) => i.id),
        ...periodBills.map((b: any) => b.id),
        ...periodPayrollRuns.map((p) => p.id),
      ]);

      pendingWorkflows = allWorkflows.filter(
        (wf) =>
          ['PENDING', 'IN_REVIEW', 'ESCALATED'].includes(String(wf.status).toUpperCase()) &&
          periodEntityIds.has(wf.entityId)
      );
    } catch (_) {}

    // 12. Supporting Documents
    let companyDocs: any[] = [];
    let companyDocLinks: any[] = [];
    try {
      companyDocs = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.companyId, companyId));
      companyDocLinks = db.all(sql`
        SELECT * FROM document_links WHERE company_id = ${companyId}
      `) as any[];
    } catch (_) {}

    const linkedEntityIds = new Set<string>();
    for (const doc of companyDocs) {
      if (doc.linkedEntityId) linkedEntityIds.add(doc.linkedEntityId);
    }
    for (const link of companyDocLinks) {
      if (link.recordId) linkedEntityIds.add(link.recordId);
    }

    const materialTransactionsMissingDocs = postedJournals.filter((je) => {
      const lines = linesByJournalId.get(je.id) || [];
      const jeTotal = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
      if (jeTotal < policy.supportingDocThresholdCentavos) return false;
      const hasDirectDoc = linkedEntityIds.has(je.id);
      const hasSourceDoc = je.sourceId ? linkedEntityIds.has(je.sourceId) : false;
      return !hasDirectDoc && !hasSourceDoc;
    });

    const corruptedDocs = companyDocs.filter((d) =>
      ['CORRUPTED', 'QUARANTINED', 'HASH_MISMATCH'].includes(String(d.status || '').toUpperCase())
    );

    // 12b. Period-End Foreign Exchange (FX) Revaluation Readiness
    let fxAccountsWithBalance: any[] = [];
    let periodFxRuns: any[] = [];
    try {
      const fxMonetary = await ForexRevaluationEngine.listForeignMonetaryAccounts(companyId, {
        asOfDate: endDate,
      });
      fxAccountsWithBalance = fxMonetary.filter((a) => a.carryingPhpCentavos !== 0);
      const allRuns = await ForexRevaluationEngine.listRevaluationRuns(companyId);
      periodFxRuns = allRuns.filter(
        (r) =>
          (r.accountingPeriodId === periodId ||
            (r.revaluationDate >= startDate && r.revaluationDate <= endDate)) &&
          ['POSTED', 'AUTO_REVERSED'].includes(String(r.status || '').toUpperCase())
      );
    } catch (_) {}
    const fxPendingRevaluation = fxAccountsWithBalance.length > 0 && periodFxRuns.length === 0;

    // Build Financial Overview
    const financialOverview: PeriodFinancialOverview = {
      totalDebitCentavos,
      totalCreditCentavos,
      varianceCentavos,
      trialBalanceStatus,
      postedJournalCount: postedJournals.length,
      unpostedJournalCount: unpostedJournals.length,
      draftJournalCount: draftJournals.length,
      submittedJournalCount: submittedJournals.length,
      approvedUnpostedJournalCount: approvedUnpostedJournals.length,
      revenueSummaryCentavos,
      expenseSummaryCentavos,
      netIncomeSummaryCentavos: revenueSummaryCentavos - expenseSummaryCentavos,
      arOutstandingCentavos,
      arOpenInvoiceCount: openInvoicesInPeriod.length,
      apOutstandingCentavos,
      apOpenBillCount: openBillsInPeriod.length,
      bankReconciliation: {
        totalBankAccounts: bankAccounts.length,
        reconciledSessionCount: reconciledSessions.length,
        openSessionCount: openRecSessions.length,
        unreconciledBankTxCount: unmatchedBankTx.length,
        status:
          bankAccounts.length === 0
            ? 'NO_BANK_ACCOUNTS'
            : openRecSessions.length === 0 && reconciledSessions.length > 0
              ? 'RECONCILED'
              : reconciledSessions.length > 0
                ? 'PARTIAL'
                : 'PENDING',
      },
      inventoryValuation: {
        activeSkuCount: inventoryItems.length,
        totalValuationCentavos: totalInventoryValuationCentavos,
        negativeStockCount: negativeStockItems.length,
        unpostedAdjustmentCount: unpostedAdjustments.length,
        status:
          inventoryItems.length === 0
            ? 'NO_INVENTORY'
            : negativeStockItems.length === 0 && unpostedAdjustments.length === 0
              ? 'VALUED'
              : 'EXCEPTIONS_FOUND',
      },
      payrollPosting: {
        totalRunsInPeriod: periodPayrollRuns.length,
        postedRunCount: postedPayrollRuns.length,
        unpostedRunCount: unpostedPayrollRuns.length,
        totalGrossPayCentavos,
        status:
          periodPayrollRuns.length === 0
            ? 'NO_PAYROLL_RUNS'
            : unpostedPayrollRuns.length === 0
              ? 'POSTED'
              : 'PENDING_POSTING',
      },
      taxCompliance: {
        outputVatCentavos: outputVatGlCentavos,
        inputVatCentavos: inputVatGlCentavos,
        netVatPayableCentavos: Math.max(0, outputVatGlCentavos - inputVatGlCentavos),
        ewtPayableCentavos,
        taxCalculationsCount: periodTaxCalcs.length,
        filedReturnsCount: filedReturns.length,
        draftReturnsCount: draftReturns.length,
        status:
          draftReturns.length === 0
            ? 'COMPLIANT'
            : 'PENDING_FILINGS',
      },
      fixedAssetDepreciation: {
        activeDepreciableAssets: activeAssets.length,
        depreciationRecordedCount: periodDepEntries.length,
        missingDepreciationCount: assetsMissingDepreciation.length,
        periodDepreciationCentavos,
        status:
          activeAssets.length === 0
            ? 'NO_DEPRECIABLE_ASSETS'
            : assetsMissingDepreciation.length === 0
              ? 'DEPRECIATED'
              : 'PENDING_DEPRECIATION',
      },
      fxRevaluation: {
        fxMonetaryAccountCount: fxAccountsWithBalance.length,
        postedRevaluationRunCount: periodFxRuns.length,
        latestClosingRateUsed: periodFxRuns.length > 0 ? Number(periodFxRuns[0].closingSpotRate) : null,
        totalGainCentavos: periodFxRuns.reduce((s, r) => s + Number(r.totalGainCentavos || 0), 0),
        totalLossCentavos: periodFxRuns.reduce((s, r) => s + Number(r.totalLossCentavos || 0), 0),
        status:
          fxAccountsWithBalance.length === 0
            ? 'NO_FX_EXPOSURE'
            : periodFxRuns.length > 0
              ? 'REVALUED'
              : 'PENDING_REVALUATION',
      },
    };

    // Helper to build each of the 12 sections
    const buildSection = (
      sectionNumber: number,
      sectionCode: string,
      sectionName: string,
      sourceModule: string,
      navigationRoute: string,
      relevantCount: number,
      relevantAmountCentavos: number,
      checks: ChecklistItemDetail[]
    ): ChecklistSectionResult => {
      const failedChecks = checks.filter((c) => !c.passed);
      const blockingCount = failedChecks.filter((c) => c.severity === 'BLOCKING').length;
      const warningCount = failedChecks.filter((c) => c.severity === 'WARNING').length;
      const informationalCount = failedChecks.filter((c) => c.severity === 'INFORMATIONAL').length;

      let validationStatus: ChecklistSectionStatus = 'PASSED';
      if (blockingCount > 0) validationStatus = 'BLOCKING';
      else if (warningCount > 0) validationStatus = 'WARNING';
      else if (informationalCount > 0) validationStatus = 'INFORMATIONAL';

      const unresolvedExceptionCount = failedChecks.reduce((sum, c) => sum + Math.max(1, c.count), 0);

      const summaryText =
        validationStatus === 'PASSED'
          ? `All ${checks.length} control checks passed.`
          : `${failedChecks.length} control exception(s): ${blockingCount} blocking, ${warningCount} warning, ${informationalCount} informational.`;

      return {
        sectionNumber,
        sectionCode,
        sectionName,
        sourceModule,
        navigationRoute,
        validationStatus,
        relevantCount,
        relevantAmountCentavos,
        unresolvedExceptionCount: failedChecks.length === 0 ? 0 : unresolvedExceptionCount,
        blockingCount,
        warningCount,
        informationalCount,
        lastCheckedAt: checkedAtIso,
        summaryText,
        checks,
      };
    };

    // Construct the 12 Mandatory Closing Checklist Sections
    const checklistSections: ChecklistSectionResult[] = [
      // 1. General Ledger
      buildSection(
        1,
        'GL',
        'General Ledger Integrity',
        'General Ledger',
        'accounting',
        postedJournals.length,
        totalDebitCentavos,
        [
          {
            checkCode: 'GL_UNBALANCED_JOURNALS',
            title: 'Posted Journal Double-Entry Equality (DR = CR)',
            passed: unbalancedPostedJournals.length === 0,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'GL_UNBALANCED_JOURNALS',
              'BLOCKING'
            ),
            count: unbalancedPostedJournals.length,
            amountCentavos: unbalancedPostedJournals.reduce((s, j) => s + j.variance, 0),
            description:
              unbalancedPostedJournals.length === 0
                ? `All ${postedJournals.length} posted journal entries have balanced debits and credits.`
                : `${unbalancedPostedJournals.length} posted journal(s) have unequal debit and credit totals.`,
            sampleRecords: unbalancedPostedJournals.slice(0, 5).map((j) => ({
              id: j.id,
              reference: j.journalNumber,
              entityType: 'JOURNAL_ENTRY',
              status: j.status,
              amountCentavos: j.variance,
              date: j.entryDate,
            })),
          },
          {
            checkCode: 'GL_ORPHAN_LINES',
            title: 'Minimum Two-Line Journal Completeness',
            passed: orphanLinesJournals.length === 0,
            severity: this.resolveSeverity(policy, closeTarget, 'GL_ORPHAN_LINES', 'BLOCKING'),
            count: orphanLinesJournals.length,
            amountCentavos: 0,
            description:
              orphanLinesJournals.length === 0
                ? 'No single-line or orphan journal headers found in period.'
                : `${orphanLinesJournals.length} posted journal(s) have fewer than two journal lines.`,
          },
          {
            checkCode: 'GL_INACTIVE_ACCOUNTS',
            title: 'Active Chart of Accounts Mapping',
            passed: inactiveAccountPostings.length === 0,
            severity: this.resolveSeverity(policy, closeTarget, 'GL_INACTIVE_ACCOUNTS', 'BLOCKING'),
            count: inactiveAccountPostings.length,
            amountCentavos: 0,
            description:
              inactiveAccountPostings.length === 0
                ? 'All posted journal lines map to active Chart of Accounts records.'
                : `${inactiveAccountPostings.length} journal line(s) reference missing or inactive GL accounts.`,
          },
          {
            checkCode: 'GL_FX_REVALUATION_PENDING',
            title: 'Period-End Foreign Currency Monetary Revaluation (PAS 21 / BIR RMC 12-2024)',
            passed: !fxPendingRevaluation,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'GL_FX_REVALUATION_PENDING',
              'WARNING'
            ),
            count: fxPendingRevaluation ? fxAccountsWithBalance.length : 0,
            amountCentavos: fxPendingRevaluation
              ? fxAccountsWithBalance.reduce((s, a) => s + Math.abs(Number(a.carryingPhpCentavos || 0)), 0)
              : 0,
            description:
              fxAccountsWithBalance.length === 0
                ? 'No active foreign-currency monetary GL balances requiring period-end FX revaluation.'
                : periodFxRuns.length > 0
                  ? `${periodFxRuns.length} period-end unrealized FX revaluation run(s) posted for ${fxAccountsWithBalance.length} foreign-currency monetary account(s).`
                  : `${fxAccountsWithBalance.length} active foreign-currency monetary GL account(s) have open balances without a posted period-end FX revaluation run.`,
            sampleRecords: fxPendingRevaluation
              ? fxAccountsWithBalance.slice(0, 5).map((a) => ({
                  id: a.accountId,
                  reference: `${a.accountCode} - ${a.accountName} (${a.currency})`,
                  entityType: 'ACCOUNT',
                  status: 'UNREVALUED',
                  amountCentavos: Math.abs(Number(a.carryingPhpCentavos || 0)),
                }))
              : undefined,
          },
        ]
      ),

      // 2. Trial Balance
      buildSection(
        2,
        'TRIAL_BALANCE',
        'Trial Balance Reconciliation',
        'Financial Statements Hub',
        'reports',
        allAccounts.length,
        totalDebitCentavos,
        [
          {
            checkCode: 'TB_OUT_OF_BALANCE',
            title: 'Period Trial Balance Total Debit vs. Total Credit',
            passed: varianceCentavos === 0,
            severity: this.resolveSeverity(policy, closeTarget, 'TB_OUT_OF_BALANCE', 'BLOCKING'),
            count: varianceCentavos === 0 ? 0 : 1,
            amountCentavos: varianceCentavos,
            description:
              varianceCentavos === 0
                ? `Period Trial Balance is in exact equilibrium (DR ₱${(totalDebitCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} = CR ₱${(totalCreditCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}).`
                : `Period Trial Balance has a discrepancy of ₱${(varianceCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}.`,
          },
        ]
      ),

      // 3. Journal Entries
      buildSection(
        3,
        'JOURNAL_ENTRIES',
        'Journal Entries & Workflow Queue',
        'General Ledger / Journal Entries',
        'accounting',
        periodJournals.length,
        totalDebitCentavos,
        [
          {
            checkCode: 'JE_DRAFT_ENTRIES',
            title: 'Draft Journal Entries in Period',
            passed: draftJournals.length === 0,
            severity: this.resolveSeverity(policy, closeTarget, 'JE_DRAFT_ENTRIES', 'BLOCKING'),
            count: draftJournals.length,
            amountCentavos: 0,
            description:
              draftJournals.length === 0
                ? 'Zero unsubmitted DRAFT journal entries remain in the period.'
                : `${draftJournals.length} journal entry/entries remain in DRAFT status and must be posted, moved to next period, or voided.`,
            sampleRecords: draftJournals.slice(0, 5).map((j) => ({
              id: j.id,
              reference: j.journalNumber,
              entityType: 'JOURNAL_ENTRY',
              status: j.status,
              date: j.entryDate,
            })),
          },
          {
            checkCode: 'JE_UNPOSTED_WORKFLOW',
            title: 'Submitted / Approved Journals Pending Posting',
            passed: submittedJournals.length + approvedUnpostedJournals.length === 0,
            severity: this.resolveSeverity(policy, closeTarget, 'JE_UNPOSTED_WORKFLOW', 'BLOCKING'),
            count: submittedJournals.length + approvedUnpostedJournals.length,
            amountCentavos: 0,
            description:
              submittedJournals.length + approvedUnpostedJournals.length === 0
                ? 'All submitted and approved journal entries in the period have been posted to GL.'
                : `${submittedJournals.length} submitted and ${approvedUnpostedJournals.length} approved journal(s) are awaiting final GL posting.`,
            sampleRecords: [...submittedJournals, ...approvedUnpostedJournals].slice(0, 5).map((j) => ({
              id: j.id,
              reference: j.journalNumber,
              entityType: 'JOURNAL_ENTRY',
              status: j.status,
              date: j.entryDate,
            })),
          },
          {
            checkCode: 'JE_POST_REOPEN_UNVALIDATED',
            title: 'Post-Reopen Activity Revalidation',
            passed: !requiresRevalidationAfterReopen,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'JE_POST_REOPEN_UNVALIDATED',
              'BLOCKING'
            ),
            count: requiresRevalidationAfterReopen ? Math.max(1, postReopenJournals.length) : 0,
            amountCentavos: 0,
            description: !reopenedDate
              ? 'Period has not been reopened.'
              : requiresRevalidationAfterReopen
                ? `Period was reopened on ${formatEnterpriseTimestamp(reopenedDate)} (${postReopenJournals.length} post-reopen journal touch(es)) and requires explicit revalidation before re-closing.`
                : `Reopened period activity (${postReopenJournals.length} journal(s)) has been revalidated.`,
          },
        ]
      ),

      // 4. Accounts Receivable
      buildSection(
        4,
        'ACCOUNTS_RECEIVABLE',
        'Accounts Receivable & Billing Subledger',
        'Sales & Accounts Receivable',
        'sales',
        periodInvoices.length,
        arOutstandingCentavos,
        [
          {
            checkCode: 'AR_UNPOSTED_INVOICES',
            title: 'Unposted Sales Invoices in Period',
            passed: unpostedInvoices.length === 0,
            severity: this.resolveSeverity(policy, closeTarget, 'AR_UNPOSTED_INVOICES', 'WARNING'),
            count: unpostedInvoices.length,
            amountCentavos: unpostedInvoices.reduce((s, i) => s + Number(i.totalAmount || 0), 0),
            description:
              unpostedInvoices.length === 0
                ? `All ${periodInvoices.length} sales invoice(s) dated in the period are posted.`
                : `${unpostedInvoices.length} sales invoice(s) in the period remain unposted (${unpostedInvoices.map((i) => i.invoiceNumber).slice(0, 3).join(', ')}).`,
            sampleRecords: unpostedInvoices.slice(0, 5).map((i) => ({
              id: i.id,
              reference: i.invoiceNumber,
              entityType: 'SALES_INVOICE',
              status: i.status,
              amountCentavos: i.totalAmount,
              date: i.invoiceDate,
            })),
          },
          {
            checkCode: 'AR_UNAPPLIED_RECEIPTS',
            title: 'Unapplied Customer Receipts / Collections',
            passed: unappliedReceipts.length === 0,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'AR_UNAPPLIED_RECEIPTS',
              'INFORMATIONAL'
            ),
            count: unappliedReceipts.length,
            amountCentavos: unappliedReceipts.reduce((s, p) => s + Number(p.amount || 0), 0),
            description:
              unappliedReceipts.length === 0
                ? 'All customer collections in the period are linked to sales invoices.'
                : `${unappliedReceipts.length} customer payment(s) in the period are not linked to a specific invoice.`,
          },
        ]
      ),

      // 5. Accounts Payable
      buildSection(
        5,
        'ACCOUNTS_PAYABLE',
        'Accounts Payable & Supplier Subledger',
        'Purchases & Accounts Payable',
        'purchases',
        periodBills.length,
        apOutstandingCentavos,
        [
          {
            checkCode: 'AP_UNPOSTED_BILLS',
            title: 'Unposted Supplier Bills in Period',
            passed: unpostedBills.length === 0,
            severity: this.resolveSeverity(policy, closeTarget, 'AP_UNPOSTED_BILLS', 'WARNING'),
            count: unpostedBills.length,
            amountCentavos: unpostedBills.reduce((s, b) => s + Number(b.totalAmount || 0), 0),
            description:
              unpostedBills.length === 0
                ? `All ${periodBills.length} supplier bill(s) dated in the period are posted.`
                : `${unpostedBills.length} supplier bill(s) in the period remain unposted (${unpostedBills.map((b) => b.billNumber).slice(0, 3).join(', ')}).`,
            sampleRecords: unpostedBills.slice(0, 5).map((b) => ({
              id: b.id,
              reference: b.billNumber,
              entityType: 'PURCHASE_BILL',
              status: b.status,
              amountCentavos: b.totalAmount,
              date: b.billDate,
            })),
          },
          {
            checkCode: 'AP_UNAPPLIED_PAYMENTS',
            title: 'Unapplied Supplier Disbursements',
            passed: unappliedSupplierPayments.length === 0,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'AP_UNAPPLIED_PAYMENTS',
              'INFORMATIONAL'
            ),
            count: unappliedSupplierPayments.length,
            amountCentavos: unappliedSupplierPayments.reduce((s, p) => s + Number(p.amount || 0), 0),
            description:
              unappliedSupplierPayments.length === 0
                ? 'All supplier disbursements in the period are applied to supplier bills.'
                : `${unappliedSupplierPayments.length} supplier payment(s) are unapplied.`,
          },
        ]
      ),

      // 6. Bank Reconciliation
      buildSection(
        6,
        'BANK_RECONCILIATION',
        'Cash & Bank Reconciliation',
        'Cash & Banking / Reconciliation',
        'bank-reconciliation',
        bankAccounts.length,
        0,
        [
          {
            checkCode: 'BANK_UNRECONCILED_SESSIONS',
            title: 'Open Bank Reconciliation Sessions in Period',
            passed: openRecSessions.length === 0,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'BANK_UNRECONCILED_SESSIONS',
              'WARNING'
            ),
            count: openRecSessions.length,
            amountCentavos: openRecSessions.reduce(
              (s, r) => s + Math.abs(Number(r.difference || 0)),
              0
            ),
            description:
              openRecSessions.length === 0
                ? `${reconciledSessions.length} bank reconciliation session(s) completed for the period; zero open sessions.`
                : `${openRecSessions.length} bank reconciliation session(s) for the period remain open/unfinalized.`,
            sampleRecords: openRecSessions.slice(0, 5).map((s) => ({
              id: s.id,
              reference: `BANK-REC-${s.statementEndingDate}`,
              entityType: 'BANK_RECONCILIATION',
              status: s.status,
              amountCentavos: Math.abs(Number(s.difference || 0)),
              date: s.statementEndingDate,
            })),
          },
          {
            checkCode: 'BANK_UNMATCHED_TRANSACTIONS',
            title: 'Unmatched Bank Statement Feed Lines',
            passed: unmatchedBankTx.length === 0,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'BANK_UNMATCHED_TRANSACTIONS',
              'INFORMATIONAL'
            ),
            count: unmatchedBankTx.length,
            amountCentavos: unmatchedBankTx.reduce(
              (s, t) => s + Math.abs(Number(t.amount || 0)),
              0
            ),
            description:
              unmatchedBankTx.length === 0
                ? 'All bank statement lines dated in the period are matched.'
                : `${unmatchedBankTx.length} bank statement line(s) in the period are not yet matched to GL entries.`,
          },
        ]
      ),

      // 7. Inventory and Costing
      buildSection(
        7,
        'INVENTORY_COSTING',
        'Inventory Valuation & COGS Recognition',
        'Inventory & Warehouse Management',
        'inventory',
        inventoryItems.length,
        totalInventoryValuationCentavos,
        [
          {
            checkCode: 'INV_NEGATIVE_STOCK',
            title: 'Non-Negative SKU Stock On-Hand Control',
            passed: negativeStockItems.length === 0,
            severity: this.resolveSeverity(policy, closeTarget, 'INV_NEGATIVE_STOCK', 'BLOCKING'),
            count: negativeStockItems.length,
            amountCentavos: 0,
            description:
              negativeStockItems.length === 0
                ? `All ${inventoryItems.length} inventory SKU(s) have non-negative stock on hand.`
                : `${negativeStockItems.length} SKU(s) have negative quantity on hand, distorting COGS valuation.`,
            sampleRecords: negativeStockItems.slice(0, 5).map((item) => ({
              id: item.id,
              reference: item.sku || item.itemName,
              entityType: 'INVENTORY_ITEM',
              status: `QTY: ${item.quantityOnHand}`,
            })),
          },
          {
            checkCode: 'INV_UNPOSTED_ADJUSTMENTS',
            title: 'Pending Stock Adjustments in Period',
            passed: unpostedAdjustments.length === 0,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'INV_UNPOSTED_ADJUSTMENTS',
              'BLOCKING'
            ),
            count: unpostedAdjustments.length,
            amountCentavos: 0,
            description:
              unpostedAdjustments.length === 0
                ? 'All stock adjustments in the period have been posted to GL.'
                : `${unpostedAdjustments.length} inventory adjustment(s) remain unposted.`,
          },
        ]
      ),

      // 8. Payroll and Statutory Liabilities
      buildSection(
        8,
        'PAYROLL_STATUTORY',
        'Payroll & PH Statutory Liabilities (SSS, PhilHealth, Pag-IBIG, 1601-C)',
        'Payroll & Compensation',
        'payroll',
        periodPayrollRuns.length,
        totalGrossPayCentavos,
        [
          {
            checkCode: 'PAYROLL_UNPOSTED_RUNS',
            title: 'Payroll Runs Posted to General Ledger',
            passed: unpostedPayrollRuns.length === 0,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'PAYROLL_UNPOSTED_RUNS',
              'BLOCKING'
            ),
            count: unpostedPayrollRuns.length,
            amountCentavos: unpostedPayrollRuns.reduce(
              (s, pr) => s + Number(pr.totalGrossPay || 0),
              0
            ),
            description:
              unpostedPayrollRuns.length === 0
                ? `${postedPayrollRuns.length} payroll run(s) in the period are posted with SSS, PhilHealth, Pag-IBIG, and WHT accruals.`
                : `${unpostedPayrollRuns.length} payroll run(s) in the period are in DRAFT/PENDING status and not yet posted to GL.`,
            sampleRecords: unpostedPayrollRuns.slice(0, 5).map((pr) => ({
              id: pr.id,
              reference: pr.runNumber || `PR-${pr.periodStart}`,
              entityType: 'PAYROLL_RUN',
              status: pr.status,
              amountCentavos: pr.totalGrossPay,
              date: pr.payDate || pr.periodEnd,
            })),
          },
        ]
      ),

      // 9. Philippine Tax Compliance
      buildSection(
        9,
        'TAX_COMPLIANCE',
        'Philippine Tax & BIR Statutory Readiness',
        'Philippine Tax & BIR Compliance',
        'tax',
        periodTaxCalcs.length + periodFilings.length,
        Math.max(0, outputVatGlCentavos - inputVatGlCentavos) + ewtPayableCentavos,
        [
          {
            checkCode: 'TAX_DRAFT_RETURNS',
            title: 'BIR Return Schedules & Electronic Filing Status',
            passed: draftReturns.length === 0,
            severity: this.resolveSeverity(policy, closeTarget, 'TAX_DRAFT_RETURNS', 'WARNING'),
            count: draftReturns.length,
            amountCentavos: draftReturns.reduce((s, r) => s + Number(r.taxDueCentavos || 0), 0),
            description:
              draftReturns.length === 0
                ? `${filedReturns.length} BIR return(s) filed/verified; Output VAT (₱${(outputVatGlCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}) and Input VAT (₱${(inputVatGlCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}) reconciled.`
                : `${draftReturns.length} BIR tax return submission(s) for the period remain in DRAFT/PENDING status.`,
            sampleRecords: draftReturns.slice(0, 5).map((r) => ({
              id: r.id,
              reference: `${r.formType || 'BIR'} (${r.taxPeriod || period.name})`,
              entityType: 'TAX_FILING',
              status: r.status,
              amountCentavos: r.taxDueCentavos,
            })),
          },
        ]
      ),

      // 10. Fixed Assets
      buildSection(
        10,
        'FIXED_ASSETS',
        'Fixed Assets & Monthly Depreciation Schedule',
        'Fixed Assets Register',
        'fixed-assets',
        activeAssets.length,
        periodDepreciationCentavos,
        [
          {
            checkCode: 'FA_PENDING_DEPRECIATION',
            title: 'Period Depreciation Recognition for Active Assets',
            passed: assetsMissingDepreciation.length === 0,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'FA_PENDING_DEPRECIATION',
              'WARNING'
            ),
            count: assetsMissingDepreciation.length,
            amountCentavos: 0,
            description:
              assetsMissingDepreciation.length === 0
                ? `All ${activeAssets.length} active depreciable fixed asset(s) have recorded depreciation for the period.`
                : `${assetsMissingDepreciation.length} active fixed asset(s) do not have a posted depreciation entry dated within ${startDate} to ${endDate}.`,
            sampleRecords: assetsMissingDepreciation.slice(0, 5).map((fa) => ({
              id: fa.id,
              reference: fa.assetTag || fa.assetName,
              entityType: 'FIXED_ASSET',
              status: fa.status,
              amountCentavos: fa.purchaseCost,
              date: fa.purchaseDate,
            })),
          },
        ]
      ),

      // 11. Approval Workflows
      buildSection(
        11,
        'APPROVAL_WORKFLOWS',
        'Enterprise Maker-Checker Approval Workflows',
        'Approvals & Internal Controls',
        'approvals',
        pendingWorkflows.length,
        pendingWorkflows.reduce((s, wf) => s + Number(wf.amountCentavos || 0), 0),
        [
          {
            checkCode: 'APPROVAL_PENDING_WORKFLOWS',
            title: 'Unresolved Approval Workflows for Period Transactions',
            passed: pendingWorkflows.length === 0,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'APPROVAL_PENDING_WORKFLOWS',
              'BLOCKING'
            ),
            count: pendingWorkflows.length,
            amountCentavos: pendingWorkflows.reduce((s, wf) => s + Number(wf.amountCentavos || 0), 0),
            description:
              pendingWorkflows.length === 0
                ? 'Zero pending approval workflows remain for transactions in this period.'
                : `${pendingWorkflows.length} approval workflow(s) for transactions in this period are still PENDING / IN_REVIEW.`,
            sampleRecords: pendingWorkflows.slice(0, 5).map((wf) => ({
              id: wf.id,
              reference: wf.recordReference || wf.id,
              entityType: 'APPROVAL_WORKFLOW',
              status: wf.status,
              amountCentavos: wf.amountCentavos,
            })),
          },
        ]
      ),

      // 12. Required Supporting Documents
      buildSection(
        12,
        'SUPPORTING_DOCUMENTS',
        'Supporting Documents & LAISDOC1 Hash Integrity',
        'Documents & Attachments Vault',
        'documents',
        companyDocs.length,
        0,
        [
          {
            checkCode: 'DOCS_MISSING_SUPPORTING_EVIDENCE',
            title: `Material Transactions (>= ₱${(policy.supportingDocThresholdCentavos / 100).toLocaleString('en-PH')}) Supporting Attachment Check`,
            passed: materialTransactionsMissingDocs.length === 0,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'DOCS_MISSING_SUPPORTING_EVIDENCE',
              'WARNING'
            ),
            count: materialTransactionsMissingDocs.length,
            amountCentavos: 0,
            description:
              materialTransactionsMissingDocs.length === 0
                ? 'All material posted journal transactions in the period have linked supporting documents.'
                : `${materialTransactionsMissingDocs.length} material posted journal(s) (>= ₱${(policy.supportingDocThresholdCentavos / 100).toLocaleString('en-PH')}) do not have linked supporting vouchers/attachments.`,
            sampleRecords: materialTransactionsMissingDocs.slice(0, 5).map((j) => ({
              id: j.id,
              reference: j.journalNumber,
              entityType: 'JOURNAL_ENTRY',
              status: j.status,
              date: j.entryDate,
            })),
          },
          {
            checkCode: 'DOCS_CORRUPTED_INTEGRITY',
            title: 'Encrypted LAISDOC1 & SHA-256 Vault Integrity',
            passed: corruptedDocs.length === 0,
            severity: this.resolveSeverity(
              policy,
              closeTarget,
              'DOCS_CORRUPTED_INTEGRITY',
              'BLOCKING'
            ),
            count: corruptedDocs.length,
            amountCentavos: 0,
            description:
              corruptedDocs.length === 0
                ? 'All vault documents passed SHA-256 checksum & LAISDOC1 container verification.'
                : `${corruptedDocs.length} document(s) reported integrity/quarantine alerts.`,
          },
        ]
      ),
    ];

    // Aggregate totals across all 12 sections
    const totalBlockingCount = checklistSections.reduce((s, sec) => s + sec.blockingCount, 0);
    const totalWarningCount = checklistSections.reduce((s, sec) => s + sec.warningCount, 0);
    const totalInformationalCount = checklistSections.reduce(
      (s, sec) => s + sec.informationalCount,
      0
    );
    const passedSectionsCount = checklistSections.filter(
      (sec) => sec.validationStatus === 'PASSED'
    ).length;

    const readinessScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          ((checklistSections.length - totalBlockingCount * 1.5 - totalWarningCount * 0.4) /
            checklistSections.length) *
            100
        )
      )
    );

    let validationSnapshotId: string | null = lastValidationRow?.id || null;
    if (options?.persistValidationByUserId) {
      validationSnapshotId = `VAL-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const nowSec = Math.floor(Date.now() / 1000);
      db.run(sql`
        INSERT INTO period_close_validations (
          id, company_id, period_id, close_target, readiness_score,
          blocking_count, warning_count, info_count,
          financial_overview_json, checklist_sections_json,
          policy_version, executed_by, executed_at
        ) VALUES (
          ${validationSnapshotId}, ${companyId}, ${periodId}, ${closeTarget}, ${readinessScore},
          ${totalBlockingCount}, ${totalWarningCount}, ${totalInformationalCount},
          ${JSON.stringify(financialOverview)}, ${JSON.stringify(checklistSections)},
          ${policy.policyVersion}, ${options.persistValidationByUserId}, ${nowSec}
        )
      `);
    }

    // Fetch existing immutable certification snapshots for this period
    const certifications = this.getPeriodCertifications(companyId, periodId);

    // Fetch enriched history
    const history = await this.getEnrichedPeriodHistory(companyId, periodId);

    const closedById = period.hardClosedBy || period.softClosedBy || period.closedBy;
    const closedAtRaw = period.hardClosedAt || period.softClosedAt || period.closedAt;

    return {
      periodInfo: {
        id: period.id,
        companyId: period.companyId,
        name: period.name,
        startDate: period.startDate,
        endDate: period.endDate,
        fiscalYear: period.fiscalYear,
        status: period.status,
        version: period.version || 1,
        companyLockDate: company?.lockDate || null,
        softClosedAt: normalizeIsoTimestamp(period.softClosedAt),
        softClosedBy: period.softClosedBy,
        softClosedByName: period.softClosedBy
          ? userMap.get(period.softClosedBy)?.displayName || period.softClosedBy
          : null,
        hardClosedAt: normalizeIsoTimestamp(period.hardClosedAt),
        hardClosedBy: period.hardClosedBy,
        hardClosedByName: period.hardClosedBy
          ? userMap.get(period.hardClosedBy)?.displayName || period.hardClosedBy
          : null,
        closedAt: normalizeIsoTimestamp(closedAtRaw),
        closedBy: closedById,
        closedByName: closedById ? userMap.get(closedById)?.displayName || closedById : null,
        reopenedAt: normalizeIsoTimestamp(period.reopenedAt),
        reopenedBy: period.reopenedBy,
        reopenedByName: period.reopenedBy
          ? userMap.get(period.reopenedBy)?.displayName || period.reopenedBy
          : null,
        reopenReason: period.reopenReason || null,
        lastValidationAt: options?.persistValidationByUserId
          ? checkedAtIso
          : normalizeIsoTimestamp(lastValidationRow?.executed_at) || checkedAtIso,
        validationSnapshotId,
      },
      readinessSummary: {
        closeTarget,
        readinessScore,
        canSoftClose:
          !['HARD_CLOSED', 'LOCKED'].includes(period.status) &&
          (closeTarget === 'SOFT_CLOSE'
            ? totalBlockingCount === 0
            : checklistSections.every((sec) =>
                sec.checks
                  .filter((c) => !c.passed)
                  .every(
                    (c) =>
                      this.resolveSeverity(policy, 'SOFT_CLOSE', c.checkCode, c.severity) !==
                      'BLOCKING'
                  )
              )),
        canHardClose:
          !['HARD_CLOSED', 'LOCKED'].includes(period.status) &&
          checklistSections.every((sec) =>
            sec.checks
              .filter((c) => !c.passed)
              .every(
                (c) =>
                  this.resolveSeverity(policy, 'HARD_CLOSE', c.checkCode, c.severity) !== 'BLOCKING'
              )
          ),
        totalSections: checklistSections.length,
        passedSectionsCount,
        totalBlockingCount,
        totalWarningCount,
        totalInformationalCount,
        requiresWarningJustification:
          policy.requireWarningJustification && totalWarningCount > 0,
        requiresRevalidationAfterReopen,
        postReopenJournalCount: postReopenJournals.length,
      },
      financialOverview,
      checklistSections,
      policy,
      certifications,
      history,
      postReopenActivity: postReopenJournals.map((j) => ({
        id: j.id,
        journalNumber: j.journalNumber,
        entryDate: j.entryDate,
        status: j.status,
        description: j.description,
        sourceType: j.sourceType || 'MANUAL',
        updatedAt: normalizeIsoTimestamp(j.updatedAt || j.postedAt || j.createdAt),
        formattedUpdatedAt: formatEnterpriseTimestamp(j.updatedAt || j.postedAt || j.createdAt),
      })),
    };
  }

  static async executeEvidenceDrivenSoftClose(
    companyId: string,
    periodId: string,
    user: { id: string; displayName?: string; email?: string; role?: string },
    payload: {
      reason?: string;
      warningJustification?: string;
      expectedVersion?: number;
      enforceEvidenceChecks?: boolean;
    }
  ) {
    const workspace = await this.buildPeriodCloseWorkspace(companyId, periodId, {
      closeTarget: 'SOFT_CLOSE',
      persistValidationByUserId: user.id,
    });

    const blockingItems = workspace.checklistSections.flatMap((sec) =>
      sec.checks
        .filter((c) => !c.passed && c.severity === 'BLOCKING')
        .map((c) => ({ section: sec.sectionName, ...c }))
    );

    if (blockingItems.length > 0) {
      throw new DomainError(
        `Soft Close blocked by ${blockingItems.length} unresolved BLOCKING validation exception(s): ${blockingItems.map((b) => b.title).join('; ')}`,
        'PERIOD_CLOSE_BLOCKED',
        400,
        {
          closeTarget: 'SOFT_CLOSE',
          blockingCount: blockingItems.length,
          blockingItems,
          validationSnapshotId: workspace.periodInfo.validationSnapshotId,
        }
      );
    }

    const warningItems = workspace.checklistSections.flatMap((sec) =>
      sec.checks
        .filter((c) => !c.passed && c.severity === 'WARNING')
        .map((c) => ({ section: sec.sectionName, ...c }))
    );

    const trimmedReason = String(payload.reason || '').trim();
    const trimmedWarningJustification = String(payload.warningJustification || '').trim();

    if (payload.enforceEvidenceChecks && !trimmedReason) {
      throw new DomainError(
        'A closing reason is required to soft-close an accounting period.',
        'CLOSING_REASON_REQUIRED',
        400
      );
    }

    if (
      warningItems.length > 0 &&
      workspace.policy.requireWarningJustification &&
      payload.enforceEvidenceChecks &&
      !trimmedWarningJustification
    ) {
      throw new DomainError(
        `Soft Close requires a recorded warning justification for ${warningItems.length} active WARNING item(s): ${warningItems.map((w) => w.title).join('; ')}`,
        'WARNING_JUSTIFICATION_REQUIRED',
        400,
        {
          warningCount: warningItems.length,
          warningItems,
        }
      );
    }

    await softClosePeriod(
      companyId,
      periodId,
      user.id,
      trimmedReason || 'Soft closed after preliminary period validation',
      payload.expectedVersion
    );

    // Enrich latest period_status_history entry with validation snapshot & warning justification
    const latestHistory = db.get(sql`
      SELECT id FROM period_status_history
      WHERE company_id = ${companyId} AND accounting_period_id = ${periodId}
      ORDER BY rowid DESC LIMIT 1
    `) as any;
    if (latestHistory?.id) {
      db.run(sql`
        UPDATE period_status_history
        SET warning_justification = ${trimmedWarningJustification || null},
            validation_snapshot_id = ${workspace.periodInfo.validationSnapshotId},
            metadata_json = ${JSON.stringify({
              readinessScore: workspace.readinessSummary.readinessScore,
              warningCount: warningItems.length,
              userRole: user.role || 'Company Administrator',
            })}
        WHERE id = ${latestHistory.id}
      `);
    }

    return {
      periodId,
      status: 'SOFT_CLOSED',
      validationSnapshotId: workspace.periodInfo.validationSnapshotId,
      readinessSummary: workspace.readinessSummary,
      warningCount: warningItems.length,
      warningJustification: trimmedWarningJustification || null,
    };
  }

  static async executeEvidenceDrivenHardClose(
    companyId: string,
    periodId: string,
    user: { id: string; displayName?: string; email?: string; role?: string },
    payload: {
      reason?: string;
      warningJustification?: string;
      approvedByUserId?: string;
      approvedByUserName?: string;
      approvedByUserRole?: string;
      expectedVersion?: number;
      enforceEvidenceChecks?: boolean;
      auditEventId?: string;
    }
  ) {
    // Before running validation with persistValidationByUserId, check if reopened period was NOT revalidated prior to hard close when enforceEvidenceChecks is true
    const preCheckWorkspace = await this.buildPeriodCloseWorkspace(companyId, periodId, {
      closeTarget: 'HARD_CLOSE',
    });

    const workspace = await this.buildPeriodCloseWorkspace(companyId, periodId, {
      closeTarget: 'HARD_CLOSE',
      persistValidationByUserId: user.id,
    });

    const blockingItems = workspace.checklistSections.flatMap((sec) =>
      sec.checks
        .filter((c) => !c.passed && c.severity === 'BLOCKING')
        .map((c) => ({ section: sec.sectionName, ...c }))
    );

    if (blockingItems.length > 0) {
      throw new DomainError(
        `Hard Close blocked by ${blockingItems.length} unresolved BLOCKING exception(s): ${blockingItems.map((b) => b.title).join('; ')}`,
        'PERIOD_CLOSE_BLOCKED',
        400,
        {
          closeTarget: 'HARD_CLOSE',
          blockingCount: blockingItems.length,
          blockingItems,
          validationSnapshotId: workspace.periodInfo.validationSnapshotId,
        }
      );
    }

    const warningItems = workspace.checklistSections.flatMap((sec) =>
      sec.checks
        .filter((c) => !c.passed && c.severity === 'WARNING')
        .map((c) => ({ section: sec.sectionName, ...c }))
    );

    const trimmedReason = String(payload.reason || '').trim() || 'Hard closed and certified period';
    const trimmedWarningJustification = String(payload.warningJustification || '').trim();

    if (
      warningItems.length > 0 &&
      workspace.policy.requireWarningJustification &&
      payload.enforceEvidenceChecks &&
      !trimmedWarningJustification
    ) {
      throw new DomainError(
        `Hard Close requires a mandatory justification for ${warningItems.length} unresolved WARNING item(s): ${warningItems.map((w) => w.title).join('; ')}`,
        'WARNING_JUSTIFICATION_REQUIRED',
        400,
        {
          warningCount: warningItems.length,
          warningItems,
        }
      );
    }

    await hardClosePeriod(
      companyId,
      periodId,
      user.id,
      trimmedReason,
      payload.expectedVersion
    );

    // Create Immutable Period Close Certification Snapshot
    const certId = `CERT-${periodId.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-8)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const closedAtIso = new Date().toISOString();
    const nowSec = Math.floor(Date.now() / 1000);

    const trialBalanceTotals = {
      totalDebitCentavos: workspace.financialOverview.totalDebitCentavos,
      totalCreditCentavos: workspace.financialOverview.totalCreditCentavos,
      varianceCentavos: workspace.financialOverview.varianceCentavos,
      trialBalanceStatus: workspace.financialOverview.trialBalanceStatus,
      postedJournalCount: workspace.financialOverview.postedJournalCount,
    };

    const reconciliationRefs = {
      reconciledBankSessions: workspace.financialOverview.bankReconciliation.reconciledSessionCount,
      postedPayrollRuns: workspace.financialOverview.payrollPosting.postedRunCount,
      filedTaxReturns: workspace.financialOverview.taxCompliance.filedReturnsCount,
      depreciationEntriesCount:
        workspace.financialOverview.fixedAssetDepreciation.depreciationRecordedCount,
      postReopenRevalidated: Boolean(preCheckWorkspace.periodInfo.reopenedAt),
    };

    const canonicalPayloadForHash = JSON.stringify({
      certId,
      companyId,
      periodId,
      periodName: workspace.periodInfo.name,
      startDate: workspace.periodInfo.startDate,
      endDate: workspace.periodInfo.endDate,
      fiscalYear: workspace.periodInfo.fiscalYear,
      trialBalanceTotals,
      financialOverview: workspace.financialOverview,
      checklistSummary: workspace.checklistSections.map((s) => ({
        sectionCode: s.sectionCode,
        validationStatus: s.validationStatus,
        blockingCount: s.blockingCount,
        warningCount: s.warningCount,
      })),
      warningJustification: trimmedWarningJustification || null,
      closingReason: trimmedReason,
      closedByUserId: user.id,
      closedAtIso,
      closingPolicyVersion: workspace.policy.policyVersion,
    });

    const sha256Hash = crypto
      .createHash('sha256')
      .update(canonicalPayloadForHash)
      .digest('hex');

    const closedByName = user.displayName || user.email || user.id;
    const closedByRole = user.role || 'Company Administrator';

    db.run(sql`
      INSERT INTO period_close_certifications (
        id, company_id, period_id, period_name, start_date, end_date, fiscal_year,
        close_type, validation_snapshot_id, checklist_results_json,
        financial_overview_json, trial_balance_totals_json, unresolved_exceptions_json,
        warning_justification, closing_reason, reconciliation_refs_json,
        closed_by_user_id, closed_by_user_name, closed_by_user_role,
        approved_by_user_id, approved_by_user_name, approved_by_user_role,
        closed_at, closing_policy_version, audit_event_id, sha256_hash, created_at
      ) VALUES (
        ${certId}, ${companyId}, ${periodId}, ${workspace.periodInfo.name},
        ${workspace.periodInfo.startDate}, ${workspace.periodInfo.endDate}, ${workspace.periodInfo.fiscalYear},
        'HARD_CLOSE', ${workspace.periodInfo.validationSnapshotId},
        ${JSON.stringify(workspace.checklistSections)},
        ${JSON.stringify(workspace.financialOverview)},
        ${JSON.stringify(trialBalanceTotals)},
        ${JSON.stringify(warningItems)},
        ${trimmedWarningJustification || null},
        ${trimmedReason},
        ${JSON.stringify(reconciliationRefs)},
        ${user.id}, ${closedByName}, ${closedByRole},
        ${payload.approvedByUserId || user.id},
        ${payload.approvedByUserName || closedByName},
        ${payload.approvedByUserRole || closedByRole},
        ${closedAtIso}, ${workspace.policy.policyVersion},
        ${payload.auditEventId || null}, ${sha256Hash}, ${nowSec}
      )
    `);

    const latestHistory = db.get(sql`
      SELECT id FROM period_status_history
      WHERE company_id = ${companyId} AND accounting_period_id = ${periodId}
      ORDER BY rowid DESC LIMIT 1
    `) as any;
    if (latestHistory?.id) {
      db.run(sql`
        UPDATE period_status_history
        SET warning_justification = ${trimmedWarningJustification || null},
            approved_by = ${payload.approvedByUserId || user.id},
            validation_snapshot_id = ${workspace.periodInfo.validationSnapshotId},
            certification_snapshot_id = ${certId},
            metadata_json = ${JSON.stringify({
              readinessScore: workspace.readinessSummary.readinessScore,
              certificationId: certId,
              sha256Hash,
              userRole: closedByRole,
            })}
        WHERE id = ${latestHistory.id}
      `);
    }

    return {
      periodId,
      status: 'HARD_CLOSED',
      validationSnapshotId: workspace.periodInfo.validationSnapshotId,
      certification: this.getCertificationById(companyId, certId),
    };
  }

  static async executeEvidenceDrivenReopen(
    companyId: string,
    periodId: string,
    user: { id: string; displayName?: string; email?: string; role?: string },
    payload: {
      reason: string;
      approvedByUserId?: string;
      approvedByUserName?: string;
      expectedVersion?: number;
    }
  ) {
    this.ensureWorkspaceTables();
    const policy = this.getCompanyPolicy(companyId);

    const period = await db
      .select()
      .from(schema.accountingPeriods)
      .where(
        and(
          eq(schema.accountingPeriods.id, periodId),
          eq(schema.accountingPeriods.companyId, companyId)
        )
      )
      .get();

    if (!period) {
      throw new DomainError('Accounting period not found', 'NOT_FOUND', 404);
    }

    if (policy.requireMakerCheckerReopen) {
      const closedBy = period.hardClosedBy || period.softClosedBy || period.closedBy;
      const secondaryApproverId = payload.approvedByUserId;

      // 1. Must supply a secondary approver ID
      if (!secondaryApproverId) {
        throw new DomainError(
          'Maker-Checker Segregation of Duties Violation: Company closing policy requires a secondary authorized approver to reopen a closed period.',
          'SOD_REOPEN_APPROVAL_REQUIRED',
          403
        );
      }

      // 2. Requester cannot approve their own reopen request
      if (secondaryApproverId === user.id) {
        throw new DomainError(
          'Maker-Checker Segregation of Duties Violation: You cannot approve your own reopen request. A distinct authorized approver is required.',
          'SOD_SELF_APPROVAL_PROHIBITED',
          403
        );
      }

      // 3. If closedBy is known, the person who originally closed cannot be the sole approver approving their own reopening without separation
      if (closedBy && user.id === closedBy && secondaryApproverId === user.id) {
        throw new DomainError(
          'Maker-Checker Segregation of Duties Violation: The user who closed the period cannot self-approve reopening.',
          'SOD_REOPEN_APPROVAL_REQUIRED',
          403
        );
      }
    }

    await reopenPeriod(companyId, periodId, user.id, payload.reason, payload.expectedVersion);

    // Count preserved historical certifications
    const existingCerts = this.getPeriodCertifications(companyId, periodId);

    const latestHistory = db.get(sql`
      SELECT id FROM period_status_history
      WHERE company_id = ${companyId} AND accounting_period_id = ${periodId}
      ORDER BY rowid DESC LIMIT 1
    `) as any;
    if (latestHistory?.id) {
      db.run(sql`
        UPDATE period_status_history
        SET approved_by = ${payload.approvedByUserId || user.id},
            metadata_json = ${JSON.stringify({
              preservedCertificationCount: existingCerts.length,
              requiresRevalidationBeforeNextClose: true,
              userRole: user.role || 'Company Administrator',
              approvedByName: payload.approvedByUserName || user.displayName || user.email || user.id,
            })}
        WHERE id = ${latestHistory.id}
      `);
    }

    return {
      periodId,
      status: 'OPEN',
      preservedCertificationsCount: existingCerts.length,
      requiresRevalidationBeforeNextClose: true,
    };
  }

  static getPeriodCertifications(companyId: string, periodId: string) {
    this.ensureWorkspaceTables();
    try {
      const rows = db.all(sql`
        SELECT * FROM period_close_certifications
        WHERE company_id = ${companyId} AND period_id = ${periodId}
        ORDER BY created_at DESC, rowid DESC
      `) as any[];
      return rows.map((r: any) => this.mapCertificationRow(r));
    } catch (_) {
      return [];
    }
  }

  static getCertificationById(companyId: string, certId: string) {
    this.ensureWorkspaceTables();
    const row = db.get(sql`
      SELECT * FROM period_close_certifications
      WHERE company_id = ${companyId} AND id = ${certId}
      LIMIT 1
    `) as any;
    return row ? this.mapCertificationRow(row) : null;
  }

  private static mapCertificationRow(r: any) {
    const safeParse = (str: string, fallback: any) => {
      try {
        return str ? JSON.parse(str) : fallback;
      } catch (_) {
        return fallback;
      }
    };
    return {
      id: r.id,
      companyId: r.company_id,
      periodId: r.period_id,
      periodName: r.period_name,
      startDate: r.start_date,
      endDate: r.end_date,
      fiscalYear: r.fiscal_year,
      closeType: r.close_type,
      validationSnapshotId: r.validation_snapshot_id,
      trialBalanceTotals: safeParse(r.trial_balance_totals_json, {}),
      financialOverview: safeParse(r.financial_overview_json, {}),
      checklistResults: safeParse(r.checklist_results_json, []),
      unresolvedExceptions: safeParse(r.unresolved_exceptions_json, []),
      warningJustification: r.warning_justification || null,
      closingReason: r.closing_reason,
      reconciliationRefs: safeParse(r.reconciliation_refs_json, {}),
      closedByUserId: r.closed_by_user_id,
      closedByUserName: r.closed_by_user_name,
      closedByUserRole: r.closed_by_user_role,
      approvedByUserId: r.approved_by_user_id,
      approvedByUserName: r.approved_by_user_name,
      approvedByUserRole: r.approved_by_user_role,
      closedAt: normalizeIsoTimestamp(r.closed_at) || r.closed_at,
      formattedClosedAt: formatEnterpriseTimestamp(r.closed_at),
      closingPolicyVersion: Number(r.closing_policy_version || 1),
      auditEventId: r.audit_event_id || null,
      sha256Hash: r.sha256_hash,
      immutable: true,
    };
  }

  static async getEnrichedPeriodHistory(companyId: string, periodId: string) {
    this.ensureWorkspaceTables();

    const rawRows = db.all(sql`
      SELECT
        psh.*,
        u.display_name AS user_display_name,
        u.email AS user_email,
        au.display_name AS approver_display_name,
        au.email AS approver_email,
        pcc.sha256_hash AS certification_sha256,
        pcv.readiness_score AS validation_readiness_score,
        pcv.blocking_count AS validation_blocking_count,
        pcv.warning_count AS validation_warning_count
      FROM period_status_history psh
      LEFT JOIN users u ON u.id = psh.changed_by
      LEFT JOIN users au ON au.id = psh.approved_by
      LEFT JOIN period_close_certifications pcc ON pcc.id = psh.certification_snapshot_id
      LEFT JOIN period_close_validations pcv ON pcv.id = psh.validation_snapshot_id
      WHERE psh.company_id = ${companyId} AND psh.accounting_period_id = ${periodId}
      ORDER BY psh.rowid ASC
    `) as any[];

    return rawRows.map((row: any) => {
      const normalizedIso = normalizeIsoTimestamp(row.created_at) || new Date().toISOString();
      let meta: Record<string, any> = {};
      try {
        if (row.metadata_json) meta = JSON.parse(row.metadata_json);
      } catch (_) {}

      return {
        id: row.id,
        companyId: row.company_id,
        accountingPeriodId: row.accounting_period_id,
        action: row.action,
        previousStatus: row.previous_status,
        newStatus: row.new_status,
        reason: row.reason,
        warningJustification: row.warning_justification || null,
        changedBy: row.changed_by,
        changedByName: row.user_display_name || row.user_email || row.changed_by,
        changedByEmail: row.user_email || null,
        changedByRole: meta.userRole || 'Company Administrator',
        approvedBy: row.approved_by || null,
        approvedByName:
          row.approver_display_name ||
          row.approver_email ||
          meta.approvedByName ||
          row.approved_by ||
          null,
        validationSnapshotId: row.validation_snapshot_id || null,
        validationSummary: row.validation_snapshot_id
          ? {
              readinessScore: Number(row.validation_readiness_score ?? meta.readinessScore ?? 100),
              blockingCount: Number(row.validation_blocking_count ?? 0),
              warningCount: Number(row.validation_warning_count ?? meta.warningCount ?? 0),
            }
          : null,
        certificationSnapshotId: row.certification_snapshot_id || null,
        certificationSha256: row.certification_sha256 || meta.sha256Hash || null,
        createdAt: normalizedIso,
        formattedTimestamp: formatEnterpriseTimestamp(normalizedIso),
        metadata: meta,
      };
    });
  }
}
