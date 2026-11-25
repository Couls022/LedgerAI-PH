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
    `ledgerai-zerodata-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const configDir = require('path').join(base, 'config');
  const dataDir = require('path').join(base, 'companies');
  require('fs').mkdirSync(configDir, { recursive: true });
  require('fs').mkdirSync(dataDir, { recursive: true });
  process.env.LEDGERAI_CONFIG_DIR = configDir;
  process.env.LEDGERAI_DATA_DIR = dataDir;
  process.env.LEDGERAI_ISOLATED_TEST_ROOT = base;
  delete process.env.LEDGERAI_ALLOW_AUTO_DEMO_SEED;
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

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('LEDGERAI PH — Zero-Data Clean Start, Database Package Integrity & Shortcut-Only Clear Certification (12 Criteria)', () => {
  const app = createApp();
  const prevConfigDir = process.env.LEDGERAI_CONFIG_DIR;
  const prevDataDir = process.env.LEDGERAI_DATA_DIR;
  const prevIsolated = process.env.LEDGERAI_ISOLATED_TEST_ROOT;

  let cleanCompanyId = '';
  let cleanCompanyDir = '';
  let cleanCompanyDbPath = '';
  let cleanCompanyToken = '';

  let pilotCompanyDir = '';
  let pilotCompanyDbPath = '';
  const pilotCompanyId = 'LGR-PH-2026-PILOT-CLEAN-01';

  beforeAll(async () => {
    process.env.LEDGERAI_CONFIG_DIR = isolatedRoot.configDir;
    process.env.LEDGERAI_DATA_DIR = isolatedRoot.dataDir;
    process.env.LEDGERAI_ISOLATED_TEST_ROOT = isolatedRoot.base;
    delete process.env.LEDGERAI_ALLOW_AUTO_DEMO_SEED;
    await CompanyManager.closeAllConnections();
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    if (prevConfigDir === undefined) delete process.env.LEDGERAI_CONFIG_DIR;
    else process.env.LEDGERAI_CONFIG_DIR = prevConfigDir;
    if (prevDataDir === undefined) delete process.env.LEDGERAI_DATA_DIR;
    else process.env.LEDGERAI_DATA_DIR = prevDataDir;
    if (prevIsolated === undefined) delete process.env.LEDGERAI_ISOLATED_TEST_ROOT;
    else process.env.LEDGERAI_ISOLATED_TEST_ROOT = prevIsolated;
    await fsp.rm(isolatedRoot.base, { recursive: true, force: true }).catch(() => {});
  });

  it('1-3. Fresh installation & startup have ZERO company profiles, ZERO operational DBs, and ZERO auto-seeded demo/test companies', async () => {
    // Re-run CompanyManager.init() explicitly on clean empty dirs
    await CompanyManager.init();

    // Check 1: Zero company profiles in registry, shortcuts, and APIs
    const regCompanies = await CompanyManager.listCompanies({ includeSynthetic: true });
    expect(regCompanies).toEqual([]);

    const apiCompanies = await request(app).get('/api/companies');
    expect(apiCompanies.status).toBe(200);
    expect(apiCompanies.body).toEqual([]);

    const apiShortcuts = await request(app).get('/api/companies/shortcuts');
    expect(apiShortcuts.status).toBe(200);
    expect(apiShortcuts.body.shortcuts).toEqual([]);

    // Check 2: Zero operational company database directories or files inside COMPANIES_ROOT
    const diskEntries = fs.readdirSync(isolatedRoot.dataDir);
    expect(diskEntries).toEqual([]);

    // Check 3: Ensure no default/test/stress preview company was created during startup
    expect(fs.existsSync(path.join(isolatedRoot.configDir, '.seeded_v1'))).toBe(false);
    expect(fs.existsSync(path.join(isolatedRoot.dataDir, 'LGR-PH-2026-TEST-00-ABC12345'))).toBe(false);
    expect(fs.existsSync(path.join(isolatedRoot.dataDir, 'deskguard_solutions_stress_preview'))).toBe(false);
  });

  it('4-5. Clean starter DB verification passes ONLY on genuinely empty schema DBs and rejects spoofed "blank/starter/empty" files containing hidden data', async () => {
    // Build a genuine clean starter SQLite DB (tables + schema migrations only, ZERO companies/users/business records)
    const genuineStarterPath = path.join(isolatedRoot.dataDir, 'starter-schema-only.sqlite');
    const cleanSqlite = new Database(genuineStarterPath);
    CompanyManager.ensureBaseSchema(cleanSqlite);
    MigrationManager.applyAllMigrations(cleanSqlite, 'STARTER_SCHEMA_TEMPLATE');
    cleanSqlite.close();

    const okRes = await request(app)
      .post('/api/companies/inspect-starter')
      .send({ filePath: genuineStarterPath });
    expect(okRes.status).toBe(200);
    expect(okRes.body.valid).toBe(true);
    expect(okRes.body.isCleanZeroData).toBe(true);
    expect(okRes.body.integrityOk).toBe(true);
    expect(okRes.body.nonZeroTables).toEqual([]);

    // Spoofed filename "blank-empty-clean-starter.sqlite" that secretly contains a hidden company & customer record
    const spoofedStarterPath = path.join(isolatedRoot.dataDir, 'blank-empty-clean-starter.sqlite');
    fs.copyFileSync(genuineStarterPath, spoofedStarterPath);
    const dirtySqlite = new Database(spoofedStarterPath);
    dirtySqlite
      .prepare(`INSERT INTO companies (id, legal_name, status, is_demo) VALUES ('LGR-HIDDEN-DEMO', 'Hidden Sample Corp', 'ACTIVE', 1)`)
      .run();
    dirtySqlite
      .prepare(`INSERT INTO customers (id, company_id, code, legal_name, status) VALUES ('cust-hidden-1', 'LGR-HIDDEN-DEMO', 'CUST-HID-1', 'Secret Customer', 'ACTIVE')`)
      .run();
    dirtySqlite.close();

    const rejectedRes = await request(app)
      .post('/api/companies/inspect-starter')
      .send({ filePath: spoofedStarterPath });
    expect(rejectedRes.status).toBe(400);
    expect(rejectedRes.body.error).toBe('STARTER_CONTAINS_COMPANY_DATA');
    expect(rejectedRes.body.inspection.isCleanZeroData).toBe(false);
    expect(rejectedRes.body.inspection.detectedCompanyIds).toContain('LGR-HIDDEN-DEMO');
    expect(rejectedRes.body.inspection.nonZeroTables.some((t: any) => t.table === 'companies')).toBe(true);
    expect(rejectedRes.body.inspection.nonZeroTables.some((t: any) => t.table === 'customers')).toBe(true);

    // Corrupt starter DB file must also be rejected
    const corruptStarterPath = path.join(isolatedRoot.dataDir, 'blank-corrupt-starter.sqlite');
    fs.writeFileSync(corruptStarterPath, 'NOT_A_VALID_SQLITE_BINARY');
    const corruptRes = await request(app)
      .post('/api/companies/inspect-starter')
      .send({ filePath: corruptStarterPath });
    expect(corruptRes.status).toBe(400);
    expect(['INVALID_DATABASE_FORMAT', 'CORRUPT_DATABASE']).toContain(corruptRes.body.error);

    fs.unlinkSync(genuineStarterPath);
    fs.unlinkSync(spoofedStarterPath);
    fs.unlinkSync(corruptStarterPath);
  });

  it('8-9. Create Company explicitly initializes zero-data company DB with required schema, empty registers, and genuine 0-balance Dashboard', async () => {
    cleanCompanyDir = path.join(isolatedRoot.dataDir, 'clean_enterprise_ph');
    const createRes = await request(app)
      .post('/api/companies/create-profile')
      .send({
        company: {
          legalName: 'Clean Start Enterprise PH Inc.',
          tradeName: 'Clean Start PH',
          tin: '900-111-222-000',
          branchCode: '00000',
          industry: 'Professional Services',
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
          beginningBalances: [],
        },
        locations: {
          documentLocationPath: cleanCompanyDir,
          backupLocationPath: path.join(cleanCompanyDir, 'backups'),
        },
        admin: {
          displayName: 'Clean Owner',
          email: 'owner@cleanstart.ph',
          password: 'Password123!',
        },
      });

    expect(createRes.status).toBe(200);
    cleanCompanyId = createRes.body.companyId;
    cleanCompanyDbPath = createRes.body.company.dbPath;
    expect(fs.existsSync(cleanCompanyDbPath)).toBe(true);

    // Inspect raw DB tables: COA + 12 periods + 1 admin + COMPANY_CREATED audit log ONLY; ZERO business records!
    const cDb = await CompanyManager.getCompanyDb(cleanCompanyId);
    await dbContext.run(cDb, async () => {
      const custCount = (await db.select().from(schema.customers)).length;
      const vendCount = (await db.select().from(schema.vendors)).length;
      const empCount = (await db.select().from(schema.employees)).length;
      const invCount = (await db.select().from(schema.salesInvoices)).length;
      const billCount = (await db.select().from(schema.purchaseBills)).length;
      const bankCount = (await db.select().from(schema.bankAccounts)).length;
      const jeCount = (await db.select().from(schema.journalEntries)).length;
      const acctsCount = (await db.select().from(schema.accounts)).length;
      const periodsCount = (await db.select().from(schema.accountingPeriods)).length;

      expect(custCount).toBe(0);
      expect(vendCount).toBe(0);
      expect(empCount).toBe(0);
      expect(invCount).toBe(0);
      expect(billCount).toBe(0);
      expect(bankCount).toBe(0);
      expect(jeCount).toBe(0);
      expect(acctsCount).toBeGreaterThanOrEqual(20);
      expect(periodsCount).toBeGreaterThanOrEqual(12);
    });

    // Authenticate and verify empty dashboard & register states
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@cleanstart.ph', password: 'Password123!', companyId: cleanCompanyId });
    expect(loginRes.status).toBe(200);
    cleanCompanyToken = loginRes.body.token;

    const dashRes = await request(app)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${cleanCompanyToken}`);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.cashBalance).toBe(0);
    expect(dashRes.body.accountsReceivable).toBe(0);
    expect(dashRes.body.accountsPayable).toBe(0);
    expect(dashRes.body.pendingInvoices).toEqual([]);
    expect(dashRes.body.complianceStatus).toBe('No Records Yet');
    expect(dashRes.body.reconciliationSummary.postedJournalLinesCount).toBe(0);
  });

  it('6. Rejects cross-company / cross-tenant contamination in both SQLite workspace files and backup archives', async () => {
    // 6a. SQLite workspace with multi-company contamination -> CROSS_TENANT_CONTAMINATION
    const multiTenantDir = path.join(isolatedRoot.dataDir, 'cross_tenant_sqlite_ws');
    fs.mkdirSync(multiTenantDir, { recursive: true });
    const contaminatedSqlite = path.join(multiTenantDir, 'database.sqlite');
    fs.copyFileSync(path.join(cleanCompanyDir, '.db_active.sqlite'), contaminatedSqlite);

    const cSqlite = new Database(contaminatedSqlite);
    cSqlite.pragma('foreign_keys = OFF');
    cSqlite
      .prepare(`INSERT INTO customers (id, company_id, code, legal_name, status) VALUES ('cust-foreign-1', 'LGR-FOREIGN-TENANT-999', 'CUST-FOR-1', 'Foreign Customer', 'ACTIVE')`)
      .run();
    cSqlite.close();

    const openContaminatedRes = await request(app)
      .post('/api/companies/open-database')
      .send({ filePath: contaminatedSqlite });
    expect(openContaminatedRes.status).toBe(400);
    expect(openContaminatedRes.body.error).toBe('CROSS_TENANT_CONTAMINATION');

    // 6b. Signed backup archive containing foreign companyId row -> CROSS_TENANT_CONTAMINATION
    const backupPayload = await RestoreService.exportBackup(cleanCompanyId);
    backupPayload.data.customers = [
      { id: 'cust-leaked-foreign', companyId: 'LGR-FOREIGN-LEAK-888', name: 'Foreign Leak Customer', status: 'ACTIVE' },
    ];
    backupPayload.metadata.checksum = RestoreService.generateChecksum(backupPayload.data);
    backupPayload.metadata.signature = RestoreService.generateSignature(backupPayload.data);
    const tamperedTenantBuf = RestoreService.serializeLai(backupPayload).toString('base64');

    const validateCrossRes = await request(app)
      .post('/api/restore/validate')
      .set('Authorization', `Bearer ${cleanCompanyToken}`)
      .send({ backupData: tamperedTenantBuf });
    expect(validateCrossRes.status).toBe(400);
    expect(validateCrossRes.body.error).toBe('CROSS_TENANT_CONTAMINATION');

    fs.rmSync(multiTenantDir, { recursive: true, force: true });
  });

  it('7. Test fixture destructive cleanup guard blocks operations outside isolated test root and blocks protected companies', async () => {
    const externalProdDir = path.join(os.tmpdir(), 'external-prod-companies-must-not-touch');
    expect(() =>
      CompanyManager.assertDestructiveTestOperationAllowed('LGR-TEST-LEAK-CHECK', externalProdDir)
    ).toThrow(/PROHIBITED_DESTRUCTIVE_TEST_OPERATION:.*escapes the designated isolated test root/);

    expect(() =>
      CompanyManager.assertDestructiveTestOperationAllowed(cleanCompanyId, cleanCompanyDir)
    ).toThrow(/PROHIBITED_DESTRUCTIVE_TEST_OPERATION/);

    expect(() =>
      CompanyManager.assertDestructiveTestOperationAllowed(pilotCompanyId, cleanCompanyDir)
    ).toThrow(/PROHIBITED_DESTRUCTIVE_TEST_OPERATION/);
  });

  it('10-12. Delete All Data Register Shortcuts Only clears shortcuts persistently, preserves protected & active DBs intact, allows Reopen, and keeps encryption/integrity/audit intact', async () => {
    // Provision protected authoritative Pilot company inside isolatedRoot
    pilotCompanyDir = path.join(isolatedRoot.dataDir, pilotCompanyId);
    await CompanyManager.createCompanyProfile(
      pilotCompanyId,
      'Luzon Commercial & Industrial Trading Corp.',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );
    const pilotManifest = await CompanyManager.getCompanyManifest(pilotCompanyId);
    pilotCompanyDbPath = pilotManifest!.dbPath;
    expect(fs.existsSync(pilotCompanyDbPath)).toBe(true);

    const preCleanLaiHash = sha256File(cleanCompanyDbPath);
    const prePilotLaiHash = sha256File(pilotCompanyDbPath);

    // Ensure both companies appear in shortcuts before clearing
    const preShortcutsRes = await request(app).get('/api/companies/shortcuts');
    expect(preShortcutsRes.status).toBe(200);
    expect(preShortcutsRes.body.shortcuts.some((s: any) => s.companyId === cleanCompanyId)).toBe(true);
    expect(preShortcutsRes.body.shortcuts.some((s: any) => s.companyId === pilotCompanyId)).toBe(true);

    // Clearing shortcuts without explicit confirmation is rejected
    const unconfirmedClear = await request(app)
      .delete('/api/companies/shortcuts')
      .send({});
    expect(unconfirmedClear.status).toBe(400);
    expect(unconfirmedClear.body.error).toBe('CONFIRMATION_REQUIRED');

    // Execute bulk Delete All Data Register Shortcuts ONLY
    const clearRes = await request(app)
      .delete('/api/companies/shortcuts')
      .send({ confirmClearShortcutsOnly: true });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.success).toBe(true);
    expect(clearRes.body.filesPreserved).toBe(true);
    expect(clearRes.body.databaseDeleted).toBe(false);
    expect(clearRes.body.clearedCount).toBeGreaterThanOrEqual(2);

    // Shortcuts MUST stay empty on subsequent reloads (no auto-backfill from registry.json!)
    const postShortcutsRes = await request(app).get('/api/companies/shortcuts');
    expect(postShortcutsRes.status).toBe(200);
    expect(postShortcutsRes.body.shortcuts).toEqual([]);

    // Physical .lai databases & protected Pilot DB MUST remain 100% intact with identical byte checksums
    expect(fs.existsSync(cleanCompanyDbPath)).toBe(true);
    expect(fs.existsSync(pilotCompanyDbPath)).toBe(true);
    expect(sha256File(cleanCompanyDbPath)).toBe(preCleanLaiHash);
    expect(sha256File(pilotCompanyDbPath)).toBe(prePilotLaiHash);
    expect(DatabaseEncryptionService.isEncryptedLaiSync(cleanCompanyDbPath)).toBe(true);
    expect(DatabaseEncryptionService.isEncryptedLaiSync(pilotCompanyDbPath)).toBe(true);

    // Reopen existing company database explicitly via Browse & Open restores its shortcut ONLY
    const reopenRes = await request(app)
      .post('/api/companies/open-database')
      .send({ filePath: cleanCompanyDbPath });
    expect(reopenRes.status).toBe(200);
    expect(reopenRes.body.company.id).toBe(cleanCompanyId);

    const afterReopenShortcuts = await request(app).get('/api/companies/shortcuts');
    expect(afterReopenShortcuts.body.shortcuts.map((s: any) => s.companyId)).toEqual([cleanCompanyId]);

    // Check Requirement 12: Integrity, migrations, encryption, and immutable audit triggers remain active
    const inspection = await CompanyLifecycleService.inspectDatabaseTarget(cleanCompanyDbPath, {
      expectedCompanyId: cleanCompanyId,
    });
    expect(inspection.valid).toBe(true);
    expect(inspection.versionMetadata.schemaVersion).toBe(MigrationManager.LATEST_VERSION);
    expect(['LAISENC1', 'LAISENC2']).toContain(inspection.versionMetadata.containerFormat);

    const activeSqlite = new Database(path.join(cleanCompanyDir, '.db_active.sqlite'), { readonly: true });
    const integrity = activeSqlite.pragma('integrity_check') as Array<Record<string, any>>;
    expect(Object.values(integrity[0])[0]).toBe('ok');
    const triggers = activeSqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='audit_logs'")
      .all() as Array<{ name: string }>;
    expect(triggers.some((t) => t.name === 'trg_audit_logs_immutable_update')).toBe(true);
    expect(triggers.some((t) => t.name === 'trg_audit_logs_immutable_delete')).toBe(true);
    activeSqlite.close();
  });
});
