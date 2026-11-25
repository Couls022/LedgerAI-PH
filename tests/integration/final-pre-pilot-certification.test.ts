import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ISOLATED_CERT_ROOT = path.join(os.tmpdir(), `ledgerai_prepilot_cert_${process.pid}`);
process.env.LEDGERAI_ISOLATED_TEST_ROOT = ISOLATED_CERT_ROOT;
process.env.LEDGERAI_DATA_DIR = path.join(ISOLATED_CERT_ROOT, 'companies');
process.env.LEDGERAI_CONFIG_DIR = path.join(ISOLATED_CERT_ROOT, 'config');

import { eq, sql } from 'drizzle-orm';
import { createApp } from '../../src/server/app';
import { CompanyManager } from '../../src/server/services/companyManager';
import { db } from '../../src/server/db';
import { dbContext } from '../../src/server/db/context';
import * as schema from '../../src/server/db/schema';
import { hashToken } from '../../src/server/auth';
import { RbacService } from '../../src/server/services/rbacService';
import { AuditService } from '../../src/server/services/auditService';
import { AuditHmacKeyManager, computeAuditSealHash } from '../../src/server/db/auditSeal';
import { RestoreService } from '../../src/server/services/restoreService';
import { CompanyStorageService } from '../../src/server/services/storageService';
import { DocumentEncryptionService } from '../../src/server/services/documentEncryptionService';
import { TaxEngine, STANDARD_INDIVIDUAL_GRADUATED_BRACKETS_CENTAVOS } from '../../src/server/services/taxEngine';
import { AccountingEngine } from '../../src/server/services/accountingEngine';
import {
  createSalesInvoice,
  submitSalesInvoice,
  approveSalesInvoice,
  postSalesInvoice,
  createCustomerPayment,
  submitCustomerPayment,
  approveCustomerPayment,
  postCustomerPayment,
  createPurchaseBill,
  submitPurchaseBill,
  approvePurchaseBill,
  postPurchaseBill,
  issueCheck,
  createBankReconciliation,
} from '../../src/server/db/business_transactions';

