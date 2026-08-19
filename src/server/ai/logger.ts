import { db } from '../db';
import { aiExecutionLogs } from '../db/schema';
import crypto from 'crypto';

export interface LogAIExecutionParams {
  companyId: string;
  userId: string;
  userRole?: string;
  skillId: string;
  skillVersion?: string;
  provider: string;
  model: string;
  status: 'SUCCESS' | 'FAILED' | 'RATE_LIMITED' | 'SECURITY_REFUSAL' | 'OFFLINE_FALLBACK';
  riskLevel?: 'READ_ONLY' | 'LOW_MUTATION' | 'HIGH_MUTATION';
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  errorMessage?: string;
}

export class AILogger {
  static async logExecution(params: LogAIExecutionParams): Promise<void> {
    try {
      await db.insert(aiExecutionLogs).values({
        id: crypto.randomUUID(),
        companyId: params.companyId,
        userId: params.userId,
        userRole: params.userRole || 'UNKNOWN',
        skillId: params.skillId,
        skillVersion: params.skillVersion || 'v1',
        provider: params.provider,
        model: params.model,
        status: params.status,
        riskLevel: params.riskLevel || 'READ_ONLY',
        inputTokens: params.inputTokens || 0,
        outputTokens: params.outputTokens || 0,
        latencyMs: params.latencyMs || 0,
        inputSummary: params.inputSummary ? params.inputSummary.substring(0, 500) : null,
        outputSummary: params.outputSummary ? params.outputSummary.substring(0, 500) : null,
        errorMessage: params.errorMessage ? params.errorMessage.substring(0, 500) : null,
      });
    } catch (err) {
      console.error('Failed to log AI execution:', err);
    }
  }
}
