import { Router } from "express";
import { db } from "../db";
import { 
  roles, 
  permissions, 
  rolePermissions, 
  companyUsers, 
  userPermissionOverrides, 
  sodRestrictions, 
  users,
  userModuleAssignments,
  userModuleAssignmentHistory
} from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireMinRole, normalizeRole, LedgerRole } from "../auth";
import { RbacService, ALL_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, INCOMPATIBLE_ROLE_PAIRS } from "../services/rbacService";
import { AuditService } from "../services/auditService";
import { CANONICAL_ERP_MODULES, DEFAULT_ROLE_MODULE_ASSIGNMENTS } from "../../shared/moduleRegistry";
import { 
  CANONICAL_PERMISSION_CATALOG, 
  ROLE_TEMPLATES_CATALOG, 
  CANONICAL_ROLES_ORDER,
  normalizeDataScope
} from "../../shared/rbacCatalog";
import crypto from "crypto";

const router = Router();

/**
 * Helper to resolve either a companyUsers.id (membershipId) or users.id into the valid companyUsers row
 */
async function resolveMembership(idOrUserId: string, companyId: string) {
  let membership = await db
    .select()
    .from(companyUsers)
    .where(and(eq(companyUsers.id, idOrUserId), eq(companyUsers.companyId, companyId)))
    .get();
  if (!membership) {
    membership = await db
      .select()
      .from(companyUsers)
      .where(and(eq(companyUsers.userId, idOrUserId), eq(companyUsers.companyId, companyId)))
      .get();
  }
  return membership;
}

/**
 * GET /api/rbac/matrix
 * Returns the full RBAC matrix including the authoritative Role Permissions Catalog,
 * active versioned Role Templates (standard + custom), compatibility rules, system roles, permissions, and SoD rules.
 */
router.get("/matrix", requireAuth, requireMinRole("Read-only User"), async (req, res) => {
  try {
    for (const rName of CANONICAL_ROLES_ORDER) {
      await RbacService.ensureRoleRecord(rName);
    }
    const roleTemplates = await RbacService.getAllActiveRoleTemplates();
    const compatibilityRules = await RbacService.getRoleCompatibilityRules();

    const allRoles = await db.select().from(roles);
    const allPerms = await db.select().from(permissions);
    const allRolePerms = await db.select().from(rolePermissions);
    const sodRules = await db.select().from(sodRestrictions);

    const rolePermMap: Record<string, string[]> = {};
    for (const r of allRoles) {
      const rpIds = allRolePerms.filter((rp: any) => rp.roleId === r.id).map((rp: any) => rp.permissionId);
      const permCodes = allPerms.filter((p: any) => rpIds.includes(p.id)).map((p: any) => p.code);
      rolePermMap[r.id] = permCodes;
    }

    // Build active rolePermissionsByName from active role templates
    const activeRolePermissionsByName: Record<string, string[]> = {};
    for (const tpl of roleTemplates) {
      activeRolePermissionsByName[tpl.roleName] = tpl.defaultPermissionCodes;
    }

    res.json({
      roles: allRoles,
      permissions: allPerms,
      permissionCatalog: CANONICAL_PERMISSION_CATALOG,
      roleTemplates,
      compatibilityRules,
      rolePermissionsMap: rolePermMap,
      systemRolePermissions: activeRolePermissionsByName,
      allPermissionCodes: ALL_PERMISSIONS,
      canonicalPermissionCodes: CANONICAL_PERMISSION_CATALOG.map(p => p.code),
      sodRules,
      incompatibleRolePairs: INCOMPATIBLE_ROLE_PAIRS.map(([roleA, roleB, description]) => ({
        roleA,
        roleB,
        description
      }))
    });
  } catch (err: any) {
    res.status(500).json({ error: "RBAC_MATRIX_ERROR", message: err.message });
  }
});

/**
 * GET /api/rbac/compatibility-rules
 */
router.get("/compatibility-rules", requireAuth, requireMinRole("Read-only User"), async (req, res) => {
  try {
    const rules = await RbacService.getRoleCompatibilityRules();
    res.json({ compatibilityRules: rules });
  } catch (err: any) {
    res.status(500).json({ error: "COMPATIBILITY_RULES_ERROR", message: err.message });
  }
});

/**
 * POST /api/rbac/compatibility-rules
 * Create or update a role compatibility rule between two roles.
 */
router.post("/compatibility-rules", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  try {
    const { roleA, roleB, compatibilityType, reason, conditions } = req.body || {};
    const rule = await RbacService.upsertRoleCompatibilityRule(req, {
      roleA,
      roleB,
      compatibilityType,
      reason,
      conditions
    });
    const allRules = await RbacService.getRoleCompatibilityRules();
    res.json({
      message: `Updated compatibility rule between ${rule.roleA} and ${rule.roleB} (${rule.compatibilityType}).`,
      rule,
      compatibilityRules: allRules
    });
  } catch (err: any) {
    res.status(400).json({ error: "COMPATIBILITY_RULE_UPDATE_ERROR", message: err.message });
  }
});

/**
 * POST /api/rbac/validate-compatibility
 * Validate a set of roles for compatibility before or during multi-role assignment.
 */