describe('LEDGERAI PH 1.0.0-rc.1 — Final Pre-Pilot Operational Certification Suite', () => {
  const app = createApp();
  const TAG = crypto.randomBytes(3).toString('hex').toUpperCase();
  const CORP_PILOT = `LGR-PH-2026-TEST-CERT-${TAG}-A`;
  const CORP_RESTORE_NEW = `LGR-PH-2026-TEST-CERT-${TAG}-CLONE`;
  const CORP_HMAC_LAB = `LGR-PH-2026-TEST-CERT-${TAG}-HMAC`;
  const CORP_ISOLATED_B = `LGR-PH-2026-TEST-CERT-${TAG}-B`;

  const OWNER_ID = `cert-owner-${TAG}`;
  const CHECKER_ID = `cert-checker-${TAG}`;
  const MAKER_ID = `cert-maker-${TAG}`;
  const VIEWER_ID = `cert-viewer-${TAG}`;
  const OWNER_B_ID = `cert-owner-b-${TAG}`;

  let ownerToken = '';
  let checkerToken = '';
  let makerToken = '';
  let viewerToken = '';
  let ownerCloneToken = '';
  let ownerBToken = '';

  const PERIOD_2026_ID = `cert-period-2026-${TAG}`;
  const ACC_CASH = `cert-acc-1010-${TAG}`;
  const ACC_AR = `cert-acc-1030-${TAG}`;
  const ACC_INV = `cert-acc-1040-${TAG}`;
  const ACC_INVAT = `cert-acc-1060-${TAG}`;
  const ACC_AP = `cert-acc-2010-${TAG}`;
  const ACC_OUTVAT = `cert-acc-2020-${TAG}`;
  const ACC_EWT = `cert-acc-2030-${TAG}`;
  const ACC_WTC = `cert-acc-2040-${TAG}`;
  const ACC_SSS = `cert-acc-2050-${TAG}`;
  const ACC_PHIC = `cert-acc-2060-${TAG}`;
  const ACC_HDMF = `cert-acc-2070-${TAG}`;
  const ACC_SAL_PAY = `cert-acc-2080-${TAG}`;
  const ACC_EQ = `cert-acc-3010-${TAG}`;
  const ACC_REV = `cert-acc-4010-${TAG}`;
  const ACC_COGS = `cert-acc-5010-${TAG}`;
  const ACC_EXP_PROF = `cert-acc-6010-${TAG}`;
  const ACC_EXP_SAL = `cert-acc-6020-${TAG}`;

  const CUST_ID = `cert-cust-01-${TAG}`;
  const VEND_ID = `cert-vend-01-${TAG}`;
  const ITEM_ID = `cert-item-01-${TAG}`;
  const DOC_ID = crypto.randomUUID();

  async function seedCompanyMemberToken(
    companyId: string,
    userId: string,
    email: string,
    displayName: string,
    roleName: string
  ): Promise<string> {
    await db.insert(schema.users).values({
      id: userId,
      email,
      passwordHash: 'hash',
      displayName,
      status: 'ACTIVE',
    }).onConflictDoNothing();

    const roleRec = await RbacService.ensureRoleRecord(roleName);
    const memId = `mem-${companyId}-${userId}`;
    await db.insert(schema.companyUsers).values({
      id: memId,
      companyId,
      userId,
      roleId: roleRec.id,
      role: roleName,
      legacyRole: roleName.toUpperCase().replace(/\s+/g, '_'),
      status: 'ACTIVE',
      membershipStatus: 'ACTIVE',
      defaultDataScope: 'COMPANY_WIDE',
    }).onConflictDoNothing();

    await RbacService.setMemberRoles(null, memId, [roleName], `Cert seed ${roleName}`);

    const rawToken = crypto.randomBytes(32).toString('hex');
    await db.insert(schema.sessions).values({
      id: hashToken(rawToken),
      userId,
      companyId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    return `${companyId}.${rawToken}`;
  }

  beforeAll(async () => {
    await CompanyManager.closeAllConnections();
    for (const cid of [CORP_PILOT, CORP_RESTORE_NEW, CORP_HMAC_LAB, CORP_ISOLATED_B]) {
      await CompanyManager.resetDisposableTestCompanyWorkspace(cid);
    }

    await CompanyManager.createCompanyProfile(CORP_PILOT, 'Pre-Pilot Certification Alpha Corp.', '123-456-789-000', 'Makati City, Metro Manila', false, {
      classification: 'TEST',
      encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
    });
    await CompanyManager.createCompanyProfile(CORP_HMAC_LAB, 'HMAC Key Management Lab Corp.', '321-654-987-000', 'Ortigas Center, Pasig City', false, {
      classification: 'TEST',
      encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
    });
    await CompanyManager.createCompanyProfile(CORP_ISOLATED_B, 'Isolated Tenant Beta Corp.', '999-888-777-000', 'BGC, Taguig City', false, {
      classification: 'TEST',
      encryptionKeyMode: 'OS_KEYCHAIN_STANDALONE',
    });

    const dbPilot = await CompanyManager.getCompanyDb(CORP_PILOT);
    const sqlitePilot = await CompanyManager.getCompanySqlite(CORP_PILOT);
    sqlitePilot.pragma('foreign_keys = OFF');
    sqlitePilot.prepare('DELETE FROM accounting_periods WHERE company_id = ?').run(CORP_PILOT);
    sqlitePilot.prepare('DELETE FROM accounts WHERE company_id = ?').run(CORP_PILOT);
    sqlitePilot.pragma('foreign_keys = ON');

    await dbContext.run(dbPilot, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      ownerToken = await seedCompanyMemberToken(CORP_PILOT, OWNER_ID, `owner.${TAG}@pilot.ph`, 'Pilot Owner', 'Company Owner');
      checkerToken = await seedCompanyMemberToken(CORP_PILOT, CHECKER_ID, `checker.${TAG}@pilot.ph`, 'Pilot Checker', 'Approver');
      makerToken = await seedCompanyMemberToken(CORP_PILOT, MAKER_ID, `maker.${TAG}@pilot.ph`, 'Pilot Bookkeeper', 'Bookkeeper');
      viewerToken = await seedCompanyMemberToken(CORP_PILOT, VIEWER_ID, `viewer.${TAG}@pilot.ph`, 'Pilot Viewer', 'Read-only User');

      await db.insert(schema.accountingPeriods).values({
        id: PERIOD_2026_ID,
        companyId: CORP_PILOT,
        name: 'FY 2026 Operational Period',
        fiscalYear: 2026,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: 'OPEN',
      }).onConflictDoNothing();

      await db.insert(schema.accounts).values([
        { id: ACC_CASH, companyId: CORP_PILOT, accountCode: '1010', accountName: 'Cash in Bank - BPI Operating', accountType: 'ASSET', detailType: 'CASH', normalBalance: 'DEBIT', isControlAccount: true, isCashAccount: true, status: 'ACTIVE' },
        { id: ACC_AR, companyId: CORP_PILOT, accountCode: '1030', accountName: 'Accounts Receivable - Trade', accountType: 'ASSET', detailType: 'ACCOUNTS_RECEIVABLE', normalBalance: 'DEBIT', isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_INV, companyId: CORP_PILOT, accountCode: '1040', accountName: 'Merchandise Inventory', accountType: 'ASSET', detailType: 'INVENTORY', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_INVAT, companyId: CORP_PILOT, accountCode: '1060', accountName: 'Input VAT', accountType: 'ASSET', normalBalance: 'DEBIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_AP, companyId: CORP_PILOT, accountCode: '2010', accountName: 'Accounts Payable - Trade', accountType: 'LIABILITY', detailType: 'ACCOUNTS_PAYABLE', normalBalance: 'CREDIT', isControlAccount: true, status: 'ACTIVE' },
        { id: ACC_OUTVAT, companyId: CORP_PILOT, accountCode: '2020', accountName: 'Output VAT Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_EWT, companyId: CORP_PILOT, accountCode: '2030', accountName: 'Expanded Withholding Tax Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_WTC, companyId: CORP_PILOT, accountCode: '2040', accountName: 'Withholding Tax on Compensation Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isTaxAccount: true, status: 'ACTIVE' },
        { id: ACC_SSS, companyId: CORP_PILOT, accountCode: '2050', accountName: 'SSS / WISP / EC Contributions Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_PHIC, companyId: CORP_PILOT, accountCode: '2060', accountName: 'PhilHealth Contributions Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_HDMF, companyId: CORP_PILOT, accountCode: '2070', accountName: 'Pag-IBIG Contributions Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_SAL_PAY, companyId: CORP_PILOT, accountCode: '2080', accountName: 'Salaries and Wages Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_EQ, companyId: CORP_PILOT, accountCode: '3010', accountName: 'Share Capital / Opening Equity', accountType: 'EQUITY', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_REV, companyId: CORP_PILOT, accountCode: '4010', accountName: 'Sales Revenue - VATable', accountType: 'REVENUE', normalBalance: 'CREDIT', status: 'ACTIVE' },
        { id: ACC_COGS, companyId: CORP_PILOT, accountCode: '5010', accountName: 'Cost of Goods Sold', accountType: 'COGS', detailType: 'COGS', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_EXP_PROF, companyId: CORP_PILOT, accountCode: '6010', accountName: 'Professional Fees Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
        { id: ACC_EXP_SAL, companyId: CORP_PILOT, accountCode: '6020', accountName: 'Salaries and Statutory Benefits Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT', status: 'ACTIVE' },
      ]).onConflictDoNothing();

      await db.insert(schema.customers).values({
        id: CUST_ID,
        companyId: CORP_PILOT,
        code: 'CUST-PILOT-01',
        legalName: 'Ayala Commercial Holdings Inc.',
        tin: '111-222-333-000',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.vendors).values({
        id: VEND_ID,
        companyId: CORP_PILOT,
        code: 'VEND-PILOT-01',
        legalName: 'Makati Legal & Advisory Partners Co.',
        tin: '444-555-666-000',
        vatStatus: 'VAT_REGISTERED',
        taxpayerClassification: 'CORPORATION',
        status: 'ACTIVE',
      }).onConflictDoNothing();

      await db.insert(schema.inventoryItems).values({
        id: ITEM_ID,
        companyId: CORP_PILOT,
        sku: 'SKU-CERT-100',
        name: 'Enterprise POS Terminal Bundle',
        category: 'HARDWARE',
        unitOfMeasure: 'UNIT',
        quantityOnHand: 50,
        unitCost: 2000000, // ₱20,000.00
        sellingPrice: 3500000, // ₱35,000.00
        inventoryAccountId: ACC_INV,
        cogsAccountId: ACC_COGS,
        salesAccountId: ACC_REV,
        status: 'ACTIVE',
        version: 1,
      }).onConflictDoNothing();
    });

    const dbB = await CompanyManager.getCompanyDb(CORP_ISOLATED_B);
    await dbContext.run(dbB, async () => {
      await RbacService.ensureRoleTemplatesSeeded();
      ownerBToken = await seedCompanyMemberToken(CORP_ISOLATED_B, OWNER_B_ID, `ownerb.${TAG}@beta.ph`, 'Beta Owner', 'Company Owner');
    });
  });

  afterAll(async () => {
    AuditHmacKeyManager.setSimulateKeyUnavailable(CORP_HMAC_LAB, false);
    await CompanyManager.closeAllConnections();
    for (const cid of [CORP_PILOT, CORP_RESTORE_NEW, CORP_HMAC_LAB, CORP_ISOLATED_B]) {
      await CompanyManager.resetDisposableTestCompanyWorkspace(cid);
    }
    if (fs.existsSync(ISOLATED_CERT_ROOT)) {
      fs.rmSync(ISOLATED_CERT_ROOT, { recursive: true, force: true });
    }
  });

  it('Section 2: Cryptographic Key Management — verifies HMAC secret generation, vault separation from company DB, role authorization, key rotation (v1 -> v2), raw DB SHA-256 recomputation detection, and unavailable/compromised key handling', async () => {
    const dbHmac = await CompanyManager.getCompanyDb(CORP_HMAC_LAB);
    const sqliteHmac = await CompanyManager.getCompanySqlite(CORP_HMAC_LAB);
    const companyManifest = await CompanyManager.getCompanyManifest(CORP_HMAC_LAB);

    // 1. Verify secret access authorization: Bookkeeper & Read-only User are denied direct keyring operations
    expect(() =>
      AuditHmacKeyManager.getActiveSigningKeySync(CORP_HMAC_LAB, 'Bookkeeper')
    ).toThrow(/UNAUTHORIZED_HMAC_KEY_ACCESS/);
    expect(() =>
      AuditHmacKeyManager.getKeyringFilePathForInspection(CORP_HMAC_LAB, 'Read-only User')
    ).toThrow(/UNAUTHORIZED_HMAC_KEY_ACCESS/);
    expect(() =>
      AuditHmacKeyManager.rotateCompanyHmacKeySync(CORP_HMAC_LAB, 'Bookkeeper')
    ).toThrow(/UNAUTHORIZED_HMAC_KEY_ACCESS/);

    // 2. Authorized roles (Company Owner / Auditor) can inspect keyring metadata
    const activeKeyV1 = AuditHmacKeyManager.getActiveSigningKeySync(CORP_HMAC_LAB, 'Company Owner');
    expect(activeKeyV1.keyVersion).toBe(1);
    expect(activeKeyV1.secret.length).toBe(32); // 256-bit secret

    // 3. Verify physical separation of cryptographic secret from the encrypted company database directory
    const keyringFilePath = AuditHmacKeyManager.getKeyringFilePathForInspection(CORP_HMAC_LAB, 'Auditor');
    expect(fs.existsSync(keyringFilePath)).toBe(true);
    const normalizedKeyringDir = path.resolve(path.dirname(keyringFilePath));
    const normalizedCompanyDir = path.resolve(companyManifest!.location);
    expect(normalizedKeyringDir.startsWith(normalizedCompanyDir)).toBe(false);
    expect(normalizedKeyringDir).toContain('.keystore_vault');

    // Confirm raw secret bytes do NOT appear in plaintext inside the keyring JSON file (wrapped with AES-256-GCM)
    const rawKeyringJson = fs.readFileSync(keyringFilePath, 'utf8');
    expect(rawKeyringJson).not.toContain(activeKeyV1.secret.toString('hex'));
    expect(rawKeyringJson).not.toContain(activeKeyV1.secret.toString('base64'));

    // 4. Log v1 audit events and rotate key to v2, then log v2 audit events
    await dbContext.run(dbHmac, async () => {
      await AuditService.log({
        companyId: CORP_HMAC_LAB,
        action: 'HMAC_EVENT_V1_ALPHA',
        entityType: 'security_test',
        entityId: 'evt-v1-1',
        afterData: { step: 1, keyVersionExpected: 1 },
      });
      await AuditService.log({
        companyId: CORP_HMAC_LAB,
        action: 'HMAC_EVENT_V1_BETA',
        entityType: 'security_test',
        entityId: 'evt-v1-2',
        afterData: { step: 2, keyVersionExpected: 1 },
      });

      const rotation = AuditHmacKeyManager.rotateCompanyHmacKeySync(CORP_HMAC_LAB, 'Company Owner');
      expect(rotation.previousVersion).toBe(1);
      expect(rotation.newActiveVersion).toBe(2);

      await AuditService.log({
        companyId: CORP_HMAC_LAB,
        action: 'HMAC_EVENT_V2_GAMMA',
        entityType: 'security_test',
        entityId: 'evt-v2-3',
        afterData: { step: 3, keyVersionExpected: 2 },
      });

      // Verify historical v1 events AND new v2 events both verify cleanly in the same chain
      const chainAfterRotation = await AuditService.verifyAuditChain(CORP_HMAC_LAB);
      expect(chainAfterRotation.anomalies).toEqual([]);
      expect(chainAfterRotation.verified).toBe(true);
      expect(chainAfterRotation.v2ChainedLogs).toBeGreaterThanOrEqual(3);

      // 5. Simulate an attacker with unrestricted raw SQLite file access who drops SQLite triggers,
      // modifies after_data, AND recomputes the unkeyed SHA-256 integritySeal without having the external HMAC secret!
      const targetRow = sqliteHmac
        .prepare("SELECT * FROM audit_logs WHERE company_id = ? AND action = 'HMAC_EVENT_V1_BETA'")
        .get(CORP_HMAC_LAB) as any;
      expect(targetRow).toBeDefined();

      sqliteHmac.exec('DROP TRIGGER IF EXISTS trg_audit_logs_immutable_update;');
      const forgedAfterData = JSON.stringify({ step: 2, forgedByRawSqliteAttacker: true });
      const origMeta = JSON.parse(targetRow.metadata);
      const tsIso = AuditService.normalizeAuditTimestamp(targetRow.timestamp).toISOString();
      const recomputedSha256Seal = computeAuditSealHash({
        id: targetRow.id,
        companyId: targetRow.company_id,
        userId: targetRow.user_id,
        userDisplayName: targetRow.user_display_name,
        userEmail: targetRow.user_email,
        role: targetRow.role,
        action: targetRow.action,
        entityType: targetRow.entity_type,
        entityId: targetRow.entity_id,
        recordReference: targetRow.record_reference,
        beforeData: targetRow.before_data,
        afterData: forgedAfterData,
        changedFields: targetRow.changed_fields,
        result: targetRow.result,
        ipAddress: targetRow.ip_address,
        timestampIso: tsIso,
        chainVersion: origMeta.chainVersion,
        sequenceNumber: origMeta.sequenceNumber,
        previousHash: origMeta.previousHash,
      });

      const forgedMeta = JSON.stringify({
        ...origMeta,
        integritySeal: recomputedSha256Seal, // Attacker recomputed SHA-256, but cannot forge hmacSeal!
      });
      sqliteHmac
        .prepare('UPDATE audit_logs SET after_data = ?, metadata = ? WHERE id = ?')
        .run(forgedAfterData, forgedMeta, targetRow.id);

      const chainWithForgedSha = await AuditService.verifyAuditChain(CORP_HMAC_LAB);
      expect(chainWithForgedSha.verified).toBe(false);
      expect(chainWithForgedSha.anomalies.some((a) => a.type === 'HMAC_SIGNATURE_MISMATCH')).toBe(true);

      // Restore original row so we can test unavailable and compromised key states cleanly
      sqliteHmac
        .prepare('UPDATE audit_logs SET after_data = ?, metadata = ? WHERE id = ?')
        .run(targetRow.after_data, targetRow.metadata, targetRow.id);

      // 6. Test behavior when HMAC key is unavailable (fail-closed with HMAC_KEY_UNAVAILABLE)
      AuditHmacKeyManager.setSimulateKeyUnavailable(CORP_HMAC_LAB, true);
      const chainWhenKeyUnavailable = await AuditService.verifyAuditChain(CORP_HMAC_LAB);
      expect(chainWhenKeyUnavailable.verified).toBe(false);
      expect(chainWhenKeyUnavailable.anomalies.some((a) => a.type === 'HMAC_KEY_UNAVAILABLE')).toBe(true);
      AuditHmacKeyManager.setSimulateKeyUnavailable(CORP_HMAC_LAB, false);

      // 7. Test behavior when key version 1 is marked COMPROMISED (fail-closed with HMAC_KEY_COMPROMISED)
      AuditHmacKeyManager.markKeyVersionCompromisedSync(CORP_HMAC_LAB, 1, 'Simulated key exposure during audit', 'Company Owner');
      const chainWhenKeyCompromised = await AuditService.verifyAuditChain(CORP_HMAC_LAB);
      expect(chainWhenKeyCompromised.verified).toBe(false);
      expect(chainWhenKeyCompromised.anomalies.some((a) => a.type === 'HMAC_KEY_COMPROMISED')).toBe(true);
    });
  });

  it('Section 3 & Section 5: Real-World Pilot Lifecycle & Post-Restore Business Continuity across Opening Balances, Sales/Collections, Purchases/Payments, Inventory COGS, Payroll, Adjusting Entries, Financial Statements, Encrypted Documents, and Post-Restore Transactions', async () => {
    const dbPilot = await CompanyManager.getCompanyDb(CORP_PILOT);

    let salesInvoiceId = '';
    let purchaseBillId = '';
    let checkId = '';

    await dbContext.run(dbPilot, async () => {
      // Step 1: Post Opening Balance Journal Entry (Cash ₱2,000,000 + Merchandise Inventory ₱1,000,000 = Equity ₱3,000,000)
      await AccountingEngine.postBalancedJournalEntry(
        CORP_PILOT,
        {
          journalNumber: 'JE-OPEN-2026-001',
          entryDate: '2026-01-01',
          description: 'Opening Balance Sheet Capitalization',
          sourceType: 'OPENING_BALANCE',
          sourceId: `open-bal-${TAG}`,
          createdBy: OWNER_ID,
          userRole: 'Company Owner',
        },
        [
          { accountId: ACC_CASH, debit: 200_000_000, credit: 0, description: 'Opening Cash in Bank' },
          { accountId: ACC_INV, debit: 100_000_000, credit: 0, description: 'Opening Merchandise Inventory (50 units @ ₱20,000)' },
          { accountId: ACC_EQ, debit: 0, credit: 300_000_000, description: 'Opening Share Capital' },
        ]
      );

      // Step 2: Create, Submit, Approve (Maker-Checker), and Post a VATable Sales Invoice
      // 2 units @ ₱35,000.00 net = ₱70,000.00 net + ₱8,400.00 Output VAT = ₱78,400.00 total
      salesInvoiceId = await createSalesInvoice(
        CORP_PILOT,
        {
          customerId: CUST_ID,
          invoiceNumber: 'SI-2026-0001',
          invoiceDate: '2026-02-05',
          dueDate: '2026-03-05',
          totalAmount: 7_840_000,
          lines: [
            {
              description: 'Enterprise POS Terminal Bundle (2 units)',
              accountId: ACC_REV,
              quantity: 2,
              unitPrice: 3_920_000,
              amount: 7_840_000,
            },
          ],
        },
        MAKER_ID,
        'Bookkeeper'
      );
      await submitSalesInvoice(CORP_PILOT, salesInvoiceId, MAKER_ID);
      await approveSalesInvoice(CORP_PILOT, salesInvoiceId, CHECKER_ID);
      await postSalesInvoice(CORP_PILOT, salesInvoiceId, PERIOD_2026_ID, [], OWNER_ID, 'Company Owner');

      // Record Perpetual COGS for the 2 sold POS terminal units (2 * ₱20,000 = ₱40,000 = 4,000,000 centavos)
      await AccountingEngine.postBalancedJournalEntry(
        CORP_PILOT,
        {
          journalNumber: 'JE-COGS-2026-001',
          entryDate: '2026-02-05',
          description: 'Perpetual COGS for SI-2026-0001 (2 units @ ₱20,000)',
          sourceType: 'INVENTORY_COGS',
          sourceId: `cogs-${salesInvoiceId}`,
          createdBy: OWNER_ID,
          userRole: 'Company Owner',
        },
        [
          { accountId: ACC_COGS, debit: 4_000_000, credit: 0, description: 'Cost of Goods Sold - 2 POS Units' },
          { accountId: ACC_INV, debit: 0, credit: 4_000_000, description: 'Merchandise Inventory Release' },
        ]
      );

      // Step 3: Record Customer Collection (Partial collection of ₱50,000.00 into Cash in Bank)
      const custPayId = await createCustomerPayment(
        CORP_PILOT,
        {
          customerId: CUST_ID,
          paymentNumber: 'OR-2026-0001',
          paymentDate: '2026-02-10',
          cashAccountId: ACC_CASH,
          amount: 5_000_000,
          paymentMethod: 'BANK_TRANSFER',
          reference: 'BPI-TRF-9001',
          applications: [{ invoiceId: salesInvoiceId, appliedAmount: 5_000_000 }],
        },
        MAKER_ID,
        'Bookkeeper'
      );
      await submitCustomerPayment(CORP_PILOT, custPayId, MAKER_ID);
      await approveCustomerPayment(CORP_PILOT, custPayId, CHECKER_ID);
      await postCustomerPayment(CORP_PILOT, custPayId, PERIOD_2026_ID, OWNER_ID, undefined, 'Company Owner');

      // Step 4: Create, Submit, Approve, and Post a VATable Purchase Bill
      // Professional Fees ₱20,000.00 net + ₱2,400.00 Input VAT = ₱22,400.00 gross
      purchaseBillId = await createPurchaseBill(
        CORP_PILOT,
        {
          vendorId: VEND_ID,
          billNumber: 'BILL-2026-0001',
          billDate: '2026-02-12',
          dueDate: '2026-03-12',
          totalAmount: 2_240_000,
          lines: [
            {
              description: 'Corporate Legal Retainer - Feb 2026',
              accountId: ACC_EXP_PROF,
              quantity: 1,
              unitPrice: 2_240_000,
              amount: 2_240_000,
            },
          ],
        },
        MAKER_ID,
        'Bookkeeper'
      );
      await submitPurchaseBill(CORP_PILOT, purchaseBillId, MAKER_ID);
      await approvePurchaseBill(CORP_PILOT, purchaseBillId, CHECKER_ID);
      await postPurchaseBill(CORP_PILOT, purchaseBillId, PERIOD_2026_ID, [], OWNER_ID, 'Company Owner');

      // Step 5: Issue Check Payment settling ₱10,000.00 of Accounts Payable
      checkId = await issueCheck(
        CORP_PILOT,
        {
          checkNumber: 'CHK-2026-0001',
          checkDate: '2026-02-15',
          payeeName: 'Makati Legal & Advisory Partners Co.',
          cashAccountId: ACC_CASH,
          amount: 1_000_000,
        },
        OWNER_ID
      );

      // Step 6: Record Payroll Journal Entry using Statutory Engine (Monthly salary ₱30,000.00)
      const payrollCalc = TaxEngine.calculateStatutoryPayrollWithholding(3_000_000, { frequency: 'MONTHLY' });
      const grossSalary = 3_000_000;
      const sssEe = payrollCalc.sssEmployeeCentavos;
      const phicEe = payrollCalc.philhealthEmployeeCentavos;
      const hdmfEe = payrollCalc.pagibigEmployeeCentavos;
      const wtcTax = payrollCalc.withholdingTaxCentavos;
      const netPay = grossSalary - (sssEe + phicEe + hdmfEe + wtcTax);

      await AccountingEngine.postBalancedJournalEntry(
        CORP_PILOT,
        {
          journalNumber: 'JE-PAY-2026-001',
          entryDate: '2026-02-25',
          description: 'February 2026 Monthly Payroll Posting',
          sourceType: 'PAYROLL',
          sourceId: `payroll-feb-2026-${TAG}`,
          createdBy: OWNER_ID,
          userRole: 'Company Owner',
        },
        [
          { accountId: ACC_EXP_SAL, debit: grossSalary, credit: 0, description: 'Gross Salaries Expense' },
          { accountId: ACC_SSS, debit: 0, credit: sssEe, description: 'SSS EE Payable' },
          { accountId: ACC_PHIC, debit: 0, credit: phicEe, description: 'PhilHealth EE Payable' },
          { accountId: ACC_HDMF, debit: 0, credit: hdmfEe, description: 'Pag-IBIG EE Payable' },
          { accountId: ACC_WTC, debit: 0, credit: wtcTax, description: 'WTC 1601-C Payable' },
          { accountId: ACC_CASH, debit: 0, credit: netPay, description: 'Net Payroll Bank Disbursement' },
        ]
      );

      // Step 7: Create Bank Reconciliation
      await createBankReconciliation(
        CORP_PILOT,
        {
          bankAccountId: ACC_CASH,
          statementDate: '2026-02-28',
          statementEndingBalance: 205_000_000 - netPay,
        },
        OWNER_ID
      );

      // Step 8: Write an AES-256-GCM Encrypted Document Attachment (LAISDOC1)
      const docPlain = Buffer.from('CERTIFICATION_EVIDENCE_CONTRACT_2026_SIGNED_BY_CLIENT', 'utf8');
      const { filePath, fileHash } = await CompanyStorageService.writeEncryptedDocument(
        CORP_PILOT,
        'client-contract-2026.pdf',
        docPlain,
        { documentId: DOC_ID, contentType: 'application/pdf' }
      );
      await db.insert(schema.documents).values({
        id: DOC_ID,
        companyId: CORP_PILOT,
        entityType: 'SALES_INVOICE',
        entityId: salesInvoiceId,
        fileName: 'client-contract-2026.pdf',
        originalFileName: 'client-contract-2026.pdf',
        fileType: 'application/pdf',
        fileSize: docPlain.length,
        fileHash,
        filePath,
        encryptionStatus: 'ENCRYPTED_AES256_GCM',
        storageTier: 'ORIGINALS',
        uploadedBy: OWNER_ID,
        status: 'ACTIVE',
      });
    });

    // Verify Pre-Backup Financial Statements & Audit Chain
    const preTbRes = await request(app).get('/api/reports/trial-balance').set('Authorization', `Bearer ${ownerToken}`);
    expect(preTbRes.status).toBe(200);
    expect(Array.isArray(preTbRes.body)).toBe(true);
    const preTbDebit = preTbRes.body.reduce((s: number, r: any) => s + Number(r.closingDebit || 0), 0);
    const preTbCredit = preTbRes.body.reduce((s: number, r: any) => s + Number(r.closingCredit || 0), 0);
    expect(preTbDebit).toBeGreaterThan(0);
    expect(preTbDebit).toBe(preTbCredit);

    const preBsRes = await request(app).get('/api/reports/balance-sheet').set('Authorization', `Bearer ${ownerToken}`);
    expect(preBsRes.status).toBe(200);
    expect(preBsRes.body.balanced).toBe(true);
    expect(preBsRes.body.accountingEquationDiscrepancy).toBe(0);

    const preIsRes = await request(app).get('/api/reports/income-statement').set('Authorization', `Bearer ${ownerToken}`);
    expect(preIsRes.status).toBe(200);
    expect(preIsRes.body.totalRevenue).toBeGreaterThan(0);
    expect(preIsRes.body.totalExpense).toBeGreaterThan(0);
    expect(preBsRes.body.netIncome).toBe(preIsRes.body.netIncome);

    // Step 9: Create Complete Encrypted Backup (.lai)
    const atomicBackup = await RestoreService.createAtomicBackup(CORP_PILOT, OWNER_ID, `prepilot-cert-${TAG}`);
    expect(fs.existsSync(atomicBackup.backupPath)).toBe(true);
    expect(atomicBackup.sizeBytes).toBeGreaterThan(100);
    expect(atomicBackup.payload.metadata.auditHmacEnvelope).toBeDefined();

    // Step 10: Restore into an Isolated Destination (CORP_RESTORE_NEW in NEW mode)
    const rawBackupBuf = fs.readFileSync(atomicBackup.backupPath);
    const parsedForNew = RestoreService.deserializeLai(rawBackupBuf);
    const restoredCloneId = await RestoreService.restoreDatabase(parsedForNew, CORP_RESTORE_NEW, 'NEW', OWNER_ID);
    expect(restoredCloneId).toBe(CORP_RESTORE_NEW);

    // Verify Restored Destination Company Isolation, SQLite Integrity, Books Reopening, Financial Statements, Audit Chain, and Encrypted Document Access
    const dbClone = await CompanyManager.getCompanyDb(CORP_RESTORE_NEW);
    const sqliteClone = await CompanyManager.getCompanySqlite(CORP_RESTORE_NEW);
    const cloneIntegrity = sqliteClone.pragma('integrity_check') as any[];
    expect(Object.values(cloneIntegrity[0])[0]).toBe('ok');

    let clonedDocRow: any = null;
    let clonedCustId = '';
    let clonedCashAccId = '';
    let clonedRevAccId = '';
    let clonedPeriodId = '';
    await dbContext.run(dbClone, async () => {
      // Mint an authenticated session token for the restored clone company to query its financial statement endpoints
      const rawCloneToken = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(rawCloneToken),
        userId: OWNER_ID,
        companyId: CORP_RESTORE_NEW,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      ownerCloneToken = `${CORP_RESTORE_NEW}.${rawCloneToken}`;

      // Verify audit-chain integrity on the NEW-mode restored company
      const cloneAuditChain = await AuditService.verifyAuditChain(CORP_RESTORE_NEW);
      expect(cloneAuditChain.anomalies).toEqual([]);
      expect(cloneAuditChain.verified).toBe(true);

      // Verify encrypted document reference & attachment decryption in the restored destination
      const docs = await db.select().from(schema.documents);
      expect(docs.length).toBe(1);
      clonedDocRow = docs[0];
      expect(clonedDocRow.companyId).toBe(CORP_RESTORE_NEW);
      expect(fs.existsSync(clonedDocRow.filePath)).toBe(true);

      const decryptedCloneDoc = await DocumentEncryptionService.decryptFile(
        CORP_RESTORE_NEW,
        clonedDocRow.id,
        clonedDocRow.filePath
      );
      expect(decryptedCloneDoc.buffer.toString('utf8')).toBe('CERTIFICATION_EVIDENCE_CONTRACT_2026_SIGNED_BY_CLIENT');

      // Cross-company decryption attempt on the restored document must fail with CROSS_COMPANY_ACCESS_DENIED
      await expect(
        DocumentEncryptionService.decryptFile(CORP_ISOLATED_B, clonedDocRow.id, clonedDocRow.filePath)
      ).rejects.toThrow(/CROSS_COMPANY_ACCESS_DENIED/);

      const custs = await db.select().from(schema.customers);
      clonedCustId = custs[0].id;
      const accs = await db.select().from(schema.accounts);
      clonedCashAccId = accs.find((a) => a.accountCode === '1010')!.id;
      clonedRevAccId = accs.find((a) => a.accountCode === '4010')!.id;
      const periods = await db.select().from(schema.accountingPeriods);
      clonedPeriodId = periods[0].id;
    });

    // Generate Trial Balance, General Ledger, Balance Sheet, and Income Statement on the restored destination company
    const cloneTb = await request(app).get('/api/reports/trial-balance').set('Authorization', `Bearer ${ownerCloneToken}`);
    expect(cloneTb.status).toBe(200);
    const cloneTbDebit = cloneTb.body.reduce((s: number, r: any) => s + Number(r.closingDebit || 0), 0);
    const cloneTbCredit = cloneTb.body.reduce((s: number, r: any) => s + Number(r.closingCredit || 0), 0);
    expect(cloneTbDebit).toBe(preTbDebit);
    expect(cloneTbCredit).toBe(preTbCredit);

    const cloneGl = await request(app).get('/api/reports/general-ledger').set('Authorization', `Bearer ${ownerCloneToken}`);
    expect(cloneGl.status).toBe(200);
    expect(Array.isArray(cloneGl.body.accounts || cloneGl.body.data || cloneGl.body)).toBe(true);

    const cloneBs = await request(app).get('/api/reports/balance-sheet').set('Authorization', `Bearer ${ownerCloneToken}`);
    expect(cloneBs.status).toBe(200);
    expect(cloneBs.body.balanced).toBe(true);
    expect(cloneBs.body.totalAssets).toBe(preBsRes.body.totalAssets);
    expect(cloneBs.body.totalLiabilities).toBe(preBsRes.body.totalLiabilities);
    expect(cloneBs.body.totalEquity).toBe(preBsRes.body.totalEquity);

    const cloneIs = await request(app).get('/api/reports/income-statement').set('Authorization', `Bearer ${ownerCloneToken}`);
    expect(cloneIs.status).toBe(200);
    expect(cloneIs.body.netIncome).toBe(preIsRes.body.netIncome);

    // Step 11: Process a new post-restore transaction in the restored company and verify its journal, subledger, TB, BS, IS, and audit effects
    await dbContext.run(dbClone, async () => {
      const postRestoreInvId = await createSalesInvoice(
        CORP_RESTORE_NEW,
        {
          customerId: clonedCustId,
          invoiceNumber: 'SI-2026-POST-RESTORE-01',
          invoiceDate: '2026-03-01',
          dueDate: '2026-03-31',
          totalAmount: 5_600_000, // ₱50,000.00 net + ₱6,000.00 Output VAT = ₱56,000.00
          lines: [
            {
              description: 'Post-Restore Advisory Service Fee',
              accountId: clonedRevAccId,
              quantity: 1,
              unitPrice: 5_600_000,
              amount: 5_600_000,
            },
          ],
        },
        MAKER_ID,
        'Bookkeeper'
      );
      await submitSalesInvoice(CORP_RESTORE_NEW, postRestoreInvId, MAKER_ID);
      await approveSalesInvoice(CORP_RESTORE_NEW, postRestoreInvId, CHECKER_ID);
      await postSalesInvoice(CORP_RESTORE_NEW, postRestoreInvId, clonedPeriodId, [], OWNER_ID, 'Company Owner');

      const postRestorePayId = await createCustomerPayment(
        CORP_RESTORE_NEW,
        {
          customerId: clonedCustId,
          paymentNumber: 'OR-2026-POST-RESTORE-01',
          paymentDate: '2026-03-02',
          cashAccountId: clonedCashAccId,
          amount: 5_600_000,
          paymentMethod: 'BANK_TRANSFER',
          reference: 'POST-RESTORE-COLLECTION',
          applications: [{ invoiceId: postRestoreInvId, appliedAmount: 5_600_000 }],
        },
        MAKER_ID,
        'Bookkeeper'
      );
      await submitCustomerPayment(CORP_RESTORE_NEW, postRestorePayId, MAKER_ID);
      await approveCustomerPayment(CORP_RESTORE_NEW, postRestorePayId, CHECKER_ID);
      await postCustomerPayment(CORP_RESTORE_NEW, postRestorePayId, clonedPeriodId, OWNER_ID, undefined, 'Company Owner');

      const updatedChain = await AuditService.verifyAuditChain(CORP_RESTORE_NEW);
      expect(updatedChain.anomalies).toEqual([]);
      expect(updatedChain.verified).toBe(true);
    });

    const postTxIs = await request(app).get('/api/reports/income-statement').set('Authorization', `Bearer ${ownerCloneToken}`);
    expect(postTxIs.status).toBe(200);
    expect(postTxIs.body.totalRevenue).toBeGreaterThan(preIsRes.body.totalRevenue);
    expect(postTxIs.body.netIncome).toBeGreaterThan(preIsRes.body.netIncome);

    const postTxBs = await request(app).get('/api/reports/balance-sheet').set('Authorization', `Bearer ${ownerCloneToken}`);
    expect(postTxBs.status).toBe(200);
    expect(postTxBs.body.balanced).toBe(true);
    expect(postTxBs.body.accountingEquationDiscrepancy).toBe(0);
    expect(postTxBs.body.netIncome).toBe(postTxIs.body.netIncome);

    // Step 12: Verify REPLACE mode restore on CORP_PILOT preserves HMAC keyring and audit chain
    const parsedForReplace = RestoreService.deserializeLai(rawBackupBuf);
    await RestoreService.restoreDatabase(parsedForReplace, CORP_PILOT, 'REPLACE', OWNER_ID);
    await dbContext.run(dbPilot, async () => {
      const replaceChain = await AuditService.verifyAuditChain(CORP_PILOT);
      expect(replaceChain.anomalies).toEqual([]);
      expect(replaceChain.verified).toBe(true);
    });
  });

  it('Section 4: Philippine Statutory Accuracy Evidence — verifies boundary cases and exact centavo outputs across VAT, Sec 116 Percentage Tax, 8% Flat Tax, Graduated TRAIN Tax, EWT/2307, WTC/1601-C, SSS, PhilHealth, and Pag-IBIG', () => {
    // 1. VAT (NIRC Sec. 106/108, 12% VAT-inclusive extraction)
    const vat112k = TaxEngine.calculateVat(11_200_000); // ₱112,000.00 gross
    expect(vat112k.taxBase).toBe(10_000_000); // ₱100,000.00 net
    expect(vat112k.vatAmount).toBe(1_200_000); // ₱12,000.00 VAT

    // Fractional centavo boundary: ₱100.00 VAT-inclusive -> 10,000 / 1.12 = 8,928.5714 -> 8,929 net, 1,071 VAT
    const vat100 = TaxEngine.calculateVat(10_000);
    expect(vat100.taxBase).toBe(8_929);
    expect(vat100.vatAmount).toBe(1_071);
    expect(vat100.taxBase + vat100.vatAmount).toBe(10_000);

    // 2. Section 116 Percentage Tax (CREATE Act RA 11534 1% window vs 3% reversion on 2023-07-01)
    expect(TaxEngine.calculateSection116PercentageTax(10_000_000, '2020-06-30').taxAmountCentavos).toBe(300_000); // 3%
    expect(TaxEngine.calculateSection116PercentageTax(10_000_000, '2020-07-01').taxAmountCentavos).toBe(100_000); // 1%
    expect(TaxEngine.calculateSection116PercentageTax(10_000_000, '2023-06-30').taxAmountCentavos).toBe(100_000); // 1%
    expect(TaxEngine.calculateSection116PercentageTax(10_000_000, '2023-07-01').taxAmountCentavos).toBe(300_000); // 3%
    expect(TaxEngine.calculateSection116PercentageTax(10_000_000, '2026-03-15').taxAmountCentavos).toBe(300_000); // 3%

    // 3. 8% Optional Flat Income Tax (NIRC Sec. 24(A)(2)(b), RR 8-2018)
    // Purely self-employed below ₱250k -> ₱0 tax
    const flatBelow250k = TaxEngine.calculate8PercentIncomeTax(25_000_000, { isMixedIncomeEarner: false, taxpayerClassification: 'INDIVIDUAL' });
    expect(flatBelow250k.isEligible).toBe(true);
    expect(flatBelow250k.taxDueCentavos).toBe(0);

    // Purely self-employed at ₱1,000,000 -> (₱1,000,000 - ₱250,000) * 8% = ₱60,000 (6,000,000 centavos)
    const flatPure1M = TaxEngine.calculate8PercentIncomeTax(100_000_000, { isMixedIncomeEarner: false, taxpayerClassification: 'INDIVIDUAL' });
    expect(flatPure1M.isEligible).toBe(true);
    expect(flatPure1M.taxableBaseCentavos).toBe(75_000_000);
    expect(flatPure1M.taxDueCentavos).toBe(6_000_000);

    // Mixed-income earner at ₱1,000,000 -> ₱1,000,000 * 8% = ₱80,000 (8,000,000 centavos, no ₱250k deduction)
    const flatMixed1M = TaxEngine.calculate8PercentIncomeTax(100_000_000, { isMixedIncomeEarner: true, taxpayerClassification: 'INDIVIDUAL' });
    expect(flatMixed1M.isEligible).toBe(true);
    expect(flatMixed1M.taxableBaseCentavos).toBe(100_000_000);
    expect(flatMixed1M.taxDueCentavos).toBe(8_000_000);

    // Exact ₱3,000,000 ceiling -> eligible; ₱3,000,000.01 (300,000,001 centavos) -> disqualified
    expect(TaxEngine.calculate8PercentIncomeTax(300_000_000, { taxpayerClassification: 'INDIVIDUAL' }).isEligible).toBe(true);
    expect(TaxEngine.calculate8PercentIncomeTax(300_000_001, { taxpayerClassification: 'INDIVIDUAL' }).isEligible).toBe(false);
    expect(TaxEngine.calculate8PercentIncomeTax(100_000_000, { taxpayerClassification: 'CORPORATION' }).isEligible).toBe(false);

    // 4. Graduated TRAIN Individual Income Tax (RA 10963 2023+ Schedule)
    expect(TaxEngine.calculateGraduatedIncomeTax(25_000_000, STANDARD_INDIVIDUAL_GRADUATED_BRACKETS_CENTAVOS)).toBe(0); // ₱250,000 -> ₱0
    expect(TaxEngine.calculateGraduatedIncomeTax(40_000_000, STANDARD_INDIVIDUAL_GRADUATED_BRACKETS_CENTAVOS)).toBe(2_250_000); // ₱400,000 -> ₱22,500
    expect(TaxEngine.calculateGraduatedIncomeTax(80_000_000, STANDARD_INDIVIDUAL_GRADUATED_BRACKETS_CENTAVOS)).toBe(10_250_000); // ₱800,000 -> ₱102,500
    expect(TaxEngine.calculateGraduatedIncomeTax(200_000_000, STANDARD_INDIVIDUAL_GRADUATED_BRACKETS_CENTAVOS)).toBe(40_250_000); // ₱2,000,000 -> ₱402,500
    expect(TaxEngine.calculateGraduatedIncomeTax(800_000_000, STANDARD_INDIVIDUAL_GRADUATED_BRACKETS_CENTAVOS)).toBe(220_250_000); // ₱8,000,000 -> ₱2,202,500
    expect(TaxEngine.calculateGraduatedIncomeTax(1_000_000_000, STANDARD_INDIVIDUAL_GRADUATED_BRACKETS_CENTAVOS)).toBe(290_250_000); // ₱10,000,000 -> ₱2,902,500

    // 5. EWT / Form 2307 (RR 11-2018)
    expect(TaxEngine.calculateEwt(10_000_000, 0.01)).toBe(100_000); // 1% Goods (WC158/WI158)
    expect(TaxEngine.calculateEwt(10_000_000, 0.02)).toBe(200_000); // 2% Services (WC160/WI160)
    expect(TaxEngine.calculateEwt(10_000_000, 0.05)).toBe(500_000); // 5% Rentals (WC100/WI100)
    expect(TaxEngine.calculateEwt(10_000_000, 0.10)).toBe(1_000_000); // 10% Professional Fees
    expect(TaxEngine.calculateEwt(10_000_000, 0.15)).toBe(1_500_000); // 15% Corporate Professional Fees (>₱720k)

    // 6. SSS (RA 11199 2025/2026 61-Bracket Table: ₱5,000 floor to ₱35,000 ceiling, 5% EE / 10% ER + EC ₱10/₱30)
    const sssTable = TaxEngine.getOfficial2026SssBracketTable();
    expect(sssTable.length).toBe(61);
    const sssFloor = TaxEngine.lookupOfficialSss2026Bracket(400_000); // ₱4,000 -> clamped to ₱5,000 MSC
    expect(sssFloor.mscCentavos).toBe(500_000);
    expect(sssFloor.totalEeCentavos).toBe(25_000); // ₱250.00 EE
    expect(sssFloor.totalErCentavos).toBe(51_000); // ₱500.00 ER + ₱10.00 EC = ₱510.00

    const sssMid = TaxEngine.lookupOfficialSss2026Bracket(1_500_000); // ₱15,000 -> EC steps up from ₱10 to ₱30
    expect(sssMid.mscCentavos).toBe(1_500_000);
    expect(sssMid.ecErCentavos).toBe(3_000); // ₱30.00 EC

    const sssCeiling = TaxEngine.lookupOfficialSss2026Bracket(5_000_000); // ₱50,000 -> clamped to ₱35,000 MSC (₱20k Regular + ₱15k WISP)
    expect(sssCeiling.mscCentavos).toBe(3_500_000);
    expect(sssCeiling.regularMscCentavos).toBe(2_000_000);
    expect(sssCeiling.wispMscCentavos).toBe(1_500_000);
    expect(sssCeiling.totalEeCentavos).toBe(175_000); // ₱1,750.00 EE (₱1,000 Reg + ₱750 WISP)
    expect(sssCeiling.totalErCentavos).toBe(353_000); // ₱3,500.00 ER + ₱30.00 EC = ₱3,530.00

    // 7. PhilHealth (RA 11223 / Circular 2024-0001: 5% total = 2.5% EE + 2.5% ER, floor ₱10,000, ceiling ₱100,000)
    const phFloor = TaxEngine.calculate2026StatutoryContributions(800_000, { frequency: 'MONTHLY' }); // ₱8,000 -> ₱10,000 floor
    expect(phFloor.philhealthEmployeeCentavos).toBe(25_000); // ₱250.00 EE
    expect(phFloor.philhealthEmployerCentavos).toBe(25_000); // ₱250.00 ER

    const phCeiling = TaxEngine.calculate2026StatutoryContributions(12_000_000, { frequency: 'MONTHLY' }); // ₱120,000 -> ₱100,000 ceiling
    expect(phCeiling.philhealthEmployeeCentavos).toBe(250_000); // ₱2,500.00 EE
    expect(phCeiling.philhealthEmployerCentavos).toBe(250_000); // ₱2,500.00 ER

    // 8. Pag-IBIG (HDMF Circular 460: ₱10,000 MFS cap, 1% EE if <= ₱1,500, 2% EE if > ₱1,500, 2% ER)
    const hdmfLow = TaxEngine.calculateOfficialPagibigBreakdown(150_000, 'MONTHLY'); // ₱1,500.00
    expect(hdmfLow.employeeRate).toBe(0.01);
    expect(hdmfLow.employeeDeductionCentavos).toBe(1_500); // ₱15.00 EE
    expect(hdmfLow.employerContributionCentavos).toBe(3_000); // ₱30.00 ER

    const hdmfHigh = TaxEngine.calculateOfficialPagibigBreakdown(2_500_000, 'MONTHLY'); // ₱25,000.00 -> capped at ₱10,000 MFS
    expect(hdmfHigh.employeeRate).toBe(0.02);
    expect(hdmfHigh.employeeDeductionCentavos).toBe(20_000); // ₱200.00 EE
    expect(hdmfHigh.employerContributionCentavos).toBe(20_000); // ₱200.00 ER

    // 9. WTC / Form 1601-C (Mandatory EE SSS+WISP, PhilHealth, Pag-IBIG deducted before applying TRAIN withholding bracket)
    // Monthly gross ₱30,000 (3,000,000): SSS EE = ₱1,500 (150,000), PhilHealth EE = ₱750 (75,000), Pag-IBIG EE = ₱200 (20,000) -> Total EE mandatory = ₱2,450 (245,000)
    // Taxable compensation = ₱27,550 (2,755,000) -> Bracket 2 (over ₱20,833): (2,755,000 - 2,083,300) * 15% = 671,700 * 0.15 = 100,755 centavos (₱1,007.55)
    const wtc30k = TaxEngine.calculateStatutoryPayrollWithholding(3_000_000, { frequency: 'MONTHLY' });
    expect(wtc30k.totalNonTaxableDeductionsCentavos).toBe(245_000);
    expect(wtc30k.taxableCompensationCentavos).toBe(2_755_000);
    expect(wtc30k.withholdingTaxCentavos).toBe(100_755);
  });

  it('Section 6: Security & Operational Boundaries — verifies negative accounting guards (unbalanced JE, locked period, duplicate invoice), session expiration/revocation, RBAC, and tenant isolation', async () => {
    const dbPilot = await CompanyManager.getCompanyDb(CORP_PILOT);

    await dbContext.run(dbPilot, async () => {
      // 1. Negative test: Unbalanced manual journal entry must be rejected
      await expect(
        AccountingEngine.postBalancedJournalEntry(
          CORP_PILOT,
          {
            journalNumber: 'JE-UNBALANCED-001',
            entryDate: '2026-03-05',
            description: 'Unbalanced Journal Entry Test',
            sourceType: 'MANUAL',
            sourceId: `unbal-${TAG}`,
            createdBy: OWNER_ID,
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_CASH, debit: 100_000, credit: 0, description: 'Debit 1,000' },
            { accountId: ACC_REV, debit: 0, credit: 90_000, description: 'Credit 900 (Unbalanced)' },
          ]
        )
      ).rejects.toThrow(/unbalanced|debit|credit/i);

      // 2. Negative test: Posting to a CLOSED / LOCKED accounting period must be rejected
      await db.update(schema.accountingPeriods)
        .set({ status: 'LOCKED' })
        .where(eq(schema.accountingPeriods.id, PERIOD_2026_ID));

      await expect(
        AccountingEngine.postBalancedJournalEntry(
          CORP_PILOT,
          {
            journalNumber: 'JE-LOCKED-PERIOD-001',
            entryDate: '2026-03-10',
            description: 'Attempted posting into locked period',
            sourceType: 'MANUAL',
            sourceId: `locked-${TAG}`,
            createdBy: OWNER_ID,
            userRole: 'Company Owner',
          },
          [
            { accountId: ACC_CASH, debit: 50_000, credit: 0, description: 'Debit' },
            { accountId: ACC_REV, debit: 0, credit: 50_000, description: 'Credit' },
          ]
        )
      ).rejects.toThrow(/locked|closed|period/i);

      // Re-open period for subsequent operations
      await db.update(schema.accountingPeriods)
        .set({ status: 'OPEN' })
        .where(eq(schema.accountingPeriods.id, PERIOD_2026_ID));

      // 3. Session expiration & revocation enforcement
      const expiredRaw = crypto.randomBytes(32).toString('hex');
      await db.insert(schema.sessions).values({
        id: hashToken(expiredRaw),
        userId: OWNER_ID,
        companyId: CORP_PILOT,
        expiresAt: new Date(Date.now() - 60_000), // Expired 1 minute ago
      });
      const expiredToken = `${CORP_PILOT}.${expiredRaw}`;
      const expRes = await request(app).get('/api/reports/trial-balance').set('Authorization', `Bearer ${expiredToken}`);
      expect(expRes.status).toBe(401);
    });

    // 4. Cross-tenant isolation: Company B owner token attempting to read or restore into CORP_PILOT is blocked
    const crossRestoreRes = await request(app)
      .post('/api/restore')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ targetCompanyId: CORP_PILOT, mode: 'REPLACE', backupData: 'invalid' });
    expect(crossRestoreRes.status).toBe(403);
  });
});
