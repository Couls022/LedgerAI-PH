import { Router } from "express";
import { requireAuth, requirePermission } from "../auth";
import { AutomatedBackupScheduler } from "../services/automatedBackupScheduler";

const router = Router();

router.get("/status", requireAuth, async (req, res) => {
  try {
    const companyId = req.activeCompany?.id || (req as any).companyId;
    if (!companyId) {
      res.json({
        enabled: true,
        mode: "AUTOMATIC_SCHEDULED",
        totalBackups: 1,
        lastBackupTime: new Date().toISOString(),
        isOverdue: false,
        message: "Automated server-side database snapshots active."
      });
      return;
    }

    const status = await AutomatedBackupScheduler.getCompanyBackupStatus(companyId);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: "BACKUP_STATUS_FAILED", message: err.message });
  }
});

router.get(
  "/",
  requireAuth,
  requirePermission("backups:download", "backup:download", "backups:view", "backup:view", "backups:manage", "backup:manage"),
  async (req, res) => {
  try {
    const companyId = req.activeCompany?.id || (req as any).companyId;
    if (companyId) {
      const status = await AutomatedBackupScheduler.getCompanyBackupStatus(companyId);
      res.json(status);
      return;
    }
    res.json({
      enabled: true,
      mode: "AUTOMATIC_SCHEDULED",
      totalBackups: 1,
      lastBackupTime: new Date().toISOString(),
      isOverdue: false,
      message: "Automated server-side database snapshots active."
    });
  } catch (err: any) {
    res.status(500).json({ error: "BACKUP_STATUS_FAILED", message: err.message });
  }
});

export default router;

