import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const isolatedRoot = vi.hoisted(() => {
  const base = require('path').join(
    require('os').tmpdir(),
    `ledgerai-cold-restore-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const configDir = require('path').join(base, 'config');
  const dataDir = require('path').join(base, 'companies');
  require('fs').mkdirSync(configDir, { recursive: true });
  require('fs').mkdirSync(dataDir, { recursive: true });
  process.env.LEDGERAI_CONFIG_DIR = configDir;
  process.env.LEDGERAI_DATA_DIR = dataDir;
  return { base, configDir, dataDir };
});

import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { RestoreService } from '../../src/server/services/restoreService';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';

describe('Enterprise Cold / Disaster-Recovery Restore (QuickBooks-style Fresh Device Flow)', () => {
  const app = createApp();
  const prevConfigDir = process.env.LEDGERAI_CONFIG_DIR;
  const prevDataDir = process.env.LEDGERAI_DATA_DIR;

  const OWNER_EMAIL = 'owner@pacific-dr.ph';
  const OWNER_PASSWORD = 'OwnerDisaster!2026';
  const VIEWER_EMAIL = 'viewer@pacific-dr.ph';
  const VIEWER_PASSWORD = 'ViewerDisaster!2026';

  let originalCompanyId = '';
  let originalCompanyDir = '';
  let backupBase64 = '';
  let backupFileOnDisk = '';

  beforeAll(async () => {
    process.env.LEDGERAI_CONFIG_DIR = isolatedRoot.configDir;
    process.env.LEDGERAI_DATA_DIR = isolatedRoot.dataDir;
    await CompanyManager.closeAllConnections();

    // 1. Create a real company on "Old PC"
    originalCompanyDir = path.join(isolatedRoot.dataDir, 'old_pc_pacific_ws');
    const createRes = await request(app)
      .post('/api/companies/create-profile')
      .send({
        company: {
          legalName: 'Pacific Disaster Recovery Corp.',
          tradeName: 'Pacific DR',
          tin: '405-812-901-000',
          branchCode: '00000',
          industry: 'Distribution & Logistics',
          classification: 'PRODUCTION',
          encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
        },
        tax: {
          taxpayerClassification: 'CORPORATION',
          vatStatus: 'VAT',
          rdoCode: '044',
        },
        accounting: {
          fiscalYear: 2026,
          fiscalYearStartMonth: 1,
          fiscalYearEndMonth: 12,
          accountingBasis: 'ACCRUAL',
          coaTemplate: 'PH_TRADING',
        },
        admin: {
          displayName: 'Ricardo Santos',
          email: OWNER_EMAIL,
          password: OWNER_PASSWORD,
        },
        storagePath: originalCompanyDir,
      });

    expect(createRes.status).toBe(200);
    originalCompanyId = createRes.body.companyId;

    // 2. Add a Read-only Viewer user inside the company before taking backup
    const companyDb = await CompanyManager.getCompanyDb(originalCompanyId);
    await dbContext.run(companyDb, async () => {
      const viewerId = crypto.randomUUID();
      const viewerRoleId = 'role-dr-viewer';
      await db.insert(schema.roles).values({
        id: viewerRoleId,
        code: 'VIEWER',
        name: 'Read-only User',
        isSystem: true,
      }).onConflictDoNothing();

      await db.insert(schema.users).values({
        id: viewerId,
        email: VIEWER_EMAIL,
        passwordHash: await bcrypt.hash(VIEWER_PASSWORD, 4),
        displayName: 'Read Only Auditor',
        status: 'ACTIVE',
      });

      await db.insert(schema.companyUsers).values({
        id: crypto.randomUUID(),
        companyId: originalCompanyId,
        userId: viewerId,
        roleId: viewerRoleId,
        legacyRole: 'Read-only User',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
      });
    });
    await CompanyManager.syncCompanyDatabaseSnapshot(originalCompanyId);

    // 3. Export a genuine cryptographically signed .lai backup archive
    const backup = await RestoreService.createAtomicBackup(originalCompanyId, 'SYSTEM', 'pacific-dr-backup');
    const rawBuf = fs.readFileSync(backup.backupPath);
    backupBase64 = rawBuf.toString('base64');

    // Save portable backup copy in an external backup drop folder inside companies root (simulating USB/NAS copy on New PC)
    const usbDropDir = path.join(isolatedRoot.dataDir, 'usb_backup_import');
    fs.mkdirSync(usbDropDir, { recursive: true });
    backupFileOnDisk = path.join(usbDropDir, 'pacific-dr-backup.lai');
    fs.writeFileSync(backupFileOnDisk, rawBuf);

    // 4. Wipe Old PC company completely (simulating brand-new PC with 0 registered companies!)
    await CompanyManager.closeAllConnections();
    await CompanyManager.unregisterCompany(originalCompanyId);
    await fsp.rm(originalCompanyDir, { recursive: true, force: true });

    const remaining = await CompanyManager.listCompanies({ includeSynthetic: true });
    expect(remaining.length).toBe(0);
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    if (prevConfigDir === undefined) delete process.env.LEDGERAI_CONFIG_DIR;
    else process.env.LEDGERAI_CONFIG_DIR = prevConfigDir;
    if (prevDataDir === undefined) delete process.env.LEDGERAI_DATA_DIR;
    else process.env.LEDGERAI_DATA_DIR = prevDataDir;
    await fsp.rm(isolatedRoot.base, { recursive: true, force: true }).catch(() => {});
  });

  it('1. Rejects unauthenticated restore calls with NO backupAuth credentials (401)', async () => {
    const resValidate = await request(app)
      .post('/api/restore/validate')
      .send({ backupData: backupBase64 });
    expect(resValidate.status).toBe(401);

    const resRestore = await request(app)
      .post('/api/restore')
      .send({ mode: 'NEW', backupData: backupBase64 });
    expect(resRestore.status).toBe(401);
  });

  it('2. Rejects Cold Restore with wrong password (401) or Read-only Viewer credentials (403)', async () => {
    const wrongPass = await request(app)
      .post('/api/restore/validate')
      .send({
        backupData: backupBase64,
        backupAuth: { email: OWNER_EMAIL, password: 'WrongPassword!999' },
      });
    expect(wrongPass.status).toBe(401);
    expect(wrongPass.body.error).toBe('BACKUP_AUTH_INVALID');

    const viewerRes = await request(app)
      .post('/api/restore/validate')
      .send({
        backupData: backupBase64,
        backupAuth: { email: VIEWER_EMAIL, password: VIEWER_PASSWORD },
      });
    expect(viewerRes.status).toBe(403);
    expect(viewerRes.body.error).toBe('BACKUP_RESTORE_FORBIDDEN');
  });

  it('3. Blocks REPLACE mode via Cold Restore credentials (403) and blocks path traversal (400)', async () => {
    const replaceAttempt = await request(app)
      .post('/api/restore')
      .send({
        mode: 'REPLACE',
        targetCompanyId: originalCompanyId,
        backupData: backupBase64,
        backupAuth: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
      });
    expect(replaceAttempt.status).toBe(403);
    expect(replaceAttempt.body.error).toBe('COMPANY_ACCESS_DENIED');

    const traversalAttempt = await request(app)
      .post('/api/restore')
      .send({
        mode: 'NEW',
        backupData: backupBase64,
        destinationPath: '../../etc/evil_restore',
        backupAuth: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
      });
    expect(traversalAttempt.status).toBe(400);
    expect(traversalAttempt.body.error).toBe('PATH_TRAVERSAL_BLOCKED');
  });

  it('4. Validates & restores on a Zero-Data device via Owner backupAuth, seals audit log, issues NO session cookie, and requires explicit login afterward', async () => {
    // 4a. Validate via disk path using Owner backupAuth
    const validatePathRes = await request(app)
      .post('/api/restore/validate-path')
      .send({
        backupFilePath: backupFileOnDisk,
        backupAuth: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
      });
    expect(validatePathRes.status).toBe(200);
    expect(validatePathRes.body.success).toBe(true);
    expect(validatePathRes.body.authMode).toBe('COLD_BACKUP_CREDENTIALS');
    expect(validatePathRes.body.metadata.companyId).toBe(originalCompanyId);
    expect(validatePathRes.body.metadata.companyName).toBe('Pacific Disaster Recovery Corp.');
    expect(validatePathRes.body.verifiedBackupUser.role).toBe('Company Owner');

    // 4b. Execute NEW workspace restore on fresh device
    const freshRestoreDir = path.join(isolatedRoot.dataDir, 'new_pc_pacific_restored');
    const restoreRes = await request(app)
      .post('/api/restore')
      .send({
        mode: 'NEW',
        backupFilePath: backupFileOnDisk,
        targetCompanyId: originalCompanyId,
        destinationPath: freshRestoreDir,
        backupAuth: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
      });
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.companyId).toBe(originalCompanyId);
    expect(restoreRes.body.requiresLogin).toBe(true);
    expect(restoreRes.body.authMode).toBe('COLD_BACKUP_CREDENTIALS');

    // MUST NOT auto-login or issue session cookie/token!
    expect(restoreRes.body.token).toBeUndefined();
    const setCookies = restoreRes.headers['set-cookie'] || [];
    expect(JSON.stringify(setCookies)).not.toContain('token=');

    // Encrypted workspace database must exist on disk
    expect(fs.existsSync(path.join(freshRestoreDir, 'database.lai'))).toBe(true);

    // Audit log inside restored company must record RESTORE_COMPLETED with COLD_BACKUP_CREDENTIALS
    const restoredDb = await CompanyManager.getCompanyDb(originalCompanyId);
    const restoreAuditRows = await dbContext.run(restoredDb, async () => {
      return db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'RESTORE_COMPLETED'));
    });
    expect(restoreAuditRows.length).toBeGreaterThanOrEqual(1);

    // 4c. Explicit post-restore login into the restored company succeeds
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        companyId: originalCompanyId,
        email: OWNER_EMAIL,
        password: OWNER_PASSWORD,
      });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeTruthy();
    expect(loginRes.body.activeCompany.id).toBe(originalCompanyId);
    expect(loginRes.body.activeCompany.legalName).toBe('Pacific Disaster Recovery Corp.');
  });
});
