import { db } from "../db";
import { dbContext } from "../db/context";
import * as schema from "../db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AuditService } from "./auditService";
import { CompanyManager } from "./companyManager";
import { OperationalLogger } from "./operationalLogger";
import { DomainError } from "../db/domain";

export const ARCHIVE_RETENTION_DAYS = 30;
export const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export type RetentionState = "ACTIVE_RETENTION" | "ELIGIBLE_FOR_PURGE" | "BLOCKED" | "EXEMPT";

export interface ArchiveEntityMeta {
  table: any;
  moduleLabel: string;
  isMaster: boolean;
}

export const ARCHIVE_ENTITY_REGISTRY: Record<string, ArchiveEntityMeta> = {
  ACCOUNT: { table: schema.accounts, moduleLabel: "Chart of Accounts", isMaster: true },
  CUSTOMER: { table: schema.customers, moduleLabel: "Customers", isMaster: true },
  VENDOR: { table: schema.vendors, moduleLabel: "Suppliers", isMaster: true },
  SALES_INVOICE: { table: schema.salesInvoices, moduleLabel: "Sales Invoices", isMaster: false },
  CUSTOMER_PAYMENT: { table: schema.customerPayments, moduleLabel: "Collections & OR", isMaster: false },
  CREDIT_MEMO: { table: schema.creditMemos, moduleLabel: "Credit Memos", isMaster: false },
  PURCHASE_REQUISITION: { table: schema.purchaseRequisitions, moduleLabel: "Purchase Requisitions", isMaster: false },
  PURCHASE_ORDER: { table: schema.purchaseOrders, moduleLabel: "Purchase Orders", isMaster: false },
  GOODS_RECEIPT_NOTE: { table: schema.goodsReceiptNotes, moduleLabel: "Receiving (GRN)", isMaster: false },
  PURCHASE_BILL: { table: schema.purchaseBills, moduleLabel: "Purchase Bills", isMaster: false },
  SUPPLIER_PAYMENT: { table: schema.supplierPayments, moduleLabel: "Supplier Payments", isMaster: false },
  DEBIT_MEMO: { table: schema.debitMemos, moduleLabel: "Debit Memos", isMaster: false },
  CASH_TRANSACTION: { table: schema.cashTransactions, moduleLabel: "Cash Management", isMaster: false },
  CHECK: { table: schema.checks, moduleLabel: "Check Register", isMaster: false },
  BANK_DEPOSIT: { table: schema.bankDeposits, moduleLabel: "Bank Deposits", isMaster: false },
  CASH_COUNT: { table: schema.cashCounts, moduleLabel: "Physical Cash Counts", isMaster: false },
  BANK_RECONCILIATION: { table: schema.bankReconciliations, moduleLabel: "Bank Reconciliation", isMaster: false },
  BANK_ACCOUNT: { table: schema.bankAccounts, moduleLabel: "Bank Accounts", isMaster: true },
  JOURNAL_ENTRY: { table: schema.journalEntries, moduleLabel: "General Ledger", isMaster: false },
  BUDGET: { table: schema.budgets, moduleLabel: "Budget & Planning", isMaster: false },
  FIXED_ASSET: { table: schema.fixedAssets, moduleLabel: "Fixed Assets", isMaster: true },
  INVENTORY_ITEM: { table: schema.inventoryItems, moduleLabel: "Inventory", isMaster: true },
  STOCK_ADJUSTMENT: { table: schema.stockAdjustments, moduleLabel: "Stock Adjustments", isMaster: false },
  EMPLOYEE: { table: schema.employees, moduleLabel: "Payroll & HR", isMaster: true },
  PAYROLL_RUN: { table: schema.payrollRuns, moduleLabel: "Payroll Runs", isMaster: false },
  TAX_CODE: { table: schema.taxCodes, moduleLabel: "Tax Codes", isMaster: true },
  TAX_FILING: { table: schema.taxFilings, moduleLabel: "BIR Tax Filings", isMaster: false },
  AUDIT_ENGAGEMENT: { table: schema.auditEngagements, moduleLabel: "Audit Engagements", isMaster: false },
  DOCUMENT: { table: schema.documents, moduleLabel: "Documents Vault", isMaster: false },
};

export const MASTER_ENTITY_TYPES = new Set(
  Object.entries(ARCHIVE_ENTITY_REGISTRY)
    .filter(([, meta]) => meta.isMaster)
    .map(([key]) => key)
);

export const PROTECTED_FINANCIAL_STATUSES = new Set([
  "POSTED",
  "APPROVED",
  "PAID",
  "PARTIAL",
  "PARTIALLY_PAID",
  "REVERSED",
  "ADJUSTED",
  "COMPLETED",
  "FILED",
  "VERIFIED",
  "FINALIZED",
]);

const EXCLUDED_PREVIOUS_STATUSES = new Set(["ARCHIVED", "REMOVED", "REMOVED_FROM_LIST", "SOFT_DELETED", "DELETED"]);

export interface PermanentDeleteEvaluation {
  canPermanentDelete: boolean;
  retentionState: RetentionState;
  retentionReason: string;
  previousStatus: string;
  dependencyCount: number;
  dependencySummary: string[];
  isExpired: boolean;
  daysRemaining: number;
}

export interface ArchivedRecordView {
  id: string;
  companyId: string;
  entityType: string;
  code: string;
  name: string;
  module: string;
  status: string;
  previousStatus: string;
  archivedAt: string;
  archivedBy: string;
  archiveReason: string;
  archiveExpiresAt: string;
  updatedAt: any;
  daysRemaining: number;
  isExpired: boolean;
  canRestore: boolean;
  canPermanentDelete: boolean;
  retentionState: RetentionState;
  retentionRule: string;
  dependencyCount: number;
  dependencySummary: string[];
}

export interface RetentionSweepRecordOutcome {
  entityType: string;
  entityId: string;
  code: string;
  outcome: "PURGED" | "BLOCKED" | "EXEMPT" | "ACTIVE_RETENTION" | "FAILED";
  reason: string;
}

