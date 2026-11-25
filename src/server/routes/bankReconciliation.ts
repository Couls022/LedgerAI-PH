import { Router } from 'express';
import { BankReconciliationService } from '../services/bankReconciliationService';
import { requireAuth, requirePermission } from '../auth';

const router = Router();

function resolveVerifiedCompanyId(req: any, res: any): string | null {
  const activeCompanyId = req.activeCompany?.id;
  const requestedCompanyId =
    (req.headers['x-company-id'] as string) ||
    req.body?.companyId ||
    (req.query?.companyId as string);

  if (activeCompanyId) {
    if (requestedCompanyId && String(requestedCompanyId) !== String(activeCompanyId)) {
      res.status(403).json({
        error: 'TENANT_SCOPE_VIOLATION',
        message: `Cross-company access denied: session is bound to company '${activeCompanyId}', not '${requestedCompanyId}'.`
      });
      return null;
    }
    return activeCompanyId;
  }

  if (!requestedCompanyId) {
    res.status(400).json({ error: 'Company ID required' });
    return null;
  }
  return String(requestedCompanyId);
}

router.get('/accounts', requireAuth, requirePermission('bank_rec:view', 'accounting:view'), async (req, res) => {
  try {
    const companyId = resolveVerifiedCompanyId(req, res);
    if (!companyId) return;
    const accounts = await BankReconciliationService.getBankAccounts(companyId);
    res.json(accounts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/accounts', requireAuth, requirePermission('bank_rec:create', 'bank_rec:edit', 'bank_rec:manage', 'masterdata:manage'), async (req, res) => {
  try {
    const companyId = resolveVerifiedCompanyId(req, res);
    if (!companyId) return;
    const { accountName, bankName, accountNumber, currency, glAccountId, accountCode } = req.body;
    if (!accountName || !bankName || !accountNumber) {
      return res.status(400).json({ error: 'accountName, bankName, and accountNumber are required' });
    }
    const result = await BankReconciliationService.createBankAccount({
      companyId,
      accountName,
      bankName,
      accountNumber,
      currency,
      glAccountId,
      accountCode,
    });
    res.status(201).json(result);
  } catch (error: any) {
    const msg = String(error?.message || '');
    const status = msg.startsWith('BANK_GL_ACCOUNT_') ? 400 : 500;
    res.status(status).json({ error: msg });
  }
});

router.post('/statements/import', requireAuth, requirePermission('bank_rec:create', 'bank_rec:edit', 'bank_rec:manage'), async (req, res) => {
  try {
    const companyId = resolveVerifiedCompanyId(req, res);
    if (!companyId) return;
    const { bankAccountId, statementDate, csvContent, filename } = req.body;
    const userId = (req as any).user?.id || 'system';
    if (!bankAccountId || !csvContent) {
      return res.status(400).json({ error: 'bankAccountId and csvContent are required' });
    }
    const result = await BankReconciliationService.importStatement({
      companyId,
      bankAccountId,
      statementDate: statementDate ? new Date(statementDate) : new Date(),
      csvContent,
      filename,
      userId,
    });
    res.status(201).json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/match', requireAuth, requirePermission('bank_rec:create', 'bank_rec:edit', 'bank_rec:manage'), async (req, res) => {
  try {
    const companyId = resolveVerifiedCompanyId(req, res);
    if (!companyId) return;
    const { bankAccountId } = req.body;
    if (!bankAccountId) {
      return res.status(400).json({ error: 'bankAccountId is required' });
    }
    const result = await BankReconciliationService.runMatchingEngine(companyId, bankAccountId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/approve', requireAuth, requirePermission('bank_rec:approve', 'accounting:approve'), async (req, res) => {
  try {
    const companyId = resolveVerifiedCompanyId(req, res);
    if (!companyId) return;
    const { bankTransactionId, matchedJournalId } = req.body;
    const userId = (req as any).user?.id || 'system';
    const userRole = (req as any).activeCompany?.roleName || (req as any).activeCompany?.role;
    if (!bankTransactionId || !matchedJournalId) {
      return res.status(400).json({ error: 'bankTransactionId and matchedJournalId are required' });
    }
    const result = await BankReconciliationService.approveMatch(companyId, bankTransactionId, matchedJournalId, userId, userRole);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