router.post("/validate-compatibility", requireAuth, requireMinRole("Read-only User"), async (req, res) => {
  try {
    const { roles: roleNames } = req.body || {};
    if (!Array.isArray(roleNames)) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "roles array is required" });
      return;
    }
    const check = await RbacService.validateRoleCompatibility(roleNames);
    res.json(check);
  } catch (err: any) {
    res.status(400).json({ error: "COMPATIBILITY_VALIDATE_ERROR", message: err.message });
  }
});

/**
 * GET /api/rbac/role-templates
 * Returns all standard + custom Role Templates with their active configuration.
 */
router.get("/role-templates", requireAuth, requireMinRole("Read-only User"), async (req, res) => {
  try {
    const templates = await RbacService.getAllActiveRoleTemplates();
    res.json({ templates, catalog: CANONICAL_PERMISSION_CATALOG });
  } catch (err: any) {
    res.status(500).json({ error: "ROLE_TEMPLATES_ERROR", message: err.message });
  }
});

/**
 * POST /api/rbac/custom-roles
 * Create or clone a custom role in the Role Permissions Catalog.
 */
router.post("/custom-roles", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  try {
    const {
      roleName,
      roleCode,
      purpose,
      clonedFrom,
      defaultPrimaryModules,
      defaultSubmodules,
      defaultPermissionCodes,
      defaultDataScope,
      defaultApprovalLimitCentavos,
      sodRestrictions: sodList,
      changeReason
    } = req.body || {};

    const created = await RbacService.createOrCloneCustomRole(req, {
      roleName,
      roleCode,
      purpose,
      clonedFrom,
      defaultPrimaryModules,
      defaultSubmodules,
      defaultPermissionCodes,
      defaultDataScope: defaultDataScope ? normalizeDataScope(defaultDataScope) : undefined,
      defaultApprovalLimitCentavos: defaultApprovalLimitCentavos !== undefined ? Number(defaultApprovalLimitCentavos) : undefined,
      sodRestrictions: sodList,
      changeReason
    });

    const allTemplates = await RbacService.getAllActiveRoleTemplates();
    res.json({
      message: `Custom role '${created.roleName}' created in Role Permissions Catalog (v${created.versionNumber}).`,
      template: created,
      roleTemplates: allTemplates
    });
  } catch (err: any) {
    res.status(400).json({ error: "CUSTOM_ROLE_CREATE_ERROR", message: err.message });
  }
});

/**
 * DELETE /api/rbac/custom-roles/:roleName
 * Archive an unused custom role template.
 */
router.delete("/custom-roles/:roleName", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  try {
    const roleName = decodeURIComponent(req.params.roleName);
    const reason = req.body?.reason || req.query?.reason?.toString() || "Archived custom role";
    const result = await RbacService.archiveCustomRole(req, roleName, reason);
    const allTemplates = await RbacService.getAllActiveRoleTemplates();
    res.json({
      message: `Archived custom role '${result.archivedRole}'.`,
      ...result,
      roleTemplates: allTemplates
    });
  } catch (err: any) {
    res.status(400).json({ error: "CUSTOM_ROLE_ARCHIVE_ERROR", message: err.message });
  }
});

/**
 * GET /api/rbac/role-templates/:roleName
 * Returns the active Role Template and version history for a specific standard or custom role.
 */
router.get("/role-templates/:roleName", requireAuth, requireMinRole("Read-only User"), async (req, res) => {
  try {
    const roleName = await RbacService.resolveCanonicalOrCustomRoleName(decodeURIComponent(req.params.roleName));
    const active = await RbacService.getActiveRoleTemplate(roleName);
    const history = await RbacService.getRoleTemplateHistory(roleName);
    res.json({ template: active, history });
  } catch (err: any) {
    res.status(500).json({ error: "ROLE_TEMPLATE_FETCH_ERROR", message: err.message });
  }
});

/**
 * POST /api/rbac/role-templates/:roleName/preview
 * Computes the impact preview before publishing changes to a Role Template.
 */
router.post("/role-templates/:roleName/preview", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  try {
    const roleName = await RbacService.resolveCanonicalOrCustomRoleName(decodeURIComponent(req.params.roleName));
    const impact = await RbacService.previewRoleTemplateImpact(roleName, req.body || {});
    res.json(impact);
  } catch (err: any) {
    res.status(400).json({ error: "ROLE_TEMPLATE_PREVIEW_ERROR", message: err.message });
  }
});

/**
 * POST /api/rbac/role-templates/:roleName/publish
 * Publishes a new version of a Role Template in the Role Permissions Catalog and syncs inherited users.
 */
