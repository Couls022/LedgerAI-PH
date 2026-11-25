import { Router } from "express";
import { db } from "../db";
import {
  users,
  companyUsers,
  companyUserRoles,
  roles,
  auditLogs,
  userPermissionOverrides,
  userModuleAssignments,
  userModuleAssignmentHistory,
  sessions
} from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth, requireMinRole, normalizeRole, LedgerRole } from "../auth";
import crypto from "crypto";
import { AuditService } from "../services/auditService";
import { RbacService, SYSTEM_ROLE_PERMISSIONS, ALL_PERMISSIONS } from "../services/rbacService";
import {
  createUserSchema,
  updateUserSchema,
  updateMemberStatusSchema,
  resetPasswordSchema,
  updateMemberPermissionsSchema
} from "../schemas/userSchemas";

const router = Router();

function formatZodError(error: any): string {
  if (error && error.errors && Array.isArray(error.errors)) {
    return error.errors.map((e: any) => e.message).join(", ");
  }
  return error?.message || "Validation failed";
}

async function getFormattedCompanyMembers(companyId: string, includeRemoved = false) {
  // Self-heal: ensure all users in this isolated company .lai database have a company_users membership record
  const allDbUsers = await db.select().from(users);
  const existingMemberships = await db
    .select()
    .from(companyUsers)
    .where(eq(companyUsers.companyId, companyId));

  const existingUserIds = new Set(existingMemberships.map(m => m.userId));
  for (let i = 0; i < allDbUsers.length; i++) {
    const u = allDbUsers[i];
    if (!existingUserIds.has(u.id)) {
      const isOwnerUser =
        u.role === 'OWNER' ||
        u.role === 'COMPANY_OWNER' ||
        (existingMemberships.length === 0 && i === 0);
      const defaultRoleName: LedgerRole = isOwnerUser ? 'Company Owner' : normalizeRole(u.role || 'Accountant');
      const roleRec = await RbacService.ensureRoleRecord(defaultRoleName);
      const newMembershipId = crypto.randomUUID();
      await db.insert(companyUsers).values({
        id: newMembershipId,
        userId: u.id,
        companyId,
        roleId: roleRec.id,
        status: u.status || 'ACTIVE',
        membershipStatus: 'ACTIVE'
      }).catch(() => {});
      existingUserIds.add(u.id);
    }
  }

  const members = await db
    .select({
      membershipId: companyUsers.id,
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      status: users.status,
      companyUserStatus: companyUsers.status,
      membershipStatus: companyUsers.membershipStatus,
      removedAt: companyUsers.removedAt,
      removedBy: companyUsers.removedBy,
      removalReason: companyUsers.removalReason,
      createdAt: companyUsers.createdAt
    })
    .from(companyUsers)
    .innerJoin(users, eq(companyUsers.userId, users.id))
    .where(eq(companyUsers.companyId, companyId));

  const formattedMembers = [];
  for (const m of members) {
    const isRemoved = m.membershipStatus === 'REMOVED' || m.companyUserStatus === 'REMOVED';
    if (isRemoved && !includeRemoved) {
      continue;
    }

    const resolved = await RbacService.resolveEffectiveAccess(m.membershipId);
    const overrides = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.companyUserId, m.membershipId));

    const effectiveStatus = isRemoved
      ? 'REMOVED'
      : (m.status === 'DISABLED' || m.companyUserStatus === 'DISABLED' || m.membershipStatus === 'SUSPENDED')
        ? 'DISABLED'
        : 'ACTIVE';

    formattedMembers.push({
      id: m.membershipId,
      membershipId: m.membershipId,
      userId: m.userId,
      displayName: m.displayName,
      email: m.email,
      status: effectiveStatus,
      membershipStatus: isRemoved ? 'REMOVED' : (effectiveStatus === 'DISABLED' ? 'SUSPENDED' : 'ACTIVE'),
      removedAt: m.removedAt,
      removedBy: m.removedBy,
      removalReason: m.removalReason,
      role: resolved.primaryRole,
      roleName: resolved.primaryRole,
      roles: resolved.assignedRoles,
      assignedRoles: resolved.assignedRoles,
      additionalRoles: resolved.additionalRoles,
      allRoleAssignments: resolved.allRoleAssignments,
      activeRoleTemplateVersions: resolved.activeRoleTemplateVersions,
      incompatibleRoleWarnings: resolved.incompatibleRoleWarnings,
      sodRestrictions: resolved.sodRestrictions,
      roleTemplateVersion: resolved.roleTemplateVersion,
      defaultDataScope: resolved.defaultDataScope,
      approvalLimitCentavos: resolved.defaultApprovalLimitCentavos,
      assignedModuleIds: resolved.effectiveModuleIds,
      assignedSubmoduleIds: resolved.effectiveSubmodulesMap,
      effectiveModuleIds: resolved.effectiveModuleIds,
      effectiveSubmoduleIds: resolved.effectiveSubmodulesMap,
      permissions: resolved.effectivePermissions,
      overrides,
      createdAt: m.createdAt
    });
  }

  return formattedMembers;
}

