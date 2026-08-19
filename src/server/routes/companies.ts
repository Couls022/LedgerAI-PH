import { Router } from "express";
import { db } from "../db";
import { 
  companies, companyUsers, users, roles, auditLogs, accountingPeriods, 
  accounts, companyTaxProfiles, journalEntries, journalLines, companyLicenses, companyUserRoles,
  sessions, userPermissionOverrides
} from "../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireMinRole, normalizeRole, LedgerRole } from "../auth";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { AuditService } from "../services/auditService";
import { CompanyManager, COMPANIES_ROOT } from "../services/companyManager";
import { paths } from "../services/paths";
import { RbacService } from "../services/rbacService";
import { dbContext } from "../db/context";
import { getBirTaxProfileRules } from "../../shared/taxProfile";
import { updateUserSchema, updateMemberStatusSchema } from "../schemas/userSchemas";

const router = Router();

// Standard Philippine BIR-compliant Chart of Accounts Template
const DEFAULT_PHILIPPINE_COA = [
  { accountCode: "1010", accountName: "Cash in Bank", accountType: "ASSET", normalBalance: "DEBIT", isCashAccount: true },
  { accountCode: "1020", accountName: "Petty Cash Fund", accountType: "ASSET", normalBalance: "DEBIT", isCashAccount: true },
  { accountCode: "1030", accountName: "Accounts Receivable", accountType: "ASSET", normalBalance: "DEBIT", isControlAccount: true },
  { accountCode: "1040", accountName: "Allowance for Doubtful Accounts", accountType: "ASSET", normalBalance: "CREDIT" },
  { accountCode: "1050", accountName: "Input VAT", accountType: "ASSET", normalBalance: "DEBIT", isTaxAccount: true },
  { accountCode: "1060", accountName: "Creditable Withholding Tax (2307)", accountType: "ASSET", normalBalance: "DEBIT", isTaxAccount: true },
  { accountCode: "1070", accountName: "Prepaid Expenses", accountType: "ASSET", normalBalance: "DEBIT" },
  { accountCode: "1510", accountName: "Office Equipment", accountType: "ASSET", normalBalance: "DEBIT" },
  { accountCode: "1520", accountName: "Accumulated Depreciation - Equipment", accountType: "ASSET", normalBalance: "CREDIT" },
  { accountCode: "2010", accountName: "Accounts Payable", accountType: "LIABILITY", normalBalance: "CREDIT", isControlAccount: true },
  { accountCode: "2020", accountName: "Output VAT", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true },
  { accountCode: "2030", accountName: "Expanded Withholding Tax Payable", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true },
  { accountCode: "2040", accountName: "SSS/PhilHealth/Pag-IBIG Payable", accountType: "LIABILITY", normalBalance: "CREDIT" },
  { accountCode: "3010", accountName: "Owner's Equity / Capital", accountType: "EQUITY", normalBalance: "CREDIT" },
  { accountCode: "3020", accountName: "Retained Earnings", accountType: "EQUITY", normalBalance: "CREDIT", isRetainedEarnings: true },
  { accountCode: "4010", accountName: "Service Revenue / Sales", accountType: "REVENUE", normalBalance: "CREDIT" },
  { accountCode: "4020", accountName: "Sales Discounts & Allowances", accountType: "REVENUE", normalBalance: "DEBIT" },
  { accountCode: "5010", accountName: "Cost of Goods Sold / Services", accountType: "COST_OF_SALES", normalBalance: "DEBIT" },
  { accountCode: "6010", accountName: "Salaries and Wages", accountType: "EXPENSE", normalBalance: "DEBIT" },
  { accountCode: "6020", accountName: "Rent Expense", accountType: "EXPENSE", normalBalance: "DEBIT" },
  { accountCode: "6030", accountName: "Utilities Expense", accountType: "EXPENSE", normalBalance: "DEBIT" },
  { accountCode: "6040", accountName: "Office Supplies Expense", accountType: "EXPENSE", normalBalance: "DEBIT" },
  { accountCode: "6050", accountName: "Professional Fees", accountType: "EXPENSE", normalBalance: "DEBIT" },
  { accountCode: "6060", accountName: "Depreciation Expense", accountType: "EXPENSE", normalBalance: "DEBIT" },
  { accountCode: "6070", accountName: "Taxes and Licenses", accountType: "EXPENSE", normalBalance: "DEBIT" },
  { accountCode: "7010", accountName: "Interest Income", accountType: "OTHER_INCOME", normalBalance: "CREDIT" },
  { accountCode: "7020", accountName: "Bank Service Charges", accountType: "OTHER_EXPENSE", normalBalance: "DEBIT" }
];

// Public: List all local profiles - Should be public for login screen
router.get("/", async (req, res) => {
  const allCompanies = await CompanyManager.listCompanies();
  res.json(allCompanies);
});

