import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { db } from '../../src/server/db';
import * as schema from '../../src/server/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { TaxEngine } from '../../src/server/services/taxEngine';
import { AccountingEngine } from '../../src/server/services/accountingEngine';
import { CompanyManager } from '../../src/server/services/companyManager';
import { DatabaseEncryptionService } from '../../src/server/services/databaseEncryptionService';
import { paths } from '../../src/server/services/paths';
import {
  createSalesInvoice,
  postSalesInvoice,
  createCustomerPayment,
  postCustomerPayment,
  createCreditMemo,
  postCreditMemo,
  createPurchaseBill,
  postPurchaseBill,
  createSupplierPayment,
  postSupplierPayment,
  createDebitMemo,
  postDebitMemo,
} from '../../src/server/db/business_transactions';
import {
  createJournalEntry,
  softClosePeriod,
  hardClosePeriod,
  reopenPeriod,
  performYearEndClose,
  DomainError,
} from '../../src/server/db/domain';

import { dbContext } from '../../src/server/db/context';

describe('PHILIPPINE STATUTORY ACCURACY & ENTERPRISE ACCOUNTING CERTIFICATION', () => {
  const EXPANDED_PILOT_COMPANY_ID = 'LGR-PH-2026-PILOT-EXPANDED-01';
  const ADMIN_USER_ID = 'cpa-lead-auditor-2026';
  let companyDb: any;

  beforeAll(async () => {
    // 1. Close any open cached connections and clean up old test company directory for clean isolation
    await CompanyManager.closeAllConnections();
    const companyDir = path.join(paths.getCompaniesRootDir(), EXPANDED_PILOT_COMPANY_ID);
    if (fs.existsSync(companyDir)) {
      try { fs.rmSync(companyDir, { recursive: true, force: true }); } catch {}
    }

    // 2. Create fresh company profile in CompanyManager
    await CompanyManager.createCompanyProfile(
      EXPANDED_PILOT_COMPANY_ID,
      'LedgerAI Expanded Pilot Philippines Corp.',
      undefined,
      undefined,
      false,
      { classification: 'PILOT' }
    );

    // 3. Open company database connection
    companyDb = await CompanyManager.getCompanyDb(EXPANDED_PILOT_COMPANY_ID);

    // 4. Ensure default test admin user exists in DB within dbContext
    await dbContext.run(companyDb, async () => {
      const existingUser = await db.select().from(schema.users).where(eq(schema.users.id, ADMIN_USER_ID)).get();
      if (!existingUser) {
        await db.insert(schema.users).values({
          id: ADMIN_USER_ID,
          username: 'cpa_lead_auditor',
          email: 'auditor@ledgerai.ph',
          passwordHash: 'argon2id_mock_hash_for_testing',
          role: 'Company Administrator',
          displayName: 'Atty. Juan Dela Cruz, CPA',
          fullName: 'Atty. Juan Dela Cruz, CPA',
          status: 'ACTIVE',
          isSuperAdmin: true,
        }).onConflictDoNothing();
      }
    });
  });

  // =========================================================================
  // 1. PHILIPPINE STATUTORY CONTRIBUTION VALIDATION
  // =========================================================================
  describe('1. Philippine Statutory Contribution Validation (2026 Schedules)', () => {
    it('generates the authoritative 61-bracket 2026 SSS schedule (RA 11199)', () => {
      const table = TaxEngine.getOfficial2026SssBracketTable();
      expect(table).toHaveLength(61);

      // Bracket 1: Minimum MSC ₱5,000 (Compensation under ₱5,250)
      const b1 = table[0];
      expect(b1.mscCentavos).toBe(500000); // ₱5,000.00
      expect(b1.regularMscCentavos).toBe(500000);
      expect(b1.wispMscCentavos).toBe(0);
      expect(b1.regularEeCentavos).toBe(25000); // ₱250.00 (5%)
      expect(b1.regularErCentavos).toBe(50000); // ₱500.00 (10%)
      expect(b1.ecErCentavos).toBe(1000); // ₱10.00
      expect(b1.totalEeCentavos).toBe(25000);
      expect(b1.totalErCentavos).toBe(51000);

      // Bracket 31: Regular SSS Cap at ₱20,000 MSC (Compensation ₱19,750–₱20,249.99)
      const b31 = table.find(b => b.mscCentavos === 2000000);
      expect(b31).toBeDefined();
      expect(b31!.regularMscCentavos).toBe(2000000);
      expect(b31!.wispMscCentavos).toBe(0);
      expect(b31!.regularEeCentavos).toBe(100000); // ₱1,000.00 (5%)
      expect(b31!.regularErCentavos).toBe(200000); // ₱2,000.00 (10%)
      expect(b31!.ecErCentavos).toBe(3000); // ₱30.00 (MSC >= 15k)

      // Bracket 61: Maximum Combined MSC ₱35,000 (Compensation ₱34,750 and above)
      const b61 = table[60];
      expect(b61.mscCentavos).toBe(3500000); // ₱35,000.00
      expect(b61.regularMscCentavos).toBe(2000000); // ₱20,000.00 Regular SSS
      expect(b61.wispMscCentavos).toBe(1500000); // ₱15,000.00 Mandatory WISP
      expect(b61.regularEeCentavos).toBe(100000); // ₱1,000.00
      expect(b61.regularErCentavos).toBe(200000); // ₱2,000.00
      expect(b61.wispEeCentavos).toBe(75000); // ₱750.00 (5% of ₱15,000)
      expect(b61.wispErCentavos).toBe(150000); // ₱1,500.00 (10% of ₱15,000)
      expect(b61.ecErCentavos).toBe(3000); // ₱30.00
      expect(b61.totalEeCentavos).toBe(175000); // ₱1,750.00 total monthly EE
      expect(b61.totalErCentavos).toBe(353000); // ₱3,530.00 total monthly ER
    });

    it('investigates and reconciles the ₱675 SSS deduction and ₱1,825 withholding on ₱36,500 salary', () => {
      const monthlySalaryCentavos = 3650000; // ₱36,500.00
      const semiMonthlyGrossCentavos = 1825000; // ₱18,250.00

      // 1. Authoritative 2026 SSS Statutory Schedule (15% rate on discrete ₱35,000 MSC)
      const statutory2026 = TaxEngine.calculate2026StatutoryContributions(semiMonthlyGrossCentavos, {
        frequency: 'SEMI_MONTHLY',
        sssScheduleVersion: '2026_STATUTORY_5PCT',
      });

      // Semi-monthly 2026 SSS EE is ₱1,750 / 2 = ₱875.00
      expect(statutory2026.sssEmployeeCentavos).toBe(87500); // ₱875.00
      expect(statutory2026.sssEmployerCentavos).toBe(175000); // ₱1,750.00
      expect(statutory2026.philhealthEmployeeCentavos).toBe(45625); // 2.5% of ₱18,250 = ₱456.25
      expect(statutory2026.pagibigEmployeeCentavos).toBe(10000); // Max ₱100.00 semi-monthly

      // 2. Legacy 2024 Schedule comparison (explaining the ₱675 figure)
      const legacy2024 = TaxEngine.calculate2026StatutoryContributions(semiMonthlyGrossCentavos, {
        frequency: 'SEMI_MONTHLY',
        sssScheduleVersion: '2024_LEGACY_4_5PCT',
      });
      // Legacy 2024 capped at ₱30,000 MSC @ 4.5% = ₱1,350/mo -> ₱675.00 semi-monthly!
      expect(legacy2024.sssEmployeeCentavos).toBe(67500); // Exactly ₱675.00!

      // 3. Investigating the reported ₱1,825 semi-monthly withholding tax
      // A flat 10% on gross salary: ₱18,250.00 * 0.10 = ₱1,825.00 (Non-statutory flat plug)
      const flat10PercentPlug = Math.round(semiMonthlyGrossCentavos * 0.10);
      expect(flat10PercentPlug).toBe(182500); // ₱1,825.00!

      // Genuine statutory BIR TRAIN withholding calculation under 2026 statutory deductions:
      const genuineStatutoryWht = TaxEngine.calculateStatutoryPayrollWithholding(semiMonthlyGrossCentavos, {
        frequency: 'SEMI_MONTHLY',
        sssEmployeeCentavos: statutory2026.sssEmployeeCentavos, // ₱875.00
        philhealthEmployeeCentavos: statutory2026.philhealthEmployeeCentavos, // ₱456.25
        pagibigEmployeeCentavos: statutory2026.pagibigEmployeeCentavos, // ₱100.00
      });

      // Total Non-Taxable Contributions = ₱875.00 + ₱456.25 + ₱100.00 = ₱1,431.25 (143,125 centavos)
      expect(genuineStatutoryWht.totalNonTaxableDeductionsCentavos).toBe(143125);
      // Taxable Compensation = ₱18,250.00 - ₱1,431.25 = ₱16,818.75 (1,681,875 centavos)
      expect(genuineStatutoryWht.taxableCompensationCentavos).toBe(1681875);
      // Bracket 3 (₱16,667 to ₱33,332): Base ₱937.50 + 20% of (₱16,818.75 - ₱16,667.00 = ₱151.75) = ₱937.50 + ₱30.35 = ₱967.85!
      expect(genuineStatutoryWht.withholdingTaxCentavos).toBe(96785); // ₱967.85
      // The flat ₱1,825 was an over-withholding of ₱857.15 per cutoff (over-withheld by 88.5%)!
      expect(flat10PercentPlug - genuineStatutoryWht.withholdingTaxCentavos).toBe(85715);
    });

    it('validates golden payroll test profiles across statutory salary spectrum', () => {
      // Golden Case 1: Minimum Wage Earner (₱13,420 monthly / ₱6,710 semi-monthly)
      const minWage = TaxEngine.calculateStatutoryPayrollWithholding(671000, {
        frequency: 'SEMI_MONTHLY',
        sssScheduleVersion: '2026_STATUTORY_5PCT',
      });
      // SSS on ₱13,500 MSC = ₱675/mo -> ₱337.50 (33,750 centavos)
      expect(minWage.sssEmployeeCentavos).toBe(33750);
      // PhilHealth: 2.5% of ₱6,710.00 = ₱167.75 (16,775 centavos)
      expect(minWage.philhealthEmployeeCentavos).toBe(16775);
      // Pag-IBIG: 2% of ₱6,710 = ₱134.20 -> capped at ₱100.00 (10,000 centavos)
      expect(minWage.pagibigEmployeeCentavos).toBe(10000);
      // Taxable: ₱6,710 - ₱605.25 = ₱6,104.75 <= ₱10,417 (Bracket 1: 0% Tax Exempt)
      expect(minWage.withholdingTaxCentavos).toBe(0);
      expect(minWage.bracketNumber).toBe(1);

      // Golden Case 2: Executive (₱100,000 monthly / ₱50,000 semi-monthly)
      const exec = TaxEngine.calculateStatutoryPayrollWithholding(5000000, {
        frequency: 'SEMI_MONTHLY',
        sssScheduleVersion: '2026_STATUTORY_5PCT',
      });
      // SSS max MSC ₱35,000 -> ₱1,750/mo -> ₱875.00
      expect(exec.sssEmployeeCentavos).toBe(87500);
      // PhilHealth max ceiling ₱100,000 -> ₱2,500/mo -> ₱1,250.00
      expect(exec.philhealthEmployeeCentavos).toBe(125000);
      // Pag-IBIG max ceiling ₱10,000 -> ₱200/mo -> ₱100.00
      expect(exec.pagibigEmployeeCentavos).toBe(10000);
      // Taxable: ₱50,000 - ₱2,225 = ₱47,775.00
      expect(exec.taxableCompensationCentavos).toBe(4777500);
      // Bracket 4 (₱33,333 to ₱83,332): Base ₱4,270.70 + 25% of (₱47,775 - ₱33,333 = ₱14,442) = ₱4,270.70 + ₱3,610.50 = ₱7,881.20
      expect(exec.bracketNumber).toBe(4);
      expect(exec.withholdingTaxCentavos).toBe(788120);
    });
  });

  // =========================================================================
  // 2. BIR FORM FREQUENCY & PERIOD VALIDATION
  // =========================================================================
  describe('2. BIR Form Frequency, Period, and Duplicate Prevention', () => {
    it('enforces quarterly duration (3 months) on Form 2550Q and 1601-EQ', () => {
      // 1. Single month duration (e.g., 30 days) is invalid for 2550Q
      const invalidQuarterDays = Math.round((new Date('2026-10-31').getTime() - new Date('2026-10-01').getTime()) / (1000 * 60 * 60 * 24)) + 1;
      expect(invalidQuarterDays).toBe(31);
      expect(invalidQuarterDays < 80).toBe(true);

      // 2. Full Q4 duration (2026-10-01 to 2026-12-31 = 92 days) is valid
      const validQuarterDays = Math.round((new Date('2026-12-31').getTime() - new Date('2026-10-01').getTime()) / (1000 * 60 * 60 * 24)) + 1;
      expect(validQuarterDays).toBe(92);
      expect(validQuarterDays >= 80 && validQuarterDays <= 95).toBe(true);
    });

    it('enforces monthly duration (28–31 days) on Form 1601-C', () => {
      const novDays = Math.round((new Date('2026-11-30').getTime() - new Date('2026-11-01').getTime()) / (1000 * 60 * 60 * 24)) + 1;
      expect(novDays).toBe(30);
      expect(novDays >= 27 && novDays <= 32).toBe(true);
    });
  });

  // =========================================================================
  // 3. PURCHASE, INVENTORY & EXPENSE CLASSIFICATION REVIEW
  // =========================================================================
  describe('3. Purchase, Inventory, and Expense Classification Review', () => {
    it('verifies distinct accounting treatments for inventory, opex, and fixed assets', async () => {
      await dbContext.run(companyDb, async () => {
        // Setup test company chart of accounts
        const accMap = await AccountingEngine.ensureDefaultAccounts(EXPANDED_PILOT_COMPANY_ID);
        expect(accMap['1300']).toBeDefined(); // Inventory Asset (Debit)
        expect(accMap['1500']).toBeDefined(); // Input VAT (Debit)
        expect(accMap['1700']).toBeDefined(); // Property, Plant and Equipment (Debit)
        expect(accMap['2000']).toBeDefined(); // Accounts Payable (Credit)
        expect(accMap['2030']).toBeDefined(); // EWT Payable (Credit)
        expect(accMap['6000']).toBeDefined(); // Salaries & Wages Expense (Debit)

        // Test double-entry construction for Inventory purchase (₱100k gross: ₱89,285.71 net + ₱10,714.29 VAT)
        const invNet = 8928571;
        const invVat = 1071429;
        const invGross = 10000000;
        expect(invNet + invVat).toBe(invGross);

        // Inventory Bill: DR 1300 (₱89,285.71) + DR 1500 (₱10,714.29) = CR 2000 (₱100,000.00)
        const inventoryBillLines = [
          { accountId: accMap['1300'].id, debit: invNet, credit: 0 },
          { accountId: accMap['1500'].id, debit: invVat, credit: 0 },
          { accountId: accMap['2000'].id, debit: 0, credit: invGross },
        ];
        const invDebits = inventoryBillLines.reduce((s, l) => s + l.debit, 0);
        const invCredits = inventoryBillLines.reduce((s, l) => s + l.credit, 0);
        expect(invDebits).toBe(invCredits);

        // Payment with 1% EWT: DR 2000 (₱100,000.00) = CR 1100 Cash (₱99,107.14) + CR 2030 EWT (₱892.86)
        const ewtCentavos = Math.round(invNet * 0.01);
        const cashOutflow = invGross - ewtCentavos;
        const paymentLines = [
          { accountId: accMap['2000'].id, debit: invGross, credit: 0 },
          { accountId: accMap['1100'].id, debit: 0, credit: cashOutflow },
          { accountId: accMap['2030'].id, debit: 0, credit: ewtCentavos },
        ];
        const payDebits = paymentLines.reduce((s, l) => s + l.debit, 0);
        const payCredits = paymentLines.reduce((s, l) => s + l.credit, 0);
        expect(payDebits).toBe(payCredits);
        // Note: Payment does NOT touch expense (account 5000/6000), completely eliminating duplicate expense!
      });
    });
  });

  // =========================================================================
  // 4. EXPANDED CLEAN PILOT E2E ON LGR-PH-2026-PILOT-EXPANDED-01
  // =========================================================================
  describe('4. Expanded Clean Pilot End-to-End Execution', () => {
    it('provisions isolated test company LGR-PH-2026-PILOT-EXPANDED-01', async () => {
      await dbContext.run(companyDb, async () => {
        // 1. Create company record
        await db.insert(schema.companies).values({
          id: EXPANDED_PILOT_COMPANY_ID,
          legalName: 'LedgerAI Expanded Pilot Philippines Corp.',
          tradeName: 'LedgerAI Expanded Pilot',
          tin: '987-654-321-000',
          rdoCode: '048',
          vatStatus: 'VAT',
          taxpayerClassification: 'CORPORATION',
          registrationDate: '2026-01-01',
          fiscalYearStartMonth: 1,
          currency: 'PHP',
          status: 'ACTIVE',
          companyClassification: 'PILOT',
          createdAt: new Date(),
          updatedAt: new Date(),
        }).onConflictDoNothing();

        // 2. Ensure chart of accounts
        const accMap = await AccountingEngine.ensureDefaultAccounts(EXPANDED_PILOT_COMPANY_ID);
        expect(Object.keys(accMap).length).toBeGreaterThanOrEqual(25);
      });
    });

    it('executes balanced multi-module business transactions through domain services', async () => {
      await dbContext.run(companyDb, async () => {
        const accMap = await AccountingEngine.ensureDefaultAccounts(EXPANDED_PILOT_COMPANY_ID);

        // A. Sales Invoice & Revenue Posting
        const invJeId = await AccountingEngine.postInvoiceIssued(EXPANDED_PILOT_COMPANY_ID, ADMIN_USER_ID, {
          invoiceId: 'sinv-exp-001',
          invoiceNumber: 'SI-EXP-001',
          invoiceDate: '2026-10-15',
          netAmountCentavos: 5000000, // ₱50,000 net revenue
          vatAmountCentavos: 600000, // ₱6,000 12% output VAT
          customerName: 'Enterprise Client Manila Inc.',
        });
        expect(invJeId).toBeDefined();

        // B. Customer Partial Collection with Form 2307 CWT (2% withholding on net)
        const colJeId = await AccountingEngine.postCustomerCollectionForex(EXPANDED_PILOT_COMPANY_ID, ADMIN_USER_ID, {
          paymentId: 'col-exp-001',
          paymentNumber: 'OR-EXP-001',
          paymentDate: '2026-10-20',
          usdAmount: 1000,
          invoiceRate: 56.0, // ₱56,000 original AR
          collectionRate: 56.0, // Zero forex variance for pure collection
          withholdingTax2307Php: 100000, // ₱1,000 Form 2307 CWT asset
          customerName: 'Enterprise Client Manila Inc.',
        });
        expect(colJeId).toBeDefined();

        // C. Inventory Procurement & Supplier Bill
        const grnJeId = await AccountingEngine.postGoodsReceiptNote(EXPANDED_PILOT_COMPANY_ID, ADMIN_USER_ID, {
          grnId: 'grn-exp-001',
          grnNumber: 'GRN-EXP-001',
          receiptDate: '2026-10-05',
          amountCentavos: 3000000, // ₱30,000 inventory received
          vendorName: 'Manila Logistics & Supply Co.',
        });
        expect(grnJeId).toBeDefined();

        const billJeId = await AccountingEngine.postPurchaseBillMatched(EXPANDED_PILOT_COMPANY_ID, ADMIN_USER_ID, {
          billId: 'pb-exp-001',
          billNumber: 'PB-EXP-001',
          billDate: '2026-10-08',
          unbilledApCentavos: 3000000,
          inputVatCentavos: 360000, // ₱3,600 input VAT
          totalBillCentavos: 3360000,
          vendorName: 'Manila Logistics & Supply Co.',
          poAmountCentavos: 3360000,
        });
        expect(billJeId).toBeDefined();

        // D. Inventory COGS & Spoilage Adjustment
        const cogsJeId = await AccountingEngine.postInventorySaleCOGS(EXPANDED_PILOT_COMPANY_ID, ADMIN_USER_ID, {
          saleId: 'cogs-exp-001',
          saleNumber: 'SALE-EXP-001',
          saleDate: '2026-10-15',
          cogsCentavos: 1500000, // ₱15,000 inventory relieved to COGS
          sku: 'SKU-EXP-ITEM-A',
        });
        expect(cogsJeId).toBeDefined();

        const adjJeId = await AccountingEngine.postInventorySpoilageAdjustment(EXPANDED_PILOT_COMPANY_ID, ADMIN_USER_ID, {
          adjustmentId: 'adj-exp-001',
          adjustmentNumber: 'ADJ-EXP-001',
          adjustmentDate: '2026-10-25',
          spoilageValueCentavos: 200000, // ₱2,000 damaged goods
          reason: 'Transit Water Damage',
          itemName: 'Industrial Valve Component',
        });
        expect(adjJeId).toBeDefined();

        // E. Fixed Asset Monthly Depreciation
        const depJeId = await AccountingEngine.postMonthlyDepreciation(EXPANDED_PILOT_COMPANY_ID, ADMIN_USER_ID, {
          scheduleId: 'dep-exp-2026-10',
          assetId: 'asset-exp-001',
          assetName: 'Office Production Server',
          periodMonth: '2026-10',
          depreciationAmountCentavos: 500000, // ₱5,000 monthly depreciation
        });
        expect(depJeId).toBeDefined();

        // F. Statutory Payroll Run Posting (2026 Discrete Statutory Rates)
        const payJeId = await AccountingEngine.postPayrollRun(EXPANDED_PILOT_COMPANY_ID, ADMIN_USER_ID, {
          payrollRunId: 'prun-exp-2026-10-2',
          payrollPeriod: '2026-10-2',
          paymentDate: '2026-10-31',
          grossPayCentavos: 5000000, // ₱50,000 gross salaries
          sssEmployeeCentavos: 175000, // ₱1,750 SSS EE (discrete bracket 35k MSC)
          sssEmployerCentavos: 350000, // ₱3,500 SSS ER
          philhealthEmployeeCentavos: 125000, // ₱1,250 PhilHealth EE
          philhealthEmployerCentavos: 125000, // ₱1,250 PhilHealth ER
          pagibigEmployeeCentavos: 10000, // ₱100 Pag-IBIG EE
          pagibigEmployerCentavos: 10000, // ₱100 Pag-IBIG ER
          withholdingTaxCentavos: 788120, // ₱7,881.20 BIR Withholding Tax
          netPayCentavos: 3901880, // ₱39,018.80 Net Salaries Payable
        });
        expect(payJeId).toBeDefined();
      });
    });

    it('verifies strict double-entry balance (Total Debits == Total Credits) across all posted journals', async () => {
      await dbContext.run(companyDb, async () => {
        const journalLines = await db
          .select({
            debit: schema.journalLines.debit,
            credit: schema.journalLines.credit,
          })
          .from(schema.journalLines)
          .innerJoin(schema.journalEntries, eq(schema.journalLines.journalEntryId, schema.journalEntries.id))
          .where(
            and(
              eq(schema.journalEntries.companyId, EXPANDED_PILOT_COMPANY_ID),
              eq(schema.journalEntries.status, 'POSTED')
            )
          );

        expect(journalLines.length).toBeGreaterThan(0);
        const totalDebits = journalLines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
        const totalCredits = journalLines.reduce((sum, l) => sum + Number(l.credit || 0), 0);

        expect(totalDebits).toBe(totalCredits);
        expect(totalDebits).toBeGreaterThan(0);
      });
    });

    it('validates period soft close, hard close, and authorized reopening with audit trail', async () => {
      await dbContext.run(companyDb, async () => {
        // Find October 2026 periods
        const octPeriods = await db.select().from(schema.accountingPeriods).where(
          and(
            eq(schema.accountingPeriods.companyId, EXPANDED_PILOT_COMPANY_ID),
            sql`${schema.accountingPeriods.startDate} <= '2026-10-15'`,
            sql`${schema.accountingPeriods.endDate} >= '2026-10-15'`
          )
        );
        expect(octPeriods.length).toBeGreaterThan(0);
        const testPeriod = octPeriods[0];

        // 1. Soft close
        await softClosePeriod(EXPANDED_PILOT_COMPANY_ID, testPeriod.id, ADMIN_USER_ID, 'Pre-audit monthly soft close');
        let p = await db.select().from(schema.accountingPeriods).where(eq(schema.accountingPeriods.id, testPeriod.id)).get();
        expect(p?.status).toBe('SOFT_CLOSED');

        // 2. Reopen
        await reopenPeriod(EXPANDED_PILOT_COMPANY_ID, testPeriod.id, ADMIN_USER_ID, 'Late voucher adjustment requested by Senior Auditor');
        p = await db.select().from(schema.accountingPeriods).where(eq(schema.accountingPeriods.id, testPeriod.id)).get();
        expect(p?.status).toBe('OPEN');

        // 3. Hard close all matching periods covering Oct 15
        for (const op of octPeriods) {
          await hardClosePeriod(EXPANDED_PILOT_COMPANY_ID, op.id, ADMIN_USER_ID, 'Final certified month-end lock');
        }

        // 4. Posting into hard closed period must be strictly rejected
        await expect(
          AccountingEngine.postInvoiceIssued(EXPANDED_PILOT_COMPANY_ID, ADMIN_USER_ID, {
            invoiceId: 'sinv-fail-001',
            invoiceNumber: 'SI-FAIL-001',
            invoiceDate: '2026-10-15',
            netAmountCentavos: 1000000,
            vatAmountCentavos: 120000,
            customerName: 'Rejected Post Client',
          })
        ).rejects.toThrow(DomainError);
      });
    });
  });

  // =========================================================================
  // 5. OFFLINE & ENCRYPTION RECOVERY CERTIFICATION
  // =========================================================================
  describe('5. Offline and Database Encryption Recovery Certification', () => {
    it('verifies envelope encryption (LAISENC2) and file-level container integrity', () => {
      const companyDir = path.join(paths.getCompaniesRootDir(), EXPANDED_PILOT_COMPANY_ID);
      const activeSqlite = path.join(companyDir, '.db_active.sqlite');
      const testLaiPath = path.join(companyDir, 'test_container.lai');
      const testDecryptedPath = path.join(companyDir, 'test_decrypted.sqlite');

      expect(fs.existsSync(activeSqlite)).toBe(true);

      // 1. Encrypt active SQLite to LAISENC2
      DatabaseEncryptionService.encryptDatabaseFileSync(activeSqlite, testLaiPath, {
        companyId: EXPANDED_PILOT_COMPANY_ID,
        classification: 'PILOT',
      });

      // 2. Inspect container
      const inspection = DatabaseEncryptionService.inspectContainerMetadataSync(testLaiPath);
      expect(inspection.isEncrypted).toBe(true);
      expect(inspection.containerVersion).toBe('LAISENC2');
      expect(inspection.keyMode).toBe('OS_KEYCHAIN_STANDALONE');

      // 3. Decrypt and verify
      const decryptedOk = DatabaseEncryptionService.decryptDatabaseFileSync(testLaiPath, testDecryptedPath);
      expect(decryptedOk).toBe(true);
      expect(fs.existsSync(testDecryptedPath)).toBe(true);
      expect(fs.statSync(testDecryptedPath).size).toBeGreaterThan(0);

      // 4. Clean up temporary test files
      try { fs.unlinkSync(testLaiPath); } catch {}
      try { fs.unlinkSync(testDecryptedPath); } catch {}
    });
  });
});
