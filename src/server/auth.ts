import { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { users, companyUsers, companies, roles, rolePermissions, permissions, sessions, companyLicenses, userModuleAssignments, lanServerSessions } from "./db/schema";
import { eq, and } from "drizzle-orm";
import { CompanyManager } from "./services/companyManager";
import { RbacService } from "./services/rbacService";
import { dbContext } from "./db/context";
import crypto from "crypto";
import { verifyLicense } from "./licensing/verify";
import { AntiRollbackService } from "./services/antiRollbackService";
import { isLicenseExemptPath, isPasswordChangeAllowedPath, isSegmentPrefixMatch, normalizeRequestPath } from "./utils/requestPath";

export async function validateActiveLicenseForCompany(companyId: string): Promise<{ valid: boolean; code: 'LICENSE_REQUIRED' | 'LICENSE_EXPIRED' | 'LICENSE_INVALID' | 'LICENSE_REVOKED' | 'TAMPERED' | 'OK'; message?: string }> {
  try {
    const targetDb = dbContext.getStore() || (await CompanyManager.getCompanyDb(companyId));
    if (!targetDb) {
      return { valid: false, code: 'LICENSE_REQUIRED', message: "No database found for this company context." };
    }

    const license = await targetDb.select().from(companyLicenses).where(eq(companyLicenses.companyId, companyId)).get();
    
    if (!license) {
      try {
        const nowTime = new Date();
        const trialStartDate = nowTime.toISOString().slice(0, 10);
        const trialEndDate = new Date(nowTime.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const newLic = {
          id: crypto.randomUUID(),
          companyId,
          licenseKey: `LIC-TRIAL-${companyId.slice(0, 8).toUpperCase()}`,
          planType: "TRIAL" as const,
          status: "ACTIVE" as const,
          trialStartDate: trialStartDate,
          expirationDate: trialEndDate,
          signedFileContent: JSON.stringify({ companyId, plan: "TRIAL", active: true, trialStartDate, expirationDate: trialEndDate }),
          isLifetime: false
        };
        await targetDb.insert(companyLicenses).values(newLic);
        return { valid: true, code: 'OK' };
      } catch (licErr: any) {
        return { valid: false, code: 'LICENSE_REQUIRED', message: "No license found for this company context. Please activate a valid license." };
      }
    }

    if (license.status === 'REVOKED') {
      return { valid: false, code: 'LICENSE_REVOKED', message: "This company license has been revoked." };
    }

    if (license.status === 'TAMPERED') {
      return { 
        valid: false, 
        code: 'TAMPERED', 
        message: "This company license is locked in a TAMPERED state due to detected system clock rollback or file tampering." 
      };
    }

    // Anti-Rollback clock verification & timestamp discrepancy check
    const clockCheck = await AntiRollbackService.verifyClock(companyId);
    if (!clockCheck.valid) {
      // Force license into TAMPERED state in the database
      try {
        await targetDb.update(companyLicenses)
          .set({ status: 'TAMPERED', updatedAt: new Date() })
          .where(eq(companyLicenses.companyId, companyId));
      } catch (dbErr) {
        console.error("[Auth] Failed to lock license into TAMPERED state:", dbErr);
      }

      return { 
        valid: false, 
        code: 'TAMPERED', 
        message: clockCheck.message || "Unauthorized system clock rollback or timestamp discrepancy detected. License is locked in TAMPERED state." 
      };
    }

    // Cryptographic validation of signed file content if present and not raw TRIAL
    if (license.signedFileContent && license.planType !== 'TRIAL' && !license.licenseKey.startsWith('LEDGERAI-TRIAL-') && !license.licenseKey.startsWith('LIC-TRIAL-')) {
      try {
        const parsed = JSON.parse(license.signedFileContent);
        if (parsed && parsed.payload && parsed.signature) {
          const isValid = verifyLicense(parsed.payload, parsed.signature);
          if (!isValid) {
            return { valid: false, code: 'LICENSE_INVALID', message: "Cryptographic validation failed. The license file is invalid or tampered." };
          }
          if (parsed.payload.companyId !== companyId) {
            return { valid: false, code: 'LICENSE_INVALID', message: "License is bound to a different company ID." };
          }
        } else {
          return { valid: false, code: 'LICENSE_INVALID', message: "Invalid license file structure." };
        }
      } catch (e) {
        return { valid: false, code: 'LICENSE_INVALID', message: "Failed to parse license file signature." };
      }
    }

    // Check expiration date against effective monotonic time (highest known watermark)
    // Authoritative lifecycle: 15-day initial trial + 15-day grace period remaining before full lock
    const effectiveNow = Math.max(Date.now(), clockCheck.lastKnownTime);
    if (!license.isLifetime && license.expirationDate && license.expirationDate !== 'LIFETIME') {
      const expTime = new Date(license.expirationDate).getTime();
      const gracePeriodMs = 15 * 24 * 60 * 60 * 1000; // 15-Day Grace Period
      const graceEndTime = expTime + gracePeriodMs;

      if (effectiveNow > graceEndTime) {
        return { 
          valid: false, 
          code: 'LICENSE_EXPIRED', 
          message: "The 15-day trial and 15-day grace period have expired. Please activate your company license to continue." 
        };
      }
    }

    if (license.status !== 'ACTIVE') {
      return { valid: false, code: 'LICENSE_INVALID', message: `License status is ${license.status}.` };
    }

    // Advance monotonic progress timestamp if confirmed valid
    await AntiRollbackService.advanceTimeIfValid(companyId);

    return { valid: true, code: 'OK' };
  } catch (err: any) {
    return { valid: false, code: 'LICENSE_INVALID', message: `License validation error: ${err.message}` };
  }
}

export const enforcePasswordChangeGuard = async (req: Request, res: Response, next: NextFunction) => {
  const normPath = normalizeRequestPath(req.originalUrl);
  if (
    isPasswordChangeAllowedPath(req.originalUrl) ||
    isSegmentPrefixMatch(normPath, '/api/auth/login') ||
    normPath === '/api/health'
  ) {
    return next();
  }

  let token = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/token=([^;]+)/);
    if (match) token = match[1];
  }
  if (!token || !req.activeCompany) {
    return next();
  }

  const parsed = parseToken(token);
  if (!parsed) {
    return next();
  }

  try {
    const storeDb = dbContext.getStore();
    if (!storeDb) return next();
    const hashedSessionId = hashToken(parsed.sessionId);
    const session = await db.select().from(sessions).where(eq(sessions.id, hashedSessionId)).get();
    if (!session || new Date(session.expiresAt) < new Date()) {
      return next();
    }
    const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
    if (user && user.status === "ACTIVE" && user.requirePasswordChange) {
      res.status(403).json({
        error: "PASSWORD_CHANGE_REQUIRED",
        message: "You must change your password before proceeding."
      });
      return;
    }
  } catch {
    // Let downstream requireAuth handle malformed context
  }
  return next();
};