// Public: Get device active storage environment and drive presets
router.get("/storage-environment", async (req, res) => {
  try {
    const companiesRoot = paths.getCompaniesRootDir().replace(/\\/g, '/');
    const dataDir = paths.getDataDir().replace(/\\/g, '/');
    const configDir = paths.getConfigDir().replace(/\\/g, '/');
    const homeDir = os.homedir().replace(/\\/g, '/');
    const platform = os.platform();
    const presets = paths.getAvailableActiveDrives();

    res.json({
      companiesRoot,
      dataDir,
      configDir,
      homeDir,
      platform,
      presets
    });
  } catch (err: any) {
    res.status(500).json({ error: "STORAGE_ENV_ERROR", message: err?.message || "Failed to get storage environment" });
  }
});

router.delete("/clear-all", async (req, res) => {
  try {
    await CompanyManager.clearRegistry();
    res.json({ success: true, message: "All company profiles have been cleared from the registry." });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err?.message || "Failed to clear companies registry" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await CompanyManager.deleteCompany(id);
    res.json({ success: true, message: "Company profile removed from list access." });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err?.message || "Failed to delete company" });
  }
});

router.post("/open-folder", async (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath) {
      res.status(400).json({ error: "BAD_REQUEST", message: "Missing folderPath" });
      return;
    }
    const manifest = await CompanyManager.browseAndRegisterCompanyFolder(folderPath);
    res.json({ success: true, company: manifest, message: "Company profile registered successfully." });
  } catch (err: any) {
    console.error("Open existing folder error:", err);
    res.status(400).json({ error: "INVALID_COMPANY_FOLDER", message: err.message });
  }
});

// Authenticated: Get current company details
router.get("/current/details", requireAuth, requireMinRole('Read-only User'), async (req, res) => {
  const company = await db
    .select()
    .from(companies)
    .where(eq(companies.id, req.activeCompany!.id))
    .get();

  if (!company) {
    res.status(404).json({ error: "NOT_FOUND", message: "Company profile not found" });
    return;
  }

  res.json({
    ...company,
    currentUserRole: req.activeCompany!.role
  });
});

// Authenticated: Get list of members and their assigned roles for current active company
router.get("/current/members", requireAuth, requireMinRole('Read-only User'), async (req, res) => {
  const companyId = req.activeCompany!.id;

  const members = await db
    .select({
      membershipId: companyUsers.id,
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      status: users.status,
      createdAt: companyUsers.createdAt
    })
    .from(companyUsers)
    .innerJoin(users, eq(companyUsers.userId, users.id))
    .where(eq(companyUsers.companyId, companyId));

  const formattedMembers = [];
  for (const m of members) {
    const { roles: roleRecords, normalizedRoles, primaryRole } = await RbacService.getMemberRoles(m.membershipId);
    const effectivePermissions = await RbacService.evaluateEffectivePermissions(m.membershipId);
    const overrides = await RbacService.getExplicitOverrides(m.membershipId);

    formattedMembers.push({
      membershipId: m.membershipId,
      userId: m.userId,
      displayName: m.displayName,
      email: m.email,
      status: m.status,
      role: primaryRole,
      roleName: primaryRole,
      roles: normalizedRoles,
      roleRecords,
      effectivePermissions,
      overrides,
      createdAt: m.createdAt
    });
  }

  res.json(formattedMembers);
});

// Add a role to a member (Multi-Role assignment)
router.post("/current/members/:id/roles", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!role) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Role is required" });
    return;
  }

  const companyId = req.activeCompany!.id;
  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  if (role === 'Company Owner' && !requesterRoles.includes('Company Owner')) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Only Company Owners can assign the Company Owner role." });
    return;
  }

  try {
    const result = await RbacService.assignRoleToMember(req, membership.id, role);
    res.json(result);
  } catch (err: any) {
    if (err.message && err.message.includes("DUPLICATE_ROLE")) {
      res.status(400).json({ error: "DUPLICATE_ROLE", message: err.message });
      return;
    }
    res.status(400).json({ error: "SOD_RESTRICTION_ERROR", message: err.message });
  }
});

// Remove a role from a member
router.delete("/current/members/:id/roles/:roleName", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { id, roleName } = req.params;
  const companyId = req.activeCompany!.id;

  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found in this company" });
    return;
  }

  try {
    const result = await RbacService.removeRoleFromMember(req, membership.id, decodeURIComponent(roleName));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: "RBAC_ERROR", message: err.message });
  }
});

// Admin Only: Legacy/Bulk Update member roles
router.put("/current/members/:userId/role", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { userId } = req.params;
  const { targetRole, roles: inputRoles } = req.body as { targetRole?: LedgerRole; roles?: LedgerRole[] };

  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, userId))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "User is not a member of this company" });
    return;
  }

  const rolesToAssign: LedgerRole[] = Array.isArray(inputRoles) && inputRoles.length > 0 
    ? inputRoles 
    : (targetRole ? [targetRole] : ['Read-only User']);

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  if (rolesToAssign.includes('Company Owner') && !requesterRoles.includes('Company Owner')) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Only Company Owners can assign the Company Owner role." });
    return;
  }

  try {
    const result = await RbacService.setMemberRoles(req, membership.id, rolesToAssign);
    res.json({ message: "Roles updated successfully", roles: result.roles, primaryRole: result.primaryRole });
  } catch (err: any) {
    res.status(400).json({ error: "RBAC_ERROR", message: err.message });
  }
});

