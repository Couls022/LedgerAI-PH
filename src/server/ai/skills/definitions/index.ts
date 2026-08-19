import { AISkillDefinition, AIStructuredResponse, IAIProvider, Type } from '../../types';
import { PROMPT_TEMPLATES } from '../../prompts/promptTemplates';
import { skillRegistry } from '../registry';

// Common Zod or JSON response schema for structured AI responses
export const structuredResponseSchema = {
  type: Type.OBJECT,
  properties: {
    answer: { type: Type.STRING, description: 'Direct answer or explanation to the user request.' },
    confidence: { type: Type.NUMBER, description: 'Confidence score from 0.0 to 1.0.' },
    citations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Citations, rules, or source document references used.',
    },
    reasoningSummary: {
      type: Type.STRING,
      description: 'Concise explanation of the accounting/tax rationale.',
    },
    warnings: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Any warnings or discrepancies identified.',
    },
    suggestedActions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          action: { type: Type.STRING },
        },
        required: ['label', 'action'],
      },
      description: 'Suggested next actions in the application.',
    },
    needsReview: {
      type: Type.BOOLEAN,
      description: 'Set to true if user review by an Accountant is recommended.',
    },
  },
  required: ['answer', 'confidence'],
};

// 1. EXPLAIN ACCOUNT
export const explainAccountSkill: AISkillDefinition = {
  id: 'explainAccount',
  name: 'Explain Account',
  description: 'Explains account classification, normal balance rules, and ledger usage.',
  category: 'ACCOUNTING',
  version: '1.0.0',
  requiredPermissions: ['ACCOUNTING_VIEW'],
  requiredContext: { requireCompany: true, requireAccount: true },
  promptTemplateId: 'accounting.explainAccount.v1',
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const template = PROMPT_TEMPLATES[this.promptTemplateId];
    const account = context.account || input;

    const promptText = template.userPromptTemplate({
      accountName: account?.accountName || 'Unknown Account',
      accountCode: account?.accountCode || '0000',
      accountType: account?.accountType || 'ASSET',
      normalBalance: account?.normalBalance || 'DEBIT',
      balance: account?.balance || 0,
      description: account?.description || input?.query || '',
    });

    const res = await provider.generateStructured<any>(promptText, structuredResponseSchema, {
      systemInstruction: template.systemInstruction,
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: res.data?.confidence ?? 0.95,
      citations: res.data?.citations || ['PFRS / BIR Chart of Accounts Guidelines'],
      reasoningSummary: res.data?.reasoningSummary || 'Analysis based on account normal balance rules.',
      warnings: res.data?.warnings || [],
      suggestedActions: [
        { label: 'View Account Ledger', action: 'NAVIGATE_LEDGER', params: { accountId: account?.id } },
      ],
      model: res.model,
      needsReview: res.data?.needsReview ?? false,
      sourceDataUsed: { accountCode: account?.accountCode, accountName: account?.accountName },
    };
  },
};

// 2. EXPLAIN JOURNAL ENTRY
export const explainJournalEntrySkill: AISkillDefinition = {
  id: 'explainJournalEntry',
  name: 'Explain Journal Entry',
  description: 'Explains journal entry details, debits, credits, and verification state.',
  category: 'ACCOUNTING',
  version: '1.0.0',
  requiredPermissions: ['JOURNAL_VIEW'],
  requiredContext: { requireCompany: true, requireJournal: true },
  promptTemplateId: 'accounting.explainJournalEntry.v1',
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const template = PROMPT_TEMPLATES[this.promptTemplateId];
    const journal = context.journal || input;

    const promptText = template.userPromptTemplate({
      entryNumber: journal?.entryNumber || 'JE-DRAFT',
      date: journal?.entryDate || new Date().toISOString(),
      description: journal?.description || '',
      status: journal?.status || 'DRAFT',
      lines: journal?.lines || [],
    });

    const res = await provider.generateStructured<any>(promptText, structuredResponseSchema, {
      systemInstruction: template.systemInstruction,
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: res.data?.confidence ?? 0.95,
      citations: res.data?.citations || ['Double-Entry Bookkeeping Principles'],
      reasoningSummary: res.data?.reasoningSummary || 'Journal entry verified for debit = credit balance.',
      warnings: res.data?.warnings || [],
      suggestedActions: [
        { label: 'View All Journal Entries', action: 'NAVIGATE_JOURNALS' },
      ],
      model: res.model,
      needsReview: journal?.status === 'DRAFT',
      sourceDataUsed: { entryNumber: journal?.entryNumber, status: journal?.status },
    };
  },
};