router.post("/role-templates/:roleName/publish", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  try {
    const roleName = await RbacService.resolveCanonicalOrCustomRoleName(decodeURIComponent(req.params.roleName));
    const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
    if (roleName === "Company Owner" && !requesterRoles.includes("Company Owner")) {
      res.status(403).json({
        error: "PERMISSION_DENIED",
        message: "Only a Company Owner can modify the Company Owner role template."
      });
      return;
    }

    const {
      purpose,
      defaultPrimaryModules,
      defaultSubmodules,
      defaultPermissionCodes,
      defaultDataScope,
      defaultApprovalLimitCentavos,
      sodRestrictions: sodList,
      changeReason
    } = req.body;

    const published = await RbacService.publishRoleTemplateVersion(req, roleName, {
      purpose,
      defaultPrimaryModules: Array.isArray(defaultPrimaryModules) ? defaultPrimaryModules : [],
      defaultSubmodules: defaultSubmodules || {},
      defaultPermissionCodes: Array.isArray(defaultPermissionCodes) ? defaultPermissionCodes : [],
      defaultDataScope: normalizeDataScope(defaultDataScope),
      defaultApprovalLimitCentavos: Number(defaultApprovalLimitCentavos ?? 0),
      sodRestrictions: Array.isArray(sodList) ? sodList : undefined,
      changeReason: changeReason || ""
    });

    const history = await RbacService.getRoleTemplateHistory(roleName);
    res.json({
      message: `Published ${roleName} template v${published.versionNumber} and synchronized inherited users.`,
      template: published,
      history
    });
  } catch (err: any) {
    res.status(400).json({ error: "ROLE_TEMPLATE_PUBLISH_ERROR", message: err.message });
  }
});

/**
 * POST /api/rbac/role-templates/:roleName/rollback
 * Rolls back a Role Template to a previous version number.
 */
router.post("/role-templates/:roleName/rollback", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  try {
    const roleName = await RbacService.resolveCanonicalOrCustomRoleName(decodeURIComponent(req.params.roleName));
    const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
    if (roleName === "Company Owner" && !requesterRoles.includes("Company Owner")) {
      res.status(403).json({
        error: "PERMISSION_DENIED",
        message: "Only a Company Owner can rollback the Company Owner role template."
      });
      return;
    }

    const { targetVersionNumber, reason } = req.body;
    if (!targetVersionNumber) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "targetVersionNumber is required" });
      return;
    }

    const restored = await RbacService.rollbackRoleTemplateVersion(
      req,
      roleName,
      Number(targetVersionNumber),
      reason
    );
    const history = await RbacService.getRoleTemplateHistory(roleName);

    res.json({
      message: `Rolled back ${roleName} template to v${targetVersionNumber} (published as v${restored.versionNumber}).`,
      template: restored,
      history
    });
  } catch (err: any) {
    res.status(400).json({ error: "ROLE_TEMPLATE_ROLLBACK_ERROR", message: err.message });
  }
});

/**
 * PUT /api/rbac/roles/:roleId/permissions
 * Update permissions assigned to a specific role
 */
router.put("/roles/:roleId/permissions", requireAuth, requireMinRole("Company Owner"), async (req, res) => {
  const { roleId } = req.params;
  const { permissionCodes } = req.body;

  if (!Array.isArray(permissionCodes)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "permissionCodes array is required" });
    return;
  }

  try {
    const roleRec = await db.select().from(roles).where(eq(roles.id, roleId)).get();
    if (!roleRec) {
      res.status(404).json({ error: "NOT_FOUND", message: "Role not found" });
      return;
    }

    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));

    for (const code of permissionCodes) {
      if (code === '*') continue;
      let permRec = await db.select().from(permissions).where(eq(permissions.code, code)).get();
      if (!permRec) {
        const newPermId = crypto.randomUUID();
        await db.insert(permissions).values({
          id: newPermId,
          code,
          description: `Permission to ${code.replace(':', ' ')}`,
          module: code.split(':')[0].toUpperCase()
        });
        permRec = { id: newPermId, code, description: '', module: '' };
      }

      await db.insert(rolePermissions).values({
        id: crypto.randomUUID(),
        roleId,
        permissionId: permRec.id
      }).catch(() => {});
    }

    await AuditService.log({
      req,
      action: "ROLE_PERMISSIONS_UPDATED",
      entityType: "ROLE",
      entityId: roleId,
      entityName: roleRec.name,
      module: "RBAC",
      afterData: { permissionCodes }
    });

    res.json({ message: `Updated permissions for role ${roleRec.name}`, permissionCodes });
  } catch (err: any) {
    res.status(500).json({ error: "ROLE_UPDATE_ERROR", message: err.message });
  }
});

/**
 * GET /api/rbac/members/:membershipId/roles
 * Get all active and historical role assignments for a member.
 */
router.get("/members/:membershipId/roles", requireAuth, requireMinRole("Read-only User"), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Company member not found" });
      return;
    }
    const roleData = await RbacService.getMemberRoles(membership.id);
    const resolvedAccess = await RbacService.resolveEffectiveAccess(membership.id);
    res.json({
      membershipId: membership.id,
      ...roleData,
      resolvedAccess
    });
  } catch (err: any) {
    res.status(500).json({ error: "MEMBER_ROLES_FETCH_ERROR", message: err.message });
  }
});

/**
 * POST /api/rbac/members/:membershipId/roles
 * Assign an additional compatible role (or set primary role) to a company member.
 */
