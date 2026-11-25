import { Router, Request, Response } from "express";
import { RestoreService, BackupPayload } from "../services/restoreService";
import { requireAuth, requirePermission } from "../auth";
import { verifyBackupRestoreCredentials, VerifiedBackupActor } from "../services/backupRestoreAuth";
import { AuditService } from "../services/auditService";
import { CompanyManager } from "../services/companyManager";
import { dbContext } from "../db/context";
import fs from 'fs/promises';
import path from 'path';

import { paths } from "../services/paths";

const router = Router();

function hasRequestSessionToken(req: Request): boolean {
  if (req.cookies?.token) return true;
  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) return true;
  if (req.headers.cookie && /token=([^;]+)/.test(req.headers.cookie)) return true;
  return false;
}

function hasBackupAuthPayload(body: any): boolean {
  const ba = body?.backupAuth;
  return Boolean(
    ba &&
    typeof ba === 'object' &&
    typeof ba.email === 'string' &&
    ba.email.trim().length > 0 &&
    typeof ba.password === 'string' &&
    ba.password.length > 0
  );
}

async function runMiddleware(
  mw: (req: Request, res: Response, next: (err?: any) => void) => any,
  req: Request,
  res: Response
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    let calledNext = false;
    const next = (err?: any) => {
      if (err) return reject(err);
      calledNext = true;
      resolve(true);
    };
    Promise.resolve(mw(req, res, next))
      .then(() => {
        if (!calledNext) {
          resolve(false);
        }
      })
      .catch(reject);
  });
}

async function enforceWorkspaceRestoreAuth(req: Request, res: Response): Promise<boolean> {
  const authed = await runMiddleware(requireAuth, req, res);
  if (!authed || res.headersSent) return false;
  const permitted = await runMiddleware(requirePermission('backup:restore'), req, res);
  if (!permitted || res.headersSent) return false;
  return true;
}

function classifyBackupErrorCode(msg: string): string {
  return msg.startsWith('WORKSPACE_DB_NOT_BACKUP') ? 'WORKSPACE_DB_NOT_BACKUP' :
    msg.startsWith('CROSS_TENANT_CONTAMINATION') ? 'CROSS_TENANT_CONTAMINATION' :
    msg.startsWith('CORRUPTED_PACKAGE') ? 'CORRUPTED_PACKAGE' :
    msg.startsWith('TAMPER_DETECTED') ? 'TAMPER_DETECTED' :
    msg.startsWith('CHECKSUM_MISMATCH') ? 'CHECKSUM_MISMATCH' :
    msg.startsWith('BACKUP_VERSION_INCOMPATIBLE') ? 'BACKUP_VERSION_INCOMPATIBLE' :
    msg.startsWith('INVALID_BACKUP_STRUCTURE') ? 'INVALID_BACKUP_STRUCTURE' :
    msg.startsWith('INVALID_BACKUP_FORMAT') ? 'INVALID_BACKUP_FORMAT' :
    'INVALID_BACKUP';
}

function buildScopeSummary(payload: BackupPayload) {
  const accountingPeriods = payload.data.accountingPeriods || [];
  const journalEntries = payload.data.journalEntries || [];
  const documents = payload.data.documents || [];
  return {
    fiscalYearRange: accountingPeriods.length > 0
      ? `${new Date(accountingPeriods[0].startDate).getFullYear()} - ${new Date(accountingPeriods[accountingPeriods.length - 1].endDate).getFullYear()}`
      : 'N/A',
    journalEntryCount: journalEntries.length,
    journalCount: journalEntries.length,
    documentCount: documents.length,
  };
}

function validateSafeDestinationPath(destinationPath: unknown): { valid: boolean; message?: string } {
  if (destinationPath === undefined || destinationPath === null || String(destinationPath).trim() === '') {
    return { valid: true };
  }
  const raw = String(destinationPath).trim();
  // Reject explicit traversal segments or null bytes
  if (raw.includes('\0') || raw.split(/[\\/]/).some((seg) => seg === '..')) {
    return { valid: false, message: "Path traversal ('..') is not permitted in destinationPath." };
  }
  const companiesRoot = path.resolve(paths.getCompaniesRootDir());
  const resolvedDest = path.resolve(raw);
  const rel = path.relative(companiesRoot, resolvedDest);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      valid: false,
      message: `destinationPath must resolve inside the authorized LedgerAI companies root (${companiesRoot}).`
    };
  }
  return { valid: true };
}

router.get("/export", requireAuth, requirePermission('backups:download'), async (req, res) => {
  res.status(410).json({
    error: "ENDPOINT_DEPRECATED",
    message: "Direct .lai file export via HTTP download is disabled in production. Encrypted backups are automatically created and stored in the company backup directory."
  });
});

