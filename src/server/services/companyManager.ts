import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'url';
import * as schema from "../db/schema";

import { paths } from "./paths";
import { DatabaseEncryptionService } from "./databaseEncryptionService";

export const COMPANIES_ROOT = paths.getCompaniesRootDir();
export const REGISTRY_FILE = paths.getRegistryFilePath();

export interface CompanyManifest {
  id: string;
  legalName: string;
  createdAt: string;
  dbPath: string;
  documentLocation: string; // Renamed for clarity
  backupLocation: string; // Ensure it exists
  location: string; // Directory path
  status?: string;
  isDemo?: boolean;
  lastOpenedAt?: string;
}

const dbCache = new Map<string, any>();
const sqliteCache = new Map<string, any>();
const tempManifests = new Map<string, CompanyManifest>();

export class CompanyManager {
  static setTempManifest(companyId: string, manifest: CompanyManifest) {
    tempManifests.set(companyId, manifest);
  }

  static removeTempManifest(companyId: string) {
    tempManifests.delete(companyId);
  }

  static async getCompanyManifest(companyId: string): Promise<CompanyManifest | undefined> {
    const companies = await this.listCompanies();
    return companies.find(c => c.id === companyId) || tempManifests.get(companyId);
  }
  static async init() {
    const root = paths.getCompaniesRootDir();
    const reg = paths.getRegistryFilePath();
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(path.dirname(reg), { recursive: true });
    
    try {
      await fs.access(reg);
    } catch {
      await fs.writeFile(reg, JSON.stringify([]));
    }

    // In production mode, NEVER automatically seed test/demo company fixtures.
    // Fresh production installations must start strictly with an empty registry for first-launch onboarding.
    if (process.env.NODE_ENV !== 'production') {
      try {
        await this.seedDefaultCompanyIfEmpty();
      } catch (e) {
        console.error("Failed to seed default company in development mode:", e);
      }
    }
  }