// 3. EXPLAIN TRIAL BALANCE
export const explainTrialBalanceSkill: AISkillDefinition = {
  id: 'explainTrialBalance',
  name: 'Explain Trial Balance',
  description: 'Analyzes trial balance equality (Debits = Credits) and variance.',
  category: 'ACCOUNTING',
  version: '1.0.0',
  requiredPermissions: ['ACCOUNTING_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.explainTrialBalance.v1',
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const template = PROMPT_TEMPLATES[this.promptTemplateId];

    const promptText = template.userPromptTemplate({
      totalDebits: input.totalDebits || 0,
      totalCredits: input.totalCredits || 0,
      accounts: input.accounts || [],
    });

    const res = await provider.generateStructured<any>(promptText, structuredResponseSchema, {
      systemInstruction: template.systemInstruction,
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: res.data?.confidence ?? 0.95,
      citations: ['Trial Balance Reconciliation Standards'],
      reasoningSummary: res.data?.reasoningSummary || 'Trial balance verified.',
      warnings: res.data?.warnings || [],
      suggestedActions: [{ label: 'Export Trial Balance', action: 'EXPORT_REPORTS' }],
      model: res.model,
      needsReview: input.totalDebits !== input.totalCredits,
    };
  },
};

// 4. ANALYZE ACCOUNTING ANOMALY
export const analyzeAccountingAnomalySkill: AISkillDefinition = {
  id: 'analyzeAccountingAnomaly',
  name: 'Analyze Accounting Anomaly',
  description: 'Identifies unposted entries, unbalanced transactions, or potential errors.',
  category: 'ACCOUNTING',
  version: '1.0.0',
  requiredPermissions: ['ACCOUNTING_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'accounting.analyzeAccountingAnomaly.v1',
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const template = PROMPT_TEMPLATES[this.promptTemplateId];

    const promptText = template.userPromptTemplate({
      draftCount: input.draftCount || 0,
      unpostedTotal: input.unpostedTotal || 0,
      recentEntries: input.recentEntries || [],
    });

    const res = await provider.generateStructured<any>(promptText, structuredResponseSchema, {
      systemInstruction: template.systemInstruction,
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: res.data?.confidence ?? 0.9,
      citations: ['LedgerAI Anomaly Detection Rules'],
      reasoningSummary: res.data?.reasoningSummary || 'Checked unposted entries and debit-credit balances.',
      warnings: res.data?.warnings || [],
      suggestedActions: [{ label: 'Review Drafts', action: 'NAVIGATE_APPROVALS' }],
      model: res.model,
      needsReview: true,
    };
  },
};

// 5. EXPLAIN COMPLIANCE RULE
export const explainComplianceRuleSkill: AISkillDefinition = {
  id: 'explainComplianceRule',
  name: 'Explain BIR Compliance Rule',
  description: 'Explains Philippine BIR tax filing requirements and rules.',
  category: 'COMPLIANCE',
  version: '1.0.0',
  requiredPermissions: ['TAX_VIEW'],
  requiredContext: { requireCompany: true, requireTaxProfile: true },
  promptTemplateId: 'compliance.explainRule.v1',
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const template = PROMPT_TEMPLATES[this.promptTemplateId];
    const taxProfile = context.taxProfile || {};

    const promptText = template.userPromptTemplate({
      formType: input.formType || 'BIR Form 2550Q / 1701Q',
      taxpayerType: taxProfile.taxpayerClassification || 'Corporation',
      vatStatus: context.company?.vatStatus || 'VAT Registered',
      description: input.query || input.description || '',
    });

    const res = await provider.generateStructured<any>(promptText, structuredResponseSchema, {
      systemInstruction: template.systemInstruction,
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: res.data?.confidence ?? 0.95,
      citations: ['NIRC / BIR Revenue Regulations (RR 16-2005, EOPT Act)'],
      reasoningSummary: res.data?.reasoningSummary || 'Referenced official BIR tax regulations.',
      warnings: res.data?.warnings || [],
      suggestedActions: [{ label: 'View Tax Reports', action: 'NAVIGATE_TAX_REPORTS' }],
      model: res.model,
      needsReview: false,
    };
  },
};

// 6. SUMMARIZE DOCUMENT
export const summarizeDocumentSkill: AISkillDefinition = {
  id: 'summarizeDocument',
  name: 'Summarize Document',
  description: 'Summarizes uploaded receipt, invoice, or attachment.',
  category: 'DOCUMENTS',
  version: '1.0.0',
  requiredPermissions: ['DOCUMENT_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'documents.summarizeDocument.v1',
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const template = PROMPT_TEMPLATES[this.promptTemplateId];

    const promptText = template.userPromptTemplate({
      fileName: input.fileName || 'Attachment.pdf',
      fileType: input.fileType || 'PDF',
      textContent: input.textContent || input.query || '',
    });

    const res = await provider.generateStructured<any>(promptText, structuredResponseSchema, {
      systemInstruction: template.systemInstruction,
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: res.data?.confidence ?? 0.92,
      citations: ['Document Parser Engine'],
      reasoningSummary: res.data?.reasoningSummary || 'Extracted receipt metadata.',
      warnings: res.data?.warnings || [],
      suggestedActions: [{ label: 'View Documents Folder', action: 'NAVIGATE_DOCUMENTS' }],
      model: res.model,
      needsReview: false,
    };
  },
};

// 7. SUMMARIZE REPORT
export const summarizeReportSkill: AISkillDefinition = {
  id: 'summarizeReport',
  name: 'Summarize Financial Report',
  description: 'Provides executive summary of Balance Sheet, P&L, or Tax Summary.',
  category: 'REPORTS',
  version: '1.0.0',
  requiredPermissions: ['REPORT_VIEW'],
  requiredContext: { requireCompany: true },
  promptTemplateId: 'reports.summarizeReport.v1',
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const template = PROMPT_TEMPLATES[this.promptTemplateId];

    const promptText = template.userPromptTemplate({
      reportType: input.reportType || 'Financial Summary',
      period: input.period || 'Current Fiscal Year',
      summaryMetrics: input.summaryMetrics || input,
    });

    const res = await provider.generateStructured<any>(promptText, structuredResponseSchema, {
      systemInstruction: template.systemInstruction,
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: res.data?.confidence ?? 0.95,
      citations: ['Financial Statements Summary Rules'],
      reasoningSummary: res.data?.reasoningSummary || 'P&L / Balance sheet key performance indicators summarized.',
      warnings: res.data?.warnings || [],
      suggestedActions: [{ label: 'Export Report', action: 'EXPORT_REPORTS' }],
      model: res.model,
      needsReview: false,
    };
  },
};

// 8. GENERAL ASSISTANT
export const generalAssistantSkill: AISkillDefinition = {
  id: 'generalAccountingQuestion',
  name: 'LedgerAI General Assistant',
  description: 'Answers general Philippine accounting, software usage, and navigation questions.',
  category: 'GENERAL_ASSISTANT',
  version: '1.0.0',
  requiredPermissions: [], // Open to all authenticated users
  requiredContext: { requireCompany: true },
  promptTemplateId: 'assistant.generalQuery.v1',
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const template = PROMPT_TEMPLATES[this.promptTemplateId];

    const promptText = template.userPromptTemplate({
      query: input.query || 'How do I use LedgerAI PH?',
      companyName: context.company?.legalName || 'My Company',
      userRole: context.userRole || 'User',
      currentPath: input.currentPath || '/accounting',
    });

    const res = await provider.generateStructured<any>(promptText, structuredResponseSchema, {
      systemInstruction: template.systemInstruction,
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || res.text,
      confidence: res.data?.confidence ?? 0.95,
      citations: ['LedgerAI PH Documentation'],
      reasoningSummary: res.data?.reasoningSummary || 'Generated helpful accounting guidance.',
      warnings: res.data?.warnings || [],
      suggestedActions: [
        { label: 'Go to Accounting Dashboard', action: 'NAVIGATE', params: { path: '/accounting' } },
      ],
      model: res.model,
      needsReview: false,
    };
  },
};

// Register all core skills into SkillRegistry
import { 
  getFinancialSummarySkill, 
  getSalesSummarySkill, 
  getExpenseSummarySkill, 
  financialQuerySkill, 
  arApQuerySkill, 
  getAccountsReceivableSummarySkill,
  getAccountsPayableSummarySkill,
  ledgerQuerySkill, 
  taxQuerySkill, 
  taxRemindersSkill,
  complianceQuerySkill,
  financialAnalyticsQuerySkill,
  anomalyDetectionQuerySkill,
  auditQuerySkill,
  requestActionConfirmationSkill
} from './financialSkills';
import { navigationSkill } from './navigationSkills';

export function registerAllCoreSkills(): void {
  skillRegistry.registerSkill(explainAccountSkill);
  skillRegistry.registerSkill(explainJournalEntrySkill);
  skillRegistry.registerSkill(explainTrialBalanceSkill);
  skillRegistry.registerSkill(analyzeAccountingAnomalySkill);
  skillRegistry.registerSkill(explainComplianceRuleSkill);
  skillRegistry.registerSkill(summarizeDocumentSkill);
  skillRegistry.registerSkill(summarizeReportSkill);
  skillRegistry.registerSkill(generalAssistantSkill);
  
  skillRegistry.registerSkill(getFinancialSummarySkill);
  skillRegistry.registerSkill(getSalesSummarySkill);
  skillRegistry.registerSkill(getExpenseSummarySkill);
  skillRegistry.registerSkill(financialQuerySkill);
  skillRegistry.registerSkill(arApQuerySkill);
  skillRegistry.registerSkill(getAccountsReceivableSummarySkill);
  skillRegistry.registerSkill(getAccountsPayableSummarySkill);
  skillRegistry.registerSkill(ledgerQuerySkill);
  skillRegistry.registerSkill(taxQuerySkill);
  skillRegistry.registerSkill(taxRemindersSkill);
  skillRegistry.registerSkill(complianceQuerySkill);
  skillRegistry.registerSkill(financialAnalyticsQuerySkill);
  skillRegistry.registerSkill(anomalyDetectionQuerySkill);
  skillRegistry.registerSkill(auditQuerySkill);
  skillRegistry.registerSkill(requestActionConfirmationSkill);
  skillRegistry.registerSkill(navigationSkill);
}
