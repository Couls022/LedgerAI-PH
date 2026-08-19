import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { paths } from './paths';
import { db } from '../db';
import { companyLicenses } from '../db/schema';
import { eq } from 'drizzle-orm';
import { CompanyManager } from './companyManager';

export interface TimeStateData {
  version: number;
  lastKnownTimestamp: number;
  lastKnownIso: string;
  sequence: number;
  companyId?: string;
  checksum: string;
}

export interface ClockVerificationResult {
  valid: boolean;
  code: 'OK' | 'CLOCK_ROLLBACK_DETECTED' | 'TAMPERED_TIME_STATE';
  currentTime: number;
  lastKnownTime: number;
  discrepancyMs: number;
  message?: string;
}

const TIME_STATE_SECRET = process.env.LEDGERAI_TIME_SECRET || 'ledgerai-ph-time-integrity-v1-9874a123f';
// Allow 60 seconds of clock skew/NTP sync adjustment
const CLOCK_TOLERANCE_MS = 60 * 1000;

export class AntiRollbackService {
  private static heartbeatTimer: NodeJS.Timeout | null = null;

  /**
   * Generates HMAC checksum for time state data
   */
  private static computeChecksum(timestamp: number, sequence: number, companyId: string = 'global'): string {
    return crypto
      .createHmac('sha256', TIME_STATE_SECRET)
      .update(`${timestamp}:${sequence}:${companyId}:ledgerai-time-guard`)
      .digest('hex');
  }

  /**
   * Reads and verifies the secure local file-based time state
   */
  public static async readTimeState(companyId?: string): Promise<{ timestamp: number; sequence: number; valid: boolean }> {
    const filePath = paths.getTimeStateFilePath(companyId);

    try {
      if (!fs.existsSync(filePath)) {
        return { timestamp: 0, sequence: 0, valid: true };
      }

      const content = await fsPromises.readFile(filePath, 'utf8');
      const data: TimeStateData = JSON.parse(content);

      if (!data || typeof data.lastKnownTimestamp !== 'number') {
        return { timestamp: 0, sequence: 0, valid: false };
      }

      const expectedChecksum = this.computeChecksum(data.lastKnownTimestamp, data.sequence, companyId || 'global');
      if (data.checksum !== expectedChecksum) {
        return { timestamp: data.lastKnownTimestamp, sequence: data.sequence, valid: false };
      }

      return { timestamp: data.lastKnownTimestamp, sequence: data.sequence, valid: true };
    } catch {
      return { timestamp: 0, sequence: 0, valid: false };
    }
  }

  /**
   * Evaluates filesystem metadata timestamps for critical internal company artifacts
   */
  public static getFilesystemMaxTimestamp(companyId?: string): number {
    let maxTime = 0;

    try {
      const pathsToCheck: string[] = [];

      // Check global registry
      const regPath = paths.getRegistryFilePath();
      if (fs.existsSync(regPath)) {
        pathsToCheck.push(regPath);
      }

      // Check company-specific files
      if (companyId) {
        const companyDir = paths.getCompanyDir(companyId);
        const manifestPath = path.join(companyDir, 'manifest.json');
        const dbPath = paths.getCompanyDatabasePath(companyId);
        const activeDbPath = path.join(companyDir, '.db_active.sqlite');

        if (fs.existsSync(manifestPath)) pathsToCheck.push(manifestPath);
        if (fs.existsSync(dbPath)) pathsToCheck.push(dbPath);
        if (fs.existsSync(activeDbPath)) pathsToCheck.push(activeDbPath);
      }

      for (const p of pathsToCheck) {
        const stat = fs.statSync(p);
        const mtime = stat.mtimeMs;
        const ctime = stat.ctimeMs;
        if (mtime > maxTime) maxTime = mtime;
        if (ctime > maxTime) maxTime = ctime;
      }
    } catch (err) {
      // Non-blocking for missing files
    }

    return maxTime;
  }

