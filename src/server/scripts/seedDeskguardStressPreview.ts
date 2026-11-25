import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Readable } from 'stream';
import Database from 'better-sqlite3';
import { CompanyManager, CompanyManifest } from '../services/companyManager';
import { RbacService } from '../services/rbacService';
import { DocumentEncryptionService } from '../services/documentEncryptionService';
import { RestoreService } from '../services/restoreService';
import { dbContext } from '../db/context';
import { CANONICAL_ROLES_ORDER } from '../../shared/rbacCatalog';

import { paths } from '../services/paths';
import { DEFAULT_PHILIPPINE_COA } from '../routes/companies';
import { inferAccountDetailAndBirCategory } from '../../shared/coaAccountUtils';

export const ORIGINAL_DESKGUARD_ID = 'LGR-PH-2026-SER-00-BF1DC86B';
export const ORIGINAL_DESKGUARD_LAI_PATH = path.join(paths.getCompaniesRootDir(), 'deskguard_solutions', 'database.lai');
export const EXPECTED_ORIGINAL_DESKGUARD_SHA256 = '1350910f1af35db1c12214dc50a5100483af7dfac25aeb0938a5109a69070b67';

export const PREVIEW_COMPANY_ID = 'LGR-PH-2026-STRESS-DG-PREVIEW';
export const PREVIEW_COMPANY_NAME = 'Deskguard Solutions — Stress Test Preview';
export const PREVIEW_COMPANY_DIR = path.join(paths.getCompaniesRootDir(), 'deskguard_solutions_stress_preview');