export interface RetentionSweepSummary {
  companyId: string;
  ranAt: string;
  evaluated: number;
  expiredCount: number;
  purgedCount: number;
  blockedCount: number;
  exemptCount: number;
  failedCount: number;
  outcomes: RetentionSweepRecordOutcome[];
}

function extractRecordCode(row: any): string {
  return String(
    row.accountCode ||
      row.code ||
      row.invoiceNumber ||
      row.billNumber ||
      row.journalNumber ||
      row.paymentNumber ||
      row.creditMemoNumber ||
      row.debitMemoNumber ||
      row.transactionNumber ||
      row.checkNumber ||
      row.depositNumber ||
      row.countNumber ||
      row.reconciliationNumber ||
      row.prNumber ||
      row.poNumber ||
      row.grnNumber ||
      row.adjustmentNumber ||
      row.documentNo ||
      row.assetTag ||
      row.assetCode ||
      row.sku ||
      row.employeeNo ||
      row.employeeId ||
      row.category ||
      row.id
  ).slice(0, 48);
}

function extractRecordName(entityType: string, row: any): string {
  return (
    row.accountName ||
    row.legalName ||
    row.name ||
    row.assetName ||
    row.itemName ||
    row.engagementName ||
    row.payrollPeriod ||
    row.periodName ||
    row.title ||
    row.fileName ||
    row.payeeName ||
    row.description ||
    (row.firstName && row.lastName ? `${row.firstName} ${row.lastName}` : null) ||
    (row.category && row.periodMonth ? `${row.category} (${row.periodMonth})` : null) ||
    `${entityType} #${String(row.id || "").slice(0, 8)}`
  );
}

async function safeCount(queryFn: () => Promise<{ count: number } | undefined>): Promise<number> {
  try {
    const res = await queryFn();
    return Number(res?.count || 0);
  } catch {
    return 0;
  }
}

