import { IAIProvider } from '../types';
import { geminiProvider, GeminiProvider } from './geminiProvider';
import { db } from '../../db';
import { companyAiSettings } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { BaseAIProvider } from './baseProvider';

// Local Fallback Provider
export class LocalFallbackProvider extends BaseAIProvider {
  id = 'local';
  name = 'Local Ledger Agent (Offline)';
  
  async isAvailable(): Promise<boolean> {
    return true; // Always available
  }
  
  async generateText(prompt: string, options?: any): Promise<any> {
    return {
      text: "I am operating in OFFLINE mode using Local Intelligence. Please check your internet connection or configure an API key in settings.",
      data: "I am operating in OFFLINE mode using Local Intelligence. Please check your internet connection or configure an API key in settings.",
      model: "local-rule-engine",
      provider: "local",
      usage: { promptTokens: 0, candidatesTokens: 0, totalTokens: 0, latencyMs: 0 }
    };
  }
  
  async generateStructured<T>(prompt: string, schema: any, options?: any): Promise<any> {
    // Basic offline parser to extract data from prompt
    let answer = "I am operating in OFFLINE mode using Local Intelligence. My responses are calculated directly from local accounting engine rules.";
    
    // Check if the prompt has Authoritative calculations or Data blocks
    if (prompt.includes('Authoritative calculation results')) {
      const authMatch = prompt.match(/(Authoritative calculation results[\s\S]*?)(?:\n\nUser Query|User Query)/i);
      if (authMatch) {
        answer = "[OFFLINE MODE] " + authMatch[1].trim();
      }
    } else if (prompt.includes('Data provided by Accounting Engine') || prompt.includes('Data provided by Report Engine')) {
      const dataBlockMatch = prompt.match(/(Data provided by (?:Accounting|Report) Engine[\s\S]*?)(?:\n\nUser Query|User Query)/i);
      if (dataBlockMatch) {
        answer = "[OFFLINE MODE] " + dataBlockMatch[1].trim();
      }
    } else if (prompt.includes('Data from existing records:')) {
      const dataBlockMatch = prompt.match(/(Data from existing records:[\s\S]*?)(?:\n\nUser Query|User Query)/i);
      if (dataBlockMatch) {
        answer = "[OFFLINE MODE] " + dataBlockMatch[1].trim();
      }
    } else if (prompt.includes('Data from Compliance Rule Engine (Audit Guardian):')) {
      const dataBlockMatch = prompt.match(/(Data from Compliance Rule Engine[\s\S]*?)(?:\n\nUser Query|User Query)/i);
      if (dataBlockMatch) {
        answer = "[OFFLINE MODE] " + dataBlockMatch[1].trim();
      }
    } else {
      const dataBlockMatch = prompt.match(/(Data[\s\S]*?)(?:\n\nUser Query|User Query)/i);
      if (dataBlockMatch) {
        answer = "[OFFLINE MODE] " + dataBlockMatch[1].trim();
      }
    }

    return {
      text: "{}",
      data: {
        answer: answer,
        confidence: 1.0,
        citations: ["Local Cache (Offline)"],
        reasoningSummary: "Operating in offline mode. Responses are generated via heuristic fallback engine strictly based on internal BIR-compliant reporting data.",
        warnings: ["Operating offline. Real-time BIR policy verification and advanced AI reasoning are disabled. Add a Gemini API key to unlock full features."]
      },
      model: "local-rule-engine",
      provider: "local",
      usage: { promptTokens: 0, candidatesTokens: 0, totalTokens: 0, latencyMs: 0 }
    };
  }
}

export const localProvider = new LocalFallbackProvider();

export interface CustomKeyItem {
  id: string;
  name: string;
  provider: 'gemini' | 'openai' | 'grok';
  apiKey: string;
  createdAt: string;
}

export class ProviderManager {
  static async getProviderForCompany(companyId: string): Promise<{provider: IAIProvider, isOffline: boolean, providerName?: string}> {
    try {
      const settings = await db.select().from(companyAiSettings).where(eq(companyAiSettings.companyId, companyId)).get();
      
      if (!settings || !settings.enabled) {
        if (await geminiProvider.isAvailable()) {
          return { provider: geminiProvider, isOffline: false, providerName: 'System Default (Gemini)' };
        }
        return { provider: localProvider, isOffline: true, providerName: 'Local Rule Engine (Offline)' };
      }

      // Parse custom keys array
      let customKeys: CustomKeyItem[] = [];
      if (settings.customKeysJson) {
        try {
          customKeys = JSON.parse(settings.customKeysJson);
        } catch (e) {
          console.error("Failed to parse customKeysJson", e);
        }
      }

      // 1. Try Primary Designated Key
      if (settings.primaryKeyId) {
        const primaryKey = customKeys.find(k => k.id === settings.primaryKeyId);
        if (primaryKey && primaryKey.apiKey) {
          if (primaryKey.provider === 'gemini') {
            const provider = new GeminiProvider(primaryKey.apiKey);
            if (await provider.isAvailable()) {
              return { provider, isOffline: false, providerName: `Primary: ${primaryKey.name}` };
            }
          }
        }
      }

      // If primaryProvider is set to 'local' explicitly
      if (settings.primaryProvider === 'local') {
        return { provider: localProvider, isOffline: true, providerName: 'Main Offline Engine (Selected)' };
      }

      // 2. Try Secondary Designated Key (Fallback 1)
      if (settings.secondaryKeyId) {
        const secondaryKey = customKeys.find(k => k.id === settings.secondaryKeyId);
        if (secondaryKey && secondaryKey.apiKey) {
          if (secondaryKey.provider === 'gemini') {
            const provider = new GeminiProvider(secondaryKey.apiKey);
            if (await provider.isAvailable()) {
              return { provider, isOffline: false, providerName: `Secondary: ${secondaryKey.name}` };
            }
          }
        }
      }

      // 3. Try legacy geminiApiKey if available
      if (settings.geminiApiKey && settings.geminiApiKey.trim()) {
        const legacyProvider = new GeminiProvider(settings.geminiApiKey.trim());
        if (await legacyProvider.isAvailable()) {
          return { provider: legacyProvider, isOffline: false, providerName: 'Custom Gemini Key' };
        }
      }

      // 4. Try any available key in customKeys array
      for (const k of customKeys) {
        if (k.apiKey && k.provider === 'gemini') {
          const prov = new GeminiProvider(k.apiKey);
          if (await prov.isAvailable()) {
            return { provider: prov, isOffline: false, providerName: `Custom Key: ${k.name}` };
          }
        }
      }

      // 5. Try System Default Key
      const isGeminiAvailable = await geminiProvider.isAvailable();
      if (isGeminiAvailable) {
        return { provider: geminiProvider, isOffline: false, providerName: 'System Default (Gemini)' };
      }
      
      // 6. Main Offline Rule Engine (Ultimate Fallback)
      return { provider: localProvider, isOffline: true, providerName: 'Main Offline Engine (Fallback)' };
    } catch (err) {
      console.error("Failed to get provider for company:", err);
      return { provider: localProvider, isOffline: true, providerName: 'Main Offline Engine (Error Fallback)' };
    }
  }
}