export const requireValidLicense = async (req: Request, res: Response, next: NextFunction) => {
  // Only protect state-changing mutation methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Exempt auth, health, restore, licensing, company registration (canonical normalized path)
  if (isLicenseExemptPath(req.originalUrl)) {
    return next();
  }

  if (!req.activeCompany) {
    return next();
  }

  const result = await validateActiveLicenseForCompany(req.activeCompany.id);
  if (!result.valid) {
    res.status(403).json({
      error: result.code,
      message: result.message
    });
    return;
  }

  next();
};

export type LedgerRole =
  | 'Company Owner'
  | 'Company Administrator'
  | 'Accountant'
  | 'Bookkeeper'
  | 'Auditor'
  | 'Reviewer'
  | 'Approver'
  | 'Tax & AP Specialist'
  | 'Read-only User';

export const ROLE_HIERARCHY: Record<LedgerRole, number> = {
  'Company Owner': 90,
  'Company Administrator': 80,
  'Approver': 70,
  'Reviewer': 60,
  'Accountant': 50,
  'Tax & AP Specialist': 45,
  'Bookkeeper': 40,
  'Auditor': 30,
  'Read-only User': 10,
};

export function normalizeRole(roleCodeOrName?: string | null): LedgerRole {
  if (!roleCodeOrName) return 'Read-only User';
  const clean = roleCodeOrName.trim().toUpperCase();
  
  if (clean.includes('SUPER') || clean.includes('OWNER')) return 'Company Owner';
  if (clean.includes('ADMIN')) return 'Company Administrator';
  if (clean.includes('TAX') || clean.includes('AP_SPECIALIST') || clean.includes('PAYABLES')) return 'Tax & AP Specialist';
  if (clean.includes('ACCOUNTANT') || clean.includes('EDITOR') || clean.includes('FINANCE')) return 'Accountant';
  if (clean.includes('BOOKKEEPER')) return 'Bookkeeper';
  if (clean.includes('AUDITOR')) return 'Auditor';
  if (clean.includes('REVIEWER')) return 'Reviewer';
  if (clean.includes('APPROVER')) return 'Approver';
  
  return 'Read-only User';
}

