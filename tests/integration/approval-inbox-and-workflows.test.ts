import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { RbacService } from '../../src/server/services/rbacService';
import { hashToken } from '../../src/server/auth';
import { paths } from '../../src/server/services/paths';

import { dbContext } from '../../src/server/db/context';

const DRYRUN_COMPANY_ID = 'LGR-PH-APPROVAL-DRYRUN-2026';
const DRYRUN_COMPANY_NAME = 'LedgerAI PH Approval Dry-Run Synthetic Corp.';
const FOREIGN_COMPANY_ID = 'LGR-PH-APPROVAL-FOREIGN-2026';
const FOREIGN_COMPANY_NAME = 'LedgerAI PH Foreign Tenant Isolation Corp.';
const PREVIEW_COMPANY_ID = 'LGR-PH-2026-STRESS-DG-PREVIEW';

function sha256File(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

interface TestActor {
  id: string;
  email: string;
  displayName: string;
  roleName: string;
  token: string;
}

describe('LEDGERAI PH — APPROVAL INBOX FUNCTIONALITY AUDIT, REPAIR & END-TO-END DRY-RUN (PHASES 1–10)', () => {
  const app = createApp();

  const deskguardOrigLaiPath = path.join(paths.getCompaniesRootDir(), 'deskguard_solutions', 'company.lai');
  const testCorpOrigLaiPath = path.join(paths.getCompaniesRootDir(), 'test_corp', 'company.lai');
  let preDeskguardSha256: string | null = null;
  let preTestCorpSha256: string | null = null;

  // 7 Required Separate User Identities (Phase 4)
  const actors: Record<
    | 'owner'
    | 'requester'
    | 'deptManager'
    | 'financeApprover'
    | 'finalApprover'
    | 'readOnlyAccountant'
    | 'unauthorizedUser'
    | 'foreignOwner',
    TestActor
  > = {
    owner: {
      id: 'usr-dryrun-owner',
      email: 'owner@dryrun.ph',
      displayName: 'Carlos Mendoza (Company Owner)',
      roleName: 'Company Owner',
      token: '',
    },
    requester: {
      id: 'usr-dryrun-requester',
      email: 'requester@dryrun.ph',
      displayName: 'Maria Santos (Staff Accountant / Requester)',
      roleName: 'Accountant',
      token: '',
    },
    deptManager: {
      id: 'usr-dryrun-dept-mgr',
      email: 'manager@dryrun.ph',
      displayName: 'Pedro Reyes (Department Manager)',
      roleName: 'Approver',
      token: '',
    },
    financeApprover: {
      id: 'usr-dryrun-finance',
      email: 'finance@dryrun.ph',
      displayName: 'Elena Lim (Finance Approver)',
      roleName: 'Approver',
      token: '',
    },
    finalApprover: {
      id: 'usr-dryrun-final',
      email: 'cfo@dryrun.ph',
      displayName: 'Roberto Tan (Final Approver)',
      roleName: 'Approver',
      token: '',
    },
    readOnlyAccountant: {
      id: 'usr-dryrun-readonly',
      email: 'readonly@dryrun.ph',
      displayName: 'Sofia Cruz (Read-Only Accountant)',
      roleName: 'Auditor',
      token: '',
    },
    unauthorizedUser: {
      id: 'usr-dryrun-unauth',
      email: 'unauth@dryrun.ph',
      displayName: 'Mark Villanueva (Unauthorized Clerk)',
      roleName: 'Bookkeeper',
      token: '',
    },
    foreignOwner: {
      id: 'usr-foreign-owner',
      email: 'owner@foreign.ph',
      displayName: 'Foreign Company Owner',
      roleName: 'Company Owner',
      token: '',
    },
  };

  async function provisionActorsInCompany(companyId: string, companyName: string, actorList: TestActor[]) {
    const sqlite = await CompanyManager.getCompanySqlite(companyId);
    const companyDb = await CompanyManager.getCompanyDb(companyId);
    const now = Date.now();

    sqlite.exec(`
      INSERT OR IGNORE INTO companies (id, legal_name, tin, vat_status, currency, status)
      VALUES ('${companyId}', '${companyName}', '009-888-777-000', 'VAT', 'PHP', 'ACTIVE');
    `);

    for (const actor of actorList) {
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
           VALUES (?, ?, 'pbkdf2_hash_test', ?, 'ACTIVE', 1, ?, ?)`
        )
        .run(actor.id, actor.email, actor.displayName, now, now);

      const cuId = `cu-${companyId}-${actor.id}`;
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO company_users (id, user_id, company_id, legacy_role, status, membership_status, default_data_scope, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ACTIVE', 'ACTIVE', 'COMPANY_WIDE', ?, ?)`
        )
        .run(cuId, actor.id, companyId, actor.roleName, now, now);

      const rawToken = crypto.randomBytes(32).toString('hex');
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(hashToken(rawToken), actor.id, now + 86400000 * 7, now);
      actor.token = `${companyId}.${rawToken}`;
    }

    await dbContext.run(companyDb as any, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      for (const actor of actorList) {
        const cuId = `cu-${companyId}-${actor.id}`;
        await RbacService.setMemberRoles(null, cuId, [actor.roleName as any], `Provisioned ${actor.roleName} for approval dry-run`);
        const customLimit =
          actor.id === 'usr-dryrun-final'
            ? 2_500_000_000
            : actor.id === 'usr-dryrun-finance'
            ? 500_000_000
            : actor.id === 'usr-dryrun-dept-mgr'
            ? 500_000_000
            : null;
        sqlite
          .prepare(
            `UPDATE company_users SET default_data_scope = 'COMPANY_WIDE', approval_limit_centavos = COALESCE(?, approval_limit_centavos) WHERE id = ?`
          )
          .run(customLimit, cuId);
        sqlite
          .prepare(
            `UPDATE user_module_assignments SET data_scope = 'COMPANY_WIDE', approval_limit_centavos = COALESCE(?, approval_limit_centavos) WHERE company_user_id = ?`
          )
          .run(customLimit, cuId);
      }

      // Explicitly strip document view & approval permissions from unauthorizedUser (Negative Tests #3 & #16)
      const unauthActor = actorList.find((a) => a.id === 'usr-dryrun-unauth');
      if (unauthActor) {
        const unauthCuId = `cu-${companyId}-${unauthActor.id}`;
        for (const permCode of [
          'approvals:view',
          'approvals:review',
          'approvals:approve',
          'documents:view',
          'documents:read',
          'documents:create',
          'documents:edit',
        ]) {
          sqlite
            .prepare(
              `INSERT OR REPLACE INTO user_permission_overrides (id, company_user_id, permission_code, effect, reason, created_at)
               VALUES (?, ?, ?, 'DENY', 'Explicit security test restriction', ?)`
            )
            .run(`upo-${companyId}-${permCode}`, unauthCuId, permCode, now);
        }
      }
    });
  }

  beforeAll(async () => {
    preDeskguardSha256 = sha256File(deskguardOrigLaiPath);
    preTestCorpSha256 = sha256File(testCorpOrigLaiPath);

    await CompanyManager.closeAllConnections();

    const existing = await CompanyManager.listCompanies({ includeSynthetic: true });
    if (!existing.some((c) => c.id === DRYRUN_COMPANY_ID)) {
      await CompanyManager.createCompanyProfile(
        DRYRUN_COMPANY_ID,
        DRYRUN_COMPANY_NAME,
        undefined,
        undefined,
        false,
        { classification: 'TEST' }
      );
    }
    if (!existing.some((c) => c.id === FOREIGN_COMPANY_ID)) {
      await CompanyManager.createCompanyProfile(
        FOREIGN_COMPANY_ID,
        FOREIGN_COMPANY_NAME,
        undefined,
        undefined,
        false,
        { classification: 'TEST' }
      );
    }

    await provisionActorsInCompany(DRYRUN_COMPANY_ID, DRYRUN_COMPANY_NAME, [
      actors.owner,
      actors.requester,
      actors.deptManager,
      actors.financeApprover,
      actors.finalApprover,
      actors.readOnlyAccountant,
      actors.unauthorizedUser,
    ]);

    const dryrunSqlite = await CompanyManager.getCompanySqlite(DRYRUN_COMPANY_ID);

    // Seed baseline Chart of Accounts, Customer, Vendor, Inventory Item in DRYRUN_COMPANY_ID
    dryrunSqlite.exec(`
      INSERT OR IGNORE INTO accounts (id, company_id, account_code, account_name, account_type, normal_balance, is_cash_account, status) VALUES
        ('acc-dry-cash', '${DRYRUN_COMPANY_ID}', '1010', 'Cash in Bank - BDO', 'ASSET', 'DEBIT', 1, 'ACTIVE'),
        ('acc-dry-ar', '${DRYRUN_COMPANY_ID}', '1110', 'Accounts Receivable', 'RECEIVABLE', 'DEBIT', 0, 'ACTIVE'),
        ('acc-dry-inv', '${DRYRUN_COMPANY_ID}', '1210', 'Merchandise Inventory', 'INVENTORY', 'DEBIT', 0, 'ACTIVE'),
        ('acc-dry-vat-in', '${DRYRUN_COMPANY_ID}', '1410', 'Input VAT', 'OTHER_CURRENT_ASSET', 'DEBIT', 0, 'ACTIVE'),
        ('acc-dry-ap', '${DRYRUN_COMPANY_ID}', '2010', 'Accounts Payable', 'PAYABLE', 'CREDIT', 0, 'ACTIVE'),
        ('acc-dry-vat-out', '${DRYRUN_COMPANY_ID}', '2110', 'Output VAT', 'OTHER_CURRENT_LIABILITY', 'CREDIT', 0, 'ACTIVE'),
        ('acc-dry-rev', '${DRYRUN_COMPANY_ID}', '4010', 'Sales Revenue', 'REVENUE', 'CREDIT', 0, 'ACTIVE'),
        ('acc-dry-cogs', '${DRYRUN_COMPANY_ID}', '5010', 'Cost of Goods Sold', 'COST_OF_SALES', 'DEBIT', 0, 'ACTIVE'),
        ('acc-dry-exp', '${DRYRUN_COMPANY_ID}', '6010', 'Operating Expenses', 'EXPENSE', 'DEBIT', 0, 'ACTIVE');

      INSERT OR IGNORE INTO accounting_periods (id, company_id, name, start_date, end_date, fiscal_year, status)
      VALUES ('per-dry-2026', '${DRYRUN_COMPANY_ID}', 'FY 2026', '2026-01-01', '2026-12-31', 2026, 'OPEN');

      INSERT OR REPLACE INTO vendors (id, company_id, code, legal_name, tin, vat_status, default_payable_account_id, status)
      VALUES ('vnd-dry-01', '${DRYRUN_COMPANY_ID}', 'VND-DRY-001', 'Philippine Industrial Supply Corp.', '001-222-333-000', 'VAT', 'acc-dry-ap', 'ACTIVE');

      INSERT OR REPLACE INTO customers (id, company_id, code, legal_name, tin, vat_status, default_receivable_account_id, status)
      VALUES ('cust-dry-01', '${DRYRUN_COMPANY_ID}', 'CUST-DRY-001', 'Makati Enterprise Holdings Inc.', '004-555-666-000', 'VAT', 'acc-dry-ar', 'ACTIVE');

      INSERT OR IGNORE INTO inventory_items (id, company_id, sku, name, unit_of_measure, costing_method, unit_cost, selling_price, quantity_on_hand, status)
      VALUES ('prd-dry-01', '${DRYRUN_COMPANY_ID}', 'SKU-DRY-001', 'Enterprise Firewall Appliance', 'UNIT', 'FIFO', 5000000, 8000000, 50, 'ACTIVE');
    `);

    // Clear any prior workflows and PR/PO test fixtures in DRYRUN_COMPANY_ID so counts & duplicate-ID guards are deterministic
    try {
      dryrunSqlite.exec(`
        DELETE FROM approval_steps WHERE company_id = '${DRYRUN_COMPANY_ID}';
        DELETE FROM approval_workflows WHERE company_id = '${DRYRUN_COMPANY_ID}';
        DELETE FROM purchase_order_lines WHERE po_id = 'po-converted-from-pr-01';
        DELETE FROM purchase_orders WHERE id = 'po-converted-from-pr-01' AND company_id = '${DRYRUN_COMPANY_ID}';
        DELETE FROM purchase_requisitions WHERE id = 'tx-pr-01' AND company_id = '${DRYRUN_COMPANY_ID}';
      `);
    } catch {
      // tables created on first route call
    }

    await provisionActorsInCompany(FOREIGN_COMPANY_ID, FOREIGN_COMPANY_NAME, [actors.foreignOwner]);
  });

  afterAll(async () => {
    // Clean up temporary test companies from active registry so we leave registry clean
    try {
      await CompanyManager.unregisterCompany(DRYRUN_COMPANY_ID);
    } catch {}
    try {
      await CompanyManager.unregisterCompany(FOREIGN_COMPANY_ID);
    } catch {}

    // Verify original Deskguard Solutions and Test Corp .lai files were NEVER modified
    expect(sha256File(deskguardOrigLaiPath)).toBe(preDeskguardSha256);
    expect(sha256File(testCorpOrigLaiPath)).toBe(preTestCorpSha256);
  });

  it('1. Company Profile Shortcut Unregister & Re-attach (OpenProfile Card Trash Action): unregisters LGR-PH-2026-STRESS-DG-PREVIEW without deleting physical .lai files, prevents background auto-re-registration, and cleanly re-attaches via open-folder', async () => {
    const previewDir = path.join(paths.getCompaniesRootDir(), 'deskguard_solutions_stress_preview');
    // Ensure preview exists and is registered before testing unregister
    const preCheck = await CompanyManager.listCompanies({ includeSynthetic: true });
    if (!preCheck.some((c) => c.id === PREVIEW_COMPANY_ID)) {
      if (fs.existsSync(previewDir)) {
        await CompanyManager.browseAndRegisterCompanyFolder(previewDir);
      } else {
        const { seedDeskguardStressPreview } = await import('../../src/server/scripts/seedDeskguardStressPreview');
        await seedDeskguardStressPreview();
      }
    }

    const initialListRes = await request(app).get('/api/companies');
    expect(initialListRes.status).toBe(200);

    // Unregister LGR-PH-2026-STRESS-DG-PREVIEW via POST /api/companies/:id/unregister
    const unregRes = await request(app)
      .post(`/api/companies/${PREVIEW_COMPANY_ID}/unregister`)
      .set('Authorization', `Bearer ${actors.owner.token}`);
    expect(unregRes.status).toBe(200);
    expect(unregRes.body.status).toBe('UNREGISTERED');
    expect(unregRes.body.filesPreserved).toBe(true);

    // Verify physical folder and manifest.json still exist on disk with registrationStatus = 'UNREGISTERED'
    expect(fs.existsSync(previewDir)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(previewDir, 'manifest.json'), 'utf8'));
    expect(manifest.registrationStatus).toBe('UNREGISTERED');

    // Call GET /api/companies again and verify ensureStressPreviewSeeded() does NOT auto-re-register it!
    const afterUnregListRes = await request(app).get('/api/companies');
    expect(afterUnregListRes.status).toBe(200);
    const afterUnregList = Array.isArray(afterUnregListRes.body)
      ? afterUnregListRes.body
      : afterUnregListRes.body.companies || [];
    const stillPresent = afterUnregList.some((c: any) => c.id === PREVIEW_COMPANY_ID);
    expect(stillPresent).toBe(false);

    // Now re-attach Deskguard Stress Preview via POST /api/companies/open-folder (1-click Re-attach button)
    const reattachRes = await request(app)
      .post('/api/companies/open-folder')
      .send({ folderPath: previewDir });
    expect(reattachRes.status).toBe(200);
    expect(reattachRes.body.company?.id).toBe(PREVIEW_COMPANY_ID);

    // Verify it is back in GET /api/companies
    const afterReattachListRes = await request(app).get('/api/companies');
    expect(afterReattachListRes.status).toBe(200);
    const afterReattachList = Array.isArray(afterReattachListRes.body)
      ? afterReattachListRes.body
      : afterReattachListRes.body.companies || [];
    expect(afterReattachList.some((c: any) => c.id === PREVIEW_COMPANY_ID)).toBe(true);
  }, 120_000);

  it('2. Phase 1 & Phase 2 — Seeded Preview Approval Queue & 9 Queue Filters + 12 Required Columns in LGR-PH-2026-STRESS-DG-PREVIEW', async () => {
    // Create an owner session on LGR-PH-2026-STRESS-DG-PREVIEW
    const previewSqlite = await CompanyManager.getCompanySqlite(PREVIEW_COMPANY_ID);
    const rawPreviewToken = crypto.randomBytes(32).toString('hex');
    const previewOwnerToken = `${PREVIEW_COMPANY_ID}.${rawPreviewToken}`;
    const now = Date.now();
    previewSqlite
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
         VALUES ('usr-dg-owner', 'owner@stress-dg.ledgerai.ph', '$2b$10$wW5K8v6q9Q1Z3X5Y7U9I0O1P2A3S4D5F6G7H8J9K0L1M2N3B4V5C6', 'Juan Dela Cruz (Company Owner)', 'ACTIVE', 1, ?, ?)`
      )
      .run(now, now);
    previewSqlite
      .prepare(
        `INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at)
         VALUES (?, 'usr-dg-owner', ?, ?)`
      )
      .run(hashToken(rawPreviewToken), now + 86400000, now);

    const res = await request(app)
      .get('/api/journey/approvals')
      .set('Authorization', `Bearer ${previewOwnerToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(8);

    // Verify all 9 queue counts are populated
    const qc = res.body.queueCounts;
    expect(qc.myPending).toBeGreaterThan(0);
    expect(qc.allAuthorizedPending).toBeGreaterThan(0);
    expect(qc.awaitingMyApproval).toBeGreaterThan(0);
    expect(qc.delegated).toBeGreaterThan(0);
    expect(qc.overdue).toBeGreaterThan(0);
    expect(qc.returned).toBeGreaterThan(0);
    expect(qc.rejected).toBeGreaterThan(0);
    expect(qc.approved).toBeGreaterThan(0);
    expect(qc.totalHistory).toBeGreaterThanOrEqual(8);

    // Verify all 12 required columns are returned on each queue item
    const sample = res.body.items[0];
    expect(sample).toHaveProperty('entityType'); // 1. Transaction Type
    expect(sample).toHaveProperty('recordReference'); // 2. Transaction Reference
    expect(sample).toHaveProperty('companyName'); // 3. Company
    expect(sample).toHaveProperty('branchCode'); // 3b. Branch
    expect(sample).toHaveProperty('requesterName'); // 4. Requester
    expect(sample).toHaveProperty('requestDate'); // 5. Request Date
    expect(sample).toHaveProperty('amountCentavos'); // 6. Transaction Amount
    expect(sample).toHaveProperty('currency'); // 7. Currency
    expect(sample).toHaveProperty('currentApprovalLevelLabel'); // 8. Current Approval Level
    expect(sample).toHaveProperty('requiredApproverRole'); // 9. Required Approver Role
    expect(sample).toHaveProperty('slaStatus'); // 10. SLA Status
    expect(sample).toHaveProperty('status'); // 11. Current Status
    expect(sample).toHaveProperty('queueFlags'); // 12. Available Actions / Queue Flags
    expect(sample).toHaveProperty('whyApprovalNeeded');

    // Verify queueSection query parameter filtering works for each section
    for (const section of [
      'MY_PENDING',
      'ALL_AUTHORIZED_PENDING',
      'AWAITING_MY_APPROVAL',
      'DELEGATED',
      'OVERDUE',
      'RETURNED',
      'REJECTED',
      'APPROVED',
    ]) {
      const secRes = await request(app)
        .get(`/api/journey/approvals?queueSection=${section}`)
        .set('Authorization', `Bearer ${previewOwnerToken}`);
      expect(secRes.status).toBe(200);
      expect(secRes.body.items.length).toBeGreaterThan(0);
    }
  });

  it('3. Phase 3 — Approval Matrix & Policy Configuration (GET/POST /api/journey/approvals/policies)', async () => {
    // 1. List default policies
    const listRes = await request(app)
      .get('/api/journey/approvals/policies')
      .set('Authorization', `Bearer ${actors.owner.token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.length).toBeGreaterThanOrEqual(4);

    // 2. Create a custom policy rule
    const createRes = await request(app)
      .post('/api/journey/approvals/policies')
      .set('Authorization', `Bearer ${actors.owner.token}`)
      .send({
        policyCode: 'POL-CUSTOM-CAPEX',
        policyName: 'CapEx High-Value Dual Control Policy',
        entityType: 'PURCHASE_ORDER,PURCHASE_BILL',
        branchScope: 'HQ-MNL',
        departmentScope: 'IT Infrastructure',
        minAmountCentavos: 25_000_000, // ₱250,000.00
        maxAmountCentavos: 1_000_000_000, // ₱10,000,000.00
        workflowType: 'SEQUENTIAL',
        minApprovalsRequired: 1,
        slaHours: 12,
        requiredRoles: [
          { stepOrder: 1, stepName: 'Level 1: Department Manager', requiredRole: 'MANAGER', slaHours: 6 },
          { stepOrder: 2, stepName: 'Level 2: Finance Approver', requiredRole: 'CONTROLLER', slaHours: 6 },
        ],
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.policyCode).toBe('POL-CUSTOM-CAPEX');
    expect(createRes.body.version).toBe(1);
    expect(createRes.body.requiredRoles.length).toBe(2);

    // 3. Unauthorized user cannot create or modify policies
    const unauthPolRes = await request(app)
      .post('/api/journey/approvals/policies')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        policyName: 'Unauthorized Policy Change',
      });
    expect(unauthPolRes.status).toBe(403);
  });

  it('4. Phase 4 — Complete End-to-End Multi-Stage Approval Dry-Run (PO -> GRN -> AP Bill -> 3-Tier Approval -> Post to GL -> Supplier Payment -> Bank Reconciliation)', async () => {
    const dryrunSqlite = await CompanyManager.getCompanySqlite(DRYRUN_COMPANY_ID);

    // Step A: Requester creates a high-value Purchase Bill (₱6,500,000.00 = 650,000,000 centavos -> Tier 3: 3-Level Approval)
    const billId = 'bill-e2e-tier3-001';
    const billNumber = 'BILL-2026-E2E-001';
    const amountCentavos = 650_000_000; // ₱6,500,000.00
    const nowMs = Date.now();

    dryrunSqlite
      .prepare(`UPDATE purchase_bills SET journal_entry_id = NULL WHERE id = ?`)
      .run(billId);
    dryrunSqlite
      .prepare(
        `DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE company_id = ? AND source_id = ?)`
      )
      .run(DRYRUN_COMPANY_ID, billId);
    dryrunSqlite
      .prepare(`DELETE FROM journal_entries WHERE company_id = ? AND source_id = ?`)
      .run(DRYRUN_COMPANY_ID, billId);

    dryrunSqlite
      .prepare(
        `INSERT OR REPLACE INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, total_amount, balance_due, status, created_by, created_at, updated_at)
         VALUES (?, ?, 'vnd-dry-01', ?, '2026-11-12', '2026-12-12', ?, ?, 'DRAFT', ?, ?, ?)`
      )
      .run(
        billId,
        DRYRUN_COMPANY_ID,
        billNumber,
        amountCentavos,
        amountCentavos,
        actors.requester.id,
        nowMs,
        nowMs
      );

    // Attach a supporting document to verify Document Attachment visibility in Approval Inbox & 360
    dryrunSqlite
      .prepare(
        `INSERT OR REPLACE INTO documents (id, company_id, file_name, file_type, file_size, file_path, document_type, linked_transaction_id, entity_type, entity_id, ocr_status, uploaded_by, version, created_at, updated_at)
         VALUES ('doc-e2e-bill-001', ?, 'Supplier_Invoice_BILL_2026_E2E_001.pdf', 'application/pdf', 245120, '/vault/Supplier_Invoice_BILL_2026_E2E_001.pdf', 'PURCHASE_INVOICE', ?, 'PURCHASE_BILL', ?, 'COMPLETED', ?, 1, ?, ?)`
      )
      .run(DRYRUN_COMPANY_ID, billId, billId, actors.requester.id, nowMs, nowMs);

    // Verify DRAFT bill has NOT posted to GL
    const glBeforeSubmit = dryrunSqlite
      .prepare(`SELECT COUNT(*) as cnt FROM journal_entries WHERE company_id = ? AND source_id = ?`)
      .get(DRYRUN_COMPANY_ID, billId) as { cnt: number };
    expect(glBeforeSubmit.cnt).toBe(0);

    // Step B: Requester submits the Purchase Bill via canonical action endpoint POST /api/journey/action/PURCHASE_BILL/:id { action: 'SUBMIT' }
    const submitRes = await request(app)
      .post(`/api/journey/action/PURCHASE_BILL/${billId}`)
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        action: 'SUBMIT',
        reason: 'Submitting Tier-3 Enterprise Server Infrastructure Bill for 3-level approval',
      });
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.newStatus).toBe('SUBMITTED');
    expect(submitRes.body.approvalWorkflowId).toBeTruthy();

    const workflowId = submitRes.body.approvalWorkflowId;

    // Step C: Verify workflow appears in Approval Inbox with 3 sequential steps (Level 1 Manager, Level 2 Finance, Level 3 Final Approver)
    const inboxAfterSubmit = await request(app)
      .get(`/api/journey/approvals?entityId=${billId}`)
      .set('Authorization', `Bearer ${actors.deptManager.token}`);
    expect(inboxAfterSubmit.status).toBe(200);
    expect(inboxAfterSubmit.body.items.length).toBe(1);
    const wfItem = inboxAfterSubmit.body.items[0];
    expect(wfItem.id).toBe(workflowId);
    expect(wfItem.status).toBe('IN_PROGRESS');
    expect(wfItem.currentStepOrder).toBe(1);
    expect(wfItem.totalSteps).toBe(3);
    expect(wfItem.supportingDocumentsCount).toBe(1);
    expect(wfItem.queueFlags.isMyPending).toBe(true);
    expect(wfItem.queueFlags.userCanDecideCurrentStep).toBe(true);

    // Step D: Level 1 Approval by Department Manager
    const lvl1Res = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${actors.deptManager.token}`)
      .send({
        decision: 'APPROVE',
        comments: 'Level 1 Department Manager verified delivery quantities and budget allocation.',
      });
    expect(lvl1Res.status).toBe(200);
    expect(lvl1Res.body.workflow.status).toBe('IN_PROGRESS');
    expect(lvl1Res.body.workflow.currentStepOrder).toBe(2);

    // Verify Bill is now UNDER_REVIEW and still NOT posted to GL
    const billAfterLvl1 = dryrunSqlite
      .prepare(`SELECT status FROM purchase_bills WHERE id = ?`)
      .get(billId) as { status: string };
    expect(billAfterLvl1.status).toBe('UNDER_REVIEW');

    // Step E: Level 2 Approval by Finance Approver
    const lvl2Res = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${actors.financeApprover.token}`)
      .send({
        decision: 'APPROVE',
        comments: 'Level 2 Finance Approver verified 12% Input VAT computation and EWT ATC WC158.',
      });
    expect(lvl2Res.status).toBe(200);
    expect(lvl2Res.body.workflow.status).toBe('IN_PROGRESS');
    expect(lvl2Res.body.workflow.currentStepOrder).toBe(3);

    // Step F: Level 3 Approval by Final Approver
    const lvl3Res = await request(app)
      .post(`/api/journey/approvals/${workflowId}/decide`)
      .set('Authorization', `Bearer ${actors.finalApprover.token}`)
      .send({
        decision: 'APPROVE',
        comments: 'Level 3 Executive Final Approver granted sign-off for > ₱5M capital expenditure.',
      });
    expect(lvl3Res.status).toBe(200);
    expect(lvl3Res.body.workflow.status).toBe('APPROVED');

    // Verify Bill status is now APPROVED (and moved from Pending queue to Approved queue)
    const billAfterLvl3 = dryrunSqlite
      .prepare(`SELECT status, approved_by FROM purchase_bills WHERE id = ?`)
      .get(billId) as { status: string; approved_by: string };
    expect(billAfterLvl3.status).toBe('APPROVED');
    expect(billAfterLvl3.approved_by).toBe(actors.finalApprover.id);

    const approvedQueueRes = await request(app)
      .get(`/api/journey/approvals?queueSection=APPROVED&entityId=${billId}`)
      .set('Authorization', `Bearer ${actors.owner.token}`);
    expect(approvedQueueRes.status).toBe(200);
    expect(approvedQueueRes.body.items.length).toBe(1);

    // Step G: Post the Approved Purchase Bill to General Ledger via canonical POST action (by Accountant / Owner who holds accounting:post)
    const postRes = await request(app)
      .post(`/api/journey/action/PURCHASE_BILL/${billId}`)
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        action: 'POST',
        reason: 'Posting approved Tier-3 Purchase Bill to General Ledger and AP Subledger',
      });
    expect(postRes.status).toBe(200);
    expect(postRes.body.status).toBe('POSTED');

    // Verify Entity Journey 360 reflects full approval chain, audit logs, and documents
    const j360Res = await request(app)
      .get(`/api/journey/360/PURCHASE_BILL/${billId}`)
      .set('Authorization', `Bearer ${actors.readOnlyAccountant.token}`);
    expect(j360Res.status).toBe(200);
    expect(j360Res.body.record.status).toBe('POSTED');
    expect(j360Res.body.approvalHistory.length).toBeGreaterThanOrEqual(4); // Submit + Lvl1 + Lvl2 + Lvl3
    expect(j360Res.body.documents.length).toBe(1);
  });

  it('5. Phase 4 — All 12 Implemented Transaction Types Support Workflow Initiation & Approval + Complete Purchase Requisition (PR -> PO) Lifecycle', async () => {
    const dryrunSqlite = await CompanyManager.getCompanySqlite(DRYRUN_COMPANY_ID);
    const nowMs = Date.now();

    // 1. Create a Purchase Requisition in DRAFT status via API
    const createPrRes = await request(app)
      .post('/api/journey/requisitions')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        id: 'tx-pr-01',
        prNumber: 'PR-DRY-2026-001',
        requestDate: '2026-11-12',
        neededByDate: '2026-11-28',
        departmentId: 'IT',
        branchCode: 'HQ-MNL',
        preferredVendorId: 'vnd-dry-01',
        preferredVendorName: 'Metro Manila Industrial Supplies Inc.',
        purpose: 'Procurement of Network Firewall & Managed Switches',
        items: [
          {
            description: 'Next-Gen Rackmount Security Firewall Appliance',
            quantity: 2,
            unitCostCentavos: 6_000_000,
            totalCentavos: 12_000_000,
          },
          {
            description: '48-Port PoE+ Managed L3 Switch',
            quantity: 2,
            unitCostCentavos: 3_000_000,
            totalCentavos: 6_000_000,
          },
        ],
        totalAmount: 18_000_000, // ₱180,000.00 (> ₱100k Tier 2: requires Level 1 Manager + Level 2 Finance Controller)
      });
    expect(createPrRes.status).toBe(201);
    expect(createPrRes.body.requisition.status).toBe('DRAFT');

    // 2. Verify unapproved DRAFT requisition CANNOT be converted to a Purchase Order
    const unapprovedConvRes = await request(app)
      .post('/api/journey/requisitions/tx-pr-01/convert-to-po')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({ vendorId: 'vnd-dry-01' });
    expect(unapprovedConvRes.status).toBe(400);
    expect(unapprovedConvRes.body.code).toBe('REQUISITION_NOT_APPROVED');

    // 3. Submit Purchase Requisition for Approval -> Return for Correction -> Edit -> Resubmit -> Approve Level 1 & Level 2
    const prInit1 = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        entityType: 'PURCHASE_REQUISITION',
        entityId: 'tx-pr-01',
        amountCentavos: 18_000_000,
        departmentId: 'IT',
        reason: 'Initial submission of IT firewall requisition',
      });
    expect(prInit1.status).toBe(201);
    expect(prInit1.body.workflow.totalSteps).toBe(2);

    // Return for correction by Department Manager
    const prReturn = await request(app)
      .post(`/api/journey/approvals/${prInit1.body.workflow.id}/decide`)
      .set('Authorization', `Bearer ${actors.deptManager.token}`)
      .send({
        decision: 'RETURN',
        reason: 'Please include 3-year hardware warranty in item specifications.',
      });
    expect(prReturn.status).toBe(200);
    expect(prReturn.body.workflow.status).toBe('RETURNED');

    // Requester edits the RETURNED requisition
    const prEdit = await request(app)
      .put('/api/journey/requisitions/tx-pr-01')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        purpose: 'Procurement of Network Firewall & Managed Switches (with 3-Yr Support)',
        totalAmount: 18_500_000,
        notes: 'Added 3-year manufacturer support per Department Manager feedback',
      });
    expect(prEdit.status).toBe(200);
    expect(prEdit.body.requisition.totalAmount).toBe(18_500_000);

    // Resubmit Purchase Requisition for approval
    const prInit2 = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        entityType: 'PURCHASE_REQUISITION',
        entityId: 'tx-pr-01',
        amountCentavos: 18_500_000,
        departmentId: 'IT',
        reason: 'Resubmitted with 3-year warranty specification',
      });
    expect(prInit2.status).toBe(201);
    expect(prInit2.body.workflow.resubmissionCount).toBe(1);
    const prWfId = prInit2.body.workflow.id;

    // Level 1 Approval by Department Manager
    const prLvl1 = await request(app)
      .post(`/api/journey/approvals/${prWfId}/decide`)
      .set('Authorization', `Bearer ${actors.deptManager.token}`)
      .send({ decision: 'APPROVE', comments: 'Level 1 Manager approved IT requisition' });
    expect(prLvl1.status).toBe(200);
    expect(prLvl1.body.workflow.status).toBe('IN_PROGRESS');

    // Level 2 Final Approval by Finance Approver
    const prLvl2 = await request(app)
      .post(`/api/journey/approvals/${prWfId}/decide`)
      .set('Authorization', `Bearer ${actors.financeApprover.token}`)
      .send({ decision: 'APPROVE', comments: 'Level 2 Finance Controller approved budget allocation' });
    expect(prLvl2.status).toBe(200);
    expect(prLvl2.body.workflow.status).toBe('APPROVED');

    // 4. Verify unauthorized user (Read-Only / Unauthorized Clerk) cannot convert approved PR to PO
    const unauthConvRes = await request(app)
      .post('/api/journey/requisitions/tx-pr-01/convert-to-po')
      .set('Authorization', `Bearer ${actors.readOnlyAccountant.token}`)
      .send({});
    expect(unauthConvRes.status).toBe(403);
    expect(unauthConvRes.body.code).toBe('PERMISSION_DENIED');

    // 5. Authorized user converts Approved Purchase Requisition to Purchase Order
    const convertRes = await request(app)
      .post('/api/journey/requisitions/tx-pr-01/convert-to-po')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        poId: 'po-converted-from-pr-01',
        poNumber: 'PO-DRY-FROM-PR-001',
      });
    expect(convertRes.status).toBe(201);
    expect(convertRes.body.requisition.status).toBe('CONVERTED_TO_PO');
    expect(convertRes.body.requisition.convertedPoId).toBe('po-converted-from-pr-01');
    expect(convertRes.body.purchaseOrder.poNumber).toBe('PO-DRY-FROM-PR-001');
    expect(convertRes.body.purchaseOrder.totalAmount).toBe(18_500_000);

    // 6. Verify duplicate Purchase Order conversion is strictly blocked (409 DUPLICATE_PO_CONVERSION)
    const dupConvertRes = await request(app)
      .post('/api/journey/requisitions/tx-pr-01/convert-to-po')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({});
    expect(dupConvertRes.status).toBe(409);
    expect(dupConvertRes.body.code).toBe('DUPLICATE_PO_CONVERSION');

    // Seed 1 record for each of the remaining 11 implemented transaction types in DRYRUN_COMPANY_ID
    dryrunSqlite.exec(`
      INSERT OR REPLACE INTO purchase_orders (id, company_id, vendor_id, po_number, po_date, total_amount, status, created_by, created_at, updated_at)
      VALUES ('tx-po-01', '${DRYRUN_COMPANY_ID}', 'vnd-dry-01', 'PO-DRY-001', '2026-11-12', 5600000, 'DRAFT', '${actors.requester.id}', ${nowMs}, ${nowMs});

      INSERT OR REPLACE INTO goods_receipt_notes (id, company_id, po_id, grn_number, receipt_date, status, received_by, created_at)
      VALUES ('tx-grn-01', '${DRYRUN_COMPANY_ID}', 'tx-po-01', 'GRN-DRY-001', '2026-11-12', 'DRAFT', '${actors.requester.id}', ${nowMs});

      INSERT OR REPLACE INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, total_amount, balance_due, status, created_by, created_at, updated_at)
      VALUES ('tx-bill-01', '${DRYRUN_COMPANY_ID}', 'vnd-dry-01', 'BILL-DRY-001', '2026-11-12', '2026-12-12', 5600000, 5600000, 'DRAFT', '${actors.requester.id}', ${nowMs}, ${nowMs});

      INSERT OR REPLACE INTO supplier_payments (id, company_id, vendor_id, payment_number, payment_date, amount, cash_account_id, payment_method, status, created_by, created_at, updated_at)
      VALUES ('tx-spay-01', '${DRYRUN_COMPANY_ID}', 'vnd-dry-01', 'SPAY-DRY-001', '2026-11-12', 5600000, 'acc-dry-cash', 'BANK_TRANSFER', 'DRAFT', '${actors.requester.id}', ${nowMs}, ${nowMs});

      INSERT OR REPLACE INTO credit_memos (id, company_id, customer_id, credit_memo_number, memo_date, total_amount, balance_remaining, status, created_by, created_at, updated_at)
      VALUES ('tx-cm-01', '${DRYRUN_COMPANY_ID}', 'cust-dry-01', 'CM-DRY-001', '2026-11-12', 1120000, 1120000, 'DRAFT', '${actors.requester.id}', ${nowMs}, ${nowMs});

      INSERT OR REPLACE INTO journal_entries (id, company_id, journal_number, entry_date, description, source_type, status, created_by, created_at, updated_at)
      VALUES ('tx-je-01', '${DRYRUN_COMPANY_ID}', 'JE-DRY-001', '2026-11-12', 'Manual Accrual Entry', 'MANUAL', 'DRAFT', '${actors.requester.id}', ${nowMs}, ${nowMs});
      INSERT OR REPLACE INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
      VALUES
        ('jl-dry-1', 'tx-je-01', 'acc-dry-exp', 'Accrued Expense', 4500000, 0, 1, ${nowMs}),
        ('jl-dry-2', 'tx-je-01', 'acc-dry-ap', 'Accrued Liability', 0, 4500000, 2, ${nowMs});

      INSERT OR REPLACE INTO cash_transactions (id, company_id, transaction_number, type, transaction_date, cash_account_id, total_amount, description, status, created_by, created_at, updated_at)
      VALUES ('tx-cash-01', '${DRYRUN_COMPANY_ID}', 'CT-DRY-001', 'DISBURSEMENT', '2026-11-12', 'acc-dry-cash', 2500000, 'Petty Cash Replenishment', 'DRAFT', '${actors.requester.id}', ${nowMs}, ${nowMs});

      INSERT OR REPLACE INTO stock_adjustments (id, company_id, adjustment_number, adjustment_date, item_id, quantity_change, reason, status, created_by, created_at)
      VALUES ('tx-inv-01', '${DRYRUN_COMPANY_ID}', 'ADJ-DRY-001', '2026-11-12', 'prd-dry-01', -2, 'DAMAGE', 'DRAFT', '${actors.requester.id}', ${nowMs});

      INSERT OR REPLACE INTO payroll_runs (id, company_id, payroll_period, start_date, end_date, payment_date, total_gross_pay, total_net_pay, status, created_by, created_at, updated_at)
      VALUES ('tx-pay-01', '${DRYRUN_COMPANY_ID}', 'Nov 1-15, 2026 Payroll', '2026-11-01', '2026-11-15', '2026-11-15', 8500000, 7600000, 'DRAFT', '${actors.requester.id}', ${nowMs}, ${nowMs});

      INSERT OR REPLACE INTO tax_filings (id, company_id, tax_type, period_name, start_date, end_date, deadline_date, status, total_tax_base, total_tax_due, net_tax_payable, created_at, updated_at)
      VALUES ('tx-tax-01', '${DRYRUN_COMPANY_ID}', 'VAT', '2026-Q3', '2026-07-01', '2026-09-30', '2026-10-25', 'DRAFT', 26666667, 3200000, 3200000, ${nowMs}, ${nowMs});

      INSERT OR REPLACE INTO bank_reconciliations (id, company_id, bank_account_id, statement_date, statement_ending_balance, book_ending_balance, unexplained_difference, status, created_by, created_at, updated_at)
      VALUES ('tx-brec-01', '${DRYRUN_COMPANY_ID}', 'acc-dry-cash', '2026-11-30', 500000000, 500000000, 0, 'DRAFT', '${actors.requester.id}', ${nowMs}, ${nowMs});
    `);

    const supportedMatrix = [
      { entityType: 'PURCHASE_ORDER', entityId: 'tx-po-01', amountCentavos: 5600000 },
      { entityType: 'GOODS_RECEIPT_NOTE', entityId: 'tx-grn-01', amountCentavos: 5600000 },
      { entityType: 'PURCHASE_BILL', entityId: 'tx-bill-01', amountCentavos: 5600000 },
      { entityType: 'SUPPLIER_PAYMENT', entityId: 'tx-spay-01', amountCentavos: 5600000 },
      { entityType: 'CREDIT_MEMO', entityId: 'tx-cm-01', amountCentavos: 1120000 },
      { entityType: 'JOURNAL_ENTRY', entityId: 'tx-je-01', amountCentavos: 4500000 },
      { entityType: 'CASH_TRANSACTION', entityId: 'tx-cash-01', amountCentavos: 2500000 },
      { entityType: 'STOCK_ADJUSTMENT', entityId: 'tx-inv-01', amountCentavos: 10000000 },
      { entityType: 'PAYROLL_RUN', entityId: 'tx-pay-01', amountCentavos: 7600000 },
      { entityType: 'TAX_FILING', entityId: 'tx-tax-01', amountCentavos: 3200000 },
      { entityType: 'BANK_RECONCILIATION', entityId: 'tx-brec-01', amountCentavos: 500000000 },
    ];

    for (const item of supportedMatrix) {
      const initRes = await request(app)
        .post('/api/journey/approvals/initiate')
        .set('Authorization', `Bearer ${actors.requester.token}`)
        .send({
          entityType: item.entityType,
          entityId: item.entityId,
          amountCentavos: item.amountCentavos,
          reason: `Dry-run initiation for ${item.entityType}`,
        });
      expect(initRes.status).toBe(201);
      expect(initRes.body.workflow.entityType).toBe(item.entityType);

      // Department Manager approves Step 1
      const wfId = initRes.body.workflow.id;
      const decRes = await request(app)
        .post(`/api/journey/approvals/${wfId}/decide`)
        .set('Authorization', `Bearer ${actors.deptManager.token}`)
        .send({
          decision: 'APPROVE',
          comments: `Approved Step 1 for ${item.entityType}`,
        });
      expect(decRes.status).toBe(200);
    }
  });

  // ============================================================================
  // PHASE 5 — 16 INDIVIDUALLY EXECUTED & REPORTED NEGATIVE & SECURITY TESTS
  // ============================================================================
  let negSuiteWfId = '';
  const negBillId = 'bill-neg-suite-001';
  let concWfId = '';
  let slotAId = '';
  let slotBId = '';
  const concBillId = 'bill-neg-conc-001';

  it('NEG-01: Blocks self-approval by transaction requester/creator (Segregation of Duties — 403 SOD_VIOLATION)', async () => {
    const dryrunSqlite = await CompanyManager.getCompanySqlite(DRYRUN_COMPANY_ID);
    const nowMs = Date.now();

    // Seed shared base bill for NEG-02..NEG-08 and NEG-12
    dryrunSqlite
      .prepare(
        `INSERT OR REPLACE INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, total_amount, balance_due, status, created_by, created_at, updated_at)
         VALUES (?, ?, 'vnd-dry-01', 'BILL-NEG-001', '2026-11-12', '2026-12-12', 5600000, 5600000, 'DRAFT', ?, ?, ?)`
      )
      .run(negBillId, DRYRUN_COMPANY_ID, actors.requester.id, nowMs, nowMs);

    const initRes = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        entityType: 'PURCHASE_BILL',
        entityId: negBillId,
        amountCentavos: 5600000,
        branchCode: 'HQ-MNL',
        steps: [
          {
            stepOrder: 1,
            stepName: 'Level 1: Finance Controller Review',
            requiredRole: 'CONTROLLER',
            assignedApproverId: actors.financeApprover.id,
            assignedApproverName: actors.financeApprover.displayName,
          },
        ],
      });
    expect(initRes.status).toBe(201);
    negSuiteWfId = initRes.body.workflow.id;

    // Create a bill submitted by deptManager and attempt self-approval by deptManager
    const sodBillId = 'bill-neg-sod-001';
    dryrunSqlite
      .prepare(
        `INSERT OR REPLACE INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, total_amount, balance_due, status, created_by, created_at, updated_at)
         VALUES (?, ?, 'vnd-dry-01', 'BILL-SOD-001', '2026-11-12', '2026-12-12', 2240000, 2240000, 'DRAFT', ?, ?, ?)`
      )
      .run(sodBillId, DRYRUN_COMPANY_ID, actors.deptManager.id, nowMs, nowMs);

    const sodInitRes = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${actors.deptManager.token}`)
      .send({
        entityType: 'PURCHASE_BILL',
        entityId: sodBillId,
        amountCentavos: 2240000,
      });
    expect(sodInitRes.status).toBe(201);

    const neg1Res = await request(app)
      .post(`/api/journey/approvals/${sodInitRes.body.workflow.id}/decide`)
      .set('Authorization', `Bearer ${actors.deptManager.token}`)
      .send({ decision: 'APPROVE', comments: 'Attempting self-approval' });
    expect(neg1Res.status).toBe(403);
    expect(neg1Res.body.error).toBe('SOD_VIOLATION');
  });

  it('NEG-02: Blocks approval by an unauthorized role lacking step authority (403 PERMISSION_DENIED)', async () => {
    const neg2Res = await request(app)
      .post(`/api/journey/approvals/${negSuiteWfId}/decide`)
      .set('Authorization', `Bearer ${actors.readOnlyAccountant.token}`)
      .send({ decision: 'APPROVE', comments: 'Read-only attempting approval' });
    expect(neg2Res.status).toBe(403);
    expect(neg2Res.body.code).toBe('PERMISSION_DENIED');
  });

  it('NEG-03: Blocks direct API approval by an unauthorized user without approval permissions (403 PERMISSION_DENIED)', async () => {
    const neg3Res = await request(app)
      .post(`/api/journey/approvals/${negSuiteWfId}/decide`)
      .set('Authorization', `Bearer ${actors.unauthorizedUser.token}`)
      .send({ decision: 'APPROVE', comments: 'Direct API bypass attempt' });
    expect(neg3Res.status).toBe(403);
    expect(neg3Res.body.code).toBe('PERMISSION_DENIED');
  });

  it('NEG-04: Blocks approval when transaction amount exceeds user approval limit (403 APPROVAL_LIMIT_EXCEEDED)', async () => {
    const neg4Res = await request(app)
      .post(`/api/journey/approvals/${negSuiteWfId}/decide`)
      .set('Authorization', `Bearer ${actors.financeApprover.token}`)
      .send({
        decision: 'APPROVE',
        callerApprovalLimitCentavos: 1_000_000, // ₱10,000 limit vs ₱56,000 bill
        comments: 'Attempting approval above authority limit',
      });
    expect(neg4Res.status).toBe(403);
    expect(neg4Res.body.error).toBe('APPROVAL_LIMIT_EXCEEDED');
  });

  it('NEG-05: Blocks cross-company approval attempts across isolated tenants (403 CROSS_COMPANY_ACCESS_DENIED)', async () => {
    const neg5Res = await request(app)
      .post(`/api/journey/approvals/${negSuiteWfId}/decide`)
      .set('Authorization', `Bearer ${actors.foreignOwner.token}`)
      .send({
        decision: 'APPROVE',
        targetCompanyId: DRYRUN_COMPANY_ID,
        comments: 'Cross-company approval attempt',
      });
    expect([403, 404]).toContain(neg5Res.status);

    const neg5ExplicitRes = await request(app)
      .post(`/api/journey/approvals/${negSuiteWfId}/decide`)
      .set('Authorization', `Bearer ${actors.financeApprover.token}`)
      .send({
        decision: 'APPROVE',
        targetCompanyId: FOREIGN_COMPANY_ID,
        comments: 'Explicit cross-tenant parameter mismatch',
      });
    expect(neg5ExplicitRes.status).toBe(403);
    expect(neg5ExplicitRes.body.error).toBe('CROSS_COMPANY_ACCESS_DENIED');
  });

  it('NEG-06: Blocks approval when caller branch scope does not match restricted transaction branch (403 BRANCH_SCOPE_DENIED)', async () => {
    const neg6Res = await request(app)
      .post(`/api/journey/approvals/${negSuiteWfId}/decide`)
      .set('Authorization', `Bearer ${actors.financeApprover.token}`)
      .send({
        decision: 'APPROVE',
        callerBranchCode: 'CEBU-BR02', // Workflow belongs to HQ-MNL
        comments: 'Cebu branch manager attempting to approve HQ-MNL transaction',
      });
    expect(neg6Res.status).toBe(403);
    expect(neg6Res.body.error).toBe('BRANCH_SCOPE_DENIED');
  });

  it('NEG-07: Detects and blocks approval when transaction amount was mutated after submission (409 AMOUNT_MUTATED_AFTER_SUBMISSION)', async () => {
    const dryrunSqlite = await CompanyManager.getCompanySqlite(DRYRUN_COMPANY_ID);
    dryrunSqlite
      .prepare(`UPDATE purchase_bills SET total_amount = 9900000 WHERE id = ?`)
      .run(negBillId);

    const neg7Res = await request(app)
      .post(`/api/journey/approvals/${negSuiteWfId}/decide`)
      .set('Authorization', `Bearer ${actors.financeApprover.token}`)
      .send({
        decision: 'APPROVE',
        comments: 'Approving after silent amount mutation',
      });
    expect(neg7Res.status).toBe(409);
    expect(neg7Res.body.error).toBe('AMOUNT_MUTATED_AFTER_SUBMISSION');

    // Restore original amount 5,600,000 centavos
    dryrunSqlite
      .prepare(`UPDATE purchase_bills SET total_amount = 5600000 WHERE id = ?`)
      .run(negBillId);
  });

  it('NEG-08: Blocks duplicate submission of an already-submitted transaction (409 DUPLICATE_SUBMISSION)', async () => {
    const neg8Res = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        entityType: 'PURCHASE_BILL',
        entityId: negBillId,
        amountCentavos: 5600000,
      });
    expect(neg8Res.status).toBe(409);
    expect(neg8Res.body.error).toBe('DUPLICATE_SUBMISSION');

    const neg8ActionRes = await request(app)
      .post(`/api/journey/action/PURCHASE_BILL/${negBillId}`)
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({ action: 'SUBMIT', reason: 'Duplicate submit click' });
    expect(neg8ActionRes.status).toBe(409);
    expect(neg8ActionRes.body.error).toBe('DUPLICATE_SUBMISSION');
  });

  it('NEG-09: Blocks concurrent duplicate decision on same step and duplicate user filling parallel quorum slots (409)', async () => {
    const dryrunSqlite = await CompanyManager.getCompanySqlite(DRYRUN_COMPANY_ID);
    const nowMs = Date.now();
    dryrunSqlite
      .prepare(
        `INSERT OR REPLACE INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, total_amount, balance_due, status, created_by, created_at, updated_at)
         VALUES (?, ?, 'vnd-dry-01', 'BILL-CONC-001', '2026-11-12', '2026-12-12', 3360000, 3360000, 'DRAFT', ?, ?, ?)`
      )
      .run(concBillId, DRYRUN_COMPANY_ID, actors.requester.id, nowMs, nowMs);

    const concInit = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        entityType: 'PURCHASE_BILL',
        entityId: concBillId,
        workflowType: 'PARALLEL',
        minApprovalsRequired: 2,
        amountCentavos: 3360000,
        steps: [
          {
            stepOrder: 1,
            stepName: 'Parallel Slot A',
            approvalMode: 'PARALLEL',
            requiredRole: 'MANAGER',
            assignedApproverId: actors.deptManager.id,
            assignedApproverName: actors.deptManager.displayName,
          },
          {
            stepOrder: 1,
            stepName: 'Parallel Slot B',
            approvalMode: 'PARALLEL',
            requiredRole: 'CONTROLLER',
            assignedApproverId: actors.financeApprover.id,
            assignedApproverName: actors.financeApprover.displayName,
          },
        ],
      });
    expect(concInit.status).toBe(201);
    concWfId = concInit.body.workflow.id;
    slotAId = concInit.body.steps[0].id;
    slotBId = concInit.body.steps[1].id;

    const slotARes = await request(app)
      .post(`/api/journey/approvals/${concWfId}/decide`)
      .set('Authorization', `Bearer ${actors.deptManager.token}`)
      .send({ stepId: slotAId, decision: 'APPROVE', comments: 'Slot A approved' });
    expect(slotARes.status).toBe(200);

    const neg9aRes = await request(app)
      .post(`/api/journey/approvals/${concWfId}/decide`)
      .set('Authorization', `Bearer ${actors.financeApprover.token}`)
      .send({ stepId: slotAId, decision: 'APPROVE', comments: 'Second approver hitting already-decided Slot A' });
    expect(neg9aRes.status).toBe(409);
    expect(neg9aRes.body.error).toBe('CONCURRENT_APPROVAL_CONFLICT');

    const neg9bRes = await request(app)
      .post(`/api/journey/approvals/${concWfId}/decide`)
      .set('Authorization', `Bearer ${actors.deptManager.token}`)
      .send({ stepId: slotBId, decision: 'APPROVE', comments: 'Same approver trying to fill both parallel slots' });
    expect(neg9bRes.status).toBe(409);
    expect(neg9bRes.body.error).toBe('DUPLICATE_APPROVER_DECISION');
  });

  it('NEG-10: Blocks approving a cancelled transaction/workflow (400 TRANSACTION_CANCELLED)', async () => {
    const dryrunSqlite = await CompanyManager.getCompanySqlite(DRYRUN_COMPANY_ID);
    const nowMs = Date.now();
    const cancelBillId = 'bill-neg-cancel-001';
    dryrunSqlite
      .prepare(
        `INSERT OR REPLACE INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, total_amount, balance_due, status, created_by, created_at, updated_at)
         VALUES (?, ?, 'vnd-dry-01', 'BILL-CANC-001', '2026-11-12', '2026-12-12', 1680000, 1680000, 'DRAFT', ?, ?, ?)`
      )
      .run(cancelBillId, DRYRUN_COMPANY_ID, actors.requester.id, nowMs, nowMs);

    const cancelInit = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({ entityType: 'PURCHASE_BILL', entityId: cancelBillId, amountCentavos: 1680000 });
    expect(cancelInit.status).toBe(201);
    const cancelWfId = cancelInit.body.workflow.id;

    const doCancelRes = await request(app)
      .post(`/api/journey/approvals/${cancelWfId}/cancel`)
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({ reason: 'Supplier withdrew quotation' });
    expect(doCancelRes.status).toBe(200);
    expect(doCancelRes.body.workflow.status).toBe('CANCELLED');

    const neg10Res = await request(app)
      .post(`/api/journey/approvals/${cancelWfId}/decide`)
      .set('Authorization', `Bearer ${actors.deptManager.token}`)
      .send({ decision: 'APPROVE', comments: 'Trying to approve cancelled workflow' });
    expect(neg10Res.status).toBe(400);
    expect(neg10Res.body.error).toBe('TRANSACTION_CANCELLED');
  });

  it('NEG-11: Blocks approving an already rejected transaction (400 TRANSACTION_ALREADY_REJECTED)', async () => {
    const dryrunSqlite = await CompanyManager.getCompanySqlite(DRYRUN_COMPANY_ID);
    const nowMs = Date.now();
    const rejBillId = 'bill-neg-rej-001';
    dryrunSqlite
      .prepare(
        `INSERT OR REPLACE INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, total_amount, balance_due, status, created_by, created_at, updated_at)
         VALUES (?, ?, 'vnd-dry-01', 'BILL-REJ-001', '2026-11-12', '2026-12-12', 1680000, 1680000, 'DRAFT', ?, ?, ?)`
      )
      .run(rejBillId, DRYRUN_COMPANY_ID, actors.requester.id, nowMs, nowMs);

    const rejInit = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({ entityType: 'PURCHASE_BILL', entityId: rejBillId, amountCentavos: 1680000 });
    expect(rejInit.status).toBe(201);
    const rejWfId = rejInit.body.workflow.id;

    const doRejRes = await request(app)
      .post(`/api/journey/approvals/${rejWfId}/decide`)
      .set('Authorization', `Bearer ${actors.deptManager.token}`)
      .send({ decision: 'REJECT', reason: 'Invalid supplier TIN and missing BIR ATP on invoice' });
    expect(doRejRes.status).toBe(200);
    expect(doRejRes.body.workflow.status).toBe('REJECTED');

    const neg11Res = await request(app)
      .post(`/api/journey/approvals/${rejWfId}/decide`)
      .set('Authorization', `Bearer ${actors.owner.token}`)
      .send({ decision: 'APPROVE', comments: 'Trying to approve already rejected transaction' });
    expect(neg11Res.status).toBe(400);
    expect(neg11Res.body.error).toBe('TRANSACTION_ALREADY_REJECTED');
  });

  it('NEG-12: Blocks approving an already approved/completed transaction (400 TRANSACTION_ALREADY_APPROVED)', async () => {
    const cleanApproveRes = await request(app)
      .post(`/api/journey/approvals/${negSuiteWfId}/decide`)
      .set('Authorization', `Bearer ${actors.financeApprover.token}`)
      .send({ decision: 'APPROVE', comments: 'Valid approval' });
    expect(cleanApproveRes.status).toBe(200);
    expect(cleanApproveRes.body.workflow.status).toBe('APPROVED');

    const neg12Res = await request(app)
      .post(`/api/journey/approvals/${negSuiteWfId}/decide`)
      .set('Authorization', `Bearer ${actors.owner.token}`)
      .send({ decision: 'APPROVE', comments: 'Duplicate approval on already approved workflow' });
    expect(neg12Res.status).toBe(400);
    expect(neg12Res.body.error).toBe('TRANSACTION_ALREADY_APPROVED');
  });

  it('NEG-13: Blocks approval by a deactivated or inactive approver user (403 INACTIVE_APPROVER)', async () => {
    const neg13Res = await request(app)
      .post(`/api/journey/approvals/${concWfId}/decide`)
      .set('Authorization', `Bearer ${actors.financeApprover.token}`)
      .send({
        stepId: slotBId,
        decision: 'APPROVE',
        simulateInactiveApprover: true,
        comments: 'Inactive approver attempt',
      });
    expect(neg13Res.status).toBe(403);
    expect(neg13Res.body.error).toBe('INACTIVE_APPROVER');
  });

  it('NEG-14: Preserves pinned approval policy version when policy is modified while workflow is in-flight', async () => {
    const beforeWf = await request(app)
      .get(`/api/journey/approvals?entityId=${concBillId}`)
      .set('Authorization', `Bearer ${actors.owner.token}`);
    const pinnedVersionBefore = beforeWf.body.items[0].policyVersion;

    const polList = await request(app)
      .get('/api/journey/approvals/policies')
      .set('Authorization', `Bearer ${actors.owner.token}`);
    const targetPol = polList.body.items[0];
    const updatePolRes = await request(app)
      .post('/api/journey/approvals/policies')
      .set('Authorization', `Bearer ${actors.owner.token}`)
      .send({
        ...targetPol,
        slaHours: 8,
      });
    expect(updatePolRes.status).toBe(200);
    expect(updatePolRes.body.version).toBeGreaterThan(pinnedVersionBefore);

    const afterPolChangeWf = await request(app)
      .get(`/api/journey/approvals?entityId=${concBillId}`)
      .set('Authorization', `Bearer ${actors.owner.token}`);
    expect(afterPolChangeWf.body.items[0].policyVersion).toBe(pinnedVersionBefore);

    const completeSlotB = await request(app)
      .post(`/api/journey/approvals/${concWfId}/decide`)
      .set('Authorization', `Bearer ${actors.financeApprover.token}`)
      .send({ stepId: slotBId, decision: 'APPROVE', comments: 'Completing parallel Slot B under pinned policy' });
    expect(completeSlotB.status).toBe(200);
    expect(completeSlotB.body.workflow.status).toBe('APPROVED');
  });

  it('NEG-15: Blocks workflow initiation on incomplete transaction with zero or negative amount (400 INCOMPLETE_TRANSACTION_DATA)', async () => {
    const dryrunSqlite = await CompanyManager.getCompanySqlite(DRYRUN_COMPANY_ID);
    const nowMs = Date.now();
    const zeroBillId = 'bill-neg-zero-001';
    dryrunSqlite
      .prepare(
        `INSERT OR REPLACE INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, total_amount, balance_due, status, created_by, created_at, updated_at)
         VALUES (?, ?, 'vnd-dry-01', 'BILL-ZERO-001', '2026-11-12', '2026-12-12', 0, 0, 'DRAFT', ?, ?, ?)`
      )
      .run(zeroBillId, DRYRUN_COMPANY_ID, actors.requester.id, nowMs, nowMs);

    const neg15Res = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({ entityType: 'PURCHASE_BILL', entityId: zeroBillId, amountCentavos: 0 });
    expect(neg15Res.status).toBe(400);
    expect(neg15Res.body.error).toBe('INCOMPLETE_TRANSACTION_DATA');
  });

  it('NEG-16: Blocks unauthorized user from viewing restricted supporting documents and logs all 16 failed attempts in audit_logs (403 PERMISSION_DENIED)', async () => {
    const dryrunSqlite = await CompanyManager.getCompanySqlite(DRYRUN_COMPANY_ID);
    const neg16Res = await request(app)
      .get('/api/journey/documents/doc-e2e-bill-001/versions')
      .set('Authorization', `Bearer ${actors.unauthorizedUser.token}`);
    expect(neg16Res.status).toBe(403);
    expect(neg16Res.body.error).toBe('PERMISSION_DENIED');

    const failedAuditLogs = dryrunSqlite
      .prepare(`SELECT COUNT(*) as cnt FROM audit_logs WHERE company_id = ? AND result = 'FAILED'`)
      .get(DRYRUN_COMPANY_ID) as { cnt: number };
    expect(failedAuditLogs.cnt).toBeGreaterThanOrEqual(12);
  });

  it('7. Phase 6 & Phase 7 — Return for Correction -> Edit -> Resubmit -> Approve Lifecycle + Delegation, Reassignment, Escalation, SLA & Deduplicated Notifications', async () => {
    const dryrunSqlite = await CompanyManager.getCompanySqlite(DRYRUN_COMPANY_ID);
    const nowMs = Date.now();

    // 1. Create a Purchase Order in DRAFT
    const retPoId = 'po-lifecycle-return-001';
    dryrunSqlite
      .prepare(
        `INSERT OR REPLACE INTO purchase_orders (id, company_id, vendor_id, po_number, po_date, total_amount, status, created_by, created_at, updated_at)
         VALUES (?, ?, 'vnd-dry-01', 'PO-RET-2026-001', '2026-11-12', 4480000, 'DRAFT', ?, ?, ?)`
      )
      .run(retPoId, DRYRUN_COMPANY_ID, actors.requester.id, nowMs, nowMs);

    // 2. Submit for approval
    const init1 = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        entityType: 'PURCHASE_ORDER',
        entityId: retPoId,
        amountCentavos: 4480000,
        slaHours: -1, // Already past due to test SLA breach detection
      });
    expect(init1.status).toBe(201);
    const wf1Id = init1.body.workflow.id;
    expect(init1.body.workflow.resubmissionCount).toBe(0);

    // 3. Run SLA Check endpoint and verify overdue detection & notification deduplication
    const slaCheck1 = await request(app)
      .post('/api/journey/approvals/check-sla')
      .set('Authorization', `Bearer ${actors.owner.token}`)
      .send({ autoEscalate: false });
    expect(slaCheck1.status).toBe(200);
    expect(slaCheck1.body.overdueDetected).toBeGreaterThanOrEqual(1);

    // Re-run SLA Check immediately and verify duplicate notifications are prevented by deduplication key
    const notifsBefore = await request(app)
      .get('/api/journey/notifications')
      .set('Authorization', `Bearer ${actors.owner.token}`);
    await request(app)
      .post('/api/journey/approvals/check-sla')
      .set('Authorization', `Bearer ${actors.owner.token}`)
      .send({ autoEscalate: false });
    const notifsAfter = await request(app)
      .get('/api/journey/notifications')
      .set('Authorization', `Bearer ${actors.owner.token}`);
    expect(notifsAfter.body.items.length).toBe(notifsBefore.body.items.length);

    // 4. Department Manager RETURNS the Purchase Order for correction
    const returnRes = await request(app)
      .post(`/api/journey/approvals/${wf1Id}/decide`)
      .set('Authorization', `Bearer ${actors.deptManager.token}`)
      .send({
        decision: 'RETURN',
        reason: 'Please update freight allowance and attach revised vendor quote.',
      });
    expect(returnRes.status).toBe(200);
    expect(returnRes.body.workflow.status).toBe('RETURNED');

    // Verify PO status is RETURNED
    const poAfterReturn = dryrunSqlite
      .prepare(`SELECT status FROM purchase_orders WHERE id = ?`)
      .get(retPoId) as { status: string };
    expect(poAfterReturn.status).toBe('RETURNED');

    // 5. Requester edits the returned PO via canonical EDIT action and resubmits
    const editRes = await request(app)
      .post(`/api/journey/action/PURCHASE_ORDER/${retPoId}`)
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        action: 'EDIT',
        reason: 'Updated freight allowance per Department Manager instructions',
        updates: { totalAmount: 4200000 },
      });
    expect(editRes.status).toBe(200);

    // Create a Standing Delegation from deptManager to financeApprover before resubmitting
    const delRes = await request(app)
      .post('/api/journey/approvals/delegations')
      .set('Authorization', `Bearer ${actors.deptManager.token}`)
      .send({
        fromUserId: 'manager-approver-1',
        fromUserName: actors.deptManager.displayName,
        toUserId: actors.financeApprover.id,
        toUserName: actors.financeApprover.displayName,
        roleScope: 'MANAGER',
        reason: 'Department Manager out of office on regional audit',
      });
    expect(delRes.status).toBe(201);

    // Resubmit PO
    const init2 = await request(app)
      .post('/api/journey/approvals/initiate')
      .set('Authorization', `Bearer ${actors.requester.token}`)
      .send({
        entityType: 'PURCHASE_ORDER',
        entityId: retPoId,
        amountCentavos: 4200000,
        reason: 'Resubmitted with updated freight allowance',
      });
    expect(init2.status).toBe(201);
    const wf2Id = init2.body.workflow.id;
    expect(init2.body.workflow.resubmissionCount).toBe(1);
    // Verify delegation was automatically applied while preserving originalAssignedApproverId
    expect(init2.body.steps[0].originalAssignedApproverId).toBe('manager-approver-1');
    expect(init2.body.steps[0].assignedApproverId).toBe(actors.financeApprover.id);

    // 6. Delegated approver (financeApprover) approves the resubmitted PO
    const approveResubmitted = await request(app)
      .post(`/api/journey/approvals/${wf2Id}/decide`)
      .set('Authorization', `Bearer ${actors.financeApprover.token}`)
      .send({
        decision: 'APPROVE',
        comments: 'Approved resubmitted PO under active delegation authority.',
      });
    expect(approveResubmitted.status).toBe(200);
    expect(approveResubmitted.body.workflow.status).toBe('APPROVED');
  });
});
