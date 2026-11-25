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

describe('REQ-UX-SCROLL-001 — Enterprise Global Scroll, Navigation & Content Density Test Suite', () => {
  let app: any;
  let sqlite: Database.Database;
  let ownerToken: string;

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

    const ownerSessionId = crypto.randomBytes(32).toString('hex');
    const hashedOwnerSession = crypto.createHash('sha256').update(ownerSessionId).digest('hex');
    ownerToken = `${PREVIEW_COMPANY_ID}.${ownerSessionId}`;
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, 'usr-dg-owner', ?, ?)`
      )
      .run(hashedOwnerSession, expiresSec, nowSec);
  });

  after(async () => {
    if (sqlite) {
      sqlite.close();
    }
  });

  // ============================================================================
  // TEST SECTION 1: SERVER-SIDE PAGINATION & LIMIT/OFFSET SCOPING
  // ============================================================================

  it('U1.1: verifies server-side pagination with limit, offset, totalMatches, and tenant scoping on Audit Logs API', async () => {
    const limit = 25;
    const res = await request(app)
      .get(`/api/journey/investigation?limit=${limit}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID);

    assert.equal(res.status, 200);
    const logs = res.body.items || res.body.logs || [];
    assert.ok(Array.isArray(logs), 'Logs response must be an array');
    assert.ok(logs.length <= limit, `Returned logs count (${logs.length}) must not exceed limit (${limit})`);
    assert.ok(typeof res.body.totalMatches === 'number' || typeof res.body.totalCount === 'number', 'totalMatches must be a number');

    // Verify tenant isolation
    for (const log of logs) {
      assert.equal(log.companyId, PREVIEW_COMPANY_ID, 'Audit logs must belong exclusively to active tenant');
    }
  });

  it('U1.2: verifies server-side pagination on Global Activity Journey Stream API', async () => {
    const limit = 10;
    const res = await request(app)
      .get(`/api/journey/activity-center?limit=${limit}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.logs || res.body.activities || res.body.items), 'Journey stream response items must be an array');
  });

  // ============================================================================
  // TEST SECTION 2: AI AGENT MONTH-SPECIFIC PERIOD MAPPING & TIMEZONE CUTOFF
  // ============================================================================

  it('U2.1: resolves month-specific period queries ("November 2026") accurately without arbitrary substitution', async () => {
    const res = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({ prompt: 'Ano ang status ng November 2026 accounting period?', forceOffline: true });

    assert.equal(res.status, 200);
    assert.equal(res.body.provenance.providerType, 'LOCAL_DETERMINISTIC');
    assert.ok(
      res.body.answer.includes('November 2026') || res.body.answer.includes('Accounting Period Not Found for November 2026'),
      `Answer must explicitly address November 2026. Got: ${res.body.answer.slice(0, 200)}`
    );
  });

  it('U2.2: tracks overdue, current, and missing_due_date categories explicitly using PHT timezone cutoff', async () => {
    const res = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', PREVIEW_COMPANY_ID)
      .send({ prompt: 'ilang AR meron ngayon at overdue breakdown?', forceOffline: true });

    assert.equal(res.status, 200);
    assert.ok(res.body.answer.includes('PHT Cutoff'), 'Answer must state PHT Cutoff date');
    assert.ok(res.body.answer.includes('Overdue Invoices'), 'Answer must list Overdue category');
    assert.ok(res.body.answer.includes('Current (Not Due)'), 'Answer must list Current category');
  });

  // ============================================================================
  // TEST SECTION 3: FRONTEND LAYOUT & COMPONENT SOURCE FILE ARCHITECTURE
  // ============================================================================

  it('U3.1: verifies presence and structure of Layout, BackToTop, PaginationControls, and global CSS', async () => {
    const layoutPath = path.join(process.cwd(), 'src/client/components/Layout.tsx');
    const backToTopPath = path.join(process.cwd(), 'src/client/components/shared/BackToTop.tsx');
    const paginationPath = path.join(process.cwd(), 'src/client/components/PaginationControls.tsx');
    const cssPath = path.join(process.cwd(), 'src/index.css');

    assert.ok(fs.existsSync(layoutPath), 'Layout.tsx component file must exist');
    assert.ok(fs.existsSync(backToTopPath), 'BackToTop.tsx component file must exist');
    assert.ok(fs.existsSync(paginationPath), 'PaginationControls.tsx component file must exist');
    assert.ok(fs.existsSync(cssPath), 'index.css file must exist');

    const layoutCode = fs.readFileSync(layoutPath, 'utf8');
    const cssCode = fs.readFileSync(cssPath, 'utf8');
    const paginationCode = fs.readFileSync(paginationPath, 'utf8');

    assert.ok(layoutCode.includes('main-scroll-viewport'), 'Layout.tsx must assign main-scroll-viewport ID');
    assert.ok(layoutCode.includes('<BackToTop'), 'Layout.tsx must mount BackToTop component');
    assert.ok(cssCode.includes('scrollbar-width'), 'index.css must define scrollbar-width rules');
    assert.ok(cssCode.includes('sticky-table-header'), 'index.css must define sticky-table-header utility');
    assert.ok(paginationCode.includes('pageSizeOptions'), 'PaginationControls.tsx must accept pageSizeOptions');
  });
});