router.post("/members/:membershipId/roles", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Company member not found" });
      return;
    }

    const { roleName, isPrimary, effectiveFrom, effectiveTo, reason } = req.body || {};
    if (!roleName) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "roleName is required" });
      return;
    }

    const result = await RbacService.assignRoleToMember(req, membership.id, roleName, {
      isPrimary: Boolean(isPrimary),
      effectiveFrom: effectiveFrom || null,
      effectiveTo: effectiveTo || null,
      reason: reason || `Assigned role ${roleName}`
    });

    const resolvedAccess = await RbacService.resolveEffectiveAccess(membership.id);
    res.json({
      message: `Assigned role '${result.assignedRole}' to member.`,
      ...result,
      resolvedAccess
    });
  } catch (err: any) {
    const status = err.message?.includes("PERMISSION_DENIED") ? 403 : 400;
    res.status(status).json({ error: "ROLE_ASSIGN_ERROR", message: err.message });
  }
});

/**
 * DELETE /api/rbac/members/:membershipId/roles/:roleNameOrId
 * Revoke a specific role assignment from a company member.
 */
router.delete("/members/:membershipId/roles/:roleNameOrId", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Company member not found" });
      return;
    }

    const roleNameOrId = decodeURIComponent(req.params.roleNameOrId);
    const reason = req.body?.reason || req.query?.reason?.toString() || `Revoked role ${roleNameOrId}`;

    const result = await RbacService.removeRoleFromMember(req, membership.id, roleNameOrId, reason);
    const resolvedAccess = await RbacService.resolveEffectiveAccess(membership.id);

    res.json({
      message: `Revoked role '${result.removedRole}' from member.`,
      ...result,
      resolvedAccess
    });
  } catch (err: any) {
    const status = err.message?.includes("PERMISSION_DENIED") ? 403 : 400;
    res.status(status).json({ error: "ROLE_REVOKE_ERROR", message: err.message });
  }
});

/**
 * POST /api/rbac/members/:membershipId/primary-role
 * Promote an existing role (or newly assigned compatible role) to Primary Role for a member.
 */
router.post("/members/:membershipId/primary-role", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Company member not found" });
      return;
    }

    const { roleName, reason } = req.body || {};
    if (!roleName) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "roleName is required" });
      return;
    }

    const result = await RbacService.setPrimaryRoleForMember(req, membership.id, roleName, reason);
    const resolvedAccess = await RbacService.resolveEffectiveAccess(membership.id);

    res.json({
      message: `Primary role updated to '${result.primaryRole}'.`,
      ...result,
      resolvedAccess
    });
  } catch (err: any) {
    const status = err.message?.includes("PERMISSION_DENIED") ? 403 : 400;
    res.status(status).json({ error: "PRIMARY_ROLE_UPDATE_ERROR", message: err.message });
  }
});

/**
 * GET /api/rbac/members/:membershipId/effective-access
 * Authoritative endpoint powering Tab 2 (Live User Access Preview) and Tab 1 (User Module Assignments).
 */
router.get("/members/:membershipId/effective-access", requireAuth, requireMinRole("Read-only User"), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Company member not found" });
      return;
    }
    const resolved = await RbacService.resolveEffectiveAccess(membership.id);
    res.json(resolved);
  } catch (err: any) {
    res.status(500).json({ error: "EFFECTIVE_ACCESS_ERROR", message: err.message });
  }
});

/**
 * GET /api/rbac/members/:membershipId/permissions
 * Evaluate effective permissions + explicit overrides for a member
 */
router.get("/members/:membershipId/permissions", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Member not found in active company" });
      return;
    }
    const targetId = membership.id;

    const resolved = await RbacService.resolveEffectiveAccess(targetId);
    const overrides = await RbacService.getExplicitOverrides(targetId);

    res.json({
      membershipId: targetId,
      primaryRole: resolved.primaryRole,
      roles: resolved.assignedRoles,
      effectivePermissions: resolved.effectivePermissions,
      overrides,
      resolvedAccess: resolved
    });
  } catch (err: any) {
    res.status(500).json({ error: "MEMBER_PERMS_ERROR", message: err.message });
  }
});

/**
 * POST /api/rbac/members/:membershipId/overrides
 * Add or update an explicit ALLOW or DENY permission override for a member
 */
router.post("/members/:membershipId/overrides", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { permissionCode, effect, reason } = req.body;

  if (!permissionCode || !['ALLOW', 'DENY'].includes(effect)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "permissionCode and valid effect ('ALLOW' or 'DENY') are required" });
    return;
  }

  try {
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Member not found in active company" });
      return;
    }
    const targetId = membership.id;

    await RbacService.assertActorCanModifyMember(req, targetId, 'MODIFY_PERMISSIONS');

    const result = await RbacService.setExplicitOverride(req, targetId, permissionCode, effect, reason);
    const resolved = await RbacService.resolveEffectiveAccess(targetId);
    const overrides = await RbacService.getExplicitOverrides(targetId);

    res.json({
      ...result,
      effectivePermissions: resolved.effectivePermissions,
      overrides,
      resolvedAccess: resolved
    });
  } catch (err: any) {
    const isOwnerPolicy = err.message?.includes("OWNER_UNRESTRICTED_POLICY");
    const status = err.message?.includes("PERMISSION_DENIED") ? 403 : 400;
    res.status(status).json({
      error: isOwnerPolicy ? "OWNER_UNRESTRICTED_POLICY" : "OVERRIDE_SET_ERROR",
      message: err.message
    });
  }
});

