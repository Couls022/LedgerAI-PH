import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { CompanyManager } from '../../src/server/services/companyManager';
import {
  ArchiveRetentionService,
  ArchiveRetentionScheduler,
  ARCHIVE_ENTITY_REGISTRY,
} from '../../src/server/services/archiveRetentionService';
import { AutomatedBackupScheduler } from '../../src/server/services/automatedBackupScheduler';
import { isAccountActive, filterEligibleCashBankAccounts } from '../../src/shared/coaAccountUtils';

describe('Enterprise 6-State Record Lifecycle, Dedicated Archive Inboxes & 30-Day Backend Retention Scheduler', () => {
  const COMPANY_A = 'LGR-PH-2026-TEST-ARCHIVE-RET-A';
  const COMPANY_B = 'LGR-PH-2026-TEST-ARCHIVE-RET-B';
  const USER_ID = 'usr-archive-owner';

  let dbA: any;
  let dbB: any;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMPANY_A);
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMPANY_B);

    await CompanyManager.createCompanyProfile(
      COMPANY_A,
      'Archive Retention Test Corp A',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );
    await CompanyManager.createCompanyProfile(
      COMPANY_B,
      'Archive Retention Test Corp B',
      undefined,
      undefined,
      false,
      { classification: 'TEST', encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE' }
    );

    dbA = await CompanyManager.getCompanyDb(COMPANY_A);
    dbB = await CompanyManager.getCompanyDb(COMPANY_B);

    await dbContext.run(dbA, async () => {
      await db.insert(schema.users).values({
        id: USER_ID,
        email: 'owner@archivetest.ph',
        passwordHash: 'hashed-test-pw',
        displayName: 'Archive Test Owner',
        role: 'admin',
      }).onConflictDoNothing();
    });
  }, 60000);

  afterAll(async () => {
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMPANY_A);
    await CompanyManager.resetDisposableTestCompanyWorkspace(COMPANY_B);
  });

  it('1. registers all 29 canonical archive-enabled entity types including ACCOUNT, AUDIT_ENGAGEMENT, TAX_CODE, and BANK_ACCOUNT', () => {
    const keys = Object.keys(ARCHIVE_ENTITY_REGISTRY);
    expect(keys.length).toBeGreaterThanOrEqual(29);
    for (const required of [
      'ACCOUNT',
      'CUSTOMER',
      'VENDOR',
      'SALES_INVOICE',
      'PURCHASE_BILL',
      'JOURNAL_ENTRY',
      'BANK_RECONCILIATION',
      'BANK_ACCOUNT',
      'TAX_CODE',
      'TAX_FILING',
      'AUDIT_ENGAGEMENT',
      'FIXED_ASSET',
      'INVENTORY_ITEM',
      'EMPLOYEE',
      'PAYROLL_RUN',
      'DOCUMENT',
    ]) {
      expect(ARCHIVE_ENTITY_REGISTRY[required]).toBeDefined();
    }
  });

  it('2. distinguishes all 6 lifecycle states on COA accounts and enforces selector eligibility + code-collision restore guard', async () => {
    await dbContext.run(dbA, async () => {
      const accActiveId = `acc-active-${crypto.randomUUID().slice(0, 6)}`;
      const accInactiveId = `acc-inactive-${crypto.randomUUID().slice(0, 6)}`;
      const accRemovedId = `acc-removed-${crypto.randomUUID().slice(0, 6)}`;
      const accSoftDelId = `acc-softdel-${crypto.randomUUID().slice(0, 6)}`;
      const accArchivedId = `acc-archived-${crypto.randomUUID().slice(0, 6)}`;

      await db.insert(schema.accounts).values([
        {
          id: accActiveId,
          companyId: COMPANY_A,
          accountCode: '1091',
          accountName: 'Custom UnionBank Operating',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isCashAccount: 1,
          status: 'ACTIVE',
        },
        {
          id: accInactiveId,
          companyId: COMPANY_A,
          accountCode: '1092',
          accountName: 'Dormant RCBC Savings',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isCashAccount: 1,
          status: 'INACTIVE',
        },
        {
          id: accRemovedId,
          companyId: COMPANY_A,
          accountCode: '1093',
          accountName: 'Removed From List Petty Cash',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isCashAccount: 1,
          status: 'REMOVED',
        },
        {
          id: accSoftDelId,
          companyId: COMPANY_A,
          accountCode: '1094',
          accountName: 'Soft Deleted Temporary Clearing',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isCashAccount: 1,
          status: 'SOFT_DELETED',
        },
        {
          id: accArchivedId,
          companyId: COMPANY_A,
          accountCode: '1095',
          accountName: 'Archived Legacy Cash Drawer',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
          isCashAccount: 1,
          status: 'ARCHIVED',
        },
      ]);

      const allAccs = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, COMPANY_A)).all();
      const eligibleCash = filterEligibleCashBankAccounts(allAccs);
      const eligibleIds = new Set(eligibleCash.map((a: any) => a.id));

      const activeAccObj = allAccs.find((a: any) => a.id === accActiveId)!;
      expect(isAccountActive(activeAccObj)).toBe(true);
      expect(eligibleIds.has(accActiveId)).toBe(true);
      expect(eligibleIds.has(accInactiveId)).toBe(false);
      expect(eligibleIds.has(accRemovedId)).toBe(false);
      expect(eligibleIds.has(accSoftDelId)).toBe(false);
      expect(eligibleIds.has(accArchivedId)).toBe(false);

      // Module-scoped Archive Inbox returns ONLY ARCHIVED account (not INACTIVE/REMOVED/SOFT_DELETED)
      const { records } = await ArchiveRetentionService.listArchivedRecords(COMPANY_A, {
        entityTypes: ['ACCOUNT'],
      });
      const archivedIds = records.map((r) => r.id);
      expect(archivedIds).toContain(accArchivedId);
      expect(archivedIds).not.toContain(accRemovedId);
      expect(archivedIds).not.toContain(accSoftDelId);
      expect(archivedIds).not.toContain(accInactiveId);

      // Restore Archived account preserves original ID and returns it to ACTIVE
      const restored = await ArchiveRetentionService.restoreArchivedRecord(COMPANY_A, 'ACCOUNT', accArchivedId, {
        userId: USER_ID,
      });
      expect(restored.id).toBe(accArchivedId);
      expect(restored.restoredStatus).toBe('ACTIVE');

      // Verify restored account is immediately back in eligible Cash/Bank COA selectors
      const postRestoreAccs = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, COMPANY_A)).all();
      const postEligibleIds = new Set(filterEligibleCashBankAccounts(postRestoreAccs).map((a: any) => a.id));
      expect(postEligibleIds.has(accArchivedId)).toBe(true);
    });
  });

  it('3. executes non-mutating reads, blocks permanent delete of used COA/posted records, and runs idempotent 30-day retention sweep with tenant isolation', async () => {
    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    const usedAccountId = `acc-used-${crypto.randomUUID().slice(0, 6)}`;
    const unusedExpiredAccId = `acc-exp-unused-${crypto.randomUUID().slice(0, 6)}`;
    const unusedRecentAccId = `acc-rec-unused-${crypto.randomUUID().slice(0, 6)}`;
    const postedInvId = `inv-posted-${crypto.randomUUID().slice(0, 6)}`;
    const draftExpiredInvId = `inv-draft-exp-${crypto.randomUUID().slice(0, 6)}`;
    const taxCodeExpiredId = `tc-exp-${crypto.randomUUID().slice(0, 6)}`;
    const auditEngId = `eng-arch-${crypto.randomUUID().slice(0, 6)}`;
    const tenantBAccId = `acc-tenant-b-${crypto.randomUUID().slice(0, 6)}`;

    await dbContext.run(dbA, async () => {
      const custId = `cust-arch-${crypto.randomUUID().slice(0, 6)}`;
      const jeId = `je-used-${crypto.randomUUID().slice(0, 6)}`;
      const periodId = `per-arch-${crypto.randomUUID().slice(0, 6)}`;

      await db.insert(schema.accountingPeriods).values({
        id: periodId,
        companyId: COMPANY_A,
        name: '2026-10',
        fiscalYear: 2026,
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        status: 'OPEN',
      });

      await db.insert(schema.accounts).values([
        {
          id: usedAccountId,
          companyId: COMPANY_A,
          accountCode: '5901',
          accountName: 'Referenced Expense Account (Archived > 30d)',
          accountType: 'EXPENSE',
          normalBalance: 'DEBIT',
          status: 'ARCHIVED',
          updatedAt: oldDate,
        },
        {
          id: unusedExpiredAccId,
          companyId: COMPANY_A,
          accountCode: '5902',
          accountName: 'Unused Expired Account (Archived > 30d)',
          accountType: 'EXPENSE',
          normalBalance: 'DEBIT',
          status: 'ARCHIVED',
          updatedAt: oldDate,
        },
        {
          id: unusedRecentAccId,
          companyId: COMPANY_A,
          accountCode: '5903',
          accountName: 'Unused Recent Account (Archived 5d)',
          accountType: 'EXPENSE',
          normalBalance: 'DEBIT',
          status: 'ARCHIVED',
          updatedAt: recentDate,
        },
      ]);

      await db.insert(schema.journalEntries).values({
        id: jeId,
        companyId: COMPANY_A,
        accountingPeriodId: periodId,
        journalNumber: 'JE-ARCH-001',
        entryDate: '2026-10-15',
        description: 'Posted journal referencing archived account 5901',
        status: 'POSTED',
        createdBy: USER_ID,
      });

      await db.insert(schema.journalLines).values([
        { id: crypto.randomUUID(), journalEntryId: jeId, lineNumber: 1, accountId: usedAccountId, debit: 10000, credit: 0 },
        { id: crypto.randomUUID(), journalEntryId: jeId, lineNumber: 2, accountId: usedAccountId, debit: 0, credit: 10000 },
      ]);

      await db.insert(schema.customers).values({
        id: custId,
        companyId: COMPANY_A,
        code: 'CUST-ARCH-1',
        legalName: 'Archival Test Customer Inc.',
        status: 'ACTIVE',
      });

      // Posted invoice archived > 30 days ago (MUST BE EXEMPT under BIR 10-year retention)
      await db.insert(schema.salesInvoices).values({
        id: postedInvId,
        companyId: COMPANY_A,
        customerId: custId,
        invoiceNumber: 'SI-ARCH-POSTED-01',
        invoiceDate: '2026-10-10',
        dueDate: '2026-11-10',
        subtotal: 50000,
        taxAmount: 6000,
        totalAmount: 56000,
        balanceDue: 56000,
        status: 'ARCHIVED',
        journalEntryId: jeId,
        updatedAt: oldDate,
      });

      // Unposted draft invoice archived > 30 days ago (ELIGIBLE FOR AUTO-PURGE including child line)
      await db.insert(schema.salesInvoices).values({
        id: draftExpiredInvId,
        companyId: COMPANY_A,
        customerId: custId,
        invoiceNumber: 'SI-ARCH-DRAFT-01',
        invoiceDate: '2026-10-10',
        dueDate: '2026-11-10',
        subtotal: 10000,
        taxAmount: 1200,
        totalAmount: 11200,
        balanceDue: 11200,
        status: 'ARCHIVED',
        updatedAt: oldDate,
      });

      await db.insert(schema.salesInvoiceLines).values({
        id: crypto.randomUUID(),
        invoiceId: draftExpiredInvId,
        accountId: usedAccountId,
        description: 'Draft line to be purged atomically',
        quantity: 1,
        unitPrice: 10000,
        amount: 10000,
      });

      await db.insert(schema.taxCodes).values({
        id: taxCodeExpiredId,
        companyId: COMPANY_A,
        code: 'TMP-OLD',
        name: 'Expired Unused Tax Code',
        taxType: 'VAT',
        rate: 0.12,
        status: 'ARCHIVED',
        updatedAt: oldDate,
      });

      await db.insert(schema.auditEngagements).values({
        id: auditEngId,
        companyId: COMPANY_A,
        clientCompanyId: COMPANY_A,
        engagementName: 'FY2026 Sample Engagement',
        auditPeriod: 'FY 2026',
        engagementType: 'STATUTORY_AUDIT',
        status: 'ARCHIVED',
        updatedAt: recentDate,
      });

      // Verify pure read-only GET listing does NOT auto-purge expired rows!
      const listBefore = await ArchiveRetentionService.listArchivedRecords(COMPANY_A);
      const beforeById = new Map(listBefore.records.map((r) => [r.id, r]));

      expect(beforeById.get(usedAccountId)?.retentionState).toBe('BLOCKED');
      expect(beforeById.get(usedAccountId)?.canPermanentDelete).toBe(false);
      expect(beforeById.get(postedInvId)?.retentionState).toBe('EXEMPT');
      expect(beforeById.get(postedInvId)?.canPermanentDelete).toBe(false);
      expect(beforeById.get(unusedExpiredAccId)?.retentionState).toBe('ELIGIBLE_FOR_PURGE');
      expect(beforeById.get(draftExpiredInvId)?.retentionState).toBe('ELIGIBLE_FOR_PURGE');
      expect(beforeById.get(unusedRecentAccId)?.retentionState).toBe('ACTIVE_RETENTION');
      expect(beforeById.get(auditEngId)?.retentionState).toBe('ACTIVE_RETENTION');

      // Direct permanent delete MUST block used COA account & posted Sales Invoice with 403 RETENTION_POLICY_BLOCKED
      await expect(
        ArchiveRetentionService.permanentlyDeleteArchivedRecord(COMPANY_A, 'ACCOUNT', usedAccountId, { userId: USER_ID })
      ).rejects.toThrow(/Permanent deletion is prohibited/i);

      await expect(
        ArchiveRetentionService.permanentlyDeleteArchivedRecord(COMPANY_A, 'SALES_INVOICE', postedInvId, { userId: USER_ID })
      ).rejects.toThrow(/BIR 10-Year Statutory Retention/i);
    });

    // Seed an expired archived account in Company B to prove strict tenant isolation during Company A sweep
    await dbContext.run(dbB, async () => {
      await db.insert(schema.accounts).values({
        id: tenantBAccId,
        companyId: COMPANY_B,
        accountCode: '5999',
        accountName: 'Company B Expired Archived Account',
        accountType: 'EXPENSE',
        normalBalance: 'DEBIT',
        status: 'ARCHIVED',
        updatedAt: oldDate,
      });
    });

    // Run independent 30-day Retention Scheduler sweep for Company A
    const sweep1 = await ArchiveRetentionScheduler.runRetentionSweepForCompany(COMPANY_A, { userId: USER_ID });
    expect(sweep1.purgedCount).toBeGreaterThanOrEqual(3); // unusedExpiredAccId + draftExpiredInvId + taxCodeExpiredId
    expect(sweep1.blockedCount).toBeGreaterThanOrEqual(1); // usedAccountId
    expect(sweep1.exemptCount).toBeGreaterThanOrEqual(1); // postedInvId
    expect(sweep1.failedCount).toBe(0);

    // Verify DB state in Company A after sweep
    await dbContext.run(dbA, async () => {
      // Eligible expired records are permanently gone (including child invoice lines)
      expect(await db.select().from(schema.accounts).where(eq(schema.accounts.id, unusedExpiredAccId)).get()).toBeUndefined();
      expect(await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, draftExpiredInvId)).get()).toBeUndefined();
      expect(await db.select().from(schema.salesInvoiceLines).where(eq(schema.salesInvoiceLines.invoiceId, draftExpiredInvId)).all()).toHaveLength(0);
      expect(await db.select().from(schema.taxCodes).where(eq(schema.taxCodes.id, taxCodeExpiredId)).get()).toBeUndefined();

      // Protected/Blocked/Exempt/Recent records SURVIVED untouched!
      expect(await db.select().from(schema.accounts).where(eq(schema.accounts.id, usedAccountId)).get()).toBeDefined();
      expect(await db.select().from(schema.salesInvoices).where(eq(schema.salesInvoices.id, postedInvId)).get()).toBeDefined();
      expect(await db.select().from(schema.accounts).where(eq(schema.accounts.id, unusedRecentAccId)).get()).toBeDefined();
      expect(await db.select().from(schema.auditEngagements).where(eq(schema.auditEngagements.id, auditEngId)).get()).toBeDefined();

      // Audit engagement can be restored from its Dedicated Archive Inbox cleanly
      const restoredEng = await ArchiveRetentionService.restoreArchivedRecord(COMPANY_A, 'AUDIT_ENGAGEMENT', auditEngId, {
        userId: USER_ID,
      });
      expect(restoredEng.id).toBe(auditEngId);
    });

    // Verify Company B was COMPLETELY UNTOUCHED by Company A sweep (tenant isolation)
    await dbContext.run(dbB, async () => {
      const stillInB = await db.select().from(schema.accounts).where(eq(schema.accounts.id, tenantBAccId)).get();
      expect(stillInB).toBeDefined();
      expect(stillInB?.status).toBe('ARCHIVED');
    });

    // Verify repeat sweep is idempotent (0 newly purged, 0 errors)
    const sweep2 = await ArchiveRetentionScheduler.runRetentionSweepForCompany(COMPANY_A, { userId: USER_ID });
    expect(sweep2.purgedCount).toBe(0);
    expect(sweep2.failedCount).toBe(0);
  });

  it('4. returns truthful backup status without fabricated AUTO-SYSTEM-BASELINE.lai fallback (DEF-BACKUP-001)', async () => {
    const missingStatus = await AutomatedBackupScheduler.getCompanyBackupStatus('LGR-PH-NONEXISTENT-999999');
    expect(missingStatus.totalBackups).toBe(0);
    expect(missingStatus.lastBackupName).toBeNull();
    expect(missingStatus.isOverdue).toBe(true);
    expect(String(missingStatus.lastBackupName || '')).not.toContain('AUTO-SYSTEM-BASELINE');

    const emptyCompanyStatus = await AutomatedBackupScheduler.getCompanyBackupStatus(COMPANY_B);
    expect(emptyCompanyStatus.totalBackups).toBe(0);
    expect(emptyCompanyStatus.lastBackupTime).toBeNull();
    expect(emptyCompanyStatus.isOverdue).toBe(true);
  });
});