export class ArchiveRetentionService {
  /**
   * Resolves the original pre-archive status from immutable audit logs or linked GL state.
   */
  static async resolvePreArchiveStatus(
    companyId: string,
    entityType: string,
    entityId: string,
    currentRecord: any,
    latestArchiveLog?: any
  ): Promise<string> {
    const normType = entityType.toUpperCase();
    const isMaster = MASTER_ENTITY_TYPES.has(normType);

    const parseLogStatus = (log: any): string | null => {
      if (!log) return null;
      if (log.beforeData) {
        try {
          const before = typeof log.beforeData === "string" ? JSON.parse(log.beforeData) : log.beforeData;
          const prev = String(before?.status || "").toUpperCase();
          if (prev && !EXCLUDED_PREVIOUS_STATUSES.has(prev)) {
            return prev;
          }
        } catch {}
      }
      const prevCol = String(log.previousStatus || "").toUpperCase();
      if (prevCol && !EXCLUDED_PREVIOUS_STATUSES.has(prevCol)) {
        return prevCol;
      }
      return null;
    };

    const fromProvided = parseLogStatus(latestArchiveLog);
    if (fromProvided) return fromProvided;

    try {
      const entityVariants = Array.from(
        new Set([normType, normType.toLowerCase(), `${normType.toLowerCase()}s`])
      );
      const recentLogs = await db
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.companyId, companyId),
            inArray(schema.auditLogs.entityType, entityVariants),
            eq(schema.auditLogs.entityId, entityId)
          )
        )
        .orderBy(desc(schema.auditLogs.timestamp))
        .limit(20)
        .all();

      for (const log of recentLogs) {
        const act = String(log.action || "").toUpperCase();
        if (
          act.startsWith("ARCHIVED_") ||
          act.startsWith("ARCHIVE_") ||
          act.startsWith("REMOVED_") ||
          act.startsWith("REMOVE_") ||
          act.startsWith("SOFT_DELETED_") ||
          act.startsWith("SOFT_DELETE_")
        ) {
          const st = parseLogStatus(log);
          if (st) return st;
        }
      }
    } catch {}

    if (!isMaster && currentRecord?.journalEntryId) {
      const je = await db
        .select({ status: schema.journalEntries.status })
        .from(schema.journalEntries)
        .where(
          and(
            eq(schema.journalEntries.id, currentRecord.journalEntryId),
            eq(schema.journalEntries.companyId, companyId)
          )
        )
        .get();
      if (je?.status === "POSTED") {
        if (typeof currentRecord.balanceDue === "number" && typeof currentRecord.totalAmount === "number") {
          if (currentRecord.balanceDue === 0 && currentRecord.totalAmount > 0) return "PAID";
          if (currentRecord.balanceDue > 0 && currentRecord.balanceDue < currentRecord.totalAmount) return "PARTIAL";
        }
        return "POSTED";
      }
    }

    return isMaster ? "ACTIVE" : "DRAFT";
  }

  /**
   * Checks real database foreign-key & accounting dependencies for any entity before permanent purge.
   */
  static async inspectRecordDependencies(
    companyId: string,
    entityType: string,
    entityId: string,
    row: any
  ): Promise<{ count: number; summary: string[] }> {
    const normType = entityType.toUpperCase();
    const summary: string[] = [];
    let total = 0;

    const addDep = (label: string, n: number) => {
      if (n > 0) {
        total += n;
        summary.push(`${n} ${label}`);
      }
    };

    if (normType === "ACCOUNT") {
      const [
        jLines,
        sLines,
        pLines,
        cTxns,
        cLines,
        vendorDefP,
        vendorDefE,
        custDefR,
        custDefRev,
        taxC,
        bankReg,
        bankAccts,
        pmDef,
        childAccts,
        bankRecs,
      ] = await Promise.all([
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.journalLines).where(eq(schema.journalLines.accountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.salesInvoiceLines).where(eq(schema.salesInvoiceLines.accountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.purchaseBillLines).where(eq(schema.purchaseBillLines.accountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.cashTransactions).where(eq(schema.cashTransactions.cashAccountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.cashTransactionLines).where(eq(schema.cashTransactionLines.accountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.vendors).where(eq(schema.vendors.defaultPayableAccountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.vendors).where(eq(schema.vendors.defaultExpenseAccountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.customers).where(eq(schema.customers.defaultReceivableAccountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.customers).where(eq(schema.customers.defaultRevenueAccountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.taxCodes).where(eq(schema.taxCodes.accountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.banks).where(eq(schema.banks.glAccountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.bankAccounts).where(eq(schema.bankAccounts.glAccountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.paymentMethods).where(eq(schema.paymentMethods.defaultAccountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.accounts).where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.parentAccountId, entityId))).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.bankReconciliations).where(eq(schema.bankReconciliations.bankAccountId, entityId)).get()),
      ]);
      addDep("journal line(s)", jLines);
      addDep("sales invoice line(s)", sLines);
      addDep("purchase bill line(s)", pLines);
      addDep("cash transaction(s)", cTxns + cLines);
      addDep("vendor default mapping(s)", vendorDefP + vendorDefE);
      addDep("customer default mapping(s)", custDefR + custDefRev);
      addDep("tax code mapping(s)", taxC);
      addDep("bank registry link(s)", bankReg + bankAccts + bankRecs);
      addDep("payment method link(s)", pmDef);
      addDep("sub-account(s)", childAccts);
    } else if (normType === "CUSTOMER") {
      const [invs, pays, cms] = await Promise.all([
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.salesInvoices).where(eq(schema.salesInvoices.customerId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.customerPayments).where(eq(schema.customerPayments.customerId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.creditMemos).where(eq(schema.creditMemos.customerId, entityId)).get()),
      ]);
      addDep("sales invoice(s)", invs);
      addDep("customer payment(s)", pays);
      addDep("credit memo(s)", cms);
    } else if (normType === "VENDOR") {
      const [bills, pays, dms, pos] = await Promise.all([
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.purchaseBills).where(eq(schema.purchaseBills.vendorId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.supplierPayments).where(eq(schema.supplierPayments.vendorId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.debitMemos).where(eq(schema.debitMemos.vendorId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.purchaseOrders).where(eq(schema.purchaseOrders.vendorId, entityId)).get()),
      ]);
      addDep("purchase bill(s)", bills);
      addDep("supplier payment(s)", pays);
      addDep("debit memo(s)", dms);
      addDep("purchase order(s)", pos);
    } else if (normType === "INVENTORY_ITEM") {
      const [adjs, poLines] = await Promise.all([
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.stockAdjustments).where(eq(schema.stockAdjustments.itemId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.itemId, entityId)).get()),
      ]);
      addDep("stock adjustment(s)", adjs);
      addDep("purchase order line(s)", poLines);
      if (Number(row?.quantityOnHand || 0) !== 0) {
        addDep("non-zero stock on hand", 1);
      }
    } else if (normType === "FIXED_ASSET") {
      const depScheds = await safeCount(() =>
        db.select({ count: sql<number>`count(*)` }).from(schema.depreciationSchedules).where(eq(schema.depreciationSchedules.assetId, entityId)).get()
      );
      addDep("depreciation schedule(s)", depScheds);
      if (Number(row?.accumulatedDepreciation || 0) > 0) {
        addDep("posted accumulated depreciation", 1);
      }
    } else if (normType === "EMPLOYEE") {
      const pItems = await safeCount(() =>
        db.select({ count: sql<number>`count(*)` }).from(schema.payrollItems).where(eq(schema.payrollItems.employeeId, entityId)).get()
      );
      addDep("payroll item(s)", pItems);
    } else if (normType === "TAX_CODE") {
      const [tCalcs, sLines, pLines] = await Promise.all([
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.taxCalculations).where(eq(schema.taxCalculations.taxCodeId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.salesInvoiceLines).where(eq(schema.salesInvoiceLines.taxCodeId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.purchaseBillLines).where(eq(schema.purchaseBillLines.taxCodeId, entityId)).get()),
      ]);
      addDep("tax calculation(s)", tCalcs);
      addDep("sales invoice tax line(s)", sLines);
      addDep("purchase bill tax line(s)", pLines);
    } else if (normType === "BANK_ACCOUNT") {
      const [stmts, txns] = await Promise.all([
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.bankStatements).where(eq(schema.bankStatements.bankAccountId, entityId)).get()),
        safeCount(() => db.select({ count: sql<number>`count(*)` }).from(schema.bankTransactions).where(eq(schema.bankTransactions.bankAccountId, entityId)).get()),
      ]);
      addDep("bank statement(s)", stmts);
      addDep("bank transaction(s)", txns);
    }

    return { count: total, summary };
  }

  /**
   * Evaluates whether an archived record is EXEMPT (statutory BIR retention),
   * BLOCKED (referenced by linked financial/business records), ACTIVE_RETENTION (< 30 days),
   * or ELIGIBLE_FOR_PURGE (>= 30 days with zero protected dependencies).
   */
  static async evaluatePermanentDeleteEligibility(
    companyId: string,
    entityType: string,
    row: any,
    archivedTimeMs: number,
    nowMs: number = Date.now(),
    latestArchiveLog?: any
  ): Promise<PermanentDeleteEvaluation> {
    const normType = entityType.toUpperCase();
    const previousStatus = await this.resolvePreArchiveStatus(companyId, normType, row.id, row, latestArchiveLog);
    const elapsedMs = Math.max(0, nowMs - archivedTimeMs);
    const isExpired = elapsedMs >= ARCHIVE_RETENTION_MS;
    const daysRemaining = isExpired ? 0 : Math.ceil((ARCHIVE_RETENTION_MS - elapsedMs) / (24 * 60 * 60 * 1000));

    // 1. BIR 10-Year Statutory Retention Exemption (RR 17-2013 / RR 5-2014)
    const hasPostedLedgerLink = Boolean(row.journalEntryId) || Boolean(row.reversalJournalId);
    if (PROTECTED_FINANCIAL_STATUSES.has(previousStatus) || hasPostedLedgerLink) {
      return {
        canPermanentDelete: false,
        retentionState: "EXEMPT",
        retentionReason: `EXEMPT — BIR 10-Year Statutory Retention (RR 17-2013 / RR 5-2014): Pre-archive status '${previousStatus}'${
          hasPostedLedgerLink ? " with posted GL reference" : ""
        } cannot be permanently deleted.`,
        previousStatus,
        dependencyCount: hasPostedLedgerLink ? 1 : 0,
        dependencySummary: hasPostedLedgerLink ? ["posted GL journal entry"] : [`statutory ${previousStatus} status`],
        isExpired,
        daysRemaining,
      };
    }

    // 2. Active Accounting / Business Dependency Block
    const deps = await this.inspectRecordDependencies(companyId, normType, row.id, row);
    if (deps.count > 0) {
      return {
        canPermanentDelete: false,
        retentionState: "BLOCKED",
        retentionReason: `BLOCKED — Protected by ${deps.count} linked accounting/business record(s): ${deps.summary.join(", ")}. Permanent deletion is prohibited to preserve referential integrity.`,
        previousStatus,
        dependencyCount: deps.count,
        dependencySummary: deps.summary,
        isExpired,
        daysRemaining,
      };
    }

    // 3. Clean, Unreferenced Record
    return {
      canPermanentDelete: true,
      retentionState: isExpired ? "ELIGIBLE_FOR_PURGE" : "ACTIVE_RETENTION",
      retentionReason: isExpired
        ? "ELIGIBLE_FOR_PURGE — 30-calendar-day archive retention elapsed with zero protected accounting dependencies."
        : `30-calendar-day retention window active (${daysRemaining} day(s) remaining before automated purge).`,
      previousStatus,
      dependencyCount: 0,
      dependencySummary: [],
      isExpired,
      daysRemaining,
    };
  }

  /**
   * Read-only listing of archived records across one or more entity types.
   * Strictly non-mutating: HTTP GET never deletes records.
   */
  static async listArchivedRecords(
    companyId: string,
    filters?: {
      entityTypes?: string[];
      module?: string;
      search?: string;
      archivedBy?: string;
      retentionState?: string;
      nowMs?: number;
    }
  ): Promise<{
    records: ArchivedRecordView[];
    summary: {
      total: number;
      activeRetention: number;
      eligibleForPurge: number;
      blocked: number;
      exempt: number;
    };
  }> {
    const now = filters?.nowMs ?? Date.now();
    const filterEntityTypes =
      filters?.entityTypes && filters.entityTypes.length > 0
        ? new Set(filters.entityTypes.map((e) => e.trim().toUpperCase()).filter(Boolean))
        : null;
    const moduleFilter = String(filters?.module || "").trim().toLowerCase();
    const searchFilter = String(filters?.search || "").trim().toLowerCase();
    const archivedByFilter = String(filters?.archivedBy || "").trim().toLowerCase();
    const retentionStateFilter = String(filters?.retentionState || "").trim().toUpperCase();

    const allArchived: ArchivedRecordView[] = [];

    for (const [entityType, meta] of Object.entries(ARCHIVE_ENTITY_REGISTRY)) {
      if (filterEntityTypes && !filterEntityTypes.has(entityType)) continue;
      if (moduleFilter && meta.moduleLabel.toLowerCase() !== moduleFilter) continue;
      const table = meta?.table;
      if (!table) continue;

      try {
        const rows = await db
          .select()
          .from(table)
          .where(and(eq(table.companyId, companyId), eq(table.status, "ARCHIVED")))
          .all();

        if (rows.length === 0) continue;

        const rowIds = rows.map((r: any) => r.id).filter(Boolean);
        const entityVariants = Array.from(
          new Set([entityType, entityType.toLowerCase(), `${entityType.toLowerCase()}s`])
        );
        const archiveLogs =
          rowIds.length > 0
            ? await db
                .select()
                .from(schema.auditLogs)
                .where(
                  and(
                    eq(schema.auditLogs.companyId, companyId),
                    inArray(schema.auditLogs.entityType, entityVariants),
                    inArray(schema.auditLogs.entityId, rowIds)
                  )
                )
                .orderBy(desc(schema.auditLogs.timestamp))
                .all()
            : [];

        const latestArchiveLogById = new Map<string, any>();
        for (const log of archiveLogs) {
          const act = String(log.action || "").toUpperCase();
          if (
            (act.startsWith("ARCHIVED_") || act.startsWith("ARCHIVE_")) &&
            !latestArchiveLogById.has(log.entityId)
          ) {
            latestArchiveLogById.set(log.entityId, log);
          }
        }

        for (const row of rows) {
          const log = latestArchiveLogById.get(row.id);
          const archivedAtDate = log?.timestamp
            ? new Date(log.timestamp)
            : row.updatedAt
            ? new Date(row.updatedAt)
            : new Date(now);
          const archivedTime = archivedAtDate.getTime();
          const expiresAtDate = new Date(archivedTime + ARCHIVE_RETENTION_MS);

          const evaluation = await this.evaluatePermanentDeleteEligibility(
            companyId,
            entityType,
            row,
            archivedTime,
            now,
            log
          );

          const view: ArchivedRecordView = {
            id: row.id,
            companyId,
            entityType,
            code: extractRecordCode(row),
            name: extractRecordName(entityType, row),
            module: meta.moduleLabel,
            status: row.status,
            previousStatus: evaluation.previousStatus,
            archivedAt: archivedAtDate.toISOString(),
            archivedBy: log?.userDisplayName || log?.userEmail || "System User",
            archiveReason: log?.reason || "Moved to Archive Inbox",
            archiveExpiresAt: expiresAtDate.toISOString(),
            updatedAt: row.updatedAt,
            daysRemaining: evaluation.daysRemaining,
            isExpired: evaluation.isExpired,
            canRestore: true,
            canPermanentDelete: evaluation.canPermanentDelete,
            retentionState: evaluation.retentionState,
            retentionRule: evaluation.retentionReason,
            dependencyCount: evaluation.dependencyCount,
            dependencySummary: evaluation.dependencySummary,
          };

          if (searchFilter) {
            const haystack = `${view.id} ${view.code} ${view.name} ${view.entityType} ${view.module} ${view.archiveReason} ${view.archivedBy}`.toLowerCase();
            if (!haystack.includes(searchFilter)) continue;
          }
          if (archivedByFilter && !view.archivedBy.toLowerCase().includes(archivedByFilter)) {
            continue;
          }
          if (retentionStateFilter && retentionStateFilter !== "ALL" && view.retentionState !== retentionStateFilter) {
            continue;
          }

          allArchived.push(view);
        }
      } catch (innerErr) {
        OperationalLogger.warn("ArchiveRetentionService skipped table during list", {
          companyId,
          entityType,
          error: (innerErr as any)?.message,
        });
      }
    }

    allArchived.sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime());

    const summary = {
      total: allArchived.length,
      activeRetention: allArchived.filter((r) => r.retentionState === "ACTIVE_RETENTION").length,
      eligibleForPurge: allArchived.filter((r) => r.retentionState === "ELIGIBLE_FOR_PURGE").length,
      blocked: allArchived.filter((r) => r.retentionState === "BLOCKED").length,
      exempt: allArchived.filter((r) => r.retentionState === "EXEMPT").length,
    };

    return { records: allArchived, summary };
  }

  /**
   * Module-aware restoration handler validating entity-specific accounting & referential rules.
   */
  static async restoreArchivedRecord(
    companyId: string,
    entityType: string,
    id: string,
    options?: { req?: any; userId?: string; reason?: string }
  ): Promise<{
    id: string;
    entityType: string;
    restoredStatus: string;
    warnings: string[];
    recordCode: string;
  }> {
    const normType = entityType.toUpperCase();
    const meta = ARCHIVE_ENTITY_REGISTRY[normType];
    if (!meta?.table) {
      throw new DomainError(`Invalid entity type: ${entityType}`, "INVALID_ENTITY", 400);
    }

    const table = meta.table;
    const existing = await db
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.companyId, companyId)))
      .get();

    if (!existing) {
      throw new DomainError("Archived record not found in active company.", "NOT_FOUND", 404);
    }

    const restoredStatus = await this.resolvePreArchiveStatus(companyId, normType, id, existing);
    const warnings: string[] = [];
    const patchPayload: Record<string, any> = {
      status: restoredStatus,
      updatedAt: new Date(),
    };

    // Module-specific restoration integrity validations
    if (normType === "ACCOUNT") {
      // Check duplicate accountCode collision with another active account
      const collision = await db
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.companyId, companyId),
            eq(schema.accounts.accountCode, existing.accountCode),
            eq(schema.accounts.status, "ACTIVE")
          )
        )
        .get();
      if (collision && collision.id !== id) {
        throw new DomainError(
          `Cannot restore COA account ${existing.accountCode}: another active account already uses code ${existing.accountCode}.`,
          "COA_RESTORE_CODE_CONFLICT",
          409
        );
      }
      if (existing.parentAccountId) {
        const parent = await db
          .select({ id: schema.accounts.id, status: schema.accounts.status })
          .from(schema.accounts)
          .where(and(eq(schema.accounts.id, existing.parentAccountId), eq(schema.accounts.companyId, companyId)))
          .get();
        if (!parent) {
          patchPayload.parentAccountId = null;
          warnings.push("Original parent header account no longer exists; restored as top-level account.");
        } else if (parent.status !== "ACTIVE") {
          warnings.push(`Parent account (${existing.parentAccountId}) is currently ${parent.status}.`);
        }
      }
    } else if (normType === "BANK_ACCOUNT") {
      if (existing.glAccountId) {
        const gl = await db
          .select({ id: schema.accounts.id, status: schema.accounts.status, accountCode: schema.accounts.accountCode })
          .from(schema.accounts)
          .where(and(eq(schema.accounts.id, existing.glAccountId), eq(schema.accounts.companyId, companyId)))
          .get();
        if (!gl) {
          throw new DomainError(
            "Cannot restore bank account: its linked General Ledger account no longer exists in the Chart of Accounts.",
            "BANK_RESTORE_GL_MISSING",
            409
          );
        }
        if (gl.status !== "ACTIVE") {
          warnings.push(`Linked GL account ${gl.accountCode} is currently ${gl.status}; reactivate it to resume postings.`);
        }
      }
    } else if (normType === "TAX_CODE") {
      if (existing.accountId) {
        const gl = await db
          .select({ id: schema.accounts.id, status: schema.accounts.status })
          .from(schema.accounts)
          .where(and(eq(schema.accounts.id, existing.accountId), eq(schema.accounts.companyId, companyId)))
          .get();
        if (!gl) {
          patchPayload.accountId = null;
          warnings.push("Original GL control account was removed; remap GL control account before filing.");
        }
      }
    } else if (normType === "SALES_INVOICE" || normType === "CUSTOMER_PAYMENT" || normType === "CREDIT_MEMO") {
      if (existing.customerId) {
        const cust = await db
          .select({ id: schema.customers.id, status: schema.customers.status })
          .from(schema.customers)
          .where(and(eq(schema.customers.id, existing.customerId), eq(schema.customers.companyId, companyId)))
          .get();
        if (!cust) {
          throw new DomainError(
            `Cannot restore ${meta.moduleLabel}: linked customer record no longer exists.`,
            "SALES_RESTORE_CUSTOMER_MISSING",
            409
          );
        }
        if (cust.status !== "ACTIVE") {
          warnings.push(`Linked customer is currently ${cust.status}.`);
        }
      }
    } else if (
      normType === "PURCHASE_BILL" ||
      normType === "SUPPLIER_PAYMENT" ||
      normType === "DEBIT_MEMO" ||
      normType === "PURCHASE_ORDER"
    ) {
      if (existing.vendorId) {
        const vend = await db
          .select({ id: schema.vendors.id, status: schema.vendors.status })
          .from(schema.vendors)
          .where(and(eq(schema.vendors.id, existing.vendorId), eq(schema.vendors.companyId, companyId)))
          .get();
        if (!vend) {
          throw new DomainError(
            `Cannot restore ${meta.moduleLabel}: linked supplier record no longer exists.`,
            "PROCUREMENT_RESTORE_VENDOR_MISSING",
            409
          );
        }
        if (vend.status !== "ACTIVE") {
          warnings.push(`Linked supplier is currently ${vend.status}.`);
        }
      }
    }

    await db
      .update(table)
      .set(patchPayload)
      .where(and(eq(table.id, id), eq(table.companyId, companyId)));

    const recordCode = extractRecordCode(existing);
    await AuditService.log({
      req: options?.req,
      userId: options?.userId,
      companyId,
      action: `RESTORE_ARCHIVED_${normType}`,
      entityType: normType,
      entityId: id,
      recordReference: recordCode,
      module: "SYSTEM_ARCHIVE_VAULT",
      beforeData: { status: existing.status },
      afterData: { status: restoredStatus, warnings },
      reason: options?.reason || `Module-aware restore from Archive Inbox back to ${restoredStatus}.`,
      severity: "INFO",
    });

    return {
      id,
      entityType: normType,
      restoredStatus,
      warnings,
      recordCode,
    };
  }

  /**
   * Executes safe transactional permanent deletion with strict dependency & BIR retention guards.
   */
  static async permanentlyDeleteArchivedRecord(
    companyId: string,
    entityType: string,
    id: string,
    options?: {
      req?: any;
      userId?: string;
      reason?: string;
      isAutomatedRetentionSweep?: boolean;
      nowMs?: number;
    }
  ): Promise<{
    deleted: boolean;
    outcome: "PURGED" | "BLOCKED" | "EXEMPT";
    reason: string;
    recordCode: string;
  }> {
    const normType = entityType.toUpperCase();
    const meta = ARCHIVE_ENTITY_REGISTRY[normType];
    if (!meta?.table) {
      throw new DomainError(`Invalid entity type: ${entityType}`, "INVALID_ENTITY", 400);
    }

    const table = meta.table;
    const existing = await db
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.companyId, companyId)))
      .get();

    if (!existing) {
      throw new DomainError("Archived record not found in active company.", "NOT_FOUND", 404);
    }

    const recordCode = extractRecordCode(existing);
    const archivedTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : Date.now();
    const evaluation = await this.evaluatePermanentDeleteEligibility(
      companyId,
      normType,
      existing,
      archivedTime,
      options?.nowMs ?? Date.now()
    );

    if (!evaluation.canPermanentDelete) {
      const outcome = evaluation.retentionState === "EXEMPT" ? "EXEMPT" : "BLOCKED";
      const auditAction = options?.isAutomatedRetentionSweep
        ? `RETENTION_PURGE_${outcome}_${normType}`
        : `BLOCKED_PERMANENT_DELETE_${normType}`;

      await AuditService.log({
        req: options?.req,
        userId: options?.userId || "SYSTEM_RETENTION_SCHEDULER",
        companyId,
        action: auditAction,
        entityType: normType,
        entityId: id,
        recordReference: recordCode,
        module: "SYSTEM_ARCHIVE_VAULT",
        reason: evaluation.retentionReason,
        result: "FAILED",
        severity: "CRITICAL",
      });

      if (!options?.isAutomatedRetentionSweep) {
        throw new DomainError(evaluation.retentionReason, "RETENTION_POLICY_BLOCKED", 403, {
          retentionState: evaluation.retentionState,
          dependencyCount: evaluation.dependencyCount,
          dependencySummary: evaluation.dependencySummary,
        });
      }

      return {
        deleted: false,
        outcome,
        reason: evaluation.retentionReason,
        recordCode,
      };
    }

    await db.transaction(async (tx) => {
      if (normType === "SALES_INVOICE") {
        await tx.delete(schema.salesInvoiceLines).where(eq(schema.salesInvoiceLines.invoiceId, id));
        await tx.delete(schema.customerPaymentApplications).where(eq(schema.customerPaymentApplications.invoiceId, id));
        await tx.delete(schema.creditMemoApplications).where(eq(schema.creditMemoApplications.invoiceId, id));
      } else if (normType === "PURCHASE_BILL") {
        await tx.delete(schema.purchaseBillLines).where(eq(schema.purchaseBillLines.billId, id));
        await tx.delete(schema.supplierPaymentApplications).where(eq(schema.supplierPaymentApplications.billId, id));
        await tx.delete(schema.debitMemoApplications).where(eq(schema.debitMemoApplications.billId, id));
      } else if (normType === "JOURNAL_ENTRY") {
        await tx.delete(schema.journalLines).where(eq(schema.journalLines.journalEntryId, id));
      } else if (normType === "CUSTOMER_PAYMENT") {
        await tx.delete(schema.customerPaymentApplications).where(eq(schema.customerPaymentApplications.paymentId, id));
      } else if (normType === "SUPPLIER_PAYMENT") {
        await tx.delete(schema.supplierPaymentApplications).where(eq(schema.supplierPaymentApplications.paymentId, id));
      } else if (normType === "CREDIT_MEMO") {
        await tx.delete(schema.creditMemoLines).where(eq(schema.creditMemoLines.creditMemoId, id));
        await tx.delete(schema.creditMemoApplications).where(eq(schema.creditMemoApplications.creditMemoId, id));
      } else if (normType === "DEBIT_MEMO") {
        await tx.delete(schema.debitMemoLines).where(eq(schema.debitMemoLines.debitMemoId, id));
        await tx.delete(schema.debitMemoApplications).where(eq(schema.debitMemoApplications.debitMemoId, id));
      } else if (normType === "CASH_TRANSACTION") {
        await tx.delete(schema.cashTransactionLines).where(eq(schema.cashTransactionLines.cashTransactionId, id));
      } else if (normType === "BANK_RECONCILIATION") {
        await tx.delete(schema.bankStatementLines).where(eq(schema.bankStatementLines.bankReconciliationId, id));
        await tx.delete(schema.bankReconciliationAdjustments).where(eq(schema.bankReconciliationAdjustments.bankReconciliationId, id));
      } else if (normType === "PURCHASE_ORDER") {
        await tx.delete(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.poId, id));
      } else if (normType === "GOODS_RECEIPT_NOTE") {
        await tx.delete(schema.goodsReceiptLines).where(eq(schema.goodsReceiptLines.grnId, id));
      } else if (normType === "PAYROLL_RUN") {
        await tx.delete(schema.payrollItems).where(eq(schema.payrollItems.payrollRunId, id));
      }

      await tx.delete(table).where(and(eq(table.id, id), eq(table.companyId, companyId)));
    });

    await AuditService.log({
      req: options?.req,
      userId: options?.userId || "SYSTEM_RETENTION_SCHEDULER",
      companyId,
      action: options?.isAutomatedRetentionSweep
        ? `RETENTION_AUTO_PURGE_${normType}`
        : `PERMANENT_DELETE_ARCHIVED_${normType}`,
      entityType: normType,
      entityId: id,
      recordReference: recordCode,
      module: "SYSTEM_ARCHIVE_VAULT",
      beforeData: existing,
      reason:
        options?.reason ||
        (options?.isAutomatedRetentionSweep
          ? "30-calendar-day archive retention elapsed with zero protected dependencies; automatically purged by backend retention scheduler."
          : "Authorized permanent deletion from Archive Inbox."),
      severity: "CRITICAL",
    });

    return {
      deleted: true,
      outcome: "PURGED",
      reason: "Permanently purged after passing dependency and statutory retention checks.",
      recordCode,
    };
  }
}

