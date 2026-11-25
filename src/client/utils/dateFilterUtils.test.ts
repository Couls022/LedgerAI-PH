import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePresetDateRange,
  matchesDateTimeFilter,
  isWorkspaceFilterActive,
  formatFilterSummaryLabel,
  computeDashboardPercentageMetrics,
  DEFAULT_WORKSPACE_FILTER,
} from './dateFilterUtils';

describe('dateFilterUtils — Presets & Date/Time Matching', () => {
  const refDate = new Date(2026, 10, 19); // Nov 19, 2026 (Thursday)

  it('computes accurate preset ranges for TODAY, THIS_WEEK, THIS_MONTH, THIS_QUARTER, YTD', () => {
    assert.deepEqual(computePresetDateRange('TODAY', refDate), {
      dateFrom: '2026-11-19',
      dateTo: '2026-11-19',
    });
    assert.deepEqual(computePresetDateRange('THIS_WEEK', refDate), {
      dateFrom: '2026-11-16', // Monday
      dateTo: '2026-11-19',
    });
    assert.deepEqual(computePresetDateRange('THIS_MONTH', refDate), {
      dateFrom: '2026-11-01',
      dateTo: '2026-11-19',
    });
    assert.deepEqual(computePresetDateRange('THIS_QUARTER', refDate), {
      dateFrom: '2026-10-01',
      dateTo: '2026-11-19',
    });
    assert.deepEqual(computePresetDateRange('YTD', refDate), {
      dateFrom: '2026-01-01',
      dateTo: '2026-11-19',
    });
    assert.deepEqual(computePresetDateRange('ALL', refDate), {
      dateFrom: '',
      dateTo: '',
    });
  });

  it('filters timestamped records accurately by date and HH:MM time window', () => {
    const filter = {
      dateFrom: '2026-11-15',
      dateTo: '2026-11-19',
      timeFrom: '09:00',
      timeTo: '17:30',
    };

    assert.equal(matchesDateTimeFilter(new Date(2026, 10, 17, 10, 30), filter), true);
    assert.equal(matchesDateTimeFilter(new Date(2026, 10, 17, 8, 59), filter), false);
    assert.equal(matchesDateTimeFilter(new Date(2026, 10, 17, 18, 0), filter), false);
    assert.equal(matchesDateTimeFilter(new Date(2026, 10, 14, 12, 0), filter), false);
    assert.equal(matchesDateTimeFilter('2026-11-18', filter), true);
    assert.equal(matchesDateTimeFilter('2026-11-20', filter), false);
    assert.equal(matchesDateTimeFilter(null, filter), false);
  });

  it('detects active filter state and formats human-readable summaries', () => {
    assert.equal(isWorkspaceFilterActive(DEFAULT_WORKSPACE_FILTER), false);
    assert.equal(
      isWorkspaceFilterActive({ ...DEFAULT_WORKSPACE_FILTER, preset: 'THIS_MONTH', dateFrom: '2026-11-01', dateTo: '2026-11-19' }),
      true
    );
    assert.equal(
      formatFilterSummaryLabel({
        preset: 'CUSTOM',
        dateFrom: '2026-11-01',
        dateTo: '2026-11-19',
        timeFrom: '08:00',
        timeTo: '17:00',
        searchQuery: 'INV-100',
      }),
      '2026-11-01 to 2026-11-19 • 08:00–17:00 • "INV-100"'
    );
  });
});

