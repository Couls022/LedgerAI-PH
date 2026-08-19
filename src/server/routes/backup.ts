import { Router } from "express";
import { requireAuth, requirePermission } from "../auth";
import { CompanyStorageService } from "../services/storageService";
import path from "path";
import fs from "fs";

const router = Router();

router.get("/", requireAuth, requirePermission('backups:download'), async (req, res) => {
  res.status(410).json({
    error: "ENDPOINT_DEPRECATED",
    message: "Raw database file downloading is disabled for data security. Use the 'Create Encrypted Backup' workflow in Backup Manager."
  });
});

export default router;
