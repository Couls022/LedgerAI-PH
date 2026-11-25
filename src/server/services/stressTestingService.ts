import { CompanyManager } from './companyManager';
import { db } from '../db';
import { dbContext } from '../db/context';
import * as schema from '../db/schema';
import { eq, sql, and } from 'drizzle-orm';
import crypto from 'crypto';
import { AuditService } from './auditService';
import { TaxEngine } from './taxEngine';
import {
  createJournalEntry,
  updateJournalEntry,
  submitJournalEntry,
  approveJournalEntry,
  rejectJournalEntry,
  postJournalEntry,
  reverseJournalEntry
} from '../db/domain';

export interface SubmoduleRecordBreakdown {
  customers: number;
  vendors: number;
  chartOfAccounts: number;
  banks: number;
  departments: number;
  costCenters: number;
  salesInvoices: number;
  salesInvoiceLines: number;
  customerPayments: number;
  purchaseBills: number;
  purchaseBillLines: number;
  supplierPayments: number;
  purchaseOrders: number;
  goodsReceiptNotes: number;
  inventoryItems: number;
  inventoryTransactions: number;
  stockAdjustments: number;
  cashTransactions: number;
  cashTransactionLines: number;
  checks: number;
  bankDeposits: number;
  bankReconciliations: number;
  bankStatementLines: number;
  fixedAssets: number;
  depreciationSchedules: number;
  employees: number;
  payrollRuns: number;
  payrollItems: number;
  budgets: number;
  documents: number;
  taxCalendar: number;
  taxFilings: number;
  approvalWorkflows: number;
  approvalSteps: number;
  notifications: number;
  journalEntries: number;
  journalLines: number;
  auditLogs: number;
}

export interface StressTestExecutionResult {
  companyId: string;
  companyName: string;
  durationMs: number;
  totalRecordsCreated: number;
  breakdown: SubmoduleRecordBreakdown;
  integrityCheck: {
    totalDebits: number;
    totalCredits: number;
    discrepancy: number;
    balanced: boolean;
  };
  auditJourneyEventsLogged: number;
  success: boolean;
  error?: string;
}

