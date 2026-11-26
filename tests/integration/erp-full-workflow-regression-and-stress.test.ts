import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { eq, and, sql } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import { AccountingEngine } from '../../src/server/services/accountingEngine';
import {
  createJournalEntry,
  submitJournalEntry,
  approveJournalEntry,
  postJournalEntry,
} from '../../src/server/db/domain';
import {
  createSalesInvoice,
  submitSalesInvoice,
  approveSalesInvoice,
  postSalesInvoice,
  createPurchaseBill,
  submitPurchaseBill,
  approvePurchaseBill,
  postPurchaseBill,
  createCustomerPayment,
  createSupplierPayment,
  createCashTransaction,
  submitCashTransaction,
  approveCashTransaction,
  postCashTransaction,
  createBankDeposit,
} from '../../src/server/db/business_transactions';
import { RecurringJournalService } from '../../src/server/services/recurringJournalService';
import { BankReconciliationService } from '../../src/server/services/bankReconciliationService';
import { filterPostableLeafAccounts } from '../../src/shared/coaAccountUtils';
import { validateModuleRegistry, validateFunctionalDestinations } from '../../src/shared/moduleRegistry';

describe('LEDGERAI PH — FULL ERP WORKFLOW REGRESSION, HARDENING & STRESS VERIFICATION', () => {
  const app = createApp();
  const COMP_ID = 'LGR-PH-2026-TEST-AUDIT-01';
  const FOREIGN_COMP_ID = 'LGR-PH-2026-TEST-AUDIT-FOREIGN';

  const OWNER_ID = 'usr-audit-owner';
  const BOOKKEEPER_ID = 'usr-audit-bookkeeper';
  const APPROVER_ID = 'usr-audit-approver';

  let ownerToken = '';
  let bookkeeperToken = '';
  let approverToken = '';

  const PER_JAN = 'per-audit-2026-01';
  const PER_FEB = 'per-audit-2026-02';
  const PER_MAR = 'per-audit-2026-03';
  const PER_JUN = 'per-audit-2026-06'; // Intentionally omit 2026-04 to test strict period match without arbitrary fallback
  const PER_MAY = 'per-audit-2026-05';

  const ACC_HEADER_ASSET = 'acc-audit-1000';
  const ACC_CASH_PHP = 'acc-audit-1010';
  const ACC_CASH_USD = 'acc-audit-1012';
  const ACC_AR = 'acc-audit-1030';
  const ACC_AP = 'acc-audit-2010';
  const ACC_REV = 'acc-audit-4010';
  const ACC_EXP = 'acc-audit-6010';

  const CUST_ID = 'cust-audit-1';
  const VEND_ID = 'vend-audit-1';

  let companyDb: any;
  let companySqlite: any;

  async function runInCompany<T>(fn: () => Promise<T>): Promise<T> {
    return dbContext.run(companyDb, fn);
  }

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);
    await CompanyManager.resetDisposableTestCompanyWorkspace(FOREIGN_COMP_ID);

    await CompanyManager.createCompanyProfile(
      FOREIGN_COMP_ID,
      'Foreign Tenant Audit Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    await CompanyManager.createCompanyProfile(
      COMP_ID,
      'ERP Full Audit Synthetic Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    companyDb = await CompanyManager.getCompanyDb(COMP_ID);
    companySqlite = await CompanyManager.getCompanySqlite(COMP_ID);

    companySqlite.prepare('DELETE FROM accounting_periods WHERE company_id = ?').run(COMP_ID);
    companySqlite.prepare('DELETE FROM accounts WHERE company_id = ?').run(COMP_ID);

    await runInCompany(async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      const seedUser = async (uid: string, email: string, name: string, roleName: string) => {
        await db
          .insert(schema.users)
          .values({
            id: uid,
            email,
            displayName: name,
            passwordHash: 'test_hash',
            status: 'ACTIVE',
          })
          .onConflictDoNothing();

        const roleRec = await RbacService.ensureRoleRecord(roleName);
        const memId = `mem-${uid}`;
        await db
          .insert(schema.companyUsers)
          .values({
            id: memId,
            userId: uid,
            companyId: COMP_ID,
            roleId: roleRec.id,
            legacyRole: roleName,
            status: 'ACTIVE',
            membershipStatus: 'ACTIVE',
            defaultDataScope: 'COMPANY_WIDE',
            approvalLimitCentavos: 500_000_000_00,
          })
          .onConflictDoNothing();

        await RbacService.setMemberRoles(null, memId, [roleName], `Seed ${roleName}`);

        const rawSession = crypto.randomBytes(32).toString('hex');
        await db.insert(schema.sessions).values({
          id: hashToken(rawSession),
          userId: uid,
          companyId: COMP_ID,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        return `${COMP_ID}.${rawSession}`;
      };

      ownerToken = await seedUser(OWNER_ID, 'owner@fullaudit.ph', 'Full Audit Owner', 'Company Owner');
      bookkeeperToken = await seedUser(BOOKKEEPER_ID, 'bk@fullaudit.ph', 'Full Audit Bookkeeper', 'Bookkeeper');
      approverToken = await seedUser(APPROVER_ID, 'approver@fullaudit.ph', 'Full Audit Approver', 'Approver');

      // Also grant approval permissions cleanly if Approver template lacks any route-level permission
      await db.insert(schema.accountingPeriods).values([
        { id: PER_JAN, companyId: COMP_ID, name: '2026-01', startDate: '2026-01-01', endDate: '2026-01-31', fiscalYear: 2026, status: 'OPEN', version: 1 },
        { id: PER_FEB, companyId: COMP_ID, name: '2026-02', startDate: '2026-02-01', endDate: '2026-02-28', fiscalYear: 2026, status: 'OPEN', version: 1 },
        { id: PER_MAR, companyId: COMP_ID, name: '2026-03', startDate: '2026-03-01', endDate: '2026-03-31', fiscalYear: 2026, status: 'OPEN', version: 1 },
        // Deliberately skip 2026-04 to test strict period match
        { id: PER_MAY, companyId: COMP_ID, name: '2026-05', startDate: '2026-05-01', endDate: '2026-05-31', fiscalYear: 2026, status: 'OPEN', version: 1 },
        { id: PER_JUN, companyId: COMP_ID, name: '2026-06', startDate: '2026-06-01', endDate: '2026-06-30', fiscalYear: 2026, status: 'OPEN', version: 1 },
        { id: 'per-audit-2026-11', companyId: COMP_ID, name: '2026-11', startDate: '2026-11-01', endDate: '2026-11-30', fiscalYear: 2026, status: 'OPEN', version: 1 },
      ]);

      await db.insert(schema.accounts).values([
        { id: ACC_HEADER_ASSET, companyId: COMP_ID, accountCode: '1000', accountName: 'Assets (Header)', accountType: 'ASSET', normalBalance: 'DEBIT', isControlAccount: false, status: 'ACTIVE' },
        { id: ACC_CASH_PHP, companyId: COMP_ID, accountCode: '1010', accountName: 'Cash in Bank - BDO PHP', accountType: 'ASSET', normalBalance: 'DEBIT', parentAccountId: ACC_HEADER_ASSET, isCashAccount: true, currency: 'PHP', status: 'ACTIVE' },
        { id: ACC_CASH_USD, companyId: COMP_ID, accountCode: '1012', accountName: 'Cash in Bank - Metrobank USD FCDU', accountType: 'ASSET', normalBalance: 'DEBIT', parentAccountId: ACC_HEADER_ASSET, isCashAccount: true, currency: 'USD', status: 'ACTIVE' },
        { id: ACC_AR, companyId: COMP_ID, accountCode: '1030', accountName: 'Accounts Receivable', accountType: 'RECEIVABLE', normalBalance: 'DEBIT', parentAccountId: ACC_HEADER_ASSET, isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_AP, companyId: COMP_ID, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'PAYABLE', normalBalance: 'CREDIT', isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_REV, companyId: COMP_ID, accountCode: '4010', accountName: 'Service Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_EXP, companyId: COMP_ID, accountCode: '6010', accountName: 'Operating Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
      ]);

      await AccountingEngine.ensureDefaultAccounts(COMP_ID);

      await db.insert(schema.customers).values({
        id: CUST_ID,
        companyId: COMP_ID,
        code: 'CUST-FA-01',
        legalName: 'Philippine Enterprise Client Corp.',
        defaultReceivableAccountId: ACC_AR,
        status: 'ACTIVE',
      });

      await db.insert(schema.vendors).values({
        id: VEND_ID,
        companyId: COMP_ID,
        code: 'VEND-FA-01',
        legalName: 'Archipelago Security Supplier Inc.',
        defaultPayableAccountId: ACC_AP,
        status: 'ACTIVE',
      });
    });
  }, 60_000);

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);
    await CompanyManager.resetDisposableTestCompanyWorkspace(FOREIGN_COMP_ID);
  }, 30_000);

  it('1. Enforces state transitions: UNDER_REVIEW -> direct approve, RETURNED/REJECTED -> resubmit -> approve -> idempotent GL post', async () => {
    // 1A: Sales invoice moved to UNDER_REVIEW + active workflow sync on direct approve
    let siId = '';
    await runInCompany(async () => {
      siId = await createSalesInvoice(
        COMP_ID,
        {
          invoiceNumber: 'SI-FA-0001',
          customerId: CUST_ID,
          invoiceDate: '2026-02-10',
          dueDate: '2026-03-10',
          totalAmount: 100_000,
          lines: [{ description: 'Audit Consulting', quantity: 1, unitPrice: 100_000, amount: 100_000, accountId: ACC_REV }],
        },
        BOOKKEEPER_ID,
        'Bookkeeper'
      );
      await db.update(schema.salesInvoices).set({ status: 'UNDER_REVIEW' }).where(eq(schema.salesInvoices.id, siId));
    });

    const approveSiRes = await request(app)
      .post(`/api/accounting/sales-invoices/${siId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(approveSiRes.status).toBe(200);
    expect(approveSiRes.body.status).toBe('APPROVED');

    const postSiRes = await request(app)
      .post(`/api/accounting/sales-invoices/${siId}/post`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(postSiRes.status).toBe(200);
    expect(postSiRes.body.status).toBe('POSTED');

    // Second post must be idempotent (no duplicate JE)
    const doublePostSiRes = await request(app)
      .post(`/api/accounting/sales-invoices/${siId}/post`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect([200, 409]).toContain(doublePostSiRes.status);

    await runInCompany(async () => {
      const jeRows = await db
        .select()
        .from(schema.journalEntries)
        .where(and(eq(schema.journalEntries.companyId, COMP_ID), eq(schema.journalEntries.sourceId, siId)));
      expect(jeRows.length).toBe(1);
      expect(jeRows[0].status).toBe('POSTED');
    });

    // 1B: Customer payment submit -> reject -> resubmit -> approve -> post
    let cpId = '';
    await runInCompany(async () => {
      cpId = await createCustomerPayment(
        COMP_ID,
        {
          paymentNumber: 'CP-FA-0001',
          customerId: CUST_ID,
          paymentDate: '2026-02-14',
          amount: 50_000,
          paymentMethod: 'BANK_TRANSFER',
          cashAccountId: ACC_CASH_PHP,
          applications: [{ invoiceId: siId, appliedAmount: 50_000 }],
        },
        BOOKKEEPER_ID,
        'Bookkeeper'
      );
    });

    const subCp1 = await request(app)
      .post(`/api/accounting/customer-payments/${cpId}/submit`)
      .set('Authorization', `Bearer ${bookkeeperToken}`)
      .send({});
    expect(subCp1.status).toBe(200);

    const rejCp = await request(app)
      .post(`/api/accounting/customer-payments/${cpId}/reject`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Missing official receipt attachment check' });
    expect(rejCp.status).toBe(200);

    // Resubmit after rejection must succeed cleanly
    const subCp2 = await request(app)
      .post(`/api/accounting/customer-payments/${cpId}/submit`)
      .set('Authorization', `Bearer ${bookkeeperToken}`)
      .send({});
    expect(subCp2.status).toBe(200);

    const appCp = await request(app)
      .post(`/api/accounting/customer-payments/${cpId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(appCp.status).toBe(200);

    const postCp = await request(app)
      .post(`/api/accounting/customer-payments/${cpId}/post`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(postCp.status).toBe(200);

    // 1C: Concurrent double-approval on a single journal entry returns 409 CONFLICT
    let jeId = '';
    await runInCompany(async () => {
      jeId = await createJournalEntry(
        COMP_ID,
        { journalNumber: 'JE-FA-CONC-1', entryDate: '2026-02-15', description: 'Concurrency test JE', accountingPeriodId: PER_FEB, createdBy: BOOKKEEPER_ID, userRole: 'Bookkeeper' },
        [
          { accountId: ACC_EXP, debit: 25_000, credit: 0 },
          { accountId: ACC_CASH_PHP, debit: 0, credit: 25_000 },
        ]
      );
      await db.update(schema.journalEntries).set({ status: 'UNDER_REVIEW' }).where(eq(schema.journalEntries.id, jeId));
    });

    const jeApp1 = await request(app)
      .post(`/api/accounting/journals/${jeId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(jeApp1.status).toBe(200);

    const jeApp2 = await request(app)
      .post(`/api/accounting/journals/${jeId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(jeApp2.status).toBeGreaterThanOrEqual(400);
  });

  it('2. Enforces lockDate, exact open period match in RecurringJournalService, and leaf COA filtering', async () => {
    await runInCompany(async () => {
      try {
        // Set lockDate to 2026-03-31
        await db
          .update(schema.companies)
          .set({ lockDate: '2026-03-31' })
          .where(eq(schema.companies.id, COMP_ID));

        // Template A: Dated 2026-03-15 (on/before lockDate -> MUST block)
        const tplLocked = await RecurringJournalService.createTemplate({
          companyId: COMP_ID,
          templateName: 'Locked Period Rent',
          frequency: 'MONTHLY',
          startDate: new Date('2026-03-15T00:00:00.000Z'),
          journalData: {
            description: 'Locked rent posting',
            lines: [
              { accountId: ACC_EXP, debit: 10_000, credit: 0 },
              { accountId: ACC_CASH_PHP, debit: 0, credit: 10_000 },
            ],
          },
          requiresApproval: false,
          userId: OWNER_ID,
        });

        // Template B: Dated 2026-04-15 (past lockDate, but 2026-04 period DOES NOT EXIST -> MUST block, not fall back to 2026-05)
        const tplNoPeriod = await RecurringJournalService.createTemplate({
          companyId: COMP_ID,
          templateName: 'Missing April Period Rent',
          frequency: 'MONTHLY',
          startDate: new Date('2026-04-15T00:00:00.000Z'),
          journalData: {
            description: 'Missing April period',
            lines: [
              { accountId: ACC_EXP, debit: 10_000, credit: 0 },
              { accountId: ACC_CASH_PHP, debit: 0, credit: 10_000 },
            ],
          },
          requiresApproval: false,
          userId: OWNER_ID,
        });

        // Template C: Valid period 2026-05-15, but references Header account 1000 -> MUST reject
        const tplHeaderAcc = await RecurringJournalService.createTemplate({
          companyId: COMP_ID,
          templateName: 'Header COA Violation',
          frequency: 'MONTHLY',
          startDate: new Date('2026-05-15T00:00:00.000Z'),
          journalData: {
            description: 'Header account test',
            lines: [
              { accountId: ACC_EXP, debit: 10_000, credit: 0 },
              { accountId: ACC_HEADER_ASSET, debit: 0, credit: 10_000 },
            ],
          },
          requiresApproval: false,
          userId: OWNER_ID,
        });

        const res = await RecurringJournalService.processDueTemplates(COMP_ID, OWNER_ID);
        expect(res.processedCount).toBe(0);
        expect(res.skippedTemplates.some((s) => s.templateId === tplLocked.id && s.reason.includes('2026-03-15'))).toBe(true);
        expect(res.skippedTemplates.some((s) => s.templateId === tplNoPeriod.id && s.reason.includes('2026-04-15'))).toBe(true);
        expect(res.skippedTemplates.some((s) => s.templateId === tplHeaderAcc.id && s.status === 'UNMAPPED_ACCOUNT')).toBe(true);

        // Verify leaf filter helper excludes 1000 Assets (Header)
        const allAccs = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, COMP_ID));
        const leafAccs = filterPostableLeafAccounts(allAccs as any[]);
        expect(leafAccs.some((a) => a.accountCode === '1000')).toBe(false);
        expect(leafAccs.some((a) => a.accountCode === '1010')).toBe(true);
      } finally {
        // Always reset lockDate for subsequent tests
        await db.update(schema.companies).set({ lockDate: null }).where(eq(schema.companies.id, COMP_ID));
      }
    });
  });

  it('3. Blocks ungrounded generic POST transitions & cross-tenant audit adjustments; posts balanced audit JE cleanly', async () => {
    let foreignAdjId = '';
    const foreignDb = await CompanyManager.getCompanyDb(FOREIGN_COMP_ID);
    await dbContext.run(foreignDb, async () => {
      const engId = crypto.randomUUID();
      await db.insert(schema.auditEngagements).values({
        id: engId,
        companyId: FOREIGN_COMP_ID,
        clientCompanyId: FOREIGN_COMP_ID,
        engagementName: 'Foreign Statutory Audit FY2026',
        auditPeriod: 'FY 2026',
        engagementType: 'STATUTORY_AUDIT',
        status: 'FIELDWORK',
      });
      foreignAdjId = crypto.randomUUID();
      await db.insert(schema.auditAdjustments).values({
        id: foreignAdjId,
        engagementId: engId,
        adjustmentType: 'PROPOSED',
        classification: 'FSD',
        affectedAccountsJson: '[]',
        financialEffect: 'Foreign adjustment',
        approvalStatus: 'PENDING',
      });
    });

    // Cross-tenant approve must fail cleanly (physical DB isolation gives 404 NOT_FOUND; shared DB foreign engagement gives 403)
    const crossTenantRes = await request(app)
      .post(`/api/audit-advanced/adjustments/${foreignAdjId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect([403, 404]).toContain(crossTenantRes.status);

    // Local company summary-only audit adjustment -> PASSED (never fake POSTED)
    let localEngId = '';
    let summaryAdjId = '';
    let balancedAdjId = '';
    await runInCompany(async () => {
      localEngId = crypto.randomUUID();
      await db.insert(schema.auditEngagements).values({
        id: localEngId,
        companyId: COMP_ID,
        clientCompanyId: COMP_ID,
        engagementName: 'Local Statutory Audit FY2026',
        auditPeriod: 'FY 2026',
        engagementType: 'STATUTORY_AUDIT',
        status: 'FIELDWORK',
      });
      summaryAdjId = crypto.randomUUID();
      await db.insert(schema.auditAdjustments).values({
        id: summaryAdjId,
        engagementId: localEngId,
        adjustmentType: 'PROPOSED',
        classification: 'RCD',
        affectedAccountsJson: '[]',
        financialEffect: 'Summary unadjusted difference',
        approvalStatus: 'PENDING',
      });
      balancedAdjId = crypto.randomUUID();
      await db.insert(schema.auditAdjustments).values({
        id: balancedAdjId,
        engagementId: localEngId,
        adjustmentType: 'PROPOSED',
        classification: 'AJE',
        affectedAccountsJson: JSON.stringify([
          { accountId: ACC_EXP, debit: 12_500, credit: 0, description: 'Audit accrual Dr' },
          { accountId: ACC_AP, debit: 0, credit: 12_500, description: 'Audit accrual Cr' },
        ]),
        financialEffect: 'Accrued audit adjustment',
        approvalStatus: 'PENDING',
      });
    });

    const summaryApproveRes = await request(app)
      .post(`/api/audit-advanced/adjustments/${summaryAdjId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(summaryApproveRes.status).toBe(200);
    expect(summaryApproveRes.body.adjustmentType).toBe('PASSED');
    expect(summaryApproveRes.body.journalEntryId).toBeNull();

    const balancedApproveRes = await request(app)
      .post(`/api/audit-advanced/adjustments/${balancedAdjId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(balancedApproveRes.status).toBe(200);
    expect(balancedApproveRes.body.adjustmentType).toBe('POSTED');
    expect(balancedApproveRes.body.journalEntryId).toBeTruthy();

    // Generic journey action must reject unposted FIXED_ASSET fake POSTED claim
    const fakePostRes = await request(app)
      .post(`/api/journey/action/FIXED_ASSET/nonexistent-or-asset`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ action: 'POST' });
    expect(fakePostRes.status).toBeGreaterThanOrEqual(400);
  });

  it('4. Verifies secondary bank GL isolation (1012), banking match -> RECONCILED sync, and raw=true pagination > 20 rows', async () => {
    // Seed 28 cash transactions and post at least 1 for matching
    let bankAccPhpId = '';
    let matchedCtxJeId = '';
    await runInCompany(async () => {
      // Seed bank reconciliation session on secondary USD account 1012 -> GL book balance must remain 0.00 (never polluted by 1010)
      await db.insert(schema.bankReconciliations).values({
        id: 'brec-usd-1012-audit',
        companyId: COMP_ID,
        bankAccountId: ACC_CASH_USD,
        statementDate: '2026-02-28',
        statementEndingBalance: 0,
        bookEndingBalance: 0,
        unexplainedDifference: 0,
        status: 'DRAFT',
        createdBy: OWNER_ID,
      });

      const ba = await BankReconciliationService.createBankAccount({
        companyId: COMP_ID,
        accountName: 'BDO Checking PHP',
        bankName: 'BDO',
        accountNumber: '001234567890',
        currency: 'PHP',
        glAccountId: ACC_CASH_PHP,
      });
      bankAccPhpId = ba.id;

      for (let i = 1; i <= 28; i++) {
        const amt = 10_000 + i * 100;
        const isReceipt = i % 2 === 0;
        const ctxId = await createCashTransaction(
          COMP_ID,
          {
            transactionNumber: `CTX-FA-${String(i).padStart(4, '0')}`,
            transactionDate: '2026-02-18',
            type: isReceipt ? 'RECEIPT' : 'DISBURSEMENT',
            cashAccountId: ACC_CASH_PHP,
            amount: amt,
            description: `Cash test #${i}`,
            lines: [{ accountId: isReceipt ? ACC_REV : ACC_EXP, amount: amt, description: `Cash test #${i}` }],
          },
          BOOKKEEPER_ID,
          'Bookkeeper'
        );
        if (i === 1) {
          await submitCashTransaction(COMP_ID, ctxId, BOOKKEEPER_ID);
          await approveCashTransaction(COMP_ID, ctxId, OWNER_ID, 'Company Owner');
          await postCashTransaction(COMP_ID, ctxId, PER_FEB, undefined, OWNER_ID, undefined, 'Company Owner');
          const [ctxRow] = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.id, ctxId));
          matchedCtxJeId = ctxRow.journalEntryId!;
        }
      }
    });

    // Verify USD 1012 session keeps 0 GL balance via GET /bank-reconciliations
    const recListRes = await request(app)
      .get('/api/accounting/bank-reconciliations')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(recListRes.status).toBe(200);
    const usdRec = (recListRes.body as any[]).find((r) => r.bankAccountId === ACC_CASH_USD);
    expect(usdRec).toBeTruthy();
    expect(Number(usdRec.bookEndingBalance)).toBe(0);

    // Import statement + match + approve match -> parent bankStatements status becomes RECONCILED
    const impRes = await request(app)
      .post('/api/banking/statements/import')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        bankAccountId: bankAccPhpId,
        statementDate: '2026-02-28',
        filename: 'bdo-feb-2026.csv',
        csvContent: `date,description,reference,amount,type\n2026-02-18,Cash test #1,CTX-FA-0001,-101.00,DEBIT\n`,
      });
    expect(impRes.status).toBe(201);
    const statementId = impRes.body.statementId;

    const matchRes = await request(app)
      .post('/api/banking/match')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ bankAccountId: bankAccPhpId });
    expect(matchRes.status).toBe(200);
    expect(Array.isArray(matchRes.body.suggestions)).toBe(true);
    expect(matchRes.body.suggestions.length).toBeGreaterThanOrEqual(1);

    const bankTxId = matchRes.body.suggestions[0].bankTransactionId;
    const approveMatchRes = await request(app)
      .post('/api/banking/approve')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ bankTransactionId: bankTxId, matchedJournalId: matchedCtxJeId });
    expect(approveMatchRes.status).toBe(200);

    await runInCompany(async () => {
      const [stmt] = await db.select().from(schema.bankStatements).where(eq(schema.bankStatements.id, statementId));
      expect(stmt.status).toBe('RECONCILED');
    });

    // Verify GET /api/accounting/cash-transactions?raw=true returns ALL 28+ rows (>20) without truncation
    const rawCashRes = await request(app)
      .get('/api/accounting/cash-transactions?raw=true')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(rawCashRes.status).toBe(200);
    expect(Array.isArray(rawCashRes.body)).toBe(true);
    expect(rawCashRes.body.length).toBeGreaterThanOrEqual(28);
  });

  it('5. Validates English-Only UI compliance and 16-module registry completeness', () => {
    const toolbarSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/client/components/shared/TableFilterToolbar.tsx'),
      'utf-8'
    );
    const agentWidgetSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/client/components/LedgerAgentWidget.tsx'),
      'utf-8'
    );

    const bannedTagalogFragments = ['Bago sa Taas', 'Luma sa Taas', 'Kumusta', 'Magkano', 'Ipakita', 'I-audit', 'bagong update'];
    for (const frag of bannedTagalogFragments) {
      expect(toolbarSrc.includes(frag)).toBe(false);
      expect(agentWidgetSrc.includes(frag)).toBe(false);
    }

    const regCheck = validateModuleRegistry();
    expect(regCheck.valid).toBe(true);
    expect(regCheck.errors).toHaveLength(0);

    const destCheck = validateFunctionalDestinations();
    expect(destCheck.valid).toBe(true);
    expect(destCheck.issues).toHaveLength(0);
  });

  it('6. High-volume synthetic stress test (400+ operational documents) maintains balanced Trial Balance and 1:1 status counts', async () => {
    const startMs = Date.now();
    const BATCH_COUNT = 100; // 100 SI + 100 PB + 100 CTX + 100 JE = 400 documents end-to-end posted into GL

    await runInCompany(async () => {
      for (let i = 1; i <= BATCH_COUNT; i++) {
        const siId = await createSalesInvoice(
          COMP_ID,
          {
            invoiceNumber: `SI-STR-${String(i).padStart(4, '0')}`,
            customerId: CUST_ID,
            invoiceDate: '2026-05-10',
            dueDate: '2026-06-10',
            totalAmount: 100_000,
            lines: [{ description: `Stress Service #${i}`, quantity: 1, unitPrice: 100_000, amount: 100_000, accountId: ACC_REV }],
          },
          BOOKKEEPER_ID,
          'Bookkeeper'
        );
        await submitSalesInvoice(COMP_ID, siId, BOOKKEEPER_ID);
        await approveSalesInvoice(COMP_ID, siId, OWNER_ID, undefined, 'Company Owner');
        await postSalesInvoice(COMP_ID, siId, PER_MAY, [], OWNER_ID, 'Company Owner');

        const pbId = await createPurchaseBill(
          COMP_ID,
          {
            billNumber: `PB-STR-${String(i).padStart(4, '0')}`,
            vendorId: VEND_ID,
            billDate: '2026-05-11',
            dueDate: '2026-06-11',
            totalAmount: 45_000,
            lines: [{ description: `Stress Expense #${i}`, quantity: 1, unitPrice: 45_000, amount: 45_000, accountId: ACC_EXP }],
          },
          BOOKKEEPER_ID,
          'Bookkeeper'
        );
        await submitPurchaseBill(COMP_ID, pbId, BOOKKEEPER_ID);
        await approvePurchaseBill(COMP_ID, pbId, OWNER_ID, undefined, 'Company Owner');
        await postPurchaseBill(COMP_ID, pbId, PER_MAY, [], OWNER_ID, 'Company Owner');

        const isReceipt = i % 2 === 0;
        const ctxId = await createCashTransaction(
          COMP_ID,
          {
            transactionNumber: `CTX-STR-${String(i).padStart(4, '0')}`,
            transactionDate: '2026-05-12',
            type: isReceipt ? 'RECEIPT' : 'DISBURSEMENT',
            cashAccountId: ACC_CASH_PHP,
            amount: 15_000,
            description: `Stress cash #${i}`,
            lines: [{ accountId: isReceipt ? ACC_REV : ACC_EXP, amount: 15_000, description: `Stress cash #${i}` }],
          },
          BOOKKEEPER_ID,
          'Bookkeeper'
        );
        await submitCashTransaction(COMP_ID, ctxId, BOOKKEEPER_ID);
        await approveCashTransaction(COMP_ID, ctxId, OWNER_ID, 'Company Owner');
        await postCashTransaction(COMP_ID, ctxId, PER_MAY, undefined, OWNER_ID, undefined, 'Company Owner');

        const jeId = await createJournalEntry(
          COMP_ID,
          {
            journalNumber: `JE-STR-${String(i).padStart(4, '0')}`,
            entryDate: '2026-05-13',
            description: `Stress JE #${i}`,
            accountingPeriodId: PER_MAY,
            createdBy: BOOKKEEPER_ID,
            userRole: 'Bookkeeper',
          },
          [
            { accountId: ACC_EXP, debit: 5_000, credit: 0 },
            { accountId: ACC_CASH_PHP, debit: 0, credit: 5_000 },
          ]
        );
        await submitJournalEntry(COMP_ID, jeId, BOOKKEEPER_ID);
        await approveJournalEntry(COMP_ID, jeId, OWNER_ID);
        await postJournalEntry(COMP_ID, jeId, OWNER_ID, 'Company Owner');
      }
    });

    const elapsedMs = Date.now() - startMs;
    console.log(`[Stress Benchmark] Processed 400 full-lifecycle ERP documents (1,600+ transitions/GL postings) in ${elapsedMs}ms`);

    // Verify Trial Balance balances exactly to 0.00 variance
    const tbRes = await request(app)
      .get('/api/reports/trial-balance?mode=cumulative')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(tbRes.status).toBe(200);
    expect(Array.isArray(tbRes.body)).toBe(true);
    const totalDebit = (tbRes.body as any[]).reduce((s, r) => s + Number(r.closingDebit || 0), 0);
    const totalCredit = (tbRes.body as any[]).reduce((s, r) => s + Number(r.closingCredit || 0), 0);
    expect(totalDebit).toBeGreaterThan(0);
    expect(totalDebit).toBe(totalCredit);

    // Verify paginated list endpoints + raw=true report exact DB totals
    const ctxPageRes = await request(app)
      .get('/api/accounting/cash-transactions?limit=20')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ctxPageRes.status).toBe(200);
    expect(ctxPageRes.body.data.length).toBe(20);

    const ctxRawRes = await request(app)
      .get('/api/accounting/cash-transactions?raw=true')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ctxRawRes.status).toBe(200);

    await runInCompany(async () => {
      const [siCount] = await db.select({ c: sql<number>`count(*)` }).from(schema.salesInvoices).where(eq(schema.salesInvoices.companyId, COMP_ID));
      const [pbCount] = await db.select({ c: sql<number>`count(*)` }).from(schema.purchaseBills).where(eq(schema.purchaseBills.companyId, COMP_ID));
      const [ctxCount] = await db.select({ c: sql<number>`count(*)` }).from(schema.cashTransactions).where(eq(schema.cashTransactions.companyId, COMP_ID));

      // Every POSTED transaction must reference an existing POSTED journal entry
      const orphanPostedInvoices = await db
        .select()
        .from(schema.salesInvoices)
        .where(and(eq(schema.salesInvoices.companyId, COMP_ID), eq(schema.salesInvoices.status, 'POSTED'), sql`${schema.salesInvoices.journalEntryId} IS NULL`));
      const orphanPostedBills = await db
        .select()
        .from(schema.purchaseBills)
        .where(and(eq(schema.purchaseBills.companyId, COMP_ID), eq(schema.purchaseBills.status, 'POSTED'), sql`${schema.purchaseBills.journalEntryId} IS NULL`));
      const orphanPostedCash = await db
        .select()
        .from(schema.cashTransactions)
        .where(and(eq(schema.cashTransactions.companyId, COMP_ID), eq(schema.cashTransactions.status, 'POSTED'), sql`${schema.cashTransactions.journalEntryId} IS NULL`));

      expect(orphanPostedInvoices).toHaveLength(0);
      expect(orphanPostedBills).toHaveLength(0);
      expect(orphanPostedCash).toHaveLength(0);

      expect(Number(ctxPageRes.body.pagination?.totalCount || 0)).toBe(Number(ctxCount.c));
      expect((ctxRawRes.body as any[]).length).toBe(Number(ctxCount.c));
      expect(Number(siCount.c)).toBeGreaterThanOrEqual(101);
      expect(Number(pbCount.c)).toBeGreaterThanOrEqual(100);
    });
  }, 60_000);
});
