import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { execFileSync } from 'child_process';
import { paths } from './paths';

export interface ServerInstanceLockInfo {
  pid: number;
  hostname: string;
  port: number;
  deploymentMode: string;
  dataDir: string;
  startedAt: string;
  processName?: string;
}

export interface AcquireLockResult {
  acquired: boolean;
  lockFilePath: string;
  existingHolder?: ServerInstanceLockInfo | null;
  reason?: string;
}

const LEDGER_RUNTIME_IMAGE_RE = /^(node|electron|ledgerai|tsx|vitest)/i;

export function isLedgerProcessAlive(pid: number, options?: { allowRawPidCheck?: boolean }): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch (err: any) {
    // EPERM means process exists but owned by another user; ESRCH means no such process
    alive = err?.code === 'EPERM';
  }
  if (!alive) return false;

  // On Windows, PIDs are aggressively recycled across unrelated apps (browsers, system tasks).
  // Verify the PID's actual executable image name matches a Node/Electron/LedgerAI runtime.
  if (process.platform === 'win32' && !options?.allowRawPidCheck) {
    try {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        timeout: 2500,
        windowsHide: true,
      }).trim();
      if (!out || /^INFO:/i.test(out)) return false;
      const firstLine = out.split(/\r?\n/).find((l) => l.includes(','));
      if (!firstLine) return false;
      const imageName = firstLine.split(',')[0].replace(/^"|"$/g, '').trim();
      return LEDGER_RUNTIME_IMAGE_RE.test(imageName);
    } catch {
      // Fallback to raw liveness if tasklist fails to invoke
      return true;
    }
  }

  return true;
}

function isProcessAlive(pid: number): boolean {
  return isLedgerProcessAlive(pid);
}

/**
 * Prevents multiple LedgerAI PH server instances from opening the same SQLite/SQLCipher
 * company storage directory simultaneously (Topology C protection).
 */
export class ServerInstanceLock {
  private static heldLockPath: string | null = null;

  static getLockFilePath(configDir?: string): string {
    return path.join(configDir || paths.getConfigDir(), 'ledgerai-server.lock');
  }

  static readLockFile(lockFilePath: string): ServerInstanceLockInfo | null {
    try {
      if (!fs.existsSync(lockFilePath)) return null;
      const raw = fs.readFileSync(lockFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.pid === 'number') {
        return parsed as ServerInstanceLockInfo;
      }
      return null;
    } catch {
      return null;
    }
  }

  static acquire(options: {
    configDir?: string;
    dataDir?: string;
    port: number;
    deploymentMode?: string;
  }): AcquireLockResult {
    const lockFilePath = this.getLockFilePath(options.configDir);
    const parentDir = path.dirname(lockFilePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const payload: ServerInstanceLockInfo = {
      pid: process.pid,
      hostname: os.hostname(),
      port: options.port,
      deploymentMode: options.deploymentMode || process.env.LEDGERAI_DEPLOYMENT_MODE || 'SERVER_AND_DESKTOP',
      dataDir: options.dataDir || paths.getCompaniesRootDir(),
      startedAt: new Date().toISOString(),
      processName: path.basename(process.execPath),
    };

    const tryExclusiveWrite = (): boolean => {
      try {
        const fd = fs.openSync(lockFilePath, 'wx');
        try {
          fs.writeFileSync(fd, JSON.stringify(payload, null, 2), 'utf8');
        } finally {
          fs.closeSync(fd);
        }
        this.heldLockPath = lockFilePath;
        return true;
      } catch (err: any) {
        if (err?.code === 'EEXIST') return false;
        throw err;
      }
    };

    if (tryExclusiveWrite()) {
      return { acquired: true, lockFilePath };
    }

    // Lock file already exists — inspect whether holder PID is alive or stale
    const existing = this.readLockFile(lockFilePath);
    if (existing && existing.pid !== process.pid && isProcessAlive(existing.pid)) {
      return {
        acquired: false,
        lockFilePath,
        existingHolder: existing,
        reason: `Another LedgerAI PH server instance (PID ${existing.pid} on port ${existing.port}) is already managing storage directory "${existing.dataDir}".`,
      };
    }

    // Stale lock from terminated process or same PID restart — reclaim atomically
    try {
      fs.unlinkSync(lockFilePath);
    } catch {
      // Ignore race if already removed
    }

    if (tryExclusiveWrite()) {
      return { acquired: true, lockFilePath };
    }

    const contender = this.readLockFile(lockFilePath);
    return {
      acquired: false,
      lockFilePath,
      existingHolder: contender,
      reason: `Unable to acquire exclusive server instance lock at "${lockFilePath}".`,
    };
  }

  static async probeHealth(port: number, timeoutMs: number = 1500): Promise<boolean> {
    if (!Number.isInteger(port) || port <= 0) return false;
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: timeoutMs }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(false);
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed?.application === 'LedgerAI PH');
          } catch {
            resolve(false);
          }
        });
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  /**
   * Checks existing lock file before acquiring. If the PID is dead, belongs to a recycled
   * non-LedgerAI process, or an aged lock holder is not answering HTTP health on its declared port,
   * the stale lock is removed automatically.
   */
  static async checkAndCleanStaleLock(configDir?: string): Promise<{ activeServer: ServerInstanceLockInfo | null }> {
    const lockFilePath = this.getLockFilePath(configDir);
    const existing = this.readLockFile(lockFilePath);
    if (!existing) return { activeServer: null };
    if (existing.pid === process.pid) return { activeServer: existing };

    if (!isLedgerProcessAlive(existing.pid)) {
      try { fs.unlinkSync(lockFilePath); } catch {}
      return { activeServer: null };
    }

    if (existing.port > 0) {
      const responding = await this.probeHealth(existing.port, 1200);
      if (responding) {
        return { activeServer: existing };
      }

      const ageMs = Date.now() - Date.parse(existing.startedAt || '');
      const isOldAndUnreachable = Number.isFinite(ageMs) && ageMs > 15000;
      if (isOldAndUnreachable && (!existing.hostname || existing.hostname === os.hostname())) {
        try { fs.unlinkSync(lockFilePath); } catch {}
        return { activeServer: null };
      }
    }

    return { activeServer: null };
  }

  static release(configDir?: string): boolean {
    const targetPath = configDir ? this.getLockFilePath(configDir) : this.heldLockPath;
    if (!targetPath) return false;
    try {
      const existing = this.readLockFile(targetPath);
      if (!existing || existing.pid === process.pid) {
        if (fs.existsSync(targetPath)) {
          fs.unlinkSync(targetPath);
        }
        if (this.heldLockPath === targetPath) {
          this.heldLockPath = null;
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
