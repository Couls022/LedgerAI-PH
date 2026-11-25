import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createApp } from '../../src/server/app';
import { resolveReportPeriodScope } from '../../src/server/routes/reports';
import { CompanyManager } from '../../src/server/services/companyManager';
import { DatabaseEncryptionService } from '../../src/server/services/databaseEncryptionService';
import { paths } from '../../src/server/services/paths';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import {
  createJournalEntry,
  submitJournalEntry,
  approveJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  softClosePeriod,
  hardClosePeriod,
  reopenPeriod,
  performYearEndClose,
} from '../../src/server/db/domain';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import { eq, and } from 'drizzle-orm';

describe('Period-Scoped Accounting Report Validation, Reversal Lifecycle & Scratch Recovery', () => {
  const app = createApp();

  const COMP_A_ID = 'LGR-PH-TEST-PERIOD-REPORT-A';
  const COMP_B_ID = 'LGR-PH-TEST-PERIOD-REPORT-B';

  const OWNER_A_ID = 'usr-per-owner-a';
  const APPROVER_A_ID = 'usr-per-approver-a';
  const BOOKKEEPER_A_ID = 'usr-per-bk-a';
  const OWNER_B_ID = 'usr-per-owner-b';

  let ownerAToken = '';
  let bookkeeperAToken = '';
  let ownerBToken = '';

  const PER_JAN_A = 'per-2026-01-a';
  const PER_FEB_A = 'per-2026-02-a';
  const PER_JAN_B = 'per-2026-01-b';

  const ACC_CASH_A = 'acc-per-1010-a';
  const ACC_AR_A = 'acc-per-1030-a';
  const ACC_AP_A = 'acc-per-2010-a';
  const ACC_EQ_A = 'acc-per-3010-a';
  const ACC_REV_A = 'acc-per-4010-a';
  const ACC_EXP_A = 'acc-per-6010-a';
  const ACC_ZERO_A = 'acc-per-6090-a'; // Zero-activity account in Feb for Account Schedule test

  const ACC_CASH_B = 'acc-per-1010-b';
  const ACC_REV_B = 'acc-per-4010-b';

  let dbA: any;
  let sqliteA: any;
  let dbB: any;

  let janOpeningJeId = '';
  let janRevenueJeId = '';
  let janExpenseJeId = '';
  let janSamePeriodRevOrigId = '';
  let janSamePeriodRevChildId = '';
  let febRevenueJeId = '';
  let febExpenseJeId = '';

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();

    for (const cid of [COMP_A_ID, COMP_B_ID]) {
      await CompanyManager.resetDisposableTestCompanyWorkspace(cid);
    }

    await CompanyManager.createCompanyProfile(
      COMP_A_ID,
      'Period Reporting Validation Alpha Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    await CompanyManager.createCompanyProfile(
      COMP_B_ID,
      'Period Reporting Validation Beta Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    dbA = await CompanyManager.getCompanyDb(COMP_A_ID);
    sqliteA = await CompanyManager.getCompanySqlite(COMP_A_ID);
    dbB = await CompanyManager.getCompanyDb(COMP_B_ID);

    // Clear auto-provisioned accounting periods so we use controlled deterministic IDs
    sqliteA.prepare(`DELETE FROM accounting_periods WHERE company_id = ?`).run(COMP_A_ID);
    const sqliteB = await CompanyManager.getCompanySqlite(COMP_B_ID);
    sqliteB.prepare(`DELETE FROM accounting_periods WHERE company_id = ?`).run(COMP_B_ID);

    // Seed Company A users, roles, periods, and Chart of Accounts
    await dbContext.run(dbA, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      const seedUser = async (uid: string, email: string, name: string, roleName: string) => {
        await db
          .insert(schema.users)
          .values({
            id: uid,
            email,
            displayName: name,
            passwordHash: 'test_hash',
            status: 'ACTIVE',
          })
          .onConflictDoNothing();

        const roleRec = await RbacService.ensureRoleRecord(roleName);
        const memId = `mem-${uid}`;
        await db
          .insert(schema.companyUsers)
          .values({
            id: memId,
            userId: uid,
            companyId: COMP_A_ID,
            roleId: roleRec.id,
            legacyRole: roleName,
            status: 'ACTIVE',
            membershipStatus: 'ACTIVE',
            defaultDataScope: 'COMPANY_WIDE',
          })
          .onConflictDoNothing();

        await RbacService.setMemberRoles(null, memId, [roleName], `Seed ${roleName}`);

        const rawSession = crypto.randomBytes(32).toString('hex');
        await db.insert(schema.sessions).values({
          id: hashToken(rawSession),
          userId: uid,
          companyId: COMP_A_ID,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        return `${COMP_A_ID}.${rawSession}`;
      };

      ownerAToken = await seedUser(OWNER_A_ID, 'owner-a@periodtest.ph', 'Alpha Owner', 'Company Owner');
      await seedUser(APPROVER_A_ID, 'approver-a@periodtest.ph', 'Alpha Approver', 'Finance Manager');
      bookkeeperAToken = await seedUser(BOOKKEEPER_A_ID, 'bk-a@periodtest.ph', 'Alpha Bookkeeper', 'Bookkeeper');

      await db.insert(schema.accountingPeriods).values([
        {
          id: PER_JAN_A,
          companyId: COMP_A_ID,
          name: 'January 2026',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          fiscalYear: 2026,
          status: 'OPEN',
        },
        {
          id: PER_FEB_A,
          companyId: COMP_A_ID,
          name: 'February 2026',
          startDate: '2026-02-01',
          endDate: '2026-02-28',
          fiscalYear: 2026,
          status: 'OPEN',
        },
      ]);

      // Remove default seeded accounts in Company A to have a clean, exact COA
      sqliteA.prepare(`DELETE FROM accounts WHERE company_id = ?`).run(COMP_A_ID);

      await db.insert(schema.accounts).values([
        {
          id: ACC_CASH_A,
          companyId: COMP_A_ID,
          accountCode: '1010',
          accountName: 'Cash in Bank - BPI',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isCashAccount: true,
          status: 'ACTIVE',
        },
        {
          id: ACC_AR_A,
          companyId: COMP_A_ID,
          accountCode: '1030',
          accountName: 'Accounts Receivable - Trade',
          accountType: 'RECEIVABLE',
          normalBalance: 'DEBIT',
          isControlAccount: true,
          status: 'ACTIVE',
        },
        {
          id: ACC_AP_A,
          companyId: COMP_A_ID,
          accountCode: '2010',
          accountName: 'Accounts Payable - Trade',
          accountType: 'PAYABLE',
          normalBalance: 'CREDIT',
          isControlAccount: true,
          status: 'ACTIVE',
        },
        {
          id: ACC_EQ_A,
          companyId: COMP_A_ID,
          accountCode: '3010',
          accountName: 'Subscribed Share Capital',
          accountType: 'EQUITY',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
        },
        {
          id: ACC_REV_A,
          companyId: COMP_A_ID,
          accountCode: '4010',
          accountName: 'Service & Consulting Revenue',
          accountType: 'REVENUE',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
        },
        {
          id: ACC_EXP_A,
          companyId: COMP_A_ID,
          accountCode: '6010',
          accountName: 'Operating & Rent Expense',
          accountType: 'EXPENSE',
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
        },
        {
          id: ACC_ZERO_A,
          companyId: COMP_A_ID,
          accountCode: '6090',
          accountName: 'Miscellaneous Office Supplies',
          accountType: 'EXPENSE',
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
        },
      ]);
    });

    // Seed Company B for Cross-Company Isolation tests
    await dbContext.run(dbB, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      await db
        .insert(schema.users)
        .values({
          id: OWNER_B_ID,
          email: 'owner-b@periodtest.ph',
          displayName: 'Beta Owner',
          passwordHash: 'test_hash',
          status: 'ACTIVE',
        })
        .onConflictDoNothing();

      const roleRecB = await RbacService.ensureRoleRecord('Company Owner');
      const memIdB = `mem-${OWNER_B_ID}`;
      await db
        .insert(schema.companyUsers)
        .values({
          id: memIdB,
          userId: OWNER_B_ID,
          companyId: COMP_B_ID,
          roleId: roleRecB.id,
          legacyRole: 'Company Owner',
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: 'COMPANY_WIDE',
        })
        .onConflictDoNothing();

      await RbacService.setMemberRoles(null, memIdB, ['Company Owner'], 'Seed Owner B');

      const rawSessionB = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawSessionB),
        userId: OWNER_B_ID,
        companyId: COMP_B_ID,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      ownerBToken = `${COMP_B_ID}.${rawSessionB}`;

      await db.insert(schema.accountingPeriods).values({
        id: PER_JAN_B,
        companyId: COMP_B_ID,
        name: 'January 2026 Beta',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        fiscalYear: 2026,
        status: 'OPEN',
      });

      sqliteB.prepare(`DELETE FROM accounts WHERE company_id = ?`).run(COMP_B_ID);

      await db.insert(schema.accounts).values([
        {
          id: ACC_CASH_B,
          companyId: COMP_B_ID,
          accountCode: '1010',
          accountName: 'Cash in Bank - Beta',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isCashAccount: true,
          status: 'ACTIVE',
        },
        {
          id: ACC_REV_B,
          companyId: COMP_B_ID,
          accountCode: '4010',
          accountName: 'Beta Revenue',
          accountType: 'REVENUE',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
        },
      ]);

      // Post ₱9,999,999.00 (999,999,900 centavos) in Company B Jan 2026
      const jeB = await createJournalEntry(
        COMP_B_ID,
        {
          journalNumber: 'JE-BETA-2026-0001',
          entryDate: '2026-01-10',
          description: 'Beta Corp Revenue',
          accountingPeriodId: PER_JAN_B,
          createdBy: OWNER_B_ID,
          userRole: 'Company Owner',
        },
        [
          { accountId: ACC_CASH_B, debit: 999999900, credit: 0, description: 'Beta Cash' },
          { accountId: ACC_REV_B, debit: 0, credit: 999999900, description: 'Beta Revenue' },
        ]
      );
      await submitJournalEntry(COMP_B_ID, jeB, OWNER_B_ID);
      await approveJournalEntry(COMP_B_ID, jeB, OWNER_B_ID);
      await postJournalEntry(COMP_B_ID, jeB, OWNER_B_ID, 'Company Owner');
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    for (const cid of [COMP_A_ID, COMP_B_ID]) {
      await CompanyManager.resetDisposableTestCompanyWorkspace(cid);
    }
  });

  it('1. Scenarios 1, 5 & 7: Posts January opening balances, January revenue/expenses, and draft/unposted entries; verifies strict January period-scoped reports', async () => {
    await dbContext.run(dbA, async () => {
      // 1a. Opening Capital Injection on 2026-01-01: ₱1,000,000.00 (100,000,000 centavos)
      janOpeningJeId = await createJournalEntry(
        COMP_A_ID,
        {
          journalNumber: 'JE-2026-01-OPEN',
          entryDate: '2026-01-01',
          description: 'Opening Capital Contribution',
          accountingPeriodId: PER_JAN_A,
          createdBy: BOOKKEEPER_A_ID,
          userRole: 'Company Owner',
        },
        [
          { accountId: ACC_CASH_A, debit: 100_000_000, credit: 0, description: 'Initial Cash Deposit' },
          { accountId: ACC_EQ_A, debit: 0, credit: 100_000_000, description: 'Subscribed Share Capital' },
        ]
      );
      await submitJournalEntry(COMP_A_ID, janOpeningJeId, BOOKKEEPER_A_ID);
      await approveJournalEntry(COMP_A_ID, janOpeningJeId, APPROVER_A_ID);
      await postJournalEntry(COMP_A_ID, janOpeningJeId, OWNER_A_ID, 'Company Owner');

      // 1b. January Service Revenue on 2026-01-15: ₱250,000.00 (25,000,000 centavos)
      janRevenueJeId = await createJournalEntry(
        COMP_A_ID,
        {
          journalNumber: 'JE-2026-01-REV01',
          entryDate: '2026-01-15',
          description: 'January Consulting Revenue',
          accountingPeriodId: PER_JAN_A,
          createdBy: BOOKKEEPER_A_ID,
          userRole: 'Company Owner',
        },
        [
          { accountId: ACC_AR_A, debit: 25_000_000, credit: 0, description: 'AR Billing Jan' },
          { accountId: ACC_REV_A, debit: 0, credit: 25_000_000, description: 'Service Revenue Jan' },
        ]
      );
      await submitJournalEntry(COMP_A_ID, janRevenueJeId, BOOKKEEPER_A_ID);
      await approveJournalEntry(COMP_A_ID, janRevenueJeId, APPROVER_A_ID);
      await postJournalEntry(COMP_A_ID, janRevenueJeId, OWNER_A_ID, 'Company Owner');

      // 1c. January Operating Expense on 2026-01-20: ₱80,000.00 (8,000,000 centavos)
      janExpenseJeId = await createJournalEntry(
        COMP_A_ID,
        {
          journalNumber: 'JE-2026-01-EXP01',
          entryDate: '2026-01-20',
          description: 'January Office Rent Expense',
          accountingPeriodId: PER_JAN_A,
          createdBy: BOOKKEEPER_A_ID,
          userRole: 'Company Owner',
        },
        [
          { accountId: ACC_EXP_A, debit: 8_000_000, credit: 0, description: 'Office Rent Jan' },
          { accountId: ACC_AP_A, debit: 0, credit: 8_000_000, description: 'AP Rent Jan' },
        ]
      );
      await submitJournalEntry(COMP_A_ID, janExpenseJeId, BOOKKEEPER_A_ID);
      await approveJournalEntry(COMP_A_ID, janExpenseJeId, APPROVER_A_ID);
      await postJournalEntry(COMP_A_ID, janExpenseJeId, OWNER_A_ID, 'Company Owner');

      // 1d. Scenario 7: Create DRAFT, SUBMITTED, and APPROVED (unposted) entries in January — MUST BE EXCLUDED
      const draftId = await createJournalEntry(
        COMP_A_ID,
        {
          journalNumber: 'JE-2026-01-DRAFT',
          entryDate: '2026-01-25',
          description: 'Unposted Draft Entry',
          accountingPeriodId: PER_JAN_A,
          createdBy: BOOKKEEPER_A_ID,
        },
        [
          { accountId: ACC_EXP_A, debit: 50_000_000, credit: 0, description: 'Draft Expense' },
          { accountId: ACC_CASH_A, debit: 0, credit: 50_000_000, description: 'Draft Cash' },
        ]
      );
      expect(draftId).toBeTruthy();

      const approvedUnpostedId = await createJournalEntry(
        COMP_A_ID,
        {
          journalNumber: 'JE-2026-01-APPROVED-UNPOSTED',
          entryDate: '2026-01-26',
          description: 'Approved But Unposted Entry',
          accountingPeriodId: PER_JAN_A,
          createdBy: BOOKKEEPER_A_ID,
        },
        [
          { accountId: ACC_EXP_A, debit: 30_000_000, credit: 0, description: 'Approved Unposted Expense' },
          { accountId: ACC_CASH_A, debit: 0, credit: 30_000_000, description: 'Approved Unposted Cash' },
        ]
      );
      await submitJournalEntry(COMP_A_ID, approvedUnpostedId, BOOKKEEPER_A_ID);
      await approveJournalEntry(COMP_A_ID, approvedUnpostedId, APPROVER_A_ID);
    });

    // Query January Trial Balance via API with explicit accountingPeriodId
    const tbJanRes = await request(app)
      .get(`/api/reports/trial-balance?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(tbJanRes.status).toBe(200);

    const tbJan = tbJanRes.body as any[];
    const totalJanDebit = tbJan.reduce((s, r) => s + r.debitTotal, 0);
    const totalJanCredit = tbJan.reduce((s, r) => s + r.creditTotal, 0);
    // 100,000,000 + 25,000,000 + 8,000,000 = 133,000,000 centavos (DRAFT & APPROVED unposted excluded)
    expect(totalJanDebit).toBe(133_000_000);
    expect(totalJanCredit).toBe(133_000_000);

    // Query January Income Statement
    const isJanRes = await request(app)
      .get(`/api/reports/income-statement?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(isJanRes.status).toBe(200);
    expect(isJanRes.body.totalRevenue).toBe(25_000_000);
    expect(isJanRes.body.totalExpense).toBe(8_000_000);
    expect(isJanRes.body.netIncome).toBe(17_000_000);
    expect(isJanRes.body.accountingPeriodId).toBe(PER_JAN_A);

    // Query January Balance Sheet
    const bsJanRes = await request(app)
      .get(`/api/reports/balance-sheet?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(bsJanRes.status).toBe(200);
    // Assets: Cash 100,000,000 + AR 25,000,000 = 125,000,000
    // Liabilities: AP 8,000,000
    // Equity: Capital 100,000,000 + Net Income 17,000,000 = 117,000,000
    expect(bsJanRes.body.totalAssets).toBe(125_000_000);
    expect(bsJanRes.body.totalLiabilities).toBe(8_000_000);
    expect(bsJanRes.body.totalEquity).toBe(117_000_000);
    expect(bsJanRes.body.accountingEquationDiscrepancy).toBe(0);
    expect(bsJanRes.body.balanced).toBe(true);
  });

  it('2. Scenarios 2, 3 & 5: Posts February transactions and verifies strict period separation, opening/brought-forward balances, and cumulative/YTD modes', async () => {
    await dbContext.run(dbA, async () => {
      // 2a. February Service Revenue on 2026-02-10: ₱400,000.00 (40,000,000 centavos) collected in Cash
      febRevenueJeId = await createJournalEntry(
        COMP_A_ID,
        {
          journalNumber: 'JE-2026-02-REV01',
          entryDate: '2026-02-10',
          description: 'February Consulting Revenue (Cash)',
          accountingPeriodId: PER_FEB_A,
          createdBy: BOOKKEEPER_A_ID,
          userRole: 'Company Owner',
        },
        [
          { accountId: ACC_CASH_A, debit: 40_000_000, credit: 0, description: 'Cash Collection Feb' },
          { accountId: ACC_REV_A, debit: 0, credit: 40_000_000, description: 'Service Revenue Feb' },
        ]
      );
      await submitJournalEntry(COMP_A_ID, febRevenueJeId, BOOKKEEPER_A_ID);
      await approveJournalEntry(COMP_A_ID, febRevenueJeId, APPROVER_A_ID);
      await postJournalEntry(COMP_A_ID, febRevenueJeId, OWNER_A_ID, 'Company Owner');

      // 2b. February Expense on 2026-02-18: ₱120,000.00 (12,000,000 centavos) paid in Cash
      febExpenseJeId = await createJournalEntry(
        COMP_A_ID,
        {
          journalNumber: 'JE-2026-02-EXP01',
          entryDate: '2026-02-18',
          description: 'February Operating Expense',
          accountingPeriodId: PER_FEB_A,
          createdBy: BOOKKEEPER_A_ID,
          userRole: 'Company Owner',
        },
        [
          { accountId: ACC_EXP_A, debit: 12_000_000, credit: 0, description: 'Operating Expense Feb' },
          { accountId: ACC_CASH_A, debit: 0, credit: 12_000_000, description: 'Cash Disbursement Feb' },
        ]
      );
      await submitJournalEntry(COMP_A_ID, febExpenseJeId, BOOKKEEPER_A_ID);
      await approveJournalEntry(COMP_A_ID, febExpenseJeId, APPROVER_A_ID);
      await postJournalEntry(COMP_A_ID, febExpenseJeId, OWNER_A_ID, 'Company Owner');
    });

    // A. Re-verify January report: February transactions MUST NOT leak into January!
    const isJanAfterFeb = await request(app)
      .get(`/api/reports/income-statement?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(isJanAfterFeb.status).toBe(200);
    expect(isJanAfterFeb.body.totalRevenue).toBe(25_000_000);
    expect(isJanAfterFeb.body.totalExpense).toBe(8_000_000);
    expect(isJanAfterFeb.body.netIncome).toBe(17_000_000);

    const bsJanAfterFeb = await request(app)
      .get(`/api/reports/balance-sheet?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(bsJanAfterFeb.status).toBe(200);
    expect(bsJanAfterFeb.body.totalAssets).toBe(125_000_000);
    expect(bsJanAfterFeb.body.totalLiabilities).toBe(8_000_000);
    expect(bsJanAfterFeb.body.totalEquity).toBe(117_000_000);

    // B. Verify February-only Income Statement: January transactions MUST NOT leak into February P&L!
    const isFebRes = await request(app)
      .get(`/api/reports/income-statement?accountingPeriodId=${PER_FEB_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(isFebRes.status).toBe(200);
    expect(isFebRes.body.totalRevenue).toBe(40_000_000);
    expect(isFebRes.body.totalExpense).toBe(12_000_000);
    expect(isFebRes.body.netIncome).toBe(28_000_000);

    // C. Verify February Trial Balance includes brought-forward opening balances from January + February movement = closing balances
    const tbFebRes = await request(app)
      .get(`/api/reports/trial-balance?accountingPeriodId=${PER_FEB_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(tbFebRes.status).toBe(200);
    const cashRowFeb = (tbFebRes.body as any[]).find((r) => r.accountCode === '1010');
    expect(cashRowFeb).toBeDefined();
    expect(cashRowFeb.openingDebit).toBe(100_000_000);
    expect(cashRowFeb.openingCredit).toBe(0);
    expect(cashRowFeb.openingNetBalance).toBe(100_000_000);
    expect(cashRowFeb.periodDebit).toBe(40_000_000);
    expect(cashRowFeb.periodCredit).toBe(12_000_000);
    expect(cashRowFeb.periodNetMovement).toBe(28_000_000);
    expect(cashRowFeb.closingNetBalance).toBe(128_000_000);

    // D. Verify February General Ledger brought-forward openingBalance and runningBalance on Cash (1010)
    const glFebRes = await request(app)
      .get(`/api/reports/general-ledger?accountingPeriodId=${PER_FEB_A}&accountId=${ACC_CASH_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(glFebRes.status).toBe(200);
    expect(glFebRes.body).toHaveLength(2);
    expect(glFebRes.body[0].openingBalance).toBe(100_000_000);
    expect(glFebRes.body[0].runningBalance).toBe(140_000_000); // 100M + 40M
    expect(glFebRes.body[1].runningBalance).toBe(128_000_000); // 140M - 12M

    // E. Verify February Balance Sheet splits retainedEarningsBroughtForward (Jan 17M) and retainedEarningsCurrentPeriod (Feb 28M)
    const bsFebRes = await request(app)
      .get(`/api/reports/balance-sheet?accountingPeriodId=${PER_FEB_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(bsFebRes.status).toBe(200);
    // Assets as of Feb 28: Cash 128M + AR 25M = 153,000,000
    // Liabilities as of Feb 28: AP 8,000,000
    // Equity as of Feb 28: Capital 100M + Jan RE 17M + Feb NI 28M = 145,000,000
    expect(bsFebRes.body.totalAssets).toBe(153_000_000);
    expect(bsFebRes.body.totalLiabilities).toBe(8_000_000);
    expect(bsFebRes.body.retainedEarningsBroughtForward).toBe(17_000_000);
    expect(bsFebRes.body.retainedEarningsCurrentPeriod).toBe(28_000_000);
    expect(bsFebRes.body.netIncome).toBe(45_000_000);
    expect(bsFebRes.body.totalEquity).toBe(145_000_000);
    expect(bsFebRes.body.accountingEquationDiscrepancy).toBe(0);
    expect(bsFebRes.body.balanced).toBe(true);

    // F. Verify YTD Income Statement as of February (`mode=ytd`) combines Jan + Feb
    const isYtdRes = await request(app)
      .get(`/api/reports/income-statement?accountingPeriodId=${PER_FEB_A}&mode=ytd`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(isYtdRes.status).toBe(200);
    expect(isYtdRes.body.totalRevenue).toBe(65_000_000); // 25M + 40M
    expect(isYtdRes.body.totalExpense).toBe(20_000_000); // 8M + 12M
    expect(isYtdRes.body.netIncome).toBe(45_000_000); // 17M + 28M

    // G. Verify Account Schedule preserves zero-activity accounts (6090) in February without dropping them
    const schedFebRes = await request(app)
      .get(`/api/reports/account-schedule?accountingPeriodId=${PER_FEB_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(schedFebRes.status).toBe(200);
    expect(schedFebRes.body).toHaveLength(7); // All 7 accounts in COA preserved
    const zeroAcc = (schedFebRes.body as any[]).find((a) => a.accountCode === '6090');
    expect(zeroAcc).toBeDefined();
    expect(zeroAcc.totalDebit).toBe(0);
    expect(zeroAcc.totalCredit).toBe(0);
    expect(zeroAcc.closingBalance).toBe(0);
  });

  it('3. Scenario 4: Rejects period-date mismatches on creation/posting and blocks backdated entries on or before company lockDate', async () => {
    await dbContext.run(dbA, async () => {
      // 3a. Attempt to create a journal entry dated in January ('2026-01-15') but assigned to February period (PER_FEB_A)
      await expect(
        createJournalEntry(
          COMP_A_ID,
          {
            journalNumber: 'JE-MISMATCH-01',
            entryDate: '2026-01-15',
            description: 'Mismatched Date vs Period',
            accountingPeriodId: PER_FEB_A,
            createdBy: BOOKKEEPER_A_ID,
          },
          [
            { accountId: ACC_EXP_A, debit: 1_000_000, credit: 0 },
            { accountId: ACC_CASH_A, debit: 0, credit: 1_000_000 },
          ]
        )
      ).rejects.toThrow(/does not fall within the specified accounting period/i);

      // 3b. Set company lockDate to '2026-01-10' and verify backdated posting on '2026-01-05' is rejected
      await db
        .update(schema.companies)
        .set({ lockDate: '2026-01-10' })
        .where(eq(schema.companies.id, COMP_A_ID));

      await expect(
        createJournalEntry(
          COMP_A_ID,
          {
            journalNumber: 'JE-BACKDATED-LOCKED-01',
            entryDate: '2026-01-05',
            description: 'Backdated before lockDate',
            accountingPeriodId: PER_JAN_A,
            createdBy: OWNER_A_ID,
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_EXP_A, debit: 500_000, credit: 0 },
            { accountId: ACC_CASH_A, debit: 0, credit: 500_000 },
          ]
        )
      ).rejects.toThrow(/on or before company lock date/i);

      // Clear lockDate after test
      await db
        .update(schema.companies)
        .set({ lockDate: null })
        .where(eq(schema.companies.id, COMP_A_ID));
    });

    // 3c. Verify API rejects mismatched startDate/endDate outside accountingPeriodId
    const badRangeRes = await request(app)
      .get(`/api/reports/trial-balance?accountingPeriodId=${PER_JAN_A}&startDate=2026-01-01&endDate=2026-02-15`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(badRangeRes.status).toBe(400);
    expect(badRangeRes.body.error).toBe('PERIOD_DATE_MISMATCH');
  });

  it('4. Section 2 & Scenario 6: Validates complete Journal Reversal Lifecycle, 0 net effect for same-period reversals, cross-period reversal reconciliation, double-reversal rejection, RBAC guard, and 360 lineage', async () => {
    await dbContext.run(dbA, async () => {
      // 4a. Post a ₱50,000.00 (5,000,000 centavos) expense in January and reverse it in January
      janSamePeriodRevOrigId = await createJournalEntry(
        COMP_A_ID,
        {
          journalNumber: 'JE-2026-01-ERR01',
          entryDate: '2026-01-22',
          description: 'Accrued Expense to be Reversed in Jan',
          accountingPeriodId: PER_JAN_A,
          createdBy: BOOKKEEPER_A_ID,
          userRole: 'Company Owner',
        },
        [
          { accountId: ACC_EXP_A, debit: 5_000_000, credit: 0, description: 'Erroneous Rent Accrual' },
          { accountId: ACC_AP_A, debit: 0, credit: 5_000_000, description: 'Erroneous AP Accrual' },
        ]
      );
      await submitJournalEntry(COMP_A_ID, janSamePeriodRevOrigId, BOOKKEEPER_A_ID);
      await approveJournalEntry(COMP_A_ID, janSamePeriodRevOrigId, APPROVER_A_ID);
      await postJournalEntry(COMP_A_ID, janSamePeriodRevOrigId, OWNER_A_ID, 'Company Owner');

      // 4b. Verify unauthorized roles (Bookkeeper, Viewer, External Auditor) cannot reverse a posted journal
      await expect(
        reverseJournalEntry(
          COMP_A_ID,
          janSamePeriodRevOrigId,
          BOOKKEEPER_A_ID,
          '2026-01-23',
          PER_JAN_A,
          'Bookkeeper'
        )
      ).rejects.toThrow(/not authorized to reverse/i);

      // 4c. Authorized reversal by Company Owner in January
      janSamePeriodRevChildId = await reverseJournalEntry(
        COMP_A_ID,
        janSamePeriodRevOrigId,
        OWNER_A_ID,
        '2026-01-23',
        PER_JAN_A,
        'Company Owner'
      );
      expect(janSamePeriodRevChildId).toBeTruthy();

      // 4d. Verify original entry is REVERSED and reversal entry is POSTED with originalJournalId linkage
      const origEntry = await db
        .select()
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.id, janSamePeriodRevOrigId))
        .get();
      const revEntry = await db
        .select()
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.id, janSamePeriodRevChildId))
        .get();

      expect(origEntry?.status).toBe('REVERSED');
      expect(origEntry?.reversedAt).toBeTruthy();
      expect(revEntry?.status).toBe('POSTED');
      expect(revEntry?.journalNumber).toBe('JE-2026-01-ERR01-REV');
      expect(revEntry?.originalJournalId).toBe(janSamePeriodRevOrigId);
      expect(revEntry?.accountingPeriodId).toBe(PER_JAN_A);
      expect(revEntry?.sourceType).toBe('REVERSAL');

      // 4e. Verify double-reversal of original entry is rejected AND reversing the reversal entry itself is rejected
      await expect(
        reverseJournalEntry(
          COMP_A_ID,
          janSamePeriodRevOrigId,
          OWNER_A_ID,
          '2026-01-24',
          PER_JAN_A,
          'Company Owner'
        )
      ).rejects.toThrow(/Only POSTED entries can be reversed/i);

      await expect(
        reverseJournalEntry(
          COMP_A_ID,
          janSamePeriodRevChildId,
          OWNER_A_ID,
          '2026-01-24',
          PER_JAN_A,
          'Company Owner'
        )
      ).rejects.toThrow(/Cannot reverse a reversal journal entry directly/i);
    });

    // 4f. CRITICAL CHECK: Verify January Income Statement and Balance Sheet have ZERO net distortion from the reversed pair!
    const isJanAfterRev = await request(app)
      .get(`/api/reports/income-statement?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(isJanAfterRev.status).toBe(200);
    // Must still be exact: Revenue 25,000,000, Expense 8,000,000, Net Income 17,000,000 (NOT 8M - 5M = 3M!)
    expect(isJanAfterRev.body.totalRevenue).toBe(25_000_000);
    expect(isJanAfterRev.body.totalExpense).toBe(8_000_000);
    expect(isJanAfterRev.body.netIncome).toBe(17_000_000);

    const bsJanAfterRev = await request(app)
      .get(`/api/reports/balance-sheet?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(bsJanAfterRev.status).toBe(200);
    expect(bsJanAfterRev.body.totalAssets).toBe(125_000_000);
    expect(bsJanAfterRev.body.totalLiabilities).toBe(8_000_000);
    expect(bsJanAfterRev.body.totalEquity).toBe(117_000_000);
    expect(bsJanAfterRev.body.accountingEquationDiscrepancy).toBe(0);

    // 4g. Verify Record Journey 360 bidirectional lineage between original and reversal
    const orig360 = await request(app)
      .get(`/api/journey/360/JOURNAL_ENTRY/${janSamePeriodRevOrigId}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(orig360.status).toBe(200);
    expect(orig360.body.record.status).toBe('REVERSED');
    const revRel = orig360.body.relatedRecords.find((r: any) => r.relationship === 'REVERSAL_JOURNAL');
    expect(revRel).toBeDefined();
    expect(revRel.id).toBe(janSamePeriodRevChildId);

    const rev360 = await request(app)
      .get(`/api/journey/360/JOURNAL_ENTRY/${janSamePeriodRevChildId}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(rev360.status).toBe(200);
    expect(rev360.body.record.status).toBe('POSTED');
    const origRel = rev360.body.relatedRecords.find((r: any) => r.relationship === 'ORIGINAL_TRANSACTION');
    expect(origRel).toBeDefined();
    expect(origRel.id).toBe(janSamePeriodRevOrigId);
  });

  it('5. Scenario 8: Enforces strict cross-company isolation on all report routes and period IDs', async () => {
    // Company A querying its own reports never sees Company B's ₱9,999,999.00
    const summaryARes = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(summaryARes.status).toBe(200);
    expect(summaryARes.body.totalRevenue).toBe(65_000_000); // Only Company A's 25M + 40M

    // Company A attempting to filter by Company B's accountingPeriodId (PER_JAN_B) is rejected with 400 INVALID_ACCOUNTING_PERIOD
    const crossPeriodRes = await request(app)
      .get(`/api/reports/trial-balance?accountingPeriodId=${PER_JAN_B}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(crossPeriodRes.status).toBe(400);
    expect(crossPeriodRes.body.error).toBe('INVALID_ACCOUNTING_PERIOD');
  });

  it('6. Scenario 9: Validates period soft-close, hard-close, and authorized reopening controls with audit logging', async () => {
    await dbContext.run(dbA, async () => {
      // 6a. Soft-close January 2026
      await softClosePeriod(COMP_A_ID, PER_JAN_A, OWNER_A_ID, 'Month-end soft close for review');

      // Standard user (Bookkeeper) cannot post into SOFT_CLOSED period
      await expect(
        createJournalEntry(
          COMP_A_ID,
          {
            journalNumber: 'JE-SOFT-BLOCKED-01',
            entryDate: '2026-01-28',
            description: 'Unauthorized posting in soft-closed period',
            accountingPeriodId: PER_JAN_A,
            createdBy: BOOKKEEPER_A_ID,
            userRole: 'Bookkeeper',
          },
          [
            { accountId: ACC_EXP_A, debit: 100_000, credit: 0 },
            { accountId: ACC_CASH_A, debit: 0, credit: 100_000 },
          ]
        )
      ).rejects.toThrow(/SOFT_CLOSED/i);

      // 6b. Hard-close January 2026
      await hardClosePeriod(COMP_A_ID, PER_JAN_A, OWNER_A_ID, 'Final CPA audited hard close');

      // Even Company Owner cannot post into HARD_CLOSED period without reopening
      await expect(
        createJournalEntry(
          COMP_A_ID,
          {
            journalNumber: 'JE-HARD-BLOCKED-01',
            entryDate: '2026-01-29',
            description: 'Blocked posting in hard-closed period',
            accountingPeriodId: PER_JAN_A,
            createdBy: OWNER_A_ID,
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_EXP_A, debit: 100_000, credit: 0 },
            { accountId: ACC_CASH_A, debit: 0, credit: 100_000 },
          ]
        )
      ).rejects.toThrow(/HARD_CLOSED/i);

      // 6c. Reopen period requires mandatory non-empty reason
      await expect(
        reopenPeriod(COMP_A_ID, PER_JAN_A, OWNER_A_ID, '   ')
      ).rejects.toThrow(/non-empty reason is mandatory/i);

      await reopenPeriod(
        COMP_A_ID,
        PER_JAN_A,
        OWNER_A_ID,
        'Authorized reopening for post-audit reclassification test'
      );

      const reopenedPeriod = await db
        .select()
        .from(schema.accountingPeriods)
        .where(eq(schema.accountingPeriods.id, PER_JAN_A))
        .get();
      expect(reopenedPeriod?.status).toBe('OPEN');
    });
  });

  it('7. Section 3: Verifies encrypted database.lai (LAISENC2) snapshot recovery into an isolated scratch workspace and confirms 0 variance on explicit period-filtered January SQL', async () => {
    // 1. Sync Company A to encrypted database.lai (LAISENC2)
    await CompanyManager.syncCompanyDatabaseSnapshot(COMP_A_ID);

    const compADir = path.join(paths.getCompaniesRootDir(), COMP_A_ID);
    const laiPath = path.join(compADir, 'database.lai');
    expect(fs.existsSync(laiPath)).toBe(true);

    const laiMagic = fs.readFileSync(laiPath).subarray(0, 8).toString('ascii');
    expect(laiMagic).toBe('LAISENC2');

    // 2. Decrypt database.lai into an isolated scratch file without touching Company A's active DB
    const scratchDir = path.join(paths.getTempDir(), `scratch-recovery-${Date.now()}`);
    fs.mkdirSync(scratchDir, { recursive: true });
    const scratchSqlitePath = path.join(scratchDir, 'recovered_scratch.sqlite');

    try {
      DatabaseEncryptionService.decryptDatabaseFileSync(laiPath, scratchSqlitePath);
      expect(fs.existsSync(scratchSqlitePath)).toBe(true);

      const Database = (await import('better-sqlite3')).default;
      const scratchDb = new Database(scratchSqlitePath, { readonly: true });

      try {
        const integrity = scratchDb.pragma('integrity_check', { simple: true });
        expect(integrity).toBe('ok');

        // Compare Explicit Period-Scoped January Trial Balance SQL against January-only posted rows
        const explicitJanRows = scratchDb
          .prepare(
            `SELECT
               a.account_code AS accountCode,
               a.account_name AS accountName,
               a.account_type AS accountType,
               a.normal_balance AS normalBalance,
               COALESCE(SUM(jl.debit), 0) AS grossDebit,
               COALESCE(SUM(jl.credit), 0) AS grossCredit
             FROM accounts a
             INNER JOIN journal_lines jl ON jl.account_id = a.id
             INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
             WHERE a.company_id = ?
               AND je.company_id = ?
               AND je.accounting_period_id = ?
               AND je.entry_date >= '2026-01-01'
               AND je.entry_date <= '2026-01-31'
               AND (
                 je.status = 'POSTED'
                 OR (
                   je.status = 'REVERSED'
                   AND EXISTS (
                     SELECT 1 FROM journal_entries rev_je
                     WHERE rev_je.company_id = je.company_id
                       AND rev_je.original_journal_id = je.id
                       AND rev_je.status = 'POSTED'
                   )
                 )
               )
             GROUP BY a.id
             ORDER BY a.account_code ASC`
          )
          .all(COMP_A_ID, COMP_A_ID, PER_JAN_A) as Array<{
          accountCode: string;
          accountName: string;
          accountType: string;
          normalBalance: string;
          grossDebit: number;
          grossCredit: number;
        }>;

        // Gross Debit/Credit in Jan includes: 100M opening + 25M rev + 8M exp + 5M orig rev + 5M child rev = 143,000,000
        const grossDebitSum = explicitJanRows.reduce((s, r) => s + r.grossDebit, 0);
        const grossCreditSum = explicitJanRows.reduce((s, r) => s + r.grossCredit, 0);
        expect(grossDebitSum).toBe(143_000_000);
        expect(grossCreditSum).toBe(143_000_000);

        // Net Trial Balance in Jan: Cash 100M DR + AR 25M DR + Exp 8M DR = 133,000,000 DR; AP 8M CR + Eq 100M CR + Rev 25M CR = 133,000,000 CR
        let netTbDebit = 0;
        let netTbCredit = 0;
        for (const r of explicitJanRows) {
          const diff = r.grossDebit - r.grossCredit;
          if (diff > 0) netTbDebit += diff;
          else if (diff < 0) netTbCredit += Math.abs(diff);
        }
        expect(netTbDebit).toBe(133_000_000);
        expect(netTbCredit).toBe(133_000_000);
      } finally {
        scratchDb.close();
      }
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('8. Section 1 (Opening Balance & Brought-Forward Validation): Distinguishes 2026-01-01 OPENING_BALANCE journal vs 2026-01-01 operational transaction, includes opening balances once, blocks/excludes P&L opening balances, carries all Jan closing balances into Feb opening (including zero-Feb-movement accounts), and validates period close & reopening non-duplication', async () => {
    const COMP_OB_ID = 'LGR-PH-TEST-OPENING-EDGE-01';
    const PER_2025_DEC = 'per-ob-2025-12';
    const PER_2026_JAN = 'per-ob-2026-01';
    const PER_2026_FEB = 'per-ob-2026-02';
    const ACC_OB_CASH = 'acc-ob-1010';
    const ACC_OB_AR = 'acc-ob-1030';
    const ACC_OB_AP = 'acc-ob-2010';
    const ACC_OB_EQ = 'acc-ob-3010';
    const ACC_OB_RE = 'acc-ob-3020';
    const ACC_OB_REV = 'acc-ob-4010';
    const ACC_OB_EXP = 'acc-ob-6010';
    let obToken = '';

    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_OB_ID);
    await CompanyManager.createCompanyProfile(
      COMP_OB_ID,
      'Opening Balance & Brought-Forward Validation Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    const dbOb = await CompanyManager.getCompanyDb(COMP_OB_ID);
    const sqliteOb = await CompanyManager.getCompanySqlite(COMP_OB_ID);

    try {
      await dbContext.run(dbOb, async () => {
        await RbacService.ensureRoleTemplatesSeeded();
        sqliteOb.prepare(`DELETE FROM accounting_periods WHERE company_id = ?`).run(COMP_OB_ID);
        sqliteOb.prepare(`DELETE FROM accounts WHERE company_id = ?`).run(COMP_OB_ID);

        await db
          .insert(schema.users)
          .values([
            {
              id: 'usr-ob-owner',
              email: 'owner@obtest.ph',
              displayName: 'OB Owner',
              passwordHash: 'test_hash',
              status: 'ACTIVE',
            },
            {
              id: 'usr-ob-approver',
              email: 'approver@obtest.ph',
              displayName: 'OB Approver',
              passwordHash: 'test_hash',
              status: 'ACTIVE',
            },
          ])
          .onConflictDoNothing();

        const roleRec = await RbacService.ensureRoleRecord('Company Owner');
        await db
          .insert(schema.companyUsers)
          .values({
            id: 'mem-ob-owner',
            userId: 'usr-ob-owner',
            companyId: COMP_OB_ID,
            roleId: roleRec.id,
            legacyRole: 'Company Owner',
            status: 'ACTIVE',
            membershipStatus: 'ACTIVE',
            defaultDataScope: 'COMPANY_WIDE',
          })
          .onConflictDoNothing();
        await RbacService.setMemberRoles(null, 'mem-ob-owner', ['Company Owner'], 'Seed OB Owner');

        const rawSession = crypto.randomBytes(32).toString('hex');
        await db.insert(schema.sessions).values({
          id: hashToken(rawSession),
          userId: 'usr-ob-owner',
          companyId: COMP_OB_ID,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        obToken = `${COMP_OB_ID}.${rawSession}`;

        await db.insert(schema.accountingPeriods).values([
          {
            id: PER_2025_DEC,
            companyId: COMP_OB_ID,
            name: 'December 2025',
            startDate: '2025-12-01',
            endDate: '2025-12-31',
            fiscalYear: 2025,
            status: 'OPEN',
          },
          {
            id: PER_2026_JAN,
            companyId: COMP_OB_ID,
            name: 'January 2026',
            startDate: '2026-01-01',
            endDate: '2026-01-31',
            fiscalYear: 2026,
            status: 'OPEN',
          },
          {
            id: PER_2026_FEB,
            companyId: COMP_OB_ID,
            name: 'February 2026',
            startDate: '2026-02-01',
            endDate: '2026-02-28',
            fiscalYear: 2026,
            status: 'OPEN',
          },
        ]);

        await db.insert(schema.accounts).values([
          {
            id: ACC_OB_CASH,
            companyId: COMP_OB_ID,
            accountCode: '1010',
            accountName: 'Cash in Bank',
            accountType: 'ASSET',
            normalBalance: 'DEBIT',
            isCashAccount: true,
            status: 'ACTIVE',
          },
          {
            id: ACC_OB_AR,
            companyId: COMP_OB_ID,
            accountCode: '1030',
            accountName: 'Accounts Receivable',
            accountType: 'RECEIVABLE',
            normalBalance: 'DEBIT',
            status: 'ACTIVE',
          },
          {
            id: ACC_OB_AP,
            companyId: COMP_OB_ID,
            accountCode: '2010',
            accountName: 'Accounts Payable',
            accountType: 'PAYABLE',
            normalBalance: 'CREDIT',
            status: 'ACTIVE',
          },
          {
            id: ACC_OB_EQ,
            companyId: COMP_OB_ID,
            accountCode: '3010',
            accountName: 'Subscribed Share Capital',
            accountType: 'EQUITY',
            normalBalance: 'CREDIT',
            status: 'ACTIVE',
          },
          {
            id: ACC_OB_RE,
            companyId: COMP_OB_ID,
            accountCode: '3020',
            accountName: 'Retained Earnings',
            accountType: 'EQUITY',
            normalBalance: 'CREDIT',
            status: 'ACTIVE',
          },
          {
            id: ACC_OB_REV,
            companyId: COMP_OB_ID,
            accountCode: '4010',
            accountName: 'Service Revenue',
            accountType: 'REVENUE',
            normalBalance: 'CREDIT',
            status: 'ACTIVE',
          },
          {
            id: ACC_OB_EXP,
            companyId: COMP_OB_ID,
            accountCode: '6010',
            accountName: 'Operating Expense',
            accountType: 'EXPENSE',
            normalBalance: 'DEBIT',
            status: 'ACTIVE',
          },
        ]);

        const postFullOb = async (jeId: string) => {
          await submitJournalEntry(COMP_OB_ID, jeId, 'usr-ob-owner');
          await approveJournalEntry(COMP_OB_ID, jeId, 'usr-ob-approver');
          await postJournalEntry(COMP_OB_ID, jeId, 'usr-ob-owner', 'Company Owner');
        };

        // 8a. Reject OPENING_BALANCE journal that attempts to post directly to a temporary P&L account (REVENUE or EXPENSE)
        await expect(
          createJournalEntry(
            COMP_OB_ID,
            {
              journalNumber: 'JE-OB-INVALID-PNL',
              entryDate: '2026-01-01',
              description: 'Invalid Opening Balance on Revenue',
              accountingPeriodId: PER_2026_JAN,
              sourceType: 'OPENING_BALANCE',
              createdBy: 'usr-ob-owner',
              userRole: 'Company Owner',
            },
            [
              { accountId: ACC_OB_CASH, debit: 10_000_000, credit: 0 },
              { accountId: ACC_OB_REV, debit: 0, credit: 10_000_000 },
            ]
          )
        ).rejects.toThrow(/Opening balance journals cannot post directly to current-period income\/expense account/i);

        // 8b. Post a prior-period (2025-12-31) transaction generating Retained Earnings brought forward into 2026:
        // Service Revenue 20,000,000 CR, Operating Expense 5,000,000 DR -> Net Cash +15,000,000 DR, Prior Net Income +15,000,000 CR
        const decJeId = await createJournalEntry(
          COMP_OB_ID,
          {
            journalNumber: 'JE-2025-12-OP',
            entryDate: '2025-12-31',
            description: 'Dec 2025 Prior Year Operations',
            accountingPeriodId: PER_2025_DEC,
            createdBy: 'usr-ob-owner',
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_OB_CASH, debit: 15_000_000, credit: 0, description: 'Dec Cash Net' },
            { accountId: ACC_OB_EXP, debit: 5_000_000, credit: 0, description: 'Dec Expense' },
            { accountId: ACC_OB_REV, debit: 0, credit: 20_000_000, description: 'Dec Revenue' },
          ]
        );
        await postFullOb(decJeId);

        // 8c. Post an explicit OPENING_BALANCE journal dated 2026-01-01 (sourceType = 'OPENING_BALANCE'):
        // Cash 50,000,000 DR, AR 10,000,000 DR, AP 4,000,000 CR, Share Capital 56,000,000 CR
        const obJanJeId = await createJournalEntry(
          COMP_OB_ID,
          {
            journalNumber: 'JE-2026-01-OB',
            entryDate: '2026-01-01',
            description: '2026-01-01 Explicit Opening Balance Journal',
            accountingPeriodId: PER_2026_JAN,
            sourceType: 'OPENING_BALANCE',
            createdBy: 'usr-ob-owner',
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_OB_CASH, debit: 50_000_000, credit: 0, description: 'Opening Cash' },
            { accountId: ACC_OB_AR, debit: 10_000_000, credit: 0, description: 'Opening AR' },
            { accountId: ACC_OB_AP, debit: 0, credit: 4_000_000, description: 'Opening AP' },
            { accountId: ACC_OB_EQ, debit: 0, credit: 56_000_000, description: 'Opening Share Capital' },
          ]
        );
        await postFullOb(obJanJeId);

        // 8d. Post a regular operational transaction ALSO dated 2026-01-01 (first day of period, sourceType = 'MANUAL_JOURNAL'):
        // Cash 12,000,000 DR, Service Revenue 12,000,000 CR
        const firstDayOpJeId = await createJournalEntry(
          COMP_OB_ID,
          {
            journalNumber: 'JE-2026-01-DAY1-OP',
            entryDate: '2026-01-01',
            description: 'Jan 1 Operational Consulting Revenue',
            accountingPeriodId: PER_2026_JAN,
            sourceType: 'MANUAL_JOURNAL',
            createdBy: 'usr-ob-owner',
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_OB_CASH, debit: 12_000_000, credit: 0, description: 'Jan 1 Cash Revenue' },
            { accountId: ACC_OB_REV, debit: 0, credit: 12_000_000, description: 'Jan 1 Service Revenue' },
          ]
        );
        await postFullOb(firstDayOpJeId);

        // 8e. Post a mid-January operational expense on 2026-01-31 (last day of period):
        // Expense 3,000,000 DR, Cash 3,000,000 CR
        const lastDayJanJeId = await createJournalEntry(
          COMP_OB_ID,
          {
            journalNumber: 'JE-2026-01-DAY31-EXP',
            entryDate: '2026-01-31',
            description: 'Jan 31 Utility Expense',
            accountingPeriodId: PER_2026_JAN,
            createdBy: 'usr-ob-owner',
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_OB_EXP, debit: 3_000_000, credit: 0, description: 'Jan 31 Expense' },
            { accountId: ACC_OB_CASH, debit: 0, credit: 3_000_000, description: 'Jan 31 Cash Paid' },
          ]
        );
        await postFullOb(lastDayJanJeId);

        // 8f. Post a February operational transaction on 2026-02-01 (first day of Feb):
        // Cash 8,000,000 DR, Service Revenue 8,000,000 CR
        // Note: AR (1030), AP (2010), and Share Capital (3010) have ZERO February transactions!
        const febDay1JeId = await createJournalEntry(
          COMP_OB_ID,
          {
            journalNumber: 'JE-2026-02-DAY1-REV',
            entryDate: '2026-02-01',
            description: 'Feb 1 Service Revenue',
            accountingPeriodId: PER_2026_FEB,
            createdBy: 'usr-ob-owner',
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_OB_CASH, debit: 8_000_000, credit: 0, description: 'Feb 1 Cash' },
            { accountId: ACC_OB_REV, debit: 0, credit: 8_000_000, description: 'Feb 1 Revenue' },
          ]
        );
        await postFullOb(febDay1JeId);
      });

      // Verify 1: In January Trial Balance, Cash (1010) has:
      // - broughtForwardDebit: 15,000,000 (from 2025-12-31)
      // - openingJournalDebit: 50,000,000 (from 2026-01-01 OPENING_BALANCE)
      // - openingDebit: 65,000,000 (15M + 50M)
      // - periodDebit: 12,000,000 (ONLY the 2026-01-01 operational transaction; OPENING_BALANCE is NOT duplicated in periodDebit!)
      // - periodCredit: 3,000,000 (2026-01-31 operational expense)
      // - closingNetBalance: 65,000,000 + (12,000,000 - 3,000,000) = 74,000,000 (opening balance included EXACTLY ONCE!)
      const tbJanRes = await request(app)
        .get(`/api/reports/trial-balance?accountingPeriodId=${PER_2026_JAN}`)
        .set('Authorization', `Bearer ${obToken}`);
      expect(tbJanRes.status).toBe(200);
      const cashJan = (tbJanRes.body as any[]).find((r) => r.accountCode === '1010');
      expect(cashJan).toBeDefined();
      expect(cashJan.broughtForwardDebit).toBe(15_000_000);
      expect(cashJan.openingJournalDebit).toBe(50_000_000);
      expect(cashJan.openingDebit).toBe(65_000_000);
      expect(cashJan.periodDebit).toBe(12_000_000);
      expect(cashJan.periodCredit).toBe(3_000_000);
      expect(cashJan.periodNetMovement).toBe(9_000_000);
      expect(cashJan.closingNetBalance).toBe(74_000_000);

      // Verify 2: General Ledger & Transaction Detail in January explicitly distinguish:
      // - JE-2026-01-OB -> 'OPENING_BALANCE_JOURNAL'
      // - JE-2026-01-DAY1-OP -> 'FIRST_DAY_OPERATIONAL_TRANSACTION'
      // - JE-2026-01-DAY31-EXP -> 'PERIOD_OPERATIONAL_TRANSACTION'
      const glJanCashRes = await request(app)
        .get(`/api/reports/general-ledger?accountingPeriodId=${PER_2026_JAN}&accountId=${ACC_OB_CASH}`)
        .set('Authorization', `Bearer ${obToken}`);
      expect(glJanCashRes.status).toBe(200);
      expect(glJanCashRes.body).toHaveLength(3);
      expect(glJanCashRes.body[0].journalNumber).toBe('JE-2026-01-OB');
      expect(glJanCashRes.body[0].entryClassification).toBe('OPENING_BALANCE_JOURNAL');
      expect(glJanCashRes.body[0].broughtForwardBalance).toBe(15_000_000);
      expect(glJanCashRes.body[0].openingJournalBalance).toBe(50_000_000);
      expect(glJanCashRes.body[0].openingBalance).toBe(65_000_000);
      expect(glJanCashRes.body[0].runningBalance).toBe(65_000_000); // 15M + 50M (never double-counted!)

      expect(glJanCashRes.body[1].journalNumber).toBe('JE-2026-01-DAY1-OP');
      expect(glJanCashRes.body[1].entryClassification).toBe('FIRST_DAY_OPERATIONAL_TRANSACTION');
      expect(glJanCashRes.body[1].runningBalance).toBe(77_000_000); // 65M + 12M

      expect(glJanCashRes.body[2].journalNumber).toBe('JE-2026-01-DAY31-EXP');
      expect(glJanCashRes.body[2].entryClassification).toBe('PERIOD_OPERATIONAL_TRANSACTION');
      expect(glJanCashRes.body[2].runningBalance).toBe(74_000_000); // 77M - 3M

      // Verify 3: January Income Statement includes ONLY January operational P&L (12M Rev - 3M Exp = 9M Net Income)
      const isJanRes = await request(app)
        .get(`/api/reports/income-statement?accountingPeriodId=${PER_2026_JAN}`)
        .set('Authorization', `Bearer ${obToken}`);
      expect(isJanRes.status).toBe(200);
      expect(isJanRes.body.totalRevenue).toBe(12_000_000);
      expect(isJanRes.body.totalExpense).toBe(3_000_000);
      expect(isJanRes.body.netIncome).toBe(9_000_000);

      // Verify 4: February Trial Balance preserves ALL accounts with brought-forward balances from January
      // EVEN IF they had ZERO transactions in February (AR 1030, AP 2010, Share Capital 3010)!
      const tbFebRes = await request(app)
        .get(`/api/reports/trial-balance?accountingPeriodId=${PER_2026_FEB}`)
        .set('Authorization', `Bearer ${obToken}`);
      expect(tbFebRes.status).toBe(200);
      const tbFeb = tbFebRes.body as any[];
      const arFeb = tbFeb.find((r) => r.accountCode === '1030');
      const apFeb = tbFeb.find((r) => r.accountCode === '2010');
      const eqFeb = tbFeb.find((r) => r.accountCode === '3010');
      const cashFeb = tbFeb.find((r) => r.accountCode === '1010');

      expect(arFeb).toBeDefined();
      expect(arFeb.openingNetBalance).toBe(10_000_000);
      expect(arFeb.periodDebit).toBe(0);
      expect(arFeb.closingNetBalance).toBe(10_000_000);

      expect(apFeb).toBeDefined();
      expect(apFeb.openingNetBalance).toBe(4_000_000);
      expect(apFeb.periodCredit).toBe(0);
      expect(apFeb.closingNetBalance).toBe(4_000_000);

      expect(eqFeb).toBeDefined();
      expect(eqFeb.openingNetBalance).toBe(56_000_000);
      expect(eqFeb.periodCredit).toBe(0);
      expect(eqFeb.closingNetBalance).toBe(56_000_000);

      expect(cashFeb).toBeDefined();
      expect(cashFeb.openingNetBalance).toBe(74_000_000); // Exact January closing balance!
      expect(cashFeb.periodDebit).toBe(8_000_000);
      expect(cashFeb.closingNetBalance).toBe(82_000_000);

      // Verify every account's February openingNetBalance equals its January closingNetBalance
      for (const janRow of tbJanRes.body as any[]) {
        const febRow = tbFeb.find((r) => r.accountId === janRow.accountId);
        expect(febRow).toBeDefined();
        expect(febRow.openingDebit).toBe(janRow.closingDebit);
        expect(febRow.openingCredit).toBe(janRow.closingCredit);
        expect(febRow.openingNetBalance).toBe(janRow.closingNetBalance);
      }

      // Verify 5: Period Close (performYearEndClose for FY 2025 + softClose + hardClose + reopenPeriod on Jan 2026)
      // does NOT duplicate opening balances or distort 2025/2026 P&L!
      await dbContext.run(dbOb, async () => {
        const yeCloseRes = await performYearEndClose(COMP_OB_ID, 2025, ACC_OB_RE, 'usr-ob-owner');
        expect(yeCloseRes.alreadyClosed).toBe(false);
        expect(yeCloseRes.netIncomeTransferred).toBe(15_000_000); // 20M Rev - 5M Exp

        // Calling performYearEndClose a second time is idempotent
        const yeCloseDup = await performYearEndClose(COMP_OB_ID, 2025, ACC_OB_RE, 'usr-ob-owner');
        expect(yeCloseDup.alreadyClosed).toBe(true);
        expect(yeCloseDup.netIncomeTransferred).toBe(0);

        await softClosePeriod(COMP_OB_ID, PER_2026_JAN, 'usr-ob-owner', 'Soft close Jan');
        await hardClosePeriod(COMP_OB_ID, PER_2026_JAN, 'usr-ob-owner', 'Hard close Jan');
        await reopenPeriod(COMP_OB_ID, PER_2026_JAN, 'usr-ob-owner', 'Reopen Jan to verify no opening balance duplication');
      });

      // Verify FY 2025 Income Statement STILL shows 20M Revenue, 5M Expense, 15M Net Income (YEAR_END_CLOSE entry excluded from operational P&L!)
      const isDec2025Res = await request(app)
        .get(`/api/reports/income-statement?accountingPeriodId=${PER_2025_DEC}`)
        .set('Authorization', `Bearer ${obToken}`);
      expect(isDec2025Res.status).toBe(200);
      expect(isDec2025Res.body.totalRevenue).toBe(20_000_000);
      expect(isDec2025Res.body.totalExpense).toBe(5_000_000);
      expect(isDec2025Res.body.netIncome).toBe(15_000_000);

      // Verify Balance Sheet as of Feb 2026 after 2025 Year-End Close + Jan Close/Reopen is still 100% balanced with 0 duplication
      const bsFebAfterClose = await request(app)
        .get(`/api/reports/balance-sheet?accountingPeriodId=${PER_2026_FEB}`)
        .set('Authorization', `Bearer ${obToken}`);
      expect(bsFebAfterClose.status).toBe(200);
      // Assets: Cash 82M + AR 10M = 92,000,000
      // Liabilities: AP 4,000,000
      // Equity: Share Capital 56M + Retained Earnings (15M from 2025 + 9M Jan + 8M Feb = 32M) = 88,000,000
      expect(bsFebAfterClose.body.totalAssets).toBe(92_000_000);
      expect(bsFebAfterClose.body.totalLiabilities).toBe(4_000_000);
      expect(bsFebAfterClose.body.totalEquity).toBe(88_000_000);
      expect(bsFebAfterClose.body.accountingEquationDiscrepancy).toBe(0);
      expect(bsFebAfterClose.body.balanced).toBe(true);
    } finally {
      await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_OB_ID);
    }
  });

  it('9. Section 2 (Reversal Lifecycle Adversarial Edge Cases 1–15): Validates all 15 adversarial reversal scenarios, SQL-level deduplication/guards, audit history, and 360 consistency', async () => {
    const COMP_REV_ID = 'LGR-PH-TEST-REV-ADVERSARIAL-01';
    const PER_REV_JAN = 'per-rev-2026-01';
    const PER_REV_FEB = 'per-rev-2026-02';
    const ACC_REV_CASH = 'acc-rev-1010';
    const ACC_REV_AP = 'acc-rev-2010';
    const ACC_REV_SALES = 'acc-rev-4010';
    const ACC_REV_EXP = 'acc-rev-6010';
    let revOwnerToken = '';

    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_REV_ID);
    await CompanyManager.createCompanyProfile(
      COMP_REV_ID,
      'Adversarial Reversal Validation Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    const dbRev = await CompanyManager.getCompanyDb(COMP_REV_ID);
    const sqliteRev = await CompanyManager.getCompanySqlite(COMP_REV_ID);

    try {
      await dbContext.run(dbRev, async () => {
        await RbacService.ensureRoleTemplatesSeeded();
        sqliteRev.prepare(`DELETE FROM accounting_periods WHERE company_id = ?`).run(COMP_REV_ID);
        sqliteRev.prepare(`DELETE FROM accounts WHERE company_id = ?`).run(COMP_REV_ID);

        await db
          .insert(schema.users)
          .values([
            {
              id: 'usr-rev-owner',
              email: 'owner@revtest.ph',
              displayName: 'Rev Owner',
              passwordHash: 'test_hash',
              status: 'ACTIVE',
            },
            {
              id: 'usr-rev-approver',
              email: 'approver@revtest.ph',
              displayName: 'Rev Approver',
              passwordHash: 'test_hash',
              status: 'ACTIVE',
            },
            {
              id: 'usr-rev-bk',
              email: 'bk@revtest.ph',
              displayName: 'Rev Bookkeeper',
              passwordHash: 'test_hash',
              status: 'ACTIVE',
            },
          ])
          .onConflictDoNothing();

        const roleOwner = await RbacService.ensureRoleRecord('Company Owner');
        const roleBk = await RbacService.ensureRoleRecord('Bookkeeper');
        await db
          .insert(schema.companyUsers)
          .values([
            {
              id: 'mem-rev-owner',
              userId: 'usr-rev-owner',
              companyId: COMP_REV_ID,
              roleId: roleOwner.id,
              legacyRole: 'Company Owner',
              status: 'ACTIVE',
              membershipStatus: 'ACTIVE',
              defaultDataScope: 'COMPANY_WIDE',
            },
            {
              id: 'mem-rev-bk',
              userId: 'usr-rev-bk',
              companyId: COMP_REV_ID,
              roleId: roleBk.id,
              legacyRole: 'Bookkeeper',
              status: 'ACTIVE',
              membershipStatus: 'ACTIVE',
              defaultDataScope: 'COMPANY_WIDE',
            },
          ])
          .onConflictDoNothing();
        await RbacService.setMemberRoles(null, 'mem-rev-owner', ['Company Owner'], 'Seed Owner');
        await RbacService.setMemberRoles(null, 'mem-rev-bk', ['Bookkeeper'], 'Seed BK');

        const rawSession = crypto.randomBytes(32).toString('hex');
        await db.insert(schema.sessions).values({
          id: hashToken(rawSession),
          userId: 'usr-rev-owner',
          companyId: COMP_REV_ID,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        revOwnerToken = `${COMP_REV_ID}.${rawSession}`;

        await db.insert(schema.accountingPeriods).values([
          {
            id: PER_REV_JAN,
            companyId: COMP_REV_ID,
            name: 'January 2026',
            startDate: '2026-01-01',
            endDate: '2026-01-31',
            fiscalYear: 2026,
            status: 'OPEN',
          },
          {
            id: PER_REV_FEB,
            companyId: COMP_REV_ID,
            name: 'February 2026',
            startDate: '2026-02-01',
            endDate: '2026-02-28',
            fiscalYear: 2026,
            status: 'OPEN',
          },
        ]);

        await db.insert(schema.accounts).values([
          {
            id: ACC_REV_CASH,
            companyId: COMP_REV_ID,
            accountCode: '1010',
            accountName: 'Cash in Bank',
            accountType: 'ASSET',
            normalBalance: 'DEBIT',
            isCashAccount: true,
            status: 'ACTIVE',
          },
          {
            id: ACC_REV_AP,
            companyId: COMP_REV_ID,
            accountCode: '2010',
            accountName: 'Accounts Payable',
            accountType: 'PAYABLE',
            normalBalance: 'CREDIT',
            status: 'ACTIVE',
          },
          {
            id: ACC_REV_SALES,
            companyId: COMP_REV_ID,
            accountCode: '4010',
            accountName: 'Sales Revenue',
            accountType: 'REVENUE',
            normalBalance: 'CREDIT',
            status: 'ACTIVE',
          },
          {
            id: ACC_REV_EXP,
            companyId: COMP_REV_ID,
            accountCode: '6010',
            accountName: 'Operating Expense',
            accountType: 'EXPENSE',
            normalBalance: 'DEBIT',
            status: 'ACTIVE',
          },
        ]);

        const postFullRev = async (jeId: string) => {
          await submitJournalEntry(COMP_REV_ID, jeId, 'usr-rev-owner');
          await approveJournalEntry(COMP_REV_ID, jeId, 'usr-rev-approver');
          await postJournalEntry(COMP_REV_ID, jeId, 'usr-rev-owner', 'Company Owner');
        };

        // Baseline valid January Revenue: ₱100,000.00 (10,000,000 centavos)
        const baseJeId = await createJournalEntry(
          COMP_REV_ID,
          {
            journalNumber: 'JE-REV-BASE-01',
            entryDate: '2026-01-05',
            description: 'Baseline Valid Revenue',
            accountingPeriodId: PER_REV_JAN,
            createdBy: 'usr-rev-owner',
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_REV_CASH, debit: 10_000_000, credit: 0 },
            { accountId: ACC_REV_SALES, debit: 0, credit: 10_000_000 },
          ]
        );
        await postFullRev(baseJeId);

        // Edge Case 2, 4, 5, 13, 14, 15: Standard Original REVERSED + Reversal POSTED, Unauthorized attempt, Duplicate attempt, Reversal-of-reversal, Audit logs, 360
        const origCase2Id = await createJournalEntry(
          COMP_REV_ID,
          {
            journalNumber: 'JE-REV-CASE2',
            entryDate: '2026-01-10',
            description: 'Case 2 Original Entry',
            accountingPeriodId: PER_REV_JAN,
            createdBy: 'usr-rev-owner',
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_REV_EXP, debit: 3_000_000, credit: 0 },
            { accountId: ACC_REV_AP, debit: 0, credit: 3_000_000 },
          ]
        );
        await postFullRev(origCase2Id);

        // Edge Case 13: Unauthorized reversal attempt by Bookkeeper
        await expect(
          reverseJournalEntry(COMP_REV_ID, origCase2Id, 'usr-rev-bk', '2026-01-11', PER_REV_JAN, 'Bookkeeper')
        ).rejects.toThrow(/not authorized to reverse/i);

        // Edge Case 7a & 8: Non-existent originalJournalId or mismatched companyId rejected by domain
        await expect(
          reverseJournalEntry(COMP_REV_ID, 'non-existent-id-999', 'usr-rev-owner', '2026-01-11', PER_REV_JAN, 'Company Owner')
        ).rejects.toThrow(/Journal entry not found/i);

        await expect(
          reverseJournalEntry('LGR-WRONG-COMPANY-ID', origCase2Id, 'usr-rev-owner', '2026-01-11', PER_REV_JAN, 'Company Owner')
        ).rejects.toThrow(/Journal entry not found/i);

        // Authorized reversal (Edge Case 2)
        const childCase2Id = await reverseJournalEntry(
          COMP_REV_ID,
          origCase2Id,
          'usr-rev-owner',
          '2026-01-11',
          PER_REV_JAN,
          'Company Owner'
        );

        // Edge Case 4: Reversal of a reversal attempt
        await expect(
          reverseJournalEntry(COMP_REV_ID, childCase2Id, 'usr-rev-owner', '2026-01-12', PER_REV_JAN, 'Company Owner')
        ).rejects.toThrow(/Cannot reverse a reversal journal entry directly/i);

        // Edge Case 5: Duplicate reversal attempt
        await expect(
          reverseJournalEntry(COMP_REV_ID, origCase2Id, 'usr-rev-owner', '2026-01-12', PER_REV_JAN, 'Company Owner')
        ).rejects.toThrow(/Only POSTED entries can be reversed/i);

        // Edge Case 14: Verify audit logs exist for BOTH original (REVERSE_JOURNAL_ENTRY) and child reversal (POST_REVERSAL_JOURNAL_ENTRY)
        const origAudit = await db
          .select()
          .from(schema.auditLogs)
          .where(and(eq(schema.auditLogs.companyId, COMP_REV_ID), eq(schema.auditLogs.entityId, origCase2Id)));
        const childAudit = await db
          .select()
          .from(schema.auditLogs)
          .where(and(eq(schema.auditLogs.companyId, COMP_REV_ID), eq(schema.auditLogs.entityId, childCase2Id)));
        expect(origAudit.some((a) => a.action === 'REVERSE_JOURNAL_ENTRY')).toBe(true);
        expect(childAudit.some((a) => a.action === 'POST_REVERSAL_JOURNAL_ENTRY')).toBe(true);

        // Edge Case 1: Original POSTED + Reversal POSTED (simulate raw SQL leaving original status = 'POSTED' while child is 'POSTED')
        // Because both have opposite signs and equal magnitude, they still cancel to 0!
        const origCase1Id = await createJournalEntry(
          COMP_REV_ID,
          {
            journalNumber: 'JE-REV-CASE1',
            entryDate: '2026-01-13',
            description: 'Case 1 Original POSTED + Reversal POSTED',
            accountingPeriodId: PER_REV_JAN,
            createdBy: 'usr-rev-owner',
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_REV_EXP, debit: 2_000_000, credit: 0 },
            { accountId: ACC_REV_AP, debit: 0, credit: 2_000_000 },
          ]
        );
        await postFullRev(origCase1Id);
        await reverseJournalEntry(COMP_REV_ID, origCase1Id, 'usr-rev-owner', '2026-01-13', PER_REV_JAN, 'Company Owner');
        sqliteRev.prepare(`UPDATE journal_entries SET status = 'POSTED' WHERE id = ?`).run(origCase1Id);

        // Edge Case 3: Original and Reversal BOTH marked 'REVERSED' -> both excluded from effective posted figures (0 net effect)
        const origCase3Id = await createJournalEntry(
          COMP_REV_ID,
          {
            journalNumber: 'JE-REV-CASE3',
            entryDate: '2026-01-14',
            description: 'Case 3 Both Original and Reversal REVERSED',
            accountingPeriodId: PER_REV_JAN,
            createdBy: 'usr-rev-owner',
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_REV_EXP, debit: 4_000_000, credit: 0 },
            { accountId: ACC_REV_AP, debit: 0, credit: 4_000_000 },
          ]
        );
        await postFullRev(origCase3Id);
        const childCase3Id = await reverseJournalEntry(
          COMP_REV_ID,
          origCase3Id,
          'usr-rev-owner',
          '2026-01-14',
          PER_REV_JAN,
          'Company Owner'
        );
        sqliteRev.prepare(`UPDATE journal_entries SET status = 'REVERSED' WHERE id = ?`).run(childCase3Id);

        // Edge Case 6: Multiple posted reversal children injected via raw SQL for the same originalJournalId
        // 6a. Database-level partial unique index `unq_reversal_child_per_original` blocks direct raw SQL duplicate POSTED reversal child
        expect(() => {
          sqliteRev
            .prepare(
              `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, description, accounting_period_id, status, source_type, original_journal_id, created_by)
               VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 'REVERSAL', ?, ?)`
            )
            .run(
              'je-dup-rev-child-case2',
              COMP_REV_ID,
              'JE-REV-CASE2-REV-DUP2',
              '2026-01-15',
              'Adversarial Duplicate Reversal Child via Raw SQL',
              PER_REV_JAN,
              origCase2Id,
              'usr-rev-owner'
            );
        }).toThrow(/UNIQUE constraint failed: journal_entries\.company_id, journal_entries\.original_journal_id/i);

        // 6b. Even if an attacker temporarily drops the unique index and injects a second POSTED reversal child,
        // `resolveReportPeriodScope` / `assertNoDuplicateReversalLineage` fails closed (409 REVERSAL_LINEAGE_CORRUPTION)
        // instead of silently producing misleading figures, and once the corrupted duplicate is removed, index is restored.
        sqliteRev.exec(`DROP INDEX IF EXISTS unq_reversal_child_per_original;`);
        sqliteRev
          .prepare(
            `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, description, accounting_period_id, status, source_type, original_journal_id, created_by)
             VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 'REVERSAL', ?, ?)`
          )
          .run(
            'je-dup-rev-child-case2',
            COMP_REV_ID,
            'JE-REV-CASE2-REV-DUP2',
            '2026-01-15',
            'Adversarial Duplicate Reversal Child via Raw SQL',
            PER_REV_JAN,
            origCase2Id,
            'usr-rev-owner'
          );
        sqliteRev
          .prepare(
            `INSERT INTO journal_lines (id, journal_entry_id, line_number, account_id, debit, credit, description)
             VALUES (?, ?, 1, ?, 0, 3000000, 'Dup Rev Credit'),
                    (?, ?, 2, ?, 3000000, 0, 'Dup Rev Debit')`
          )
          .run(
            'jl-dup-rev-1',
            'je-dup-rev-child-case2',
            ACC_REV_EXP,
            'jl-dup-rev-2',
            'je-dup-rev-child-case2',
            ACC_REV_AP
          );
        await expect(
          resolveReportPeriodScope(COMP_REV_ID, { accountingPeriodId: PER_REV_JAN })
        ).rejects.toThrow(/CRITICAL_REVERSAL_LINEAGE_CORRUPTION/i);

        // Remove the adversarial duplicate and restore the database partial unique index so valid report assertions proceed
        sqliteRev.prepare(`DELETE FROM journal_lines WHERE journal_entry_id = 'je-dup-rev-child-case2'`).run();
        sqliteRev.prepare(`DELETE FROM journal_entries WHERE id = 'je-dup-rev-child-case2'`).run();
        sqliteRev.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS unq_reversal_child_per_original
          ON journal_entries(company_id, original_journal_id)
          WHERE original_journal_id IS NOT NULL AND status = 'POSTED';
        `);

        // Edge Case 7b: Orphaned/Invalid POSTED reversal pointing to a non-existent or DRAFT originalJournalId injected via raw SQL
        const draftTargetId = await createJournalEntry(
          COMP_REV_ID,
          {
            journalNumber: 'JE-REV-DRAFT-TARGET',
            entryDate: '2026-01-16',
            description: 'Draft entry that was never posted',
            accountingPeriodId: PER_REV_JAN,
            createdBy: 'usr-rev-owner',
          },
          [
            { accountId: ACC_REV_EXP, debit: 6_000_000, credit: 0 },
            { accountId: ACC_REV_AP, debit: 0, credit: 6_000_000 },
          ]
        );
        sqliteRev
          .prepare(
            `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, description, accounting_period_id, status, source_type, original_journal_id, created_by)
             VALUES (?, ?, ?, ?, ?, ?, 'POSTED', 'REVERSAL', ?, ?)`
          )
          .run(
            'je-orphan-rev-pointing-to-draft',
            COMP_REV_ID,
            'JE-REV-DRAFT-TARGET-REV',
            '2026-01-16',
            'Invalid Reversal of Draft Entry',
            PER_REV_JAN,
            draftTargetId,
            'usr-rev-owner'
          );
        sqliteRev
          .prepare(
            `INSERT INTO journal_lines (id, journal_entry_id, line_number, account_id, debit, credit, description)
             VALUES (?, ?, 1, ?, 0, 6000000, 'Orphan Credit'),
                    (?, ?, 2, ?, 6000000, 0, 'Orphan Debit')`
          )
          .run(
            'jl-orphan-1',
            'je-orphan-rev-pointing-to-draft',
            ACC_REV_EXP,
            'jl-orphan-2',
            'je-orphan-rev-pointing-to-draft',
            ACC_REV_AP
          );

        // Edge Case 9: Unbalanced POSTED journal entry injected via raw SQL -> excluded by balancedEntryCheck in buildEffectivePostedJournalPredicate
        sqliteRev
          .prepare(
            `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, description, accounting_period_id, status, created_by)
             VALUES ('je-unbalanced-raw', ?, 'JE-UNBALANCED-RAW', '2026-01-17', 'Unbalanced Raw Entry', ?, 'POSTED', 'usr-rev-owner')`
          )
          .run(COMP_REV_ID, PER_REV_JAN);
        sqliteRev
          .prepare(
            `INSERT INTO journal_lines (id, journal_entry_id, line_number, account_id, debit, credit, description)
             VALUES ('jl-unbal-1', 'je-unbalanced-raw', 1, ?, 7000000, 0, 'Unbalanced Debit'),
                    ('jl-unbal-2', 'je-unbalanced-raw', 2, ?, 0, 1000000, 'Mismatched Credit')`
          )
          .run(ACC_REV_EXP, ACC_REV_AP);

        // Edge Case 10, 11, 12: Cross-period reversal (Original in Jan, Reversed in Feb) + Reversal blocked in CLOSED period + Reopen followed by Reversal
        const crossOrigId = await createJournalEntry(
          COMP_REV_ID,
          {
            journalNumber: 'JE-REV-CROSS-JAN',
            entryDate: '2026-01-20',
            description: 'Jan Expense Reversed in Feb after Reopen',
            accountingPeriodId: PER_REV_JAN,
            createdBy: 'usr-rev-owner',
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_REV_EXP, debit: 1_500_000, credit: 0 },
            { accountId: ACC_REV_AP, debit: 0, credit: 1_500_000 },
          ]
        );
        await postFullRev(crossOrigId);

        // Edge Case 11: Hard-close February 2026 and verify reversal into CLOSED February is rejected
        await hardClosePeriod(COMP_REV_ID, PER_REV_FEB, 'usr-rev-owner', 'Close Feb before reversal test');
        await expect(
          reverseJournalEntry(COMP_REV_ID, crossOrigId, 'usr-rev-owner', '2026-02-05', PER_REV_FEB, 'Company Owner')
        ).rejects.toThrow(/HARD_CLOSED/i);

        // Edge Case 12 & 10: Reopen February 2026 with authorized reason, then execute cross-period reversal in February
        await reopenPeriod(COMP_REV_ID, PER_REV_FEB, 'usr-rev-owner', 'Authorized reopen of Feb for cross-period reversal');
        const crossChildFebId = await reverseJournalEntry(
          COMP_REV_ID,
          crossOrigId,
          'usr-rev-owner',
          '2026-02-05',
          PER_REV_FEB,
          'Company Owner'
        );
        expect(crossChildFebId).toBeTruthy();
      });

      // Verify January Income Statement:
      // - Baseline Sales Revenue: 10,000,000
      // - Case 1, Case 2 (+ duplicate child), Case 3, Case 7b (orphan), Case 9 (unbalanced): ALL net to 0 in January!
      // - Case 10 (`JE-REV-CROSS-JAN`): +1,500,000 Expense in January (because it was reversed in February, not January!)
      const isJanRes = await request(app)
        .get(`/api/reports/income-statement?accountingPeriodId=${PER_REV_JAN}`)
        .set('Authorization', `Bearer ${revOwnerToken}`);
      expect(isJanRes.status).toBe(200);
      expect(isJanRes.body.totalRevenue).toBe(10_000_000);
      expect(isJanRes.body.totalExpense).toBe(1_500_000);
      expect(isJanRes.body.netIncome).toBe(8_500_000);

      // Verify February Income Statement:
      // - Contains the -1,500,000 reversal of `JE-REV-CROSS-JAN`
      const isFebRes = await request(app)
        .get(`/api/reports/income-statement?accountingPeriodId=${PER_REV_FEB}`)
        .set('Authorization', `Bearer ${revOwnerToken}`);
      expect(isFebRes.status).toBe(200);
      expect(isFebRes.body.totalRevenue).toBe(0);
      expect(isFebRes.body.totalExpense).toBe(-1_500_000);
      expect(isFebRes.body.netIncome).toBe(1_500_000);

      // Verify YTD Income Statement through February (`mode=ytd`):
      // - Jan +1,500,000 Expense and Feb -1,500,000 Expense cancel to 0! Net Income = 10,000,000!
      const isYtdRes = await request(app)
        .get(`/api/reports/income-statement?accountingPeriodId=${PER_REV_FEB}&mode=ytd`)
        .set('Authorization', `Bearer ${revOwnerToken}`);
      expect(isYtdRes.status).toBe(200);
      expect(isYtdRes.body.totalRevenue).toBe(10_000_000);
      expect(isYtdRes.body.totalExpense).toBe(0);
      expect(isYtdRes.body.netIncome).toBe(10_000_000);
    } finally {
      await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_REV_ID);
    }
  });

  it('10. Section 3 (All 11 Hardened Reporting Endpoints & Boundary-Date Regression): Validates all 11 endpoints and boundary dates (2025-12-31, 2026-01-01, 2026-01-31, 2026-02-01)', async () => {
    // 10a. Verify all 11 hardened endpoints return 200 and strictly honor `accountingPeriodId=${PER_JAN_A}` on Company A
    const endpoints = [
      `/api/reports/summary?accountingPeriodId=${PER_JAN_A}`,
      `/api/reports/trial-balance?accountingPeriodId=${PER_JAN_A}`,
      `/api/reports/general-ledger?accountingPeriodId=${PER_JAN_A}`,
      `/api/reports/general-journal?accountingPeriodId=${PER_JAN_A}`,
      `/api/reports/balance-sheet?accountingPeriodId=${PER_JAN_A}`,
      `/api/reports/income-statement?accountingPeriodId=${PER_JAN_A}`,
      `/api/reports/cash-flow?accountingPeriodId=${PER_JAN_A}`,
      `/api/reports/changes-in-equity?accountingPeriodId=${PER_JAN_A}`,
      `/api/reports/account-schedule?accountingPeriodId=${PER_JAN_A}`,
      `/api/reports/transaction-detail?accountingPeriodId=${PER_JAN_A}`,
      `/api/reports/cashbook?accountingPeriodId=${PER_JAN_A}`,
    ];

    for (const url of endpoints) {
      const res = await request(app).get(url).set('Authorization', `Bearer ${ownerAToken}`);
      expect(res.status).toBe(200);
    }

    // Verify specific figures on endpoints not yet individually asserted in Test 1/2:
    // - /summary for Jan: Revenue 25M, Expense 8M, Net Income 17M, Assets 125M, Liabilities 8M, Equity 117M
    const sumJan = await request(app)
      .get(`/api/reports/summary?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(sumJan.body.totalRevenue).toBe(25_000_000);
    expect(sumJan.body.totalExpense).toBe(8_000_000);
    expect(sumJan.body.netIncome).toBe(17_000_000);
    expect(sumJan.body.totalAssets).toBe(125_000_000);
    expect(sumJan.body.totalLiabilities).toBe(8_000_000);
    expect(sumJan.body.totalEquity).toBe(117_000_000);
    expect(sumJan.body.balanced).toBe(true);

    // - /cash-flow & /cashbook for Jan: Cash (1010) had 100,000,000 debit on 2026-01-01
    const cfJan = await request(app)
      .get(`/api/reports/cash-flow?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(cfJan.body.netChangeInCash).toBe(100_000_000);

    const cbJan = await request(app)
      .get(`/api/reports/cashbook?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(cbJan.body).toHaveLength(1);
    expect(cbJan.body[0].debit).toBe(100_000_000);

    // - /changes-in-equity for Jan: Ending Total Equity = 117,000,000
    const cieJan = await request(app)
      .get(`/api/reports/changes-in-equity?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    const endingEqRow = (cieJan.body as any[]).find((r) => r.component === 'Ending Total Equity');
    expect(endingEqRow?.amount).toBe(117_000_000);

    // - /general-journal & /transaction-detail for Jan: Every returned row has entryDate in 2026-01-01..2026-01-31 and accountingPeriodId === PER_JAN_A
    const gjJan = await request(app)
      .get(`/api/reports/general-journal?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(gjJan.body.length).toBeGreaterThan(0);
    for (const r of gjJan.body as any[]) {
      expect(r.accountingPeriodId).toBe(PER_JAN_A);
      expect(r.entryDate >= '2026-01-01' && r.entryDate <= '2026-01-31').toBe(true);
    }

    const tdJan = await request(app)
      .get(`/api/reports/transaction-detail?accountingPeriodId=${PER_JAN_A}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(tdJan.body.length).toBeGreaterThan(0);
    for (const e of tdJan.body as any[]) {
      expect(e.accountingPeriodId).toBe(PER_JAN_A);
      expect(e.entryDate >= '2026-01-01' && e.entryDate <= '2026-01-31').toBe(true);
    }

    // 10b. Boundary-Date Regression (2025-12-31, 2026-01-01, 2026-01-31, 2026-02-01):
    const COMP_BND_ID = 'LGR-PH-TEST-BOUNDARY-DATES-01';
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_BND_ID);
    await CompanyManager.createCompanyProfile(
      COMP_BND_ID,
      'Boundary Date Precision Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );
    const dbBnd = await CompanyManager.getCompanyDb(COMP_BND_ID);
    const sqliteBnd = await CompanyManager.getCompanySqlite(COMP_BND_ID);
    let bndToken = '';

    try {
      await dbContext.run(dbBnd, async () => {
        await RbacService.ensureRoleTemplatesSeeded();
        sqliteBnd.prepare(`DELETE FROM accounting_periods WHERE company_id = ?`).run(COMP_BND_ID);
        sqliteBnd.prepare(`DELETE FROM accounts WHERE company_id = ?`).run(COMP_BND_ID);

        await db
          .insert(schema.users)
          .values([
            {
              id: 'usr-bnd-owner',
              email: 'owner@bndtest.ph',
              displayName: 'Boundary Owner',
              passwordHash: 'test_hash',
              status: 'ACTIVE',
            },
            {
              id: 'usr-bnd-approver',
              email: 'approver@bndtest.ph',
              displayName: 'Boundary Approver',
              passwordHash: 'test_hash',
              status: 'ACTIVE',
            },
          ])
          .onConflictDoNothing();
        const roleRec = await RbacService.ensureRoleRecord('Company Owner');
        await db
          .insert(schema.companyUsers)
          .values({
            id: 'mem-bnd-owner',
            userId: 'usr-bnd-owner',
            companyId: COMP_BND_ID,
            roleId: roleRec.id,
            legacyRole: 'Company Owner',
            status: 'ACTIVE',
            membershipStatus: 'ACTIVE',
            defaultDataScope: 'COMPANY_WIDE',
          })
          .onConflictDoNothing();
        await RbacService.setMemberRoles(null, 'mem-bnd-owner', ['Company Owner'], 'Seed Bnd Owner');

        const rawSession = crypto.randomBytes(32).toString('hex');
        await db.insert(schema.sessions).values({
          id: hashToken(rawSession),
          userId: 'usr-bnd-owner',
          companyId: COMP_BND_ID,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        bndToken = `${COMP_BND_ID}.${rawSession}`;

        await db.insert(schema.accountingPeriods).values([
          {
            id: 'per-bnd-2025-12',
            companyId: COMP_BND_ID,
            name: 'Dec 2025',
            startDate: '2025-12-01',
            endDate: '2025-12-31',
            fiscalYear: 2025,
            status: 'OPEN',
          },
          {
            id: 'per-bnd-2026-01',
            companyId: COMP_BND_ID,
            name: 'Jan 2026',
            startDate: '2026-01-01',
            endDate: '2026-01-31',
            fiscalYear: 2026,
            status: 'OPEN',
          },
          {
            id: 'per-bnd-2026-02',
            companyId: COMP_BND_ID,
            name: 'Feb 2026',
            startDate: '2026-02-01',
            endDate: '2026-02-28',
            fiscalYear: 2026,
            status: 'OPEN',
          },
        ]);

        await db.insert(schema.accounts).values([
          {
            id: 'acc-bnd-1010',
            companyId: COMP_BND_ID,
            accountCode: '1010',
            accountName: 'Cash',
            accountType: 'ASSET',
            normalBalance: 'DEBIT',
            isCashAccount: true,
            status: 'ACTIVE',
          },
          {
            id: 'acc-bnd-4010',
            companyId: COMP_BND_ID,
            accountCode: '4010',
            accountName: 'Revenue',
            accountType: 'REVENUE',
            normalBalance: 'CREDIT',
            status: 'ACTIVE',
          },
        ]);

        const postBoundary = async (num: string, date: string, perId: string, amt: number) => {
          const id = await createJournalEntry(
            COMP_BND_ID,
            {
              journalNumber: num,
              entryDate: date,
              description: `Boundary ${date}`,
              accountingPeriodId: perId,
              createdBy: 'usr-bnd-owner',
              userRole: 'Company Owner',
            },
            [
              { accountId: 'acc-bnd-1010', debit: amt, credit: 0 },
              { accountId: 'acc-bnd-4010', debit: 0, credit: amt },
            ]
          );
          await submitJournalEntry(COMP_BND_ID, id, 'usr-bnd-owner');
          await approveJournalEntry(COMP_BND_ID, id, 'usr-bnd-approver');
          await postJournalEntry(COMP_BND_ID, id, 'usr-bnd-owner', 'Company Owner');
        };

        await postBoundary('JE-BND-2025-12-31', '2025-12-31', 'per-bnd-2025-12', 1_000_000); // Day before Jan
        await postBoundary('JE-BND-2026-01-01', '2026-01-01', 'per-bnd-2026-01', 2_000_000); // First day of Jan
        await postBoundary('JE-BND-2026-01-31', '2026-01-31', 'per-bnd-2026-01', 4_000_000); // Last day of Jan
        await postBoundary('JE-BND-2026-02-01', '2026-02-01', 'per-bnd-2026-02', 8_000_000); // Day after Jan
      });

      // Query Jan 2026 (2026-01-01..2026-01-31):
      // - Must include ONLY 2026-01-01 (2M) + 2026-01-31 (4M) = 6,000,000 in period movement
      // - Must carry 2025-12-31 (1M) in openingDebit / openingNetBalance
      // - Must completely exclude 2026-02-01 (8M)!
      const isBndJan = await request(app)
        .get('/api/reports/income-statement?accountingPeriodId=per-bnd-2026-01')
        .set('Authorization', `Bearer ${bndToken}`);
      expect(isBndJan.status).toBe(200);
      expect(isBndJan.body.totalRevenue).toBe(6_000_000); // 2M + 4M

      const tbBndJan = await request(app)
        .get('/api/reports/trial-balance?accountingPeriodId=per-bnd-2026-01')
        .set('Authorization', `Bearer ${bndToken}`);
      expect(tbBndJan.status).toBe(200);
      const cashBndJan = (tbBndJan.body as any[]).find((r) => r.accountCode === '1010');
      expect(cashBndJan.openingNetBalance).toBe(1_000_000); // 2025-12-31
      expect(cashBndJan.periodDebit).toBe(6_000_000); // 2026-01-01 + 2026-01-31
      expect(cashBndJan.closingNetBalance).toBe(7_000_000); // 1M + 6M (excludes 2026-02-01 8M)
    } finally {
      await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_BND_ID);
    }
  });

  it('11. Section 4 (Isolated Test Execution Safety Guard): Enforces LEDGERAI_ISOLATED_TEST_ROOT boundary and rejects any destructive target path outside the isolated test root', () => {
    const prevIsolatedRoot = process.env.LEDGERAI_ISOLATED_TEST_ROOT;
    const prevConfigDir = process.env.LEDGERAI_CONFIG_DIR;
    const prevDataDir = process.env.LEDGERAI_DATA_DIR;
    try {
      const activeIsolatedRoot = prevIsolatedRoot || path.join('/tmp', 'ledgerai-isolated-safety-guard-test');
      process.env.LEDGERAI_ISOLATED_TEST_ROOT = activeIsolatedRoot;
      process.env.LEDGERAI_CONFIG_DIR = path.join(activeIsolatedRoot, 'config');
      process.env.LEDGERAI_DATA_DIR = path.join(activeIsolatedRoot, 'companies');

      // Path inside isolated root succeeds
      expect(() =>
        CompanyManager.assertIsolatedTestWorkspaceSafety(
          path.join(paths.getCompaniesRootDir(), 'LGR-PH-TEST-SAFE-INSIDE')
        )
      ).not.toThrow();

      // Path outside isolated root (e.g., live /root/.ledgerai_data or /root/Documents/LedgerAI Companies/deskguard_solutions) is strictly rejected!
      expect(() =>
        CompanyManager.assertIsolatedTestWorkspaceSafety('/root/.ledgerai_data/registry.json')
      ).toThrow(/PROHIBITED_DESTRUCTIVE_TEST_OPERATION.*escapes the designated isolated test root/i);

      expect(() =>
        CompanyManager.assertIsolatedTestWorkspaceSafety(
          '/root/Documents/LedgerAI Companies/deskguard_solutions'
        )
      ).toThrow(/PROHIBITED_DESTRUCTIVE_TEST_OPERATION.*escapes the designated isolated test root/i);
    } finally {
      if (prevIsolatedRoot === undefined) {
        delete process.env.LEDGERAI_ISOLATED_TEST_ROOT;
      } else {
        process.env.LEDGERAI_ISOLATED_TEST_ROOT = prevIsolatedRoot;
      }
      if (prevConfigDir === undefined) {
        delete process.env.LEDGERAI_CONFIG_DIR;
      } else {
        process.env.LEDGERAI_CONFIG_DIR = prevConfigDir;
      }
      if (prevDataDir === undefined) {
        delete process.env.LEDGERAI_DATA_DIR;
      } else {
        process.env.LEDGERAI_DATA_DIR = prevDataDir;
      }
    }
  });
});

