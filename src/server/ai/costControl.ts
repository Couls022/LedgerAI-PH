import crypto from 'crypto';
import { AILogger } from './logger';

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export interface RateLimitEntry {
  timestamps: number[];
  dailyTokenCount: number;
  lastResetDay: string; // YYYY-MM-DD
}

export interface AICostMetrics {
  totalRequests: number;
  cachedRequests: number;
  totalTokensUsed: number;
  estimatedCostPhp: number;
}

export class AICostController {
  private static cache = new Map<string, CacheEntry>();
  private static rateLimits = new Map<string, RateLimitEntry>();
  private static activeCallStackDepth = new Map<string, number>();

  // Configuration
  private static readonly CACHE_TTL_MS = 60 * 1000; // 60 seconds
  private static readonly MAX_CACHE_ENTRIES = 500;
  private static readonly MAX_REQUESTS_PER_MINUTE = 30;
  private static readonly MAX_DAILY_TOKENS_PER_COMPANY = 250000;
  private static readonly MAX_CALL_STACK_DEPTH = 3; // Recursion protection
  private static readonly TIMEOUT_MS = 15000; // 15 seconds

  /**
   * Generates a deterministic cache key for a company query.
   */
  static getCacheKey(companyId: string, role: string, skillId: string, input: any): string {
    const inputHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(input || {}))
      .digest('hex');
    return `${companyId}:${role}:${skillId}:${inputHash}`;
  }

  /**
   * Retrieves a cached response if valid and not expired.
   */
  static getCachedResponse<T>(cacheKey: string): T | null {
    const entry = this.cache.get(cacheKey);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Stores a response in cache with TTL.
   */
  static setCachedResponse<T>(cacheKey: string, data: T, ttlMs = this.CACHE_TTL_MS): void {
    if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
      // Evict oldest 50 entries
      const keys = Array.from(this.cache.keys()).slice(0, 50);
      for (const k of keys) this.cache.delete(k);
    }

    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Clears cache for a company (e.g. on new mutations/postings).
   */
  static invalidateCompanyCache(companyId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${companyId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Checks rate limits and daily token quotas.
   * Throws Error if limits are exceeded.
   */
  static checkRateLimit(companyId: string, userId: string): void {
    const now = Date.now();
    const todayStr = new Date().toISOString().split('T')[0];
    const key = `${companyId}:${userId}`;

    let entry = this.rateLimits.get(key);
    if (!entry || entry.lastResetDay !== todayStr) {
      entry = {
        timestamps: [],
        dailyTokenCount: 0,
        lastResetDay: todayStr,
      };
      this.rateLimits.set(key, entry);
    }

    // Filter out timestamps older than 60 seconds
    const oneMinAgo = now - 60000;
    entry.timestamps = entry.timestamps.filter(t => t > oneMinAgo);

    if (entry.timestamps.length >= this.MAX_REQUESTS_PER_MINUTE) {
      throw new Error(`AI Request Rate Limit Exceeded: Maximum ${this.MAX_REQUESTS_PER_MINUTE} requests per minute allowed. Please wait a few seconds.`);
    }

    if (entry.dailyTokenCount >= this.MAX_DAILY_TOKENS_PER_COMPANY) {
      throw new Error(`AI Daily Quota Exceeded: Reached maximum daily allowance of ${this.MAX_DAILY_TOKENS_PER_COMPANY.toLocaleString()} tokens for this company.`);
    }

    entry.timestamps.push(now);
  }

  /**
   * Records token usage for rate limiting and cost accounting.
   */
  static recordTokenUsage(companyId: string, userId: string, tokensUsed: number): void {
    const key = `${companyId}:${userId}`;
    const entry = this.rateLimits.get(key);
    if (entry) {
      entry.dailyTokenCount += tokensUsed;
    }
  }

  /**
   * Protection against accidental infinite loops or deep sub-agent recursions.
   */
  static enterCallStack(callId: string): void {
    const current = this.activeCallStackDepth.get(callId) || 0;
    if (current >= this.MAX_CALL_STACK_DEPTH) {
      throw new Error(`AI Safety Guard: Recursive skill call depth exceeded limit (${this.MAX_CALL_STACK_DEPTH}). Call aborted.`);
    }
    this.activeCallStackDepth.set(callId, current + 1);
  }

  static exitCallStack(callId: string): void {
    const current = this.activeCallStackDepth.get(callId) || 0;
    if (current <= 1) {
      this.activeCallStackDepth.delete(callId);
    } else {
      this.activeCallStackDepth.set(callId, current - 1);
    }
  }

  /**
   * Wraps an async AI operation with timeout and fallback protection.
   */
  static async withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs = this.TIMEOUT_MS,
    fallback: () => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(async () => {
        if (!settled) {
          settled = true;
          console.warn(`AI Operation timed out after ${timeoutMs}ms. Invoking fallback.`);
          try {
            const fallbackResult = await fallback();
            resolve(fallbackResult);
          } catch (fbErr) {
            reject(fbErr);
          }
        }
      }, timeoutMs);

      operation()
        .then(res => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(res);
          }
        })
        .catch(async err => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            console.warn(`AI Operation failed: ${err.message}. Invoking fallback.`);
            try {
              const fallbackResult = await fallback();
              resolve(fallbackResult);
            } catch (fbErr) {
              reject(fbErr);
            }
          }
        });
    });
  }
}
