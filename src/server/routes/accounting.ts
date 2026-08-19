import { Router } from "express";
import { db } from "../db";
import * as schema from "../db/schema";
import { requireAuth,  requireApprovalRole, requirePostingRole, requirePermission } from "../auth";
import { eq, and, desc, sql, like, gte, lte, or } from "drizzle-orm";
import { parsePaginationParams, buildCursorCondition, formatPaginatedResponse } from "../utils/pagination";
import crypto from "crypto";
import { broadcastNotification } from "../ws";
import { AuditService } from "../services/auditService";
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
  BusinessTransactionError
} from "../db/business_transactions";

const router = Router();


// Get Chart of Accounts (Viewer, Editor, Admin)
router.get("/accounts", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId))
    
    .orderBy(schema.accounts.accountCode);
  res.json(accounts);
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

// Get Accounting Periods
router.get("/periods", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const periods = await db.select()
    .from(schema.accountingPeriods)
    .where(eq(schema.accountingPeriods.companyId, companyId))
    .orderBy(desc(schema.accountingPeriods.startDate));
  res.json(periods);
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
  const periodData = {
    id,
    companyId,
    name,
    startDate: startFormatted,
    endDate: endFormatted,
    fiscalYear: Number(fiscalYear),
    status: "OPEN" as const,
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

// Soft-Close Period (Editor/Admin)
router.post("/periods/:id/soft-close", requireAuth, requirePermission('accounting:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const periodId = req.params.id;

  try {
    await softClosePeriod(companyId, periodId, req.user!.id, req.body?.reason);
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
    return;
  }

  await AuditService.log({
    req,
    companyId,
    action: "SOFT_CLOSE_PERIOD",
    entityType: "ACCOUNTING_PERIOD",
    entityId: periodId,
    module: "ACCOUNTING",
    afterData: { status: "SOFT_CLOSED", softClosedBy: req.user!.id }
  });

  res.json({ message: "Period soft-closed successfully", id: periodId, status: "SOFT_CLOSED" });
});

// Hard-Close Period (Admin)
router.post("/periods/:id/hard-close", requireAuth, requirePermission('accounting:approve'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const periodId = req.params.id;

  try {
    await hardClosePeriod(companyId, periodId, req.user!.id, req.body?.reason);
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
    return;
  }

  await AuditService.log({
    req,
    companyId,
    action: "HARD_CLOSE_PERIOD",
    entityType: "ACCOUNTING_PERIOD",
    entityId: periodId,
    module: "ACCOUNTING",
    afterData: { status: "HARD_CLOSED", hardClosedBy: req.user!.id }
  });

  res.json({ message: "Period hard-closed successfully", id: periodId, status: "HARD_CLOSED" });
});

// Reopen Period (Admin, requires reason)
router.post("/periods/:id/reopen", requireAuth, requirePermission('accounting:approve'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const periodId = req.params.id;
  const { reason } = req.body || {};

  try {
    await reopenPeriod(companyId, periodId, req.user!.id, reason);
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
    return;
  }

  await AuditService.log({
    req,
    companyId,
    action: "REOPEN_PERIOD",
    entityType: "ACCOUNTING_PERIOD",
    entityId: periodId,
    module: "ACCOUNTING",
    reason: reason.trim(),
    afterData: { status: "OPEN", reopenedBy: req.user!.id, reopenReason: reason.trim() }
  });

  res.json({ message: "Accounting period reopened successfully", id: periodId, status: "OPEN" });
});

// Get Period Status History
router.get("/periods/:id/history", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const periodId = req.params.id;

  const history = await db.select().from(schema.periodStatusHistory).where(
    and(eq(schema.periodStatusHistory.accountingPeriodId, periodId), eq(schema.periodStatusHistory.companyId, companyId))
  ).orderBy(schema.periodStatusHistory.createdAt);

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
    const result = await performYearEndClose(companyId, Number(fiscalYear), retainedEarningsAccountId, req.user!.id);
    res.json({ message: "Year-end close completed successfully", result });
  } catch (err: any) {
    res.status(400).json({ error: "YEAR_END_CLOSE_ERROR", message: err.message });
  }
});

