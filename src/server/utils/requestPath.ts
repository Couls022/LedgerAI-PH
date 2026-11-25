import path from 'path';

export function normalizeRequestPath(rawUrl: string | undefined | null): string {
  const pathNoQuery = String(rawUrl || '').split('?')[0].split('#')[0];
  let decoded = pathNoQuery;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  const cleanSlashes = decoded.replace(/\\/g, '/').replace(/\0/g, '');
  const withLeadingSlash = cleanSlashes.startsWith('/') ? cleanSlashes : `/${cleanSlashes}`;
  let normalized = path.posix.normalize(withLeadingSlash);
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function isSegmentPrefixMatch(normalizedPath: string, prefix: string): boolean {
  const cleanPrefix = prefix.length > 1 && prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return normalizedPath === cleanPrefix || normalizedPath.startsWith(`${cleanPrefix}/`);
}

export function isPublicOrCreationRoutePath(rawUrl: string | undefined | null): boolean {
  const normalized = normalizeRequestPath(rawUrl);
  const prefixes = [
    '/api/companies',
    '/api/auth',
    '/api/health',
    '/api/restore',
    '/api/admin',
    '/api/licensing',
  ];
  return (
    prefixes.some((p) => isSegmentPrefixMatch(normalized, p)) ||
    /^\/api\/companies\/[^/]+\/licensing(\/|$)/.test(normalized)
  );
}

export function isLicenseExemptPath(rawUrl: string | undefined | null): boolean {
  const normalized = normalizeRequestPath(rawUrl);
  return (
    isSegmentPrefixMatch(normalized, '/api/auth') ||
    isSegmentPrefixMatch(normalized, '/api/admin') ||
    isSegmentPrefixMatch(normalized, '/api/licensing') ||
    isSegmentPrefixMatch(normalized, '/api/restore') ||
    normalized === '/api/companies' ||
    normalized === '/api/health' ||
    /^\/api\/companies\/[^/]+\/licensing(\/|$)/.test(normalized)
  );
}

export function isPasswordChangeAllowedPath(rawUrl: string | undefined | null): boolean {
  const normalized = normalizeRequestPath(rawUrl);
  const allowed = [
    '/api/auth/change-password',
    '/api/auth/logout',
    '/api/auth/logout-all',
    '/api/auth/session',
  ];
  return allowed.some((p) => isSegmentPrefixMatch(normalized, p));
}

export type WorkpaperSignOffTarget = 'PREPARED' | 'REVIEWED' | 'APPROVED';

export interface WorkpaperSignOffCheckInput {
  currentStatus: string;
  targetStatus: string;
  preparerId?: string | null;
  reviewerId?: string | null;
  actingUserId: string;
}

export interface WorkpaperSignOffCheckResult {
  ok: boolean;
  status?: number;
  code?: 'INVALID_STATUS' | 'INVALID_TRANSITION' | 'SOD_VIOLATION';
  message?: string;
}

export function validateWorkpaperSignOff(input: WorkpaperSignOffCheckInput): WorkpaperSignOffCheckResult {
  const allowedTargets: WorkpaperSignOffTarget[] = ['PREPARED', 'REVIEWED', 'APPROVED'];
  if (!allowedTargets.includes(input.targetStatus as WorkpaperSignOffTarget)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_STATUS',
      message: 'Sign-off target status must be PREPARED, REVIEWED, or APPROVED.',
    };
  }

  const requiredPriorStatus: Record<WorkpaperSignOffTarget, string> = {
    PREPARED: 'DRAFT',
    REVIEWED: 'PREPARED',
    APPROVED: 'REVIEWED',
  };
  const expectedCurrent = requiredPriorStatus[input.targetStatus as WorkpaperSignOffTarget];
  if (input.currentStatus !== expectedCurrent) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_TRANSITION',
      message: `Invalid workpaper sign-off transition: ${input.currentStatus} -> ${input.targetStatus}. Expected current status ${expectedCurrent}.`,
    };
  }

  if (input.targetStatus === 'REVIEWED' && input.preparerId && input.preparerId === input.actingUserId) {
    return {
      ok: false,
      status: 403,
      code: 'SOD_VIOLATION',
      message: 'Segregation of duties violation: workpaper preparer cannot sign off as reviewer.',
    };
  }

  if (
    input.targetStatus === 'APPROVED' &&
    ((input.preparerId && input.preparerId === input.actingUserId) ||
      (input.reviewerId && input.reviewerId === input.actingUserId))
  ) {
    return {
      ok: false,
      status: 403,
      code: 'SOD_VIOLATION',
      message: 'Segregation of duties violation: workpaper approver must be independent of both preparer and reviewer.',
    };
  }

  return { ok: true };
}

export interface FixedAssetValidationInput {
  acquisitionCost: number;
  salvageValue?: number | null;
  usefulLifeMonths: number;
}

export function validateFixedAssetInput(input: FixedAssetValidationInput): { ok: true } | { ok: false; message: string } {
  const cost = Number(input.acquisitionCost);
  const salvage = Number(input.salvageValue ?? 0);
  const life = Number(input.usefulLifeMonths);

  if (!Number.isFinite(cost) || cost <= 0) {
    return { ok: false, message: 'acquisitionCost must be a finite positive number greater than 0.' };
  }
  if (!Number.isFinite(salvage) || salvage < 0 || salvage >= cost) {
    return { ok: false, message: 'salvageValue must be non-negative and strictly less than acquisitionCost.' };
  }
  if (!Number.isFinite(life) || !Number.isInteger(life) || life < 1 || life > 600) {
    return { ok: false, message: 'usefulLifeMonths must be an integer between 1 and 600.' };
  }
  return { ok: true };
}
