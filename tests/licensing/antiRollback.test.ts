import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AntiRollbackService } from '../../src/server/services/antiRollbackService';
import { paths } from '../../src/server/services/paths';
import { db } from '../../src/server/db';
import { companyLicenses, companies } from '../../src/server/db/schema';
import { validateActiveLicenseForCompany } from '../../src/server/auth';
import { CompanyManager } from '../../src/server/services/companyManager';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

describe('Local Anti-Rollback Licensing Strategy & Background Monotonic Progress Tests', () => {
  const testConfigDir = path.join(process.cwd(), 'temp_antirollback_config');
  const testCompanyId = 'LGR-PH-2026-TEST-ROLLBACK-01';
  const testCompanyDir = path.join(testConfigDir, 'companies', testCompanyId);

  beforeEach(async () => {
    process.env.LEDGERAI_CONFIG_DIR = testConfigDir;
    process.env.LEDGERAI_DATA_DIR = path.join(testConfigDir, 'companies');
    await fsPromises.rm(testConfigDir, { recursive: true, force: true });
    await fsPromises.mkdir(testConfigDir, { recursive: true });
    await fsPromises.mkdir(testCompanyDir, { recursive: true });
  });

  afterEach(async () => {
    AntiRollbackService.stopBackgroundHeartbeat();
    delete process.env.LEDGERAI_CONFIG_DIR;
    delete process.env.LEDGERAI_DATA_DIR;
    await fsPromises.rm(testConfigDir, { recursive: true, force: true });
  });

  it('1. Normal flow: initial record writes secure file state with valid checksum', async () => {
    const baseTime = Date.now();
    await AntiRollbackService.recordTimestamp(testCompanyId, baseTime);

    const state = await AntiRollbackService.readTimeState(testCompanyId);
    expect(state.valid).toBe(true);
    expect(state.timestamp).toBe(baseTime);
    expect(state.sequence).toBe(1);

    const verification = await AntiRollbackService.verifyClock(testCompanyId, baseTime + 1000);
    expect(verification.valid).toBe(true);
    expect(verification.code).toBe('OK');
  });

  it('2. Clock Rollback Detection: rejects timestamps older than recorded time state', async () => {
    const baseTime = new Date('2026-08-18T12:00:00.000Z').getTime();
    await AntiRollbackService.recordTimestamp(testCompanyId, baseTime);

    // Simulate system clock rolled back by 2 hours
    const rolledBackTime = baseTime - (2 * 60 * 60 * 1000);
    const verification = await AntiRollbackService.verifyClock(testCompanyId, rolledBackTime);

    expect(verification.valid).toBe(false);
    expect(verification.code).toBe('CLOCK_ROLLBACK_DETECTED');
    expect(verification.lastKnownTime).toBe(baseTime);
    expect(verification.discrepancyMs).toBe(2 * 60 * 60 * 1000);
    expect(verification.message).toContain('Unauthorized system clock rollback detected');
  });

  it('3. Tolerates minor jitter / NTP adjustment within tolerance window', async () => {
    const baseTime = Date.now();
    await AntiRollbackService.recordTimestamp(testCompanyId, baseTime);

    // Minor 15-second backward drift (e.g. NTP sync adjustment) is within tolerance (60s)
    const slightDriftTime = baseTime - 15000;
    const verification = await AntiRollbackService.verifyClock(testCompanyId, slightDriftTime);

    expect(verification.valid).toBe(true);
    expect(verification.code).toBe('OK');
  });

  it('4. Filesystem metadata defense: detects rollback even if time state file is missing', async () => {
    const manifestFile = path.join(testCompanyDir, 'manifest.json');
    await fsPromises.writeFile(manifestFile, JSON.stringify({ id: testCompanyId, name: 'Rollback Test' }));

    // Set manifest file mtime to a future timestamp
    const futureTime = new Date('2026-08-18T18:00:00.000Z').getTime();
    fs.utimesSync(manifestFile, new Date(futureTime), new Date(futureTime));

    // Simulate system clock set to 4 hours earlier than file mtime
    const rolledBackTime = futureTime - (4 * 60 * 60 * 1000);
    const verification = await AntiRollbackService.verifyClock(testCompanyId, rolledBackTime);

    expect(verification.valid).toBe(false);
    expect(verification.code).toBe('CLOCK_ROLLBACK_DETECTED');
    expect(verification.lastKnownTime).toBeGreaterThanOrEqual(futureTime);
  });

  it('5. Tamper Resistance: detects modified or corrupted state file checksums', async () => {
    const baseTime = Date.now();
    await AntiRollbackService.recordTimestamp(testCompanyId, baseTime);

    const timeFilePath = paths.getTimeStateFilePath(testCompanyId);
    const content = JSON.parse(await fsPromises.readFile(timeFilePath, 'utf8'));

    // Attacker alters the timestamp without a valid HMAC checksum
    content.lastKnownTimestamp = baseTime - 1000000;
    await fsPromises.writeFile(timeFilePath, JSON.stringify(content, null, 2), 'utf8');

    const state = await AntiRollbackService.readTimeState(testCompanyId);
    expect(state.valid).toBe(false);

    const verification = await AntiRollbackService.verifyClock(testCompanyId, baseTime);
    expect(verification.valid).toBe(false);
    expect(verification.code).toBe('TAMPERED_TIME_STATE');
  });

  it('6. advanceTimeIfValid: periodically advances last-known-time monotonically on valid clock', async () => {
    const t0 = new Date('2026-08-18T10:00:00.000Z').getTime();
    await AntiRollbackService.recordTimestamp(testCompanyId, t0);

    // Advance 5 minutes forward
    const t1 = t0 + 5 * 60 * 1000;
    const result1 = await AntiRollbackService.advanceTimeIfValid(testCompanyId, t1);
    expect(result1.advanced).toBe(true);
    expect(result1.valid).toBe(true);
    expect(result1.timestamp).toBe(t1);

    const state1 = await AntiRollbackService.readTimeState(testCompanyId);
    expect(state1.timestamp).toBe(t1);

    // Attempting to advance to a rolled-back past time is rejected and does not record backwards
    const tPast = t0 - 60 * 60 * 1000;
    const resultPast = await AntiRollbackService.advanceTimeIfValid(testCompanyId, tPast);
    expect(resultPast.advanced).toBe(false);
    expect(resultPast.valid).toBe(false);
    expect(resultPast.code).toBe('CLOCK_ROLLBACK_DETECTED');

    // Secure state retains the monotonic high watermark t1
    const stateAfter = await AntiRollbackService.readTimeState(testCompanyId);
    expect(stateAfter.timestamp).toBe(t1);
  });

  it('7. Auth Integration: locks company license into TAMPERED state on clock discrepancy', async () => {
    // Setup test company & license in DB
    const compId = `LGR-COMP-LOCK-${Date.now()}`;
    const compDir = path.join(testConfigDir, 'companies', compId);
    await fsPromises.mkdir(compDir, { recursive: true });

    await CompanyManager.registerCompany({
      id: compId,
      legalName: 'Tamper Test Corp',
      createdAt: new Date().toISOString(),
      dbPath: path.join(compDir, 'database.lai'),
      documentLocation: path.join(compDir, 'documents'),
      location: compDir,
      backupLocation: path.join(compDir, 'backups'),
      status: 'ACTIVE'
    });

    const targetDb = await CompanyManager.getCompanyDb(compId);

    await targetDb.insert(companies).values({
      id: compId,
      legalName: 'Tamper Test Corp',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const expDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await targetDb.insert(companyLicenses).values({
      id: `lic-${compId}`,
      companyId: compId,
      licenseKey: 'LGR-TRIAL-TEST',
      planType: 'PRO',
      status: 'ACTIVE',
      trialStartDate: new Date().toISOString().slice(0, 10),
      expirationDate: expDate,
      signedFileContent: 'SIGNED_DATA',
      isLifetime: false
    });

    // Record high watermark 2 days in the future to simulate clock having advanced previously
    const futureRecordedTime = Date.now() + (2 * 24 * 60 * 60 * 1000);
    await AntiRollbackService.recordTimestamp(compId, futureRecordedTime);

    // Validate license while current clock is 2 days behind recorded time
    const validation = await validateActiveLicenseForCompany(compId);
    expect(validation.valid).toBe(false);
    expect(validation.code).toBe('TAMPERED');

    // Verify DB record status was forced into TAMPERED
    const dbLicense = await targetDb.select().from(companyLicenses).where(eq(companyLicenses.companyId, compId)).get();
    expect(dbLicense?.status).toBe('TAMPERED');

    // Subsequent validations remain locked in TAMPERED
    const reValidation = await validateActiveLicenseForCompany(compId);
    expect(reValidation.valid).toBe(false);
    expect(reValidation.code).toBe('TAMPERED');
  });
});
