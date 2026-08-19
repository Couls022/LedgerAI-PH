import { Router } from "express";
import { db } from "../db";
import { users, companyUsers, roles, auditLogs, userPermissionOverrides, sessions } from "../db/schema";
import { eq, and } from "drizzle-orm";
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
  updateMemberPermissionsSchema,
  ValidLedgerRole
} from "../schemas/userSchemas";

const router = Router();

// Helper to format Zod errors
function formatZodError(error: any): string {
  if (error && error.errors && Array.isArray(error.errors)) {
    return error.errors.map((e: any) => e.message).join(", ");
  }
  return error?.message || "Validation failed";
}

// Get all users in the current company
router.get("/", requireAuth, requireMinRole('Read-only User'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const members = await db
    .select({
      membershipId: companyUsers.id,
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      status: users.status,
      membershipStatus: companyUsers.status,
      createdAt: companyUsers.createdAt
    })
    .from(companyUsers)
    .innerJoin(users, eq(companyUsers.userId, users.id))
    .where(eq(companyUsers.companyId, companyId));

  const formattedMembers = [];
  for (const m of members) {
    const { normalizedRoles, primaryRole } = await RbacService.getMemberRoles(m.membershipId);
    const effectivePerms = await RbacService.evaluateEffectivePermissions(m.membershipId);
    const overrides = await db
      .select()
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.companyUserId, m.membershipId));

    // Effective status: if either user or membership is DISABLED, member is DISABLED
    const effectiveStatus = (m.status === 'DISABLED' || m.membershipStatus === 'DISABLED') ? 'DISABLED' : 'ACTIVE';

    formattedMembers.push({
      membershipId: m.membershipId,
      userId: m.userId,
      displayName: m.displayName,
      email: m.email,
      status: effectiveStatus,
      role: primaryRole,
      roleName: primaryRole,
      roles: normalizedRoles,
      permissions: effectivePerms,
      overrides,
      createdAt: m.createdAt
    });
  }

  res.json(formattedMembers);
});

// Create a new user with validation & custom permissions matrix
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

  const targetRoles: LedgerRole[] = Array.isArray(inputRoles) && inputRoles.length > 0 
    ? (inputRoles as LedgerRole[])
    : [role as LedgerRole];

  if (!isOwner && targetRoles.includes('Company Owner')) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Only Company Owners can assign the Company Owner role." });
    return;
  }

  // Check if user already exists
  let userId = crypto.randomUUID();
  let existingUser = await db.select().from(users).where(eq(users.email, email)).get();
  
  if (existingUser) {
    userId = existingUser.id;
    // Check if already in company
    const existingMembership = await db.select().from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).get();
    if (existingMembership) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "User is already a member of this company." });
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
      status: status || "ACTIVE",
      requirePasswordChange: requirePasswordChange ?? true
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
    status: status || "ACTIVE"
  });

  // Assign all target roles cleanly via RbacService
  try {
    await RbacService.setMemberRoles(req, membershipId, targetRoles);
  } catch (err: any) {
    console.warn(`Role assignment warning:`, err.message);
  }

  // Handle Custom Permissions Matrix Overrides
  if (Array.isArray(customPermissions)) {
    const primaryRoleNorm = normalizeRole(targetRoles[0]);
    const defaultRolePerms = SYSTEM_ROLE_PERMISSIONS[primaryRoleNorm] || [];
    
    // Clear any existing overrides
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

  const effectivePerms = await RbacService.evaluateEffectivePermissions(membershipId);

  await AuditService.log({
    req,
    companyId,
    action: "USER_CREATED",
    entityType: "USER",
    entityId: userId,
    module: "AUTH",
    metadata: { email, displayName, roles: targetRoles, status: status || 'ACTIVE', permissionsCount: effectivePerms.length }
  });

  res.json({ message: "User created successfully", userId, membershipId, roles: targetRoles, permissions: effectivePerms });
});

