import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { runInTestDb } from '../setup';
import { BirComplianceService } from '../../src/server/services/birComplianceService';
import { ExportService } from '../../src/server/services/exportService';

describe('LEDGERAI PH — Phase 7A: BIR Compliance & Books of Accounts Test Suite', () => {
  const companyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const userEmail = `accountant-${crypto.randomUUID().slice(0, 8)}@birtest.com`;
  const vendor1Id = crypto.randomUUID();
  const vendor2Id = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  const taxCodeId = crypto.randomUUID();
  const bill1Id = crypto.randomUUID();
  const bill2Id = crypto.randomUUID();
  const bill3Id = crypto.randomUUID();
  const billLine1Id = crypto.randomUUID();
  const billLine2Id = crypto.randomUUID();
  const billLine3Id = crypto.randomUUID();
  const journal1Id = crypto.randomUUID();
  const journalLine1Id = crypto.randomUUID();
  const journalLine2Id = crypto.randomUUID();

  beforeAll(async () => {
    await runInTestDb(async () => {
      // 1. Insert Company
      await db.insert(schema.companies).values({
        id: companyId,
        legalName: 'BIR Test Enterprise Inc',
        tin: '123-456-789-000',
        address: '123 Ayala Ave, Makati',
        taxpayerClassification: 'CORPORATE',
        vatStatus: 'VAT_REGISTERED',
        documentLocationPath: '',
        backupLocationPath: '',
        status: 'ACTIVE',
      });

      // 2. Insert User
      await db.insert(schema.users).values({
        id: userId,
        email: userEmail,
        displayName: 'Chief Accountant',
        passwordHash: 'hash',
        role: 'Accountant',
        isActive: true,
      });

      // 3. Insert Vendors (with valid and invalid TINs)
      await db.insert(schema.vendors).values({
        id: vendor1Id,
        companyId,
        code: 'VEND01',
        legalName: 'Alpha Supplies Corp',
        tin: '987-654-321-000',
        address: 'Quezon City',
        vatStatus: 'VAT_REGISTERED',
      });

      await db.insert(schema.vendors).values({
        id: vendor2Id,
        companyId,
        code: 'VEND02',
        legalName: 'Beta Services Unregistered',
        tin: 'INVALID_TIN', // Invalid TIN for validation testing
        address: 'Manila',
        vatStatus: 'NON_VAT',
      });

      // 4. Insert Account & Tax Code
      await db.insert(schema.accounts).values({
        id: accountId,
        companyId,
        accountCode: '5010',
        accountName: 'Operating Expenses',
        accountType: 'EXPENSE',
        normalBalance: 'DEBIT',
        status: 'ACTIVE',
      });

      await db.insert(schema.taxCodes).values({
        id: taxCodeId,
        companyId,
        code: 'WC160', // Professional Services EWT 10% or similar
        name: 'Expanded Withholding Tax - Professional',
        taxType: 'EWT',
        inputOutputDirection: 'INPUT',
      });

      // 5. Insert Posted Purchase Bills across different months in quarter (Jan = Month 1, Feb = Month 2, Mar = Month 3)
      await db.insert(schema.purchaseBills).values({
        id: bill1Id,
        companyId,
        vendorId: vendor1Id,
        billNumber: 'BILL-2026-001',
        billDate: '2026-01-15', // Month 1
        totalAmount: 112000, // 1,120.00 PHP in centavos (gross)
        balanceDue: 0,
        status: 'POSTED',
      });

      await db.insert(schema.purchaseBillLines).values({
        id: billLine1Id,
        billId: bill1Id,
        accountId,
        taxCodeId,
        description: 'Consulting Q1 Month 1',
        quantity: 1,
        unitPrice: 100000,
        amount: 100000,
      });

      await db.insert(schema.purchaseBills).values({
        id: bill2Id,
        companyId,
        vendorId: vendor1Id,
        billNumber: 'BILL-2026-002',
        billDate: '2026-02-20', // Month 2
        totalAmount: 224000,
        balanceDue: 0,
        status: 'POSTED',
      });

      await db.insert(schema.purchaseBillLines).values({
        id: billLine2Id,
        billId: bill2Id,
        accountId,
        taxCodeId,
        description: 'Consulting Q1 Month 2',
        quantity: 1,
        unitPrice: 200000,
        amount: 200000,
      });

      // Bill for Vendor 2 (Missing / Invalid TIN test)
      await db.insert(schema.purchaseBills).values({
        id: bill3Id,
        companyId,
        vendorId: vendor2Id,
        billNumber: 'BILL-2026-003',
        billDate: '2026-01-20',
        totalAmount: 50000,
        balanceDue: 0,
        status: 'POSTED',
      });

      await db.insert(schema.purchaseBillLines).values({
        id: billLine3Id,
        billId: bill3Id,
        accountId,
        description: 'Minor repairs',
        quantity: 1,
        unitPrice: 50000,
        amount: 50000,
      });

      // 6. Insert Posted Journal Entry for Books of Accounts testing
      await db.insert(schema.journalEntries).values({
        id: journal1Id,
        companyId,
        journalNumber: 'JV-2026-001',
        entryDate: '2026-01-15',
        description: 'Test Journal Entry',
        sourceType: 'GENERAL',
        status: 'POSTED',
        createdBy: userId,
      });

      await db.insert(schema.journalLines).values({
        id: journalLine1Id,
        journalEntryId: journal1Id,
        accountId,
        description: 'Debit expense',
        debit: 50000,
        credit: 0,
        lineNumber: 1,
      });

      await db.insert(schema.journalLines).values({
        id: journalLine2Id,
        journalEntryId: journal1Id,
        accountId,
        description: 'Credit cash',
        debit: 0,
        credit: 50000,
        lineNumber: 2,
      });
    });
  });

  afterAll(async () => {
    await runInTestDb(async () => {
      await db.run(sql`PRAGMA foreign_keys = OFF;`);
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.companyId, companyId));
      await db.delete(schema.purchaseBillLines).where(eq(schema.purchaseBillLines.id, billLine1Id));
      await db.delete(schema.purchaseBillLines).where(eq(schema.purchaseBillLines.id, billLine2Id));
      await db.delete(schema.purchaseBillLines).where(eq(schema.purchaseBillLines.id, billLine3Id));
      await db.delete(schema.purchaseBills).where(eq(schema.purchaseBills.id, bill1Id));
      await db.delete(schema.purchaseBills).where(eq(schema.purchaseBills.id, bill2Id));
      await db.delete(schema.purchaseBills).where(eq(schema.purchaseBills.id, bill3Id));
      await db.delete(schema.taxCodes).where(eq(schema.taxCodes.id, taxCodeId));
      await db.delete(schema.journalLines).where(eq(schema.journalLines.id, journalLine1Id));
      await db.delete(schema.journalLines).where(eq(schema.journalLines.id, journalLine2Id));
      await db.delete(schema.journalEntries).where(eq(schema.journalEntries.id, journal1Id));
      await db.delete(schema.accounts).where(eq(schema.accounts.id, accountId));
      await db.delete(schema.vendors).where(eq(schema.vendors.id, vendor1Id));
      await db.delete(schema.vendors).where(eq(schema.vendors.id, vendor2Id));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
      await db.run(sql`PRAGMA foreign_keys = ON;`);
    });
  });

  it('AC-01: Generates BIR Form 2307 data with accurate 3-month quarterly breakdown and explicit ATC validation', async () => {
    await runInTestDb(async () => {
      const result = await BirComplianceService.generateForm2307Data(companyId, '2026-01-01', '2026-03-31');
      expect(result.payor.name).toBe('BIR Test Enterprise Inc');
      expect(result.lineItems.length).toBe(2); // Alpha and Beta

      const alphaItem = result.lineItems.find(i => i.payeeName === 'Alpha Supplies Corp');
      expect(alphaItem).toBeDefined();
      expect(alphaItem!.atc).toBe('WC160');
      expect(alphaItem!.month1Base).toBe(100000);
      expect(alphaItem!.month2Base).toBe(200000);
      expect(alphaItem!.month3Base).toBe(0);
      expect(alphaItem!.totalTaxBase).toBe(300000);
      expect(alphaItem!.validationStatus).toBe('VALID');
    });
  });

  it('AC-02: Generates Computerized Books of Accounts from posted journal entries with correct running balances', async () => {
    await runInTestDb(async () => {
      const entries = await BirComplianceService.generateBookOfAccounts(companyId, 'GENERAL_LEDGER', '2026-01-01', '2026-03-31');
      expect(entries.length).toBe(2);
      expect(entries[0].debit).toBe(50000);
      expect(entries[0].credit).toBe(0);
      expect(entries[0].runningBalance).toBe(50000);
      expect(entries[1].credit).toBe(50000);
      expect(entries[1].runningBalance).toBe(0);
    });
  });

  it('AC-03: Generates VAT / SADPGS summary correctly with supplier TIN validation', async () => {
    await runInTestDb(async () => {
      const summary = await BirComplianceService.generateVatSummary(companyId, '2026-01-01', '2026-03-31');
      expect(summary.purchases.length).toBe(3); // 2 for alpha, 1 for beta
      const validPurchase = summary.purchases.find(p => p.partnerName === 'Alpha Supplies Corp');
      expect(validPurchase).toBeDefined();
      expect(validPurchase!.validationStatus).toBe('VALID');

      const invalidPurchase = summary.purchases.find(p => p.partnerName === 'Beta Services Unregistered');
      expect(invalidPurchase).toBeDefined();
      expect(invalidPurchase!.validationStatus).toBe('MISSING_TIN');
    });
  });

  it('AC-04: Enforces RBAC permissions and blocks unauthorized roles (Read-only User) with ACCESS_DENIED', async () => {
    await runInTestDb(async () => {
      const req = {
        activeCompany: { id: companyId, role: 'Read-only User' },
        user: { id: userId, email: 'readonly@test.com' }
      };

      const exportOptions = {
        companyId,
        companyName: 'BIR Test Enterprise Inc',
        reportTitle: 'Sensitive Tax Export',
        generatedBy: 'Read-only User',
        headers: ['Col1'],
        rows: [['Val1']],
        userRole: 'Read-only User',
        requiredRole: 'Accountant',
        isSensitive: true,
        req,
      };

      expect(() => {
        ExportService.verifyAccess(exportOptions);
      }).toThrow(/ACCESS_DENIED/);
    });
  });

  it('AC-05: Records successful exports in the audit trail via application audit logging', async () => {
    await runInTestDb(async () => {
      const req = {
        activeCompany: { id: companyId, role: 'Accountant' },
        user: { id: userId, email: userEmail }
      };

      const exportOptions = {
        companyId,
        companyName: 'BIR Test Enterprise Inc',
        reportTitle: 'BIR Form 2307 Summary',
        generatedBy: 'Chief Accountant',
        headers: ['Payee', 'Total'],
        rows: [['Alpha', '3000.00']],
        userRole: 'Accountant',
        requiredRole: 'Accountant',
        isSensitive: true,
        req,
      };

      await ExportService.recordExportAudit(exportOptions, 'json');

      const auditLogs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.companyId, companyId));
      const exportLog = auditLogs.find(l => l.action === 'EXPORT_REPORT' && l.entityName === 'BIR Form 2307 Summary');
      expect(exportLog).toBeDefined();
      expect(exportLog!.result).toBe('SUCCESS');
    });
  });
});
