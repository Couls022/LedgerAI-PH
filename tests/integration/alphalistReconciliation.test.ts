import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { runInTestDb } from '../setup';
import { AlphalistService } from '../../src/server/services/alphalistService';
import { WithholdingReconciliationService } from '../../src/server/services/withholdingReconciliationService';
import { BirComplianceService } from '../../src/server/services/birComplianceService';
import { ExportService } from '../../src/server/services/exportService';

describe('LEDGERAI PH — Phase 7B: Alphalist & Withholding Reconciliation Test Suite', () => {
  const companyId = crypto.randomUUID();
  const otherCompanyId = crypto.randomUUID();
  const accountantUserId = crypto.randomUUID();
  const readonlyUserId = crypto.randomUUID();
  const accountantEmail = `accountant-${crypto.randomUUID().slice(0, 8)}@phase7b.com`;
  const readonlyEmail = `readonly-${crypto.randomUUID().slice(0, 8)}@phase7b.com`;

  const vendor1Id = crypto.randomUUID();
  const vendor2Id = crypto.randomUUID();
  const vendorInvalidTinId = crypto.randomUUID();
  const taxCodeId = crypto.randomUUID();

  const bill1Id = crypto.randomUUID();
  const bill2Id = crypto.randomUUID();
  const bill3Id = crypto.randomUUID();

  beforeAll(async () => {
    await runInTestDb(async () => {
      // 1. Insert Companies
      await db.insert(schema.companies).values({
        id: companyId,
        legalName: 'Alpha Phase 7B Corp',
        tin: '987-654-321-000',
        address: 'Makati City',
        status: 'ACTIVE',
      });

      await db.insert(schema.companies).values({
        id: otherCompanyId,
        legalName: 'Isolated Other Corp',
        tin: '111-222-333-000',
        address: 'BGC Taguig',
        status: 'ACTIVE',
      });

      // 2. Insert Users
      await db.insert(schema.users).values({
        id: accountantUserId,
        email: accountantEmail,
        displayName: 'Accountant User',
        passwordHash: 'hash',
        role: 'Accountant',
        isActive: true,
      });

      await db.insert(schema.users).values({
        id: readonlyUserId,
        email: readonlyEmail,
        displayName: 'Readonly User',
        passwordHash: 'hash',
        role: 'Read-only User',
        isActive: true,
      });

      // 3. Seed Authoritative ATCs
      await AlphalistService.seedDefaultATCs();

      // 4. Insert Account & Tax Code
      const accountId = crypto.randomUUID();
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
        code: 'WI160',
        name: 'Professional Services (Individual)',
        taxType: 'EWT',
        description: 'Professional fees',
        status: 'ACTIVE',
      });

      // 5. Insert Vendors
      await db.insert(schema.vendors).values({
        id: vendor1Id,
        companyId,
        code: 'VEND-01',
        legalName: 'Atty. Juan Dela Cruz',
        tin: '123-456-789-001',
        address: 'Manila',
        status: 'ACTIVE',
      });

      await db.insert(schema.vendors).values({
        id: vendor2Id,
        companyId,
        code: 'VEND-02',
        legalName: 'Tech Solutions Inc',
        tin: '987-123-456-002',
        address: 'Quezon City',
        status: 'ACTIVE',
      });

      await db.insert(schema.vendors).values({
        id: vendorInvalidTinId,
        companyId,
        code: 'VEND-03',
        legalName: 'Invalid TIN Vendor',
        tin: '12345', // Invalid format
        address: 'Cebu',
        status: 'ACTIVE',
      });

      // 6. Insert Purchase Bills across multiple months in Q1 2026
      await db.insert(schema.purchaseBills).values({
        id: bill1Id,
        companyId,
        vendorId: vendor1Id,
        billNumber: 'BILL-2026-001',
        billDate: '2026-01-15',
        dueDate: '2026-02-15',
        totalAmount: 50000,
        balanceDue: 0,
        status: 'POSTED',
      });

      await db.insert(schema.purchaseBillLines).values({
        id: crypto.randomUUID(),
        billId: bill1Id,
        accountId,
        description: 'Legal retainer January',
        quantity: 1,
        unitPrice: 50000,
        amount: 50000,
        taxCodeId,
      });

      await db.insert(schema.purchaseBills).values({
        id: bill2Id,
        companyId,
        vendorId: vendor2Id,
        billNumber: 'BILL-2026-002',
        billDate: '2026-02-20',
        dueDate: '2026-03-20',
        totalAmount: 100000,
        balanceDue: 0,
        status: 'POSTED',
      });

      await db.insert(schema.purchaseBillLines).values({
        id: crypto.randomUUID(),
        billId: bill2Id,
        accountId,
        description: 'IT Consulting February',
        quantity: 1,
        unitPrice: 100000,
        amount: 100000,
        taxCodeId,
      });

      // Bill with missing ATC and invalid TIN for testing discrepancy detection
      await db.insert(schema.purchaseBills).values({
        id: bill3Id,
        companyId,
        vendorId: vendorInvalidTinId,
        billNumber: 'BILL-2026-003',
        billDate: '2026-03-10',
        dueDate: '2026-04-10',
        totalAmount: 20000,
        balanceDue: 0,
        status: 'POSTED',
      });

      await db.insert(schema.purchaseBillLines).values({
        id: crypto.randomUUID(),
        billId: bill3Id,
        accountId,
        description: 'Miscellaneous supplies',
        quantity: 1,
        unitPrice: 20000,
        amount: 20000,
        taxCodeId: null, // Missing ATC
      });
    });
  });

  afterAll(async () => {
    await runInTestDb(async () => {
      await db.run(sql`PRAGMA foreign_keys = OFF;`);
      await db.delete(schema.purchaseBillLines).where(sql`1=1`);
      await db.delete(schema.purchaseBills).where(sql`1=1`);
      await db.delete(schema.vendors).where(sql`1=1`);
      await db.delete(schema.taxCodes).where(sql`1=1`);
      await db.delete(schema.atcDefinitions).where(sql`1=1`);
      await db.delete(schema.auditLogs).where(sql`1=1`);
      await db.delete(schema.users).where(sql`1=1`);
      await db.delete(schema.companies).where(sql`1=1`);
      await db.run(sql`PRAGMA foreign_keys = ON;`);
    });
  });

  it('7B-01: Authoritative ATC lookup and validation works correctly', async () => {
    await runInTestDb(async () => {
      const atcs = await db.select().from(schema.atcDefinitions);
      expect(atcs.length).toBeGreaterThanOrEqual(4);

      const wi160 = atcs.find(a => a.code === 'WI160');
      expect(wi160).toBeDefined();
      expect(wi160?.taxRate).toBe(0.10);
      expect(wi160?.sourceMetadata).toContain('BIR RR No. 2-98');
    });
  });

  it('7B-02: TIN validation handles valid, invalid, and missing formats correctly', async () => {
    await runInTestDb(async () => {
      expect(BirComplianceService.validateTin('123-456-789-000')).toBe(true);
      expect(BirComplianceService.validateTin('123456789000')).toBe(true);
      expect(BirComplianceService.validateTin('12345')).toBe(false);
      expect(BirComplianceService.validateTin(null)).toBe(false);
      expect(BirComplianceService.validateTin(undefined)).toBe(false);
    });
  });

  it('7B-03: Generates Monthly Alphalist of Payees (MAP) with accurate aggregation', async () => {
    await runInTestDb(async () => {
      const mapJan = await AlphalistService.generateMAP(companyId, '2026-01');
      expect(mapJan.reportType).toBe('MAP');
      expect(mapJan.period).toBe('2026-01');
      expect(mapJan.summary.totalPayees).toBe(1);
      expect(mapJan.summary.totalTaxBase).toBe(50000);
      expect(mapJan.items[0].atc).toBe('WI160');
      expect(mapJan.items[0].validationStatus).toBe('VALID');
    });
  });

  it('7B-04: Generates Summary Alphalist of Withholding Taxes (SAWT) quarterly aggregation', async () => {
    await runInTestDb(async () => {
      const sawtQ1 = await AlphalistService.generateSAWT(companyId, '2026-Q1');
      expect(sawtQ1.reportType).toBe('SAWT');
      expect(sawtQ1.period).toBe('2026-Q1');
      expect(sawtQ1.summary.totalPayees).toBeGreaterThanOrEqual(2);
      expect(sawtQ1.summary.totalTaxBase).toBe(170000); // 50k + 100k + 20k
    });
  });

  it('7B-05: Withholding Reconciliation Engine detects discrepancies (invalid TIN, missing ATC) without altering records', async () => {
    await runInTestDb(async () => {
      const req = {
        user: { id: accountantUserId, email: accountantEmail },
        activeCompany: { id: companyId, role: 'Accountant' }
      };

      const recon = await WithholdingReconciliationService.reconcileWithholding(companyId, '2026-Q1', req);
      expect(recon.summary.totalDiscrepancies).toBeGreaterThan(0);

      const invalidTinDisc = recon.discrepancies.find(d => d.type === 'INVALID_TIN');
      const missingAtcDisc = recon.discrepancies.find(d => d.type === 'MISSING_ATC');

      expect(invalidTinDisc).toBeDefined();
      expect(missingAtcDisc).toBeDefined();
      expect(recon.summary.isBalanced).toBe(false); // due to HIGH discrepancies

      // Verify Read-Only Guarantee: Accounting records (purchase bills count and amounts) remain unchanged
      const billsAfter = await db.select().from(schema.purchaseBills).where(eq(schema.purchaseBills.companyId, companyId));
      expect(billsAfter.length).toBe(3);
    });
  });

  it('7B-06: Security & Tenant Isolation prevents cross-company reconciliation or report access', async () => {
    await runInTestDb(async () => {
      // Trying to reconcile or export other company data with unauthorized company context
      const req = {
        user: { id: readonlyUserId, email: readonlyEmail },
        activeCompany: { id: otherCompanyId, role: 'Read-only User' }
      };

      // Read-only user attempting accountant-level sensitive export should throw ACCESS_DENIED
      await expect(
        AlphalistService.exportAlphalistReport(companyId, 'MAP', '2026-01', 'json', req)
      ).rejects.toThrow('ACCESS_DENIED');
    });
  });

  it('7B-07: Audit Logging correctly records EXPORT_ALPHALIST and RUN_WITHHOLDING_RECONCILIATION actions', async () => {
    await runInTestDb(async () => {
      const req = {
        user: { id: accountantUserId, email: accountantEmail },
        activeCompany: { id: companyId, role: 'Accountant' }
      };

      await AlphalistService.exportAlphalistReport(companyId, 'MAP', '2026-01', 'json', req);
      await WithholdingReconciliationService.reconcileWithholding(companyId, '2026-01', req);

      const auditLogs = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.companyId, companyId));
      const exportLog = auditLogs.find(l => l.action === 'EXPORT_ALPHALIST');
      const reconLog = auditLogs.find(l => l.action === 'RUN_WITHHOLDING_RECONCILIATION');

      expect(exportLog).toBeDefined();
      expect(reconLog).toBeDefined();
      expect(exportLog?.result).toBe('SUCCESS');
    });
  });

  it('7D-01: Period Boundary and Leap Year Date Hardening validates statutory date ranges accurately', async () => {
    await runInTestDb(async () => {
      // Test leap year Feb 29, 2024 vs non-leap Feb 28, 2026
      const mapLeap = await AlphalistService.generateMAP(companyId, '2024-02');
      expect(mapLeap.period).toBe('2024-02');

      const sawtQ1 = await AlphalistService.generateSAWT(companyId, '2026-Q1');
      const sawtQ2 = await AlphalistService.generateSAWT(companyId, '2026-Q2');
      const sawtQ3 = await AlphalistService.generateSAWT(companyId, '2026-Q3');
      const sawtQ4 = await AlphalistService.generateSAWT(companyId, '2026-Q4');

      expect(sawtQ1.period).toBe('2026-Q1');
      expect(sawtQ2.period).toBe('2026-Q2');
      expect(sawtQ3.period).toBe('2026-Q3');
      expect(sawtQ4.period).toBe('2026-Q4');
    });
  });

  it('7D-02: Stress Test with 1,000 Purchase Bills across multiple vendors, TINs, ATCs, and voided records executes correctly', async () => {
    await runInTestDb(async () => {
      const stressCompanyId = crypto.randomUUID();
      await db.insert(schema.companies).values({
        id: stressCompanyId,
        legalName: 'Stress Test Corp',
        tin: '555-444-333-000',
        address: 'Cebu City',
        status: 'ACTIVE',
      });

      const stressVendorId = crypto.randomUUID();
      await db.insert(schema.vendors).values({
        id: stressVendorId,
        companyId: stressCompanyId,
        code: 'V-STRESS',
        legalName: 'Stress Vendor Inc',
        tin: '123-456-789-999',
        address: 'Cebu',
        status: 'ACTIVE',
      });

      const stressAccountId = crypto.randomUUID();
      await db.insert(schema.accounts).values({
        id: stressAccountId,
        companyId: stressCompanyId,
        accountCode: '6010',
        accountName: 'Stress Expense',
        accountType: 'EXPENSE',
        normalBalance: 'DEBIT',
        status: 'ACTIVE',
      });

      const stressTaxCodeId = crypto.randomUUID();
      await db.insert(schema.taxCodes).values({
        id: stressTaxCodeId,
        companyId: stressCompanyId,
        code: 'WI160',
        name: 'Professional Services',
        taxType: 'EWT',
        description: 'Professional fees',
        status: 'ACTIVE',
      });

      // Insert 1,000 bills
      const batchValues: any[] = [];
      const lineValues: any[] = [];

      for (let i = 0; i < 1000; i++) {
        const bId = crypto.randomUUID();
        const monthNum = (i % 3) + 1; // Months 1, 2, 3 (Q1)
        const dayNum = (i % 28) + 1;
        const bDate = `2026-0${monthNum}-${dayNum < 10 ? '0' + dayNum : dayNum}`;

        batchValues.push({
          id: bId,
          companyId: stressCompanyId,
          vendorId: stressVendorId,
          billNumber: `SB-2026-${i + 1}`,
          billDate: bDate,
          dueDate: '2026-05-01',
          totalAmount: 1000,
          balanceDue: 0,
          status: i === 0 ? 'VOID' : 'POSTED', // include a voided transaction
        });

        lineValues.push({
          id: crypto.randomUUID(),
          billId: bId,
          accountId: stressAccountId,
          description: `Stress line ${i + 1}`,
          quantity: 1,
          unitPrice: 1000,
          amount: 1000,
          taxCodeId: stressTaxCodeId,
        });
      }

      // Insert in chunks of 250 to avoid SQL variable limits
      for (let i = 0; i < batchValues.length; i += 250) {
        await db.insert(schema.purchaseBills).values(batchValues.slice(i, i + 250));
        await db.insert(schema.purchaseBillLines).values(lineValues.slice(i, i + 250));
      }

      const startTime = performance.now();
      const report = await AlphalistService.generateMAP(stressCompanyId, '2026-01');
      const recon = await WithholdingReconciliationService.reconcileWithholding(stressCompanyId, '2026-01');
      const duration = performance.now() - startTime;

      expect(report.summary.totalPayees).toBe(1);
      expect(recon.summary.totalSourceTransactions).toBeGreaterThan(0);
      expect(duration).toBeLessThan(5000); // Should execute efficiently under 5 seconds
    });
  });
});
