import { Router } from "express";
import { db } from "../db";
import { roles, permissions, rolePermissions, userPermissionOverrides } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requirePermission } from "../auth";
import { RbacService, ALL_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } from "../services/rbacService";
import { AuditService } from "../services/auditService";
import crypto from "crypto";

const router = Router();

// Ensure permissions catalog & roles exist on route load
router.use(async (req, res, next) => {
  try {
    for (const permCode of ALL_PERMISSIONS) {
      const existing = await db.select().from(permissions).where(eq(permissions.code, permCode)).get();
      if (!existing) {
        const module = permCode.split(':')[0] || 'general';
        await db.insert(permissions).values({
          id: `perm-${permCode.replace(/[:_]/g, '-')}`,
          code: permCode,
          description: `Permission to ${permCode}`,
          module
        }).catch(() => {});
      }
    }
  } catch (_) {}
  next();
});

// GET /api/rbac/matrix — Get entire RBAC Matrix
router.get("/matrix", requireAuth, requirePermission('roles:manage', 'users:view', 'settings:view', 'company:read'), async (req, res) => {
  try {
    const allRoles = await db.select().from(roles);
    const allPerms = await db.select().from(permissions);

    const rolePermsMap: Record<string, string[]> = {};

    for (const r of allRoles) {
      const dbRolePerms = await db
        .select({ code: permissions.code })
        .from(rolePermissions)
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(eq(rolePermissions.roleId, r.id));

      if (dbRolePerms.length > 0) {
        rolePermsMap[r.id] = dbRolePerms.map(p => p.code);
      } else {
        const norm = r.name || r.code;
        const defaults = SYSTEM_ROLE_PERMISSIONS[norm as keyof typeof SYSTEM_ROLE_PERMISSIONS] || [];
        rolePermsMap[r.id] = defaults.includes('*') ? ALL_PERMISSIONS : defaults;
      }
    }

    res.json({
      roles: allRoles,
      permissions: allPerms,
      rolePermissionsMap: rolePermsMap,
      allPermissionCodes: ALL_PERMISSIONS
    });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

// PUT /api/rbac/roles/:roleId/permissions — Update permissions for a specific role
router.put("/roles/:roleId/permissions", requireAuth, requirePermission('roles:manage'), async (req, res) => {
  try {
    const { roleId } = req.params;
    const { permissionCodes } = req.body;

    if (!Array.isArray(permissionCodes)) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "permissionCodes must be an array of strings" });
      return;
    }

    const targetRole = await db.select().from(roles).where(eq(roles.id, roleId)).get();
    if (!targetRole) {
      res.status(404).json({ error: "NOT_FOUND", message: "Role not found" });
      return;
    }

    // Clear existing permissions for this role
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));

    for (const code of permissionCodes) {
      const permRec = await db.select().from(permissions).where(eq(permissions.code, code)).get();
      if (permRec) {
        await db.insert(rolePermissions).values({
          id: crypto.randomUUID(),
          roleId,
          permissionId: permRec.id
        }).catch(() => {});
      }
    }

    await AuditService.log({
      req,
      action: "ROLE_PERMISSIONS_UPDATED",
      entityType: "ROLE",
      entityId: roleId,
      module: "RBAC",
      afterData: { roleName: targetRole.name, count: permissionCodes.length },
      metadata: { roleId, permissionCodes }
    });

    res.json({
      message: `Permissions updated successfully for role ${targetRole.name}`,
      roleId,
      permissionCodes
    });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

// GET /api/rbac/members/:membershipId/permissions — Get member permissions & overrides
router.get("/members/:membershipId/permissions", requireAuth, requirePermission('users:view', 'roles:manage'), async (req, res) => {
  try {
    const { membershipId } = req.params;
    const effectivePermissions = await RbacService.evaluateEffectivePermissions(membershipId);
    const overrides = await RbacService.getExplicitOverrides(membershipId);
    const { roles: assignedRoles, primaryRole } = await RbacService.getMemberRoles(membershipId);

    res.json({
      membershipId,
      primaryRole,
      assignedRoles,
      effectivePermissions,
      overrides
    });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

// PUT /api/rbac/members/:membershipId/overrides — Set overrides for member
router.put("/members/:membershipId/overrides", requireAuth, requirePermission('roles:manage'), async (req, res) => {
  try {
    const { membershipId } = req.params;
    const { overrides } = req.body; // array of { permissionCode, effect: 'ALLOW' | 'DENY', reason }

    if (!Array.isArray(overrides)) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "overrides must be an array" });
      return;
    }

    // Clear existing overrides
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.companyUserId, membershipId));

    for (const ov of overrides) {
      if (ov.permissionCode && ['ALLOW', 'DENY'].includes(ov.effect)) {
        await db.insert(userPermissionOverrides).values({
          id: crypto.randomUUID(),
          companyUserId: membershipId,
          permissionCode: ov.permissionCode,
          effect: ov.effect,
          reason: ov.reason || 'Matrix Override'
        });
      }
    }

    const updatedEffective = await RbacService.evaluateEffectivePermissions(membershipId);

    await AuditService.log({
      req,
      action: "MEMBER_OVERRIDES_UPDATED",
      entityType: "MEMBERSHIP",
      entityId: membershipId,
      module: "RBAC",
      afterData: { overrideCount: overrides.length },
      metadata: { membershipId, overrides }
    });

    res.json({
      message: "Member permission overrides updated successfully",
      membershipId,
      effectivePermissions: updatedEffective
    });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
  }
});

export default router;
