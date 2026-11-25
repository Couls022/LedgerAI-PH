import { IntentResult, IAIProvider, AIRiskLevel, AIPendingAction, Type } from './types';
import { skillRegistry } from './skills/registry';

const intentSchema = {
  type: Type.OBJECT,
  properties: {
    intent: { type: Type.STRING, description: 'Brief description of detected user intent' },
    skillId: {
      type: Type.STRING,
      description: 'The target skill ID matching one of: explainAccount, explainJournalEntry, explainTrialBalance, analyzeAccountingAnomaly, explainComplianceRule, summarizeDocument, summarizeReport, getFinancialSummary, financialQuery, arApQuery, ledgerQuery, taxQuery, complianceQuery, financialAnalyticsQuery, anomalyDetectionQuery, taxRemindersQuery, auditQuery, requestActionConfirmation, navigateSystem, generalAccountingQuestion',
    },
    confidence: { type: Type.NUMBER, description: 'Confidence level between 0.0 and 1.0' },
    extractedParameters: {
      type: Type.OBJECT,
      properties: {
        accountCode: { type: Type.STRING },
        journalId: { type: Type.STRING },
        formType: { type: Type.STRING },
        reportType: { type: Type.STRING },
        query: { type: Type.STRING },
        actionType: { type: Type.STRING },
        entityName: { type: Type.STRING },
        period: { type: Type.STRING },
      },
    },
    requiresConfirmation: { type: Type.BOOLEAN },
    riskLevel: { type: Type.STRING, description: 'READ_ONLY, LOW_MUTATION, or HIGH_MUTATION' },
    reasoning: { type: Type.STRING },
  },
  required: ['intent', 'skillId', 'confidence'],
};

export class IntentRouter {
  static async routeIntent(
    prompt: string,
    provider: IAIProvider,
    availableSkillIds?: string[]
  ): Promise<IntentResult> {
    const activeSkills = availableSkillIds || skillRegistry.listSkills().map((s) => s.id);

    // First, check for explicit WRITE or HIGH-RISK mutation requests (action safety)
    const actionCheck = this.checkActionIntent(prompt);
    if (actionCheck) {
      return actionCheck;
    }

    const systemPrompt = `
You are the Intent Router for LedgerAI PH (Philippine AI Accounting, Tax & BI Assistant).
Classify the user prompt (in English, Filipino, or Taglish) into one of the available skill IDs:
Available Skills: ${activeSkills.join(', ')}

Skill mapping guide:
- "Magkano kinita ko?", "Magkano benta?", "Magkano gastos?", "Net income", "Revenue this month", "Profit" -> getFinancialSummary or financialQuery
- "May utang ba si Juan?", "Show unpaid invoices", "Sino may balance due?", "AP/AR aging", "Overdue accounts" -> arApQuery
- "Magkano VAT ko?", "Kailan deadline ng filing?", "How to compute EWT?", "Explain 1702Q CREATE Act", "Percentage tax" -> taxQuery
- "Kailan deadline ng filing?", "Tax calendar", "Upcoming BIR deadlines", "Reminders" -> taxRemindersQuery
- "May problema ba sa books ko?", "May missing receipts ba?", "Check compliance", "Duplicate invoices", "Audit guardian" -> complianceQuery
- "Why did expenses increase?", "Revenue trends", "Customer concentration", "Margin analysis", "Cash flow runway", "BI analytics" -> financialAnalyticsQuery
- "Check for anomalies", "Suspicious transactions", "Abnormal expense spikes" -> anomalyDetectionQuery
- "Summarize receipt", "OCR extraction", "Document status" -> summarizeDocument
- "Trial balance", "Debits equal credits" -> explainTrialBalance
- "Explain account", "Chart of accounts", "Normal balance" -> explainAccount
- "Explain journal entry", "Journal voucher" -> explainJournalEntry
- "Balance sheet", "P&L report", "Income statement" -> summarizeReport
- "Show audit trail", "Who created this?", "Audit logs" -> auditQuery
- System navigation / where to find -> navigateSystem
- General queries -> generalAccountingQuestion

Extract parameters (accountCode, formType, reportType, entityName, period, query).
Confidence: 0.0 to 1.0.
`;

    try {
      if (!(await provider.isAvailable()) || provider.id === 'local') {
        return this.heuristicFallback(prompt);
      }

      const res = await provider.generateStructured<any>(prompt, intentSchema, {
        systemInstruction: systemPrompt,
        temperature: 0.1,
      });

      if (!res.data?.skillId) {
        return this.heuristicFallback(prompt);
      }

      const skillId = activeSkills.includes(res.data.skillId)
        ? res.data.skillId
        : this.heuristicFallback(prompt).skillId;

      const targetSkill = skillRegistry.getSkill(skillId);

      return {
        intent: res.data?.intent || 'General Accounting Query',
        skillId,
        confidence: res.data?.confidence ?? 0.85,
        extractedParameters: {
          ...res.data?.extractedParameters,
          query: prompt,
        },
        requiresConfirmation: res.data?.requiresConfirmation || (targetSkill?.riskLevel !== 'READ_ONLY'),
        riskLevel: (res.data?.riskLevel as AIRiskLevel) || targetSkill?.riskLevel || 'READ_ONLY',
        reasoning: res.data?.reasoning || 'Routed via AI Provider classification',
      };
    } catch (err) {
      console.warn('IntentRouter falling back to heuristics:', err);
      return this.heuristicFallback(prompt);
    }
  }