/**
 * Independent server-side 30-day archive retention scheduler.
 * Runs independently of frontend sessions, preserves tenant isolation,
 * retries transient lock errors, and protects statutory/referenced records.
 */
export class ArchiveRetentionScheduler {
  private static timerHandle: NodeJS.Timeout | null = null;
  private static isRunning = false;
  private static isEnabledFlag = true;
  private static intervalMs = 6 * 60 * 60 * 1000; // Every 6 hours
  private static inFlightCompanies = new Set<string>();
  private static lastGlobalSweepAt: string | null = null;
  private static lastCompanySummaries = new Map<string, RetentionSweepSummary>();

  public static isEnabled(): boolean {
    return this.isEnabledFlag;
  }

  public static setEnabled(enabled: boolean): void {
    this.isEnabledFlag = enabled;
  }

  public static getStatus(companyId?: string) {
    return {
      enabled: this.isEnabledFlag,
      schedulerActive: Boolean(this.timerHandle),
      retentionDays: ARCHIVE_RETENTION_DAYS,
      intervalHours: this.intervalMs / (1000 * 60 * 60),
      isRunning: this.isRunning,
      lastGlobalSweepAt: this.lastGlobalSweepAt,
      companySummary: companyId ? this.lastCompanySummaries.get(companyId) || null : null,
    };
  }

