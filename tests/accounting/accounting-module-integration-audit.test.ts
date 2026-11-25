import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import {
  createJournalEntry,
  updateJournalEntry,
  submitJournalEntry,
  approveJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  softClosePeriod,
  hardClosePeriod,
  validateTransactionDateAndPeriod,
} from '../../src/server/db/domain';
import { AccountingEngine } from '../../src/server/services/accountingEngine';
import { ForexRevaluationEngine } from '../../src/server/services/forexRevaluationEngine';
import { LedgerIntegrityService } from '../../src/server/services/ledgerIntegrityService';

describe('Deep Accounting Module Integration Audit (5 Submodules Synthetic Dry-Run)', () => {
  const app = createApp();
  const COMP_ID = 'LGR-PH-2026-TEST-ACCT-AUDIT';

  const OWNER_ID = 'usr-audit-owner';
  const APPROVER_ID = 'usr-audit-approver';
  let ownerToken = '';
  let approverToken = '';

  const PER_JAN = 'per-audit-2026-01';
  const PER_FEB = 'per-audit-2026-02';
  const PER_MAR = 'per-audit-2026-03';

  const ACC_CASH = 'acc-audit-1010';
  const ACC_AR = 'acc-audit-1030';
  const ACC_AP = 'acc-audit-2010';
  const ACC_VAT_OUT = 'acc-audit-2020';
  const ACC_EQ = 'acc-audit-3010';
  const ACC_REV = 'acc-audit-4010';
  const ACC_EXP = 'acc-audit-6010';
  const ACC_INACTIVE = 'acc-audit-6099';

  let companyDb: any;
  let companySqlite: any;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);

    await CompanyManager.createCompanyProfile(
      COMP_ID,
      'Accounting Audit Synthetic Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    companyDb = await CompanyManager.getCompanyDb(COMP_ID);
    companySqlite = await CompanyManager.getCompanySqlite(COMP_ID);

    companySqlite.prepare('DELETE FROM accounting_periods WHERE company_id = ?').run(COMP_ID);
    companySqlite.prepare('DELETE FROM accounts WHERE company_id = ?').run(COMP_ID);

    await dbContext.run(companyDb, async () => {
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
            companyId: COMP_ID,
            roleId: roleRec.id,
            legacyRole: roleName,
            status: 'ACTIVE',
            membershipStatus: 'ACTIVE',
            defaultDataScope: 'COMPANY_WIDE',
            approvalLimitCentavos: 100_000_000_00,
          })
          .onConflictDoNothing();

        await RbacService.setMemberRoles(null, memId, [roleName], `Seed ${roleName}`);

        const rawSession = crypto.randomBytes(32).toString('hex');
        await db.insert(schema.sessions).values({
          id: hashToken(rawSession),
          userId: uid,
          companyId: COMP_ID,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        return `${COMP_ID}.${rawSession}`;
      };

      ownerToken = await seedUser(OWNER_ID, 'owner@acct-audit.ph', 'Audit Owner', 'Company Owner');
      approverToken = await seedUser(APPROVER_ID, 'approver@acct-audit.ph', 'Audit Manager', 'Finance Manager');

      await db.insert(schema.accountingPeriods).values([
        {
          id: PER_JAN,
          companyId: COMP_ID,
          name: 'January 2026',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          fiscalYear: 2026,
          status: 'OPEN',
        },
        {
          id: PER_FEB,
          companyId: COMP_ID,
          name: 'February 2026',
          startDate: '2026-02-01',
          endDate: '2026-02-28',
          fiscalYear: 2026,
          status: 'OPEN',
        },
        {
          id: PER_MAR,
          companyId: COMP_ID,
          name: 'March 2026',
          startDate: '2026-03-01',
          endDate: '2026-03-31',
          fiscalYear: 2026,
          status: 'OPEN',
        },
      ]);

      await db.insert(schema.accounts).values([
        { id: ACC_CASH, companyId: COMP_ID, accountCode: '1010', accountName: 'Cash in Bank', accountType: 'ASSET', normalBalance: 'DEBIT', isCashAccount: true, status: 'ACTIVE' },
        { id: ACC_AR, companyId: COMP_ID, accountCode: '1030', accountName: 'Accounts Receivable', accountType: 'RECEIVABLE', normalBalance: 'DEBIT', isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_AP, companyId: COMP_ID, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'PAYABLE', normalBalance: 'CREDIT', isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_VAT_OUT, companyId: COMP_ID, accountCode: '2020', accountName: 'Output VAT Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_EQ, companyId: COMP_ID, accountCode: '3010', accountName: 'Owner Equity', accountType: 'EQUITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_REV, companyId: COMP_ID, accountCode: '4010', accountName: 'Service Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_EXP, companyId: COMP_ID, accountCode: '6010', accountName: 'Operating Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_INACTIVE, companyId: COMP_ID, accountCode: '6099', accountName: 'Deprecated Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'INACTIVE' },
      ]);
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);
  });

  it('1. Verifies authoritative GL reconciliation across Trial Balance, GL, Balance Sheet, Income Statement, Account Schedule, Period Close Workspace, and Cryptographic Integrity', async () => {
    await dbContext.run(companyDb, async () => {
      // Jan Opening Capital: ₱1,000,000.00
      const jOpen = await createJournalEntry(
        COMP_ID,
        { journalNumber: 'JE-AUD-001', entryDate: '2026-01-01', description: 'Opening Capital', sourceType: 'OPENING_BALANCE', accountingPeriodId: PER_JAN, createdBy: OWNER_ID, userRole: 'Company Owner' },
        [
          { accountId: ACC_CASH, debit: 100_000_000, credit: 0 },
          { accountId: ACC_EQ, debit: 0, credit: 100_000_000 },
        ]
      );
      await submitJournalEntry(COMP_ID, jOpen, OWNER_ID);
      await approveJournalEntry(COMP_ID, jOpen, APPROVER_ID);
      await postJournalEntry(COMP_ID, jOpen, APPROVER_ID, 'Finance Manager');

      // Jan Revenue + 12% VAT: ₱112,000.00 Cash DR, ₱100,000.00 Revenue CR, ₱12,000.00 Output VAT CR
      const jJanRev = await createJournalEntry(
        COMP_ID,
        { journalNumber: 'JE-AUD-002', entryDate: '2026-01-15', description: 'Jan Revenue', accountingPeriodId: PER_JAN, createdBy: OWNER_ID, userRole: 'Company Owner' },
        [
          { accountId: ACC_CASH, debit: 11_200_000, credit: 0 },
          { accountId: ACC_REV, debit: 0, credit: 10_000_000 },
          { accountId: ACC_VAT_OUT, debit: 0, credit: 1_200_000 },
        ]
      );
      await submitJournalEntry(COMP_ID, jJanRev, OWNER_ID);
      await approveJournalEntry(COMP_ID, jJanRev, APPROVER_ID);
      await postJournalEntry(COMP_ID, jJanRev, APPROVER_ID, 'Finance Manager');

      // Jan Expense: ₱40,000.00
      const jJanExp = await createJournalEntry(
        COMP_ID,
        { journalNumber: 'JE-AUD-003', entryDate: '2026-01-20', description: 'Jan Rent', accountingPeriodId: PER_JAN, createdBy: OWNER_ID, userRole: 'Company Owner' },
        [
          { accountId: ACC_EXP, debit: 4_000_000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 4_000_000 },
        ]
      );
      await submitJournalEntry(COMP_ID, jJanExp, OWNER_ID);
      await approveJournalEntry(COMP_ID, jJanExp, APPROVER_ID);
      await postJournalEntry(COMP_ID, jJanExp, APPROVER_ID, 'Finance Manager');

      // Jan Reversed Entry: ₱25,000.00 (excluded cleanly in same period)
      const jRevOrig = await createJournalEntry(
        COMP_ID,
        { journalNumber: 'JE-AUD-004', entryDate: '2026-01-22', description: 'Mistaken Expense', accountingPeriodId: PER_JAN, createdBy: OWNER_ID, userRole: 'Company Owner' },
        [
          { accountId: ACC_EXP, debit: 2_500_000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 2_500_000 },
        ]
      );
      await submitJournalEntry(COMP_ID, jRevOrig, OWNER_ID);
      await approveJournalEntry(COMP_ID, jRevOrig, APPROVER_ID);
      await postJournalEntry(COMP_ID, jRevOrig, APPROVER_ID, 'Finance Manager');
      await reverseJournalEntry(COMP_ID, jRevOrig, APPROVER_ID, '2026-01-23', PER_JAN, 'Finance Manager');

      // Feb Revenue: ₱50,000.00 AR DR, ₱50,000.00 Sales CR
      const jFebRev = await createJournalEntry(
        COMP_ID,
        { journalNumber: 'JE-AUD-005', entryDate: '2026-02-10', description: 'Feb Revenue', accountingPeriodId: PER_FEB, createdBy: OWNER_ID, userRole: 'Company Owner' },
        [
          { accountId: ACC_AR, debit: 5_000_000, credit: 0 },
          { accountId: ACC_REV, debit: 0, credit: 5_000_000 },
        ]
      );
      await submitJournalEntry(COMP_ID, jFebRev, OWNER_ID);
      await approveJournalEntry(COMP_ID, jFebRev, APPROVER_ID);
      await postJournalEntry(COMP_ID, jFebRev, APPROVER_ID, 'Finance Manager');

      // Unposted DRAFT entry in Feb: ₱99,999.00 (must NOT hit Trial Balance / Reports)
      await createJournalEntry(
        COMP_ID,
        { journalNumber: 'JE-AUD-DRAFT', entryDate: '2026-02-15', description: 'Unposted Draft', accountingPeriodId: PER_FEB, createdBy: OWNER_ID, userRole: 'Company Owner' },
        [
          { accountId: ACC_EXP, debit: 9_999_900, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 9_999_900 },
        ]
      );
    });

    const [tbRes, bsRes, isRes, glRes, schedRes, wsFebRes] = await Promise.all([
      request(app).get('/api/reports/trial-balance?startDate=2026-01-01&endDate=2026-02-28').set('Authorization', `Bearer ${ownerToken}`),
      request(app).get('/api/reports/balance-sheet?startDate=2026-01-01&endDate=2026-02-28').set('Authorization', `Bearer ${ownerToken}`),
      request(app).get('/api/reports/income-statement?startDate=2026-01-01&endDate=2026-02-28').set('Authorization', `Bearer ${ownerToken}`),
      request(app).get('/api/reports/general-ledger?startDate=2026-01-01&endDate=2026-02-28').set('Authorization', `Bearer ${ownerToken}`),
      request(app).get('/api/reports/account-schedule?startDate=2026-01-01&endDate=2026-02-28').set('Authorization', `Bearer ${ownerToken}`),
      request(app).get(`/api/accounting/periods/${PER_FEB}/workspace`).set('Authorization', `Bearer ${ownerToken}`),
    ]);

    expect(tbRes.status).toBe(200);
    expect(bsRes.status).toBe(200);
    expect(isRes.status).toBe(200);
    expect(glRes.status).toBe(200);
    expect(schedRes.status).toBe(200);
    expect(wsFebRes.status).toBe(200);

    const tbRows = tbRes.body as any[];
    const sumField = (rows: any[], key: string) => rows.reduce((s, r) => s + Number(r[key] || 0), 0);

    // TB exact math:
    // Opening Capital 100M + Jan Rev 11.2M + Jan Exp 4M + Jan Reversed Pair (2.5M orig + 2.5M rev) + Feb Rev 5M = 125.2M centavos gross
    // Same-period reversal pair nets to 0 on Cash closingNetBalance (₱1,072,000.00) and Expense closingNetBalance (₱40,000.00).
    expect(sumField(tbRows, 'debitTotal')).toBe(125_200_000);
    expect(sumField(tbRows, 'creditTotal')).toBe(125_200_000);
    expect(sumField(tbRows, 'closingDebit')).toBe(125_200_000);
    expect(sumField(tbRows, 'closingCredit')).toBe(125_200_000);
    expect(tbRows.find((r) => r.accountCode === '1010')?.closingNetBalance).toBe(107_200_000);
    expect(tbRows.find((r) => r.accountCode === '6010')?.closingNetBalance).toBe(4_000_000);

    // Income Statement exact math: Revenue ₱150,000.00 - Expense ₱40,000.00 = Net Income ₱110,000.00
    expect(isRes.body.totalRevenue).toBe(15_000_000);
    expect(isRes.body.totalExpense).toBe(4_000_000);
    expect(isRes.body.netIncome).toBe(11_000_000);

    // Balance Sheet exact math: Assets (Cash 107.2M + AR 5M = 112.2M) == Liab (1.2M) + Equity (100M + NetIncome 11M)
    expect(bsRes.body.totalAssets).toBe(112_200_000);
    expect(bsRes.body.totalLiabilities + bsRes.body.totalEquity).toBe(112_200_000);
    expect(bsRes.body.balanced).toBe(true);

    // GL matches net totals (last Cash row runningBalance == ₱1,072,000.00)
    const cashGlRows = (glRes.body as any[]).filter((r: any) => r.accountCode === '1010');
    expect(cashGlRows.length).toBeGreaterThan(0);
    expect(cashGlRows[cashGlRows.length - 1].runningBalance).toBe(107_200_000);

    // Account Schedule reconciles ending balances
    const cashSched = (schedRes.body as any[]).find((a: any) => a.accountCode === '1010');
    expect(cashSched?.closingBalance).toBe(107_200_000);

    // Period Close Workspace for Feb shows exact Feb gross activity (5M) & counts 1 unposted DRAFT
    expect(wsFebRes.body.financialOverview.totalDebitCentavos).toBe(5_000_000);
    expect(wsFebRes.body.financialOverview.totalCreditCentavos).toBe(5_000_000);
    expect(wsFebRes.body.financialOverview.unpostedJournalCount).toBe(1);

    // LedgerIntegrityService scan passes on valid double-entry data
    const scanResult = await dbContext.run(companyDb, async () => {
      return await LedgerIntegrityService.runIntegrityScan(COMP_ID, {
        userId: OWNER_ID,
        userName: 'Audit Owner',
        userRole: 'Company Owner',
      });
    });
    expect(scanResult.failedChecks).toBe(0);
  });

  it('2. [COA-01 RESOLVED / REQ-ACCT-INT-001] Verifies COA openingBalance atomically posts OPENING_BALANCE JE into GL & Trial Balance', async () => {
    const createRes = await request(app)
      .post('/api/master-data/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        accountCode: '1050',
        accountName: 'Petty Cash Drawer',
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        detailType: 'PETTY_CASH',
        openingBalance: 75000,
        asOfDate: '2026-01-01',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.openingBalance).toBe(75000);
    expect(createRes.body.openingJournalEntryId).toBeTruthy();

    const tbRes = await request(app)
      .get('/api/reports/trial-balance?startDate=2026-01-01&endDate=2026-02-28')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(tbRes.status).toBe(200);

    const pettyCashRow = (tbRes.body as any[]).find((b: any) => b.accountCode === '1050');
    expect(pettyCashRow).toBeDefined();
    expect(pettyCashRow.closingNetBalance).toBe(7_500_000);
  });

  it('3. [COA-02 & COA-03 DEFECTS] Reproduces inactive account bypass in updateJournalEntry / AccountingEngine and split control-account numbering', async () => {
    // 3a. GET /api/accounting/accounts returns INACTIVE accounts unconditionally
    const acctRes = await request(app)
      .get('/api/accounting/accounts')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(acctRes.status).toBe(200);
    expect(acctRes.body.some((a: any) => a.id === ACC_INACTIVE && a.status === 'INACTIVE')).toBe(true);

    // 3b. createJournalEntry properly blocks INACTIVE accounts, whereas updateJournalEntry & postBalancedJournalEntry do NOT
    await dbContext.run(companyDb, async () => {
      await expect(
        createJournalEntry(
          COMP_ID,
          { journalNumber: 'JE-INACT-CREATE', entryDate: '2026-02-12', description: 'Blocked Create', accountingPeriodId: PER_FEB, createdBy: OWNER_ID, userRole: 'Company Owner' },
          [
            { accountId: ACC_INACTIVE, debit: 10_000, credit: 0 },
            { accountId: ACC_CASH, debit: 0, credit: 10_000 },
          ]
        )
      ).rejects.toThrow(/inactive/i);

      // Draft created with active account, then edited via domain.updateJournalEntry to use INACTIVE account -> SUCCEEDS (defect)
      const draftId = await createJournalEntry(
        COMP_ID,
        { journalNumber: 'JE-INACT-UPD', entryDate: '2026-02-12', description: 'Active Draft', accountingPeriodId: PER_FEB, createdBy: OWNER_ID, userRole: 'Company Owner' },
        [
          { accountId: ACC_EXP, debit: 10_000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 10_000 },
        ]
      );
      const updated = await updateJournalEntry(
        COMP_ID,
        draftId,
        { updatedBy: OWNER_ID, userRole: 'Company Owner', description: 'Edited to Inactive' },
        [
          { accountId: ACC_INACTIVE, debit: 10_000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 10_000 },
        ]
      );
      expect(updated.description).toBe('Edited to Inactive');

      // AccountingEngine.postBalancedJournalEntry also posts directly to INACTIVE account -> SUCCEEDS (defect)
      const postedEngineId = await AccountingEngine.postBalancedJournalEntry(
        COMP_ID,
        { journalNumber: 'JE-ENG-INACT', entryDate: '2026-02-12', description: 'Engine Inactive Bypass', sourceType: 'TEST', sourceId: 'src-inact-1', createdBy: OWNER_ID },
        [
          { accountId: ACC_INACTIVE, debit: 20_000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 20_000 },
        ]
      );
      expect(typeof postedEngineId).toBe('string');

      // 3c. AccountingEngine.ensureDefaultAccounts creates duplicate 1100/1200/2000/2200 accounts alongside 1010/1030/2010/2020
      const engineMap = await AccountingEngine.ensureDefaultAccounts(COMP_ID);
      expect(engineMap['1100']).toBeDefined();
      expect(engineMap['1200']).toBeDefined();
      expect(engineMap['2000']).toBeDefined();
      expect(engineMap['2200']).toBeDefined();
    });
  });

  it('4. [JE-01 RESOLVED / REQ-ACCT-INT-002] Verifies PUT /journals/:id cross-period date update synchronizes accountingPeriodId and posts cleanly', async () => {
    // Create draft in January
    const createRes = await request(app)
      .post('/api/accounting/journals')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        journalNumber: 'JE-STALE-PER-01',
        entryDate: '2026-01-25',
        description: 'Cross-period date move test',
        lines: [
          { accountId: ACC_EXP, debit: 50_000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 50_000 },
        ],
      });
    expect(createRes.status).toBe(201);
    const jeId = createRes.body.id;

    // Move entryDate to February via PUT /api/accounting/journals/:id
    const putRes = await request(app)
      .put(`/api/accounting/journals/${jeId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        entryDate: '2026-02-18',
        description: 'Moved to February',
        lines: [
          { accountId: ACC_EXP, debit: 50_000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 50_000 },
        ],
      });
    expect(putRes.status).toBe(200);

    // Submit & Approve, then Post -> succeeds cleanly because accountingPeriodId synced to PER_FEB
    await dbContext.run(companyDb, async () => {
      await submitJournalEntry(COMP_ID, jeId, OWNER_ID);
      await approveJournalEntry(COMP_ID, jeId, APPROVER_ID);
      await postJournalEntry(COMP_ID, jeId, APPROVER_ID, 'Finance Manager');
      const updated = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, jeId)).get();
      expect(updated?.accountingPeriodId).toBe(PER_FEB);
      expect(updated?.status).toBe('POSTED');
    });
  });

  it('5. [TB-01 RESOLVED / REQ-ACCT-INT-003] Verifies 6-column Opening/Period/Closing Trial Balance reconciliation, includeZeroBalances toggle, and GL drill-down parity', async () => {
    const febTbRes = await request(app)
      .get('/api/reports/trial-balance?startDate=2026-02-01&endDate=2026-02-28')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(febTbRes.status).toBe(200);
    const febRows = febTbRes.body as any[];
    const sumFeb = (key: string) => febRows.reduce((s, r) => s + Number(r[key] || 0), 0);

    // Full-dataset Opening, Period, and Closing totals all balance strictly (DR == CR)
    expect(sumFeb('openingDebit')).toBe(127_700_000);
    expect(sumFeb('openingCredit')).toBe(127_700_000);
    expect(sumFeb('periodDebit')).toBe(5_070_000);
    expect(sumFeb('periodCredit')).toBe(5_070_000);
    expect(sumFeb('closingDebit')).toBe(132_770_000);
    expect(sumFeb('closingCredit')).toBe(132_770_000);

    // Every individual row satisfies opening + period === closing
    for (const r of febRows) {
      expect(r.openingDebit + r.periodDebit).toBe(r.closingDebit);
      expect(r.openingCredit + r.periodCredit).toBe(r.closingCredit);
    }

    // includeZeroBalances=true includes active accounts with zero activity in the scope
    const withZeroRes = await request(app)
      .get('/api/reports/trial-balance?startDate=2026-02-01&endDate=2026-02-28&includeZeroBalances=true')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(withZeroRes.status).toBe(200);
    const withZeroRows = withZeroRes.body as any[];
    expect(withZeroRows.length).toBeGreaterThanOrEqual(febRows.length);
    expect(withZeroRows.some((r: any) => r.accountCode === '2010' && r.closingDebit === 0 && r.closingCredit === 0)).toBe(true);

    // Drill-down to GL by accountId + period dates matches Trial Balance closing net balance
    const cashRow = febRows.find((r: any) => r.accountCode === '1010');
    expect(cashRow).toBeDefined();
    const glDrillRes = await request(app)
      .get(`/api/reports/general-ledger?accountId=${cashRow.accountId}&startDate=2026-02-01&endDate=2026-02-28`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(glDrillRes.status).toBe(200);
    const glRows = glDrillRes.body as any[];
    const glPeriodDebit = glRows.reduce((s, r) => s + Number(r.debit || 0), 0);
    const glPeriodCredit = glRows.reduce((s, r) => s + Number(r.credit || 0), 0);
    expect(glPeriodDebit).toBe(cashRow.periodDebit);
    expect(glPeriodCredit).toBe(cashRow.periodCredit);
    expect(glRows[glRows.length - 1].runningBalance).toBe(cashRow.closingNetBalance);
  });

  it('6. [PER-01 RESOLVED / REQ-ACCT-INT-004] Verifies normalized COMPANY_OWNER role override on SOFT_CLOSED period and 403 tax lock in HARD_CLOSED period', async () => {
    await dbContext.run(companyDb, async () => {
      await softClosePeriod(COMP_ID, PER_FEB, OWNER_ID);

      // Normalized role code ('COMPANY_OWNER') and display name ('Company Owner') both succeed on SOFT_CLOSED
      const allowedWithRoleCode = await validateTransactionDateAndPeriod(COMP_ID, '2026-02-14', { userRole: 'COMPANY_OWNER' });
      expect(allowedWithRoleCode.id).toBe(PER_FEB);

      const allowedWithDisplayName = await validateTransactionDateAndPeriod(COMP_ID, '2026-02-14', { userRole: 'Company Owner' });
      expect(allowedWithDisplayName.id).toBe(PER_FEB);

      // Ordinary roles remain strictly blocked on SOFT_CLOSED with 403
      await expect(
        validateTransactionDateAndPeriod(COMP_ID, '2026-02-14', { userRole: 'Bookkeeper' })
      ).rejects.toThrow(/SOFT_CLOSED/i);

      await hardClosePeriod(COMP_ID, PER_FEB, OWNER_ID);
    });

    // Tax route now enforces period lock and blocks filing inside the HARD_CLOSED February period with 403 PERIOD_LOCKED
    const taxRes = await request(app)
      .post('/api/tax/filings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        taxType: 'VAT_2550M',
        periodName: 'February 2026',
        startDate: '2026-02-01',
        endDate: '2026-02-28',
        deadlineDate: '2026-03-20',
      });
    expect(taxRes.status).toBe(403);
    expect(taxRes.body.error).toBe('PERIOD_LOCKED');
  });

  it('7. [FX-01 RESOLVED] Rejects silent 56.00 fallback for unrecorded currencies and decouples /forex/revalue-and-post from Cash/AR collections', async () => {
    await dbContext.run(companyDb, async () => {
      await expect(ForexRevaluationEngine.getBspSpotRate(COMP_ID, 'EUR')).rejects.toMatchObject({
        code: 'BSP_SPOT_RATE_NOT_FOUND',
        statusCode: 400,
      });
    });

    // Without a foreign monetary account, /revalue-and-post fails cleanly rather than fabricating Cash 1100 / AR 1200 entries
    const noAccountRes = await request(app)
      .post('/api/operations/forex/revalue-and-post')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        transactionId: 'fx-reval-audit-no-acc',
        transactionNumber: 'FX-AUD-000',
        transactionDate: '2026-03-31',
        foreignAmount: 1000,
        recordedRate: 55.0,
        settlementRate: 58.0,
        sourceType: 'UNREALIZED_MONTH_END',
      });
    expect(noAccountRes.status).toBe(400);
    expect(noAccountRes.body.error).toBe('MISSING_FX_MONETARY_ACCOUNT');

    // Create a proper USD Foreign Currency Monetary Bank GL account
    const fxAccRes = await request(app)
      .post('/api/master-data/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        accountCode: '1055',
        accountName: 'BDO Dollar FCDU Account',
        accountType: 'ASSET',
        detailType: 'DOLLAR_ACCOUNT',
        normalBalance: 'DEBIT',
        currency: 'USD',
      });
    expect(fxAccRes.status).toBe(201);
    const fxAccId = fxAccRes.body.id;

    const fxRes = await request(app)
      .post('/api/operations/forex/revalue-and-post')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        transactionId: 'fx-reval-audit-1',
        transactionNumber: 'FX-AUD-001',
        transactionDate: '2026-03-31',
        foreignAmount: 1000,
        recordedRate: 55.0,
        settlementRate: 58.0,
        currency: 'USD',
        targetAccountId: fxAccId,
        sourceType: 'UNREALIZED_MONTH_END',
      });

    expect(fxRes.status).toBe(200);
    expect(fxRes.body.success).toBe(true);
    const postedJeId = fxRes.body.journalEntryId;
    expect(typeof postedJeId).toBe('string');

    // Inspect actual GL lines posted: must debit FX Bank 1055 and credit Unrealized FX Gain 4910 (NEVER 1100 Cash / 1200 AR / 4900 Realized)
    await dbContext.run(companyDb, async () => {
      const lines = await db
        .select({
          accountCode: schema.accounts.accountCode,
          accountName: schema.accounts.accountName,
          debit: schema.journalLines.debit,
          credit: schema.journalLines.credit,
        })
        .from(schema.journalLines)
        .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
        .where(eq(schema.journalLines.journalEntryId, postedJeId));

      expect(lines.find((l) => l.accountCode === '1100')).toBeUndefined();
      expect(lines.find((l) => l.accountCode === '1200')).toBeUndefined();
      expect(lines.find((l) => l.accountCode === '4900')).toBeUndefined();
      expect(lines.find((l) => l.accountCode === '1055')?.debit).toBe(300_000);
      expect(lines.find((l) => l.accountCode === '4910')?.credit).toBe(300_000);
    });
  });
});
