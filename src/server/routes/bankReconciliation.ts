import { Router } from "express";
import { BankReconciliationService } from "../services/bankReconciliationService";
import { requireAuth, requireMinRole } from "../auth";

const router = Router();

// Get bank accounts
router.get("/accounts", requireAuth, async (req: any, res) => {
  try {
    const companyId = req.headers['x-company-id'] || req.query.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "Company ID required" });
    }
    const accounts = await BankReconciliationService.getBankAccounts(companyId);
    res.json(accounts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create bank account
router.post("/accounts", requireAuth, requireMinRole('Bookkeeper'), async (req: any, res) => {
  try {
    const companyId = req.headers['x-company-id'] || req.body.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "Company ID required" });
    }
    const account = await BankReconciliationService.createBankAccount({
      companyId,
      accountName: req.body.accountName,
      bankName: req.body.bankName,
      accountNumber: req.body.accountNumber,
      currency: req.body.currency,
    });
    res.json(account);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Import bank statement CSV
router.post("/import", requireAuth, requireMinRole('Bookkeeper'), async (req: any, res) => {
  try {
    const companyId = req.headers['x-company-id'] || req.body.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "Company ID required" });
    }
    const result = await BankReconciliationService.importStatement({
      companyId,
      bankAccountId: req.body.bankAccountId,
      statementDate: new Date(req.body.statementDate || Date.now()),
      filename: req.body.filename,
      csvContent: req.body.csvContent,
      userId: req.user?.id,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Run matching engine
router.post("/match", requireAuth, requireMinRole('Bookkeeper'), async (req: any, res) => {
  try {
    const companyId = req.headers['x-company-id'] || req.body.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "Company ID required" });
    }
    const result = await BankReconciliationService.runMatchingEngine(companyId, req.body.bankAccountId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Approve match
router.post("/approve", requireAuth, requireMinRole('Approver'), async (req: any, res) => {
  try {
    const companyId = req.headers['x-company-id'] || req.body.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "Company ID required" });
    }
    const result = await BankReconciliationService.approveMatch(
      companyId,
      req.body.bankTransactionId,
      req.body.matchedJournalId,
      req.user?.id || 'system'
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
