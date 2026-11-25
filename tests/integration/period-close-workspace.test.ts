import { describe, it, beforeAll as before, afterAll as after } from 'vitest';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import request from 'supertest';
import { sql, eq, and } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema';
import { CompanyManager } from '../../src/server/services/companyManager';
import {
  ORIGINAL_DESKGUARD_LAI_PATH,
  PREVIEW_COMPANY_ID,
  PREVIEW_COMPANY_DIR,
  seedDeskguardStressPreview,
} from '../../src/server/scripts/seedDeskguardStressPreview';
import {
  ENTITY_360_REGISTRY,
  getEntity360Definition,
} from '../../src/shared/entity360Registry';
import {
  normalizeEpochMs,
  normalizeIsoTimestamp,
  formatEnterpriseTimestamp,
  jsonTimestampReplacer,
} from '../../src/shared/timestampUtils';

const ORIGINAL_DESKGUARD_EXPECTED_SHA256 =
  '1350910f1af35db1c12214dc50a5100483af7dfac25aeb0938a5109a69070b67';

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('Consolidated Enterprise Verification: Workstream A (360° Reconciliation & Timestamps) + Workstream B (Period Close Workspace)', () => {
  let app: any;
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let ownerToken: string;
  let auditorToken: string;
  let sampleAccountDebitId: string;
  let sampleAccountCreditId: string;
  const cleanupJournalIds: string[] = [];

  before(async () => {
    if (fs.existsSync(ORIGINAL_DESKGUARD_LAI_PATH)) {
      const preHash = sha256File(ORIGINAL_DESKGUARD_LAI_PATH);
      assert.equal(
        preHash,
        ORIGINAL_DESKGUARD_EXPECTED_SHA256,
        'Original Deskguard Solutions database.lai must remain unmodified'
      );
    }

    const activePath = path.join(PREVIEW_COMPANY_DIR, '.db_active.sqlite');
    const laiPath = path.join(PREVIEW_COMPANY_DIR, 'database.lai');
    const markerPath = path.join(PREVIEW_COMPANY_DIR, '.seeded_complete');
    if ((!fs.existsSync(activePath) && !fs.existsSync(laiPath)) || !fs.existsSync(markerPath)) {
      await seedDeskguardStressPreview();
    }

    const targetDbPath = fs.existsSync(activePath) ? activePath : laiPath;
    sqlite = new Database(targetDbPath);
    db = drizzle(sqlite, { schema });

    const nowSec = Math.floor(Date.now() / 1000);
    const expiresSec = nowSec + 86400;

    // 1. Owner Session
    const ownerSessionId = crypto.randomBytes(32).toString('hex');
    const hashedOwnerSession = crypto.createHash('sha256').update(ownerSessionId).digest('hex');
    ownerToken = `${PREVIEW_COMPANY_ID}.${ownerSessionId}`;
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, 'usr-dg-owner', ?, ?)`
      )
      .run(hashedOwnerSession, expiresSec, nowSec);

    // 2. Auditor Session
    const auditorSessionId = crypto.randomBytes(32).toString('hex');
    const hashedAuditorSession = crypto.createHash('sha256').update(auditorSessionId).digest('hex');
    auditorToken = `${PREVIEW_COMPANY_ID}.${auditorSessionId}`;
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, 'usr-dg-auditor', ?, ?)`
      )
      .run(hashedAuditorSession, expiresSec, nowSec);

    const accounts = db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.companyId, PREVIEW_COMPANY_ID),
          eq(schema.accounts.status, 'ACTIVE')
        )
      )
      .all();
    const cashAcc = accounts.find((a) => a.accountType === 'ASSET') || accounts[0];
    const revAcc = accounts.find((a) => a.accountType === 'REVENUE') || accounts[1];
    sampleAccountDebitId = cashAcc.id;
    sampleAccountCreditId = revAcc.id;

    // Clean up any leftover test periods named 2027-12-TEST
    sqlite
      .prepare(`DELETE FROM period_status_history WHERE accounting_period_id IN (SELECT id FROM accounting_periods WHERE name = '2027-12-TEST')`)
      .run();
    sqlite.prepare(`DELETE FROM accounting_periods WHERE name = '2027-12-TEST'`).run();

    try {
      const manifestPath = path.join(PREVIEW_COMPANY_DIR, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        await CompanyManager.registerCompany(manifest);
      }
    } catch (_) {}

    const { createApp } = await import('../../src/server/app');
    app = createApp();
  }, 120_000);

  after(() => {
    try {
      for (const jId of cleanupJournalIds) {
        sqlite.prepare(`DELETE FROM journal_lines WHERE journal_entry_id = ?`).run(jId);
        sqlite.prepare(`DELETE FROM journal_entries WHERE id = ?`).run(jId);
      }
      sqlite
        .prepare(`DELETE FROM period_status_history WHERE accounting_period_id IN (SELECT id FROM accounting_periods WHERE name = '2027-12-TEST')`)
        .run();
      sqlite.prepare(`DELETE FROM accounting_periods WHERE name = '2027-12-TEST'`).run();
    } catch (_) {}

    if (sqlite) {
      sqlite.close();
    }

    if (fs.existsSync(ORIGINAL_DESKGUARD_LAI_PATH)) {
      const postHash = sha256File(ORIGINAL_DESKGUARD_LAI_PATH);
      assert.equal(
        postHash,
        ORIGINAL_DESKGUARD_EXPECTED_SHA256,
        'Original Deskguard Solutions database.lai must remain unmodified after test execution'
      );
    }
  });

  it('A1: reconciles all 25 canonical ENTITY_360_REGISTRY keys, OFFICIAL_RECEIPT -> CUSTOMER_PAYMENT alias, GOODS_RECEIPT_NOTE stepper config, and BANK_DEPOSIT', () => {
    const keys = Object.keys(ENTITY_360_REGISTRY);
    assert.equal(keys.length, 25, 'ENTITY_360_REGISTRY must contain exactly 25 canonical keys');

    // Verify CUSTOMER_PAYMENT and OFFICIAL_RECEIPT mapping
    const cpDef = getEntity360Definition('CUSTOMER_PAYMENT');
    const orDef = getEntity360Definition('OFFICIAL_RECEIPT');
    assert.equal(cpDef.entityType, 'CUSTOMER_PAYMENT');
    assert.equal(orDef.entityType, 'CUSTOMER_PAYMENT');
    assert.equal(orDef.presentationType, 'FINANCIAL_TRANSACTION_360');
    assert.equal(orDef.rendererComponent, 'FinancialTransaction360View');

    // Verify GOODS_RECEIPT_NOTE header & stepper configuration
    const grnDef = getEntity360Definition('GOODS_RECEIPT_NOTE');
    assert.equal(grnDef.presentationType, 'FINANCIAL_TRANSACTION_360');
    assert.equal(grnDef.headerConfig.bannerMode, 'INVENTORY_VALUATION_BANNER');
    assert.equal(
      grnDef.headerConfig.showsAccountingWorkflowStepper,
      false,
      'GOODS_RECEIPT_NOTE uses INVENTORY_VALUATION_BANNER and showsAccountingWorkflowStepper: false'
    );

    // Verify BANK_DEPOSIT is registered as FINANCIAL_TRANSACTION_360
    const bdDef = getEntity360Definition('BANK_DEPOSIT');
    assert.equal(bdDef.entityType, 'BANK_DEPOSIT');
    assert.equal(bdDef.presentationType, 'FINANCIAL_TRANSACTION_360');
    assert.equal(bdDef.headerConfig.showsAccountingWorkflowStepper, true);

    // Verify dynamic sub-entity specializations (BUDGET, AUDIT_WORKPAPER, AUDIT_FINDING)
    const budgetDef = getEntity360Definition('BUDGET');
    assert.equal(budgetDef.entityType, 'BUDGET');
    assert.equal(budgetDef.moduleId, 'budget');
    assert.equal(budgetDef.moduleLabel, '10. Budget & Financial Planning');

    const wpDef = getEntity360Definition('AUDIT_WORKPAPER');
    assert.equal(wpDef.entityType, 'AUDIT_WORKPAPER');
    assert.equal(wpDef.submoduleId, 'aud-workpapers');

    const fnDef = getEntity360Definition('AUDIT_FINDING');
    assert.equal(fnDef.entityType, 'AUDIT_FINDING');
  });

  it('A3 & B9: repairs Drizzle double-multiplied millisecond timestamps (8/28/58832) non-destructively', () => {
    // 1794412800000 ms = 2026-11-11T16:00:00.000Z
    // When Drizzle `{ mode: "timestamp" }` multiplies a millisecond integer by 1000, Date year becomes ~58832
    const corruptedDrizzleDate = new Date(1794412800000 * 1000);
    assert.ok(
      corruptedDrizzleDate.getUTCFullYear() > 50000,
      'Raw double-multiplied Date reproduces the year > 50000 bug'
    );

    const repairedMs = normalizeEpochMs(corruptedDrizzleDate);
    assert.equal(repairedMs, 1794412800000);

    const repairedIso = normalizeIsoTimestamp(corruptedDrizzleDate);
    assert.equal(repairedIso, '2026-11-11T16:00:00.000Z');

    const formatted = formatEnterpriseTimestamp(corruptedDrizzleDate);
    assert.ok(!formatted.includes('58832'), `Formatted string must not contain 58832: ${formatted}`);
    assert.ok(formatted.includes('2026'), `Formatted string must contain 2026: ${formatted}`);

    const serialized = JSON.stringify(
      { createdAt: corruptedDrizzleDate },
      jsonTimestampReplacer
    );
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.createdAt, '2026-11-11T16:00:00.000Z');
  });

  it('B2 & B3: returns accurate period-scoped financial overview and 12-section checklist for a populated period (per-dg-2026-01)', async () => {
    const res = await request(app)
      .get('/api/accounting/periods/per-dg-2026-01/workspace?closeTarget=HARD_CLOSE')
      .set('Authorization', `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    const ws = res.body;

    assert.equal(ws.periodInfo.id, 'per-dg-2026-01');
    assert.equal(ws.periodInfo.startDate, '2026-01-01');
    assert.equal(ws.periodInfo.endDate, '2026-01-31');

    // Verify Financial Overview matches authoritative GL for 2026-01
    assert.ok(ws.financialOverview.postedJournalCount > 0, 'Populated period must have posted journals');
    assert.equal(
      ws.financialOverview.totalDebitCentavos,
      ws.financialOverview.totalCreditCentavos,
      'Populated period Total Debit must equal Total Credit'
    );
    assert.equal(ws.financialOverview.trialBalanceStatus, 'BALANCED');

    // Verify all 12 mandatory sections exist in exact order
    assert.equal(ws.checklistSections.length, 12);
    const expectedCodes = [
      'GL',
      'TRIAL_BALANCE',
      'JOURNAL_ENTRIES',
      'ACCOUNTS_RECEIVABLE',
      'ACCOUNTS_PAYABLE',
      'BANK_RECONCILIATION',
      'INVENTORY_COSTING',
      'PAYROLL_STATUTORY',
      'TAX_COMPLIANCE',
      'FIXED_ASSETS',
      'APPROVAL_WORKFLOWS',
      'SUPPORTING_DOCUMENTS',
    ];
    assert.deepEqual(
      ws.checklistSections.map((s: any) => s.sectionCode),
      expectedCodes
    );
  });

  it('B4, B5, B6, B7 & B8: enforces Soft Close warning justification, Hard Close blockers on DRAFT journals, immutable SHA-256 Certification Snapshot, Reopen revalidation, and RBAC', async () => {
    // 1. Create a fresh open test period (2027-12)
    const createRes = await request(app)
      .post('/api/accounting/periods')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: '2027-12-TEST',
        startDate: '2027-12-01',
        endDate: '2027-12-31',
        fiscalYear: 2027,
      });

    assert.equal(createRes.status, 201);
    const createdPeriodId = createRes.body.period.id;

    // 2. Insert a DRAFT journal entry in 2027-12
    const draftJeId = `je-test-draft-${Date.now()}`;
    cleanupJournalIds.push(draftJeId);
    db.insert(schema.journalEntries)
      .values({
        id: draftJeId,
        companyId: PREVIEW_COMPANY_ID,
        journalNumber: `JE-DRAFT-202712`,
        entryDate: '2027-12-15',
        accountingPeriodId: createdPeriodId,
        description: 'Draft entry testing close blockers',
        sourceType: 'MANUAL',
        status: 'DRAFT',
        createdBy: 'usr-dg-owner',
      })
      .run();

    db.insert(schema.journalLines)
      .values([
        {
          id: `jl-dr-${Date.now()}`,
          journalEntryId: draftJeId,
          accountId: sampleAccountDebitId,
          description: 'Debit leg',
          debit: 250000,
          credit: 0,
          lineNumber: 1,
        },
        {
          id: `jl-cr-${Date.now()}`,
          journalEntryId: draftJeId,
          accountId: sampleAccountCreditId,
          description: 'Credit leg',
          debit: 0,
          credit: 250000,
          lineNumber: 2,
        },
      ])
      .run();

    // 3. Hard Close MUST be blocked because JE_DRAFT_ENTRIES is BLOCKING in Hard Close
    const blockedHardRes = await request(app)
      .post(`/api/accounting/periods/${createdPeriodId}/hard-close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        reason: 'Attempting hard close with draft journal present',
        enforceEvidenceChecks: true,
      });
    assert.equal(blockedHardRes.status, 400);
    assert.equal(blockedHardRes.body.error, 'PERIOD_CLOSE_BLOCKED');
    assert.ok(blockedHardRes.body.details.blockingCount >= 1);

    // 4. Soft Close with enforceEvidenceChecks=true and NO warningJustification MUST be rejected
    const missingWarningJustRes = await request(app)
      .post(`/api/accounting/periods/${createdPeriodId}/soft-close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        reason: 'Attempting soft close without warning justification',
        enforceEvidenceChecks: true,
      });
    assert.equal(missingWarningJustRes.status, 400);
    assert.equal(missingWarningJustRes.body.error, 'WARNING_JUSTIFICATION_REQUIRED');

    // 5. Soft Close WITH warningJustification succeeds!
    const validSoftCloseRes = await request(app)
      .post(`/api/accounting/periods/${createdPeriodId}/soft-close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        reason: 'Preliminary monthly soft close',
        warningJustification:
          'Draft journal JE-DRAFT-202712 is pending controller review prior to hard close.',
        enforceEvidenceChecks: true,
      });
    assert.equal(validSoftCloseRes.status, 200);
    assert.equal(validSoftCloseRes.body.status, 'SOFT_CLOSED');
    assert.ok(validSoftCloseRes.body.validationSnapshotId?.startsWith('VAL-'));

    // 6. Promote DRAFT journal to POSTED (below 50k PHP doc threshold: 250000 centavos = 2,500 PHP)
    db.update(schema.journalEntries)
      .set({ status: 'POSTED', postedBy: 'usr-dg-owner', postedAt: new Date() })
      .where(eq(schema.journalEntries.id, draftJeId))
      .run();

    // 7. Execute Hard Close -> must succeed and generate an immutable Certification Snapshot
    const hardCloseRes = await request(app)
      .post(`/api/accounting/periods/${createdPeriodId}/hard-close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        reason: 'Final certified period hard close for December 2027',
        warningJustification: 'All material subledgers reconciled.',
        enforceEvidenceChecks: true,
      });
    assert.equal(hardCloseRes.status, 200);
    assert.equal(hardCloseRes.body.status, 'HARD_CLOSED');
    assert.ok(hardCloseRes.body.certification, 'Hard Close must return a certification snapshot');
    assert.equal(hardCloseRes.body.certification.sha256Hash.length, 64);
    assert.equal(
      hardCloseRes.body.certification.trialBalanceTotals.totalDebitCentavos,
      250000
    );
    assert.equal(
      hardCloseRes.body.certification.trialBalanceTotals.totalCreditCentavos,
      250000
    );

    const certId = hardCloseRes.body.certification.id;

    // 8. Prove SQLite database trigger prevents modifying or deleting the certification snapshot
    assert.throws(
      () => {
        sqlite
          .prepare(`UPDATE period_close_certifications SET closing_reason = 'TAMPERED' WHERE id = ?`)
          .run(certId);
      },
      /IMMUTABLE_CERTIFICATION_SNAPSHOT/,
      'Updating a certification snapshot must fail with IMMUTABLE_CERTIFICATION_SNAPSHOT'
    );

    assert.throws(
      () => {
        sqlite.prepare(`DELETE FROM period_close_certifications WHERE id = ?`).run(certId);
      },
      /IMMUTABLE_CERTIFICATION_SNAPSHOT/,
      'Deleting a certification snapshot must fail with IMMUTABLE_CERTIFICATION_SNAPSHOT'
    );

    // 9. B8: Verify posting to the HARD_CLOSED period is strictly rejected
    const closedPostAttempt = await request(app)
      .post('/api/accounting/journals')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        entryDate: '2027-12-20',
        description: 'Unauthorized post into HARD_CLOSED period',
        lines: [
          { accountId: sampleAccountDebitId, debit: 10000, credit: 0 },
          { accountId: sampleAccountCreditId, debit: 0, credit: 10000 },
        ],
      });
    assert.ok(
      closedPostAttempt.status === 400 || closedPostAttempt.status === 403,
      'Posting into a HARD_CLOSED period must be rejected'
    );

    // 10. B7: Reopen without reason must be rejected
    const reopenNoReasonRes = await request(app)
      .post(`/api/accounting/periods/${createdPeriodId}/reopen`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: '   ' });
    assert.equal(reopenNoReasonRes.status, 400);

    // 11. Reopen with mandatory reason preserves prior certification and requires revalidation
    const reopenRes = await request(app)
      .post(`/api/accounting/periods/${createdPeriodId}/reopen`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        reason: 'Reopening to record year-end audit adjustment entry',
        approvedByUserName: 'CPA Quality Reviewer',
      });
    assert.equal(reopenRes.status, 200);
    assert.equal(reopenRes.body.status, 'OPEN');
    assert.equal(reopenRes.body.preservedCertificationsCount, 1);
    assert.equal(reopenRes.body.requiresRevalidationBeforeNextClose, true);

    // 12. Verify history endpoint has normalized timestamps (no year 58832) and enriched attribution
    const histRes = await request(app)
      .get(`/api/accounting/periods/${createdPeriodId}/history`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(histRes.status, 200);
    assert.ok(histRes.body.length >= 4); // CREATE, SOFT_CLOSE, HARD_CLOSE, REOPEN
    for (const h of histRes.body) {
      assert.ok(
        !String(h.createdAt).includes('58832'),
        'History ISO timestamp must not be year 58832'
      );
      assert.ok(
        !String(h.formattedTimestamp).includes('58832'),
        'Formatted timestamp must not be year 58832'
      );
      assert.ok(h.changedByName, 'History entry must include user display name');
    }

    // 13. B8: Verify Read-Only Auditor cannot execute period close or policy mutation
    const auditorCloseAttempt = await request(app)
      .post(`/api/accounting/periods/${createdPeriodId}/soft-close`)
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({ reason: 'Auditor unauthorized close attempt' });
    assert.equal(auditorCloseAttempt.status, 403);

    const auditorPolicyAttempt = await request(app)
      .put('/api/accounting/period-close-policy')
      .set('Authorization', `Bearer ${auditorToken}`)
      .send({ requireWarningJustification: false });
    assert.equal(auditorPolicyAttempt.status, 403);
  });
});
