import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { paths } from '../services/paths';

export interface AuditHmacVersionEntry {
  keyVersion: number;
  ivHex: string;
  tagHex: string;
  wrappedSecretHex: string;
  status: 'ACTIVE' | 'RETIRED' | 'COMPROMISED';
  createdAt: string;
  compromisedAt?: string;
  compromisedReason?: string;
}

export interface AuditHmacKeyring {
  companyId: string;
  keyId: string;
  activeVersion: number;
  versions: Record<string, AuditHmacVersionEntry>;
  updatedAt: string;
}

const AUTHORIZED_HMAC_ROLES = new Set([
  'Company Owner',
  'COMPANY_OWNER',
  'System Admin',
  'SYSTEM_ADMIN',
  'ADMIN',
  'Auditor',
  'AUDITOR',
  'Approver',
  'APPROVER',
  'SYSTEM_AUDIT_SEALER',
  'SYSTEM_AUDIT_VERIFIER',
]);

const unavailableSimulationCompanies = new Set<string>();

export class AuditHmacKeyManager {
  private static getVaultDir(): string {
    const dir = path.join(paths.getConfigDir(), '.keystore_vault');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  public static getKeyringFilePath(companyId: string): string {
    const safeId = (companyId || 'SYSTEM').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.getVaultDir(), `${safeId}.audit_hmac.json`);
  }

  private static deriveOsVaultAnchor(includeHostname = false): Buffer {
    const machineBinding = includeHostname
      ? `${os.hostname()}|${os.platform()}|${os.arch()}|${os.userInfo().username}`
      : `${os.platform()}|${os.arch()}|${os.userInfo().username}`;
    const envSecret = process.env.LEDGERAI_AUDIT_HMAC_MASTER_KEY || process.env.LEDGERAI_MASTER_KEY || 'ledgerai-os-audit-hmac-vault-anchor-v1';
    return crypto.createHash('sha256').update(`${machineBinding}|${envSecret}`).digest();
  }