function validateSafeBackupFilePath(filePath: unknown): { valid: boolean; resolved?: string; message?: string } {
  if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
    return { valid: false, message: "backupFilePath is required." };
  }
  const raw = filePath.trim();
  if (raw.includes('\0') || raw.split(/[\\/]/).some((seg) => seg === '..')) {
    return { valid: false, message: "Path traversal ('..') is not permitted in backupFilePath." };
  }
  const companiesRoot = path.resolve(paths.getCompaniesRootDir());
  const resolved = path.resolve(raw);
  const rel = path.relative(companiesRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      valid: false,
      message: `backupFilePath must resolve inside the authorized LedgerAI companies root (${companiesRoot}).`
    };
  }
  return { valid: true, resolved };
}

router.post("/validate", async (req, res) => {
  try {
    const useColdBackupAuth = hasBackupAuthPayload(req.body);
    if (!useColdBackupAuth) {
      const ok = await enforceWorkspaceRestoreAuth(req, res);
      if (!ok) return;
    }

    const { backupData, backupAuth } = req.body;
    if (!backupData) {
      res.status(400).json({ error: "BAD_REQUEST", message: "Missing backupData" });
      return;
    }
    const payload = RestoreService.deserializeLgb(backupData);

    let verifiedBackupUser: { displayName: string; email: string; role: string } | undefined;
    if (useColdBackupAuth) {
      const authResult = await verifyBackupRestoreCredentials(payload, backupAuth);
      if (!authResult.ok || !authResult.actor) {
        res.status(authResult.status || 401).json({
          error: authResult.errorCode || "BACKUP_AUTH_INVALID",
          message: authResult.message || "Backup credential verification failed.",
        });
        return;
      }
      verifiedBackupUser = {
        displayName: authResult.actor.displayName,
        email: authResult.actor.email,
        role: authResult.actor.primaryRole,
      };
    }

    const scopeSummary = buildScopeSummary(payload);
    res.json({
      success: true,
      metadata: payload.metadata,
      scopeSummary,
      authMode: useColdBackupAuth ? 'COLD_BACKUP_CREDENTIALS' : 'WORKSPACE_SESSION',
      verifiedBackupUser,
    });
  } catch (err: any) {
    console.error("Validation error:", err);
    const msg = String(err?.message || 'Validation failed');
    res.status(400).json({ error: classifyBackupErrorCode(msg), message: msg });
  }
});

router.post("/validate-path", async (req, res) => {
  try {
    const useColdBackupAuth = hasBackupAuthPayload(req.body);
    if (!useColdBackupAuth) {
      const ok = await enforceWorkspaceRestoreAuth(req, res);
      if (!ok) return;
    }

    const check = validateSafeBackupFilePath(req.body?.backupFilePath);
    if (!check.valid || !check.resolved) {
      res.status(400).json({ error: "PATH_TRAVERSAL_BLOCKED", message: check.message });
      return;
    }
    const buf = await fs.readFile(check.resolved);
    const payload = RestoreService.deserializeLai(buf);

    let verifiedBackupUser: { displayName: string; email: string; role: string } | undefined;
    if (useColdBackupAuth) {
      const authResult = await verifyBackupRestoreCredentials(payload, req.body?.backupAuth);
      if (!authResult.ok || !authResult.actor) {
        res.status(authResult.status || 401).json({
          error: authResult.errorCode || "BACKUP_AUTH_INVALID",
          message: authResult.message || "Backup credential verification failed.",
        });
        return;
      }
      verifiedBackupUser = {
        displayName: authResult.actor.displayName,
        email: authResult.actor.email,
        role: authResult.actor.primaryRole,
      };
    }

    const scopeSummary = buildScopeSummary(payload);
    res.json({
      success: true,
      backupFilePath: check.resolved.replace(/\\/g, '/'),
      metadata: payload.metadata,
      scopeSummary,
      authMode: useColdBackupAuth ? 'COLD_BACKUP_CREDENTIALS' : 'WORKSPACE_SESSION',
      verifiedBackupUser,
    });
  } catch (err: any) {
    const msg = String(err?.message || 'Backup path validation failed');
    res.status(400).json({ error: classifyBackupErrorCode(msg), message: msg });
  }
});

