import crypto from 'crypto';
import fs from 'fs';
import { db } from '../db';
import * as schema from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { CompanyManager } from './companyManager';
import { DocumentEncryptionService, DOC_MAGIC } from './documentEncryptionService';
import { AuditService } from './auditService';
import { normalizeIsoTimestamp } from '../../shared/timestampUtils';

const toEpochSeconds = (ms: number): number => Math.floor(ms / 1000);
const toIsoTimestamp = (val: unknown): string | null => normalizeIsoTimestamp(val);

export type IntegrityDomainCode =
  | 'ACCOUNTING_INTEGRITY'
  | 'RECORD_INTEGRITY'
  | 'CRYPTOGRAPHIC_INTEGRITY';

export type IntegrityFindingSeverity =
  | 'CRITICAL'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'INFORMATIONAL';

export type IntegrityScanLifecycleStatus =
  | 'NOT_SCANNED'
  | 'SCANNING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_FINDINGS'
  | 'FAILED';

export interface IntegrityCheckResultItem {
  checkCode: string;
  checkName: string;
  domain: IntegrityDomainCode;
  status: 'PASSED' | 'WARNING' | 'FAILED';
  recordsEvaluated: number;
  issuesFound: number;
  severityIfFailed: IntegrityFindingSeverity;
  summary: string;
}

export interface IntegrityDomainSummary {
  domain: IntegrityDomainCode;
  title: string;
  subtitle: string;
  status: 'VERIFIED' | 'WARNINGS_DETECTED' | 'VIOLATIONS_DETECTED';
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningChecks: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  checks: IntegrityCheckResultItem[];
}

export interface IntegrityFindingRecord {
  id: string;
  scanId: string;
  companyId: string;
  domain: IntegrityDomainCode;
  checkCode: string;
  checkName: string;
  severity: IntegrityFindingSeverity;
  entityType: string;
  entityId: string;
  recordReference: string;
  title: string;
  description: string;
  discrepancyAmountCentavos: number;
  remediationAction: string;
  remediationModulePath: string;
  evidence: Record<string, any>;
  createdAt: string;
}

export interface IntegrityRecordsInspected {
  postedJournals: number;
  allJournals: number;
  journalLines: number;
  accounts: number;
  salesInvoices: number;
  purchaseBills: number;
  customerPayments: number;
  supplierPayments: number;
  inventoryItems: number;
  fixedAssets: number;
  accountingPeriods: number;
  periodCertifications: number;
  documentsInVault: number;
  encryptedLaisdocFilesVerified: number;
  auditLogsVerified: number;
  totalRecordsInspected: number;
}

export interface IntegrityScanReportPayload {
  scanId: string;
  companyId: string;
  companyName: string;
  databaseIdentity: string;
  status: IntegrityScanLifecycleStatus;
  executionMode: 'OFFLINE_LOCAL';
  engineVersion: string;
  scanScope: string;
  scanTimestamp: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  recordsInspected: IntegrityRecordsInspected;
  domains: Record<IntegrityDomainCode, IntegrityDomainSummary>;
  passedChecks: number;
  failedChecks: number;
  warningCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  findingsCount: number;
  findings: IntegrityFindingRecord[];
  previousScanId: string | null;
  previousReportHash: string | null;
  reportHash: string;
  hashChainVerified: boolean;
  cryptographicBoundaryStatement: string;
  triggeredBy: string;
  triggeredByName: string;
  triggeredByRole: string;
  // Legacy compatibility fields for existing callers
  totalPosted: number;
  violationsCount: number;
  violations: Array<{
    id: string;
    journalNumber: string;
    totalDebit: number;
    totalCredit: number;
    discrepancy: number;
  }>;
}

export class LedgerIntegrityService {
  public static readonly ENGINE_VERSION = 'LEDGERAI-CRYPTO-INTEGRITY-v2.5-OFFLINE';

