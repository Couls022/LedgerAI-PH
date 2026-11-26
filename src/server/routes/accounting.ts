import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth,  requireApprovalRole, requirePostingRole, requirePermission } from "../auth";
import { eq, and, desc, asc, sql, like, gte, lte, or, inArray, isNull } from "drizzle-orm";
import { parsePaginationParams, buildCursorCondition, formatPaginatedResponse } from "../utils/pagination";
import crypto from "crypto";
import { broadcastNotification } from "../ws";
import { AuditService } from "../services/auditService";
import { RbacService } from "../services/rbacService";
import { PeriodCloseWorkspaceService } from "../services/periodCloseWorkspaceService";
import { computeParentAccountIds, enrichCoaAccount } from "../../shared/coaAccountUtils";
import { deduplicateAccountingPeriods, formatIsoDateSafe } from "../../shared/accountingGlUtils";
import {
  reverseJournalEntry,
  softClosePeriod,
  hardClosePeriod,
  reopenPeriod,
  createJournalEntry,
  submitJournalEntry,
  approveJournalEntry,
  rejectJournalEntry,
  postJournalEntry,
  performYearEndClose,
  voidJournalEntry,
  copyJournalEntry,
  importJournalEntries,
  validateTransactionDateAndPeriod,
  DomainError
} from "../db/domain";
import {
  createPurchaseBill,
  createSalesInvoice,
  createCashTransaction,
  submitSalesInvoice,
  approveSalesInvoice,
  rejectSalesInvoice,
  postSalesInvoice,
  createCustomerPayment,
  submitCustomerPayment,
  approveCustomerPayment,
  rejectCustomerPayment,
  postCustomerPayment,
  createCreditMemo,
  postCreditMemo,
  submitPurchaseBill,
  approvePurchaseBill,
  rejectPurchaseBill,
  postPurchaseBill,
  createSupplierPayment,
  submitSupplierPayment,
  approveSupplierPayment,
  rejectSupplierPayment,
  postSupplierPayment,
  createDebitMemo,
  submitDebitMemo,
  approveDebitMemo,
  rejectDebitMemo,
  postDebitMemo,
  submitCashTransaction,
  approveCashTransaction,
  rejectCashTransaction,
  postCashTransaction,
  liquidateCashAdvance,
  issueCheck,
  clearCheck,
  cancelCheck,
  bounceCheck,
  resolveCompanyControlAccount,
  createBankDeposit,
  submitBankDeposit,
  approveBankDeposit,
  rejectBankDeposit,
  postBankDeposit,
  createCashCount,
  submitCashCount,
  approveCashCount,
  rejectCashCount,
  postCashCount,
  getCashbook,
  createBankReconciliation,
  importBankStatementLines,
  addManualBankStatementLine,
  autoMatchBankReconciliation,
  manualMatchBankStatementLine,
  addReconciliationAdjustment,
  recalculateBankReconciliationMetrics,
  submitBankReconciliation,
  approveBankReconciliation,
  reopenBankReconciliation,
  getBankReconciliationSummary,
  ensureReconciledBankSeedData,
  BusinessTransactionError
} from "../db/business_transactions";

const router = Router();

async function resolveDefaultPeriodId(companyId: string, targetDate?: string | null): Promise<string> {
  const dateStr = (targetDate || new Date().toISOString()).slice(0, 10);
  const matching = await db
    .select()
    .from(schema.accountingPeriods)
    .where(
      and(
        eq(schema.accountingPeriods.companyId, companyId),
        lte(schema.accountingPeriods.startDate, dateStr),
        gte(schema.accountingPeriods.endDate, dateStr)
      )
    )
    .get();
  if (matching) return matching.id;

  const openPeriod = await db
    .select()
    .from(schema.accountingPeriods)
    .where(and(eq(schema.accountingPeriods.companyId, companyId), eq(schema.accountingPeriods.status, 'OPEN')))
    .orderBy(desc(schema.accountingPeriods.startDate))
    .get();
  if (openPeriod) return openPeriod.id;

  const anyPeriod = await db
    .select()
    .from(schema.accountingPeriods)
    .where(eq(schema.accountingPeriods.companyId, companyId))
    .orderBy(desc(schema.accountingPeriods.startDate))
    .get();
  return anyPeriod?.id || 'PER-DEFAULT';
}


// Get Chart of Accounts (Viewer, Editor, Admin) with live posted GL balance & line count
router.get("/accounts", requireAuth, requirePermission('accounting:view', 'accounts:read', 'tax:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const allAccounts = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.companyId, companyId))
    .orderBy(schema.accounts.accountCode);

  const glAggRows = await db
    .select({
      accountId: schema.journalLines.accountId,
      debitTotal: sql<number>`COALESCE(SUM(${schema.journalLines.debit}), 0)`,
      creditTotal: sql<number>`COALESCE(SUM(${schema.journalLines.credit}), 0)`,
      lineCount: sql<number>`COUNT(*)`,
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.journalEntries.companyId, companyId),
        inArray(schema.journalEntries.status, ['POSTED', 'REVERSED'])
      )
    )
    .groupBy(schema.journalLines.accountId);

  const glMap = new Map<string, { debitTotal: number; creditTotal: number; lineCount: number }>();
  for (const row of glAggRows) {
    glMap.set(row.accountId, {
      debitTotal: Number(row.debitTotal || 0),
      creditTotal: Number(row.creditTotal || 0),
      lineCount: Number(row.lineCount || 0),
    });
  }

  const parentIds = computeParentAccountIds(allAccounts as any[]);
  const enriched = [];
  for (const acc of allAccounts) {
    const e = enrichCoaAccount(acc as any, parentIds);
    if ((!acc.detailType || !acc.birTaxCategory) && (e.detailType || e.birTaxCategory)) {
      try {
        db.update(schema.accounts)
          .set({
            detailType: e.detailType,
            birTaxCategory: e.birTaxCategory,
            isCashAccount: Boolean(e.isCashAccount),
          })
          .where(and(eq(schema.accounts.id, acc.id), eq(schema.accounts.companyId, companyId)))
          .run();
      } catch {
        // non-fatal backfill failure
      }
    }
    const gl = glMap.get(acc.id) || { debitTotal: 0, creditTotal: 0, lineCount: 0 };
    const isCreditNormal = String(acc.normalBalance || '').toUpperCase() === 'CREDIT';
    const glBalanceCentavos = isCreditNormal ? gl.creditTotal - gl.debitTotal : gl.debitTotal - gl.creditTotal;

    enriched.push({
      ...e,
      glDebitCentavos: gl.debitTotal,
      glCreditCentavos: gl.creditTotal,
      glBalanceCentavos,
      postedLineCount: gl.lineCount,
    });
  }
  res.json(enriched);
});

// --- ACCOUNTING PERIOD MANAGEMENT (PHASE 6) ---

// Get Company Lock Date
router.get("/lock-date", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const company = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  res.json({ lockDate: company?.lockDate || null });
});

// Set / Update Company Lock Date (Admin)
router.post("/lock-date", requireAuth, requirePermission('settings:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { lockDate } = req.body;

  let formattedLockDate: string | null = null;
  if (lockDate) {
    if (typeof lockDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(lockDate.slice(0, 10))) {
      res.status(400).json({ error: "INVALID_DATE_FORMAT", message: "lockDate must be in YYYY-MM-DD format" });
      return;
    }
    formattedLockDate = lockDate.slice(0, 10);
  }

  await db.update(schema.companies).set({
    lockDate: formattedLockDate,
    updatedAt: new Date()
  }).where(eq(schema.companies.id, companyId));

  await AuditService.log({
    req,
    companyId,
    action: "UPDATE_LOCK_DATE",
    entityType: "COMPANY",
    entityId: companyId,
    module: "ACCOUNTING",
    afterData: { lockDate: formattedLockDate }
  });

  res.json({ message: "Company lock date updated successfully", lockDate: formattedLockDate });
});

// Get Accounting Periods (deduplicated & self-healing against orphaned seed duplicates)
router.get("/periods", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const rawPeriods = await db.select()
    .from(schema.accountingPeriods)
    .where(eq(schema.accountingPeriods.companyId, companyId))
    .orderBy(desc(schema.accountingPeriods.startDate));

  if (rawPeriods.length <= 1) {
    return res.json(rawPeriods);
  }

  const journalCounts = await db
    .select({
      periodId: schema.journalEntries.accountingPeriodId,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(schema.journalEntries)
    .where(eq(schema.journalEntries.companyId, companyId))
    .groupBy(schema.journalEntries.accountingPeriodId);
  const jCountMap = new Map<string, number>();
  for (const r of journalCounts) {
    if (r.periodId) jCountMap.set(r.periodId, Number(r.cnt || 0));
  }

  const historyCounts = await db
    .select({
      periodId: schema.periodStatusHistory.accountingPeriodId,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(schema.periodStatusHistory)
    .where(eq(schema.periodStatusHistory.companyId, companyId))
    .groupBy(schema.periodStatusHistory.accountingPeriodId);
  const hCountMap = new Map<string, number>();
  for (const r of historyCounts) {
    if (r.periodId) hCountMap.set(r.periodId, Number(r.cnt || 0));
  }

  const annotated = rawPeriods.map((p) => ({
    ...p,
    journalCount: jCountMap.get(p.id) || 0,
    historyCount: hCountMap.get(p.id) || 0,
  }));

  const { canonical, duplicates } = deduplicateAccountingPeriods(annotated);

  // Safely purge orphaned unreferenced duplicate period rows in SQLite
  for (const dup of duplicates) {
    if ((dup.journalCount || 0) === 0 && String(dup.status || '').toUpperCase() === 'OPEN') {
      try {
        await db.transaction(async (tx) => {
          await tx
            .delete(schema.periodStatusHistory)
            .where(
              and(
                eq(schema.periodStatusHistory.companyId, companyId),
                eq(schema.periodStatusHistory.accountingPeriodId, dup.id)
              )
            );
          await tx
            .delete(schema.accountingPeriods)
            .where(
              and(
                eq(schema.accountingPeriods.companyId, companyId),
                eq(schema.accountingPeriods.id, dup.id)
              )
            );
        });
      } catch {
        // Keep row intact if referenced by any foreign key table
      }
    }
  }

  res.json(canonical);
});

// Create Accounting Period (Editor/Admin)
router.post("/periods", requireAuth, requirePermission('accounting:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { name, startDate, endDate, fiscalYear } = req.body;

  if (!name || !startDate || !endDate || !fiscalYear) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "name, startDate, endDate, and fiscalYear are required" });
    return;
  }

  const startFormatted = startDate.slice(0, 10);
  const endFormatted = endDate.slice(0, 10);

  if (startFormatted > endFormatted) {
    res.status(400).json({ error: "INVALID_DATE_RANGE", message: "startDate must be on or before endDate" });
    return;
  }

  // Check overlapping periods in same company
  const existingPeriods = await db.select().from(schema.accountingPeriods).where(eq(schema.accountingPeriods.companyId, companyId));
  for (const existing of existingPeriods) {
    if (startFormatted <= existing.endDate && endFormatted >= existing.startDate) {
      res.status(400).json({
        error: "OVERLAPPING_PERIOD",
        message: `Accounting period dates (${startFormatted} to ${endFormatted}) overlap with existing period '${existing.name}' (${existing.startDate} to ${existing.endDate}).`
      });
      return;
    }
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const periodData = {
    id,
    companyId,
    name,
    startDate: startFormatted,
    endDate: endFormatted,
    fiscalYear: Number(fiscalYear),
    status: "OPEN" as const,
    createdAt: now,
    updatedAt: now,
  };

  await db.transaction(async (tx) => {
    await tx.insert(schema.accountingPeriods).values(periodData);

    await tx.insert(schema.periodStatusHistory).values({
      id: crypto.randomUUID(),
      companyId,
      accountingPeriodId: id,
      action: "CREATE",
      previousStatus: null,
      newStatus: "OPEN",
      reason: "Period created",
      changedBy: req.user!.id,
      createdAt: now,
    });
  });

  await AuditService.log({
    req,
    companyId,
    action: "CREATE_ACCOUNTING_PERIOD",
    entityType: "ACCOUNTING_PERIOD",
    entityId: id,
    module: "ACCOUNTING",
    afterData: periodData
  });

  res.status(201).json({ message: "Accounting period created successfully", period: periodData });
});

// Get Company Period Close Policy
router.get("/period-close-policy", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const policy = PeriodCloseWorkspaceService.getCompanyPolicy(companyId);
  res.json(policy);
});

// Update Company Period Close Policy (Approver/Admin)
router.put("/period-close-policy", requireAuth, requirePermission('accounting:approve'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const beforePolicy = PeriodCloseWorkspaceService.getCompanyPolicy(companyId);
  const updatedPolicy = PeriodCloseWorkspaceService.updateCompanyPolicy(companyId, req.body || {}, req.user!.id);

  await AuditService.log({
    req,
    companyId,
    action: "UPDATE_PERIOD_CLOSE_POLICY",
    entityType: "PERIOD_CLOSE_POLICY",
    entityId: companyId,
    module: "ACCOUNTING",
    beforeData: beforePolicy,
    afterData: updatedPolicy,
  });

  res.json({ message: "Company period close policy updated", policy: updatedPolicy });
});

// Get Evidence-Driven Period Close Workspace
router.get("/periods/:id/workspace", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const periodId = req.params.id;
  const closeTarget = String(req.query.closeTarget || 'HARD_CLOSE').toUpperCase() === 'SOFT_CLOSE'
    ? 'SOFT_CLOSE'
    : 'HARD_CLOSE';

  try {
    const workspace = await PeriodCloseWorkspaceService.buildPeriodCloseWorkspace(companyId, periodId, {
      closeTarget,
    });
    res.json(workspace);
  } catch (err: any) {
    const status = err.statusCode || (err.message?.includes("not found") ? 404 : 400);
    res.status(status).json({ error: err.code || "WORKSPACE_ERROR", message: err.message });
  }
});

// Explicitly Run & Persist Period Close Validation Snapshot (Revalidate Period)
router.post("/periods/:id/validate", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const periodId = req.params.id;
  const closeTarget = String(req.body?.closeTarget || 'HARD_CLOSE').toUpperCase() === 'SOFT_CLOSE'
    ? 'SOFT_CLOSE'
    : 'HARD_CLOSE';

  try {
    const workspace = await PeriodCloseWorkspaceService.buildPeriodCloseWorkspace(companyId, periodId, {
      closeTarget,
      persistValidationByUserId: req.user!.id,
    });

    await AuditService.log({
      req,
      companyId,
      action: "VALIDATE_ACCOUNTING_PERIOD",
      entityType: "ACCOUNTING_PERIOD",
      entityId: periodId,
      module: "ACCOUNTING",
      afterData: {
        validationSnapshotId: workspace.periodInfo.validationSnapshotId,
        closeTarget,
        readinessScore: workspace.readinessSummary.readinessScore,
        blockingCount: workspace.readinessSummary.totalBlockingCount,
        warningCount: workspace.readinessSummary.totalWarningCount,
      },
    });

    res.json({
      message: "Period close validation completed",
      validationSnapshotId: workspace.periodInfo.validationSnapshotId,
      workspace,
    });
  } catch (err: any) {
    const status = err.statusCode || (err.message?.includes("not found") ? 404 : 400);
    res.status(status).json({ error: err.code || "VALIDATION_ERROR", message: err.message });
  }
});

// Get Immutable Period Close Certifications
router.get("/periods/:id/certifications", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const periodId = req.params.id;
  const certifications = PeriodCloseWorkspaceService.getPeriodCertifications(companyId, periodId);
  res.json(certifications);
});

