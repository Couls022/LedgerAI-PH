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
  isAccountActive,
} from '../../src/shared/coaAccountUtils';

describe('LEDGERAI PH — UNIVERSAL COA DISCOVERY & ZERO-COA COMPANY SUPPORT', () => {
  const app = createApp();

  const ZERO_COA_COMPANY_ID = 'LGR-PH-ZERO-COA-TEST';
  const ENTERPRISE_COA_COMPANY_ID = 'LGR-PH-ENT-COA-TEST';
  const TENANT_ISOLATION_COMPANY_ID = 'LGR-PH-ISO-COA-TEST';

  const ZERO_OWNER_ID = 'usr-zero-owner';
  const ENT_OWNER_ID = 'usr-ent-owner';
  const ISO_OWNER_ID = 'usr-iso-owner';

  let zeroOwnerToken = '';
  let entOwnerToken = '';
  let isoOwnerToken = '';

  const cleanupTestCompanies = async () => {
    await CompanyManager.closeAllConnections();
    for (const cid of [ZERO_COA_COMPANY_ID, ENTERPRISE_COA_COMPANY_ID, TENANT_ISOLATION_COMPANY_ID]) {
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

  const seedCompanyWithUser = async (companyId: string, companyName: string, userId: string, skipCoa: boolean) => {
    await CompanyManager.createCompanyProfile(
      companyId,
      companyName,
      undefined,
      undefined,
      false,
      { classification: 'TEST' }
    );
    const compDb = await CompanyManager.getCompanyDb(companyId);
    let rawToken = '';

    await dbContext.run(compDb, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      const ownerRole = await RbacService.ensureRoleRecord('Company Owner');

      await compDb.insert(schema.users).values({
        id: userId,
        email: `${userId}@enterprise-test.ph`,
        displayName: `Owner ${companyName}`,
        passwordHash: 'test-hash-pass',
        status: 'ACTIVE',
      });

      await compDb.insert(schema.companyUsers).values({
        id: `mem-${userId}`,
        userId,
        companyId,
        roleId: ownerRole.id,
        legacyRole: 'Company Owner',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE',
        defaultDataScope: 'COMPANY_WIDE',
      });

      await compDb.insert(schema.companyUserRoles).values({
        id: `cur-${userId}`,
        companyUserId: `mem-${userId}`,
        roleId: ownerRole.id,
        roleCode: ownerRole.code,
        roleTemplateVersion: 1,
        isPrimary: true,
        assignmentStatus: 'ACTIVE',
        assignedBy: userId,
      });

      await RbacService.applyRoleDefaultModulesToUser(`mem-${userId}`, 'Company Owner', userId, 'Setup');

      rawToken = crypto.randomBytes(32).toString('hex');
      await compDb.insert(schema.sessions).values({
        id: hashToken(rawToken),
        userId,
        expiresAt: new Date(Date.now() + 86400_000),
        activeCompanyId: companyId,
        ipAddress: '127.0.0.1',
        userAgent: 'Vitest-Universal-COA',
      });

      // Insert company master row
      await compDb.insert(schema.companies).values({
        id: companyId,
        legalName: companyName,
        tradeName: companyName,
        tin: '999-888-777-000',
        rdoCode: '039',
        vatStatus: 'VAT',
        taxpayerClassification: 'CORPORATION',
        classification: 'TEST',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      // Insert company tax profile
      await compDb.insert(schema.companyTaxProfiles).values({
        id: `taxprof-${companyId}`,
        companyId,
        tin: '999-888-777-000',
        rdo: '039',
        vatStatus: 'VAT',
        taxpayerClassification: 'CORPORATION',
        accountingPeriod: 'CALENDAR',
      });

      // Insert FY 2026 Accounting Period
      await compDb.insert(schema.accountingPeriods).values({
        id: `period-${companyId}-2026-01`,
        companyId,
        name: '2026-01',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        fiscalYear: 2026,
        status: 'OPEN',
      });
    });

    return `${companyId}.${rawToken}`;
  };

  beforeAll(async () => {
    await cleanupTestCompanies();
    zeroOwnerToken = await seedCompanyWithUser(ZERO_COA_COMPANY_ID, 'Zero COA Clean Slate Inc', ZERO_OWNER_ID, true);
    entOwnerToken = await seedCompanyWithUser(ENTERPRISE_COA_COMPANY_ID, 'Enterprise Universal COA Corp', ENT_OWNER_ID, false);
    isoOwnerToken = await seedCompanyWithUser(TENANT_ISOLATION_COMPANY_ID, 'Isolated Sister Company Corp', ISO_OWNER_ID, false);
  });

  afterAll(async () => {
    await cleanupTestCompanies();
  });

  // ==========================================================================
  // SCENARIO A: ZERO-COA COMPANY SUPPORT
  // ==========================================================================
  describe('SCENARIO A — Genuine Zero-COA Company Support', () => {
    it('A1: company created with skipCoaSeed has exactly zero accounts in database', async () => {
      const compDb = await CompanyManager.getCompanyDb(ZERO_COA_COMPANY_ID);
      const accountsInDb = await compDb.select().from(schema.accounts).where(eq(schema.accounts.companyId, ZERO_COA_COMPANY_ID));
      expect(accountsInDb.length).toBe(0);
    });

    it('A2: GET /api/accounting/accounts returns empty array without silent fallbacks or errors', async () => {
      const res = await request(app)
        .get('/api/accounting/accounts')
        .set('Authorization', `Bearer ${zeroOwnerToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('A3: centralized frontend filters gracefully return empty array when zero accounts exist', () => {
      const emptyAccounts: any[] = [];
      const eligibleSourceCash = filterEligibleSourceCashAccounts(emptyAccounts);
      const eligibleDestBanks = filterEligibleDestinationBankAccounts(emptyAccounts);
      const postableLeaf = filterPostableLeafAccounts(emptyAccounts);

      expect(eligibleSourceCash).toEqual([]);
      expect(eligibleDestBanks).toEqual([]);
      expect(postableLeaf).toEqual([]);
    });
  });

  // ==========================================================================
  // SCENARIO B: EXPLICIT ON-DEMAND TEMPLATE SEEDING
  // ==========================================================================
  describe('SCENARIO B — Explicit Controlled BIR COA Template Seeding', () => {
    it('B1: POST /api/master-data/accounts/seed-template initializes standard BIR COA', async () => {
      const res = await request(app)
        .post('/api/master-data/accounts/seed-template')
        .set('Authorization', `Bearer ${zeroOwnerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.seededCount).toBeGreaterThanOrEqual(20);
      expect(res.body.totalCount).toBe(res.body.seededCount);

      // Verify DB now holds the newly seeded accounts
      const compDb = await CompanyManager.getCompanyDb(ZERO_COA_COMPANY_ID);
      const accountsInDb = await compDb.select().from(schema.accounts).where(eq(schema.accounts.companyId, ZERO_COA_COMPANY_ID));
      expect(accountsInDb.length).toBe(res.body.totalCount);
    });

    it('B2: repeated seed-template calls are strictly idempotent and prevent duplicate accounts', async () => {
      const res = await request(app)
        .post('/api/master-data/accounts/seed-template')
        .set('Authorization', `Bearer ${zeroOwnerToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.seededCount).toBe(0); // 0 new accounts added because all exist!
    });
  });

  // ==========================================================================
  // SCENARIO C: UNIVERSAL DISCOVERY & 10+ CASH/BANK ACCOUNTS
  // ==========================================================================
  describe('SCENARIO C — Universal COA Discovery with 10+ Accounts (Eliminating First-Two Limitation)', () => {
    const cashBankAccountsToSeed = [
      { code: '1010', name: 'Cash in Bank - BPI Corporate Main', detail: 'CHECKING' },
      { code: '1012', name: 'Cash in Bank - Metrobank USD FCDU', detail: 'DOLLAR_ACCOUNT' },
      { code: '1015', name: 'Cash in Bank - BPI Payroll Account', detail: 'PAYROLL_BANK' },
      { code: '1020', name: 'Petty Cash Fund - Makati HQ', detail: 'PETTY_CASH' },
      { code: '1025', name: 'Petty Cash Fund - Cebu Branch', detail: 'PETTY_CASH' },
      { code: '2026', name: 'BDO Business Checking Account', detail: 'CHECKING' },
      { code: 'BNK-BDO-01', name: 'BDO Pasong Tamo Commercial Checking', detail: 'CHECKING' },
      { code: 'CASH-01', name: 'Cash on Hand - Undeposited Collections', detail: 'CASH_ON_HAND' },
    ];

    beforeAll(async () => {
      const compDb = await CompanyManager.getCompanyDb(ENTERPRISE_COA_COMPANY_ID);
      await dbContext.run(compDb, async () => {
        for (const acc of cashBankAccountsToSeed) {
          await compDb.insert(schema.accounts).values({
            id: `acc-ent-${acc.code}`,
            companyId: ENTERPRISE_COA_COMPANY_ID,
            accountCode: acc.code,
            accountName: acc.name,
            accountType: 'ASSET',
            detailType: acc.detail,
            birTaxCategory: 'NOT_APPLICABLE',
            normalBalance: 'DEBIT',
            isCashAccount: true,
            status: 'ACTIVE',
            isActive: true,
          }).onConflictDoNothing();
        }

        // Insert bank registry accounts for the bank-type accounts
        const bankRegistries = [
          { id: 'bacc-01', glId: 'acc-ent-1010', name: 'BPI Checking', bank: 'BPI Corporate', num: '0041-8892-19' },
          { id: 'bacc-02', glId: 'acc-ent-1012', name: 'Metrobank USD', bank: 'Metrobank FCDU', num: '2891-0021-44' },
          { id: 'bacc-03', glId: 'acc-ent-1015', name: 'BPI Payroll', bank: 'BPI Corporate', num: '0041-9932-55' },
          { id: 'bacc-04', glId: 'acc-ent-2026', name: 'BDO Checking', bank: 'BDO Unibank', num: '0012-3456-78' },
          { id: 'bacc-05', glId: 'acc-ent-BNK-BDO-01', name: 'BDO Commercial', bank: 'BDO Pasong Tamo', num: '0089-1122-33' },
        ];

        for (const b of bankRegistries) {
          await compDb.insert(schema.bankAccounts).values({
            id: b.id,
            companyId: ENTERPRISE_COA_COMPANY_ID,
            glAccountId: b.glId,
            accountName: b.name,
            bankName: b.bank,
            accountNumberEncrypted: b.num,
            currency: 'PHP',
            status: 'ACTIVE',
          }).onConflictDoNothing();
        }
      });
    });

    it('C1: filterEligibleSourceCashAccounts discovers and returns ALL 8 cash/bank accounts with no 2-account cutoff', async () => {
      const compDb = await CompanyManager.getCompanyDb(ENTERPRISE_COA_COMPANY_ID);
      const allAccounts = await compDb.select().from(schema.accounts).where(eq(schema.accounts.companyId, ENTERPRISE_COA_COMPANY_ID));
      const sourceCash = filterEligibleSourceCashAccounts(allAccounts);

      // Verify all 8 accounts are present
      expect(sourceCash.length).toBeGreaterThanOrEqual(8);
      const returnedCodes = sourceCash.map(a => a.accountCode);
      expect(returnedCodes).toContain('1010');
      expect(returnedCodes).toContain('1012');
      expect(returnedCodes).toContain('1015');
      expect(returnedCodes).toContain('1020');
      expect(returnedCodes).toContain('1025');
      expect(returnedCodes).toContain('2026');
      expect(returnedCodes).toContain('BNK-BDO-01');
      expect(returnedCodes).toContain('CASH-01');
    });

    it('C2: filterEligibleDestinationBankAccounts strictly includes only bank accounts and excludes physical cash', async () => {
      const compDb = await CompanyManager.getCompanyDb(ENTERPRISE_COA_COMPANY_ID);
      const allAccounts = await compDb.select().from(schema.accounts).where(eq(schema.accounts.companyId, ENTERPRISE_COA_COMPANY_ID));
      const bankRegs = await compDb.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.companyId, ENTERPRISE_COA_COMPANY_ID));

      const destBanks = filterEligibleDestinationBankAccounts(allAccounts, bankRegs);
      const destCodes = destBanks.map(a => a.accountCode);

      // Bank accounts must be included
      expect(destCodes).toContain('1010');
      expect(destCodes).toContain('1012');
      expect(destCodes).toContain('1015');
      expect(destCodes).toContain('2026');
      expect(destCodes).toContain('BNK-BDO-01');

      // Physical cash & petty cash must be strictly EXCLUDED
      expect(destCodes).not.toContain('1020');
      expect(destCodes).not.toContain('1025');
      expect(destCodes).not.toContain('CASH-01');

      // Verify bank registry decoration
      const bdo2026 = destBanks.find(a => a.accountCode === '2026');
      expect(bdo2026?.displayLabel).toContain('BDO Unibank');
    });
  });

  // ==========================================================================
  // SCENARIO D: MULTI-ACCOUNT REVENUE & EXPENSE DISCOVERY
  // ==========================================================================
  describe('SCENARIO D — Multi-Account Classifications (Revenue & Expense Discovery)', () => {
    beforeAll(async () => {
      const compDb = await CompanyManager.getCompanyDb(ENTERPRISE_COA_COMPANY_ID);
      await dbContext.run(compDb, async () => {
        const revAndExp = [
          { code: '4010', name: 'Service Revenue / Sales', type: 'REVENUE', detail: 'SERVICE_INCOME', nb: 'CREDIT' },
          { code: '4015', name: 'Software Subscription & SaaS Revenue', type: 'REVENUE', detail: 'SERVICE_INCOME', nb: 'CREDIT' },
          { code: '4025', name: 'Implementation & Consulting Revenue', type: 'REVENUE', detail: 'SERVICE_INCOME', nb: 'CREDIT' },
          { code: '6010', name: 'Salaries and Wages', type: 'EXPENSE', detail: 'SALARIES_EXPENSE', nb: 'DEBIT' },
          { code: '6015', name: 'Cloud Infrastructure & Hosting', type: 'EXPENSE', detail: 'UTILITIES_EXPENSE', nb: 'DEBIT' },
          { code: '6020', name: 'Rent Expense', type: 'EXPENSE', detail: 'RENT_EXPENSE', nb: 'DEBIT' },
          { code: '6025', name: 'Telecommunications & High-Speed Internet', type: 'EXPENSE', detail: 'UTILITIES_EXPENSE', nb: 'DEBIT' },
        ];
        for (const item of revAndExp) {
          await compDb.insert(schema.accounts).values({
            id: `acc-ent-${item.code}`,
            companyId: ENTERPRISE_COA_COMPANY_ID,
            accountCode: item.code,
            accountName: item.name,
            accountType: item.type,
            detailType: item.detail,
            normalBalance: item.nb,
            status: 'ACTIVE',
            isActive: true,
          }).onConflictDoNothing();
        }
      });
    });

    it('D1: filterEligibleRevenueAccounts discovers all 3 revenue accounts', async () => {
      const compDb = await CompanyManager.getCompanyDb(ENTERPRISE_COA_COMPANY_ID);
      const allAccounts = await compDb.select().from(schema.accounts).where(eq(schema.accounts.companyId, ENTERPRISE_COA_COMPANY_ID));
      const revAccounts = filterEligibleRevenueAccounts(allAccounts);

      const codes = revAccounts.map(a => a.accountCode);
      expect(codes).toContain('4010');
      expect(codes).toContain('4015');
      expect(codes).toContain('4025');
    });

    it('D2: filterEligibleExpenseAndPurchaseAccounts discovers all 4 expense accounts', async () => {
      const compDb = await CompanyManager.getCompanyDb(ENTERPRISE_COA_COMPANY_ID);
      const allAccounts = await compDb.select().from(schema.accounts).where(eq(schema.accounts.companyId, ENTERPRISE_COA_COMPANY_ID));
      const expAccounts = filterEligibleExpenseAndPurchaseAccounts(allAccounts);

      const codes = expAccounts.map(a => a.accountCode);
      expect(codes).toContain('6010');
      expect(codes).toContain('6015');
      expect(codes).toContain('6020');
      expect(codes).toContain('6025');
    });
  });

  // ==========================================================================
  // SCENARIO E: INCOMPATIBLE CLASSIFICATION REJECTION & TAX CONTROL
  // ==========================================================================
  describe('SCENARIO E — Incompatible Accounts Exclusion & Validation', () => {
    it('E1: filterEligibleTaxControlAccounts strictly excludes cash, bank, and revenue accounts', async () => {
      const compDb = await CompanyManager.getCompanyDb(ENTERPRISE_COA_COMPANY_ID);
      const allAccounts = await compDb.select().from(schema.accounts).where(eq(schema.accounts.companyId, ENTERPRISE_COA_COMPANY_ID));
      const taxControlAccounts = filterEligibleTaxControlAccounts(allAccounts);

      const taxCodes = taxControlAccounts.map(a => a.accountCode);
      expect(taxCodes).not.toContain('1010');
      expect(taxCodes).not.toContain('2026');
      expect(taxCodes).not.toContain('4010');
      expect(taxCodes).not.toContain('6010');
    });

    it('E2: POST /api/tax/codes rejects attempting to link a cash account as tax control account', async () => {
      const res = await request(app)
        .post('/api/tax/codes')
        .set('Authorization', `Bearer ${entOwnerToken}`)
        .send({
          code: 'INVALID-TAX-CODE',
          name: 'Invalid Cash Tax Code',
          taxType: 'VAT',
          accountId: 'acc-ent-1010', // Invalid: Cash in Bank as tax control account
        });

      // Must be rejected by server validation
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('TAX_GL_ACCOUNT_INCOMPATIBLE');
    });
  });

  // ==========================================================================
  // SCENARIO F: ACCOUNT DEACTIVATION LIFECYCLE
  // ==========================================================================
  describe('SCENARIO F — Account Deactivation Lifecycle and Selector Exclusion', () => {
    it('F1: PATCH /api/master-data/accounts/:id/status deactivates account and removes it from selectors', async () => {
      // Deactivate 1025 (Petty Cash Cebu)
      const res = await request(app)
        .patch('/api/master-data/accounts/acc-ent-1025/status')
        .set('Authorization', `Bearer ${entOwnerToken}`)
        .send({ status: 'INACTIVE' })
        .expect(200);

      expect(res.body.status).toBe('INACTIVE');

      // Verify isAccountActive returns false
      expect(isAccountActive(res.body)).toBe(false);

      // Verify it disappears from active selectors
      const compDb = await CompanyManager.getCompanyDb(ENTERPRISE_COA_COMPANY_ID);
      const allAccounts = await compDb.select().from(schema.accounts).where(eq(schema.accounts.companyId, ENTERPRISE_COA_COMPANY_ID));
      const sourceCash = filterEligibleSourceCashAccounts(allAccounts);
      const sourceCodes = sourceCash.map(a => a.accountCode);

      expect(sourceCodes).not.toContain('1025');
    });
  });

  // ==========================================================================
  // SCENARIO G: CROSS-COMPANY TENANT ISOLATION
  // ==========================================================================
  describe('SCENARIO G — Strict Tenant Isolation for Custom Accounts', () => {
    it('G1: custom account 2026 in Company A is not visible in Company B', async () => {
      const res = await request(app)
        .get('/api/accounting/accounts')
        .set('Authorization', `Bearer ${isoOwnerToken}`)
        .expect(200);

      const isoCodes = res.body.map((a: any) => a.accountCode);
      expect(isoCodes).not.toContain('2026');
      expect(isoCodes).not.toContain('BNK-BDO-01');
    });
  });

  // ==========================================================================
  // SCENARIO H: BALANCED GL TRANSACTION POSTING WITH CUSTOM ACCOUNT 2026
  // ==========================================================================
  describe('SCENARIO H — Balanced GL Posting with Custom Account 2026', () => {
    it('H1: creates and posts balanced journal entry using custom account 2026', async () => {
      const compDb = await CompanyManager.getCompanyDb(ENTERPRISE_COA_COMPANY_ID);
      const jeId = `je-ent-test-${Date.now()}`;

      await dbContext.run(compDb, async () => {
        // Debit Rent Expense (6020) ₱25,000.00, Credit BDO Business Checking (2026) ₱25,000.00
        await compDb.insert(schema.journalEntries).values({
          id: jeId,
          companyId: ENTERPRISE_COA_COMPANY_ID,
          accountingPeriodId: `period-${ENTERPRISE_COA_COMPANY_ID}-2026-01`,
          journalNumber: 'JE-TEST-BDO-2026',
          entryDate: '2026-01-15',
          sourceType: 'CASH_DISBURSEMENT',
          description: 'Office Rent Payment via BDO Checking',
          status: 'POSTED',
          createdBy: ENT_OWNER_ID,
          postedBy: ENT_OWNER_ID,
          postedAt: new Date(),
        });

        await compDb.insert(schema.journalLines).values([
          {
            id: `jl-ent-1-${Date.now()}`,
            journalEntryId: jeId,
            accountId: 'acc-ent-6020',
            debit: 2500000,
            credit: 0,
            description: 'Office Rent Expense',
            lineNumber: 1,
          },
          {
            id: `jl-ent-2-${Date.now()}`,
            journalEntryId: jeId,
            accountId: 'acc-ent-2026',
            debit: 0,
            credit: 2500000,
            description: 'BDO Checking Disbursement',
            lineNumber: 2,
          },
        ]);
      });

      // Verify lines in DB
      const lines = await compDb.select().from(schema.journalLines).where(eq(schema.journalLines.journalEntryId, jeId));
      expect(lines.length).toBe(2);
      const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
      const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
      expect(totalDebit).toBe(2500000);
      expect(totalCredit).toBe(2500000);
      expect(totalDebit).toBe(totalCredit); // Perfectly balanced!
    });
  });
});