export function parseToken(token: string) {
  const parts = token.split('.');
  if (parts.length === 2) return { companyId: parts[0], sessionId: parts[1] };
  return null;
}

export function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface AuthenticatedWsSession {
  userId: string;
  companyId: string;
  role: LedgerRole;
  email: string;
}

export async function authenticateSessionToken(token: string): Promise<AuthenticatedWsSession | null> {
  if (!token) return null;
  let decodedToken = token;
  try {
    decodedToken = decodeURIComponent(token);
  } catch {
    decodedToken = token;
  }
  const parsed = parseToken(decodedToken);
  if (!parsed) return null;

  const { companyId, sessionId } = parsed;
  const hashedSessionId = hashToken(sessionId);

  try {
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    if (!manifest) return null;

    const companyDb = await CompanyManager.getCompanyDb(companyId);
    return await dbContext.run(companyDb, async () => {
      const session = await db.select().from(sessions).where(eq(sessions.id, hashedSessionId)).get();
      if (!session || new Date(session.expiresAt) < new Date()) return null;

      const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
      if (!user || user.status !== 'ACTIVE') return null;
      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) return null;

      const membership = await db
        .select()
        .from(companyUsers)
        .where(and(eq(companyUsers.userId, user.id), eq(companyUsers.companyId, companyId)))
        .get();

      if (membership) {
        const memStatus = (membership as any).membershipStatus || membership.status || 'ACTIVE';
        if (memStatus === 'REMOVED' || memStatus === 'SUSPENDED' || membership.status !== 'ACTIVE') {
          return null;
        }
        const resolved = await RbacService.resolveEffectiveAccess(membership.id);
        if (!resolved.effectiveAccountActive) return null;
        return {
          userId: user.id,
          companyId: membership.companyId,
          role: resolved.primaryRole,
          email: user.email,
        };
      }

      const isOwner = user.role === 'OWNER' || user.role === 'COMPANY_OWNER';
      if (!isOwner) return null;

      return {
        userId: user.id,
        companyId,
        role: 'Company Owner' as LedgerRole,
        email: user.email,
      };
    });
  } catch {
    return null;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        displayName?: string;
        theme?: string;
      };
      activeCompany?: {
        id: string;
        membershipId: string;
        roleId: string | null;
        roleCode: string | null;
        roleName: string | null;
        role: LedgerRole;
        roles: LedgerRole[];
        status: string;
        assignedModules?: string[] | null;
        assignedSubmodules?: Record<string, string[]> | null;
        roleTemplateVersion?: number;
        defaultDataScope?: string;
        approvalLimitCentavos?: number;
      };
      permissions?: string[];
      deniedPermissions?: string[];
      hardDeniedPermissions?: string[];
      sessionId?: string;
    }
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  let token = req.cookies?.token || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : null);
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) {
    res.status(401).json({ error: "AUTH_REQUIRED", message: "Authentication required" });
    return;
  }

  const parsed = parseToken(token);
  if (!parsed) {
    res.status(401).json({ error: "SESSION_EXPIRED", message: "Invalid or expired token" });
    return;
  }

  const { companyId, sessionId } = parsed;
  const hashedSessionId = hashToken(sessionId);

  try {
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    if (!manifest) {
      res.clearCookie("token");
      res.status(401).json({ error: "SESSION_EXPIRED", message: "Company not found or session expired" });
      return;
    }

    const companyDb = await CompanyManager.getCompanyDb(companyId);

    const executeAuthCheck = async () => {
      const session = await db.select().from(sessions).where(eq(sessions.id, hashedSessionId)).get();
      if (!session || new Date(session.expiresAt) < new Date()) {
        res.status(401).json({ error: "SESSION_EXPIRED", message: "Invalid or expired session" });
        return false;
      }

      const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
      if (!user || user.status !== "ACTIVE") {
        res.status(401).json({ error: "AUTH_REQUIRED", message: "User not found or disabled" });
        return false;
      }

      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        res.status(401).json({ error: "ACCOUNT_LOCKED", message: "Account is temporarily locked" });
        return false;
      }

      if (user.requirePasswordChange) {
        if (!isPasswordChangeAllowedPath(req.originalUrl)) {
          res.status(403).json({ error: "PASSWORD_CHANGE_REQUIRED", message: "You must change your password before proceeding." });
          return false;
        }
      }

      // Update session activity for sliding expiration
      const newExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      await db.update(sessions).set({ expiresAt: newExpiresAt }).where(eq(sessions.id, session.id));
      await db.update(lanServerSessions).set({ lastActiveAt: new Date() }).where(eq(lanServerSessions.id, session.id)).catch(() => {});

      req.user = {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        theme: user.theme || 'light',
      };
      req.sessionId = hashedSessionId;

      const membership = await db
        .select()
        .from(companyUsers)
        .where(
          and(
            eq(companyUsers.userId, user.id),
            eq(companyUsers.companyId, companyId)
          )
        )
        .get();

      if (membership) {
        const memStatus = (membership as any).membershipStatus || membership.status || 'ACTIVE';
        if (memStatus === 'REMOVED' || membership.status === 'REMOVED') {
          res.status(403).json({
            error: "MEMBERSHIP_REMOVED",
            message: "Your membership in this company has been revoked."
          });
          return false;
        }

        if (membership.status !== "ACTIVE" || memStatus === 'SUSPENDED') {
          res.status(403).json({
            error: "ACCOUNT_DISABLED",
            message: "Your user account or company membership is currently disabled."
          });
          return false;
        }

        const { roleRecords } = await RbacService.getMemberRoles(membership.id);
        const resolved = await RbacService.resolveEffectiveAccess(membership.id);

        if (!resolved.effectiveAccountActive) {
          res.status(403).json({
            error: resolved.membershipStatus === 'REMOVED' ? "MEMBERSHIP_REMOVED" : "ACCOUNT_DISABLED",
            message: resolved.membershipStatus === 'REMOVED'
              ? "Your membership in this company has been revoked."
              : "Your user account or company membership is currently disabled."
          });
          return false;
        }

        req.activeCompany = {
          id: membership.companyId,
          membershipId: membership.id,
          roleId: membership.roleId,
          roleCode: roleRecords[0]?.code || null,
          roleName: roleRecords[0]?.name || resolved.primaryRole,
          role: resolved.primaryRole,
          roles: resolved.roles,
          status: manifest.status || "ACTIVE",
          assignedModules: resolved.effectiveModuleIds,
          assignedSubmodules: resolved.effectiveSubmodulesMap,
          roleTemplateVersion: resolved.roleTemplateVersion,
          defaultDataScope: resolved.defaultDataScope,
          approvalLimitCentavos: resolved.defaultApprovalLimitCentavos
        };

        req.permissions = resolved.effectivePermissions;
        req.deniedPermissions = resolved.userSpecificDenials || [];
        req.hardDeniedPermissions = resolved.hardDeniedPermissions || [];
      } else {
        // Fallback strictly for explicit COMPANY_OWNER/OWNER user records without a companyUsers row
        const isOwner = user.role === 'OWNER' || user.role === 'COMPANY_OWNER';
        if (isOwner) {
          req.activeCompany = {
            id: companyId,
            membershipId: 'owner-auto-assigned',
            roleId: 'role-company-owner',
            roleCode: 'COMPANY_OWNER',
            roleName: 'Company Owner',
            role: 'Company Owner',
            roles: ['Company Owner'],
            status: manifest.status || 'ACTIVE',
          };
          req.permissions = ['*'];
        } else {
          res.status(403).json({
            error: 'MEMBERSHIP_INACTIVE',
            message: 'Your account does not have active membership in this company.'
          });
          return false;
        }
      }

      if (req.activeCompany?.status === "RECOVERY_READ_ONLY" && req.method !== "GET") {
        res.status(403).json({
          error: "READ_ONLY_ACCESS",
          message: "Company database is in read-only recovery mode. Mutations are blocked."
        });
        return false;
      }

      return true;
    };

    let proceed = false;
    if (dbContext.getStore()) {
      proceed = await executeAuthCheck();
    } else {
      await dbContext.run(companyDb, async () => {
        proceed = await executeAuthCheck();
      });
    }

    if (proceed) {
      next();
    }
  } catch (error: any) {
    res.clearCookie("token");
    res.status(401).json({ error: "AUTH_REQUIRED", message: error?.message || "Company not found or invalid session" });
    return;
  }
};

