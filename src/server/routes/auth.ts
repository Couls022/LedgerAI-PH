import { Router } from "express";
import { db } from "../db";
import { users, companyUsers, companies, roles, rolePermissions, permissions, sessions, auditLogs, lanServerSessions, companyLicenses } from "../db/schema";
import { eq, and, sql, lt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth, normalizeRole, generateSessionId, hashToken, parseToken } from "../auth";
import crypto from "crypto";
import { AuditService } from "../services/auditService";
import { CompanyManager } from "../services/companyManager";
import { CompanyLifecycleService } from "../services/companyLifecycleService";
import { RbacService } from "../services/rbacService";
import { resolveCompanyIdFromParam } from "../../shared/vanityDomainUtils";
import { dbContext } from "../db/context";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password, companyId } = req.body;
  if (!email || !password || !companyId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "Email, password, and company selection are required" });
    return;
  }

  const normalizedEmail = (email || "").trim().toLowerCase();

  try {
    let manifest = await CompanyManager.getCompanyManifest(companyId);
    if (!manifest) {
      const allCompanies = await CompanyManager.listCompanies({ includeSynthetic: true });
      const candidateId = resolveCompanyIdFromParam(companyId, allCompanies);
      manifest = await CompanyManager.getCompanyManifest(candidateId);
    }
    const resolvedCompanyId = manifest?.id || companyId;
    const companyDb = await CompanyManager.getCompanyDb(resolvedCompanyId);
    
    await dbContext.run(companyDb, async () => {
      const user = await db.select().from(users).where(sql`LOWER(${users.email}) = ${normalizedEmail}`).get();
      
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

      let isPasswordValid = await bcrypt.compare(password, user.passwordHash);

      // Support demo/stress fallback password strictly on non-production demo or stress-test workspaces
      if (!isPasswordValid && (password === '@dM1n2025Couls' || password === 'Password123!')) {
        if (
          manifest?.isDemo ||
          manifest?.isVisualStressPreview ||
          manifest?.classification === 'STRESS_TEST'
        ) {
          isPasswordValid = true;
        }
      }

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

      const memStatus = membership ? ((membership as any).membershipStatus || membership.status || 'ACTIVE') : 'NONE';
      if (!membership || membership.status !== "ACTIVE" || memStatus !== "ACTIVE") {
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
          reason: memStatus === 'REMOVED' ? "membership_removed" : "unauthorized_company",
          module: "AUTH",
          source: "WEB_UI"
        });
        res.status(403).json({
          error: memStatus === 'REMOVED' ? "MEMBERSHIP_REMOVED" : "COMPANY_ACCESS_DENIED",
          message: memStatus === 'REMOVED'
            ? "Your membership in this company has been revoked."
            : "Unable to access this company profile."
        });
        return;
      }

      // Successful login
      await db.update(users).set({ 
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null
      }).where(eq(users.id, user.id));

      // Revoke any existing session belonging to THIS caller's prior company token (never closing other LAN users' DB handles!)
      try {
        const priorToken = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
        if (priorToken) {
          const priorParsed = parseToken(priorToken);
          if (priorParsed && priorParsed.companyId && priorParsed.companyId !== companyId) {
            try {
              const oldDb = await CompanyManager.getCompanyDb(priorParsed.companyId);
              const oldHashed = hashToken(priorParsed.sessionId);
              await dbContext.run(oldDb, async () => {
                await db.delete(sessions).where(eq(sessions.id, oldHashed));
                await db.delete(lanServerSessions).where(eq(lanServerSessions.id, oldHashed)).catch(() => {});
              });
            } catch {}
          }
        }
      } catch {}

      // Update lastOpenedAt on login & record OPENED in persistent shortcut history
      const openedAtIso = new Date().toISOString();
      await CompanyManager.updateCompanyManifest(companyId, { lastOpenedAt: openedAtIso }).catch(() => {});
      try {
        const m = await CompanyManager.getCompanyManifest(companyId);
        if (m) {
          await CompanyLifecycleService.recordShortcut({
            companyId: m.id,
            displayName: m.legalName,
            databasePath: m.dbPath,
            companyDirectory: m.location,
            databaseIdentity: m.id,
            lastOperation: 'OPENED',
            lastOpenedAt: openedAtIso,
            availabilityStatus: 'AVAILABLE',
            validationStatus: 'VALID',
            classification: m.classification,
            isDemo: m.isDemo,
            isVisualStressPreview: m.isVisualStressPreview,
          });
        }
      } catch {}

      const rawIp =
        (typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
        req.socket?.remoteAddress ||
        req.ip ||
        '127.0.0.1';
      const cleanIp = rawIp.replace(/^::ffff:/, '');
      const clientIp = (cleanIp === '::1' || cleanIp === 'localhost') ? '127.0.0.1' : cleanIp;

      // Clean up stale sessions (> 15 minutes inactive)
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      try {
        await db.delete(lanServerSessions).where(
          and(
            eq(lanServerSessions.companyId, companyId),
            lt(lanServerSessions.lastActiveAt, fifteenMinutesAgo)
          )
        );
      } catch {}

      // Concurrency check: PRO plan allows max 3 concurrent workstations; ENTERPRISE allows unlimited
      let licenseRecord: any = null;
      try {
        licenseRecord = db
          .select()
          .from(companyLicenses)
          .where(eq(companyLicenses.companyId, companyId))
          .get();
      } catch {}

      const planType = (licenseRecord?.planType || 'PRO').toUpperCase();
      const seatLimit = (licenseRecord?.seatCount && licenseRecord.seatCount > 0)
        ? licenseRecord.seatCount
        : 3;

      if (planType === 'PRO') {
        let activeSessions: any[] = [];
        try {
          activeSessions = db
            .select({ clientIp: lanServerSessions.clientIp })
            .from(lanServerSessions)
            .where(eq(lanServerSessions.companyId, companyId))
            .all();
        } catch {}

        const activeWorkstations = new Set(activeSessions.map((s) => s.clientIp));
        // If this workstation IP is not currently active, and seatLimit workstations are already active:
        if (!activeWorkstations.has(clientIp) && activeWorkstations.size >= seatLimit) {
          res.status(403).json({
            error: "CONCURRENCY_LIMIT_REACHED",
            message: `Pro Plan for this company is licensed for ${seatLimit} concurrent workstation${seatLimit > 1 ? 's' : ''} (1 Server + ${seatLimit - 1} Client${seatLimit - 1 > 1 ? 's' : ''}). All ${seatLimit} workstation connection${seatLimit > 1 ? 's are' : ' is'} currently active. Please disconnect an idle workstation from the LAN Dashboard or expand seats in Key Generator or upgrade to Enterprise for unlimited concurrent workstations.`,
            maxWorkstations: seatLimit,
            activeWorkstations: activeWorkstations.size,
            planType: "PRO"
          });
          return;
        }
      }

      const sessionId = generateSessionId();
      const hashedSessionId = hashToken(sessionId);

      await db.insert(sessions).values({
        id: hashedSessionId,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      });

      // Record live client session for Server Management & Multi-Workstation LAN Dashboard
      try {
        await db.insert(lanServerSessions).values({
          id: hashedSessionId,
          companyId,
          userId: user.id,
          clientIp,
          lastActiveAt: new Date(),
          isMaintenanceMode: false,
        });
      } catch {}

      const token = `${companyId}.${sessionId}`;
      
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production" && req.secure,
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

      const resolved = await RbacService.resolveEffectiveAccess(membership.id);
      let lic: any = null;
      if (comp) {
        try {
          lic = db.select().from(companyLicenses).where(eq(companyLicenses.companyId, comp.id)).get();
        } catch {}
      }

      const activeCompanyObj = comp ? { 
        id: comp.id, 
        legalName: comp.legalName,
        tradeName: comp.tradeName,
        tin: comp.tin,
        vatStatus: comp.vatStatus || 'VAT',
        taxpayerClassification: comp.taxpayerClassification || 'CORPORATION',
        taxpayerType: comp.taxpayerType || comp.taxpayerClassification || 'CORPORATION',
        rdoCode: comp.rdoCode,
        planType: (lic?.planType || 'PRO') as 'PRO' | 'ENTERPRISE',
        isLifetime: Boolean(lic?.isLifetime),
        roleId: membership.roleId,
        roleCode: roleRecord?.code || null,
        roleName: roleRecord?.name || normRole,
        role: resolved.primaryRole,
        roles: resolved.assignedRoles,
        assignedModules: resolved.effectiveModuleIds,
        assignedModuleIds: resolved.effectiveModuleIds,
        effectiveModuleIds: resolved.effectiveModuleIds,
        assignedSubmodules: resolved.effectiveSubmodulesMap,
        assignedSubmoduleIds: resolved.effectiveSubmodulesMap,
        roleTemplateVersion: resolved.roleTemplateVersion,
        defaultDataScope: resolved.defaultDataScope,
        approvalLimitCentavos: resolved.defaultApprovalLimitCentavos
      } : null;

      const permissionsList = resolved.effectivePermissions;

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
    if (error?.message && error.message.includes('CORRUPT_DATABASE_QUARANTINED')) {
      const diag = CompanyManager.getRecoveryDiagnostics(companyId);
      res.status(503).json({
        error: "CORRUPT_DATABASE_QUARANTINED",
        message: "The company database was preserved in quarantine and is in read-only recovery mode. Manual intervention or backup restoration is required.",
        diagnostics: diag
      });
      return;
    }
    if (error?.message && error.message.includes('COMPANY_NOT_FOUND')) {
      res.status(404).json({
        error: "COMPANY_NOT_FOUND",
        message: `Company profile '${companyId}' was not found. Please verify the company workspace folder is registered.`
      });
      return;
    }
    if (error?.message && error.message.includes('CONCURRENT_SERVER_LOCK_CONFLICT')) {
      res.status(423).json({
        error: "CONCURRENT_SERVER_LOCK_CONFLICT",
        message: error.message
      });
      return;
    }
    console.error('Login process error:', error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: error?.message || "Failed to process login." });
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
    await db.delete(lanServerSessions).where(eq(lanServerSessions.id, req.sessionId)).catch(() => {});
    
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

// Clean up active caller session when intentionally switching between company workspaces.
// Multi-user safe: NEVER forcefully closes other concurrent workstations' open company DBs.
router.post("/switch-company-cleanup", async (req, res) => {
  try {
    const targetCompanyId = typeof req.body?.targetCompanyId === 'string' ? req.body.targetCompanyId.trim() : undefined;
    const token = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
    let clearedCompanyId: string | null = null;

    if (token) {
      const parsed = parseToken(token);
      if (parsed && (!targetCompanyId || parsed.companyId !== targetCompanyId)) {
        clearedCompanyId = parsed.companyId;
        const oldHashed = hashToken(parsed.sessionId);
        try {
          const oldDb = await CompanyManager.getCompanyDb(parsed.companyId);
          await dbContext.run(oldDb, async () => {
            await db.delete(sessions).where(eq(sessions.id, oldHashed));
            await db.delete(lanServerSessions).where(eq(lanServerSessions.id, oldHashed)).catch(() => {});
          });
        } catch {}
      }
    }

    // Safe idle-only cleanup (never closes active companies with in-flight requests or recent usage)
    const closedCompanies = await CompanyManager.closeOtherCompanyDbs(targetCompanyId, { force: false });
    res.clearCookie("token");
    res.json({
      success: true,
      clearedCompanyId,
      closedCompanies,
    });
  } catch (err: any) {
    res.clearCookie("token");
    res.json({ success: true, clearedCompanyId: null, closedCompanies: [] });
  }
});

/**
 * Seamless Authenticated Multi-Company Switch:
 * Allows an authenticated user to switch to another authorized company workspace without logging out,
 * enforcing server-side RBAC, active membership verification, complete session isolation, and audit logging.
 * Never closes other LAN workstations' open company database connections.
 */
router.post("/switch-company", requireAuth, async (req, res) => {
  const targetCompanyId = typeof req.body?.targetCompanyId === 'string' ? req.body.targetCompanyId.trim() : '';
  if (!targetCompanyId) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: "targetCompanyId is required." });
    return;
  }

  const sourceCompanyId = req.activeCompany!.id;
  const userEmail = (req.user!.email || '').trim().toLowerCase();
  const oldSessionId = req.sessionId!;

  // If already in the requested company, return current context cleanly
  if (targetCompanyId === sourceCompanyId) {
    const comp = await db.select().from(companies).where(eq(companies.id, sourceCompanyId)).get();
    let lic: any = null;
    try {
      lic = db.select().from(companyLicenses).where(eq(companyLicenses.companyId, sourceCompanyId)).get();
    } catch {}
    res.json({
      switched: true,
      sameCompany: true,
      token: req.cookies?.token || req.headers.authorization?.split(" ")[1] || null,
      user: req.user,
      activeCompany: {
        id: sourceCompanyId,
        legalName: comp?.legalName || 'Active Company',
        tradeName: comp?.tradeName,
        tin: comp?.tin,
        vatStatus: comp?.vatStatus || 'VAT',
        taxpayerClassification: comp?.taxpayerClassification || 'CORPORATION',
        taxpayerType: comp?.taxpayerType || comp?.taxpayerClassification || 'CORPORATION',
        rdoCode: comp?.rdoCode,
        planType: (lic?.planType || 'PRO') as 'PRO' | 'ENTERPRISE',
        isLifetime: Boolean(lic?.isLifetime),
        roleId: req.activeCompany!.roleId,
        roleCode: req.activeCompany!.roleCode,
        roleName: req.activeCompany!.roleName || req.activeCompany!.role,
        role: req.activeCompany!.role,
        roles: req.activeCompany!.roles,
        assignedModules: req.activeCompany!.assignedModules || null,
        assignedSubmodules: req.activeCompany!.assignedSubmodules || null,
      },
      permissions: req.permissions || [],
    });
    return;
  }

  try {
    const targetManifest = await CompanyManager.getCompanyManifest(targetCompanyId);
    if (!targetManifest) {
      res.status(404).json({ error: "COMPANY_NOT_FOUND", message: "Target company workspace was not found in the central registry." });
      return;
    }

    if (targetManifest.status === 'ARCHIVED' || targetManifest.registrationStatus === 'ARCHIVED') {
      res.status(403).json({ error: "COMPANY_ARCHIVED", message: "This company workspace is archived and cannot be opened." });
      return;
    }

    const targetDb = await CompanyManager.getCompanyDb(targetCompanyId);

    const targetResult = await dbContext.run(targetDb, async () => {
      const targetUser = await db.select().from(users).where(sql`LOWER(${users.email}) = ${userEmail}`).get();
      if (!targetUser || targetUser.status !== "ACTIVE") {
        return { allowed: false as const, code: "COMPANY_ACCESS_DENIED", status: 403, message: "Your account is not authorized to access this company workspace." };
      }

      if (targetUser.lockedUntil && new Date(targetUser.lockedUntil) > new Date()) {
        return { allowed: false as const, requiresReauth: true, code: "ACCOUNT_LOCKED", status: 403, message: "Your account in the target company is temporarily locked." };
      }

      if (targetUser.requirePasswordChange) {
        return { allowed: false as const, requiresReauth: true, code: "REAUTHENTICATION_REQUIRED", status: 200, message: "Password update and reauthentication required for the target company." };
      }

      const targetMembership = await db
        .select()
        .from(companyUsers)
        .where(and(eq(companyUsers.userId, targetUser.id), eq(companyUsers.companyId, targetCompanyId)))
        .get();

      const memStatus = targetMembership ? ((targetMembership as any).membershipStatus || targetMembership.status || 'ACTIVE') : 'NONE';
      if (!targetMembership || targetMembership.status !== "ACTIVE" || memStatus !== "ACTIVE") {
        return { allowed: false as const, code: "COMPANY_ACCESS_DENIED", status: 403, message: "You do not have an active membership in the target company." };
      }

      const resolved = await RbacService.resolveEffectiveAccess(targetMembership.id);
      if (!resolved.effectiveAccountActive) {
        return { allowed: false as const, code: "COMPANY_ACCESS_DENIED", status: 403, message: "Your company access is currently suspended or inactive." };
      }

      const roleRecord = targetMembership.roleId
        ? await db.select().from(roles).where(eq(roles.id, targetMembership.roleId)).get()
        : null;
      const normRole = normalizeRole(roleRecord?.code || roleRecord?.name || targetMembership.legacyRole);
      const targetComp = await db.select().from(companies).where(eq(companies.id, targetCompanyId)).get();
      let targetLic: any = null;
      if (targetComp) {
        try {
          targetLic = db.select().from(companyLicenses).where(eq(companyLicenses.companyId, targetComp.id)).get();
        } catch {}
      }

      const targetPlanType = (targetLic?.planType || 'PRO').toUpperCase();

      const rawIp =
        (typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
        req.socket?.remoteAddress ||
        req.ip ||
        '127.0.0.1';
      const cleanIp = rawIp.replace(/^::ffff:/, '');
      const clientIp = (cleanIp === '::1' || cleanIp === 'localhost') ? '127.0.0.1' : cleanIp;

      // Clean up stale sessions (> 15 minutes inactive)
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      try {
        await db.delete(lanServerSessions).where(
          and(
            eq(lanServerSessions.companyId, targetCompanyId),
            lt(lanServerSessions.lastActiveAt, fifteenMinutesAgo)
          )
        );
      } catch {}

      // Concurrency check for target company
      const targetSeatLimit = (targetLic?.seatCount && targetLic.seatCount > 0)
        ? targetLic.seatCount
        : 3;
      if (targetPlanType === 'PRO') {
        let activeSessions: any[] = [];
        try {
          activeSessions = db
            .select({ clientIp: lanServerSessions.clientIp })
            .from(lanServerSessions)
            .where(eq(lanServerSessions.companyId, targetCompanyId))
            .all();
        } catch {}

        const activeWorkstations = new Set(activeSessions.map((s) => s.clientIp));
        if (!activeWorkstations.has(clientIp) && activeWorkstations.size >= targetSeatLimit) {
          return {
            allowed: false as const,
            code: "CONCURRENCY_LIMIT_REACHED",
            status: 403,
            message: `Target company is licensed for ${targetSeatLimit} concurrent workstation${targetSeatLimit > 1 ? 's' : ''} (1 Server + ${targetSeatLimit - 1} Client${targetSeatLimit - 1 > 1 ? 's' : ''}). All ${targetSeatLimit} workstation slots are currently occupied. Please terminate an idle workstation session or expand seats in Key Generator or upgrade to Enterprise for unlimited concurrent workstations.`
          };
        }
      }

      // Create fresh target company session
      const newSessionId = generateSessionId();
      const newHashedSessionId = hashToken(newSessionId);

      await db.insert(sessions).values({
        id: newHashedSessionId,
        userId: targetUser.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      try {
        await db.insert(lanServerSessions).values({
          id: newHashedSessionId,
          companyId: targetCompanyId,
          userId: targetUser.id,
          clientIp,
          lastActiveAt: new Date(),
          isMaintenanceMode: false,
        });
      } catch {}

      await AuditService.log({
        req,
        userId: targetUser.id,
        userEmail: targetUser.email,
        userDisplayName: targetUser.displayName,
        companyId: targetCompanyId,
        action: "COMPANY_SWITCH_IN",
        entityType: "AUTHENTICATION",
        entityId: targetCompanyId,
        result: "SUCCESS",
        module: "AUTH",
        source: "WEB_UI",
        metadata: { fromCompanyId: sourceCompanyId, toCompanyId: targetCompanyId },
      });



      return {
        allowed: true as const,
        token: `${targetCompanyId}.${newSessionId}`,
        user: {
          id: targetUser.id,
          email: targetUser.email,
          displayName: targetUser.displayName,
          theme: targetUser.theme || 'light',
          requirePasswordChange: targetUser.requirePasswordChange,
        },
        activeCompany: targetComp
          ? {
              id: targetComp.id,
              legalName: targetComp.legalName,
              tradeName: targetComp.tradeName,
              tin: targetComp.tin,
              vatStatus: targetComp.vatStatus || 'VAT',
              taxpayerClassification: targetComp.taxpayerClassification || 'CORPORATION',
              taxpayerType: targetComp.taxpayerType || targetComp.taxpayerClassification || 'CORPORATION',
              rdoCode: targetComp.rdoCode,
              planType: (targetLic?.planType || 'PRO') as 'PRO' | 'ENTERPRISE',
              isLifetime: Boolean(targetLic?.isLifetime),
              roleId: targetMembership.roleId,
              roleCode: roleRecord?.code || null,
              roleName: roleRecord?.name || normRole,
              role: resolved.primaryRole,
              roles: resolved.assignedRoles,
              assignedModules: resolved.effectiveModuleIds,
              assignedModuleIds: resolved.effectiveModuleIds,
              effectiveModuleIds: resolved.effectiveModuleIds,
              assignedSubmodules: resolved.effectiveSubmodulesMap,
              assignedSubmoduleIds: resolved.effectiveSubmodulesMap,
              roleTemplateVersion: resolved.roleTemplateVersion,
              defaultDataScope: resolved.defaultDataScope,
              approvalLimitCentavos: resolved.defaultApprovalLimitCentavos,
            }
          : null,
        permissions: resolved.effectivePermissions,
      };
    });

    if (!targetResult.allowed) {
      if ((targetResult as any).requiresReauth) {
        res.status(targetResult.status).json({
          switched: false,
          requiresReauth: true,
          companyId: targetCompanyId,
          error: targetResult.code,
          message: targetResult.message,
        });
        return;
      }
      res.status(targetResult.status).json({
        switched: false,
        error: targetResult.code,
        message: targetResult.message,
      });
      return;
    }

    // Revoke caller's old session in source company DB & record audit trail (WITHOUT closing source DB handle!)
    try {
      await db.delete(sessions).where(eq(sessions.id, oldSessionId));
      await db.delete(lanServerSessions).where(eq(lanServerSessions.id, oldSessionId)).catch(() => {});
      await AuditService.log({
        req,
        userId: req.user!.id,
        userEmail: req.user!.email,
        userDisplayName: req.user!.displayName,
        companyId: sourceCompanyId,
        action: "COMPANY_SWITCH_OUT",
        entityType: "AUTHENTICATION",
        entityId: targetCompanyId,
        result: "SUCCESS",
        module: "AUTH",
        source: "WEB_UI",
        metadata: { fromCompanyId: sourceCompanyId, toCompanyId: targetCompanyId },
      });
    } catch {}

    // Update target company lastOpenedAt timestamp
    const openedAtIso = new Date().toISOString();
    await CompanyManager.updateCompanyManifest(targetCompanyId, { lastOpenedAt: openedAtIso }).catch(() => {});

    res.cookie("token", targetResult.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" && req.secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 1000,
    });

    res.json({
      switched: true,
      message: `Switched workspace to ${targetResult.activeCompany?.legalName || targetCompanyId}`,
      token: targetResult.token,
      user: targetResult.user,
      activeCompany: targetResult.activeCompany,
      permissions: targetResult.permissions,
    });
  } catch (err: any) {
    console.error("[Auth] Company switch failed:", err);
    res.status(500).json({ error: "COMPANY_SWITCH_FAILED", message: err?.message || "Failed to switch company workspace." });
  }
});