/**
 * Helper to execute the controlled 12-step member removal lifecycle without deleting the global user record
 * or breaking historical accounting/audit foreign keys.
 */
async function executeControlledMemberRemoval(
  req: any,
  companyId: string,
  membership: any,
  reason: string
) {
  await RbacService.assertActorCanModifyMember(req, membership.id, 'REMOVE');

  const targetUser = await db.select().from(users).where(eq(users.id, membership.userId)).get();
  const { primaryRole, assignedRoles } = await RbacService.getMemberRoles(membership.id);
  const now = new Date();
  const cleanReason = reason?.trim() || "Removed from company by authorized administrator";

  // 1. Revoke all active company_user_roles rows (preserving historical records with assignmentStatus = 'REVOKED')
  await db
    .update(companyUserRoles)
    .set({
      assignmentStatus: 'REVOKED',
      effectiveTo: now.toISOString(),
      assignmentReason: `Revoked upon company removal: ${cleanReason}`
    })
    .where(
      and(
        eq(companyUserRoles.companyUserId, membership.id),
        eq(companyUserRoles.assignmentStatus, 'ACTIVE')
      )
    );

  // 2. Record module assignment revocation history and clear active module assignments & permission overrides
  const existingMods = await db
    .select()
    .from(userModuleAssignments)
    .where(eq(userModuleAssignments.companyUserId, membership.id));

  await db.insert(userModuleAssignmentHistory).values({
    id: crypto.randomUUID(),
    companyUserId: membership.id,
    moduleId: "ALL_MODULES",
    actionType: "REVOKE",
    previousAssignment: JSON.stringify(existingMods.map((m: any) => ({ moduleId: m.moduleId, origin: m.origin, effect: m.effect }))),
    newAssignment: JSON.stringify([]),
    reason: `Member removed from company: ${cleanReason}`,
    changedBy: req.user!.id,
    changedByName: req.user!.displayName || req.user!.email,
    changedAt: now
  });

  await db.delete(userModuleAssignments).where(eq(userModuleAssignments.companyUserId, membership.id));
  await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.companyUserId, membership.id));

  // 3. Mark company_users membership as REMOVED (preserving row so self-heal does not recreate and history remains queryable)
  await db
    .update(companyUsers)
    .set({
      status: 'REMOVED',
      membershipStatus: 'REMOVED',
      removedAt: now,
      removedBy: req.user!.id,
      removalReason: cleanReason
    })
    .where(eq(companyUsers.id, membership.id));

  // 4. Invalidate all active sessions for the user in this company database
  await db.delete(sessions).where(eq(sessions.userId, membership.userId));

  // 5. Log immutable audit event
  await AuditService.log({
    req,
    companyId,
    action: "MEMBER_REMOVED_FROM_COMPANY",
    entityType: "MEMBERSHIP",
    entityId: membership.id,
    entityName: targetUser?.displayName || targetUser?.email || membership.userId,
    module: "RBAC",
    reason: cleanReason,
    beforeData: {
      userId: membership.userId,
      displayName: targetUser?.displayName,
      email: targetUser?.email,
      membershipStatus: membership.membershipStatus || membership.status,
      primaryRole,
      assignedRoles
    },
    afterData: {
      membershipStatus: 'REMOVED',
      removedAt: now.toISOString(),
      removedBy: req.user!.id,
      removalReason: cleanReason,
      assignedRoles: [],
      effectiveModuleIds: []
    },
    metadata: {
      targetUserId: membership.userId,
      membershipId: membership.id,
      displayName: targetUser?.displayName,
      email: targetUser?.email,
      removedRoles: assignedRoles,
      reason: cleanReason
    }
  });

  return {
    membershipId: membership.id,
    userId: membership.userId,
    displayName: targetUser?.displayName,
    email: targetUser?.email,
    removedRoles: assignedRoles,
    removedAt: now.toISOString(),
    removedBy: req.user!.id,
    removalReason: cleanReason
  };
}