export const requireUserAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];
  if (!token) {
    res.status(401).json({ error: "AUTH_REQUIRED", message: "Authentication required" });
    return;
  }

  const parsed = parseToken(token);
  if (!parsed) {
    res.status(401).json({ error: "SESSION_EXPIRED", message: "Invalid or expired token" });
    return;
  }

  const { sessionId } = parsed;
  const hashedSessionId = hashToken(sessionId);

  try {
    const session = await db.select().from(sessions).where(eq(sessions.id, hashedSessionId)).get();
    if (!session || new Date(session.expiresAt) < new Date()) {
      res.status(401).json({ error: "SESSION_EXPIRED", message: "Invalid or expired session" });
      return;
    }

    const user = await db.select().from(users).where(eq(users.id, session.userId)).get();
    if (!user || user.status !== "ACTIVE") {
      res.status(401).json({ error: "AUTH_REQUIRED", message: "User not found or disabled" });
      return;
    }

    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      res.status(401).json({ error: "ACCOUNT_LOCKED", message: "Account is temporarily locked" });
      return;
    }

    if (user.requirePasswordChange) {
      if (!isPasswordChangeAllowedPath(req.originalUrl)) {
        res.status(403).json({ error: "PASSWORD_CHANGE_REQUIRED", message: "You must change your password before proceeding." });
        return;
      }
    }

    // Update session activity for sliding expiration
    const newExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    await db.update(sessions).set({ expiresAt: newExpiresAt }).where(eq(sessions.id, session.id));

    req.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      theme: user.theme || 'light',
    };
    req.sessionId = hashedSessionId;

    next();
  } catch (error) {
    res.status(401).json({ error: "AUTH_REQUIRED", message: "Invalid session" });
    return;
  }
};


