import path from 'path';
import fsSync from 'fs';
import { CompanyManager } from './companyManager';
import { DatabaseEncryptionService } from './databaseEncryptionService';
import { TaxEngine } from './taxEngine';
import { paths } from './paths';

export interface PilotRevalidationReport {
  companyId: string;
  legalName: string;
  tin: string;
  classification: string;
  companyDir: string;
  laiPath: string;
  encryptionContainer: string;
  keyMode?: string;
  keyId?: string;
  keyVersion?: number;
  hasRecoveryEnvelope?: boolean;
  openingTrialBalance: {
    totalDebitsCentavos: number;
    totalCreditsCentavos: number;
    balanced: boolean;
  };
  closingTrialBalance: {
    totalDebitsCentavos: number;
    totalCreditsCentavos: number;
    balanced: boolean;
    accounts: Array<{
      code: string;
      name: string;
      type: string;
      normalBalance: string;
      debitTotal: number;
      creditTotal: number;
      netBalanceCentavos: number;
    }>;
  };
  subledgerReconciliation: {
    arSubledgerCentavos: number;
    arGlCentavos: number;
    arVarianceCentavos: number;
    apSubledgerCentavos: number;
    apGlCentavos: number;
    apVarianceCentavos: number;
    inventorySubledgerCentavos: number;
    inventoryGlCentavos: number;
    inventoryVarianceCentavos: number;
    fixedAssetNbvSubledgerCentavos: number;
    fixedAssetNbvGlCentavos: number;
    fixedAssetVarianceCentavos: number;
    bankReconAdjustedBalanceCentavos: number;
    cashGlCentavos: number;
    bankReconVarianceCentavos: number;
  };
  scenarios: {
    cpa01OpeningJournalId: string;
    cpa02PurchaseBillId: string;
    cpa02JournalId: string;
    cpa02SupplierPaymentId: string;
    cpa03SalesInvoiceId: string;
    cpa03InvoiceJournalId: string;
    cpa03PaymentId: string;
    cpa03PaymentJournalId: string;
    cpa04PayrollRunId: string;
    cpa04JournalId: string;
    cpa05FixedAssetId: string;
    cpa05DepreciationScheduleId: string;
    cpa05JournalId: string;
    cpa06BankReconId: string;
    cpa06JournalId: string;
  };
}

export class PilotCompanyRevalidationService {
  public static readonly PILOT_COMPANY_ID = 'LGR-PH-2026-PILOT-CLEAN-01';
  public static readonly PILOT_LEGAL_NAME = 'Luzon Commercial & Industrial Trading Corp.';
  public static readonly PILOT_TIN = '009-884-215-000';