  /**
   * Executes an idempotent 30-day retention sweep for a single isolated company database.
   */
  public static async runRetentionSweepForCompany(
    companyId: string,
    options?: { nowMs?: number; dryRun?: boolean; userId?: string; maxRetries?: number }
  ): Promise<RetentionSweepSummary> {
    const nowMs = options?.nowMs ?? Date.now();
    const maxRetries = options?.maxRetries ?? 2;

    if (this.inFlightCompanies.has(companyId)) {
      return (
        this.lastCompanySummaries.get(companyId) || {
          companyId,
          ranAt: new Date(nowMs).toISOString(),
          evaluated: 0,
          expiredCount: 0,
          purgedCount: 0,
          blockedCount: 0,
          exemptCount: 0,
          failedCount: 0,
          outcomes: [],
        }
      );
    }

    this.inFlightCompanies.add(companyId);
    const summary: RetentionSweepSummary = {
      companyId,
      ranAt: new Date(nowMs).toISOString(),
      evaluated: 0,
      expiredCount: 0,
      purgedCount: 0,
      blockedCount: 0,
      exemptCount: 0,
      failedCount: 0,
      outcomes: [],
    };

    try {
      const companyDb = await CompanyManager.getCompanyDb(companyId);
      if (!companyDb) {
        return summary;
      }

      await dbContext.run(companyDb as any, async () => {
        const { records } = await ArchiveRetentionService.listArchivedRecords(companyId, { nowMs });
        summary.evaluated = records.length;

        for (const rec of records) {
          if (!rec.isExpired) {
            summary.outcomes.push({
              entityType: rec.entityType,
              entityId: rec.id,
              code: rec.code,
              outcome: "ACTIVE_RETENTION",
              reason: rec.retentionRule,
            });
            continue;
          }

          summary.expiredCount++;

          if (rec.retentionState === "EXEMPT") {
            summary.exemptCount++;
            await this.logDeduplicatedProtectionEvent(companyId, rec, "EXEMPT");
            summary.outcomes.push({
              entityType: rec.entityType,
              entityId: rec.id,
              code: rec.code,
              outcome: "EXEMPT",
              reason: rec.retentionRule,
            });
            continue;
          }

          if (rec.retentionState === "BLOCKED") {
            summary.blockedCount++;
            await this.logDeduplicatedProtectionEvent(companyId, rec, "BLOCKED");
            summary.outcomes.push({
              entityType: rec.entityType,
              entityId: rec.id,
              code: rec.code,
              outcome: "BLOCKED",
              reason: rec.retentionRule,
            });
            continue;
          }

          if (options?.dryRun) {
            summary.outcomes.push({
              entityType: rec.entityType,
              entityId: rec.id,
              code: rec.code,
              outcome: "PURGED",
              reason: "DRY_RUN: Eligible for permanent purge.",
            });
            continue;
          }

          let attempt = 0;
          let handled = false;
          while (attempt <= maxRetries && !handled) {
            try {
              const delRes = await ArchiveRetentionService.permanentlyDeleteArchivedRecord(
                companyId,
                rec.entityType,
                rec.id,
                {
                  isAutomatedRetentionSweep: true,
                  userId: options?.userId || "SYSTEM_RETENTION_SCHEDULER",
                  nowMs,
                }
              );
              if (delRes.outcome === "PURGED") summary.purgedCount++;
              else if (delRes.outcome === "BLOCKED") summary.blockedCount++;
              else if (delRes.outcome === "EXEMPT") summary.exemptCount++;

              summary.outcomes.push({
                entityType: rec.entityType,
                entityId: rec.id,
                code: rec.code,
                outcome: delRes.outcome,
                reason: delRes.reason,
              });
              handled = true;
            } catch (err: any) {
              attempt++;
              const isTransient = String(err?.message || "").includes("SQLITE_BUSY");
              if (attempt > maxRetries || !isTransient) {
                summary.failedCount++;
                summary.outcomes.push({
                  entityType: rec.entityType,
                  entityId: rec.id,
                  code: rec.code,
                  outcome: "FAILED",
                  reason: err?.message || "Retention purge error",
                });
                OperationalLogger.error("ArchiveRetentionScheduler record purge failed", err, {
                  companyId,
                  operation: `RETENTION_PURGE_${rec.entityType}:${rec.id}`,
                });
                handled = true;
              } else {
                await new Promise((r) => setTimeout(r, 150 * attempt));
              }
            }
          }
        }
      });

      this.lastCompanySummaries.set(companyId, summary);
      return summary;
    } catch (err: any) {
      OperationalLogger.error("ArchiveRetentionScheduler company sweep error", err, { companyId });
      summary.failedCount++;
      this.lastCompanySummaries.set(companyId, summary);
      return summary;
    } finally {
      this.inFlightCompanies.delete(companyId);
    }
  }