export const requireCompanyAccess = (req: Request, res: Response, next: NextFunction) => {
  if (!req.activeCompany) {
    res.status(403).json({ error: "COMPANY_ACCESS_DENIED", message: "Active company context required" });
    return;
  }
  next();
};

export const requireRole = (...allowedRoles: LedgerRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.activeCompany) {
      res.status(403).json({ error: "COMPANY_ACCESS_DENIED", message: "Active company context required" });
      return;
    }
    const userRoles = req.activeCompany.roles || [req.activeCompany.role];
    const hasRole = userRoles.some(r => allowedRoles.includes(r));
    if (!hasRole) {
      res.status(403).json({ 
        error: "PERMISSION_DENIED", 
        message: `Requires one of the following roles: ${allowedRoles.join(', ')}. Current roles: ${userRoles.join(', ')}` 
      });
      return;
    }
    next();
  };
};

export const requireMinRole = (minRole: LedgerRole) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.activeCompany) {
      res.status(403).json({ error: "COMPANY_ACCESS_DENIED", message: "Active company context required" });
      return;
    }

    const userRoles = req.activeCompany.roles || [req.activeCompany.role];
    const maxUserLevel = Math.max(...userRoles.map(r => ROLE_HIERARCHY[r] || 10));
    const requiredLevel = ROLE_HIERARCHY[minRole] || 10;

    if (maxUserLevel < requiredLevel) {
      res.status(403).json({ 
        error: "PERMISSION_DENIED", 
        message: `Minimum required role level is ${minRole}. Current assigned roles '${userRoles.join(', ')}' are insufficient.` 
      });
      return;
    }
    next();
  };
};

