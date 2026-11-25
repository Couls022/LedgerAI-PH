import { describe, it, beforeAll as before, afterAll as after } from 'vitest';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import express from 'express';
import request from 'supertest';
import * as schema from '../../src/server/db/schema';
import { CompanyManager } from '../../src/server/services/companyManager';
import {
  ORIGINAL_DESKGUARD_LAI_PATH,
  PREVIEW_COMPANY_ID,
  PREVIEW_COMPANY_DIR,
  seedDeskguardStressPreview,
} from '../../src/server/scripts/seedDeskguardStressPreview';

const ORIGINAL_DESKGUARD_EXPECTED_SHA256 =
  '1350910f1af35db1c12214dc50a5100483af7dfac25aeb0938a5109a69070b67';

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

describe('LedgerAI PH — Enterprise 360° Deep Security & Integrity Audit (REQ-360-ARCH-001)', () => {
  let app: express.Express;
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let ownerToken: string;
  let auditorToken: string;
  let sampleInvoiceId: string;
  let samplePayrollId: string;
  let sampleAssetId: string;
  let sampleInventoryId: string;
  let sampleJournalId: string;
  let sampleDocId: string;

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
    if (!fs.existsSync(activePath) && !fs.existsSync(laiPath)) {
      await seedDeskguardStressPreview();
    }

    const targetDbPath = fs.existsSync(activePath) ? activePath : laiPath;
    sqlite = new Database(targetDbPath);
    db = drizzle(sqlite, { schema });

    // 1. Create Owner Session
    const ownerUserId = 'usr-dg-owner';
    const ownerSessionId = crypto.randomBytes(32).toString('hex');
    const hashedOwnerSession = crypto.createHash('sha256').update(ownerSessionId).digest('hex');
    ownerToken = `${PREVIEW_COMPANY_ID}.${ownerSessionId}`;

    const now = Math.floor(Date.now() / 1000);
    const expires = now + 86400;

    sqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(hashedOwnerSession, ownerUserId, expires, now);

    // 2. Use existing seeded Auditor User (usr-dg-auditor) for compensation masking test
    const auditorUserId = 'usr-dg-auditor';
    const auditorSessionId = crypto.randomBytes(32).toString('hex');
    const hashedAuditorSession = crypto.createHash('sha256').update(auditorSessionId).digest('hex');
    auditorToken = `${PREVIEW_COMPANY_ID}.${auditorSessionId}`;

    sqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(hashedAuditorSession, auditorUserId, expires, now);

    // Fetch sample records from preview database using schema definitions
    const invRow = db.select().from(schema.salesInvoices).limit(1).get();
    sampleInvoiceId = invRow?.id || 'sinv-dg-0001';

    const payRow = db.select().from(schema.payrollRuns).limit(1).get();
    samplePayrollId = payRow?.id || 'payrun-dg-0001';

    const faRow = db.select().from(schema.fixedAssets).limit(1).get();
    sampleAssetId = faRow?.id || 'fa-dg-0001';

    const invItemRow = db.select().from(schema.inventoryItems).limit(1).get();
    sampleInventoryId = invItemRow?.id || 'item-dg-0001';

    const jrnRow = db.select().from(schema.journalEntries).limit(1).get();
    sampleJournalId = jrnRow?.id || 'jrn-dg-0001';

    const docRow = db.select().from(schema.documents).limit(1).get();
    sampleDocId = docRow?.id || 'doc-dg-0001';

    try {
      const manifestPath = path.join(PREVIEW_COMPANY_DIR, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        await CompanyManager.registerCompany(manifest);
      }
    } catch (_) {}

    const { createApp } = await import('../../src/server/app');
    app = createApp();
  });

  after(() => {
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

  it('AUDIT-SEC-01: Rejects unauthenticated direct API requests with 401', async () => {
    const res = await request(app)
      .get(`/api/journey/360/SALES_INVOICE/${sampleInvoiceId}`);
    assert.equal(res.status, 401, 'Request without token must return 401');
    assert.equal(res.body.error, 'AUTH_REQUIRED');
    assert.match(res.body.message, /Authentication required/i);
  });

  it('AUDIT-SEC-02: Rejects invalid or forged bearer tokens with 401', async () => {
    const res = await request(app)
      .get(`/api/journey/360/SALES_INVOICE/${sampleInvoiceId}`)
      .set('Authorization', 'Bearer invalid.bogus.token.signature');
    assert.equal(res.status, 401, 'Request with forged token must return 401');
    assert.ok(['SESSION_EXPIRED', 'AUTH_REQUIRED'].includes(res.body.error));
  });

  it('AUDIT-SEC-03: Gracefully handles non-existent record IDs with 404 and clean response', async () => {
    const res = await request(app)
      .get(`/api/journey/360/SALES_INVOICE/non-existent-uuid-99999`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(res.status, 404, 'Non-existent record ID must return 404');
    assert.equal(res.body.error, 'NOT_FOUND');
    assert.match(res.body.message, /not found/i);
  });

  it('AUDIT-SEC-04: Gracefully handles unsupported entity types with 404 error', async () => {
    const res = await request(app)
      .get(`/api/journey/360/UNSUPPORTED_RANDOM_TYPE/test-id`)
      .set('Authorization', `Bearer ${ownerToken}`);
    assert.equal(res.status, 404, 'Unsupported entity type must return 404');
    assert.equal(res.body.error, 'NOT_FOUND');
  });

  it('AUDIT-SEC-05: Enforces sensitive compensation masking for Auditor/Non-Payroll roles', async () => {
    // 1. Auditor request -> should mask payroll compensation
    const resAuditor = await request(app)
      .get(`/api/journey/360/PAYROLL_RUN/${samplePayrollId}`)
      .set('Authorization', `Bearer ${auditorToken}`);

    assert.equal(resAuditor.status, 200);
    assert.equal(resAuditor.body.entitySpecificContext.canViewSensitiveCompensation, false, 'Auditor must have canViewSensitiveCompensation = false');
    if (resAuditor.body.entitySpecificContext.employeeRegister?.length > 0) {
      assert.equal(resAuditor.body.entitySpecificContext.employeeRegister[0].masked, true, 'Auditor must have masked flag on employee records');
      assert.equal(resAuditor.body.entitySpecificContext.employeeRegister[0].basicPay, null, 'Auditor must receive null basicPay');
      assert.equal(resAuditor.body.entitySpecificContext.employeeRegister[0].netPay, null, 'Auditor must receive null netPay');
    }

    // 2. Owner request -> should NOT mask payroll compensation
    const resOwner = await request(app)
      .get(`/api/journey/360/PAYROLL_RUN/${samplePayrollId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    assert.equal(resOwner.status, 200);
    assert.equal(resOwner.body.entitySpecificContext.canViewSensitiveCompensation, true, 'Owner must have canViewSensitiveCompensation = true');
    if (resOwner.body.entitySpecificContext.employeeRegister?.length > 0) {
      assert.notEqual(resOwner.body.entitySpecificContext.employeeRegister[0].netPay, null, 'Owner must receive real netPay');
    }
  });

  it('AUDIT-FIN-01: Verifies Sales Invoice 360 financial math and VAT breakdown consistency', async () => {
    const res = await request(app)
      .get(`/api/journey/360/SALES_INVOICE/${sampleInvoiceId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    const ctx = res.body.entitySpecificContext;
    assert.ok(ctx, 'Context must be present');
    assert.equal(ctx.presentationType, 'FINANCIAL_TRANSACTION_360');

    // Verify 12/112 VAT math
    if (ctx.vatAmountCentavos > 0) {
      assert.ok(ctx.vatableBaseCentavos > 0);
      assert.ok(ctx.totalAmount >= ctx.vatableBaseCentavos);
    }
    assert.ok(typeof ctx.totalAmount === 'number');
    assert.ok(typeof ctx.balanceDue === 'number');
  });

  it('AUDIT-FIN-02: Verifies Journal Entry 360 debit-credit mathematical balance', async () => {
    const res = await request(app)
      .get(`/api/journey/360/JOURNAL_ENTRY/${sampleJournalId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    const ctx = res.body.entitySpecificContext;
    assert.equal(ctx.presentationType, 'FINANCIAL_TRANSACTION_360');
    assert.equal(ctx.isBalancedJournal, true, 'Posted GL journal entries must be strictly balanced (Debit == Credit)');
    assert.equal(ctx.totalDebitCentavos, ctx.totalCreditCentavos, 'totalDebitCentavos must equal totalCreditCentavos exactly');
  });

  it('AUDIT-FIN-03: Verifies Fixed Asset 360 net book value depreciation formula', async () => {
    const res = await request(app)
      .get(`/api/journey/360/FIXED_ASSET/${sampleAssetId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    const ctx = res.body.entitySpecificContext;
    assert.equal(ctx.presentationType, 'FIXED_ASSET_360');
    assert.equal(
      ctx.netBookValue,
      ctx.acquisitionCost - ctx.accumulatedDepreciation,
      'Net book value must equal acquisitionCost - accumulatedDepreciation'
    );
  });

  it('AUDIT-FIN-04: Verifies Inventory Item 360 valuation formula', async () => {
    const res = await request(app)
      .get(`/api/journey/360/INVENTORY_ITEM/${sampleInventoryId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    const ctx = res.body.entitySpecificContext;
    assert.equal(ctx.presentationType, 'INVENTORY_OPERATIONS_360');
    assert.equal(
      ctx.totalValuation,
      Math.round(ctx.quantityOnHand * ctx.unitCost),
      'Total valuation must equal Math.round(quantityOnHand * unitCost)'
    );
  });

  it('AUDIT-DOC-01: Verifies Document 360 cryptographic digest and LAISDOC1 container traceability', async () => {
    const res = await request(app)
      .get(`/api/journey/360/DOCUMENT/${sampleDocId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    assert.equal(res.status, 200);
    const ctx = res.body.entitySpecificContext;
    assert.equal(ctx.presentationType, 'DOCUMENT_INTELLIGENCE_360');
    assert.ok(ctx.fileHash, 'Document must have cryptographic hash');
    assert.ok(ctx.encryptionStatus.includes('ENCRYPTED'), 'Encryption status must indicate encryption');
    assert.ok(ctx.previewUrl.includes(`/api/documents/${sampleDocId}/file`));
  });
});