/**
 * DELETE /api/rbac/members/:membershipId/overrides/:permissionCode
 * Remove an explicit permission override
 */
router.delete("/members/:membershipId/overrides/:permissionCode", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Member not found in active company" });
      return;
    }
    const targetId = membership.id;
    const { permissionCode } = req.params;

    await RbacService.assertActorCanModifyMember(req, targetId, 'MODIFY_PERMISSIONS');

    const result = await RbacService.removeExplicitOverride(req, targetId, permissionCode);
    const resolved = await RbacService.resolveEffectiveAccess(targetId);
    const overrides = await RbacService.getExplicitOverrides(targetId);

    res.json({
      ...result,
      effectivePermissions: resolved.effectivePermissions,
      overrides,
      resolvedAccess: resolved
    });
  } catch (err: any) {
    const status = err.message?.includes("PERMISSION_DENIED") ? 403 : 500;
    res.status(status).json({ error: "OVERRIDE_DELETE_ERROR", message: err.message });
  }
});

/**
 * GET /api/rbac/members/:membershipId/module-assignments
 * Retrieve explicit module assignments, history, and centralized effective access for a user
 */
router.get("/members/:membershipId/module-assignments", requireAuth, requireMinRole("Read-only User"), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Member not found in active company" });
      return;
    }
    const targetId = membership.id;

    // Resolve effective access
    const resolvedAccess = await RbacService.resolveEffectiveAccess(targetId);

    const assignments = await db
      .select()
      .from(userModuleAssignments)
      .where(eq(userModuleAssignments.companyUserId, targetId));

    const history = await db
      .select()
      .from(userModuleAssignmentHistory)
      .where(eq(userModuleAssignmentHistory.companyUserId, targetId))
      .orderBy(desc(userModuleAssignmentHistory.changedAt));

    res.json({
      membershipId: targetId,
      assignments: assignments.map((a: any) => ({
        ...a,
        submoduleIds: a.submoduleIds ? JSON.parse(a.submoduleIds) : [],
        actions: a.actions ? JSON.parse(a.actions) : []
      })),
      history: history.map((h: any) => ({
        ...h,
        createdAt: h.changedAt,
        previousAssignment: h.previousAssignment ? JSON.parse(h.previousAssignment) : null,
        newAssignment: h.newAssignment ? JSON.parse(h.newAssignment) : null
      })),
      resolvedAccess,
      canonicalModules: CANONICAL_ERP_MODULES,
      defaultRoleAssignments: DEFAULT_ROLE_MODULE_ASSIGNMENTS
    });
  } catch (err: any) {
    res.status(500).json({ error: "MODULE_ASSIGNMENT_FETCH_ERROR", message: err.message });
  }
});

/**
 * POST /api/rbac/members/:membershipId/reset-to-role-default
 * Reset a user's module assignments and permission overrides back to their assigned roles' active default templates.
 */
router.post("/members/:membershipId/reset-to-role-default", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  try {
    const companyId = req.activeCompany!.id;
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Company member not found" });
      return;
    }

    await RbacService.assertActorCanModifyMember(req, membership.id, 'RESET_DEFAULTS');

    const { primaryRole, assignedRoles } = await RbacService.getMemberRoles(membership.id);
    const reason = req.body?.reason?.trim() || `Reset [${assignedRoles.join(', ')}] module & permission assignments to Role Permissions Catalog default templates`;

    // Clear explicit permission overrides as well
    await db
      .delete(userPermissionOverrides)
      .where(eq(userPermissionOverrides.companyUserId, membership.id));

    await RbacService.syncMultiRoleModulesForUser(
      membership.id,
      assignedRoles,
      req.user!.id,
      req.user!.displayName || req.user!.email,
      reason,
      true // force reset to role defaults
    );

    await db.update(companyUsers).set({ updatedAt: new Date() }).where(eq(companyUsers.id, membership.id));

    const resolvedAccess = await RbacService.resolveEffectiveAccess(membership.id);

    await AuditService.log({
      req,
      companyId,
      action: "USER_RESET_TO_ROLE_DEFAULT",
      entityType: "MEMBERSHIP",
      entityId: membership.id,
      module: "RBAC",
      reason,
      afterData: {
        primaryRole,
        assignedRoles,
        templateVersion: resolvedAccess.roleTemplateVersion,
        effectiveModuleIds: resolvedAccess.effectiveModuleIds
      }
    });

    res.json({
      message: `Reset user assignments to [${assignedRoles.join(', ')}] default template(s).`,
      resolvedAccess
    });
  } catch (err: any) {
    const status = err.message?.includes("PERMISSION_DENIED") ? 403 : 400;
    res.status(status).json({ error: "RESET_ROLE_DEFAULT_ERROR", message: err.message });
  }
});

/**
 * PUT /api/rbac/members/:membershipId/module-assignments
 * Assign or update primary modules, submodules, allowed actions, data scopes, and approval limits for a user
 * while tracking provenance (INHERITED_FROM_ROLE, COMBINED_ROLES, USER_SPECIFIC_GRANT, USER_SPECIFIC_DENY)
 * and enforcing hard role restrictions across all assigned roles.
 */