// Admin/Owner: Edit member details (Name, Email, Role, Password, Status, Delete)
router.put("/current/members/:id", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  const parseResult = updateUserSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: (parseResult.error as any).issues || (parseResult.error as any).errors || [].map(e => e.message).join(", "),
      details: (parseResult.error as any).issues || (parseResult.error as any).errors || []
    });
    return;
  }

  const { displayName, email, role, roles: inputRoles, password, status, disableAccount, deleteAccount, requirePasswordChange } = parseResult.data;

  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
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

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  const isRequesterOwner = requesterRoles.includes('Company Owner');
  const { primaryRole } = await RbacService.getMemberRoles(membership.id);

  if (primaryRole === 'Company Owner' && !isRequesterOwner) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Only Company Owners can modify other Company Owners." });
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

    await db.delete(sessions).where(eq(sessions.userId, membership.userId));
    await db.delete(companyUserRoles).where(eq(companyUserRoles.companyUserId, membership.id));
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
        res.status(403).json({ error: "PERMISSION_DENIED", message: "Only Company Owners can assign the Company Owner role." });
        return;
      }
      await RbacService.setMemberRoles(req, membership.id, targetRoles);
    }

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

// Admin/Owner: Update member status (Active / Disabled toggle)
router.put("/current/members/:id/status", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  const parseResult = updateMemberStatusSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: (parseResult.error as any).issues || (parseResult.error as any).errors || [].map(e => e.message).join(", "),
      details: (parseResult.error as any).issues || (parseResult.error as any).errors || []
    });
    return;
  }

  const { status, reason } = parseResult.data;

  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
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

  if (membership.userId === req.user!.id && status === 'DISABLED') {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot disable your own active account." });
    return;
  }

  const requesterRoles = req.activeCompany!.roles || [req.activeCompany!.role];
  const { primaryRole } = await RbacService.getMemberRoles(membership.id);
  if (primaryRole === 'Company Owner' && !requesterRoles.includes('Company Owner')) {
    res.status(403).json({ error: "PERMISSION_DENIED", message: "Company Administrators cannot disable Company Owners." });
    return;
  }

  await db.update(users).set({ status }).where(eq(users.id, membership.userId));
  await db.update(companyUsers).set({ status }).where(eq(companyUsers.id, membership.id));

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
    metadata: { status, reason: reason || `Account ${status === 'ACTIVE' ? 'activated' : 'disabled'} by admin`, displayName: targetUser.displayName, email: targetUser.email }
  });

  res.json({ message: `Member status successfully updated to ${status}` });
});

// Admin/Owner: Delete / Remove member from company
router.delete("/current/members/:id", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { id } = req.params;

  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
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

  // Count active owners
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

  // Clean up sessions, roles and overrides for this company user
  await db.delete(sessions).where(eq(sessions.userId, membership.userId));
  await db.delete(companyUserRoles).where(eq(companyUserRoles.companyUserId, membership.id));
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

  res.json({ message: "Member account successfully removed from the company." });
});

// Set explicit permission override (ALLOW or DENY)
router.post("/current/members/:id/permission-overrides", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { id } = req.params;
  const { permissionCode, effect, reason } = req.body;

  if (!permissionCode || !['ALLOW', 'DENY'].includes(effect)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "permissionCode and effect ('ALLOW' | 'DENY') are required." });
    return;
  }

  const companyId = req.activeCompany!.id;
  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found" });
    return;
  }

  const result = await RbacService.setExplicitOverride(req, membership.id, permissionCode, effect, reason);
  res.json(result);
});

// Delete explicit permission override
router.delete("/current/members/:id/permission-overrides/:permissionCode", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const { id, permissionCode } = req.params;
  const companyId = req.activeCompany!.id;

  let membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.id, id))).get();
  if (!membership) {
    membership = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, id))).get();
  }

  if (!membership) {
    res.status(404).json({ error: "NOT_FOUND", message: "Member not found" });
    return;
  }

  const result = await RbacService.removeExplicitOverride(req, membership.id, decodeURIComponent(permissionCode));
  res.json(result);
});