router.post("/", async (req, res) => {
  try {
    const { mode, backupData, backupFilePath, targetCompanyId, destinationPath, dedicatedSubfolderName, cloneAsNew, backupAuth } = req.body || {};

    // REPLACE mode ALWAYS requires an active signed-in workspace session matching the target company.
    // Cold Disaster-Recovery credentials (backupAuth) are strictly restricted to NEW workspace restores.
    const useColdBackupAuth = hasBackupAuthPayload(req.body) && mode !== 'REPLACE';
    if (mode === 'REPLACE' && !hasRequestSessionToken(req)) {
      res.status(403).json({
        error: "COMPANY_ACCESS_DENIED",
        message: "REPLACE mode requires an active signed-in session in the target company with backup:restore privileges. Cold backup credentials can only restore as a NEW company workspace."
      });
      return;
    }

    if (!useColdBackupAuth) {
      const ok = await enforceWorkspaceRestoreAuth(req, res);
      if (!ok) return;
    }

    if (!mode || (!backupData && !backupFilePath)) {
      res.status(400).json({ error: "BAD_REQUEST", message: "Missing mode or backup payload/path" });
      return;
    }

    if (mode !== 'NEW' && mode !== 'REPLACE') {
      res.status(400).json({ error: "BAD_REQUEST", message: "Invalid mode" });
      return;
    }

    let effectiveDestinationPath: string | undefined =
      typeof destinationPath === 'string' && destinationPath.trim() ? destinationPath.trim() : undefined;

    if (dedicatedSubfolderName && typeof dedicatedSubfolderName === 'string' && dedicatedSubfolderName.trim()) {
      const cleanSub = dedicatedSubfolderName
        .trim()
        .replace(/[\0\r\n]/g, '')
        .replace(/[\\/]/g, '')
        .replace(/[<>"|?*:]/g, '_');
      if (!cleanSub || cleanSub === '.' || cleanSub === '..') {
        res.status(400).json({ error: "INVALID_SUBFOLDER_NAME", message: "Dedicated subfolder name is invalid." });
        return;
      }
      const baseParent = effectiveDestinationPath || paths.getCompaniesRootDir();
      effectiveDestinationPath = path.join(baseParent, cleanSub);
    }

    const pathCheck = validateSafeDestinationPath(effectiveDestinationPath);
    if (!pathCheck.valid) {
      res.status(400).json({ error: "PATH_TRAVERSAL_BLOCKED", message: pathCheck.message });
      return;
    }

    let rawInput: Buffer | string = backupData;
    if (!rawInput && backupFilePath) {
      const bPathCheck = validateSafeBackupFilePath(backupFilePath);
      if (!bPathCheck.valid || !bPathCheck.resolved) {
        res.status(400).json({ error: "PATH_TRAVERSAL_BLOCKED", message: bPathCheck.message });
        return;
      }
      rawInput = await fs.readFile(bPathCheck.resolved);
    }

    let payload: BackupPayload;
    try {
      payload = RestoreService.deserializeLgb(rawInput);
    } catch (e: any) {
      const msg = String(e?.message || 'Invalid backup');
      res.status(400).json({ error: classifyBackupErrorCode(msg), message: msg });
      return;
    }

    if (!RestoreService.verifyChecksum(payload)) {
      res.status(400).json({ error: "CHECKSUM_MISMATCH", message: "Backup checksum verification failed" });
      return;
    }

    let actorUserId: string | null = null;
    let verifiedActor: VerifiedBackupActor | null = null;

    if (useColdBackupAuth) {
      const authResult = await verifyBackupRestoreCredentials(payload, backupAuth);
      if (!authResult.ok || !authResult.actor) {
        res.status(authResult.status || 401).json({
          error: authResult.errorCode || "BACKUP_AUTH_INVALID",
          message: authResult.message || "Backup credential verification failed.",
        });
        return;
      }
      verifiedActor = authResult.actor;
      actorUserId = verifiedActor.userId;
    } else {
      actorUserId = req.user!.id;
      if (mode === 'REPLACE') {
        if (!req.activeCompany || req.activeCompany.id !== targetCompanyId) {
          res.status(403).json({ error: "COMPANY_ACCESS_DENIED", message: "Active company context required and must match target" });
          return;
        }
      }
    }

    const restoredCompanyId = await RestoreService.restoreDatabase(
      payload,
      targetCompanyId || payload.metadata.companyId,
      mode,
      actorUserId,
      effectiveDestinationPath,
      { cloneAsNew: Boolean(cloneAsNew) }
    );

    // Always seal RESTORE_COMPLETED into the restored company's immutable BIR CAS audit trail
    try {
      const restoredDb = await CompanyManager.getCompanyDb(restoredCompanyId);
      await dbContext.run(restoredDb, async () => {
        await AuditService.log({
          req,
          companyId: restoredCompanyId,
          userId: actorUserId || undefined,
          userEmail: verifiedActor?.email || req.user?.email,
          userDisplayName: verifiedActor?.displayName || req.user?.displayName,
          role: verifiedActor?.primaryRole || req.activeCompany?.role,
          action: "RESTORE_COMPLETED",
          entityType: "COMPANY",
          entityId: restoredCompanyId,
          module: "RESTORE",
          source: "RESTORE",
          metadata: {
            mode,
            cloneAsNew: Boolean(cloneAsNew),
            backupVersion: payload.metadata.version,
            authMode: useColdBackupAuth ? 'COLD_BACKUP_CREDENTIALS' : 'WORKSPACE_SESSION',
            requiresPostRestoreLogin: useColdBackupAuth,
          }
        });
      });
      await CompanyManager.syncCompanyDatabaseSnapshot(restoredCompanyId).catch(() => {});
    } catch (auditErr) {
      console.warn("[Restore] Unable to write post-restore audit entry:", auditErr);
    }

    // IMPORTANT: Cold Disaster-Recovery restore intentionally does NOT issue a session cookie or auto-login.
    // Users must explicitly sign in to the newly restored company workspace via /login/:companyId.
    res.json({
      message: useColdBackupAuth
        ? "Restore completed and verified. Please sign in to the restored company profile to begin."
        : "Restore successful",
      companyId: restoredCompanyId,
      requiresLogin: useColdBackupAuth,
      authMode: useColdBackupAuth ? 'COLD_BACKUP_CREDENTIALS' : 'WORKSPACE_SESSION',
      verifiedBackupUser: verifiedActor
        ? {
            displayName: verifiedActor.displayName,
            email: verifiedActor.email,
            role: verifiedActor.primaryRole,
          }
        : undefined,
    });

  } catch (err: any) {
    console.error("Restore failed:", err);
    try {
      if (dbContext.getStore()) {
        await AuditService.log({
          req,
          companyId: req.body?.targetCompanyId || null,
          action: "RESTORE_FAILED",
          entityType: "COMPANY",
          entityId: req.body?.targetCompanyId || "unknown",
          result: "FAILED",
          reason: err.message,
          module: "RESTORE",
          source: "RESTORE"
        });
      }
    } catch {}
    const msg = String(err?.message || "Failed to restore database");
    const status =
      msg.includes('INSUFFICIENT_DESTINATION_STORAGE')
        ? 507
        : msg.includes('COMPANY_ALREADY_EXISTS') || msg.includes('TARGET_DIRECTORY_NOT_EMPTY')
          ? 409
          : msg.includes('IDENTITY_MISMATCH') ||
            msg.includes('WORKSPACE_DB_NOT_BACKUP') ||
            msg.includes('STORAGE_ISOLATION_ERROR') ||
            msg.includes('CORRUPTED_PACKAGE') ||
            msg.includes('TAMPER_DETECTED') ||
            msg.includes('CHECKSUM_MISMATCH') ||
            msg.includes('INVALID_BACKUP_STRUCTURE') ||
            msg.includes('INVALID_BACKUP_FORMAT') ||
            msg.includes('BACKUP_VERSION_INCOMPATIBLE') ||
            msg.includes('ATTACHMENT_REENCRYPTION_FAILED') ||
            msg.includes('DECRYPTION_FAILED') ||
            msg.includes('POST_EXTRACTION_VERIFICATION_FAILED')
          ? 400
          : 500;
    const errorCode =
      msg.includes('INSUFFICIENT_DESTINATION_STORAGE') ? 'INSUFFICIENT_DESTINATION_STORAGE' :
      msg.includes('COMPANY_ALREADY_EXISTS') ? 'COMPANY_ALREADY_EXISTS' :
      msg.includes('TARGET_DIRECTORY_NOT_EMPTY') ? 'TARGET_DIRECTORY_NOT_EMPTY' :
      msg.includes('IDENTITY_MISMATCH') ? 'IDENTITY_MISMATCH' :
      msg.includes('WORKSPACE_DB_NOT_BACKUP') ? 'WORKSPACE_DB_NOT_BACKUP' :
      msg.includes('STORAGE_ISOLATION_ERROR') ? 'STORAGE_ISOLATION_ERROR' :
      msg.includes('CORRUPTED_PACKAGE') ? 'CORRUPTED_PACKAGE' :
      msg.includes('TAMPER_DETECTED') ? 'TAMPER_DETECTED' :
      msg.includes('CHECKSUM_MISMATCH') ? 'CHECKSUM_MISMATCH' :
      msg.includes('BACKUP_VERSION_INCOMPATIBLE') ? 'BACKUP_VERSION_INCOMPATIBLE' :
      msg.includes('ATTACHMENT_REENCRYPTION_FAILED') ? 'ATTACHMENT_REENCRYPTION_FAILED' :
      msg.includes('DECRYPTION_FAILED') ? 'DECRYPTION_FAILED' :
      msg.includes('POST_EXTRACTION_VERIFICATION_FAILED') ? 'POST_EXTRACTION_VERIFICATION_FAILED' :
      'INTERNAL_ERROR';
    res.status(status).json({ error: errorCode, message: msg });
  }
});

export default router;

