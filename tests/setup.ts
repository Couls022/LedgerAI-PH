import { beforeAll, afterAll } from 'vitest';
import { dbContext } from '../src/server/db/context';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../src/server/db/schema';
import path from 'path';

const client = createClient({ url: 'file:test.sqlite' });
const testDb = drizzle(client, { schema });

beforeAll(async () => {
  try {
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
    "ALTER TABLE companies ADD COLUMN accounting_method text DEFAULT 'ACCRUAL';",
    "ALTER TABLE companies ADD COLUMN taxpayer_classification text;",
    "ALTER TABLE companies ADD COLUMN bir_registration_no text;",
    "ALTER TABLE companies ADD COLUMN bir_date_registered text;",
    "ALTER TABLE companies ADD COLUMN document_location_path text;",
    "ALTER TABLE companies ADD COLUMN backup_location_path text;",
    "ALTER TABLE companies ADD COLUMN lock_date text;",
    "ALTER TABLE companies ADD COLUMN is_demo integer DEFAULT 0;",

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

    // Users columns
    "ALTER TABLE users ADD COLUMN role text;",
    "ALTER TABLE users ADD COLUMN is_active integer DEFAULT 1;",

    // Company Licenses columns
    "ALTER TABLE company_licenses ADD COLUMN trial_start_date text;",
    "ALTER TABLE company_licenses ADD COLUMN expiration_date text;",
    "ALTER TABLE company_licenses ADD COLUMN device_binding_hash text;",
    "ALTER TABLE company_licenses ADD COLUMN signed_file_content text;",
    "ALTER TABLE company_licenses ADD COLUMN is_lifetime integer DEFAULT 0;",
    "ALTER TABLE company_licenses ADD COLUMN previous_license_id text;",
    "ALTER TABLE company_licenses ADD COLUMN replacement_reason text;",

    // Sales and Purchases
    "ALTER TABLE sales_invoices ADD COLUMN invoice_type text DEFAULT 'SALES' NOT NULL;",
    "ALTER TABLE sales_invoices ADD COLUMN reference text;",
    "ALTER TABLE sales_invoices ADD COLUMN notes text;",
    "ALTER TABLE sales_invoices ADD COLUMN attachment_url text;",
    "ALTER TABLE purchase_bills ADD COLUMN reference text;",
    "ALTER TABLE purchase_bills ADD COLUMN notes text;",
    "ALTER TABLE purchase_bills ADD COLUMN attachment_url text;",
    "ALTER TABLE purchase_bills ADD COLUMN balance_due real DEFAULT 0;",

    // Accounts
    "ALTER TABLE accounts ADD COLUMN detail_type text;",
    "ALTER TABLE accounts ADD COLUMN is_sub_account integer DEFAULT 0;",
    "ALTER TABLE accounts ADD COLUMN bir_tax_category text;",
    "ALTER TABLE accounts ADD COLUMN opening_balance real DEFAULT 0;",
    "ALTER TABLE accounts ADD COLUMN as_of_date text;",

    // Documents
    "ALTER TABLE documents ADD COLUMN document_type text DEFAULT 'GENERAL_ATTACHMENT' NOT NULL;",
    "ALTER TABLE documents ADD COLUMN original_file_name text;",
    "ALTER TABLE documents ADD COLUMN file_size integer DEFAULT 0 NOT NULL;",
    "ALTER TABLE documents ADD COLUMN file_hash text;",
    "ALTER TABLE documents ADD COLUMN source text DEFAULT 'WEB_UI' NOT NULL;",
    "ALTER TABLE documents ADD COLUMN linked_transaction_type text;",
    "ALTER TABLE documents ADD COLUMN linked_transaction_id text;",
    "ALTER TABLE documents ADD COLUMN linked_vendor_id text REFERENCES vendors(id);",
    "ALTER TABLE documents ADD COLUMN linked_customer_id text REFERENCES customers(id);",
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
    "ALTER TABLE documents ADD COLUMN validation_errors text;",
    "ALTER TABLE documents ADD COLUMN validation_warnings text;",
    "ALTER TABLE documents ADD COLUMN notes text;",
    "ALTER TABLE documents ADD COLUMN verified_by text REFERENCES users(id);",
    "ALTER TABLE documents ADD COLUMN verified_at integer;",
    "ALTER TABLE documents ADD COLUMN updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL;",

    `CREATE TABLE IF NOT EXISTS atc_definitions (
      id text PRIMARY KEY NOT NULL,
      code text NOT NULL UNIQUE,
      description text NOT NULL,
      income_type text NOT NULL,
      tax_rate real NOT NULL,
      taxpayer_classification text DEFAULT 'ALL' NOT NULL,
      form_reference text DEFAULT '2307 / 1601EQ' NOT NULL,
      status text DEFAULT 'ACTIVE' NOT NULL,
      source_metadata text DEFAULT 'BIR RR No. 2-98 as amended by RR No. 11-2018' NOT NULL,
      effective_date text,
      created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
      updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
    );`,

    `CREATE TABLE IF NOT EXISTS electronic_filing_submissions (
      id text PRIMARY KEY NOT NULL,
      company_id text NOT NULL REFERENCES companies(id),
      filing_type text NOT NULL,
      reporting_period text NOT NULL,
      status text DEFAULT 'DRAFT' NOT NULL,
      adapter_provider text DEFAULT 'OfficialBirAdapter' NOT NULL,
      tax_rule_version text DEFAULT '1.0',
      atc_version text DEFAULT '1.0',
      artifact_checksum text,
      artifact_data_json text,
      signature_data_json text,
      external_reference text,
      receipt_reference text,
      error_code text,
      error_message text,
      attempt_count integer DEFAULT 0 NOT NULL,
      created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
      submitted_at integer,
      updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
    );`,

    `CREATE TABLE IF NOT EXISTS bank_accounts (
      id text PRIMARY KEY NOT NULL,
      company_id text NOT NULL REFERENCES companies(id),
      account_name text NOT NULL,
      bank_name text NOT NULL,
      account_number_encrypted text NOT NULL,
      currency text DEFAULT 'PHP' NOT NULL,
      status text DEFAULT 'ACTIVE' NOT NULL,
      created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
      updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
    );`,

    `CREATE TABLE IF NOT EXISTS bank_statements (
      id text PRIMARY KEY NOT NULL,
      company_id text NOT NULL REFERENCES companies(id),
      bank_account_id text NOT NULL REFERENCES bank_accounts(id),
      statement_date integer NOT NULL,
      start_date integer,
      end_date integer,
      filename text,
      status text DEFAULT 'IMPORTED' NOT NULL,
      created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
    );`,

    `CREATE TABLE IF NOT EXISTS bank_transactions (
      id text PRIMARY KEY NOT NULL,
      company_id text NOT NULL REFERENCES companies(id),
      bank_statement_id text NOT NULL REFERENCES bank_statements(id),
      bank_account_id text NOT NULL REFERENCES bank_accounts(id),
      transaction_date integer NOT NULL,
      description text NOT NULL,
      reference text,
      amount real NOT NULL,
      type text NOT NULL,
      matched_status text DEFAULT 'UNMATCHED' NOT NULL,
      matched_journal_id text,
      matched_payment_id text,
      match_confidence real,
      match_reason text,
      created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
    );`,

    `CREATE TABLE IF NOT EXISTS bank_reconciliation_approvals (
      id text PRIMARY KEY NOT NULL,
      company_id text NOT NULL REFERENCES companies(id),
      bank_transaction_id text NOT NULL REFERENCES bank_transactions(id),
      matched_record_type text NOT NULL,
      matched_record_id text NOT NULL,
      status text DEFAULT 'PENDING' NOT NULL,
      approved_by text,
      approved_at integer,
      created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
    );`,

    `CREATE TABLE IF NOT EXISTS recurring_journals (
      id text PRIMARY KEY NOT NULL,
      company_id text NOT NULL REFERENCES companies(id),
      template_name text NOT NULL,
      frequency text NOT NULL,
      start_date integer NOT NULL,
      end_date integer,
      next_run_date integer NOT NULL,
      last_run_date integer,
      status text DEFAULT 'ACTIVE' NOT NULL,
      journal_data_json text NOT NULL,
      requires_approval integer DEFAULT 1 NOT NULL,
      created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
      updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
    );`,

    `CREATE TABLE IF NOT EXISTS cash_flow_forecasts (
      id text PRIMARY KEY NOT NULL,
      company_id text NOT NULL REFERENCES companies(id),
      forecast_date integer NOT NULL,
      horizon_days integer NOT NULL,
      scenario text DEFAULT 'BASE' NOT NULL,
      opening_balance real NOT NULL,
      projected_inflows real NOT NULL,
      projected_outflows real NOT NULL,
      closing_balance real NOT NULL,
      details_json text,
      created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
    );`
  ];

  for (const sql of setupSqls) {
    try {
      await client.execute(sql);
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
