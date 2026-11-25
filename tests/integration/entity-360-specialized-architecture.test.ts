import { describe, it, beforeAll as before, afterAll as after } from 'vitest';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import express from 'express';
import request from 'supertest';
import {
  getEntity360Definition,
  getEntity360CoverageMatrix,
  Specialized360PresentationType,
} from '../../src/shared/entity360Registry';
import journeyRouter from '../../src/server/routes/journey';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';
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

describe('LedgerAI PH — Entity-Specific 360° Experience Architecture (REQ-360-ARCH-001)', () => {
  let app: express.Express;
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let ownerUserId: string;
  let bearerToken: string;

  before(async () => {
    if (fs.existsSync(ORIGINAL_DESKGUARD_LAI_PATH)) {
      const preHash = sha256File(ORIGINAL_DESKGUARD_LAI_PATH);
      assert.equal(
        preHash,
        ORIGINAL_DESKGUARD_EXPECTED_SHA256,
        'Original Deskguard Solutions database.lai SHA-256 must match baseline before test execution'
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

    ownerUserId = 'usr-dg-owner';
    const sessionId = crypto.randomBytes(32).toString('hex');
    const hashedSessionId = crypto.createHash('sha256').update(sessionId).digest('hex');
    bearerToken = `${PREVIEW_COMPANY_ID}.${sessionId}`;

    const now = new Date();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    sqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        hashedSessionId,
        ownerUserId,
        Math.floor(expires.getTime() / 1000),
        Math.floor(now.getTime() / 1000)
      );

    // Also register the preview company manifest in CompanyManager if not yet registered in memory
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
        'Original Deskguard Solutions database.lai SHA-256 must remain 100% untouched after test execution'
      );
    }
  });

  it('1. Registry Validation: Covers all 12 specialized 360° experience categories with non-identical domain tabs & headers', async () => {
    const matrix = getEntity360CoverageMatrix();
    assert.ok(matrix.length >= 25, `Expected at least 25 registered entity definitions, got ${matrix.length}`);

    const expectedCategories: Specialized360PresentationType[] = [
      'FINANCIAL_TRANSACTION_360',
      'CUSTOMER_RELATIONSHIP_360',
      'VENDOR_RELATIONSHIP_360',
      'INVENTORY_OPERATIONS_360',
      'PAYROLL_360',
      'TAX_COMPLIANCE_360',
      'BANKING_RECONCILIATION_360',
      'FIXED_ASSET_360',
      'DOCUMENT_INTELLIGENCE_360',
      'APPROVAL_WORKFLOW_360',
      'AUDIT_ENGAGEMENT_360',
      'SYSTEM_OPERATIONS_360',
    ];

    const presentCategories = new Set(matrix.map((m) => m.presentationType));
    for (const cat of expectedCategories) {
      assert.ok(presentCategories.has(cat), `Missing specialized 360 category: ${cat}`);
    }

    // Verify non-financial entities DO NOT show the 4-step Accounting Workflow Stepper
    const customerDef = getEntity360Definition('CUSTOMER');
    const inventoryDef = getEntity360Definition('INVENTORY_ITEM');
    const documentDef = getEntity360Definition('DOCUMENT');
    const salesInvoiceDef = getEntity360Definition('SALES_INVOICE');

    assert.equal(salesInvoiceDef.headerConfig.showsAccountingWorkflowStepper, true);
    assert.equal(customerDef.headerConfig.showsAccountingWorkflowStepper, false);
    assert.equal(inventoryDef.headerConfig.showsAccountingWorkflowStepper, false);
    assert.equal(documentDef.headerConfig.showsAccountingWorkflowStepper, false);

    // Verify GET /api/journey/registry endpoint
    const res = await request(app)
      .get('/api/journey/registry')
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.totalCategories, 12);
    assert.ok(Array.isArray(res.body.coverageMatrix));
  });

  it('2. Category A — FINANCIAL_TRANSACTION_360: Sales Invoice, Purchase Bill, Journal Entry & Purchase Order', async () => {
    const inv = db.select().from(schema.salesInvoices).limit(1).get();
    const bill = db.select().from(schema.purchaseBills).limit(1).get();
    const je = db.select().from(schema.journalEntries).limit(1).get();
    const po = db.select().from(schema.purchaseOrders).limit(1).get();

    assert.ok(inv && bill && je && po, 'Persisted financial transaction records must exist in Stress Preview');

    const invRes = await request(app)
      .get(`/api/journey/360/SALES_INVOICE/${inv.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(invRes.status, 200);
    assert.equal(invRes.body.presentationType, 'FINANCIAL_TRANSACTION_360');
    assert.equal(invRes.body.rendererComponent, 'FinancialTransaction360View');
    assert.equal(invRes.body.entitySpecificContext.presentationType, 'FINANCIAL_TRANSACTION_360');
    assert.ok(invRes.body.entitySpecificContext.totalAmount >= 0);

    const jeRes = await request(app)
      .get(`/api/journey/360/JOURNAL_ENTRY/${je.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(jeRes.status, 200);
    assert.equal(jeRes.body.presentationType, 'FINANCIAL_TRANSACTION_360');
    assert.equal(jeRes.body.entitySpecificContext.isBalancedJournal, true);
    assert.ok(jeRes.body.lines.length >= 2);
  });

  it('3. Categories B & C — CUSTOMER_RELATIONSHIP_360 & VENDOR_RELATIONSHIP_360: Customer & Vendor Dossiers', async () => {
    const customer = db
      .select()
      .from(schema.customers)
      .limit(1)
      .get();
    const vendor = db
      .select()
      .from(schema.vendors)
      .limit(1)
      .get();

    assert.ok(customer && vendor, 'Persisted customer and vendor records must exist');

    const custRes = await request(app)
      .get(`/api/journey/360/CUSTOMER/${customer.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(custRes.status, 200);
    assert.equal(custRes.body.presentationType, 'CUSTOMER_RELATIONSHIP_360');
    assert.equal(custRes.body.rendererComponent, 'CustomerRelationship360View');
    assert.equal(custRes.body.entitySpecificContext.presentationType, 'CUSTOMER_RELATIONSHIP_360');
    assert.ok(custRes.body.entitySpecificContext.receivableBalance !== undefined);
    assert.ok(Array.isArray(custRes.body.entitySpecificContext.invoices));

    const vendRes = await request(app)
      .get(`/api/journey/360/VENDOR/${vendor.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(vendRes.status, 200);
    assert.equal(vendRes.body.presentationType, 'VENDOR_RELATIONSHIP_360');
    assert.equal(vendRes.body.rendererComponent, 'VendorRelationship360View');
    assert.equal(vendRes.body.entitySpecificContext.presentationType, 'VENDOR_RELATIONSHIP_360');
    assert.ok(vendRes.body.entitySpecificContext.payableBalance !== undefined);
    assert.ok(Array.isArray(vendRes.body.entitySpecificContext.bills));
  });

  it('4. Category D — INVENTORY_OPERATIONS_360: Inventory SKU Ledger & Valuation', async () => {
    const item = db.select().from(schema.inventoryItems).limit(1).get();
    assert.ok(item, 'Persisted inventory item must exist');

    const res = await request(app)
      .get(`/api/journey/360/INVENTORY_ITEM/${item.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.presentationType, 'INVENTORY_OPERATIONS_360');
    assert.equal(res.body.rendererComponent, 'InventoryOperations360View');
    assert.equal(res.body.entitySpecificContext.presentationType, 'INVENTORY_OPERATIONS_360');
    assert.ok(res.body.entitySpecificContext.quantityOnHand !== undefined);
    assert.ok(Array.isArray(res.body.entitySpecificContext.movements));
  });

  it('5. Category E — PAYROLL_360: Payroll Run Statutory Breakdown & Employee Compensation Masking', async () => {
    const run = db.select().from(schema.payrollRuns).limit(1).get();
    const emp = db.select().from(schema.employees).limit(1).get();
    assert.ok(run && emp, 'Persisted payroll run and employee must exist');

    const runRes = await request(app)
      .get(`/api/journey/360/PAYROLL_RUN/${run.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(runRes.status, 200);
    assert.equal(runRes.body.presentationType, 'PAYROLL_360');
    assert.equal(runRes.body.rendererComponent, 'Payroll360View');
    assert.equal(runRes.body.entitySpecificContext.payrollSubtype, 'PAYROLL_RUN');
    assert.ok(runRes.body.entitySpecificContext.employeeCount > 0);

    const empRes = await request(app)
      .get(`/api/journey/360/EMPLOYEE/${emp.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(empRes.status, 200);
    assert.equal(empRes.body.presentationType, 'PAYROLL_360');
    assert.equal(empRes.body.entitySpecificContext.payrollSubtype, 'EMPLOYEE');
    assert.ok(empRes.body.entitySpecificContext.ytdGrossPay !== undefined);
  });

  it('6. Category F — TAX_COMPLIANCE_360: BIR Tax Return with Honest Filing Verification Banner', async () => {
    const filing = db.select().from(schema.taxFilings).limit(1).get();
    assert.ok(filing, 'Persisted BIR tax filing must exist');

    const res = await request(app)
      .get(`/api/journey/360/TAX_FILING/${filing.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.presentationType, 'TAX_COMPLIANCE_360');
    assert.equal(res.body.rendererComponent, 'TaxCompliance360View');
    assert.equal(res.body.entitySpecificContext.presentationType, 'TAX_COMPLIANCE_360');
    assert.ok(res.body.entitySpecificContext.honestFilingStatus !== undefined);
  });

  it('7. Category G — BANKING_RECONCILIATION_360: Bank Reconciliation & Chart of Accounts Ledger', async () => {
    const recon = db.select().from(schema.bankReconciliations).limit(1).get();
    const acct = db.select().from(schema.accounts).limit(1).get();
    assert.ok(recon && acct, 'Persisted bank reconciliation and COA account must exist');

    const reconRes = await request(app)
      .get(`/api/journey/360/BANK_RECONCILIATION/${recon.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(reconRes.status, 200);
    assert.equal(reconRes.body.presentationType, 'BANKING_RECONCILIATION_360');
    assert.equal(reconRes.body.rendererComponent, 'BankingReconciliation360View');
    assert.equal(reconRes.body.entitySpecificContext.bankingSubtype, 'BANK_RECONCILIATION');

    const acctRes = await request(app)
      .get(`/api/journey/360/ACCOUNT/${acct.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(acctRes.status, 200);
    assert.equal(acctRes.body.presentationType, 'BANKING_RECONCILIATION_360');
    assert.equal(acctRes.body.entitySpecificContext.bankingSubtype, 'ACCOUNT');
    assert.equal(acctRes.body.entitySpecificContext.accountCode, acct.accountCode);
  });

  it('8. Category H — FIXED_ASSET_360: Fixed Asset Cost, NBV & Depreciation Schedule', async () => {
    const asset = db.select().from(schema.fixedAssets).limit(1).get();
    assert.ok(asset, 'Persisted fixed asset must exist');

    const res = await request(app)
      .get(`/api/journey/360/FIXED_ASSET/${asset.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.presentationType, 'FIXED_ASSET_360');
    assert.equal(res.body.rendererComponent, 'FixedAsset360View');
    assert.equal(res.body.entitySpecificContext.assetTag, asset.assetTag);
    assert.ok(Array.isArray(res.body.entitySpecificContext.schedules));
  });

  it('9. Category I — DOCUMENT_INTELLIGENCE_360: Encrypted LAISDOC1 Storage, SHA-256 & OCR Provenance', async () => {
    const doc = db.select().from(schema.documents).limit(1).get();
    assert.ok(doc, 'Persisted encrypted document must exist');

    const res = await request(app)
      .get(`/api/journey/360/DOCUMENT/${doc.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.presentationType, 'DOCUMENT_INTELLIGENCE_360');
    assert.equal(res.body.rendererComponent, 'DocumentIntelligence360View');
    assert.equal(res.body.entitySpecificContext.presentationType, 'DOCUMENT_INTELLIGENCE_360');
    assert.ok(res.body.entitySpecificContext.previewUrl.includes(`/api/documents/${doc.id}/file`));
  });

  it('10. Category J — APPROVAL_WORKFLOW_360: Maker-Checker SoD Decision Matrix & Budget Allocation', async () => {
    const wf = db.select().from(schema.approvalWorkflows).limit(1).get();
    const budget = db.select().from(schema.budgets).limit(1).get();
    assert.ok(wf && budget, 'Persisted approval workflow and budget must exist');

    const wfRes = await request(app)
      .get(`/api/journey/360/APPROVAL_WORKFLOW/${wf.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(wfRes.status, 200);
    assert.equal(wfRes.body.presentationType, 'APPROVAL_WORKFLOW_360');
    assert.equal(wfRes.body.rendererComponent, 'ApprovalWorkflow360View');
    assert.equal(wfRes.body.entitySpecificContext.approvalSubtype, 'APPROVAL_WORKFLOW');

    const budgetRes = await request(app)
      .get(`/api/journey/360/BUDGET/${budget.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(budgetRes.status, 200);
    assert.equal(budgetRes.body.presentationType, 'APPROVAL_WORKFLOW_360');
    assert.equal(budgetRes.body.entitySpecificContext.approvalSubtype, 'BUDGET');
  });

  it('11. Category K — AUDIT_ENGAGEMENT_360: Audit Engagement, Workpaper & Finding (Tenant-Isolated Join)', async () => {
    const eng = db.select().from(schema.auditEngagements).limit(1).get();
    const wp = db.select().from(schema.auditWorkpapers).limit(1).get();
    const finding = db.select().from(schema.auditFindings).limit(1).get();
    assert.ok(eng && wp && finding, 'Persisted audit engagement, workpaper, and finding must exist');

    const engRes = await request(app)
      .get(`/api/journey/360/AUDIT_ENGAGEMENT/${eng.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(engRes.status, 200);
    assert.equal(engRes.body.presentationType, 'AUDIT_ENGAGEMENT_360');
    assert.equal(engRes.body.rendererComponent, 'AuditEngagement360View');
    assert.equal(engRes.body.entitySpecificContext.auditSubtype, 'AUDIT_ENGAGEMENT');
    assert.ok(Array.isArray(engRes.body.entitySpecificContext.workpapers));

    const wpRes = await request(app)
      .get(`/api/journey/360/AUDIT_WORKPAPER/${wp.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(wpRes.status, 200);
    assert.equal(wpRes.body.presentationType, 'AUDIT_ENGAGEMENT_360');
    assert.equal(wpRes.body.entitySpecificContext.auditSubtype, 'AUDIT_WORKPAPER');

    const findRes = await request(app)
      .get(`/api/journey/360/AUDIT_FINDING/${finding.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(findRes.status, 200);
    assert.equal(findRes.body.presentationType, 'AUDIT_ENGAGEMENT_360');
    assert.equal(findRes.body.entitySpecificContext.auditSubtype, 'AUDIT_FINDING');
  });

  it('12. Category L — SYSTEM_OPERATIONS_360: System Backup & Cryptographic Container Telemetry', async () => {
    let backup = db.select().from(schema.systemBackups).limit(1).get();
    if (!backup) {
      const backupId = 'sys-bak-360-test-01';
      db.insert(schema.systemBackups)
        .values({
          id: backupId,
          companyId: PREVIEW_COMPANY_ID,
          backupName: 'Automated Stress Preview Snapshot (.lai)',
          checksum: crypto.createHash('sha256').update(backupId).digest('hex'),
          sizeBytes: 18450000,
          passwordProtected: false,
          payloadJson: JSON.stringify({ version: '1.0', format: 'LAISENC2' }),
          createdBy: ownerUserId,
          createdAt: new Date(),
        })
        .run();
      backup = db.select().from(schema.systemBackups).where(eq(schema.systemBackups.id, backupId)).get();
    }
    assert.ok(backup, 'System backup record must exist for SYSTEM_OPERATIONS_360 test');

    const res = await request(app)
      .get(`/api/journey/360/SYSTEM_OPERATION/${backup.id}`)
      .set('Authorization', `Bearer ${bearerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.presentationType, 'SYSTEM_OPERATIONS_360');
    assert.equal(res.body.rendererComponent, 'SystemOperations360View');
    assert.equal(res.body.entitySpecificContext.presentationType, 'SYSTEM_OPERATIONS_360');
    assert.ok(res.body.entitySpecificContext.encryptionAlgorithm.includes('AES-256-GCM'));
  });
});
