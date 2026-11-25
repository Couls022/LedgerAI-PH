import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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
  createSalesInvoice,
  submitSalesInvoice,
  approveSalesInvoice,
  postSalesInvoice,
  createCustomerPayment,
  postCustomerPayment,
  createPurchaseBill,
  submitPurchaseBill,
  approvePurchaseBill,
  postPurchaseBill,
  createSupplierPayment,
  postSupplierPayment,
} from '../../src/server/db/business_transactions';

describe('REQ-JOURNEY-360-001: Complete 360-Degree Record Journey & 14-Stage Accounting Lifecycle Certification', () => {
  const app = createApp();
  const COMPANY_A_ID = 'LGR-PH-J360-COMP-A';
  const COMPANY_B_ID = 'LGR-PH-J360-COMP-B';

  // Distinct actors in Company A
  const USER_A_ID = 'usr-j360-preparer-a';
  const USER_A_NAME = 'Maria Clara Santos (Preparer)';
  let userAToken: string;

  const USER_B_ID = 'usr-j360-approver-b';
  const USER_B_NAME = 'Crisostomo Ibarra (Approver)';
  let userBToken: string;

  const USER_C_ID = 'usr-j360-poster-c';
  const USER_C_NAME = 'Elias Salome (Finance Controller)';
  let userCToken: string;

  const USER_AUDITOR_ID = 'usr-j360-auditor';
  const USER_AUDITOR_NAME = 'Pilosopo Tasyo (External Auditor)';
  let auditorToken: string;

  const USER_BOOKKEEPER_ID = 'usr-j360-bookkeeper';
  const USER_BOOKKEEPER_NAME = 'Sisa Basilio (Bookkeeper)';
  let bookkeeperToken: string;

  const USER_OWN_SCOPE_ID = 'usr-j360-own-sales';
  const USER_OWN_SCOPE_NAME = 'Basilio Sisa (Scoped Sales)';
  let ownScopeSalesToken: string;

  const USER_DEPT_SCOPE_ID = 'usr-j360-dept-acct';
  const USER_DEPT_SCOPE_NAME = 'Isagani Florentino (Engineering Acct)';
  let deptScopeAcctToken: string;

  // Company B actor
  const USER_COMP_B_ID = 'usr-j360-comp-b-owner';
  let companyBToken: string;
  let companyBJournalId: string;

  // Shared master data IDs in Company A
  const PERIOD_ID = 'prd-2026-j360-a';
  const CASH_ACC_ID = 'acc-1010-j360';
  const AR_ACC_ID = 'acc-1110-j360';
  const AP_ACC_ID = 'acc-2010-j360';
  const REV_ACC_ID = 'acc-4010-j360';
  const EXP_ACC_ID = 'acc-6010-j360';
  const SAL_EXP_ACC_ID = 'acc-6110-j360';
  const SSS_PAY_ACC_ID = 'acc-2110-j360';
  const PHIC_PAY_ACC_ID = 'acc-2120-j360';
  const HDMF_PAY_ACC_ID = 'acc-2130-j360';
  const WTAX_PAY_ACC_ID = 'acc-2140-j360';
  const CUSTOMER_ID = 'cust-j360-01';
  const VENDOR_ID = 'vend-j360-01';
  const EMPLOYEE_ID = 'emp-j360-01';

  beforeAll(async () => {
    await CompanyManager.init();
    await CompanyManager.closeAllConnections();

    for (const stray of ['111-222-333-000', '444-555-666-000']) {
      const strayDir = path.resolve(process.cwd(), stray);
      if (fs.existsSync(strayDir)) {
        try { fs.rmSync(strayDir, { recursive: true, force: true }); } catch {}
      }
    }

    for (const cid of [COMPANY_A_ID, COMPANY_B_ID]) {
      const cdir = path.join(paths.getCompaniesRootDir(), cid);
      const laiFile = `${cdir}.lai`;
      if (fs.existsSync(cdir)) {
        try { fs.rmSync(cdir, { recursive: true, force: true }); } catch {}
      }
      if (fs.existsSync(laiFile)) {
        try { fs.rmSync(laiFile, { force: true }); } catch {}
      }
      try { await CompanyManager.deleteCompany(cid); } catch {}
    }

    await CompanyManager.createCompanyProfile(
      COMPANY_A_ID,
      'Journey 360 Alpha Enterprise Corp.',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );

    await CompanyManager.createCompanyProfile(
      COMPANY_B_ID,
      'Journey 360 Beta Isolated Corp.',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );

    // Provision Company A
    const dbA = await CompanyManager.getCompanyDb(COMPANY_A_ID);
    await dbContext.run(dbA, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      await db.insert(schema.accountingPeriods).values({
        id: PERIOD_ID,
        companyId: COMPANY_A_ID,
        name: 'FY 2026 Open Period',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        fiscalYear: 2026,
        status: 'OPEN',
      }).onConflictDoNothing();

      await db.insert(schema.departments).values([
        { id: 'dept-eng', companyId: COMPANY_A_ID, code: 'ENG', name: 'Engineering', status: 'ACTIVE' },
        { id: 'dept-fin', companyId: COMPANY_A_ID, code: 'FIN', name: 'Finance', status: 'ACTIVE' },
      ]).onConflictDoNothing();

      await db.insert(schema.accounts).values([
        { id: CASH_ACC_ID, companyId: COMPANY_A_ID, accountCode: '1010', accountName: 'Cash in Bank', accountType: 'ASSET', normalBalance: 'DEBIT', isActive: true },
        { id: AR_ACC_ID, companyId: COMPANY_A_ID, accountCode: '1110', accountName: 'Accounts Receivable', accountType: 'ASSET', normalBalance: 'DEBIT', isActive: true },
        { id: AP_ACC_ID, companyId: COMPANY_A_ID, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isActive: true },
        { id: SSS_PAY_ACC_ID, companyId: COMPANY_A_ID, accountCode: '2110', accountName: 'SSS Contributions Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isActive: true },
        { id: PHIC_PAY_ACC_ID, companyId: COMPANY_A_ID, accountCode: '2120', accountName: 'PhilHealth Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isActive: true },
        { id: HDMF_PAY_ACC_ID, companyId: COMPANY_A_ID, accountCode: '2130', accountName: 'Pag-IBIG Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isActive: true },
        { id: WTAX_PAY_ACC_ID, companyId: COMPANY_A_ID, accountCode: '2140', accountName: 'Withholding Tax Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isActive: true },
        { id: REV_ACC_ID, companyId: COMPANY_A_ID, accountCode: '4010', accountName: 'Service Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isActive: true },
        { id: EXP_ACC_ID, companyId: COMPANY_A_ID, accountCode: '6010', accountName: 'Operating Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', isActive: true },
        { id: SAL_EXP_ACC_ID, companyId: COMPANY_A_ID, accountCode: '6110', accountName: 'Salaries and Wages Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', isActive: true },
      ]).onConflictDoNothing();

      await db.insert(schema.customers).values({
        id: CUSTOMER_ID,
        companyId: COMPANY_A_ID,
        code: 'CUST-J360-01',
        legalName: 'Ayala Land Enterprise Client Inc.',
        tin: '123-456-789-000',
        defaultReceivableAccountId: AR_ACC_ID,
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.vendors).values({
        id: VENDOR_ID,
        companyId: COMPANY_A_ID,
        code: 'VEND-J360-01',
        legalName: 'Meralco Power Supplier Corp.',
        tin: '987-654-321-000',
        defaultPayableAccountId: AP_ACC_ID,
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.employees).values({
        id: EMPLOYEE_ID,
        companyId: COMPANY_A_ID,
        employeeNo: 'EMP-J360-01',
        firstName: 'Andres',
        lastName: 'Bonifacio',
        tin: '234-567-890-000',
        sssNo: '34-1234567-8',
        philhealthNo: '12-345678901-2',
        pagibigNo: '1234-5678-9012',
        department: 'Engineering',
        position: 'Senior Systems Engineer',
        monthlyBasicSalary: 5000000, // ₱50,000.00
        status: 'ACTIVE',
      }).onConflictDoNothing();

      const provisionUser = async (
        userId: string,
        email: string,
        displayName: string,
        roleName: string,
        scopeOpts?: { dataScope?: string; departmentScopeId?: string | null }
      ) => {
        const targetScope = scopeOpts?.dataScope || 'COMPANY_WIDE';
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
          companyId: COMPANY_A_ID,
          roleId: roleRec.id,
          legacyRole: roleName,
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: targetScope,
        }).onConflictDoNothing();

        await RbacService.setMemberRoles(null, memId, [roleName], `Provisioned ${roleName} for Journey 360 tests`);

        await db.update(schema.companyUsers)
          .set({ defaultDataScope: targetScope })
          .where(eq(schema.companyUsers.id, memId));

        await db.update(schema.userModuleAssignments)
          .set({
            dataScope: targetScope,
            departmentScopeId: scopeOpts?.departmentScopeId || null,
            origin: 'USER_SPECIFIC_GRANT',
          })
          .where(eq(schema.userModuleAssignments.companyUserId, memId));

        const rawToken = crypto.randomBytes(32).toString('hex');
        await db.insert(schema.sessions).values({
          id: hashToken(rawToken),
          userId,
          companyId: COMPANY_A_ID,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

        return `${COMPANY_A_ID}.${rawToken}`;
      };

      userAToken = await provisionUser(USER_A_ID, 'preparer.a@j360.ph', USER_A_NAME, 'Accountant');
      userBToken = await provisionUser(USER_B_ID, 'approver.b@j360.ph', USER_B_NAME, 'Approver');
      userCToken = await provisionUser(USER_C_ID, 'poster.c@j360.ph', USER_C_NAME, 'Company Owner');
      auditorToken = await provisionUser(USER_AUDITOR_ID, 'auditor@j360.ph', USER_AUDITOR_NAME, 'Auditor');
      bookkeeperToken = await provisionUser(USER_BOOKKEEPER_ID, 'bookkeeper@j360.ph', USER_BOOKKEEPER_NAME, 'Bookkeeper');
      ownScopeSalesToken = await provisionUser(
        USER_OWN_SCOPE_ID,
        'ownsales@j360.ph',
        USER_OWN_SCOPE_NAME,
        'Bookkeeper',
        { dataScope: 'OWN_RECORDS' }
      );
      deptScopeAcctToken = await provisionUser(
        USER_DEPT_SCOPE_ID,
        'deptacct@j360.ph',
        USER_DEPT_SCOPE_NAME,
        'Accountant',
        { dataScope: 'DEPARTMENT', departmentScopeId: 'dept-eng' }
      );
    });

    // Provision Company B with a confidential journal entry
    const dbB = await CompanyManager.getCompanyDb(COMPANY_B_ID);
    await dbContext.run(dbB, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      await db.insert(schema.users).values({
        id: USER_COMP_B_ID,
        email: 'owner.b@j360.ph',
        displayName: 'Company B Owner',
        passwordHash: 'test_hash',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      const roleRec = await RbacService.ensureRoleRecord('Company Owner');
      const memId = `mem-${USER_COMP_B_ID}`;
      await db.insert(schema.companyUsers).values({
        id: memId,
        userId: USER_COMP_B_ID,
        companyId: COMPANY_B_ID,
        roleId: roleRec.id,
        legacyRole: 'Company Owner',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        defaultDataScope: 'COMPANY_WIDE',
      }).onConflictDoNothing();
      await RbacService.setMemberRoles(null, memId, ['Company Owner'], 'Owner B');

      const rawToken = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawToken),
        userId: USER_COMP_B_ID,
        companyId: COMPANY_B_ID,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      companyBToken = `${COMPANY_B_ID}.${rawToken}`;

      companyBJournalId = 'je-comp-b-secret-001';
      await db.insert(schema.journalEntries).values({
        id: companyBJournalId,
        companyId: COMPANY_B_ID,
        journalNumber: 'JE-COMP-B-0001',
        entryDate: '2026-05-01',
        description: 'Confidential Company B Merger Accrual',
        status: 'DRAFT',
        createdBy: USER_COMP_B_ID,
      }).onConflictDoNothing();
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    for (const cid of [COMPANY_A_ID, COMPANY_B_ID]) {
      const cdir = path.join(paths.getCompaniesRootDir(), cid);
      const laiFile = `${cdir}.lai`;
      if (fs.existsSync(cdir)) {
        try { fs.rmSync(cdir, { recursive: true, force: true }); } catch {}
      }
      if (fs.existsSync(laiFile)) {
        try { fs.rmSync(laiFile, { force: true }); } catch {}
      }
      await CompanyManager.unregisterCompany(cid).catch(() => {});
    }
  });

  // =========================================================================
  // CATEGORY A & B: LIFECYCLE ACCURACY & STRICT ACTOR ATTRIBUTION INTEGRITY
  // =========================================================================
  describe('A & B. 14-Stage Lifecycle Checkpoints & Multi-Actor Attribution Integrity', () => {
    let journalId: string;
    let reversalJournalId: string;

    it('1. Preserves distinct Created By (User A), Last Modified By (User A), Submitted By (User A), Approved By (User B), Posted By (User C), and Reversed By (User C) without conflation or Juan Dela Cruz fallbacks', async () => {
      // Step 1: User A (Accountant/Preparer) creates a DRAFT journal entry
      const dbA = await CompanyManager.getCompanyDb(COMPANY_A_ID);
      journalId = 'je-j360-lifecycle-001';

      await dbContext.run(dbA, async () => {
        await db.insert(schema.journalEntries).values({
          id: journalId,
          companyId: COMPANY_A_ID,
          journalNumber: 'JE-2026-J360-001',
          entryDate: '2026-05-10',
          accountingPeriodId: PERIOD_ID,
          description: 'Initial draft office supplies accrual',
          status: 'DRAFT',
          source: 'MANUAL',
          createdBy: USER_A_ID,
        }).onConflictDoNothing();
        await db.insert(schema.journalLines).values([
          {
            id: 'jl-j360-1',
            journalEntryId: journalId,
            accountId: EXP_ACC_ID,
            description: 'Office supplies expense',
            debit: 250000,
            credit: 0,
            lineNumber: 1,
            departmentId: 'dept-eng',
          },
          {
            id: 'jl-j360-2',
            journalEntryId: journalId,
            accountId: CASH_ACC_ID,
            description: 'Cash payment',
            debit: 0,
            credit: 250000,
            lineNumber: 2,
            departmentId: 'dept-eng',
          },
        ]).onConflictDoNothing();
      });

      // Verify Stage 4 is COMPLETED while Stage 5, 6, 9, 12 are honestly PENDING in DRAFT state
      const draft360 = await request(app)
        .get(`/api/journey/360/JOURNAL_ENTRY/${journalId}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(draft360.status).toBe(200);
      expect(draft360.body.ownership.createdBy).toBe(USER_A_NAME);
      expect(draft360.body.ownership.createdBy).not.toContain('Juan Dela Cruz');
      expect(draft360.body.ownership.createdBy).not.toBe(USER_AUDITOR_NAME); // Never falls back to viewer session!
      expect(draft360.body.ownership.submittedBy).toBeNull();
      expect(draft360.body.ownership.approvedBy).toBeNull();
      expect(draft360.body.ownership.postedBy).toBeNull();

      const draftCheckpoints = draft360.body.lifecycleCheckpoints;
      expect(draftCheckpoints).toHaveLength(14);
      expect(draftCheckpoints.find((c: any) => c.stageCode === 'DRAFT_CREATION').status).toBe('COMPLETED');
      expect(draftCheckpoints.find((c: any) => c.stageCode === 'DOCUMENT_UPLOAD_AND_OCR').status).toBe('NOT_APPLICABLE');
      expect(draftCheckpoints.find((c: any) => c.stageCode === 'SUBMISSION').status).toBe('PENDING');
      expect(draftCheckpoints.find((c: any) => c.stageCode === 'APPROVAL_OR_REJECTION').status).toBe('PENDING');
      expect(draftCheckpoints.find((c: any) => c.stageCode === 'GL_POSTING').status).toBe('PENDING');
      expect(draftCheckpoints.find((c: any) => c.stageCode === 'FINANCIAL_STATEMENT_IMPACT').status).toBe('PENDING');

      // Step 2: User A edits the description field
      const editRes = await request(app)
        .post(`/api/journey/action/JOURNAL_ENTRY/${journalId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          action: 'EDIT',
          updates: { description: 'Updated office supplies accrual with verified OR reference' },
          reason: 'Added official receipt reference to narration',
        });
      expect(editRes.status).toBe(200);

      // Step 3: User A submits the journal entry for approval
      const submitRes = await request(app)
        .post(`/api/journey/action/JOURNAL_ENTRY/${journalId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          action: 'SUBMIT',
          reason: 'Ready for supervisor review',
        });
      expect(submitRes.status).toBe(200);
      expect(submitRes.body.status).toBe('SUBMITTED');

      // Step 4: User B (Approver) approves the journal entry
      const approveRes = await request(app)
        .post(`/api/journey/action/JOURNAL_ENTRY/${journalId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          action: 'APPROVE',
          reason: 'Verified supporting receipts and account coding',
        });
      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');

      // Step 5: User C (Controller/Owner) posts the journal entry to the General Ledger
      const postRes = await request(app)
        .post(`/api/journey/action/JOURNAL_ENTRY/${journalId}`)
        .set('Authorization', `Bearer ${userCToken}`)
        .send({
          action: 'POST',
          reason: 'Posted to FY 2026 General Ledger',
        });
      expect(postRes.status).toBe(200);
      expect(postRes.body.status).toBe('POSTED');

      // Inspect 360° Journey as independent External Auditor (User Auditor)
      const posted360 = await request(app)
        .get(`/api/journey/360/JOURNAL_ENTRY/${journalId}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(posted360.status).toBe(200);

      const own = posted360.body.ownership;
      expect(own.createdBy).toBe(USER_A_NAME);
      expect(own.createdById).toBe(USER_A_ID);
      // CRITICAL: Last Modified By MUST remain User A (who edited description), NOT User B (Approver) or User C (Poster)!
      expect(own.lastModifiedBy).toBe(USER_A_NAME);
      expect(own.lastModifiedById).toBe(USER_A_ID);
      expect(own.submittedBy).toBe(USER_A_NAME);
      expect(own.submittedById).toBe(USER_A_ID);
      expect(own.approvedBy).toBe(USER_B_NAME);
      expect(own.approvedById).toBe(USER_B_ID);
      expect(own.postedBy).toBe(USER_C_NAME);
      expect(own.postedById).toBe(USER_C_ID);
      expect(own.lastActionBy).toBe(USER_C_NAME);
      expect(own.lastActionById).toBe(USER_C_ID);

      // Verify 14-Stage Checkpoints after GL Posting
      const postedCheckpoints = posted360.body.lifecycleCheckpoints;
      expect(postedCheckpoints.find((c: any) => c.stageCode === 'SUBMISSION').status).toBe('COMPLETED');
      expect(postedCheckpoints.find((c: any) => c.stageCode === 'SUBMISSION').actor).toBe(USER_A_NAME);
      expect(postedCheckpoints.find((c: any) => c.stageCode === 'APPROVAL_OR_REJECTION').status).toBe('COMPLETED');
      expect(postedCheckpoints.find((c: any) => c.stageCode === 'APPROVAL_OR_REJECTION').actor).toBe(USER_B_NAME);
      expect(postedCheckpoints.find((c: any) => c.stageCode === 'GL_POSTING').status).toBe('COMPLETED');
      expect(postedCheckpoints.find((c: any) => c.stageCode === 'GL_POSTING').actor).toBe(USER_C_NAME);
      expect(postedCheckpoints.find((c: any) => c.stageCode === 'FINANCIAL_STATEMENT_IMPACT').status).toBe('COMPLETED');
      expect(postedCheckpoints.find((c: any) => c.stageCode === 'CORRECTION_OR_REVERSAL').status).toBe('NOT_APPLICABLE');
    });

    it('2. Ensures failed or unauthorized actions are logged as FAILED and NEVER overwrite lastModifiedBy, approvedBy, postedBy, or lastActionBy', async () => {
      // Auditor (read-only) attempts to EDIT the posted journal entry -> 403 PERMISSION_DENIED
      const failedAuditorEdit = await request(app)
        .post(`/api/journey/action/JOURNAL_ENTRY/${journalId}`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({
          action: 'EDIT',
          updates: { description: 'Unauthorized auditor tampering' },
        });
      expect(failedAuditorEdit.status).toBe(403);

      // Accountant (User A) attempts to EDIT the locked POSTED journal entry -> 403 RECORD_LOCKED
      const failedLockedEdit = await request(app)
        .post(`/api/journey/action/JOURNAL_ENTRY/${journalId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          action: 'EDIT',
          updates: { description: 'Attempted edit on locked posted entry' },
        });
      expect(failedLockedEdit.status).toBe(403);

      // Controller (User C) attempts to directly CANCEL the immutable POSTED journal entry -> 400 POSTED_IMMUTABLE
      const failedCancel = await request(app)
        .post(`/api/journey/action/JOURNAL_ENTRY/${journalId}`)
        .set('Authorization', `Bearer ${userCToken}`)
        .send({
          action: 'CANCEL',
          reason: 'Attempted direct cancel on posted entry',
        });
      expect(failedCancel.status).toBe(400);

      // Re-fetch 360° Journey and verify that failed events are present in activityHistory as FAILED,
      // AND actor attribution was NOT overwritten by User Auditor or failed actions!
      const afterFailed360 = await request(app)
        .get(`/api/journey/360/JOURNAL_ENTRY/${journalId}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(afterFailed360.status).toBe(200);

      const failedEvents = afterFailed360.body.activityHistory.filter((e: any) => e.result === 'FAILED');
      expect(failedEvents.length).toBeGreaterThanOrEqual(3);

      const own = afterFailed360.body.ownership;
      expect(own.createdBy).toBe(USER_A_NAME);
      expect(own.lastModifiedBy).toBe(USER_A_NAME);
      expect(own.submittedBy).toBe(USER_A_NAME);
      expect(own.approvedBy).toBe(USER_B_NAME);
      expect(own.postedBy).toBe(USER_C_NAME);
      expect(own.lastActionBy).toBe(USER_C_NAME);
      expect(own.lastActionBy).not.toBe(USER_AUDITOR_NAME);
    });

    it('3. Tracks accounting reversal and bidirectional lineage between original and reversal journal entries', async () => {
      const revRes = await request(app)
        .post(`/api/journey/action/JOURNAL_ENTRY/${journalId}`)
        .set('Authorization', `Bearer ${userCToken}`)
        .send({
          action: 'REVERSE',
          reverseDate: '2026-05-15',
          reason: 'Reversing accrual upon receipt of final supplier invoice',
        });
      expect(revRes.status).toBe(200);
      expect(revRes.body.status).toBe('REVERSED');
      reversalJournalId = revRes.body.reversalId;
      expect(reversalJournalId).toBeTruthy();

      // Verify original journal 360° shows REVERSED status, reversedBy = User C, Stage 13 = COMPLETED, and links to Reversal Journal
      const orig360 = await request(app)
        .get(`/api/journey/360/JOURNAL_ENTRY/${journalId}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(orig360.status).toBe(200);
      expect(orig360.body.ownership.reversedBy).toBe(USER_C_NAME);
      expect(orig360.body.lifecycleCheckpoints.find((c: any) => c.stageCode === 'CORRECTION_OR_REVERSAL').status).toBe('COMPLETED');
      const revLink = orig360.body.relatedRecords.find((r: any) => r.relationship === 'REVERSAL_JOURNAL');
      expect(revLink).toBeDefined();
      expect(revLink.id).toBe(reversalJournalId);

      // Verify reversal journal 360° links back to the original journal entry
      const rev360 = await request(app)
        .get(`/api/journey/360/JOURNAL_ENTRY/${reversalJournalId}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(rev360.status).toBe(200);
      const origLink = rev360.body.relatedRecords.find((r: any) => r.relationship === 'ORIGINAL_TRANSACTION');
      expect(origLink).toBeDefined();
      expect(origLink.id).toBe(journalId);
    });
  });

  // =========================================================================
  // CATEGORY C: CROSS-MODULE INTEGRITY (AR, AP, PAYROLL, GL, TAX, BROKEN REFS)
  // =========================================================================
  describe('C. Cross-Module 360° Lineage (AR, AP, Payroll, GL, Tax & Broken Reference Detection)', () => {
    it('1. Traces Sales Invoice -> AR Subledger -> Customer Payment (OR) -> GL Journal -> Tax Calculation with preserved actors', async () => {
      const dbA = await CompanyManager.getCompanyDb(COMPANY_A_ID);
      let invoiceId = '';
      let paymentId = '';
      let glJournalId = '';

      await dbContext.run(dbA, async () => {
        // User A creates and submits Sales Invoice
        invoiceId = await createSalesInvoice(
          COMPANY_A_ID,
          {
            customerId: CUSTOMER_ID,
            invoiceNumber: 'SI-2026-J360-001',
            invoiceDate: '2026-05-12',
            dueDate: '2026-06-12',
            reference: 'PO-CLIENT-889',
            totalAmount: 1120000, // ₱11,200.00
            lines: [
              {
                accountId: REV_ACC_ID,
                description: 'Enterprise Cloud Consulting Services',
                quantity: 1,
                unitPrice: 1120000,
                amount: 1120000,
              },
            ],
          },
          USER_A_ID
        );
        await submitSalesInvoice(COMPANY_A_ID, invoiceId, USER_A_ID);

        // User B approves Sales Invoice (SoD enforced)
        await approveSalesInvoice(COMPANY_A_ID, invoiceId, USER_B_ID);

        // User C posts Sales Invoice to GL
        await postSalesInvoice(COMPANY_A_ID, invoiceId, PERIOD_ID, [], USER_C_ID);

        const invRow = await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, invoiceId)).get();
        glJournalId = invRow!.journalEntryId!;
        expect(glJournalId).toBeTruthy();

        // User A records and User C posts Customer Payment (Official Receipt Collection)
        paymentId = await createCustomerPayment(
          COMPANY_A_ID,
          {
            customerId: CUSTOMER_ID,
            paymentNumber: 'OR-2026-J360-001',
            officialReceiptNumber: 'OR-88901',
            paymentDate: '2026-05-20',
            amount: 1120000,
            paymentMethod: 'BANK_TRANSFER',
            cashAccountId: CASH_ACC_ID,
            reference: 'BPI-TRF-99102',
            applications: [
              {
                invoiceId,
                appliedAmount: 1120000,
                withholdingAmount: 0,
              },
            ],
          },
          USER_A_ID
        );
        await postCustomerPayment(COMPANY_A_ID, paymentId, PERIOD_ID, USER_C_ID);
      });

      // 1. Inspect Sales Invoice 360° Journey
      const inv360 = await request(app)
        .get(`/api/journey/360/SALES_INVOICE/${invoiceId}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(inv360.status).toBe(200);
      expect(inv360.body.ownership.createdBy).toBe(USER_A_NAME);
      expect(inv360.body.ownership.submittedBy).toBe(USER_A_NAME);
      expect(inv360.body.ownership.approvedBy).toBe(USER_B_NAME);
      expect(inv360.body.ownership.postedBy).toBe(USER_C_NAME);

      const invRel = inv360.body.relatedRecords;
      expect(invRel.some((r: any) => r.entityType === 'CUSTOMER' && r.id === CUSTOMER_ID)).toBe(true);
      expect(invRel.some((r: any) => r.entityType === 'JOURNAL_ENTRY' && r.id === glJournalId)).toBe(true);
      expect(invRel.some((r: any) => r.entityType === 'CUSTOMER_PAYMENT' && r.id === paymentId)).toBe(true);

      // Verify Stages 7 (Subledger), 8 (Journal Gen), 9 (GL Posting), 10 (Settlement), 11 (Tax), 12 (FS Impact) are COMPLETED
      const invStages = inv360.body.lifecycleCheckpoints;
      expect(invStages.find((c: any) => c.stageCode === 'SUBLEDGER_POSTING').status).toBe('COMPLETED');
      expect(invStages.find((c: any) => c.stageCode === 'JOURNAL_GENERATION').status).toBe('COMPLETED');
      expect(invStages.find((c: any) => c.stageCode === 'GL_POSTING').status).toBe('COMPLETED');
      expect(invStages.find((c: any) => c.stageCode === 'SETTLEMENT_OR_DISBURSEMENT').status).toBe('COMPLETED');
      expect(invStages.find((c: any) => c.stageCode === 'TAX_AND_STATUTORY_IMPACT').status).toBe('COMPLETED');
      expect(invStages.find((c: any) => c.stageCode === 'FINANCIAL_STATEMENT_IMPACT').status).toBe('COMPLETED');

      // 2. Inspect generated GL Journal Entry 360° Journey — verify it preserved User A (createdBy/submittedBy), User B (approvedBy), User C (postedBy)
      const je360 = await request(app)
        .get(`/api/journey/360/JOURNAL_ENTRY/${glJournalId}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(je360.status).toBe(200);
      expect(je360.body.ownership.createdBy).toBe(USER_A_NAME);
      expect(je360.body.ownership.submittedBy).toBe(USER_A_NAME);
      expect(je360.body.ownership.approvedBy).toBe(USER_B_NAME);
      expect(je360.body.ownership.postedBy).toBe(USER_C_NAME);
      expect(je360.body.relatedRecords.some((r: any) => r.entityType === 'SALES_INVOICE' && r.id === invoiceId)).toBe(true);
    });

    it('2. Traces Purchase Bill -> AP Subledger -> Supplier Payment -> GL Journal with preserved actors', async () => {
      const dbA = await CompanyManager.getCompanyDb(COMPANY_A_ID);
      let billId = '';
      let suppPayId = '';
      let billJournalId = '';

      await dbContext.run(dbA, async () => {
        billId = await createPurchaseBill(
          COMPANY_A_ID,
          {
            vendorId: VENDOR_ID,
            billNumber: 'PB-2026-J360-001',
            billDate: '2026-05-14',
            dueDate: '2026-06-14',
            totalAmount: 560000,
            lines: [
              {
                accountId: EXP_ACC_ID,
                description: 'Data Center Electricity Bill',
                quantity: 1,
                unitPrice: 560000,
                amount: 560000,
              },
            ],
          },
          USER_A_ID
        );
        await submitPurchaseBill(COMPANY_A_ID, billId, USER_A_ID);
        await approvePurchaseBill(COMPANY_A_ID, billId, USER_B_ID);
        await postPurchaseBill(COMPANY_A_ID, billId, PERIOD_ID, [], USER_C_ID);

        const billRow = await db.select().from(schema.purchaseBills).where(eq(schema.purchaseBills.id, billId)).get();
        billJournalId = billRow!.journalEntryId!;

        suppPayId = await createSupplierPayment(
          COMPANY_A_ID,
          {
            vendorId: VENDOR_ID,
            paymentNumber: 'CV-2026-J360-001',
            paymentDate: '2026-05-22',
            amount: 560000,
            paymentMethod: 'CHECK',
            cashAccountId: CASH_ACC_ID,
            reference: 'CHK-009912',
            applications: [
              {
                billId,
                appliedAmount: 560000,
                withholdingAmount: 0,
              },
            ],
          },
          USER_A_ID
        );
        await postSupplierPayment(COMPANY_A_ID, suppPayId, PERIOD_ID, USER_C_ID);
      });

      const bill360 = await request(app)
        .get(`/api/journey/360/PURCHASE_BILL/${billId}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(bill360.status).toBe(200);
      expect(bill360.body.ownership.createdBy).toBe(USER_A_NAME);
      expect(bill360.body.ownership.submittedBy).toBe(USER_A_NAME);
      expect(bill360.body.ownership.approvedBy).toBe(USER_B_NAME);
      expect(bill360.body.ownership.postedBy).toBe(USER_C_NAME);
      expect(bill360.body.relatedRecords.some((r: any) => r.entityType === 'VENDOR' && r.id === VENDOR_ID)).toBe(true);
      expect(bill360.body.relatedRecords.some((r: any) => r.entityType === 'JOURNAL_ENTRY' && r.id === billJournalId)).toBe(true);
      expect(bill360.body.relatedRecords.some((r: any) => r.entityType === 'SUPPLIER_PAYMENT' && r.id === suppPayId)).toBe(true);
    });

    it('3. Traces Payroll Run -> Employee Statutory Deductions -> GL Journal Entry', async () => {
      const dbA = await CompanyManager.getCompanyDb(COMPANY_A_ID);
      const payrollRunId = 'pr-j360-001';
      const payrollJeId = 'je-payroll-j360-001';

      await dbContext.run(dbA, async () => {
        await db.insert(schema.journalEntries).values({
          id: payrollJeId,
          companyId: COMPANY_A_ID,
          journalNumber: 'JE-PR-2026-05',
          entryDate: '2026-05-30',
          accountingPeriodId: PERIOD_ID,
          description: 'May 2026 Payroll & Statutory Deductions',
          status: 'POSTED',
          source: 'PAYROLL',
          createdBy: USER_A_ID,
          submittedBy: USER_A_ID,
          approvedBy: USER_B_ID,
          postedBy: USER_C_ID,
          postedAt: new Date(),
        }).onConflictDoNothing();
        await db.insert(schema.journalLines).values([
          { id: 'jl-pr-1', journalEntryId: payrollJeId, accountId: SAL_EXP_ACC_ID, debit: 5000000, credit: 0, lineNumber: 1, departmentId: 'dept-eng' },
          { id: 'jl-pr-2', journalEntryId: payrollJeId, accountId: SSS_PAY_ACC_ID, debit: 0, credit: 135000, lineNumber: 2, departmentId: 'dept-eng' },
          { id: 'jl-pr-3', journalEntryId: payrollJeId, accountId: PHIC_PAY_ACC_ID, debit: 0, credit: 125000, lineNumber: 3, departmentId: 'dept-eng' },
          { id: 'jl-pr-4', journalEntryId: payrollJeId, accountId: HDMF_PAY_ACC_ID, debit: 0, credit: 20000, lineNumber: 4, departmentId: 'dept-eng' },
          { id: 'jl-pr-5', journalEntryId: payrollJeId, accountId: WTAX_PAY_ACC_ID, debit: 0, credit: 416675, lineNumber: 5, departmentId: 'dept-eng' },
          { id: 'jl-pr-6', journalEntryId: payrollJeId, accountId: CASH_ACC_ID, debit: 0, credit: 4303325, lineNumber: 6, departmentId: 'dept-eng' },
        ]).onConflictDoNothing();

        await db.insert(schema.payrollRuns).values({
          id: payrollRunId,
          companyId: COMPANY_A_ID,
          payrollPeriod: '2026-05',
          startDate: '2026-05-01',
          endDate: '2026-05-31',
          paymentDate: '2026-05-30',
          totalGrossPay: 5000000,
          totalSss: 135000,
          totalPhilhealth: 125000,
          totalPagibig: 20000,
          totalWithholdingTax: 416675,
          totalNetPay: 4303325,
          status: 'POSTED',
          journalEntryId: payrollJeId,
          createdBy: USER_A_ID,
          approvedBy: USER_B_ID,
        }).onConflictDoNothing();

        await db.insert(schema.payrollItems).values({
          id: 'pi-j360-001',
          payrollRunId,
          employeeId: EMPLOYEE_ID,
          basicPay: 5000000,
          overtimePay: 0,
          holidayPay: 0,
          nightDiffPay: 0,
          grossPay: 5000000,
          sssEmployee: 135000,
          sssEmployer: 285000,
          philhealthEmployee: 125000,
          philhealthEmployer: 125000,
          pagibigEmployee: 20000,
          pagibigEmployer: 20000,
          withholdingTax: 416675,
          totalDeductions: 696675,
          netPay: 4303325,
        }).onConflictDoNothing();
      });

      const pr360 = await request(app)
        .get(`/api/journey/360/PAYROLL_RUN/${payrollRunId}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(pr360.status).toBe(200);
      expect(pr360.body.lines.length).toBe(1);
      expect(pr360.body.lines[0].employeeId).toBe(EMPLOYEE_ID);
      expect(pr360.body.relatedRecords.some((r: any) => r.entityType === 'JOURNAL_ENTRY' && r.id === payrollJeId)).toBe(true);
      expect(pr360.body.relatedRecords.some((r: any) => r.entityType === 'EMPLOYEE' && r.id === EMPLOYEE_ID)).toBe(true);
      expect(pr360.body.lifecycleCheckpoints.find((c: any) => c.stageCode === 'TAX_AND_STATUTORY_IMPACT').status).toBe('COMPLETED');
    });

    it('4. Detects broken/missing foreign-key references honestly without fabricating placeholder records', async () => {
      const dbA = await CompanyManager.getCompanyDb(COMPANY_A_ID);
      const brokenInvId = 'inv-broken-ref-001';
      await dbContext.run(dbA, async () => {
        (dbA as any).$client.pragma('foreign_keys = OFF');
        try {
          await db.insert(schema.salesInvoices).values({
            id: brokenInvId,
            companyId: COMPANY_A_ID,
            customerId: CUSTOMER_ID,
            invoiceNumber: 'SI-BROKEN-001',
            invoiceDate: '2026-05-18',
            dueDate: '2026-06-18',
            totalAmount: 100000,
            balanceDue: 100000,
            status: 'POSTED',
            journalEntryId: 'non-existent-je-99999', // Broken FK!
            createdBy: USER_A_ID,
          }).onConflictDoNothing();
        } finally {
          (dbA as any).$client.pragma('foreign_keys = ON');
        }
      });

      const broken360 = await request(app)
        .get(`/api/journey/360/SALES_INVOICE/${brokenInvId}`)
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(broken360.status).toBe(200);
      expect(broken360.body.missingReferences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'journalEntryId',
            targetEntityType: 'JOURNAL_ENTRY',
            targetId: 'non-existent-je-99999',
          }),
        ])
      );
      const stage8 = broken360.body.lifecycleCheckpoints.find((c: any) => c.stageCode === 'JOURNAL_GENERATION');
      expect(stage8.status).toBe('BROKEN_REFERENCE');
    });
  });

  // =========================================================================
  // CATEGORY D: SECURITY (TENANT ISOLATION, RBAC, DATA SCOPE, ANTI-SPOOFING)
  // =========================================================================
  describe('D. Cross-Company Isolation, Row-Level Data Scope & Anti-Spoofing Enforcement', () => {
    it('1. Blocks cross-company 360° lookup and workflow actions with 404 NOT_FOUND (zero tenant leakage)', async () => {
      // Request Company B's journal entry using Company A Owner token
      const cross360 = await request(app)
        .get(`/api/journey/360/JOURNAL_ENTRY/${companyBJournalId}`)
        .set('Authorization', `Bearer ${userCToken}`);
      expect(cross360.status).toBe(404);

      const crossAction = await request(app)
        .post(`/api/journey/action/JOURNAL_ENTRY/${companyBJournalId}`)
        .set('Authorization', `Bearer ${userCToken}`)
        .send({ action: 'SUBMIT' });
      expect(crossAction.status).toBe(404);
    });

    it('2. Ignores x-simulate-role and simulateRole spoofing headers/body on 360° and workflow endpoints', async () => {
      const dbA = await CompanyManager.getCompanyDb(COMPANY_A_ID);
      const spoofJeId = 'je-spoof-target-001';
      await dbContext.run(dbA, async () => {
        await db.insert(schema.journalEntries).values({
          id: spoofJeId,
          companyId: COMPANY_A_ID,
          journalNumber: 'JE-SPOOF-001',
          entryDate: '2026-05-19',
          description: 'Spoof target journal',
          status: 'SUBMITTED',
          createdBy: USER_A_ID,
          submittedBy: USER_A_ID,
        }).onConflictDoNothing();
      });

      // Bookkeeper attempts to APPROVE by spoofing x-simulate-role: Company Owner
      const spoofApprove = await request(app)
        .post(`/api/journey/action/JOURNAL_ENTRY/${spoofJeId}`)
        .set('Authorization', `Bearer ${bookkeeperToken}`)
        .set('x-simulate-role', 'Company Owner')
        .send({
          action: 'APPROVE',
          simulateRole: 'OWNER',
          reason: 'Attempting privilege escalation via header/body',
        });
      expect(spoofApprove.status).toBe(403);
      expect(spoofApprove.body.code).toBe('PERMISSION_DENIED');

      // Verify permissions endpoint also ignores x-simulate-role
      const spoofPerms = await request(app)
        .get('/api/journey/permissions')
        .set('Authorization', `Bearer ${bookkeeperToken}`)
        .set('x-simulate-role', 'Company Owner');
      expect(spoofPerms.status).toBe(200);
      expect(spoofPerms.body.permissions.APPROVE).toBe(false);
    });

    it('3. Enforces row-level data scope (OWN_RECORDS and DEPARTMENT) on primary 360° lookup, related records, and linked documents', async () => {
      const dbA = await CompanyManager.getCompanyDb(COMPANY_A_ID);
      const otherUserInvId = 'inv-other-user-scope-001';
      const ownUserInvId = 'inv-own-user-scope-001';
      const finDeptJeId = 'je-fin-dept-only-001';
      const engDeptJeId = 'je-eng-dept-allowed-001';
      const restrictedDocId = 'doc-restricted-other-001';

      await dbContext.run(dbA, async () => {
        // Invoice created by User A (not USER_OWN_SCOPE_ID)
        await db.insert(schema.salesInvoices).values({
          id: otherUserInvId,
          companyId: COMPANY_A_ID,
          customerId: CUSTOMER_ID,
          invoiceNumber: 'SI-OTHER-SCOPE-001',
          invoiceDate: '2026-05-20',
          dueDate: '2026-06-20',
          totalAmount: 150000,
          balanceDue: 150000,
          status: 'DRAFT',
          createdBy: USER_A_ID,
        }).onConflictDoNothing();

        // Invoice created by USER_OWN_SCOPE_ID, linked to a Fin-only Journal Entry and a document uploaded by User A
        await db.insert(schema.journalEntries).values({
          id: finDeptJeId,
          companyId: COMPANY_A_ID,
          journalNumber: 'JE-FIN-ONLY-001',
          entryDate: '2026-05-20',
          description: 'Finance department confidential entry',
          status: 'POSTED',
          createdBy: USER_A_ID,
        }).onConflictDoNothing();
        await db.insert(schema.journalLines).values([
          { id: 'jl-fin-1', journalEntryId: finDeptJeId, accountId: EXP_ACC_ID, debit: 150000, credit: 0, lineNumber: 1, departmentId: 'dept-fin' },
          { id: 'jl-fin-2', journalEntryId: finDeptJeId, accountId: CASH_ACC_ID, debit: 0, credit: 150000, lineNumber: 2, departmentId: 'dept-fin' },
        ]).onConflictDoNothing();

        await db.insert(schema.salesInvoices).values({
          id: ownUserInvId,
          companyId: COMPANY_A_ID,
          customerId: CUSTOMER_ID,
          invoiceNumber: 'SI-OWN-SCOPE-001',
          invoiceDate: '2026-05-20',
          dueDate: '2026-06-20',
          totalAmount: 150000,
          balanceDue: 150000,
          status: 'POSTED',
          journalEntryId: finDeptJeId,
          createdBy: USER_OWN_SCOPE_ID,
        }).onConflictDoNothing();

        await db.insert(schema.documents).values({
          id: restrictedDocId,
          companyId: COMPANY_A_ID,
          entityType: 'SALES_INVOICE',
          entityId: ownUserInvId,
          fileName: 'other_user_private_scan.pdf',
          fileType: 'application/pdf',
          fileSize: 2048,
          filePath: '/tmp/other_user_private_scan.pdf',
          uploadedBy: USER_A_ID,
          linkedTransactionId: ownUserInvId,
          status: 'PROCESSED',
        }).onConflictDoNothing();

        // Engineering department Journal Entry
        await db.insert(schema.journalEntries).values({
          id: engDeptJeId,
          companyId: COMPANY_A_ID,
          journalNumber: 'JE-ENG-ALLOWED-001',
          entryDate: '2026-05-20',
          description: 'Engineering department entry',
          status: 'DRAFT',
          createdBy: USER_A_ID,
        }).onConflictDoNothing();
        await db.insert(schema.journalLines).values([
          { id: 'jl-eng-1', journalEntryId: engDeptJeId, accountId: EXP_ACC_ID, debit: 100000, credit: 0, lineNumber: 1, departmentId: 'dept-eng' },
          { id: 'jl-eng-2', journalEntryId: engDeptJeId, accountId: CASH_ACC_ID, debit: 0, credit: 100000, lineNumber: 2, departmentId: 'dept-eng' },
        ]).onConflictDoNothing();
      });

      // 1. OWN_RECORDS user cannot access User A's Sales Invoice -> 403 DATA_SCOPE_VIOLATION
      const blockedOwn360 = await request(app)
        .get(`/api/journey/360/SALES_INVOICE/${otherUserInvId}`)
        .set('Authorization', `Bearer ${ownScopeSalesToken}`);
      expect(blockedOwn360.status).toBe(403);
      expect(blockedOwn360.body.code).toBe('DATA_SCOPE_VIOLATION');

      // 2. OWN_RECORDS user CAN access their own Sales Invoice, but out-of-scope related records/documents created by User A are filtered out!
      const allowedOwn360 = await request(app)
        .get(`/api/journey/360/SALES_INVOICE/${ownUserInvId}`)
        .set('Authorization', `Bearer ${ownScopeSalesToken}`);
      expect(allowedOwn360.status).toBe(200);
      expect(allowedOwn360.body.securityScope.dataScope).toBe('OWN_RECORDS');
      expect(allowedOwn360.body.securityScope.restrictedRelatedCount).toBeGreaterThanOrEqual(1);
      expect(allowedOwn360.body.securityScope.restrictedDocumentsCount).toBeGreaterThanOrEqual(1);
      expect(allowedOwn360.body.documents.some((d: any) => d.id === restrictedDocId)).toBe(false);

      // 3. DEPARTMENT-scoped Accountant (dept-eng) is blocked from Finance department Journal Entry -> 403 DATA_SCOPE_VIOLATION
      const blockedDept360 = await request(app)
        .get(`/api/journey/360/JOURNAL_ENTRY/${finDeptJeId}`)
        .set('Authorization', `Bearer ${deptScopeAcctToken}`);
      expect(blockedDept360.status).toBe(403);
      expect(blockedDept360.body.code).toBe('DATA_SCOPE_VIOLATION');

      // 4. DEPARTMENT-scoped Accountant (dept-eng) CAN access Engineering department Journal Entry
      const allowedDept360 = await request(app)
        .get(`/api/journey/360/JOURNAL_ENTRY/${engDeptJeId}`)
        .set('Authorization', `Bearer ${deptScopeAcctToken}`);
      expect(allowedDept360.status).toBe(200);
    });

    it('4. Enforces RBAC permissions on Forensic Audit Investigation and Compliance Export endpoints', async () => {
      // Bookkeeper lacks audit:view, audit:export, and tax:export permissions
      const bkInvestigation = await request(app)
        .get('/api/journey/investigation?mode=SECURITY_EVENTS')
        .set('Authorization', `Bearer ${bookkeeperToken}`);
      expect(bkInvestigation.status).toBe(403);
      expect(bkInvestigation.body.code).toBe('PERMISSION_DENIED');

      const bkAuditExport = await request(app)
        .get('/api/journey/investigation/export?format=JSON')
        .set('Authorization', `Bearer ${bookkeeperToken}`);
      expect(bkAuditExport.status).toBe(403);
      expect(bkAuditExport.body.code).toBe('PERMISSION_DENIED');

      const bkBirExport = await request(app)
        .post('/api/journey/ledger-data-entry/export')
        .set('Authorization', `Bearer ${bookkeeperToken}`)
        .send({ exportType: 'SAWT', period: '2026-Q2' });
      expect(bkBirExport.status).toBe(403);
      expect(bkBirExport.body.code).toBe('PERMISSION_DENIED');

      // Auditor CAN access /api/journey/investigation and /api/journey/investigation/export
      const audInvestigation = await request(app)
        .get('/api/journey/investigation?mode=SECURITY_EVENTS')
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(audInvestigation.status).toBe(200);

      const audExport = await request(app)
        .get('/api/journey/investigation/export?format=JSON')
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(audExport.status).toBe(200);
      expect(audExport.body.evidencePackage.tamperEvidentVerified).toBe(true);
    });
  });

  // =========================================================================
  // CATEGORY E: BOUNDED PAGINATION & DEDUPLICATION
  // =========================================================================
  describe('E. Bounded Audit History Pagination & Event Deduplication', () => {
    it('Supports deterministic limit/offset pagination with zero duplicate events across pages', async () => {
      const page1 = await request(app)
        .get('/api/journey/360/JOURNAL_ENTRY/je-j360-lifecycle-001?limit=3&offset=0')
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(page1.status).toBe(200);
      expect(page1.body.pagination.limit).toBe(3);
      expect(page1.body.pagination.offset).toBe(0);
      expect(page1.body.pagination.total).toBeGreaterThanOrEqual(6);
      expect(page1.body.pagination.hasMore).toBe(true);
      expect(page1.body.activityHistory).toHaveLength(3);

      const page2 = await request(app)
        .get('/api/journey/360/JOURNAL_ENTRY/je-j360-lifecycle-001?limit=3&offset=3')
        .set('Authorization', `Bearer ${auditorToken}`);
      expect(page2.status).toBe(200);
      expect(page2.body.pagination.limit).toBe(3);
      expect(page2.body.pagination.offset).toBe(3);
      expect(page2.body.activityHistory.length).toBeGreaterThanOrEqual(3);

      const page1Ids = new Set(page1.body.activityHistory.map((e: any) => e.id));
      for (const evt of page2.body.activityHistory) {
        expect(page1Ids.has(evt.id)).toBe(false);
      }
    });
  });
});
