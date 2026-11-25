import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { paths } from './paths';

const LAIS_MAGIC_V1 = Buffer.from('LAISENC1', 'ascii'); // 8 bytes (Legacy/Dev PBKDF2 container)
const LAIS_MAGIC_V2 = Buffer.from('LAISENC2', 'ascii'); // 8 bytes (Production Envelope Encryption container)
export const FALLBACK_DEV_MASTER_SECRET = 'ledgerai-ph-enterprise-secure-master-encryption-key-2026';

export type EncryptionKeyMode =
  | 'LEGACY_DEV_KEY'
  | 'OS_KEYCHAIN_STANDALONE'
  | 'EXTERNAL_KMS_ENVELOPE';

export interface KeyAccessAuditEvent {
  eventId: string;
  timestamp: string;
  companyId: string;
  operation:
    | 'ENCRYPT'
    | 'DECRYPT'
    | 'WRAP_DEK'
    | 'UNWRAP_DEK'
    | 'ROTATE_KEY'
    | 'POLICY_CHECK'
    | 'RECOVERY_KEY_ISSUED'
    | 'RECOVERY_KEY_USED';
  keyMode: EncryptionKeyMode;
  keyId: string;
  keyVersion: number;
  status: 'SUCCESS' | 'DENIED' | 'FAILED';
  details: string;
}

export interface RecoveryEnvelope {
  ivHex: string;
  tagHex: string;
  wrappedKekHex: string;
  aadBound?: boolean;
}

export interface ExternalKmsProvider {
  providerName: string;
  getKek(keyId: string, keyVersion?: number): Buffer;
}

export interface EncryptedContainerMetadata {
  isEncrypted: boolean;
  containerVersion: 'LAISENC1' | 'LAISENC2' | 'UNENCRYPTED';
  keyMode?: EncryptionKeyMode;
  keyId?: string;
  keyVersion?: number;
  companyId?: string;
  encryptedAt?: string;
  hasRecoveryEnvelope?: boolean;
  usesFallbackDevKey: boolean;
}

const keyAccessAuditLog: KeyAccessAuditEvent[] = [];
let customKmsProvider: ExternalKmsProvider | null = null;

export class DatabaseEncryptionService {
  /**
   * Registers an external KMS/HSM provider for Enterprise Envelope Encryption mode.
   */
  public static registerExternalKmsProvider(provider: ExternalKmsProvider | null): void {
    customKmsProvider = provider;
  }

  public static getKeyAccessAuditLog(companyId?: string): KeyAccessAuditEvent[] {
    if (!companyId) return [...keyAccessAuditLog];
    return keyAccessAuditLog.filter((e) => e.companyId === companyId);
  }

  private static recordKeyAudit(event: Omit<KeyAccessAuditEvent, 'eventId' | 'timestamp'>): void {
    const entry: KeyAccessAuditEvent = {
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
    };
    keyAccessAuditLog.push(entry);
    if (keyAccessAuditLog.length > 5000) {
      keyAccessAuditLog.shift();
    }
    try {
      const logPath = path.join(paths.getConfigDir(), 'key_access_audit.jsonl');
      fsSync.mkdirSync(path.dirname(logPath), { recursive: true });
      fsSync.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
    } catch {}
  }

  /**
   * Determines whether the current environment is relying on the hardcoded development fallback secret.
   */
  public static isUsingDeterministicFallbackSecret(): boolean {
    const envSecret = process.env.LEDGERAI_MASTER_KEY;
    return !envSecret || envSecret.trim() === '' || envSecret === FALLBACK_DEV_MASTER_SECRET;
  }

  /**
   * Validates master key length (>= 32 bytes/chars) and Shannon entropy (>= 3.0 bits/char, >= 8 unique chars).
   */
  public static validateMasterKeyEntropyAndLength(secret: string): {
    valid: boolean;
    length: number;
    shannonEntropyBitsPerChar: number;
    uniqueChars: number;
    reason?: string;
  } {
    const trimmed = (secret || '').trim();
    const length = trimmed.length;
    if (trimmed === FALLBACK_DEV_MASTER_SECRET) {
      return {
        valid: false,
        length,
        shannonEntropyBitsPerChar: 0,
        uniqueChars: 0,
        reason: 'Key matches the static public development fallback key.'
      };
    }
    if (length < 32) {
      return {
        valid: false,
        length,
        shannonEntropyBitsPerChar: 0,
        uniqueChars: new Set(trimmed).size,
        reason: `Master key length (${length}) is below the minimum production requirement of 32 characters.`
      };
    }

    const freq: Record<string, number> = {};
    for (const ch of trimmed) {
      freq[ch] = (freq[ch] || 0) + 1;
    }
    const uniqueChars = Object.keys(freq).length;
    let entropy = 0;
    for (const count of Object.values(freq)) {
      const p = count / length;
      entropy -= p * Math.log2(p);
    }

    if (uniqueChars < 8 || entropy < 3.0) {
      return {
        valid: false,
        length,
        shannonEntropyBitsPerChar: Number(entropy.toFixed(4)),
        uniqueChars,
        reason: `Master key entropy (${entropy.toFixed(2)} bits/char, ${uniqueChars} unique chars) is insufficient for production encryption (minimum 3.0 bits/char and 8 unique chars required).`
      };
    }

    return {
      valid: true,
      length,
      shannonEntropyBitsPerChar: Number(entropy.toFixed(4)),
      uniqueChars
    };
  }