// Get all active/disabled users in the current company
router.get("/", requireAuth, requireMinRole('Read-only User'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const includeRemoved = req.query.includeRemoved === 'true';
  const formattedMembers = await getFormattedCompanyMembers(companyId, includeRemoved);
  res.json(formattedMembers);
});

// Alias /api/users/members for RBAC workspace compatibility
router.get("/members", requireAuth, requireMinRole('Read-only User'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const includeRemoved = req.query.includeRemoved === 'true';
  const formattedMembers = await getFormattedCompanyMembers(companyId, includeRemoved);
  res.json(formattedMembers);
});

// Get removal & lifecycle history for the company
router.get("/removal-history", requireAuth, requireMinRole('Read-only User'), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const allMembers = await getFormattedCompanyMembers(companyId, true);
    const removedMembers = allMembers.filter(m => m.membershipStatus === 'REMOVED' || m.status === 'REMOVED');

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.companyId, companyId))
      .orderBy(desc(auditLogs.timestamp));

    const lifecycleEvents = logs.filter((l: any) =>
      [
        'MEMBER_REMOVED_FROM_COMPANY',
        'USER_DELETED',
        'USER_DISABLED',
        'USER_ACTIVATED',
        'MEMBER_ROLE_ASSIGNED',
        'MEMBER_ROLE_REVOKED',
        'MEMBER_ROLES_UPDATED',
        'PRIMARY_ROLE_CHANGED',
        'COMPANY_OWNERSHIP_TRANSFERRED',
        'UNAUTHORIZED_OWNER_MODIFICATION_ATTEMPT',
        'LAST_OWNER_PROTECTION_TRIGGERED'
      ].includes(l.action)
    );

    res.json({
      removedMembers,
      lifecycleEvents
    });
  } catch (err: any) {
    res.status(500).json({ error: "REMOVAL_HISTORY_ERROR", message: err.message });
  }
});

