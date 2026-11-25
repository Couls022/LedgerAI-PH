import { Router, Request, Response } from 'express';
import { LaiCleanupService } from '../services/laiCleanupService';
import { requireAuth, requirePermission } from '../auth';
import { AuditService } from '../services/auditService';

const router = Router();

function getRequestedCompanyOverride(req: Request): string | null {
  const qComp = typeof req.query?.companyId === 'string' ? req.query.companyId.trim() : '';
  const bComp = typeof req.body?.companyId === 'string' ? req.body.companyId.trim() : '';
  const hComp = typeof req.headers['x-company-id'] === 'string' ? req.headers['x-company-id'].trim() : '';
  return qComp || bComp || hComp || null;
}

async function assertActiveCompanyMatch(req: Request, res: Response, actionLabel: string): Promise<string | null> {
  const activeCompanyId = req.activeCompany?.id;
  if (!activeCompanyId) {
    res.status(400).json({ error: 'NO_ACTIVE_COMPANY', message: 'No active company context selected.' });
    return null;
  }
  const requestedCompanyId = getRequestedCompanyOverride(req);
  if (requestedCompanyId && requestedCompanyId !== activeCompanyId) {
    await AuditService.log({
      req,
      companyId: activeCompanyId,
      action: 'CROSS_COMPANY_ACCESS_DENIED',
      entityType: 'STORAGE_VAULT',
      entityId: requestedCompanyId,
      module: 'STORAGE',
      result: 'FAILED',
      reason: `Cross-company storage ${actionLabel} blocked: active company '${activeCompanyId}' cannot access target company '${requestedCompanyId}'.`
    });
    res.status(403).json({
      error: 'CROSS_COMPANY_ACCESS_DENIED',
      message: `Cross-company access denied: active company '${activeCompanyId}' cannot ${actionLabel} storage for company '${requestedCompanyId}'.`
    });
    return null;
  }
  return activeCompanyId;
}

/**
 * GET /api/lai-cleanup/scan
 * Runs a complete scan for unused, old, cache, or duplicate .lai files scoped to the active company
 */
router.get('/scan', requireAuth, requirePermission('storage:view', 'storage:manage'), async (req: Request, res: Response) => {
  try {
    const companyId = await assertActiveCompanyMatch(req, res, 'scan');
    if (!companyId) return;

    const result = await LaiCleanupService.scanForLaiFiles(companyId);
    res.json(result);
  } catch (err) {
    console.error('LAI Cleanup Scan Error:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: (err as Error).message || 'Failed to scan for .lai files' });
  }
});

/**
 * GET /api/lai-cleanup/alert-status
 * Light-weight scan to check if storage alert should be shown to user
 */
router.get('/alert-status', requireAuth, requirePermission('storage:view', 'storage:manage'), async (req: Request, res: Response) => {
  try {
    const companyId = await assertActiveCompanyMatch(req, res, 'inspect alert status for');
    if (!companyId) return;

    const result = await LaiCleanupService.scanForLaiFiles(companyId);
    res.json({
      alertTriggered: result.summary.alertTriggered,
      alertMessage: result.summary.alertMessage,
      cleanableFilesCount: result.summary.cleanableFilesCount,
      formattedCleanableSize: result.summary.formattedCleanableSize,
      totalSizeBytes: result.summary.totalSizeBytes,
      formattedTotalSize: result.summary.formattedTotalSize
    });
  } catch (err) {
    console.error('LAI Cleanup Alert Check Error:', err);
    res.json({ alertTriggered: false, cleanableFilesCount: 0, formattedCleanableSize: '0 B' });
  }
});

/**
 * POST /api/lai-cleanup/delete
 * Deletes specified list of .lai files within the active company workspace
 */
router.post('/delete', requireAuth, requirePermission('storage:cleanup', 'storage:manage'), async (req: Request, res: Response) => {
  try {
    const companyId = await assertActiveCompanyMatch(req, res, 'delete');
    if (!companyId) return;

    const { filePaths, forceDeletePrimary } = req.body || {};
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'filePaths array is required' });
    }

    const result = await LaiCleanupService.deleteLaiFiles(filePaths, !!forceDeletePrimary, companyId);
    await AuditService.log({
      req,
      companyId,
      action: 'STORAGE_FILES_CLEANED',
      entityType: 'STORAGE_VAULT',
      entityId: companyId,
      module: 'STORAGE',
      metadata: {
        deletedCount: result.deletedCount,
        freedBytes: result.freedBytes,
        requestedFilesCount: filePaths.length
      }
    });
    res.json(result);
  } catch (err: any) {
    if (err?.code === 'CROSS_COMPANY_ACCESS_DENIED' || err?.statusCode === 403) {
      await AuditService.log({
        req,
        companyId: req.activeCompany?.id,
        action: 'CROSS_COMPANY_ACCESS_DENIED',
        entityType: 'STORAGE_VAULT',
        entityId: req.activeCompany?.id || 'UNKNOWN',
        module: 'STORAGE',
        result: 'FAILED',
        reason: err.message
      });
      return res.status(403).json({ error: 'CROSS_COMPANY_ACCESS_DENIED', message: err.message });
    }
    console.error('LAI Deletion Error:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: (err as Error).message || 'Failed to delete .lai files' });
  }
});

/**
 * POST /api/lai-cleanup/clean-all
 * One-click batch deletion of all recommended redundant/cache/duplicate .lai files within the active company
 */
router.post('/clean-all', requireAuth, requirePermission('storage:cleanup', 'storage:manage'), async (req: Request, res: Response) => {
  try {
    const companyId = await assertActiveCompanyMatch(req, res, 'clean-all');
    if (!companyId) return;

    const scan = await LaiCleanupService.scanForLaiFiles(companyId);
    const cleanablePaths = scan.files
      .filter(f => f.recommendedAction === 'DELETE')
      .map(f => f.path);

    if (cleanablePaths.length === 0) {
      return res.json({ success: true, deletedCount: 0, freedBytes: 0, formattedFreedSize: '0 B', message: 'No cleanable .lai files found.' });
    }

    const result = await LaiCleanupService.deleteLaiFiles(cleanablePaths, false, companyId);
    await AuditService.log({
      req,
      companyId,
      action: 'STORAGE_BATCH_CLEANUP',
      entityType: 'STORAGE_VAULT',
      entityId: companyId,
      module: 'STORAGE',
      metadata: {
        deletedCount: result.deletedCount,
        freedBytes: result.freedBytes
      }
    });
    res.json({
      ...result,
      message: `Successfully cleaned up ${result.deletedCount} .lai file(s), freeing ${result.formattedFreedSize} of storage.`
    });
  } catch (err: any) {
    if (err?.code === 'CROSS_COMPANY_ACCESS_DENIED' || err?.statusCode === 403) {
      return res.status(403).json({ error: 'CROSS_COMPANY_ACCESS_DENIED', message: err.message });
    }
    console.error('LAI Batch Cleanup Error:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: (err as Error).message || 'Failed to execute batch .lai cleanup' });
  }
});

export default router;
