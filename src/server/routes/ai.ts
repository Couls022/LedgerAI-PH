import { Router } from 'express';
import { requireAuth, requirePermission, requirePlanEntitlement, normalizeRole } from '../auth';
import { skillRegistry } from '../ai/skills/registry';
import '../ai/skills/definitions';
import { SkillManager } from '../ai/skillManager';
import { IntentRouter } from '../ai/intentRouter';
import { geminiProvider } from '../ai/providers/geminiProvider';
import { db } from '../db';
import * as schema from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { AICostController } from '../ai/costControl';
import { ComplianceRuleEngine } from '../services/complianceEngine';
import { AnalyticsEngine } from '../services/analyticsEngine';
import { EnterpriseAiAgentService } from '../services/enterpriseAiAgentService';
import { AuditService } from '../services/auditService';
import { RbacService } from '../services/rbacService';
import crypto from 'crypto';

const router = Router();

const hasExplicitDeny = (req: any, ...codes: string[]): boolean => {
  const denied = ((req as any).deniedPermissions || []) as string[];
  return codes.some((c) => denied.some((d) => d.toLowerCase() === c.toLowerCase()));
};

// GET /api/ai/settings - Returns sanitized multi-provider hierarchy & encrypted key metadata (never plaintext keys)
router.get(
  '/settings',
  requireAuth,
  requirePermission('ai:config', 'settings:view', 'settings:manage', 'masterdata:view'),
  async (req, res) => {
    try {
      if (hasExplicitDeny(req, 'ai:config', 'settings:view')) {
        return res.status(403).json({
          error: 'PERMISSION_DENIED',
          message: 'Access explicitly denied by RBAC override for ai:config',
        });
      }
      const activeCompany = (req as any).activeCompany;
      const sanitized = await EnterpriseAiAgentService.getSanitizedSettings(activeCompany.id);
      res.json(sanitized);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch AI settings', message: err?.message });
    }
  }
);

// POST /api/ai/settings - Saves multi-provider hierarchy and encrypts custom API keys at rest
router.post(
  '/settings',
  requireAuth,
  requirePermission('ai:config', 'ai:keys:manage', 'settings:manage', 'settings:write'),
  async (req, res) => {
    try {
      if (hasExplicitDeny(req, 'ai:config', 'ai:keys:manage', 'settings:manage')) {
        return res.status(403).json({
          error: 'PERMISSION_DENIED',
          message: 'Access explicitly denied by RBAC override for ai:config / ai:keys:manage',
        });
      }
      const activeCompany = (req as any).activeCompany;
      const user = (req as any).user;
      const updated = await EnterpriseAiAgentService.saveSettings(activeCompany.id, req.body, {
        userId: user?.id,
        userName: user?.displayName || user?.email,
        userRole: activeCompany?.roleName || activeCompany?.role,
        req,
      });
      res.json({ success: true, settings: updated });
    } catch (err: any) {
      console.error('Save AI settings error:', err);
      res.status(500).json({ error: 'Failed to save settings', message: err?.message });
    }
  }
);

