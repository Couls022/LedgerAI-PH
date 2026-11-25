/**
 * Enterprise Timestamp Integrity & Normalization Utility
 *
 * Resolves the mixed seconds vs. milliseconds epoch representation in SQLite / Drizzle ORM:
 * - Standard Unix seconds (years 2000–2100): ~9.46e8 to ~4.10e9 (< 1e11)
 * - Standard Unix milliseconds (years 2000–2100): ~9.46e11 to ~4.10e12 (1e11 .. 1e14)
 * - Double-multiplied milliseconds (when SQLite stores ms via DEFAULT (... * 86400000) or
 *   strftime('%s','now') * 1000 and Drizzle `{ mode: 'timestamp' }` multiplies by 1000 on read):
 *   ~9.46e14 to ~4.10e15 (>= 1e14, producing years like 58832)
 *
 * All functions are non-destructive and recover the exact intended timestamp without mutating
 * historical database records.
 */

const SEC_TO_MS_THRESHOLD = 100_000_000_000; // 1e11 (~1973 in ms, ~5138 in sec)
const DOUBLE_MS_THRESHOLD = 100_000_000_000_000; // 1e14 (~5138 in ms)
const TRIPLE_MS_THRESHOLD = 100_000_000_000_000_000; // 1e17

export function normalizeNumericEpochToMs(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  let ms = raw;
  if (ms >= TRIPLE_MS_THRESHOLD) {
    ms = Math.round(ms / 1_000_000);
  } else if (ms >= DOUBLE_MS_THRESHOLD) {
    ms = Math.round(ms / 1_000);
  } else if (ms < SEC_TO_MS_THRESHOLD) {
    ms = Math.round(ms * 1_000);
  }
  return ms;
}

export function normalizeEpochMs(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;

  if (val instanceof Date) {
    const time = val.getTime();
    if (Number.isNaN(time)) return null;
    return normalizeNumericEpochToMs(time);
  }

  if (typeof val === 'number') {
    return normalizeNumericEpochToMs(val);
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;

    // Pure numeric string
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return normalizeNumericEpochToMs(Number(trimmed));
    }

    // Extended ISO string produced by Date.prototype.toISOString() for years > 9999 (e.g., "+058832-08-28T...")
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return normalizeNumericEpochToMs(parsed);
    }
  }

  return null;
}

export function normalizeDate(val: unknown): Date | null {
  const ms = normalizeEpochMs(val);
  if (ms === null) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function normalizeIsoTimestamp(val: unknown): string | null {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
    // Preserve pure YYYY-MM-DD accounting date strings unchanged
    return val.trim();
  }
  const d = normalizeDate(val);
  return d ? d.toISOString() : null;
}

export function formatEnterpriseTimestamp(
  val: unknown,
  fallback = 'Not recorded'
): string {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
    return val.trim();
  }
  const d = normalizeDate(val);
  if (!d) return typeof val === 'string' ? val : fallback;
  return d.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

const TIMESTAMP_KEY_PATTERN =
  /(?:At|Date|Timestamp|Time|_at|_date|_timestamp)$/i;

/**
 * Express JSON replacer that automatically repairs any Drizzle `{ mode: 'timestamp' }`
 * Date objects or extended-year ISO strings (`+058832-...`) before sending over HTTP.
 */
export function jsonTimestampReplacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  const rawProp = this && key ? this[key] : undefined;

  if (rawProp instanceof Date) {
    const time = rawProp.getTime();
    if (!Number.isNaN(time) && time >= DOUBLE_MS_THRESHOLD) {
      const normalized = normalizeNumericEpochToMs(time);
      if (normalized !== null) {
        return new Date(normalized).toISOString();
      }
    }
    return value;
  }

  if (typeof value === 'string' && /^\+\d{5,6}-\d{2}-\d{2}T/.test(value)) {
    const normalized = normalizeIsoTimestamp(value);
    if (normalized) return normalized;
  }

  if (
    typeof value === 'number' &&
    value >= DOUBLE_MS_THRESHOLD &&
    TIMESTAMP_KEY_PATTERN.test(key)
  ) {
    const normalized = normalizeNumericEpochToMs(value);
    if (normalized !== null) return normalized;
  }

  return value;
}
