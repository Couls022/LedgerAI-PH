import { db } from "../db";
import { companyUsers, companyUserRoles, roles, rolePermissions, permissions, userPermissionOverrides, sodRestrictions } from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { normalizeRole, LedgerRole, ROLE_HIERARCHY } from "../auth";
import { AuditService } from "./auditService";
import crypto from "crypto";

export interface RoleRecord {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isSystem?: boolean;
}

export interface PermissionOverride {
  id: string;
  permissionCode: string;
  effect: 'ALLOW' | 'DENY';
  reason?: string | null;
}

export const ALL_PERMISSIONS = [
  // Primary Modules & Operations
  'dashboard:view',
  'operations:view', 'operations:create', 'operations:edit', 'operations:delete', 'operations:manage',

  // Accounting Core & Submodules
  'accounting:view', 'accounting:create', 'accounting:edit', 'accounting:post', 'accounting:approve', 'accounting:reverse', 'accounting:delete', 'accounting:manage', 'accounting:export',
  'sales:view', 'sales:create', 'sales:edit', 'sales:delete', 'sales:approve', 'sales:export',
  'purchases:view', 'purchases:create', 'purchases:edit', 'purchases:delete', 'purchases:approve', 'purchases:export',
  'inventory:view', 'inventory:create', 'inventory:edit', 'inventory:adjust', 'inventory:approve', 'inventory:export', 'inventory:manage',
  'cash:view', 'cash:create', 'cash:edit', 'cash:approve', 'cash:reconcile', 'cash:export', 'cash:manage',
  'bank_rec:view', 'bank_rec:manage', 'bank_rec:approve',
  'fixedassets:view', 'fixedassets:manage', 'fixed_assets:view', 'fixed_assets:manage',
  'forex:view', 'forex:manage',
  'procurement:view', 'procurement:manage',

  // Tax & Compliance
  'tax:view', 'tax:create', 'tax:manage', 'tax:approve', 'tax:export',

  // Budget & Master Data
  'budget:view', 'budget:create', 'budget:edit', 'budget:approve', 'budget:export',
  'masterdata:view', 'masterdata:create', 'masterdata:edit', 'masterdata:delete', 'masterdata:export',
  'customers:view', 'customers:create', 'customers:edit', 'customers:delete',
  'vendors:view', 'vendors:create', 'vendors:edit', 'vendors:delete',

  // Payroll
  'payroll:view', 'payroll:create', 'payroll:edit', 'payroll:approve', 'payroll:export', 'payroll:process',

  // Documents
  'documents:view', 'documents:create', 'documents:edit', 'documents:delete', 'documents:verify', 'documents:post', 'documents:export',

  // Reports
  'reports:view', 'reports:export', 'reports:financial', 'reports:tax', 'reports:management', 'reports:audit',

  // Audit
  'audit:view', 'audit:export', 'audit:manage', 'audit:create', 'audit:edit', 'audit:approve',

  // Users & Roles
  'users:view', 'users:create', 'users:edit', 'users:disable', 'users:delete', 'users:deactivate',
  'roles:view', 'roles:manage', 'roles:assign',

  // Settings & System
  'settings:view', 'settings:manage',
  'backups:view', 'backups:create', 'backups:restore', 'backups:delete', 'backups:download', 'backups:cleanup',
  'storage:view', 'storage:cleanup',
  'company:read', 'company:write', 'company:view', 'company:create', 'company:edit', 'company:archive', 'company:delete',
  'lan:view', 'lan:manage', 'lan:sessions:terminate', 'lan:lock',

  // AI Assistant
  'ai:view', 'ai:financial', 'ai:tax', 'ai:payroll', 'ai:audit', 'ai:documents'
];