describe('dateFilterUtils — Source-of-Truth Percentage Widgets', () => {
  it('never fabricates percentages when a company has zero posted records', () => {
    const metrics = computeDashboardPercentageMetrics({
      summaryStats: { totalYtdRevenue: 0, totalYtdExpenses: 0, totalYtdNetProfit: 0 },
      reconciliationSummary: {
        tbBalanced: true,
        postedJournalLinesCount: 0,
        unpostedJournalsCount: 0,
        arVarianceCentavos: 0,
        apVarianceCentavos: 0,
      },
      taxEstimate: { outputVat: 0, inputVat: 0, primaryForm: 'BIR Form 2550Q' },
    });

    assert.equal(metrics.length, 4);
    for (const m of metrics) {
      assert.equal(m.percentage, null);
      assert.equal(m.displayValue, 'N/A');
      assert.equal(m.ringFillPercent, 0);
    }
  });

  it('computes exact ratios from real posted financial and reconciliation figures', () => {
    const metrics = computeDashboardPercentageMetrics({
      summaryStats: {
        totalYtdRevenue: 1_000_000_00, // PHP 1,000,000
        totalYtdExpenses: 650_000_00, // PHP 650,000
        totalYtdNetProfit: 350_000_00, // PHP 350,000
      },
      reconciliationSummary: {
        tbBalanced: true,
        postedJournalLinesCount: 42,
        unpostedJournalsCount: 2, // Draft workflows in progress do not break ledger integrity
        postingIntegrityOk: true,
        arVarianceCentavos: 0,
        apVarianceCentavos: 0,
      },
      taxEstimate: {
        vatStatus: 'VAT',
        outputVat: 120_000_00,
        inputVat: 48_000_00, // 40% offset
        primaryForm: 'BIR Form 2550Q',
      },
    });

    const byId = Object.fromEntries(metrics.map((m) => [m.id, m]));
    assert.equal(byId['net-operating-margin'].percentage, 35);
    assert.equal(byId['net-operating-margin'].displayValue, '35.0%');
    assert.equal(byId['expense-ratio'].percentage, 65);
    assert.equal(byId['control-integrity'].percentage, 100);
    assert.equal(byId['control-integrity'].tone, 'teal');
    assert.equal(byId['vat-credit-offset'].percentage, 40);

    // Verify failing posting integrity drops health to 75% amber
    const degraded = computeDashboardPercentageMetrics({
      reconciliationSummary: {
        tbBalanced: true,
        postedJournalLinesCount: 42,
        postingIntegrityOk: false,
        arVarianceCentavos: 0,
        apVarianceCentavos: 0,
      },
    });
    const degradedHealth = degraded.find((m) => m.id === 'control-integrity')!;
    assert.equal(degradedHealth.percentage, 75);
    assert.equal(degradedHealth.tone, 'amber');
  });

  it('adapts tax card to 3.0% Percentage Tax Rate (2551Q) for Non-VAT companies', () => {
    const metrics = computeDashboardPercentageMetrics({
      summaryStats: {
        totalYtdRevenue: 714_000_00,
        totalYtdExpenses: 300_000_00,
        totalYtdNetProfit: 414_000_00,
      },
      taxEstimate: {
        vatStatus: 'NON_VAT',
        grossReceiptsCentavos: 714_000_00,
        percentageTaxRate: 0.03,
        percentageTaxPayable: 21_420_00,
        estimatedTaxLiability: 21_420_00,
        primaryForm: 'BIR Form 2551Q',
        periodLabel: 'Q4 2026',
      },
    });

    const taxCard = metrics.find((m) => m.id === 'vat-credit-offset')!;
    assert.ok(taxCard, 'Expected BIR tax card for Non-VAT 2551Q company');
    assert.equal(taxCard.displayValue, '3.0%');
    assert.equal(taxCard.label, 'Percentage Tax Rate (2551Q)');
    assert.equal(taxCard.tone, 'teal');
  });

  it('reports negative operating margins honestly while keeping ring fill non-negative', () => {
    const metrics = computeDashboardPercentageMetrics({
      summaryStats: {
        totalYtdRevenue: 500_000_00,
        totalYtdExpenses: 600_000_00,
        totalYtdNetProfit: -100_000_00,
      },
    });
    const margin = metrics.find((m) => m.id === 'net-operating-margin')!;
    assert.equal(margin.percentage, -20);
    assert.equal(margin.displayValue, '-20.0%');
    assert.equal(margin.ringFillPercent, 0);
    assert.equal(margin.tone, 'rose');
  });
});
