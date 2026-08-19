import { describe, test, expect, beforeAll } from 'vitest';
import { db } from '../db';
import * as schema from '../db/schema';
import { runInTestDb } from '../../../tests/setup';
import { skillRegistry } from './skills/registry';
import { SkillManager } from './skillManager';
import { IntentRouter } from './intentRouter';
import { LocalFallbackProvider } from './providers/providerManager';
import { AnalyticsEngine } from '../services/analyticsEngine';
import { ComplianceRuleEngine } from '../services/complianceEngine';
import { AICostController } from './costControl';
import { registerAllCoreSkills } from './skills/definitions';
import crypto from 'crypto';

describe('LedgerAI PH Phase 5 — AI Assistant + Business Intelligence Integration Tests', () => {
  let companyId: string;
  let customerId: string;
  let vendorId: string;
  let provider: LocalFallbackProvider;

  beforeAll(async () => {
    provider = new LocalFallbackProvider();
    registerAllCoreSkills();

    await runInTestDb(async () => {
      companyId = crypto.randomUUID();
      customerId = crypto.randomUUID();
      vendorId = crypto.randomUUID();

      // Seed Company
      await db.insert(schema.companies).values({
        id: companyId,
        legalName: 'Manila Trading & Services Corp.',
        tradeName: 'Manila Trading',
        tin: '123-456-789-000',
        taxpayerClassification: 'CORPORATION',
        vatStatus: 'VAT',
        status: 'ACTIVE'
      });

      await db.insert(schema.companyTaxProfiles).values({
        id: crypto.randomUUID(),
        companyId,
        taxpayerClassification: 'CORPORATION',
        vatStatus: 'VAT',
        taxRegime: 'VAT'
      });

      // Seed Customer and Vendor
      await db.insert(schema.customers).values({
        id: customerId,
        companyId,
        code: 'CUST-001',
        legalName: 'Customer One Corp.',
      });

      await db.insert(schema.vendors).values({
        id: vendorId,
        companyId,
        code: 'VEND-001',
        legalName: 'Supplier One Inc.',
      });

      // Seed Sales Invoices
      await db.insert(schema.salesInvoices).values([
        {
          id: crypto.randomUUID(),
          companyId,
          customerId,
          invoiceNumber: 'INV-2026-001',
          invoiceDate: '2026-08-01',
          dueDate: '2026-08-30',
          totalAmount: 11200000,
          balanceDue: 5000000,
          status: 'POSTED',
        },
        {
          id: crypto.randomUUID(),
          companyId,
          customerId,
          invoiceNumber: 'INV-2026-002',
          invoiceDate: '2026-08-05',
          dueDate: '2026-09-05',
          totalAmount: 5600000,
          balanceDue: 0,
          status: 'POSTED',
        }
      ]);

      // Seed Purchase Bills
      await db.insert(schema.purchaseBills).values([
        {
          id: crypto.randomUUID(),
          companyId,
          vendorId,
          billNumber: 'BILL-2026-001',
          billDate: '2026-08-02',
          dueDate: '2026-08-20',
          totalAmount: 3360000,
          balanceDue: 3360000,
          status: 'POSTED',
        }
      ]);
    });
  });

  test('1. Taglish / Filipino Intent Routing Accuracy', async () => {
    const userSkills = skillRegistry.listSkills().map(s => s.id);

    // Sales / Income query in Taglish
    const res1 = await IntentRouter.routeIntent('Magkano kinita ko this month?', provider, userSkills);
    expect(['getSalesSummary', 'getFinancialSummary', 'financialQuery']).toContain(res1.skillId);

    // Expense query in Taglish
    const res2 = await IntentRouter.routeIntent('Magkano gastos ko?', provider, userSkills);
    expect(['getExpenseSummary', 'financialQuery', 'getFinancialSummary']).toContain(res2.skillId);

    // Tax query in Taglish
    const res3 = await IntentRouter.routeIntent('Magkano VAT ko under 2550Q?', provider, userSkills);
    expect(['taxQuery', 'explainComplianceRule']).toContain(res3.skillId);

    // Compliance / Anomaly query in Taglish
    const res4 = await IntentRouter.routeIntent('May problema ba sa books ko?', provider, userSkills);
    expect(['complianceQuery', 'anomalyDetectionQuery', 'explainComplianceRule']).toContain(res4.skillId);

    // Tax filing deadline query
    const res5 = await IntentRouter.routeIntent('Kailan deadline ng filing?', provider, userSkills);
    expect(['taxRemindersQuery', 'explainComplianceRule', 'taxQuery']).toContain(res5.skillId);
  });

  test('2. Mutation Pre-check and Action Confirmation Gate', async () => {
    const userSkills = skillRegistry.listSkills().map(s => s.id);
    
    // High-risk deletion intent
    const res = await IntentRouter.routeIntent('Delete transaction INV-2026-001', provider, userSkills);
    expect(res.skillId).toBe('requestActionConfirmation');
    expect(res.pendingAction).toBeDefined();
    expect(res.pendingAction?.riskLevel).toBe('HIGH_MUTATION');
  });

  test('3. Analytics Engine computes monthly trend and margins', async () => {
    await runInTestDb(async () => {
      const analytics = await AnalyticsEngine.getFinancialAnalytics(companyId, 3);
      expect(analytics.companyId).toBe(companyId);
      expect(Array.isArray(analytics.trends.monthly)).toBe(true);
      expect(analytics.trends.monthly.length).toBe(3);
    });
  });

  test('4. Compliance Rule Engine evaluates statutory rules', async () => {
    await runInTestDb(async () => {
      const complianceReport = await ComplianceRuleEngine.evaluateAll(companyId);
      expect(complianceReport.companyId).toBe(companyId);
      expect(typeof complianceReport.summary.healthScore).toBe('number');
      expect(Array.isArray(complianceReport.statutoryChecklist)).toBe(true);
    });
  });

  test('5. AI Cost Controller rate limiting and caching', () => {
    const cacheKey = AICostController.getCacheKey(companyId, 'OWNER', 'testSkill', 'testPrompt');
    AICostController.setCachedResponse(cacheKey, { test: 'data' }, 5000);
    
    const cached = AICostController.getCachedResponse<any>(cacheKey);
    expect(cached).toEqual({ test: 'data' });

    AICostController.invalidateCompanyCache(companyId);
    const afterInvalidate = AICostController.getCachedResponse<any>(cacheKey);
    expect(afterInvalidate).toBeNull();
  });
});
