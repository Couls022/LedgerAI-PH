/**
 * Pure Date/Time Filter & Source-of-Truth Percentage Utilities
 * Framework-agnostic helpers verified by node:test.
 */

export type DateFilterPreset =
  | 'ALL'
  | 'TODAY'
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'RECENT_1_MONTH'
  | 'THIS_QUARTER'
  | 'YTD'
  | 'CUSTOM';

export interface WorkspaceFilterState {
  preset: DateFilterPreset;
  dateFrom: string; // YYYY-MM-DD or ''
  dateTo: string;   // YYYY-MM-DD or ''
  timeFrom: string; // HH:MM or ''
  timeTo: string;   // HH:MM or ''
  searchQuery: string;
}

export const DEFAULT_WORKSPACE_FILTER: WorkspaceFilterState = {
  preset: 'ALL',
  dateFrom: '',
  dateTo: '',
  timeFrom: '',
  timeTo: '',
  searchQuery: '',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatIsoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function computePresetDateRange(
  preset: DateFilterPreset,
  referenceDate: Date = new Date()
): { dateFrom: string; dateTo: string } {
  const ref = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const todayStr = formatIsoDateLocal(ref);

  switch (preset) {
    case 'ALL':
    case 'CUSTOM':
      return { dateFrom: '', dateTo: '' };

    case 'TODAY':
      return { dateFrom: todayStr, dateTo: todayStr };

    case 'THIS_WEEK': {
      // Monday-start business week
      const dayOfWeek = ref.getDay();
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(ref);
      monday.setDate(ref.getDate() - diffToMonday);
      return { dateFrom: formatIsoDateLocal(monday), dateTo: todayStr };
    }

    case 'THIS_MONTH': {
      const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
      return { dateFrom: formatIsoDateLocal(start), dateTo: todayStr };
    }

    case 'RECENT_1_MONTH': {
      const start = new Date(ref);
      start.setDate(ref.getDate() - 30);
      return { dateFrom: formatIsoDateLocal(start), dateTo: todayStr };
    }

    case 'THIS_QUARTER': {
      const qStartMonth = Math.floor(ref.getMonth() / 3) * 3;
      const start = new Date(ref.getFullYear(), qStartMonth, 1);
      return { dateFrom: formatIsoDateLocal(start), dateTo: todayStr };
    }

    case 'YTD': {
      const start = new Date(ref.getFullYear(), 0, 1);
      return { dateFrom: formatIsoDateLocal(start), dateTo: todayStr };
    }
  }
}

export function getCurrentCalendarMonthRange(referenceDate: Date = new Date()): {
  dateFrom: string;
  dateTo: string;
  fromDate: string;
  toDate: string;
} {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const dateFrom = formatIsoDateLocal(firstDay);
  const dateTo = formatIsoDateLocal(lastDay);
  return {
    dateFrom,
    dateTo,
    fromDate: dateFrom,
    toDate: dateTo,
  };
}

export function getRecentOneMonthRange(referenceDate: Date = new Date()): {
  dateFrom: string;
  dateTo: string;
  fromDate: string;
  toDate: string;
} {
  // Calendar month default: 1st of month to last day of month (e.g. Nov 1 to Nov 30)
  return getCurrentCalendarMonthRange(referenceDate);
}

export function isIsoDateInRecentOneMonth(
  value: string | Date | null | undefined,
  referenceDate: Date = new Date()
): boolean {
  if (!value) return false;
  const range = getRecentOneMonthRange(referenceDate);
  return matchesDateTimeFilter(value, {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    timeFrom: '',
    timeTo: '',
  });
}

export function isWorkspaceFilterActive(filter: WorkspaceFilterState): boolean {
  return Boolean(
    filter.preset !== 'ALL' ||
    filter.dateFrom.trim() ||
    filter.dateTo.trim() ||
    filter.timeFrom.trim() ||
    filter.timeTo.trim() ||
    filter.searchQuery.trim()
  );
}

/**
 * Checks whether an ISO timestamp or YYYY-MM-DD date string falls within the active date & time filter.
 * Safe against invalid timestamps and partial date-only values.
 */
export function matchesDateTimeFilter(
  value: string | Date | null | undefined,
  filter: Pick<WorkspaceFilterState, 'dateFrom' | 'dateTo' | 'timeFrom' | 'timeTo'>
): boolean {
  const hasDateFilter = Boolean(filter.dateFrom || filter.dateTo);
  const hasTimeFilter = Boolean(filter.timeFrom || filter.timeTo);
  if (!hasDateFilter && !hasTimeFilter) return true;
  if (!value) return false;

  let datePart = '';
  let timePart = '';

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return false;
    datePart = formatIsoDateLocal(value);
    timePart = `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
  } else {
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      datePart = raw;
      timePart = '';
    } else {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!match) return false;
        datePart = match[1];
      } else {
        datePart = formatIsoDateLocal(parsed);
        timePart = `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
      }
    }
  }

  if (filter.dateFrom && datePart < filter.dateFrom) return false;
  if (filter.dateTo && datePart > filter.dateTo) return false;

  if (hasTimeFilter) {
    // If record has no time-of-day component (date-only), do not falsely exclude unless time filter explicitly expects timestamped records;
    // when time component exists, enforce exact HH:MM window.
    if (timePart) {
      if (filter.timeFrom && timePart < filter.timeFrom) return false;
      if (filter.timeTo && timePart > filter.timeTo) return false;
    }
  }

  return true;
}

