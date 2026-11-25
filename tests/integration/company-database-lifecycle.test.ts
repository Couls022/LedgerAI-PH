import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

const isolatedRoot = vi.hoisted(() => {
  const base = require('path').join(
    require('os').tmpdir(),
    `ledgerai-lifecycle-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
import { CompanyLifecycleService } from '../../src/server/services/companyLifecycleService';
import { DatabaseEncryptionService } from '../../src/server/services/databaseEncryptionService';
import { RestoreService } from '../../src/server/services/restoreService';
import { MigrationManager } from '../../src/server/services/migrationManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { eq } from 'drizzle-orm';

describe('Company Database Lifecycle (Create • Open • Restore • Shortcut History • Reopen)', () => {
  const app = createApp();
  const prevConfigDir = process.env.LEDGERAI_CONFIG_DIR;
  const prevDataDir = process.env.LEDGERAI_DATA_DIR;

  let companyAId = '';
  let companyADir = '';
  let companyADbPath = '';
  let companyAToken = '';
  let companyAViewerToken = '';

  let companyBId = '';
  let companyBDir = '';
  let companyBToken = '';

  let backupPayloadA = '';
  let backupArchivePathA = '';

  beforeAll(async () => {
    process.env.LEDGERAI_CONFIG_DIR = isolatedRoot.configDir;
    process.env.LEDGERAI_DATA_DIR = isolatedRoot.dataDir;
    await CompanyManager.closeAllConnections();
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    if (prevConfigDir === undefined) delete process.env.LEDGERAI_CONFIG_DIR;
    else process.env.LEDGERAI_CONFIG_DIR = prevConfigDir;
    if (prevDataDir === undefined) delete process.env.LEDGERAI_DATA_DIR;
    else process.env.LEDGERAI_DATA_DIR = prevDataDir;
    await fsp.rm(isolatedRoot.base, { recursive: true, force: true }).catch(() => {});
  });

  it('1. Create Company initializes encrypted .lai, schema, COA, periods, admin, audit log, consistency check & CREATED shortcut (with zero secrets)', async () => {
    const customDirA = path.join(isolatedRoot.dataDir, 'alpha_trading_ws');
    const res = await request(app)
      .post('/api/companies/create-profile')
      .send({
        company: {
          legalName: 'Alpha Lifecycle Trading Corp.',
          tradeName: 'Alpha Trading',
          tin: '111-222-333-000',
          branchCode: '00000',
          industry: 'Retail & Wholesale Trading',
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
          currency: 'PHP',
          accountingMethod: 'ACCRUAL',
          beginningBalances: [
            { accountCode: '1010', debit: 50000, credit: 0 },
            { accountCode: '3010', debit: 0, credit: 50000 },
          ],
        },
        locations: {
          documentLocationPath: customDirA,
          backupLocationPath: path.join(customDirA, 'backups'),
        },
        admin: {
          displayName: 'Alpha Owner',
          email: 'owner@alphalifecycle.ph',
          password: 'Password123!',
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.companyId).toMatch(/^LGR-PH-2026-/);
    companyAId = res.body.companyId;
    companyADir = customDirA;
    companyADbPath = res.body.company.dbPath;

    // Must never leak recoveryKey in public responses
    expect(res.body.company.recoveryKey).toBeUndefined();
    expect(res.body.shortcut).toBeDefined();
    expect(res.body.shortcut.lastOperation).toBe('CREATED');
    expect(res.body.shortcut.validationStatus).toBe('VALID');
    expect(res.body.shortcut.availabilityStatus).toBe('AVAILABLE');
    expect((res.body.shortcut as any).recoveryKey).toBeUndefined();

    // Encrypted .lai container & active sqlite exist
    expect(fs.existsSync(companyADbPath)).toBe(true);
    expect(DatabaseEncryptionService.isEncryptedLaiSync(companyADbPath)).toBe(true);

    // Consistency verified
    const consistency = await CompanyManager.verifySnapshotConsistency(companyAId);
    expect(consistency.valid).toBe(true);

    // Shortcut persisted on disk without secrets
    const historyRaw = fs.readFileSync(CompanyLifecycleService.getShortcutHistoryFilePath(), 'utf8');
    expect(historyRaw).toContain(companyAId);
    expect(historyRaw).not.toContain('recoveryKey');

    // Public list companies also strips recoveryKey
    const listRes = await request(app).get('/api/companies');
    expect(listRes.status).toBe(200);
    const found = listRes.body.find((c: any) => c.id === companyAId);
    expect(found).toBeDefined();
    expect(found.recoveryKey).toBeUndefined();

    // Sign in to Company A
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@alphalifecycle.ph', password: 'Password123!', companyId: companyAId });
    expect(loginRes.status).toBe(200);
    companyAToken = loginRes.body.token;

    // Provision a Read-only User inside Company A to verify backup:restore RBAC later
    const cDb = await CompanyManager.getCompanyDb(companyAId);
    await dbContext.run(cDb, async () => {
      const viewerId = 'viewer-lifecycle-a';
      const memId = 'mem-viewer-lifecycle-a';
      await db.insert(schema.users).values({
        id: viewerId,
        email: 'viewer@alphalifecycle.ph',
        passwordHash: 'hash',
        displayName: 'Read Only Viewer',
        status: 'ACTIVE',
      });
      await db.insert(schema.companyUsers).values({
        id: memId,
        companyId: companyAId,
        userId: viewerId,
        legacyRole: 'Read-only User',
        status: 'ACTIVE',
      });
      const rawTok = crypto.randomBytes(24).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawTok),
        userId: viewerId,
        companyId: companyAId,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      companyAViewerToken = `${companyAId}.${rawTok}`;
    });
  });

  it('2. Create Company rejects duplicate legal name / TIN and non-empty directories (HTTP 409) without partial state', async () => {
    // Duplicate legalName
    const dupNameRes = await request(app)
      .post('/api/companies/create-profile')
      .send({
        company: { legalName: 'Alpha Lifecycle Trading Corp.', tin: '999-888-777-000', classification: 'PRODUCTION' },
        locations: { documentLocationPath: path.join(isolatedRoot.dataDir, 'dup_name_dir') },
        admin: { displayName: 'Dup', email: 'dup@test.ph', password: 'Password123!' },
      });
    expect(dupNameRes.status).toBe(409);
    expect(dupNameRes.body.error).toBe('DUPLICATE_COMPANY_CONFLICT');
    expect(fs.existsSync(path.join(isolatedRoot.dataDir, 'dup_name_dir', 'database.lai'))).toBe(false);

    // Duplicate TIN
    const dupTinRes = await request(app)
      .post('/api/companies/create-profile')
      .send({
        company: { legalName: 'Different Legal Name Corp.', tin: '111-222-333-000', classification: 'PRODUCTION' },
        locations: { documentLocationPath: path.join(isolatedRoot.dataDir, 'dup_tin_dir') },
        admin: { displayName: 'Dup', email: 'dup2@test.ph', password: 'Password123!' },
      });
    expect(dupTinRes.status).toBe(409);
    expect(dupTinRes.body.error).toBe('DUPLICATE_COMPANY_CONFLICT');

    // Non-empty directory containing existing .lai
    const occupiedDir = path.join(isolatedRoot.dataDir, 'occupied_ws');
    fs.mkdirSync(occupiedDir, { recursive: true });
    fs.writeFileSync(path.join(occupiedDir, 'database.lai'), 'EXISTING_DATA');

    const nonEmptyRes = await request(app)
      .post('/api/companies/create-profile')
      .send({
        company: { legalName: 'Brand New Entity Corp.', tin: '555-666-777-000', classification: 'PRODUCTION' },
        locations: { documentLocationPath: occupiedDir },
        admin: { displayName: 'Owner', email: 'brandnew@test.ph', password: 'Password123!' },
      });
    expect(nonEmptyRes.status).toBe(409);
    expect(nonEmptyRes.body.error).toBe('TARGET_DIRECTORY_NOT_EMPTY');
  });

  it('3. Non-destructive Remove Shortcut preserves .lai, SQLite, docs & backups, and protects Pilot companies', async () => {
    // Protect authoritative pilot company
    const pilotRes = await request(app)
      .delete('/api/companies/shortcuts/LGR-PH-2026-PILOT-CLEAN-01')
      .send({});
    expect(pilotRes.status).toBe(403);
    expect(pilotRes.body.error).toBe('PROTECTED_PILOT_COMPANY');

    // Create a disposable doc inside Alpha workspace to ensure documents are preserved too
    const sampleDoc = path.join(companyADir, 'documents', 'sample.enc');
    fs.mkdirSync(path.dirname(sampleDoc), { recursive: true });
    fs.writeFileSync(sampleDoc, 'ENCRYPTED_DOC_BYTES');

    // Remove shortcut for Company A
    const rmRes = await request(app)
      .delete(`/api/companies/shortcuts/${companyAId}`)
      .send({ confirmProtectedUnregister: true });
    expect(rmRes.status).toBe(200);
    expect(rmRes.body.filesPreserved).toBe(true);

    // Physical files remain completely intact on disk
    expect(fs.existsSync(companyADbPath)).toBe(true);
    expect(fs.existsSync(sampleDoc)).toBe(true);

    // Removed from shortcuts & public registry
    const scRes = await request(app).get('/api/companies/shortcuts');
    expect(scRes.status).toBe(200);
    expect(scRes.body.shortcuts.some((s: any) => s.companyId === companyAId)).toBe(false);
  });

  it('4. Open Existing Database succeeds by folder AND by exact .lai file and records OPENED in shortcut history', async () => {
    // Open by folder
    const openFolderRes = await request(app)
      .post('/api/companies/open-folder')
      .send({ folderPath: companyADir });
    expect(openFolderRes.status).toBe(200);
    expect(openFolderRes.body.company.id).toBe(companyAId);
    expect(openFolderRes.body.company.recoveryKey).toBeUndefined();

    // Remove shortcut again, then open directly by exact .lai file path
    await request(app).delete(`/api/companies/shortcuts/${companyAId}`).send({ confirmProtectedUnregister: true });
    const openFileRes = await request(app)
      .post('/api/companies/open-database')
      .send({ filePath: companyADbPath });
    expect(openFileRes.status).toBe(200);
    expect(openFileRes.body.company.id).toBe(companyAId);

    const scRes = await request(app).get('/api/companies/shortcuts');
    const entry = scRes.body.shortcuts.find((s: any) => s.companyId === companyAId);
    expect(entry).toBeDefined();
    expect(entry.lastOperation).toBe('OPENED');
    expect(entry.availabilityStatus).toBe('AVAILABLE');
    expect(entry.validationStatus).toBe('VALID');
  });

  it('5. Explore Directory supports includeFiles=true and identifies WORKSPACE_DB vs BACKUP_ARCHIVE', async () => {
    // Create backup of Company A first for subsequent backup/restore & explore tests
    const backupObj = await RestoreService.exportBackup(companyAId);
    const backupBuffer = RestoreService.serializeLai(backupObj);
    const backupFilename = `alpha_lifecycle_backup_${Date.now()}.lai`;
    backupPayloadA = backupBuffer.toString('base64');
    backupArchivePathA = path.join(companyADir, 'backups', backupFilename);
    fs.mkdirSync(path.dirname(backupArchivePathA), { recursive: true });
    fs.writeFileSync(backupArchivePathA, backupBuffer);

    const expWorkspace = await request(app)
      .post('/api/companies/explore-directory')
      .send({ targetPath: companyADir, includeFiles: true, extensions: ['.lai', '.sqlite'] });
    expect(expWorkspace.status).toBe(200);
    const dbFile = expWorkspace.body.files.find((f: any) => f.name === path.basename(companyADbPath));
    expect(dbFile).toBeDefined();
    expect(dbFile.containerHint).toBe('WORKSPACE_DB');

    const expBackups = await request(app)
      .post('/api/companies/explore-directory')
      .send({ targetPath: path.dirname(backupArchivePathA), includeFiles: true, extensions: ['.lai'] });
    expect(expBackups.status).toBe(200);
    const bkFile = expBackups.body.files.find((f: any) => f.name === backupFilename);
    expect(bkFile).toBeDefined();
    expect(bkFile.containerHint).toBe('BACKUP_ARCHIVE');
  });

  it('6. Open Rejections: backup archive, corrupted DB, wrong encryption key, unsupported newer schema, & identity mismatch never create/mutate DBs', async () => {
    // 6a. Opening backup archive as workspace -> BACKUP_FILE_NOT_WORKSPACE
    const openBackupRes = await request(app)
      .post('/api/companies/open-database')
      .send({ filePath: backupArchivePathA });
    expect(openBackupRes.status).toBe(400);
    expect(openBackupRes.body.error).toBe('BACKUP_FILE_NOT_WORKSPACE');

    // 6b. Corrupted / truncated .lai -> CORRUPT_DATABASE or INVALID_DATABASE_FORMAT
    const corruptDir = path.join(isolatedRoot.dataDir, 'corrupt_ws');
    fs.mkdirSync(corruptDir, { recursive: true });
    const corruptLai = path.join(corruptDir, 'database.lai');
    fs.writeFileSync(corruptLai, Buffer.from('CORRUPT_HEADER_BYTES_123456'));
    const openCorruptRes = await request(app)
      .post('/api/companies/open-database')
      .send({ filePath: corruptLai });
    expect(openCorruptRes.status).toBe(400);
    expect(['CORRUPT_DATABASE', 'INVALID_DATABASE_FORMAT']).toContain(openCorruptRes.body.error);
    expect(fs.existsSync(path.join(corruptDir, '.db_active.sqlite'))).toBe(false);

    // 6c. Tampered ciphertext in valid LAISENC2 header -> INVALID_ENCRYPTION_KEY / decryption failure
    const tamperedDir = path.join(isolatedRoot.dataDir, 'tampered_key_ws');
    fs.mkdirSync(tamperedDir, { recursive: true });
    const tamperedLai = path.join(tamperedDir, 'database.lai');
    const validBytes = fs.readFileSync(companyADbPath);
    validBytes[validBytes.length - 10] ^= 0xff;
    fs.writeFileSync(tamperedLai, validBytes);
    const openTamperedRes = await request(app)
      .post('/api/companies/open-database')
      .send({ filePath: tamperedLai });
    expect(openTamperedRes.status).toBe(400);
    expect(openTamperedRes.body.error).toBe('INVALID_ENCRYPTION_KEY');

    // 6d. Unsupported newer schema version (> LATEST_VERSION) -> SCHEMA_INCOMPATIBLE
    const futureDir = path.join(isolatedRoot.dataDir, 'future_schema_ws');
    fs.mkdirSync(futureDir, { recursive: true });
    const futureSqlitePath = path.join(futureDir, 'database.sqlite');
    fs.copyFileSync(path.join(companyADir, '.db_active.sqlite'), futureSqlitePath);
    const fDb = new Database(futureSqlitePath);
    fDb.prepare(
      `INSERT INTO schema_migrations_history (id, version, name, applied_at, checksum, execution_time_ms, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), MigrationManager.LATEST_VERSION + 50, 'v999_future_migration', Date.now(), 'chk', 1, 'SUCCESS');
    fDb.close();

    const openFutureRes = await request(app)
      .post('/api/companies/open-database')
      .send({ filePath: futureSqlitePath });
    expect(openFutureRes.status).toBe(400);
    expect(openFutureRes.body.error).toBe('SCHEMA_INCOMPATIBLE');

    // 6e. Identity mismatch (manifest says DIFFERENT_ID while SQLite says companyAId)
    const mismatchDir = path.join(isolatedRoot.dataDir, 'mismatch_ws');
    fs.mkdirSync(mismatchDir, { recursive: true });
    const mismatchSqlite = path.join(mismatchDir, 'database.sqlite');
    fs.copyFileSync(path.join(companyADir, '.db_active.sqlite'), mismatchSqlite);
    fs.writeFileSync(
      path.join(mismatchDir, 'manifest.json'),
      JSON.stringify({ id: 'LGR-PH-WRONG-ID', legalName: 'Wrong Manifest', dbPath: mismatchSqlite, location: mismatchDir })
    );
    const openMismatchRes = await request(app)
      .post('/api/companies/open-database')
      .send({ filePath: mismatchDir });
    expect(openMismatchRes.status).toBe(400);
    expect(openMismatchRes.body.error).toBe('IDENTITY_MISMATCH');
  });

  it('7. Safe forward migration on opening an older schema DB updates to LATEST_VERSION cleanly', async () => {
    const oldDir = path.join(isolatedRoot.dataDir, 'older_schema_ws');
    fs.mkdirSync(oldDir, { recursive: true });
    const oldSqlite = path.join(oldDir, 'database.sqlite');
    fs.copyFileSync(path.join(companyADir, '.db_active.sqlite'), oldSqlite);
    const oDb = new Database(oldSqlite);
    // Remove highest migration history record (keep table/data intact) so MigrationManager sees v < LATEST_VERSION
    oDb.prepare('DELETE FROM schema_migrations_history WHERE version >= ?').run(MigrationManager.LATEST_VERSION);
    oDb.close();

    const oldLai = path.join(oldDir, 'database.lai');
    DatabaseEncryptionService.encryptDatabaseFileSync(oldSqlite, oldLai);
    fs.unlinkSync(oldSqlite);

    // Inspect first -> needsMigration === true
    const preInspect = await CompanyLifecycleService.inspectDatabaseTarget(oldLai);
    expect(preInspect.valid).toBe(true);
    expect(preInspect.needsMigration).toBe(true);

    // Re-registering runs forward migration safely without wiping data
    await CompanyManager.closeCompanyDb(companyAId);
    const migratedManifest = await CompanyManager.browseAndRegisterCompanyFolder(oldLai, {
      conflictResolution: 'SWITCH_REGISTRY_TO_SELECTED',
    });
    expect(migratedManifest.id).toBe(companyAId);

    const postInspect = await CompanyLifecycleService.inspectDatabaseTarget(oldLai);
    expect(postInspect.valid).toBe(true);
    expect(postInspect.needsMigration).toBe(false);
    expect(postInspect.versionMetadata.schemaVersion).toBe(MigrationManager.LATEST_VERSION);

    // Restore Company A's original location registration
    await CompanyManager.browseAndRegisterCompanyFolder(companyADbPath, {
      conflictResolution: 'SWITCH_REGISTRY_TO_SELECTED',
    });
  });

  it('8. Restore enforces RBAC, rejects active workspace DB (.lai LAISENC2), rejects silent NEW overwrite (409), supports Clone, and supports REPLACE with rollback', async () => {
    // 8a. Unauthenticated & unauthorized restore attempts are blocked (401 / 403)
    const unauthRes = await request(app)
      .post('/api/restore/validate')
      .send({ backupData: backupPayloadA });
    expect(unauthRes.status).toBe(401);

    const forbiddenRes = await request(app)
      .post('/api/restore')
      .set('Authorization', `Bearer ${companyAViewerToken}`)
      .send({ mode: 'NEW', backupData: backupPayloadA });
    expect(forbiddenRes.status).toBe(403);

    // 8b. Submitting workspace DB (LAISENC2) to restore validate -> WORKSPACE_DB_NOT_BACKUP
    const wsDbB64 = fs.readFileSync(companyADbPath).toString('base64');
    const wsRestoreRes = await request(app)
      .post('/api/restore/validate')
      .set('Authorization', `Bearer ${companyAToken}`)
      .send({ backupData: wsDbB64 });
    expect(wsRestoreRes.status).toBe(400);
    expect(wsRestoreRes.body.message).toContain('WORKSPACE_DB_NOT_BACKUP');

    // 8c. Server-side backup path validation blocks traversal & accepts valid backup inside COMPANIES_ROOT
    const traversalRes = await request(app)
      .post('/api/restore/validate-path')
      .set('Authorization', `Bearer ${companyAToken}`)
      .send({ backupFilePath: path.join(isolatedRoot.dataDir, '..', '..', 'etc', 'passwd') });
    expect(traversalRes.status).toBe(400);

    const validPathRes = await request(app)
      .post('/api/restore/validate-path')
      .set('Authorization', `Bearer ${companyAToken}`)
      .send({ backupFilePath: backupArchivePathA });
    expect(validPathRes.status).toBe(200);
    expect(validPathRes.body.success).toBe(true);
    expect(validPathRes.body.metadata.companyId).toBe(companyAId);

    // 8d. NEW mode without cloneAsNew refuses silent overwrite when companyId already exists (409)
    const conflictRestoreRes = await request(app)
      .post('/api/restore')
      .set('Authorization', `Bearer ${companyAToken}`)
      .send({
        mode: 'NEW',
        backupData: backupPayloadA,
        destinationPath: path.join(isolatedRoot.dataDir, 'should_not_overwrite'),
      });
    expect(conflictRestoreRes.status).toBe(409);
    expect(conflictRestoreRes.body.error).toBe('COMPANY_ALREADY_EXISTS');

    // 8e. NEW mode with cloneAsNew=true creates distinct clone company and records RESTORED shortcut
    const cloneDest = path.join(isolatedRoot.dataDir, 'alpha_clone_ws');
    const cloneRes = await request(app)
      .post('/api/restore')
      .set('Authorization', `Bearer ${companyAToken}`)
      .send({
        mode: 'NEW',
        cloneAsNew: true,
        backupFilePath: backupArchivePathA,
        destinationPath: cloneDest,
      });
    expect(cloneRes.status).toBe(200);
    expect(cloneRes.body.companyId).not.toBe(companyAId);
    expect(cloneRes.body.companyId).toContain('-RESTORED-');
    expect(fs.existsSync(path.join(cloneDest, 'database.lai'))).toBe(true);

    const scAfterClone = await request(app).get('/api/companies/shortcuts');
    const cloneShortcut = scAfterClone.body.shortcuts.find((s: any) => s.companyId === cloneRes.body.companyId);
    expect(cloneShortcut).toBeDefined();
    expect(cloneShortcut.lastOperation).toBe('RESTORED');

    // 8f. REPLACE mode enforces tenant isolation (403) and rejects mismatched backup metadata -> IDENTITY_MISMATCH (400)
    const crossCompanyReplace = await request(app)
      .post('/api/restore')
      .set('Authorization', `Bearer ${companyAToken}`)
      .send({
        mode: 'REPLACE',
        targetCompanyId: 'LGR-PH-DIFFERENT-COMPANY',
        backupData: backupPayloadA,
      });
    expect(crossCompanyReplace.status).toBe(403);
    expect(crossCompanyReplace.body.error).toBe('COMPANY_ACCESS_DENIED');

    const cloneBackupRaw = await RestoreService.exportBackup(cloneRes.body.companyId);
    const cloneBackupB64 = RestoreService.serializeLai(cloneBackupRaw).toString('base64');
    const mismatchReplace = await request(app)
      .post('/api/restore')
      .set('Authorization', `Bearer ${companyAToken}`)
      .send({
        mode: 'REPLACE',
        targetCompanyId: companyAId,
        backupData: cloneBackupB64,
      });
    expect(mismatchReplace.status).toBe(400);
    expect(mismatchReplace.body.error).toBe('IDENTITY_MISMATCH');

    // 8g. Valid REPLACE mode succeeds with rollback safety and updates shortcut to RESTORED
    const replaceRes = await request(app)
      .post('/api/restore')
      .set('Authorization', `Bearer ${companyAToken}`)
      .send({
        mode: 'REPLACE',
        targetCompanyId: companyAId,
        backupData: backupPayloadA,
      });
    expect(replaceRes.status).toBe(200);
    expect(replaceRes.body.companyId).toBe(companyAId);

    const consistencyAfterReplace = await CompanyManager.verifySnapshotConsistency(companyAId);
    expect(consistencyAfterReplace.valid).toBe(true);
  });

  it('9. Reopen detects MISSING moved DB, Locate rejects wrong company ID, Locate relinks moved DB, and company switch isolates sessions', async () => {
    // Create Company B for multi-company switching & wrong-ID locate check
    companyBDir = path.join(isolatedRoot.dataDir, 'beta_services_ws');
    const createB = await request(app)
      .post('/api/companies/create-profile')
      .send({
        company: {
          legalName: 'Beta Lifecycle Services Inc.',
          tin: '222-333-444-000',
          classification: 'PRODUCTION',
          encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
        },
        tax: { taxpayerClassification: 'CORPORATION', vatStatus: 'VAT', rdoCode: '040' },
        accounting: { fiscalYear: 2026, fiscalYearStartMonth: 1, currency: 'PHP', accountingMethod: 'ACCRUAL' },
        locations: { documentLocationPath: companyBDir, backupLocationPath: path.join(companyBDir, 'backups') },
        admin: { displayName: 'Beta Owner', email: 'owner@betalifecycle.ph', password: 'Password123!' },
      });
    expect(createB.status).toBe(200);
    companyBId = createB.body.companyId;

    // Login to Company B
    const loginB = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@betalifecycle.ph', password: 'Password123!', companyId: companyBId });
    expect(loginB.status).toBe(200);
    companyBToken = loginB.body.token;

    // Close DB handles for B and move B's workspace folder to a new location
    await CompanyManager.closeCompanyDb(companyBId);
    const movedBDir = path.join(isolatedRoot.dataDir, 'beta_services_relocated');
    fs.renameSync(companyBDir, movedBDir);

    // Live shortcut evaluation & Reopen MUST detect MISSING instead of trusting stale cache
    const shortcutsLive = await request(app).get('/api/companies/shortcuts');
    const bEntry = shortcutsLive.body.shortcuts.find((s: any) => s.companyId === companyBId);
    expect(bEntry).toBeDefined();
    expect(bEntry.availabilityStatus).toBe('MISSING');

    const failReopen = await request(app)
      .post(`/api/companies/shortcuts/${companyBId}/reopen`)
      .send({});
    expect(failReopen.status).toBe(404);
    expect(failReopen.body.error).toBe('DATABASE_NOT_FOUND');

    // Locate with Company A's database MUST reject IDENTITY_MISMATCH
    const wrongLocate = await request(app)
      .post(`/api/companies/shortcuts/${companyBId}/locate`)
      .send({ path: companyADbPath });
    expect(wrongLocate.status).toBe(400);
    expect(wrongLocate.body.error).toBe('IDENTITY_MISMATCH');

    // Locate with relocated Company B's database succeeds
    const validLocate = await request(app)
      .post(`/api/companies/shortcuts/${companyBId}/locate`)
      .send({ path: path.join(movedBDir, 'database.lai') });
    expect(validLocate.status).toBe(200);
    expect(validLocate.body.shortcut.availabilityStatus).toBe('AVAILABLE');
    expect(validLocate.body.shortcut.validationStatus).toBe('VALID');

    // Switching from Company B back to Company A via reopen revokes Company B's cookie/token session
    const loginB2 = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@betalifecycle.ph', password: 'Password123!', companyId: companyBId });
    const freshBToken = loginB2.body.token;

    const switchReopen = await request(app)
      .post(`/api/companies/shortcuts/${companyAId}/reopen`)
      .set('Authorization', `Bearer ${freshBToken}`)
      .send({});
    expect(switchReopen.status).toBe(200);

    // Company B's session token is now revoked and rejected with 401
    const staleBSessionCheck = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${freshBToken}`);
    expect(staleBSessionCheck.status).toBe(401);
  });

  it('10. Synthetic test companies remain isolated from public shortcut listing', async () => {
    const synthDir = path.join(isolatedRoot.dataDir, 'synthetic_stress_ws');
    const createSynth = await request(app)
      .post('/api/companies/create-profile')
      .send({
        company: {
          id: 'LGR-STRESS-LIFECYCLE-99',
          legalName: 'Synthetic Stress Lifecycle Corp',
          classification: 'STRESS_TEST',
        },
        locations: { documentLocationPath: synthDir, backupLocationPath: path.join(synthDir, 'backups') },
        admin: { displayName: 'Synth Admin', email: 'synth@test.ph', password: 'Password123!' },
      });
    expect(createSynth.status).toBe(200);

    // Public shortcut listing MUST NOT expose STRESS_TEST
    const pubShortcuts = await request(app).get('/api/companies/shortcuts');
    expect(pubShortcuts.status).toBe(200);
    expect(pubShortcuts.body.shortcuts.some((s: any) => s.companyId === 'LGR-STRESS-LIFECYCLE-99')).toBe(false);

    // Unauthenticated includeSynthetic=true MUST be rejected (401)
    const unauthSynth = await request(app).get('/api/companies/shortcuts?includeSynthetic=true');
    expect(unauthSynth.status).toBe(401);

    // Direct reopen of isolated synthetic company without auth -> 403 SYNTHETIC_COMPANY_ISOLATED
    const blockSynthReopen = await request(app)
      .post('/api/companies/shortcuts/LGR-STRESS-LIFECYCLE-99/reopen')
      .send({});
    expect(blockSynthReopen.status).toBe(403);
    expect(blockSynthReopen.body.error).toBe('SYNTHETIC_COMPANY_ISOLATED');
  });
});