// Soft-Close Period (Editor/Admin)
router.post("/periods/:id/soft-close", requireAuth, requirePermission('accounting:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const periodId = req.params.id;
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  const roleName = (req as any).activeCompany?.roleName || (req as any).activeCompany?.role || 'Company Administrator';

  try {
    const result = await PeriodCloseWorkspaceService.executeEvidenceDrivenSoftClose(
      companyId,
      periodId,
      {
        id: req.user!.id,
        displayName: req.user!.displayName,
        email: req.user!.email,
        role: roleName,
      },
      {
        reason: req.body?.reason,
        warningJustification: req.body?.warningJustification,
        expectedVersion: expectedVersion ? Number(expectedVersion) : undefined,
        enforceEvidenceChecks: Boolean(req.body?.enforceEvidenceChecks),
      }
    );

    await AuditService.log({
      req,
      companyId,
      action: "SOFT_CLOSE_PERIOD",
      entityType: "ACCOUNTING_PERIOD",
      entityId: periodId,
      module: "ACCOUNTING",
      reason: req.body?.reason,
      afterData: {
        status: "SOFT_CLOSED",
        softClosedBy: req.user!.id,
        validationSnapshotId: result.validationSnapshotId,
        warningJustification: result.warningJustification,
      },
    });

    res.json({
      message: "Period soft-closed successfully",
      id: periodId,
      status: "SOFT_CLOSED",
      validationSnapshotId: result.validationSnapshotId,
      readinessSummary: result.readinessSummary,
    });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : (err.message.includes("not found") ? 404 : (err.statusCode || 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
    return;
  }
});

// Hard-Close Period (Admin)
router.post("/periods/:id/hard-close", requireAuth, requirePermission('accounting:approve'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const periodId = req.params.id;
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  const roleName = (req as any).activeCompany?.roleName || (req as any).activeCompany?.role || 'Company Administrator';

  try {
    const auditEventId = crypto.randomUUID();
    const result = await PeriodCloseWorkspaceService.executeEvidenceDrivenHardClose(
      companyId,
      periodId,
      {
        id: req.user!.id,
        displayName: req.user!.displayName,
        email: req.user!.email,
        role: roleName,
      },
      {
        reason: req.body?.reason,
        warningJustification: req.body?.warningJustification,
        approvedByUserId: req.body?.approvedByUserId || req.user!.id,
        approvedByUserName: req.body?.approvedByUserName || req.user!.displayName,
        approvedByUserRole: roleName,
        expectedVersion: expectedVersion ? Number(expectedVersion) : undefined,
        enforceEvidenceChecks: Boolean(req.body?.enforceEvidenceChecks),
        auditEventId,
      }
    );

    await AuditService.log({
      req,
      companyId,
      action: "HARD_CLOSE_PERIOD",
      entityType: "ACCOUNTING_PERIOD",
      entityId: periodId,
      module: "ACCOUNTING",
      reason: req.body?.reason,
      afterData: {
        status: "HARD_CLOSED",
        hardClosedBy: req.user!.id,
        validationSnapshotId: result.validationSnapshotId,
        certificationId: result.certification?.id,
        certificationSha256: result.certification?.sha256Hash,
      },
    });

    res.json({
      message: "Period hard-closed and certified successfully",
      id: periodId,
      status: "HARD_CLOSED",
      validationSnapshotId: result.validationSnapshotId,
      certification: result.certification,
    });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : (err.message.includes("not found") ? 404 : (err.statusCode || 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
    return;
  }
});

// Reopen Period (Admin, requires reason)
router.post("/periods/:id/reopen", requireAuth, requirePermission('accounting:approve'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const periodId = req.params.id;
  const { reason, approvedByUserId, approvedByUserName } = req.body || {};
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  const roleName = (req as any).activeCompany?.roleName || (req as any).activeCompany?.role || 'Company Administrator';

  try {
    const result = await PeriodCloseWorkspaceService.executeEvidenceDrivenReopen(
      companyId,
      periodId,
      {
        id: req.user!.id,
        displayName: req.user!.displayName,
        email: req.user!.email,
        role: roleName,
      },
      {
        reason,
        approvedByUserId,
        approvedByUserName,
        expectedVersion: expectedVersion ? Number(expectedVersion) : undefined,
      }
    );

    await AuditService.log({
      req,
      companyId,
      action: "REOPEN_PERIOD",
      entityType: "ACCOUNTING_PERIOD",
      entityId: periodId,
      module: "ACCOUNTING",
      reason: reason.trim(),
      afterData: {
        status: "OPEN",
        reopenedBy: req.user!.id,
        reopenReason: reason.trim(),
        preservedCertificationsCount: result.preservedCertificationsCount,
        requiresRevalidationBeforeNextClose: result.requiresRevalidationBeforeNextClose,
      }
    });

    res.json({
      message: "Accounting period reopened successfully",
      id: periodId,
      status: "OPEN",
      preservedCertificationsCount: result.preservedCertificationsCount,
      requiresRevalidationBeforeNextClose: result.requiresRevalidationBeforeNextClose,
    });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : (err.message.includes("not found") ? 404 : (err.statusCode || 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
    return;
  }
});

// Get Enriched Period Status History
router.get("/periods/:id/history", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const periodId = req.params.id;

  const history = await PeriodCloseWorkspaceService.getEnrichedPeriodHistory(companyId, periodId);
  res.json(history);
});

// Year-End Close Support (Admin)
router.post("/year-end-close", requireAuth, requirePermission('accounting:approve'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { fiscalYear, retainedEarningsAccountId } = req.body;

  if (!fiscalYear || !retainedEarningsAccountId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "fiscalYear and retainedEarningsAccountId are required" });
    return;
  }

  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const result = await performYearEndClose(
      companyId,
      Number(fiscalYear),
      retainedEarningsAccountId,
      req.user!.id,
      { userName: req.user!.displayName || req.user!.email, userRole: actorRole }
    );
    res.json({ message: "Year-end close completed successfully", result });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : 400;
    res.status(status).json({ error: err.code || "YEAR_END_CLOSE_ERROR", message: err.message });
  }
});

// Get Journal Entries (Viewer, Editor, Admin)
router.get("/journals", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const params = parsePaginationParams(req);
  const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'accounting');

  const filterConditions = [eq(schema.journalEntries.companyId, companyId)];

  if (!scope.isCompanyWide) {
    if (scope.dataScope === 'OWN_RECORDS' || scope.dataScope === 'ASSIGNED_RECORDS') {
      filterConditions.push(eq(schema.journalEntries.createdBy, req.user!.id));
    } else if (scope.dataScope === 'DEPARTMENT') {
      if (scope.departmentMatches.length > 0) {
        filterConditions.push(
          sql`EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.journal_entry_id = ${schema.journalEntries.id} AND UPPER(jl.department_id) IN (${sql.join(scope.departmentMatches.map(m => sql`${m}`), sql`, `)}))`
        );
      } else {
        filterConditions.push(sql`1 = 0`);
      }
    } else if (scope.dataScope === 'PROJECT') {
      if (scope.projectMatches.length > 0) {
        filterConditions.push(
          sql`EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.journal_entry_id = ${schema.journalEntries.id} AND UPPER(jl.project_id) IN (${sql.join(scope.projectMatches.map(m => sql`${m}`), sql`, `)}))`
        );
      } else {
        filterConditions.push(sql`1 = 0`);
      }
    } else if (scope.dataScope === 'COST_CENTER') {
      if (scope.costCenterMatches.length > 0) {
        filterConditions.push(
          sql`EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.journal_entry_id = ${schema.journalEntries.id} AND UPPER(jl.cost_center_id) IN (${sql.join(scope.costCenterMatches.map(m => sql`${m}`), sql`, `)}))`
        );
      } else {
        filterConditions.push(sql`1 = 0`);
      }
    }
  }

  if (params.search) {
    const searchPattern = `%${params.search}%`;
    filterConditions.push(
      or(
        like(schema.journalEntries.journalNumber, searchPattern),
        like(schema.journalEntries.description, searchPattern)
      )!
    );
  }

  const reqStatus = params.status ? params.status.toUpperCase().trim() : null;
  if (reqStatus && reqStatus !== 'ALL') {
    if (reqStatus === 'RETURNED') {
      filterConditions.push(sql`UPPER(COALESCE(${schema.journalEntries.status}, 'DRAFT')) IN ('RETURNED', 'REJECTED')`);
    } else {
      filterConditions.push(sql`UPPER(COALESCE(${schema.journalEntries.status}, 'DRAFT')) = ${reqStatus}`);
    }
  } else {
    filterConditions.push(sql`UPPER(COALESCE(${schema.journalEntries.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`);
  }

  if (params.fromDate) {
    filterConditions.push(gte(schema.journalEntries.entryDate, params.fromDate));
  }

  if (params.toDate) {
    filterConditions.push(lte(schema.journalEntries.entryDate, params.toDate));
  }

  const isAsc = params.order === 'ASC';
  const cursorCond = buildCursorCondition(
    schema.journalEntries.entryDate,
    schema.journalEntries.id,
    params.decodedCursor,
    isAsc ? 'ASC' : 'DESC'
  );

  const queryConditions = [...filterConditions];
  if (cursorCond) {
    queryConditions.push(cursorCond);
  }

  // Compute lifecycle status counts across company scope (excluding status filter so all filter badges stay live)
  const baseScopeConditions = filterConditions.slice(0, 1);
  if (!scope.isCompanyWide && filterConditions.length > 1) {
    baseScopeConditions.push(filterConditions[1]);
  }
  const statusAggRows = await db
    .select({
      status: sql<string>`UPPER(COALESCE(${schema.journalEntries.status}, 'DRAFT'))`,
      cnt: sql<number>`COUNT(*)`,
    })
    .from(schema.journalEntries)
    .where(and(...baseScopeConditions))
    .groupBy(sql`UPPER(COALESCE(${schema.journalEntries.status}, 'DRAFT'))`);

  const statusCounts: Record<string, number> = {
    ALL: 0,
    DRAFT: 0,
    SUBMITTED: 0,
    RETURNED: 0,
    REJECTED: 0,
    APPROVED: 0,
    POSTED: 0,
    REVERSED: 0,
    CANCELLED: 0,
    ARCHIVED: 0,
    SOFT_DELETED: 0,
  };
  for (const r of statusAggRows) {
    const st = String(r.status || 'DRAFT').toUpperCase();
    const c = Number(r.cnt || 0);
    statusCounts[st] = (statusCounts[st] || 0) + c;
    if (!['ARCHIVED', 'REMOVED', 'SOFT_DELETED'].includes(st)) {
      statusCounts.ALL += c;
    }
  }

  const [countRes] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.journalEntries)
    .where(and(...filterConditions));
  const totalCount = Number(countRes?.total || 0);

  const journals = await db
    .select()
    .from(schema.journalEntries)
    .where(and(...queryConditions))
    .orderBy(
      isAsc ? asc(schema.journalEntries.entryDate) : desc(schema.journalEntries.entryDate),
      isAsc ? asc(schema.journalEntries.id) : desc(schema.journalEntries.id)
    )
    .limit(params.limit + 1);

  const pageIds = journals.map((j) => j.id);
  const lineTotalsMap = new Map<string, { totalDebit: number; totalCredit: number; lineCount: number }>();
  if (pageIds.length > 0) {
    const lineAgg = await db
      .select({
        journalEntryId: schema.journalLines.journalEntryId,
        totalDebit: sql<number>`COALESCE(SUM(${schema.journalLines.debit}), 0)`,
        totalCredit: sql<number>`COALESCE(SUM(${schema.journalLines.credit}), 0)`,
        lineCount: sql<number>`COUNT(*)`,
      })
      .from(schema.journalLines)
      .where(inArray(schema.journalLines.journalEntryId, pageIds))
      .groupBy(schema.journalLines.journalEntryId);
    for (const row of lineAgg) {
      lineTotalsMap.set(row.journalEntryId, {
        totalDebit: Number(row.totalDebit || 0),
        totalCredit: Number(row.totalCredit || 0),
        lineCount: Number(row.lineCount || 0),
      });
    }
  }

  const enrichedJournals = journals.map((j) => {
    const agg = lineTotalsMap.get(j.id) || { totalDebit: 0, totalCredit: 0, lineCount: 0 };
    return {
      ...j,
      totalDebit: agg.totalDebit,
      totalCredit: agg.totalCredit,
      lineCount: agg.lineCount,
    };
  });

  const formatted = formatPaginatedResponse({
    items: enrichedJournals,
    limit: params.limit,
    getSortValAndId: (j: any) => ({ val: j.entryDate, id: j.id }),
    totalCount,
    raw: params.raw
  });

  if (Array.isArray(formatted)) {
    res.json(formatted);
  } else {
    res.json({ ...formatted, statusCounts });
  }
});

// Create Journal Entry (Requires Editor or Admin role)
router.post("/journals", requireAuth, requirePermission('accounting:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { journalNumber, entryNumber, entryDate, description, lines } = req.body;

  if (!entryDate || !description || !lines || !lines.length) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Entry date, description, and lines are required" });
    return;
  }

  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'accounting');
    if (!scope.isCompanyWide && (scope.dataScope === 'DEPARTMENT' || scope.dataScope === 'PROJECT' || scope.dataScope === 'COST_CENTER')) {
      for (const line of lines) {
        scope.assertRecordAccess({
          departmentId: line.departmentId,
          projectId: line.projectId,
          costCenterId: line.costCenterId,
        }, "journal line");
      }
    }

    const id = await createJournalEntry(companyId, {
      journalNumber: journalNumber || entryNumber || `JE-${Date.now().toString().slice(-6)}`,
      entryDate: formatIsoDateSafe(entryDate),
      description,
      createdBy: req.user!.id,
      userRole: req.activeCompany!.roleCode
    }, lines);

    // Real-time notifications
    await broadcastNotification({
      companyId,
      title: "New Journal Entry Created",
      message: `Journal "${description}" was created by ${req.user!.displayName}.`,
      type: "JOURNAL_CREATED",
      entityType: "journal_entry",
      entityId: id,
    });

    res.status(201).json({ message: "Journal entry created successfully", id });
  } catch (err: any) {
    if (err.status === 403 || err.code === "DATA_SCOPE_VIOLATION") {
      res.status(403).json({ error: "PERMISSION_DENIED", code: err.code || "DATA_SCOPE_VIOLATION", message: err.message });
      return;
    }
    const status = (err.message.toLowerCase().includes("lock date") || err.message.toLowerCase().includes("closed period") || err.message.toLowerCase().includes("locked")) ? 403 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// Get Single Journal Entry with Lines (Viewer, Editor, Admin)
router.get("/journals/:id", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  const entry = await db.select().from(schema.journalEntries).where(and(
    eq(schema.journalEntries.id, id),
    eq(schema.journalEntries.companyId, companyId)
  )).get();

  if (!entry) {
    res.status(404).json({ error: "NOT_FOUND", message: "Journal entry not found" });
    return;
  }

  const lines = await db.select().from(schema.journalLines).where(
    eq(schema.journalLines.journalEntryId, id)
  ).orderBy(schema.journalLines.lineNumber);

  const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'accounting');
  if (!scope.isCompanyWide) {
    if ((scope.dataScope === 'OWN_RECORDS' || scope.dataScope === 'ASSIGNED_RECORDS') && entry.createdBy !== req.user!.id) {
      res.status(403).json({ error: "PERMISSION_DENIED", code: "DATA_SCOPE_VIOLATION", message: `Access denied: journal entry is outside your ${scope.dataScope} scope.` });
      return;
    }
    if ((scope.dataScope === 'DEPARTMENT' || scope.dataScope === 'PROJECT' || scope.dataScope === 'COST_CENTER') && !lines.some(l => scope.matchesRecord(l))) {
      res.status(403).json({ error: "PERMISSION_DENIED", code: "DATA_SCOPE_VIOLATION", message: `Access denied: journal entry is outside your ${scope.dataScope} scope.` });
      return;
    }
  }

  res.json({ ...entry, lines });
});

// Update Draft / Returned Journal Entry (Editor or Admin role)
router.put("/journals/:id", requireAuth, requirePermission('accounting:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;
  const { journalNumber, entryDate, description, lines, correctionReason } = req.body;

  const existing = await db.select().from(schema.journalEntries).where(and(
    eq(schema.journalEntries.id, id),
    eq(schema.journalEntries.companyId, companyId)
  )).get();

  if (!existing) {
    res.status(404).json({ error: "NOT_FOUND", message: "Journal entry not found" });
    return;
  }

  const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'accounting');
  if (!scope.isCompanyWide) {
    if ((scope.dataScope === 'OWN_RECORDS' || scope.dataScope === 'ASSIGNED_RECORDS') && existing.createdBy !== req.user!.id) {
      res.status(403).json({ error: "PERMISSION_DENIED", code: "DATA_SCOPE_VIOLATION", message: `Access denied: journal entry is outside your ${scope.dataScope} scope.` });
      return;
    }
  }

  const statusUpper = (existing.status || '').toUpperCase();

  if (statusUpper === 'REJECTED') {
    res.status(400).json({
      error: "REJECTED_RECORD_ERROR",
      message: "REJECTED journal entries must be reopened or returned for correction first before line-level editing."
    });
    return;
  }

  // Immutable audit check: Posted, Approved, or Submitted entries cannot be directly edited
  const allowedStatuses = ['DRAFT', 'RETURNED', 'CORRECTION'];
  if (!allowedStatuses.includes(statusUpper)) {
    res.status(403).json({
      error: "IMMUTABLE_RECORD_ERROR",
      message: `Journal entry in status '${existing.status}' cannot be directly edited. Posted or under-review entries require an Accounting Reversal or Adjustment Entry per CAS/BIR rules.`
    });
    return;
  }

  if (!entryDate || !description || !lines || !lines.length) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Entry date, description, and lines are required" });
    return;
  }

  const formattedDate = new Date(entryDate).toISOString().slice(0, 10);

  try {
    // 1. Fail-closed Company Lock Date & Accounting Period Validation (check both original and target dates)
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    if (existing.entryDate && existing.entryDate.slice(0, 10) !== formattedDate) {
      await validateTransactionDateAndPeriod(companyId, existing.entryDate.slice(0, 10), {
        userRole: actorRole
      });
    }
    const resolvedPeriod = await validateTransactionDateAndPeriod(companyId, formattedDate, {
      userRole: actorRole
    });

    // 2. Balance and Line Integrity Check (Exact Integer Centavos)
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      const deb = Number(line.debit ?? 0);
      const cred = Number(line.credit ?? 0);
      if (!Number.isFinite(deb) || !Number.isFinite(cred) || !Number.isInteger(deb) || !Number.isInteger(cred)) {
        throw new DomainError("Journal line debit and credit amounts must be exact integer centavos.", "VALIDATION_ERROR", 400);
      }
      if (deb < 0 || cred < 0) throw new DomainError("Negative monetary values are rejected", "VALIDATION_ERROR", 400);
      if (deb > 0 && cred > 0) throw new DomainError("Line cannot have both debit and credit", "VALIDATION_ERROR", 400);
      if (deb === 0 && cred === 0) throw new DomainError("Line must have either debit or credit", "VALIDATION_ERROR", 400);

      // Verify Account
      const acc = await db.select().from(schema.accounts).where(
        and(eq(schema.accounts.id, line.accountId), eq(schema.accounts.companyId, companyId))
      ).get();
      if (!acc) throw new DomainError(`Invalid account ID: ${line.accountId}`, "INVALID_ACCOUNT", 400);
      if (acc.status && acc.status !== 'ACTIVE') throw new DomainError(`Account ${acc.accountCode} - ${acc.accountName} is inactive.`, "INACTIVE_ACCOUNT_ERROR", 400);

      totalDebit += deb;
      totalCredit += cred;
    }

    if (totalDebit !== totalCredit) {
      throw new DomainError(
        `Journal entry is unbalanced. Total Debit (${totalDebit} centavos) must exactly equal Total Credit (${totalCredit} centavos).`,
        "UNBALANCED_JOURNAL_ERROR",
        400
      );
    }

    if (totalDebit <= 0) {
      throw new DomainError("Journal entry total amount must be greater than zero.", "VALIDATION_ERROR", 400);
    }

    // 4. Fetch Original Lines for Comprehensive Before/After Audit Capture
    const originalLines = await db.select().from(schema.journalLines).where(
      eq(schema.journalLines.journalEntryId, id)
    ).orderBy(schema.journalLines.lineNumber);

    const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];

    await db.transaction(async (tx) => {
      const fresh = await tx.select().from(schema.journalEntries).where(and(
        eq(schema.journalEntries.id, id),
        eq(schema.journalEntries.companyId, companyId)
      )).get();

      if (!fresh) {
        throw new DomainError("Journal entry not found", "NOT_FOUND", 404);
      }

      if (expectedVersion !== undefined && expectedVersion !== null) {
        const expVer = Number(expectedVersion);
        const curVer = Number(fresh.version || 1);
        if (expVer !== curVer) {
          throw new DomainError(
            `CONCURRENT_MODIFICATION_CONFLICT: Record '${id}' was modified by another user (current version: v${curVer}, expected: v${expVer}). Please reload the latest record before re-applying changes.`,
            'CONCURRENT_MODIFICATION_CONFLICT',
            409,
            {
              recordId: id,
              currentVersion: curVer,
              clientVersion: expVer,
              updatedAt: fresh.updatedAt,
              updatedBy: fresh.createdBy
            }
          );
        }
      }

      const nextVersion = (fresh.version || 1) + 1;
      const updateRes = await tx.update(schema.journalEntries).set({
        journalNumber: journalNumber || fresh.journalNumber,
        entryDate: formattedDate,
        accountingPeriodId: resolvedPeriod.id,
        description,
        version: nextVersion,
        updatedAt: new Date()
      }).where(and(
        eq(schema.journalEntries.id, id),
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.version, fresh.version || 1)
      )).run();

      if (updateRes.changes === 0) {
        throw new DomainError(
          `CONCURRENT_MODIFICATION_CONFLICT: Record '${id}' was updated concurrently by another transaction. Please reload and re-apply.`,
          'CONCURRENT_MODIFICATION_CONFLICT',
          409,
          {
            recordId: id,
            currentVersion: (fresh.version || 1) + 1,
            clientVersion: expectedVersion
          }
        );
      }

      await tx.delete(schema.journalLines).where(eq(schema.journalLines.journalEntryId, id));

      let lineNumber = 1;
      for (const line of lines) {
        await tx.insert(schema.journalLines).values({
          id: crypto.randomUUID(),
          journalEntryId: id,
          accountId: line.accountId,
          description: line.description || '',
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          departmentId: line.departmentId || null,
          projectId: line.projectId || null,
          costCenterId: line.costCenterId || null,
          lineNumber: lineNumber++
        });
      }

      await tx.insert(schema.auditLogs).values({
        id: crypto.randomUUID(),
        companyId,
        userId: req.user!.id,
        action: statusUpper === 'RETURNED' ? 'CORRECT_RETURNED_JOURNAL' : 'UPDATE_JOURNAL_ENTRY',
        entityType: 'JOURNAL_ENTRY',
        entityId: id,
        recordReference: fresh.journalNumber,
        module: 'General Ledger',
        beforeData: JSON.stringify({
          journalNumber: fresh.journalNumber,
          entryDate: fresh.entryDate,
          accountingPeriodId: fresh.accountingPeriodId,
          description: fresh.description,
          status: fresh.status,
          version: fresh.version || 1,
          lines: originalLines.map(l => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
            departmentId: l.departmentId,
            projectId: l.projectId,
            costCenterId: l.costCenterId
          }))
        }),
        afterData: JSON.stringify({
          journalNumber: journalNumber || fresh.journalNumber,
          entryDate: formattedDate,
          accountingPeriodId: resolvedPeriod.id,
          description,
          status: fresh.status,
          version: nextVersion,
          correctionReason: correctionReason || 'Updated by authorized preparer',
          editorId: req.user!.id,
          editorName: req.user!.displayName || req.user!.email,
          lines: lines.map((l: any) => ({
            accountId: l.accountId,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            description: l.description || '',
            departmentId: l.departmentId || null,
            projectId: l.projectId || null,
            costCenterId: l.costCenterId || null
          }))
        }),
        metadata: JSON.stringify({
          journalNumber: fresh.journalNumber,
          previousStatus: fresh.status,
          isCorrection: statusUpper === 'RETURNED' || statusUpper === 'CORRECTION'
        })
      });
    });

    res.json({ message: "Journal entry updated successfully", id });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409)
      ? 409
      : (err instanceof DomainError ? (err.statusCode || 400) : (err.message.includes("not found") ? 404 : 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
  }
});

