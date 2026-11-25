import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCanonicalLifecycleStageState,
  isFinalizedLockedStatus,
  resolveAllowedRawActionsForStatus,
} from './workflowLifecycle';

test('CLOSED Purchase Order never exposes EDIT or SUBMIT and completes all 4 lifecycle stages', () => {
  const actions = resolveAllowedRawActionsForStatus('CLOSED', 'PURCHASE_ORDER');
  assert.equal(actions.includes('EDIT'), false);
  assert.equal(actions.includes('SUBMIT'), false);
  assert.equal(actions.includes('COPY'), true);
  assert.equal(isFinalizedLockedStatus('CLOSED'), true);

  assert.equal(getCanonicalLifecycleStageState('CLOSED', 'DRAFT'), 'completed');
  assert.equal(getCanonicalLifecycleStageState('CLOSED', 'SUBMITTED'), 'completed');
  assert.equal(getCanonicalLifecycleStageState('CLOSED', 'APPROVED'), 'completed');
  assert.equal(getCanonicalLifecycleStageState('CLOSED', 'POSTED'), 'completed');
});

test('operational finalized and in-flight statuses never leak EDIT or SUBMIT actions', () => {
  const lockedStatuses = [
    'CLOSED',
    'FULLY_RECEIVED',
    'RECEIVED',
    'COMPLETED',
    'FINALIZED',
    'LOCKED',
    'HARD_CLOSED',
    'FILED',
    'RECONCILED',
    'CONVERTED_TO_PO',
    'DISPOSED',
    'PARTIALLY_RECEIVED',
    'ISSUED',
    'UNRECOGNIZED_FUTURE_STATUS',
  ];

  for (const st of lockedStatuses) {
    const actions = resolveAllowedRawActionsForStatus(st, 'PURCHASE_ORDER');
    assert.equal(actions.includes('EDIT'), false, `EDIT must not be exposed for ${st}`);
    assert.equal(actions.includes('SUBMIT'), false, `SUBMIT must not be exposed for ${st}`);
  }
});

test('DRAFT, RETURNED, and REJECTED transactional records still permit EDIT and SUBMIT', () => {
  for (const st of ['DRAFT', 'RETURNED', 'REJECTED', 'CORRECTION']) {
    const actions = resolveAllowedRawActionsForStatus(st, 'PURCHASE_ORDER');
    assert.equal(actions.includes('EDIT'), true, `EDIT should be allowed for ${st}`);
    assert.equal(actions.includes('SUBMIT'), true, `SUBMIT should be allowed for ${st}`);
  }
});

test('APPROVED Purchase Order does not expose Post to GL, while APPROVED Sales Invoice does', () => {
  const poActions = resolveAllowedRawActionsForStatus('APPROVED', 'PURCHASE_ORDER');
  assert.equal(poActions.includes('POST'), false);
  assert.equal(poActions.includes('COPY'), true);

  const invActions = resolveAllowedRawActionsForStatus('APPROVED', 'SALES_INVOICE');
  assert.equal(invActions.includes('POST'), true);
});

test('POSTED Sales Invoice & Purchase Bill expose collection/disbursement when open balance > 0', () => {
  const invOpen = resolveAllowedRawActionsForStatus('POSTED', 'SALES_INVOICE', { balanceDue: 50000 });
  assert.equal(invOpen.includes('RECORD_COLLECTION'), true);
  assert.equal(invOpen.includes('EDIT'), false);
  assert.equal(invOpen.includes('SUBMIT'), false);

  const invPaid = resolveAllowedRawActionsForStatus('PAID', 'SALES_INVOICE', { balanceDue: 0 });
  assert.equal(invPaid.includes('RECORD_COLLECTION'), false);
  assert.equal(getCanonicalLifecycleStageState('PAID', 'POSTED'), 'completed');

  const billOpen = resolveAllowedRawActionsForStatus('POSTED', 'PURCHASE_BILL', { balanceDue: 25000 });
  assert.equal(billOpen.includes('RECORD_DISBURSEMENT'), true);
});

test('PARTIALLY_RECEIVED Purchase Order maps to stage 3 APPROVED current in stepper', () => {
  assert.equal(getCanonicalLifecycleStageState('PARTIALLY_RECEIVED', 'DRAFT'), 'completed');
  assert.equal(getCanonicalLifecycleStageState('PARTIALLY_RECEIVED', 'SUBMITTED'), 'completed');
  assert.equal(getCanonicalLifecycleStageState('PARTIALLY_RECEIVED', 'APPROVED'), 'current');
  assert.equal(getCanonicalLifecycleStageState('PARTIALLY_RECEIVED', 'POSTED'), 'upcoming');
});
