import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { ServerInstanceLock } from './serverInstanceLock';
import { CompanyManager } from './companyManager';
import { CompanyLifecycleService, sanitizeCompanyForClient } from './companyLifecycleService';
import { createApp } from '../app';
import {
  CompanyPreferenceService,
  StorageLike,
  LEGACY_TOKEN_KEY,
  LAST_COMPANY_PREF_KEY,
  USER_COMPANY_SHORTCUTS_KEY,
} from '../../client/services/companyPreferenceService';

function createMemoryStorage(): StorageLike & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
}

describe('LedgerAI PH — Client-Server Architecture & Multi-Company Verification', () => {
  const tempDirs: string[] = [];
  const createdCompanyIds: string[] = [];

  after(async () => {
    // Clean up any temporary test companies from central registry, shortcuts, and disk
    for (const id of createdCompanyIds) {
      try {
        await CompanyLifecycleService.removeShortcutOnly(id, { confirmProtectedUnregister: true });
      } catch {
        // Ignore if already removed
      }
      try {
        await CompanyManager.deleteCompany(id, { confirmProtectedUnregister: true });
      } catch {
        // Ignore if already deleted
      }
    }
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('CONC-01: ServerInstanceLock prevents duplicate server instances and recovers stale dead PID locks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerai-lock-test-'));
    tempDirs.push(tmpDir);

    const first = ServerInstanceLock.acquire({
      configDir: tmpDir,
      dataDir: tmpDir,
      port: 3000,
      deploymentMode: 'SERVER',
    });
    assert.equal(first.acquired, true);
    assert.equal(fs.existsSync(first.lockFilePath), true);

    // Simulate another live Node server process holding the lock (cross-platform Linux/Windows safe)
    const liveHolder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    assert.ok(liveHolder.pid && liveHolder.pid > 0);
    try {
      fs.writeFileSync(
        first.lockFilePath,
        JSON.stringify({
          pid: liveHolder.pid,
          hostname: 'other-server',
          port: 3000,
          deploymentMode: 'SERVER',
          dataDir: tmpDir,
          startedAt: new Date().toISOString(),
        }),
        'utf8'
      );

      const blocked = ServerInstanceLock.acquire({
        configDir: tmpDir,
        dataDir: tmpDir,
        port: 3001,
        deploymentMode: 'SERVER',
      });
      assert.equal(blocked.acquired, false);
      assert.match(blocked.reason || '', new RegExp(`PID ${liveHolder.pid}`));
    } finally {
      try {
        liveHolder.kill();
      } catch {
        // Ignore cleanup
      }
    }

    // Simulate stale lock from a dead PID (999999)
    fs.writeFileSync(
      first.lockFilePath,
      JSON.stringify({
        pid: 999999,
        hostname: 'dead-server',
        port: 3000,
        deploymentMode: 'SERVER',
        dataDir: tmpDir,
        startedAt: new Date().toISOString(),
      }),
      'utf8'
    );

    const recovered = ServerInstanceLock.acquire({
      configDir: tmpDir,
      dataDir: tmpDir,
      port: 3000,
      deploymentMode: 'SERVER',
    });
    assert.equal(recovered.acquired, true);

    const released = ServerInstanceLock.release(tmpDir);
    assert.equal(released, true);
    assert.equal(fs.existsSync(first.lockFilePath), false);
  });

  it('PREF-01: CompanyPreferenceService isolates browser profiles, stores zero tokens/paths, and preserves preference during server outage', () => {
    const browserProfileA = createMemoryStorage();
    const browserProfileB = createMemoryStorage();

    // Seed a legacy token to verify active purging
    browserProfileA.setItem(LEGACY_TOKEN_KEY, 'leaked-jwt-token');
    CompanyPreferenceService.purgeLegacyLocalStorageTokens(browserProfileA);
    assert.equal(browserProfileA.getItem(LEGACY_TOKEN_KEY), null);

    // Profile A selects Company A; Profile B selects Company B independently
    CompanyPreferenceService.setLastSelectedCompany('comp-alpha', 'Alpha Trading Corp.', browserProfileA);
    CompanyPreferenceService.setLastSelectedCompany('comp-beta', 'Beta Logistics Inc.', browserProfileB);

    assert.equal(CompanyPreferenceService.getLastSelectedCompany(browserProfileA)?.companyId, 'comp-alpha');
    assert.equal(CompanyPreferenceService.getLastSelectedCompany(browserProfileB)?.companyId, 'comp-beta');

    // Verify zero sensitive keys or paths exist in localStorage
    const dumpA = JSON.stringify(browserProfileA.dump());
    assert.doesNotMatch(dumpA, /token|password|dbPath|C:\\|\/var\//i);

    // Startup verification MUST preserve preference when central server is offline (network error or 503)
    const savedA = CompanyPreferenceService.getLastSelectedCompany(browserProfileA);
    const offlineDecision = CompanyPreferenceService.resolveStartupCompanyVerification({
      saved: savedA,
      networkError: true,
    });
    assert.equal(offlineDecision.action, 'SERVER_UNREACHABLE');
    assert.equal(CompanyPreferenceService.getLastSelectedCompany(browserProfileA)?.companyId, 'comp-alpha');

    const gatewayDecision = CompanyPreferenceService.resolveStartupCompanyVerification({
      saved: savedA,
      httpStatus: 503,
    });
    assert.equal(gatewayDecision.action, 'SERVER_UNREACHABLE');

    // Startup verification clears stale preference ONLY on authoritative 404/403/archived
    const deletedDecision = CompanyPreferenceService.resolveStartupCompanyVerification({
      saved: savedA,
      httpStatus: 404,
    });
    assert.equal(deletedDecision.action, 'SHOW_LAUNCHER');
    assert.equal(deletedDecision.clearedStalePreference, true);

    // User-specific pinned shortcuts & recents
    CompanyPreferenceService.recordUserRecentCompany('cpa@firm.ph', 'comp-alpha', 'Alpha Trading Corp.', browserProfileA);
    CompanyPreferenceService.togglePinnedCompany('cpa@firm.ph', 'comp-alpha', browserProfileA);
    const shortcuts = CompanyPreferenceService.getUserCompanyShortcuts('cpa@firm.ph', browserProfileA);
    assert.deepEqual(shortcuts.pinnedCompanyIds, ['comp-alpha']);
    assert.equal(shortcuts.recentCompanies[0]?.companyId, 'comp-alpha');
    assert.ok(browserProfileA.getItem(LAST_COMPANY_PREF_KEY));
    assert.ok(browserProfileA.getItem(USER_COMPANY_SHORTCUTS_KEY));
  });

  it('SEC-01: sanitizeCompanyForClient strips all physical paths for browser/LAN clients and preserves them for localhost standalone', () => {
    const rawCompany = {
      id: 'comp-123',
      legalName: 'Sample PH Corp',
      dbPath: 'C:\\ProgramData\\LedgerAI\\data\\comp-123\\database.lai',
      location: 'C:\\ProgramData\\LedgerAI\\data\\comp-123',
      documentLocation: 'C:\\ProgramData\\LedgerAI\\data\\comp-123\\documents',
      backupLocation: 'C:\\ProgramData\\LedgerAI\\data\\comp-123\\backups',
      databasePath: 'C:\\ProgramData\\LedgerAI\\data\\comp-123\\database.lai',
      companyDirectory: 'C:\\ProgramData\\LedgerAI\\data\\comp-123',
    };

    const forLanClient = sanitizeCompanyForClient(rawCompany, { includePhysicalPaths: false });
    assert.equal(forLanClient.id, 'comp-123');
    assert.equal(forLanClient.legalName, 'Sample PH Corp');
    assert.equal(forLanClient.storageScope, 'SERVER_MANAGED');
    assert.equal(forLanClient.dbPath, undefined);
    assert.equal(forLanClient.location, undefined);
    assert.equal(forLanClient.documentLocation, undefined);
    assert.equal(forLanClient.backupLocation, undefined);
    assert.equal(forLanClient.databasePath, undefined);
    assert.equal(forLanClient.companyDirectory, undefined);

    const forStandalone = sanitizeCompanyForClient(rawCompany, { includePhysicalPaths: true });
    assert.equal(forStandalone.dbPath, rawCompany.dbPath);
    assert.equal(forStandalone.location, rawCompany.location);
  });

  it('CONC-03: CompanyManager.withCompanyWriteLock serializes same-company writes and retries SQLITE_BUSY while running different companies in parallel', async () => {
    const timeline: string[] = [];
    let transientFailureOnce = true;

    const writeA1 = CompanyManager.withCompanyWriteLock('lock-test-a', async () => {
      timeline.push('A1-start');
      await new Promise((r) => setTimeout(r, 40));
      if (transientFailureOnce) {
        transientFailureOnce = false;
        const err: any = new Error('database is locked');
        err.code = 'SQLITE_BUSY';
        throw err;
      }
      timeline.push('A1-end');
      return 'a1-ok';
    });

    const writeA2 = CompanyManager.withCompanyWriteLock('lock-test-a', async () => {
      timeline.push('A2-start');
      await new Promise((r) => setTimeout(r, 15));
      timeline.push('A2-end');
      return 'a2-ok';
    });

    const writeB1 = CompanyManager.withCompanyWriteLock('lock-test-b', async () => {
      timeline.push('B1-start');
      await new Promise((r) => setTimeout(r, 10));
      timeline.push('B1-end');
      return 'b1-ok';
    });

    const results = await Promise.all([writeA1, writeA2, writeB1]);
    assert.deepEqual(results, ['a1-ok', 'a2-ok', 'b1-ok']);

    // A2 must not start until A1 completely finishes (strict per-company serialization)
    assert.ok(timeline.indexOf('A1-end') < timeline.indexOf('A2-start'));
    // B1 must start BEFORE A1 finishes (cross-company parallelism)
    assert.ok(timeline.indexOf('B1-start') < timeline.indexOf('A1-end'));
  });

  it('INT-01: End-to-end multi-company auth, RBAC authorized listing, seamless switch-company, concurrent isolation, and server dashboard telemetry', async () => {
    const app = await createApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerai-cs-int-'));
    tempDirs.push(rootTmp);

    const postJson = async (endpoint: string, body: any, token?: string) => {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, headers: res.headers, json };
    };

    const getJson = async (endpoint: string, token?: string) => {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, headers: res.headers, json };
    };

    try {
      const dirA = path.join(rootTmp, 'company-a');
      const dirB = path.join(rootTmp, 'company-b');
      const dirC = path.join(rootTmp, 'company-c');
      fs.mkdirSync(dirA, { recursive: true });
      fs.mkdirSync(dirB, { recursive: true });
      fs.mkdirSync(dirC, { recursive: true });

      const sharedEmail = 'cpa.shared@ledgerai.test';
      const sharedPass = 'StrongPass123!';

      // Create Company A & B for shared user, and Company C for another isolated user
      const resA = await postJson('/api/companies/create-profile', {
        legalName: 'Alpha MultiCo Inc.',
        tin: '111-222-333-000',
        vatStatus: 'VAT',
        taxpayerType: 'CORPORATION',
        locationPath: dirA,
        admin: {
          displayName: 'Shared CPA',
          email: sharedEmail,
          password: sharedPass,
        },
      });
      assert.ok(resA.status === 200 || resA.status === 201, `Create Company A failed (${resA.status}): ${JSON.stringify(resA.json)}`);
      const compAId = resA.json.companyId || resA.json.id || resA.json.company?.id;
      assert.ok(compAId);
      createdCompanyIds.push(compAId);

      const resB = await postJson('/api/companies/create-profile', {
        legalName: 'Beta MultiCo Inc.',
        tin: '222-333-444-000',
        vatStatus: 'NON_VAT',
        taxpayerType: 'CORPORATION',
        locationPath: dirB,
        admin: {
          displayName: 'Shared CPA',
          email: sharedEmail,
          password: sharedPass,
        },
      });
      assert.ok(resB.status === 200 || resB.status === 201, `Create Company B failed (${resB.status}): ${JSON.stringify(resB.json)}`);
      const compBId = resB.json.companyId || resB.json.id || resB.json.company?.id;
      assert.ok(compBId);
      createdCompanyIds.push(compBId);

      const resC = await postJson('/api/companies/create-profile', {
        legalName: 'Gamma Restricted Corp.',
        tin: '333-444-555-000',
        vatStatus: 'VAT',
        taxpayerType: 'CORPORATION',
        locationPath: dirC,
        admin: {
          displayName: 'Other Owner',
          email: 'other.owner@gamma.ph',
          password: 'OtherPassword123!',
        },
      });
      assert.ok(resC.status === 200 || resC.status === 201, `Create Company C failed (${resC.status}): ${JSON.stringify(resC.json)}`);
      const compCId = resC.json.companyId || resC.json.id || resC.json.company?.id;
      assert.ok(compCId);
      createdCompanyIds.push(compCId);

      // Login User 1 to Company A
      const login1 = await postJson('/api/auth/login', {
        email: sharedEmail,
        password: sharedPass,
        companyId: compAId,
      });
      assert.equal(login1.status, 200);
      const token1 = login1.json.token;
      assert.ok(token1);
      assert.equal(login1.json.activeCompany.id, compAId);

      // Also login a second concurrent session into Company A to confirm switching never breaks other users
      const loginConcurrentA = await postJson('/api/auth/login', {
        email: sharedEmail,
        password: sharedPass,
        companyId: compAId,
      });
      assert.equal(loginConcurrentA.status, 200);
      const concurrentTokenA = loginConcurrentA.json.token;

      // GET /api/companies/authorized must return ONLY A & B (NEVER C) and ZERO physical paths
      const authList = await getJson('/api/companies/authorized', token1);
      assert.equal(authList.status, 200);
      const ids = (authList.json.companies || []).map((c: any) => c.id);
      assert.ok(ids.includes(compAId), 'Company A should be authorized');
      assert.ok(ids.includes(compBId), 'Company B should be authorized');
      assert.equal(ids.includes(compCId), false, 'Unauthorized Company C MUST NOT be visible');
      for (const comp of authList.json.companies) {
        assert.equal(comp.dbPath, undefined, 'Authorized companies must not leak dbPath');
        assert.equal(comp.location, undefined, 'Authorized companies must not leak location');
        assert.equal(comp.storageScope, 'SERVER_MANAGED');
      }

      // Unauthorized switch to Company C must be blocked with 403
      const blockedSwitch = await postJson('/api/auth/switch-company', { targetCompanyId: compCId }, token1);
      assert.equal(blockedSwitch.status, 403);

      // Authorized switch from Company A -> Company B must succeed seamlessly
      const switchRes = await postJson('/api/auth/switch-company', { targetCompanyId: compBId }, token1);
      assert.equal(switchRes.status, 200, `Switch failed: ${JSON.stringify(switchRes.json)}`);
      assert.equal(switchRes.json.switched, true);
      assert.equal(switchRes.json.activeCompany.id, compBId);
      const tokenB = switchRes.json.token;
      assert.ok(tokenB && tokenB !== token1);

      // Verify old session token1 is revoked, new tokenB is active for Company B,
      // AND concurrent user's session in Company A is STILL active and intact!
      const oldSessionCheck = await getJson('/api/auth/session', token1);
      assert.equal(oldSessionCheck.status, 401);

      const newSessionCheck = await getJson('/api/auth/session', tokenB);
      assert.equal(newSessionCheck.status, 200);
      assert.equal(newSessionCheck.json.activeCompany.id, compBId);

      const concurrentCheckA = await getJson('/api/auth/session', concurrentTokenA);
      assert.equal(concurrentCheckA.status, 200);
      assert.equal(concurrentCheckA.json.activeCompany.id, compAId);

      // Verify non-destructive closeOtherCompanyDbs keeps recently active companies open
      await CompanyManager.closeOtherCompanyDbs(compBId, { force: false });
      const poolMetrics = CompanyManager.getPoolMetrics();
      assert.ok(poolMetrics.openCompanyIds.includes(compAId), 'Active/recent Company A DB should stay open');
      assert.ok(poolMetrics.openCompanyIds.includes(compBId), 'Active Company B DB should stay open');

      // Verify GET /api/lan/server-dashboard returns real central server telemetry
      const dashRes = await getJson('/api/lan/server-dashboard', tokenB);
      assert.equal(dashRes.status, 200, `Server dashboard failed: ${JSON.stringify(dashRes.json)}`);
      assert.equal(dashRes.json.serverStatus, 'ONLINE');
      assert.equal(dashRes.json.configuredLanHostname, 'ledgerai.local');
      assert.ok(dashRes.json.registeredCompanyCount >= 3);
      assert.ok(dashRes.json.openDatabaseCount >= 2);
      assert.ok(typeof dashRes.json.databaseStorageBytes === 'number');
      assert.ok(dashRes.json.accessUrls && typeof dashRes.json.accessUrls.localUrl === 'string');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
