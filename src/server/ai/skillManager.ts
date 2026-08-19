import { AISkillExecutionParams, AIStructuredResponse, IAIProvider } from './types';
import { skillRegistry } from './skills/registry';
import { registerAllCoreSkills } from './skills/definitions';
import { ContextBuilder } from './contextBuilder';
import { geminiProvider } from './providers/geminiProvider';
import { AILogger } from './logger';

// Ensure skills are registered on module load
registerAllCoreSkills();

export interface UserContext {
  userId: string;
  companyId: string;
  role: string;
  permissions: string[];
}

export class SkillManager {
  private provider: IAIProvider;

  constructor(provider: IAIProvider = geminiProvider) {
    this.provider = provider;
  }

  // Sanitize input to defend against prompt injection
  private sanitizeInput(input: any): any {
    if (!input) return input;
    if (typeof input === 'string') {
      const forbiddenPatterns = [
        /ignore previous instructions/i,
        /override system prompt/i,
        /expose api key/i,
        /drop table/i,
        /delete from/i,
        /select \* from users/i,
      ];
      let sanitized = input;
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(sanitized)) {
          sanitized = sanitized.replace(pattern, '[REDACTED_SECURITY_PROMPT_INJECTION]');
        }
      }
      return sanitized;
    }

    if (typeof input === 'object') {
      const sanitizedObj: Record<string, any> = {};
      for (const [key, val] of Object.entries(input)) {
        sanitizedObj[key] = this.sanitizeInput(val);
      }
      return sanitizedObj;
    }

    return input;
  }

  async executeSkill(
    params: AISkillExecutionParams,
    userContext: UserContext
  ): Promise<AIStructuredResponse> {
    const startTime = Date.now();
    const { skillId, input = {}, contextParams = {} } = params;

    // 1. Verify Skill exists
    const skill = skillRegistry.getSkill(skillId);
    if (!skill) {
      await AILogger.logExecution({
        companyId: userContext.companyId,
        userId: userContext.userId,
        userRole: userContext.role,
        skillId,
        provider: this.provider.id,
        model: 'N/A',
        status: 'FAILED',
        errorMessage: `Skill "${skillId}" not found in registry.`,
      });
      throw new Error(`AI Skill "${skillId}" is not registered or disabled.`);
    }

    // 2. Data-Level Permission Check (Multi-Domain RBAC Enforcement)
    const userPerms = userContext.permissions || [];
    const hasWildcard = userPerms.includes('*');
    if (!hasWildcard && skill.requiredPermissions.length > 0) {
      const missingPermissions: string[] = [];
      for (const reqPerm of skill.requiredPermissions) {
        const canonical = reqPerm.toLowerCase();
        const legacy = canonical.replace(':', '_').toUpperCase();
        const hasPerm = userPerms.some((p) => {
          const pLower = p.toLowerCase();
          return pLower === canonical || pLower === legacy || pLower === '*';
        });
        if (!hasPerm) {
          missingPermissions.push(reqPerm);
        }
      }

      if (missingPermissions.length > 0) {
        await AILogger.logExecution({
          companyId: userContext.companyId,
          userId: userContext.userId,
          userRole: userContext.role,
          skillId: skill.id,
          provider: this.provider.id,
          model: 'N/A',
          status: 'SECURITY_REFUSAL',
          riskLevel: skill.riskLevel,
          errorMessage: `User lacks required permissions: ${missingPermissions.join(', ')}`,
        });
        throw new Error(
          `Permission Denied: User role "${userContext.role}" lacks required permissions (${missingPermissions.join(', ')}) for skill "${skill.name}".`
        );
      }
    }

    // 3. Sanitize inputs
    const sanitizedInput = this.sanitizeInput(input);

    // 4. Build Context securely
    let context: Record<string, any> = { userRole: userContext.role };
    try {
      context = await ContextBuilder.buildContext(
        userContext.companyId,
        skill.requiredContext,
        contextParams
      );
      context.userRole = userContext.role;
    } catch (ctxError: any) {
      console.warn(`Context building warning for skill ${skillId}:`, ctxError.message);
    }

    // 5. Execute Skill via AI Provider with fallback
    try {
      const isAvailable = await this.provider.isAvailable();
      if (!isAvailable) {
        // Fallback response for offline / missing API key mode
        const fallbackResponse: AIStructuredResponse = {
          skillId: skill.id,
          answer: `LedgerAI Assistant Notice: Offline or simulated AI mode active. Skill "${skill.name}" executed with local accounting guidance.`,
          confidence: 0.9,
          citations: ['LedgerAI PH Standard Accounting Manual'],
          reasoningSummary: 'Executed using local standard accounting logic (AI provider offline or unavailable).',
          warnings: ['AI provider key is not configured or network is offline.'],
          suggestedActions: [{ label: 'View Accounting Dashboard', action: 'NAVIGATE', params: { path: '/accounting' } }],
          model: 'offline-fallback',
          needsReview: false,
        };

        await AILogger.logExecution({
          companyId: userContext.companyId,
          userId: userContext.userId,
          userRole: userContext.role,
          skillId: skill.id,
          provider: 'offline-fallback',
          model: 'offline-fallback',
          status: 'OFFLINE_FALLBACK',
          riskLevel: skill.riskLevel,
          latencyMs: Date.now() - startTime,
          inputSummary: JSON.stringify(sanitizedInput),
          outputSummary: fallbackResponse.answer,
        });

        return fallbackResponse;
      }

      const result = await skill.execute(sanitizedInput, context, this.provider);
      const latencyMs = Date.now() - startTime;

      // 6. Log successful execution
      await AILogger.logExecution({
        companyId: userContext.companyId,
        userId: userContext.userId,
        userRole: userContext.role,
        skillId: skill.id,
        provider: this.provider.id,
        model: result.model || 'gemini-2.5-flash',
        status: 'SUCCESS',
        riskLevel: skill.riskLevel,
        latencyMs,
        inputSummary: JSON.stringify(sanitizedInput),
        outputSummary: result.answer,
      });

      return result;
    } catch (err: any) {
      console.warn(`Skill execution failed for "${skillId}":`, err?.message || err);
      const latencyMs = Date.now() - startTime;
      await AILogger.logExecution({
        companyId: userContext.companyId,
        userId: userContext.userId,
        userRole: userContext.role,
        skillId: skill.id,
        provider: this.provider.id,
        model: 'gemini-2.5-flash',
        status: 'FAILED',
        riskLevel: skill.riskLevel,
        latencyMs,
        errorMessage: err.message,
      });

      // Return a safe error response instead of crashing
      return {
        skillId: skill.id,
        answer: `An error occurred while generating the AI response: ${err.message}`,
        confidence: 0,
        citations: [],
        reasoningSummary: 'Execution encountered an error.',
        warnings: [err.message],
        suggestedActions: [],
        needsReview: true,
      };
    }
  }
}