export const SYSTEM_ROLE_PERMISSIONS: Record<LedgerRole, string[]> = {
  'Company Owner': ['*'],
  'Company Administrator': ALL_PERMISSIONS.filter(p => p !== 'company:delete'),
  'Approver': [
    'dashboard:view', 'operations:view',
    'accounting:view', 'accounting:approve', 'accounting:post',
    'sales:view', 'sales:approve',
    'purchases:view', 'purchases:approve',
    'inventory:view', 'inventory:approve',
    'cash:view', 'cash:approve',
    'bank_rec:view', 'bank_rec:approve',
    'tax:view', 'tax:approve',
    'documents:view', 'documents:verify',
    'reports:view', 'reports:export',
    'audit:view',
    'budget:view', 'budget:approve',
    'lan:view',
    'ai:view', 'ai:financial', 'ai:tax'
  ],
  'Reviewer': [
    'dashboard:view', 'operations:view',
    'accounting:view',
    'sales:view',
    'purchases:view',
    'inventory:view',
    'cash:view',
    'bank_rec:view',
    'tax:view',
    'documents:view',
    'reports:view', 'reports:export',
    'budget:view',
    'masterdata:view',
    'lan:view',
    'ai:view'
  ],
  'Accountant': [
    'dashboard:view', 'operations:view',
    'accounting:view', 'accounting:create', 'accounting:edit', 'accounting:post',
    'sales:view', 'sales:create', 'sales:edit',
    'purchases:view', 'purchases:create', 'purchases:edit',
    'inventory:view', 'inventory:create', 'inventory:edit',
    'cash:view', 'cash:create', 'cash:edit', 'cash:reconcile',
    'bank_rec:view', 'bank_rec:manage',
    'tax:view', 'tax:create', 'tax:manage',
    'documents:view', 'documents:create', 'documents:verify', 'documents:post',
    'reports:view', 'reports:export', 'reports:financial', 'reports:tax',
    'budget:view', 'budget:create', 'budget:edit',
    'masterdata:view', 'masterdata:create', 'masterdata:edit',
    'customers:view', 'customers:create', 'customers:edit',
    'vendors:view', 'vendors:create', 'vendors:edit',
    'backups:view', 'backups:create', 'backups:download',
    'storage:view',
    'lan:view', 'lan:lock',
    'ai:view', 'ai:financial', 'ai:tax', 'ai:documents'
  ],
  'Bookkeeper': [
    'dashboard:view', 'operations:view',
    'accounting:view', 'accounting:create', 'accounting:edit',
    'sales:view', 'sales:create', 'sales:edit',
    'purchases:view', 'purchases:create', 'purchases:edit',
    'inventory:view', 'inventory:create', 'inventory:edit',
    'cash:view', 'cash:create', 'cash:edit',
    'documents:view', 'documents:create',
    'masterdata:view', 'masterdata:create', 'masterdata:edit',
    'customers:view', 'customers:create', 'customers:edit',
    'vendors:view', 'vendors:create', 'vendors:edit',
    'reports:view',
    'lan:view', 'lan:lock',
    'ai:view', 'ai:financial'
  ],
  'Auditor': [
    'dashboard:view',
    'accounting:view',
    'sales:view',
    'purchases:view',
    'inventory:view',
    'cash:view',
    'bank_rec:view',
    'tax:view',
    'documents:view',
    'reports:view', 'reports:export', 'reports:audit',
    'audit:view', 'audit:export',
    'masterdata:view',
    'customers:view', 'vendors:view',
    'backups:view',
    'storage:view',
    'lan:view',
    'ai:view', 'ai:audit'
  ],
  'Read-only User': [
    'dashboard:view',
    'accounting:view',
    'sales:view',
    'purchases:view',
    'inventory:view',
    'tax:view',
    'documents:view',
    'reports:view',
    'masterdata:view',
    'customers:view', 'vendors:view',
    'ai:view'
  ]
};

export const INCOMPATIBLE_ROLE_PAIRS: Array<[LedgerRole, LedgerRole, string]> = [
  ['Bookkeeper', 'Auditor', 'SOD Violation: A Bookkeeper cannot also be an Auditor due to self-auditing conflict of interest.'],
  ['Company Administrator', 'Auditor', 'SOD Violation: Administrator cannot hold Auditor role due to independence guidelines.']
];

export class RbacService {
  /**
   * Ensure standard system roles exist in the database and return the target role.
   */
  static async ensureRoleRecord(roleCodeOrName: string): Promise<RoleRecord> {
    const norm = normalizeRole(roleCodeOrName);
    const code = norm.toUpperCase().replace(/\s+/g, '_');

    let existing = await db.select().from(roles).where(eq(roles.code, code)).get();
    if (!existing) {
      existing = await db.select().from(roles).where(eq(roles.name, norm)).get();
    }

    if (!existing) {
      const id = `role-${norm.toLowerCase().replace(/\s+/g, '-')}`;
      await db.insert(roles).values({
        id,
        code,
        name: norm,
        description: `${norm} system role`,
        isSystem: true
      }).catch(() => {});

      existing = await db.select().from(roles).where(eq(roles.id, id)).get();
    }

    if (!existing) {
      return {
        id: `role-${norm.toLowerCase().replace(/\s+/g, '-')}`,
        code,
        name: norm,
        isSystem: true
      };
    }

    return existing;
  }