// Create a new user with validation, multi-role support & custom permissions matrix
router.post("/", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;

  const parseResult = createUserSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: formatZodError(parseResult.error),
      details: (parseResult.error as any).issues || (parseResult.error as any).errors || []
    });
    return;
  }

  const { email, password, displayName, role, roles: inputRoles, status, customPermissions, requirePasswordChange } = parseResult.data;

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  const isOwner = requesterRoles.includes('Company Owner');

  const rawTargetRoles: string[] = Array.isArray(inputRoles) && inputRoles.length > 0 
    ? inputRoles
    : [role || 'Read-only User'];

  const targetRoles: string[] = [];
  for (const r of rawTargetRoles) {
    const resolvedName = await RbacService.resolveCanonicalOrCustomRoleName(r);
    if (!targetRoles.includes(resolvedName)) {
      targetRoles.push(resolvedName);
    }
  }

  if (!isOwner && targetRoles.some(r => normalizeRole(r) === 'Company Owner')) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Only Company Owners can assign the Company Owner role." });
    return;
  }

  // Validate multi-role compatibility before creating user
  const compat = await RbacService.validateRoleCompatibility(targetRoles);
  if (!compat.valid) {
    res.status(400).json({
      error: "INCOMPATIBLE_ROLES",
      message: compat.prohibitedConflicts.map(c => c.reason).join(" | "),
      conflicts: compat.prohibitedConflicts
    });
    return;
  }

  // Check if user already exists
  let userId = crypto.randomUUID();
  let existingUser = await db.select().from(users).where(eq(users.email, email)).get();
  
  if (existingUser) {
    userId = existingUser.id;
    const existingMembership = await db.select().from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).get();

    if (existingMembership) {
      const memStatus = (existingMembership as any).membershipStatus || existingMembership.status;
      if (memStatus !== 'REMOVED') {
        res.status(400).json({ error: "VALIDATION_ERROR", message: "User is already an active member of this company." });
        return;
      }
      // Reactivate previously removed membership
      const firstRoleRecord = await RbacService.ensureRoleRecord(targetRoles[0]);
      await db.update(companyUsers)
        .set({
          roleId: firstRoleRecord.id,
          status: status || 'ACTIVE',
          membershipStatus: 'ACTIVE',
          removedAt: null,
          removedBy: null,
          removalReason: null
        })
        .where(eq(companyUsers.id, existingMembership.id));

      await db.update(users)
        .set({
          displayName,
          status: status || 'ACTIVE'
        })
        .where(eq(users.id, userId));

      await RbacService.setMemberRoles(req, existingMembership.id, targetRoles, "Re-admitted member to company");
      const resolved = await RbacService.resolveEffectiveAccess(existingMembership.id);

      res.json({
        message: "Previously removed member re-admitted to company successfully",
        id: existingMembership.id,
        userId,
        membershipId: existingMembership.id,
        displayName,
        email,
        role: resolved.primaryRole,
        roles: resolved.assignedRoles,
        status: status || "ACTIVE",
        permissions: resolved.effectivePermissions
      });
      return;
    }
  }

  if (!existingUser) {
    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(users).values({
      id: userId,
      email,
      passwordHash,
      displayName,
      role: targetRoles[0],
      status: status || "ACTIVE",
      requirePasswordChange: requirePasswordChange ?? false
    });
  }

  // Create membership
  const membershipId = crypto.randomUUID();
  const firstRoleRecord = await RbacService.ensureRoleRecord(targetRoles[0]);

  await db.insert(companyUsers).values({
    id: membershipId,
    userId,
    companyId,
    roleId: firstRoleRecord.id,
    status: status || "ACTIVE",
    membershipStatus: (status === 'DISABLED' ? 'SUSPENDED' : 'ACTIVE')
  });

  // Assign all target roles cleanly via RbacService
  await RbacService.setMemberRoles(req, membershipId, targetRoles, "Initial member role assignment");

  // Handle Custom Permissions Matrix Overrides (Company Owner is permanently immune to employee checkboxes)
  if (Array.isArray(customPermissions) && !targetRoles.some(r => normalizeRole(r) === 'Company Owner')) {
    const primaryRoleNorm = normalizeRole(targetRoles[0]);
    const defaultRolePerms = SYSTEM_ROLE_PERMISSIONS[primaryRoleNorm] || [];
    
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.companyUserId, membershipId));

    for (const permCode of ALL_PERMISSIONS) {
      const isSelected = customPermissions.includes(permCode);
      const isDefault = defaultRolePerms.includes(permCode);

      if (isSelected && !isDefault) {
        await db.insert(userPermissionOverrides).values({
          id: crypto.randomUUID(),
          companyUserId: membershipId,
          permissionCode: permCode,
          effect: 'ALLOW',
          reason: 'Explicitly granted via Create Member Matrix'
        });
      } else if (!isSelected && isDefault) {
        await db.insert(userPermissionOverrides).values({
          id: crypto.randomUUID(),
          companyUserId: membershipId,
          permissionCode: permCode,
          effect: 'DENY',
          reason: 'Explicitly revoked via Create Member Matrix'
        });
      }
    }
  }

  const resolved = await RbacService.resolveEffectiveAccess(membershipId);

  await AuditService.log({
    req,
    companyId,
    action: "USER_CREATED",
    entityType: "USER",
    entityId: userId,
    entityName: displayName || email,
    module: "AUTH",
    afterData: {
      id: membershipId,
      userId,
      email,
      displayName,
      role: resolved.primaryRole,
      roles: resolved.assignedRoles,
      status: status || 'ACTIVE'
    },
    metadata: {
      email,
      displayName,
      roles: resolved.assignedRoles,
      status: status || 'ACTIVE',
      permissionsCount: resolved.effectivePermissions.length
    }
  });

  res.json({
    message: "User created successfully",
    id: membershipId,
    userId,
    membershipId,
    displayName,
    email,
    role: resolved.primaryRole,
    roles: resolved.assignedRoles,
    assignedRoles: resolved.assignedRoles,
    additionalRoles: resolved.additionalRoles,
    status: status || "ACTIVE",
    permissions: resolved.effectivePermissions
  });
});