export function isApproverRole(req: Request): boolean {
  if (!req.activeCompany) return false;
  const userRoles = req.activeCompany.roles || [req.activeCompany.role];
  // Active Company Owner always holds unrestricted company-level approval authority
  if (userRoles.some(r => r === 'Company Owner' || normalizeRole(r) === 'Company Owner')) {
    return true;
  }
  const hardDenies = new Set((req.hardDeniedPermissions || []).map(p => p.toLowerCase()));
  const softDenies = new Set((req.deniedPermissions || []).map(p => p.toLowerCase()));
  if (hardDenies.has('approvals:approve') || softDenies.has('approvals:approve')) {
    return false;
  }
  const perms = req.permissions || [];
  return perms.includes('*') || perms.some(p => {
    const pLower = p.toLowerCase();
    if (hardDenies.has(pLower) || softDenies.has(pLower)) return false;
    return pLower.endsWith(':approve') || pLower === 'approvals:approve';
  });
}

export function isPostingRole(req: Request): boolean {
  if (!req.activeCompany) return false;
  const userRoles = req.activeCompany.roles || [req.activeCompany.role];
  // Active Company Owner always holds unrestricted company-level GL posting authority
  if (userRoles.some(r => r === 'Company Owner' || normalizeRole(r) === 'Company Owner')) {
    return true;
  }
  const hardDenies = new Set((req.hardDeniedPermissions || []).map(p => p.toLowerCase()));
  const softDenies = new Set((req.deniedPermissions || []).map(p => p.toLowerCase()));
  if (hardDenies.has('accounting:post') || softDenies.has('accounting:post')) {
    return false;
  }
  const perms = req.permissions || [];
  return perms.includes('*') || perms.some(p => {
    const pLower = p.toLowerCase();
    if (hardDenies.has(pLower) || softDenies.has(pLower)) return false;
    return pLower.endsWith(':post') || p === 'ACCOUNTING_POST';
  });
}

export const requirePostingRole = (req: Request, res: Response, next: NextFunction) => {
  if (!req.activeCompany) {
    res.status(403).json({ error: "COMPANY_ACCESS_DENIED", message: "Active company context required" });
    return;
  }
  if (!isPostingRole(req)) {
    res.status(403).json({ 
      error: "PERMISSION_DENIED", 
      message: `Assigned roles '${req.activeCompany.roles.join(', ')}' do not have posting authority.` 
    });
    return;
  }
  next();
};

