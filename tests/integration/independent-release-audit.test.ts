import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ISOLATED_ROOT = path.join(os.tmpdir(), `ledgerai_indep_audit_${process.pid}`);
process.env.LEDGERAI_ISOLATED_TEST_ROOT = ISOLATED_ROOT;
process.env.LEDGERAI_DATA_DIR = path.join(ISOLATED_ROOT, 'companies');
process.env.LEDGERAI_CONFIG_DIR = path.join(ISOLATED_ROOT, 'config');

import { WebSocket } from 'ws';
import { eq, asc } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { initWebSocketServer } from '../../src/server/ws';
import { CompanyManager } from '../../src/server/services/companyManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import { AuditService } from '../../src/server/services/auditService';
import { LedgerIntegrityService } from '../../src/server/services/ledgerIntegrityService';
import { RestoreService } from '../../src/server/services/restoreService';
import { TaxEngine } from '../../src/server/services/taxEngine';
import { BirComplianceService } from '../../src/server/services/birComplianceService';
import { HybridSyncService } from '../../src/server/services/hybridSyncService';
import {
  createPurchaseBill,
  submitPurchaseBill,
  approvePurchaseBill,
  postPurchaseBill,
  issueCheck,
  createBankReconciliation,
} from '../../src/server/db/business_transactions';

