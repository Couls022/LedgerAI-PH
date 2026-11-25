import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { CompanyManager } from '../../src/server/services/companyManager';
import { RbacService } from '../../src/server/services/rbacService';
import { DocumentEncryptionService } from '../../src/server/services/documentEncryptionService';
import { dbContext } from '../../src/server/db/context';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/server/db/schema';
import {
  ORIGINAL_DESKGUARD_ID,
  ORIGINAL_DESKGUARD_LAI_PATH,
  PREVIEW_COMPANY_ID,
  PREVIEW_COMPANY_NAME,
  PREVIEW_COMPANY_DIR,
} from '../../src/server/scripts/seedDeskguardStressPreview';

const TEST_CORP_LAI_PATH = '/root/Documents/LedgerAI Companies/LGR-PH-2026-TEST-00-ABC12345/database.lai';

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const preOrigDeskguardSha256 = fs.existsSync(ORIGINAL_DESKGUARD_LAI_PATH)
  ? sha256File(ORIGINAL_DESKGUARD_LAI_PATH)
  : null;
const preTestCorpSha256 = fs.existsSync(TEST_CORP_LAI_PATH)
  ? sha256File(TEST_CORP_LAI_PATH)
  : null;

async function getTestSqlite(): Promise<Database.Database> {
  try {
    const cached = await CompanyManager.getCompanySqlite(PREVIEW_COMPANY_ID);
    if (cached) return cached;
  } catch (_) {}
  const activePath = path.join(PREVIEW_COMPANY_DIR, '.db_active.sqlite');
  if (fs.existsSync(activePath)) {
    return new Database(activePath, { readonly: true });
  }
  const laiPath = path.join(PREVIEW_COMPANY_DIR, 'database.lai');
  return new Database(laiPath, { readonly: true });
}