  private static async logDeduplicatedProtectionEvent(
    companyId: string,
    rec: ArchivedRecordView,
    outcome: "BLOCKED" | "EXEMPT"
  ) {
    const actionName = `RETENTION_PURGE_${outcome}_${rec.entityType}`;
    try {
      const existing = await db
        .select({ id: schema.auditLogs.id })
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.companyId, companyId),
            eq(schema.auditLogs.entityType, rec.entityType),
            eq(schema.auditLogs.entityId, rec.id),
            eq(schema.auditLogs.action, actionName)
          )
        )
        .limit(1)
        .get();

      if (existing) return;

      await AuditService.log({
        userId: "SYSTEM_RETENTION_SCHEDULER",
        companyId,
        action: actionName,
        entityType: rec.entityType,
        entityId: rec.id,
        recordReference: rec.code,
        module: "SYSTEM_ARCHIVE_VAULT",
        reason: rec.retentionRule,
        result: "WARNING",
        severity: "WARN",
      });
    } catch {}
  }

  /**
   * Sweeps all active non-synthetic companies independently of any user session.
   */
  public static async runAllCompaniesSweep(): Promise<RetentionSweepSummary[]> {
    if (this.isRunning || !this.isEnabledFlag) return [];
    this.isRunning = true;
    const results: RetentionSweepSummary[] = [];

    try {
      const companies = await CompanyManager.listCompanies({ includeSynthetic: false });
      for (const comp of companies) {
        if (
          comp.id === "LGR-PH-2026-TEST-00-ABC12345" ||
          comp.id === "LGR-PH-DESKGUARD-SOLUTIONS" ||
          comp.id.includes("OP-AUDIT") ||
          comp.id.includes("PILOT") ||
          comp.id.includes("DEFECT") ||
          comp.id.includes("LGR-LAN-SEC-") ||
          comp.id.includes("LGR-PH-STRESS-") ||
          comp.status === "RECOVERY_READ_ONLY"
        ) {
          continue;
        }
        const res = await this.runRetentionSweepForCompany(comp.id);
        results.push(res);
      }
      this.lastGlobalSweepAt = new Date().toISOString();
    } catch (err: any) {
      OperationalLogger.error("ArchiveRetentionScheduler global sweep error", err);
    } finally {
      this.isRunning = false;
    }

    return results;
  }

  public static startScheduler(intervalMs = 6 * 60 * 60 * 1000): void {
    if (this.timerHandle) return;
    this.intervalMs = intervalMs;

    OperationalLogger.info("ArchiveRetentionScheduler", {
      message: "Starting independent 30-day archive retention background scheduler",
      intervalHours: intervalMs / (1000 * 60 * 60),
    });

    const initTimeout = setTimeout(() => {
      this.runAllCompaniesSweep().catch((err) =>
        OperationalLogger.error("ArchiveRetentionScheduler initial sweep failed", err)
      );
    }, 20000);
    if (typeof initTimeout.unref === "function") {
      initTimeout.unref();
    }

    this.timerHandle = setInterval(() => {
      this.runAllCompaniesSweep().catch((err) =>
        OperationalLogger.error("ArchiveRetentionScheduler interval sweep failed", err)
      );
    }, intervalMs);
    if (typeof this.timerHandle.unref === "function") {
      this.timerHandle.unref();
    }
  }

  public static stopScheduler(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }
}
