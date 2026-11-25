import { describe, test, expect, beforeAll } from 'vitest';
import { getAccountsReceivableSummary, getAccountsPayableSummary } from './arApTools';
import { db } from '../../../db';
import * as schema from '../../../db/schema';
import { runInTestDb } from '../../../../../tests/setup';
import { format, subDays } from 'date-fns';

describe('AI AR and AP Tools with Accounts Receivable and Payable Engines', () => {
  let companyAId: string;
  let companyBId: string;
  let customer1Id: string;
  let customer2Id: string;
  let vendor1Id: string;
  let vendor2Id: string;

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  const days15AgoStr = format(subDays(today, 15), 'yyyy-MM-dd');
  const days45AgoStr = format(subDays(today, 45), 'yyyy-MM-dd');
  const days75AgoStr = format(subDays(today, 75), 'yyyy-MM-dd');
  const days120AgoStr = format(subDays(today, 120), 'yyyy-MM-dd');

  beforeAll(async () => {
    await runInTestDb(async () => {
      companyAId = crypto.randomUUID();
      companyBId = crypto.randomUUID();

      // Insert Companies
      await db.insert(schema.companies).values([
        {
          id: companyAId,
          legalName: 'Apex Enterprise Corp.',
          tradeName: 'Apex',
          tin: '111-222-333-000',
          status: 'ACTIVE',
        },
        {
          id: companyBId,
          legalName: 'Beacon Trading Corp.',
          tradeName: 'Beacon',
          tin: '444-555-666-000',
          status: 'ACTIVE',
        },
      ]);

      // Insert Customers for Company A
      customer1Id = crypto.randomUUID();
      customer2Id = crypto.randomUUID();
      await db.insert(schema.customers).values([
        {
          id: customer1Id,
          companyId: companyAId,
          code: 'CUST-001',
          legalName: 'Alpha Client Corp.',
        },
        {
          id: customer2Id,
          companyId: companyAId,
          code: 'CUST-002',
          legalName: 'Beta Client Inc.',
        },
      ]);

      // Insert Vendors for Company A
      vendor1Id = crypto.randomUUID();
      vendor2Id = crypto.randomUUID();
      await db.insert(schema.vendors).values([
        {
          id: vendor1Id,
          companyId: companyAId,
          code: 'VEND-001',
          legalName: 'Global Supplier Services',
        },
        {
          id: vendor2Id,
          companyId: companyAId,
          code: 'VEND-002',
          legalName: 'Prime Logistics Hub',
        },
      ]);

      // Seed Invoices for Company A:
      // 1. Customer 1 - Current (Due Today) - ₱10,000 balance
      await db.insert(schema.salesInvoices).values({
        id: crypto.randomUUID(),
        companyId: companyAId,
        customerId: customer1Id,
        invoiceNumber: 'INV-CUR-01',
        invoiceDate: todayStr,
        dueDate: todayStr,
        totalAmount: 10000,
        balanceDue: 10000,
        status: 'POSTED',
      });

      // 2. Customer 1 - 1-30 Days Overdue (Due 15 days ago) - ₱20,000 balance
      await db.insert(schema.salesInvoices).values({
        id: crypto.randomUUID(),
        companyId: companyAId,
        customerId: customer1Id,
        invoiceNumber: 'INV-1-30-01',
        invoiceDate: days15AgoStr,
        dueDate: days15AgoStr,
        totalAmount: 20000,
        balanceDue: 20000,
        status: 'POSTED',
      });

      // 3. Customer 2 - 31-60 Days Overdue (Due 45 days ago) - ₱30,000 balance
      await db.insert(schema.salesInvoices).values({
        id: crypto.randomUUID(),
        companyId: companyAId,
        customerId: customer2Id,
        invoiceNumber: 'INV-31-60-01',
        invoiceDate: days45AgoStr,
        dueDate: days45AgoStr,
        totalAmount: 30000,
        balanceDue: 30000,
        status: 'POSTED',
      });

      // 4. Customer 2 - 91+ Days Overdue (Due 120 days ago) - ₱50,000 balance
      await db.insert(schema.salesInvoices).values({
        id: crypto.randomUUID(),
        companyId: companyAId,
        customerId: customer2Id,
        invoiceNumber: 'INV-91-PLUS-01',
        invoiceDate: days120AgoStr,
        dueDate: days120AgoStr,
        totalAmount: 50000,
        balanceDue: 50000,
        status: 'POSTED',
      });

      // 5. Draft Invoice (₱99,000) - MUST BE EXCLUDED
      await db.insert(schema.salesInvoices).values({
        id: crypto.randomUUID(),
        companyId: companyAId,
        customerId: customer1Id,
        invoiceNumber: 'INV-DRAFT',
        invoiceDate: todayStr,
        dueDate: todayStr,
        totalAmount: 99000,
        balanceDue: 99000,
        status: 'DRAFT',
      });

      // Seed Bills for Company A:
      // 1. Vendor 1 - Current (Due Today) - ₱8,000 balance
      await db.insert(schema.purchaseBills).values({
        id: crypto.randomUUID(),
        companyId: companyAId,
        vendorId: vendor1Id,
        billNumber: 'BILL-CUR-01',
        billDate: todayStr,
        dueDate: todayStr,
        totalAmount: 8000,
        balanceDue: 8000,
        status: 'POSTED',
      });

      // 2. Vendor 1 - 61-90 Days Overdue (Due 75 days ago) - ₱15,000 balance
      await db.insert(schema.purchaseBills).values({
        id: crypto.randomUUID(),
        companyId: companyAId,
        vendorId: vendor1Id,
        billNumber: 'BILL-61-90-01',
        billDate: days75AgoStr,
        dueDate: days75AgoStr,
        totalAmount: 15000,
        balanceDue: 15000,
        status: 'POSTED',
      });

      // 3. Vendor 2 - 91+ Days Overdue (Due 120 days ago) - ₱40,000 balance
      await db.insert(schema.purchaseBills).values({
        id: crypto.randomUUID(),
        companyId: companyAId,
        vendorId: vendor2Id,
        billNumber: 'BILL-91-PLUS-01',
        billDate: days120AgoStr,
        dueDate: days120AgoStr,
        totalAmount: 40000,
        balanceDue: 40000,
        status: 'POSTED',
      });

      // 4. Draft Bill (₱88,000) - MUST BE EXCLUDED
      await db.insert(schema.purchaseBills).values({
        id: crypto.randomUUID(),
        companyId: companyAId,
        vendorId: vendor1Id,
        billNumber: 'BILL-DRAFT',
        billDate: todayStr,
        dueDate: todayStr,
        totalAmount: 88000,
        balanceDue: 88000,
        status: 'DRAFT',
      });
    });
  });

  test('getAccountsReceivableSummary accurately computes aging brackets, overdue totals, and top customers', async () => {
    await runInTestDb(async () => {
      const summary = await getAccountsReceivableSummary({
        companyId: companyAId,
        asOfDate: todayStr,
      });

      expect(summary.companyId).toBe(companyAId);
      expect(summary.authoritativeSource).toContain('Accounts Receivable');

      // Total AR: 10,000 + 20,000 + 30,000 + 50,000 = 110,000 (Draft 99,000 excluded)
      expect(summary.totalAccountsReceivable).toBe(110000);
      expect(summary.totalCurrent).toBe(10000);
      expect(summary.totalOverdue).toBe(100000); // 20k + 30k + 50k
      expect(summary.overduePercentage).toBeCloseTo(90.91, 1);

      // Aging breakdown
      expect(summary.aging.current.amount).toBe(10000);
      expect(summary.aging.current.count).toBe(1);

      expect(summary.aging.days1_30.amount).toBe(20000);
      expect(summary.aging.days1_30.count).toBe(1);

      expect(summary.aging.days31_60.amount).toBe(30000);
      expect(summary.aging.days31_60.count).toBe(1);

      expect(summary.aging.days61_90.amount).toBe(0);
      expect(summary.aging.days61_90.count).toBe(0);

      expect(summary.aging.days91_plus.amount).toBe(50000);
      expect(summary.aging.days91_plus.count).toBe(1);

      // Invoice stats
      expect(summary.invoiceStats.totalOpenInvoices).toBe(4);
      expect(summary.invoiceStats.currentInvoices).toBe(1);
      expect(summary.invoiceStats.overdueInvoices).toBe(3);

      // Top Outstanding Customers
      // Customer 2 has 30,000 + 50,000 = 80,000
      // Customer 1 has 10,000 + 20,000 = 30,000
      expect(summary.topOutstandingCustomers.length).toBe(2);
      expect(summary.topOutstandingCustomers[0].customerId).toBe(customer2Id);
      expect(summary.topOutstandingCustomers[0].totalBalance).toBe(80000);
      expect(summary.topOutstandingCustomers[0].totalOverdue).toBe(80000);
      expect(summary.topOutstandingCustomers[1].customerId).toBe(customer1Id);
      expect(summary.topOutstandingCustomers[1].totalBalance).toBe(30000);
      expect(summary.topOutstandingCustomers[1].current).toBe(10000);
      expect(summary.topOutstandingCustomers[1].totalOverdue).toBe(20000);
    });
  });

  test('getAccountsPayableSummary accurately computes aging brackets, overdue totals, and top vendors', async () => {
    await runInTestDb(async () => {
      const summary = await getAccountsPayableSummary({
        companyId: companyAId,
        asOfDate: todayStr,
      });

      expect(summary.companyId).toBe(companyAId);
      expect(summary.authoritativeSource).toContain('Accounts Payable');

      // Total AP: 8,000 + 15,000 + 40,000 = 63,000 (Draft 88,000 excluded)
      expect(summary.totalAccountsPayable).toBe(63000);
      expect(summary.totalCurrent).toBe(8000);
      expect(summary.totalOverdue).toBe(55000); // 15k + 40k
      expect(summary.overduePercentage).toBeCloseTo(87.3, 1);

      // Aging breakdown
      expect(summary.aging.current.amount).toBe(8000);
      expect(summary.aging.current.count).toBe(1);

      expect(summary.aging.days1_30.amount).toBe(0);
      expect(summary.aging.days31_60.amount).toBe(0);

      expect(summary.aging.days61_90.amount).toBe(15000);
      expect(summary.aging.days61_90.count).toBe(1);

      expect(summary.aging.days91_plus.amount).toBe(40000);
      expect(summary.aging.days91_plus.count).toBe(1);

      // Bill stats
      expect(summary.billStats.totalOpenBills).toBe(3);
      expect(summary.billStats.currentBills).toBe(1);
      expect(summary.billStats.overdueBills).toBe(2);

      // Top Outstanding Vendors
      // Vendor 2: 40,000
      // Vendor 1: 8,000 + 15,000 = 23,000
      expect(summary.topOutstandingVendors.length).toBe(2);
      expect(summary.topOutstandingVendors[0].vendorId).toBe(vendor2Id);
      expect(summary.topOutstandingVendors[0].totalBalance).toBe(40000);
      expect(summary.topOutstandingVendors[0].totalOverdue).toBe(40000);
      expect(summary.topOutstandingVendors[1].vendorId).toBe(vendor1Id);
      expect(summary.topOutstandingVendors[1].totalBalance).toBe(23000);
      expect(summary.topOutstandingVendors[1].current).toBe(8000);
      expect(summary.topOutstandingVendors[1].totalOverdue).toBe(15000);
    });
  });

  test('Multi-tenant isolation holds for AR and AP summaries', async () => {
    await runInTestDb(async () => {
      const summaryB_AR = await getAccountsReceivableSummary({ companyId: companyBId });
      const summaryB_AP = await getAccountsPayableSummary({ companyId: companyBId });

      expect(summaryB_AR.totalAccountsReceivable).toBe(0);
      expect(summaryB_AR.topOutstandingCustomers.length).toBe(0);

      expect(summaryB_AP.totalAccountsPayable).toBe(0);
      expect(summaryB_AP.topOutstandingVendors.length).toBe(0);
    });
  });
});