// Update member full details (supports disableAccount & deleteAccount flags)
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

  const { displayName, email, role, roles: inputRoles, password, status, disableAccount, deleteAccount, requirePasswordChange } = parseResult.data;

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

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  const isRequesterOwner = requesterRoles.includes('Company Owner');
  const { primaryRole } = await RbacService.getMemberRoles(membership.id);

  if (primaryRole === 'Company Owner' && !isRequesterOwner) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Only Company Owners can modify Company Owners." });
    return;
  }

  // Handle DELETE ACCOUNT FLAG
  if (deleteAccount === true) {
    if (membership.userId === req.user!.id) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot remove your own active account from the company." });
      return;
    }
    if (primaryRole === 'Company Owner') {
      const allMembers = await db.select().from(companyUsers).where(eq(companyUsers.companyId, companyId));
      let ownerCount = 0;
      for (const m of allMembers) {
        const { primaryRole: r } = await RbacService.getMemberRoles(m.id);
        if (r === 'Company Owner') ownerCount++;
      }
      if (ownerCount <= 1) {
        res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot remove the sole Company Owner. Assign another owner first." });
        return;
      }
    }

    // Invalidate sessions
    await db.delete(sessions).where(eq(sessions.userId, membership.userId));
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.companyUserId, membership.id));
    await db.delete(companyUsers).where(eq(companyUsers.id, membership.id));

    await AuditService.log({
      req,
      companyId,
      action: "USER_DELETED",
      entityType: "USER",
      entityId: membership.userId,
      module: "AUTH",
      metadata: { targetUserId: membership.userId, displayName: targetUser.displayName, email: targetUser.email, removedRole: primaryRole }
    });

    res.json({ message: "Member account successfully removed from the company." });
    return;
  }

  try {
    const userUpdates: Partial<typeof users.$inferInsert> = {};
    const membershipUpdates: Partial<typeof companyUsers.$inferInsert> = {};

    if (displayName && displayName.trim()) userUpdates.displayName = displayName.trim();
    if (email && email.trim()) userUpdates.email = email.trim().toLowerCase();

    // Determine target status
    let targetStatus = status;
    if (disableAccount === true) {
      targetStatus = 'DISABLED';
    }

    if (targetStatus && ['ACTIVE', 'DISABLED'].includes(targetStatus)) {
      if (membership.userId === req.user!.id && targetStatus === 'DISABLED') {
        res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot disable your own active account." });
        return;
      }
      userUpdates.status = targetStatus;
      membershipUpdates.status = targetStatus;

      // Invalidate active sessions if disabling
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

    const targetRoles: LedgerRole[] = Array.isArray(inputRoles) && inputRoles.length > 0 
      ? (inputRoles as LedgerRole[])
      : (role ? [role as LedgerRole] : []);

    if (targetRoles.length > 0) {
      if (targetRoles.includes('Company Owner') && !isRequesterOwner) {
        res.status(403).json({ error: "PERMISSION_DENIED", message: "Only Company Owners can assign Company Owner role." });
        return;
      }
      await RbacService.setMemberRoles(req, membership.id, targetRoles);
    }

    // Determine audit action
    let auditAction = "USER_UPDATED";
    if (targetStatus === 'DISABLED' && targetUser.status !== 'DISABLED') {
      auditAction = "USER_DISABLED";
    } else if (targetStatus === 'ACTIVE' && targetUser.status === 'DISABLED') {
      auditAction = "USER_ACTIVATED";
    }

    await AuditService.log({
      req,
      companyId,
      action: auditAction,
      entityType: "USER",
      entityId: membership.userId,
      module: "AUTH",
      beforeData: { displayName: targetUser.displayName, email: targetUser.email, status: targetUser.status, role: primaryRole },
      afterData: { displayName: userUpdates.displayName || targetUser.displayName, email: userUpdates.email || targetUser.email, status: targetStatus || targetUser.status, role: targetRoles[0] || primaryRole },
      metadata: { displayName: userUpdates.displayName || targetUser.displayName, email: userUpdates.email || targetUser.email, role: targetRoles[0] || primaryRole, status: targetStatus || targetUser.status }
    });

    const updatedRoles = await RbacService.getMemberRoles(membership.id);
    const updatedUser = await db.select().from(users).where(eq(users.id, membership.userId)).get();

    res.json({
      message: "Member updated successfully",
      member: {
        membershipId: membership.id,
        userId: membership.userId,
        displayName: updatedUser?.displayName,
        email: updatedUser?.email,
        status: updatedUser?.status,
        role: updatedRoles.primaryRole,
        roles: updatedRoles.normalizedRoles
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: "UPDATE_ERROR", message: err.message || "Failed to update member" });
  }
});

