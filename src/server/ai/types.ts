// Export a local Type constant to replace @google/genai Type enum
// This prevents statically importing @google/genai and google-auth-library
// in desktop offline environments that crash on AWS client load.
export const Type = {
  STRING: 'string',
  NUMBER: 'number',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
  OBJECT: 'object',
} as const;

export type AIRiskLevel = 'READ_ONLY' | 'LOW_MUTATION' | 'HIGH_MUTATION';

export type AISkillCategory = 
  | 'ACCOUNTING' 
  | 'TAX'
  | 'COMPLIANCE' 
  | 'DOCUMENTS' 
  | 'REPORTS' 
  | 'ANALYTICS'
  | 'AUDIT'
  | 'ACTIONS'
  | 'GENERAL_ASSISTANT';

export interface AIPendingAction {
  actionId: string;
  actionType: 'CREATE_JOURNAL_ENTRY' | 'CREATE_CUSTOMER' | 'CREATE_VENDOR' | 'DELETE_TRANSACTION' | 'VOID_INVOICE' | 'CHANGE_TAX_CONFIG' | 'SUBMIT_FILING' | 'CUSTOM_MUTATION';
  description: string;
  riskLevel: AIRiskLevel;
  payload: Record<string, any>;
  warningMessage?: string;
  requiresDualAuth?: boolean;
  status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'REJECTED';
}

export interface AIUsageMetrics {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  latencyMs: number;
}

export interface AIProviderResponse<T = any> {
  text: string;
  data?: T;
  usage?: AIUsageMetrics;
  model: string;
  provider: string;
}

export interface AIProviderOptions {
  systemInstruction?: string;
  temperature?: number;
  responseMimeType?: string;
  responseSchema?: any;
  model?: string;
  enableGrounding?: boolean;
}

export interface IAIProvider {
  id: string;
  name: string;
  isAvailable(): Promise<boolean>;
  generateText(prompt: string, options?: AIProviderOptions): Promise<AIProviderResponse<string>>;
  generateStructured<T>(prompt: string, schema: any, options?: AIProviderOptions): Promise<AIProviderResponse<T>>;
}

export interface AISkillContextRequirement {
  requireCompany?: boolean;
  requireAccount?: boolean;
  requireJournal?: boolean;
  requireReport?: boolean;
  requireDocument?: boolean;
  requireTaxProfile?: boolean;
}

export interface AISkillDefinition<TInput = any, TOutput = any> {
  id: string;
  name: string;
  description: string;
  category: AISkillCategory;
  version: string;
  requiredPermissions: string[];
  requiredContext: AISkillContextRequirement;
  inputSchema?: any;
  outputSchema?: any;
  promptTemplateId: string;
  enabled: boolean;
  riskLevel: AIRiskLevel;
  isReadOnly: boolean;
  execute(
    input: TInput,
    context: Record<string, any>,
    provider: IAIProvider
  ): Promise<TOutput>;
}

export interface IntentResult {
  intent: string;
  skillId: string;
  confidence: number;
  extractedParameters: Record<string, any>;
  requiresConfirmation: boolean;
  riskLevel: AIRiskLevel;
  reasoning?: string;
  pendingAction?: AIPendingAction;
}

export interface AIStructuredResponse {
  answer: string;
  confidence: number;
  citations?: string[];
  reasoningSummary?: string;
  warnings?: string[];
  suggestedActions?: { label: string; action: string; params?: Record<string, any> }[];
  skillId: string;
  model?: string;
  needsReview?: boolean;
  sourceDataUsed?: Record<string, any>;
  authoritativeSource?: string;
  pendingAction?: AIPendingAction;
}

export interface AISkillExecutionParams {
  skillId: string;
  input?: Record<string, any>;
  contextParams?: {
    accountId?: string;
    journalId?: string;
    billId?: string;
    invoiceId?: string;
    documentId?: string;
    reportType?: string;
    period?: string;
  };
}
