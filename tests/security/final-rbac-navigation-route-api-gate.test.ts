import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Enforce strict test isolation directory BEFORE loading application modules
const ISOLATED_TEST_ROOT = '/tmp/ledgerai_final_rbac_gate_isolated';
process.env.LEDGERAI_DATA_DIR = path.join(ISOLATED_TEST_ROOT, 'companies');
process.env.LEDGERAI_CONFIG_DIR = path.join(ISOLATED_TEST_ROOT, 'config');

import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import {
  getAuthorizedERPModules,
  isRouteAuthorizedForUser,
} from '../../src/shared/moduleRegistry';

describe('LEDGERAI PH — FINAL RBAC NAVIGATION, ROUTE & API INTEGRATION REGRESSION GATE', () => {
  const app = createApp();
  const COMPANY_1_ID = 'LGR-PH-FINAL-GATE-C1';
  const COMPANY_2_ID = 'LGR-PH-FINAL-GATE-C2';

  let c1Db: any;
  let c2Db: any;
  const runInC1 = <T>(fn: () => Promise<T>): Promise<T> => dbContext.run(c1Db, fn);
  const runInC2 = <T>(fn: () => Promise<T>): Promise<T> => dbContext.run(c2Db, fn);

  let adminToken: string;
  let adminUserId: string;

  // Jaeanne Gomez (Accountant in Deskguard Solutions)
  let jaeanneToken: string;
  let jaeanneMemId: string;
  let jaeanneUserId: string;

  // Company 2 membership for Jaeanne to test company switching & isolation
  let jaeanneCo2Token: string;
  let jaeanneCo2MemId: string;

  const createTestUserSession = async (
    companyId: string,
    userId: string,
    email: string,
    displayName: string,
    roleName: string
  ) => {
    await db
      .insert(schema.users)
      .values({
        id: userId,
        email,
        displayName,
        passwordHash: 'test_hash',
        status: 'ACTIVE',
      })
      .onConflictDoNothing();

    const roleRec = await RbacService.ensureRoleRecord(roleName);
    const memId = `mem-${companyId}-${userId}`;

    await db
      .insert(schema.companyUsers)
      .values({
        id: memId,
        userId,
        companyId,
        roleId: roleRec.id,
        legacyRole: roleName,
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        defaultDataScope: 'COMPANY_WIDE',
        approvalLimitCentavos: 0,
      })
      .onConflictDoNothing();

    await RbacService.setMemberRoles(null, memId, [roleName], `Provisioned ${roleName}`);

    const rawToken = crypto.randomBytes(32).toString('hex');
    await db.insert(schema.sessions).values({
      id: hashToken(rawToken),
      userId,
      companyId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    return { token: `${companyId}.${rawToken}`, memId, userId };
  };

  const setJaeanneAssignments = async (
    assignments: Array<{ moduleId: string; submoduleIds: string[]; actions: string[] }>,
    justification: string
  ) => {
    const res = await request(app)
      .put(`/api/rbac/members/${jaeanneMemId}/module-assignments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assignments, justification });
    expect(res.status).toBe(200);
  };

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    if (fs.existsSync(ISOLATED_TEST_ROOT)) {
      try {
        fs.rmSync(ISOLATED_TEST_ROOT, { recursive: true, force: true });
      } catch {}
    }

    await CompanyManager.createCompanyProfile(
      COMPANY_1_ID,
      'Deskguard Solutions',
      '009-881-223-00000',
      undefined,
      false,
      { classification: 'PILOT' }
    );
    await CompanyManager.createCompanyProfile(
      COMPANY_2_ID,
      'Pacific Horizon Enterprise Inc.',
      '009-992-334-00000',
      undefined,
      false,
      { classification: 'PILOT' }
    );

    c1Db = await CompanyManager.getCompanyDb(COMPANY_1_ID);
    c2Db = await CompanyManager.getCompanyDb(COMPANY_2_ID);

    await runInC1(async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      const admin = await createTestUserSession(
        COMPANY_1_ID,
        'usr-admin-deskguard',
        'admin@deskguard.ph',
        'Deskguard Admin',
        'Company Owner'
      );
      adminToken = admin.token;
      adminUserId = admin.userId;

      const jaeanne = await createTestUserSession(
        COMPANY_1_ID,
        'usr-jaeanne-gomez',
        'jaeanne.gomez@deskguard.ph',
        'Jaeanne Gomez',
        'Accountant'
      );
      jaeanneToken = jaeanne.token;
      jaeanneMemId = jaeanne.memId;
      jaeanneUserId = jaeanne.userId;

      // Seed test records across modules in Company 1 for Search & Notifications testing
      await db.insert(schema.customers).values({
        id: 'cust-dg-01',
        companyId: COMPANY_1_ID,
        code: 'CUST-DG-001',
        legalName: 'Apex Logistics Corp',
        tin: '001-222-333-000',
        status: 'ACTIVE',
      }).onConflictDoNothing();
      await db.insert(schema.vendors).values({
        id: 'vend-dg-01',
        companyId: COMPANY_1_ID,
        code: 'VEND-DG-001',
        legalName: 'Metro Office Supplies Inc',
        tin: '004-555-666-000',
        status: 'ACTIVE',
      }).onConflictDoNothing();
      await db.insert(schema.journalEntries).values({
        id: 'je-dg-01',
        companyId: COMPANY_1_ID,
        journalNumber: 'JV-2026-9001',
        entryDate: '2026-11-01',
        description: 'Deskguard Monthly Accrual Entry',
        status: 'POSTED',
        createdBy: jaeanneUserId,
      }).onConflictDoNothing();
      await db.insert(schema.salesInvoices).values({
        id: 'inv-dg-01',
        companyId: COMPANY_1_ID,
        invoiceNumber: 'SI-2026-7001',
        customerId: 'cust-dg-01',
        invoiceDate: '2026-11-02',
        dueDate: '2026-12-02',
        subtotal: 100000,
        taxAmount: 12000,
        totalAmount: 112000,
        balanceDue: 112000,
        status: 'POSTED',
        createdBy: adminUserId,
      }).onConflictDoNothing();
      await db.insert(schema.purchaseBills).values({
        id: 'bill-dg-01',
        companyId: COMPANY_1_ID,
        billNumber: 'PB-2026-8001',
        vendorId: 'vend-dg-01',
        billDate: '2026-11-03',
        dueDate: '2026-12-03',
        subtotal: 50000,
        taxAmount: 6000,
        totalAmount: 56000,
        balanceDue: 56000,
        status: 'POSTED',
        createdBy: adminUserId,
      }).onConflictDoNothing();

      // Seed notifications: 1 broadcast journal alert, 1 sales invoice alert, 1 private admin notification
      await db.insert(schema.notifications).values([
        {
          id: 'notif-broadcast-sys',
          companyId: COMPANY_1_ID,
          userId: null,
          title: 'Monthly Closing Window Open',
          message: 'Please complete reconciliations.',
          type: 'SYSTEM',
          entityType: 'JOURNAL_ENTRY',
          entityId: 'je-dg-01',
          isRead: false,
        },
        {
          id: 'notif-sales-only',
          companyId: COMPANY_1_ID,
          userId: null,
          title: 'New Sales Invoice SI-2026-7001',
          message: 'Sales invoice posted.',
          type: 'SYSTEM',
          entityType: 'SALES_INVOICE',
          entityId: 'inv-dg-01',
          isRead: false,
        },
        {
          id: 'notif-private-admin',
          companyId: COMPANY_1_ID,
          userId: adminUserId,
          title: 'Private Admin Security Notice',
          message: 'Admin-only alert.',
          type: 'SECURITY',
          entityType: 'BACKUP',
          entityId: 'bkp-01',
          isRead: false,
        },
      ]).onConflictDoNothing();
    });

    await runInC2(async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      const jaeanneCo2 = await createTestUserSession(
        COMPANY_2_ID,
        jaeanneUserId,
        'jaeanne.gomez@deskguard.ph',
        'Jaeanne Gomez',
        'Bookkeeper'
      );
      jaeanneCo2Token = jaeanneCo2.token;
      jaeanneCo2MemId = jaeanneCo2.memId;

      await db.insert(schema.customers).values({
        id: 'cust-co2-01',
        companyId: COMPANY_2_ID,
        code: 'CUST-CO2-999',
        legalName: 'Pacific Secret Client Ltd',
        tin: '009-111-222-000',
        status: 'ACTIVE',
      }).onConflictDoNothing();
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    if (fs.existsSync(ISOLATED_TEST_ROOT)) {
      try {
        fs.rmSync(ISOLATED_TEST_ROOT, { recursive: true, force: true });
      } catch {}
    }
  });

  // =========================================================================
  // 1. ACTIVITY CENTER VS APPROVALS & WORKFLOW ROUTE DISAMBIGUATION
  // =========================================================================
  describe('1. Activity Center vs Approvals & Workflow Disambiguation', () => {
    it('allows Activity Center (?workspace=stream) while denying Approvals (?workspace=approvals) when user has activity-center only', async () => {
      // Configure Jaeanne Gomez to match the Deskguard Solutions screenshot:
      // Modules: dashboard, accounting, tax, documents, reports, activity-center (NO approvals, NO sales, NO procurement, NO cash-banking, NO master-data)
      await setJaeanneAssignments(
        [
          {
            moduleId: 'dashboard',
            submoduleIds: ['dash-overview'],
            actions: ['view'],
          },
          {
            moduleId: 'accounting',
            submoduleIds: ['acct-coa', 'acct-journals', 'acct-tb', 'acct-periods', 'acct-forex'],
            actions: ['view', 'create', 'edit', 'post'],
          },
          {
            moduleId: 'tax',
            submoduleIds: ['tax-engine', 'tax-schedules', 'tax-data-entry', 'tax-returns'],
            actions: ['view', 'create', 'edit'],
          },
          {
            moduleId: 'documents',
            submoduleIds: ['doc-inbox'],
            actions: ['view', 'create'],
          },
          {
            moduleId: 'reports',
            submoduleIds: ['rep-statements'],
            actions: ['view', 'export'],
          },
          {
            moduleId: 'activity-center',
            submoduleIds: ['act-stream'],
            actions: ['view'],
          },
        ],
        'Configure Jaeanne Gomez custom profile (Activity Center enabled, Approvals disabled)'
      );

      const meRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(meRes.status).toBe(200);

      const permissions = meRes.body.permissions;
      const { assignedModules, assignedSubmodules } = meRes.body.activeCompany;
      expect(assignedModules).toContain('activity-center');
      expect(assignedModules).not.toContain('approvals');
      expect(permissions).toContain('activity:view');
      expect(permissions).not.toContain('approvals:view');

      // Route disambiguation checks:
      // 1) /activity-center?workspace=stream -> ALLOWED
      expect(
        isRouteAuthorizedForUser(
          '/activity-center',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules,
          '?workspace=stream'
        )
      ).toBe(true);

      // 2) /activity-center?workspace=approvals -> DENIED
      expect(
        isRouteAuthorizedForUser(
          '/activity-center',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules,
          '?workspace=approvals'
        )
      ).toBe(false);

      // 3) /activity-center with no workspace -> ALLOWED (loads authorized stream workspace)
      expect(
        isRouteAuthorizedForUser(
          '/activity-center',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules,
          ''
        )
      ).toBe(true);

      // 4) /activity-center?workspace=invalid -> DENIED (fails closed)
      expect(
        isRouteAuthorizedForUser(
          '/activity-center',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules,
          '?workspace=invalid'
        )
      ).toBe(false);

      // 5) Direct /approvals route -> DENIED
      expect(
        isRouteAuthorizedForUser(
          '/approvals',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules,
          ''
        )
      ).toBe(false);

      // 6) Backend API enforcement:
      // GET /api/journey/activity-center -> 200 OK
      const actRes = await request(app)
        .get('/api/journey/activity-center')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(actRes.status).toBe(200);

      // GET /api/journey/approvals -> 403 PERMISSION_DENIED
      const appRes = await request(app)
        .get('/api/journey/approvals')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(appRes.status).toBe(403);
      expect(appRes.body.code).toBe('PERMISSION_DENIED');

      // GET /api/journey/investigation -> 403 PERMISSION_DENIED
      const invRes = await request(app)
        .get('/api/journey/investigation')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(invRes.status).toBe(403);
    });

    it('allows Approvals (?workspace=approvals & /approvals) while denying Activity Center (?workspace=stream) when user has approvals only', async () => {
      await setJaeanneAssignments(
        [
          {
            moduleId: 'dashboard',
            submoduleIds: ['dash-overview'],
            actions: ['view'],
          },
          {
            moduleId: 'approvals',
            submoduleIds: ['appr-inbox'],
            actions: ['view', 'approve', 'reject'],
          },
        ],
        'Configure Approvals-only access, Activity Center denied'
      );

      const meRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      const permissions = meRes.body.permissions;
      const { assignedModules, assignedSubmodules } = meRes.body.activeCompany;

      expect(assignedModules).toContain('approvals');
      expect(assignedModules).not.toContain('activity-center');

      // ?workspace=stream -> DENIED
      expect(
        isRouteAuthorizedForUser(
          '/activity-center',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules,
          '?workspace=stream'
        )
      ).toBe(false);

      // ?workspace=approvals -> ALLOWED
      expect(
        isRouteAuthorizedForUser(
          '/activity-center',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules,
          '?workspace=approvals'
        )
      ).toBe(true);

      // Bare /activity-center -> ALLOWED (GlobalActivityCenter auto-switches to APPROVALS tab)
      expect(
        isRouteAuthorizedForUser(
          '/activity-center',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules,
          ''
        )
      ).toBe(true);

      // ?workspace=invalid -> DENIED
      expect(
        isRouteAuthorizedForUser(
          '/activity-center',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules,
          '?workspace=invalid'
        )
      ).toBe(false);

      // Backend API enforcement:
      // GET /api/journey/activity-center -> 403 PERMISSION_DENIED
      const actRes = await request(app)
        .get('/api/journey/activity-center')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(actRes.status).toBe(403);

      // GET /api/journey/approvals -> 200 OK
      const appRes = await request(app)
        .get('/api/journey/approvals')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(appRes.status).toBe(200);
    });
  });

  // =========================================================================
  // 2. GRANULAR SUBMODULE ROUTES WITHOUT UNRESTRICTED ACCOUNTING:VIEW
  // =========================================================================
  describe('2. Granular Submodule Routes & Least-Privilege Backend Enforcement', () => {
    it('supports Trial Balance, Sales, Procurement, Cash & Banking, and Master Data submodules without unrestricted accounting:view', async () => {
      await setJaeanneAssignments(
        [
          {
            moduleId: 'reports',
            submoduleIds: ['rep-statements'], // Financial Statements & Trial Balance
            actions: ['view'],
          },
          {
            moduleId: 'sales',
            submoduleIds: ['sales-invoices'], // Sales Invoices
            actions: ['view'],
          },
          {
            moduleId: 'procurement',
            submoduleIds: ['proc-bills'], // Only Purchase Bills (proc-matching denied)
            actions: ['view'],
          },
          {
            moduleId: 'cash-banking',
            submoduleIds: ['cash-mgmt'], // Only Cash Management (bank-recon denied)
            actions: ['view'],
          },
          {
            moduleId: 'master-data',
            submoduleIds: ['md-customers'], // Only Customer Directory (md-vendors & md-tax-codes denied)
            actions: ['view'],
          },
        ],
        'Configure granular submodule access without accounting:view'
      );

      const meRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      const permissions = meRes.body.permissions;
      const { assignedModules, assignedSubmodules } = meRes.body.activeCompany;

      expect(permissions).not.toContain('accounting:view');
      expect(permissions).toContain('reports:view');
      expect(permissions).toContain('sales:view');
      expect(permissions).toContain('purchases:view');
      expect(permissions).toContain('cash:view');
      expect(permissions).toContain('masterdata:view');

      // Trial Balance is accessible via reports/rep-statements without accounting:view
      expect(
        isRouteAuthorizedForUser(
          '/reports/trial-balance',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules
        )
      ).toBe(true);
      const tbRes = await request(app)
        .get('/api/reports/trial-balance')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(tbRes.status).toBe(200);

      // Sales Invoices accessible
      expect(
        isRouteAuthorizedForUser(
          '/accounting/sales-invoicing',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules
        )
      ).toBe(true);
      const salesRes = await request(app)
        .get('/api/accounting/sales-invoices')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(salesRes.status).toBe(200);

      // Procurement Bills accessible, Procurement 3-Way Match (proc-matching) sibling denied
      expect(
        isRouteAuthorizedForUser(
          '/accounting/purchase-bills',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules
        )
      ).toBe(true);
      expect(
        isRouteAuthorizedForUser(
          '/accounting/procurement',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules
        )
      ).toBe(false);
      const billsRes = await request(app)
        .get('/api/accounting/purchase-bills')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(billsRes.status).toBe(200);

      // Cash & Banking Cash Management accessible, Bank Reconciliation (bank-recon) sibling denied
      expect(
        isRouteAuthorizedForUser(
          '/accounting/cash-transactions',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules
        )
      ).toBe(true);
      expect(
        isRouteAuthorizedForUser(
          '/accounting/bank-reconciliation',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules
        )
      ).toBe(false);
      const cashRes = await request(app)
        .get('/api/accounting/cash-transactions')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(cashRes.status).toBe(200);

      // Master Data Customer Directory accessible, Vendor Directory & Tax Codes siblings denied
      expect(
        isRouteAuthorizedForUser(
          '/master-data/customers',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules
        )
      ).toBe(true);
      expect(
        isRouteAuthorizedForUser(
          '/master-data/vendors',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules
        )
      ).toBe(false);
      expect(
        isRouteAuthorizedForUser(
          '/master-data/tax-codes',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules
        )
      ).toBe(false);

      // Accounting routes & APIs remain strictly 403 when accounting:view is denied
      expect(
        isRouteAuthorizedForUser(
          '/accounting/journals',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules
        )
      ).toBe(false);
      const journalsRes = await request(app)
        .get('/api/accounting/journals')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(journalsRes.status).toBe(403);

      const coaRes = await request(app)
        .get('/api/accounting/accounts')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(coaRes.status).toBe(403);
    });
  });

  // =========================================================================
  // 3. DASHBOARD DISABLED SCENARIO
  // =========================================================================
  describe('3. Dashboard Disabled Deterministic Fallback & Zero-Module Safe State', () => {
    it('denies / and /dashboard when Dashboard is disabled and computes deterministic first non-dashboard fallback route', async () => {
      await setJaeanneAssignments(
        [
          {
            moduleId: 'accounting',
            submoduleIds: ['acct-journals', 'acct-ledger'],
            actions: ['view'],
          },
          {
            moduleId: 'tax',
            submoduleIds: ['tax-vat'],
            actions: ['view'],
          },
        ],
        'Disable Dashboard to verify deterministic fallback'
      );

      const meRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      const permissions = meRes.body.permissions;
      const { assignedModules, assignedSubmodules } = meRes.body.activeCompany;

      expect(assignedModules).not.toContain('dashboard');
      expect(
        isRouteAuthorizedForUser('/', 'Accountant', permissions, assignedModules, assignedSubmodules)
      ).toBe(false);
      expect(
        isRouteAuthorizedForUser(
          '/dashboard',
          'Accountant',
          permissions,
          assignedModules,
          assignedSubmodules
        )
      ).toBe(false);

      const authorizedModules = getAuthorizedERPModules(
        'Accountant',
        permissions,
        assignedModules,
        assignedSubmodules
      );
      expect(authorizedModules.map((m) => m.id)).not.toContain('dashboard');
      const firstNonDashboard = authorizedModules.find((m) => m.id !== 'dashboard');
      expect(firstNonDashboard?.id).toBe('accounting');
      const deterministicFallbackRoute =
        firstNonDashboard?.submodules[0]?.route || firstNonDashboard?.baseRoute;
      expect(deterministicFallbackRoute).toBe('/accounting/journals');
    });

    it('returns empty authorized modules when user has zero authorized modules (triggering safe Access Restricted view without redirect loop)', async () => {
      await setJaeanneAssignments([], 'Disable all modules to verify zero-module safe state');

      const meRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      const permissions = meRes.body.permissions;
      const { assignedModules, assignedSubmodules } = meRes.body.activeCompany;

      expect(assignedModules).toEqual([]);
      const authorizedModules = getAuthorizedERPModules(
        'Accountant',
        permissions,
        assignedModules,
        assignedSubmodules
      );
      expect(authorizedModules).toEqual([]);
      expect(
        isRouteAuthorizedForUser('/', 'Accountant', permissions, assignedModules, assignedSubmodules)
      ).toBe(false);
    });
  });

  // =========================================================================
  // 4. BACKUP AND LICENSING BANNER PERMISSIONS
  // =========================================================================
  describe('4. Backup and Licensing Banner Permission Separation', () => {
    it('enforces strict separation between backups:view, backups:create, backups:download, backups:restore, backups:verify, and settings:manage', async () => {
      await setJaeanneAssignments(
        [
          {
            moduleId: 'dashboard',
            submoduleIds: ['dash-exec'],
            actions: ['view'],
          },
          {
            moduleId: 'accounting',
            submoduleIds: ['acct-journals', 'acct-ledger', 'acct-tb'],
            actions: ['view', 'create', 'edit'],
          },
        ],
        'Standard Accountant without backup or license management permissions'
      );

      const meRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      const permissions = meRes.body.permissions;

      expect(permissions).not.toContain('backups:view');
      expect(permissions).not.toContain('backups:create');
      expect(permissions).not.toContain('backups:download');
      expect(permissions).not.toContain('settings:manage');

      // Read-only license status is available to authenticated company members
      const licStatusRes = await request(app)
        .get('/api/licensing/status')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(licStatusRes.status).toBe(200);

      // License activation / upgrade requires settings:manage -> 403
      const licActivateRes = await request(app)
        .post('/api/licensing/activate')
        .set('Authorization', `Bearer ${jaeanneToken}`)
        .send({ activationKey: 'LGR-TEST-KEY' });
      expect(licActivateRes.status).toBe(403);

      // Backup endpoints all deny unauthorized Accountant -> 403
      const bkpListRes = await request(app)
        .get('/api/audit-advanced/backups')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(bkpListRes.status).toBe(403);

      const bkpCreateRes = await request(app)
        .post('/api/audit-advanced/backups/create')
        .set('Authorization', `Bearer ${jaeanneToken}`)
        .send({});
      expect(bkpCreateRes.status).toBe(403);

      const bkpVerifyRes = await request(app)
        .post('/api/audit-advanced/backups/integrity-check')
        .set('Authorization', `Bearer ${jaeanneToken}`)
        .send({});
      expect(bkpVerifyRes.status).toBe(403);

      const bkpDownloadRes = await request(app)
        .get('/api/backup')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(bkpDownloadRes.status).toBe(403);
    });
  });

  // =========================================================================
  // 5. NOTIFICATIONS, BRANDING, AND GLOBAL SEARCH
  // =========================================================================
  describe('5. Authenticated-Member Notifications, Branding, and Global Search Enforcement', () => {
    it('filters GET /api/notifications, GET/POST /api/branding, GET /api/search, and enforces multi-company isolation', async () => {
      // Configure Jaeanne with Accounting, Tax, Documents, Reports, Activity Center (Sales & Procurement DENIED)
      await setJaeanneAssignments(
        [
          {
            moduleId: 'dashboard',
            submoduleIds: ['dash-overview'],
            actions: ['view'],
          },
          {
            moduleId: 'accounting',
            submoduleIds: ['acct-coa', 'acct-journals', 'acct-tb', 'acct-periods', 'acct-forex'],
            actions: ['view', 'create', 'edit', 'post'],
          },
          {
            moduleId: 'tax',
            submoduleIds: ['tax-engine', 'tax-schedules', 'tax-data-entry', 'tax-returns'],
            actions: ['view', 'create', 'edit'],
          },
          {
            moduleId: 'documents',
            submoduleIds: ['doc-inbox'],
            actions: ['view', 'create'],
          },
          {
            moduleId: 'reports',
            submoduleIds: ['rep-statements'],
            actions: ['view', 'export'],
          },
          {
            moduleId: 'activity-center',
            submoduleIds: ['act-stream'],
            actions: ['view'],
          },
        ],
        'Configure Deskguard Solutions Accountant profile for Notifications/Branding/Search verification'
      );

      // 1) Notifications filtering
      const notifRes = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(notifRes.status).toBe(200);
      const ids = notifRes.body.map((n: any) => n.id);
      // Should see Journal Entry notification (accounting:view granted)
      expect(ids).toContain('notif-broadcast-sys');
      // Must NOT see Sales Invoice notification (sales:view denied)
      expect(ids).not.toContain('notif-sales-only');
      // Must NOT see Private Admin notification (userId === adminUserId & BACKUP entity)
      expect(ids).not.toContain('notif-private-admin');

      // 2) Branding GET allowed for member, POST blocked without settings:manage/company:write
      const getRes = await request(app)
        .get('/api/branding')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.companyId).toBe(COMPANY_1_ID);

      const postRes = await request(app)
        .post('/api/branding')
        .set('Authorization', `Bearer ${jaeanneToken}`)
        .send({ headerTitle: 'UNAUTHORIZED HEADER CHANGE' });
      expect(postRes.status).toBe(403);

      // 3) Global Search filtering
      // Search for "2026" which matches JV-2026-9001 (Journal), SI-2026-7001 (Sales Invoice), PB-2026-8001 (Purchase Bill)
      const searchRes = await request(app)
        .get('/api/search?q=2026')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(searchRes.status).toBe(200);

      const txTitles = searchRes.body.results.transactions.map((t: any) => t.title);
      // Authorized for Accounting Journals -> JV-2026-9001 returned
      expect(txTitles).toContain('JV-2026-9001');
      // Denied Sales & Procurement -> SI-2026-7001 and PB-2026-8001 excluded
      expect(txTitles).not.toContain('SI-2026-7001');
      expect(txTitles).not.toContain('PB-2026-8001');

      // Search for "Pacific" -> must not return Customer (master-data & sales denied) or Company 2 records
      const contactSearchRes = await request(app)
        .get('/api/search?q=Pacific')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      expect(contactSearchRes.status).toBe(200);
      expect(contactSearchRes.body.results.contacts).toEqual([]);

      // 4) Multi-company RBAC isolation when switching between Company 1 and Company 2
      const co1Me = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${jaeanneToken}`);
      const co2Me = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${jaeanneCo2Token}`);

      expect(co1Me.status).toBe(200);
      expect(co2Me.status).toBe(200);
      expect(co1Me.body.activeCompany.id).toBe(COMPANY_1_ID);
      expect(co2Me.body.activeCompany.id).toBe(COMPANY_2_ID);

      expect(co1Me.body.permissions).toContain('accounting:view');
      expect(co1Me.body.permissions).not.toContain('sales:view');

      expect(co2Me.body.permissions).toContain('sales:view');
      expect(co2Me.body.permissions).not.toContain('accounting:view');
    });
  });
});
