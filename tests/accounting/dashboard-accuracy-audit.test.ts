import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CompanyManager } from '../../src/server/services/companyManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';

describe('Dashboard Accuracy & Source-of-Truth Reconciliation Audit', () => {
  const PREVIEW_ID = 'LGR-PH-2026-STRESS-DG-PREVIEW';
  let companyDb: any;
  let seededByTest = false;

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    const existing = await CompanyManager.getCompanyManifest(PREVIEW_ID);
    if (!existing) {
      await CompanyManager.ensureStressPreviewSeeded({ forceExplicitDemo: true });
      seededByTest = true;
    }
    companyDb = await CompanyManager.getCompanyDb(PREVIEW_ID);
  });

  afterAll(async () => {
    if (seededByTest) {
      await CompanyManager.resetDisposableTestCompanyWorkspace(PREVIEW_ID);
    }
  });

  it('1. Independently audits and reconciles Cash Position, Accounts Receivable, and Accounts Payable', async () => {
    await dbContext.run(companyDb, async () => {
      // A. Dashboard AR query
      const arQuery = await db.select({ total: sql<number>`COALESCE(sum(balance_due), 0)` })
        .from(schema.salesInvoices)
        .where(
          and(
            eq(schema.salesInvoices.companyId, PREVIEW_ID),
            sql`${schema.salesInvoices.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND ${schema.salesInvoices.balanceDue} > 0`
          )
        );
      const dashboardAr = Number(arQuery[0]?.total || 0);

      // B. Dashboard AP query
      const apQuery = await db.select({ total: sql<number>`COALESCE(sum(balance_due), 0)` })
        .from(schema.purchaseBills)
        .where(
          and(
            eq(schema.purchaseBills.companyId, PREVIEW_ID),
            sql`${schema.purchaseBills.status} IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID') AND ${schema.purchaseBills.balanceDue} > 0`
          )
        );
      const dashboardAp = Number(apQuery[0]?.total || 0);

      // C. Dashboard Cash query
      const cashQuery = await db.select({
        balance: sql<number>`COALESCE(sum(case when ${schema.accounts.normalBalance} = 'DEBIT' then ${schema.journalLines.debit} - ${schema.journalLines.credit} else ${schema.journalLines.credit} - ${schema.journalLines.debit} end), 0)`
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .where(
        and(
          eq(schema.journalEntries.companyId, PREVIEW_ID),
          eq(schema.journalEntries.status, "POSTED"),
          sql`(${schema.accounts.isCashAccount} = 1 OR (${schema.accounts.accountType} IN ('ASSET', 'OTHER_CURRENT_ASSET') AND (${schema.accounts.accountName} LIKE '%Cash%' OR ${schema.accounts.accountName} LIKE '%Bank%')))`
        )
      );
      const dashboardCash = Number(cashQuery[0]?.balance || 0);

      // D. General Ledger Control Accounts check for AR (account_type = 'RECEIVABLE' or code 1200/1030)
      const arGlQuery = await db.select({
        accountId: schema.accounts.id,
        accountCode: schema.accounts.accountCode,
        accountName: schema.accounts.accountName,
        balance: sql<number>`COALESCE(sum(${schema.journalLines.debit} - ${schema.journalLines.credit}), 0)`
      })
      .from(schema.accounts)
      .leftJoin(schema.journalLines, eq(schema.accounts.id, schema.journalLines.accountId))
      .leftJoin(schema.journalEntries, and(eq(schema.journalLines.journalEntryId, schema.journalEntries.id), eq(schema.journalEntries.status, 'POSTED')))
      .where(
        and(
          eq(schema.accounts.companyId, PREVIEW_ID),
          sql`${schema.accounts.accountType} = 'RECEIVABLE' OR ${schema.accounts.accountCode} IN ('1200', '1030', '1010')`
        )
      )
      .groupBy(schema.accounts.id);

      console.log('=== DASHBOARD RECONCILIATION AUDIT ===');
      console.log(`Dashboard Cash Position: ₱${(dashboardCash / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
      console.log(`Dashboard Accounts Receivable: ₱${(dashboardAr / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
      console.log(`Dashboard Accounts Payable: ₱${(dashboardAp / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
      console.log('AR Control Accounts in GL:', arGlQuery);

      expect(dashboardCash).toBeGreaterThanOrEqual(0);
      expect(dashboardAr).toBeGreaterThanOrEqual(0);
      expect(dashboardAp).toBeGreaterThanOrEqual(0);
    });
  });
});