describe('LEDGERAI PH 1.0.0-rc.1 — Independent Release Evidence Audit Suite', () => {
  const app = createApp();
  const RUN_TAG = crypto.randomBytes(3).toString('hex').toUpperCase();
  const CORP_A = `LGR-PH-2026-TEST-AUDIT-${RUN_TAG}-A`;
  const CORP_B = `LGR-PH-2026-TEST-AUDIT-${RUN_TAG}-B`;
  const CORP_CLONE = `LGR-PH-2026-TEST-AUDIT-${RUN_TAG}-CLONE`;
  const CORP_TAMPER = `LGR-PH-2026-TEST-AUDIT-${RUN_TAG}-TAMPER`;

  const OWNER_A_ID = `audit-owner-a-${RUN_TAG}`;
  const CHECKER_A_ID = `audit-checker-a-${RUN_TAG}`;
  const MAKER_A_ID = `audit-maker-a-${RUN_TAG}`;
  const VIEWER_A_ID = `audit-viewer-a-${RUN_TAG}`;
  const OWNER_B_ID = `audit-owner-b-${RUN_TAG}`;
  const OWNER_T_ID = `audit-owner-t-${RUN_TAG}`;

  let ownerAToken = '';
  let checkerAToken = '';
  let makerAToken = '';
  let viewerAToken = '';
  let ownerBToken = '';
  let ownerTToken = '';

  const PERIOD_A_ID = `audit-per-2026-${RUN_TAG}`;
  const ACC_CASH_A = `audit-acc-1010-${RUN_TAG}`;
  const ACC_AR_A = `audit-acc-1030-${RUN_TAG}`;
  const ACC_INV_A = `audit-acc-1040-${RUN_TAG}`;
  const ACC_INVAT_A = `audit-acc-1060-${RUN_TAG}`;
  const ACC_AP_A = `audit-acc-2010-${RUN_TAG}`;
  const ACC_OUTVAT_A = `audit-acc-2020-${RUN_TAG}`;
  const ACC_EWT_A = `audit-acc-2030-${RUN_TAG}`;
  const ACC_REV_A = `audit-acc-4010-${RUN_TAG}`;
  const ACC_COGS_A = `audit-acc-5010-${RUN_TAG}`;
  const ACC_EXP_A = `audit-acc-6010-${RUN_TAG}`;
  const VEND_VAT_ID = `audit-vend-vat-${RUN_TAG}`;
  const VEND_NONVAT_ID = `audit-vend-nonvat-${RUN_TAG}`;
  const ITEM_A_ID = `audit-item-${RUN_TAG}`;

  let wsServer: http.Server | null = null;
  let wsPort = 0;

  async function seedUser(
    companyId: string,
    userId: string,
    email: string,
    displayName: string,
    roleName: string
  ) {
    await db.insert(schema.users).values({
      id: userId,
      email,
      passwordHash: 'hash',
      displayName,
      status: 'ACTIVE',
    }).onConflictDoNothing();

    const roleRec = await RbacService.ensureRoleRecord(roleName);
    const memId = `mem-${companyId}-${userId}`;
    await db.insert(schema.companyUsers).values({
      id: memId,
      companyId,
      userId,
      roleId: roleRec.id,
      role: roleName,
      legacyRole: roleName.toUpperCase().replace(/\s+/g, '_'),
      status: 'ACTIVE',
      membershipStatus: 'ACTIVE',
      defaultDataScope: 'COMPANY_WIDE',
    }).onConflictDoNothing();

    await RbacService.setMemberRoles(null, memId, [roleName], `Audit seed ${roleName}`);

    const rawToken = crypto.randomBytes(32).toString('hex');
    await db.insert(schema.sessions).values({
      id: hashToken(rawToken),
      userId,
      companyId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    return `${companyId}.${rawToken}`;
  }

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    for (const cid of [CORP_A, CORP_B, CORP_CLONE, CORP_TAMPER]) {
      await CompanyManager.resetDisposableTestCompanyWorkspace(cid);
    }

    await CompanyManager.createCompanyProfile(CORP_A, 'Audit Alpha Enterprise Corp.', '111-222-333-000', 'Makati City, Metro Manila', false, {
      classification: 'TEST',
      encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
    });
    await CompanyManager.createCompanyProfile(CORP_B, 'Audit Beta Isolated Corp.', '444-555-666-000', 'Taguig City, Metro Manila', false, {
      classification: 'TEST',
      encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
    });
    await CompanyManager.createCompanyProfile(CORP_TAMPER, 'Audit Tamper Lab Corp.', '777-888-999-000', 'Pasig City, Metro Manila', false, {
      classification: 'TEST',
      encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
    });

    const dbA = await CompanyManager.getCompanyDb(CORP_A);
    const sqliteA = await CompanyManager.getCompanySqlite(CORP_A);
    sqliteA.pragma('foreign_keys = OFF');
    sqliteA.prepare('DELETE FROM accounting_periods WHERE company_id = ?').run(CORP_A);
    sqliteA.prepare('DELETE FROM accounts WHERE company_id = ?').run(CORP_A);
    sqliteA.pragma('foreign_keys = ON');

    await dbContext.run(dbA, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      ownerAToken = await seedUser(CORP_A, OWNER_A_ID, `owner.${RUN_TAG}@alpha.ph`, 'Owner A', 'Company Owner');
      checkerAToken = await seedUser(CORP_A, CHECKER_A_ID, `checker.${RUN_TAG}@alpha.ph`, 'Checker A', 'Approver');
      makerAToken = await seedUser(CORP_A, MAKER_A_ID, `maker.${RUN_TAG}@alpha.ph`, 'Maker A', 'Bookkeeper');
      viewerAToken = await seedUser(CORP_A, VIEWER_A_ID, `viewer.${RUN_TAG}@alpha.ph`, 'Viewer A', 'Read-only User');

      await db.insert(schema.accountingPeriods).values({
        id: PERIOD_A_ID,
        companyId: CORP_A,
        name: 'FY 2026 Q1-Q2',
        fiscalYear: 2026,
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        status: 'OPEN',
      }).onConflictDoNothing();

      await db.insert(schema.accounts).values([
        { id: ACC_CASH_A, companyId: CORP_A, accountCode: '1010', accountName: 'Cash in Bank - BPI', accountType: 'ASSET', detailType: 'CASH', normalBalance: 'DEBIT', isControlAccount: true, isCashAccount: true, status: 'ACTIVE' },
        { id: ACC_AR_A, companyId: CORP_A, accountCode: '1030', accountName: 'Accounts Receivable', accountType: 'ASSET', detailType: 'ACCOUNTS_RECEIVABLE', normalBalance: 'DEBIT', isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_INV_A, companyId: CORP_A, accountCode: '1040', accountName: 'Merchandise Inventory', accountType: 'ASSET', detailType: 'INVENTORY', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_INVAT_A, companyId: CORP_A, accountCode: '1060', accountName: 'Input VAT', accountType: 'ASSET', normalBalance: 'DEBIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_AP_A, companyId: CORP_A, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'LIABILITY', detailType: 'ACCOUNTS_PAYABLE', normalBalance: 'CREDIT', isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_OUTVAT_A, companyId: CORP_A, accountCode: '2020', accountName: 'Output VAT Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_EWT_A, companyId: CORP_A, accountCode: '2030', accountName: 'Withholding Tax Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_REV_A, companyId: CORP_A, accountCode: '4010', accountName: 'Sales Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_COGS_A, companyId: CORP_A, accountCode: '5010', accountName: 'Cost of Goods Sold', accountType: 'COGS', detailType: 'COGS', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_EXP_A, companyId: CORP_A, accountCode: '6010', accountName: 'Professional Fees Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
      ]).onConflictDoNothing();

      await db.insert(schema.vendors).values([
        {
          id: VEND_VAT_ID,
          companyId: CORP_A,
          code: 'V-VAT-01',
          legalName: 'VAT Registered Consulting Inc.',
          tin: '222-333-444-000',
          vatStatus: 'VAT_REGISTERED',
          taxpayerClassification: 'CORPORATION',
          status: 'ACTIVE',
        },
        {
          id: VEND_NONVAT_ID,
          companyId: CORP_A,
          code: 'V-NVAT-01',
          legalName: 'Non-VAT Freelancer Co.',
          tin: '555-666-777-000',
          vatStatus: 'NON_VAT',
          taxpayerClassification: 'INDIVIDUAL',
          status: 'ACTIVE',
        },
      ]).onConflictDoNothing();

      await db.insert(schema.inventoryItems).values({
        id: ITEM_A_ID,
        companyId: CORP_A,
        sku: 'SKU-AUDIT-01',
        name: 'Audit Hardware Unit',
        category: 'HARDWARE',
        unitOfMeasure: 'UNIT',
        quantityOnHand: 25,
        unitCost: 100000,
        sellingPrice: 150000,
        inventoryAccountId: ACC_INV_A,
        cogsAccountId: ACC_COGS_A,
        salesAccountId: ACC_REV_A,
        status: 'ACTIVE',
        version: 1,
      }).onConflictDoNothing();
    });

    const dbB = await CompanyManager.getCompanyDb(CORP_B);
    await dbContext.run(dbB, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      ownerBToken = await seedUser(CORP_B, OWNER_B_ID, `owner.${RUN_TAG}@beta.ph`, 'Owner B', 'Company Owner');
    });

    const dbT = await CompanyManager.getCompanyDb(CORP_TAMPER);
    await dbContext.run(dbT, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      ownerTToken = await seedUser(CORP_TAMPER, OWNER_T_ID, `owner.${RUN_TAG}@tamper.ph`, 'Owner Tamper', 'Company Owner');
    });

    wsServer = http.createServer(app);
    initWebSocketServer(wsServer);
    await new Promise<void>((resolve) => {
      wsServer!.listen(0, '127.0.0.1', () => {
        const addr = wsServer!.address() as any;
        wsPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (wsServer) {
      await new Promise<void>((resolve) => wsServer!.close(() => resolve()));
    }
    await CompanyManager.closeAllConnections();
    for (const cid of [CORP_A, CORP_B, CORP_CLONE, CORP_TAMPER]) {
      await CompanyManager.resetDisposableTestCompanyWorkspace(cid);
    }
    if (fs.existsSync(ISOLATED_ROOT)) {
      fs.rmSync(ISOLATED_ROOT, { recursive: true, force: true });
    }
  });

  it('Section 2: Cryptographic Audit Log Lifecycle detects DB trigger blocks, payload/timestamp/hash/previousHash tamper, stripped seal, reorder, missing event, and cross-tenant verify', async () => {
    const dbT = await CompanyManager.getCompanyDb(CORP_TAMPER);
    const sqliteT = await CompanyManager.getCompanySqlite(CORP_TAMPER);
    const createdIds: string[] = [];

    await dbContext.run(dbT, async () => {
      const e1 = await AuditService.log({
        companyId: CORP_TAMPER,
        userId: OWNER_T_ID,
        action: 'AUDIT_CHAIN_SEED_1',
        entityType: 'journal_entry',
        entityId: 'je-audit-1',
        afterData: { amount: 10000 },
      });
      const e2 = await AuditService.log({
        companyId: CORP_TAMPER,
        userId: OWNER_T_ID,
        action: 'AUDIT_CHAIN_SEED_2',
        entityType: 'journal_entry',
        entityId: 'je-audit-2',
        afterData: { amount: 25000 },
      });
      const e3 = await AuditService.log({
        companyId: CORP_TAMPER,
        userId: OWNER_T_ID,
        action: 'AUDIT_CHAIN_SEED_3',
        entityType: 'journal_entry',
        entityId: 'je-audit-3',
        afterData: { amount: 50000 },
      });
      createdIds.push(e1, e2, e3);

      const cleanChain = await AuditService.verifyAuditChain(CORP_TAMPER);
      expect(cleanChain.verified).toBe(true);
      expect(cleanChain.anomalies.length).toBe(0);
    });

    // Live API verification
    const v1 = await request(app)
      .get(`/api/audit/verify/${createdIds[1]}`)
      .set('Authorization', `Bearer ${ownerTToken}`);
    expect(v1.status).toBe(200);
    expect(v1.body.verified).toBe(true);
    expect(v1.body.chainVersion).toBe(2);

    const vcClean = await request(app)
      .get('/api/audit/verify-chain')
      .set('Authorization', `Bearer ${ownerTToken}`);
    expect(vcClean.status).toBe(200);
    expect(vcClean.body.verified).toBe(true);

    // Cross-company verify attempt -> 404
    const crossVerify = await request(app)
      .get(`/api/audit/verify/${createdIds[0]}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .set('x-company-id', CORP_B);
    expect(crossVerify.status).toBe(404);

    // Runtime SQLite triggers must block direct UPDATE and DELETE
    expect(() => {
      sqliteT.prepare(`UPDATE audit_logs SET after_data = ? WHERE id = ?`).run(JSON.stringify({ amount: 1 }), createdIds[1]);
    }).toThrow(/SECURITY_VIOLATION/i);
    expect(() => {
      sqliteT.prepare(`DELETE FROM audit_logs WHERE id = ?`).run(createdIds[1]);
    }).toThrow(/SECURITY_VIOLATION/i);

    // Simulate offline attacker bypassing triggers to prove app-layer crypto verification catches all tamper modes
    const triggers = sqliteT
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit_logs'`)
      .all() as Array<{ name: string; sql: string }>;
    for (const trg of triggers) {
      sqliteT.exec(`DROP TRIGGER IF EXISTS "${trg.name}"`);
    }

    await dbContext.run(dbT, async () => {
      const origRows = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.companyId, CORP_TAMPER)).orderBy(asc(schema.auditLogs.timestamp));
      const rowMap = new Map(origRows.map((r: any) => [r.id, { ...r }]));
      const restoreRow = async (id: string) => {
        const orig: any = rowMap.get(id)!;
        await db.update(schema.auditLogs).set({
          afterData: orig.afterData,
          timestamp: orig.timestamp,
          metadata: orig.metadata,
        }).where(eq(schema.auditLogs.id, id));
      };

      // 1. Modify record payload (afterData)
      await db.update(schema.auditLogs).set({ afterData: JSON.stringify({ amount: 999999 }) }).where(eq(schema.auditLogs.id, createdIds[1]));
      let apiTamper = await request(app).get(`/api/audit/verify/${createdIds[1]}`).set('Authorization', `Bearer ${ownerTToken}`);
      expect(apiTamper.status).toBe(200);
      expect(apiTamper.body.verified).toBe(false);
      let scan = await LedgerIntegrityService.runIntegrityScan(CORP_TAMPER, { userId: OWNER_T_ID });
      expect(scan.findings.some((f) => f.checkCode === 'CRY_04_AUDIT_AND_SCAN_HASH_CHAIN')).toBe(true);
      await restoreRow(createdIds[1]);

      // 2. Modify timestamp
      await db.update(schema.auditLogs).set({ timestamp: new Date('2020-01-01T00:00:00.000Z') }).where(eq(schema.auditLogs.id, createdIds[1]));
      let check = AuditService.verifyIntegrity(
        (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, createdIds[1])).get())!
      );
      expect(check.verified).toBe(false);
      await restoreRow(createdIds[1]);

      // 3. Modify integritySeal hash & 4. Modify previousHash inside metadata
      const origMeta2 = JSON.parse(String((rowMap.get(createdIds[1])! as any).metadata));
      await db.update(schema.auditLogs).set({
        metadata: JSON.stringify({ ...origMeta2, integritySeal: 'deadbeef'.repeat(8) }),
      }).where(eq(schema.auditLogs.id, createdIds[1]));
      check = AuditService.verifyIntegrity(
        (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, createdIds[1])).get())!
      );
      expect(check.verified).toBe(false);
      await restoreRow(createdIds[1]);

      await db.update(schema.auditLogs).set({
        metadata: JSON.stringify({ ...origMeta2, previousHash: 'badbad00'.repeat(8) }),
      }).where(eq(schema.auditLogs.id, createdIds[1]));
      const chainBadPrev = await AuditService.verifyAuditChain(CORP_TAMPER);
      expect(chainBadPrev.verified).toBe(false);
      await restoreRow(createdIds[1]);

      // 5. Stripped integrity metadata -> fails closed
      await db.update(schema.auditLogs).set({ metadata: JSON.stringify({}) }).where(eq(schema.auditLogs.id, createdIds[1]));
      check = AuditService.verifyIntegrity(
        (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, createdIds[1])).get())!
      );
      expect(check.verified).toBe(false);
      expect(check.reason).toBe('MISSING_INTEGRITY_SEAL');
      await restoreRow(createdIds[1]);

      // 6. Reorder events (swap sequenceNumber between event 2 and event 3)
      const origMeta3 = JSON.parse(String((rowMap.get(createdIds[2])! as any).metadata));
      await db.update(schema.auditLogs).set({
        metadata: JSON.stringify({ ...origMeta2, sequenceNumber: origMeta3.sequenceNumber }),
      }).where(eq(schema.auditLogs.id, createdIds[1]));
      await db.update(schema.auditLogs).set({
        metadata: JSON.stringify({ ...origMeta3, sequenceNumber: origMeta2.sequenceNumber }),
      }).where(eq(schema.auditLogs.id, createdIds[2]));
      const chainReordered = await AuditService.verifyAuditChain(CORP_TAMPER);
      expect(chainReordered.verified).toBe(false);
      await restoreRow(createdIds[1]);
      await restoreRow(createdIds[2]);

      // 7. Delete middle event -> chain gap detected by both verifyAuditChain and CRY_04
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.id, createdIds[1]));
      const chainDeleted = await AuditService.verifyAuditChain(CORP_TAMPER);
      expect(chainDeleted.verified).toBe(false);
      expect(chainDeleted.anomalies.some((a) => a.type === 'CHAIN_SEQUENCE_GAP_OR_REORDER')).toBe(true);
      scan = await LedgerIntegrityService.runIntegrityScan(CORP_TAMPER, { userId: OWNER_T_ID });
      expect(scan.findings.some((f) => f.checkCode === 'CRY_04_AUDIT_AND_SCAN_HASH_CHAIN')).toBe(true);
    });
  });

  it('Section 3: Approval Workflow enforces SoD, duplicate block, invalid status rejection, maker cancel, and concurrent action lock', async () => {
    const createRes = await request(app)
      .post('/api/approval/requests')
      .set('Authorization', `Bearer ${makerAToken}`)
      .send({ actionType: 'HIGH_VALUE_PAYMENT', amountPHP: 250000, details: 'Audit supplier release #1' });
    expect(createRes.status).toBe(200);
    const reqId = createRes.body.id;

    // Duplicate identical PENDING request -> 409
    const dupRes = await request(app)
      .post('/api/approval/requests')
      .set('Authorization', `Bearer ${makerAToken}`)
      .send({ actionType: 'HIGH_VALUE_PAYMENT', amountPHP: 250000, details: 'Audit supplier release #1' });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error).toBe('DUPLICATE_APPROVAL_REQUEST');

    // Self-approval attempt -> 403
    const selfOwnerCreate = await request(app)
      .post('/api/approval/requests')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ actionType: 'PERIOD_CLOSE', amountPHP: 100000, details: 'Self-SoD check' });
    expect(selfOwnerCreate.status).toBe(200);
    const selfReqId = selfOwnerCreate.body.id;

    const selfApproveRes = await request(app)
      .post(`/api/approval/requests/${selfReqId}/action`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ status: 'APPROVED' });
    expect(selfApproveRes.status).toBe(403);
    expect(selfApproveRes.body.error).toBe('SOD_VIOLATION');

    // Unauthorized Viewer attempt -> 403
    const viewerApproveRes = await request(app)
      .post(`/api/approval/requests/${reqId}/action`)
      .set('Authorization', `Bearer ${viewerAToken}`)
      .send({ status: 'APPROVED' });
    expect(viewerApproveRes.status).toBe(403);

    // Cross-company approval attempt -> 404
    const crossApproveRes = await request(app)
      .post(`/api/approval/requests/${reqId}/action`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .set('x-company-id', CORP_B)
      .send({ status: 'APPROVED' });
    expect(crossApproveRes.status).toBe(404);

    // Invalid status string must return 400 instead of coercing to APPROVED
    const bogusStatusRes = await request(app)
      .post(`/api/approval/requests/${reqId}/action`)
      .set('Authorization', `Bearer ${checkerAToken}`)
      .send({ status: 'CANCELLED' });
    expect(bogusStatusRes.status).toBe(400);
    expect(bogusStatusRes.body.error).toBe('INVALID_WORKFLOW_ACTION');

    // Simultaneous checker requests -> one 200, one 409
    const [conc1, conc2] = await Promise.all([
      request(app)
        .post(`/api/approval/requests/${reqId}/action`)
        .set('Authorization', `Bearer ${checkerAToken}`)
        .send({ status: 'APPROVED' }),
      request(app)
        .post(`/api/approval/requests/${reqId}/action`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ status: 'APPROVED' }),
    ]);
    expect([conc1.status, conc2.status].sort()).toEqual([200, 409]);

    // Re-approval after already processed -> 409
    const afterDone = await request(app)
      .post(`/api/approval/requests/${reqId}/action`)
      .set('Authorization', `Bearer ${checkerAToken}`)
      .send({ status: 'REJECTED' });
    expect(afterDone.status).toBe(409);

    // Maker cancel pending -> non-maker fails 403, maker succeeds 200, subsequent approve fails 409
    const nonMakerCancel = await request(app)
      .post(`/api/approval/requests/${selfReqId}/cancel`)
      .set('Authorization', `Bearer ${checkerAToken}`);
    expect(nonMakerCancel.status).toBe(403);

    const makerCancel = await request(app)
      .post(`/api/approval/requests/${selfReqId}/cancel`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(makerCancel.status).toBe(200);
    expect(makerCancel.body.status).toBe('CANCELLED');

    const approveCancelled = await request(app)
      .post(`/api/approval/requests/${selfReqId}/action`)
      .set('Authorization', `Bearer ${checkerAToken}`)
      .send({ status: 'APPROVED' });
    expect(approveCancelled.status).toBe(409);
  });

  it('Section 5: Backup/Restore preserves modern subledgers & v2 audit chain on REPLACE, remaps NEW UUIDs, rejects unauth/tamper, and rolls back failed REPLACE', async () => {
    const dbA = await CompanyManager.getCompanyDb(CORP_A);
    let checkId = '';
    let reconId = '';

    await dbContext.run(dbA, async () => {
      const billId = await createPurchaseBill(
        CORP_A,
        {
          vendorId: VEND_VAT_ID,
          billNumber: 'BILL-RST-01',
          billDate: '2026-02-15',
          dueDate: '2026-03-15',
          totalAmount: 112000,
          lines: [{ description: 'Audit Consulting Q1', accountId: ACC_EXP_A, quantity: 1, unitPrice: 112000, amount: 112000 }],
        },
        MAKER_A_ID,
        'Bookkeeper'
      );
      await submitPurchaseBill(CORP_A, billId, MAKER_A_ID);
      await approvePurchaseBill(CORP_A, billId, CHECKER_A_ID);
      await postPurchaseBill(CORP_A, billId, PERIOD_A_ID, [], OWNER_A_ID, 'Company Owner');

      checkId = await issueCheck(
        CORP_A,
        {
          checkNumber: 'CHK-RST-001',
          checkDate: '2026-02-20',
          payeeName: 'VAT Registered Consulting Inc.',
          cashAccountId: ACC_CASH_A,
          amount: 56000,
        },
        OWNER_A_ID
      );

      reconId = await createBankReconciliation(
        CORP_A,
        {
          bankAccountId: ACC_CASH_A,
          statementDate: '2026-02-28',
          statementEndingBalance: 1000000,
        },
        OWNER_A_ID
      );
    });

    const payload = await RestoreService.exportBackup(CORP_A);
    const laiBuffer = RestoreService.serializeLai(payload);

    // Unauthorized restore -> 403
    const unauthRestore = await request(app)
      .post('/api/restore')
      .set('Authorization', `Bearer ${viewerAToken}`)
      .send({ targetCompanyId: CORP_A, mode: 'REPLACE', backupData: laiBuffer.toString('base64') });
    expect(unauthRestore.status).toBe(403);

    // Path traversal destinationPath blocked -> >= 400
    const travRestore = await request(app)
      .post('/api/restore')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ targetCompanyId: CORP_CLONE, mode: 'NEW', destinationPath: '../../etc/pwn', backupData: laiBuffer.toString('base64') });
    expect(travRestore.status).toBeGreaterThanOrEqual(400);

    // NEW mode restore: remaps modern subledger UUIDs (checks, bankReconciliations)
    const deserializedForNew = RestoreService.deserializeLai(laiBuffer);
    await RestoreService.restoreDatabase(deserializedForNew, CORP_CLONE, 'NEW', OWNER_A_ID);
    const dbClone = await CompanyManager.getCompanyDb(CORP_CLONE);
    await dbContext.run(dbClone, async () => {
      const clonedChecks = await db.select().from(schema.checks);
      const clonedRecons = await db.select().from(schema.bankReconciliations);
      expect(clonedChecks.length).toBeGreaterThanOrEqual(1);
      expect(clonedRecons.length).toBeGreaterThanOrEqual(1);
      expect(clonedChecks[0].companyId).toBe(CORP_CLONE);
      expect(clonedChecks[0].id).not.toBe(checkId);
      expect(clonedRecons[0].id).not.toBe(reconId);
    });

    // REPLACE mode restore: preserves v2 audit chain + appends sealed RESTORE_COMPLETED
    const deserializedForReplace = RestoreService.deserializeLai(laiBuffer);
    await RestoreService.restoreDatabase(deserializedForReplace, CORP_A, 'REPLACE', OWNER_A_ID);
    await dbContext.run(dbA, async () => {
      const postRestoreChain = await AuditService.verifyAuditChain(CORP_A);
      expect(postRestoreChain.anomalies).toEqual([]);
      expect(postRestoreChain.verified).toBe(true);
      const restoreLog = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'RESTORE_COMPLETED')).get();
      expect(restoreLog).toBeDefined();
      const sealCheck = AuditService.verifyIntegrity(restoreLog!);
      expect(sealCheck.verified).toBe(true);
    });

    // Failed REPLACE restore rollback: corrupt FK in signed payload -> aborts & restores pre-replace company DB + stays registered!
    const badPayload = await RestoreService.exportBackup(CORP_A);
    badPayload.data.journalLines.push({
      id: 'corrupt-jl-fk',
      journalEntryId: 'nonexistent-parent-je',
      accountId: 'nonexistent-account',
      debit: 100,
      credit: 0,
    });
    badPayload.metadata.checksum = RestoreService.generateChecksum(badPayload.data);
    badPayload.metadata.signature = RestoreService.generateSignature(badPayload.data);

    await expect(
      RestoreService.restoreDatabase(badPayload, CORP_A, 'REPLACE', OWNER_A_ID)
    ).rejects.toThrow();

    const manifestAfterFail = await CompanyManager.getCompanyManifest(CORP_A);
    expect(manifestAfterFail).toBeDefined();
    const dbAAfterFail = await CompanyManager.getCompanyDb(CORP_A);
    await dbContext.run(dbAAfterFail, async () => {
      const checksAfterFail = await db.select().from(schema.checks);
      expect(checksAfterFail.some((c) => c.id === checkId)).toBe(true);
    });
  });

  it('Section 6: Philippine Statutory rules, Form 2307 quarter isolation, VOID exclusion, and NON_VAT vendor handling', async () => {
    const dbA = await CompanyManager.getCompanyDb(CORP_A);

    await dbContext.run(dbA, async () => {
      await db.insert(schema.purchaseBills).values({
        id: `bill-nonvat-${RUN_TAG}`,
        companyId: CORP_A,
        vendorId: VEND_NONVAT_ID,
        billNumber: 'BILL-NVAT-01',
        billDate: '2026-02-18',
        dueDate: '2026-03-18',
        subtotal: 1000000,
        taxAmount: 0,
        totalAmount: 1000000,
        balanceDue: 1000000,
        status: 'POSTED',
        createdBy: OWNER_A_ID,
      }).onConflictDoNothing();

      await db.insert(schema.supplierPayments).values({
        id: `sp-void-${RUN_TAG}`,
        companyId: CORP_A,
        vendorId: VEND_VAT_ID,
        paymentNumber: 'PAY-VOID-01',
        paymentDate: '2026-02-22',
        amount: 50000,
        withholdingTaxAmount: 10000,
        paymentMethod: 'CHECK',
        cashAccountId: ACC_CASH_A,
        status: 'VOID',
        createdBy: OWNER_A_ID,
      }).onConflictDoNothing();

      const vatSummary = await BirComplianceService.generateVatSummary(CORP_A, '2026-02-01', '2026-02-28');
      const nonVatItem = vatSummary.purchases.find((p) => p.partnerId === VEND_NONVAT_ID);
      const vatItem = vatSummary.purchases.find((p) => p.partnerId === VEND_VAT_ID);
      expect(nonVatItem).toBeDefined();
      expect(nonVatItem!.inputOutputVat).toBe(0);
      expect(nonVatItem!.exemptAmount).toBe(1000000);
      expect(vatItem).toBeDefined();
      expect(vatItem!.inputOutputVat).toBe(12000);
    });

    const badQGen = await request(app)
      .get('/api/tax/2307/generate?year=2026&quarter=Q5')
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(badQGen.status).toBe(400);

    const badQIssue = await request(app)
      .post('/api/tax/2307/issue')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ certificateControlNo: '2307-BAD', year: 2026, quarter: 'Q9', grossPaymentPhp: 1000, taxWithheldPhp: 20 });
    expect(badQIssue.status).toBe(400);

    const q1Res = await request(app)
      .get(`/api/tax/2307/generate?vendorId=${VEND_VAT_ID}&year=2026&quarter=Q1`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(q1Res.status).toBe(200);
    expect(q1Res.body[0].apRecordsCount.billsCount).toBe(1);
    expect(q1Res.body[0].apRecordsCount.paymentsCount).toBe(0);

    const q2Res = await request(app)
      .get(`/api/tax/2307/generate?vendorId=${VEND_VAT_ID}&year=2026&quarter=Q2`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(q2Res.status).toBe(200);
    expect(q2Res.body[0].apRecordsCount.billsCount).toBe(0);

    expect(TaxEngine.calculateVat(112000).vatAmount).toBe(12000);
    expect(TaxEngine.getSection116Rate('2021-06-01')).toBe(0.01);
    expect(TaxEngine.getSection116Rate('2026-04-01')).toBe(0.03);
    expect(TaxEngine.calculate8PercentIncomeTax(100_000_000, { taxpayerClassification: 'CORPORATION' }).isEligible).toBe(false);
    expect(TaxEngine.calculate8PercentIncomeTax(300_000_100, { taxpayerClassification: 'INDIVIDUAL' }).isEligible).toBe(false);
    expect(TaxEngine.calculate8PercentIncomeTax(100_000_000, { isMixedIncomeEarner: false, taxpayerClassification: 'INDIVIDUAL' }).taxDueCentavos).toBe(6_000_000);
    expect(TaxEngine.calculate8PercentIncomeTax(100_000_000, { isMixedIncomeEarner: true, taxpayerClassification: 'INDIVIDUAL' }).taxDueCentavos).toBe(8_000_000);
  });

  it('Section 8: WebSocket auth blocks unauthenticated/cross-tenant subscriptions and HybridSyncService recovers interrupted batches', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws/notifications?companyId=${CORP_A}`);
      ws.once('unexpected-response', (_req, res) => {
        try {
          expect(res.statusCode).toBe(401);
          resolve();
        } catch (err) { reject(err); }
      });
      ws.once('open', () => {
        ws.close();
        reject(new Error('Unauthenticated WebSocket should not open'));
      });
      ws.once('error', () => resolve());
    });

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws/notifications?companyId=${CORP_B}`, {
        headers: { Authorization: `Bearer ${ownerAToken}` },
      });
      ws.once('unexpected-response', (_req, res) => {
        try {
          expect(res.statusCode).toBe(403);
          resolve();
        } catch (err) { reject(err); }
      });
      ws.once('open', () => {
        ws.close();
        reject(new Error('Cross-tenant WebSocket should not open'));
      });
      ws.once('error', (err) => reject(err));
    });

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws/notifications?companyId=${CORP_A}`, {
        headers: { Authorization: `Bearer ${ownerAToken}` },
      });
      let sawConnected = false;
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.event === 'CONNECTED') {
            sawConnected = true;
            expect(msg.data.companyId).toBe(CORP_A);
            ws.send(JSON.stringify({ action: 'SUBSCRIBE', companyId: CORP_B }));
          } else if (msg.event === 'ERROR') {
            expect(sawConnected).toBe(true);
            expect(msg.error).toBe('CROSS_TENANT_SUBSCRIBE_DENIED');
            ws.close();
            resolve();
          }
        } catch (err) {
          ws.close();
          reject(err);
        }
      });
      ws.once('error', reject);
    });

    const k1 = `sync-op-1-${RUN_TAG}`;
    const k2 = `sync-op-2-${RUN_TAG}`;
    const ops = [
      {
        workstationId: 'WS-POS-01',
        idempotencyKey: k1,
        sequenceNumber: 1,
        operationType: 'UPDATE_INVENTORY_STOCK' as const,
        entityType: 'inventory_items' as const,
        entityId: ITEM_A_ID,
        expectedVersion: 1,
        payload: { quantityDelta: -2 },
        userId: OWNER_A_ID,
      },
      {
        workstationId: 'WS-POS-01',
        idempotencyKey: k2,
        sequenceNumber: 2,
        operationType: 'UPDATE_INVENTORY_STOCK' as const,
        entityType: 'inventory_items' as const,
        entityId: ITEM_A_ID,
        expectedVersion: 2,
        payload: { quantityDelta: -3 },
        userId: OWNER_A_ID,
      },
    ];

    const interruptedRun = await HybridSyncService.processWorkstationSyncBatch(CORP_A, ops, {
      simulateDropAfterCount: 1,
      userId: OWNER_A_ID,
    });
    expect(interruptedRun.completedCount).toBe(1);
    expect(interruptedRun.interruptedCount).toBe(1);

    const retryRun = await HybridSyncService.processWorkstationSyncBatch(CORP_A, ops, {
      userId: OWNER_A_ID,
    });
    expect(retryRun.duplicateIdempotentCount).toBe(1);
    expect(retryRun.completedCount).toBe(1);

    const dbA = await CompanyManager.getCompanyDb(CORP_A);
    await dbContext.run(dbA, async () => {
      const item = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, ITEM_A_ID)).get();
      expect(item?.quantityOnHand).toBe(20);
      expect(item?.version).toBe(3);
    });
  });
});