  /**
   * Get all assigned roles for a company member.
   * Auto-migrates single role in companyUsers to companyUserRoles if companyUserRoles is empty.
   */
  static async getMemberRoles(companyUserId: string): Promise<{
    roles: RoleRecord[];
    normalizedRoles: LedgerRole[];
    primaryRole: LedgerRole;
  }> {
    let assigned = await db
      .select({
        id: roles.id,
        code: roles.code,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem
      })
      .from(companyUserRoles)
      .innerJoin(roles, eq(companyUserRoles.roleId, roles.id))
      .where(eq(companyUserRoles.companyUserId, companyUserId));

    // Fallback: If no records in companyUserRoles, check companyUsers.roleId
    if (assigned.length === 0) {
      const membership = await db.select().from(companyUsers).where(eq(companyUsers.id, companyUserId)).get();
      if (membership && membership.roleId) {
        const roleRec = await db.select().from(roles).where(eq(roles.id, membership.roleId)).get();
        if (roleRec) {
          // Auto-migrate
          await db.insert(companyUserRoles).values({
            id: crypto.randomUUID(),
            companyUserId,
            roleId: roleRec.id
          }).catch(() => {});
          assigned = [roleRec];
        }
      } else if (membership) {
        // Default to Read-only User
        const defaultRole = await this.ensureRoleRecord('Read-only User');
        await db.insert(companyUserRoles).values({
          id: crypto.randomUUID(),
          companyUserId,
          roleId: defaultRole.id
        }).catch(() => {});
        assigned = [defaultRole];
      }
    }

    const normalizedRoles = assigned.map(r => normalizeRole(r.code || r.name));
    
    // Determine primary/highest hierarchy role
    let primaryRole: LedgerRole = 'Read-only User';
    let highestLevel = -1;
    for (const r of normalizedRoles) {
      const lvl = ROLE_HIERARCHY[r] ?? 10;
      if (lvl > highestLevel) {
        highestLevel = lvl;
        primaryRole = r;
      }
    }

    return {
      roles: assigned,
      normalizedRoles,
      primaryRole
    };
  }

  /**
   * Replace/set all roles for a company member.
   */
  static async setMemberRoles(req: any, companyUserId: string, targetRoles: (string | LedgerRole)[]) {
    const normRoles = targetRoles.map(r => normalizeRole(r));
    if (normRoles.length === 0) {
      normRoles.push('Read-only User');
    }

    // Verify SOD
    this.verifySegregationOfDuties(normRoles);

    const current = await this.getMemberRoles(companyUserId);

    // Delete existing roles
    await db.delete(companyUserRoles).where(eq(companyUserRoles.companyUserId, companyUserId));

    // Ensure and insert each role
    const newRoleRecords: RoleRecord[] = [];
    for (const r of normRoles) {
      const record = await this.ensureRoleRecord(r);
      newRoleRecords.push(record);
      await db.insert(companyUserRoles).values({
        id: crypto.randomUUID(),
        companyUserId,
        roleId: record.id
      }).catch(() => {});
    }

    const updated = await this.getMemberRoles(companyUserId);

    // Sync primary role in companyUsers
    const primaryRecord = newRoleRecords.find(rec => normalizeRole(rec.name) === updated.primaryRole) || newRoleRecords[0];
    await db.update(companyUsers).set({
      roleId: primaryRecord?.id || null,
      updatedAt: new Date()
    }).where(eq(companyUsers.id, companyUserId));

    // Audit Log
    const membership = await db.select().from(companyUsers).where(eq(companyUsers.id, companyUserId)).get();
    await AuditService.log({
      req,
      companyId: membership?.companyId,
      action: "ROLES_UPDATED",
      entityType: "MEMBERSHIP",
      entityId: companyUserId,
      module: "RBAC",
      beforeData: { roles: current.normalizedRoles },
      afterData: { roles: updated.normalizedRoles, primaryRole: updated.primaryRole },
      metadata: { targetUserId: membership?.userId, roles: updated.normalizedRoles }
    });

    return {
      message: `Roles updated successfully to ${updated.normalizedRoles.join(', ')}`,
      roles: updated.normalizedRoles,
      primaryRole: updated.primaryRole
    };
  }