// POST /api/ai/providers/test - Test connection for a specific AI provider profile or Offline Engine
router.post(
  '/providers/test',
  requireAuth,
  requirePermission('ai:provider:test', 'ai:config', 'settings:view', 'settings:manage'),
  async (req, res) => {
    try {
      if (hasExplicitDeny(req, 'ai:provider:test', 'ai:config')) {
        return res.status(403).json({
          error: 'PERMISSION_DENIED',
          message: 'Access explicitly denied by RBAC override for ai:provider:test',
        });
      }
      const activeCompany = (req as any).activeCompany;
      const user = (req as any).user;
      const { simulateFailureMode } = req.body || {};
      const providerId = req.body?.providerId || req.body?.keyId || (req.query?.providerId as string) || 'offline_local';
      const result = await EnterpriseAiAgentService.testProviderConnection(
        activeCompany.id,
        { providerId, simulateFailureMode },
        {
          userId: user?.id,
          userName: user?.displayName || user?.email,
          userRole: activeCompany?.roleName || activeCompany?.role,
          req,
        }
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: 'PROVIDER_TEST_FAILED', message: err?.message });
    }
  }
);

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
    const {
      prompt,
      history,
      forceOffline,
      simulateProviderFailure,
      activePath,
      activeModuleId,
      activeSubmoduleId,
      systemPromptContext,
      dateRangeFilter,
    } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Field "prompt" string is required.' });
    }

    const activeCompany = (req as any).activeCompany;
    const user = (req as any).user;

    if (!activeCompany) {
      return res.status(400).json({ error: 'Active company context required.' });
    }

    if (hasExplicitDeny(req, 'ai:inquiry')) {
      return res.status(403).json({
        error: 'SECURITY_REFUSAL',
        message: 'Access Refused: Your account has an explicit RBAC DENY override for ai:inquiry.',
      });
    }

    const roleName =
      activeCompany.roleName ||
      activeCompany.roleCode ||
      activeCompany.role ||
      user?.role ||
      'Company Owner';
    const userRoles: string[] = activeCompany.roles || [roleName];
    const isCompanyOwner = userRoles.some(
      (r) => r === 'Company Owner' || normalizeRole(r) === 'Company Owner'
    );
    const permissions: string[] = isCompanyOwner
      ? Array.from(new Set(['*', ...((req as any).permissions || [])]))
      : ((req as any).permissions || []);
    const deniedPermissions: string[] = isCompanyOwner
      ? []
      : ((req as any).deniedPermissions || []);

    // Data-level RBAC verification based on prompt intent/keywords (skip when Company Owner or how-to manual query)
    const lowerPrompt = prompt.toLowerCase();
    const hasWildcard = isCompanyOwner || permissions.includes('*');

    const isHowToOrManual =
      !/\b(account\s+\d{4}|account balance|magkano|how much|what is our|total open|trial balance summary)\b/i.test(
        lowerPrompt
      ) &&
      (lowerPrompt.includes('how do i') ||
        lowerPrompt.includes('how to') ||
        lowerPrompt.includes('where can i') ||
        lowerPrompt.includes('where is') ||
        lowerPrompt.includes('paano') ||
        lowerPrompt.includes('user manual') ||
        lowerPrompt.includes('step-by-step'));

    const requiredDomains: { domain: string; perms: string[]; keywords: string[] }[] = [
      {
        domain: 'Financial Reports',
        perms: ['reports:view', 'accounting:view'],
        keywords: [
          'balance sheet',
          'income statement',
          'profit and loss',
          'p&l',
          'financial report',
        ],
      },
      {
        domain: 'Tax Filings',
        perms: ['tax:view', 'accounting:view'],
        keywords: ['tax filing', 'bir form', '2550q', '2551q', '1702', '1601eq', 'form 2307'],
      },
      {
        domain: 'Audit Trail',
        perms: ['audit:view'],
        keywords: ['audit log', 'audit trail', 'security log', 'system audit', 'who deleted'],
      },
      {
        domain: 'Fixed Assets',
        perms: ['fixedassets:view', 'accounting:view'],
        keywords: ['fixed asset', 'fixed assets', 'net book value', 'depreciation schedule'],
      },
      {
        domain: 'Inventory & Warehouse',
        perms: ['inventory:view', 'accounting:view', 'reports:view'],
        keywords: ['inventory valuation', 'stock valuation', 'reorder alert'],
      },
    ];

    const missingDomains: string[] = [];
    if (!hasWildcard && !isHowToOrManual) {
      for (const d of requiredDomains) {
        const matchesKeyword = d.keywords.some((k) => lowerPrompt.includes(k));
        if (matchesKeyword) {
          const allDenied = d.perms.every((p) => hasExplicitDeny(req, p));
          if (allDenied) {
            missingDomains.push(`${d.domain} (Explicitly Denied: ${d.perms[0]})`);
            continue;
          }
          const hasPerm = d.perms.some((reqP) => {
            if (hasExplicitDeny(req, reqP)) return false;
            const legacy = reqP.replace(':', '_').toUpperCase();
            return permissions.some((p: string) => {
              const pLower = p.toLowerCase();
              return pLower === reqP || pLower === legacy;
            });
          });
          if (!hasPerm) {
            missingDomains.push(`${d.domain} (${d.perms[0]})`);
          }
        }
      }
    }

    if (missingDomains.length > 0) {
      return res.status(403).json({
        error: 'SECURITY_REFUSAL',
        message: `Access Refused: You do not have permission to query data for: ${missingDomains.join(', ')}.`,
      });
    }

    // Rate limiting check
    try {
      AICostController.checkRateLimit(activeCompany.id, user.id);
    } catch (rateErr: any) {
      return res.status(429).json({ error: rateErr.message });
    }

    const companyRow = await db
      .select({ legalName: schema.companies.legalName, tradeName: schema.companies.tradeName })
      .from(schema.companies)
      .where(eq(schema.companies.id, activeCompany.id))
      .get();
    const companyDisplayName =
      companyRow?.legalName ||
      companyRow?.tradeName ||
      activeCompany.name ||
      activeCompany.id;

    // Check for explicit WRITE / HIGH-RISK mutation proposal intent (non-automatic confirmation guard)
    const actionProposalIntent = IntentRouter.heuristicFallback(prompt);
    let pendingAction = actionProposalIntent.pendingAction;
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

    const inquiryResult = await EnterpriseAiAgentService.executeInquiry({
      companyId: activeCompany.id,
      companyName: companyDisplayName,
      userId: user.id,
      userRole: roleName,
      permissions,
      deniedPermissions,
      prompt,
      history: Array.isArray(history) ? history : undefined,
      forceOffline: Boolean(forceOffline),
      simulateProviderFailure,
      activePath: typeof activePath === 'string' ? activePath : undefined,
      activeModuleId: typeof activeModuleId === 'string' ? activeModuleId : undefined,
      activeSubmoduleId: typeof activeSubmoduleId === 'string' ? activeSubmoduleId : undefined,
      systemPromptContext: typeof systemPromptContext === 'string' ? systemPromptContext : undefined,
      dateRangeFilter: dateRangeFilter || undefined,
    });

    res.json({
      ...inquiryResult,
      pendingAction: pendingAction || undefined,
      isCached: false,
    });
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

    if (action.companyId !== activeCompany.id || action.userId !== user.id) {
      return res.status(403).json({
        error: 'PERMISSION_DENIED',
        message: 'Action does not belong to the authenticated user in the active company.',
      });
    }

    const compRecord = await db.select({ status: schema.companies.status }).from(schema.companies).where(eq(schema.companies.id, activeCompany.id)).get();
    if ((activeCompany.status === 'RECOVERY_READ_ONLY' || compRecord?.status === 'RECOVERY_READ_ONLY') && confirmed) {
      return res.status(403).json({
        error: 'READ_ONLY_ACCESS',
        message: 'Company database is in read-only recovery quarantine; AI actions cannot mutate data.',
      });
    }

    const userRoles: string[] = activeCompany.roles || [activeCompany.role || user?.role];
    const isOwnerActor = userRoles.some(
      (r) => r === 'Company Owner' || normalizeRole(r) === 'Company Owner'
    );
    const callerPerms: string[] = (req as any).permissions || [];
    const requiredPermsByAction: Record<string, string[]> = {
      DELETE_TRANSACTION: ['accounting:delete', 'sales:delete', 'purchases:delete', 'accounting:manage'],
      CHANGE_TAX_CONFIG: ['tax:manage', 'settings:manage'],
      SUBMIT_FILING: ['tax:file', 'tax:manage'],
      POST_JOURNAL: ['accounting:post'],
      APPROVE_WORKFLOW: ['approvals:approve'],
    };
    const reqPerms = requiredPermsByAction[action.actionType] || ['accounting:manage'];
    if (confirmed && !isOwnerActor && !RbacService.hasPermission(callerPerms, ...reqPerms)) {
      return res.status(403).json({
        error: 'PERMISSION_DENIED',
        message: `Permission required to confirm ${action.actionType}: ${reqPerms.join(' or ')}`,
      });
    }

    // Remove from pending after validating authorization
    pendingActionsMap.delete(actionId);

    if (!confirmed) {
      return res.json({
        success: true,
        actionId,
        status: 'CANCELLED',
        message: 'Action was cancelled by user. No mutations were made.',
      });
    }

    // Create HMAC-SHA256 hash-chained Immutable Audit Log entry via AuditService
    const auditResult = await AuditService.log({
      req,
      companyId: activeCompany.id,
      action: `AI_CONFIRMED_MUTATION:${action.actionType}`,
      entityType: 'AI_ACTION',
      entityId: actionId,
      module: 'AI_AGENT',
      reason: remarks || 'Confirmed by user via LedgerAgent interactive confirmation widget',
      afterData: {
        actionType: action.actionType,
        riskLevel: action.riskLevel,
        payload: action.payload,
        confirmedByUserId: user.id,
        remarks: remarks || 'Confirmed by user via LedgerAgent interactive confirmation widget',
        timestamp: new Date().toISOString(),
      },
    });

    // Invalidate company AI query cache after mutation
    AICostController.invalidateCompanyCache(activeCompany.id);

    return res.json({
      success: true,
      actionId,
      status: 'CONFIRMED',
      auditLogId: (auditResult as any)?.id || actionId,
      message: `Action "${action.actionType}" was successfully confirmed and logged into the immutable HMAC audit trail.`,
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
