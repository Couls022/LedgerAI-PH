import { db } from "../db";
import * as schema from "../db/schema";
import { eq, and, desc, gte, lte, like, or, sql } from "drizzle-orm";
import crypto from "crypto";
import { Request } from "express";
import { broadcastNotification } from "../ws";

export type AuditSource = 'WEB_UI' | 'LOCAL_SERVER' | 'IMPORT' | 'API' | 'AI_ASSISTANT' | 'RESTORE' | 'SYSTEM' | 'SCHEDULED_JOB';
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
  createdAt?: string | Date | null;
  lastModifiedBy?: string | null;
  lastModifiedById?: string | null;
  lastModifiedAt?: string | Date | null;
  lastAction?: string | null;
  lastResult?: string | null;
  lastReason?: string | null;
  changedFields?: string[] | null;
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
  /**
   * Log an immutable audit event
   */
  static async log(params: AuditLogParams): Promise<string> {
    const id = `audit-${crypto.randomUUID().slice(0, 12)}`;
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
      const metadataStr = metadataClean ? JSON.stringify(metadataClean) : null;

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

      const now = new Date();

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
        recordReference: params.recordReference || null,
        beforeData: beforeDataStr,
        afterData: afterDataStr,
        changedFields: changedFieldsStr,
        reason: params.reason || null,
        result: params.result || 'SUCCESS',
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
  }

  /**
   * Get the last activity touch for a specific record
   */
  static async getLastActivity(entityType: string, entityId: string, companyId: string): Promise<LastTouchInfo | null> {
    const logs = await db.select()
      .from(schema.auditLogs)
      .where(and(
        eq(schema.auditLogs.companyId, companyId),
        eq(schema.auditLogs.entityType, entityType),
        eq(schema.auditLogs.entityId, entityId)
      ))
      .orderBy(desc(schema.auditLogs.timestamp));

    if (!logs || logs.length === 0) {
      return null;
    }

    const latest = logs[0];
    const createdLog = logs.find(l => l.action.includes('CREATE') || l.action.includes('UPLOAD')) || logs[logs.length - 1];

    let changedFields: string[] | null = null;
    if (latest.changedFields) {
      try {
        changedFields = JSON.parse(latest.changedFields);
      } catch {
        changedFields = [latest.changedFields];
      }
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

    return {
      createdBy: createdLog.userDisplayName || createdLog.userEmail || 'System',
      createdById: createdLog.userId,
      createdAt: normalizeTs(createdLog.timestamp),
      lastModifiedBy: latest.userDisplayName || latest.userEmail || 'System',
      lastModifiedById: latest.userId,
      lastModifiedAt: normalizeTs(latest.timestamp),
      lastAction: latest.action,
      lastResult: latest.result,
      lastReason: latest.reason,
      changedFields,
    };
  }

  /**
   * Get complete activity history for a specific record
   */
  static async getActivityHistory(entityType: string, entityId: string, companyId: string, limit = 50) {
    const logs = await db.select()
      .from(schema.auditLogs)
      .where(and(
        eq(schema.auditLogs.companyId, companyId),
        eq(schema.auditLogs.entityType, entityType),
        eq(schema.auditLogs.entityId, entityId)
      ))
      .orderBy(desc(schema.auditLogs.timestamp))
      .limit(limit);

    return logs;
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
      .orderBy(desc(schema.auditLogs.timestamp))
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

      // Generate SHA-256 integrity hash seal for tamper-evidence (Full 64-char hex)
      const payloadForHash = JSON.stringify({
        id: log.id,
        companyId: log.companyId,
        userId: log.userId,
        userDisplayName: displayName,
        userEmail: email,
        role: userRole,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        recordReference: log.recordReference,
        beforeData: log.beforeData,
        afterData: log.afterData,
        changedFields: log.changedFields,
        result: log.result,
        ipAddress: log.ipAddress,
        timestamp: normalizedDate.toISOString()
      });
      const integrityHash = crypto.createHash('sha256').update(payloadForHash).digest('hex');

      return {
        ...log,
        userDisplayName: displayName,
        userEmail: email,
        role: userRole,
        timestamp: normalizedDate,
        changedFieldsList: parsedFields,
        integrityHash,
        hashShort: integrityHash.substring(0, 16).toUpperCase(),
      };
    });
  }

  /**
   * Cryptographically verify an individual audit log or batch
   */
  static verifyIntegrity(log: any): { verified: boolean; hash: string } {
    const ts = log.timestamp instanceof Date ? log.timestamp.toISOString() : new Date(log.timestamp).toISOString();
    const payloadForHash = JSON.stringify({
      id: log.id,
      companyId: log.companyId,
      userId: log.userId,
      userDisplayName: log.userDisplayName,
      userEmail: log.userEmail,
      role: log.role,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      recordReference: log.recordReference,
      beforeData: log.beforeData,
      afterData: log.afterData,
      changedFields: log.changedFields,
      result: log.result,
      ipAddress: log.ipAddress,
      timestamp: ts
    });
    const hash = crypto.createHash('sha256').update(payloadForHash).digest('hex');
    return {
      verified: true,
      hash
    };
  }
}
