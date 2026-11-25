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
import { AccountingEngine } from '../../src/server/services/accountingEngine';
import { updateJournalEntry, voidJournalEntry, hardClosePeriod } from '../../src/server/db/domain';

describe('REQ-ACCT-INT-002: Journal Integrity, Period Sync, Idempotency & Route Hardening', () => {
  const app = createApp();
  const COMP_ID = 'LGR-PH-2026-TEST-JE-INT';
  const OWNER_ID = 'usr-je-owner';
  let ownerToken = '';

  const PER_JAN = 'per-je-2026-01';
  const PER_FEB = 'per-je-2026-02';
  const PER_MAR_LOCKED = 'per-je-2026-03';

  const ACC_CASH = 'acc-je-1010';
  const ACC_EXP = 'acc-je-6010';

  let companyDb: any;
  let companySqlite: any;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);

    await CompanyManager.createCompanyProfile(
      COMP_ID,
      'Journal Integrity Synthetic Corp.',
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
      await db
        .insert(schema.users)
        .values({ id: OWNER_ID, email: 'owner@je-int.ph', displayName: 'JE Owner', passwordHash: 'h', status: 'ACTIVE' })
        .onConflictDoNothing();

      const roleRec = await RbacService.ensureRoleRecord('Company Owner');
      const memId = `mem-${OWNER_ID}`;
      await db
        .insert(schema.companyUsers)
        .values({
          id: memId,
          userId: OWNER_ID,
          companyId: COMP_ID,
          roleId: roleRec.id,
          legacyRole: 'Company Owner',
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: 'COMPANY_WIDE',
          approvalLimitCentavos: 100_000_000_00,
        })
        .onConflictDoNothing();
      await RbacService.setMemberRoles(null, memId, ['Company Owner'], 'Seed Owner');

      const rawSession = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawSession),
        userId: OWNER_ID,
        companyId: COMP_ID,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      ownerToken = `${COMP_ID}.${rawSession}`;

      await db.insert(schema.accountingPeriods).values([
        { id: PER_JAN, companyId: COMP_ID, name: 'Jan 2026', startDate: '2026-01-01', endDate: '2026-01-31', fiscalYear: 2026, status: 'OPEN' },
        { id: PER_FEB, companyId: COMP_ID, name: 'Feb 2026', startDate: '2026-02-01', endDate: '2026-02-28', fiscalYear: 2026, status: 'OPEN' },
        { id: PER_MAR_LOCKED, companyId: COMP_ID, name: 'Mar 2026', startDate: '2026-03-01', endDate: '2026-03-31', fiscalYear: 2026, status: 'OPEN' },
      ]);

      await db.insert(schema.accounts).values([
        { id: ACC_CASH, companyId: COMP_ID, accountCode: '1010', accountName: 'Cash', accountType: 'ASSET', normalBalance: 'DEBIT', isCashAccount: true, status: 'ACTIVE' },
        { id: ACC_EXP, companyId: COMP_ID, accountCode: '6010', accountName: 'Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
      ]);
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);
  });

  it('1. Rejects 1-centavo imbalance and float centavos on PUT /journals/:id and excludes 1-centavo tampered JE from Trial Balance', async () => {
    const createRes = await request(app)
      .post('/api/accounting/journals')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        journalNumber: 'JE-BAL-001',
        entryDate: '2026-01-10',
        description: 'Exact balance guard',
        lines: [
          { accountId: ACC_EXP, debit: 10000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 10000 },
        ],
      });
    expect(createRes.status).toBe(201);
    const jeId = createRes.body.id;

    // 1-centavo imbalance rejected (10000 vs 9999)
    const putImbal = await request(app)
      .put(`/api/accounting/journals/${jeId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        entryDate: '2026-01-10',
        description: '1 centavo off',
        lines: [
          { accountId: ACC_EXP, debit: 10000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 9999 },
        ],
      });
    expect(putImbal.status).toBe(400);
    expect(putImbal.body.error).toBe('UNBALANCED_JOURNAL_ERROR');

    // Fractional float centavo rejected (100.5)
    const putFloat = await request(app)
      .put(`/api/accounting/journals/${jeId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        entryDate: '2026-01-10',
        description: 'Float centavo',
        lines: [
          { accountId: ACC_EXP, debit: 100.5, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 100.5 },
        ],
      });
    expect(putFloat.status).toBe(400);
    expect(putFloat.body.error).toBe('VALIDATION_ERROR');

    // Raw SQL 1-centavo off POSTED journal is excluded by buildEffectivePostedJournalPredicate
    const rawId = crypto.randomUUID();
    companySqlite.prepare(`
      INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, status, created_by)
      VALUES (?, ?, 'JE-RAW-1C', '2026-01-12', ?, '1 centavo skewed raw row', 'POSTED', ?)
    `).run(rawId, COMP_ID, PER_JAN, OWNER_ID);
    companySqlite.prepare(`
      INSERT INTO journal_lines (id, journal_entry_id, account_id, debit, credit, line_number) VALUES
      (?, ?, ?, 10000, 0, 1),
      (?, ?, ?, 0, 9999, 2)
    `).run(crypto.randomUUID(), rawId, ACC_EXP, crypto.randomUUID(), rawId, ACC_CASH);

    const tbRes = await request(app)
      .get('/api/reports/trial-balance?startDate=2026-01-01&endDate=2026-01-31')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(tbRes.status).toBe(200);
    expect(tbRes.body.length).toBe(0);

    // Clean up raw skewed row so subsequent checks remain valid
    companySqlite.prepare('DELETE FROM journal_lines WHERE journal_entry_id = ?').run(rawId);
    companySqlite.prepare('DELETE FROM journal_entries WHERE id = ?').run(rawId);
  });

  it('2. Synchronizes accountingPeriodId in both PUT /journals/:id and domain.updateJournalEntry, and rejects moves into uninitialized periods', async () => {
    const createRes = await request(app)
      .post('/api/accounting/journals')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        journalNumber: 'JE-SYNC-001',
        entryDate: '2026-01-15',
        description: 'Period sync test',
        lines: [
          { accountId: ACC_EXP, debit: 20000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 20000 },
        ],
      });
    const jeId = createRes.body.id;

    // Move to April (no accounting period exists) -> fail closed
    const putNoPeriod = await request(app)
      .put(`/api/accounting/journals/${jeId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        entryDate: '2026-04-10',
        description: 'No period',
        lines: [
          { accountId: ACC_EXP, debit: 20000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 20000 },
        ],
      });
    expect([400, 403]).toContain(putNoPeriod.status);
    expect(putNoPeriod.body.error).toBe('PERIOD_CLOSED_ERROR');

    // Domain updateJournalEntry moves Jan -> Feb cleanly and updates accountingPeriodId
    await dbContext.run(companyDb, async () => {
      const updated = await updateJournalEntry(COMP_ID, jeId, {
        entryDate: '2026-02-14',
        description: 'Moved via domain',
        updatedBy: OWNER_ID,
        userRole: 'Company Owner',
      });
      expect(updated.accountingPeriodId).toBe(PER_FEB);
    });
  });

  it('3. Blocks duplicate source postings across AccountingEngine and DB partial unique index', async () => {
    await dbContext.run(companyDb, async () => {
      const firstId = await AccountingEngine.postBalancedJournalEntry(
        COMP_ID,
        {
          journalNumber: 'JE-IDEM-001',
          entryDate: '2026-01-20',
          description: 'Idempotent Automated Posting',
          sourceType: 'sales_invoices',
          sourceId: 'inv-idem-999',
          createdBy: OWNER_ID,
          userRole: 'Company Owner',
        },
        [
          { accountId: ACC_CASH, debit: 50000, credit: 0 },
          { accountId: ACC_EXP, debit: 0, credit: 50000 },
        ]
      );
      expect(firstId).toBeTruthy();

      await expect(
        AccountingEngine.postBalancedJournalEntry(
          COMP_ID,
          {
            journalNumber: 'JE-IDEM-001-DUP',
            entryDate: '2026-01-20',
            description: 'Duplicate Attempt',
            sourceType: 'sales_invoices',
            sourceId: 'inv-idem-999',
            createdBy: OWNER_ID,
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_CASH, debit: 50000, credit: 0 },
            { accountId: ACC_EXP, debit: 0, credit: 50000 },
          ]
        )
      ).rejects.toThrow(/DUPLICATE_JOURNAL_POSTING/);

      // Verify SQL partial unique index also rejects raw duplicate insert
      expect(() => {
        companySqlite.prepare(`
          INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, created_by)
          VALUES (?, ?, 'JE-RAW-DUP', '2026-01-20', ?, 'Raw dup', 'sales_invoices', 'inv-idem-999', 'POSTED', ?)
        `).run(crypto.randomUUID(), COMP_ID, PER_JAN, OWNER_ID);
      }).toThrow(/UNIQUE constraint failed/i);
    });
  });

  it('4. Enforces period lock check in voidJournalEntry and exposes Bank Reconciliation route cleanly', async () => {
    const draftMar = await request(app)
      .post('/api/accounting/journals')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        journalNumber: 'JE-MAR-VOID-01',
        entryDate: '2026-03-10',
        description: 'March draft before lock',
        lines: [
          { accountId: ACC_EXP, debit: 10000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 10000 },
        ],
      });
    expect(draftMar.status).toBe(201);
    const marJeId = draftMar.body.id;

    // Hard close March, then verify voidJournalEntry blocks voiding inside HARD_CLOSED period
    await dbContext.run(companyDb, async () => {
      await hardClosePeriod(COMP_ID, PER_MAR_LOCKED, OWNER_ID);
      await expect(
        voidJournalEntry(COMP_ID, marJeId, OWNER_ID, 'Attempt void in closed period', 'Company Owner')
      ).rejects.toThrow(/HARD_CLOSED|PERIOD_LOCKED/i);
    });

    // Verify Bank Reconciliation GET endpoint (defined after former duplicate routes) works cleanly
    const brRes = await request(app)
      .get('/api/accounting/bank-reconciliations')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(brRes.status).toBe(200);
    expect(Array.isArray(brRes.body)).toBe(true);
  });
});