  /**
   * Add a role to a company member (Multi-Role Assignment).
   */
  static async assignRoleToMember(req: any, companyUserId: string, roleCodeOrName: string) {
    const roleRecord = await this.ensureRoleRecord(roleCodeOrName);
    const normTargetRole = normalizeRole(roleRecord.name || roleRecord.code);

    const current = await this.getMemberRoles(companyUserId);

    // Check if already assigned
    if (current.roles.some(r => r.id === roleRecord.id)) {
      throw new Error(`DUPLICATE_ROLE: Role ${normTargetRole} is already assigned to this member.`);
    }

    // Check Segregation of Duties (SOD) / Incompatible roles
    const proposedRoles = [...current.normalizedRoles, normTargetRole];
    this.verifySegregationOfDuties(proposedRoles);

    // Insert new role assignment
    await db.insert(companyUserRoles).values({
      id: crypto.randomUUID(),
      companyUserId,
      roleId: roleRecord.id
    });

    // Re-fetch updated roles
    const updated = await this.getMemberRoles(companyUserId);

    // Sync primary role in companyUsers table
    await db.update(companyUsers).set({
      roleId: updated.roles.find(r => normalizeRole(r.name) === updated.primaryRole)?.id || roleRecord.id,
      updatedAt: new Date()
    }).where(eq(companyUsers.id, companyUserId));

    // Audit Log
    const membership = await db.select().from(companyUsers).where(eq(companyUsers.id, companyUserId)).get();
    await AuditService.log({
      req,
      companyId: membership?.companyId,
      action: "ROLE_ADDED",
      entityType: "MEMBERSHIP",
      entityId: companyUserId,
      module: "RBAC",
      beforeData: { roles: current.normalizedRoles },
      afterData: { roles: updated.normalizedRoles, addedRole: normTargetRole },
      metadata: { targetUserId: membership?.userId, addedRole: normTargetRole }
    });

    return {
      message: `Role ${normTargetRole} successfully added.`,
      roles: updated.normalizedRoles,
      primaryRole: updated.primaryRole
    };
  }

  /**
   * Remove a role from a company member.
   */
  static async removeRoleFromMember(req: any, companyUserId: string, roleCodeOrName: string) {
    const targetNorm = normalizeRole(roleCodeOrName);
    const current = await this.getMemberRoles(companyUserId);

    if (current.roles.length <= 1) {
      throw new Error("CANNOT_REMOVE_LAST_ROLE: A member must have at least one active role assignment.");
    }

    const roleToRemove = current.roles.find(r => normalizeRole(r.name || r.code) === targetNorm);
    if (!roleToRemove) {
      throw new Error(`Role ${targetNorm} is not assigned to this member.`);
    }

    // Delete role from companyUserRoles
    await db.delete(companyUserRoles).where(
      and(
        eq(companyUserRoles.companyUserId, companyUserId),
        eq(companyUserRoles.roleId, roleToRemove.id)
      )
    );

    // Re-fetch updated roles
    const updated = await this.getMemberRoles(companyUserId);

    // Sync primary role
    await db.update(companyUsers).set({
      roleId: updated.roles[0]?.id || null,
      updatedAt: new Date()
    }).where(eq(companyUsers.id, companyUserId));

    // Audit log
    const membership = await db.select().from(companyUsers).where(eq(companyUsers.id, companyUserId)).get();
    await AuditService.log({
      req,
      companyId: membership?.companyId,
      action: "ROLE_REMOVED",
      entityType: "MEMBERSHIP",
      entityId: companyUserId,
      module: "RBAC",
      beforeData: { roles: current.normalizedRoles },
      afterData: { roles: updated.normalizedRoles, removedRole: targetNorm },
      metadata: { targetUserId: membership?.userId, removedRole: targetNorm }
    });

    return {
      message: `Role ${targetNorm} successfully removed.`,
      roles: updated.normalizedRoles,
      primaryRole: updated.primaryRole
    };
  }

  /**
   * Verify Segregation of Duties (SOD) incompatible role rules.
   */
  static verifySegregationOfDuties(assignedRoles: LedgerRole[]) {
    for (const [r1, r2, reason] of INCOMPATIBLE_ROLE_PAIRS) {
      if (assignedRoles.includes(r1) && assignedRoles.includes(r2)) {
        throw new Error(reason);
      }
    }
  }