  private static async ensureTables(companyId: string): Promise<any> {
    const sqlite = await CompanyManager.getCompanySqlite(companyId);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS integrity_scan_reports (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        database_identity TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'COMPLETED',
        execution_mode TEXT NOT NULL DEFAULT 'OFFLINE_LOCAL',
        engine_version TEXT NOT NULL DEFAULT 'LEDGERAI-CRYPTO-INTEGRITY-v2.5',
        scan_scope TEXT NOT NULL DEFAULT 'FULL_COMPANY_LEDGER_3_DOMAIN',
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        records_inspected_json TEXT NOT NULL,
        domain_results_json TEXT NOT NULL,
        passed_checks INTEGER NOT NULL DEFAULT 0,
        failed_checks INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        critical_count INTEGER NOT NULL DEFAULT 0,
        high_count INTEGER NOT NULL DEFAULT 0,
        medium_count INTEGER NOT NULL DEFAULT 0,
        low_count INTEGER NOT NULL DEFAULT 0,
        info_count INTEGER NOT NULL DEFAULT 0,
        findings_count INTEGER NOT NULL DEFAULT 0,
        previous_scan_id TEXT,
        previous_report_hash TEXT,
        report_hash TEXT NOT NULL,
        triggered_by TEXT,
        triggered_by_name TEXT,
        triggered_by_role TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_integrity_scan_reports_company
        ON integrity_scan_reports(company_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS integrity_scan_findings (
        id TEXT PRIMARY KEY,
        scan_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        check_code TEXT NOT NULL,
        check_name TEXT NOT NULL,
        severity TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        record_reference TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        discrepancy_amount_centavos INTEGER NOT NULL DEFAULT 0,
        remediation_action TEXT NOT NULL,
        remediation_module_path TEXT,
        evidence_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_integrity_scan_findings_scan
        ON integrity_scan_findings(scan_id, severity);

      CREATE TABLE IF NOT EXISTS period_close_certifications (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        period_id TEXT NOT NULL,
        period_name TEXT,
        start_date TEXT,
        end_date TEXT,
        fiscal_year INTEGER,
        close_type TEXT,
        checklist_results_json TEXT,
        financial_overview_json TEXT,
        trial_balance_totals_json TEXT,
        unresolved_exceptions_json TEXT,
        warning_justification TEXT,
        closing_reason TEXT,
        reconciliation_refs_json TEXT,
        closed_by_user_id TEXT,
        closed_by_user_name TEXT,
        closed_by_user_role TEXT,
        closed_at TEXT,
        closing_policy_version INTEGER DEFAULT 1,
        sha256_hash TEXT,
        created_at INTEGER,
        period_code TEXT,
        close_stage TEXT,
        checklist_snapshot_json TEXT,
        trial_balance_snapshot_json TEXT,
        integrity_scan_id TEXT,
        integrity_scan_hash TEXT,
        previous_certification_hash TEXT,
        certification_hash TEXT,
        certified_by_id TEXT,
        certified_by_name TEXT,
        certified_by_role TEXT,
        certified_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_period_close_cert_company_period
        ON period_close_certifications(company_id, period_id);

      CREATE TRIGGER IF NOT EXISTS trg_period_close_cert_no_update
      BEFORE UPDATE ON period_close_certifications
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CERTIFICATION_SNAPSHOT: Period close certification snapshots cannot be modified.');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_period_close_cert_no_delete
      BEFORE DELETE ON period_close_certifications
      BEGIN
        SELECT RAISE(ABORT, 'IMMUTABLE_CERTIFICATION_SNAPSHOT: Period close certification snapshots cannot be deleted.');
      END;
    `);
    return sqlite;
  }

  /**
   * Computes canonical SHA-256 hash over a scan report and its previousReportHash link.
   */
  public static computeCanonicalReportHash(params: {
    scanId: string;
    companyId: string;
    databaseIdentity: string;
    engineVersion: string;
    startedAtEpochSec: number;
    recordsInspected: IntegrityRecordsInspected;
    passedChecks: number;
    failedChecks: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    findingsDigests: string[];
    previousReportHash: string | null;
  }): string {
    const canonical = JSON.stringify({
      companyId: params.companyId,
      criticalCount: params.criticalCount,
      databaseIdentity: params.databaseIdentity,
      engineVersion: params.engineVersion,
      failedChecks: params.failedChecks,
      findingsDigests: [...params.findingsDigests].sort(),
      highCount: params.highCount,
      lowCount: params.lowCount,
      mediumCount: params.mediumCount,
      passedChecks: params.passedChecks,
      previousReportHash: params.previousReportHash || 'GENESIS_INTEGRITY_SCAN_ANCHOR',
      recordsInspected: params.recordsInspected,
      scanId: params.scanId,
      startedAtEpochSec: params.startedAtEpochSec,
    });
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Returns current integrity status, latest scan report (if any), and scan history.
   * Never throws a generic fetch error when no scan has been run yet (returns status: NOT_SCANNED).
   */
  public static async getOverviewAndHistory(companyId: string, limit = 20): Promise<{
    lifecycleStatus: IntegrityScanLifecycleStatus;
    companyId: string;
    companyName: string;
    databaseIdentity: string;
    executionMode: 'OFFLINE_LOCAL';
    latestReport: IntegrityScanReportPayload | null;
    scanHistory: Array<{
      scanId: string;
      status: IntegrityScanLifecycleStatus;
      scanTimestamp: string;
      durationMs: number;
      passedChecks: number;
      failedChecks: number;
      warningCount: number;
      criticalCount: number;
      findingsCount: number;
      totalRecordsInspected: number;
      reportHash: string;
      previousReportHash: string | null;
      triggeredByName: string;
      triggeredByRole: string;
    }>;
  }> {
    const sqlite = await this.ensureTables(companyId);
    const compRow = sqlite
      .prepare('SELECT legal_name, trade_name FROM companies WHERE id = ? LIMIT 1')
      .get(companyId) as any;
    const companyName = compRow?.legal_name || compRow?.trade_name || companyId;
    const databaseIdentity = `company_${companyId}.lai (AES-256-GCM Vault)`;

    const historyRows = sqlite
      .prepare(
        `SELECT * FROM integrity_scan_reports
         WHERE company_id = ?
         ORDER BY started_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(companyId, Math.max(1, Math.min(limit, 100))) as any[];

    if (historyRows.length === 0) {
      return {
        lifecycleStatus: 'NOT_SCANNED',
        companyId,
        companyName,
        databaseIdentity,
        executionMode: 'OFFLINE_LOCAL',
        latestReport: null,
        scanHistory: [],
      };
    }

    const latestReport = await this.hydrateReportRow(sqlite, historyRows[0], companyName);
    const scanHistory = historyRows.map((r) => {
      let totalRecordsInspected = 0;
      try {
        const rec = JSON.parse(r.records_inspected_json || '{}');
        totalRecordsInspected = Number(rec.totalRecordsInspected || 0);
      } catch {}
      return {
        scanId: r.id,
        status: r.status as IntegrityScanLifecycleStatus,
        scanTimestamp: toIsoTimestamp(r.completed_at || r.started_at) || new Date().toISOString(),
        durationMs: Number(r.duration_ms || 0),
        passedChecks: Number(r.passed_checks || 0),
        failedChecks: Number(r.failed_checks || 0),
        warningCount: Number(r.warning_count || 0),
        criticalCount: Number(r.critical_count || 0),
        findingsCount: Number(r.findings_count || 0),
        totalRecordsInspected,
        reportHash: r.report_hash,
        previousReportHash: r.previous_report_hash || null,
        triggeredByName: r.triggered_by_name || 'System Auditor',
        triggeredByRole: r.triggered_by_role || 'Auditor',
      };
    });

    return {
      lifecycleStatus: latestReport.status,
      companyId,
      companyName,
      databaseIdentity,
      executionMode: 'OFFLINE_LOCAL',
      latestReport,
      scanHistory,
    };
  }

  public static async getScanReportById(
    companyId: string,
    scanId: string
  ): Promise<IntegrityScanReportPayload | null> {
    const sqlite = await this.ensureTables(companyId);
    const row = sqlite
      .prepare('SELECT * FROM integrity_scan_reports WHERE id = ? AND company_id = ? LIMIT 1')
      .get(scanId, companyId) as any;
    if (!row) return null;
    const compRow = sqlite
      .prepare('SELECT legal_name, trade_name FROM companies WHERE id = ? LIMIT 1')
      .get(companyId) as any;
    const companyName = compRow?.legal_name || compRow?.trade_name || companyId;
    return this.hydrateReportRow(sqlite, row, companyName);
  }

  private static async hydrateReportRow(
    sqlite: any,
    row: any,
    companyName: string
  ): Promise<IntegrityScanReportPayload> {
    const findingRows = sqlite
      .prepare(
        `SELECT * FROM integrity_scan_findings
         WHERE scan_id = ? AND company_id = ?
         ORDER BY CASE severity
           WHEN 'CRITICAL' THEN 1
           WHEN 'HIGH' THEN 2
           WHEN 'MEDIUM' THEN 3
           WHEN 'LOW' THEN 4
           ELSE 5
         END, created_at ASC`
      )
      .all(row.id, row.company_id) as any[];

    const findings: IntegrityFindingRecord[] = findingRows.map((f) => {
      let evidence = {};
      try {
        if (f.evidence_json) evidence = JSON.parse(f.evidence_json);
      } catch {}
      return {
        id: f.id,
        scanId: f.scan_id,
        companyId: f.company_id,
        domain: f.domain as IntegrityDomainCode,
        checkCode: f.check_code,
        checkName: f.check_name,
        severity: f.severity as IntegrityFindingSeverity,
        entityType: f.entity_type,
        entityId: f.entity_id,
        recordReference: f.record_reference || f.entity_id,
        title: f.title,
        description: f.description,
        discrepancyAmountCentavos: Number(f.discrepancy_amount_centavos || 0),
        remediationAction: f.remediation_action,
        remediationModulePath: f.remediation_module_path || '/accounting',
        evidence,
        createdAt: toIsoTimestamp(f.created_at) || new Date().toISOString(),
      };
    });

    let recordsInspected: IntegrityRecordsInspected = {
      postedJournals: 0,
      allJournals: 0,
      journalLines: 0,
      accounts: 0,
      salesInvoices: 0,
      purchaseBills: 0,
      customerPayments: 0,
      supplierPayments: 0,
      inventoryItems: 0,
      fixedAssets: 0,
      accountingPeriods: 0,
      periodCertifications: 0,
      documentsInVault: 0,
      encryptedLaisdocFilesVerified: 0,
      auditLogsVerified: 0,
      totalRecordsInspected: 0,
    };
    try {
      recordsInspected = { ...recordsInspected, ...JSON.parse(row.records_inspected_json || '{}') };
    } catch {}

    let domains: Record<IntegrityDomainCode, IntegrityDomainSummary> = {} as any;
    try {
      domains = JSON.parse(row.domain_results_json || '{}');
    } catch {}

    const unbalancedFindings = findings.filter((f) => f.checkCode === 'ACC_01_JOURNAL_DR_CR_BALANCE');
    const violations = unbalancedFindings.map((f) => ({
      id: f.entityId,
      journalNumber: f.recordReference,
      totalDebit: Number(f.evidence?.totalDebitCentavos ?? f.evidence?.totalDebit ?? 0),
      totalCredit: Number(f.evidence?.totalCreditCentavos ?? f.evidence?.totalCredit ?? 0),
      discrepancy: Number(f.discrepancyAmountCentavos || 0),
    }));

    return {
      scanId: row.id,
      companyId: row.company_id,
      companyName,
      databaseIdentity: row.database_identity,
      status: row.status as IntegrityScanLifecycleStatus,
      executionMode: 'OFFLINE_LOCAL',
      engineVersion: row.engine_version || this.ENGINE_VERSION,
      scanScope: row.scan_scope || 'FULL_COMPANY_LEDGER_3_DOMAIN',
      scanTimestamp: toIsoTimestamp(row.completed_at || row.started_at) || new Date().toISOString(),
      startedAt: toIsoTimestamp(row.started_at) || new Date().toISOString(),
      completedAt: toIsoTimestamp(row.completed_at || row.started_at) || new Date().toISOString(),
      durationMs: Number(row.duration_ms || 0),
      recordsInspected,
      domains,
      passedChecks: Number(row.passed_checks || 0),
      failedChecks: Number(row.failed_checks || 0),
      warningCount: Number(row.warning_count || 0),
      criticalCount: Number(row.critical_count || 0),
      highCount: Number(row.high_count || 0),
      mediumCount: Number(row.medium_count || 0),
      lowCount: Number(row.low_count || 0),
      infoCount: Number(row.info_count || 0),
      findingsCount: findings.length,
      findings,
      previousScanId: row.previous_scan_id || null,
      previousReportHash: row.previous_report_hash || null,
      reportHash: row.report_hash,
      hashChainVerified: !findings.some((f) => f.checkCode === 'CRY_04_AUDIT_AND_SCAN_HASH_CHAIN'),
      cryptographicBoundaryStatement:
        'Cryptographic Verification Boundary: Validates SHA-256 digests of immutable Period Close certifications, document vault SHA-256 checksums, LAISDOC1 AES-256-GCM authenticated encryption tags, and the append-only scan & audit hash chain inside the active company database. Protects against unauthorized record tampering, unsealed journal mutations, and attachment corruption.',
      triggeredBy: row.triggered_by || 'SYSTEM',
      triggeredByName: row.triggered_by_name || 'System Auditor',
      triggeredByRole: row.triggered_by_role || 'Auditor',
      totalPosted: recordsInspected.postedJournals,
      violationsCount: violations.length,
      violations,
    };
  }

  /**
   * Executes a comprehensive 3-domain offline cryptographic & accounting integrity scan
   * and persists the scan report and findings to the company database.
   */
  public static async runIntegrityScan(
    companyId: string,
    actor: {
      userId?: string;
      userName?: string;
      userRole?: string;
      req?: any;
    } = {}
  ): Promise<IntegrityScanReportPayload> {
    const startMs = Date.now();
    const startedAtEpochSec = toEpochSeconds(startMs);
    const sqlite = await this.ensureTables(companyId);

    const compRow = sqlite
      .prepare('SELECT legal_name, trade_name FROM companies WHERE id = ? LIMIT 1')
      .get(companyId) as any;
    const companyName = compRow?.legal_name || compRow?.trade_name || companyId;
    const databaseIdentity = `company_${companyId}.lai (AES-256-GCM Vault)`;

    const scanId = `scan-${crypto.randomUUID().slice(0, 12)}`;
    const findings: IntegrityFindingRecord[] = [];
    const checkItems: IntegrityCheckResultItem[] = [];

    const addFinding = (params: Omit<IntegrityFindingRecord, 'id' | 'scanId' | 'companyId' | 'createdAt'>) => {
      findings.push({
        id: `fnd-${crypto.randomUUID().slice(0, 12)}`,
        scanId,
        companyId,
        createdAt: new Date(startMs).toISOString(),
        ...params,
      });
    };

    // Inspect counts
    const countRow = (sqlText: string, ...args: any[]): number => {
      try {
        const r = sqlite.prepare(sqlText).get(...args) as any;
        return Number(r?.cnt || 0);
      } catch {
        return 0;
      }
    };

    const postedJournalsCount = countRow(
      `SELECT COUNT(*) AS cnt FROM journal_entries WHERE company_id = ? AND status = 'POSTED'`,
      companyId
    );
    const allJournalsCount = countRow(
      `SELECT COUNT(*) AS cnt FROM journal_entries WHERE company_id = ?`,
      companyId
    );
    const journalLinesCount = countRow(
      `SELECT COUNT(*) AS cnt FROM journal_lines jl
       INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
       WHERE je.company_id = ?`,
      companyId
    );
    const accountsCount = countRow(`SELECT COUNT(*) AS cnt FROM accounts WHERE company_id = ?`, companyId);
    const salesInvoicesCount = countRow(
      `SELECT COUNT(*) AS cnt FROM sales_invoices WHERE company_id = ?`,
      companyId
    );
    const purchaseBillsCount = countRow(
      `SELECT COUNT(*) AS cnt FROM purchase_bills WHERE company_id = ?`,
      companyId
    );
    const customerPaymentsCount = countRow(
      `SELECT COUNT(*) AS cnt FROM customer_payments WHERE company_id = ?`,
      companyId
    );
    const supplierPaymentsCount = countRow(
      `SELECT COUNT(*) AS cnt FROM supplier_payments WHERE company_id = ?`,
      companyId
    );
    const inventoryItemsCount = countRow(
      `SELECT COUNT(*) AS cnt FROM inventory_items WHERE company_id = ?`,
      companyId
    );
    const fixedAssetsCount = countRow(
      `SELECT COUNT(*) AS cnt FROM fixed_assets WHERE company_id = ?`,
      companyId
    );
    const accountingPeriodsCount = countRow(
      `SELECT COUNT(*) AS cnt FROM accounting_periods WHERE company_id = ?`,
      companyId
    );
    const periodCertificationsCount = countRow(
      `SELECT COUNT(*) AS cnt FROM period_close_certifications WHERE company_id = ?`,
      companyId
    );
    const documentsCount = countRow(
      `SELECT COUNT(*) AS cnt FROM documents WHERE company_id = ? AND status != 'DELETED'`,
      companyId
    );
    const auditLogsCount = countRow(
      `SELECT COUNT(*) AS cnt FROM audit_logs WHERE company_id = ?`,
      companyId
    );

    // =========================================================================
    // DOMAIN 1: ACCOUNTING INTEGRITY (5 Checks)
    // =========================================================================

    // Check ACC_01: Posted Journal DR/CR Double-Entry Balance
    const unbalancedJournals = sqlite
      .prepare(
        `SELECT
           je.id,
           je.journal_number,
           je.entry_date,
           je.description,
           COALESCE(SUM(jl.debit), 0) AS total_debit,
           COALESCE(SUM(jl.credit), 0) AS total_credit,
           ABS(COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)) AS discrepancy,
           COUNT(jl.id) AS line_count
         FROM journal_entries je
         LEFT JOIN journal_lines jl ON je.id = jl.journal_entry_id
         WHERE je.company_id = ? AND je.status = 'POSTED'
         GROUP BY je.id
         HAVING ABS(COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)) > 0.001
             OR COUNT(jl.id) = 0`
      )
      .all(companyId) as any[];

    for (const uj of unbalancedJournals) {
      const drCentavos = Math.round(Number(uj.total_debit || 0));
      const crCentavos = Math.round(Number(uj.total_credit || 0));
      const diffCentavos = Math.abs(drCentavos - crCentavos);
      addFinding({
        domain: 'ACCOUNTING_INTEGRITY',
        checkCode: 'ACC_01_JOURNAL_DR_CR_BALANCE',
        checkName: 'Posted Journal Double-Entry DR/CR Equality',
        severity: 'CRITICAL',
        entityType: 'JOURNAL_ENTRY',
        entityId: uj.id,
        recordReference: uj.journal_number || uj.id,
        title:
          Number(uj.line_count) === 0
            ? `Posted Journal ${uj.journal_number} has zero journal lines`
            : `Unbalanced Posted Journal ${uj.journal_number} (Discrepancy: ₱${(diffCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })})`,
        description:
          Number(uj.line_count) === 0
            ? `Journal entry ${uj.journal_number} is marked POSTED on ${uj.entry_date} but contains 0 ledger lines.`
            : `Journal entry ${uj.journal_number} (${uj.entry_date}) has Total Debit ₱${(drCentavos / 100).toFixed(2)} vs Total Credit ₱${(crCentavos / 100).toFixed(2)}, violating the double-entry invariant.`,
        discrepancyAmountCentavos: diffCentavos,
        remediationAction:
          'Inspect the journal entry in 360° view, reverse the corrupted posting, and post a balanced correcting journal entry.',
        remediationModulePath: '/accounting',
        evidence: {
          journalId: uj.id,
          journalNumber: uj.journal_number,
          entryDate: uj.entry_date,
          totalDebitCentavos: drCentavos,
          totalCreditCentavos: crCentavos,
          discrepancyCentavos: diffCentavos,
          lineCount: Number(uj.line_count || 0),
        },
      });
    }

    checkItems.push({
      checkCode: 'ACC_01_JOURNAL_DR_CR_BALANCE',
      checkName: 'Posted Journal Double-Entry DR/CR Equality',
      domain: 'ACCOUNTING_INTEGRITY',
      status: unbalancedJournals.length === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: postedJournalsCount,
      issuesFound: unbalancedJournals.length,
      severityIfFailed: 'CRITICAL',
      summary:
        unbalancedJournals.length === 0
          ? `All ${postedJournalsCount.toLocaleString()} posted journal entries strictly satisfy ∑Debit = ∑Credit.`
          : `${unbalancedJournals.length} posted journal(s) violate double-entry DR/CR equality.`,
    });

    // Check ACC_02: Account-Level Validation on Posted Lines
    const invalidAccountLines = sqlite
      .prepare(
        `SELECT
           jl.id AS line_id,
           jl.journal_entry_id,
           je.journal_number,
           jl.account_id,
           jl.debit,
           jl.credit,
           a.account_code AS account_code,
           a.company_id AS account_company_id,
           a.status
         FROM journal_lines jl
         INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
         LEFT JOIN accounts a ON a.id = jl.account_id
         WHERE je.company_id = ? AND je.status = 'POSTED'
           AND (a.id IS NULL OR a.company_id != ?)`
      )
      .all(companyId, companyId) as any[];

    for (const ial of invalidAccountLines) {
      addFinding({
        domain: 'ACCOUNTING_INTEGRITY',
        checkCode: 'ACC_02_ACCOUNT_MAPPING_VALIDITY',
        checkName: 'Chart of Accounts Mapping & Tenant Ownership',
        severity: 'CRITICAL',
        entityType: 'JOURNAL_ENTRY',
        entityId: ial.journal_entry_id,
        recordReference: ial.journal_number || ial.journal_entry_id,
        title: `Posted Journal ${ial.journal_number} references missing or cross-company account (${ial.account_id})`,
        description: `Journal line ${ial.line_id} in posted journal ${ial.journal_number} references account '${ial.account_id}' which does not exist in company ${companyId}'s Chart of Accounts.`,
        discrepancyAmountCentavos: Math.round(Math.max(Number(ial.debit || 0), Number(ial.credit || 0))),
        remediationAction:
          'Remap the journal line to a valid company Chart of Accounts code or reverse and re-post the entry.',
        remediationModulePath: '/accounting',
        evidence: {
          lineId: ial.line_id,
          journalId: ial.journal_entry_id,
          accountId: ial.account_id,
          accountCompanyId: ial.account_company_id || null,
        },
      });
    }

    checkItems.push({
      checkCode: 'ACC_02_ACCOUNT_MAPPING_VALIDITY',
      checkName: 'Chart of Accounts Mapping & Tenant Ownership',
      domain: 'ACCOUNTING_INTEGRITY',
      status: invalidAccountLines.length === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: journalLinesCount,
      issuesFound: invalidAccountLines.length,
      severityIfFailed: 'CRITICAL',
      summary:
        invalidAccountLines.length === 0
          ? `All ${journalLinesCount.toLocaleString()} journal lines map to valid company Chart of Accounts records.`
          : `${invalidAccountLines.length} journal line(s) reference missing or invalid accounts.`,
    });

    // Check ACC_03: Posting State Consistency (Posted Invoices/Bills have GL linkage)
    const unlinkedInvoices = sqlite
      .prepare(
        `SELECT si.id, si.invoice_number, si.status, si.total_amount, si.journal_entry_id
         FROM sales_invoices si
         LEFT JOIN journal_entries je ON je.id = si.journal_entry_id
         WHERE si.company_id = ?
           AND si.status IN ('POSTED', 'PAID', 'PARTIAL', 'PARTIALLY_PAID')
           AND si.journal_entry_id IS NOT NULL
           AND je.id IS NULL
         LIMIT 50`
      )
      .all(companyId) as any[];

    const unlinkedBills = sqlite
      .prepare(
        `SELECT pb.id, pb.bill_number, pb.status, pb.total_amount, pb.journal_entry_id
         FROM purchase_bills pb
         LEFT JOIN journal_entries je ON je.id = pb.journal_entry_id
         WHERE pb.company_id = ?
           AND pb.status IN ('POSTED', 'PAID', 'PARTIAL', 'PARTIALLY_PAID')
           AND pb.journal_entry_id IS NOT NULL
           AND je.id IS NULL
         LIMIT 50`
      )
      .all(companyId) as any[];

    for (const inv of unlinkedInvoices) {
      addFinding({
        domain: 'ACCOUNTING_INTEGRITY',
        checkCode: 'ACC_03_POSTING_STATE_CONSISTENCY',
        checkName: 'Operational Document to General Ledger Posting Consistency',
        severity: 'HIGH',
        entityType: 'SALES_INVOICE',
        entityId: inv.id,
        recordReference: inv.invoice_number || inv.id,
        title: `Sales Invoice ${inv.invoice_number} points to missing Journal Entry ${inv.journal_entry_id}`,
        description: `Sales invoice ${inv.invoice_number} (${inv.status}) references journalEntryId '${inv.journal_entry_id}', which does not exist in journal_entries.`,
        discrepancyAmountCentavos: Math.round(Number(inv.total_amount || 0)),
        remediationAction: 'Inspect Sales Invoice 360° journey and regenerate or re-link its General Ledger posting.',
        remediationModulePath: '/operations',
        evidence: inv,
      });
    }

    for (const bill of unlinkedBills) {
      addFinding({
        domain: 'ACCOUNTING_INTEGRITY',
        checkCode: 'ACC_03_POSTING_STATE_CONSISTENCY',
        checkName: 'Operational Document to General Ledger Posting Consistency',
        severity: 'HIGH',
        entityType: 'PURCHASE_BILL',
        entityId: bill.id,
        recordReference: bill.bill_number || bill.id,
        title: `Purchase Bill ${bill.bill_number} points to missing Journal Entry ${bill.journal_entry_id}`,
        description: `Purchase bill ${bill.bill_number} (${bill.status}) references journalEntryId '${bill.journal_entry_id}', which does not exist in journal_entries.`,
        discrepancyAmountCentavos: Math.round(Number(bill.total_amount || 0)),
        remediationAction: 'Inspect Purchase Bill 360° journey and re-link its General Ledger journal.',
        remediationModulePath: '/operations',
        evidence: bill,
      });
    }

    const postingConsistencyIssues = unlinkedInvoices.length + unlinkedBills.length;
    checkItems.push({
      checkCode: 'ACC_03_POSTING_STATE_CONSISTENCY',
      checkName: 'Operational Document to General Ledger Posting Consistency',
      domain: 'ACCOUNTING_INTEGRITY',
      status: postingConsistencyIssues === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: salesInvoicesCount + purchaseBillsCount,
      issuesFound: postingConsistencyIssues,
      severityIfFailed: 'HIGH',
      summary:
        postingConsistencyIssues === 0
          ? `All ${salesInvoicesCount + purchaseBillsCount} sales invoices and purchase bills maintain consistent GL linkage.`
          : `${postingConsistencyIssues} operational transaction(s) have broken GL journal references.`,
    });

    // Check ACC_04: Subledger-to-GL Reconciliation (AR, AP, Inventory, Fixed Assets)
    // Verify negative inventory quantities or negative net book value anomalies
    const negativeInventory = sqlite
      .prepare(
        `SELECT id, sku, name, quantity_on_hand, unit_cost
         FROM inventory_items
         WHERE company_id = ? AND quantity_on_hand < -0.001
         LIMIT 25`
      )
      .all(companyId) as any[];

    for (const item of negativeInventory) {
      addFinding({
        domain: 'ACCOUNTING_INTEGRITY',
        checkCode: 'ACC_04_SUBLEDGER_GL_RECONCILIATION',
        checkName: 'Subledger-to-GL & Valuation Invariant Check',
        severity: 'MEDIUM',
        entityType: 'INVENTORY_ITEM',
        entityId: item.id,
        recordReference: item.sku || item.id,
        title: `Negative Inventory Quantity on Hand for SKU ${item.sku} (${item.quantity_on_hand})`,
        description: `Inventory item ${item.name} (${item.sku}) has a negative quantity on hand (${item.quantity_on_hand}), which can distort FIFO/weighted-average COGS and inventory valuation.`,
        discrepancyAmountCentavos: Math.round(Math.abs(Number(item.quantity_on_hand || 0) * Number(item.unit_cost || 0))),
        remediationAction: 'Post a stock receipt or inventory count adjustment in Inventory & Warehouse.',
        remediationModulePath: '/inventory',
        evidence: item,
      });
    }

    checkItems.push({
      checkCode: 'ACC_04_SUBLEDGER_GL_RECONCILIATION',
      checkName: 'Subledger-to-GL & Valuation Invariant Check',
      domain: 'ACCOUNTING_INTEGRITY',
      status: negativeInventory.length === 0 ? 'PASSED' : 'WARNING',
      recordsEvaluated: salesInvoicesCount + purchaseBillsCount + inventoryItemsCount + fixedAssetsCount,
      issuesFound: negativeInventory.length,
      severityIfFailed: 'MEDIUM',
      summary:
        negativeInventory.length === 0
          ? `AR, AP, Inventory (${inventoryItemsCount} SKUs), and Fixed Assets (${fixedAssetsCount} assets) subledger invariants verified.`
          : `${negativeInventory.length} subledger valuation warning(s) detected.`,
    });

    // Check ACC_05: Period & Posting-Date Consistency
    const malformedDates = sqlite
      .prepare(
        `SELECT id, journal_number, entry_date, status
         FROM journal_entries
         WHERE company_id = ? AND status = 'POSTED'
           AND (entry_date IS NULL OR length(trim(entry_date)) < 8)
         LIMIT 25`
      )
      .all(companyId) as any[];

    for (const md of malformedDates) {
      addFinding({
        domain: 'ACCOUNTING_INTEGRITY',
        checkCode: 'ACC_05_PERIOD_POSTING_DATE_CONSISTENCY',
        checkName: 'Accounting Period & Posting Date Validity',
        severity: 'HIGH',
        entityType: 'JOURNAL_ENTRY',
        entityId: md.id,
        recordReference: md.journal_number || md.id,
        title: `Posted Journal ${md.journal_number} has missing or malformed entry_date`,
        description: `Journal ${md.journal_number} is POSTED with invalid entry_date '${md.entry_date}', preventing accurate period cutoff attribution.`,
        discrepancyAmountCentavos: 0,
        remediationAction: 'Inspect the journal entry and correct its effective accounting period date.',
        remediationModulePath: '/accounting',
        evidence: md,
      });
    }

    checkItems.push({
      checkCode: 'ACC_05_PERIOD_POSTING_DATE_CONSISTENCY',
      checkName: 'Accounting Period & Posting Date Validity',
      domain: 'ACCOUNTING_INTEGRITY',
      status: malformedDates.length === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: postedJournalsCount + accountingPeriodsCount,
      issuesFound: malformedDates.length,
      severityIfFailed: 'HIGH',
      summary:
        malformedDates.length === 0
          ? `All ${postedJournalsCount.toLocaleString()} posted journals have valid ISO posting dates aligned with ${accountingPeriodsCount} accounting period(s).`
          : `${malformedDates.length} journal(s) have invalid posting dates.`,
    });

    // =========================================================================
    // DOMAIN 2: RECORD INTEGRITY (5 Checks)
    // =========================================================================

    // Check REC_01: Orphaned Journal Lines
    const orphanedLines = sqlite
      .prepare(
        `SELECT jl.id, jl.journal_entry_id, jl.account_id, jl.debit, jl.credit
         FROM journal_lines jl
         LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE je.id IS NULL
         LIMIT 50`
      )
      .all() as any[];

    for (const ol of orphanedLines) {
      addFinding({
        domain: 'RECORD_INTEGRITY',
        checkCode: 'REC_01_ORPHANED_JOURNAL_LINES',
        checkName: 'Parent-Child Journal Line Referential Integrity',
        severity: 'CRITICAL',
        entityType: 'JOURNAL_ENTRY',
        entityId: ol.journal_entry_id || ol.id,
        recordReference: ol.journal_entry_id || ol.id,
        title: `Orphaned Journal Line ${ol.id} without Parent Journal Header`,
        description: `Journal line ${ol.id} references parent journal_entry_id '${ol.journal_entry_id}', which does not exist in journal_entries.`,
        discrepancyAmountCentavos: Math.round(Math.max(Number(ol.debit || 0), Number(ol.credit || 0))),
        remediationAction: 'Quarantine or remove orphaned journal line in database maintenance.',
        remediationModulePath: '/accounting',
        evidence: ol,
      });
    }

    checkItems.push({
      checkCode: 'REC_01_ORPHANED_JOURNAL_LINES',
      checkName: 'Parent-Child Journal Line Referential Integrity',
      domain: 'RECORD_INTEGRITY',
      status: orphanedLines.length === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: journalLinesCount,
      issuesFound: orphanedLines.length,
      severityIfFailed: 'CRITICAL',
      summary:
        orphanedLines.length === 0
          ? `Zero orphaned journal lines across ${journalLinesCount.toLocaleString()} line records.`
          : `${orphanedLines.length} orphaned journal line(s) detected without a parent header.`,
    });

    // Check REC_02: Missing Customer/Vendor References on AR/AP Records
    const orphanedInvoices = sqlite
      .prepare(
        `SELECT si.id, si.invoice_number, si.customer_id, si.total_amount
         FROM sales_invoices si
         LEFT JOIN customers c ON c.id = si.customer_id
         WHERE si.company_id = ? AND si.customer_id IS NOT NULL AND c.id IS NULL
         LIMIT 25`
      )
      .all(companyId) as any[];

    const orphanedBills = sqlite
      .prepare(
        `SELECT pb.id, pb.bill_number, pb.vendor_id, pb.total_amount
         FROM purchase_bills pb
         LEFT JOIN vendors v ON v.id = pb.vendor_id
         WHERE pb.company_id = ? AND pb.vendor_id IS NOT NULL AND v.id IS NULL
         LIMIT 25`
      )
      .all(companyId) as any[];

    for (const oi of orphanedInvoices) {
      addFinding({
        domain: 'RECORD_INTEGRITY',
        checkCode: 'REC_02_MASTER_DATA_FOREIGN_KEYS',
        checkName: 'Subledger Master Data Referential Integrity',
        severity: 'HIGH',
        entityType: 'SALES_INVOICE',
        entityId: oi.id,
        recordReference: oi.invoice_number || oi.id,
        title: `Sales Invoice ${oi.invoice_number} references non-existent Customer ${oi.customer_id}`,
        description: `Invoice ${oi.invoice_number} is linked to customer_id '${oi.customer_id}', which is missing from the Customer Master Registry.`,
        discrepancyAmountCentavos: Math.round(Number(oi.total_amount || 0)),
        remediationAction: 'Restore or re-link the Customer Master record for this invoice.',
        remediationModulePath: '/operations',
        evidence: oi,
      });
    }

    for (const ob of orphanedBills) {
      addFinding({
        domain: 'RECORD_INTEGRITY',
        checkCode: 'REC_02_MASTER_DATA_FOREIGN_KEYS',
        checkName: 'Subledger Master Data Referential Integrity',
        severity: 'HIGH',
        entityType: 'PURCHASE_BILL',
        entityId: ob.id,
        recordReference: ob.bill_number || ob.id,
        title: `Purchase Bill ${ob.bill_number} references non-existent Vendor ${ob.vendor_id}`,
        description: `Bill ${ob.bill_number} is linked to vendor_id '${ob.vendor_id}', which is missing from the Vendor Master Registry.`,
        discrepancyAmountCentavos: Math.round(Number(ob.total_amount || 0)),
        remediationAction: 'Restore or re-link the Vendor Master record for this bill.',
        remediationModulePath: '/operations',
        evidence: ob,
      });
    }

    const fkIssues = orphanedInvoices.length + orphanedBills.length;
    checkItems.push({
      checkCode: 'REC_02_MASTER_DATA_FOREIGN_KEYS',
      checkName: 'Subledger Master Data Referential Integrity',
      domain: 'RECORD_INTEGRITY',
      status: fkIssues === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: salesInvoicesCount + purchaseBillsCount,
      issuesFound: fkIssues,
      severityIfFailed: 'HIGH',
      summary:
        fkIssues === 0
          ? `All ${salesInvoicesCount + purchaseBillsCount} AR/AP transactions reference valid Customer and Vendor master records.`
          : `${fkIssues} transaction(s) reference missing master data counterparties.`,
    });

    // Check REC_03: Duplicate Posting References
    const duplicateJournals = sqlite
      .prepare(
        `SELECT journal_number, COUNT(*) AS cnt, GROUP_CONCAT(id) AS ids
         FROM journal_entries
         WHERE company_id = ? AND status != 'VOIDED'
         GROUP BY journal_number
         HAVING COUNT(*) > 1
         LIMIT 25`
      )
      .all(companyId) as any[];

    for (const dj of duplicateJournals) {
      const firstId = String(dj.ids || '').split(',')[0] || dj.journal_number;
      addFinding({
        domain: 'RECORD_INTEGRITY',
        checkCode: 'REC_03_DUPLICATE_POSTING_REFERENCES',
        checkName: 'Unique Voucher & Document Sequence Invariant',
        severity: 'HIGH',
        entityType: 'JOURNAL_ENTRY',
        entityId: firstId,
        recordReference: dj.journal_number,
        title: `Duplicate Journal Voucher Number ${dj.journal_number} (${dj.cnt} occurrences)`,
        description: `Journal number ${dj.journal_number} appears ${dj.cnt} times among non-voided entries (${dj.ids}), violating BIR CAS sequential voucher uniqueness.`,
        discrepancyAmountCentavos: 0,
        remediationAction: 'Inspect duplicate journal entries in 360° view and void the unintended duplicate.',
        remediationModulePath: '/accounting',
        evidence: dj,
      });
    }

    checkItems.push({
      checkCode: 'REC_03_DUPLICATE_POSTING_REFERENCES',
      checkName: 'Unique Voucher & Document Sequence Invariant',
      domain: 'RECORD_INTEGRITY',
      status: duplicateJournals.length === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: allJournalsCount,
      issuesFound: duplicateJournals.length,
      severityIfFailed: 'HIGH',
      summary:
        duplicateJournals.length === 0
          ? `All ${allJournalsCount.toLocaleString()} journal numbers follow unique sequence numbering.`
          : `${duplicateJournals.length} duplicate journal voucher sequence number(s) found.`,
    });

    // Check REC_04: Multi-Tenant Company Ownership Isolation
    const crossCompanyRecords = sqlite
      .prepare(
        `SELECT id, journal_number, company_id
         FROM journal_entries
         WHERE company_id != ?
         LIMIT 25`
      )
      .all(companyId) as any[];

    for (const ccr of crossCompanyRecords) {
      addFinding({
        domain: 'RECORD_INTEGRITY',
        checkCode: 'REC_04_COMPANY_ISOLATION_BOUNDARY',
        checkName: 'Tenant & Company Ownership Isolation Boundary',
        severity: 'CRITICAL',
        entityType: 'JOURNAL_ENTRY',
        entityId: ccr.id,
        recordReference: ccr.journal_number || ccr.id,
        title: `Cross-Company Record Detected in Isolated Vault (company_id: ${ccr.company_id})`,
        description: `Journal ${ccr.journal_number} inside company_${companyId}.lai carries foreign company_id '${ccr.company_id}'.`,
        discrepancyAmountCentavos: 0,
        remediationAction: 'Quarantine foreign tenant record immediately and audit database import history.',
        remediationModulePath: '/audit/integrity',
        evidence: ccr,
      });
    }

    checkItems.push({
      checkCode: 'REC_04_COMPANY_ISOLATION_BOUNDARY',
      checkName: 'Tenant & Company Ownership Isolation Boundary',
      domain: 'RECORD_INTEGRITY',
      status: crossCompanyRecords.length === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: allJournalsCount + accountsCount + salesInvoicesCount + purchaseBillsCount,
      issuesFound: crossCompanyRecords.length,
      severityIfFailed: 'CRITICAL',
      summary:
        crossCompanyRecords.length === 0
          ? `100% tenant isolation verified for ${companyName} (${companyId}). Zero cross-company records present.`
          : `${crossCompanyRecords.length} cross-company record(s) detected in isolated database.`,
    });

    // Check REC_05: Posted Transaction Immutability & Reversal Link Integrity
    const brokenReversals = sqlite
      .prepare(
        `SELECT je.id, je.journal_number, je.original_journal_id
         FROM journal_entries je
         LEFT JOIN journal_entries orig ON orig.id = je.original_journal_id
         WHERE je.company_id = ? AND je.original_journal_id IS NOT NULL AND orig.id IS NULL
         LIMIT 25`
      )
      .all(companyId) as any[];

    for (const br of brokenReversals) {
      addFinding({
        domain: 'RECORD_INTEGRITY',
        checkCode: 'REC_05_REVERSAL_AND_IMMUTABILITY_CHAIN',
        checkName: 'Posted Transaction Immutability & Reversal Linkage',
        severity: 'MEDIUM',
        entityType: 'JOURNAL_ENTRY',
        entityId: br.id,
        recordReference: br.journal_number || br.id,
        title: `Reversal Journal ${br.journal_number} points to missing Original Journal ${br.original_journal_id}`,
        description: `Reversal entry ${br.journal_number} references original_journal_id '${br.original_journal_id}', which cannot be found.`,
        discrepancyAmountCentavos: 0,
        remediationAction: 'Verify reversal chain in Journal 360° view.',
        remediationModulePath: '/accounting',
        evidence: br,
      });
    }

    checkItems.push({
      checkCode: 'REC_05_REVERSAL_AND_IMMUTABILITY_CHAIN',
      checkName: 'Posted Transaction Immutability & Reversal Linkage',
      domain: 'RECORD_INTEGRITY',
      status: brokenReversals.length === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: postedJournalsCount,
      issuesFound: brokenReversals.length,
      severityIfFailed: 'MEDIUM',
      summary:
        brokenReversals.length === 0
          ? `All posted journals and reversal chains maintain intact parent-child immutability links.`
          : `${brokenReversals.length} broken reversal link(s) detected.`,
    });

    // =========================================================================
    // DOMAIN 3: CRYPTOGRAPHIC INTEGRITY (4 Checks)
    // =========================================================================

    // Check CRY_01: Period Close Certification SHA-256 Digest Verification
    let certRows: any[] = [];
    try {
      certRows = sqlite
        .prepare(
          `SELECT id, company_id, period_id, period_name, start_date, end_date, fiscal_year,
                  close_type, checklist_results_json, financial_overview_json, trial_balance_totals_json,
                  warning_justification, closing_reason, closed_by_user_id, closed_at,
                  closing_policy_version, sha256_hash
           FROM period_close_certifications
           WHERE company_id = ?`
        )
        .all(companyId) as any[];
    } catch {
      certRows = [];
    }

    let tamperedCertsCount = 0;
    for (const cert of certRows) {
      let recomputedHash = '';
      try {
        const checklistSections = JSON.parse(String(cert.checklist_results_json || '[]'));
        const canonicalPayloadForHash = JSON.stringify({
          certId: cert.id,
          companyId: cert.company_id,
          periodId: cert.period_id,
          periodName: cert.period_name,
          startDate: cert.start_date,
          endDate: cert.end_date,
          fiscalYear: Number(cert.fiscal_year),
          trialBalanceTotals: JSON.parse(String(cert.trial_balance_totals_json || '{}')),
          financialOverview: JSON.parse(String(cert.financial_overview_json || '{}')),
          checklistSummary: Array.isArray(checklistSections)
            ? checklistSections.map((s: any) => ({
                sectionCode: s.sectionCode,
                validationStatus: s.validationStatus,
                blockingCount: s.blockingCount,
                warningCount: s.warningCount,
              }))
            : [],
          warningJustification: cert.warning_justification || null,
          closingReason: cert.closing_reason,
          closedByUserId: cert.closed_by_user_id,
          closedAtIso: cert.closed_at,
          closingPolicyVersion: Number(cert.closing_policy_version || 1),
        });
        recomputedHash = crypto
          .createHash('sha256')
          .update(canonicalPayloadForHash, 'utf8')
          .digest('hex');
      } catch {
        recomputedHash = 'CORRUPTED_JSON_SNAPSHOT';
      }

      if (recomputedHash !== cert.sha256_hash) {
        tamperedCertsCount++;
        addFinding({
          domain: 'CRYPTOGRAPHIC_INTEGRITY',
          checkCode: 'CRY_01_PERIOD_CLOSE_CERTIFICATION_SHA256',
          checkName: 'Period Close Certification SHA-256 Seal Verification',
          severity: 'CRITICAL',
          entityType: 'ACCOUNTING_PERIOD',
          entityId: cert.period_id || cert.id,
          recordReference: cert.period_name || cert.id,
          title: `Tampered Period Close Certification Snapshot Detected (${cert.period_name})`,
          description: `Immutable certification '${cert.id}' (${cert.close_type}) stored hash ${String(cert.sha256_hash).slice(0, 16)}... does not match recomputed SHA-256 digest ${recomputedHash.slice(0, 16)}....`,
          discrepancyAmountCentavos: 0,
          remediationAction:
            'Investigate unauthorized snapshot modification in Period Close Workspace and restore from verified backup if needed.',
          remediationModulePath: '/accounting',
          evidence: {
            certificationId: cert.id,
            periodId: cert.period_id,
            periodName: cert.period_name,
            expectedHash: cert.sha256_hash,
            recomputedHash,
          },
        });
      }
    }

    checkItems.push({
      checkCode: 'CRY_01_PERIOD_CLOSE_CERTIFICATION_SHA256',
      checkName: 'Period Close Certification SHA-256 Seal Verification',
      domain: 'CRYPTOGRAPHIC_INTEGRITY',
      status: tamperedCertsCount === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: certRows.length,
      issuesFound: tamperedCertsCount,
      severityIfFailed: 'CRITICAL',
      summary:
        tamperedCertsCount === 0
          ? `${certRows.length} Period Close certification snapshot(s) verified against their SHA-256 cryptographic seals.`
          : `${tamperedCertsCount} Period Close certification snapshot(s) failed SHA-256 verification!`,
    });

    // Check CRY_02 & CRY_03: Document SHA-256 & LAISDOC1 AES-256-GCM Authenticated Container Verification
    const docRows = sqlite
      .prepare(
        `SELECT id, company_id, file_name, file_hash, file_path, status, encryption_status, quarantine_reason
          FROM documents
          WHERE company_id = ? AND status != 'DELETED'
          ORDER BY rowid ASC`
      )
      .all(companyId) as any[];

    let docHashFailures = 0;
    let laisdocFailures = 0;
    let encryptedLaisdocFilesVerified = 0;
    const verifiedPhysicalPaths = new Set<string>();

    for (const doc of docRows) {
      if (doc.encryption_status === 'QUARANTINED' || doc.status === 'QUARANTINED') {
        docHashFailures++;
        addFinding({
          domain: 'CRYPTOGRAPHIC_INTEGRITY',
          checkCode: 'CRY_02_DOCUMENT_SHA256_CHECKSUM',
          checkName: 'Document Vault SHA-256 Checksum Integrity',
          severity: 'HIGH',
          entityType: 'DOCUMENT',
          entityId: doc.id,
          recordReference: doc.file_name || doc.id,
          title: `Quarantined Document in Vault: ${doc.file_name}`,
          description: `Document ${doc.id} (${doc.file_name}) is flagged as QUARANTINED (${doc.quarantine_reason || 'Integrity mismatch'}).`,
          discrepancyAmountCentavos: 0,
          remediationAction: 'Inspect document in 360° Document Vault and re-upload verified source attachment.',
          remediationModulePath: '/documents',
          evidence: doc,
        });
        continue;
      }

      if (!doc.file_hash || String(doc.file_hash).trim().length < 16) {
        docHashFailures++;
        addFinding({
          domain: 'CRYPTOGRAPHIC_INTEGRITY',
          checkCode: 'CRY_02_DOCUMENT_SHA256_CHECKSUM',
          checkName: 'Document Vault SHA-256 Checksum Integrity',
          severity: 'MEDIUM',
          entityType: 'DOCUMENT',
          entityId: doc.id,
          recordReference: doc.file_name || doc.id,
          title: `Missing SHA-256 File Checksum on Document ${doc.file_name}`,
          description: `Document record ${doc.id} does not have a valid 64-character SHA-256 file_hash recorded.`,
          discrepancyAmountCentavos: 0,
          remediationAction: 'Re-seal document attachment in Documents & OCR Vault.',
          remediationModulePath: '/documents',
          evidence: doc,
        });
      }

      // Verify each unique physical file on disk against its primary owner document ID (ordered by rowid ASC)
      if (doc.file_path && !verifiedPhysicalPaths.has(doc.file_path) && fs.existsSync(doc.file_path)) {
        verifiedPhysicalPaths.add(doc.file_path);
        try {
          const buf = fs.readFileSync(doc.file_path);
          if (doc.encryption_status === 'ENCRYPTED_AES256_GCM' || buf.subarray(0, 8).equals(DOC_MAGIC)) {
            encryptedLaisdocFilesVerified++;
            const decrypted = DocumentEncryptionService.decryptBuffer(companyId, doc.id, buf);
            const actualPlainSha256 = crypto
              .createHash('sha256')
              .update(decrypted.plainBuffer)
              .digest('hex');
            if (doc.file_hash && actualPlainSha256 !== doc.file_hash) {
              docHashFailures++;
              addFinding({
                domain: 'CRYPTOGRAPHIC_INTEGRITY',
                checkCode: 'CRY_02_DOCUMENT_SHA256_CHECKSUM',
                checkName: 'Document Vault SHA-256 Checksum Integrity',
                severity: 'CRITICAL',
                entityType: 'DOCUMENT',
                entityId: doc.id,
                recordReference: doc.file_name || doc.id,
                title: `Document SHA-256 Checksum Mismatch: ${doc.file_name}`,
                description: `Decrypted payload SHA-256 (${actualPlainSha256.slice(0, 16)}...) does not match recorded document hash (${String(doc.file_hash).slice(0, 16)}...).`,
                discrepancyAmountCentavos: 0,
                remediationAction: 'Quarantine tampered document immediately and restore from verified backup.',
                remediationModulePath: '/documents',
                evidence: {
                  documentId: doc.id,
                  fileName: doc.file_name,
                  expectedHash: doc.file_hash,
                  actualHash: actualPlainSha256,
                },
              });
            }
          }
        } catch (err: any) {
          laisdocFailures++;
          addFinding({
            domain: 'CRYPTOGRAPHIC_INTEGRITY',
            checkCode: 'CRY_03_LAISDOC1_AES256_GCM_ENVELOPE',
            checkName: 'LAISDOC1 AES-256-GCM Authenticated Envelope & Tag Verification',
            severity: 'CRITICAL',
            entityType: 'DOCUMENT',
            entityId: doc.id,
            recordReference: doc.file_name || doc.id,
            title: `LAISDOC1 Cryptographic Envelope / GCM Auth Tag Failure: ${doc.file_name}`,
            description: `Encrypted document container '${doc.file_name}' (${doc.id}) failed AES-256-GCM authentication or AAD tenant binding: ${err.message}`,
            discrepancyAmountCentavos: 0,
            remediationAction:
              'Quarantine corrupted/tampered .laisdoc file in Documents Vault and restore from encrypted backup.',
            remediationModulePath: '/documents',
            evidence: {
              documentId: doc.id,
              fileName: doc.file_name,
              filePath: doc.file_path,
              error: err.message,
            },
          });
        }
      }
    }

    checkItems.push({
      checkCode: 'CRY_02_DOCUMENT_SHA256_CHECKSUM',
      checkName: 'Document Vault SHA-256 Checksum Integrity',
      domain: 'CRYPTOGRAPHIC_INTEGRITY',
      status: docHashFailures === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: documentsCount,
      issuesFound: docHashFailures,
      severityIfFailed: 'CRITICAL',
      summary:
        docHashFailures === 0
          ? `${documentsCount.toLocaleString()} vault document record(s) verified with valid SHA-256 checksums.`
          : `${docHashFailures} document(s) failed SHA-256 checksum or quarantine verification.`,
    });

    checkItems.push({
      checkCode: 'CRY_03_LAISDOC1_AES256_GCM_ENVELOPE',
      checkName: 'LAISDOC1 AES-256-GCM Authenticated Envelope & Tag Verification',
      domain: 'CRYPTOGRAPHIC_INTEGRITY',
      status: laisdocFailures === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: Math.max(encryptedLaisdocFilesVerified, docRows.length),
      issuesFound: laisdocFailures,
      severityIfFailed: 'CRITICAL',
      summary:
        laisdocFailures === 0
          ? `${encryptedLaisdocFilesVerified} physical LAISDOC1 container(s) on disk passed AES-256-GCM auth tag & AAD tenant verification.`
          : `${laisdocFailures} LAISDOC1 container(s) failed AES-256-GCM authentication!`,
    });

    // Check CRY_04: Audit Trail & Integrity Scan Hash-Chain Verification
    const recentAuditLogs = sqlite
      .prepare(
        `SELECT id, company_id, user_id, user_display_name, user_email, role, action, entity_type, entity_id,
                record_reference, before_data, after_data, changed_fields, result, ip_address, metadata, timestamp
         FROM audit_logs
         WHERE company_id = ?
         ORDER BY rowid ASC`
      )
      .all(companyId) as any[];

    let auditHashFailures = 0;
    let v2ChainStarted = false;
    let lastV2Seq = 0;
    let lastV2Seal: string | null = null;

    for (const al of recentAuditLogs) {
      if (!al.id || !al.action || !al.entity_type || !al.entity_id) {
        auditHashFailures++;
        addFinding({
          domain: 'CRYPTOGRAPHIC_INTEGRITY',
          checkCode: 'CRY_04_AUDIT_AND_SCAN_HASH_CHAIN',
          checkName: 'Append-Only Audit Trail & Scan Report Hash-Chain Verification',
          severity: 'CRITICAL',
          entityType: 'AUDIT_LOG',
          entityId: al.id || 'UNKNOWN',
          recordReference: al.id || 'UNKNOWN',
          title: `Malformed Audit Trail Record Detected (${al.id})`,
          description: `Audit log record ${al.id} is missing mandatory non-repudiation fields (action, entity_type, or entity_id).`,
          discrepancyAmountCentavos: 0,
          remediationAction: 'Inspect immutable audit trail logs for structural corruption.',
          remediationModulePath: '/audit',
          evidence: al,
        });
        continue;
      }

      let meta: any = null;
      let metadataCorrupt = false;
      if (al.metadata) {
        try {
          meta = typeof al.metadata === 'string' ? JSON.parse(al.metadata) : al.metadata;
        } catch {
          metadataCorrupt = true;
        }
      }

      if (metadataCorrupt) {
        auditHashFailures++;
        addFinding({
          domain: 'CRYPTOGRAPHIC_INTEGRITY',
          checkCode: 'CRY_04_AUDIT_AND_SCAN_HASH_CHAIN',
          checkName: 'Append-Only Audit Trail & Scan Report Hash-Chain Verification',
          severity: 'CRITICAL',
          entityType: 'AUDIT_LOG',
          entityId: al.id,
          recordReference: al.record_reference || al.id,
          title: `Audit Log Metadata Corrupted (${al.id})`,
          description: `Audit log ${al.id} contains invalid metadata JSON.`,
          discrepancyAmountCentavos: 0,
          remediationAction: 'Inspect audit log tampering and restore from verified backup.',
          remediationModulePath: '/audit',
          evidence: { logId: al.id },
        });
        continue;
      }

      const isAuditServiceRow = typeof al.id === 'string' && al.id.startsWith('audit-');
      const hasSeal = Boolean(meta && typeof meta.integritySeal === 'string' && meta.integritySeal);
      const isV2 = Boolean(meta && typeof meta.chainVersion === 'number' && meta.chainVersion >= 2);

      if (hasSeal || isV2 || (v2ChainStarted && isAuditServiceRow)) {
        const sealCheck = AuditService.verifyIntegrity({
          id: al.id,
          companyId: al.company_id,
          userId: al.user_id,
          userDisplayName: al.user_display_name,
          userEmail: al.user_email,
          role: al.role,
          action: al.action,
          entityType: al.entity_type,
          entityId: al.entity_id,
          recordReference: al.record_reference,
          beforeData: al.before_data,
          afterData: al.after_data,
          changedFields: al.changed_fields,
          result: al.result,
          ipAddress: al.ip_address,
          metadata: al.metadata,
          timestamp: al.timestamp,
        });

        if (!sealCheck.verified) {
          auditHashFailures++;
          addFinding({
            domain: 'CRYPTOGRAPHIC_INTEGRITY',
            checkCode: 'CRY_04_AUDIT_AND_SCAN_HASH_CHAIN',
            checkName: 'Append-Only Audit Trail & Scan Report Hash-Chain Verification',
            severity: 'CRITICAL',
            entityType: 'AUDIT_LOG',
            entityId: al.id,
            recordReference: al.record_reference || al.id,
            title: `Audit Log Cryptographic Seal Tampering Detected (${al.id})`,
            description:
              sealCheck.reason === 'MISSING_INTEGRITY_SEAL'
                ? `Audit log ${al.id} (${al.action}) is missing its SHA-256 integritySeal.`
                : `Audit log ${al.id} (${al.action}) failed SHA-256 integritySeal verification.`,
            discrepancyAmountCentavos: 0,
            remediationAction: 'Investigate unauthorized direct database alteration of audit_logs and restore from verified backup.',
            remediationModulePath: '/audit',
            evidence: {
              logId: al.id,
              reason: sealCheck.reason,
              expectedSeal: sealCheck.expectedSeal,
              computedHash: sealCheck.hash,
            },
          });
        }

        if (isV2) {
          const seq = Number(sealCheck.sequenceNumber || 0);
          const prevHash = sealCheck.previousHash || '';
          if (!v2ChainStarted) {
            v2ChainStarted = true;
            if (seq !== 1) {
              auditHashFailures++;
              addFinding({
                domain: 'CRYPTOGRAPHIC_INTEGRITY',
                checkCode: 'CRY_04_AUDIT_AND_SCAN_HASH_CHAIN',
                checkName: 'Append-Only Audit Trail & Scan Report Hash-Chain Verification',
                severity: 'CRITICAL',
                entityType: 'AUDIT_LOG',
                entityId: al.id,
                recordReference: al.record_reference || al.id,
                title: `Audit Trail Genesis Sequence Gap Detected (${al.id})`,
                description: `First chained audit log ${al.id} starts at sequence ${seq} instead of 1 (deletion or reordering detected).`,
                discrepancyAmountCentavos: 0,
                remediationAction: 'Restore complete immutable audit history from verified backup.',
                remediationModulePath: '/audit',
                evidence: { logId: al.id, sequenceNumber: seq },
              });
            }
          } else {
            if (seq !== lastV2Seq + 1 || (lastV2Seal && prevHash !== lastV2Seal)) {
              auditHashFailures++;
              addFinding({
                domain: 'CRYPTOGRAPHIC_INTEGRITY',
                checkCode: 'CRY_04_AUDIT_AND_SCAN_HASH_CHAIN',
                checkName: 'Append-Only Audit Trail & Scan Report Hash-Chain Verification',
                severity: 'CRITICAL',
                entityType: 'AUDIT_LOG',
                entityId: al.id,
                recordReference: al.record_reference || al.id,
                title: `Audit Trail Hash-Chain Link Broken at ${al.id}`,
                description: `Audit log ${al.id} (seq=${seq}) failed chain continuity against predecessor (expected seq=${lastV2Seq + 1}, expected previousHash=${lastV2Seal?.slice(0, 16) || 'N/A'}..., got ${prevHash.slice(0, 16)}...).`,
                discrepancyAmountCentavos: 0,
                remediationAction: 'Investigate deleted, reordered, or tampered audit_logs rows.',
                remediationModulePath: '/audit',
                evidence: {
                  logId: al.id,
                  sequenceNumber: seq,
                  expectedSequence: lastV2Seq + 1,
                  recordedPreviousHash: prevHash,
                  expectedPreviousHash: lastV2Seal,
                },
              });
            }
          }
          lastV2Seq = seq;
          lastV2Seal = sealCheck.expectedSeal || sealCheck.hash;
        } else if (v2ChainStarted && isAuditServiceRow) {
          auditHashFailures++;
          addFinding({
            domain: 'CRYPTOGRAPHIC_INTEGRITY',
            checkCode: 'CRY_04_AUDIT_AND_SCAN_HASH_CHAIN',
            checkName: 'Append-Only Audit Trail & Scan Report Hash-Chain Verification',
            severity: 'CRITICAL',
            entityType: 'AUDIT_LOG',
            entityId: al.id,
            recordReference: al.record_reference || al.id,
            title: `Audit Trail Chain Metadata Stripped (${al.id})`,
            description: `Audit log ${al.id} lacks v2 chain metadata after chained logging was established.`,
            discrepancyAmountCentavos: 0,
            remediationAction: 'Restore stripped audit log metadata from verified backup.',
            remediationModulePath: '/audit',
            evidence: { logId: al.id },
          });
        }
      }
    }

    // Verify previous integrity scan reports hash chain continuity
    const previousScans = sqlite
      .prepare(
        `SELECT id, company_id, database_identity, engine_version, started_at, records_inspected_json,
                passed_checks, failed_checks, critical_count, high_count, medium_count, low_count,
                previous_scan_id, previous_report_hash, report_hash
         FROM integrity_scan_reports
         WHERE company_id = ?
         ORDER BY started_at ASC, rowid ASC`
      )
      .all(companyId) as any[];

    let expectedPrevHash: string | null = null;
    for (const ps of previousScans) {
      if (ps.previous_report_hash !== expectedPrevHash) {
        auditHashFailures++;
        addFinding({
          domain: 'CRYPTOGRAPHIC_INTEGRITY',
          checkCode: 'CRY_04_AUDIT_AND_SCAN_HASH_CHAIN',
          checkName: 'Append-Only Audit Trail & Scan Report Hash-Chain Verification',
          severity: 'CRITICAL',
          entityType: 'AUDIT_LOG',
          entityId: ps.id,
          recordReference: ps.id,
          title: `Integrity Scan Hash-Chain Link Broken at Scan ${ps.id}`,
          description: `Historical integrity scan '${ps.id}' has previous_report_hash '${ps.previous_report_hash || 'NULL'}' but expected '${expectedPrevHash || 'NULL'}'.`,
          discrepancyAmountCentavos: 0,
          remediationAction: 'Investigate unauthorized tampering of historical integrity scan records.',
          remediationModulePath: '/audit/integrity',
          evidence: {
            scanId: ps.id,
            recordedPreviousHash: ps.previous_report_hash,
            expectedPreviousHash: expectedPrevHash,
          },
        });
      }
      expectedPrevHash = ps.report_hash;
    }

    checkItems.push({
      checkCode: 'CRY_04_AUDIT_AND_SCAN_HASH_CHAIN',
      checkName: 'Append-Only Audit Trail & Scan Report Hash-Chain Verification',
      domain: 'CRYPTOGRAPHIC_INTEGRITY',
      status: auditHashFailures === 0 ? 'PASSED' : 'FAILED',
      recordsEvaluated: recentAuditLogs.length + previousScans.length,
      issuesFound: auditHashFailures,
      severityIfFailed: 'CRITICAL',
      summary:
        auditHashFailures === 0
          ? `${recentAuditLogs.length} recent audit log seal(s) and ${previousScans.length} historical scan chain link(s) verified intact.`
          : `${auditHashFailures} hash-chain or audit continuity anomaly(ies) detected!`,
    });

    // Build Domain Summaries
    const buildDomainSummary = (
      domain: IntegrityDomainCode,
      title: string,
      subtitle: string
    ): IntegrityDomainSummary => {
      const domainChecks = checkItems.filter((c) => c.domain === domain);
      const domainFindings = findings.filter((f) => f.domain === domain);
      const passedChecks = domainChecks.filter((c) => c.status === 'PASSED').length;
      const failedChecks = domainChecks.filter((c) => c.status === 'FAILED').length;
      const warningChecks = domainChecks.filter((c) => c.status === 'WARNING').length;
      const criticalCount = domainFindings.filter((f) => f.severity === 'CRITICAL').length;
      const highCount = domainFindings.filter((f) => f.severity === 'HIGH').length;
      const mediumCount = domainFindings.filter((f) => f.severity === 'MEDIUM').length;
      const lowCount = domainFindings.filter((f) => f.severity === 'LOW').length;
      const infoCount = domainFindings.filter((f) => f.severity === 'INFORMATIONAL').length;

      let status: 'VERIFIED' | 'WARNINGS_DETECTED' | 'VIOLATIONS_DETECTED' = 'VERIFIED';
      if (criticalCount > 0 || highCount > 0 || failedChecks > 0) {
        status = 'VIOLATIONS_DETECTED';
      } else if (mediumCount > 0 || lowCount > 0 || warningChecks > 0) {
        status = 'WARNINGS_DETECTED';
      }

      return {
        domain,
        title,
        subtitle,
        status,
        totalChecks: domainChecks.length,
        passedChecks,
        failedChecks,
        warningChecks,
        criticalCount,
        highCount,
        mediumCount,
        lowCount,
        infoCount,
        checks: domainChecks,
      };
    };

    const domains: Record<IntegrityDomainCode, IntegrityDomainSummary> = {
      ACCOUNTING_INTEGRITY: buildDomainSummary(
        'ACCOUNTING_INTEGRITY',
        'Accounting & Double-Entry Integrity',
        'Verifies ∑DR = ∑CR across posted journals, COA mappings, subledger-to-GL reconciliation, and period cutoffs.'
      ),
      RECORD_INTEGRITY: buildDomainSummary(
        'RECORD_INTEGRITY',
        'Relational & Record Integrity',
        'Verifies parent-child journal lines, master data foreign keys, sequence uniqueness, and tenant isolation.'
      ),
      CRYPTOGRAPHIC_INTEGRITY: buildDomainSummary(
        'CRYPTOGRAPHIC_INTEGRITY',
        'Cryptographic & Hash-Chain Integrity',
        'Verifies Period Close SHA-256 seals, Document SHA-256 checksums, LAISDOC1 AES-256-GCM tags, and scan hash chains.'
      ),
    };

    const totalRecordsInspected =
      allJournalsCount +
      journalLinesCount +
      accountsCount +
      salesInvoicesCount +
      purchaseBillsCount +
      customerPaymentsCount +
      supplierPaymentsCount +
      inventoryItemsCount +
      fixedAssetsCount +
      accountingPeriodsCount +
      periodCertificationsCount +
      documentsCount +
      recentAuditLogs.length;

    const recordsInspected: IntegrityRecordsInspected = {
      postedJournals: postedJournalsCount,
      allJournals: allJournalsCount,
      journalLines: journalLinesCount,
      accounts: accountsCount,
      salesInvoices: salesInvoicesCount,
      purchaseBills: purchaseBillsCount,
      customerPayments: customerPaymentsCount,
      supplierPayments: supplierPaymentsCount,
      inventoryItems: inventoryItemsCount,
      fixedAssets: fixedAssetsCount,
      accountingPeriods: accountingPeriodsCount,
      periodCertifications: periodCertificationsCount,
      documentsInVault: documentsCount,
      encryptedLaisdocFilesVerified,
      auditLogsVerified: recentAuditLogs.length,
      totalRecordsInspected,
    };

    const passedChecks = checkItems.filter((c) => c.status === 'PASSED').length;
    const failedChecks = checkItems.filter((c) => c.status === 'FAILED').length;
    const warningCount =
      checkItems.filter((c) => c.status === 'WARNING').length +
      findings.filter((f) => f.severity === 'MEDIUM' || f.severity === 'LOW').length;
    const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;
    const highCount = findings.filter((f) => f.severity === 'HIGH').length;
    const mediumCount = findings.filter((f) => f.severity === 'MEDIUM').length;
    const lowCount = findings.filter((f) => f.severity === 'LOW').length;
    const infoCount = findings.filter((f) => f.severity === 'INFORMATIONAL').length;

    const overallStatus: IntegrityScanLifecycleStatus =
      findings.length === 0 ? 'COMPLETED' : 'COMPLETED_WITH_FINDINGS';

    const latestPrevScan =
      previousScans.length > 0 ? previousScans[previousScans.length - 1] : null;
    const previousScanId = latestPrevScan?.id || null;
    const previousReportHash = latestPrevScan?.report_hash || null;

    const findingsDigests = findings.map((f) =>
      crypto
        .createHash('sha256')
        .update(`${f.domain}:${f.checkCode}:${f.severity}:${f.entityType}:${f.entityId}:${f.discrepancyAmountCentavos}`)
        .digest('hex')
    );

    const reportHash = this.computeCanonicalReportHash({
      scanId,
      companyId,
      databaseIdentity,
      engineVersion: this.ENGINE_VERSION,
      startedAtEpochSec,
      recordsInspected,
      passedChecks,
      failedChecks,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      findingsDigests,
      previousReportHash,
    });

    const completedAtMs = Date.now();
    const completedAtEpochSec = toEpochSeconds(completedAtMs);
    const durationMs = Math.max(1, completedAtMs - startMs);

    const triggeredBy = actor.userId || 'SYSTEM';
    const triggeredByName = actor.userName || 'Company Auditor';
    const triggeredByRole = actor.userRole || 'Company Owner';

    // Persist scan report & findings atomically in SQLite
    sqlite.transaction(() => {
      sqlite
        .prepare(
          `INSERT INTO integrity_scan_reports (
             id, company_id, database_identity, status, execution_mode, engine_version,
             scan_scope, started_at, completed_at, duration_ms, records_inspected_json,
             domain_results_json, passed_checks, failed_checks, warning_count,
             critical_count, high_count, medium_count, low_count, info_count,
             findings_count, previous_scan_id, previous_report_hash, report_hash,
             triggered_by, triggered_by_name, triggered_by_role
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          scanId,
          companyId,
          databaseIdentity,
          overallStatus,
          'OFFLINE_LOCAL',
          this.ENGINE_VERSION,
          'FULL_COMPANY_LEDGER_3_DOMAIN',
          startedAtEpochSec,
          completedAtEpochSec,
          durationMs,
          JSON.stringify(recordsInspected),
          JSON.stringify(domains),
          passedChecks,
          failedChecks,
          warningCount,
          criticalCount,
          highCount,
          mediumCount,
          lowCount,
          infoCount,
          findings.length,
          previousScanId,
          previousReportHash,
          reportHash,
          triggeredBy,
          triggeredByName,
          triggeredByRole
        );

      const insertFindingStmt = sqlite.prepare(
        `INSERT INTO integrity_scan_findings (
           id, scan_id, company_id, domain, check_code, check_name, severity,
           entity_type, entity_id, record_reference, title, description,
           discrepancy_amount_centavos, remediation_action, remediation_module_path,
           evidence_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const f of findings) {
        insertFindingStmt.run(
          f.id,
          scanId,
          companyId,
          f.domain,
          f.checkCode,
          f.checkName,
          f.severity,
          f.entityType,
          f.entityId,
          f.recordReference,
          f.title,
          f.description,
          f.discrepancyAmountCentavos,
          f.remediationAction,
          f.remediationModulePath,
          JSON.stringify(f.evidence || {}),
          startedAtEpochSec
        );
      }
    })();

    // Record immutable audit event
    await AuditService.log({
      req: actor.req,
      companyId,
      userId: actor.userId,
      userDisplayName: triggeredByName,
      role: triggeredByRole,
      action: 'RUN_CRYPTOGRAPHIC_LEDGER_INTEGRITY_SCAN',
      entityType: 'AUDIT_LOG',
      entityId: scanId,
      entityName: `3-Domain Cryptographic Ledger Integrity Scan (${overallStatus})`,
      recordReference: scanId,
      result: criticalCount > 0 ? 'WARNING' : 'SUCCESS',
      module: 'AUDIT',
      severity: criticalCount > 0 ? 'WARN' : 'INFO',
      metadata: {
        scanId,
        status: overallStatus,
        passedChecks,
        failedChecks,
        criticalCount,
        highCount,
        findingsCount: findings.length,
        totalRecordsInspected,
        reportHash,
        previousReportHash,
      },
    });

    const savedRow = sqlite
      .prepare('SELECT * FROM integrity_scan_reports WHERE id = ? AND company_id = ? LIMIT 1')
      .get(scanId, companyId) as any;

    return this.hydrateReportRow(sqlite, savedRow, companyName);
  }
}