export function formatFilterSummaryLabel(filter: WorkspaceFilterState): string {
  const presetLabels: Record<DateFilterPreset, string> = {
    ALL: 'All Periods',
    TODAY: 'Today',
    THIS_WEEK: 'This Week',
    THIS_MONTH: 'This Month',
    RECENT_1_MONTH: 'Recent 1 Month',
    THIS_QUARTER: 'This Quarter',
    YTD: 'Year to Date',
    CUSTOM: 'Custom Range',
  };

  const parts: string[] = [];
  if (filter.preset !== 'ALL' && filter.preset !== 'CUSTOM') {
    parts.push(presetLabels[filter.preset]);
  } else if (filter.dateFrom || filter.dateTo) {
    parts.push(`${filter.dateFrom || 'Start'} to ${filter.dateTo || 'Present'}`);
  } else {
    parts.push('All Periods');
  }

  if (filter.timeFrom || filter.timeTo) {
    parts.push(`${filter.timeFrom || '00:00'}–${filter.timeTo || '23:59'}`);
  }

  if (filter.searchQuery.trim()) {
    parts.push(`"${filter.searchQuery.trim()}"`);
  }

  return parts.join(' • ');
}

export type PercentageTone = 'teal' | 'blue' | 'amber' | 'rose' | 'neutral';

export interface PercentageMetricItem {
  id: string;
  label: string;
  percentage: number | null; // null = honest N/A (zero denominator / no posted source records)
  ringFillPercent: number;   // 0..100 clamped for SVG ring geometry
  displayValue: string;      // e.g. "24.8%" or "N/A"
  subtitle: string;          // Clear explanation of source or why missing
  formula: string;           // Traceable calculation formula
  tone: PercentageTone;
  drillDownPath: string;
  drillDownLabel: string;
}

export interface DashboardOverviewLike {
  cashBalance?: number;
  accountsReceivable?: number;
  accountsPayable?: number;
  summaryStats?: {
    totalYtdRevenue?: number;
    totalYtdExpenses?: number;
    totalYtdNetProfit?: number;
    avgProfitMargin?: number;
  };
  reconciliationSummary?: {
    tbStatus?: string;
    tbBalanced?: boolean;
    tbVarianceCentavos?: number;
    postedJournalLinesCount?: number;
    unpostedJournalsCount?: number;
    imbalancedPostedJournalsCount?: number;
    postingIntegrityOk?: boolean;
    arVarianceCentavos?: number;
    apVarianceCentavos?: number;
  };
  taxEstimate?: {
    vatStatus?: string;
    primaryForm?: string;
    periodLabel?: string;
    currentMonth?: string;
    grossReceiptsCentavos?: number;
    percentageTaxRate?: number;
    percentageTaxPayable?: number;
    outputVat?: number;
    inputVat?: number;
    netVatPayable?: number;
    estimatedTaxLiability?: number;
  } | null;
}

/**
 * Computes strictly source-of-truth percentage metrics from authoritative backend Dashboard data.
 * NEVER fabricates percentages when denominators are zero or records do not exist.
 */