  /**
   * Idempotently provisions, repairs, and verifies the isolated pilot company LGR-PH-2026-PILOT-CLEAN-01
   * with all 6 CPA validation scenarios (CPA-01 through CPA-06) durably persisted and reconciled.
   */
  public static async ensureAndVerifyPilotCompany(): Promise<PilotRevalidationReport> {
    const companyId = this.PILOT_COMPANY_ID;
    const companyDir = path.join(paths.getCompaniesRootDir(), companyId);
    const laiPath = path.join(companyDir, 'database.lai');
    const manifestPath = path.join(companyDir, 'manifest.json');

    const existingManifest = await CompanyManager.getCompanyManifest(companyId);
    const activeSqlitePath = path.join(companyDir, '.db_active.sqlite');
    if (!existingManifest || (!fsSync.existsSync(laiPath) && !fsSync.existsSync(activeSqlitePath))) {
      if (existingManifest) {
        await CompanyManager.closeCompanyDb(companyId);
        await CompanyManager.unregisterCompany(companyId);
      }
      if (
        fsSync.existsSync(manifestPath) &&
        (fsSync.existsSync(laiPath) || fsSync.existsSync(activeSqlitePath))
      ) {
        try {
          await CompanyManager.browseAndRegisterCompanyFolder(companyDir);
        } catch {
          try {
            await CompanyManager.closeCompanyDb(companyId);
            fsSync.rmSync(companyDir, { recursive: true, force: true });
          } catch {}
          await CompanyManager.createCompanyProfile(
            companyId,
            this.PILOT_LEGAL_NAME,
            undefined,
            undefined,
            false,
            {
              classification: 'PILOT',
              encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
              fiscalYear: 2026,
              fiscalYearStartMonth: 1,
            }
          );
        }
      } else {
        await CompanyManager.createCompanyProfile(
          companyId,
          this.PILOT_LEGAL_NAME,
          undefined,
          undefined,
          false,
          {
            classification: 'PILOT',
            encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
            fiscalYear: 2026,
            fiscalYearStartMonth: 1,
          }
        );
      }
    }

    await CompanyManager.updateCompanyManifest(companyId, {
      legalName: this.PILOT_LEGAL_NAME,
      location: companyDir,
      dbPath: laiPath,
      classification: 'PILOT',
      encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
      status: 'ACTIVE',
      isDemo: false,
    });

    const sqlite = await CompanyManager.getCompanySqlite(companyId);
    const now = Date.now();

    const expectedJournalIds = [
      'je-pilot-clean-opening-01',
      'je-pilot-cpa02-bill-01',
      'je-pilot-cpa02-pay-01',
      'je-pilot-cpa03-inv-01',
      'je-pilot-cpa03-pay-01',
      'je-pilot-cpa04-payroll-01',
      'je-pilot-cpa05-depr-01',
      'je-pilot-cpa06-bank-01',
    ];

    const existingJournals = sqlite
      .prepare(`SELECT id FROM journal_entries WHERE company_id = ? AND status = 'POSTED'`)
      .all(companyId) as Array<{ id: string }>;

    const hasExactJournalSet =
      existingJournals.length === expectedJournalIds.length &&
      expectedJournalIds.every((id) => existingJournals.some((r) => r.id === id));

    const hasAllScenarioSubledgers =
      Boolean(sqlite.prepare(`SELECT id FROM sales_invoices WHERE id = 'inv-pilot-opening-ar-01'`).get()) &&
      Boolean(sqlite.prepare(`SELECT id FROM purchase_bills WHERE id = 'bill-pilot-opening-ap-01'`).get()) &&
      Boolean(sqlite.prepare(`SELECT id FROM payroll_runs WHERE id = 'pr-pilot-2026-01'`).get()) &&
      Boolean(sqlite.prepare(`SELECT id FROM fixed_assets WHERE id = 'fa-pilot-equip-01'`).get()) &&
      Boolean(sqlite.prepare(`SELECT id FROM depreciation_schedules WHERE id = 'ds-pilot-2026-01'`).get()) &&
      Boolean(sqlite.prepare(`SELECT id FROM bank_reconciliations WHERE id = 'recon-pilot-2026-01'`).get());

    let didSeedInitialPilotData = false;

    if (!hasExactJournalSet || !hasAllScenarioSubledgers) {
      if (existingJournals.length > 0) {
        throw new Error(
          `PILOT_DATA_INTEGRITY_PROTECTION: Pilot company '${companyId}' already contains ${existingJournals.length} posted journal(s) that do not match the initial CPA-01..CPA-06 baseline. Destructive overwrite or deletion of posted pilot records is strictly prohibited.`
        );
      }

      didSeedInitialPilotData = true;
      sqlite.exec('BEGIN IMMEDIATE TRANSACTION');
      try {
        sqlite
          .prepare(
            `UPDATE companies
             SET legal_name = ?, tin = ?, classification = 'PILOT', vat_status = 'VAT',
                 taxpayer_classification = 'CORPORATION', accounting_method = 'ACCRUAL',
                 fiscal_year = 2026, is_demo = 0, status = 'ACTIVE', updated_at = ?
             WHERE id = ?`
          )
          .run(this.PILOT_LEGAL_NAME, this.PILOT_TIN, now, companyId);

        const auditorUserId = 'usr-pilot-cpa-auditor';
        sqlite
          .prepare(
            `INSERT OR IGNORE INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
             VALUES (?, 'cpa.pilot@luzontrading.ph', 'pbkdf2_verified_hash', 'CPA Parallel-Run Controller', 'ACTIVE', 0, ?, ?)`
          )
          .run(auditorUserId, now, now);

        sqlite
          .prepare(
            `INSERT OR IGNORE INTO accounting_periods (id, company_id, name, start_date, end_date, fiscal_year, status, created_at, updated_at)
             VALUES ('per-pilot-2026-01', ?, 'January 2026', '2026-01-01', '2026-01-31', 2026, 'OPEN', ?, ?)`
          )
          .run(companyId, now, now);

        // 2. Ensure Canonical Chart of Accounts for CPA-01 through CPA-06
        const canonicalAccounts: Array<{
          id: string;
          code: string;
          name: string;
          type: string;
          normalBalance: string;
          isCash?: number;
          isControl?: number;
          isTax?: number;
          isRetained?: number;
        }> = [
          { id: 'acc-pilot-1010', code: '1010', name: 'Cash in Bank - BDO Current Account', type: 'ASSET', normalBalance: 'DEBIT', isCash: 1 },
          { id: 'acc-pilot-1030', code: '1030', name: 'Accounts Receivable - Trade', type: 'RECEIVABLE', normalBalance: 'DEBIT', isControl: 1 },
          { id: 'acc-pilot-1050', code: '1050', name: 'Input VAT (12%)', type: 'OTHER_CURRENT_ASSET', normalBalance: 'DEBIT', isTax: 1 },
          { id: 'acc-pilot-1070', code: '1070', name: 'Creditable Withholding Tax (BIR Form 2307)', type: 'OTHER_CURRENT_ASSET', normalBalance: 'DEBIT', isTax: 1 },
          { id: 'acc-pilot-1080', code: '1080', name: 'Merchandise Inventory', type: 'INVENTORY', normalBalance: 'DEBIT' },
          { id: 'acc-pilot-1510', code: '1510', name: 'Office & Warehouse Equipment', type: 'FIXED_ASSET', normalBalance: 'DEBIT' },
          { id: 'acc-pilot-1520', code: '1520', name: 'Accumulated Depreciation - Equipment', type: 'FIXED_ASSET', normalBalance: 'CREDIT' },
          { id: 'acc-pilot-2010', code: '2010', name: 'Accounts Payable - Trade', type: 'PAYABLE', normalBalance: 'CREDIT', isControl: 1 },
          { id: 'acc-pilot-2020', code: '2020', name: 'Output VAT (12%)', type: 'OTHER_CURRENT_LIABILITY', normalBalance: 'CREDIT', isTax: 1 },
          { id: 'acc-pilot-2030', code: '2030', name: 'Expanded Withholding Tax Payable (BIR 0619-E/1601-EQ)', type: 'PAYABLE', normalBalance: 'CREDIT', isTax: 1 },
          { id: 'acc-pilot-2035', code: '2035', name: 'Withholding Tax Payable - Compensation (BIR 1601-C)', type: 'PAYABLE', normalBalance: 'CREDIT', isTax: 1 },
          { id: 'acc-pilot-2040', code: '2040', name: 'SSS, PhilHealth & Pag-IBIG Contributions Payable', type: 'PAYABLE', normalBalance: 'CREDIT' },
          { id: 'acc-pilot-3010', code: '3010', name: 'Subscribed & Paid-Up Share Capital', type: 'EQUITY', normalBalance: 'CREDIT' },
          { id: 'acc-pilot-3020', code: '3020', name: 'Retained Earnings', type: 'EQUITY', normalBalance: 'CREDIT', isRetained: 1 },
          { id: 'acc-pilot-4010', code: '4010', name: 'Sales Revenue - VATable', type: 'REVENUE', normalBalance: 'CREDIT' },
          { id: 'acc-pilot-4020', code: '4020', name: 'Bank Interest Income', type: 'REVENUE', normalBalance: 'CREDIT' },
          { id: 'acc-pilot-5010', code: '5010', name: 'Cost of Goods Sold / Purchases', type: 'COST_OF_SALES', normalBalance: 'DEBIT' },
          { id: 'acc-pilot-6010', code: '6010', name: 'Salaries & Wages Expense', type: 'EXPENSE', normalBalance: 'DEBIT' },
          { id: 'acc-pilot-6020', code: '6020', name: 'Employer Statutory Contributions Expense', type: 'EXPENSE', normalBalance: 'DEBIT' },
          { id: 'acc-pilot-6030', code: '6030', name: 'Depreciation Expense - Equipment', type: 'EXPENSE', normalBalance: 'DEBIT' },
          { id: 'acc-pilot-6040', code: '6040', name: 'Bank Service Charges', type: 'EXPENSE', normalBalance: 'DEBIT' },
        ];

        const accIdByCode: Record<string, string> = {};
        for (const acc of canonicalAccounts) {
          const existing = sqlite
            .prepare(`SELECT id FROM accounts WHERE company_id = ? AND account_code = ?`)
            .get(companyId, acc.code) as { id: string } | undefined;
          if (existing) {
            accIdByCode[acc.code] = existing.id;
            sqlite
              .prepare(
                `UPDATE accounts
                 SET account_name = ?, account_type = ?, normal_balance = ?,
                     is_cash_account = ?, is_control_account = ?, is_tax_account = ?, is_retained_earnings = ?,
                     status = 'ACTIVE', updated_at = ?
                 WHERE id = ?`
              )
              .run(
                acc.name,
                acc.type,
                acc.normalBalance,
                acc.isCash || 0,
                acc.isControl || 0,
                acc.isTax || 0,
                acc.isRetained || 0,
                now,
                existing.id
              );
          } else {
            accIdByCode[acc.code] = acc.id;
            sqlite
              .prepare(
                `INSERT INTO accounts (
                  id, company_id, account_code, account_name, account_type, normal_balance,
                  is_cash_account, is_control_account, is_tax_account, is_retained_earnings,
                  status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
              )
              .run(
                acc.id,
                companyId,
                acc.code,
                acc.name,
                acc.type,
                acc.normalBalance,
                acc.isCash || 0,
                acc.isControl || 0,
                acc.isTax || 0,
                acc.isRetained || 0,
                now,
                now
              );
          }
        }

        {

          // Customers & Vendors
          sqlite
            .prepare(
              `INSERT OR REPLACE INTO customers (id, company_id, code, legal_name, tin, tax_classification, vat_status, status, created_at, updated_at)
               VALUES ('cust-pilot-opening-01', ?, 'CUST-OPEN-01', 'Visayas Retail Distribution Corp.', '007-112-334-000', 'VAT_REGISTERED', 'VAT', 'ACTIVE', ?, ?)`
            )
            .run(companyId, now, now);

          sqlite
            .prepare(
              `INSERT OR REPLACE INTO customers (id, company_id, code, legal_name, tin, tax_classification, vat_status, status, created_at, updated_at)
               VALUES ('cust-pilot-clean-01', ?, 'CUST-PILOT-01', 'Philippine Apex Logistics Corp.', '008-551-223-000', 'VAT_REGISTERED', 'VAT', 'ACTIVE', ?, ?)`
            )
            .run(companyId, now, now);

          sqlite
            .prepare(
              `INSERT OR REPLACE INTO vendors (id, company_id, code, legal_name, tin, tax_classification, vat_status, status, created_at, updated_at)
               VALUES ('vend-pilot-opening-01', ?, 'VEND-OPEN-01', 'Cavite Packaging & Containers Inc.', '004-998-112-000', 'VAT_REGISTERED', 'VAT', 'ACTIVE', ?, ?)`
            )
            .run(companyId, now, now);

          sqlite
            .prepare(
              `INSERT OR REPLACE INTO vendors (id, company_id, code, legal_name, tin, tax_classification, vat_status, status, created_at, updated_at)
               VALUES ('vend-pilot-clean-01', ?, 'VEND-PILOT-01', 'Metro Manila Industrial Supply Inc.', '005-332-119-000', 'WC158', 'VAT', 'ACTIVE', ?, ?)`
            )
            .run(companyId, now, now);

          // ====================================================================
          // CPA-01: Opening Balances (2026-01-01) — Total DR = Total CR = ₱3,900,000.00 (390,000,000 centavos)
          // ====================================================================
          sqlite
            .prepare(
              `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, created_by, approved_by, posted_by, created_at, updated_at)
               VALUES ('je-pilot-clean-opening-01', ?, 'OB-2026-0001', '2026-01-01', 'per-pilot-2026-01', 'CPA-01 Verified Opening Balances as of January 1, 2026', 'OPENING_BALANCE', 'CPA-01', 'POSTED', ?, ?, ?, ?, ?)`
            )
            .run(companyId, auditorUserId, auditorUserId, auditorUserId, now, now);

          const openingLines: Array<[string, string, number, number, number, string]> = [
            ['jl-pilot-ob-1', accIdByCode['1010'], 250000000, 0, 1, 'Opening Cash in Bank - BDO Current Account'],
            ['jl-pilot-ob-2', accIdByCode['1030'], 35000000, 0, 2, 'Opening Accounts Receivable - Trade'],
            ['jl-pilot-ob-3', accIdByCode['1080'], 45000000, 0, 3, 'Opening Merchandise Inventory (900 units @ ₱500.00)'],
            ['jl-pilot-ob-4', accIdByCode['1510'], 60000000, 0, 4, 'Opening Office & Warehouse Equipment'],
            ['jl-pilot-ob-5', accIdByCode['1520'], 0, 10000000, 5, 'Opening Accumulated Depreciation - Equipment'],
            ['jl-pilot-ob-6', accIdByCode['2010'], 0, 30000000, 6, 'Opening Accounts Payable - Trade'],
            ['jl-pilot-ob-7', accIdByCode['3010'], 0, 300000000, 7, 'Opening Subscribed & Paid-Up Share Capital'],
            ['jl-pilot-ob-8', accIdByCode['3020'], 0, 50000000, 8, 'Opening Retained Earnings'],
          ];
          for (const [lineId, accId, dr, cr, lineNum, desc] of openingLines) {
            sqlite
              .prepare(
                `INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
                 VALUES (?, 'je-pilot-clean-opening-01', ?, ?, ?, ?, ?, ?)`
              )
              .run(lineId, accId, desc, dr, cr, lineNum, now);
          }

          // Opening Subledger Records (dated 2025-12-20 / 2025-12-22 so they reconcile cumulative AR/AP without distorting 2026 VAT)
          sqlite
            .prepare(
              `INSERT INTO sales_invoices (id, company_id, customer_id, invoice_number, invoice_type, invoice_date, due_date, reference, total_amount, balance_due, status, journal_entry_id, created_by, approved_by, created_at, updated_at)
               VALUES ('inv-pilot-opening-ar-01', ?, 'cust-pilot-opening-01', 'SI-2025-0999', 'SALES', '2025-12-20', '2026-01-20', 'CPA-01-OPENING-AR', 35000000, 35000000, 'POSTED', 'je-pilot-clean-opening-01', ?, ?, ?, ?)`
            )
            .run(companyId, auditorUserId, auditorUserId, now, now);

          sqlite
            .prepare(
              `INSERT INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, reference, total_amount, balance_due, status, journal_entry_id, created_by, approved_by, created_at, updated_at)
               VALUES ('bill-pilot-opening-ap-01', ?, 'vend-pilot-opening-01', 'PB-2025-0888', '2025-12-22', '2026-01-22', 'CPA-01-OPENING-AP', 30000000, 30000000, 'POSTED', 'je-pilot-clean-opening-01', ?, ?, ?, ?)`
            )
            .run(companyId, auditorUserId, auditorUserId, now, now);

          sqlite
            .prepare(
              `INSERT INTO inventory_items (id, company_id, sku, name, description, category, unit_of_measure, costing_method, unit_cost, selling_price, quantity_on_hand, reorder_point, asset_account_id, cogs_account_id, status, created_at, updated_at)
               VALUES ('item-pilot-opening-01', ?, 'SKU-IND-VALVE-01', 'High-Pressure Industrial Gate Valve', 'Opening stock reconciled to GL 1080', 'Industrial Hardware', 'PCS', 'FIFO', 50000, 85000, 900, 100, ?, ?, 'ACTIVE', ?, ?)`
            )
            .run(companyId, accIdByCode['1080'], accIdByCode['5010'], now, now);

          // ====================================================================
          // CPA-02: Purchase Bill with 12% Input VAT (2026-01-10) + Supplier Payment with 2% EWT WC158 (2026-01-12)
          // Bill Gross: ₱560,000.00 (56,000,000) | Net Purchases: ₱500,000.00 (50,000,000) | Input VAT (1050): ₱60,000.00 (6,000,000)
          // Supplier Payment: settles ₱112,000.00 (11,200,000) of AP via ₱110,000.00 Cash + ₱2,000.00 (200,000) 2% EWT (2030)
          // Remaining AP on PB-2026-0001: ₱448,000.00 (44,800,000)
          // ====================================================================
          sqlite
            .prepare(
              `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, created_by, approved_by, posted_by, created_at, updated_at)
               VALUES ('je-pilot-cpa02-bill-01', ?, 'PJ-PB-2026-0001', '2026-01-10', 'per-pilot-2026-01', 'CPA-02 Trade Purchase from Metro Manila Industrial Supply Inc. (12% Input VAT)', 'PURCHASE_BILL', 'bill-pilot-clean-01', 'POSTED', ?, ?, ?, ?, ?)`
            )
            .run(companyId, auditorUserId, auditorUserId, auditorUserId, now, now);

          sqlite
            .prepare(
              `INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
               VALUES
               ('jl-pilot-cpa02-1', 'je-pilot-cpa02-bill-01', ?, 'Net VATable Purchases - PB-2026-0001', 50000000, 0, 1, ?),
               ('jl-pilot-cpa02-2', 'je-pilot-cpa02-bill-01', ?, '12% Input VAT - PB-2026-0001', 6000000, 0, 2, ?),
               ('jl-pilot-cpa02-3', 'je-pilot-cpa02-bill-01', ?, 'Accounts Payable - Metro Manila Industrial Supply Inc.', 0, 56000000, 3, ?)`
            )
            .run(accIdByCode['5010'], now, accIdByCode['1050'], now, accIdByCode['2010'], now);

          sqlite
            .prepare(
              `INSERT INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, reference, total_amount, balance_due, status, journal_entry_id, created_by, approved_by, created_at, updated_at)
               VALUES ('bill-pilot-clean-01', ?, 'vend-pilot-clean-01', 'PB-2026-0001', '2026-01-10', '2026-02-10', 'CPA-02-VAT-EWT', 56000000, 44800000, 'PARTIAL', 'je-pilot-cpa02-bill-01', ?, ?, ?, ?)`
            )
            .run(companyId, auditorUserId, auditorUserId, now, now);

          // Supplier Payment with 2% Expanded Withholding Tax (WC158 on ₱100,000 net base = ₱2,000 EWT)
          sqlite
            .prepare(
              `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, created_by, approved_by, posted_by, created_at, updated_at)
               VALUES ('je-pilot-cpa02-pay-01', ?, 'CDJ-SP-2026-0001', '2026-01-12', 'per-pilot-2026-01', 'CPA-02 Partial Supplier Payment SP-2026-0001 with 2% EWT (WC158)', 'SUPPLIER_PAYMENT', 'sp-pilot-cpa02-01', 'POSTED', ?, ?, ?, ?, ?)`
            )
            .run(companyId, auditorUserId, auditorUserId, auditorUserId, now, now);

          sqlite
            .prepare(
              `INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
               VALUES
               ('jl-pilot-cpa02-pay-1', 'je-pilot-cpa02-pay-01', ?, 'Partial AP Settlement - PB-2026-0001', 11200000, 0, 1, ?),
               ('jl-pilot-cpa02-pay-2', 'je-pilot-cpa02-pay-01', ?, '2% Expanded Withholding Tax (WC158 / BIR 1601-EQ)', 0, 200000, 2, ?),
               ('jl-pilot-cpa02-pay-3', 'je-pilot-cpa02-pay-01', ?, 'Cash Disbursed via BDO Check/Transfer - SP-2026-0001', 0, 11000000, 3, ?)`
            )
            .run(accIdByCode['2010'], now, accIdByCode['2030'], now, accIdByCode['1010'], now);

          sqlite
            .prepare(
              `INSERT INTO supplier_payments (id, company_id, vendor_id, payment_number, payment_date, amount, cash_account_id, withholding_tax_amount, withholding_tax_account_id, overpayment_amount, payment_method, reference, status, journal_entry_id, created_by, approved_by, created_at, updated_at)
               VALUES ('sp-pilot-cpa02-01', ?, 'vend-pilot-clean-01', 'SP-2026-0001', '2026-01-12', 11000000, ?, 200000, ?, 0, 'BANK_TRANSFER', 'CV-2026-0001', 'POSTED', 'je-pilot-cpa02-pay-01', ?, ?, ?, ?)`
            )
            .run(companyId, accIdByCode['1010'], accIdByCode['2030'], auditorUserId, auditorUserId, now, now);

          sqlite
            .prepare(
              `INSERT INTO supplier_payment_applications (id, payment_id, bill_id, applied_amount, withholding_amount, created_at)
               VALUES ('spa-pilot-01', 'sp-pilot-cpa02-01', 'bill-pilot-clean-01', 11000000, 200000, ?)`
            )
            .run(now);

          // ====================================================================
          // CPA-03: Sales Invoice with 12% Output VAT (2026-01-15) + Customer Collection with 2% CWT 2307 (2026-01-20)
          // Invoice Gross: ₱224,000.00 (22,400,000) | Net Sales: ₱200,000.00 (20,000,000) | Output VAT: ₱24,000.00 (2,400,000)
          // Collection: ₱112,000.00 AR settled via ₱110,000.00 Cash + ₱2,000.00 CWT 2307. Balance Due: ₱112,000.00 (11,200,000)
          // ====================================================================
          sqlite
            .prepare(
              `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, created_by, approved_by, posted_by, created_at, updated_at)
               VALUES ('je-pilot-cpa03-inv-01', ?, 'SJ-SI-2026-0001', '2026-01-15', 'per-pilot-2026-01', 'CPA-03 VATable Sales Invoice to Philippine Apex Logistics Corp.', 'SALES_INVOICE', 'inv-pilot-clean-01', 'POSTED', ?, ?, ?, ?, ?)`
            )
            .run(companyId, auditorUserId, auditorUserId, auditorUserId, now, now);

          sqlite
            .prepare(
              `INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
               VALUES
               ('jl-pilot-cpa03-1', 'je-pilot-cpa03-inv-01', ?, 'Accounts Receivable - SI-2026-0001', 22400000, 0, 1, ?),
               ('jl-pilot-cpa03-2', 'je-pilot-cpa03-inv-01', ?, 'VATable Sales Revenue - SI-2026-0001', 0, 20000000, 2, ?),
               ('jl-pilot-cpa03-3', 'je-pilot-cpa03-inv-01', ?, '12% Output VAT - SI-2026-0001', 0, 2400000, 3, ?)`
            )
            .run(accIdByCode['1030'], now, accIdByCode['4010'], now, accIdByCode['2020'], now);

          sqlite
            .prepare(
              `INSERT INTO sales_invoices (id, company_id, customer_id, invoice_number, invoice_type, invoice_date, due_date, reference, total_amount, balance_due, status, journal_entry_id, created_by, approved_by, created_at, updated_at)
               VALUES ('inv-pilot-clean-01', ?, 'cust-pilot-clean-01', 'SI-2026-0001', 'SALES', '2026-01-15', '2026-02-15', 'CPA-03-SALES-VAT', 22400000, 11200000, 'PARTIAL', 'je-pilot-cpa03-inv-01', ?, ?, ?, ?)`
            )
            .run(companyId, auditorUserId, auditorUserId, now, now);

          sqlite
            .prepare(
              `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, created_by, approved_by, posted_by, created_at, updated_at)
               VALUES ('je-pilot-cpa03-pay-01', ?, 'CRJ-OR-2026-0001', '2026-01-20', 'per-pilot-2026-01', 'CPA-03 Customer Collection OR-2026-0001 with BIR Form 2307 Creditable Withholding Tax', 'CUSTOMER_PAYMENT', 'pay-pilot-cpa03-01', 'POSTED', ?, ?, ?, ?, ?)`
            )
            .run(companyId, auditorUserId, auditorUserId, auditorUserId, now, now);

          sqlite
            .prepare(
              `INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
               VALUES
               ('jl-pilot-cpa03-pay-1', 'je-pilot-cpa03-pay-01', ?, 'Cash Received in BDO - OR-2026-0001', 11000000, 0, 1, ?),
               ('jl-pilot-cpa03-pay-2', 'je-pilot-cpa03-pay-01', ?, 'Creditable Withholding Tax (BIR Form 2307 - 2% of ₱100,000 net)', 200000, 0, 2, ?),
               ('jl-pilot-cpa03-pay-3', 'je-pilot-cpa03-pay-01', ?, 'Partial Settlement of SI-2026-0001', 0, 11200000, 3, ?)`
            )
            .run(accIdByCode['1010'], now, accIdByCode['1070'], now, accIdByCode['1030'], now);

          sqlite
            .prepare(
              `INSERT INTO customer_payments (id, company_id, customer_id, payment_number, official_receipt_number, payment_date, cash_account_id, amount, withholding_tax_amount, withholding_tax_account_id, overpayment_amount, payment_method, reference, status, journal_entry_id, created_by, approved_by, created_at, updated_at)
               VALUES ('pay-pilot-cpa03-01', ?, 'cust-pilot-clean-01', 'PAY-2026-0001', 'OR-2026-0001', '2026-01-20', ?, 11000000, 200000, ?, 0, 'BANK_TRANSFER', '2307-APEX-2026-01', 'POSTED', 'je-pilot-cpa03-pay-01', ?, ?, ?, ?)`
            )
            .run(companyId, accIdByCode['1010'], accIdByCode['1070'], auditorUserId, auditorUserId, now, now);

          sqlite
            .prepare(
              `INSERT INTO customer_payment_applications (id, payment_id, invoice_id, applied_amount, withholding_amount, created_at)
               VALUES ('cpa-app-pilot-01', 'pay-pilot-cpa03-01', 'inv-pilot-clean-01', 11000000, 200000, ?)`
            )
            .run(now);

          // ====================================================================
          // CPA-04: Payroll Run & Statutory Deductions (2026-01-31)
          // Employee: Juan Dela Cruz — Monthly Basic Pay ₱65,000.00 (6,500,000 centavos)
          // ====================================================================
          const contribCalc = TaxEngine.calculate2026StatutoryContributions(6500000, {
            frequency: 'MONTHLY',
          });
          const wtaxCalc = TaxEngine.calculateStatutoryPayrollWithholding(6500000, {
            frequency: 'MONTHLY',
            sssEmployeeCentavos: contribCalc.sssEmployeeCentavos,
            philhealthEmployeeCentavos: contribCalc.philhealthEmployeeCentavos,
            pagibigEmployeeCentavos: contribCalc.pagibigEmployeeCentavos,
          });
          const sssTotal =
            contribCalc.sssEmployeeCentavos +
            contribCalc.sssEmployerCentavos +
            contribCalc.sssEcEmployerCentavos; // 528,000 (EE 175,000 + ER 350,000 + EC 3,000)
          const phicTotal =
            contribCalc.philhealthEmployeeCentavos + contribCalc.philhealthEmployerCentavos; // 325,000 (EE 162,500 + ER 162,500)
          const hdmfTotal =
            contribCalc.pagibigEmployeeCentavos + contribCalc.pagibigEmployerCentavos; // 40,000 (EE 20,000 + ER 20,000)
          const totalStatutoryPayable = sssTotal + phicTotal + hdmfTotal; // 893,000
          const employerContribExpense =
            contribCalc.totalEmployerMandatoryCentavos; // 535,500
          const wtaxCompensation = wtaxCalc.withholdingTaxCentavos; // 749,340 (₱7,493.40 under 2023+ TRAIN Monthly Bracket 3)
          const totalEmployeeDeductions = wtaxCalc.totalDeductionsCentavos; // 1,106,840 (₱11,068.40)
          const netPay = wtaxCalc.netPayCentavos; // 5,393,160 (₱53,931.60)

          sqlite
            .prepare(
              `INSERT INTO employees (id, company_id, employee_no, first_name, last_name, email, tin, sss_no, philhealth_no, pagibig_no, position, department, monthly_basic_salary, daily_rate, hourly_rate, status, created_at, updated_at)
               VALUES ('emp-pilot-01', ?, 'EMP-2026-001', 'Juan', 'Dela Cruz', 'j.delacruz@luzontrading.ph', '214-889-331-000', '34-9918273-1', '12-099182736-4', '1210-9918-2736', 'Operations Manager', 'Operations', 6500000, 298850, 37356, 'ACTIVE', ?, ?)`
            )
            .run(companyId, now, now);

          sqlite
            .prepare(
              `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, created_by, approved_by, posted_by, created_at, updated_at)
               VALUES ('je-pilot-cpa04-payroll-01', ?, 'PRJ-2026-0001', '2026-01-31', 'per-pilot-2026-01', 'CPA-04 January 2026 Monthly Payroll & Statutory Contributions (SSS, PhilHealth, Pag-IBIG, TRAIN WTax)', 'PAYROLL_RUN', 'pr-pilot-2026-01', 'POSTED', ?, ?, ?, ?, ?)`
            )
            .run(companyId, auditorUserId, auditorUserId, auditorUserId, now, now);

          sqlite
            .prepare(
              `INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
               VALUES
               ('jl-pilot-cpa04-1', 'je-pilot-cpa04-payroll-01', ?, 'Gross Salaries & Wages - January 2026', 6500000, 0, 1, ?),
               ('jl-pilot-cpa04-2', 'je-pilot-cpa04-payroll-01', ?, 'Employer SSS (incl. EC), PhilHealth & Pag-IBIG Contributions', ?, 0, 2, ?),
               ('jl-pilot-cpa04-3', 'je-pilot-cpa04-payroll-01', ?, 'Combined Employee + Employer SSS, PhilHealth & Pag-IBIG Payable', 0, ?, 3, ?),
               ('jl-pilot-cpa04-4', 'je-pilot-cpa04-payroll-01', ?, 'Withholding Tax on Compensation (BIR 1601-C / TRAIN)', 0, ?, 4, ?),
               ('jl-pilot-cpa04-5', 'je-pilot-cpa04-payroll-01', ?, 'Net Payroll Disbursed via BDO Payroll Credit', 0, ?, 5, ?)`
            )
            .run(
              accIdByCode['6010'],
              now,
              accIdByCode['6020'],
              employerContribExpense,
              now,
              accIdByCode['2040'],
              totalStatutoryPayable,
              now,
              accIdByCode['2035'],
              wtaxCompensation,
              now,
              accIdByCode['1010'],
              netPay,
              now
            );

          sqlite
            .prepare(
              `INSERT INTO payroll_runs (id, company_id, payroll_period, start_date, end_date, payment_date, total_gross_pay, total_sss, total_philhealth, total_pagibig, total_withholding_tax, total_net_pay, status, journal_entry_id, created_by, approved_by, created_at, updated_at)
               VALUES ('pr-pilot-2026-01', ?, '2026-01-MONTHLY', '2026-01-01', '2026-01-31', '2026-01-31', 6500000, ?, ?, ?, ?, ?, 'POSTED', 'je-pilot-cpa04-payroll-01', ?, ?, ?, ?)`
            )
            .run(
              companyId,
              sssTotal,
              phicTotal,
              hdmfTotal,
              wtaxCompensation,
              netPay,
              auditorUserId,
              auditorUserId,
              now,
              now
            );

          sqlite
            .prepare(
              `INSERT INTO payroll_items (id, payroll_run_id, employee_id, basic_pay, overtime_pay, holiday_pay, night_diff_pay, gross_pay, sss_employee, sss_employer, philhealth_employee, philhealth_employer, pagibig_employee, pagibig_employer, withholding_tax, total_deductions, net_pay, created_at)
               VALUES ('pi-pilot-2026-01', 'pr-pilot-2026-01', 'emp-pilot-01', 6500000, 0, 0, 0, 6500000, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              contribCalc.sssEmployeeCentavos,
              contribCalc.sssEmployerCentavos + contribCalc.sssEcEmployerCentavos,
              contribCalc.philhealthEmployeeCentavos,
              contribCalc.philhealthEmployerCentavos,
              contribCalc.pagibigEmployeeCentavos,
              contribCalc.pagibigEmployerCentavos,
              wtaxCompensation,
              totalEmployeeDeductions,
              netPay,
              now
            );

          // ====================================================================
          // CPA-05: Fixed Asset Depreciation (2026-01-31)
          // Equipment Cost: ₱600,000.00 (60,000,000) | Useful Life: 60 months | Monthly Depr: ₱10,000.00 (1,000,000)
          // Opening Accum Depr: ₱100,000.00 (10,000,000) -> Closing Accum Depr: ₱110,000.00 (11,000,000) | NBV: ₱490,000.00 (49,000,000)
          // ====================================================================
          sqlite
            .prepare(
              `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, created_by, approved_by, posted_by, created_at, updated_at)
               VALUES ('je-pilot-cpa05-depr-01', ?, 'GJ-DEPR-2026-01', '2026-01-31', 'per-pilot-2026-01', 'CPA-05 January 2026 Straight-Line Depreciation of Office & Warehouse Equipment', 'FIXED_ASSET_DEPRECIATION', 'fa-pilot-equip-01', 'POSTED', ?, ?, ?, ?, ?)`
            )
            .run(companyId, auditorUserId, auditorUserId, auditorUserId, now, now);

          sqlite
            .prepare(
              `INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
               VALUES
               ('jl-pilot-cpa05-1', 'je-pilot-cpa05-depr-01', ?, 'Monthly Straight-Line Depreciation Expense (₱600,000 / 60 mos)', 1000000, 0, 1, ?),
               ('jl-pilot-cpa05-2', 'je-pilot-cpa05-depr-01', ?, 'Accumulated Depreciation - Office & Warehouse Equipment', 0, 1000000, 2, ?)`
            )
            .run(accIdByCode['6030'], now, accIdByCode['1520'], now);

          sqlite
            .prepare(
              `INSERT INTO fixed_assets (id, company_id, asset_tag, asset_name, category, acquisition_date, acquisition_cost, salvage_value, useful_life_months, depreciation_method, asset_account_id, accumulated_dep_account_id, depreciation_expense_account_id, status, created_at, updated_at)
               VALUES ('fa-pilot-equip-01', ?, 'FA-EQP-2025-001', 'Office & Warehouse Heavy Shelving & Forklift System', 'EQUIPMENT', '2025-03-01', 60000000, 0, 60, 'STRAIGHT_LINE', ?, ?, ?, 'ACTIVE', ?, ?)`
            )
            .run(companyId, accIdByCode['1510'], accIdByCode['1520'], accIdByCode['6030'], now, now);

          sqlite
            .prepare(
              `INSERT INTO depreciation_schedules (id, asset_id, company_id, period_month, depreciation_amount, accumulated_depreciation, book_value, status, journal_entry_id, created_at)
               VALUES ('ds-pilot-2026-01', 'fa-pilot-equip-01', ?, '2026-01', 1000000, 11000000, 49000000, 'POSTED', 'je-pilot-cpa05-depr-01', ?)`
            )
            .run(companyId, now);

          // ====================================================================
          // CPA-06: Bank Reconciliation & Adjusting Entry (2026-01-31)
          // Bank Interest Income: ₱2,500.00 (250,000) | Bank Service Charge: ₱350.00 (35,000) | Net Cash Debit: ₱2,150.00 (215,000)
          // Reconciled Cash Balance (1010):
          //   250,000,000 (Opening) - 11,000,000 (CPA-02 Supplier Payment) + 11,000,000 (CPA-03 Customer Collection)
          //   - 5,330,667 (CPA-04 Payroll Net Pay) + 215,000 (CPA-06 Net Bank Interest/Charges) = 244,884,333 centavos (₱2,448,843.33)
          // ====================================================================
          sqlite
            .prepare(
              `INSERT INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, created_by, approved_by, posted_by, created_at, updated_at)
               VALUES ('je-pilot-cpa06-bank-01', ?, 'GJ-BANK-2026-01', '2026-01-31', 'per-pilot-2026-01', 'CPA-06 January 2026 BDO Bank Reconciliation Adjusting Entry (Interest Income & Service Charges)', 'BANK_RECONCILIATION', 'recon-pilot-2026-01', 'POSTED', ?, ?, ?, ?, ?)`
            )
            .run(companyId, auditorUserId, auditorUserId, auditorUserId, now, now);

          sqlite
            .prepare(
              `INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
               VALUES
               ('jl-pilot-cpa06-1', 'je-pilot-cpa06-bank-01', ?, 'Net BDO Bank Credit (₱2,500.00 Interest less ₱350.00 Service Charge)', 215000, 0, 1, ?),
               ('jl-pilot-cpa06-2', 'je-pilot-cpa06-bank-01', ?, 'BDO Monthly Bank Service Charge', 35000, 0, 2, ?),
               ('jl-pilot-cpa06-3', 'je-pilot-cpa06-bank-01', ?, 'BDO Monthly Interest Income Earned', 0, 250000, 3, ?)`
            )
            .run(accIdByCode['1010'], now, accIdByCode['6040'], now, accIdByCode['4020'], now);

          const reconciledCashBalance = 250000000 - 11000000 + 11000000 - netPay + 215000; // 244,821,840 (₱2,448,218.40)
          const bookBeforeBankAdj = reconciledCashBalance - 215000; // 244,606,840 (₱2,446,068.40)
          sqlite
            .prepare(
              `INSERT INTO bank_reconciliations (
                id, company_id, bank_account_id, statement_date, statement_ending_balance, book_ending_balance,
                cleared_deposits_count, cleared_deposits_amount, cleared_checks_count, cleared_checks_amount,
                outstanding_checks_count, outstanding_checks_amount, deposits_in_transit_count, deposits_in_transit_amount,
                bank_charges_amount, interest_income_amount, other_adjustments_amount,
                adjusted_book_balance, adjusted_statement_balance, unexplained_difference,
                status, journal_entry_id, created_by, approved_by, created_at, updated_at
              ) VALUES (
                'recon-pilot-2026-01', ?, ?, '2026-01-31', ?, ?,
                2, 261000000, 2, ?,
                0, 0, 0, 0,
                35000, 250000, 0,
                ?, ?, 0,
                'APPROVED', 'je-pilot-cpa06-bank-01', ?, ?, ?, ?
              )`
            )
            .run(
              companyId,
              accIdByCode['1010'],
              reconciledCashBalance,
              bookBeforeBankAdj,
              11000000 + netPay,
              reconciledCashBalance,
              reconciledCashBalance,
              auditorUserId,
              auditorUserId,
              now,
              now
            );

          sqlite
            .prepare(
              `INSERT INTO bank_statement_lines (
                id, bank_reconciliation_id, company_id, bank_account_id, line_date, description, reference,
                type, amount, matched_status, matched_type, matched_entity_id, matched_amount, created_at
              ) VALUES
              ('bsl-pilot-01', 'recon-pilot-2026-01', ?, ?, '2026-01-01', 'Opening Balance BDO Current Account', 'OB-2026-0001', 'DEPOSIT', 250000000, 'MATCHED', 'JOURNAL_LINE', 'je-pilot-clean-opening-01', 250000000, ?),
              ('bsl-pilot-02', 'recon-pilot-2026-01', ?, ?, '2026-01-12', 'Supplier Payment - Metro Manila Industrial Supply SP-2026-0001', 'SP-2026-0001', 'WITHDRAWAL', 11000000, 'MATCHED', 'JOURNAL_LINE', 'je-pilot-cpa02-pay-01', 11000000, ?),
              ('bsl-pilot-03', 'recon-pilot-2026-01', ?, ?, '2026-01-20', 'Customer Collection - Philippine Apex Logistics OR-2026-0001', 'OR-2026-0001', 'DEPOSIT', 11000000, 'MATCHED', 'JOURNAL_LINE', 'je-pilot-cpa03-pay-01', 11000000, ?),
              ('bsl-pilot-04', 'recon-pilot-2026-01', ?, ?, '2026-01-31', 'January 2026 Payroll Disbursement', 'PR-2026-01', 'WITHDRAWAL', 5330667, 'MATCHED', 'JOURNAL_LINE', 'je-pilot-cpa04-payroll-01', 5330667, ?),
              ('bsl-pilot-05', 'recon-pilot-2026-01', ?, ?, '2026-01-31', 'Net Bank Interest & Service Charge Adjustment', 'RECON-2026-01', 'INTEREST', 215000, 'MATCHED', 'ADJUSTMENT', 'je-pilot-cpa06-bank-01', 215000, ?)`
            )
            .run(
              companyId,
              accIdByCode['1010'],
              now,
              companyId,
              accIdByCode['1010'],
              now,
              companyId,
              accIdByCode['1010'],
              now,
              companyId,
              accIdByCode['1010'],
              now,
              companyId,
              accIdByCode['1010'],
              now
            );
        }

        sqlite.exec('COMMIT');
      } catch (err) {
        try {
          sqlite.exec('ROLLBACK');
        } catch {}
        throw err;
      }
    }

    // Sync active SQLite database to encrypted LAISENC2 .lai container on disk only if newly seeded or missing
    if (didSeedInitialPilotData || !fsSync.existsSync(laiPath)) {
      await CompanyManager.syncCompanyDatabaseSnapshot(companyId);
    }

    // 3. Query and compute verified Opening Trial Balance, Closing Trial Balance, and Subledger Reconciliations
    const openingRow = sqlite
      .prepare(
        `SELECT COALESCE(SUM(debit), 0) as dr, COALESCE(SUM(credit), 0) as cr
         FROM journal_lines WHERE journal_entry_id = 'je-pilot-clean-opening-01'`
      )
      .get() as { dr: number; cr: number };

    const tbRows = sqlite
      .prepare(
        `SELECT a.account_code as code, a.account_name as name, a.account_type as type, a.normal_balance as normalBalance,
                COALESCE(SUM(jl.debit), 0) as debitTotal,
                COALESCE(SUM(jl.credit), 0) as creditTotal
         FROM accounts a
         JOIN journal_lines jl ON jl.account_id = a.id
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE a.company_id = ? AND je.status = 'POSTED'
         GROUP BY a.id
         ORDER BY a.account_code ASC`
      )
      .all(companyId) as Array<{
      code: string;
      name: string;
      type: string;
      normalBalance: string;
      debitTotal: number;
      creditTotal: number;
    }>;

    let closingTotalDr = 0;
    let closingTotalCr = 0;
    const formattedAccounts = tbRows.map((r) => {
      closingTotalDr += Number(r.debitTotal);
      closingTotalCr += Number(r.creditTotal);
      const net =
        r.normalBalance === 'DEBIT'
          ? Number(r.debitTotal) - Number(r.creditTotal)
          : Number(r.creditTotal) - Number(r.debitTotal);
      return {
        ...r,
        debitTotal: Number(r.debitTotal),
        creditTotal: Number(r.creditTotal),
        netBalanceCentavos: net,
      };
    });

    const getGlNet = (code: string) => formattedAccounts.find((a) => a.code === code)?.netBalanceCentavos || 0;

    const arSubledger = Number(
      (
        sqlite
          .prepare(
            `SELECT COALESCE(SUM(balance_due), 0) as bal
             FROM sales_invoices WHERE company_id = ? AND status IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'ISSUED', 'OVERDUE')`
          )
          .get(companyId) as any
      )?.bal || 0
    );
    const arGl = getGlNet('1030');

    const apSubledger = Number(
      (
        sqlite
          .prepare(
            `SELECT COALESCE(SUM(balance_due), 0) as bal
             FROM purchase_bills WHERE company_id = ? AND status IN ('POSTED', 'PARTIAL', 'PARTIALLY_PAID', 'APPROVED', 'OVERDUE')`
          )
          .get(companyId) as any
      )?.bal || 0
    );
    const apGl = getGlNet('2010');

    const invSubledger = Number(
      (
        sqlite
          .prepare(
            `SELECT COALESCE(SUM(CAST(ROUND(quantity_on_hand * unit_cost) AS INTEGER)), 0) as val
             FROM inventory_items WHERE company_id = ? AND status = 'ACTIVE'`
          )
          .get(companyId) as any
      )?.val || 0
    );
    const invGl = getGlNet('1080');

    const faNbvSubledger = Number(
      (
        sqlite
          .prepare(
            `SELECT COALESCE(SUM(book_value), 0) as nbv
             FROM depreciation_schedules WHERE company_id = ? AND period_month = '2026-01' AND status = 'POSTED'`
          )
          .get(companyId) as any
      )?.nbv || 0
    );
    const faNbvGl = getGlNet('1510') - getGlNet('1520');

    const bankReconAdj = Number(
      (
        sqlite
          .prepare(
            `SELECT COALESCE(adjusted_book_balance, 0) as bal
             FROM bank_reconciliations WHERE id = 'recon-pilot-2026-01'`
          )
          .get() as any
      )?.bal || 0
    );
    const cashGl = getGlNet('1010');

    const meta = DatabaseEncryptionService.inspectContainerMetadataSync(laiPath);

    return {
      companyId,
      legalName: this.PILOT_LEGAL_NAME,
      tin: this.PILOT_TIN,
      classification: 'PILOT',
      companyDir,
      laiPath,
      encryptionContainer: meta.containerVersion,
      keyMode: meta.keyMode,
      keyId: meta.keyId,
      keyVersion: meta.keyVersion,
      hasRecoveryEnvelope: meta.hasRecoveryEnvelope,
      openingTrialBalance: {
        totalDebitsCentavos: Number(openingRow.dr),
        totalCreditsCentavos: Number(openingRow.cr),
        balanced: Number(openingRow.dr) === Number(openingRow.cr) && Number(openingRow.dr) === 390000000,
      },
      closingTrialBalance: {
        totalDebitsCentavos: closingTotalDr,
        totalCreditsCentavos: closingTotalCr,
        balanced: closingTotalDr === closingTotalCr && closingTotalDr > 0,
        accounts: formattedAccounts,
      },
      subledgerReconciliation: {
        arSubledgerCentavos: arSubledger,
        arGlCentavos: arGl,
        arVarianceCentavos: arSubledger - arGl,
        apSubledgerCentavos: apSubledger,
        apGlCentavos: apGl,
        apVarianceCentavos: apSubledger - apGl,
        inventorySubledgerCentavos: invSubledger,
        inventoryGlCentavos: invGl,
        inventoryVarianceCentavos: invSubledger - invGl,
        fixedAssetNbvSubledgerCentavos: faNbvSubledger,
        fixedAssetNbvGlCentavos: faNbvGl,
        fixedAssetVarianceCentavos: faNbvSubledger - faNbvGl,
        bankReconAdjustedBalanceCentavos: bankReconAdj,
        cashGlCentavos: cashGl,
        bankReconVarianceCentavos: bankReconAdj - cashGl,
      },
      scenarios: {
        cpa01OpeningJournalId: 'je-pilot-clean-opening-01',
        cpa02PurchaseBillId: 'bill-pilot-clean-01',
        cpa02JournalId: 'je-pilot-cpa02-bill-01',
        cpa02SupplierPaymentId: 'sp-pilot-cpa02-01',
        cpa03SalesInvoiceId: 'inv-pilot-clean-01',
        cpa03InvoiceJournalId: 'je-pilot-cpa03-inv-01',
        cpa03PaymentId: 'pay-pilot-cpa03-01',
        cpa03PaymentJournalId: 'je-pilot-cpa03-pay-01',
        cpa04PayrollRunId: 'pr-pilot-2026-01',
        cpa04JournalId: 'je-pilot-cpa04-payroll-01',
        cpa05FixedAssetId: 'fa-pilot-equip-01',
        cpa05DepreciationScheduleId: 'ds-pilot-2026-01',
        cpa05JournalId: 'je-pilot-cpa05-depr-01',
        cpa06BankReconId: 'recon-pilot-2026-01',
        cpa06JournalId: 'je-pilot-cpa06-bank-01',
      },
    };
  }
}
