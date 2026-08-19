import { Router } from "express";
import { RestoreService } from "../services/restoreService";
import { requireAuth, requireMinRole, requirePermission } from "../auth";
import { db } from "../db";
import * as schema from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { AuditService } from "../services/auditService";
import { CompanyStorageService } from "../services/storageService";
import fs from 'fs/promises';
import path from 'path';

const router = Router();

router.get("/export", requireAuth, requirePermission('backups:download'), async (req, res) => {
  res.status(410).json({
    error: "ENDPOINT_DEPRECATED",
    message: "Direct .lai file export via HTTP download is disabled in production. Encrypted backups are automatically created and stored in the company backup directory."
  });
});

router.post("/validate", async (req, res) => {
  try {
    const { backupData } = req.body;
    if (!backupData) {
      res.status(400).json({ error: "BAD_REQUEST", message: "Missing backupData" });
      return;
    }
    const payload = RestoreService.deserializeLgb(backupData);
    
    const accountingPeriods = payload.data.accountingPeriods || [];
    const journalEntries = payload.data.journalEntries || [];
    
    const scopeSummary = {
      fiscalYearRange: accountingPeriods.length > 0 
        ? `${new Date(accountingPeriods[0].startDate).getFullYear()} - ${new Date(accountingPeriods[accountingPeriods.length - 1].endDate).getFullYear()}`
        : 'N/A',
      journalEntryCount: journalEntries.length
    };
    
    res.json({ success: true, metadata: payload.metadata, scopeSummary });
  } catch (err: any) {
    console.error("Validation error:", err);
    res.status(400).json({ error: "INVALID_BACKUP", message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { mode, backupData, targetCompanyId, destinationPath } = req.body;
    
    if (!mode || !backupData) {
      res.status(400).json({ error: "BAD_REQUEST", message: "Missing mode or backupData" });
      return;
    }

    if (mode !== 'NEW' && mode !== 'REPLACE') {
      res.status(400).json({ error: "BAD_REQUEST", message: "Invalid mode" });
      return;
    }

    let payload;
    try {
      payload = RestoreService.deserializeLgb(backupData);
    } catch (e: any) {
      res.status(400).json({ error: "INVALID_BACKUP", message: e.message });
      return;
    }

    if (!RestoreService.verifyChecksum(payload)) {
      res.status(400).json({ error: "CHECKSUM_MISMATCH", message: "Backup checksum verification failed" });
      return;
    }

    // For REPLACE, we require auth and activeCompany context matching targetCompanyId
    let userId = null;
    
    if (mode === 'REPLACE') {
       // Since the route is not globally wrapped in requireAuth, we invoke it manually
       await new Promise<void>((resolve, reject) => {
         requireAuth(req, res, (err: any) => {
           if (err) reject(err);
           else resolve();
         });
       });
       if (res.headersSent) return;

       if (!req.activeCompany || req.activeCompany.id !== targetCompanyId) {
         res.status(403).json({ error: "COMPANY_ACCESS_DENIED", message: "Active company context required and must match target" });
         return;
       }

       // Only SuperAdmin or Admin can restore
       await new Promise<void>((resolve, reject) => {
         requirePermission('backup:restore')(req, res, (err: any) => {
           if (err) reject(err);
           else resolve();
         });
       });
       if (res.headersSent) return;
       userId = req.user!.id;
    }

    const restoredCompanyId = await RestoreService.restoreDatabase(payload, targetCompanyId || payload.metadata.companyId, mode, userId, destinationPath);
    
    await AuditService.log({
      req,
      companyId: restoredCompanyId,
      userId: userId || undefined,
      action: "RESTORE_COMPLETED",
      entityType: "COMPANY",
      entityId: restoredCompanyId,
      module: "RESTORE",
      source: "RESTORE",
      metadata: { mode, backupVersion: payload.metadata.version }
    });

    res.json({ message: "Restore successful", companyId: restoredCompanyId });

  } catch (err: any) {
    console.error("Restore failed:", err);
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
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message || "Failed to restore database" });
  }
});

export default router;
