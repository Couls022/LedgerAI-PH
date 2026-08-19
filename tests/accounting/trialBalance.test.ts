import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import crypto from 'crypto';
import { createJournalEntry, submitJournalEntry, approveJournalEntry, postJournalEntry } from '../../src/server/db/domain';
import { runInTestDb } from '../setup';

describe('Trial Balance & Reconciliation Pipeline', () => {
  const companyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const userId2 = crypto.randomUUID();
  const accAsset = crypto.randomUUID();
  const accRev = crypto.randomUUID();
  const accExp = crypto.randomUUID();

  beforeAll(async () => {
    await runInTestDb(async () => {
      await db.insert(schema.companies).values({ id: companyId, legalName: 'TB Test Co', tin: '000', taxpayerClassification: 'INDIVIDUAL', vatStatus: 'NON_VAT', documentLocationPath: '', backupLocationPath: '', status: 'ACTIVE' });
      await db.insert(schema.users).values([
        { id: userId, email: `tb_${crypto.randomUUID()}@test.com`, displayName: 'TB', passwordHash: 'hash', role: 'Company Administrator', isActive: true },
        { id: userId2, email: `tb2_${crypto.randomUUID()}@test.com`, displayName: 'TB2', passwordHash: 'hash', role: 'Company Administrator', isActive: true }
      ]);
      await db.insert(schema.accounts).values([
        { id: accAsset, companyId, accountCode: '1010', accountName: 'Cash', accountType: 'ASSET', normalBalance: 'DEBIT', isActive: true },
        { id: accRev, companyId, accountCode: '4010', accountName: 'Sales', accountType: 'REVENUE', normalBalance: 'CREDIT', isActive: true },
        { id: accExp, companyId, accountCode: '5010', accountName: 'Rent', accountType: 'EXPENSE', normalBalance: 'DEBIT', isActive: true }
      ]);
    });
  });

  // Skip teardown to avoid complex FK resolution, test DB drops anyway
  afterAll(async () => {});

  it('should balance after posting multiple journals', async () => {
    await runInTestDb(async () => {
      // Journal 1: Sale
      const j1Id = await createJournalEntry(companyId, { journalNumber: 'TB-001', entryDate: '2026-01-01', description: 'Sale', createdBy: userId, userRole: 'Company Administrator' }, [
          { accountId: accAsset, debit: 1000, credit: 0 },
          { accountId: accRev, debit: 0, credit: 1000 }
        ]);
      await submitJournalEntry(companyId, j1Id, userId);
      await approveJournalEntry(companyId, j1Id, userId2);
      await postJournalEntry(companyId, j1Id, userId);

      // Journal 2: Expense
      const j2Id = await createJournalEntry(companyId, { journalNumber: 'TB-002', entryDate: '2026-01-02', description: 'Rent', createdBy: userId, userRole: 'Company Administrator' }, [
          { accountId: accExp, debit: 400, credit: 0 },
          { accountId: accAsset, debit: 0, credit: 400 }
        ]);
      await submitJournalEntry(companyId, j2Id, userId);
      await approveJournalEntry(companyId, j2Id, userId2);
      await postJournalEntry(companyId, j2Id, userId);

      // Query Trial Balance
      const balances = await db.select({
        accountId: schema.accounts.id,
        debitTotal: sql<number>`sum(${schema.journalLines.debit})`,
        creditTotal: sql<number>`sum(${schema.journalLines.credit})`
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(and(
        eq(schema.journalEntries.companyId, companyId),
        eq(schema.journalEntries.status, "POSTED")
      ))
      .groupBy(schema.accounts.id);

      let totalD = 0;
      let totalC = 0;

      for (const b of balances) {
        totalD += b.debitTotal;
        totalC += b.creditTotal;
      }

      expect(totalD).toBe(1400); // 1000 + 400
      expect(totalC).toBe(1400); // 1000 + 400
      expect(totalD).toEqual(totalC); // DEBIT = CREDIT
    });
  });
});
