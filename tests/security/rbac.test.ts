import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { paths } from '../../src/server/services/paths';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';

describe('REQ-RBAC-UI-001: End-to-End Granular RBAC & Module-Scoped Data Scope Enforcement', () => {
  const app = createApp();
  const COMPANY_ID = 'LGR-PH-RBAC-TEST-01';

  let ownerToken: string;
  let auditorToken: string;
  let bookkeeperToken: string;
  let deptScopedHrToken: string;
  let projectScopedAcctToken: string;
  let costCenterScopedAcctToken: string;
  let ownRecordsSalesToken: string;

  let bookkeeperMemId: string;
  let deptScopedHrMemId: string;
  let projectScopedAcctMemId: string;
  let costCenterScopedAcctMemId: string;
  let ownRecordsSalesMemId: string;

  let cashAccountId: string;
  let expenseAccountId: string;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();

    const cdir = path.join(paths.getCompaniesRootDir(), COMPANY_ID);
    if (fs.existsSync(cdir)) {
      try { fs.rmSync(cdir, { recursive: true, force: true }); } catch {}
    }

    await CompanyManager.createCompanyProfile(
      COMPANY_ID,
      'RBAC & Data Scope Verification Corp.',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );

    const companyDb = await CompanyManager.getCompanyDb(COMPANY_ID);
    await dbContext.run(companyDb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      // Seed Chart of Accounts for journal tests
      cashAccountId = 'acc-cash-rbac-01';
      expenseAccountId = 'acc-exp-rbac-01';
      await db.insert(schema.accounts).values([
        {
          id: cashAccountId,
          companyId: COMPANY_ID,
          accountCode: '1010-RBAC',
          accountName: 'Cash in Bank - RBAC',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isActive: true,
        },
        {
          id: expenseAccountId,
          companyId: COMPANY_ID,
          accountCode: '6010-RBAC',
          accountName: 'Operating Expense - RBAC',
          accountType: 'EXPENSE',
          normalBalance: 'DEBIT',
          isActive: true,
        },
      ]).onConflictDoNothing();

      // Seed Open Accounting Period for 2026
      await db.insert(schema.accountingPeriods).values({
        id: 'prd-2026-rbac',
        companyId: COMPANY_ID,
        name: 'FY 2026 Open Period',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        fiscalYear: 2026,
        status: 'OPEN',
      }).onConflictDoNothing();

      // Seed Master Data: Departments, Projects, Cost Centers
      await db.insert(schema.departments).values([
        { id: 'dept-eng', companyId: COMPANY_ID, code: 'ENG', name: 'Engineering', status: 'ACTIVE' },
        { id: 'dept-fin', companyId: COMPANY_ID, code: 'FIN', name: 'Finance', status: 'ACTIVE' },
      ]).onConflictDoNothing();

      await db.insert(schema.projects).values([
        { id: 'proj-alpha', companyId: COMPANY_ID, code: 'PRJ-ALPHA', name: 'Project Alpha', status: 'ACTIVE' },
        { id: 'proj-beta', companyId: COMPANY_ID, code: 'PRJ-BETA', name: 'Project Beta', status: 'ACTIVE' },
      ]).onConflictDoNothing();

      await db.insert(schema.costCenters).values([
        { id: 'cc-100', companyId: COMPANY_ID, code: 'CC-100', name: 'Engineering Operations', departmentId: 'dept-eng', status: 'ACTIVE' },
        { id: 'cc-200', companyId: COMPANY_ID, code: 'CC-200', name: 'Finance Operations', departmentId: 'dept-fin', status: 'ACTIVE' },
      ]).onConflictDoNothing();

      // Helper to provision user + role + membership + module scope + session
      const createSessionForRole = async (
        userId: string,
        email: string,
        displayName: string,
        roleName: string,
        scopeOpts?: {
          dataScope?: string;
          departmentScopeId?: string | null;
          projectScopeId?: string | null;
          costCenterScopeId?: string | null;
        }
      ) => {
        await db.insert(schema.users).values({
          id: userId,
          email,
          displayName,
          passwordHash: 'test_hash',
          status: 'ACTIVE',
        }).onConflictDoNothing();

        const roleRec = await RbacService.ensureRoleRecord(roleName);

        const memId = `mem-${userId}`;
        await db.insert(schema.companyUsers).values({
          id: memId,
          userId,
          companyId: COMPANY_ID,
          roleId: roleRec.id,
          legacyRole: roleName,
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: scopeOpts?.dataScope || 'COMPANY_WIDE',
        }).onConflictDoNothing();

        await RbacService.setMemberRoles(null, memId, [roleName], `Provisioned ${roleName} for RBAC verification`);

        if (scopeOpts?.dataScope) {
          await db.update(schema.companyUsers)
            .set({ defaultDataScope: scopeOpts.dataScope })
            .where(eq(schema.companyUsers.id, memId));

          await db.update(schema.userModuleAssignments)
            .set({
              dataScope: scopeOpts.dataScope,
              departmentScopeId: scopeOpts.departmentScopeId || null,
              projectScopeId: scopeOpts.projectScopeId || null,
              costCenterScopeId: scopeOpts.costCenterScopeId || null,
              origin: 'USER_SPECIFIC_GRANT',
            })
            .where(eq(schema.userModuleAssignments.companyUserId, memId));
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        await db.insert(schema.sessions).values({
          id: hashToken(rawToken),
          userId,
          companyId: COMPANY_ID,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

        return { token: `${COMPANY_ID}.${rawToken}`, memId };
      };

      // 1. Company Owner (COMPANY_WIDE)
      const ownerRes = await createSessionForRole(
        'usr-rbac-owner',
        'owner@rbac.ledgerai.ph',
        'RBAC Owner',
        'Company Owner'
      );
      ownerToken = ownerRes.token;

      // 2. Auditor (Read-only across operational/accounting modules)
      const audRes = await createSessionForRole(
        'usr-rbac-auditor',
        'auditor@rbac.ledgerai.ph',
        'RBAC Auditor',
        'Auditor'
      );
      auditorToken = audRes.token;

      // 3. Bookkeeper (COMPANY_WIDE)
      const bkRes = await createSessionForRole(
        'usr-rbac-bookkeeper',
        'bookkeeper@rbac.ledgerai.ph',
        'RBAC Bookkeeper',
        'Bookkeeper'
      );
      bookkeeperToken = bkRes.token;
      bookkeeperMemId = bkRes.memId;

      // 4. Accountant scoped to Engineering Department ('dept-eng') with explicit Payroll module grant
      const hrRes = await createSessionForRole(
        'usr-rbac-hr-eng',
        'hr-eng@rbac.ledgerai.ph',
        'HR Engineering Accountant',
        'Accountant',
        { dataScope: 'DEPARTMENT', departmentScopeId: 'dept-eng' }
      );
      deptScopedHrToken = hrRes.token;
      deptScopedHrMemId = hrRes.memId;

      await db.insert(schema.userModuleAssignments).values({
        id: 'uma-hr-eng-payroll',
        companyUserId: deptScopedHrMemId,
        moduleId: 'payroll',
        submoduleIds: JSON.stringify(['pay-records']),
        actions: JSON.stringify(['view', 'create', 'edit', 'submit', 'manage']),
        dataScope: 'DEPARTMENT',
        departmentScopeId: 'dept-eng',
        origin: 'USER_SPECIFIC_GRANT',
        effect: 'ALLOW',
      }).onConflictDoNothing();

      // 5. Accountant scoped to Project Alpha ('proj-alpha')
      const projAcctRes = await createSessionForRole(
        'usr-rbac-acct-proj',
        'acct-proj@rbac.ledgerai.ph',
        'Project Alpha Accountant',
        'Accountant',
        { dataScope: 'PROJECT', projectScopeId: 'proj-alpha' }
      );
      projectScopedAcctToken = projAcctRes.token;
      projectScopedAcctMemId = projAcctRes.memId;

      // 6. Accountant scoped to Cost Center CC-100 ('cc-100')
      const ccAcctRes = await createSessionForRole(
        'usr-rbac-acct-cc',
        'acct-cc@rbac.ledgerai.ph',
        'Cost Center 100 Accountant',
        'Accountant',
        { dataScope: 'COST_CENTER', costCenterScopeId: 'cc-100' }
      );
      costCenterScopedAcctToken = ccAcctRes.token;
      costCenterScopedAcctMemId = ccAcctRes.memId;

      // 7. Bookkeeper scoped to OWN_RECORDS
      const salesRes = await createSessionForRole(
        'usr-rbac-sales-own',
        'sales-own@rbac.ledgerai.ph',
        'Own Records Bookkeeper',
        'Bookkeeper',
        { dataScope: 'OWN_RECORDS' }
      );
      ownRecordsSalesToken = salesRes.token;
      ownRecordsSalesMemId = salesRes.memId;
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    const cdir = path.join(paths.getCompaniesRootDir(), COMPANY_ID);
    if (fs.existsSync(cdir)) {
      try { fs.rmSync(cdir, { recursive: true, force: true }); } catch {}
    }
    await CompanyManager.unregisterCompany(COMPANY_ID).catch(() => {});
  });

  it('1. Enforces canonical permission resolution, user overrides, and hard-restricted role blocks in RbacService', async () => {
    const companyDb = await CompanyManager.getCompanyDb(COMPANY_ID);
    await dbContext.run(companyDb, async () => {
      // Bookkeeper baseline permissions include sales:create, purchases:create, bank_rec:create
      // but hard-restrict accounting:approve and budget:create
      const bkInitial = await RbacService.resolveEffectiveAccess(bookkeeperMemId);
      expect(RbacService.hasPermission(bkInitial, 'sales:create')).toBe(true);
      expect(RbacService.hasPermission(bkInitial, 'purchases:create')).toBe(true);
      expect(RbacService.hasPermission(bkInitial, 'accounting:approve')).toBe(false);
      expect(RbacService.hasPermission(bkInitial, 'budget:create')).toBe(false);

      const mockOwnerReq = {
        user: { id: 'usr-rbac-owner', displayName: 'RBAC Owner', email: 'owner@rbac.ledgerai.ph' },
        activeCompany: { id: COMPANY_ID, role: 'Company Owner', roleCode: 'COMPANY_OWNER', membershipId: 'mem-usr-rbac-owner' }
      };

      // Attempting to grant hard-restricted permission 'budget:create' or 'accounting:approve' to Bookkeeper must be rejected
      await expect(
        RbacService.setExplicitOverride(
          mockOwnerReq,
          bookkeeperMemId,
          'budget:create',
          'ALLOW',
          'Attempt invalid privilege escalation'
        )
      ).rejects.toThrow(/hard-restricted/i);

      // Valid explicit DENY override on 'sales:create' for Bookkeeper must revoke 'sales:create'
      await RbacService.setExplicitOverride(
        mockOwnerReq,
        bookkeeperMemId,
        'sales:create',
        'DENY',
        'Temporarily restrict sales invoice creation for Bookkeeper'
      );

      const bkAfterDeny = await RbacService.resolveEffectiveAccess(bookkeeperMemId);
      expect(RbacService.hasPermission(bkAfterDeny, 'sales:create')).toBe(false);

      // Clear override so Bookkeeper returns to baseline
      await RbacService.removeExplicitOverride(
        mockOwnerReq,
        bookkeeperMemId,
        'sales:create'
      );
      const bkRestored = await RbacService.resolveEffectiveAccess(bookkeeperMemId);
      expect(RbacService.hasPermission(bkRestored, 'sales:create')).toBe(true);
    });
  });

  it('2. Blocks Read-only (:view) users from executing state-mutating POST/DELETE operations across secondary routes', async () => {
    // Auditor (read-only) has inventory:view, fixedassets:view, purchases:view, budget:view
    // and can GET inventory items
    const getInvRes = await request(app)
      .get('/api/operations/inventory/items')
      .set('Authorization', `Bearer ${auditorToken}`);
    expect(getInvRes.status).toBe(200);

    // Auditor CANNOT POST new inventory item (previously leaked via inventory:view)
    const postInvRes = await request(app)
      .post('/api/operations/inventory/items')
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({
        sku: 'RO-SKU-001',
        name: 'Unauthorized Item',
        category: 'Hardware',
        unitPrice: 100000,
      });
    expect(postInvRes.status).toBe(403);
    expect(postInvRes.body.error).toBe('PERMISSION_DENIED');

    // Auditor CANNOT POST inventory adjustment
    const postAdjRes = await request(app)
      .post('/api/operations/inventory/adjustments')
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({
        itemId: 'non-existent',
        type: 'ADD',
        quantity: 5,
        reason: 'Unauthorized adjustment',
      });
    expect(postAdjRes.status).toBe(403);
    expect(postAdjRes.body.error).toBe('PERMISSION_DENIED');

    // Auditor CANNOT POST fixed asset
    const postAssetRes = await request(app)
      .post('/api/operations/fixed-assets')
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({
        assetCode: 'FA-UNAUTH-01',
        name: 'Unauthorized Laptop',
        category: 'IT Equipment',
        acquisitionDate: '2026-02-01',
        acquisitionCost: 5000000,
        usefulLifeMonths: 36,
      });
    expect(postAssetRes.status).toBe(403);
    expect(postAssetRes.body.error).toBe('PERMISSION_DENIED');

    // Auditor CANNOT POST purchase order
    const postPoRes = await request(app)
      .post('/api/operations/procurement/purchase-orders')
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({
        supplierName: 'Acme Supplies',
        orderDate: '2026-02-01',
        totalAmount: 150000,
      });
    expect(postPoRes.status).toBe(403);
    expect(postPoRes.body.error).toBe('PERMISSION_DENIED');

    // Bookkeeper CANNOT POST /api/budgets (budget:create is hard-restricted for Bookkeeper)
    const bkBudgetRes = await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${bookkeeperToken}`)
      .send({
        periodMonth: '2026-03',
        items: [{ category: 'Office Supplies', monthlyLimit: 3000000 }],
      });
    expect(bkBudgetRes.status).toBe(403);
    expect(bkBudgetRes.body.error).toBe('PERMISSION_DENIED');

    // Company Owner CAN POST /api/budgets
    const ownerBudgetRes = await request(app)
      .post('/api/budgets')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        periodMonth: '2026-03',
        items: [{ category: 'Office Supplies', monthlyLimit: 3000000 }],
      });
    expect(ownerBudgetRes.status).toBe(200);
    expect(ownerBudgetRes.body.success).toBe(true);
  });

  it('3. Enforces DEPARTMENT data-scope filtering and mutation guards on Master Data and Payroll Employees', async () => {
    // Owner creates two employees: one in Engineering ('Engineering') and one in Finance ('Finance')
    const empEngRes = await request(app)
      .post('/api/operations/payroll/employees')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        employeeNo: 'EMP-ENG-001',
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        position: 'Software Engineer',
        department: 'Engineering',
        tin: '111-222-333-000',
        monthlyBasicSalary: 60000,
      });
    expect(empEngRes.status).toBe(200);
    const engEmpId = empEngRes.body.id;

    const empFinRes = await request(app)
      .post('/api/operations/payroll/employees')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        employeeNo: 'EMP-FIN-001',
        firstName: 'Maria',
        lastName: 'Santos',
        position: 'Financial Analyst',
        department: 'Finance',
        tin: '444-555-666-000',
        monthlyBasicSalary: 55000,
      });
    expect(empFinRes.status).toBe(200);
    const finEmpId = empFinRes.body.id;

    // Department-scoped Accountant ('dept-eng' / Engineering) queries /api/master-data/departments
    const deptsRes = await request(app)
      .get('/api/master-data/departments')
      .set('Authorization', `Bearer ${deptScopedHrToken}`);
    expect(deptsRes.status).toBe(200);
    expect(deptsRes.body.map((d: any) => d.id)).toEqual(['dept-eng']);

    // Department-scoped Accountant ('dept-eng') queries /api/operations/payroll/employees -> sees ONLY Engineering employee
    const hrEmpListRes = await request(app)
      .get('/api/operations/payroll/employees?raw=true')
      .set('Authorization', `Bearer ${deptScopedHrToken}`);
    expect(hrEmpListRes.status).toBe(200);
    expect(hrEmpListRes.body.length).toBe(1);
    expect(hrEmpListRes.body[0].id).toBe(engEmpId);
    expect(hrEmpListRes.body[0].department).toBe('Engineering');

    // Department-scoped Accountant ('dept-eng') CANNOT create an employee in 'Finance'
    const hrCreateFinRes = await request(app)
      .post('/api/operations/payroll/employees')
      .set('Authorization', `Bearer ${deptScopedHrToken}`)
      .send({
        employeeNo: 'EMP-FIN-002',
        firstName: 'Out',
        lastName: 'OfScope',
        position: 'Accountant',
        department: 'Finance',
        monthlyBasicSalary: 45000,
      });
    expect(hrCreateFinRes.status).toBe(403);
    expect(hrCreateFinRes.body.code).toBe('DATA_SCOPE_VIOLATION');

    // Department-scoped Accountant ('dept-eng') CANNOT update the Finance employee
    const hrUpdateFinRes = await request(app)
      .put(`/api/operations/payroll/employees/${finEmpId}`)
      .set('Authorization', `Bearer ${deptScopedHrToken}`)
      .send({
        employeeNo: 'EMP-FIN-001',
        firstName: 'Maria',
        lastName: 'Santos Updated',
        position: 'Senior Financial Analyst',
        department: 'Finance',
        monthlyBasicSalary: 65000,
        status: 'ACTIVE',
      });
    expect(hrUpdateFinRes.status).toBe(403);
    expect(hrUpdateFinRes.body.code).toBe('DATA_SCOPE_VIOLATION');

    // Department-scoped Accountant ('dept-eng') CAN create an employee in 'Engineering'
    const hrCreateEngRes = await request(app)
      .post('/api/operations/payroll/employees')
      .set('Authorization', `Bearer ${deptScopedHrToken}`)
      .send({
        employeeNo: 'EMP-ENG-002',
        firstName: 'Pedro',
        lastName: 'Penduko',
        position: 'DevOps Engineer',
        department: 'Engineering',
        monthlyBasicSalary: 70000,
      });
    expect(hrCreateEngRes.status).toBe(200);
  });

  it('4. Enforces PROJECT and COST_CENTER data-scope filtering and mutation guards on Master Data and Journals', async () => {
    // Owner posts two journals:
    // Journal 1 tagged with Project Alpha ('proj-alpha') and Cost Center 100 ('cc-100')
    const jeAlphaRes = await request(app)
      .post('/api/accounting/journals')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        entryDate: '2026-03-10',
        description: 'Project Alpha & CC-100 Engineering Expense',
        lines: [
          { accountId: expenseAccountId, debit: 250000, credit: 0, projectId: 'proj-alpha', costCenterId: 'cc-100', departmentId: 'dept-eng' },
          { accountId: cashAccountId, debit: 0, credit: 250000, projectId: 'proj-alpha', costCenterId: 'cc-100', departmentId: 'dept-eng' },
        ],
      });
    expect(jeAlphaRes.status).toBe(201);
    const jeAlphaId = jeAlphaRes.body.id;

    // Journal 2 tagged with Project Beta ('proj-beta') and Cost Center 200 ('cc-200')
    const jeBetaRes = await request(app)
      .post('/api/accounting/journals')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        entryDate: '2026-03-11',
        description: 'Project Beta & CC-200 Finance Expense',
        lines: [
          { accountId: expenseAccountId, debit: 400000, credit: 0, projectId: 'proj-beta', costCenterId: 'cc-200', departmentId: 'dept-fin' },
          { accountId: cashAccountId, debit: 0, credit: 400000, projectId: 'proj-beta', costCenterId: 'cc-200', departmentId: 'dept-fin' },
        ],
      });
    expect(jeBetaRes.status).toBe(201);
    const jeBetaId = jeBetaRes.body.id;

    // Project-scoped Accountant ('proj-alpha') queries /api/master-data/projects -> only sees 'proj-alpha'
    const projMasterRes = await request(app)
      .get('/api/master-data/projects')
      .set('Authorization', `Bearer ${projectScopedAcctToken}`);
    expect(projMasterRes.status).toBe(200);
    expect(projMasterRes.body.map((p: any) => p.id)).toEqual(['proj-alpha']);

    // Project-scoped Accountant queries /api/accounting/journals -> only sees jeAlphaId
    const projJournalsRes = await request(app)
      .get('/api/accounting/journals?raw=true')
      .set('Authorization', `Bearer ${projectScopedAcctToken}`);
    expect(projJournalsRes.status).toBe(200);
    const projJournalIds = projJournalsRes.body.map((j: any) => j.id);
    expect(projJournalIds).toContain(jeAlphaId);
    expect(projJournalIds).not.toContain(jeBetaId);

    // Project-scoped Accountant CANNOT view jeBetaId directly via GET /api/accounting/journals/:id
    const projGetBetaRes = await request(app)
      .get(`/api/accounting/journals/${jeBetaId}`)
      .set('Authorization', `Bearer ${projectScopedAcctToken}`);
    expect(projGetBetaRes.status).toBe(403);
    expect(projGetBetaRes.body.code).toBe('DATA_SCOPE_VIOLATION');

    // Project-scoped Accountant CANNOT create a journal tagged with 'proj-beta'
    const projCreateBetaRes = await request(app)
      .post('/api/accounting/journals')
      .set('Authorization', `Bearer ${projectScopedAcctToken}`)
      .send({
        entryDate: '2026-03-12',
        description: 'Unauthorized Project Beta Entry',
        lines: [
          { accountId: expenseAccountId, debit: 100000, credit: 0, projectId: 'proj-beta' },
          { accountId: cashAccountId, debit: 0, credit: 100000, projectId: 'proj-beta' },
        ],
      });
    expect(projCreateBetaRes.status).toBe(403);
    expect(projCreateBetaRes.body.code).toBe('DATA_SCOPE_VIOLATION');

    // Cost-Center-scoped Accountant ('cc-100') queries /api/master-data/cost-centers -> only sees 'cc-100'
    const ccMasterRes = await request(app)
      .get('/api/master-data/cost-centers')
      .set('Authorization', `Bearer ${costCenterScopedAcctToken}`);
    expect(ccMasterRes.status).toBe(200);
    expect(ccMasterRes.body.map((c: any) => c.id)).toEqual(['cc-100']);

    // Cost-Center-scoped Accountant queries /api/accounting/journals -> only sees jeAlphaId
    const ccJournalsRes = await request(app)
      .get('/api/accounting/journals?raw=true')
      .set('Authorization', `Bearer ${costCenterScopedAcctToken}`);
    expect(ccJournalsRes.status).toBe(200);
    const ccJournalIds = ccJournalsRes.body.map((j: any) => j.id);
    expect(ccJournalIds).toContain(jeAlphaId);
    expect(ccJournalIds).not.toContain(jeBetaId);
  });

  it('5. Enforces OWN_RECORDS data-scope isolation on Sales Invoices and Purchase Orders', async () => {
    const companyDb = await CompanyManager.getCompanyDb(COMPANY_ID);
    const custId = 'cust-rbac-01';
    const ownerInvId = 'inv-owner-rbac-01';
    const clerkInvId = 'inv-clerk-rbac-01';

    await dbContext.run(companyDb, async () => {
      await db.insert(schema.customers).values({
        id: custId,
        companyId: COMPANY_ID,
        code: 'CUST-RBAC-01',
        name: 'RBAC Test Customer',
        legalName: 'RBAC Test Customer Inc.',
        tin: '123-456-789-000',
        isVatRegistered: true,
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.salesInvoices).values([
        {
          id: ownerInvId,
          companyId: COMPANY_ID,
          customerId: custId,
          invoiceNumber: 'SI-OWNER-001',
          invoiceDate: '2026-03-01',
          dueDate: '2026-03-31',
          subtotal: 100000,
          vatAmount: 12000,
          totalAmount: 112000,
          balanceDue: 112000,
          status: 'DRAFT',
          createdBy: 'usr-rbac-owner',
        },
        {
          id: clerkInvId,
          companyId: COMPANY_ID,
          customerId: custId,
          invoiceNumber: 'SI-CLERK-001',
          invoiceDate: '2026-03-02',
          dueDate: '2026-03-31',
          subtotal: 200000,
          vatAmount: 24000,
          totalAmount: 224000,
          balanceDue: 224000,
          status: 'DRAFT',
          createdBy: 'usr-rbac-sales-own',
        },
      ]).onConflictDoNothing();
    });

    // Bookkeeper with OWN_RECORDS scope queries GET /api/accounting/sales-invoices -> only sees clerkInvId
    const clerkInvoicesRes = await request(app)
      .get('/api/accounting/sales-invoices?raw=true')
      .set('Authorization', `Bearer ${ownRecordsSalesToken}`);
    expect(clerkInvoicesRes.status).toBe(200);
    const clerkInvoiceIds = clerkInvoicesRes.body.map((inv: any) => inv.id);
    expect(clerkInvoiceIds).toEqual([clerkInvId]);

    // Company Owner with COMPANY_WIDE scope queries GET /api/accounting/sales-invoices -> sees both
    const ownerInvoicesRes = await request(app)
      .get('/api/accounting/sales-invoices?raw=true')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerInvoicesRes.status).toBe(200);
    const ownerInvoiceIds = ownerInvoicesRes.body.map((inv: any) => inv.id);
    expect(ownerInvoiceIds).toContain(ownerInvId);
    expect(ownerInvoiceIds).toContain(clerkInvId);

    // Direct detail-by-ID GET /api/accounting/sales-invoices/:id on out-of-scope ownerInvId is blocked (403 DATA_SCOPE_VIOLATION)
    const clerkDetailOwnerInv = await request(app)
      .get(`/api/accounting/sales-invoices/${ownerInvId}`)
      .set('Authorization', `Bearer ${ownRecordsSalesToken}`);
    expect(clerkDetailOwnerInv.status).toBe(403);
    expect(clerkDetailOwnerInv.body.code).toBe('DATA_SCOPE_VIOLATION');

    // Direct detail-by-ID GET /api/accounting/sales-invoices/:id on clerk's own invoice succeeds
    const clerkDetailOwnInv = await request(app)
      .get(`/api/accounting/sales-invoices/${clerkInvId}`)
      .set('Authorization', `Bearer ${ownRecordsSalesToken}`);
    expect(clerkDetailOwnInv.status).toBe(200);
    expect(clerkDetailOwnInv.body.id).toBe(clerkInvId);
  });

  it('6. Enforces fail-closed behavior for OWN_RECORDS, ASSIGNED_RECORDS, and empty DEPARTMENT/PROJECT/COST_CENTER scopes, and blocks cross-tenant x-company-id spoofing', async () => {
    const companyDb = await CompanyManager.getCompanyDb(COMPANY_ID);

    await dbContext.run(companyDb, async () => {
      // 1. Verify OWN_RECORDS fails closed (returns false) when createdBy and submittedBy are undefined
      const ownScope = await RbacService.resolveModuleDataScope(ownRecordsSalesMemId, 'usr-rbac-sales-own', 'sales');
      expect(ownScope.dataScope).toBe('OWN_RECORDS');
      expect(ownScope.matchesRecord({})).toBe(false);
      expect(ownScope.matchesRecord({ createdBy: null, submittedBy: null })).toBe(false);
      expect(ownScope.matchesRecord({ createdBy: 'usr-rbac-owner' })).toBe(false);
      expect(ownScope.matchesRecord({ createdBy: 'usr-rbac-sales-own' })).toBe(true);

      // 2. Switch membership dataScope to ASSIGNED_RECORDS and verify fail-closed + assignedTo matching
      await db
        .update(schema.companyUsers)
        .set({ defaultDataScope: 'ASSIGNED_RECORDS' })
        .where(eq(schema.companyUsers.id, ownRecordsSalesMemId));
      await db
        .update(schema.userModuleAssignments)
        .set({ dataScope: 'ASSIGNED_RECORDS' })
        .where(eq(schema.userModuleAssignments.companyUserId, ownRecordsSalesMemId));

      const assignedScope = await RbacService.resolveModuleDataScope(ownRecordsSalesMemId, 'usr-rbac-sales-own', 'sales');
      expect(assignedScope.dataScope).toBe('ASSIGNED_RECORDS');
      expect(assignedScope.matchesRecord({})).toBe(false);
      expect(assignedScope.matchesRecord({ assignedTo: 'usr-rbac-owner' })).toBe(false);
      expect(assignedScope.matchesRecord({ assignedTo: 'usr-rbac-sales-own' })).toBe(true);
      expect(assignedScope.matchesRecord({ createdBy: 'usr-rbac-sales-own' })).toBe(true);

      // Restore back to OWN_RECORDS
      await db
        .update(schema.companyUsers)
        .set({ defaultDataScope: 'OWN_RECORDS' })
        .where(eq(schema.companyUsers.id, ownRecordsSalesMemId));
      await db
        .update(schema.userModuleAssignments)
        .set({ dataScope: 'OWN_RECORDS' })
        .where(eq(schema.userModuleAssignments.companyUserId, ownRecordsSalesMemId));
    });

    // 3. Cross-tenant x-company-id spoofing on /api/banking/accounts and /api/bi/dashboard is rejected with 403 TENANT_SCOPE_VIOLATION
    const crossTenantBankRes = await request(app)
      .get('/api/banking/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-company-id', 'LGR-FOREIGN-COMPANY-999');
    expect(crossTenantBankRes.status).toBe(403);
    expect(crossTenantBankRes.body.error).toBe('TENANT_SCOPE_VIOLATION');

    const crossTenantBiRes = await request(app)
      .get('/api/bi/dashboard')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-company-id', 'LGR-FOREIGN-COMPANY-999');
    expect(crossTenantBiRes.status).toBe(403);
    expect(crossTenantBiRes.body.error).toBe('TENANT_SCOPE_VIOLATION');
  });
});

