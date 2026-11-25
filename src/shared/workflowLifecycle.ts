/**
 * Single Source of Truth for Canonical ERP Workflow Action Eligibility & Lifecycle Stepper States.
 * Shared across backend `/api/journey` allowedActions computation and frontend `RecordActivityModal` UI
 * so the UI NEVER exposes an action button (such as Edit or Submit for Approval) that the backend
 * workflow guard would reject for a finalized/closed/locked record.
 */

export type LifecycleStageKey = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'POSTED';
export type LifecycleStageVisualState = 'completed' | 'current' | 'upcoming' | 'neutral';

export const FINALIZED_LOCKED_STATUSES = new Set([
  'CLOSED',
  'FULLY_RECEIVED',
  'RECEIVED',
  'COMPLETED',
  'FINALIZED',
  'LOCKED',
  'HARD_CLOSED',
  'SOFT_CLOSED',
  'FILED',
  'SETTLED',
  'CLEARED',
  'LIQUIDATED',
  'RECONCILED',
  'CONVERTED_TO_PO',
  'DISPOSED',
  'PUBLISHED',
]);

export const IN_FLIGHT_FULFILLMENT_STATUSES = new Set([
  'PARTIALLY_RECEIVED',
  'PARTIALLY_LIQUIDATED',
  'ISSUED',
  'SENT',
  'OPEN',
  'ACTIVE',
  'SCHEDULED',
  'PARTNER_SIGN_OFF',
]);

export const REVIEW_PENDING_STATUSES = new Set([
  'UNDER_REVIEW',
  'PENDING_APPROVAL',
  'PENDING',
  'PENDING_VALIDATION',
  'VALIDATED',
  'IN_PROGRESS',
  'FIELDWORK',
  'REVIEW',
  'REVIEWED',
]);

export const NON_GL_COMMITMENT_ENTITY_TYPES = new Set([
  'PURCHASE_ORDER',
  'PURCHASE_REQUISITION',
  'GOODS_RECEIPT',
]);

/**
 * Computes raw workflow actions permitted for a given record status and entity type
 * BEFORE role/RBAC permission filtering.
 *
 * Invariant: `EDIT` and `SUBMIT` are ONLY returned for `DRAFT`, `RETURNED`, `REJECTED`, or `CORRECTION`
 * transactional records (never for `CLOSED`, `COMPLETED`, `RECEIVED`, `POSTED`, `PAID`, or unknown statuses).
 */