// Update member full details (supports multi-role, disableAccount & deleteAccount flags)
router.put("/:userId", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { userId } = req.params;

  const parseResult = updateUserSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: formatZodError(parseResult.error),
      details: (parseResult.error as any).issues || (parseResult.error as any).errors || []
    });
    return;
  }

  const {
    displayName,
    email,
    role,
    roles: inputRoles,
    password,
    status,
    disableAccount,
    deleteAccount,
    removalReason,
    requirePasswordChange
  } = parseResult.data;

  let membership = await db.select().from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, userId))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  const targetUser = await db.select().from(users).where(eq(users.id, membership.userId)).get();
  if (!targetUser) {
    res.status(404).json({ error: "NOT_FOUND", message: "User not found" });
    return;
  }

  try {
    // Handle DELETE ACCOUNT / REMOVE FROM COMPANY FLAG
    if (deleteAccount === true) {
      const removedInfo = await executeControlledMemberRemoval(
        req,
        companyId,
        membership,
        removalReason || "Removed via Edit Member modal"
      );
      res.json({
        message: "Member account successfully removed from the company.",
        removedMember: removedInfo
      });
      return;
    }

    // Determine target status
    let targetStatus = status;
    if (disableAccount === true) {
      targetStatus = 'DISABLED';
    }

    if (targetStatus === 'DISABLED') {
      await RbacService.assertActorCanModifyMember(req, membership.id, 'DISABLE');
    } else {
      await RbacService.assertActorCanModifyMember(req, membership.id, 'EDIT');
    }

    const { primaryRole } = await RbacService.getMemberRoles(membership.id);

    const userUpdates: Partial<typeof users.$inferInsert> = {};
    const membershipUpdates: Partial<typeof companyUsers.$inferInsert> = {};

    if (displayName && displayName.trim()) userUpdates.displayName = displayName.trim();
    if (email && email.trim()) userUpdates.email = email.trim().toLowerCase();

    if (targetStatus && ['ACTIVE', 'DISABLED'].includes(targetStatus)) {
      userUpdates.status = targetStatus;
      membershipUpdates.status = targetStatus;
      membershipUpdates.membershipStatus = targetStatus === 'DISABLED' ? 'SUSPENDED' : 'ACTIVE';

      if (targetStatus === 'DISABLED') {
        await db.delete(sessions).where(eq(sessions.userId, membership.userId));
      }
    }

    if (password && password.trim()) {
      userUpdates.passwordHash = await bcrypt.hash(password.trim(), 10);
      userUpdates.requirePasswordChange = requirePasswordChange ?? true;
      userUpdates.failedLoginAttempts = 0;
      userUpdates.lockedUntil = null;
    }

    if (Object.keys(userUpdates).length > 0) {
      await db.update(users).set(userUpdates).where(eq(users.id, membership.userId));
    }

    if (Object.keys(membershipUpdates).length > 0) {
      await db.update(companyUsers).set(membershipUpdates).where(eq(companyUsers.id, membership.id));
    }

    const targetRoles: string[] = Array.isArray(inputRoles) && inputRoles.length > 0 
      ? inputRoles
      : (role ? [role] : []);

    if (targetRoles.length > 0) {
      await RbacService.setMemberRoles(req, membership.id, targetRoles, "Updated roles via Member Profile");
    }

    let auditAction = "USER_UPDATED";
    if (targetStatus === 'DISABLED' && targetUser.status !== 'DISABLED') {
      auditAction = "USER_DISABLED";
    } else if (targetStatus === 'ACTIVE' && targetUser.status === 'DISABLED') {
      auditAction = "USER_ACTIVATED";
    }

    const resolved = await RbacService.resolveEffectiveAccess(membership.id);
    const updatedUser = await db.select().from(users).where(eq(users.id, membership.userId)).get();

    await AuditService.log({
      req,
      companyId,
      action: auditAction,
      entityType: "USER",
      entityId: membership.userId,
      module: "AUTH",
      beforeData: {
        displayName: targetUser.displayName,
        email: targetUser.email,
        status: targetUser.status,
        role: primaryRole
      },
      afterData: {
        displayName: updatedUser?.displayName,
        email: updatedUser?.email,
        status: updatedUser?.status,
        role: resolved.primaryRole,
        roles: resolved.assignedRoles
      },
      metadata: {
        displayName: updatedUser?.displayName,
        email: updatedUser?.email,
        role: resolved.primaryRole,
        roles: resolved.assignedRoles,
        status: updatedUser?.status
      }
    });

    res.json({
      message: "Member updated successfully",
      member: {
        membershipId: membership.id,
        userId: membership.userId,
        displayName: updatedUser?.displayName,
        email: updatedUser?.email,
        status: updatedUser?.status,
        role: resolved.primaryRole,
        roles: resolved.assignedRoles,
        assignedRoles: resolved.assignedRoles,
        additionalRoles: resolved.additionalRoles
      }
    });
  } catch (err: any) {
    const statusCode = err.message?.includes("PERMISSION_DENIED") ? 403 : 400;
    res.status(statusCode).json({ error: "UPDATE_ERROR", message: err.message || "Failed to update member" });
  }
});

