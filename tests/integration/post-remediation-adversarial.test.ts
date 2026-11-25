import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import request from 'supertest';

const { tempRoot } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('node:path');
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'ledgerai-adv-verify-'));
  process.env.LEDGERAI_CONFIG_DIR = nodePath.join(root, 'config');
  process.env.LEDGERAI_DATA_DIR = nodePath.join(root, 'data');
  return { tempRoot: root };
});

import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { RbacService } from '../../src/server/services/rbacService';
import { hashToken } from '../../src/server/auth';
import { dbContext } from '../../src/server/db/context';
import { AccountingEngine } from '../../src/server/services/accountingEngine';
import { RestoreService } from '../../src/server/services/restoreService';
import { AuditService } from '../../src/server/services/auditService';
import { DocumentEncryptionService } from '../../src/server/services/documentEncryptionService';
import { CompanyStorageService } from '../../src/server/services/storageService';
import { BankReconciliationService } from '../../src/server/services/bankReconciliationService';
import { BirComplianceService } from '../../src/server/services/birComplianceService';
import { WithholdingReconciliationService } from '../../src/server/services/withholdingReconciliationService';
import { ReportEngine } from '../../src/server/services/reportEngine';
import { PayrollRemediationService } from '../../src/server/services/payrollRemediationService';
import {
  createSalesInvoice,
  submitSalesInvoice,
  approveSalesInvoice,
  postSalesInvoice,
  createCreditMemo,
  postCreditMemo,
  createPurchaseBill,
  submitPurchaseBill,
  approvePurchaseBill,
  postPurchaseBill,
  createDebitMemo,
  submitDebitMemo,
  approveDebitMemo,
  postDebitMemo,
  createCustomerPayment,
  submitCustomerPayment,
  approveCustomerPayment,
  postCustomerPayment,
  createSupplierPayment,
  submitSupplierPayment,
  approveSupplierPayment,
  postSupplierPayment,
} from '../../src/server/db/business_transactions';
import { reverseJournalEntry } from '../../src/server/db/domain';
import * as schema from '../../src/server/db/schema';
import { eq, and } from 'drizzle-orm';

const COMP_A = 'LGR-PH-ADV-ALPHA';
const COMP_B = 'LGR-PH-ADV-BETA';