// Admin Only: Update company settings
router.put("/current/settings", requireAuth, requireMinRole('Company Administrator'), async (req, res) => {
  const companyId = req.activeCompany!.id;
  const { 
    legalName, tradeName, tin, address, branchCode, contactPerson, contactEmail, contactPhone,
    industry, fiscalYear, fiscalYearStartMonth, currency, accountingMethod, taxpayerClassification,
    taxpayerType, vatStatus, rdoCode, birRegistrationNo, birDateRegistered, documentLocationPath, backupLocationPath
  } = req.body;

  try {
    const beforeCompany = await db.select().from(companies).where(eq(companies.id, companyId)).get();

    // Note: companyId (id) is explicitly immutable and read-only!
    await db
      .update(companies)
      .set({
        ...(legalName && { legalName }),
        ...(tradeName && { tradeName }),
        ...(tin && { tin }),
        ...(address && { address }),
        ...(branchCode && { branchCode }),
        ...(contactPerson && { contactPerson }),
        ...(contactEmail && { contactEmail }),
        ...(contactPhone && { contactPhone }),
        ...(industry && { industry }),
        ...(fiscalYear && { fiscalYear: Number(fiscalYear) }),
        ...(fiscalYearStartMonth && { fiscalYearStartMonth: Number(fiscalYearStartMonth) }),
        ...(currency && { currency }),
        ...(accountingMethod && { accountingMethod }),
        ...(taxpayerClassification && { taxpayerClassification }),
        ...(taxpayerType && { taxpayerType }),
        ...(vatStatus && { vatStatus }),
        ...(rdoCode && { rdoCode }),
        ...(birRegistrationNo && { birRegistrationNo }),
        ...(birDateRegistered && { birDateRegistered }),
        ...(documentLocationPath && { documentLocationPath }),
        ...(backupLocationPath && { backupLocationPath }),
        updatedAt: new Date()
      })
      .where(eq(companies.id, companyId));

    // Also update company tax profile if present
    const existingTaxProfile = await db.select().from(companyTaxProfiles).where(eq(companyTaxProfiles.companyId, companyId)).get();
    if (existingTaxProfile) {
      await db.update(companyTaxProfiles)
        .set({
          ...(tin && { tin }),
          ...(legalName && { registeredName: legalName }),
          ...(tradeName && { tradeName }),
          ...(rdoCode && { rdoCode }),
          ...(taxpayerClassification && { taxpayerClassification }),
          ...(vatStatus && { vatStatus }),
          ...(accountingMethod && { taxMethod: accountingMethod }),
          updatedAt: new Date()
        })
        .where(eq(companyTaxProfiles.id, existingTaxProfile.id));
    }

    if (documentLocationPath || backupLocationPath || legalName) {
      const updates: any = {};
      if (documentLocationPath) {
        await CompanyManager.validateStorageIsolation(companyId, documentLocationPath);
        updates.location = documentLocationPath;
      }
      if (backupLocationPath) updates.backupLocation = backupLocationPath;
      if (legalName) updates.legalName = legalName;
      if (Object.keys(updates).length > 0) {
        await CompanyManager.updateCompanyManifest(companyId, updates);
      }
    }

    const changedFields: string[] = [];
    const afterData: Record<string, any> = {
      legalName: legalName || beforeCompany?.legalName,
      tradeName: tradeName || beforeCompany?.tradeName,
      tin: tin || beforeCompany?.tin,
      address: address || beforeCompany?.address,
      branchCode: branchCode || beforeCompany?.branchCode,
      contactPerson: contactPerson || beforeCompany?.contactPerson,
      contactEmail: contactEmail || beforeCompany?.contactEmail,
      contactPhone: contactPhone || beforeCompany?.contactPhone,
      industry: industry || beforeCompany?.industry,
      taxpayerClassification: taxpayerClassification || beforeCompany?.taxpayerClassification,
      vatStatus: vatStatus || beforeCompany?.vatStatus,
      rdoCode: rdoCode || beforeCompany?.rdoCode,
      birRegistrationNo: birRegistrationNo || beforeCompany?.birRegistrationNo,
      documentLocationPath: documentLocationPath || beforeCompany?.documentLocationPath,
      backupLocationPath: backupLocationPath || beforeCompany?.backupLocationPath,
    };

    if (beforeCompany) {
      for (const [k, v] of Object.entries(afterData)) {
        if (v !== undefined && (beforeCompany as any)[k] !== v) {
          changedFields.push(k);
        }
      }
    }

    await AuditService.log({
      req,
      companyId,
      action: "COMPANY_UPDATED",
      entityType: "COMPANY",
      entityId: companyId,
      entityName: legalName || beforeCompany?.legalName || (req.activeCompany as any)?.legalName || companyId,
      module: "COMPANY",
      beforeData: beforeCompany,
      afterData,
      changedFields,
      metadata: { legalName, tradeName, tin, changedFields }
    });

    res.json({ message: "Company settings updated successfully", companyId });
  } catch (err: any) {
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message || "Failed to update company settings" });
  }
});

// Public: Get a single profile info for login screen
router.get("/:id", async (req, res) => {
  const allCompanies = await CompanyManager.listCompanies();
  const company = allCompanies.find(c => c.id === req.params.id);
  
  if (!company) {
    res.status(404).json({ error: "NOT_FOUND", message: "Company profile not found" });
    return;
  }
  res.json({
    id: company.id,
    legalName: company.legalName,
    tradeName: company.legalName,
    isDemo: company.isDemo
  });
});

