import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createApp } from '../../src/server/app';
import { CompanyManager, CompanyClassification } from '../../src/server/services/companyManager';
import { paths } from '../../src/server/services/paths';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { hashToken } from '../../src/server/auth';

import { PilotCompanyRevalidationService } from '../../src/server/services/pilotCompanyRevalidationService';

describe('REQ-PERF-ISOLATION-001: Synthetic Test and Benchmark Company Isolation', () => {
  const app = createApp();

  const PROD_COMPANY_ID = 'LGR-PH-PROD-ACME-01';
  const PILOT_COMPANY_ID = 'LGR-PH-2026-PILOT-CLEAN-01';
  const DEV_COMPANY_ID = 'LGR-PH-DEV-EXP-01';
  const STRESS_COMPANY_ID = 'LGR-ST-CONCURRENCY-01';
  const BENCH_COMPANY_ID = 'LGR-BENCH-VOLUME';
  const TEST_CORP_COMPANY_ID = 'LGR-PH-2026-TEST-00-ABC12345';
  const DISPOSABLE_COMPANY_ID = 'LGR-PH-DISPOSABLE-99';
  const EXPLICIT_TEST_COMPANY_ID = 'LGR-TEST-CUSTOM-01';

  let ownerToken: string;
  let bookkeeperToken: string;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();

    // Only clean up synthetic/non-pilot test directories; NEVER delete PILOT_COMPANY_ID
    const disposableTestCids = [
      DEV_COMPANY_ID,
      STRESS_COMPANY_ID,
      BENCH_COMPANY_ID,
      TEST_CORP_COMPANY_ID,
      DISPOSABLE_COMPANY_ID,
      EXPLICIT_TEST_COMPANY_ID
    ];

    for (const cid of disposableTestCids) {
      const cdir = path.join(paths.getCompaniesRootDir(), cid);
      if (fs.existsSync(cdir)) {
        try { fs.rmSync(cdir, { recursive: true, force: true }); } catch {}
      }
    }

    // 1. Ensure Production, Authoritative Pilot (unmutated), and Development companies exist
    const prodDir = path.join(paths.getCompaniesRootDir(), PROD_COMPANY_ID);
    if (!fs.existsSync(path.join(prodDir, '.db_active.sqlite')) && !fs.existsSync(path.join(prodDir, 'database.lai'))) {
      await CompanyManager.createCompanyProfile(
        PROD_COMPANY_ID,
        'Acme Manufacturing Philippines Corp.',
        undefined,
        undefined,
        false,
        { classification: 'PRODUCTION' }
      );
    }

    await PilotCompanyRevalidationService.ensureAndVerifyPilotCompany();

    await CompanyManager.createCompanyProfile(
      DEV_COMPANY_ID,
      'Development Sandboxed Testbed',
      undefined,
      undefined,
      false,
      { classification: 'DEVELOPMENT' }
    );

    // 2. Provision Synthetic companies (STRESS_TEST, BENCHMARK, TEST, DISPOSABLE)
    await CompanyManager.createCompanyProfile(
      STRESS_COMPANY_ID,
      'High Concurrency Stress Dataset',
      undefined,
      undefined,
      false,
      { classification: 'STRESS_TEST' }
    );

    await CompanyManager.createCompanyProfile(
      BENCH_COMPANY_ID,
      'Volume Benchmark Performance Dataset',
      undefined,
      undefined,
      false,
      { classification: 'BENCHMARK' }
    );

    await CompanyManager.createCompanyProfile(
      TEST_CORP_COMPANY_ID,
      'LedgerAI PH Test Corp Baseline',
      undefined,
      undefined,
      false,
      { classification: 'TEST' }
    );

    await CompanyManager.createCompanyProfile(
      DISPOSABLE_COMPANY_ID,
      'Disposable Ephemeral Environment',
      undefined,
      undefined,
      false,
      { classification: 'DISPOSABLE' }
    );

    await CompanyManager.createCompanyProfile(
      EXPLICIT_TEST_COMPANY_ID,
      'Explicit Test Fixture Corp',
      undefined,
      undefined,
      false,
      { classification: 'TEST' }
    );

    // 3. Setup Authenticated Users in DEV_COMPANY_ID (so PILOT_COMPANY_ID is never mutated)
    const devDb = await CompanyManager.getCompanyDb(DEV_COMPANY_ID);
    await dbContext.run(devDb, async () => {
      // User 1: Company Owner
      const ownerUserId = 'usr-owner-synth-test';
      await db.insert(schema.users).values({
        id: ownerUserId,
        email: 'owner-test@ledgerai.ph',
        displayName: 'System Owner',
        passwordHash: 'test_hash',
        status: 'ACTIVE'
      }).onConflictDoNothing();

      // User 2: Bookkeeper
      const bookkeeperUserId = 'usr-bk-synth-test';
      await db.insert(schema.users).values({
        id: bookkeeperUserId,
        email: 'bookkeeper-test@ledgerai.ph',
        displayName: 'Standard Bookkeeper',
        passwordHash: 'test_hash',
        status: 'ACTIVE'
      }).onConflictDoNothing();

      // Seed roles in company
      const ownerRoleId = 'role-owner-synth-test';
      await db.insert(schema.roles).values({
        id: ownerRoleId,
        code: 'COMPANY_OWNER',
        name: 'Company Owner',
        description: 'Owner Role',
        isSystem: true
      }).onConflictDoNothing();

      const bkRoleId = 'role-bk-synth-test';
      await db.insert(schema.roles).values({
        id: bkRoleId,
        code: 'BOOKKEEPER',
        name: 'Bookkeeper',
        description: 'Bookkeeper Role',
        isSystem: true
      }).onConflictDoNothing();

      // Memberships in DEV_COMPANY_ID
      const ownerMemId = 'mem-owner-synth-test';
      await db.insert(schema.companyUsers).values({
        id: ownerMemId,
        userId: ownerUserId,
        companyId: DEV_COMPANY_ID,
        roleId: ownerRoleId,
        status: 'ACTIVE'
      }).onConflictDoNothing();

      await db.insert(schema.companyUserRoles).values({
        id: 'cur-owner-synth-test',
        companyUserId: ownerMemId,
        roleId: ownerRoleId
      }).onConflictDoNothing();

      const bkMemId = 'mem-bk-synth-test';
      await db.insert(schema.companyUsers).values({
        id: bkMemId,
        userId: bookkeeperUserId,
        companyId: DEV_COMPANY_ID,
        roleId: bkRoleId,
        status: 'ACTIVE'
      }).onConflictDoNothing();

      await db.insert(schema.companyUserRoles).values({
        id: 'cur-bk-synth-test',
        companyUserId: bkMemId,
        roleId: bkRoleId
      }).onConflictDoNothing();

      // Create active sessions
      const rawOwnerSessionId = crypto.randomBytes(32).toString('hex');
      const hashedOwnerSessionId = hashToken(rawOwnerSessionId);
      await db.insert(schema.sessions).values({
        id: hashedOwnerSessionId,
        userId: ownerUserId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }).onConflictDoNothing();
      ownerToken = `${DEV_COMPANY_ID}.${rawOwnerSessionId}`;

      const rawBkSessionId = crypto.randomBytes(32).toString('hex');
      const hashedBkSessionId = hashToken(rawBkSessionId);
      await db.insert(schema.sessions).values({
        id: hashedBkSessionId,
        userId: bookkeeperUserId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }).onConflictDoNothing();
      bookkeeperToken = `${DEV_COMPANY_ID}.${rawBkSessionId}`;
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
  });

  describe('Criterion 1–5: Default Isolation of Synthetic Datasets', () => {
    it('1. Strictly excludes LGR-PH-2026-TEST-00-ABC12345 by default from CompanyManager.listCompanies and GET /api/companies', async () => {
      const companies = await CompanyManager.listCompanies();
      expect(companies.some((c) => c.id === TEST_CORP_COMPANY_ID)).toBe(false);

      const res = await request(app).get('/api/companies');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((c: any) => c.id === TEST_CORP_COMPANY_ID)).toBe(false);
    });

    it('2. Strictly excludes LGR-BENCH-VOLUME by default from company listings', async () => {
      const companies = await CompanyManager.listCompanies();
      expect(companies.some((c) => c.id === BENCH_COMPANY_ID)).toBe(false);

      const res = await request(app).get('/api/companies');
      expect(res.status).toBe(200);
      expect(res.body.some((c: any) => c.id === BENCH_COMPANY_ID)).toBe(false);
    });

    it('3. Strictly excludes LGR-ST-* prefix stress-test companies by default', async () => {
      const companies = await CompanyManager.listCompanies();
      expect(companies.some((c) => c.id === STRESS_COMPANY_ID)).toBe(false);

      const res = await request(app).get('/api/companies');
      expect(res.status).toBe(200);
      expect(res.body.some((c: any) => c.id === STRESS_COMPANY_ID)).toBe(false);
    });

    it('4. Strictly excludes TEST classification companies by default', async () => {
      const companies = await CompanyManager.listCompanies();
      expect(companies.some((c) => c.id === EXPLICIT_TEST_COMPANY_ID)).toBe(false);

      const res = await request(app).get('/api/companies');
      expect(res.status).toBe(200);
      expect(res.body.some((c: any) => c.id === EXPLICIT_TEST_COMPANY_ID)).toBe(false);
    });

    it('5. Strictly excludes DISPOSABLE classification companies by default', async () => {
      const companies = await CompanyManager.listCompanies();
      expect(companies.some((c) => c.id === DISPOSABLE_COMPANY_ID)).toBe(false);

      const res = await request(app).get('/api/companies');
      expect(res.status).toBe(200);
      expect(res.body.some((c: any) => c.id === DISPOSABLE_COMPANY_ID)).toBe(false);
    });
  });

  describe('Criterion 6–7: Preservation of Operational Companies', () => {
    it('6. Strictly preserves PILOT classification companies in default listings', async () => {
      const companies = await CompanyManager.listCompanies();
      expect(companies.some((c) => c.id === PILOT_COMPANY_ID)).toBe(true);

      const res = await request(app).get('/api/companies');
      expect(res.status).toBe(200);
      const found = res.body.find((c: any) => c.id === PILOT_COMPANY_ID);
      expect(found).toBeDefined();
      expect(found.classification).toBe('PILOT');
    });

    it('7. Strictly preserves PRODUCTION and DEVELOPMENT classification companies in default listings', async () => {
      const companies = await CompanyManager.listCompanies();
      expect(companies.some((c) => c.id === PROD_COMPANY_ID)).toBe(true);
      expect(companies.some((c) => c.id === DEV_COMPANY_ID)).toBe(true);

      const res = await request(app).get('/api/companies');
      expect(res.status).toBe(200);
      const prod = res.body.find((c: any) => c.id === PROD_COMPANY_ID);
      expect(prod).toBeDefined();
      expect(prod.classification).toBe('PRODUCTION');

      const dev = res.body.find((c: any) => c.id === DEV_COMPANY_ID);
      expect(dev).toBeDefined();
      expect(dev.classification).toBe('DEVELOPMENT');
    });
  });

  describe('Criterion 8–11: Authorized Opt-In and Security Gating for includeTestCompanies', () => {
    it('8. Permits Company Owner to include synthetic test companies with includeTestCompanies=true', async () => {
      const res = await request(app)
        .get('/api/companies?includeTestCompanies=true')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((c: any) => c.id === TEST_CORP_COMPANY_ID)).toBe(true);
      expect(res.body.some((c: any) => c.id === BENCH_COMPANY_ID)).toBe(true);
      expect(res.body.some((c: any) => c.id === STRESS_COMPANY_ID)).toBe(true);
      expect(res.body.some((c: any) => c.id === DISPOSABLE_COMPANY_ID)).toBe(true);
    });

    it('9. Rejects unauthenticated request for includeTestCompanies=true with 401 AUTH_REQUIRED', async () => {
      const res = await request(app).get('/api/companies?includeTestCompanies=true');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('AUTH_REQUIRED');
    });

    it('10. Rejects ordinary user (Bookkeeper) request for includeTestCompanies=true with 403 PERMISSION_DENIED', async () => {
      const res = await request(app)
        .get('/api/companies?includeTestCompanies=true')
        .set('Authorization', `Bearer ${bookkeeperToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('PERMISSION_DENIED');
    });

    it('11. Strictly ignores caller-supplied role in query parameters or custom headers', async () => {
      // Unauthenticated caller attempting role spoofing via query param
      const unauthSpoof = await request(app).get('/api/companies?includeTestCompanies=true&role=Company+Owner');
      expect(unauthSpoof.status).toBe(401);
      expect(unauthSpoof.body.error).toBe('AUTH_REQUIRED');

      // Bookkeeper attempting role elevation via query parameter
      const bkQuerySpoof = await request(app)
        .get('/api/companies?includeTestCompanies=true&role=Company+Owner')
        .set('Authorization', `Bearer ${bookkeeperToken}`);
      expect(bkQuerySpoof.status).toBe(403);
      expect(bkQuerySpoof.body.error).toBe('PERMISSION_DENIED');

      // Bookkeeper attempting role elevation via X-User-Role header
      const bkHeaderSpoof = await request(app)
        .get('/api/companies?includeTestCompanies=true')
        .set('Authorization', `Bearer ${bookkeeperToken}`)
        .set('X-User-Role', 'Company Owner');
      expect(bkHeaderSpoof.status).toBe(403);
      expect(bkHeaderSpoof.body.error).toBe('PERMISSION_DENIED');
    });
  });

  describe('Criterion 12: Counts, Filtering, Sorting, and Pagination Integrity', () => {
    it('12. Accurately calculates X-Total-Count, X-Filtered-Count, search, sorting, and pagination headers', async () => {
      // 1. Default non-synthetic request returns accurate headers
      const defaultRes = await request(app).get('/api/companies');
      expect(defaultRes.status).toBe(200);

      const totalNonSynth = Number(defaultRes.headers['x-total-count']);
      const filteredNonSynth = Number(defaultRes.headers['x-filtered-count']);
      expect(totalNonSynth).toBeGreaterThanOrEqual(3); // PROD, PILOT, DEV
      expect(filteredNonSynth).toBe(totalNonSynth);
      expect(defaultRes.body.length).toBe(totalNonSynth);

      // 2. Search filter correctly updates X-Filtered-Count
      const searchRes = await request(app).get('/api/companies?search=Acme');
      expect(searchRes.status).toBe(200);
      expect(Number(searchRes.headers['x-filtered-count'])).toBe(1);
      expect(searchRes.body.length).toBe(1);
      expect(searchRes.body[0].id).toBe(PROD_COMPANY_ID);

      // 3. Paginated format with limit and offset
      const pageRes = await request(app).get('/api/companies?format=paginated&limit=1&offset=0&sortBy=legalName&sortOrder=asc');
      expect(pageRes.status).toBe(200);
      expect(pageRes.body.items).toHaveLength(1);
      expect(pageRes.body.totalCount).toBe(totalNonSynth);
      expect(pageRes.body.filteredCount).toBe(totalNonSynth);
      expect(pageRes.body.offset).toBe(0);
      expect(pageRes.body.limit).toBe(1);

      // 4. Sorting verification
      const ascRes = await request(app).get('/api/companies?sortBy=legalName&sortOrder=asc');
      const descRes = await request(app).get('/api/companies?sortBy=legalName&sortOrder=desc');
      expect(ascRes.status).toBe(200);
      expect(descRes.status).toBe(200);
      expect(ascRes.body[0].legalName).not.toEqual(descRes.body[0].legalName);

      // 5. Authorized synthetic inclusion updates X-Total-Count to include synthetic datasets
      const authSynthRes = await request(app)
        .get('/api/companies?includeTestCompanies=true')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(authSynthRes.status).toBe(200);
      const totalWithSynth = Number(authSynthRes.headers['x-total-count']);
      expect(totalWithSynth).toBeGreaterThan(totalNonSynth);
      expect(totalWithSynth).toBeGreaterThanOrEqual(totalNonSynth + 5);
    });
  });

  describe('Criterion 13: Adversarial X-Allow-Synthetic-Company Header & Direct Company-ID Isolation', () => {
    it('13. Rejects unauthenticated or non-admin X-Allow-Synthetic-Company: true headers and blocks direct GET /api/companies/:id on synthetic companies', async () => {
      // 1. Unauthenticated request with X-Allow-Synthetic-Company: true is rejected with 401 AUTH_REQUIRED
      const unauthHeaderRes = await request(app)
        .get('/api/companies')
        .set('X-Allow-Synthetic-Company', 'true');
      expect(unauthHeaderRes.status).toBe(401);
      expect(unauthHeaderRes.body.error).toBe('AUTH_REQUIRED');

      // 2. Non-admin (Bookkeeper) request with X-Allow-Synthetic-Company: true is rejected with 403 PERMISSION_DENIED
      const bkHeaderRes = await request(app)
        .get('/api/companies')
        .set('Authorization', `Bearer ${bookkeeperToken}`)
        .set('X-Allow-Synthetic-Company', 'true');
      expect(bkHeaderRes.status).toBe(403);
      expect(bkHeaderRes.body.error).toBe('PERMISSION_DENIED');

      // 3. Direct GET /api/companies/:id against synthetic company without opt-in is blocked with 403 SYNTHETIC_COMPANY_ISOLATED
      const directSynthRes = await request(app).get(`/api/companies/${BENCH_COMPANY_ID}`);
      expect(directSynthRes.status).toBe(403);
      expect(directSynthRes.body.error).toBe('SYNTHETIC_COMPANY_ISOLATED');

      // 4. Direct GET /api/companies/:id with X-Allow-Synthetic-Company: true by Bookkeeper is rejected with 403 PERMISSION_DENIED
      const bkDirectSynthRes = await request(app)
        .get(`/api/companies/${BENCH_COMPANY_ID}`)
        .set('Authorization', `Bearer ${bookkeeperToken}`)
        .set('X-Allow-Synthetic-Company', 'true');
      expect(bkDirectSynthRes.status).toBe(403);
      expect(bkDirectSynthRes.body.error).toBe('PERMISSION_DENIED');

      // 5. Direct GET /api/companies/:id with X-Allow-Synthetic-Company: true by Company Owner succeeds
      const ownerDirectSynthRes = await request(app)
        .get(`/api/companies/${BENCH_COMPANY_ID}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Allow-Synthetic-Company', 'true');
      expect(ownerDirectSynthRes.status).toBe(200);
      expect(ownerDirectSynthRes.body.id).toBe(BENCH_COMPANY_ID);
    });
  });

  describe('Criterion 14: Adversarial Purge & Classification Safeguards', () => {
    it('14. Strictly blocks purging PRODUCTION, PILOT, or DEVELOPMENT companies while allowing Company Owner to purge disposable synthetic companies', async () => {
      // 1. Non-admin cannot call POST /api/companies/purge-synthetic
      const bkPurgeRes = await request(app)
        .post('/api/companies/purge-synthetic')
        .set('Authorization', `Bearer ${bookkeeperToken}`)
        .send({ companyId: DISPOSABLE_COMPANY_ID, confirmPurge: true, reason: 'Unauthorized attempt' });
      expect(bkPurgeRes.status).toBe(403);

      // 2. Company Owner attempting to purge PRODUCTION company is strictly blocked (403 PROTECTED_COMPANY_CLASSIFICATION)
      const purgeProdRes = await request(app)
        .post('/api/companies/purge-synthetic')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ companyId: PROD_COMPANY_ID, confirmPurge: true, reason: 'Attempt to purge production' });
      expect(purgeProdRes.status).toBe(403);
      expect(purgeProdRes.body.error).toBe('PROTECTED_COMPANY_CLASSIFICATION');

      // 3. Company Owner attempting to purge PILOT company is strictly blocked (403 PROTECTED_COMPANY_CLASSIFICATION)
      const purgePilotRes = await request(app)
        .post('/api/companies/purge-synthetic')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ companyId: PILOT_COMPANY_ID, confirmPurge: true, reason: 'Attempt to purge pilot' });
      expect(purgePilotRes.status).toBe(403);
      expect(purgePilotRes.body.error).toBe('PROTECTED_COMPANY_CLASSIFICATION');

      // 4. Company Owner attempting to purge without confirmPurge=true is rejected (400)
      const noConfirmRes = await request(app)
        .post('/api/companies/purge-synthetic')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ companyId: DISPOSABLE_COMPANY_ID, confirmPurge: false });
      expect(noConfirmRes.status).toBe(400);

      // 5. Company Owner can purge a DISPOSABLE synthetic company with confirmPurge=true
      const tempDispId = 'TMP-SYNTH-PURGE-001';
      const rootDir = paths.getCompaniesRootDir();
      await CompanyManager.registerCompany({
        id: tempDispId,
        legalName: 'Temp Disposable Purge Co',
        createdAt: '2026-01-20T00:00:00.000Z',
        dbPath: path.join(rootDir, tempDispId, 'database.lai'),
        documentLocation: path.join(rootDir, tempDispId, 'documents'),
        backupLocation: path.join(rootDir, tempDispId, 'backups'),
        location: path.join(rootDir, tempDispId),
        status: 'ACTIVE',
        classification: 'DISPOSABLE',
        isDemo: true,
      });

      const validPurgeRes = await request(app)
        .post('/api/companies/purge-synthetic')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ companyId: tempDispId, confirmPurge: true, reason: 'Clean up disposable test fixture' });
      expect(validPurgeRes.status).toBe(200);
      expect(validPurgeRes.body.purgedCompanyId).toBe(tempDispId);
      expect(validPurgeRes.body.classification).toBe('DISPOSABLE');
    });
  });
});

