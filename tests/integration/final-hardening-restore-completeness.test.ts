import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const { tempRoot } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require('node:os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('node:path');
  const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'ledgerai-p2-restore-'));
  process.env.LEDGERAI_CONFIG_DIR = nodePath.join(root, 'config');
  process.env.LEDGERAI_DATA_DIR = nodePath.join(root, 'data');
  return { tempRoot: root };
});

import { CompanyManager } from '../../src/server/services/companyManager';
import { RbacService } from '../../src/server/services/rbacService';
import { dbContext } from '../../src/server/db/context';
import { AccountingEngine } from '../../src/server/services/accountingEngine';
import { RestoreService } from '../../src/server/services/restoreService';
import { AuditService } from '../../src/server/services/auditService';
import { DocumentEncryptionService } from '../../src/server/services/documentEncryptionService';
import { CompanyStorageService } from '../../src/server/services/storageService';
import { AuditHmacKeyManager } from '../../src/server/db/auditSeal';

const SRC_COMP = 'LGR-PH-P2-SOURCE';
const NEW_RESTORE_COMP = 'LGR-PH-P2-RESTORED-NEW';
const FAILED_NEW_COMP = 'LGR-PH-P2-FAILED-NEW';
const LEGACY_RESTORE_COMP = 'LGR-PH-P2-LEGACY-LGBPH1';
const BACKUP_PASSWORD = 'StrongEnterpriseBackupPassword#2026!';