router.put("/members/:membershipId/module-assignments", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const rawAssignments = req.body.moduleAssignments || req.body.assignments;
  const moduleAssignments = Array.isArray(rawAssignments) ? rawAssignments : null;
  const { reason } = req.body;

  if (!moduleAssignments) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "moduleAssignments array is required" });
    return;
  }

  try {
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Company member not found" });
      return;
    }
    const targetId = membership.id;

    // Concurrency conflict check (HTTP 409)
    if (req.body.expectedUpdatedAt && membership.updatedAt) {
      const clientTime = new Date(req.body.expectedUpdatedAt).getTime();
      const serverTime = new Date(membership.updatedAt).getTime();
      if (!isNaN(clientTime) && !isNaN(serverTime) && clientTime !== serverTime) {
        res.status(409).json({
          error: "CONCURRENT_MODIFICATION_CONFLICT",
          message: "User permissions were modified concurrently by another administrator. Please reload and try again."
        });
        return;
      }
    }

    await RbacService.assertActorCanModifyMember(req, targetId, 'MODIFY_MODULES');

    const { primaryRole, assignedRoles } = await RbacService.getMemberRoles(targetId);
    if (assignedRoles.includes('Company Owner')) {
      const requestedMods = new Map<string, any>();
      for (const item of moduleAssignments) {
        if (item && item.moduleId) requestedMods.set(item.moduleId, item);
      }
      const omitsCanonicalMod = CANONICAL_ERP_MODULES.some(m => {
        const reqItem = requestedMods.get(m.id);
        if (!reqItem || reqItem.effect === 'DENY') return true;
        if (Array.isArray(reqItem.submoduleIds) && m.submodules.some(s => !reqItem.submoduleIds.includes(s.id))) return true;
        if (reqItem.dataScope && normalizeDataScope(reqItem.dataScope) !== 'COMPANY_WIDE') return true;
        if (reqItem.approvalLimitCentavos !== undefined && Number(reqItem.approvalLimitCentavos) !== -1) return true;
        return false;
      });
      if (omitsCanonicalMod) {
        res.status(400).json({
          error: "OWNER_UNRESTRICTED_POLICY",
          message: "Company Owner holds permanent unrestricted access across all 16 ERP modules, 36 submodules, COMPANY_WIDE scope, and unlimited (-1) approval authority."
        });
        return;
      }
    }
    const roleTemplates = await Promise.all(
      assignedRoles.map(rName => RbacService.getActiveRoleTemplate(rName))
    );
    const activeTpl = roleTemplates[0] || (await RbacService.getActiveRoleTemplate(primaryRole));

    // Pre-validation: enforce hard restriction immunity (e.g. Auditor cannot post or create transactions)
    for (const item of moduleAssignments) {
      if (item && item.actions && Array.isArray(item.actions)) {
        if (assignedRoles.includes('Auditor') && item.actions.some((a: string) => ['post', 'create', 'edit', 'delete'].includes(a))) {
          res.status(400).json({
            error: "POLICY_VIOLATION",
            message: "Hard role restriction: Auditor cannot be granted transactional create, edit, post, or delete permissions."
          });
          return;
        }
      }
    }

    const existing = await db
      .select()
      .from(userModuleAssignments)
      .where(eq(userModuleAssignments.companyUserId, targetId));

    const requestedMap = new Map<string, any>();
    for (const item of moduleAssignments) {
      if (item && item.moduleId) {
        requestedMap.set(item.moduleId, item);
      }
    }

    const allAssignedReadOnly = roleTemplates.every(t => t.isReadOnlyRole);
    const canAnyRoleApprove = roleTemplates.some(t => t.canApproveFinancialTransactions);

    const insertedAssignments: any[] = [];

    await db.transaction(async (tx) => {
      // Delete existing assignments inside transaction
      await tx
        .delete(userModuleAssignments)
        .where(eq(userModuleAssignments.companyUserId, targetId));

      for (const mod of CANONICAL_ERP_MODULES) {
        const modId = mod.id;
        const grantingTemplates = roleTemplates.filter(
          t => t.defaultPrimaryModules.includes(modId) && !t.hardRestrictedModuleIds.includes(modId)
        );
        const isHardRestrictedInAll =
          roleTemplates.every(t => t.hardRestrictedModuleIds.includes(modId)) &&
          grantingTemplates.length === 0;
        const isRoleDefault = grantingTemplates.length > 0;
        const item = requestedMap.get(modId);

        // Enforce hard role restriction: cannot grant modules hard-restricted across all assigned roles
        if (isHardRestrictedInAll) {
          continue;
        }

        if (item && item.effect !== 'DENY') {
          const unionDefaultSubs = new Set<string>();
          for (const t of grantingTemplates) {
            const subs = t.defaultSubmodules[modId] || mod.submodules.map(s => s.id);
            subs.forEach(s => unionDefaultSubs.add(s));
          }
          const defaultSubs = unionDefaultSubs.size > 0
            ? Array.from(unionDefaultSubs)
            : mod.submodules.map(s => s.id);

          const requestedSubs = Array.isArray(item.submoduleIds)
            ? item.submoduleIds
            : defaultSubs;

          const modCatalogPerms = CANONICAL_PERMISSION_CATALOG.filter(p => p.primaryModuleId === modId);
          const unionDefaultActions = new Set<string>(['view']);
          for (const t of roleTemplates) {
            for (const p of modCatalogPerms) {
              if (t.defaultPermissionCodes.includes('*') || t.defaultPermissionCodes.includes(p.code)) {
                unionDefaultActions.add(p.action);
              }
            }
          }
          const defaultActions = Array.from(unionDefaultActions);

          const requestedActions = Array.isArray(item.actions)
            ? item.actions
            : defaultActions;

          // Sanitize actions against hard role restrictions across all assigned roles
          const sanitizedActions = requestedActions.filter((act: string) => {
            if (allAssignedReadOnly && act !== 'view' && !(assignedRoles.includes('Auditor') && act === 'export')) {
              return false;
            }
            const matchingPerms = modCatalogPerms.filter(p => p.action === act);
            if (matchingPerms.length > 0) {
              const deniedInAllRoles = matchingPerms.every(p =>
                roleTemplates.every(t => {
                  const normName = normalizeRole(t.roleName);
                  const explicitlyGranted = t.defaultPermissionCodes.includes('*') || t.defaultPermissionCodes.includes(p.code);
                  return p.hardRestrictedRoles.includes(normName) && !explicitlyGranted;
                })
              );
              if (deniedInAllRoles) return false;
            }
            return true;
          });

          const scope = normalizeDataScope(item.dataScope || activeTpl.defaultDataScope);
          const limitCentavos = canAnyRoleApprove
            ? Number(item.approvalLimitCentavos ?? activeTpl.defaultApprovalLimitCentavos)
            : 0;

          const isCustomizedScopeOrLimit =
            scope !== activeTpl.defaultDataScope ||
            limitCentavos !== (canAnyRoleApprove ? activeTpl.defaultApprovalLimitCentavos : 0);

          const isCustomizedSubs = requestedSubs.length !== defaultSubs.length || requestedSubs.some(s => !defaultSubs.includes(s));
          const isCustomizedActions = sanitizedActions.length !== defaultActions.length || sanitizedActions.some(a => !defaultActions.includes(a));

          const origin = (!isRoleDefault || isCustomizedScopeOrLimit || isCustomizedSubs || isCustomizedActions || item.origin === 'USER_SPECIFIC_GRANT')
            ? 'USER_SPECIFIC_GRANT'
            : (grantingTemplates.length > 1 ? 'COMBINED_ROLES' : 'INHERITED_FROM_ROLE');

          const newId = crypto.randomUUID();
          const record = {
            id: newId,
            companyUserId: targetId,
            moduleId: modId,
            submoduleIds: JSON.stringify(requestedSubs),
            actions: JSON.stringify(sanitizedActions),
            dataScope: scope,
            departmentScopeId: item.departmentScopeId || null,
            projectScopeId: item.projectScopeId || null,
            costCenterScopeId: item.costCenterScopeId || null,
            approvalLimitCentavos: limitCentavos,
            origin,
            effect: 'ALLOW',
            templateVersion: activeTpl.versionNumber,
            reason: reason || `Assigned via RBAC Matrix`,
            assignedBy: req.user!.id,
            assignedByName: req.user!.displayName || req.user!.email
          };
          await tx.insert(userModuleAssignments).values(record);
          insertedAssignments.push(record);
        } else {
          // Module is unchecked -> record explicit USER_SPECIFIC_DENY so it overrides any role templates!
          const denyId = crypto.randomUUID();
          const denyRecord = {
            id: denyId,
            companyUserId: targetId,
            moduleId: modId,
            submoduleIds: JSON.stringify([]),
            actions: JSON.stringify([]),
            dataScope: activeTpl.defaultDataScope,
            departmentScopeId: null,
            projectScopeId: null,
            costCenterScopeId: null,
            approvalLimitCentavos: 0,
            origin: 'USER_SPECIFIC_DENY',
            effect: 'DENY',
            templateVersion: activeTpl.versionNumber,
            reason: reason || `Explicitly revoked module in RBAC Matrix`,
            assignedBy: req.user!.id,
            assignedByName: req.user!.displayName || req.user!.email
          };
          await tx.insert(userModuleAssignments).values(denyRecord);
          insertedAssignments.push(denyRecord);
        }
      }

      // Record history entry inside transaction
      await tx.insert(userModuleAssignmentHistory).values({
        id: crypto.randomUUID(),
        companyUserId: targetId,
        moduleId: "ALL_MODULES",
        actionType: "UPDATE",
        previousAssignment: JSON.stringify(existing.map((e: any) => ({ moduleId: e.moduleId, origin: e.origin, effect: e.effect }))),
        newAssignment: JSON.stringify(insertedAssignments.map(a => ({ moduleId: a.moduleId, origin: a.origin, effect: a.effect, dataScope: a.dataScope }))),
        reason: reason || "Updated user module assignments via RBAC Matrix",
        changedBy: req.user!.id,
        changedByName: req.user!.displayName || req.user!.email
      });

      // Update membership timestamp for optimistic concurrency
      const nextUpdatedAt = new Date(Math.max(Date.now(), (membership.updatedAt ? new Date(membership.updatedAt).getTime() + 1000 : Date.now())));
      await tx.update(companyUsers).set({ updatedAt: nextUpdatedAt }).where(eq(companyUsers.id, targetId));
    });

    const resolvedAccess = await RbacService.resolveEffectiveAccess(targetId);

    await AuditService.log({
      req,
      companyId,
      action: "USER_MODULE_ASSIGNMENTS_UPDATED",
      entityType: "MEMBERSHIP",
      entityId: targetId,
      module: "RBAC",
      reason: reason || "Updated user module assignments",
      beforeData: { previousModules: existing.filter((e: any) => e.effect !== 'DENY').map((e: any) => e.moduleId) },
      afterData: { effectiveModules: resolvedAccess.effectiveModuleIds }
    });

    res.json({
      message: "User module assignments updated successfully",
      assignments: insertedAssignments,
      resolvedAccess
    });
  } catch (err: any) {
    console.error('[RBAC PUT Error]', err);
    const status = err.message?.includes("PERMISSION_DENIED") ? 403 : 500;
    res.status(status).json({ error: "MODULE_ASSIGNMENT_UPDATE_ERROR", message: err.message });
  }
});

