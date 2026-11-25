/**
 * Pure enterprise accounting & General Ledger helpers (Philippine PFRS/PAS & BIR compliance).
 * Decoupled from Express/React so they are deterministically unit-tested via node:test.
 */

export interface AccountingPeriodLike {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  fiscalYear: number;
  status: string;
  version?: number | null;
  journalCount?: number;
  historyCount?: number;
  createdAt?: string | number | Date | null;
}

const PERIOD_STATUS_PRIORITY: Record<string, number> = {
  HARD_CLOSED: 3,
  SOFT_CLOSED: 2,
  OPEN: 1,
};

/**
 * Deduplicate accounting periods that share the same company date range (startDate..endDate)
 * or identical normalized name, always keeping the most authoritative record:
 *   1. Higher linked journal count
 *   2. Stricter period status (HARD_CLOSED > SOFT_CLOSED > OPEN)
 *   3. Higher linked history count
 *   4. Canonical `ap-` prefix or earliest createdAt
 */
export function deduplicateAccountingPeriods<T extends AccountingPeriodLike>(
  periods: T[]
): { canonical: T[]; duplicates: T[] } {
  const groups = new Map<string, T[]>();

  for (const p of periods) {
    const start = String(p.startDate || '').slice(0, 10);
    const end = String(p.endDate || '').slice(0, 10);
    const key = start && end ? `${start}::${end}` : `name::${String(p.name || '').trim().toUpperCase()}`;
    const list = groups.get(key) || [];
    list.push(p);
    groups.set(key, list);
  }

  const canonical: T[] = [];
  const duplicates: T[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      canonical.push(group[0]);
      continue;
    }

    const sorted = [...group].sort((a, b) => {
      const jDiff = (b.journalCount || 0) - (a.journalCount || 0);
      if (jDiff !== 0) return jDiff;

      const sDiff =
        (PERIOD_STATUS_PRIORITY[String(b.status || '').toUpperCase()] || 0) -
        (PERIOD_STATUS_PRIORITY[String(a.status || '').toUpperCase()] || 0);
      if (sDiff !== 0) return sDiff;

      const hDiff = (b.historyCount || 0) - (a.historyCount || 0);
      if (hDiff !== 0) return hDiff;

      const aIsCanonicalId = String(a.id || '').startsWith('ap-') ? 1 : 0;
      const bIsCanonicalId = String(b.id || '').startsWith('ap-') ? 1 : 0;
      if (bIsCanonicalId !== aIsCanonicalId) return bIsCanonicalId - aIsCanonicalId;

      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    canonical.push(sorted[0]);
    for (let i = 1; i < sorted.length; i++) {
      duplicates.push(sorted[i]);
    }
  }

  canonical.sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));

  return { canonical, duplicates };
}

/**
 * Safely format an ISO date string (YYYY-MM-DD or full ISO timestamp) as YYYY-MM-DD
 * without local-timezone day-shift drift.
 */
export function formatIsoDateSafe(raw: string | Date | null | undefined): string {
  if (!raw) return '-';
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return '-';
    return raw.toISOString().slice(0, 10);
  }
  const str = String(raw).trim();
  const isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return str;
  return parsed.toISOString().slice(0, 10);
}

export interface TrialBalanceTotalsInput {
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}

export interface TrialBalanceSummary {
  openingDebit: number;
  openingCredit: number;
  openingVariance: number;
  periodDebit: number;
  periodCredit: number;
  periodVariance: number;
  closingDebit: number;
  closingCredit: number;
  closingVariance: number;
  isBalanced: boolean;
}