  /**
   * Evaluate effective permissions for a company member based on:
   * 1. Union of permissions from ALL assigned roles
   * 2. Explicit denies (override union)
   * 3. Explicit allows (added to union)
   * 4. SOD restrictions (override union)
   */
  static async evaluateEffectivePermissions(companyUserId: string): Promise<string[]> {
    const { normalizedRoles, roles: roleRecords } = await this.getMemberRoles(companyUserId);

    // 1. Permission Union from all assigned roles
    const unionSet = new Set<string>();

    for (const roleNorm of normalizedRoles) {
      const defaultPerms = SYSTEM_ROLE_PERMISSIONS[roleNorm] || [];
      defaultPerms.forEach(p => unionSet.add(p));
    }

    // Also query rolePermissions table if configured
    const roleIds = roleRecords.map(r => r.id);
    if (roleIds.length > 0) {
      const dbRolePerms = await db
        .select({ code: permissions.code })
        .from(rolePermissions)
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(inArray(rolePermissions.roleId, roleIds));

      dbRolePerms.forEach(p => unionSet.add(p.code));
    }

    // 2. Explicit Overrides (ALLOW / DENY)
    const overrides = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.companyUserId, companyUserId));

    for (const override of overrides) {
      if (override.effect === 'DENY') {
        unionSet.delete(override.permissionCode);
      } else if (override.effect === 'ALLOW') {
        unionSet.add(override.permissionCode);
      }
    }

    // 3. Segregation of Duties (SOD) Restrictions
    const dbSodRules = await db.select().from(sodRestrictions).where(eq(sodRestrictions.status, 'ACTIVE'));
    for (const rule of dbSodRules) {
      const r1 = normalizeRole(rule.incompatibleRole1);
      const r2 = normalizeRole(rule.incompatibleRole2);
      if (normalizedRoles.includes(r1) && normalizedRoles.includes(r2)) {
        if (rule.restrictedPermissions) {
          try {
            const blocked: string[] = JSON.parse(rule.restrictedPermissions);
            blocked.forEach(p => unionSet.delete(p));
          } catch (_) {}
        }
      }
    }

    return Array.from(unionSet);
  }

  /**
   * Get explicit overrides for a company member.
   */
  static async getExplicitOverrides(companyUserId: string): Promise<PermissionOverride[]> {
    const records = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.companyUserId, companyUserId));

    return records.map(r => ({
      id: r.id,
      permissionCode: r.permissionCode,
      effect: r.effect as 'ALLOW' | 'DENY',
      reason: r.reason
    }));
  }

  /**
   * Set or update explicit permission override for a member.
   */
  static async setExplicitOverride(
    req: any,
    companyUserId: string,
    permissionCode: string,
    effect: 'ALLOW' | 'DENY',
    reason?: string
  ) {
    const existing = await db
      .select()
      .from(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.companyUserId, companyUserId),
          eq(userPermissionOverrides.permissionCode, permissionCode)
        )
      )
      .get();

    if (existing) {
      await db
        .update(userPermissionOverrides)
        .set({ effect, reason: reason || null })
        .where(eq(userPermissionOverrides.id, existing.id));
    } else {
      await db.insert(userPermissionOverrides).values({
        id: crypto.randomUUID(),
        companyUserId,
        permissionCode,
        effect,
        reason: reason || null
      });
    }

    const membership = await db.select().from(companyUsers).where(eq(companyUsers.id, companyUserId)).get();
    await AuditService.log({
      req,
      companyId: membership?.companyId,
      action: "PERMISSION_OVERRIDE_SET",
      entityType: "MEMBERSHIP",
      entityId: companyUserId,
      module: "RBAC",
      afterData: { permissionCode, effect, reason },
      metadata: { targetUserId: membership?.userId, permissionCode, effect }
    });

    return { message: `Explicit ${effect} override set for permission ${permissionCode}` };
  }

  /**
   * Remove explicit permission override.
   */
  static async removeExplicitOverride(req: any, companyUserId: string, permissionCode: string) {
    await db
      .delete(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.companyUserId, companyUserId),
          eq(userPermissionOverrides.permissionCode, permissionCode)
        )
      );

    const membership = await db.select().from(companyUsers).where(eq(companyUsers.id, companyUserId)).get();
    await AuditService.log({
      req,
      companyId: membership?.companyId,
      action: "PERMISSION_OVERRIDE_REMOVED",
      entityType: "MEMBERSHIP",
      entityId: companyUserId,
      module: "RBAC",
      metadata: { targetUserId: membership?.userId, permissionCode }
    });

    return { message: `Explicit override removed for permission ${permissionCode}` };
  }
}
