import { Router } from 'express';
import { ElectronicFilingService } from '../services/electronicFilingService';
import { DocumentSigner } from '../services/documentSigner';
import { requireAuth } from '../auth';

const router = Router();

// Middleware to check accountant/admin RBAC for filing
const requireFilingPermission = (req: any, res: any, next: any) => {
  if (!req.activeCompany) {
    return res.status(403).json({ error: 'COMPANY_ACCESS_DENIED', message: 'Active company context required.' });
  }

  const companyId = req.activeCompany.id;

  // Enforce granular permissions
  const isRead = req.method === 'GET';
  const requiredPermission = isRead ? 'tax:view' : 'tax:manage';

  if (!req.permissions || !req.permissions.includes(requiredPermission)) {
    return res.status(403).json({ 
      error: 'PERMISSION_DENIED', 
      message: `Insufficient permissions. Electronic filing requires '${requiredPermission}' privilege.` 
    });
  }

  req.companyId = companyId;
  next();
};

router.use(requireAuth);
router.use(requireFilingPermission);

// List filings for active company
router.get('/', async (req: any, res, next) => {
  try {
    const filings = await ElectronicFilingService.listFilings(req.companyId);
    res.json(filings);
  } catch (err: any) {
    next(err);
  }
});

// Create filing draft
router.post('/', async (req: any, res, next) => {
  try {
    const { filingType, reportingPeriod, payloadData } = req.body;
    if (!filingType || !reportingPeriod) {
      return res.status(400).json({ error: 'INVALID_REQUEST', message: 'filingType and reportingPeriod are required.' });
    }
    const userId = req.user?.id || 'system';
    const filing = await ElectronicFilingService.createFiling(req.companyId, filingType, reportingPeriod, payloadData || req.body, userId);
    res.status(201).json(filing);
  } catch (err: any) {
    next(err);
  }
});

// Validate filing
router.post('/:id/validate', async (req: any, res, next) => {
  try {
    const userId = req.user?.id || 'system';
    const result = await ElectronicFilingService.validateFiling(req.params.id, req.companyId, userId);
    res.json(result);
  } catch (err: any) {
    next(err);
  }
});

// Generate package
router.post('/:id/package', async (req: any, res, next) => {
  try {
    const userId = req.user?.id || 'system';
    const result = await ElectronicFilingService.generatePackage(req.params.id, req.companyId, userId);
    res.json(result);
  } catch (err: any) {
    next(err);
  }
});

// Sign filing
router.post('/:id/sign', async (req: any, res, next) => {
  try {
    const { certificateData } = req.body;
    const userId = req.user?.id || 'system';
    const result = await ElectronicFilingService.signFiling(req.params.id, req.companyId, certificateData, userId);
    res.json(result);
  } catch (err: any) {
    next(err);
  }
});

// Submit filing
router.post('/:id/submit', async (req: any, res, next) => {
  try {
    const userId = req.user?.id || 'system';
    const result = await ElectronicFilingService.submitFiling(req.params.id, req.companyId, userId);
    res.json(result);
  } catch (err: any) {
    next(err);
  }
});

// Get filing details
router.get('/:id', async (req: any, res, next) => {
  try {
    const filing = await ElectronicFilingService.getFiling(req.params.id, req.companyId);
    res.json(filing);
  } catch (err: any) {
    next(err);
  }
});

// Get filing status
router.get('/:id/status', async (req: any, res, next) => {
  try {
    const filing = await ElectronicFilingService.getFiling(req.params.id, req.companyId);
    res.json({
      id: filing.id,
      filingType: filing.filingType,
      reportingPeriod: filing.reportingPeriod,
      status: filing.status,
      adapterProvider: filing.adapterProvider,
      attemptCount: filing.attemptCount,
      errorCode: filing.errorCode,
      errorMessage: filing.errorMessage,
      externalReference: filing.externalReference,
      updatedAt: filing.updatedAt
    });
  } catch (err: any) {
    next(err);
  }
});

// Get filing receipt
router.get('/:id/receipt', async (req: any, res, next) => {
  try {
    const filing = await ElectronicFilingService.getFiling(req.params.id, req.companyId);
    if (!filing.receiptReference && filing.status !== 'ACCEPTED') {
      return res.status(404).json({
        error: 'RECEIPT_NOT_AVAILABLE',
        status: filing.status,
        message: 'No receipt is available because the submission has not been officially accepted (Status: ' + filing.status + ').'
      });
    }
    res.json({
      id: filing.id,
      receiptReference: filing.receiptReference,
      externalReference: filing.externalReference,
      status: filing.status,
      submittedAt: filing.submittedAt
    });
  } catch (err: any) {
    next(err);
  }
});

// Retry filing
router.post('/:id/retry', async (req: any, res, next) => {
  try {
    const userId = req.user?.id || 'system';
    const result = await ElectronicFilingService.retryFiling(req.params.id, req.companyId, userId);
    res.json(result);
  } catch (err: any) {
    next(err);
  }
});

export default router;