// Get Journal Entries (Viewer, Editor, Admin)
router.get("/journals", requireAuth, requirePermission('accounting:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const params = parsePaginationParams(req);

  const filterConditions = [eq(schema.journalEntries.companyId, companyId)];

  if (params.search) {
    const searchPattern = `%${params.search}%`;
    filterConditions.push(
      or(
        like(schema.journalEntries.journalNumber, searchPattern),
        like(schema.journalEntries.description, searchPattern)
      )!
    );
  }

  if (params.status) {
    filterConditions.push(eq(schema.journalEntries.status, params.status));
  }

  if (params.fromDate) {
    filterConditions.push(gte(schema.journalEntries.entryDate, params.fromDate));
  }

  if (params.toDate) {
    filterConditions.push(lte(schema.journalEntries.entryDate, params.toDate));
  }

  const cursorCond = buildCursorCondition(
    schema.journalEntries.entryDate,
    schema.journalEntries.id,
    params.decodedCursor,
    'DESC'
  );

  const queryConditions = [...filterConditions];
  if (cursorCond) {
    queryConditions.push(cursorCond);
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
    .orderBy(desc(schema.journalEntries.entryDate), desc(schema.journalEntries.id))
    .limit(params.limit + 1);

  res.json(formatPaginatedResponse({
    items: journals,
    limit: params.limit,
    getSortValAndId: (j: any) => ({ val: j.entryDate, id: j.id }),
    totalCount,
    raw: params.raw
  }));
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
    const id = await createJournalEntry(companyId, {
      journalNumber: journalNumber || entryNumber || `JE-${Date.now().toString().slice(-6)}`,
      entryDate: entryDate ? new Date(entryDate).toISOString() : new Date().toISOString(),
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
    const status = (err.message.toLowerCase().includes("lock date") || err.message.toLowerCase().includes("closed period") || err.message.toLowerCase().includes("locked")) ? 403 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// Journal Entry Workflow Endpoints
router.post("/journals/:id/submit", requireAuth, requirePermission('accounting:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await submitJournalEntry(companyId, id, req.user!.id);
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
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/journals/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await approveJournalEntry(companyId, id, req.user!.id);
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
    const status = err.message.includes("not found") ? 404 : (err.message.includes("BRAC") || err.message.includes("Segregation") ? 403 : 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/journals/:id/reject", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body || {};
  try {
    await rejectJournalEntry(companyId, id, req.user!.id, reason);
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
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/journals/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await postJournalEntry(companyId, id, req.user!.id, req.activeCompany?.roleCode);
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
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/journals/:id/reverse", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reverseDate, newPeriodId } = req.body;
  if (!reverseDate || !newPeriodId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "reverseDate and newPeriodId are required" });
    return;
  }
  try {
    const reverseId = await reverseJournalEntry(companyId, id, req.user!.id, reverseDate, newPeriodId, req.activeCompany?.roleCode);
    res.json({ message: "Journal entry reversed successfully", reverseId });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
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
    await voidJournalEntry(companyId, id, req.user!.id, reason);
    res.json({ message: "Journal entry voided successfully", id });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
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
    const filterConditions = [eq(schema.purchaseBills.companyId, companyId)];

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

    if (params.status) {
      filterConditions.push(eq(schema.purchaseBills.status, params.status));
    }

    const vendorIdParam = req.query.vendorId as string | undefined;
    if (vendorIdParam) {
      filterConditions.push(eq(schema.purchaseBills.vendorId, vendorIdParam));
    }

    if (params.fromDate) {
      filterConditions.push(gte(schema.purchaseBills.billDate, params.fromDate));
    }

    if (params.toDate) {
      filterConditions.push(lte(schema.purchaseBills.billDate, params.toDate));
    }

    const cursorCond = buildCursorCondition(
      schema.purchaseBills.billDate,
      schema.purchaseBills.id,
      params.decodedCursor,
      'DESC'
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
    })
      .from(schema.purchaseBills)
      .innerJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
      .where(and(...queryConditions))
      .orderBy(desc(schema.purchaseBills.billDate), desc(schema.purchaseBills.id))
      .limit(params.limit + 1);

    res.json(formatPaginatedResponse({
      items: bills,
      limit: params.limit,
      getSortValAndId: (b: any) => ({ val: b.purchase_bills?.billDate ?? b.billDate, id: b.purchase_bills?.id ?? b.id }),
      totalCount,
      raw: params.raw
    }));
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
      sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL')`,
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
    .orderBy(desc(schema.purchaseBills.billDate));

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
      createdAt: schema.purchaseBills.createdAt,
    })
    .from(schema.purchaseBills)
    .innerJoin(schema.vendors, eq(schema.purchaseBills.vendorId, schema.vendors.id))
    .where(and(eq(schema.purchaseBills.id, id), eq(schema.purchaseBills.companyId, companyId)))
    .get();

    if (!bill) return res.status(404).json({ error: "NOT_FOUND", message: "Purchase bill not found" });

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
    }, req.user!.id);
    
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
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message, cause: err.cause ? err.cause.message : err.toString() });
  }
});