  /**
   * Identifies WRITE and HIGH-RISK mutation actions requiring explicit confirmation.
   */
  private static checkActionIntent(prompt: string): IntentResult | null {
    const lower = prompt.toLowerCase();

    // 1. High-Risk: Delete / Void / Purge / Change Tax Config / Submit Filing
    if (
      lower.includes('delete transaction') ||
      lower.includes('delete journal') ||
      lower.includes('delete invoice') ||
      lower.includes('void invoice') ||
      lower.includes('void transaction') ||
      lower.includes('burahin ang') ||
      lower.includes('i-delete ang') ||
      lower.includes('i-void ang')
    ) {
      return {
        intent: 'Delete or Void Transaction Action',
        skillId: 'requestActionConfirmation',
        confidence: 0.95,
        extractedParameters: {
          query: prompt,
          actionType: 'DELETE_TRANSACTION',
        },
        requiresConfirmation: true,
        riskLevel: 'HIGH_MUTATION',
        reasoning: 'Deletion or voiding of financial records is a HIGH-RISK operation requiring explicit user approval and audit trail logging.',
        pendingAction: {
          actionId: `action-del-${Date.now()}`,
          actionType: 'DELETE_TRANSACTION',
          description: `Action proposal: Delete/Void specified financial transaction.`,
          riskLevel: 'HIGH_MUTATION',
          payload: { prompt },
          warningMessage: '⚠️ HIGH RISK: Voiding or deleting financial transactions permanently impacts general ledger balances and requires audit log recording.',
        },
      };
    }

    if (
      lower.includes('change tax configuration') ||
      lower.includes('change vat status') ||
      lower.includes('change taxpayer classification') ||
      lower.includes('baguhin ang tax') ||
      lower.includes('palitan ang tax')
    ) {
      return {
        intent: 'Change Tax Configuration Action',
        skillId: 'requestActionConfirmation',
        confidence: 0.95,
        extractedParameters: {
          query: prompt,
          actionType: 'CHANGE_TAX_CONFIG',
        },
        requiresConfirmation: true,
        riskLevel: 'HIGH_MUTATION',
        reasoning: 'Modifying BIR tax registration or VAT settings alters all automated calculations across the platform.',
        pendingAction: {
          actionId: `action-tax-${Date.now()}`,
          actionType: 'CHANGE_TAX_CONFIG',
          description: `Action proposal: Modify company BIR tax configuration settings.`,
          riskLevel: 'HIGH_MUTATION',
          payload: { prompt },
          warningMessage: '⚠️ HIGH RISK: Changing tax settings affects invoice VAT computation, 2307 withholding rules, and return templates.',
        },
      };
    }

    if (
      lower.includes('submit filing') ||
      lower.includes('lock period') ||
      lower.includes('close period') ||
      lower.includes('i-file ang tax') ||
      lower.includes('isumite ang filing')
    ) {
      return {
        intent: 'Submit Tax Filing or Lock Period Action',
        skillId: 'requestActionConfirmation',
        confidence: 0.95,
        extractedParameters: {
          query: prompt,
          actionType: 'SUBMIT_FILING',
        },
        requiresConfirmation: true,
        riskLevel: 'HIGH_MUTATION',
        reasoning: 'Submitting statutory filings and closing accounting periods locks transactions from further modifications.',
        pendingAction: {
          actionId: `action-file-${Date.now()}`,
          actionType: 'SUBMIT_FILING',
          description: `Action proposal: Submit tax return or lock accounting period.`,
          riskLevel: 'HIGH_MUTATION',
          payload: { prompt },
          warningMessage: '⚠️ HIGH RISK: Statutory submissions and period locks prevent subsequent retroactive transaction edits.',
        },
      };
    }

    // 2. Low Mutation: Create Journal Entry / Create Customer / Create Vendor / Record Payment
    if (
      lower.includes('create journal entry') ||
      lower.includes('make journal entry') ||
      lower.includes('gumawa ng journal') ||
      lower.includes('gumawa ng entry') ||
      lower.includes('mag-post ng journal')
    ) {
      return {
        intent: 'Create Journal Entry Action',
        skillId: 'requestActionConfirmation',
        confidence: 0.95,
        extractedParameters: {
          query: prompt,
          actionType: 'CREATE_JOURNAL_ENTRY',
        },
        requiresConfirmation: true,
        riskLevel: 'LOW_MUTATION',
        reasoning: 'Creating a new journal entry posts to the general ledger and requires explicit confirmation of line items.',
        pendingAction: {
          actionId: `action-je-${Date.now()}`,
          actionType: 'CREATE_JOURNAL_ENTRY',
          description: `Action proposal: Draft and post balanced double-entry General Journal Voucher.`,
          riskLevel: 'LOW_MUTATION',
          payload: { prompt },
          warningMessage: 'Please review and verify the proposed debit and credit accounts before posting.',
        },
      };
    }

    return null;
  }

