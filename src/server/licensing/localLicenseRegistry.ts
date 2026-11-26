import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { paths } from '../services/paths';
import { validateLicenseFilePair } from './verify';

export type RegistryLifecycleStatus =
  | 'REDEEMED'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'REVOKED'
  | 'SUSPENDED'
  | 'RECOVERED'
  | 'RECOVERY_REQUIRED';

export interface RecoveryAuditEntry {
  previousActivationRecordId: string;
  previousLicensePairId: string;
  newLicensePairId: string;
  reason: string;
  authorizedBy: string;
  recoveryRef: string;
  timestamp: string;
}

export interface TrustedRedeemedPairRecord {
  licensePairId: string;
  licenseId: string;
  keyFileId: string;
  companyId: string;
  activationRecordId: string;
  activationKey: string;
  planType: string;
  status: RegistryLifecycleStatus;
  redeemedAt: string;
  activatedBy: string;
  expirationDate: string | null;
  isLifetime: boolean;
  revocationRef: string;
  signedActivationReceipt: string;
  recoveryHistory?: RecoveryAuditEntry[];
  updatedAt: string;
}

interface RegistryDiskEnvelope {
  version: number;
  updatedAt: string;
  records: TrustedRedeemedPairRecord[];
  registryDigest: string;
}

const REGISTRY_HMAC_SECRET =
  process.env.LEDGERAI_LICENSE_REGISTRY_SECRET || 'ledgerai-ph-trusted-license-registry-v2-hmac-key';

function computeHmac(data: string): string {
  return crypto.createHmac('sha256', REGISTRY_HMAC_SECRET).update(data, 'utf8').digest('hex');
}

function computeReceiptDigest(receiptData: any): string {
  const canonical = JSON.stringify({
    receiptVersion: receiptData.receiptVersion,
    activationRecordId: receiptData.activationRecordId,
    licensePairId: receiptData.licensePairId,
    licenseId: receiptData.licenseId,
    keyFileId: receiptData.keyFileId,
    companyId: receiptData.companyId,
    planType: receiptData.planType,
    activatedAt: receiptData.activatedAt,
    activatedBy: receiptData.activatedBy,
  });
  return computeHmac(canonical);
}

export class LocalLicenseRegistry {
  public static createSignedActivationReceipt(params: {
    activationRecordId: string;
    licensePairId: string;
    licenseId: string;
    keyFileId: string;
    companyId: string;
    planType: string;
    activatedAt: string;
    activatedBy: string;
  }): string {
    const receiptData = {
      receiptVersion: '2.0',
      activationRecordId: params.activationRecordId,
      licensePairId: params.licensePairId,
      licenseId: params.licenseId,
      keyFileId: params.keyFileId,
      companyId: params.companyId,
      planType: params.planType,
      activatedAt: params.activatedAt,
      activatedBy: params.activatedBy,
      issuedPolicy: 'ONE_TIME_COMPANY_BOUND',
    };
    const hmacSignature = computeReceiptDigest(receiptData);
    return JSON.stringify({ receiptData, hmacSignature });
  }