// Purchase Bills Workflow Endpoints
router.post("/purchase-bills/:id/submit", requireAuth, requirePermission('purchases:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await submitPurchaseBill(companyId, id, req.user!.id);
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
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/purchase-bills/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await approvePurchaseBill(companyId, id, req.user!.id);
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
    const status = err.message.includes("not found") ? 404 : (err.message.includes("BRAC") || err.message.includes("Segregation") ? 403 : 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
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
    await postPurchaseBill(companyId, id, periodId, lines || [], req.user!.id);
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
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
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
    .where(eq(schema.supplierPayments.companyId, companyId))
    .orderBy(desc(schema.supplierPayments.paymentDate));

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
    const id = await createSupplierPayment(companyId, req.body, req.user!.id);
    res.json({ message: "Supplier payment created successfully", id });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
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
    await approveSupplierPayment(companyId, id, req.user!.id);
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
  const { periodId } = req.body;
  try {
    await postSupplierPayment(companyId, id, periodId, req.user!.id);
    res.json({ message: "Supplier payment posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
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
    .where(eq(schema.debitMemos.companyId, companyId))
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
    const id = await createDebitMemo(companyId, req.body, req.user!.id);
    res.json({ message: "Debit memo created successfully", id });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
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
    await approveDebitMemo(companyId, id, req.user!.id);
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
  const { periodId } = req.body;
  try {
    await postDebitMemo(companyId, id, periodId, req.user!.id);
    res.json({ message: "Debit memo posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// ---------------------------------------------------------
// ACCOUNTS PAYABLE (AP) AGING & SUPPLIER STATEMENT
// ---------------------------------------------------------

router.get("/ap-aging", requireAuth, requirePermission('reports:view'), async (req, res) => {
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
      sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL')`,
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

    // Fetch GL AP Control Account Balance
    const apControlAccounts = await db.select()
      .from(schema.accounts)
      .where(and(
        eq(schema.accounts.companyId, companyId),
        sql`(account_code = '2110' OR (lower(account_name) LIKE '%payable%' AND lower(account_name) NOT LIKE '%tax%' AND lower(account_name) NOT LIKE '%withholding%'))`
      ));

    let totalGlApBalance = 0;
    if (apControlAccounts.length > 0) {
      const apAccountIds = apControlAccounts.map(a => a.id);
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
    const filterConditions = [eq(schema.salesInvoices.companyId, companyId)];

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

    if (params.status) {
      filterConditions.push(eq(schema.salesInvoices.status, params.status));
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

    const cursorCond = buildCursorCondition(
      schema.salesInvoices.invoiceDate,
      schema.salesInvoices.id,
      params.decodedCursor,
      'DESC'
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
    .orderBy(desc(schema.salesInvoices.invoiceDate), desc(schema.salesInvoices.id))
    .limit(params.limit + 1);

    res.json(formatPaginatedResponse({
      items: invoices,
      limit: params.limit,
      getSortValAndId: (inv: any) => ({ val: inv.invoiceDate, id: inv.id }),
      totalCount,
      raw: params.raw
    }));
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
      createdAt: schema.salesInvoices.createdAt,
    })
    .from(schema.salesInvoices)
    .innerJoin(schema.customers, eq(schema.salesInvoices.customerId, schema.customers.id))
    .where(and(eq(schema.salesInvoices.id, id), eq(schema.salesInvoices.companyId, companyId)))
    .get();

    if (!invoice) return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found" });

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
    const id = await createSalesInvoice(companyId, {
      customerId,
      invoiceNumber,
      invoiceType: invoiceType || 'SALES',
      invoiceDate: invoiceDate ? invoiceDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      dueDate: dueDate ? dueDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      reference: reference || null,
      totalAmount: Number(totalAmount),
    }, req.user!.id);

    // Save line items if provided
    if (lines && Array.isArray(lines) && lines.length > 0) {
      const revenueAccount = await db.select().from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.accountType, "REVENUE"))).limit(1).get();
      const defaultRevenueAccountId = revenueAccount?.id;

      for (const line of lines) {
        await db.insert(schema.salesInvoiceLines).values({
          id: crypto.randomUUID(),
          invoiceId: id,
          accountId: line.accountId === "revenue-dummy" && defaultRevenueAccountId ? defaultRevenueAccountId : line.accountId,
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
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/sales-invoices/:id/submit", requireAuth, requirePermission('sales:edit'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await submitSalesInvoice(companyId, id, req.user!.id);
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
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/sales-invoices/:id/approve", requireAuth, requireApprovalRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  try {
    await approveSalesInvoice(companyId, id, req.user!.id);
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
    const status = err.message.includes("not found") ? 404 : (err.message.includes("BRAC") || err.message.includes("Segregation") ? 403 : 400);
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
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
    // If lines not passed in body, fetch saved lines
    let invoiceLines = lines;
    if (!invoiceLines || invoiceLines.length === 0) {
      invoiceLines = await db.select().from(schema.salesInvoiceLines).where(eq(schema.salesInvoiceLines.invoiceId, id));
    }
    await postSalesInvoice(companyId, id, periodId, invoiceLines || [], req.user!.id);
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
    const status = err.message.includes("not found") ? 404 : 400;
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
    .where(eq(schema.customerPayments.companyId, companyId))
    .orderBy(desc(schema.customerPayments.paymentDate));

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
    const id = await createCustomerPayment(companyId, req.body, req.user!.id);
    res.json({ message: "Customer payment created successfully", id });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
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
    await approveCustomerPayment(companyId, id, req.user!.id);
    res.json({ message: "Customer payment approved successfully", id, status: "APPROVED" });
  } catch (err: any) {
    const status = err.message.includes("BRAC") || err.message.includes("Segregation") ? 403 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/customer-payments/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { periodId } = req.body;
  try {
    await postCustomerPayment(companyId, id, periodId, req.user!.id);
    res.json({ message: "Customer payment posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
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
    .where(eq(schema.creditMemos.companyId, companyId))
    .orderBy(desc(schema.creditMemos.memoDate));

    res.json(memos);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.post("/credit-memos", requireAuth, requirePermission('sales:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const id = await createCreditMemo(companyId, req.body, req.user!.id);
    res.json({ message: "Credit memo created successfully", id });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/credit-memos/:id/post", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { periodId } = req.body;
  try {
    await postCreditMemo(companyId, id, periodId, req.user!.id);
    res.json({ message: "Credit memo posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
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

router.get("/ar-aging", requireAuth, requirePermission('reports:view'), async (req, res) => {
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
      sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL')`,
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

    // 4. Fetch GL AR Control Account Balance (Specific AR Accounts)
    const arControlAccounts = await db.select()
      .from(schema.accounts)
      .where(and(
        eq(schema.accounts.companyId, companyId),
        sql`(account_code = '1120' OR (lower(account_name) LIKE '%receivable%' AND lower(account_name) NOT LIKE '%tax%' AND lower(account_name) NOT LIKE '%withholding%'))`
      ));

    let totalGlArBalance = 0;
    if (arControlAccounts.length > 0) {
      const arAccountIds = arControlAccounts.map(a => a.id);
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
  }

  if (params.fromDate) {
    filterConditions.push(gte(schema.cashTransactions.transactionDate, params.fromDate));
  }

  if (params.toDate) {
    filterConditions.push(lte(schema.cashTransactions.transactionDate, params.toDate));
  }

  const cursorCond = buildCursorCondition(
    schema.cashTransactions.transactionDate,
    schema.cashTransactions.id,
    params.decodedCursor,
    'DESC'
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
    .orderBy(desc(schema.cashTransactions.transactionDate), desc(schema.cashTransactions.id))
    .limit(params.limit + 1);

  res.json(formatPaginatedResponse({
    items: txns,
    limit: params.limit,
    getSortValAndId: (t: any) => ({ val: t.transactionDate, id: t.id }),
    totalCount,
    raw: params.raw
  }));
});

// Cash Transactions Workflow Endpoints

router.post("/cash-transactions", requireAuth, requirePermission('cash:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { accountId, type, amount, transactionDate, reference, description } = req.body;

  if (!accountId || !type || !amount) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Account, type, and amount are required" });
    return;
  }

  try {
    const id = await createCashTransaction(companyId, {
      accountId,
      type,
      amount: Number(amount),
      transactionDate: transactionDate ? transactionDate.split('T')[0] : new Date().toISOString().split('T')[0],
      reference,
      description
    }, req.user!.id);

    res.json({ message: "Cash transaction created successfully", id });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/cash-transactions/:id/submit", requireAuth, requirePermission('cash:manage'), async (req, res) => {
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
    await approveCashTransaction(companyId, id, req.user!.id);
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
  const { periodId, lines, extraData } = req.body;
  try {
    await postCashTransaction(companyId, id, periodId, lines || [], req.user!.id, extraData);
    await AuditService.log({
      req,
      companyId,
      action: "POST_CASH_TRANSACTION",
      entityType: "CASH_TRANSACTION",
      entityId: id,
      module: "CASH",
      afterData: { status: "POSTED" }
    });
    res.json({ message: "Cash transaction posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// Liquidate Cash Advance
router.post("/cash-advances/:id/liquidate", requireAuth, requirePermission('cash:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const advanceId = req.params.id;
  const { periodId, expenses, returnedAmount, returnCashAccountId, liquidationDate } = req.body;

  if (!periodId || !expenses || !Array.isArray(expenses)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Period ID and expenses list are required" });
    return;
  }

  try {
    await liquidateCashAdvance(companyId, advanceId, periodId, {
      expenses,
      returnedAmount: Number(returnedAmount || 0),
      returnCashAccountId,
      liquidationDate: liquidationDate || new Date().toISOString().split('T')[0]
    }, req.user!.id);

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
    const status = err.message.includes("not found") ? 404 : 400;
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
    const list = await db.select().from(schema.checks).where(eq(schema.checks.companyId, companyId))
      
      .orderBy(desc(schema.checks.checkDate));
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.post("/checks", requireAuth, requirePermission('cash:manage'), async (req, res) => {
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

router.post("/checks/:id/clear", requireAuth, requirePermission('cash:manage'), async (req, res) => {
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
    await cancelCheck(companyId, id, reason, periodId, req.user!.id);
    res.json({ message: "Check cancelled successfully", id, status: "CANCELLED" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// BANK DEPOSITS ROUTES
router.get("/bank-deposits", requireAuth, requirePermission('cash:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const deposits = await db.select().from(schema.bankDeposits).where(eq(schema.bankDeposits.companyId, companyId))
      
      .orderBy(desc(schema.bankDeposits.depositDate));
    res.json(deposits);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.post("/bank-deposits", requireAuth, requirePermission('cash:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { depositNumber, depositDate, toBankAccountId, fromCashAccountId, totalAmount, reference, notes, attachmentUrl } = req.body;

  if (!toBankAccountId || !fromCashAccountId || !totalAmount) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Bank account, source cash account, and total amount are required" });
    return;
  }

  try {
    const id = await createBankDeposit(companyId, {
      depositNumber: depositNumber || `DEP-${Date.now().toString().slice(-6)}`,
      depositDate: depositDate || new Date().toISOString().split('T')[0],
      toBankAccountId,
      fromCashAccountId,
      totalAmount: Number(totalAmount),
      reference,
      notes,
      attachmentUrl
    }, req.user!.id);

    res.json({ message: "Bank deposit created successfully", id, status: "DRAFT" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/bank-deposits/:id/submit", requireAuth, requirePermission('cash:manage'), async (req, res) => {
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
    await approveBankDeposit(companyId, id, req.user!.id);
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
  const { periodId } = req.body;

  if (!periodId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Period ID is required for posting" });
    return;
  }

  try {
    await postBankDeposit(companyId, id, periodId, req.user!.id);
    res.json({ message: "Bank deposit posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// CASH COUNTS ROUTES
router.get("/cash-counts", requireAuth, requirePermission('cash:view'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  try {
    const counts = await db.select().from(schema.cashCounts).where(eq(schema.cashCounts.companyId, companyId))
      
      .orderBy(desc(schema.cashCounts.countDate));
    res.json(counts);
  } catch (err: any) {
    res.status(500).json({ error: "QUERY_ERROR", message: err.message });
  }
});

router.post("/cash-counts", requireAuth, requirePermission('cash:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { countNumber, countDate, cashAccountId, custodianName, bookBalance, countedBalance, varianceAccountId, notes, attachmentUrl, denominations } = req.body;

  if (!cashAccountId || !custodianName) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Cash account and custodian name are required" });
    return;
  }

  try {
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
    }, req.user!.id);

    res.json({ message: "Cash count created successfully", id, status: "DRAFT" });
  } catch (err: any) {
    res.status(400).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

router.post("/cash-counts/:id/submit", requireAuth, requirePermission('cash:manage'), async (req, res) => {
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
    await approveCashCount(companyId, id, req.user!.id);
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
  const { periodId } = req.body;

  if (!periodId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Period ID is required for posting" });
    return;
  }

  try {
    await postCashCount(companyId, id, periodId, req.user!.id);
    res.json({ message: "Cash count posted successfully", id, status: "POSTED" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
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




router.get("/integrity-check", requireAuth, requirePermission('audit:view'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;

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



// Void Journal Entry
router.post("/journals/:id/void", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { reason } = req.body;
  
  if (!reason) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Reason is required for voiding" });
    return;
  }

  try {
    await voidJournalEntry(companyId, id, req.user!.id, reason);
    res.json({ message: "Journal entry voided successfully", id, status: "VOIDED" });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// Copy Journal Entry
router.post('/journals/:id/copy', requireAuth, requirePermission('accounting:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { entryDate } = req.body;

  try {
    const newId = await copyJournalEntry(companyId, id, req.user!.id, entryDate);
    res.json({ message: "Journal entry copied successfully", newId });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// Import Journal Entries
router.post('/journals/import', requireAuth, requirePermission('accounting:create'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { entries } = req.body;
  
  if (!entries || !Array.isArray(entries)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Valid entries array is required" });
    return;
  }

  try {
    const result = await importJournalEntries(companyId, req.user!.id, entries);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: "IMPORT_ERROR", message: err.message });
  }
});

router.post("/journals/:id/reverse", requireAuth, requirePostingRole, async (req, res) => {
  const companyId = req.activeCompany!.id;
  const entryId = req.params.id;
  const { reverseDate, newPeriodId } = req.body;

  if (!reverseDate || !newPeriodId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Reverse date and new period ID are required" });
    return;
  }

  try {
    const reversalId = await reverseJournalEntry(
      companyId,
      entryId,
      req.user!.id,
      reverseDate,
      newPeriodId,
      req.activeCompany!.roleCode || req.activeCompany!.role
    );
    
    // Real-time notifications
    await broadcastNotification({
      companyId,
      title: "Journal Entry Reversed",
      message: `Journal entry was reversed by ${req.user!.displayName}.`,
      type: "SYSTEM",
      entityType: "journal_entry",
      entityId: reversalId,
    });

    res.status(200).json({ message: "Journal entry reversed successfully", reversalId });
  } catch (err: any) {
    const status = err.message.includes("not found") ? 404 : 400;
    res.status(status).json({ error: err.code || "WORKFLOW_ERROR", message: err.message });
  }
});

// ============================================================================
// PHASE 11: BANK RECONCILIATION ROUTES
// ============================================================================

router.post("/bank-reconciliations", requireAuth, requirePermission('bank_rec:manage'), async (req, res) => {
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
    const recons = await db.select().from(schema.bankReconciliations).where(eq(schema.bankReconciliations.companyId, companyId))
      
      .orderBy(desc(schema.bankReconciliations.statementDate));
    res.json(recons);
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

router.post("/bank-reconciliations/:id/import-statement", requireAuth, requirePermission('bank_rec:manage'), async (req, res) => {
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

router.post("/bank-reconciliations/:id/statement-line", requireAuth, requirePermission('bank_rec:manage'), async (req, res) => {
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

router.post("/bank-reconciliations/:id/auto-match", requireAuth, requirePermission('bank_rec:manage'), async (req, res) => {
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

router.post("/bank-reconciliations/:id/match-line", requireAuth, requirePermission('bank_rec:manage'), async (req, res) => {
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

router.post("/bank-reconciliations/:id/adjustments", requireAuth, requirePermission('bank_rec:manage'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const id = req.params.id;
  const { type, amount, offsetAccountId, description, reference, adjustmentDate } = req.body;
  if (!type || amount === undefined || !offsetAccountId || !description) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "type, amount, offsetAccountId, and description are required" });
    return;
  }
  try {
    const adjId = await addReconciliationAdjustment(companyId, id, {
      type,
      amount: Number(amount),
      offsetAccountId,
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

router.post("/bank-reconciliations/:id/submit", requireAuth, requirePermission('bank_rec:manage'), async (req, res) => {
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
  const { periodId } = req.body;
  if (!periodId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "periodId is required for approval" });
    return;
  }
  try {
    await approveBankReconciliation(companyId, id, periodId, req.user!.id);
    res.json({ message: "Bank reconciliation approved successfully" });
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

