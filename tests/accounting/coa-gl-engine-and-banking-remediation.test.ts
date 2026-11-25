import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { eq, and, sql } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { paths } from '../../src/server/services/paths';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import {
  filterEligibleCashBankAccounts,
  filterPostableLeafAccounts,
  isPostableLeafAccount,
  isAccountHeader,
  isEligibleCashBankAccount
} from '../../src/shared/coaAccountUtils';
import {
  createCashTransaction,
  submitCashTransaction,
  approveCashTransaction,
  postCashTransaction,
  createCheck,
  clearCheck,
  bounceCheck,
  createBankDeposit,
  submitBankDeposit,
  approveBankDeposit,
  postBankDeposit,
  getCashbook,
  createBankReconciliation,
  approveBankReconciliation,
  recalculateBankReconciliationMetrics,
  createSalesInvoice,
  submitSalesInvoice,
  approveSalesInvoice,
  postSalesInvoice,
  createCustomerPayment,
  submitCustomerPayment,
  approveCustomerPayment,
  postCustomerPayment,
  createPurchaseBill,
  submitPurchaseBill,
  approvePurchaseBill,
  postPurchaseBill,
  createSupplierPayment,
  submitSupplierPayment,
  approveSupplierPayment,
  postSupplierPayment,
  resolveCompanyControlAccount,
  getCompanyRegisterToCoaMapping
} from '../../src/server/db/business_transactions';
import {
  createJournalEntry,
  submitJournalEntry,
  approveJournalEntry,
  postJournalEntry,
  reverseJournalEntry
} from '../../src/server/db/domain';
import { FinancialSourceOfTruthService } from '../../src/server/services/financialSourceOfTruth';
import { BankReconciliationService } from '../../src/server/services/bankReconciliationService';
import { TaxEngine } from '../../src/server/services/taxEngine';
import { AccountingEngine } from '../../src/server/services/accountingEngine';


