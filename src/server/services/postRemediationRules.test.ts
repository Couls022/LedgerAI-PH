import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRequestPath,
  isPublicOrCreationRoutePath,
  isLicenseExemptPath,
  isPasswordChangeAllowedPath,
  validateWorkpaperSignOff,
  validateFixedAssetInput,
} from '../utils/requestPath';
import { calculateDashboardVatEstimate } from '../routes/dashboard';

test('normalizeRequestPath resolves traversal, backslash, and percent-encoded segments', () => {
  assert.equal(normalizeRequestPath('/api/companies/../users'), '/api/users');
  assert.equal(normalizeRequestPath('/api/companies/%2e%2e/users?foo=1'), '/api/users');
  assert.equal(normalizeRequestPath('/api/auth/session/%252e%252e/../accounting/journals'), '/api/accounting/journals');
  assert.equal(normalizeRequestPath('/api/companies\\..\\reports/income-statement/'), '/api/reports/income-statement');
});

test('isPublicOrCreationRoutePath & isLicenseExemptPath block dot-segment traversal bypasses', () => {
  assert.equal(isPublicOrCreationRoutePath('/api/companies'), true);
  assert.equal(isPublicOrCreationRoutePath('/api/companies/../users'), false);
  assert.equal(isPublicOrCreationRoutePath('/api/companies/%2e%2e/accounting/journals'), false);
  assert.equal(isPublicOrCreationRoutePath('/api/companies-malicious'), false);

  assert.equal(isLicenseExemptPath('/api/companies'), true);
  assert.equal(isLicenseExemptPath('/api/companies/cmp-1/licensing/activate'), true);
  assert.equal(isLicenseExemptPath('/api/auth/../accounting/invoices'), false);
});

test('isPasswordChangeAllowedPath allows exact auth endpoints and denies traversal', () => {
  assert.equal(isPasswordChangeAllowedPath('/api/auth/change-password'), true);
  assert.equal(isPasswordChangeAllowedPath('/api/auth/session'), true);
  assert.equal(isPasswordChangeAllowedPath('/api/auth/session/../../accounting/journals'), false);
  assert.equal(isPasswordChangeAllowedPath('/api/auth/session-fake'), false);
});

test('validateWorkpaperSignOff enforces sequential transitions and preparer/reviewer/approver SoD', () => {
  // Invalid skip from DRAFT -> APPROVED
  const skip = validateWorkpaperSignOff({
    currentStatus: 'DRAFT',
    targetStatus: 'APPROVED',
    preparerId: 'u1',
    actingUserId: 'u2',
  });
  assert.equal(skip.ok, false);
  assert.equal(skip.code, 'INVALID_TRANSITION');

  // Preparer cannot review own workpaper
  const selfReview = validateWorkpaperSignOff({
    currentStatus: 'PREPARED',
    targetStatus: 'REVIEWED',
    preparerId: 'u1',
    actingUserId: 'u1',
  });
  assert.equal(selfReview.ok, false);
  assert.equal(selfReview.code, 'SOD_VIOLATION');

  // Reviewer cannot approve own reviewed workpaper
  const selfApprove = validateWorkpaperSignOff({
    currentStatus: 'REVIEWED',
    targetStatus: 'APPROVED',
    preparerId: 'u1',
    reviewerId: 'u2',
    actingUserId: 'u2',
  });
  assert.equal(selfApprove.ok, false);
  assert.equal(selfApprove.code, 'SOD_VIOLATION');

  // Valid sequential flow: DRAFT -> PREPARED (u1), PREPARED -> REVIEWED (u2), REVIEWED -> APPROVED (u3)
  assert.equal(
    validateWorkpaperSignOff({ currentStatus: 'DRAFT', targetStatus: 'PREPARED', actingUserId: 'u1' }).ok,
    true
  );
  assert.equal(
    validateWorkpaperSignOff({ currentStatus: 'PREPARED', targetStatus: 'REVIEWED', preparerId: 'u1', actingUserId: 'u2' }).ok,
    true
  );
  assert.equal(
    validateWorkpaperSignOff({
      currentStatus: 'REVIEWED',
      targetStatus: 'APPROVED',
      preparerId: 'u1',
      reviewerId: 'u2',
      actingUserId: 'u3',
    }).ok,
    true
  );
});

test('validateFixedAssetInput rejects invalid cost, salvage, and usefulLifeMonths bounds', () => {
  assert.equal(validateFixedAssetInput({ acquisitionCost: 0, salvageValue: 0, usefulLifeMonths: 12 }).ok, false);
  assert.equal(validateFixedAssetInput({ acquisitionCost: -100, salvageValue: 0, usefulLifeMonths: 12 }).ok, false);
  assert.equal(validateFixedAssetInput({ acquisitionCost: 1000, salvageValue: -1, usefulLifeMonths: 12 }).ok, false);
  assert.equal(validateFixedAssetInput({ acquisitionCost: 1000, salvageValue: 1000, usefulLifeMonths: 12 }).ok, false);
  assert.equal(validateFixedAssetInput({ acquisitionCost: 1000, salvageValue: 100, usefulLifeMonths: 0 }).ok, false);
  assert.equal(validateFixedAssetInput({ acquisitionCost: 1000, salvageValue: 100, usefulLifeMonths: 601 }).ok, false);
  assert.equal(validateFixedAssetInput({ acquisitionCost: 1000, salvageValue: 100, usefulLifeMonths: 12.5 }).ok, false);
  assert.equal(validateFixedAssetInput({ acquisitionCost: 1000, salvageValue: 100, usefulLifeMonths: 36 }).ok, true);
});

test('calculateDashboardVatEstimate uses real stored CWT/EWT (no synthetic 2% fabrication)', () => {
  const zeroEwt = calculateDashboardVatEstimate({
    grossRevenueCentavos: 112000,
    grossExpenseCentavos: 56000,
    storedOutputVatCentavos: 12000,
    storedInputVatCentavos: 6000,
    storedEwtCentavos: 0,
    isVatRegistered: true,
  });
  assert.equal(zeroEwt.ewtWithheld, 0);
  assert.equal(zeroEwt.outputVat, 12000);
  assert.equal(zeroEwt.inputVat, 6000);
  assert.equal(zeroEwt.netVatPayable, 6000);

  const realCwt = calculateDashboardVatEstimate({
    grossRevenueCentavos: 112000,
    grossExpenseCentavos: 56000,
    storedOutputVatCentavos: 0,
    storedInputVatCentavos: 0,
    storedEwtCentavos: 150000,
    isVatRegistered: true,
  });
  assert.equal(realCwt.ewtWithheld, 150000);
  assert.equal(realCwt.methodology, 'VAT_INCLUSIVE_12_112');
});