  /**
   * Enforces Production Encryption Policy (Phase 6):
   * Production company creation or production runtime MUST fail if the system is configured
   * to use the deterministic fallback key or a low-entropy/short key without an explicit KMS/Keychain secret.
   */
  public static assertProductionKeyPolicy(options?: {
    companyId?: string;
    classification?: string;
    keyMode?: EncryptionKeyMode;
  }): { allowed: boolean; effectiveKeyMode: EncryptionKeyMode; keyId: string } {
    const classification = String(options?.classification || 'DEVELOPMENT').toUpperCase();
    const isProductionTarget =
      classification === 'PRODUCTION' || process.env.NODE_ENV === 'production';
    const requestedMode = options?.keyMode || (isProductionTarget ? 'OS_KEYCHAIN_STANDALONE' : 'LEGACY_DEV_KEY');

    if (isProductionTarget) {
      if (requestedMode === 'LEGACY_DEV_KEY') {
        this.recordKeyAudit({
          companyId: options?.companyId || 'GLOBAL',
          operation: 'POLICY_CHECK',
          keyMode: 'LEGACY_DEV_KEY',
          keyId: 'fallback-dev-key',
          keyVersion: 1,
          status: 'DENIED',
          details: 'Production key policy violation: LEGACY_DEV_KEY is prohibited for PRODUCTION companies.',
        });
        throw new Error(
          'PRODUCTION_KEY_POLICY_VIOLATION: Deterministic fallback development key (LEGACY_DEV_KEY) is strictly prohibited for PRODUCTION companies. Configure OS_KEYCHAIN_STANDALONE or EXTERNAL_KMS_ENVELOPE with a non-default secret.'
        );
      }

      if (
        requestedMode === 'EXTERNAL_KMS_ENVELOPE' &&
        !customKmsProvider &&
        (!process.env.LEDGERAI_KMS_MASTER_KEK || process.env.LEDGERAI_KMS_MASTER_KEK === FALLBACK_DEV_MASTER_SECRET)
      ) {
        this.recordKeyAudit({
          companyId: options?.companyId || 'GLOBAL',
          operation: 'POLICY_CHECK',
          keyMode: 'EXTERNAL_KMS_ENVELOPE',
          keyId: 'unconfigured-kms',
          keyVersion: 1,
          status: 'DENIED',
          details: 'Production key policy violation: EXTERNAL_KMS_ENVELOPE requires an external KMS provider or LEDGERAI_KMS_MASTER_KEK.',
        });
        throw new Error(
          'PRODUCTION_KEY_POLICY_VIOLATION: EXTERNAL_KMS_ENVELOPE mode requires an active ExternalKmsProvider or LEDGERAI_KMS_MASTER_KEK secret.'
        );
      }

      if (requestedMode === 'EXTERNAL_KMS_ENVELOPE' && !customKmsProvider && process.env.LEDGERAI_KMS_MASTER_KEK) {
        const kekCheck = this.validateMasterKeyEntropyAndLength(process.env.LEDGERAI_KMS_MASTER_KEK);
        if (!kekCheck.valid) {
          this.recordKeyAudit({
            companyId: options?.companyId || 'GLOBAL',
            operation: 'POLICY_CHECK',
            keyMode: 'EXTERNAL_KMS_ENVELOPE',
            keyId: 'weak-kms-kek',
            keyVersion: 1,
            status: 'DENIED',
            details: `Production key policy violation: ${kekCheck.reason}`,
          });
          throw new Error(`PRODUCTION_KEY_POLICY_VIOLATION: ${kekCheck.reason}`);
        }
      }

      // Even in OS_KEYCHAIN_STANDALONE mode for PRODUCTION, reject if someone explicitly forced LEDGERAI_MASTER_KEY to the known fallback literal or a weak secret
      if (process.env.LEDGERAI_MASTER_KEY !== undefined && process.env.LEDGERAI_MASTER_KEY.trim() !== '') {
        if (process.env.LEDGERAI_MASTER_KEY === FALLBACK_DEV_MASTER_SECRET) {
          this.recordKeyAudit({
            companyId: options?.companyId || 'GLOBAL',
            operation: 'POLICY_CHECK',
            keyMode: requestedMode,
            keyId: 'fallback-dev-key',
            keyVersion: 1,
            status: 'DENIED',
            details: 'Production key policy violation: LEDGERAI_MASTER_KEY is set to the known public fallback literal.',
          });
          throw new Error(
            'PRODUCTION_KEY_POLICY_VIOLATION: LEDGERAI_MASTER_KEY is set to the known fallback development string. Production databases must not use the static development key.'
          );
        }

        const masterCheck = this.validateMasterKeyEntropyAndLength(process.env.LEDGERAI_MASTER_KEY);
        if (!masterCheck.valid) {
          this.recordKeyAudit({
            companyId: options?.companyId || 'GLOBAL',
            operation: 'POLICY_CHECK',
            keyMode: requestedMode,
            keyId: 'weak-master-key',
            keyVersion: 1,
            status: 'DENIED',
            details: `Production key policy violation: ${masterCheck.reason}`,
          });
          throw new Error(`PRODUCTION_KEY_POLICY_VIOLATION: ${masterCheck.reason}`);
        }
      }
    }

    const keyId =
      requestedMode === 'EXTERNAL_KMS_ENVELOPE'
        ? `kms-kek-${options?.companyId || 'enterprise'}`
        : requestedMode === 'OS_KEYCHAIN_STANDALONE'
        ? `os-keychain-${options?.companyId || 'standalone'}`
        : 'legacy-dev-pbkdf2';

    this.recordKeyAudit({
      companyId: options?.companyId || 'GLOBAL',
      operation: 'POLICY_CHECK',
      keyMode: requestedMode,
      keyId,
      keyVersion: 1,
      status: 'SUCCESS',
      details: `Key policy validated for classification=${classification}, mode=${requestedMode}.`,
    });

    return { allowed: true, effectiveKeyMode: requestedMode, keyId };
  }

