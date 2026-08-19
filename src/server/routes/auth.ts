import { Router } from "express";
import { db } from "../db";
import { users, companyUsers, companies, roles, rolePermissions, permissions, sessions, auditLogs } from "../db/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth, normalizeRole, generateSessionId, hashToken, parseToken } from "../auth";
import crypto from "crypto";
import { AuditService } from "../services/auditService";
import { CompanyManager } from "../services/companyManager";
import { RbacService } from "../services/rbacService";
import { dbContext } from "../db/context";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password, companyId } = req.body;
  if (!email || !password || !companyId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Email, password, and company selection are required" });
    return;
  }

  try {
    const companyDb = await CompanyManager.getCompanyDb(companyId);
    
    await dbContext.run(companyDb, async () => {
      const user = await db.select().from(users).where(eq(users.email, email)).get();
      
      if (!user || user.status !== "ACTIVE") {
        await AuditService.log({
          req,
          companyId,
          action: "LOGIN_FAILED",
          entityType: "AUTHENTICATION",
          entityId: "system",
          result: "FAILED",
          reason: "invalid_user",
          module: "AUTH",
          source: "WEB_UI",
          metadata: { email }
        });
        res.status(401).json({ error: "AUTH_REQUIRED", message: "Invalid email or password." });
        return;
      }

      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        res.status(401).json({ error: "ACCOUNT_LOCKED", message: "Account is temporarily locked. Please try again later." });
        return;
      }

      const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

      if (!isPasswordValid) {
        const failedAttempts = (user.failedLoginAttempts || 0) + 1;
        const updates: any = { failedLoginAttempts: failedAttempts };
        
        if (failedAttempts >= 5) {
          updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
        }
        
        await db.update(users).set(updates).where(eq(users.id, user.id));

        await AuditService.log({
          req,
          userId: user.id,
          userEmail: user.email,
          userDisplayName: user.displayName,
          companyId,
          action: "LOGIN_FAILED",
          entityType: "AUTHENTICATION",
          entityId: user.id,
          result: "FAILED",
          reason: "invalid_password",
          module: "AUTH",
          source: "WEB_UI"
        });
        res.status(401).json({ error: "AUTH_REQUIRED", message: "Invalid email or password." });
        return;
      }

      // Verify company membership
      const membership = await db
        .select()
        .from(companyUsers)
        .where(
          and(
            eq(companyUsers.userId, user.id)
          )
        )
        .get();

      if (!membership || membership.status !== "ACTIVE") {
        await AuditService.log({
          req,
          userId: user.id,
          userEmail: user.email,
          userDisplayName: user.displayName,
          companyId,
          action: "LOGIN_FAILED",
          entityType: "AUTHENTICATION",
          entityId: companyId,
          result: "FAILED",
          reason: "unauthorized_company",
          module: "AUTH",
          source: "WEB_UI"
        });
        res.status(403).json({ error: "COMPANY_ACCESS_DENIED", message: "Unable to access this company profile." });
        return;
      }

      // Successful login
      await db.update(users).set({ 
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null
      }).where(eq(users.id, user.id));

      // Update lastOpenedAt on login
      await CompanyManager.updateCompanyManifest(companyId, { lastOpenedAt: new Date().toISOString() }).catch(() => {});

      const sessionId = generateSessionId();
      const hashedSessionId = hashToken(sessionId);

      await db.insert(sessions).values({
        id: hashedSessionId,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      });

      const token = `${companyId}.${sessionId}`;
      
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 1000, // 1 hour
      });

      await AuditService.log({
        req,
        userId: user.id,
        userEmail: user.email,
        userDisplayName: user.displayName,
        companyId,
        action: "LOGIN_SUCCESS",
        entityType: "AUTHENTICATION",
        entityId: user.id,
        result: "SUCCESS",
        module: "AUTH",
        source: "WEB_UI"
      });

      const comp = await db.select().from(companies).where(eq(companies.id, companyId)).get();
      
      let roleRecord = membership.roleId ? await db.select().from(roles).where(eq(roles.id, membership.roleId)).get() : null;
      const normRole = normalizeRole(roleRecord?.code || roleRecord?.name || membership.legacyRole);

      const activeCompanyObj = comp ? { 
        id: comp.id, 
        legalName: comp.legalName,
        tradeName: comp.tradeName,
        tin: comp.tin,
        vatStatus: comp.vatStatus || 'VAT',
        taxpayerClassification: comp.taxpayerClassification || 'CORPORATION',
        taxpayerType: comp.taxpayerType || comp.taxpayerClassification || 'CORPORATION',
        rdoCode: comp.rdoCode,
        roleId: membership.roleId,
        roleCode: roleRecord?.code || null,
        roleName: roleRecord?.name || normRole,
        role: normRole
      } : null;

      let permissionsList: string[] = [];
      if (membership) {
        permissionsList = await RbacService.evaluateEffectivePermissions(membership.id);
      }

      res.json({ 
        message: "Login successful", 
        token,
        user: { 
          id: user.id, 
          email: user.email, 
          displayName: user.displayName, 
          theme: user.theme || 'light',
          requirePasswordChange: user.requirePasswordChange
        }, 
        activeCompany: activeCompanyObj,
        permissions: permissionsList
      });
    });
  } catch (error: any) {
    console.error('Login process error:', error);
    import('fs').then(fs => fs.writeFileSync('/tmp/login_error.log', String(error?.stack || error)));
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Failed to process login." });
  }
});