// Delete member from company (Remove Account)
router.delete("/:userId", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { userId } = req.params;

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

  if (membership.userId === req.user!.id) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot remove your own active account from the company." });
    return;
  }

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  const isRequesterOwner = requesterRoles.includes('Company Owner');
  const { primaryRole } = await RbacService.getMemberRoles(membership.id);

  if (primaryRole === 'Company Owner' && !isRequesterOwner) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Company Administrators cannot remove Company Owners." });
    return;
  }

  if (primaryRole === 'Company Owner') {
    const allMembers = await db.select().from(companyUsers).where(eq(companyUsers.companyId, companyId));
    let ownerCount = 0;
    for (const m of allMembers) {
      const { primaryRole: r } = await RbacService.getMemberRoles(m.id);
      if (r === 'Company Owner') ownerCount++;
    }
    if (ownerCount <= 1) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot remove the sole Company Owner. Assign another owner first." });
      return;
    }
  }

  // Invalidate active sessions
  await db.delete(sessions).where(eq(sessions.userId, membership.userId));
  await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.companyUserId, membership.id));
  await db.delete(companyUsers).where(eq(companyUsers.id, membership.id));

  await AuditService.log({
    req,
    companyId,
    action: "USER_DELETED",
    entityType: "USER",
    entityId: membership.userId,
    module: "AUTH",
    beforeData: { displayName: targetUser?.displayName, email: targetUser?.email, role: primaryRole },
    metadata: { targetUserId: membership.userId, displayName: targetUser?.displayName, email: targetUser?.email, removedRole: primaryRole }
  });

  res.json({ message: "Member account successfully removed from this company." });
});

// Get permissions for a specific member
router.get("/:membershipId/permissions", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { membershipId } = req.params;
  const effectivePerms = await RbacService.evaluateEffectivePermissions(membershipId);
  res.json({ permissions: effectivePerms });
});

// Update member permissions matrix
router.put("/:membershipId/permissions", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { membershipId } = req.params;

  const parseResult = updateMemberPermissionsSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: formatZodError(parseResult.error),
      details: (parseResult.error as any).issues || (parseResult.error as any).errors || []
    });
    return;
  }

  const { customPermissions } = parseResult.data;

  const { primaryRole } = await RbacService.getMemberRoles(membershipId);
  const defaultRolePerms = SYSTEM_ROLE_PERMISSIONS[primaryRole] || [];

  // Clear existing overrides
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
        reason: 'Explicitly granted via Member Matrix Edit'
      });
    } else if (!isSelected && isDefault) {
      await db.insert(userPermissionOverrides).values({
        id: crypto.randomUUID(),
        companyUserId: membershipId,
        permissionCode: permCode,
        effect: 'DENY',
        reason: 'Explicitly revoked via Member Matrix Edit'
      });
    }
  }

  const effective = await RbacService.evaluateEffectivePermissions(membershipId);

  await AuditService.log({
    req,
    action: "MEMBER_PERMISSIONS_UPDATED",
    entityType: "MEMBERSHIP",
    entityId: membershipId,
    module: "RBAC",
    metadata: { effectivePermissionsCount: effective.length }
  });

  res.json({ message: "Member permissions matrix updated successfully", permissions: effective });
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

  // Can't deactivate yourself
  if (membership.userId === req.user!.id && status === 'DISABLED') {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot disable your own active account" });
    return;
  }

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  const { primaryRole } = await RbacService.getMemberRoles(membership.id);
  if (primaryRole === 'Company Owner' && !requesterRoles.includes('Company Owner')) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Company Administrators cannot disable Company Owners." });
    return;
  }

  // Update status on both users and companyUsers
  await db.update(users).set({ status }).where(eq(users.id, membership.userId));
  await db.update(companyUsers).set({ status }).where(eq(companyUsers.id, membership.id));

  if (status === 'DISABLED') {
    // Invalidate sessions immediately
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
    metadata: { status, reason: reason || `Account ${status === 'ACTIVE' ? 'activated' : 'disabled'} by admin`, displayName: targetUser.displayName, email: targetUser.email }
  });

  res.json({ message: `Member account status updated to ${status}` });
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

  const { primaryRole } = await RbacService.getMemberRoles(membership.id);
  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  if (primaryRole === 'Company Owner' && !requesterRoles.includes('Company Owner')) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Company Administrators cannot modify Company Owners." });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  await db.update(users).set({ 
    passwordHash,
    requirePasswordChange: true,
    failedLoginAttempts: 0,
    lockedUntil: null
  }).where(eq(users.id, membership.userId));

  // Invalidate old sessions
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

  const targetUserId = membership ? membership.userId : userId;

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