// Journal Entry Workflow Endpoints
router.post("/journals/:id/submit", requireAuth, requirePermission('accounting:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  try {
    await submitJournalEntry(companyId, id, req.user!.id, expectedVersion ? Number(expectedVersion) : undefined);
    await AuditService.log({
      req,
      companyId,
      action: "SUBMIT_JOURNAL_ENTRY",
      entityType: "JOURNAL_ENTRY",
      entityId: id,
      module: "ACCOUNTING",
      afterData: { status: "SUBMITTED", submittedBy: req.user!.id }
    });
    res.json({ message: "Journal entry submitted successfully", id, status: "SUBMITTED" });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : (err.message.includes("not found") ? 404 : 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
  }
});

router.post("/journals/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  try {
    const userRole = req.activeCompany?.roleName || req.activeCompany?.role || 'Company Owner';
    await approveJournalEntry(companyId, id, req.user!.id, userRole, expectedVersion ? Number(expectedVersion) : undefined);
    await AuditService.log({
      req,
      companyId,
      action: "APPROVE_JOURNAL_ENTRY",
      entityType: "JOURNAL_ENTRY",
      entityId: id,
      module: "ACCOUNTING",
      afterData: { status: "APPROVED", approvedBy: req.user!.id }
    });
    res.json({ message: "Journal entry approved successfully", id, status: "APPROVED" });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : (err.message.includes("not found") ? 404 : (err.message.includes("BRAC") || err.message.includes("Segregation") ? 403 : 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
  }
});

router.post("/journals/:id/reject", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body || {};
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  try {
    await rejectJournalEntry(companyId, id, req.user!.id, reason, expectedVersion ? Number(expectedVersion) : undefined);
    await AuditService.log({
      req,
      companyId,
      action: "REJECT_JOURNAL_ENTRY",
      entityType: "JOURNAL_ENTRY",
      entityId: id,
      module: "ACCOUNTING",
      reason: reason || "Rejected by approver",
      afterData: { status: "DRAFT" }
    });
    res.json({ message: "Journal entry rejected and returned to draft", id, status: "DRAFT" });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : (err.message.includes("not found") ? 404 : 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
  }
});

router.post("/journals/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await postJournalEntry(companyId, id, req.user!.id, actorRole, expectedVersion ? Number(expectedVersion) : undefined);
    await AuditService.log({
      req,
      companyId,
      action: "POST_JOURNAL_ENTRY",
      entityType: "JOURNAL_ENTRY",
      entityId: id,
      module: "ACCOUNTING",
      afterData: { status: "POSTED", postedBy: req.user!.id }
    });
    res.json({ message: "Journal entry posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409)
      ? 409
      : (err instanceof DomainError ? (err.statusCode || 400) : (err.message.includes("not found") ? 404 : 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
  }
});

router.post("/journals/:id/reverse", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reverseDate, newPeriodId } = req.body;
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  if (!reverseDate || !newPeriodId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "reverseDate and newPeriodId are required" });
    return;
  }
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const reverseId = await reverseJournalEntry(companyId, id, req.user!.id, reverseDate, newPeriodId, actorRole, expectedVersion ? Number(expectedVersion) : undefined);
    res.json({ message: "Journal entry reversed successfully", reverseId });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409)
      ? 409
      : (err instanceof DomainError ? (err.statusCode || 400) : (err.message.includes("not found") ? 404 : 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
  }
});

