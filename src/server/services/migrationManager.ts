import crypto from 'crypto';
import fsSync from 'fs';
import path from 'path';

export interface MigrationRecord {
  id: string;
  version: number;
  name: string;
  appliedAt: number;
  checksum: string;
  executionTimeMs: number;
  status: 'SUCCESS' | 'FAILED' | 'ROLLED_BACK';
  errorMessage?: string | null;
  rollbackSql?: string | null;
}

export interface MigrationDefinition {
  version: number;
  name: string;
  up: (sqlite: any) => void;
  down?: (sqlite: any) => void;
}

export class MigrationManager {
  private static ensureMigrationsTable(sqlite: any) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations_history (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        name TEXT NOT NULL UNIQUE,
        applied_at INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        execution_time_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        rollback_sql TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_version ON schema_migrations_history(version);
    `);
  }

  static getMigrationHistory(sqlite: any): MigrationRecord[] {
    try {
      this.ensureMigrationsTable(sqlite);
      return sqlite.prepare(`
        SELECT 
          id, version, name, applied_at as appliedAt, checksum,
          execution_time_ms as executionTimeMs, status, error_message as errorMessage,
          rollback_sql as rollbackSql
        FROM schema_migrations_history
        ORDER BY version ASC
      `).all() as MigrationRecord[];
    } catch {
      return [];
    }
  }

  private static getMigrations(): MigrationDefinition[] {
    return [
      {
        version: 1,
        name: '0001_core_enterprise_schema',
        up: (sqlite: any) => {
          // Verify base tables exist
          const hasCompanies = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'").get();
          if (!hasCompanies) {
            throw new Error('Base schema not bootstrapped before migration execution.');
          }
        }
      },
      {
        version: 2,
        name: '0002_sales_and_purchase_references',
        up: (sqlite: any) => {
          this.safeAddColumn(sqlite, 'sales_invoices', "invoice_type text DEFAULT 'SALES' NOT NULL");
          this.safeAddColumn(sqlite, 'sales_invoices', 'reference text');
          this.safeAddColumn(sqlite, 'purchase_bills', 'reference text');
          this.safeAddColumn(sqlite, 'purchase_bills', 'attachment_url text');
        }
      },
      {
        version: 3,
        name: '0003_chart_of_accounts_hierarchy',
        up: (sqlite: any) => {
          this.safeAddColumn(sqlite, 'accounts', 'detail_type text');
          this.safeAddColumn(sqlite, 'accounts', 'is_sub_account integer DEFAULT 0');
          this.safeAddColumn(sqlite, 'accounts', 'bir_tax_category text');
          this.safeAddColumn(sqlite, 'accounts', 'opening_balance real DEFAULT 0');
          this.safeAddColumn(sqlite, 'accounts', 'as_of_date text');
        }
      },
      {
        version: 4,
        name: '0004_document_management_and_ocr',
        up: (sqlite: any) => {
          const docCols = [
            "document_type text DEFAULT 'GENERAL_ATTACHMENT' NOT NULL",
            'original_file_name text',
            'file_size integer DEFAULT 0 NOT NULL',
            'file_hash text',
            "source text DEFAULT 'WEB_UI' NOT NULL",
            'linked_transaction_type text',
            'linked_transaction_id text',
            'linked_vendor_id text REFERENCES vendors(id)',
            'linked_customer_id text REFERENCES customers(id)',
            "ocr_status text DEFAULT 'PENDING'",
            "verification_status text DEFAULT 'UNVERIFIED' NOT NULL",
            'confidence_score real',
            'ocr_result text',
            'extracted_merchant text',
            'extracted_customer text',
            'extracted_tin text',
            'extracted_address text',
            'extracted_invoice_number text',
            'extracted_date text',
            'extracted_total_amount integer',
            'extracted_vat_amount integer',
            'extracted_vatable_sales integer',
            'extracted_vat_exempt_sales integer',
            'extracted_zero_rated_sales integer',
            'extracted_withholding_tax integer',
            'extracted_payment_method text',
            'extracted_category text',
            'validation_errors text',
            'validation_warnings text',
            'notes text',
            'verified_by text REFERENCES users(id)',
            'verified_at integer'
          ];
          for (const col of docCols) {
            this.safeAddColumn(sqlite, 'documents', col);
          }
        }
      },
      {
        version: 5,
        name: '0005_hr_employee_statutory_deductions',
        up: (sqlite: any) => {
          sqlite.exec(`CREATE TABLE IF NOT EXISTS employees (
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
          const empCols = [
            'custom_sss_ee integer DEFAULT 0',
            'custom_sss_er integer DEFAULT 0',
            'custom_philhealth_ee integer DEFAULT 0',
            'custom_philhealth_er integer DEFAULT 0',
            'custom_pagibig_ee integer DEFAULT 0',
            'custom_pagibig_er integer DEFAULT 0',
            'custom_withholding_tax integer DEFAULT 0'
          ];
          for (const col of empCols) {
            this.safeAddColumn(sqlite, 'employees', col);
          }
        }
      },
      {
        version: 6,
        name: '0006_user_security_and_licensing',
        up: (sqlite: any) => {
          const userCols = [
            "theme text DEFAULT 'light'",
            "status text DEFAULT 'ACTIVE' NOT NULL",
            'is_demo integer DEFAULT 0',
            'last_login_at integer',
            'failed_login_attempts integer DEFAULT 0 NOT NULL',
            'locked_until integer',
            'require_password_change integer DEFAULT 0'
          ];
          for (const col of userCols) {
            this.safeAddColumn(sqlite, 'users', col);
          }

          // Company metadata columns
          const compCols = [
            'address text',
            "branch_code text DEFAULT '00000'",
            'contact_person text',
            'contact_email text',
            'contact_phone text',
            'industry text',
            'fiscal_year integer DEFAULT 2026',
            "accounting_method text DEFAULT 'ACCRUAL'",
            'taxpayer_classification text',
            'bir_registration_no text',
            'bir_date_registered text',
            'document_location_path text',
            'backup_location_path text'
          ];
          for (const col of compCols) {
            this.safeAddColumn(sqlite, 'companies', col);
          }
        }
      },
      {
        version: 7,
        name: '0007_supplier_payments_withholding_tax',
        up: (sqlite: any) => {
          sqlite.exec(`CREATE TABLE IF NOT EXISTS customer_payments (
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
          this.safeAddColumn(sqlite, 'supplier_payments', 'withholding_tax_amount integer DEFAULT 0 NOT NULL');
          this.safeAddColumn(sqlite, 'supplier_payments', 'withholding_tax_account_id text REFERENCES accounts(id)');
          this.safeAddColumn(sqlite, 'supplier_payments', 'overpayment_amount integer DEFAULT 0 NOT NULL');
          this.safeAddColumn(sqlite, 'customer_payments', 'withholding_tax_amount integer DEFAULT 0 NOT NULL');
          this.safeAddColumn(sqlite, 'customer_payments', 'withholding_tax_account_id text REFERENCES accounts(id)');
          this.safeAddColumn(sqlite, 'customer_payments', 'overpayment_amount integer DEFAULT 0 NOT NULL');
        }
      },
      {
        version: 8,
        name: '0008_approval_orchestration_and_audit_journey',
        up: (sqlite: any) => {
          sqlite.exec(`
            CREATE TABLE IF NOT EXISTS approval_workflows (
              id TEXT PRIMARY KEY,
              company_id TEXT NOT NULL REFERENCES companies(id),
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              workflow_type TEXT NOT NULL DEFAULT 'SEQUENTIAL',
              status TEXT NOT NULL DEFAULT 'PENDING',
              current_step_order INTEGER NOT NULL DEFAULT 1,
              total_steps INTEGER NOT NULL DEFAULT 1,
              created_by TEXT REFERENCES users(id),
              created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              completed_at INTEGER,
              cancelled_at INTEGER,
              rejection_reason TEXT
            );

            CREATE TABLE IF NOT EXISTS approval_steps (
              id TEXT PRIMARY KEY,
              workflow_id TEXT NOT NULL REFERENCES approval_workflows(id),
              company_id TEXT NOT NULL REFERENCES companies(id),
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              step_order INTEGER NOT NULL DEFAULT 1,
              step_name TEXT NOT NULL,
              approval_mode TEXT NOT NULL DEFAULT 'SEQUENTIAL',
              required_role TEXT,
              required_department_id TEXT,
              amount_threshold_centavos INTEGER,
              assigned_user_id TEXT,
              assigned_user_name TEXT,
              actual_approver_id TEXT,
              actual_approver_name TEXT,
              status TEXT NOT NULL DEFAULT 'PENDING',
              assigned_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              action_taken_at INTEGER,
              sla_hours INTEGER,
              sla_due_at INTEGER,
              is_escalated INTEGER NOT NULL DEFAULT 0,
              escalated_to_user_id TEXT,
              escalated_at INTEGER,
              delegation_history TEXT,
              escalation_history TEXT,
              decision_remarks TEXT,
              created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );

            CREATE TABLE IF NOT EXISTS approval_delegations (
              id TEXT PRIMARY KEY,
              company_id TEXT NOT NULL REFERENCES companies(id),
              from_user_id TEXT NOT NULL,
              from_user_name TEXT,
              to_user_id TEXT NOT NULL,
              to_user_name TEXT,
              role_scope TEXT,
              module_scope TEXT,
              max_amount_centavos INTEGER,
              reason TEXT NOT NULL,
              is_temporary INTEGER NOT NULL DEFAULT 1,
              valid_from INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              valid_until INTEGER,
              status TEXT NOT NULL DEFAULT 'ACTIVE',
              created_by TEXT,
              created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );

            CREATE TABLE IF NOT EXISTS document_versions (
              id TEXT PRIMARY KEY,
              document_id TEXT NOT NULL,
              company_id TEXT NOT NULL REFERENCES companies(id),
              version_number INTEGER NOT NULL DEFAULT 1,
              file_name TEXT NOT NULL,
              original_file_name TEXT,
              file_type TEXT,
              file_size INTEGER,
              file_path TEXT,
              file_hash TEXT NOT NULL,
              change_type TEXT NOT NULL DEFAULT 'INITIAL_UPLOAD',
              change_reason TEXT,
              replaced_version_id TEXT,
              restored_from_version_id TEXT,
              linked_entity_type TEXT,
              linked_entity_id TEXT,
              linked_approval_workflow_id TEXT,
              ocr_status TEXT DEFAULT 'PENDING',
              ocr_engine TEXT,
              ocr_extracted_data TEXT,
              status TEXT NOT NULL DEFAULT 'ACTIVE',
              uploaded_by TEXT,
              uploaded_by_name TEXT,
              uploaded_by_role TEXT,
              uploaded_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              removed_by TEXT,
              removed_at INTEGER,
              removal_reason TEXT
            );

            CREATE TABLE IF NOT EXISTS document_ocr_history (
              id TEXT PRIMARY KEY,
              document_id TEXT NOT NULL,
              version_id TEXT,
              company_id TEXT NOT NULL REFERENCES companies(id),
              ocr_engine TEXT NOT NULL,
              model_version TEXT,
              status TEXT NOT NULL,
              confidence_score REAL,
              extracted_data TEXT,
              error_message TEXT,
              performed_by TEXT,
              performed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              processing_time_ms INTEGER
            );
          `);
        }
      },
      {
        version: 9,
        name: '0009_forensic_performance_indexes',
        up: (sqlite: any) => {
          const indexStatements = [
            'CREATE INDEX IF NOT EXISTS idx_journal_entries_comp_date ON journal_entries(company_id, entry_date);',
            'CREATE INDEX IF NOT EXISTS idx_journal_entries_comp_status ON journal_entries(company_id, status);',
            'CREATE INDEX IF NOT EXISTS idx_journal_lines_entry_id ON journal_lines(journal_entry_id);',
            'CREATE INDEX IF NOT EXISTS idx_journal_lines_account_id ON journal_lines(account_id);',
            'CREATE INDEX IF NOT EXISTS idx_sales_invoices_comp_date ON sales_invoices(company_id, invoice_date);',
            'CREATE INDEX IF NOT EXISTS idx_sales_invoices_comp_status ON sales_invoices(company_id, status);',
            'CREATE INDEX IF NOT EXISTS idx_purchase_bills_comp_date ON purchase_bills(company_id, bill_date);',
            'CREATE INDEX IF NOT EXISTS idx_purchase_bills_comp_status ON purchase_bills(company_id, status);',
            'CREATE INDEX IF NOT EXISTS idx_audit_logs_comp_entity ON audit_logs(company_id, entity_type, entity_id);',
            'CREATE INDEX IF NOT EXISTS idx_audit_logs_comp_timestamp ON audit_logs(company_id, timestamp);',
            'CREATE INDEX IF NOT EXISTS idx_approval_workflows_entity ON approval_workflows(company_id, entity_type, entity_id);',
            'CREATE INDEX IF NOT EXISTS idx_approval_steps_workflow ON approval_steps(workflow_id, step_order);'
          ];
          for (const idxSql of indexStatements) {
            try { sqlite.exec(idxSql); } catch (_) {}
          }
        }
      },
      {
        version: 10,
        name: '0010_align_approval_orchestration_schema',
        up: (sqlite: any) => {
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', 'record_reference TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', 'amount_centavos INTEGER DEFAULT 0');
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', 'department_id TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', 'submitted_by TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', 'submitted_by_name TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', 'submitted_at INTEGER');
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', 'cancelled_by TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', 'cancellation_reason TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', 'sla_due_at INTEGER');
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', "sla_status TEXT DEFAULT 'ON_TRACK'");
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', 'escalation_count INTEGER DEFAULT 0');
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', 'resubmission_count INTEGER DEFAULT 0');
          MigrationManager.safeAddColumn(sqlite, 'approval_workflows', 'metadata TEXT');

          MigrationManager.safeAddColumn(sqlite, 'audit_logs', 'record_reference TEXT');
          MigrationManager.safeAddColumn(sqlite, 'audit_logs', 'entity_name TEXT');
          MigrationManager.safeAddColumn(sqlite, 'audit_logs', 'module TEXT');
          MigrationManager.safeAddColumn(sqlite, 'audit_logs', 'severity TEXT');
          MigrationManager.safeAddColumn(sqlite, 'audit_logs', 'metadata TEXT');

          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'department_id TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'threshold_min_centavos INTEGER DEFAULT 0');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'threshold_max_centavos INTEGER');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'original_assigned_approver_id TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'original_assigned_approver_name TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'assigned_approver_id TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'assigned_approver_name TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'actual_approver_role TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'decision TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'comments TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'rejection_reason TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'reassignment_reason TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'reassigned_by TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'reassigned_at INTEGER');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'delegated_from_id TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'delegated_from_name TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'delegation_reason TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'escalation_level INTEGER DEFAULT 0');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'escalated_to_id TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'escalated_to_role TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'escalation_reason TEXT');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'responded_at INTEGER');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', 'duration_seconds INTEGER');
          MigrationManager.safeAddColumn(sqlite, 'approval_steps', "sla_status TEXT DEFAULT 'ON_TRACK'");
        }
      },
      {
        version: 11,
        name: '0011_user_module_assignments_and_email_index',
        up: (sqlite: any) => {
          sqlite.exec(`
            CREATE TABLE IF NOT EXISTS user_module_assignments (
              id TEXT PRIMARY KEY,
              company_user_id TEXT NOT NULL REFERENCES company_users(id),
              module_id TEXT NOT NULL,
              submodule_ids TEXT,
              actions TEXT,
              data_scope TEXT DEFAULT 'COMPANY',
              department_scope_id TEXT,
              approval_limit_centavos INTEGER DEFAULT 0,
              assigned_by TEXT REFERENCES users(id),
              assigned_by_name TEXT,
              created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );
            CREATE INDEX IF NOT EXISTS idx_uma_company_user ON user_module_assignments(company_user_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_uma_user_module ON user_module_assignments(company_user_id, module_id);

            CREATE TABLE IF NOT EXISTS user_module_assignment_history (
              id TEXT PRIMARY KEY,
              company_user_id TEXT NOT NULL REFERENCES company_users(id),
              module_id TEXT NOT NULL,
              action_type TEXT NOT NULL,
              previous_assignment TEXT,
              new_assignment TEXT,
              reason TEXT,
              changed_by TEXT NOT NULL,
              changed_by_name TEXT,
              changed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));
          `);

          const umaCols = [
            'submodule_ids TEXT',
            'actions TEXT',
            "data_scope TEXT DEFAULT 'COMPANY'",
            'department_scope_id TEXT',
            'approval_limit_centavos INTEGER DEFAULT 0',
            'assigned_by TEXT',
            'assigned_by_name TEXT',
            "updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)"
          ];
          for (const col of umaCols) {
            MigrationManager.safeAddColumn(sqlite, 'user_module_assignments', col);
          }
        }
      },
      {
        version: 12,
        name: '0012_strict_rbac_role_template_versions',
        up: (sqlite: any) => {
          sqlite.exec(`
            CREATE TABLE IF NOT EXISTS role_template_versions (
              id TEXT PRIMARY KEY,
              role_code TEXT NOT NULL,
              role_name TEXT NOT NULL,
              version_number INTEGER NOT NULL DEFAULT 1,
              is_active INTEGER NOT NULL DEFAULT 1,
              purpose TEXT,
              modules_json TEXT NOT NULL,
              submodules_json TEXT NOT NULL,
              permissions_json TEXT NOT NULL,
              hard_denied_json TEXT,
              data_scope TEXT NOT NULL DEFAULT 'COMPANY_WIDE',
              approval_limit_centavos INTEGER NOT NULL DEFAULT 0,
              restrictions_json TEXT,
              change_reason TEXT,
              changed_by TEXT,
              changed_by_name TEXT,
              approved_by TEXT,
              created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              UNIQUE(role_name, version_number)
            );
            CREATE INDEX IF NOT EXISTS idx_rtv_role_active ON role_template_versions(role_name, is_active);
          `);

          const cuCols = [
            'role_template_version INTEGER DEFAULT 1',
            'default_data_scope TEXT',
            'approval_limit_centavos INTEGER'
          ];
          for (const col of cuCols) {
            MigrationManager.safeAddColumn(sqlite, 'company_users', col);
          }

          const umaExtraCols = [
            'project_scope_id TEXT',
            'cost_center_scope_id TEXT',
            "origin TEXT DEFAULT 'INHERITED_FROM_ROLE'",
            "effect TEXT DEFAULT 'ALLOW'",
            'template_version INTEGER DEFAULT 1',
            'effective_from TEXT',
            'effective_to TEXT',
            'reason TEXT'
          ];
          for (const col of umaExtraCols) {
            MigrationManager.safeAddColumn(sqlite, 'user_module_assignments', col);
          }

          // Clean up any accidental blanket 16/16 assignments on non-Owner users so they inherit strict Role Catalog defaults
          try {
            const nonOwnersWith16 = sqlite.prepare(`
              SELECT cu.id as companyUserId, r.name as roleName, COUNT(uma.id) as modCount
              FROM company_users cu
              LEFT JOIN roles r ON cu.role_id = r.id
              JOIN user_module_assignments uma ON uma.company_user_id = cu.id
              WHERE COALESCE(r.name, cu.legacy_role, '') != 'Company Owner'
                AND COALESCE(r.code, '') != 'COMPANY_OWNER'
              GROUP BY cu.id
              HAVING COUNT(uma.id) >= 16
            `).all() as any[];

            for (const row of nonOwnersWith16) {
              sqlite.prepare(`DELETE FROM user_module_assignments WHERE company_user_id = ?`).run(row.companyUserId);
            }
          } catch (_) {}
        }
      },
      {
        version: 13,
        name: '0013_multi_role_compatibility_and_member_lifecycle',
        up: (sqlite: any) => {
          // 1. Create role_compatibility_rules table
          sqlite.exec(`
            CREATE TABLE IF NOT EXISTS role_compatibility_rules (
              id TEXT PRIMARY KEY,
              role_a TEXT NOT NULL,
              role_b TEXT NOT NULL,
              compatibility_type TEXT NOT NULL,
              reason TEXT NOT NULL,
              conditions_json TEXT,
              created_at INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS unq_role_compat_pair ON role_compatibility_rules(role_a, role_b);
          `);

          // 2. Add columns to role_template_versions
          MigrationManager.safeAddColumn(sqlite, 'role_template_versions', "is_custom INTEGER DEFAULT 0 NOT NULL");
          MigrationManager.safeAddColumn(sqlite, 'role_template_versions', "cloned_from TEXT");
          MigrationManager.safeAddColumn(sqlite, 'role_template_versions', "status TEXT DEFAULT 'PUBLISHED' NOT NULL");

          // 3. Add columns to company_users
          MigrationManager.safeAddColumn(sqlite, 'company_users', "membership_status TEXT DEFAULT 'ACTIVE' NOT NULL");
          MigrationManager.safeAddColumn(sqlite, 'company_users', "removed_at INTEGER");
          MigrationManager.safeAddColumn(sqlite, 'company_users', "removed_by TEXT");
          MigrationManager.safeAddColumn(sqlite, 'company_users', "removal_reason TEXT");

          // 4. Ensure company_user_roles and user_permission_overrides exist and add columns
          sqlite.exec(`
            CREATE TABLE IF NOT EXISTS company_user_roles (
              id text PRIMARY KEY,
              company_user_id text NOT NULL REFERENCES company_users(id),
              role_id text NOT NULL REFERENCES roles(id),
              created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              UNIQUE(company_user_id, role_id)
            );
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
          MigrationManager.safeAddColumn(sqlite, 'company_user_roles', "role_code TEXT");
          MigrationManager.safeAddColumn(sqlite, 'company_user_roles', "role_template_version INTEGER DEFAULT 1");
          MigrationManager.safeAddColumn(sqlite, 'company_user_roles', "is_primary INTEGER DEFAULT 0 NOT NULL");
          MigrationManager.safeAddColumn(sqlite, 'company_user_roles', "assignment_status TEXT DEFAULT 'ACTIVE' NOT NULL");
          MigrationManager.safeAddColumn(sqlite, 'company_user_roles', "assigned_by TEXT");
          MigrationManager.safeAddColumn(sqlite, 'company_user_roles', "assigned_at INTEGER DEFAULT 0");
          MigrationManager.safeAddColumn(sqlite, 'company_user_roles', "effective_from TEXT");
          MigrationManager.safeAddColumn(sqlite, 'company_user_roles', "effective_to TEXT");
          MigrationManager.safeAddColumn(sqlite, 'company_user_roles', "assignment_reason TEXT");

          // 5. Seed standard role compatibility rules
          const standardCompatRules = [
            { a: 'Bookkeeper', b: 'Approver', type: 'PROHIBITED', reason: 'Segregation of Duties: Transaction creator cannot approve financial transactions' },
            { a: 'Approver', b: 'Bookkeeper', type: 'PROHIBITED', reason: 'Segregation of Duties: Transaction approver cannot prepare or encode book entries' },
            { a: 'Auditor', b: 'Bookkeeper', type: 'PROHIBITED', reason: 'Segregation of Duties: Independent auditor cannot record transactions' },
            { a: 'Bookkeeper', b: 'Auditor', type: 'PROHIBITED', reason: 'Segregation of Duties: Bookkeeper cannot conduct independent audits' },
            { a: 'Accountant', b: 'Auditor', type: 'PROHIBITED', reason: 'Segregation of Duties: General ledger accountant cannot audit own accounts' },
            { a: 'Auditor', b: 'Accountant', type: 'PROHIBITED', reason: 'Segregation of Duties: Independent auditor cannot prepare ledger entries' },
            { a: 'Accountant', b: 'Reviewer', type: 'RESTRICTED', reason: 'Allowed across distinct records; Segregation of Duties prohibits self-review of prepared journals' },
            { a: 'Reviewer', b: 'Accountant', type: 'RESTRICTED', reason: 'Allowed across distinct records; Segregation of Duties prohibits self-review of prepared journals' },
            { a: 'Company Administrator', b: 'Accountant', type: 'RESTRICTED', reason: 'Administrative governance combined with ledger posting authority requires dual authorization' },
            { a: 'Accountant', b: 'Company Administrator', type: 'RESTRICTED', reason: 'Administrative governance combined with ledger posting authority requires dual authorization' },
            { a: 'Bookkeeper', b: 'Inventory Manager', type: 'ALLOWED', reason: 'Compatible operational recording roles' },
            { a: 'Approver', b: 'Department Administrator', type: 'ALLOWED', reason: 'Operational approval within department scope' }
          ];

          for (const rule of standardCompatRules) {
            try {
              sqlite.prepare(`
                INSERT INTO role_compatibility_rules (id, role_a, role_b, compatibility_type, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(role_a, role_b) DO UPDATE SET
                  compatibility_type = excluded.compatibility_type,
                  reason = excluded.reason
              `).run(
                crypto.randomUUID(),
                rule.a,
                rule.b,
                rule.type,
                rule.reason,
                Date.now()
              );
            } catch (_) {}
          }

          // 6. Backfill existing company_user_roles from company_users.roleId / legacyRole
          try {
            const memberships = sqlite.prepare(`
              SELECT cu.id, cu.role_id, cu.legacy_role, r.code as role_code, r.name as role_name
              FROM company_users cu
              LEFT JOIN roles r ON cu.role_id = r.id
            `).all() as any[];

            for (const m of memberships) {
              const roleId = m.role_id;
              if (!roleId) continue;
              const roleCode = m.role_code || (m.role_name ? m.role_name.toUpperCase().replace(/[^A-Z0-9]/g, '_') : 'ACCOUNTANT');

              // Ensure primary role record exists
              const existingPrimary = sqlite.prepare(`
                SELECT id FROM company_user_roles WHERE company_user_id = ? AND role_id = ?
              `).get(m.id, roleId) as any;

              if (existingPrimary) {
                sqlite.prepare(`
                  UPDATE company_user_roles
                  SET is_primary = 1, assignment_status = 'ACTIVE', role_code = COALESCE(role_code, ?)
                  WHERE id = ?
                `).run(roleCode, existingPrimary.id);
              } else {
                sqlite.prepare(`
                  INSERT INTO company_user_roles (
                    id, company_user_id, role_id, role_code, role_template_version, is_primary, assignment_status, assigned_at, assignment_reason
                  ) VALUES (?, ?, ?, ?, 1, 1, 'ACTIVE', ?, 'Migrated primary role from company membership')
                `).run(
                  crypto.randomUUID(),
                  m.id,
                  roleId,
                  roleCode,
                  Date.now()
                );
              }
            }
          } catch (_) {}
        }
      },
      {
        version: 14,
        name: '0014_optimistic_concurrency_versions',
        up: (sqlite: any) => {
          this.safeAddColumn(sqlite, 'payroll_runs', "updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)");
          const tables = [
            'companies',
            'journal_entries',
            'sales_invoices',
            'purchase_bills',
            'payroll_runs',
            'supplier_payments',
            'customer_payments',
            'inventory_items',
            'documents',
            'bank_reconciliations',
            'customers',
            'vendors',
            'accounts',
            'accounting_periods',
            'credit_memos',
            'debit_memos',
            'fixed_assets',
            'purchase_orders',
            'cash_advances',
            'cash_transactions',
            'stock_adjustments',
            'goods_receipt_notes',
            'departments',
            'projects',
            'cost_centers',
            'budgets',
            'employees'
          ];
          for (const tbl of tables) {
            this.safeAddColumn(sqlite, tbl, 'version INTEGER DEFAULT 1 NOT NULL');
          }
        }
      },
      {
        version: 15,
        name: '0015_reversal_child_unique_invariant',
        up: (sqlite: any) => {
          sqlite.exec(`
            CREATE UNIQUE INDEX IF NOT EXISTS unq_reversal_child_per_original
            ON journal_entries(company_id, original_journal_id)
            WHERE original_journal_id IS NOT NULL AND status = 'POSTED';
          `);
        }
      },
      {
        version: 16,
        name: '0016_document_ocr_history_and_phase2_alignment',
        up: (sqlite: any) => {
          this.safeAddColumn(sqlite, 'document_ocr_history', "action_type TEXT DEFAULT 'OCR_PERFORMED'");
          this.safeAddColumn(sqlite, 'document_ocr_history', "engine_used TEXT DEFAULT 'TESSERACT_WASM_OFFLINE'");
          this.safeAddColumn(sqlite, 'document_ocr_history', 'confidence_score REAL');
          this.safeAddColumn(sqlite, 'document_ocr_history', 'before_ocr_data TEXT');
          this.safeAddColumn(sqlite, 'document_ocr_history', 'after_ocr_data TEXT');
          this.safeAddColumn(sqlite, 'document_ocr_history', 'corrected_fields TEXT');
          this.safeAddColumn(sqlite, 'document_ocr_history', 'reason TEXT');
          this.safeAddColumn(sqlite, 'document_ocr_history', 'performed_by TEXT');
          this.safeAddColumn(sqlite, 'document_ocr_history', 'performed_by_name TEXT');
          this.safeAddColumn(sqlite, 'document_ocr_history', 'performed_by_role TEXT');
          this.safeAddColumn(sqlite, 'document_ocr_history', 'performed_at INTEGER');

          this.safeAddColumn(sqlite, 'documents', 'linked_transaction_type TEXT');
          this.safeAddColumn(sqlite, 'documents', 'linked_transaction_id TEXT');

          this.safeAddColumn(sqlite, 'document_versions', 'uploaded_by_name TEXT');
          this.safeAddColumn(sqlite, 'document_versions', 'uploaded_by_role TEXT');
        }
      },
      {
        version: 17,
        name: '0017_forward_timestamp_seconds_triggers',
        up: (sqlite: any) => {
          // Safe forward migration: Installs SQLite BEFORE INSERT triggers to guarantee that future
          // row inserts on accounting_periods and period_status_history store canonical Unix epoch seconds
          // even if an insertion statement omits createdAt/updatedAt or uses legacy defaults.
          // Historical records remain completely unmodified and preserved.
          sqlite.exec(`
            CREATE TRIGGER IF NOT EXISTS trg_accounting_periods_insert_timestamp
            AFTER INSERT ON accounting_periods
            WHEN new.created_at >= 100000000000
            BEGIN
              UPDATE accounting_periods
              SET created_at = CAST(ROUND(new.created_at / 1000.0) AS INTEGER),
                  updated_at = CAST(ROUND(COALESCE(new.updated_at, new.created_at) / 1000.0) AS INTEGER)
              WHERE id = new.id;
            END;

            CREATE TRIGGER IF NOT EXISTS trg_period_status_history_insert_timestamp
            AFTER INSERT ON period_status_history
            WHEN new.created_at >= 100000000000
            BEGIN
              UPDATE period_status_history
              SET created_at = CAST(ROUND(new.created_at / 1000.0) AS INTEGER)
              WHERE id = new.id;
            END;
          `);
        }
      },
      {
        version: 18,
        name: '0018_enterprise_ai_and_crypto_integrity',
        up: (sqlite: any) => {
          this.safeAddColumn(sqlite, 'company_ai_settings', 'providers_config_json TEXT');
          this.safeAddColumn(sqlite, 'company_ai_settings', "execution_mode_override TEXT DEFAULT 'AUTO'");

          sqlite.exec(`
            CREATE TABLE IF NOT EXISTS integrity_scan_reports (
              id TEXT PRIMARY KEY,
              company_id TEXT NOT NULL,
              database_identity TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'COMPLETED',
              execution_mode TEXT NOT NULL DEFAULT 'OFFLINE_LOCAL',
              engine_version TEXT NOT NULL DEFAULT 'LEDGERAI-CRYPTO-INTEGRITY-v2.5',
              scan_scope TEXT NOT NULL DEFAULT 'FULL_COMPANY_LEDGER_3_DOMAIN',
              started_at INTEGER NOT NULL,
              completed_at INTEGER,
              duration_ms INTEGER NOT NULL DEFAULT 0,
              records_inspected_json TEXT NOT NULL,
              domain_results_json TEXT NOT NULL,
              passed_checks INTEGER NOT NULL DEFAULT 0,
              failed_checks INTEGER NOT NULL DEFAULT 0,
              warning_count INTEGER NOT NULL DEFAULT 0,
              critical_count INTEGER NOT NULL DEFAULT 0,
              high_count INTEGER NOT NULL DEFAULT 0,
              medium_count INTEGER NOT NULL DEFAULT 0,
              low_count INTEGER NOT NULL DEFAULT 0,
              info_count INTEGER NOT NULL DEFAULT 0,
              findings_count INTEGER NOT NULL DEFAULT 0,
              previous_scan_id TEXT,
              previous_report_hash TEXT,
              report_hash TEXT NOT NULL,
              triggered_by TEXT,
              triggered_by_name TEXT,
              triggered_by_role TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_integrity_scan_reports_company
              ON integrity_scan_reports(company_id, started_at DESC);

            CREATE TABLE IF NOT EXISTS integrity_scan_findings (
              id TEXT PRIMARY KEY,
              scan_id TEXT NOT NULL,
              company_id TEXT NOT NULL,
              domain TEXT NOT NULL,
              check_code TEXT NOT NULL,
              check_name TEXT NOT NULL,
              severity TEXT NOT NULL,
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              record_reference TEXT,
              title TEXT NOT NULL,
              description TEXT NOT NULL,
              discrepancy_amount_centavos INTEGER NOT NULL DEFAULT 0,
              remediation_action TEXT NOT NULL,
              remediation_module_path TEXT,
              evidence_json TEXT,
              created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_integrity_scan_findings_scan
              ON integrity_scan_findings(scan_id, severity);
          `);
        }
      },
      {
        version: 19,
        name: '0019_journal_source_idempotency_index',
        up: (sqlite: any) => {
          sqlite.exec(`
            CREATE INDEX IF NOT EXISTS idx_journal_source_lookup
              ON journal_entries(company_id, source_type, source_id);
          `);
          const dupRow = sqlite.prepare(`
            SELECT COUNT(*) AS dup_count FROM (
              SELECT 1 FROM journal_entries
              WHERE source_type IS NOT NULL
                AND source_id IS NOT NULL
                AND UPPER(source_type) != 'BANK_RECONCILIATION'
                AND status IN ('POSTED', 'REVERSED', 'APPROVED', 'SUBMITTED')
              GROUP BY company_id, source_type, source_id
              HAVING COUNT(*) > 1
            )
          `).get() as { dup_count: number } | undefined;

          if (!dupRow || Number(dupRow.dup_count) === 0) {
            sqlite.exec(`
              CREATE UNIQUE INDEX IF NOT EXISTS unq_journal_active_source
              ON journal_entries(company_id, source_type, source_id)
              WHERE source_type IS NOT NULL
                AND source_id IS NOT NULL
                AND UPPER(source_type) != 'BANK_RECONCILIATION'
                AND status IN ('POSTED', 'REVERSED', 'APPROVED', 'SUBMITTED');
            `);
          }
        }
      },
      {
        version: 20,
        name: '0020_fx_revaluation_runs',
        up: (sqlite: any) => {
          this.safeAddColumn(sqlite, 'accounts', "currency TEXT DEFAULT 'PHP' NOT NULL");

          sqlite.exec(`
            CREATE TABLE IF NOT EXISTS fx_revaluation_runs (
              id TEXT PRIMARY KEY NOT NULL,
              company_id TEXT NOT NULL REFERENCES companies(id),
              accounting_period_id TEXT REFERENCES accounting_periods(id),
              revaluation_date TEXT NOT NULL,
              base_currency TEXT NOT NULL DEFAULT 'PHP',
              target_currency TEXT NOT NULL,
              closing_spot_rate REAL NOT NULL,
              rate_date TEXT NOT NULL,
              rate_source TEXT NOT NULL DEFAULT 'BSP',
              status TEXT NOT NULL DEFAULT 'PREVIEW',
              total_carrying_php_centavos INTEGER NOT NULL DEFAULT 0,
              total_revalued_php_centavos INTEGER NOT NULL DEFAULT 0,
              total_gain_centavos INTEGER NOT NULL DEFAULT 0,
              total_loss_centavos INTEGER NOT NULL DEFAULT 0,
              net_gain_loss_centavos INTEGER NOT NULL DEFAULT 0,
              unrealized_journal_id TEXT REFERENCES journal_entries(id),
              reversal_journal_id TEXT REFERENCES journal_entries(id),
              auto_reverse_date TEXT,
              details_json TEXT NOT NULL,
              notes TEXT,
              created_by TEXT REFERENCES users(id),
              posted_by TEXT REFERENCES users(id),
              posted_at INTEGER,
              created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );

            CREATE INDEX IF NOT EXISTS idx_fx_reval_runs_company_period
              ON fx_revaluation_runs(company_id, accounting_period_id, target_currency);

            CREATE INDEX IF NOT EXISTS idx_fx_rates_lookup
              ON currency_exchange_rates(company_id, currency, rate_date DESC);
          `);
        }
      },
      {
        version: 21,
        name: '0021_approval_concurrency_and_idempotency',
        up: (sqlite: any) => {
          sqlite.exec(`
            CREATE TABLE IF NOT EXISTS approval_workflows (
              id text PRIMARY KEY NOT NULL,
              company_id text NOT NULL REFERENCES companies(id),
              entity_type text NOT NULL,
              entity_id text NOT NULL,
              record_reference text,
              requester_id text REFERENCES users(id),
              requester_name text,
              department_id text,
              branch_code text DEFAULT 'HQ-MNL',
              amount_centavos integer DEFAULT 0 NOT NULL,
              currency text DEFAULT 'PHP' NOT NULL,
              current_step integer DEFAULT 1 NOT NULL,
              total_steps integer DEFAULT 1 NOT NULL,
              status text DEFAULT 'PENDING' NOT NULL,
              why_approval_needed text,
              policy_rule_code text,
              sla_due_at integer,
              escalated_at integer,
              approved_by text REFERENCES users(id),
              approved_at integer,
              rejected_by text REFERENCES users(id),
              rejected_at integer,
              returned_by text REFERENCES users(id),
              returned_at integer,
              cancelled_by text REFERENCES users(id),
              cancelled_at integer,
              remarks text,
              version integer DEFAULT 1 NOT NULL,
              created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
              updated_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );
            CREATE TABLE IF NOT EXISTS approval_steps (
              id text PRIMARY KEY NOT NULL,
              workflow_id text NOT NULL REFERENCES approval_workflows(id),
              company_id text NOT NULL REFERENCES companies(id),
              step_number integer NOT NULL,
              step_name text NOT NULL,
              approval_mode text DEFAULT 'SEQUENTIAL' NOT NULL,
              required_role text NOT NULL,
              assigned_approver_id text REFERENCES users(id),
              assigned_approver_name text,
              delegated_to_id text REFERENCES users(id),
              delegated_to_name text,
              delegated_at integer,
              delegation_reason text,
              min_amount_centavos integer DEFAULT 0 NOT NULL,
              max_amount_centavos integer,
              required_approvals_count integer DEFAULT 1 NOT NULL,
              current_approvals_count integer DEFAULT 0 NOT NULL,
              status text DEFAULT 'PENDING' NOT NULL,
              acted_by_id text REFERENCES users(id),
              acted_by_name text,
              acted_by_role text,
              acted_at integer,
              decision text,
              comments text,
              sla_hours integer DEFAULT 24 NOT NULL,
              due_at integer,
              version integer DEFAULT 1 NOT NULL,
              created_at integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );
          `);
          this.safeAddColumn(sqlite, 'approval_workflows', 'version integer DEFAULT 1 NOT NULL');
          this.safeAddColumn(sqlite, 'approval_steps', 'version integer DEFAULT 1 NOT NULL');
          sqlite.exec(`
            CREATE TABLE IF NOT EXISTS approval_idempotency_keys (
              id TEXT PRIMARY KEY,
              company_id TEXT NOT NULL REFERENCES companies(id),
              workflow_id TEXT NOT NULL REFERENCES approval_workflows(id),
              action TEXT NOT NULL,
              idempotency_key TEXT NOT NULL,
              actor_id TEXT NOT NULL,
              request_hash TEXT NOT NULL,
              status_code INTEGER NOT NULL,
              response_json TEXT NOT NULL,
              created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_idemp_unique
              ON approval_idempotency_keys(company_id, workflow_id, action, idempotency_key);
          `);
        }
      },
      {
        version: 22,
        name: 'v22_dual_file_licensing_and_redemption',
        up: (sqlite) => {
          this.safeAddColumn(sqlite, 'company_licenses', 'license_pair_id text');
          this.safeAddColumn(sqlite, 'company_licenses', 'key_file_id text');
          this.safeAddColumn(sqlite, 'company_licenses', 'activation_record_id text');
          this.safeAddColumn(sqlite, 'company_licenses', 'activation_timestamp text');
          this.safeAddColumn(sqlite, 'company_licenses', 'activated_by text');
          this.safeAddColumn(sqlite, 'company_licenses', 'key_file_content text');
          this.safeAddColumn(sqlite, 'company_licenses', 'activation_receipt text');
          this.safeAddColumn(sqlite, 'company_licenses', 'revocation_ref text');
          this.safeAddColumn(sqlite, 'company_licenses', "license_version text DEFAULT '2.0'");
          this.safeAddColumn(sqlite, 'company_licenses', "activation_policy text DEFAULT 'ONE_TIME_COMPANY_BOUND'");
          this.safeAddColumn(sqlite, 'company_licenses', 'recovery_reference text');
          this.safeAddColumn(sqlite, 'company_licenses', 'recovery_reason text');

          sqlite.exec(`
            CREATE TABLE IF NOT EXISTS license_redemption_records (
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
            );
            CREATE INDEX IF NOT EXISTS idx_lic_redemption_pair ON license_redemption_records(license_pair_id);
            CREATE INDEX IF NOT EXISTS idx_lic_redemption_comp ON license_redemption_records(company_id);
          `);
        }
      }
    ];
  }