// Explicit POST /api/users/:userId/remove-from-company endpoint
router.post("/:userId/remove-from-company", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { userId } = req.params;
  const reason = req.body?.reason || "Removed from company via RBAC Governance";

  let membership = await db.select().from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, userId))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  try {
    const removedInfo = await executeControlledMemberRemoval(req, companyId, membership, reason);
    res.json({
      message: "Member successfully removed from this company. Historical financial and audit records preserved.",
      removedMember: removedInfo
    });
  } catch (err: any) {
    const statusCode = err.message?.includes("PERMISSION_DENIED") ? 403 : 400;
    res.status(statusCode).json({ error: "MEMBER_REMOVE_ERROR", message: err.message });
  }
});

// Delete member from company (Remove Account)
router.delete("/:userId", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { userId } = req.params;
  const reason = req.body?.reason || req.query?.reason?.toString() || "Removed from company";

  let membership = await db.select().from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, userId))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  try {
    const removedInfo = await executeControlledMemberRemoval(req, companyId, membership, reason);
    res.json({
      message: "Member account successfully removed from this company.",
      removedMember: removedInfo
    });
  } catch (err: any) {
    const statusCode = err.message?.includes("PERMISSION_DENIED") ? 403 : 400;
    res.status(statusCode).json({ error: "MEMBER_REMOVE_ERROR", message: err.message });
  }
});

// Revoke all additional roles for a member (keeping primary role or resetting to Read-only User)
router.post("/:userId/revoke-all-roles", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { userId } = req.params;
  const { fallbackRole, reason } = req.body || {};

  let membership = await db.select().from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, userId))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  try {
    await RbacService.assertActorCanModifyMember(req, membership.id, 'REVOKE_ROLE');
    const targetRole = fallbackRole || 'Read-only User';
    await RbacService.setMemberRoles(
      req,
      membership.id,
      [targetRole],
      reason || `Revoked all roles and set fallback role to ${targetRole}`
    );
    const resolvedAccess = await RbacService.resolveEffectiveAccess(membership.id);
    res.json({
      message: `All additional roles revoked. Active role is now '${resolvedAccess.primaryRole}'.`,
      resolvedAccess
    });
  } catch (err: any) {
    const statusCode = err.message?.includes("PERMISSION_DENIED") ? 403 : 400;
    res.status(statusCode).json({ error: "REVOKE_ALL_ROLES_ERROR", message: err.message });
  }
});