describe('LEDGERAI PH — FULL ACCOUNTING ENGINE, CHART OF ACCOUNTS & GENERAL LEDGER INTEGRATION AUDIT AND REMEDIATION', () => {
  const app = createApp();
  const COMPANY_ID = 'LGR-PH-COA-GL-AUDIT-2026';
  const ADMIN_USER_ID = 'usr-coa-gl-admin';
  const ACCOUNTANT_USER_ID = 'usr-coa-gl-accountant';
  const APPROVER_USER_ID = 'usr-coa-gl-approver';

  let adminToken: string;
  let accountantToken: string;
  let approverToken: string;
  let txnId: string;
  let checkId: string;
  let depositId: string;

  const PERIOD_ID = 'prd-coa-gl-2026';
  const txDate = '2026-11-16';

  // COA IDs
  const ACC_HEADER_ASSETS = 'acc-audit-1000-hdr';
  const ACC_CASH_1010 = 'acc-audit-1010';
  const ACC_PETTY_1020 = 'acc-audit-1020';
  const ACC_BDO_2026 = 'acc-audit-2026';
  const ACC_AR = 'acc-audit-1110';
  const ACC_INV = 'acc-audit-1040';
  const ACC_FA = 'acc-audit-1500';
  const ACC_FA_ACCUM = 'acc-audit-1510';
  const ACC_AP = 'acc-audit-2010';
  const ACC_OUT_VAT = 'acc-audit-2020';
  const ACC_IN_VAT = 'acc-audit-1060';
  const ACC_SSS_PAY = 'acc-audit-2110';
  const ACC_PHIC_PAY = 'acc-audit-2120';
  const ACC_HDMF_PAY = 'acc-audit-2130';
  const ACC_WHT_PAY = 'acc-audit-2140';
  const ACC_HEADER_EXP = 'acc-audit-5000-hdr';
  const ACC_COGS = 'acc-audit-5010';
  const ACC_OPEX = 'acc-audit-6010';
  const ACC_BANK_FEE = 'acc-audit-6015';
  const ACC_DEP_EXP = 'acc-audit-6020';
  const ACC_SAL_EXP = 'acc-audit-6110';
  const ACC_INACTIVE_EXP = 'acc-audit-6999-inact';
  const ACC_REV = 'acc-audit-4010';
  const ACC_EQUITY = 'acc-audit-3010';

  const cleanupCompany = async () => {
    await CompanyManager.closeAllConnections();
    const cdir = path.join(paths.getCompaniesRootDir(), COMPANY_ID);
    const laiFile = `${cdir}.lai`;
    if (fs.existsSync(cdir)) {
      try { fs.rmSync(cdir, { recursive: true, force: true }); } catch {}
    }
    if (fs.existsSync(laiFile)) {
      try { fs.rmSync(laiFile, { force: true }); } catch {}
    }
    try { await CompanyManager.deleteCompany(COMPANY_ID); } catch {}
  };

  beforeAll(async () => {
    await CompanyManager.init();
    await cleanupCompany();

    // 1. Create company workspace
    await CompanyManager.createCompanyProfile(
      COMPANY_ID,
      'LedgerAI Enterprise COA & Banking Audit Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST' }
    );

    const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
    await dbContext.run(compDb, async () => {
      const now = new Date();
      await RbacService.ensureRoleTemplatesSeeded();

      await compDb.insert(schema.users).values([
        {
          id: ADMIN_USER_ID,
          email: 'admin@audit.ph',
          displayName: 'COA Audit Admin',
          passwordHash: 'dummy-hash',
          status: 'ACTIVE',
        },
        {
          id: ACCOUNTANT_USER_ID,
          email: 'accountant@audit.ph',
          displayName: 'Senior Accountant',
          passwordHash: 'dummy-hash',
          status: 'ACTIVE',
        },
        {
          id: APPROVER_USER_ID,
          email: 'approver@audit.ph',
          displayName: 'Finance Approver',
          passwordHash: 'dummy-hash',
          status: 'ACTIVE',
        },
      ]);

      const adminRole = await RbacService.ensureRoleRecord('Company Administrator');
      const accRole = await RbacService.ensureRoleRecord('Accountant');
      const apprRole = await RbacService.ensureRoleRecord('Finance Manager');

      await compDb.insert(schema.companyUsers).values([
        {
          id: `mem-${ADMIN_USER_ID}`,
          userId: ADMIN_USER_ID,
          companyId: COMPANY_ID,
          roleId: adminRole.id,
          legacyRole: 'Company Administrator',
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: 'COMPANY_WIDE',
        },
        {
          id: `mem-${ACCOUNTANT_USER_ID}`,
          userId: ACCOUNTANT_USER_ID,
          companyId: COMPANY_ID,
          roleId: accRole.id,
          legacyRole: 'Accountant',
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: 'COMPANY_WIDE',
        },
        {
          id: `mem-${APPROVER_USER_ID}`,
          userId: APPROVER_USER_ID,
          companyId: COMPANY_ID,
          roleId: apprRole.id,
          legacyRole: 'Finance Manager',
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: 'COMPANY_WIDE',
        },
      ]);

      const rawAdminToken = crypto.randomBytes(32).toString('hex');
      const rawAccToken = crypto.randomBytes(32).toString('hex');
      const rawApprToken = crypto.randomBytes(32).toString('hex');

      await compDb.insert(schema.sessions).values([
        {
          id: hashToken(rawAdminToken),
          userId: ADMIN_USER_ID,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        {
          id: hashToken(rawAccToken),
          userId: ACCOUNTANT_USER_ID,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        {
          id: hashToken(rawApprToken),
          userId: APPROVER_USER_ID,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      ]);

      adminToken = `${COMPANY_ID}.${rawAdminToken}`;
      accountantToken = `${COMPANY_ID}.${rawAccToken}`;
      approverToken = `${COMPANY_ID}.${rawApprToken}`;

      // 3. Accounting Period
      await compDb.insert(schema.accountingPeriods).values({
        id: PERIOD_ID,
        companyId: COMPANY_ID,
        name: 'FY 2026 Period 11',
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        fiscalYear: 2026,
        status: 'OPEN',
        createdAt: now,
        updatedAt: now,
      });

      // 4. Chart of Accounts: Include Header, 1010, 1020, 2026, Active & Inactive
      await compDb.insert(schema.accounts).values([
        // Header Asset (Parent)
        {
          id: ACC_HEADER_ASSETS,
          companyId: COMPANY_ID,
          accountCode: '1000',
          accountName: 'Current Assets (Header)',
          accountType: 'ASSET',
          detailType: 'CURRENT_ASSET',
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
          isCashAccount: false,
          isSystem: false,
          isControlAccount: false,
        },
        // 1010 Cash in Bank
        {
          id: ACC_CASH_1010,
          companyId: COMPANY_ID,
          accountCode: '1010',
          accountName: 'Cash in Bank — General Corporate',
          accountType: 'ASSET',
          detailType: 'CHECKING',
          parentAccountId: ACC_HEADER_ASSETS,
          isSubAccount: true,
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
          isCashAccount: true,
          currency: 'PHP',
        },
        // 1020 Petty Cash Fund
        {
          id: ACC_PETTY_1020,
          companyId: COMPANY_ID,
          accountCode: '1020',
          accountName: 'Petty Cash Fund — Head Office',
          accountType: 'ASSET',
          detailType: 'PETTY_CASH',
          parentAccountId: ACC_HEADER_ASSETS,
          isSubAccount: true,
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
          isCashAccount: true,
          currency: 'PHP',
        },
        // 2026 BDO Business Checking Account
        {
          id: ACC_BDO_2026,
          companyId: COMPANY_ID,
          accountCode: '2026',
          accountName: 'BDO Business Checking Account',
          accountType: 'ASSET',
          detailType: 'CHECKING',
          parentAccountId: ACC_HEADER_ASSETS,
          isSubAccount: true,
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
          isCashAccount: true,
          currency: 'PHP',
        },
        // Accounts Receivable
        {
          id: ACC_AR,
          companyId: COMPANY_ID,
          accountCode: '1110',
          accountName: 'Accounts Receivable — Trade',
          accountType: 'ASSET',
          detailType: 'ACCOUNTS_RECEIVABLE',
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
          isControlAccount: true,
        },
        // Inventory Asset
        {
          id: ACC_INV,
          companyId: COMPANY_ID,
          accountCode: '1040',
          accountName: 'Merchandise Inventory',
          accountType: 'ASSET',
          detailType: 'INVENTORY',
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
        },
        // Input VAT
        {
          id: ACC_IN_VAT,
          companyId: COMPANY_ID,
          accountCode: '1060',
          accountName: 'Input VAT (12%)',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
          isTaxAccount: true,
        },
        // Fixed Assets
        {
          id: ACC_FA,
          companyId: COMPANY_ID,
          accountCode: '1500',
          accountName: 'Office & IT Equipment',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
        },
        {
          id: ACC_FA_ACCUM,
          companyId: COMPANY_ID,
          accountCode: '1510',
          accountName: 'Accumulated Depreciation — Equipment',
          accountType: 'ASSET',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
        },
        // Accounts Payable
        {
          id: ACC_AP,
          companyId: COMPANY_ID,
          accountCode: '2010',
          accountName: 'Accounts Payable — Trade',
          accountType: 'LIABILITY',
          detailType: 'ACCOUNTS_PAYABLE',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
          isControlAccount: true,
        },
        // Output VAT
        {
          id: ACC_OUT_VAT,
          companyId: COMPANY_ID,
          accountCode: '2020',
          accountName: 'Output VAT Payable (12%)',
          accountType: 'LIABILITY',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
          isTaxAccount: true,
        },
        // Payroll Payables
        {
          id: ACC_SSS_PAY,
          companyId: COMPANY_ID,
          accountCode: '2110',
          accountName: 'SSS Premiums Payable',
          accountType: 'LIABILITY',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
        },
        {
          id: ACC_PHIC_PAY,
          companyId: COMPANY_ID,
          accountCode: '2120',
          accountName: 'PhilHealth Contributions Payable',
          accountType: 'LIABILITY',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
        },
        {
          id: ACC_HDMF_PAY,
          companyId: COMPANY_ID,
          accountCode: '2130',
          accountName: 'Pag-IBIG Contributions Payable',
          accountType: 'LIABILITY',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
        },
        {
          id: ACC_WHT_PAY,
          companyId: COMPANY_ID,
          accountCode: '2140',
          accountName: 'Withholding Tax on Compensation Payable',
          accountType: 'LIABILITY',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
        },
        // Equity
        {
          id: ACC_EQUITY,
          companyId: COMPANY_ID,
          accountCode: '3010',
          accountName: 'Paid-in Capital Stock',
          accountType: 'EQUITY',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
        },
        // Revenue
        {
          id: ACC_REV,
          companyId: COMPANY_ID,
          accountCode: '4010',
          accountName: 'Sales Revenue — Trade',
          accountType: 'REVENUE',
          normalBalance: 'CREDIT',
          status: 'ACTIVE',
        },
        // Header Expense
        {
          id: ACC_HEADER_EXP,
          companyId: COMPANY_ID,
          accountCode: '5000',
          accountName: 'Cost & Operating Expenses (Header)',
          accountType: 'EXPENSE',
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
        },
        // COGS
        {
          id: ACC_COGS,
          companyId: COMPANY_ID,
          accountCode: '5010',
          accountName: 'Cost of Goods Sold',
          accountType: 'EXPENSE',
          parentAccountId: ACC_HEADER_EXP,
          isSubAccount: true,
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
        },
        // Operating Expense
        {
          id: ACC_OPEX,
          companyId: COMPANY_ID,
          accountCode: '6010',
          accountName: 'General & Administrative Expenses',
          accountType: 'EXPENSE',
          parentAccountId: ACC_HEADER_EXP,
          isSubAccount: true,
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
        },
        // Bank Fee Expense
        {
          id: ACC_BANK_FEE,
          companyId: COMPANY_ID,
          accountCode: '6015',
          accountName: 'Bank Service Charges & Fees',
          accountType: 'EXPENSE',
          parentAccountId: ACC_HEADER_EXP,
          isSubAccount: true,
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
        },
        // Depreciation Expense
        {
          id: ACC_DEP_EXP,
          companyId: COMPANY_ID,
          accountCode: '6020',
          accountName: 'Depreciation Expense — Equipment',
          accountType: 'EXPENSE',
          parentAccountId: ACC_HEADER_EXP,
          isSubAccount: true,
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
        },
        // Salaries Expense
        {
          id: ACC_SAL_EXP,
          companyId: COMPANY_ID,
          accountCode: '6110',
          accountName: 'Salaries & Wages Expense',
          accountType: 'EXPENSE',
          parentAccountId: ACC_HEADER_EXP,
          isSubAccount: true,
          normalBalance: 'DEBIT',
          status: 'ACTIVE',
        },
        // Inactive Expense
        {
          id: ACC_INACTIVE_EXP,
          companyId: COMPANY_ID,
          accountCode: '6999',
          accountName: 'Discontinued Legacy Department Expense',
          accountType: 'EXPENSE',
          normalBalance: 'DEBIT',
          status: 'INACTIVE',
        },
      ]);

      // 5. Seed Customer & Vendor with default control accounts
      await compDb.insert(schema.customers).values({
        id: 'cust-audit-001',
        companyId: COMPANY_ID,
        code: 'CUST-001',
        legalName: 'Apex Commercial Distributing Inc.',
        tin: '222-333-444-000',
        defaultReceivableAccountId: ACC_AR,
        paymentTerms: 'NET30',
        status: 'ACTIVE',
      });

      await compDb.insert(schema.vendors).values({
        id: 'vend-audit-001',
        companyId: COMPANY_ID,
        code: 'VEND-001',
        legalName: 'Manila Industrial Supply Co.',
        tin: '555-666-777-000',
        defaultPayableAccountId: ACC_AP,
        defaultExpenseAccountId: ACC_OPEX,
        status: 'ACTIVE',
      });
    });
  });

  afterAll(async () => {
    await cleanupCompany();
  });

  // =========================================================================
  // PHASE 1: CHART OF ACCOUNTS MASTER AUDIT & DROPDOWN ELIGIBILITY
  // =========================================================================
  describe('PHASE 1: Chart of Accounts Master Audit & Dropdown Population', () => {
    it('verifies pure eligibility utilities correctly categorize leaf accounts, cash accounts, and headers', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      const allAccounts = await compDb.select().from(schema.accounts).where(eq(schema.accounts.companyId, COMPANY_ID));

      // 1. Postable Leaf Accounts Filter
      const postableLeafs = filterPostableLeafAccounts(allAccounts);
      const postableCodes = postableLeafs.map((a) => a.accountCode);

      // Must include active postable leaves: 1010, 1020, 2026, 1110, 2010, 4010, 6010, etc.
      expect(postableCodes).toContain('1010');
      expect(postableCodes).toContain('1020');
      expect(postableCodes).toContain('2026');
      expect(postableCodes).toContain('1110');
      expect(postableCodes).toContain('4010');
      expect(postableCodes).toContain('6010');

      // MUST NOT include header accounts
      expect(postableCodes).not.toContain('1000');
      expect(postableCodes).not.toContain('5000');

      // MUST NOT include inactive accounts
      expect(postableCodes).not.toContain('6999');

      // 2. Eligible Cash / Bank Accounts Filter
      const cashAccounts = filterEligibleCashBankAccounts(allAccounts);
      const cashCodes = cashAccounts.map((a) => a.accountCode);

      // Must include 1010, 1020, and 2026
      expect(cashCodes).toContain('1010');
      expect(cashCodes).toContain('1020');
      expect(cashCodes).toContain('2026');

      // Must NOT include non-cash accounts
      expect(cashCodes).not.toContain('1110'); // AR
      expect(cashCodes).not.toContain('2010'); // AP
      expect(cashCodes).not.toContain('4010'); // Revenue
      expect(cashCodes).not.toContain('1000'); // Header
    });

    it('verifies HTTP API /api/master-data/accounts returns 1010, 1020, and 2026 simultaneously', async () => {
      const res = await request(app)
        .get('/api/master-data/accounts?raw=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-company-id', COMPANY_ID);

      expect(res.status).toBe(200);
      const accountsList = Array.isArray(res.body) ? res.body : res.body.data;
      expect(Array.isArray(accountsList)).toBe(true);

      const acc1010 = accountsList.find((a: any) => a.accountCode === '1010');
      const acc2026 = accountsList.find((a: any) => a.accountCode === '2026');
      const acc1020 = accountsList.find((a: any) => a.accountCode === '1020');

      expect(acc1010).toBeDefined();
      expect(acc1010.accountName).toContain('Cash in Bank');
      expect(acc1010.isCashAccount).toBeTruthy();

      expect(acc2026).toBeDefined();
      expect(acc2026.accountName).toBe('BDO Business Checking Account');
      expect(acc2026.isCashAccount).toBeTruthy();
      expect(acc2026.detailType).toBe('CHECKING');

      expect(acc1020).toBeDefined();
      expect(acc1020.isCashAccount).toBeTruthy();

      // Ensure both 1010 and 2026 coexist without collisions
      expect(acc1010.id).not.toBe(acc2026.id);
      expect(acc1010.accountCode).not.toBe(acc2026.accountCode);
    });

    it('verifies resolveCompanyControlAccount resolves CASH correctly for preferred and default accounts', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        // Preferred 2026 explicitly requested -> must resolve to 2026
        const resolved2026 = await resolveCompanyControlAccount(compDb, COMPANY_ID, 'CASH', ACC_BDO_2026);
        expect(resolved2026).toBeDefined();
        expect(resolved2026?.id).toBe(ACC_BDO_2026);
        expect(resolved2026?.accountCode).toBe('2026');

        // Preferred 1010 explicitly requested -> must resolve to 1010
        const resolved1010 = await resolveCompanyControlAccount(compDb, COMPANY_ID, 'CASH', ACC_CASH_1010);
        expect(resolved1010).toBeDefined();
        expect(resolved1010?.id).toBe(ACC_CASH_1010);
        expect(resolved1010?.accountCode).toBe('1010');

        // Default resolution without preferred -> resolves to eligible cash account
        const defaultCash = await resolveCompanyControlAccount(compDb, COMPANY_ID, 'CASH');
        expect(defaultCash).toBeDefined();
        expect(['1010', '2026', '1020']).toContain(defaultCash?.accountCode);
      });
    });
  });

  // =========================================================================
  // PHASE 2: CASH & BANKING FULL LIFECYCLE FOR ACCOUNT 2026 (BDO CHECKING)
  // =========================================================================
  describe('PHASE 2: Cash & Banking Full Lifecycle for Account 2026 (BDO Checking)', () => {
    it('creates, approves, and posts a Cash Receipt of ₱100,000 directly into Account 2026', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        // 1. Create Receipt Txn
        txnId = await createCashTransaction(
          COMPANY_ID,
          {
            accountId: ACC_BDO_2026,
            type: 'RECEIPT',
            amount: 10000000, // ₱100,000.00
            transactionDate: txDate,
            reference: 'CR-2026-001',
            description: 'Direct customer deposit into BDO Checking',
            lines: [
              {
                accountId: ACC_REV,
                amount: 10000000,
                description: 'Sales Revenue offset',
              },
            ],
          },
          ACCOUNTANT_USER_ID,
          'ACCOUNTANT'
        );

        expect(txnId).toBeDefined();

        // 2. Submit
        await submitCashTransaction(COMPANY_ID, txnId, ACCOUNTANT_USER_ID);

        // 3. Approve (Segregation of Duties: Approver != Submitter)
        await approveCashTransaction(COMPANY_ID, txnId, APPROVER_USER_ID);

        // 4. Post to GL
        await postCashTransaction(
          COMPANY_ID,
          txnId,
          PERIOD_ID,
          undefined,
          ADMIN_USER_ID,
          undefined,
          'ADMIN'
        );

        // 5. Verify transaction status & GL Journal Entry
        const postedTxn = await compDb
          .select()
          .from(schema.cashTransactions)
          .where(eq(schema.cashTransactions.id, txnId))
          .get();

        expect(postedTxn?.status).toBe('POSTED');
        expect(postedTxn?.journalEntryId).toBeDefined();

        const je = await compDb
          .select()
          .from(schema.journalEntries)
          .where(eq(schema.journalEntries.id, postedTxn!.journalEntryId!))
          .get();

        expect(je).toBeDefined();
        expect(je?.status).toBe('POSTED');

        const lines = await compDb
          .select()
          .from(schema.journalLines)
          .where(eq(schema.journalLines.journalEntryId, je!.id));

        expect(lines.length).toBe(2);

        const debitLine = lines.find((l) => l.debit > 0);
        const creditLine = lines.find((l) => l.credit > 0);

        // Cash Debit must be Account 2026
        expect(debitLine?.accountId).toBe(ACC_BDO_2026);
        expect(debitLine?.debit).toBe(10000000);

        // Revenue Credit must be Account 4010
        expect(creditLine?.accountId).toBe(ACC_REV);
        expect(creditLine?.credit).toBe(10000000);
      });
    });

    it('issues a Corporate Check on Account 2026, clears it, and bounces it with atomic GL reversal lineage', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        // 1. Issue check drawn on Account 2026
        checkId = await createCheck(
          COMPANY_ID,
          {
            checkNumber: '0000800201',
            checkDate: txDate,
            payeeName: 'Manila Heavy Industries',
            cashAccountId: ACC_BDO_2026,
            amount: 2500000, // ₱25,000.00
            voucherNumber: 'CV-2026-01',
            notes: 'Advance equipment maintenance check',
          },
          ACCOUNTANT_USER_ID
        );

        expect(checkId).toBeDefined();

        // 2. Mark Cleared
        await clearCheck(COMPANY_ID, checkId, txDate, ACCOUNTANT_USER_ID);

        let chk = await compDb.select().from(schema.checks).where(eq(schema.checks.id, checkId)).get();
        expect(chk?.status).toBe('CLEARED');

        // 3. Mark Bounced NSF with GL Reversal
        const bounceResult = await bounceCheck(
          COMPANY_ID,
          checkId,
          'Insufficient funds returned by bank',
          PERIOD_ID,
          ADMIN_USER_ID,
          'ADMIN'
        );

        expect(bounceResult.status).toBe('BOUNCED');
        expect(bounceResult.reversalEntryId).toBeDefined();

        chk = await compDb.select().from(schema.checks).where(eq(schema.checks.id, checkId)).get();
        expect(chk?.status).toBe('BOUNCED');
        expect(chk?.cancellationJournalEntryId).toBe(bounceResult.reversalEntryId);

        // Verify GL reversal entry
        const revJe = await compDb
          .select()
          .from(schema.journalEntries)
          .where(eq(schema.journalEntries.id, bounceResult.reversalEntryId!))
          .get();

        expect(revJe).toBeDefined();
        expect(revJe?.status).toBe('POSTED');

        const revLines = await compDb
          .select()
          .from(schema.journalLines)
          .where(eq(schema.journalLines.journalEntryId, revJe!.id));

        expect(revLines.length).toBe(2);
        const totalDebit = revLines.reduce((s, l) => s + l.debit, 0);
        const totalCredit = revLines.reduce((s, l) => s + l.credit, 0);
        expect(totalDebit).toBe(2500000);
        expect(totalCredit).toBe(2500000);
      });
    });

    it('creates and posts a Bank Deposit batch transferring ₱15,000 from Petty Cash (1020) to BDO Checking (2026)', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        // 1. Create deposit
        depositId = await createBankDeposit(
          COMPANY_ID,
          {
            depositNumber: 'DEP-2026-001',
            depositDate: txDate,
            toBankAccountId: ACC_BDO_2026,
            fromCashAccountId: ACC_PETTY_1020,
            totalAmount: 1500000, // ₱15,000.00
            reference: 'BDO-SLIP-998822',
            notes: 'Petty cash excess transfer to BDO checking',
          },
          ACCOUNTANT_USER_ID,
          'ACCOUNTANT'
        );

        expect(depositId).toBeDefined();

        // 2. Submit & Approve
        await submitBankDeposit(COMPANY_ID, depositId, ACCOUNTANT_USER_ID);
        await approveBankDeposit(COMPANY_ID, depositId, APPROVER_USER_ID);

        // 3. Post to GL
        await postBankDeposit(COMPANY_ID, depositId, PERIOD_ID, ADMIN_USER_ID, 'ADMIN');

        const dep = await compDb.select().from(schema.bankDeposits).where(eq(schema.bankDeposits.id, depositId)).get();
        expect(dep?.status).toBe('POSTED');
        expect(dep?.journalEntryId).toBeDefined();

        const je = await compDb
          .select()
          .from(schema.journalEntries)
          .where(eq(schema.journalEntries.id, dep!.journalEntryId!))
          .get();

        const lines = await compDb
          .select()
          .from(schema.journalLines)
          .where(eq(schema.journalLines.journalEntryId, je!.id));

        expect(lines.length).toBe(2);

        // Debit BDO Checking (2026)
        const debitLine = lines.find((l) => l.debit > 0);
        expect(debitLine?.accountId).toBe(ACC_BDO_2026);
        expect(debitLine?.debit).toBe(1500000);

        // Credit Petty Cash (1020)
        const creditLine = lines.find((l) => l.credit > 0);
        expect(creditLine?.accountId).toBe(ACC_PETTY_1020);
        expect(creditLine?.credit).toBe(1500000);
      });
    });

    it('verifies Cashbook for Account 2026 calculates accurate running balance and GL ledger reconciliation', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        const cashbook = await getCashbook(COMPANY_ID, ACC_BDO_2026, '2026-01-01', '2026-12-31');

        expect(cashbook).toBeDefined();
        expect(cashbook.account.accountCode).toBe('2026');
        expect(cashbook.account.accountName).toBe('BDO Business Checking Account');

        // Total debits to 2026:
        // +₱100,000 (Cash Receipt)
        // +₱25,000 (Bounced Check Debit Reversal)
        // +₱15,000 (Bank Deposit)
        // Net = ₱140,000.00
        expect(cashbook.closingBalance).toBe(14000000);
        expect(cashbook.glLedgerBalance).toBe(14000000);
        expect(cashbook.isReconciled).toBe(true);
        expect(cashbook.transactions.length).toBeGreaterThanOrEqual(3);
      });
    });
  });

  // =========================================================================
  // PHASE 3: BANK RECONCILIATION ON ACCOUNT 2026 & COEXISTENCE WITH 1010
  // =========================================================================
  describe('PHASE 3: Bank Reconciliation on Account 2026 & Account 1010 Coexistence', () => {
    let reconId2026: string;

    it('starts bank reconciliation on Account 2026 and adds book adjustments with postable offset accounts', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        // 1. Create bank reconciliation on Account 2026
        reconId2026 = await createBankReconciliation(
          COMPANY_ID,
          {
            bankAccountId: ACC_BDO_2026,
            statementDate: txDate,
            statementEndingBalance: 13950000, // ₱139,500.00 (₱140,000 book minus ₱500 bank charge)
            notes: 'November 2026 BDO Checking Statement Reconciliation',
          },
          ACCOUNTANT_USER_ID
        );

        expect(reconId2026).toBeDefined();

        // 2. Insert statement lines
        await compDb.insert(schema.bankStatementLines).values([
          {
            id: crypto.randomUUID(),
            companyId: COMPANY_ID,
            bankAccountId: ACC_BDO_2026,
            bankReconciliationId: reconId2026,
            lineDate: txDate,
            description: 'Customer deposit',
            reference: 'REF-BDO-01',
            type: 'DEPOSIT',
            amount: 10000000,
            matchedStatus: 'MATCHED',
            matchedEntityId: txnId,
          },
          {
            id: crypto.randomUUID(),
            companyId: COMPANY_ID,
            bankAccountId: ACC_BDO_2026,
            bankReconciliationId: reconId2026,
            lineDate: txDate,
            description: 'Petty cash batch deposit',
            reference: 'REF-BDO-02',
            type: 'DEPOSIT',
            amount: 1500000,
            matchedStatus: 'MATCHED',
            matchedEntityId: depositId,
          },
          {
            id: crypto.randomUUID(),
            companyId: COMPANY_ID,
            bankAccountId: ACC_BDO_2026,
            bankReconciliationId: reconId2026,
            lineDate: txDate,
            description: 'Returned check correction',
            reference: 'REF-BDO-03',
            type: 'DEPOSIT',
            amount: 2500000,
            matchedStatus: 'MATCHED',
            matchedEntityId: checkId,
          },
        ]);

        // 3. Add book adjustment: Bank Service Charge of ₱500.00 offset to ACC_BANK_FEE
        await compDb.insert(schema.bankReconciliationAdjustments).values({
          id: crypto.randomUUID(),
          companyId: COMPANY_ID,
          bankReconciliationId: reconId2026,
          adjustmentDate: txDate,
          type: 'BANK_CHARGE',
          amount: 50000, // ₱500.00
          offsetAccountId: ACC_BANK_FEE,
          description: 'Monthly Corporate Account Maintenance Fee',
          reference: 'BDO-FEE-NOV26',
        });

        // 4. Recalculate metrics
        const metrics = await recalculateBankReconciliationMetrics(COMPANY_ID, reconId2026);
        expect(metrics.unexplainedDifference).toBe(0);

        // 5. Approve Bank Reconciliation & Verify Adjustment Journal Entry
        await approveBankReconciliation(COMPANY_ID, reconId2026, PERIOD_ID, ADMIN_USER_ID);

        const recon = await compDb
          .select()
          .from(schema.bankReconciliations)
          .where(eq(schema.bankReconciliations.id, reconId2026))
          .get();

        expect(recon?.status).toBe('APPROVED');
        expect(recon?.journalEntryId).toBeDefined();

        const adjJe = await compDb
          .select()
          .from(schema.journalEntries)
          .where(eq(schema.journalEntries.id, recon!.journalEntryId!))
          .get();

        expect(adjJe?.status).toBe('POSTED');

        const adjLines = await compDb
          .select()
          .from(schema.journalLines)
          .where(eq(schema.journalLines.journalEntryId, adjJe!.id));

        expect(adjLines.length).toBe(2);

        // Debit Bank Fee Expense
        const feeDebit = adjLines.find((l) => l.debit > 0);
        expect(feeDebit?.accountId).toBe(ACC_BANK_FEE);
        expect(feeDebit?.debit).toBe(50000);

        // Credit BDO Checking (2026)
        const bdoCredit = adjLines.find((l) => l.credit > 0);
        expect(bdoCredit?.accountId).toBe(ACC_BDO_2026);
        expect(bdoCredit?.credit).toBe(50000);
      });
    });

    it('verifies Operations Dashboard and Financial Source of Truth recognize Account 1010 and Account 2026 as active bank accounts', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        const ops = await FinancialSourceOfTruthService.buildOperationsRollup(COMPANY_ID);
        expect(ops).toBeDefined();
        // Bank accounts count must reflect active bank accounts in COA
        expect(ops.banking.bankAccounts).toBeGreaterThanOrEqual(2);
      });
    });
  });

  // =========================================================================
  // PHASE 4: 8-DOMAIN GENERAL LEDGER POSTING INTEGRATION
  // =========================================================================
  describe('PHASE 4: 8-Domain General Ledger Posting Integration', () => {
    let salesInvId: string;
    let purchaseBillId: string;

    it('Domain 1 & 2: Posts Sales Invoice to AR and settles via Customer Payment to Account 2026', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        // Domain 1: Sales Invoice
        salesInvId = await createSalesInvoice(
          COMPANY_ID,
          {
            customerId: 'cust-audit-001',
            invoiceNumber: 'INV-2026-001',
            invoiceDate: txDate,
            dueDate: '2026-12-16',
            totalAmount: 11200000, // ₱112,000 (₱100,000 + ₱12,000 VAT)
            lines: [
              {
                description: 'Industrial Sensor Assemblies',
                quantity: 1,
                unitPrice: 10000000,
                amount: 10000000,
                taxAmount: 1200000,
                accountId: ACC_REV,
              },
            ],
          },
          ACCOUNTANT_USER_ID,
          'ACCOUNTANT'
        );

        await submitSalesInvoice(COMPANY_ID, salesInvId, ACCOUNTANT_USER_ID);
        await approveSalesInvoice(COMPANY_ID, salesInvId, APPROVER_USER_ID);
        await postSalesInvoice(COMPANY_ID, salesInvId, PERIOD_ID, [], ADMIN_USER_ID, 'ADMIN');

        const si = await compDb.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, salesInvId)).get();
        expect(si?.status).toBe('POSTED');

        const siJe = await compDb.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, si!.journalEntryId!)).get();
        expect(siJe?.status).toBe('POSTED');

        // Domain 2: Customer Payment settled directly into Account 2026
        const pmtId = await createCustomerPayment(
          COMPANY_ID,
          {
            customerId: 'cust-audit-001',
            paymentNumber: 'PMT-2026-001',
            paymentDate: txDate,
            cashAccountId: ACC_BDO_2026,
            amount: 11200000,
            applications: [
              {
                invoiceId: salesInvId,
                appliedAmount: 11200000,
              },
            ],
          },
          ACCOUNTANT_USER_ID,
          'ACCOUNTANT'
        );

        await submitCustomerPayment(COMPANY_ID, pmtId, ACCOUNTANT_USER_ID);
        await approveCustomerPayment(COMPANY_ID, pmtId, APPROVER_USER_ID);
        await postCustomerPayment(COMPANY_ID, pmtId, PERIOD_ID, ADMIN_USER_ID, undefined, 'ADMIN');

        const pmt = await compDb.select().from(schema.customerPayments).where(eq(schema.customerPayments.id, pmtId)).get();
        expect(pmt?.status).toBe('POSTED');

        const pmtJe = await compDb.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, pmt!.journalEntryId!)).get();
        const pmtLines = await compDb.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, pmtJe!.id));

        // Debit BDO Checking 2026, Credit AR
        const debitLine = pmtLines.find((l) => l.debit > 0);
        expect(debitLine?.accountId).toBe(ACC_BDO_2026);
        expect(debitLine?.debit).toBe(11200000);
      });
    });

    it('Domain 3 & 4: Posts Purchase Bill to AP and disburses payment from Account 2026', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        // Domain 3: Purchase Bill
        purchaseBillId = await createPurchaseBill(
          COMPANY_ID,
          {
            vendorId: 'vend-audit-001',
            billNumber: 'PB-2026-001',
            billDate: txDate,
            dueDate: '2026-12-16',
            totalAmount: 5000000, // ₱50,000.00
            lines: [
              {
                accountId: ACC_OPEX,
                description: 'Consulting & Facility Support',
                quantity: 1,
                unitPrice: 5000000,
                amount: 5000000,
              },
            ],
          },
          ACCOUNTANT_USER_ID,
          'ACCOUNTANT'
        );

        await submitPurchaseBill(COMPANY_ID, purchaseBillId, ACCOUNTANT_USER_ID);
        await approvePurchaseBill(COMPANY_ID, purchaseBillId, APPROVER_USER_ID);
        await postPurchaseBill(COMPANY_ID, purchaseBillId, PERIOD_ID, [], ADMIN_USER_ID, 'ADMIN');

        const pb = await compDb.select().from(schema.purchaseBills).where(eq(schema.purchaseBills.id, purchaseBillId)).get();
        expect(pb?.status).toBe('POSTED');

        // Domain 4: Supplier Payment disbursed from Account 2026
        const suppPmtId = await createSupplierPayment(
          COMPANY_ID,
          {
            vendorId: 'vend-audit-001',
            paymentNumber: 'SP-2026-001',
            paymentDate: txDate,
            cashAccountId: ACC_BDO_2026,
            amount: 5000000,
            applications: [
              {
                billId: purchaseBillId,
                appliedAmount: 5000000,
              },
            ],
          },
          ACCOUNTANT_USER_ID,
          'ACCOUNTANT'
        );

        await submitSupplierPayment(COMPANY_ID, suppPmtId, ACCOUNTANT_USER_ID);
        await approveSupplierPayment(COMPANY_ID, suppPmtId, APPROVER_USER_ID);
        await postSupplierPayment(COMPANY_ID, suppPmtId, PERIOD_ID, ADMIN_USER_ID, undefined, 'ADMIN');

        const sp = await compDb.select().from(schema.supplierPayments).where(eq(schema.supplierPayments.id, suppPmtId)).get();
        expect(sp?.status).toBe('POSTED');

        const spJe = await compDb.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, sp!.journalEntryId!)).get();
        const spLines = await compDb.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, spJe!.id));

        // Credit BDO Checking 2026, Debit AP
        const creditLine = spLines.find((l) => l.credit > 0);
        expect(creditLine?.accountId).toBe(ACC_BDO_2026);
        expect(creditLine?.credit).toBe(5000000);
      });
    });

    it('Domain 5, 6 & 7: Posts balanced GL entries for Inventory Costing, Fixed Asset Depreciation, and Payroll Run', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        // Domain 5: Inventory Costing (COGS Debit, Inventory Asset Credit)
        const invJeId = await createJournalEntry(
          COMPANY_ID,
          {
            journalNumber: 'JV-INV-COGS-001',
            entryDate: txDate,
            accountingPeriodId: PERIOD_ID,
            description: 'Inventory Cost of Goods Sold Allocation',
            sourceType: 'INVENTORY_COSTING',
            createdBy: ACCOUNTANT_USER_ID,
            userRole: 'ACCOUNTANT',
          },
          [
            { accountId: ACC_COGS, debit: 3000000, credit: 0, description: 'Cost of goods sold' },
            { accountId: ACC_INV, debit: 0, credit: 3000000, description: 'Inventory reduction' },
          ]
        );
        await submitJournalEntry(COMPANY_ID, invJeId, ACCOUNTANT_USER_ID);
        await approveJournalEntry(COMPANY_ID, invJeId, APPROVER_USER_ID);
        await postJournalEntry(COMPANY_ID, invJeId, ADMIN_USER_ID, 'ADMIN');

        // Domain 6: Fixed Asset Depreciation (Depreciation Expense Debit, Accumulated Depreciation Credit)
        const depJeId = await createJournalEntry(
          COMPANY_ID,
          {
            journalNumber: 'JV-DEP-2026-11',
            entryDate: txDate,
            accountingPeriodId: PERIOD_ID,
            description: 'Monthly Equipment Straight-Line Depreciation',
            sourceType: 'FIXED_ASSET_DEPRECIATION',
            createdBy: ACCOUNTANT_USER_ID,
            userRole: 'ACCOUNTANT',
          },
          [
            { accountId: ACC_DEP_EXP, debit: 850000, credit: 0, description: 'Depreciation expense' },
            { accountId: ACC_FA_ACCUM, debit: 0, credit: 850000, description: 'Accumulated depreciation' },
          ]
        );
        await submitJournalEntry(COMPANY_ID, depJeId, ACCOUNTANT_USER_ID);
        await approveJournalEntry(COMPANY_ID, depJeId, APPROVER_USER_ID);
        await postJournalEntry(COMPANY_ID, depJeId, ADMIN_USER_ID, 'ADMIN');

        // Domain 7: Payroll Run (Gross Pay Debit, Statutory Liabilities Credit, Net Pay/Cash Credit)
        const payrollJeId = await createJournalEntry(
          COMPANY_ID,
          {
            journalNumber: 'JV-PR-2026-11A',
            entryDate: txDate,
            accountingPeriodId: PERIOD_ID,
            description: 'Semi-Monthly Executive and Staff Payroll',
            sourceType: 'PAYROLL_RUN',
            createdBy: ACCOUNTANT_USER_ID,
            userRole: 'ACCOUNTANT',
          },
          [
            { accountId: ACC_SAL_EXP, debit: 5000000, credit: 0, description: 'Gross Salaries' },
            { accountId: ACC_SSS_PAY, debit: 0, credit: 225000, description: 'SSS employee share' },
            { accountId: ACC_PHIC_PAY, debit: 0, credit: 125000, description: 'PhilHealth employee share' },
            { accountId: ACC_HDMF_PAY, debit: 0, credit: 50000, description: 'Pag-IBIG employee share' },
            { accountId: ACC_WHT_PAY, debit: 0, credit: 400000, description: 'Withholding tax compensation' },
            { accountId: ACC_BDO_2026, debit: 0, credit: 4200000, description: 'Net payroll disbursement from BDO' },
          ]
        );
        await submitJournalEntry(COMPANY_ID, payrollJeId, ACCOUNTANT_USER_ID);
        await approveJournalEntry(COMPANY_ID, payrollJeId, APPROVER_USER_ID);
        await postJournalEntry(COMPANY_ID, payrollJeId, ADMIN_USER_ID, 'ADMIN');

        // Verify all 3 posted entries
        for (const jId of [invJeId, depJeId, payrollJeId]) {
          const entry = await compDb.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, jId)).get();
          expect(entry?.status).toBe('POSTED');

          const lines = await compDb.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, jId));
          const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
          const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
          expect(totalDebit).toBe(totalCredit);
          expect(totalDebit).toBeGreaterThan(0);
        }
      });
    });
  });

  // =========================================================================
  // PHASE 5: ADVERSARIAL INTEGRITY & VALIDATION CONSTRAINTS
  // =========================================================================
  describe('PHASE 5: Adversarial, Integrity & Error Handling', () => {
    it('rejects posting to an INACTIVE account', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        await expect(
          createJournalEntry(
            COMPANY_ID,
            {
              journalNumber: 'JV-FAIL-INACT',
              entryDate: txDate,
              accountingPeriodId: PERIOD_ID,
              description: 'Attempted posting to inactive account',
              createdBy: ACCOUNTANT_USER_ID,
              userRole: 'ACCOUNTANT',
            },
            [
              { accountId: ACC_INACTIVE_EXP, debit: 100000, credit: 0 },
              { accountId: ACC_BDO_2026, debit: 0, credit: 100000 },
            ]
          )
        ).rejects.toThrow();
      });
    });

    it('rejects posting to a parent HEADER account', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        await expect(
          createJournalEntry(
            COMPANY_ID,
            {
              journalNumber: 'JV-FAIL-HDR',
              entryDate: txDate,
              accountingPeriodId: PERIOD_ID,
              description: 'Attempted posting to parent header account',
              createdBy: ACCOUNTANT_USER_ID,
              userRole: 'ACCOUNTANT',
            },
            [
              { accountId: ACC_HEADER_ASSETS, debit: 100000, credit: 0 },
              { accountId: ACC_BDO_2026, debit: 0, credit: 100000 },
            ]
          )
        ).rejects.toThrow();
      });
    });

    it('rejects creating an unbalanced journal entry', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        await expect(
          createJournalEntry(
            COMPANY_ID,
            {
              journalNumber: 'JV-FAIL-UNBAL',
              entryDate: txDate,
              accountingPeriodId: PERIOD_ID,
              description: 'Unbalanced journal entry test',
              createdBy: ACCOUNTANT_USER_ID,
              userRole: 'ACCOUNTANT',
            },
            [
              { accountId: ACC_OPEX, debit: 500000, credit: 0 },
              { accountId: ACC_BDO_2026, debit: 0, credit: 490000 }, // ₱100 mismatch
            ]
          )
        ).rejects.toThrow();
      });
    });

    it('prevents duplicate reversals of the same posted journal entry', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        // 1. Create and post an original journal entry
        const origId = await createJournalEntry(
          COMPANY_ID,
          {
            journalNumber: 'JV-REV-TEST-001',
            entryDate: txDate,
            accountingPeriodId: PERIOD_ID,
            description: 'Original entry to be reversed once',
            createdBy: ACCOUNTANT_USER_ID,
            userRole: 'ACCOUNTANT',
          },
          [
            { accountId: ACC_OPEX, debit: 150000, credit: 0 },
            { accountId: ACC_BDO_2026, debit: 0, credit: 150000 },
          ]
        );
        await submitJournalEntry(COMPANY_ID, origId, ACCOUNTANT_USER_ID);
        await approveJournalEntry(COMPANY_ID, origId, APPROVER_USER_ID);
        await postJournalEntry(COMPANY_ID, origId, ADMIN_USER_ID, 'ADMIN');

        // 2. First reversal -> must succeed
        const revId = await reverseJournalEntry(
          COMPANY_ID,
          origId,
          ADMIN_USER_ID,
          txDate,
          PERIOD_ID,
          'ADMIN'
        );
        expect(revId).toBeDefined();

        // 3. Second reversal attempt on the same original entry -> MUST FAIL with ALREADY_REVERSED
        await expect(
          reverseJournalEntry(
            COMPANY_ID,
            origId,
            ADMIN_USER_ID,
            txDate,
            PERIOD_ID,
            'ADMIN'
          )
        ).rejects.toThrow(/already been reversed/i);
      });
    });
  });

  // =========================================================================
  // PHASE 6: BANK REGISTRY-TO-COA FK LINKAGE, CUSTOM COA INDEPENDENCE & VERSIONED BIR TAX RULE REGISTRY
  // =========================================================================
  describe('PHASE 6: Bank Registry-to-COA FK Linkage, Configurable Custom COA Independence & Versioned BIR Tax Rule Registry', () => {
    it('links Bank Account Registry (schema.bankAccounts) via authoritative glAccountId FK to COA 2026 (BDO) and rejects invalid/header/non-cash GL accounts', async () => {
      const compDb = await CompanyManager.getCompanyDb(COMPANY_ID);
      await dbContext.run(compDb, async () => {
        // 1. Create BDO Bank Account linked explicitly to ACC_BDO_2026
        const createdBdo = await BankReconciliationService.createBankAccount({
          companyId: COMPANY_ID,
          accountName: 'BDO Business Checking Account',
          bankName: 'BDO Unibank',
          accountNumber: '0045-8899-2026',
          currency: 'PHP',
          glAccountId: ACC_BDO_2026,
        });

        expect(createdBdo.glAccountId).toBe(ACC_BDO_2026);
        expect(createdBdo.glAccountCode).toBe('2026');
        expect(createdBdo.glAccountName).toBe('BDO Business Checking Account');
        expect(createdBdo.isGlLinked).toBe(true);
        expect(createdBdo.accountNumberMasked).toBe('••••-2026');

        // 2. Verify getBankAccounts returns authoritative COA linkage metadata
        const allBankAccounts = await BankReconciliationService.getBankAccounts(COMPANY_ID);
        const foundBdo = allBankAccounts.find((b) => b.id === createdBdo.id);
        expect(foundBdo).toBeDefined();
        expect(foundBdo?.glAccountId).toBe(ACC_BDO_2026);
        expect(foundBdo?.glAccountCode).toBe('2026');
        expect(foundBdo?.isGlLinked).toBe(true);

        // 3. Reject non-existent / cross-company GL account
        await expect(
          BankReconciliationService.createBankAccount({
            companyId: COMPANY_ID,
            accountName: 'Invalid Cross-Tenant Bank',
            bankName: 'BPI',
            accountNumber: '1111-2222-3333',
            glAccountId: 'acc-foreign-company-9999',
          })
        ).rejects.toThrow(/BANK_GL_ACCOUNT_NOT_FOUND/);

        // 4. Reject parent HEADER GL account
        await expect(
          BankReconciliationService.createBankAccount({
            companyId: COMPANY_ID,
            accountName: 'Header Bank Attempt',
            bankName: 'BPI',
            accountNumber: '1111-2222-3333',
            glAccountId: ACC_HEADER_ASSETS,
          })
        ).rejects.toThrow(/BANK_GL_ACCOUNT_HEADER/);

        // 5. Reject non-cash Revenue/Expense GL account
        await expect(
          BankReconciliationService.createBankAccount({
            companyId: COMPANY_ID,
            accountName: 'Revenue Account Mislink Attempt',
            bankName: 'BPI',
            accountNumber: '1111-2222-3333',
            glAccountId: ACC_OPEX,
          })
        ).rejects.toThrow(/BANK_GL_ACCOUNT_INVALID_TYPE/);

        // 6. Verify Cash/Bank Tax Neutrality (linking 2026 BDO to COA never auto-applies VAT or EWT)
        const bdoAccRow = await compDb
          .select()
          .from(schema.accounts)
          .where(eq(schema.accounts.id, ACC_BDO_2026))
          .get();
        const neutrality = TaxEngine.verifyCashBankTaxNeutrality(bdoAccRow!);
        expect(neutrality.isCashOrBankAccount).toBe(true);
        expect(neutrality.autoVatApplicable).toBe(false);
        expect(neutrality.autoEwtApplicable).toBe(false);
        expect(neutrality.taxOriginatesFromTransactionOnly).toBe(true);
      });
    });

    it('proves complete COA-to-Register connectivity on a company with custom non-standard COA codes (no 1010/1030/2010/4010/6010)', async () => {
      const CUSTOM_COA_COMPANY_ID = 'LGR-PH-CUSTOM-COA-2026';
      const customDir = path.join(paths.getCompaniesRootDir(), CUSTOM_COA_COMPANY_ID);
      try {
        if (fs.existsSync(customDir)) fs.rmSync(customDir, { recursive: true, force: true });
      } catch {}

      await CompanyManager.createCompanyProfile(
        CUSTOM_COA_COMPANY_ID,
        'Custom COA Philippine Manufacturing Corp.',
        undefined,
        undefined,
        false,
        { classification: 'TEST' }
      );

      const customDb = await CompanyManager.getCompanyDb(CUSTOM_COA_COMPANY_ID);
      try {
        await dbContext.run(customDb, async () => {
          const now = new Date();
          // Replace default COA with completely custom non-standard account codes
          await customDb.delete(schema.accounts).where(eq(schema.accounts.companyId, CUSTOM_COA_COMPANY_ID));

          const customPeriodId = 'prd-custom-coa-2026';
          await customDb
            .insert(schema.accountingPeriods)
            .values({
              id: customPeriodId,
              companyId: CUSTOM_COA_COMPANY_ID,
              name: 'FY 2026 Custom COA Period',
              startDate: '2026-01-01',
              endDate: '2026-12-31',
              fiscalYear: 2026,
              periodNumber: 1,
              status: 'OPEN',
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing();

          await customDb
            .insert(schema.users)
            .values([
              { id: ADMIN_USER_ID, email: 'admin@customcoa.ph', displayName: 'Admin', passwordHash: 'h', status: 'ACTIVE' },
              { id: ACCOUNTANT_USER_ID, email: 'acct@customcoa.ph', displayName: 'Maker', passwordHash: 'h', status: 'ACTIVE' },
              { id: APPROVER_USER_ID, email: 'appr@customcoa.ph', displayName: 'Checker', passwordHash: 'h', status: 'ACTIVE' },
            ])
            .onConflictDoNothing();

          const customAccounts = [
            { id: 'c-bdo-01', accountCode: 'BNK-BDO-01', accountName: 'BDO Corporate Checking', accountType: 'ASSET', detailType: 'CHECKING', normalBalance: 'DEBIT', isCashAccount: true, isControlAccount: false, isTaxAccount: false },
            { id: 'c-ar-01', accountCode: 'TRD-AR-01', accountName: 'Trade Accounts Receivable', accountType: 'RECEIVABLE', detailType: 'ACCOUNTS_RECEIVABLE', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: true, isTaxAccount: false },
            { id: 'c-inv-01', accountCode: 'STK-INV-01', accountName: 'Finished Goods Inventory', accountType: 'ASSET', detailType: 'INVENTORY', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
            { id: 'c-in-vat', accountCode: 'TAX-INVAT-01', accountName: 'Input VAT Receivable', accountType: 'ASSET', detailType: 'INPUT_VAT', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
            { id: 'c-cwt-01', accountCode: 'TAX-2307-01', accountName: 'Creditable Withholding Tax 2307', accountType: 'ASSET', detailType: 'CREDITABLE_WHT', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
            { id: 'c-fa-01', accountCode: 'PPE-EQP-01', accountName: 'Factory Machinery & Equipment', accountType: 'ASSET', detailType: 'FIXED_ASSET', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
            { id: 'c-ad-01', accountCode: 'PPE-ACCDEP-01', accountName: 'Accumulated Depreciation - Machinery', accountType: 'ASSET', detailType: 'ACCUMULATED_DEPRECIATION', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
            { id: 'c-ap-01', accountCode: 'TRD-AP-01', accountName: 'Trade Accounts Payable', accountType: 'PAYABLE', detailType: 'ACCOUNTS_PAYABLE', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: true, isTaxAccount: false },
            { id: 'c-out-vat', accountCode: 'TAX-OUTVAT-01', accountName: 'Output VAT Payable', accountType: 'LIABILITY', detailType: 'OUTPUT_VAT', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
            { id: 'c-ewt-01', accountCode: 'TAX-EWT-01', accountName: 'Expanded Withholding Tax Payable', accountType: 'LIABILITY', detailType: 'EXPANDED_WHT', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
            { id: 'c-fwt-01', accountCode: 'TAX-FWT-01', accountName: 'Final Withholding Tax Payable', accountType: 'LIABILITY', detailType: 'FINAL_WHT', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
            { id: 'c-pt-01', accountCode: 'TAX-OPT-01', accountName: 'Percentage Tax Payable', accountType: 'LIABILITY', detailType: 'PERCENTAGE_TAX', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
            { id: 'c-it-01', accountCode: 'TAX-IT-01', accountName: 'Income Tax Payable', accountType: 'LIABILITY', detailType: 'INCOME_TAX_PAYABLE', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
            { id: 'c-sss-01', accountCode: 'PAY-SSS-01', accountName: 'SSS Contributions Payable', accountType: 'LIABILITY', detailType: 'SSS_PAYABLE', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
            { id: 'c-phic-01', accountCode: 'PAY-PHIC-01', accountName: 'PhilHealth Contributions Payable', accountType: 'LIABILITY', detailType: 'PHILHEALTH_PAYABLE', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
            { id: 'c-hdmf-01', accountCode: 'PAY-HDMF-01', accountName: 'Pag-IBIG Contributions Payable', accountType: 'LIABILITY', detailType: 'PAGIBIG_PAYABLE', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
            { id: 'c-whtc-01', accountCode: 'PAY-1601C-01', accountName: 'Withholding Tax - Compensation (1601-C)', accountType: 'LIABILITY', detailType: 'WHT_COMPENSATION_PAYABLE', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: true },
            { id: 'c-netp-01', accountCode: 'PAY-NET-01', accountName: 'Net Payroll Payable', accountType: 'LIABILITY', detailType: 'NET_PAYROLL_PAYABLE', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
            { id: 'c-eq-01', accountCode: 'EQ-RE-01', accountName: 'Retained Earnings', accountType: 'EQUITY', detailType: 'RETAINED_EARNINGS', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
            { id: 'c-rev-01', accountCode: 'SLS-REV-01', accountName: 'Commercial Sales Revenue', accountType: 'REVENUE', detailType: 'SALES_REVENUE', normalBalance: 'CREDIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
            { id: 'c-cogs-01', accountCode: 'CST-COGS-01', accountName: 'Cost of Goods Sold', accountType: 'COGS', detailType: 'COGS', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
            { id: 'c-opex-01', accountCode: 'EXP-GEN-01', accountName: 'General Operating Expense', accountType: 'EXPENSE', detailType: 'OPERATING_EXPENSE', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
            { id: 'c-dep-01', accountCode: 'EXP-DEP-01', accountName: 'Depreciation Expense - Machinery', accountType: 'EXPENSE', detailType: 'DEPRECIATION_EXPENSE', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
            { id: 'c-sal-01', accountCode: 'EXP-SAL-01', accountName: 'Salaries and Wages Expense', accountType: 'EXPENSE', detailType: 'SALARIES_EXPENSE', normalBalance: 'DEBIT', isCashAccount: false, isControlAccount: false, isTaxAccount: false },
          ];

          for (const acc of customAccounts) {
            await customDb.insert(schema.accounts).values({
              ...acc,
              companyId: CUSTOM_COA_COMPANY_ID,
              isSubAccount: false,
              isRetainedEarnings: acc.id === 'c-eq-01',
              status: 'ACTIVE',
              createdAt: now,
              updatedAt: now,
            });
          }

          // 1. Verify Central Account Mapping Engine resolves all 22 control roles to custom COA codes!
          const mapping = await getCompanyRegisterToCoaMapping(CUSTOM_COA_COMPANY_ID, customDb);
          expect(mapping.unmappedRoles.length).toBe(0);
          expect(mapping.roles.CASH.accountCode).toBe('BNK-BDO-01');
          expect(mapping.roles.AR.accountCode).toBe('TRD-AR-01');
          expect(mapping.roles.AP.accountCode).toBe('TRD-AP-01');
          expect(mapping.roles.REVENUE.accountCode).toBe('SLS-REV-01');
          expect(mapping.roles.INVENTORY.accountCode).toBe('STK-INV-01');
          expect(mapping.roles.COGS.accountCode).toBe('CST-COGS-01');
          expect(mapping.roles.OUTPUT_VAT.accountCode).toBe('TAX-OUTVAT-01');
          expect(mapping.roles.INPUT_VAT.accountCode).toBe('TAX-INVAT-01');
          expect(mapping.roles.CWT.accountCode).toBe('TAX-2307-01');
          expect(mapping.roles.EWT.accountCode).toBe('TAX-EWT-01');
          expect(mapping.roles.FINAL_WHT_PAYABLE.accountCode).toBe('TAX-FWT-01');
          expect(mapping.roles.FIXED_ASSET.accountCode).toBe('PPE-EQP-01');
          expect(mapping.roles.ACCUMULATED_DEPRECIATION.accountCode).toBe('PPE-ACCDEP-01');
          expect(mapping.roles.DEPRECIATION_EXPENSE.accountCode).toBe('EXP-DEP-01');
          expect(mapping.roles.SALARIES_EXPENSE.accountCode).toBe('EXP-SAL-01');
          expect(mapping.roles.SSS_PAYABLE.accountCode).toBe('PAY-SSS-01');
          expect(mapping.roles.PHILHEALTH_PAYABLE.accountCode).toBe('PAY-PHIC-01');
          expect(mapping.roles.PAGIBIG_PAYABLE.accountCode).toBe('PAY-HDMF-01');
          expect(mapping.roles.WHT_COMPENSATION_PAYABLE.accountCode).toBe('PAY-1601C-01');
          expect(mapping.roles.RETAINED_EARNINGS.accountCode).toBe('EQ-RE-01');

          // 2. Post Sales Invoice & Customer Collection using custom COA accounts
          await customDb.insert(schema.customers).values({
            id: 'cust-custom-01',
            companyId: CUSTOM_COA_COMPANY_ID,
            code: 'CUST-C01',
            name: 'Custom COA Client Corp.',
            legalName: 'Custom COA Client Corp.',
            tin: '001-222-333-000',
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
          });

          const invId = await createSalesInvoice(
            CUSTOM_COA_COMPANY_ID,
            {
              customerId: 'cust-custom-01',
              invoiceNumber: 'INV-CUSTOM-001',
              invoiceDate: txDate,
              dueDate: '2026-12-16',
              subtotal: 5000000,
              taxTotal: 600000,
              totalAmount: 5600000,
              balanceDue: 5600000,
              lines: [
                {
                  description: 'Custom COA Sales Item',
                  quantity: 1,
                  unitPrice: 5000000,
                  taxAmount: 600000,
                  amount: 5000000,
                  accountId: 'c-rev-01',
                },
              ],
            },
            ACCOUNTANT_USER_ID,
            'ACCOUNTANT'
          );
          await submitSalesInvoice(CUSTOM_COA_COMPANY_ID, invId, ACCOUNTANT_USER_ID);
          await approveSalesInvoice(CUSTOM_COA_COMPANY_ID, invId, APPROVER_USER_ID);
          await postSalesInvoice(
            CUSTOM_COA_COMPANY_ID,
            invId,
            customPeriodId,
            [{ description: 'Custom COA Sales Item', quantity: 1, unitPrice: 5000000, taxAmount: 600000, amount: 5000000, accountId: 'c-rev-01' }],
            ADMIN_USER_ID,
            'ADMIN'
          );

          // 3. Post Monthly Depreciation & Payroll Run via AccountingEngine on custom COA
          const depJeId = await AccountingEngine.postMonthlyDepreciation(
            CUSTOM_COA_COMPANY_ID,
            ADMIN_USER_ID,
            {
              scheduleId: 'sched-custom-01',
              assetId: 'asset-custom-01',
              assetName: 'CNC Machine',
              periodMonth: '2026-11',
              depreciationAmountCentavos: 250000,
              userRole: 'ADMIN',
            },
            customDb
          );
          expect(depJeId).toBeDefined();

          const depLines = await customDb
            .select()
            .from(schema.journalLines)
            .where(eq(schema.journalLines.journalEntryId, depJeId));
          expect(depLines.find((l) => l.debit > 0)?.accountId).toBe('c-dep-01');
          expect(depLines.find((l) => l.credit > 0)?.accountId).toBe('c-ad-01');
        });
      } finally {
        try {
          if (fs.existsSync(customDir)) fs.rmSync(customDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it('validates the versioned Philippine BIR Tax Rule Registry and distinguishes Final Withholding Tax (FWT) from Creditable EWT', async () => {
      const registry = TaxEngine.getBirTaxRuleRegistry();
      expect(registry.length).toBeGreaterThanOrEqual(9);

      // Verify mandatory rule fields across all registry entries
      for (const rule of registry) {
        expect(rule.ruleId).toBeTruthy();
        expect(rule.ruleVersion).toBeTruthy();
        expect(rule.legalReference).toBeTruthy();
        expect(rule.birForms.length).toBeGreaterThan(0);
        expect(rule.requiredGlControlRoles.length).toBeGreaterThan(0);
      }

      // Verify VAT rule references RMC 5-2023 (2550Q) and RMC 52-2023 (optional 2550M)
      const vatRule = TaxEngine.resolveApplicableBirTaxRule({ ruleId: 'BIR-VAT-12-STD' });
      expect(vatRule?.legalReference).toContain('RMC No. 5-2023');
      expect(vatRule?.legalReference).toContain('RMC No. 52-2023');
      expect(vatRule?.birForms).toEqual(expect.arrayContaining(['2550Q', '2550M']));

      // Verify CAS/CBA rule references RMC 5-2021 and RMC 65-2025
      const casRule = TaxEngine.resolveApplicableBirTaxRule({ ruleId: 'BIR-CAS-CBA-RMC-65-2025' });
      expect(casRule?.legalReference).toContain('RMC No. 5-2021');
      expect(casRule?.legalReference).toContain('RMC No. 65-2025');

      // Verify Final Withholding Tax (FWT) computation & distinction from EWT
      const fwtResult = TaxEngine.calculateFinalWithholdingTax({
        grossAmountCentavos: 10000000, // ₱100,000.00
        atcCode: 'WC150', // 20% Corporate Final Tax on Interest
      });
      expect(fwtResult.rate).toBe(0.20);
      expect(fwtResult.finalTaxWithheldCentavos).toBe(2000000); // ₱20,000.00
      expect(fwtResult.netDisbursementCentavos).toBe(8000000); // ₱80,000.00
      expect(fwtResult.birForms).toEqual(['0619-F', '1601-FQ']);
      expect(fwtResult.certificateForm).toBe('2306');
      expect(fwtResult.requiredGlControlRoles).toContain('FINAL_WHT_PAYABLE');
      expect(fwtResult.isCreditableOnIncomeTaxReturn).toBe(false);

      // Reject invalid/missing FWT ATC code
      expect(() =>
        TaxEngine.calculateFinalWithholdingTax({
          grossAmountCentavos: 10000000,
          atcCode: 'INVALID_ATC',
        })
      ).toThrow(/MISSING_OR_INVALID_FWT_ATC/);
    });
  });
});

