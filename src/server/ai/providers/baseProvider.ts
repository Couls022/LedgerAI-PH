import { IAIProvider, AIProviderOptions, AIProviderResponse } from '../types';

export abstract class BaseAIProvider implements IAIProvider {
  abstract id: string;
  abstract name: string;

  abstract isAvailable(): Promise<boolean>;

  abstract generateText(
    prompt: string,
    options?: AIProviderOptions
  ): Promise<AIProviderResponse<string>>;

  abstract generateStructured<T>(
    prompt: string,
    schema: any,
    options?: AIProviderOptions
  ): Promise<AIProviderResponse<T>>;

  protected normalizeError(error: any): Error {
    if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('Quota')) {
      return new Error('AI Provider rate limit exceeded. Please try again later.');
    }
    if (error?.status === 401 || error?.message?.includes('API key')) {
      return new Error('AI Provider authentication failed. Please check configuration.');
    }
    if (error?.code === 'ETIMEDOUT' || error?.message?.includes('timeout')) {
      return new Error('AI Provider request timed out.');
    }
    return new Error(error?.message || 'AI Provider request failed');
  }
}