// Validate folder path accessibility and writability
router.post("/validate-folder", async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath || typeof folderPath !== 'string') {
    res.status(400).json({ valid: false, message: "Folder path is required" });
    return;
  }
  try {
    const resolvedPath = path.resolve(folderPath);
    await fs.mkdir(resolvedPath, { recursive: true });
    const testFile = path.join(resolvedPath, `test_write_${Date.now()}.tmp`);
    await fs.writeFile(testFile, 'ok');
    await fs.unlink(testFile);
    res.json({ valid: true, path: resolvedPath.replace(/\\/g, '/'), message: "Folder is accessible and writable." });
  } catch (err: any) {
    console.error("validate-folder error:", err);
    res.status(400).json({ valid: false, message: `Folder is not accessible or writable: ${err.message}` });
  }
});

// Explore system directory structure for folder selection modal
router.post("/explore-directory", async (req, res) => {
  try {
    let { targetPath } = req.body;
    if (!targetPath || typeof targetPath !== 'string' || !targetPath.trim()) {
      targetPath = COMPANIES_ROOT;
    }
    const trimmedPath = targetPath.trim();
    const resolvedPath = path.resolve(trimmedPath);

    // Ensure directory exists or attempt to create it
    try {
      await fs.mkdir(resolvedPath, { recursive: true });
    } catch (_) {}

    let folders: Array<{ name: string; path: string; isDirectory: boolean }> = [];
    try {
      const items = await fs.readdir(resolvedPath, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory() && !item.name.startsWith('.')) {
          folders.push({
            name: item.name,
            path: path.join(resolvedPath, item.name).replace(/\\/g, '/'),
            isDirectory: true
          });
        }
      }
    } catch (readdirErr: any) {
      console.warn("Directory readdir notice:", readdirErr?.message);
    }

    const parentPath = path.dirname(resolvedPath);
    const isRoot = parentPath === resolvedPath;

    res.json({
      currentPath: resolvedPath.replace(/\\/g, '/'),
      parentPath: isRoot ? null : parentPath.replace(/\\/g, '/'),
      folders,
      canWrite: true
    });
  } catch (err: any) {
    res.status(500).json({ error: "EXPLORE_ERROR", message: err.message || "Failed to explore directory" });
  }
});

// Create new subfolder inside specified parent path
router.post("/create-folder", async (req, res) => {
  try {
    const { parentPath, folderName } = req.body;
    if (!parentPath || !folderName || !folderName.trim()) {
      res.status(400).json({ error: "INVALID_INPUT", message: "Parent directory path and folder name are required." });
      return;
    }
    const safeName = folderName.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '_');
    const targetPath = path.join(parentPath, safeName);
    const resolvedPath = path.resolve(targetPath);

    await fs.mkdir(resolvedPath, { recursive: true });
    res.json({
      success: true,
      newPath: resolvedPath.replace(/\\/g, '/'),
      folderName: safeName
    });
  } catch (err: any) {
    res.status(500).json({ error: "CREATE_FOLDER_ERROR", message: err.message || "Failed to create directory" });
  }
});

