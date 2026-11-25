import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { eq, and, sql } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import {
  resolveCompanyControlAccount,
  createSalesInvoice,
  submitSalesInvoice,
  approveSalesInvoice,
  postSalesInvoice,
  createCustomerPayment,
  submitCustomerPayment,
  approveCustomerPayment,
  postCustomerPayment,
  createPurchaseBill,
  submitPurchaseBill,
  approvePurchaseBill,
  postPurchaseBill,
  issueCheck,
  clearCheck,
  createBankDeposit,
  submitBankDeposit,
  createBankReconciliation,
  addManualBankStatementLine,
  autoMatchBankReconciliation,
  addReconciliationAdjustment,
  submitBankReconciliation,
  approveBankReconciliation,
} from '../../src/server/db/business_transactions';
import { AuditService } from '../../src/server/services/auditService';
import { TaxEngine } from '../../src/server/services/taxEngine';
import { StatutoryRuleEngine } from '../../src/server/services/statutoryRuleEngine';
import { RestoreService } from '../../src/server/services/restoreService';
import { DatabaseEncryptionService } from '../../src/server/services/databaseEncryptionService';
import { HybridSyncService } from '../../src/server/services/hybridSyncService';

describe('LEDGERAI PH — Enterprise Release Candidate Adversarial Acceptance Suite (Rules 2-8)', () => {
  const app = createApp();
  const RUN_TAG = crypto.randomBytes(3).toString('hex').toUpperCase();
  const CORP_A = `LGR-PH-2026-TEST-RC-${RUN_TAG}-A`;
  const CORP_B = `LGR-PH-2026-TEST-RC-${RUN_TAG}-B`;

  const OWNER_A_ID = 'rc-owner-a';
  const MAKER_A_ID = 'rc-maker-a';
  const VIEWER_A_ID = 'rc-viewer-a';
  const OWNER_B_ID = 'rc-owner-b';

  let ownerAToken = '';
  let makerAToken = '';
  let viewerAToken = '';
  let ownerBToken = '';

  const PERIOD_A_ID = 'rc-per-2026-q1';

  const ACC_CASH_A = 'rc-acc-1010';
  const ACC_AR_A = 'rc-acc-1030';
  const ACC_INV_A = 'rc-acc-1040';
  const ACC_INVAT_A = 'rc-acc-1060';
  const ACC_AP_A = 'rc-acc-2010';
  const ACC_OUTVAT_A = 'rc-acc-2020';
  const ACC_EWT_A = 'rc-acc-2030';
  const ACC_UNBILLED_AP_A = 'rc-acc-2100';
  const ACC_REV_A = 'rc-acc-4010';
  const ACC_COGS_A = 'rc-acc-5010';
  const ACC_EXP_A = 'rc-acc-6010';
  const ACC_HDR_ASSETS = 'rc-acc-1000-hdr';
  const ACC_INACTIVE_CASH = 'rc-acc-1019-inactive';

  const CUST_A_ID = 'rc-cust-a';
  const VEND_A_ID = 'rc-vend-a';
  const ITEM_A_ID = 'rc-item-a';

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(CORP_A);
    await CompanyManager.resetDisposableTestCompanyWorkspace(CORP_B);

    await CompanyManager.createCompanyProfile(
      CORP_A,
      'RC Acceptance Alpha Trading Corp.',
      '123-456-789-000',
      'BGC Taguig, Metro Manila',
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    await CompanyManager.createCompanyProfile(
      CORP_B,
      'RC Acceptance Zero-Data Beta Corp.',
      '987-654-321-000',
      'Makati City, Metro Manila',
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    // Helper to seed user + membership + RBAC + session token in a company DB
    const seedUserAndSession = async (
      companyId: string,
      userId: string,
      email: string,
      displayName: string,
      roleName: string,
      legacyRole: string
    ) => {
      await db.insert(schema.users).values({
        id: userId,
        email,
        passwordHash: 'h',
        displayName,
        status: 'ACTIVE',
      }).onConflictDoNothing();

      const roleRec = await RbacService.ensureRoleRecord(roleName);
      const memId = `mem-${companyId}-${userId}`;
      await db.insert(schema.companyUsers).values({
        id: memId,
        companyId,
        userId,
        roleId: roleRec.id,
        role: roleName,
        legacyRole,
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        defaultDataScope: 'COMPANY_WIDE',
      }).onConflictDoNothing();

      await RbacService.setMemberRoles(null, memId, [roleName], `RC acceptance seed ${roleName}`);

      const rawToken = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawToken),
        userId,
        companyId,
        expiresAt: new Date(Date.now() + 86400 * 1000),
      });
      return `${companyId}.${rawToken}`;
    };

    // Seed Corp A
    const dbA = await CompanyManager.getCompanyDb(CORP_A);
    const sqliteA = await CompanyManager.getCompanySqlite(CORP_A);
    sqliteA.pragma('foreign_keys = OFF');
    sqliteA.prepare('DELETE FROM accounting_periods WHERE company_id = ?').run(CORP_A);
    sqliteA.prepare('DELETE FROM accounts WHERE company_id = ?').run(CORP_A);
    sqliteA.pragma('foreign_keys = ON');

    await dbContext.run(dbA, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      ownerAToken = await seedUserAndSession(CORP_A, OWNER_A_ID, 'owner@rc-a.ph', 'RC Owner A', 'Company Owner', 'admin');
      makerAToken = await seedUserAndSession(CORP_A, MAKER_A_ID, 'maker@rc-a.ph', 'RC Maker A', 'Bookkeeper', 'editor');
      viewerAToken = await seedUserAndSession(CORP_A, VIEWER_A_ID, 'viewer@rc-a.ph', 'RC Viewer A', 'Auditor', 'viewer');

      await db.insert(schema.accountingPeriods).values([
        { id: PERIOD_A_ID, companyId: CORP_A, name: '2026-01', fiscalYear: 2026, startDate: '2026-01-01', endDate: '2026-03-31', status: 'OPEN' },
        { id: 'rc-per-2026-q2', companyId: CORP_A, name: '2026-06', fiscalYear: 2026, startDate: '2026-04-01', endDate: '2026-06-30', status: 'OPEN' },
      ]).onConflictDoNothing();

      await db.insert(schema.accounts).values([
        { id: ACC_HDR_ASSETS, companyId: CORP_A, accountCode: '1000', accountName: 'Assets Header', accountType: 'ASSET', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_CASH_A, companyId: CORP_A, accountCode: '1010', accountName: 'Cash in Bank - BPI', accountType: 'ASSET', detailType: 'CASH', normalBalance: 'DEBIT', parentAccountId: ACC_HDR_ASSETS, isControlAccount: true, isCashAccount: true, status: 'ACTIVE' },
        { id: ACC_INACTIVE_CASH, companyId: CORP_A, accountCode: '1019', accountName: 'Closed Old Bank Account', accountType: 'ASSET', detailType: 'CASH', normalBalance: 'DEBIT', parentAccountId: ACC_HDR_ASSETS, isCashAccount: true, status: 'INACTIVE' },
        { id: ACC_AR_A, companyId: CORP_A, accountCode: '1030', accountName: 'Accounts Receivable', accountType: 'ASSET', detailType: 'ACCOUNTS_RECEIVABLE', normalBalance: 'DEBIT', parentAccountId: ACC_HDR_ASSETS, isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_INV_A, companyId: CORP_A, accountCode: '1040', accountName: 'Merchandise Inventory', accountType: 'ASSET', detailType: 'INVENTORY', normalBalance: 'DEBIT', parentAccountId: ACC_HDR_ASSETS, status: 'ACTIVE' },
        { id: ACC_INVAT_A, companyId: CORP_A, accountCode: '1060', accountName: 'Input VAT', accountType: 'ASSET', normalBalance: 'DEBIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_AP_A, companyId: CORP_A, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'LIABILITY', detailType: 'ACCOUNTS_PAYABLE', normalBalance: 'CREDIT', isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_OUTVAT_A, companyId: CORP_A, accountCode: '2020', accountName: 'Output VAT Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_EWT_A, companyId: CORP_A, accountCode: '2030', accountName: 'Expanded Withholding Tax Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_UNBILLED_AP_A, companyId: CORP_A, accountCode: '2100', accountName: 'Goods Received Not Invoiced (GRNI)', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_REV_A, companyId: CORP_A, accountCode: '4010', accountName: 'Sales Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_COGS_A, companyId: CORP_A, accountCode: '5010', accountName: 'Cost of Goods Sold', accountType: 'COGS', detailType: 'COGS', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_EXP_A, companyId: CORP_A, accountCode: '6010', accountName: 'Operating Expense & Bank Charges', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
      ]).onConflictDoNothing();

      await db.insert(schema.customers).values({
        id: CUST_A_ID,
        companyId: CORP_A,
        code: 'C-RC-001',
        legalName: 'RC Enterprise Buyer Inc.',
        tin: '234-567-890-000',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.vendors).values({
        id: VEND_A_ID,
        companyId: CORP_A,
        code: 'V-RC-001',
        legalName: 'RC Verified Supplier Corp.',
        tin: '345-678-901-000',
        taxpayerClassification: 'CORPORATION',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.inventoryItems).values({
        id: ITEM_A_ID,
        companyId: CORP_A,
        sku: 'SKU-RC-001',
        name: 'Enterprise Server Rack',
        category: 'HARDWARE',
        unitOfMeasure: 'UNIT',
        quantityOnHand: 10,
        unitCost: 100000, // PHP 1,000.00
        sellingPrice: 150000,
        inventoryAccountId: ACC_INV_A,
        cogsAccountId: ACC_COGS_A,
        salesAccountId: ACC_REV_A,
        status: 'ACTIVE',
        version: 1,
      }).onConflictDoNothing();
    });

    // Seed Corp B (completely clean/zero sales & bills)
    const dbB = await CompanyManager.getCompanyDb(CORP_B);
    await dbContext.run(dbB, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      ownerBToken = await seedUserAndSession(CORP_B, OWNER_B_ID, 'owner@rc-b.ph', 'RC Owner B', 'Company Owner', 'admin');
    });

    (globalThis as any).__rcTokens = { ownerAToken, makerAToken, viewerAToken, ownerBToken };
  });

  afterAll(async () => {
    await CompanyManager.resetDisposableTestCompanyWorkspace(CORP_A);
    await CompanyManager.resetDisposableTestCompanyWorkspace(CORP_B);
  });

  // =========================================================================
  // GATE 1 (RULE 2): COA CONTROL ACCOUNT DETERMINISTIC RESOLUTION
  // =========================================================================
  it('Rule 2: resolveCompanyControlAccount fails closed on invalid/inactive/foreign/mismatched preferredAccountId while preserving same-company header compat', async () => {
    const dbA = await CompanyManager.getCompanyDb(CORP_A);
    await dbContext.run(dbA, async () => {
      // Compatible behavior: same-company parent header still falls back to leaf
      const fromHeader = await resolveCompanyControlAccount(db, CORP_A, 'CASH', ACC_HDR_ASSETS);
      expect(fromHeader?.id).toBe(ACC_CASH_A);

      // Must fail closed instead of silently ignoring invalid preferredAccountId
      await expect(resolveCompanyControlAccount(db, CORP_A, 'CASH', 'non-existent-acc-999')).rejects.toThrow();
      await expect(resolveCompanyControlAccount(db, CORP_A, 'CASH', ACC_INACTIVE_CASH)).rejects.toThrow();
      await expect(resolveCompanyControlAccount(db, CORP_A, 'CASH', ACC_EXP_A)).rejects.toThrow();
      await expect(resolveCompanyControlAccount(db, CORP_A, 'AR', ACC_AP_A)).rejects.toThrow();
    });
  });

  // =========================================================================
  // GATE 2 (RULE 3 & RULE 4): LIFECYCLE, IMMUTABILITY & CONCURRENCY ATOMICITY
  // =========================================================================
  it('Rule 3 & 4: posted sales invoice cannot be altered via PUT /sales-invoices/:id and blocks stale version', async () => {
    const dbA = await CompanyManager.getCompanyDb(CORP_A);
    let siId = '';
    await dbContext.run(dbA, async () => {
      siId = await createSalesInvoice(
        CORP_A,
        {
          invoiceNumber: 'SI-RC-IMMUT-001',
          customerId: CUST_A_ID,
          invoiceDate: '2026-01-15',
          dueDate: '2026-02-15',
          totalAmount: 1120000, // PHP 11,200.00
          lines: [{ description: 'Consulting', quantity: 1, unitPrice: 1120000, amount: 1120000, accountId: ACC_REV_A }],
        },
        MAKER_A_ID,
        'Bookkeeper'
      );
      await submitSalesInvoice(CORP_A, siId, MAKER_A_ID);
      await approveSalesInvoice(CORP_A, siId, OWNER_A_ID);
      await postSalesInvoice(CORP_A, siId, PERIOD_A_ID, [], OWNER_A_ID, 'Company Owner');
    });

    // Attempt direct financial tampering via PUT after posting
    const tamperRes = await request(app)
      .put(`/api/accounting/sales-invoices/${siId}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('x-company-id', CORP_A)
      .send({ totalAmount: 100, dueDate: '2026-12-31' });

    expect(tamperRes.status).toBeGreaterThanOrEqual(400);

    // Confirm DB totalAmount & balanceDue remained 1120000
    await dbContext.run(dbA, async () => {
      const si = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, siId)).get();
      expect(si?.totalAmount).toBe(1120000);
      expect(si?.balanceDue).toBe(1120000);
    });
  });

  it('Rule 4: concurrent inventory adjustments never produce negative stock or orphaned GL journal entries', async () => {
    const dbA = await CompanyManager.getCompanyDb(CORP_A);
    let jeCountBefore = 0;
    await dbContext.run(dbA, async () => {
      const jes = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.companyId, CORP_A));
      jeCountBefore = jes.length;
    });

    // Fire two concurrent STOCK_OUT adjustments of -2 units with expectedVersion=1
    // Both pass initial read at v1; the second MUST fail 409 without committing an orphaned GL JE!
    const [r1, r2] = await Promise.all([
      request(app)
        .post('/api/operations/inventory/adjustments')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .set('x-company-id', CORP_A)
        .send({ itemId: ITEM_A_ID, adjustmentType: 'STOCK_OUT', quantityChange: -2, expectedVersion: 1, reason: 'Concurrent Sale 1', adjustmentDate: '2026-01-20' }),
      request(app)
        .post('/api/operations/inventory/adjustments')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .set('x-company-id', CORP_A)
        .send({ itemId: ITEM_A_ID, adjustmentType: 'STOCK_OUT', quantityChange: -2, expectedVersion: 1, reason: 'Concurrent Sale 2', adjustmentDate: '2026-01-20' }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);

    await dbContext.run(dbA, async () => {
      const item = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, ITEM_A_ID)).get();
      expect(item?.quantityOnHand).toBe(8); // Only one adjustment succeeded

      const jesAfter = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.companyId, CORP_A));
      expect(jesAfter.length - jeCountBefore).toBe(1); // Zero orphaned JE from losing concurrent call!
    });
  });

  it('Rule 4: concurrent bank reconciliation approval and concurrent check clearing serialize cleanly with zero orphaned JEs', async () => {
    const dbA = await CompanyManager.getCompanyDb(CORP_A);
    await dbContext.run(dbA, async () => {
      // 1. Issue a check and clear concurrently
      const chkId = await issueCheck(
        CORP_A,
        {
          checkNumber: 'CHK-RC-001',
          checkDate: '2026-01-18',
          payeeName: 'RC Vendor',
          cashAccountId: ACC_CASH_A,
          amount: 100000,
        },
        MAKER_A_ID
      );

      const [c1, c2] = await Promise.allSettled([
        clearCheck(CORP_A, chkId, '2026-01-22', OWNER_A_ID),
        clearCheck(CORP_A, chkId, '2026-01-22', OWNER_A_ID),
      ]);
      const fulfilledChecks = [c1, c2].filter((x) => x.status === 'fulfilled');
      expect(fulfilledChecks).toHaveLength(1);

      // 2. Concurrent approveBankReconciliation with adjustment
      const reconId = await createBankReconciliation(
        CORP_A,
        { bankAccountId: ACC_CASH_A, statementDate: '2026-01-31', statementEndingBalance: 0 },
        MAKER_A_ID
      );
      await addReconciliationAdjustment(
        CORP_A,
        reconId,
        { type: 'BANK_CHARGE', description: 'Monthly Fee', amount: 2500, offsetAccountId: ACC_EXP_A },
        MAKER_A_ID
      );
      // Adjust statement ending balance so unexplained difference is 0 (simulate current book balance - 2500)
      const beforeSummary = await (await import('../../src/server/db/business_transactions')).getBankReconciliationSummary(CORP_A, reconId);
      await db.update(schema.bankReconciliations)
        .set({ statementEndingBalance: beforeSummary.reconciliation.adjustedBookBalance })
        .where(eq(schema.bankReconciliations.id, reconId));
      await submitBankReconciliation(CORP_A, reconId, MAKER_A_ID);

      const jeCountBefore = (await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.companyId, CORP_A))).length;
      const [a1, a2] = await Promise.allSettled([
        approveBankReconciliation(CORP_A, reconId, PERIOD_A_ID, OWNER_A_ID),
        approveBankReconciliation(CORP_A, reconId, PERIOD_A_ID, OWNER_A_ID),
      ]);
      const fulfilledApprovals = [a1, a2].filter((x) => x.status === 'fulfilled');
      expect(fulfilledApprovals).toHaveLength(1);

      const jeCountAfter = (await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.companyId, CORP_A))).length;
      expect(jeCountAfter - jeCountBefore).toBe(1);
    });
  });

  // =========================================================================
  // GATE 3 (RULE 5): AUTH, RBAC, TENANT ISOLATION, SOD & TAMPER VERIFICATION
  // =========================================================================
  it('Rule 5: restore endpoints require authentication & reject path traversal', async () => {
    const unauthValidate = await request(app).post('/api/restore/validate').send({ backupData: '{}' });
    expect(unauthValidate.status).toBe(401);

    const unauthNew = await request(app).post('/api/restore').send({ mode: 'NEW', backupData: '{}', targetCompanyId: 'X', destinationPath: '/tmp/pwn' });
    expect(unauthNew.status).toBe(401);

    // Even authenticated Owner must be blocked from arbitrary path traversal destinationPath
    const travRes = await request(app)
      .post('/api/restore')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('x-company-id', CORP_A)
      .send({ mode: 'NEW', backupData: JSON.stringify({ metadata: { companyId: CORP_A, version: '1.0' }, data: {} }), targetCompanyId: 'LGR-PH-TRAV', destinationPath: '../../etc/evil' });
    expect(travRes.status).toBeGreaterThanOrEqual(400);
  });

  it('Rule 5: licensingAndLan audit & approval endpoints enforce RBAC, SoD, and strict tenant isolation', async () => {
    // 1. Maker creates an approval request in Corp A
    const createReqRes = await request(app)
      .post('/api/approval/requests')
      .set('Authorization', `Bearer ${makerAToken}`)
      .set('x-company-id', CORP_A)
      .send({ actionType: 'HIGH_VALUE_PAYMENT', amountPHP: 500000, details: 'SoD check test' });
    expect(createReqRes.status).toBe(200);
    const reqId = createReqRes.body.id;

    // 2. Self-approval by Maker MUST be blocked (SoD 403)
    const selfApproveRes = await request(app)
      .post(`/api/approval/requests/${reqId}/action`)
      .set('Authorization', `Bearer ${makerAToken}`)
      .set('x-company-id', CORP_A)
      .send({ status: 'APPROVED' });
    expect(selfApproveRes.status).toBe(403);

    // 3. Cross-tenant Owner B attempting to approve Corp A's request MUST be blocked (403/404)
    const crossApproveRes = await request(app)
      .post(`/api/approval/requests/${reqId}/action`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .set('x-company-id', CORP_B)
      .send({ status: 'APPROVED' });
    expect(crossApproveRes.status).toBeGreaterThanOrEqual(403);

    // 4. Create Audit Finding in Corp A -> Viewer cannot create; Owner B cannot see or mutate
    const viewerCreateFinding = await request(app)
      .post('/api/audit/findings')
      .set('Authorization', `Bearer ${viewerAToken}`)
      .set('x-company-id', CORP_A)
      .send({ title: 'Unauthorized finding' });
    expect(viewerCreateFinding.status).toBe(403);

    const ownerACreateFinding = await request(app)
      .post('/api/audit/findings')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('x-company-id', CORP_A)
      .send({ title: 'Corp A Confidential Finding' });
    expect(ownerACreateFinding.status).toBe(200);
    const findingAId = ownerACreateFinding.body.id;

    const ownerBFindings = await request(app)
      .get('/api/audit/findings')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .set('x-company-id', CORP_B);
    expect(ownerBFindings.status).toBe(200);
    expect((ownerBFindings.body || []).some((f: any) => f.id === findingAId)).toBe(false);
  });

  it('Rule 5: AuditService.verifyIntegrity & GET /api/audit/verify/:id detect direct SQLite row tampering', async () => {
    const dbA = await CompanyManager.getCompanyDb(CORP_A);
    const sqliteA = await CompanyManager.getCompanySqlite(CORP_A);
    const entityId = 'rc-audit-seal-' + crypto.randomUUID();
    let logId = '';

    await dbContext.run(dbA, async () => {
      await AuditService.log({
        companyId: CORP_A,
        userId: OWNER_A_ID,
        action: 'SEAL_TEST_EVENT',
        entityType: 'SALES_INVOICE',
        entityId,
        afterData: { totalAmount: 500000 },
      });
      const row = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, entityId)).get();
      expect(row).toBeTruthy();
      logId = row!.id;
    });

    const cleanVerifyRes = await request(app)
      .get(`/api/audit/verify/${logId}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('x-company-id', CORP_A);
    expect(cleanVerifyRes.status).toBe(200);
    expect(cleanVerifyRes.body.verified).toBe(true);

    // 1. SQLite trigger must block direct UPDATE audit_logs
    expect(() => {
      sqliteA.prepare(`UPDATE audit_logs SET after_data = ? WHERE id = ?`).run(JSON.stringify({ totalAmount: 1 }), logId);
    }).toThrow(/SECURITY_VIOLATION/i);

    // 2. Service & endpoint cryptographic verification must reject tampered payload/seal
    await dbContext.run(dbA, async () => {
      const storedRow = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, logId)).get();
      expect(storedRow).toBeTruthy();
      const tamperedCopy = { ...storedRow, afterData: JSON.stringify({ totalAmount: 1 }) };
      const tamperedCheck = AuditService.verifyIntegrity(tamperedCopy);
      expect(tamperedCheck.verified).toBe(false);
    });
  });

  // =========================================================================
  // GATE 4 (RULE 6): PH TAX ENGINE & PERIOD-SCOPED BIR FORM 2307
  // =========================================================================
  it('Rule 6: Form 2307 strictly excludes out-of-quarter bills and TaxEngine computes statutory PH rules accurately', async () => {
    const dbA = await CompanyManager.getCompanyDb(CORP_A);
    await dbContext.run(dbA, async () => {
      const q1BillId = await createPurchaseBill(
        CORP_A,
        {
          billNumber: 'PB-RC-Q1-01',
          vendorId: VEND_A_ID,
          billDate: '2026-02-10',
          dueDate: '2026-03-10',
          totalAmount: 100000, // PHP 1,000.00
          lines: [{ description: 'Q1 Services', quantity: 1, unitPrice: 100000, amount: 100000, accountId: ACC_EXP_A }],
        },
        MAKER_A_ID,
        'Bookkeeper'
      );
      await submitPurchaseBill(CORP_A, q1BillId, MAKER_A_ID);
      await approvePurchaseBill(CORP_A, q1BillId, OWNER_A_ID);
      await postPurchaseBill(CORP_A, q1BillId, PERIOD_A_ID, [], OWNER_A_ID, 'Company Owner');

      const q2BillId = await createPurchaseBill(
        CORP_A,
        {
          billNumber: 'PB-RC-Q2-01',
          vendorId: VEND_A_ID,
          billDate: '2026-06-15',
          dueDate: '2026-07-15',
          totalAmount: 900000, // PHP 9,000.00 — MUST NOT leak into Q1 2307!
          lines: [{ description: 'Q2 Services', quantity: 1, unitPrice: 900000, amount: 900000, accountId: ACC_EXP_A }],
        },
        MAKER_A_ID,
        'Bookkeeper'
      );
      await submitPurchaseBill(CORP_A, q2BillId, MAKER_A_ID);
      await approvePurchaseBill(CORP_A, q2BillId, OWNER_A_ID);
      await postPurchaseBill(CORP_A, q2BillId, 'rc-per-2026-q2', [], OWNER_A_ID, 'Company Owner');
    });

    const res2307 = await request(app)
      .get('/api/tax/2307/generate?year=2026&quarter=Q1')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('x-company-id', CORP_A);

    expect(res2307.status).toBe(200);
    const certs = Array.isArray(res2307.body) ? res2307.body : (res2307.body?.certificates || []);
    const vendorCert = certs.find((c: any) => c.payee?.vendorId === VEND_A_ID);
    expect(vendorCert).toBeTruthy();
    // Q1 M1 (Jan) should be PHP 0, M2 (Feb) = PHP 1,000, Total = PHP 1,000 (NOT PHP 10,000!)
    expect(vendorCert.apRecordsCount.billsCount).toBe(1);
    expect(vendorCert.schedule[0].month1GrossPhp).toBe(0);
    expect(vendorCert.schedule[0].month2GrossPhp).toBe(1000);
    expect(vendorCert.schedule[0].totalGrossPhp).toBe(1000);

    // TaxEngine core statutory checks
    const vat = TaxEngine.calculateVat(112000);
    expect(vat.taxBase).toBe(100000);
    expect(vat.vatAmount).toBe(12000);

    expect(TaxEngine.getSection116Rate('2022-05-01')).toBe(0.01);
    expect(TaxEngine.getSection116Rate('2026-01-15')).toBe(0.03);

    const pure8Pct = TaxEngine.calculate8PercentIncomeTax(100_000_000, { isMixedIncomeEarner: false, taxpayerClassification: 'INDIVIDUAL' });
    expect(pure8Pct.isEligible).toBe(true);
    expect(pure8Pct.taxDueCentavos).toBe(6_000_000); // (1M - 250k) * 8% = 60,000 PHP

    const mixed8Pct = TaxEngine.calculate8PercentIncomeTax(100_000_000, { isMixedIncomeEarner: true, taxpayerClassification: 'INDIVIDUAL' });
    expect(mixed8Pct.taxDueCentavos).toBe(8_000_000); // 1M * 8% = 80,000 PHP

    const over3m = TaxEngine.calculate8PercentIncomeTax(300_000_100, { taxpayerClassification: 'INDIVIDUAL' });
    expect(over3m.isEligible).toBe(false);

    // 2026 Statutory Contributions check (PHP 25,000/mo semi-monthly = PHP 12,500)
    const contrib = TaxEngine.calculate2026StatutoryContributions(1_250_000, { frequency: 'SEMI_MONTHLY' });
    expect(contrib.sssEmployeeCentavos).toBeGreaterThan(0);
    expect(contrib.philhealthEmployeeCentavos).toBe(Math.round(1_250_000 * 0.025)); // 2.5% EE
    expect(contrib.pagibigEmployeeCentavos).toBe(10000); // PHP 100 per semi-monthly period (max P200/mo cap)

    // StatutoryRuleEngine versioning verification
    await dbContext.run(dbA, async () => {
      await StatutoryRuleEngine.ensureDefaultStatutoryRules(CORP_A, db);
      const rules = await db.select().from(schema.statutoryRules).where(eq(schema.statutoryRules.companyId, CORP_A));
      expect(rules.length).toBeGreaterThanOrEqual(4);
      expect(rules.every((r) => Boolean(r.regulatorySourceRef && r.effectiveStartDate && r.versionNumber >= 1))).toBe(true);
    });
  });

  // =========================================================================
  // GATE 5 (RULE 7): .LAI BACKUP/RESTORE SUBLEDGER COMPLETENESS & CORRUPTION
  // =========================================================================
  it('Rule 7: .lai backup/restore roundtrip preserves modern subledgers and detects tampered ciphertext', async () => {
    const RESTORE_TARGET = `LGR-PH-2026-TEST-RC-${RUN_TAG}-RESTORE`;
    await CompanyManager.resetDisposableTestCompanyWorkspace(RESTORE_TARGET);

    try {
      const payload = await RestoreService.exportBackup(CORP_A);
      const serialized = RestoreService.serializeLgb(payload);
      const deserialized = RestoreService.deserializeLgb(serialized);

      expect(RestoreService.verifyChecksum(deserialized)).toBe(true);
      await RestoreService.restoreDatabase(deserialized, RESTORE_TARGET, 'NEW', OWNER_A_ID);

      const restoredDb = await CompanyManager.getCompanyDb(RESTORE_TARGET);
      await dbContext.run(restoredDb, async () => {
        const restoredChecks = await db.select().from(schema.checks);
        const restoredItems = await db.select().from(schema.inventoryItems);
        const restoredRecons = await db.select().from(schema.bankReconciliations);
        expect(restoredChecks.length).toBeGreaterThanOrEqual(1);
        expect(restoredItems.length).toBeGreaterThanOrEqual(1);
        expect(restoredRecons.length).toBeGreaterThanOrEqual(1);
      });

      // Encryption tamper rejection
      const tmpPlain = path.join(os.tmpdir(), `rc-plain-${Date.now()}.sqlite`);
      const tmpEnc = path.join(os.tmpdir(), `rc-enc-${Date.now()}.lai`);
      const tmpOut = path.join(os.tmpdir(), `rc-out-${Date.now()}.sqlite`);
      fs.writeFileSync(tmpPlain, 'SQLite format 3\0test-payload');
      DatabaseEncryptionService.encryptDatabaseFileSync(tmpPlain, tmpEnc, { companyId: CORP_A, keyMode: 'OS_KEYCHAIN_STANDALONE' });

      // Corrupt last byte (GCM auth tag)
      const buf = fs.readFileSync(tmpEnc);
      buf[buf.length - 1] ^= 0xff;
      fs.writeFileSync(tmpEnc, buf);

      expect(() => DatabaseEncryptionService.decryptDatabaseFileSync(tmpEnc, tmpOut)).toThrow();
      try { fs.unlinkSync(tmpPlain); } catch {}
      try { fs.unlinkSync(tmpEnc); } catch {}
      try { fs.unlinkSync(tmpOut); } catch {}
    } finally {
      await CompanyManager.resetDisposableTestCompanyWorkspace(RESTORE_TARGET);
    }
  });

  // =========================================================================
  // GATE 6 (RULE 8): NO FAKE AI METRICS ON ZERO-DATA COMPANY & HYBRID SYNC
  // =========================================================================
  it('Rule 8: /api/gemini/financial-insight reports real PHP 0.00 on zero-data company and HybridSyncService deduplicates & catches conflicts', async () => {
    const insightRes = await request(app)
      .post('/api/gemini/financial-insight')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .set('x-company-id', CORP_B)
      .send({ prompt: 'Show overdue receivables and revenue overview' });

    expect(insightRes.status).toBe(200);
    const answer = String(insightRes.body?.answer || '');
    expect(answer).not.toContain('850,000');
    expect(answer).not.toContain('320,000');
    expect(answer).not.toContain('San Miguel Corp');
    expect(answer).not.toContain('Ayala Land');

    // Hybrid LAN Sync idempotency + conflict detection
    const idemKey = 'rc-idem-' + crypto.randomUUID();
    const q1 = await HybridSyncService.enqueueOfflineOperation(CORP_A, {
      workstationId: 'WS-RC-01',
      idempotencyKey: idemKey,
      sequenceNumber: 1,
      operationType: 'UPDATE_INVENTORY_STOCK',
      entityType: 'inventory_items',
      entityId: ITEM_A_ID,
      expectedVersion: 9999, // Stale version -> must conflict cleanly
      payload: { quantityDelta: -1 },
      userId: OWNER_A_ID,
    });
    expect(q1.deduplicated).toBe(false);

    const q2 = await HybridSyncService.enqueueOfflineOperation(CORP_A, {
      workstationId: 'WS-RC-01',
      idempotencyKey: idemKey,
      sequenceNumber: 1,
      operationType: 'UPDATE_INVENTORY_STOCK',
      entityType: 'inventory_items',
      entityId: ITEM_A_ID,
      expectedVersion: 9999,
      payload: { quantityDelta: -1 },
      userId: OWNER_A_ID,
    });
    expect(q2.deduplicated).toBe(true);

    const batch = await HybridSyncService.processWorkstationSyncBatch(CORP_A, [
      {
        workstationId: 'WS-RC-01',
        idempotencyKey: 'rc-stale-' + crypto.randomUUID(),
        sequenceNumber: 2,
        operationType: 'UPDATE_INVENTORY_STOCK',
        entityType: 'inventory_items',
        entityId: ITEM_A_ID,
        expectedVersion: 9999,
        payload: { quantityDelta: -1 },
        userId: OWNER_A_ID,
      },
    ], { userId: OWNER_A_ID });
    expect(batch.conflictCount).toBe(1);
    expect(batch.outcomes[0].httpStatus).toBe(409);
  });
});
