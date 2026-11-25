import { db } from "../db";
import * as schema from "../db/schema";
import { normalizeAuditTimestamp, computeAuditSealHash, AuditHmacKeyManager, computeAuditHmacSignature } from "../db/auditSeal";
import { eq, and, desc, gte, lte, like, or, sql } from "drizzle-orm";
import crypto from "crypto";
import fs from "fs";
import { Request } from "express";
import { broadcastNotification } from "../ws";

export type AuditSource = 'WEB_UI' | 'LOCAL_SERVER' | 'IMPORT' | 'API' | 'AI_ASSISTANT' | 'RESTORE' | 'SYSTEM' | 'SCHEDULED_JOB' | 'OFFLINE_SYNC';
export type AuditResult = 'SUCCESS' | 'FAILED' | 'WARNING';
export type AuditSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export interface AuditLogParams {
  req?: Request;
  companyId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  userDisplayName?: string | null;
  role?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityName?: string | null;
  recordReference?: string | null;
  beforeData?: any;
  afterData?: any;
  changedFields?: string[] | string | null;
  reason?: string | null;
  result?: AuditResult;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  source?: AuditSource;
  module?: string | null;
  severity?: AuditSeverity;
  metadata?: any;
}

export interface LastTouchInfo {
  createdBy?: string | null;
  createdById?: string | null;
  createdByRole?: string | null;
  createdAt?: string | Date | null;
  lastModifiedBy?: string | null;
  lastModifiedById?: string | null;
  lastModifiedByRole?: string | null;
  lastModifiedAt?: string | Date | null;
  submittedBy?: string | null;
  submittedById?: string | null;
  submittedByRole?: string | null;
  submittedAt?: string | Date | null;
  lastApprovedBy?: string | null;
  lastApprovedById?: string | null;
  lastApprovedByRole?: string | null;
  lastApprovedAt?: string | Date | null;
  postedBy?: string | null;
  postedById?: string | null;
  postedByRole?: string | null;
  postedAt?: string | Date | null;
  lastActionBy?: string | null;
  lastActionById?: string | null;
  lastActionByRole?: string | null;
  lastActionAt?: string | Date | null;
  lastTouchedBy?: string | null;
  lastTouchedAt?: string | Date | null;
  lastReviewedBy?: string | null;
  lastReviewedAt?: string | Date | null;
  cancelledBy?: string | null;
  cancelledAt?: string | Date | null;
  deletedBy?: string | null;
  deletedAt?: string | Date | null;
  restoredBy?: string | null;
  restoredAt?: string | Date | null;
  reversedBy?: string | null;
  reversedById?: string | null;
  reversedByRole?: string | null;
  reversedAt?: string | Date | null;
  lastAction?: string | null;
  lastResult?: string | null;
  lastReason?: string | null;
  changedFields?: string[] | null;
  totalTouches?: number;
}

const WORKFLOW_METADATA_FIELDS = new Set([
  'status',
  'approvedBy',
  'approvedAt',
  'submittedBy',
  'submittedAt',
  'postedBy',
  'postedAt',
  'reversedAt',
  'journalEntryId',
  'updatedAt',
  'createdAt',
  'rejectionReason',
]);

function isFailedOrDeniedLog(log: any): boolean {
  const res = String(log.result || '').toUpperCase();
  const act = String(log.action || '').toUpperCase();
  if (res === 'FAILED') return true;
  if (
    act.startsWith('FAILED_') ||
    act.startsWith('BLOCKED_') ||
    act.includes('PERMISSION_DENIED') ||
    act.includes('SOD_BLOCKED') ||
    act.includes('LIMIT_EXCEEDED') ||
    act.includes('MASTER_DATA_BLOCKED')
  ) {
    return true;
  }
  return false;
}

function isDataFieldModificationLog(log: any): boolean {
  if (isFailedOrDeniedLog(log)) return false;
  const act = String(log.action || '').toUpperCase();
  const isPureWorkflowTransition =
    act.startsWith('SUBMIT_') ||
    act.startsWith('RESUBMIT_') ||
    act.startsWith('REVIEW_') ||
    act.startsWith('APPROVE_') ||
    act.startsWith('POST_') ||
    act.startsWith('REJECT_') ||
    act.startsWith('RETURN_') ||
    act.startsWith('CANCEL_') ||
    act.startsWith('REVERSE_') ||
    act.startsWith('INITIATE_APPROVAL') ||
    act.startsWith('DELEGATE_APPROVAL') ||
    act.startsWith('REASSIGN_APPROVAL') ||
    act.startsWith('ESCALATE_APPROVAL');

  const nonWorkflowFields = Array.isArray(log.changedFieldsList)
    ? log.changedFieldsList.filter((f: string) => !WORKFLOW_METADATA_FIELDS.has(f))
    : [];

  if (isPureWorkflowTransition) {
    return nonWorkflowFields.length > 0;
  }

  if (
    act.includes('EDIT') ||
    act.includes('UPDATE') ||
    act.includes('MODIFY') ||
    act.includes('CORRECT') ||
    act.includes('REPLACE')
  ) {
    return true;
  }

  return nonWorkflowFields.length > 0;
}

const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'password_hash',
  'jwt_secret',
  'jwt',
  'token',
  'secret',
  'apikey',
  'api_key',
  'sessionsecret',
  'session_secret',
  'creditcard',
  'cardnumber'
];

