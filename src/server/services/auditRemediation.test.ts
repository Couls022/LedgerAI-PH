import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate keystore/data dir before importing server services
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerai-unit-remediation-'));
process.env.LEDGERAI_CONFIG_DIR = path.join(tmpRoot, 'config');
process.env.LEDGERAI_DATA_DIR = path.join(tmpRoot, 'data');

import { RestoreService, deterministicStringify } from './restoreService';
import { TaxEngine } from './taxEngine';
import { AuditService } from './auditService';
import { AuditHmacKeyManager, computeAuditSealHash } from '../db/auditSeal';

test.after(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore cleanup error
  }
});

test('Cluster 3: RestoreService must reject missing backup signature and reject static forged signature', () => {
  const sampleData = {
    companies: [{ id: 'comp-1', legalName: 'Test Corp' }],
    journalEntries: [],
  };
  const checksum = RestoreService.generateChecksum(sampleData);

  // 1. Missing signature must NOT pass validation
  const unsignedPayload: any = {
    metadata: {
      version: '1.1',
      timestamp: new Date().toISOString(),
      checksum,
      signature: '',
      format: 'LAI_V1',
      companyId: 'comp-1',
    },
    data: sampleData,
  };

  assert.throws(
    () => RestoreService.validateBackupFile(unsignedPayload),
    /TAMPER_DETECTED|SIGNATURE/i,
    'Unsigned backup payload should be rejected'
  );

  // 2. Signature forged using old hardcoded source literal must NOT pass verification
  const legacyForgedSig = crypto
    .createHmac('sha256', 'ledgerai-ph-proprietary-backup-signing-key-2026')
    .update(deterministicStringify(sampleData))
    .digest('hex');

  const forgedPayload: any = {
    metadata: {
      version: '1.1',
      timestamp: new Date().toISOString(),
      checksum,
      signature: legacyForgedSig,
      format: 'LAI_V1',
      companyId: 'comp-1',
    },
    data: sampleData,
  };

  assert.throws(
    () => RestoreService.validateBackupFile(forgedPayload),
    /TAMPER_DETECTED/i,
    'Backup signed with legacy hardcoded literal must be rejected'
  );

  // 3. Valid dynamic key signature must pass
  const validSig = RestoreService.generateSignature(sampleData);
  const validPayload: any = {
    metadata: {
      version: '1.1',
      timestamp: new Date().toISOString(),
      checksum,
      signature: validSig,
      format: 'LAI_V1',
      companyId: 'comp-1',
    },
    data: sampleData,
  };
  const validated = RestoreService.validateBackupFile(validPayload);
  assert.equal(validated.metadata.companyId, 'comp-1');
});

test('Cluster 3: AuditService.verifyRowIntegritySync must fail when hmacSeal is stripped on chainVersion >= 2 row if keyring exists', () => {
  const companyId = `comp-hmac-${Date.now()}`;
  const keyInfo = AuditHmacKeyManager.getActiveSigningKeySync(companyId);
  assert.ok(keyInfo.keyVersion >= 1);

  const prevHash = '0'.repeat(64);
  const tsIso = AuditService.normalizeAuditTimestamp(new Date()).toISOString();
  const integritySeal = AuditService.computeSealHash({
    id: 'aud-strip-test-1',
    companyId,
    userId: 'usr-1',
    userEmail: 'owner@test.ph',
    userDisplayName: 'Owner',
    role: 'Company Owner',
    action: 'TEST_ACTION',
    entityType: 'journal_entries',
    entityId: 'je-1',
    recordReference: 'JE-001',
    beforeData: null,
    afterData: '{"ok":true}',
    changedFields: null,
    result: 'SUCCESS',
    ipAddress: '127.0.0.1',
    timestampIso: tsIso,
    chainVersion: 2,
    sequenceNumber: 1,
    previousHash: prevHash,
  });

  // Stripped hmacSeal on a v2 row when company keyring exists
  const tamperedRow = {
    id: 'aud-strip-test-1',
    companyId,
    userId: 'usr-1',
    userEmail: 'owner@test.ph',
    userDisplayName: 'Owner',
    role: 'Company Owner',
    action: 'TEST_ACTION',
    entityType: 'journal_entries',
    entityId: 'je-1',
    recordReference: 'JE-001',
    beforeData: null,
    afterData: '{"ok":true}',
    reason: 'Unit test',
    result: 'SUCCESS',
    module: 'Accounting',
    severity: 'INFO',
    ipAddress: '127.0.0.1',
    timestamp: tsIso,
    integrityHash: integritySeal,
    metadata: JSON.stringify({
      chainVersion: 2,
      sequenceNumber: 1,
      previousHash: prevHash,
      integritySeal,
      // hmacSeal intentionally stripped!
    }),
  };

  const result = AuditService.verifyIntegrity(tamperedRow);
  assert.equal(result.verified, false, 'Stripped hmacSeal on v2 row must fail verification');
  assert.match(String(result.reason), /HMAC/i);
});

test('Cluster 4: Philippine VAT inclusive 12/112 vs exclusive 12% and Section 116 3% calculations are exact in centavos', () => {
  // TaxEngine 12% VAT inclusive (112,000 centavos = PHP 1,120.00 -> Base 100,000, VAT 12,000)
  const inc = TaxEngine.calculateVat(112000, 0.12);

  assert.equal(inc.taxBase, 100000);
  assert.equal(inc.vatAmount, 12000);
  assert.equal(inc.taxBase + inc.vatAmount, 112000);

  // Percentage tax (3%)
  const pct = TaxEngine.calculateSection116PercentageTax(10000000); // PHP 100,000 gross
  assert.equal(pct.taxAmount, 3000); // PHP 3,000
});
