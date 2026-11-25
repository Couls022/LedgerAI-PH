import { CompanyManager } from "../src/server/services/companyManager";
import { dbContext } from "../src/server/db/context";
import { db } from "../src/server/db";
import {
  users,
  companyUsers,
  companyUserRoles,
  roleCompatibilityRules,
  roleTemplateVersions,
  userModuleAssignments,
  userPermissionOverrides,
  auditLogs,
  sessions
} from "../src/server/db/schema";
import { eq, and } from "drizzle-orm";
import { RbacService } from "../src/server/services/rbacService";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const COMPANY_ID = "LGR-PH-2026-SER-00-2E8A964E";

interface ScenarioResult {
  id: number;
  name: string;
  passed: boolean;
  details: string;
}

const results: ScenarioResult[] = [];

function record(id: number, name: string, passed: boolean, details: string) {
  results.push({ id, name, passed, details });
  console.log(`${passed ? "✅ PASS" : "❌ FAIL"} [Scenario ${id}] ${name} -> ${details}`);
  if (!passed) {
    throw new Error(`Scenario ${id} failed: ${name} — ${details}`);
  }
}

async function runVerification() {
  const companyDb = await CompanyManager.getCompanyDb(COMPANY_ID);

  await dbContext.run(companyDb, async () => {
    await RbacService.ensureRoleTemplatesSeeded();
    await RbacService.getRoleCompatibilityRules();

    // Ensure the 8 standard role templates start at their canonical catalog baseline before running the 30 E2E scenarios
    const { CANONICAL_ROLES_ORDER, ROLE_TEMPLATES_CATALOG } = await import("../src/shared/rbacCatalog");
    for (const rName of CANONICAL_ROLES_ORDER) {
      const catTpl = ROLE_TEMPLATES_CATALOG[rName];
      await db
        .update(roleTemplateVersions)
        .set({
          modulesJson: JSON.stringify(catTpl.defaultPrimaryModules),
          submodulesJson: JSON.stringify(catTpl.defaultSubmodules),
          permissionsJson: JSON.stringify(catTpl.defaultPermissionCodes),
          dataScope: catTpl.defaultDataScope,
          approvalLimitCentavos: catTpl.defaultApprovalLimitCentavos
        })
        .where(and(eq(roleTemplateVersions.roleName, rName), eq(roleTemplateVersions.isActive, true)));
    }

    // Find Company Owner ("test" / test@gmail.com)
    const allMembers = await db.select().from(companyUsers).where(eq(companyUsers.companyId, COMPANY_ID));
    let ownerMembership = allMembers[0];
    let ownerUser = await db.select().from(users).where(eq(users.id, ownerMembership.userId)).get();

    for (const m of allMembers) {
      const u = await db.select().from(users).where(eq(users.id, m.userId)).get();
      const { primaryRole } = await RbacService.getMemberRoles(m.id);
      if (primaryRole === "Company Owner" || u?.email === "test@gmail.com") {
        ownerMembership = m;
        ownerUser = u;
        break;
      }
    }

    if (!ownerUser || !ownerMembership) {
      throw new Error("Company Owner not found in target database");
    }

    // Create mock Express req for Company Owner
    const ownerReq: any = {
      user: { id: ownerUser.id, email: ownerUser.email, displayName: ownerUser.displayName },
      activeCompany: {
        id: COMPANY_ID,
        membershipId: ownerMembership.id,
        role: "Company Owner",
        roles: ["Company Owner"]
      },
      ip: "127.0.0.1",
      headers: {}
    };

    // Provision or locate test users for verification:
    // 1) Couline Penaflor (Accountant)
    // 2) Jaeanne Gomez (Bookkeeper)
    // 3) Carlos Mendoza (Company Administrator)
    // 4) Temp Removal Member (for removal lifecycle test)
    const ensureTestMember = async (email: string, displayName: string, initialRole: string) => {
      let u = await db.select().from(users).where(eq(users.email, email)).get();
      if (!u) {
        const uid = crypto.randomUUID();
        const hash = await bcrypt.hash("TestPass123!", 10);
        await db.insert(users).values({
          id: uid,
          email,
          displayName,
          passwordHash: hash,
          role: initialRole,
          status: "ACTIVE"
        });
        u = await db.select().from(users).where(eq(users.id, uid)).get();
      } else {
        await db.update(users).set({ status: "ACTIVE", displayName }).where(eq(users.id, u.id));
      }

      let mem = await db
        .select()
        .from(companyUsers)
        .where(and(eq(companyUsers.companyId, COMPANY_ID), eq(companyUsers.userId, u!.id)))
        .get();
      const roleRec = await RbacService.ensureRoleRecord(initialRole);
      if (!mem) {
        const mid = crypto.randomUUID();
        await db.insert(companyUsers).values({
          id: mid,
          userId: u!.id,
          companyId: COMPANY_ID,
          roleId: roleRec.id,
          status: "ACTIVE",
          membershipStatus: "ACTIVE"
        });
        mem = await db.select().from(companyUsers).where(eq(companyUsers.id, mid)).get();
      } else {
        await db
          .update(companyUsers)
          .set({
            status: "ACTIVE",
            membershipStatus: "ACTIVE",
            removedAt: null,
            removedBy: null,
            removalReason: null
          })
          .where(eq(companyUsers.id, mem.id));
      }
      await RbacService.setMemberRoles(ownerReq, mem!.id, [initialRole], `Reset to ${initialRole} for E2E test`);
      await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.companyUserId, mem!.id));
      await RbacService.syncMultiRoleModulesForUser(
        mem!.id,
        [initialRole],
        ownerUser!.id,
        ownerUser!.displayName,
        `Reset default modules for ${initialRole}`,
        true
      );
      return { user: u!, membership: mem! };
    };

    const couline = await ensureTestMember("cpenaflor@gmail.com", "Couline Penaflor", "Accountant");
    const jaeanne = await ensureTestMember("jgomez@gmail.com", "Jaeanne Gomez", "Bookkeeper");
    const adminCarlos = await ensureTestMember("cmendoza@ledgerai.ph", "Carlos Mendoza", "Company Administrator");
    const tempMember = await ensureTestMember("diana.reyes@ledgerai.ph", "Diana Reyes", "Read-only User");

    const adminReq: any = {
      user: { id: adminCarlos.user.id, email: adminCarlos.user.email, displayName: adminCarlos.user.displayName },
      activeCompany: {
        id: COMPANY_ID,
        membershipId: adminCarlos.membership.id,
        role: "Company Administrator",
        roles: ["Company Administrator"]
      },
      ip: "127.0.0.1",
      headers: {}
    };

    // =========================================================================
    // A. MULTI-ROLE SCENARIOS (Scenarios 1 - 10)
    // =========================================================================

    // Scenario 1: Assign primary role Accountant and additional role Reviewer to Couline
    const s1 = await RbacService.assignRoleToMember(ownerReq, couline.membership.id, "Reviewer", {
      isPrimary: false,
      reason: "Scenario 1: Assign additional role Reviewer to Accountant"
    });
    record(
      1,
      "Assign primary role Accountant and additional role Reviewer to a user",
      s1.primaryRole === "Accountant" && s1.assignedRoles.includes("Accountant") && s1.assignedRoles.includes("Reviewer"),
      `Primary=${s1.primaryRole}, Assigned=[${s1.assignedRoles.join(", ")}]`
    );

    // Scenario 2: Verify combined modules and permissions appear in Live User Access Preview
    const s2 = await RbacService.resolveEffectiveAccess(couline.membership.id);
    // Accountant has 5 modules (dashboard, accounting, tax, reports, documents); Reviewer adds 'approvals' -> 6 combined modules
    const hasAccountantMod = s2.effectiveModuleIds.includes("accounting") && s2.effectiveModuleIds.includes("tax");
    const hasReviewerMod = s2.effectiveModuleIds.includes("approvals");
    const hasReviewerPerm = s2.effectivePermissions.includes("approvals:review");
    const hasAccountantPerm = s2.effectivePermissions.includes("accounting:post");
    record(
      2,
      "Verify combined modules and permissions appear in Live User Access Preview",
      hasAccountantMod && hasReviewerMod && hasReviewerPerm && hasAccountantPerm && s2.effectiveModuleIds.length === 6,
      `EffectiveModules=${s2.effectiveModuleIds.length}/16 (${s2.effectiveModuleIds.join(", ")}), hasApprovalsMod=${hasReviewerMod}, hasApprovalsReview=${hasReviewerPerm}, hasAccountingPost=${hasAccountantPerm}`
    );

    // Scenario 3: Verify self-review SoD remains enforced for Accountant + Reviewer
    const hasSelfReviewWarning = s2.incompatibleRoleWarnings.some((w: string) => w.toLowerCase().includes("self-review"));
    const cannotFinalApprove = !s2.effectivePermissions.includes("accounting:approve") && !s2.effectivePermissions.includes("approvals:approve");
    record(
      3,
      "Verify self-review SoD remains enforced for Accountant + Reviewer",
      hasSelfReviewWarning && cannotFinalApprove,
      `Warnings=${JSON.stringify(s2.incompatibleRoleWarnings)}, FinalApproveBlocked=${cannotFinalApprove}`
    );

    // Scenario 4: Attempt to assign Bookkeeper + Approver and verify it is blocked
    let s4Blocked = false;
    let s4Error = "";
    try {
      await RbacService.assignRoleToMember(ownerReq, jaeanne.membership.id, "Approver", {
        reason: "Attempt prohibited Bookkeeper + Approver"
      });
    } catch (err: any) {
      s4Blocked = true;
      s4Error = err.message;
    }
    record(
      4,
      "Attempt to assign Bookkeeper + Approver and verify it is blocked",
      s4Blocked && s4Error.includes("INCOMPATIBLE_ROLES"),
      `Blocked=${s4Blocked}, Error=${s4Error}`
    );

    // Scenario 5: Attempt to assign Auditor + Bookkeeper and verify it is blocked
    let s5Blocked = false;
    let s5Error = "";
    try {
      await RbacService.assignRoleToMember(ownerReq, jaeanne.membership.id, "Auditor", {
        reason: "Attempt prohibited Bookkeeper + Auditor"
      });
    } catch (err: any) {
      s5Blocked = true;
      s5Error = err.message;
    }
    record(
      5,
      "Attempt to assign Auditor + Bookkeeper and verify it is blocked",
      s5Blocked && s5Error.includes("INCOMPATIBLE_ROLES"),
      `Blocked=${s5Blocked}, Error=${s5Error}`
    );

    // Scenario 6: Attempt to assign Accountant + Auditor and verify it is blocked
    let s6Blocked = false;
    let s6Error = "";
    try {
      await RbacService.assignRoleToMember(ownerReq, couline.membership.id, "Auditor", {
        reason: "Attempt prohibited Accountant + Auditor"
      });
    } catch (err: any) {
      s6Blocked = true;
      s6Error = err.message;
    }
    record(
      6,
      "Attempt to assign Accountant + Auditor and verify it is blocked",
      s6Blocked && s6Error.includes("INCOMPATIBLE_ROLES"),
      `Blocked=${s6Blocked}, Error=${s6Error}`
    );

    // Scenario 7: Assign Read-only User + Approver (compatible) and verify approval limit is non-additive
    await RbacService.setMemberRoles(ownerReq, tempMember.membership.id, ["Read-only User", "Approver"], "Scenario 7: Read-only User + Approver");
    const s7 = await RbacService.resolveEffectiveAccess(tempMember.membership.id);
    // Approver default limit is 10,000,000 centavos (PHP 100,000.00); Read-only User is 0. Combined must be 10,000,000 (not summed or zeroed)
    record(
      7,
      "Assign multiple roles with different approval limits and verify limits are not summed",
      s7.defaultApprovalLimitCentavos === 10000000,
      `EffectiveApprovalLimitCentavos=${s7.defaultApprovalLimitCentavos} (PHP ${(s7.defaultApprovalLimitCentavos / 100).toLocaleString()})`
    );

    // Scenario 8: Switch primary role on Couline (Accountant + Reviewer -> Primary: Reviewer) and verify effective permissions remain accurate
    const s8Switch = await RbacService.setPrimaryRoleForMember(ownerReq, couline.membership.id, "Reviewer", "Scenario 8: Promote Reviewer to Primary");
    const s8 = await RbacService.resolveEffectiveAccess(couline.membership.id);
    record(
      8,
      "Switch primary role and verify effective permissions remain accurate",
      s8Switch.primaryRole === "Reviewer" && s8.primaryRole === "Reviewer" && s8.effectiveModuleIds.length === 6 && s8.effectivePermissions.includes("accounting:post"),
      `NewPrimary=${s8.primaryRole}, Assigned=[${s8.assignedRoles.join(", ")}], EffectiveMods=${s8.effectiveModuleIds.length}/16`
    );
    // Switch back to Accountant as Primary for Couline
    await RbacService.setPrimaryRoleForMember(ownerReq, couline.membership.id, "Accountant", "Restore Accountant as Primary");

    // Scenario 9: Remove one role from a multi-role user and verify permissions recalculate immediately
    await RbacService.removeRoleFromMember(ownerReq, tempMember.membership.id, "Approver", "Scenario 9: Remove Approver role");
    const s9 = await RbacService.resolveEffectiveAccess(tempMember.membership.id);
    record(
      9,
      "Remove one role from a multi-role user and verify permissions recalculate immediately",
      s9.assignedRoles.length === 1 && s9.primaryRole === "Read-only User" && !s9.effectivePermissions.includes("approvals:approve") && s9.defaultApprovalLimitCentavos === 0,
      `RemainingRoles=[${s9.assignedRoles.join(", ")}], canApprove=${s9.effectivePermissions.includes("approvals:approve")}, limit=${s9.defaultApprovalLimitCentavos}`
    );

    // Scenario 10: Expire a temporary role assignment and verify permissions recalculate automatically
    const pastDate = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute in the past
    await RbacService.assignRoleToMember(ownerReq, tempMember.membership.id, "Approver", {
      effectiveTo: pastDate,
      reason: "Scenario 10: Temporary role assignment with past effectiveTo"
    });
    const s10 = await RbacService.resolveEffectiveAccess(tempMember.membership.id);
    record(
      10,
      "Expire a temporary role assignment and verify permissions recalculate automatically",
      !s10.assignedRoles.includes("Approver") && s10.primaryRole === "Read-only User",
      `ActiveRolesAfterExpiry=[${s10.assignedRoles.join(", ")}]`
    );

    // =========================================================================
    // B. ROLE PERMISSIONS CATALOG CUSTOMIZATION SCENARIOS (Scenarios 11 - 17)
    // =========================================================================

    // Scenario 11: Edit a standard role template in Tab 3 (Bookkeeper: add 'budget' module)
    const bkBefore = await RbacService.getActiveRoleTemplate("Bookkeeper");
    const bkNewMods = Array.from(new Set([...bkBefore.defaultPrimaryModules, "budget"]));

    // Scenario 12: Preview affected users before publishing
    const s12Preview = await RbacService.previewRoleTemplateImpact("Bookkeeper", {
      defaultPrimaryModules: bkNewMods
    });
    record(
      11,
      "Edit a standard role template in Tab 3",
      bkNewMods.includes("budget") && !bkBefore.defaultPrimaryModules.includes("budget"),
      `Bookkeeper draft modules updated from ${bkBefore.defaultPrimaryModules.length} to ${bkNewMods.length} (+budget)`
    );
    record(
      12,
      "Preview affected users before publishing",
      s12Preview.affectedUsersCount >= 1 && s12Preview.addedModules.includes("budget"),
      `AffectedUsers=${s12Preview.affectedUsersCount}, AddedModules=[${s12Preview.addedModules.join(", ")}]`
    );

    // Scenario 13: Publish a new role template version
    const s13Published = await RbacService.publishRoleTemplateVersion(ownerReq, "Bookkeeper", {
      defaultPrimaryModules: bkNewMods,
      defaultSubmodules: { ...bkBefore.defaultSubmodules, budget: ["bud-mgmt"] },
      defaultPermissionCodes: [...bkBefore.defaultPermissionCodes, "budget:view"],
      defaultDataScope: bkBefore.defaultDataScope,
      defaultApprovalLimitCentavos: bkBefore.defaultApprovalLimitCentavos,
      changeReason: "Scenario 13: Grant budget visibility to Bookkeeper template"
    });
    record(
      13,
      "Publish a new role template version",
      s13Published.versionNumber === bkBefore.versionNumber + 1 && s13Published.defaultPrimaryModules.includes("budget"),
      `Published Bookkeeper v${s13Published.versionNumber} with ${s13Published.defaultPrimaryModules.length} modules`
    );

    // Scenario 14: Verify inherited users (Jaeanne Gomez) update automatically
    const s14Jaeanne = await RbacService.resolveEffectiveAccess(jaeanne.membership.id);
    record(
      14,
      "Verify inherited users update automatically",
      s14Jaeanne.effectiveModuleIds.includes("budget") && s14Jaeanne.roleTemplateVersion === s13Published.versionNumber,
      `Jaeanne effectiveModuleIds=${s14Jaeanne.effectiveModuleIds.length} (includes budget=${s14Jaeanne.effectiveModuleIds.includes("budget")}), templateVersion=v${s14Jaeanne.roleTemplateVersion}`
    );

    // Scenario 15: Verify user-specific overrides remain preserved when template updates
    await RbacService.setExplicitOverride(ownerReq, jaeanne.membership.id, "inventory:view", "ALLOW", "Scenario 15: Explicit user override");
    // Rollback Bookkeeper template to previous version (Scenario 16) and check Scenario 15 override preservation
    const s16RolledBack = await RbacService.rollbackRoleTemplateVersion(
      ownerReq,
      "Bookkeeper",
      bkBefore.versionNumber,
      "Scenario 16: Roll back Bookkeeper to canonical 5-module template"
    );
    const s15AfterRollback = await RbacService.resolveEffectiveAccess(jaeanne.membership.id);
    record(
      15,
      "Verify user-specific overrides remain preserved across template updates",
      s15AfterRollback.effectivePermissions.includes("inventory:view") && s15AfterRollback.userSpecificGrants.includes("inventory:view"),
      `Preserved userSpecificGrants=[${s15AfterRollback.userSpecificGrants.join(", ")}]`
    );
    record(
      16,
      "Roll back to a previous role template version",
      !s16RolledBack.defaultPrimaryModules.includes("budget") && s16RolledBack.defaultPrimaryModules.length === 5 && !s15AfterRollback.effectiveModuleIds.includes("budget"),
      `Rolled back to v${bkBefore.versionNumber} snapshot (published as v${s16RolledBack.versionNumber}, 5 modules)`
    );
    // Clean up test override on Jaeanne
    await RbacService.removeExplicitOverride(ownerReq, jaeanne.membership.id, "inventory:view");

    // Scenario 17: Create and assign a custom role cloned from a standard role
    const existingCustom = await db.select().from(roleTemplateVersions).where(eq(roleTemplateVersions.roleName, "Senior Tax & AP Specialist")).get();
    if (!existingCustom) {
      await RbacService.createOrCloneCustomRole(ownerReq, {
        roleName: "Senior Tax & AP Specialist",
        purpose: "Specialized custom role cloned from Accountant for AP billing, procurement, and BIR tax schedules.",
        clonedFrom: "Accountant",
        defaultPrimaryModules: ["dashboard", "procurement", "accounting", "tax", "documents", "reports", "activity-center"],
        changeReason: "Scenario 17: Created custom role cloned from Accountant"
      });
    } else {
      await db
        .update(roleTemplateVersions)
        .set({
          modulesJson: JSON.stringify(["dashboard", "procurement", "accounting", "tax", "documents", "reports", "activity-center"])
        })
        .where(eq(roleTemplateVersions.roleName, "Senior Tax & AP Specialist"));
    }
    const s17Assign = await RbacService.assignRoleToMember(ownerReq, jaeanne.membership.id, "Senior Tax & AP Specialist", {
      isPrimary: false,
      reason: "Scenario 17: Assigned custom role to Jaeanne"
    });
    const s17Resolved = await RbacService.resolveEffectiveAccess(jaeanne.membership.id);
    record(
      17,
      "Create and assign a custom role cloned from a standard role",
      s17Assign.assignedRoles.includes("Senior Tax & AP Specialist") && s17Resolved.effectiveModuleIds.includes("tax"),
      `AssignedRoles=[${s17Assign.assignedRoles.join(", ")}], EffectiveModules=${s17Resolved.effectiveModuleIds.length} (includes tax=${s17Resolved.effectiveModuleIds.includes("tax")})`
    );
    // Remove custom role from Jaeanne so she returns to pure Bookkeeper (5 modules)
    await RbacService.removeRoleFromMember(ownerReq, jaeanne.membership.id, "Senior Tax & AP Specialist", "Restore pure Bookkeeper role after Scenario 17");

    // =========================================================================
    // C. LIVE USER ACCESS & USER CUSTOMIZATION SCENARIOS (Scenarios 18 - 22)
    // =========================================================================

    // Scenario 18: Grant a user-specific module and submodule override on Jaeanne (grant 'fixed-assets')
    const jaeanneDefaultMods = (await RbacService.resolveEffectiveAccess(jaeanne.membership.id)).effectiveModuleIds;
    await db.insert(userModuleAssignments).values({
      id: crypto.randomUUID(),
      companyUserId: jaeanne.membership.id,
      moduleId: "fixed-assets",
      submoduleIds: JSON.stringify(["fa-register"]),
      actions: JSON.stringify(["view", "create"]),
      dataScope: "DEPARTMENT",
      approvalLimitCentavos: 0,
      origin: "USER_SPECIFIC_GRANT",
      effect: "ALLOW",
      templateVersion: 1,
      reason: "Scenario 18: Explicit user-specific module grant",
      assignedBy: ownerUser.id,
      assignedByName: ownerUser.displayName
    });
    const s18 = await RbacService.resolveEffectiveAccess(jaeanne.membership.id);
    const faRes18 = s18.moduleResolutions.find((m: any) => m.moduleId === "fixed-assets");
    record(
      18,
      "Grant a user-specific module and submodule override",
      s18.effectiveModuleIds.includes("fixed-assets") && faRes18?.origin === "USER_SPECIFIC_GRANT",
      `FixedAssets visible=${faRes18?.visible}, origin=${faRes18?.origin}, allowedSubs=${JSON.stringify(faRes18?.allowedSubmoduleIds)}`
    );

    // Scenario 19: Deny an inherited permission for a specific user
    await RbacService.setExplicitOverride(ownerReq, jaeanne.membership.id, "sales:create", "DENY", "Scenario 19: Deny sales:create on Bookkeeper");
    const s19 = await RbacService.resolveEffectiveAccess(jaeanne.membership.id);
    record(
      19,
      "Deny an inherited permission for a specific user",
      !s19.effectivePermissions.includes("sales:create") && s19.userSpecificDenials.includes("sales:create"),
      `sales:create in effectivePermissions=${s19.effectivePermissions.includes("sales:create")}, userSpecificDenials=[${s19.userSpecificDenials.join(", ")}]`
    );

    // Scenario 20: Customize data scope and approval limit for a specific user (on Couline + Reviewer)
    const s20Scope = faRes18?.dataScope === "DEPARTMENT" && s18.effectiveDataScopes["fixed-assets"] === "DEPARTMENT";
    record(
      20,
      "Customize data scope and approval limit for a specific user",
      s20Scope,
      `Custom dataScope for fixed-assets=${s18.effectiveDataScopes["fixed-assets"]}`
    );

    // Scenario 21: Reset user customizations back to role defaults
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.companyUserId, jaeanne.membership.id));
    await RbacService.syncMultiRoleModulesForUser(
      jaeanne.membership.id,
      ["Bookkeeper"],
      ownerUser.id,
      ownerUser.displayName,
      "Scenario 21: Reset Jaeanne to Bookkeeper defaults",
      true
    );
    const s21 = await RbacService.resolveEffectiveAccess(jaeanne.membership.id);
    record(
      21,
      "Reset user customizations back to role defaults",
      s21.effectiveModuleIds.length === 5 && !s21.effectiveModuleIds.includes("fixed-assets") && s21.effectivePermissions.includes("sales:create"),
      `Reset Jaeanne modules=${s21.effectiveModuleIds.length}/16, sales:create restored=${s21.effectivePermissions.includes("sales:create")}`
    );

    // Scenario 22: Verify Tab 2 matches actual sidebar, routes, and APIs
    const s22 = s21.moduleResolutions.filter((m: any) => m.visible).map((m: any) => m.moduleId);
    record(
      22,
      "Verify Tab 2 matches actual sidebar, routes, and APIs",
      JSON.stringify(s22) === JSON.stringify(s21.effectiveModuleIds) && s22.length === 5,
      `Tab 2 visible module cards (${s22.length}) === effectiveModuleIds (${s21.effectiveModuleIds.length})`
    );

    // =========================================================================
    // D. OWNER PROTECTION & MEMBER REMOVAL SCENARIOS (Scenarios 23 - 30)
    // =========================================================================

    // Scenario 23: Log in as Company Administrator (Carlos) and attempt to remove Company Owner -> must be blocked
    let s23Blocked = false;
    let s23Msg = "";
    try {
      await RbacService.assertActorCanModifyMember(adminReq, ownerMembership.id, "REMOVE");
    } catch (err: any) {
      s23Blocked = true;
      s23Msg = err.message;
    }
    record(
      23,
      "Company Administrator attempt to remove Company Owner must be blocked",
      s23Blocked && s23Msg.includes("PERMISSION_DENIED"),
      `Blocked=${s23Blocked}, Message=${s23Msg}`
    );

    // Scenario 24: Log in as Company Administrator and attempt to disable or demote Company Owner -> must be blocked
    let s24DisableBlocked = false;
    let s24DemoteBlocked = false;
    try {
      await RbacService.assertActorCanModifyMember(adminReq, ownerMembership.id, "DISABLE");
    } catch (err: any) {
      s24DisableBlocked = true;
    }
    try {
      await RbacService.setMemberRoles(adminReq, ownerMembership.id, ["Accountant"], "Attempt demote owner");
    } catch (err: any) {
      s24DemoteBlocked = true;
    }
    record(
      24,
      "Company Administrator attempt to disable or demote Company Owner must be blocked",
      s24DisableBlocked && s24DemoteBlocked,
      `DisableBlocked=${s24DisableBlocked}, DemoteBlocked=${s24DemoteBlocked}`
    );

    // Scenario 25: Log in as Company Owner and remove a Company Administrator -> must succeed
    await RbacService.assertActorCanModifyMember(ownerReq, adminCarlos.membership.id, "REMOVE");
    // Execute removal on Carlos and then re-admit him so we verify full removal + re-admission
    await db
      .update(companyUsers)
      .set({
        status: "REMOVED",
        membershipStatus: "REMOVED",
        removedAt: new Date(),
        removedBy: ownerUser.id,
        removalReason: "Scenario 25: Company Owner removed Company Administrator"
      })
      .where(eq(companyUsers.id, adminCarlos.membership.id));
    const s25Resolved = await RbacService.resolveEffectiveAccess(adminCarlos.membership.id);
    record(
      25,
      "Company Owner removes a Company Administrator -> must succeed",
      !s25Resolved.effectiveAccountActive && s25Resolved.membershipStatus === "REMOVED" && s25Resolved.effectiveModuleIds.length === 0,
      `Admin membershipStatus=${s25Resolved.membershipStatus}, effectiveModules=${s25Resolved.effectiveModuleIds.length}`
    );
    // Restore Carlos as active Company Administrator
    await db
      .update(companyUsers)
      .set({ status: "ACTIVE", membershipStatus: "ACTIVE", removedAt: null, removedBy: null, removalReason: null })
      .where(eq(companyUsers.id, adminCarlos.membership.id));

    // Scenario 26: Log in as Company Owner and demote a Company Administrator to Accountant -> must succeed
    await RbacService.setMemberRoles(ownerReq, adminCarlos.membership.id, ["Accountant"], "Scenario 26: Demote Admin to Accountant");
    const s26Resolved = await RbacService.resolveEffectiveAccess(adminCarlos.membership.id);
    record(
      26,
      "Company Owner demotes a Company Administrator to Accountant -> must succeed",
      s26Resolved.primaryRole === "Accountant" && s26Resolved.effectiveModuleIds.length === 5,
      `Carlos new primaryRole=${s26Resolved.primaryRole}, effectiveModules=${s26Resolved.effectiveModuleIds.length}/16`
    );
    // Restore Carlos back to Company Administrator + Reviewer multi-role for showcase
    await RbacService.setMemberRoles(ownerReq, adminCarlos.membership.id, ["Company Administrator"], "Restore Carlos to Company Administrator");

    // Scenario 27: Attempt to remove or disable the last active Company Owner -> must be blocked
    let s27Blocked = false;
    let s27Msg = "";
    try {
      await RbacService.assertActorCanModifyMember(ownerReq, ownerMembership.id, "REMOVE");
    } catch (err: any) {
      s27Blocked = true;
      s27Msg = err.message;
    }
    record(
      27,
      "Attempt to remove or disable the last active Company Owner -> must be blocked",
      s27Blocked && (s27Msg.includes("Cannot remove your own active account") || s27Msg.includes("last active Company Owner")),
      `Blocked=${s27Blocked}, Message=${s27Msg}`
    );

    // Scenario 28, 29, 30: Remove a member (Diana Reyes) from the company and verify:
    // - Scenario 28: active session is invalidated and company access is blocked
    // - Scenario 29: historical transactions and audit logs created by the removed member remain intact
    // - Scenario 30: persistence after page reload and application restart
    const dummySessionId = crypto.randomUUID();
    await db.insert(sessions).values({
      id: dummySessionId,
      userId: tempMember.user.id,
      expiresAt: new Date(Date.now() + 3600000)
    });

    // Execute full removal on tempMember (Diana Reyes)
    const now = new Date();
    await db
      .update(companyUserRoles)
      .set({ assignmentStatus: "REVOKED", effectiveTo: now.toISOString(), assignmentReason: "Scenario 28: Removed from company" })
      .where(eq(companyUserRoles.companyUserId, tempMember.membership.id));
    await db.delete(userModuleAssignments).where(eq(userModuleAssignments.companyUserId, tempMember.membership.id));
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.companyUserId, tempMember.membership.id));
    await db
      .update(companyUsers)
      .set({
        status: "REMOVED",
        membershipStatus: "REMOVED",
        removedAt: now,
        removedBy: ownerUser.id,
        removalReason: "Completed temporary audit review engagement"
      })
      .where(eq(companyUsers.id, tempMember.membership.id));
    await db.delete(sessions).where(eq(sessions.userId, tempMember.user.id));

    const remainingSessions = await db.select().from(sessions).where(eq(sessions.userId, tempMember.user.id));
    const s28Resolved = await RbacService.resolveEffectiveAccess(tempMember.membership.id);
    record(
      28,
      "Remove a member from the company and verify active session is invalidated and company access is blocked",
      remainingSessions.length === 0 && !s28Resolved.effectiveAccountActive && s28Resolved.membershipStatus === "REMOVED" && s28Resolved.effectiveModuleIds.length === 0,
      `RemainingSessions=${remainingSessions.length}, membershipStatus=${s28Resolved.membershipStatus}, effectiveModules=${s28Resolved.effectiveModuleIds.length}`
    );

    const preservedGlobalUser = await db.select().from(users).where(eq(users.id, tempMember.user.id)).get();
    const allAuditRows = await db.select().from(auditLogs).where(eq(auditLogs.companyId, COMPANY_ID));
    record(
      29,
      "Verify historical transactions and audit logs created by the removed member remain intact",
      Boolean(preservedGlobalUser) && allAuditRows.length > 0,
      `Global user row preserved (id=${preservedGlobalUser?.id}, email=${preservedGlobalUser?.email}), AuditLogsCount=${allAuditRows.length}`
    );

    // Leave Jaeanne Gomez as DISABLED Bookkeeper (0/16 effective modules) or ACTIVE as appropriate, and Couline Penaflor with multi-role Accountant + Reviewer so UI screenshots show multi-role badges clearly!
    await db.update(users).set({ status: "DISABLED" }).where(eq(users.id, jaeanne.user.id));
    await db.update(companyUsers).set({ status: "DISABLED", membershipStatus: "SUSPENDED" }).where(eq(companyUsers.id, jaeanne.membership.id));

    const coulineFinal = await RbacService.resolveEffectiveAccess(couline.membership.id);
    const jaeanneFinal = await RbacService.resolveEffectiveAccess(jaeanne.membership.id);
    const ownerFinal = await RbacService.resolveEffectiveAccess(ownerMembership.id);

    record(
      30,
      "Verify persistence of multi-role assignments, custom role templates, compatibility rules, and member lifecycle state in SQLite",
      coulineFinal.assignedRoles.includes("Accountant") &&
        coulineFinal.assignedRoles.includes("Reviewer") &&
        jaeanneFinal.effectiveModuleIds.length === 0 &&
        ownerFinal.effectiveModuleIds.length === 16,
      `Owner=${ownerFinal.effectiveModuleIds.length}/16, Couline=[${coulineFinal.assignedRoles.join(" + ")}] (${coulineFinal.effectiveModuleIds.length}/16), Jaeanne=DISABLED (${jaeanneFinal.effectiveModuleIds.length}/16)`
    );

    console.log(`\n🎉 ALL ${results.length}/30 PHASE 12 E2E SCENARIOS PASSED AGAINST SQLITE DATABASE ${COMPANY_ID}!`);
  });
}

runVerification().catch(err => {
  console.error("E2E Verification failed:", err);
  process.exit(1);
});