export const requireApprovalRole = (req: Request, res: Response, next: NextFunction) => {
  if (!req.activeCompany) {
    res.status(403).json({ error: "COMPANY_ACCESS_DENIED", message: "Active company context required" });
    return;
  }
  if (!isApproverRole(req)) {
    res.status(403).json({ 
      error: "PERMISSION_DENIED", 
      message: `Assigned roles '${req.activeCompany.roles.join(', ')}' do not have approval authority.` 
    });
    return;
  }
  next();
};

export const requireWriteAccess = (req: Request, res: Response, next: NextFunction) => {
  if (!req.activeCompany) {
    res.status(403).json({ error: "COMPANY_ACCESS_DENIED", message: "Active company context required" });
    return;
  }
  
  if (req.activeCompany.status === "RECOVERY_READ_ONLY") {
    res.status(403).json({ 
      error: "READ_ONLY_ACCESS", 
      message: "Company database is in read-only recovery mode due to integrity or migration issues." 
    });
    return;
  }

  const userRoles = req.activeCompany.roles || [req.activeCompany.role];
  const readOnlyOnly = userRoles.every(r => ['Read-only User', 'Auditor', 'Reviewer', 'Approver'].includes(r));
  if (readOnlyOnly) {
    res.status(403).json({ 
      error: "READ_ONLY_ACCESS", 
      message: "This role assignment has read-only, review, or approval authority and cannot perform write or create operations." 
    });
    return;
  }
  next();
};

export const requirePermission = (...permissionCodes: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.activeCompany) {
      res.status(403).json({ error: "COMPANY_ACCESS_DENIED", message: "Active company context required" });
      return;
    }
    const userRoles = req.activeCompany.roles || [req.activeCompany.role];
    const isCompanyOwner = userRoles.some(r => r === 'Company Owner' || normalizeRole(r) === 'Company Owner');
    if (isCompanyOwner) {
      return next();
    }
    const perms = req.permissions || [];
    const denied = new Set((req.deniedPermissions || []).map(p => p.toLowerCase()));
    if (denied.size > 0) {
      const allRequestedExplicitlyDenied = permissionCodes.every(code => denied.has(code.toLowerCase()));
      if (allRequestedExplicitlyDenied) {
        res.status(403).json({
          error: "PERMISSION_DENIED",
          message: `Access explicitly denied by RBAC override for: ${permissionCodes.join(', ')}`
        });
        return;
      }
    }
    if (!RbacService.hasPermission(perms, ...permissionCodes)) {
      res.status(403).json({ error: "PERMISSION_DENIED", message: `Permission required: ${permissionCodes.join(' or ')}` });
      return;
    }
    next();
  };
};

export const requirePlanEntitlement = (minPlan: 'PRO' | 'ENTERPRISE') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.activeCompany) {
      res.status(403).json({ error: "COMPANY_ACCESS_DENIED", message: "Active company context required" });
      return;
    }
    
    const license = await db.select().from(companyLicenses).where(eq(companyLicenses.companyId, req.activeCompany.id)).get();
    
    if (!license) {
       res.status(403).json({ error: "LICENSE_REQUIRED", message: "No license found" });
       return;
    }

    const planLevel = (p: string) => p === 'ENTERPRISE' ? 2 : 1;
    if (planLevel(license.planType) < planLevel(minPlan)) {
      res.status(403).json({ error: "PLAN_ENTITLEMENT_REQUIRED", message: `Requires ${minPlan} plan.` });
      return;
    }
    
    next();
  };
};

export const getActiveCompanyId = (req: Request) => {
  if (!req.activeCompany) throw new Error("No active company context");
  return req.activeCompany.id;
};
