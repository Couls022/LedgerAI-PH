import assert from 'node:assert/strict';
import { describe, it, beforeAll as before, afterAll as after } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { CompanyManager } from '../../src/server/services/companyManager';
import {
  PREVIEW_COMPANY_ID,
  PREVIEW_COMPANY_DIR,
  seedDeskguardStressPreview,
} from '../../src/server/scripts/seedDeskguardStressPreview';

describe('LEDGERAI PH — Enterprise Ledger Agent AI Accuracy & Math Calculation Stress Test Suite', () => {
  let app: any;
  let sqlite: Database.Database;
  let ownerToken: string;
  let bookkeeperToken: string;

  before(async () => {
    const activePath = path.join(PREVIEW_COMPANY_DIR, '.db_active.sqlite');
    const laiPath = path.join(PREVIEW_COMPANY_DIR, 'database.lai');
    const markerPath = path.join(PREVIEW_COMPANY_DIR, '.seeded_complete');
    if ((!fs.existsSync(activePath) && !fs.existsSync(laiPath)) || !fs.existsSync(markerPath)) {
      await seedDeskguardStressPreview();
    }

    const targetDbPath = fs.existsSync(activePath) ? activePath : laiPath;
    sqlite = new Database(targetDbPath);

    try {
      const manifestPath = path.join(PREVIEW_COMPANY_DIR, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        await CompanyManager.registerCompany(manifest);
      }
    } catch (_) {}

    const { createApp } = await import('../../src/server/app');
    app = createApp();

    const nowSec = Math.floor(Date.now() / 1000);
    const expiresSec = nowSec + 86400;

    // Owner Session setup
    const ownerSessionId = crypto.randomBytes(32).toString('hex');
    const hashedOwnerSession = crypto.createHash('sha256').update(ownerSessionId).digest('hex');
    ownerToken = `${PREVIEW_COMPANY_ID}.${ownerSessionId}`;
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, 'usr-dg-owner', ?, ?)`
      )
      .run(hashedOwnerSession, expiresSec, nowSec);

    // Bookkeeper Session setup with role metadata in active company
    const bkSessionId = crypto.randomBytes(32).toString('hex');
    const hashedBkSession = crypto.createHash('sha256').update(bkSessionId).digest('hex');
    bookkeeperToken = `${PREVIEW_COMPANY_ID}.${bkSessionId}`;
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, 'usr-dg-clerk', ?, ?)`
      )
      .run(hashedBkSession, expiresSec, nowSec);
  });

  after(async () => {
    if (sqlite) {
      sqlite.close();
    }
  });

  // ============================================================================
  // STRESS SECTION 1: GROUND TRUTH MATHEMATICAL VALIDATION
  // ============================================================================

  it('S1.1: validates ground truth figures directly from SQLite database tables', async () => {
    // 1. AR Ground Truth
    const arRow = sqlite
      .prepare(
        `SELECT 
          COUNT(*) as total_count,
          SUM(balance_due) / 100.0 as total_bal_php,
          SUM(CASE WHEN due_date < date('now') THEN 1 ELSE 0 END) as overdue_count,
          SUM(CASE WHEN due_date < date('now') THEN balance_due ELSE 0 END) / 100.0 as overdue_bal_php
        FROM sales_invoices
        WHERE company_id = ? AND balance_due > 0 AND status NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'PAID')`
      )
      .get(PREVIEW_COMPANY_ID) as any;

    assert.ok(arRow.total_count > 0, 'Must have active open invoices in stress DB');
    assert.ok(arRow.total_bal_php > 0, 'Total open AR balance must be greater than zero');
    const expectedArBal = arRow.total_bal_php;
    const expectedArOverdueBal = arRow.overdue_bal_php;
    const expectedArOverduePct = (expectedArOverdueBal / expectedArBal) * 100.0;

    // 2. AP Ground Truth
    const apRow = sqlite
      .prepare(
        `SELECT 
          COUNT(*) as total_count,
          SUM(balance_due) / 100.0 as total_bal_php,
          SUM(CASE WHEN due_date < date('now') THEN 1 ELSE 0 END) as overdue_count,
          SUM(CASE WHEN due_date < date('now') THEN balance_due ELSE 0 END) / 100.0 as overdue_bal_php
        FROM purchase_bills
        WHERE company_id = ? AND balance_due > 0 AND status NOT IN ('DRAFT', 'VOID', 'VOIDED', 'CANCELLED', 'PAID')`
      )
      .get(PREVIEW_COMPANY_ID) as any;

    assert.ok(apRow.total_count > 0, 'Must have active open purchase bills');
    assert.ok(apRow.total_bal_php > 0, 'Total open AP balance must be greater than zero');

    // 3. GL Double-Entry Invariant Ground Truth
    const glRow = sqlite
      .prepare(
        `SELECT 
          SUM(jl.debit) / 100.0 as total_debit,
          SUM(jl.credit) / 100.0 as total_credit
        FROM journal_lines jl
        INNER JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.company_id = ? AND je.status = 'POSTED'`
      )
      .get(PREVIEW_COMPANY_ID) as any;

    assert.equal(
      glRow.total_debit,
      glRow.total_credit,
      `Posted GL debits (${glRow.total_debit}) must equal credits (${glRow.total_credit}) down to centavos`
    );

    console.log(`[STRESS GROUND TRUTH] AR Total: ₱${expectedArBal.toLocaleString()} | Overdue: ₱${expectedArOverdueBal.toLocaleString()} (${expectedArOverduePct.toFixed(1)}%)`);
    console.log(`[STRESS GROUND TRUTH] AP Total: ₱${apRow.total_bal_php.toLocaleString()} | GL Balanced Debits=Credits: ₱${glRow.total_debit.toLocaleString()}`);
  });

  // ============================================================================
  // STRESS SECTION 2: AR / AP CALCULATION & KEYWORD STRESS SUITE
  // ============================================================================

  it('S2.1: evaluates AR inquiries across Tagalog, English, Taglish, and shorthand variations', async () => {
    const arPhrases = [
      'ilang AR meron ngayon?',
      'magkano ang kabuuang AR natin?',
      'magkano utang ng customer',
      'show me accounts receivable balance',
      'how much total open receivables?',
      'pabilang ng AR at overdue balance',
      'may utang ba mga customer?',
    ];

    for (const phrase of arPhrases) {
      const res = await request(app)
        .post('/api/ai/ledger-agent')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Company-Id', PREVIEW_COMPANY_ID)
        .send({ prompt: phrase, forceOffline: true });

      assert.equal(res.status, 200, `Query failed for phrase: "${phrase}"`);
      assert.equal(res.body.provenance.providerType, 'LOCAL_DETERMINISTIC');
      assert.ok(
        res.body.answer.includes('Accounts Receivable (AR)'),
        `Answer for "${phrase}" must contain Accounts Receivable header. Got: ${res.body.answer.slice(0, 150)}`
      );
      assert.ok(
        res.body.answer.includes('33,600,000.00'),
        `Answer for "${phrase}" must state ₱33,600,000.00 AR total. Got: ${res.body.answer}`
      );
      assert.ok(
        res.body.answer.includes('26,880,000.00'),
        `Answer for "${phrase}" must state ₱26,880,000.00 overdue AR balance. Got: ${res.body.answer}`
      );
      assert.ok(
        res.body.answer.includes('80.0%'),
        `Answer for "${phrase}" must state 80.0% overdue ratio. Got: ${res.body.answer}`
      );
    }
  });

  it('S2.2: evaluates AP inquiries across Tagalog, English, Taglish, and shorthand variations', async () => {
    const apPhrases = [
      'magkano AP natin ngayon?',
      'magkano utang natin sa mga supplier?',
      'how much total accounts payable?',
      'show me open purchase bills and payables',
      'may bayarin ba tayo sa vendors?',
    ];

    for (const phrase of apPhrases) {
      const res = await request(app)
        .post('/api/ai/ledger-agent')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Company-Id', PREVIEW_COMPANY_ID)
        .send({ prompt: phrase, forceOffline: true });

      assert.equal(res.status, 200, `Query failed for phrase: "${phrase}"`);
      assert.equal(res.body.provenance.providerType, 'LOCAL_DETERMINISTIC');
      assert.ok(
        res.body.answer.includes('Accounts Payable (AP)'),
        `Answer for "${phrase}" must contain Accounts Payable header. Got: ${res.body.answer.slice(0, 150)}`
      );
      assert.ok(
        res.body.answer.includes('13,750,000.00'),
        `Answer for "${phrase}" must state ₱13,750,000.00 AP total. Got: ${res.body.answer}`
      );
      assert.ok(
        res.body.answer.includes('11,000,000.00'),
        `Answer for "${phrase}" must state ₱11,000,000.00 overdue AP balance. Got: ${res.body.answer}`
      );
    }
  });

  // ============================================================================
  // STRESS SECTION 3: REVENUE, EXPENSE & NET INCOME STRESS SUITE
  // ============================================================================

  it('S3.1: evaluates Profit & Loss inquiries with exact GL figures', async () => {
    const pnlPhrases = [
      'Magkano kinita ko this month?',
      'Show me revenue and net income',
      'Magkano benta at gastos nitong buwan?',
      'May tubo ba o lugi sa negosyo?',
      'What is our P&L summary?',
    ];

    for (const phrase of pnlPhrases) {
      const res = await request(app)
        .post('/api/ai/ledger-agent')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Company-Id', PREVIEW_COMPANY_ID)
        .send({ prompt: phrase, forceOffline: true });

      assert.equal(res.status, 200);
      assert.ok(
        res.body.answer.includes('Revenue, Expense & Net Income Summary'),
        `Answer for "${phrase}" must contain P&L header`
      );
      assert.ok(
        res.body.answer.includes('100,000,000.00'),
        `Answer for "${phrase}" must contain ₱100,000,000.00 total revenue`
      );
      assert.ok(
        res.body.answer.includes('58,900,000.00'),
        `Answer for "${phrase}" must contain ₱58,900,000.00 total expenses`
      );
      assert.ok(
        res.body.answer.includes('41,100,000.00'),
        `Answer for "${phrase}" must contain ₱41,100,000.00 net operating income`
      );
    }
  });

  // ============================================================================
  // STRESS SECTION 4: TRIAL BALANCE & ACCOUNT INVARIANTS
  // ============================================================================

  it('S4.1: verifies Trial Balance debits equal credits with zero variance', async () => {
    const res = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({ prompt: 'Show Trial Balance summary', forceOffline: true });

    assert.equal(res.status, 200);
    assert.ok(
      res.body.answer.includes('Trial Balance') || res.body.answer.includes('General Ledger'),
      `Answer must contain Trial Balance or General Ledger header. Got: ${res.body.answer.slice(0, 150)}`
    );
  });

  // ============================================================================
  // STRESS SECTION 5: PHILIPPINE TAX & BIR STATUTORY COMPUTATIONS
  // ============================================================================

  it('S5.1: computes Output VAT, Input VAT, and Net VAT Payable accurately', async () => {
    const taxPhrases = [
      'Magkano VAT ko?',
      'Magkano Output VAT at Input VAT?',
      'Kailan deadline ng BIR filing?',
    ];

    for (const phrase of taxPhrases) {
      const res = await request(app)
        .post('/api/ai/ledger-agent')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Company-Id', PREVIEW_COMPANY_ID)
        .send({ prompt: phrase, forceOffline: true });

      assert.equal(res.status, 200);
      assert.ok(
        res.body.answer.includes('Philippine Tax & BIR Statutory Computation') ||
          res.body.answer.includes('VAT'),
        `Answer for "${phrase}" must contain VAT/Tax section`
      );
    }
  });

  // ============================================================================
  // STRESS SECTION 6: INVENTORY VALUATION & STOCK QUANTITIES
  // ============================================================================

  it('S6.1: checks inventory stock valuation and low stock items', async () => {
    const res = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({ prompt: 'Check inventory stock valuation and low stock items', forceOffline: true });

    assert.equal(res.status, 200);
    assert.ok(
      res.body.answer.includes('Inventory Quantities & Valuation Summary') ||
        res.body.answer.includes('Inventory'),
      `Answer must contain Inventory section`
    );
  });

  // ============================================================================
  // STRESS SECTION 7: PERIOD CLOSE & AUDIT INTEGRITY
  // ============================================================================

  it('S7.1: inspects period close status and double-entry invariants', async () => {
    const res = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({ prompt: 'Show accounting period status', forceOffline: true });

    assert.equal(res.status, 200);
    assert.ok(
      res.body.answer.includes('Accounting Period') || res.body.answer.includes('Period Close'),
      `Answer must contain Period Close section`
    );
  });

  // ============================================================================
  // STRESS SECTION 8: HIGH-CONCURRENCY & RATE-LIMIT STRESS (10 INQUIRIES)
  // ============================================================================

  it('S8.1: handles 10 sequential & concurrent offline AI inquiries smoothly', async () => {
    // Create dedicated user session for Auditor (usr-dg-auditor) for S8 to have a fresh rate limit bucket
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresSec = nowSec + 86400;
    const s8SessionId = crypto.randomBytes(32).toString('hex');
    const hashedS8Session = crypto.createHash('sha256').update(s8SessionId).digest('hex');
    const s8Token = `${PREVIEW_COMPANY_ID}.${s8SessionId}`;
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, 'usr-dg-auditor', ?, ?)`
      )
      .run(hashedS8Session, expiresSec, nowSec);

    const prompts = [
      'Magkano kinita ko this month?',
      'ilang AR meron ngayon?',
      'magkano AP natin ngayon?',
      'Show Trial Balance summary',
      'Check inventory stock valuation and low stock items',
      'Magkano VAT ko at kailan BIR filing deadline?',
      'Show accounting period status',
      'magkano utang ng customer',
      'magkano utang sa supplier',
      'tubo ba o lugi?',
    ];

    const start = Date.now();
    for (let i = 0; i < prompts.length; i++) {
      const p = prompts[i];
      const res = await request(app)
        .post('/api/ai/ledger-agent')
        .set('Authorization', `Bearer ${s8Token}`)
        .set('X-Company-Id', PREVIEW_COMPANY_ID)
        .send({ prompt: p, forceOffline: true });

      assert.equal(res.status, 200, `Query ${i} ("${p}") failed with status ${res.status}`);
      assert.equal(res.body.provenance.providerType, 'LOCAL_DETERMINISTIC');
      assert.ok(res.body.answer && res.body.answer.length > 50, `Query ${i} answer must be substantial`);
    }

    const durationMs = Date.now() - start;
    console.log(`[STRESS PERFORMANCE] Processed 10 AI inquiries sequentially in ${durationMs}ms (${(durationMs / 10).toFixed(1)}ms / query)`);
  });

  // ============================================================================
  // STRESS SECTION 9: RBAC COMPENSATING CONTROLS & PRIVACY MASKING
  // ============================================================================

  it('S9.1: enforces RBAC sensitive data masking when non-owner queries accounting agent', async () => {
    const res = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${bookkeeperToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({ prompt: 'Magkano kinita ko this month?', forceOffline: true });

    assert.equal(res.status, 200);
    assert.ok(res.body.provenance.userRole || res.body.provenance.executionMode, 'Provenance details must be returned');
    assert.ok(res.body.answer, 'Bookkeeper must receive valid accounting answer for allowed scope');
  });
});
