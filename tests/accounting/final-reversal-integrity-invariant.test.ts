import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { FinancialIntegrityService } from '../../src/server/services/financialIntegrityService';
import { assertNoDuplicateReversalLineage } from '../../src/server/routes/reports';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import {
  createJournalEntry,
  submitJournalEntry,
  approveJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
} from '../../src/server/db/domain';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import { eq, and } from 'drizzle-orm';

describe('LEDGERAI PH — Final Reversal Integrity Invariant Verification', () => {
  const app = createApp();

  const TEST_COMP_ID = 'LGR-PH-TEST-REV-INVARIANT-01';
  const OWNER_ID = 'usr-rev-owner-01';
  let ownerToken = '';
  const PER_JAN = 'per-rev-2026-01';
  const PER_FEB = 'per-rev-2026-02';

  const ACC_CASH = 'acc-rev-1010';
  const ACC_REV = 'acc-rev-4010';
  const ACC_EXP = 'acc-rev-5010';

  let sqlite: any;
  let companyDb: any;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    try {
      await CompanyManager.resetDisposableTestCompanyWorkspace(TEST_COMP_ID);
    } catch (_) {}

    await CompanyManager.createCompanyProfile(
      TEST_COMP_ID,
      'Reversal Invariant Validation Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    companyDb = await CompanyManager.getCompanyDb(TEST_COMP_ID);
    sqlite = await CompanyManager.getCompanySqlite(TEST_COMP_ID);

    // Clear auto-provisioned periods
    sqlite.prepare(`DELETE FROM accounting_periods WHERE company_id = ?`).run(TEST_COMP_ID);

    await dbContext.run(companyDb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      // Setup Owner
      await db.insert(schema.users).values({
        id: OWNER_ID,
        email: 'owner-reversal@ledgerai.ph',
        displayName: 'Reversal Test Owner',
        passwordHash: 'test_hash',
        role: 'OWNER',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      const roleRec = await RbacService.ensureRoleRecord('Company Owner');
      const memId = `mem-${OWNER_ID}`;
      await db.insert(schema.companyUsers).values({
        id: memId,
        userId: OWNER_ID,
        companyId: TEST_COMP_ID,
        roleId: roleRec.id,
        legacyRole: 'Company Owner',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        defaultDataScope: 'COMPANY_WIDE',
      }).onConflictDoNothing();

      await RbacService.setMemberRoles(null, memId, ['Company Owner'], 'Seed Owner');

      const rawSession = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawSession),
        userId: OWNER_ID,
        companyId: TEST_COMP_ID,
        expiresAt: new Date(Date.now() + 86400000),
      }).run();
      ownerToken = `${TEST_COMP_ID}.${rawSession}`;

      // Accounting Periods
      await db.insert(schema.accountingPeriods).values([
        {
          id: PER_JAN,
          companyId: TEST_COMP_ID,
          name: 'January 2026',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          fiscalYear: 2026,
          periodNumber: 1,
          status: 'OPEN',
        },
        {
          id: PER_FEB,
          companyId: TEST_COMP_ID,
          name: 'February 2026',
          startDate: '2026-02-01',
          endDate: '2026-02-28',
          fiscalYear: 2026,
          periodNumber: 2,
          status: 'OPEN',
        }
      ]).run();

      // Accounts
      await db.insert(schema.accounts).values([
        {
          id: ACC_CASH,
          companyId: TEST_COMP_ID,
          accountCode: '1010',
          accountName: 'Cash in Bank',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
        },
        {
          id: ACC_REV,
          companyId: TEST_COMP_ID,
          accountCode: '4010',
          accountName: 'Service Revenue',
          accountType: 'REVENUE',
          normalBalance: 'CREDIT',
        },
        {
          id: ACC_EXP,
          companyId: TEST_COMP_ID,
          accountCode: '5010',
          accountName: 'Office Expenses',
          accountType: 'EXPENSE',
          normalBalance: 'DEBIT',
        }
      ]).run();
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    try {
      await CompanyManager.resetDisposableTestCompanyWorkspace(TEST_COMP_ID);
    } catch (_) {}
  });

  it('Requirement 1 & 6: Domain layer enforces at most 1 reversal child and preserves valid same-period & cross-period reversals', async () => {
    let originalId = '';
    let reversalId = '';

    await dbContext.run(companyDb, async () => {
      // Create and post valid original journal
      originalId = await createJournalEntry(
        TEST_COMP_ID,
        {
          journalNumber: 'JE-REV-INV-001',
          entryDate: '2026-01-15',
          accountingPeriodId: PER_JAN,
          description: 'Original Consulting Revenue Jan 2026',
          sourceType: 'GENERAL',
          createdBy: OWNER_ID,
        },
        [
          { accountId: ACC_CASH, debit: 5000000, credit: 0, description: 'Debit Cash' },
          { accountId: ACC_REV, debit: 0, credit: 5000000, description: 'Credit Revenue' }
        ]
      );
      await submitJournalEntry(TEST_COMP_ID, originalId, OWNER_ID);
      await approveJournalEntry(TEST_COMP_ID, originalId, OWNER_ID);
      await postJournalEntry(TEST_COMP_ID, originalId, OWNER_ID);

      // Verify original journal is posted
      const postedOrig = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, originalId)).get();
      expect(postedOrig.status).toBe('POSTED');

      // Execute legitimate reversal in Feb (cross-period)
      reversalId = await reverseJournalEntry(
        TEST_COMP_ID,
        originalId,
        OWNER_ID,
        '2026-02-05',
        PER_FEB,
        'COMPANY_OWNER'
      );
      expect(reversalId).toBeTruthy();

      // Original journal status must transition to REVERSED
      const updatedOrig = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, originalId)).get();
      expect(updatedOrig.status).toBe('REVERSED');
      expect(updatedOrig.reversedAt).toBeTruthy();

      // Reversal child must be POSTED with originalJournalId set
      const revEntry = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, reversalId)).get();
      expect(revEntry.status).toBe('POSTED');
      expect(revEntry.originalJournalId).toBe(originalId);
      expect(revEntry.journalNumber).toBe(`${updatedOrig.journalNumber}-REV`);

      // Attempt second reversal via domain function: MUST fail with ALREADY_REVERSED (409)
      await expect(
        reverseJournalEntry(
          TEST_COMP_ID,
          originalId,
          OWNER_ID,
          '2026-02-10',
          PER_FEB,
          'COMPANY_OWNER'
        )
      ).rejects.toThrow(/already been reversed|ALREADY_REVERSED/);
    });
  });

  it('Requirement 2: Database-level partial unique index prevents duplicate POSTED reversal children', async () => {
    // Attempt to bypass domain logic and insert a second POSTED reversal pointing to the same original journal
    await dbContext.run(companyDb, async () => {
      const orig = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.status, 'REVERSED')).get();
      expect(orig).toBeTruthy();

      const fakeReversalId2 = crypto.randomUUID();
      
      // Direct raw insert of a duplicate POSTED reversal child for the same originalJournalId
      expect(() => {
        sqlite.prepare(`
          INSERT INTO journal_entries (
            id, company_id, journal_number, entry_date, accounting_period_id,
            description, status, created_by, original_journal_id, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          fakeReversalId2,
          TEST_COMP_ID,
          'DUPLICATE-REV-TEST',
          '2026-02-15',
          PER_FEB,
          'Adversarial duplicate reversal',
          'POSTED',
          OWNER_ID,
          orig.id,
          1
        );
      }).toThrow(/UNIQUE constraint failed: journal_entries\.company_id, journal_entries\.original_journal_id/);
    });
  });

  it('Requirement 3, 4 & 5: When duplicate reversals are artificially injected (e.g. via direct raw SQL without index), Integrity Validation detects failure and financial reports refuse to silently run with corrupted lineage', async () => {
    let secondReversalId = '';
    let origId = '';

    await dbContext.run(companyDb, async () => {
      // Find the reversed entry
      const orig = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.status, 'REVERSED')).get();
      origId = orig.id;

      // Temporarily drop index to simulate legacy database corruption or adversarial raw DB write
      sqlite.exec('DROP INDEX IF EXISTS unq_reversal_child_per_original;');

      secondReversalId = crypto.randomUUID();
      // Inject duplicate POSTED reversal child
      sqlite.prepare(`
        INSERT INTO journal_entries (
          id, company_id, journal_number, entry_date, accounting_period_id,
          description, status, created_by, original_journal_id, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        secondReversalId,
        TEST_COMP_ID,
        'INJECTED-DUPLICATE-REV-02',
        '2026-02-20',
        PER_FEB,
        'Injected corrupted duplicate reversal',
        'POSTED',
        OWNER_ID,
        origId,
        1
      );

      // Also insert matching balanced lines for the injected reversal
      sqlite.prepare(`
        INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), secondReversalId, ACC_REV, 'Reverse Revenue', 5000000, 0, 1);
      sqlite.prepare(`
        INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), secondReversalId, ACC_CASH, 'Reverse Cash', 0, 5000000, 2);

      // Verify two POSTED reversal children now exist in the database for origId
      const children = sqlite.prepare(`
        SELECT id, journal_number, status FROM journal_entries WHERE original_journal_id = ? AND status = 'POSTED'
      `).all(origId);
      expect(children.length).toBe(2);

      // Requirement 4: FinancialIntegrityService audit MUST detect this corruption and flag it as FAIL/CRITICAL
      const integrityReport = await FinancialIntegrityService.auditCompanyFinancialIntegrity(TEST_COMP_ID);
      expect(integrityReport.overallStatus).toBe('CRITICAL');
      const reversalCheck = integrityReport.checks.find(c => c.category === 'REVERSAL_INTEGRITY');
      expect(reversalCheck).toBeTruthy();
      expect(reversalCheck?.status).toBe('FAIL');
      expect(reversalCheck?.details).toContain('CRITICAL INVARIANT VIOLATION');

      const reversalDiscrepancy = integrityReport.discrepancies.find(d => d.category === 'REVERSAL_INTEGRITY');
      expect(reversalDiscrepancy).toBeTruthy();
      expect(reversalDiscrepancy?.severity).toBe('CRITICAL');
      expect(reversalDiscrepancy?.actualValue).toBe(2);

      // Requirement 5: assertNoDuplicateReversalLineage AND HTTP Financial Report endpoints MUST explicitly refuse to silently run with corrupted lineage
      await expect(assertNoDuplicateReversalLineage(TEST_COMP_ID)).rejects.toThrow(
        /CRITICAL_REVERSAL_LINEAGE_CORRUPTION/
      );

      const tbCorruptedRes = await request(app)
        .get(`/api/reports/trial-balance?accountingPeriodId=${PER_FEB}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(tbCorruptedRes.status).toBe(409);
      expect(tbCorruptedRes.body.error).toBe('REVERSAL_LINEAGE_CORRUPTION');

      const isCorruptedRes = await request(app)
        .get(`/api/reports/income-statement?accountingPeriodId=${PER_FEB}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(isCorruptedRes.status).toBe(409);
      expect(isCorruptedRes.body.error).toBe('REVERSAL_LINEAGE_CORRUPTION');

      const integrityHttpRes = await request(app)
        .get('/api/reports/integrity-check')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(integrityHttpRes.status).toBe(200);
      expect(integrityHttpRes.body.status).toBe('FAIL');
      expect(integrityHttpRes.body.reversalLineageViolationsCount).toBe(1);
      expect(integrityHttpRes.body.duplicateReversals[0].originalJournalId).toBe(origId);
      expect(integrityHttpRes.body.duplicateReversals[0].reversalCount).toBe(2);

      // Clean up injected corrupted record and restore partial unique index
      sqlite.prepare(`DELETE FROM journal_lines WHERE journal_entry_id = ?`).run(secondReversalId);
      sqlite.prepare(`DELETE FROM journal_entries WHERE id = ?`).run(secondReversalId);

      sqlite.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS unq_reversal_child_per_original
        ON journal_entries(company_id, original_journal_id)
        WHERE original_journal_id IS NOT NULL AND status = 'POSTED';
      `);

      // Verify cleanliness restored and financial reports succeed again
      const cleanCheck = await FinancialIntegrityService.auditCompanyFinancialIntegrity(TEST_COMP_ID);
      const cleanRevCheck = cleanCheck.checks.find(c => c.category === 'REVERSAL_INTEGRITY');
      expect(cleanRevCheck?.status).toBe('PASS');

      const tbCleanRes = await request(app)
        .get(`/api/reports/trial-balance?accountingPeriodId=${PER_FEB}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(tbCleanRes.status).toBe(200);
    });
  });

  it('Requirement 7: Concurrency tests for two simultaneous reversal attempts on the same journal', async () => {
    let freshOrigId = '';
    let currentVersion = 1;
    await dbContext.run(companyDb, async () => {
      freshOrigId = await createJournalEntry(
        TEST_COMP_ID,
        {
          journalNumber: 'JE-REV-INV-002',
          entryDate: '2026-01-20',
          accountingPeriodId: PER_JAN,
          description: 'Fresh Journal for Concurrency Reversal Test',
          sourceType: 'GENERAL',
          createdBy: OWNER_ID,
        },
        [
          { accountId: ACC_EXP, debit: 1200000, credit: 0, description: 'Office supplies' },
          { accountId: ACC_CASH, debit: 0, credit: 1200000, description: 'Paid cash' }
        ]
      );
      await submitJournalEntry(TEST_COMP_ID, freshOrigId, OWNER_ID);
      await approveJournalEntry(TEST_COMP_ID, freshOrigId, OWNER_ID);
      await postJournalEntry(TEST_COMP_ID, freshOrigId, OWNER_ID);

      const je = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, freshOrigId)).get();
      currentVersion = je.version || 1;
    });

    // Fire two simultaneous reversal requests with the posted entry's current version
    const resA = request(app)
      .post(`/api/accounting/journals/${freshOrigId}/reverse`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reverseDate: '2026-02-12', newPeriodId: PER_FEB, expectedVersion: currentVersion });

    const resB = request(app)
      .post(`/api/accounting/journals/${freshOrigId}/reverse`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reverseDate: '2026-02-12', newPeriodId: PER_FEB, expectedVersion: currentVersion });

    const [outcomeA, outcomeB] = await Promise.all([resA, resB]);

    // Exactly one must succeed (200), the other must be rejected (409 CONCURRENT_MODIFICATION_CONFLICT or ALREADY_REVERSED)
    const successCount = (outcomeA.status === 200 ? 1 : 0) + (outcomeB.status === 200 ? 1 : 0);
    const failureCount = (outcomeA.status === 409 || outcomeA.status === 400 ? 1 : 0) + (outcomeB.status === 409 || outcomeB.status === 400 ? 1 : 0);

    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    const rejected = outcomeA.status !== 200 ? outcomeA : outcomeB;
    expect([400, 409]).toContain(rejected.status);
    expect(rejected.body.message || rejected.body.error).toMatch(/already been reversed|CONCURRENT_MODIFICATION_CONFLICT|ALREADY_REVERSED/);

    // Verify in database that exactly ONE posted reversal exists
    await dbContext.run(companyDb, async () => {
      const reversals = await db.select().from(schema.journalEntries).where(
        and(
          eq(schema.journalEntries.companyId, TEST_COMP_ID),
          eq(schema.journalEntries.originalJournalId, freshOrigId),
          eq(schema.journalEntries.status, 'POSTED')
        )
      );
      expect(reversals.length).toBe(1);
    });
  });

  it('Requirement 8: Audit logs identify original journal and every conflicting reversal child with full audit trail', async () => {
    await dbContext.run(companyDb, async () => {
      const logs = await db.select().from(schema.auditLogs).where(
        and(
          eq(schema.auditLogs.companyId, TEST_COMP_ID),
          eq(schema.auditLogs.action, 'REVERSE_JOURNAL_ENTRY')
        )
      );
      expect(logs.length).toBeGreaterThanOrEqual(1);

      for (const log of logs) {
        expect(log.entityType).toBe('journal_entries');
        expect(log.entityId).toBeTruthy(); // original journal ID
        const after = JSON.parse(log.afterData || '{}');
        expect(after.status).toBe('REVERSED');
        expect(after.reverseEntryId).toBeTruthy(); // child reversal ID
        expect(after.reverseJournalNumber).toContain('-REV');

        const meta = JSON.parse(log.metadata || '{}');
        expect(meta.originalJournalId).toBe(log.entityId);
        expect(meta.reverseEntryId).toBe(after.reverseEntryId);
      }

      // Check the POST_REVERSAL_JOURNAL_ENTRY audit log on the child reversal itself
      const childLogs = await db.select().from(schema.auditLogs).where(
        and(
          eq(schema.auditLogs.companyId, TEST_COMP_ID),
          eq(schema.auditLogs.action, 'POST_REVERSAL_JOURNAL_ENTRY')
        )
      );
      expect(childLogs.length).toBeGreaterThanOrEqual(1);
      for (const cl of childLogs) {
        const meta = JSON.parse(cl.metadata || '{}');
        expect(meta.originalJournalId).toBeTruthy();
        expect(meta.originalJournalNumber).toBeTruthy();
      }

      // Check REVERSAL_LINEAGE_CORRUPTION_DETECTED & DUPLICATE_REVERSAL_ATTEMPT_BLOCKED logs
      // Verify they explicitly identify the original journal and EVERY conflicting reversal child
      const corruptionLogs = await db.select().from(schema.auditLogs).where(
        and(
          eq(schema.auditLogs.companyId, TEST_COMP_ID),
          eq(schema.auditLogs.action, 'REVERSAL_LINEAGE_CORRUPTION_DETECTED')
        )
      );
      expect(corruptionLogs.length).toBeGreaterThanOrEqual(1);
      const corruptMeta = JSON.parse(corruptionLogs[0].metadata || '{}');
      expect(corruptMeta.originalJournalId).toBeTruthy();
      expect(corruptMeta.originalJournalNumber).toBe('JE-REV-INV-001');
      expect(corruptMeta.conflictingCount).toBe(2);
      expect(Array.isArray(corruptMeta.conflictingReversalIds)).toBe(true);
      expect(corruptMeta.conflictingReversalIds.length).toBe(2);
      expect(corruptMeta.conflictingReversalNumbers).toEqual(
        expect.arrayContaining(['JE-REV-INV-001-REV', 'INJECTED-DUPLICATE-REV-02'])
      );

      const blockedLogs = await db.select().from(schema.auditLogs).where(
        and(
          eq(schema.auditLogs.companyId, TEST_COMP_ID),
          eq(schema.auditLogs.action, 'DUPLICATE_REVERSAL_ATTEMPT_BLOCKED')
        )
      );
      expect(blockedLogs.length).toBeGreaterThanOrEqual(1);
      const blockedMeta = JSON.parse(blockedLogs[0].metadata || '{}');
      expect(blockedMeta.originalJournalId).toBeTruthy();
      expect(Array.isArray(blockedMeta.conflictingReversalIds)).toBe(true);
      expect(blockedMeta.conflictingReversalIds.length).toBeGreaterThanOrEqual(1);
    });
  });
});
