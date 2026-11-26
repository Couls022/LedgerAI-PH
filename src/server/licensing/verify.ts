import crypto from 'crypto';

// The LedgerAI Client contains ONLY Public Keys for Signature Verification.
// Private keys and signing infrastructure NEVER exist in client distributions.
export const DEV_TEST_AUTHORITY_KEY_ID = 'LGR-AUTH-KEY-DEV-2026-V1';

export const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAizbGPU/536YEOQEysjhG
jdR83gR2AwJKJ7W+jF7iB2EIvYpPPt/dMsqpwjxR8vsVYg1Ic6qSQ9yLvVXxwlTX
jvG7sTmME4+Z2qzTccO6EIEXm2Ij3s2PhN6VXdqUwkDJJeMx3W9/fWFfvJ1QbYqY
9MTZEqGM6x33zBEedDLW1vO7fWui3Qx/wnaIwFLvH+CCiPz8fHpKo9Ljt04KRh1j
zi05grG3ocfk2n9ww4N/N4SfYb9hp2WVQtWxvEsuPoCuWcA/QJomt9Wb3XVIRl+o
hwhw9GDk2H5ibM6vAJlAuUIkOA6PuQE251bBpyqHaq7fFF0M7fTkgDAXgHaOifw2
rQIDAQAB
-----END PUBLIC KEY-----
`;

export interface AuthorityPublicKeyRecord {
  keyId: string;
  keyVersion: number;
  environment: 'DEVELOPMENT_TEST_ONLY' | 'PRODUCTION';
  status: 'ACTIVE' | 'RETIRED' | 'REVOKED';
  publicKeyPem: string;
  sha256Fingerprint: string;
  effectiveFrom: string;
  retiredAt?: string | null;
  revokedAt?: string | null;
  revocationReason?: string | null;
}

export function computePublicKeyFingerprint(publicKeyPem: string): string {
  const cleanPem = publicKeyPem.trim();
  return crypto.createHash('sha256').update(cleanPem, 'utf8').digest('hex');
}

const DEFAULT_DEV_KEY_RECORD: AuthorityPublicKeyRecord = {
  keyId: DEV_TEST_AUTHORITY_KEY_ID,
  keyVersion: 1,
  environment: 'DEVELOPMENT_TEST_ONLY',
  status: 'ACTIVE',
  publicKeyPem: RSA_PUBLIC_KEY,
  sha256Fingerprint: computePublicKeyFingerprint(RSA_PUBLIC_KEY),
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  retiredAt: null,
  revokedAt: null,
  revocationReason: null,
};

const runtimeKeyRing = new Map<string, AuthorityPublicKeyRecord>([
  [DEV_TEST_AUTHORITY_KEY_ID, { ...DEFAULT_DEV_KEY_RECORD }],
]);

const runtimeRevokedKeyIds = new Set<string>();

export function getAuthorityPublicKeyRing(): AuthorityPublicKeyRecord[] {
  const merged = new Map<string, AuthorityPublicKeyRecord>();
  for (const [k, v] of runtimeKeyRing.entries()) {
    merged.set(k, { ...v });
  }

  // Support injecting a rotated production public key via environment configuration
  const envProdPubKey = process.env.LEDGERAI_AUTHORITY_PUBLIC_KEY;
  if (envProdPubKey && envProdPubKey.includes('BEGIN PUBLIC KEY')) {
    const envKeyId = process.env.LEDGERAI_AUTHORITY_KEY_ID || 'LGR-AUTH-KEY-PROD-2026-V2';
    const envKeyVersion = Number(process.env.LEDGERAI_AUTHORITY_KEY_VERSION || 2);
    merged.set(envKeyId, {
      keyId: envKeyId,
      keyVersion: envKeyVersion,
      environment: 'PRODUCTION',
      status: 'ACTIVE',
      publicKeyPem: envProdPubKey,
      sha256Fingerprint: computePublicKeyFingerprint(envProdPubKey),
      effectiveFrom: new Date().toISOString(),
      retiredAt: null,
      revokedAt: null,
      revocationReason: null,
    });
  }

  const envRevoked = (process.env.LEDGERAI_REVOKED_AUTHORITY_KEY_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const keyId of [...runtimeRevokedKeyIds, ...envRevoked]) {
    const existing = merged.get(keyId);
    if (existing) {
      existing.status = 'REVOKED';
      existing.revokedAt = existing.revokedAt || new Date().toISOString();
      existing.revocationReason = existing.revocationReason || 'Explicitly revoked by Authority Key Governance policy';
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.keyVersion - a.keyVersion);
}

export function registerAuthorityPublicKey(record: Omit<AuthorityPublicKeyRecord, 'sha256Fingerprint'>): AuthorityPublicKeyRecord {
  const fullRecord: AuthorityPublicKeyRecord = {
    ...record,
    sha256Fingerprint: computePublicKeyFingerprint(record.publicKeyPem),
  };
  runtimeKeyRing.set(fullRecord.keyId, fullRecord);
  if (fullRecord.status === 'REVOKED') {
    runtimeRevokedKeyIds.add(fullRecord.keyId);
  } else {
    runtimeRevokedKeyIds.delete(fullRecord.keyId);
  }
  return fullRecord;
}

export function revokeAuthorityKeyId(keyId: string, reason = 'Key rotation / security revocation'): void {
  runtimeRevokedKeyIds.add(keyId);
  const existing = runtimeKeyRing.get(keyId);
  if (existing) {
    existing.status = 'REVOKED';
    existing.revokedAt = new Date().toISOString();
    existing.revocationReason = reason;
  }
}

export function resetAuthorityKeyRingForTesting(): void {
  runtimeKeyRing.clear();
  runtimeRevokedKeyIds.clear();
  runtimeKeyRing.set(DEV_TEST_AUTHORITY_KEY_ID, { ...DEFAULT_DEV_KEY_RECORD });
}

export interface LicensePayload {
  licenseId: string;
  licensePairId?: string;
  keyFileId?: string;
  artifactType?: string;
  companyId: string;
  productId?: string;
  activationKey: string;
  planType: 'PRO' | 'ENTERPRISE' | string;
  type?: 'TERM' | 'LIFETIME' | string;
  durationType?: 'custom' | 'monthly' | 'quarterly' | 'yearly' | 'lifetime' | string;
  expirationDate?: string | null;
  seatCount?: number | 'UNLIMITED' | null;
  entitlements?: {
    planType?: string;
    seatCount?: number | 'UNLIMITED' | null;
    features?: string[];
  };
  issuedAt?: string;
  issuerIdentity?: string;
  licenseVersion?: string;
  activationPolicy?: string;
  revocationRef?: string;
  pairDigest?: string;
  status?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | string;
  recoveryReference?: string | null;
  recoveryReason?: string | null;
  version?: string;
  deviceBindingHash?: string | null;
  authorityKeyId?: string;
  authorityKeyVersion?: number;
  [key: string]: any;
}

export interface LicenseKeyFilePayload {
  artifactType: 'LEDGERAI_LICENSE_KEY_FILE';
  licensePairId: string;
  licenseId: string;
  keyFileId: string;
  companyId: string;
  activationKey: string;
  planType: 'PRO' | 'ENTERPRISE' | string;
  type: 'TERM' | 'LIFETIME' | string;
  expirationDate: string | null;
  issuedAt: string;
  issuerIdentity: string;
  licenseVersion: string;
  activationPolicy: string;
  revocationRef: string;
  pairDigest: string;
  status?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | string;
  authorityKeyId?: string;
  authorityKeyVersion?: number;
  [key: string]: any;
}

export interface KeyLicenseFilePayload extends LicensePayload {
  artifactType: 'LEDGERAI_KEY_LICENSE_FILE';
  licensePairId: string;
  licenseId: string;
  keyFileId: string;
  companyId: string;
  productId: string;
  activationKey: string;
  planType: 'PRO' | 'ENTERPRISE' | string;
  type: 'TERM' | 'LIFETIME' | string;
  expirationDate: string | null;
  seatCount: number | 'UNLIMITED';
  entitlements: {
    planType: string;
    seatCount: number | 'UNLIMITED';
    features: string[];
  };
  issuedAt: string;
  issuerIdentity: string;
  licenseVersion: string;
  activationPolicy: string;
  revocationRef: string;
  pairDigest: string;
}

export type PairValidationCode =
  | 'VALID'
  | 'BOTH_FILES_REQUIRED'
  | 'LICENSE_KEY_FILE_REQUIRED'
  | 'KEY_LICENSE_FILE_REQUIRED'
  | 'INVALID_LICENSE_KEY_FILE'
  | 'INVALID_KEY_LICENSE_FILE'
  | 'INVALID_SIGNATURE'
  | 'LICENSE_PAIR_MISMATCH'
  | 'COMPANY_IDENTITY_MISMATCH'
  | 'LICENSE_REVOKED'
  | 'LICENSE_SUSPENDED';

export interface ValidatePairResult {
  valid: boolean;
  code: PairValidationCode;
  error?: string;
  keyPayload?: LicenseKeyFilePayload;
  keySignature?: string;
  licensePayload?: KeyLicenseFilePayload;
  licenseSignature?: string;
  keyString?: string;
}

export function computeLicensePairDigest(params: {
  licensePairId: string;
  licenseId: string;
  keyFileId: string;
  companyId: string;
  planType: string;
  expirationDate?: string | null;
  issuedAt: string;
}): string {
  const canonical = [
    String(params.licensePairId || '').trim(),
    String(params.licenseId || '').trim(),
    String(params.keyFileId || '').trim(),
    String(params.companyId || '').trim(),
    String(params.planType || '').trim().toUpperCase(),
    params.expirationDate ? String(params.expirationDate).trim() : 'LIFETIME',
    String(params.issuedAt || '').trim(),
  ].join('|');
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Client-Side License Signature Verification
 * Verifies an RSA-SHA256 digital signature against the Authority Public Key Ring,
 * enforcing key revocation and production-vs-development key separation.
 */
export function verifyLicense(licenseData: any, signature: string): boolean {
  if (!licenseData || !signature) {
    return false;
  }
  try {
    const enforceProdOnly = process.env.LEDGERAI_ENFORCE_PRODUCTION_AUTHORITY_KEY === 'true';
    const keyRing = getAuthorityPublicKeyRing();
    const requestedKeyId =
      typeof licenseData.authorityKeyId === 'string' && licenseData.authorityKeyId.trim().length > 0
        ? licenseData.authorityKeyId.trim()
        : null;

    const candidateKeys = requestedKeyId
      ? keyRing.filter((k) => k.keyId === requestedKeyId)
      : keyRing;

    if (candidateKeys.length === 0) {
      return false;
    }

    const serializedPayload = JSON.stringify(licenseData);

    for (const keyRecord of candidateKeys) {
      if (keyRecord.status === 'REVOKED') {
        continue;
      }
      if (enforceProdOnly && keyRecord.environment === 'DEVELOPMENT_TEST_ONLY') {
        continue;
      }
      const verify = crypto.createVerify('SHA256');
      verify.update(serializedPayload);
      verify.end();
      if (verify.verify(keyRecord.publicKeyPem, signature, 'base64')) {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error('[LicenseVerifier] Verification error:', err);
    return false;
  }
}

/**
 * Parses and verifies a self-contained compact activation key token or license string.
 */
export function parseAndVerifyToken(token: string): { valid: boolean; payload?: LicensePayload; signature?: string; error?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Empty or invalid token string provided.' };
  }

  const clean = token.trim();

  // 1. Check for compound format: LGR-PLAN-payload.sig or payload.sig
  if (clean.includes('.')) {
    const parts = clean.split('.');
    if (parts.length === 2) {
      try {
        let rawPayload = parts[0];
        if (rawPayload.startsWith('LGR-')) {
          const sub = rawPayload.split('-');
          rawPayload = sub.slice(2).join('-');
        }
        const payloadJson = Buffer.from(rawPayload, 'base64url').toString('utf8');
        const payload = JSON.parse(payloadJson);
        const signature = Buffer.from(parts[1], 'base64url').toString('base64');

        if (verifyLicense(payload, signature)) {
          return { valid: true, payload, signature };
        } else {
          return { valid: false, error: 'Cryptographic signature verification failed for token.' };
        }
      } catch (e: any) {
        // Continue to other parsers
      }
    }
  }

  // 2. Check for single base64url JSON container: LGR-[PLAN]-[BASE64URL({ payload, signature })]
  if (clean.startsWith('LGR-')) {
    const parts = clean.split('-');
    if (parts.length >= 3) {
      const b64Data = parts.slice(2).join('-');
      try {
        const decoded = Buffer.from(b64Data, 'base64url').toString('utf8');
        const parsed = JSON.parse(decoded);
        if (parsed.payload && parsed.signature) {
          if (verifyLicense(parsed.payload, parsed.signature)) {
            return { valid: true, payload: parsed.payload, signature: parsed.signature };
          } else {
            return { valid: false, error: 'Cryptographic signature verification failed.' };
          }
        }
      } catch (e) {
        // Fallback
      }
    }
  }

  // 3. Check for raw JSON string
  try {
    const parsed = JSON.parse(clean);
    if (parsed.payload && parsed.signature) {
      if (verifyLicense(parsed.payload, parsed.signature)) {
        return { valid: true, payload: parsed.payload, signature: parsed.signature };
      } else {
        return { valid: false, error: 'Cryptographic signature verification failed.' };
      }
    }
  } catch (e) {
    // Not raw JSON
  }

  return { valid: false, error: 'Unable to parse token as a self-contained cryptographic activation key.' };
}

/**
 * Validates the mandatory two-file license pair (License Key File + Key License File).
 * Neither file alone is ever accepted. Both files must parse cleanly, pass RSA-SHA256
 * authority signature verification, cryptographically pair via IDs & pairDigest, and
 * match the immutable Company ID.
 */
export function validateLicenseFilePair(options: {
  licenseKeyFile?: string;
  keyLicenseFile?: string;
  expectedCompanyId?: string;
}): ValidatePairResult {
  const hasKeyFile = typeof options.licenseKeyFile === 'string' && options.licenseKeyFile.trim().length > 0;
  const hasLicenseFile = typeof options.keyLicenseFile === 'string' && options.keyLicenseFile.trim().length > 0;

  if (!hasKeyFile && !hasLicenseFile) {
    return {
      valid: false,
      code: 'BOTH_FILES_REQUIRED',
      error: 'Both files are required: please provide both the License Key File and the Key License File.',
    };
  }
  if (!hasKeyFile) {
    return {
      valid: false,
      code: 'LICENSE_KEY_FILE_REQUIRED',
      error: 'License Key File is missing. Both licensing files are mandatory for activation.',
    };
  }
  if (!hasLicenseFile) {
    return {
      valid: false,
      code: 'KEY_LICENSE_FILE_REQUIRED',
      error: 'Key License File is missing. Both licensing files are mandatory for activation.',
    };
  }

  // 1. Parse License Key File
  let parsedKeyArtifact: any;
  try {
    parsedKeyArtifact = JSON.parse(options.licenseKeyFile!.trim());
  } catch (e: any) {
    return {
      valid: false,
      code: 'INVALID_LICENSE_KEY_FILE',
      error: `Invalid License Key File format: ${e?.message || 'Malformed JSON'}`,
    };
  }

  const keyPayload = parsedKeyArtifact?.payload;
  const keySignature = parsedKeyArtifact?.signature;
  if (
    !keyPayload ||
    typeof keyPayload !== 'object' ||
    !keySignature ||
    typeof keySignature !== 'string'
  ) {
    return {
      valid: false,
      code: 'INVALID_LICENSE_KEY_FILE',
      error: 'License Key File is missing cryptographic payload or signature.',
    };
  }

  if (keyPayload.artifactType === 'LEDGERAI_KEY_LICENSE_FILE') {
    return {
      valid: false,
      code: 'INVALID_LICENSE_KEY_FILE',
      error: 'A Key License File was provided in the License Key File input. Please select the authorized License Key File.',
    };
  }

  if (
    keyPayload.artifactType !== 'LEDGERAI_LICENSE_KEY_FILE' ||
    !keyPayload.licensePairId ||
    !keyPayload.licenseId ||
    !keyPayload.keyFileId ||
    !keyPayload.companyId ||
    !keyPayload.activationKey ||
    !keyPayload.pairDigest ||
    !keyPayload.issuedAt
  ) {
    return {
      valid: false,
      code: 'INVALID_LICENSE_KEY_FILE',
      error: 'License Key File does not conform to the required dual-file pairing format.',
    };
  }

  // 2. Parse Key License File
  let parsedLicArtifact: any;
  try {
    parsedLicArtifact = JSON.parse(options.keyLicenseFile!.trim());
  } catch (e: any) {
    return {
      valid: false,
      code: 'INVALID_KEY_LICENSE_FILE',
      error: `Invalid Key License File format: ${e?.message || 'Malformed JSON'}`,
    };
  }

  const licPayload = parsedLicArtifact?.payload;
  const licSignature = parsedLicArtifact?.signature;
  if (
    !licPayload ||
    typeof licPayload !== 'object' ||
    !licSignature ||
    typeof licSignature !== 'string'
  ) {
    return {
      valid: false,
      code: 'INVALID_KEY_LICENSE_FILE',
      error: 'Key License File is missing cryptographic payload or signature.',
    };
  }

  if (licPayload.artifactType === 'LEDGERAI_LICENSE_KEY_FILE') {
    return {
      valid: false,
      code: 'INVALID_KEY_LICENSE_FILE',
      error: 'A License Key File was provided in the Key License File input. Please select the corresponding Key License File.',
    };
  }

  if (
    licPayload.artifactType !== 'LEDGERAI_KEY_LICENSE_FILE' ||
    !licPayload.licensePairId ||
    !licPayload.licenseId ||
    !licPayload.keyFileId ||
    !licPayload.companyId ||
    !licPayload.activationKey ||
    !licPayload.pairDigest ||
    !licPayload.issuedAt
  ) {
    return {
      valid: false,
      code: 'INVALID_KEY_LICENSE_FILE',
      error: 'Key License File does not conform to the required dual-file pairing format.',
    };
  }

  // 3. Verify Cryptographic RSA-SHA256 Digital Signatures on BOTH files
  if (!verifyLicense(keyPayload, keySignature)) {
    return {
      valid: false,
      code: 'INVALID_SIGNATURE',
      error: 'Digital signature verification failed for the License Key File. The file may be forged, corrupted, or modified.',
    };
  }

  if (!verifyLicense(licPayload, licSignature)) {
    return {
      valid: false,
      code: 'INVALID_SIGNATURE',
      error: 'Digital signature verification failed for the Key License File. The file may be forged, corrupted, or modified.',
    };
  }

  // 4. Verify Cryptographic Pairing between License Key File and Key License File
  const idsMatch =
    keyPayload.licensePairId === licPayload.licensePairId &&
    keyPayload.licenseId === licPayload.licenseId &&
    keyPayload.keyFileId === licPayload.keyFileId &&
    keyPayload.companyId === licPayload.companyId &&
    keyPayload.activationKey === licPayload.activationKey &&
    keyPayload.planType === licPayload.planType &&
    (keyPayload.expirationDate || null) === (licPayload.expirationDate || null) &&
    keyPayload.issuedAt === licPayload.issuedAt &&
    keyPayload.pairDigest === licPayload.pairDigest;

  if (!idsMatch) {
    return {
      valid: false,
      code: 'LICENSE_PAIR_MISMATCH',
      error: 'License pair mismatch: The selected License Key File and Key License File do not belong to the same issued pair.',
    };
  }

  const expectedDigest = computeLicensePairDigest({
    licensePairId: licPayload.licensePairId,
    licenseId: licPayload.licenseId,
    keyFileId: licPayload.keyFileId,
    companyId: licPayload.companyId,
    planType: licPayload.planType,
    expirationDate: licPayload.expirationDate,
    issuedAt: licPayload.issuedAt,
  });

  if (licPayload.pairDigest !== expectedDigest || keyPayload.pairDigest !== expectedDigest) {
    return {
      valid: false,
      code: 'LICENSE_PAIR_MISMATCH',
      error: 'Cryptographic pair digest mismatch between License Key File and Key License File.',
    };
  }

  // 5. Verify Company Identity Binding
  if (options.expectedCompanyId && licPayload.companyId !== options.expectedCompanyId) {
    return {
      valid: false,
      code: 'COMPANY_IDENTITY_MISMATCH',
      error: `Company identity mismatch: This license pair is bound to Company ID '${licPayload.companyId}', not '${options.expectedCompanyId}'.`,
    };
  }

  // 6. Verify License Lifecycle Status in Signed Payload
  if (licPayload.status === 'REVOKED' || keyPayload.status === 'REVOKED') {
    return {
      valid: false,
      code: 'LICENSE_REVOKED',
      error: 'This license pair has been revoked by the License Authority.',
    };
  }

  if (licPayload.status === 'SUSPENDED' || keyPayload.status === 'SUSPENDED') {
    return {
      valid: false,
      code: 'LICENSE_SUSPENDED',
      error: 'This license pair is currently suspended and cannot be activated.',
    };
  }

  return {
    valid: true,
    code: 'VALID',
    keyPayload,
    keySignature,
    licensePayload: licPayload,
    licenseSignature: licSignature,
    keyString: licPayload.activationKey,
  };
}

/**
 * Dual-file extractor enforcing the mandatory two-file requirement.
 */
export function extractAndValidateLicense(options: {
  licenseKeyFile?: string;
  keyLicenseFile?: string;
  expectedCompanyId?: string;
}): ValidatePairResult {
  return validateLicenseFilePair(options);
}

/**
 * Backward compatibility class wrapper for verify-only operations
 */
export class AuthorityCrypto {
  static getPublicKey(): string {
    return RSA_PUBLIC_KEY;
  }

  static verifyLicense(licenseData: any, signature: string): boolean {
    return verifyLicense(licenseData, signature);
  }
}
