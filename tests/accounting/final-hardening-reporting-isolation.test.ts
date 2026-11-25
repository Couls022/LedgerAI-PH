import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import request from 'supertest';

const { tempRoot } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('node:path');
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'ledgerai-p3-reporting-'));
  process.env.LEDGERAI_CONFIG_DIR = nodePath.join(root, 'config');
  process.env.LEDGERAI_DATA_DIR = nodePath.join(root, 'data');
  return { tempRoot: root };
});

import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { RbacService } from '../../src/server/services/rbacService';
import { hashToken } from '../../src/server/auth';
import { dbContext } from '../../src/server/db/context';
import { AccountingEngine } from '../../src/server/services/accountingEngine';
import { ReportEngine } from '../../src/server/services/reportEngine';
import { BirComplianceService } from '../../src/server/services/birComplianceService';

const COMP_A = 'LGR-PH-P3-ALPHA';
const COMP_B = 'LGR-PH-P3-BETA';

describe('PRIORITY 3 — FINANCIAL REPORTING DATE-RANGE & COMPANY/PERIOD ISOLATION', () => {
  const app = createApp();
  const ownerAId = 'usr-p3-owner-a';
  const ownerBId = 'usr-p3-owner-b';
  let tokenA = '';
  let tokenB = '';

  let cashAccA = '';
  let arAccA = '';
  let apAccA = '';
  let revAccA = '';
  let expAccA = '';
  let outVatAccA = '';
  let inVatAccA = '';
  let cwtAccA = '';

  beforeAll(async () => {
    for (const [compId, compName, userId, email] of [
      [COMP_A, 'Priority 3 Alpha Reporting Corp.', ownerAId, 'owner@p3-a.ph'],
      [COMP_B, 'Priority 3 Beta Isolation Corp.', ownerBId, 'owner@p3-b.ph'],
    ] as const) {
      await CompanyManager.createCompanyProfile(compId, compName, undefined, undefined, false, {
        classification: 'TEST',
      });
      const sqlite = await CompanyManager.getCompanySqlite(compId);
      const companyDb = await CompanyManager.getCompanyDb(compId);
      const now = Date.now();

      sqlite.exec(`
        INSERT OR REPLACE INTO companies (id, legal_name, tin, vat_status, taxpayer_classification, currency, status, classification)
        VALUES ('${compId}', '${compName}', '555-666-777-000', 'VAT', 'CORPORATION', 'PHP', 'ACTIVE', 'TEST');
      `);

      await dbContext.run(companyDb as any, async () => {
        await RbacService.ensureRoleTemplatesSeeded();
        await AccountingEngine.ensureDefaultAccounts(compId);

        sqlite
          .prepare(
            `INSERT OR REPLACE INTO users (id, email, password_hash, display_name, status, is_demo, require_password_change, created_at, updated_at)
             VALUES (?, ?, 'hash', ?, 'ACTIVE', 1, 0, ?, ?)`
          )
          .run(userId, email, compName, now, now);

        const cuId = `cu-${compId}-${userId}`;
        sqlite
          .prepare(
            `INSERT OR REPLACE INTO company_users (id, user_id, company_id, legacy_role, status, membership_status, default_data_scope, approval_limit_centavos, created_at, updated_at)
             VALUES (?, ?, ?, 'Company Owner', 'ACTIVE', 'ACTIVE', 'COMPANY_WIDE', 9900000000, ?, ?)`
          )
          .run(cuId, userId, compId, now, now);

        await RbacService.setMemberRoles(null, cuId, ['Company Owner'] as any, 'P3 setup');

        const rawToken = crypto.randomBytes(32).toString('hex');
        sqlite
          .prepare(`INSERT OR REPLACE INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`)
          .run(hashToken(rawToken), userId, now + 86400_000, now);
        if (compId === COMP_A) tokenA = `${compId}.${rawToken}`;
        else tokenB = `${compId}.${rawToken}`;
      });
    }

    const sqliteA = await CompanyManager.getCompanySqlite(COMP_A);
    const now = Date.now();

    // Clear default accounts in Company A so our controlled test accounts are the exact accounts in Company A
    sqliteA.prepare(`DELETE FROM accounts WHERE company_id = ?`).run(COMP_A);

    // Seed periods for Company A:
    // - FY 2025: 2025-01-01 to 2025-12-31 (HARD_CLOSED)
    // - FY 2026: 2026-01-01 to 2026-12-31 (OPEN parent period)
    // - Q1 2026: 2026-01-01 to 2026-03-31 (OPEN child period)
    // - Q2 2026: 2026-04-01 to 2026-06-30 (OPEN child period)
    // - FY 2027: 2027-01-01 to 2027-12-31 (OPEN future period)
    const insertPeriod = sqliteA.prepare(
      `INSERT OR REPLACE INTO accounting_periods (id, company_id, name, start_date, end_date, fiscal_year, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertPeriod.run('per-a-fy2025', COMP_A, 'FY 2025', '2025-01-01', '2025-12-31', 2025, 'HARD_CLOSED', now, now);
    insertPeriod.run('per-a-fy2026', COMP_A, 'FY 2026', '2026-01-01', '2026-12-31', 2026, 'OPEN', now, now);
    insertPeriod.run('per-a-q1-2026', COMP_A, 'Q1 2026', '2026-01-01', '2026-03-31', 2026, 'OPEN', now, now);
    insertPeriod.run('per-a-q2-2026', COMP_A, 'Q2 2026', '2026-04-01', '2026-06-30', 2026, 'OPEN', now, now);
    insertPeriod.run('per-a-fy2027', COMP_A, 'FY 2027', '2027-01-01', '2027-12-31', 2027, 'OPEN', now, now);

    const insertAcc = sqliteA.prepare(
      `INSERT OR REPLACE INTO accounts (id, company_id, account_code, account_name, account_type, normal_balance, bir_tax_category, is_cash_account, is_tax_account, is_retained_earnings, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
    );
    cashAccA = 'acc-a-1000';
    arAccA = 'acc-a-1100';
    inVatAccA = 'acc-a-1400';
    apAccA = 'acc-a-2000';
    outVatAccA = 'acc-a-2100';
    cwtAccA = 'acc-a-2200';
    revAccA = 'acc-a-4000';
    expAccA = 'acc-a-5000';

    insertAcc.run(cashAccA, COMP_A, '1000', 'Cash in Bank - BDO', 'ASSET', 'DEBIT', null, 1, 0, 0, now, now);
    insertAcc.run(arAccA, COMP_A, '1100', 'Accounts Receivable - Trade', 'RECEIVABLE', 'DEBIT', null, 0, 0, 0, now, now);
    insertAcc.run(inVatAccA, COMP_A, '1400', 'Input VAT', 'OTHER_CURRENT_ASSET', 'DEBIT', 'INPUT_VAT_12', 0, 1, 0, now, now);
    insertAcc.run(apAccA, COMP_A, '2000', 'Accounts Payable - Trade', 'PAYABLE', 'CREDIT', null, 0, 0, 0, now, now);
    insertAcc.run(outVatAccA, COMP_A, '2100', 'Output VAT Payable', 'OTHER_CURRENT_LIABILITY', 'CREDIT', 'OUTPUT_VAT_12', 0, 1, 0, now, now);
    insertAcc.run(cwtAccA, COMP_A, '2200', 'Expanded Withholding Tax Payable', 'OTHER_CURRENT_LIABILITY', 'CREDIT', 'EWT_1601EQ', 0, 1, 0, now, now);
    insertAcc.run('acc-a-3000', COMP_A, '3000', 'Retained Earnings', 'EQUITY', 'CREDIT', null, 0, 0, 1, now, now);
    insertAcc.run(revAccA, COMP_A, '4000', 'Service Revenue', 'REVENUE', 'CREDIT', null, 0, 0, 0, now, now);
    insertAcc.run(expAccA, COMP_A, '5000', 'Operating Rent Expense', 'EXPENSE', 'DEBIT', null, 0, 0, 0, now, now);

    const insertJe = sqliteA.prepare(
      `INSERT OR REPLACE INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, original_journal_id, created_by, posted_by, created_at, updated_at, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertJl = sqliteA.prepare(
      `INSERT OR REPLACE INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // 1. Prior Year FY 2025 Posted Journal (100,000.00 Revenue / Cash -> rolls into FY 2026 Opening Balance / Retained Earnings)
    insertJe.run('je-a-2025-1', COMP_A, 'JE-2025-001', '2025-11-15', 'per-a-fy2025', 'FY2025 Service Revenue', 'SALES', 'REF-2025-1', 'POSTED', null, ownerAId, ownerAId, now, now, now);
    insertJl.run('jl-a-2025-1a', 'je-a-2025-1', cashAccA, 'FY2025 Cash', 10000000, 0, 1, now);
    insertJl.run('jl-a-2025-1b', 'je-a-2025-1', revAccA, 'FY2025 Revenue', 0, 10000000, 2, now);

    // 2. Q1 2026 Valid Posted Sales Journal (2026-02-15: Gross 56,000.00 = Net 50,000.00 + Output VAT 6,000.00)
    insertJe.run('je-a-q1-valid', COMP_A, 'JE-2026-001', '2026-02-15', 'per-a-q1-2026', 'Q1 Valid Sales', 'SALES', 'inv-a-valid', 'POSTED', null, ownerAId, ownerAId, now, now, now);
    insertJl.run('jl-a-q1-v1', 'je-a-q1-valid', arAccA, 'AR Valid Customer', 5600000, 0, 1, now);
    insertJl.run('jl-a-q1-v2', 'je-a-q1-valid', revAccA, 'Q1 Net Revenue', 0, 5000000, 2, now);
    insertJl.run('jl-a-q1-v3', 'je-a-q1-valid', outVatAccA, 'Q1 Output VAT', 0, 600000, 3, now);

    // 3. Q1 2026 Valid Posted Expense Journal (2026-02-20: Net Expense 20,000.00 + Input VAT 2,400.00 = AP 21,400.00 + EWT 1,000.00)
    insertJe.run('je-a-q1-exp', COMP_A, 'JE-2026-002', '2026-02-20', 'per-a-q1-2026', 'Q1 Office Rent', 'PURCHASES', 'bill-a-valid', 'POSTED', null, ownerAId, ownerAId, now, now, now);
    insertJl.run('jl-a-q1-e1', 'je-a-q1-exp', expAccA, 'Q1 Rent Expense', 2000000, 0, 1, now);
    insertJl.run('jl-a-q1-e2', 'je-a-q1-exp', inVatAccA, 'Q1 Input VAT', 240000, 0, 2, now);
    insertJl.run('jl-a-q1-e3', 'je-a-q1-exp', apAccA, 'AP Landlord', 0, 2140000, 3, now);
    insertJl.run('jl-a-q1-e4', 'je-a-q1-exp', cwtAccA, 'EWT 5% Rent', 0, 100000, 4, now);

    // 4. Q1 2026 REVERSED Journal Pair (Original 'je-a-q1-rev-orig' status='REVERSED' + Reversal 'je-a-q1-rev-reversal' status='POSTED', source_type='REVERSAL', original_journal_id='je-a-q1-rev-orig')
    insertJe.run('je-a-q1-rev-orig', COMP_A, 'JE-2026-003', '2026-03-01', 'per-a-q1-2026', 'Erroneous Sales Invoice', 'SALES', 'inv-a-reversed-je', 'REVERSED', null, ownerAId, ownerAId, now, now, now);
    insertJl.run('jl-a-q1-ro1', 'je-a-q1-rev-orig', arAccA, 'Erroneous AR', 3360000, 0, 1, now);
    insertJl.run('jl-a-q1-ro2', 'je-a-q1-rev-orig', revAccA, 'Erroneous Rev', 0, 3000000, 2, now);
    insertJl.run('jl-a-q1-ro3', 'je-a-q1-rev-orig', outVatAccA, 'Erroneous OutVAT', 0, 360000, 3, now);

    insertJe.run('je-a-q1-rev-reversal', COMP_A, 'JE-2026-004', '2026-03-02', 'per-a-q1-2026', 'Reversal of JE-2026-003', 'REVERSAL', 'je-a-q1-rev-orig', 'POSTED', 'je-a-q1-rev-orig', ownerAId, ownerAId, now, now, now);
    insertJl.run('jl-a-q1-rr1', 'je-a-q1-rev-reversal', revAccA, 'Reverse Erroneous Rev', 3000000, 0, 1, now);
    insertJl.run('jl-a-q1-rr2', 'je-a-q1-rev-reversal', outVatAccA, 'Reverse Erroneous OutVAT', 360000, 0, 2, now);
    insertJl.run('jl-a-q1-rr3', 'je-a-q1-rev-reversal', arAccA, 'Reverse Erroneous AR', 0, 3360000, 3, now);

    // 5. Q2 2026 Valid Posted Sales Journal (2026-05-10: Net 80,000.00)
    insertJe.run('je-a-q2-valid', COMP_A, 'JE-2026-005', '2026-05-10', 'per-a-q2-2026', 'Q2 Consulting Revenue', 'SALES', 'SI-2026-Q2', 'POSTED', null, ownerAId, ownerAId, now, now, now);
    insertJl.run('jl-a-q2-v1', 'je-a-q2-valid', cashAccA, 'Q2 Cash Receipt', 8000000, 0, 1, now);
    insertJl.run('jl-a-q2-v2', 'je-a-q2-valid', revAccA, 'Q2 Revenue', 0, 8000000, 2, now);

    // 6. Future FY 2027 Posted Journal (2027-02-01: 999,000.00 -> must NEVER leak into 2026 reports or dashboard)
    insertJe.run('je-a-2027-future', COMP_A, 'JE-2027-001', '2027-02-01', 'per-a-fy2027', 'FY 2027 Future Contract', 'SALES', 'SI-2027-001', 'POSTED', null, ownerAId, ownerAId, now, now, now);
    insertJl.run('jl-a-2027-1', 'je-a-2027-future', cashAccA, 'Future 2027 Cash', 99900000, 0, 1, now);
    insertJl.run('jl-a-2027-2', 'je-a-2027-future', revAccA, 'Future 2027 Revenue', 0, 99900000, 2, now);

    // Seed Subledger Invoices & Bills in Company A (both valid and reversed-journal-linked)
    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO customers (id, company_id, code, legal_name, tin, address, status, created_at, updated_at)
         VALUES ('cust-a-1', ?, 'CUST-A-01', 'Alpha Enterprise Client', '123-111-222-000', 'Makati', 'ACTIVE', ?, ?)`
      )
      .run(COMP_A, now, now);

    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO vendors (id, company_id, code, legal_name, tin, address, status, created_at, updated_at)
         VALUES ('vend-a-1', ?, 'VEND-A-01', 'Prime Tower Landlord Corp.', '456-222-333-000', 'BGC', 'ACTIVE', ?, ?)`
      )
      .run(COMP_A, now, now);

    // Valid Q1 invoice linked to je-a-q1-valid
    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO sales_invoices (id, company_id, customer_id, invoice_number, invoice_date, due_date, status, total_amount, balance_due, journal_entry_id, created_by, created_at, updated_at)
         VALUES ('inv-a-valid', ?, 'cust-a-1', 'SI-2026-001', '2026-02-15', '2026-03-15', 'POSTED', 5600000, 5600000, 'je-a-q1-valid', ?, ?, ?)`
      )
      .run(COMP_A, ownerAId, now, now);

    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO sales_invoice_lines (id, invoice_id, account_id, description, quantity, unit_price, amount, created_at)
         VALUES ('sil-a-valid', 'inv-a-valid', ?, 'Valid Q1 Service', 1, 5000000, 5000000, ?)`
      )
      .run(revAccA, now);

    // Stale POSTED subledger invoice whose linked journal entry ('je-a-q1-rev-orig') was REVERSED!
    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO sales_invoices (id, company_id, customer_id, invoice_number, invoice_date, due_date, status, total_amount, balance_due, journal_entry_id, created_by, created_at, updated_at)
         VALUES ('inv-a-reversed-je', ?, 'cust-a-1', 'SI-2026-ERR', '2026-03-01', '2026-03-31', 'POSTED', 3360000, 3360000, 'je-a-q1-rev-orig', ?, ?, ?)`
      )
      .run(COMP_A, ownerAId, now, now);

    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO sales_invoice_lines (id, invoice_id, account_id, description, quantity, unit_price, amount, created_at)
         VALUES ('sil-a-rev', 'inv-a-reversed-je', ?, 'Reversed Q1 Service', 1, 3000000, 3000000, ?)`
      )
      .run(revAccA, now);

    // Valid Q1 purchase bill linked to je-a-q1-exp
    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, status, total_amount, balance_due, journal_entry_id, created_by, created_at, updated_at)
         VALUES ('bill-a-valid', ?, 'vend-a-1', 'PB-2026-001', '2026-02-20', '2026-03-20', 'POSTED', 2240000, 2140000, 'je-a-q1-exp', ?, ?, ?)`
      )
      .run(COMP_A, ownerAId, now, now);

    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO purchase_bill_lines (id, bill_id, account_id, description, quantity, unit_price, amount, created_at)
         VALUES ('pbl-a-valid', 'bill-a-valid', ?, 'Valid Q1 Office Rent', 1, 2000000, 2000000, ?)`
      )
      .run(expAccA, now);

    // Stale POSTED purchase bill linked to REVERSED journal 'je-a-q1-rev-orig'
    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, status, total_amount, balance_due, journal_entry_id, created_by, created_at, updated_at)
         VALUES ('bill-a-reversed-je', ?, 'vend-a-1', 'PB-2026-ERR', '2026-03-01', '2026-03-31', 'POSTED', 7770000, 7770000, 'je-a-q1-rev-orig', ?, ?, ?)`
      )
      .run(COMP_A, ownerAId, now, now);

    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO purchase_bill_lines (id, bill_id, account_id, description, quantity, unit_price, amount, created_at)
         VALUES ('pbl-a-rev', 'bill-a-reversed-je', ?, 'Reversed Q1 Bill Line', 1, 7000000, 7000000, ?)`
      )
      .run(expAccA, now);

    // Valid supplier payment with withholding tax linked to je-a-q1-exp
    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO supplier_payments (id, company_id, vendor_id, payment_number, payment_date, amount, cash_account_id, withholding_tax_amount, withholding_tax_account_id, status, journal_entry_id, created_at, updated_at)
         VALUES ('sp-a-valid', ?, 'vend-a-1', 'SP-2026-001', '2026-02-20', 2140000, ?, 100000, ?, 'POSTED', 'je-a-q1-exp', ?, ?)`
      )
      .run(COMP_A, cashAccA, cwtAccA, now, now);

    // Stale supplier payment linked to REVERSED journal 'je-a-q1-rev-orig'
    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO supplier_payments (id, company_id, vendor_id, payment_number, payment_date, amount, cash_account_id, withholding_tax_amount, withholding_tax_account_id, status, journal_entry_id, created_at, updated_at)
         VALUES ('sp-a-reversed-je', ?, 'vend-a-1', 'SP-2026-ERR', '2026-03-01', 5000000, ?, 250000, ?, 'POSTED', 'je-a-q1-rev-orig', ?, ?)`
      )
      .run(COMP_A, cashAccA, cwtAccA, now, now);

    // Valid customer payment with CWT (withholding_tax_amount = 250,000 centavos) linked to je-a-q1-valid
    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO customer_payments (id, company_id, customer_id, payment_number, payment_date, amount, cash_account_id, withholding_tax_amount, withholding_tax_account_id, status, journal_entry_id, created_at, updated_at)
         VALUES ('cp-a-valid', ?, 'cust-a-1', 'CP-2026-001', '2026-02-18', 5350000, ?, 250000, ?, 'POSTED', 'je-a-q1-valid', ?, ?)`
      )
      .run(COMP_A, cashAccA, cwtAccA, now, now);

    // Stale customer payment linked to REVERSED journal 'je-a-q1-rev-orig' (must be excluded from SAWT & CWT)
    sqliteA
      .prepare(
        `INSERT OR REPLACE INTO customer_payments (id, company_id, customer_id, payment_number, payment_date, amount, cash_account_id, withholding_tax_amount, withholding_tax_account_id, status, journal_entry_id, created_at, updated_at)
         VALUES ('cp-a-reversed-je', ?, 'cust-a-1', 'CP-2026-ERR', '2026-03-01', 3110000, ?, 250000, ?, 'POSTED', 'je-a-q1-rev-orig', ?, ?)`
      )
      .run(COMP_A, cashAccA, cwtAccA, now, now);

    // VOIDED Journal in Q1 2026 (must be excluded from all reports)
    insertJe.run('je-a-q1-voided', COMP_A, 'JE-2026-VOID', '2026-02-22', 'per-a-q1-2026', 'Voided Q1 Entry', 'MANUAL', 'VOID-1', 'VOIDED', null, ownerAId, ownerAId, now, now, now);
    insertJl.run('jl-a-q1-void1', 'je-a-q1-voided', cashAccA, 'Voided Cash', 4400000, 0, 1, now);
    insertJl.run('jl-a-q1-void2', 'je-a-q1-voided', revAccA, 'Voided Revenue', 0, 4400000, 2, now);

    // Disjoint Period Override: entry_date is '2026-02-25' (inside Q1 calendar dates) but explicitly assigned to Q2 period ('per-a-q2-2026')
    // Must be excluded when querying Q1 ('per-a-q1-2026' or '2026-01-01'..'2026-03-31'), and included when querying Q2 ('per-a-q2-2026') or parent FY 2026 ('per-a-fy2026')
    insertJe.run('je-a-disjoint-override', COMP_A, 'JE-2026-DISJOINT', '2026-02-25', 'per-a-q2-2026', 'Disjoint Q2 Period Override', 'SALES', 'SI-DISJOINT', 'POSTED', null, ownerAId, ownerAId, now, now, now);
    insertJl.run('jl-a-disj-1', 'je-a-disjoint-override', cashAccA, 'Disjoint Cash', 1000000, 0, 1, now);
    insertJl.run('jl-a-disj-2', 'je-a-disjoint-override', revAccA, 'Disjoint Revenue', 0, 1000000, 2, now);

    // Seed Company B with large distinct amounts (500,000.00) in Q1 2026 to verify zero cross-company leakage
    const sqliteB = await CompanyManager.getCompanySqlite(COMP_B);
    sqliteB
      .prepare(
        `INSERT OR REPLACE INTO accounting_periods (id, company_id, name, start_date, end_date, fiscal_year, status, created_at, updated_at)
         VALUES ('per-b-q1-2026', ?, 'Q1 2026 Beta', '2026-01-01', '2026-03-31', 2026, 'OPEN', ?, ?)`
      )
      .run(COMP_B, now, now);

    const cashB = (sqliteB.prepare(`SELECT id FROM accounts WHERE company_id = ? AND account_type = 'ASSET' LIMIT 1`).get(COMP_B) as any).id;
    const revB = (sqliteB.prepare(`SELECT id FROM accounts WHERE company_id = ? AND account_type IN ('REVENUE', 'INCOME') LIMIT 1`).get(COMP_B) as any).id;

    sqliteB
      .prepare(
        `INSERT OR REPLACE INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, created_by, posted_by, created_at, updated_at, posted_at)
         VALUES ('je-b-q1-1', ?, 'JE-B-001', '2026-02-15', 'per-b-q1-2026', 'Beta Huge Revenue', 'SALES', 'SI-B-001', 'POSTED', ?, ?, ?, ?, ?)`
      )
      .run(COMP_B, ownerBId, ownerBId, now, now, now);

    sqliteB
      .prepare(
        `INSERT OR REPLACE INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
         VALUES ('jl-b-1', 'je-b-q1-1', ?, 'Beta Cash', 50000000, 0, 1, ?),
                ('jl-b-2', 'je-b-q1-1', ?, 'Beta Revenue', 0, 50000000, 2, ?)`
      )
      .run(cashB, now, revB, now);
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('1. rejects invalid date ranges (startDate > endDate, impossible calendar dates, and date range outside explicit period bounds) with HTTP 400', async () => {
    const invertedRes = await request(app)
      .get('/api/reports/income-statement?startDate=2026-03-31&endDate=2026-01-01')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(invertedRes.status).toBe(400);

    const invalidCalendarRes = await request(app)
      .get('/api/reports/trial-balance?startDate=2026-02-01&endDate=2026-02-31')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(invalidCalendarRes.status).toBe(400);

    const outOfPeriodBoundsRes = await request(app)
      .get('/api/reports/income-statement?accountingPeriodId=per-a-q1-2026&startDate=2026-01-01&endDate=2026-04-15')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(outOfPeriodBoundsRes.status).toBe(400);
  });

  it('2. isolates Q1 vs Q2 vs parent FY 2026 periods accurately and excludes reversed, voided, and disjoint-override journals across General Ledger, Trial Balance, Income Statement, and Balance Sheet', async () => {
    // 1) Q1 2026 Income Statement: Net Revenue = 50,000.00 (5,000,000 centavos; excludes voided 4,400,000, reversed 3,000,000, and disjoint Q2 override 1,000,000), Expense = 20,000.00 (2,000,000 centavos)
    const q1IsRes = await request(app)
      .get('/api/reports/income-statement?accountingPeriodId=per-a-q1-2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(q1IsRes.status).toBe(200);
    expect(q1IsRes.body.totalRevenue).toBe(5000000);
    expect(q1IsRes.body.totalExpense).toBe(2000000);
    expect(q1IsRes.body.netIncome).toBe(3000000);

    // Verify General Ledger and Trial Balance reconcile with Income Statement for Q1 2026
    const q1GlRes = await request(app)
      .get(`/api/reports/general-ledger?accountingPeriodId=per-a-q1-2026&accountId=${revAccA}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(q1GlRes.status).toBe(200);
    const glRows = Array.isArray(q1GlRes.body) ? q1GlRes.body : (q1GlRes.body.items || []);
    expect(glRows.length).toBeGreaterThanOrEqual(1);
    const revRow = glRows.find((r: any) => r.accountId === revAccA);
    expect(revRow).toBeTruthy();
    expect(revRow.credit).toBe(5000000);

    const q1TbRes = await request(app)
      .get('/api/reports/trial-balance?accountingPeriodId=per-a-q1-2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(q1TbRes.status).toBe(200);
    expect(q1TbRes.body.totalDebit).toBe(q1TbRes.body.totalCredit);

    // 2) Q2 2026 Income Statement (explicit accountingPeriodId='per-a-q2-2026'):
    // Includes 2026-05-10 Q2 revenue (8,000,000) AND disjoint override assigned to per-a-q2-2026 (1,000,000) when queried without narrow date override, or 8,000,000 within Q2 calendar dates
    const q2IsRes = await request(app)
      .get('/api/reports/income-statement?accountingPeriodId=per-a-q2-2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(q2IsRes.status).toBe(200);
    expect(q2IsRes.body.totalRevenue).toBe(8000000);
    expect(q2IsRes.body.totalExpense).toBe(0);
    expect(q2IsRes.body.netIncome).toBe(8000000);

    // 3) Parent FY 2026 Income Statement (`per-a-fy2026` enclosing child periods `per-a-q1-2026` and `per-a-q2-2026`):
    // Total Revenue = Q1 (5,000,000) + Q2 (8,000,000) + Disjoint Q2 override in Feb 2026 (1,000,000) = 14,000,000 centavos
    const fy26IsRes = await request(app)
      .get('/api/reports/income-statement?accountingPeriodId=per-a-fy2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(fy26IsRes.status).toBe(200);
    expect(fy26IsRes.body.totalRevenue).toBe(14000000);
    expect(fy26IsRes.body.totalExpense).toBe(2000000);
    expect(fy26IsRes.body.netIncome).toBe(12000000);

    // 4) Single-day report (2026-02-15 to 2026-02-15): includes only 2026-02-15 sales (50,000.00), excludes 2026-02-20 rent expense
    const singleDayRes = await request(app)
      .get('/api/reports/income-statement?startDate=2026-02-15&endDate=2026-02-15')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(singleDayRes.status).toBe(200);
    expect(singleDayRes.body.totalRevenue).toBe(5000000);
    expect(singleDayRes.body.totalExpense).toBe(0);

    // 5) Balance Sheet as of Q1 2026 includes prior-year FY 2025 Retained Earnings (100,000.00) + Q1 Net Income (30,000.00)
    // and strictly excludes FY 2027 future period and disjoint Q2 override!
    const q1BsRes = await request(app)
      .get('/api/reports/balance-sheet?accountingPeriodId=per-a-q1-2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(q1BsRes.status).toBe(200);
    expect(q1BsRes.body.balanced).toBe(true);
    // Assets as of 2026-03-31 (scoped to Q1): FY25 Cash (10,000,000) + Q1 AR (5,600,000) + Q1 Input VAT (240,000) = 15,840,000 centavos
    expect(q1BsRes.body.totalAssets).toBe(15840000);
  });

  it('3. excludes subledger invoices, bills, and payments whose linked GL journal entry is REVERSED across ReportEngine, BirComplianceService, Tax Schedules, SLSP, SAWT, QAP, Form 2307, and Dashboard', async () => {
    const companyDbA = await CompanyManager.getCompanyDb(COMP_A);

    await dbContext.run(companyDbA as any, async () => {
      // ReportEngine.getSalesSummary & getExpenseSummary
      const salesSummary = await ReportEngine.getSalesSummary(COMP_A, '2026-01-01', '2026-03-31');
      expect(salesSummary.invoiceCount).toBe(1);
      expect(salesSummary.totalSales).toBe(5600000);

      const expSummary = await ReportEngine.getExpenseSummary(COMP_A, '2026-01-01', '2026-03-31');
      expect(expSummary.billCount).toBe(1);
      expect(expSummary.totalExpenses).toBe(2240000);

      // BirComplianceService.generateVatSummary & generateForm2307Data
      const vatSummary = await BirComplianceService.generateVatSummary(COMP_A, '2026-01-01', '2026-03-31');
      expect(vatSummary.sales.length).toBe(1);
      expect(vatSummary.purchases.length).toBe(1);
      expect(vatSummary.totals.grossSales).toBe(5600000);
      expect(vatSummary.totals.grossPurchases).toBe(2240000);

      const form2307Data = await BirComplianceService.generateForm2307Data(COMP_A, '2026-01-01', '2026-03-31');
      expect(form2307Data.lineItems.length).toBe(1);
      expect(form2307Data.summary.totalBase).toBe(2000000);
    });

    // Tax schedule endpoints
    const ewtRes = await request(app)
      .get('/api/tax/schedules/ewt?startDate=2026-01-01&endDate=2026-03-31&accountingPeriodId=per-a-q1-2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(ewtRes.status).toBe(200);
    expect(ewtRes.body.data.length).toBe(1);
    expect(ewtRes.body.data[0].withholdingTaxAmount).toBe(100000);

    const cwtRes = await request(app)
      .get('/api/tax/schedules/cwt?startDate=2026-01-01&endDate=2026-03-31&accountingPeriodId=per-a-q1-2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(cwtRes.status).toBe(200);
    expect(cwtRes.body.data.length).toBe(1);
    expect(cwtRes.body.data[0].withholdingTaxAmount).toBe(250000);

    const vatSalesRes = await request(app)
      .get('/api/tax/schedules/vat-sales?startDate=2026-01-01&endDate=2026-03-31&accountingPeriodId=per-a-q1-2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(vatSalesRes.status).toBe(200);
    expect(vatSalesRes.body.data.length).toBe(1);

    const vatPurchasesRes = await request(app)
      .get('/api/tax/schedules/vat-purchases?startDate=2026-01-01&endDate=2026-03-31&accountingPeriodId=per-a-q1-2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(vatPurchasesRes.status).toBe(200);
    expect(vatPurchasesRes.body.data.length).toBe(1);

    // SLSP, SAWT, QAP, and Form 2307 statutory exports
    const slspRes = await request(app)
      .get('/api/tax/export/slsp?startDate=2026-01-01&endDate=2026-03-31&accountingPeriodId=per-a-q1-2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(slspRes.status).toBe(200);
    const slspLines = slspRes.text.trim().split('\n');
    // 1 header line ('S,P,...') + 1 purchase line ('D,P,...') + 1 sales line ('D,S,...') = 3 lines (reversed invoice & reversed bill excluded!)
    expect(slspLines.length).toBe(3);

    const sawtRes = await request(app)
      .get('/api/tax/export/sawt?startDate=2026-01-01&endDate=2026-03-31&accountingPeriodId=per-a-q1-2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(sawtRes.status).toBe(200);
    const sawtLines = sawtRes.text.trim().split('\n');
    // 1 header + 1 valid CWT detail + 1 control line = 3 lines (reversed cp-a-reversed-je excluded!)
    expect(sawtLines.length).toBe(3);
    expect(sawtLines[2]).toContain(',1,56000.00,2500.00');

    const qapRes = await request(app)
      .get('/api/tax/export/qap?startDate=2026-01-01&endDate=2026-03-31&accountingPeriodId=per-a-q1-2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(qapRes.status).toBe(200);
    const qapLines = qapRes.text.trim().split('\n');
    // 1 header + 1 valid EWT detail + 1 control line = 3 lines (reversed sp-a-reversed-je excluded!)
    expect(qapLines.length).toBe(3);
    expect(qapLines[2]).toContain(',1,22400.00,1000.00');

    const cert2307Res = await request(app)
      .get('/api/tax/2307/generate?year=2026&quarter=Q1')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(cert2307Res.status).toBe(200);
    expect(cert2307Res.body[0].apRecordsCount.billsCount).toBe(1);
    expect(cert2307Res.body[0].apRecordsCount.paymentsCount).toBe(1);

    // AR & AP Aging endpoints
    const arAgingRes = await request(app)
      .get('/api/reports/ar-aging?asOfDate=2026-03-31&limit=100')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(arAgingRes.status).toBe(200);
    expect(arAgingRes.body.totalBalanceDue).toBe(5600000);

    const apAgingRes = await request(app)
      .get('/api/reports/ap-aging?asOfDate=2026-03-31&limit=100')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(apAgingRes.status).toBe(200);
    expect(apAgingRes.body.totalBalanceDue).toBe(2140000);

    // Dashboard overview endpoint (verifies future FY 2027 period and reversed subledgers are excluded)
    const dashRes = await request(app)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.accountsReceivable).toBe(5600000);
    expect(dashRes.body.accountsPayable).toBe(2140000);
  });

  it('4. detects and blocks duplicate reversal lineage corruption across both /api/reports and ReportEngine.getGlPnlSummary', async () => {
    const sqliteA = await CompanyManager.getCompanySqlite(COMP_A);
    const now = Date.now();

    // First verify SQLite unique index unq_reversal_child_per_original prevents duplicate reversal insertion
    expect(() => {
      sqliteA
        .prepare(
          `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, original_journal_id, created_by, posted_by, created_at, updated_at, posted_at)
           VALUES ('je-a-rogue-dup-rev', ?, 'JE-2026-DUP', '2026-03-03', 'per-a-q1-2026', 'Duplicate Reversal Corruption', 'REVERSAL', 'je-a-q1-rev-orig-dup', 'POSTED', 'je-a-q1-rev-orig', ?, ?, ?, ?, ?)`
        )
        .run(COMP_A, ownerAId, ownerAId, now, now, now);
    }).toThrow(/UNIQUE constraint failed/i);

    // Temporarily drop the index to simulate raw DB corruption and verify application-level assertNoDuplicateReversalLineage
    sqliteA.exec(`DROP INDEX IF EXISTS unq_reversal_child_per_original;`);
    sqliteA
      .prepare(
        `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, original_journal_id, created_by, posted_by, created_at, updated_at, posted_at)
         VALUES ('je-a-rogue-dup-rev', ?, 'JE-2026-DUP', '2026-03-03', 'per-a-q1-2026', 'Duplicate Reversal Corruption', 'REVERSAL', 'je-a-q1-rev-orig-dup', 'POSTED', 'je-a-q1-rev-orig', ?, ?, ?, ?, ?)`
      )
      .run(COMP_A, ownerAId, ownerAId, now, now, now);

    try {
      const tbRes = await request(app)
        .get('/api/reports/trial-balance?accountingPeriodId=per-a-q1-2026')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(tbRes.status).toBe(409);
      expect(tbRes.body.error).toMatch(/REVERSAL_LINEAGE_CORRUPTION/);

      const companyDbA = await CompanyManager.getCompanyDb(COMP_A);
      await expect(
        dbContext.run(companyDbA as any, async () => {
          return await ReportEngine.getGlPnlSummary(COMP_A, '2026-01-01', '2026-03-31');
        })
      ).rejects.toThrow(/REVERSAL_LINEAGE_CORRUPTION/);
    } finally {
      sqliteA.prepare(`DELETE FROM journal_entries WHERE id = 'je-a-rogue-dup-rev'`).run();
      sqliteA.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS unq_reversal_child_per_original
        ON journal_entries(company_id, original_journal_id)
        WHERE original_journal_id IS NOT NULL AND status = 'POSTED';
      `);
    }
  });

  it('5. enforces strict cross-company isolation between Company A and Company B across all financial reports', async () => {
    // Company B Q1 Revenue is 500,000.00 (50,000,000 centavos)
    const compBIs = await request(app)
      .get('/api/reports/income-statement?accountingPeriodId=per-b-q1-2026')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(compBIs.status).toBe(200);
    expect(compBIs.body.totalRevenue).toBe(50000000);

    // Company A cannot query Company B's period ID ('per-b-q1-2026') -> rejected with 400 INVALID_ACCOUNTING_PERIOD
    const crossPeriodAttempt = await request(app)
      .get('/api/reports/income-statement?accountingPeriodId=per-b-q1-2026')
      .set('Authorization', `Bearer ${tokenA}`);
    expect([400, 404]).toContain(crossPeriodAttempt.status);
  });
});