  /**
   * Verifies if the current system clock has rolled back behind recorded time states
   */
  public static async verifyClock(companyId?: string, simulatedNow?: number): Promise<ClockVerificationResult> {
    const now = simulatedNow ?? Date.now();

    // 1. Read secure file-based state
    const fileState = await this.readTimeState(companyId);
    if (!fileState.valid && fileState.timestamp > 0) {
      return {
        valid: false,
        code: 'TAMPERED_TIME_STATE',
        currentTime: now,
        lastKnownTime: fileState.timestamp,
        discrepancyMs: fileState.timestamp - now,
        message: 'Local licensing time marker state has been tampered with or corrupted.'
      };
    }

    // 2. Read auxiliary filesystem timestamps
    const fsTime = this.getFilesystemMaxTimestamp(companyId);

    // 3. Determine maximum known watermark
    const baselineLastKnown = Math.max(fileState.timestamp, fsTime);

    // If no prior state exists (fresh environment), clock is considered valid
    if (baselineLastKnown === 0) {
      return {
        valid: true,
        code: 'OK',
        currentTime: now,
        lastKnownTime: now,
        discrepancyMs: 0
      };
    }

    // 4. Check for rollback (allow small tolerance)
    if (now < baselineLastKnown - CLOCK_TOLERANCE_MS) {
      const discrepancyMs = baselineLastKnown - now;
      return {
        valid: false,
        code: 'CLOCK_ROLLBACK_DETECTED',
        currentTime: now,
        lastKnownTime: baselineLastKnown,
        discrepancyMs,
        message: `Unauthorized system clock rollback detected. Current system time (${new Date(now).toISOString()}) is earlier than recorded system activity (${new Date(baselineLastKnown).toISOString()}).`
      };
    }

    return {
      valid: true,
      code: 'OK',
      currentTime: now,
      lastKnownTime: baselineLastKnown,
      discrepancyMs: 0
    };
  }

  /**
   * Advances the last-known-time in the secure file whenever the system clock is confirmed as valid
   * and monotonically increasing, ensuring we never record a future time as the baseline.
   */
  public static async advanceTimeIfValid(companyId?: string, simulatedNow?: number): Promise<{ advanced: boolean; valid: boolean; timestamp: number; code?: string; message?: string }> {
    const now = simulatedNow ?? Date.now();
    const clockCheck = await this.verifyClock(companyId, now);

    if (!clockCheck.valid) {
      // If company context is provided, mark license as TAMPERED in database
      if (companyId) {
        try {
          await db.update(companyLicenses)
            .set({ status: 'TAMPERED', updatedAt: new Date() })
            .where(eq(companyLicenses.companyId, companyId));
        } catch {
          // Non-blocking if DB not ready
        }
      }

      return {
        advanced: false,
        valid: false,
        timestamp: clockCheck.lastKnownTime,
        code: clockCheck.code,
        message: clockCheck.message
      };
    }

    const currentState = await this.readTimeState(companyId);
    const fsTime = this.getFilesystemMaxTimestamp(companyId);
    const baseline = Math.max(currentState.timestamp, fsTime);

    // Only advance when present system time is strictly progressing forward beyond baseline
    if (now >= baseline) {
      await this.recordTimestamp(companyId, now);
      return { advanced: true, valid: true, timestamp: now, code: 'OK' };
    }

    return { advanced: false, valid: true, timestamp: baseline, code: 'OK' };
  }

  /**
   * Updates the secure local file-based time state with the current timestamp
   */
  public static async recordTimestamp(companyId?: string, forcedTimestamp?: number): Promise<number> {
    const now = forcedTimestamp ?? Date.now();
    const currentState = await this.readTimeState(companyId);
    const fsTime = this.getFilesystemMaxTimestamp(companyId);

    const highestKnown = Math.max(currentState.timestamp, fsTime);
    
    // Safety: never record backwards if clock is rolled back beyond tolerance
    if (highestKnown > 0 && now < highestKnown - CLOCK_TOLERANCE_MS) {
      return highestKnown;
    }

    const newTimestamp = Math.max(now, highestKnown);
    const newSequence = (currentState.sequence || 0) + 1;

    const data: TimeStateData = {
      version: 1,
      lastKnownTimestamp: newTimestamp,
      lastKnownIso: new Date(newTimestamp).toISOString(),
      sequence: newSequence,
      companyId: companyId || 'global',
      checksum: this.computeChecksum(newTimestamp, newSequence, companyId || 'global')
    };

    const filePath = paths.getTimeStateFilePath(companyId);
    const tempPath = `${filePath}.tmp`;

    try {
      await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
      await fsPromises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
      await fsPromises.rename(tempPath, filePath);
    } catch (e) {
      // Fallback direct write
      try {
        await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      } catch (err) {
        console.error('[AntiRollbackService] Failed to record time state:', err);
      }
    }

    return newTimestamp;
  }

  /**
   * Starts periodic background heartbeat to advance the last-known-time state
   */
  public static startBackgroundHeartbeat(intervalMs: number = 30000): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(async () => {
      try {
        // Advance global time state
        await this.advanceTimeIfValid();

        // Advance company time states for all active/registered companies
        const companies = await CompanyManager.listCompanies().catch(() => []);
        for (const comp of companies) {
          if (comp && comp.id) {
            await this.advanceTimeIfValid(comp.id);
          }
        }
      } catch (err) {
        // Suppress background errors
      }
    }, intervalMs);

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * Stops the periodic background heartbeat
   */
  public static stopBackgroundHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