  private static wrapSecret(secret: Buffer, companyId: string, keyId: string, keyVersion: number): { ivHex: string; tagHex: string; wrappedSecretHex: string } {
    const anchor = this.deriveOsVaultAnchor(false);
    const iv = crypto.randomBytes(12);
    const aad = Buffer.from(`AUDIT-HMAC-V2|${companyId}|${keyId}|${keyVersion}`, 'utf8');
    const cipher = crypto.createCipheriv('aes-256-gcm', anchor, iv);
    cipher.setAAD(aad);
    const wrapped = Buffer.concat([cipher.update(secret), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ivHex: iv.toString('hex'),
      tagHex: tag.toString('hex'),
      wrappedSecretHex: wrapped.toString('hex'),
    };
  }

  private static unwrapSecret(entry: AuditHmacVersionEntry, companyId: string, keyId: string): Buffer {
    const iv = Buffer.from(entry.ivHex, 'hex');
    const tag = Buffer.from(entry.tagHex, 'hex');
    const ciphertext = Buffer.from(entry.wrappedSecretHex, 'hex');
    const aad = Buffer.from(`AUDIT-HMAC-V2|${companyId}|${keyId}|${entry.keyVersion}`, 'utf8');

    try {
      const anchor = this.deriveOsVaultAnchor(false);
      const decipher = crypto.createDecipheriv('aes-256-gcm', anchor, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      const legacyAnchor = this.deriveOsVaultAnchor(true);
      const decipher = crypto.createDecipheriv('aes-256-gcm', legacyAnchor, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    }
  }

  public static assertCallerAuthorized(callerRole: string | undefined, operation: string, companyId: string): void {
    const role = (callerRole || '').trim();
    if (!AUTHORIZED_HMAC_ROLES.has(role)) {
      throw new Error(
        `UNAUTHORIZED_HMAC_KEY_ACCESS: Role '${role || 'ANONYMOUS'}' is not authorized to perform '${operation}' on cryptographic audit HMAC keys for company '${companyId}'.`
      );
    }
  }

  public static setSimulateKeyUnavailable(companyId: string, unavailable: boolean): void {
    if (unavailable) {
      unavailableSimulationCompanies.add(companyId);
    } else {
      unavailableSimulationCompanies.delete(companyId);
    }
  }

  public static isKeySimulatedUnavailable(companyId: string): boolean {
    return unavailableSimulationCompanies.has(companyId);
  }

  public static getKeyringFilePathForInspection(companyId: string, callerRole = 'Company Owner'): string {
    this.assertCallerAuthorized(callerRole, 'INSPECT_KEYRING_PATH', companyId);
    return this.getKeyringFilePath(companyId);
  }

  public static getOrProvisionKeyringSync(companyId: string, callerRole = 'SYSTEM_AUDIT_SEALER'): AuditHmacKeyring {
    this.assertCallerAuthorized(callerRole, 'READ_OR_PROVISION_KEYRING', companyId);
    const safeId = (companyId || 'SYSTEM').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = this.getKeyringFilePath(companyId);

    if (fs.existsSync(filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AuditHmacKeyring;
        const activeEntry = parsed?.versions?.[String(parsed?.activeVersion)];
        if (parsed && parsed.versions && parsed.activeVersion && activeEntry) {
          this.unwrapSecret(activeEntry, parsed.companyId, parsed.keyId);
          return parsed;
        }
      } catch {
        // Re-initialize if unreadable or wrapped under a stale ephemeral container anchor
      }
    }

    const keyId = `audit-hmac-${safeId}`;
    const secretV1 = crypto.randomBytes(32);
    const wrappedV1 = this.wrapSecret(secretV1, companyId, keyId, 1);
    const nowIso = new Date().toISOString();
    const keyring: AuditHmacKeyring = {
      companyId,
      keyId,
      activeVersion: 1,
      versions: {
        '1': {
          keyVersion: 1,
          ...wrappedV1,
          status: 'ACTIVE',
          createdAt: nowIso,
        },
      },
      updatedAt: nowIso,
    };
    fs.writeFileSync(filePath, JSON.stringify(keyring, null, 2), { mode: 0o600 });
    return keyring;
  }

  public static getActiveSigningKeySync(companyId: string, callerRole = 'SYSTEM_AUDIT_SEALER'): {
    keyId: string;
    keyVersion: number;
    secret: Buffer;
  } {
    this.assertCallerAuthorized(callerRole, 'SIGN_AUDIT_EVENT', companyId);
    if (unavailableSimulationCompanies.has(companyId)) {
      throw new Error(`HMAC_KEY_UNAVAILABLE: Cryptographic audit HMAC key for company '${companyId}' is currently unavailable.`);
    }
    const keyring = this.getOrProvisionKeyringSync(companyId, callerRole);
    const activeEntry = keyring.versions[String(keyring.activeVersion)];
    if (!activeEntry) {
      throw new Error(`HMAC_KEY_UNAVAILABLE: Active HMAC key version ${keyring.activeVersion} missing for '${companyId}'.`);
    }
    if (activeEntry.status === 'COMPROMISED') {
      throw new Error(`HMAC_KEY_COMPROMISED: Active HMAC key version ${keyring.activeVersion} for '${companyId}' is marked COMPROMISED.`);
    }
    const secret = this.unwrapSecret(activeEntry, keyring.companyId, keyring.keyId);
    return {
      keyId: keyring.keyId,
      keyVersion: activeEntry.keyVersion,
      secret,
    };
  }

  public static getVerificationKeySync(
    companyId: string,
    keyVersion: number,
    callerRole = 'SYSTEM_AUDIT_VERIFIER'
  ): {
    available: boolean;
    compromised: boolean;
    keyId?: string;
    secret?: Buffer;
    reason?: 'HMAC_KEY_UNAVAILABLE' | 'HMAC_KEY_COMPROMISED';
  } {
    this.assertCallerAuthorized(callerRole, 'VERIFY_AUDIT_EVENT', companyId);
    if (unavailableSimulationCompanies.has(companyId)) {
      return { available: false, compromised: false, reason: 'HMAC_KEY_UNAVAILABLE' };
    }
    const filePath = this.getKeyringFilePath(companyId);
    if (!fs.existsSync(filePath)) {
      return { available: false, compromised: false, reason: 'HMAC_KEY_UNAVAILABLE' };
    }
    try {
      const keyring = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AuditHmacKeyring;
      const entry = keyring.versions?.[String(keyVersion)];
      if (!entry) {
        return { available: false, compromised: false, reason: 'HMAC_KEY_UNAVAILABLE' };
      }
      if (entry.status === 'COMPROMISED') {
        return { available: true, compromised: true, keyId: keyring.keyId, reason: 'HMAC_KEY_COMPROMISED' };
      }
      const secret = this.unwrapSecret(entry, keyring.companyId, keyring.keyId);
      return { available: true, compromised: false, keyId: keyring.keyId, secret };
    } catch {
      return { available: false, compromised: false, reason: 'HMAC_KEY_UNAVAILABLE' };
    }
  }

  public static rotateCompanyHmacKeySync(
    companyId: string,
    optionsOrCallerRole?: { callerRole?: string; reason?: string } | string
  ): { keyId: string; previousVersion: number; newVersion: number; newActiveVersion: number } {
    const callerRole =
      typeof optionsOrCallerRole === 'string'
        ? optionsOrCallerRole
        : optionsOrCallerRole?.callerRole || 'Company Owner';
    this.assertCallerAuthorized(callerRole, 'ROTATE_HMAC_KEY', companyId);
    const keyring = this.getOrProvisionKeyringSync(companyId, callerRole);
    const prevVersion = keyring.activeVersion;
    const prevEntry = keyring.versions[String(prevVersion)];
    if (prevEntry && prevEntry.status === 'ACTIVE') {
      prevEntry.status = 'RETIRED';
    }
    const newVersion = prevVersion + 1;
    const newSecret = crypto.randomBytes(32);
    const wrapped = this.wrapSecret(newSecret, keyring.companyId, keyring.keyId, newVersion);
    const nowIso = new Date().toISOString();
    keyring.activeVersion = newVersion;
    keyring.versions[String(newVersion)] = {
      keyVersion: newVersion,
      ...wrapped,
      status: 'ACTIVE',
      createdAt: nowIso,
    };
    keyring.updatedAt = nowIso;
    fs.writeFileSync(this.getKeyringFilePath(companyId), JSON.stringify(keyring, null, 2), { mode: 0o600 });
    return { keyId: keyring.keyId, previousVersion: prevVersion, newVersion, newActiveVersion: newVersion };
  }

  public static markKeyVersionCompromisedSync(
    companyId: string,
    keyVersion: number,
    optionsOrReason?: { callerRole?: string; reason?: string } | string,
    explicitCallerRole?: string
  ): void {
    const callerRole =
      explicitCallerRole ||
      (typeof optionsOrReason === 'object' && optionsOrReason?.callerRole) ||
      'Company Owner';
    const reasonStr =
      typeof optionsOrReason === 'string'
        ? optionsOrReason
        : optionsOrReason?.reason || 'Key marked compromised by administrator.';
    this.assertCallerAuthorized(callerRole, 'MARK_KEY_COMPROMISED', companyId);
    const keyring = this.getOrProvisionKeyringSync(companyId, callerRole);
    const entry = keyring.versions[String(keyVersion)];
    if (!entry) {
      throw new Error(`HMAC_KEY_VERSION_NOT_FOUND: Version ${keyVersion} not found for '${companyId}'.`);
    }
    entry.status = 'COMPROMISED';
    entry.compromisedAt = new Date().toISOString();
    entry.compromisedReason = reasonStr;
    keyring.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.getKeyringFilePath(companyId), JSON.stringify(keyring, null, 2), { mode: 0o600 });
  }

  public static exportPortableKeyringEnvelopeSync(
    companyId: string,
    callerRole = 'Company Owner'
  ): {
    keyId: string;
    activeVersion: number;
    versions: Array<{ keyVersion: number; secretBase64: string; status: 'ACTIVE' | 'RETIRED' | 'COMPROMISED'; createdAt: string }>;
  } | null {
    this.assertCallerAuthorized(callerRole, 'EXPORT_PORTABLE_KEYRING', companyId);
    const filePath = this.getKeyringFilePath(companyId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const keyring = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AuditHmacKeyring;
      const versions: Array<{ keyVersion: number; secretBase64: string; status: 'ACTIVE' | 'RETIRED' | 'COMPROMISED'; createdAt: string }> = [];
      for (const entry of Object.values(keyring.versions)) {
        const rawSecret = this.unwrapSecret(entry, keyring.companyId, keyring.keyId);
        versions.push({
          keyVersion: entry.keyVersion,
          secretBase64: rawSecret.toString('base64'),
          status: entry.status,
          createdAt: entry.createdAt,
        });
      }
      return {
        keyId: keyring.keyId,
        activeVersion: keyring.activeVersion,
        versions,
      };
    } catch {
      return null;
    }
  }

  public static importPortableKeyringEnvelopeSync(
    targetCompanyId: string,
    envelope: {
      keyId?: string;
      activeVersion: number;
      versions: Array<{ keyVersion: number; secretBase64: string; status: 'ACTIVE' | 'RETIRED' | 'COMPROMISED'; createdAt: string }>;
    },
    callerRole = 'Company Owner'
  ): void {
    this.assertCallerAuthorized(callerRole, 'IMPORT_PORTABLE_KEYRING', targetCompanyId);
    if (!envelope || !Array.isArray(envelope.versions) || envelope.versions.length === 0) return;
    const safeId = (targetCompanyId || 'SYSTEM').replace(/[^a-zA-Z0-9_-]/g, '_');
    const keyId = `audit-hmac-${safeId}`;
    const versionsMap: Record<string, AuditHmacVersionEntry> = {};
    for (const v of envelope.versions) {
      const rawSecret = Buffer.from(v.secretBase64, 'base64');
      const wrapped = this.wrapSecret(rawSecret, targetCompanyId, keyId, v.keyVersion);
      versionsMap[String(v.keyVersion)] = {
        keyVersion: v.keyVersion,
        ...wrapped,
        status: v.status || 'ACTIVE',
        createdAt: v.createdAt || new Date().toISOString(),
      };
    }
    const keyring: AuditHmacKeyring = {
      companyId: targetCompanyId,
      keyId,
      activeVersion: envelope.activeVersion || 1,
      versions: versionsMap,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(this.getKeyringFilePath(targetCompanyId), JSON.stringify(keyring, null, 2), { mode: 0o600 });
  }
}

export function computeAuditHmacSignature(params: {
  integritySeal: string;
  companyId: string | null;
  sequenceNumber?: number | null;
  previousHash?: string | null;
  keyVersion: number;
  secret: Buffer;
}): string {
  const canonicalMessage = `LEDGERAI-AUDIT-HMAC-V2|${params.companyId || 'SYSTEM'}|${params.keyVersion}|${params.sequenceNumber ?? 0}|${params.previousHash || 'GENESIS'}|${params.integritySeal}`;
  return crypto.createHmac('sha256', params.secret).update(canonicalMessage, 'utf8').digest('hex');
}

export function normalizeAuditTimestamp(ts: any): Date {
  if (!ts) return new Date(Math.floor(Date.now() / 1000) * 1000);
  if (ts instanceof Date) {
    if (ts.getFullYear() > 3000) {
      return new Date(Math.floor(ts.getTime() / 1000));
    }
    return new Date(Math.floor(ts.getTime() / 1000) * 1000);
  }
  const num = Number(ts);
  if (!isNaN(num)) {
    const ms = num > 100000000000 ? num : num * 1000;
    return new Date(Math.floor(ms / 1000) * 1000);
  }
  const parsed = new Date(ts);
  return isNaN(parsed.getTime())
    ? new Date(Math.floor(Date.now() / 1000) * 1000)
    : new Date(Math.floor(parsed.getTime() / 1000) * 1000);
}

export function computeAuditSealHash(params: {
  id: string;
  companyId: string | null;
  userId: string | null;
  userDisplayName: string | null;
  userEmail: string | null;
  role: string | null;
  action: string;
  entityType: string;
  entityId: string;
  recordReference: string | null;
  beforeData: string | null;
  afterData: string | null;
  changedFields: string | null;
  result: string;
  ipAddress: string | null;
  timestampIso: string;
  chainVersion?: number;
  sequenceNumber?: number | null;
  previousHash?: string | null;
}): string {
  const basePayload: Record<string, any> = {
    id: params.id,
    companyId: params.companyId ?? null,
    userId: params.userId ?? null,
    userDisplayName: params.userDisplayName ?? null,
    userEmail: params.userEmail ?? null,
    role: params.role ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    recordReference: params.recordReference ?? null,
    beforeData: params.beforeData ?? null,
    afterData: params.afterData ?? null,
    changedFields: params.changedFields ?? null,
    result: params.result,
    ipAddress: params.ipAddress ?? null,
    timestamp: params.timestampIso,
  };
  if (params.chainVersion && params.chainVersion >= 2) {
    basePayload.chainVersion = params.chainVersion;
    basePayload.sequenceNumber = params.sequenceNumber ?? null;
    basePayload.previousHash = params.previousHash ?? null;
  }
  return crypto.createHash('sha256').update(JSON.stringify(basePayload)).digest('hex');
}

export function sealAuditRowSync(client: any, row: Record<string, any>): Record<string, any> {
  if (!row || typeof row !== 'object') return row;

  let existingMeta: Record<string, any> | null = null;
  if (row.metadata) {
    try {
      existingMeta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : { ...row.metadata };
    } catch {
      existingMeta = { rawMetadata: String(row.metadata) };
    }
  }

  // Already sealed (e.g. via AuditService.log)
  if (existingMeta && typeof existingMeta.integritySeal === 'string' && existingMeta.integritySeal) {
    return row;
  }

  const id = row.id || `audit-${crypto.randomUUID().slice(0, 12)}`;
  const companyId = row.companyId ?? null;
  const now = normalizeAuditTimestamp(row.timestamp);
  const resultStr = row.result || 'SUCCESS';

  let chainVersion = 1;
  let sequenceNumber: number | null = null;
  let previousHash: string | null = null;

  if (companyId) {
    chainVersion = 2;
    let prevSeq = 0;
    let prevHash: string | null = null;
    try {
      if (client && typeof client.prepare === 'function') {
        const prevRows = client
          .prepare(`SELECT metadata FROM audit_logs WHERE company_id = ? ORDER BY rowid DESC LIMIT 50`)
          .all(companyId) as Array<{ metadata?: string | null }>;
        for (const pr of prevRows) {
          if (!pr?.metadata) continue;
          try {
            const pm = typeof pr.metadata === 'string' ? JSON.parse(pr.metadata) : pr.metadata;
            if (pm && typeof pm.integritySeal === 'string' && pm.integritySeal) {
              if (typeof pm.sequenceNumber === 'number' && pm.chainVersion >= 2) {
                prevSeq = pm.sequenceNumber;
                prevHash = pm.integritySeal;
                break;
              }
              if (!prevHash) {
                prevHash = pm.integritySeal;
              }
            }
          } catch {
            // ignore legacy non-JSON metadata
          }
        }
      }
    } catch {
      // fall back cleanly to genesis
    }
    sequenceNumber = prevSeq + 1;
    previousHash = prevHash || 'GENESIS';
  }

  const integritySeal = computeAuditSealHash({
    id,
    companyId,
    userId: row.userId ?? null,
    userDisplayName: row.userDisplayName ?? null,
    userEmail: row.userEmail ?? null,
    role: row.role ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    recordReference: row.recordReference ?? null,
    beforeData: row.beforeData ?? null,
    afterData: row.afterData ?? null,
    changedFields: row.changedFields ?? null,
    result: resultStr,
    ipAddress: row.ipAddress ?? null,
    timestampIso: now.toISOString(),
    chainVersion,
    sequenceNumber,
    previousHash,
  });

  let hmacFields: Record<string, any> = {};
  if (companyId) {
    try {
      const signingKey = AuditHmacKeyManager.getActiveSigningKeySync(companyId, 'SYSTEM_AUDIT_SEALER');
      const hmacSeal = computeAuditHmacSignature({
        integritySeal,
        companyId,
        sequenceNumber,
        previousHash,
        keyVersion: signingKey.keyVersion,
        secret: signingKey.secret,
      });
      hmacFields = {
        hmacKeyId: signingKey.keyId,
        hmacKeyVersion: signingKey.keyVersion,
        hmacSeal,
      };
    } catch {
      // If key unavailable in simulation, omit hmacSeal so verifier detects missing/unavailable seal
    }
  }

  const chainFields =
    chainVersion >= 2
      ? { chainVersion, sequenceNumber, previousHash, integritySeal, ...hmacFields }
      : { integritySeal, ...hmacFields };

  const mergedMetadata =
    existingMeta && typeof existingMeta === 'object' && !Array.isArray(existingMeta)
      ? { ...existingMeta, ...chainFields }
      : chainFields;

  return {
    ...row,
    id,
    result: resultStr,
    timestamp: now,
    metadata: JSON.stringify(mergedMetadata),
  };
}