describe('LEDGERAI PH — POST-REMEDIATION ADVERSARIAL VERIFICATION SUITE', () => {
  const app = createApp();

  const ownerAId = 'usr-adv-owner-a';
  const ownerA2Id = 'usr-adv-owner-a2';
  const ownerA3Id = 'usr-adv-owner-a3';
  const adminAId = 'usr-adv-admin-a';
  const bookkeeperAId = 'usr-adv-bk-a';
  const auditorAssignedId = 'usr-adv-aud-1';
  const auditorUnassignedId = 'usr-adv-aud-2';
  const readonlyUnassignedId = 'usr-adv-ro-1';
  const pwChangeUserId = 'usr-adv-pwchg';
  const ownerBId = 'usr-adv-owner-b';

  let ownerAToken = '';
  let ownerA2Token = '';
  let ownerA3Token = '';
  let adminAToken = '';
  let bookkeeperAToken = '';
  let auditorAssignedToken = '';
  let auditorUnassignedToken = '';
  let readonlyUnassignedToken = '';
  let pwChangeToken = '';
  let ownerBToken = '';

  async function seedCompany(
    companyId: string,
    legalName: string,
    users: Array<{
      id: string;
      email: string;
      displayName: string;
      roleName: string;
      roleNames?: string[];
      approvalLimit?: number;
      requirePasswordChange?: boolean;
    }>
  ): Promise<Record<string, string>> {
    await CompanyManager.createCompanyProfile(companyId, legalName, undefined, undefined, false, {
      classification: 'TEST',
    });
    const sqlite = await CompanyManager.getCompanySqlite(companyId);
    const companyDb = await CompanyManager.getCompanyDb(companyId);
    const now = Date.now();
    const tokens: Record<string, string> = {};

    sqlite.exec(`
      INSERT OR REPLACE INTO companies (id, legal_name, tin, vat_status, taxpayer_classification, currency, status, classification)
      VALUES ('${companyId}', '${legalName}', '123-456-789-000', 'VAT', 'CORPORATION', 'PHP', 'ACTIVE', 'TEST');
    `);

    await dbContext.run(companyDb as any, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      await AccountingEngine.ensureDefaultAccounts(companyId);

      sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounting_periods (id, company_id, name, start_date, end_date, fiscal_year, status, created_at, updated_at)
           VALUES (?, ?, 'FY 2026', '2026-01-01', '2026-12-31', 2026, 'OPEN', ?, ?)`
        )
        .run(`per-${companyId}-2026`, companyId, now, now);

      for (const u of users) {
        sqlite
          .prepare(
            `INSERT OR REPLACE INTO users (id, email, password_hash, display_name, status, is_demo, require_password_change, created_at, updated_at)
             VALUES (?, ?, 'hash', ?, 'ACTIVE', 1, ?, ?, ?)`
          )
          .run(u.id, u.email, u.displayName, u.requirePasswordChange ? 1 : 0, now, now);

        const cuId = `cu-${companyId}-${u.id}`;
        sqlite
          .prepare(
            `INSERT OR REPLACE INTO company_users (id, user_id, company_id, legacy_role, status, membership_status, default_data_scope, approval_limit_centavos, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'ACTIVE', 'ACTIVE', 'COMPANY_WIDE', ?, ?, ?)`
          )
          .run(cuId, u.id, companyId, u.roleName, u.approvalLimit ?? 0, now, now);

        await RbacService.setMemberRoles(null, cuId, (u.roleNames || [u.roleName]) as any, 'Adversarial test setup');
        if (u.approvalLimit != null) {
          sqlite.prepare(`UPDATE company_users SET approval_limit_centavos = ? WHERE id = ?`).run(u.approvalLimit, cuId);
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        sqlite
          .prepare(`INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`)
          .run(hashToken(rawToken), u.id, now + 86400_000, now);
        tokens[u.id] = `${companyId}.${rawToken}`;
      }
    });

    return tokens;
  }

  beforeAll(async () => {
    const tokensA = await seedCompany(COMP_A, 'Adversarial Alpha Corp.', [
      { id: ownerAId, email: 'owner@adv-a.ph', displayName: 'Owner Alpha', roleName: 'Company Owner', approvalLimit: 50_000_000_00 },
      { id: ownerA2Id, email: 'owner2@adv-a.ph', displayName: 'Co-Owner Alpha 2', roleName: 'Company Owner', approvalLimit: 50_000_000_00 },
      { id: ownerA3Id, email: 'owner3@adv-a.ph', displayName: 'Co-Owner Alpha 3', roleName: 'Company Owner', approvalLimit: 50_000_000_00 },
      { id: adminAId, email: 'admin@adv-a.ph', displayName: 'Admin Approver Alpha', roleName: 'Company Administrator', roleNames: ['Company Administrator', 'Approver'], approvalLimit: 50_000_00 },
      { id: bookkeeperAId, email: 'bk@adv-a.ph', displayName: 'Bookkeeper Alpha', roleName: 'Bookkeeper', approvalLimit: 0 },
      { id: auditorAssignedId, email: 'aud1@adv-a.ph', displayName: 'Auditor Assigned', roleName: 'Auditor', approvalLimit: 0 },
      { id: auditorUnassignedId, email: 'aud2@adv-a.ph', displayName: 'Auditor Unassigned', roleName: 'Auditor', approvalLimit: 0 },
      { id: readonlyUnassignedId, email: 'ro@adv-a.ph', displayName: 'ReadOnly Unassigned', roleName: 'Read-only User', approvalLimit: 0 },
      { id: pwChangeUserId, email: 'pw@adv-a.ph', displayName: 'Force PW Change', roleName: 'Company Owner', approvalLimit: 50_000_000_00, requirePasswordChange: true },
    ]);

    const tokensB = await seedCompany(COMP_B, 'Adversarial Beta Corp.', [
      { id: ownerBId, email: 'owner@adv-b.ph', displayName: 'Owner Beta', roleName: 'Company Owner', approvalLimit: 50_000_000_00 },
    ]);

    ownerAToken = tokensA[ownerAId];
    ownerA2Token = tokensA[ownerA2Id];
    ownerA3Token = tokensA[ownerA3Id];
    adminAToken = tokensA[adminAId];
    bookkeeperAToken = tokensA[bookkeeperAId];
    auditorAssignedToken = tokensA[auditorAssignedId];
    auditorUnassignedToken = tokensA[auditorUnassignedId];
    readonlyUnassignedToken = tokensA[readonlyUnassignedId];
    pwChangeToken = tokensA[pwChangeUserId];
    ownerBToken = tokensB[ownerBId];
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // =========================================================================
  // CLUSTER 1: PATH TRAVERSAL, IDOR & WORKPAPER SOD / STATE MACHINE
  // =========================================================================
  describe('Cluster 1 — Path Normalization, Engagement IDOR & Workpaper SoD', () => {
    it('blocks path traversal /api/companies/../users on nonexistent company token and /api/auth/session/../../accounting/journals under forced password change', async () => {
      const ghostToken = `NONEXISTENT-COMPANY-XYZ.${crypto.randomBytes(16).toString('hex')}`;
      const res1 = await request(app)
        .get('/api/companies/../users')
        .set('Authorization', `Bearer ${ghostToken}`);
      expect(res1.status).toBe(401);

      const res2 = await request(app)
        .get('/api/auth/session/../../accounting/journals')
        .set('Authorization', `Bearer ${pwChangeToken}`);
      expect(res2.status).toBe(403);
      expect(res2.body.error).toBe('PASSWORD_CHANGE_REQUIRED');

      const res3 = await request(app)
        .get('/api/companies/%2e%2e/users')
        .set('Authorization', `Bearer ${ghostToken}`);
      expect(res3.status).toBe(401);
    });

    it('blocks unassigned Auditor and Read-only User IDOR access to /api/audit-engagements/:id and /items', async () => {
      const createRes = await request(app)
        .post('/api/audit-engagements')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          engagementName: 'Restricted Statutory Audit 2026',
          clientCompanyId: COMP_A,
          auditPeriod: '2026',
          engagementType: 'EXTERNAL_AUDIT',
          preparerId: auditorAssignedId,
          teamMembers: [auditorAssignedId],
        });
      expect(createRes.status).toBe(201);
      const engId = createRes.body.id;

      // Assigned auditor succeeds
      const assignedGet = await request(app)
        .get(`/api/audit-engagements/${engId}`)
        .set('Authorization', `Bearer ${auditorAssignedToken}`);
      expect(assignedGet.status).toBe(200);

      // Unassigned auditor MUST be denied
      const unassignedGet = await request(app)
        .get(`/api/audit-engagements/${engId}`)
        .set('Authorization', `Bearer ${auditorUnassignedToken}`);
      expect(unassignedGet.status).toBe(403);

      // Unassigned readonly user MUST be denied
      const readonlyGet = await request(app)
        .get(`/api/audit-engagements/${engId}`)
        .set('Authorization', `Bearer ${readonlyUnassignedToken}`);
      expect(readonlyGet.status).toBe(403);
    });

    it('enforces real DB-backed workpaper SoD (preparerId/reviewerId) and sequential DRAFT->PREPARED->REVIEWED->APPROVED progression', async () => {
      const createWp = await request(app)
        .post('/api/audit/workpapers')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          title: 'Cash Lead Schedule WP-A1',
          referenceCode: 'WP-A1',
          category: 'Lead Schedule',
        });
      expect(createWp.status).toBe(200);
      const wpId = createWp.body.id;

      // Cannot skip DRAFT -> APPROVED
      const skipApprove = await request(app)
        .post(`/api/audit/workpapers/${wpId}/signoff`)
        .set('Authorization', `Bearer ${ownerA2Token}`)
        .send({ signOffStatus: 'APPROVED' });
      expect(skipApprove.status).toBe(400);

      // Owner prepares DRAFT -> PREPARED
      const markPrepared = await request(app)
        .post(`/api/audit/workpapers/${wpId}/signoff`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ signOffStatus: 'PREPARED' });
      expect(markPrepared.status).toBe(200);

      // Preparer cannot self-review PREPARED -> REVIEWED
      const selfReview = await request(app)
        .post(`/api/audit/workpapers/${wpId}/signoff`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ signOffStatus: 'REVIEWED' });
      expect(selfReview.status).toBe(403);
      expect(selfReview.body.error).toBe('SOD_VIOLATION');

      // Cannot skip PREPARED -> APPROVED without REVIEWED
      const skipFromPrepared = await request(app)
        .post(`/api/audit/workpapers/${wpId}/signoff`)
        .set('Authorization', `Bearer ${ownerA2Token}`)
        .send({ signOffStatus: 'APPROVED' });
      expect(skipFromPrepared.status).toBe(400);

      // Distinct authorized reviewer reviews PREPARED -> REVIEWED
      const markReviewed = await request(app)
        .post(`/api/audit/workpapers/${wpId}/signoff`)
        .set('Authorization', `Bearer ${ownerA2Token}`)
        .send({ signOffStatus: 'REVIEWED' });
      expect(markReviewed.status).toBe(200);

      // Reviewer cannot self-approve
      const reviewerSelfApprove = await request(app)
        .post(`/api/audit/workpapers/${wpId}/signoff`)
        .set('Authorization', `Bearer ${ownerA2Token}`)
        .send({ signOffStatus: 'APPROVED' });
      expect(reviewerSelfApprove.status).toBe(403);
      expect(reviewerSelfApprove.body.error).toBe('SOD_VIOLATION');

      // Preparer also cannot approve even after someone else reviewed
      const preparerApprove = await request(app)
        .post(`/api/audit/workpapers/${wpId}/signoff`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ signOffStatus: 'APPROVED' });
      expect(preparerApprove.status).toBe(403);
      expect(preparerApprove.body.error).toBe('SOD_VIOLATION');

      // Independent third approver completes REVIEWED -> APPROVED
      const finalApprove = await request(app)
        .post(`/api/audit/workpapers/${wpId}/signoff`)
        .set('Authorization', `Bearer ${ownerA3Token}`)
        .send({ signOffStatus: 'APPROVED' });
      expect(finalApprove.status).toBe(200);
      expect(finalApprove.body.status).toBe('APPROVED');
    });
  });

  // =========================================================================
  // CLUSTER 2: CONCURRENCY, PR/PO OVERWRITE & APPROVE-ALL-STEPS LIMIT
  // =========================================================================
  describe('Cluster 2 — Approval Concurrency, PR Overwrite & approveAllSteps Limit', () => {
    async function seedTwoStepWorkflow(amountCentavos: number) {
      const companyDb = await CompanyManager.getCompanyDb(COMP_A);
      const sqlite = await CompanyManager.getCompanySqlite(COMP_A);
      const invId = `inv-adv-${crypto.randomUUID().slice(0, 8)}`;
      const wfId = `wf-adv-${crypto.randomUUID().slice(0, 8)}`;
      const now = Date.now();
      await dbContext.run(companyDb as any, async () => {
        sqlite.prepare(`INSERT OR IGNORE INTO customers (id, company_id, code, legal_name, status) VALUES ('cust-adv-1', ?, 'CADV1', 'Adv Customer', 'ACTIVE')`).run(COMP_A);
        sqlite.prepare(
          `INSERT INTO sales_invoices (id, company_id, customer_id, invoice_number, invoice_date, due_date, total_amount, balance_due, status, created_by, created_at, updated_at)
           VALUES (?, ?, 'cust-adv-1', ?, '2026-08-10', '2026-09-10', ?, ?, 'SUBMITTED', ?, ?, ?)`
        ).run(invId, COMP_A, `SI-${wfId}`, amountCentavos, amountCentavos, bookkeeperAId, now, now);

        await companyDb.insert(schema.approvalWorkflows).values({
          id: wfId,
          companyId: COMP_A,
          entityType: 'SALES_INVOICE',
          entityId: invId,
          recordReference: `SI-${wfId}`,
          workflowType: 'SEQUENTIAL',
          status: 'IN_PROGRESS',
          currentStepOrder: 1,
          totalSteps: 2,
          amountCentavos,
          submittedBy: bookkeeperAId,
          submittedByName: 'Bookkeeper Alpha',
          submittedAt: new Date(now),
          slaStatus: 'ON_TRACK',
          escalationCount: 0,
          resubmissionCount: 0,
        });
        await companyDb.insert(schema.approvalSteps).values([
          {
            id: `st1-${wfId}`,
            workflowId: wfId,
            companyId: COMP_A,
            entityType: 'SALES_INVOICE',
            entityId: invId,
            stepOrder: 1,
            stepName: 'Step 1',
            requiredRole: 'Company Administrator',
            assignedApproverId: adminAId,
            assignedApproverName: 'Admin Approver Alpha',
            status: 'PENDING',
          },
          {
            id: `st2-${wfId}`,
            workflowId: wfId,
            companyId: COMP_A,
            entityType: 'SALES_INVOICE',
            entityId: invId,
            stepOrder: 2,
            stepName: 'Step 2',
            requiredRole: 'Company Owner',
            assignedApproverId: ownerAId,
            assignedApproverName: 'Owner Alpha',
            status: 'WAITING',
          },
        ]);
      });
      return { wfId, invId };
    }

    it('enforces approvalLimitCentavos when approveAllSteps=true attempts to skip higher step', async () => {
      // adminA has 50_000_00 centavos limit; amount is 200_000_00 centavos
      const { wfId } = await seedTwoStepWorkflow(200_000_00);
      const res = await request(app)
        .post(`/api/journey/approvals/${wfId}/decide`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ decision: 'APPROVED', approveAllSteps: true, remarks: 'Attempt skip-to-final over limit' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('APPROVAL_LIMIT_EXCEEDED');
    });

    it('serializes concurrent /decide calls so only 1 succeeds and duplicate receives 409', async () => {
      const { wfId } = await seedTwoStepWorkflow(10_000_00);
      const step1Id = `st1-${wfId}`;
      const [r1, r2] = await Promise.all([
        request(app)
          .post(`/api/journey/approvals/${wfId}/decide`)
          .set('Authorization', `Bearer ${adminAToken}`)
          .send({ stepId: step1Id, decision: 'APPROVED', remarks: 'Race 1' }),
        request(app)
          .post(`/api/journey/approvals/${wfId}/decide`)
          .set('Authorization', `Bearer ${adminAToken}`)
          .send({ stepId: step1Id, decision: 'APPROVED', remarks: 'Race 2' }),
      ]);
      const statuses = [r1.status, r2.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);
    });

    it('rejects POST /requisitions ID overwrite attempt with 409 instead of resetting APPROVED PR to DRAFT', async () => {
      const companyDb = await CompanyManager.getCompanyDb(COMP_A);
      const existingPrId = `pr-fixed-${crypto.randomUUID().slice(0, 6)}`;
      await dbContext.run(companyDb as any, async () => {
        await companyDb.insert(schema.purchaseRequisitions).values({
          id: existingPrId,
          companyId: COMP_A,
          prNumber: 'PR-LOCKED-01',
          requestDate: '2026-08-01',
          purpose: 'Approved equipment',
          itemsJson: JSON.stringify([{ description: 'Server', quantity: 1, unitPrice: 100000 }]),
          totalAmount: 100000,
          status: 'APPROVED',
          requestedBy: bookkeeperAId,
          version: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      const overwriteAttempt = await request(app)
        .post('/api/journey/requisitions')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          id: existingPrId,
          prNumber: 'PR-HIJACKED-01',
          purpose: 'Reset to DRAFT overwrite attempt',
          items: [{ description: 'Hack', quantity: 1, unitPrice: 50000 }],
          totalAmount: 50000,
        });
      expect(overwriteAttempt.status).toBe(409);

      // Verify DB status remained APPROVED
      await dbContext.run(companyDb as any, async () => {
        const pr = await companyDb.select().from(schema.purchaseRequisitions).where(eq(schema.purchaseRequisitions.id, existingPrId)).get();
        expect(pr?.status).toBe('APPROVED');
      });
    });
  });

  // =========================================================================
  // CLUSTER 3: LEGACY PLAINTEXT DOCUMENT DOWNLOAD / MIGRATE & BACKUP/RESTORE
  // =========================================================================
  describe('Cluster 3 — Legacy Document Encryption Fix & Full Backup/Restore Round-Trip', () => {
    it('serves plaintext legacy documents via GET /:id/file and /:id/download without 500 and migrates them via /diagnostics/migrate-legacy', async () => {
      const companyDb = await CompanyManager.getCompanyDb(COMP_A);
      const docId = `doc-legacy-${crypto.randomUUID().slice(0, 8)}`;
      const plainBytes = Buffer.from('%PDF-1.4\nLegacy Receipt Content 12345', 'utf8');
      const docsDir = await CompanyStorageService.getDocumentsPath(COMP_A);
      fs.mkdirSync(docsDir, { recursive: true });
      const legacyFilePath = path.join(docsDir, `${docId}.pdf`);
      fs.writeFileSync(legacyFilePath, plainBytes);

      await dbContext.run(companyDb as any, async () => {
        await companyDb.insert(schema.documents).values({
          id: docId,
          companyId: COMP_A,
          entityType: 'GENERAL',
          entityId: 'NONE',
          documentType: 'RECEIPT',
          fileName: `${docId}.pdf`,
          originalFileName: 'legacy.pdf',
          fileType: 'application/pdf',
          fileSize: plainBytes.length,
          fileHash: crypto.createHash('sha256').update(plainBytes).digest('hex'),
          filePath: legacyFilePath,
          encryptionStatus: 'UNENCRYPTED_LEGACY',
          storageTier: 'ORIGINALS',
          source: 'LEGACY',
          uploadedBy: ownerAId,
          status: 'ACTIVE',
          ocrStatus: 'PENDING',
          verificationStatus: 'UNVERIFIED',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      const viewRes = await request(app)
        .get(`/api/documents/${docId}/file`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(viewRes.status).toBe(200);
      expect(Buffer.from(viewRes.body).toString('utf8')).toContain('Legacy Receipt Content 12345');

      const dlRes = await request(app)
        .get(`/api/documents/${docId}/download`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(dlRes.status).toBe(200);

      // Migrate legacy plaintext file to AES-256-GCM
      const migRes = await request(app)
        .post('/api/documents/diagnostics/migrate-legacy')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({});
      expect(migRes.status).toBe(200);
      expect(migRes.body.migrated).toContain(docId);

      // Verify now encrypted on disk and still decrypts cleanly via GET /:id/file
      let migratedPath = '';
      await dbContext.run(companyDb as any, async () => {
        const docRow = await companyDb.select().from(schema.documents).where(eq(schema.documents.id, docId)).get();
        expect(docRow?.encryptionStatus).toBe('ENCRYPTED_AES256_GCM');
        migratedPath = docRow!.filePath;
      });
      const onDisk = fs.readFileSync(migratedPath);
      expect(await DocumentEncryptionService.isEncryptedContainer(onDisk)).toBe(true);

      const postMigView = await request(app)
        .get(`/api/documents/${docId}/file`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(postMigView.status).toBe(200);
      expect(Buffer.from(postMigView.body).toString('utf8')).toContain('Legacy Receipt Content 12345');

      // Cross-company access denied
      const crossView = await request(app)
        .get(`/api/documents/${docId}/file`)
        .set('Authorization', `Bearer ${ownerBToken}`);
      expect([403, 404]).toContain(crossView.status);
    });

    it('preserves approvalWorkflows, approvalSteps, bankAccounts, bankTransactions and valid audit chain across exportBackup -> restoreDatabase (NEW & REPLACE)', async () => {
      const companyDb = await CompanyManager.getCompanyDb(COMP_A);
      const bankId = `ba-bak-${crypto.randomUUID().slice(0, 6)}`;
      const stmtId = `bs-bak-${crypto.randomUUID().slice(0, 6)}`;
      const btxId = `bt-bak-${crypto.randomUUID().slice(0, 6)}`;

      await dbContext.run(companyDb as any, async () => {
        await companyDb.insert(schema.bankAccounts).values({
          id: bankId,
          companyId: COMP_A,
          accountName: 'Restore Test Bank',
          bankName: 'BPI',
          accountNumberEncrypted: 'hash-123',
          currency: 'PHP',
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await companyDb.insert(schema.bankStatements).values({
          id: stmtId,
          companyId: COMP_A,
          bankAccountId: bankId,
          statementDate: new Date('2026-08-31T00:00:00Z'),
          filename: 'bak.csv',
          status: 'IMPORTED',
          createdAt: new Date(),
        });
        await companyDb.insert(schema.bankTransactions).values({
          id: btxId,
          companyId: COMP_A,
          bankStatementId: stmtId,
          bankAccountId: bankId,
          transactionDate: new Date('2026-08-20T00:00:00Z'),
          description: 'Deposit Test',
          amount: 500,
          type: 'CREDIT',
          matchedStatus: 'UNMATCHED',
          createdAt: new Date(),
        });
      });

      const backup = await RestoreService.exportBackup(COMP_A);
      expect(backup.data.approvalWorkflows?.length || 0).toBeGreaterThan(0);
      expect(backup.data.approvalSteps?.length || 0).toBeGreaterThan(0);
      expect(backup.data.bankAccounts?.length || 0).toBeGreaterThan(0);
      expect(backup.data.bankTransactions?.length || 0).toBeGreaterThan(0);

      // Restore as NEW company
      const clonedCompanyId = await RestoreService.restoreDatabase(backup, `${COMP_A}-CLONE`, 'NEW', ownerAId);
      const clonedDb = await CompanyManager.getCompanyDb(clonedCompanyId);
      await dbContext.run(clonedDb as any, async () => {
        const wfCount = (await clonedDb.select().from(schema.approvalWorkflows)).length;
        const btCount = (await clonedDb.select().from(schema.bankTransactions)).length;
        expect(wfCount).toBeGreaterThan(0);
        expect(btCount).toBeGreaterThan(0);

        const integrity = await AuditService.verifyAuditChain(clonedCompanyId);
        expect(integrity.verified).toBe(true);
      });

      // Restore REPLACE back onto COMP_A
      await RestoreService.restoreDatabase(backup, COMP_A, 'REPLACE', ownerAId);
      const replacedDb = await CompanyManager.getCompanyDb(COMP_A);
      await dbContext.run(replacedDb as any, async () => {
        const integrityReplace = await AuditService.verifyAuditChain(COMP_A);
        expect(integrityReplace.verified).toBe(true);
      });
    });
  });

  // =========================================================================
  // CLUSTER 4: CM/DM VAT REVERSAL, FIXED ASSET BOUNDS/RACE, BANK RECON SIGN/TIES/RACE
  // =========================================================================
  describe('Cluster 4 — CM/DM Tax Reversal, Fixed Asset Validation/Concurrency & Bank Recon Hardening', () => {
    it('reverses Output VAT and records negative taxCalculations when Credit Memo uses VAT_12, and blocks cross-customer applications', async () => {
      const companyDb = await CompanyManager.getCompanyDb(COMP_A);
      const sqlite = await CompanyManager.getCompanySqlite(COMP_A);

      await dbContext.run(companyDb as any, async () => {
        sqlite.prepare(`INSERT OR IGNORE INTO customers (id, company_id, code, legal_name, vat_status, status) VALUES ('cust-cm-1', ?, 'CCM1', 'CM Customer', 'VAT', 'ACTIVE')`).run(COMP_A);
        sqlite.prepare(`INSERT OR IGNORE INTO customers (id, company_id, code, legal_name, vat_status, status) VALUES ('cust-cm-2', ?, 'CCM2', 'Other Customer', 'VAT', 'ACTIVE')`).run(COMP_A);

        const ruleDefId = `trd-${COMP_A}-vat12`;
        const ruleVerId = `trv-${COMP_A}-vat12-v1`;
        const tcId = `tc-${COMP_A}-vat12`;
        await companyDb.insert(schema.taxRuleDefinitions).values({
          id: ruleDefId,
          ruleCode: 'VAT_12_OUTPUT',
          ruleName: 'Output VAT 12%',
          taxType: 'VAT',
          status: 'ACTIVE',
        }).onConflictDoNothing();
        await companyDb.insert(schema.taxRuleVersions).values({
          id: ruleVerId,
          ruleDefinitionId: ruleDefId,
          version: 1,
          effectiveFrom: '2026-01-01',
          calculationMethod: 'PERCENTAGE',
          rateValue: 0.12,
          status: 'ACTIVE',
        }).onConflictDoNothing();

        const accts = await companyDb.select().from(schema.accounts);
        const revAcc = accts.find(a => a.accountCode === '4010' || a.accountCode === '4000')!;
        const vatOutAcc = accts.find(a => a.accountCode === '2020' || a.accountCode === '2200')!;
        const expAcc = accts.find(a => a.accountCode === '5010' || a.accountType === 'EXPENSE')!;
        const vatInAcc = accts.find(a => a.accountCode === '1040' || a.accountName.toLowerCase().includes('input vat')) || vatOutAcc;

        await companyDb.insert(schema.taxCodes).values({
          id: tcId,
          companyId: COMP_A,
          code: 'VAT_12',
          name: 'Output VAT 12%',
          taxType: 'VAT',
          inputOutputDirection: 'OUTPUT',
          accountId: vatOutAcc.id,
          ruleDefinitionId: ruleDefId,
          status: 'ACTIVE',
        }).onConflictDoNothing();

        const invId = await createSalesInvoice(COMP_A, {
          customerId: 'cust-cm-1',
          invoiceNumber: 'SI-CM-TEST-01',
          invoiceDate: '2026-08-15',
          dueDate: '2026-09-15',
          totalAmount: 112000,
          lines: [{ accountId: revAcc.id, description: 'VATable Sale', quantity: 1, unitPrice: 112000, amount: 112000, taxCodeId: tcId }],
        }, bookkeeperAId);
        await submitSalesInvoice(COMP_A, invId, bookkeeperAId);
        await approveSalesInvoice(COMP_A, invId, ownerAId);
        await postSalesInvoice(COMP_A, invId, `per-${COMP_A}-2026`, [], ownerAId, 'Company Owner');

        // Cross-customer CM application must fail
        await expect(
          createCreditMemo(COMP_A, {
            customerId: 'cust-cm-2',
            creditMemoNumber: 'CM-CROSS-01',
            memoDate: '2026-08-20',
            totalAmount: 11200,
            lines: [{ accountId: revAcc.id, taxCodeId: tcId, amount: 11200, unitPrice: 11200 }],
            applications: [{ invoiceId: invId, appliedAmount: 11200 }],
          }, bookkeeperAId)
        ).rejects.toThrow();

        // Legitimate VAT Credit Memo reverses Output VAT (12/112 = 12,000) + Net Revenue (100,000)
        const cmId = await createCreditMemo(COMP_A, {
          customerId: 'cust-cm-1',
          creditMemoNumber: 'CM-VAT-01',
          memoDate: '2026-08-20',
          totalAmount: 112000,
          lines: [{ accountId: revAcc.id, taxCodeId: tcId, amount: 112000, unitPrice: 112000, description: 'Full return' }],
          applications: [{ invoiceId: invId, appliedAmount: 112000 }],
        }, bookkeeperAId);
        await postCreditMemo(COMP_A, cmId, `per-${COMP_A}-2026`, ownerAId, undefined, 'Company Owner');

        const cmRow = await companyDb.select().from(schema.creditMemos).where(eq(schema.creditMemos.id, cmId)).get();
        const jeLines = await companyDb.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, cmRow!.journalEntryId!));
        const vatDebitLine = jeLines.find(l => l.accountId === vatOutAcc.id);
        const revDebitLine = jeLines.find(l => l.accountId === revAcc.id);
        expect(vatDebitLine?.debit).toBe(12000);
        expect(revDebitLine?.debit).toBe(100000);

        const cmTaxCalcs = await companyDb.select().from(schema.taxCalculations).where(eq(schema.taxCalculations.journalEntryId, cmRow!.journalEntryId!));
        expect(cmTaxCalcs.length).toBe(1);
        expect(cmTaxCalcs[0].taxAmount).toBe(-12000);

        // Also verify Debit Memo Input VAT reversal
        sqlite.prepare(`INSERT OR IGNORE INTO vendors (id, company_id, code, legal_name, tin, vat_status, status) VALUES ('vend-dm-1', ?, 'VDM1', 'DM Vendor', '999-888-777-000', 'VAT', 'ACTIVE')`).run(COMP_A);
        const dmRuleDefId = `trd-${COMP_A}-vat12-in`;
        const dmRuleVerId = `trv-${COMP_A}-vat12-in-v1`;
        const dmTcId = `tc-${COMP_A}-vat12-in`;
        await companyDb.insert(schema.taxRuleDefinitions).values({
          id: dmRuleDefId, ruleCode: 'VAT_12_INPUT', ruleName: 'Input VAT 12%', taxType: 'VAT', status: 'ACTIVE',
        }).onConflictDoNothing();
        await companyDb.insert(schema.taxRuleVersions).values({
          id: dmRuleVerId, ruleDefinitionId: dmRuleDefId, version: 1, effectiveFrom: '2026-01-01', calculationMethod: 'PERCENTAGE', rateValue: 0.12, status: 'ACTIVE',
        }).onConflictDoNothing();
        await companyDb.insert(schema.taxCodes).values({
          id: dmTcId, companyId: COMP_A, code: 'VAT_12_IN', name: 'Input VAT 12%', taxType: 'VAT', inputOutputDirection: 'INPUT', accountId: vatInAcc.id, ruleDefinitionId: dmRuleDefId, status: 'ACTIVE',
        }).onConflictDoNothing();

        const dmId = await createDebitMemo(COMP_A, {
          vendorId: 'vend-dm-1',
          debitMemoNumber: 'DM-VAT-01',
          memoDate: '2026-08-21',
          reason: 'Supplier return',
          totalAmount: 56000,
          lines: [{ accountId: expAcc.id, taxCodeId: dmTcId, amount: 56000, unitPrice: 56000, description: 'Return goods' }],
        }, bookkeeperAId);
        await submitDebitMemo(COMP_A, dmId, bookkeeperAId);
        await approveDebitMemo(COMP_A, dmId, ownerAId);
        await postDebitMemo(COMP_A, dmId, `per-${COMP_A}-2026`, ownerAId, undefined, 'Company Owner');

        const dmRow = await companyDb.select().from(schema.debitMemos).where(eq(schema.debitMemos.id, dmId)).get();
        const dmLines = await companyDb.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, dmRow!.journalEntryId!));
        const dmVatCredit = dmLines.find(l => l.accountId === vatInAcc.id);
        expect(dmVatCredit?.credit).toBe(6000);
      });
    });

    it('rejects negative/invalid fixed asset values and prevents duplicate depreciation posting under concurrency', async () => {
      const badCost = await request(app)
        .post('/api/operations/fixed-assets')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ assetTag: 'FA-BAD-1', assetName: 'Bad Asset', acquisitionCost: -5000, usefulLifeMonths: 12 });
      expect(badCost.status).toBe(400);

      const badSalvage = await request(app)
        .post('/api/operations/fixed-assets')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ assetTag: 'FA-BAD-2', assetName: 'Bad Salvage', acquisitionCost: 1000, salvageValue: 1500, usefulLifeMonths: 12 });
      expect(badSalvage.status).toBe(400);

      const badLife = await request(app)
        .post('/api/operations/fixed-assets')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ assetTag: 'FA-BAD-3', assetName: 'Bad Life', acquisitionCost: 1000, salvageValue: 0, usefulLifeMonths: -6 });
      expect(badLife.status).toBe(400);

      const goodAsset = await request(app)
        .post('/api/operations/fixed-assets')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          assetTag: 'FA-RACE-01',
          assetName: 'Concurrent Test Printer',
          acquisitionDate: '2026-08-01',
          acquisitionCost: 12000,
          salvageValue: 0,
          usefulLifeMonths: 12,
        });
      expect(goodAsset.status).toBe(200);

      // Concurrent depreciation post for 2026-09
      const [d1, d2] = await Promise.all([
        request(app)
          .post('/api/operations/depreciation/post')
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({ periodMonth: '2026-09' }),
        request(app)
          .post('/api/operations/depreciation/post')
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({ periodMonth: '2026-09' }),
      ]);
      const statuses = [d1.status, d2.status].sort((a, b) => a - b);
      expect(statuses[0]).toBe(200);
      expect([400, 409]).toContain(statuses[1]);
    });

    it('rejects invalid CSV dates, enforces cash direction sign, avoids silent ties, and blocks concurrent double approveMatch', async () => {
      const companyDb = await CompanyManager.getCompanyDb(COMP_A);

      await dbContext.run(companyDb as any, async () => {
        const bankAcc = await BankReconciliationService.createBankAccount({
          companyId: COMP_A,
          accountName: 'Adv Recon Bank',
          bankName: 'Metrobank',
          accountNumber: '99887766',
        });
        await expect(
          BankReconciliationService.importStatement({
            companyId: COMP_A,
            bankAccountId: bankAcc.id,
            statementDate: new Date('2026-08-31T00:00:00Z'),
            csvContent: 'date,description,reference,amount,type\nnot-a-real-date,Bad Row,REF1,100.00,CREDIT',
            userId: ownerAId,
          })
        ).rejects.toThrow();

        // Create two identical-confidence journals with cash OUTFLOW (CREDIT cash) of PHP 250.00 (25,000 centavos)
        const accts = await companyDb.select().from(schema.accounts);
        const cashAcc = accts.find(a => a.isCashAccount || a.accountCode === '1010')!;
        const expAcc = accts.find(a => a.accountType === 'EXPENSE')!;
        const j1Id = crypto.randomUUID();
        const j2Id = crypto.randomUUID();
        await companyDb.insert(schema.journalEntries).values([
          { id: j1Id, companyId: COMP_A, journalNumber: 'JV-REC-OUT-1', entryDate: '2026-08-25', description: 'Bank fee batch A', status: 'POSTED', createdBy: ownerAId },
          { id: j2Id, companyId: COMP_A, journalNumber: 'JV-REC-OUT-2', entryDate: '2026-08-25', description: 'Bank fee batch B', status: 'POSTED', createdBy: ownerAId },
        ]);
        await companyDb.insert(schema.journalLines).values([
          { id: crypto.randomUUID(), journalEntryId: j1Id, accountId: expAcc.id, debit: 25000, credit: 0, lineNumber: 1 },
          { id: crypto.randomUUID(), journalEntryId: j1Id, accountId: cashAcc.id, debit: 0, credit: 25000, lineNumber: 2 },
          { id: crypto.randomUUID(), journalEntryId: j2Id, accountId: expAcc.id, debit: 25000, credit: 0, lineNumber: 1 },
          { id: crypto.randomUUID(), journalEntryId: j2Id, accountId: cashAcc.id, debit: 0, credit: 25000, lineNumber: 2 },
        ]);

        // Import CREDIT deposit of 250.00 (opposite direction to cash outflow JEs above!)
        const impOpp = await BankReconciliationService.importStatement({
          companyId: COMP_A,
          bankAccountId: bankAcc.id,
          statementDate: new Date('2026-08-31T00:00:00Z'),
          csvContent: 'date,description,reference,amount,type\n2026-08-25,Opposite Direction Deposit,,250.00,CREDIT',
          userId: ownerAId,
        });
        expect(impOpp.importedCount).toBe(1);
        const oppMatch = await BankReconciliationService.runMatchingEngine(COMP_A, bankAcc.id);
        // Should NOT match outflow journals to a CREDIT deposit!
        expect(oppMatch.suggestions.some(s => s.matchedJournalId === j1Id || s.matchedJournalId === j2Id)).toBe(false);

        // Concurrent approveMatch must only succeed once
        const btxRows = await companyDb.select().from(schema.bankTransactions).where(eq(schema.bankTransactions.bankStatementId, impOpp.statementId));
        const targetBtxId = btxRows[0].id;
        const [m1, m2] = await Promise.allSettled([
          BankReconciliationService.approveMatch(COMP_A, targetBtxId, j1Id, ownerAId, 'Company Owner'),
          BankReconciliationService.approveMatch(COMP_A, targetBtxId, j1Id, ownerAId, 'Company Owner'),
        ]);
        const fulfilled = [m1, m2].filter(r => r.status === 'fulfilled');
        const rejected = [m1, m2].filter(r => r.status === 'rejected');
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
      });
    });
  });

  // =========================================================================
  // CLUSTER 5: CROSS-REPORT SINGLE SOURCE OF TRUTH, SAWT/QAP/SLSP, WITHHOLDING & BIR
  // =========================================================================
  describe('Cluster 5 — Reporting Single Source of Truth, SAWT/QAP/SLSP & Withholding', () => {
    const COMP_SSOT = 'LGR-PH-ADV-SSOT';
    let ssotToken = '';
    const ssotOwnerId = 'usr-ssot-owner';
    const ssotBkId = 'usr-ssot-bk';

    beforeAll(async () => {
      const toks = await seedCompany(COMP_SSOT, 'Single Source Truth Corp.', [
        { id: ssotOwnerId, email: 'owner@ssot.ph', displayName: 'SSOT Owner', roleName: 'Company Owner', approvalLimit: 50_000_000_00 },
        { id: ssotBkId, email: 'bk@ssot.ph', displayName: 'SSOT Bookkeeper', roleName: 'Bookkeeper', approvalLimit: 0 },
      ]);
      ssotToken = toks[ssotOwnerId];

      const companyDb = await CompanyManager.getCompanyDb(COMP_SSOT);
      const sqlite = await CompanyManager.getCompanySqlite(COMP_SSOT);
      await dbContext.run(companyDb as any, async () => {
        sqlite.prepare(`INSERT INTO customers (id, company_id, code, legal_name, tin, vat_status, status) VALUES ('cust-ssot', ?, 'CSS1', 'SSOT Client Corp', '111-222-333-000', 'VAT', 'ACTIVE')`).run(COMP_SSOT);
        sqlite.prepare(`INSERT INTO vendors (id, company_id, code, legal_name, tin, vat_status, status) VALUES ('vend-ssot', ?, 'VSS1', 'SSOT Vendor Corp', '444-555-666-000', 'VAT', 'ACTIVE')`).run(COMP_SSOT);

        const accts = await companyDb.select().from(schema.accounts);
        const revAcc = accts.find(a => a.accountCode === '4010' || a.accountCode === '4000')!;
        const expAcc = accts.find(a => a.accountCode === '5010' || a.accountType === 'EXPENSE')!;
        const vatOutAcc = accts.find(a => a.accountCode === '2020' || a.accountCode === '2200')!;
        const vatInAcc = accts.find(a => a.accountCode === '1040' || a.accountName.toLowerCase().includes('input vat')) || vatOutAcc;
        const cashAcc = accts.find(a => a.isCashAccount || a.accountCode === '1010')!;
        const ewtAcc = accts.find(a => a.accountCode === '2030' || a.accountName.toLowerCase().includes('withholding')) || vatOutAcc;
        const cwtAcc = accts.find(a => a.accountCode === '1050' || a.accountType === 'ASSET')!;

        // Tax codes: VAT_12 (OUT), VAT_EXEMPT (OUT), VAT_12_IN (IN)
        const trdOut = 'trd-ssot-vat-out';
        const trdEx = 'trd-ssot-vat-ex';
        const trdIn = 'trd-ssot-vat-in';
        await companyDb.insert(schema.taxRuleDefinitions).values([
          { id: trdOut, ruleCode: 'VAT_12_OUT', ruleName: 'Output VAT 12%', taxType: 'VAT', status: 'ACTIVE' },
          { id: trdEx, ruleCode: 'VAT_EXEMPT', ruleName: 'VAT Exempt', taxType: 'VAT', status: 'ACTIVE' },
          { id: trdIn, ruleCode: 'VAT_12_IN', ruleName: 'Input VAT 12%', taxType: 'VAT', status: 'ACTIVE' },
        ]);
        await companyDb.insert(schema.taxRuleVersions).values([
          { id: 'trv-ssot-out', ruleDefinitionId: trdOut, version: 1, effectiveFrom: '2026-01-01', calculationMethod: 'PERCENTAGE', rateValue: 0.12, status: 'ACTIVE' },
          { id: 'trv-ssot-ex', ruleDefinitionId: trdEx, version: 1, effectiveFrom: '2026-01-01', calculationMethod: 'EXEMPT', rateValue: 0, status: 'ACTIVE' },
          { id: 'trv-ssot-in', ruleDefinitionId: trdIn, version: 1, effectiveFrom: '2026-01-01', calculationMethod: 'PERCENTAGE', rateValue: 0.12, status: 'ACTIVE' },
        ]);
        await companyDb.insert(schema.taxCodes).values([
          { id: 'tc-ssot-out', companyId: COMP_SSOT, code: 'VAT_12', name: 'Output VAT 12%', taxType: 'VAT', inputOutputDirection: 'OUTPUT', accountId: vatOutAcc.id, ruleDefinitionId: trdOut, status: 'ACTIVE' },
          { id: 'tc-ssot-ex', companyId: COMP_SSOT, code: 'VAT_EXEMPT', name: 'VAT Exempt', taxType: 'VAT', inputOutputDirection: 'OUTPUT', accountId: vatOutAcc.id, ruleDefinitionId: trdEx, status: 'ACTIVE' },
          { id: 'tc-ssot-in', companyId: COMP_SSOT, code: 'VAT_12_IN', name: 'Input VAT 12%', taxType: 'VAT', inputOutputDirection: 'INPUT', accountId: vatInAcc.id, ruleDefinitionId: trdIn, status: 'ACTIVE' },
        ]);

        // 1. VATable Sale in 2026-07: PHP 1,120 gross -> 1,000 net + 120 VAT (100,000 net + 12,000 VAT)
        const si1 = await createSalesInvoice(COMP_SSOT, {
          customerId: 'cust-ssot',
          invoiceNumber: 'SI-SSOT-01',
          invoiceDate: '2026-07-10',
          dueDate: '2026-08-10',
          totalAmount: 112000,
          lines: [{ accountId: revAcc.id, taxCodeId: 'tc-ssot-out', amount: 112000, unitPrice: 112000, description: 'VATable Service' }],
        }, ssotBkId);
        await submitSalesInvoice(COMP_SSOT, si1, ssotBkId);
        await approveSalesInvoice(COMP_SSOT, si1, ssotOwnerId);
        await postSalesInvoice(COMP_SSOT, si1, `per-${COMP_SSOT}-2026`, [], ssotOwnerId, 'Company Owner');

        // 2. VAT-EXEMPT Sale in 2026-07: PHP 500 -> 500 net + 0 VAT (50,000 centavos)
        const si2 = await createSalesInvoice(COMP_SSOT, {
          customerId: 'cust-ssot',
          invoiceNumber: 'SI-SSOT-02',
          invoiceDate: '2026-07-15',
          dueDate: '2026-08-15',
          totalAmount: 50000,
          lines: [{ accountId: revAcc.id, taxCodeId: 'tc-ssot-ex', amount: 50000, unitPrice: 50000, description: 'Exempt Sale' }],
        }, ssotBkId);
        await submitSalesInvoice(COMP_SSOT, si2, ssotBkId);
        await approveSalesInvoice(COMP_SSOT, si2, ssotOwnerId);
        await postSalesInvoice(COMP_SSOT, si2, `per-${COMP_SSOT}-2026`, [], ssotOwnerId, 'Company Owner');

        // 3. Purchase Bill in 2026-07 with Input VAT: PHP 560 gross -> 500 net + 60 Input VAT
        const pb1 = await createPurchaseBill(COMP_SSOT, {
          vendorId: 'vend-ssot',
          billNumber: 'PB-SSOT-01',
          billDate: '2026-07-20',
          dueDate: '2026-08-20',
          totalAmount: 56000,
          lines: [{ accountId: expAcc.id, taxCodeId: 'tc-ssot-in', amount: 56000, unitPrice: 56000, description: 'VATable Expense' }],
        }, ssotBkId);
        await submitPurchaseBill(COMP_SSOT, pb1, ssotBkId);
        await approvePurchaseBill(COMP_SSOT, pb1, ssotOwnerId);
        await postPurchaseBill(COMP_SSOT, pb1, `per-${COMP_SSOT}-2026`, [], ssotOwnerId, 'Company Owner');

        // 4. Customer Payment with CWT (PHP 20.00 = 2,000 centavos) in 2026-07
        const cp1 = await createCustomerPayment(COMP_SSOT, {
          customerId: 'cust-ssot',
          paymentNumber: 'CR-SSOT-01',
          paymentDate: '2026-07-25',
          cashAccountId: cashAcc.id,
          amount: 110000,
          withholdingTaxAmount: 2000,
          withholdingTaxAccountId: cwtAcc.id,
          applications: [{ invoiceId: si1, appliedAmount: 112000, withholdingAmount: 2000 }],
        }, ssotBkId);
        await submitCustomerPayment(COMP_SSOT, cp1, ssotBkId);
        await approveCustomerPayment(COMP_SSOT, cp1, ssotOwnerId);
        await postCustomerPayment(COMP_SSOT, cp1, `per-${COMP_SSOT}-2026`, ssotOwnerId, undefined, 'Company Owner');

        // 5. Supplier Payment with EWT (PHP 10.00 = 1,000 centavos) in 2026-09 (different quarter Q3 vs Q3, month 09)
        const sp1 = await createSupplierPayment(COMP_SSOT, {
          vendorId: 'vend-ssot',
          paymentNumber: 'CV-SSOT-01',
          paymentDate: '2026-09-05',
          cashAccountId: cashAcc.id,
          amount: 55000,
          withholdingTaxAmount: 1000,
          withholdingTaxAccountId: ewtAcc.id,
          applications: [{ billId: pb1, appliedAmount: 55000, withholdingAmount: 1000 }],
        }, ssotBkId);
        await submitSupplierPayment(COMP_SSOT, sp1, ssotBkId);
        await approveSupplierPayment(COMP_SSOT, sp1, ssotOwnerId);
        await postSupplierPayment(COMP_SSOT, sp1, `per-${COMP_SSOT}-2026`, ssotOwnerId, undefined, 'Company Owner');
      });
    });

    it('matches GL revenue/expense consistently across Income Statement, ReportEngine, Books of Accounts, and respects SAWT/QAP/SLSP period & stored taxCalculations', async () => {
      const isRes = await request(app)
        .get('/api/reports/income-statement?startDate=2026-07-01&endDate=2026-07-31')
        .set('Authorization', `Bearer ${ssotToken}`);
      expect(isRes.status).toBe(200);
      // Net revenue = 100,000 (VATable net) + 50,000 (Exempt) = 150,000 centavos
      expect(isRes.body.totalRevenue).toBe(150000);
      expect(isRes.body.totalExpense).toBe(50000);

      const engineSummary = await dbContext.run(await CompanyManager.getCompanyDb(COMP_SSOT), async () =>
        ReportEngine.getFinancialSummary(COMP_SSOT, '2026-07-01', '2026-07-31')
      );
      expect(engineSummary.glTotalRevenue).toBe(isRes.body.totalRevenue);
      expect(engineSummary.glTotalExpenses).toBe(isRes.body.totalExpense);

      // SLSP for 2026-07 uses stored taxCalculations (Output VAT = 120.00, NOT 12/112 * 1620.00 = 173.57!)
      const slspRes = await request(app)
        .get('/api/tax/export/slsp?period=2026-07')
        .set('Authorization', `Bearer ${ssotToken}`);
      expect(slspRes.status).toBe(200);
      expect(slspRes.text).toContain(',2026,07');
      expect(slspRes.text).toContain(',120.00'); // VATable output VAT 120.00
      expect(slspRes.text).toContain(',0.00');   // Exempt sale 0.00 VAT

      // SAWT period filter: Q3 2026 has 20.00 CWT; Q1 2026 has 0 records
      const sawtQ3 = await request(app)
        .get('/api/tax/export/sawt?period=2026-Q3')
        .set('Authorization', `Bearer ${ssotToken}`);
      expect(sawtQ3.status).toBe(200);
      expect(sawtQ3.text).toContain('20.00');
      expect(sawtQ3.text).not.toContain('12312026');

      const sawtQ1 = await request(app)
        .get('/api/tax/export/sawt?period=2026-Q1')
        .set('Authorization', `Bearer ${ssotToken}`);
      expect(sawtQ1.status).toBe(200);
      expect(sawtQ1.text).toContain(',0,0.00,0.00');

      // QAP period filter: 2026-Q3 has 10.00 EWT; 2026-Q1 has 0 records
      const qapQ3 = await request(app)
        .get('/api/tax/export/qap?period=2026-Q3')
        .set('Authorization', `Bearer ${ssotToken}`);
      expect(qapQ3.status).toBe(200);
      expect(qapQ3.text).toContain('10.00');
      expect(qapQ3.text).not.toContain('H1601EQ,');

      // Compliance templates uses real taxCalculations (120.00 Output VAT, 60.00 Input VAT) and real CWT (20.00, NOT 2% of 1500 = 30.00!)
      const tmplRes = await request(app)
        .get('/api/tax/compliance/templates')
        .set('Authorization', `Bearer ${ssotToken}`);
      expect(tmplRes.status).toBe(200);
      expect(tmplRes.body.returnMetrics.outputVat).toBe(120);
      expect(tmplRes.body.returnMetrics.inputVat).toBe(60);
      expect(tmplRes.body.returnMetrics.estimatedCwtCredits).toBe(20);

      // BIR Sales Journal & Purchase Journal map actual sourceTypes ('SALES_INVOICE', 'PURCHASE_BILL')
      await dbContext.run(await CompanyManager.getCompanyDb(COMP_SSOT), async () => {
        const salesBook = await BirComplianceService.generateBookOfAccounts(COMP_SSOT, 'SALES_JOURNAL', '2026-07-01', '2026-07-31');
        expect(salesBook.length).toBeGreaterThan(0);
        const purchaseBook = await BirComplianceService.generateBookOfAccounts(COMP_SSOT, 'PURCHASE_JOURNAL', '2026-07-01', '2026-07-31');
        expect(purchaseBook.length).toBeGreaterThan(0);

        const vatSum = await BirComplianceService.generateVatSummary(COMP_SSOT, '2026-07-01', '2026-07-31');
        expect(vatSum.sales.length).toBe(2);
        expect(vatSum.sales.reduce((s, x) => s + x.inputOutputVat, 0)).toBe(12000);
      });
    });

    it('flags GL_VS_SUBLEDGER_VARIANCE in WithholdingReconciliationService even when GL balance is 0', async () => {
      const COMP_WHT = 'LGR-PH-ADV-WHT';
      await seedCompany(COMP_WHT, 'WHT Variance Corp.', [
        { id: 'usr-wht-1', email: 'wht@test.ph', displayName: 'WHT User', roleName: 'Accountant' },
      ]);
      const companyDb = await CompanyManager.getCompanyDb(COMP_WHT);
      await dbContext.run(companyDb as any, async () => {
        await companyDb.insert(schema.vendors).values({
          id: 'v-wht-1', companyId: COMP_WHT, code: 'VW1', legalName: 'WHT Vendor', tin: '123-456-789-001', status: 'ACTIVE',
        });
        await companyDb.insert(schema.taxCodes).values({
          id: 'tc-wi160', companyId: COMP_WHT, code: 'WI160', name: 'Prof Fees', taxType: 'EWT', status: 'ACTIVE',
        });
        const accts = await companyDb.select().from(schema.accounts);
        const expAcc = accts.find(a => a.accountType === 'EXPENSE')!;
        await companyDb.insert(schema.purchaseBills).values({
          id: 'b-wht-1', companyId: COMP_WHT, vendorId: 'v-wht-1', billNumber: 'BILL-WHT-01', billDate: '2026-08-15', dueDate: '2026-09-15', totalAmount: 50000, balanceDue: 50000, status: 'POSTED',
        });
        await companyDb.insert(schema.purchaseBillLines).values({
          id: 'bl-wht-1', billId: 'b-wht-1', accountId: expAcc.id, description: 'Legal Fee', quantity: 1, unitPrice: 50000, amount: 50000, taxCodeId: 'tc-wi160',
        });

        const recon = await WithholdingReconciliationService.reconcileWithholding(COMP_WHT, '2026-08');
        expect(recon.summary.totalAlphalistAmount).toBeGreaterThan(0);
        expect(recon.summary.totalGeneralLedgerAmount).toBe(0);
        expect(recon.discrepancies.some(d => d.type === 'GL_VS_SUBLEDGER_VARIANCE')).toBe(true);
      });
    });

    it('runs PayrollRemediationService assessment & controlled adjustment in isolated DB without mutating historical items', async () => {
      const COMP_PAY = 'LGR-PH-ADV-PAY';
      await seedCompany(COMP_PAY, 'Payroll Test Corp.', [
        { id: 'usr-pay-rev', email: 'rev@pay.ph', displayName: 'Reviewer', roleName: 'Accountant' },
        { id: 'usr-pay-app', email: 'app@pay.ph', displayName: 'Approver', roleName: 'Company Owner' },
      ]);
      const sqlite = await CompanyManager.getCompanySqlite(COMP_PAY);
      sqlite.prepare(`INSERT INTO employees (id, company_id, employee_no, first_name, last_name, monthly_basic_salary, status) VALUES ('emp-1', ?, 'EMP-01', 'Juan', 'Dela Cruz', 3650000, 'ACTIVE')`).run(COMP_PAY);
      sqlite.prepare(`INSERT INTO payroll_runs (id, company_id, payroll_period, start_date, end_date, payment_date, status, total_gross_pay, total_withholding_tax, total_net_pay) VALUES ('pr-1', ?, '2026-08-A', '2026-08-01', '2026-08-15', '2026-08-15', 'POSTED', 1825000, 10000, 1571875)`).run(COMP_PAY);
      sqlite.prepare(`INSERT INTO payroll_items (id, payroll_run_id, employee_id, basic_pay, gross_pay, sss_employee, philhealth_employee, pagibig_employee, withholding_tax, total_deductions, net_pay) VALUES ('pi-1', 'pr-1', 'emp-1', 1825000, 1825000, 87500, 45625, 10000, 10000, 153125, 1571875)`).run();
      await CompanyManager.syncCompanyDatabaseSnapshot(COMP_PAY);

      const assess = PayrollRemediationService.assessHistoricalPayroll(COMP_PAY);
      expect(assess.totalItemsEvaluated).toBe(1);
      expect(assess.cumulativeStatutoryWithholdingCentavos).toBeGreaterThan(0);

      const adj = await PayrollRemediationService.executeControlledPayrollAdjustment(COMP_PAY, {
        reviewerUserId: 'usr-pay-rev',
        approverUserId: 'usr-pay-app',
        reason: 'Post statutory variance JE in isolated adversarial test',
      });
      expect(adj.status).toBe('ADJUSTMENT_POSTED');

      const sqliteAfter = await CompanyManager.getCompanySqlite(COMP_PAY);
      const itemAfter = sqliteAfter.prepare(`SELECT withholding_tax FROM payroll_items WHERE id = 'pi-1'`).get() as any;
      expect(itemAfter.withholding_tax).toBe(10000); // historical item untouched
    });
  });
});