  private static safeAddColumn(sqlite: any, tableName: string, columnDef: string) {
    try {
      const colName = columnDef.trim().split(/\s+/)[0];
      const tableInfo = sqlite.pragma(`table_info('${tableName}')`) as any[];
      if (!Array.isArray(tableInfo) || tableInfo.length === 0) {
        return;
      }
      if (tableInfo.some(c => c.name === colName)) {
        return; // Column already exists, safe idempotent no-op
      }
      sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef};`);
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('duplicate column name') || msg.includes('already exists')) {
        return; // Safely recoverable duplicate condition
      }
      throw err; // Strict: rethrow unexpected errors
    }
  }

  static readonly LATEST_VERSION = 22;

  static getCurrentVersion(sqlite: any): number {
    const history = this.getMigrationHistory(sqlite);
    return history
      .filter(h => h.status === 'SUCCESS')
      .reduce((max, h) => Math.max(max, h.version), 0);
  }

  static applyAllMigrations(
    sqlite: any,
    companyId: string,
    extraMigrations: MigrationDefinition[] = []
  ): { appliedCount: number; appliedVersions: number[]; currentVersion: number; history: MigrationRecord[] } {
    this.ensureMigrationsTable(sqlite);
    const existingHistory = this.getMigrationHistory(sqlite);
    const appliedVersionsSet = new Set(existingHistory.filter(h => h.status === 'SUCCESS').map(h => h.version));

    const migrations = [...this.getMigrations(), ...extraMigrations].sort((a, b) => a.version - b.version);
    let appliedCount = 0;
    const newlyAppliedVersions: number[] = [];

    for (const mig of migrations) {
      if (appliedVersionsSet.has(mig.version)) {
        continue;
      }

      const startTime = Date.now();
      const checksum = crypto.createHash('sha256').update(`${mig.version}:${mig.name}`).digest('hex');

      try {
        sqlite.transaction(() => {
          mig.up(sqlite);
          sqlite.prepare(`
            INSERT INTO schema_migrations_history (
              id, version, name, applied_at, checksum, execution_time_ms, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
              status = excluded.status,
              applied_at = excluded.applied_at,
              execution_time_ms = excluded.execution_time_ms
          `).run(
            crypto.randomUUID(),
            mig.version,
            mig.name,
            Date.now(),
            checksum,
            Date.now() - startTime,
            'SUCCESS'
          );
        })();
        appliedCount++;
        newlyAppliedVersions.push(mig.version);
      } catch (migErr: any) {
        const errorMsg = String(migErr?.message || migErr);
        try {
          sqlite.prepare(`
            INSERT INTO schema_migrations_history (
              id, version, name, applied_at, checksum, execution_time_ms, status, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
              status = excluded.status,
              applied_at = excluded.applied_at,
              error_message = excluded.error_message
          `).run(
            crypto.randomUUID(),
            mig.version,
            mig.name,
            Date.now(),
            checksum,
            Date.now() - startTime,
            'FAILED',
            errorMsg
          );
        } catch (_) {}

        throw new Error(`MIGRATION_FAILED_ROLLED_BACK: Migration ${mig.name} (v${mig.version}) failed for company ${companyId}: ${errorMsg}`);
      }
    }

    const updatedHistory = this.getMigrationHistory(sqlite);
    const currentVersion = updatedHistory
      .filter(h => h.status === 'SUCCESS')
      .reduce((max, h) => Math.max(max, h.version), 0);

    return {
      appliedCount,
      appliedVersions: newlyAppliedVersions,
      currentVersion,
      history: updatedHistory
    };
  }

  static validateSchemaIntegrity(sqlite: any): { valid: boolean; foreignKeyIssues: any[]; tableCount: number; indexCount: number } {
    try {
      const fkCheck = sqlite.pragma('foreign_key_check') as any[];
      const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[];
      const indexes = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all() as any[];

      return {
        valid: fkCheck.length === 0,
        foreignKeyIssues: fkCheck,
        tableCount: tables.length,
        indexCount: indexes.length
      };
    } catch (err: any) {
      return {
        valid: false,
        foreignKeyIssues: [{ error: err?.message }],
        tableCount: 0,
        indexCount: 0
      };
    }
  }
}
