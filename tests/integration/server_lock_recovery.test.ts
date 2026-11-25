import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { CompanyManager, CompanyManifest } from '../../src/server/services/companyManager';
import { runInTestDb } from '../setup';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';

describe('REQ-LAN-SYNC-001 & Server Ownership / Crash Recovery Lock Tests', () => {
  const companyId = `comp-lock-test-${Date.now()}`;
  const companyDir = path.join(process.cwd(), 'data', 'companies', companyId);

  beforeAll(async () => {
    fs.mkdirSync(companyDir, { recursive: true });
    const manifest: CompanyManifest = {
      id: companyId,
      legalName: 'Lock Test Corp',
      createdAt: new Date().toISOString(),
      dbPath: path.join(companyDir, 'database.sqlite'),
      documentLocation: companyDir,
      backupLocation: path.join(companyDir, 'backups'),
      location: companyDir,
      status: 'ACTIVE',
      classification: 'TEST'
    };
    CompanyManager.setTempManifest(companyId, manifest);
  });

  afterAll(async () => {
    try {
      CompanyManager.removeTempManifest(companyId);
      fs.rmSync(companyDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('1. Maintains single-process ownership and writes .server_process.lock', async () => {
    await runInTestDb(async () => {
      await CompanyManager.getCompanyDb(companyId, { allowInitializeNew: true });
      const lockFilePath = path.join(companyDir, '.server_process.lock');
      expect(fs.existsSync(lockFilePath)).toBe(true);

      const lockContent = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
      expect(lockContent.pid).toBe(process.pid);
      expect(lockContent.topology).toBe('CENTRALIZED_LAN_API_SERVER');
    });
  });

  it('2. Detects and safely recovers from stale locks after simulated abnormal crash', async () => {
    await CompanyManager.closeCompanyDb(companyId);

    const lockFilePath = path.join(companyDir, '.server_process.lock');
    // Simulate dead PID (e.g. PID 999999 which does not exist)
    fs.writeFileSync(lockFilePath, JSON.stringify({
      pid: 999999,
      lockedAt: new Date(Date.now() - 3600000).toISOString(),
      topology: 'CENTRALIZED_LAN_API_SERVER'
    }));

    // Opening company db should detect stale PID and overwrite lock safely without corrupting data
    await runInTestDb(async () => {
      const sqlite = await CompanyManager.getCompanyDb(companyId);
      expect(sqlite).toBeDefined();

      const newLock = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
      expect(newLock.pid).toBe(process.pid);
    });
  });
});
