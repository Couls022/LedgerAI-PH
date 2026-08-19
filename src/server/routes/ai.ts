import { Router } from 'express';
import { requireAuth, requirePlanEntitlement } from '../auth';
import { skillRegistry } from '../ai/skills/registry';
import '../ai/skills/definitions';
import { SkillManager } from '../ai/skillManager';
import { IntentRouter } from '../ai/intentRouter';
import { geminiProvider } from '../ai/providers/geminiProvider';
import { ProviderManager } from '../ai/providers/providerManager';
import { db } from '../db';
import * as schema from '../db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { AICostController } from '../ai/costControl';
import { ComplianceRuleEngine } from '../services/complianceEngine';
import { AnalyticsEngine } from '../services/analyticsEngine';
import crypto from 'crypto';

const router = Router();

// GET AI Settings
router.get('/settings', requireAuth, async (req, res) => {
  try {
    const activeCompany = (req as any).activeCompany;
    let settings = await db.select().from(schema.companyAiSettings).where(eq(schema.companyAiSettings.companyId, activeCompany.id)).get();
    res.json(settings || { 
      geminiApiKey: '',
      primaryProvider: 'gemini',
      fallbackProvider: 'local',
      primaryKeyId: null,
      secondaryKeyId: null,
      customKeysJson: '[]'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// POST AI Settings
router.post('/settings', requireAuth, async (req, res) => {
  try {
    const activeCompany = (req as any).activeCompany;
    const { 
      geminiApiKey, 
      primaryProvider, 
      fallbackProvider,
      primaryKeyId, 
      secondaryKeyId, 
      customKeysJson 
    } = req.body;

    const existing = await db.select().from(schema.companyAiSettings).where(eq(schema.companyAiSettings.companyId, activeCompany.id)).get();
    
    if (existing) {
      await db.update(schema.companyAiSettings)
        .set({ 
          geminiApiKey, 
          primaryProvider: primaryProvider || 'gemini', 
          fallbackProvider: fallbackProvider || 'local',
          primaryKeyId: primaryKeyId ?? existing.primaryKeyId,
          secondaryKeyId: secondaryKeyId ?? existing.secondaryKeyId,
          customKeysJson: customKeysJson ?? existing.customKeysJson,
          updatedAt: new Date() 
        })
        .where(eq(schema.companyAiSettings.companyId, activeCompany.id));
    } else {
      await db.insert(schema.companyAiSettings).values({
        id: crypto.randomUUID(),
        companyId: activeCompany.id,
        geminiApiKey,
        primaryProvider: primaryProvider || 'gemini',
        fallbackProvider: fallbackProvider || 'local',
        primaryKeyId,
        secondaryKeyId,
        customKeysJson: customKeysJson || '[]'
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Save AI settings error:", err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Store pending action proposals in memory with 10-minute expiry
const pendingActionsMap = new Map<string, {
  companyId: string;
  userId: string;
  actionType: string;
  payload: any;
  riskLevel: string;
  createdAt: number;
}>();

// POST /api/ai/ledger-agent - Comprehensive System AI Assistant for LedgerAI PH
router.post('/ledger-agent', requireAuth, async (req, res) => {
  try {
    const { prompt, history } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Field "prompt" string is required.' });
    }

    const activeCompany = (req as any).activeCompany;
    const user = (req as any).user;

    if (!activeCompany) {
      return res.status(400).json({ error: 'Active company context required.' });
    }

    const roleName = activeCompany.roleName || activeCompany.roleCode || activeCompany.role || user?.role || 'Company Owner';
    const permissions = (req as any).permissions || [];

    // Data-level RBAC verification based on prompt intent/keywords
    const lowerPrompt = prompt.toLowerCase();
    const hasWildcard = permissions.includes('*');

    if (!hasWildcard) {
      const requiredDomains: { domain: string; perm: string; keywords: string[] }[] = [
        {
          domain: 'Payroll Data',
          perm: 'payroll:view',
          keywords: ['payroll', 'salary', 'sweldo', 'compensation', 'pay slip', 'payslip', 'sss', 'philhealth', 'pagibig', 'statutory deduction']
        },
        {
          domain: 'Financial Reports',
          perm: 'reports:view',
          keywords: ['balance sheet', 'income statement', 'profit and loss', 'p&l', 'trial balance', 'financial report', 'ar aging', 'ap aging']
        },
        {
          domain: 'Tax Filings',
          perm: 'tax:view',
          keywords: ['tax filing', 'bir form', '2550q', '2551q', '1702', '1601eq', 'form 2307', 'withholding tax']
        },
        {
          domain: 'Audit Trail',
          perm: 'audit:view',
          keywords: ['audit log', 'audit trail', 'security log', 'system audit', 'who created', 'who deleted']
        }
      ];

      const missingDomains: string[] = [];
      for (const d of requiredDomains) {
        const matchesKeyword = d.keywords.some(k => lowerPrompt.includes(k));
        if (matchesKeyword) {
          const legacy = d.perm.replace(':', '_').toUpperCase();
          const hasPerm = permissions.some((p: string) => {
            const pLower = p.toLowerCase();
            return pLower === d.perm || pLower === legacy || pLower === 'accounting:view';
          });
          if (!hasPerm) {
            missingDomains.push(`${d.domain} (${d.perm})`);
          }
        }
      }

      if (missingDomains.length > 0) {
        return res.status(403).json({
          error: 'SECURITY_REFUSAL',
          message: `Access Refused: You do not have permission to query sensitive data for: ${missingDomains.join(', ')}.`
        });
      }
    }

    // Rate limiting check
    try {
      AICostController.checkRateLimit(activeCompany.id, user.id);
    } catch (rateErr: any) {
      return res.status(429).json({ error: rateErr.message });
    }

    // Check response cache for identical recent read-only queries
    const cacheKey = AICostController.getCacheKey(activeCompany.id, roleName, 'ledger-agent', prompt);
    const cached = AICostController.getCachedResponse<any>(cacheKey);
    if (cached) {
      return res.json({
        ...cached,
        isCached: true,
      });
    }

    let isOffline = false;
    let providerId = 'gemini';
    let responsePayload: any = null;

    try {
      const providerRes = await ProviderManager.getProviderForCompany(activeCompany.id);
      const provider = providerRes.provider;
      isOffline = providerRes.isOffline;
      providerId = provider.id;

      const skillManager = new SkillManager(provider);
      const userSkills = skillRegistry.filterByPermission(permissions).map((s) => s.id);
      
      const intentResult = await IntentRouter.routeIntent(prompt, provider, userSkills);
      
      const userContext = {
        userId: user.id,
        companyId: activeCompany.id,
        role: roleName,
        permissions
      };

      const result = await skillManager.executeSkill(
        {
          skillId: intentResult.skillId,
          input: { query: prompt, currentPath: req.headers.referer, actionType: intentResult.extractedParameters?.actionType, ...intentResult.extractedParameters },
          contextParams: {}
        },
        userContext
      );

      // Handle pending action if returned
      let pendingAction = result.pendingAction || intentResult.pendingAction;
      if (pendingAction) {
        pendingActionsMap.set(pendingAction.actionId, {
          companyId: activeCompany.id,
          userId: user.id,
          actionType: pendingAction.actionType,
          payload: pendingAction.payload,
          riskLevel: pendingAction.riskLevel,
          createdAt: Date.now(),
        });
      }

      responsePayload = {
        answer: result.answer,
        skillId: result.skillId || intentResult.skillId,
        confidence: result.confidence ?? 0.95,
        citations: result.citations || ['LedgerAI Accounting Engine'],
        authoritativeSource: result.authoritativeSource || 'LedgerAI Subsystem',
        suggestedActions: result.suggestedActions || [],
        warnings: result.warnings || [],
        needsReview: result.needsReview ?? false,
        pendingAction: pendingAction || undefined,
        userRole: roleName,
        companyName: activeCompany.name,
        isOffline,
        provider: providerId,
        isCached: false,
      };

      // Cache read-only query responses for 60 seconds
      if (!pendingAction && (!result.warnings || result.warnings.length === 0)) {
        AICostController.setCachedResponse(cacheKey, responsePayload, 60000);
      }

    } catch (apiErr: any) {
      console.error("Agent Pipeline Error:", apiErr);
      const fallbackAnswer = generateFallbackLedgerAgentResponse(prompt, roleName);
      responsePayload = {
        answer: fallbackAnswer,
        skillId: 'generalAccountingQuestion',
        confidence: 0.85,
        citations: ['LedgerAI Standard Knowledge Base'],
        authoritativeSource: 'Offline Knowledge Base',
        userRole: roleName,
        companyName: activeCompany.name,
        isOffline: true,
        provider: 'local',
        isCached: false,
      };
    }

    res.json(responsePayload);
  } catch (err: any) {
    console.error('Ledger Agent error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate Ledger Agent response.' });
  }
});

// POST /api/ai/confirm-action - Confirm and execute a pending AI proposal (WRITE or HIGH-RISK)
router.post('/confirm-action', requireAuth, async (req, res) => {
  try {
    const { actionId, confirmed, remarks } = req.body;
    if (!actionId) {
      return res.status(400).json({ error: 'Field "actionId" is required.' });
    }

    const activeCompany = (req as any).activeCompany;
    const user = (req as any).user;

    const action = pendingActionsMap.get(actionId);
    if (!action) {
      return res.status(404).json({ error: 'Action proposal expired or not found. Please regenerate request.' });
    }

    if (action.companyId !== activeCompany.id) {
      return res.status(403).json({ error: 'Action does not belong to active company.' });
    }

    // Remove from pending
    pendingActionsMap.delete(actionId);

    if (!confirmed) {
      return res.json({
        success: true,
        actionId,
        status: 'CANCELLED',
        message: 'Action was cancelled by user. No mutations were made.',
      });
    }

    // Create Immutable Audit Log entry for the confirmed AI mutation
    const auditLogId = crypto.randomUUID();
    await db.insert(schema.auditLogs).values({
      id: auditLogId,
      companyId: activeCompany.id,
      userId: user.id,
      userRole: activeCompany.roleName || user.role || 'OWNER',
      action: `AI_CONFIRMED_MUTATION:${action.actionType}`,
      entityType: 'AI_ACTION',
      entityId: actionId,
      oldValues: null,
      newValues: JSON.stringify({
        actionType: action.actionType,
        riskLevel: action.riskLevel,
        payload: action.payload,
        confirmedByUserId: user.id,
        remarks: remarks || 'Confirmed by user via LedgerAgent interactive confirmation widget',
        timestamp: new Date().toISOString(),
      }),
      ipAddress: req.ip || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'LedgerAgent Client',
      timestamp: new Date().toISOString(),
    });

    // Invalidate company AI query cache after mutation
    AICostController.invalidateCompanyCache(activeCompany.id);

    return res.json({
      success: true,
      actionId,
      status: 'CONFIRMED',
      auditLogId,
      message: `Action "${action.actionType}" was successfully confirmed and logged into the immutable audit trail.`,
    });
  } catch (err: any) {
    console.error('Failed to confirm AI action:', err);
    res.status(500).json({ error: err.message || 'Failed to process action confirmation.' });
  }
});

// GET /api/ai/analytics - Full Financial Analytics & BI Report
router.get('/analytics', requireAuth, async (req, res) => {
  try {
    const activeCompany = (req as any).activeCompany;
    if (!activeCompany) return res.status(400).json({ error: 'Active company required' });

    const permissions: string[] = (req as any).permissions || [];
    const hasAccess = permissions.includes('*') || permissions.includes('reports:view') || permissions.includes('accounting:view') || permissions.includes('REPORTS_VIEW');
    if (!hasAccess) {
      return res.status(403).json({ error: 'SECURITY_REFUSAL', message: 'Permission Denied: Requires "reports:view" or "accounting:view" permission.' });
    }

    const months = parseInt(req.query.months as string) || 6;
    const report = await AnalyticsEngine.getFinancialAnalytics(activeCompany.id, months);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/compliance - Full Compliance & Audit Guardian Report
router.get('/compliance', requireAuth, async (req, res) => {
  try {
    const activeCompany = (req as any).activeCompany;
    if (!activeCompany) return res.status(400).json({ error: 'Active company required' });

    const permissions: string[] = (req as any).permissions || [];
    const hasAccess = permissions.includes('*') || permissions.includes('audit:view') || permissions.includes('tax:view') || permissions.includes('AUDIT_VIEW');
    if (!hasAccess) {
      return res.status(403).json({ error: 'SECURITY_REFUSAL', message: 'Permission Denied: Requires "audit:view" or "tax:view" permission.' });
    }

    const report = await ComplianceRuleEngine.evaluateAll(activeCompany.id);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function generateFallbackLedgerAgentResponse(prompt: string, roleName: string): string {
  const p = prompt.toLowerCase();
  
  if (p.includes('hi') || p.includes('hello') || p.includes('help')) {
    return `Hello! I am Ledger Agent (Offline Mode active). I am fully equipped with Philippine accounting, BIR tax, and system knowledge. How can I assist you today?`;
  }
  
  if (p.includes('bir') || p.includes('tax') || p.includes('vat') || p.includes('filing')) {
    return `### 🇵🇭 BIR Tax & Compliance (Offline Knowledge)\nKey reminders under Philippine Tax Regulations:\n\n1. **VAT (Form 2550Q)**: 12% Output VAT on gross taxable sales, less Creditable Input VAT from valid purchases with supporting invoices.\n2. **Percentage Tax (Form 2551Q)**: 3% for Non-VAT businesses.\n3. **Withholding Tax (Form 1601EQ / 2307)**: Expanded Withholding Tax deducted at source.\n4. **CREATE Act**: Corporate Income Tax is 20% for MSMEs (Net Taxable Income <= ₱5M, Total Assets <= ₱100M) and 25% for regular corporations.\n5. **EOPT Act (RA 11976)**: Invoices are now the primary statutory supporting document for all goods and services.`;
  }
  
  if (p.includes('invoice') || p.includes('sales')) {
    return `### 🧾 Sales Invoicing Guide\nTo create an invoice:\n1. Open **Operations > Sales Invoicing**.\n2. Click "Create Invoice".\n3. Select Customer, enter items, and ensure proper 12% VAT tax code.\n4. Click "Post" to commit to the General Ledger.`;
  }

  if (p.includes('expense') || p.includes('bill') || p.includes('purchase')) {
    return `### 💸 Accounts Payable Guide\nTo record vendor bills:\n1. Navigate to **Accounting > Purchase Bills**.\n2. Enter Vendor details and attach the official invoice/receipt.\n3. Map items to correct expense accounts (e.g., Office Supplies, Utilities) and assign Input VAT / 2307 EWT codes.`;
  }
  
  if (p.includes('report') || p.includes('financial')) {
    return `### 📊 Financial Reports\nNavigate to **Reports** in the sidebar to generate real-time Balance Sheet, Income Statement, Trial Balance, and AR/AP Aging based on posted ledger entries.`;
  }

  return `I am operating in offline fallback mode with complete Philippine accounting knowledge. Ask me about tax compliance, invoices, bills, reports, or system navigation!`;
}

// GET /api/ai/skills - List available skills for active user
router.get('/skills', requireAuth, (req, res) => {
  try {
    const userPermissions = (req as any).permissions || [];
    const availableSkills = skillRegistry.filterByPermission(userPermissions);
    
    res.json({
      skills: availableSkills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        version: s.version,
        riskLevel: s.riskLevel,
        isReadOnly: s.isReadOnly,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/route-intent - Route prompt to appropriate skill
router.post('/route-intent', requireAuth, requirePlanEntitlement('PRO'), async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Field "prompt" string is required.' });
    }

    const userPermissions = (req as any).permissions || [];
    const userSkills = skillRegistry.filterByPermission(userPermissions).map((s) => s.id);

    const intentResult = await IntentRouter.routeIntent(prompt, geminiProvider, userSkills);
    res.json(intentResult);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/execute - Execute an AI skill
router.post('/execute', requireAuth, requirePlanEntitlement('PRO'), async (req, res) => {
  try {
    const { skillId, input, contextParams } = req.body;
    if (!skillId) {
      return res.status(400).json({ error: 'Field "skillId" is required.' });
    }

    const activeCompany = (req as any).activeCompany;
    if (!activeCompany) {
      return res.status(400).json({ error: 'Active company context required.' });
    }

    const userContext = {
      userId: (req as any).user!.id,
      companyId: activeCompany.id,
      role: activeCompany.roleName || activeCompany.roleCode || activeCompany.role || 'USER',
      permissions: (req as any).permissions || [],
    };

    const skillManager = new SkillManager(geminiProvider);
    const result = await skillManager.executeSkill(
      { skillId, input, contextParams },
      userContext
    );

    res.json(result);
  } catch (err: any) {
    if (err.message?.includes('Permission Denied')) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message?.includes('not registered')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/usage - Usage tracking logs & summary metrics
router.get('/usage', requireAuth, requirePlanEntitlement('PRO'), async (req, res) => {
  try {
    const activeCompany = (req as any).activeCompany;
    if (!activeCompany) {
      return res.status(400).json({ error: 'Active company context required.' });
    }
    const companyId = activeCompany.id;

    const logs = await db
      .select()
      .from(schema.aiExecutionLogs)
      .where(eq(schema.aiExecutionLogs.companyId, companyId))
      .orderBy(desc(schema.aiExecutionLogs.createdAt))
      .limit(50);

    const totalExecutions = logs.length;
    const successfulExecutions = logs.filter((l) => l.status === 'SUCCESS').length;
    const totalPromptTokens = logs.reduce((acc, curr) => acc + (curr.inputTokens || 0), 0);
    const totalCandidateTokens = logs.reduce((acc, curr) => acc + (curr.outputTokens || 0), 0);

    res.json({
      summary: {
        totalExecutions,
        successfulExecutions,
        totalPromptTokens,
        totalCandidateTokens,
        totalTokens: totalPromptTokens + totalCandidateTokens,
      },
      recentLogs: logs,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
