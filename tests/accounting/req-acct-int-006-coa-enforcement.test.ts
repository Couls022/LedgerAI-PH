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
import { createJournalEntry } from '../../src/server/db/domain';

describe('REQ-ACCT-INT-006 (COA-02) — Chart of Accounts Status & Parent-Header Posting Enforcement', () => {
  const app = createApp();
  const COMP_ID = 'LGR-PH-2026-TEST-COA-006';
  const OWNER_ID = 'usr-coa006-owner';
  let ownerToken = '';

  const PER_ID = 'per-coa-2026-01';
  let inactiveAccountId = '';
  let parentAccountId = '';
  let otherCompanyAccountId = '';
  let companyDb: any;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);
    await CompanyManager.resetDisposableTestCompanyWorkspace('LGR-PH-2026-TEST-COA-OTHER');

    await CompanyManager.createCompanyProfile(
      COMP_ID,
      'COA Enforcement Test Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    await CompanyManager.createCompanyProfile(
      'LGR-PH-2026-TEST-COA-OTHER',
      'Other Company Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    companyDb = await CompanyManager.getCompanyDb(COMP_ID);
    const otherDb = await CompanyManager.getCompanyDb('LGR-PH-2026-TEST-COA-OTHER');

    await dbContext.run(otherDb, async () => {
      otherCompanyAccountId = 'acc-other-1010';
      await db.insert(schema.accounts).values({
        id: otherCompanyAccountId,
        companyId: 'LGR-PH-2026-TEST-COA-OTHER',
        accountCode: '1010',
        accountName: 'Other Company Cash',
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        status: 'ACTIVE',
      });
    });

    await dbContext.run(companyDb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      await db.insert(schema.users).values({
        id: OWNER_ID,
        email: 'owner@coa-test.ph',
        displayName: 'COA Test Owner',
        passwordHash: 'hash',
        status: 'ACTIVE',
      });

      const roleRec = await RbacService.ensureRoleRecord('Company Owner');
      const memId = `mem-${OWNER_ID}`;
      await db.insert(schema.companyUsers).values({
        id: memId,
        userId: OWNER_ID,
        companyId: COMP_ID,
        roleId: roleRec.id,
        legacyRole: 'Company Owner',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
      });
      await RbacService.setMemberRoles(null, memId, ['Company Owner'], 'Seed owner');

      const rawSession = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawSession),
        userId: OWNER_ID,
        companyId: COMP_ID,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      ownerToken = `${COMP_ID}.${rawSession}`;

      await db.insert(schema.accountingPeriods).values({
        id: PER_ID,
        companyId: COMP_ID,
        name: 'January 2026',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        fiscalYear: 2026,
        status: 'OPEN',
      });

      inactiveAccountId = 'acc-inactive-1020';
      parentAccountId = 'acc-parent-1000';
      const childAccountId = 'acc-child-1100';

      await db.insert(schema.accounts).values([
        {
          id: 'acc-active-1010',
          companyId: COMP_ID,
          accountCode: '1010',
          accountName: 'Active Cash Account',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
        },
        {
          id: inactiveAccountId,
          companyId: COMP_ID,
          accountCode: '1020',
          accountName: 'Archived Suspense Account',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          status: 'INACTIVE',
        },
        {
          id: parentAccountId,
          companyId: COMP_ID,
          accountCode: '1000',
          accountName: 'Current Assets (Parent Header)',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
        },
        {
          id: childAccountId,
          companyId: COMP_ID,
          accountCode: '1100',
          accountName: 'Operating Cash',
          accountType: 'ASSET',
          detailType: 'CHECKING',
          normalBalance: 'DEBIT',
          parentAccountId: parentAccountId,
          isSubAccount: true,
          status: 'ACTIVE',
        },
        {
          id: 'acc-eq-3010',
          companyId: COMP_ID,
          accountCode: '3010',
          accountName: 'Capital',
          accountType: 'EQUITY',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
        },
      ]);
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);
    await CompanyManager.resetDisposableTestCompanyWorkspace('LGR-PH-2026-TEST-COA-OTHER');
  });

  it('1. Rejects transactions using INACTIVE accounts', async () => {
    await dbContext.run(companyDb, async () => {
      await expect(
        createJournalEntry(
          COMP_ID,
          {
            journalNumber: 'JE-COA-01',
            entryDate: '2026-01-10',
            accountingPeriodId: PER_ID,
            description: 'Test inactive account posting',
            createdBy: OWNER_ID,
          },
          [
            { accountId: inactiveAccountId, debit: 100000, credit: 0 },
            { accountId: 'acc-eq-3010', debit: 0, credit: 100000 },
          ]
        )
      ).rejects.toMatchObject({
        code: 'INACTIVE_ACCOUNT',
      });
    });
  });

  it('2. Rejects transactions posting directly to Parent Header accounts', async () => {
    await dbContext.run(companyDb, async () => {
      await expect(
        createJournalEntry(
          COMP_ID,
          {
            journalNumber: 'JE-COA-02',
            entryDate: '2026-01-10',
            accountingPeriodId: PER_ID,
            description: 'Test parent header posting rejection',
            createdBy: OWNER_ID,
          },
          [
            { accountId: parentAccountId, debit: 100000, credit: 0 },
            { accountId: 'acc-eq-3010', debit: 0, credit: 100000 },
          ]
        )
      ).rejects.toMatchObject({
        code: 'PARENT_HEADER_ACCOUNT_POSTING_PROHIBITED',
      });
    });
  });

  it('3. Rejects accounts belonging to another company (Tenant isolation)', async () => {
    await dbContext.run(companyDb, async () => {
      await expect(
        createJournalEntry(
          COMP_ID,
          {
            journalNumber: 'JE-COA-03',
            entryDate: '2026-01-10',
            accountingPeriodId: PER_ID,
            description: 'Test cross-company account rejection',
            createdBy: OWNER_ID,
          },
          [
            { accountId: otherCompanyAccountId, debit: 100000, credit: 0 },
            { accountId: 'acc-eq-3010', debit: 0, credit: 100000 },
          ]
        )
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
