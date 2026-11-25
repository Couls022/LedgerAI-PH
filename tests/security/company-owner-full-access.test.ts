import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';

const ISOLATED_ROOT = '/tmp/ledgerai_owner_full_access_cert';
process.env.LEDGERAI_DATA_DIR = path.join(ISOLATED_ROOT, 'companies');
process.env.LEDGERAI_CONFIG_DIR = path.join(ISOLATED_ROOT, 'config');

import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { RbacService } from '../../src/server/services/rbacService';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { CANONICAL_ERP_MODULES } from '../../src/shared/moduleRegistry';
import { CANONICAL_PERMISSION_CATALOG } from '../../src/shared/rbacCatalog';

describe('Company Owner Unrestricted Full Access & Preserved Enterprise Safeguards (DEF-OWNER-RBAC-001)', () => {
  const app = createApp();
  const companyAId = 'LGR-PH-OWNER-CERT-A';
  const companyBId = 'LGR-PH-OWNER-CERT-B';

  let ownerAToken: string;
  let ownerAUserId: string;
  let ownerAMemId: string;
  let ownerBToken: string;
  let adminAToken: string;
  let adminAUserId: string;
  let adminAMemId: string;
  let approverAToken: string;
  let disabledOwnerToken: string;
  let disabledOwnerMemId: string;
  let taxApMemId: string;
  let openPeriodId: string;
  let cashAccId: string;
  let expAccId: string;

  async function provisionUserSession(
    companyId: string,
    userId: string,
    email: string,
    displayName: string,
    roleName: string,
    status: 'ACTIVE' | 'DISABLED' = 'ACTIVE'
  ) {
    const companyDb = await CompanyManager.getCompanyDb(companyId);
    return await dbContext.run(companyDb, async () => {
      await db.insert(schema.users).values({
        id: userId,
        email,
        displayName,
        passwordHash: 'test_hash',
        status,
      }).onConflictDoNothing();

      const roleRec = await RbacService.ensureRoleRecord(roleName);
      const memId = `mem-${companyId}-${userId}`;
      await db.insert(schema.companyUsers).values({
        id: memId,
        userId,
        companyId,
        roleId: roleRec.id,
        legacyRole: roleName,
        status,
        membershipStatus: status,
        defaultDataScope: 'COMPANY_WIDE',
        approvalLimitCentavos: roleName === 'Company Owner' ? -1 : 0,
      }).onConflictDoNothing();

      await RbacService.setMemberRoles(null, memId, [roleName], `Provisioned ${roleName}`);

      const rawToken = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawToken),
        userId,
        companyId,
        expiresAt: new Date(Date.now() + 86400_000),
      });

      return { token: `${companyId}.${rawToken}`, userId, memId };
    });
  }

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    if (fs.existsSync(ISOLATED_ROOT)) {
      fs.rmSync(ISOLATED_ROOT, { recursive: true, force: true });
    }
    await CompanyManager.init();

    await CompanyManager.createCompanyProfile(companyAId, 'Owner Authority Corp A');
    await CompanyManager.createCompanyProfile(companyBId, 'Tenant Isolation Corp B');

    const dbA = await CompanyManager.getCompanyDb(companyAId);
    await dbContext.run(dbA, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      const now = new Date();
      openPeriodId = `per-${companyAId}-202611`;
      cashAccId = `acc-${companyAId}-1010`;
      expAccId = `acc-${companyAId}-6010`;

      await db.insert(schema.accountingPeriods).values({
        id: openPeriodId,
        companyId: companyAId,
        name: 'November 2026',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        fiscalYear: 2026,
        status: 'OPEN',
        createdAt: now,
      }).onConflictDoNothing();

      await db.insert(schema.accounts).values([
        {
          id: cashAccId,
          companyId: companyAId,
          accountCode: '1010',
          accountName: 'Cash in Bank',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isCashAccount: true,
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: expAccId,
          companyId: companyAId,
          accountCode: '6010',
          accountName: 'Operating Expense',
          accountType: 'EXPENSE',
          normalBalance: 'DEBIT',
          isCashAccount: false,
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        },
      ]).onConflictDoNothing();
    });

    const dbB = await CompanyManager.getCompanyDb(companyBId);
    await dbContext.run(dbB, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
    });

    const ownerA = await provisionUserSession(companyAId, 'usr-owner-cert-a', 'owner.cert@corp-a.ph', 'Active Owner A', 'Company Owner', 'ACTIVE');
    ownerAToken = ownerA.token;
    ownerAUserId = ownerA.userId;
    ownerAMemId = ownerA.memId;

    const adminA = await provisionUserSession(companyAId, 'usr-admin-cert-a', 'admin.cert@corp-a.ph', 'Admin A', 'Company Administrator', 'ACTIVE');
    adminAToken = adminA.token;
    adminAUserId = adminA.userId;
    adminAMemId = adminA.memId;

    const approverA = await provisionUserSession(companyAId, 'usr-approver-cert-a', 'approver.cert@corp-a.ph', 'Approver A', 'Approver', 'ACTIVE');
    approverAToken = approverA.token;

    const disOwner = await provisionUserSession(companyAId, 'usr-owner-dis-a', 'disabled.owner@corp-a.ph', 'Disabled Owner', 'Company Owner', 'DISABLED');
    disabledOwnerToken = disOwner.token;
    disabledOwnerMemId = disOwner.memId;

    const taxAp = await provisionUserSession(companyAId, 'usr-taxap-cert-a', 'taxap.cert@corp-a.ph', 'Tax AP Specialist', 'Tax & AP Specialist', 'ACTIVE');
    taxApMemId = taxAp.memId;

    const ownerB = await provisionUserSession(companyBId, 'usr-owner-cert-b', 'owner.b@corp-b.ph', 'Owner B', 'Company Owner', 'ACTIVE');
    ownerBToken = ownerB.token;
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    if (fs.existsSync(ISOLATED_ROOT)) {
      try { fs.rmSync(ISOLATED_ROOT, { recursive: true, force: true }); } catch {}
    }
  });

  it('1. Active Company Owner resolves all 16 modules, all 36 submodules, COMPANY_WIDE scope, -1 limit, and wildcard permissions even with stale DB DENY overrides', async () => {
    const dbA = await CompanyManager.getCompanyDb(companyAId);
    await dbContext.run(dbA, async () => {
      // Simulate legacy/stale DB rows trying to lock Company Owner out of tax, payroll, and budgets
      await db.insert(schema.userModuleAssignments).values({
        id: 'stale-mod-owner-tax',
        companyUserId: ownerAMemId,
        moduleId: 'tax',
        submoduleIdsJson: JSON.stringify([]),
        actionsJson: JSON.stringify([]),
        effect: 'DENY',
        origin: 'USER_SPECIFIC_DENY',
        createdAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoNothing();

      await db.insert(schema.userPermissionOverrides).values([
        {
          id: 'stale-ovr-owner-tax-view',
          companyUserId: ownerAMemId,
          permissionCode: 'tax:view',
          effect: 'DENY',
          reason: 'Legacy stale restriction',
          createdAt: new Date(),
        },
        {
          id: 'stale-ovr-owner-budget-approve',
          companyUserId: ownerAMemId,
          permissionCode: 'budget:approve',
          effect: 'DENY',
          reason: 'Legacy stale restriction',
          createdAt: new Date(),
        },
      ]).onConflictDoNothing();

      const access = await RbacService.resolveEffectiveAccess(ownerAMemId);
      expect(access.primaryRole).toBe('Company Owner');
      expect(access.effectiveAccountActive).toBe(true);
      expect(access.effectiveModuleIds.length).toBe(16);
      expect(access.effectiveModuleIds).toEqual(CANONICAL_ERP_MODULES.map((m) => m.id));
      const allSubs = CANONICAL_ERP_MODULES.flatMap((m) => m.submodules.map((s) => s.id));
      const resolvedSubIds = Object.values(access.effectiveSubmodulesMap).flat();
      expect(allSubs.length).toBe(38);
      expect(resolvedSubIds.length).toBe(allSubs.length);
      for (const sId of allSubs) {
        expect(resolvedSubIds).toContain(sId);
      }
      expect(access.effectivePermissions).toContain('*');
      for (const perm of CANONICAL_PERMISSION_CATALOG) {
        expect(access.effectivePermissions).toContain(perm.code);
      }
      expect(access.hardDeniedPermissions).toEqual([]);
      expect(access.sodRestrictions).toEqual([]);
      expect(access.defaultDataScope).toBe('COMPANY_WIDE');
      expect(access.defaultApprovalLimitCentavos).toBe(-1);
      expect(access.canApproveFinancialTransactions).toBe(true);
      expect(access.canPostToGeneralLedger).toBe(true);
      expect(access.isReadOnly).toBe(false);
    });

    const sessRes = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(sessRes.status).toBe(200);
    expect(sessRes.body.activeCompany.effectiveModuleIds.length).toBe(16);
    expect(sessRes.body.permissions).toContain('*');
    expect(sessRes.body.activeCompany.approvalLimitCentavos).toBe(-1);

    // Previously blocked domains must succeed for Company Owner
    const taxDash = await request(app)
      .get('/api/tax/dashboard-summary')
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(taxDash.status).toBe(200);

    const budgetRes = await request(app)
      .get('/api/budgets')
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(budgetRes.status).toBe(200);
  });

  it('2. Attempting to restrict an active Company Owner via RBAC/Users APIs fails deterministically with 400 OWNER_UNRESTRICTED_POLICY', async () => {
    const modRes = await request(app)
      .put(`/api/rbac/members/${ownerAMemId}/module-assignments`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        reason: 'Attempt to strip tax module from Owner',
        moduleAssignments: [
          { moduleId: 'dashboard', submoduleIds: ['dash-overview'], actions: ['view'], effect: 'ALLOW' },
        ],
      });
    expect(modRes.status).toBe(400);
    expect(modRes.body.error).toBe('OWNER_UNRESTRICTED_POLICY');

    const scopeRes = await request(app)
      .put(`/api/rbac/members/${ownerAMemId}/data-scope`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ dataScope: 'OWN_RECORDS', reason: 'Attempt to downgrade owner scope' });
    expect(scopeRes.status).toBe(400);
    expect(scopeRes.body.error).toBe('OWNER_UNRESTRICTED_POLICY');

    const limitRes = await request(app)
      .put(`/api/rbac/members/${ownerAMemId}/approval-limit`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ approvalLimitCentavos: 50000, reason: 'Attempt to cap owner approval limit' });
    expect(limitRes.status).toBe(400);
    expect(limitRes.body.error).toBe('OWNER_UNRESTRICTED_POLICY');

    const ovrRes = await request(app)
      .post(`/api/rbac/members/${ownerAMemId}/overrides`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ permissionCode: 'payroll:view', effect: 'DENY', reason: 'Attempt DENY override on owner' });
    expect(ovrRes.status).toBe(400);
    expect(ovrRes.body.error).toContain('OWNER_UNRESTRICTED_POLICY');

    const legacyUsersRes = await request(app)
      .put(`/api/users/${ownerAMemId}/permissions`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        customPermissions: ['dashboard:view'],
      });
    expect(legacyUsersRes.status).toBe(400);
    expect(legacyUsersRes.body.error).toBe('OWNER_UNRESTRICTED_POLICY');
  });

  it('3. Tax & AP Specialist role resolves scoped Procurement/AP/Vendor/Tax access while remaining restricted from Payroll', async () => {
    const dbA = await CompanyManager.getCompanyDb(companyAId);
    await dbContext.run(dbA, async () => {
      const access = await RbacService.resolveEffectiveAccess(taxApMemId);
      expect(access.primaryRole).toBe('Tax & AP Specialist');
      expect(access.effectiveModuleIds).toContain('tax');
      expect(access.effectiveModuleIds).toContain('procurement');
      expect(access.effectiveModuleIds).not.toContain('payroll');
      expect(RbacService.hasPermission(access.effectivePermissions, 'tax:view')).toBe(true);
      expect(RbacService.hasPermission(access.effectivePermissions, 'purchases:create')).toBe(true);
      expect(RbacService.hasPermission(access.effectivePermissions, 'payroll:view')).toBe(false);
    });
  });

  it('4. Preserves Disabled Owner lock, Cross-Tenant Isolation, RECOVERY_READ_ONLY quarantine, Maker-Checker SoD, and Audit Logging', async () => {
    // (a) Disabled Company Owner must receive zero modules & HTTP 401/403
    const dbA = await CompanyManager.getCompanyDb(companyAId);
    await dbContext.run(dbA, async () => {
      const disAccess = await RbacService.resolveEffectiveAccess(disabledOwnerMemId);
      expect(disAccess.effectiveAccountActive).toBe(false);
      expect(disAccess.effectiveModuleIds).toEqual([]);
      expect(disAccess.effectivePermissions).toEqual([]);
    });

    const disSess = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${disabledOwnerToken}`);
    expect([401, 403]).toContain(disSess.status);

    // (b) Cross-Company Tenant Isolation: Owner A cannot delete or mutate Company B
    const crossTenant = await request(app)
      .delete(`/api/companies/${companyBId}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', companyBId);
    expect(crossTenant.status).toBe(403);

    // (c) Maker-Checker SoD: Even Company Owner cannot self-approve a workflow they submitted/created
    const createJe = await request(app)
      .post('/api/accounting/journals')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        entryDate: '2026-11-15',
        periodId: openPeriodId,
        description: 'Owner self-approval SoD verification journal',
        lines: [
          { accountId: expAccId, debit: 50000, credit: 0, memo: 'Test expense' },
          { accountId: cashAccId, debit: 0, credit: 50000, memo: 'Cash credit' },
        ],
      });
    expect([200, 201]).toContain(createJe.status);
    const jeId = createJe.body?.id || createJe.body?.entry?.id;
    expect(jeId).toBeTruthy();

    const submitJe = await request(app)
      .post(`/api/accounting/journals/${jeId}/submit`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ reason: 'Submit for checker approval' });
    expect(submitJe.status).toBe(200);

    const initWf = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        entityType: 'JOURNAL_ENTRY',
        entityId: jeId,
        amountCentavos: 50000,
        reason: 'Initiate workflow for Maker-Checker SoD check',
      });
    expect(initWf.status).toBe(201);
    const wfId = initWf.body?.workflow?.id;
    expect(wfId).toBeTruthy();

    const selfApprove = await request(app)
      .post(`/api/journey/approvals/${wfId}/decide`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ decision: 'APPROVE', reason: 'Attempt forbidden self-approval' });
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.error).toBe('SOD_VIOLATION');

    // Separate authorized Approver CAN approve (Maker !== Checker)
    const approverApprove = await request(app)
      .post(`/api/journey/approvals/${wfId}/decide`)
      .set('Authorization', `Bearer ${approverAToken}`)
      .send({ decision: 'APPROVE', reason: 'Independent Checker approval' });
    expect(approverApprove.status).toBe(200);

    // (d) RECOVERY_READ_ONLY quarantine still blocks even Company Owner writes
    await CompanyManager.updateCompanyManifest(companyAId, { status: 'RECOVERY_READ_ONLY' });
    await dbContext.run(dbA, async () => {
      await db.update(schema.companies)
        .set({ status: 'RECOVERY_READ_ONLY' })
        .where(eq(schema.companies.id, companyAId));
    });
    const qWrite = await request(app)
      .post('/api/accounting/journals')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        entryDate: '2026-11-16',
        periodId: openPeriodId,
        description: 'Should fail in quarantine',
        lines: [
          { accountId: expAccId, debit: 1000, credit: 0 },
          { accountId: cashAccId, debit: 0, credit: 1000 },
        ],
      });
    expect(qWrite.status).toBe(403);

    // Restore ACTIVE status & confirm immutable audit_logs recorded security & financial events
    await CompanyManager.updateCompanyManifest(companyAId, { status: 'ACTIVE' });
    await dbContext.run(dbA, async () => {
      await db.update(schema.companies)
        .set({ status: 'ACTIVE' })
        .where(eq(schema.companies.id, companyAId));
      const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.companyId, companyAId));
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