// Public: Create a new company profile (Phase 4 Setup Wizard)
router.post("/create-profile", async (req, res) => {
  const { company, tax, accounting, locations, admin, locationPath } = req.body;
  let createdCompanyId: string | null = null;
  let targetDocFolder: string | undefined = undefined;
  try {
    const fiscalYearVal = Number(accounting?.fiscalYear) || 2026;
    const indCode = (company?.industry || "COR").replace(/[^A-Za-z]/g, "").substring(0, 3).toUpperCase() || "COR";
    const bCode = (company?.branchCode || "00").replace(/[^0-9]/g, "").padStart(2, '0').substring(0, 2);
    const randPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    const companyId = `LGR-PH-${fiscalYearVal}-${indCode}-${bCode}-${randPart}`;
    createdCompanyId = companyId;
    const userId = crypto.randomUUID();

    const legalName = company?.legalName || "New Company";
    const tradeName = company?.tradeName || legalName;
    const tin = company?.tin || "";
    const address = company?.address || "";
    const branchCode = company?.branchCode || "00000";
    const contactPerson = company?.contactPerson || "";
    const contactEmail = company?.contactEmail || admin?.email || "";
    const contactPhone = company?.contactPhone || "";
    const industry = company?.industry || "General Business";

    const taxpayerClassification = tax?.taxpayerClassification || tax?.taxpayerType || "CORPORATION";
    const taxpayerType = tax?.taxpayerType || taxpayerClassification;
    const vatStatus = tax?.vatStatus || "VAT";
    const rdoCode = tax?.rdoCode || "039";
    const birRegistrationNo = tax?.birRegistrationNo || "";
    const birDateRegistered = tax?.birDateRegistered || "";

    const fiscalYear = Number(accounting?.fiscalYear) || 2026;
    const fiscalYearStartMonth = Number(accounting?.fiscalYearStartMonth) || 1;
    const currency = accounting?.currency || "PHP";
    const accountingMethod = accounting?.accountingMethod || "ACCRUAL";

    const docLocationPath = locations?.documentLocationPath || locationPath || path.join(COMPANIES_ROOT, companyId);
    targetDocFolder = docLocationPath;
    const backupLocationPath = locations?.backupLocationPath || path.join(COMPANIES_ROOT, companyId, 'backups');

    try {
      await CompanyManager.validateStorageIsolation(companyId, docLocationPath);
    } catch (err: any) {
      res.status(400).json({
        error: "INVALID_LOCATION",
        message: err.message
      });
      return;
    }

    // Validate Company Profile Storage Folder
    try {
      const resolvedDocPath = path.resolve(docLocationPath);
      await fs.mkdir(resolvedDocPath, { recursive: true });
      const testFileDoc = path.join(resolvedDocPath, `test_write_${Date.now()}.tmp`);
      await fs.writeFile(testFileDoc, 'ok');
      await fs.unlink(testFileDoc);
    } catch (err: any) {
      res.status(400).json({
        error: "INVALID_LOCATION",
        message: `Company Profile Storage Folder is invalid or inaccessible: ${err.message}`
      });
      return;
    }

    // Validate Backup Folder
    try {
      const resolvedBackupPath = path.resolve(backupLocationPath);
      await fs.mkdir(resolvedBackupPath, { recursive: true });
      const testFileBackup = path.join(resolvedBackupPath, `test_write_${Date.now()}.tmp`);
      await fs.writeFile(testFileBackup, 'ok');
      await fs.unlink(testFileBackup);
    } catch (err: any) {
      res.status(400).json({
        error: "INVALID_LOCATION",
        message: `Company Backup Folder is invalid or inaccessible: ${err.message}`
      });
      return;
    }

    // 1. Create isolated profile storage structure on disk (staged with skipRegistry: true)
    let manifest;
    try {
      manifest = await CompanyManager.createCompanyProfile(companyId, legalName, docLocationPath, backupLocationPath, true);
    } catch (stageErr: any) {
      console.error("Failed to stage company directory structure:", stageErr);
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: `Failed to create company storage folder structure: ${stageErr.message}`
      });
      return;
    }

    try {
      const companyDb = await CompanyManager.getCompanyDb(companyId);

      await dbContext.run(companyDb, async () => {
        // 2. Insert master company record inside its isolated DB
        await db.insert(companies).values({
          id: companyId,
          legalName,
          tradeName,
          tin,
          address,
          branchCode,
          contactPerson,
          contactEmail,
          contactPhone,
          industry,
          fiscalYear,
          fiscalYearStartMonth,
          currency,
          accountingMethod,
          taxpayerClassification,
          taxpayerType,
          vatStatus,
          rdoCode,
          birRegistrationNo,
          birDateRegistered,
          documentLocationPath: docLocationPath,
          backupLocationPath: backupLocationPath,
          status: "ACTIVE",
          isDemo: false
        }).onConflictDoUpdate({
          target: companies.id,
          set: {
            legalName,
            tradeName,
            tin,
            address,
            branchCode,
            contactPerson,
            contactEmail,
            contactPhone,
            industry,
            fiscalYear,
            fiscalYearStartMonth,
            currency,
            accountingMethod,
            taxpayerClassification,
            taxpayerType,
            vatStatus,
            rdoCode,
            birRegistrationNo,
            birDateRegistered,
            documentLocationPath: docLocationPath,
            backupLocationPath: backupLocationPath,
            updatedAt: new Date()
          }
        });

        // 3. Insert tax registration profile
        await db.insert(companyTaxProfiles).values({
          id: crypto.randomUUID(),
          companyId,
          tin,
          rdo: rdoCode,
          taxpayerClassification,
          vatStatus,
          accountingPeriod: fiscalYearStartMonth === 1 ? 'CALENDAR' : 'FISCAL',
          registrationInformation: JSON.stringify({ birRegistrationNo, birDateRegistered })
        }).onConflictDoNothing();

        // 4. Create Admin / Owner User
        const passwordHash = await bcrypt.hash(admin.password, 10);
        let finalUserId = userId;
        const existingUser = await db.select().from(users).where(eq(users.email, admin.email)).get();
        if (existingUser) {
          finalUserId = existingUser.id;
          await db.update(users).set({
            passwordHash,
            displayName: admin.displayName || existingUser.displayName
          }).where(eq(users.id, finalUserId));
        } else {
          await db.insert(users).values({
            id: finalUserId,
            email: admin.email,
            passwordHash,
            displayName: admin.displayName || "Company Admin",
            status: "ACTIVE"
          });
        }

        // Ensure system roles exist in the isolated company DB
        let ownerRole = await db.select().from(roles).where(eq(roles.name, "Company Owner")).get();
        if (!ownerRole) {
          ownerRole = await db.select().from(roles).where(eq(roles.code, "COMPANY_OWNER")).get();
        }
        if (!ownerRole) {
          const newRoleId = 'role-company-owner';
          await db.insert(roles).values({
            id: newRoleId,
            code: 'COMPANY_OWNER',
            name: 'Company Owner',
            description: 'Full access to all modules and system settings',
            isSystem: true
          });
          ownerRole = await db.select().from(roles).where(eq(roles.id, newRoleId)).get();
        }

        const roleId = ownerRole ? ownerRole.id : null;

        // Link User to Company as Active Member
        const membershipId = crypto.randomUUID();
        await db.insert(companyUsers).values({
          id: membershipId,
          userId: finalUserId,
          companyId,
          roleId,
          status: "ACTIVE"
        });

        // Also assign in company_user_roles for Phase 3 Multi-Role RBAC engine
        if (roleId) {
          await db.insert(companyUserRoles).values({
            id: crypto.randomUUID(),
            companyUserId: membershipId,
            roleId,
            assignedBy: finalUserId
          }).onConflictDoNothing();
        }

        // 5. Seed BIR-Adaptive Chart of Accounts (COA)
        const accountMap = new Map<string, string>(); // code -> id

        // Build dynamic adaptive COA list based on BIR VAT status and taxpayer classification Core Engine Rules
        const activeEngineRules = getBirTaxProfileRules(taxpayerClassification, vatStatus);
        const adaptiveCoa = [...DEFAULT_PHILIPPINE_COA];

        if (vatStatus === 'NON_VAT') {
          adaptiveCoa.push(
            { accountCode: "2120", accountName: "Percentage Tax Payable (Form 2551Q - 3%)", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true },
            { accountCode: "6080", accountName: "Percentage Tax Expense (3%)", accountType: "EXPENSE", normalBalance: "DEBIT" }
          );
        } else if (vatStatus === 'PEZA_BOI' || vatStatus === 'FREEPORT') {
          adaptiveCoa.push(
            { accountCode: "2130", accountName: "Special Gross Income Tax Payable (5% GIT)", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true },
            { accountCode: "4030", accountName: "Tax Exempt / Ecozone Sales Revenue", accountType: "REVENUE", normalBalance: "CREDIT" }
          );
        } else if (vatStatus === 'PERCENTAGE_CARRIER') {
          adaptiveCoa.push(
            { accountCode: "2140", accountName: "Common Carrier Tax Payable (3% CCT)", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true }
          );
        } else if (vatStatus === 'PERCENTAGE_BANK_GRT') {
          adaptiveCoa.push(
            { accountCode: "2150", accountName: "Gross Receipts Tax Payable (1%-7% GRT)", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true }
          );
        } else if (vatStatus === 'ZERO_RATED' || vatStatus === 'EXEMPT' || vatStatus === 'COOPERATIVE_EXEMPT') {
          adaptiveCoa.push(
            { accountCode: "4030", accountName: "VAT Exempt / Zero-Rated Sales Revenue", accountType: "REVENUE", normalBalance: "CREDIT" }
          );
        }

        if (taxpayerClassification === 'INDIVIDUAL' || taxpayerClassification === 'INDIVIDUAL_8PERCENT' || taxpayerClassification === 'OPC') {
          adaptiveCoa.push(
            { accountCode: "3020", accountName: "Proprietor Drawings / Personal Distributions", accountType: "EQUITY", normalBalance: "DEBIT" }
          );
        } else if (taxpayerClassification === 'PARTNERSHIP' || taxpayerClassification === 'GPP') {
          adaptiveCoa.push(
            { accountCode: "3030", accountName: "Partner Capital - Managing Partner", accountType: "EQUITY", normalBalance: "CREDIT" },
            { accountCode: "3040", accountName: "Partner Drawings / Profit Share Distributions", accountType: "EQUITY", normalBalance: "DEBIT" }
          );
        } else if (taxpayerClassification === 'COOPERATIVE') {
          adaptiveCoa.push(
            { accountCode: "3050", accountName: "Cooperative Reserve Fund (RA 9520 Statutory Reserve)", accountType: "EQUITY", normalBalance: "CREDIT" },
            { accountCode: "3060", accountName: "Patronage Refund & Interest on Share Capital Payable", accountType: "LIABILITY", normalBalance: "CREDIT" }
          );
        } else if (vatStatus === 'BMBE') {
          adaptiveCoa.push(
            { accountCode: "3070", accountName: "BMBE Micro Capital Reserve (RA 9178)", accountType: "EQUITY", normalBalance: "CREDIT" }
          );
        }


        for (const accountDef of adaptiveCoa) {
          const accId = crypto.randomUUID();
          await db.insert(accounts).values({
            id: accId,
            companyId,
            accountCode: accountDef.accountCode,
            accountName: accountDef.accountName,
            accountType: accountDef.accountType,
            normalBalance: accountDef.normalBalance,
            isCashAccount: !!(accountDef as any).isCashAccount,
            isControlAccount: !!(accountDef as any).isControlAccount,
            isTaxAccount: !!(accountDef as any).isTaxAccount,
            isRetainedEarnings: !!(accountDef as any).isRetainedEarnings,
            isActive: true
          }).onConflictDoNothing();
          accountMap.set(accountDef.accountCode, accId);
        }

        // 6. Generate 12 Monthly Accounting Periods
        const periodIds: { month: string; id: string }[] = [];
        for (let i = 0; i < 12; i++) {
          const mIdx = (fiscalYearStartMonth - 1 + i) % 12;
          const yrOffset = Math.floor((fiscalYearStartMonth - 1 + i) / 12);
          const curYr = fiscalYear + yrOffset;
          const monthStr = String(mIdx + 1).padStart(2, '0');
          const lastDayNum = new Date(curYr, mIdx + 1, 0).getDate();
          const periodName = `${curYr}-${monthStr}`;
          const startDate = `${curYr}-${monthStr}-01`;
          const endDate = `${curYr}-${monthStr}-${String(lastDayNum).padStart(2, '0')}`;
          const pId = crypto.randomUUID();

          await db.insert(accountingPeriods).values({
            id: pId,
            companyId,
            name: periodName,
            startDate,
            endDate,
            fiscalYear: curYr,
            status: "OPEN"
          }).onConflictDoNothing();

          periodIds.push({ month: periodName, id: pId });
        }

        // 7. Seed Beginning Balances if provided
        if (Array.isArray(accounting?.beginningBalances) && accounting.beginningBalances.length > 0) {
          const entryId = crypto.randomUUID();
          const entryDate = `${fiscalYear}-01-01`;
          const firstPeriodId = periodIds[0]?.id || null;

          const linesToInsert: { id: string; journalEntryId: string; accountId: string; debit: number; credit: number; description: string; lineNumber: number }[] = [];
          let lineNo = 1;
          for (const b of accounting.beginningBalances) {
            const deb = Math.round((Number(b.debit) || 0) * 100); // in cents or integers
            const cred = Math.round((Number(b.credit) || 0) * 100);
            if (deb === 0 && cred === 0) continue;

            const accId = accountMap.get(b.accountCode) || b.accountId;
            if (accId) {
              linesToInsert.push({
                id: crypto.randomUUID(),
                journalEntryId: entryId,
                accountId: accId,
                debit: deb,
                credit: cred,
                description: "Beginning Balance Opening Entry",
                lineNumber: lineNo++
              });
            }
          }

          if (linesToInsert.length > 0) {
            await db.insert(journalEntries).values({
              id: entryId,
              companyId,
              accountingPeriodId: firstPeriodId,
              journalNumber: `JE-OPENING-${fiscalYear}`,
              entryDate,
              sourceType: "OPENING_BALANCE",
              description: "Initial Beginning Balances Setup",
              status: "POSTED",
              createdBy: finalUserId,
              postedBy: finalUserId,
              postedAt: new Date()
            });

            for (const line of linesToInsert) {
              await db.insert(journalLines).values(line);
            }
          }
        }

        // 8. Initialize License Readiness (7-Day Trial License)
        const nowTime = new Date();
        const trialStartDate = nowTime.toISOString().slice(0, 10);
        const trialEndDate = new Date(nowTime.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        await db.insert(companyLicenses).values({
          id: crypto.randomUUID(),
          companyId,
          licenseKey: `LIC-TRIAL-${companyId.slice(0, 8).toUpperCase()}`,
          planType: "TRIAL",
          status: "ACTIVE",
          trialStartDate: trialStartDate,
          expirationDate: trialEndDate,
          signedFileContent: JSON.stringify({ companyId, plan: "TRIAL", active: true, trialStartDate, expirationDate: trialEndDate }),
          isLifetime: false
        });

        // 9. Audit Log Entry
        await AuditService.log({
          req,
          userId: finalUserId,
          userEmail: admin.email,
          userDisplayName: admin.displayName,
          companyId,
          action: "COMPANY_CREATED",
          entityType: "COMPANY",
          entityId: companyId,
          entityName: legalName,
          module: "COMPANY",
          afterData: { legalName, tradeName, tin, taxpayerClassification, vatStatus, rdoCode, documentLocationPath: docLocationPath, backupLocationPath },
          source: "WEB_UI"
        });
      });

      // Commit company to global registry file only after complete database setup succeeds
      await CompanyManager.registerCompany(manifest);
      CompanyManager.removeTempManifest(companyId);

      res.json({ message: "Company profile created successfully", companyId });
    } catch (dbError: any) {
      console.error("Atomic Company Creation Failed — triggering rollback:", dbError);
      await CompanyManager.rollbackCompanyCreation(companyId, docLocationPath);
      res.status(500).json({ error: "INTERNAL_ERROR", message: `Company profile creation failed and was safely rolled back: ${dbError.message}` });
    }
  } catch (err: any) {
    console.error("Create Profile Error:", err?.stack || err, err?.cause);
    if (createdCompanyId) {
      await CompanyManager.rollbackCompanyCreation(createdCompanyId, targetDocFolder).catch(() => {});
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: `${err?.message || "Failed"} | Cause: ${JSON.stringify(err?.cause || {})}` });
  }
});

export default router;

