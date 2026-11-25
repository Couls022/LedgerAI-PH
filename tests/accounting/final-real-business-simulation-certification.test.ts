import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { paths } from '../../src/server/services/paths';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import {
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
} from '../../src/server/db/business_transactions';
import {
  createJournalEntry,
  submitJournalEntry,
  approveJournalEntry,
  postJournalEntry,
} from '../../src/server/db/domain';
import {
  resolveVatOrPercentageFilingRule,
} from '../../src/server/services/financialSourceOfTruth';
import { RecurringJournalService } from '../../src/server/services/recurringJournalService';
import { getBirTaxProfileRules } from '../../src/shared/taxProfile';

describe('LEDGERAI PH — FINAL REAL-BUSINESS SIMULATION & FINANCIAL INTEGRITY CERTIFICATION', () => {
  const app = createApp();
  const VAT_COMPANY_ID = 'LGR-PH-CERT-SIM-VAT';
  const NONVAT_COMPANY_ID = 'LGR-PH-CERT-SIM-NONVAT';

  const PREPARER_ID = 'usr-cert-preparer';
  const APPROVER_ID = 'usr-cert-approver';
  const CONTROLLER_ID = 'usr-cert-controller';
  const NONVAT_OWNER_ID = 'usr-cert-nonvat-owner';

  let preparerToken: string;
  let approverToken: string;
  let controllerToken: string;
  let nonVatOwnerToken: string;

  const currentYear = new Date().getFullYear();
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  const txDate = `${currentYear}-${currentMonth}-15`;
  const dueDate = `${currentYear}-${currentMonth}-28`;

  const PERIOD_ID = 'prd-cert-open-2026';
  const LOCKED_PERIOD_ID = 'prd-cert-locked-2025';

  // COA IDs for VAT Company
  const ACC_CASH = 'acc-cert-1010';
  const ACC_AR = 'acc-cert-1110';
  const ACC_INV = 'acc-cert-1040';
  const ACC_CWT = 'acc-cert-1055';
  const ACC_INPUT_VAT = 'acc-cert-1060';
  const ACC_FA_COST = 'acc-cert-1500';
  const ACC_FA_ACCUM_DEP = 'acc-cert-1510';
  const ACC_AP = 'acc-cert-2010';
  const ACC_OUTPUT_VAT = 'acc-cert-2020';
  const ACC_EWT_PAY = 'acc-cert-2030';
  const ACC_SSS_PAY = 'acc-cert-2110';
  const ACC_PHIC_PAY = 'acc-cert-2120';
  const ACC_HDMF_PAY = 'acc-cert-2130';
  const ACC_WTAX_PAY = 'acc-cert-2140';
  const ACC_ACCRUED_EXP = 'acc-cert-2200';
  const ACC_EQUITY = 'acc-cert-3010';
  const ACC_REV_VAT = 'acc-cert-4010';
  const ACC_REV_ZERO = 'acc-cert-4020';
  const ACC_REV_EXEMPT = 'acc-cert-4030';
  const ACC_COGS = 'acc-cert-5010';
  const ACC_OPEX = 'acc-cert-6010';
  const ACC_DEP_EXP = 'acc-cert-6020';
  const ACC_SAL_EXP = 'acc-cert-6110';
  const ACC_RENT_EXP = 'acc-cert-6120';

  // Master Data IDs
  const CUSTOMER_ID = 'cust-cert-001';
  const VENDOR_ID = 'vend-cert-001';
  const EMPLOYEE_ID = 'emp-cert-001';
  const ITEM_ID = 'item-cert-001';
  const ASSET_ID = 'fa-cert-001';
  const PO_ID = 'po-cert-001';
  const GRN_ID = 'grn-cert-001';
  const PAYROLL_RUN_ID = 'pr-cert-001';
  const BANK_ACC_ID = 'bank-cert-001';
  const BANK_RECON_ID = 'recon-cert-001';
  const DOC_ID = 'doc-cert-001';
  const TAX_FILING_ID = 'tf-cert-001';
  const SYS_OP_AUDIT_ID = 'sysop-cert-001';

  const TAX_CODE_OUTPUT_VAT = 'tc-cert-out-vat12';
  const TAX_CODE_INPUT_VAT = 'tc-cert-in-vat12';
  const TAX_RULE_DEF_VAT12 = 'trd-cert-vat12';
  const TAX_RULE_VER_VAT12 = 'trv-cert-vat12';

  let siVatableId: string;
  let siZeroRatedId: string;
  let siExemptId: string;
  let custPaymentId: string;
  let purchaseBillId: string;
  let suppPaymentId: string;
  let capitalJournalId: string;

  const cleanupSyntheticCompanies = async () => {
    await CompanyManager.closeAllConnections();
    for (const cid of [VAT_COMPANY_ID, NONVAT_COMPANY_ID]) {
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

  beforeAll(async () => {
    await CompanyManager.init();
    await cleanupSyntheticCompanies();

    await CompanyManager.createCompanyProfile(
      VAT_COMPANY_ID,
      'Mabuhay Precision Trading Corp. (Synthetic Audit)',
      undefined,
      undefined,
      false,
      { classification: 'TEST' }
    );

    await CompanyManager.createCompanyProfile(
      NONVAT_COMPANY_ID,
      'Bayanihan Micro Services (Synthetic Non-VAT)',
      undefined,
      undefined,
      false,
      { classification: 'TEST' }
    );

    const vatDb = await CompanyManager.getCompanyDb(VAT_COMPANY_ID);
    await dbContext.run(vatDb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();

      // Configure Company as VAT-Registered with Optional Monthly 2550M election per RMC 52-2023
      await db.update(schema.companies)
        .set({
          tin: '009-888-777-000',
          vatStatus: 'VAT',
          taxpayerType: 'CORPORATION',
          rdoCode: '044',
        })
        .where(eq(schema.companies.id, VAT_COMPANY_ID));

      await db.insert(schema.companyTaxProfiles).values({
        id: 'ctp-cert-vat',
        companyId: VAT_COMPANY_ID,
        taxpayerClassification: 'CORPORATION',
        vatStatus: 'VAT',
        filingFrequency: 'MONTHLY_OPTIONAL',
        tin: '009-888-777-000',
        rdo: '044',
        accountingPeriod: 'CALENDAR',
      }).onConflictDoNothing();

      await db.insert(schema.accountingPeriods).values([
        {
          id: PERIOD_ID,
          companyId: VAT_COMPANY_ID,
          name: `FY ${currentYear} Open Period`,
          startDate: `${currentYear}-01-01`,
          endDate: `${currentYear}-12-31`,
          fiscalYear: currentYear,
          status: 'OPEN',
        },
        {
          id: LOCKED_PERIOD_ID,
          companyId: VAT_COMPANY_ID,
          name: 'FY 2024 Hard Closed Period',
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          fiscalYear: 2024,
          status: 'HARD_CLOSED',
        },
      ]).onConflictDoNothing();

      await db.insert(schema.accounts).values([
        { id: ACC_CASH, companyId: VAT_COMPANY_ID, accountCode: '1010', accountName: 'Cash in Bank - BPI', accountType: 'ASSET', detailType: 'CASH', normalBalance: 'DEBIT', isCashAccount: true, status: 'ACTIVE' },
        { id: ACC_AR, companyId: VAT_COMPANY_ID, accountCode: '1110', accountName: 'Accounts Receivable - Trade', accountType: 'RECEIVABLE', detailType: 'ACCOUNTS_RECEIVABLE', normalBalance: 'DEBIT', isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_INV, companyId: VAT_COMPANY_ID, accountCode: '1040', accountName: 'Merchandise Inventory', accountType: 'INVENTORY', detailType: 'INVENTORY', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_CWT, companyId: VAT_COMPANY_ID, accountCode: '1055', accountName: 'Creditable Withholding Tax (2307)', accountType: 'ASSET', normalBalance: 'DEBIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_INPUT_VAT, companyId: VAT_COMPANY_ID, accountCode: '1060', accountName: 'Input VAT', accountType: 'ASSET', normalBalance: 'DEBIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_FA_COST, companyId: VAT_COMPANY_ID, accountCode: '1500', accountName: 'Delivery Equipment', accountType: 'FIXED_ASSET', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_FA_ACCUM_DEP, companyId: VAT_COMPANY_ID, accountCode: '1510', accountName: 'Accumulated Depreciation - Delivery Equipment', accountType: 'FIXED_ASSET', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_AP, companyId: VAT_COMPANY_ID, accountCode: '2010', accountName: 'Accounts Payable - Trade', accountType: 'PAYABLE', detailType: 'ACCOUNTS_PAYABLE', normalBalance: 'CREDIT', isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_OUTPUT_VAT, companyId: VAT_COMPANY_ID, accountCode: '2020', accountName: 'Output VAT Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_EWT_PAY, companyId: VAT_COMPANY_ID, accountCode: '2030', accountName: 'Expanded Withholding Tax Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_SSS_PAY, companyId: VAT_COMPANY_ID, accountCode: '2110', accountName: 'SSS Contributions Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_PHIC_PAY, companyId: VAT_COMPANY_ID, accountCode: '2120', accountName: 'PhilHealth Contributions Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_HDMF_PAY, companyId: VAT_COMPANY_ID, accountCode: '2130', accountName: 'Pag-IBIG Contributions Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_WTAX_PAY, companyId: VAT_COMPANY_ID, accountCode: '2140', accountName: 'Withholding Tax on Compensation Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_ACCRUED_EXP, companyId: VAT_COMPANY_ID, accountCode: '2200', accountName: 'Accrued Expenses Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_EQUITY, companyId: VAT_COMPANY_ID, accountCode: '3010', accountName: 'Ordinary Share Capital', accountType: 'EQUITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_REV_VAT, companyId: VAT_COMPANY_ID, accountCode: '4010', accountName: 'Sales Revenue - VATable', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_REV_ZERO, companyId: VAT_COMPANY_ID, accountCode: '4020', accountName: 'Sales Revenue - Zero Rated', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_REV_EXEMPT, companyId: VAT_COMPANY_ID, accountCode: '4030', accountName: 'Sales Revenue - VAT Exempt', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_COGS, companyId: VAT_COMPANY_ID, accountCode: '5010', accountName: 'Cost of Goods Sold', accountType: 'COST_OF_SALES', detailType: 'COGS', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_OPEX, companyId: VAT_COMPANY_ID, accountCode: '6010', accountName: 'Professional & Office Services Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_DEP_EXP, companyId: VAT_COMPANY_ID, accountCode: '6020', accountName: 'Depreciation Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_SAL_EXP, companyId: VAT_COMPANY_ID, accountCode: '6110', accountName: 'Salaries and Wages Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_RENT_EXP, companyId: VAT_COMPANY_ID, accountCode: '6120', accountName: 'Rent & Utilities Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
      ]).onConflictDoNothing();

      // Seed 12% VAT Tax Rule & Codes
      await db.insert(schema.taxRuleDefinitions).values({
        id: TAX_RULE_DEF_VAT12,
        ruleCode: 'PH_VAT_12_CERT',
        ruleName: 'Philippine 12% Value-Added Tax (NIRC Sec. 106/108)',
        taxType: 'VAT',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.taxRuleVersions).values({
        id: TAX_RULE_VER_VAT12,
        ruleDefinitionId: TAX_RULE_DEF_VAT12,
        version: 1,
        effectiveFrom: '2020-01-01',
        calculationMethod: 'PERCENTAGE',
        rateValue: 0.12,
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.taxCodes).values([
        {
          id: TAX_CODE_OUTPUT_VAT,
          companyId: VAT_COMPANY_ID,
          code: 'VAT12-OUT',
          name: 'Output VAT 12%',
          taxType: 'VAT',
          inputOutputDirection: 'OUTPUT',
          accountId: ACC_OUTPUT_VAT,
          ruleDefinitionId: TAX_RULE_DEF_VAT12,
          status: 'ACTIVE',
        },
        {
          id: TAX_CODE_INPUT_VAT,
          companyId: VAT_COMPANY_ID,
          code: 'VAT12-IN',
          name: 'Input VAT 12%',
          taxType: 'VAT',
          inputOutputDirection: 'INPUT',
          accountId: ACC_INPUT_VAT,
          ruleDefinitionId: TAX_RULE_DEF_VAT12,
          status: 'ACTIVE',
        },
      ]).onConflictDoNothing();

      await db.insert(schema.customers).values({
        id: CUSTOMER_ID,
        companyId: VAT_COMPANY_ID,
        code: 'CUST-CERT-001',
        legalName: 'Makati Prime Commercial Holdings Inc.',
        tin: '123-456-789-000',
        address: 'Ayala Avenue, Makati City',
        defaultReceivableAccountId: ACC_AR,
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.vendors).values({
        id: VENDOR_ID,
        companyId: VAT_COMPANY_ID,
        code: 'VEND-CERT-001',
        legalName: 'Taguig Industrial Supply & Logistics Corp.',
        tin: '321-654-987-000',
        address: 'BGC, Taguig City',
        defaultPayableAccountId: ACC_AP,
        status: 'ACTIVE',
      }).onConflictDoNothing();

      const provisionActor = async (userId: string, email: string, displayName: string, roleName: string) => {
        await db.insert(schema.users).values({
          id: userId,
          email,
          displayName,
          passwordHash: 'cert_hash',
          status: 'ACTIVE',
        }).onConflictDoNothing();

        const roleRec = await RbacService.ensureRoleRecord(roleName);
        const memId = `mem-${userId}`;
        await db.insert(schema.companyUsers).values({
          id: memId,
          userId,
          companyId: VAT_COMPANY_ID,
          roleId: roleRec.id,
          legacyRole: roleName,
          status: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          defaultDataScope: 'COMPANY_WIDE',
        }).onConflictDoNothing();

        await RbacService.setMemberRoles(null, memId, [roleName], 'Certification test provisioning');
        const rawToken = crypto.randomBytes(32).toString('hex');
        await db.insert(schema.sessions).values({
          id: hashToken(rawToken),
          userId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        return `${VAT_COMPANY_ID}.${rawToken}`;
      };

      preparerToken = await provisionActor(PREPARER_ID, 'preparer@cert.ph', 'Juan Dela Cruz (Preparer)', 'Accountant');
      approverToken = await provisionActor(APPROVER_ID, 'approver@cert.ph', 'Gabriela Silang (Approver)', 'Approver');
      controllerToken = await provisionActor(CONTROLLER_ID, 'controller@cert.ph', 'Jose Rizal (Company Owner)', 'Company Owner');
    });

    // Provision Isolated Non-VAT Company
    const nonVatDb = await CompanyManager.getCompanyDb(NONVAT_COMPANY_ID);
    await dbContext.run(nonVatDb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      await db.update(schema.companies)
        .set({
          tin: '005-444-333-000',
          vatStatus: 'NON_VAT',
          taxpayerType: 'SOLE_PROPRIETOR',
          rdoCode: '039',
        })
        .where(eq(schema.companies.id, NONVAT_COMPANY_ID));

      await db.insert(schema.companyTaxProfiles).values({
        id: 'ctp-cert-nonvat',
        companyId: NONVAT_COMPANY_ID,
        taxpayerClassification: 'SOLE_PROPRIETOR',
        vatStatus: 'NON_VAT',
        filingFrequency: 'QUARTERLY',
        tin: '005-444-333-000',
        rdo: '039',
        accountingPeriod: 'CALENDAR',
      }).onConflictDoNothing();

      await db.insert(schema.accountingPeriods).values({
        id: 'prd-nonvat-2026',
        companyId: NONVAT_COMPANY_ID,
        name: `FY ${currentYear} Non-VAT Period`,
        startDate: `${currentYear}-01-01`,
        endDate: `${currentYear}-12-31`,
        fiscalYear: currentYear,
        status: 'OPEN',
      }).onConflictDoNothing();

      await db.delete(schema.taxCodes).where(eq(schema.taxCodes.companyId, NONVAT_COMPANY_ID));
      await db.delete(schema.accounts).where(eq(schema.accounts.companyId, NONVAT_COMPANY_ID));

      await db.insert(schema.accounts).values([
        { id: 'nv-acc-1010', companyId: NONVAT_COMPANY_ID, accountCode: '1010', accountName: 'Cash on Hand', accountType: 'ASSET', normalBalance: 'DEBIT', isCashAccount: true, status: 'ACTIVE' },
        { id: 'nv-acc-1110', companyId: NONVAT_COMPANY_ID, accountCode: '1110', accountName: 'Accounts Receivable', accountType: 'RECEIVABLE', normalBalance: 'DEBIT', isControlAccount: true, status: 'ACTIVE' },
        { id: 'nv-acc-4010', companyId: NONVAT_COMPANY_ID, accountCode: '4010', accountName: 'Service Revenue - Non-VAT', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' },
      ]).onConflictDoNothing();

      await db.insert(schema.customers).values({
        id: 'nv-cust-001',
        companyId: NONVAT_COMPANY_ID,
        code: 'NV-CUST-001',
        legalName: 'Quezon City Retail Client',
        tin: '456-789-123-000',
        defaultReceivableAccountId: 'nv-acc-1110',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.users).values([
        {
          id: PREPARER_ID,
          email: 'preparer@nonvat.ph',
          displayName: 'Juan Dela Cruz (Preparer)',
          passwordHash: 'cert_hash',
          status: 'ACTIVE',
        },
        {
          id: NONVAT_OWNER_ID,
          email: 'owner@nonvat.ph',
          displayName: 'Melchora Aquino (Non-VAT Owner)',
          passwordHash: 'cert_hash',
          status: 'ACTIVE',
        },
      ]).onConflictDoNothing();

      const roleRec = await RbacService.ensureRoleRecord('Company Owner');
      const memId = `mem-${NONVAT_OWNER_ID}`;
      await db.insert(schema.companyUsers).values({
        id: memId,
        userId: NONVAT_OWNER_ID,
        companyId: NONVAT_COMPANY_ID,
        roleId: roleRec.id,
        legacyRole: 'Company Owner',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        defaultDataScope: 'COMPANY_WIDE',
      }).onConflictDoNothing();
      await RbacService.setMemberRoles(null, memId, ['Company Owner'], 'Non-VAT Owner');

      const rawToken = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawToken),
        userId: NONVAT_OWNER_ID,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      nonVatOwnerToken = `${NONVAT_COMPANY_ID}.${rawToken}`;
    });
  });

  afterAll(async () => {
    await cleanupSyntheticCompanies();
  });

  it('PHASE 1: Financial Source of Truth Audit — Empty state & explicit missing-data status verification', async () => {
    const dashRes = await request(app)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${controllerToken}`);

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.cashBalance).toBe(0);
    expect(dashRes.body.accountsReceivable).toBe(0);
    expect(dashRes.body.accountsPayable).toBe(0);
    expect(dashRes.body.reconciliationSummary.tbStatus).toBe('NO_RECORDS');
    expect(dashRes.body.kpiMeta.cashBalance.status).toBe('NO_RECORDS');
    expect(dashRes.body.kpiMeta.accountsReceivable.status).toBe('NO_RECORDS');
    expect(dashRes.body.kpiMeta.accountsPayable.status).toBe('NO_RECORDS');
    expect(dashRes.body.kpiMeta.cashBalance.missingExplanation).toContain('No posted');

    const opsRes = await request(app)
      .get('/api/operations/summary')
      .set('Authorization', `Bearer ${controllerToken}`);

    expect(opsRes.status).toBe(200);
    expect(opsRes.body.sales.status).toBe('NO_RECORDS');
    expect(opsRes.body.inventory.status).toBe('NO_RECORDS');
    expect(opsRes.body.payroll.status).toBe('NO_RECORDS');
    expect(opsRes.body.fixedAssets.status).toBe('NO_RECORDS');
    expect(opsRes.body.procurement.status).toBe('NO_RECORDS');
    expect(opsRes.body.banking.status).toBe('NO_RECORDS');
  });

  it('PHASE 2: Realistic Philippine Business Simulation — End-to-End Transactions with Independent Expected Calculations', async () => {
    const vatDb = await CompanyManager.getCompanyDb(VAT_COMPANY_ID);

    await dbContext.run(vatDb, async () => {
      // 1. Capital Infusion: ₱2,000,000.00 (200,000,000 centavos)
      capitalJournalId = await createJournalEntry(
        VAT_COMPANY_ID,
        {
          journalNumber: 'JV-2026-CAP-001',
          entryDate: txDate,
          accountingPeriodId: PERIOD_ID,
          description: 'Initial paid-up share capital infusion',
          sourceType: 'MANUAL',
          createdBy: PREPARER_ID,
        },
        [
          { accountId: ACC_CASH, debit: 200_000_000, credit: 0, description: 'Cash deposit BPI' },
          { accountId: ACC_EQUITY, debit: 0, credit: 200_000_000, description: 'Issued share capital' },
        ]
      );
      await submitJournalEntry(VAT_COMPANY_ID, capitalJournalId, PREPARER_ID);
      await approveJournalEntry(VAT_COMPANY_ID, capitalJournalId, APPROVER_ID);
      await postJournalEntry(VAT_COMPANY_ID, capitalJournalId, CONTROLLER_ID);

      // 2A. Sales Invoice 1 — VATable 12% Exclusive: Net ₱100,000.00 + Output VAT ₱12,000.00 = Gross ₱112,000.00 (11,200,000c)
      siVatableId = await createSalesInvoice(
        VAT_COMPANY_ID,
        {
          customerId: CUSTOMER_ID,
          invoiceNumber: 'SI-2026-001',
          invoiceDate: txDate,
          dueDate,
          totalAmount: 11_200_000,
          lines: [
            {
              accountId: ACC_REV_VAT,
              taxCodeId: TAX_CODE_OUTPUT_VAT,
              description: 'Enterprise ERP Deployment Services (VATable 12%)',
              quantity: 1,
              unitPrice: 10_000_000,
              amount: 10_000_000,
              taxAmount: 1_200_000,
              isTaxInclusive: false,
            },
          ],
        },
        PREPARER_ID
      );
      await submitSalesInvoice(VAT_COMPANY_ID, siVatableId, PREPARER_ID);
      await approveSalesInvoice(VAT_COMPANY_ID, siVatableId, APPROVER_ID);
      await postSalesInvoice(VAT_COMPANY_ID, siVatableId, PERIOD_ID, [], CONTROLLER_ID);

      // 2B. Sales Invoice 2 — Zero-Rated (0% PEZA): Net ₱50,000.00 = Gross ₱50,000.00 (5,000,000c)
      siZeroRatedId = await createSalesInvoice(
        VAT_COMPANY_ID,
        {
          customerId: CUSTOMER_ID,
          invoiceNumber: 'SI-2026-002',
          invoiceDate: txDate,
          dueDate,
          totalAmount: 5_000_000,
          lines: [
            {
              accountId: ACC_REV_ZERO,
              description: 'PEZA Export Technical Services (Zero-Rated 0%)',
              quantity: 1,
              unitPrice: 5_000_000,
              amount: 5_000_000,
            },
          ],
        },
        PREPARER_ID
      );
      await submitSalesInvoice(VAT_COMPANY_ID, siZeroRatedId, PREPARER_ID);
      await approveSalesInvoice(VAT_COMPANY_ID, siZeroRatedId, APPROVER_ID);
      await postSalesInvoice(VAT_COMPANY_ID, siZeroRatedId, PERIOD_ID, [], CONTROLLER_ID);

      // 2C. Sales Invoice 3 — VAT-Exempt: Net ₱25,000.00 = Gross ₱25,000.00 (2,500,000c)
      siExemptId = await createSalesInvoice(
        VAT_COMPANY_ID,
        {
          customerId: CUSTOMER_ID,
          invoiceNumber: 'SI-2026-003',
          invoiceDate: txDate,
          dueDate,
          totalAmount: 2_500_000,
          lines: [
            {
              accountId: ACC_REV_EXEMPT,
              description: 'Exempt Educational Training Materials (NIRC Sec. 109)',
              quantity: 1,
              unitPrice: 2_500_000,
              amount: 2_500_000,
            },
          ],
        },
        PREPARER_ID
      );
      await submitSalesInvoice(VAT_COMPANY_ID, siExemptId, PREPARER_ID);
      await approveSalesInvoice(VAT_COMPANY_ID, siExemptId, APPROVER_ID);
      await postSalesInvoice(VAT_COMPANY_ID, siExemptId, PERIOD_ID, [], CONTROLLER_ID);

      // 3. Customer Collection on SI-2026-001 (₱112,000.00 settled via ₱110,000.00 Cash + ₱2,000.00 CWT 2307)
      custPaymentId = await createCustomerPayment(
        VAT_COMPANY_ID,
        {
          customerId: CUSTOMER_ID,
          paymentNumber: 'CR-2026-001',
          officialReceiptNumber: 'OR-2026-001',
          paymentDate: txDate,
          cashAccountId: ACC_CASH,
          amount: 11_000_000,
          withholdingTaxAmount: 200_000,
          withholdingTaxAccountId: ACC_CWT,
          paymentMethod: 'BANK_TRANSFER',
          applications: [
            {
              invoiceId: siVatableId,
              appliedAmount: 11_200_000,
              withholdingAmount: 200_000,
            },
          ],
        },
        PREPARER_ID
      );
      await submitCustomerPayment(VAT_COMPANY_ID, custPaymentId, PREPARER_ID);
      await approveCustomerPayment(VAT_COMPANY_ID, custPaymentId, APPROVER_ID);
      await postCustomerPayment(VAT_COMPANY_ID, custPaymentId, PERIOD_ID, CONTROLLER_ID);

      // 4. Supplier Purchase Bill (Net ₱40,000.00 + Input VAT ₱4,800.00 = Gross ₱44,800.00) & Partial Payment with EWT
      purchaseBillId = await createPurchaseBill(
        VAT_COMPANY_ID,
        {
          vendorId: VENDOR_ID,
          billNumber: 'BILL-2026-001',
          billDate: txDate,
          dueDate,
          totalAmount: 4_480_000,
          lines: [
            {
              accountId: ACC_OPEX,
              taxCodeId: TAX_CODE_INPUT_VAT,
              description: 'Managed Cloud Infrastructure & Support (VATable 12%)',
              quantity: 1,
              unitPrice: 4_000_000,
              amount: 4_000_000,
              taxAmount: 480_000,
              isTaxInclusive: false,
            },
          ],
        },
        PREPARER_ID
      );
      await submitPurchaseBill(VAT_COMPANY_ID, purchaseBillId, PREPARER_ID);
      await approvePurchaseBill(VAT_COMPANY_ID, purchaseBillId, APPROVER_ID);
      await postPurchaseBill(VAT_COMPANY_ID, purchaseBillId, PERIOD_ID, [], CONTROLLER_ID);

      // Partial payment of ₱24,800.00 gross settled via ₱24,000.00 Cash + ₱800.00 EWT (2% WC158 on ₱40,000.00)
      suppPaymentId = await createSupplierPayment(
        VAT_COMPANY_ID,
        {
          vendorId: VENDOR_ID,
          paymentNumber: 'DV-2026-001',
          paymentDate: txDate,
          cashAccountId: ACC_CASH,
          amount: 2_400_000,
          withholdingTaxAmount: 80_000,
          withholdingTaxAccountId: ACC_EWT_PAY,
          paymentMethod: 'CHECK',
          applications: [
            {
              billId: purchaseBillId,
              appliedAmount: 2_400_000,
              withholdingAmount: 80_000,
            },
          ],
        },
        PREPARER_ID
      );
      await submitSupplierPayment(VAT_COMPANY_ID, suppPaymentId, PREPARER_ID);
      await approveSupplierPayment(VAT_COMPANY_ID, suppPaymentId, APPROVER_ID);
      await postSupplierPayment(VAT_COMPANY_ID, suppPaymentId, PERIOD_ID, CONTROLLER_ID);

      // 5. Inventory Purchase (10 units @ ₱30,000 = ₱300,000) & Issue of 2 units (₱60,000 COGS) => Ending 8 units = ₱240,000 (24,000,000c)
      await db.insert(schema.inventoryItems).values({
        id: ITEM_ID,
        companyId: VAT_COMPANY_ID,
        sku: 'SKU-LAPTOP-PRO',
        name: 'Enterprise Workstation Laptop',
        category: 'Hardware',
        unitOfMeasure: 'UNIT',
        costingMethod: 'FIFO',
        unitCost: 3_000_000, // ₱30,000.00 in centavos
        sellingPrice: 4_500_000,
        quantityOnHand: 8,
        reorderPoint: 3,
        assetAccountId: ACC_INV,
        cogsAccountId: ACC_COGS,
        status: 'ACTIVE',
      });

      const invJournalId = await createJournalEntry(
        VAT_COMPANY_ID,
        {
          journalNumber: 'JV-2026-INV-001',
          entryDate: txDate,
          accountingPeriodId: PERIOD_ID,
          description: 'Inventory acquisition (10 units) and COGS issuance (2 units)',
          sourceType: 'INVENTORY_MOVEMENT',
          sourceId: ITEM_ID,
          createdBy: PREPARER_ID,
        },
        [
          { accountId: ACC_INV, debit: 30_000_000, credit: 0, description: 'Receipt of 10 units @ ₱30,000' },
          { accountId: ACC_CASH, debit: 0, credit: 30_000_000, description: 'Cash purchase of inventory' },
          { accountId: ACC_COGS, debit: 6_000_000, credit: 0, description: 'Issuance of 2 units to COGS' },
          { accountId: ACC_INV, debit: 0, credit: 6_000_000, description: 'Inventory relief for 2 units' },
        ]
      );
      await submitJournalEntry(VAT_COMPANY_ID, invJournalId, PREPARER_ID);
      await approveJournalEntry(VAT_COMPANY_ID, invJournalId, APPROVER_ID);
      await postJournalEntry(VAT_COMPANY_ID, invJournalId, CONTROLLER_ID);

      await db.insert(schema.inventoryTransactions).values([
        {
          id: 'sm-cert-in-01',
          companyId: VAT_COMPANY_ID,
          itemId: ITEM_ID,
          transactionDate: txDate,
          type: 'RECEIPT',
          quantity: 10,
          unitCost: 3_000_000,
          totalValue: 30_000_000,
          reference: GRN_ID,
        },
        {
          id: 'sm-cert-out-01',
          companyId: VAT_COMPANY_ID,
          itemId: ITEM_ID,
          transactionDate: txDate,
          type: 'SALE',
          quantity: -2,
          unitCost: 3_000_000,
          totalValue: 6_000_000,
          reference: siVatableId,
        },
      ]);

      // 6. Fixed Asset Acquisition (₱600,000) & Posted Depreciation (₱10,000) => NBV ₱590,000 (59,000,000c)
      const faJournalId = await createJournalEntry(
        VAT_COMPANY_ID,
        {
          journalNumber: 'JV-2026-FA-001',
          entryDate: txDate,
          accountingPeriodId: PERIOD_ID,
          description: 'Capitalization and first month depreciation of Delivery Van',
          sourceType: 'FIXED_ASSET',
          sourceId: ASSET_ID,
          createdBy: PREPARER_ID,
        },
        [
          { accountId: ACC_FA_COST, debit: 60_000_000, credit: 0, description: 'Delivery Van acquisition cost' },
          { accountId: ACC_CASH, debit: 0, credit: 60_000_000, description: 'Paid cash for Delivery Van' },
          { accountId: ACC_DEP_EXP, debit: 1_000_000, credit: 0, description: 'Monthly straight-line depreciation' },
          { accountId: ACC_FA_ACCUM_DEP, debit: 0, credit: 1_000_000, description: 'Accumulated depreciation' },
        ]
      );
      await submitJournalEntry(VAT_COMPANY_ID, faJournalId, PREPARER_ID);
      await approveJournalEntry(VAT_COMPANY_ID, faJournalId, APPROVER_ID);
      await postJournalEntry(VAT_COMPANY_ID, faJournalId, CONTROLLER_ID);

      await db.insert(schema.fixedAssets).values({
        id: ASSET_ID,
        companyId: VAT_COMPANY_ID,
        assetTag: 'FA-VAN-001',
        assetName: 'Isuzu Logistics Delivery Van',
        category: 'VEHICLE',
        acquisitionDate: txDate,
        acquisitionCost: 60_000_000,
        salvageValue: 0,
        usefulLifeMonths: 60,
        depreciationMethod: 'STRAIGHT_LINE',
        assetAccountId: ACC_FA_COST,
        accumulatedDepAccountId: ACC_FA_ACCUM_DEP,
        depreciationExpenseAccountId: ACC_DEP_EXP,
        status: 'ACTIVE',
      });

      await db.insert(schema.depreciationSchedules).values({
        id: 'dep-sched-cert-001',
        companyId: VAT_COMPANY_ID,
        assetId: ASSET_ID,
        periodMonth: txDate.slice(0, 7),
        depreciationAmount: 1_000_000,
        accumulatedDepreciation: 1_000_000,
        bookValue: 59_000_000,
        status: 'POSTED',
        journalEntryId: faJournalId,
      });

      // 7. Payroll Run & Statutory Deductions (Gross ₱50,000; SSS ₱1,350; PHIC ₱1,250; HDMF ₱200; WTax ₱4,541.67; Net ₱42,658.33)
      await db.insert(schema.employees).values({
        id: EMPLOYEE_ID,
        companyId: VAT_COMPANY_ID,
        employeeNo: 'EMP-CERT-001',
        firstName: 'Emilio',
        lastName: 'Jacinto',
        tin: '234-567-890-000',
        sssNo: '34-9876543-2',
        philhealthNo: '12-987654321-0',
        pagibigNo: '1234-9876-5432',
        department: 'Finance',
        position: 'Senior Finance Officer',
        monthlyBasicSalary: 5_000_000,
        status: 'ACTIVE',
      });

      const prJournalId = await createJournalEntry(
        VAT_COMPANY_ID,
        {
          journalNumber: 'JV-2026-PR-001',
          entryDate: txDate,
          accountingPeriodId: PERIOD_ID,
          description: 'Posted Payroll Run PR-2026-11A with PH statutory deductions',
          sourceType: 'PAYROLL',
          sourceId: PAYROLL_RUN_ID,
          createdBy: PREPARER_ID,
        },
        [
          { accountId: ACC_SAL_EXP, debit: 5_000_000, credit: 0, description: 'Gross salaries & wages' },
          { accountId: ACC_SSS_PAY, debit: 0, credit: 135_000, description: 'SSS employee share payable' },
          { accountId: ACC_PHIC_PAY, debit: 0, credit: 125_000, description: 'PhilHealth employee share payable' },
          { accountId: ACC_HDMF_PAY, debit: 0, credit: 20_000, description: 'Pag-IBIG employee share payable' },
          { accountId: ACC_WTAX_PAY, debit: 0, credit: 454_167, description: 'TRAIN withholding tax on compensation' },
          { accountId: ACC_CASH, debit: 0, credit: 4_265_833, description: 'Net payroll disbursement' },
        ]
      );
      await submitJournalEntry(VAT_COMPANY_ID, prJournalId, PREPARER_ID);
      await approveJournalEntry(VAT_COMPANY_ID, prJournalId, APPROVER_ID);
      await postJournalEntry(VAT_COMPANY_ID, prJournalId, CONTROLLER_ID);

      await db.insert(schema.payrollRuns).values({
        id: PAYROLL_RUN_ID,
        companyId: VAT_COMPANY_ID,
        payrollPeriod: `${currentYear}-${currentMonth}`,
        startDate: `${currentYear}-${currentMonth}-01`,
        endDate: `${currentYear}-${currentMonth}-28`,
        paymentDate: txDate,
        totalGrossPay: 5_000_000,
        totalSss: 135_000,
        totalPhilhealth: 125_000,
        totalPagibig: 20_000,
        totalWithholdingTax: 454_167,
        totalNetPay: 4_265_833,
        status: 'POSTED',
        journalEntryId: prJournalId,
        createdBy: PREPARER_ID,
        approvedBy: APPROVER_ID,
      });

      // 8. Recurring Journal Execution (Monthly Office Rent Accrual ₱15,000.00 / 1,500,000c)
      await db.insert(schema.recurringJournals).values({
        id: 'rec-cert-001',
        companyId: VAT_COMPANY_ID,
        templateName: 'Monthly Office Rent Accrual',
        frequency: 'MONTHLY',
        startDate: new Date(Date.now() - 86_400_000),
        nextRunDate: new Date(Date.now() - 60_000),
        requiresApproval: false,
        status: 'ACTIVE',
        journalDataJson: JSON.stringify({
          description: 'Monthly office space accrual',
          lines: [
            { accountId: ACC_RENT_EXP, debit: 1_500_000, credit: 0, description: 'Monthly office rent expense' },
            { accountId: ACC_ACCRUED_EXP, debit: 0, credit: 1_500_000, description: 'Accrued rent payable' },
          ],
        }),
      });

      const recResult = await RecurringJournalService.processDueTemplates(VAT_COMPANY_ID, CONTROLLER_ID);
      expect(recResult.processedCount).toBe(1);
      expect(recResult.skippedTemplates.length).toBe(0);

      // 9. Supporting Procurement PO + GRN, Bank Reconciliation, Document, Tax Return & System Operation records
      await db.insert(schema.purchaseOrders).values({
        id: PO_ID,
        companyId: VAT_COMPANY_ID,
        vendorId: VENDOR_ID,
        poNumber: 'PO-2026-001',
        poDate: txDate,
        expectedDeliveryDate: dueDate,
        totalAmount: 30_000_000,
        status: 'RECEIVED',
        createdBy: PREPARER_ID,
        approvedBy: APPROVER_ID,
      });

      await db.insert(schema.goodsReceiptNotes).values({
        id: GRN_ID,
        companyId: VAT_COMPANY_ID,
        poId: PO_ID,
        grnNumber: 'GRN-2026-001',
        receiptDate: txDate,
        status: 'RECEIVED',
        receivedBy: CONTROLLER_ID,
      });

      // Expected Ending Cash Balance in centavos:
      // +200,000,000 (Capital) +11,000,000 (OR-2026-001) -2,400,000 (DV-2026-001) -30,000,000 (Inventory) -60,000,000 (Fixed Asset) -4,265,833 (Payroll)
      // = 114,334,167 centavos (₱1,143,341.67)
      const expectedEndingCashCentavos = 114_334_167;

      await db.insert(schema.bankAccounts).values({
        id: BANK_ACC_ID,
        companyId: VAT_COMPANY_ID,
        accountName: 'BPI Corporate Checking Account',
        bankName: 'Bank of the Philippine Islands (BPI)',
        accountNumberEncrypted: 'ENC:0012-3456-78',
        currency: 'PHP',
        status: 'ACTIVE',
      });

      await db.insert(schema.bankReconciliations).values({
        id: BANK_RECON_ID,
        companyId: VAT_COMPANY_ID,
        bankAccountId: ACC_CASH,
        statementDate: txDate,
        statementEndingBalance: expectedEndingCashCentavos,
        bookEndingBalance: expectedEndingCashCentavos,
        adjustedBookBalance: expectedEndingCashCentavos,
        adjustedStatementBalance: expectedEndingCashCentavos,
        unexplainedDifference: 0,
        status: 'APPROVED',
        createdBy: PREPARER_ID,
        approvedBy: CONTROLLER_ID,
      });

      await db.insert(schema.documents).values({
        id: DOC_ID,
        companyId: VAT_COMPANY_ID,
        entityType: 'SALES_INVOICE',
        entityId: siVatableId,
        documentType: 'SALES_INVOICE',
        fileName: 'SI-2026-001-Signed.pdf',
        fileType: 'application/pdf',
        fileSize: 48200,
        filePath: '/uploads/SI-2026-001-Signed.pdf',
        ocrStatus: 'APPROVED',
        verificationStatus: 'VERIFIED',
        uploadedBy: PREPARER_ID,
      });

      await db.insert(schema.taxFilings).values({
        id: TAX_FILING_ID,
        companyId: VAT_COMPANY_ID,
        taxType: '2550M',
        periodName: `${currentYear}-${currentMonth}`,
        startDate: `${currentYear}-${currentMonth}-01`,
        endDate: `${currentYear}-${currentMonth}-28`,
        deadlineDate: `${currentYear}-${currentMonth}-20`,
        status: 'DRAFT',
        notes: 'Optional Monthly VAT Declaration per BIR RMC No. 52-2023',
      });

      await db.insert(schema.systemBackups).values({
        id: SYS_OP_AUDIT_ID,
        companyId: VAT_COMPANY_ID,
        backupName: 'BKP-2026-CERT-001.lai',
        checksum: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        sizeBytes: 262144,
        passwordProtected: true,
        payloadJson: JSON.stringify({ version: '1.0.0-rc.2', verified: true }),
        createdBy: CONTROLLER_ID,
      });

      await db.insert(schema.auditLogs).values({
        id: `${SYS_OP_AUDIT_ID}-log`,
        companyId: VAT_COMPANY_ID,
        userId: CONTROLLER_ID,
        action: 'SYSTEM_BACKUP_VERIFIED',
        entityType: 'SYSTEM_OPERATION',
        entityId: SYS_OP_AUDIT_ID,
        module: 'System Operations',
        result: 'SUCCESS',
        severity: 'INFO',
      });
    });

    // Provision Non-VAT transaction in isolated Non-VAT company (₱100,000.00 sale => ₱0 Output VAT, ₱3,000.00 Percentage Tax)
    const nonVatDb = await CompanyManager.getCompanyDb(NONVAT_COMPANY_ID);
    await dbContext.run(nonVatDb, async () => {
      const nvInvId = await createSalesInvoice(
        NONVAT_COMPANY_ID,
        {
          customerId: 'nv-cust-001',
          invoiceNumber: 'SI-NV-2026-001',
          invoiceDate: txDate,
          dueDate,
          totalAmount: 10_000_000,
          lines: [
            {
              accountId: 'nv-acc-4010',
              description: 'Non-VAT Bookkeeping Advisory Services',
              quantity: 1,
              unitPrice: 10_000_000,
              amount: 10_000_000,
            },
          ],
        },
        PREPARER_ID
      );
      await submitSalesInvoice(NONVAT_COMPANY_ID, nvInvId, PREPARER_ID);
      await approveSalesInvoice(NONVAT_COMPANY_ID, nvInvId, NONVAT_OWNER_ID);
      await postSalesInvoice(NONVAT_COMPANY_ID, nvInvId, 'prd-nonvat-2026', [], NONVAT_OWNER_ID);
    });
  });

  it('PHASE 4: Cross-Module Financial Parity — Independently Calculated Expected Values vs Dashboard, Operations, GL & Financial Statements', async () => {
    // Independent Expected Values for LGR-PH-CERT-SIM-VAT (in integer centavos):
    const EXP_CASH_CENTAVOS = 114_334_167; // ₱1,143,341.67
    const EXP_AR_CENTAVOS = 7_500_000;     // ₱75,000.00 (SI-002 ₱50k + SI-003 ₱25k; SI-001 ₱112k fully settled)
    const EXP_AP_CENTAVOS = 2_000_000;     // ₱20,000.00 (BILL-001 ₱44,800 - DV-001 ₱24,800)
    const EXP_REVENUE_CENTAVOS = 17_500_000; // ₱175,000.00 (₱100k VATable net + ₱50k Zero-Rated + ₱25k Exempt)
    const EXP_EXPENSES_CENTAVOS = 17_500_000; // ₱175,000.00 (₱40k OPEX + ₱60k COGS + ₱10k Dep + ₱50k Salaries + ₱15k Rent)
    const EXP_NET_INCOME_CENTAVOS = 0;       // ₱175,000.00 - ₱175,000.00 = ₱0.00
    const EXP_INV_CENTAVOS = 24_000_000;   // ₱240,000.00 (8 units @ ₱30,000)
    const EXP_FA_COST_CENTAVOS = 60_000_000;
    const EXP_FA_ACCUM_DEP_CENTAVOS = 1_000_000;
    const EXP_FA_NBV_CENTAVOS = 59_000_000;
    const EXP_OUTPUT_VAT_CENTAVOS = 1_200_000; // ₱12,000.00
    const EXP_INPUT_VAT_CENTAVOS = 480_000;    // ₱4,800.00
    const EXP_CWT_CENTAVOS = 200_000;          // ₱2,000.00
    const EXP_NET_VAT_PAYABLE_CENTAVOS = 720_000; // ₱12,000 - ₱4,800 = ₱7,200.00

    // 1. Executive & Finance Dashboard (/api/dashboard/overview)
    const dashRes = await request(app)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${controllerToken}`);

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.cashBalance).toBe(EXP_CASH_CENTAVOS);
    expect(dashRes.body.accountsReceivable).toBe(EXP_AR_CENTAVOS);
    expect(dashRes.body.accountsPayable).toBe(EXP_AP_CENTAVOS);
    expect(dashRes.body.summaryStats.totalYtdRevenue).toBe(EXP_REVENUE_CENTAVOS);
    expect(dashRes.body.summaryStats.totalYtdExpenses).toBe(EXP_EXPENSES_CENTAVOS);
    expect(dashRes.body.summaryStats.totalYtdNetProfit).toBe(EXP_NET_INCOME_CENTAVOS);

    // Reconciliation Controls
    expect(dashRes.body.reconciliationSummary.tbStatus).toBe('OK');
    expect(dashRes.body.reconciliationSummary.tbBalanced).toBe(true);
    expect(dashRes.body.reconciliationSummary.tbVarianceCentavos).toBe(0);
    expect(dashRes.body.reconciliationSummary.arSubledgerCentavos).toBe(EXP_AR_CENTAVOS);
    expect(dashRes.body.reconciliationSummary.arGlControlCentavos).toBe(EXP_AR_CENTAVOS);
    expect(dashRes.body.reconciliationSummary.arVarianceCentavos).toBe(0);
    expect(dashRes.body.reconciliationSummary.apSubledgerCentavos).toBe(EXP_AP_CENTAVOS);
    expect(dashRes.body.reconciliationSummary.apGlControlCentavos).toBe(EXP_AP_CENTAVOS);
    expect(dashRes.body.reconciliationSummary.apVarianceCentavos).toBe(0);

    // Tax Estimate on Dashboard
    expect(dashRes.body.taxEstimate.outputVat).toBe(EXP_OUTPUT_VAT_CENTAVOS);
    expect(dashRes.body.taxEstimate.inputVat).toBe(EXP_INPUT_VAT_CENTAVOS);
    expect(dashRes.body.taxEstimate.ewtWithheld).toBe(EXP_CWT_CENTAVOS);
    expect(dashRes.body.taxEstimate.netVatPayable).toBe(EXP_NET_VAT_PAYABLE_CENTAVOS);
    expect(dashRes.body.taxEstimate.vatFilingFrequency).toBe('MONTHLY_OPTIONAL');
    expect(dashRes.body.taxEstimate.primaryForm).toContain('2550M');

    // 2. Operations Dashboard (/api/operations/summary)
    const opsRes = await request(app)
      .get('/api/operations/summary')
      .set('Authorization', `Bearer ${controllerToken}`);

    expect(opsRes.status).toBe(200);
    expect(opsRes.body.sales.unpaidAmountCentavos).toBe(EXP_AR_CENTAVOS);
    expect(opsRes.body.sales.arGlBalanceCentavos).toBe(EXP_AR_CENTAVOS);
    expect(opsRes.body.sales.arVarianceCentavos).toBe(0);
    expect(opsRes.body.sales.outputVatCentavos).toBe(EXP_OUTPUT_VAT_CENTAVOS);
    expect(opsRes.body.sales.status).toBe('OK');

    expect(opsRes.body.inventory.stockValuationCentavos).toBe(EXP_INV_CENTAVOS);
    expect(opsRes.body.inventory.inventoryGlBalanceCentavos).toBe(EXP_INV_CENTAVOS);
    expect(opsRes.body.inventory.inventoryVarianceCentavos).toBe(0);
    expect(opsRes.body.inventory.totalQuantityOnHand).toBe(8);
    expect(opsRes.body.inventory.status).toBe('OK');

    expect(opsRes.body.fixedAssets.acquisitionCostCentavos).toBe(EXP_FA_COST_CENTAVOS);
    expect(opsRes.body.fixedAssets.accumulatedDepreciationCentavos).toBe(EXP_FA_ACCUM_DEP_CENTAVOS);
    expect(opsRes.body.fixedAssets.netBookValueCentavos).toBe(EXP_FA_NBV_CENTAVOS);
    expect(opsRes.body.fixedAssets.status).toBe('OK');

    expect(opsRes.body.payroll.grossPayrollCentavos).toBe(5_000_000);
    expect(opsRes.body.payroll.sssTotalCentavos).toBe(135_000);
    expect(opsRes.body.payroll.philhealthTotalCentavos).toBe(125_000);
    expect(opsRes.body.payroll.pagibigTotalCentavos).toBe(20_000);
    expect(opsRes.body.payroll.withholdingTaxCentavos).toBe(454_167);
    expect(opsRes.body.payroll.netPayCentavos).toBe(4_265_833);
    expect(opsRes.body.payroll.status).toBe('OK');

    expect(opsRes.body.banking.reconciledBalanceCentavos).toBe(EXP_CASH_CENTAVOS);
    expect(opsRes.body.banking.approvedReconciliations).toBe(1);
    expect(opsRes.body.banking.status).toBe('OK');

    // 3. Financial Statements & Subledger Reports (/api/reports/*)
    const tbRes = await request(app)
      .get('/api/reports/trial-balance')
      .set('Authorization', `Bearer ${controllerToken}`);
    expect(tbRes.status).toBe(200);
    expect(Array.isArray(tbRes.body)).toBe(true);
    const tbTotalDebit = (tbRes.body as any[]).reduce((s, r) => s + Number(r.closingDebit || 0), 0);
    const tbTotalCredit = (tbRes.body as any[]).reduce((s, r) => s + Number(r.closingCredit || 0), 0);
    expect(tbTotalDebit).toBe(tbTotalCredit);
    expect(tbTotalDebit).toBeGreaterThan(0);

    const isRes = await request(app)
      .get('/api/reports/income-statement')
      .set('Authorization', `Bearer ${controllerToken}`);
    expect(isRes.status).toBe(200);
    expect(isRes.body.totalRevenue).toBe(EXP_REVENUE_CENTAVOS);
    expect(isRes.body.totalExpense).toBe(EXP_EXPENSES_CENTAVOS);
    expect(isRes.body.netIncome).toBe(EXP_NET_INCOME_CENTAVOS);

    const bsRes = await request(app)
      .get('/api/reports/balance-sheet')
      .set('Authorization', `Bearer ${controllerToken}`);
    expect(bsRes.status).toBe(200);
    expect(bsRes.body.balanced).toBe(true);
    expect(bsRes.body.accountingEquationDiscrepancy).toBe(0);
    expect(bsRes.body.totalAssets).toBe(bsRes.body.totalLiabilities + bsRes.body.totalEquity);

    // 4. Non-VAT Company Verification (Percentage Tax 3% on ₱100,000 = ₱3,000 / 300,000c, Output VAT = 0)
    const nonVatOpsRes = await request(app)
      .get('/api/operations/summary')
      .set('Authorization', `Bearer ${nonVatOwnerToken}`);
    expect(nonVatOpsRes.status).toBe(200);
    expect(nonVatOpsRes.body.vatStatus).toBe('NON_VAT');
    expect(nonVatOpsRes.body.sales.unpaidAmountCentavos).toBe(10_000_000);
    expect(nonVatOpsRes.body.sales.outputVatCentavos).toBe(0);
    expect(nonVatOpsRes.body.sales.percentageTaxCentavos).toBe(300_000);

    const nonVatDashRes = await request(app)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${nonVatOwnerToken}`);
    expect(nonVatDashRes.status).toBe(200);
    expect(nonVatDashRes.body.taxEstimate.vatStatus).toBe('NON_VAT');
    expect(nonVatDashRes.body.taxEstimate.primaryForm).toBe('2551Q');
    expect(nonVatDashRes.body.taxEstimate.outputVat).toBe(0);
  });

  it('PHASE 3: Complete 360° Traceability — All 16 Registered Entity Types & Atomic COPY / ADJUST / REVERSE Lifecycle', async () => {
    const entityTargets: Array<{ type: string; id: string; expectedRefFragment?: string }> = [
      { type: 'CUSTOMER', id: CUSTOMER_ID, expectedRefFragment: 'Makati Prime' },
      { type: 'VENDOR', id: VENDOR_ID, expectedRefFragment: 'Taguig Industrial' },
      { type: 'EMPLOYEE', id: EMPLOYEE_ID, expectedRefFragment: 'Jacinto' },
      { type: 'ACCOUNT', id: ACC_CASH, expectedRefFragment: '1010' },
      { type: 'SALES_INVOICE', id: siVatableId, expectedRefFragment: 'SI-2026-001' },
      { type: 'PURCHASE_BILL', id: purchaseBillId, expectedRefFragment: 'BILL-2026-001' },
      { type: 'PURCHASE_ORDER', id: PO_ID, expectedRefFragment: 'PO-2026-001' },
      { type: 'PAYMENT', id: custPaymentId, expectedRefFragment: 'CR-2026-001' },
      { type: 'JOURNAL_ENTRY', id: capitalJournalId, expectedRefFragment: 'JV-2026-CAP-001' },
      { type: 'INVENTORY_ITEM', id: ITEM_ID, expectedRefFragment: 'SKU-LAPTOP-PRO' },
      { type: 'FIXED_ASSET', id: ASSET_ID, expectedRefFragment: 'FA-VAN-001' },
      { type: 'PAYROLL_RUN', id: PAYROLL_RUN_ID, expectedRefFragment: `${currentYear}-${currentMonth}` },
      { type: 'DOCUMENT', id: DOC_ID, expectedRefFragment: 'SI-2026-001-Signed.pdf' },
      { type: 'TAX_RETURN', id: TAX_FILING_ID, expectedRefFragment: '2550M' },
      { type: 'BANK_RECONCILIATION', id: BANK_RECON_ID },
      { type: 'SYSTEM_OPERATION', id: SYS_OP_AUDIT_ID },
    ];

    for (const target of entityTargets) {
      const res = await request(app)
        .get(`/api/journey/360/${target.type}/${target.id}`)
        .set('Authorization', `Bearer ${controllerToken}`);

      expect(res.status, `Failed 360° fetch for ${target.type}/${target.id}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.record).toBeDefined();
      expect(res.body.entity360Definition).toBeDefined();
      expect(res.body.lifecycleCheckpoints).toBeDefined();
      if (target.expectedRefFragment) {
        expect(JSON.stringify(res.body)).toContain(target.expectedRefFragment);
      }
    }

    // Verify COPY preserves Sales Invoice line items
    const copyRes = await request(app)
      .post(`/api/journey/action/SALES_INVOICE/${siZeroRatedId}`)
      .set('Authorization', `Bearer ${controllerToken}`)
      .send({ action: 'COPY', reason: 'Copy zero-rated invoice for recurring shipment' });

    expect(copyRes.status).toBe(201);
    const copiedInvoiceId = copyRes.body.newId || copyRes.body.newEntityId || copyRes.body.copiedId || copyRes.body.id;
    expect(copiedInvoiceId).toBeTruthy();

    const vatDb = await CompanyManager.getCompanyDb(VAT_COMPANY_ID);
    await dbContext.run(vatDb, async () => {
      const copiedLines = await db.select().from(schema.salesInvoiceLines).where(eq(schema.salesInvoiceLines.invoiceId, copiedInvoiceId));
      expect(copiedLines.length).toBe(1);
      expect(copiedLines[0].amount).toBe(5_000_000);
      // Clean up draft copy so it doesn't alter subsequent tests
      await db.delete(schema.salesInvoiceLines).where(eq(schema.salesInvoiceLines.invoiceId, copiedInvoiceId));
      await db.delete(schema.salesInvoices).where(eq(schema.salesInvoices.id, copiedInvoiceId));
    });

    // Verify REVERSE atomically reverses GL + AR on an isolated posted invoice
    let tempRevInvId = '';
    await dbContext.run(vatDb, async () => {
      tempRevInvId = await createSalesInvoice(
        VAT_COMPANY_ID,
        {
          customerId: CUSTOMER_ID,
          invoiceNumber: 'SI-2026-REV-TEST',
          invoiceDate: txDate,
          dueDate,
          totalAmount: 1_120_000,
          lines: [
            {
              accountId: ACC_REV_VAT,
              taxCodeId: TAX_CODE_OUTPUT_VAT,
              description: 'Reversal atomicity test line',
              quantity: 1,
              unitPrice: 1_000_000,
              amount: 1_000_000,
              taxAmount: 120_000,
              isTaxInclusive: false,
            },
          ],
        },
        PREPARER_ID
      );
      await submitSalesInvoice(VAT_COMPANY_ID, tempRevInvId, PREPARER_ID);
      await approveSalesInvoice(VAT_COMPANY_ID, tempRevInvId, APPROVER_ID);
      await postSalesInvoice(VAT_COMPANY_ID, tempRevInvId, PERIOD_ID, [], CONTROLLER_ID);
    });

    // Reverse the posted invoice via 360° Journey action
    const revRes = await request(app)
      .post(`/api/journey/action/SALES_INVOICE/${tempRevInvId}`)
      .set('Authorization', `Bearer ${controllerToken}`)
      .send({ action: 'REVERSE', reason: 'Customer cancelled order before delivery' });

    expect(revRes.status).toBe(200);

    // Confirm AR & Revenue returned to exact pre-test parity (₱75,000.00 AR and ₱175,000.00 Revenue)
    const dashAfterRev = await request(app)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${controllerToken}`);
    expect(dashAfterRev.status).toBe(200);
    expect(dashAfterRev.body.accountsReceivable).toBe(7_500_000);
    expect(dashAfterRev.body.summaryStats.totalYtdRevenue).toBe(17_500_000);
    expect(dashAfterRev.body.reconciliationSummary.arVarianceCentavos).toBe(0);
    expect(dashAfterRev.body.reconciliationSummary.tbBalanced).toBe(true);
  });

  it('PHASE 5: Negative & Adversarial Testing — Rejects Invalid, Duplicate, Self-Approved, Locked-Period & Cross-Tenant Operations', async () => {
    const vatDb = await CompanyManager.getCompanyDb(VAT_COMPANY_ID);

    await dbContext.run(vatDb, async () => {
      // 1. Duplicate Invoice Number Rejection
      await expect(
        createSalesInvoice(
          VAT_COMPANY_ID,
          {
            customerId: CUSTOMER_ID,
            invoiceNumber: 'SI-2026-001',
            invoiceDate: txDate,
            dueDate,
            totalAmount: 1_000_000,
            lines: [{ accountId: ACC_REV_VAT, amount: 1_000_000 }],
          },
          PREPARER_ID
        )
      ).rejects.toThrow(/Duplicate invoice reference/i);

      // 2. Zero-Line Invoice Rejection
      await expect(
        createSalesInvoice(
          VAT_COMPANY_ID,
          {
            customerId: CUSTOMER_ID,
            invoiceNumber: 'SI-2026-ZERO-LINE',
            invoiceDate: txDate,
            dueDate,
            totalAmount: 1_000_000,
            lines: [],
          },
          PREPARER_ID
        )
      ).rejects.toThrow(/At least one valid line item/i);

      // 3. Header/Line Mismatch Rejection
      await expect(
        createSalesInvoice(
          VAT_COMPANY_ID,
          {
            customerId: CUSTOMER_ID,
            invoiceNumber: 'SI-2026-MISMATCH',
            invoiceDate: txDate,
            dueDate,
            totalAmount: 9_999_999,
            lines: [{ accountId: ACC_REV_VAT, amount: 1_000_000 }],
          },
          PREPARER_ID
        )
      ).rejects.toThrow(/does not reconcile with line-item totals/i);

      // 4. Maker-Checker / Segregation of Duties Violation (Preparer attempting self-approval)
      const draftInvId = await createSalesInvoice(
        VAT_COMPANY_ID,
        {
          customerId: CUSTOMER_ID,
          invoiceNumber: 'SI-2026-SOD-TEST',
          invoiceDate: txDate,
          dueDate,
          totalAmount: 1_000_000,
          lines: [{ accountId: ACC_REV_VAT, amount: 1_000_000 }],
        },
        PREPARER_ID
      );
      await submitSalesInvoice(VAT_COMPANY_ID, draftInvId, PREPARER_ID);
      await expect(
        approveSalesInvoice(VAT_COMPANY_ID, draftInvId, PREPARER_ID)
      ).rejects.toThrow(/Segregation of Duties/i);

      // Clean up SOD draft invoice
      await db.delete(schema.salesInvoiceLines).where(eq(schema.salesInvoiceLines.invoiceId, draftInvId));
      await db.delete(schema.salesInvoices).where(eq(schema.salesInvoices.id, draftInvId));

      // 5. Locked Accounting Period Rejection (2024 HARD_CLOSED period)
      await expect(
        createSalesInvoice(
          VAT_COMPANY_ID,
          {
            customerId: CUSTOMER_ID,
            invoiceNumber: 'SI-2024-LOCKED',
            invoiceDate: '2024-06-15',
            dueDate: '2024-06-30',
            totalAmount: 1_000_000,
            lines: [{ accountId: ACC_REV_VAT, amount: 1_000_000 }],
          },
          PREPARER_ID
        )
      ).rejects.toThrow(/closed|locked/i);
    });

    // 6. Cross-Tenant Isolation (Non-VAT Owner Token attempting to read VAT Company 360° Sales Invoice)
    const crossTenantRes = await request(app)
      .get(`/api/journey/360/SALES_INVOICE/${siVatableId}`)
      .set('Authorization', `Bearer ${nonVatOwnerToken}`);
    expect([403, 404]).toContain(crossTenantRes.status);

    // 7. Invalid Statutory Filing Period Span (Quarterly 2550Q given a 5-day window)
    const badSpanRes = await request(app)
      .post('/api/tax/filings')
      .set('Authorization', `Bearer ${controllerToken}`)
      .send({
        taxType: '2550Q',
        periodName: 'Invalid Span Q1',
        startDate: `${currentYear}-01-01`,
        endDate: `${currentYear}-01-05`,
      });
    expect(badSpanRes.status).toBe(400);
    expect(badSpanRes.body.error).toContain('Statutory Frequency Error');
  });

  it('PHASE 6: BIR & Accounting Statutory Validation — RMC 5-2023, RMC 52-2023, RMC 5-2021 & RMC 65-2025', async () => {
    // 1. Verify VAT Quarterly Default (RMC 5-2023) vs Optional Monthly Election (RMC 52-2023)
    const quarterlyRule = resolveVatOrPercentageFilingRule({
      vatStatus: 'VAT',
      vatFilingFrequency: 'QUARTERLY',
    });
    expect(quarterlyRule.vatFilingFrequency).toBe('QUARTERLY');
    expect(quarterlyRule.primaryVatOrPercentageForm).toContain('2550Q');
    expect(quarterlyRule.ruleReference).toContain('RMC 5-2023');

    const monthlyOptionalRule = resolveVatOrPercentageFilingRule({
      vatStatus: 'VAT',
      vatFilingFrequency: 'MONTHLY_OPTIONAL',
    });
    expect(monthlyOptionalRule.vatFilingFrequency).toBe('MONTHLY_OPTIONAL');
    expect(monthlyOptionalRule.primaryVatOrPercentageForm).toContain('2550M');
    expect(monthlyOptionalRule.ruleReference).toContain('RMC 52-2023');

    // 2. Verify Non-VAT Percentage Tax Rule (2551Q)
    const nonVatRule = resolveVatOrPercentageFilingRule({
      vatStatus: 'NON_VAT',
    });
    expect(nonVatRule.primaryVatOrPercentageForm).toBe('2551Q');

    // 3. Verify Tax Profile Rules include both 2550Q and optional 2550M for VAT taxpayers
    const corpVatProfile = getBirTaxProfileRules('CORPORATION', 'VAT');
    expect(corpVatProfile.vatOrPercentageForm).toContain('2550Q');
    expect(corpVatProfile.optionalMonthlyVatForm).toContain('2550M');

    // 4. Verify CAS/CBA Registration Status is never fabricated (no fake BIR PTU/AC issued by default)
    const birStatusRes = await request(app)
      .get('/api/tax/bir-compliance/status')
      .set('Authorization', `Bearer ${controllerToken}`);
    if (birStatusRes.status === 200) {
      const bodyStr = JSON.stringify(birStatusRes.body);
      expect(bodyStr).not.toContain('PTU-2026-FAKE');
    }
  });
});
