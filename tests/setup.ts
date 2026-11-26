import { beforeAll, afterAll } from 'vitest';
import { dbContext } from '../src/server/db/context';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../src/server/db/schema';
import path from 'path';

let client: any;
let testDb: any;

beforeAll(async () => {
  try {
    client = new Database(':memory:');
    testDb = drizzle(client, { schema });

    const migrationsFolder = path.resolve(process.cwd(), 'src/server/db/migrations');
    await migrate(testDb, { migrationsFolder });
  } catch (e) {
    console.error('Migration in test setup error:', e);
  }

  const setupSqls = [
    // Companies columns
    "ALTER TABLE companies ADD COLUMN address text;",
    "ALTER TABLE companies ADD COLUMN branch_code text DEFAULT '00000';",
    "ALTER TABLE companies ADD COLUMN contact_person text;",
    "ALTER TABLE companies ADD COLUMN contact_email text;",
    "ALTER TABLE companies ADD COLUMN contact_phone text;",
    "ALTER TABLE companies ADD COLUMN industry text;",
    "ALTER TABLE companies ADD COLUMN fiscal_year integer DEFAULT 2026;",
    "ALTER TABLE companies ADD COLUMN fiscal_year_start_month integer DEFAULT 1 NOT NULL;",
    "ALTER TABLE companies ADD COLUMN currency text DEFAULT 'PHP' NOT NULL;",
    "ALTER TABLE companies ADD COLUMN timezone text DEFAULT 'Asia/Manila' NOT NULL;",
    "ALTER TABLE companies ADD COLUMN accounting_method text DEFAULT 'ACCRUAL';",
    "ALTER TABLE companies ADD COLUMN taxpayer_classification text;",
    "ALTER TABLE companies ADD COLUMN taxpayer_type text;",
    "ALTER TABLE companies ADD COLUMN vat_status text;",
    "ALTER TABLE companies ADD COLUMN rdo_code text;",
    "ALTER TABLE companies ADD COLUMN bir_registration_no text;",
    "ALTER TABLE companies ADD COLUMN bir_date_registered text;",
    "ALTER TABLE companies ADD COLUMN document_location_path text;",
    "ALTER TABLE companies ADD COLUMN backup_location_path text;",
    "ALTER TABLE companies ADD COLUMN lock_date text;",
    "ALTER TABLE companies ADD COLUMN status text DEFAULT 'ACTIVE' NOT NULL;",
    "ALTER TABLE companies ADD COLUMN classification text DEFAULT 'DEVELOPMENT' NOT NULL;",
    "ALTER TABLE companies ADD COLUMN is_demo integer DEFAULT 0;",
    "ALTER TABLE companies ADD COLUMN version integer DEFAULT 1 NOT NULL;",

    // Company Users columns
    "ALTER TABLE users ADD COLUMN role text;",
    "ALTER TABLE users ADD COLUMN is_active integer DEFAULT 1;",
    "ALTER TABLE company_users ADD COLUMN role_id text;",
    "ALTER TABLE company_users ADD COLUMN legacy_role text;",
    "ALTER TABLE company_users ADD COLUMN role_template_version integer DEFAULT 1 NOT NULL;",
    "ALTER TABLE company_users ADD COLUMN default_data_scope text DEFAULT 'COMPANY_WIDE';",
    "ALTER TABLE company_users ADD COLUMN approval_limit_centavos integer DEFAULT 0;",
    "ALTER TABLE company_users ADD COLUMN status text DEFAULT 'ACTIVE' NOT NULL;",
    "ALTER TABLE company_users ADD COLUMN membership_status text DEFAULT 'ACTIVE' NOT NULL;",
    "ALTER TABLE company_users ADD COLUMN removed_at integer;",
    "ALTER TABLE company_users ADD COLUMN removed_by text;",
    "ALTER TABLE company_users ADD COLUMN removal_reason text;",
    "ALTER TABLE company_users ADD COLUMN is_demo integer DEFAULT 0;",

    // Company User Roles columns
    "ALTER TABLE company_user_roles ADD COLUMN role_code text;",
    "ALTER TABLE company_user_roles ADD COLUMN role_template_version integer DEFAULT 1 NOT NULL;",
    "ALTER TABLE company_user_roles ADD COLUMN is_primary integer DEFAULT 0 NOT NULL;",
    "ALTER TABLE company_user_roles ADD COLUMN assignment_status text DEFAULT 'ACTIVE' NOT NULL;",
    "ALTER TABLE company_user_roles ADD COLUMN assigned_by text;",
    "ALTER TABLE company_user_roles ADD COLUMN assigned_at integer;",
    "ALTER TABLE company_user_roles ADD COLUMN effective_from text;",
    "ALTER TABLE company_user_roles ADD COLUMN effective_to text;",
    "ALTER TABLE company_user_roles ADD COLUMN assignment_reason text;",

    // Other tables
    "ALTER TABLE accounts ADD COLUMN detail_type text;",
    "ALTER TABLE accounts ADD COLUMN parent_account_id text;",
    "ALTER TABLE accounts ADD COLUMN is_sub_account integer DEFAULT 0 NOT NULL;",
    "ALTER TABLE accounts ADD COLUMN bir_tax_category text;",
    "ALTER TABLE accounts ADD COLUMN opening_balance real DEFAULT 0;",
    "ALTER TABLE accounts ADD COLUMN as_of_date text;",
    "ALTER TABLE accounts ADD COLUMN is_control_account integer DEFAULT 0 NOT NULL;",
    "ALTER TABLE accounts ADD COLUMN is_cash_account integer DEFAULT 0 NOT NULL;",
    "ALTER TABLE accounts ADD COLUMN is_tax_account integer DEFAULT 0 NOT NULL;",
    "ALTER TABLE accounts ADD COLUMN is_retained_earnings integer DEFAULT 0 NOT NULL;",
    "ALTER TABLE accounts ADD COLUMN currency text DEFAULT 'PHP' NOT NULL;",
    "ALTER TABLE accounts ADD COLUMN version integer DEFAULT 1 NOT NULL;",

    "ALTER TABLE customers ADD COLUMN trade_name text;",
    "ALTER TABLE customers ADD COLUMN billing_address text;",
    "ALTER TABLE customers ADD COLUMN shipping_address text;",
    "ALTER TABLE customers ADD COLUMN credit_limit integer;",
    "ALTER TABLE customers ADD COLUMN tax_classification text;",
    "ALTER TABLE customers ADD COLUMN vat_status text;",
    "ALTER TABLE customers ADD COLUMN withholding_applicability text;",
    "ALTER TABLE customers ADD COLUMN default_revenue_account_id text;",
    "ALTER TABLE customers ADD COLUMN version integer DEFAULT 1 NOT NULL;",

    "ALTER TABLE vendors ADD COLUMN trade_name text;",
    "ALTER TABLE vendors ADD COLUMN contact_details text;",
    "ALTER TABLE vendors ADD COLUMN payment_terms text;",
    "ALTER TABLE vendors ADD COLUMN tax_classification text;",
    "ALTER TABLE vendors ADD COLUMN vat_status text;",
    "ALTER TABLE vendors ADD COLUMN withholding_applicability text;",
    "ALTER TABLE vendors ADD COLUMN default_expense_account_id text;",
    "ALTER TABLE vendors ADD COLUMN version integer DEFAULT 1 NOT NULL;",

    "ALTER TABLE inventory_items ADD COLUMN version integer DEFAULT 1 NOT NULL;",
    "ALTER TABLE employees ADD COLUMN version integer DEFAULT 1 NOT NULL;",
    
    "ALTER TABLE sales_invoices ADD COLUMN invoice_type text DEFAULT 'SALES' NOT NULL;",
    "ALTER TABLE sales_invoices ADD COLUMN reference text;",
    "ALTER TABLE sales_invoices ADD COLUMN version integer DEFAULT 1 NOT NULL;",
    "ALTER TABLE sales_invoices ADD COLUMN submitted_at integer;",
    "ALTER TABLE sales_invoices ADD COLUMN approved_at integer;",

    "ALTER TABLE purchase_bills ADD COLUMN reference text;",
    "ALTER TABLE purchase_bills ADD COLUMN notes text;",
    "ALTER TABLE purchase_bills ADD COLUMN attachment_url text;",
    "ALTER TABLE purchase_bills ADD COLUMN version integer DEFAULT 1 NOT NULL;",
    "ALTER TABLE purchase_bills ADD COLUMN submitted_at integer;",
    "ALTER TABLE purchase_bills ADD COLUMN approved_at integer;",

    "ALTER TABLE journal_entries ADD COLUMN accounting_period_id text;",
    "ALTER TABLE journal_entries ADD COLUMN source_type text;",
    "ALTER TABLE journal_entries ADD COLUMN source_id text;",
    "ALTER TABLE journal_entries ADD COLUMN submitted_by text;",
    "ALTER TABLE journal_entries ADD COLUMN approved_by text;",
    "ALTER TABLE journal_entries ADD COLUMN posted_by text;",
    "ALTER TABLE journal_entries ADD COLUMN submitted_at integer;",
    "ALTER TABLE journal_entries ADD COLUMN approved_at integer;",
    "ALTER TABLE journal_entries ADD COLUMN posted_at integer;",
    "ALTER TABLE journal_entries ADD COLUMN reversed_at integer;",
    "ALTER TABLE journal_entries ADD COLUMN rejection_reason text;",
    "ALTER TABLE journal_entries ADD COLUMN original_journal_id text;",
    "ALTER TABLE journal_entries ADD COLUMN version integer DEFAULT 1 NOT NULL;",

    "ALTER TABLE accounting_periods ADD COLUMN soft_closed_at integer;",
    "ALTER TABLE accounting_periods ADD COLUMN soft_closed_by text;",
    "ALTER TABLE accounting_periods ADD COLUMN hard_closed_at integer;",
    "ALTER TABLE accounting_periods ADD COLUMN hard_closed_by text;",
    "ALTER TABLE accounting_periods ADD COLUMN reopened_at integer;",
    "ALTER TABLE accounting_periods ADD COLUMN reopened_by text;",
    "ALTER TABLE accounting_periods ADD COLUMN reopen_reason text;",
    "ALTER TABLE accounting_periods ADD COLUMN closed_at integer;",
    "ALTER TABLE accounting_periods ADD COLUMN closed_by text;",
    "ALTER TABLE accounting_periods ADD COLUMN version integer DEFAULT 1 NOT NULL;",

    "ALTER TABLE documents ADD COLUMN document_type text DEFAULT 'GENERAL_ATTACHMENT' NOT NULL;",
    "ALTER TABLE documents ADD COLUMN original_file_name text;",
    "ALTER TABLE documents ADD COLUMN file_hash text;",
    "ALTER TABLE documents ADD COLUMN source text DEFAULT 'WEB_UI' NOT NULL;",
    "ALTER TABLE documents ADD COLUMN linked_transaction_type text;",
    "ALTER TABLE documents ADD COLUMN linked_transaction_id text;",
    "ALTER TABLE documents ADD COLUMN linked_vendor_id text;",
    "ALTER TABLE documents ADD COLUMN linked_customer_id text;",
    "ALTER TABLE documents ADD COLUMN ocr_status text DEFAULT 'PENDING';",
    "ALTER TABLE documents ADD COLUMN verification_status text DEFAULT 'UNVERIFIED' NOT NULL;",
    "ALTER TABLE documents ADD COLUMN confidence_score real;",
    "ALTER TABLE documents ADD COLUMN ocr_result text;",
    "ALTER TABLE documents ADD COLUMN extracted_merchant text;",
    "ALTER TABLE documents ADD COLUMN extracted_customer text;",
    "ALTER TABLE documents ADD COLUMN extracted_tin text;",
    "ALTER TABLE documents ADD COLUMN extracted_address text;",
    "ALTER TABLE documents ADD COLUMN extracted_invoice_number text;",
    "ALTER TABLE documents ADD COLUMN extracted_date text;",
    "ALTER TABLE documents ADD COLUMN extracted_total_amount integer;",
    "ALTER TABLE documents ADD COLUMN extracted_vat_amount integer;",
    "ALTER TABLE documents ADD COLUMN extracted_vatable_sales integer;",
    "ALTER TABLE documents ADD COLUMN extracted_vat_exempt_sales integer;",
    "ALTER TABLE documents ADD COLUMN extracted_zero_rated_sales integer;",
    "ALTER TABLE documents ADD COLUMN extracted_withholding_tax integer;",
    "ALTER TABLE documents ADD COLUMN extracted_payment_method text;",
    "ALTER TABLE documents ADD COLUMN extracted_category text;",
    "ALTER TABLE documents ADD COLUMN extraction_engine text;",
    "ALTER TABLE documents ADD COLUMN page_count integer DEFAULT 1;",
    "ALTER TABLE documents ADD COLUMN validation_errors text;",
    "ALTER TABLE documents ADD COLUMN validation_warnings text;",
    "ALTER TABLE documents ADD COLUMN notes text;",
    "ALTER TABLE documents ADD COLUMN verified_by text;",
    "ALTER TABLE documents ADD COLUMN verified_at integer;",
    "ALTER TABLE documents ADD COLUMN encryption_status text DEFAULT 'ENCRYPTED_AES256_GCM';",
    "ALTER TABLE documents ADD COLUMN storage_tier text DEFAULT 'ORIGINALS';",
    "ALTER TABLE documents ADD COLUMN quarantine_reason text;",
    "ALTER TABLE documents ADD COLUMN version integer DEFAULT 1 NOT NULL;",

    // Company Licenses Table
    `CREATE TABLE IF NOT EXISTS company_licenses (
      id text PRIMARY KEY NOT NULL,
      company_id text NOT NULL REFERENCES companies(id),
      license_key text NOT NULL,
      plan_type text DEFAULT 'TRIAL' NOT NULL,
      status text DEFAULT 'ACTIVE' NOT NULL,
      trial_start_date text NOT NULL,
      expiration_date text NOT NULL,
      device_binding_hash text,
      signed_file_content text NOT NULL,
      is_lifetime integer DEFAULT 0 NOT NULL,
      previous_license_id text,
      replacement_reason text,
      created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
      updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS fx_revaluation_runs (
      id text PRIMARY KEY NOT NULL,
      company_id text NOT NULL,
      accounting_period_id text,
      revaluation_date text NOT NULL,
      base_currency text DEFAULT 'PHP' NOT NULL,
      target_currency text DEFAULT 'USD' NOT NULL,
      closing_spot_rate real NOT NULL,
      rate_source text DEFAULT 'BSP',
      rate_date text NOT NULL,
      unrealized_journal_id text,
      reversal_journal_id text,
      auto_reverse integer DEFAULT 1 NOT NULL,
      auto_reverse_date text,
      total_carrying_php_centavos integer DEFAULT 0 NOT NULL,
      total_revalued_php_centavos integer DEFAULT 0 NOT NULL,
      total_unrealized_gain_centavos integer DEFAULT 0 NOT NULL,
      total_unrealized_loss_centavos integer DEFAULT 0 NOT NULL,
      net_gain_loss_centavos integer DEFAULT 0 NOT NULL,
      account_count integer DEFAULT 0 NOT NULL,
      status text DEFAULT 'POSTED' NOT NULL,
      details_json text DEFAULT '[]' NOT NULL,
      notes text,
      created_by text NOT NULL,
      created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
    );`,
    "ALTER TABLE company_licenses ADD COLUMN license_pair_id text;",
    "ALTER TABLE company_licenses ADD COLUMN key_file_id text;",
    "ALTER TABLE company_licenses ADD COLUMN activation_record_id text;",
    "ALTER TABLE company_licenses ADD COLUMN activation_timestamp text;",
    "ALTER TABLE company_licenses ADD COLUMN activated_by text;",
    "ALTER TABLE company_licenses ADD COLUMN key_file_content text;",
    "ALTER TABLE company_licenses ADD COLUMN activation_receipt text;",
    "ALTER TABLE company_licenses ADD COLUMN revocation_ref text;",
    "ALTER TABLE company_licenses ADD COLUMN license_version text DEFAULT '2.0';",
    "ALTER TABLE company_licenses ADD COLUMN activation_policy text DEFAULT 'ONE_TIME_COMPANY_BOUND';",
    "ALTER TABLE company_licenses ADD COLUMN recovery_reference text;",
    "ALTER TABLE company_licenses ADD COLUMN recovery_reason text;",
    `CREATE TABLE IF NOT EXISTS license_redemption_records (
      id text PRIMARY KEY,
      company_id text NOT NULL REFERENCES companies(id),
      license_pair_id text NOT NULL,
      license_id text NOT NULL,
      key_file_id text NOT NULL,
      activation_key text NOT NULL,
      plan_type text NOT NULL,
      activation_status text NOT NULL,
      activated_at text NOT NULL,
      activated_by text,
      activation_receipt text NOT NULL,
      recovery_reference text,
      recovery_reason text,
      created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
    );`
  ];

  for (const sql of setupSqls) {
    try {
      client.exec(sql);
    } catch (_) {}
  }
});

export const runInTestDb = async (fn: () => Promise<void>) => {
  return new Promise<void>((resolve, reject) => {
    dbContext.run(testDb, () => {
      fn().then(resolve).catch(reject);
    });
  });
};