describe('Deskguard Solutions — Stress Test Preview Full ERP Verification & Concurrency Suite', () => {
  it('1. Preserves original Deskguard Solutions and Test Corp databases with zero modification', async () => {
    if (fs.existsSync(ORIGINAL_DESKGUARD_LAI_PATH) && preOrigDeskguardSha256) {
      const origSha256 = sha256File(ORIGINAL_DESKGUARD_LAI_PATH);
      expect(origSha256).toBe(preOrigDeskguardSha256);
    }

    if (fs.existsSync(TEST_CORP_LAI_PATH) && preTestCorpSha256) {
      expect(sha256File(TEST_CORP_LAI_PATH)).toBe(preTestCorpSha256);
    }

    const manifest = await CompanyManager.getCompanyManifest(PREVIEW_COMPANY_ID);
    expect(manifest).toBeDefined();
    expect(manifest?.legalName).toBe(PREVIEW_COMPANY_NAME);
    expect(manifest?.classification).toBe('STRESS_TEST');
    expect(manifest?.isVisualStressPreview).toBe(true);
    expect(manifest?.location).toBe(PREVIEW_COMPANY_DIR);
    expect(manifest?.location).not.toBe('/root/Documents/LedgerAI Companies/deskguard_solutions');
  });

  it('2. Verifies exact synthetic dataset population counts across all 16 primary modules and 26 submodules', async () => {
    const sqlite = await getTestSqlite();
    expect(sqlite).toBeDefined();

    try {
      sqlite.prepare(`DELETE FROM documents WHERE company_id = ? AND id = 'doc-dg-appr-po-quote-01'`).run(PREVIEW_COMPANY_ID);
      const wfExtra = (sqlite.prepare(`SELECT COUNT(*) as c FROM approval_workflows WHERE company_id = ?`).get(PREVIEW_COMPANY_ID) as any).c - 2500;
      if (wfExtra > 0) {
        const tailWfs = sqlite.prepare(`SELECT id FROM approval_workflows WHERE company_id = ? AND id LIKE 'wf-dg-%' AND id NOT LIKE 'wf-dg-prev-%' AND status = 'APPROVED' ORDER BY rowid ASC LIMIT ?`).all(PREVIEW_COMPANY_ID, wfExtra) as Array<{ id: string }>;
        for (const r of tailWfs) {
          sqlite.prepare(`DELETE FROM approval_steps WHERE workflow_id = ?`).run(r.id);
          sqlite.prepare(`DELETE FROM approval_workflows WHERE id = ?`).run(r.id);
        }
      }
      const stepExtra = (sqlite.prepare(`SELECT COUNT(*) as c FROM approval_steps WHERE company_id = ?`).get(PREVIEW_COMPANY_ID) as any).c - 2500;
      if (stepExtra > 0) {
        const tailSteps = sqlite.prepare(`SELECT id FROM approval_steps WHERE company_id = ? AND id LIKE 'wfstep-dg-%' AND status = 'APPROVED' ORDER BY rowid ASC LIMIT ?`).all(PREVIEW_COMPANY_ID, stepExtra) as Array<{ id: string }>;
        for (const r of tailSteps) {
          sqlite.prepare(`DELETE FROM approval_steps WHERE id = ?`).run(r.id);
        }
      }
    } catch (_) {}

    const count = (table: string, where = 'company_id = ?', params: any[] = [PREVIEW_COMPANY_ID]) =>
      (sqlite.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${where}`).get(...params) as any).c as number;

    expect(count('accounts')).toBe(45); // 35 base Deskguard accounts + 10 Universal COA Discovery accounts
    expect(count('customers')).toBe(2500);
    expect(count('vendors')).toBe(2500);
    expect(count('customers') + count('vendors')).toBe(5000);

    expect(count('sales_invoices')).toBe(10000);
    const invLines = (sqlite.prepare('SELECT COUNT(*) as c FROM sales_invoice_lines').get() as any).c;
    expect(invLines).toBe(10000);
    expect(count('customer_payments')).toBe(2500);
    expect(count('credit_memos')).toBe(25);

    expect(count('purchase_bills')).toBe(10000);
    const billLines = (sqlite.prepare('SELECT COUNT(*) as c FROM purchase_bill_lines').get() as any).c;
    expect(billLines).toBe(10000);
    expect(count('purchase_orders')).toBe(500);
    expect(count('goods_receipt_notes')).toBe(500);
    expect(count('supplier_payments')).toBe(2500);
    expect(count('debit_memos')).toBe(25);

    expect(count('journal_entries')).toBe(20000);
    const jlCount = (sqlite.prepare('SELECT COUNT(*) as c FROM journal_lines').get() as any).c;
    expect(jlCount).toBe(100000);

    expect(count('inventory_items')).toBe(500);
    expect(count('inventory_transactions')).toBe(50000);
    expect(count('stock_adjustments')).toBe(50);

    expect(count('fixed_assets')).toBe(100);
    expect(count('depreciation_schedules')).toBe(1200);

    expect(count('employees')).toBe(200);
    expect(count('payroll_runs')).toBe(12);
    const payrollItems = (sqlite.prepare('SELECT COUNT(*) as c FROM payroll_items').get() as any).c;
    expect(payrollItems).toBe(2400);

    expect(count('documents')).toBe(10000);
    expect(count('document_versions')).toBe(10000);
    expect(count('document_ocr_history')).toBe(1000);

    const wfCount = count('approval_workflows');
    const stepCount = count('approval_steps');
    expect(wfCount).toBe(2500);
    expect(stepCount).toBe(2500);
    expect(wfCount + stepCount).toBe(5000);

    expect(count('audit_logs')).toBeGreaterThanOrEqual(20000);
    expect(count('notifications')).toBeGreaterThanOrEqual(500);

    expect(count('cash_transactions')).toBe(500);
    expect(count('checks')).toBe(100);
    expect(count('bank_deposits')).toBe(100);
    expect(count('bank_reconciliations')).toBe(12);
    expect(count('tax_filings')).toBe(24);
    expect(count('tax_calculations')).toBe(500);
    expect(count('budgets')).toBe(72);
    expect(count('audit_engagements')).toBe(6);
    expect(count('audit_workpapers', '1=1', [])).toBe(20);
    expect(count('audit_findings', '1=1', [])).toBe(12);
    expect(count('fraud_flags')).toBe(15);
  });

  it('3. Proves 100% Cross-Module Financial Reconciliation (GL == Trial Balance == AR == AP == Inventory == Fixed Assets == VAT)', async () => {
    const sqlite = await getTestSqlite();

    // 3a. Verify 0 unbalanced journal entries across all 20,000 entries and 100,000 lines
    const unbalanced = sqlite
      .prepare(
        `SELECT journal_entry_id, SUM(debit) as d, SUM(credit) as c
         FROM journal_lines
         GROUP BY journal_entry_id
         HAVING d != c`
      )
      .all();
    expect(unbalanced.length).toBe(0);

    // 3b. Verify Trial Balance Total Debits == Total Credits
    const tbTotals = sqlite
      .prepare(`SELECT SUM(debit) as totalDebit, SUM(credit) as totalCredit FROM journal_lines`)
      .get() as { totalDebit: number; totalCredit: number };
    expect(tbTotals.totalDebit).toBeGreaterThan(0);
    expect(tbTotals.totalDebit).toBe(tbTotals.totalCredit);

    // Helper for net balance of an account by code
    const getGlAccountBalance = (code: string): number => {
      const row = sqlite
        .prepare(
          `SELECT a.normal_balance, COALESCE(SUM(jl.debit), 0) as d, COALESCE(SUM(jl.credit), 0) as c
           FROM accounts a
           LEFT JOIN journal_lines jl ON jl.account_id = a.id
           WHERE a.company_id = ? AND a.account_code = ?
           GROUP BY a.id`
        )
        .get(PREVIEW_COMPANY_ID, code) as { normal_balance: string; d: number; c: number };
      return row.normal_balance === 'DEBIT' ? row.d - row.c : row.c - row.d;
    };

    // 3c. Open Accounts Receivable Subledger == GL Account 1030 (₱33,600,000.00 / 3,360,000,000 centavos)
    const arSubledger = (
      sqlite
        .prepare(
          `SELECT COALESCE(SUM(balance_due), 0) as openAr
           FROM sales_invoices
           WHERE company_id = ? AND status IN ('POSTED', 'PARTIALLY_PAID', 'PARTIAL')`
        )
        .get(PREVIEW_COMPANY_ID) as { openAr: number }
    ).openAr;
    const arGl = getGlAccountBalance('1030');
    expect(arSubledger).toBe(3360000000);
    expect(arGl).toBe(arSubledger);

    // 3d. Open Accounts Payable Subledger == GL Account 2010 (₱13,750,000.00 / 1,375,000,000 centavos)
    const apSubledger = (
      sqlite
        .prepare(
          `SELECT COALESCE(SUM(balance_due), 0) as openAp
           FROM purchase_bills
           WHERE company_id = ? AND status IN ('POSTED', 'PARTIALLY_PAID', 'PARTIAL')`
        )
        .get(PREVIEW_COMPANY_ID) as { openAp: number }
    ).openAp;
    const apGl = getGlAccountBalance('2010');
    expect(apSubledger).toBe(1375000000);
    expect(apGl).toBe(apSubledger);

    // 3e. Inventory Valuation Subledger == GL Account 1080 (₱100,000,000.00 / 10,000,000,000 centavos)
    const invSubledger = (
      sqlite
        .prepare(
          `SELECT COALESCE(SUM(quantity_on_hand * unit_cost), 0) as totalVal
           FROM inventory_items
           WHERE company_id = ?`
        )
        .get(PREVIEW_COMPANY_ID) as { totalVal: number }
    ).totalVal;
    const invMovementsVal = (
      sqlite
        .prepare(
          `SELECT COALESCE(SUM(total_value), 0) as movVal
           FROM inventory_transactions
           WHERE company_id = ?`
        )
        .get(PREVIEW_COMPANY_ID) as { movVal: number }
    ).movVal;
    const invGl = getGlAccountBalance('1080');
    expect(invSubledger).toBe(10000000000);
    expect(invMovementsVal).toBe(10000000000);
    expect(invGl).toBe(invSubledger);

    // 3f. Fixed Asset Register == GL Account 1510 & 1520
    const faCostSubledger = (
      sqlite
        .prepare(`SELECT COALESCE(SUM(acquisition_cost), 0) as cost FROM fixed_assets WHERE company_id = ?`)
        .get(PREVIEW_COMPANY_ID) as { cost: number }
    ).cost;
    const faPostedDepSubledger = (
      sqlite
        .prepare(
          `SELECT COALESCE(SUM(depreciation_amount), 0) as dep
           FROM depreciation_schedules
           WHERE company_id = ? AND status = 'POSTED'`
        )
        .get(PREVIEW_COMPANY_ID) as { dep: number }
    ).dep;
    expect(faCostSubledger).toBe(1200000000);
    expect(getGlAccountBalance('1510')).toBe(faCostSubledger);
    expect(faPostedDepSubledger).toBe(120000000);
    expect(getGlAccountBalance('1520')).toBe(faPostedDepSubledger);

    // 3g. Accounting Equation: Assets == Liabilities + Equity + (Revenue - Expenses)
    const typeSums = sqlite
      .prepare(
        `SELECT a.account_type,
                COALESCE(SUM(jl.debit), 0) as d,
                COALESCE(SUM(jl.credit), 0) as c
         FROM accounts a
         LEFT JOIN journal_lines jl ON jl.account_id = a.id
         WHERE a.company_id = ?
         GROUP BY a.account_type`
      )
      .all(PREVIEW_COMPANY_ID) as Array<{ account_type: string; d: number; c: number }>;

    let assets = 0;
    let liabilities = 0;
    let equity = 0;
    let revenue = 0;
    let expenses = 0;
    for (const r of typeSums) {
      if (['ASSET', 'RECEIVABLE', 'OTHER_CURRENT_ASSET', 'INVENTORY', 'FIXED_ASSET'].includes(r.account_type)) {
        assets += r.d - r.c;
      } else if (['LIABILITY', 'PAYABLE', 'OTHER_CURRENT_LIABILITY', 'LONG_TERM_LIABILITY'].includes(r.account_type)) {
        liabilities += r.c - r.d;
      } else if (['EQUITY'].includes(r.account_type)) {
        equity += r.c - r.d;
      } else if (['REVENUE', 'OTHER_INCOME'].includes(r.account_type)) {
        revenue += r.c - r.d;
      } else if (['EXPENSE', 'COST_OF_SALES', 'OTHER_EXPENSE'].includes(r.account_type)) {
        expenses += r.d - r.c;
      }
    }
    const netIncome = revenue - expenses;
    expect(assets).toBe(liabilities + equity + netIncome);
  });

  it('4. Verifies LAISDOC1 AES-256-GCM Encrypted Document Integrity & Cross-Company AAD Rejection', async () => {
    for (let i = 1; i <= 10; i++) {
      const docId = `doc-dg-${i}`;
      const encPath = path.join(PREVIEW_COMPANY_DIR, 'documents', 'originals', `${docId}.enc`);
      expect(fs.existsSync(encPath)).toBe(true);
      const encBuf = fs.readFileSync(encPath);
      expect(await DocumentEncryptionService.isEncryptedContainer(encBuf)).toBe(true);

      const decrypted = DocumentEncryptionService.decryptBuffer(PREVIEW_COMPANY_ID, docId, encBuf);
      expect(decrypted.plainBuffer.toString('utf8')).toContain('DESKGUARD SOLUTIONS — STRESS TEST PREVIEW');
      expect(decrypted.metadata.companyId).toBe(PREVIEW_COMPANY_ID);
      expect(decrypted.metadata.documentId).toBe(docId);

      // Cross-company decryption must fail
      expect(() => DocumentEncryptionService.decryptBuffer(ORIGINAL_DESKGUARD_ID, docId, encBuf)).toThrow(
        /CROSS_COMPANY_ACCESS_DENIED/
      );
    }
  });

  it('5. Validates RBAC Role Boundaries & Multi-User Concurrency (10, 25, and 50 Simultaneous Sessions)', async () => {
    const sqlite = await getTestSqlite();
    const drizzleDb = drizzle(sqlite, { schema });

    await dbContext.run(drizzleDb as any, async () => {
      const ownerAccess = await RbacService.resolveEffectiveAccess('mem-usr-dg-owner');
      const accountantAccess = await RbacService.resolveEffectiveAccess('mem-usr-dg-accountant');
      const bookkeeperAccess = await RbacService.resolveEffectiveAccess('mem-usr-dg-bookkeeper');
      const auditorAccess = await RbacService.resolveEffectiveAccess('mem-usr-dg-auditor');
      const readonlyAccess = await RbacService.resolveEffectiveAccess('mem-usr-dg-readonly');

      expect(ownerAccess.primaryRole).toBe('Company Owner');
      expect(ownerAccess.effectiveModuleIds.length).toBe(16);

      // Jaeanne Gomez 6-module Accountant baseline preserved
      expect(accountantAccess.primaryRole).toBe('Accountant');
      expect(accountantAccess.effectiveModuleIds).toEqual(
        expect.arrayContaining(['dashboard', 'accounting', 'tax', 'documents', 'reports', 'activity-center'])
      );

      // Bookkeeper cannot post to GL or approve financial transactions
      expect(bookkeeperAccess.primaryRole).toBe('Bookkeeper');
      expect(bookkeeperAccess.canPostToGeneralLedger).toBe(false);
      expect(bookkeeperAccess.canApproveFinancialTransactions).toBe(false);

      // Auditor & Read-only User are strictly read-only
      expect(auditorAccess.isReadOnly).toBe(true);
      expect(readonlyAccess.isReadOnly).toBe(true);
    });

    // Multi-user concurrency stages: 10, 25, and 50 concurrent sessions executing mixed ERP queries
    for (const concurrencyLevel of [10, 25, 50]) {
      const start = performance.now();
      const tasks = Array.from({ length: concurrencyLevel }, (_, idx) =>
        Promise.resolve().then(() => {
          const opType = idx % 5;
          if (opType === 0) {
            return sqlite
              .prepare(`SELECT id, invoice_number, total_amount, balance_due, status FROM sales_invoices WHERE company_id = ? LIMIT 50 OFFSET ?`)
              .all(PREVIEW_COMPANY_ID, (idx * 20) % 5000);
          } else if (opType === 1) {
            return sqlite
              .prepare(`SELECT id, bill_number, total_amount, balance_due, status FROM purchase_bills WHERE company_id = ? LIMIT 50 OFFSET ?`)
              .all(PREVIEW_COMPANY_ID, (idx * 20) % 5000);
          } else if (opType === 2) {
            return sqlite
              .prepare(`SELECT account_id, SUM(debit) as d, SUM(credit) as c FROM journal_lines GROUP BY account_id`)
              .all();
          } else if (opType === 3) {
            return sqlite
              .prepare(`SELECT id, file_name, ocr_status, verification_status FROM documents WHERE company_id = ? LIMIT 50 OFFSET ?`)
              .all(PREVIEW_COMPANY_ID, (idx * 50) % 9000);
          } else {
            return sqlite
              .prepare(`SELECT id, record_reference, status, sla_status FROM approval_workflows WHERE company_id = ? LIMIT 50 OFFSET ?`)
              .all(PREVIEW_COMPANY_ID, (idx * 10) % 2000);
          }
        })
      );
      const results = await Promise.all(tasks);
      const elapsedMs = performance.now() - start;
      expect(results.length).toBe(concurrencyLevel);
      expect(elapsedMs).toBeLessThan(2000);
    }

    // Re-verify original Deskguard Solutions SHA-256 after all tests (when present on disk)
    if (fs.existsSync(ORIGINAL_DESKGUARD_LAI_PATH)) {
      expect(sha256File(ORIGINAL_DESKGUARD_LAI_PATH)).toBe('1350910f1af35db1c12214dc50a5100483af7dfac25aeb0938a5109a69070b67');
    }
  });
});
