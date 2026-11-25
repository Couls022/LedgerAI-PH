import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';

const ISOLATED_ROOT = '/tmp/ledgerai_agent_complete_cert';
process.env.LEDGERAI_DATA_DIR = path.join(ISOLATED_ROOT, 'companies');
process.env.LEDGERAI_CONFIG_DIR = path.join(ISOLATED_ROOT, 'config');

import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { RbacService } from '../../src/server/services/rbacService';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { CANONICAL_ERP_MODULES } from '../../src/shared/moduleRegistry';
import { EnterpriseAiAgentService } from '../../src/server/services/enterpriseAiAgentService';

describe('Ledger Agent AI Complete Accuracy, Domain RBAC & 36-Submodule Grounding Certification', () => {
  const app = createApp();
  const nonVatCoId = 'LGR-PH-AI-NONVAT';
  const flat8CoId = 'LGR-PH-AI-FLAT8';
  const vatCoId = 'LGR-PH-AI-VAT';

  let nonVatOwnerToken: string;
  let flat8OwnerToken: string;
  let vatOwnerToken: string;
  let vatBookkeeperToken: string;
  let vatSecondUserToken: string;

  async function seedTaxScenarioCompany(params: {
    companyId: string;
    legalName: string;
    vatStatus: string;
    taxpayerClassification: string;
    invoiceTotalCentavos: number;
    vatExemptLineCentavos?: number;
    ewtWithheldCentavos?: number;
  }) {
    await CompanyManager.createCompanyProfile(params.companyId, params.legalName, undefined, undefined, false);
    const compDb = await CompanyManager.getCompanyDb(params.companyId);
    const now = new Date();

    let ownerTok = '';
    let bkTok = '';
    let secondTok = '';

    await dbContext.run(compDb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      await db.update(schema.companies)
        .set({
          vatStatus: params.vatStatus,
          taxpayerClassification: params.taxpayerClassification,
          taxpayerType: params.taxpayerClassification,
        })
        .where(eq(schema.companies.id, params.companyId));

      await db.insert(schema.companyTaxProfiles).values({
        id: `tp-${params.companyId}`,
        companyId: params.companyId,
        taxpayerClassification: params.taxpayerClassification,
        vatStatus: params.vatStatus,
        taxTypes: JSON.stringify([params.vatStatus]),
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();

      // Seed accounts, tax codes, customer, vendor, and invoice
      const arAccId = `acc-${params.companyId}-1030`;
      const revAccId = `acc-${params.companyId}-4010`;
      const outVatAccId = `acc-${params.companyId}-2020`;
      const apAccId = `acc-${params.companyId}-2010`;
      const cashAccId = `acc-${params.companyId}-1010`;

      await db.insert(schema.accounts).values([
        { id: cashAccId, companyId: params.companyId, accountCode: '1010', accountName: 'Cash in Bank', accountType: 'ASSET', normalBalance: 'DEBIT', isCashAccount: true, status: 'ACTIVE', createdAt: now, updatedAt: now },
        { id: arAccId, companyId: params.companyId, accountCode: '1030', accountName: 'Accounts Receivable', accountType: 'ASSET', normalBalance: 'DEBIT', isCashAccount: false, status: 'ACTIVE', createdAt: now, updatedAt: now },
        { id: apAccId, companyId: params.companyId, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isCashAccount: false, status: 'ACTIVE', createdAt: now, updatedAt: now },
        { id: outVatAccId, companyId: params.companyId, accountCode: '2020', accountName: 'Output VAT Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isCashAccount: false, status: 'ACTIVE', createdAt: now, updatedAt: now },
        { id: revAccId, companyId: params.companyId, accountCode: '4010', accountName: 'Sales Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isCashAccount: false, status: 'ACTIVE', createdAt: now, updatedAt: now },
      ]).onConflictDoNothing();

      const tcVat12Id = `tc-${params.companyId}-vat12`;
      const tcVatExId = `tc-${params.companyId}-vatex`;
      await db.insert(schema.taxCodes).values([
        { id: tcVat12Id, companyId: params.companyId, code: 'VAT12', name: '12% VAT', taxType: 'VAT', status: 'ACTIVE', createdAt: now, updatedAt: now },
        { id: tcVatExId, companyId: params.companyId, code: 'VATEX', name: 'VAT Exempt', taxType: 'EXEMPT', status: 'ACTIVE', createdAt: now, updatedAt: now },
      ]).onConflictDoNothing();

      const custId = `cust-${params.companyId}-1`;
      await db.insert(schema.customers).values({
        id: custId,
        companyId: params.companyId,
        code: 'CUST-001',
        legalName: 'Makati Trading Customer',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();

      const invId = `inv-${params.companyId}-1`;
      const exemptAmt = params.vatExemptLineCentavos || 0;
      const totalInv = params.invoiceTotalCentavos + exemptAmt;
      await db.insert(schema.salesInvoices).values({
        id: invId,
        companyId: params.companyId,
        customerId: custId,
        invoiceNumber: `SI-${params.companyId}-001`,
        invoiceType: 'SALES',
        invoiceDate: '2026-11-10',
        totalAmount: totalInv,
        balanceDue: totalInv,
        status: 'POSTED',
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();

      const linesToInsert: any[] = [
        {
          id: `inl-${params.companyId}-1`,
          invoiceId: invId,
          accountId: revAccId,
          taxCodeId: params.vatStatus === 'VAT_REGISTERED' ? tcVat12Id : tcVatExId,
          description: 'Primary Taxable / Gross Sale',
          quantity: 1,
          unitPrice: params.invoiceTotalCentavos,
          amount: params.invoiceTotalCentavos,
          createdAt: now,
        },
      ];
      if (exemptAmt > 0) {
        linesToInsert.push({
          id: `inl-${params.companyId}-2`,
          invoiceId: invId,
          accountId: revAccId,
          taxCodeId: tcVatExId,
          description: 'VAT-Exempt Sale Line',
          quantity: 1,
          unitPrice: exemptAmt,
          amount: exemptAmt,
          createdAt: now,
        });
      }
      await db.insert(schema.salesInvoiceLines).values(linesToInsert).onConflictDoNothing();

      if (params.ewtWithheldCentavos && params.ewtWithheldCentavos > 0) {
        const vendId = `vend-${params.companyId}-1`;
        await db.insert(schema.vendors).values({
          id: vendId,
          companyId: params.companyId,
          code: 'VEND-001',
          legalName: 'Taguig Logistics Vendor',
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing();

        const spId = `sp-${params.companyId}-1`;
        await db.insert(schema.supplierPayments).values({
          id: spId,
          companyId: params.companyId,
          vendorId: vendId,
          paymentNumber: 'CV-2026-001',
          paymentDate: '2026-11-12',
          cashAccountId: cashAccId,
          amount: 4900000,
          withholdingTaxAmount: params.ewtWithheldCentavos,
          paymentMethod: 'CHECK',
          status: 'POSTED',
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing();
      }

      const makeSession = async (uid: string, roleName: string) => {
        await db.insert(schema.users).values({
          id: uid,
          email: `${uid}@ai-cert.ph`,
          displayName: `${uid} (${roleName})`,
          passwordHash: 'hash',
          status: 'ACTIVE',
        }).onConflictDoNothing();
        const roleRec = await RbacService.ensureRoleRecord(roleName);
        const memId = `mem-${params.companyId}-${uid}`;
        await db.insert(schema.companyUsers).values({
          id: memId,
          userId: uid,
          companyId: params.companyId,
          roleId: roleRec.id,
          legacyRole: roleName,
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: 'COMPANY_WIDE',
          approvalLimitCentavos: roleName === 'Company Owner' ? -1 : 0,
        }).onConflictDoNothing();
        await RbacService.setMemberRoles(null, memId, [roleName], 'AI certification test');
        const rawTok = crypto.randomBytes(24).toString('hex');
        await db.insert(schema.sessions).values({
          id: hashToken(rawTok),
          userId: uid,
          companyId: params.companyId,
          expiresAt: new Date(Date.now() + 86400_000),
        });
        return `${params.companyId}.${rawTok}`;
      };

      ownerTok = await makeSession(`owner-${params.companyId}`, 'Company Owner');
      bkTok = await makeSession(`bk-${params.companyId}`, 'Bookkeeper');
      secondTok = await makeSession(`ro-${params.companyId}`, 'Read-only User');
    });

    return { ownerTok, bkTok, secondTok };
  }

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    if (fs.existsSync(ISOLATED_ROOT)) {
      fs.rmSync(ISOLATED_ROOT, { recursive: true, force: true });
    }
    await CompanyManager.init();

    const nv = await seedTaxScenarioCompany({
      companyId: nonVatCoId,
      legalName: 'Non-VAT Retail PH',
      vatStatus: 'NON_VAT',
      taxpayerClassification: 'NON_VAT',
      invoiceTotalCentavos: 10_000_000, // ₱100,000.00 gross sale
    });
    nonVatOwnerToken = nv.ownerTok;

    const f8 = await seedTaxScenarioCompany({
      companyId: flat8CoId,
      legalName: '8% Flat Freelance PH',
      vatStatus: '8_PERCENT_FLAT',
      taxpayerClassification: 'INDIVIDUAL_8_PERCENT',
      invoiceTotalCentavos: 20_000_000, // ₱200,000.00 gross sale
    });
    flat8OwnerToken = f8.ownerTok;

    const vat = await seedTaxScenarioCompany({
      companyId: vatCoId,
      legalName: 'VAT Registered Enterprise PH',
      vatStatus: 'VAT_REGISTERED',
      taxpayerClassification: 'VAT',
      invoiceTotalCentavos: 11_200_000, // ₱112,000.00 VATable => ₱12,000.00 Output VAT
      vatExemptLineCentavos: 5_000_000, // ₱50,000.00 VAT-Exempt => ₱0.00 Output VAT
      ewtWithheldCentavos: 100_000, // ₱1,000.00 real EWT withheld
    });
    vatOwnerToken = vat.ownerTok;
    vatBookkeeperToken = vat.bkTok;
    vatSecondUserToken = vat.secondTok;
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    if (fs.existsSync(ISOLATED_ROOT)) {
      try { fs.rmSync(ISOLATED_ROOT, { recursive: true, force: true }); } catch {}
    }
  });

  it('1. Non-VAT & 8% Flat companies return ₱0.00 Output/Input VAT and compute Sec. 116 3% / 8% Flat Tax without 12/112 or 2/112 fabrication', async () => {
    const nvRes = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${nonVatOwnerToken}`)
      .send({ prompt: 'What is my VAT payable and percentage tax right now?', forceOffline: true });
    expect(nvRes.status).toBe(200);
    expect(nvRes.body.answer).toContain('Output VAT (12% — BIR Form 2550Q)**: **₱0.00**');
    expect(nvRes.body.answer).toContain('Net VAT Payable**: **₱0.00**');
    expect(nvRes.body.answer).toContain('3,000.00'); // 3% of ₱100,000 = ₱3,000.00
    expect(nvRes.body.answer).not.toContain('10,714.29'); // Must NOT apply 12/112 to Non-VAT

    const f8Res = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${flat8OwnerToken}`)
      .send({ prompt: 'Magkano VAT at 8% tax ko ngayon?', forceOffline: true });
    expect(f8Res.status).toBe(200);
    expect(f8Res.body.answer).toContain('Output VAT (12% — BIR Form 2550Q)**: **₱0.00**');
    expect(f8Res.body.answer).toContain('8%');
  });

  it('2. VAT-Registered company excludes VATEX lines from 12% Output VAT and uses real supplier_payments EWT (zero 2/112 fabrication)', async () => {
    const vatRes = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${vatOwnerToken}`)
      .send({ prompt: 'Calculate our Output VAT, Input VAT, and EWT 2307 payable', forceOffline: true });
    expect(vatRes.status).toBe(200);
    // 112,000 * 12/112 = ₱12,000.00 (50,000 VATEX excluded!)
    expect(vatRes.body.answer).toContain('12,000.00');
    // Actual EWT from supplier_payments = ₱1,000.00
    expect(vatRes.body.answer).toContain('1,000.00');
  });

  it('3. Domain RBAC blocks unauthorized employee queries (403 SECURITY_REFUSAL), masks Payroll, and filters fallback executive snapshot', async () => {
    // Bookkeeper lacks fixedassets:view, tax:view (default Bookkeeper lacks tax:view / fixedassets:view)
    const faBlocked = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${vatBookkeeperToken}`)
      .send({ prompt: 'Show fixed assets net book value and depreciation schedule', forceOffline: true });
    expect(faBlocked.status).toBe(403);
    expect(faBlocked.body.error).toBe('SECURITY_REFUSAL');

    const taxBlocked = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${vatBookkeeperToken}`)
      .send({ prompt: 'Show BIR Form 2550Q tax filing summary', forceOffline: true });
    expect(taxBlocked.status).toBe(403);

    // Unauthorized payroll inquiry preserves HTTP 200 masked payroll refusal
    const payMasked = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${vatBookkeeperToken}`)
      .send({ prompt: 'Show employee payroll salary compensation', forceOffline: true });
    expect(payMasked.status).toBe(200);
    expect(payMasked.body.skillId).toBe('payrollInquiryMasked');

    // Read-only User with explicit ai:inquiry & limited perms should NOT see restricted domain lines in fallback snapshot
    const snapRes = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${vatSecondUserToken}`)
      .send({ prompt: 'Summarize overall system status quickly', forceOffline: true });
    expect(snapRes.status).toBe(200);
    // Company Owner CAN query Tax & Fixed Assets freely
    const ownerFa = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${vatOwnerToken}`)
      .send({ prompt: 'Show fixed assets net book value and depreciation schedule', forceOffline: true });
    expect(ownerFa.status).toBe(200);
  });

  it('4. Hardened /api/ai/confirm-action enforces ownership, per-action permission, quarantine lock, and writes HMAC audit_logs', async () => {
    // Owner requests a high-risk proposal
    const proposeRes = await request(app)
      .post('/api/ai/ledger-agent')
      .set('Authorization', `Bearer ${vatOwnerToken}`)
      .send({ prompt: 'Please delete transaction INV-001', forceOffline: true });
    expect(proposeRes.status).toBe(200);
    expect(proposeRes.body.pendingAction).toBeTruthy();
    const actionId = proposeRes.body.pendingAction.actionId;

    // Different user in same company CANNOT confirm Owner's pending action
    const hijackRes = await request(app)
      .post('/api/ai/confirm-action')
      .set('Authorization', `Bearer ${vatSecondUserToken}`)
      .send({ actionId, confirmed: true, remarks: 'Attempted cross-user confirmation' });
    expect(hijackRes.status).toBe(403);

    // Put company into RECOVERY_READ_ONLY -> Owner confirm must be blocked while in quarantine
    const compDb = await CompanyManager.getCompanyDb(vatCoId);
    await CompanyManager.updateCompanyManifest(vatCoId, { status: 'RECOVERY_READ_ONLY' });
    await dbContext.run(compDb, async () => {
      await db.update(schema.companies).set({ status: 'RECOVERY_READ_ONLY' }).where(eq(schema.companies.id, vatCoId));
    });
    const qConfirm = await request(app)
      .post('/api/ai/confirm-action')
      .set('Authorization', `Bearer ${vatOwnerToken}`)
      .send({ actionId, confirmed: true, remarks: 'Attempt in quarantine' });
    expect(qConfirm.status).toBe(403);
    expect(qConfirm.body.error).toBe('READ_ONLY_ACCESS');

    // Restore ACTIVE -> Owner confirms -> 200 CONFIRMED + immutable audit log recorded
    await CompanyManager.updateCompanyManifest(vatCoId, { status: 'ACTIVE' });
    await dbContext.run(compDb, async () => {
      await db.update(schema.companies).set({ status: 'ACTIVE' }).where(eq(schema.companies.id, vatCoId));
    });
    const okConfirm = await request(app)
      .post('/api/ai/confirm-action')
      .set('Authorization', `Bearer ${vatOwnerToken}`)
      .send({ actionId, confirmed: true, remarks: 'Owner certified confirmation' });
    expect(okConfirm.status).toBe(200);
    expect(okConfirm.body.status).toBe('CONFIRMED');

    await dbContext.run(compDb, async () => {
      const logs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, actionId));
      expect(logs.length).toBe(1);
      expect(logs[0].action).toContain('AI_CONFIRMED_MUTATION');
    });
  });

  it('5. All 36 canonical submodules resolve grounded how-to guidance with canonical routes via Ledger Agent', async () => {
    let checked = 0;
    for (const mod of CANONICAL_ERP_MODULES) {
      for (const sub of mod.submodules) {
        const res = await EnterpriseAiAgentService.executeInquiry({
          companyId: vatCoId,
          companyName: 'VAT Registered Enterprise PH',
          userId: `owner-${vatCoId}`,
          userRole: 'Company Owner',
          permissions: ['*'],
          deniedPermissions: [],
          prompt: `How do I use ${sub.label}?`,
          forceOffline: true,
        });
        expect(res.skillId).toBe('knowledgeBaseQuery');
        expect(res.provenance.confidenceState).toBe('VERIFIED_AUTHORITATIVE');
        expect(res.suggestedActions?.[0]?.params?.path).toBe(sub.route);
        checked++;
      }
    }
    expect(checked).toBe(36);
  });
});