// Protected Company Owner Transfer / Assignment Workflow
router.post("/:userId/transfer-ownership", requireAuth, requireMinRole('Company Owner'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { userId } = req.params;
  const { confirmationPhrase, reason, demoteSelfToAdmin } = req.body || {};

  if (confirmationPhrase !== 'TRANSFER OWNERSHIP') {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "You must type 'TRANSFER OWNERSHIP' to confirm transferring Company Owner authority."
    });
    return;
  }

  if (!reason || String(reason).trim().length < 5) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "A detailed audit reason (minimum 5 characters) is required for ownership transfer."
    });
    return;
  }

  let targetMembership = await db.select().from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).get();
  if (!targetMembership) {
    targetMembership = await db.select().from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, userId))).get();
  }

  if (!targetMembership || targetMembership.status !== 'ACTIVE') {
    res.status(404).json({ error: "NOT_FOUND", message: "Target active company member not found." });
    return;
  }

  try {
    // 1. Promote target member to Company Owner
    await RbacService.setMemberRoles(
      req,
      targetMembership.id,
      ['Company Owner'],
      `Ownership transferred by ${req.user!.email}: ${reason.trim()}`
    );

    // 2. Optionally transition the initiating owner to Company Administrator if requested
    if (demoteSelfToAdmin === true && req.activeCompany?.membershipId && req.activeCompany.membershipId !== targetMembership.id) {
      await RbacService.setMemberRoles(
        req,
        req.activeCompany.membershipId,
        ['Company Administrator'],
        `Transitioned to Company Administrator after transferring ownership: ${reason.trim()}`
      );
    }

    await AuditService.log({
      req,
      companyId,
      action: "COMPANY_OWNERSHIP_TRANSFERRED",
      entityType: "MEMBERSHIP",
      entityId: targetMembership.id,
      module: "RBAC",
      reason: reason.trim(),
      afterData: {
        newOwnerMembershipId: targetMembership.id,
        newOwnerUserId: targetMembership.userId,
        initiatedByUserId: req.user!.id,
        demoteSelfToAdmin: Boolean(demoteSelfToAdmin)
      }
    });

    const resolvedAccess = await RbacService.resolveEffectiveAccess(targetMembership.id);
    res.json({
      message: "Company Owner authority granted successfully.",
      resolvedAccess
    });
  } catch (err: any) {
    res.status(400).json({ error: "OWNERSHIP_TRANSFER_ERROR", message: err.message });
  }
});

// Get permissions for a specific member
router.get("/:membershipId/permissions", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { membershipId } = req.params;
  const companyId = req.activeCompany!.id;
  let membership = await db.select().from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, membershipId))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, membershipId))).get();
  }
  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in active company" });
    return;
  }
  const effectivePerms = await RbacService.evaluateEffectivePermissions(membership.id);
  res.json({ permissions: effectivePerms });
});

// Update member permissions matrix
router.put("/:membershipId/permissions", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { membershipId } = req.params;
  const companyId = req.activeCompany!.id;

  const parseResult = updateMemberPermissionsSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: formatZodError(parseResult.error),
      details: (parseResult.error as any).issues || (parseResult.error as any).errors || []
    });
    return;
  }

  let membership = await db.select().from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, membershipId))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, membershipId))).get();
  }
  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in active company" });
    return;
  }

  try {
    await RbacService.assertActorCanModifyMember(req, membership.id, 'MODIFY_PERMISSIONS');

    const { customPermissions } = parseResult.data;
    const { primaryRole, assignedRoles } = await RbacService.getMemberRoles(membership.id);
    if (assignedRoles.includes('Company Owner') && (!customPermissions.includes('*') && ALL_PERMISSIONS.some(p => !customPermissions.includes(p)))) {
      res.status(400).json({
        error: "OWNER_UNRESTRICTED_POLICY",
        message: "Active Company Owner permissions cannot be restricted by employee permission checkboxes."
      });
      return;
    }
    const defaultRolePerms = SYSTEM_ROLE_PERMISSIONS[primaryRole] || [];

    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.companyUserId, membership.id));

    for (const permCode of ALL_PERMISSIONS) {
      const isSelected = customPermissions.includes(permCode);
      const isDefault = defaultRolePerms.includes(permCode);

      if (isSelected && !isDefault) {
        await db.insert(userPermissionOverrides).values({
          id: crypto.randomUUID(),
          companyUserId: membership.id,
          permissionCode: permCode,
          effect: 'ALLOW',
          reason: 'Explicitly granted via Member Matrix Edit'
        });
      } else if (!isSelected && isDefault) {
        await db.insert(userPermissionOverrides).values({
          id: crypto.randomUUID(),
          companyUserId: membership.id,
          permissionCode: permCode,
          effect: 'DENY',
          reason: 'Explicitly revoked via Member Matrix Edit'
        });
      }
    }

    const effective = await RbacService.evaluateEffectivePermissions(membership.id);

    await AuditService.log({
      req,
      action: "MEMBER_PERMISSIONS_UPDATED",
      entityType: "MEMBERSHIP",
      entityId: membership.id,
      module: "RBAC",
      metadata: { effectivePermissionsCount: effective.length }
    });

    res.json({ message: "Member permissions matrix updated successfully", permissions: effective });
  } catch (err: any) {
    const statusCode = err.message?.includes("PERMISSION_DENIED") ? 403 : 400;
    res.status(statusCode).json({ error: "PERMISSIONS_UPDATE_ERROR", message: err.message });
  }
});

