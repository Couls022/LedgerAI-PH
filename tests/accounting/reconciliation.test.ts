import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { createJournalEntry, submitJournalEntry, approveJournalEntry, postJournalEntry } from '../../src/server/db/domain';
import { runInTestDb } from '../setup';

describe('Accounting Reconciliation & Invariant Test Suite', () => {
  const companyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const userId2 = crypto.randomUUID();
  const acc1 = crypto.randomUUID();
  const acc2 = crypto.randomUUID();
  const acc3 = crypto.randomUUID();

  beforeAll(async () => {
    await runInTestDb(async () => {
      await db.insert(schema.companies).values({ id: companyId, legalName: 'Recon Test Co', tin: '000', taxpayerClassification: 'INDIVIDUAL', vatStatus: 'NON_VAT', documentLocationPath: '', backupLocationPath: '', status: 'ACTIVE' });
      await db.insert(schema.users).values([
        { id: userId, email: `recon_${crypto.randomUUID()}@test.com`, displayName: 'Recon', passwordHash: 'hash', role: 'Company Administrator', isActive: true },
        { id: userId2, email: `approver_${crypto.randomUUID()}@test.com`, displayName: 'Approver', passwordHash: 'hash', role: 'Company Administrator', isActive: true }
      ]);
      await db.insert(schema.accounts).values([
        { id: acc1, companyId, accountCode: '1010', accountName: 'Cash', accountType: 'ASSET', normalBalance: 'DEBIT', isActive: true },
        { id: acc2, companyId, accountCode: '4010', accountName: 'Sales', accountType: 'REVENUE', normalBalance: 'CREDIT', isActive: true },
        { id: acc3, companyId, accountCode: '2110', accountName: 'VAT Output', accountType: 'LIABILITY', normalBalance: 'CREDIT', isActive: true }
      ]);
    });
  });

  afterAll(async () => {
    await runInTestDb(async () => {
      try {
        await db.delete(schema.journalLines).where(sql`${schema.journalLines.accountId} IN (${acc1}, ${acc2}, ${acc3})`);
        await db.delete(schema.journalEntries).where(eq(schema.journalEntries.companyId, companyId));
        await db.delete(schema.accounts).where(eq(schema.accounts.companyId, companyId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
        await db.delete(schema.users).where(eq(schema.users.id, userId2));
        await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
      } catch (e) {
        // Ignore cleanup FK errors
      }
    });
  });

  it('should maintain debits equal to credits for a Cash Sale transaction and verify TB', async () => {
    await runInTestDb(async () => {
      const journalId = await createJournalEntry(companyId, {
        journalNumber: "TEST-CS-001",
        entryDate: new Date().toISOString().split('T')[0],
        description: "Cash Sale",
        createdBy: userId,
        userRole: "Company Administrator",
      }, [
        { accountId: acc1, debit: 112000, credit: 0 },
        { accountId: acc2, debit: 0, credit: 100000 },
        { accountId: acc3, debit: 0, credit: 12000 }
      ]);

      await submitJournalEntry(companyId, journalId, userId);
      await approveJournalEntry(companyId, journalId, userId2);
      await postJournalEntry(companyId, journalId, userId2, "Company Administrator");

      const balances = await db.select({
        debitTotal: sql<number>`sum(${schema.journalLines.debit})`,
        creditTotal: sql<number>`sum(${schema.journalLines.credit})`
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .where(eq(schema.journalEntries.id, journalId));

      const totalDebit = balances[0].debitTotal;
      const totalCredit = balances[0].creditTotal;

      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(112000);
    });
  });
});
