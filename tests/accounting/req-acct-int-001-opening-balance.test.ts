import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import { LedgerIntegrityService } from '../../src/server/services/ledgerIntegrityService';
import { EnterpriseAiAgentService } from '../../src/server/services/enterpriseAiAgentService';
import { OpeningBalanceService } from '../../src/server/services/openingBalanceService';

describe('REQ-ACCT-INT-001: Chart of Accounts Opening Balance GL Integration', () => {
  const app = createApp();
  const COMP_ID = 'LGR-PH-2026-TEST-OB-INT';
  const OWNER_ID = 'usr-ob-owner';
  const BOOKKEEPER_ID = 'usr-ob-bookkeeper';
  let ownerToken = '';
  let bookkeeperToken = '';

  const PER_2025_CLOSED = 'per-ob-2025-12';
  const PER_2026_01 = 'per-ob-2026-01';
  const PER_2026_02 = 'per-ob-2026-02';

  let companyDb: any;
  let companySqlite: any;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);

    await CompanyManager.createCompanyProfile(
      COMP_ID,
      'Opening Balance Integration Synthetic Corp.',
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
          .values({ id: uid, email, displayName: name, passwordHash: 'hash', status: 'ACTIVE' })
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

      ownerToken = await seedUser(OWNER_ID, 'owner@ob-test.ph', 'OB Owner', 'Company Owner');
      bookkeeperToken = await seedUser(BOOKKEEPER_ID, 'book@ob-test.ph', 'OB Bookkeeper', 'Bookkeeper');

      await db.insert(schema.accountingPeriods).values([
        {
          id: PER_2025_CLOSED,
          companyId: COMP_ID,
          name: 'December 2025',
          startDate: '2025-12-01',
          endDate: '2025-12-31',
          fiscalYear: 2025,
          status: 'HARD_CLOSED',
        },
        {
          id: PER_2026_01,
          companyId: COMP_ID,
          name: 'January 2026',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          fiscalYear: 2026,
          status: 'OPEN',
        },
        {
          id: PER_2026_02,
          companyId: COMP_ID,
          name: 'February 2026',
          startDate: '2026-02-01',
          endDate: '2026-02-28',
          fiscalYear: 2026,
          status: 'OPEN',
        },
      ]);

      await db.insert(schema.accounts).values([
        {
          id: 'acc-ob-1010',
          companyId: COMP_ID,
          accountCode: '1010',
          accountName: 'BDO Checking Account',
          accountType: 'ASSET',
          detailType: 'CHECKING',
          normalBalance: 'DEBIT',
          isCashAccount: true,
          status: 'ACTIVE',
        },
      ]);
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);
  });

  let createdAssetId = '';
  let originalObJournalId = '';

  it('1. Rejects non-zero opening balance on Income/Expense accounts atomically without creating account', async () => {
    const res = await request(app)
      .post('/api/master-data/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        accountCode: '4050',
        accountName: 'Miscellaneous Sales',
        accountType: 'REVENUE',
        normalBalance: 'CREDIT',
        openingBalance: 10000,
        asOfDate: '2026-01-01',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('OPENING_BALANCE_INVALID_ACCOUNT_TYPE');

    const accRes = await request(app)
      .get('/api/master-data/accounts')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(accRes.body.some((a: any) => a.accountCode === '4050')).toBe(false);
  });

  it('2. Rejects opening balance posting into HARD_CLOSED period and rolls back COA insert cleanly', async () => {
    const res = await request(app)
      .post('/api/master-data/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        accountCode: '1060',
        accountName: 'Closed Period Cash Box',
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        openingBalance: 50000,
        asOfDate: '2025-12-15',
      });

    expect([400, 403]).toContain(res.status);
    expect(res.body.error).toMatch(/PERIOD_LOCKED|PERIOD_CLOSED_ERROR/);

    const accRes = await request(app)
      .get('/api/master-data/accounts')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(accRes.body.some((a: any) => a.accountCode === '1060')).toBe(false);
  });

  it('3. Creates Balance Sheet account with ₱75,000 opening balance and propagates to GL, TB, BS, Account Schedule, Integrity Scan & AI Agent', async () => {
    const createRes = await request(app)
      .post('/api/master-data/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        accountCode: '1050',
        accountName: 'Petty Cash Drawer',
        accountType: 'ASSET',
        detailType: 'PETTY_CASH',
        normalBalance: 'DEBIT',
        openingBalance: 75000,
        asOfDate: '2026-01-01',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.openingBalance).toBe(75000);
    expect(createRes.body.openingJournalEntryId).toBeTruthy();
    createdAssetId = createRes.body.id;
    originalObJournalId = createRes.body.openingJournalEntryId;

    const [journalsRes, glRes, tbRes, bsRes, schedRes] = await Promise.all([
      request(app).get('/api/accounting/journals').set('Authorization', `Bearer ${ownerToken}`),
      request(app).get('/api/reports/general-ledger?startDate=2026-01-01&endDate=2026-01-31').set('Authorization', `Bearer ${ownerToken}`),
      request(app).get('/api/reports/trial-balance?startDate=2026-01-01&endDate=2026-01-31').set('Authorization', `Bearer ${ownerToken}`),
      request(app).get('/api/reports/balance-sheet?startDate=2026-01-01&endDate=2026-01-31').set('Authorization', `Bearer ${ownerToken}`),
      request(app).get('/api/reports/account-schedule?startDate=2026-01-01&endDate=2026-01-31').set('Authorization', `Bearer ${ownerToken}`),
    ]);

    const journalsList = Array.isArray(journalsRes.body) ? journalsRes.body : journalsRes.body?.data || [];
    const obJe = journalsList.find((j: any) => j.id === originalObJournalId);
    expect(obJe).toBeDefined();
    expect(obJe.status).toBe('POSTED');
    expect(obJe.sourceType).toBe('OPENING_BALANCE');
    expect(obJe.sourceId).toBe(`COA-OB:${createdAssetId}`);

    const glPetty = (glRes.body as any[]).filter((r: any) => r.accountCode === '1050');
    expect(glPetty.length).toBe(1);
    expect(glPetty[0].debit).toBe(7_500_000);
    expect(glPetty[0].runningBalance).toBe(7_500_000);

    const tbRows = tbRes.body as any[];
    const tbPetty = tbRows.find((r: any) => r.accountCode === '1050');
    expect(tbPetty).toBeDefined();
    expect(tbPetty.closingDebit).toBe(7_500_000);
    expect(tbPetty.closingNetBalance).toBe(7_500_000);

    // Offset equity account exists via metadata and balances TB
    const tbSumDr = tbRows.reduce((s, r) => s + Number(r.closingDebit || 0), 0);
    const tbSumCr = tbRows.reduce((s, r) => s + Number(r.closingCredit || 0), 0);
    expect(tbSumDr).toBe(7_500_000);
    expect(tbSumCr).toBe(7_500_000);

    // Balance sheet balances cleanly: Assets ₱75,000 == Liabilities 0 + Equity ₱75,000
    expect(bsRes.body.totalAssets).toBe(7_500_000);
    expect(bsRes.body.totalEquity).toBe(7_500_000);
    expect(bsRes.body.balanced).toBe(true);

    // Account schedule reflects ₱75,000
    const pettySched = (schedRes.body as any[]).find((a: any) => a.accountCode === '1050');
    expect(pettySched?.closingBalance).toBe(7_500_000);

    // Ledger Integrity scan passes cleanly
    const scanResult = await dbContext.run(companyDb, async () => {
      return await LedgerIntegrityService.runIntegrityScan(COMP_ID, {
        userId: OWNER_ID,
        userName: 'OB Owner',
        userRole: 'Company Owner',
      });
    });
    expect(scanResult.failedChecks).toBe(0);

    // Ledger Agent AI reflects ₱75,000 in offline deterministic trial balance & cash queries
    const aiTb = await dbContext.run(companyDb, async () => {
      return await EnterpriseAiAgentService.executeInquiry({
        companyId: COMP_ID,
        companyName: 'Opening Balance Integration Synthetic Corp.',
        userId: OWNER_ID,
        userRole: 'Company Owner',
        permissions: ['accounting:view', 'reports:view', 'ai:use'],
        deniedPermissions: [],
        prompt: 'Show trial balance summary',
        forceOffline: true,
      });
    });
    expect(aiTb.answer).toContain('75,000.00');
  });

  it('4. Blocks silent overwrite of posted openingBalance on PUT and supports auditable delta adjustment (₱75,000 -> ₱90,000)', async () => {
    // 4a. Silent overwrite blocked with 409 OPENING_BALANCE_IMMUTABLE
    const overwriteRes = await request(app)
      .put(`/api/master-data/accounts/${createdAssetId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ openingBalance: 90000 });

    expect(overwriteRes.status).toBe(409);
    expect(overwriteRes.body.error).toBe('OPENING_BALANCE_IMMUTABLE');

    // 4b. Normal metadata rename (without mutating openingBalance) succeeds cleanly
    const metaRes = await request(app)
      .put(`/api/master-data/accounts/${createdAssetId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ accountName: 'Main Petty Cash Drawer' });
    expect(metaRes.status).toBe(200);

    // 4c. Auditable adjustment requires reason & posts balanced delta entry (+₱15,000) without modifying original JE
    const adjRes = await request(app)
      .post(`/api/master-data/accounts/${createdAssetId}/opening-balance-adjustment`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        newOpeningBalance: 90000,
        adjustmentDate: '2026-01-05',
        reason: 'Audited cash count variance',
      });

    expect(adjRes.status).toBe(201);
    expect(adjRes.body.deltaPhp).toBe(15000);
    expect(adjRes.body.newOpeningBalancePhp).toBe(90000);

    const tbRes = await request(app)
      .get('/api/reports/trial-balance?startDate=2026-01-01&endDate=2026-01-31')
      .set('Authorization', `Bearer ${ownerToken}`);
    const tbPetty = (tbRes.body as any[]).find((r: any) => r.accountCode === '1050');
    expect(tbPetty.closingNetBalance).toBe(9_000_000);

    // Verify original posted OB JE lines were NOT mutated
    await dbContext.run(companyDb, async () => {
      const origLines = await db
        .select()
        .from(schema.journalLines)
        .where(eq(schema.journalLines.journalEntryId, originalObJournalId));
      const origDr = origLines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      expect(origDr).toBe(7_500_000);
    });
  });

  it('5. Reconciles historical missing-GL accounts safely without double-counting reconciled or GL-only accounts', async () => {
    const legacyMissingAccId = 'acc-ob-1070-legacy';
    const glOnlyAccId = 'acc-ob-2010-glonly';
    const eqLegacyId = 'acc-ob-3010-legacy';

    await dbContext.run(companyDb, async () => {
      // Case A: Missing GL entry (legacy master openingBalance=25,000, zero GL OB entries)
      await db.insert(schema.accounts).values([
        {
          id: legacyMissingAccId,
          companyId: COMP_ID,
          accountCode: '1070',
          accountName: 'Legacy Savings',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          openingBalance: 25000,
          asOfDate: '2026-01-01',
          status: 'ACTIVE',
        },
        {
          id: glOnlyAccId,
          companyId: COMP_ID,
          accountCode: '2010',
          accountName: 'GL-Only Payable',
          accountType: 'PAYABLE',
          normalBalance: 'CREDIT',
          openingBalance: 0,
          status: 'ACTIVE',
        },
        {
          id: eqLegacyId,
          companyId: COMP_ID,
          accountCode: '3010',
          accountName: 'Legacy Capital',
          accountType: 'EQUITY',
          normalBalance: 'CREDIT',
          openingBalance: 0,
          status: 'ACTIVE',
        },
      ]);

      // Case B: GL-only onboarding opening journal (account.openingBalance is 0, JE already exists)
      const onboardingJeId = crypto.randomUUID();
      await db.insert(schema.journalEntries).values({
        id: onboardingJeId,
        companyId: COMP_ID,
        journalNumber: 'JE-OPENING-2026',
        entryDate: '2026-01-01',
        accountingPeriodId: PER_2026_01,
        description: 'Legacy onboarding opening entry',
        sourceType: 'OPENING_BALANCE',
        sourceId: 'ONBOARDING-2026',
        status: 'POSTED',
        createdBy: OWNER_ID,
        postedBy: OWNER_ID,
      });
      await db.insert(schema.journalLines).values([
        { id: crypto.randomUUID(), journalEntryId: onboardingJeId, accountId: glOnlyAccId, debit: 0, credit: 1_000_000, lineNumber: 1 },
        { id: crypto.randomUUID(), journalEntryId: onboardingJeId, accountId: 'acc-ob-1010', debit: 1_000_000, credit: 0, lineNumber: 2 },
      ]);
    });

    // Dry run check
    const dryRes = await request(app)
      .post('/api/master-data/opening-balances/reconcile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ dryRun: true });
    expect(dryRes.status).toBe(200);
    expect(dryRes.body.inspection.missingGlEntryCount).toBe(1);
    expect(dryRes.body.inspection.glOnlyEntryCount).toBeGreaterThanOrEqual(2);
    expect(dryRes.body.inspection.reconciledCount).toBeGreaterThanOrEqual(1);

    // Execute reconciliation migration
    const migRes = await request(app)
      .post('/api/master-data/opening-balances/reconcile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ dryRun: false });
    expect(migRes.status).toBe(200);
    expect(migRes.body.migratedCount).toBe(1);
    expect(migRes.body.migratedAccounts[0].accountCode).toBe('1070');

    // Second run must be completely idempotent (0 migrated)
    const migRes2 = await request(app)
      .post('/api/master-data/opening-balances/reconcile')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ dryRun: false });
    expect(migRes2.status).toBe(200);
    expect(migRes2.body.migratedCount).toBe(0);

    // Verify Petty Cash 1050 (reconciled ₱90,000) and GL-only 2010 (₱10,000) were NOT double-counted
    const tbRes = await request(app)
      .get('/api/reports/trial-balance?startDate=2026-01-01&endDate=2026-01-31')
      .set('Authorization', `Bearer ${ownerToken}`);
    const tbRows = tbRes.body as any[];
    expect(tbRows.find((r) => r.accountCode === '1050')?.closingNetBalance).toBe(9_000_000);
    expect(tbRows.find((r) => r.accountCode === '1070')?.closingNetBalance).toBe(2_500_000);
    expect(tbRows.find((r) => r.accountCode === '2010')?.closingNetBalance).toBe(1_000_000);
  });
});
