import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { DatabaseEncryptionService } from '../../src/server/services/databaseEncryptionService';
import { paths } from '../../src/server/services/paths';

describe('Phase G — Emergency Disaster Recovery Key & Post-Rotation Recovery Verification (DEF-ADV-002)', () => {
  let tempDir: string;
  const companyId = 'LGR-DR-ADVERSARIAL-01';
  let sourceDbPath: string;
  let laiPath: string;
  let recoveredDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerai-dr-adv-'));
    sourceDbPath = path.join(tempDir, 'source.sqlite');
    laiPath = path.join(tempDir, 'database.lai');
    recoveredDbPath = path.join(tempDir, 'recovered.sqlite');

    const safeId = companyId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const keystoreFile = path.join(paths.getConfigDir(), '.keystore_vault', `${safeId}.keyring.json`);
    if (fs.existsSync(keystoreFile)) {
      fs.unlinkSync(keystoreFile);
    }

    const db = new Database(sourceDbPath);
    db.exec('CREATE TABLE test_recovery (id INTEGER PRIMARY KEY, secret TEXT, balance_centavos INTEGER);');
    db.prepare('INSERT INTO test_recovery (secret, balance_centavos) VALUES (?, ?)').run(
      'CRITICAL_FINANCIAL_LEDGER_STATE_2026',
      244884333
    );
    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    const safeId = companyId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const keystoreFile = path.join(paths.getConfigDir(), '.keystore_vault', `${safeId}.keyring.json`);
    if (fs.existsSync(keystoreFile)) {
      fs.unlinkSync(keystoreFile);
    }
  });

  it('1. recovers LAISENC2 database via recoverDatabaseWithRecoveryKeySync when .keystore_vault is completely deleted (cross-machine disaster recovery)', () => {
    const keyring = DatabaseEncryptionService.getOrProvisionCompanyKeyringSync(companyId, 'OS_KEYCHAIN_STANDALONE');
    expect(keyring.recoveryKeyHex).toBeDefined();
    expect(keyring.recoveryKeyHex?.length).toBe(64);
    const recoveryKeyHex = keyring.recoveryKeyHex!;

    DatabaseEncryptionService.encryptDatabaseFileSync(sourceDbPath, laiPath, {
      companyId,
      classification: 'PRODUCTION',
      keyMode: 'OS_KEYCHAIN_STANDALONE',
    });

    const meta = DatabaseEncryptionService.inspectContainerMetadataSync(laiPath);
    expect(meta.containerVersion).toBe('LAISENC2');
    expect(meta.hasRecoveryEnvelope).toBe(true);

    // Delete the local .keystore_vault file completely to simulate moving the .lai file to a brand-new host
    const safeId = companyId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const keystoreFile = path.join(paths.getConfigDir(), '.keystore_vault', `${safeId}.keyring.json`);
    fs.unlinkSync(keystoreFile);
    expect(fs.existsSync(keystoreFile)).toBe(false);

    // Normal decrypt fails because a brand-new random KEK is provisioned when the vault is missing
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(laiPath, recoveredDbPath);
    }).toThrow(/DECRYPTION_FAILED/);

    // Remove the mismatched auto-provisioned keyring and execute official service recovery
    if (fs.existsSync(keystoreFile)) fs.unlinkSync(keystoreFile);

    const recoveryResult = DatabaseEncryptionService.recoverDatabaseWithRecoveryKeySync(
      laiPath,
      recoveredDbPath,
      recoveryKeyHex,
      { reprovisionLocalKeystore: true }
    );

    expect(recoveryResult.companyId).toBe(companyId);
    expect(recoveryResult.keyVersion).toBe(1);
    expect(fs.existsSync(recoveredDbPath)).toBe(true);

    // Verify SQLite integrity and exact financial data
    const recoveredDb = new Database(recoveredDbPath);
    const integrity = recoveredDb.pragma('integrity_check', { simple: true });
    expect(integrity).toBe('ok');
    const row = recoveredDb.prepare('SELECT secret, balance_centavos FROM test_recovery WHERE id = 1').get() as any;
    expect(row.secret).toBe('CRITICAL_FINANCIAL_LEDGER_STATE_2026');
    expect(row.balance_centavos).toBe(244884333);
    recoveredDb.close();

    // Verify that subsequent standard decryptDatabaseFileSync now succeeds on the new host because keystore was reprovisioned
    const secondDecryptPath = path.join(tempDir, 'second_decrypt.sqlite');
    const ok = DatabaseEncryptionService.decryptDatabaseFileSync(laiPath, secondDecryptPath);
    expect(ok).toBe(true);

    // Verify RECOVERY_KEY_USED audit trail entry
    const auditEvents = DatabaseEncryptionService.getKeyAccessAuditLog(companyId);
    expect(auditEvents.some((e) => e.operation === 'RECOVERY_KEY_USED' && e.status === 'SUCCESS')).toBe(true);
  });

  it('2. recovers LAISENC2 database when .keystore_vault is corrupted or machine binding changes', () => {
    const keyring = DatabaseEncryptionService.getOrProvisionCompanyKeyringSync(companyId, 'OS_KEYCHAIN_STANDALONE');
    const recoveryKeyHex = keyring.recoveryKeyHex!;

    DatabaseEncryptionService.encryptDatabaseFileSync(sourceDbPath, laiPath, {
      companyId,
      classification: 'PILOT',
      keyMode: 'OS_KEYCHAIN_STANDALONE',
    });

    // Corrupt the local keystore file with an invalid OS-anchor ciphertext (simulating different hostname/OS user)
    const safeId = companyId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const keystoreFile = path.join(paths.getConfigDir(), '.keystore_vault', `${safeId}.keyring.json`);
    const stored = JSON.parse(fs.readFileSync(keystoreFile, 'utf8'));
    stored.wrappedKekHex = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keystoreFile, JSON.stringify(stored, null, 2));

    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(laiPath, recoveredDbPath);
    }).toThrow(/OS_KEYCHAIN_UNWRAP_FAILED|DECRYPTION_FAILED/);

    // Recover using emergency recovery key
    const res = DatabaseEncryptionService.recoverDatabaseWithRecoveryKeySync(
      laiPath,
      recoveredDbPath,
      recoveryKeyHex
    );
    expect(res.companyId).toBe(companyId);

    const db = new Database(recoveredDbPath);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    db.close();
  });

  it('3. preserves recoveryEnvelope across key rotation (v1 -> v2) and rejects wrong or pre-rotation recovery keys', () => {
    const initialRing = DatabaseEncryptionService.getOrProvisionCompanyKeyringSync(companyId, 'OS_KEYCHAIN_STANDALONE');
    const initialRecoveryKeyHex = initialRing.recoveryKeyHex!;

    DatabaseEncryptionService.encryptDatabaseFileSync(sourceDbPath, laiPath, {
      companyId,
      classification: 'PRODUCTION',
      keyMode: 'OS_KEYCHAIN_STANDALONE',
    });

    // Rotate key to v2 (issues a new 256-bit recovery key for v2)
    const rotation = DatabaseEncryptionService.rotateCompanyDatabaseKeySync(
      companyId,
      sourceDbPath,
      laiPath,
      'OS_KEYCHAIN_STANDALONE'
    );
    expect(rotation.previousKeyVersion).toBe(1);
    expect(rotation.newKeyVersion).toBe(2);
    expect(rotation.recoveryKeyHex).toBeDefined();
    expect(rotation.recoveryKeyHex).not.toBe(initialRecoveryKeyHex);

    const metaAfterRotate = DatabaseEncryptionService.inspectContainerMetadataSync(laiPath);
    expect(metaAfterRotate.keyVersion).toBe(2);
    expect(metaAfterRotate.hasRecoveryEnvelope).toBe(true);

    // Delete local keystore to force recovery key usage
    const safeId = companyId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const keystoreFile = path.join(paths.getConfigDir(), '.keystore_vault', `${safeId}.keyring.json`);
    fs.unlinkSync(keystoreFile);

    // Old v1 recovery key must fail on v2 rotated container
    expect(() => {
      DatabaseEncryptionService.recoverDatabaseWithRecoveryKeySync(laiPath, recoveredDbPath, initialRecoveryKeyHex);
    }).toThrow(/RECOVERY_FAILED/);

    // Random wrong recovery key must fail
    const wrongRecoveryKey = crypto.randomBytes(32).toString('hex');
    expect(() => {
      DatabaseEncryptionService.recoverDatabaseWithRecoveryKeySync(laiPath, recoveredDbPath, wrongRecoveryKey);
    }).toThrow(/RECOVERY_FAILED/);

    // New v2 recovery key succeeds and restores the database and v2 keystore
    const recovered = DatabaseEncryptionService.recoverDatabaseWithRecoveryKeySync(
      laiPath,
      recoveredDbPath,
      rotation.recoveryKeyHex!
    );
    expect(recovered.keyVersion).toBe(2);

    const db = new Database(recoveredDbPath);
    const row = db.prepare('SELECT secret, balance_centavos FROM test_recovery WHERE id = 1').get() as any;
    expect(row.secret).toBe('CRITICAL_FINANCIAL_LEDGER_STATE_2026');
    expect(row.balance_centavos).toBe(244884333);
    db.close();
  });

  it('4. rejects recovery when recoveryEnvelope is removed, spliced from a foreign company, or spliced from a pre-rotation v1 envelope (DEF-CHAL-002)', () => {
    const initialRing = DatabaseEncryptionService.getOrProvisionCompanyKeyringSync(companyId, 'OS_KEYCHAIN_STANDALONE');
    const v1RecoveryKeyHex = initialRing.recoveryKeyHex!;
    const v1RecoveryEnvelope = initialRing.recoveryEnvelope!;

    DatabaseEncryptionService.encryptDatabaseFileSync(sourceDbPath, laiPath, {
      companyId,
      classification: 'PRODUCTION',
      keyMode: 'OS_KEYCHAIN_STANDALONE',
    });

    // Rotate to v2
    const rotation = DatabaseEncryptionService.rotateCompanyDatabaseKeySync(
      companyId,
      sourceDbPath,
      laiPath,
      'OS_KEYCHAIN_STANDALONE'
    );

    const mutateContainerMeta = (mutator: (m: any) => void): string => {
      const buf = fs.readFileSync(laiPath);
      const magic = buf.subarray(0, 8);
      const metaLen = buf.readUInt32BE(8);
      const metaEnd = 12 + metaLen;
      const meta = JSON.parse(buf.subarray(12, metaEnd).toString('utf8'));
      const ciphertext = buf.subarray(metaEnd);
      mutator(meta);
      const metaBytes = Buffer.from(JSON.stringify(meta), 'utf8');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(metaBytes.length, 0);
      const outPath = path.join(tempDir, `spliced-${Date.now()}-${Math.random().toString(36).slice(2)}.lai`);
      fs.writeFileSync(outPath, Buffer.concat([magic, lenBuf, metaBytes, ciphertext]));
      return outPath;
    };

    // Case A: Remove recoveryEnvelope from container metadata (even while local keystore exists)
    const removedEnvPath = mutateContainerMeta((m) => {
      delete m.recoveryEnvelope;
    });
    expect(() => {
      DatabaseEncryptionService.recoverDatabaseWithRecoveryKeySync(
        removedEnvPath,
        recoveredDbPath,
        rotation.recoveryKeyHex!
      );
    }).toThrow(/RECOVERY_FAILED/);

    // Case B: Splice v1 recoveryEnvelope onto v2 rotated container and attempt recovery with v1 recoveryKey
    const splicedV1Path = mutateContainerMeta((m) => {
      m.recoveryEnvelope = v1RecoveryEnvelope;
    });
    expect(() => {
      DatabaseEncryptionService.recoverDatabaseWithRecoveryKeySync(
        splicedV1Path,
        recoveredDbPath,
        v1RecoveryKeyHex
      );
    }).toThrow(/RECOVERY_FAILED/);

    // Case C: Splice foreign company's recoveryEnvelope onto container and attempt recovery with foreign recoveryKey
    const foreignCompanyId = 'LGR-DR-FOREIGN-99';
    const foreignSafeId = foreignCompanyId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const foreignKeystore = path.join(paths.getConfigDir(), '.keystore_vault', `${foreignSafeId}.keyring.json`);
    if (fs.existsSync(foreignKeystore)) fs.unlinkSync(foreignKeystore);
    const foreignRing = DatabaseEncryptionService.getOrProvisionCompanyKeyringSync(
      foreignCompanyId,
      'OS_KEYCHAIN_STANDALONE'
    );
    const splicedForeignPath = mutateContainerMeta((m) => {
      m.recoveryEnvelope = foreignRing.recoveryEnvelope;
    });
    expect(() => {
      DatabaseEncryptionService.recoverDatabaseWithRecoveryKeySync(
        splicedForeignPath,
        recoveredDbPath,
        foreignRing.recoveryKeyHex!
      );
    }).toThrow(/RECOVERY_FAILED/);
    if (fs.existsSync(foreignKeystore)) fs.unlinkSync(foreignKeystore);
  });
});
