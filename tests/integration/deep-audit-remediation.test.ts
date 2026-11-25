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
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'ledgerai-deep-audit-'));
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
import {
  createSalesInvoice,
  submitSalesInvoice,
  approveSalesInvoice,
  postSalesInvoice,
  createPurchaseBill,
  postPurchaseBill,
} from '../../src/server/db/business_transactions';
import { BankReconciliationService } from '../../src/server/services/bankReconciliationService';
import * as schema from '../../src/server/db/schema';
import { eq } from 'drizzle-orm';

const COMP_A = 'LGR-PH-AUDIT-REM-A';
const COMP_B = 'LGR-PH-AUDIT-REM-B';

describe('LEDGERAI PH — DEEP AUDIT REMEDIATION INTEGRATION SUITE (CLUSTERS 1-5)', () => {
  const app = createApp();

  let ownerAToken = '';
  let pureAdminAToken = '';
  let adminAToken = '';
  let bookkeeperAToken = '';
  let auditorAToken = '';
  let readonlyAToken = '';
  let lockedUserToken = '';
  let ownerBToken = '';

  const ownerAId = 'usr-rem-owner-a';
  const pureAdminAId = 'usr-rem-pure-admin-a';
  const adminAId = 'usr-rem-admin-a';
  const bookkeeperAId = 'usr-rem-bookkeeper-a';
  const auditorAId = 'usr-rem-auditor-a';
  const readonlyAId = 'usr-rem-readonly-a';
  const lockedUserId = 'usr-rem-locked-a';
  const spoofAdminEmailId = 'usr-rem-spoof-admin';
  let spoofAdminEmailToken = '';
  const ownerBId = 'usr-rem-owner-b';

  async function setupCompany(
    companyId: string,
    legalName: string,
    users: Array<{
      id: string;
      email: string;
      displayName: string;
      roleName: string;
      roleNames?: string[];
      userTableRole?: string;
      createMembership?: boolean;
      lockedUntil?: number | null;
      approvalLimit?: number | null;
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

      // Ensure open period for 2026
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounting_periods (id, company_id, name, start_date, end_date, fiscal_year, status, created_at, updated_at)
           VALUES (?, ?, 'FY 2026', '2026-01-01', '2026-12-31', 2026, 'OPEN', ?, ?)`
        )
        .run(`per-${companyId}-2026`, companyId, now, now);

      for (const u of users) {
        sqlite
          .prepare(
            `INSERT OR REPLACE INTO users (id, email, password_hash, display_name, status, is_demo, locked_until, created_at, updated_at)
             VALUES (?, ?, 'hash', ?, 'ACTIVE', 1, ?, ?, ?)`
          )
          .run(u.id, u.email, u.displayName, u.lockedUntil ?? null, now, now);

        if (u.createMembership !== false) {
          const cuId = `cu-${companyId}-${u.id}`;
          sqlite
            .prepare(
              `INSERT OR REPLACE INTO company_users (id, user_id, company_id, legacy_role, status, membership_status, default_data_scope, approval_limit_centavos, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'ACTIVE', 'ACTIVE', 'COMPANY_WIDE', ?, ?, ?)`
            )
            .run(cuId, u.id, companyId, u.roleName, u.approvalLimit ?? 0, now, now);
          const effectiveRoles = u.roleNames && u.roleNames.length > 0 ? u.roleNames : [u.roleName];
          await RbacService.setMemberRoles(null, cuId, effectiveRoles as any, 'Audit remediation setup');
          if (u.approvalLimit != null) {
            sqlite
              .prepare(`UPDATE company_users SET approval_limit_centavos = ? WHERE id = ?`)
              .run(u.approvalLimit, cuId);
          }
        }

        const rawToken = crypto.randomBytes(32).toString('hex');
        sqlite
          .prepare(`INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`)
          .run(hashToken(rawToken), u.id, now + 86400000, now);
        tokens[u.id] = `${companyId}.${rawToken}`;
      }
    });

    return tokens;
  }

  beforeAll(async () => {
    const tokensA = await setupCompany(COMP_A, 'Remediation Alpha Corp.', [
      { id: ownerAId, email: 'owner@alpha.ph', displayName: 'Owner Alpha', roleName: 'Company Owner', userTableRole: 'OWNER', approvalLimit: 5_000_000_00 },
      { id: pureAdminAId, email: 'pure-admin@alpha.ph', displayName: 'IT Only Admin Alpha', roleName: 'Company Administrator', approvalLimit: 0 },
      { id: adminAId, email: 'admin-staff@alpha.ph', displayName: 'Company Admin Approver Alpha', roleName: 'Company Administrator', roleNames: ['Company Administrator', 'Approver'], approvalLimit: 2_000_000_00 },
      { id: bookkeeperAId, email: 'bookkeeper@alpha.ph', displayName: 'Bookkeeper Alpha', roleName: 'Bookkeeper', approvalLimit: 0 },
      { id: auditorAId, email: 'auditor@alpha.ph', displayName: 'Auditor Alpha', roleName: 'Auditor', approvalLimit: 0 },
      { id: readonlyAId, email: 'readonly@alpha.ph', displayName: 'ReadOnly Alpha', roleName: 'Read-only User', approvalLimit: 0 },
      { id: lockedUserId, email: 'locked@alpha.ph', displayName: 'Locked Alpha', roleName: 'Bookkeeper', lockedUntil: Date.now() + 3600_000 },
      { id: spoofAdminEmailId, email: 'admin-unprivileged@alpha.ph', displayName: 'Admin Email Without Membership', roleName: 'Read-only User', userTableRole: 'USER', createMembership: false },
    ]);

    const tokensB = await setupCompany(COMP_B, 'Remediation Beta Corp.', [
      { id: ownerBId, email: 'owner@beta.ph', displayName: 'Owner Beta', roleName: 'Company Owner', userTableRole: 'OWNER', approvalLimit: 5_000_000_00 },
    ]);

    ownerAToken = tokensA[ownerAId];
    pureAdminAToken = tokensA[pureAdminAId];
    adminAToken = tokensA[adminAId];
    bookkeeperAToken = tokensA[bookkeeperAId];
    auditorAToken = tokensA[auditorAId];
    readonlyAToken = tokensA[readonlyAId];
    lockedUserToken = tokensA[lockedUserId];
    spoofAdminEmailToken = tokensA[spoofAdminEmailId];
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
  // CLUSTER 1: AUTHENTICATION, RBAC, IDOR & LEAST PRIVILEGE
  // =========================================================================
  describe('Cluster 1 — Auth, RBAC, Tenant Isolation & Engagements', () => {
    it('blocks query-string ?x=/licensing/ bypass on protected company routes when user has no membership', async () => {
      const res = await request(app)
        .get('/api/users?x=/licensing/')
        .set('Authorization', `Bearer ${spoofAdminEmailToken}`);
      expect(res.status).toBe(403);
    });

    it('never grants Owner (*) access just because user email starts with "admin"', async () => {
      const res = await request(app)
        .get('/api/rbac/matrix')
        .set('Authorization', `Bearer ${spoofAdminEmailToken}`);
      expect(res.status).toBe(403);
    });

    it('rejects locked users across authenticated endpoints', async () => {
      const res = await request(app)
        .get('/api/accounting/accounts')
        .set('Authorization', `Bearer ${lockedUserToken}`);
      expect([401, 403]).toContain(res.status);
    });

    it('enforces least-privilege permissions: auditor cannot trigger integrity scan and bookkeeper cannot use reports:export to export integrity logs', async () => {
      const scanRes = await request(app)
        .post('/api/audit/integrity/scan')
        .set('Authorization', `Bearer ${auditorAToken}`)
        .send({});
      expect(scanRes.status).toBe(403);

      // Bookkeeper has reports:export, must NOT get audit:integrity:export
      const exportRes = await request(app)
        .get('/api/audit/export')
        .set('Authorization', `Bearer ${bookkeeperAToken}`);
      expect(exportRes.status).toBe(403);
    });

    it('blocks non-privileged role from modifying data-scope or approval-limit or unlocking users', async () => {
      const cuBookkeeper = `cu-${COMP_A}-${bookkeeperAId}`;
      const scopeRes = await request(app)
        .put(`/api/rbac/members/${cuBookkeeper}/data-scope`)
        .set('Authorization', `Bearer ${bookkeeperAToken}`)
        .send({ defaultDataScope: 'COMPANY_WIDE', reason: 'Privilege escalation attempt' });
      expect(scopeRes.status).toBe(403);

      const unlockRes = await request(app)
        .post(`/api/users/${lockedUserId}/unlock`)
        .set('Authorization', `Bearer ${bookkeeperAToken}`)
        .send({ reason: 'Unauthorized unlock' });
      expect(unlockRes.status).toBe(403);
    });

    it('enforces cross-tenant IDOR protection on audit engagements items and workpaper SoD', async () => {
      // Owner B creates engagement in Company B
      const createEng = await request(app)
        .post('/api/audit-engagements')
        .set('Authorization', `Bearer ${ownerBToken}`)
        .send({
          engagementName: 'Beta Statutory Audit FY2026',
          clientCompanyId: COMP_B,
          auditPeriod: '2026',
          engagementType: 'EXTERNAL_AUDIT',
        });
      expect(createEng.status).toBe(201);
      const betaEngId = createEng.body.id;

      // Owner A attempts to add an item to Company B's engagement
      const idorRes = await request(app)
        .post(`/api/audit-engagements/${betaEngId}/items`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ title: 'Cross-tenant injected item' });
      expect([403, 404]).toContain(idorRes.status);
    });
  });

  // =========================================================================
  // CLUSTER 2: APPROVAL ORCHESTRATION SECURITY & WORKFLOW FUNCTIONALITY
  // =========================================================================
  describe('Cluster 2 — Approval Orchestration Security, SoD, RBAC & Company Administrator Approval', () => {
    let wfId1 = '';
    let wfId2 = '';
    let wfId3 = '';

    async function createSubmittedInvoiceWorkflow(refNo: string, amountCentavos = 100_000): Promise<{ wfId: string; invId: string }> {
      const sqlite = await CompanyManager.getCompanySqlite(COMP_A);
      const companyDb = await CompanyManager.getCompanyDb(COMP_A);
      const invId = `inv-${crypto.randomUUID().slice(0, 8)}`;
      const wfId = `wf-${crypto.randomUUID().slice(0, 8)}`;
      const now = Date.now();

      await dbContext.run(companyDb as any, async () => {
        const cust = await companyDb.select().from(schema.customers).where(eq(schema.customers.companyId, COMP_A)).get();
        if (!cust) {
          sqlite.prepare(`INSERT INTO customers (id, company_id, code, legal_name, status) VALUES ('cust-alpha-1', ?, 'C-01', 'Alpha Customer Inc', 'ACTIVE')`).run(COMP_A);
        }
        sqlite
          .prepare(
            `INSERT INTO sales_invoices (id, company_id, customer_id, invoice_number, invoice_date, due_date, total_amount, balance_due, status, created_by, created_at, updated_at)
             VALUES (?, ?, 'cust-alpha-1', ?, '2026-08-15', '2026-09-15', ?, ?, 'SUBMITTED', ?, ?, ?)`
          )
          .run(invId, COMP_A, refNo, amountCentavos, amountCentavos, bookkeeperAId, now, now);

        await companyDb.insert(schema.approvalWorkflows).values({
          id: wfId,
          companyId: COMP_A,
          entityType: 'SALES_INVOICE',
          entityId: invId,
          recordReference: refNo,
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
            stepName: 'Level 1 Admin Review',
            requiredRole: 'Company Administrator',
            assignedApproverId: adminAId,
            assignedApproverName: 'Company Admin Alpha',
            status: 'PENDING',
          },
          {
            id: `st2-${wfId}`,
            workflowId: wfId,
            companyId: COMP_A,
            entityType: 'SALES_INVOICE',
            entityId: invId,
            stepOrder: 2,
            stepName: 'Level 2 Owner Final Approval',
            requiredRole: 'Company Owner',
            assignedApproverId: ownerAId,
            assignedApproverName: 'Owner Alpha',
            status: 'WAITING',
          },
        ]);
      });

      return { wfId, invId };
    }

    it('allows Company Administrator to approve step assigned to System Administrator / Company Owner equivalent or Company Administrator', async () => {
      const sqlite = await CompanyManager.getCompanySqlite(COMP_A);
      const { wfId } = await createSubmittedInvoiceWorkflow('INV-REM-ADMIN-01', 50_000);
      wfId1 = wfId;
      // Set step 1 requiredRole to System Administrator specifically to verify compatibility
      sqlite.prepare(`UPDATE approval_steps SET required_role = 'System Administrator' WHERE workflow_id = ? AND step_order = 1`).run(wfId);

      // Spoof attempt: bookkeeper sends actualApproverId: ownerAId and executiveSodOverride: true
      const spoofRes = await request(app)
        .post(`/api/journey/approvals/${wfId}/decide`)
        .set('Authorization', `Bearer ${bookkeeperAToken}`)
        .send({
          decision: 'APPROVED',
          actualApproverId: ownerAId,
          executiveSodOverride: true,
          remarks: 'Spoofed self-approval',
        });
      expect(spoofRes.status).toBe(403);

      // Least-privilege check: standalone IT Company Administrator (without Approver) cannot approve financial transaction
      const pureAdminRes = await request(app)
        .post(`/api/journey/approvals/${wfId}/decide`)
        .set('Authorization', `Bearer ${pureAdminAToken}`)
        .send({ decision: 'APPROVED', remarks: 'IT admin should not approve sales financial workflow' });
      expect(pureAdminRes.status).toBe(403);

      // Legitimate Company Administrator + Approver approves Level 1 assigned to System Administrator
      const adminRes = await request(app)
        .post(`/api/journey/approvals/${wfId}/decide`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ decision: 'APPROVED', remarks: 'Verified by Company Administrator + Approver' });
      expect(adminRes.status).toBe(200);
      const decidedStep = (adminRes.body.steps || []).find((s: any) => s.id === adminRes.body.decidedStepId);
      expect(decidedStep?.status).toBe('APPROVED');
      expect(adminRes.body.workflow?.currentStepOrder).toBe(2);
    });

    it('rejects delegate, reassign, escalate, and cancel from unauthorized roles and invalid/self-submitter targets', async () => {
      const { wfId } = await createSubmittedInvoiceWorkflow('INV-REM-CTL-02', 75_000);
      wfId2 = wfId;

      // Auditor cannot cancel
      const cancelAuthRes = await request(app)
        .post(`/api/journey/approvals/${wfId}/cancel`)
        .set('Authorization', `Bearer ${auditorAToken}`)
        .send({ reason: 'Unauthorized cancel attempt' });
      expect(cancelAuthRes.status).toBe(403);

      // Bookkeeper cannot delegate or escalate
      const delUnauth = await request(app)
        .post(`/api/journey/approvals/${wfId}/delegate`)
        .set('Authorization', `Bearer ${bookkeeperAToken}`)
        .send({ delegatedToId: ownerAId, reason: 'Unauthorized delegate' });
      expect(delUnauth.status).toBe(403);

      // Cannot escalate to workflow submitter (SoD violation)
      const escSod = await request(app)
        .post(`/api/journey/approvals/${wfId}/escalate`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ escalatedToId: bookkeeperAId, reason: 'Try escalating to creator' });
      expect([400, 403]).toContain(escSod.status);

      // Cannot delegate to nonexistent fake ID
      const delFake = await request(app)
        .post(`/api/journey/approvals/${wfId}/delegate`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ delegatedToId: 'nonexistent-user-id', reason: 'Invalid target' });
      expect([400, 404]).toContain(delFake.status);

      // Valid delegate from adminAId -> ownerAId succeeds
      const delOk = await request(app)
        .post(`/api/journey/approvals/${wfId}/delegate`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ delegatedToId: ownerAId, reason: 'Delegating to Company Owner' });
      expect(delOk.status).toBe(200);
    });

    it('returns eligible-approvers list without requiring users:view permission', async () => {
      const { wfId } = await createSubmittedInvoiceWorkflow('INV-REM-ELIG-03', 20_000);
      wfId3 = wfId;
      const res = await request(app)
        .get('/api/journey/approvals/eligible-approvers')
        .set('Authorization', `Bearer ${adminAToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.approvers)).toBe(true);
      expect(res.body.approvers.some((u: any) => u.id === ownerAId)).toBe(true);
    });
  });

  // =========================================================================
  // CLUSTER 3: DOCUMENT UPLOAD EMPTY REJECTION & AUDIT CHAIN
  // =========================================================================
  describe('Cluster 3 — Document Empty Rejection', () => {
    it('rejects empty 0-byte / missing fileContentBase64 document uploads', async () => {
      const res = await request(app)
        .post('/api/documents')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          fileName: 'empty_receipt.pdf',
          fileContentBase64: '',
        });
      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // CLUSTER 4: TAX-INCLUSIVE 12/112, FIXED ASSET DEPRECIATION & BANK RECON
  // =========================================================================
  describe('Cluster 4 — Tax-Inclusive 12/112, Depreciation Schedule & Bank Recon', () => {
    it('posts balanced VAT-inclusive Sales Invoice (12/112) and Purchase Bill to GL', async () => {
      const companyDb = await CompanyManager.getCompanyDb(COMP_A);
      const sqlite = await CompanyManager.getCompanySqlite(COMP_A);

      await dbContext.run(companyDb as any, async () => {
        // Ensure customer & vendor
        sqlite.prepare(`INSERT OR IGNORE INTO customers (id, company_id, code, legal_name, status) VALUES ('cust-tax-1', ?, 'CTAX1', 'VAT Buyer Inc', 'ACTIVE')`).run(COMP_A);
        sqlite.prepare(`INSERT OR IGNORE INTO vendors (id, company_id, code, legal_name, tin, status) VALUES ('vend-tax-1', ?, 'VTAX1', 'VAT Supplier Inc', '987-654-321-000', 'ACTIVE')`).run(COMP_A);

        // Ensure VAT_12 tax rule definition, version & active taxCode
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
        const allAcctsForTax = await companyDb.select().from(schema.accounts);
        const vatOutAcc = allAcctsForTax.find((a) => a.accountCode === '2020' || a.accountCode === '2200');
        await companyDb.insert(schema.taxCodes).values({
          id: tcId,
          companyId: COMP_A,
          code: 'VAT_12',
          name: 'Output VAT 12%',
          taxType: 'VAT',
          inputOutputDirection: 'OUTPUT',
          accountId: vatOutAcc?.id,
          ruleDefinitionId: ruleDefId,
          status: 'ACTIVE',
        }).onConflictDoNothing();

        const revAccForLine = allAcctsForTax.find((a) => a.accountCode === '4010' || a.accountCode === '4000');
        const invId = await createSalesInvoice(
          COMP_A,
          {
            customerId: 'cust-tax-1',
            invoiceNumber: 'SI-VAT-INCL-001',
            invoiceDate: '2026-08-20',
            dueDate: '2026-09-20',
            totalAmount: 112000, // PHP 1,120.00 VAT-inclusive
            lines: [
              {
                accountId: revAccForLine?.id,
                description: 'Consulting Services (VAT Inclusive)',
                quantity: 1,
                unitPrice: 112000,
                amount: 112000,
                taxCodeId: tcId,
              },
            ],
          },
          bookkeeperAId
        );

        await submitSalesInvoice(COMP_A, invId, bookkeeperAId);
        await approveSalesInvoice(COMP_A, invId, ownerAId);
        const jeId = await postSalesInvoice(COMP_A, invId, `per-${COMP_A}-2026`, [], ownerAId, 'Company Owner');
        const lines = await companyDb.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, jeId));
        const totalDr = lines.reduce((s, l) => s + l.debit, 0);
        const totalCr = lines.reduce((s, l) => s + l.credit, 0);
        expect(totalDr).toBe(112000);
        expect(totalCr).toBe(112000);

        // Net revenue must be 100,000 centavos and Output VAT must be 12,000 centavos (12/112)
        const allAccts = await companyDb.select().from(schema.accounts);
        const vatAcc = allAccts.find((a) => a.accountCode === '2020' || a.accountCode === '2200');
        const revAcc = allAccts.find((a) => a.accountCode === '4010' || a.accountCode === '4000');
        const vatLine = lines.find((l) => l.accountId === vatAcc?.id);
        const revLine = lines.find((l) => l.accountId === revAcc?.id);
        expect(vatLine?.credit).toBe(12000);
        expect(revLine?.credit).toBe(100000);
      });
    });

    it('generates full >120 month fixed asset depreciation schedules with exact last-month convergence and matches bank transactions', async () => {
      // Test fixed asset >120 months (144 months = 12 years) and rounding remainder (10000 PHP / 3 months -> exact convergence)
      const assetRes = await request(app)
        .post('/api/operations/fixed-assets')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          assetTag: 'FA-REMED-01',
          assetName: 'Building Improvement 12Yr',
          category: 'BUILDING',
          acquisitionDate: '2026-01-15',
          acquisitionCost: 144000, // PHP 144,000 -> PHP 1,000/mo over 144 mos
          salvageValue: 0,
          usefulLifeMonths: 144,
        });
      expect(assetRes.status).toBe(200);
      const assetId = assetRes.body.id;

      const oddAssetRes = await request(app)
        .post('/api/operations/fixed-assets')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          assetTag: 'FA-REMED-ODD-02',
          assetName: 'Odd Centavo Rounding Laptop',
          category: 'EQUIPMENT',
          acquisitionDate: '2026-01-31',
          acquisitionCost: 10000, // PHP 10,000 / 3 mos = 3333.33 + 3333.33 + 3333.34
          salvageValue: 0,
          usefulLifeMonths: 3,
        });
      expect(oddAssetRes.status).toBe(200);

      const companyDb = await CompanyManager.getCompanyDb(COMP_A);
      await dbContext.run(companyDb as any, async () => {
        const scheds = await companyDb
          .select()
          .from(schema.depreciationSchedules)
          .where(eq(schema.depreciationSchedules.assetId, assetId));
        expect(scheds.length).toBe(144);
        const lastSched = scheds[scheds.length - 1];
        expect(lastSched.accumulatedDepreciation).toBe(14400000);
        expect(lastSched.bookValue).toBe(0);

        const oddScheds = await companyDb
          .select()
          .from(schema.depreciationSchedules)
          .where(eq(schema.depreciationSchedules.assetId, oddAssetRes.body.id));
        expect(oddScheds.length).toBe(3);
        expect(oddScheds[0].periodMonth).toBe('2026-02');
        expect(oddScheds[2].accumulatedDepreciation).toBe(1000000);
        expect(oddScheds[2].bookValue).toBe(0);
      });

      // Bank reconciliation matching against posted journal total (112,000 centavos = PHP 1,120.00)
      const bankAccRes = await request(app)
        .post('/api/banking/accounts')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          accountName: 'BDO Operating Checking',
          bankName: 'BDO',
          accountNumber: '001234567890',
        });
      expect([200, 201]).toContain(bankAccRes.status);
      const bankAccId = bankAccRes.body.id;

      await dbContext.run(companyDb as any, async () => {
        const importRes = await BankReconciliationService.importStatement({
          companyId: COMP_A,
          bankAccountId: bankAccId,
          statementDate: new Date('2026-08-31T00:00:00Z'),
          filename: 'remed_test.csv',
          csvContent: 'date,description,reference,amount,type\n2026-08-20,"Consulting, Client Deposit",SI-VAT-INCL-001,1120.00,CREDIT',
          userId: ownerAId,
        });
        expect(importRes.importedCount).toBe(1);

        const matchRes = await BankReconciliationService.runMatchingEngine(COMP_A, bankAccId);
        expect(matchRes.suggestionsCount).toBeGreaterThanOrEqual(1);
        expect(matchRes.suggestions[0].confidence).toBeGreaterThanOrEqual(0.8);
      });
    });
  });

  // =========================================================================
  // CLUSTER 5: TAX, DASHBOARD & REPORTING SINGLE SOURCE OF TRUTH
  // =========================================================================
  describe('Cluster 5 — Tax SLSP, Compliance Templates & Single Source of Truth', () => {
    it('exports dynamic period SLSP .DAT without hardcoded 2026,08', async () => {
      const res = await request(app)
        .get('/api/tax/export/slsp?period=2026-10')
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain(',2026,10');
      expect(res.text).not.toContain(',2026,08');
    });

    it('reconciles Dashboard monthly revenue to GL net revenue rather than VAT-inclusive gross AR total', async () => {
      const dashRes = await request(app)
        .get('/api/dashboard/overview')
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(dashRes.status).toBe(200);
      const aug = (dashRes.body.monthlyTrends || []).find((m: any) => m.fullMonth === 'Aug 26');
      // Invoice posted in Cluster 4 test had 112,000 gross / 100,000 net revenue
      if (aug) {
        expect(aug.revenue).toBe(100000);
      }
    });
  });
});