router.post("/journals/:id/void", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body;
  if (!reason) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "reason is required to void" });
    return;
  }
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await voidJournalEntry(companyId, id, req.user!.id, reason, actorRole);
    res.json({ message: "Journal entry voided successfully", id, status: "VOIDED" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/journals/:id/copy", requireAuth, requirePermission('accounting:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { newDate } = req.body;
  try {
    const newId = await copyJournalEntry(companyId, id, req.user!.id, newDate);
    res.status(201).json({ message: "Journal entry copied successfully", id: newId });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/journals/import", requireAuth, requirePermission('accounting:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { entries } = req.body;
  if (!entries || !Array.isArray(entries)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "entries array is required" });
    return;
  }
  try {
    const result = await importJournalEntries(companyId, req.user!.id, entries);
    res.json({ message: "Journals imported successfully", result });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// Get Purchase Bills (Viewer, Editor, Admin)
router.get("/purchase-bills", requireAuth, requirePermission('purchases:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const params = parsePaginationParams(req);

  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'procurement');
    const filterConditions = [eq(schema.purchaseBills.companyId, companyId)];
    if (!scope.isCompanyWide && (scope.dataScope === 'OWN_RECORDS' || scope.dataScope === 'ASSIGNED_RECORDS')) {
      filterConditions.push(eq(schema.purchaseBills.createdBy, req.user!.id));
    }

    if (params.search) {
      const searchPattern = `%${params.search}%`;
      filterConditions.push(
        or(
          like(schema.purchaseBills.billNumber, searchPattern),
          like(schema.purchaseBills.reference, searchPattern),
          like(schema.vendors.legalName, searchPattern),
          like(schema.vendors.code, searchPattern)
        )!
      );
    }

    const baseScopeConditions = [eq(schema.purchaseBills.companyId, companyId)];
    if (!scope.isCompanyWide && (scope.dataScope === 'OWN_RECORDS' || scope.dataScope === 'ASSIGNED_RECORDS')) {
      baseScopeConditions.push(eq(schema.purchaseBills.createdBy, req.user!.id));
    }

    const reqStatus = params.status ? params.status.toUpperCase().trim() : null;
    if (reqStatus && reqStatus !== 'ALL') {
      if (reqStatus === 'PARTIAL' || reqStatus === 'PARTIALLY_PAID') {
        filterConditions.push(sql`UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) IN ('PARTIAL', 'PARTIALLY_PAID')`);
      } else if (reqStatus === 'RETURNED') {
        filterConditions.push(sql`UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) IN ('RETURNED', 'REJECTED')`);
      } else {
        filterConditions.push(sql`UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) = ${reqStatus}`);
      }
    } else {
      filterConditions.push(sql`UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`);
    }

    const vendorIdParam = req.query.vendorId as string | undefined;
    if (vendorIdParam) {
      filterConditions.push(eq(schema.purchaseBills.vendorId, vendorIdParam));
    }

    // Load active company Purchase Order numbers for authoritative PO-Linked vs Direct Bill linkage & filtering
    const companyPos = await db
      .select({ poNumber: schema.purchaseOrders.poNumber })
      .from(schema.purchaseOrders)
      .where(
        and(
          eq(schema.purchaseOrders.companyId, companyId),
          sql`UPPER(COALESCE(${schema.purchaseOrders.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
        )
      );
    const companyPoNumbers: string[] = Array.from(
      new Set<string>(companyPos.map((p: any) => String(p.poNumber || '').trim()).filter(Boolean))
    );
    const companyPoNumberSet = new Set<string>(companyPoNumbers);

    const sourceParam = String(req.query.source || 'ALL').toUpperCase().trim();
    if (sourceParam === 'PO_LINKED') {
      filterConditions.push(
        sql`EXISTS (SELECT 1 FROM purchase_orders po WHERE po.company_id = ${companyId} AND po.po_number = ${schema.purchaseBills.reference} AND UPPER(COALESCE(po.status, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED'))`
      );
    } else if (sourceParam === 'DIRECT') {
      filterConditions.push(
        or(
          isNull(schema.purchaseBills.reference),
          sql`TRIM(COALESCE(${schema.purchaseBills.reference}, '')) = ''`,
          sql`NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.company_id = ${companyId} AND po.po_number = ${schema.purchaseBills.reference} AND UPPER(COALESCE(po.status, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED'))`
        )!
      );
    }

    if (params.fromDate) {
      filterConditions.push(gte(schema.purchaseBills.billDate, params.fromDate));
    }

    if (params.toDate) {
      filterConditions.push(lte(schema.purchaseBills.billDate, params.toDate));
    }

    const isAsc = params.order === 'ASC';
    const cursorCond = buildCursorCondition(
      schema.purchaseBills.billDate,
      schema.purchaseBills.id,
      params.decodedCursor,
      isAsc ? 'ASC' : 'DESC'
    );

    const queryConditions = [...filterConditions];
    if (cursorCond) {
      queryConditions.push(cursorCond);
    }

    const [countRes] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.purchaseBills)
      .innerJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
      .where(and(...filterConditions));
    const totalCount = Number(countRes?.total || 0);

    const bills = await db.select({
      id: schema.purchaseBills.id,
      billNumber: schema.purchaseBills.billNumber,
      billDate: schema.purchaseBills.billDate,
      dueDate: schema.purchaseBills.dueDate,
      reference: schema.purchaseBills.reference,
      notes: schema.purchaseBills.notes,
      attachmentUrl: schema.purchaseBills.attachmentUrl,
      totalAmount: schema.purchaseBills.totalAmount,
      balanceDue: schema.purchaseBills.balanceDue,
      status: schema.purchaseBills.status,
      vendorId: schema.purchaseBills.vendorId,
      vendorName: schema.vendors.legalName,
      vendorCode: schema.vendors.code,
      vendorTin: schema.vendors.tin,
    })
      .from(schema.purchaseBills)
      .innerJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
      .where(and(...queryConditions))
      .orderBy(
        isAsc ? asc(schema.purchaseBills.billDate) : desc(schema.purchaseBills.billDate),
        isAsc ? asc(schema.purchaseBills.id) : desc(schema.purchaseBills.id)
      )
      .limit(params.limit + 1);

    // Enrich bills with linked Purchase Order & GRN 3-Way Match provenance
    const refPoNumbers: string[] = Array.from(
      new Set<string>(
        bills
          .map((b: any) => String(b.reference || '').trim())
          .filter((r: string) => r.length > 0)
      )
    );
    const poByNumber = new Map<string, any>();
    const grnByPoId = new Map<string, string>();
    if (refPoNumbers.length > 0) {
      const linkedPos = await db
        .select({
          id: schema.purchaseOrders.id,
          poNumber: schema.purchaseOrders.poNumber,
          status: schema.purchaseOrders.status,
          totalAmount: schema.purchaseOrders.totalAmount,
        })
        .from(schema.purchaseOrders)
        .where(
          and(
            eq(schema.purchaseOrders.companyId, companyId),
            inArray(schema.purchaseOrders.poNumber, refPoNumbers)
          )
        );
      const matchedPoIds: string[] = [];
      for (const po of linkedPos) {
        poByNumber.set(po.poNumber, po);
        matchedPoIds.push(po.id);
      }
      if (matchedPoIds.length > 0) {
        const linkedGrns = await db
          .select({
            poId: schema.goodsReceiptNotes.poId,
            grnNumber: schema.goodsReceiptNotes.grnNumber,
          })
          .from(schema.goodsReceiptNotes)
          .where(
            and(
              eq(schema.goodsReceiptNotes.companyId, companyId),
              inArray(schema.goodsReceiptNotes.poId, matchedPoIds)
            )
          );
        for (const g of linkedGrns) {
          if (!grnByPoId.has(g.poId)) grnByPoId.set(g.poId, g.grnNumber);
        }
      }
    }

    const normalizedBills = bills.map((b: any) => {
      const refKey = String(b.reference || '').trim();
      const linkedPo = refKey ? poByNumber.get(refKey) : null;
      const linkedGrnNumber = linkedPo ? (grnByPoId.get(linkedPo.id) || null) : null;
      return {
        ...b,
        status: String(b.status || 'DRAFT').toUpperCase() === 'PARTIALLY_PAID' ? 'PARTIAL' : b.status,
        linkedPoId: linkedPo?.id || null,
        linkedPoNumber: linkedPo?.poNumber || null,
        linkedPoStatus: linkedPo?.status || null,
        linkedGrnNumber,
        isThreeWayMatched: Boolean(linkedPo),
      };
    });

    const paginated = formatPaginatedResponse({
      items: normalizedBills,
      limit: params.limit,
      getSortValAndId: (b: any) => ({ val: b.purchase_bills?.billDate ?? b.billDate, id: b.purchase_bills?.id ?? b.id }),
      totalCount,
      raw: params.raw
    });

    if (params.raw) {
      return res.json(paginated);
    }

    // Authoritative database-level Accounts Payable (AP) & status aggregates across ALL company-scoped records
    const todayIso = new Date().toISOString().slice(0, 10);
    const statusRows = await db
      .select({
        status: sql<string>`UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT'))`,
        cnt: sql<number>`count(*)`,
      })
      .from(schema.purchaseBills)
      .where(and(...baseScopeConditions))
      .groupBy(sql`UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT'))`);

    const statusCounts: Record<string, number> = {
      ALL: 0,
      DRAFT: 0,
      SUBMITTED: 0,
      RETURNED: 0,
      APPROVED: 0,
      POSTED: 0,
      PARTIAL: 0,
      PAID: 0,
      CANCELLED: 0,
      REVERSED: 0,
      ARCHIVED: 0,
      REMOVED: 0,
      SOFT_DELETED: 0,
      TOTAL_ARCHIVED_OR_REMOVED: 0,
    };

    for (const row of statusRows) {
      const st = String(row.status || 'DRAFT').toUpperCase();
      const cnt = Number(row.cnt || 0);
      if (['ARCHIVED', 'REMOVED', 'SOFT_DELETED'].includes(st)) {
        statusCounts[st] = (statusCounts[st] || 0) + cnt;
        statusCounts.TOTAL_ARCHIVED_OR_REMOVED += cnt;
      } else {
        statusCounts.ALL += cnt;
        if (st === 'PARTIALLY_PAID' || st === 'PARTIAL') {
          statusCounts.PARTIAL += cnt;
        } else if (st === 'RETURNED' || st === 'REJECTED') {
          statusCounts.RETURNED += cnt;
        } else {
          statusCounts[st] = (statusCounts[st] || 0) + cnt;
        }
      }
    }

    const [apAgg] = await db
      .select({
        totalApOutstanding: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.purchaseBills.balanceDue}, 0) > 0 THEN ${schema.purchaseBills.balanceDue} ELSE 0 END), 0)`,
        postedApBalance: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) = 'POSTED' AND COALESCE(${schema.purchaseBills.balanceDue}, 0) > 0 THEN ${schema.purchaseBills.balanceDue} ELSE 0 END), 0)`,
        partialApBalance: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) IN ('PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.purchaseBills.balanceDue}, 0) > 0 THEN ${schema.purchaseBills.balanceDue} ELSE 0 END), 0)`,
        totalGrossBilledOpenAp: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.purchaseBills.balanceDue}, 0) > 0 THEN ${schema.purchaseBills.totalAmount} ELSE 0 END), 0)`,
        overduePayables: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.purchaseBills.balanceDue}, 0) > 0 AND ${schema.purchaseBills.dueDate} < ${todayIso} THEN ${schema.purchaseBills.balanceDue} ELSE 0 END), 0)`,
        overdueBillsCount: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.purchaseBills.balanceDue}, 0) > 0 AND ${schema.purchaseBills.dueDate} < ${todayIso} THEN 1 ELSE 0 END), 0)`,
        currentNotDueAp: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.purchaseBills.balanceDue}, 0) > 0 AND (${schema.purchaseBills.dueDate} >= ${todayIso} OR ${schema.purchaseBills.dueDate} IS NULL) THEN ${schema.purchaseBills.balanceDue} ELSE 0 END), 0)`,
        currentNotDueCount: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.purchaseBills.balanceDue}, 0) > 0 AND (${schema.purchaseBills.dueDate} >= ${todayIso} OR ${schema.purchaseBills.dueDate} IS NULL) THEN 1 ELSE 0 END), 0)`,
        activeBillsCount: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED', 'CANCELLED', 'REVERSED') THEN 1 ELSE 0 END), 0)`,
        draftUnpostedPotentialAp: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'REJECTED', 'APPROVED') THEN ${schema.purchaseBills.totalAmount} ELSE 0 END), 0)`,
        unpostedApprovedCount: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) = 'APPROVED' THEN 1 ELSE 0 END), 0)`,
        unpostedApprovedCentavos: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) = 'APPROVED' THEN ${schema.purchaseBills.totalAmount} ELSE 0 END), 0)`,
      })
      .from(schema.purchaseBills)
      .where(and(...baseScopeConditions));

    // Reconcile against General Ledger Accounts Payable Control Account (Code 2010 or AP subtype)
    const [glApRow] = await db
      .select({
        glApBalance: sql<number>`COALESCE(SUM(${schema.journalLines.credit} - ${schema.journalLines.debit}), 0)`,
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(
        and(
          eq(schema.journalEntries.companyId, companyId),
          eq(schema.journalEntries.status, 'POSTED'),
          or(
            eq(schema.accounts.accountCode, '2010'),
            like(sql`LOWER(${schema.accounts.accountName})`, '%accounts payable%')
          )!
        )
      );

    const totalApOutstanding = Number(apAgg?.totalApOutstanding || 0);
    const glApBalance = Number(glApRow?.glApBalance || 0);

    // Authoritative PO-Linked (3-Way Matched) vs Direct Supplier Bill breakdown across all scoped active bills
    const scopedActiveForSource = await db
      .select({
        reference: schema.purchaseBills.reference,
        status: schema.purchaseBills.status,
        balanceDue: schema.purchaseBills.balanceDue,
      })
      .from(schema.purchaseBills)
      .where(
        and(
          ...baseScopeConditions,
          sql`UPPER(COALESCE(${schema.purchaseBills.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED', 'CANCELLED', 'REVERSED')`
        )
      );

    let poLinkedBillsCount = 0;
    let directBillsCount = 0;
    let poLinkedOpenAp = 0;
    let directBillsOpenAp = 0;

    for (const row of scopedActiveForSource) {
      const ref = String(row.reference || '').trim();
      const isPo = ref.length > 0 && companyPoNumberSet.has(ref);
      if (isPo) {
        poLinkedBillsCount++;
      } else {
        directBillsCount++;
      }
      const st = String(row.status || 'DRAFT').toUpperCase();
      const bal = Number(row.balanceDue || 0);
      if (['POSTED', 'PARTIAL', 'PARTIALLY_PAID'].includes(st) && bal > 0) {
        if (isPo) {
          poLinkedOpenAp += bal;
        } else {
          directBillsOpenAp += bal;
        }
      }
    }

    res.json({
      ...paginated,
      summary: {
        totalApOutstanding,
        postedApBalance: Number(apAgg?.postedApBalance || 0),
        partialApBalance: Number(apAgg?.partialApBalance || 0),
        totalGrossBilledOpenAp: Number(apAgg?.totalGrossBilledOpenAp || 0),
        settledOnOpenAp: Math.max(0, Number(apAgg?.totalGrossBilledOpenAp || 0) - totalApOutstanding),
        overduePayables: Number(apAgg?.overduePayables || 0),
        overdueBillsCount: Number(apAgg?.overdueBillsCount || 0),
        currentNotDueAp: Number(apAgg?.currentNotDueAp || 0),
        currentNotDueCount: Number(apAgg?.currentNotDueCount || 0),
        activeBillsCount: Number(apAgg?.activeBillsCount || 0),
        poLinkedBillsCount,
        directBillsCount,
        poLinkedOpenAp,
        directBillsOpenAp,
        totalPoCount: companyPoNumbers.length,
        draftUnpostedPotentialAp: Number(apAgg?.draftUnpostedPotentialAp || 0),
        unpostedApprovedCount: Number(apAgg?.unpostedApprovedCount || 0),
        unpostedApprovedCentavos: Number(apAgg?.unpostedApprovedCentavos || 0),
        glApBalance,
        glSubledgerVariance: totalApOutstanding - glApBalance,
        isGlReconciled: Math.abs(totalApOutstanding - glApBalance) < 1,
        asOfDate: todayIso,
        statusCounts
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.get("/open-bills", requireAuth, requirePermission('purchases:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const vendorId = req.query.vendorId as string | undefined;

  try {
    const conditions = [
      eq(schema.purchaseBills.companyId, companyId),
      sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID')`,
      sql`${schema.purchaseBills.balanceDue} > 0`
    ];

    if (vendorId) {
      conditions.push(eq(schema.purchaseBills.vendorId, vendorId));
    }

    const bills = await db.select({
      id: schema.purchaseBills.id,
      companyId: schema.purchaseBills.companyId,
      vendorId: schema.purchaseBills.vendorId,
      vendorName: schema.vendors.legalName,
      vendorCode: schema.vendors.code,
      billNumber: schema.purchaseBills.billNumber,
      billDate: schema.purchaseBills.billDate,
      dueDate: schema.purchaseBills.dueDate,
      reference: schema.purchaseBills.reference,
      totalAmount: schema.purchaseBills.totalAmount,
      balanceDue: schema.purchaseBills.balanceDue,
      status: schema.purchaseBills.status,
      createdAt: schema.purchaseBills.createdAt,
    })
    .from(schema.purchaseBills)
    .innerJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
    .where(and(...conditions))
    .orderBy(desc(schema.purchaseBills.billDate))
    .limit(Math.min(1000, Number(req.query.limit) || 200));

    res.json(bills);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.get("/purchase-bills/:id", requireAuth, requirePermission('purchases:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;

  try {
    const bill = await db.select({
      id: schema.purchaseBills.id,
      companyId: schema.purchaseBills.companyId,
      vendorId: schema.purchaseBills.vendorId,
      vendorName: schema.vendors.legalName,
      vendorCode: schema.vendors.code,
      vendorTin: schema.vendors.tin,
      vendorAddress: schema.vendors.address,
      billNumber: schema.purchaseBills.billNumber,
      billDate: schema.purchaseBills.billDate,
      dueDate: schema.purchaseBills.dueDate,
      reference: schema.purchaseBills.reference,
      notes: schema.purchaseBills.notes,
      attachmentUrl: schema.purchaseBills.attachmentUrl,
      totalAmount: schema.purchaseBills.totalAmount,
      balanceDue: schema.purchaseBills.balanceDue,
      status: schema.purchaseBills.status,
      journalEntryId: schema.purchaseBills.journalEntryId,
      createdBy: schema.purchaseBills.createdBy,
      createdAt: schema.purchaseBills.createdAt,
    })
    .from(schema.purchaseBills)
    .innerJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
    .where(and(eq(schema.purchaseBills.id, id), eq(schema.purchaseBills.companyId, companyId)))
    .get();

    if (!bill) return res.status(404).json({ error: "NOT_FOUND", message: "Purchase bill not found" });

    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'procurement');
    if (!scope.isCompanyWide && (scope.dataScope === 'OWN_RECORDS' || scope.dataScope === 'ASSIGNED_RECORDS')) {
      scope.assertRecordAccess({ createdBy: bill.createdBy }, "purchase bill");
    }

    const lines = await db.select({
      id: schema.purchaseBillLines.id,
      accountId: schema.purchaseBillLines.accountId,
      accountName: schema.accounts.accountName,
      accountCode: schema.accounts.accountCode,
      taxCodeId: schema.purchaseBillLines.taxCodeId,
      description: schema.purchaseBillLines.description,
      quantity: schema.purchaseBillLines.quantity,
      unitPrice: schema.purchaseBillLines.unitPrice,
      amount: schema.purchaseBillLines.amount,
    })
    .from(schema.purchaseBillLines)
    .innerJoin(schema.accounts, eq(schema.purchaseBillLines.accountId, schema.accounts.id))
    .where(eq(schema.purchaseBillLines.billId, id));

    res.json({ ...bill, lines });
  } catch (err: any) {
    if (err.statusCode === 403 || err.code === "DATA_SCOPE_VIOLATION") {
      res.status(403).json({ error: "PERMISSION_DENIED", code: "DATA_SCOPE_VIOLATION", message: err.message });
      return;
    }
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

// Create Purchase Bill (Requires Editor or Admin role)
router.post("/purchase-bills", requireAuth, requirePermission('purchases:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { vendorId, billNumber, billDate, dueDate, reference, notes, attachmentUrl, totalAmount, lines } = req.body;

  if (!vendorId || !billNumber || !totalAmount) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Vendor, bill number, and total amount are required" });
    return;
  }

  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const id = await createPurchaseBill(companyId, {
      vendorId,
      billNumber,
      billDate: billDate ? new Date(billDate).toISOString() : new Date().toISOString(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : new Date().toISOString(),
      reference,
      notes,
      attachmentUrl,
      totalAmount: Number(totalAmount),
      lines,
    }, req.user!.id, actorRole);
    
    // Real-time notifications
    await broadcastNotification({
      companyId,
      title: "New Purchase Bill Recorded",
      message: `Bill ${billNumber} was recorded by ${req.user!.displayName}.`,
      type: "SYSTEM",
      entityType: "purchase_bill",
      entityId: id,
    });

    res.status(201).json({ message: "Purchase bill created successfully", id, billNumber });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, cause: err.cause ? err.cause.message : err.toString() });
  }
});

// Purchase Bills Workflow Endpoints
router.post("/purchase-bills/:id/submit", requireAuth, requirePermission('purchases:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  try {
    await submitPurchaseBill(companyId, id, req.user!.id, expectedVersion ? Number(expectedVersion) : undefined);
    await AuditService.log({
      req,
      companyId,
      action: "SUBMIT_PURCHASE_BILL",
      entityType: "PURCHASE_BILL",
      entityId: id,
      module: "PURCHASES",
      afterData: { status: "SUBMITTED", submittedBy: req.user!.id }
    });
    res.json({ message: "Purchase bill submitted successfully", id, status: "SUBMITTED" });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : (err.message.includes("not found") ? 404 : 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
  }
});

router.post("/purchase-bills/:id/review", requireAuth, requirePermission('purchases:review'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const bill = await db.select().from(schema.purchaseBills).where(and(eq(schema.purchaseBills.id, id), eq(schema.purchaseBills.companyId, companyId))).get();
    if (!bill) {
      res.status(404).json({ error: "NOT_FOUND", message: "Purchase bill not found" });
      return;
    }
    await db.update(schema.purchaseBills).set({
      status: "REVIEWED",
      updatedAt: new Date()
    }).where(and(eq(schema.purchaseBills.id, id), eq(schema.purchaseBills.companyId, companyId)));

    await AuditService.log({
      req,
      companyId,
      action: "REVIEW_PURCHASE_BILL",
      entityType: "PURCHASE_BILL",
      entityId: id,
      module: "PURCHASES",
      afterData: { status: "REVIEWED", reviewedBy: req.user!.id }
    });
    res.json({ message: "Purchase bill reviewed successfully", id, status: "REVIEWED" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/purchase-bills/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  try {
    const bill = await db.select().from(schema.purchaseBills).where(and(eq(schema.purchaseBills.id, id), eq(schema.purchaseBills.companyId, companyId))).get();
    if (!bill) {
      res.status(404).json({ error: "NOT_FOUND", message: "Purchase bill not found" });
      return;
    }

    const limit = req.activeCompany?.approvalLimitCentavos;
    if (limit !== undefined && limit !== null && limit > 0 && bill.totalAmount > limit) {
      res.status(403).json({
        error: "APPROVAL_LIMIT_EXCEEDED",
        message: `Transaction amount (${bill.totalAmount} centavos) exceeds custom approval limit (${limit} centavos).`
      });
      return;
    }

    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await approvePurchaseBill(companyId, id, req.user!.id, expectedVersion ? Number(expectedVersion) : undefined, actorRole);
    await AuditService.log({
      req,
      companyId,
      action: "APPROVE_PURCHASE_BILL",
      entityType: "PURCHASE_BILL",
      entityId: id,
      module: "PURCHASES",
      afterData: { status: "APPROVED", approvedBy: req.user!.id }
    });
    res.json({ message: "Purchase bill approved successfully", id, status: "APPROVED" });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : (err.message.includes("not found") ? 404 : (err.message.includes("BRAC") || err.message.includes("Segregation") ? 403 : 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
  }
});

router.post("/purchase-bills/:id/reject", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body || {};
  try {
    await rejectPurchaseBill(companyId, id, req.user!.id, reason);
    await AuditService.log({
      req,
      companyId,
      action: "REJECT_PURCHASE_BILL",
      entityType: "PURCHASE_BILL",
      entityId: id,
      module: "PURCHASES",
      reason: reason || "Rejected by approver",
      afterData: { status: "DRAFT" }
    });
    res.json({ message: "Purchase bill rejected and returned to draft", id, status: "DRAFT" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/purchase-bills/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { periodId, lines } = req.body;
  try {
    const bill = await db.select().from(schema.purchaseBills).where(and(eq(schema.purchaseBills.id, id), eq(schema.purchaseBills.companyId, companyId))).get();
    const resolvedPeriodId = periodId || await resolveDefaultPeriodId(companyId, bill?.billDate);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await postPurchaseBill(companyId, id, resolvedPeriodId, lines || [], req.user!.id, actorRole);
    await AuditService.log({
      req,
      companyId,
      action: "POST_PURCHASE_BILL",
      entityType: "PURCHASE_BILL",
      entityId: id,
      module: "PURCHASES",
      afterData: { status: "POSTED" }
    });
    res.json({ message: "Purchase bill posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.message.includes("not found") ? 404 : (err.statusCode || 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// Pay Purchase Bill / Issue Disbursement Voucher
router.post("/purchase-bills/:id/pay", requireAuth, requirePermission('purchases:create', 'purchases:edit', 'cash:manage', 'cash:create', 'cash:edit', 'accounting:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const billId = req.params.id;
  const userId = req.user!.id;
  const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
  const {
    paymentNumber,
    paymentDate,
    amountCentavos,
    amount,
    withholdingTaxAmount,
    withholdingTaxAccountId,
    cashAccountId,
    paymentMethod,
    atcCode,
    reference,
    notes,
    autoPost = true
  } = req.body;

  try {
    const bill = await db.select().from(schema.purchaseBills).where(
      and(eq(schema.purchaseBills.id, billId), eq(schema.purchaseBills.companyId, companyId))
    ).get();

    if (!bill) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Purchase bill not found" });
    }

    // Strict double-entry enforcement: Bill must be POSTED to GL Account 2010 before issuing a Disbursement Voucher
    if (!['POSTED', 'PARTIAL', 'PARTIALLY_PAID'].includes(bill.status.toUpperCase())) {
      return res.status(400).json({
        error: "BILL_NOT_POSTED",
        message: `Bill status is ${bill.status}. Post the bill to the General Ledger (Account 2010 AP) first before recording a Disbursement Voucher (DV).`
      });
    }

    const payDate = paymentDate || new Date().toISOString().slice(0, 10);
    const payNum = paymentNumber || `PV-${Date.now().toString().slice(-6)}`;

    // Resolve cash account if not provided
    let finalCashAccountId = cashAccountId;
    if (!finalCashAccountId) {
      const defaultCash = await resolveCompanyControlAccount(db, companyId, "CASH");
      finalCashAccountId = defaultCash?.id;
    }
    if (!finalCashAccountId) {
      const anyCash = await db.select().from(schema.accounts).where(
        and(
          eq(schema.accounts.companyId, companyId),
          or(eq(schema.accounts.accountType, 'ASSET'), eq(schema.accounts.accountType, 'BANK'), eq(schema.accounts.accountType, 'CASH'))
        )
      ).limit(1).get();
      finalCashAccountId = anyCash?.id;
    }

    const ewtCentavos = Math.max(0, Math.round(Number(withholdingTaxAmount || 0)));
    const rawAmountInput = amountCentavos !== undefined && amountCentavos !== null
      ? Number(amountCentavos)
      : amount !== undefined && amount !== null
        ? Number(amount)
        : Math.max(0, Number(bill.balanceDue || 0) - ewtCentavos);
    const netPayCentavos = Math.round(rawAmountInput);

    if (!Number.isFinite(netPayCentavos) || netPayCentavos < 0 || (netPayCentavos + ewtCentavos) <= 0) {
      return res.status(400).json({
        error: "INVALID_PAYMENT_AMOUNT",
        message: "Disbursement payment amount must be greater than zero."
      });
    }
    const atcNoteSuffix = atcCode && atcCode !== 'NONE' ? ` [BIR Form 2307 ATC: ${String(atcCode).toUpperCase()}]` : '';

    const paymentId = await createSupplierPayment(
      companyId,
      {
        vendorId: bill.vendorId,
        paymentNumber: payNum,
        paymentDate: payDate,
        amount: netPayCentavos,
        cashAccountId: finalCashAccountId,
        withholdingTaxAmount: ewtCentavos,
        withholdingTaxAccountId,
        paymentMethod: paymentMethod || 'BANK_TRANSFER',
        reference: reference || `Payment for Bill #${bill.billNumber}`,
        notes: `${notes || `Disbursement Voucher for Bill #${bill.billNumber}`}${atcNoteSuffix}`,
        applications: [
          {
            billId: bill.id,
            appliedAmount: netPayCentavos,
            withholdingAmount: ewtCentavos,
          }
        ]
      },
      userId,
      actorRole
    );

    if (autoPost) {
      const resolvedPeriodId = await resolveDefaultPeriodId(companyId, payDate);
      await postSupplierPayment(companyId, paymentId, resolvedPeriodId, userId, undefined, actorRole);
    }

    // Refresh bill after payment
    const updatedBill = await db.select().from(schema.purchaseBills).where(eq(schema.purchaseBills.id, bill.id)).get();

    res.json({
      success: true,
      paymentId,
      paymentNumber: payNum,
      billId: bill.id,
      billNumber: bill.billNumber,
      newBalanceDue: updatedBill?.balanceDue,
      newStatus: updatedBill?.status,
      message: `Disbursement voucher ${payNum} successfully recorded and applied against bill ${bill.billNumber}.`
    });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "PAYMENT_ERROR", message: err.message || "Failed to record bill payment" });
  }
});

// ---------------------------------------------------------
// SUPPLIER PAYMENTS ENDPOINTS
// ---------------------------------------------------------

router.get("/supplier-payments", requireAuth, requirePermission('purchases:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const payments = await db.select({
      id: schema.supplierPayments.id,
      paymentNumber: schema.supplierPayments.paymentNumber,
      paymentDate: schema.supplierPayments.paymentDate,
      vendorId: schema.supplierPayments.vendorId,
      vendorName: schema.vendors.legalName,
      vendorCode: schema.vendors.code,
      cashAccountId: schema.supplierPayments.cashAccountId,
      cashAccountName: schema.accounts.accountName,
      amount: schema.supplierPayments.amount,
      withholdingTaxAmount: schema.supplierPayments.withholdingTaxAmount,
      overpaymentAmount: schema.supplierPayments.overpaymentAmount,
      paymentMethod: schema.supplierPayments.paymentMethod,
      reference: schema.supplierPayments.reference,
      notes: schema.supplierPayments.notes,
      attachmentUrl: schema.supplierPayments.attachmentUrl,
      status: schema.supplierPayments.status,
      createdAt: schema.supplierPayments.createdAt,
    })
    .from(schema.supplierPayments)
    .innerJoin(schema.vendors, eq(schema.supplierPayments.vendorId, schema.vendors.id))
    .innerJoin(schema.accounts, eq(schema.supplierPayments.cashAccountId, schema.accounts.id))
    .where(and(
      eq(schema.supplierPayments.companyId, companyId),
      sql`UPPER(COALESCE(${schema.supplierPayments.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
    ))
    .orderBy(desc(schema.supplierPayments.paymentDate))
    .limit(Math.min(1000, Number(req.query.limit) || 200));

    res.json(payments);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.get("/supplier-payments/:id", requireAuth, requirePermission('purchases:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const payment = await db.select({
      id: schema.supplierPayments.id,
      paymentNumber: schema.supplierPayments.paymentNumber,
      paymentDate: schema.supplierPayments.paymentDate,
      vendorId: schema.supplierPayments.vendorId,
      vendorName: schema.vendors.legalName,
      vendorCode: schema.vendors.code,
      vendorTin: schema.vendors.tin,
      vendorAddress: schema.vendors.address,
      cashAccountId: schema.supplierPayments.cashAccountId,
      cashAccountName: schema.accounts.accountName,
      amount: schema.supplierPayments.amount,
      withholdingTaxAmount: schema.supplierPayments.withholdingTaxAmount,
      withholdingTaxAccountId: schema.supplierPayments.withholdingTaxAccountId,
      overpaymentAmount: schema.supplierPayments.overpaymentAmount,
      paymentMethod: schema.supplierPayments.paymentMethod,
      reference: schema.supplierPayments.reference,
      notes: schema.supplierPayments.notes,
      attachmentUrl: schema.supplierPayments.attachmentUrl,
      status: schema.supplierPayments.status,
      journalEntryId: schema.supplierPayments.journalEntryId,
      createdAt: schema.supplierPayments.createdAt,
    })
    .from(schema.supplierPayments)
    .innerJoin(schema.vendors, eq(schema.supplierPayments.vendorId, schema.vendors.id))
    .innerJoin(schema.accounts, eq(schema.supplierPayments.cashAccountId, schema.accounts.id))
    .where(and(eq(schema.supplierPayments.id, id), eq(schema.supplierPayments.companyId, companyId)))
    .get();

    if (!payment) return res.status(404).json({ error: "NOT_FOUND", message: "Supplier payment not found" });

    const applications = await db.select({
      id: schema.supplierPaymentApplications.id,
      billId: schema.supplierPaymentApplications.billId,
      billNumber: schema.purchaseBills.billNumber,
      billDate: schema.purchaseBills.billDate,
      totalAmount: schema.purchaseBills.totalAmount,
      appliedAmount: schema.supplierPaymentApplications.appliedAmount,
      withholdingAmount: schema.supplierPaymentApplications.withholdingAmount,
    })
    .from(schema.supplierPaymentApplications)
    .innerJoin(schema.purchaseBills, eq(schema.supplierPaymentApplications.billId, schema.purchaseBills.id))
    .where(eq(schema.supplierPaymentApplications.paymentId, id));

    res.json({ ...payment, applications });
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.post("/supplier-payments", requireAuth, requirePermission('purchases:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const id = await createSupplierPayment(companyId, req.body, req.user!.id, actorRole);
    res.json({ message: "Supplier payment created successfully", id });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/supplier-payments/:id/submit", requireAuth, requirePermission('purchases:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await submitSupplierPayment(companyId, id, req.user!.id);
    res.json({ message: "Supplier payment submitted successfully", id, status: "SUBMITTED" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/supplier-payments/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await approveSupplierPayment(companyId, id, req.user!.id, actorRole);
    res.json({ message: "Supplier payment approved successfully", id, status: "APPROVED" });
  } catch (err: any) {
    const status = err.message.includes("BRAC") || err.message.includes("Segregation") ? 403 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/supplier-payments/:id/reject", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body || {};
  try {
    await rejectSupplierPayment(companyId, id, req.user!.id, reason);
    res.json({ message: "Supplier payment rejected and returned to draft", id, status: "DRAFT" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/supplier-payments/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { periodId } = req.body || {};
  try {
    const payment = await db.select().from(schema.supplierPayments).where(and(eq(schema.supplierPayments.id, id), eq(schema.supplierPayments.companyId, companyId))).get();
    const resolvedPeriodId = periodId || await resolveDefaultPeriodId(companyId, payment?.paymentDate);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await postSupplierPayment(companyId, id, resolvedPeriodId, req.user!.id, undefined, actorRole);
    res.json({ message: "Supplier payment posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// ---------------------------------------------------------
// DEBIT MEMOS ENDPOINTS
// ---------------------------------------------------------

router.get("/debit-memos", requireAuth, requirePermission('purchases:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const memos = await db.select({
      id: schema.debitMemos.id,
      debitMemoNumber: schema.debitMemos.debitMemoNumber,
      memoDate: schema.debitMemos.memoDate,
      vendorId: schema.debitMemos.vendorId,
      vendorName: schema.vendors.legalName,
      vendorCode: schema.vendors.code,
      reason: schema.debitMemos.reason,
      totalAmount: schema.debitMemos.totalAmount,
      balanceRemaining: schema.debitMemos.balanceRemaining,
      attachmentUrl: schema.debitMemos.attachmentUrl,
      status: schema.debitMemos.status,
      createdAt: schema.debitMemos.createdAt,
    })
    .from(schema.debitMemos)
    .innerJoin(schema.vendors, eq(schema.debitMemos.vendorId, schema.vendors.id))
    .where(and(
      eq(schema.debitMemos.companyId, companyId),
      sql`UPPER(COALESCE(${schema.debitMemos.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
    ))
    .orderBy(desc(schema.debitMemos.memoDate));

    res.json(memos);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.get("/debit-memos/:id", requireAuth, requirePermission('purchases:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const memo = await db.select({
      id: schema.debitMemos.id,
      debitMemoNumber: schema.debitMemos.debitMemoNumber,
      memoDate: schema.debitMemos.memoDate,
      vendorId: schema.debitMemos.vendorId,
      vendorName: schema.vendors.legalName,
      vendorCode: schema.vendors.code,
      reason: schema.debitMemos.reason,
      totalAmount: schema.debitMemos.totalAmount,
      balanceRemaining: schema.debitMemos.balanceRemaining,
      attachmentUrl: schema.debitMemos.attachmentUrl,
      status: schema.debitMemos.status,
      journalEntryId: schema.debitMemos.journalEntryId,
      createdAt: schema.debitMemos.createdAt,
    })
    .from(schema.debitMemos)
    .innerJoin(schema.vendors, eq(schema.debitMemos.vendorId, schema.vendors.id))
    .where(and(eq(schema.debitMemos.id, id), eq(schema.debitMemos.companyId, companyId)))
    .get();

    if (!memo) return res.status(404).json({ error: "NOT_FOUND", message: "Debit memo not found" });

    const lines = await db.select().from(schema.debitMemoLines).where(eq(schema.debitMemoLines.debitMemoId, id));
    const applications = await db.select().from(schema.debitMemoApplications).where(eq(schema.debitMemoApplications.debitMemoId, id));

    res.json({ ...memo, lines, applications });
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.post("/debit-memos", requireAuth, requirePermission('purchases:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const id = await createDebitMemo(companyId, req.body, req.user!.id, actorRole);
    res.json({ message: "Debit memo created successfully", id });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/debit-memos/:id/submit", requireAuth, requirePermission('purchases:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await submitDebitMemo(companyId, id, req.user!.id);
    res.json({ message: "Debit memo submitted successfully", id, status: "SUBMITTED" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/debit-memos/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await approveDebitMemo(companyId, id, req.user!.id, actorRole);
    res.json({ message: "Debit memo approved successfully", id, status: "APPROVED" });
  } catch (err: any) {
    const status = err.message.includes("BRAC") || err.message.includes("Segregation") ? 403 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/debit-memos/:id/reject", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body || {};
  try {
    await rejectDebitMemo(companyId, id, req.user!.id, reason);
    res.json({ message: "Debit memo rejected and returned to draft", id, status: "DRAFT" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/debit-memos/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { periodId } = req.body || {};
  try {
    const memo = await db.select().from(schema.debitMemos).where(and(eq(schema.debitMemos.id, id), eq(schema.debitMemos.companyId, companyId))).get();
    const resolvedPeriodId = periodId || await resolveDefaultPeriodId(companyId, memo?.memoDate);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await postDebitMemo(companyId, id, resolvedPeriodId, req.user!.id, undefined, actorRole);
    res.json({ message: "Debit memo posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// ---------------------------------------------------------
// ACCOUNTS PAYABLE (AP) AGING & SUPPLIER STATEMENT
// ---------------------------------------------------------

router.get("/ap-aging", requireAuth, requirePermission('reports:view', 'purchases:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const asOfDate = (req.query.asOfDate as string) || new Date().toISOString().slice(0, 10);

  try {
    const vendorList = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId));

    const openBills = await db.select({
      id: schema.purchaseBills.id,
      vendorId: schema.purchaseBills.vendorId,
      billNumber: schema.purchaseBills.billNumber,
      billDate: schema.purchaseBills.billDate,
      dueDate: schema.purchaseBills.dueDate,
      totalAmount: schema.purchaseBills.totalAmount,
      balanceDue: schema.purchaseBills.balanceDue,
    })
    .from(schema.purchaseBills)
    .where(and(
      eq(schema.purchaseBills.companyId, companyId),
      sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID')`,
      sql`${schema.purchaseBills.balanceDue} > 0`
    ));

    const asOfTime = new Date(asOfDate).getTime();

    const agingByVendor: Record<string, any> = {};
    let grandTotalSubsidiary = 0;

    vendorList.forEach(v => {
      agingByVendor[v.id] = {
        vendorId: v.id,
        vendorCode: v.code,
        vendorName: v.legalName,
        current: 0,
        days1_30: 0,
        days31_60: 0,
        days61_90: 0,
        days91_plus: 0,
        totalBalance: 0,
      };
    });

    openBills.forEach(bill => {
      if (!agingByVendor[bill.vendorId]) return;
      const dueDate = bill.dueDate ? new Date(bill.dueDate).getTime() : new Date(bill.billDate).getTime();
      const diffDays = Math.floor((asOfTime - dueDate) / (1000 * 60 * 60 * 24));

      const bal = bill.balanceDue;
      grandTotalSubsidiary += bal;
      agingByVendor[bill.vendorId].totalBalance += bal;

      if (diffDays <= 0) {
        agingByVendor[bill.vendorId].current += bal;
      } else if (diffDays <= 30) {
        agingByVendor[bill.vendorId].days1_30 += bal;
      } else if (diffDays <= 60) {
        agingByVendor[bill.vendorId].days31_60 += bal;
      } else if (diffDays <= 90) {
        agingByVendor[bill.vendorId].days61_90 += bal;
      } else {
        agingByVendor[bill.vendorId].days91_plus += bal;
      }
    });

    const agingRows = Object.values(agingByVendor).filter(v => v.totalBalance !== 0);

    // Fetch GL AP Control Account Balance (supports 2010, 2110, 2000 leaf, PAYABLE control accounts, and vendor-mapped AP accounts)
    const vendorApIds = Array.from(
      new Set(vendorList.map((v: any) => v.defaultPayableAccountId).filter(Boolean))
    );
    const apControlAccounts = await db.select()
      .from(schema.accounts)
      .where(and(
        eq(schema.accounts.companyId, companyId),
        sql`(
          (account_code IN ('2010', '2110', '2000') AND lower(account_name) NOT LIKE '%vat%')
          OR account_type = 'PAYABLE'
          OR detail_type = 'ACCOUNTS_PAYABLE'
          OR (is_control_account = 1 AND account_type IN ('LIABILITY', 'PAYABLE') AND lower(account_name) LIKE '%payable%')
          OR lower(account_name) LIKE '%accounts payable%'
        )`
      ));

    const apAccountIds = Array.from(
      new Set([...apControlAccounts.map((a) => a.id), ...vendorApIds])
    );

    let totalGlApBalance = 0;
    if (apAccountIds.length > 0) {
      const journalLinesSum = await db.select({
        totalDebit: sql<number>`SUM(${schema.journalLines.debit})`,
        totalCredit: sql<number>`SUM(${schema.journalLines.credit})`
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .where(and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, 'POSTED'),
        sql`${schema.journalLines.accountId} IN (${sql.join(apAccountIds.map(id => sql`${id}`), sql`, `)})`
      ))
      .get();

      if (journalLinesSum) {
        totalGlApBalance = (journalLinesSum.totalCredit || 0) - (journalLinesSum.totalDebit || 0); // Credit - Debit for AP liability
      }
    }

    const reconciliationDifference = grandTotalSubsidiary - totalGlApBalance;

    res.json({
      asOfDate,
      aging: agingRows,
      totals: {
        current: agingRows.reduce((a, b) => a + b.current, 0),
        days1_30: agingRows.reduce((a, b) => a + b.days1_30, 0),
        days31_60: agingRows.reduce((a, b) => a + b.days31_60, 0),
        days61_90: agingRows.reduce((a, b) => a + b.days61_90, 0),
        days91_plus: agingRows.reduce((a, b) => a + b.days91_plus, 0),
        totalSubsidiaryLedger: grandTotalSubsidiary,
        glControlAccountBalance: totalGlApBalance,
        reconciliationDifference,
        isReconciled: reconciliationDifference === 0,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.get("/vendors/:vendorId/statement", requireAuth, requirePermission('purchases:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const vendorId = req.params.vendorId;
  const startDate = (req.query.startDate as string) || "1970-01-01";
  const endDate = (req.query.endDate as string) || new Date().toISOString().slice(0, 10);

  try {
    const vendor = await db.select().from(schema.vendors).where(and(eq(schema.vendors.id, vendorId), eq(schema.vendors.companyId, companyId))).get();
    if (!vendor) return res.status(404).json({ error: "NOT_FOUND", message: "Vendor not found" });

    const bills = await db.select()
      .from(schema.purchaseBills)
      .where(and(
        eq(schema.purchaseBills.companyId, companyId),
        eq(schema.purchaseBills.vendorId, vendorId),
        sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PAID')`
      ));

    const payments = await db.select()
      .from(schema.supplierPayments)
      .where(and(
        eq(schema.supplierPayments.companyId, companyId),
        eq(schema.supplierPayments.vendorId, vendorId),
        eq(schema.supplierPayments.status, 'POSTED')
      ));

    const memos = await db.select()
      .from(schema.debitMemos)
      .where(and(
        eq(schema.debitMemos.companyId, companyId),
        eq(schema.debitMemos.vendorId, vendorId),
        eq(schema.debitMemos.status, 'POSTED')
      ));

    const ledgerItems: any[] = [];

    bills.forEach(b => {
      ledgerItems.push({
        date: b.billDate,
        type: 'BILL',
        refNo: b.billNumber,
        description: `Purchase Bill #${b.billNumber}`,
        charge: b.totalAmount, // Increases AP liability
        credit: 0,
      });
    });

    payments.forEach(p => {
      ledgerItems.push({
        date: p.paymentDate,
        type: 'PAYMENT',
        refNo: p.paymentNumber,
        description: `Supplier Payment #${p.paymentNumber}`,
        charge: 0,
        credit: p.amount + (p.withholdingTaxAmount || 0), // Reduces AP liability
      });
    });

    memos.forEach(dm => {
      ledgerItems.push({
        date: dm.memoDate,
        type: 'DEBIT_MEMO',
        refNo: dm.debitMemoNumber,
        description: `Debit Memo #${dm.debitMemoNumber} - ${dm.reason || ''}`,
        charge: 0,
        credit: dm.totalAmount, // Reduces AP liability
      });
    });

    ledgerItems.sort((a, b) => a.date.localeCompare(b.date));

    let runningBalance = 0;
    const periodTransactions: any[] = [];

    ledgerItems.forEach(item => {
      const net = item.charge - item.credit;
      if (item.date < startDate) {
        runningBalance += net;
      } else if (item.date <= endDate) {
        runningBalance += net;
        periodTransactions.push({
          ...item,
          runningBalance
        });
      }
    });

    res.json({
      vendor,
      startDate,
      endDate,
      currentBalance: runningBalance,
      transactions: periodTransactions
    });
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

// Sales Invoices Workflow & Query Endpoints

// GET List Sales Invoices
router.get("/sales-invoices", requireAuth, requirePermission('sales:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const params = parsePaginationParams(req);

  try {
    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'sales');
    const filterConditions = [eq(schema.salesInvoices.companyId, companyId)];
    if (!scope.isCompanyWide && (scope.dataScope === 'OWN_RECORDS' || scope.dataScope === 'ASSIGNED_RECORDS')) {
      filterConditions.push(eq(schema.salesInvoices.createdBy, req.user!.id));
    }

    if (params.search) {
      const searchPattern = `%${params.search}%`;
      filterConditions.push(
        or(
          like(schema.salesInvoices.invoiceNumber, searchPattern),
          like(schema.salesInvoices.reference, searchPattern),
          like(schema.customers.legalName, searchPattern),
          like(schema.customers.code, searchPattern)
        )!
      );
    }

    const baseScopeConditions = [eq(schema.salesInvoices.companyId, companyId)];
    if (!scope.isCompanyWide && (scope.dataScope === 'OWN_RECORDS' || scope.dataScope === 'ASSIGNED_RECORDS')) {
      baseScopeConditions.push(eq(schema.salesInvoices.createdBy, req.user!.id));
    }

    const reqStatus = params.status ? params.status.toUpperCase().trim() : null;
    if (reqStatus && reqStatus !== 'ALL') {
      if (reqStatus === 'PARTIAL' || reqStatus === 'PARTIALLY_PAID') {
        filterConditions.push(sql`UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) IN ('PARTIAL', 'PARTIALLY_PAID')`);
      } else if (reqStatus === 'RETURNED') {
        filterConditions.push(sql`UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) IN ('RETURNED', 'REJECTED')`);
      } else {
        filterConditions.push(sql`UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) = ${reqStatus}`);
      }
    } else {
      filterConditions.push(sql`UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`);
    }

    const customerIdParam = req.query.customerId as string | undefined;
    if (customerIdParam) {
      filterConditions.push(eq(schema.salesInvoices.customerId, customerIdParam));
    }

    if (params.fromDate) {
      filterConditions.push(gte(schema.salesInvoices.invoiceDate, params.fromDate));
    }

    if (params.toDate) {
      filterConditions.push(lte(schema.salesInvoices.invoiceDate, params.toDate));
    }

    const isAsc = params.order === 'ASC';
    const cursorCond = buildCursorCondition(
      schema.salesInvoices.invoiceDate,
      schema.salesInvoices.id,
      params.decodedCursor,
      isAsc ? 'ASC' : 'DESC'
    );

    const queryConditions = [...filterConditions];
    if (cursorCond) {
      queryConditions.push(cursorCond);
    }

    const [countRes] = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.salesInvoices)
      .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
      .where(and(...filterConditions));
    const totalCount = Number(countRes?.total || 0);

    const invoices = await db.select({
      id: schema.salesInvoices.id,
      companyId: schema.salesInvoices.companyId,
      customerId: schema.salesInvoices.customerId,
      customerName: schema.customers.legalName,
      customerCode: schema.customers.code,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      invoiceType: schema.salesInvoices.invoiceType,
      invoiceDate: schema.salesInvoices.invoiceDate,
      dueDate: schema.salesInvoices.dueDate,
      reference: schema.salesInvoices.reference,
      totalAmount: schema.salesInvoices.totalAmount,
      balanceDue: schema.salesInvoices.balanceDue,
      status: schema.salesInvoices.status,
      journalEntryId: schema.salesInvoices.journalEntryId,
      createdAt: schema.salesInvoices.createdAt,
    })
    .from(schema.salesInvoices)
    .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
    .where(and(...queryConditions))
    .orderBy(
      isAsc ? asc(schema.salesInvoices.invoiceDate) : desc(schema.salesInvoices.invoiceDate),
      isAsc ? asc(schema.salesInvoices.id) : desc(schema.salesInvoices.id)
    )
    .limit(params.limit + 1);

    const normalizedInvoices = invoices.map((inv: any) => ({
      ...inv,
      status: String(inv.status || 'DRAFT').toUpperCase() === 'PARTIALLY_PAID' ? 'PARTIAL' : inv.status,
    }));

    const paginated = formatPaginatedResponse({
      items: normalizedInvoices,
      limit: params.limit,
      getSortValAndId: (inv: any) => ({ val: inv.invoiceDate, id: inv.id }),
      totalCount,
      raw: params.raw
    });

    if (params.raw) {
      return res.json(paginated);
    }

    // Authoritative database-level AR & status aggregates across ALL company-scoped records
    const todayIso = new Date().toISOString().slice(0, 10);
    const statusRows = await db
      .select({
        status: sql<string>`UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT'))`,
        cnt: sql<number>`count(*)`,
      })
      .from(schema.salesInvoices)
      .where(and(...baseScopeConditions))
      .groupBy(sql`UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT'))`);

    const statusCounts: Record<string, number> = {
      ALL: 0,
      DRAFT: 0,
      SUBMITTED: 0,
      RETURNED: 0,
      APPROVED: 0,
      POSTED: 0,
      PARTIAL: 0,
      PAID: 0,
      CANCELLED: 0,
      REVERSED: 0,
      ARCHIVED: 0,
      REMOVED: 0,
      SOFT_DELETED: 0,
      TOTAL_ARCHIVED_OR_REMOVED: 0,
    };

    for (const row of statusRows) {
      const st = String(row.status || 'DRAFT').toUpperCase();
      const cnt = Number(row.cnt || 0);
      if (['ARCHIVED', 'REMOVED', 'SOFT_DELETED'].includes(st)) {
        statusCounts[st] = (statusCounts[st] || 0) + cnt;
        statusCounts.TOTAL_ARCHIVED_OR_REMOVED += cnt;
      } else {
        statusCounts.ALL += cnt;
        if (st === 'PARTIALLY_PAID' || st === 'PARTIAL') {
          statusCounts.PARTIAL += cnt;
        } else if (st === 'RETURNED' || st === 'REJECTED') {
          statusCounts.RETURNED += cnt;
        } else {
          statusCounts[st] = (statusCounts[st] || 0) + cnt;
        }
      }
    }

    const [arAgg] = await db
      .select({
        totalArOutstanding: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.salesInvoices.balanceDue}, 0) > 0 THEN ${schema.salesInvoices.balanceDue} ELSE 0 END), 0)`,
        postedArBalance: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) = 'POSTED' AND COALESCE(${schema.salesInvoices.balanceDue}, 0) > 0 THEN ${schema.salesInvoices.balanceDue} ELSE 0 END), 0)`,
        partialArBalance: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) IN ('PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.salesInvoices.balanceDue}, 0) > 0 THEN ${schema.salesInvoices.balanceDue} ELSE 0 END), 0)`,
        totalGrossBilledOpenAr: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.salesInvoices.balanceDue}, 0) > 0 THEN ${schema.salesInvoices.totalAmount} ELSE 0 END), 0)`,
        overdueCollections: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.salesInvoices.balanceDue}, 0) > 0 AND ${schema.salesInvoices.dueDate} < ${todayIso} THEN ${schema.salesInvoices.balanceDue} ELSE 0 END), 0)`,
        overdueInvoicesCount: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.salesInvoices.balanceDue}, 0) > 0 AND ${schema.salesInvoices.dueDate} < ${todayIso} THEN 1 ELSE 0 END), 0)`,
        currentNotDueAr: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.salesInvoices.balanceDue}, 0) > 0 AND (${schema.salesInvoices.dueDate} >= ${todayIso} OR ${schema.salesInvoices.dueDate} IS NULL) THEN ${schema.salesInvoices.balanceDue} ELSE 0 END), 0)`,
        currentNotDueCount: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND COALESCE(${schema.salesInvoices.balanceDue}, 0) > 0 AND (${schema.salesInvoices.dueDate} >= ${todayIso} OR ${schema.salesInvoices.dueDate} IS NULL) THEN 1 ELSE 0 END), 0)`,
        activeInvoicesCount: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED', 'CANCELLED', 'REVERSED') THEN 1 ELSE 0 END), 0)`,
        draftUnpostedPotentialAr: sql<number>`COALESCE(SUM(CASE WHEN UPPER(COALESCE(${schema.salesInvoices.status}, 'DRAFT')) IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'REJECTED', 'APPROVED') THEN ${schema.salesInvoices.totalAmount} ELSE 0 END), 0)`,
      })
      .from(schema.salesInvoices)
      .where(and(...baseScopeConditions));

    // Reconcile against General Ledger Accounts Receivable Control Account (Code 1030 or AR subtype)
    const [glArRow] = await db
      .select({
        glArBalance: sql<number>`COALESCE(SUM(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`,
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(
        and(
          eq(schema.journalEntries.companyId, companyId),
          eq(schema.journalEntries.status, 'POSTED'),
          or(
            eq(schema.accounts.accountCode, '1030'),
            like(sql`LOWER(${schema.accounts.accountName})`, '%accounts receivable%')
          )!
        )
      );

    const totalArOutstanding = Number(arAgg?.totalArOutstanding || 0);
    const glArBalance = Number(glArRow?.glArBalance || 0);

    res.json({
      ...paginated,
      summary: {
        totalArOutstanding,
        postedArBalance: Number(arAgg?.postedArBalance || 0),
        partialArBalance: Number(arAgg?.partialArBalance || 0),
        totalGrossBilledOpenAr: Number(arAgg?.totalGrossBilledOpenAr || 0),
        settledOnOpenAr: Math.max(0, Number(arAgg?.totalGrossBilledOpenAr || 0) - totalArOutstanding),
        overdueCollections: Number(arAgg?.overdueCollections || 0),
        overdueInvoicesCount: Number(arAgg?.overdueInvoicesCount || 0),
        currentNotDueAr: Number(arAgg?.currentNotDueAr || 0),
        currentNotDueCount: Number(arAgg?.currentNotDueCount || 0),
        activeInvoicesCount: Number(arAgg?.activeInvoicesCount || 0),
        draftUnpostedPotentialAr: Number(arAgg?.draftUnpostedPotentialAr || 0),
        glArBalance,
        glSubledgerVariance: totalArOutstanding - glArBalance,
        isGlReconciled: Math.abs(totalArOutstanding - glArBalance) === 0,
        asOfDate: todayIso,
        statusCounts,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

// GET Single Sales Invoice Detail with Lines & Payments
router.get("/sales-invoices/:id", requireAuth, requirePermission('sales:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const invoice = await db.select({
      id: schema.salesInvoices.id,
      companyId: schema.salesInvoices.companyId,
      customerId: schema.salesInvoices.customerId,
      customerName: schema.customers.legalName,
      customerCode: schema.customers.code,
      customerTin: schema.customers.tin,
      customerAddress: schema.customers.address,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      invoiceType: schema.salesInvoices.invoiceType,
      invoiceDate: schema.salesInvoices.invoiceDate,
      dueDate: schema.salesInvoices.dueDate,
      reference: schema.salesInvoices.reference,
      totalAmount: schema.salesInvoices.totalAmount,
      balanceDue: schema.salesInvoices.balanceDue,
      status: schema.salesInvoices.status,
      journalEntryId: schema.salesInvoices.journalEntryId,
      createdBy: schema.salesInvoices.createdBy,
      createdAt: schema.salesInvoices.createdAt,
    })
    .from(schema.salesInvoices)
    .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
    .where(and(eq(schema.salesInvoices.id, id), eq(schema.salesInvoices.companyId, companyId)))
    .get();

    if (!invoice) return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found" });

    const scope = await RbacService.resolveModuleDataScope(req.activeCompany!.membershipId, req.user!.id, 'sales');
    if (!scope.isCompanyWide && (scope.dataScope === 'OWN_RECORDS' || scope.dataScope === 'ASSIGNED_RECORDS')) {
      scope.assertRecordAccess({ createdBy: invoice.createdBy }, "sales invoice");
    }

    const lines = await db.select().from(schema.salesInvoiceLines).where(eq(schema.salesInvoiceLines.invoiceId, id));
    const applications = await db.select({
      id: schema.customerPaymentApplications.id,
      paymentId: schema.customerPaymentApplications.paymentId,
      appliedAmount: schema.customerPaymentApplications.appliedAmount,
      withholdingAmount: schema.customerPaymentApplications.withholdingAmount,
      paymentNumber: schema.customerPayments.paymentNumber,
      officialReceiptNumber: schema.customerPayments.officialReceiptNumber,
      paymentDate: schema.customerPayments.paymentDate,
    })
    .from(schema.customerPaymentApplications)
    .innerJoin(schema.customerPayments, eq(schema.customerPaymentApplications.paymentId, schema.customerPayments.id))
    .where(eq(schema.customerPaymentApplications.invoiceId, id));

    res.json({ ...invoice, lines, applications });
  } catch (err: any) {
    if (err.statusCode === 403 || err.code === "DATA_SCOPE_VIOLATION") {
      res.status(403).json({ error: "PERMISSION_DENIED", code: "DATA_SCOPE_VIOLATION", message: err.message });
      return;
    }
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.post("/sales-invoices", requireAuth, requirePermission('sales:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { customerId, invoiceNumber, invoiceType, invoiceDate, dueDate, reference, totalAmount, lines } = req.body;

  if (!customerId || !invoiceNumber || !totalAmount) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Customer, invoice number, and total amount are required" });
    return;
  }

  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const id = await createSalesInvoice(companyId, {
      customerId,
      invoiceNumber,
      invoiceType: invoiceType || 'SALES',
      invoiceDate: invoiceDate ? invoiceDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      dueDate: dueDate ? dueDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      reference: reference || null,
      totalAmount: Number(totalAmount),
    }, req.user!.id, actorRole);

    // Save line items if provided
    if (lines && Array.isArray(lines) && lines.length > 0) {
      const revenueAccount = await resolveCompanyControlAccount(db, companyId, "REVENUE");
      const defaultRevenueAccountId = revenueAccount?.id;

      for (const line of lines) {
        const resolvedLineAcc =
          !line.accountId || line.accountId === "revenue-dummy"
            ? defaultRevenueAccountId
            : (await resolveCompanyControlAccount(db, companyId, "REVENUE", line.accountId))?.id || line.accountId;
        await db.insert(schema.salesInvoiceLines).values({
          id: crypto.randomUUID(),
          invoiceId: id,
          accountId: resolvedLineAcc,
          taxCodeId: line.taxCodeId || null,
          description: line.description || '',
          quantity: line.quantity || 1,
          unitPrice: line.unitPrice,
          amount: line.amount,
        });
      }
    }

    res.json({ message: "Sales invoice created successfully", id, invoiceNumber });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.put("/sales-invoices/:id", requireAuth, requirePermission('sales:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const existing = await db.select().from(schema.salesInvoices).where(and(eq(schema.salesInvoices.id, id), eq(schema.salesInvoices.companyId, companyId))).get();
    if (!existing) {
      res.status(404).json({ error: "NOT_FOUND", message: "Sales invoice not found" });
      return;
    }

    // BIR CAS Immutability: Posted/Submitted/Approved/Paid invoices cannot be altered directly via PUT
    const currentStatus = String(existing.status || '').toUpperCase();
    if (currentStatus !== 'DRAFT' && currentStatus !== 'RETURNED') {
      res.status(403).json({
        error: "IMMUTABLE_RECORD_ERROR",
        message: `Sales invoice ${existing.invoiceNumber} is '${currentStatus}' and locked under BIR CAS immutability. Direct modification is prohibited; issue a Credit Memo or Journal Reversal instead.`
      });
      return;
    }

    const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
    const curVer = existing.version ?? 1;
    if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== curVer) {
      res.status(409).json({
        error: "CONCURRENT_MODIFICATION_CONFLICT",
        message: `Sales invoice modified by another user (current: v${curVer}, expected: v${expectedVersion}).`
      });
      return;
    }

    const { reference, notes, dueDate, totalAmount } = req.body;
    const updateData: any = { version: curVer + 1, updatedAt: new Date() };
    if (reference !== undefined) updateData.reference = reference;
    if (notes !== undefined) updateData.notes = notes;
    if (dueDate !== undefined) updateData.dueDate = dueDate;
    if (totalAmount !== undefined) {
      const parsedTotal = Number(totalAmount);
      if (!Number.isInteger(parsedTotal) || parsedTotal <= 0) {
        res.status(400).json({ error: "VALIDATION_ERROR", message: "totalAmount must be a positive integer centavo value." });
        return;
      }
      updateData.totalAmount = parsedTotal;
      updateData.balanceDue = parsedTotal;
    }

    const updRes = await db.update(schema.salesInvoices)
      .set(updateData)
      .where(and(
        eq(schema.salesInvoices.id, id),
        eq(schema.salesInvoices.companyId, companyId),
        eq(schema.salesInvoices.version, curVer)
      ));

    if ((updRes as any)?.changes === 0) {
      res.status(409).json({ error: "CONCURRENT_MODIFICATION_CONFLICT", message: "Sales invoice was concurrently updated." });
      return;
    }

    await AuditService.log({
      req,
      companyId,
      action: "UPDATE_SALES_INVOICE",
      entityType: "SALES_INVOICE",
      entityId: id,
      module: "SALES",
      beforeData: { totalAmount: existing.totalAmount, dueDate: existing.dueDate, reference: existing.reference, version: curVer },
      afterData: updateData
    });
    res.json({ success: true, message: "Sales invoice updated successfully", id, version: curVer + 1 });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/sales-invoices/:id/submit", requireAuth, requirePermission('sales:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  try {
    await submitSalesInvoice(companyId, id, req.user!.id, expectedVersion ? Number(expectedVersion) : undefined);
    await AuditService.log({
      req,
      companyId,
      action: "SUBMIT_SALES_INVOICE",
      entityType: "SALES_INVOICE",
      entityId: id,
      module: "SALES",
      afterData: { status: "SUBMITTED", submittedBy: req.user!.id }
    });
    res.json({ message: "Sales invoice submitted successfully", id, status: "SUBMITTED" });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : (err.message.includes("not found") ? 404 : 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
  }
});

router.post("/sales-invoices/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const expectedVersion = req.body?.expectedVersion ?? req.body?.version ?? req.headers['x-expected-version'];
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await approveSalesInvoice(companyId, id, req.user!.id, expectedVersion ? Number(expectedVersion) : undefined, actorRole);
    await AuditService.log({
      req,
      companyId,
      action: "APPROVE_SALES_INVOICE",
      entityType: "SALES_INVOICE",
      entityId: id,
      module: "SALES",
      afterData: { status: "APPROVED", approvedBy: req.user!.id }
    });
    res.json({ message: "Sales invoice approved successfully", id, status: "APPROVED" });
  } catch (err: any) {
    const status = (err.code === 'CONCURRENT_MODIFICATION_CONFLICT' || err.statusCode === 409) ? 409 : (err.message.includes("not found") ? 404 : (err.message.includes("BRAC") || err.message.includes("Segregation") ? 403 : 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, details: err.details });
  }
});

router.post("/sales-invoices/:id/reject", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body || {};
  try {
    await rejectSalesInvoice(companyId, id, req.user!.id, reason);
    await AuditService.log({
      req,
      companyId,
      action: "REJECT_SALES_INVOICE",
      entityType: "SALES_INVOICE",
      entityId: id,
      module: "SALES",
      reason: reason || "Rejected by approver",
      afterData: { status: "DRAFT" }
    });
    res.json({ message: "Sales invoice rejected and returned to draft", id, status: "DRAFT" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/sales-invoices/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { periodId, lines } = req.body;
  try {
    const inv = await db.select().from(schema.salesInvoices).where(and(eq(schema.salesInvoices.id, id), eq(schema.salesInvoices.companyId, companyId))).get();
    const resolvedPeriodId = periodId || await resolveDefaultPeriodId(companyId, inv?.invoiceDate);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    // If lines not passed in body, fetch saved lines
    let invoiceLines = lines;
    if (!invoiceLines || invoiceLines.length === 0) {
      invoiceLines = await db.select().from(schema.salesInvoiceLines).where(eq(schema.salesInvoiceLines.invoiceId, id));
    }
    await postSalesInvoice(companyId, id, resolvedPeriodId, invoiceLines || [], req.user!.id, actorRole);
    await AuditService.log({
      req,
      companyId,
      action: "POST_SALES_INVOICE",
      entityType: "SALES_INVOICE",
      entityId: id,
      module: "SALES",
      afterData: { status: "POSTED" }
    });
    res.json({ message: "Sales invoice posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.message.includes("not found") ? 404 : (err.statusCode || 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// ---------------------------------------------------------
// CUSTOMER PAYMENTS (COLLECTIONS & OFFICIAL RECEIPTS) ENDPOINTS
// ---------------------------------------------------------

router.get("/customer-payments", requireAuth, requirePermission('sales:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const payments = await db.select({
      id: schema.customerPayments.id,
      paymentNumber: schema.customerPayments.paymentNumber,
      officialReceiptNumber: schema.customerPayments.officialReceiptNumber,
      paymentDate: schema.customerPayments.paymentDate,
      customerId: schema.customerPayments.customerId,
      customerName: schema.customers.legalName,
      customerCode: schema.customers.code,
      cashAccountId: schema.customerPayments.cashAccountId,
      cashAccountName: schema.accounts.accountName,
      amount: schema.customerPayments.amount,
      withholdingTaxAmount: schema.customerPayments.withholdingTaxAmount,
      overpaymentAmount: schema.customerPayments.overpaymentAmount,
      paymentMethod: schema.customerPayments.paymentMethod,
      reference: schema.customerPayments.reference,
      notes: schema.customerPayments.notes,
      status: schema.customerPayments.status,
      createdAt: schema.customerPayments.createdAt,
    })
    .from(schema.customerPayments)
    .innerJoin(schema.customers, eq(schema.customerPayments.customerId, schema.customers.id))
    .innerJoin(schema.accounts, eq(schema.customerPayments.cashAccountId, schema.accounts.id))
    .where(and(
      eq(schema.customerPayments.companyId, companyId),
      sql`UPPER(COALESCE(${schema.customerPayments.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
    ))
    .orderBy(desc(schema.customerPayments.paymentDate))
    .limit(Math.min(1000, Number(req.query.limit) || 200));

    res.json(payments);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.get("/customer-payments/:id", requireAuth, requirePermission('sales:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const payment = await db.select({
      id: schema.customerPayments.id,
      paymentNumber: schema.customerPayments.paymentNumber,
      officialReceiptNumber: schema.customerPayments.officialReceiptNumber,
      paymentDate: schema.customerPayments.paymentDate,
      customerId: schema.customerPayments.customerId,
      customerName: schema.customers.legalName,
      customerCode: schema.customers.code,
      customerTin: schema.customers.tin,
      customerAddress: schema.customers.address,
      cashAccountId: schema.customerPayments.cashAccountId,
      cashAccountName: schema.accounts.accountName,
      amount: schema.customerPayments.amount,
      withholdingTaxAmount: schema.customerPayments.withholdingTaxAmount,
      withholdingTaxAccountId: schema.customerPayments.withholdingTaxAccountId,
      overpaymentAmount: schema.customerPayments.overpaymentAmount,
      paymentMethod: schema.customerPayments.paymentMethod,
      reference: schema.customerPayments.reference,
      notes: schema.customerPayments.notes,
      status: schema.customerPayments.status,
      journalEntryId: schema.customerPayments.journalEntryId,
      createdAt: schema.customerPayments.createdAt,
    })
    .from(schema.customerPayments)
    .innerJoin(schema.customers, eq(schema.customerPayments.customerId, schema.customers.id))
    .innerJoin(schema.accounts, eq(schema.customerPayments.cashAccountId, schema.accounts.id))
    .where(and(eq(schema.customerPayments.id, id), eq(schema.customerPayments.companyId, companyId)))
    .get();

    if (!payment) return res.status(404).json({ error: "NOT_FOUND", message: "Payment not found" });

    const applications = await db.select({
      id: schema.customerPaymentApplications.id,
      invoiceId: schema.customerPaymentApplications.invoiceId,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      invoiceDate: schema.salesInvoices.invoiceDate,
      totalAmount: schema.salesInvoices.totalAmount,
      appliedAmount: schema.customerPaymentApplications.appliedAmount,
      withholdingAmount: schema.customerPaymentApplications.withholdingAmount,
    })
    .from(schema.customerPaymentApplications)
    .innerJoin(schema.salesInvoices, eq(schema.customerPaymentApplications.invoiceId, schema.salesInvoices.id))
    .where(eq(schema.customerPaymentApplications.paymentId, id));

    res.json({ ...payment, applications });
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.post("/customer-payments", requireAuth, requirePermission('sales:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const id = await createCustomerPayment(companyId, req.body, req.user!.id, actorRole);
    res.json({ message: "Customer payment created successfully", id });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/customer-payments/:id/submit", requireAuth, requirePermission('sales:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await submitCustomerPayment(companyId, id, req.user!.id);
    res.json({ message: "Customer payment submitted successfully", id, status: "SUBMITTED" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/customer-payments/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await approveCustomerPayment(companyId, id, req.user!.id, actorRole);
    res.json({ message: "Customer payment approved successfully", id, status: "APPROVED" });
  } catch (err: any) {
    const status = err.message.includes("BRAC") || err.message.includes("Segregation") ? 403 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/customer-payments/:id/reject", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body || {};
  try {
    await rejectCustomerPayment(companyId, id, req.user!.id, reason);
    res.json({ message: "Customer payment rejected and returned to draft", id, status: "DRAFT" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/customer-payments/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { periodId } = req.body || {};
  try {
    const payment = await db.select().from(schema.customerPayments).where(and(eq(schema.customerPayments.id, id), eq(schema.customerPayments.companyId, companyId))).get();
    const resolvedPeriodId = periodId || await resolveDefaultPeriodId(companyId, payment?.paymentDate);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await postCustomerPayment(companyId, id, resolvedPeriodId, req.user!.id, undefined, actorRole);
    res.json({ message: "Customer payment posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// ---------------------------------------------------------
// CREDIT MEMOS ENDPOINTS
// ---------------------------------------------------------

router.get("/credit-memos", requireAuth, requirePermission('sales:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const memos = await db.select({
      id: schema.creditMemos.id,
      creditMemoNumber: schema.creditMemos.creditMemoNumber,
      memoDate: schema.creditMemos.memoDate,
      customerId: schema.creditMemos.customerId,
      customerName: schema.customers.legalName,
      customerCode: schema.customers.code,
      reason: schema.creditMemos.reason,
      totalAmount: schema.creditMemos.totalAmount,
      balanceRemaining: schema.creditMemos.balanceRemaining,
      status: schema.creditMemos.status,
      createdAt: schema.creditMemos.createdAt,
    })
    .from(schema.creditMemos)
    .innerJoin(schema.customers, eq(schema.creditMemos.customerId, schema.customers.id))
    .where(and(
      eq(schema.creditMemos.companyId, companyId),
      sql`UPPER(COALESCE(${schema.creditMemos.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
    ))
    .orderBy(desc(schema.creditMemos.memoDate));

    res.json(memos);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.post("/credit-memos", requireAuth, requirePermission('sales:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const id = await createCreditMemo(companyId, req.body, req.user!.id, actorRole);
    res.json({ message: "Credit memo created successfully", id });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/credit-memos/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { periodId } = req.body || {};
  try {
    const memo = await db.select().from(schema.creditMemos).where(and(eq(schema.creditMemos.id, id), eq(schema.creditMemos.companyId, companyId))).get();
    const resolvedPeriodId = periodId || await resolveDefaultPeriodId(companyId, memo?.memoDate);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await postCreditMemo(companyId, id, resolvedPeriodId, req.user!.id, undefined, actorRole);
    res.json({ message: "Credit memo posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// ---------------------------------------------------------
// CUSTOMER STATEMENT OF ACCOUNT (SOA)
// ---------------------------------------------------------

router.get("/customers/:customerId/statement", requireAuth, requirePermission('sales:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const customerId = req.params.customerId;
  const startDate = (req.query.startDate as string) || "1970-01-01";
  const endDate = (req.query.endDate as string) || new Date().toISOString().slice(0, 10);

  try {
    const customer = await db.select().from(schema.customers).where(and(eq(schema.customers.id, customerId), eq(schema.customers.companyId, companyId))).get();
    if (!customer) return res.status(404).json({ error: "NOT_FOUND", message: "Customer not found" });

    // Fetch invoices
    const invoices = await db.select()
      .from(schema.salesInvoices)
      .where(and(
        eq(schema.salesInvoices.companyId, companyId),
        eq(schema.salesInvoices.customerId, customerId),
        sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PAID')`
      ));

    // Fetch payments
    const payments = await db.select()
      .from(schema.customerPayments)
      .where(and(
        eq(schema.customerPayments.companyId, companyId),
        eq(schema.customerPayments.customerId, customerId),
        eq(schema.customerPayments.status, 'POSTED')
      ));

    // Fetch credit memos
    const memos = await db.select()
      .from(schema.creditMemos)
      .where(and(
        eq(schema.creditMemos.companyId, companyId),
        eq(schema.creditMemos.customerId, customerId),
        eq(schema.creditMemos.status, 'POSTED')
      ));

    // Assemble unified transaction ledger
    const ledgerItems: any[] = [];

    invoices.forEach(inv => {
      ledgerItems.push({
        date: inv.invoiceDate,
        type: 'INVOICE',
        refNo: inv.invoiceNumber,
        description: `Sales Invoice #${inv.invoiceNumber}`,
        charge: inv.totalAmount, // Debit (Charge)
        credit: 0,
      });
    });

    payments.forEach(pmt => {
      ledgerItems.push({
        date: pmt.paymentDate,
        type: 'PAYMENT',
        refNo: pmt.officialReceiptNumber ? `OR#${pmt.officialReceiptNumber}` : pmt.paymentNumber,
        description: `Customer Collection ${pmt.officialReceiptNumber ? '(OR#' + pmt.officialReceiptNumber + ')' : ''}`,
        charge: 0,
        credit: pmt.amount + (pmt.withholdingTaxAmount || 0), // Credit (Payment + CWT)
      });
    });

    memos.forEach(cm => {
      ledgerItems.push({
        date: cm.memoDate,
        type: 'CREDIT_MEMO',
        refNo: cm.creditMemoNumber,
        description: `Credit Memo #${cm.creditMemoNumber} - ${cm.reason || ''}`,
        charge: 0,
        credit: cm.totalAmount, // Credit
      });
    });

    // Sort by date
    ledgerItems.sort((a, b) => a.date.localeCompare(b.date));

    // Calculate opening balance, period items, and running balance
    let runningBalance = 0;
    const periodTransactions: any[] = [];

    ledgerItems.forEach(item => {
      const net = item.charge - item.credit;
      if (item.date < startDate) {
        runningBalance += net;
      } else if (item.date <= endDate) {
        runningBalance += net;
        periodTransactions.push({
          ...item,
          runningBalance
        });
      }
    });

    res.json({
      customer,
      startDate,
      endDate,
      currentBalance: runningBalance,
      transactions: periodTransactions
    });
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

// ---------------------------------------------------------
// ACCOUNTS RECEIVABLE (AR) AGING & CONTROL RECONCILIATION
// ---------------------------------------------------------

router.get("/ar-aging", requireAuth, requirePermission('reports:view', 'sales:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const asOfDate = (req.query.asOfDate as string) || new Date().toISOString().slice(0, 10);

  try {
    // 1. Fetch active customers
    const customerList = await db.select().from(schema.customers).where(eq(schema.customers.companyId, companyId));

    // 2. Fetch posted invoices with remaining balance
    const openInvoices = await db.select({
      id: schema.salesInvoices.id,
      customerId: schema.salesInvoices.customerId,
      invoiceNumber: schema.salesInvoices.invoiceNumber,
      invoiceDate: schema.salesInvoices.invoiceDate,
      dueDate: schema.salesInvoices.dueDate,
      totalAmount: schema.salesInvoices.totalAmount,
      balanceDue: schema.salesInvoices.balanceDue,
    })
    .from(schema.salesInvoices)
    .where(and(
      eq(schema.salesInvoices.companyId, companyId),
      sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID')`,
      sql`${schema.salesInvoices.balanceDue} > 0`
    ));

    const asOfTime = new Date(asOfDate).getTime();

    // 3. Build aging per customer
    const agingByCustomer: Record<string, any> = {};
    let grandTotalSubsidiary = 0;

    customerList.forEach(c => {
      agingByCustomer[c.id] = {
        customerId: c.id,
        customerCode: c.code,
        customerName: c.legalName,
        current: 0,
        days1_30: 0,
        days31_60: 0,
        days61_90: 0,
        days91_plus: 0,
        totalBalance: 0,
      };
    });

    openInvoices.forEach(inv => {
      if (!agingByCustomer[inv.customerId]) return;
      const dueDate = inv.dueDate ? new Date(inv.dueDate).getTime() : new Date(inv.invoiceDate).getTime();
      const diffDays = Math.floor((asOfTime - dueDate) / (1000 * 60 * 60 * 24));

      const bal = inv.balanceDue;
      grandTotalSubsidiary += bal;
      agingByCustomer[inv.customerId].totalBalance += bal;

      if (diffDays <= 0) {
        agingByCustomer[inv.customerId].current += bal;
      } else if (diffDays <= 30) {
        agingByCustomer[inv.customerId].days1_30 += bal;
      } else if (diffDays <= 60) {
        agingByCustomer[inv.customerId].days31_60 += bal;
      } else if (diffDays <= 90) {
        agingByCustomer[inv.customerId].days61_90 += bal;
      } else {
        agingByCustomer[inv.customerId].days91_plus += bal;
      }
    });

    const agingRows = Object.values(agingByCustomer).filter(c => c.totalBalance !== 0);

    // 4. Fetch GL AR Control Account Balance (supports 1030, 1110, 1120, 1200, RECEIVABLE control accounts, and customer-mapped AR accounts)
    const customerArIds = Array.from(
      new Set(customerList.map((c: any) => c.defaultReceivableAccountId).filter(Boolean))
    );
    const arControlAccounts = await db.select()
      .from(schema.accounts)
      .where(and(
        eq(schema.accounts.companyId, companyId),
        sql`(
          account_code IN ('1030', '1110', '1120', '1200')
          OR account_type = 'RECEIVABLE'
          OR detail_type = 'ACCOUNTS_RECEIVABLE'
          OR (is_control_account = 1 AND account_type IN ('ASSET', 'RECEIVABLE') AND lower(account_name) LIKE '%receivable%')
          OR lower(account_name) LIKE '%accounts receivable%'
        )`
      ));

    const arAccountIds = Array.from(
      new Set([...arControlAccounts.map((a) => a.id), ...customerArIds])
    );

    let totalGlArBalance = 0;
    if (arAccountIds.length > 0) {
      const journalLinesSum = await db.select({
        totalDebit: sql<number>`SUM(${schema.journalLines.debit})`,
        totalCredit: sql<number>`SUM(${schema.journalLines.credit})`
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .where(and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, 'POSTED'),
        sql`${schema.journalLines.accountId} IN (${sql.join(arAccountIds.map(id => sql`${id}`), sql`, `)})`
      ))
      .get();

      if (journalLinesSum) {
        totalGlArBalance = (journalLinesSum.totalDebit || 0) - (journalLinesSum.totalCredit || 0);
      }
    }

    const reconciliationDifference = grandTotalSubsidiary - totalGlArBalance;

    res.json({
      asOfDate,
      aging: agingRows,
      totals: {
        current: agingRows.reduce((a, b) => a + b.current, 0),
        days1_30: agingRows.reduce((a, b) => a + b.days1_30, 0),
        days31_60: agingRows.reduce((a, b) => a + b.days31_60, 0),
        days61_90: agingRows.reduce((a, b) => a + b.days61_90, 0),
        days91_plus: agingRows.reduce((a, b) => a + b.days91_plus, 0),
        totalSubsidiaryLedger: grandTotalSubsidiary,
        glControlAccountBalance: totalGlArBalance,
        reconciliationDifference,
        isReconciled: reconciliationDifference === 0,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

// Get Cash Transactions (Viewer, Editor, Admin)
router.get("/cash-transactions", requireAuth, requirePermission('cash:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const params = parsePaginationParams(req);

  const filterConditions = [eq(schema.cashTransactions.companyId, companyId)];

  if (params.search) {
    const searchPattern = `%${params.search}%`;
    filterConditions.push(
      or(
        like(schema.cashTransactions.transactionNumber, searchPattern),
        like(schema.cashTransactions.reference, searchPattern),
        like(schema.cashTransactions.description, searchPattern)
      )!
    );
  }

  if (params.status) {
    filterConditions.push(eq(schema.cashTransactions.status, params.status));
  } else {
    filterConditions.push(sql`UPPER(COALESCE(${schema.cashTransactions.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`);
  }

  if (params.fromDate) {
    filterConditions.push(gte(schema.cashTransactions.transactionDate, params.fromDate));
  }

  if (params.toDate) {
    filterConditions.push(lte(schema.cashTransactions.transactionDate, params.toDate));
  }

  const isAsc = params.order === 'ASC';
  const cursorCond = buildCursorCondition(
    schema.cashTransactions.transactionDate,
    schema.cashTransactions.id,
    params.decodedCursor,
    isAsc ? 'ASC' : 'DESC'
  );

  const queryConditions = [...filterConditions];
  if (cursorCond) {
    queryConditions.push(cursorCond);
  }

  const [countRes] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.cashTransactions)
    .where(and(...filterConditions));
  const totalCount = Number(countRes?.total || 0);

  const txns = await db
    .select()
    .from(schema.cashTransactions)
    .where(and(...queryConditions))
    .orderBy(
      isAsc ? asc(schema.cashTransactions.transactionDate) : desc(schema.cashTransactions.transactionDate),
      isAsc ? asc(schema.cashTransactions.id) : desc(schema.cashTransactions.id)
    )
    .limit(params.limit + 1);

  const coaRows = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
  const accMap = new Map<string, any>(coaRows.map((a: any) => [a.id, a]));
  const enrichedTxns = txns.map((t: any) => {
    const acc = accMap.get(t.cashAccountId);
    return {
      ...t,
      accountCode: acc?.accountCode || null,
      accountName: acc?.accountName || null,
      currency: acc?.currency || 'PHP',
    };
  });

  res.json(formatPaginatedResponse({
    items: enrichedTxns,
    limit: params.limit,
    getSortValAndId: (t: any) => ({ val: t.transactionDate, id: t.id }),
    totalCount,
    raw: params.raw
  }));
});

// Cash Transactions Workflow Endpoints

router.post("/cash-transactions", requireAuth, requirePermission('cash:manage', 'cash:create', 'cash:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { accountId, type, amount, transactionDate, reference, description, lines, offsetAccountId } = req.body;

  if (!accountId || !type || !amount) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Account, type, and amount are required" });
    return;
  }

  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const resolvedLines = Array.isArray(lines) && lines.length > 0
      ? lines
      : offsetAccountId
      ? [{ accountId: offsetAccountId, amount: Number(amount), description: description || `Cash ${type}` }]
      : undefined;
    const id = await createCashTransaction(companyId, {
      accountId,
      type,
      amount: Number(amount),
      transactionDate: transactionDate ? transactionDate.split('T')[0] : new Date().toISOString().split('T')[0],
      reference,
      description,
      lines: resolvedLines
    }, req.user!.id, actorRole);

    res.json({ message: "Cash transaction created successfully", id });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/cash-transactions/:id/submit", requireAuth, requirePermission('cash:manage', 'cash:create', 'cash:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await submitCashTransaction(companyId, id, req.user!.id);
    await AuditService.log({
      req,
      companyId,
      action: "SUBMIT_CASH_TRANSACTION",
      entityType: "CASH_TRANSACTION",
      entityId: id,
      module: "CASH",
      afterData: { status: "SUBMITTED", submittedBy: req.user!.id }
    });
    res.json({ message: "Cash transaction submitted successfully", id, status: "SUBMITTED" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/cash-transactions/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await approveCashTransaction(companyId, id, req.user!.id, actorRole);
    await AuditService.log({
      req,
      companyId,
      action: "APPROVE_CASH_TRANSACTION",
      entityType: "CASH_TRANSACTION",
      entityId: id,
      module: "CASH",
      afterData: { status: "APPROVED", approvedBy: req.user!.id }
    });
    res.json({ message: "Cash transaction approved successfully", id, status: "APPROVED" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : (err.message.includes("BRAC") || err.message.includes("Segregation") ? 403 : 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/cash-transactions/:id/reject", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body || {};
  try {
    await rejectCashTransaction(companyId, id, req.user!.id, reason);
    await AuditService.log({
      req,
      companyId,
      action: "REJECT_CASH_TRANSACTION",
      entityType: "CASH_TRANSACTION",
      entityId: id,
      module: "CASH",
      reason: reason || "Rejected by approver",
      afterData: { status: "DRAFT" }
    });
    res.json({ message: "Cash transaction rejected and returned to draft", id, status: "DRAFT" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/cash-transactions/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { periodId, lines, extraData } = req.body || {};
  try {
    const txn = await db.select().from(schema.cashTransactions).where(and(eq(schema.cashTransactions.id, id), eq(schema.cashTransactions.companyId, companyId))).get();
    const resolvedPeriodId = periodId || await resolveDefaultPeriodId(companyId, txn?.transactionDate);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await postCashTransaction(companyId, id, resolvedPeriodId, lines || [], req.user!.id, extraData, actorRole);
    await AuditService.log({
      req,
      companyId,
      action: "POST_CASH_TRANSACTION",
      entityType: "CASH_TRANSACTION",
      entityId: id,
      module: "CASH",
      afterData: { status: "POSTED", periodId: resolvedPeriodId }
    });
    res.json({ message: "Cash transaction posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.message.includes("not found") ? 404 : (err.statusCode || 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// Liquidate Cash Advance
router.post("/cash-advances/:id/liquidate", requireAuth, requirePermission('cash:manage', 'cash:create', 'cash:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const advanceId = req.params.id;
  const { periodId, expenses, returnedAmount, returnCashAccountId, liquidationDate } = req.body;

  if (!periodId || !expenses || !Array.isArray(expenses)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Period ID and expenses list are required" });
    return;
  }

  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await liquidateCashAdvance(companyId, advanceId, periodId, {
      expenses,
      returnedAmount: Number(returnedAmount || 0),
      returnCashAccountId,
      liquidationDate: liquidationDate || new Date().toISOString().split('T')[0]
    }, req.user!.id, actorRole);

    await AuditService.log({
      req,
      companyId,
      action: "LIQUIDATE_CASH_ADVANCE",
      entityType: "CASH_ADVANCE",
      entityId: advanceId,
      module: "CASH",
      afterData: { status: "LIQUIDATED" }
    });

    res.json({ message: "Cash advance liquidated successfully", id: advanceId, status: "LIQUIDATED" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.message.includes("not found") ? 404 : (err.statusCode || 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// List Cash Advances
router.get("/cash-advances", requireAuth, requirePermission('cash:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const advances = await db.select().from(schema.cashAdvances).where(eq(schema.cashAdvances.companyId, companyId))
      
      .orderBy(desc(schema.cashAdvances.createdAt));
    res.json(advances);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

// CHECKS ROUTES
router.get("/checks", requireAuth, requirePermission('cash:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    await ensureReconciledBankSeedData(companyId);
    const list = await db.select().from(schema.checks).where(and(
      eq(schema.checks.companyId, companyId),
      sql`UPPER(COALESCE(${schema.checks.status}, 'ISSUED')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
    ))
      .orderBy(desc(schema.checks.checkDate));
    const coaRows = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
    const accMap = new Map<string, any>(coaRows.map((a: any) => [a.id, a]));
    const enriched = list.map((chk: any) => {
      const acc = accMap.get(chk.cashAccountId);
      return {
        ...chk,
        accountCode: acc?.accountCode || null,
        accountName: acc?.accountName || null,
      };
    });
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.post("/checks", requireAuth, requirePermission('cash:manage', 'cash:create', 'cash:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { checkNumber, checkDate, payeeName, cashAccountId, amount, voucherNumber, notes, attachmentUrl } = req.body;

  if (!checkNumber || !payeeName || !cashAccountId || !amount) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Check number, payee, cash account, and amount are required" });
    return;
  }

  try {
    const id = await issueCheck(companyId, {
      checkNumber,
      checkDate: checkDate || new Date().toISOString().split('T')[0],
      payeeName,
      cashAccountId,
      amount: Number(amount),
      voucherNumber,
      notes,
      attachmentUrl
    }, req.user!.id);

    res.json({ message: "Check issued successfully", id, status: "ISSUED" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/checks/:id/clear", requireAuth, requirePermission('cash:manage', 'cash:create', 'cash:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { clearedDate } = req.body || {};

  try {
    await clearCheck(companyId, id, clearedDate, req.user!.id);
    res.json({ message: "Check marked as cleared", id, status: "CLEARED" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/checks/:id/cancel", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason, periodId } = req.body || {};

  if (!reason) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Cancellation reason is required" });
    return;
  }

  try {
    const chk = await db.select().from(schema.checks).where(and(eq(schema.checks.id, id), eq(schema.checks.companyId, companyId))).get();
    const resolvedPeriodId = periodId || await resolveDefaultPeriodId(companyId, chk?.checkDate);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await cancelCheck(companyId, id, reason, resolvedPeriodId, req.user!.id, actorRole);
    res.json({ message: "Check cancelled successfully", id, status: "CANCELLED" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.message.includes("not found") ? 404 : (err.statusCode || 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/checks/:id/bounce", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason, periodId } = req.body || {};

  if (!reason) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Bounce/NSF reason is required" });
    return;
  }

  try {
    const chk = await db.select().from(schema.checks).where(and(eq(schema.checks.id, id), eq(schema.checks.companyId, companyId))).get();
    const resolvedPeriodId = periodId || await resolveDefaultPeriodId(companyId, chk?.checkDate);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const result = await bounceCheck(companyId, id, reason, resolvedPeriodId, req.user!.id, actorRole);
    res.json({ message: "Check marked as BOUNCED", id, status: "BOUNCED", reversalEntryId: result.reversalEntryId });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.message.includes("not found") ? 404 : (err.statusCode || 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// BANK DEPOSITS ROUTES
router.get("/bank-deposits", requireAuth, requirePermission('cash:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    await ensureReconciledBankSeedData(companyId);
    const deposits = await db.select().from(schema.bankDeposits).where(and(
      eq(schema.bankDeposits.companyId, companyId),
      sql`UPPER(COALESCE(${schema.bankDeposits.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
    ))
      .orderBy(desc(schema.bankDeposits.depositDate));
    const coaRows = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
    const accMap = new Map<string, any>(coaRows.map((a: any) => [a.id, a]));
    const enriched = deposits.map((dep: any) => {
      const toAcc = accMap.get(dep.toBankAccountId);
      const fromAcc = accMap.get(dep.fromCashAccountId);
      return {
        ...dep,
        toBankAccountCode: toAcc?.accountCode || null,
        toBankAccountName: toAcc?.accountName || null,
        fromCashAccountCode: fromAcc?.accountCode || null,
        fromCashAccountName: fromAcc?.accountName || null,
      };
    });
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.post("/bank-deposits", requireAuth, requirePermission('cash:manage', 'cash:create', 'cash:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { depositNumber, depositDate, toBankAccountId, fromCashAccountId, totalAmount, reference, notes, attachmentUrl } = req.body;

  if (!toBankAccountId || !fromCashAccountId || !totalAmount) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Bank account, source cash account, and total amount are required" });
    return;
  }

  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const id = await createBankDeposit(companyId, {
      depositNumber: depositNumber || `DEP-${Date.now().toString().slice(-6)}`,
      depositDate: depositDate || new Date().toISOString().split('T')[0],
      toBankAccountId,
      fromCashAccountId,
      totalAmount: Number(totalAmount),
      reference,
      notes,
      attachmentUrl
    }, req.user!.id, actorRole);

    res.json({ message: "Bank deposit created successfully", id, status: "DRAFT" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/bank-deposits/:id/submit", requireAuth, requirePermission('cash:manage', 'cash:create', 'cash:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await submitBankDeposit(companyId, id, req.user!.id);
    res.json({ message: "Bank deposit submitted successfully", id, status: "SUBMITTED" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/bank-deposits/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await approveBankDeposit(companyId, id, req.user!.id, actorRole);
    res.json({ message: "Bank deposit approved successfully", id, status: "APPROVED" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : (err.message.includes("BRAC") ? 403 : 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/bank-deposits/:id/reject", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body || {};
  try {
    await rejectBankDeposit(companyId, id, req.user!.id, reason);
    res.json({ message: "Bank deposit rejected", id, status: "DRAFT" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/bank-deposits/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { periodId } = req.body || {};

  try {
    const dep = await db.select().from(schema.bankDeposits).where(and(eq(schema.bankDeposits.id, id), eq(schema.bankDeposits.companyId, companyId))).get();
    const resolvedPeriodId = periodId || await resolveDefaultPeriodId(companyId, dep?.depositDate);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await postBankDeposit(companyId, id, resolvedPeriodId, req.user!.id, actorRole);
    res.json({ message: "Bank deposit posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.message.includes("not found") ? 404 : (err.statusCode || 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// CASH COUNTS ROUTES
router.get("/cash-counts", requireAuth, requirePermission('cash:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const counts = await db.select().from(schema.cashCounts).where(and(
      eq(schema.cashCounts.companyId, companyId),
      sql`UPPER(COALESCE(${schema.cashCounts.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
    ))
      
      .orderBy(desc(schema.cashCounts.countDate));
    res.json(counts);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.post("/cash-counts", requireAuth, requirePermission('cash:manage', 'cash:create', 'cash:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { countNumber, countDate, cashAccountId, custodianName, bookBalance, countedBalance, varianceAccountId, notes, attachmentUrl, denominations } = req.body;

  if (!cashAccountId || !custodianName) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Cash account and custodian name are required" });
    return;
  }

  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    const id = await createCashCount(companyId, {
      countNumber: countNumber || `CNT-${Date.now().toString().slice(-6)}`,
      countDate: countDate || new Date().toISOString().split('T')[0],
      cashAccountId,
      custodianName,
      bookBalance: Number(bookBalance || 0),
      countedBalance: countedBalance != null ? Number(countedBalance) : undefined,
      varianceAccountId,
      notes,
      attachmentUrl,
      denominations
    }, req.user!.id, actorRole);

    res.json({ message: "Cash count created successfully", id, status: "DRAFT" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.statusCode || 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/cash-counts/:id/submit", requireAuth, requirePermission('cash:manage', 'cash:create', 'cash:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await submitCashCount(companyId, id, req.user!.id);
    res.json({ message: "Cash count submitted successfully", id, status: "SUBMITTED" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/cash-counts/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await approveCashCount(companyId, id, req.user!.id, actorRole);
    res.json({ message: "Cash count approved successfully", id, status: "APPROVED" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : (err.message.includes("BRAC") ? 403 : 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/cash-counts/:id/reject", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body || {};
  try {
    await rejectCashCount(companyId, id, req.user!.id, reason);
    res.json({ message: "Cash count rejected", id, status: "DRAFT" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/cash-counts/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { periodId } = req.body || {};

  try {
    const cnt = await db.select().from(schema.cashCounts).where(and(eq(schema.cashCounts.id, id), eq(schema.cashCounts.companyId, companyId))).get();
    const resolvedPeriodId = periodId || await resolveDefaultPeriodId(companyId, cnt?.countDate);
    const actorRole = req.activeCompany?.roleCode || req.activeCompany?.roleName || req.activeCompany?.role;
    await postCashCount(companyId, id, resolvedPeriodId, req.user!.id, actorRole);
    res.json({ message: "Cash count posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = err instanceof DomainError ? (err.statusCode || 400) : (err.message.includes("not found") ? 404 : (err.statusCode || 400));
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// CASHBOOK REPORT
router.get("/cashbook", requireAuth, requirePermission('cash:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { cashAccountId, startDate, endDate } = req.query as any;

  if (!cashAccountId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "cashAccountId query parameter is required" });
    return;
  }

  try {
    const result = await getCashbook(
      companyId,
      cashAccountId,
      startDate || "1970-01-01",
      endDate || new Date().toISOString().split('T')[0]
    );
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: "QUERY_ERROR", message: err.message });
  }
});




router.get("/integrity-check", requireAuth, requirePermission('audit:integrity:scan', 'audit:integrity:view', 'audit:view'), async (req, res) => {
  try {
    const denied = ((req as any).deniedPermissions || []) as string[];
    if (denied.some(d => d.toLowerCase() === 'audit:integrity:scan' || d.toLowerCase() === 'audit:view')) {
      res.status(403).json({ error: "PERMISSION_DENIED", message: "Access explicitly denied by RBAC override for audit:integrity:scan" });
      return;
    }
    const companyId = req.activeCompany!.id;
    const { LedgerIntegrityService } = await import("../services/ledgerIntegrityService");
    const report = await LedgerIntegrityService.runIntegrityScan(companyId, {
      userId: req.user?.id,
      userName: req.user?.displayName || req.user?.email || "Auditor",
      userRole: req.activeCompany?.roleName || req.activeCompany?.role || "Company Owner",
      req
    });
    return res.json(report);
  } catch (error: any) {
    console.error("Error in integrity check:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: error?.message || "Failed to run integrity check" });
  }
});

// ============================================================================
// PHASE 11: BANK RECONCILIATION ROUTES (Duplicates above removed cleanly)
// ============================================================================

router.post("/bank-reconciliations", requireAuth, requirePermission('bank_rec:manage', 'bank_rec:create', 'bank_rec:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { bankAccountId, statementDate, statementEndingBalance, notes, attachmentUrl } = req.body;
  if (!bankAccountId || !statementDate || statementEndingBalance === undefined) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "bankAccountId, statementDate, and statementEndingBalance are required" });
    return;
  }
  try {
    const id = await createBankReconciliation(companyId, {
      bankAccountId,
      statementDate,
      statementEndingBalance: Number(statementEndingBalance),
      notes,
      attachmentUrl
    }, req.user!.id);
    res.status(200).json({ id, message: "Bank reconciliation session created successfully" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.get("/bank-reconciliations", requireAuth, requirePermission('bank_rec:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    await ensureReconciledBankSeedData(companyId);
    const initialRecons = await db
      .select()
      .from(schema.bankReconciliations)
      .where(and(
        eq(schema.bankReconciliations.companyId, companyId),
        sql`UPPER(COALESCE(${schema.bankReconciliations.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
      ))
      .orderBy(desc(schema.bankReconciliations.statementDate));

    for (const r of initialRecons) {
      if (!['APPROVED', 'COMPLETED'].includes(String(r.status || 'DRAFT').toUpperCase())) {
        await recalculateBankReconciliationMetrics(companyId, r.id);
      }
    }

    const recons = await db
      .select()
      .from(schema.bankReconciliations)
      .where(and(
        eq(schema.bankReconciliations.companyId, companyId),
        sql`UPPER(COALESCE(${schema.bankReconciliations.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
      ))
      .orderBy(desc(schema.bankReconciliations.statementDate));

    const coaRows = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
    const accMap = new Map<string, any>(coaRows.map((a: any) => [a.id, a]));

    const allLines = await db
      .select()
      .from(schema.bankStatementLines)
      .where(eq(schema.bankStatementLines.companyId, companyId));

    const lineStats = new Map<string, { total: number; matched: number; unmatched: number; excluded: number }>();
    for (const l of allLines) {
      const cur = lineStats.get(l.bankReconciliationId) || { total: 0, matched: 0, unmatched: 0, excluded: 0 };
      cur.total += 1;
      if (l.matchedStatus === 'MATCHED') cur.matched += 1;
      else if (l.matchedStatus === 'EXCLUDED') cur.excluded += 1;
      else cur.unmatched += 1;
      lineStats.set(l.bankReconciliationId, cur);
    }

    const enriched = recons.map((r: any) => {
      const acc = accMap.get(r.bankAccountId);
      const stats = lineStats.get(r.id) || { total: 0, matched: 0, unmatched: 0, excluded: 0 };
      return {
        ...r,
        accountCode: acc?.accountCode || null,
        accountName: acc?.accountName || null,
        currency: acc?.currency || 'PHP',
        totalLinesCount: stats.total,
        matchedLinesCount: stats.matched,
        unmatchedLinesCount: stats.unmatched,
        excludedLinesCount: stats.excluded,
      };
    });

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

router.get("/bank-reconciliations/:id", requireAuth, requirePermission('bank_rec:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    const summary = await getBankReconciliationSummary(companyId, id);
    res.json(summary);
  } catch (err: any) {
    res.status(404).json({ error: "NOT_FOUND", message: err.message });
  }
});

router.post("/bank-reconciliations/:id/import-statement", requireAuth, requirePermission('bank_rec:manage', 'bank_rec:create', 'bank_rec:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { lines } = req.body;
  if (!Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Array of statement lines is required" });
    return;
  }
  try {
    await importBankStatementLines(companyId, id, lines, req.user!.id);
    const summary = await getBankReconciliationSummary(companyId, id);
    res.json(summary);
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/bank-reconciliations/:id/statement-line", requireAuth, requirePermission('bank_rec:manage', 'bank_rec:create', 'bank_rec:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { lineDate, description, reference, type, amount } = req.body;
  if (!lineDate || !description || !type || amount === undefined) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "lineDate, description, type, and amount are required" });
    return;
  }
  try {
    const lineId = await addManualBankStatementLine(companyId, id, {
      lineDate,
      description,
      reference,
      type,
      amount: Number(amount)
    }, req.user!.id);
    const summary = await getBankReconciliationSummary(companyId, id);
    res.json({ lineId, ...summary });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/bank-reconciliations/:id/auto-match", requireAuth, requirePermission('bank_rec:manage', 'bank_rec:create', 'bank_rec:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await autoMatchBankReconciliation(companyId, id, req.user!.id);
    const summary = await getBankReconciliationSummary(companyId, id);
    res.json(summary);
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/bank-reconciliations/:id/match-line", requireAuth, requirePermission('bank_rec:manage', 'bank_rec:create', 'bank_rec:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { lineId, matchedStatus, matchedType, matchedEntityId, matchedAmount } = req.body;
  if (!lineId || !matchedStatus) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "lineId and matchedStatus are required" });
    return;
  }
  try {
    await manualMatchBankStatementLine(companyId, id, lineId, {
      matchedStatus,
      matchedType,
      matchedEntityId,
      matchedAmount: matchedAmount ? Number(matchedAmount) : undefined
    }, req.user!.id);
    const summary = await getBankReconciliationSummary(companyId, id);
    res.json(summary);
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/bank-reconciliations/:id/adjustments", requireAuth, requirePermission('bank_rec:manage', 'bank_rec:create', 'bank_rec:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { type, adjustmentType, amount, offsetAccountId, accountId, description, reference, adjustmentDate } = req.body;
  const resolvedType = type || adjustmentType;
  const resolvedOffsetAccountId = offsetAccountId || accountId;
  if (!resolvedType || amount === undefined || !resolvedOffsetAccountId || !description) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "type, amount, offsetAccountId, and description are required" });
    return;
  }
  try {
    const adjId = await addReconciliationAdjustment(companyId, id, {
      type: resolvedType,
      amount: Number(amount),
      offsetAccountId: resolvedOffsetAccountId,
      description,
      reference,
      adjustmentDate
    }, req.user!.id);
    const summary = await getBankReconciliationSummary(companyId, id);
    res.json({ adjustmentId: adjId, ...summary });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/bank-reconciliations/:id/submit", requireAuth, requirePermission('bank_rec:manage', 'bank_rec:create', 'bank_rec:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await submitBankReconciliation(companyId, id, req.user!.id);
    res.json({ message: "Bank reconciliation submitted successfully" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/bank-reconciliations/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { periodId } = req.body || {};
  try {
    const recon = await db.select().from(schema.bankReconciliations).where(and(eq(schema.bankReconciliations.id, id), eq(schema.bankReconciliations.companyId, companyId))).get();
    const resolvedPeriodId = periodId || await resolveDefaultPeriodId(companyId, recon?.statementDate);
    await approveBankReconciliation(companyId, id, resolvedPeriodId, req.user!.id);
    const summary = await getBankReconciliationSummary(companyId, id);
    res.json({ message: "Bank reconciliation approved successfully", ...summary });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/bank-reconciliations/:id/reopen", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body;
  if (!reason || reason.trim() === "") {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Reason is required to reopen bank reconciliation" });
    return;
  }
  try {
    await reopenBankReconciliation(companyId, id, reason, req.user!.id);
    res.json({ message: "Bank reconciliation reopened successfully" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

export default router;

