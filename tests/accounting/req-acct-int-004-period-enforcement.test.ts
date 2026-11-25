import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import {
  normalizePeriodActorRole,
  isAdminPeriodOverrideRole,
  validateTransactionDateAndPeriod,
  createJournalEntry,
  submitJournalEntry,
  approveJournalEntry,
  postJournalEntry,
  softClosePeriod,
  hardClosePeriod,
  performYearEndClose,
} from '../../src/server/db/domain';
import { AccountingEngine } from '../../src/server/services/accountingEngine';
import {
  createSalesInvoice,
  createPurchaseBill,
  createCustomerPayment,
  createSupplierPayment,
  createCashTransaction,
} from '../../src/server/db/business_transactions';

describe('REQ-ACCT-INT-004 (PER-01): Cross-Module Period Lock, Role Normalization & Year-End Close', () => {
  const app = createApp();
  const COMP_ID = 'LGR-PH-2026-TEST-PER01';

  const OWNER_ID = 'usr-per01-owner';
  const ADMIN_ID = 'usr-per01-admin';
  const BOOKKEEPER_ID = 'usr-per01-bookkeeper';
  let ownerToken = '';
  let adminToken = '';
  let bookkeeperToken = '';

  const PER_JAN = 'per-per01-2026-01';
  const PER_FEB = 'per-per01-2026-02';
  const PER_MAR = 'per-per01-2026-03';

  const ACC_CASH = 'acc-per01-1010';
  const ACC_AR = 'acc-per01-1030';
  const ACC_INV = 'acc-per01-1040';
  const ACC_AP = 'acc-per01-2010';
  const ACC_RE = 'acc-per01-3020';
  const ACC_REV = 'acc-per01-4010';
  const ACC_EXP = 'acc-per01-6010';

  const CUST_ID = 'cust-per01-1';
  const VEND_ID = 'vend-per01-1';
  const ITEM_ID = 'item-per01-1';
  const EMP_ID = 'emp-per01-1';

  // Seeded draft/submitted records dated inside Jan/Feb for HARD_CLOSED testing
  let draftJeJanId = '';
  let approvedSiFebId = '';
  let approvedPbFebId = '';
  let approvedCpFebId = '';
  let approvedSpFebId = '';
  let approvedCtFebId = '';
  let draftFilingFebId = '';
  let filedFilingFebId = '';
  let draftSpFebForEwtId = '';
  let draftCpFebForCwtId = '';

  let companyDb: any;
  let companySqlite: any;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);

    await CompanyManager.createCompanyProfile(
      COMP_ID,
      'PER01 Enforcement Synthetic Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    companyDb = await CompanyManager.getCompanyDb(COMP_ID);
    companySqlite = await CompanyManager.getCompanySqlite(COMP_ID);

    companySqlite.prepare('DELETE FROM accounting_periods WHERE company_id = ?').run(COMP_ID);
    companySqlite.prepare('DELETE FROM accounts WHERE company_id = ?').run(COMP_ID);

    await dbContext.run(companyDb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      const seedUser = async (uid: string, email: string, name: string, roleName: string) => {
        await db.insert(schema.users).values({
          id: uid,
          email,
          displayName: name,
          passwordHash: 'test_hash',
          status: 'ACTIVE',
        }).onConflictDoNothing();

        const roleRec = await RbacService.ensureRoleRecord(roleName);
        const memId = `mem-${uid}`;
        await db.insert(schema.companyUsers).values({
          id: memId,
          userId: uid,
          companyId: COMP_ID,
          roleId: roleRec.id,
          legacyRole: roleName,
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: 'COMPANY_WIDE',
          approvalLimitCentavos: 100_000_000_00,
        }).onConflictDoNothing();

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

      ownerToken = await seedUser(OWNER_ID, 'owner@per01.ph', 'PER01 Owner', 'Company Owner');
      adminToken = await seedUser(ADMIN_ID, 'admin@per01.ph', 'PER01 Admin', 'Company Administrator');
      bookkeeperToken = await seedUser(BOOKKEEPER_ID, 'bk@per01.ph', 'PER01 Bookkeeper', 'Bookkeeper');

      await db.insert(schema.accountingPeriods).values([
        { id: PER_JAN, companyId: COMP_ID, name: 'January 2026', startDate: '2026-01-01', endDate: '2026-01-31', fiscalYear: 2026, status: 'OPEN', version: 1 },
        { id: PER_FEB, companyId: COMP_ID, name: 'February 2026', startDate: '2026-02-01', endDate: '2026-02-28', fiscalYear: 2026, status: 'OPEN', version: 1 },
        { id: PER_MAR, companyId: COMP_ID, name: 'March 2026', startDate: '2026-03-01', endDate: '2026-03-31', fiscalYear: 2026, status: 'OPEN', version: 1 },
      ]);

      await db.insert(schema.accounts).values([
        { id: ACC_CASH, companyId: COMP_ID, accountCode: '1010', accountName: 'Cash in Bank', accountType: 'ASSET', normalBalance: 'DEBIT', isCashAccount: true, status: 'ACTIVE' },
        { id: ACC_AR, companyId: COMP_ID, accountCode: '1030', accountName: 'Accounts Receivable', accountType: 'RECEIVABLE', normalBalance: 'DEBIT', isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_INV, companyId: COMP_ID, accountCode: '1040', accountName: 'Merchandise Inventory', accountType: 'ASSET', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_AP, companyId: COMP_ID, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'PAYABLE', normalBalance: 'CREDIT', isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_RE, companyId: COMP_ID, accountCode: '3020', accountName: 'Retained Earnings', accountType: 'EQUITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_REV, companyId: COMP_ID, accountCode: '4010', accountName: 'Service Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_EXP, companyId: COMP_ID, accountCode: '6010', accountName: 'Operating Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
      ]);

      await AccountingEngine.ensureDefaultAccounts(COMP_ID);

      await db.insert(schema.customers).values({
        id: CUST_ID,
        companyId: COMP_ID,
        code: 'CUST-PER01',
        legalName: 'Test Customer Corp',
        defaultReceivableAccountId: ACC_AR,
        status: 'ACTIVE',
      });

      await db.insert(schema.vendors).values({
        id: VEND_ID,
        companyId: COMP_ID,
        code: 'VEND-PER01',
        legalName: 'Test Vendor Corp',
        defaultPayableAccountId: ACC_AP,
        status: 'ACTIVE',
      });

      await db.insert(schema.inventoryItems).values({
        id: ITEM_ID,
        companyId: COMP_ID,
        sku: 'SKU-PER01',
        name: 'Audit Test Widget',
        quantityOnHand: 50,
        unitCost: 10_000,
        sellingPrice: 15_000,
        status: 'ACTIVE',
      });

      await db.insert(schema.employees).values({
        id: EMP_ID,
        companyId: COMP_ID,
        employeeNo: 'EMP-PER01',
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        monthlyBasicSalary: 3_000_000,
        status: 'ACTIVE',
      });

      // Posted activity in January & March so Year-End Close has net income to transfer
      const jRev = await createJournalEntry(
        COMP_ID,
        { journalNumber: 'JE-PER01-REV', entryDate: '2026-01-15', description: 'Jan Revenue', accountingPeriodId: PER_JAN, createdBy: BOOKKEEPER_ID, userRole: 'Bookkeeper' },
        [
          { accountId: ACC_CASH, debit: 5_000_000, credit: 0 },
          { accountId: ACC_REV, debit: 0, credit: 5_000_000 },
        ]
      );
      await submitJournalEntry(COMP_ID, jRev, BOOKKEEPER_ID);
      await approveJournalEntry(COMP_ID, jRev, OWNER_ID);
      await postJournalEntry(COMP_ID, jRev, OWNER_ID, 'COMPANY_OWNER');

      const jExp = await createJournalEntry(
        COMP_ID,
        { journalNumber: 'JE-PER01-EXP', entryDate: '2026-03-10', description: 'Mar Expense', accountingPeriodId: PER_MAR, createdBy: BOOKKEEPER_ID, userRole: 'Bookkeeper' },
        [
          { accountId: ACC_EXP, debit: 1_500_000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 1_500_000 },
        ]
      );
      await submitJournalEntry(COMP_ID, jExp, BOOKKEEPER_ID);
      await approveJournalEntry(COMP_ID, jExp, OWNER_ID);
      await postJournalEntry(COMP_ID, jExp, OWNER_ID, 'COMPANY_OWNER');

      // Seed DRAFT journal in Jan for PUT lock check
      draftJeJanId = await createJournalEntry(
        COMP_ID,
        { journalNumber: 'JE-PER01-DRAFT', entryDate: '2026-01-20', description: 'Draft JE', accountingPeriodId: PER_JAN, createdBy: BOOKKEEPER_ID, userRole: 'Bookkeeper' },
        [
          { accountId: ACC_EXP, debit: 100_000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 100_000 },
        ]
      );

      // Seed APPROVED subledgers in Feb before hard-closing Feb
      approvedSiFebId = await createSalesInvoice(
        COMP_ID,
        {
          invoiceNumber: 'SI-PER01-01',
          customerId: CUST_ID,
          invoiceDate: '2026-02-10',
          dueDate: '2026-03-10',
          totalAmount: 100_000,
          lines: [{ description: 'Service', quantity: 1, unitPrice: 100_000, amount: 100_000, accountId: ACC_REV }],
        },
        BOOKKEEPER_ID,
        'Bookkeeper'
      );
      await db.update(schema.salesInvoices).set({ status: 'APPROVED', approvedBy: OWNER_ID }).where(eq(schema.salesInvoices.id, approvedSiFebId));

      approvedPbFebId = await createPurchaseBill(
        COMP_ID,
        {
          billNumber: 'PB-PER01-01',
          vendorId: VEND_ID,
          billDate: '2026-02-11',
          dueDate: '2026-03-11',
          totalAmount: 50_000,
          lines: [{ description: 'Supplies', quantity: 1, unitPrice: 50_000, amount: 50_000, accountId: ACC_EXP }],
        },
        BOOKKEEPER_ID,
        'Bookkeeper'
      );
      await db.update(schema.purchaseBills).set({ status: 'APPROVED', approvedBy: OWNER_ID }).where(eq(schema.purchaseBills.id, approvedPbFebId));

      approvedCpFebId = await createCustomerPayment(
        COMP_ID,
        {
          paymentNumber: 'CP-PER01-01',
          customerId: CUST_ID,
          paymentDate: '2026-02-12',
          amount: 50_000,
          paymentMethod: 'BANK_TRANSFER',
          cashAccountId: ACC_CASH,
        },
        BOOKKEEPER_ID,
        'Bookkeeper'
      );
      await db.update(schema.customerPayments).set({ status: 'APPROVED', approvedBy: OWNER_ID }).where(eq(schema.customerPayments.id, approvedCpFebId));
      draftCpFebForCwtId = approvedCpFebId;

      approvedSpFebId = await createSupplierPayment(
        COMP_ID,
        {
          paymentNumber: 'SP-PER01-01',
          vendorId: VEND_ID,
          paymentDate: '2026-02-13',
          amount: 40_000,
          paymentMethod: 'BANK_TRANSFER',
          cashAccountId: ACC_CASH,
        },
        BOOKKEEPER_ID,
        'Bookkeeper'
      );
      await db.update(schema.supplierPayments).set({ status: 'APPROVED', approvedBy: OWNER_ID }).where(eq(schema.supplierPayments.id, approvedSpFebId));
      draftSpFebForEwtId = approvedSpFebId;

      approvedCtFebId = await createCashTransaction(
        COMP_ID,
        {
          transactionNumber: 'CT-PER01-01',
          type: 'DISBURSEMENT',
          transactionDate: '2026-02-14',
          totalAmount: 15_000,
          cashAccountId: ACC_CASH,
          description: 'Petty Cash Test',
          lines: [{ accountId: ACC_EXP, amount: 15_000, description: 'Petty Cash Test' }],
        },
        BOOKKEEPER_ID,
        'Bookkeeper'
      );
      await db.update(schema.cashTransactions).set({ status: 'APPROVED', approvedBy: OWNER_ID }).where(eq(schema.cashTransactions.id, approvedCtFebId));

      // Seed tax filings in Feb (one DRAFT, one FILED) before hard-closing Feb
      draftFilingFebId = crypto.randomUUID();
      filedFilingFebId = crypto.randomUUID();
      await db.insert(schema.taxFilings).values([
        {
          id: draftFilingFebId,
          companyId: COMP_ID,
          taxType: 'BIR_1601C',
          periodName: 'February 2026',
          startDate: '2026-02-01',
          endDate: '2026-02-28',
          deadlineDate: '2026-03-10',
          status: 'DRAFT',
        },
        {
          id: filedFilingFebId,
          companyId: COMP_ID,
          taxType: 'BIR_0619E',
          periodName: 'February 2026',
          startDate: '2026-02-01',
          endDate: '2026-02-28',
          deadlineDate: '2026-03-10',
          status: 'FILED',
        },
      ]);

      // Seed pending depreciation schedule in 2026-02
      const assetId = crypto.randomUUID();
      await db.insert(schema.fixedAssets).values({
        id: assetId,
        companyId: COMP_ID,
        assetTag: 'FA-PER01-01',
        assetName: 'Audit Server',
        category: 'EQUIPMENT',
        acquisitionDate: '2026-01-02',
        acquisitionCost: 1_200_000,
        salvageValue: 0,
        usefulLifeMonths: 12,
        depreciationMethod: 'STRAIGHT_LINE',
      });
      await db.insert(schema.depreciationSchedules).values({
        id: crypto.randomUUID(),
        assetId,
        companyId: COMP_ID,
        periodMonth: '2026-02',
        depreciationAmount: 100_000,
        accumulatedDepreciation: 200_000,
        bookValue: 1_000_000,
        status: 'PENDING',
      });
    });
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMP_ID);
  });

  it('1. Normalizes role codes and display names consistently across Company Owner / Admin / Staff', () => {
    expect(normalizePeriodActorRole('COMPANY_OWNER')).toBe('Company Owner');
    expect(normalizePeriodActorRole('OWNER')).toBe('Company Owner');
    expect(normalizePeriodActorRole('Company Owner')).toBe('Company Owner');
    expect(normalizePeriodActorRole('COMPANY_ADMINISTRATOR')).toBe('Company Administrator');
    expect(normalizePeriodActorRole('COMPANY_ADMIN')).toBe('Company Administrator');
    expect(normalizePeriodActorRole('ADMIN')).toBe('Company Administrator');
    expect(normalizePeriodActorRole('SUPER_ADMIN')).toBe('Company Owner');

    expect(isAdminPeriodOverrideRole('COMPANY_OWNER')).toBe(true);
    expect(isAdminPeriodOverrideRole('Company Owner')).toBe(true);
    expect(isAdminPeriodOverrideRole('COMPANY_ADMINISTRATOR')).toBe(true);
    expect(isAdminPeriodOverrideRole('Bookkeeper')).toBe(false);
    expect(isAdminPeriodOverrideRole('ACCOUNTANT')).toBe(false);
    expect(isAdminPeriodOverrideRole(undefined)).toBe(false);
  });

  it('2. Enforces SOFT_CLOSED period override for Owner/Admin (via HTTP roleCode) while blocking Bookkeeper (403)', async () => {
    await dbContext.run(companyDb, async () => {
      await softClosePeriod(COMP_ID, PER_FEB, OWNER_ID);
    });

    // Bookkeeper has sales:create permission, so request reaches validateTransactionDateAndPeriod and is blocked by SOFT_CLOSED (403)
    const bkRes = await request(app)
      .post('/api/accounting/sales-invoices')
      .set('Authorization', `Bearer ${bookkeeperToken}`)
      .send({
        invoiceNumber: 'SI-SOFT-BK-01',
        customerId: CUST_ID,
        invoiceDate: '2026-02-15',
        dueDate: '2026-03-15',
        subtotal: 50_000,
        totalAmount: 50_000,
        lines: [{ description: 'Item', quantity: 1, unitPrice: 50_000, amount: 50_000, accountId: ACC_REV }],
      });
    expect(bkRes.status).toBe(403);
    expect(String(bkRes.body.message || bkRes.body.error || '')).toMatch(/SOFT_CLOSED/i);

    // Company Owner & Company Administrator succeed on SOFT_CLOSED period via actual API routes (roleCode = 'COMPANY_OWNER')
    const ownerRes = await request(app)
      .post('/api/accounting/journals')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        journalNumber: 'JE-SOFT-OWN-01',
        entryDate: '2026-02-15',
        description: 'Owner allowed in SOFT_CLOSED',
        lines: [
          { accountId: ACC_EXP, debit: 50_000, credit: 0 },
          { accountId: ACC_CASH, debit: 0, credit: 50_000 },
        ],
      });
    expect(ownerRes.status).toBe(201);

    // Company Administrator role codes ('COMPANY_ADMIN' / 'COMPANY_ADMINISTRATOR') are recognized by domain & engine override layers
    await dbContext.run(companyDb, async () => {
      const admAllowed = await validateTransactionDateAndPeriod(COMP_ID, '2026-02-16', { userRole: 'COMPANY_ADMIN' });
      expect(admAllowed.id).toBe(PER_FEB);
      await expect(
        AccountingEngine.assertPeriodIsOpen(db, COMP_ID, '2026-02-15', { userRole: 'Bookkeeper' })
      ).rejects.toThrow(/SOFT_CLOSED/i);
      await expect(
        AccountingEngine.assertPeriodIsOpen(db, COMP_ID, '2026-02-15', { userRole: 'COMPANY_OWNER' })
      ).resolves.not.toThrow();
      await expect(
        AccountingEngine.assertPeriodIsOpen(db, COMP_ID, '2026-02-15', { userRole: 'COMPANY_ADMIN' })
      ).resolves.not.toThrow();
    });
  });

  it('3. Blocks ALL write/post operations across GL, AR, AP, Cash, Inventory, Payroll, Fixed Assets, Forex, and Tax in HARD_CLOSED periods (HTTP 403)', async () => {
    await dbContext.run(companyDb, async () => {
      await hardClosePeriod(COMP_ID, PER_FEB, OWNER_ID);
      await hardClosePeriod(COMP_ID, PER_JAN, OWNER_ID);
    });

    // Accounting & GL routes
    const jeCreate = await request(app).post('/api/accounting/journals').set('Authorization', `Bearer ${ownerToken}`).send({
      journalNumber: 'JE-HC-01',
      entryDate: '2026-02-18',
      description: 'Hard closed blocked',
      lines: [
        { accountId: ACC_EXP, debit: 10_000, credit: 0 },
        { accountId: ACC_CASH, debit: 0, credit: 10_000 },
      ],
    });
    expect(jeCreate.status).toBe(403);

    const jeUpdate = await request(app).put(`/api/accounting/journals/${draftJeJanId}`).set('Authorization', `Bearer ${ownerToken}`).send({
      entryDate: '2026-01-20',
      description: 'Updated in hard-closed Jan',
      lines: [
        { accountId: ACC_EXP, debit: 100_000, credit: 0 },
        { accountId: ACC_CASH, debit: 0, credit: 100_000 },
      ],
    });
    expect(jeUpdate.status).toBe(403);

    // AR / AP / Cash create & post routes
    const siCreate = await request(app).post('/api/accounting/sales-invoices').set('Authorization', `Bearer ${ownerToken}`).send({
      invoiceNumber: 'SI-HC-01',
      customerId: CUST_ID,
      invoiceDate: '2026-02-18',
      dueDate: '2026-03-18',
      subtotal: 10_000,
      totalAmount: 10_000,
      lines: [{ description: 'Item', quantity: 1, unitPrice: 10_000, amount: 10_000, accountId: ACC_REV }],
    });
    expect(siCreate.status).toBe(403);

    const siPost = await request(app).post(`/api/accounting/sales-invoices/${approvedSiFebId}/post`).set('Authorization', `Bearer ${ownerToken}`).send({});
    expect(siPost.status).toBe(403);

    const pbCreate = await request(app).post('/api/accounting/purchase-bills').set('Authorization', `Bearer ${ownerToken}`).send({
      billNumber: 'PB-HC-01',
      vendorId: VEND_ID,
      billDate: '2026-02-18',
      dueDate: '2026-03-18',
      subtotal: 10_000,
      totalAmount: 10_000,
      lines: [{ description: 'Bill', quantity: 1, unitPrice: 10_000, amount: 10_000, accountId: ACC_EXP }],
    });
    expect(pbCreate.status).toBe(403);

    const pbPost = await request(app).post(`/api/accounting/purchase-bills/${approvedPbFebId}/post`).set('Authorization', `Bearer ${ownerToken}`).send({});
    expect(pbPost.status).toBe(403);

    const cpCreate = await request(app).post('/api/accounting/customer-payments').set('Authorization', `Bearer ${ownerToken}`).send({
      paymentNumber: 'CP-HC-01',
      customerId: CUST_ID,
      paymentDate: '2026-02-18',
      amount: 10_000,
      paymentMethod: 'CASH',
      cashAccountId: ACC_CASH,
    });
    expect(cpCreate.status).toBe(403);

    const cpPost = await request(app).post(`/api/accounting/customer-payments/${approvedCpFebId}/post`).set('Authorization', `Bearer ${ownerToken}`).send({});
    expect(cpPost.status).toBe(403);

    const spCreate = await request(app).post('/api/accounting/supplier-payments').set('Authorization', `Bearer ${ownerToken}`).send({
      paymentNumber: 'SP-HC-01',
      vendorId: VEND_ID,
      paymentDate: '2026-02-18',
      amount: 10_000,
      paymentMethod: 'CASH',
      cashAccountId: ACC_CASH,
    });
    expect(spCreate.status).toBe(403);

    const spPost = await request(app).post(`/api/accounting/supplier-payments/${approvedSpFebId}/post`).set('Authorization', `Bearer ${ownerToken}`).send({});
    expect(spPost.status).toBe(403);

    const ctCreate = await request(app).post('/api/accounting/cash-transactions').set('Authorization', `Bearer ${ownerToken}`).send({
      accountId: ACC_CASH,
      type: 'DISBURSEMENT',
      transactionDate: '2026-02-18',
      amount: 5_000,
      description: 'Hard closed cash tx',
    });
    expect(ctCreate.status).toBe(403);

    const ctPost = await request(app).post(`/api/accounting/cash-transactions/${approvedCtFebId}/post`).set('Authorization', `Bearer ${ownerToken}`).send({});
    expect(ctPost.status).toBe(403);

    // Operations routes: Inventory Adjustments, Payroll Process, Fixed Asset Capitalization, Depreciation Post, Forex Post
    const invAdj = await request(app).post('/api/operations/inventory/adjustments').set('Authorization', `Bearer ${ownerToken}`).send({
      itemId: ITEM_ID,
      adjustmentDate: '2026-02-18',
      quantityChange: -2,
      adjustmentType: 'SCRAP',
      reason: 'Damaged unit in locked period',
    });
    expect(invAdj.status).toBe(403);

    const payrollRes = await request(app).post('/api/operations/payroll/process').set('Authorization', `Bearer ${ownerToken}`).send({
      payrollPeriod: '2026-02-BATCH',
      startDate: '2026-02-01',
      endDate: '2026-02-28',
      paymentDate: '2026-02-28',
    });
    expect(payrollRes.status).toBe(403);

    const faRes = await request(app).post('/api/operations/fixed-assets').set('Authorization', `Bearer ${ownerToken}`).send({
      assetTag: 'FA-HC-01',
      assetName: 'Blocked Asset',
      acquisitionDate: '2026-02-18',
      acquisitionCost: 50_000,
      usefulLifeMonths: 24,
    });
    expect(faRes.status).toBe(403);

    const depRes = await request(app).post('/api/operations/depreciation/post').set('Authorization', `Bearer ${ownerToken}`).send({
      periodMonth: '2026-02',
    });
    expect(depRes.status).toBe(403);

    const fxRes = await request(app).post('/api/operations/forex/revalue-and-post').set('Authorization', `Bearer ${ownerToken}`).send({
      transactionId: 'fx-hc-01',
      transactionNumber: 'FX-HC-01',
      transactionDate: '2026-02-18',
      foreignAmount: 100,
      recordedRate: 56,
      settlementRate: 57,
    });
    expect(fxRes.status).toBe(403);

    // Tax & BIR Compliance routes
    const taxFilingCreate = await request(app).post('/api/tax/filings').set('Authorization', `Bearer ${ownerToken}`).send({
      taxType: 'VAT_2550M',
      periodName: 'February 2026',
      startDate: '2026-02-01',
      endDate: '2026-02-28',
    });
    expect(taxFilingCreate.status).toBe(403);
    expect(taxFilingCreate.body.error).toBe('PERIOD_LOCKED');

    const taxFilingFile = await request(app).post(`/api/tax/filings/${draftFilingFebId}/file`).set('Authorization', `Bearer ${ownerToken}`).send({});
    expect(taxFilingFile.status).toBe(403);

    const taxFilingAmend = await request(app).post(`/api/tax/filings/${filedFilingFebId}/amend`).set('Authorization', `Bearer ${ownerToken}`).send({
      reason: 'Amended VAT return correction',
    });
    expect(taxFilingAmend.status).toBe(403);

    const taxAdj = await request(app).post('/api/tax/adjustments').set('Authorization', `Bearer ${ownerToken}`).send({
      taxFilingId: draftFilingFebId,
      adjustmentType: 'MANUAL',
      amount: 5000,
      reason: 'Locked period adjustment',
    });
    expect(taxAdj.status).toBe(403);

    const tax2307 = await request(app).post('/api/tax/2307/issue').set('Authorization', `Bearer ${ownerToken}`).send({
      certificateControlNo: '2307-HC-01',
      vendorId: VEND_ID,
      quarter: 'Q1',
      year: 2026,
      grossPaymentPhp: 10000,
      taxWithheldPhp: 200,
    });
    expect(tax2307.status).toBe(403);

    const ewtUpd = await request(app).put(`/api/tax/withholding/ewt/${draftSpFebForEwtId}`).set('Authorization', `Bearer ${ownerToken}`).send({
      withholdingTaxAmount: 800,
    });
    expect(ewtUpd.status).toBe(403);

    const cwtUpd = await request(app).put(`/api/tax/withholding/cwt/${draftCpFebForCwtId}`).set('Authorization', `Bearer ${ownerToken}`).send({
      withholdingTaxAmount: 500,
    });
    expect(cwtUpd.status).toBe(403);
  });

  it('4. Executes performYearEndClose atomically with Retained Earnings JE, incremented period versions, tamper-proof SHA-256 certification, audit log, and idempotent repeat invocation', async () => {
    const yeRes = await request(app)
      .post('/api/accounting/year-end-close')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        fiscalYear: 2026,
        retainedEarningsAccountId: ACC_RE,
      });

    expect(yeRes.status).toBe(200);
    const yeResult = yeRes.body.result;
    expect(yeResult.fiscalYear).toBe(2026);
    expect(yeResult.periodsClosed).toBe(3);
    // Revenue (5,000,000) - Expense (1,500,000) = Net Income 3,500,000 centavos
    expect(yeResult.netIncome).toBe(3_500_000);
    expect(yeResult.alreadyClosed).toBe(false);
    expect(yeResult.certificationId).toMatch(/^CERT-YE-2026-/);
    expect(yeResult.certificationSha256).toMatch(/^[a-f0-9]{64}$/);
    const yeJournalId = yeResult.journalEntryId;
    expect(typeof yeJournalId).toBe('string');

    await dbContext.run(companyDb, async () => {
      // 1. Verify closing JE is balanced & credits Retained Earnings by 3,500,000
      const yeLines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, yeJournalId));
      const sumDr = yeLines.reduce((s, l) => s + l.debit, 0);
      const sumCr = yeLines.reduce((s, l) => s + l.credit, 0);
      expect(sumDr).toBe(sumCr);
      expect(sumDr).toBe(5_000_000);
      const reLine = yeLines.find((l) => l.accountId === ACC_RE);
      expect(reLine?.credit).toBe(3_500_000);

      // 2. Verify all 2026 periods are HARD_CLOSED and versions incremented cleanly
      const periods2026 = await db.select().from(schema.accountingPeriods).where(eq(schema.accountingPeriods.fiscalYear, 2026));
      for (const p of periods2026) {
        expect(p.status).toBe('HARD_CLOSED');
        expect(p.version).toBeGreaterThanOrEqual(2);
      }

      // 3. Verify immutable period_close_certifications row & SQLite tamper triggers
      const certRow = companySqlite.prepare(`SELECT * FROM period_close_certifications WHERE id = ?`).get(yeResult.certificationId) as any;
      expect(certRow).toBeDefined();
      expect(certRow.close_type).toBe('YEAR_END_CLOSE');
      expect(certRow.sha256_hash).toBe(yeResult.certificationSha256);

      expect(() => {
        companySqlite.prepare(`UPDATE period_close_certifications SET closing_reason = 'Tampered' WHERE id = ?`).run(yeResult.certificationId);
      }).toThrow(/IMMUTABLE_CERTIFICATION_SNAPSHOT/i);

      expect(() => {
        companySqlite.prepare(`DELETE FROM period_close_certifications WHERE id = ?`).run(yeResult.certificationId);
      }).toThrow(/IMMUTABLE_CERTIFICATION_SNAPSHOT/i);

      // 4. Verify audit log entry was written
      const yeAudits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'YEAR_END_CLOSE'));
      expect(yeAudits.length).toBeGreaterThanOrEqual(1);
    });

    // 5. Repeat invocation is safely idempotent (does not create duplicate JE or mutate versions)
    const repeatRes = await request(app)
      .post('/api/accounting/year-end-close')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        fiscalYear: 2026,
        retainedEarningsAccountId: ACC_RE,
      });

    expect(repeatRes.status).toBe(200);
    expect(repeatRes.body.result.alreadyClosed).toBe(true);
    expect(repeatRes.body.result.periodsClosed).toBe(0);
    expect(repeatRes.body.result.journalEntryId).toBe(yeJournalId);
    expect(repeatRes.body.result.certificationId).toBe(yeResult.certificationId);
  });
});
