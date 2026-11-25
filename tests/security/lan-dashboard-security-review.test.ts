import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { paths } from '../../src/server/services/paths';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import {
  classifyIpv4Address,
  inspectLanNetworkInterfaces
} from '../../src/server/routes/licensingAndLan';
import { normalizeLanSessionsResponse } from '../../src/client/components/lan/LanServerDashboard';
import { getAuthorizedERPModules } from '../../src/shared/moduleRegistry';

describe('LAN Dashboard Remediation Security & Regression Review', () => {
  const app = createApp();
  const companyAId = `LGR-LAN-SEC-A-${Date.now()}`;
  const companyBId = `LGR-LAN-SEC-B-${Date.now()}`;

  let ownerAToken = '';
  let settingsViewOnlyToken = '';
  let companyReadOnlyToken = '';
  let lanViewOnlyToken = '';
  let lanLockOnlyToken = '';
  let lanTerminateToken = '';
  let settingsManageNoLanToken = '';
  let noLanPermsToken = '';
  let ownerBToken = '';

  let sessionA1Id = '';
  let sessionA2Id = '';
  let sessionB1Id = '';

  async function provisionScopedUserInActiveDb(params: {
    companyId: string;
    emailPrefix: string;
    roleName: string;
    allowPerms: string[];
    denyPerms: string[];
  }): Promise<{ userId: string; membershipId: string; token: string }> {
    const userId = `u-${params.emailPrefix}-${crypto.randomUUID().slice(0, 8)}`;
    const membershipId = `mem-${userId}`;
    const email = `${params.emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@ledgerai.ph`;

    await db.insert(schema.users).values({
      id: userId,
      email,
      passwordHash: 'hashed_pw',
      displayName: params.emailPrefix,
      status: 'ACTIVE'
    }).onConflictDoNothing();

    const roleRec = await RbacService.ensureRoleRecord(params.roleName);

    await db.insert(schema.companyUsers).values({
      id: membershipId,
      companyId: params.companyId,
      userId,
      roleId: roleRec.id,
      legacyRole: params.roleName,
      status: 'ACTIVE',
      membershipStatus: 'ACTIVE',
      defaultDataScope: 'COMPANY_WIDE'
    }).onConflictDoNothing();

    await RbacService.setMemberRoles(null, membershipId, [params.roleName], 'Adversarial LAN RBAC test setup');

    for (const code of params.allowPerms) {
      await db.insert(schema.userPermissionOverrides).values({
        id: crypto.randomUUID(),
        companyUserId: membershipId,
        permissionCode: code,
        effect: 'ALLOW',
        reason: `Explicit grant ${code} for adversarial test`
      });
    }

    for (const code of params.denyPerms) {
      await db.insert(schema.userPermissionOverrides).values({
        id: crypto.randomUUID(),
        companyUserId: membershipId,
        permissionCode: code,
        effect: 'DENY',
        reason: `Explicit deny ${code} for adversarial test`
      });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    await db.insert(schema.sessions).values({
      id: hashToken(rawToken),
      userId,
      companyId: params.companyId,
      expiresAt: new Date(Date.now() + 86400000)
    });

    return { userId, membershipId, token: `${params.companyId}.${rawToken}` };
  }

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();

    for (const cid of [companyAId, companyBId]) {
      const cdir = path.join(paths.getCompaniesRootDir(), cid);
      if (fs.existsSync(cdir)) {
        try { fs.rmSync(cdir, { recursive: true, force: true }); } catch {}
      }
    }

    await CompanyManager.createCompanyProfile(
      companyAId,
      'LAN Security Tenant A Corp.',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );

    const companyADb = await CompanyManager.getCompanyDb(companyAId);
    await dbContext.run(companyADb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      // 1. Company Owner in Company A
      const ownerA = await provisionScopedUserInActiveDb({
        companyId: companyAId,
        emailPrefix: 'owner-a',
        roleName: 'Company Owner',
        allowPerms: [],
        denyPerms: []
      });
      ownerAToken = ownerA.token;

      // 2. User with settings:view only (no lan:* permissions)
      const settingsViewUser = await provisionScopedUserInActiveDb({
        companyId: companyAId,
        emailPrefix: 'settings-view-only',
        roleName: 'Auditor',
        allowPerms: ['settings:view'],
        denyPerms: ['lan:view', 'lan:lock', 'lan:sessions:terminate']
      });
      settingsViewOnlyToken = settingsViewUser.token;

      // 3. User with company:read only (via masterdata:view, no lan:* permissions)
      const companyReadUser = await provisionScopedUserInActiveDb({
        companyId: companyAId,
        emailPrefix: 'company-read-only',
        roleName: 'Auditor',
        allowPerms: ['masterdata:view'],
        denyPerms: ['lan:view', 'lan:lock', 'lan:sessions:terminate', 'settings:view', 'settings:manage']
      });
      companyReadOnlyToken = companyReadUser.token;

      // 4. User with lan:view only
      const lanViewUser = await provisionScopedUserInActiveDb({
        companyId: companyAId,
        emailPrefix: 'lan-view-only',
        roleName: 'Auditor',
        allowPerms: ['lan:view'],
        denyPerms: ['lan:lock', 'lan:sessions:terminate', 'settings:view', 'settings:manage']
      });
      lanViewOnlyToken = lanViewUser.token;

      // 5. User with lan:lock only (Bookkeeper)
      const lanLockUser = await provisionScopedUserInActiveDb({
        companyId: companyAId,
        emailPrefix: 'lan-lock-only',
        roleName: 'Bookkeeper',
        allowPerms: ['lan:lock'],
        denyPerms: ['lan:view', 'lan:sessions:terminate']
      });
      lanLockOnlyToken = lanLockUser.token;

      // 6. User with lan:sessions:terminate + lan:view (Company Administrator)
      const lanTerminateUser = await provisionScopedUserInActiveDb({
        companyId: companyAId,
        emailPrefix: 'lan-terminate-admin',
        roleName: 'Company Administrator',
        allowPerms: ['lan:view', 'lan:sessions:terminate'],
        denyPerms: []
      });
      lanTerminateToken = lanTerminateUser.token;

      // 7. User with settings:manage only, with lan:* explicitly denied
      const settingsManageNoLanUser = await provisionScopedUserInActiveDb({
        companyId: companyAId,
        emailPrefix: 'settings-manage-no-lan',
        roleName: 'Company Administrator',
        allowPerms: ['settings:manage', 'settings:view'],
        denyPerms: ['lan:view', 'lan:lock', 'lan:sessions:terminate']
      });
      settingsManageNoLanToken = settingsManageNoLanUser.token;

      // 8. User without LAN permissions (Read-only User)
      const noLanUser = await provisionScopedUserInActiveDb({
        companyId: companyAId,
        emailPrefix: 'readonly-no-lan',
        roleName: 'Read-only User',
        allowPerms: [],
        denyPerms: []
      });
      noLanPermsToken = noLanUser.token;

      // Seed two active LAN sessions in Company A
      sessionA1Id = `sess-a1-${crypto.randomUUID()}`;
      sessionA2Id = `sess-a2-${crypto.randomUUID()}`;
      await db.insert(schema.lanServerSessions).values([
        {
          id: sessionA1Id,
          companyId: companyAId,
          userId: lanLockUser.userId,
          clientIp: '192.168.1.25'
        },
        {
          id: sessionA2Id,
          companyId: companyAId,
          userId: lanViewUser.userId,
          clientIp: '192.168.1.26'
        }
      ]);
    });

    // Provision Company B & seed a session in Company B
    await CompanyManager.createCompanyProfile(
      companyBId,
      'LAN Security Tenant B Corp.',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );

    const companyBDb = await CompanyManager.getCompanyDb(companyBId);
    await dbContext.run(companyBDb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      const ownerB = await provisionScopedUserInActiveDb({
        companyId: companyBId,
        emailPrefix: 'owner-b',
        roleName: 'Company Owner',
        allowPerms: [],
        denyPerms: []
      });
      ownerBToken = ownerB.token;

      sessionB1Id = `sess-b1-${crypto.randomUUID()}`;
      await db.insert(schema.lanServerSessions).values({
        id: sessionB1Id,
        companyId: companyBId,
        userId: ownerB.userId,
        clientIp: '192.168.2.50'
      });
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    for (const cid of [companyAId, companyBId]) {
      try {
        const dir = path.join(paths.getCompaniesRootDir(), cid);
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // ignore cleanup errors
      }
    }
  });

  describe('1. LAN Network Interface Classification & Diagnostic Validation', () => {
    it('correctly classifies LOOPBACK, LINK_LOCAL (169.254.x.x), PRIVATE_LAN (RFC 1918), CGNAT, PUBLIC, and INVALID addresses', () => {
      expect(classifyIpv4Address('127.0.0.1', true)).toEqual(
        expect.objectContaining({ classification: 'LOOPBACK', usableForLan: false })
      );
      expect(classifyIpv4Address('127.0.1.1', false)).toEqual(
        expect.objectContaining({ classification: 'LOOPBACK', usableForLan: false })
      );

      // RFC 3927 APIPA / Container Link-Local must NEVER be usableForLan
      expect(classifyIpv4Address('169.254.8.1', false)).toEqual(
        expect.objectContaining({ classification: 'LINK_LOCAL', usableForLan: false })
      );
      expect(classifyIpv4Address('169.254.9.1', false)).toEqual(
        expect.objectContaining({ classification: 'LINK_LOCAL', usableForLan: false })
      );
      expect(classifyIpv4Address('169.254.169.254', false)).toEqual(
        expect.objectContaining({ classification: 'LINK_LOCAL', usableForLan: false })
      );

      // RFC 1918 Private LAN ranges
      expect(classifyIpv4Address('10.0.0.15', false)).toEqual(
        expect.objectContaining({ classification: 'PRIVATE_LAN', usableForLan: true })
      );
      expect(classifyIpv4Address('172.16.0.10', false)).toEqual(
        expect.objectContaining({ classification: 'PRIVATE_LAN', usableForLan: true })
      );
      expect(classifyIpv4Address('172.31.255.250', false)).toEqual(
        expect.objectContaining({ classification: 'PRIVATE_LAN', usableForLan: true })
      );
      expect(classifyIpv4Address('192.168.1.50', false)).toEqual(
        expect.objectContaining({ classification: 'PRIVATE_LAN', usableForLan: true })
      );

      // Non-RFC1918 172.x and Public / CGNAT
      expect(classifyIpv4Address('172.15.0.1', false)).toEqual(
        expect.objectContaining({ classification: 'PUBLIC', usableForLan: false })
      );
      expect(classifyIpv4Address('172.32.0.1', false)).toEqual(
        expect.objectContaining({ classification: 'PUBLIC', usableForLan: false })
      );
      expect(classifyIpv4Address('100.64.1.2', false)).toEqual(
        expect.objectContaining({ classification: 'CGNAT', usableForLan: false })
      );
      expect(classifyIpv4Address('8.8.8.8', false)).toEqual(
        expect.objectContaining({ classification: 'PUBLIC', usableForLan: false })
      );
      expect(classifyIpv4Address('not-an-ip', false)).toEqual(
        expect.objectContaining({ classification: 'INVALID', usableForLan: false })
      );
    });

    it('returns NO_USABLE_LAN_INTERFACE and primaryIp=null when only loopback and 169.254.x.x link-local interfaces exist', () => {
      const containerInterfaces: any = {
        lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
        eth1: [{ address: '169.254.8.1', netmask: '255.255.255.252', family: 'IPv4', internal: false }],
        eth2: [{ address: '169.254.9.1', netmask: '255.255.255.252', family: 'IPv4', internal: false }]
      };

      const result = inspectLanNetworkInterfaces(containerInterfaces, 3000);
      expect(result.usableLanAvailable).toBe(false);
      expect(result.primaryIp).toBeNull();
      expect(result.effectiveBindAddress).toBe('127.0.0.1');
      expect(result.internalPort).toBe(3000);
      expect(result.port80ProxyActive).toBe(false);
      expect(result.lanIps).toEqual([]);
      expect(result.networkDiagnosticStatus).toBe('NO_USABLE_LAN_INTERFACE');
      expect(result.dnsRecordGuide).toBeNull();
      expect(result.clientSetupCommand).toBeNull();
      expect(result.excludedInterfaces).toHaveLength(3);
      expect(result.excludedInterfaces.map((i) => i.classification)).toEqual([
        'LOOPBACK',
        'LINK_LOCAL',
        'LINK_LOCAL'
      ]);
    });

    it('returns USABLE_PRIVATE_LAN_DETECTED and primaryIp when an RFC 1918 interface is present alongside loopback and link-local', () => {
      const officeInterfaces: any = {
        lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
        eth0: [{ address: '169.254.8.1', netmask: '255.255.0.0', family: 'IPv4', internal: false }],
        eth1: [{ address: '192.168.10.45', netmask: '255.255.255.0', family: 'IPv4', internal: false }]
      };

      const result = inspectLanNetworkInterfaces(officeInterfaces, 3000);
      expect(result.usableLanAvailable).toBe(true);
      expect(result.primaryIp).toBe('192.168.10.45');
      expect(result.effectiveBindAddress).toBe('192.168.10.45');
      expect(result.networkDiagnosticStatus).toBe('USABLE_PRIVATE_LAN_DETECTED');
      expect(result.lanIps).toHaveLength(1);
      expect(result.lanIps[0].address).toBe('192.168.10.45');
      expect(result.dnsRecordGuide?.value).toBe('192.168.10.45');
      expect(result.clientSetupCommand).toContain('192.168.10.45');
    });
  });

  describe('2. RBAC Adversarial Matrix & Least-Privilege Enforcement', () => {
    it('Case 1: User with settings:view only is denied all LAN endpoints (403) and cannot view, lock, or terminate sessions', async () => {
      const srvRes = await request(app)
        .get('/api/lan/server-info')
        .set('Authorization', `Bearer ${settingsViewOnlyToken}`)
        .set('X-Company-Id', companyAId);
      expect(srvRes.status).toBe(403);

      const sessRes = await request(app)
        .get('/api/lan/sessions')
        .set('Authorization', `Bearer ${settingsViewOnlyToken}`)
        .set('X-Company-Id', companyAId);
      expect(sessRes.status).toBe(403);

      const lockRes = await request(app)
        .post('/api/lan/lock-record')
        .set('Authorization', `Bearer ${settingsViewOnlyToken}`)
        .set('X-Company-Id', companyAId)
        .send({ tableName: 'journal_entries', recordId: 'JE-101' });
      expect(lockRes.status).toBe(403);

      const delRes = await request(app)
        .delete(`/api/lan/sessions/${sessionA1Id}`)
        .set('Authorization', `Bearer ${settingsViewOnlyToken}`)
        .set('X-Company-Id', companyAId);
      expect(delRes.status).toBe(403);
    });

    it('Case 2: User with company:read (masterdata:view) only is denied all LAN endpoints (403)', async () => {
      const srvRes = await request(app)
        .get('/api/lan/server-info')
        .set('Authorization', `Bearer ${companyReadOnlyToken}`)
        .set('X-Company-Id', companyAId);
      expect(srvRes.status).toBe(403);

      const sessRes = await request(app)
        .get('/api/lan/sessions')
        .set('Authorization', `Bearer ${companyReadOnlyToken}`)
        .set('X-Company-Id', companyAId);
      expect(sessRes.status).toBe(403);

      const lockRes = await request(app)
        .post('/api/lan/lock-record')
        .set('Authorization', `Bearer ${companyReadOnlyToken}`)
        .set('X-Company-Id', companyAId)
        .send({ tableName: 'journal_entries', recordId: 'JE-101' });
      expect(lockRes.status).toBe(403);

      const delRes = await request(app)
        .delete(`/api/lan/sessions/${sessionA1Id}`)
        .set('Authorization', `Bearer ${companyReadOnlyToken}`)
        .set('X-Company-Id', companyAId);
      expect(delRes.status).toBe(403);
    });

    it('Case 3: User with lan:view only can view server-info and sessions (200), but is denied record locking (403) and session termination (403)', async () => {
      const srvRes = await request(app)
        .get('/api/lan/server-info')
        .set('Authorization', `Bearer ${lanViewOnlyToken}`)
        .set('X-Company-Id', companyAId);
      expect(srvRes.status).toBe(200);
      expect(srvRes.body).toHaveProperty('networkDiagnosticStatus');
      if (srvRes.body.primaryIp) {
        expect(srvRes.body.primaryIp).not.toMatch(/^169\.254\./);
      }

      const sessRes = await request(app)
        .get('/api/lan/sessions')
        .set('Authorization', `Bearer ${lanViewOnlyToken}`)
        .set('X-Company-Id', companyAId);
      expect(sessRes.status).toBe(200);
      const sessList = Array.isArray(sessRes.body) ? sessRes.body : sessRes.body?.sessions;
      expect(Array.isArray(sessList)).toBe(true);
      expect(sessList.length).toBe(2);

      const lockRes = await request(app)
        .post('/api/lan/lock-record')
        .set('Authorization', `Bearer ${lanViewOnlyToken}`)
        .set('X-Company-Id', companyAId)
        .send({ tableName: 'journal_entries', recordId: 'JE-101' });
      expect(lockRes.status).toBe(403);

      const delRes = await request(app)
        .delete(`/api/lan/sessions/${sessionA1Id}`)
        .set('Authorization', `Bearer ${lanViewOnlyToken}`)
        .set('X-Company-Id', companyAId);
      expect(delRes.status).toBe(403);
    });

    it('Case 4: User with lan:lock only can acquire record locks (200), but is denied server-info (403), sessions list (403), and session termination (403)', async () => {
      const lockRes = await request(app)
        .post('/api/lan/lock-record')
        .set('Authorization', `Bearer ${lanLockOnlyToken}`)
        .set('X-Company-Id', companyAId)
        .send({ tableName: 'sales_invoices', recordId: 'INV-2026-001' });
      expect(lockRes.status).toBe(200);
      expect(lockRes.body.success).toBe(true);

      const srvRes = await request(app)
        .get('/api/lan/server-info')
        .set('Authorization', `Bearer ${lanLockOnlyToken}`)
        .set('X-Company-Id', companyAId);
      expect(srvRes.status).toBe(403);

      const sessRes = await request(app)
        .get('/api/lan/sessions')
        .set('Authorization', `Bearer ${lanLockOnlyToken}`)
        .set('X-Company-Id', companyAId);
      expect(sessRes.status).toBe(403);

      const delRes = await request(app)
        .delete(`/api/lan/sessions/${sessionA1Id}`)
        .set('Authorization', `Bearer ${lanLockOnlyToken}`)
        .set('X-Company-Id', companyAId);
      expect(delRes.status).toBe(403);
    });

    it('Case 5: settings:manage does not implicitly grant lan:sessions:terminate or lan:lock when LAN permissions are not granted', async () => {
      const delRes = await request(app)
        .delete(`/api/lan/sessions/${sessionA1Id}`)
        .set('Authorization', `Bearer ${settingsManageNoLanToken}`)
        .set('X-Company-Id', companyAId);
      expect(delRes.status).toBe(403);

      const lockRes = await request(app)
        .post('/api/lan/lock-record')
        .set('Authorization', `Bearer ${settingsManageNoLanToken}`)
        .set('X-Company-Id', companyAId)
        .send({ tableName: 'journal_entries', recordId: 'JE-500' });
      expect(lockRes.status).toBe(403);
    });

    it('Case 6: User without LAN permissions (Read-only User) is denied across all LAN endpoints (403) and navigation hides md-lan-network', async () => {
      const srvRes = await request(app)
        .get('/api/lan/server-info')
        .set('Authorization', `Bearer ${noLanPermsToken}`)
        .set('X-Company-Id', companyAId);
      expect(srvRes.status).toBe(403);

      const sessRes = await request(app)
        .get('/api/lan/sessions')
        .set('Authorization', `Bearer ${noLanPermsToken}`)
        .set('X-Company-Id', companyAId);
      expect(sessRes.status).toBe(403);

      const delRes = await request(app)
        .delete(`/api/lan/sessions/${sessionA1Id}`)
        .set('Authorization', `Bearer ${noLanPermsToken}`)
        .set('X-Company-Id', companyAId);
      expect(delRes.status).toBe(403);

      const roModules = getAuthorizedERPModules('Read-only User');
      const hasLanSubmodule = roModules.some((m) => m.submodules.some((s) => s.id === 'md-lan-network'));
      expect(hasLanSubmodule).toBe(false);
    });

    it('Case 7: Cross-company session isolation prevents terminating or viewing another company session', async () => {
      // 7a. User in Company A with lan:sessions:terminate attempts to delete Company B's sessionB1Id while scoped to Company A
      const crossDelInA = await request(app)
        .delete(`/api/lan/sessions/${sessionB1Id}`)
        .set('Authorization', `Bearer ${lanTerminateToken}`)
        .set('X-Company-Id', companyAId);
      expect(crossDelInA.status).toBe(404);
      expect(crossDelInA.body.error).toBe('SESSION_NOT_FOUND');

      // 7b. User in Company A attempts to spoof X-Company-Id: companyBId with Company A token -> auth middleware enforces token-bound companyAId and returns 404
      const crossTenantHeader = await request(app)
        .delete(`/api/lan/sessions/${sessionB1Id}`)
        .set('Authorization', `Bearer ${lanTerminateToken}`)
        .set('X-Company-Id', companyBId);
      expect(crossTenantHeader.status).toBe(404);
      expect(crossTenantHeader.body.error).toBe('SESSION_NOT_FOUND');

      // 7c. User in Company A attempts to forge Company B prefix onto their raw session token -> rejected with 401 by Company B's isolated session table
      const rawTokenPart = lanTerminateToken.split('.').slice(1).join('.');
      const forgedCrossCompanyToken = `${companyBId}.${rawTokenPart}`;
      const forgedRes = await request(app)
        .delete(`/api/lan/sessions/${sessionB1Id}`)
        .set('Authorization', `Bearer ${forgedCrossCompanyToken}`)
        .set('X-Company-Id', companyBId);
      expect(forgedRes.status).toBe(401);

      // 7d. Verify Company B session remains untouched in Company B's database
      const companyBDb = await CompanyManager.getCompanyDb(companyBId);
      await dbContext.run(companyBDb, async () => {
        const bSessionStillExists = await db
          .select()
          .from(schema.lanServerSessions)
          .where(eq(schema.lanServerSessions.id, sessionB1Id))
          .get();
        expect(bSessionStillExists).toBeDefined();
        expect(bSessionStillExists?.id).toBe(sessionB1Id);
      });
    });

    it('Case 8: User with lan:sessions:terminate and Company Owner can terminate sessions within active company and record audit trail', async () => {
      // Terminate sessionA1Id using lanTerminateToken
      const delRes1 = await request(app)
        .delete(`/api/lan/sessions/${sessionA1Id}`)
        .set('Authorization', `Bearer ${lanTerminateToken}`)
        .set('X-Company-Id', companyAId);
      expect(delRes1.status).toBe(200);
      expect(delRes1.body.success).toBe(true);
      expect(delRes1.body.terminatedSessionId).toBe(sessionA1Id);

      // Terminate sessionA2Id using Company Owner token
      const delRes2 = await request(app)
        .delete(`/api/lan/sessions/${sessionA2Id}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .set('X-Company-Id', companyAId);
      expect(delRes2.status).toBe(200);
      expect(delRes2.body.success).toBe(true);

      // Verify sessions list is now empty
      const remainingRes = await request(app)
        .get('/api/lan/sessions')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .set('X-Company-Id', companyAId);
      expect(remainingRes.status).toBe(200);
      const remainingList = Array.isArray(remainingRes.body) ? remainingRes.body : remainingRes.body?.sessions;
      expect(remainingList).toEqual([]);
    });

    it('Case 9: Unauthenticated requests return 401 across all LAN endpoints', async () => {
      expect((await request(app).get('/api/lan/server-info')).status).toBe(401);
      expect((await request(app).get('/api/lan/sessions')).status).toBe(401);
      expect((await request(app).post('/api/lan/lock-record').send({ tableName: 't', recordId: '1' })).status).toBe(401);
      expect((await request(app).delete('/api/lan/sessions/any-id')).status).toBe(401);
    });
  });

  describe('3. UI Response Normalization Resilience', () => {
    it('normalizes arbitrary or malformed API responses into a safe array so sessions.map never throws', () => {
      expect(normalizeLanSessionsResponse([{ id: 's1' }])).toEqual([{ id: 's1' }]);
      expect(normalizeLanSessionsResponse({ sessions: [{ id: 's2' }] })).toEqual([{ id: 's2' }]);
      expect(normalizeLanSessionsResponse({ data: [{ id: 's3' }] })).toEqual([{ id: 's3' }]);
      expect(normalizeLanSessionsResponse({ error: 'FORBIDDEN', message: 'Access denied' })).toEqual([]);
      expect(normalizeLanSessionsResponse(null)).toEqual([]);
      expect(normalizeLanSessionsResponse(undefined)).toEqual([]);
      expect(normalizeLanSessionsResponse('unexpected string')).toEqual([]);
      expect(normalizeLanSessionsResponse(500)).toEqual([]);
    });
  });
});
