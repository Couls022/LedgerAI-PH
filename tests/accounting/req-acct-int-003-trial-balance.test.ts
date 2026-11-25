import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import {
  createJournalEntry,
  submitJournalEntry,
  approveJournalEntry,
  postJournalEntry,
} from '../../src/server/db/domain';

describe('REQ-ACCT-INT-003 (TB-01): Trial Balance 6-Column Opening/Period/Closing & GL Drill-Down', () => {
  const app = createApp();
  const COMP_ID = 'LGR-PH-2026-TEST-TB-01';
  const OWNER_ID = 'usr-tb-owner';
  const APPROVER_ID = 'usr-tb-approver';
  let ownerToken = '';

  const PER_JAN = 'per-tb-2026-01';
  const PER_FEB = 'per-tb-2026-02';

  const ACC_CASH = 'acc-tb-1010';
  const ACC_AR = 'acc-tb-1030';
  const ACC_AP_ZERO = 'acc-tb-2010';
  const ACC_OBE = 'acc-tb-3090';
  const ACC_EQ = 'acc-tb-3010';
  const ACC_REV = 'acc-tb-4010';
  const ACC_EXP = 'acc-tb-6010';
  const ACC_INACTIVE_ZERO = 'acc-tb-6999';

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);

    await CompanyManager.createCompanyProfile(
      COMP_ID,
      'Trial Balance Test Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    const companyDb = await CompanyManager.getCompanyDb(COMP_ID);
    const companySqlite = await CompanyManager.getCompanySqlite(COMP_ID);
    companySqlite.prepare('DELETE FROM accounting_periods WHERE company_id = ?').run(COMP_ID);
    companySqlite.prepare('DELETE FROM accounts WHERE company_id = ?').run(COMP_ID);

    await dbContext.run(companyDb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      const seedUser = async (uid: string, email: string, name: string, roleName: string) => {
        await db.insert(schema.users).values({
          id: uid,
          email,
          displayName: name,
          passwordHash: 'hash',
          status: 'ACTIVE',
        }).onConflictDoNothing();
        const roleRec = await RbacService.ensureRoleRecord(roleName);
        const memId = `mem-${uid}`;
        await db.insert(schema.companyUsers).values({
          id: memId,
          userId: uid,
          companyId: COMP_ID,
          roleId: roleRec.id,
          legacyRole: roleName,
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: 'COMPANY_WIDE',
          approvalLimitCentavos: 100_000_000_00,
        }).onConflictDoNothing();
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

      ownerToken = await seedUser(OWNER_ID, 'owner@tb01.ph', 'TB Owner', 'Company Owner');
      await seedUser(APPROVER_ID, 'approver@tb01.ph', 'TB Manager', 'Finance Manager');

      await db.insert(schema.accountingPeriods).values([
        { id: PER_JAN, companyId: COMP_ID, name: '2026-01', fiscalYear: 2026, startDate: '2026-01-01', endDate: '2026-01-31', status: 'OPEN' },
        { id: PER_FEB, companyId: COMP_ID, name: '2026-02', fiscalYear: 2026, startDate: '2026-02-01', endDate: '2026-02-28', status: 'OPEN' },
      ]);

      await db.insert(schema.accounts).values([
        { id: ACC_CASH, companyId: COMP_ID, accountCode: '1010', accountName: 'Cash in Bank', accountType: 'ASSET', detailType: 'CHECKING', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_AR, companyId: COMP_ID, accountCode: '1030', accountName: 'Accounts Receivable', accountType: 'RECEIVABLE', detailType: 'TRADE_RECEIVABLE', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_AP_ZERO, companyId: COMP_ID, accountCode: '2010', accountName: 'Accounts Payable Zero', accountType: 'PAYABLE', detailType: 'TRADE_PAYABLE', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_EQ, companyId: COMP_ID, accountCode: '3010', accountName: 'Share Capital', accountType: 'EQUITY', detailType: 'PAID_IN_CAPITAL', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_OBE, companyId: COMP_ID, accountCode: '3090', accountName: 'Opening Balance Equity', accountType: 'EQUITY', detailType: 'OPENING_BALANCE_EQUITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_REV, companyId: COMP_ID, accountCode: '4010', accountName: 'Service Revenue', accountType: 'REVENUE', detailType: 'SERVICE_INCOME', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_EXP, companyId: COMP_ID, accountCode: '6010', accountName: 'Rent Expense', accountType: 'EXPENSE', detailType: 'RENT_EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_INACTIVE_ZERO, companyId: COMP_ID, accountCode: '6999', accountName: 'Inactive Archive Expense', accountType: 'EXPENSE', detailType: 'SUPPLIES_EXPENSE', normalBalance: 'DEBIT', status: 'INACTIVE' },
      ]);

      const postJe = async (num: string, date: string, per: string, src: string, lines: Array<{ accountId: string; debit: number; credit: number }>) => {
        const jId = await createJournalEntry(
          COMP_ID,
          { journalNumber: num, entryDate: date, description: num, accountingPeriodId: per, sourceType: src, createdBy: OWNER_ID, userRole: 'Company Owner' },
          lines
        );
        await submitJournalEntry(COMP_ID, jId, OWNER_ID);
        await approveJournalEntry(COMP_ID, jId, APPROVER_ID);
        await postJournalEntry(COMP_ID, jId, APPROVER_ID, 'Finance Manager');
      };

      // Jan explicit OPENING_BALANCE journal: ₱500,000.00 Cash
      await postJe('JE-OPEN-01', '2026-01-01', PER_JAN, 'OPENING_BALANCE', [
        { accountId: ACC_CASH, debit: 50_000_000, credit: 0 },
        { accountId: ACC_OBE, debit: 0, credit: 50_000_000 },
      ]);

      // Jan operational journal: ₱120,000.00 Cash sale
      await postJe('JE-JAN-01', '2026-01-15', PER_JAN, 'MANUAL', [
        { accountId: ACC_CASH, debit: 12_000_000, credit: 0 },
        { accountId: ACC_REV, debit: 0, credit: 12_000_000 },
      ]);

      // Feb operational journal: ₱80,000.00 AR billing + ₱30,000.00 Cash Rent
      await postJe('JE-FEB-01', '2026-02-10', PER_FEB, 'MANUAL', [
        { accountId: ACC_AR, debit: 8_000_000, credit: 0 },
        { accountId: ACC_REV, debit: 0, credit: 8_000_000 },
      ]);
      await postJe('JE-FEB-02', '2026-02-18', PER_FEB, 'MANUAL', [
        { accountId: ACC_EXP, debit: 3_000_000, credit: 0 },
        { accountId: ACC_CASH, debit: 0, credit: 3_000_000 },
      ]);
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);
  });

  it('1. Period-scoped Trial Balance (Feb) separates brought-forward Opening, Feb Movement, and Closing totals with DR === CR', async () => {
    const res = await request(app)
      .get(`/api/reports/trial-balance?accountingPeriodId=${PER_FEB}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const rows = res.body as any[];

    const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
    // Brought forward from Jan: 500k opening + 120k Jan rev = 620k
    expect(sum('openingDebit')).toBe(62_000_000);
    expect(sum('openingCredit')).toBe(62_000_000);
    // Feb operational movement: 80k AR + 30k Rent = 110k
    expect(sum('periodDebit')).toBe(11_000_000);
    expect(sum('periodCredit')).toBe(11_000_000);
    // Closing: 620k + 110k = 730k
    expect(sum('closingDebit')).toBe(73_000_000);
    expect(sum('closingCredit')).toBe(73_000_000);

    const cash = rows.find((r) => r.accountCode === '1010');
    expect(cash.openingDebit).toBe(62_000_000);
    expect(cash.periodDebit).toBe(0);
    expect(cash.periodCredit).toBe(3_000_000);
    expect(cash.closingNetBalance).toBe(59_000_000);
  });

  it('2. Period-scoped Trial Balance (Jan) classifies 2026-01-01 OPENING_BALANCE into Opening columns without double-counting Period columns', async () => {
    const res = await request(app)
      .get(`/api/reports/trial-balance?accountingPeriodId=${PER_JAN}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const rows = res.body as any[];

    const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
    expect(sum('openingDebit')).toBe(50_000_000);
    expect(sum('openingCredit')).toBe(50_000_000);
    expect(sum('periodDebit')).toBe(12_000_000);
    expect(sum('periodCredit')).toBe(12_000_000);
    expect(sum('closingDebit')).toBe(62_000_000);
    expect(sum('closingCredit')).toBe(62_000_000);
  });

  it('3. includeZeroBalances=true returns active zero-balance COA accounts while excluding INACTIVE zero accounts', async () => {
    const defaultRes = await request(app)
      .get(`/api/reports/trial-balance?accountingPeriodId=${PER_FEB}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect((defaultRes.body as any[]).some((r) => r.accountCode === '2010')).toBe(false);

    const withZeroRes = await request(app)
      .get(`/api/reports/trial-balance?accountingPeriodId=${PER_FEB}&includeZeroBalances=true`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(withZeroRes.status).toBe(200);
    const rows = withZeroRes.body as any[];
    const apZero = rows.find((r) => r.accountCode === '2010');
    expect(apZero).toBeDefined();
    expect(apZero.openingDebit).toBe(0);
    expect(apZero.closingNetBalance).toBe(0);
    expect(rows.some((r) => r.accountCode === '6999')).toBe(false);
  });

  it('4. Trial Balance row reconciles centavo-for-centavo with General Ledger drill-down for the same account & period', async () => {
    const tbRes = await request(app)
      .get(`/api/reports/trial-balance?accountingPeriodId=${PER_FEB}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const revRow = (tbRes.body as any[]).find((r) => r.accountCode === '4010');
    expect(revRow.openingNetBalance).toBe(12_000_000);
    expect(revRow.periodCredit).toBe(8_000_000);
    expect(revRow.closingNetBalance).toBe(20_000_000);

    const glRes = await request(app)
      .get(`/api/reports/general-ledger?accountId=${ACC_REV}&accountingPeriodId=${PER_FEB}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(glRes.status).toBe(200);
    const glRows = glRes.body as any[];
    expect(glRows.length).toBe(1);
    expect(glRows[0].broughtForwardBalance).toBe(revRow.openingNetBalance);
    expect(glRows[0].credit).toBe(revRow.periodCredit);
    expect(glRows[0].runningBalance).toBe(revRow.closingNetBalance);
  });
});