router.post("/logout-all", requireAuth, async (req, res) => {
  if (req.user) {
    await db.delete(sessions).where(eq(sessions.userId, req.user.id));
    await db.delete(lanServerSessions).where(eq(lanServerSessions.userId, req.user.id)).catch(() => {});
    
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
    let lic: any = null;
    try {
      lic = db.select().from(companyLicenses).where(eq(companyLicenses.companyId, req.activeCompany.id)).get();
    } catch {}
    activeCompanyObj = {
      id: req.activeCompany.id,
      legalName: comp?.legalName || "Active Company",
      tradeName: comp?.tradeName,
      tin: comp?.tin,
      vatStatus: comp?.vatStatus || 'VAT',
      taxpayerClassification: comp?.taxpayerClassification || 'CORPORATION',
      taxpayerType: comp?.taxpayerType || comp?.taxpayerClassification || 'CORPORATION',
      rdoCode: comp?.rdoCode,
      planType: (lic?.planType || 'PRO') as 'PRO' | 'ENTERPRISE',
      isLifetime: Boolean(lic?.isLifetime),
      roleId: req.activeCompany.roleId,
      roleCode: req.activeCompany.roleCode,
      roleName: req.activeCompany.roleName || req.activeCompany.role,
      role: req.activeCompany.role,
      roles: req.activeCompany.roles || [req.activeCompany.role],
      assignedModules: req.activeCompany.assignedModules || null,
      assignedModuleIds: req.activeCompany.assignedModules || null,
      effectiveModuleIds: req.activeCompany.assignedModules || null,
      assignedSubmodules: req.activeCompany.assignedSubmodules || null,
      roleTemplateVersion: req.activeCompany.roleTemplateVersion || 1,
      defaultDataScope: req.activeCompany.defaultDataScope || 'COMPANY_WIDE',
      approvalLimitCentavos: req.activeCompany.approvalLimitCentavos ?? 0
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