// Update user status (activate/disable toggle)
router.put("/:userId/status", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { userId } = req.params;
  const companyId = req.activeCompany!.id;

  const parseResult = updateMemberStatusSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: formatZodError(parseResult.error),
      details: (parseResult.error as any).issues || (parseResult.error as any).errors || []
    });
    return;
  }

  const { status, reason } = parseResult.data;

  let membership = await db.select().from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, userId))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  const targetUser = await db.select().from(users).where(eq(users.id, membership.userId)).get();
  if (!targetUser) {
    res.status(404).json({ error: "NOT_FOUND", message: "User record not found" });
    return;
  }

  try {
    await RbacService.assertActorCanModifyMember(req, membership.id, status === 'DISABLED' ? 'DISABLE' : 'REACTIVATE');

    await db.update(users).set({ status }).where(eq(users.id, membership.userId));
    await db
      .update(companyUsers)
      .set({
        status,
        membershipStatus: status === 'DISABLED' ? 'SUSPENDED' : 'ACTIVE'
      })
      .where(eq(companyUsers.id, membership.id));

    if (status === 'DISABLED') {
      await db.delete(sessions).where(eq(sessions.userId, membership.userId));
    }

    const actionType = status === 'DISABLED' ? 'USER_DISABLED' : 'USER_ACTIVATED';

    await AuditService.log({
      req,
      companyId,
      action: actionType,
      entityType: "USER",
      entityId: membership.userId,
      module: "AUTH",
      beforeData: { status: targetUser.status },
      afterData: { status },
      metadata: {
        status,
        reason: reason || `Account ${status === 'ACTIVE' ? 'activated' : 'disabled'} by admin`,
        displayName: targetUser.displayName,
        email: targetUser.email
      }
    });

    res.json({ message: `Member account status updated to ${status}` });
  } catch (err: any) {
    const statusCode = err.message?.includes("PERMISSION_DENIED") ? 403 : 400;
    res.status(statusCode).json({ error: "STATUS_UPDATE_ERROR", message: err.message });
  }
});

// Reset password for a user
router.post("/:userId/reset-password", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { userId } = req.params;
  const companyId = req.activeCompany!.id;

  const parseResult = resetPasswordSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: formatZodError(parseResult.error),
      details: (parseResult.error as any).issues || (parseResult.error as any).errors || []
    });
    return;
  }

  const { newPassword } = parseResult.data;

  let membership = await db.select().from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, userId))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  try {
    await RbacService.assertActorCanModifyMember(req, membership.id, 'EDIT');

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await db.update(users).set({ 
      passwordHash,
      requirePasswordChange: true,
      failedLoginAttempts: 0,
      lockedUntil: null
    }).where(eq(users.id, membership.userId));

    await db.delete(sessions).where(eq(sessions.userId, membership.userId));

    await AuditService.log({
      req,
      companyId,
      action: "PASSWORD_RESET",
      entityType: "USER",
      entityId: membership.userId,
      module: "AUTH",
      metadata: { forcedByAdmin: true }
    });

    res.json({ message: "Password reset successfully. User will be required to change it on next login." });
  } catch (err: any) {
    const statusCode = err.message?.includes("PERMISSION_DENIED") ? 403 : 400;
    res.status(statusCode).json({ error: "PASSWORD_RESET_ERROR", message: err.message });
  }
});

// Unlock user account
router.post("/:userId/unlock", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { userId } = req.params;
  const companyId = req.activeCompany!.id;

  let membership = await db.select().from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, userId))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in active company" });
    return;
  }

  try {
    await RbacService.assertActorCanModifyMember(req, membership.id, 'UNLOCK');
  } catch (err: any) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: err.message });
    return;
  }

  const targetUserId = membership.userId;

  await db.update(users).set({
    failedLoginAttempts: 0,
    lockedUntil: null
  }).where(eq(users.id, targetUserId));

  await AuditService.log({
    req,
    companyId,
    action: "USER_UNLOCKED",
    entityType: "USER",
    entityId: targetUserId,
    module: "AUTH"
  });

  res.json({ message: "User account unlocked successfully" });
});

export default router;
