import fs from 'fs';
import path from 'path';

export type LogSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface OperationalLogEntry {
  timestamp: string;
  severity: LogSeverity;
  event: string;
  requestId?: string;
  companyId?: string;
  operation?: string;
  durationMs?: number;
  success: boolean;
  details?: any;
}

export class OperationalLogger {
  private static sanitize(data: any): any {
    if (!data) return data;
    if (typeof data === 'string') {
      // Redact sensitive patterns if any slip in
      return data
        .replace(/([a-zA-Z0-9_\-\.]+@[a-zA-Z0-9_\-\.]+\.[a-zA-Z]{2,})/g, '[REDACTED_EMAIL]')
        .replace(/\b\d{3}-\d{3}-\d{3}-\d{3}\b/g, '[REDACTED_TIN]');
    }
    if (typeof data === 'object') {
      const copy: any = Array.isArray(data) ? [] : {};
      for (const key of Object.keys(data)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('key') ||
          lowerKey.includes('password') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('token') ||
          lowerKey.includes('auth') ||
          lowerKey.includes('tin')
        ) {
          copy[key] = '[REDACTED]';
        } else {
          copy[key] = this.sanitize(data[key]);
        }
      }
      return copy;
    }
    return data;
  }

  public static log(entry: Omit<OperationalLogEntry, 'timestamp'>): void {
    const fullEntry: OperationalLogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
      details: this.sanitize(entry.details)
    };

    const line = JSON.stringify(fullEntry);
    if (fullEntry.severity === 'ERROR' || fullEntry.severity === 'FATAL') {
      console.error(`[OPERATIONAL-LOG] ${line}`);
    } else if (fullEntry.severity === 'WARN') {
      console.warn(`[OPERATIONAL-LOG] ${line}`);
    } else {
      console.log(`[OPERATIONAL-LOG] ${line}`);
    }
  }

  public static info(event: string, details?: any, meta?: { requestId?: string; companyId?: string; operation?: string; durationMs?: number }) {
    this.log({
      severity: 'INFO',
      event,
      success: true,
      details,
      ...meta
    });
  }

  public static warn(event: string, details?: any, meta?: { requestId?: string; companyId?: string; operation?: string; durationMs?: number }) {
    this.log({
      severity: 'WARN',
      event,
      success: true,
      details,
      ...meta
    });
  }

  public static error(event: string, error?: any, meta?: { requestId?: string; companyId?: string; operation?: string; durationMs?: number }) {
    this.log({
      severity: 'ERROR',
      event,
      success: false,
      details: {
        message: error?.message || String(error),
        code: error?.code
      },
      ...meta
    });
  }
}