  /**
   * Deterministic heuristic fallback supporting English, Filipino, and Taglish.
   */
  public static heuristicFallback(prompt: string): IntentResult {
    const lower = prompt.toLowerCase().trim();

    // 1. Action intent check
    const actionCheck = this.checkActionIntent(prompt);
    if (actionCheck) return actionCheck;

    // 2. Navigation
    if (
      lower.startsWith('where') ||
      lower.includes('saan ') ||
      lower.includes('saang ') ||
      lower.includes('how to go') ||
      lower.includes('how to find') ||
      lower.includes('pumunta') ||
      lower.includes('where do i') ||
      lower.includes('where can i') ||
      lower.includes('saan makikita') ||
      lower.includes('paano pumunta')
    ) {
      return {
        intent: 'System Navigation',
        skillId: 'navigateSystem',
        confidence: 0.9,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for system module navigation',
      };
    }

    // 3. Business Analytics & Financial Trends ("Why did expenses increase?", "Revenue trends", "Margin analysis")
    if (
      lower.includes('why did expenses') ||
      lower.includes('why expenses') ||
      lower.includes('bakit tumaas ang gastos') ||
      lower.includes('bakit lumaki ang gastos') ||
      lower.includes('bakit bumaba ang benta') ||
      lower.includes('revenue trend') ||
      lower.includes('expense trend') ||
      lower.includes('profit trend') ||
      lower.includes('customer concentration') ||
      lower.includes('vendor concentration') ||
      lower.includes('margin analysis') ||
      lower.includes('cash flow runway') ||
      lower.includes('burn rate') ||
      lower.includes('financial analytics') ||
      lower.includes('business analytics') ||
      lower.includes('analytics')
    ) {
      return {
        intent: 'Financial Analytics & Business Intelligence Query',
        skillId: 'financialAnalyticsQuery',
        confidence: 0.9,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for financial trends, expense spike analysis, or concentration metrics',
      };
    }

    // 4. Anomaly Detection & Suspicious Entries
    if (
      lower.includes('anomaly') ||
      lower.includes('anomalies') ||
      lower.includes('suspicious') ||
      lower.includes('anomalya') ||
      lower.includes('may mali ba') ||
      lower.includes('irregular') ||
      lower.includes('unusual transaction') ||
      lower.includes('detect anomaly')
    ) {
      return {
        intent: 'Anomaly Detection Query',
        skillId: 'anomalyDetectionQuery',
        confidence: 0.9,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for anomaly detection and suspicious bookkeeping entries',
      };
    }

    // 5. Compliance, Missing Documents & Audit Guardian
    if (
      lower.includes('may problema ba sa books') ||
      lower.includes('problema sa books') ||
      lower.includes('may missing receipts') ||
      lower.includes('missing receipt') ||
      lower.includes('missing doc') ||
      lower.includes('missing supporting') ||
      lower.includes('compliance') ||
      lower.includes('guardian') ||
      lower.includes('duplicate invoice') ||
      lower.includes('tax inconsistency') ||
      lower.includes('bookkeeping issue') ||
      lower.includes('filing risk') ||
      lower.includes('compliance warning')
    ) {
      return {
        intent: 'Compliance & Audit Guardian Query',
        skillId: 'complianceQuery',
        confidence: 0.9,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for compliance rules, missing documents, and audit issues',
      };
    }

    // 6. Tax Reminders & Filing Deadlines ("Kailan deadline ng filing?", "Tax calendar", "Reminders")
    if (
      lower.includes('kailan deadline') ||
      lower.includes('kailan ang filing') ||
      lower.includes('deadline ng filing') ||
      lower.includes('filing deadline') ||
      lower.includes('tax deadline') ||
      lower.includes('tax calendar') ||
      lower.includes('due date ng tax') ||
      lower.includes('due date ng vat') ||
      lower.includes('reminders') ||
      lower.includes('paalala sa tax')
    ) {
      return {
        intent: 'Tax Filing Deadlines & Reminders Query',
        skillId: 'taxRemindersQuery',
        confidence: 0.9,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for BIR filing deadlines and statutory reminders',
      };
    }

    // 7. Philippine Tax AI & BIR Rules ("Magkano VAT ko?", "Percentage tax", "Withholding", "CREATE Act")
    if (
      lower.includes('magkano vat') ||
      lower.includes('vat ko') ||
      lower.includes('magkano tax') ||
      lower.includes('tax ko') ||
      lower.includes('percentage tax') ||
      lower.includes('withholding tax') ||
      lower.includes('ewt') ||
      lower.includes('2307') ||
      lower.includes('1601eq') ||
      lower.includes('1702') ||
      lower.includes('2550q') ||
      lower.includes('2551q') ||
      lower.includes('bir') ||
      lower.includes('eopt') ||
      lower.includes('create act')
    ) {
      return {
        intent: 'Philippine Tax AI Query',
        skillId: 'taxQuery',
        confidence: 0.9,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for Philippine tax calculations and BIR return rules',
      };
    }

    // 8. Accounts Receivable, Accounts Payable, Unpaid Invoices, Debts ("May utang ba si Juan?", "Show unpaid invoices")
    if (
      lower.includes('may utang ba') ||
      lower.includes('may utang') ||
      lower.includes('sino may utang') ||
      lower.includes('sino ang may utang') ||
      lower.includes('unpaid invoice') ||
      lower.includes('unpaid bill') ||
      lower.includes('unpaid invoices') ||
      lower.includes('unpaid bills') ||
      lower.includes('balance due') ||
      lower.includes('receivable') ||
      lower.includes('payable') ||
      lower.includes('singilin') ||
      lower.includes('bayarin') ||
      lower.includes('utang') ||
      lower.includes('ar aging') ||
      lower.includes('ap aging')
    ) {
      return {
        intent: 'AR/AP & Transaction Query',
        skillId: 'arApQuery',
        confidence: 0.9,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for receivables, payables, customer debts, or unpaid invoices',
      };
    }

    // 9. Specific Sales vs Expenses vs Overall Financial Summary
    if (
      lower.includes('magkano sales') ||
      lower.includes('total sales') ||
      lower.includes('magkano benta') ||
      lower.includes('sales today') ||
      lower.includes('sales this month') ||
      lower.includes('benta today')
    ) {
      return {
        intent: 'Sales Summary Query',
        skillId: 'getSalesSummary',
        confidence: 0.9,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for sales invoice revenue totals',
      };
    }

    if (
      lower.includes('magkano gastos') ||
      lower.includes('total expenses') ||
      lower.includes('nagastos') ||
      lower.includes('expenses today') ||
      lower.includes('expenses this month') ||
      lower.includes('gastos today')
    ) {
      return {
        intent: 'Expense Summary Query',
        skillId: 'getExpenseSummary',
        confidence: 0.9,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for purchase bill expense totals',
      };
    }

    if (
      lower.includes('magkano kinita') ||
      lower.includes('kinita ko') ||
      lower.includes('kinita') ||
      lower.includes('magkano kita') ||
      lower.includes('net income') ||
      lower.includes('gross profit') ||
      lower.includes('financial summary') ||
      lower.includes('magkano pumasok na pera')
    ) {
      return {
        intent: 'Financial Summary Query',
        skillId: 'getFinancialSummary',
        confidence: 0.9,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for revenue, sales, expenses, or net income summary',
      };
    }

    // 10. Documents & OCR
    if (
      lower.includes('document') ||
      lower.includes('receipt') ||
      lower.includes('ocr') ||
      lower.includes('resibo') ||
      lower.includes('scanned') ||
      lower.includes('vault')
    ) {
      return {
        intent: 'Document & OCR Query',
        skillId: 'summarizeDocument',
        confidence: 0.85,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for document vault or receipt OCR',
      };
    }

    // 11. Trial Balance
    if (lower.includes('trial balance') || lower.includes('unbalanced')) {
      return {
        intent: 'Explain Trial Balance',
        skillId: 'explainTrialBalance',
        confidence: 0.85,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for trial balance',
      };
    }

    // 12. Audit Queries
    if (
      lower.includes('audit log') ||
      lower.includes('audit trail') ||
      lower.includes('who created') ||
      lower.includes('who edited') ||
      lower.includes('audit engagement') ||
      lower.includes('audit lead sheet')
    ) {
      return {
        intent: 'Audit Trail Query',
        skillId: 'auditQuery',
        confidence: 0.85,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for system audit trail and logs',
      };
    }

    // 13. Reports (Balance sheet, Income Statement, P&L)
    if (
      lower.includes('report') ||
      lower.includes('balance sheet') ||
      lower.includes('p&l') ||
      lower.includes('income statement') ||
      lower.includes('cash flow statement')
    ) {
      return {
        intent: 'Summarize Report',
        skillId: 'summarizeReport',
        confidence: 0.85,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for financial reports',
      };
    }

    // 14. Specific Account or Journal
    if (lower.includes('chart of accounts') || lower.includes('account ') || /\b(1010|1100|1200|2000|4000|5000|6000)\b/.test(prompt)) {
      return {
        intent: 'Explain Account',
        skillId: 'explainAccount',
        confidence: 0.8,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for chart of accounts',
      };
    }

    if (lower.includes('journal entry') || lower.includes('journal voucher') || lower.includes('journal ')) {
      return {
        intent: 'Explain Journal Entry',
        skillId: 'explainJournalEntry',
        confidence: 0.8,
        extractedParameters: { query: prompt },
        requiresConfirmation: false,
        riskLevel: 'READ_ONLY',
        reasoning: 'Keyword match for journal entry',
      };
    }

    // Default Fallback
    return {
      intent: 'General Accounting Question',
      skillId: 'generalAccountingQuestion',
      confidence: 0.75,
      extractedParameters: { query: prompt },
      requiresConfirmation: false,
      riskLevel: 'READ_ONLY',
      reasoning: 'Fallback heuristic default',
    };
  }
}
