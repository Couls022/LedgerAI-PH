import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { paths } from '../../src/server/services/paths';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';

describe('Company Admin Endpoints Auth, Tenant Isolation, Path Traversal & Factory Reset Security', () => {
  const app = createApp();
  const CO_A = 'LGR-SEC-ADM-A-2026';
  const CO_B = 'LGR-SEC-ADM-B-2026';
  const CO_SYNTH = 'LGR-PH-TEST-SEC-SYNTH-2026';

  let ownerTokenA: string;
  let bookkeeperTokenA: string;
  let ownerTokenB: string;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    for (const cid of [CO_A, CO_B, CO_SYNTH]) {
      const dir = path.join(paths.getCompaniesRootDir(), cid);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      await CompanyManager.unregisterCompany(cid).catch(() => {});
    }

    await CompanyManager.createCompanyProfile(CO_A, 'Security Admin Tenant A Corp', undefined, undefined, false, {
      classification: 'PILOT',
    });
    await CompanyManager.createCompanyProfile(CO_B, 'Security Admin Tenant B Corp', undefined, undefined, false, {
      classification: 'PILOT',
    });
    await CompanyManager.createCompanyProfile(CO_SYNTH, 'Security Synthetic Disposable Corp', undefined, undefined, true, {
      classification: 'TEST',
    });

    const seedSession = async (companyId: string, userId: string, roleName: string) => {
      const cdb = await CompanyManager.getCompanyDb(companyId);
      return await dbContext.run(cdb, async () => {
        await RbacService.ensureRoleTemplatesSeeded();
        await db.insert(schema.users).values({
          id: userId,
          email: `${userId}@sec.ledgerai.ph`,
          displayName: `${userId} User`,
          passwordHash: 'test_hash',
          status: 'ACTIVE',
        }).onConflictDoNothing();

        const roleRec = await RbacService.ensureRoleRecord(roleName);
        const memId = `mem-${userId}`;
        await db.insert(schema.companyUsers).values({
          id: memId,
          userId,
          companyId,
          roleId: roleRec.id,
          legacyRole: roleName,
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: 'COMPANY_WIDE',
        }).onConflictDoNothing();
        await RbacService.setMemberRoles(null, memId, [roleName], `Seed ${roleName}`);

        const rawToken = crypto.randomBytes(32).toString('hex');
        await db.insert(schema.sessions).values({
          id: hashToken(rawToken),
          userId,
          companyId,
          expiresAt: new Date(Date.now() + 3600_000),
        });
        return `${companyId}.${rawToken}`;
      });
    };

    ownerTokenA = await seedSession(CO_A, 'usr-sec-adm-owner-a', 'Company Owner');
    bookkeeperTokenA = await seedSession(CO_A, 'usr-sec-adm-bk-a', 'Bookkeeper');
    ownerTokenB = await seedSession(CO_B, 'usr-sec-adm-owner-b', 'Company Owner');
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    for (const cid of [CO_A, CO_B, CO_SYNTH]) {
      const dir = path.join(paths.getCompaniesRootDir(), cid);
      if (fs.existsSync(dir)) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      }
      await CompanyManager.unregisterCompany(cid).catch(() => {});
    }
  });

  it('blocks unauthenticated (401) and non-owner/non-admin (403) access to diagnostics, recovery, integrity, migrations, snapshot, and encryption routes', async () => {
    const protectedGets = [
      `/api/companies/${CO_A}/diagnostics`,
      `/api/companies/${CO_A}/financial-integrity`,
      `/api/companies/${CO_A}/financial-integrity/exception-report`,
      `/api/companies/${CO_A}/migrations`,
      `/api/companies/${CO_A}/snapshot-status`,
      `/api/companies/${CO_A}/encryption/status`,
    ];

    for (const url of protectedGets) {
      const unauthRes = await request(app).get(url);
      expect(unauthRes.status).toBe(401);

      const bkRes = await request(app).get(url).set('Authorization', `Bearer ${bookkeeperTokenA}`);
      expect(bkRes.status).toBe(403);
    }

    const protectedPosts = [
      `/api/companies/${CO_A}/recover`,
      `/api/companies/${CO_A}/snapshot-sync-now`,
      `/api/companies/${CO_A}/encryption/rotate-key`,
      `/api/companies/quarantine-audit`,
      `/api/companies/factory-reset`,
    ];

    for (const url of protectedPosts) {
      const unauthRes = await request(app).post(url).send({});
      expect(unauthRes.status).toBe(401);

      const bkRes = await request(app).post(url).set('Authorization', `Bearer ${bookkeeperTokenA}`).send({});
      expect(bkRes.status).toBe(403);
    }
  });

  it('blocks cross-tenant access from Tenant B Owner to Tenant A administrative/encryption endpoints (403 TENANT_SCOPE_VIOLATION)', async () => {
    const crossGet = await request(app)
      .get(`/api/companies/${CO_A}/diagnostics`)
      .set('Authorization', `Bearer ${ownerTokenB}`);
    expect(crossGet.status).toBe(403);
    expect(crossGet.body.error).toBe('TENANT_SCOPE_VIOLATION');

    const crossEnc = await request(app)
      .get(`/api/companies/${CO_A}/encryption/status`)
      .set('Authorization', `Bearer ${ownerTokenB}`);
    expect(crossEnc.status).toBe(403);
    expect(crossEnc.body.error).toBe('TENANT_SCOPE_VIOLATION');

    const crossDel = await request(app)
      .delete(`/api/companies/${CO_A}`)
      .set('Authorization', `Bearer ${ownerTokenB}`);
    expect(crossDel.status).toBe(403);
    expect(crossDel.body.error).toBe('TENANT_SCOPE_VIOLATION');

    const crossShortcut = await request(app)
      .delete('/api/companies/shortcuts/LGR-PH-2026-PILOT-CLEAN-01')
      .set('Authorization', `Bearer ${ownerTokenB}`);
    expect(crossShortcut.status).toBe(403);
    expect(crossShortcut.body.error).toBe('TENANT_SCOPE_VIOLATION');
  });

  it('blocks path traversal and sensitive system/keystore paths on filesystem routes (400 PATH_TRAVERSAL_BLOCKED)', async () => {
    const dangerousPaths = ['/etc/passwd', '/etc', path.join(paths.getDataDir(), '.keystore_vault')];

    for (const badPath of dangerousPaths) {
      const expRes = await request(app)
        .post('/api/companies/explore-directory')
        .send({ targetPath: badPath });
      expect(expRes.status).toBe(400);
      expect(expRes.body.error).toBe('PATH_TRAVERSAL_BLOCKED');

      const valRes = await request(app)
        .post('/api/companies/validate-folder')
        .send({ folderPath: badPath });
      expect(valRes.status).toBe(400);
      expect(valRes.body.error).toBe('PATH_TRAVERSAL_BLOCKED');

      const openRes = await request(app)
        .post('/api/companies/open-folder')
        .send({ folderPath: badPath });
      expect(openRes.status).toBe(400);
      expect(openRes.body.error).toBe('PATH_TRAVERSAL_BLOCKED');

      const mkRes = await request(app)
        .post('/api/companies/create-folder')
        .send({ parentPath: badPath, folderName: 'probe' });
      expect(mkRes.status).toBe(400);
      expect(mkRes.body.error).toBe('PATH_TRAVERSAL_BLOCKED');
    }
  });

  it('enforces tenant-scoped factory-reset (SYNTHETIC_ONLY preserves PILOT tenants A & B while purging TEST tenant)', async () => {
    const res = await request(app)
      .post('/api/companies/factory-reset')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        confirmFactoryReset: true,
        scope: 'SYNTHETIC_ONLY',
        reason: 'Automated security verification of tenant-safe synthetic reset',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.purgedCount).toBeGreaterThanOrEqual(1);

    const remaining = await CompanyManager.listCompanies({ includeSynthetic: true });
    expect(remaining.some((c) => c.id === CO_A)).toBe(true);
    expect(remaining.some((c) => c.id === CO_B)).toBe(true);
    expect(remaining.some((c) => c.id === CO_SYNTH)).toBe(false);
  });
});