/**
 * PUT /api/rbac/members/:membershipId/data-scope
 * Set default and module data scope for a member (e.g. OWN_RECORDS, COMPANY_WIDE)
 */
router.put("/members/:membershipId/data-scope", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { dataScope, departmentScopeId, projectScopeId, costCenterScopeId, justification } = req.body;
  if (!dataScope) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "dataScope is required" });
    return;
  }
  try {
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Member not found" });
      return;
    }
    await RbacService.assertActorCanModifyMember(req, membership.id, 'MODIFY_DATA_SCOPE');
    const { assignedRoles: dsRoles } = await RbacService.getMemberRoles(membership.id);
    if (dsRoles.includes('Company Owner') && normalizeDataScope(dataScope) !== 'COMPANY_WIDE') {
      res.status(400).json({
        error: "OWNER_UNRESTRICTED_POLICY",
        message: "Company Owner data scope is permanently locked to COMPANY_WIDE."
      });
      return;
    }
    await db.update(companyUsers).set({
      defaultDataScope: dataScope,
      updatedAt: new Date()
    }).where(eq(companyUsers.id, membership.id));

    await db.update(userModuleAssignments).set({
      dataScope,
      departmentScopeId: departmentScopeId || null,
      projectScopeId: projectScopeId || null,
      costCenterScopeId: costCenterScopeId || null
    }).where(eq(userModuleAssignments.companyUserId, membership.id));

    await AuditService.log({
      req,
      companyId,
      action: "UPDATE_MEMBER_DATA_SCOPE",
      entityType: "MEMBERSHIP",
      entityId: membership.id,
      module: "RBAC",
      reason: justification || "Updated member data scope",
      afterData: { dataScope }
    });

    res.json({ success: true, message: `Data scope updated to ${dataScope}`, dataScope });
  } catch (err: any) {
    res.status(500).json({ error: "DATA_SCOPE_UPDATE_ERROR", message: err.message });
  }
});

