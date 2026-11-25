import test from 'node:test';
import assert from 'node:assert/strict';
import { getDetailTypeDefinition } from './accountCategories';
import {
  deduplicateAccountingPeriods,
  formatIsoDateSafe,
  computeTrialBalanceSummary,
  validateTrialBalanceCertification,
  calculateBirRmc122024Fx,
} from './accountingGlUtils';

test('getDetailTypeDefinition resolves cross-type detail types like ALLOWANCE_DOUBTFUL under ASSET', () => {
  const def = getDetailTypeDefinition('ASSET', 'ALLOWANCE_DOUBTFUL');
  assert.ok(def, 'ALLOWANCE_DOUBTFUL should resolve even when accountType is ASSET');
  assert.equal(def?.label, 'Allowance for Doubtful Accounts');

  const direct = getDetailTypeDefinition('ASSET', 'CHECKING');
  assert.equal(direct?.label, 'Checking Account');

  const caseInsensitive = getDetailTypeDefinition('other_current_liability', 'ewt_payable');
  assert.equal(caseInsensitive?.label, 'Expanded Withholding Tax (EWT) Payable');

  assert.equal(getDetailTypeDefinition('ASSET', 'NON_EXISTENT_CODE'), undefined);
});

test('deduplicateAccountingPeriods keeps authoritative period with journals/stricter status and flags duplicates', () => {
  const input = [
    { id: 'dup-1', name: '2026-12', startDate: '2026-12-01', endDate: '2026-12-31', fiscalYear: 2026, status: 'OPEN', journalCount: 0, historyCount: 1 },
    { id: 'ap-123-2026-12', name: '2026-12', startDate: '2026-12-01', endDate: '2026-12-31', fiscalYear: 2026, status: 'SOFT_CLOSED', journalCount: 4, historyCount: 2 },
    { id: 'dup-2', name: '2026-11', startDate: '2026-11-01', endDate: '2026-11-30', fiscalYear: 2026, status: 'OPEN', journalCount: 0, historyCount: 0 },
    { id: 'ap-123-2026-11', name: '2026-11', startDate: '2026-11-01', endDate: '2026-11-30', fiscalYear: 2026, status: 'OPEN', journalCount: 0, historyCount: 1 },
  ];

  const { canonical, duplicates } = deduplicateAccountingPeriods(input);
  assert.equal(canonical.length, 2);
  assert.equal(duplicates.length, 2);
  assert.equal(canonical[0].id, 'ap-123-2026-12');
  assert.equal(canonical[1].id, 'ap-123-2026-11');
  assert.deepEqual(
    duplicates.map((d) => d.id).sort(),
    ['dup-1', 'dup-2']
  );
});

test('formatIsoDateSafe prevents timezone day-shift on ISO dates', () => {
  assert.equal(formatIsoDateSafe('2026-11-19'), '2026-11-19');
  assert.equal(formatIsoDateSafe('2026-11-19T00:00:00.000Z'), '2026-11-19');
  assert.equal(formatIsoDateSafe(null), '-');
  assert.equal(formatIsoDateSafe(undefined), '-');
});

test('computeTrialBalanceSummary and validateTrialBalanceCertification enforce DR === CR invariants', () => {
  const balanced = computeTrialBalanceSummary([
    { openingDebit: 100000, openingCredit: 0, periodDebit: 50000, periodCredit: 10000, closingDebit: 150000, closingCredit: 10000 },
    { openingDebit: 0, openingCredit: 100000, periodDebit: 10000, periodCredit: 50000, closingDebit: 10000, closingCredit: 150000 },
  ]);
  assert.equal(balanced.isBalanced, true);
  assert.equal(balanced.closingVariance, 0);
  assert.equal(validateTrialBalanceCertification(balanced).allowed, true);

  const unbalanced = computeTrialBalanceSummary([
    { openingDebit: 100000, openingCredit: 0, periodDebit: 50000, periodCredit: 0, closingDebit: 150000, closingCredit: 0 },
    { openingDebit: 0, openingCredit: 100000, periodDebit: 0, periodCredit: 49900, closingDebit: 0, closingCredit: 149900 },
  ]);
  assert.equal(unbalanced.isBalanced, false);
  assert.equal(unbalanced.closingVariance, 100);
  const check = validateTrialBalanceCertification(unbalanced);
  assert.equal(check.allowed, false);
  assert.match(check.reason || '', /out-of-balance/i);
});

test('calculateBirRmc122024Fx separates taxable Realized FX from ITR-excluded Unrealized FX', () => {
  const realizedGain = calculateBirRmc122024Fx({
    foreignAmount: 1000,
    recordedRate: 56.5,
    closingOrSettlementRate: 58.25,
    mode: 'REALIZED',
  });
  assert.equal(realizedGain.recordedPhp, 56500);
  assert.equal(realizedGain.settlementPhp, 58250);
  assert.equal(realizedGain.gainPhp, 1750);
  assert.equal(realizedGain.lossPhp, 0);
  assert.equal(realizedGain.classification, 'GAIN');
  assert.equal(realizedGain.isTaxableInItr, true);

  const unrealizedLoss = calculateBirRmc122024Fx({
    foreignAmount: 2000,
    recordedRate: 58.5,
    closingOrSettlementRate: 57.0,
    mode: 'UNREALIZED',
  });
  assert.equal(unrealizedLoss.recordedPhp, 117000);
  assert.equal(unrealizedLoss.settlementPhp, 114000);
  assert.equal(unrealizedLoss.gainPhp, 0);
  assert.equal(unrealizedLoss.lossPhp, 3000);
  assert.equal(unrealizedLoss.classification, 'LOSS');
  assert.equal(unrealizedLoss.isTaxableInItr, false);
});