export class StressTestingService {
  /**
   * Generates maximum volume of input data across ALL 16 ERP modules and all submodules
   * for a target company database.
   */
  static async populateCompanySubmodules(
    companyId: string,
    companyName: string,
    options: { maxVolume?: boolean; volumeMultiplier?: number } = {}
  ): Promise<{ breakdown: SubmoduleRecordBreakdown; totalRecords: number; auditEvents: number; integrity: any }> {
    const mult = Math.max(1, options.volumeMultiplier || (options.maxVolume ? 2 : 1));

    const breakdown: SubmoduleRecordBreakdown = {
      customers: 0,
      vendors: 0,
      chartOfAccounts: 0,
      banks: 0,
      departments: 0,
      costCenters: 0,
      salesInvoices: 0,
      salesInvoiceLines: 0,
      customerPayments: 0,
      purchaseBills: 0,
      purchaseBillLines: 0,
      supplierPayments: 0,
      purchaseOrders: 0,
      goodsReceiptNotes: 0,
      inventoryItems: 0,
      inventoryTransactions: 0,
      stockAdjustments: 0,
      cashTransactions: 0,
      cashTransactionLines: 0,
      checks: 0,
      bankDeposits: 0,
      bankReconciliations: 0,
      bankStatementLines: 0,
      fixedAssets: 0,
      depreciationSchedules: 0,
      employees: 0,
      payrollRuns: 0,
      payrollItems: 0,
      budgets: 0,
      documents: 0,
      taxCalendar: 0,
      taxFilings: 0,
      approvalWorkflows: 0,
      approvalSteps: 0,
      notifications: 0,
      journalEntries: 0,
      journalLines: 0,
      auditLogs: 0,
    };

    let auditEventsCount = 0;

    // A. Create system stress test admin, approver & auditor users
    const adminId = `usr-st-admin-${crypto.randomUUID().slice(0, 8)}`;
    const approverId = `usr-st-approver-${crypto.randomUUID().slice(0, 8)}`;
    const auditorId = `usr-st-auditor-${crypto.randomUUID().slice(0, 8)}`;
    const validStressHash = '$2b$10$wT.f5rG8e5M3q/m2s4V9Xu7yE8H1z0C6k3p9R2n4L5v8J1w0Q3a6G';

    await db.insert(schema.users).values([
      {
        id: adminId,
        email: `admin.stress.${crypto.randomUUID().slice(0, 4)}@ledgerai.ph`,
        passwordHash: validStressHash,
        displayName: 'Juan Dela Cruz (Enterprise Preparer)',
        status: 'ACTIVE'
      },
      {
        id: approverId,
        email: `approver.stress.${crypto.randomUUID().slice(0, 4)}@ledgerai.ph`,
        passwordHash: validStressHash,
        displayName: 'Pedro Reyes (Finance Director / Approver)',
        status: 'ACTIVE'
      },
      {
        id: auditorId,
        email: `auditor.stress.${crypto.randomUUID().slice(0, 4)}@ledgerai.ph`,
        passwordHash: validStressHash,
        displayName: 'Maria Santos (Senior Partner / CPA)',
        status: 'ACTIVE'
      }
    ]).onConflictDoNothing();

    await db.insert(schema.companyUsers).values([
      {
        id: `cu-${companyId.slice(-6)}-admin-${crypto.randomUUID().slice(0, 4)}`,
        companyId,
        userId: adminId,
        legacyRole: 'Company Administrator',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE'
      },
      {
        id: `cu-${companyId.slice(-6)}-approver-${crypto.randomUUID().slice(0, 4)}`,
        companyId,
        userId: approverId,
        legacyRole: 'Approver',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE'
      },
      {
        id: `cu-${companyId.slice(-6)}-auditor-${crypto.randomUUID().slice(0, 4)}`,
        companyId,
        userId: auditorId,
        legacyRole: 'Auditor',
        status: 'ACTIVE',
        membershipStatus: 'ACTIVE'
      }
    ]).onConflictDoNothing();

    // B. Ensure Philippine Standard Chart of Accounts (COA)
    const standardCOA = [
      { code: '1010', name: 'Cash in Bank - BDO Corporate', type: 'ASSET', normal: 'DEBIT', isCash: true, isTax: false, isCtrl: false },
      { code: '1015', name: 'Cash in Bank - BPI Operating', type: 'ASSET', normal: 'DEBIT', isCash: true, isTax: false, isCtrl: false },
      { code: '1020', name: 'Petty Cash Fund', type: 'ASSET', normal: 'DEBIT', isCash: true, isTax: false, isCtrl: false },
      { code: '1030', name: 'Accounts Receivable', type: 'RECEIVABLE', normal: 'DEBIT', isCash: false, isTax: false, isCtrl: true },
      { code: '1050', name: 'Input VAT (12%)', type: 'ASSET', normal: 'DEBIT', isCash: false, isTax: true, isCtrl: false },
      { code: '1060', name: 'Creditable Withholding Tax (Form 2307 Credits)', type: 'ASSET', normal: 'DEBIT', isCash: false, isTax: true, isCtrl: false },
      { code: '1400', name: 'Merchandise Inventory', type: 'INVENTORY', normal: 'DEBIT', isCash: false, isTax: false, isCtrl: false },
      { code: '1500', name: 'Office Equipment & Laptops', type: 'FIXED_ASSET', normal: 'DEBIT', isCash: false, isTax: false, isCtrl: false },
      { code: '1510', name: 'Accumulated Depreciation - Office Equipment', type: 'FIXED_ASSET', normal: 'CREDIT', isCash: false, isTax: false, isCtrl: false },
      { code: '1520', name: 'Delivery Vehicles & Vans', type: 'FIXED_ASSET', normal: 'DEBIT', isCash: false, isTax: false, isCtrl: false },
      { code: '1530', name: 'Accumulated Depreciation - Vehicles', type: 'FIXED_ASSET', normal: 'CREDIT', isCash: false, isTax: false, isCtrl: false },
      { code: '2010', name: 'Accounts Payable', type: 'PAYABLE', normal: 'CREDIT', isCash: false, isTax: false, isCtrl: true },
      { code: '2020', name: 'Output VAT (12%)', type: 'PAYABLE', normal: 'CREDIT', isCash: false, isTax: true, isCtrl: false },
      { code: '2030', name: 'Expanded Withholding Tax (EWT 0619-E / 1601-EQ)', type: 'PAYABLE', normal: 'CREDIT', isCash: false, isTax: true, isCtrl: false },
      { code: '2040', name: 'Withholding Tax on Compensation (1601-C)', type: 'PAYABLE', normal: 'CREDIT', isCash: false, isTax: true, isCtrl: false },
      { code: '2050', name: 'SSS, PhilHealth & HDMF Contributions Payable', type: 'PAYABLE', normal: 'CREDIT', isCash: false, isTax: false, isCtrl: false },
      { code: '3010', name: 'Common Share Capital', type: 'EQUITY', normal: 'CREDIT', isCash: false, isTax: false, isCtrl: false },
      { code: '3020', name: 'Retained Earnings', type: 'EQUITY', normal: 'CREDIT', isCash: false, isTax: false, isCtrl: false },
      { code: '4010', name: 'Sales Revenue - Commercial Enterprise', type: 'REVENUE', normal: 'CREDIT', isCash: false, isTax: false, isCtrl: false },
      { code: '4020', name: 'Consulting & Professional Service Fees', type: 'REVENUE', normal: 'CREDIT', isCash: false, isTax: false, isCtrl: false },
      { code: '5010', name: 'Cost of Goods Sold (COGS)', type: 'COST_OF_SALES', normal: 'DEBIT', isCash: false, isTax: false, isCtrl: false },
      { code: '6010', name: 'Salaries, Wages & Employee Benefits', type: 'EXPENSE', normal: 'DEBIT', isCash: false, isTax: false, isCtrl: false },
      { code: '6020', name: 'Commercial Rent & Facility Leases', type: 'EXPENSE', normal: 'DEBIT', isCash: false, isTax: false, isCtrl: false },
      { code: '6030', name: 'Utilities & Telecommunications', type: 'EXPENSE', normal: 'DEBIT', isCash: false, isTax: false, isCtrl: false },
      { code: '6040', name: 'Depreciation Expense', type: 'EXPENSE', normal: 'DEBIT', isCash: false, isTax: false, isCtrl: false },
      { code: '6050', name: 'Office Supplies & Consumables', type: 'EXPENSE', normal: 'DEBIT', isCash: false, isTax: false, isCtrl: false },
      { code: '6060', name: 'Professional & Legal Retainer Fees', type: 'EXPENSE', normal: 'DEBIT', isCash: false, isTax: false, isCtrl: false }
    ];

    const accountMap = new Map<string, string>();
    const existingAccounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, companyId));
    for (const ea of existingAccounts) {
      accountMap.set(ea.accountCode, ea.id);
    }

    for (const acc of standardCOA) {
      if (!accountMap.has(acc.code)) {
        const accId = `acc-${companyId.slice(-6)}-${acc.code}`;
        await db.insert(schema.accounts).values({
          id: accId,
          companyId,
          accountCode: acc.code,
          accountName: acc.name,
          accountType: acc.type,
          normalBalance: acc.normal,
          isCashAccount: acc.isCash,
          isTaxAccount: acc.isTax,
          isControlAccount: acc.isCtrl,
          status: 'ACTIVE'
        }).onConflictDoNothing();
        accountMap.set(acc.code, accId);
      }
    }
    breakdown.chartOfAccounts = accountMap.size;

    // C. Banks, Departments & Cost Centers
    const primaryCashGl = accountMap.get('1010') || Array.from(accountMap.values())[0];
    const secondaryCashGl = accountMap.get('1015') || primaryCashGl;

    const sampleBanks = [
      { code: 'BDO-01', name: 'BDO Unibank, Inc. - Corporate BGC', branch: 'BGC High Street', acc: '001234567890', gl: primaryCashGl },
      { code: 'BPI-01', name: 'Bank of the Philippine Islands (BPI)', branch: 'Ayala Main', acc: '1122334455', gl: secondaryCashGl },
      { code: 'MBTC-01', name: 'Metropolitan Bank & Trust Co. (Metrobank)', branch: 'Ortigas Center', acc: '9988776655', gl: primaryCashGl },
      { code: 'UBP-01', name: 'Union Bank of the Philippines', branch: 'Pasig Central', acc: '4455667788', gl: primaryCashGl },
      { code: 'SECB-01', name: 'Security Bank Corporation', branch: 'Makati Commercial', acc: '3344556677', gl: primaryCashGl }
    ];
    for (const b of sampleBanks) {
      await db.insert(schema.banks).values({
        id: `bnk-${companyId.slice(-6)}-${b.code}`,
        companyId,
        code: b.code,
        bankName: b.name,
        branch: b.branch,
        accountNumber: b.acc,
        currency: 'PHP',
        glAccountId: b.gl,
        status: 'ACTIVE'
      }).onConflictDoNothing();

      await db.insert(schema.bankAccounts).values({
        id: `ba-${companyId.slice(-6)}-${b.code}`,
        companyId,
        accountName: b.name,
        bankName: b.name.split('-')[0].trim(),
        accountNumberEncrypted: `enc-${b.acc}`,
        currency: 'PHP',
        status: 'ACTIVE'
      }).onConflictDoNothing();
    }
    breakdown.banks = sampleBanks.length;

    const sampleDepts = [
      { code: 'DEP-FIN', name: 'Finance & Corporate Accounting' },
      { code: 'DEP-SALES', name: 'Enterprise Sales & Business Development' },
      { code: 'DEP-IT', name: 'Technology, Systems & Infrastructure' },
      { code: 'DEP-OPS', name: 'Supply Chain, Logistics & Operations' },
      { code: 'DEP-HR', name: 'Human Resources & Talent Management' }
    ];
    for (const d of sampleDepts) {
      await db.insert(schema.departments).values({
        id: `dept-${companyId.slice(-6)}-${d.code}`,
        companyId,
        code: d.code,
        name: d.name,
        status: 'ACTIVE'
      }).onConflictDoNothing();
    }
    breakdown.departments = sampleDepts.length;

    const sampleCostCenters = [
      { code: 'CC-HO', name: 'Head Office Corporate Administration' },
      { code: 'CC-RET', name: 'Retail Store Operations' },
      { code: 'CC-ENT', name: 'Enterprise B2B Division' },
      { code: 'CC-WH', name: 'Central Warehouse & Hub Logistics' },
      { code: 'CC-RD', name: 'Product Innovation & AI Development' }
    ];
    for (const cc of sampleCostCenters) {
      await db.insert(schema.costCenters).values({
        id: `cc-${companyId.slice(-6)}-${cc.code}`,
        companyId,
        code: cc.code,
        name: cc.name,
        status: 'ACTIVE'
      }).onConflictDoNothing();
    }
    breakdown.costCenters = sampleCostCenters.length;

    // D. Master Data: Customers (100) & Vendors (100)
    const customerIds: string[] = [];
    const existingCustomers = await db.select().from(schema.customers).where(eq(schema.customers.companyId, companyId));
    for (const ec of existingCustomers) {
      customerIds.push(ec.id);
    }

    const customerValues = [];
    const customerCount = 50 * mult;
    for (let i = 1; i <= customerCount; i++) {
      const cId = `cust-${companyId.slice(-6)}-${String(i).padStart(4, '0')}`;
      if (!customerIds.includes(cId)) {
        customerIds.push(cId);
        customerValues.push({
          id: cId,
          companyId,
          code: `CUST-PH-${String(i).padStart(4, '0')}`,
          legalName: `Philippine Enterprise Client Corp #${i}`,
          tradeName: `Enterprise Client ${i}`,
          tin: `123-456-789-${String(i % 999).padStart(3, '0')}`,
          address: `${100 + i} Ayala Avenue, Bel-Air, Makati City, Metro Manila`,
          contactPerson: `Director Client ${i}`,
          contactDetails: `+63 917 ${String(100 + i).padStart(3, '0')} ${String(2000 + i).padStart(4, '0')}`,
          paymentTerms: 'NET30',
          vatStatus: 'VAT',
          taxClassification: 'CORPORATION',
          defaultReceivableAccountId: accountMap.get('1030') || primaryCashGl,
          defaultRevenueAccountId: accountMap.get('4010') || primaryCashGl,
          status: 'ACTIVE'
        });
      }
    }
    if (customerValues.length > 0) {
      await db.insert(schema.customers).values(customerValues).onConflictDoNothing();
    }
    breakdown.customers = customerIds.length;

    const vendorIds: string[] = [];
    const existingVendors = await db.select().from(schema.vendors).where(eq(schema.vendors.companyId, companyId));
    for (const ev of existingVendors) {
      vendorIds.push(ev.id);
    }

    const vendorValues = [];
    const vendorCount = 50 * mult;
    for (let i = 1; i <= vendorCount; i++) {
      const vId = `vend-${companyId.slice(-6)}-${String(i).padStart(4, '0')}`;
      if (!vendorIds.includes(vId)) {
        vendorIds.push(vId);
        vendorValues.push({
          id: vId,
          companyId,
          code: `VEND-PH-${String(i).padStart(4, '0')}`,
          legalName: `Major Philippine Supplier & Logistics Inc #${i}`,
          tradeName: `Supplier Partner ${i}`,
          tin: `987-654-321-${String(i % 999).padStart(3, '0')}`,
          address: `${200 + i} Emerald Avenue, Ortigas Center, Pasig City`,
          contactPerson: `Account Rep ${i}`,
          contactDetails: `+63 918 ${String(200 + i).padStart(3, '0')} ${String(3000 + i).padStart(4, '0')}`,
          paymentTerms: 'NET30',
          vatStatus: 'VAT',
          taxClassification: 'CORPORATION',
          defaultPayableAccountId: accountMap.get('2010') || primaryCashGl,
          defaultExpenseAccountId: accountMap.get('6050') || primaryCashGl,
          status: 'ACTIVE'
        });
      }
    }
    if (vendorValues.length > 0) {
      await db.insert(schema.vendors).values(vendorValues).onConflictDoNothing();
    }
    breakdown.vendors = vendorIds.length;

    // E. Master Data: Inventory Items (50 SKUs)
    const itemIds: string[] = [];
    const existingItems = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.companyId, companyId));
    for (const ei of existingItems) {
      itemIds.push(ei.id);
    }

    const itemValues = [];
    const itemCount = 25 * mult;
    for (let i = 1; i <= itemCount; i++) {
      const itemId = `inv-${companyId.slice(-6)}-${String(i).padStart(4, '0')}`;
      if (!itemIds.includes(itemId)) {
        itemIds.push(itemId);
        const isHardware = i % 2 === 0;
        itemValues.push({
          id: itemId,
          companyId,
          sku: isHardware ? `SKU-HW-${String(i).padStart(3, '0')}` : `SKU-OFF-${String(i).padStart(3, '0')}`,
          name: isHardware ? `Enterprise Server Rack Switch Model ${i}` : `Heavy-Duty Ergonomic Office Equipment Unit ${i}`,
          category: isHardware ? 'IT & Hardware' : 'Office Facilities',
          unitOfMeasure: 'PCS',
          costingMethod: 'FIFO',
          unitCost: 1500000 + (i * 25000), // in centavos (₱15,000 +)
          sellingPrice: 2200000 + (i * 35000), // in centavos (₱22,000 +)
          quantityOnHand: 250,
          reorderPoint: 20,
          assetAccountId: accountMap.get('1400') || primaryCashGl,
          cogsAccountId: accountMap.get('5010') || primaryCashGl,
          status: 'ACTIVE'
        });
      }
    }
    if (itemValues.length > 0) {
      await db.insert(schema.inventoryItems).values(itemValues).onConflictDoNothing();
    }
    breakdown.inventoryItems = itemIds.length;

    // F. Sales Invoices & Invoice Lines (150+ Invoices)
    const invoiceCount = 75 * mult;
    const invoiceValues = [];
    const invoiceLineValues = [];
    const invoiceStatuses = ['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'PAID', 'CANCELLED'];

    for (let k = 1; k <= invoiceCount; k++) {
      const invId = `sinv-${companyId.slice(-6)}-${String(k).padStart(5, '0')}`;
      const customerId = customerIds[k % customerIds.length];
      const status = invoiceStatuses[k % invoiceStatuses.length];
      const day = ((k * 3) % 28) + 1;
      const isNov = k % 2 === 0;
      const invDate = isNov ? `2026-11-${String((k % 3) + 1).padStart(2, '0')}` : `2026-10-${String(day).padStart(2, '0')}`;
      const subtotal = 10000000 + (k * 250000); // ₱100,000 + in centavos
      const outputVat = Math.round(subtotal * 0.12);
      const totalAmount = subtotal + outputVat;
      const balanceDue = (status === 'PAID' || status === 'CANCELLED') ? 0 : totalAmount;

      invoiceValues.push({
        id: invId,
        companyId,
        customerId,
        invoiceNumber: `SI-2026-${String(k).padStart(5, '0')}`,
        invoiceType: 'SALES',
        invoiceDate: invDate,
        dueDate: `2026-11-${String(day).padStart(2, '0')}`,
        reference: `PO-REF-${String(k).padStart(4, '0')}`,
        totalAmount,
        balanceDue,
        status,
        createdBy: adminId,
        submittedBy: status !== 'DRAFT' ? adminId : null,
        approvedBy: (status === 'APPROVED' || status === 'POSTED' || status === 'PAID') ? approverId : null,
      });

      // Invoice Lines
      invoiceLineValues.push({
        id: `sinvl-${companyId.slice(-6)}-${String(k).padStart(5, '0')}-1`,
        invoiceId: invId,
        accountId: accountMap.get('4010') || primaryCashGl,
        description: `High-Performance Business Technology & Solutions Package #${k}`,
        quantity: 1,
        unitPrice: subtotal,
        amount: subtotal
      });

      // Log 360 journey event for invoice
      await AuditService.log({
        companyId,
        userId: adminId,
        userEmail: 'admin.stress@ledgerai.ph',
        action: 'SALES_INVOICE_GENERATED',
        module: 'Sales & Receivables',
        entityType: 'SalesInvoice',
        entityId: invId,
        reason: `Generated Invoice #SI-2026-${String(k).padStart(5, '0')} for ₱${(totalAmount / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} (Status: ${status})`
      });
      auditEventsCount++;
    }
    await db.insert(schema.salesInvoices).values(invoiceValues).onConflictDoNothing();
    await db.insert(schema.salesInvoiceLines).values(invoiceLineValues).onConflictDoNothing();
    breakdown.salesInvoices = invoiceValues.length;
    breakdown.salesInvoiceLines = invoiceLineValues.length;

    // Customer Payments for PAID invoices
    const paymentValues = [];
    const paymentAppValues = [];
    const paidInvoices = invoiceValues.filter(i => i.status === 'PAID');
    for (let p = 0; p < paidInvoices.length; p++) {
      const inv = paidInvoices[p];
      const pId = `cpay-${companyId.slice(-6)}-${String(p + 1).padStart(4, '0')}`;
      const isNovPayment = p % 2 === 0;
      const pmtDate = isNovPayment ? `2026-11-${String((p % 3) + 1).padStart(2, '0')}` : inv.invoiceDate;

      paymentValues.push({
        id: pId,
        companyId,
        customerId: inv.customerId,
        paymentNumber: `CPAY-2026-${String(p + 1).padStart(4, '0')}`,
        officialReceiptNumber: `OR-2026-${String(1000 + p).padStart(5, '0')}`,
        paymentDate: pmtDate,
        cashAccountId: primaryCashGl,
        amount: inv.totalAmount,
        withholdingTaxAmount: Math.round(inv.totalAmount * 0.02), // 2% CWT
        paymentMethod: 'BANK_TRANSFER',
        reference: `BDO-CONF-${String(10000 + p)}`,
        notes: `Customer collection with official receipt for ${inv.invoiceNumber}`,
        status: 'POSTED',
        createdBy: adminId,
        approvedBy: approverId
      });

      paymentAppValues.push({
        id: `cpa-${companyId.slice(-6)}-${String(p + 1).padStart(4, '0')}`,
        paymentId: pId,
        invoiceId: inv.id,
        appliedAmount: inv.totalAmount,
        withholdingAmount: Math.round(inv.totalAmount * 0.02)
      });
    }
    if (paymentValues.length > 0) {
      await db.insert(schema.customerPayments).values(paymentValues).onConflictDoNothing();
      await db.insert(schema.customerPaymentApplications).values(paymentAppValues).onConflictDoNothing();
    }
    breakdown.customerPayments = paymentValues.length;

    // G. Purchase Bills & Bill Lines (150+ Bills)
    const billCount = 75 * mult;
    const billValues = [];
    const billLineValues = [];
    const billStatuses = ['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'PAID', 'CANCELLED'];

    for (let b = 1; b <= billCount; b++) {
      const billId = `pbill-${companyId.slice(-6)}-${String(b).padStart(5, '0')}`;
      const vendorId = vendorIds[b % vendorIds.length];
      const status = billStatuses[b % billStatuses.length];
      const day = ((b * 2) % 28) + 1;
      const isNov = b % 2 === 0;
      const billDate = isNov ? `2026-11-${String((b % 3) + 1).padStart(2, '0')}` : `2026-10-${String(day).padStart(2, '0')}`;
      const subtotal = 8000000 + (b * 180000); // ₱80,000 + in centavos
      const inputVat = Math.round(subtotal * 0.12);
      const totalAmount = subtotal + inputVat;
      const balanceDue = (status === 'PAID' || status === 'CANCELLED') ? 0 : totalAmount;

      billValues.push({
        id: billId,
        companyId,
        vendorId,
        billNumber: `PB-2026-${String(b).padStart(5, '0')}`,
        billDate,
        dueDate: `2026-11-${String(day).padStart(2, '0')}`,
        reference: `INV-SUPP-${String(b).padStart(5, '0')}`,
        notes: `Supplier bill for enterprise equipment & facilities #${b}`,
        totalAmount,
        balanceDue,
        status,
        createdBy: adminId,
        submittedBy: status !== 'DRAFT' ? adminId : null,
        approvedBy: (status === 'APPROVED' || status === 'POSTED' || status === 'PAID') ? approverId : null
      });

      billLineValues.push({
        id: `pbilll-${companyId.slice(-6)}-${String(b).padStart(5, '0')}-1`,
        billId,
        accountId: accountMap.get('6050') || primaryCashGl,
        description: `Operational materials, hardware components, and service delivery #${b}`,
        quantity: 1,
        unitPrice: subtotal,
        amount: subtotal
      });

      await AuditService.log({
        companyId,
        userId: adminId,
        userEmail: 'admin.stress@ledgerai.ph',
        action: 'PURCHASE_BILL_RECORDED',
        module: 'Procurement & Payables',
        entityType: 'PurchaseBill',
        entityId: billId,
        reason: `Created Purchase Bill #PB-2026-${String(b).padStart(5, '0')} for ₱${(totalAmount / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })} (Status: ${status})`
      });
      auditEventsCount++;
    }
    await db.insert(schema.purchaseBills).values(billValues).onConflictDoNothing();
    await db.insert(schema.purchaseBillLines).values(billLineValues).onConflictDoNothing();
    breakdown.purchaseBills = billValues.length;
    breakdown.purchaseBillLines = billLineValues.length;

    // Supplier Payments for PAID bills
    const suppPaymentValues = [];
    const suppPaymentAppValues = [];
    const paidBills = billValues.filter(b => b.status === 'PAID');
    for (let sp = 0; sp < paidBills.length; sp++) {
      const bill = paidBills[sp];
      const spId = `spay-${companyId.slice(-6)}-${String(sp + 1).padStart(4, '0')}`;
      const isNovSupp = sp % 2 === 0;
      const suppDate = isNovSupp ? `2026-11-${String((sp % 3) + 1).padStart(2, '0')}` : bill.billDate;

      suppPaymentValues.push({
        id: spId,
        companyId,
        vendorId: bill.vendorId,
        paymentNumber: `SPAY-2026-${String(sp + 1).padStart(4, '0')}`,
        paymentDate: suppDate,
        amount: bill.totalAmount,
        cashAccountId: primaryCashGl,
        withholdingTaxAmount: Math.round(bill.totalAmount * 0.02), // 2% EWT
        withholdingTaxAccountId: accountMap.get('2030') || primaryCashGl,
        paymentMethod: 'CHECK',
        reference: `CHK-BDO-${String(50000 + sp)}`,
        notes: `Disbursement check for Bill ${bill.billNumber}`,
        status: 'POSTED',
        createdBy: adminId,
        approvedBy: approverId
      });

      suppPaymentAppValues.push({
        id: `spa-${companyId.slice(-6)}-${String(sp + 1).padStart(4, '0')}`,
        paymentId: spId,
        billId: bill.id,
        appliedAmount: bill.totalAmount,
        withholdingAmount: Math.round(bill.totalAmount * 0.02)
      });
    }
    if (suppPaymentValues.length > 0) {
      await db.insert(schema.supplierPayments).values(suppPaymentValues).onConflictDoNothing();
      await db.insert(schema.supplierPaymentApplications).values(suppPaymentAppValues).onConflictDoNothing();
    }
    breakdown.supplierPayments = suppPaymentValues.length;

    // H. Cash Transactions, Checks & Bank Deposits
    const cashTxnCount = 40 * mult;
    const cashTxnValues = [];
    const cashTxnLineValues = [];
    for (let c = 1; c <= cashTxnCount; c++) {
      const ctId = `ctxn-${companyId.slice(-6)}-${String(c).padStart(4, '0')}`;
      const isReceipt = c % 2 === 0;
      const amount = 2500000 + (c * 75000); // ₱25,000 + in centavos
      const day = ((c * 4) % 28) + 1;
      const isNov = c % 2 === 0;
      const txnDate = isNov ? `2026-11-${String((c % 3) + 1).padStart(2, '0')}` : `2026-10-${String(day).padStart(2, '0')}`;

      cashTxnValues.push({
        id: ctId,
        companyId,
        transactionNumber: `CTXN-2026-${String(c).padStart(4, '0')}`,
        type: isReceipt ? 'RECEIPT' : 'DISBURSEMENT',
        transactionDate: txnDate,
        cashAccountId: primaryCashGl,
        totalAmount: amount,
        reference: `VOUCHER-${String(c).padStart(4, '0')}`,
        description: isReceipt ? `Client advance payment / collection voucher #${c}` : `Operational emergency cash disbursement #${c}`,
        status: 'POSTED',
        createdBy: adminId,
        approvedBy: approverId
      });

      cashTxnLineValues.push({
        id: `ctxnl-${companyId.slice(-6)}-${String(c).padStart(4, '0')}-1`,
        cashTransactionId: ctId,
        accountId: isReceipt ? (accountMap.get('4010') || primaryCashGl) : (accountMap.get('6030') || primaryCashGl),
        amount,
        description: `Line item for ${ctId}`
      });
    }
    await db.insert(schema.cashTransactions).values(cashTxnValues).onConflictDoNothing();
    await db.insert(schema.cashTransactionLines).values(cashTxnLineValues).onConflictDoNothing();
    breakdown.cashTransactions = cashTxnValues.length;
    breakdown.cashTransactionLines = cashTxnLineValues.length;

    // Checks
    const checkValues = [];
    for (let ch = 1; ch <= 20 * mult; ch++) {
      const isNovCheck = ch % 2 === 0;
      const chkDate = isNovCheck ? `2026-11-${String((ch % 3) + 1).padStart(2, '0')}` : `2026-10-${String(((ch * 2) % 28) + 1).padStart(2, '0')}`;
      checkValues.push({
        id: `chk-${companyId.slice(-6)}-${String(ch).padStart(4, '0')}`,
        companyId,
        checkNumber: `CHK-${String(100000 + ch)}`,
        checkDate: chkDate,
        payeeName: `Supplier Partner ${ch}`,
        cashAccountId: primaryCashGl,
        amount: 5000000 + (ch * 100000),
        voucherNumber: `CV-${String(ch).padStart(4, '0')}`,
        status: ch % 5 === 0 ? 'CANCELLED' : 'CLEARED',
        notes: `Enterprise check disbursement #${ch}`
      });
    }
    await db.insert(schema.checks).values(checkValues).onConflictDoNothing();
    breakdown.checks = checkValues.length;

    // Bank Reconciliations
    const reconValues = [];
    const reconLineValues = [];
    const reconMonths = [
      { r: 8, date: '2026-08-31', status: 'APPROVED' },
      { r: 9, date: '2026-09-30', status: 'APPROVED' },
      { r: 10, date: '2026-10-31', status: 'APPROVED' },
      { r: 11, date: '2026-11-02', status: 'SUBMITTED' }
    ];
    for (const rm of reconMonths) {
      const recId = `brec-${companyId.slice(-6)}-2026-${String(rm.r).padStart(2, '0')}`;
      const endingBal = 250000000 + (rm.r * 15000000); // ₱2,500,000 + in centavos
      reconValues.push({
        id: recId,
        companyId,
        bankAccountId: primaryCashGl,
        statementDate: rm.date,
        statementEndingBalance: endingBal,
        bookEndingBalance: endingBal,
        unexplainedDifference: 0,
        status: rm.status,
        notes: `Monthly Bank Reconciliation for BDO Corporate (Month ${rm.r}/2026)`,
        createdBy: adminId,
        approvedBy: rm.status === 'APPROVED' ? approverId : null
      });

      for (let rl = 1; rl <= 10; rl++) {
        reconLineValues.push({
          id: `bsl-${companyId.slice(-6)}-${rm.r}-${rl}`,
          bankReconciliationId: recId,
          companyId,
          bankAccountId: primaryCashGl,
          lineDate: rm.date,
          description: `Bank Statement Automated Match Line #${rl}`,
          type: rl % 2 === 0 ? 'DEPOSIT' : 'WITHDRAWAL',
          amount: 5000000 + (rl * 250000),
          matchedStatus: 'MATCHED'
        });
      }
    }
    await db.insert(schema.bankReconciliations).values(reconValues).onConflictDoNothing();
    await db.insert(schema.bankStatementLines).values(reconLineValues).onConflictDoNothing();
    breakdown.bankReconciliations = reconValues.length;
    breakdown.bankStatementLines = reconLineValues.length;

    // I. Fixed Assets & Depreciation
    const assetValues = [];
    const deprValues = [];
    for (let a = 1; a <= 15 * mult; a++) {
      const assetId = `fa-${companyId.slice(-6)}-${String(a).padStart(3, '0')}`;
      const cost = 8000000 + (a * 2500000); // ₱80,000 to ₱450,000 in centavos
      const salvage = Math.round(cost * 0.1);
      const usefulLife = 60; // 5 years
      const monthlyDepr = Math.round((cost - salvage) / usefulLife);

      assetValues.push({
        id: assetId,
        companyId,
        assetTag: `TAG-2026-${String(a).padStart(4, '0')}`,
        assetName: a % 2 === 0 ? `High-End Engineering Laptop Unit #${a}` : `Corporate Logistics Transport Van #${a}`,
        category: a % 2 === 0 ? 'IT_HARDWARE' : 'VEHICLE',
        acquisitionDate: '2026-01-15',
        acquisitionCost: cost,
        salvageValue: salvage,
        usefulLifeMonths: usefulLife,
        depreciationMethod: 'STRAIGHT_LINE',
        assetAccountId: accountMap.get('1500') || primaryCashGl,
        accumulatedDepAccountId: accountMap.get('1510') || primaryCashGl,
        depreciationExpenseAccountId: accountMap.get('6040') || primaryCashGl,
        status: 'ACTIVE'
      });

      // Schedules for Aug, Sep, Oct, Nov 2026
      for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
        deprValues.push({
          id: `depr-${companyId.slice(-6)}-${a}-${m}`,
          assetId,
          companyId,
          periodMonth: m,
          depreciationAmount: monthlyDepr,
          accumulatedDepreciation: monthlyDepr * 8,
          bookValue: cost - (monthlyDepr * 8),
          status: 'POSTED'
        });
      }
    }
    await db.insert(schema.fixedAssets).values(assetValues).onConflictDoNothing();
    await db.insert(schema.depreciationSchedules).values(deprValues).onConflictDoNothing();
    breakdown.fixedAssets = assetValues.length;
    breakdown.depreciationSchedules = deprValues.length;

    // J. Employees, Payroll Runs & Items
    const empValues = [];
    const empCount = 20 * mult;
    for (let e = 1; e <= empCount; e++) {
      const salary = 3500000 + (e * 150000); // ₱35,000 to ₱100,000 in centavos
      empValues.push({
        id: `emp-${companyId.slice(-6)}-${String(e).padStart(4, '0')}`,
        companyId,
        employeeNo: `EMP-2026-${String(e).padStart(4, '0')}`,
        firstName: `EmployeeFirst${e}`,
        lastName: `EmployeeLast${e}`,
        email: `employee${e}@ledgerai.ph`,
        tin: `111-222-333-${String(e).padStart(3, '0')}`,
        sssNo: `03-${String(1000000 + e)}-4`,
        philhealthNo: `12-${String(100000000 + e)}-5`,
        pagibigNo: `1210-${String(10000000 + e)}-0`,
        position: e % 3 === 0 ? 'Senior Software Architect' : e % 2 === 0 ? 'Financial Analyst' : 'Operations Specialist',
        department: sampleDepts[e % sampleDepts.length].name,
        monthlyBasicSalary: salary,
        status: 'ACTIVE'
      });
    }
    await db.insert(schema.employees).values(empValues).onConflictDoNothing();
    breakdown.employees = empValues.length;

    // Payroll Runs
    const payrollRunValues = [];
    const payrollItemValues = [];
    for (const pr of ['2026-08-A', '2026-08-B', '2026-09-A', '2026-09-B', '2026-10-A', '2026-10-B', '2026-11-A']) {
      const prId = `pr-${companyId.slice(-6)}-${pr}`;
      let totalGross = 0;
      let totalNet = 0;
      let totalSssRun = 0;
      let totalPhicRun = 0;
      let totalHdmfRun = 0;
      let totalTaxRun = 0;

      for (let e = 0; e < empValues.length; e++) {
        const emp = empValues[e];
        const basicSemi = Math.round(emp.monthlyBasicSalary / 2);
        const sss = 135000; // ₱1,350
        const phic = Math.round((basicSemi * 0.05) / 2);
        const hdmf = 10000; // ₱100
        const statutoryCalc = TaxEngine.calculateStatutoryPayrollWithholding(basicSemi, {
          frequency: 'SEMI_MONTHLY',
          sssEmployeeCentavos: sss,
          philhealthEmployeeCentavos: phic,
          pagibigEmployeeCentavos: hdmf
        });
        const tax = statutoryCalc.withholdingTaxCentavos;
        const ded = statutoryCalc.totalDeductionsCentavos;
        const net = statutoryCalc.netPayCentavos;

        totalGross += basicSemi;
        totalNet += net;
        totalSssRun += sss;
        totalPhicRun += phic;
        totalHdmfRun += hdmf;
        totalTaxRun += tax;

        payrollItemValues.push({
          id: `pri-${companyId.slice(-6)}-${pr}-${e + 1}`,
          payrollRunId: prId,
          employeeId: emp.id,
          basicPay: basicSemi,
          grossPay: basicSemi,
          sssEmployee: sss,
          sssEmployer: sss * 2,
          philhealthEmployee: phic,
          philhealthEmployer: phic,
          pagibigEmployee: hdmf,
          pagibigEmployer: hdmf,
          withholdingTax: tax,
          totalDeductions: ded,
          netPay: net
        });
      }

      const isNovPr = pr === '2026-11-A';
      payrollRunValues.push({
        id: prId,
        companyId,
        payrollPeriod: pr,
        startDate: isNovPr ? '2026-11-01' : pr.endsWith('-A') ? '2026-10-01' : '2026-10-16',
        endDate: isNovPr ? '2026-11-15' : pr.endsWith('-A') ? '2026-10-15' : '2026-10-31',
        paymentDate: isNovPr ? '2026-11-02' : pr.endsWith('-A') ? '2026-10-15' : '2026-10-31',
        totalGrossPay: totalGross,
        totalSss: totalSssRun,
        totalPhilhealth: totalPhicRun,
        totalPagibig: totalHdmfRun,
        totalWithholdingTax: totalTaxRun,
        totalNetPay: totalNet,
        status: 'POSTED',
        createdBy: adminId,
        approvedBy: approverId
      });
    }
    await db.insert(schema.payrollRuns).values(payrollRunValues).onConflictDoNothing();
    await db.insert(schema.payrollItems).values(payrollItemValues).onConflictDoNothing();
    breakdown.payrollRuns = payrollRunValues.length;
    breakdown.payrollItems = payrollItemValues.length;

    // K. Budgets & Tax Calendar
    const budgetCategories = [
      'Utilities & Tech', 'Salaries & Benefits', 'Rent & Facilities',
      'Marketing & Sales', 'Cost of Goods Sold', 'Taxes & Compliance',
      'Office Supplies', 'Travel & Transport'
    ];
    const budgetValues = [];
    for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) {
      for (const cat of budgetCategories) {
        budgetValues.push({
          id: `bgt-${companyId.slice(-6)}-${m}-${cat.slice(0, 4)}`,
          companyId,
          periodMonth: m,
          category: cat,
          monthlyLimit: 50000000, // ₱500,000
          notes: `Corporate operating budget limit for ${cat} - ${m}`
        });
      }
    }
    await db.insert(schema.budgets).values(budgetValues).onConflictDoNothing();
    breakdown.budgets = budgetValues.length;

    // Tax Calendar & Filings
    const taxFilingsSample = [
      { form: '2550Q', period: '2026-Q3', base: 500000000, due: 60000000, net: 25000000, start: '2026-07-01', end: '2026-09-30', dline: '2026-10-25' },
      { form: '1601-EQ', period: '2026-Q3', base: 350000000, due: 7000000, net: 7000000, start: '2026-07-01', end: '2026-09-30', dline: '2026-10-31' },
      { form: '0619-E', period: '2026-10', base: 120000000, due: 2400000, net: 2400000, start: '2026-10-01', end: '2026-10-31', dline: '2026-11-10' },
      { form: '1601-C', period: '2026-10', base: 150000000, due: 15000000, net: 15000000, start: '2026-10-01', end: '2026-10-31', dline: '2026-11-10' }
    ];
    for (const tf of taxFilingsSample) {
      await db.insert(schema.taxFilings).values({
        id: `tf-${companyId.slice(-6)}-${tf.form}-${tf.period}`,
        companyId,
        taxType: tf.form.startsWith('25') ? 'VAT' : tf.form.includes('0619') || tf.form.includes('EQ') ? 'EWT' : 'COMPENSATION_TAX',
        periodName: tf.period,
        startDate: tf.start,
        endDate: tf.end,
        deadlineDate: tf.dline,
        status: 'FILED',
        totalTaxBase: tf.base,
        totalTaxDue: tf.due,
        netTaxPayable: tf.net,
        notes: `Statutory BIR Form ${tf.form} official electronic filing`
      }).onConflictDoNothing();

      await db.insert(schema.taxCalendar).values({
        id: `tcal-${companyId.slice(-6)}-${tf.form}-${tf.period}`,
        companyId,
        taxType: tf.form.startsWith('25') ? 'VAT' : 'EWT',
        formNumber: `BIR Form ${tf.form}`,
        periodDescription: `Filing for ${tf.period}`,
        deadlineDate: tf.dline,
        status: 'FILED'
      }).onConflictDoNothing();
    }
    breakdown.taxFilings = taxFilingsSample.length;
    breakdown.taxCalendar = taxFilingsSample.length;

    // L. Documents & OCR
    const docValues = [];
    for (let d = 1; d <= 20 * mult; d++) {
      const docId = `doc-${companyId.slice(-6)}-${String(d).padStart(4, '0')}`;
      docValues.push({
        id: docId,
        companyId,
        entityType: 'SALES_INVOICE',
        entityId: `sinv-${companyId.slice(-6)}-${String(d).padStart(5, '0')}`,
        documentType: 'SALES_INVOICE',
        fileName: `Scanned_Invoice_Receipt_Doc_${d}.pdf`,
        originalFileName: `BIR_OR_SI_${1000 + d}.pdf`,
        fileType: 'application/pdf',
        fileSize: 450200,
        filePath: `/data/documents/DOC_${d}.pdf`,
        source: 'WEB_UI',
        uploadedBy: adminId,
        status: 'ACTIVE',
        ocrStatus: 'COMPLETED',
        verificationStatus: 'VERIFIED',
        confidenceScore: 0.98,
        extractedMerchant: `Philippine Merchant Partner ${d}`,
        extractedDate: '2026-10-15',
        extractedTotalAmount: 15000000 + (d * 500000),
        notes: `Validated official tax document #${d}`
      });
    }
    await db.insert(schema.documents).values(docValues).onConflictDoNothing();
    breakdown.documents = docValues.length;

    // M. Approvals & Workflows
    const appWfValues = [];
    const appStepValues = [];
    for (let w = 1; w <= 15 * mult; w++) {
      const wfId = `wf-${companyId.slice(-6)}-${String(w).padStart(4, '0')}`;
      const isApproved = w % 3 !== 0;
      appWfValues.push({
        id: wfId,
        companyId,
        entityType: 'SALES_INVOICE',
        entityId: `sinv-${companyId.slice(-6)}-${String(w).padStart(5, '0')}`,
        recordReference: `SI-2026-${String(w).padStart(5, '0')}`,
        workflowType: 'AMOUNT_THRESHOLD',
        status: isApproved ? 'APPROVED' : 'PENDING',
        amountCentavos: 15000000 + (w * 250000),
        submittedBy: adminId,
        submittedByName: 'Juan Dela Cruz'
      });

      appStepValues.push({
        id: `wfs-${companyId.slice(-6)}-${String(w).padStart(4, '0')}-1`,
        workflowId: wfId,
        companyId,
        entityType: 'SALES_INVOICE',
        entityId: `sinv-${companyId.slice(-6)}-${String(w).padStart(5, '0')}`,
        stepOrder: 1,
        stepName: 'Senior Finance Review & SoD Sign-off',
        requiredRole: 'Approver',
        assignedApproverId: approverId,
        assignedApproverName: 'Pedro Reyes',
        status: isApproved ? 'APPROVED' : 'PENDING',
        decision: isApproved ? 'APPROVED' : null,
        comments: isApproved ? 'Approved within authorized corporate limit.' : 'Pending executive review.'
      });
    }
    await db.insert(schema.approvalWorkflows).values(appWfValues).onConflictDoNothing();
    await db.insert(schema.approvalSteps).values(appStepValues).onConflictDoNothing();
    breakdown.approvalWorkflows = appWfValues.length;
    breakdown.approvalSteps = appStepValues.length;

    // Notifications
    const notifValues = [];
    for (let n = 1; n <= 25 * mult; n++) {
      notifValues.push({
        id: `notif-${companyId.slice(-6)}-${String(n).padStart(4, '0')}`,
        companyId,
        userId: adminId,
        title: `Enterprise Workflow Notification #${n}`,
        message: `Transaction #SI-2026-${String(n).padStart(5, '0')} has been approved and posted to General Ledger.`,
        type: 'SYSTEM',
        isRead: n > 10
      });
    }
    await db.insert(schema.notifications).values(notifValues).onConflictDoNothing();
    breakdown.notifications = notifValues.length;

    // N. General Journal Entries (100% Balanced Double-Entry Postings)
    const jeCount = 100 * mult;
    let jeCreated = 0;
    let jlCreated = 0;
    const jeCategories = ['SALES_AR', 'PURCHASE_AP', 'CASH_DISBURSEMENT', 'INVENTORY_ADJUSTMENT', 'PAYROLL_ACCRUAL'];

    for (let j = 1; j <= jeCount; j++) {
      const cat = jeCategories[j % jeCategories.length];
      const entryDate = `2026-10-${String((j % 28) + 1).padStart(2, '0')}`;
      const jeNum = `E2E-JE-${String(j).padStart(5, '0')}`;
      const amount = 5000000 + (j * 150000); // centavos

      let debitAccount = '1030'; // Accounts Receivable
      let creditAccount = '4010'; // Sales Revenue
      if (cat === 'PURCHASE_AP') {
        debitAccount = '6050'; // Office Supplies Expense
        creditAccount = '2010'; // Accounts Payable
      } else if (cat === 'CASH_DISBURSEMENT') {
        debitAccount = '2010'; // AP
        creditAccount = '1010'; // Cash in Bank
      } else if (cat === 'INVENTORY_ADJUSTMENT') {
        debitAccount = '1400'; // Inventory
        creditAccount = '5010'; // COGS
      } else if (cat === 'PAYROLL_ACCRUAL') {
        debitAccount = '6010'; // Salaries
        creditAccount = '2050'; // Payable
      }

      const debitAccountId = accountMap.get(debitAccount) || primaryCashGl;
      const creditAccountId = accountMap.get(creditAccount) || secondaryCashGl;

      const lines = [
        {
          accountId: debitAccountId,
          description: `Debit entry for ${jeNum} (${cat})`,
          debit: amount,
          credit: 0
        },
        {
          accountId: creditAccountId,
          description: `Credit entry for ${jeNum} (${cat})`,
          debit: 0,
          credit: amount
        }
      ];

      try {
        const entryId = await createJournalEntry(
          companyId,
          {
            journalNumber: jeNum,
            entryDate,
            description: `Automated stress dry run transaction #${j} for ${cat}`,
            createdBy: adminId,
            userRole: 'Company Administrator'
          },
          lines
        );

        jeCreated++;
        jlCreated += lines.length;

        // Deterministic, mutually exclusive workflow state transitions
        // Domain functions (createJournalEntry, submitJournalEntry, approveJournalEntry,
        // rejectJournalEntry, postJournalEntry) emit canonical audit events atomically
        // only when each transition succeeds.
        auditEventsCount++; // CREATE_JOURNAL_ENTRY emitted by createJournalEntry
        if (j % 35 === 0) {
          await submitJournalEntry(companyId, entryId, adminId);
          auditEventsCount++;
          await rejectJournalEntry(companyId, entryId, approverId, 'Rejected for stress test exception verification.');
          auditEventsCount++;
        } else if (j % 15 === 0) {
          await submitJournalEntry(companyId, entryId, adminId);
          auditEventsCount++;
          await approveJournalEntry(companyId, entryId, approverId, 'Approver');
          auditEventsCount++;
          await postJournalEntry(companyId, entryId, adminId, 'Company Administrator');
          auditEventsCount++;
        } else if (j % 10 === 0) {
          await submitJournalEntry(companyId, entryId, adminId);
          auditEventsCount++;
          await approveJournalEntry(companyId, entryId, approverId, 'Approver');
          auditEventsCount++;
        } else if (j % 5 === 0) {
          await submitJournalEntry(companyId, entryId, adminId);
          auditEventsCount++;
        }
      } catch (err: any) {
        console.error(`[StressTestingService] Journal lifecycle error on entry ${j}:`, err?.message || err);
        throw err;
      }
    }
    breakdown.journalEntries = jeCreated;
    breakdown.journalLines = jlCreated;

    // Double-Entry Balance Verification
    const allLines = await db.select().from(schema.journalLines);
    const totalDebits = allLines.reduce((acc, curr) => acc + (curr.debit || 0), 0);
    const totalCredits = allLines.reduce((acc, curr) => acc + (curr.credit || 0), 0);
    const discrepancy = Math.abs(totalDebits - totalCredits);
    const balanced = discrepancy === 0;

    const totalRecords = Object.values(breakdown).reduce((a, b) => a + b, 0);
    breakdown.auditLogs = auditEventsCount;

    return {
      breakdown,
      totalRecords,
      auditEvents: auditEventsCount,
      integrity: {
        totalDebits,
        totalCredits,
        discrepancy,
        balanced
      }
    };
  }

  /**
   * Automates the creation of a 'StressTest' company profile, populates it with bulk data across all submodules,
   * checks double-entry integrity, and logs everything in the 360 Activity Journey.
   */
  static async runStressTest(customCompanyName?: string, options: { maxVolume?: boolean; volumeMultiplier?: number; alsoPopulateTestCompany?: boolean } = {}): Promise<StressTestExecutionResult> {
    const startTime = Date.now();
    let companyId = '';
    const companyName = customCompanyName || `LedgerAI Enterprise Stress Test Corp ${new Date().toISOString().slice(0, 10)}`;

    try {
      await CompanyManager.init();
      companyId = `LGR-ST-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

      // 1. Create a dedicated StressTest company profile
      await CompanyManager.createCompanyProfile(companyId, companyName);

      const compDb = await CompanyManager.getCompanyDb(companyId, { allowInitializeNew: true });
      if (!compDb) {
        throw new Error(`Failed to initialize company database for stress test ID: ${companyId}`);
      }

      // Populate dedicated StressTest Company
      const result = await dbContext.run(compDb, async () => {
        // Ensure company table row exists
        await db.insert(schema.companies).values({
          id: companyId,
          legalName: companyName,
          tradeName: 'StressTest PH',
          tin: '999-999-999-00000',
          address: '999 Enterprise Stress Tower, BGC, Taguig City',
          vatStatus: 'VAT',
          rdoCode: '044',
          currency: 'PHP',
          timezone: 'Asia/Manila',
          fiscalYear: 2026,
          status: 'ACTIVE',
          isDemo: true
        }).onConflictDoNothing();

        return await this.populateCompanySubmodules(companyId, companyName, {
          maxVolume: true,
          volumeMultiplier: options.volumeMultiplier || 2
        });
      });

      // 2. Optionally populate the default active test company (`LGR-PH-2026-TEST-00-ABC12345`) only when explicitly requested
      if (options.alsoPopulateTestCompany) {
        try {
          const testCompDb = await CompanyManager.getCompanyDb('LGR-PH-2026-TEST-00-ABC12345');
          if (testCompDb) {
            console.log('[StressTestingService] Also populating active workspace company LGR-PH-2026-TEST-00-ABC12345...');
            await dbContext.run(testCompDb, async () => {
              await this.populateCompanySubmodules('LGR-PH-2026-TEST-00-ABC12345', 'LedgerAI PH Test Corp', {
                maxVolume: true,
                volumeMultiplier: 2
              });
            });
            await CompanyManager.syncCompanyDatabaseSnapshot('LGR-PH-2026-TEST-00-ABC12345');
          }
        } catch (testCompErr: any) {
          console.warn('[StressTestingService] Notice: Could not sync active test company:', testCompErr.message);
        }
      }

      const durationMs = Date.now() - startTime;

      return {
        companyId,
        companyName,
        durationMs,
        totalRecordsCreated: result.totalRecords,
        breakdown: result.breakdown,
        integrityCheck: result.integrity,
        auditJourneyEventsLogged: result.auditEvents + 1,
        success: true
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      console.error('Stress Testing Service Error:', err);
      return {
        companyId: companyId || 'UNKNOWN',
        companyName,
        durationMs,
        totalRecordsCreated: 0,
        breakdown: {} as any,
        integrityCheck: { totalDebits: 0, totalCredits: 0, discrepancy: 0, balanced: false },
        auditJourneyEventsLogged: 0,
        success: false,
        error: err.message || String(err)
      };
    }
  }

  /**
   * Populates all submodules for any existing company profile.
   */
  static async populateExistingCompany(companyId: string, companyName?: string): Promise<any> {
    await CompanyManager.init();
    const compDb = await CompanyManager.getCompanyDb(companyId);
    if (!compDb) throw new Error(`Company database not found for ID ${companyId}`);

    return await dbContext.run(compDb, async () => {
      const res = await this.populateCompanySubmodules(companyId, companyName || 'Enterprise Workspace', {
        maxVolume: true,
        volumeMultiplier: 2
      });
      await CompanyManager.syncCompanyDatabaseSnapshot(companyId);
      return res;
    });
  }
}