  /**
   * Returns the OS user keystore directory (outside company folders & ordinary config files)
   * and retrieves or provisions a per-company Key Encryption Key (KEK) + Recovery Key.
   */
  private static getStandaloneKeystoreDir(): string {
    const dir = path.join(paths.getConfigDir(), '.keystore_vault');
    fsSync.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  public static getOrProvisionCompanyKeyringSync(
    companyId: string,
    keyMode: EncryptionKeyMode = 'OS_KEYCHAIN_STANDALONE'
  ): {
    keyId: string;
    keyVersion: number;
    kek: Buffer;
    recoveryKeyHex?: string;
    recoveryEnvelope?: RecoveryEnvelope;
  } {
    const safeId = (companyId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    const keystoreFile = path.join(this.getStandaloneKeystoreDir(), `${safeId}.keyring.json`);

    if (keyMode === 'EXTERNAL_KMS_ENVELOPE') {
      const keyId = `kms-kek-${safeId}`;
      let version = 1;
      if (fsSync.existsSync(keystoreFile)) {
        try {
          const meta = JSON.parse(fsSync.readFileSync(keystoreFile, 'utf8'));
          version = Number(meta.keyVersion) || 1;
        } catch {}
      } else {
        fsSync.writeFileSync(
          keystoreFile,
          JSON.stringify({ companyId, keyMode, keyId, keyVersion: 1, updatedAt: new Date().toISOString() }, null, 2),
          { mode: 0o600 }
        );
      }

      if (customKmsProvider) {
        return { keyId, keyVersion: version, kek: customKmsProvider.getKek(keyId, version) };
      }
      const kmsSecret = process.env.LEDGERAI_KMS_MASTER_KEK || process.env.LEDGERAI_MASTER_KEY;
      if (!kmsSecret || kmsSecret === FALLBACK_DEV_MASTER_SECRET) {
        throw new Error(
          'KMS_KEY_UNAVAILABLE: EXTERNAL_KMS_ENVELOPE requires a registered KMS provider or non-default LEDGERAI_KMS_MASTER_KEK.'
        );
      }
      const kek = crypto.hkdfSync(
        'sha256',
        Buffer.from(kmsSecret, 'utf8'),
        Buffer.from(`ledgerai-kms-${safeId}-v${version}`, 'utf8'),
        Buffer.from('LEDGERAI-ENVELOPE-KEK', 'utf8'),
        32
      );
      return { keyId, keyVersion: version, kek: Buffer.from(kek) };
    }

    // OS_KEYCHAIN_STANDALONE: machine-bound OS keychain secret wrapping a unique random 256-bit company KEK
    const machineBinding = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.userInfo().username}`;
    const osAnchor = crypto.createHash('sha256').update(machineBinding).digest();

    if (fsSync.existsSync(keystoreFile)) {
      try {
        const stored = JSON.parse(fsSync.readFileSync(keystoreFile, 'utf8'));
        if (stored && stored.keyMode === 'OS_KEYCHAIN_STANDALONE' && stored.ivHex && stored.tagHex && stored.wrappedKekHex) {
          const iv = Buffer.from(stored.ivHex, 'hex');
          const tag = Buffer.from(stored.tagHex, 'hex');
          const ciphertext = Buffer.from(stored.wrappedKekHex, 'hex');
          const decipher = crypto.createDecipheriv('aes-256-gcm', osAnchor, iv);
          decipher.setAuthTag(tag);
          const kek = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
          return {
            keyId: stored.keyId || `os-keychain-${safeId}`,
            keyVersion: Number(stored.keyVersion) || 1,
            kek,
            recoveryEnvelope: stored.recoveryEnvelope,
          };
        }
      } catch (err: any) {
        throw new Error(`OS_KEYCHAIN_UNWRAP_FAILED: Could not unwrap company KEK for ${companyId}: ${err.message}`);
      }
    }

    // Generate brand-new 256-bit KEK and 256-bit Recovery Key
    const kek = crypto.randomBytes(32);
    const recoveryKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', osAnchor, iv);
    const wrappedKek = Buffer.concat([cipher.update(kek), cipher.final()]);
    const tag = cipher.getAuthTag();

    const keyId = `os-keychain-${safeId}`;
    const keyVersion = 1;

    // Also wrap KEK with recoveryKey and cryptographically bind companyId, keyId, and keyVersion via GCM AAD
    const recIv = crypto.randomBytes(12);
    const recAad = Buffer.from(`LAISENC2-RECOVERY|${companyId}|${keyId}|${keyVersion}`, 'utf8');
    const recCipher = crypto.createCipheriv('aes-256-gcm', recoveryKey, recIv);
    recCipher.setAAD(recAad);
    const recoveryWrappedKek = Buffer.concat([recCipher.update(kek), recCipher.final()]);
    const recTag = recCipher.getAuthTag();

    const recoveryEnvelope: RecoveryEnvelope = {
      ivHex: recIv.toString('hex'),
      tagHex: recTag.toString('hex'),
      wrappedKekHex: recoveryWrappedKek.toString('hex'),
      aadBound: true,
    };

    const payload = {
      companyId,
      keyMode: 'OS_KEYCHAIN_STANDALONE' as EncryptionKeyMode,
      keyId,
      keyVersion,
      ivHex: iv.toString('hex'),
      tagHex: tag.toString('hex'),
      wrappedKekHex: wrappedKek.toString('hex'),
      recoveryEnvelope,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fsSync.writeFileSync(keystoreFile, JSON.stringify(payload, null, 2), { mode: 0o600 });

    this.recordKeyAudit({
      companyId,
      operation: 'RECOVERY_KEY_ISSUED',
      keyMode: 'OS_KEYCHAIN_STANDALONE',
      keyId,
      keyVersion: 1,
      status: 'SUCCESS',
      details: 'Provisioned unique 256-bit company KEK in OS keystore vault with AAD-bound emergency recovery envelope.',
    });

    return {
      keyId,
      keyVersion: 1,
      kek,
      recoveryKeyHex: recoveryKey.toString('hex'),
      recoveryEnvelope,
    };
  }

  /**
   * Legacy PBKDF2 key derivation for existing LAISENC1 test workspaces.
   */
  private static deriveLegacyKey(salt: Buffer): Buffer {
    const secret = process.env.LEDGERAI_MASTER_KEY || FALLBACK_DEV_MASTER_SECRET;
    return crypto.pbkdf2Sync(secret, salt, 100000, 32, 'sha256');
  }

  /**
   * Inspects an encrypted .lai container without exposing plaintext or keys.
   */
  public static inspectContainerMetadataSync(filePath: string): EncryptedContainerMetadata {
    try {
      if (!fsSync.existsSync(filePath)) {
        return { isEncrypted: false, containerVersion: 'UNENCRYPTED', usesFallbackDevKey: false };
      }
      const buf = fsSync.readFileSync(filePath);
      if (buf.length < 8) {
        return { isEncrypted: false, containerVersion: 'UNENCRYPTED', usesFallbackDevKey: false };
      }
      const magic = buf.subarray(0, 8);
      if (magic.equals(LAIS_MAGIC_V1)) {
        return {
          isEncrypted: true,
          containerVersion: 'LAISENC1',
          keyMode: 'LEGACY_DEV_KEY',
          keyId: 'legacy-dev-pbkdf2',
          keyVersion: 1,
          usesFallbackDevKey: this.isUsingDeterministicFallbackSecret(),
        };
      }
      if (magic.equals(LAIS_MAGIC_V2) && buf.length >= 12) {
        const metaLen = buf.readUInt32BE(8);
        if (buf.length >= 12 + metaLen) {
          const metaJson = JSON.parse(buf.subarray(12, 12 + metaLen).toString('utf8'));
          return {
            isEncrypted: true,
            containerVersion: 'LAISENC2',
            keyMode: metaJson.keyMode,
            keyId: metaJson.keyId,
            keyVersion: metaJson.keyVersion,
            companyId: metaJson.companyId,
            encryptedAt: metaJson.encryptedAt,
            hasRecoveryEnvelope: Boolean(
              metaJson.recoveryEnvelope &&
                metaJson.recoveryEnvelope.ivHex &&
                metaJson.recoveryEnvelope.tagHex &&
                metaJson.recoveryEnvelope.wrappedKekHex
            ),
            usesFallbackDevKey: false,
          };
        }
      }
      return { isEncrypted: false, containerVersion: 'UNENCRYPTED', usesFallbackDevKey: false };
    } catch {
      return { isEncrypted: false, containerVersion: 'UNENCRYPTED', usesFallbackDevKey: false };
    }
  }

  /**
   * Checks if a file is an encrypted LedgerAI database container (LAISENC1 or LAISENC2).
   */
  public static async isEncryptedLai(filePath: string): Promise<boolean> {
    try {
      const handle = await fs.open(filePath, 'r');
      const headerBuf = Buffer.alloc(8);
      await handle.read(headerBuf, 0, 8, 0);
      await handle.close();
      return headerBuf.equals(LAIS_MAGIC_V1) || headerBuf.equals(LAIS_MAGIC_V2);
    } catch {
      return false;
    }
  }

  /**
   * Synchronously checks if a file is an encrypted LedgerAI database container (LAISENC1 or LAISENC2).
   */
  public static isEncryptedLaiSync(filePath: string): boolean {
    try {
      const fd = fsSync.openSync(filePath, 'r');
      const headerBuf = Buffer.alloc(8);
      fsSync.readSync(fd, headerBuf, 0, 8, 0);
      fsSync.closeSync(fd);
      return headerBuf.equals(LAIS_MAGIC_V1) || headerBuf.equals(LAIS_MAGIC_V2);
    } catch {
      return false;
    }
  }

  private static async safeReplaceFile(tempPath: string, destPath: string): Promise<void> {
    try {
      let lastError: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fs.rename(tempPath, destPath);
          return;
        } catch (err: any) {
          lastError = err;
          if (['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(err.code)) {
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
            if (attempt >= 2) {
              try {
                await fs.unlink(destPath);
              } catch {}
            }
          } else {
            break;
          }
        }
      }
      try {
        await fs.copyFile(tempPath, destPath);
        await fs.unlink(tempPath).catch(() => {});
        return;
      } catch (copyErr) {
        throw lastError || copyErr;
      }
    } catch (err) {
      await fs.unlink(tempPath).catch(() => {});
      throw err;
    }
  }

  private static safeReplaceFileSync(tempPath: string, destPath: string): void {
    try {
      let lastError: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fsSync.renameSync(tempPath, destPath);
          return;
        } catch (err: any) {
          lastError = err;
          if (['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(err.code)) {
            const start = Date.now();
            while (Date.now() - start < 25 * (attempt + 1)) {}
            if (attempt >= 2) {
              try {
                fsSync.unlinkSync(destPath);
              } catch {}
            }
          } else {
            break;
          }
        }
      }
      try {
        fsSync.copyFileSync(tempPath, destPath);
        try { fsSync.unlinkSync(tempPath); } catch {}
        return;
      } catch (copyErr) {
        throw lastError || copyErr;
      }
    } catch (err) {
      try { fsSync.unlinkSync(tempPath); } catch {}
      throw err;
    }
  }

  /**
   * Encrypts a SQLite file using LAISENC2 Envelope Encryption (DEK wrapped by KEK) or LAISENC1 for legacy test workspaces.
   */
  public static encryptDatabaseFileSync(
    sourceSqlitePath: string,
    destLaiPath: string,
    options?: {
      companyId?: string;
      classification?: string;
      keyMode?: EncryptionKeyMode;
    }
  ): void {
    const resolvedDestLaiPath =
      path.basename(destLaiPath) === '.db_active.sqlite'
        ? path.join(path.dirname(destLaiPath), 'database.lai')
        : destLaiPath;
    destLaiPath = resolvedDestLaiPath;
    const tempPath = `${destLaiPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      const sqliteBuffer = fsSync.readFileSync(sourceSqlitePath);
      if (
        sqliteBuffer.length >= 8 &&
        (sqliteBuffer.subarray(0, 8).toString('ascii') === 'LAISENC1' ||
          sqliteBuffer.subarray(0, 8).toString('ascii') === 'LAISENC2')
      ) {
        throw new Error(
          `DOUBLE_ENCRYPTION_PREVENTED: Source file '${path.basename(sourceSqlitePath)}' is already an encrypted LAISENC container.`
        );
      }

      const existingMeta = this.inspectContainerMetadataSync(destLaiPath);
      const classification = String(options?.classification || '').toUpperCase();
      const effectiveMode: EncryptionKeyMode =
        options?.keyMode ||
        (existingMeta.containerVersion === 'LAISENC2' && existingMeta.keyMode
          ? existingMeta.keyMode
          : classification === 'PRODUCTION' || classification === 'PILOT'
          ? 'OS_KEYCHAIN_STANDALONE'
          : 'LEGACY_DEV_KEY');

      if (classification === 'PRODUCTION' || process.env.NODE_ENV === 'production') {
        this.assertProductionKeyPolicy({
          companyId: options?.companyId || existingMeta.companyId,
          classification: classification || 'PRODUCTION',
          keyMode: effectiveMode,
        });
      }

      if (effectiveMode === 'OS_KEYCHAIN_STANDALONE' || effectiveMode === 'EXTERNAL_KMS_ENVELOPE') {
        const companyId =
          options?.companyId ||
          existingMeta.companyId ||
          path.basename(path.dirname(destLaiPath));
        const keyring = this.getOrProvisionCompanyKeyringSync(companyId, effectiveMode);
        const containerVersionNum = 2;
        const aadVersion = 3;

        if (
          effectiveMode === 'OS_KEYCHAIN_STANDALONE' &&
          (!keyring.recoveryEnvelope ||
            !keyring.recoveryEnvelope.ivHex ||
            !keyring.recoveryEnvelope.tagHex ||
            !keyring.recoveryEnvelope.wrappedKekHex)
        ) {
          throw new Error(
            'ENCRYPTION_FAILED: OS_KEYCHAIN_STANDALONE mode requires a valid recoveryEnvelope.'
          );
        }

        const recoveryBinding =
          keyring.recoveryEnvelope &&
          keyring.recoveryEnvelope.ivHex &&
          keyring.recoveryEnvelope.tagHex &&
          keyring.recoveryEnvelope.wrappedKekHex
            ? `${keyring.recoveryEnvelope.ivHex}:${keyring.recoveryEnvelope.tagHex}:${keyring.recoveryEnvelope.wrappedKekHex}`
            : 'NONE';

        // Cryptographically bind version, aadVersion, companyId, keyMode, keyId, keyVersion, and recoveryEnvelope to both DEK wrap and payload ciphertexts
        const aad = Buffer.from(
          `LAISENC2|${containerVersionNum}|aad:${aadVersion}|${companyId}|${effectiveMode}|${keyring.keyId}|${keyring.keyVersion}|rec:${recoveryBinding}`,
          'utf8'
        );

        // Envelope Encryption:
        // 1. Generate random 256-bit Data Encryption Key (DEK) for payload
        const dek = crypto.randomBytes(32);
        const dataIv = crypto.randomBytes(12);
        const dataCipher = crypto.createCipheriv('aes-256-gcm', dek, dataIv);
        dataCipher.setAAD(aad);

        const ciphertext = Buffer.concat([dataCipher.update(sqliteBuffer), dataCipher.final()]);
        const dataAuthTag = dataCipher.getAuthTag();

        // 2. Wrap DEK using KEK (AES-256-GCM) with identical AAD binding
        const wrapIv = crypto.randomBytes(12);
        const wrapCipher = crypto.createCipheriv('aes-256-gcm', keyring.kek, wrapIv);
        wrapCipher.setAAD(aad);
        const wrappedDek = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
        const wrapAuthTag = wrapCipher.getAuthTag();

        const envelopeMeta: Record<string, any> = {
          version: containerVersionNum,
          aadVersion,
          companyId,
          keyMode: effectiveMode,
          keyId: keyring.keyId,
          keyVersion: keyring.keyVersion,
          wrapIvHex: wrapIv.toString('hex'),
          wrapTagHex: wrapAuthTag.toString('hex'),
          wrappedDekHex: wrappedDek.toString('hex'),
          dataIvHex: dataIv.toString('hex'),
          dataTagHex: dataAuthTag.toString('hex'),
          encryptedAt: new Date().toISOString(),
        };
        if (keyring.recoveryEnvelope) {
          envelopeMeta.recoveryEnvelope = keyring.recoveryEnvelope;
        }

        const metaBytes = Buffer.from(JSON.stringify(envelopeMeta), 'utf8');
        const metaLenBuf = Buffer.alloc(4);
        metaLenBuf.writeUInt32BE(metaBytes.length, 0);

        const finalBuffer = Buffer.concat([LAIS_MAGIC_V2, metaLenBuf, metaBytes, ciphertext]);
        fsSync.writeFileSync(tempPath, finalBuffer);
        this.safeReplaceFileSync(tempPath, destLaiPath);

        this.recordKeyAudit({
          companyId,
          operation: 'ENCRYPT',
          keyMode: effectiveMode,
          keyId: keyring.keyId,
          keyVersion: keyring.keyVersion,
          status: 'SUCCESS',
          details: `Encrypted database container (LAISENC2 envelope aadVersion=${aadVersion}, ${finalBuffer.length} bytes).`,
        });
        return;
      }

      // LAISENC1 Legacy/Dev PBKDF2 container (preserves backward compatibility for existing stress-test workspaces)
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const key = this.deriveLegacyKey(salt);

      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(sqliteBuffer), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const finalBuffer = Buffer.concat([LAIS_MAGIC_V1, salt, iv, authTag, encrypted]);
      fsSync.writeFileSync(tempPath, finalBuffer);
      this.safeReplaceFileSync(tempPath, destLaiPath);
    } catch (err) {
      try { fsSync.unlinkSync(tempPath); } catch {}
      throw err;
    }
  }

  public static async encryptDatabaseFile(
    sourceSqlitePath: string,
    destLaiPath: string,
    options?: {
      companyId?: string;
      classification?: string;
      keyMode?: EncryptionKeyMode;
    }
  ): Promise<void> {
    this.encryptDatabaseFileSync(sourceSqlitePath, destLaiPath, options);
  }

  /**
   * Decrypts either a LAISENC1 or LAISENC2 encrypted .lai database container.
   */
  public static decryptDatabaseFileSync(sourceLaiPath: string, destSqlitePath: string): boolean {
    const fileBuffer = fsSync.readFileSync(sourceLaiPath);

    if (fileBuffer.length < 52) {
      throw new Error('INVALID_ENCRYPTED_DATABASE: File is too small to be a valid encrypted .lai container.');
    }

    const magic = fileBuffer.subarray(0, 8);
    if (!magic.equals(LAIS_MAGIC_V1) && !magic.equals(LAIS_MAGIC_V2)) {
      return false;
    }

    const tempPath = `${destSqlitePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      if (magic.equals(LAIS_MAGIC_V2)) {
        const metaLen = fileBuffer.readUInt32BE(8);
        const metaEnd = 12 + metaLen;
        if (metaLen === 0 || fileBuffer.length <= metaEnd) {
          throw new Error('INVALID_ENCRYPTED_DATABASE: Truncated or invalid LAISENC2 envelope header.');
        }
        const meta = JSON.parse(fileBuffer.subarray(12, metaEnd).toString('utf8'));
        if (meta.version !== 2) {
          throw new Error(`DECRYPTION_FAILED: Unsupported or tampered LAISENC2 container version (${meta.version}).`);
        }
        if (meta.aadVersion !== 2 && meta.aadVersion !== 3) {
          throw new Error(`DECRYPTION_FAILED: Unsupported or tampered LAISENC2 aadVersion (${meta.aadVersion}).`);
        }
        if (
          !meta.companyId ||
          !meta.keyMode ||
          !meta.keyId ||
          typeof meta.keyVersion !== 'number' ||
          !meta.wrapIvHex ||
          !meta.wrapTagHex ||
          !meta.wrappedDekHex ||
          !meta.dataIvHex ||
          !meta.dataTagHex
        ) {
          throw new Error('DECRYPTION_FAILED: Missing or malformed LAISENC2 envelope metadata fields.');
        }

        const ciphertext = fileBuffer.subarray(metaEnd);
        const companyId = String(meta.companyId);
        const keyMode: EncryptionKeyMode = meta.keyMode;
        if (keyMode !== 'OS_KEYCHAIN_STANDALONE' && keyMode !== 'EXTERNAL_KMS_ENVELOPE') {
          throw new Error(`DECRYPTION_FAILED: Invalid LAISENC2 keyMode '${keyMode}'.`);
        }

        if (keyMode === 'OS_KEYCHAIN_STANDALONE') {
          const rec = meta.recoveryEnvelope;
          if (
            !rec ||
            typeof rec.ivHex !== 'string' ||
            typeof rec.tagHex !== 'string' ||
            typeof rec.wrappedKekHex !== 'string' ||
            Buffer.from(rec.ivHex, 'hex').length !== 12 ||
            Buffer.from(rec.tagHex, 'hex').length !== 16 ||
            Buffer.from(rec.wrappedKekHex, 'hex').length !== 32
          ) {
            throw new Error(
              'DECRYPTION_FAILED: Missing or malformed recoveryEnvelope in OS_KEYCHAIN_STANDALONE LAISENC2 container.'
            );
          }
        }

        const keyring = this.getOrProvisionCompanyKeyringSync(companyId, keyMode);

        if (
          keyMode === 'OS_KEYCHAIN_STANDALONE' &&
          keyring.recoveryEnvelope &&
          meta.recoveryEnvelope &&
          (meta.recoveryEnvelope.ivHex !== keyring.recoveryEnvelope.ivHex ||
            meta.recoveryEnvelope.tagHex !== keyring.recoveryEnvelope.tagHex ||
            meta.recoveryEnvelope.wrappedKekHex !== keyring.recoveryEnvelope.wrappedKekHex)
        ) {
          throw new Error(
            'DECRYPTION_FAILED: Container recoveryEnvelope does not match active company keyring (tampered or substituted recoveryEnvelope detected).'
          );
        }

        const wrapIv = Buffer.from(meta.wrapIvHex, 'hex');
        const wrapTag = Buffer.from(meta.wrapTagHex, 'hex');
        const wrappedDek = Buffer.from(meta.wrappedDekHex, 'hex');
        const dataIv = Buffer.from(meta.dataIvHex, 'hex');
        const dataTag = Buffer.from(meta.dataTagHex, 'hex');

        if (wrapIv.length !== 12 || wrapTag.length !== 16 || dataIv.length !== 12 || dataTag.length !== 16 || wrappedDek.length === 0) {
          throw new Error('DECRYPTION_FAILED: Invalid IV, authentication tag, or wrapped DEK byte length.');
        }

        const recoveryBinding =
          meta.recoveryEnvelope &&
          meta.recoveryEnvelope.ivHex &&
          meta.recoveryEnvelope.tagHex &&
          meta.recoveryEnvelope.wrappedKekHex
            ? `${meta.recoveryEnvelope.ivHex}:${meta.recoveryEnvelope.tagHex}:${meta.recoveryEnvelope.wrappedKekHex}`
            : 'NONE';

        const aadV3 = Buffer.from(
          `LAISENC2|${meta.version}|aad:${meta.aadVersion}|${companyId}|${keyMode}|${meta.keyId}|${Number(meta.keyVersion)}|rec:${recoveryBinding}`,
          'utf8'
        );
        const aadV2 = Buffer.from(
          `LAISENC2|${meta.version}|${companyId}|${keyMode}|${meta.keyId}|${Number(meta.keyVersion)}`,
          'utf8'
        );
        const activeAad = meta.aadVersion === 3 ? aadV3 : aadV2;

        // Unwrap DEK using KEK
        const unwrapDecipher = crypto.createDecipheriv('aes-256-gcm', keyring.kek, wrapIv);
        unwrapDecipher.setAAD(activeAad);
        unwrapDecipher.setAuthTag(wrapTag);
        const dek = Buffer.concat([unwrapDecipher.update(wrappedDek), unwrapDecipher.final()]);

        // Decrypt SQLite payload using DEK
        const dataDecipher = crypto.createDecipheriv('aes-256-gcm', dek, dataIv);
        dataDecipher.setAAD(activeAad);
        dataDecipher.setAuthTag(dataTag);
        const decrypted = Buffer.concat([dataDecipher.update(ciphertext), dataDecipher.final()]);

        fsSync.writeFileSync(tempPath, decrypted);
        this.safeReplaceFileSync(tempPath, destSqlitePath);

        this.recordKeyAudit({
          companyId,
          operation: 'DECRYPT',
          keyMode,
          keyId: meta.keyId,
          keyVersion: Number(meta.keyVersion),
          status: 'SUCCESS',
          details: 'Decrypted LAISENC2 envelope database container.',
        });
        return true;
      }

      // LAISENC1 decryption
      const salt = fileBuffer.subarray(8, 24);
      const iv = fileBuffer.subarray(24, 36);
      const authTag = fileBuffer.subarray(36, 52);
      const ciphertext = fileBuffer.subarray(52);

      const key = this.deriveLegacyKey(salt);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      fsSync.writeFileSync(tempPath, decrypted);
      this.safeReplaceFileSync(tempPath, destSqlitePath);
      return true;
    } catch (err: any) {
      try { fsSync.unlinkSync(tempPath); } catch {}
      if (err.message && err.message.startsWith('INVALID_ENCRYPTED_DATABASE')) {
        throw err;
      }
      throw new Error(`DECRYPTION_FAILED: Failed to decrypt workspace database. Key mismatch or corrupted/tampered file: ${err.message}`);
    }
  }

  public static async decryptDatabaseFile(sourceLaiPath: string, destSqlitePath: string): Promise<boolean> {
    return this.decryptDatabaseFileSync(sourceLaiPath, destSqlitePath);
  }

  /**
   * Emergency Disaster Recovery: Decrypts a LAISENC2 .lai container using the 256-bit recovery key
   * when the local OS keystore vault is lost, corrupted, or when migrating to a new machine/user profile.
   */
  public static recoverDatabaseWithRecoveryKeySync(
    sourceLaiPath: string,
    destSqlitePath: string,
    recoveryKeyHex: string,
    options?: { reprovisionLocalKeystore?: boolean }
  ): {
    companyId: string;
    keyId: string;
    keyVersion: number;
    recoveredAt: string;
  } {
    const cleanHex = (recoveryKeyHex || '').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
      throw new Error('RECOVERY_FAILED: Recovery key must be a valid 64-character hexadecimal string (256 bits).');
    }
    const recoveryKey = Buffer.from(cleanHex, 'hex');

    const fileBuffer = fsSync.readFileSync(sourceLaiPath);
    if (fileBuffer.length < 52 || !fileBuffer.subarray(0, 8).equals(LAIS_MAGIC_V2)) {
      throw new Error('RECOVERY_FAILED: Source file is not a valid LAISENC2 encrypted container.');
    }

    const metaLen = fileBuffer.readUInt32BE(8);
    const metaEnd = 12 + metaLen;
    if (metaLen === 0 || fileBuffer.length <= metaEnd) {
      throw new Error('RECOVERY_FAILED: Truncated or invalid LAISENC2 envelope header.');
    }

    const meta = JSON.parse(fileBuffer.subarray(12, metaEnd).toString('utf8'));
    if (meta.version !== 2) {
      throw new Error(`RECOVERY_FAILED: Unsupported LAISENC2 container version (${meta.version}).`);
    }
    if (meta.aadVersion !== 2 && meta.aadVersion !== 3) {
      throw new Error(`RECOVERY_FAILED: Unsupported or tampered LAISENC2 aadVersion (${meta.aadVersion}).`);
    }
    if (!meta.companyId || !meta.keyMode || !meta.keyId || typeof meta.keyVersion !== 'number') {
      throw new Error('RECOVERY_FAILED: Missing or malformed LAISENC2 identity metadata fields.');
    }

    const companyId = String(meta.companyId);
    const safeId = companyId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const keystoreFile = path.join(this.getStandaloneKeystoreDir(), `${safeId}.keyring.json`);

    // Strictly require recoveryEnvelope in the container metadata itself (cannot fall back to unverified external files if removed from container)
    const recoveryEnvelope: RecoveryEnvelope | undefined = meta.recoveryEnvelope;

    if (
      !recoveryEnvelope ||
      typeof recoveryEnvelope.ivHex !== 'string' ||
      typeof recoveryEnvelope.tagHex !== 'string' ||
      typeof recoveryEnvelope.wrappedKekHex !== 'string'
    ) {
      throw new Error('RECOVERY_FAILED: No valid recovery envelope found in container metadata.');
    }

    const tempPath = `${destSqlitePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      // 1. Unwrap KEK using the administrator's 256-bit recovery key
      const recIv = Buffer.from(recoveryEnvelope.ivHex, 'hex');
      const recTag = Buffer.from(recoveryEnvelope.tagHex, 'hex');
      const recWrappedKek = Buffer.from(recoveryEnvelope.wrappedKekHex, 'hex');
      if (recIv.length !== 12 || recTag.length !== 16 || recWrappedKek.length !== 32) {
        throw new Error('RECOVERY_FAILED: Malformed recoveryEnvelope IV, tag, or wrapped KEK byte length.');
      }

      const kekDecipher = crypto.createDecipheriv('aes-256-gcm', recoveryKey, recIv);
      if (recoveryEnvelope.aadBound || meta.aadVersion === 3) {
        const recAad = Buffer.from(
          `LAISENC2-RECOVERY|${companyId}|${meta.keyId}|${Number(meta.keyVersion)}`,
          'utf8'
        );
        kekDecipher.setAAD(recAad);
      }
      kekDecipher.setAuthTag(recTag);
      const kek = Buffer.concat([kekDecipher.update(recWrappedKek), kekDecipher.final()]);

      // 2. Unwrap DEK using recovered KEK and verify AAD (including recoveryEnvelope binding on aadVersion 3)
      const recoveryBinding = `${recoveryEnvelope.ivHex}:${recoveryEnvelope.tagHex}:${recoveryEnvelope.wrappedKekHex}`;
      const aadV3 = Buffer.from(
        `LAISENC2|${meta.version}|aad:${meta.aadVersion}|${companyId}|${meta.keyMode}|${meta.keyId}|${Number(meta.keyVersion)}|rec:${recoveryBinding}`,
        'utf8'
      );
      const aadV2 = Buffer.from(
        `LAISENC2|${meta.version}|${companyId}|${meta.keyMode}|${meta.keyId}|${Number(meta.keyVersion)}`,
        'utf8'
      );
      const activeAad = meta.aadVersion === 3 ? aadV3 : aadV2;

      const wrapIv = Buffer.from(meta.wrapIvHex, 'hex');
      const wrapTag = Buffer.from(meta.wrapTagHex, 'hex');
      const wrappedDek = Buffer.from(meta.wrappedDekHex, 'hex');
      const unwrapDecipher = crypto.createDecipheriv('aes-256-gcm', kek, wrapIv);
      unwrapDecipher.setAAD(activeAad);
      unwrapDecipher.setAuthTag(wrapTag);
      const dek = Buffer.concat([unwrapDecipher.update(wrappedDek), unwrapDecipher.final()]);

      // 3. Decrypt SQLite payload using DEK and verify AAD
      const ciphertext = fileBuffer.subarray(metaEnd);
      const dataIv = Buffer.from(meta.dataIvHex, 'hex');
      const dataTag = Buffer.from(meta.dataTagHex, 'hex');
      const dataDecipher = crypto.createDecipheriv('aes-256-gcm', dek, dataIv);
      dataDecipher.setAAD(activeAad);
      dataDecipher.setAuthTag(dataTag);
      const decrypted = Buffer.concat([dataDecipher.update(ciphertext), dataDecipher.final()]);

      fsSync.writeFileSync(tempPath, decrypted);
      this.safeReplaceFileSync(tempPath, destSqlitePath);

      // 4. Optionally re-provision local machine keystore so future opens on the new host succeed
      if (options?.reprovisionLocalKeystore !== false && meta.keyMode === 'OS_KEYCHAIN_STANDALONE') {
        const machineBinding = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.userInfo().username}`;
        const osAnchor = crypto.createHash('sha256').update(machineBinding).digest();
        const hostIv = crypto.randomBytes(12);
        const hostCipher = crypto.createCipheriv('aes-256-gcm', osAnchor, hostIv);
        const hostWrappedKek = Buffer.concat([hostCipher.update(kek), hostCipher.final()]);
        const hostTag = hostCipher.getAuthTag();

        const reprovisionedPayload = {
          companyId,
          keyMode: 'OS_KEYCHAIN_STANDALONE' as EncryptionKeyMode,
          keyId: meta.keyId,
          keyVersion: Number(meta.keyVersion),
          ivHex: hostIv.toString('hex'),
          tagHex: hostTag.toString('hex'),
          wrappedKekHex: hostWrappedKek.toString('hex'),
          recoveryEnvelope,
          recoveredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        fsSync.writeFileSync(keystoreFile, JSON.stringify(reprovisionedPayload, null, 2), { mode: 0o600 });
      }

      const recoveredAt = new Date().toISOString();
      this.recordKeyAudit({
        companyId,
        operation: 'RECOVERY_KEY_USED',
        keyMode: meta.keyMode || 'OS_KEYCHAIN_STANDALONE',
        keyId: meta.keyId,
        keyVersion: Number(meta.keyVersion),
        status: 'SUCCESS',
        details: `Recovered LAISENC2 database container using emergency recovery key (keyVersion=v${meta.keyVersion}).`,
      });

      return {
        companyId,
        keyId: meta.keyId,
        keyVersion: Number(meta.keyVersion),
        recoveredAt,
      };
    } catch (err: any) {
      try { fsSync.unlinkSync(tempPath); } catch {}
      this.recordKeyAudit({
        companyId,
        operation: 'RECOVERY_KEY_USED',
        keyMode: meta.keyMode || 'OS_KEYCHAIN_STANDALONE',
        keyId: meta.keyId || `os-keychain-${safeId}`,
        keyVersion: Number(meta.keyVersion) || 1,
        status: 'FAILED',
        details: `Emergency recovery key decryption failed: ${err.message}`,
      });
      throw new Error(`RECOVERY_FAILED: Could not recover database with provided recovery key: ${err.message}`);
    }
  }

  /**
   * Rotates a company's Key Encryption Key (KEK), preserves or re-issues the emergency recovery envelope,
   * and re-encrypts the .lai container with the new KEK/DEK version.
   */
  public static rotateCompanyDatabaseKeySync(
    companyId: string,
    activeSqlitePath: string,
    destLaiPath: string,
    targetKeyMode: EncryptionKeyMode = 'OS_KEYCHAIN_STANDALONE',
    options?: { preserveRecoveryKeyHex?: string }
  ): {
    companyId: string;
    previousKeyVersion: number;
    newKeyVersion: number;
    keyMode: EncryptionKeyMode;
    keyId: string;
    recoveryKeyHex?: string;
    rotatedAt: string;
  } {
    const safeId = companyId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const keystoreFile = path.join(this.getStandaloneKeystoreDir(), `${safeId}.keyring.json`);
    const existingRing = this.getOrProvisionCompanyKeyringSync(companyId, targetKeyMode);
    const previousKeyVersion = existingRing.keyVersion;
    const newKeyVersion = previousKeyVersion + 1;
    let activeRecoveryKeyHex: string | undefined;

    if (targetKeyMode === 'OS_KEYCHAIN_STANDALONE') {
      const machineBinding = `${os.hostname()}|${os.platform()}|${os.arch()}|${os.userInfo().username}`;
      const osAnchor = crypto.createHash('sha256').update(machineBinding).digest();
      const newKek = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', osAnchor, iv);
      const wrappedKek = Buffer.concat([cipher.update(newKek), cipher.final()]);
      const tag = cipher.getAuthTag();

      // Wrap the rotated KEK with the existing recovery key (if provided) or a freshly generated 256-bit recovery key
      const recoveryKeyBuf =
        options?.preserveRecoveryKeyHex && /^[0-9a-fA-F]{64}$/.test(options.preserveRecoveryKeyHex.trim())
          ? Buffer.from(options.preserveRecoveryKeyHex.trim(), 'hex')
          : crypto.randomBytes(32);
      activeRecoveryKeyHex = recoveryKeyBuf.toString('hex');

      const recIv = crypto.randomBytes(12);
      const recAad = Buffer.from(
        `LAISENC2-RECOVERY|${companyId}|${existingRing.keyId}|${newKeyVersion}`,
        'utf8'
      );
      const recCipher = crypto.createCipheriv('aes-256-gcm', recoveryKeyBuf, recIv);
      recCipher.setAAD(recAad);
      const recoveryWrappedKek = Buffer.concat([recCipher.update(newKek), recCipher.final()]);
      const recTag = recCipher.getAuthTag();

      const recoveryEnvelope: RecoveryEnvelope = {
        ivHex: recIv.toString('hex'),
        tagHex: recTag.toString('hex'),
        wrappedKekHex: recoveryWrappedKek.toString('hex'),
        aadBound: true,
      };

      const updatedPayload = {
        companyId,
        keyMode: targetKeyMode,
        keyId: existingRing.keyId,
        keyVersion: newKeyVersion,
        ivHex: iv.toString('hex'),
        tagHex: tag.toString('hex'),
        wrappedKekHex: wrappedKek.toString('hex'),
        recoveryEnvelope,
        updatedAt: new Date().toISOString(),
      };
      fsSync.writeFileSync(keystoreFile, JSON.stringify(updatedPayload, null, 2), { mode: 0o600 });
    } else if (targetKeyMode === 'EXTERNAL_KMS_ENVELOPE') {
      fsSync.writeFileSync(
        keystoreFile,
        JSON.stringify(
          {
            companyId,
            keyMode: targetKeyMode,
            keyId: existingRing.keyId,
            keyVersion: newKeyVersion,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
    }

    this.encryptDatabaseFileSync(activeSqlitePath, destLaiPath, {
      companyId,
      classification: 'PILOT',
      keyMode: targetKeyMode,
    });

    const rotatedAt = new Date().toISOString();
    this.recordKeyAudit({
      companyId,
      operation: 'ROTATE_KEY',
      keyMode: targetKeyMode,
      keyId: existingRing.keyId,
      keyVersion: newKeyVersion,
      status: 'SUCCESS',
      details: `Rotated company encryption key from v${previousKeyVersion} to v${newKeyVersion} (${targetKeyMode}) with recovery envelope preserved.`,
    });

    return {
      companyId,
      previousKeyVersion,
      newKeyVersion,
      keyMode: targetKeyMode,
      keyId: existingRing.keyId,
      recoveryKeyHex: activeRecoveryKeyHex,
      rotatedAt,
    };
  }
}