export function computeTrialBalanceSummary(rows: TrialBalanceTotalsInput[]): TrialBalanceSummary {
  const acc = rows.reduce(
    (sum, r) => {
      sum.openingDebit += Number(r.openingDebit || 0);
      sum.openingCredit += Number(r.openingCredit || 0);
      sum.periodDebit += Number(r.periodDebit || 0);
      sum.periodCredit += Number(r.periodCredit || 0);
      sum.closingDebit += Number(r.closingDebit || 0);
      sum.closingCredit += Number(r.closingCredit || 0);
      return sum;
    },
    {
      openingDebit: 0,
      openingCredit: 0,
      periodDebit: 0,
      periodCredit: 0,
      closingDebit: 0,
      closingCredit: 0,
    }
  );

  const openingVariance = acc.openingDebit - acc.openingCredit;
  const periodVariance = acc.periodDebit - acc.periodCredit;
  const closingVariance = acc.closingDebit - acc.closingCredit;

  return {
    ...acc,
    openingVariance,
    periodVariance,
    closingVariance,
    isBalanced: openingVariance === 0 && periodVariance === 0 && closingVariance === 0,
  };
}

export function validateTrialBalanceCertification(summary: TrialBalanceSummary): {
  allowed: boolean;
  reason?: string;
} {
  if (!summary.isBalanced) {
    return {
      allowed: false,
      reason: `Cannot certify an out-of-balance Trial Balance (Opening diff: ${summary.openingVariance}, Period diff: ${summary.periodVariance}, Closing diff: ${summary.closingVariance} centavos).`,
    };
  }
  return { allowed: true };
}

export interface BirFxValuationResult {
  recordedPhp: number;
  settlementPhp: number;
  variancePhp: number;
  gainPhp: number;
  lossPhp: number;
  classification: 'GAIN' | 'LOSS' | 'NEUTRAL';
  isTaxableInItr: boolean;
  birRuleReference: string;
}

/**
 * Compute PHP Foreign Exchange variance per BIR RMC 12-2024 & PAS 21.
 * - REALIZED FX Gain/Loss (actual settlement/conversion) is taxable/deductible in BIR ITR (1702Q/1702-RT).
 * - UNREALIZED FX Gain/Loss (period-end mark-to-market) is book-only per PAS 21 and excluded from BIR ITR until realized.
 */
export function calculateBirRmc122024Fx(params: {
  foreignAmount: number;
  recordedRate: number;
  closingOrSettlementRate: number;
  mode: 'REALIZED' | 'UNREALIZED';
}): BirFxValuationResult {
  const { foreignAmount, recordedRate, closingOrSettlementRate, mode } = params;
  if (!Number.isFinite(foreignAmount) || foreignAmount <= 0) {
    throw new Error('Foreign amount must be positive.');
  }
  if (!Number.isFinite(recordedRate) || recordedRate <= 0 || !Number.isFinite(closingOrSettlementRate) || closingOrSettlementRate <= 0) {
    throw new Error('Exchange rates must be positive.');
  }

  const recordedPhp = Math.round(foreignAmount * recordedRate * 100) / 100;
  const settlementPhp = Math.round(foreignAmount * closingOrSettlementRate * 100) / 100;
  const variancePhp = Math.round((settlementPhp - recordedPhp) * 100) / 100;

  const classification: 'GAIN' | 'LOSS' | 'NEUTRAL' =
    variancePhp > 0 ? 'GAIN' : variancePhp < 0 ? 'LOSS' : 'NEUTRAL';

  return {
    recordedPhp,
    settlementPhp,
    variancePhp,
    gainPhp: variancePhp > 0 ? variancePhp : 0,
    lossPhp: variancePhp < 0 ? Math.abs(variancePhp) : 0,
    classification,
    isTaxableInItr: mode === 'REALIZED',
    birRuleReference:
      mode === 'REALIZED'
        ? 'BIR RMC 12-2024: Realized FX gain is taxable other income; realized FX loss is an allowable itemized deduction in BIR Form 1702Q/1702-RT.'
        : 'BIR RMC 12-2024 & PAS 21: Unrealized period-end FX gain/loss is recognized for PFRS financial reporting only and excluded from BIR ITR taxable income until realized.',
  };
}
