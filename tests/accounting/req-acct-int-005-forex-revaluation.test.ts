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
import { ForexRevaluationEngine } from '../../src/server/services/forexRevaluationEngine';
import { PeriodCloseWorkspaceService } from '../../src/server/services/periodCloseWorkspaceService';
import { AccountingEngine } from '../../src/server/services/accountingEngine';
import { hardClosePeriod } from '../../src/server/db/domain';

describe('REQ-ACCT-INT-005 (FX-01) — Foreign Exchange Revaluation & Period-End Engine', () => {
  const app = createApp();
  const COMP_ID = 'LGR-PH-2026-TEST-FX-005';
  const OWNER_ID = 'usr-fx005-owner';
  let ownerToken = '';

  const PER_MAR = 'per-fx-2026-03';
  const PER_APR = 'per-fx-2026-04';
  const PER_FEB = 'per-fx-2026-02';

  let accUsdBankId = '';
  let accUsdApId = '';
  let accPhpEqId = '';
  let companyDb: any;
  let companySqlite: any;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);

    await CompanyManager.createCompanyProfile(
      COMP_ID,
      'FX Revaluation Test Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    companyDb = await CompanyManager.getCompanyDb(COMP_ID);
    companySqlite = await CompanyManager.getCompanySqlite(COMP_ID);

    companySqlite.prepare('DELETE FROM accounting_periods WHERE company_id = ?').run(COMP_ID);
    companySqlite.prepare('DELETE FROM accounts WHERE company_id = ?').run(COMP_ID);
    companySqlite.prepare('DELETE FROM currency_exchange_rates WHERE company_id = ?').run(COMP_ID);

    await dbContext.run(companyDb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      await db
        .insert(schema.users)
        .values({
          id: OWNER_ID,
          email: 'owner@fx-test.ph',
          displayName: 'FX Test Owner',
          passwordHash: 'test_hash',
          status: 'ACTIVE',
        })
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

      await RbacService.setMemberRoles(null, memId, ['Company Owner'], 'Seed owner');

      const rawSession = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawSession),
        userId: OWNER_ID,
        companyId: COMP_ID,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      ownerToken = `${COMP_ID}.${rawSession}`;

      await db.insert(schema.accountingPeriods).values([
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
        {
          id: PER_APR,
          companyId: COMP_ID,
          name: 'April 2026',
          startDate: '2026-04-01',
          endDate: '2026-04-30',
          fiscalYear: 2026,
          status: 'OPEN',
        },
      ]);

      accUsdBankId = 'acc-fx-usd-bank';
      accUsdApId = 'acc-fx-usd-ap';
      accPhpEqId = 'acc-fx-equity';

      await db.insert(schema.accounts).values([
        {
          id: accUsdBankId,
          companyId: COMP_ID,
          accountCode: '1050',
          accountName: 'BPI Dollar FCDU Bank Account',
          accountType: 'ASSET',
          detailType: 'DOLLAR_ACCOUNT',
          normalBalance: 'DEBIT',
          currency: 'USD',
          isCashAccount: true,
          status: 'ACTIVE',
        },
        {
          id: accUsdApId,
          companyId: COMP_ID,
          accountCode: '2015',
          accountName: 'Accounts Payable - Foreign Suppliers (USD)',
          accountType: 'PAYABLE',
          detailType: 'TRADE_PAYABLE',
          normalBalance: 'CREDIT',
          currency: 'USD',
          isControlAccount: true,
          status: 'ACTIVE',
        },
        {
          id: accPhpEqId,
          companyId: COMP_ID,
          accountCode: '3010',
          accountName: 'Share Capital',
          accountType: 'EQUITY',
          detailType: 'PAID_IN_CAPITAL',
          normalBalance: 'CREDIT',
          currency: 'PHP',
          status: 'ACTIVE',
        },
      ]);

      // Seed carrying GL balances in March 2026 at historical rate 55.00 PHP/USD:
      // USD Bank Asset = $10,000 @ 55.00 = ₱550,000.00 (55,000,000 centavos DR)
      // USD AP Liability = $5,000 @ 55.00 = ₱275,000.00 (27,500,000 centavos CR)
      // Capital balancing line = ₱275,000.00 CR
      await AccountingEngine.postBalancedJournalEntry(
        COMP_ID,
        {
          journalNumber: 'JE-FX-SEED-01',
          entryDate: '2026-03-10',
          description: 'Seed USD monetary balances @ 55.00',
          sourceType: 'MANUAL_JOURNAL',
          sourceId: 'seed-fx-01',
          createdBy: OWNER_ID,
          userRole: 'Company Owner',
        },
        [
          { accountId: accUsdBankId, debit: 55_000_000, credit: 0, description: '$10,000 USD Deposit @ 55.00' },
          { accountId: accUsdApId, debit: 0, credit: 27_500_000, description: '$5,000 USD Foreign AP @ 55.00' },
          { accountId: accPhpEqId, debit: 0, credit: 27_500_000, description: 'Net Equity offset' },
        ]
      );

      // Lock February 2026 for period enforcement verification
      await hardClosePeriod(COMP_ID, PER_FEB, OWNER_ID);
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);
  });

  it('1. Rejects missing BSP spot rates (no silent 56.00 fallback) and validates rate inputs', async () => {
    // Direct service lookup for unseeded currencies fails closed
    await dbContext.run(companyDb, async () => {
      await expect(ForexRevaluationEngine.getBspSpotRate(COMP_ID, 'USD', '2026-03-31')).rejects.toMatchObject({
        code: 'BSP_SPOT_RATE_NOT_FOUND',
        statusCode: 400,
      });
      await expect(ForexRevaluationEngine.getBspSpotRate(COMP_ID, 'EUR')).rejects.toMatchObject({
        code: 'BSP_SPOT_RATE_NOT_FOUND',
        statusCode: 400,
      });
    });

    // Realized calculator rejects missing/invalid parameters cleanly
    const badCalc = await request(app)
      .get('/api/operations/forex/calculate-realized?foreignAmountUsd=1000')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(badCalc.status).toBe(400);
    expect(badCalc.body.error).toBe('INVALID_FOREX_INPUT');

    // Preview fails closed when no BSP spot rate exists for 2026-03-31
    const noRatePreview = await request(app)
      .post('/api/operations/forex/revaluations/preview')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        accountingPeriodId: PER_MAR,
        revaluationDate: '2026-03-31',
        currency: 'USD',
        exposures: [{ accountId: accUsdBankId, foreignBalance: 10000 }],
      });
    expect(noRatePreview.status).toBe(400);
    expect(noRatePreview.body.error).toBe('BSP_SPOT_RATE_NOT_FOUND');

    // Reject invalid negative rate or PHP spot rate
    const invalidRateRes = await request(app)
      .post('/api/operations/forex/rates')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ rateDate: '2026-03-31', currency: 'USD', bspSpotRate: -5 });
    expect(invalidRateRes.status).toBe(400);

    const phpRateRes = await request(app)
      .post('/api/operations/forex/rates')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ rateDate: '2026-03-31', currency: 'PHP', bspSpotRate: 1 });
    expect(phpRateRes.status).toBe(400);

    // Record valid official BSP spot rates for USD (57.00) and EUR (61.50)
    const usdRateRes = await request(app)
      .post('/api/operations/forex/rates')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ rateDate: '2026-03-31', currency: 'USD', bspSpotRate: 57.0, source: 'BSP Reference Bulletin' });
    expect(usdRateRes.status).toBe(200);

    const eurRateRes = await request(app)
      .post('/api/operations/forex/rates')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ rateDate: '2026-03-31', currency: 'EUR', bspSpotRate: 61.5, source: 'BSP Reference Bulletin' });
    expect(eurRateRes.status).toBe(200);
  });

  it('2. Computes exact PAS 21 period-end unrealized FX gains and losses for both Monetary Assets and Liabilities', async () => {
    // Period close workspace should initially warn on un-revalued FX monetary accounts
    await dbContext.run(companyDb, async () => {
      const wsBefore = await PeriodCloseWorkspaceService.buildPeriodCloseWorkspace(COMP_ID, PER_MAR, {
        closeTarget: 'HARD_CLOSE',
      });
      expect(wsBefore.financialOverview.fxRevaluation?.status).toBe('PENDING_REVALUATION');
      expect(wsBefore.financialOverview.fxRevaluation?.fxMonetaryAccountCount).toBe(2);
      const glSec = wsBefore.checklistSections.find((s) => s.sectionCode === 'GL');
      const fxCheck = glSec?.checks.find((c) => c.checkCode === 'GL_FX_REVALUATION_PENDING');
      expect(fxCheck?.passed).toBe(false);
    });

    const previewRes = await request(app)
      .post('/api/operations/forex/revaluations/preview')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        accountingPeriodId: PER_MAR,
        revaluationDate: '2026-03-31',
        currency: 'USD',
        exposures: [
          { accountId: accUsdBankId, foreignBalance: 10000 }, // Asset: 550k carrying -> 570k revalued = +20k Gain
          { accountId: accUsdApId, foreignBalance: 5000 },    // Liability: 275k carrying -> 285k revalued = 10k Loss
        ],
      });

    expect(previewRes.status).toBe(200);
    expect(previewRes.body.closingSpotRate).toBe(57.0);
    expect(previewRes.body.isTaxableInItr).toBe(false);
    expect(previewRes.body.totalGainCentavos).toBe(2_000_000); // ₱20,000.00
    expect(previewRes.body.totalLossCentavos).toBe(1_000_000); // ₱10,000.00
    expect(previewRes.body.netGainLossCentavos).toBe(1_000_000); // +₱10,000.00 Net Gain
  });

  it('3. Posts balanced Period-End Unrealized FX JE & Next-Period Auto-Reversal, blocks duplicates & closed periods, and satisfies Period Close check', async () => {
    // Hard-closed period (Feb 2026) must reject FX revaluation posting
    const lockedRes = await request(app)
      .post('/api/operations/forex/revaluations/post')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        accountingPeriodId: PER_FEB,
        revaluationDate: '2026-02-28',
        currency: 'USD',
        closingSpotRate: 56.5,
        exposures: [{ accountId: accUsdBankId, foreignBalance: 10000 }],
      });
    expect(lockedRes.status).toBe(403);
    expect(lockedRes.body.error).toBe('PERIOD_LOCKED');

    // Post valid March 2026 revaluation with next-period auto-reversal (2026-04-01)
    const postRes = await request(app)
      .post('/api/operations/forex/revaluations/post')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        accountingPeriodId: PER_MAR,
        revaluationDate: '2026-03-31',
        currency: 'USD',
        exposures: [
          { accountId: accUsdBankId, foreignBalance: 10000 },
          { accountId: accUsdApId, foreignBalance: 5000 },
        ],
        autoReverse: true,
        autoReverseDate: '2026-04-01',
        notes: 'March 2026 Closing BSP Spot Rate 57.00',
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.success).toBe(true);
    expect(postRes.body.status).toBe('AUTO_REVERSED');
    expect(typeof postRes.body.unrealizedJournalId).toBe('string');
    expect(typeof postRes.body.reversalJournalId).toBe('string');

    // Verify exact double-entry GL lines in March JE & April Auto-Reversal JE
    await dbContext.run(companyDb, async () => {
      const marLines = await db
        .select({
          accountCode: schema.accounts.accountCode,
          debit: schema.journalLines.debit,
          credit: schema.journalLines.credit,
        })
        .from(schema.journalLines)
        .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
        .where(eq(schema.journalLines.journalEntryId, postRes.body.unrealizedJournalId));

      const totalDr = marLines.reduce((s, l) => s + l.debit, 0);
      const totalCr = marLines.reduce((s, l) => s + l.credit, 0);
      expect(totalDr).toBe(totalCr);
      expect(totalDr).toBe(3_000_000);
      expect(marLines.find((l) => l.accountCode === '1050')?.debit).toBe(2_000_000);
      expect(marLines.find((l) => l.accountCode === '2015')?.credit).toBe(1_000_000);
      expect(marLines.find((l) => l.accountCode === '4910')?.credit).toBe(2_000_000);
      expect(marLines.find((l) => l.accountCode === '6910')?.debit).toBe(1_000_000);

      // Period close check now passes cleanly with REVALUED status
      const wsAfter = await PeriodCloseWorkspaceService.buildPeriodCloseWorkspace(COMP_ID, PER_MAR, {
        closeTarget: 'HARD_CLOSE',
      });
      expect(wsAfter.financialOverview.fxRevaluation?.status).toBe('REVALUED');
      expect(wsAfter.checklistSections.length).toBe(12);
      const glSec = wsAfter.checklistSections.find((s) => s.sectionCode === 'GL');
      const fxCheck = glSec?.checks.find((c) => c.checkCode === 'GL_FX_REVALUATION_PENDING');
      expect(fxCheck?.passed).toBe(true);
    });

    // Duplicate revaluation run for same period + currency must be blocked (409)
    const dupRes = await request(app)
      .post('/api/operations/forex/revaluations/post')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        accountingPeriodId: PER_MAR,
        revaluationDate: '2026-03-31',
        currency: 'USD',
        exposures: [{ accountId: accUsdBankId, foreignBalance: 10000 }],
      });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error).toBe('DUPLICATE_FX_REVALUATION_RUN');

    // Paginated runs endpoint returns run metadata
    const listRes = await request(app)
      .get('/api/operations/forex/revaluations?page=1&limit=20')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.totalCount).toBe(1);
    expect(listRes.body.items[0].status).toBe('AUTO_REVERSED');
    expect(listRes.body.items[0].targetCurrency).toBe('USD');
  });
});
