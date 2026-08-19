import { AISkillDefinition, AIStructuredResponse, IAIProvider } from '../../types';

export const navigationSkill: AISkillDefinition = {
  id: 'navigateSystem',
  name: 'System Navigation',
  description: 'Helps the user navigate LedgerAI, providing explicit markdown links to modules.',
  category: 'GENERAL_ASSISTANT',
  version: '1.0.0',
  requiredPermissions: [],
  requiredContext: {},
  promptTemplateId: 'navigation.v1',
  enabled: true,
  riskLevel: 'READ_ONLY',
  isReadOnly: true,
  async execute(input, context, provider: IAIProvider): Promise<AIStructuredResponse> {
    const query = (input.query || '').toLowerCase();
    
    let matchedPath = '/';
    let matchedLabel = 'Dashboard';

    if (query.includes('supplier') || query.includes('vendor') || query.includes('bill') || query.includes('purchase')) {
      matchedPath = '/operations/purchases';
      matchedLabel = 'Purchases & Vendors';
    } else if (query.includes('customer') || query.includes('invoice') || query.includes('sales')) {
      matchedPath = '/operations/sales';
      matchedLabel = 'Sales & Invoices';
    } else if (query.includes('chart of accounts') || query.includes('coa') || query.includes('account list')) {
      matchedPath = '/accounting/chart-of-accounts';
      matchedLabel = 'Chart of Accounts';
    } else if (query.includes('journal') || query.includes('voucher') || query.includes('entry')) {
      matchedPath = '/accounting/journal-entries';
      matchedLabel = 'Journal Entries';
    } else if (query.includes('trial balance')) {
      matchedPath = '/reports/trial-balance';
      matchedLabel = 'Trial Balance';
    } else if (query.includes('balance sheet')) {
      matchedPath = '/reports/balance-sheet';
      matchedLabel = 'Balance Sheet';
    } else if (query.includes('p&l') || query.includes('income statement') || query.includes('profit and loss')) {
      matchedPath = '/reports/income-statement';
      matchedLabel = 'Income Statement';
    } else if (query.includes('tax') || query.includes('bir') || query.includes('2550') || query.includes('form')) {
      matchedPath = '/tax/forms';
      matchedLabel = 'BIR Tax Forms';
    } else if (query.includes('document') || query.includes('ocr') || query.includes('receipt') || query.includes('scanner')) {
      matchedPath = '/documents';
      matchedLabel = 'Document Vault & OCR';
    } else if (query.includes('audit') || query.includes('guardian') || query.includes('log')) {
      matchedPath = '/audit/logs';
      matchedLabel = 'Audit Guardian & Logs';
    } else if (query.includes('setting') || query.includes('user') || query.includes('role')) {
      matchedPath = '/settings';
      matchedLabel = 'System Settings';
    }

    const promptText = `
You are Ledger Agent. The user is asking how to find or navigate to a specific part of the LedgerAI application.
User Request: ${input.query}
Target Module: ${matchedLabel} ([${matchedPath}](${matchedPath}))

Provide a direct, friendly answer guiding the user to ${matchedLabel} with markdown link [${matchedPath}](${matchedPath}).
`;

    const res = await provider.generateStructured<any>(promptText, {
      type: "OBJECT",
      properties: {
        answer: { type: "STRING" }
      }
    });

    return {
      skillId: this.id,
      answer: res.data?.answer || `You can access ${matchedLabel} at [${matchedPath}](${matchedPath}).`,
      confidence: 1.0,
      citations: ['LedgerAI Navigation Map'],
      suggestedActions: [
        {
          label: `Open ${matchedLabel}`,
          action: 'NAVIGATE',
          params: { path: matchedPath }
        }
      ],
      needsReview: false
    };
  }
};