function computeFileSha256(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function seedDeskguardStressPreview() {
  const startTime = Date.now();
  console.log('================================================================================');
  console.log('LEDGERAI PH — DESKGUARD SOLUTIONS STRESS TEST PREVIEW CLONE & SEEDER');
  console.log('================================================================================');

  // 1. Verify Original Deskguard Solutions Integrity Before Any Work (when present on disk)
  const hasOriginalDeskguardOnDisk = fs.existsSync(ORIGINAL_DESKGUARD_LAI_PATH);
  if (hasOriginalDeskguardOnDisk) {
    const preSha256 = computeFileSha256(ORIGINAL_DESKGUARD_LAI_PATH);
    if (preSha256 !== EXPECTED_ORIGINAL_DESKGUARD_SHA256) {
      throw new Error(
        `SAFETY HALT: Original Deskguard database.lai SHA-256 mismatch! Expected ${EXPECTED_ORIGINAL_DESKGUARD_SHA256}, got ${preSha256}`
      );
    }
    console.log(`[SAFETY CHECK] Original Deskguard Solutions (${ORIGINAL_DESKGUARD_ID}) SHA-256 verified: ${preSha256}`);
  } else {
    console.log(`[SAFETY CHECK] Ephemeral container restart detected; provisioning ${PREVIEW_COMPANY_NAME} from canonical Deskguard Solutions COA template.`);
  }

  // 2. Read Source Configuration & COA from Original Deskguard Solutions (Read-Only) or canonical template
  const origActiveSqlitePath = path.join(paths.getCompaniesRootDir(), 'deskguard_solutions', '.db_active.sqlite');
  let origCompany: any = { legal_name: 'Deskguard Solutions', industry: 'Services & Consulting' };
  let origAccounts: any[] = DEFAULT_PHILIPPINE_COA.map((a) => ({
    account_code: a.accountCode,
    account_name: a.accountName,
    account_type: a.accountType,
    normal_balance: a.normalBalance,
    description: `${a.accountName} (${a.accountCode})`,
    is_control_account: (a as any).isControlAccount ? 1 : 0,
    is_cash_account: (a as any).isCashAccount ? 1 : 0,
    is_tax_account: (a as any).isTaxAccount ? 1 : 0,
    is_retained_earnings: (a as any).isRetainedEarnings ? 1 : 0,
  }));

  if (fs.existsSync(origActiveSqlitePath)) {
    const origDb = new Database(origActiveSqlitePath, { readonly: true });
    origCompany = origDb.prepare('SELECT * FROM companies WHERE id = ?').get(ORIGINAL_DESKGUARD_ID) as any;
    origAccounts = origDb
      .prepare('SELECT * FROM accounts WHERE company_id = ? ORDER BY account_code ASC')
      .all(ORIGINAL_DESKGUARD_ID) as any[];
    origDb.close();
  }
  console.log(`[CLONE SOURCE] Read ${origAccounts.length} Chart of Accounts & configuration from ${origCompany?.legal_name}`);

  // 3. Prepare Clean Isolated Directory Structure for Stress Test Preview
  await CompanyManager.closeCompanyDb(PREVIEW_COMPANY_ID).catch(() => {});
  if (fs.existsSync(PREVIEW_COMPANY_DIR)) {
    await fsp.rm(PREVIEW_COMPANY_DIR, { recursive: true, force: true });
  }
  const docDir = path.join(PREVIEW_COMPANY_DIR, 'documents');
  const backupDir = path.join(PREVIEW_COMPANY_DIR, 'backups');
  await fsp.mkdir(docDir, { recursive: true });
  await fsp.mkdir(backupDir, { recursive: true });

  const manifest: CompanyManifest = {
    id: PREVIEW_COMPANY_ID,
    legalName: PREVIEW_COMPANY_NAME,
    createdAt: new Date().toISOString(),
    dbPath: path.join(PREVIEW_COMPANY_DIR, 'database.lai'),
    documentLocation: docDir,
    backupLocation: backupDir,
    location: PREVIEW_COMPANY_DIR,
    status: 'ACTIVE',
    registrationStatus: 'REGISTERED',
    classification: 'STRESS_TEST',
    encryptionKeyMode: 'LEGACY_DEV_KEY',
    isDemo: false,
    isVisualStressPreview: true,
    lastOpenedAt: new Date().toISOString(),
  };

  await fsp.writeFile(path.join(PREVIEW_COMPANY_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await CompanyManager.registerCompany(manifest);

  // Initialize SQLite schema via CompanyManager
  const drizzleDb = await CompanyManager.getCompanyDb(PREVIEW_COMPANY_ID, { allowInitializeNew: true });
  const sqlite = (await CompanyManager.getCompanySqlite(PREVIEW_COMPANY_ID)) as Database.Database;
  if (!sqlite) {
    throw new Error('Failed to obtain SQLite connection for Stress Test Preview');
  }

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = OFF');

  const nowSec = Math.floor(Date.now() / 1000);

  // 4. Insert Cloned Company Record, Tax Profile & Enterprise License
  sqlite
    .prepare(
      `INSERT OR REPLACE INTO companies (
        id, legal_name, trade_name, tin, branch_code, address, contact_email, contact_phone,
        contact_person, industry, fiscal_year, fiscal_year_start_month, currency, accounting_method,
        taxpayer_classification, taxpayer_type, vat_status, rdo_code, bir_registration_no, bir_date_registered,
        document_location_path, backup_location_path, status, classification, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      PREVIEW_COMPANY_ID,
      PREVIEW_COMPANY_NAME,
      'Deskguard Solutions (Stress Preview)',
      '009-842-510-000',
      '00000',
      '28F Ayala Tower One, Ayala Avenue, Makati City, Metro Manila 1226',
      'finance@stress-dg.ledgerai.ph',
      '+63 (2) 8840-9200',
      'Elena Santos, CPA',
      origCompany?.industry || 'Services & Consulting',
      2026,
      1,
      'PHP',
      'ACCRUAL',
      'CORPORATION',
      'CORPORATION',
      'VAT',
      '039',
      'OCN-039-2026-0098421',
      '2021-01-15',
      docDir,
      backupDir,
      'ACTIVE',
      'STRESS_TEST',
      0,
      nowSec,
      nowSec
    );

  sqlite
    .prepare(
      `INSERT OR REPLACE INTO company_tax_profiles (
        id, company_id, taxpayer_classification, vat_status, tax_types, tin, rdo,
        accounting_period, filing_frequency, status, is_demo, created_at, updated_at
      ) VALUES (?, ?, 'CORPORATION', 'VAT_REGISTERED', '["VAT","EWT","WTC","CORPORATE_ITR"]', '009-842-510-000', '039', 'CALENDAR', 'MONTHLY_QUARTERLY', 'ACTIVE', 0, ?, ?)`
    )
    .run('tax-prof-dg-preview', PREVIEW_COMPANY_ID, nowSec, nowSec);

  sqlite
    .prepare(
      `INSERT OR REPLACE INTO company_licenses (
        id, company_id, license_key, plan_type, status, trial_start_date, expiration_date,
        signed_file_content, is_lifetime, created_at, updated_at
      ) VALUES (?, ?, 'LAI-ENT-2026-DG-STRESS-PREVIEW', 'ENTERPRISE', 'ACTIVE', ?, ?, '{"tier":"ENTERPRISE","maxUsers":100}', 1, ?, ?)`
    )
    .run('lic-dg-preview', PREVIEW_COMPANY_ID, nowSec, nowSec + 86400 * 3650, nowSec, nowSec);

  // 5. Seed Standard RBAC Roles & Permissions and Dedicated Test Users
  const passwordHash = await bcrypt.hash('Password123!', 10);
  const testUsers = [
    { id: 'usr-dg-admin-main', email: 'admin@gmail.com', name: 'Deskguard Owner (Stress Preview)', role: 'Company Owner' },
    { id: 'usr-dg-owner', email: 'owner@stress-dg.ledgerai.ph', name: 'Elena Santos (Company Owner)', role: 'Company Owner' },
    { id: 'usr-dg-sysadmin', email: 'admin@stress-dg.ledgerai.ph', name: 'Marco Villanueva (Administrator)', role: 'Company Administrator' },
    { id: 'usr-dg-accountant', email: 'accountant@stress-dg.ledgerai.ph', name: 'Jaeanne Gomez (Accountant)', role: 'Accountant' },
    { id: 'usr-dg-bookkeeper', email: 'bookkeeper@stress-dg.ledgerai.ph', name: 'Rico Dela Cruz (Bookkeeper)', role: 'Bookkeeper' },
    { id: 'usr-dg-clerk', email: 'clerk@stress-dg.ledgerai.ph', name: 'Clarisse Mendoza (AP/AR Clerk)', role: 'Tax & AP Specialist' },
    { id: 'usr-dg-payroll', email: 'payroll@stress-dg.ledgerai.ph', name: 'Patricia Lim (Payroll Officer)', role: 'Accountant' },
    { id: 'usr-dg-approver', email: 'approver@stress-dg.ledgerai.ph', name: 'Victor Reyes (Approver)', role: 'Approver' },
    { id: 'usr-dg-auditor', email: 'auditor@stress-dg.ledgerai.ph', name: 'Camille Tan, CPA (Auditor)', role: 'Auditor' },
    { id: 'usr-dg-readonly', email: 'readonly@stress-dg.ledgerai.ph', name: 'Daniel Aquino (Read-only User)', role: 'Read-only User' },
  ];

  const insertUser = sqlite.prepare(
    `INSERT OR REPLACE INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ACTIVE', 0, ?, ?)`
  );
  const insertCompanyUser = sqlite.prepare(
    `INSERT OR REPLACE INTO company_users (
      id, company_id, user_id, role_id, default_data_scope, approval_limit_centavos, status, membership_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'COMPANY_WIDE', 500000000, 'ACTIVE', 'ACTIVE', ?, ?)`
  );
  const insertCompanyUserRole = sqlite.prepare(
    `INSERT OR REPLACE INTO company_user_roles (
      id, company_user_id, role_id, role_code, role_template_version, is_primary, assignment_status, assigned_by, assigned_at, created_at
    ) VALUES (?, ?, ?, ?, 1, 1, 'ACTIVE', 'usr-dg-owner', ?, ?)`
  );

  await dbContext.run(drizzleDb as any, async () => {
    await RbacService.ensureRoleTemplatesSeeded();
    const roleMap = new Map<string, { id: string; code: string }>();
    for (const rName of CANONICAL_ROLES_ORDER) {
      const rec = await RbacService.ensureRoleRecord(rName);
      roleMap.set(rName, { id: rec.id, code: rec.code });
    }

    for (const u of testUsers) {
      const rInfo = roleMap.get(u.role) || roleMap.get('Company Owner')!;
      const memId = `mem-${u.id}`;
      insertUser.run(u.id, u.email, passwordHash, u.name, nowSec, nowSec);
      insertCompanyUser.run(memId, PREVIEW_COMPANY_ID, u.id, rInfo.id, nowSec, nowSec);
      insertCompanyUserRole.run(`cur-${u.id}`, memId, rInfo.id, rInfo.code, nowSec, nowSec);
      await RbacService.applyRoleDefaultModulesToUser(memId, u.role, 'usr-dg-owner', 'System Provisioner');
    }
  });

  // 6. Clone 35 Chart of Accounts from Deskguard Solutions
  const accountIdByCode = new Map<string, string>();
  const insertAccount = sqlite.prepare(
    `INSERT OR REPLACE INTO accounts (
      id, company_id, account_code, account_name, account_type, detail_type, bir_tax_category, normal_balance,
      description, opening_balance, is_control_account, is_cash_account, is_tax_account, is_retained_earnings,
      status, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)`
  );

  for (const acc of origAccounts) {
    const newAccId = `dg-acc-${acc.account_code}`;
    accountIdByCode.set(String(acc.account_code), newAccId);
    const inferred = inferAccountDetailAndBirCategory({
      accountCode: acc.account_code,
      accountName: acc.account_name,
      accountType: acc.account_type,
      detailType: acc.detail_type,
      birTaxCategory: acc.bir_tax_category,
      isCashAccount: acc.is_cash_account,
      isTaxAccount: acc.is_tax_account,
    });
    insertAccount.run(
      newAccId,
      PREVIEW_COMPANY_ID,
      acc.account_code,
      acc.account_name,
      acc.account_type,
      inferred.detailType,
      inferred.birTaxCategory,
      acc.normal_balance,
      acc.description || `${acc.account_name} (${acc.account_code})`,
      acc.is_control_account ? 1 : 0,
      acc.is_cash_account ? 1 : 0,
      acc.is_tax_account ? 1 : 0,
      acc.is_retained_earnings ? 1 : 0,
      nowSec,
      nowSec
    );
  }
  console.log(`[COA] Cloned ${accountIdByCode.size} accounts from Deskguard Solutions`);

  // 6b. Seed Additional Enterprise Multi-Bank, Cash, Revenue & Expense Accounts (Universal COA Discovery)
  const additionalCoaAccounts = [
    { accountCode: '1012', accountName: 'Cash in Bank - Metrobank USD FCDU', accountType: 'ASSET', detailType: 'DOLLAR_ACCOUNT', normalBalance: 'DEBIT', isCashAccount: 1, isControlAccount: 0, isTaxAccount: 0 },
    { accountCode: '1015', accountName: 'Cash in Bank - BPI Payroll Account', accountType: 'ASSET', detailType: 'PAYROLL_BANK', normalBalance: 'DEBIT', isCashAccount: 1, isControlAccount: 0, isTaxAccount: 0 },
    { accountCode: '1025', accountName: 'Petty Cash Fund - Cebu Branch', accountType: 'ASSET', detailType: 'PETTY_CASH', normalBalance: 'DEBIT', isCashAccount: 1, isControlAccount: 0, isTaxAccount: 0 },
    { accountCode: '2026', accountName: 'BDO Business Checking Account', accountType: 'ASSET', detailType: 'CHECKING', normalBalance: 'DEBIT', isCashAccount: 1, isControlAccount: 0, isTaxAccount: 0 },
    { accountCode: 'BNK-BDO-01', accountName: 'BDO Pasong Tamo Commercial Checking', accountType: 'ASSET', detailType: 'CHECKING', normalBalance: 'DEBIT', isCashAccount: 1, isControlAccount: 0, isTaxAccount: 0 },
    { accountCode: 'CASH-01', accountName: 'Cash on Hand - Undeposited Collections', accountType: 'ASSET', detailType: 'CASH_ON_HAND', normalBalance: 'DEBIT', isCashAccount: 1, isControlAccount: 0, isTaxAccount: 0 },
    { accountCode: '4015', accountName: 'Software Subscription & SaaS Revenue', accountType: 'REVENUE', detailType: 'SERVICE_INCOME', normalBalance: 'CREDIT', isCashAccount: 0, isControlAccount: 0, isTaxAccount: 0 },
    { accountCode: '4025', accountName: 'Implementation & Consulting Revenue', accountType: 'REVENUE', detailType: 'SERVICE_INCOME', normalBalance: 'CREDIT', isCashAccount: 0, isControlAccount: 0, isTaxAccount: 0 },
    { accountCode: '6015', accountName: 'Software Cloud Infrastructure & Hosting', accountType: 'EXPENSE', detailType: 'UTILITIES_EXPENSE', normalBalance: 'DEBIT', isCashAccount: 0, isControlAccount: 0, isTaxAccount: 0 },
    { accountCode: '6025', accountName: 'Telecommunications & High-Speed Internet', accountType: 'EXPENSE', detailType: 'UTILITIES_EXPENSE', normalBalance: 'DEBIT', isCashAccount: 0, isControlAccount: 0, isTaxAccount: 0 },
  ];

  for (const extra of additionalCoaAccounts) {
    const extraAccId = `dg-acc-${extra.accountCode}`;
    accountIdByCode.set(extra.accountCode, extraAccId);
    const inferred = inferAccountDetailAndBirCategory({
      accountCode: extra.accountCode,
      accountName: extra.accountName,
      accountType: extra.accountType,
      detailType: extra.detailType,
      isCashAccount: extra.isCashAccount,
    });
    insertAccount.run(
      extraAccId,
      PREVIEW_COMPANY_ID,
      extra.accountCode,
      extra.accountName,
      extra.accountType,
      extra.detailType || inferred.detailType,
      inferred.birTaxCategory,
      extra.normalBalance,
      `${extra.accountName} (${extra.accountCode})`,
      extra.isControlAccount,
      extra.isCashAccount,
      extra.isTaxAccount,
      0,
      nowSec,
      nowSec
    );
  }
  console.log(`[COA] Seeded ${additionalCoaAccounts.length} additional enterprise accounts for universal discovery.`);

  // 7. Seed Accounting Periods (FY 2025 Closed + FY 2026 Monthly Periods)
  const insertPeriod = sqlite.prepare(
    `INSERT OR REPLACE INTO accounting_periods (
      id, company_id, name, start_date, end_date, fiscal_year, status, closed_at, closed_by, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );
  insertPeriod.run('per-dg-2025', PREVIEW_COMPANY_ID, 'FY 2025 Annual', '2025-01-01', '2025-12-31', 2025, 'CLOSED', nowSec, 'usr-dg-owner', nowSec, nowSec);

  const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    const periodName = `2026-${mm}`;
    const startDate = `2026-${mm}-01`;
    const endDate = `2026-${mm}-${String(monthDays[m - 1]).padStart(2, '0')}`;
    const status = m <= 3 ? 'CLOSED' : m <= 6 ? 'SOFT_CLOSED' : 'OPEN';
    insertPeriod.run(
      `per-dg-2026-${mm}`,
      PREVIEW_COMPANY_ID,
      periodName,
      startDate,
      endDate,
      2026,
      status,
      status === 'CLOSED' ? nowSec : null,
      status === 'CLOSED' ? 'usr-dg-owner' : null,
      nowSec,
      nowSec
    );
  }

  // 8. Seed Master Data: Cost Centers, Projects, Locations, Banks, Payment Methods, Tax Codes, Forex Rates
  const departments = [
    { id: 'cc-dg-01', code: 'CC-EXEC', name: 'Executive & Corporate Governance' },
    { id: 'cc-dg-02', code: 'CC-FIN', name: 'Finance, Accounting & Treasury' },
    { id: 'cc-dg-03', code: 'CC-OPS', name: 'Field Security Systems Operations' },
    { id: 'cc-dg-04', code: 'CC-IT', name: 'Cloud & Cyber Engineering' },
    { id: 'cc-dg-05', code: 'CC-SEC', name: 'Enterprise Access Control Division' },
    { id: 'cc-dg-06', code: 'CC-SALES', name: 'Commercial & Enterprise Sales' },
    { id: 'cc-dg-07', code: 'CC-HR', name: 'People Operations & Payroll' },
    { id: 'cc-dg-08', code: 'CC-PROC', name: 'Supply Chain & Procurement' },
    { id: 'cc-dg-09', code: 'CC-QA', name: 'Hardware Quality Assurance' },
    { id: 'cc-dg-10', code: 'CC-LOG', name: 'Warehouse & Logistics Hub' },
    { id: 'cc-dg-11', code: 'CC-RND', name: 'Biometric Firmware R&D' },
    { id: 'cc-dg-12', code: 'CC-LEGAL', name: 'Regulatory & BIR Compliance' },
  ];

  const insertDept = sqlite.prepare(
    `INSERT OR REPLACE INTO departments (id, company_id, code, name, manager_name, status, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, 'Department Head', 'ACTIVE', ?, ?, 1)`
  );
  const insertCostCenter = sqlite.prepare(
    `INSERT OR REPLACE INTO cost_centers (id, company_id, code, name, department_id, status, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 1)`
  );
  for (const d of departments) {
    insertDept.run(d.id, PREVIEW_COMPANY_ID, d.code, d.name, nowSec, nowSec);
    insertCostCenter.run(d.id, PREVIEW_COMPANY_ID, d.code, d.name, d.id, nowSec, nowSec);
  }

  const insertProject = sqlite.prepare(
    `INSERT OR REPLACE INTO projects (id, company_id, code, name, budget_amount, start_date, end_date, status, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, 250000000, ?, ?, 'ACTIVE', ?, ?, 1)`
  );
  for (let p = 1; p <= 8; p++) {
    insertProject.run(
      `proj-dg-0${p}`,
      PREVIEW_COMPANY_ID,
      `PRJ-2026-0${p}`,
      `Enterprise Turnstile & Biometric Rollout Phase ${p}`,
      '2026-01-15',
      '2026-12-31',
      nowSec,
      nowSec
    );
  }

  const insertLocation = sqlite.prepare(
    `INSERT OR REPLACE INTO locations (id, company_id, code, name, address, is_main_branch, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
  );
  const branches = [
    ['LOC-MKT', 'Makati Main Headquarters', 'Ayala Ave, Makati City', 1],
    ['LOC-BGC', 'BGC Technical Operations Center', '32nd St, Bonifacio Global City, Taguig', 0],
    ['LOC-ORT', 'Ortigas Service Dispatch Hub', 'ADB Ave, Ortigas Center, Pasig City', 0],
    ['LOC-LAG', 'Laguna Technopark Central Warehouse', 'Sta. Rosa, Laguna', 0],
    ['LOC-CEB', 'Cebu IT Park Visayas Regional Branch', 'Lahug, Cebu City', 0],
    ['LOC-DAV', 'Davao Lanang Mindanao Regional Branch', 'J.P. Laurel Ave, Davao City', 0],
  ];
  branches.forEach((b, idx) => {
    insertLocation.run(`loc-dg-0${idx + 1}`, PREVIEW_COMPANY_ID, b[0], b[1], b[2], b[3], nowSec, nowSec);
  });

  const cashAccId = accountIdByCode.get('1010')!;
  const outVatAccId = accountIdByCode.get('2020')!;
  const inVatAccId = accountIdByCode.get('1050')!;
  const ewtAccId = accountIdByCode.get('2030')!;
  const wtcAccId = accountIdByCode.get('2035')!;

  sqlite
    .prepare(
      `INSERT OR REPLACE INTO banks (id, company_id, code, bank_name, branch, account_number, account_type, currency, gl_account_id, status, created_at, updated_at)
       VALUES (?, ?, 'BNK-BPI-01', 'Bank of the Philippine Islands (BPI)', 'Ayala Tower One Corporate Center', '0041-8892-19', 'CHECKING', 'PHP', ?, 'ACTIVE', ?, ?)`
    )
    .run('bnk-dg-01', PREVIEW_COMPANY_ID, cashAccId, nowSec, nowSec);

  const insertBankAcc = sqlite.prepare(
    `INSERT OR REPLACE INTO bank_accounts (id, company_id, gl_account_id, account_name, bank_name, account_number_encrypted, currency, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
  );
  insertBankAcc.run('bacc-dg-01', PREVIEW_COMPANY_ID, 'dg-acc-1010', 'Deskguard Corporate Checking Account', 'BPI Corporate', '0041-8892-19', 'PHP', nowSec, nowSec);
  insertBankAcc.run('bacc-dg-02', PREVIEW_COMPANY_ID, 'dg-acc-1012', 'Deskguard Metrobank USD FCDU', 'Metrobank FCDU', '2891-0021-44', 'USD', nowSec, nowSec);
  insertBankAcc.run('bacc-dg-03', PREVIEW_COMPANY_ID, 'dg-acc-1015', 'Deskguard BPI Corporate Payroll', 'BPI Corporate', '0041-9932-55', 'PHP', nowSec, nowSec);
  insertBankAcc.run('bacc-dg-04', PREVIEW_COMPANY_ID, 'dg-acc-2026', 'Deskguard BDO Business Checking', 'BDO Unibank', '0012-3456-78', 'PHP', nowSec, nowSec);
  insertBankAcc.run('bacc-dg-05', PREVIEW_COMPANY_ID, 'dg-acc-BNK-BDO-01', 'Deskguard BDO Pasong Tamo Commercial', 'BDO Pasong Tamo', '0089-1122-33', 'PHP', nowSec, nowSec);

  sqlite
    .prepare(
      `INSERT OR REPLACE INTO payment_methods (id, company_id, code, name, type, default_account_id, status, created_at, updated_at)
       VALUES (?, ?, 'PM-BPI-WIRE', 'Corporate Bank Wire / PESONet', 'BANK_TRANSFER', ?, 'ACTIVE', ?, ?)`
    )
    .run('pm-dg-01', PREVIEW_COMPANY_ID, cashAccId, nowSec, nowSec);

  // Seed Tax Rule Definitions & Versions + Tax Codes
  sqlite
    .prepare(
      `INSERT OR REPLACE INTO tax_rule_definitions (id, rule_code, rule_name, tax_type, description, taxpayer_scope, status, is_demo, created_at, updated_at)
       VALUES ('trdef-dg-vat12', 'PH_VAT_12', 'Philippine Standard 12% VAT Rule', 'VAT', 'NIRC Sec. 106/108 12% VAT', 'ALL', 'ACTIVE', 0, ?, ?)`
    )
    .run(nowSec, nowSec);

  sqlite
    .prepare(
      `INSERT OR REPLACE INTO tax_rule_versions (
        id, rule_definition_id, version, effective_from, calculation_method, rate_value,
        rule_configuration, taxpayer_scope, source_reference, source_title, source_type, source_date, status, is_demo, created_at, updated_at
      ) VALUES ('trver-dg-vat12', 'trdef-dg-vat12', 1, '2021-01-01', 'PERCENTAGE', 1200, '{"rate":0.12}', 'ALL', 'NIRC Sec. 106/108', 'TRAIN / CREATE Statutory VAT', 'STATUTE', '2021-01-01', 'ACTIVE', 0, ?, ?)`
    )
    .run(nowSec, nowSec);

  const insertTaxCode = sqlite.prepare(
    `INSERT OR REPLACE INTO tax_codes (
      id, company_id, code, name, tax_type, description, applicability, input_output_direction, account_id, rule_definition_id, status, is_demo, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'BOTH', ?, ?, 'trdef-dg-vat12', 'ACTIVE', 0, ?, ?)`
  );
  const birTaxCodes = [
    ['tc-dg-vat12', 'VAT12', '12% Standard Value-Added Tax', 'VAT', '12% Output/Input VAT', 'OUTPUT', outVatAccId],
    ['tc-dg-vat0', 'VAT0', '0% Zero-Rated VAT (PEZA / Export)', 'VAT', '0% Zero-Rated Sales', 'OUTPUT', outVatAccId],
    ['tc-dg-vatex', 'VATEX', 'VAT-Exempt Transaction', 'VAT', 'VAT Exempt under Sec. 109', 'OUTPUT', outVatAccId],
    ['tc-dg-wc158', 'EWT-WC158', '1% EWT — Purchase of Goods (TWA)', 'EWT', 'ATC WC158 1% EWT Goods', 'INPUT', ewtAccId],
    ['tc-dg-wc160', 'EWT-WC160', '2% EWT — Purchase of Services (TWA)', 'EWT', 'ATC WC160 2% EWT Services', 'INPUT', ewtAccId],
    ['tc-dg-wc010', 'EWT-WC010', '10% EWT — Professional Fees (Corporate)', 'EWT', 'ATC WC010 10% EWT', 'INPUT', ewtAccId],
    ['tc-dg-wi010', 'EWT-WI010', '5% EWT — Professional Fees (Individual)', 'EWT', 'ATC WI010 5% EWT', 'INPUT', ewtAccId],
    ['tc-dg-wc100', 'EWT-WC100', '5% EWT — Rental of Real/Personal Property', 'EWT', 'ATC WC100 5% Rental EWT', 'INPUT', ewtAccId],
    ['tc-dg-pt3', 'PT-3PCT', '3% Other Percentage Tax (Sec. 116)', 'PERCENTAGE_TAX', '3% Percentage Tax', 'OUTPUT', outVatAccId],
    ['tc-dg-wtc', 'WTC-TRAIN', 'Withholding Tax on Compensation (TRAIN Law)', 'WITHHOLDING_COMPENSATION', 'BIR 1601-C WTC', 'INPUT', wtcAccId],
  ];
  for (const tc of birTaxCodes) {
    insertTaxCode.run(tc[0], PREVIEW_COMPANY_ID, tc[1], tc[2], tc[3], tc[4], tc[5], tc[6], nowSec, nowSec);
  }

  const insertFx = sqlite.prepare(
    `INSERT OR REPLACE INTO currency_exchange_rates (id, company_id, rate_date, currency, bsp_spot_rate, source, created_at)
     VALUES (?, ?, ?, ?, ?, 'BSP', ?)`
  );
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    insertFx.run(`fx-usd-2026-${mm}`, PREVIEW_COMPANY_ID, `2026-${mm}-15`, 'USD', 56.15 + m * 0.12, nowSec);
  }

  // 9. Seed 2,500 Customers + 2,500 Vendors (5,000 Total Counterparties)
  console.log('[MASTER DATA] Seeding 2,500 Customers and 2,500 Vendors (5,000 total counterparties)...');
  const arAccId = accountIdByCode.get('1030')!;
  const apAccId = accountIdByCode.get('2010')!;
  const revAccId = accountIdByCode.get('4010')!;
  const cogsAccId = accountIdByCode.get('5010')!;

  const insertCustomer = sqlite.prepare(
    `INSERT INTO customers (
      id, company_id, code, legal_name, trade_name, tin, address, contact_person,
      contact_details, payment_terms, credit_limit, tax_classification, vat_status,
      default_receivable_account_id, default_revenue_account_id, status, is_demo, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NET_30', 500000000, 'CORPORATION', 'VAT_REGISTERED', ?, ?, 'ACTIVE', 0, 1, ?, ?)`
  );
  const insertVendor = sqlite.prepare(
    `INSERT INTO vendors (
      id, company_id, code, legal_name, trade_name, tin, address, contact_person,
      contact_details, payment_terms, tax_classification, vat_status, withholding_applicability,
      default_payable_account_id, default_expense_account_id, status, is_demo, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NET_30', 'CORPORATION', 'VAT_REGISTERED', 'WC160', ?, ?, 'ACTIVE', 0, 1, ?, ?)`
  );

  const phCities = ['Makati City', 'Taguig City (BGC)', 'Pasig City', 'Quezon City', 'Mandaluyong City', 'Alabang, Muntinlupa', 'Cebu City', 'Davao City', 'Clark, Pampanga', 'Sta. Rosa, Laguna'];

  sqlite.transaction(() => {
    for (let i = 1; i <= 2500; i++) {
      const code = `CUST-${String(i).padStart(4, '0')}`;
      const city = phCities[i % phCities.length];
      const tin = `${String(100 + (i % 899)).padStart(3, '0')}-${String(100 + ((i * 7) % 899)).padStart(3, '0')}-${String(100 + ((i * 13) % 899)).padStart(3, '0')}-000`;
      insertCustomer.run(
        `cust-dg-${i}`,
        PREVIEW_COMPANY_ID,
        code,
        `Philippine Enterprise Client ${String(i).padStart(4, '0')} Corp.`,
        `PH Client ${i}`,
        tin,
        `Unit ${100 + (i % 40)}, Enterprise Center, ${city}`,
        `Client Account Manager ${i}`,
        `ap.client${i}@enterprise-ph.example | +63 917 ${String(1000000 + i).slice(-7)}`,
        arAccId,
        revAccId,
        nowSec,
        nowSec
      );
    }

    for (let i = 1; i <= 2500; i++) {
      const code = `VEND-${String(i).padStart(4, '0')}`;
      const city = phCities[(i + 3) % phCities.length];
      const tin = `${String(200 + (i % 799)).padStart(3, '0')}-${String(200 + ((i * 11) % 799)).padStart(3, '0')}-${String(200 + ((i * 17) % 799)).padStart(3, '0')}-000`;
      insertVendor.run(
        `vend-dg-${i}`,
        PREVIEW_COMPANY_ID,
        code,
        `Archipelago Security Supplier ${String(i).padStart(4, '0')} Inc.`,
        `Supplier ${i}`,
        tin,
        `Bldg ${(i % 25) + 1}, Industrial Park, ${city}`,
        `Supplier Billing Officer ${i}`,
        `billing.vendor${i}@supplier-ph.example | +63 918 ${String(2000000 + i).slice(-7)}`,
        apAccId,
        cogsAccId,
        nowSec,
        nowSec
      );
    }
  })();

  // 10. Seed 500 Inventory Items & 50,000 Inventory Movements (Strictly Reconciled to ₱100,000,000.00 / 10,000,000,000 centavos)
  console.log('[INVENTORY] Seeding 500 Inventory SKUs and 50,000 Inventory Movements...');
  const invAssetAccId = accountIdByCode.get('1080')!;
  const insertInvItem = sqlite.prepare(
    `INSERT INTO inventory_items (
      id, company_id, sku, name, description, category, unit_of_measure, costing_method,
      unit_cost, selling_price, quantity_on_hand, reorder_point, asset_account_id, cogs_account_id,
      status, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'PCS', 'WAVCO', 100000, 180000, 200, 25, ?, ?, 'ACTIVE', 1, ?, ?)`
  );
  const insertInvTx = sqlite.prepare(
    `INSERT INTO inventory_transactions (
      id, company_id, item_id, transaction_date, type, quantity, unit_cost, total_value, reference, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 100000, ?, ?, ?, ?)`
  );
  const insertStockAdj = sqlite.prepare(
    `INSERT INTO stock_adjustments (
      id, company_id, adjustment_number, adjustment_date, item_id, quantity_change,
      reason, expense_account_id, status, created_by, version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', 'usr-dg-bookkeeper', 1, ?)`
  );

  const hwCategories = ['BIOMETRIC_TERMINALS', 'ACCESS_CONTROLLERS', 'IP_CAMERAS_NVR', 'TURNSTILE_GATES', 'RFID_SMART_CARDS'];
  sqlite.transaction(() => {
    let txCounter = 0;
    for (let s = 1; s <= 500; s++) {
      const itemId = `inv-dg-${s}`;
      const sku = `SKU-DG-${String(s).padStart(4, '0')}`;
      const cat = hwCategories[s % hwCategories.length];
      insertInvItem.run(
        itemId,
        PREVIEW_COMPANY_ID,
        sku,
        `Deskguard Pro ${cat.replace(/_/g, ' ')} Model ${s}`,
        `Enterprise-grade ${cat.toLowerCase().replace(/_/g, ' ')} unit with encrypted firmware`,
        cat,
        invAssetAccId,
        cogsAccId,
        nowSec,
        nowSec
      );

      // 100 movements per SKU = 50,000 movements total
      // 50 IN movements of +6 units (+600,000 centavos) = +300 units
      // 50 OUT movements of -2 units (-200,000 centavos) = -100 units
      // Net per SKU = 200 units, Net value = 20,000,000 centavos (₱200,000.00)
      for (let m = 1; m <= 100; m++) {
        txCounter++;
        const isReceipt = m <= 50;
        const qty = isReceipt ? 6 : -2;
        const val = qty * 100000;
        const monthNum = ((m - 1) % 10) + 1;
        const dayNum = ((m - 1) % 27) + 1;
        const txDate = `2026-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        insertInvTx.run(
          `invtx-dg-${txCounter}`,
          PREVIEW_COMPANY_ID,
          itemId,
          txDate,
          isReceipt ? 'IN' : 'OUT',
          qty,
          val,
          isReceipt ? `BILL-2026-${String(((txCounter - 1) % 10000) + 1).padStart(5, '0')}` : `SI-2026-${String(((txCounter - 1) % 10000) + 1).padStart(5, '0')}`,
          isReceipt ? 'Warehouse stock receipt' : 'Customer order dispatch',
          nowSec
        );
      }

      if (s <= 50) {
        insertStockAdj.run(
          `sadj-dg-${s}`,
          PREVIEW_COMPANY_ID,
          `SA-2026-${String(s).padStart(4, '0')}`,
          `2026-0${(s % 9) + 1}-18`,
          itemId,
          2,
          'Quarterly physical cycle count verification & calibration',
          cogsAccId,
          nowSec
        );
      }
    }
  })();

  // 11. Seed 10,000 Sales Invoices + Lines + Customer Payments + Credit Memos
  console.log('[SALES & AR] Seeding 10,000 Sales Invoices, Lines, Collections & Credit Memos...');
  const insertInvoice = sqlite.prepare(
    `INSERT INTO sales_invoices (
      id, company_id, customer_id, invoice_number, invoice_type, invoice_date, due_date,
      reference, total_amount, balance_due, status, journal_entry_id,
      created_by, submitted_by, approved_by, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'SERVICE_INVOICE', ?, ?, ?, 1120000, ?, ?, ?, 'usr-dg-clerk', 'usr-dg-accountant', 'usr-dg-approver', 1, ?, ?)`
  );
  const insertInvoiceLine = sqlite.prepare(
    `INSERT INTO sales_invoice_lines (
      id, invoice_id, account_id, tax_code_id, description, quantity, unit_price, amount, created_at
    ) VALUES (?, ?, ?, 'tc-dg-vat12', ?, 10, 112000, 1120000, ?)`
  );
  const insertCustPay = sqlite.prepare(
    `INSERT INTO customer_payments (
      id, company_id, customer_id, payment_number, official_receipt_number, payment_date,
      cash_account_id, amount, withholding_tax_amount, overpayment_amount, payment_method,
      reference, notes, status, journal_entry_id, created_by, submitted_by, approved_by, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'BANK_TRANSFER', ?, 'Electronic collection settlement', 'POSTED', ?, 'usr-dg-clerk', 'usr-dg-accountant', 'usr-dg-approver', 1, ?, ?)`
  );
  const insertCustPayApp = sqlite.prepare(
    `INSERT INTO customer_payment_applications (id, payment_id, invoice_id, applied_amount, withholding_amount, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  );
  const insertCreditMemo = sqlite.prepare(
    `INSERT INTO credit_memos (
      id, company_id, customer_id, credit_memo_number, memo_date, reason,
      total_amount, balance_remaining, status, journal_entry_id, created_by, submitted_by, approved_by, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 56000, 0, 'APPLIED', ?, 'usr-dg-accountant', 'usr-dg-accountant', 'usr-dg-approver', 1, ?, ?)`
  );

  // Aging bucket due dates relative to Nov 2026 so Current, 1-30, 31-60, 61-90, 91+ are all populated
  const agingSchedules = [
    { invDate: '2026-10-25', dueDate: '2026-11-25' }, // Current
    { invDate: '2026-09-20', dueDate: '2026-10-20' }, // 1-30 days
    { invDate: '2026-08-18', dueDate: '2026-09-18' }, // 31-60 days
    { invDate: '2026-07-15', dueDate: '2026-08-15' }, // 61-90 days
    { invDate: '2026-05-10', dueDate: '2026-06-10' }, // 91+ days
  ];

  sqlite.transaction(() => {
    for (let i = 1; i <= 10000; i++) {
      const invId = `sinv-dg-${i}`;
      const invNo = `SI-2026-${String(i).padStart(5, '0')}`;
      const custId = `cust-dg-${((i - 1) % 2500) + 1}`;
      const jeId = `je-dg-${i}`;

      let status = 'PAID';
      let amountPaid = 1120000;
      let balanceDue = 0;
      let invDate = `2026-${String(((i - 1) % 9) + 1).padStart(2, '0')}-${String(((i - 1) % 27) + 1).padStart(2, '0')}`;
      let dueDate = `2026-${String((i % 9) + 2).padStart(2, '0')}-${String(((i - 1) % 27) + 1).padStart(2, '0')}`;

      if (i > 6000 && i <= 8000) {
        status = 'PARTIAL';
        amountPaid = 560000;
        balanceDue = 560000;
        const sched = agingSchedules[i % agingSchedules.length];
        invDate = sched.invDate;
        dueDate = sched.dueDate;
      } else if (i > 8000) {
        status = 'POSTED';
        amountPaid = 0;
        balanceDue = 1120000;
        const sched = agingSchedules[i % agingSchedules.length];
        invDate = sched.invDate;
        dueDate = sched.dueDate;
      }

      insertInvoice.run(
        invId,
        PREVIEW_COMPANY_ID,
        custId,
        invNo,
        invDate,
        dueDate,
        `PO-CUST-${10000 + i}`,
        balanceDue,
        status,
        jeId,
        nowSec,
        nowSec
      );

      insertInvoiceLine.run(
        `sinvl-dg-${i}`,
        invId,
        revAccId,
        `Managed Access Control & Biometric Subscription Package #${i}`,
        nowSec
      );

      if (amountPaid > 0 && i <= 2500) {
        const payId = `cpay-dg-${i}`;
        insertCustPay.run(
          payId,
          PREVIEW_COMPANY_ID,
          custId,
          `CR-2026-${String(i).padStart(5, '0')}`,
          `OR-2026-${String(i).padStart(5, '0')}`,
          invDate,
          cashAccId,
          amountPaid,
          `BPI-TRF-${900000 + i}`,
          jeId,
          nowSec,
          nowSec
        );
        insertCustPayApp.run(`cpapp-dg-${i}`, payId, invId, amountPaid, nowSec);
      }

      if (i <= 25) {
        insertCreditMemo.run(
          `cm-dg-${i}`,
          PREVIEW_COMPANY_ID,
          custId,
          `CM-2026-${String(i).padStart(4, '0')}`,
          invDate,
          'SLA volume rebate adjustment',
          jeId,
          nowSec,
          nowSec
        );
      }
    }
  })();

  // 12. Seed 10,000 Purchase Bills + Lines + POs + GRNs + Supplier Payments + Debit Memos
  console.log('[PROCUREMENT & AP] Seeding 10,000 Purchase Bills, 500 POs/GRNs, Supplier Payments & Debit Memos...');
  const insertPo = sqlite.prepare(
    `INSERT INTO purchase_orders (
      id, company_id, vendor_id, po_number, po_date, expected_delivery_date,
      total_amount, status, created_by, approved_by, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 560000, 'CLOSED', 'usr-dg-clerk', 'usr-dg-approver', 1, ?, ?)`
  );
  const insertPoLine = sqlite.prepare(
    `INSERT INTO purchase_order_lines (
      id, po_id, item_id, description, quantity_ordered, quantity_received, unit_price, amount, created_at
    ) VALUES (?, ?, ?, ?, 5, 5, 112000, 560000, ?)`
  );
  const insertGrn = sqlite.prepare(
    `INSERT INTO goods_receipt_notes (
      id, company_id, po_id, grn_number, receipt_date, delivery_note_no, status, received_by, version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', 'usr-dg-bookkeeper', 1, ?)`
  );
  const insertBill = sqlite.prepare(
    `INSERT INTO purchase_bills (
      id, company_id, vendor_id, bill_number, bill_date, due_date, reference, notes,
      total_amount, balance_due, status, journal_entry_id,
      created_by, submitted_by, approved_by, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 560000, ?, ?, ?, 'usr-dg-clerk', 'usr-dg-accountant', 'usr-dg-approver', 1, ?, ?)`
  );
  const insertBillLine = sqlite.prepare(
    `INSERT INTO purchase_bill_lines (
      id, bill_id, account_id, tax_code_id, description, quantity, unit_price, amount, created_at
    ) VALUES (?, ?, ?, 'tc-dg-vat12', ?, 5, 112000, 560000, ?)`
  );
  const insertSuppPay = sqlite.prepare(
    `INSERT INTO supplier_payments (
      id, company_id, vendor_id, payment_number, payment_date, amount, cash_account_id,
      withholding_tax_amount, withholding_tax_account_id, overpayment_amount, payment_method,
      reference, notes, status, journal_entry_id, created_by, submitted_by, approved_by, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 10000, ?, 0, 'CHECK', ?, 'Supplier settlement with Form 2307', 'POSTED', ?, 'usr-dg-clerk', 'usr-dg-accountant', 'usr-dg-approver', 1, ?, ?)`
  );
  const insertSuppPayApp = sqlite.prepare(
    `INSERT INTO supplier_payment_applications (id, payment_id, bill_id, applied_amount, withholding_amount, created_at)
     VALUES (?, ?, ?, ?, 10000, ?)`
  );
  const insertDebitMemo = sqlite.prepare(
    `INSERT INTO debit_memos (
      id, company_id, vendor_id, debit_memo_number, memo_date, reason,
      total_amount, balance_remaining, status, journal_entry_id, created_by, submitted_by, approved_by, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 28000, 0, 'APPLIED', ?, 'usr-dg-accountant', 'usr-dg-accountant', 'usr-dg-approver', 1, ?, ?)`
  );

  sqlite.transaction(() => {
    for (let p = 1; p <= 500; p++) {
      const poId = `po-dg-${p}`;
      const vendId = `vend-dg-${p}`;
      const itemId = `inv-dg-${p}`;
      const poDate = `2026-0${(p % 9) + 1}-05`;
      insertPo.run(poId, PREVIEW_COMPANY_ID, vendId, `PO-2026-${String(p).padStart(4, '0')}`, poDate, `2026-0${(p % 9) + 1}-12`, nowSec, nowSec);
      insertPoLine.run(`pol-dg-${p}`, poId, itemId, `Security Hardware Batch #${p}`, nowSec);
      insertGrn.run(
        `grn-dg-${p}`,
        PREVIEW_COMPANY_ID,
        poId,
        `GRN-2026-${String(p).padStart(4, '0')}`,
        `2026-0${(p % 9) + 1}-10`,
        `DR-2026-${5000 + p}`,
        nowSec
      );
    }

    for (let i = 1; i <= 10000; i++) {
      const billId = `pbill-dg-${i}`;
      const billNo = `BILL-2026-${String(i).padStart(5, '0')}`;
      const vendId = `vend-dg-${((i - 1) % 2500) + 1}`;
      const jeId = `je-dg-${10000 + i}`;

      let status = 'PAID';
      let amountPaid = 550000;
      let balanceDue = 0;
      let billDate = `2026-${String(((i - 1) % 9) + 1).padStart(2, '0')}-${String(((i - 1) % 27) + 1).padStart(2, '0')}`;
      let dueDate = `2026-${String((i % 9) + 2).padStart(2, '0')}-${String(((i - 1) % 27) + 1).padStart(2, '0')}`;

      if (i > 7000 && i <= 8000) {
        status = 'PARTIAL';
        amountPaid = 275000;
        balanceDue = 275000;
        const sched = agingSchedules[i % agingSchedules.length];
        billDate = sched.invDate;
        dueDate = sched.dueDate;
      } else if (i > 8000) {
        status = 'POSTED';
        amountPaid = 0;
        balanceDue = 550000;
        const sched = agingSchedules[i % agingSchedules.length];
        billDate = sched.invDate;
        dueDate = sched.dueDate;
      }

      insertBill.run(
        billId,
        PREVIEW_COMPANY_ID,
        vendId,
        billNo,
        billDate,
        dueDate,
        `SI-VEND-${50000 + i}`,
        `Hardware Component & Sensor Supply Bill #${i}`,
        balanceDue,
        status,
        jeId,
        nowSec,
        nowSec
      );

      insertBillLine.run(
        `pbilll-dg-${i}`,
        billId,
        cogsAccId,
        `Biometric Reader & Controller Module Supply #${i}`,
        nowSec
      );

      if (amountPaid > 0 && i <= 2500) {
        const payId = `spay-dg-${i}`;
        insertSuppPay.run(
          payId,
          PREVIEW_COMPANY_ID,
          vendId,
          `CV-2026-${String(i).padStart(5, '0')}`,
          billDate,
          amountPaid,
          cashAccId,
          ewtAccId,
          `CHK-${700000 + i}`,
          jeId,
          nowSec,
          nowSec
        );
        insertSuppPayApp.run(`spapp-dg-${i}`, payId, billId, amountPaid, nowSec);
      }

      if (i <= 25) {
        insertDebitMemo.run(
          `dm-dg-${i}`,
          PREVIEW_COMPANY_ID,
          vendId,
          `DM-2026-${String(i).padStart(4, '0')}`,
          billDate,
          'Defective sensor batch return credit',
          jeId,
          nowSec,
          nowSec
        );
      }
    }
  })();

  // 13. Seed 100 Fixed Assets & 1,200 Depreciation Schedules
  console.log('[FIXED ASSETS] Seeding 100 Fixed Assets and 1,200 Depreciation Schedules...');
  const faAccId = accountIdByCode.get('1510')!;
  const accumDepAccId = accountIdByCode.get('1520')!;
  const depExpAccId = accountIdByCode.get('6060')!;

  const insertAsset = sqlite.prepare(
    `INSERT INTO fixed_assets (
      id, company_id, asset_tag, asset_name, category, acquisition_date,
      acquisition_cost, salvage_value, useful_life_months, depreciation_method,
      asset_account_id, accumulated_dep_account_id, depreciation_expense_account_id,
      status, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '2026-01-05', 12000000, 0, 60, 'STRAIGHT_LINE', ?, ?, ?, 'ACTIVE', 1, ?, ?)`
  );
  const insertDepSched = sqlite.prepare(
    `INSERT INTO depreciation_schedules (
      id, asset_id, company_id, period_month, depreciation_amount,
      accumulated_depreciation, book_value, status, journal_entry_id, created_at
    ) VALUES (?, ?, ?, ?, 200000, ?, ?, ?, ?, ?)`
  );

  sqlite.transaction(() => {
    for (let a = 1; a <= 100; a++) {
      const assetId = `fa-dg-${a}`;
      insertAsset.run(
        assetId,
        PREVIEW_COMPANY_ID,
        `FA-DG-${String(a).padStart(4, '0')}`,
        `Enterprise Server Rack & Biometric Appliance #${a}`,
        a % 2 === 0 ? 'IT_INFRASTRUCTURE' : 'SECURITY_EQUIPMENT',
        faAccId,
        accumDepAccId,
        depExpAccId,
        nowSec,
        nowSec
      );

      for (let m = 1; m <= 12; m++) {
        const mm = String(m).padStart(2, '0');
        const isPosted = m <= 6;
        const accum = m * 200000;
        const bookVal = 12000000 - accum;
        insertDepSched.run(
          `depsch-dg-${a}-${mm}`,
          assetId,
          PREVIEW_COMPANY_ID,
          `2026-${mm}`,
          accum,
          bookVal,
          isPosted ? 'POSTED' : 'PENDING',
          isPosted ? `je-dg-${19500 + a}` : null,
          nowSec
        );
      }
    }
  })();

  // 14. Seed 200 Employees & 12 Payroll Runs (2,400 Payroll Items)
  console.log('[PAYROLL] Seeding 200 Fictional Employees across 12 Payroll Periods (2,400 Payroll Items)...');
  const insertEmployee = sqlite.prepare(
    `INSERT INTO employees (
      id, company_id, employee_no, first_name, last_name, email, tin, sss_no, philhealth_no, pagibig_no,
      position, department, monthly_basic_salary, daily_rate, hourly_rate,
      custom_sss_ee, custom_sss_er, custom_philhealth_ee, custom_philhealth_er,
      custom_pagibig_ee, custom_pagibig_er, custom_withholding_tax, status, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4000000, 181818, 22727, 135000, 288000, 100000, 100000, 20000, 20000, 250000, 'ACTIVE', 1, ?, ?)`
  );
  const insertPayrollRun = sqlite.prepare(
    `INSERT INTO payroll_runs (
      id, company_id, payroll_period, start_date, end_date, payment_date,
      total_gross_pay, total_sss, total_philhealth, total_pagibig, total_withholding_tax, total_net_pay,
      status, journal_entry_id, created_by, approved_by, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 800000000, 27000000, 20000000, 4000000, 50000000, 699000000, 'POSTED', ?, 'usr-dg-payroll', 'usr-dg-owner', 1, ?, ?)`
  );
  const insertPayrollItem = sqlite.prepare(
    `INSERT INTO payroll_items (
      id, payroll_run_id, employee_id, basic_pay, overtime_pay, holiday_pay, night_diff_pay,
      gross_pay, sss_employee, sss_employer, philhealth_employee, philhealth_employer,
      pagibig_employee, pagibig_employer, withholding_tax, total_deductions, net_pay, created_at
    ) VALUES (?, ?, ?, 4000000, 0, 0, 0, 4000000, 135000, 288000, 100000, 100000, 20000, 20000, 250000, 505000, 3495000, ?)`
  );

  const phFirstNames = ['Juan', 'Maria', 'Jose', 'Angela', 'Miguel', 'Bea', 'Paolo', 'Katrina', 'Gabriel', 'Camille', 'Rafael', 'Sofia', 'Lorenzo', 'Hannah', 'Antonio', 'Patricia', 'Carlos', 'Denise', 'Marco', 'Jasmine'];
  const phLastNames = ['Dela Cruz', 'Santos', 'Reyes', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Flores', 'Castillo', 'Villanueva', 'Ramos', 'Gonzales', 'Aquino', 'Navarro', 'Mercado', 'Salazar', 'Pascual', 'Soriano', 'Tolentino'];

  sqlite.transaction(() => {
    for (let e = 1; e <= 200; e++) {
      const fn = phFirstNames[e % phFirstNames.length];
      const ln = phLastNames[(e * 3) % phLastNames.length];
      const dept = departments[e % departments.length].name;
      insertEmployee.run(
        `emp-dg-${e}`,
        PREVIEW_COMPANY_ID,
        `EMP-DG-${String(e).padStart(4, '0')}`,
        fn,
        ln,
        `emp${e}@stress-dg.ledgerai.ph`,
        `${String(300 + e).padStart(3, '0')}-${String(400 + e).padStart(3, '0')}-${String(500 + e).padStart(3, '0')}-000`,
        `34-${String(7000000 + e)}-8`,
        `12-${String(900000000 + e)}-5`,
        `1210-${String(4000 + e)}-${String(8000 + e)}`,
        e % 5 === 0 ? 'Senior Systems Engineer' : 'Security Implementation Specialist',
        dept,
        nowSec,
        nowSec
      );
    }

    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      const runId = `prun-dg-2026-${mm}`;
      const endDay = String(monthDays[m - 1]).padStart(2, '0');
      insertPayrollRun.run(
        runId,
        PREVIEW_COMPANY_ID,
        `2026-${mm} Monthly Payroll`,
        `2026-${mm}-01`,
        `2026-${mm}-${endDay}`,
        `2026-${mm}-28`,
        `je-dg-${19600 + m}`,
        nowSec,
        nowSec
      );

      for (let e = 1; e <= 200; e++) {
        insertPayrollItem.run(`pitem-dg-${m}-${e}`, runId, `emp-dg-${e}`, nowSec);
      }
    }
  })();

  // 15. Seed 20,000 Posted Journal Entries & 100,000 Journal Lines (Strictly Balanced & Subledger-Reconciled!)
  console.log('[GENERAL LEDGER] Seeding 20,000 Posted Journal Entries & 100,000 Balanced Journal Lines...');
  const insertJe = sqlite.prepare(
    `INSERT INTO journal_entries (
      id, company_id, journal_number, entry_date, accounting_period_id, description,
      source_type, source_id, status, created_by, submitted_by, approved_by, posted_by,
      submitted_at, approved_at, posted_at, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', 'usr-dg-bookkeeper', 'usr-dg-accountant', 'usr-dg-approver', 'usr-dg-owner', ?, ?, ?, 1, ?, ?)`
  );
  const insertJl = sqlite.prepare(
    `INSERT INTO journal_lines (
      id, journal_entry_id, account_id, description, debit, credit, line_number,
      department_id, project_id, cost_center_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const eqCapAccId = accountIdByCode.get('3010')!;
  const salAccId = accountIdByCode.get('6010')!;
  const sssPayAccId = accountIdByCode.get('2040')!;
  const rentAccId = accountIdByCode.get('6020')!;
  const utilAccId = accountIdByCode.get('6030')!;

  sqlite.transaction(() => {
    let lineSeq = 0;

    // Group A: JEs 1..6,000 -> Paid Sales Invoices (5 lines each = 30,000 lines)
    for (let i = 1; i <= 6000; i++) {
      const jeId = `je-dg-${i}`;
      const mm = String(((i - 1) % 9) + 1).padStart(2, '0');
      const dd = String(((i - 1) % 27) + 1).padStart(2, '0');
      const cc = departments[i % departments.length].id;
      const prj = `proj-dg-0${(i % 8) + 1}`;
      insertJe.run(
        jeId,
        PREVIEW_COMPANY_ID,
        `JE-2026-${String(i).padStart(6, '0')}`,
        `2026-${mm}-${dd}`,
        `per-dg-2026-${mm}`,
        `Sales Invoice & Official Receipt Settlement SI-2026-${String(i).padStart(5, '0')}`,
        'SALES_INVOICE',
        `sinv-dg-${i}`,
        nowSec,
        nowSec,
        nowSec,
        nowSec,
        nowSec
      );
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, arAccId, 'AR Billing', 1120000, 0, 1, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, revAccId, 'Service & Hardware Revenue', 0, 1000000, 2, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, outVatAccId, '12% Output VAT', 0, 120000, 3, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, cashAccId, 'OR Collection Cash in Bank', 1120000, 0, 4, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, arAccId, 'AR Settlement Applied', 0, 1120000, 5, cc, prj, cc, nowSec);
    }

    // Group B: JEs 6,001..8,000 -> Partially Paid Sales Invoices (2,000 JEs, 5 lines each = 10,000 lines)
    // Net AR 1030 per JE = +1,120,000 - 560,000 = +560,000 (Total = 1,120,000,000 centavos)
    for (let i = 6001; i <= 8000; i++) {
      const jeId = `je-dg-${i}`;
      const mm = String(((i - 1) % 9) + 1).padStart(2, '0');
      const dd = String(((i - 1) % 27) + 1).padStart(2, '0');
      const cc = departments[i % departments.length].id;
      const prj = `proj-dg-0${(i % 8) + 1}`;
      insertJe.run(
        jeId,
        PREVIEW_COMPANY_ID,
        `JE-2026-${String(i).padStart(6, '0')}`,
        `2026-${mm}-${dd}`,
        `per-dg-2026-${mm}`,
        `Sales Invoice & Partial Collection SI-2026-${String(i).padStart(5, '0')}`,
        'SALES_INVOICE',
        `sinv-dg-${i}`,
        nowSec,
        nowSec,
        nowSec,
        nowSec,
        nowSec
      );
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, arAccId, 'AR Billing', 1120000, 0, 1, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, revAccId, 'Service & Hardware Revenue', 0, 1000000, 2, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, outVatAccId, '12% Output VAT', 0, 120000, 3, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, cashAccId, 'Partial OR Collection (50%)', 560000, 0, 4, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, arAccId, 'Partial AR Application', 0, 560000, 5, cc, prj, cc, nowSec);
    }

    // Group C: JEs 8,001..10,000 -> Open Posted Sales Invoices (2,000 JEs, 5 lines each = 10,000 lines)
    // Net AR 1030 per JE = +1,120,000 (Total = 2,240,000,000 centavos)
    // Combined AR 1030 across Group B + Group C = 3,360,000,000 centavos (₱33,600,000.00 — exact match to AR Subledger!)
    for (let i = 8001; i <= 10000; i++) {
      const jeId = `je-dg-${i}`;
      const mm = String(((i - 1) % 9) + 1).padStart(2, '0');
      const dd = String(((i - 1) % 27) + 1).padStart(2, '0');
      const cc = departments[i % departments.length].id;
      const prj = `proj-dg-0${(i % 8) + 1}`;
      insertJe.run(
        jeId,
        PREVIEW_COMPANY_ID,
        `JE-2026-${String(i).padStart(6, '0')}`,
        `2026-${mm}-${dd}`,
        `per-dg-2026-${mm}`,
        `Open Sales Invoice Billing SI-2026-${String(i).padStart(5, '0')}`,
        'SALES_INVOICE',
        `sinv-dg-${i}`,
        nowSec,
        nowSec,
        nowSec,
        nowSec,
        nowSec
      );
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, arAccId, 'AR Billing — Hardware Deliverable', 700000, 0, 1, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, arAccId, 'AR Billing — Annual SLA Retainer', 420000, 0, 2, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, revAccId, 'Hardware Deliverable Revenue', 0, 600000, 3, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, revAccId, 'Annual SLA Retainer Revenue', 0, 400000, 4, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, outVatAccId, '12% Output VAT', 0, 120000, 5, cc, prj, cc, nowSec);
    }

    // Group D: JEs 10,001..17,000 -> Paid Purchase Bills (7,000 JEs, 5 lines each = 35,000 lines)
    for (let i = 10001; i <= 17000; i++) {
      const billIdx = i - 10000;
      const jeId = `je-dg-${i}`;
      const mm = String(((i - 1) % 9) + 1).padStart(2, '0');
      const dd = String(((i - 1) % 27) + 1).padStart(2, '0');
      const cc = departments[i % departments.length].id;
      const prj = `proj-dg-0${(i % 8) + 1}`;
      insertJe.run(
        jeId,
        PREVIEW_COMPANY_ID,
        `JE-2026-${String(i).padStart(6, '0')}`,
        `2026-${mm}-${dd}`,
        `per-dg-2026-${mm}`,
        `Purchase Bill & Check Settlement BILL-2026-${String(billIdx).padStart(5, '0')}`,
        'PURCHASE_BILL',
        `pbill-dg-${billIdx}`,
        nowSec,
        nowSec,
        nowSec,
        nowSec,
        nowSec
      );
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, cogsAccId, 'Hardware Component Direct Cost', 400000, 0, 1, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, utilAccId, 'Logistics & Field Deployment Cost', 100000, 0, 2, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, inVatAccId, '12% Input VAT', 60000, 0, 3, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, ewtAccId, '2% EWT Withheld (ATC WC160)', 0, 10000, 4, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, cashAccId, 'Supplier Check Disbursement', 0, 550000, 5, cc, prj, cc, nowSec);
    }

    // Group E: JEs 17,001..18,000 -> Partially Paid Purchase Bills (1,000 JEs, 5 lines each = 5,000 lines)
    // Net AP 2010 Credit per JE = 275,000 (Total = 275,000,000 centavos)
    for (let i = 17001; i <= 18000; i++) {
      const billIdx = i - 10000;
      const jeId = `je-dg-${i}`;
      const mm = String(((i - 1) % 9) + 1).padStart(2, '0');
      const dd = String(((i - 1) % 27) + 1).padStart(2, '0');
      const cc = departments[i % departments.length].id;
      const prj = `proj-dg-0${(i % 8) + 1}`;
      insertJe.run(
        jeId,
        PREVIEW_COMPANY_ID,
        `JE-2026-${String(i).padStart(6, '0')}`,
        `2026-${mm}-${dd}`,
        `per-dg-2026-${mm}`,
        `Partially Paid Supplier Bill BILL-2026-${String(billIdx).padStart(5, '0')}`,
        'PURCHASE_BILL',
        `pbill-dg-${billIdx}`,
        nowSec,
        nowSec,
        nowSec,
        nowSec,
        nowSec
      );
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, cogsAccId, 'Hardware Component Direct Cost', 500000, 0, 1, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, inVatAccId, '12% Input VAT', 60000, 0, 2, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, ewtAccId, '2% EWT Withheld (ATC WC160)', 0, 10000, 3, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, cashAccId, '50% Partial Supplier Payment', 0, 275000, 4, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, apAccId, 'Remaining Open Accounts Payable', 0, 275000, 5, cc, prj, cc, nowSec);
    }

    // Group F: JEs 18,001..19,000 -> Open Purchase Bills Batch 1 (1,000 JEs, 5 lines each = 5,000 lines)
    // Net AP 2010 Credit per JE = 550,000 (Total = 550,000,000 centavos)
    for (let i = 18001; i <= 19000; i++) {
      const billIdx = i - 10000;
      const jeId = `je-dg-${i}`;
      const mm = String(((i - 1) % 9) + 1).padStart(2, '0');
      const dd = String(((i - 1) % 27) + 1).padStart(2, '0');
      const cc = departments[i % departments.length].id;
      const prj = `proj-dg-0${(i % 8) + 1}`;
      insertJe.run(
        jeId,
        PREVIEW_COMPANY_ID,
        `JE-2026-${String(i).padStart(6, '0')}`,
        `2026-${mm}-${dd}`,
        `per-dg-2026-${mm}`,
        `Open Supplier Bill BILL-2026-${String(billIdx).padStart(5, '0')}`,
        'PURCHASE_BILL',
        `pbill-dg-${billIdx}`,
        nowSec,
        nowSec,
        nowSec,
        nowSec,
        nowSec
      );
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, cogsAccId, 'Hardware Supply Cost', 350000, 0, 1, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, rentAccId, 'Warehouse & Staging Lease Share', 150000, 0, 2, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, inVatAccId, '12% Input VAT', 60000, 0, 3, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, ewtAccId, '2% EWT Withheld (ATC WC160)', 0, 10000, 4, cc, prj, cc, nowSec);
      insertJl.run(`jl-dg-${++lineSeq}`, jeId, apAccId, 'Open Accounts Payable', 0, 550000, 5, cc, prj, cc, nowSec);
    }

    // Group G: JEs 19,001..20,000 -> Open Purchase Bills Batch 2 + Inventory Valuation + Fixed Assets + Payroll + Equity Capital (1,000 JEs, 5 lines each = 5,000 lines)
    // Combined AP 2010 across Group E + F + G = 275M + 550M + 550M = 1,375,000,000 centavos (₱13,750,000.00 — exact match to Open AP Subledger!)
    for (let i = 19001; i <= 20000; i++) {
      const billIdx = i - 10000;
      const jeId = `je-dg-${i}`;
      const mm = String(((i - 1) % 9) + 1).padStart(2, '0');
      const dd = String(((i - 1) % 27) + 1).padStart(2, '0');
      const cc = departments[i % departments.length].id;
      const prj = `proj-dg-0${(i % 8) + 1}`;

      insertJe.run(
        jeId,
        PREVIEW_COMPANY_ID,
        `JE-2026-${String(i).padStart(6, '0')}`,
        `2026-${mm}-${dd}`,
        `per-dg-2026-${mm}`,
        `Open Supplier Bill BILL-2026-${String(billIdx).padStart(5, '0')} & Capital/Asset Allocation`,
        'PURCHASE_BILL',
        `pbill-dg-${billIdx}`,
        nowSec,
        nowSec,
        nowSec,
        nowSec,
        nowSec
      );

      if (i <= 19500) {
        // 500 JEs: Inventory Stock Capitalization + Open Bill
        // Debits: 1080 Inventory (20,000,000) + 5010 COGS (500,000) + 1050 Input VAT (60,000) = 20,560,000
        // Credits: 2010 AP (550,000) + 3010 Owner's Equity/Capital (20,010,000) = 20,560,000
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, invAssetAccId, `Inventory Stock Valuation SKU-DG-${String(i - 19000).padStart(4, '0')}`, 20000000, 0, 1, cc, prj, cc, nowSec);
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, cogsAccId, 'Bill Direct Cost', 500000, 0, 2, cc, prj, cc, nowSec);
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, inVatAccId, '12% Input VAT', 60000, 0, 3, cc, prj, cc, nowSec);
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, apAccId, 'Open Accounts Payable', 0, 550000, 4, cc, prj, cc, nowSec);
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, eqCapAccId, 'Working Capital Inventory Reserve', 0, 20010000, 5, cc, prj, cc, nowSec);
      } else if (i <= 19600) {
        // 100 JEs: Fixed Asset Capitalization + Depreciation + Open Bill
        // Debits: 1510 Office Equipment (12,000,000) + 6060 Dep Exp (1,200,000) = 13,200,000
        // Credits: 1520 Accum Dep (1,200,000) + 2010 AP (550,000) + 1010 Cash (11,450,000) = 13,200,000
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, faAccId, `Fixed Asset Capitalization FA-DG-${String(i - 19500).padStart(4, '0')}`, 12000000, 0, 1, cc, prj, cc, nowSec);
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, depExpAccId, '6-Month Straight-Line Depreciation Expense', 1200000, 0, 2, cc, prj, cc, nowSec);
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, accumDepAccId, 'Accumulated Depreciation — Equipment', 0, 1200000, 3, cc, prj, cc, nowSec);
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, apAccId, 'Open Accounts Payable', 0, 550000, 4, cc, prj, cc, nowSec);
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, cashAccId, 'Capital Equipment Settlement', 0, 11450000, 5, cc, prj, cc, nowSec);
      } else {
        // 400 JEs (19,601..20,000): Payroll Salary & Statutory Deductions + Open Bill
        // Debits: 6010 Salaries (2,550,000) = 2,550,000
        // Credits: 2010 AP (550,000) + 2035 WTC (250,000) + 2040 SSS/PHIC/HDMF (255,000) + 1010 Cash (1,495,000) = 2,550,000
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, salAccId, 'Monthly Payroll Salaries & Wages', 2550000, 0, 1, cc, prj, cc, nowSec);
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, apAccId, 'Open Accounts Payable', 0, 550000, 2, cc, prj, cc, nowSec);
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, wtcAccId, 'Withholding Tax on Compensation (1601-C)', 0, 250000, 3, cc, prj, cc, nowSec);
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, sssPayAccId, 'SSS, PhilHealth & Pag-IBIG Contributions Payable', 0, 255000, 4, cc, prj, cc, nowSec);
        insertJl.run(`jl-dg-${++lineSeq}`, jeId, cashAccId, 'Net Payroll Disbursement', 0, 1495000, 5, cc, prj, cc, nowSec);
      }
    }
  })();

  // 16. Seed 10,000 Document Records + Physical Encrypted LAISDOC1 Attachments on Disk
  console.log('[DOCUMENTS] Seeding 10,000 Document Records & Encrypted LAISDOC1 AES-256-GCM Files...');
  const originalsDir = path.join(docDir, 'originals');
  const tempDir = path.join(docDir, 'temp');
  const quarantineDir = path.join(docDir, 'quarantine');
  await fsp.mkdir(originalsDir, { recursive: true });
  await fsp.mkdir(tempDir, { recursive: true });
  await fsp.mkdir(quarantineDir, { recursive: true });

  const insertDoc = sqlite.prepare(
    `INSERT INTO documents (
      id, company_id, entity_type, entity_id, document_type, file_name, original_file_name,
      file_type, file_size, file_hash, file_path, source, linked_transaction_type,
      linked_transaction_id, uploaded_by, status, encryption_status, storage_tier,
      ocr_status, verification_status, confidence_score, ocr_result,
      extracted_merchant, extracted_tin, extracted_invoice_number, extracted_date,
      extracted_total_amount, extracted_vat_amount, extraction_engine, page_count,
      verified_by, verified_at, is_demo, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, 'WEB_UPLOAD', ?, ?, 'usr-dg-clerk', 'VERIFIED', 'ENCRYPTED', 'originals', 'COMPLETED', ?, 96, ?, ?, '205-419-882-000', ?, '2026-10-15', 1120000, 120000, 'LOCAL_TESSERACT_WASM', 1, ?, ?, 0, 1, ?, ?)`
  );
  const insertDocVer = sqlite.prepare(
    `INSERT INTO document_versions (
      id, document_id, company_id, version_number, file_name, original_file_name,
      file_type, file_size, file_path, file_hash, change_type, change_reason,
      ocr_status, ocr_engine, ocr_extracted_data, status, uploaded_by,
      uploaded_by_name, uploaded_by_role, uploaded_at
    ) VALUES (?, ?, ?, 1, ?, ?, 'application/pdf', ?, ?, ?, 'INITIAL_UPLOAD', 'Initial encrypted document ingestion', 'COMPLETED', 'LOCAL_TESSERACT_WASM', ?, 'ACTIVE', 'usr-dg-clerk', 'Clarisse Mendoza', 'Tax & AP Specialist', ?)`
  );
  const insertOcrHist = sqlite.prepare(
    `INSERT INTO document_ocr_history (
      id, document_id, version_id, company_id, ocr_engine, model_version,
      status, confidence_score, extracted_data, performed_by, performed_at, processing_time_ms
    ) VALUES (?, ?, ?, ?, 'LOCAL_TESSERACT_WASM', 'v5.0-ph-trained', 'COMPLETED', 96, ?, 'usr-dg-clerk', ?, 18)`
  );

  // Pre-encrypt 100 real physical LAISDOC1 AES-256-GCM files on disk bound to doc-dg-1..doc-dg-100
  const docTemplates: Array<{
    fileHash: string;
    plainSizeBytes: number;
    cipherSizeBytes: number;
    storedName: string;
    absPath: string;
  }> = [];

  for (let t = 1; t <= 100; t++) {
    const docId = `doc-dg-${t}`;
    const storedName = `${docId}.enc`;
    const absPath = path.join(originalsDir, storedName);
    const origName = `supplier_invoice_2026_${String(t).padStart(5, '0')}.pdf`;
    const sampleText = `DESKGUARD SOLUTIONS — STRESS TEST PREVIEW\nBIR OFFICIAL RECEIPT / SUPPLIER INVOICE TEMPLATE #${t}\nTIN: 009-842-510-000 | RDO: 039\nTotal Amount: PHP ${(11200 + t * 100).toFixed(2)} (VAT Inclusive)\n`;
    const encRes = DocumentEncryptionService.encryptBuffer(
      PREVIEW_COMPANY_ID,
      docId,
      Buffer.from(sampleText, 'utf8'),
      {
        originalFileName: origName,
        contentType: 'application/pdf',
      }
    );
    fs.writeFileSync(absPath, encRes.encryptedBuffer);
    docTemplates.push({
      fileHash: encRes.fileHash,
      plainSizeBytes: encRes.plainSizeBytes,
      cipherSizeBytes: encRes.cipherSizeBytes,
      storedName,
      absPath,
    });
  }

  const docTypes = ['SUPPLIER_INVOICE', 'OFFICIAL_RECEIPT', 'SALES_INVOICE', 'BANK_STATEMENT', 'BIR_TAX_RETURN'];
  sqlite.transaction(() => {
    for (let i = 1; i <= 10000; i++) {
      const docId = `doc-dg-${i}`;
      const tpl = i <= 100 ? docTemplates[i - 1] : docTemplates[(i - 1) % 100];
      const docType = docTypes[i % docTypes.length];
      const origName = i <= 100
        ? `supplier_invoice_2026_${String(i).padStart(5, '0')}.pdf`
        : `${docType.toLowerCase()}_2026_${String(i).padStart(5, '0')}.pdf`;
      const isVerified = i <= 9500 ? 'VERIFIED' : 'UNVERIFIED';
      const merchant = `Archipelago Security Supplier ${((i - 1) % 2500) + 1} Inc.`;
      const docNo = `DOC-2026-${String(i).padStart(5, '0')}`;
      const structured = JSON.stringify({
        supplierName: merchant,
        tin: '205-419-882-000',
        documentNumber: docNo,
        documentDate: '2026-10-15',
        totalAmount: 11200,
        vatAmount: 1200,
        netAmount: 10000,
        taxType: 'VAT',
      });
      const entType = i % 2 === 0 ? 'PURCHASE_BILL' : 'SALES_INVOICE';
      const entId = i % 2 === 0 ? `pbill-dg-${i}` : `sinv-dg-${i}`;

      insertDoc.run(
        docId,
        PREVIEW_COMPANY_ID,
        entType,
        entId,
        docType,
        tpl.storedName,
        origName,
        tpl.plainSizeBytes,
        tpl.fileHash,
        tpl.absPath,
        entType,
        entId,
        isVerified,
        structured,
        merchant,
        docNo,
        isVerified === 'VERIFIED' ? 'usr-dg-accountant' : null,
        isVerified === 'VERIFIED' ? nowSec : null,
        nowSec,
        nowSec
      );

      insertDocVer.run(
        `docver-dg-${i}`,
        docId,
        PREVIEW_COMPANY_ID,
        tpl.storedName,
        origName,
        tpl.plainSizeBytes,
        tpl.absPath,
        tpl.fileHash,
        structured,
        nowSec
      );

      if (i <= 1000) {
        insertOcrHist.run(
          `ocrh-dg-${i}`,
          docId,
          `docver-dg-${i}`,
          PREVIEW_COMPANY_ID,
          structured,
          nowSec
        );
      }
    }
  })();

  // 17. Seed 5,000 Approval & Workflow Records (2,500 Workflows + 2,500 Steps)
  console.log('[APPROVALS] Seeding 5,000 Approval Workflow & Step Records...');
  const insertWf = sqlite.prepare(
    `INSERT INTO approval_workflows (
      id, company_id, entity_type, entity_id, record_reference, workflow_type,
      status, current_step_order, total_steps, amount_centavos, department_id,
      submitted_by, submitted_by_name, submitted_at, sla_status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'TIERED_FINANCIAL', ?, 1, 1, 1120000, 'cc-dg-02', 'usr-dg-clerk', 'Clarisse Mendoza', ?, 'ON_TRACK', 'usr-dg-clerk', ?, ?)`
  );
  const insertStep = sqlite.prepare(
    `INSERT INTO approval_steps (
      id, workflow_id, company_id, entity_type, entity_id, step_order, step_name,
      approval_mode, required_role, assigned_user_id, assigned_user_name,
      assigned_approver_id, assigned_approver_name, status, decision, assigned_at, sla_status, created_at
    ) VALUES (?, ?, ?, ?, ?, 1, 'Senior Approver Financial Review', 'SINGLE', 'Approver', 'usr-dg-approver', 'Victor Reyes', 'usr-dg-approver', 'Victor Reyes', ?, ?, ?, 'ON_TRACK', ?)`
  );

  sqlite.transaction(() => {
    for (let w = 1; w <= 2500; w++) {
      const wfId = `wf-dg-${w}`;
      const isBill = w % 2 === 0;
      const entType = isBill ? 'PURCHASE_BILL' : 'SALES_INVOICE';
      const entId = isBill ? `pbill-dg-${w}` : `sinv-dg-${w}`;
      const ref = isBill ? `BILL-2026-${String(w).padStart(5, '0')}` : `SI-2026-${String(w).padStart(5, '0')}`;
      const isPending = w > 2400; // 100 pending approvals in the queue + 2,400 completed
      const wfStatus = isPending ? 'PENDING' : 'APPROVED';
      const decision = isPending ? null : 'APPROVED';

      insertWf.run(wfId, PREVIEW_COMPANY_ID, entType, entId, ref, wfStatus, nowSec, nowSec, nowSec);
      insertStep.run(`wfstep-dg-${w}`, wfId, PREVIEW_COMPANY_ID, entType, entId, wfStatus, decision, nowSec, nowSec);
    }
  })();

  // 18. Seed 20,000 Audit Trail Events & 500 Activity Notifications
  console.log('[AUDIT & ACTIVITY] Seeding 20,000 Immutable Audit Logs & 500 Notifications...');
  const insertAudit = sqlite.prepare(
    `INSERT INTO audit_logs (
      id, company_id, user_id, user_email, user_display_name, role, action,
      entity_type, entity_id, entity_name, record_reference, timestamp,
      result, ip_address, source, module, severity, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCESS', '127.0.0.1', 'WEB_UI', ?, 'INFO', ?)`
  );
  const insertNotif = sqlite.prepare(
    `INSERT INTO notifications (
      id, company_id, user_id, title, message, type, entity_type, entity_id, is_read, created_at
    ) VALUES (?, ?, null, ?, ?, ?, ?, ?, ?, ?)`
  );

  const auditActions = [
    ['POST_SALES_INVOICE', 'SALES', 'SALES_INVOICE'],
    ['POST_PURCHASE_BILL', 'PURCHASES', 'PURCHASE_BILL'],
    ['POST_JOURNAL_ENTRY', 'ACCOUNTING', 'JOURNAL_ENTRY'],
    ['VERIFY_DOCUMENT_OCR', 'DOCUMENTS', 'DOCUMENT'],
    ['PROCESS_PAYROLL_RUN', 'PAYROLL', 'PAYROLL_RUN'],
    ['POST_STOCK_ADJUSTMENT', 'INVENTORY', 'STOCK_ADJUSTMENT'],
    ['APPROVE_WORKFLOW_STEP', 'APPROVALS', 'APPROVAL_WORKFLOW'],
    ['GENERATE_BIR_RETURN', 'TAX', 'TAX_FILING'],
  ];

  sqlite.transaction(() => {
    for (let a = 1; a <= 20000; a++) {
      const act = auditActions[a % auditActions.length];
      const actor = testUsers[a % 6];
      const logId = `aud-dg-${a}`;
      const ref = `REF-2026-${String(a).padStart(6, '0')}`;
      const ts = nowSec - (20000 - a) * 60;
      const hash = crypto
        .createHash('sha256')
        .update(`${logId}|${PREVIEW_COMPANY_ID}|${actor.id}|${act[0]}|${ref}|${ts}`)
        .digest('hex');

      insertAudit.run(
        logId,
        PREVIEW_COMPANY_ID,
        actor.id,
        actor.email,
        actor.name,
        actor.role,
        act[0],
        act[2],
        `ent-dg-${a}`,
        `${act[2]} ${ref}`,
        ref,
        ts,
        act[1],
        JSON.stringify({ integrityHash: hash, verified: true })
      );

      if (a <= 500) {
        insertNotif.run(
          `notif-dg-${a}`,
          PREVIEW_COMPANY_ID,
          `${act[0].replace(/_/g, ' ')} — ${ref}`,
          `${actor.name} completed ${act[0].toLowerCase().replace(/_/g, ' ')} (${ref}) in Deskguard Solutions — Stress Test Preview.`,
          a % 5 === 0 ? 'APPROVAL_REQUIRED' : 'TRANSACTION_POSTED',
          act[2],
          `ent-dg-${a}`,
          a <= 300 ? 1 : 0,
          ts
        );
      }
    }
  })();

  // 19. Seed Cash & Banking, Tax & BIR Filings, Budgets, and Audit Engagements/Workpapers/Fraud
  console.log('[ERP SUBMODULES] Seeding Cash/Banking, BIR Tax Filings, Budgets & Audit Workpapers...');
  const insertCashTx = sqlite.prepare(
    `INSERT INTO cash_transactions (
      id, company_id, transaction_number, type, transaction_date, cash_account_id,
      total_amount, reference, description, status, journal_entry_id,
      created_by, submitted_by, approved_by, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 112000, ?, ?, 'POSTED', ?, 'usr-dg-bookkeeper', 'usr-dg-accountant', 'usr-dg-approver', 1, ?, ?)`
  );
  const insertCheck = sqlite.prepare(
    `INSERT INTO checks (
      id, company_id, check_number, check_date, payee_name, cash_account_id,
      amount, voucher_number, status, cleared_date, notes, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 550000, ?, ?, ?, 'Supplier check disbursement', 'usr-dg-clerk', ?, ?)`
  );
  const insertDeposit = sqlite.prepare(
    `INSERT INTO bank_deposits (
      id, company_id, deposit_number, deposit_date, to_bank_account_id, from_cash_account_id,
      total_amount, reference, notes, status, journal_entry_id, created_by, submitted_by, approved_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1120000, ?, 'Daily corporate check & wire deposit batch', 'POSTED', ?, 'usr-dg-clerk', 'usr-dg-accountant', 'usr-dg-approver', ?, ?)`
  );
  const insertBankRecon = sqlite.prepare(
    `INSERT INTO bank_reconciliations (
      id, company_id, bank_account_id, statement_date, statement_ending_balance, book_ending_balance,
      cleared_deposits_count, cleared_deposits_amount, cleared_checks_count, cleared_checks_amount,
      outstanding_checks_count, outstanding_checks_amount, deposits_in_transit_count, deposits_in_transit_amount,
      adjusted_book_balance, adjusted_statement_balance, unexplained_difference,
      status, journal_entry_id, notes, created_by, submitted_by, approved_by, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1972000000, ?, ?, ?, ?, ?, ?, ?, ?, 1972000000, 1972000000, 0, ?, 'je-dg-1', ?, 'usr-dg-accountant', 'usr-dg-accountant', 'usr-dg-owner', 1, ?, ?)`
  );
  const insertBankStmtLine = sqlite.prepare(
    `INSERT INTO bank_statement_lines (
      id, bank_reconciliation_id, company_id, bank_account_id, line_date, description, reference,
      type, amount, matched_status, matched_type, matched_entity_id, matched_amount, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MATCHED', 'STATEMENT_CONFIRMATION', ?, ?, ?)`
  );
  const insertTaxFiling = sqlite.prepare(
    `INSERT INTO tax_filings (
      id, company_id, tax_type, period_name, start_date, end_date, deadline_date,
      status, total_tax_base, total_tax_due, net_tax_payable, filed_at, filed_by, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'FILED', ?, ?, ?, ?, 'usr-dg-accountant', ?, ?, ?)`
  );
  const insertTaxCalc = sqlite.prepare(
    `INSERT INTO tax_calculations (
      id, company_id, journal_entry_id, journal_line_id, tax_code_id, rule_version_id,
      tax_base, tax_rate, tax_amount, status, is_demo, created_at
    ) VALUES (?, ?, ?, ?, 'tc-dg-vat12', 'trver-dg-vat12', 1000000, 1200, 120000, 'POSTED', 0, ?)`
  );
  const insertBudget = sqlite.prepare(
    `INSERT INTO budgets (
      id, company_id, period_month, category, monthly_limit, notes, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 250000000, 'Approved FY 2026 Departmental Operating Budget', 1, ?, ?)`
  );

  sqlite.transaction(() => {
    for (let c = 1; c <= 500; c++) {
      const mm = String(((c - 1) % 9) + 1).padStart(2, '0');
      const dd = String(((c - 1) % 27) + 1).padStart(2, '0');
      const txDate = `2026-${mm}-${dd}`;
      insertCashTx.run(
        `ctx-dg-${c}`,
        PREVIEW_COMPANY_ID,
        `CTX-2026-${String(c).padStart(4, '0')}`,
        c % 2 === 0 ? 'RECEIPT' : 'DISBURSEMENT',
        txDate,
        cashAccId,
        `REF-CTX-${c}`,
        `Treasury cash ${c % 2 === 0 ? 'receipt' : 'disbursement'} #${c}`,
        `je-dg-${c}`,
        nowSec,
        nowSec
      );
      insertTaxCalc.run(`tcalc-dg-${c}`, PREVIEW_COMPANY_ID, `je-dg-${c}`, `jl-dg-${(c - 1) * 5 + 3}`, nowSec);
    }

    for (let k = 1; k <= 100; k++) {
      const isTransitWindow = k > 95;
      const mm = isTransitWindow ? '11' : String(((k - 1) % 9) + 1).padStart(2, '0');
      const chkDate = isTransitWindow ? `2026-11-${23 + (k - 95)}` : `2026-${mm}-15`;
      const depDate = isTransitWindow ? `2026-11-${24 + (k - 95)}` : `2026-${mm}-16`;
      insertCheck.run(
        `chk-dg-${k}`,
        PREVIEW_COMPANY_ID,
        `0000${800000 + k}`,
        chkDate,
        `Archipelago Security Supplier ${k} Inc.`,
        cashAccId,
        `CV-2026-${String(k).padStart(5, '0')}`,
        isTransitWindow ? 'ISSUED' : 'CLEARED',
        isTransitWindow ? null : `2026-${mm}-20`,
        nowSec,
        nowSec
      );
      insertDeposit.run(
        `dep-dg-${k}`,
        PREVIEW_COMPANY_ID,
        `DEP-2026-${String(k).padStart(4, '0')}`,
        depDate,
        cashAccId,
        cashAccId,
        `BPI-DEP-${30000 + k}`,
        `je-dg-${k}`,
        nowSec,
        nowSec
      );
    }

    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      const endDay = String(monthDays[m - 1]).padStart(2, '0');
      const reconId = `brec-dg-2026-${mm}`;
      const stmtDate = `2026-${mm}-${endDay}`;
      if (m <= 10) {
        insertBankRecon.run(
          reconId,
          PREVIEW_COMPANY_ID,
          cashAccId,
          stmtDate,
          1972000000,
          11,
          280000000,
          11,
          137500000,
          0,
          0,
          0,
          0,
          'APPROVED',
          `Reconciled BPI Corporate Operating Account (1010) for 2026-${mm} — Verified 0.00 Variance vs General Ledger`,
          nowSec,
          nowSec
        );
        insertBankStmtLine.run(
          `bsl-${reconId}-dep`,
          reconId,
          PREVIEW_COMPANY_ID,
          cashAccId,
          stmtDate,
          `BPI Corporate Verified Statement Ending Balance (${stmtDate})`,
          `BPI-STMT-2026-${mm}`,
          'DEPOSIT',
          1972000000,
          reconId,
          1972000000,
          nowSec
        );
      } else if (m === 11) {
        insertBankRecon.run(
          reconId,
          PREVIEW_COMPANY_ID,
          cashAccId,
          stmtDate,
          1969150000,
          1,
          1969150000,
          0,
          0,
          5,
          2750000,
          5,
          5600000,
          'SUBMITTED',
          'Nov 2026 Bank Reconciliation — 5 Deposits in Transit (₱56,000.00) & 5 Outstanding Checks (₱27,500.00) Reconciled to GL (₱19,720,000.00)',
          nowSec,
          nowSec
        );
        insertBankStmtLine.run(
          `bsl-${reconId}-bal-1`,
          reconId,
          PREVIEW_COMPANY_ID,
          cashAccId,
          '2026-11-25',
          'BPI Corporate Statement Brought Forward & Verified Activity',
          'BPI-STMT-2026-11',
          'DEPOSIT',
          1969150000,
          reconId,
          1969150000,
          nowSec
        );
      } else {
        insertBankRecon.run(
          reconId,
          PREVIEW_COMPANY_ID,
          cashAccId,
          stmtDate,
          1969150000,
          0,
          0,
          0,
          0,
          5,
          2750000,
          5,
          5600000,
          'DRAFT',
          'Year-End Dec 2026 Draft Reconciliation Session (Pending Dec 31 Bank Cut-Off Statement)',
          nowSec,
          nowSec
        );
      }

      insertTaxFiling.run(
        `tfil-dg-2550m-${mm}`,
        PREVIEW_COMPANY_ID,
        'VAT_2550M',
        `2026-${mm}`,
        `2026-${mm}-01`,
        `2026-${mm}-${endDay}`,
        `2026-${String(Math.min(12, m + 1)).padStart(2, '0')}-20`,
        1000000000,
        120000000,
        60000000,
        nowSec,
        `BIR eFPS Ref #2550M-2026${mm}`,
        nowSec,
        nowSec
      );
      insertTaxFiling.run(
        `tfil-dg-1601c-${mm}`,
        PREVIEW_COMPANY_ID,
        'WTC_1601C',
        `2026-${mm}`,
        `2026-${mm}-01`,
        `2026-${mm}-${endDay}`,
        `2026-${String(Math.min(12, m + 1)).padStart(2, '0')}-10`,
        800000000,
        50000000,
        50000000,
        nowSec,
        `BIR eFPS Ref #1601C-2026${mm}`,
        nowSec,
        nowSec
      );
    }

    const budgetCategories = ['REVENUE', 'COST_OF_SALES', 'SALARIES_AND_WAGES', 'RENT_AND_LEASE', 'UTILITIES_AND_CLOUD', 'DEPRECIATION'];
    let bIdx = 0;
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      for (const cat of budgetCategories) {
        bIdx++;
        insertBudget.run(`bud-dg-${bIdx}`, PREVIEW_COMPANY_ID, `2026-${mm}`, cat, nowSec, nowSec);
      }
    }
  })();

  // Seed Audit Engagements, Workpapers, Findings & Fraud Flags
  sqlite.transaction(() => {
    const insertEng = sqlite.prepare(
      `INSERT INTO audit_engagements (
        id, company_id, client_company_id, engagement_name, audit_period,
        engagement_type, status, materiality, performance_materiality, trivial_threshold,
        team_members, preparer_id, reviewer_id, partner_id,
        fieldwork_deadline, sign_off_deadline, report_deadline, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 50000000, 37500000, 2500000, ?, 'usr-dg-accountant', 'usr-dg-auditor', 'usr-dg-owner', '2026-11-30', '2026-12-15', '2026-12-31', 'PSA 300/315/330 Statutory & Internal Control Audit', ?, ?)`
    );
    const insertWp = sqlite.prepare(
      `INSERT INTO audit_workpapers (
        id, engagement_id, wp_ref, title, objective, procedure, population, sample,
        result, exception, conclusion, preparer_id, prepared_date, reviewer_id, review_date,
        status, version_number, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'No material misstatements noted.', 'Fairly stated in accordance with PFRS and BIR CAS rules.', 'usr-dg-accountant', '2026-10-20', 'usr-dg-auditor', '2026-10-25', 'REVIEWED', 1, ?, ?)`
    );
    const insertFinding = sqlite.prepare(
      `INSERT INTO audit_findings (
        id, engagement_id, title, risk_rating, criteria, condition, cause, effect,
        recommendation, management_response, owner_id, target_date, status, created_at
      ) VALUES (?, ?, ?, ?, 'PAS 1 / BIR RR 9-2009 Compliance', ?, 'High transaction volume during Q3', 'No GL discrepancy; timing variance only', 'Enforce automated 3-way matching threshold alerts', 'Implemented automated 2% tolerance gate', 'usr-dg-accountant', '2026-11-30', 'OPEN', ?)`
    );
    const insertFraud = sqlite.prepare(
      `INSERT INTO fraud_flags (
        id, company_id, rule_name, severity, entity_type, entity_id, details_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'FLAGGED', ?)`
    );

    const engs = [
      ['eng-dg-1', 'FY 2026 Statutory Financial Statement Audit (PSA 700)', 'FY 2026', 'FINANCIAL_STATEMENT_AUDIT', 'IN_PROGRESS'],
      ['eng-dg-2', 'BIR CAS RR 9-2009 & RMC 5-2021 Tax Compliance Review', 'FY 2026', 'TAX_COMPLIANCE_AUDIT', 'IN_PROGRESS'],
      ['eng-dg-3', 'Q3 2026 Physical Inventory & WAVCO Valuation Audit', 'Q3 2026', 'INTERNAL_CONTROL_AUDIT', 'IN_PROGRESS'],
      ['eng-dg-4', 'Enterprise RBAC & Segregation of Duties Security Audit', 'FY 2026', 'IT_SYSTEMS_AUDIT', 'COMPLETED'],
      ['eng-dg-5', 'Procurement 3-Way Match & Payables Cut-Off Review', 'Q2 2026', 'OPERATIONAL_AUDIT', 'COMPLETED'],
      ['eng-dg-6', 'Payroll Statutory Contributions & Alphalist Audit', 'FY 2026', 'COMPLIANCE_AUDIT', 'IN_PROGRESS'],
    ];

    const teamJson = JSON.stringify(['usr-dg-owner', 'usr-dg-accountant', 'usr-dg-auditor']);
    for (const e of engs) {
      insertEng.run(e[0], PREVIEW_COMPANY_ID, PREVIEW_COMPANY_ID, e[1], e[2], e[3], e[4], teamJson, nowSec, nowSec);
    }

    for (let w = 1; w <= 20; w++) {
      const engId = engs[(w - 1) % engs.length][0];
      insertWp.run(
        `wp-dg-${w}`,
        engId,
        `WP-2026-${String(w).padStart(3, '0')}`,
        `Substantive Lead Sheet & Reconciliation Testing #${w}`,
        'Verify subledger-to-GL completeness, existence, and valuation.',
        'Reconciled 100% of control accounts and performed MUS statistical vouching.',
        JSON.stringify({ totalRecords: 10000, populationPhp: 112000000 }),
        JSON.stringify({ sampleSize: 50, coveragePct: 95 }),
        'Zero variance between subledger and General Ledger control balance.',
        nowSec,
        nowSec
      );
    }

    for (let f = 1; f <= 12; f++) {
      const engId = engs[(f - 1) % engs.length][0];
      insertFinding.run(
        `fnd-dg-${f}`,
        engId,
        `Internal Control Observation #${f}: Subledger Cut-Off & Document Verification Review`,
        f % 3 === 0 ? 'HIGH' : 'MEDIUM',
        `Observed ${f * 2} unverified OCR attachments awaiting accountant sign-off prior to period lock`,
        nowSec
      );
    }

    for (let fr = 1; fr <= 15; fr++) {
      insertFraud.run(
        `frd-dg-${fr}`,
        PREVIEW_COMPANY_ID,
        fr % 2 === 0 ? 'ROUND_NUMBER_HIGH_VALUE_DISBURSEMENT' : 'WEEKEND_POSTING_ANOMALY_SCAN',
        fr % 3 === 0 ? 'HIGH' : 'MEDIUM',
        'PURCHASE_BILL',
        `pbill-dg-${8000 + fr}`,
        JSON.stringify({ billNumber: `BILL-2026-${String(8000 + fr).padStart(5, '0')}`, amountPhp: 5600, reason: 'Heuristic forensic monitoring alert' }),
        nowSec
      );
    }
  })();

  sqlite.pragma('foreign_keys = ON');

  // 20. Checkpoint encrypted database.lai and create an initial atomic backup in the isolated backup location
  await CompanyManager.checkpointAndSyncFinancialSnapshotNow(PREVIEW_COMPANY_ID);
  await RestoreService.createAtomicBackup(PREVIEW_COMPANY_ID, 'usr-dg-owner', 'Deskguard_Stress_Preview_Baseline_v1').catch((err) => {
    console.warn('[BACKUP] Non-fatal backup creation notice:', err?.message);
  });
  await CompanyManager.checkpointAndSyncFinancialSnapshotNow(PREVIEW_COMPANY_ID);

  // 21. Final Verification of Original Deskguard Solutions SHA-256 (when present on disk)
  if (hasOriginalDeskguardOnDisk) {
    const postSha256 = computeFileSha256(ORIGINAL_DESKGUARD_LAI_PATH);
    if (postSha256 !== EXPECTED_ORIGINAL_DESKGUARD_SHA256) {
      throw new Error(
        `CRITICAL SAFETY VIOLATION: Original Deskguard database.lai changed! Expected ${EXPECTED_ORIGINAL_DESKGUARD_SHA256}, got ${postSha256}`
      );
    }
    console.log(`[SAFETY VERIFIED] Original Deskguard Solutions SHA-256 unchanged: ${postSha256}`);
  }

  await fsp.writeFile(path.join(PREVIEW_COMPANY_DIR, '.seeded_complete'), new Date().toISOString());

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('================================================================================');
  console.log(`[SUCCESS] Seeded ${PREVIEW_COMPANY_NAME} (${PREVIEW_COMPANY_ID}) in ${elapsedSec}s`);
  console.log('================================================================================');
}

if (process.argv[1] && process.argv[1].includes('seedDeskguardStressPreview')) {
  seedDeskguardStressPreview()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seeder failed:', err);
      process.exit(1);
    });
}
