/**
 * LEDGERAI PH — DATE-RANGE SELECTOR & TEMPORAL CONTEXT RESOLVER
 * Shared pure module used by the LedgerAI Chat Date-Range Selector (Frontend),
 * the Offline Deterministic Engine & Stock Knowledge Base Retrieval (Backend),
 * and unit/integration tests.
 */

export type DateRangeGranularity =
  | 'ALL'
  | 'DATE'
  | 'WEEK'
  | 'MONTH'
  | 'QUARTER'
  | 'YEAR'
  | 'RANGE';

export interface DateRangeFilterInput {
  preset?: string;
  label?: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface ResolvedDateRangeFilter {
  hasFilter: boolean;
  preset: string;
  label: string;
  startDate: string | null;
  endDate: string | null;
  granularity: DateRangeGranularity;
}

export interface DateRangePresetOption {
  id: string;
  label: string;
  shortLabel: string;
  group: 'DEFAULT' | 'RELATIVE' | 'MONTHS_2026' | 'QUARTERS' | 'YEARS' | 'CUSTOM';
}

export const LEDGER_AGENT_DATE_RANGE_PRESETS: DateRangePresetOption[] = [
  { id: 'ALL', label: 'All Periods (Cumulative)', shortLabel: 'All Periods', group: 'DEFAULT' },
  { id: 'TODAY', label: 'Today (PHT)', shortLabel: 'Today', group: 'RELATIVE' },
  { id: 'THIS_WEEK', label: 'This Week', shortLabel: 'This Week', group: 'RELATIVE' },
  { id: 'LAST_WEEK', label: 'Last Week', shortLabel: 'Last Week', group: 'RELATIVE' },
  { id: 'THIS_MONTH', label: 'This Month', shortLabel: 'This Month', group: 'RELATIVE' },
  { id: 'LAST_MONTH', label: 'Last Month', shortLabel: 'Last Month', group: 'RELATIVE' },
  { id: 'OCT_2026', label: 'October 2026', shortLabel: 'Oct 2026', group: 'MONTHS_2026' },
  { id: 'FEB_2026', label: 'February 2026', shortLabel: 'Feb 2026', group: 'MONTHS_2026' },
  { id: 'JAN_2026', label: 'January 2026', shortLabel: 'Jan 2026', group: 'MONTHS_2026' },
  { id: 'MAR_2026', label: 'March 2026', shortLabel: 'Mar 2026', group: 'MONTHS_2026' },
  { id: 'NOV_2026', label: 'November 2026', shortLabel: 'Nov 2026', group: 'MONTHS_2026' },
  { id: 'Q1_2026', label: 'Q1 2026 (Jan–Mar 2026)', shortLabel: 'Q1 2026', group: 'QUARTERS' },
  { id: 'Q2_2026', label: 'Q2 2026 (Apr–Jun 2026)', shortLabel: 'Q2 2026', group: 'QUARTERS' },
  { id: 'Q3_2026', label: 'Q3 2026 (Jul–Sep 2026)', shortLabel: 'Q3 2026', group: 'QUARTERS' },
  { id: 'Q4_2026', label: 'Q4 2026 (Oct–Dec 2026)', shortLabel: 'Q4 2026', group: 'QUARTERS' },
  { id: 'Q1_2025', label: 'Q1 2025 (Jan–Mar 2025)', shortLabel: 'Q1 2025', group: 'QUARTERS' },
  { id: 'Q1_2024', label: 'Q1 2024 (Jan–Mar 2024)', shortLabel: 'Q1 2024', group: 'QUARTERS' },
  { id: 'Q2_2024', label: 'Q2 2024 (Apr–Jun 2024)', shortLabel: 'Q2 2024', group: 'QUARTERS' },
  { id: 'Q3_2024', label: 'Q3 2024 (Jul–Sep 2024)', shortLabel: 'Q3 2024', group: 'QUARTERS' },
  { id: 'Q4_2024', label: 'Q4 2024 (Oct–Dec 2024)', shortLabel: 'Q4 2024', group: 'QUARTERS' },
  { id: 'FY_2026', label: 'Full Year 2026', shortLabel: 'FY 2026', group: 'YEARS' },
  { id: 'FY_2025', label: 'Full Year 2025', shortLabel: 'FY 2025', group: 'YEARS' },
  { id: 'FY_2024', label: 'Full Year 2024', shortLabel: 'FY 2024', group: 'YEARS' },
  { id: 'CUSTOM', label: 'Custom Date Range...', shortLabel: 'Custom Range', group: 'CUSTOM' },
];

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad2 = (n: number): string => String(n).padStart(2, '0');
const lastDayOfMonth = (y: number, m1to12: number): number =>
  new Date(Date.UTC(y, m1to12, 0)).getUTCDate();
const toIsoDate = (d: Date): string => d.toISOString().split('T')[0];

export function getTodayPhtIso(referenceNowMs?: number): string {
  const nowPht = new Date((referenceNowMs ?? Date.now()) + 8 * 3600 * 1000);
  return nowPht.toISOString().split('T')[0];
}

/**
 * Resolves a preset ID, human label (e.g., 'Last Month', 'Q1 2024', 'October 2026'),
 * or custom { startDate, endDate } into an authoritative date window [startDate, endDate].
 */
export function resolveDateRangeFilter(
  input?: string | DateRangeFilterInput | null,
  referenceDateIso?: string
): ResolvedDateRangeFilter {
  const todayStr =
    referenceDateIso && /^\d{4}-\d{2}-\d{2}$/.test(referenceDateIso)
      ? referenceDateIso
      : getTodayPhtIso();
  const [curY, curM, curD] = todayStr.split('-').map(Number);

  if (!input) {
    return {
      hasFilter: false,
      preset: 'ALL',
      label: 'All Active & Historical Accounting Periods',
      startDate: null,
      endDate: null,
      granularity: 'ALL',
    };
  }

  const normalizedInput: DateRangeFilterInput =
    typeof input === 'string' ? { preset: input.trim(), label: input.trim() } : input;

  const rawPreset = (normalizedInput.preset || normalizedInput.label || 'ALL').trim();
  const upperPreset = rawPreset.toUpperCase().replace(/\s+/g, '_');

  // 1. Explicit custom startDate & endDate if provided and preset is CUSTOM or dates are valid ISO
  const customStart = normalizedInput.startDate?.trim() || null;
  const customEnd = normalizedInput.endDate?.trim() || null;
  if (
    customStart &&
    customEnd &&
    /^\d{4}-\d{2}-\d{2}$/.test(customStart) &&
    /^\d{4}-\d{2}-\d{2}$/.test(customEnd) &&
    (upperPreset === 'CUSTOM' || upperPreset === 'RANGE' || !normalizedInput.preset)
  ) {
    const s = customStart <= customEnd ? customStart : customEnd;
    const e = customStart <= customEnd ? customEnd : customStart;
    return {
      hasFilter: true,
      preset: 'CUSTOM',
      label:
        normalizedInput.label && normalizedInput.label !== 'CUSTOM'
          ? `${normalizedInput.label} (${s} to ${e})`
          : s === e
          ? `Date: ${s}`
          : `Custom Range (${s} to ${e})`,
      startDate: s,
      endDate: e,
      granularity: s === e ? 'DATE' : 'RANGE',
    };
  }

  if (
    upperPreset === 'ALL' ||
    upperPreset === 'ALL_PERIODS' ||
    upperPreset === 'NONE' ||
    upperPreset === ''
  ) {
    return {
      hasFilter: false,
      preset: 'ALL',
      label: 'All Active & Historical Accounting Periods',
      startDate: null,
      endDate: null,
      granularity: 'ALL',
    };
  }

  // 2. Relative Presets: TODAY, YESTERDAY, THIS_WEEK, LAST_WEEK, THIS_MONTH, LAST_MONTH
  if (upperPreset === 'TODAY') {
    return {
      hasFilter: true,
      preset: 'TODAY',
      label: `Today (${todayStr})`,
      startDate: todayStr,
      endDate: todayStr,
      granularity: 'DATE',
    };
  }

  if (upperPreset === 'YESTERDAY') {
    const yest = toIsoDate(new Date(Date.UTC(curY, curM - 1, curD - 1)));
    return {
      hasFilter: true,
      preset: 'YESTERDAY',
      label: `Yesterday (${yest})`,
      startDate: yest,
      endDate: yest,
      granularity: 'DATE',
    };
  }

  if (upperPreset === 'THIS_WEEK' || upperPreset === 'CURRENT_WEEK') {
    const curDate = new Date(Date.UTC(curY, curM - 1, curD));
    const dow = curDate.getUTCDay();
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(Date.UTC(curY, curM - 1, curD + diffToMon));
    const sun = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 6));
    const s = toIsoDate(mon);
    const e = toIsoDate(sun);
    return {
      hasFilter: true,
      preset: 'THIS_WEEK',
      label: `This Week (${s} to ${e})`,
      startDate: s,
      endDate: e,
      granularity: 'WEEK',
    };
  }

  if (upperPreset === 'LAST_WEEK' || upperPreset === 'PREVIOUS_WEEK') {
    const curDate = new Date(Date.UTC(curY, curM - 1, curD));
    const dow = curDate.getUTCDay();
    const diffToLastMon = (dow === 0 ? -6 : 1 - dow) - 7;
    const mon = new Date(Date.UTC(curY, curM - 1, curD + diffToLastMon));
    const sun = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 6));
    const s = toIsoDate(mon);
    const e = toIsoDate(sun);
    return {
      hasFilter: true,
      preset: 'LAST_WEEK',
      label: `Last Week (${s} to ${e})`,
      startDate: s,
      endDate: e,
      granularity: 'WEEK',
    };
  }

  if (upperPreset === 'THIS_MONTH' || upperPreset === 'CURRENT_MONTH') {
    const maxD = lastDayOfMonth(curY, curM);
    const mName = MONTH_NAMES[curM - 1];
    const s = `${curY}-${pad2(curM)}-01`;
    const e = `${curY}-${pad2(curM)}-${pad2(maxD)}`;
    return {
      hasFilter: true,
      preset: 'THIS_MONTH',
      label: `This Month — ${mName} ${curY} (${s} to ${e})`,
      startDate: s,
      endDate: e,
      granularity: 'MONTH',
    };
  }

  if (upperPreset === 'LAST_MONTH' || upperPreset === 'PREVIOUS_MONTH') {
    const prevM = curM === 1 ? 12 : curM - 1;
    const prevY = curM === 1 ? curY - 1 : curY;
    const maxD = lastDayOfMonth(prevY, prevM);
    const mName = MONTH_NAMES[prevM - 1];
    const s = `${prevY}-${pad2(prevM)}-01`;
    const e = `${prevY}-${pad2(prevM)}-${pad2(maxD)}`;
    return {
      hasFilter: true,
      preset: 'LAST_MONTH',
      label: `Last Month — ${mName} ${prevY} (${s} to ${e})`,
      startDate: s,
      endDate: e,
      granularity: 'MONTH',
    };
  }

  // 3. Quarter Presets: "Q1_2024", "Q1 2024", "Q4 2026", "1st Quarter 2024"
  const quarterMatch =
    upperPreset.match(/^Q([1-4])[_\s-]*(20\d{2})$/) ||
    rawPreset.match(/\b(?:Q([1-4])|([1-4])(?:st|nd|rd|th)\s+quarter)\s*(20\d{2})?\b/i);
  if (quarterMatch) {
    const qNum = Number(quarterMatch[1] || quarterMatch[2] || 1);
    const qYear = Number(quarterMatch[3] || quarterMatch[2] || curY);
    const validYear = qYear >= 2000 && qYear <= 2100 ? qYear : curY;
    const startM = (qNum - 1) * 3 + 1;
    const endM = qNum * 3;
    const s = `${validYear}-${pad2(startM)}-01`;
    const e = `${validYear}-${pad2(endM)}-${pad2(lastDayOfMonth(validYear, endM))}`;
    return {
      hasFilter: true,
      preset: `Q${qNum}_${validYear}`,
      label: `Q${qNum} ${validYear} (${s} to ${e})`,
      startDate: s,
      endDate: e,
      granularity: 'QUARTER',
    };
  }

  // 4. Full Year Presets: "FY_2026", "FY 2024", "2024", "Year 2024", "LAST_YEAR"
  if (upperPreset === 'LAST_YEAR' || upperPreset === 'PREVIOUS_YEAR') {
    const y = curY - 1;
    return {
      hasFilter: true,
      preset: `FY_${y}`,
      label: `Year ${y} (${y}-01-01 to ${y}-12-31)`,
      startDate: `${y}-01-01`,
      endDate: `${y}-12-31`,
      granularity: 'YEAR',
    };
  }

  const fyMatch = upperPreset.match(/^(?:FY[_\s-]*|YEAR[_\s-]*)?(20\d{2})$/);
  if (fyMatch) {
    const y = Number(fyMatch[1]);
    return {
      hasFilter: true,
      preset: `FY_${y}`,
      label: `Year ${y} (${y}-01-01 to ${y}-12-31)`,
      startDate: `${y}-01-01`,
      endDate: `${y}-12-31`,
      granularity: 'YEAR',
    };
  }

  // 5. Month Presets: "OCT_2026", "FEB_2026", "October 2026", "February 2026", "2026-10"
  const ymMatch = rawPreset.match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (ymMatch) {
    const y = Number(ymMatch[1]);
    const m = Number(ymMatch[2]);
    const mName = MONTH_NAMES[m - 1];
    const s = `${y}-${pad2(m)}-01`;
    const e = `${y}-${pad2(m)}-${pad2(lastDayOfMonth(y, m))}`;
    return {
      hasFilter: true,
      preset: `${mName.slice(0, 3).toUpperCase()}_${y}`,
      label: `${mName} ${y} (${s} to ${e})`,
      startDate: s,
      endDate: e,
      granularity: 'MONTH',
    };
  }

  const monthMap: Record<string, number> = {
    JAN: 1,
    JANUARY: 1,
    FEB: 2,
    FEBRUARY: 2,
    MAR: 3,
    MARCH: 3,
    APR: 4,
    APRIL: 4,
    MAY: 5,
    JUN: 6,
    JUNE: 6,
    JUL: 7,
    JULY: 7,
    AUG: 8,
    AUGUST: 8,
    SEP: 9,
    SEPT: 9,
    SEPTEMBER: 9,
    OCT: 10,
    OCTOBER: 10,
    NOV: 11,
    NOVEMBER: 11,
    DEC: 12,
    DECEMBER: 12,
  };

  const monthYearMatch = upperPreset.match(
    /^(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)(?:[_\s-]+(20\d{2}))?$/
  );
  if (monthYearMatch) {
    const m = monthMap[monthYearMatch[1]];
    const y = monthYearMatch[2] ? Number(monthYearMatch[2]) : curY;
    const mName = MONTH_NAMES[m - 1];
    const s = `${y}-${pad2(m)}-01`;
    const e = `${y}-${pad2(m)}-${pad2(lastDayOfMonth(y, m))}`;
    return {
      hasFilter: true,
      preset: `${mName.slice(0, 3).toUpperCase()}_${y}`,
      label: `${mName} ${y} (${s} to ${e})`,
      startDate: s,
      endDate: e,
      granularity: 'MONTH',
    };
  }

  // 6. Fallback if startDate and endDate were passed alongside a named preset
  if (
    customStart &&
    customEnd &&
    /^\d{4}-\d{2}-\d{2}$/.test(customStart) &&
    /^\d{4}-\d{2}-\d{2}$/.test(customEnd)
  ) {
    const s = customStart <= customEnd ? customStart : customEnd;
    const e = customStart <= customEnd ? customEnd : customStart;
    return {
      hasFilter: true,
      preset: rawPreset,
      label: normalizedInput.label || `${rawPreset} (${s} to ${e})`,
      startDate: s,
      endDate: e,
      granularity: s === e ? 'DATE' : 'RANGE',
    };
  }

  return {
    hasFilter: false,
    preset: 'ALL',
    label: 'All Active & Historical Accounting Periods',
    startDate: null,
    endDate: null,
    granularity: 'ALL',
  };
}
