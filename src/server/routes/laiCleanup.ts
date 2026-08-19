import { Router, Request, Response } from 'express';
import { LaiCleanupService } from '../services/laiCleanupService';
import { requireAuth, requirePermission } from '../auth';

const router = Router();

/**
 * GET /api/lai-cleanup/scan
 * Runs a complete scan for unused, old, cache, or duplicate .lai files
 */
router.get('/scan', requireAuth, requirePermission('storage:view'), async (req: Request, res: Response) => {
  try {
    const result = await LaiCleanupService.scanForLaiFiles();
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
router.get('/alert-status', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await LaiCleanupService.scanForLaiFiles();
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
 * Deletes specified list of .lai files
 */
router.post('/delete', requireAuth, requirePermission('storage:cleanup'), async (req: Request, res: Response) => {
  try {
    const { filePaths, forceDeletePrimary } = req.body;
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'filePaths array is required' });
    }

    const result = await LaiCleanupService.deleteLaiFiles(filePaths, !!forceDeletePrimary);
    res.json(result);
  } catch (err) {
    console.error('LAI Deletion Error:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: (err as Error).message || 'Failed to delete .lai files' });
  }
});

/**
 * POST /api/lai-cleanup/clean-all
 * One-click batch deletion of all recommended redundant/cache/duplicate .lai files
 */
router.post('/clean-all', requireAuth, requirePermission('storage:cleanup'), async (req: Request, res: Response) => {
  try {
    const scan = await LaiCleanupService.scanForLaiFiles();
    const cleanablePaths = scan.files
      .filter(f => f.recommendedAction === 'DELETE')
      .map(f => f.path);

    if (cleanablePaths.length === 0) {
      return res.json({ success: true, deletedCount: 0, freedBytes: 0, formattedFreedSize: '0 B', message: 'No cleanable .lai files found.' });
    }

    const result = await LaiCleanupService.deleteLaiFiles(cleanablePaths, false);
    res.json({
      ...result,
      message: `Successfully cleaned up ${result.deletedCount} .lai file(s), freeing ${result.formattedFreedSize} of storage.`
    });
  } catch (err) {
    console.error('LAI Batch Cleanup Error:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: (err as Error).message || 'Failed to execute batch .lai cleanup' });
  }
});

export default router;