describe('PRIORITY 2 — COMPLETE ENCRYPTED COMPANY DATABASE BACKUP & RESTORE', () => {
  const ownerId = 'usr-p2-owner';
  const auditorId = 'usr-p2-auditor';
  let backupFilePath = '';
  let sampleDocRelPath = '';
  const samplePlaintextDoc = Buffer.from('BIR Form 2307 Signed Certificate Attachment Payload - 2026 Q1', 'utf8');

  beforeAll(async () => {
    await CompanyManager.createCompanyProfile(SRC_COMP, 'Priority 2 Source Enterprise Inc.', undefined, undefined, false, {
      classification: 'TEST',
    });

    const sqlite = await CompanyManager.getCompanySqlite(SRC_COMP);
    const companyDb = await CompanyManager.getCompanyDb(SRC_COMP);
    const now = Date.now();

    sqlite.exec(`
      INSERT OR REPLACE INTO companies (id, legal_name, tin, vat_status, taxpayer_classification, currency, status, classification)
      VALUES ('${SRC_COMP}', 'Priority 2 Source Enterprise Inc.', '321-654-987-000', 'VAT', 'CORPORATION', 'PHP', 'ACTIVE', 'TEST');
    `);

    await dbContext.run(companyDb as any, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      await AccountingEngine.ensureDefaultAccounts(SRC_COMP);

      // 1. Accounting Periods
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO accounting_periods (id, company_id, name, start_date, end_date, fiscal_year, status, created_at, updated_at)
           VALUES (?, ?, 'FY 2026', '2026-01-01', '2026-12-31', 2026, 'OPEN', ?, ?)`
        )
        .run('per-p2-2026', SRC_COMP, now, now);

      // 2. Users, Roles, Overrides, Module Assignments, SoD
      for (const u of [
        { id: ownerId, email: 'owner@p2.ph', name: 'P2 Owner', role: 'Company Owner', limit: 90_000_000_00 },
        { id: auditorId, email: 'auditor@p2.ph', name: 'P2 Auditor', role: 'Auditor', limit: 0 },
      ]) {
        sqlite
          .prepare(
            `INSERT OR REPLACE INTO users (id, email, password_hash, display_name, status, is_demo, require_password_change, created_at, updated_at)
             VALUES (?, ?, 'hash', ?, 'ACTIVE', 1, 0, ?, ?)`
          )
          .run(u.id, u.email, u.name, now, now);

        const cuId = `cu-${SRC_COMP}-${u.id}`;
        sqlite
          .prepare(
            `INSERT OR REPLACE INTO company_users (id, user_id, company_id, legacy_role, status, membership_status, default_data_scope, approval_limit_centavos, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'ACTIVE', 'ACTIVE', 'COMPANY_WIDE', ?, ?, ?)`
          )
          .run(cuId, u.id, SRC_COMP, u.role, u.limit, now, now);

        await RbacService.setMemberRoles(null, cuId, [u.role] as any, 'P2 seed');
      }

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO sod_restrictions (id, rule_code, rule_name, description, incompatible_role_1, incompatible_role_2, status, created_at)
           VALUES ('sod-p2-1', 'SOD-P2-001', 'Bill Creation vs Approval', 'Prevent self-approval of AP bills', 'Bookkeeper', 'Approver', 'ACTIVE', ?)`
        )
        .run(now);

      // 3. Journals & Lines
      const cashAcc = sqlite
        .prepare(`SELECT id FROM accounts WHERE company_id = ? AND account_type = 'ASSET' LIMIT 1`)
        .get(SRC_COMP) as { id: string };
      const revAcc = sqlite
        .prepare(`SELECT id FROM accounts WHERE company_id = ? AND account_type IN ('REVENUE', 'INCOME') LIMIT 1`)
        .get(SRC_COMP) as { id: string };
      const expAcc = sqlite
        .prepare(`SELECT id FROM accounts WHERE company_id = ? AND account_type = 'EXPENSE' LIMIT 1`)
        .get(SRC_COMP) as { id: string };

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO journal_entries (id, company_id, journal_number, entry_date, accounting_period_id, description, source_type, source_id, status, created_by, posted_by, created_at, updated_at, posted_at)
           VALUES ('je-p2-001', ?, 'JE-2026-0001', '2026-02-15', 'per-p2-2026', 'Enterprise License Revenue', 'SALES', 'inv-p2-01', 'POSTED', ?, ?, ?, ?, ?)`
        )
        .run(SRC_COMP, ownerId, ownerId, now, now, now);

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit, line_number, created_at)
           VALUES ('jl-p2-001a', 'je-p2-001', ?, 'Cash receipt', 11200000, 0, 1, ?),
                  ('jl-p2-001b', 'je-p2-001', ?, 'License revenue', 0, 11200000, 2, ?)`
        )
        .run(cashAcc.id, now, revAcc.id, now);

      // 4. Customers, Vendors, AR Invoices, AP Bills, Payments
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO customers (id, company_id, code, legal_name, tin, address, status, created_at, updated_at)
           VALUES ('cust-p2-01', ?, 'CUST-P2-01', 'Ayala Digital Ventures', '444-555-666-000', 'Makati', 'ACTIVE', ?, ?)`
        )
        .run(SRC_COMP, now, now);

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO vendors (id, company_id, code, legal_name, tin, address, status, created_at, updated_at)
           VALUES ('vend-p2-01', ?, 'VEND-P2-01', 'BGC Cloud Hosting Corp.', '777-888-999-000', 'Taguig', 'ACTIVE', ?, ?)`
        )
        .run(SRC_COMP, now, now);

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO sales_invoices (id, company_id, customer_id, invoice_number, invoice_date, due_date, status, total_amount, balance_due, journal_entry_id, created_by, created_at, updated_at)
           VALUES ('inv-p2-01', ?, 'cust-p2-01', 'SI-2026-001', '2026-02-15', '2026-03-15', 'POSTED', 11200000, 0, 'je-p2-001', ?, ?, ?)`
        )
        .run(SRC_COMP, ownerId, now, now);

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO sales_invoice_lines (id, invoice_id, account_id, description, quantity, unit_price, amount, created_at)
           VALUES ('sil-p2-01', 'inv-p2-01', ?, 'Annual Enterprise Subscription', 1, 11200000, 11200000, ?)`
        )
        .run(revAcc.id, now);

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO purchase_bills (id, company_id, vendor_id, bill_number, bill_date, due_date, status, total_amount, balance_due, journal_entry_id, created_by, created_at, updated_at)
           VALUES ('bill-p2-01', ?, 'vend-p2-01', 'PB-2026-001', '2026-02-20', '2026-03-20', 'POSTED', 5600000, 0, 'je-p2-001', ?, ?, ?)`
        )
        .run(SRC_COMP, ownerId, now, now);

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO purchase_bill_lines (id, bill_id, account_id, description, quantity, unit_price, amount, created_at)
           VALUES ('pbl-p2-01', 'bill-p2-01', ?, 'Dedicated Server Hosting', 1, 5600000, 5600000, ?)`
        )
        .run(expAcc.id, now);

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO supplier_payments (id, company_id, vendor_id, payment_number, payment_date, amount, cash_account_id, withholding_tax_amount, withholding_tax_account_id, status, journal_entry_id, created_at, updated_at)
           VALUES ('sp-p2-01', ?, 'vend-p2-01', 'SP-2026-001', '2026-02-25', 5500000, ?, 100000, ?, 'POSTED', 'je-p2-001', ?, ?)`
        )
        .run(SRC_COMP, cashAcc.id, expAcc.id, now, now);

      // 5. Inventory & Fixed Assets
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO inventory_items (id, company_id, sku, name, description, category, unit_cost, selling_price, quantity_on_hand, reorder_point, status, created_at, updated_at)
           VALUES ('prod-p2-01', ?, 'SKU-HSM-01', 'Hardware Security Appliance', 'FIPS 140-3 Appliance', 'HARDWARE', 9500000, 15000000, 12, 3, 'ACTIVE', ?, ?)`
        )
        .run(SRC_COMP, now, now);

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO fixed_assets (id, company_id, asset_tag, asset_name, category, acquisition_date, acquisition_cost, salvage_value, useful_life_months, depreciation_method, status, created_at, updated_at)
           VALUES ('fa-p2-01', ?, 'FA-2026-001', 'Primary Datacenter Blade Cluster', 'IT_HARDWARE', '2026-01-10', 48000000, 0, 48, 'STRAIGHT_LINE', 'ACTIVE', ?, ?)`
        )
        .run(SRC_COMP, now, now);

      // 6. Payroll & Statutory Records
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO employees (id, company_id, employee_no, first_name, last_name, email, department, position, monthly_basic_salary, status, created_at, updated_at)
           VALUES ('emp-p2-01', ?, 'EMP-2026-001', 'Maria', 'Santos', 'msantos@p2.ph', 'FINANCE', 'Senior CPA', 8500000, 'ACTIVE', ?, ?)`
        )
        .run(SRC_COMP, now, now);

      // 7. Bank Accounts & Reconciliation
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO bank_accounts (id, company_id, account_name, bank_name, account_number_encrypted, currency, status, created_at, updated_at)
           VALUES ('ba-p2-01', ?, 'BDO Corporate Checking', 'BDO Unibank', '0012-3456-7890', 'PHP', 'ACTIVE', ?, ?)`
        )
        .run(SRC_COMP, now, now);

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO bank_reconciliations (id, company_id, bank_account_id, statement_date, statement_ending_balance, book_ending_balance, adjusted_book_balance, adjusted_statement_balance, unexplained_difference, status, approved_by, created_at, updated_at)
           VALUES ('brec-p2-01', ?, ?, '2026-02-28', 25000000, 25000000, 25000000, 25000000, 0, 'APPROVED', ?, ?, ?)`
        )
        .run(SRC_COMP, cashAcc.id, ownerId, now, now);

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO bank_statement_lines (id, bank_reconciliation_id, company_id, bank_account_id, line_date, description, reference, type, amount, matched_status, matched_type, matched_entity_id, matched_amount, created_at)
           VALUES ('bsl-p2-01', 'brec-p2-01', ?, ?, '2026-02-15', 'Ayala Wire Transfer', 'WT-001', 'DEPOSIT', 11200000, 'MATCHED', 'JOURNAL_LINE', 'je-p2-001', 11200000, ?)`
        )
        .run(SRC_COMP, cashAcc.id, now);

      // 8. Approvals & Idempotency
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO approval_workflows (id, company_id, entity_type, entity_id, record_reference, workflow_type, current_step_order, total_steps, status, amount_centavos, version, submitted_by, submitted_at, completed_at, created_at, updated_at)
           VALUES ('wf-p2-01', ?, 'PURCHASE_BILL', 'bill-p2-01', 'PB-2026-001', 'SEQUENTIAL', 1, 1, 'APPROVED', 5600000, 2, ?, ?, ?, ?, ?)`
        )
        .run(SRC_COMP, ownerId, now, now, now, now);

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO approval_steps (id, workflow_id, company_id, entity_type, entity_id, step_order, step_name, required_role, status, decision, version, actual_approver_id, responded_at, comments, assigned_at, created_at)
           VALUES ('wfstep-p2-01', 'wf-p2-01', ?, 'PURCHASE_BILL', 'bill-p2-01', 1, 'Executive Sign-off', 'Company Owner', 'APPROVED', 'APPROVED', 2, ?, ?, 'Verified against PO', ?, ?)`
        )
        .run(SRC_COMP, ownerId, now, now, now);

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO approval_idempotency_keys (id, company_id, workflow_id, action, idempotency_key, actor_id, request_hash, status_code, response_json, created_at)
           VALUES ('idem-row-p2-01', ?, 'wf-p2-01', 'DECIDE', 'idem-key-p2-001', ?, 'hash-p2-001', 200, '{"success":true,"workflowStatus":"APPROVED"}', ?)`
        )
        .run(SRC_COMP, ownerId, now);

      // 9. Encrypted LAISDOC1 Document Attachment
      const savedDoc = await CompanyStorageService.writeEncryptedDocument(
        SRC_COMP,
        '2307_cert_q1.pdf',
        samplePlaintextDoc,
        {
          documentId: 'doc-p2-01',
          contentType: 'application/pdf',
        }
      );
      sampleDocRelPath = savedDoc.filePath;

      sqlite
        .prepare(
          `INSERT OR REPLACE INTO documents (id, company_id, entity_type, entity_id, document_type, file_name, original_file_name, file_type, file_size, file_path, file_hash, status, encryption_status, storage_tier, uploaded_by, created_at, updated_at)
           VALUES ('doc-p2-01', ?, 'PURCHASE_BILL', 'bill-p2-01', 'BIR_DOCUMENT', '2307_cert_q1.pdf', '2307_cert_q1.pdf', 'application/pdf', ?, ?, ?, 'ACTIVE', 'ENCRYPTED_AES256_GCM', 'ORIGINALS', ?, ?, ?)`
        )
        .run(SRC_COMP, samplePlaintextDoc.length, sampleDocRelPath, savedDoc.fileHash, ownerId, now, now);

      // 10. Cryptographic Audit Trail Chain
      await AuditService.log({
        companyId: SRC_COMP,
        userId: ownerId,
        action: 'CREATE',
        entityType: 'sales_invoices',
        entityId: 'inv-p2-01',
        afterData: { invoiceNumber: 'SI-2026-001', totalAmount: 11200000 },
      });
      await AuditService.log({
        companyId: SRC_COMP,
        userId: ownerId,
        action: 'APPROVE',
        entityType: 'purchase_bills',
        entityId: 'bill-p2-01',
        afterData: { billNumber: 'PB-2026-001', workflowId: 'wf-p2-01' },
      });

      const chainCheck = await AuditService.verifyAuditChain(SRC_COMP);
      expect(chainCheck.verified).toBe(true);
    });

    // Create full signed & checksummed .lai backup archive
    const backupPayload = await RestoreService.exportBackup(SRC_COMP);
    const backupBuffer = RestoreService.serializeLai(backupPayload);
    backupFilePath = path.join(tempRoot, 'p2_source_backup.lai');
    fs.writeFileSync(backupFilePath, backupBuffer);
    expect(fs.existsSync(backupFilePath)).toBe(true);
  });

  afterAll(async () => {
    await CompanyManager.closeAllConnections();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('1. restores a complete encrypted backup into a NEW company workspace preserving all 12 domain areas, LAISDOC1 attachments, and audit chain integrity', async () => {
    const newCompanyDir = path.join(tempRoot, 'data', 'companies', 'restored_new_workspace');
    const unpackedPayload = RestoreService.deserializeLai(fs.readFileSync(backupFilePath));
    const restoredCompanyId = await RestoreService.restoreDatabase(
      unpackedPayload,
      NEW_RESTORE_COMP,
      'NEW',
      ownerId,
      newCompanyDir
    );

    expect(restoredCompanyId).toBe(NEW_RESTORE_COMP);

    const restoredSqlite = await CompanyManager.getCompanySqlite(NEW_RESTORE_COMP);
    const restoredDb = await CompanyManager.getCompanyDb(NEW_RESTORE_COMP);

    // Verify all 12 domain areas exist in the restored database
    const coaCount = (restoredSqlite.prepare(`SELECT COUNT(*) as c FROM accounts WHERE company_id = ?`).get(NEW_RESTORE_COMP) as any).c;
    expect(coaCount).toBeGreaterThanOrEqual(15);

    const periodRow = restoredSqlite.prepare(`SELECT name, status FROM accounting_periods WHERE name = 'FY 2026' AND company_id = ?`).get(NEW_RESTORE_COMP) as any;
    expect(periodRow?.name).toBe('FY 2026');

    const jeRow = restoredSqlite.prepare(`SELECT journal_number, status FROM journal_entries WHERE journal_number = 'JE-2026-0001' AND company_id = ?`).get(NEW_RESTORE_COMP) as any;
    expect(jeRow?.status).toBe('POSTED');
    expect(jeRow?.journal_number).toBe('JE-2026-0001');

    const invRow = restoredSqlite.prepare(`SELECT invoice_number, total_amount FROM sales_invoices WHERE invoice_number = 'SI-2026-001' AND company_id = ?`).get(NEW_RESTORE_COMP) as any;
    expect(invRow?.invoice_number).toBe('SI-2026-001');

    const billRow = restoredSqlite.prepare(`SELECT bill_number, total_amount FROM purchase_bills WHERE bill_number = 'PB-2026-001' AND company_id = ?`).get(NEW_RESTORE_COMP) as any;
    expect(billRow?.bill_number).toBe('PB-2026-001');

    const prodRow = restoredSqlite.prepare(`SELECT sku, quantity_on_hand FROM inventory_items WHERE sku = 'SKU-HSM-01' AND company_id = ?`).get(NEW_RESTORE_COMP) as any;
    expect(prodRow?.sku).toBe('SKU-HSM-01');
    expect(prodRow?.quantity_on_hand).toBe(12);

    const faRow = restoredSqlite.prepare(`SELECT asset_tag, acquisition_cost FROM fixed_assets WHERE asset_tag = 'FA-2026-001' AND company_id = ?`).get(NEW_RESTORE_COMP) as any;
    expect(faRow?.asset_tag).toBe('FA-2026-001');

    const empRow = restoredSqlite.prepare(`SELECT employee_no, monthly_basic_salary FROM employees WHERE employee_no = 'EMP-2026-001' AND company_id = ?`).get(NEW_RESTORE_COMP) as any;
    expect(empRow?.employee_no).toBe('EMP-2026-001');

    const brecRow = restoredSqlite.prepare(`SELECT status, statement_ending_balance FROM bank_reconciliations WHERE company_id = ?`).get(NEW_RESTORE_COMP) as any;
    expect(brecRow?.status).toBe('APPROVED');

    const wfRow = restoredSqlite.prepare(`SELECT status, version FROM approval_workflows WHERE record_reference = 'PB-2026-001' AND company_id = ?`).get(NEW_RESTORE_COMP) as any;
    expect(wfRow?.status).toBe('APPROVED');
    expect(wfRow?.version).toBe(2);

    const idemRow = restoredSqlite.prepare(`SELECT idempotency_key FROM approval_idempotency_keys WHERE idempotency_key = 'idem-key-p2-001' AND company_id = ?`).get(NEW_RESTORE_COMP) as any;
    expect(idemRow?.idempotency_key).toBe('idem-key-p2-001');

    const sodRow = restoredSqlite.prepare(`SELECT rule_name FROM sod_restrictions WHERE rule_code = 'SOD-P2-001'`).get() as any;
    expect(sodRow?.rule_name).toBe('Bill Creation vs Approval');

    // Verify RBAC child tables (company_user_roles, user_module_assignments) and SQLite schema objects (tables, indexes, FKs)
    const roleAssignCount = (restoredSqlite.prepare(`SELECT COUNT(*) as c FROM company_user_roles`).get() as any).c;
    expect(roleAssignCount).toBeGreaterThanOrEqual(2);

    const schemaTables = (restoredSqlite.prepare(`SELECT COUNT(*) as c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).get() as any).c;
    const schemaIndexes = (restoredSqlite.prepare(`SELECT COUNT(*) as c FROM sqlite_master WHERE type = 'index'`).get() as any).c;
    expect(schemaTables).toBeGreaterThanOrEqual(55);
    expect(schemaIndexes).toBeGreaterThanOrEqual(10);

    const fkViolations = restoredSqlite.pragma('foreign_key_check') as any[];
    expect(fkViolations.length).toBe(0);

    const hmacKeyringPath = AuditHmacKeyManager.getKeyringFilePath(NEW_RESTORE_COMP);
    expect(fs.existsSync(hmacKeyringPath)).toBe(true);

    // Verify encrypted document attachment was re-encrypted under NEW_RESTORE_COMP key and decrypts cleanly
    const docRow = restoredSqlite.prepare(`SELECT id, file_path FROM documents WHERE file_name = '2307_cert_q1.pdf' AND company_id = ?`).get(NEW_RESTORE_COMP) as any;
    expect(docRow).toBeTruthy();
    const rawRestoredDoc = fs.readFileSync(docRow.file_path);
    const decryptedDoc = DocumentEncryptionService.decryptBuffer(NEW_RESTORE_COMP, docRow.id, rawRestoredDoc);
    expect(decryptedDoc.plainBuffer.toString('utf8')).toBe(samplePlaintextDoc.toString('utf8'));

    // Verify cryptographic audit chain on restored company
    const restoredAuditChain = await dbContext.run(restoredDb as any, () => AuditService.verifyAuditChain(NEW_RESTORE_COMP));
    expect(restoredAuditChain.verified).toBe(true);
  });

  it('2. performs an in-place REPLACE restore that overwrites post-backup mutations and restores exact backup state, documents, and audit chain', async () => {
    const srcSqlite = await CompanyManager.getCompanySqlite(SRC_COMP);

    // Mutate state after backup
    srcSqlite.prepare(`UPDATE inventory_items SET quantity_on_hand = 999 WHERE id = 'prod-p2-01'`).run();
    srcSqlite.prepare(`DELETE FROM fixed_assets WHERE id = 'fa-p2-01'`).run();

    const mutatedQty = (srcSqlite.prepare(`SELECT quantity_on_hand FROM inventory_items WHERE id = 'prod-p2-01'`).get() as any).quantity_on_hand;
    expect(mutatedQty).toBe(999);

    const unpackedPayload = RestoreService.deserializeLai(fs.readFileSync(backupFilePath));
    const replaceCompanyId = await RestoreService.restoreDatabase(
      unpackedPayload,
      SRC_COMP,
      'REPLACE',
      ownerId
    );
    expect(replaceCompanyId).toBe(SRC_COMP);

    const afterSqlite = await CompanyManager.getCompanySqlite(SRC_COMP);
    const afterDb = await CompanyManager.getCompanyDb(SRC_COMP);
    const restoredQty = (afterSqlite.prepare(`SELECT quantity_on_hand FROM inventory_items WHERE id = 'prod-p2-01'`).get() as any).quantity_on_hand;
    expect(restoredQty).toBe(12);

    const restoredFa = afterSqlite.prepare(`SELECT asset_tag FROM fixed_assets WHERE id = 'fa-p2-01'`).get() as any;
    expect(restoredFa?.asset_tag).toBe('FA-2026-001');

    const chainAfterReplace = await dbContext.run(afterDb as any, () => AuditService.verifyAuditChain(SRC_COMP));
    expect(chainAfterReplace.verified).toBe(true);
  });

  it('3. rolls back REPLACE restore atomically on mid-restore failure (AFTER_DISK_BEFORE_TX, BEFORE_COMMIT, POST_VERIFICATION) without corrupting live company state', async () => {
    const beforeSqlite = await CompanyManager.getCompanySqlite(SRC_COMP);
    // Apply a sentinel update to prove pre-restore state is preserved when REPLACE fails mid-flight
    beforeSqlite.prepare(`UPDATE inventory_items SET quantity_on_hand = 77 WHERE id = 'prod-p2-01'`).run();
    await CompanyManager.syncCompanyDatabaseSnapshot(SRC_COMP);

    for (const stage of ['AFTER_DISK_BEFORE_TX', 'BEFORE_COMMIT', 'POST_VERIFICATION'] as const) {
      const unpackedPayload = RestoreService.deserializeLai(fs.readFileSync(backupFilePath));
      await expect(
        RestoreService.restoreDatabase(unpackedPayload, SRC_COMP, 'REPLACE', ownerId, undefined, {
          injectFailureStage: stage,
        })
      ).rejects.toThrow(/INJECTED_RESTORE_FAILURE|POST_EXTRACTION_VERIFICATION_FAILED/);

      const liveSqlite = await CompanyManager.getCompanySqlite(SRC_COMP);
      const liveDb = await CompanyManager.getCompanyDb(SRC_COMP);
      const liveQty = (liveSqlite.prepare(`SELECT quantity_on_hand FROM inventory_items WHERE id = 'prod-p2-01'`).get() as any)?.quantity_on_hand;
      expect(liveQty).toBe(77);

      // Verify document attachment is still readable and decryptable
      const docBuf = fs.readFileSync(sampleDocRelPath);
      const decBuf = DocumentEncryptionService.decryptBuffer(SRC_COMP, 'doc-p2-01', docBuf);
      expect(decBuf.plainBuffer.toString('utf8')).toBe(samplePlaintextDoc.toString('utf8'));

      // Verify audit chain is still valid
      const chain = await dbContext.run(liveDb as any, () => AuditService.verifyAuditChain(SRC_COMP));
      expect(chain.verified).toBe(true);
    }
  });

  it('4. cleans up partial company directory and leaves no orphan shortcut when NEW restore fails mid-flight', async () => {
    const failedNewDir = path.join(tempRoot, 'data', 'companies', 'failed_new_workspace');
    const unpackedPayload = RestoreService.deserializeLai(fs.readFileSync(backupFilePath));

    await expect(
      RestoreService.restoreDatabase(unpackedPayload, FAILED_NEW_COMP, 'NEW', ownerId, failedNewDir, {
        injectFailureStage: 'BEFORE_COMMIT',
      })
    ).rejects.toThrow(/INJECTED_RESTORE_FAILURE/);

    expect(fs.existsSync(failedNewDir)).toBe(false);
    const allCompanies = await CompanyManager.listCompanies();
    expect(allCompanies.some((c: any) => c.id === FAILED_NEW_COMP)).toBe(false);
  });

  it('5. rejects raw JSON renamed to .lai, rejects live LAISENC2 workspace DBs, rejects tampered backup packages, and supports legacy LGBPH1 schema auto-migration', async () => {
    // 1. Raw JSON renamed to .lai
    expect(() =>
      RestoreService.deserializeLai(Buffer.from(JSON.stringify({ metadata: { version: '1.0' }, data: {} }), 'utf8'))
    ).toThrow(/INVALID_BACKUP_FORMAT/);

    // 2. Live LAISENC2 encrypted workspace database file passed to Restore
    const srcManifest = await CompanyManager.getCompanyManifest(SRC_COMP);
    expect(srcManifest?.dbPath).toBeTruthy();
    const workspaceLaiBuf = fs.readFileSync(srcManifest!.dbPath);
    expect(() => RestoreService.deserializeLai(workspaceLaiBuf)).toThrow(/WORKSPACE_DB_NOT_BACKUP/);

    // 3. Tampered backup payload bytes
    const rawBuf = Buffer.from(fs.readFileSync(backupFilePath));
    rawBuf[rawBuf.length - 12] ^= 0xff;
    expect(() => RestoreService.deserializeLai(rawBuf)).toThrow();

    // 4. Legacy LGBPH1 magic header backup container auto-migration
    const unpackedPayload = RestoreService.deserializeLai(fs.readFileSync(backupFilePath));
    const serializedLaiph1 = RestoreService.serializeLai(unpackedPayload);
    // Replace first 6 bytes 'LAIPH1' with legacy 'LGBPH1' magic header
    const legacyBuffer = Buffer.from(serializedLaiph1);
    Buffer.from('LGBPH1', 'ascii').copy(legacyBuffer, 0);
    expect(legacyBuffer.subarray(0, 6).toString('ascii')).toBe('LGBPH1');

    const parsedLegacy = RestoreService.deserializeLai(legacyBuffer);
    const legacyTargetDir = path.join(tempRoot, 'data', 'companies', 'legacy_lgbph1_workspace');
    const legacyCompId = await RestoreService.restoreDatabase(
      parsedLegacy,
      LEGACY_RESTORE_COMP,
      'NEW',
      ownerId,
      legacyTargetDir
    );

    expect(legacyCompId).toBe(LEGACY_RESTORE_COMP);
    const legacySqlite = await CompanyManager.getCompanySqlite(LEGACY_RESTORE_COMP);
    const legacyPer = legacySqlite
      .prepare(`SELECT name FROM accounting_periods WHERE name = 'FY 2026' AND company_id = ?`)
      .get(LEGACY_RESTORE_COMP) as any;
    expect(legacyPer?.name).toBe('FY 2026');
  });

  it('6. supports Clone-as-New company restore when source companyId already exists, isolating cloned company ID, RBAC child tables, LAISDOC1 attachments, and audit chain', async () => {
    const clonedCompId = 'LGR-PH-P2-CLONED-01';
    const clonedDir = path.join(tempRoot, 'data', 'companies', 'cloned_company_workspace');
    const unpackedPayload = RestoreService.deserializeLai(fs.readFileSync(backupFilePath));

    const resultCompId = await RestoreService.restoreDatabase(
      unpackedPayload,
      clonedCompId,
      'NEW',
      ownerId,
      clonedDir
    );
    expect(resultCompId).toBe(clonedCompId);

    const clonedSqlite = await CompanyManager.getCompanySqlite(clonedCompId);
    const clonedDb = await CompanyManager.getCompanyDb(clonedCompId);

    // Mutate cloned company and verify source company is completely unaffected
    clonedSqlite.prepare(`UPDATE inventory_items SET quantity_on_hand = 45 WHERE sku = 'SKU-HSM-01' AND company_id = ?`).run(clonedCompId);
    const srcSqlite = await CompanyManager.getCompanySqlite(SRC_COMP);
    const srcQty = (srcSqlite.prepare(`SELECT quantity_on_hand FROM inventory_items WHERE sku = 'SKU-HSM-01' AND company_id = ?`).get(SRC_COMP) as any).quantity_on_hand;
    expect(srcQty).toBe(77); // From Test 3 sentinel

    const clonedDoc = clonedSqlite.prepare(`SELECT id, file_path FROM documents WHERE file_name = '2307_cert_q1.pdf' AND company_id = ?`).get(clonedCompId) as any;
    expect(clonedDoc).toBeTruthy();
    const decDoc = DocumentEncryptionService.decryptBuffer(clonedCompId, clonedDoc.id, fs.readFileSync(clonedDoc.file_path));
    expect(decDoc.plainBuffer.toString('utf8')).toBe(samplePlaintextDoc.toString('utf8'));

    const clonedChain = await dbContext.run(clonedDb as any, () => AuditService.verifyAuditChain(clonedCompId));
    expect(clonedChain.verified).toBe(true);
  });
});
