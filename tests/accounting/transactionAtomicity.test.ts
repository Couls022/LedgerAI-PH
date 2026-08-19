import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { createJournalEntry } from '../../src/server/db/domain';
import { runInTestDb } from '../setup';

describe('Transaction Atomicity & Rollback Test Suite', () => {
  const companyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const acc1 = crypto.randomUUID();
  const acc2 = crypto.randomUUID();

  beforeAll(async () => {
    await runInTestDb(async () => {
      await db.insert(schema.companies).values({ id: companyId, legalName: 'Atomic Co', tin: '000', taxpayerClassification: 'INDIVIDUAL', vatStatus: 'NON_VAT', documentLocationPath: '', backupLocationPath: '', status: 'ACTIVE' });
      await db.insert(schema.users).values({ id: userId, email: 'atom@test.com', displayName: 'Atom', passwordHash: 'hash', role: 'Company Administrator', isActive: true });
      await db.insert(schema.accounts).values([
        { id: acc1, companyId, accountCode: '1010', accountName: 'Cash', accountType: 'ASSET', normalBalance: 'DEBIT', isActive: true },
        { id: acc2, companyId, accountCode: '4010', accountName: 'Sales', accountType: 'REVENUE', normalBalance: 'CREDIT', isActive: true }
      ]);
    });
  });

  afterAll(async () => {
    await runInTestDb(async () => {
      await db.delete(schema.accounts).where(eq(schema.accounts.companyId, companyId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
    });
  });

  it('should fail transaction atomicity safely if journal is unbalanced', async () => {
    await runInTestDb(async () => {
      // Expect failure because debits do not equal credits
      await expect(createJournalEntry(companyId, {
        journalNumber: "TEST-ATOM-001",
        entryDate: new Date().toISOString().split('T')[0],
        description: "Unbalanced",
        createdBy: userId,
        userRole: "Company Administrator",
      }, [
        { accountId: acc1, debit: 112000, credit: 0 },
        { accountId: acc2, debit: 0, credit: 100000 }
      ])).rejects.toThrow('Journal entry is unbalanced');

      // Verify it rolled back (no entry created)
      const entries = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.journalNumber, "TEST-ATOM-001"));
      expect(entries.length).toBe(0);
    });
  });
});
