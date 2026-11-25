import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { paths } from '../../src/server/services/paths';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import {
  filterEligibleTaxControlAccounts,
  filterEligibleSourceCashAccounts,
  filterEligibleDestinationBankAccounts,
  filterEligibleRevenueAccounts,
  filterEligibleExpenseAndPurchaseAccounts,
  filterPostableLeafAccounts,
  inferAccountDetailAndBirCategory,
} from '../../src/shared/coaAccountUtils';

describe('LEDGERAI PH — CENTRALIZED COA ACCOUNT SELECTOR & REGISTER CONNECTIVITY', () => {
  const app = createApp();
  const COMPANY_A_ID = 'LGR-PH-COA-SEL-TEST-A';
  const COMPANY_B_ID = 'LGR-PH-COA-SEL-TEST-B';
  const OWNER_A_ID = 'usr-coa-sel-owner-a';
  const ACCOUNTANT_A_ID = 'usr-coa-sel-acc-a';
  const OWNER_B_ID = 'usr-coa-sel-owner-b';

  let ownerAToken = '';
  let accountantAToken = '';
  let ownerBToken = '';

  const ACC = {
    CASH_HEADER: 'acc-sel-1000-hdr',
    BANK_1010: 'acc-sel-1010',
    PETTY_1020: 'acc-sel-1020',
    CASH_ON_HAND: 'acc-sel-1005',
    AR_1030: 'acc-sel-1030',
    INPUT_VAT_1050: 'acc-sel-1050',
    CWT_1060: 'acc-sel-1060',
    AP_2010: 'acc-sel-2010',
    OUTPUT_VAT_2020: 'acc-sel-2020',
    EWT_2030: 'acc-sel-2030',
    PCT_2120: 'acc-sel-2120',
    EQUITY_3010: 'acc-sel-3010',
    REV_4010: 'acc-sel-4010',
    EXP_6040: 'acc-sel-6040',
    INACTIVE_BANK: 'acc-sel-1099-inactive',
    FOREIGN_BANK_B: 'acc-sel-b-1010',
  };

  let customBdoAccountId = '';
  let customTaxAccountId = '';

  const cleanupCompanies = async () => {
    await CompanyManager.closeAllConnections();
    for (const cid of [COMPANY_A_ID, COMPANY_B_ID]) {
      const cdir = path.join(paths.getCompaniesRootDir(), cid);
      const laiFile = `${cdir}.lai`;
      if (fs.existsSync(cdir)) {
        try { fs.rmSync(cdir, { recursive: true, force: true }); } catch {}
      }
      if (fs.existsSync(laiFile)) {
        try { fs.rmSync(laiFile, { force: true }); } catch {}
      }
      try { await CompanyManager.deleteCompany(cid); } catch {}
    }
  };

  const seedTestCompany = async (
    companyId: string,
    companyName: string,
    ownerId: string,
    accountantId?: string
  ) => {
    await CompanyManager.createCompanyProfile(
      companyId,
      companyName,
      undefined,
      undefined,
      false,
      { classification: 'TEST' }
    );
    const compDb = await CompanyManager.getCompanyDb(companyId);
    let tokOwner = '';
    let tokAcc = '';

    await dbContext.run(compDb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      const setupRole = await RbacService.ensureRoleRecord('Company Owner');
      const bookkeeperRole = await RbacService.ensureRoleRecord('Bookkeeper');

      await compDb.insert(schema.users).values({
        id: ownerId,
        email: `${ownerId}@test.ph`,
        displayName: `Owner ${companyId}`,
        passwordHash: 'dummy-hash',
        status: 'ACTIVE',
      });
      await compDb.insert(schema.companyUsers).values({
        id: `mem-${ownerId}`,
        userId: ownerId,
        companyId,
        roleId: setupRole.id,
        legacyRole: 'Company Owner',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        defaultDataScope: 'COMPANY_WIDE',
      });
      await compDb.insert(schema.companyUserRoles).values({
        id: `cur-${ownerId}`,
        companyUserId: `mem-${ownerId}`,
        roleId: setupRole.id,
        roleCode: setupRole.code,
        roleTemplateVersion: 1,
        isPrimary: true,
        assignmentStatus: 'ACTIVE',
        assignedBy: ownerId,
      });
      await RbacService.applyRoleDefaultModulesToUser(`mem-${ownerId}`, 'Company Owner', ownerId, 'Test');

      const rawOwnerTok = crypto.randomBytes(32).toString('hex');
      await compDb.insert(schema.sessions).values({
        id: hashToken(rawOwnerTok),
        userId: ownerId,
        expiresAt: new Date(Date.now() + 86400_000),
      });
      tokOwner = `${companyId}.${rawOwnerTok}`;

      if (accountantId) {
        await compDb.insert(schema.users).values({
          id: accountantId,
          email: `${accountantId}@test.ph`,
          displayName: `Bookkeeper ${companyId}`,
          passwordHash: 'dummy-hash',
          status: 'ACTIVE',
        });
        await compDb.insert(schema.companyUsers).values({
          id: `mem-${accountantId}`,
          userId: accountantId,
          companyId,
          roleId: bookkeeperRole.id,
          legacyRole: 'Bookkeeper',
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: 'COMPANY_WIDE',
        });
        await compDb.insert(schema.companyUserRoles).values({
          id: `cur-${accountantId}`,
          companyUserId: `mem-${accountantId}`,
          roleId: bookkeeperRole.id,
          roleCode: bookkeeperRole.code,
          roleTemplateVersion: 1,
          isPrimary: true,
          assignmentStatus: 'ACTIVE',
          assignedBy: ownerId,
        });
        await RbacService.applyRoleDefaultModulesToUser(`mem-${accountantId}`, 'Bookkeeper', ownerId, 'Test');
        const rawAccTok = crypto.randomBytes(32).toString('hex');
        await compDb.insert(schema.sessions).values({
          id: hashToken(rawAccTok),
          userId: accountantId,
          expiresAt: new Date(Date.now() + 86400_000),
        });
        tokAcc = `${companyId}.${rawAccTok}`;
      }

      await compDb.insert(schema.accountingPeriods).values({
        id: `prd-${companyId}-2026`,
        companyId,
        name: 'FY 2026 Nov',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        fiscalYear: 2026,
        status: 'OPEN',
      });
    });

    return { compDb, tokOwner, tokAcc };
  };

  beforeAll(async () => {
    await CompanyManager.init();
    await cleanupCompanies();

    const setupA = await seedTestCompany(
      COMPANY_A_ID,
      'Selector Integration Test Corp A',
      OWNER_A_ID,
      ACCOUNTANT_A_ID
    );
    ownerAToken = setupA.tokOwner;
    accountantAToken = setupA.tokAcc;

    await setupA.compDb.insert(schema.accounts).values([
      {
        id: ACC.CASH_HEADER,
        companyId: COMPANY_A_ID,
        accountCode: '1000',
        accountName: 'Cash and Cash Equivalents (Header)',
        accountType: 'ASSET',
        detailType: null,
        birTaxCategory: null,
        normalBalance: 'DEBIT',
        isCashAccount: false,
        status: 'ACTIVE',
      },
      {
        id: ACC.CASH_ON_HAND,
        companyId: COMPANY_A_ID,
        accountCode: '1005',
        accountName: 'Cash on Hand / Undeposited Funds',
        accountType: 'ASSET',
        parentAccountId: ACC.CASH_HEADER,
        detailType: 'CASH_ON_HAND',
        birTaxCategory: 'NOT_APPLICABLE',
        normalBalance: 'DEBIT',
        isCashAccount: true,
        status: 'ACTIVE',
      },
      {
        id: ACC.BANK_1010,
        companyId: COMPANY_A_ID,
        accountCode: '1010',
        accountName: 'Cash in Bank',
        accountType: 'ASSET',
        parentAccountId: ACC.CASH_HEADER,
        detailType: null, // Intentionally blank to test backfill
        birTaxCategory: null,
        normalBalance: 'DEBIT',
        isCashAccount: true,
        status: 'ACTIVE',
      },
      {
        id: ACC.PETTY_1020,
        companyId: COMPANY_A_ID,
        accountCode: '1020',
        accountName: 'Petty Cash Fund',
        accountType: 'ASSET',
        parentAccountId: ACC.CASH_HEADER,
        detailType: null,
        birTaxCategory: null,
        normalBalance: 'DEBIT',
        isCashAccount: true,
        status: 'ACTIVE',
      },
      {
        id: ACC.INACTIVE_BANK,
        companyId: COMPANY_A_ID,
        accountCode: '1099',
        accountName: 'Closed Old Bank Account',
        accountType: 'ASSET',
        detailType: 'CHECKING',
        birTaxCategory: 'NOT_APPLICABLE',
        normalBalance: 'DEBIT',
        isCashAccount: true,
        status: 'INACTIVE',
      },
      {
        id: ACC.AR_1030,
        companyId: COMPANY_A_ID,
        accountCode: '1030',
        accountName: 'Accounts Receivable',
        accountType: 'RECEIVABLE',
        detailType: null,
        birTaxCategory: null,
        normalBalance: 'DEBIT',
        isControlAccount: true,
        status: 'ACTIVE',
      },
      {
        id: ACC.INPUT_VAT_1050,
        companyId: COMPANY_A_ID,
        accountCode: '1050',
        accountName: 'Input VAT',
        accountType: 'OTHER_CURRENT_ASSET',
        detailType: null,
        birTaxCategory: null,
        normalBalance: 'DEBIT',
        isTaxAccount: true,
        status: 'ACTIVE',
      },
      {
        id: ACC.CWT_1060,
        companyId: COMPANY_A_ID,
        accountCode: '1060',
        accountName: 'Creditable Withholding Tax (2307)',
        accountType: 'OTHER_CURRENT_ASSET',
        detailType: 'CWT_2307_ASSET',
        birTaxCategory: 'CWT_2307',
        normalBalance: 'DEBIT',
        isTaxAccount: true,
        status: 'ACTIVE',
      },
      {
        id: ACC.AP_2010,
        companyId: COMPANY_A_ID,
        accountCode: '2010',
        accountName: 'Accounts Payable',
        accountType: 'PAYABLE',
        detailType: 'TRADE_PAYABLE',
        birTaxCategory: 'NOT_APPLICABLE',
        normalBalance: 'CREDIT',
        isControlAccount: true,
        status: 'ACTIVE',
      },
      {
        id: ACC.OUTPUT_VAT_2020,
        companyId: COMPANY_A_ID,
        accountCode: '2020',
        accountName: 'Output VAT',
        accountType: 'OTHER_CURRENT_LIABILITY',
        detailType: null,
        birTaxCategory: null,
        normalBalance: 'CREDIT',
        isTaxAccount: true,
        status: 'ACTIVE',
      },
      {
        id: ACC.EWT_2030,
        companyId: COMPANY_A_ID,
        accountCode: '2030',
        accountName: 'Expanded Withholding Tax Payable',
        accountType: 'PAYABLE',
        detailType: 'EWT_PAYABLE',
        birTaxCategory: 'EWT_1601EQ',
        normalBalance: 'CREDIT',
        isTaxAccount: true,
        status: 'ACTIVE',
      },
      {
        id: ACC.PCT_2120,
        companyId: COMPANY_A_ID,
        accountCode: '2120',
        accountName: 'Percentage Tax Payable (Form 2551Q)',
        accountType: 'PAYABLE',
        detailType: 'PERCENTAGE_TAX_LIABILITY',
        birTaxCategory: 'PERCENTAGE_TAX_3',
        normalBalance: 'CREDIT',
        isTaxAccount: true,
        status: 'ACTIVE',
      },
      {
        id: ACC.EQUITY_3010,
        companyId: COMPANY_A_ID,
        accountCode: '3010',
        accountName: "Owner's Equity",
        accountType: 'EQUITY',
        detailType: 'PAID_IN_CAPITAL',
        birTaxCategory: 'NOT_APPLICABLE',
        normalBalance: 'CREDIT',
        status: 'ACTIVE',
      },
      {
        id: ACC.REV_4010,
        companyId: COMPANY_A_ID,
        accountCode: '4010',
        accountName: 'Service Revenue',
        accountType: 'REVENUE',
        detailType: null,
        birTaxCategory: null,
        normalBalance: 'CREDIT',
        status: 'ACTIVE',
      },
      {
        id: ACC.EXP_6040,
        companyId: COMPANY_A_ID,
        accountCode: '6040',
        accountName: 'Office Supplies Expense',
        accountType: 'EXPENSE',
        detailType: null,
        birTaxCategory: null,
        normalBalance: 'DEBIT',
        status: 'ACTIVE',
      },
    ]);

    await setupA.compDb.insert(schema.customers).values({
      id: 'cust-sel-a-1',
      companyId: COMPANY_A_ID,
      code: 'C001',
      legalName: 'Sample PH Customer Corp',
      tin: '123-456-789-000',
      status: 'ACTIVE',
    });

    await setupA.compDb.insert(schema.vendors).values({
      id: 'vend-sel-a-1',
      companyId: COMPANY_A_ID,
      code: 'V001',
      legalName: 'Sample PH Supplier Corp',
      tin: '987-654-321-000',
      status: 'ACTIVE',
    });

    const setupB = await seedTestCompany(COMPANY_B_ID, 'Selector Integration Test Corp B', OWNER_B_ID);
    ownerBToken = setupB.tokOwner;
    await setupB.compDb.insert(schema.accounts).values({
      id: ACC.FOREIGN_BANK_B,
      companyId: COMPANY_B_ID,
      accountCode: '1010',
      accountName: 'Foreign Tenant Bank B',
      accountType: 'ASSET',
      detailType: 'CHECKING',
      birTaxCategory: 'NOT_APPLICABLE',
      normalBalance: 'DEBIT',
      isCashAccount: true,
      status: 'ACTIVE',
    });
  });

  afterAll(async () => {
    await cleanupCompanies();
  });

  it('1. Backfills missing COA detailType & birTaxCategory without placeholders and exposes enriched metadata via /api/accounting/accounts', async () => {
    const res = await request(app)
      .get('/api/accounting/accounts')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const bank1010 = res.body.find((a: any) => a.id === ACC.BANK_1010);
    expect(bank1010).toBeTruthy();
    expect(bank1010.detailType).toBe('CHECKING');
    expect(bank1010.birTaxCategory).toBe('NOT_APPLICABLE');
    expect(bank1010.isBankAccount).toBe(true);
    expect(bank1010.isSourceCashAccount).toBe(true);
    expect(bank1010.isPostableLeaf).toBe(true);

    const petty1020 = res.body.find((a: any) => a.id === ACC.PETTY_1020);
    expect(petty1020.detailType).toBe('PETTY_CASH');
    expect(petty1020.isBankAccount).toBe(false);
    expect(petty1020.isSourceCashAccount).toBe(true);

    const header1000 = res.body.find((a: any) => a.id === ACC.CASH_HEADER);
    expect(header1000.isPostableLeaf).toBe(false);
    expect(header1000.isBankAccount).toBe(false);
    expect(header1000.isSourceCashAccount).toBe(false);

    const outVat2020 = res.body.find((a: any) => a.id === ACC.OUTPUT_VAT_2020);
    expect(outVat2020.detailType).toBe('OUTPUT_VAT_LIABILITY');
    expect(outVat2020.birTaxCategory).toBe('OUTPUT_VAT_12');
  });

  it('2. Custom Bank COA creation (2026 — BDO Business Checking Account) propagates to COA, bank registry, Cash Transactions, and Bank Deposit selectors', async () => {
    const createRes = await request(app)
      .post('/api/master-data/accounts')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        accountCode: '2026',
        accountName: 'BDO Business Checking Account',
        accountType: 'ASSET',
        detailType: 'CHECKING',
        birTaxCategory: 'NOT_APPLICABLE',
        normalBalance: 'DEBIT',
        openingBalance: 0,
      });

    expect([200, 201]).toContain(createRes.status);
    customBdoAccountId = createRes.body.id;
    expect(customBdoAccountId).toBeTruthy();
    expect(Boolean(createRes.body.isCashAccount)).toBe(true);
    expect(createRes.body.detailType).toBe('CHECKING');

    // Verify automatic sync to bank_accounts without creating duplicate GL accounts
    const bankRegRes = await request(app)
      .get('/api/banking/accounts')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID);

    expect(bankRegRes.status).toBe(200);
    const bankRegs = Array.isArray(bankRegRes.body) ? bankRegRes.body : [];
    const syncedBdo = bankRegs.find((b: any) => b.glAccountId === customBdoAccountId);
    expect(syncedBdo).toBeTruthy();
    expect(bankRegs.some((b: any) => b.glAccountId === ACC.PETTY_1020)).toBe(false);

    // Fetch raw COA and run centralized selectors
    const coaRes = await request(app)
      .get('/api/master-data/accounts?raw=true')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID);

    expect(coaRes.status).toBe(200);
    const accountsList = coaRes.body;

    const destBanks = filterEligibleDestinationBankAccounts(accountsList, bankRegs);
    const destIds = destBanks.map((d) => d.id);
    expect(destIds).toContain(ACC.BANK_1010);
    expect(destIds).toContain(customBdoAccountId);
    expect(destIds).not.toContain(ACC.PETTY_1020);
    expect(destIds).not.toContain(ACC.CASH_ON_HAND);
    expect(destIds).not.toContain(ACC.CASH_HEADER);
    expect(destIds).not.toContain(ACC.INACTIVE_BANK);
    expect(destIds).not.toContain(ACC.AR_1030);
    expect(destIds).not.toContain(ACC.OUTPUT_VAT_2020);

    const sourceCash = filterEligibleSourceCashAccounts(accountsList);
    const sourceIds = sourceCash.map((s) => s.id);
    expect(sourceIds).toContain(ACC.BANK_1010);
    expect(sourceIds).toContain(ACC.PETTY_1020);
    expect(sourceIds).toContain(ACC.CASH_ON_HAND);
    expect(sourceIds).toContain(customBdoAccountId);
    expect(sourceIds).not.toContain(ACC.CASH_HEADER);
    expect(sourceIds).not.toContain(ACC.INACTIVE_BANK);
  });

  it('3. Tax Control Account mapping filters cleanly by taxType/direction and enforces backend validation', async () => {
    const coaRes = await request(app)
      .get('/api/master-data/accounts?raw=true')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID);
    const accountsList = coaRes.body;

    const outputVatOpts = filterEligibleTaxControlAccounts(accountsList, 'VAT', 'OUTPUT').map((a) => a.id);
    expect(outputVatOpts).toContain(ACC.OUTPUT_VAT_2020);
    expect(outputVatOpts).not.toContain(ACC.INPUT_VAT_1050);
    expect(outputVatOpts).not.toContain(ACC.BANK_1010);
    expect(outputVatOpts).not.toContain(ACC.PETTY_1020);
    expect(outputVatOpts).not.toContain(ACC.REV_4010);
    expect(outputVatOpts).not.toContain(ACC.EXP_6040);

    const inputVatOpts = filterEligibleTaxControlAccounts(accountsList, 'VAT', 'INPUT').map((a) => a.id);
    expect(inputVatOpts).toContain(ACC.INPUT_VAT_1050);
    expect(inputVatOpts).not.toContain(ACC.OUTPUT_VAT_2020);

    const ewtOutOpts = filterEligibleTaxControlAccounts(accountsList, 'EWT', 'OUTPUT').map((a) => a.id);
    expect(ewtOutOpts).toContain(ACC.EWT_2030);
    expect(ewtOutOpts).not.toContain(ACC.CWT_1060);

    // Add a custom EWT Payable account in COA and verify immediate availability
    const customTaxAccRes = await request(app)
      .post('/api/master-data/accounts')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        accountCode: '2031',
        accountName: 'EWT Payable - Expanded Services',
        accountType: 'OTHER_CURRENT_LIABILITY',
        detailType: 'EWT_PAYABLE',
        birTaxCategory: 'EWT_1601EQ',
        normalBalance: 'CREDIT',
      });
    expect([200, 201]).toContain(customTaxAccRes.status);
    customTaxAccountId = customTaxAccRes.body.id;

    // Reject mapping an ineligible account (e.g., Petty Cash) to a Tax Code
    const badTaxCodeRes = await request(app)
      .post('/api/tax/codes')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        code: 'WI100-BAD',
        name: 'Invalid Petty Cash Mapping',
        rateBasisPoints: 500,
        taxType: 'EWT',
        inputOutputDirection: 'OUTPUT',
        accountId: ACC.PETTY_1020,
      });
    expect(badTaxCodeRes.status).toBe(400);

    // Accept valid custom COA tax control account mapping
    const goodTaxCodeRes = await request(app)
      .post('/api/tax/codes')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        code: 'WI100',
        name: 'Professional Fees to Individuals (5%)',
        rateBasisPoints: 500,
        taxType: 'EWT',
        inputOutputDirection: 'OUTPUT',
        accountId: customTaxAccountId,
      });
    expect([200, 201]).toContain(goodTaxCodeRes.status);
    expect(goodTaxCodeRes.body.accountId).toBe(customTaxAccountId);
    expect(goodTaxCodeRes.body.accountCode).toBe('2031');

    // Reject cross-tenant GL account on Tax Code mapping
    const foreignTaxCodeRes = await request(app)
      .post('/api/tax/codes')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        code: 'WI-FOREIGN',
        name: 'Cross Tenant Invalid',
        rateBasisPoints: 500,
        taxType: 'EWT',
        inputOutputDirection: 'OUTPUT',
        accountId: ACC.FOREIGN_BANK_B,
      });
    expect(foreignTaxCodeRes.status).toBe(400);

    // Verify /api/master-data/tax-codes validates eligible COA mapping and returns joined account details
    const badMdTaxCode = await request(app)
      .post('/api/master-data/tax-codes')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        code: 'MD-VAT-BAD',
        name: 'Ineligible Mapping',
        taxType: 'VAT',
        inputOutputDirection: 'OUTPUT',
        accountId: ACC.PETTY_1020,
      });
    expect(badMdTaxCode.status).toBe(400);

    const goodMdTaxCode = await request(app)
      .post('/api/master-data/tax-codes')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        code: 'MD-VAT-GOOD',
        name: 'Valid Output VAT Mapping',
        taxType: 'VAT',
        inputOutputDirection: 'OUTPUT',
        accountId: ACC.OUTPUT_VAT_2020,
      });
    expect([200, 201]).toContain(goodMdTaxCode.status);
    expect(goodMdTaxCode.body.accountId).toBe(ACC.OUTPUT_VAT_2020);
    expect(goodMdTaxCode.body.accountCode).toBe('2020');

    // Verify /api/master-data/payment-methods rejects non-cash defaultAccountId
    const badPaymentMethod = await request(app)
      .post('/api/master-data/payment-methods')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        code: 'PM-BAD',
        name: 'Bad Account PM',
        defaultAccountId: ACC.REV_4010,
      });
    expect(badPaymentMethod.status).toBe(400);

    const goodPaymentMethod = await request(app)
      .post('/api/master-data/payment-methods')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        code: 'PM-GOOD',
        name: 'Valid Bank PM',
        defaultAccountId: customBdoAccountId,
      });
    expect([200, 201]).toContain(goodPaymentMethod.status);
  });

  it('4. Cash Transaction & Bank Deposit workflows enforce COA eligibility, block Petty Cash destinations & same-account deposits, and post balanced GL entries', async () => {
    // Reject non-cash account in Cash Transaction
    const badCashTxn = await request(app)
      .post('/api/accounting/cash-transactions')
      .set('Authorization', `Bearer ${accountantAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        accountId: ACC.REV_4010,
        type: 'RECEIPT',
        amount: 500000,
        offsetAccountId: ACC.REV_4010,
        transactionDate: '2026-11-17',
        reference: 'CR-BAD-001',
        description: 'Invalid non-cash source',
      });
    expect(badCashTxn.status).toBe(400);

    // Reject cross-tenant account injection
    const foreignCashTxn = await request(app)
      .post('/api/accounting/cash-transactions')
      .set('Authorization', `Bearer ${accountantAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        accountId: ACC.FOREIGN_BANK_B,
        type: 'RECEIPT',
        amount: 500000,
        offsetAccountId: ACC.REV_4010,
        transactionDate: '2026-11-17',
        reference: 'CR-FOREIGN-001',
        description: 'Cross tenant attack',
      });
    expect(foreignCashTxn.status).toBe(400);

    // Create valid Cash Transaction with custom BDO account (2026) and explicit offset account
    const goodCashTxn = await request(app)
      .post('/api/accounting/cash-transactions')
      .set('Authorization', `Bearer ${accountantAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        accountId: customBdoAccountId,
        offsetAccountId: ACC.REV_4010,
        type: 'RECEIPT',
        amount: 250000,
        transactionDate: '2026-11-17',
        reference: 'OR-BDO-2026',
        description: 'Collection deposited to custom BDO Checking 2026',
      });
    expect([200, 201]).toContain(goodCashTxn.status);
    const cashTxnId = goodCashTxn.body.id;

    // Maker-checker submit -> approve -> post to GL
    const subTxn = await request(app)
      .post(`/api/accounting/cash-transactions/${cashTxnId}/submit`)
      .set('Authorization', `Bearer ${accountantAToken}`)
      .set('X-Company-Id', COMPANY_A_ID);
    expect(subTxn.status).toBe(200);

    const appTxn = await request(app)
      .post(`/api/accounting/cash-transactions/${cashTxnId}/approve`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID);
    expect(appTxn.status).toBe(200);

    const postTxn = await request(app)
      .post(`/api/accounting/cash-transactions/${cashTxnId}/post`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID);
    expect(postTxn.status).toBe(200);

    // Reject Petty Cash as Destination Bank in Bank Deposit Batch
    const pettyDestDep = await request(app)
      .post('/api/accounting/bank-deposits')
      .set('Authorization', `Bearer ${accountantAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        depositNumber: 'DEP-BAD-PETTY',
        depositDate: '2026-11-17',
        toBankAccountId: ACC.PETTY_1020,
        fromCashAccountId: ACC.CASH_ON_HAND,
        totalAmount: 100000,
        reference: 'SLIP-BAD-1',
      });
    expect(pettyDestDep.status).toBe(400);

    // Reject same account as source & destination
    const sameAccDep = await request(app)
      .post('/api/accounting/bank-deposits')
      .set('Authorization', `Bearer ${accountantAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        depositNumber: 'DEP-BAD-SAME',
        depositDate: '2026-11-17',
        toBankAccountId: customBdoAccountId,
        fromCashAccountId: customBdoAccountId,
        totalAmount: 100000,
        reference: 'SLIP-BAD-2',
      });
    expect(sameAccDep.status).toBe(400);

    // Valid Bank Deposit: Cash on Hand (1005) -> BDO Business Checking (2026)
    const validDep = await request(app)
      .post('/api/accounting/bank-deposits')
      .set('Authorization', `Bearer ${accountantAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        depositNumber: 'DEP-BDO-2026-01',
        depositDate: '2026-11-17',
        toBankAccountId: customBdoAccountId,
        fromCashAccountId: ACC.CASH_ON_HAND,
        totalAmount: 150000,
        reference: 'BDO-SLIP-0001',
      });
    expect([200, 201]).toContain(validDep.status);
    const depId = validDep.body.id;

    expect(
      (
        await request(app)
          .post(`/api/accounting/bank-deposits/${depId}/submit`)
          .set('Authorization', `Bearer ${accountantAToken}`)
          .set('X-Company-Id', COMPANY_A_ID)
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/accounting/bank-deposits/${depId}/approve`)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .set('X-Company-Id', COMPANY_A_ID)
      ).status
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/accounting/bank-deposits/${depId}/post`)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .set('X-Company-Id', COMPANY_A_ID)
      ).status
    ).toBe(200);

    // Verify GL Journal entries exist and balance in Company A DB
    const compDb = await CompanyManager.getCompanyDb(COMPANY_A_ID);
    const glLines = await compDb.select().from(schema.journalLines).all();
    const bdoCreditsAndDebits = glLines.filter((l) => l.accountId === customBdoAccountId);
    const totalBdoDebit = bdoCreditsAndDebits.reduce((sum, l) => sum + Number(l.debit || 0), 0);
    // 250000 (cash receipt) + 150000 (bank deposit) = 400000
    expect(totalBdoDebit).toBe(400000);
  });

  it('5. Sales Invoice, Purchase Bill, and Revenue/Expense COA selectors bind selected active accounts reliably', async () => {
    // Custom Revenue Account
    const revCreateRes = await request(app)
      .post('/api/master-data/accounts')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        accountCode: '4050',
        accountName: 'Managed Security Retainer Revenue',
        accountType: 'REVENUE',
        detailType: 'SERVICE_INCOME',
        birTaxCategory: 'OUTPUT_VAT_12',
        normalBalance: 'CREDIT',
      });
    expect([200, 201]).toContain(revCreateRes.status);
    const customRevId = revCreateRes.body.id;

    const coaRes = await request(app)
      .get('/api/master-data/accounts?raw=true')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('X-Company-Id', COMPANY_A_ID);
    const accountsList = coaRes.body;

    const revIds = filterEligibleRevenueAccounts(accountsList).map((a) => a.id);
    expect(revIds).toContain(customRevId);
    expect(revIds).not.toContain(ACC.EXP_6040);

    const expIds = filterEligibleExpenseAndPurchaseAccounts(accountsList).map((a) => a.id);
    expect(expIds).toContain(ACC.EXP_6040);
    expect(expIds).not.toContain(ACC.BANK_1010);
    expect(expIds).not.toContain(ACC.AR_1030);

    const leafIds = filterPostableLeafAccounts(accountsList).map((a) => a.id);
    expect(leafIds).not.toContain(ACC.CASH_HEADER);
    expect(leafIds).not.toContain(ACC.INACTIVE_BANK);

    const invRes = await request(app)
      .post('/api/accounting/sales-invoices')
      .set('Authorization', `Bearer ${accountantAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        customerId: 'cust-sel-a-1',
        invoiceNumber: 'INV-COA-001',
        invoiceDate: '2026-11-17',
        dueDate: '2026-12-17',
        totalAmount: 112000,
        lines: [
          {
            accountId: customRevId,
            description: 'Security retainer fee',
            quantity: 1,
            unitPrice: 100000,
            amount: 100000,
          },
        ],
      });
    expect([200, 201]).toContain(invRes.status);

    const compDb = await CompanyManager.getCompanyDb(COMPANY_A_ID);
    const invLines = await compDb
      .select()
      .from(schema.salesInvoiceLines)
      .where(eq(schema.salesInvoiceLines.invoiceId, invRes.body.id))
      .all();
    expect(invLines.length).toBe(1);
    expect(invLines[0].accountId).toBe(customRevId);

    // Purchase Bill binding to eligible Expense account
    const billRes = await request(app)
      .post('/api/accounting/purchase-bills')
      .set('Authorization', `Bearer ${accountantAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        vendorId: 'vend-sel-a-1',
        billNumber: 'BILL-COA-001',
        billDate: '2026-11-17',
        dueDate: '2026-12-17',
        totalAmount: 56000,
        lines: [
          {
            accountId: ACC.EXP_6040,
            description: 'Office printer paper',
            quantity: 1,
            unitCost: 50000,
            amount: 50000,
          },
        ],
      });
    expect([200, 201]).toContain(billRes.status);
    const billLines = await compDb
      .select()
      .from(schema.purchaseBillLines)
      .where(eq(schema.purchaseBillLines.billId, billRes.body.id))
      .all();
    expect(billLines.length).toBe(1);
    expect(billLines[0].accountId).toBe(ACC.EXP_6040);

    // Reject cross-tenant accountId on Sales Invoice line
    const badInvRes = await request(app)
      .post('/api/accounting/sales-invoices')
      .set('Authorization', `Bearer ${accountantAToken}`)
      .set('X-Company-Id', COMPANY_A_ID)
      .send({
        customerId: 'cust-sel-a-1',
        invoiceNumber: 'INV-COA-BAD',
        invoiceDate: '2026-11-17',
        dueDate: '2026-12-17',
        totalAmount: 10000,
        lines: [
          {
            accountId: ACC.FOREIGN_BANK_B,
            description: 'Cross tenant account attack',
            quantity: 1,
            unitPrice: 10000,
            amount: 10000,
          },
        ],
      });
    expect(badInvRes.status).toBe(400);
  });
});
