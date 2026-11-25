import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTrialBalanceIntegrityStatus,
  computeWorkingCapitalAndSolvency,
  resolveVatOrPercentageFilingRule,
  computeOperationsRollupsPure,
} from './financialSourceOfTruth';

describe('financialSourceOfTruth pure calculations', () => {
  describe('computeTrialBalanceIntegrityStatus', () => {
    it('reports NO_RECORDS when no posted journal lines exist', () => {
      const res = computeTrialBalanceIntegrityStatus({
        totalDebitsCentavos: 0,
        totalCreditsCentavos: 0,
        postedJournalLineCount: 0,
      });
      assert.equal(res.status, 'NO_RECORDS');
      assert.equal(res.balanced, true);
      assert.equal(res.label, 'No Posted Entries');
    });

    it('reports OK when debits equal credits across posted lines', () => {
      const res = computeTrialBalanceIntegrityStatus({
        totalDebitsCentavos: 2500000,
        totalCreditsCentavos: 2500000,
        postedJournalLineCount: 14,
      });
      assert.equal(res.status, 'OK');
      assert.equal(res.balanced, true);
      assert.equal(res.varianceCentavos, 0);
      assert.match(res.label, /Balanced/i);
    });

    it('reports IMBALANCED with exact centavo variance when debits != credits', () => {
      const res = computeTrialBalanceIntegrityStatus({
        totalDebitsCentavos: 2505000,
        totalCreditsCentavos: 2500000,
        postedJournalLineCount: 6,
      });
      assert.equal(res.status, 'IMBALANCED');
      assert.equal(res.balanced, false);
      assert.equal(res.varianceCentavos, 5000);
      assert.match(res.explanation, /50\.00/);
    });
  });

  describe('computeWorkingCapitalAndSolvency', () => {
    it('returns NO_RECORDS and null ratios when no posted balances exist', () => {
      const res = computeWorkingCapitalAndSolvency({
        currentAssetsCentavos: 0,
        currentLiabilitiesCentavos: 0,
        totalAssetsCentavos: 0,
        totalLiabilitiesCentavos: 0,
        totalEquityCentavos: 0,
        hasPostedBalances: false,
      });
      assert.equal(res.status, 'NO_RECORDS');
      assert.equal(res.currentRatio, null);
      assert.equal(res.debtToEquityRatio, null);
    });

    it('computes working capital, current ratio, and debt-to-equity accurately', () => {
      const res = computeWorkingCapitalAndSolvency({
        currentAssetsCentavos: 1200000, // ₱12,000
        currentLiabilitiesCentavos: 400000, // ₱4,000
        totalAssetsCentavos: 2000000,
        totalLiabilitiesCentavos: 500000,
        totalEquityCentavos: 1500000,
        hasPostedBalances: true,
      });
      assert.equal(res.status, 'OK');
      assert.equal(res.workingCapitalCentavos, 800000);
      assert.equal(res.currentRatio, 3);
      assert.equal(res.debtToEquityRatio, 33.3);
      assert.equal(res.explanation, null);
    });

    it('explains undefined current ratio when current liabilities are zero', () => {
      const res = computeWorkingCapitalAndSolvency({
        currentAssetsCentavos: 500000,
        currentLiabilitiesCentavos: 0,
        totalAssetsCentavos: 500000,
        totalLiabilitiesCentavos: 0,
        totalEquityCentavos: 500000,
        hasPostedBalances: true,
      });
      assert.equal(res.currentRatio, null);
      assert.match(res.explanation || '', /No posted current liabilities/i);
    });
  });

  describe('resolveVatOrPercentageFilingRule', () => {
    const refDate = new Date('2026-11-16T00:00:00Z'); // Q4 2026

    it('defaults VAT taxpayers to quarterly 2550Q (RMC 5-2023) while preserving optional 2550M (RMC 52-2023)', () => {
      const rule = resolveVatOrPercentageFilingRule({
        vatStatus: 'VAT',
        vatFilingFrequency: 'QUARTERLY',
        referenceDate: refDate,
      });
      assert.equal(rule.vatFilingFrequency, 'QUARTERLY');
      assert.match(rule.primaryVatOrPercentageForm, /2550Q/);
      assert.match(rule.primaryVatOrPercentageForm, /2550M/);
      assert.match(rule.dueDateNotice, /2027-01-25/);
      assert.match(rule.ruleReference, /RMC 5-2023/);
      assert.match(rule.ruleReference, /RMC 52-2023/);
    });

    it('supports optional monthly 2550M election under RMC 52-2023', () => {
      const rule = resolveVatOrPercentageFilingRule({
        vatStatus: 'VAT',
        vatFilingFrequency: 'MONTHLY_OPTIONAL',
        referenceDate: refDate,
      });
      assert.equal(rule.vatFilingFrequency, 'MONTHLY_OPTIONAL');
      assert.equal(rule.primaryVatOrPercentageForm, '2550M / 2550Q');
      assert.match(rule.dueDateNotice, /2026-12-20/);
      assert.match(rule.dueDateNotice, /2027-01-25/);
    });

    it('routes NON_VAT taxpayers to quarterly Form 2551Q', () => {
      const rule = resolveVatOrPercentageFilingRule({
        vatStatus: 'NON_VAT',
        referenceDate: refDate,
      });
      assert.equal(rule.primaryVatOrPercentageForm, '2551Q');
      assert.match(rule.dueDateNotice, /2027-01-25/);
    });

    it('marks EXEMPT / BMBE / PEZA_BOI without forcing VAT forms', () => {
      const rule = resolveVatOrPercentageFilingRule({
        vatStatus: 'BMBE',
        referenceDate: refDate,
      });
      assert.equal(rule.vatFilingFrequency, 'NONE');
      assert.equal(rule.primaryVatOrPercentageForm, 'EXEMPT');
    });
  });

  describe('computeOperationsRollupsPure', () => {
    it('keeps inventory valuation strictly in integer centavos (no 100x scaling bug) and detects GL variance', () => {
      const res = computeOperationsRollupsPure({
        inventoryItems: [
          { quantityOnHand: 10, unitCost: 25000, reorderPoint: 5, costingMethod: 'WEIGHTED_AVERAGE' }, // 10 * ₱250 = ₱2,500 (250,000c)
          { quantityOnHand: 2, unitCost: 15000, reorderPoint: 5, costingMethod: 'FIFO' }, // 2 * ₱150 = ₱300 (30,000c), low stock
        ],
        fixedAssets: [
          { acquisitionCostCentavos: 1000000, accumulatedDepreciationCentavos: 250000, status: 'ACTIVE' },
        ],
        pendingMonthlyDepCentavos: 10000,
        postedMonthlyDepCentavos: 0,
        unpaidSalesCentavos: 560000,
        outputVatCentavos: 60000,
        totalInvoicesCount: 3,
        postedInvoicesCount: 2,
        draftInvoicesCount: 1,
        vatStatus: 'VAT',
        payrollEmployeesCount: 4,
        latestPayrollRun: null,
        postedPayrollRunsCount: 0,
        purchaseOrders: [{ status: 'APPROVED', totalAmount: 120000 }],
        grnCount: 1,
        bankAccountsCount: 1,
        reconciliations: [],
        unmatchedBankLinesCount: 0,
        inventoryGlBalanceCentavos: 280000, // Exact match to 250,000 + 30,000
        arGlBalanceCentavos: 500000, // Variance = +60,000c
      });

      assert.equal(res.inventory.totalQuantityOnHand, 12);
      assert.equal(res.inventory.stockValuationCentavos, 280000);
      assert.equal(res.inventory.lowStockCount, 1);
      assert.equal(res.inventory.inventoryVarianceCentavos, 0);
      assert.equal(res.inventory.status, 'OK');

      assert.equal(res.sales.arVarianceCentavos, 60000);
      assert.equal(res.sales.status, 'PENDING_RECONCILIATION');

      assert.equal(res.fixedAssets.netBookValueCentavos, 750000);
      assert.equal(res.fixedAssets.status, 'NOT_POSTED');

      assert.equal(res.payroll.status, 'NOT_POSTED');
      assert.equal(res.banking.status, 'PENDING_RECONCILIATION');
    });

    it('reports NO_RECORDS honestly across empty modules', () => {
      const res = computeOperationsRollupsPure({
        inventoryItems: [],
        fixedAssets: [],
        pendingMonthlyDepCentavos: 0,
        postedMonthlyDepCentavos: 0,
        unpaidSalesCentavos: 0,
        outputVatCentavos: 0,
        totalInvoicesCount: 0,
        postedInvoicesCount: 0,
        draftInvoicesCount: 0,
        vatStatus: 'VAT',
        payrollEmployeesCount: 0,
        latestPayrollRun: null,
        postedPayrollRunsCount: 0,
        purchaseOrders: [],
        grnCount: 0,
        bankAccountsCount: 0,
        reconciliations: [],
        unmatchedBankLinesCount: 0,
        inventoryGlBalanceCentavos: 0,
        arGlBalanceCentavos: 0,
      });

      assert.equal(res.sales.status, 'NO_RECORDS');
      assert.equal(res.inventory.status, 'NO_RECORDS');
      assert.equal(res.payroll.status, 'NO_RECORDS');
      assert.equal(res.fixedAssets.status, 'NO_RECORDS');
      assert.equal(res.procurement.status, 'NO_RECORDS');
      assert.equal(res.banking.status, 'NO_RECORDS');
    });
  });
});
