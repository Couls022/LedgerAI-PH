import type { GoogleGenAI } from '@google/genai';
import { BaseAIProvider } from './baseProvider';
import { AIProviderOptions, AIProviderResponse } from '../types';

export class GeminiProvider extends BaseAIProvider {
  id = 'gemini';
  name = 'Google Gemini Provider';

  private defaultModel = 'gemini-2.5-flash';
  private client: GoogleGenAI | null = null;
  private customApiKey?: string;

  constructor(customApiKey?: string) {
    super();
    this.customApiKey = customApiKey;
  }

  private async getClient(): Promise<GoogleGenAI> {
    if (!this.client) {
      const apiKey = this.customApiKey || process.env.GEMINI_API_KEY || process.env.GEMINI_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is missing.');
      }
      try {
        const { GoogleGenAI } = await import('@google/genai');
        this.client = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
      } catch (err: any) {
        console.error('[GeminiProvider] Failed to load @google/genai module in desktop environment:', err?.message);
        throw new Error('AI features are currently unavailable in this offline desktop environment.');
      }
    }
    return this.client;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const apiKey = this.customApiKey || process.env.GEMINI_API_KEY || process.env.GEMINI_KEY;
      return Boolean(apiKey && apiKey.trim().length > 0);
    } catch {
      return false;
    }
  }

  private async executeWithRetry<T>(operation: () => Promise<T>, maxRetries = 4): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (err: any) {
        attempt++;
        const isRateLimit = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('Quota') || err?.message?.includes('Rate');
        if (attempt > maxRetries || !isRateLimit) {
          throw err;
        }
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async generateText(
    prompt: string,
    options?: AIProviderOptions
  ): Promise<AIProviderResponse<string>> {
    const startTime = Date.now();
    try {
      const ai = await this.getClient();
      const modelName = options?.model || this.defaultModel;

      const config: any = {
        systemInstruction: options?.systemInstruction,
        temperature: options?.temperature ?? 0.2,
      };

      if (options?.enableGrounding) {
        config.tools = [{ googleSearch: {} }];
      }

      const response = await this.executeWithRetry(() => ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config,
      }));

      const latencyMs = Date.now() - startTime;
      const textOutput = response.text || '';
      const usageMetadata = (response as any).usageMetadata;
      const promptTokens = usageMetadata?.promptTokenCount || Math.ceil(prompt.length / 4);
      const candidatesTokens = usageMetadata?.candidatesTokenCount || Math.ceil(textOutput.length / 4);

      return {
        text: textOutput,
        data: textOutput,
        model: modelName,
        provider: this.id,
        usage: {
          promptTokens,
          candidatesTokens,
          totalTokens: promptTokens + candidatesTokens,
          latencyMs,
        },
      };
    } catch (err: any) {
      throw this.normalizeError(err);
    }
  }

  async generateStructured<T>(
    prompt: string,
    schema: any,
    options?: AIProviderOptions
  ): Promise<AIProviderResponse<T>> {
    const startTime = Date.now();
    try {
      const ai = await this.getClient();
      const modelName = options?.model || this.defaultModel;

      const response = await this.executeWithRetry(() => ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction: options?.systemInstruction,
          temperature: options?.temperature ?? 0.1,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      }));

      const latencyMs = Date.now() - startTime;
      const rawText = response.text?.trim() || '{}';

      let parsedData: T;
      try {
        parsedData = JSON.parse(rawText) as T;
      } catch {
        throw new Error(`Failed to parse structured response from Gemini provider: ${rawText.substring(0, 100)}`);
      }

      const usageMetadata = (response as any).usageMetadata;
      const promptTokens = usageMetadata?.promptTokenCount || Math.ceil(prompt.length / 4);
      const candidatesTokens = usageMetadata?.candidatesTokenCount || Math.ceil(rawText.length / 4);

      return {
        text: rawText,
        data: parsedData,
        model: modelName,
        provider: this.id,
        usage: {
          promptTokens,
          candidatesTokens,
          totalTokens: promptTokens + candidatesTokens,
          latencyMs,
        },
      };
    } catch (err: any) {
      throw this.normalizeError(err);
    }
  }
}

export const geminiProvider = new GeminiProvider();
