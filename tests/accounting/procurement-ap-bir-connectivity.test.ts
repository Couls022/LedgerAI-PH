import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import request from 'supertest';

const { tempRoot } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('node:path');
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'ledgerai-proc-ap-bir-'));
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
import * as schema from '../../src/server/db/schema';
import { eq, and } from 'drizzle-orm';

const COMP_ID = 'LGR-PH-PROC-AP-BIR-01';

describe('DEF-PROC-AP-LINK-001: Procurement ↔ GRN ↔ 3-Way Match ↔ Purchase Bills ↔ GL & BIR Tax Connectivity', () => {
  const app = createApp();
  const ownerId = 'usr-proc-owner';
  let ownerToken = '';
  let vendorId = '';
  let cashAccountId = '';
  let inputVatAccountId = '';
  let apAccountId = '';
  let expenseAccountId = '';
  let companyDb: any;
  let sqlite: any;

  beforeAll(async () => {
    await CompanyManager.createCompanyProfile(COMP_ID, 'Bayanihan Industrial Supply Corp.', undefined, undefined, false, {
      classification: 'TEST',
    });
    sqlite = await CompanyManager.getCompanySqlite(COMP_ID);
    companyDb = await CompanyManager.getCompanyDb(COMP_ID);
    const now = Date.now();

    sqlite.exec(`
      INSERT OR REPLACE INTO companies (id, legal_name, tin, vat_status, taxpayer_classification, currency, status, classification)
      VALUES ('${COMP_ID}', 'Bayanihan Industrial Supply Corp.', '009-123-456-000', 'VAT', 'CORPORATION', 'PHP', 'ACTIVE', 'TEST');
    `);

    await dbContext.run(companyDb as any, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      await AccountingEngine.ensureDefaultAccounts(COMP_ID);

      // Open FY 2026 period
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO accounting_periods (id, company_id, name, start_date, end_date, fiscal_year, status, created_at, updated_at)
           VALUES (?, ?, 'FY 2026', '2026-01-01', '2026-12-31', 2026, 'OPEN', ?, ?)`
        )
        .run(`per-${COMP_ID}-2026`, COMP_ID, now, now);

      // Seed active BIR 12% Input VAT Rule Definition, Version (0.12), and Tax Code (NIRC Sec. 110)
      const vatRuleDefId = `trd-vat-in-12-${COMP_ID}`;
      await companyDb.insert(schema.taxRuleDefinitions).values({
        id: vatRuleDefId,
        ruleCode: 'PH_VAT_INPUT_12',
        ruleName: 'Philippine 12% Creditable Input VAT',
        taxType: 'VAT',
        description: 'NIRC Sec. 110 Creditable Input VAT on domestic purchases',
        status: 'ACTIVE',
      });
      await companyDb.insert(schema.taxRuleVersions).values({
        id: `trv-vat-in-12-${COMP_ID}`,
        ruleDefinitionId: vatRuleDefId,
        version: 1,
        effectiveFrom: '2018-01-01',
        calculationMethod: 'PERCENTAGE',
        rateValue: 0.12,
        sourceReference: 'NIRC Sec. 110 / RA 10963 / RA 11976',
        status: 'ACTIVE',
      });
      await companyDb.insert(schema.taxCodes).values({
        id: `tc-vat-in-12-${COMP_ID}`,
        companyId: COMP_ID,
        code: 'VAT-IN-12',
        name: '12% Creditable Input VAT',
        taxType: 'VAT',
        description: 'BIR NIRC Sec. 110 12% Creditable Input VAT on Purchases',
        inputOutputDirection: 'INPUT',
        ruleDefinitionId: vatRuleDefId,
        status: 'ACTIVE',
      });

      // Owner user + session
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
           VALUES (?, 'owner@bayanihan.ph', 'hash', 'Owner Bayanihan', 'ACTIVE', 1, ?, ?)`
        )
        .run(ownerId, now, now);

      const cuId = `cu-${COMP_ID}-${ownerId}`;
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO company_users (id, user_id, company_id, legacy_role, status, membership_status, default_data_scope, approval_limit_centavos, created_at, updated_at)
           VALUES (?, ?, ?, 'Company Owner', 'ACTIVE', 'ACTIVE', 'COMPANY_WIDE', 100000000, ?, ?)`
        )
        .run(cuId, ownerId, COMP_ID, now, now);
      await RbacService.setMemberRoles(null, cuId, ['Company Owner'] as any, 'Test setup');

      const rawToken = crypto.randomBytes(32).toString('hex');
      sqlite
        .prepare(`INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`)
        .run(hashToken(rawToken), ownerId, now + 86400000, now);
      ownerToken = `${COMP_ID}.${rawToken}`;

      // Resolve key COA accounts
      const accounts = await companyDb.select().from(schema.accounts).where(eq(schema.accounts.companyId, COMP_ID));
      cashAccountId = accounts.find((a: any) => a.accountCode === '1010' || a.accountCode === '1020')?.id;
      inputVatAccountId = accounts.find((a: any) => a.accountCode === '1120' || /input vat/i.test(a.accountName))?.id;
      apAccountId = accounts.find((a: any) => a.accountCode === '2010' || /accounts payable/i.test(a.accountName))?.id;
      expenseAccountId = accounts.find((a: any) => String(a.accountType).toUpperCase() === 'EXPENSE')?.id;

      // Seed VAT-registered Supplier
      vendorId = crypto.randomUUID();
      await companyDb.insert(schema.vendors).values({
        id: vendorId,
        companyId: COMP_ID,
        code: 'VEND-PH-001',
        legalName: 'Archipelago Hardware Trading Corp.',
        tin: '201-211-217-000',
        taxClassification: 'VAT',
        defaultExpenseAccountId: expenseAccountId,
        status: 'ACTIVE',
      });
    });
  });

  afterAll(async () => {
    try {
      await CompanyManager.closeCompanyDb(COMP_ID);
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('enforces full bidirectional PO -> GRN -> 3-Way Match -> 12% Input VAT GL Posting -> Form 2307 DV Payment parity', async () => {
    const authHeader = `Bearer ${ownerToken}`;

    // 1. Issue two POs: PO-A (₱11,200.00 VAT-inclusive -> full flow) and PO-B (₱5,600.00 -> legacy COMPLETED GRN verification)
    const createPoA = await request(app)
      .post('/api/operations/procurement/purchase-orders')
      .set('Authorization', authHeader)
      .send({
        poNumber: 'PO-2026-90001',
        vendorId,
        orderDate: '2026-11-19',
        expectedTotal: 11200,
        items: [{ description: 'Industrial Safety Switches', quantity: 1, unitPrice: 11200 }],
      });
    expect(createPoA.status).toBe(200);
    const poAId = createPoA.body.poId;

    const createPoB = await request(app)
      .post('/api/operations/procurement/purchase-orders')
      .set('Authorization', authHeader)
      .send({
        poNumber: 'PO-2026-90002',
        vendorId,
        orderDate: '2026-11-19',
        expectedTotal: 5600,
        items: [{ description: 'Warehouse Shelving', quantity: 1, unitPrice: 5600 }],
      });
    expect(createPoB.status).toBe(200);
    const poBId = createPoB.body.poId;

    // Seed a COMPLETED GRN on PO-B to verify legacy COMPLETED GRN status maps to GRN_RECEIVED (not PARTIALLY_RECEIVED)
    await dbContext.run(companyDb as any, async () => {
      await companyDb.insert(schema.goodsReceiptNotes).values({
        id: crypto.randomUUID(),
        companyId: COMP_ID,
        poId: poBId,
        grnNumber: 'GRN-PO-2026-90002',
        receiptDate: '2026-11-19',
        status: 'COMPLETED',
        receivedBy: ownerId,
      });
    });

    // Verify initial KPI mutual exclusivity before GRN/match on PO-A
    const listBefore = await request(app)
      .get('/api/operations/procurement/purchase-orders')
      .set('Authorization', authHeader);
    expect(listBefore.status).toBe(200);
    expect(listBefore.body.summary.totalPoCount).toBe(2);
    expect(listBefore.body.summary.pendingMatchCount).toBe(2);
    expect(listBefore.body.summary.matchedAndBilledCount).toBe(0);
    expect(listBefore.body.summary.readyForMatchCount).toBe(1); // PO-B with COMPLETED GRN
    expect(listBefore.body.summary.pendingGrnCount).toBe(1); // PO-A awaiting GRN
    const poBRow = listBefore.body.items.find((p: any) => p.id === poBId);
    expect(poBRow.grnStatus).toBe('GRN_RECEIVED');
    expect(poBRow.matchStatus).toBe('READY_FOR_MATCH');

    // 2. Record GRN explicitly on PO-A via /receive
    const receiveRes = await request(app)
      .post(`/api/operations/procurement/purchase-orders/${poAId}/receive`)
      .set('Authorization', authHeader)
      .send({ deliveryNoteNo: 'DR-90001' });
    expect(receiveRes.status).toBe(200);
    expect(receiveRes.body.grnNumber).toBe('GRN-PO-2026-90001');

    // 3. Reject 3-Way Match when discrepancy > 2.0% tolerance
    const failMatch = await request(app)
      .post('/api/operations/procurement/3-way-match')
      .set('Authorization', authHeader)
      .send({
        poId: poAId,
        poNumber: 'PO-2026-90001',
        vendorInvoiceNumber: 'BILL-PO-2026-90001',
        poAmount: 11200,
        grnAmount: 11200,
        vendorInvoiceAmount: 12000, // 7.14% variance > 2.0%
        receivedQuantity: 1,
        billedQuantity: 1,
        autoCreateBill: true,
        vatOption: 'VAT_12_INCLUSIVE',
        atcCode: 'WC158',
      });
    expect(failMatch.status).toBe(200);
    expect(failMatch.body.matched).toBe(false);
    expect(failMatch.body.generatedBillId).toBeNull();

    // 4. Pass 3-Way Match with BIR 12% Input VAT + Official Form 2307 ATC WC158
    const passMatch = await request(app)
      .post('/api/operations/procurement/3-way-match')
      .set('Authorization', authHeader)
      .send({
        poId: poAId,
        poNumber: 'PO-2026-90001',
        vendorInvoiceNumber: 'BILL-PO-2026-90001',
        poAmount: 11200,
        grnAmount: 11200,
        vendorInvoiceAmount: 11200,
        receivedQuantity: 1,
        billedQuantity: 1,
        autoCreateBill: true,
        vatOption: 'VAT_12_INCLUSIVE',
        atcCode: 'WC158',
      });
    expect(passMatch.status).toBe(200);
    expect(passMatch.body.matched).toBe(true);
    expect(passMatch.body.alreadyMatched).toBe(false);
    expect(passMatch.body.generatedBillNumber).toBe('BILL-PO-2026-90001');
    expect(passMatch.body.generatedBillStatus).toBe('APPROVED');
    const billId = passMatch.body.generatedBillId;
    expect(billId).toBeTruthy();

    // 5. Idempotency: re-running 3-Way Match must NOT duplicate the bill
    const dupMatch = await request(app)
      .post('/api/operations/procurement/3-way-match')
      .set('Authorization', authHeader)
      .send({
        poId: poAId,
        poNumber: 'PO-2026-90001',
        vendorInvoiceNumber: 'BILL-PO-2026-90001',
        poAmount: 11200,
        grnAmount: 11200,
        vendorInvoiceAmount: 11200,
        receivedQuantity: 1,
        billedQuantity: 1,
        autoCreateBill: true,
        vatOption: 'VAT_12_INCLUSIVE',
        atcCode: 'WC158',
      });
    expect(dupMatch.status).toBe(200);
    expect(dupMatch.body.alreadyMatched).toBe(true);
    expect(dupMatch.body.generatedBillId).toBe(billId);

    // 6. Verify Procurement API shows exact mutually exclusive counts & APPROVED pending GL state
    const procAfterMatch = await request(app)
      .get('/api/operations/procurement/purchase-orders')
      .set('Authorization', authHeader);
    expect(procAfterMatch.body.summary.pendingMatchCount).toBe(1);
    expect(procAfterMatch.body.summary.matchedAndBilledCount).toBe(1);
    expect(procAfterMatch.body.summary.pendingGlPostingBillCount).toBe(1);
    expect(procAfterMatch.body.summary.pendingGlPostingCentavos).toBe(1120000);
    const poARow = procAfterMatch.body.items.find((p: any) => p.id === poAId);
    expect(poARow.linkedBillId).toBe(billId);
    expect(poARow.linkedBillStatus).toBe('APPROVED');
    expect(poARow.apRecognitionState).toBe('PENDING_GL_POSTING');

    // 7. Verify Purchase Bills API exposes bidirectional PO + GRN link and unposted APPROVED count
    const billsBeforePost = await request(app)
      .get('/api/accounting/purchase-bills')
      .set('Authorization', authHeader);
    expect(billsBeforePost.status).toBe(200);
    expect(billsBeforePost.body.summary.totalApOutstanding).toBe(0);
    expect(billsBeforePost.body.summary.unpostedApprovedCount).toBe(1);
    expect(billsBeforePost.body.summary.unpostedApprovedCentavos).toBe(1120000);
    expect(billsBeforePost.body.summary.isGlReconciled).toBe(true);
    const linkedBillRow = (billsBeforePost.body.data || billsBeforePost.body.items).find((b: any) => b.id === billId);
    expect(linkedBillRow.linkedPoId).toBe(poAId);
    expect(linkedBillRow.linkedPoNumber).toBe('PO-2026-90001');
    expect(linkedBillRow.linkedGrnNumber).toBe('GRN-PO-2026-90001');
    expect(linkedBillRow.isThreeWayMatched).toBe(true);

    // 8. Double-entry guard: Paying an unposted APPROVED bill must be rejected (400 BILL_NOT_POSTED)
    const unpostedPayRes = await request(app)
      .post(`/api/accounting/purchase-bills/${billId}/pay`)
      .set('Authorization', authHeader)
      .send({
        paymentNumber: 'DV-BLOCKED-001',
        paymentDate: '2026-11-19',
        amountCentavos: 1110000,
        withholdingTaxAmount: 10000,
        atcCode: 'WC158',
        cashAccountId,
        paymentMethod: 'BANK_TRANSFER',
        autoPost: true,
      });
    expect(unpostedPayRes.status).toBe(400);
    expect(unpostedPayRes.body.error).toBe('BILL_NOT_POSTED');

    // 9. Post Purchase Bill to General Ledger -> verifies NIRC Sec. 110 12% Input VAT split
    const postBillRes = await request(app)
      .post(`/api/accounting/purchase-bills/${billId}/post`)
      .set('Authorization', authHeader)
      .send({});
    expect(postBillRes.status).toBe(200);

    // Inspect generated Journal Entry lines directly in DB:
    // Dr Expense ₱10,000.00 (1,000,000) + Dr 1120 Input VAT ₱1,200.00 (120,000) / Cr 2010 AP ₱11,200.00 (1,120,000)
    await dbContext.run(companyDb as any, async () => {
      const jeRows = await companyDb
        .select()
        .from(schema.journalEntries)
        .where(and(eq(schema.journalEntries.companyId, COMP_ID), eq(schema.journalEntries.status, 'POSTED')));
      expect(jeRows.length).toBeGreaterThanOrEqual(1);
      const billJe = jeRows.find((j: any) => String(j.reference || '').includes('BILL-PO-2026-90001')) || jeRows[0];
      const lines = await companyDb
        .select()
        .from(schema.journalLines)
        .where(eq(schema.journalLines.journalEntryId, billJe.id));

      const totalDr = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      const totalCr = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
      expect(totalDr).toBe(1120000);
      expect(totalCr).toBe(1120000);

      const inputVatLine = lines.find((l: any) => l.accountId === inputVatAccountId);
      const apLine = lines.find((l: any) => l.accountId === apAccountId);
      expect(Number(inputVatLine?.debit || 0)).toBe(120000); // Exact 12% Input VAT
      expect(Number(apLine?.credit || 0)).toBe(1120000); // Exact Gross AP Liability
    });

    // Verify both Purchase Bills API and Procurement API agree on GL 2010 AP balance = ₱11,200.00
    const billsAfterPost = await request(app)
      .get('/api/accounting/purchase-bills')
      .set('Authorization', authHeader);
    expect(billsAfterPost.body.summary.totalApOutstanding).toBe(1120000);
    expect(billsAfterPost.body.summary.glApBalance).toBe(1120000);
    expect(billsAfterPost.body.summary.isGlReconciled).toBe(true);
    expect(billsAfterPost.body.summary.unpostedApprovedCount).toBe(0);

    const procAfterPost = await request(app)
      .get('/api/operations/procurement/purchase-orders')
      .set('Authorization', authHeader);
    expect(procAfterPost.body.summary.postedApBillCount).toBe(1);
    expect(procAfterPost.body.summary.totalCompanyApOutstandingCentavos).toBe(1120000);
    expect(procAfterPost.body.summary.glAp2010BalanceCentavos).toBe(1120000);
    expect(procAfterPost.body.summary.isGlReconciled).toBe(true);

    // 10. Pay Posted Bill via Supplier Disbursement Voucher with BIR Form 2307 EWT (WC158 1% of ₱10,000 base = ₱100.00)
    const payRes = await request(app)
      .post(`/api/accounting/purchase-bills/${billId}/pay`)
      .set('Authorization', authHeader)
      .send({
        paymentNumber: 'DV-2026-90001',
        paymentDate: '2026-11-19',
        amountCentavos: 1110000, // Net cash ₱11,100.00
        withholdingTaxAmount: 10000, // Form 2307 EWT ₱100.00 (1% of ₱10,000 net-of-VAT base)
        atcCode: 'WC158',
        cashAccountId,
        paymentMethod: 'BANK_TRANSFER',
        reference: 'BPI-90001',
        notes: 'Full supplier settlement',
        autoPost: true,
      });
    expect(payRes.status).toBe(200);

    // Verify final PAID state & ₱0.00 AP / GL 2010 parity across BOTH modules
    const billsAfterPay = await request(app)
      .get('/api/accounting/purchase-bills')
      .set('Authorization', authHeader);
    expect(billsAfterPay.body.summary.totalApOutstanding).toBe(0);
    expect(billsAfterPay.body.summary.glApBalance).toBe(0);
    expect(billsAfterPay.body.summary.isGlReconciled).toBe(true);
    expect((billsAfterPay.body.data || billsAfterPay.body.items).find((b: any) => b.id === billId)?.status).toBe('PAID');

    const procAfterPay = await request(app)
      .get('/api/operations/procurement/purchase-orders')
      .set('Authorization', authHeader);
    expect(procAfterPay.body.summary.paidBillCount).toBe(1);
    expect(procAfterPay.body.summary.postedApBillCount).toBe(0);
    expect(procAfterPay.body.summary.isGlReconciled).toBe(true);
    const poAFinal = procAfterPay.body.items.find((p: any) => p.id === poAId);
    expect(poAFinal.linkedBillStatus).toBe('PAID');
    expect(poAFinal.apRecognitionState).toBe('PAID');
    expect(poAFinal.linkedBillBalanceDueCentavos).toBe(0);
  });
});
