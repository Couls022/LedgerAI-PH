import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import { CompanyManager } from '../../src/server/services/companyManager';
import {
  createCashTransaction,
  submitCashTransaction,
  approveCashTransaction,
  postCashTransaction,
  issueCheck,
  clearCheck,
  cancelCheck,
  bounceCheck,
  createBankDeposit,
  submitBankDeposit,
  approveBankDeposit,
  postBankDeposit,
  getCashbook,
  createBankReconciliation,
  addManualBankStatementLine,
  addReconciliationAdjustment,
  autoMatchBankReconciliation,
  submitBankReconciliation,
  approveBankReconciliation,
  reopenBankReconciliation,
  getBankReconciliationSummary,
  ensureReconciledBankSeedData,
  resolveCompanyControlAccount,
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
  PREVIEW_COMPANY_ID,
} from '../../src/server/scripts/seedDeskguardStressPreview';

describe('Module 5: Cash & Banking and Bank Reconciliation E2E Verification', () => {
  const TEST_COMPANY_ID = 'LGR-PH-2026-TEST-CASH-BANK-E2E';
  const MAKER_ID = 'usr-cb-maker';
  const APPROVER_ID = 'usr-cb-approver';
  let cashAccId = '';
  let bankAccId = '';
  let revAccId = '';
  let expAccId = '';
  let periodId = '';
  let companyDb: any;
  let companySqlite: any;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(TEST_COMPANY_ID);

    await CompanyManager.createCompanyProfile(
      TEST_COMPANY_ID,
      'Cash & Banking E2E Test Corp.',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    companyDb = await CompanyManager.getCompanyDb(TEST_COMPANY_ID);
    companySqlite = await CompanyManager.getCompanySqlite(TEST_COMPANY_ID);

    companySqlite.prepare('DELETE FROM accounting_periods WHERE company_id = ?').run(TEST_COMPANY_ID);
    companySqlite.prepare('DELETE FROM accounts WHERE company_id = ?').run(TEST_COMPANY_ID);

    await dbContext.run(companyDb, async () => {
      await db.insert(schema.users).values([
        { id: MAKER_ID, email: 'maker@cbtest.ph', passwordHash: 'hash', displayName: 'Treasury Maker', role: 'editor' },
        { id: APPROVER_ID, email: 'approver@cbtest.ph', passwordHash: 'hash', displayName: 'Treasury Approver', role: 'admin' },
      ]).onConflictDoNothing();

      periodId = 'per-cb-2026-11';
      await db.insert(schema.accountingPeriods).values({
        id: periodId,
        companyId: TEST_COMPANY_ID,
        name: '2026-11',
        fiscalYear: 2026,
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        status: 'OPEN',
      }).onConflictDoNothing();

      cashAccId = 'acc-cb-1010';
      bankAccId = 'acc-cb-1020';
      revAccId = 'acc-cb-4010';
      expAccId = 'acc-cb-5100';

      await db.insert(schema.accounts).values([
        {
          id: cashAccId,
          companyId: TEST_COMPANY_ID,
          accountCode: '1010',
          accountName: 'Cash on Hand & Undeposited Collections',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isControlAccount: 1,
          isCashAccount: 1,
          status: 'ACTIVE',
        },
        {
          id: bankAccId,
          companyId: TEST_COMPANY_ID,
          accountCode: '1020',
          accountName: 'Cash in Bank — BPI Operating',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isControlAccount: 1,
          isCashAccount: 1,
          status: 'ACTIVE',
        },
        {
          id: revAccId,
          companyId: TEST_COMPANY_ID,
          accountCode: '4010',
          accountName: 'Service Revenue',
          accountType: 'REVENUE',
          normalBalance: 'CREDIT',
          isControlAccount: 0,
          isCashAccount: 0,
          status: 'ACTIVE',
        },
        {
          id: expAccId,
          companyId: TEST_COMPANY_ID,
          accountCode: '5100',
          accountName: 'Bank & Treasury Expense',
          accountType: 'EXPENSE',
          normalBalance: 'DEBIT',
          isControlAccount: 0,
          isCashAccount: 0,
          status: 'ACTIVE',
        },
      ]).onConflictDoNothing();
    });
  });

  afterAll(async () => {
    await CompanyManager.resetDisposableTestCompanyWorkspace(TEST_COMPANY_ID);
  });

  it('1. executes full Cash Transaction (RECEIPT & DISBURSEMENT) lifecycle with Maker-Checker SoD and GL posting', async () => {
    await dbContext.run(companyDb, async () => {
      const receiptId = await createCashTransaction(
        TEST_COMPANY_ID,
        {
          accountId: bankAccId,
          type: 'RECEIPT',
          amount: 2500000,
          transactionDate: '2026-11-05',
          reference: 'OR-CB-001',
          description: 'Customer walk-in cash receipt',
        },
        MAKER_ID,
        'Bookkeeper'
      );

      await submitCashTransaction(TEST_COMPANY_ID, receiptId, MAKER_ID);

      // Maker cannot self-approve
      await expect(approveCashTransaction(TEST_COMPANY_ID, receiptId, MAKER_ID)).rejects.toThrow(
        /Segregation of Duties/i
      );

      await approveCashTransaction(TEST_COMPANY_ID, receiptId, APPROVER_ID);
      await postCashTransaction(TEST_COMPANY_ID, receiptId, periodId, [], APPROVER_ID, undefined, 'Company Owner');

      const postedReceipt = await db
        .select()
        .from(schema.cashTransactions)
        .where(eq(schema.cashTransactions.id, receiptId))
        .get();
      expect(postedReceipt?.status).toBe('POSTED');
      expect(postedReceipt?.journalEntryId).toBeTruthy();

      const jLines = await db
        .select()
        .from(schema.journalLines)
        .where(eq(schema.journalLines.journalEntryId, postedReceipt!.journalEntryId!));
      const sumDr = jLines.reduce((acc, l) => acc + l.debit, 0);
      const sumCr = jLines.reduce((acc, l) => acc + l.credit, 0);
      expect(sumDr).toBe(2500000);
      expect(sumCr).toBe(2500000);
    });
  });

  it('2. executes Check Register & Bank Deposit lifecycle and reconciles Cashbook 1:1 with GL', async () => {
    await dbContext.run(companyDb, async () => {
      const checkId = await issueCheck(
        TEST_COMPANY_ID,
        {
          checkNumber: '0000900101',
          checkDate: '2026-11-10',
          payeeName: 'Manila Office Supplies Inc.',
          cashAccountId: bankAccId,
          amount: 500000,
          voucherNumber: 'CV-CB-001',
          notes: 'Office supplies check payment',
        },
        MAKER_ID
      );

      const depId = await createBankDeposit(
        TEST_COMPANY_ID,
        {
          depositNumber: 'DEP-CB-001',
          depositDate: '2026-11-12',
          toBankAccountId: bankAccId,
          fromCashAccountId: cashAccId,
          totalAmount: 1000000,
          reference: 'BPI-SLIP-001',
          notes: 'Deposit of collections',
        },
        MAKER_ID,
        'Bookkeeper'
      );

      await submitBankDeposit(TEST_COMPANY_ID, depId, MAKER_ID);
      await approveBankDeposit(TEST_COMPANY_ID, depId, APPROVER_ID);
      await postBankDeposit(TEST_COMPANY_ID, depId, periodId, APPROVER_ID, 'Company Owner');

      const cashbook = await getCashbook(TEST_COMPANY_ID, bankAccId, '2026-11-01', '2026-11-30');
      expect(cashbook.closingBalance).toBe(3500000);
      expect(cashbook.glLedgerBalance).toBe(3500000);
      expect(cashbook.isReconciled).toBe(true);
      expect(cashbook.transactions.length).toBeGreaterThanOrEqual(2);

      await clearCheck(TEST_COMPANY_ID, checkId, '2026-11-15', APPROVER_ID);
      const clearedChk = await db.select().from(schema.checks).where(eq(schema.checks.id, checkId)).get();
      expect(clearedChk?.status).toBe('CLEARED');
    });
  });

  it('3. enforces Bank Reconciliation formula, auto-matching, zero-variance & evidence requirement on approval, and reopen', async () => {
    await dbContext.run(companyDb, async () => {
      await issueCheck(
        TEST_COMPANY_ID,
        {
          checkNumber: '0000900102',
          checkDate: '2026-11-28',
          payeeName: 'Unpresented Supplier Corp.',
          cashAccountId: bankAccId,
          amount: 400000,
          voucherNumber: 'CV-CB-002',
        },
        MAKER_ID
      );

      const reconId = await createBankReconciliation(
        TEST_COMPANY_ID,
        {
          bankAccountId: bankAccId,
          statementDate: '2026-11-30',
          statementEndingBalance: 3900000,
          notes: 'Nov 2026 Bank Reconciliation Test',
        },
        MAKER_ID
      );

      await addManualBankStatementLine(
        TEST_COMPANY_ID,
        reconId,
        {
          lineDate: '2026-11-05',
          description: 'Customer walk-in cash receipt',
          reference: 'OR-CB-001',
          type: 'DEPOSIT',
          amount: 2500000,
        },
        MAKER_ID
      );
      await addManualBankStatementLine(
        TEST_COMPANY_ID,
        reconId,
        {
          lineDate: '2026-11-12',
          description: 'Bank deposit batch',
          reference: 'BPI-SLIP-001',
          type: 'DEPOSIT',
          amount: 1000000,
        },
        MAKER_ID
      );

      await autoMatchBankReconciliation(TEST_COMPANY_ID, reconId, MAKER_ID);

      const summary = await getBankReconciliationSummary(TEST_COMPANY_ID, reconId);
      expect(summary.reconciliation.bookEndingBalance).toBe(3500000);
      expect(summary.reconciliation.depositsInTransitAmount).toBe(0);
      expect(summary.reconciliation.outstandingChecksAmount).toBe(400000);
      expect(summary.reconciliation.adjustedStatementBalance).toBe(3500000);
      expect(summary.reconciliation.unexplainedDifference).toBe(0);

      await submitBankReconciliation(TEST_COMPANY_ID, reconId, MAKER_ID);
      await approveBankReconciliation(TEST_COMPANY_ID, reconId, periodId, APPROVER_ID);

      const approvedSummary = await getBankReconciliationSummary(TEST_COMPANY_ID, reconId);
      expect(approvedSummary.reconciliation.status).toBe('APPROVED');

      await reopenBankReconciliation(TEST_COMPANY_ID, reconId, 'Audit verification reopen test', APPROVER_ID);
      const reopenedSummary = await getBankReconciliationSummary(TEST_COMPANY_ID, reconId);
      expect(reopenedSummary.reconciliation.status).toBe('REOPENED');
    });
  });

  it('4. verifies Deskguard Solutions — Stress Test Preview bank reconciliations reconcile 1:1 with ₱19,720,000.00 GL Cash Position', async () => {
    const existingPreview = await CompanyManager.getCompanyManifest(PREVIEW_COMPANY_ID);
    if (!existingPreview) {
      await CompanyManager.ensureStressPreviewSeeded({ forceExplicitDemo: true });
    }
    try {
      const previewDb = await CompanyManager.getCompanyDb(PREVIEW_COMPANY_ID);

      await dbContext.run(previewDb, async () => {
        await ensureReconciledBankSeedData(PREVIEW_COMPANY_ID);

      const recons = await db
        .select()
        .from(schema.bankReconciliations)
        .where(eq(schema.bankReconciliations.companyId, PREVIEW_COMPANY_ID));

      expect(recons.length).toBeGreaterThanOrEqual(12);

      const octRecon = recons.find((r) => r.id === 'brec-dg-2026-10');
      expect(octRecon).toBeDefined();
      expect(['APPROVED', 'POSTED']).toContain(octRecon!.status);
      expect(octRecon!.bookEndingBalance).toBe(1972000000);
      expect(octRecon!.statementEndingBalance).toBe(1972000000);
      expect(octRecon!.unexplainedDifference).toBe(0);

      const novSummary = await getBankReconciliationSummary(PREVIEW_COMPANY_ID, 'brec-dg-2026-11');
      expect(['SUBMITTED', 'POSTED']).toContain(novSummary.reconciliation.status);
      expect(novSummary.reconciliation.bookEndingBalance).toBe(1972000000);
      expect(novSummary.reconciliation.statementEndingBalance).toBe(1969150000);
      expect(novSummary.reconciliation.depositsInTransitCount).toBe(5);
      expect(novSummary.reconciliation.depositsInTransitAmount).toBe(5600000);
      expect(novSummary.reconciliation.outstandingChecksCount).toBe(5);
      expect(novSummary.reconciliation.outstandingChecksAmount).toBe(2750000);
      expect(novSummary.reconciliation.adjustedStatementBalance).toBe(1972000000);
      expect(novSummary.reconciliation.unexplainedDifference).toBe(0);
      expect(novSummary.statementLines.length).toBeGreaterThan(0);

      const [cntCashTx] = await db.select({ c: sql<number>`count(*)` }).from(schema.cashTransactions);
      const [cntChecks] = await db.select({ c: sql<number>`count(*)` }).from(schema.checks);
      const [cntDeposits] = await db.select({ c: sql<number>`count(*)` }).from(schema.bankDeposits);
      expect(Number(cntCashTx.c)).toBe(500);
      expect(Number(cntChecks.c)).toBe(100);
      expect(Number(cntDeposits.c)).toBe(100);
      });
    } finally {
      if (!existingPreview) {
        await CompanyManager.resetDisposableTestCompanyWorkspace(PREVIEW_COMPANY_ID);
      }
    }
  }, 90000);

  it('5. executes complete Check Lifecycle (ISSUED -> BOUNCED & CANCELLED with GL reversals) and excludes them from Outstanding Checks, plus Book Adjustments GL auto-posting', async () => {
    await dbContext.run(companyDb, async () => {
      // Create & post a cash disbursement tied to a check that will be voided/cancelled
      const disbId1 = await createCashTransaction(
        TEST_COMPANY_ID,
        {
          accountId: bankAccId,
          type: 'DISBURSEMENT',
          amount: 150000,
          transactionDate: '2026-11-20',
          reference: 'CV-VOID-001',
          description: 'Supplier check payment to be voided',
        },
        MAKER_ID,
        'Bookkeeper'
      );
      await submitCashTransaction(TEST_COMPANY_ID, disbId1, MAKER_ID);
      await approveCashTransaction(TEST_COMPANY_ID, disbId1, APPROVER_ID);
      await postCashTransaction(TEST_COMPANY_ID, disbId1, periodId, [], APPROVER_ID, undefined, 'Company Owner');
      const postedDisb1 = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.id, disbId1)).get();

      const voidCheckId = await issueCheck(
        TEST_COMPANY_ID,
        {
          checkNumber: '0000900103',
          checkDate: '2026-11-20',
          payeeName: 'Voided Payee Inc.',
          cashAccountId: bankAccId,
          amount: 150000,
          voucherNumber: 'CV-VOID-001',
          journalEntryId: postedDisb1!.journalEntryId!,
        },
        MAKER_ID
      );

      // Create & post a cash disbursement tied to a check that will bounce (NSF)
      const disbId2 = await createCashTransaction(
        TEST_COMPANY_ID,
        {
          accountId: bankAccId,
          type: 'DISBURSEMENT',
          amount: 200000,
          transactionDate: '2026-11-21',
          reference: 'CV-NSF-001',
          description: 'Check payment returned DAIF/NSF',
        },
        MAKER_ID,
        'Bookkeeper'
      );
      await submitCashTransaction(TEST_COMPANY_ID, disbId2, MAKER_ID);
      await approveCashTransaction(TEST_COMPANY_ID, disbId2, APPROVER_ID);
      await postCashTransaction(TEST_COMPANY_ID, disbId2, periodId, [], APPROVER_ID, undefined, 'Company Owner');
      const postedDisb2 = await db.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.id, disbId2)).get();

      const bounceCheckId = await issueCheck(
        TEST_COMPANY_ID,
        {
          checkNumber: '0000900104',
          checkDate: '2026-11-21',
          payeeName: 'Returned Payee Corp.',
          cashAccountId: bankAccId,
          amount: 200000,
          voucherNumber: 'CV-NSF-001',
          journalEntryId: postedDisb2!.journalEntryId!,
        },
        MAKER_ID
      );

      // Cancel/Void Check #103 and Bounce Check #104 with GL reversals
      await cancelCheck(TEST_COMPANY_ID, voidCheckId, 'Spoiled check leaf replaced', periodId, APPROVER_ID, 'Company Owner');
      await bounceCheck(TEST_COMPANY_ID, bounceCheckId, 'Returned DAIF by drawee bank', periodId, APPROVER_ID, 'Company Owner');

      const voidedRow = await db.select().from(schema.checks).where(eq(schema.checks.id, voidCheckId)).get();
      const bouncedRow = await db.select().from(schema.checks).where(eq(schema.checks.id, bounceCheckId)).get();
      expect(voidedRow?.status).toBe('CANCELLED');
      expect(bouncedRow?.status).toBe('BOUNCED');

      // Because both disbursements were reversed in GL, bankAccId GL balance remains 3,500,000 centavos!
      // And neither CANCELLED nor BOUNCED check may appear in Outstanding Checks (still only Check #102 = 400,000)
      const recon2Id = await createBankReconciliation(
        TEST_COMPANY_ID,
        {
          bankAccountId: bankAccId,
          statementDate: '2026-11-29',
          statementEndingBalance: 3895000, // 3,900,000 - 5,000 bank charge
          notes: 'Recon with Book Adjustment & Excluded Void/Bounced Checks',
        },
        MAKER_ID
      );

      await addManualBankStatementLine(
        TEST_COMPANY_ID,
        recon2Id,
        { lineDate: '2026-11-05', description: 'Walk-in receipt', reference: 'OR-CB-001', type: 'DEPOSIT', amount: 2500000 },
        MAKER_ID
      );
      await addManualBankStatementLine(
        TEST_COMPANY_ID,
        recon2Id,
        { lineDate: '2026-11-12', description: 'Deposit batch', reference: 'BPI-SLIP-001', type: 'DEPOSIT', amount: 1000000 },
        MAKER_ID
      );
      await autoMatchBankReconciliation(TEST_COMPANY_ID, recon2Id, MAKER_ID);

      // Add a 5,000 centavo (₱50.00) BANK_CHARGE book adjustment
      await addReconciliationAdjustment(
        TEST_COMPANY_ID,
        recon2Id,
        {
          type: 'BANK_CHARGE',
          description: 'BPI checkbook & service charge',
          amount: 5000,
          offsetAccountId: expAccId,
        },
        MAKER_ID
      );

      const summaryBeforeApprove = await getBankReconciliationSummary(TEST_COMPANY_ID, recon2Id);
      expect(summaryBeforeApprove.reconciliation.outstandingChecksAmount).toBe(400000);
      expect(summaryBeforeApprove.reconciliation.bookEndingBalance).toBe(3500000);
      expect(summaryBeforeApprove.reconciliation.adjustedBookBalance).toBe(3495000);
      expect(summaryBeforeApprove.reconciliation.adjustedStatementBalance).toBe(3495000);
      expect(summaryBeforeApprove.reconciliation.unexplainedDifference).toBe(0);

      await submitBankReconciliation(TEST_COMPANY_ID, recon2Id, MAKER_ID);
      await approveBankReconciliation(TEST_COMPANY_ID, recon2Id, periodId, APPROVER_ID);

      const summaryAfterApprove = await getBankReconciliationSummary(TEST_COMPANY_ID, recon2Id);
      expect(summaryAfterApprove.reconciliation.status).toBe('APPROVED');
      expect(summaryAfterApprove.reconciliation.journalEntryId).toBeTruthy();
    });
  });

  it('6. reconciles COA account mappings across alternate company numbering (1100 Cash, 1110 AR, 2110 AP, 2120 Output VAT, 1150 Input VAT) while rejecting parent headers (1000, 2000, 4000, 6000)', async () => {
    const ALT_COMPANY_ID = 'LGR-PH-2026-TEST-ALT-COA';
    await CompanyManager.resetDisposableTestCompanyWorkspace(ALT_COMPANY_ID);

    try {
      await CompanyManager.createCompanyProfile(
        ALT_COMPANY_ID,
        'Alternate COA Mapping Enterprise Corp.',
        undefined,
        undefined,
        false,
        { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
      );

      const altDb = await CompanyManager.getCompanyDb(ALT_COMPANY_ID);
      const altSqlite = await CompanyManager.getCompanySqlite(ALT_COMPANY_ID);
      altSqlite.prepare('DELETE FROM accounting_periods WHERE company_id = ?').run(ALT_COMPANY_ID);
      altSqlite.prepare('DELETE FROM accounts WHERE company_id = ?').run(ALT_COMPANY_ID);

      await dbContext.run(altDb, async () => {
        await db.insert(schema.users).values([
          { id: MAKER_ID, email: 'maker@altcoa.ph', passwordHash: 'hash', displayName: 'Alt Maker', role: 'editor' },
          { id: APPROVER_ID, email: 'approver@altcoa.ph', passwordHash: 'hash', displayName: 'Alt Approver', role: 'admin' },
        ]).onConflictDoNothing();

        const altPeriodId = 'per-alt-2026-11';
        await db.insert(schema.accountingPeriods).values({
          id: altPeriodId,
          companyId: ALT_COMPANY_ID,
          name: '2026-11',
          fiscalYear: 2026,
          startDate: '2026-11-01',
          endDate: '2026-11-30',
          status: 'OPEN',
        });

        // Insert parent header accounts (1000, 2000, 4000, 6000) and alternate leaf accounts (1100, 1110, 1150, 2110, 2120, 4100, 6100)
        await db.insert(schema.accounts).values([
          { id: 'alt-hdr-1000', companyId: ALT_COMPANY_ID, accountCode: '1000', accountName: 'Assets Header', accountType: 'ASSET', normalBalance: 'DEBIT', isControlAccount: 0, isCashAccount: 0, status: 'ACTIVE' },
          { id: 'alt-hdr-2000', companyId: ALT_COMPANY_ID, accountCode: '2000', accountName: 'Liabilities Header', accountType: 'LIABILITY', normalBalance: 'CREDIT', isControlAccount: 0, isCashAccount: 0, status: 'ACTIVE' },
          { id: 'alt-hdr-4000', companyId: ALT_COMPANY_ID, accountCode: '4000', accountName: 'Revenue Header', accountType: 'REVENUE', normalBalance: 'CREDIT', isControlAccount: 0, isCashAccount: 0, status: 'ACTIVE' },
          { id: 'alt-hdr-6000', companyId: ALT_COMPANY_ID, accountCode: '6000', accountName: 'Expenses Header', accountType: 'EXPENSE', normalBalance: 'DEBIT', isControlAccount: 0, isCashAccount: 0, status: 'ACTIVE' },
          { id: 'alt-cash-1100', companyId: ALT_COMPANY_ID, accountCode: '1100', accountName: 'Cash in Bank - Metrobank', accountType: 'ASSET', detailType: 'CASH', normalBalance: 'DEBIT', parentAccountId: 'alt-hdr-1000', isControlAccount: 1, isCashAccount: 1, status: 'ACTIVE' },
          { id: 'alt-ar-1110', companyId: ALT_COMPANY_ID, accountCode: '1110', accountName: 'Trade Accounts Receivable', accountType: 'ASSET', detailType: 'RECEIVABLE', normalBalance: 'DEBIT', parentAccountId: 'alt-hdr-1000', isControlAccount: 1, isCashAccount: 0, status: 'ACTIVE' },
          { id: 'alt-invat-1150', companyId: ALT_COMPANY_ID, accountCode: '1150', accountName: 'Input VAT Deferred & Current', accountType: 'ASSET', normalBalance: 'DEBIT', parentAccountId: 'alt-hdr-1000', isControlAccount: 0, isCashAccount: 0, isTaxAccount: 1, status: 'ACTIVE' },
          { id: 'alt-ap-2110', companyId: ALT_COMPANY_ID, accountCode: '2110', accountName: 'Trade Accounts Payable', accountType: 'LIABILITY', detailType: 'PAYABLE', normalBalance: 'CREDIT', parentAccountId: 'alt-hdr-2000', isControlAccount: 1, isCashAccount: 0, status: 'ACTIVE' },
          { id: 'alt-outvat-2120', companyId: ALT_COMPANY_ID, accountCode: '2120', accountName: 'Output VAT Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', parentAccountId: 'alt-hdr-2000', isControlAccount: 0, isCashAccount: 0, isTaxAccount: 1, status: 'ACTIVE' },
          { id: 'alt-rev-4100', companyId: ALT_COMPANY_ID, accountCode: '4100', accountName: 'Commercial Consulting Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', parentAccountId: 'alt-hdr-4000', isControlAccount: 0, isCashAccount: 0, status: 'ACTIVE' },
          { id: 'alt-exp-6100', companyId: ALT_COMPANY_ID, accountCode: '6100', accountName: 'Subcontractor & Operations Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', parentAccountId: 'alt-hdr-6000', isControlAccount: 0, isCashAccount: 0, status: 'ACTIVE' },
        ]);

        // Verify resolveCompanyControlAccount picks active leaf accounts and never parent headers
        const resolvedCash = await resolveCompanyControlAccount(db, ALT_COMPANY_ID, 'CASH');
        const resolvedAr = await resolveCompanyControlAccount(db, ALT_COMPANY_ID, 'AR');
        const resolvedAp = await resolveCompanyControlAccount(db, ALT_COMPANY_ID, 'AP');
        const resolvedOutVat = await resolveCompanyControlAccount(db, ALT_COMPANY_ID, 'OUTPUT_VAT');
        const resolvedInVat = await resolveCompanyControlAccount(db, ALT_COMPANY_ID, 'INPUT_VAT');
        const resolvedRev = await resolveCompanyControlAccount(db, ALT_COMPANY_ID, 'REVENUE', 'alt-hdr-4000');
        const resolvedExp = await resolveCompanyControlAccount(db, ALT_COMPANY_ID, 'EXPENSE', 'alt-hdr-6000');

        expect(resolvedCash.id).toBe('alt-cash-1100');
        expect(resolvedAr.id).toBe('alt-ar-1110');
        expect(resolvedAp.id).toBe('alt-ap-2110');
        expect(resolvedOutVat.id).toBe('alt-outvat-2120');
        expect(resolvedInVat.id).toBe('alt-invat-1150');
        expect(resolvedRev.id).toBe('alt-rev-4100');
        expect(resolvedExp.id).toBe('alt-exp-6100');

        // Insert customer & vendor
        await db.insert(schema.customers).values({
          id: 'cust-alt-1',
          companyId: ALT_COMPANY_ID,
          code: 'CUST-ALT-01',
          legalName: 'Ayala Commercial Client Corp.',
          tin: '001-222-333-000',
        });
        await db.insert(schema.vendors).values({
          id: 'vend-alt-1',
          companyId: ALT_COMPANY_ID,
          code: 'VEND-ALT-01',
          legalName: 'Makati Cloud Infrastructure Inc.',
          tin: '004-555-666-000',
        });

        // Post Sales Invoice (₱100,000) and Partial Collection (₱40,000)
        const siId = await createSalesInvoice(
          ALT_COMPANY_ID,
          {
            invoiceNumber: 'SI-ALT-001',
            customerId: 'cust-alt-1',
            invoiceDate: '2026-11-05',
            dueDate: '2026-11-30',
            totalAmount: 10000000,
            lines: [{ description: 'Enterprise Retainer', quantity: 1, unitPrice: 10000000, amount: 10000000, accountId: 'alt-hdr-4000' }],
          },
          MAKER_ID,
          'Bookkeeper'
        );
        await submitSalesInvoice(ALT_COMPANY_ID, siId, MAKER_ID);
        await approveSalesInvoice(ALT_COMPANY_ID, siId, APPROVER_ID);
        await postSalesInvoice(ALT_COMPANY_ID, siId, altPeriodId, [], APPROVER_ID, 'Company Owner');

        const cpId = await createCustomerPayment(
          ALT_COMPANY_ID,
          {
            paymentNumber: 'OR-ALT-001',
            customerId: 'cust-alt-1',
            paymentDate: '2026-11-10',
            cashAccountId: 'alt-hdr-1000', // Even if parent header passed, resolves to alt-cash-1100
            amount: 4000000,
            paymentMethod: 'BANK_TRANSFER',
            applications: [{ invoiceId: siId, appliedAmount: 4000000 }],
          },
          MAKER_ID,
          'Bookkeeper'
        );
        await submitCustomerPayment(ALT_COMPANY_ID, cpId, MAKER_ID);
        await approveCustomerPayment(ALT_COMPANY_ID, cpId, APPROVER_ID);
        await postCustomerPayment(ALT_COMPANY_ID, cpId, altPeriodId, APPROVER_ID, undefined, 'Company Owner');

        // Post Purchase Bill (₱50,000) and Partial Supplier Payment (₱20,000)
        const pbId = await createPurchaseBill(
          ALT_COMPANY_ID,
          {
            billNumber: 'PB-ALT-001',
            vendorId: 'vend-alt-1',
            billDate: '2026-11-06',
            dueDate: '2026-11-30',
            totalAmount: 5000000,
            lines: [{ description: 'Cloud Hosting', quantity: 1, unitPrice: 5000000, amount: 5000000, accountId: 'alt-exp-6100' }],
          },
          MAKER_ID,
          'Bookkeeper'
        );
        await submitPurchaseBill(ALT_COMPANY_ID, pbId, MAKER_ID);
        await approvePurchaseBill(ALT_COMPANY_ID, pbId, APPROVER_ID);
        await postPurchaseBill(ALT_COMPANY_ID, pbId, altPeriodId, [], APPROVER_ID, 'Company Owner');

        const spId = await createSupplierPayment(
          ALT_COMPANY_ID,
          {
            paymentNumber: 'CV-ALT-001',
            vendorId: 'vend-alt-1',
            paymentDate: '2026-11-12',
            cashAccountId: 'alt-cash-1100',
            amount: 2000000,
            paymentMethod: 'BANK_TRANSFER',
            applications: [{ billId: pbId, appliedAmount: 2000000 }],
          },
          MAKER_ID,
          'Bookkeeper'
        );
        await submitSupplierPayment(ALT_COMPANY_ID, spId, MAKER_ID);
        await approveSupplierPayment(ALT_COMPANY_ID, spId, APPROVER_ID);
        await postSupplierPayment(ALT_COMPANY_ID, spId, altPeriodId, APPROVER_ID, undefined, 'Company Owner');

        // Verify GL postings landed on 1110 (AR = 6,000,000), 2110 (AP = 3,000,000), 1100 (Cash = 2,000,000), 4100 (Revenue = 10,000,000), 6100 (Expense = 5,000,000) and 0 on parent headers!
        const glRows = altSqlite.prepare(`
          SELECT jl.account_id as accountId, SUM(jl.debit) as dr, SUM(jl.credit) as cr
          FROM journal_lines jl
          JOIN journal_entries je ON jl.journal_entry_id = je.id
          WHERE je.company_id = ? AND je.status = 'POSTED'
          GROUP BY jl.account_id
        `).all(ALT_COMPANY_ID) as { accountId: string; dr: number; cr: number }[];

        const balMap = new Map(glRows.map((r) => [r.accountId, { dr: Number(r.dr || 0), cr: Number(r.cr || 0) }]));
        expect((balMap.get('alt-ar-1110')?.dr || 0) - (balMap.get('alt-ar-1110')?.cr || 0)).toBe(6000000);
        expect((balMap.get('alt-ap-2110')?.cr || 0) - (balMap.get('alt-ap-2110')?.dr || 0)).toBe(3000000);
        expect((balMap.get('alt-cash-1100')?.dr || 0) - (balMap.get('alt-cash-1100')?.cr || 0)).toBe(2000000);
        expect((balMap.get('alt-rev-4100')?.cr || 0) - (balMap.get('alt-rev-4100')?.dr || 0)).toBe(10000000);
        expect((balMap.get('alt-exp-6100')?.dr || 0) - (balMap.get('alt-exp-6100')?.cr || 0)).toBe(5000000);
        expect(balMap.has('alt-hdr-1000')).toBe(false);
        expect(balMap.has('alt-hdr-2000')).toBe(false);
        expect(balMap.has('alt-hdr-4000')).toBe(false);
        expect(balMap.has('alt-hdr-6000')).toBe(false);
      });
    } finally {
      await CompanyManager.resetDisposableTestCompanyWorkspace(ALT_COMPANY_ID);
    }
  });
});