/**
 * PUT /api/rbac/members/:membershipId/approval-limit
 * Set transaction approval limit in centavos for a member
 */
router.put("/members/:membershipId/approval-limit", requireAuth, requireMinRole("Company Administrator"), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { approvalLimitCentavos, justification } = req.body;
  if (approvalLimitCentavos === undefined || approvalLimitCentavos === null) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "approvalLimitCentavos is required" });
    return;
  }
  try {
    const membership = await resolveMembership(req.params.membershipId, companyId);
    if (!membership) {
      res.status(404).json({ error: "NOT_FOUND", message: "Member not found" });
      return;
    }
    await RbacService.assertActorCanModifyMember(req, membership.id, 'MODIFY_APPROVAL_LIMIT');
    const { assignedRoles: alRoles } = await RbacService.getMemberRoles(membership.id);
    if (alRoles.includes('Company Owner') && Number(approvalLimitCentavos) !== -1) {
      res.status(400).json({
        error: "OWNER_UNRESTRICTED_POLICY",
        message: "Company Owner approval limit is permanently unlimited (-1)."
      });
      return;
    }
    await db.update(companyUsers).set({
      approvalLimitCentavos: Number(approvalLimitCentavos),
      updatedAt: new Date()
    }).where(eq(companyUsers.id, membership.id));

    await db.update(userModuleAssignments).set({
      approvalLimitCentavos: Number(approvalLimitCentavos)
    }).where(eq(userModuleAssignments.companyUserId, membership.id));

    await AuditService.log({
      req,
      companyId,
      action: "UPDATE_MEMBER_APPROVAL_LIMIT",
      entityType: "MEMBERSHIP",
      entityId: membership.id,
      module: "RBAC",
      reason: justification || "Updated member approval limit",
      afterData: { approvalLimitCentavos: Number(approvalLimitCentavos) }
    });

    res.json({ success: true, message: `Approval limit updated to ${approvalLimitCentavos} centavos`, approvalLimitCentavos: Number(approvalLimitCentavos) });
  } catch (err: any) {
    res.status(500).json({ error: "APPROVAL_LIMIT_UPDATE_ERROR", message: err.message });
  }
});

export default router;