export function computeDashboardPercentageMetrics(
  data: DashboardOverviewLike | null | undefined
): PercentageMetricItem[] {
  const rev = Number(data?.summaryStats?.totalYtdRevenue || 0);
  const exp = Number(data?.summaryStats?.totalYtdExpenses || 0);
  const net = Number(data?.summaryStats?.totalYtdNetProfit ?? (rev - exp));
  const recon = data?.reconciliationSummary;
  const tax = data?.taxEstimate;

  // 1. Net Operating Margin (%)
  let netMarginPct: number | null = null;
  if (rev > 0) {
    netMarginPct = Math.round(((net / rev) * 100) * 10) / 10;
  }
  const netMarginMetric: PercentageMetricItem = {
    id: 'net-operating-margin',
    label: 'Net Operating Margin',
    percentage: netMarginPct,
    ringFillPercent: netMarginPct === null ? 0 : Math.max(0, Math.min(100, netMarginPct)),
    displayValue: netMarginPct === null ? 'N/A' : `${netMarginPct.toFixed(1)}%`,
    subtitle:
      netMarginPct === null
        ? 'No posted revenue in trailing 12 months'
        : netMarginPct >= 0
          ? 'Net profit share of operating revenue'
          : 'Operating loss relative to revenue',
    formula: 'Net Operating Income ÷ Operating Revenue × 100',
    tone: netMarginPct === null ? 'neutral' : netMarginPct >= 15 ? 'teal' : netMarginPct >= 0 ? 'blue' : 'rose',
    drillDownPath: '/reports/income-statement',
    drillDownLabel: 'Income Statement',
  };

  // 2. Operating Expense Ratio (%)
  let expenseRatioPct: number | null = null;
  if (rev > 0) {
    expenseRatioPct = Math.round(((exp / rev) * 100) * 10) / 10;
  }
  const expenseRatioMetric: PercentageMetricItem = {
    id: 'expense-ratio',
    label: 'Expense-to-Revenue Ratio',
    percentage: expenseRatioPct,
    ringFillPercent: expenseRatioPct === null ? 0 : Math.max(0, Math.min(100, expenseRatioPct)),
    displayValue: expenseRatioPct === null ? 'N/A' : `${expenseRatioPct.toFixed(1)}%`,
    subtitle:
      expenseRatioPct === null
        ? 'Awaiting posted revenue and expense records'
        : expenseRatioPct <= 75
          ? 'Operating cost discipline within healthy range'
          : 'Elevated operating expense share vs revenue',
    formula: 'Operating Expenses ÷ Operating Revenue × 100',
    tone: expenseRatioPct === null ? 'neutral' : expenseRatioPct <= 70 ? 'teal' : expenseRatioPct <= 90 ? 'amber' : 'rose',
    drillDownPath: '/reports/income-statement',
    drillDownLabel: 'Expense Ledger',
  };

  // 3. Ledger Reconciliation Health (%)
  const postedLines = Number(recon?.postedJournalLinesCount || 0);
  const unpostedJournals = Number(recon?.unpostedJournalsCount || 0);
  const hasAnyLedgerActivity = postedLines > 0 || unpostedJournals > 0;

  let controlPct: number | null = null;
  let passedChecks = 0;
  if (hasAnyLedgerActivity && recon) {
    if (recon.tbBalanced) passedChecks += 1;
    if (Number(recon.arVarianceCentavos || 0) === 0) passedChecks += 1;
    if (Number(recon.apVarianceCentavos || 0) === 0) passedChecks += 1;
    const postingCheckPassed =
      recon.postingIntegrityOk !== undefined
        ? Boolean(recon.postingIntegrityOk)
        : Boolean(recon.tbBalanced && postedLines > 0);
    if (postingCheckPassed) passedChecks += 1;
    controlPct = Math.round((passedChecks / 4) * 100);
  }

  const controlIntegrityMetric: PercentageMetricItem = {
    id: 'control-integrity',
    label: 'Ledger Reconciliation Health',
    percentage: controlPct,
    ringFillPercent: controlPct === null ? 0 : controlPct,
    displayValue: controlPct === null ? 'N/A' : `${controlPct}%`,
    subtitle:
      controlPct === null
        ? 'No ledger entries recorded yet'
        : passedChecks === 4
          ? 'All 4 financial controls verified'
          : `${passedChecks} of 4 financial controls verified`,
    formula: 'Trial Balance, Receivables, Payables & Double-Entry Integrity Checks',
    tone: controlPct === null ? 'neutral' : controlPct === 100 ? 'teal' : controlPct >= 75 ? 'amber' : 'rose',
    drillDownPath: '/reports/trial-balance',
    drillDownLabel: 'Trial Balance',
  };

  // 4. Regime-Aware BIR Tax Ratio (VAT 2550Q Input Credit Offset vs Non-VAT 2551Q 3% Percentage Tax)
  const vatStatus = String(tax?.vatStatus || 'VAT').toUpperCase();
  const isNonVat = vatStatus === 'NON_VAT';
  const isExempt = vatStatus === 'EXEMPT' || vatStatus === 'BMBE' || vatStatus === 'PEZA_BOI';

  let taxMetric: PercentageMetricItem;
  if (!tax) {
    taxMetric = {
      id: 'vat-credit-offset',
      label: 'BIR Tax Compliance Ratio',
      percentage: null,
      ringFillPercent: 0,
      displayValue: 'N/A',
      subtitle: 'Tax module access restricted for current role',
      formula: 'BIR Tax Compliance Summary',
      tone: 'neutral',
      drillDownPath: '/tax',
      drillDownLabel: 'BIR Tax Center',
    };
  } else if (isNonVat) {
    const grossReceipts = Number(tax.grossReceiptsCentavos || 0);
    const pctTax = Number(tax.percentageTaxPayable || 0);
    const effectiveRate = grossReceipts > 0 ? Math.round(((pctTax / grossReceipts) * 100) * 10) / 10 : null;
    taxMetric = {
      id: 'vat-credit-offset',
      label: 'Percentage Tax Rate (2551Q)',
      percentage: effectiveRate,
      ringFillPercent: effectiveRate === null ? 0 : Math.max(12, Math.min(100, effectiveRate * 10)),
      displayValue: effectiveRate === null ? 'N/A' : `${effectiveRate.toFixed(1)}%`,
      subtitle:
        effectiveRate === null
          ? 'No taxable gross receipts recorded yet'
          : `BIR Form 2551Q statutory rate (${tax.periodLabel || tax.currentMonth || 'Current Quarter'})`,
      formula: 'Percentage Tax Payable (Form 2551Q) ÷ Gross Receipts × 100',
      tone: effectiveRate === null ? 'neutral' : 'teal',
      drillDownPath: '/tax',
      drillDownLabel: 'BIR Tax Center',
    };
  } else if (isExempt) {
    taxMetric = {
      id: 'vat-credit-offset',
      label: 'BIR Tax Exemption Status',
      percentage: 0,
      ringFillPercent: 100,
      displayValue: '0.0%',
      subtitle: `Registered tax-exempt classification (${vatStatus})`,
      formula: 'Statutory BIR Exemption Regime',
      tone: 'teal',
      drillDownPath: '/tax',
      drillDownLabel: 'BIR Tax Center',
    };
  } else {
    const outputVat = Number(tax.outputVat || 0);
    const inputVat = Number(tax.inputVat || 0);
    let vatOffsetPct: number | null = null;
    if (outputVat > 0) {
      vatOffsetPct = Math.round(Math.min(100, (inputVat / outputVat) * 100) * 10) / 10;
    }
    taxMetric = {
      id: 'vat-credit-offset',
      label: 'Input VAT Credit Offset',
      percentage: vatOffsetPct,
      ringFillPercent: vatOffsetPct === null ? 0 : Math.max(0, Math.min(100, vatOffsetPct)),
      displayValue: vatOffsetPct === null ? 'N/A' : `${vatOffsetPct.toFixed(1)}%`,
      subtitle:
        vatOffsetPct === null
          ? 'No output VAT recorded for active filing period'
          : `Input VAT offsetting ${tax.periodLabel || tax.currentMonth || 'active'} output VAT`,
      formula: 'Creditable Input VAT ÷ Output VAT × 100',
      tone: vatOffsetPct === null ? 'neutral' : 'blue',
      drillDownPath: '/tax',
      drillDownLabel: 'BIR Tax Center',
    };
  }

  return [netMarginMetric, expenseRatioMetric, controlIntegrityMetric, taxMetric];
}