export function resolveAllowedRawActionsForStatus(
  status: string,
  entityType: string,
  record?: { balanceDue?: number | string | null } | null
): string[] {
  const st = (status || 'DRAFT').toUpperCase();
  const normalizedEntity = (entityType || '').toUpperCase();
  const isMaster = ['CUSTOMER', 'VENDOR', 'ACCOUNT'].includes(normalizedEntity);

  if (normalizedEntity === 'SYSTEM_OPERATION' || normalizedEntity === 'TAX_CALCULATION') {
    return [];
  }

  if (isMaster) {
    if (st === 'ARCHIVED' || st === 'SOFT_DELETED' || st === 'REMOVED') {
      return ['EDIT', 'RESTORE'];
    }
    if (st === 'INACTIVE') {
      return normalizedEntity === 'ACCOUNT'
        ? ['EDIT', 'REACTIVATE', 'ARCHIVE', 'SOFT_DELETE']
        : ['EDIT', 'REACTIVATE', 'ARCHIVE', 'RESTORE', 'SOFT_DELETE'];
    }
    return normalizedEntity === 'ACCOUNT'
      ? ['EDIT', 'DEACTIVATE', 'ARCHIVE', 'SOFT_DELETE']
      : ['EDIT', 'DEACTIVATE', 'ARCHIVE', 'REMOVE', 'SOFT_DELETE'];
  }

  switch (st) {
    case 'DRAFT':
      return ['EDIT', 'SUBMIT', 'APPROVE', 'CANCEL', 'REMOVE', 'ARCHIVE', 'SOFT_DELETE', 'COPY'];
    case 'RETURNED':
    case 'REJECTED':
    case 'CORRECTION':
      return ['EDIT', 'SUBMIT', 'CANCEL', 'REMOVE', 'SOFT_DELETE', 'COPY'];
    case 'SUBMITTED':
      return ['REVIEW', 'APPROVE', 'REJECT', 'RETURN', 'CANCEL', 'COPY'];
    case 'UNDER_REVIEW':
    case 'PENDING_APPROVAL':
    case 'PENDING':
      return ['APPROVE', 'REJECT', 'RETURN', 'CANCEL', 'COPY'];
    case 'APPROVED':
      if (NON_GL_COMMITMENT_ENTITY_TYPES.has(normalizedEntity)) {
        return ['RETURN', 'CANCEL', 'COPY'];
      }
      return ['POST', 'RETURN', 'CANCEL', 'COPY'];
    case 'POSTED':
    case 'PARTIAL':
    case 'PARTIALLY_PAID':
    case 'PAID': {
      const hasOpenBalance = record?.balanceDue === undefined || record?.balanceDue === null || Number(record.balanceDue) > 0;
      if (normalizedEntity === 'SALES_INVOICE' && st !== 'PAID' && hasOpenBalance) {
        return ['RECORD_COLLECTION', 'REVERSE', 'ADJUST', 'ARCHIVE', 'COPY'];
      }
      if (normalizedEntity === 'PURCHASE_BILL' && st !== 'PAID' && hasOpenBalance) {
        return ['RECORD_DISBURSEMENT', 'REVERSE', 'ADJUST', 'ARCHIVE', 'COPY'];
      }
      return ['REVERSE', 'ADJUST', 'ARCHIVE', 'COPY'];
    }
    case 'REVERSED':
    case 'ADJUSTED':
      return ['ADJUST', 'COPY', 'ARCHIVE'];
    case 'CANCELLED':
    case 'VOID':
    case 'VOIDED':
      return ['RESTORE', 'ARCHIVE', 'SOFT_DELETE', 'COPY'];
    case 'ARCHIVED':
    case 'REMOVED':
    case 'SOFT_DELETED':
      return ['RESTORE', 'COPY'];
    default:
      // Operational terminal/locked states (CLOSED, FULLY_RECEIVED, RECEIVED, COMPLETED, FILED, LOCKED, etc.)
      // and in-flight fulfillment states (PARTIALLY_RECEIVED, ISSUED, OPEN, etc.) must NEVER expose EDIT or SUBMIT.
      if (FINALIZED_LOCKED_STATUSES.has(st)) {
        return ['COPY', 'ARCHIVE'];
      }
      if (IN_FLIGHT_FULFILLMENT_STATUSES.has(st)) {
        return ['COPY'];
      }
      return ['COPY'];
  }
}

/**
 * Maps any ERP status onto the 4-step canonical lifecycle stepper:
 *   1. DRAFT -> 2. SUBMITTED -> 3. APPROVED -> 4. POSTED / LOCKED
 */
export function getCanonicalLifecycleStageState(
  currentStatus: string,
  stageKey: LifecycleStageKey
): LifecycleStageVisualState {
  const st = (currentStatus || 'DRAFT').toUpperCase();
  const order: LifecycleStageKey[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED'];
  const stageIdx = order.indexOf(stageKey);
  if (stageIdx === -1) return 'neutral';

  // Fully finalized / closed / paid operational records complete all 4 lifecycle stages.
  if (FINALIZED_LOCKED_STATUSES.has(st) || st === 'PAID') {
    return 'completed';
  }

  let normalizedStatus: LifecycleStageKey | null = null;
  if (st === 'DRAFT' || st === 'PREPARED' || st === 'PREVIEW' || st === 'PLANNING' || st === 'UNLIQUIDATED') {
    normalizedStatus = 'DRAFT';
  } else if (st === 'SUBMITTED' || REVIEW_PENDING_STATUSES.has(st)) {
    normalizedStatus = 'SUBMITTED';
  } else if (st === 'APPROVED' || IN_FLIGHT_FULFILLMENT_STATUSES.has(st)) {
    normalizedStatus = 'APPROVED';
  } else if (st === 'POSTED' || st === 'PARTIAL' || st === 'PARTIALLY_PAID') {
    normalizedStatus = 'POSTED';
  }

  if (!normalizedStatus) {
    return 'neutral';
  }

  const currIdx = order.indexOf(normalizedStatus);
  if (stageIdx < currIdx) return 'completed';
  if (stageIdx === currIdx) return 'current';
  return 'upcoming';
}

export function isFinalizedLockedStatus(status: string): boolean {
  return FINALIZED_LOCKED_STATUSES.has((status || '').toUpperCase());
}