function sanitizeData(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeData);
  }

  const clean: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some(k => lowerKey.includes(k))) {
      clean[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      clean[key] = sanitizeData(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

export class AuditService {
  private static companyLogQueues = new Map<string, Promise<unknown>>();

  private static enqueueCompanyLog<T>(companyKey: string, task: () => Promise<T>): Promise<T> {
    const prev = this.companyLogQueues.get(companyKey) || Promise.resolve();
    const next = prev.then(task, task);
    const cleanup = next.then(() => undefined, () => undefined);
    this.companyLogQueues.set(companyKey, cleanup);
    cleanup.then(() => {
      if (this.companyLogQueues.get(companyKey) === cleanup) {
        this.companyLogQueues.delete(companyKey);
      }
    });
    return next;
  }

  static normalizeAuditTimestamp(ts: any): Date {
    return normalizeAuditTimestamp(ts);
  }

  static computeSealHash(params: {
    id: string;
    companyId: string | null;
    userId: string | null;
    userDisplayName: string | null;
    userEmail: string | null;
    role: string | null;
    action: string;
    entityType: string;
    entityId: string;
    recordReference: string | null;
    beforeData: string | null;
    afterData: string | null;
    changedFields: string | null;
    result: string;
    ipAddress: string | null;
    timestampIso: string;
    chainVersion?: number;
    sequenceNumber?: number | null;
    previousHash?: string | null;
  }): string {
    return computeAuditSealHash(params);
  }

  /**
   * Log an immutable audit event
   */
  static async log(params: AuditLogParams): Promise<string> {
    const id = `audit-${crypto.randomUUID().slice(0, 12)}`;
    const queueKey = params.companyId ?? params.req?.activeCompany?.id ?? '__SYSTEM__';
    return this.enqueueCompanyLog(queueKey, async () => {
    try {
      // Extract default context from req if present
      const req = params.req;
      const companyId = params.companyId ?? (req?.activeCompany?.id || null);
      let userId = params.userId ?? (req?.user?.id || null);
      let userEmail = params.userEmail ?? (req?.user?.email || null);
      let userDisplayName = params.userDisplayName ?? (req?.user?.displayName || null);
      let role = params.role ?? (req?.activeCompany?.roleName || req?.activeCompany?.role || null);
      
      // If user info is incomplete and userId is available, look it up
      if (userId && (!userDisplayName || !userEmail || !role)) {
        try {
          const u = await db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
          if (u) {
            if (!userDisplayName) userDisplayName = u.displayName || u.email;
            if (!userEmail) userEmail = u.email;
          }
          if (!role && companyId) {
            const cu = await db.select({
              legacyRole: schema.companyUsers.legacyRole,
              roleName: schema.roles.name,
            })
              .from(schema.companyUsers)
              .leftJoin(schema.roles, eq(schema.companyUsers.roleId, schema.roles.id))
              .where(and(
                eq(schema.companyUsers.companyId, companyId),
                eq(schema.companyUsers.userId, userId)
              ))
              .get();
            if (cu) {
              role = cu.roleName || cu.legacyRole || 'Member';
            }
          }
        } catch (e) {
          // Fallback gracefully
        }
      }

      if (!userDisplayName && userEmail) userDisplayName = userEmail;
      if (!userDisplayName && !userId) userDisplayName = 'System Engine';
      if (!role) role = userId ? 'Member' : 'System Engine';

      const ipAddress = params.ipAddress ?? (req?.headers ? (req.headers['x-forwarded-for'] as string || req.ip || null) : null);
      const userAgent = params.userAgent ?? (req?.headers ? (req.headers['user-agent'] || null) : null);
      const requestId = params.requestId ?? (req ? ((req as any).requestId || null) : null);

      const beforeClean = params.beforeData ? sanitizeData(params.beforeData) : null;
      const afterClean = params.afterData ? sanitizeData(params.afterData) : null;
      const metadataClean = params.metadata ? sanitizeData(params.metadata) : null;

      let changedFieldsList: string[] = [];
      if (Array.isArray(params.changedFields)) {
        changedFieldsList = params.changedFields;
      } else if (typeof params.changedFields === 'string') {
        try {
          changedFieldsList = JSON.parse(params.changedFields);
        } catch {
          changedFieldsList = [params.changedFields];
        }
      } else if (beforeClean && afterClean && typeof beforeClean === 'object' && typeof afterClean === 'object') {
        const allKeys = new Set([...Object.keys(beforeClean), ...Object.keys(afterClean)]);
        for (const k of allKeys) {
          if (JSON.stringify(beforeClean[k]) !== JSON.stringify(afterClean[k])) {
            changedFieldsList.push(k);
          }
        }
      }

      const changedFieldsStr = changedFieldsList.length > 0 ? JSON.stringify(changedFieldsList) : null;
      const beforeDataStr = beforeClean ? JSON.stringify(beforeClean) : null;
      const afterDataStr = afterClean ? JSON.stringify(afterClean) : null;
      const resultStr = params.result || 'SUCCESS';
      const recordRefStr = params.recordReference || null;

      // Validate foreign keys (companyId and userId) exist in DB to prevent FOREIGN KEY constraint failures
      let validCompanyId: string | null = null;
      if (companyId) {
        try {
          const comp = await db.select({ id: schema.companies.id }).from(schema.companies).where(eq(schema.companies.id, companyId)).get();
          if (comp) validCompanyId = companyId;
        } catch {}
      }

      let validUserId: string | null = null;
      if (userId) {
        try {
          const usr = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).get();
          if (usr) validUserId = userId;
        } catch {}
      }

      // Normalize timestamp to whole-second precision to match SQLite integer(mode:'timestamp') storage
      const now = new Date(Math.floor(Date.now() / 1000) * 1000);

      let sequenceNumber: number | null = null;
      let previousHash: string | null = null;
      let chainVersion = 1;

      if (validCompanyId) {
        chainVersion = 2;
        try {
          const prevChainedRows = await db
            .select({ metadata: schema.auditLogs.metadata })
            .from(schema.auditLogs)
            .where(eq(schema.auditLogs.companyId, validCompanyId))
            .orderBy(desc(sql`rowid`))
            .limit(50);

          let prevSeq = 0;
          let prevHash: string | null = null;
          for (const prevRow of prevChainedRows) {
            if (!prevRow.metadata) continue;
            try {
              const pm = typeof prevRow.metadata === 'string' ? JSON.parse(prevRow.metadata) : prevRow.metadata;
              if (pm && typeof pm.integritySeal === 'string' && pm.integritySeal) {
                if (typeof pm.sequenceNumber === 'number' && pm.chainVersion >= 2) {
                  prevSeq = pm.sequenceNumber;
                  prevHash = pm.integritySeal;
                  break;
                }
                if (!prevHash) {
                  prevHash = pm.integritySeal;
                }
              }
            } catch {
              // ignore unparseable legacy metadata
            }
          }
          sequenceNumber = prevSeq + 1;
          previousHash = prevHash || 'GENESIS';
        } catch {
          sequenceNumber = 1;
          previousHash = 'GENESIS';
        }
      }

      const integritySeal = this.computeSealHash({
        id,
        companyId: validCompanyId,
        userId: validUserId,
        userDisplayName: userDisplayName || null,
        userEmail: userEmail || null,
        role: role || null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        recordReference: recordRefStr,
        beforeData: beforeDataStr,
        afterData: afterDataStr,
        changedFields: changedFieldsStr,
        result: resultStr,
        ipAddress: ipAddress || null,
        timestampIso: now.toISOString(),
        chainVersion,
        sequenceNumber,
        previousHash,
      });

      let hmacFields: Record<string, any> = {};
      if (validCompanyId && chainVersion >= 2) {
        try {
          const signingKey = AuditHmacKeyManager.getActiveSigningKeySync(validCompanyId, 'SYSTEM_AUDIT_SEALER');
          const hmacSeal = computeAuditHmacSignature({
            integritySeal,
            companyId: validCompanyId,
            sequenceNumber,
            previousHash,
            keyVersion: signingKey.keyVersion,
            secret: signingKey.secret,
          });
          hmacFields = {
            hmacKeyId: signingKey.keyId,
            hmacKeyVersion: signingKey.keyVersion,
            hmacSeal,
          };
        } catch {
          // Graceful fallback if keyring cannot be written in read-only sandbox
        }
      }

      const chainFields =
        chainVersion >= 2
          ? { chainVersion, sequenceNumber, previousHash, integritySeal, ...hmacFields }
          : { integritySeal };

      const mergedMetadata: Record<string, any> =
        metadataClean && typeof metadataClean === 'object' && !Array.isArray(metadataClean)
          ? { ...metadataClean, ...chainFields }
          : metadataClean !== null && metadataClean !== undefined
            ? { payload: metadataClean, ...chainFields }
            : chainFields;
      const metadataStr = JSON.stringify(mergedMetadata);

      await db.insert(schema.auditLogs).values({
        id,
        companyId: validCompanyId,
        userId: validUserId,
        userEmail,
        userDisplayName,
        role,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        entityName: params.entityName || null,
        recordReference: recordRefStr,
        beforeData: beforeDataStr,
        afterData: afterDataStr,
        changedFields: changedFieldsStr,
        reason: params.reason || null,
        result: resultStr,
        ipAddress,
        userAgent,
        requestId,
        source: params.source || 'WEB_UI',
        module: params.module || params.entityType,
        severity: params.severity || (params.result === 'FAILED' ? 'ERROR' : 'INFO'),
        metadata: metadataStr,
        timestamp: now,
      });

      // Real-Time Notification Trigger for Critical Changes & Role Modifications
      if (companyId) {
        const act = params.action.toUpperCase();
        const isRoleChange = act.includes('ROLE') || params.module === 'RBAC' || params.entityType === 'MEMBERSHIP';
        const isCriticalSetting = 
          act.includes('UPDATE_LOCK_DATE') || 
          act.includes('HARD_CLOSE') || 
          act.includes('REOPEN_PERIOD') ||
          act.includes('LOCK_TAX') ||
          (act.includes('COMPANY') && changedFieldsList.some(f => ['tin', 'vatStatus', 'taxpayerClassification', 'documentLocationPath', 'backupLocationPath', 'legalName', 'rdoCode'].includes(f)));

        if (isRoleChange || isCriticalSetting) {
          let alertTitle = 'Security Alert: Role / Access Modified';
          let alertMessage = `${userDisplayName || 'User'} updated roles for ${params.entityName || params.recordReference || 'a member'}.`;

          if (act.includes('UPDATE_LOCK_DATE')) {
            alertTitle = 'Critical Notice: Accounting Lock Date Changed';
            alertMessage = `${userDisplayName || 'User'} updated the company lock date to ${afterClean?.lockDate || 'unlocked'}.`;
          } else if (act.includes('HARD_CLOSE')) {
            alertTitle = 'Critical Notice: Accounting Period Hard-Closed';
            alertMessage = `${userDisplayName || 'User'} locked and hard-closed accounting period ${params.entityId}.`;
          } else if (act.includes('REOPEN_PERIOD')) {
            alertTitle = 'Critical Notice: Accounting Period Reopened';
            alertMessage = `${userDisplayName || 'User'} reopened closed period ${params.entityId}. Reason: ${params.reason || 'Not specified'}.`;
          } else if (act.includes('LOCK_TAX')) {
            alertTitle = 'Critical Notice: Tax Filing Period Locked';
            alertMessage = `${userDisplayName || 'User'} locked tax filing period ${params.entityId}.`;
          } else if (isCriticalSetting) {
            alertTitle = 'Critical Notice: Company Profile/TIN/VAT Modified';
            alertMessage = `${userDisplayName || 'User'} updated critical company settings: [${changedFieldsList.join(', ')}].`;
          }

          broadcastNotification({
            companyId,
            title: alertTitle,
            message: alertMessage,
            type: 'SYSTEM',
            entityType: params.entityType,
            entityId: params.entityId,
            metadata: {
              action: params.action,
              userDisplayName,
              role,
              changedFields: changedFieldsList,
              auditLogId: id
            }
          }).catch(err => console.error('[WebSocket Alert Error]:', err));
        } else {
          // Standard Audit Log Event Notification
          broadcastNotification({
            companyId,
            title: `Audit: ${params.action.replace(/_/g, ' ')}`,
            message: `${userDisplayName || 'User'} (${role || 'Member'}) executed ${params.action.replace(/_/g, ' ')} on ${params.entityName || params.entityType}.`,
            type: 'AUDIT_LOG',
            entityType: params.entityType,
            entityId: params.entityId,
            metadata: { auditLogId: id }
          }).catch(() => {});
        }
      }

      return id;
    } catch (error) {
      console.error('[AuditService.log Error]:', error);
      return id;
    }
    });
  }

  /**
   * Build matching entityType variants (e.g. JOURNAL_ENTRY, journal_entries, journal_entry)
   */
  static getEntityTypeVariants(entityType: string): string[] {
    const raw = (entityType || '').trim();
    const upper = raw.toUpperCase();
    const lower = raw.toLowerCase();
    const variants = new Set<string>([raw, upper, lower, `${lower}s`, `${upper}S`]);
    const map: Record<string, string[]> = {
      JOURNAL_ENTRY: ['JOURNAL_ENTRY', 'journal_entries', 'journal_entry', 'JournalEntry'],
      SALES_INVOICE: ['SALES_INVOICE', 'sales_invoices', 'sales_invoice', 'SalesInvoice'],
      PURCHASE_BILL: ['PURCHASE_BILL', 'purchase_bills', 'purchase_bill', 'PurchaseBill'],
      CUSTOMER_PAYMENT: ['CUSTOMER_PAYMENT', 'customer_payments', 'customer_payment'],
      SUPPLIER_PAYMENT: ['SUPPLIER_PAYMENT', 'supplier_payments', 'supplier_payment'],
      CREDIT_MEMO: ['CREDIT_MEMO', 'credit_memos', 'credit_memo'],
      DEBIT_MEMO: ['DEBIT_MEMO', 'debit_memos', 'debit_memo'],
      CASH_TRANSACTION: ['CASH_TRANSACTION', 'cash_transactions', 'cash_transaction'],
      BANK_DEPOSIT: ['BANK_DEPOSIT', 'bank_deposits', 'bank_deposit'],
      BANK_RECONCILIATION: ['BANK_RECONCILIATION', 'bank_reconciliations', 'bank_reconciliation'],
      PURCHASE_ORDER: ['PURCHASE_ORDER', 'purchase_orders', 'purchase_order'],
      GOODS_RECEIPT_NOTE: ['GOODS_RECEIPT_NOTE', 'goods_receipt_notes', 'goods_receipt_note'],
      INVENTORY_ITEM: ['INVENTORY_ITEM', 'inventory_items', 'inventory_item'],
      STOCK_ADJUSTMENT: ['STOCK_ADJUSTMENT', 'stock_adjustments', 'stock_adjustment'],
      FIXED_ASSET: ['FIXED_ASSET', 'fixed_assets', 'fixed_asset'],
      PAYROLL_RUN: ['PAYROLL_RUN', 'payroll_runs', 'payroll_run'],
      EMPLOYEE: ['EMPLOYEE', 'employees', 'employee'],
      BUDGET: ['BUDGET', 'budgets', 'budget'],
      TAX_FILING: ['TAX_FILING', 'tax_filings', 'tax_filing'],
      AUDIT_ENGAGEMENT: ['AUDIT_ENGAGEMENT', 'audit_engagements', 'audit_engagement'],
      AUDIT_WORKPAPER: ['AUDIT_WORKPAPER', 'audit_workpapers', 'audit_workpaper'],
      AUDIT_FINDING: ['AUDIT_FINDING', 'audit_findings', 'audit_finding'],
      DOCUMENT: ['DOCUMENT', 'documents', 'document'],
      CUSTOMER: ['CUSTOMER', 'customers', 'customer'],
      VENDOR: ['VENDOR', 'vendors', 'vendor'],
      ACCOUNT: ['ACCOUNT', 'accounts', 'account'],
      LEDGER_DATA_ENTRY: ['LEDGER_DATA_ENTRY', 'ledger_data_entry', 'ALPHALIST'],
    };
    for (const [canon, list] of Object.entries(map)) {
      if (upper === canon || list.some(x => x.toUpperCase() === upper)) {
        for (const item of list) variants.add(item);
      }
    }
    return Array.from(variants);
  }

  /**
   * Get the last activity touch and complete ownership matrix for a specific record.
   * CRITICAL: Failed/denied events never overwrite actor attribution; submittedBy, approvedBy, and postedBy are strictly separated;
   * lastModifiedBy only advances on real data-field edits.
   */
  static async getLastActivity(entityType: string, entityId: string, companyId: string): Promise<LastTouchInfo | null> {
    const allLogs = await this.getActivityHistory(entityType, entityId, companyId, 500, 0);

    if (!allLogs || allLogs.length === 0) {
      return null;
    }

    const validLogs = allLogs.filter(l => !isFailedOrDeniedLog(l));
    if (validLogs.length === 0) {
      return null;
    }

    const latest = validLogs[0];
    const createdLog = [...validLogs].reverse().find(l => {
      const act = l.action.toUpperCase();
      return act.includes('CREATE') || act.includes('UPLOAD') || act.includes('COPY') || act.includes('ISSUE');
    });

    const modifiedLog = validLogs.find(l => isDataFieldModificationLog(l)) || createdLog;

    const submittedLog = validLogs.find(l => {
      const act = l.action.toUpperCase();
      return (act.includes('SUBMIT') || act.includes('RESUBMIT')) && !act.includes('INITIATE');
    });

    const approvedLog = validLogs.find(l => {
      const act = l.action.toUpperCase();
      return act.includes('APPROVE') && !act.includes('INITIATE') && !act.includes('DELEGATE') && !act.includes('REASSIGN') && !act.includes('ESCALATE');
    });

    const postedLog = validLogs.find(l => {
      const act = l.action.toUpperCase();
      return act.startsWith('POST_') || act === 'POST' || act.includes('_POST_');
    });

    const reviewedLog = validLogs.find(l => {
      const act = l.action.toUpperCase();
      return act.includes('REVIEW') || act.includes('REJECT') || act.includes('RETURN') || (act.includes('APPROVE') && !act.includes('INITIATE'));
    });

    const cancelledLog = validLogs.find(l => {
      const act = l.action.toUpperCase();
      return act.includes('CANCEL') || act.includes('VOID');
    });

    const deletedLog = validLogs.find(l => {
      const act = l.action.toUpperCase();
      return act.includes('DELETE') || act.includes('REMOVE');
    });

    const restoredLog = validLogs.find(l => l.action.toUpperCase().includes('RESTORE'));
    const reversedLog = validLogs.find(l => l.action.toUpperCase().includes('REVERSE'));

    return {
      createdBy: createdLog ? (createdLog.userDisplayName || createdLog.userEmail || null) : null,
      createdById: createdLog ? (createdLog.userId || null) : null,
      createdByRole: createdLog ? (createdLog.role || null) : null,
      createdAt: createdLog ? createdLog.timestamp : null,
      lastModifiedBy: modifiedLog ? (modifiedLog.userDisplayName || modifiedLog.userEmail || null) : null,
      lastModifiedById: modifiedLog ? (modifiedLog.userId || null) : null,
      lastModifiedByRole: modifiedLog ? (modifiedLog.role || null) : null,
      lastModifiedAt: modifiedLog ? modifiedLog.timestamp : null,
      submittedBy: submittedLog ? (submittedLog.userDisplayName || submittedLog.userEmail) : null,
      submittedById: submittedLog ? submittedLog.userId : null,
      submittedByRole: submittedLog ? submittedLog.role : null,
      submittedAt: submittedLog ? submittedLog.timestamp : null,
      lastApprovedBy: approvedLog ? (approvedLog.userDisplayName || approvedLog.userEmail) : null,
      lastApprovedById: approvedLog ? approvedLog.userId : null,
      lastApprovedByRole: approvedLog ? approvedLog.role : null,
      lastApprovedAt: approvedLog ? approvedLog.timestamp : null,
      postedBy: postedLog ? (postedLog.userDisplayName || postedLog.userEmail) : null,
      postedById: postedLog ? postedLog.userId : null,
      postedByRole: postedLog ? postedLog.role : null,
      postedAt: postedLog ? postedLog.timestamp : null,
      lastActionBy: latest.userDisplayName || latest.userEmail || null,
      lastActionById: latest.userId || null,
      lastActionByRole: latest.role || null,
      lastActionAt: latest.timestamp,
      lastTouchedBy: latest.userDisplayName || latest.userEmail || null,
      lastTouchedAt: latest.timestamp,
      lastReviewedBy: reviewedLog ? (reviewedLog.userDisplayName || reviewedLog.userEmail) : null,
      lastReviewedAt: reviewedLog ? reviewedLog.timestamp : null,
      cancelledBy: cancelledLog ? (cancelledLog.userDisplayName || cancelledLog.userEmail) : null,
      cancelledAt: cancelledLog ? cancelledLog.timestamp : null,
      deletedBy: deletedLog ? (deletedLog.userDisplayName || deletedLog.userEmail) : null,
      deletedAt: deletedLog ? deletedLog.timestamp : null,
      restoredBy: restoredLog ? (restoredLog.userDisplayName || restoredLog.userEmail) : null,
      restoredAt: restoredLog ? restoredLog.timestamp : null,
      reversedBy: reversedLog ? (reversedLog.userDisplayName || reversedLog.userEmail) : null,
      reversedById: reversedLog ? reversedLog.userId : null,
      reversedByRole: reversedLog ? reversedLog.role : null,
      reversedAt: reversedLog ? reversedLog.timestamp : null,
      lastAction: latest.action,
      lastResult: latest.result,
      lastReason: latest.reason,
      changedFields: latest.changedFieldsList || null,
      totalTouches: allLogs.length,
    };
  }

  /**
   * Count total audit log rows for a specific record (used for bounded pagination)
   */
  static async getActivityHistoryCount(entityType: string, entityId: string, companyId: string): Promise<number> {
    const variants = this.getEntityTypeVariants(entityType);
    const typeConditions = variants.map(v => eq(schema.auditLogs.entityType, v));
    const rows = await db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.companyId, companyId),
          eq(schema.auditLogs.entityId, entityId),
          typeConditions.length > 1 ? or(...typeConditions)! : typeConditions[0]
        )
      );
    return new Set(rows.map(r => r.id)).size;
  }

  /**
   * Get complete activity history for a specific record with user/role/diff/hash enrichment, bounded pagination, and deduplication
   */
  static async getActivityHistory(entityType: string, entityId: string, companyId: string, limit = 100, offset = 0) {
    const variants = this.getEntityTypeVariants(entityType);
    const typeConditions = variants.map(v => eq(schema.auditLogs.entityType, v));

    const rawLogsFetched = await db.select()
      .from(schema.auditLogs)
      .where(and(
        eq(schema.auditLogs.companyId, companyId),
        eq(schema.auditLogs.entityId, entityId),
        typeConditions.length > 1 ? or(...typeConditions)! : typeConditions[0]
      ))
      .orderBy(desc(sql`rowid`))
      .limit(Math.max(1, Math.min(limit, 1000)))
      .offset(Math.max(0, offset));

    // Deduplicate by log id
    const seenLogIds = new Set<string>();
    const rawLogs = rawLogsFetched.filter(l => {
      if (seenLogIds.has(l.id)) return false;
      seenLogIds.add(l.id);
      return true;
    });

    // Enrich user names and roles
    const usersList = await db.select().from(schema.users);
    const companyUsersList = await db.select({
      userId: schema.companyUsers.userId,
      legacyRole: schema.companyUsers.legacyRole,
      roleName: schema.roles.name,
    })
      .from(schema.companyUsers)
      .leftJoin(schema.roles, eq(schema.companyUsers.roleId, schema.roles.id))
      .where(eq(schema.companyUsers.companyId, companyId));

    const userMap = new Map<string, { displayName: string; email: string; role: string }>();
    for (const u of usersList) {
      const cu = companyUsersList.find(c => c.userId === u.id);
      userMap.set(u.id, {
        displayName: u.displayName || u.email,
        email: u.email,
        role: cu?.roleName || cu?.legacyRole || 'Member',
      });
    }

    const normalizeTs = (ts: any) => {
      if (!ts) return new Date();
      if (ts instanceof Date) {
        if (ts.getFullYear() > 3000) {
          return new Date(Math.floor(ts.getTime() / 1000));
        }
        return ts;
      }
      const num = Number(ts);
      if (!isNaN(num)) {
        return num > 100000000000 ? new Date(num) : new Date(num * 1000);
      }
      return new Date(ts);
    };

    return rawLogs.map((log, idx) => {
      let displayName = log.userDisplayName;
      let email = log.userEmail;
      let userRole = log.role;

      if (log.userId && userMap.has(log.userId)) {
        const info = userMap.get(log.userId)!;
        if (!displayName || displayName === log.userId) displayName = info.displayName;
        if (!email) email = info.email;
        if (!userRole || userRole === 'System') userRole = info.role;
      }

      if (!displayName) displayName = log.userId ? log.userId : 'System Engine';
      if (!userRole) userRole = log.userId ? 'Member' : 'System';

      const normalizedDate = normalizeTs(log.timestamp);

      let parsedFields: string[] = [];
      if (log.changedFields) {
        try {
          parsedFields = JSON.parse(log.changedFields);
        } catch {
          parsedFields = [log.changedFields];
        }
      }

      let beforeObj: any = null;
      let afterObj: any = null;
      try { if (log.beforeData) beforeObj = JSON.parse(log.beforeData); } catch {}
      try { if (log.afterData) afterObj = JSON.parse(log.afterData); } catch {}

      if (parsedFields.length === 0 && beforeObj && afterObj && typeof beforeObj === 'object' && typeof afterObj === 'object') {
        const allKeys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
        for (const k of allKeys) {
          if (JSON.stringify(beforeObj[k]) !== JSON.stringify(afterObj[k])) {
            parsedFields.push(k);
          }
        }
      }

      const fieldDiffs: Array<{ field: string; before: any; after: any }> = [];
      if (beforeObj && afterObj && typeof beforeObj === 'object' && typeof afterObj === 'object') {
        const allKeys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
        for (const k of allKeys) {
          if (k === 'updatedAt' || k === 'createdAt') continue;
          if (JSON.stringify(beforeObj[k]) !== JSON.stringify(afterObj[k])) {
            fieldDiffs.push({
              field: k,
              before: beforeObj[k],
              after: afterObj[k]
            });
          }
        }
      }

      const verification = AuditService.verifyIntegrity(log);
      const displaySeal = verification.expectedSeal || verification.hash;

      return {
        ...log,
        _rowOrder: idx,
        userDisplayName: displayName,
        userEmail: email,
        role: userRole,
        timestamp: normalizedDate,
        changedFieldsList: parsedFields,
        fieldDiffs,
        previousStatus: beforeObj?.status || null,
        newStatus: afterObj?.status || null,
        integrityHash: displaySeal,
        hashShort: displaySeal.substring(0, 16).toUpperCase(),
        verified: verification.verified,
        tampered: !verification.verified,
      };
    }).sort((a, b) => {
      const diff = Math.floor(b.timestamp.getTime() / 1000) - Math.floor(a.timestamp.getTime() / 1000);
      if (diff !== 0) return diff;
      return a._rowOrder - b._rowOrder;
    });
  }

  /**
   * Filter and search audit logs with company isolation and user/role/diff enrichment
   */
  static async searchLogs(params: {
    companyId: string;
    userId?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    dateFrom?: string;
    dateTo?: string;
    severity?: string;
    result?: string;
    source?: string;
    module?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions = [eq(schema.auditLogs.companyId, params.companyId)];

    if (params.userId) {
      conditions.push(eq(schema.auditLogs.userId, params.userId));
    }
    if (params.action) {
      conditions.push(eq(schema.auditLogs.action, params.action));
    }
    if (params.entityType) {
      conditions.push(eq(schema.auditLogs.entityType, params.entityType));
    }
    if (params.entityId) {
      conditions.push(eq(schema.auditLogs.entityId, params.entityId));
    }
    if (params.severity) {
      conditions.push(eq(schema.auditLogs.severity, params.severity));
    }
    if (params.result) {
      conditions.push(eq(schema.auditLogs.result, params.result));
    }
    if (params.source) {
      conditions.push(eq(schema.auditLogs.source, params.source));
    }
    if (params.module) {
      conditions.push(eq(schema.auditLogs.module, params.module));
    }

    if (params.dateFrom) {
      const fromDate = new Date(params.dateFrom);
      if (!isNaN(fromDate.getTime())) {
        conditions.push(gte(schema.auditLogs.timestamp, fromDate));
      }
    }

    if (params.dateTo) {
      const toDate = new Date(params.dateTo);
      if (!isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        conditions.push(lte(schema.auditLogs.timestamp, toDate));
      }
    }

    if (params.search) {
      const term = `%${params.search}%`;
      conditions.push(
        or(
          like(schema.auditLogs.action, term),
          like(schema.auditLogs.entityType, term),
          like(schema.auditLogs.entityId, term),
          like(schema.auditLogs.userDisplayName, term),
          like(schema.auditLogs.userEmail, term),
          like(schema.auditLogs.recordReference, term),
          like(schema.auditLogs.reason, term)
        )!
      );
    }

    const limit = params.limit || 100;
    const offset = params.offset || 0;

    const rawLogs = await db.select()
      .from(schema.auditLogs)
      .where(and(...conditions))
      .orderBy(desc(schema.auditLogs.timestamp), desc(sql`rowid`))
      .limit(limit)
      .offset(offset);

    // Look up missing user info across returned logs
    const missingUserIds = [...new Set(
      rawLogs
        .filter(l => (!l.userDisplayName || !l.role || l.userDisplayName === l.userId) && l.userId)
        .map(l => l.userId as string)
    )];

    const userMap = new Map<string, { displayName: string; email: string; role: string }>();

    if (missingUserIds.length > 0) {
      try {
        const usersList = await db.select().from(schema.users);
        const companyUsersList = await db.select({
          userId: schema.companyUsers.userId,
          legacyRole: schema.companyUsers.legacyRole,
          roleName: schema.roles.name,
        })
          .from(schema.companyUsers)
          .leftJoin(schema.roles, eq(schema.companyUsers.roleId, schema.roles.id))
          .where(eq(schema.companyUsers.companyId, params.companyId));

        for (const u of usersList) {
          const cu = companyUsersList.find(c => c.userId === u.id);
          userMap.set(u.id, {
            displayName: u.displayName || u.email,
            email: u.email,
            role: cu?.roleName || cu?.legacyRole || 'Member',
          });
        }
      } catch (err) {
        // Continue with available data
      }
    }

    // Normalize and enrich every log entry
    return rawLogs.map(log => {
      let displayName = log.userDisplayName;
      let email = log.userEmail;
      let userRole = log.role;

      if (log.userId && userMap.has(log.userId)) {
        const info = userMap.get(log.userId)!;
        if (!displayName || displayName === log.userId) displayName = info.displayName;
        if (!email) email = info.email;
        if (!userRole || userRole === 'System') userRole = info.role;
      }

      if (!displayName) displayName = log.userId ? 'Authorized User' : 'System Engine';
      if (!userRole) userRole = log.userId ? 'Member' : 'System';

      // Normalize timestamp (correct any year overflow from epoch unit confusion)
      let normalizedDate = log.timestamp;
      if (log.timestamp instanceof Date) {
        if (log.timestamp.getFullYear() > 3000) {
          normalizedDate = new Date(Math.floor(log.timestamp.getTime() / 1000));
        }
      } else if (typeof log.timestamp === 'number') {
        normalizedDate = log.timestamp > 100000000000
          ? new Date(log.timestamp)
          : new Date(log.timestamp * 1000);
      }

      // Parse changedFields if string
      let parsedFields: string[] = [];
      if (log.changedFields) {
        try {
          parsedFields = JSON.parse(log.changedFields);
        } catch {
          parsedFields = [log.changedFields];
        }
      }

      const verification = AuditService.verifyIntegrity(log);
      const displaySeal = verification.expectedSeal || verification.hash;

      return {
        ...log,
        userDisplayName: displayName,
        userEmail: email,
        role: userRole,
        timestamp: normalizedDate,
        changedFieldsList: parsedFields,
        integrityHash: displaySeal,
        hashShort: displaySeal.substring(0, 16).toUpperCase(),
        verified: verification.verified,
        tampered: !verification.verified,
      };
    });
  }

  /**
   * Cryptographically verify an individual audit log (fail-closed if seal is missing)
   */
  static verifyIntegrity(log: any): {
    verified: boolean;
    hash: string;
    expectedSeal?: string;
    chainVersion?: number;
    sequenceNumber?: number | null;
    previousHash?: string | null;
    reason?: string;
  } {
    const rawDate = this.normalizeAuditTimestamp(log.timestamp);
    const ts = rawDate.toISOString();

    let meta: any = null;
    if (log.metadata) {
      try {
        meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
      } catch {
        return {
          verified: false,
          hash: '',
          expectedSeal: undefined,
          reason: 'CORRUPT_METADATA_JSON',
        };
      }
    }

    const chainVersion = meta && typeof meta.chainVersion === 'number' ? meta.chainVersion : 1;
    const sequenceNumber = meta && typeof meta.sequenceNumber === 'number' ? meta.sequenceNumber : null;
    const previousHash = meta && typeof meta.previousHash === 'string' ? meta.previousHash : null;

    const hash = this.computeSealHash({
      id: log.id,
      companyId: log.companyId ?? null,
      userId: log.userId ?? null,
      userDisplayName: log.userDisplayName ?? null,
      userEmail: log.userEmail ?? null,
      role: log.role ?? null,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      recordReference: log.recordReference ?? null,
      beforeData: log.beforeData ?? null,
      afterData: log.afterData ?? null,
      changedFields: log.changedFields ?? null,
      result: log.result,
      ipAddress: log.ipAddress ?? null,
      timestampIso: ts,
      chainVersion,
      sequenceNumber,
      previousHash,
    });

    const metaSeal =
      meta && typeof meta.integritySeal === 'string' && meta.integritySeal
        ? meta.integritySeal
        : undefined;
    const expectedSeal =
      metaSeal ||
      (log.metadata === undefined && typeof log.integrityHash === 'string' && log.integrityHash
        ? log.integrityHash
        : undefined);

    if (!expectedSeal) {
      return {
        verified: false,
        hash,
        expectedSeal: undefined,
        chainVersion,
        sequenceNumber,
        previousHash,
        reason: 'MISSING_INTEGRITY_SEAL',
      };
    }

    if (hash !== expectedSeal) {
      return {
        verified: false,
        hash,
        expectedSeal,
        chainVersion,
        sequenceNumber,
        previousHash,
        reason: 'SEAL_HASH_MISMATCH',
      };
    }

    const hasHmacSeal = Boolean(meta && typeof meta.hmacSeal === 'string' && meta.hmacSeal);
    if (chainVersion >= 2 && log.companyId && !hasHmacSeal) {
      const keyringPath = AuditHmacKeyManager.getKeyringFilePath(log.companyId);
      if (fs.existsSync(keyringPath)) {
        return {
          verified: false,
          hash,
          expectedSeal,
          chainVersion,
          sequenceNumber,
          previousHash,
          reason: 'MISSING_HMAC_SEAL',
        };
      }
    }

    if (hasHmacSeal && log.companyId) {
      const keyVersion = typeof meta.hmacKeyVersion === 'number' ? meta.hmacKeyVersion : 1;
      const keyLookup = AuditHmacKeyManager.getVerificationKeySync(log.companyId, keyVersion, 'SYSTEM_AUDIT_VERIFIER');
      if (!keyLookup.available) {
        return {
          verified: false,
          hash,
          expectedSeal,
          chainVersion,
          sequenceNumber,
          previousHash,
          reason: keyLookup.reason || 'HMAC_KEY_UNAVAILABLE',
        };
      }
      if (keyLookup.compromised) {
        return {
          verified: false,
          hash,
          expectedSeal,
          chainVersion,
          sequenceNumber,
          previousHash,
          reason: 'HMAC_KEY_COMPROMISED',
        };
      }
      const expectedHmac = computeAuditHmacSignature({
        integritySeal: expectedSeal,
        companyId: log.companyId,
        sequenceNumber,
        previousHash,
        keyVersion,
        secret: keyLookup.secret!,
      });
      if (expectedHmac !== meta.hmacSeal) {
        return {
          verified: false,
          hash,
          expectedSeal,
          chainVersion,
          sequenceNumber,
          previousHash,
          reason: 'HMAC_SIGNATURE_MISMATCH',
        };
      }
    }

    return {
      verified: true,
      hash,
      expectedSeal,
      chainVersion,
      sequenceNumber,
      previousHash,
      reason: undefined,
    };
  }

  /**
   * Verify full per-company audit log hash chain & seal continuity in insertion (rowid ASC) order
   */
  static async verifyAuditChain(companyId: string): Promise<{
    verified: boolean;
    totalLogs: number;
    verifiedLogs: number;
    v2ChainedLogs: number;
    legacyLogs: number;
    anomalies: Array<{ logId: string; type: string; sequenceNumber?: number | null; details: string }>;
  }> {
    const rows = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.companyId, companyId))
      .orderBy(sql`rowid ASC`);

    const anomalies: Array<{ logId: string; type: string; sequenceNumber?: number | null; details: string }> = [];
    let verifiedLogs = 0;
    let v2ChainedLogs = 0;
    let legacyLogs = 0;

    let v2Started = false;
    let lastV2Seq = 0;
    let lastV2Seal: string | null = null;
    let lastAnySeal: string | null = null;

    for (const row of rows) {
      let meta: any = null;
      let metadataCorrupt = false;
      if (row.metadata) {
        try {
          meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        } catch {
          metadataCorrupt = true;
        }
      }

      if (metadataCorrupt) {
        anomalies.push({
          logId: row.id,
          type: 'CORRUPT_METADATA_JSON',
          details: `Audit log ${row.id} has corrupted metadata JSON.`,
        });
        continue;
      }

      const isAuditServiceRow = typeof row.id === 'string' && row.id.startsWith('audit-');
      const hasSeal = Boolean(meta && typeof meta.integritySeal === 'string' && meta.integritySeal);
      const isV2 = Boolean(meta && typeof meta.chainVersion === 'number' && meta.chainVersion >= 2);

      if (!hasSeal && !isV2 && !v2Started && !isAuditServiceRow) {
        legacyLogs++;
        continue;
      }

      const check = this.verifyIntegrity(row);
      if (!check.verified) {
        anomalies.push({
          logId: row.id,
          type: check.reason || 'SEAL_HASH_MISMATCH',
          sequenceNumber: check.sequenceNumber ?? null,
          details:
            check.reason === 'MISSING_INTEGRITY_SEAL'
              ? `Audit log ${row.id} is missing its SHA-256 integritySeal.`
              : `Audit log ${row.id} SHA-256 integritySeal mismatch (expected ${check.expectedSeal?.slice(0, 16)}, computed ${check.hash.slice(0, 16)}).`,
        });
      } else {
        verifiedLogs++;
      }

      if (isV2) {
        v2ChainedLogs++;
        const seq = Number(check.sequenceNumber || 0);
        const prevHash = check.previousHash || '';

        if (!v2Started) {
          v2Started = true;
          if (seq !== 1) {
            anomalies.push({
              logId: row.id,
              type: 'CHAIN_GENESIS_MISSING',
              sequenceNumber: seq,
              details: `First chained audit log ${row.id} has sequenceNumber=${seq} (expected 1); earlier chained event(s) may have been deleted or reordered.`,
            });
          } else if (lastAnySeal && prevHash !== lastAnySeal && prevHash !== 'GENESIS') {
            anomalies.push({
              logId: row.id,
              type: 'BROKEN_HASH_CHAIN',
              sequenceNumber: seq,
              details: `First chained audit log ${row.id} previousHash mismatch.`,
            });
          }
        } else {
          if (seq !== lastV2Seq + 1) {
            anomalies.push({
              logId: row.id,
              type: 'CHAIN_SEQUENCE_GAP_OR_REORDER',
              sequenceNumber: seq,
              details: `Audit log ${row.id} has sequenceNumber=${seq}, expected ${lastV2Seq + 1} (missing or reordered event).`,
            });
          }
          if (lastV2Seal && prevHash !== lastV2Seal) {
            anomalies.push({
              logId: row.id,
              type: 'BROKEN_HASH_CHAIN',
              sequenceNumber: seq,
              details: `Audit log ${row.id} previousHash (${prevHash.slice(0, 16)}...) does not match preceding event seal (${lastV2Seal.slice(0, 16)}...).`,
            });
          }
        }

        lastV2Seq = seq;
        lastV2Seal = check.expectedSeal || check.hash;
      } else if (v2Started && isAuditServiceRow) {
        anomalies.push({
          logId: row.id,
          type: 'MISSING_CHAIN_METADATA',
          details: `Audit log ${row.id} appeared after v2 hash chain began but lacks v2 chain metadata (possible metadata stripping).`,
        });
      }

      if (check.expectedSeal) {
        lastAnySeal = check.expectedSeal;
      }
    }

    return {
      verified: anomalies.length === 0,
      totalLogs: rows.length,
      verifiedLogs,
      v2ChainedLogs,
      legacyLogs,
      anomalies,
    };
  }
}
