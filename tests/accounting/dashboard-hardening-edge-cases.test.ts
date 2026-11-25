import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { CompanyManager } from '../../src/server/services/companyManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { createJournalEntry, postJournalEntry, voidJournalEntry } from '../../src/server/db/domain';
import { AccountingEngine } from '../../src/server/services/accountingEngine';

describe('Dashboard Hardening & Edge-Case Resilience Audit', () => {
  const COMP_ID = 'LGR-PH-2026-TEST-DASH-EDGE';
  const USER_ID = 'usr-dash-test';
  let companyDb: any;
  let cashAccId = '';
  let arAccId = '';
  let apAccId = '';
  let eqAccId = '';

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);
    await CompanyManager.createCompanyProfile(
      COMP_ID,
      'Dashboard Edge Test Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    companyDb = await CompanyManager.getCompanyDb(COMP_ID);

    await dbContext.run(companyDb, async () => {
      await db.insert(schema.users).values({
        id: USER_ID,
        email: 'dash@test.ph',
        displayName: 'Dash Test User',
        passwordHash: 'hash',
        status: 'ACTIVE',
      });

      await db.insert(schema.accountingPeriods).values({
        id: 'per-dash-01',
        companyId: COMP_ID,
        name: 'January 2026',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        fiscalYear: 2026,
        status: 'OPEN',
      });

      cashAccId = 'acc-dash-1010';
      arAccId = 'acc-dash-1030';
      apAccId = 'acc-dash-2010';
      eqAccId = 'acc-dash-3010';

      await db.insert(schema.accounts).values([
        {
          id: cashAccId,
          companyId: COMP_ID,
          accountCode: '1010',
          accountName: 'Cash in Bank',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isCashAccount: true,
          status: 'ACTIVE',
        },
        {
          id: arAccId,
          companyId: COMP_ID,
          accountCode: '1030',
          accountName: 'Accounts Receivable',
          accountType: 'RECEIVABLE',
          normalBalance: 'DEBIT',
          isControlAccount: true,
          status: 'ACTIVE',
        },
        {
          id: apAccId,
          companyId: COMP_ID,
          accountCode: '2010',
          accountName: 'Accounts Payable',
          accountType: 'PAYABLE',
          normalBalance: 'CREDIT',
          isControlAccount: true,
          status: 'ACTIVE',
        },
        {
          id: eqAccId,
          companyId: COMP_ID,
          accountCode: '3010',
          accountName: 'Capital',
          accountType: 'EQUITY',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
        },
        {
          id: 'acc-dash-inactive',
          companyId: COMP_ID,
          accountCode: '1099',
          accountName: 'Inactive Cash',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isCashAccount: true,
          status: 'INACTIVE',
        },
      ]);
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);
  });

  it('1. Rejects postings to INACTIVE cash accounts', async () => {
    await dbContext.run(companyDb, async () => {
      await expect(
        createJournalEntry(
          COMP_ID,
          {
            journalNumber: 'JE-EDGE-01',
            entryDate: '2026-01-15',
            accountingPeriodId: 'per-dash-01',
            description: 'Test inactive cash posting',
            createdBy: USER_ID,
          },
          [
            { accountId: 'acc-dash-inactive', debit: 100000, credit: 0 },
            { accountId: eqAccId, debit: 0, credit: 100000 },
          ]
        )
      ).rejects.toMatchObject({
        code: 'INACTIVE_ACCOUNT',
      });
    });
  });

  it('2. Enforces idempotency and duplicate source posting prevention', async () => {
    await dbContext.run(companyDb, async () => {
      await AccountingEngine.postBalancedJournalEntry(COMP_ID, {
        journalNumber: 'JE-DUP-01',
        entryDate: '2026-01-15',
        description: 'Idempotency test entry',
        sourceType: 'TEST_SOURCE',
        sourceId: 'src-123',
        createdBy: USER_ID,
      }, [
        { accountId: cashAccId, debit: 500000, credit: 0 },
        { accountId: eqAccId, debit: 0, credit: 500000 },
      ]);

      // Attempt duplicate posting with same sourceType and sourceId must fail
      await expect(
        AccountingEngine.postBalancedJournalEntry(COMP_ID, {
          journalNumber: 'JE-DUP-02',
          entryDate: '2026-01-15',
          description: 'Duplicate idempotency test',
          sourceType: 'TEST_SOURCE',
          sourceId: 'src-123',
          createdBy: USER_ID,
        }, [
          { accountId: cashAccId, debit: 500000, credit: 0 },
          { accountId: eqAccId, debit: 0, credit: 500000 },
        ])
      ).rejects.toMatchObject({
        code: 'DUPLICATE_JOURNAL_POSTING',
      });
    });
  });
});