  public static verifyActivationReceipt(
    receiptStr: string | null | undefined,
    expected: {
      companyId: string;
      licensePairId?: string | null;
      activationRecordId?: string | null;
      keyFileId?: string | null;
    }
  ): { valid: boolean; code: 'OK' | 'MISSING_ACTIVATION_METADATA' | 'CORRUPTED_ACTIVATION_METADATA'; error?: string; receiptData?: any } {
    if (!receiptStr || typeof receiptStr !== 'string' || receiptStr.trim().length === 0) {
      return {
        valid: false,
        code: 'MISSING_ACTIVATION_METADATA',
        error: 'Activation receipt metadata is missing from company database.',
      };
    }

    try {
      const parsed = JSON.parse(receiptStr);
      const { receiptData, hmacSignature } = parsed || {};
      if (!receiptData || !hmacSignature || typeof hmacSignature !== 'string') {
        return {
          valid: false,
          code: 'CORRUPTED_ACTIVATION_METADATA',
          error: 'Activation receipt metadata is malformed or missing HMAC signature.',
        };
      }

      const expectedSig = computeReceiptDigest(receiptData);
      const actualBuf = Buffer.from(hmacSignature, 'utf8');
      const expectedBuf = Buffer.from(expectedSig, 'utf8');
      if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
        return {
          valid: false,
          code: 'CORRUPTED_ACTIVATION_METADATA',
          error: 'Activation receipt HMAC verification failed (corrupted or tampered metadata).',
        };
      }

      if (receiptData.companyId !== expected.companyId) {
        return {
          valid: false,
          code: 'CORRUPTED_ACTIVATION_METADATA',
          error: `Activation receipt Company ID (${receiptData.companyId}) does not match expected Company ID (${expected.companyId}).`,
        };
      }

      if (expected.licensePairId && receiptData.licensePairId !== expected.licensePairId) {
        return {
          valid: false,
          code: 'CORRUPTED_ACTIVATION_METADATA',
          error: 'Activation receipt License Pair ID does not match license record.',
        };
      }

      if (expected.activationRecordId && receiptData.activationRecordId !== expected.activationRecordId) {
        return {
          valid: false,
          code: 'CORRUPTED_ACTIVATION_METADATA',
          error: 'Activation receipt Activation Record ID does not match license record.',
        };
      }

      if (expected.keyFileId && receiptData.keyFileId !== expected.keyFileId) {
        return {
          valid: false,
          code: 'CORRUPTED_ACTIVATION_METADATA',
          error: 'Activation receipt Key File ID does not match license record.',
        };
      }

      return { valid: true, code: 'OK', receiptData };
    } catch (e: any) {
      return {
        valid: false,
        code: 'CORRUPTED_ACTIVATION_METADATA',
        error: `Failed to parse activation receipt metadata: ${e?.message || 'Invalid JSON'}`,
      };
    }
  }

  private static readRegistrySafe(): { valid: boolean; records: TrustedRedeemedPairRecord[]; error?: string } {
    const filePath = paths.getLocalLicenseRegistryFilePath();
    if (!fs.existsSync(filePath)) {
      return { valid: true, records: [] };
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const envelope: RegistryDiskEnvelope = JSON.parse(raw);
      if (!envelope || !Array.isArray(envelope.records) || typeof envelope.registryDigest !== 'string') {
        return { valid: false, records: [], error: 'Trusted local license registry file structure is invalid.' };
      }

      const expectedDigest = computeHmac(JSON.stringify(envelope.records));
      const actualBuf = Buffer.from(envelope.registryDigest, 'utf8');
      const expectedBuf = Buffer.from(expectedDigest, 'utf8');
      if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
        return { valid: false, records: [], error: 'Trusted local license registry integrity check failed (tampering detected).' };
      }

      return { valid: true, records: envelope.records };
    } catch (e: any) {
      return { valid: false, records: [], error: `Corrupted trusted local license registry: ${e?.message || 'Parse error'}` };
    }
  }

  private static writeRegistryAtomic(records: TrustedRedeemedPairRecord[]): void {
    const filePath = paths.getLocalLicenseRegistryFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const envelope: RegistryDiskEnvelope = {
      version: 2,
      updatedAt: new Date().toISOString(),
      records,
      registryDigest: computeHmac(JSON.stringify(records)),
    };
    const tmpPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  }

  public static getAllRecords(): { valid: boolean; records: TrustedRedeemedPairRecord[]; error?: string } {
    return this.readRegistrySafe();
  }

  public static getRecordByPairId(licensePairId: string): { valid: boolean; record?: TrustedRedeemedPairRecord; error?: string } {
    const reg = this.readRegistrySafe();
    if (!reg.valid) return { valid: false, error: reg.error };
    const found = reg.records.find((r) => r.licensePairId === licensePairId);
    return { valid: true, record: found };
  }

  public static getActiveRecordForCompany(companyId: string): { valid: boolean; record?: TrustedRedeemedPairRecord; error?: string } {
    const reg = this.readRegistrySafe();
    if (!reg.valid) return { valid: false, error: reg.error };
    const found = reg.records.find(
      (r) => r.companyId === companyId && (r.status === 'ACTIVE' || r.status === 'REDEEMED' || r.status === 'REVOKED' || r.status === 'SUSPENDED')
    );
    return { valid: true, record: found };
  }

  /**
   * Executes one-time transaction-safe redemption of a dual-file license pair.
   */
  public static redeemPairForCompany(params: {
    companyId: string;
    licensePairId: string;
    licenseId: string;
    keyFileId: string;
    activationKey: string;
    planType: string;
    expirationDate: string | null;
    isLifetime: boolean;
    revocationRef: string;
    activatedBy: string;
    existingDbLicense?: {
      licensePairId?: string | null;
      activationRecordId?: string | null;
      activationReceipt?: string | null;
      status?: string | null;
      planType?: string | null;
    } | null;
    authorizedRecovery?: {
      recoveryReference: string;
      reason: string;
      authorizedBy: string;
    } | null;
  }): {
    allowed: boolean;
    idempotent?: boolean;
    code:
      | 'REDEEMED'
      | 'IDEMPOTENT_ALREADY_ACTIVE'
      | 'LICENSE_ALREADY_REDEEMED'
      | 'UNAUTHORIZED_LICENSE_REPLACEMENT'
      | 'LICENSE_REVOKED'
      | 'LICENSE_SUSPENDED'
      | 'REGISTRY_MISMATCH';
    error?: string;
    record?: TrustedRedeemedPairRecord;
  } {
    const reg = this.readRegistrySafe();
    if (!reg.valid) {
      return { allowed: false, code: 'REGISTRY_MISMATCH', error: reg.error };
    }

    const records = [...reg.records];
    const existingPairEntry = records.find(
      (r) => r.licensePairId === params.licensePairId || r.keyFileId === params.keyFileId
    );

    if (existingPairEntry) {
      if (existingPairEntry.status === 'REVOKED') {
        return {
          allowed: false,
          code: 'LICENSE_REVOKED',
          error: 'This license pair has been permanently revoked and cannot be activated.',
        };
      }
      if (existingPairEntry.status === 'SUSPENDED') {
        return {
          allowed: false,
          code: 'LICENSE_SUSPENDED',
          error: 'This license pair is currently suspended.',
        };
      }
      if (existingPairEntry.companyId !== params.companyId) {
        return {
          allowed: false,
          code: 'LICENSE_ALREADY_REDEEMED',
          error: `License pair already redeemed: Pair '${params.licensePairId}' is permanently bound to company '${existingPairEntry.companyId}' and cannot be reused for '${params.companyId}'.`,
        };
      }

      // Same company + same pair: Check whether DB already holds matching intact activation receipt (idempotent retry)
      // vs pre-activation DB replay attempt (rollback of activation state to bypass consumption).
      const dbHasMatchingRecord =
        params.existingDbLicense &&
        params.existingDbLicense.licensePairId === existingPairEntry.licensePairId &&
        params.existingDbLicense.activationRecordId === existingPairEntry.activationRecordId &&
        this.verifyActivationReceipt(params.existingDbLicense.activationReceipt, {
          companyId: params.companyId,
          licensePairId: existingPairEntry.licensePairId,
          activationRecordId: existingPairEntry.activationRecordId,
          keyFileId: existingPairEntry.keyFileId,
        }).valid;

      if (dbHasMatchingRecord) {
        return {
          allowed: true,
          idempotent: true,
          code: 'IDEMPOTENT_ALREADY_ACTIVE',
          record: existingPairEntry,
        };
      }

      // Authorized recovery referencing this exact pair/company
      if (
        params.authorizedRecovery &&
        params.authorizedRecovery.recoveryReference === existingPairEntry.activationRecordId
      ) {
        existingPairEntry.status = 'ACTIVE';
        existingPairEntry.updatedAt = new Date().toISOString();
        this.writeRegistryAtomic(records);
        return {
          allowed: true,
          idempotent: false,
          code: 'REDEEMED',
          record: existingPairEntry,
        };
      }

      return {
        allowed: false,
        code: 'LICENSE_ALREADY_REDEEMED',
        error: `This license pair (${params.licensePairId}) has already been redeemed. Duplicate consumption or replay of a consumed pair is prohibited without authorized recovery.`,
      };
    }

    // Check if the company ALREADY has an active/redeemed DIFFERENT license pair
    const existingCompanyPair = records.find(
      (r) =>
        r.companyId === params.companyId &&
        (r.status === 'ACTIVE' || r.status === 'REDEEMED' || r.status === 'SUSPENDED')
    );

    let recoveryAudit: RecoveryAuditEntry | undefined;
    if (existingCompanyPair) {
      const recoveryMatches =
        params.authorizedRecovery &&
        (params.authorizedRecovery.recoveryReference === existingCompanyPair.licensePairId ||
          params.authorizedRecovery.recoveryReference === existingCompanyPair.activationRecordId);

      if (!recoveryMatches) {
        return {
          allowed: false,
          code: 'UNAUTHORIZED_LICENSE_REPLACEMENT',
          error: `Company '${params.companyId}' already holds active license pair '${existingCompanyPair.licensePairId}'. Unauthorized silent replacement with another license pair is blocked. Use Authorized License Recovery if replacing a damaged or migrated license.`,
        };
      }

      // Mark previous pair as RECOVERED
      recoveryAudit = {
        previousActivationRecordId: existingCompanyPair.activationRecordId,
        previousLicensePairId: existingCompanyPair.licensePairId,
        newLicensePairId: params.licensePairId,
        reason: params.authorizedRecovery!.reason || 'Authorized license recovery/replacement',
        authorizedBy: params.authorizedRecovery!.authorizedBy,
        recoveryRef: params.authorizedRecovery!.recoveryReference,
        timestamp: new Date().toISOString(),
      };
      existingCompanyPair.status = 'RECOVERED';
      existingCompanyPair.updatedAt = recoveryAudit.timestamp;
    }

    // Also block replacement if DB directly shows a different active paid pair (e.g. restored company DB before registry saw it)
    if (
      !existingCompanyPair &&
      params.existingDbLicense &&
      params.existingDbLicense.planType &&
      params.existingDbLicense.planType !== 'TRIAL' &&
      params.existingDbLicense.licensePairId &&
      params.existingDbLicense.licensePairId !== params.licensePairId
    ) {
      const recoveryMatchesDb =
        params.authorizedRecovery &&
        (params.authorizedRecovery.recoveryReference === params.existingDbLicense.licensePairId ||
          params.authorizedRecovery.recoveryReference === params.existingDbLicense.activationRecordId);

      if (!recoveryMatchesDb) {
        return {
          allowed: false,
          code: 'UNAUTHORIZED_LICENSE_REPLACEMENT',
          error: `Company already holds active license pair '${params.existingDbLicense.licensePairId}'. Unauthorized silent replacement is prohibited.`,
        };
      }
    }

    const nowIso = new Date().toISOString();
    const activationRecordId = `ACT-${crypto.randomUUID()}`;
    const signedActivationReceipt = this.createSignedActivationReceipt({
      activationRecordId,
      licensePairId: params.licensePairId,
      licenseId: params.licenseId,
      keyFileId: params.keyFileId,
      companyId: params.companyId,
      planType: params.planType,
      activatedAt: nowIso,
      activatedBy: params.activatedBy,
    });

    const newRecord: TrustedRedeemedPairRecord = {
      licensePairId: params.licensePairId,
      licenseId: params.licenseId,
      keyFileId: params.keyFileId,
      companyId: params.companyId,
      activationRecordId,
      activationKey: params.activationKey,
      planType: params.planType,
      status: 'ACTIVE',
      redeemedAt: nowIso,
      activatedBy: params.activatedBy,
      expirationDate: params.expirationDate,
      isLifetime: params.isLifetime,
      revocationRef: params.revocationRef,
      signedActivationReceipt,
      recoveryHistory: recoveryAudit ? [recoveryAudit] : [],
      updatedAt: nowIso,
    };

    records.push(newRecord);
    this.writeRegistryAtomic(records);

    return {
      allowed: true,
      idempotent: false,
      code: 'REDEEMED',
      record: newRecord,
    };
  }

  /**
   * Verifies that an activated company database license remains consistent with cryptographic pair proofs
   * and the trusted local licensing registry across opens, switches, restarts, and restores.
   */
  public static verifyCompanyActivationAgainstRegistry(params: {
    companyId: string;
    dbLicense: {
      planType?: string | null;
      status?: string | null;
      licenseKey?: string | null;
      signedFileContent?: string | null;
      keyFileContent?: string | null;
      licensePairId?: string | null;
      keyFileId?: string | null;
      activationRecordId?: string | null;
      activationReceipt?: string | null;
      expirationDate?: string | null;
      isLifetime?: boolean | null;
    };
  }): {
    valid: boolean;
    code:
      | 'OK'
      | 'TRIAL_ACTIVE'
      | 'MISSING_ACTIVATION_METADATA'
      | 'CORRUPTED_ACTIVATION_METADATA'
      | 'REGISTRY_MISMATCH'
      | 'LICENSE_REVOKED'
      | 'LICENSE_SUSPENDED'
      | 'LICENSE_INVALID';
    error?: string;
  } {
    const lic = params.dbLicense;
    const reg = this.readRegistrySafe();
    if (!reg.valid) {
      return { valid: false, code: 'REGISTRY_MISMATCH', error: reg.error };
    }

    const isTrial =
      !lic.planType ||
      (lic.planType === 'TRIAL' &&
        (Boolean(lic.licenseKey?.startsWith('LEDGERAI-TRIAL-')) ||
          Boolean(lic.licenseKey?.startsWith('LIC-TRIAL-'))));

    if (isTrial) {
      return { valid: true, code: 'TRIAL_ACTIVE' };
    }

    // Legacy v1 single-artifact tests or compatibility check (ONLY if explicitly v1 without licenseVersion 2.0)
    //Wait: if dual-file fields are present or required for v2:
    let parsedLicJson: any = null;
    try {
      parsedLicJson = lic.signedFileContent ? JSON.parse(lic.signedFileContent) : null;
    } catch {
      return {
        valid: false,
        code: 'CORRUPTED_ACTIVATION_METADATA',
        error: 'Stored key license content is corrupted.',
      };
    }

    if (!parsedLicJson || !parsedLicJson.payload || !parsedLicJson.signature) {
      return {
        valid: false,
        code: 'MISSING_ACTIVATION_METADATA',
        error: 'Signed license payload or signature is missing from company license metadata.',
      };
    }

    const isDualFile =
      parsedLicJson.payload.artifactType === 'LEDGERAI_KEY_LICENSE_FILE' ||
      parsedLicJson.payload.licenseVersion === '2.0' ||
      Boolean(lic.licensePairId);

    if (isDualFile) {
      if (!lic.keyFileContent || !lic.licensePairId || !lic.activationRecordId || !lic.activationReceipt) {
        return {
          valid: false,
          code: 'MISSING_ACTIVATION_METADATA',
          error: 'Company license is missing mandatory dual-file activation metadata or receipt.',
        };
      }

      // Validate cryptographic pair signatures & company identity binding
      const pairCheck = validateLicenseFilePair({
        licenseKeyFile: lic.keyFileContent,
        keyLicenseFile: lic.signedFileContent!,
        expectedCompanyId: params.companyId,
      });

      if (!pairCheck.valid) {
        return {
          valid: false,
          code: pairCheck.code === 'LICENSE_REVOKED'
            ? 'LICENSE_REVOKED'
            : pairCheck.code === 'LICENSE_SUSPENDED'
            ? 'LICENSE_SUSPENDED'
            : 'CORRUPTED_ACTIVATION_METADATA',
          error: pairCheck.error,
        };
      }

      // Verify signed HMAC activation receipt
      const receiptCheck = this.verifyActivationReceipt(lic.activationReceipt, {
        companyId: params.companyId,
        licensePairId: lic.licensePairId,
        activationRecordId: lic.activationRecordId,
        keyFileId: lic.keyFileId || pairCheck.keyPayload?.keyFileId,
      });
      if (!receiptCheck.valid) {
        return {
          valid: false,
          code: receiptCheck.code,
          error: receiptCheck.error,
        };
      }

      // Cross-check against trusted local registry
      const pairEntry = reg.records.find((r) => r.licensePairId === lic.licensePairId);
      const companyActiveEntry = reg.records.find(
        (r) => r.companyId === params.companyId && (r.status === 'ACTIVE' || r.status === 'REDEEMED')
      );

      if (pairEntry) {
        if (pairEntry.status === 'REVOKED') {
          return { valid: false, code: 'LICENSE_REVOKED', error: 'License pair is revoked in trusted local registry.' };
        }
        if (pairEntry.status === 'SUSPENDED') {
          return { valid: false, code: 'LICENSE_SUSPENDED', error: 'License pair is suspended in trusted local registry.' };
        }
        if (pairEntry.companyId !== params.companyId) {
          return {
            valid: false,
            code: 'REGISTRY_MISMATCH',
            error: `Registry mismatch: License pair belongs to '${pairEntry.companyId}', not '${params.companyId}'.`,
          };
        }
        if (pairEntry.activationRecordId !== lic.activationRecordId) {
          return {
            valid: false,
            code: 'REGISTRY_MISMATCH',
            error: 'Registry mismatch: Database activation record ID does not match trusted local licensing registry.',
          };
        }
      } else if (companyActiveEntry && companyActiveEntry.licensePairId !== lic.licensePairId) {
        return {
          valid: false,
          code: 'REGISTRY_MISMATCH',
          error: `Registry mismatch: Company is bound in registry to pair '${companyActiveEntry.licensePairId}', but DB claims '${lic.licensePairId}'.`,
        };
      } else {
        // Portable database restored cleanly on a host whose registry doesn't have this valid signed pair yet:
        // Since both Authority RSA-SHA256 signatures AND the HMAC signed activation receipt verified cleanly for this company,
        // automatically register the verified active pair into the host's trusted local registry.
        try {
          const updatedRecords = [
            ...reg.records,
            {
              licensePairId: lic.licensePairId!,
              licenseId: pairCheck.licensePayload!.licenseId,
              keyFileId: pairCheck.keyPayload!.keyFileId,
              companyId: params.companyId,
              activationRecordId: lic.activationRecordId!,
              activationKey: pairCheck.licensePayload!.activationKey,
              planType: pairCheck.licensePayload!.planType,
              status: 'ACTIVE' as RegistryLifecycleStatus,
              redeemedAt: receiptCheck.receiptData.activatedAt || new Date().toISOString(),
              activatedBy: receiptCheck.receiptData.activatedBy || 'restored-system',
              expirationDate: pairCheck.licensePayload!.expirationDate || null,
              isLifetime: Boolean(lic.isLifetime),
              revocationRef: pairCheck.licensePayload!.revocationRef || `rev-${lic.licensePairId}`,
              signedActivationReceipt: lic.activationReceipt!,
              updatedAt: new Date().toISOString(),
            },
          ];
          this.writeRegistryAtomic(updatedRecords);
        } catch {}
      }
    }

    return { valid: true, code: 'OK' };
  }

  public static setPairLifecycleStatus(
    licensePairIdOrCompanyId: string,
    status: 'REVOKED' | 'SUSPENDED' | 'ACTIVE',
    _reason?: string
  ): boolean {
    const reg = this.readRegistrySafe();
    if (!reg.valid) return false;
    let changed = false;
    const updated = reg.records.map((r) => {
      if (r.licensePairId === licensePairIdOrCompanyId || r.companyId === licensePairIdOrCompanyId || r.licenseId === licensePairIdOrCompanyId) {
        changed = true;
        return { ...r, status, updatedAt: new Date().toISOString() };
      }
      return r;
    });
    if (changed) {
      this.writeRegistryAtomic(updated);
    }
    return changed;
  }

  public static resetForTesting(companyIds?: string[]): void {
    if (!companyIds || companyIds.length === 0) {
      const filePath = paths.getLocalLicenseRegistryFilePath();
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    }
    const reg = this.readRegistrySafe();
    if (!reg.valid) {
      const filePath = paths.getLocalLicenseRegistryFilePath();
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    }
    const filtered = reg.records.filter((r) => !companyIds.includes(r.companyId));
    this.writeRegistryAtomic(filtered);
  }
}
