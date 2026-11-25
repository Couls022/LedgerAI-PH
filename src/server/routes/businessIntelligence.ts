import { Router } from 'express';
import { CashFlowForecastService } from '../services/cashFlowForecastService';
import { AnalyticsEngine } from '../services/analyticsEngine';
import { db } from '../db';
import * as schema from '../db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
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

router.get('/dashboard', requireAuth, requirePermission('reports:view', 'accounting:view'), async (req, res) => {
  try {
    const companyId = resolveVerifiedCompanyId(req, res);
    if (!companyId) return;
    const months = Number(req.query.months) || 12;
    const analytics = await AnalyticsEngine.getFinancialAnalytics(companyId, months);
    res.json(analytics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/analytics', requireAuth, requirePermission('reports:view', 'accounting:view'), async (req, res) => {
  try {
    const companyId = resolveVerifiedCompanyId(req, res);
    if (!companyId) return;
    const months = Number(req.query.months) || 12;
    const analytics = await AnalyticsEngine.getFinancialAnalytics(companyId, months);
    res.json(analytics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/forecast/cash-flow', requireAuth, requirePermission('reports:create', 'accounting:create', 'accounting:edit', 'budget:create'), async (req, res) => {
  try {
    const companyId = resolveVerifiedCompanyId(req, res);
    if (!companyId) return;
    const { horizonDays, scenario } = req.body;
    const userId = (req as any).user?.id || 'system';
    const result = await CashFlowForecastService.generateForecast({
      companyId,
      horizonDays: Number(horizonDays) || 30,
      scenario: scenario || 'BASE',
      userId,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/forecasts', requireAuth, requirePermission('reports:view', 'accounting:view'), async (req, res) => {
  try {
    const companyId = resolveVerifiedCompanyId(req, res);
    if (!companyId) return;
    const forecasts = await db
      .select()
      .from(schema.cashFlowForecasts)
      .where(eq(schema.cashFlowForecasts.companyId, companyId))
      .orderBy(desc(schema.cashFlowForecasts.createdAt));
    res.json(forecasts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/aging', requireAuth, requirePermission('reports:view', 'accounting:view'), async (req, res) => {
  try {
    const companyId = resolveVerifiedCompanyId(req, res);
    if (!companyId) return;
    const aging = await CashFlowForecastService.getArApAgingAnalysis(companyId);
    res.json(aging);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/budgets', requireAuth, requirePermission('budget:view', 'reports:view', 'accounting:view'), async (req, res) => {
  try {
    const companyId = resolveVerifiedCompanyId(req, res);
    if (!companyId) return;
    const now = new Date();
    const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const periodMonth = String(req.query.periodMonth || defaultPeriod).trim();

    const [configuredBudgets, glExpenses] = await Promise.all([
      db.select()
        .from(schema.budgets)
        .where(and(
          eq(schema.budgets.companyId, companyId),
          eq(schema.budgets.periodMonth, periodMonth),
          sql`UPPER(COALESCE(${schema.budgets.status}, 'DRAFT')) NOT IN ('ARCHIVED', 'REMOVED', 'SOFT_DELETED')`
        )),
      db.select({
        category: schema.accounts.accountName,
        netExpense: sql<number>`COALESCE(SUM(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, 'POSTED'),
        sql`${schema.accounts.accountType} IN ('EXPENSE', 'COST_OF_SALES')`,
        sql`strftime('%Y-%m', ${schema.journalEntries.entryDate}) = ${periodMonth}`
      ))
      .groupBy(schema.accounts.accountName),
    ]);

    const actualMap = new Map<string, number>();
    for (const g of glExpenses) {
      if (g.category && Number(g.netExpense || 0) > 0) {
        actualMap.set(g.category, Number(g.netExpense || 0));
      }
    }

    const budgetMap = new Map<string, any>(configuredBudgets.map((b: any) => [b.category, b]));
    const allCategories = new Set<string>([
      ...configuredBudgets.map((b: any) => b.category),
      ...actualMap.keys(),
    ]);

    const items = Array.from(allCategories).map(category => {
      const cfg: any = budgetMap.get(category);
      const monthlyLimit = cfg ? Number(cfg.monthlyLimit || 0) : 0;
      const actualSpent = actualMap.get(category) || 0;
      const variance = monthlyLimit - actualSpent;
      const percentageUsed = monthlyLimit > 0 ? Math.round((actualSpent / monthlyLimit) * 100) : (actualSpent > 0 ? 100 : 0);
      const status = !cfg ? 'UNBUDGETED' : percentageUsed > 100 ? 'OVER_BUDGET' : percentageUsed >= 80 ? 'NEAR_LIMIT' : 'UNDER_BUDGET';
      return {
        id: cfg?.id || null,
        companyId,
        periodMonth,
        category,
        isConfigured: Boolean(cfg),
        monthlyLimit,
        actualSpent,
        variance,
        percentageUsed,
        status,
        notes: cfg?.notes || null,
      };
    }).sort((a, b) => b.actualSpent - a.actualSpent || b.monthlyLimit - a.monthlyLimit);

    res.json({
      periodMonth,
      hasConfiguredBudgets: configuredBudgets.length > 0,
      summary: {
        totalBudget: items.reduce((s, i) => s + (i.isConfigured ? i.monthlyLimit : 0), 0),
        totalActual: items.reduce((s, i) => s + i.actualSpent, 0),
        overBudgetCount: items.filter(i => i.status === 'OVER_BUDGET').length,
        nearLimitCount: items.filter(i => i.status === 'NEAR_LIMIT').length,
        unbudgetedCount: items.filter(i => i.status === 'UNBUDGETED').length,
      },
      budgets: items,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
