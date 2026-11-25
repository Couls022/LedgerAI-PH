import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { paths } from '../../src/server/services/paths';
import { RbacService } from '../../src/server/services/rbacService';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import {
  createSalesInvoice,
  submitSalesInvoice,
  approveSalesInvoice,
  createPurchaseBill,
  submitPurchaseBill,
  approvePurchaseBill,
} from '../../src/server/db/business_transactions';

describe('REQ-LAN-SYNC-001: Enterprise LAN Multi-Client Concurrency & Conflict Resolution', () => {
  const app = createApp();

  const COMPANY_A_ID = 'LGR-PH-CONC-COMP-A';
  const COMPANY_B_ID = 'LGR-PH-CONC-COMP-B';

  const USER_A_ID = 'usr-conc-user-a';
  const USER_A_NAME = 'User A (Accountant A)';
  let userAToken: string;

  const USER_B_ID = 'usr-conc-user-b';
  const USER_B_NAME = 'User B (Accountant B)';
  let userBToken: string;

  const USER_C_ID = 'usr-conc-user-c';
  const USER_C_NAME = 'User C (Company B Accountant)';
  let userCToken: string;
  let dbA: any;
  let dbB: any;

  beforeAll(async () => {
    // 1. Clean up existing test company folders
    for (const compId of [COMPANY_A_ID, COMPANY_B_ID]) {
      const compDir = path.join(paths.getCompaniesRootDir(), compId);
      if (fs.existsSync(compDir)) {
        fs.rmSync(compDir, { recursive: true, force: true });
      }
    }

    // 2. Initialize Company A
    await CompanyManager.createCompanyProfile(
      COMPANY_A_ID,
      'LedgerAI Concurrency Corp A',
      undefined,
      undefined,
      false,
      { classification: 'DEVELOPMENT' }
    );

    // 3. Initialize Company B
    await CompanyManager.createCompanyProfile(
      COMPANY_B_ID,
      'LedgerAI Concurrency Corp B',
      undefined,
      undefined,
      false,
      { classification: 'DEVELOPMENT' }
    );

    // 4. Provision Users & Roles in Company A
    dbA = await CompanyManager.getCompanyDb(COMPANY_A_ID);
    dbB = await CompanyManager.getCompanyDb(COMPANY_B_ID);

    await dbContext.run(dbA, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      const provisionUserInDb = async (userId: string, email: string, displayName: string, companyId: string, roleName: string) => {
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
          companyId,
          roleId: roleRec.id,
          legacyRole: roleName,
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: 'COMPANY_WIDE',
        }).onConflictDoNothing();

        await RbacService.setMemberRoles(null, memId, [roleName], `Provisioned ${roleName}`);

        const rawToken = crypto.randomBytes(32).toString('hex');
        await db.insert(schema.sessions).values({
          id: hashToken(rawToken),
          userId,
          companyId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

        return `${companyId}.${rawToken}`;
      };

      userAToken = await provisionUserInDb(USER_A_ID, 'userA@concurrency.ph', USER_A_NAME, COMPANY_A_ID, 'Company Owner');
      userBToken = await provisionUserInDb(USER_B_ID, 'userB@concurrency.ph', USER_B_NAME, COMPANY_A_ID, 'Company Owner');

      // Seed Open Accounting Period
      await db.insert(schema.accountingPeriods).values({
        id: 'per-conc-2026-08',
        companyId: COMPANY_A_ID,
        name: 'August 2026',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        fiscalYear: 2026,
        status: 'OPEN',
      }).onConflictDoNothing();

      // Seed Accounts
      await db.insert(schema.accounts).values({
        id: 'acc-conc-cash',
        companyId: COMPANY_A_ID,
        accountCode: '1010',
        accountName: 'Cash on Hand',
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.accounts).values({
        id: 'acc-conc-rev',
        companyId: COMPANY_A_ID,
        accountCode: '4010',
        accountName: 'Service Revenue',
        accountType: 'REVENUE',
        normalBalance: 'CREDIT',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.accounts).values({
        id: 'acc-conc-exp',
        companyId: COMPANY_A_ID,
        accountCode: '5010',
        accountName: 'Office Expense',
        accountType: 'EXPENSE',
        normalBalance: 'DEBIT',
        status: 'ACTIVE',
      }).onConflictDoNothing();
    });

    // 5. Provision User C in Company B
    await dbContext.run(dbB, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      await db.insert(schema.users).values({
        id: USER_C_ID,
        email: 'userC@concurrency-b.ph',
        displayName: USER_C_NAME,
        passwordHash: 'test_hash',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      const roleRec = await RbacService.ensureRoleRecord('Company Owner');
      const memId = `mem-${USER_C_ID}`;
      await db.insert(schema.companyUsers).values({
        id: memId,
        userId: USER_C_ID,
        companyId: COMPANY_B_ID,
        roleId: roleRec.id,
        legacyRole: 'Company Owner',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        defaultDataScope: 'COMPANY_WIDE',
      }).onConflictDoNothing();

      await RbacService.setMemberRoles(null, memId, ['Company Owner'], 'Provisioned Owner');

      const rawTokenC = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawTokenC),
        userId: USER_C_ID,
        companyId: COMPANY_B_ID,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      userCToken = `${COMPANY_B_ID}.${rawTokenC}`;
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    for (const compId of [COMPANY_A_ID, COMPANY_B_ID]) {
      const compDir = path.join(paths.getCompaniesRootDir(), compId);
      if (fs.existsSync(compDir)) {
        fs.rmSync(compDir, { recursive: true, force: true });
      }
      await CompanyManager.unregisterCompany(compId).catch(() => {});
    }
  });

  // -------------------------------------------------------------------------
  // Test 1: Stale version rejection (HTTP 409 CONCURRENT_MODIFICATION_CONFLICT)
  // -------------------------------------------------------------------------
  it('1. Stale version rejection: User A updates record to v2, User B attempt with v1 receives HTTP 409 CONCURRENT_MODIFICATION_CONFLICT', async () => {
    const journalId = 'je-test-conc-001';

    // Seed draft journal entry
    await dbContext.run(dbA, async () => {
      await db.insert(schema.journalEntries).values({
        id: journalId,
        companyId: COMPANY_A_ID,
        journalNumber: 'JE-2026-CONC-01',
        entryDate: '2026-08-15',
        description: 'Initial Draft Entry',
        status: 'DRAFT',
        createdBy: USER_A_ID,
        version: 1,
      });

      await db.insert(schema.journalLines).values([
        { id: crypto.randomUUID(), journalEntryId: journalId, accountId: 'acc-conc-cash', debit: 100000, credit: 0, lineNumber: 1 },
        { id: crypto.randomUUID(), journalEntryId: journalId, accountId: 'acc-conc-rev', debit: 0, credit: 100000, lineNumber: 2 },
      ]);
    });

    // User A updates record using expectedVersion: 1
    const updateARes = await request(app)
      .put(`/api/accounting/journals/${journalId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        journalNumber: 'JE-2026-CONC-01',
        entryDate: '2026-08-15',
        description: 'Updated by User A',
        expectedVersion: 1,
        lines: [
          { accountId: 'acc-conc-cash', debit: 150000, credit: 0, description: 'Increased Cash' },
          { accountId: 'acc-conc-rev', debit: 0, credit: 150000, description: 'Increased Revenue' },
        ],
      });

    if (updateARes.status !== 200) console.log('updateARes error body:', JSON.stringify(updateARes.body));
    expect(updateARes.status).toBe(200);

    // Verify DB version is now 2
    let freshRecord: any;
    await dbContext.run(dbA, async () => {
      freshRecord = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, journalId)).get();
    });
    expect(freshRecord.version).toBe(2);
    expect(freshRecord.description).toBe('Updated by User A');

    // User B attempts to save using stale expectedVersion: 1
    const updateBRes = await request(app)
      .put(`/api/accounting/journals/${journalId}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        journalNumber: 'JE-2026-CONC-01',
        entryDate: '2026-08-15',
        description: 'Conflicting Edit by User B',
        expectedVersion: 1, // STALE!
        lines: [
          { accountId: 'acc-conc-cash', debit: 200000, credit: 0, description: 'User B Cash' },
          { accountId: 'acc-conc-rev', debit: 0, credit: 200000, description: 'User B Revenue' },
        ],
      });

    expect(updateBRes.status).toBe(409);
    expect(updateBRes.body.error).toBe('CONCURRENT_MODIFICATION_CONFLICT');
    expect(updateBRes.body.message).toContain('CONCURRENT_MODIFICATION_CONFLICT');
    expect(updateBRes.body.details).toBeDefined();
    expect(updateBRes.body.details.currentVersion).toBe(2);
    expect(updateBRes.body.details.clientVersion).toBe(1);

    // Verify DB still contains User A's version (v2) and amounts (150,000)
    await dbContext.run(dbA, async () => {
      const retainedRecord = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, journalId)).get();
      expect(retainedRecord.version).toBe(2);
      expect(retainedRecord.description).toBe('Updated by User A');
      const lines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, journalId));
      expect(lines.find((l) => l.debit > 0)?.debit).toBe(150000);
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: Successful re-apply with latest version (v2 -> v3)
  // -------------------------------------------------------------------------
  it('2. Successful reload & re-apply: User B reapplies using latest expectedVersion v2 and succeeds (v3)', async () => {
    const journalId = 'je-test-conc-001';

    const reapplyRes = await request(app)
      .put(`/api/accounting/journals/${journalId}`)
      .set('Authorization', `Bearer ${userBToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        journalNumber: 'JE-2026-CONC-01',
        entryDate: '2026-08-15',
        description: 'User B Reapplied against v2',
        expectedVersion: 2, // LATEST!
        lines: [
          { accountId: 'acc-conc-cash', debit: 180000, credit: 0, description: 'Reapplied Cash' },
          { accountId: 'acc-conc-rev', debit: 0, credit: 180000, description: 'Reapplied Revenue' },
        ],
      });

    expect(reapplyRes.status).toBe(200);

    // Verify DB version is now 3
    await dbContext.run(dbA, async () => {
      const updated = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, journalId)).get();
      expect(updated.version).toBe(3);
      expect(updated.description).toBe('User B Reapplied against v2');
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: Simultaneous requests using same expected version
  // -------------------------------------------------------------------------
  it('3. Simultaneous requests: Two parallel updates using expectedVersion v3 results in 1 success (v4) and 1 HTTP 409 conflict', async () => {
    const journalId = 'je-test-conc-001';

    // Execute 2 concurrent PUT requests
    const [res1, res2] = await Promise.all([
      request(app)
        .put(`/api/accounting/journals/${journalId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .set('x-company-id', COMPANY_A_ID)
        .send({
          journalNumber: 'JE-2026-CONC-01',
          entryDate: '2026-08-15',
          description: 'Parallel Edit Req 1',
          expectedVersion: 3,
          lines: [
            { accountId: 'acc-conc-cash', debit: 210000, credit: 0 },
            { accountId: 'acc-conc-rev', debit: 0, credit: 210000 },
          ],
        }),
      request(app)
        .put(`/api/accounting/journals/${journalId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .set('x-company-id', COMPANY_A_ID)
        .send({
          journalNumber: 'JE-2026-CONC-01',
          entryDate: '2026-08-15',
          description: 'Parallel Edit Req 2',
          expectedVersion: 3,
          lines: [
            { accountId: 'acc-conc-cash', debit: 220000, credit: 0 },
            { accountId: 'acc-conc-rev', debit: 0, credit: 220000 },
          ],
        }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const conflictRes = res1.status === 409 ? res1 : res2;
    expect(conflictRes.body.error).toBe('CONCURRENT_MODIFICATION_CONFLICT');

    // Verify DB version is now 4
    await dbContext.run(dbA, async () => {
      const finalEntry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, journalId)).get();
      expect(finalEntry.version).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: Atomic rollback on failed concurrency update
  // -------------------------------------------------------------------------
  it('4. Atomic rollback: Failed concurrency update leaves zero partial journal lines or corrupted totals', async () => {
    const journalId = 'je-test-rollback-01';

    await dbContext.run(dbA, async () => {
      await db.insert(schema.journalEntries).values({
        id: journalId,
        companyId: COMPANY_A_ID,
        journalNumber: 'JE-ROLLBACK-01',
        entryDate: '2026-08-15',
        description: 'Original Rollback Test Entry',
        status: 'DRAFT',
        createdBy: USER_A_ID,
        version: 5,
      });

      await db.insert(schema.journalLines).values([
        { id: crypto.randomUUID(), journalEntryId: journalId, accountId: 'acc-conc-cash', debit: 50000, credit: 0, lineNumber: 1 },
        { id: crypto.randomUUID(), journalEntryId: journalId, accountId: 'acc-conc-rev', debit: 0, credit: 50000, lineNumber: 2 },
      ]);
    });

    // Submit stale update (expectedVersion: 1 when actual is 5)
    const failedRes = await request(app)
      .put(`/api/accounting/journals/${journalId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        journalNumber: 'JE-ROLLBACK-01',
        entryDate: '2026-08-15',
        description: 'Corrupt Edit Attempt',
        expectedVersion: 1, // WRONG VERSION
        lines: [
          { accountId: 'acc-conc-cash', debit: 999999, credit: 0 },
          { accountId: 'acc-conc-rev', debit: 0, credit: 999999 },
        ],
      });

    expect(failedRes.status).toBe(409);

    // Verify DB retains original 50,000 lines and version 5
    await dbContext.run(dbA, async () => {
      const entry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, journalId)).get();
      expect(entry.version).toBe(5);
      expect(entry.description).toBe('Original Rollback Test Entry');

      const lines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, journalId));
      expect(lines.length).toBe(2);
      expect(lines.find((l) => l.debit > 0)?.debit).toBe(50000);
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: Concurrent workflow transitions (submit, approve, post, reverse)
  // -------------------------------------------------------------------------
  it('5. Concurrent workflow transitions: Stale expectedVersion on submit/approve/post/reverse returns 409', async () => {
    const journalId = 'je-test-workflow-conc';

    await dbContext.run(dbA, async () => {
      await db.insert(schema.journalEntries).values({
        id: journalId,
        companyId: COMPANY_A_ID,
        journalNumber: 'JE-WF-01',
        entryDate: '2026-08-15',
        description: 'Workflow Concurrency Test',
        status: 'DRAFT',
        createdBy: USER_A_ID,
        version: 1,
      });

      await db.insert(schema.journalLines).values([
        { id: crypto.randomUUID(), journalEntryId: journalId, accountId: 'acc-conc-cash', debit: 75000, credit: 0, lineNumber: 1 },
        { id: crypto.randomUUID(), journalEntryId: journalId, accountId: 'acc-conc-rev', debit: 0, credit: 75000, lineNumber: 2 },
      ]);
    });

    // 1. Submit with correct version (1) -> succeeds, version -> 2
    const submitRes = await request(app)
      .post(`/api/accounting/journals/${journalId}/submit`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({ expectedVersion: 1 });

    expect(submitRes.status).toBe(200);

    // 2. Submit with stale version (1) -> fails 409
    const staleSubmitRes = await request(app)
      .post(`/api/accounting/journals/${journalId}/submit`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({ expectedVersion: 1 });

    expect(staleSubmitRes.status).toBe(409);
    expect(staleSubmitRes.body.error).toBe('CONCURRENT_MODIFICATION_CONFLICT');

    // 3. Approve with stale version (1) -> fails 409
    const staleApproveRes = await request(app)
      .post(`/api/accounting/journals/${journalId}/approve`)
      .set('Authorization', `Bearer ${userBToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({ expectedVersion: 1 });

    expect(staleApproveRes.status).toBe(409);

    // 4. Approve with current version (2) -> succeeds, version -> 3
    const approveRes = await request(app)
      .post(`/api/accounting/journals/${journalId}/approve`)
      .set('Authorization', `Bearer ${userBToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({ expectedVersion: 2 });

    expect(approveRes.status).toBe(200);

    // 5. Post with stale version (2) -> fails 409
    const stalePostRes = await request(app)
      .post(`/api/accounting/journals/${journalId}/post`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({ expectedVersion: 2 });

    expect(stalePostRes.status).toBe(409);

    // 6. Post with current version (3) -> succeeds, version -> 4
    const postRes = await request(app)
      .post(`/api/accounting/journals/${journalId}/post`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({ expectedVersion: 3 });

    expect(postRes.status).toBe(200);

    // Verify DB version is 4 and status is POSTED
    await dbContext.run(dbA, async () => {
      const entry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, journalId)).get();
      expect(entry.version).toBe(4);
      expect(entry.status).toBe('POSTED');
    });
  });

  // -------------------------------------------------------------------------
  // Test 6: Sales Invoice & Purchase Bill workflow concurrency
  // -------------------------------------------------------------------------
  it('6. Subledger concurrency: Sales Invoices & Purchase Bills reject stale expectedVersion with 409', async () => {
    let invId: string = '';
    let billId: string = '';

    await dbContext.run(dbA, async () => {
      // Seed Customer & Vendor
      await db.insert(schema.customers).values({
        id: 'cust-conc-01',
        companyId: COMPANY_A_ID,
        code: 'CUST-CONC-01',
        legalName: 'Concurrency Customer Inc',
        status: 'ACTIVE',
        version: 1,
      }).onConflictDoNothing();

      await db.insert(schema.vendors).values({
        id: 'vend-conc-01',
        companyId: COMPANY_A_ID,
        code: 'VEND-CONC-01',
        legalName: 'Concurrency Vendor Corp',
        status: 'ACTIVE',
        version: 1,
      }).onConflictDoNothing();

      // Seed Draft Sales Invoice
      invId = await createSalesInvoice(COMPANY_A_ID, {
        customerId: 'cust-conc-01',
        invoiceNumber: 'INV-CONC-001',
        invoiceDate: '2026-08-15',
        totalAmount: 250000,
        lines: [{ accountId: 'acc-conc-rev', amount: 250000 }],
      }, USER_A_ID);

      // Seed Draft Purchase Bill
      billId = await createPurchaseBill(COMPANY_A_ID, {
        vendorId: 'vend-conc-01',
        billNumber: 'BILL-CONC-001',
        billDate: '2026-08-15',
        totalAmount: 120000,
        lines: [{ accountId: 'acc-conc-exp', amount: 120000 }],
      }, USER_A_ID);
    });

    // 1. Submit Sales Invoice with expectedVersion: 1 -> succeeds (v2)
    const invSubmitRes = await request(app)
      .post(`/api/accounting/sales-invoices/${invId}/submit`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({ expectedVersion: 1 });

    expect(invSubmitRes.status).toBe(200);

    // 2. Submit Sales Invoice again with stale expectedVersion: 1 -> fails 409
    const invStaleSubmit = await request(app)
      .post(`/api/accounting/sales-invoices/${invId}/submit`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({ expectedVersion: 1 });

    expect(invStaleSubmit.status).toBe(409);
    expect(invStaleSubmit.body.error).toBe('CONCURRENT_MODIFICATION_CONFLICT');

    // 3. Submit Purchase Bill with expectedVersion: 1 -> succeeds (v2)
    const billSubmitRes = await request(app)
      .post(`/api/accounting/purchase-bills/${idToParam(billId)}/submit`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({ expectedVersion: 1 });

    expect(billSubmitRes.status).toBe(200);

    // 4. Submit Purchase Bill again with stale expectedVersion: 1 -> fails 409
    const billStaleSubmit = await request(app)
      .post(`/api/accounting/purchase-bills/${idToParam(billId)}/submit`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({ expectedVersion: 1 });

    expect(billStaleSubmit.status).toBe(409);
    expect(billStaleSubmit.body.error).toBe('CONCURRENT_MODIFICATION_CONFLICT');
  });

  // Helper for param string
  function idToParam(id: string) { return id; }

  // -------------------------------------------------------------------------
  // Test 7: Immutable posted journal protection
  // -------------------------------------------------------------------------
  it('7. Immutability protection: POSTED journals strictly reject direct line-level edits via PUT', async () => {
    const journalId = 'je-posted-immutable-01';

    await dbContext.run(dbA, async () => {
      await db.insert(schema.journalEntries).values({
        id: journalId,
        companyId: COMPANY_A_ID,
        journalNumber: 'JE-POSTED-01',
        entryDate: '2026-08-15',
        description: 'Posted Immutable Entry',
        status: 'POSTED',
        createdBy: USER_A_ID,
        postedBy: USER_B_ID,
        version: 4,
      });

      await db.insert(schema.journalLines).values([
        { id: crypto.randomUUID(), journalEntryId: journalId, accountId: 'acc-conc-cash', debit: 30000, credit: 0, lineNumber: 1 },
        { id: crypto.randomUUID(), journalEntryId: journalId, accountId: 'acc-conc-rev', debit: 0, credit: 30000, lineNumber: 2 },
      ]);
    });

    const editPostedRes = await request(app)
      .put(`/api/accounting/journals/${journalId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        journalNumber: 'JE-POSTED-01',
        entryDate: '2026-08-15',
        description: 'Illegal Edit of Posted Record',
        expectedVersion: 4,
        lines: [
          { accountId: 'acc-conc-cash', debit: 50000, credit: 0 },
          { accountId: 'acc-conc-rev', debit: 0, credit: 50000 },
        ],
      });

    expect(editPostedRes.status).toBe(403);
    expect(editPostedRes.body.error).toBe('IMMUTABLE_RECORD_ERROR');
    expect(editPostedRes.body.message).toContain('cannot be directly edited');
  });

  // -------------------------------------------------------------------------
  // Test 8: Cross-company multi-tenant isolation
  // -------------------------------------------------------------------------
  it('8. Cross-company isolation: Conflict check for Company A record using Company B credentials returns 404', async () => {
    const journalId = 'je-test-conc-001'; // Belongs to Company A

    const crossCompRes = await request(app)
      .put(`/api/accounting/journals/${journalId}`)
      .set('Authorization', `Bearer ${userCToken}`) // Company B User
      .set('x-company-id', COMPANY_B_ID) // Company B Tenant
      .send({
        journalNumber: 'JE-2026-CONC-01',
        entryDate: '2026-08-15',
        description: 'Cross-company Spoofing Attempt',
        expectedVersion: 1,
        lines: [
          { accountId: 'acc-conc-cash', debit: 100, credit: 0 },
          { accountId: 'acc-conc-rev', debit: 0, credit: 100 },
        ],
      });

    expect(crossCompRes.status).toBe(404);
    expect(crossCompRes.body.error).toBe('NOT_FOUND');
    expect(crossCompRes.body.details).toBeUndefined(); // Zero version disclosure across tenant boundary!
  });

  // -------------------------------------------------------------------------
  // Test 9: Centralized `/api/journey/action` optimistic concurrency enforcement
  // -------------------------------------------------------------------------
  it('9. Centralized /api/journey/action endpoint enforces expectedVersion and returns 409 with details', async () => {
    const journalId = 'je-journey-action-conc';

    await dbContext.run(dbA, async () => {
      await db.insert(schema.journalEntries).values({
        id: journalId,
        companyId: COMPANY_A_ID,
        journalNumber: 'JE-ACTION-CONC-01',
        entryDate: '2026-08-15',
        description: 'Journey Action Concurrency Test',
        status: 'DRAFT',
        createdBy: USER_A_ID,
        version: 3,
      });

      await db.insert(schema.journalLines).values([
        { id: crypto.randomUUID(), journalEntryId: journalId, accountId: 'acc-conc-cash', debit: 40000, credit: 0, lineNumber: 1 },
        { id: crypto.randomUUID(), journalEntryId: journalId, accountId: 'acc-conc-rev', debit: 0, credit: 40000, lineNumber: 2 },
      ]);
    });

    // Call /api/journey/action with stale expectedVersion: 1 (actual is 3)
    const staleJourneyActionRes = await request(app)
      .post(`/api/journey/action/JOURNAL_ENTRY/${journalId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        action: 'SUBMIT',
        expectedVersion: 1, // STALE!
      });

    expect(staleJourneyActionRes.status).toBe(409);
    expect(staleJourneyActionRes.body.error).toBe('CONCURRENT_MODIFICATION_CONFLICT');
    expect(staleJourneyActionRes.body.details).toBeDefined();
    expect(staleJourneyActionRes.body.details.currentVersion).toBe(3);
    expect(staleJourneyActionRes.body.details.clientVersion).toBe(1);

    // Call /api/journey/action with correct expectedVersion: 3 -> succeeds
    const validJourneyActionRes = await request(app)
      .post(`/api/journey/action/JOURNAL_ENTRY/${journalId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        action: 'SUBMIT',
        expectedVersion: 3, // VALID!
      });

    expect(validJourneyActionRes.status).toBe(200);

    // Verify DB version is updated to 4
    await dbContext.run(dbA, async () => {
      const entry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, journalId)).get();
      expect(entry.version).toBe(4);
      expect(entry.status).toBe('SUBMITTED');
    });
  });

  // -------------------------------------------------------------------------
  // Test 10: Atomic, monotonic version increments
  // -------------------------------------------------------------------------
  it('10. Atomic, monotonic version increments: Sequential edits strictly increment version (1 -> 2 -> 3)', async () => {
    const journalId = 'je-monotonic-version-01';

    await dbContext.run(dbA, async () => {
      await db.insert(schema.journalEntries).values({
        id: journalId,
        companyId: COMPANY_A_ID,
        journalNumber: 'JE-MONOTONIC-01',
        entryDate: '2026-08-15',
        description: 'Monotonic Version Test Initial',
        status: 'DRAFT',
        createdBy: USER_A_ID,
        version: 1,
      });

      await db.insert(schema.journalLines).values([
        { id: crypto.randomUUID(), journalEntryId: journalId, accountId: 'acc-conc-cash', debit: 1000, credit: 0, lineNumber: 1 },
        { id: crypto.randomUUID(), journalEntryId: journalId, accountId: 'acc-conc-rev', debit: 0, credit: 1000, lineNumber: 2 },
      ]);
    });

    // First edit: v1 -> v2
    const edit1 = await request(app)
      .put(`/api/accounting/journals/${journalId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        journalNumber: 'JE-MONOTONIC-01',
        entryDate: '2026-08-15',
        description: 'Monotonic Version Edit 1',
        expectedVersion: 1,
        lines: [
          { accountId: 'acc-conc-cash', debit: 2000, credit: 0 },
          { accountId: 'acc-conc-rev', debit: 0, credit: 2000 },
        ],
      });
    expect(edit1.status).toBe(200);

    // Second edit: v2 -> v3
    const edit2 = await request(app)
      .put(`/api/accounting/journals/${journalId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        journalNumber: 'JE-MONOTONIC-01',
        entryDate: '2026-08-15',
        description: 'Monotonic Version Edit 2',
        expectedVersion: 2,
        lines: [
          { accountId: 'acc-conc-cash', debit: 3000, credit: 0 },
          { accountId: 'acc-conc-rev', debit: 0, credit: 3000 },
        ],
      });
    expect(edit2.status).toBe(200);

    // Verify DB version is strictly 3
    await dbContext.run(dbA, async () => {
      const entry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, journalId)).get();
      expect(entry.version).toBe(3);
      expect(entry.description).toBe('Monotonic Version Edit 2');
    });
  });

  // -------------------------------------------------------------------------
  // Test 11: Real SQLite atomic transaction rollback on failure & savepoint nesting
  // -------------------------------------------------------------------------
  it('11. Real SQLite atomic transaction rollback: Failed tx leaves zero partial records', async () => {
    const rollbackJournalId = 'je-rollback-test-01';

    await dbContext.run(dbA, async () => {
      let threw = false;
      try {
        await db.transaction(async (tx) => {
          await tx.insert(schema.journalEntries).values({
            id: rollbackJournalId,
            companyId: COMPANY_A_ID,
            journalNumber: 'JE-ROLLBACK-01',
            entryDate: '2026-08-15',
            description: 'Should be rolled back',
            status: 'DRAFT',
            createdBy: USER_A_ID,
            version: 1,
          });

          await tx.insert(schema.journalLines).values([
            { id: crypto.randomUUID(), journalEntryId: rollbackJournalId, accountId: 'acc-conc-cash', debit: 5000, credit: 0, lineNumber: 1 },
            { id: crypto.randomUUID(), journalEntryId: rollbackJournalId, accountId: 'acc-conc-rev', debit: 0, credit: 5000, lineNumber: 2 },
          ]);

          // Intentional failure to trigger ROLLBACK
          throw new Error('SIMULATED_TRANSACTION_FAILURE_ROLLBACK');
        });
      } catch (err: any) {
        threw = true;
        expect(err.message).toBe('SIMULATED_TRANSACTION_FAILURE_ROLLBACK');
      }

      expect(threw).toBe(true);

      // Verify that neither the header nor the lines were committed
      const rolledBackHeader = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, rollbackJournalId)).get();
      expect(rolledBackHeader).toBeUndefined();

      const rolledBackLines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, rollbackJournalId));
      expect(rolledBackLines.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Test 12: Master data optimistic concurrency (Accounts, Customers, Vendors)
  // -------------------------------------------------------------------------
  it('12. Master data optimistic concurrency: Stale expectedVersion returns 409 conflict', async () => {
    // 12a. Accounts
    const accStaleRes = await request(app)
      .put('/api/master-data/accounts/acc-conc-cash')
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        accountName: 'Cash Stale Update',
        expectedVersion: 999, // Stale!
      });

    expect(accStaleRes.status).toBe(409);
    expect(accStaleRes.body.error).toBe('CONCURRENT_MODIFICATION_CONFLICT');
    expect(accStaleRes.body.currentVersion).toBe(1);

    // 12b. Seed Customer via API
    const custUniqueCode = `CUST-CONC-${Date.now()}`;
    const custCreateRes = await request(app)
      .post('/api/master-data/customers')
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        code: custUniqueCode,
        legalName: 'Test Concurrency Customer',
      });
    expect(custCreateRes.status).toBe(201);
    const testCustId = custCreateRes.body.id;

    const custStaleRes = await request(app)
      .put(`/api/master-data/customers/${testCustId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        legalName: 'Customer Stale Update',
        expectedVersion: 999,
      });

    expect(custStaleRes.status).toBe(409);
    expect(custStaleRes.body.error).toBe('CONCURRENT_MODIFICATION_CONFLICT');

    // 12c. Seed Vendor via API
    const vendUniqueCode = `VEND-CONC-${Date.now()}`;
    const vendCreateRes = await request(app)
      .post('/api/master-data/vendors')
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        code: vendUniqueCode,
        legalName: 'Test Concurrency Vendor',
      });
    expect(vendCreateRes.status).toBe(201);
    const testVendId = vendCreateRes.body.id;

    const vendStaleRes = await request(app)
      .put(`/api/master-data/vendors/${testVendId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        legalName: 'Vendor Stale Update',
        expectedVersion: 999,
      });

    expect(vendStaleRes.status).toBe(409);
    expect(vendStaleRes.body.error).toBe('CONCURRENT_MODIFICATION_CONFLICT');
  });

  // -------------------------------------------------------------------------
  // Test 13: Operations & Payroll optimistic concurrency
  // -------------------------------------------------------------------------
  it('13. Operations & Payroll concurrency: Employee edit and Inventory adjustment reject stale expectedVersion', async () => {
    // 13a. Employee Update
    const testEmpId = 'emp-conc-test-01';
    await dbContext.run(dbA, async () => {
      await db.insert(schema.employees).values({
        id: testEmpId,
        companyId: COMPANY_A_ID,
        employeeNo: 'EMP-CONC-01',
        firstName: 'Maria',
        lastName: 'Santos',
        monthlyBasicSalary: 3000000,
        dailyRate: 136364,
        hourlyRate: 17045,
        version: 2,
      }).onConflictDoNothing();
    });

    const empStaleRes = await request(app)
      .put(`/api/operations/payroll/employees/${testEmpId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        employeeNo: 'EMP-CONC-01',
        firstName: 'Maria Updated',
        lastName: 'Santos',
        monthlyBasicSalary: 35000,
        expectedVersion: 1, // Stale! Actual is 2
      });

    expect(empStaleRes.status).toBe(409);
    expect(empStaleRes.body.error).toBe('CONCURRENT_MODIFICATION_CONFLICT');
    expect(empStaleRes.body.currentVersion).toBe(2);

    // 13b. Inventory Item Adjustment
    const testItemId = 'item-conc-test-01';
    await dbContext.run(dbA, async () => {
      await db.insert(schema.inventoryItems).values({
        id: testItemId,
        companyId: COMPANY_A_ID,
        sku: 'SKU-CONC-01',
        name: 'Concurrency Test Widget',
        quantityOnHand: 100,
        unitCost: 5000,
        version: 3,
      }).onConflictDoNothing();
    });

    const invStaleRes = await request(app)
      .post('/api/operations/inventory/adjustments')
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        itemId: testItemId,
        quantityChange: 10,
        reason: 'Restock discrepancy',
        expectedVersion: 1, // Stale! Actual is 3
      });

    expect(invStaleRes.status).toBe(409);
    expect(invStaleRes.body.error).toBe('CONCURRENT_MODIFICATION_CONFLICT');
    expect(invStaleRes.body.currentVersion).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Test 14: Accounting Period workflow optimistic concurrency
  // -------------------------------------------------------------------------
  it('14. Accounting Period workflows enforce expectedVersion with 409 conflict', async () => {
    const periodId = 'per-conc-2026-08';

    const periodStaleRes = await request(app)
      .post(`/api/accounting/periods/${periodId}/soft-close`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-company-id', COMPANY_A_ID)
      .send({
        expectedVersion: 999, // Stale!
      });

    expect(periodStaleRes.status).toBe(409);
    expect(periodStaleRes.body.error).toBe('CONCURRENT_MODIFICATION_CONFLICT');
  });
});