  static async seedDefaultCompanyIfEmpty() {
    // Strictly forbid test company seeding in production
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    const root = paths.getCompaniesRootDir();
    const seedFlagFile = path.join(paths.getConfigDir(), '.seeded_v1');
    try {
      await fs.access(seedFlagFile);
      // Already seeded
      return;
    } catch {
      // Not seeded yet, proceed to check registry
    }

    const companies = await this.listCompanies();
    if (companies.length > 0) {
      // There are already registered companies, do not seed
      await fs.writeFile(seedFlagFile, 'seeded');
      return;
    }

    console.log("Seeding default test company 'LedgerAI PH Test Corp'...");
    const companyId = "LGR-PH-2026-TEST-00-ABC12345";
    const dirPath = path.join(root, companyId);
    const backupPath = path.join(dirPath, 'backups');

    await fs.mkdir(dirPath, { recursive: true });
    await fs.mkdir(backupPath, { recursive: true });
    await fs.mkdir(path.join(dirPath, 'documents'), { recursive: true });

    const manifest: CompanyManifest = {
      id: companyId,
      legalName: "LedgerAI PH Test Corp",
      createdAt: new Date().toISOString(),
      dbPath: path.join(dirPath, 'database.lai'),
      documentLocation: path.join(dirPath, 'documents'),
      location: dirPath,
      backupLocation: backupPath,
      status: "ACTIVE",
      isDemo: true
    };


    await fs.writeFile(path.join(dirPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await this.registerCompany(manifest);

    // Initialize database schema
    const companyDb = await this.getCompanyDb(companyId);

    // 1. Insert company record
    await companyDb.insert(schema.companies).values({
      id: companyId,
      legalName: "LedgerAI PH Test Corp",
      tradeName: "LedgerAI PH",
      tin: "123-456-789-000",
      status: "ACTIVE",
      isDemo: true
    }).onConflictDoNothing();

    // 2. Insert Company Owner role
    const roleId = "role-company-owner";
    await companyDb.insert(schema.roles).values({
      id: roleId,
      code: "COMPANY_OWNER",
      name: "Company Owner",
      description: "Full access to all modules and system settings",
      isSystem: true
    }).onConflictDoNothing();

    // 3. Insert Admin user (admin@ledgerai.ph / Password123!)
    const userId = "user-test-admin-uuid";
    const passwordHash = await bcrypt.hash("Password123!", 10);
    await companyDb.insert(schema.users).values({
      id: userId,
      email: "admin@ledgerai.ph",
      passwordHash,
      displayName: "System Owner",
      status: "ACTIVE"
    }).onConflictDoNothing();

    // 4. Link user to company
    const membershipId = "membership-test-admin-uuid";
    await companyDb.insert(schema.companyUsers).values({
      id: membershipId,
      userId,
      companyId,
      roleId,
      status: "ACTIVE"
    }).onConflictDoNothing();

    // 5. Link role in companyUserRoles
    await companyDb.insert(schema.companyUserRoles).values({
      id: crypto.randomUUID(),
      companyUserId: membershipId,
      roleId
    }).onConflictDoNothing();

    // 6. Seed Philippine COA
    const sampleCOA = [
      { accountCode: "1010", accountName: "Cash in Bank", accountType: "ASSET", normalBalance: "DEBIT", isCashAccount: true },
      { accountCode: "1020", accountName: "Petty Cash Fund", accountType: "ASSET", normalBalance: "DEBIT", isCashAccount: true },
      { accountCode: "1030", accountName: "Accounts Receivable", accountType: "ASSET", normalBalance: "DEBIT", isControlAccount: true },
      { accountCode: "1050", accountName: "Input VAT", accountType: "ASSET", normalBalance: "DEBIT", isTaxAccount: true },
      { accountCode: "2010", accountName: "Accounts Payable", accountType: "LIABILITY", normalBalance: "CREDIT", isControlAccount: true },
      { accountCode: "2020", accountName: "Output VAT", accountType: "LIABILITY", normalBalance: "CREDIT", isTaxAccount: true },
      { accountCode: "3010", accountName: "Owner's Equity / Capital", accountType: "EQUITY", normalBalance: "CREDIT" },
      { accountCode: "4010", accountName: "Service Revenue / Sales", accountType: "REVENUE", normalBalance: "CREDIT" },
      { accountCode: "5010", accountName: "Cost of Goods Sold / Services", accountType: "COST_OF_SALES", normalBalance: "DEBIT" },
      { accountCode: "6010", accountName: "Salaries and Wages", accountType: "EXPENSE", normalBalance: "DEBIT" }
    ];

    for (const acc of sampleCOA) {
      await companyDb.insert(schema.accounts).values({
        id: crypto.randomUUID(),
        companyId,
        accountCode: acc.accountCode,
        accountName: acc.accountName,
        accountType: acc.accountType,
        normalBalance: acc.normalBalance,
        isCashAccount: !!acc.isCashAccount,
        isControlAccount: !!acc.isControlAccount,
        isTaxAccount: !!acc.isTaxAccount
      }).onConflictDoNothing();
    }

    // Write seed flag so we don't repeat
    await fs.writeFile(seedFlagFile, 'seeded');
    console.log("Default test company successfully seeded.");
  }

  static async listCompanies(): Promise<CompanyManifest[]> {
    const regFile = paths.getRegistryFilePath();
    try {
      const content = await fs.readFile(regFile, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      return [];
    }
  }

  static async registerCompany(manifest: CompanyManifest) {
    const regFile = paths.getRegistryFilePath();
    const tempFile = `${regFile}.tmp`;
    const lockFile = `${regFile}.lock`;
    
    // Simple file-based lock
    await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' }).catch(() => { throw new Error("Registry locked by another process"); });
    
    try {
      await fs.mkdir(paths.getCompaniesRootDir(), { recursive: true });
      await fs.mkdir(path.dirname(regFile), { recursive: true });
      const companies = await this.listCompanies();
      const index = companies.findIndex(c => c.id === manifest.id);
      if (index > -1) {
        companies[index] = manifest;
      } else {
        companies.push(manifest);
      }
      await fs.writeFile(tempFile, JSON.stringify(companies, null, 2));
      await fs.rename(tempFile, regFile);
    } finally {
      await fs.unlink(lockFile).catch(() => {});
    }
  }

  static async unregisterCompany(companyId: string) {
    const regFile = paths.getRegistryFilePath();
    const tempFile = `${regFile}.tmp`;
    const lockFile = `${regFile}.lock`;
    
    await fs.writeFile(lockFile, process.pid.toString(), { flag: 'wx' }).catch(() => { throw new Error("Registry locked by another process"); });
    
    try {
      const companies = await this.listCompanies();
      const filtered = companies.filter(c => c.id !== companyId);
      if (filtered.length !== companies.length) {
        await fs.writeFile(tempFile, JSON.stringify(filtered, null, 2));
        await fs.rename(tempFile, regFile);
      }
    } finally {
      await fs.unlink(lockFile).catch(() => {});
    }
  }


  
  static ensureBaseSchema(sqlite: any) {
    try {
      const hasCompaniesTable = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'").get();
      if (!hasCompaniesTable) {
        console.log("[CompanyManager] Bootstrapping complete database schema from SQL definition...");
        const potentialSqlPaths = [
          path.resolve(process.cwd(), 'src/server/db/migrations/0000_unusual_chat.sql'),
          path.resolve(process.cwd(), 'dist/migrations/0000_unusual_chat.sql'),
          path.join(typeof __dirname !== 'undefined' ? __dirname : '', 'migrations/0000_unusual_chat.sql'),
          path.join(typeof __dirname !== 'undefined' ? __dirname : '', '../migrations/0000_unusual_chat.sql'),
          path.join(typeof __dirname !== 'undefined' ? __dirname : '', '../dist/migrations/0000_unusual_chat.sql'),
          path.join(typeof __dirname !== 'undefined' ? __dirname : '', 'src/server/db/migrations/0000_unusual_chat.sql')
        ];
        let sqlContent = '';
        for (const p of potentialSqlPaths) {
          if (fsSync.existsSync(p)) {
            sqlContent = fsSync.readFileSync(p, 'utf-8');
            break;
          }
        }
        if (sqlContent) {
          const statements = sqlContent.split('--> statement-breakpoint');
          sqlite.transaction(() => {
            for (const rawStmt of statements) {
              const stmt = rawStmt.trim();
              if (stmt) {
                try {
                  sqlite.exec(stmt);
                } catch (err: any) {
                  // Ignore statement errors if table/index exists
                }
              }
            }
          })();
          console.log("[CompanyManager] Successfully bootstrapped complete SQLite schema tables.");
        }
      }
    } catch (bootstrapErr: any) {
      console.error("[CompanyManager] ensureBaseSchema error:", bootstrapErr.message);
    }
  }

  static async validateStorageIsolation(companyId: string, locationPath: string) {
    const resolvedPath = path.resolve(locationPath);
    const companies = await this.listCompanies();
    for (const c of companies) {
      if (c.id !== companyId && c.location) {
        const existingPath = path.resolve(c.location);
        // Only prevent exact match
        if (resolvedPath === existingPath) {
          throw new Error(`STORAGE_ISOLATION_ERROR: Storage path overlaps with another registered company (Company ID: ${c.id}).`);
        }
      }
    }
    return resolvedPath;
  }

  static async updateCompanyManifest(companyId: string, updates: Partial<CompanyManifest>) {
    const regFile = paths.getRegistryFilePath();
    const companies = await this.listCompanies();
    const index = companies.findIndex(c => c.id === companyId);
    if (index > -1) {
      companies[index] = { ...companies[index], ...updates };
      await fs.writeFile(regFile, JSON.stringify(companies, null, 2));
      
      const manifestPath = path.join(companies[index].location || path.dirname(companies[index].dbPath), "manifest.json");
      try {
        await fs.writeFile(manifestPath, JSON.stringify(companies[index], null, 2));
      } catch (e) {
        // Ignore if directory missing
      }
    }
  }

  static async getCompanyDb(companyId: string): Promise<any> {
    if (dbCache.has(companyId)) {
      const manifest = await this.getCompanyManifest(companyId);
      if (manifest) {
        try {
          // Check if either the lai or active sqlite file exists, or at least the directory
          const companyDir = manifest.location || path.dirname(manifest.dbPath);
          await fs.access(companyDir);
          return dbCache.get(companyId)!;
        } catch {
          dbCache.delete(companyId);
          throw new Error("COMPANY_LOCATION_MISSING: The drive or path for company " + manifest.legalName + " is not accessible (" + manifest.dbPath + ")");
        }
      }
    }
    
    const manifest = await this.getCompanyManifest(companyId);
    
    if (!manifest) {
      throw new Error(`COMPANY_NOT_FOUND: ${companyId}`);
    }

    const companyDir = manifest.location || path.dirname(manifest.dbPath);

    // Validate location and missing drive
    try {
      await fs.access(companyDir);
    } catch {
      throw new Error(`COMPANY_LOCATION_MISSING: The drive or path for company ${manifest.legalName} is not accessible (${companyDir})`);
    }

    let dbPath = manifest.dbPath;
    if (!dbPath) {
      const defaultLai = path.resolve(companyDir, 'database.lai');
      dbPath = fsSync.existsSync(defaultLai) ? defaultLai : path.resolve(companyDir, 'database.sqlite');
    }

    const activeSqlitePath = path.resolve(companyDir, '.db_active.sqlite');

    // Handle Encryption at Rest (Decrypt encrypted .lai or migrate unencrypted db to encrypted .lai)
    if (fsSync.existsSync(dbPath)) {
      const isEncrypted = DatabaseEncryptionService.isEncryptedLaiSync(dbPath);
      if (isEncrypted) {
        DatabaseEncryptionService.decryptDatabaseFileSync(dbPath, activeSqlitePath);
      } else {
        // Unencrypted legacy file: copy to active sqlite and encrypt to database.lai
        fsSync.copyFileSync(dbPath, activeSqlitePath);
        DatabaseEncryptionService.encryptDatabaseFileSync(activeSqlitePath, dbPath);
      }
    } else {
      // If dbPath doesn't exist yet, check if activeSqlitePath exists or create empty
      if (fsSync.existsSync(activeSqlitePath)) {
        DatabaseEncryptionService.encryptDatabaseFileSync(activeSqlitePath, dbPath);
      }
    }

    // SQLite connection to decrypted/runtime active sqlite file
    const sqlite: any = new Database(activeSqlitePath);
    
    // Configure SQLite busy timeout and WAL mode for multi-user concurrency
    try {
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('busy_timeout = 5000');
    } catch (e: any) {
      console.error(`Failed to execute SQLite PRAGMAs for company ${companyId}:`, e.message);
    }

    const db = drizzle(sqlite, { schema });

    let isCorrupt = false;
    // Explicit Integrity Check
    try {
      const integrity = sqlite.pragma('integrity_check') as any[];
      if (integrity[0]?.integrity_check !== 'ok') {
        throw new Error('CORRUPT_DATABASE');
      }
    } catch (e: any) {
      console.error(`Database integrity check failed for company ${companyId}:`, e.message);
      await this.updateCompanyManifest(companyId, { status: "RECOVERY_READ_ONLY" });
      isCorrupt = true;
    }
    
    if (!isCorrupt) {
      // Run migrations (schema versioning & transaction safe)
      try {
    let migrationsFolder = path.resolve(process.cwd(), 'dist/migrations'); // Standard compiled dist location
    const altMigrationsFolder1 = path.join(typeof __dirname !== 'undefined' ? __dirname : '', 'migrations');
    const altMigrationsFolder2 = path.join(typeof __dirname !== 'undefined' ? __dirname : '', '..', 'migrations');
    const altMigrationsFolder3 = path.join(typeof __dirname !== 'undefined' ? __dirname : '', '..', 'dist', 'migrations');
    
    if (!fsSync.existsSync(migrationsFolder)) {
      if (fsSync.existsSync(altMigrationsFolder1)) migrationsFolder = altMigrationsFolder1;
      else if (fsSync.existsSync(altMigrationsFolder2)) migrationsFolder = altMigrationsFolder2;
      else if (fsSync.existsSync(altMigrationsFolder3)) migrationsFolder = altMigrationsFolder3;
      else migrationsFolder = path.resolve(process.cwd(), 'src/server/db/migrations'); // Dev runtime relative path
    }
        await fs.access(migrationsFolder);
        // drizzle-orm migrator uses transactions internally for sqlite
        await migrate(db, { migrationsFolder });
        
        // Ensure Phase 8 and Phase 9 schema changes are applied if migration runner skipped them
        try {
          await sqlite.exec("ALTER TABLE sales_invoices ADD COLUMN invoice_type text DEFAULT 'SALES' NOT NULL;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE sales_invoices ADD COLUMN reference text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE purchase_bills ADD COLUMN reference text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE accounts ADD COLUMN detail_type text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE accounts ADD COLUMN is_sub_account integer DEFAULT 0;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE accounts ADD COLUMN bir_tax_category text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE accounts ADD COLUMN opening_balance real DEFAULT 0;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE accounts ADD COLUMN as_of_date text;");
        } catch (_) {}

        // Phase 4: Document Management & OCR columns
        const docCols = [
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
          "ALTER TABLE documents ADD COLUMN updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL;"
        ];
        for (const colSql of docCols) {
          try {
            await sqlite.exec(colSql);
          } catch (_) {}
        }

        // Phase 5: Custom Employee Statutory Deductions
        const empCols = [
          "ALTER TABLE employees ADD COLUMN custom_sss_ee integer DEFAULT 0;",
          "ALTER TABLE employees ADD COLUMN custom_sss_er integer DEFAULT 0;",
          "ALTER TABLE employees ADD COLUMN custom_philhealth_ee integer DEFAULT 0;",
          "ALTER TABLE employees ADD COLUMN custom_philhealth_er integer DEFAULT 0;",
          "ALTER TABLE employees ADD COLUMN custom_pagibig_ee integer DEFAULT 0;",
          "ALTER TABLE employees ADD COLUMN custom_pagibig_er integer DEFAULT 0;",
          "ALTER TABLE employees ADD COLUMN custom_withholding_tax integer DEFAULT 0;"
        ];
        for (const colSql of empCols) {
          try {
            await sqlite.exec(colSql);
          } catch (_) {}
        }
        try {
          await sqlite.exec("PRAGMA foreign_keys=OFF;");
          await sqlite.exec(`
            CREATE TABLE IF NOT EXISTS users_new (
              id text PRIMARY KEY NOT NULL,
              email text NOT NULL UNIQUE,
              password_hash text NOT NULL,
              display_name text NOT NULL,
              theme text DEFAULT 'light',
              status text DEFAULT 'ACTIVE' NOT NULL,
              is_demo integer DEFAULT 0,
              last_login_at integer,
              failed_login_attempts integer DEFAULT 0 NOT NULL,
              locked_until integer,
              require_password_change integer DEFAULT 0,
              created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
              updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
            );
          `);
          try {
            await sqlite.exec(`
              INSERT OR IGNORE INTO users_new (id, email, password_hash, display_name, status, created_at, updated_at)
              SELECT id, email, password_hash, display_name, status, created_at, updated_at FROM users;
            `);
          } catch (_) {}
          await sqlite.exec(`DROP TABLE IF EXISTS users;`);
          await sqlite.exec(`ALTER TABLE users_new RENAME TO users;`);
          await sqlite.exec("PRAGMA foreign_keys=ON;");
        } catch (e) {
          await sqlite.exec("PRAGMA foreign_keys=ON;").catch(() => {});
          console.error("users migration fix error:", e);
        }
        try {
          await sqlite.exec("PRAGMA foreign_keys=OFF;");
          await sqlite.exec(`
            CREATE TABLE IF NOT EXISTS company_licenses_new (
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
            );
          `);
          // Copy data from old table if it exists
          try {
            await sqlite.exec(`
              INSERT OR IGNORE INTO company_licenses_new (id, company_id, license_key, plan_type, status, trial_start_date, expiration_date, signed_file_content, is_lifetime, created_at, updated_at)
              SELECT id, company_id, license_key, plan_type, status, COALESCE(valid_from, '2026-01-01'), COALESCE(valid_until, '2027-01-01'), COALESCE(metadata, '{}'), 0, created_at, updated_at FROM company_licenses;
            `);
          } catch (_) {}
          await sqlite.exec(`DROP TABLE IF EXISTS company_licenses;`);
          await sqlite.exec(`ALTER TABLE company_licenses_new RENAME TO company_licenses;`);
          await sqlite.exec("PRAGMA foreign_keys=ON;");
        } catch (e) {
          await sqlite.exec("PRAGMA foreign_keys=ON;").catch(() => {});
          console.error("company_licenses migration fix error:", e);
        }
        try {
          await sqlite.exec(`
            CREATE TABLE IF NOT EXISTS license_audit_logs (
              id text PRIMARY KEY,
              company_id text,
              action text NOT NULL,
              details text NOT NULL,
              created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              FOREIGN KEY(company_id) REFERENCES companies(id)
            );
          `);
          await sqlite.exec(`
            CREATE TABLE IF NOT EXISTS company_user_roles (
              id text PRIMARY KEY,
              company_user_id text NOT NULL REFERENCES company_users(id),
              role_id text NOT NULL REFERENCES roles(id),
              created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              UNIQUE(company_user_id, role_id)
            );
          `);
          await sqlite.exec(`
            CREATE TABLE IF NOT EXISTS user_permission_overrides (
              id text PRIMARY KEY,
              company_user_id text NOT NULL REFERENCES company_users(id),
              permission_code text NOT NULL,
              effect text NOT NULL,
              reason text,
              created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              UNIQUE(company_user_id, permission_code)
            );
          `);
          await sqlite.exec(`
            CREATE TABLE IF NOT EXISTS sod_restrictions (
              id text PRIMARY KEY,
              rule_code text NOT NULL UNIQUE,
              rule_name text NOT NULL,
              description text,
              incompatible_role_1 text NOT NULL,
              incompatible_role_2 text NOT NULL,
              restricted_permissions text,
              status text NOT NULL DEFAULT 'ACTIVE',
              created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );
          `);
        } catch (err) {
          console.error("Error creating phase 3 tables", err);
        }
        try {
          await sqlite.exec("ALTER TABLE purchase_bills ADD COLUMN notes text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN address text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN branch_code text DEFAULT '00000';");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN contact_person text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN contact_email text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN contact_phone text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN industry text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN fiscal_year integer DEFAULT 2026;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN accounting_method text DEFAULT 'ACCRUAL';");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN taxpayer_classification text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN bir_registration_no text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN bir_date_registered text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN document_location_path text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE companies ADD COLUMN backup_location_path text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE purchase_bills ADD COLUMN attachment_url text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payments ADD COLUMN withholding_tax_amount integer DEFAULT 0 NOT NULL;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payments ADD COLUMN withholding_tax_account_id text REFERENCES accounts(id);");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payments ADD COLUMN overpayment_amount integer DEFAULT 0 NOT NULL;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payments ADD COLUMN payment_method text DEFAULT 'BANK_TRANSFER' NOT NULL;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payments ADD COLUMN notes text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payments ADD COLUMN attachment_url text;");
        } catch (_) {}
        try {
          await sqlite.exec("ALTER TABLE supplier_payment_applications ADD COLUMN withholding_amount integer DEFAULT 0 NOT NULL;");
        } catch (_) {}
        try {
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS customer_payments (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            customer_id text NOT NULL REFERENCES customers(id),
            payment_number text NOT NULL,
            official_receipt_number text,
            payment_date text NOT NULL,
            cash_account_id text NOT NULL REFERENCES accounts(id),
            amount integer NOT NULL,
            withholding_tax_amount integer DEFAULT 0 NOT NULL,
            withholding_tax_account_id text REFERENCES accounts(id),
            overpayment_amount integer DEFAULT 0 NOT NULL,
            payment_method text DEFAULT 'BANK_TRANSFER' NOT NULL,
            reference text,
            notes text,
            status text DEFAULT 'DRAFT' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_by text REFERENCES users(id),
            submitted_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS customer_payment_applications (
            id text PRIMARY KEY NOT NULL,
            payment_id text NOT NULL REFERENCES customer_payments(id),
            invoice_id text NOT NULL REFERENCES sales_invoices(id),
            applied_amount integer NOT NULL,
            withholding_amount integer DEFAULT 0 NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS credit_memos (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            customer_id text NOT NULL REFERENCES customers(id),
            credit_memo_number text NOT NULL,
            memo_date text NOT NULL,
            reason text,
            total_amount integer NOT NULL,
            balance_remaining integer NOT NULL,
            status text DEFAULT 'DRAFT' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_by text REFERENCES users(id),
            submitted_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS credit_memo_lines (
            id text PRIMARY KEY NOT NULL,
            credit_memo_id text NOT NULL REFERENCES credit_memos(id),
            account_id text NOT NULL REFERENCES accounts(id),
            tax_code_id text REFERENCES tax_codes(id),
            description text,
            quantity real DEFAULT 1 NOT NULL,
            unit_price integer NOT NULL,
            amount integer NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS credit_memo_applications (
            id text PRIMARY KEY NOT NULL,
            credit_memo_id text NOT NULL REFERENCES credit_memos(id),
            invoice_id text NOT NULL REFERENCES sales_invoices(id),
            applied_amount integer NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          // LEDGERAI PH MODULES
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS currency_exchange_rates (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            rate_date text NOT NULL,
            currency text DEFAULT 'USD' NOT NULL,
            bsp_spot_rate real NOT NULL,
            source text DEFAULT 'BSP' NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS inventory_items (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            sku text NOT NULL,
            name text NOT NULL,
            description text,
            category text,
            unit_of_measure text DEFAULT 'PCS' NOT NULL,
            costing_method text DEFAULT 'FIFO' NOT NULL,
            unit_cost integer DEFAULT 0 NOT NULL,
            selling_price integer DEFAULT 0 NOT NULL,
            quantity_on_hand real DEFAULT 0 NOT NULL,
            reorder_point real DEFAULT 10 NOT NULL,
            asset_account_id text REFERENCES accounts(id),
            cogs_account_id text REFERENCES accounts(id),
            status text DEFAULT 'ACTIVE' NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS stock_adjustments (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            adjustment_number text NOT NULL,
            adjustment_date text NOT NULL,
            item_id text NOT NULL REFERENCES inventory_items(id),
            quantity_change real NOT NULL,
            reason text NOT NULL,
            expense_account_id text REFERENCES accounts(id),
            status text DEFAULT 'POSTED' NOT NULL,
            created_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS employees (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            employee_no text NOT NULL,
            first_name text NOT NULL,
            last_name text NOT NULL,
            email text,
            tin text,
            sss_no text,
            philhealth_no text,
            pagibig_no text,
            position text,
            department text,
            monthly_basic_salary integer NOT NULL,
            daily_rate integer DEFAULT 0 NOT NULL,
            hourly_rate integer DEFAULT 0 NOT NULL,
            status text DEFAULT 'ACTIVE' NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS payroll_runs (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            payroll_period text NOT NULL,
            start_date text NOT NULL,
            end_date text NOT NULL,
            payment_date text NOT NULL,
            total_gross_pay integer DEFAULT 0 NOT NULL,
            total_sss integer DEFAULT 0 NOT NULL,
            total_philhealth integer DEFAULT 0 NOT NULL,
            total_pagibig integer DEFAULT 0 NOT NULL,
            total_withholding_tax integer DEFAULT 0 NOT NULL,
            total_net_pay integer DEFAULT 0 NOT NULL,
            status text DEFAULT 'DRAFT' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS payroll_items (
            id text PRIMARY KEY NOT NULL,
            payroll_run_id text NOT NULL REFERENCES payroll_runs(id),
            employee_id text NOT NULL REFERENCES employees(id),
            basic_pay integer NOT NULL,
            overtime_pay integer DEFAULT 0 NOT NULL,
            holiday_pay integer DEFAULT 0 NOT NULL,
            night_diff_pay integer DEFAULT 0 NOT NULL,
            gross_pay integer NOT NULL,
            sss_employee integer DEFAULT 0 NOT NULL,
            sss_employer integer DEFAULT 0 NOT NULL,
            philhealth_employee integer DEFAULT 0 NOT NULL,
            philhealth_employer integer DEFAULT 0 NOT NULL,
            pagibig_employee integer DEFAULT 0 NOT NULL,
            pagibig_employer integer DEFAULT 0 NOT NULL,
            withholding_tax integer DEFAULT 0 NOT NULL,
            total_deductions integer NOT NULL,
            net_pay integer NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS fixed_assets (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            asset_tag text NOT NULL,
            asset_name text NOT NULL,
            category text NOT NULL,
            acquisition_date text NOT NULL,
            acquisition_cost integer NOT NULL,
            salvage_value integer DEFAULT 0 NOT NULL,
            useful_life_months integer NOT NULL,
            depreciation_method text DEFAULT 'STRAIGHT_LINE' NOT NULL,
            asset_account_id text REFERENCES accounts(id),
            accumulated_dep_account_id text REFERENCES accounts(id),
            depreciation_expense_account_id text REFERENCES accounts(id),
            status text DEFAULT 'ACTIVE' NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS depreciation_schedules (
            id text PRIMARY KEY NOT NULL,
            asset_id text NOT NULL REFERENCES fixed_assets(id),
            company_id text NOT NULL REFERENCES companies(id),
            period_month text NOT NULL,
            depreciation_amount integer NOT NULL,
            accumulated_depreciation integer NOT NULL,
            book_value integer NOT NULL,
            status text DEFAULT 'PENDING' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS purchase_orders (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            vendor_id text NOT NULL REFERENCES vendors(id),
            po_number text NOT NULL,
            po_date text NOT NULL,
            expected_delivery_date text,
            total_amount integer NOT NULL,
            status text DEFAULT 'DRAFT' NOT NULL,
            created_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS purchase_order_lines (
            id text PRIMARY KEY NOT NULL,
            po_id text NOT NULL REFERENCES purchase_orders(id),
            item_id text REFERENCES inventory_items(id),
            description text NOT NULL,
            quantity_ordered real NOT NULL,
            quantity_received real DEFAULT 0 NOT NULL,
            unit_price integer NOT NULL,
            amount integer NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS goods_receipt_notes (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            po_id text NOT NULL REFERENCES purchase_orders(id),
            grn_number text NOT NULL,
            receipt_date text NOT NULL,
            delivery_note_no text,
            status text DEFAULT 'RECEIVED' NOT NULL,
            received_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS goods_receipt_lines (
            id text PRIMARY KEY NOT NULL,
            grn_id text NOT NULL REFERENCES goods_receipt_notes(id),
            po_line_id text NOT NULL REFERENCES purchase_order_lines(id),
            quantity_received real NOT NULL,
            notes text,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS debit_memos (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            vendor_id text NOT NULL REFERENCES vendors(id),
            debit_memo_number text NOT NULL,
            memo_date text NOT NULL,
            reason text,
            total_amount integer NOT NULL,
            balance_remaining integer NOT NULL,
            attachment_url text,
            status text DEFAULT 'DRAFT' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_by text REFERENCES users(id),
            submitted_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS debit_memo_lines (
            id text PRIMARY KEY NOT NULL,
            debit_memo_id text NOT NULL REFERENCES debit_memos(id),
            account_id text NOT NULL REFERENCES accounts(id),
            tax_code_id text REFERENCES tax_codes(id),
            description text,
            quantity real DEFAULT 1 NOT NULL,
            unit_price integer NOT NULL,
            amount integer NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS debit_memo_applications (
            id text PRIMARY KEY NOT NULL,
            debit_memo_id text NOT NULL REFERENCES debit_memos(id),
            bill_id text NOT NULL REFERENCES purchase_bills(id),
            applied_amount integer NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          // Phase 10 Cash Management Schema Updates
          try {
            await sqlite.exec("ALTER TABLE cash_transactions ADD COLUMN attachment_url text;");
          } catch (_) {}

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS checks (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            check_number text NOT NULL,
            check_date text NOT NULL,
            payee_name text NOT NULL,
            cash_account_id text NOT NULL REFERENCES accounts(id),
            amount integer NOT NULL,
            voucher_number text,
            status text DEFAULT 'ISSUED' NOT NULL,
            cleared_date text,
            cancellation_reason text,
            cancellation_journal_entry_id text REFERENCES journal_entries(id),
            attachment_url text,
            notes text,
            created_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS bank_deposits (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            deposit_number text NOT NULL,
            deposit_date text NOT NULL,
            to_bank_account_id text NOT NULL REFERENCES accounts(id),
            from_cash_account_id text NOT NULL REFERENCES accounts(id),
            total_amount integer NOT NULL,
            reference text,
            notes text,
            attachment_url text,
            status text DEFAULT 'DRAFT' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_by text REFERENCES users(id),
            submitted_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS cash_counts (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            count_number text NOT NULL,
            count_date text NOT NULL,
            cash_account_id text NOT NULL REFERENCES accounts(id),
            custodian_name text NOT NULL,
            book_balance integer NOT NULL,
            counted_balance integer NOT NULL,
            variance_amount integer DEFAULT 0 NOT NULL,
            variance_account_id text REFERENCES accounts(id),
            notes text,
            attachment_url text,
            status text DEFAULT 'DRAFT' NOT NULL,
            journal_entry_id text REFERENCES journal_entries(id),
            created_by text REFERENCES users(id),
            submitted_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS cash_count_denominations (
            id text PRIMARY KEY NOT NULL,
            cash_count_id text NOT NULL REFERENCES cash_counts(id),
            denomination_label text NOT NULL,
            unit_value integer NOT NULL,
            count_quantity integer NOT NULL,
            total_amount integer NOT NULL
          );`);

          // Phase 11 Bank Reconciliation
          await sqlite.exec(`CREATE TABLE IF NOT EXISTS bank_reconciliations (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            bank_account_id text NOT NULL REFERENCES accounts(id),
            statement_date text NOT NULL,
            statement_ending_balance integer NOT NULL,
            book_ending_balance integer DEFAULT 0 NOT NULL,
            cleared_deposits_count integer DEFAULT 0 NOT NULL,
            cleared_deposits_amount integer DEFAULT 0 NOT NULL,
            cleared_checks_count integer DEFAULT 0 NOT NULL,
            cleared_checks_amount integer DEFAULT 0 NOT NULL,
            outstanding_checks_count integer DEFAULT 0 NOT NULL,
            outstanding_checks_amount integer DEFAULT 0 NOT NULL,
            deposits_in_transit_count integer DEFAULT 0 NOT NULL,
            deposits_in_transit_amount integer DEFAULT 0 NOT NULL,
            bank_charges_amount integer DEFAULT 0 NOT NULL,
            interest_income_amount integer DEFAULT 0 NOT NULL,
            other_adjustments_amount integer DEFAULT 0 NOT NULL,
            adjusted_book_balance integer DEFAULT 0 NOT NULL,
            adjusted_statement_balance integer DEFAULT 0 NOT NULL,
            unexplained_difference integer DEFAULT 0 NOT NULL,
            status text DEFAULT 'DRAFT' NOT NULL,
            reopen_reason text,
            journal_entry_id text REFERENCES journal_entries(id),
            notes text,
            attachment_url text,
            created_by text REFERENCES users(id),
            submitted_by text REFERENCES users(id),
            approved_by text REFERENCES users(id),
            reopened_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS bank_statement_lines (
            id text PRIMARY KEY NOT NULL,
            bank_reconciliation_id text NOT NULL REFERENCES bank_reconciliations(id),
            company_id text NOT NULL REFERENCES companies(id),
            bank_account_id text NOT NULL REFERENCES accounts(id),
            line_date text NOT NULL,
            description text NOT NULL,
            reference text,
            type text NOT NULL,
            amount integer NOT NULL,
            matched_status text DEFAULT 'UNMATCHED' NOT NULL,
            matched_type text,
            matched_entity_id text,
            matched_amount integer DEFAULT 0 NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS bank_reconciliation_adjustments (
            id text PRIMARY KEY NOT NULL,
            bank_reconciliation_id text NOT NULL REFERENCES bank_reconciliations(id),
            company_id text NOT NULL REFERENCES companies(id),
            type text NOT NULL,
            amount integer NOT NULL,
            offset_account_id text NOT NULL REFERENCES accounts(id),
            description text NOT NULL,
            reference text,
            adjustment_date text NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS tax_filings (
            id text PRIMARY KEY NOT NULL,
            company_id text NOT NULL REFERENCES companies(id),
            tax_type text NOT NULL,
            period_name text NOT NULL,
            start_date text NOT NULL,
            end_date text NOT NULL,
            deadline_date text NOT NULL,
            status text DEFAULT 'DRAFT' NOT NULL,
            total_tax_base integer DEFAULT 0 NOT NULL,
            total_tax_due integer DEFAULT 0 NOT NULL,
            net_tax_payable integer DEFAULT 0 NOT NULL,
            filed_at integer,
            filed_by text REFERENCES users(id),
            locked_at integer,
            locked_by text REFERENCES users(id),
            notes text,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
            updated_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS tax_filing_checklists (
            id text PRIMARY KEY NOT NULL,
            tax_filing_id text NOT NULL REFERENCES tax_filings(id),
            task_name text NOT NULL,
            description text,
            is_completed integer DEFAULT 0 NOT NULL,
            completed_by text REFERENCES users(id),
            completed_at integer
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS tax_manual_adjustments (
            id text PRIMARY KEY NOT NULL,
            tax_filing_id text NOT NULL REFERENCES tax_filings(id),
            company_id text NOT NULL REFERENCES companies(id),
            adjustment_type text NOT NULL,
            description text NOT NULL,
            amount integer NOT NULL,
            reason text,
            created_by text REFERENCES users(id),
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);

          await sqlite.exec(`CREATE TABLE IF NOT EXISTS tax_calendar (
            id text PRIMARY KEY NOT NULL,
            company_id text REFERENCES companies(id),
            tax_type text NOT NULL,
            form_number text NOT NULL,
            period_description text NOT NULL,
            deadline_date text NOT NULL,
            status text DEFAULT 'UPCOMING' NOT NULL,
            created_at integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
          );`);
        } catch (err) { console.error("ALTER ERROR", err); }

        if (manifest.status === "RECOVERY_READ_ONLY") {
           await this.updateCompanyManifest(companyId, { status: "ACTIVE" });
        }
      } catch (err: any) {
        console.error(`Migration failed for company ${companyId}, executing fallback bootstrap:`, err);
        import('fs').then(fs => fs.writeFileSync(`/tmp/migration_error_${companyId}.log`, String(err?.stack || err)));
      }

      // Always guarantee base schema exists so queries never fail on missing tables
      this.ensureBaseSchema(sqlite);
      if (manifest.status === "RECOVERY_READ_ONLY") {
        await this.updateCompanyManifest(companyId, { status: "ACTIVE" });
      }
    }

    sqliteCache.set(companyId, sqlite);
    dbCache.set(companyId, db);
    return db;
  }

  static async closeCompanyDb(companyId: string) {
    dbCache.delete(companyId);
    const sqlite = sqliteCache.get(companyId);
    if (sqlite) {
      try {
        sqlite.close();
      } catch (err: any) {
        console.error(`[CompanyManager] Error closing SQLite connection for ${companyId}:`, err?.message);
      }
      sqliteCache.delete(companyId);
    }
  }

  static async rollbackCompanyCreation(companyId: string, locationPath?: string) {
    console.log(`[CompanyManager] Initiating atomic rollback for company creation: ${companyId}`);
    
    // 1. Close active DB handle and remove from caches
    await this.closeCompanyDb(companyId);

    // 2. Remove temporary manifest
    this.removeTempManifest(companyId);

    // 3. Unregister from registry if registered
    try {
      await this.unregisterCompany(companyId);
    } catch (_) {}

    // 4. Remove company directory from filesystem with retries for Windows file locks
    const targetDir = locationPath || path.join(COMPANIES_ROOT, companyId);
    if (targetDir && fsSync.existsSync(targetDir)) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await fs.rm(targetDir, { recursive: true, force: true });
          console.log(`[CompanyManager] Successfully cleaned up directory for ${companyId} on attempt ${attempt}`);
          break;
        } catch (rmErr: any) {
          console.error(`[CompanyManager] Retry ${attempt} removing ${targetDir}: ${rmErr.message}`);
          if (attempt === 3) {
            console.error(`[CompanyManager] Persistent failure cleaning up ${targetDir}`);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
          }
        }
      }
    }
  }

  static async createCompanyProfile(id: string, legalName: string, locationPath?: string, backupLocationPath?: string, skipRegistry: boolean = false): Promise<CompanyManifest> {
    const dirPath = locationPath || path.join(COMPANIES_ROOT, id);
    const backupPath = backupLocationPath || path.join(dirPath, 'backups');
    await fs.mkdir(dirPath, { recursive: true });
    await fs.mkdir(backupPath, { recursive: true });
    
    // Create folders
    await fs.mkdir(path.join(dirPath, 'documents'), { recursive: true });
    
    const manifest: CompanyManifest = {
      id,
      legalName,
      createdAt: new Date().toISOString(),
      dbPath: path.join(dirPath, 'database.lai'),
      documentLocation: path.join(dirPath, 'documents'),
      location: dirPath,
      backupLocation: backupPath,
      status: "ACTIVE",
      isDemo: false
    };

    await fs.writeFile(path.join(dirPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
    if (!skipRegistry) {
      await this.registerCompany(manifest);
    } else {
      this.setTempManifest(id, manifest);
    }
    
    // Initialize DB to create tables
    const companyDb = await this.getCompanyDb(id);
    try {
      await companyDb.insert(schema.companies).values({
        id,
        legalName,
        status: "ACTIVE",
        isDemo: false
      }).onConflictDoNothing();
    } catch (_) {}
    
    return manifest;
  }

  static async deleteCompany(id: string) {
    dbCache.delete(id);
    const companies = await this.listCompanies();
    const filtered = companies.filter(c => c.id !== id);
    if (filtered.length === companies.length) {
        throw new Error("Company not found in registry.");
    }
    const tempFile = `${REGISTRY_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(filtered, null, 2));
    await fs.rename(tempFile, REGISTRY_FILE);
  }

  static async clearRegistry() {
    dbCache.clear();
    // Instead of deleting the root, maybe just iterate and unregister?
    // Or at least log errors.
    const companies = await this.listCompanies();
    for (const company of companies) {
      try {
        await this.deleteCompany(company.id);
      } catch (e) {
        console.error(`Failed to unregister ${company.id}:`, e);
      }
    }
    const tempFile = `${REGISTRY_FILE}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify([], null, 2));
    await fs.rename(tempFile, REGISTRY_FILE);
  }

  static async browseAndRegisterCompanyFolder(folderPath: string): Promise<CompanyManifest> {
    const cleanInput = folderPath.trim();
    let resolvedPath = path.resolve(cleanInput);
    let isAccessible = false;

    try {
      await fs.access(resolvedPath);
      isAccessible = true;
    } catch {
      // If not accessible directly, check relative to companies root directory
      const inCompaniesRoot = path.join(paths.getCompaniesRootDir(), cleanInput);
      try {
        await fs.access(inCompaniesRoot);
        resolvedPath = inCompaniesRoot;
        isAccessible = true;
      } catch {
        const inCompaniesRootFallback = path.join(COMPANIES_ROOT, cleanInput);
        try {
          await fs.access(inCompaniesRootFallback);
          resolvedPath = inCompaniesRootFallback;
          isAccessible = true;
        } catch {
          isAccessible = false;
        }
      }
    }

    if (!isAccessible) {
      throw new Error(`FOLDER_NOT_ACCESSIBLE: Cannot access company folder at ${resolvedPath}`);
    }

    // If target path is a file (e.g. database.lai, manifest.json, backup file), use its directory
    try {
      const stats = await fs.stat(resolvedPath);
      if (stats.isFile()) {
        resolvedPath = path.dirname(resolvedPath);
      }
    } catch (_) {}

    let manifest: CompanyManifest | null = null;
    const manifestPath = path.join(resolvedPath, 'manifest.json');
    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(manifestContent);
    } catch {
      // manifest.json missing, check database.sqlite
    }

    let dbPath = path.join(resolvedPath, 'database.lai');
    try {
      await fs.access(dbPath);
    } catch {
      dbPath = path.join(resolvedPath, 'database.sqlite');
      try {
        await fs.access(dbPath);
      } catch {
        throw new Error(`INVALID_COMPANY_FOLDER: No valid company database (.lai or .sqlite) found in ${resolvedPath}`);
      }
    }

    // Connect to SQLite to retrieve company identity and run integrity/schema checks
    const sqlite: any = new Database(dbPath);
    try {
      // 1. Database Integrity Check
      const integrity = sqlite.pragma('integrity_check') as any[];
      if (integrity[0]?.integrity_check !== 'ok') {
        throw new Error('CORRUPT_DATABASE: Database integrity check failed for selected company folder.');
      }

      // 2. Schema Compatibility Check
      try {
        sqlite.prepare('SELECT COUNT(*) FROM companies').get();
        sqlite.prepare('SELECT COUNT(*) FROM users').get();
        sqlite.prepare('SELECT COUNT(*) FROM company_licenses').get();
        sqlite.prepare('SELECT COUNT(*) FROM company_users').get();
      } catch (schemaErr: any) {
        throw new Error(`SCHEMA_INCOMPATIBLE: SQLite database schema is incompatible or missing required LedgerAI PH tables: ${schemaErr.message}`);
      }

      // 3. Company ID & Identity Consistency Check
      const compResult = sqlite.prepare('SELECT id, legalName FROM companies LIMIT 1').all() as any[];
      if (compResult.length === 0) {
        throw new Error('INVALID_COMPANY_FOLDER: No company configuration found in database.');
      }

      const compRow = compResult[0];
      const companyId = String(compRow.id);
      const legalName = String(compRow.legalName || 'Imported Company');

      if (manifest && manifest.id && manifest.id !== companyId) {
        throw new Error(`IDENTITY_MISMATCH: Manifest ID (${manifest.id}) does not match the actual database company ID (${companyId}).`);
      }

      // 4. Ensure storage subfolders are configured and exist
      await fs.mkdir(path.join(resolvedPath, 'documents'), { recursive: true }).catch(() => {});
      await fs.mkdir(path.join(resolvedPath, 'backups'), { recursive: true }).catch(() => {});

      if (!manifest) {
        manifest = {
          id: companyId,
          legalName,
          createdAt: new Date().toISOString(),
          dbPath,
          documentLocation: path.join(resolvedPath, 'documents'),
          location: resolvedPath,
          backupLocation: path.join(resolvedPath, 'backups'),
          status: 'ACTIVE',
          isDemo: false,
          lastOpenedAt: new Date().toISOString()
        };
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2)).catch(() => {});
      } else {
        // Ensure path points to current resolved path
        manifest.location = resolvedPath;
        manifest.dbPath = dbPath;
        manifest.lastOpenedAt = new Date().toISOString();
        if (!manifest.backupLocation) {
          manifest.backupLocation = path.join(resolvedPath, 'backups');
        }
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2)).catch(() => {});
      }

      await this.registerCompany(manifest);
      return manifest;
    } finally {
      // sqlite client cleanup if needed
    }
  }

  static async closeAllConnections(): Promise<void> {
    console.log("Closing all active SQLite company database connections and encrypting workspaces...");
    for (const [companyId, db] of dbCache.entries()) {
      try {
        const manifest = await this.getCompanyManifest(companyId);
        if (db && (db as any).$client) {
          const client = (db as any).$client;
          try {
            client.pragma('wal_checkpoint(TRUNCATE)');
          } catch (e) {}
          if (typeof client.close === "function") {
            client.close();
          }
          console.log(`Successfully closed connection for company: ${companyId}`);
        }

        if (manifest && manifest.location) {
          const activeSqlitePath = path.resolve(manifest.location, '.db_active.sqlite');
          if (fsSync.existsSync(activeSqlitePath)) {
            DatabaseEncryptionService.encryptDatabaseFileSync(activeSqlitePath, manifest.dbPath);
            console.log(`Successfully encrypted workspace at rest for company: ${companyId}`);
          }
        }
      } catch (err: any) {
        console.error(`Error closing/encrypting connection for company ${companyId}:`, err.message);
      }
    }
    dbCache.clear();
  }
}
