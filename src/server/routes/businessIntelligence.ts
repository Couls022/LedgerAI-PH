import { Router } from "express";
import { CashFlowForecastService } from "../services/cashFlowForecastService";
import { RecurringJournalService } from "../services/recurringJournalService";
import { requireAuth, requireMinRole } from "../auth";

const router = Router();

// Cash flow forecast
router.post("/cash-flow-forecast", requireAuth, async (req: any, res) => {
  try {
    const companyId = req.headers['x-company-id'] || req.body.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "Company ID required" });
    }
    const result = await CashFlowForecastService.generateForecast({
      companyId,
      horizonDays: req.body.horizonDays || 30,
      scenario: req.body.scenario || 'BASE',
      userId: req.user?.id,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// AR/AP Aging
router.get("/ar-ap-aging", requireAuth, async (req: any, res) => {
  try {
    const companyId = req.headers['x-company-id'] || req.query.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "Company ID required" });
    }
    const result = await CashFlowForecastService.getArApAgingAnalysis(companyId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Recurring journal templates list
router.get("/recurring-journals", requireAuth, async (req: any, res) => {
  try {
    const companyId = req.headers['x-company-id'] || req.query.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "Company ID required" });
    }
    const list = await RecurringJournalService.listTemplates(companyId);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create recurring journal template
router.post("/recurring-journals", requireAuth, requireMinRole('Bookkeeper'), async (req: any, res) => {
  try {
    const companyId = req.headers['x-company-id'] || req.body.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "Company ID required" });
    }
    const created = await RecurringJournalService.createTemplate({
      companyId,
      templateName: req.body.templateName,
      frequency: req.body.frequency,
      startDate: new Date(req.body.startDate || Date.now()),
      endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      journalData: req.body.journalData,
      requiresApproval: req.body.requiresApproval,
      userId: req.user?.id,
    });
    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Process recurring templates
router.post("/recurring-journals/process", requireAuth, requireMinRole('Bookkeeper'), async (req: any, res) => {
  try {
    const companyId = req.headers['x-company-id'] || req.body.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "Company ID required" });
    }
    const result = await RecurringJournalService.processDueTemplates(companyId, req.user?.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Executive KPI Dashboard
router.get("/executive-kpis", requireAuth, async (req: any, res) => {
  try {
    const companyId = req.headers['x-company-id'] || req.query.companyId;
    if (!companyId) {
      return res.status(400).json({ error: "Company ID required" });
    }
    const kpis = await RecurringJournalService.getExecutiveKpis(companyId);
    res.json(kpis);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