router.put("/preferences", requireAuth, async (req, res) => {
  const { theme } = req.body;
  if (!theme || !["light", "dark", "system"].includes(theme)) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid theme value" });
    return;
  }
  
  await db.update(users).set({ theme }).where(eq(users.id, req.user!.id));
      
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    userId: req.user!.id,
    companyId: req.activeCompany?.id || null,
    action: "UPDATE_PREFERENCES",
    entityType: "user",
    entityId: req.user!.id,
    metadata: JSON.stringify({ theme }),
  });

  res.json({ message: "Preferences updated successfully", theme });
});

router.post("/logout", requireAuth, async (req, res) => {
  if (req.user && req.sessionId) {
    await db.delete(sessions).where(eq(sessions.id, req.sessionId));
    
    await AuditService.log({
      req,
      action: "LOGOUT",
      entityType: "AUTHENTICATION",
      entityId: req.user.id,
      module: "AUTH",
      source: "WEB_UI"
    });
  }
  res.clearCookie("token");
  res.json({ message: "Logout successful" });
});

router.post("/logout-all", requireAuth, async (req, res) => {
  if (req.user) {
    await db.delete(sessions).where(eq(sessions.userId, req.user.id));
    
    await AuditService.log({
      req,
      action: "LOGOUT_ALL",
      entityType: "AUTHENTICATION",
      entityId: req.user.id,
      module: "AUTH",
      source: "WEB_UI"
    });
  }
  res.clearCookie("token");
  res.json({ message: "All sessions logged out successfully" });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Current and new passwords are required" });
    return;
  }

  const user = await db.select().from(users).where(eq(users.id, req.user!.id)).get();
  if (!user) {
    res.status(404).json({ error: "NOT_FOUND", message: "User not found" });
    return;
  }

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid current password" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  
  await db.update(users).set({ 
    passwordHash, 
    requirePasswordChange: false 
  }).where(eq(users.id, user.id));

  // Optionally delete other sessions
  await db.delete(sessions).where(
    and(
      eq(sessions.userId, user.id),
      // we can't use 'not eq' easily without neq, but we can just logout the current one too, or all
    )
  );
  
  res.clearCookie("token");

  await AuditService.log({
    req,
    action: "PASSWORD_CHANGED",
    entityType: "AUTHENTICATION",
    entityId: user.id,
    module: "AUTH",
    source: "WEB_UI"
  });

  res.json({ message: "Password updated successfully. Please log in again." });
});

router.get("/session", requireAuth, async (req, res) => {
  const currentToken = req.cookies?.token || req.headers.authorization?.split(" ")[1] || null;
  let activeCompanyObj = null;
  if (req.activeCompany) {
    const comp = await db.select().from(companies).where(eq(companies.id, req.activeCompany.id)).get();
    activeCompanyObj = {
      id: req.activeCompany.id,
      legalName: comp?.legalName || "Active Company",
      tradeName: comp?.tradeName,
      tin: comp?.tin,
      vatStatus: comp?.vatStatus || 'VAT',
      taxpayerClassification: comp?.taxpayerClassification || 'CORPORATION',
      taxpayerType: comp?.taxpayerType || comp?.taxpayerClassification || 'CORPORATION',
      rdoCode: comp?.rdoCode,
      roleId: req.activeCompany.roleId,
      roleCode: req.activeCompany.roleCode,
      roleName: req.activeCompany.roleName || req.activeCompany.role,
      role: req.activeCompany.role
    };
  }

  const user = await db.select().from(users).where(eq(users.id, req.user!.id)).get();

  res.json({
    token: currentToken,
    user: {
      ...req.user,
      requirePasswordChange: user?.requirePasswordChange
    },
    activeCompany: activeCompanyObj,
    permissions: req.permissions,
  });
});

export default router;
